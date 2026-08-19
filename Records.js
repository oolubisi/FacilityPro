// =========================================================
// RECORDS.JS — Search/Filter · Record Opening · Expense Actions
//              Data Refresh & Render Pipeline · List Renderers
// Load order: 3rd
// Depends on: core.js, init.js (refreshData calls, showPage)
// =========================================================

// § SEARCH & FILTER
// ─────────────────────────────────────────────
const filterList = debounce((pageType, query) => {
  const containerMap = {
    apartments: "apt-list",
    assets: "asset-list",
    maintenance: "maint-list",
    workorders: "wo-list",
    inventory: "inventory-list",
    payments: "payment-list",
    staff: "staff-list",
    vendors: "vendor-list",
  };
  const containerId = containerMap[pageType];
  if (!containerId) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  const q = query.toLowerCase().trim();
  let visibleCount = 0;
  container.querySelectorAll(".card").forEach((card) => {
    const visible = card.textContent.toLowerCase().includes(q);
    card.style.display = visible ? "" : "none";
    if (visible) visibleCount++;
  });
  const emptyEl = document.getElementById(
    containerId.replace("-list", "-empty"),
  );
  if (emptyEl)
    emptyEl.style.display = visibleCount === 0 && q === "" ? "block" : "none";
}, 250);

// Cross-entity search shown on the dashboard — distinct from the per-page
// filterList() above, which only filters within the currently open list.
const GLOBAL_SEARCH_SOURCES = [
  { type: "apartment", key: "apts", idFn: (i) => getUnitNumber(i), titleFn: (i) => `Unit ${getUnitNumber(i)}`, subFn: (i) => i.tenant || i.Tenant || "" },
  { type: "asset", key: "assets", idFn: (i) => i.tag || i.Tag, titleFn: (i) => i.type || i.Type || i.tag || "Asset", subFn: (i) => i.loc || i.Loc || "" },
  { type: "maintenance", key: "tickets", idFn: (i) => i.ticketId || i.TicketId, titleFn: (i) => i.category || i.Category || "Ticket", subFn: (i) => i.description || i.Description || "" },
  { type: "workorder", key: "workorders", idFn: (i) => i.workOrderId || i.WorkOrderId, titleFn: (i) => i.assigned || i.Assigned || "Work Order", subFn: (i) => i.description || i.Description || "" },
  { type: "inventory", key: "inventory", idFn: (i) => i.itemId || i.ItemId, titleFn: (i) => i.name || i.Name || "Item", subFn: (i) => i.category || i.Category || "" },
  { type: "vendor", key: "vendors", idFn: (i) => i.rowId || i.RowId, titleFn: (i) => i.company || i.Company || "Vendor", subFn: (i) => i.trade || i.Trade || "" },
  { type: "staff", key: "staff", idFn: (i) => i.rowId || i.RowId, titleFn: (i) => i.name || i.Name || "Staff", subFn: (i) => i.role || i.Role || "" },
  { type: "payment", key: "payments", idFn: (i) => i.paymentId || i.PaymentId, titleFn: (i) => i.party || i.Party || "Payment", subFn: (i) => i.reason || i.Reason || "" },
  { type: "expenserequest", key: "expenseRequests", idFn: (i) => i.reqId, titleFn: (i) => i.job || i.Job || "Expense Request", subFn: (i) => `\u20a6${formatMoney(i.cost || i.Cost || 0)}` },
];

const GLOBAL_SEARCH_TYPE_LABELS = {
  apartment: "Apartment",
  asset: "Asset",
  maintenance: "Ticket",
  workorder: "Work Order",
  inventory: "Inventory",
  vendor: "Vendor",
  staff: "Staff",
  payment: "Payment",
  expenserequest: "Expense Request",
};

