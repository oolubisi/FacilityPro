// =========================================================
// INIT.JS — App Initialization · Dashboard & Alerts
//           Navigation · Keyboard/A11y · Pull-to-Refresh
// Load order: 2nd
// Depends on: core.js (cache, appSettings, callApi, showToast, setGlobalLoading)
// =========================================================

// ─────────────────────────────────────────────
// § APP INITIALIZATION
// Named function instead of window.onload — Login.js owns the boot
// sequence now (it calls this once a valid session exists, either from
// a stored session on page load or right after a successful login).
// ─────────────────────────────────────────────
async function bootMobileApp() {
  registerServiceWorkerIfSupported();
  window.addEventListener("online", processSyncQueue);
  if (navigator.onLine) processSyncQueue();

  // Paint instantly from the last successful load before touching the
  // network, so the UI never sits blank/blocked behind a spinner if we
  // already have data on disk.
  const hadCache = hydrateCacheFromLocalBackup();
  if (hadCache) {
    if (cache.apts) sortApartmentsCacheList();
    applySettingsToUIHeaders();
    updateDashboardCounters();
    evalPreventiveMaintenanceAlerts();
    prepopulateStaticFilterSelectors();
  }

  setupKeyboardHandlers();
  setupPullToRefresh();

  await Promise.all([loadApplicationSettingsData(), bootstrapDataRegistriesPipeline(hadCache)]);
}

// generateNextId / generateNextRecordId / populateUnitDropdown /
// syncSettingsInputsToUIFields now live in Core.js, shared with desktop.js.

async function loadApplicationSettingsData() {
  const stored = localStorage.getItem("facility_pro_config_meta");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object")
        appSettings = { ...appSettings, ...parsed };
    } catch (e) {
      console.error("Settings parse error:", e);
    }
  }
  applySettingsToUIHeaders();
  try {
    const cloudSettings = await callApi("getSettings", {});
    if (
      cloudSettings &&
      typeof cloudSettings === "object" &&
      (cloudSettings.estateName || cloudSettings.fmName)
    ) {
      appSettings = { ...appSettings, ...cloudSettings };
      localStorage.setItem(
        "facility_pro_config_meta",
        JSON.stringify(appSettings),
      );
      applySettingsToUIHeaders();
      syncSettingsInputsToUIFields();
    }
  } catch (e) {
    console.error("Cloud settings load failed:", e);
  }
}

function applySettingsToUIHeaders() {
  const logoEl = document.getElementById("app-header-logo");
  if (logoEl) {
    // [BUG FIX] display was toggled based on the RAW appSettings.logoUrl
    // being truthy, independent of whether getDirectImageUrl() actually
    // managed to resolve it into something usable. If someone saved a
    // Logo URL that getDirectImageUrl() can't parse (missing http(s)://
    // scheme, an unrecognized link format, etc), that function returns
    // "" — but the raw setting was still truthy, so the <img> was shown
    // anyway with an empty src, rendering as a broken-image placeholder
    // instead of just falling back to the bundled default logo like
    // desktop's equivalent code already correctly does.
    const resolvedLogoUrl = getDirectImageUrl(appSettings.logoUrl);
    if (resolvedLogoUrl) {
      logoEl.src = resolvedLogoUrl;
      logoEl.style.display = "block";
    } else {
      logoEl.style.display = "none";
    }
  }
  const titleEl = document.getElementById("app-header-title");
  if (titleEl) titleEl.innerText = appSettings.estateName || "Facility Pro";
}

async function commitApplicationSettingsData() {
  const savedToCloud = await saveApplicationSettingsFromForm();
  showToast(
    savedToCloud ? "Settings saved and synced!" : "Saved locally. Cloud sync offline.",
    savedToCloud ? "success" : "warning",
  );
  showPage("dashboard");
}

