// local-api.js — The new "server," running in the Electron main
// process instead of Google Apps Script. Same action-name dispatch
// pattern as Code.gs's doPost (action === 'saveInventoryItem', etc.),
// same JS-array-based logic (filter/map/reduce, not SQL) — the goal
// throughout is a direct, low-risk port of Code.gs's existing logic
// onto the local JSON store from db.js, not a redesign.
//
// PORTING STATUS: this is being built incrementally across sessions.
// Everything Code.gs handles is now implemented here EXCEPT PDF
// generation and file attachments (getFileBase64/uploadImage) and
// login/PIN/sessions (deliberately out of scope — see LOCAL_ACTOR
// below), both of which need a different kind of solution rather than
// a straight port — see the checklist at the bottom of this file.
//
// Covered: getAllData; Inventory (save/update/receive/issue/adjust,
// including issueStock's cross-call into Service Charge for shared
// vs. apartment-specific consumption); Service Charge (contributions,
// apartment/shared expenses including the Petty Cash Topup category
// and "Pay from Petty Cash" linking, deletion with cascade, Budgets,
// Recurring Templates including confirmRecurringExpense's own
// cross-call into logSharedExpense); Petty Cash (inflow/outflow/read/
// delete); Energy (log/update/delete/read); the generic record
// dispatch covering Apartments, Assets, Maintenance, Utilities, Staff,
// Vendors, Payments and MaintenanceLog (optimistic-concurrency
// conflict detection, Payment immutability once paid, automatic
// occupancy-history logging on Apartments status changes); generateId;
// Settings. The ledgers' live summary/breakdown screens are
// client-side logic against these same reads, so nothing further was
// needed there.

const db = require('./db');
const fs = require('fs');
const path = require('path');

// [SIMPLIFICATION] No login, no PINs, no sessions — stripped out for
// now rather than ported. The PIN/role/session system existed to
// secure a backend reachable by anyone with the Apps Script URL and
// token; a local JSON file only this one person's machine can even
// see doesn't have that problem to solve. Every action below runs as
// this one fixed actor instead of a resolved session.
//
// Kept easy to reverse: the Users/Sessions collections in db.js are
// untouched, and every action still takes an "actor" parameter for
// its createdBy/updatedBy fields the same way it always did — only
// the login screen and the session-resolution step in handleAction
// are gone. Bringing back real multi-user login later means restoring
// handleLogin/hashPin/createSession/resolveSession (this file's
// history has the working version from before this change) and
// routing handleAction through resolveSession again instead of always
// using LOCAL_ACTOR.
const LOCAL_ACTOR = { userId: 'local', name: 'Admin', role: 'admin' };

function sanitizePayload(data) {
  if (!data || typeof data !== 'object') return data;
  const clean = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      let val = data[key];
      if (typeof val === 'string') {
        val = val.replace(/^[\s]*[=+\-@]+[\s]*/, '');
        val = val.replace(/[<>]/g, '');
      }
      clean[key] = val;
    }
  }
  return clean;
}

