// =========================================================
// MODALS-CORE.JS — Modal System shared helpers (attachments,
//                  avatar photo, image previews)
//                  Staged Payment Helpers (payment schedule UI)
// Load order: 4th
// Depends on: core.js, init.js (populateUnitDropdown)
// =========================================================

// ─────────────────────────────────────────────
// § PAYMENT REQUEST AUTO-UNCHECK
// ─────────────────────────────────────────────
function setupPaymentRequestAutoUncheck() {
  const checkbox = document.getElementById("p_show_payment_request");
  if (!checkbox) return;

  // Function to check if all stages are paid
  const checkAllPaid = () => {
    if (paymentStages.length === 0) return false;
    return paymentStages.every((s) => s.status === "Paid");
  };

  // Auto-uncheck when all stages become paid
  const observer = new MutationObserver(() => {
    if (checkAllPaid()) {
      checkbox.checked = false;
    }
  });

  // Watch the stages container for changes (status dropdowns are re-rendered)
  const container = document.getElementById("stages-table-container");
  if (container) {
    observer.observe(container, { childList: true, subtree: true });
  }

  // Also check immediately in case all are already paid on load
  if (checkAllPaid()) {
    checkbox.checked = false;
  }
}

// ─────────────────────────────────────────────
// § MODAL SYSTEM
// ─────────────────────────────────────────────
function populateModalInlineImageGalleryPreviews(renderBoxId) {
  const box = document.getElementById(renderBoxId);
  if (!box) return;
  if (currentModalFiles.length === 0) {
    box.innerHTML = "";
    box.style.display = "none";
    return;
  }
  box.style.display = "flex";
  box.innerHTML = currentModalFiles
    .map((url, idx) => {
      const isPdf =
        url.toLowerCase().includes(".pdf") ||
        url.toLowerCase().includes("pdf_");
      const content = isPdf
        ? `<div style="width:100%; height:100%; border:2px solid var(--text); border-radius:6px; background:#fff; display:flex; align-items:center; justify-content:center;"><i class="fas fa-file-pdf" style="font-size:24px; color:var(--danger);"></i></div>`
        : `<img src="${escapeHtml(getDirectImageUrl(url))}" style="width:100%; height:100%; object-fit:cover; border:2px solid var(--text); border-radius:6px; margin:0;" alt="Attachment ${idx + 1}">`;
      return `<div style="position:relative; width:60px; height:60px; flex-shrink:0;">
      ${content}
      <div data-modal-action="remove-attachment" data-index="${idx}" data-render-box="${renderBoxId}" style="position:absolute; top:-6px; right:-6px; background:var(--danger); color:white; border:2px solid white; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; cursor:pointer; z-index:10;" role="button" aria-label="Remove">&times;</div>
    </div>`;
    })
    .join("");
}

function removeAttachmentByIndex(index, renderBoxId) {
  currentModalFiles.splice(index, 1);
  populateModalInlineImageGalleryPreviews(renderBoxId);
}

// ─────────────────────────────────────────────
// § MANAGE USERS (admin only — enforced server-side in Code.gs
// regardless of what this UI shows/hides; see checkBusinessPermission).
// Rendered into whichever shell's Settings screen calls it
// (renderUsersList("mobile-user-list") / ("desktop-user-list")).
// ─────────────────────────────────────────────
let lastFetchedUsers = [];

async function renderUsersList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<p style="color:var(--muted); font-size:13px;">Loading team...</p>`;

  const result = await callApi("getUsers", {});

  if (!result || !Array.isArray(result)) {
    container.innerHTML = `<p style="color:var(--danger); font-size:13px; font-weight:700;">${escapeHtml((result && result.message) || "Couldn't load the team list.")}</p>`;
    return;
  }

  lastFetchedUsers = result;

  if (result.length === 0) {
    container.innerHTML = `<p style="color:var(--muted); font-size:13px;">No users yet.</p>`;
    return;
  }

  container.innerHTML = result
    .map(
      (u) => `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid #eee;">
        <div>
          <strong style="font-size:14px;">${escapeHtml(u.name)}</strong>${!u.active ? ` <span style="color:var(--danger); font-size:11px; font-weight:800;">DISABLED</span>` : ""}
          <br><span style="font-size:12px; color:var(--muted); text-transform:capitalize;">${escapeHtml(u.role)}${u.email ? " · " + escapeHtml(u.email) : ""}</span>
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button type="button" data-modal-action="edit-user" data-id="${escapeHtml(u.userId)}" style="background:#f1f3f5; border:1px solid #ccc; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer;">Edit</button>
          <button type="button" data-modal-action="reset-user-pin" data-id="${escapeHtml(u.userId)}" style="background:#f1f3f5; border:1px solid #ccc; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:700; cursor:pointer;">Reset PIN</button>
        </div>
      </div>
    `,
    )
    .join("");
}

function resetUserPin(userId) {
  const newPin = window.prompt("Enter a new PIN (at least 4 digits) for this user:");
  if (newPin === null) return; // cancelled
  const trimmed = newPin.trim();
  if (trimmed.length < 4) {
    showToast("PIN must be at least 4 digits.", "error");
    return;
  }
  callApi("updateUserPin", { userId, pin: trimmed }).then((res) => {
    if (res && res.status === "success") {
      showToast("PIN reset.", "success");
    } else {
      showToast((res && res.message) || "Failed to reset PIN.", "error");
    }
  });
}

// ─────────────────────────────────────────────
// § SERVICE CHARGE LEDGER (manager+ only — see checkBusinessPermission
// in Code.gs; this section is unreachable for staff/viewer both
// because the nav entry is hidden (Login.js) AND because the server
// refuses the underlying getServiceChargeLedger request outright, not
// just a UI restriction).
//
// Deliberately NOT part of the cache/getAllData system — see Code.gs's
// comments on why staff/viewer must never even receive this data —
// so this section fetches and refreshes independently.
// ─────────────────────────────────────────────
let lastFetchedServiceChargeLedger = [];

async function refreshServiceChargeSection() {
  const containerId = isDesktopShell() ? "desktop-sc-ledger" : "mobile-sc-ledger";
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<p style="color:var(--muted); font-size:13px;">Loading ledger...</p>`;
  const result = await callApi("getServiceChargeLedger", {});

  if (!result || !Array.isArray(result)) {
    container.innerHTML = `<p style="color:var(--danger); font-size:13px; font-weight:700;">${escapeHtml((result && result.message) || "Couldn't load the ledger.")}</p>`;
    return;
  }

  lastFetchedServiceChargeLedger = result;
  renderServiceChargeSummary();
  renderServiceChargeLedgerTable(container, result);
}