function renderMobileHelpContent() {
  const container = document.getElementById("help-content");
  if (!container) return;

  const topics = [
    { icon: "fa-building", title: "Apartments", body: "Tracks each unit's tenancy status, tenant details, and lease dates. Units marked type 'services' are grouped as Common Area." },
    { icon: "fa-screwdriver-wrench", title: "Assets", body: "Equipment register with status and scheduled maintenance dates. Each asset has its own Maintenance History log \u2014 open an asset and use \"Add Entry\" to record what was actually done." },
    { icon: "fa-clipboard-list", title: "Tickets", body: "Maintenance tickets move through Open \u2192 In Progress \u2192 Resolved." },
    { icon: "fa-file-invoice-dollar", title: "Work Orders", body: "Contractor/staff work goes through Pending Approval \u2192 Approved/Declined. Approved work orders become read-only and eligible to be paid against." },
    { icon: "fa-wallet", title: "Ledger", body: "The full payment record. Paid entries are locked from editing. Payments can be linked to an approved Work Order via the Linked Record field." },
    { icon: "fa-file-signature", title: "Expense Requests", body: "Estimated-cost requests awaiting review \u2014 considered handled once converted into a Work Order or Payment." },
    { icon: "fa-boxes-stacked", title: "Inventory & Vendors", body: "Inventory tracks stock quantity per item. Vendors holds your supplier directory, used when assigning Work Orders and selecting Payment payees." },
    { icon: "fa-file-lines", title: "Reports", body: "Generate printable reports by category, with a live preview before printing." },
  ];

  const supportName = escapeHtml(appSettings.fmName || "Facility Operations Management");
  const supportAddr = escapeHtml(appSettings.fmAddress || "");

  container.innerHTML =
    topics
      .map(
        (t) => `<div class="card" style="cursor:default;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
            <i class="fas ${t.icon}" style="color:var(--primary); font-size:16px;"></i>
            <strong style="font-size:16px;">${escapeHtml(t.title)}</strong>
          </div>
          <p style="margin:0; font-size:14px; line-height:1.5; color:#444;">${t.body}</p>
        </div>`,
      )
      .join("") +
    `<div class="card" style="cursor:default; background:var(--card-light);">
      <strong style="font-size:16px;">Need further help?</strong>
      <p style="margin:6px 0 0; font-size:14px; color:#444;">Contact your facility management team directly:</p>
      <p style="margin:6px 0 0; font-size:15px; font-weight:800;">${supportName}</p>
      ${supportAddr ? `<p style="margin:2px 0 0; font-size:13px; color:var(--muted);">${supportAddr}</p>` : ""}
    </div>`;
}

async function bootstrapDataRegistriesPipeline(silent = false) {
  const syncStatus = document.getElementById("sync-status");
  if (silent) {
    if (syncStatus) syncStatus.style.display = "block";
  } else {
    setGlobalLoading(true, "Loading data...");
  }
  try {
    const ok = await loadAllDataFromServer();
    if (cache.utilities)
      cache.utilities.forEach((u, i) => {
        if (u && !u.rowId && !u.id) u._tempId = "UTIL-" + i;
      });
    if (cache.apts) sortApartmentsCacheList();
    applySettingsToUIHeaders();
    updateDashboardCounters();
    evalPreventiveMaintenanceAlerts();
    prepopulateStaticFilterSelectors();
    if (ok) showToast(silent ? "Data refreshed" : "Data loaded successfully", "success", 2000);
    else if (!silent) showToast("Some data could not be loaded", "warning");
  } catch (e) {
    console.error("Pipeline error:", e);
    if (!silent) showToast("Some data could not be loaded", "warning");
  } finally {
    setGlobalLoading(false);
    if (syncStatus) syncStatus.style.display = "none";
  }
}

function sortApartmentsCacheList() {
  if (!Array.isArray(cache.apts)) return;
  cache.apts.sort((a, b) => {
    const aNum = String(getUnitNumber(a)).replace(/[^0-9]/g, "");
    const bNum = String(getUnitNumber(b)).replace(/[^0-9]/g, "");
    return (parseInt(aNum, 10) || 0) - (parseInt(bNum, 10) || 0);
  });
}