// Direct equivalent of Code.gs's generateNextIdForSheet, operating on
// an in-memory array instead of a sheet range.
function generateNextId(rows, idKey, prefix) {
  let maxId = 0;
  rows.forEach((row) => {
    const raw = String((row && row[idKey]) || '');
    if (raw.indexOf(prefix + '-') === 0) {
      const n = parseInt(raw.split('-')[1], 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
  });
  return prefix + '-' + String(maxId + 1).padStart(4, '0');
}

function findByPK(rows, pkField, value) {
  return rows.find((r) => r && String(r[pkField]) === String(value)) || null;
}

// ─────────────────────────────────────────────
// § BUNDLED FETCH (getAllData) — same idea as Code.gs's version:
// bundle everything the app's initial load needs into one call.
// There's no redirect/latency problem to solve here anymore (it's a
// local file read, not a network round-trip), but keeping the same
// bundled shape means the client-side code that consumes this
// (applyAllDataPayload in Core.js) needs no changes at all.
// ─────────────────────────────────────────────

function getAllData() {
  return {
    apartments: db.getCollection('Apartments'),
    assets: db.getCollection('Assets'),
    maintenance: db.getCollection('Maintenance'),
    inventory: db.getCollection('InventoryItems'),
    staff: db.getCollection('Staff'),
    vendors: db.getCollection('Vendors'),
    payments: db.getCollection('Payments'),
    utilities: db.getCollection('Utilities'),
    // [BUG FIX] Missing from the first port of this function — the
    // original Code.gs's getAllData includes this, and the client's
    // CACHE_TO_PAYLOAD_KEY_MAP (Core.js) explicitly expects
    // payload.maintenanceLog to populate cache.maintenanceLog. Caught
    // by cross-checking every client-side field expectation against
    // this file's actual return shapes, not by a functional test —
    // this file's own tests only ever checked what I expected it to
    // return, not what the client actually reads.
    maintenanceLog: db.getCollection('MaintenanceLog'),
    settings: getSettings(),
  };
}

// ─────────────────────────────────────────────
// § INVENTORY — ported first as the proof-of-concept slice
// ─────────────────────────────────────────────

function saveInventoryItem(data, actor) {
  const name = sanitizePayload({ n: data.name || '' }).n;
  if (!name) return { status: 'error', message: 'Item name is required.' };

  const items = db.getCollection('InventoryItems');
  const category = sanitizePayload({ c: data.category || '' }).c;
  const itemCode = generateNextId(items, 'itemCode', category ? category.slice(0, 3).toUpperCase() : 'GEN');
  const now = new Date().toISOString();
  const startingCost = parseFloat(data.unitCost) || 0;

  const newItem = {
    itemCode, name, category,
    subCategory: sanitizePayload({ s: data.subCategory || '' }).s,
    unit: sanitizePayload({ u: data.unit || '' }).u,
    currentQty: parseFloat(data.currentQty) || 0,
    minQty: parseFloat(data.minQty) || 0,
    reorderQty: parseFloat(data.reorderQty) || 0,
    reorderLevel: parseFloat(data.reorderLevel) || 0,
    unitCost: startingCost,
    lastPurchasePrice: startingCost,
    specification: sanitizePayload({ s: data.specification || '' }).s,
    photoUrl: data.photoUrl || '',
    itemType: data.itemType === 'tool' ? 'tool' : 'consumable',
    status: data.status || 'Active',
    preferredSupplier: sanitizePayload({ p: data.preferredSupplier || '' }).p,
    leadTimeDays: parseFloat(data.leadTimeDays) || 0,
    assetNumber: sanitizePayload({ a: data.assetNumber || '' }).a,
    location: sanitizePayload({ l: data.location || '' }).l,
    custodian: sanitizePayload({ c: data.custodian || '' }).c,
    condition: sanitizePayload({ c: data.condition || '' }).c,
    purchaseDate: data.purchaseDate || '',
    calibrationDue: data.calibrationDue || '',
    createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
  };
  items.push(newItem);
  db.persist();
  return { status: 'success', itemCode, item: newItem };
}

function updateInventoryItem(data, actor) {
  const items = db.getCollection('InventoryItems');
  const existing = findByPK(items, 'itemCode', data.itemCode);
  if (!existing) return { status: 'error', message: 'Item not found.' };

  const update = { itemCode: data.itemCode, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  const textFields = ['name', 'category', 'subCategory', 'unit', 'specification', 'photoUrl', 'status', 'preferredSupplier', 'assetNumber', 'location', 'custodian', 'condition'];
  textFields.forEach((f) => {
    if (data[f] !== undefined) update[f] = sanitizePayload({ v: data[f] }).v;
  });
  const numericFields = ['minQty', 'reorderQty', 'reorderLevel', 'leadTimeDays', 'unitCost'];
  numericFields.forEach((f) => {
    if (data[f] !== undefined) update[f] = parseFloat(data[f]) || 0;
  });
  if (data.currentQty !== undefined && String(existing.itemType || '').toLowerCase() === 'tool') {
    update.currentQty = parseFloat(data.currentQty) || 0;
  }
  if (data.purchaseDate !== undefined) update.purchaseDate = data.purchaseDate || '';
  if (data.calibrationDue !== undefined) update.calibrationDue = data.calibrationDue || '';

  Object.assign(existing, update);
  db.persist();
  return { status: 'success', item: existing };
}

function receiveStock(data, actor) {
  const itemCode = String(data.itemCode || '').trim();
  const qty = parseFloat(data.quantity);
  if (!itemCode || !qty || qty <= 0) {
    return { status: 'error', message: 'Item and a positive quantity are required.' };
  }
  let unitCost = parseFloat(data.unitCost);
  if (isNaN(unitCost) || unitCost < 0) unitCost = 0;

  const items = db.getCollection('InventoryItems');
  const item = findByPK(items, 'itemCode', itemCode);
  if (!item) return { status: 'error', message: 'Item not found.' };

  const oldQty = parseFloat(item.currentQty) || 0;
  const oldCost = parseFloat(item.unitCost) || 0;
  const newQty = oldQty + qty;
  // Weighted-average cost: blends the existing valuation with this
  // receipt's price, rather than overwriting with just the latest
  // purchase price.
  let newAvgCost = newQty > 0 ? ((oldQty * oldCost) + (qty * unitCost)) / newQty : unitCost;
  newAvgCost = Math.round(newAvgCost * 100) / 100;

  item.currentQty = newQty;
  item.unitCost = newAvgCost;
  item.lastPurchasePrice = unitCost;
  item.updatedAt = new Date().toISOString();
  item.updatedBy = actor.name;
  // Receiving stock against an item marked "On Order" automatically
  // clears that flag — the order has been fulfilled (at least in
  // part; kept simple rather than tracking partial-delivery remainders).
  if (String(item.onOrder || '').toLowerCase() === 'yes') {
    item.onOrder = 'No';
    item.onOrderQty = '';
    item.onOrderDate = '';
  }

  const movements = db.getCollection('InventoryMovements');
  const entryId = generateNextId(movements, 'entryId', 'IM');
  const now = new Date().toISOString();
  const moveDate = data.date || now;

  const newMovement = {
    entryId, itemCode, movementType: 'receive', date: moveDate,
    quantity: qty, unitCostAtTime: unitCost, totalValue: Math.round(qty * unitCost * 100) / 100,
    deliveryNote: sanitizePayload({ d: data.deliveryNote || '' }).d,
    invoiceRef: sanitizePayload({ i: data.invoiceRef || '' }).i,
    recipient: sanitizePayload({ r: data.personReceiving || '' }).r,
    createdAt: now, createdBy: actor.name,
  };
  movements.push(newMovement);
  db.persist();
  return { status: 'success', entryId, newQty, newUnitCost: newAvgCost, item, movement: newMovement };
}

function issueStock(data, actor) {
  const itemCode = String(data.itemCode || '').trim();
  const qty = parseFloat(data.quantity);
  if (!itemCode || !qty || qty <= 0) {
    return { status: 'error', message: 'Item and a positive quantity are required.' };
  }
  const items = db.getCollection('InventoryItems');
  const item = findByPK(items, 'itemCode', itemCode);
  if (!item) return { status: 'error', message: 'Item not found.' };

  const oldQty = parseFloat(item.currentQty) || 0;
  if (qty > oldQty) {
    return { status: 'error', message: 'Cannot issue more than the current stock (' + oldQty + ' ' + (item.unit || '') + ' available).' };
  }
  const unitCost = parseFloat(item.unitCost) || 0;
  const totalValue = Math.round(qty * unitCost * 100) / 100;
  const newQty = oldQty - qty;

  item.currentQty = newQty;
  item.updatedAt = new Date().toISOString();
  item.updatedBy = actor.name;

  const apt = String(data.apt || '').trim();
  const isShared = !apt || apt.toLowerCase() === 'shared';
  const moveDate = data.date || new Date().toISOString();

  let scResult = null;
  if (totalValue > 0) {
    const scCategory = 'Inventory: ' + (item.name || itemCode);
    const scDescription = qty + ' ' + (item.unit || '') + ' issued' + (data.purpose ? ' — ' + data.purpose : '');
    scResult = isShared
      ? logSharedExpense({ amount: totalValue, category: scCategory, description: scDescription, date: moveDate }, actor)
      : logApartmentExpense({ apt, amount: totalValue, category: scCategory, description: scDescription, date: moveDate }, actor);
  }

  const movements = db.getCollection('InventoryMovements');
  const entryId = generateNextId(movements, 'entryId', 'IM');
  const now = new Date().toISOString();
  const linkedEntry = (scResult && scResult.status === 'success') ? (scResult.entryId || scResult.expenseId || '') : '';

  const newMovement = {
    entryId, itemCode, movementType: 'issue', date: moveDate,
    quantity: -qty, unitCostAtTime: unitCost, totalValue: -totalValue,
    apt: isShared ? 'Shared' : apt,
    department: sanitizePayload({ d: data.department || '' }).d,
    purpose: sanitizePayload({ p: data.purpose || '' }).p,
    maintenanceTicket: sanitizePayload({ t: data.maintenanceTicket || '' }).t,
    recipient: sanitizePayload({ r: data.recipient || '' }).r,
    authorizedBy: actor.name,
    linkedServiceChargeEntry: linkedEntry,
    createdAt: now, createdBy: actor.name,
  };
  movements.push(newMovement);
  db.persist();
  return {
    status: 'success', entryId, newQty, item, movement: newMovement,
    serviceChargeLinked: !!linkedEntry,
    serviceChargeWarning: (scResult && scResult.status !== 'success') ? scResult.message : null,
  };
}

function adjustStock(data, actor) {
  const itemCode = String(data.itemCode || '').trim();
  const qtyDelta = parseFloat(data.quantityDelta);
  if (!itemCode || !qtyDelta) {
    return { status: 'error', message: 'Item and a non-zero quantity adjustment are required.' };
  }
  const reason = sanitizePayload({ r: data.reason || 'Correction' }).r;

  const items = db.getCollection('InventoryItems');
  const item = findByPK(items, 'itemCode', itemCode);
  if (!item) return { status: 'error', message: 'Item not found.' };

  const oldQty = parseFloat(item.currentQty) || 0;
  const newQty = oldQty + qtyDelta;
  if (newQty < 0) {
    return { status: 'error', message: 'This adjustment would take stock below zero.' };
  }
  const unitCost = parseFloat(item.unitCost) || 0;

  item.currentQty = newQty;
  item.updatedAt = new Date().toISOString();
  item.updatedBy = actor.name;

  const movements = db.getCollection('InventoryMovements');
  const entryId = generateNextId(movements, 'entryId', 'IM');
  const now = new Date().toISOString();
  const moveDate = data.date || now;

  const newMovement = {
    entryId, itemCode, movementType: 'adjustment', date: moveDate,
    quantity: qtyDelta, unitCostAtTime: unitCost, totalValue: Math.round(qtyDelta * unitCost * 100) / 100,
    reason, authorizedBy: actor.name,
    createdAt: now, createdBy: actor.name,
  };
  movements.push(newMovement);
  db.persist();
  return { status: 'success', entryId, newQty, item, movement: newMovement };
}

// ─────────────────────────────────────────────
// § PETTY CASH — only the append helper is ported so far (needed by
// Service Charge's "Pay from Petty Cash" / "Petty Cash Topup"
// linking below); the standalone Inflow/Outflow forms, deletion, and
// the live summary/breakdown still call through to the "not yet
// available" fallback until Petty Cash itself is ported properly.
// ─────────────────────────────────────────────

function appendPettyCashEntry(direction, data, actor, linkedEntry) {
  const amount = parseFloat(data.amount);
  if (!amount || amount <= 0) {
    return { status: 'error', message: 'A positive amount is required.' };
  }
  const entries = db.getCollection('PettyCash');
  const entryId = generateNextId(entries, 'entryId', 'PC');
  const now = new Date().toISOString();
  const category = sanitizePayload({ c: data.category || (direction === 'inflow' ? 'Inflow' : 'Outflow') }).c;

  const newEntry = {
    entryId, direction, apt: String(data.apt || '').trim(),
    date: data.date || now, category,
    description: sanitizePayload({ d: data.description || '' }).d,
    amount, createdAt: now, createdBy: actor.name,
    updatedAt: now, updatedBy: actor.name,
    linkedServiceChargeEntry: linkedEntry || '',
  };
  entries.push(newEntry);
  db.persist();
  return { status: 'success', entryId, entry: newEntry };
}

// ─────────────────────────────────────────────
// § SERVICE CHARGE
// ─────────────────────────────────────────────

// mm-NNN format, resetting each calendar month — direct port of
// generateNextServiceChargeEntryNumber, operating on the in-memory
// array instead of a sheet range.
function generateNextServiceChargeEntryNumber(entries, dateStr) {
  const d = new Date(dateStr);
  const targetYear = d.getFullYear();
  const targetMonth = d.getMonth();
  const mm = String(targetMonth + 1).padStart(2, '0');

  let maxNum = 0;
  entries.forEach((row) => {
    const rowDate = new Date(row.date);
    if (isNaN(rowDate.getTime())) return;
    if (rowDate.getFullYear() !== targetYear || rowDate.getMonth() !== targetMonth) return;
    const val = String(row.entryNumber || '');
    const parts = val.split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return mm + '-' + String(maxNum + 1).padStart(3, '0');
}

// Studio : 1-Bedroom : 2-Bedroom = 1 : 1.25 : 1.5 — used only when an
// apartment has no custom weight of its own set.
function getDefaultWeightForType(type) {
  const t = String(type || '').toLowerCase();
  if (t.indexOf('studio') !== -1) return 1;
  if (t.indexOf('2') !== -1 && t.indexOf('bed') !== -1) return 1.5;
  if (t.indexOf('1') !== -1 && t.indexOf('bed') !== -1) return 1.25;
  return 1;
}

function wasApartmentOccupiedOnDate(apt, occupancyLog, targetDateStr, currentAptRecord) {
  const events = occupancyLog
    .filter((e) => e && String(e.apt) === String(apt))
    .map((e) => ({ event: String(e.event || '').toLowerCase(), date: new Date(e.date) }))
    .filter((e) => !isNaN(e.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (events.length === 0) {
    return String((currentAptRecord && currentAptRecord.status) || '').toLowerCase() === 'occupied';
  }

  const target = new Date(targetDateStr);
  let stintStart = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.event === 'occupied' && stintStart === null) {
      stintStart = e.date;
    } else if (e.event === 'vacated' && stintStart !== null) {
      if (stintStart <= target && target < e.date) return true;
      stintStart = null;
    }
  }
  if (stintStart !== null && stintStart <= target) return true;
  return false;
}

function isSameCalendarDay(isoString) {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function logContribution(data, actor) {
  const apt = String(data.apt || '').trim();
  const amount = parseFloat(data.amount);
  if (!apt || !amount || amount <= 0) {
    return { status: 'error', message: 'Apartment and a positive amount are required.' };
  }
  const ledger = db.getCollection('ServiceChargeLedger');
  const entryId = generateNextId(ledger, 'entryId', 'SCL');
  const entryDate = data.date || new Date().toISOString();
  const entryNumber = generateNextServiceChargeEntryNumber(ledger, entryDate);
  const now = new Date().toISOString();

  const newEntry = {
    entryId, expenseId: entryId, entryNumber, apt, date: entryDate,
    type: 'contribution', category: 'Contribution',
    description: sanitizePayload({ d: data.description || '' }).d,
    amount, direction: 'credit',
    createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
  };
  ledger.push(newEntry);
  db.persist();
  return { status: 'success', entryId, entry: newEntry };
}

function logApartmentExpense(data, actor) {
  const apt = String(data.apt || '').trim();
  const amount = parseFloat(data.amount);
  const category = sanitizePayload({ c: data.category || 'Expense' }).c;
  if (!apt || !amount || amount <= 0) {
    return { status: 'error', message: 'Apartment and a positive amount are required.' };
  }
  const ledger = db.getCollection('ServiceChargeLedger');
  const entryId = generateNextId(ledger, 'entryId', 'SCL');
  const entryDate = data.date || new Date().toISOString();
  const entryNumber = generateNextServiceChargeEntryNumber(ledger, entryDate);
  const now = new Date().toISOString();

  const newEntry = {
    entryId, expenseId: entryId, entryNumber, apt, date: entryDate,
    type: 'apartment_expense', category,
    description: sanitizePayload({ d: data.description || '' }).d,
    amount, direction: 'debit', paidFromPettyCash: data.fromPettyCash ? 'Yes' : 'No',
    createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
  };
  ledger.push(newEntry);

  let pettyCashResult = null;
  if (data.fromPettyCash) {
    try {
      pettyCashResult = appendPettyCashEntry(
        'outflow',
        { amount, category, description: 'Service Charge ' + entryNumber + ': ' + (data.description || category), date: entryDate, apt },
        actor, entryNumber,
      );
    } catch (e) { /* best-effort — the Service Charge entry above already succeeded */ }
  }
  db.persist();
  return { status: 'success', entryId, entry: newEntry, pettyCashEntry: (pettyCashResult && pettyCashResult.entry) || null };
}

function logSharedExpense(data, actor) {
  const amount = parseFloat(data.amount);
  const category = sanitizePayload({ c: data.category || 'Shared Expense' }).c;
  const description = sanitizePayload({ d: data.description || '' }).d;
  if (!amount || amount <= 0) {
    return { status: 'error', message: 'A positive amount is required.' };
  }
  const expenseDate = data.date || new Date().toISOString();
  const ledger = db.getCollection('ServiceChargeLedger');

  if (category === 'Petty Cash Topup') {
    const topupExpenseId = generateNextId(ledger, 'expenseId', 'SCE');
    const topupEntryNumber = generateNextServiceChargeEntryNumber(ledger, expenseDate);
    const topupEntryId = generateNextId(ledger, 'entryId', 'SCL');
    const topupNow = new Date().toISOString();

    const topupEntry = {
      entryId: topupEntryId, expenseId: topupExpenseId, entryNumber: topupEntryNumber,
      apt: 'Petty Cash Transfer', date: expenseDate,
      type: 'petty_cash_topup', category, description,
      amount, direction: 'debit',
      createdAt: topupNow, createdBy: actor.name, updatedAt: topupNow, updatedBy: actor.name,
    };
    ledger.push(topupEntry);

    let topupPettyCashResult = null;
    try {
      topupPettyCashResult = appendPettyCashEntry(
        'inflow',
        { amount, category, description: 'Service Charge ' + topupEntryNumber + ': ' + (description || category), date: expenseDate, apt: 'Petty Cash Transfer' },
        actor, topupEntryNumber,
      );
    } catch (e) { /* best-effort */ }

    db.persist();
    return {
      status: 'success', expenseId: topupExpenseId, splits: [{ apt: 'Petty Cash Transfer', share: amount }],
      entries: [topupEntry], pettyCashEntry: (topupPettyCashResult && topupPettyCashResult.entry) || null,
    };
  }

  const allApartments = db.getCollection('Apartments').filter((a) => String(a.type || '').toLowerCase() !== 'services');

  let targetApts;
  if (Array.isArray(data.selectedApts) && data.selectedApts.length > 0) {
    const selectedSet = {};
    data.selectedApts.forEach((id) => { selectedSet[String(id)] = true; });
    targetApts = allApartments.filter((a) => selectedSet[String(a.apt)]);
    if (targetApts.length === 0) {
      return { status: 'error', message: 'None of the selected apartments could be found.' };
    }
  } else {
    const occupancyLog = db.getCollection('OccupancyLog');
    targetApts = allApartments.filter((a) => wasApartmentOccupiedOnDate(a.apt, occupancyLog, expenseDate, a));
    if (targetApts.length === 0) {
      return { status: 'error', message: 'No occupied apartments to split this expense across.' };
    }
  }

  const totalWeight = targetApts.reduce((sum, a) => {
    const w = parseFloat(a.weight);
    return sum + (isNaN(w) || w <= 0 ? getDefaultWeightForType(a.type) : w);
  }, 0);

  const expenseId = generateNextId(ledger, 'expenseId', 'SCE');
  const entryNumber = generateNextServiceChargeEntryNumber(ledger, expenseDate);
  const startId = generateNextId(ledger, 'entryId', 'SCL');
  const startNum = parseInt(startId.split('-')[1], 10);
  const now = new Date().toISOString();
  const entryType = targetApts.length === 1 ? 'apartment_expense' : 'shared_expense';

  const rowObjects = [];
  const splits = [];
  targetApts.forEach((a, i) => {
    let w = parseFloat(a.weight);
    if (isNaN(w) || w <= 0) w = getDefaultWeightForType(a.type);
    const share = Math.round(amount * (w / totalWeight) * 100) / 100;
    const entryId = 'SCL-' + String(startNum + i).padStart(4, '0');
    const aptId = a.apt;

    const rowObj = {
      entryId, expenseId, entryNumber, apt: aptId, date: expenseDate,
      type: entryType, category, description,
      amount: share, direction: 'debit', paidFromPettyCash: data.fromPettyCash ? 'Yes' : 'No',
      createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
    };
    rowObjects.push(rowObj);
    splits.push({ apt: aptId, share });
  });
  ledger.push(...rowObjects);

  const pettyCashApt = splits.length === 1 ? splits[0].apt : 'Shared (' + splits.length + ' apts)';
  const pettyCashDescription = splits.length === 1
    ? 'Service Charge ' + entryNumber + ': ' + (description || category)
    : 'Service Charge ' + entryNumber + ' (shared, ' + splits.length + ' apts): ' + (description || category);

  let mainPettyCashResult = null;
  if (data.fromPettyCash) {
    try {
      mainPettyCashResult = appendPettyCashEntry(
        'outflow',
        { amount, category, description: pettyCashDescription, date: expenseDate, apt: pettyCashApt },
        actor, entryNumber,
      );
    } catch (e) { /* best-effort */ }
  }

  db.persist();
  return {
    status: 'success', expenseId, splits, entries: rowObjects,
    pettyCashEntry: (mainPettyCashResult && mainPettyCashResult.entry) || null,
  };
}

function deleteServiceChargeEntry(data, actor) {
  const entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };

  const ledger = db.getCollection('ServiceChargeLedger');
  const existing = findByPK(ledger, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };
  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'This entry can only be deleted on the day it was created.' };
  }

  let idsToDelete = [entryId];
  if (existing.type === 'shared_expense' && existing.expenseId) {
    idsToDelete = ledger.filter((r) => r.expenseId === existing.expenseId).map((r) => r.entryId);
  }
  const idsToDeleteSet = new Set(idsToDelete);
  const remaining = ledger.filter((r) => !idsToDeleteSet.has(r.entryId));
  ledger.length = 0;
  ledger.push(...remaining);

  let deletedPettyCashCount = 0;
  if (existing.entryNumber) {
    const pettyCash = db.getCollection('PettyCash');
    const linkedIds = new Set(
      pettyCash.filter((r) => r.linkedServiceChargeEntry === existing.entryNumber).map((r) => r.entryId),
    );
    if (linkedIds.size > 0) {
      const pettyCashRemaining = pettyCash.filter((r) => !linkedIds.has(r.entryId));
      pettyCash.length = 0;
      pettyCash.push(...pettyCashRemaining);
      deletedPettyCashCount = linkedIds.size;
    }
  }

  db.persist();
  return { status: 'success', deletedCount: idsToDelete.length, deletedPettyCashCount };
}

function deletePettyCashEntry(data, actor) {
  const entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };

  const entries = db.getCollection('PettyCash');
  const existing = findByPK(entries, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };
  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'This entry can only be deleted on the day it was created.' };
  }

  const remaining = entries.filter((r) => r.entryId !== entryId);
  entries.length = 0;
  entries.push(...remaining);
  db.persist();
  return { status: 'success' };
}