function renderServiceChargeSummary() {
  const summaryId = isDesktopShell() ? "desktop-sc-summary" : "mobile-sc-summary";
  const el = document.getElementById(summaryId);
  if (!el) return;

  const balances = computeServiceChargeBalancesAsOf(lastFetchedServiceChargeLedger, null);
  const total = Object.values(balances).reduce((sum, v) => sum + v, 0);

  el.innerHTML = `
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
      <div style="flex:1; min-width:160px; background:#fff; border:2px solid #000; border-radius:12px; padding:14px;">
        <div style="font-size:11px; font-weight:900; text-transform:uppercase; color:var(--muted);">Pooled Estate Balance (now)</div>
        <div style="font-size:22px; font-weight:900; margin-top:4px;">₦${formatMoney(total)}</div>
      </div>
      <div style="flex:1; min-width:160px; background:#fff; border:2px solid #000; border-radius:12px; padding:14px;">
        <div style="font-size:11px; font-weight:900; text-transform:uppercase; color:var(--muted);">Apartments With Activity</div>
        <div style="font-size:22px; font-weight:900; margin-top:4px;">${Object.keys(balances).length}</div>
      </div>
    </div>
  `;
}

// A given apartment's balance as of a date = sum of its ledger rows
// dated on or before that date (credits add, debits subtract).
// asOfDate === null means "as of right now" (every row counts). This
// is also what the two Service Charge reports use for opening/closing
// balances — see Reports.js.
function computeServiceChargeBalancesAsOf(ledger, asOfDate) {
  const cutoff = asOfDate ? new Date(asOfDate).getTime() : null;
  const balances = {};
  (ledger || []).forEach((row) => {
    if (!row || !row.apt) return;
    const rowTime = new Date(row.date).getTime();
    if (cutoff !== null && (isNaN(rowTime) || rowTime > cutoff)) return;
    const amt = Number(row.amount) || 0;
    const signed = String(row.direction).toLowerCase() === "credit" ? amt : -amt;
    balances[row.apt] = (balances[row.apt] || 0) + signed;
  });
  return balances;
}