const performGlobalSearch = debounce((rawQuery) => {
  const query = String(rawQuery || "").trim().toLowerCase();
  const resultsEl = document.getElementById("global-search-results");
  const emptyEl = document.getElementById("global-search-empty-state");
  const navGrid = document.querySelector("#view-dashboard .nav-grid");
  const alertBanner = document.getElementById("pms-alert-banner");
  if (!resultsEl) return;

  if (!query) {
    resultsEl.style.display = "none";
    resultsEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "none";
    if (navGrid) navGrid.style.display = "";
    if (alertBanner) alertBanner.style.display = "";
    return;
  }

  if (navGrid) navGrid.style.display = "none";
  if (alertBanner) alertBanner.style.display = "none";

  const matches = [];
  GLOBAL_SEARCH_SOURCES.forEach(({ type, key, idFn, titleFn, subFn }) => {
    (cache[key] || []).forEach((item) => {
      if (!item) return;
      const haystack = Object.values(item).join(" ").toLowerCase();
      if (haystack.includes(query)) {
        matches.push({
          type,
          id: idFn(item),
          title: titleFn(item) || "Untitled",
          subtitle: subFn(item) || "",
        });
      }
    });
  });

  if (matches.length === 0) {
    resultsEl.style.display = "none";
    resultsEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";
  resultsEl.style.display = "block";
  resultsEl.innerHTML = matches
    .slice(0, 50)
    .map(
      (m) => `<div class="card" data-action="open-record" data-record-type="${m.type}" data-id="${escapeHtml(String(m.id || ""))}">
        <span style="display:inline-block; background:var(--primary); color:#fff; font-size:10px; font-weight:800; text-transform:uppercase; padding:2px 8px; border-radius:10px; margin-bottom:6px;">${GLOBAL_SEARCH_TYPE_LABELS[m.type] || m.type}</span>
        <div style="font-weight:800; font-size:16px;">${escapeHtml(m.title)}</div>
        ${m.subtitle ? `<div style="color:var(--muted); font-size:13px; margin-top:2px;">${escapeHtml(m.subtitle)}</div>` : ""}
      </div>`,
    )
    .join("");
}, 250);

// ─────────────────────────────────────────────
// § DELEGATED CLICK HANDLING
// Card markup below uses data-action/data-record-type/data-id attributes
// instead of inline onclick="..." strings. One listener here handles all
// of it — event.target.closest('[data-action]') always finds the most
// specific element first, so a click on a nested button (e.g. "Print")
// never also triggers the card's own "open record" action; no manual
// event.stopPropagation() calls are needed in the markup anymore.
// ─────────────────────────────────────────────
function handleRecordListClick(event) {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;

  switch (action) {
    case "open-record":
      openRecordRow(actionEl.dataset.recordType, id);
      break;
    case "expense-create-wo":
      processExpenseAction("CREATE_WO", id);
      break;
    case "expense-create-cash":
      processExpenseAction("CREATE_CASH", id);
      break;
    case "expense-delete":
      processExpenseAction("DELETE", id);
      break;
    case "print-expense-request":
      printSingleExpenseRequestDirect(id);
      break;
    case "print-cash-expense":
      printSingleCashExpenseDirect(id);
      break;
    case "print-work-order-text":
      printSingleWorkOrderDirect(id, false);
      break;
    case "print-work-order-full":
      printSingleWorkOrderDirect(id, true);
      break;
    case "toggle-payment-request":
      togglePaymentRequestVisibility(id, actionEl);
      break;
    case "print-payment":
      printSinglePaymentDirect(id);
      break;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", handleRecordListClick);
}

// ─────────────────────────────────────────────
// § RECORD OPENING
// ─────────────────────────────────────────────
function openRecordRow(type, lookupId) {
  if (!lookupId) return;
  const id = String(lookupId);
  const find = (arr, keyFn) => arr?.find((i) => i && String(keyFn(i)) === id);
  const matchers = {
    apartment: () => find(cache.apts, getUnitNumber),
    asset: () => find(cache.assets, (i) => i.tag || i.Tag || i.TAG),
    maintenance: () =>
      find(cache.tickets, (i) => i.ticketId || i.TicketId || i.TICKETID),
    staff: () => find(cache.staff, (i) => i.rowId || i.RowId || i.ROWID),
    vendor: () => find(cache.vendors, (i) => i.rowId || i.RowId || i.ROWID),
    workorder: () =>
      find(
        cache.workorders,
        (i) => i.workOrderId || i.WorkOrderId || i.WORKORDERID,
      ),
    inventory: () =>
      find(cache.inventory, (i) => i.itemId || i.ItemId || i.ITEMID),
    payment: () => find(cache.payments, (i) => i.paymentId || i.PaymentId),
    expenserequest: () => find(cache.expenseRequests, (i) => i.reqId),
    cashexpense: () => find(cache.cashExpenses, (i) => i.cashId),
    utility: () => find(cache.utilities, (i) => i.rowId || i.id || i._tempId),
    generator: () => find(cache.utilities, (i) => i.rowId || i.id || i._tempId),
  };
  const match = matchers[type]?.();
  if (match) openModal(type, match);
}

// ─────────────────────────────────────────────
// § EXPENSE ACTIONS
// ─────────────────────────────────────────────
function processExpenseAction(actionType, reqId) {
  const req = cache.expenseRequests.find((r) => r && r.reqId === reqId);
  if (!req) return;
  if (actionType === "DELETE") {
    if (confirm("Permanently delete this request?")) {
      callApi("deleteExpenseRequest", { reqId }).then(() => {
        showToast("Request deleted", "success");
        refreshData("expenserequests");
      });
    }
  } else if (actionType === "CREATE_WO") {
    openModal("workorder", {
      apt: req.apt,
      description: req.job,
      amount: req.cost,
      asset: req.assetTag,
    });
  } else if (actionType === "CREATE_CASH") {
    openModal("cashexpense", {
      amount: req.cost,
      description: req.job,
      apt: req.apt,
    });
  }
}

// ─────────────────────────────────────────────
// § PAYMENT REQUEST VISIBILITY TOGGLE
// ─────────────────────────────────────────────
function togglePaymentRequestVisibility(paymentId, labelEl) {
  const checkbox = labelEl.querySelector('input[type="checkbox"]');
  const newValue = checkbox.checked;

  // Update local cache immediately
  const payment = cache.payments.find(
    (p) => p && String(p.paymentId || p.PaymentId) === paymentId,
  );
  if (payment) {
    payment.showPaymentRequest = newValue;
    payment.ShowPaymentRequest = newValue;
  }

  // Sync to backend
  callApi("updatePayment", {
    paymentId: paymentId,
    showPaymentRequest: newValue,
  })
    .then(() => {
      showToast(
        newValue
          ? "Payment Request visible on printout"
          : "Payment Request hidden from printout",
        "success",
      );
    })
    .catch(() => {
      showToast("Failed to update visibility", "error");
      // Revert checkbox on failure
      checkbox.checked = !newValue;
    });
}

// ─────────────────────────────────────────────
// § DATA REFRESH & RENDER PIPELINE
// ─────────────────────────────────────────────
function refreshData(p) {
  const idMap = {
    apartments: "apt-list",
    serviceunits: "service-list",
    assets: "asset-list",
    maintenance: "maint-list",
    maint: "maint-list",
    utilities: "util-list",
    staff: "staff-list",
    vendors: "vendor-list",
    workorders: "wo-list",
    inventory: "inventory-list",
    payments: "payment-list",
    archived: "archived-list",
    expenserequests: "expense-req-list",
    cashexpenses: "cash-expense-list",
  };
  const listEl = document.getElementById(idMap[p]);
  if (!listEl) return;
  const isMaint = p === "maintenance" || p === "maint";

  if (p === "archived") {
    const hasArchiveCache =
      (cache.assets && cache.assets.length) ||
      (cache.staff && cache.staff.length) ||
      (cache.vendors && cache.vendors.length) ||
      (cache.inventory && cache.inventory.length);

    const renderArchived = () => {
      renderArchiveBinDashboardView(listEl);
      const emptyEl = document.getElementById("archived-empty");
      if (emptyEl) {
        const hasAny =
          (cache.assets || []).some(
            (a) =>
              a &&
              (String(a.status || a.Status || "") === "Archived" ||
                String(a.archived || a.Archived || "") === "Yes"),
          ) ||
          (cache.staff || []).some(
            (s) => s && String(s.archived || s.Archived || "") === "Yes",
          ) ||
          (cache.vendors || []).some(
            (v) => v && String(v.archived || v.Archived || "") === "Yes",
          ) ||
          (cache.inventory || []).some(
            (i) => i && String(i.archived || i.Archived || "") === "Yes",
          );
        emptyEl.style.display = hasAny ? "none" : "block";
      }
    };

    // Cache (populated by the boot-time getAllData load) already has this
    // data — paint instantly and only show the blocking loader if we
    // genuinely have nothing to show yet.
    if (hasArchiveCache) {
      renderArchived();
    } else {
      setGlobalLoading(true, "Loading archive...");
    }

    Promise.all([
      callApi("getAssets", {}),
      callApi("getStaff", {}),
      callApi("getVendors", {}),
      callApi("getInventory", {}),
    ])
      .then(([assets, staff, vendors, inventory]) => {
        if (Array.isArray(assets)) cache.assets = assets;
        if (Array.isArray(staff)) cache.staff = staff;
        if (Array.isArray(vendors)) cache.vendors = vendors;
        if (Array.isArray(inventory)) cache.inventory = inventory;
        renderArchived();
        updateDashboardCounters();
        evalPreventiveMaintenanceAlerts();
        setGlobalLoading(false);
      })
      .catch(() => {
        if (!hasArchiveCache) showToast("Failed to load archive", "error");
        setGlobalLoading(false);
      });
    return;
  }

  const apiCmdMap = {
    assets: "getAssets",
    vendors: "getVendors",
    staff: "getStaff",
    utilities: "getUtilities",
    workorders: "getWorkOrders",
    inventory: "getInventory",
    payments: "getPayments",
    expenserequests: "getExpenseRequests",
    cashexpenses: "getCashExpenses",
  };
  const apiCmd = isMaint ? "getMaintenance" : apiCmdMap[p] || "getApartments";

  const cacheKeyMap = {
    apartments: "apts",
    serviceunits: "apts",
    assets: "assets",
    maintenance: "tickets",
    maint: "tickets",
    utilities: "utilities",
    staff: "staff",
    vendors: "vendors",
    workorders: "workorders",
    inventory: "inventory",
    payments: "payments",
    expenserequests: "expenseRequests",
    cashexpenses: "cashExpenses",
  };
  const cacheKey = cacheKeyMap[p] || "apts";
  const hasCache = Array.isArray(cache[cacheKey]) && cache[cacheKey].length > 0;

  // Captured once so the overdue deep-link filter applies consistently to
  // both the instant cache-paint render and the follow-up network render,
  // instead of being consumed by whichever render happens to run first.
  const overdueFilterRequested = window.pendingAssetFilter === "overdue";
  if (overdueFilterRequested) window.pendingAssetFilter = "";

  function applyDataAndRender(data) {
    let displayData = Array.isArray(data) ? data : [];

    if (p === "apartments" || p === "serviceunits") {
      cache.apts = displayData;
      sortApartmentsCacheList();
      displayData = cache.apts.filter((item) => {
        const t = String(item?.type || item?.Type || "").toLowerCase();
        return p === "apartments" ? t !== "services" : t === "services";
      });
    }
    if (p === "assets") {
      cache.assets = displayData;
      displayData = displayData.filter(
        (item) =>
          item &&
          String(item.status || item.Status || "") !== "Archived" &&
          String(item.archived || item.Archived || "") !== "Yes",
      );
      if (overdueFilterRequested) {
        displayData = displayData.filter((item) => isAssetOverdue(item));
      }
    }
    if (isMaint) cache.tickets = displayData;
    if (p === "staff") {
      cache.staff = displayData;
      displayData = displayData.filter(
        (item) =>
          item && String(item.archived || item.Archived || "") !== "Yes",
      );
    }
    if (p === "vendors") {
      cache.vendors = displayData;
      displayData = displayData.filter(
        (item) =>
          item && String(item.archived || item.Archived || "") !== "Yes",
      );
    }
    if (p === "utilities") {
      cache.utilities = displayData;
      cache.utilities.forEach((u, i) => {
        if (u && !u.rowId && !u.id) u._tempId = "UTIL-" + i;
      });
    }
    if (p === "workorders") cache.workorders = displayData;
    if (p === "payments") {
      cache.payments = displayData;
      if (!cache.cashExpenses || cache.cashExpenses.length === 0) {
        callApi("getCashExpenses", {}).then((r) => {
          cache.cashExpenses = Array.isArray(r) ? r : [];
          renderTotalBalance();
        });
      } else {
        renderTotalBalance();
      }
    }
    if (p === "expenserequests") cache.expenseRequests = displayData;
    if (p === "cashexpenses") {
      cache.cashExpenses = displayData;
      if (!cache.payments || cache.payments.length === 0) {
        callApi("getPayments", {}).then((r) => {
          cache.payments = Array.isArray(r) ? r : [];
          renderTotalBalance();
        });
      } else {
        renderTotalBalance();
      }
    }
    if (p === "inventory") {
      cache.inventory = displayData;
      displayData = displayData.filter(
        (item) =>
          item && String(item.archived || item.Archived || "") !== "Yes",
      );
    }

    // Apply local filters
    if (p === "assets") {
      const f = document.getElementById("asset-unit-filter");
      if (f && f.value !== "ALL")
        displayData = displayData.filter(
          (item) => String(getUnitNumber(item)) === f.value,
        );
    }
    if (isMaint) {
      const f = document.getElementById("maint-status-filter");
      if (f && f.value !== "ALL")
        displayData = displayData.filter(
          (item) => String(item.status || item.Status || "") === f.value,
        );
    }
    if (p === "workorders") {
      const f = document.getElementById("wo-status-filter");
      if (f && f.value !== "ALL")
        displayData = displayData.filter(
          (item) => String(item.status || item.Status || "") === f.value,
        );
    }

    renderList(p, listEl, displayData);
    const emptyId = idMap[p].replace("-list", "-empty");
    const emptyEl = document.getElementById(emptyId);
    if (emptyEl)
      emptyEl.style.display = displayData.length === 0 ? "block" : "none";

    // [BUG FIX] These used to only run as part of closeModal()'s blanket
    // full-app reload (removed — see closeModal() in Modals-forms.js).
    // They're pure cache reads with no network cost, so it's cheap to
    // keep the dashboard metrics/PM banner in sync here too, right
    // after whichever single list actually changed.
    updateDashboardCounters();
    evalPreventiveMaintenanceAlerts();
  }

  // Cache (populated by the boot-time getAllData load) already has this
  // data — paint instantly and only show the blocking loader if we
  // genuinely have nothing to show yet.
  if (hasCache) {
    applyDataAndRender(cache[cacheKey]);
  } else {
    setGlobalLoading(true, `Loading ${p}...`);
  }

  callApi(apiCmd, {})
    .then((data) => {
      applyDataAndRender(data);
      setGlobalLoading(false);
    })
    .catch((err) => {
      console.error(`Refresh error for ${p}:`, err);
      if (!hasCache) showToast(`Failed to load ${p}`, "error");
      setGlobalLoading(false);
    });
}

// ─────────────────────────────────────────────
// § LIST RENDERERS
// ─────────────────────────────────────────────
function renderList(p, listEl, displayData) {
  if (!displayData || displayData.length === 0) {
    listEl.innerHTML = "";
    return;
  }
  const isMaintPage = p === "maintenance" || p === "maint";
  listEl.innerHTML = displayData
    .map((item) => {
      if (!item) return "";
      return renderListCard(p, item, isMaintPage);
    })
    .join("");
}

function renderListCard(p, item, isMaintPage) {
  const unitId = escapeHtml(getUnitNumber(item));

  if (p === "expenserequests") {
    return `<div class="card">
      <div style="display:flex; justify-content:space-between; align-items:start;" data-action="open-record" data-record-type="expenserequest" data-id="${escapeHtml(item.reqId)}">
        <div><strong style="font-size:20px;">Unit ${unitId}</strong><br><small style="color:var(--muted); font-weight:700;">${escapeHtml(item.reqId)}</small></div>
        <div style="font-size:20px; font-weight:900; color:var(--primary)">₦${formatMoney(item.cost)}</div>
      </div>
      <div style="font-size:15px; margin:8px 0; font-weight:600; color:#000;">${escapeHtml(item.job || "")}</div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button data-action="expense-create-wo" data-id="${escapeHtml(item.reqId)}" style="flex:1; background:#000; color:#fff; padding:10px; border-radius:8px; font-weight:900; border:none; cursor:pointer; min-height:44px;">New WO</button>
        <button data-action="expense-create-cash" data-id="${escapeHtml(item.reqId)}" style="flex:1; background:var(--primary); color:#fff; padding:10px; border-radius:8px; font-weight:900; border:none; cursor:pointer; min-height:44px;">Cash Exp</button>
        <button data-action="expense-delete" data-id="${escapeHtml(item.reqId)}" style="background:var(--danger); color:#fff; padding:10px 15px; border-radius:8px; border:none; cursor:pointer; min-height:44px;" aria-label="Delete"><i class="fas fa-trash"></i></button>
      </div>
      <button data-action="print-expense-request" data-id="${escapeHtml(item.reqId)}" style="width:100%; margin-top:8px; background:var(--card-light); color:#000; border:2px solid var(--border); padding:10px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer; text-transform:uppercase; min-height:44px;"><i class="fas fa-print"></i> Print Request</button>
    </div>`;
  }

  if (p === "cashexpenses") {
    return `<div class="card" data-action="open-record" data-record-type="cashexpense" data-id="${escapeHtml(item.cashId)}">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
        <div><strong style="font-size:20px;">Unit ${unitId || "N/A"}</strong><br><small style="color:var(--muted); font-weight:700;">ID: ${escapeHtml(item.cashId)}</small></div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
          <div style="text-align:right;"><span style="font-size:20px; font-weight:900; color:var(--danger);">-₦${formatMoney(item.amount)}</span><br><small style="font-size:11px; font-weight:700; color:var(--muted);">${formatDateForDisplay(item.date)}</small></div>
          <button data-action="print-cash-expense" data-id="${escapeHtml(item.cashId)}" style="background:var(--primary); color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; text-transform:uppercase; min-height:32px;"><i class="fas fa-print"></i> Print</button>
        </div>
      </div>
      <div style="font-size:15px; font-weight:600; color:#000;">${escapeHtml(item.description || "")}</div>
    </div>`;
  }

  if (isMaintPage) {
    const status = String(item.status || "").toLowerCase();
    return `<div class="card" data-action="open-record" data-record-type="maintenance" data-id="${escapeHtml(item.ticketId || item.TicketId)}">      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
        <div><strong style="font-size:20px;">Unit ${unitId}</strong><br><small style="color:var(--muted); font-weight:700;">${escapeHtml(item.ticketId || item.TicketId)}</small></div>
        <span style="padding:4px 10px; border:2px solid #000; border-radius:6px; font-size:12px; font-weight:900; background:${status === "resolved" ? "var(--success)" : "var(--danger)"}; color:#fff;">${escapeHtml(String(item.status || "OPEN").toUpperCase())}</span>
      </div>
      <div style="font-size:16px; font-weight:800; color:var(--primary);">${escapeHtml(item.category || item.Category || "")}</div>
      <div style="font-size:15px; color:#000; font-weight:600;">${escapeHtml(item.description || item.Description || "")}</div>
    </div>`;
  }

  if (p === "workorders") {
    const woId = item.workOrderId || item.WorkOrderId;
    const submittedPreview =
      item.submittedValue || item.SubmittedValue
        ? `<span style="font-size:13px; font-weight:700; color:var(--muted); text-decoration:line-through; margin-left:8px;">₦${formatMoney(item.submittedValue || item.SubmittedValue)}</span>`
        : "";
    const statusColor =
      String(item.status || "") === "Approved"
        ? "var(--success)"
        : String(item.status || "") === "Declined"
          ? "var(--danger)"
          : "var(--warning)";
    return `<div class="card" data-action="open-record" data-record-type="workorder" data-id="${escapeHtml(woId)}">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
        <div><strong style="font-size:20px;">Unit ${unitId}</strong><br><small style="color:var(--muted); font-weight:700;">${escapeHtml(woId)}</small></div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
          <span style="padding:4px 10px; border:2px solid #000; border-radius:6px; font-size:12px; font-weight:900; background:${statusColor}; color:#fff;">${escapeHtml(String(item.status || "PENDING").toUpperCase())}</span>
          <div style="display:flex; gap:5px;">
            <button data-action="print-work-order-text" data-id="${escapeHtml(woId)}" style="background:var(--card-light); color:#000; border:2px solid var(--border); padding:6px 10px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; min-height:32px;"><i class="fas fa-file-alt"></i> Text</button>
            <button data-action="print-work-order-full" data-id="${escapeHtml(woId)}" style="background:var(--primary); color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; min-height:32px;"><i class="fas fa-paperclip"></i> Full</button>
          </div>
        </div>
      </div>
      <div style="display:flex; align-items:baseline; margin:4px 0;"><div style="font-size:18px; font-weight:900; color:var(--success)">₦${formatMoney(item.amount)}</div>${submittedPreview}</div>
      ${item.assigned ? `<div style="font-size:14px; font-weight:700; color:var(--muted); margin-bottom:4px;"><i class="fas fa-user-check"></i> ${escapeHtml(item.assigned)} ${item.duration ? `• ${escapeHtml(item.duration)}` : ""}</div>` : ""}
      <div style="font-size:15px; font-weight:600; color:#000;">${escapeHtml(item.description || item.Description || "")}</div>
    </div>`;
  }

  if (p === "payments") {
    const isOutflow = item.direction === "OUTFLOW";
    const color = isOutflow ? "var(--danger)" : "var(--success)";
    const sign = isOutflow ? "-" : "+";
    const paidStatus =
      String(item.isPaid || "").toUpperCase() === "TRUE" ||
      item.isPaid === true;
    const totalContract =
      parseFloat(item.totalJobValue || item.TotalJobValue || 0) || 0;
    const showPaymentRequest =
      item.showPaymentRequest !== false && item.ShowPaymentRequest !== false;

    // Parse stages once: drives the stage-count badge and the unpaid balance
    let stagesBadge = "";
    let unpaidBalance = totalContract > 0 ? totalContract : 0;
    let unpaidColor = "var(--danger)";
    if (item.stages) {
      try {
        const stages = JSON.parse(item.stages);
        const paidCount = stages.filter((s) => s.status === "Paid").length;
        stagesBadge = `<span style="background:#e8f4fd; color:#0D6EFD; padding:2px 6px; border:1px solid #b6d4fe; border-radius:4px; font-size:10px; margin-left:6px;"><i class="fas fa-layer-group"></i> ${paidCount}/${stages.length} stages</span>`;
        if (totalContract > 0) {
          const paidStagesTotal = stages.reduce(
            (sum, s) =>
              sum + (s.status === "Paid" ? parseFloat(s.amount) || 0 : 0),
            0,
          );
          unpaidBalance = Math.max(totalContract - paidStagesTotal, 0);
          unpaidColor = unpaidBalance > 0 ? "var(--danger)" : "var(--success)";
        }
      } catch (e) {
        console.warn(
          "[Data Consistency] Failed to parse stages for payment card",
          item.paymentId || item.PaymentId,
          ":",
          e.message,
        );
        stagesBadge = `<span style="background:#fdecea; color:#dc3545; padding:2px 6px; border:1px solid #f5c2c7; border-radius:4px; font-size:10px; margin-left:6px;"><i class="fas fa-exclamation-triangle"></i> Invalid Stages</span>`;
      }
    }

    return `<div class="card" data-action="open-record" data-record-type="payment" data-id="${escapeHtml(item.paymentId || item.PaymentId)}">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
        <div>
          <strong style="font-size:18px;">${escapeHtml(item.party || "No Party Listed")}</strong><br>
          <small style="color:var(--muted); font-weight:700;">ID: ${escapeHtml(item.paymentId || item.PaymentId || "")} | ${item.bank ? escapeHtml(item.bank) + ": " : "Acc: "}${item.account ? String(item.account).padStart(10, "0") : "N/A"}</small>
          ${totalContract > 0 ? `<div style="font-size:12px; font-weight:700; color:var(--muted); margin-top:2px;">Total Contract: ₦${formatMoney(totalContract)}</div>` : ""}
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
          <div style="text-align:right;">
            ${
              totalContract > 0
                ? `<span style="font-size:13px; font-weight:700; color:var(--muted); display:block; text-transform:uppercase;">Unpaid Balance</span><span style="font-size:20px; font-weight:900; color:${unpaidColor};">₦${formatMoney(unpaidBalance)}</span>`
                : `<span style="font-size:20px; font-weight:900; color:${color};">${sign}₦${formatMoney(item.amount)}</span>`
            }<br>
            <small style="font-size:11px; font-weight:700; color:var(--muted);">${formatDateForDisplay(item.date)}</small>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <label style="display:flex; align-items:center; gap:4px; background:#f8f9fa; border:2px solid var(--border); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:700; color:#333;" data-action="toggle-payment-request" data-id="${escapeHtml(item.paymentId || item.PaymentId)}">
              <input type="checkbox" ${showPaymentRequest ? "checked" : ""} style="width:32px; height:16px; margin:0; pointer-events:none;">
              <span>Show PR</span>
            </label>
            <button data-action="print-payment" data-id="${escapeHtml(item.paymentId || item.PaymentId)}" style="background:var(--primary); color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; min-height:32px;"><i class="fas fa-print"></i> Print</button>
          </div>
        </div>
      </div>
      <div style="font-size:15px; font-weight:800; color:${color};">${escapeHtml(item.direction || "INFLOW")} &bull; ${escapeHtml(item.type || "General Record")} ${stagesBadge}${paidStatus ? ' <span style="background:var(--success); color:#fff; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:4px;">PAID</span>' : ""}</div>
      ${item.reason ? `<div style="font-size:13px; color:var(--muted); margin-top:2px;">${escapeHtml(item.reason)}</div>` : ""}
    </div>`;
  }

  if (p === "inventory") {
    return `<div class="card" data-action="open-record" data-record-type="inventory" data-id="${escapeHtml(item.itemId || item.ItemId)}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div><strong style="font-size:20px;">Unit ${unitId}</strong><br><small style="color:var(--muted); font-weight:700;">ID: ${escapeHtml(item.itemId || item.ItemId || "")} [${escapeHtml(item.category || item.Category || "General")}]</small></div>
        <div style="text-align:right;"><span style="font-size:22px; font-weight:900; color:var(--primary);">${escapeHtml(item.qty || item.Qty || 0)}</span><br><small style="font-weight:800; font-size:10px; color:var(--muted)">UNITS</small></div>
      </div>
    </div>`;
  }

  if (p === "assets") {
    const nextDateStr = item.nextService || item.NextService || "";
    const nextServiceDate = parseToLocalDateObject(nextDateStr);
    const isOverdue =
      nextServiceDate && nextServiceDate <= new Date().setHours(0, 0, 0, 0);
    return `<div class="card" data-action="open-record" data-record-type="asset" data-id="${escapeHtml(item.tag || item.Tag)}" style="${isOverdue ? "border-left: 6px solid var(--danger);" : ""}">
      <div style="display:flex; justify-content:space-between; align-items:start;">
        <div><strong style="font-size:20px;">Unit ${unitId}</strong><br><span style="font-weight:800; color:var(--primary);">${escapeHtml(item.type || item.Type || "")}</span></div>
        <span style="padding:4px 10px; border:2px solid #000; border-radius:6px; font-size:12px; font-weight:900; background:#000; color:#fff;">${escapeHtml(String(item.status || "OPERATIONAL").toUpperCase())}</span>
      </div>
      <div style="font-size:14px; font-weight:700; margin-top:4px;">Tag: ${escapeHtml(item.tag || item.Tag || "")}</div>
      <div style="font-size:13px; font-weight:700; margin-top:2px; color:${isOverdue ? "var(--danger)" : "var(--muted)"}">Next PM: ${formatDateForDisplay(nextDateStr)}</div>
    </div>`;
  }

  if (p === "staff") {
    const imgSrc =
      getDirectImageUrl(item.passport || item.Passport) ||
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='40' height='40'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%23ccc'/%3E%3C/svg%3E";
    return `<div class="card" data-action="open-record" data-record-type="staff" data-id="${escapeHtml(item.rowId || item.RowId)}">
      <div style="display:flex; gap:12px; align-items:center;">
        <img src="${imgSrc}" style="width:60px; height:60px; object-fit:cover; border-radius:50%; border:2px solid #000;" alt="${escapeHtml(item.name || item.Name || "")}">
        <div style="flex:1;"><strong style="font-size:18px;">${escapeHtml(item.name || item.Name || "")}</strong><br><span style="font-weight:700; color:var(--muted); font-size:13px;">ID: ${escapeHtml(item.rowId || item.RowId || "")}</span><br><span style="font-weight:700; color:var(--primary); font-size:14px;">${escapeHtml(item.role || item.Role || "")}</span></div>
      </div>
    </div>`;
  }

  if (p === "vendors") {
    return `<div class="card" data-action="open-record" data-record-type="vendor" data-id="${escapeHtml(item.rowId || item.RowId || "")}">
      <div style="flex:1;"><strong style="font-size:18px;">${escapeHtml(item.company || item.Company || "Unnamed Vendor")}</strong><br><span style="font-weight:700; color:var(--muted); font-size:13px;">ID: ${escapeHtml(item.rowId || item.RowId || "")}</span><br><span style="font-weight:700; color:var(--success); font-size:14px;">${escapeHtml(String(item.trade || item.Trade || "").toUpperCase())}</span></div>
    </div>`;
  }

  if (p === "utilities") {
    const isPlant =
      item.type === "Plant Check" ||
      String(unitId).includes("GENERATOR") ||
      unitId === "DIESEL-TANK";
    const itemType = isPlant ? "generator" : "utility";
    const lookupId = escapeHtml(item.rowId || item.id || item._tempId || "");
    return `<div class="card" data-action="open-record" data-record-type="${itemType}" data-id="${lookupId}" style="border-left: 6px solid ${isPlant ? "#fd7e14" : "var(--primary)"}; cursor: pointer;">
      <div style="display:flex; justify-content:space-between; align-items:start;">
        <div><strong>${unitId}</strong><br><span style="font-size:12px; font-weight:800; color:var(--muted);">${escapeHtml(String(item.type || "").toUpperCase())}</span></div>
        <span style="padding:4px 10px; font-weight:900; background:#000; color:#fff; border-radius:6px; font-size:14px;">${escapeHtml(item.reading || item.Reading || 0)}</span>
      </div>
    </div>`;
  }

  if (p === "apartments" || p === "serviceunits") {
    const status = String(item.status || item.Status || "").toLowerCase();
    const statusBg =
      status === "occupied"
        ? "var(--success)"
        : status === "common area"
          ? "var(--primary)"
          : "var(--danger)";
    return `<div class="card" data-action="open-record" data-record-type="apartment" data-id="${unitId}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div><strong style="font-size:22px;">Unit ${unitId}</strong><br><span style="font-weight:600; color:var(--muted);">${escapeHtml(item.tenant || item.Tenant || "Vacant")}</span></div>
        <span style="padding:4px 10px; border:2px solid #000; border-radius:6px; font-size:12px; font-weight:900; background:${statusBg}; color:#fff;">${escapeHtml(item.status || item.Status || "Vacant")}</span>
      </div>
    </div>`;
  }

  return `<div class="card"><div style="font-size:16px; font-weight:700;">Unit ${unitId}</div></div>`;
}

function renderArchiveBinDashboardView(targetContainerElement) {
  if (!targetContainerElement) return;
  const selectedFilter =
    document.getElementById("archive-segment-filter")?.value || "ALL";
  let html = "";
  if (selectedFilter === "ALL" || selectedFilter === "assets") {
    (cache.assets || [])
      .filter(
        (a) =>
          a &&
          (String(a.status || a.Status || "") === "Archived" ||
            String(a.archived || a.Archived || "") === "Yes"),
      )
      .forEach((a) => {
        html += `<div class="card" style="border-left:5px solid var(--danger)"><strong>[ASSET] ${escapeHtml(a.type || "Asset")}</strong><br><small>Tag: ${escapeHtml(a.tag || a.Tag)} | Unit ${escapeHtml(getUnitNumber(a))}</small></div>`;
      });
  }
  if (selectedFilter === "ALL" || selectedFilter === "inventory") {
    (cache.inventory || [])
      .filter((i) => i && String(i.archived || i.Archived || "") === "Yes")
      .forEach((i) => {
        html += `<div class="card" style="border-left:5px solid #ffc107"><strong>[INVENTORY] ${escapeHtml(i.name || i.Name || "")}</strong><br><small>Category: ${escapeHtml(i.category || i.Category)} | Qty: ${escapeHtml(i.qty || i.Qty)}</small></div>`;
      });
  }
  if (selectedFilter === "ALL" || selectedFilter === "staff") {
    (cache.staff || [])
      .filter((s) => s && String(s.archived || s.Archived || "") === "Yes")
      .forEach((s) => {
        html += `<div class="card" style="border-left:5px solid var(--primary)"><strong>[STAFF] ${escapeHtml(s.name || s.Name || "")}</strong><br><small>Role: ${escapeHtml(s.role || s.Role)} | ID: ${escapeHtml(s.rowId || s.RowId)}</small></div>`;
      });
  }
  if (selectedFilter === "ALL" || selectedFilter === "vendors") {
    (cache.vendors || [])
      .filter((v) => v && String(v.archived || v.Archived || "") === "Yes")
      .forEach((v) => {
        html += `<div class="card" style="border-left:5px solid var(--success)"><strong>[VENDOR] ${escapeHtml(v.company || v.Company || "")}</strong><br><small>Trade: ${escapeHtml(v.trade || v.Trade)}</small></div>`;
      });
  }
  targetContainerElement.innerHTML =
    html ||
    `<p style="text-align:center; padding:30px; font-weight:700; color:var(--muted)">No archived items match this selection.</p>`;
}