// ─────────────────────────────────────────────
// § ENERGY
// ─────────────────────────────────────────────

const ENERGY_TRANSACTION_TYPES = {
  'Energy Remittance': 'inflow',
  'Diesel Purchase': 'outflow',
  'EKEDC Payments': 'outflow',
};

function logEnergyTransaction(data, actor) {
  const type = String(data.type || '').trim();
  const direction = ENERGY_TRANSACTION_TYPES[type];
  if (!direction) {
    return { status: 'error', message: 'Select a valid transaction type.' };
  }
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) {
    return { status: 'error', message: 'A positive amount is required.' };
  }
  const ledger = db.getCollection('EnergyLedger');
  const entryId = generateNextId(ledger, 'entryId', 'ENL');
  const now = new Date().toISOString();

  const newEntry = {
    entryId, type, direction, amount,
    date: data.date || now,
    description: sanitizePayload({ d: data.description || '' }).d,
    createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
  };
  ledger.push(newEntry);
  db.persist();
  return { status: 'success', entryId, entry: newEntry };
}

function updateEnergyEntry(data, actor) {
  const entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };
  const ledger = db.getCollection('EnergyLedger');
  const existing = findByPK(ledger, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };
  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'Entries can only be edited on the day they were created.' };
  }

  const update = { entryId, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  if (data.type !== undefined) {
    const direction = ENERGY_TRANSACTION_TYPES[String(data.type).trim()];
    if (!direction) return { status: 'error', message: 'Select a valid transaction type.' };
    update.type = String(data.type).trim();
    update.direction = direction;
  }
  if (data.amount !== undefined) {
    const amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) return { status: 'error', message: 'A positive amount is required.' };
    update.amount = amount;
  }
  if (data.date !== undefined) update.date = data.date || new Date().toISOString();
  if (data.description !== undefined) update.description = sanitizePayload({ d: data.description }).d;

  Object.assign(existing, update);
  db.persist();
  return { status: 'success', entry: existing };
}