function prepopulateStaticFilterSelectors() {
  const uFilter = document.getElementById("asset-unit-filter");
  if (uFilter && cache.apts?.length > 0) {
    uFilter.innerHTML = '<option value="ALL">-- ALL ASSETS --</option>';
    cache.apts.forEach((a) => {
      const uNum = getUnitNumber(a);
      if (uNum !== undefined && uNum !== "") {
        const o = document.createElement("option");
        o.value = uNum;
        o.textContent = `Unit ${uNum}`;
        uFilter.appendChild(o);
      }
    });
  }
}

// populateUnitDropdown now lives in Core.js, shared with desktop.js.

// ─────────────────────────────────────────────
// § DASHBOARD & ALERTS
// ─────────────────────────────────────────────
function evalPreventiveMaintenanceAlerts() {
  if (!Array.isArray(cache.assets)) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueCount = cache.assets.filter((a) => {
    if (!a) return false;
    if (String(a.status || a.Status || "").toLowerCase() === "archived")
      return false;
    if (String(a.archived || a.Archived || "").toLowerCase() === "yes")
      return false;
    const nextServiceDate = parseToLocalDateObject(
      a.nextService || a.NextService || "",
    );
    return nextServiceDate && nextServiceDate <= today;
  }).length;

  const banner = document.getElementById("pms-alert-banner");
  const text = document.getElementById("pms-alert-text");
  if (overdueCount > 0 && banner && text) {
    text.textContent = `${overdueCount} Heavy Asset${overdueCount > 1 ? "s Are" : " Is"} Overdue for Scheduled PM Check`;
    banner.style.display = "flex";
  } else if (banner) {
    banner.style.display = "none";
  }
}

function renderGeneratorEfficiencyLogs() {
  const card = document.getElementById("generator-efficiency-card");
  if (!card) return;
  const plantLogs = (cache.utilities || [])
    .filter(
      (u) =>
        u &&
        u.type === "Plant Check" &&
        String(getUnitNumber(u)).includes("GENERATOR"),
    )
    .sort((a, b) => parseFloat(b.reading || 0) - parseFloat(a.reading || 0));
  if (plantLogs.length < 2) {
    card.style.display = "none";
    return;
  }
  const current = plantLogs[0],
    previous = plantLogs[1];
  const deltaHours =
    parseFloat(current.reading || 0) - parseFloat(previous.reading || 0);
  const litersAdded = parseFloat(current.amount || current.Amount || 0);
  if (deltaHours > 0 && litersAdded > 0) {
    const rate = (litersAdded / deltaHours).toFixed(2);
    card.innerHTML = `<h4><i class="fas fa-chart-line"></i> Generator Burn Analytics</h4>
      <p style="font-size:14px; font-weight:600; margin-top:4px;">Last run logged <strong>${escapeHtml(deltaHours)} Hours</strong> with <strong>${escapeHtml(litersAdded)}L</strong> addition.</p>
      <div style="font-size:22px; font-weight:900; color:var(--primary); margin-top:5px;">${escapeHtml(rate)} L / Hr <span style="font-size:12px; color:var(--muted);">Consumption Rate</span></div>`;
    card.style.display = "block";
  } else {
    card.style.display = "none";
  }
}

