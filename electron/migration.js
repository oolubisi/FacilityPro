// migration.js — One-time import of existing data from Google Sheets
// (via the exportAllForMigration action added to Code.gs) into the
// local JSON store. This is the last thing Apps Script is ever used
// for; after a successful migration, nothing in the app calls out to
// it again.
//
// Runs in the Electron main process — reuses the same GAS_URL/API_
// TOKEN constants Core.js has always used for the live network path,
// just for one final fetch instead of the ongoing request/response
// cycle those existed to make reliable.

const db = require('./db');

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxG8ubpGZdJtvY61-wmVw2O9J6NOwstoQQ4SMsXq0JMsttXf61dKwSrbEVfcBPQysmY/exec';
const API_TOKEN = '38f1f6e7-86f7-4a27-bffe-96303db14298';

// Collections that map straight across — same name on both sides,
// since db.js's schema was deliberately named to match Code.gs's
// sheet names exactly, and no transformation is needed: dates arrive
// from Apps Script as plain ISO strings already, the same shape the
// local write actions store them as.
const DIRECT_COPY_COLLECTIONS = [
  'Apartments', 'Assets', 'Maintenance', 'Utilities', 'Staff', 'Vendors',
  'Payments', 'MaintenanceLog', 'EnergyLedger', 'InventoryItems',
  'InventoryMovements', 'OccupancyLog', 'PettyCash',
  'RecurringExpenseTemplates', 'ServiceChargeBudgets', 'ServiceChargeLedger',
  'Users',
];

// Returns { status: 'success', counts: {...} } or { status: 'error', message }.
// Never throws — every failure path returns an error result instead,
// since this is invoked over IPC and the renderer needs a result to
// show, not an unhandled rejection.
async function runMigration() {
  let response;
  try {
    response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'exportAllForMigration', token: API_TOKEN }),
    });
  } catch (err) {
    return { status: 'error', message: 'Could not reach the existing cloud backend: ' + String(err && err.message ? err.message : err) };
  }

  if (!response.ok) {
    return { status: 'error', message: 'Cloud backend returned HTTP ' + response.status + '. Check your internet connection and try again.' };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    return { status: 'error', message: 'Cloud backend returned an unreadable response.' };
  }

  if (payload && payload.status === 'error') {
    return { status: 'error', message: payload.message || 'The export action returned an error.' };
  }
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', message: 'The export action returned no usable data.' };
  }

  const counts = {};
  DIRECT_COPY_COLLECTIONS.forEach((name) => {
    const rows = Array.isArray(payload[name]) ? payload[name] : [];
    const target = db.getCollection(name);
    target.length = 0;
    target.push(...rows);
    counts[name] = rows.length;
  });

  // Settings is the one non-array collection — a single object of
  // named fields, not a list of rows.
  const settingsTarget = db.getCollection('Settings');
  const importedSettings = (payload.Settings && typeof payload.Settings === 'object') ? payload.Settings : {};
  Object.keys(settingsTarget).forEach((key) => delete settingsTarget[key]);
  Object.assign(settingsTarget, importedSettings);

  db.persist();

  return { status: 'success', counts };
}

module.exports = { runMigration };