function deleteEnergyEntry(data, actor) {
  const entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };
  const ledger = db.getCollection('EnergyLedger');
  const existing = findByPK(ledger, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };
  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'Entries can only be deleted on the day they were created.' };
  }
  const remaining = ledger.filter((r) => r.entryId !== entryId);
  ledger.length = 0;
  ledger.push(...remaining);
  db.persist();
  return { status: 'success' };
}

// ─────────────────────────────────────────────
// § GENERIC RECORD DISPATCH — Apartments, Assets, Maintenance,
// Utilities, Staff, Vendors, Payments. One shared save/update path,
// same as Code.gs's — no generic delete exists for these types even
// on the server side (they're archived via a status field, not
// deleted), so there's nothing to port for that.
// ─────────────────────────────────────────────

const READ_MAP = {
  getApartments: 'Apartments', getAssets: 'Assets', getMaintenance: 'Maintenance',
  getStaff: 'Staff', getVendors: 'Vendors', getUtilities: 'Utilities',
  getPayments: 'Payments', getMaintenanceLog: 'MaintenanceLog',
};

const SHEET_MAP = {
  saveApartment: 'Apartments', updateApartment: 'Apartments',
  saveAsset: 'Assets', updateAsset: 'Assets',
  saveMaintenance: 'Maintenance', updateMaintenance: 'Maintenance',
  saveUtility: 'Utilities', updateUtility: 'Utilities',
  saveStaff: 'Staff', updateStaff: 'Staff',
  saveVendor: 'Vendors', updateVendor: 'Vendors',
  savePayment: 'Payments', updatePayment: 'Payments',
  saveMaintenanceLog: 'MaintenanceLog', updateMaintenanceLog: 'MaintenanceLog',
};