function renderTotalBalance() {
  const balEl = document.getElementById("s-ledger-balance");
  if (!balEl) return;

  // ── CALCULATIONS ──

  // 1. TOTAL INFLOW: sum of PAID stages from INFLOW payment schedules
  let totalInflow = 0;
  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "INFLOW") return;
    // If staged, sum only Paid stages
    if (p.stages || p.Stages) {
      try {
        const stages = JSON.parse(p.stages || p.Stages);
        stages.forEach((s) => {
          if (s.status === "Paid") {
            totalInflow += parseFloat(s.amount) || 0;
          }
        });
      } catch (e) {
        console.warn(
          "[Data Consistency] Failed to parse INFLOW stages for",
          p.paymentId || p.PaymentId,
          ":",
          e.message,
        );
      }
    } else {
      // Non-staged: only count if marked as paid/cleared
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      if (isCleared) {
        totalInflow += parseFloat(p.amount || p.Amount || 0);
      }
    }
  });

  // 2. TOTAL OUTFLOW: paid OUTFLOW ledger stages only
  let totalOutflow = 0;
  // Paid OUTFLOW stages
  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "OUTFLOW") return;
    if (p.stages || p.Stages) {
      try {
        const stages = JSON.parse(p.stages || p.Stages);
        stages.forEach((s) => {
          if (s.status === "Paid") {
            totalOutflow += parseFloat(s.amount) || 0;
          }
        });
      } catch (e) {
        console.warn(
          "[Data Consistency] Failed to parse OUTFLOW stages for",
          p.paymentId || p.PaymentId,
          ":",
          e.message,
        );
      }
    } else {
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      if (isCleared) {
        totalOutflow += parseFloat(p.amount || p.Amount || 0);
      }
    }
  });

  // 3. PENDING INFLOW: total unpaid inflow = total INFLOW contract value minus paid INFLOW stages
  let pendingInflow = 0;
  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "INFLOW") return;
    if (p.stages || p.Stages) {
      try {
        const stages = JSON.parse(p.stages || p.Stages);
        const totalContract =
          parseFloat(p.totalJobValue || p.TotalJobValue || 0) || 0;
        const paidStagesTotal = stages.reduce(
          (sum, s) =>
            sum + (s.status === "Paid" ? parseFloat(s.amount) || 0 : 0),
          0,
        );
        pendingInflow += Math.max(totalContract - paidStagesTotal, 0);
      } catch (e) {
        console.warn(
          "[Data Consistency] Failed to parse INFLOW pending stages for",
          p.paymentId || p.PaymentId,
          ":",
          e.message,
        );
      }
    } else {
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      if (!isCleared) {
        pendingInflow += parseFloat(p.amount || p.Amount || 0);
      }
    }
  });

  // 4. TOTAL UNPAID: sum of all unpaid OUTFLOW balances only
  let totalUnpaid = 0;
  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "OUTFLOW") return;
    if (p.stages || p.Stages) {
      try {
        const stages = JSON.parse(p.stages || p.Stages);
        const totalContract =
          parseFloat(p.totalJobValue || p.TotalJobValue || 0) || 0;
        const paidStagesTotal = stages.reduce(
          (sum, s) =>
            sum + (s.status === "Paid" ? parseFloat(s.amount) || 0 : 0),
          0,
        );
        totalUnpaid += Math.max(totalContract - paidStagesTotal, 0);
      } catch (e) {
        console.warn(
          "[Data Consistency] Failed to parse OUTFLOW unpaid stages for",
          p.paymentId || p.PaymentId,
          ":",
          e.message,
        );
      }
    } else {
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      if (!isCleared) {
        totalUnpaid += parseFloat(p.amount || p.Amount || 0);
      }
    }
  });

  // 5. CASH EXPENSES: sum of all Cash Expenses
  let cashExpenses = 0;
  (cache.cashExpenses || []).forEach((c) => {
    if (!c) return;
    cashExpenses += parseFloat(c.amount || c.Amount || 0);
  });

  // 6. NET POSITION
  const netPosition = totalInflow - totalOutflow - cashExpenses;
  const netColor = netPosition >= 0 ? "#198754" : "#dc3545";

  // ── RENDER ──
  const rowStyle = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #e9ecef;
  `;
  const labelStyle = `
    font-size: 14px;
    font-weight: 800;
    text-transform: uppercase;
    color: #000;
    letter-spacing: 0.3px;
  `;
  const amountStyle = `
    font-size: 16px;
    font-weight: 900;
    font-family: 'Inter', -apple-system, sans-serif;
  `;

  balEl.innerHTML = `
    <div style="background: #fff; border: 2px solid #000; border-radius: 16px; padding: 16px;">
      <div style="${rowStyle}">
        <span style="${labelStyle}">Total Inflow</span>
        <span style="${amountStyle} color: #198754;">₦${formatMoney(totalInflow)}</span>
      </div>
      <div style="${rowStyle}">
        <span style="${labelStyle}">Pending Inflow</span>
        <span style="${amountStyle} color: #0d6efd;">₦${formatMoney(pendingInflow)}</span>
      </div>
      <div style="${rowStyle}">
        <span style="${labelStyle}">Total Outflow</span>
        <span style="${amountStyle} color: #dc3545;">₦${formatMoney(totalOutflow)}</span>
      </div>
      <div style="${rowStyle}">
        <span style="${labelStyle}">Total Unpaid</span>
        <span style="${amountStyle} color: #fd7e14;">₦${formatMoney(totalUnpaid)}</span>
      </div>
      <div style="${rowStyle} border-bottom: none;">
        <span style="${labelStyle}">Cash Expenses</span>
        <span style="${amountStyle} color: #000;">₦${formatMoney(cashExpenses)}</span>
      </div>
      <div style="border-top: 2px solid #adb5bd; margin: 10px 0;"></div>
      <div style="${rowStyle} border-bottom: none; padding-bottom: 0;">
        <span style="${labelStyle} font-size: 14px;">Net Position</span>
        <span style="${amountStyle} font-size: 16px; color: ${netColor};">${netPosition < 0 ? "-" : ""}₦${formatMoney(Math.abs(netPosition))}</span>
      </div>
    </div>
  `;
}

function updateDashboardCounters() {
  const tenancyCount = (cache.apts || []).filter(
    (a) => a && String(a.type || a.Type || "").toLowerCase() !== "services",
  ).length;
  const assetCount = (cache.assets || []).filter(
    (a) =>
      a &&
      String(a.status || a.Status || "") !== "Archived" &&
      String(a.archived || a.Archived || "") !== "Yes",
  ).length;
  const invCount = (cache.inventory || []).filter(
    (i) => i && String(i.archived || i.Archived || "") !== "Yes",
  ).length;
  const maintCount = (cache.tickets || []).filter(
    (t) => t && String(t.status || t.Status || "") !== "Resolved",
  ).length;
  const woCount = (cache.workorders || []).filter(
    (w) => w && String(w.status || w.Status || "") === "Pending Approval",
  ).length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fourteenDaysLimit = new Date();
  fourteenDaysLimit.setDate(today.getDate() + 14);
  fourteenDaysLimit.setHours(23, 59, 59, 999);
  let pmCombinedSum = 0;
  (cache.assets || []).forEach((a) => {
    if (
      !a ||
      String(a.status || a.Status || "").toLowerCase() === "archived" ||
      String(a.archived || a.Archived || "").toLowerCase() === "yes"
    )
      return;
    const nextServiceDate = parseToLocalDateObject(
      a.nextService || a.NextService || "",
    );
    if (nextServiceDate && nextServiceDate <= fourteenDaysLimit)
      pmCombinedSum++;
  });

  const idVals = [
    ["s-tenancy", tenancyCount],
    ["s-asset", assetCount],
    ["s-inv", invCount],
    ["count-maint", maintCount],
    ["s-wo", woCount],
    ["s-pm-due", pmCombinedSum],
  ];
  idVals.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || "0";
  });
}

function isAssetOverdue(asset) {
  if (!asset) return false;
  if (String(asset.status || asset.Status || "").toLowerCase() === "archived")
    return false;
  if (String(asset.archived || asset.Archived || "").toLowerCase() === "yes")
    return false;
  const nextServiceDate = parseToLocalDateObject(
    asset.nextService || asset.NextService || "",
  );
  return nextServiceDate && nextServiceDate <= new Date().setHours(0, 0, 0, 0);
}

function showOverdueAssets() {
  window.pendingAssetFilter = "overdue";
  showPage("assets");
}

function renderDiagnosticsPanel() {
  const panel = document.getElementById("diagnostics-panel");
  if (!panel) return;
  const queue = JSON.parse(
    localStorage.getItem("facility_pro_sync_queue") || "[]",
  );
  const backups = Object.keys(localStorage).filter((key) =>
    key.startsWith("facility_pro_backup_"),
  ).length;
  const swReady = "serviceWorker" in navigator;
  const currentData = {
    Apartments: cache.apts.length,
    Assets: cache.assets.length,
    Tickets: cache.tickets.length,
    "Work Orders": cache.workorders.length,
    Payments: cache.payments.length,
    Inventory: cache.inventory.length,
  };
  panel.innerHTML = `
    <div style="border:2px solid var(--border); border-radius:8px; padding:12px; background:#fff;">
      <h4 style="margin:0 0 8px 0; font-size:14px; font-weight:900; text-transform:uppercase;">Diagnostics</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:13px;">
        <div><strong>Network:</strong> ${navigator.onLine ? "Online" : "Offline"}</div>
        <div><strong>Service Worker:</strong> ${swReady ? "Supported" : "Unavailable"}</div>
        <div><strong>Offline Queue:</strong> ${queue.length}</div>
        <div><strong>Cached Reads:</strong> ${backups}</div>
        <div><strong>Backend URL:</strong> ${escapeHtml(GAS_URL.slice(0, 42))}...</div>
        <div><strong>App Cache:</strong> facility-pro-v16</div>
      </div>
      <div style="margin-top:10px; font-size:13px;">
        ${Object.entries(currentData)
          .map(([key, val]) => `<span style="display:inline-block; margin:3px 6px 3px 0; padding:4px 8px; border:1px solid var(--border); border-radius:6px; font-weight:800;">${escapeHtml(key)}: ${val}</span>`)
          .join("")}
      </div>
      <h4 style="margin:16px 0 4px 0; font-size:14px; font-weight:900; text-transform:uppercase;">Sync Conflicts</h4>
      ${getSyncConflictsHtml()}
    </div>`;
}

// ─────────────────────────────────────────────
// § NAVIGATION
// ─────────────────────────────────────────────
function showPage(p) {
  document
    .querySelectorAll(".page-view")
    .forEach((v) => v.classList.remove("active-view"));
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = "";

  const target = document.getElementById("view-" + p);
  if (target) {
    target.classList.add("active-view");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const moreChildren = [
    "serviceunits",
    "utilities",
    "expenserequests",
    "cashexpenses",
    "payments",
    "staff",
    "vendors",
    "archived",
    "reports",
    "settings",
    "help",
  ];
  const homeBtn = document.querySelector(".active-view .home-btn");
  if (homeBtn)
    homeBtn.onclick = () =>
      showPage(moreChildren.includes(p) ? "more" : "dashboard");

  if (p === "dashboard") {
    updateDashboardCounters();
    evalPreventiveMaintenanceAlerts();
  } else if (p === "reports") initReportsEngine();
  else if (p === "settings") {
    syncSettingsInputsToUIFields();
    renderUsersList("mobile-user-list");
  } else if (p === "servicecharge") {
    refreshServiceChargeSection();
  } else if (p === "pettycash") {
    refreshPettyCashSection();
  }
  else if (p === "help") renderMobileHelpContent();
  else if (p === "utilities") {
    refreshData("utilities");
    setTimeout(renderGeneratorEfficiencyLogs, 500);
  } else if (p === "payments") refreshData("payments");
  else if (p !== "more") refreshData(p);
}

// ─────────────────────────────────────────────
// § KEYBOARD & ACCESSIBILITY
// ─────────────────────────────────────────────
function setupKeyboardHandlers() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const overlay = document.getElementById("modalOverlay");
      if (overlay && overlay.style.display === "flex") closeModal();
    }
  });
}

// ─────────────────────────────────────────────
// § PULL-TO-REFRESH
// ─────────────────────────────────────────────
function setupPullToRefresh() {
  let startY = 0,
    isPulling = false;
  const indicator = document.getElementById("pull-indicator");
  document.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
        isPulling = true;
      }
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!isPulling || !indicator) return;
      const diff = e.touches[0].clientY - startY;
      if (diff > 60 && diff < 200 && window.scrollY === 0) {
        indicator.style.display = "flex";
        indicator.style.transform = `translateY(${Math.min(diff - 60, 0)}px)`;
      }
    },
    { passive: true },
  );
  document.addEventListener("touchend", () => {
    if (!isPulling || !indicator) return;
    isPulling = false;
    indicator.style.transform = "translateY(-60px)";
    setTimeout(() => {
      indicator.style.display = "none";
      if (window.scrollY === 0) {
        showToast("Refreshing data...", "info");
        bootstrapDataRegistriesPipeline();
      }
    }, 200);
  });
}

// ─────────────────────────────────────────────