// [FEATURE] apt.status only ever reflects "right now" — a report run
// today has no way to know whether a unit was occupied during some
// past period once its status has since changed. This reconstructs
// occupancy stints from OccupancyLog (auto-populated by Code.gs
// whenever a status actually transitions to/from Occupied) and checks
// whether ANY stint overlaps the given [startDate, endDate] window.
//
// Units with no logged history at all (e.g. they predate this
// feature, or have simply never changed status since) fall back to
// their CURRENT status as a best-effort guess for any period — this
// keeps existing units working sensibly rather than reporting them as
// "never occupied" just because their history starts from whenever
// this feature shipped.
function wasApartmentOccupiedDuringPeriod(apt, occupancyLog, startDate, endDate, currentAptRecord) {
  const events = (occupancyLog || [])
    .filter((e) => e && String(e.apt) === String(apt))
    .map((e) => ({ event: String(e.event || "").toLowerCase(), date: new Date(e.date) }))
    .filter((e) => !isNaN(e.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (events.length === 0) {
    return String(currentAptRecord?.status || currentAptRecord?.Status || "").toLowerCase() === "occupied";
  }

  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  let stintStart = null;
  for (const e of events) {
    if (e.event === "occupied" && stintStart === null) {
      stintStart = e.date;
    } else if (e.event === "vacated" && stintStart !== null) {
      if (stintStart <= rangeEnd && e.date >= rangeStart) return true;
      stintStart = null;
    }
  }
  // Still occupied at the end of the log (no matching "vacated" event
  // yet) — the stint is ongoing, so it overlaps anything from its
  // start onward.
  if (stintStart !== null && stintStart <= rangeEnd) return true;

  return false;
}

function renderServiceChargeLedgerTable(container, ledger) {
  const sorted = [...ledger].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sorted.length === 0) {
    container.innerHTML = `<p style="color:var(--muted); font-size:13px;">No entries yet.</p>`;
    return;
  }

  const typeLabels = { contribution: "Contribution", apartment_expense: "Apartment Expense", shared_expense: "Shared Expense" };
  const typeColors = { contribution: "#198754", apartment_expense: "#dc3545", shared_expense: "#fd7e14" };

  container.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:13px;">
    <thead><tr style="border-bottom:2px solid #000; text-align:left;">
      <th style="padding:8px 6px;">Entry #</th>
      <th style="padding:8px 6px;">Date</th>
      <th style="padding:8px 6px;">Apt</th>
      <th style="padding:8px 6px;">Type</th>
      <th style="padding:8px 6px;">Category</th>
      <th style="padding:8px 6px; text-align:right;">Amount</th>
      <th style="padding:8px 6px;"></th>
    </tr></thead>
    <tbody>
      ${sorted
        .map((row) => {
          const canDelete = isEntrySameCalendarDay(row.createdAt);
          const amountDisplay = `${row.direction === "credit" ? "+" : "-"}₦${formatMoney(row.amount)}`;
          return `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:6px; font-weight:800;">${escapeHtml(row.entryNumber || "—")}</td>
            <td style="padding:6px;">${escapeHtml(formatDateForDisplay(row.date))}</td>
            <td style="padding:6px; font-weight:800;">${escapeHtml(row.apt || "")}</td>
            <td style="padding:6px;"><span style="background:${typeColors[row.type] || "#666"}22; color:${typeColors[row.type] || "#666"}; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:800;">${typeLabels[row.type] || row.type}</span></td>
            <td style="padding:6px;">${escapeHtml(row.category || "")}</td>
            <td style="padding:6px; text-align:right; font-weight:800; color:${row.direction === "credit" ? "#198754" : "#dc3545"};">${amountDisplay}</td>
            <td style="padding:6px; text-align:right; white-space:nowrap;">
              ${canDelete ? `<button type="button" data-modal-action="delete-service-charge-entry" data-id="${escapeHtml(row.entryId)}" style="background:#fdecea; color:#dc3545; border:0; border-radius:6px; padding:4px 8px; font-size:11px; font-weight:700; cursor:pointer;">Delete</button>` : `<span style="color:var(--muted); font-size:11px;">Locked</span>`}
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>`;
}

// Entries can only be deleted the same calendar day they were created
// — mirrors Code.gs's isSameCalendarDay(), which is the actual
// enforcement. This client-side copy only controls whether the Delete
// button shows at all; the server rejects the request regardless.
function isEntrySameCalendarDay(isoString) {
  if (!isoString) return false;
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function deleteServiceChargeLedgerEntry(entryId) {
  if (!window.confirm("Delete this entry? This can't be undone. (If it's part of a shared expense, every apartment's share of that same expense will be removed together.)")) return;
  callApi("deleteServiceChargeEntry", { entryId }).then((result) => {
    if (result && result.status === "success") {
      showToast("Entry deleted.", "success");
      refreshServiceChargeSection();
    } else {
      showToast((result && result.message) || "Failed to delete entry.", "error");
    }
  });
}

// ─────────────────────────────────────────────
// § PETTY CASH (manager+ only — see checkBusinessPermission in
// Code.gs). Independent of the Service Charge ledger and the older
// CashExpenses feature (untouched) — its own sheet, its own running
// balance. A Service Charge Apartment/Shared Expense can optionally
// also create a linked outflow here (see logApartmentExpense/
// logSharedExpense in Code.gs) — that's the only point of contact
// between the two systems; this section otherwise fetches/refreshes
// independently, same reasoning as the Service Charge section.
// ─────────────────────────────────────────────
let lastFetchedPettyCashLedger = [];

async function refreshPettyCashSection() {
  const containerId = isDesktopShell() ? "desktop-pc-ledger" : "mobile-pc-ledger";
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<p style="color:var(--muted); font-size:13px;">Loading ledger...</p>`;
  const result = await callApi("getPettyCashLedger", {});

  if (!result || !Array.isArray(result)) {
    container.innerHTML = `<p style="color:var(--danger); font-size:13px; font-weight:700;">${escapeHtml((result && result.message) || "Couldn't load the ledger.")}</p>`;
    return;
  }

  lastFetchedPettyCashLedger = result;
  renderPettyCashSummary();
  renderPettyCashLedgerTable(container, result);
}

function renderPettyCashSummary() {
  const summaryId = isDesktopShell() ? "desktop-pc-summary" : "mobile-pc-summary";
  const el = document.getElementById(summaryId);
  if (!el) return;

  const balance = computePettyCashBalanceAsOf(lastFetchedPettyCashLedger, null);

  el.innerHTML = `
    <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:14px; margin-bottom:16px;">
      <div style="font-size:11px; font-weight:900; text-transform:uppercase; color:var(--muted);">Petty Cash Balance (now)</div>
      <div style="font-size:22px; font-weight:900; margin-top:4px; color:${balance >= 0 ? "inherit" : "#dc3545"};">₦${formatMoney(balance)}</div>
    </div>
  `;
}

// Balance as of a date = sum of every entry dated on or before it,
// inflow adding and outflow subtracting. asOfDate === null means "as
// of right now." Starts from ₦0 by design — see the conversation this
// was scoped in: existing history predates balance tracking, so
// there's no meaningful opening figure to seed it with.
function computePettyCashBalanceAsOf(ledger, asOfDate) {
  const cutoff = asOfDate ? new Date(asOfDate).getTime() : null;
  let balance = 0;
  [...(ledger || [])]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((row) => {
      if (!row) return;
      const rowTime = new Date(row.date).getTime();
      if (cutoff !== null && (isNaN(rowTime) || rowTime > cutoff)) return;
      const amt = Number(row.amount) || 0;
      balance += String(row.direction).toLowerCase() === "inflow" ? amt : -amt;
    });
  return balance;
}

function renderPettyCashLedgerTable(container, ledger) {
  const sorted = [...ledger].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sorted.length === 0) {
    container.innerHTML = `<p style="color:var(--muted); font-size:13px;">No entries yet.</p>`;
    return;
  }

  // [FEATURE] Running balance shown after every entry — computed
  // chronologically (oldest first) so each row's balance reflects
  // everything up to and including that point, then reversed for
  // display (newest first, matching every other ledger table's
  // convention in this app).
  let running = 0;
  const withBalance = sorted.map((row) => {
    const amt = Number(row.amount) || 0;
    running += String(row.direction).toLowerCase() === "inflow" ? amt : -amt;
    return { ...row, runningBalance: running };
  });
  const displayRows = [...withBalance].reverse();

  container.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:13px;">
    <thead><tr style="border-bottom:2px solid #000; text-align:left;">
      <th style="padding:8px 6px;">Date</th>
      <th style="padding:8px 6px;">Apt</th>
      <th style="padding:8px 6px;">Category</th>
      <th style="padding:8px 6px; text-align:right;">Amount</th>
      <th style="padding:8px 6px; text-align:right;">Balance</th>
      <th style="padding:8px 6px;"></th>
    </tr></thead>
    <tbody>
      ${displayRows
        .map((row) => {
          const canDelete = isEntrySameCalendarDay(row.createdAt);
          const isInflow = String(row.direction).toLowerCase() === "inflow";
          const amountDisplay = `${isInflow ? "+" : "-"}₦${formatMoney(row.amount)}`;
          return `<tr style="border-bottom:1px solid #eee;">
            <td style="padding:6px;">${escapeHtml(formatDateForDisplay(row.date))}</td>
            <td style="padding:6px; font-weight:800;">${escapeHtml(row.apt || "")}</td>
            <td style="padding:6px;">${escapeHtml(row.category || "")}${row.linkedServiceChargeEntry ? ` <span style="color:var(--muted); font-size:11px;">(SC ${escapeHtml(row.linkedServiceChargeEntry)})</span>` : ""}</td>
            <td style="padding:6px; text-align:right; font-weight:800; color:${isInflow ? "#198754" : "#dc3545"};">${amountDisplay}</td>
            <td style="padding:6px; text-align:right; font-weight:800; color:${row.runningBalance >= 0 ? "inherit" : "#dc3545"};">₦${formatMoney(row.runningBalance)}</td>
            <td style="padding:6px; text-align:right; white-space:nowrap;">
              ${canDelete ? `<button type="button" data-modal-action="delete-petty-cash-entry" data-id="${escapeHtml(row.entryId)}" style="background:#fdecea; color:#dc3545; border:0; border-radius:6px; padding:4px 8px; font-size:11px; font-weight:700; cursor:pointer;">Delete</button>` : `<span style="color:var(--muted); font-size:11px;">Locked</span>`}
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>`;
}

function deletePettyCashLedgerEntry(entryId) {
  if (!window.confirm("Delete this entry? This can't be undone.")) return;
  callApi("deletePettyCashEntry", { entryId }).then((result) => {
    if (result && result.status === "success") {
      showToast("Entry deleted.", "success");
      refreshPettyCashSection();
    } else {
      showToast((result && result.message) || "Failed to delete entry.", "error");
    }
  });
}

// ─────────────────────────────────────────────
// § INVENTORY (manager+ only — see checkBusinessPermission in
// Code.gs). Full replacement of the old basic Inventory feature —
// deliberately not part of the cache/getAllData system, same
// reasoning as Service Charge/Petty Cash: staff/viewer must never
// receive this data at all. Issuing stock always automatically
// creates a linked Service Charge entry server-side — nothing to wire
// up client-side for that beyond the issue-stock form itself.
// ─────────────────────────────────────────────
let lastFetchedInventoryItems = [];
let lastFetchedInventoryMovements = [];

async function refreshInventorySection() {
  const containerId = isDesktopShell() ? "desktop-inv-list" : "mobile-inv-list";
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `<p style="color:var(--muted); font-size:13px;">Loading inventory...</p>`;
  const [items, movements] = await Promise.all([
    callApi("getInventoryItems", {}),
    callApi("getInventoryMovements", {}),
  ]);

  if (!items || !Array.isArray(items)) {
    container.innerHTML = `<p style="color:var(--danger); font-size:13px; font-weight:700;">${escapeHtml((items && items.message) || "Couldn't load inventory.")}</p>`;
    return;
  }

  lastFetchedInventoryItems = items;
  lastFetchedInventoryMovements = Array.isArray(movements) ? movements : [];
  renderInventoryDashboard();
  renderInventoryItemList(container, items);
}

function renderInventoryDashboard() {
  const summaryId = isDesktopShell() ? "desktop-inv-summary" : "mobile-inv-summary";
  const el = document.getElementById(summaryId);
  if (!el) return;

  // Dashboard metrics are scoped to consumables — tools don't have a
  // stock quantity/reorder concept, so counting them toward "low
  // stock"/"out of stock" etc wouldn't mean anything.
  const items = lastFetchedInventoryItems || [];
  const consumables = items.filter((i) => i && (i.itemType || "consumable") === "consumable");
  const totalItems = items.length;
  const inStock = consumables.filter((i) => Number(i.currentQty) > 0).length;
  const lowStock = consumables.filter((i) => {
    const qty = Number(i.currentQty) || 0;
    const min = Number(i.minQty) || 0;
    return qty > 0 && qty <= min;
  }).length;
  const outOfStock = consumables.filter((i) => (Number(i.currentQty) || 0) <= 0).length;
  // "Awaiting purchase" is a DISTINCT, earlier threshold than "low
  // stock" — reorderLevel is meant to trigger a purchase before
  // minQty is actually reached, giving lead time to restock.
  const awaitingPurchase = consumables.filter((i) => {
    const qty = Number(i.currentQty) || 0;
    const level = Number(i.reorderLevel) || 0;
    return level > 0 && qty <= level;
  }).length;
  const stockValue = consumables.reduce(
    (sum, i) => sum + (Number(i.currentQty) || 0) * (Number(i.unitCost) || 0),
    0,
  );

  el.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:16px;">
      <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:12px;">
        <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--muted);">Total Items</div>
        <div style="font-size:20px; font-weight:900;">${totalItems}</div>
      </div>
      <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:12px;">
        <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--muted);">In Stock</div>
        <div style="font-size:20px; font-weight:900; color:#198754;">${inStock}</div>
      </div>
      <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:12px;">
        <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--muted);">Low Stock</div>
        <div style="font-size:20px; font-weight:900; color:#fd7e14;">${lowStock}</div>
      </div>
      <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:12px;">
        <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--muted);">Out of Stock</div>
        <div style="font-size:20px; font-weight:900; color:#dc3545;">${outOfStock}</div>
      </div>
      <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:12px;">
        <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--muted);">Awaiting Purchase</div>
        <div style="font-size:20px; font-weight:900; color:#dc3545;">${awaitingPurchase}</div>
      </div>
      <div style="background:#fff; border:2px solid #000; border-radius:12px; padding:12px;">
        <div style="font-size:10px; font-weight:900; text-transform:uppercase; color:var(--muted);">Stock Value</div>
        <div style="font-size:15px; font-weight:900;">₦${formatMoney(stockValue)}</div>
      </div>
    </div>
  `;
}

function populateInventoryItemDropdown(selectId, currentValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choose Item --</option>';
  (lastFetchedInventoryItems || [])
    .filter((i) => i && (i.itemType || "consumable") === "consumable")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    .forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.itemCode;
      opt.textContent = `${item.name} (${item.itemCode}) — ${item.currentQty || 0} ${item.unit || ""} in stock`;
      if (currentValue && String(item.itemCode) === String(currentValue)) opt.selected = true;
      sel.appendChild(opt);
    });
}

function renderInventoryItemList(container, items) {
  const sorted = [...items].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (sorted.length === 0) {
    container.innerHTML = `<p style="color:var(--muted); font-size:13px;">No items yet.</p>`;
    return;
  }

  container.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:13px;">
    <thead><tr style="border-bottom:2px solid #000; text-align:left;">
      <th style="padding:8px 6px;">Code</th>
      <th style="padding:8px 6px;">Item</th>
      <th style="padding:8px 6px;">Category</th>
      <th style="padding:8px 6px; text-align:right;">Qty</th>
      <th style="padding:8px 6px; text-align:right;">Unit Cost</th>
      <th style="padding:8px 6px;">Status</th>
      <th style="padding:8px 6px;"></th>
    </tr></thead>
    <tbody>
      ${sorted
        .map((item) => {
          const qty = Number(item.currentQty) || 0;
          const min = Number(item.minQty) || 0;
          const level = Number(item.reorderLevel) || 0;
          const isTool = (item.itemType || "consumable") === "tool";
          let stockBadge = "";
          if (!isTool) {
            if (qty <= 0) stockBadge = `<span style="color:#dc3545; font-weight:800; font-size:11px;">OUT OF STOCK</span>`;
            else if (qty <= min) stockBadge = `<span style="color:#fd7e14; font-weight:800; font-size:11px;">LOW</span>`;
            else if (level > 0 && qty <= level) stockBadge = `<span style="color:#dc3545; font-weight:800; font-size:11px;">REORDER</span>`;
            else stockBadge = `<span style="color:#198754; font-weight:800; font-size:11px;">OK</span>`;
          }
          return `<tr style="border-bottom:1px solid #eee; cursor:pointer;" data-modal-action="view-inventory-item-timeline" data-id="${escapeHtml(item.itemCode)}">
            <td style="padding:6px; font-weight:800;">${escapeHtml(item.itemCode)}</td>
            <td style="padding:6px;">${escapeHtml(item.name || "")}${isTool ? ` <span style="color:var(--muted); font-size:11px;">(Tool)</span>` : ""}</td>
            <td style="padding:6px;">${escapeHtml(item.category || "")}</td>
            <td style="padding:6px; text-align:right; font-weight:700;">${isTool ? "—" : qty + " " + escapeHtml(item.unit || "")}</td>
            <td style="padding:6px; text-align:right;">${isTool ? "—" : "₦" + formatMoney(item.unitCost || 0)}</td>
            <td style="padding:6px;">${stockBadge}</td>
            <td style="padding:6px; text-align:right;"><i class="fas fa-chevron-right" style="color:var(--muted);"></i></td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table></div>`;
}

function viewInventoryItemTimeline(itemCode) {
  const item = (lastFetchedInventoryItems || []).find((i) => String(i.itemCode) === String(itemCode));
  if (!item) {
    showToast("Item not found.", "error");
    return;
  }
  openModal("inventorytimeline", item);
}

// ─────────────────────────────────────────────
// § DELEGATED CLICK HANDLING (modal body)
// #modalBody markup (here and in Modals-forms.js) uses data-modal-action
// attributes instead of inline onclick="..." strings, matching the
// pattern used for record cards in Records.js/desktop.js — see those
// files for the full rationale.
// ─────────────────────────────────────────────
function handleModalContentClick(event) {
  const actionEl = event.target.closest("[data-modal-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.modalAction;
  const id = actionEl.dataset.id;

  switch (action) {
    case "remove-attachment":
      removeAttachmentByIndex(Number(actionEl.dataset.index), actionEl.dataset.renderBox);
      break;
    case "add-payment-stage":
      addPaymentStageRow();
      break;
    case "remove-stage-row":
      removeStageRow(Number(actionEl.dataset.index));
      break;
    case "edit-maintenance-log":
      startEditMaintenanceLogEntry(actionEl.dataset.logId, actionEl.dataset.assetTag);
      break;
    case "delete-maintenance-log":
      deleteMaintenanceLogEntry(actionEl.dataset.logId, actionEl.dataset.assetTag);
      break;
    case "cancel-edit-maintenance-log":
      cancelEditMaintenanceLogEntry();
      break;
    case "open-linked-payment":
      openLinkedPayment(id);
      break;
    case "open-linked-work-order":
      openLinkedWorkOrderFromPayment(id);
      break;
    case "clear-avatar-photo":
      clearAvatarPhotoFrame();
      break;
    case "edit-user": {
      const user = lastFetchedUsers.find((u) => u.userId === actionEl.dataset.id);
      if (user) openModal("user", user);
      break;
    }
    case "reset-user-pin":
      resetUserPin(actionEl.dataset.id);
      break;
    case "delete-service-charge-entry":
      deleteServiceChargeLedgerEntry(actionEl.dataset.id);
      break;
    case "delete-petty-cash-entry":
      deletePettyCashLedgerEntry(actionEl.dataset.id);
      break;
    case "view-inventory-item-timeline":
      viewInventoryItemTimeline(actionEl.dataset.id);
      break;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", handleModalContentClick);
}

function clearAvatarPhotoFrame() {
  currentAvatarPhoto = "";
  const frame =
    document.getElementById("passport_frame_view") ||
    document.getElementById("vendor_frame_view");
  if (frame)
    frame.src =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='50' height='50'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%236c757d'/%3E%3C/svg%3E";
  const btn = document.getElementById("p_avatar_remove_btn");
  if (btn) btn.style.display = "none";
}

// Compress PDF base64 by stripping non-essential objects (best-effort)
async function compressPdfToTarget(base64Str, targetBytes) {
  // For PDFs we can't do true recompression in browser easily.
  // Strategy: if it's a data URI, keep only the data portion.
  // If still too large, reject (user must supply smaller source).
  let data = base64Str;
  if (data.includes(",")) data = data.split(",")[1];

  // Attempt to remove common PDF bloat: embedded full fonts, metadata streams
  // This is a lightweight regex-based cleanup — not a true PDF recompressor
  let decoded;
  try {
    decoded = atob(data);
  } catch (e) {
    return base64Str;
  }

  // Remove PDF metadata and some non-essential objects
  decoded = decoded
    .replace(/\/Metadata\s*\d+\s*\d+\s*obj[\s\S]*?endobj/g, "")
    .replace(/\/OpenAction[\s\S]*?>>/g, ">>")
    .replace(/\/JavaScript[\s\S]*?>>/g, ">>")
    .replace(/\/RichMedia[\s\S]*?>>/g, ">>")
    .replace(/\/EmbeddedFile[\s\S]*?>>/g, ">>")
    .replace(/\/AFRelationship[\s\S]*?\/F /g, "/F ");

  const cleaned = "data:application/pdf;base64," + btoa(decoded);
  // If still over target, we can't compress further without a proper PDF library
  if (cleaned.length > targetBytes * 1.35) {
    showToast(
      "PDF could not be compressed below 300KB. Please use a smaller file.",
      "error",
    );
  }
  return cleaned;
}

function processIncomingMultiAttachments(filesList, previewTargetId) {
  if (!filesList || filesList.length === 0) return;
  Array.from(filesList).forEach((file) => {
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      // Always compress PDFs. Target max 300KB after compression.
      const MAX_PDF_SIZE = 300 * 1024; // 300KB
      const reader = new FileReader();
      reader.onload = async (evt) => {
        let base64 = evt.target.result;
        // If over limit, attempt basic compression by re-encoding
        if (base64.length > MAX_PDF_SIZE * 1.35) {
          // base64 is ~1.35x binary
          showToast(
            `PDF "${file.name}" is large (${(file.size / 1024).toFixed(0)}KB). Compressing...`,
            "warning",
          );
          // Re-encode to strip unnecessary metadata (best-effort for PDFs)
          base64 = await compressPdfToTarget(base64, MAX_PDF_SIZE);
        }
        const finalSize = Math.round(base64.length * 0.75);
        if (finalSize > MAX_PDF_SIZE) {
          showToast(
            `PDF "${file.name}" still exceeds 300KB after compression (${(finalSize / 1024).toFixed(0)}KB). Try a smaller file or reduce pages.`,
            "error",
          );
          return;
        }
        const name =
          "pdf_" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9.]/g, "_");
        callApi("uploadImage", { base64: base64, name }).then((res) => {
          if (res?.url) {
            currentModalFiles.push(res.url);
            populateModalInlineImageGalleryPreviews(previewTargetId);
          }
        });
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        let base64 = evt.target.result;
        if (file.size > 200 * 1024)
          base64 = await compressImageToTargetLimit(evt.target.result, 185000);
        const name =
          "img_" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9.]/g, "_");
        callApi("uploadImage", { base64, name }).then((res) => {
          if (res?.url) {
            currentModalFiles.push(res.url);
            populateModalInlineImageGalleryPreviews(previewTargetId);
          }
        });
      };
      reader.readAsDataURL(file);
    }
  });
}

// ─────────────────────────────────────────────
// § STAGED PAYMENT HELPERS
// ─────────────────────────────────────────────
let paymentStages = []; // in-modal state for staged payment editing

const STAGE_PRESETS = [
  "Mobilisation",
  "Progress Claim 1",
  "Progress Claim 2",
  "Retention Release",
  "Final Payment",
  "Materials Supply",
  "Labour Cost",
  "Variation Order",
];

function initPaymentStages(existingStagesJson) {
  if (existingStagesJson) {
    try {
      paymentStages = JSON.parse(existingStagesJson);
      return;
    } catch (e) {}
  }
  paymentStages = [
    { label: "Mobilisation", amount: "", status: "Pending" },
    { label: "Final Payment", amount: "", status: "Pending" },
  ];
}

function computeStageWarnings(totalJobValue) {
  const stageTotal = paymentStages.reduce(
    (sum, s) => sum + (parseFloat(s.amount) || 0),
    0,
  );
  const unallocated = totalJobValue - stageTotal;

  // Specific rule: Mobilisation + Final Payment combined must not exceed Total Contract Value
  const mobilisation = paymentStages.find(
    (s) => String(s.label).trim().toLowerCase() === "mobilisation",
  );
  const finalPayment = paymentStages.find(
    (s) => String(s.label).trim().toLowerCase() === "final payment",
  );
  const mobAmount = parseFloat(mobilisation?.amount) || 0;
  const finalAmount = parseFloat(finalPayment?.amount) || 0;
  const mobFinalTotal = mobAmount + finalAmount;
  const mobFinalExceeds = totalJobValue > 0 && mobFinalTotal > totalJobValue;

  return { stageTotal, unallocated, mobFinalTotal, mobFinalExceeds };
}

// Full structural re-render: rebuilds all row DOM. Only call this when rows are
// added/removed or on initial render — NOT on every keystroke, since rebuilding
// the inputs mid-typing steals focus from whichever field the user is in.
function renderPaymentStagesTable() {
  const container = document.getElementById("stages-table-container");
  if (!container) return;

  const totalJobValue =
    parseFloat(document.getElementById("p_total_job")?.value || 0) || 0;
  const { stageTotal, unallocated, mobFinalTotal, mobFinalExceeds } =
    computeStageWarnings(totalJobValue);

  container.innerHTML = `
    <div style="background:#f8f9fa; border:2px solid var(--border); border-radius:12px; padding:12px; margin:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong style="font-size:14px; text-transform:uppercase; color:var(--text);">Payment Schedule</strong>
        <button data-modal-action="add-payment-stage" type="button" style="background:var(--primary); color:#fff; border:none; border-radius:8px; padding:6px 12px; font-size:13px; font-weight:800; cursor:pointer;"><i class="fas fa-plus"></i> Add Stage</button>
      </div>

      <div id="stages-rows">
        ${paymentStages
          .map(
            (stage, idx) => `
          <div style="display:grid; grid-template-columns:1fr 90px 80px 32px; gap:6px; align-items:center; margin-bottom:6px;">
            <input list="stage-presets" value="${escapeHtml(stage.label)}" placeholder="Stage label" oninput="updateStageField(${idx}, 'label', this.value, false)" onchange="refreshPaymentRequestDropdown()"
              style="padding:8px 10px; border:2px solid var(--border); border-radius:8px; font-size:15px; font-weight:600; background:white; color:black;">
            <input type="number" value="${escapeHtml(stage.amount)}" placeholder="Amount" oninput="updateStageField(${idx}, 'amount', this.value, false)"
              style="padding:8px 8px; border:2px solid var(--border); border-radius:8px; font-size:15px; font-weight:600; background:white; color:black;">
            <select onchange="updateStageField(${idx}, 'status', this.value, true)"
              style="padding:8px 4px; border:2px solid ${stage.status === "Paid" ? "var(--success)" : stage.status === "Partial" ? "var(--warning)" : "var(--border)"}; border-radius:8px; font-size:13px; font-weight:700; background:${stage.status === "Paid" ? "#e8f5e9" : stage.status === "Partial" ? "#fff8e1" : "white"}; color:black;">
              <option value="Pending" ${stage.status === "Pending" ? "selected" : ""}>Pending</option>
              <option value="Partial" ${stage.status === "Partial" ? "selected" : ""}>Partial</option>
              <option value="Paid" ${stage.status === "Paid" ? "selected" : ""}>Paid</option>
            </select>
            <button data-modal-action="remove-stage-row" data-index="${idx}" type="button" style="background:var(--danger); color:white; border:none; border-radius:6px; width:32px; height:32px; cursor:pointer; font-size:14px;">×</button>
          </div>
        `,
          )
          .join("")}
      </div>

      <datalist id="stage-presets">
        ${STAGE_PRESETS.map((p) => `<option value="${escapeHtml(p)}">`).join("")}
      </datalist>

      <div id="stages-summary-block">${renderStagesSummaryHtml(stageTotal, unallocated, mobFinalTotal, mobFinalExceeds, totalJobValue)}</div>

      <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;" id="stages-status-chips">
        ${paymentStages.map((s) => `<span style="padding:3px 8px; border-radius:12px; font-size:11px; font-weight:800; background:${s.status === "Paid" ? "var(--success)" : s.status === "Partial" ? "var(--warning)" : "#e9ecef"}; color:${s.status === "Paid" ? "#fff" : s.status === "Partial" ? "#333" : "#666"};">${escapeHtml(s.label)}: ${s.status}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderStagesSummaryHtml(
  stageTotal,
  unallocated,
  mobFinalTotal,
  mobFinalExceeds,
  totalJobValue,
) {
  return `
    <div style="border-top:2px solid var(--border); margin-top:8px; padding-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      <div style="text-align:center; background:#fff; border:1px solid var(--border); border-radius:8px; padding:8px;">
        <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Stage Total</div>
        <div style="font-size:18px; font-weight:900; color:var(--primary);">₦${formatMoney(stageTotal)}</div>
      </div>
      <div style="text-align:center; background:${unallocated < 0 ? "#fdecea" : "#fff"}; border:1px solid ${unallocated < 0 ? "var(--danger)" : "var(--border)"}; border-radius:8px; padding:8px;">
        <div style="font-size:11px; font-weight:700; color:${unallocated < 0 ? "var(--danger)" : "var(--muted)"}; text-transform:uppercase;">Unallocated</div>
        <div style="font-size:18px; font-weight:900; color:${unallocated < 0 ? "var(--danger)" : "var(--success)"};">₦${formatMoney(Math.abs(unallocated))}</div>
      </div>
    </div>
    ${
      mobFinalExceeds
        ? `
      <div style="margin-top:8px; background:#fdecea; border:2px solid var(--danger); border-radius:8px; padding:8px 10px; display:flex; align-items:center; gap:8px;">
        <i class="fas fa-exclamation-triangle" style="color:var(--danger); font-size:16px;"></i>
        <div style="font-size:12px; font-weight:700; color:#842029;">Mobilisation + Final Payment (₦${formatMoney(mobFinalTotal)}) exceeds Total Contract Value (₦${formatMoney(totalJobValue)}). Adjust amounts before saving.</div>
      </div>
    `
        : ""
    }
  `;
}

// Lightweight update: patches in-memory state and refreshes only the summary
// numbers/warnings via targeted DOM updates, WITHOUT touching the input
// elements themselves. This is what runs on every keystroke so focus is
// never lost. `structural` (true for status changes) triggers a full
// re-render instead, since status drives border/background colors that are
// only set at render time — that's an intentional, infrequent re-render
// (user selecting from a dropdown, not typing).
function updateStageField(idx, field, value, structural) {
  if (!paymentStages[idx]) return;
  paymentStages[idx][field] = value;

  if (structural) {
    renderPaymentStagesTable();
    refreshPaymentRequestDropdown();
    syncPaymentAmountFromRequestSelection();
    return;
  }

  const totalJobValue =
    parseFloat(document.getElementById("p_total_job")?.value || 0) || 0;
  const { stageTotal, unallocated, mobFinalTotal, mobFinalExceeds } =
    computeStageWarnings(totalJobValue);

  const summaryBlock = document.getElementById("stages-summary-block");
  if (summaryBlock)
    summaryBlock.innerHTML = renderStagesSummaryHtml(
      stageTotal,
      unallocated,
      mobFinalTotal,
      mobFinalExceeds,
      totalJobValue,
    );

  const chipsBlock = document.getElementById("stages-status-chips");
  if (chipsBlock) {
    chipsBlock.innerHTML = paymentStages
      .map(
        (s) =>
          `<span style="padding:3px 8px; border-radius:12px; font-size:11px; font-weight:800; background:${s.status === "Paid" ? "var(--success)" : s.status === "Partial" ? "var(--warning)" : "#e9ecef"}; color:${s.status === "Paid" ? "#fff" : s.status === "Partial" ? "#333" : "#666"};">${escapeHtml(s.label)}: ${s.status}</span>`,
      )
      .join("");
  }

  // Keep the displayed Amount in sync if the edited stage is the one currently selected
  syncPaymentAmountFromRequestSelection();
}

// Called when the Total Contract Value field itself changes (oninput on p_total_job).
// Updates only the summary numbers — the row inputs aren't touched.
function refreshStagesSummaryOnly() {
  const totalJobValue =
    parseFloat(document.getElementById("p_total_job")?.value || 0) || 0;
  const { stageTotal, unallocated, mobFinalTotal, mobFinalExceeds } =
    computeStageWarnings(totalJobValue);
  const summaryBlock = document.getElementById("stages-summary-block");
  if (summaryBlock)
    summaryBlock.innerHTML = renderStagesSummaryHtml(
      stageTotal,
      unallocated,
      mobFinalTotal,
      mobFinalExceeds,
      totalJobValue,
    );
}

// Rebuilds the Payment Request dropdown options from the current paymentStages array.
// Called after any structural change (add/remove row, initial render, status change).
// `selectedLabel` is the value to pre-select (from saved editData on modal open).
function refreshPaymentRequestDropdown(selectedLabel = "") {
  const sel = document.getElementById("p_payment_request");
  if (!sel) return;
  const current = selectedLabel || sel.value; // preserve current selection if already set
  sel.innerHTML = '<option value="">-- Select Stage --</option>';
  paymentStages.forEach((s) => {
    if (!s.label || !s.label.trim()) return;
    const opt = document.createElement("option");
    opt.value = s.label.trim();
    opt.textContent = s.label.trim();
    if (
      current &&
      s.label.trim().toLowerCase() === current.trim().toLowerCase()
    )
      opt.selected = true;
    sel.appendChild(opt);
  });
}

function addPaymentStageRow() {
  paymentStages.push({ label: "New Stage", amount: "", status: "Pending" });
  renderPaymentStagesTable();
  refreshPaymentRequestDropdown();
}

function removeStageRow(idx) {
  paymentStages.splice(idx, 1);
  renderPaymentStagesTable();
  refreshPaymentRequestDropdown();
  syncPaymentAmountFromRequestSelection();
}

// Returns true if the schedule is valid, false (and shows a toast) if not.
// Call this before allowing the payment record to be saved.
function validatePaymentStages() {
  const totalJobValue =
    parseFloat(document.getElementById("p_total_job")?.value || 0) || 0;
  const { mobFinalTotal, mobFinalExceeds } =
    computeStageWarnings(totalJobValue);
  if (mobFinalExceeds) {
    showToast(
      `Mobilisation + Final Payment (₦${formatMoney(mobFinalTotal)}) cannot exceed Total Contract Value (₦${formatMoney(totalJobValue)}).`,
      "error",
    );
    return false;
  }
  return true;
}

// Reads the "Payment Request" dropdown (Mobilisation / Final Payment) and writes
// that stage's amount into the hidden p_amount field, which is what actually gets
// saved and is what the printed Disbursement Details section displays.
function syncPaymentAmountFromRequestSelection() {
  const requestEl = document.getElementById("p_payment_request");
  const amountEl = document.getElementById("p_amount");
  if (!requestEl || !amountEl) return;

  const selectedLabel = requestEl.value;
  if (!selectedLabel) {
    amountEl.value = "";
    return;
  }

  const matchedStage = paymentStages.find(
    (s) =>
      String(s.label).trim().toLowerCase() ===
      selectedLabel.trim().toLowerCase(),
  );
  amountEl.value = matchedStage ? matchedStage.amount || "" : "";
}

// ─────────────────────────────────────────────