const PRIMARY_KEY_MAP = {
  Apartments: 'apt', Assets: 'tag', Maintenance: 'ticketId', Staff: 'rowId',
  Vendors: 'rowId', Payments: 'paymentId', Utilities: 'rowId', MaintenanceLog: 'logId',
};

function applyAuditFields(data, action, actor) {
  const now = new Date().toISOString();
  const clean = data || {};
  const actorName = (actor && actor.name) || 'unknown';
  if (action.indexOf('save') === 0) {
    if (!clean.createdAt) clean.createdAt = now;
    if (!clean.createdBy) clean.createdBy = actorName;
  }
  clean.updatedAt = now;
  clean.updatedBy = actorName;
  return clean;
}

function logOccupancyTransition(apt, event, actor) {
  const log = db.getCollection('OccupancyLog');
  const entryId = generateNextId(log, 'entryId', 'OCC');
  const now = new Date().toISOString();
  log.push({ entryId, apt, event, date: now, createdAt: now, createdBy: (actor && actor.name) || 'unknown' });
}

// Direct port of generateId — but without Code.gs's LockService/
// ScriptProperties counter, which existed purely to keep concurrent
// remote requests from racing each other onto the same ID. There's
// only ever one request at a time here (Electron's main process
// handles each IPC call synchronously, one after another), so that
// entire mechanism has nothing left to protect against — this is
// just generateNextId's normal "scan for the current max" logic,
// exposed as its own callable action for the client-side callers
// that ask for an ID up front rather than as part of a save.
function generateId(data) {
  const { sheetName, idKey, prefix } = data;
  if (!sheetName || !idKey || !prefix) {
    return { status: 'error', message: 'generateId requires sheetName, idKey and prefix.' };
  }
  let rows;
  try {
    rows = db.getCollection(sheetName);
  } catch (e) {
    return { status: 'error', message: 'Unknown collection: ' + sheetName };
  }
  return { status: 'success', id: generateNextId(rows, idKey, prefix) };
}

function handleGenericRecordAction(action, data, actor) {
  const sheetName = SHEET_MAP[action];
  if (!sheetName) return { status: 'error', message: 'Action route not found: ' + action };

  const records = db.getCollection(sheetName);
  data = applyAuditFields(data, action, actor);
  const pkField = PRIMARY_KEY_MAP[sheetName];

  if (action.indexOf('update') === 0) {
    const existing = findByPK(records, pkField, data[pkField]);

    // Optimistic-concurrency check — same reasoning as Code.gs: reject
    // rather than silently overwrite if the record changed since the
    // client last saw it. Only runs when the client actually sent
    // expectedUpdatedAt.
    if (existing && data.expectedUpdatedAt) {
      const expectedTime = new Date(data.expectedUpdatedAt).getTime();
      const currentTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : NaN;
      if (!isNaN(expectedTime) && !isNaN(currentTime) && expectedTime !== currentTime) {
        return {
          status: 'error', code: 'CONFLICT',
          message: (existing.updatedBy || 'Someone') + ' already changed this record. Your edit was not saved — reopen it to see the latest version.',
        };
      }
    }
    delete data.expectedUpdatedAt;

    if (sheetName === 'Payments' && existing) {
      const isPaid = String(existing.isPaid || '').toUpperCase() === 'TRUE' || existing.isPaid === true;
      if (isPaid) return { status: 'error', message: 'Paid/Cleared Payment records cannot be modified.' };
    }

    if (sheetName === 'Apartments' && data.status !== undefined) {
      const oldStatus = existing ? String(existing.status || '').toLowerCase() : '';
      const newStatus = String(data.status || '').toLowerCase();
      if (oldStatus !== newStatus && (oldStatus === 'occupied' || newStatus === 'occupied')) {
        logOccupancyTransition(data[pkField], newStatus === 'occupied' ? 'occupied' : 'vacated', actor);
      }
    }

    if (!existing) return { status: 'error', message: 'Record not found.' };
    Object.assign(existing, data);
    db.persist();
    return { status: 'success', record: existing };
  }

  if (action.indexOf('save') === 0) {
    if (pkField && data[pkField] && findByPK(records, pkField, data[pkField])) {
      return { status: 'error', message: 'Record with ID ' + data[pkField] + ' already exists. Use update instead.' };
    }
    records.push(data);
    // A brand-new apartment created already-Occupied needs its first
    // occupancy stint recorded too.
    if (sheetName === 'Apartments' && String(data.status || '').toLowerCase() === 'occupied') {
      logOccupancyTransition(data[pkField], 'occupied', actor);
    }
    db.persist();
    return { status: 'success', record: data };
  }

  return { status: 'success' };
}

// ─────────────────────────────────────────────
// § SETTINGS — a single object of named fields (estateName, fmName,
// etc.), not a list of rows, so db.js already models it the way
// Code.gs's single-row-of-columns sheet does. A direct port.
// ─────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  estateName: '', estateAddress: '', fmName: '', fmAddress: '',
  logoUrl: '', mainFolder: 'FacilityPro_Attachments',
};

function getSettings() {
  const settings = db.getCollection('Settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

function saveSettings(data) {
  const settings = db.getCollection('Settings');
  // [BUG FIX] attachmentsFolder is managed separately by the folder
  // picker (select-attachments-folder in main.js), not by this form —
  // preserved explicitly here rather than deleted along with every
  // other key, which would otherwise silently reset the chosen
  // attachments location back to the default every time someone saves
  // an unrelated Settings field like the estate name.
  const attachmentsFolder = settings.attachmentsFolder;
  Object.keys(settings).forEach((key) => delete settings[key]);
  Object.assign(settings, {
    estateName: data.estateName || '',
    estateAddress: data.estateAddress || '',
    fmName: data.fmName || '',
    fmAddress: data.fmAddress || '',
    logoUrl: data.logoUrl || '',
    mainFolder: data.mainFolder || 'FacilityPro_Attachments',
  });
  if (attachmentsFolder) settings.attachmentsFolder = attachmentsFolder;
  db.persist();
  return { status: 'success', message: 'Settings synced.' };
}

// ─────────────────────────────────────────────
// § ATTACHMENTS — replaces the old Google Drive upload pipeline.
// Files are saved directly into the local folder configured in
// Settings (db.getAttachmentsFolder, defaulting to a subfolder of
// Electron's userData dir until the person picks one). The returned
// "url" is an attachment:// address (see main.js's protocol handler)
// rather than a Drive link — the client stores this exact string on
// records (photos, photoUrl, etc.) either way, so nothing about how
// the client uses the result needs to change, same as everywhere else
// this transport was swapped out from under an unchanged interface.
// ─────────────────────────────────────────────

function sanitizeFileName(name) {
  return String(name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 120);
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function uploadImage(data) {
  if (!data.base64 || !data.name) {
    return { status: 'error', message: 'Upload requires base64 and name.' };
  }
  const approxBytes = data.base64.length * 0.75;
  if (approxBytes > MAX_UPLOAD_BYTES) {
    return { status: 'error', message: 'File exceeds 5MB limit.' };
  }

  try {
    const parts = data.base64.split(',');
    const base64String = parts.length > 1 ? parts[1] : parts[0];
    const buffer = Buffer.from(base64String, 'base64');
    const safeName = sanitizeFileName(data.name);
    const folder = db.getAttachmentsFolder();
    let fullPath = path.join(folder, safeName);

    // The client already stamps names with Date.now(), so a collision
    // is unlikely, but guard against one anyway rather than silently
    // overwriting a different attachment that happened to get the
    // same name.
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      let n = 1;
      while (fs.existsSync(fullPath)) {
        fullPath = path.join(folder, base + '_' + n + ext);
        n++;
      }
    }

    fs.writeFileSync(fullPath, buffer);
    const finalName = path.basename(fullPath);
    return { status: 'success', url: 'attachment://' + finalName, id: finalName };
  } catch (err) {
    return { status: 'error', message: 'Local upload failed: ' + String(err && err.message ? err.message : err) };
  }
}

// ─────────────────────────────────────────────
// § SERVICE CHARGE BUDGETS
// ─────────────────────────────────────────────

function saveServiceChargeBudget(data, actor) {
  const category = sanitizePayload({ c: data.category || '' }).c;
  const amount = parseFloat(data.monthlyBudgetAmount);
  if (!category || isNaN(amount) || amount < 0) {
    return { status: 'error', message: 'Category and a valid monthly budget amount are required.' };
  }
  const budgets = db.getCollection('ServiceChargeBudgets');
  const budgetId = generateNextId(budgets, 'budgetId', 'BUD');
  const now = new Date().toISOString();
  const newBudget = {
    budgetId, category, monthlyBudgetAmount: amount,
    effectiveFrom: data.effectiveFrom || now,
    createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
  };
  budgets.push(newBudget);
  db.persist();
  return { status: 'success', budgetId, budget: newBudget };
}

function deleteServiceChargeBudget(data) {
  const budgetId = String(data.budgetId || '').trim();
  if (!budgetId) return { status: 'error', message: 'Missing budgetId.' };
  const budgets = db.getCollection('ServiceChargeBudgets');
  const remaining = budgets.filter((b) => b.budgetId !== budgetId);
  budgets.length = 0;
  budgets.push(...remaining);
  db.persist();
  return { status: 'success' };
}

// ─────────────────────────────────────────────
// § RECURRING EXPENSE TEMPLATES
// ─────────────────────────────────────────────

function saveRecurringExpenseTemplate(data, actor) {
  const category = sanitizePayload({ c: data.category || '' }).c;
  const description = sanitizePayload({ d: data.description || '' }).d;
  const amount = parseFloat(data.defaultAmount);
  if (!category || !description || isNaN(amount) || amount <= 0) {
    return { status: 'error', message: 'Category, description, and a positive default amount are required.' };
  }
  const templates = db.getCollection('RecurringExpenseTemplates');
  const templateId = generateNextId(templates, 'templateId', 'RXT');
  const now = new Date().toISOString();
  const newTemplate = {
    templateId, category, description,
    defaultAmount: amount, dayOfMonth: parseInt(data.dayOfMonth, 10) || 1,
    lastConfirmedMonth: '', active: 'Yes',
    createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name,
  };
  templates.push(newTemplate);
  db.persist();
  return { status: 'success', templateId, template: newTemplate };
}

function updateRecurringExpenseTemplate(data, actor) {
  const templateId = String(data.templateId || '').trim();
  if (!templateId) return { status: 'error', message: 'Missing templateId.' };
  const templates = db.getCollection('RecurringExpenseTemplates');
  const existing = findByPK(templates, 'templateId', templateId);
  if (!existing) return { status: 'error', message: 'Template not found.' };

  const update = { templateId, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  if (data.category !== undefined) update.category = sanitizePayload({ c: data.category }).c;
  if (data.description !== undefined) update.description = sanitizePayload({ d: data.description }).d;
  if (data.defaultAmount !== undefined) update.defaultAmount = parseFloat(data.defaultAmount) || 0;
  if (data.dayOfMonth !== undefined) update.dayOfMonth = parseInt(data.dayOfMonth, 10) || 1;
  if (data.active !== undefined) update.active = data.active;

  Object.assign(existing, update);
  db.persist();
  return { status: 'success', template: existing };
}

function deleteRecurringExpenseTemplate(data) {
  const templateId = String(data.templateId || '').trim();
  if (!templateId) return { status: 'error', message: 'Missing templateId.' };
  const templates = db.getCollection('RecurringExpenseTemplates');
  const remaining = templates.filter((t) => t.templateId !== templateId);
  templates.length = 0;
  templates.push(...remaining);
  db.persist();
  return { status: 'success' };
}

// Reuses logSharedExpense so a confirmed recurring expense creates
// exactly the same kind of ledger entry (weighted split across
// occupied units, entry number, optional Petty Cash link) as one
// logged manually — the only difference is where the category/
// description/amount came from, and that it stamps the template's
// lastConfirmedMonth so it stops showing as "due" until next month.
function confirmRecurringExpense(data, actor) {
  const templateId = String(data.templateId || '').trim();
  if (!templateId) return { status: 'error', message: 'Missing templateId.' };
  const templates = db.getCollection('RecurringExpenseTemplates');
  const template = findByPK(templates, 'templateId', templateId);
  if (!template) return { status: 'error', message: 'Template not found.' };

  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) {
    return { status: 'error', message: 'A positive amount is required.' };
  }
  const expenseDate = data.date || new Date().toISOString();

  const scResult = logSharedExpense({
    amount, category: template.category,
    description: data.description !== undefined ? data.description : template.description,
    date: expenseDate, fromPettyCash: data.fromPettyCash,
  }, actor);
  if (scResult.status !== 'success') return scResult;

  const d = new Date(expenseDate);
  const confirmedMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  template.lastConfirmedMonth = confirmedMonth;
  template.updatedAt = new Date().toISOString();
  template.updatedBy = actor.name;
  db.persist();

  return { status: 'success', expenseId: scResult.expenseId, splits: scResult.splits };
}

// ─────────────────────────────────────────────
// § ACTION DISPATCH — the local equivalent of Code.gs's doPost
// ─────────────────────────────────────────────

// sessionToken is still accepted as a parameter (so callApi's call
// signature doesn't need to change) but is otherwise ignored — every
// action just runs as LOCAL_ACTOR. login/logout/getUsersForLogin
// return an immediate, harmless success/empty result rather than an
// error, in case the client-side login screen still calls them before
// its own bypass is wired up (see the Core.js/Login.js changes that
// go with this).
function handleAction(action, data, sessionToken) {
  if (action === 'login') {
    return { status: 'success', sessionToken: 'local', userId: LOCAL_ACTOR.userId, name: LOCAL_ACTOR.name, role: LOCAL_ACTOR.role };
  }
  if (action === 'getUsersForLogin') return [{ userId: LOCAL_ACTOR.userId, name: LOCAL_ACTOR.name }];
  if (action === 'logout') return { status: 'success' };

  const actor = LOCAL_ACTOR;
  if (action === 'getAllData') return getAllData();
  if (action === 'saveInventoryItem') return saveInventoryItem(data, actor);
  if (action === 'updateInventoryItem') return updateInventoryItem(data, actor);
  if (action === 'receiveStock') return receiveStock(data, actor);
  if (action === 'issueStock') return issueStock(data, actor);
  if (action === 'adjustStock') return adjustStock(data, actor);
  if (action === 'getInventoryItems') return db.getCollection('InventoryItems');
  if (action === 'getInventoryMovements') return db.getCollection('InventoryMovements');

  if (action === 'getServiceChargeLedger') return db.getCollection('ServiceChargeLedger');
  if (action === 'logContribution') return logContribution(data, actor);
  if (action === 'logApartmentExpense') return logApartmentExpense(data, actor);
  if (action === 'logSharedExpense') return logSharedExpense(data, actor);
  if (action === 'deleteServiceChargeEntry') return deleteServiceChargeEntry(data, actor);

  if (action === 'getPettyCashLedger') return db.getCollection('PettyCash');
  if (action === 'logPettyCashInflow') return appendPettyCashEntry('inflow', data, actor);
  if (action === 'logPettyCashOutflow') return appendPettyCashEntry('outflow', data, actor);
  if (action === 'deletePettyCashEntry') return deletePettyCashEntry(data, actor);

  if (action === 'getEnergyLedger') return db.getCollection('EnergyLedger');
  if (action === 'logEnergyTransaction') return logEnergyTransaction(data, actor);
  if (action === 'updateEnergyEntry') return updateEnergyEntry(data, actor);
  if (action === 'deleteEnergyEntry') return deleteEnergyEntry(data, actor);

  if (action === 'generateId') return generateId(data);
  if (action === 'getSettings') return getSettings();
  if (action === 'saveSettings') return saveSettings(data);
  if (action === 'uploadImage') return uploadImage(data);

  if (action === 'getServiceChargeBudgets') return db.getCollection('ServiceChargeBudgets');
  if (action === 'saveServiceChargeBudget') return saveServiceChargeBudget(data, actor);
  if (action === 'deleteServiceChargeBudget') return deleteServiceChargeBudget(data);

  if (action === 'getRecurringExpenseTemplates') return db.getCollection('RecurringExpenseTemplates');
  if (action === 'saveRecurringExpenseTemplate') return saveRecurringExpenseTemplate(data, actor);
  if (action === 'updateRecurringExpenseTemplate') return updateRecurringExpenseTemplate(data, actor);
  if (action === 'deleteRecurringExpenseTemplate') return deleteRecurringExpenseTemplate(data);
  if (action === 'confirmRecurringExpense') return confirmRecurringExpense(data, actor);
  if (action === 'deleteMaintenanceLog') {
    const log = db.getCollection('MaintenanceLog');
    const remaining = log.filter((r) => r.logId !== data.logId);
    log.length = 0;
    log.push(...remaining);
    db.persist();
    return { status: 'success' };
  }
  if (READ_MAP[action]) return db.getCollection(READ_MAP[action]);
  if (SHEET_MAP[action]) return handleGenericRecordAction(action, data, actor);

  return { status: 'error', message: 'Action "' + action + '" is not yet available in the local desktop version.' };
}

module.exports = { handleAction };

// ─────────────────────────────────────────────
// PORTING CHECKLIST — actions Code.gs still handles that this file
// doesn't yet. Anything not on this list and not implemented above
// returns the "not yet available" error from handleAction.
//
//   Files: getFileBase64 (attachments), generatePDF — these depend on
//     Google Drive specifically, which has no local equivalent; needs
//     its own design (e.g. local file storage) rather than a straight
//     port, since there's nothing in Code.gs to port FROM for "where
//     do attachments/PDFs live locally"
//   (Users/login/PINs deliberately out of scope for now — see
//   LOCAL_ACTOR above)
// ─────────────────────────────────────────────
