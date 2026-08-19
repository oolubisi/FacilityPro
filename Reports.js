// =========================================================
// REPORTS.JS — Reports Engine (profile/layout selectors,
//              report compilers, apartment manifest/dossier)
// Load order: 7th (last)
// Depends on: core.js, init.js, pdf.js (compileAndDownloadUnifiedPDF)
// =========================================================

// § REPORTS ENGINE
// ─────────────────────────────────────────────
function initReportsEngine() {
  setGlobalLoading(true, "Loading reports...");
  loadReportDataBundle()
    .then(() => {
      if (cache.apts) sortApartmentsCacheList();
      document.getElementById("rep-profile-selector").value = "";
      document.getElementById("rep-layout-selector").innerHTML =
        "<option value=''>-- Choose Configurations --</option>";
      document.getElementById("rep-dynamic-parameters-frame").innerHTML = "";
      refreshReportPresetSelector();
      document.getElementById("report-onscreen-preview-card").style.display =
        "none";
      setGlobalLoading(false);
    })
    .catch(() => setGlobalLoading(false));
}

async function loadReportDataBundle() {
  const bundled = await callApi("getAllData", {});
  if (bundled && typeof bundled === "object" && !Array.isArray(bundled) && bundled.apartments) {
    cache.apts = Array.isArray(bundled.apartments) ? bundled.apartments : [];
    cache.assets = Array.isArray(bundled.assets) ? bundled.assets : [];
    cache.tickets = Array.isArray(bundled.maintenance) ? bundled.maintenance : [];
    cache.workorders = Array.isArray(bundled.workOrders) ? bundled.workOrders : [];
    cache.inventory = Array.isArray(bundled.inventory) ? bundled.inventory : [];
    cache.staff = Array.isArray(bundled.staff) ? bundled.staff : [];
    cache.vendors = Array.isArray(bundled.vendors) ? bundled.vendors : [];
    cache.utilities = Array.isArray(bundled.utilities) ? bundled.utilities : [];
    cache.payments = Array.isArray(bundled.payments) ? bundled.payments : [];
    cache.expenseRequests = Array.isArray(bundled.expenseRequests) ? bundled.expenseRequests : [];
    cache.cashExpenses = Array.isArray(bundled.cashExpenses) ? bundled.cashExpenses : [];
    return;
  }
  await Promise.all([
    callApi("getApartments", {}).then((r) => (cache.apts = Array.isArray(r) ? r : [])),
    callApi("getAssets", {}).then((r) => (cache.assets = Array.isArray(r) ? r : [])),
    callApi("getMaintenance", {}).then((r) => (cache.tickets = Array.isArray(r) ? r : [])),
    callApi("getWorkOrders", {}).then((r) => (cache.workorders = Array.isArray(r) ? r : [])),
    callApi("getUtilities", {}).then((r) => (cache.utilities = Array.isArray(r) ? r : [])),
    callApi("getPayments", {}).then((r) => (cache.payments = Array.isArray(r) ? r : [])),
    callApi("getExpenseRequests", {}).then((r) => (cache.expenseRequests = Array.isArray(r) ? r : [])),
    callApi("getCashExpenses", {}).then((r) => (cache.cashExpenses = Array.isArray(r) ? r : [])),
  ]);
}

function getReportPresets() {
  try {
    return JSON.parse(localStorage.getItem("facility_pro_report_presets") || "[]");
  } catch (e) {
    return [];
  }
}

function saveReportPresets(presets) {
  localStorage.setItem("facility_pro_report_presets", JSON.stringify(presets));
}

function collectReportParameters() {
  const params = {};
  document
    .querySelectorAll("#rep-dynamic-parameters-frame input, #rep-dynamic-parameters-frame select")
    .forEach((el) => {
      if (el.id) params[el.id] = el.value;
    });
  return params;
}

function applyReportParameters(params) {
  Object.entries(params || {}).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

function refreshReportPresetSelector() {
  const selector = document.getElementById("rep-preset-selector");
  if (!selector) return;
  const presets = getReportPresets();
  selector.innerHTML = '<option value="">-- Saved Presets --</option>';
  presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    selector.appendChild(option);
  });
}

function saveCurrentReportPreset() {
  const profile = document.getElementById("rep-profile-selector")?.value;
  const layout = document.getElementById("rep-layout-selector")?.value;
  if (!profile || !layout) {
    showToast("Choose a report category and type first.", "warning");
    return;
  }
  const defaultName =
    document.getElementById("rep-layout-selector").selectedOptions[0]?.textContent ||
    layout;
  const name = prompt("Preset name", defaultName);
  if (!name) return;
  const presets = getReportPresets().filter((preset) => preset.name !== name);
  presets.push({
    name: sanitizeInput(name),
    profile,
    layout,
    params: collectReportParameters(),
    savedAt: new Date().toISOString(),
  });
  saveReportPresets(presets.sort((a, b) => a.name.localeCompare(b.name)));
  refreshReportPresetSelector();
  document.getElementById("rep-preset-selector").value = sanitizeInput(name);
  showToast("Report preset saved", "success");
}

function loadSelectedReportPreset() {
  const selector = document.getElementById("rep-preset-selector");
  const name = selector?.value;
  if (!name) return;
  const preset = getReportPresets().find((item) => item.name === name);
  if (!preset) return;
  document.getElementById("rep-profile-selector").value = preset.profile;
  handleReportProfileSwitch();
  document.getElementById("rep-layout-selector").value = preset.layout;
  handleReportLayoutSwitch();
  applyReportParameters(preset.params);
  selector.value = name;
  showToast("Report preset loaded", "success");
}

function deleteSelectedReportPreset() {
  const selector = document.getElementById("rep-preset-selector");
  const name = selector?.value;
  if (!name) {
    showToast("Select a preset to delete.", "warning");
    return;
  }
  if (!confirm(`Delete report preset "${name}"?`)) return;
  saveReportPresets(getReportPresets().filter((preset) => preset.name !== name));
  refreshReportPresetSelector();
  showToast("Report preset deleted", "success");
}

function setReportSelection(profile, layout, params = {}) {
  document.getElementById("rep-profile-selector").value = profile;
  handleReportProfileSwitch();
  document.getElementById("rep-layout-selector").value = layout;
  handleReportLayoutSwitch();
  applyReportParameters(params);
}

function getCurrentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    month: `${y}-${m}`,
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(last).padStart(2, "0")}`,
  };
}

function generateMonthlyReportPack() {
  const viewport = document.getElementById("report-preview-viewport");
  if (!viewport) return;
  const range = getCurrentMonthRange();
  const sections = [];

  const capture = (title, renderFn) => {
    renderFn();
    if (window.currentReportRawContent) {
      sections.push(`
        <section style="page-break-after:always;">
          <h2 style="font-size:18px; font-weight:900; text-transform:uppercase; border-bottom:2px solid #000; padding-bottom:8px; margin:0 0 14px 0;">${escapeHtml(title)}</h2>
          ${window.currentReportRawContent}
        </section>`);
    }
  };

  capture("Monthly FM Report", () => {
    setReportSelection("executive", "monthly_fm", {
      "rep-param-month": range.month,
    });
    compileReportPreview();
  });
  capture("Executive KPI Dashboard", () => {
    setReportSelection("executive", "kpi_dashboard", {
      "rep-param-month": range.month,
    });
    compileReportPreview();
  });
  capture("Comprehensive Financial Ledger", () => {
    setReportSelection("financials", "ledger_summary", {
      rep_start_date: range.start,
      rep_end_date: range.end,
    });
    generateComprehensiveFinancialLedger();
  });
  capture("Preventive Maintenance Schedule", () => {
    setReportSelection("equipment", "pm_schedule");
    compileReportPreview();
  });

  const packHtml = `<div style="font-family:'Helvetica','Inter',sans-serif; color:#000; background:#fff; box-sizing:border-box; width:100%; max-width:900px; margin:0 auto; padding:0; line-height:1.4;">
    ${sections.join("")}
  </div>`;
  const ref = generateReportRef("PACK");
  const wrapped = wrapReportContent(packHtml, "Monthly Report Pack", ref);
  viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportFilename = "Monthly_Report_Pack_" + range.month;
  window.currentReportAttachmentManifest = [];
  window.currentReportTitle = "Monthly Report Pack";
  window.currentReportRef = ref;
  window.currentReportRawContent = packHtml;
  document.getElementById("report-onscreen-preview-card").style.display = "block";
  showToast("Monthly report pack generated", "success");
}

function handleReportProfileSwitch() {
  const profile = document.getElementById("rep-profile-selector").value;
  const layoutSel = document.getElementById("rep-layout-selector");
  const paramsFrame = document.getElementById("rep-dynamic-parameters-frame");
  layoutSel.innerHTML = "";
  paramsFrame.innerHTML = "";
  document.getElementById("report-onscreen-preview-card").style.display =
    "none";

  const options = {
    apartments: [
      ["", "-- Select Report --"],
      ["occupancy_report", "Apartment Occupancy Report"],
      ["apt_custom_print", "Apartments Manifest"],
      ["detailed_profile", "Detailed Apartment Profile"],
    ],
    equipment: [
      ["", "-- Select Report --"],
      ["generator_log", "Generator & Diesel Log"],
      ["pm_schedule", "PM Schedule"],
      ["asset_register", "Master Asset Register"],
      ["ticket_report", "Maintenance Tickets"],
    ],
    financials: [
      ["", "-- Select Report --"],
      ["ledger_summary", "Comprehensive Financial Ledger"],
      ["pending_outflow", "Pending Outflow"],
      ["ledger", "Ledger"],
      ["fin_wo", "Approved Work Orders Ledger"],
    ],
    executive: [
      ["", "-- Select Report --"],
      ["daily_operations", "Daily Operations Report"],
      ["monthly_fm", "Monthly FM Report"],
      ["kpi_dashboard", "Executive KPI Dashboard"],
      ["data_quality", "Data Quality Audit"],
    ],
  };
  (options[profile] || []).forEach(([val, label]) => {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    layoutSel.appendChild(o);
  });
}

function handleReportLayoutSwitch() {
  const layout = document.getElementById("rep-layout-selector").value;
  const paramsFrame = document.getElementById("rep-dynamic-parameters-frame");
  paramsFrame.innerHTML = "";
  if (layout === "detailed_profile") {
    paramsFrame.innerHTML = `<label>SELECT APARTMENT UNIT</label><select id="rep-param-unit" class="form-control"></select>`;
    populateUnitDropdown("rep-param-unit");
  } else if (
    [
      "ledger_summary",
      "generator_log",
      "ticket_report",
      "fin_wo",
      "pending_outflow",
    ].includes(layout)
  ) {
    paramsFrame.innerHTML = `<div style="display:flex; gap:10px;"><div style="flex:1;"><label>START DATE</label><input type="date" id="rep_start_date"></div><div style="flex:1;"><label>END DATE</label><input type="date" id="rep_end_date"></div></div>`;
  } else if (layout === "ledger") {
    paramsFrame.innerHTML = `
      <label>SELECT LEDGER TYPE</label>
      <select id="rep-ledger-type">
        <option value="">-- Select Ledger Type --</option>
        <option value="inflow_paid_pending">Inflow - Paid & Pending</option>
        <option value="outflow_paid_pending">Outflow - Paid & Pending</option>
        <option value="cash_expenses">Cash Expenses</option>
      </select>
      <div style="display:flex; gap:10px; margin-top:10px;">
        <div style="flex:1;"><label>START DATE</label><input type="date" id="rep_start_date"></div>
        <div style="flex:1;"><label>END DATE</label><input type="date" id="rep_end_date"></div>
      </div>`;
  } else if (layout === "daily_operations") {
    paramsFrame.innerHTML = `<label>REPORT DATE</label><input type="date" id="rep-param-date" value="${new Date().toISOString().split("T")[0]}">`;
  } else if (layout === "monthly_fm" || layout === "kpi_dashboard") {
    paramsFrame.innerHTML = `<label>SELECT MONTH</label><input type="month" id="rep-param-month" value="${new Date().toISOString().slice(0, 7)}">`;
  }
}

function compileReportPreview() {
  const layout = document.getElementById("rep-layout-selector").value;
  const viewport = document.getElementById("report-preview-viewport");
  if (!layout) return;

  if (layout === "apt_custom_print") {
    generateApartmentManifestReport();
    return;
  }
  if (layout === "detailed_profile") {
    const unit = document.getElementById("rep-param-unit")?.value;
    if (!unit) {
      showToast("Please select a unit.", "warning");
      return;
    }
    generateApartmentDossierReport(unit);
    return;
  }
  if (layout === "ledger_summary") {
    generateComprehensiveFinancialLedger();
    return;
  }
  if (layout === "pending_outflow") {
    generatePendingOutflowReport();
    return;
  }
  if (layout === "ledger") {
    const ledgerType = document.getElementById("rep-ledger-type")?.value;
    if (!ledgerType) {
      showToast("Please select a ledger type.", "warning");
      return;
    }
    generateLedgerReport(ledgerType);
    return;
  }

  const generateTitleBar = (titleText) => `
    <div style="border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:flex-end; page-break-inside:avoid; page-break-after:avoid;">
      <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">${escapeHtml(titleText)}</h2>
      <div style="text-align:right; font-size:12px;"><p style="margin:0; color:#555;">RUN DATE:</p><p style="margin:2px 0 0 0; font-weight:bold;">${new Date().toLocaleDateString("en-GB")}</p></div>
    </div>`;

  let out = `<div style="font-family:'Helvetica','Inter',sans-serif; color:#000; background:#fff; box-sizing:border-box; width:100%; max-width:900px; margin:0 auto; padding:0; line-height:1.4;">`;

  if (layout === "occupancy_report") {
    out += generateTitleBar("APARTMENT OCCUPANCY REPORT");
    const rows = (cache.apts || [])
      .map((a) => {
        if (!a) return "";
        const isOcc = String(a.status || "").toLowerCase() === "occupied";
        return `<tr><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.unit || a.Unit || a.apt || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.type || a.Type || "N/A")}</td><td style="padding:6px; border:1px solid #000; font-weight:bold; color:${isOcc ? "#198754" : "#DC3545"};">${escapeHtml((a.status || "VACANT").toUpperCase())}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.tenant || a.Tenant || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.leaseEnd || "N/A")}</td></tr>`;
      })
      .join("");
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px; page-break-inside:auto;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;"><th style="padding:8px 6px; border:1px solid #000;">Unit</th><th style="padding:8px 6px; border:1px solid #000;">Type</th><th style="padding:8px 6px; border:1px solid #000;">Status</th><th style="padding:8px 6px; border:1px solid #000;">Tenant</th><th style="padding:8px 6px; border:1px solid #000;">Lease Expiry</th></tr></thead><tbody>${rows || `<tr><td colspan="5" style="padding:10px; text-align:center;">No data.</td></tr>`}</tbody></table>`;
  } else if (layout === "pm_schedule") {
    out += generateTitleBar("PREVENTIVE MAINTENANCE SCHEDULE");
    const rows = (cache.assets || [])
      .filter((a) => a && String(a.status || "") !== "Archived")
      .map((a) => {
        let pmStatus = "Active",
          color = "#198754";
        if (a.nextService) {
          const diff =
            (new Date(a.nextService) - new Date()) / (1000 * 60 * 60 * 24);
          if (diff < 0) {
            pmStatus = "Overdue";
            color = "#DC3545";
          } else if (diff <= 14) {
            pmStatus = "Due Soon";
            color = "#FFC107";
          }
        }
        return `<tr><td style="padding:6px; border:1px solid #000; font-weight:bold;">${escapeHtml(a.tag || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.type || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.loc || a.location || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.lastServiced || "-")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.nextService || "-")}</td><td style="padding:6px; border:1px solid #000; font-weight:bold; color:${color};">${escapeHtml(pmStatus.toUpperCase())}</td></tr>`;
      })
      .join("");
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; page-break-inside:auto;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;"><th style="padding:8px 6px; border:1px solid #000;">Tag</th><th style="padding:8px 6px; border:1px solid #000;">Type</th><th style="padding:8px 6px; border:1px solid #000;">Location</th><th style="padding:8px 6px; border:1px solid #000;">Last Service</th><th style="padding:8px 6px; border:1px solid #000;">Next Service</th><th style="padding:8px 6px; border:1px solid #000;">PM Status</th></tr></thead><tbody>${rows || `<tr><td colspan="6" style="padding:10px; text-align:center;">No data.</td></tr>`}</tbody></table>`;
  } else if (layout === "ledger_summary") {
    // Handled above
  } else if (layout === "fin_wo") {
    out += generateTitleBar("APPROVED WORK ORDERS LEDGER");
    const rows = (cache.workorders || [])
      .filter(
        (w) =>
          w && String(w.status || w.Status || "").toUpperCase() === "APPROVED",
      )
      .map((w) => {
        return `<tr><td style="padding:6px; border:1px solid #000; font-weight:bold;">${escapeHtml(w.workOrderId || w.WorkOrderId || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${formatDateForDisplay(w.date || w.Date)}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(w.assigned || w.Assigned || "N/A")}</td><td style="padding:6px; border:1px solid #000; text-align:right; font-weight:bold;">N${formatMoney(w.amount || w.Amount || 0)}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(w.description || w.Description || "")}</td></tr>`;
      })
      .join("");
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; page-break-inside:auto;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;"><th style="padding:8px 6px; border:1px solid #000;">WO ID</th><th style="padding:8px 6px; border:1px solid #000;">Date</th><th style="padding:8px 6px; border:1px solid #000;">Assigned</th><th style="padding:8px 6px; border:1px solid #000;">Amount</th><th style="padding:8px 6px; border:1px solid #000;">Description</th></tr></thead><tbody>${rows || `<tr><td colspan="5" style="padding:10px; text-align:center;">No approved work orders.</td></tr>`}</tbody></table>`;
  } else if (layout === "asset_register") {
    out += generateTitleBar("MASTER ASSET REGISTER");
    const rows = (cache.assets || [])
      .filter(
        (a) =>
          a && String(a.status || a.Status || "").toLowerCase() !== "archived",
      )
      .map((a) => {
        const nextDate = parseToLocalDateObject(
          a.nextService || a.NextService || "",
        );
        const isOverdue =
          nextDate && nextDate <= new Date().setHours(0, 0, 0, 0);
        const pmStatus = isOverdue ? "OVERDUE" : nextDate ? "ACTIVE" : "N/A";
        const pmColor = isOverdue ? "#DC3545" : "#198754";
        return `<tr><td style="padding:6px; border:1px solid #000; font-weight:bold;">${escapeHtml(a.tag || a.Tag || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.type || a.Type || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(getUnitNumber(a) || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.loc || a.Loc || a.location || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(a.status || a.Status || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${formatDateForDisplay(a.lastServiced || a.LastServiced)}</td><td style="padding:6px; border:1px solid #000; color:${pmColor}; font-weight:bold;">${pmStatus}</td></tr>`;
      })
      .join("");
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; page-break-inside:auto;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;"><th style="padding:8px 6px; border:1px solid #000;">Tag</th><th style="padding:8px 6px; border:1px solid #000;">Type</th><th style="padding:8px 6px; border:1px solid #000;">Unit</th><th style="padding:8px 6px; border:1px solid #000;">Location</th><th style="padding:8px 6px; border:1px solid #000;">Status</th><th style="padding:8px 6px; border:1px solid #000;">Last Service</th><th style="padding:8px 6px; border:1px solid #000;">PM Status</th></tr></thead><tbody>${rows || `<tr><td colspan="7" style="padding:10px; text-align:center;">No assets found.</td></tr>`}</tbody></table>`;
  } else if (layout === "generator_log") {
    out += generateTitleBar("GENERATOR & DIESEL LOG");
    const startRaw = document.getElementById("rep_start_date")?.value;
    const endRaw = document.getElementById("rep_end_date")?.value;
    let plantLogs = (cache.utilities || [])
      .filter((u) => u && u.type === "Plant Check")
      .sort(
        (a, b) =>
          new Date(b.date || b.Date || 0) - new Date(a.date || a.Date || 0),
      );

    if (startRaw && endRaw) {
      const s = new Date(startRaw),
        e = new Date(endRaw);
      e.setHours(23, 59, 59, 999);
      plantLogs = plantLogs.filter((u) => {
        const d = new Date(fromSheetDate(u.date || u.Date || "") || 0);
        return d >= s && d <= e;
      });
    }

    const rows = plantLogs
      .map((u) => {
        return `<tr><td style="padding:6px; border:1px solid #000;">${escapeHtml(getUnitNumber(u) || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${formatDateForDisplay(u.date || u.Date)}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(u.reading || u.Reading || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(u.meterNo || u.MeterNo || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(u.amount || u.Amount || "0")}L</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(u.notes || u.Notes || "")}</td></tr>`;
      })
      .join("");

    // Calculate burn rate if we have at least 2 readings for same generator
    let burnRateHtml = "";
    const gen1Logs = plantLogs.filter((u) =>
      String(getUnitNumber(u)).includes("GENERATOR-1"),
    );
    if (gen1Logs.length >= 2) {
      const curr = gen1Logs[0],
        prev = gen1Logs[1];
      const delta =
        parseFloat(curr.reading || 0) - parseFloat(prev.reading || 0);
      const liters = parseFloat(curr.amount || curr.Amount || 0);
      if (delta > 0 && liters > 0) {
        const rate = (liters / delta).toFixed(2);
        burnRateHtml = `<div style="background:#e8f4fd; border:2px solid #0d6efd; border-radius:12px; padding:14px; margin-bottom:15px;"><div style="font-size:11px; font-weight:800; color:#0d6efd; text-transform:uppercase;">Generator 1 Burn Rate</div><div style="font-size:22px; font-weight:900; color:#000;">${rate} L/Hr</div><div style="font-size:12px; color:#666;">Based on last ${delta.toFixed(1)} hours with ${liters}L added</div></div>`;
      }
    }

    out += burnRateHtml;
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; page-break-inside:auto;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;"><th style="padding:8px 6px; border:1px solid #000;">Equipment</th><th style="padding:8px 6px; border:1px solid #000;">Date</th><th style="padding:8px 6px; border:1px solid #000;">Run Hours</th><th style="padding:8px 6px; border:1px solid #000;">Tank Level</th><th style="padding:8px 6px; border:1px solid #000;">Diesel Added</th><th style="padding:8px 6px; border:1px solid #000;">Notes</th></tr></thead><tbody>${rows || `<tr><td colspan="6" style="padding:10px; text-align:center;">No plant logs found.</td></tr>`}</tbody></table>`;
  } else if (layout === "ticket_report") {
    out += generateTitleBar("MAINTENANCE TICKETS REPORT");
    const startRaw = document.getElementById("rep_start_date")?.value;
    const endRaw = document.getElementById("rep_end_date")?.value;
    let tickets = cache.tickets || [];

    if (startRaw && endRaw) {
      const s = new Date(startRaw),
        e = new Date(endRaw);
      e.setHours(23, 59, 59, 999);
      tickets = tickets.filter((t) => {
        const d = new Date(fromSheetDate(t.date || t.Date || "") || 0);
        return d >= s && d <= e;
      });
    }

    const openCount = tickets.filter(
      (t) => String(t.status || t.Status || "").toLowerCase() === "open",
    ).length;
    const resolvedCount = tickets.filter(
      (t) => String(t.status || t.Status || "").toLowerCase() === "resolved",
    ).length;
    const inProgressCount = tickets.filter(
      (t) => String(t.status || t.Status || "").toLowerCase() === "in progress",
    ).length;

    out += `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:15px;">
      <div style="background:#fdecea; border:2px solid #dc3545; border-radius:12px; padding:12px; text-align:center;"><div style="font-size:11px; font-weight:800; color:#dc3545; text-transform:uppercase;">Open</div><div style="font-size:22px; font-weight:900;">${openCount}</div></div>
      <div style="background:#fff8e1; border:2px solid #ffc107; border-radius:12px; padding:12px; text-align:center;"><div style="font-size:11px; font-weight:800; color:#856404; text-transform:uppercase;">In Progress</div><div style="font-size:22px; font-weight:900;">${inProgressCount}</div></div>
      <div style="background:#e8f5e9; border:2px solid #198754; border-radius:12px; padding:12px; text-align:center;"><div style="font-size:11px; font-weight:800; color:#198754; text-transform:uppercase;">Resolved</div><div style="font-size:22px; font-weight:900;">${resolvedCount}</div></div>
    </div>`;

    const rows = tickets
      .map((t) => {
        const status = String(t.status || t.Status || "").toLowerCase();
        const statusColor =
          status === "resolved"
            ? "#198754"
            : status === "in progress"
              ? "#856404"
              : "#dc3545";
        return `<tr><td style="padding:6px; border:1px solid #000; font-weight:bold;">${escapeHtml(t.ticketId || t.TicketId || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${formatDateForDisplay(t.date || t.Date)}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(getUnitNumber(t) || "N/A")}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(t.category || t.Category || "N/A")}</td><td style="padding:6px; border:1px solid #000; color:${statusColor}; font-weight:bold;">${escapeHtml(String(t.status || t.Status || "OPEN").toUpperCase())}</td><td style="padding:6px; border:1px solid #000;">${escapeHtml(t.description || t.Description || "")}</td></tr>`;
      })
      .join("");

    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; page-break-inside:auto;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;"><th style="padding:8px 6px; border:1px solid #000;">Ticket ID</th><th style="padding:8px 6px; border:1px solid #000;">Date</th><th style="padding:8px 6px; border:1px solid #000;">Unit</th><th style="padding:8px 6px; border:1px solid #000;">Category</th><th style="padding:8px 6px; border:1px solid #000;">Status</th><th style="padding:8px 6px; border:1px solid #000;">Description</th></tr></thead><tbody>${rows || `<tr><td colspan="6" style="padding:10px; text-align:center;">No tickets found.</td></tr>`}</tbody></table>`;
  } else if (layout === "daily_operations") {
    out += generateTitleBar("DAILY OPERATIONS REPORT");
    const reportDate = document.getElementById("rep-param-date")?.value;
    if (!reportDate) {
      showToast("Please select a report date.", "warning");
      return;
    }
    const targetDate = new Date(reportDate);
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const dayTickets = (cache.tickets || []).filter((t) => {
      const d = new Date(fromSheetDate(t.date || t.Date || "") || 0);
      return d >= targetDate && d < nextDay;
    });
    const dayWorkOrders = (cache.workorders || []).filter((w) => {
      const d = new Date(fromSheetDate(w.date || w.Date || "") || 0);
      return d >= targetDate && d < nextDay;
    });
    const dayUtilities = (cache.utilities || []).filter((u) => {
      const d = new Date(fromSheetDate(u.date || u.Date || "") || 0);
      return d >= targetDate && d < nextDay;
    });

    out += `<div style="margin-bottom:15px;"><strong>Report Date:</strong> ${formatDateForDisplay(reportDate)}</div>`;

    out += `<h3 style="font-size:13px; font-weight:900; text-transform:uppercase; margin:15px 0 8px 0; border-bottom:1px solid #000; padding-bottom:4px;">Maintenance Tickets (${dayTickets.length})</h3>`;
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:15px;"><thead><tr style="background:#f4f4f4;"><th style="padding:6px; border:1px solid #000;">ID</th><th style="padding:6px; border:1px solid #000;">Unit</th><th style="padding:6px; border:1px solid #000;">Category</th><th style="padding:6px; border:1px solid #000;">Status</th></tr></thead><tbody>${dayTickets.map((t) => `<tr><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(t.ticketId || t.TicketId)}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(getUnitNumber(t) || "N/A")}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(t.category || t.Category || "")}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(t.status || t.Status || "")}</td></tr>`).join("") || `<tr><td colspan="4" style="padding:10px; text-align:center;">No tickets</td></tr>`}</tbody></table>`;

    out += `<h3 style="font-size:13px; font-weight:900; text-transform:uppercase; margin:15px 0 8px 0; border-bottom:1px solid #000; padding-bottom:4px;">Work Orders (${dayWorkOrders.length})</h3>`;
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:15px;"><thead><tr style="background:#f4f4f4;"><th style="padding:6px; border:1px solid #000;">ID</th><th style="padding:6px; border:1px solid #000;">Unit</th><th style="padding:6px; border:1px solid #000;">Assigned</th><th style="padding:6px; border:1px solid #000;">Amount</th></tr></thead><tbody>${dayWorkOrders.map((w) => `<tr><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(w.workOrderId || w.WorkOrderId)}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(getUnitNumber(w) || "N/A")}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(w.assigned || w.Assigned || "N/A")}</td><td style="padding:6px; border:1px solid #ccc; text-align:right;">N${formatMoney(w.amount || w.Amount || 0)}</td></tr>`).join("") || `<tr><td colspan="4" style="padding:10px; text-align:center;">No work orders</td></tr>`}</tbody></table>`;

    out += `<h3 style="font-size:13px; font-weight:900; text-transform:uppercase; margin:15px 0 8px 0; border-bottom:1px solid #000; padding-bottom:4px;">Utility Logs (${dayUtilities.length})</h3>`;
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr style="background:#f4f4f4;"><th style="padding:6px; border:1px solid #000;">Unit</th><th style="padding:6px; border:1px solid #000;">Type</th><th style="padding:6px; border:1px solid #000;">Reading</th><th style="padding:6px; border:1px solid #000;">Amount</th></tr></thead><tbody>${dayUtilities.map((u) => `<tr><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(getUnitNumber(u) || "N/A")}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(u.type || u.Type || "")}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(u.reading || u.Reading || "N/A")}</td><td style="padding:6px; border:1px solid #ccc; text-align:right;">N${formatMoney(u.amount || u.Amount || 0)}</td></tr>`).join("") || `<tr><td colspan="4" style="padding:10px; text-align:center;">No utility logs</td></tr>`}</tbody></table>`;
  } else if (layout === "monthly_fm") {
    out += generateTitleBar("MONTHLY FM REPORT");
    const monthVal = document.getElementById("rep-param-month")?.value;
    if (!monthVal) {
      showToast("Please select a month.", "warning");
      return;
    }
    const [year, month] = monthVal.split("-");
    const monthStart = new Date(parseInt(year), parseInt(month) - 1, 1);
    const monthEnd = new Date(
      parseInt(year),
      parseInt(month),
      0,
      23,
      59,
      59,
      999,
    );

    const monthTickets = (cache.tickets || []).filter((t) => {
      const d = new Date(fromSheetDate(t.date || t.Date || "") || 0);
      return d >= monthStart && d <= monthEnd;
    });
    const monthWO = (cache.workorders || []).filter((w) => {
      const d = new Date(fromSheetDate(w.date || w.Date || "") || 0);
      return d >= monthStart && d <= monthEnd;
    });
    const monthPayments = (cache.payments || []).filter((p) => {
      const d = new Date(fromSheetDate(p.date || p.Date || "") || 0);
      return d >= monthStart && d <= monthEnd;
    });

    const totalWOPending = monthWO.filter(
      (w) =>
        String(w.status || w.Status || "").toUpperCase() === "PENDING APPROVAL",
    ).length;
    const totalWOApproved = monthWO.filter(
      (w) => String(w.status || w.Status || "").toUpperCase() === "APPROVED",
    ).length;
    const totalInflow = monthPayments
      .filter((p) => p.direction === "INFLOW")
      .reduce((s, p) => s + parseFloat(p.amount || p.Amount || 0), 0);
    const totalOutflow = monthPayments
      .filter((p) => p.direction === "OUTFLOW")
      .reduce((s, p) => s + parseFloat(p.amount || p.Amount || 0), 0);
    const cashExp = (cache.cashExpenses || []).filter((c) => {
      const d = new Date(fromSheetDate(c.date || c.Date || "") || 0);
      return d >= monthStart && d <= monthEnd;
    }).reduce((s, c) => s + parseFloat(c.amount || c.Amount || 0), 0);
    const netPosition = totalInflow - totalOutflow - cashExp;

    out += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
      <div style="background:#e8f4fd; border:2px solid #0d6efd; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#0d6efd; text-transform:uppercase;">Tickets Logged</div><div style="font-size:22px; font-weight:900;">${monthTickets.length}</div></div>
      <div style="background:#e8f5e9; border:2px solid #198754; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#198754; text-transform:uppercase;">Work Orders</div><div style="font-size:22px; font-weight:900;">${monthWO.length}</div></div>
      <div style="background:#fdecea; border:2px solid #dc3545; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#dc3545; text-transform:uppercase;">Pending WO</div><div style="font-size:22px; font-weight:900;">${totalWOPending}</div></div>
      <div style="background:#fff8e1; border:2px solid #ffc107; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#856404; text-transform:uppercase;">Approved WO</div><div style="font-size:22px; font-weight:900;">${totalWOApproved}</div></div>
    </div>`;

    out += `<div style="background:#f8f9fa; border:2px solid #000; border-radius:12px; padding:16px; margin-bottom:20px; text-align:center;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div><div style="font-size:11px; font-weight:800; text-transform:uppercase; color:#198754;">Total Inflow</div><div style="font-size:20px; font-weight:900; color:#198754;">N${formatMoney(totalInflow)}</div></div>
        <div><div style="font-size:11px; font-weight:800; text-transform:uppercase; color:#dc3545;">Total Outflow</div><div style="font-size:20px; font-weight:900; color:#dc3545;">N${formatMoney(totalOutflow)}</div></div>
      </div>
      <div style="font-size:12px; font-weight:800; margin-top:10px;">Cash Expenses Deducted: N${formatMoney(cashExp)}</div>
      <div style="border-top:1px solid #adb5bd; margin-top:10px; padding-top:10px;">
        <div style="font-size:11px; font-weight:800; text-transform:uppercase;">Net Position</div>
        <div style="font-size:24px; font-weight:900; color:${netPosition >= 0 ? "#198754" : "#dc3545"};">${netPosition >= 0 ? "" : "-"}N${formatMoney(Math.abs(netPosition))}</div>
      </div>
    </div>`;

    out += `<h3 style="font-size:13px; font-weight:900; text-transform:uppercase; margin:15px 0 8px 0; border-bottom:1px solid #000; padding-bottom:4px;">Work Orders Detail</h3>`;
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr style="background:#f4f4f4;"><th style="padding:6px; border:1px solid #000;">ID</th><th style="padding:6px; border:1px solid #000;">Date</th><th style="padding:6px; border:1px solid #000;">Unit</th><th style="padding:6px; border:1px solid #000;">Status</th><th style="padding:6px; border:1px solid #000; text-align:right;">Amount</th></tr></thead><tbody>${monthWO.map((w) => `<tr><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(w.workOrderId || w.WorkOrderId)}</td><td style="padding:6px; border:1px solid #ccc;">${formatDateForDisplay(w.date || w.Date)}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(getUnitNumber(w) || "N/A")}</td><td style="padding:6px; border:1px solid #ccc;">${escapeHtml(w.status || w.Status || "")}</td><td style="padding:6px; border:1px solid #ccc; text-align:right; font-weight:700;">N${formatMoney(w.amount || w.Amount || 0)}</td></tr>`).join("") || `<tr><td colspan="5" style="padding:10px; text-align:center;">No work orders</td></tr>`}</tbody></table>`;
  } else if (layout === "kpi_dashboard") {
    out += generateTitleBar("EXECUTIVE KPI DASHBOARD");
    const monthVal = document.getElementById("rep-param-month")?.value;
    if (!monthVal) {
      showToast("Please select a month.", "warning");
      return;
    }
    const [year, month] = monthVal.split("-");
    const monthStart = new Date(parseInt(year), parseInt(month) - 1, 1);
    const monthEnd = new Date(
      parseInt(year),
      parseInt(month),
      0,
      23,
      59,
      59,
      999,
    );

    const totalApts = (cache.apts || []).filter(
      (a) => String(a.type || a.Type || "").toLowerCase() !== "services",
    ).length;
    const occupiedApts = (cache.apts || []).filter(
      (a) => String(a.status || a.Status || "").toLowerCase() === "occupied",
    ).length;
    const occupancyRate =
      totalApts > 0 ? ((occupiedApts / totalApts) * 100).toFixed(1) : 0;

    const totalAssets = (cache.assets || []).length;
    const overdueAssets = (cache.assets || []).filter((a) => {
      const nextDate = parseToLocalDateObject(
        a.nextService || a.NextService || "",
      );
      return nextDate && nextDate <= new Date().setHours(0, 0, 0, 0);
    }).length;

    const openTickets = (cache.tickets || []).filter(
      (t) => String(t.status || t.Status || "").toLowerCase() !== "resolved",
    ).length;
    const pendingWO = (cache.workorders || []).filter(
      (w) =>
        String(w.status || w.Status || "").toUpperCase() === "PENDING APPROVAL",
    ).length;

    const allPayments = cache.payments || [];
    const totalInflow = allPayments
      .filter((p) => p.direction === "INFLOW")
      .reduce((s, p) => s + parseFloat(p.amount || p.Amount || 0), 0);
    const totalOutflow = allPayments
      .filter((p) => p.direction === "OUTFLOW")
      .reduce((s, p) => s + parseFloat(p.amount || p.Amount || 0), 0);
    const cashExp = (cache.cashExpenses || []).reduce(
      (s, c) => s + parseFloat(c.amount || c.Amount || 0),
      0,
    );

    out += `<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:20px;">
      <div style="background:#e8f4fd; border:2px solid #0d6efd; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#0d6efd; text-transform:uppercase;">Occupancy Rate</div><div style="font-size:28px; font-weight:900;">${occupancyRate}%</div><div style="font-size:12px; color:#666;">${occupiedApts} / ${totalApts} units</div></div>
      <div style="background:#fdecea; border:2px solid #dc3545; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#dc3545; text-transform:uppercase;">PM Overdue</div><div style="font-size:28px; font-weight:900;">${overdueAssets}</div><div style="font-size:12px; color:#666;">of ${totalAssets} assets</div></div>
      <div style="background:#fff8e1; border:2px solid #ffc107; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#856404; text-transform:uppercase;">Open Tickets</div><div style="font-size:28px; font-weight:900;">${openTickets}</div></div>
    </div>`;

    out += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
      <div style="background:#f8f9fa; border:2px solid #000; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; text-transform:uppercase;">Pending Work Orders</div><div style="font-size:24px; font-weight:900;">${pendingWO}</div></div>
      <div style="background:#e8f5e9; border:2px solid #198754; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;"><div style="font-size:11px; font-weight:800; color:#198754; text-transform:uppercase;">Net Position</div><div style="font-size:24px; font-weight:900; color:${totalInflow - totalOutflow - cashExp >= 0 ? "#198754" : "#dc3545"};">${totalInflow - totalOutflow - cashExp >= 0 ? "" : "-"}N${formatMoney(Math.abs(totalInflow - totalOutflow - cashExp))}</div></div>
    </div>`;

    out += `<div style="background:#fff; border:2px solid #000; border-radius:12px; padding:16px;">
      <h3 style="font-size:13px; font-weight:900; text-transform:uppercase; margin:0 0 10px 0; border-bottom:1px solid #ccc; padding-bottom:4px;">Financial Summary</h3>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e9ecef;"><span style="font-weight:700;">Total Inflow</span><span style="font-weight:900; color:#198754;">N${formatMoney(totalInflow)}</span></div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e9ecef;"><span style="font-weight:700;">Total Outflow</span><span style="font-weight:900; color:#dc3545;">N${formatMoney(totalOutflow)}</span></div>
      <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e9ecef;"><span style="font-weight:700;">Cash Expenses</span><span style="font-weight:900;">N${formatMoney(cashExp)}</span></div>
      <div style="display:flex; justify-content:space-between; padding:8px 0 0 0; margin-top:8px; border-top:2px solid #000;"><span style="font-weight:900; font-size:14px;">NET POSITION</span><span style="font-weight:900; font-size:18px; color:${totalInflow - totalOutflow - cashExp >= 0 ? "#198754" : "#dc3545"};">${totalInflow - totalOutflow - cashExp >= 0 ? "" : "-"}N${formatMoney(Math.abs(totalInflow - totalOutflow - cashExp))}</span></div>
    </div>`;
  } else if (layout === "data_quality") {
    out += generateTitleBar("DATA QUALITY AUDIT");
    const issues = buildDataQualityIssues();
    const rows = issues
      .map(
        (issue) => `<tr>
          <td style="padding:6px; border:1px solid #000; font-weight:bold;">${escapeHtml(issue.area)}</td>
          <td style="padding:6px; border:1px solid #000;">${escapeHtml(issue.record)}</td>
          <td style="padding:6px; border:1px solid #000;">${escapeHtml(issue.issue)}</td>
          <td style="padding:6px; border:1px solid #000;">${escapeHtml(issue.severity)}</td>
        </tr>`,
      )
      .join("");
    out += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:15px;">
      <div style="background:#fdecea; border:2px solid #dc3545; border-radius:12px; padding:14px; text-align:center;"><div style="font-size:11px; font-weight:800; color:#dc3545; text-transform:uppercase;">Issues Found</div><div style="font-size:24px; font-weight:900;">${issues.length}</div></div>
      <div style="background:#e8f5e9; border:2px solid #198754; border-radius:12px; padding:14px; text-align:center;"><div style="font-size:11px; font-weight:800; color:#198754; text-transform:uppercase;">Records Checked</div><div style="font-size:24px; font-weight:900;">${getTotalRecordCount()}</div></div>
    </div>`;
    out += `<table style="width:100%; border-collapse:collapse; font-size:12px;"><thead style="display:table-header-group;"><tr style="background:#f4f4f4;"><th style="padding:8px 6px; border:1px solid #000;">Area</th><th style="padding:8px 6px; border:1px solid #000;">Record</th><th style="padding:8px 6px; border:1px solid #000;">Issue</th><th style="padding:8px 6px; border:1px solid #000;">Severity</th></tr></thead><tbody>${rows || `<tr><td colspan="4" style="padding:10px; text-align:center;">No data quality issues found.</td></tr>`}</tbody></table>`;
  } else {
    out += `<p style="padding:20px; font-weight:700; color:var(--muted);">Report type not available. Please select a different report.</p>`;
  }

  out += `</div>`;
  const ref = generateReportRef("RPT");
  const wrapped = wrapReportContent(
    out,
    layout.replace(/_/g, " ").toUpperCase(),
    ref,
  );
  if (viewport) viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportFilename = "Facility_Report_" + Date.now();
  window.currentReportAttachmentManifest = [];
  window.currentReportTitle = layout;
  window.currentReportRef = ref;
  window.currentReportRawContent = out;
  const previewCard = document.getElementById("report-onscreen-preview-card");
  if (previewCard) previewCard.style.display = "block";
}

function getTotalRecordCount() {
  return [
    cache.apts,
    cache.assets,
    cache.tickets,
    cache.workorders,
    cache.inventory,
    cache.staff,
    cache.vendors,
    cache.utilities,
    cache.payments,
    cache.expenseRequests,
    cache.cashExpenses,
  ].reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
}

function buildDataQualityIssues() {
  const issues = [];
  const add = (area, record, issue, severity = "Medium") =>
    issues.push({ area, record: String(record || "N/A"), issue, severity });

  (cache.apts || []).forEach((a) => {
    const unit = getUnitNumber(a);
    if (!unit) add("Apartments", a.tenant || a.Tenant, "Missing unit/apartment number", "High");
    if (!a.type && !a.Type) add("Apartments", unit, "Missing unit type");
  });
  (cache.assets || []).forEach((a) => {
    const tag = a.tag || a.Tag;
    if (!tag) add("Assets", getUnitNumber(a), "Missing asset tag", "High");
    if (!getUnitNumber(a)) add("Assets", tag, "Missing linked unit/service area");
    if ((a.photos || a.Photos || "").includes("drive.google.com") && !extractDriveFileId(a.photos || a.Photos)) {
      add("Assets", tag, "Photo link is not a supported Drive file URL");
    }
  });
  (cache.tickets || []).forEach((t) => {
    const id = t.ticketId || t.TicketId;
    if (!id) add("Maintenance", getUnitNumber(t), "Missing ticket ID", "High");
    if (!t.date && !t.Date) add("Maintenance", id, "Missing ticket date");
    if (!t.description && !t.Description) add("Maintenance", id, "Missing description");
  });
  (cache.workorders || []).forEach((w) => {
    const id = w.workOrderId || w.WorkOrderId;
    if (!id) add("Work Orders", getUnitNumber(w), "Missing work order ID", "High");
    if (!w.assigned && !w.Assigned) add("Work Orders", id, "Missing assignee/vendor");
    if (!w.amount && !w.Amount) add("Work Orders", id, "Missing negotiated amount");
  });
  (cache.payments || []).forEach((p) => {
    const id = p.paymentId || p.PaymentId;
    if (!id) add("Payments", p.party || p.Party, "Missing payment ID", "High");
    if (!p.direction && !p.Direction) add("Payments", id, "Missing direction");
    if (!p.party && !p.Party) add("Payments", id, "Missing party");
    try {
      const stages = p.stages || p.Stages ? JSON.parse(p.stages || p.Stages) : [];
      const stageTotal = stages.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
      const total = parseFloat(p.totalJobValue || p.TotalJobValue || 0);
      if (total && stageTotal > total) add("Payments", id, "Payment stages exceed total contract value", "High");
    } catch (e) {
      add("Payments", id, "Invalid payment stages JSON", "High");
    }
  });
  return issues;
}

function downloadCurrentReportCSV() {
  const source = document.getElementById("report-preview-viewport");
  if (!source || !source.innerHTML.trim()) {
    showToast("Please generate a report first.", "warning");
    return;
  }
  const rows = [];
  source.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th,td")].map((cell) =>
        `"${String(cell.textContent || "").replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`,
      );
      if (cells.length) rows.push(cells.join(","));
    });
    rows.push("");
  });
  if (!rows.length) {
    showToast("No table data found for CSV export.", "warning");
    return;
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${window.currentReportFilename || "Facility_Report"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast("CSV exported", "success");
}

// =========================================================
// § COMPREHENSIVE FINANCIAL LEDGER
// =========================================================
function generateComprehensiveFinancialLedger() {
  const viewport = document.getElementById("report-preview-viewport");
  if (!viewport) return;

  const startRaw = document.getElementById("rep_start_date")?.value;
  const endRaw = document.getElementById("rep_end_date")?.value;
  if (!startRaw || !endRaw) {
    showToast("Please select a date range.", "warning");
    return;
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  endDate.setHours(23, 59, 59, 999);

  let totalInflow = 0,
    totalOutflow = 0,
    pendingInflow = 0,
    totalUnpaid = 0,
    cashExpenses = 0;

  const inflowPaidRows = [];
  const inflowPendingRows = [];
  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "INFLOW") return;
    const d = new Date(fromSheetDate(p.date || p.Date || "") || 0);
    if (d < startDate || d > endDate) return;

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
        const unpaidAmt = Math.max(totalContract - paidStagesTotal, 0);
        stages.forEach((s) => {
          if (s.status === "Paid") {
            totalInflow += parseFloat(s.amount) || 0;
            inflowPaidRows.push({
              id: p.paymentId || p.PaymentId,
              date: p.date || p.Date,
              party: p.party || p.Party || "N/A",
              amount: parseFloat(s.amount) || 0,
              type: p.type || p.Type || "",
              stageLabel: s.label,
            });
          } else {
            inflowPendingRows.push({
              id: p.paymentId || p.PaymentId,
              date: p.date || p.Date,
              party: p.party || p.Party || "N/A",
              amount: parseFloat(s.amount) || 0,
              type: p.type || p.Type || "",
              stageLabel: s.label,
            });
          }
        });
        pendingInflow += unpaidAmt;
      } catch (e) {}
    } else {
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      const amt = parseFloat(p.amount || p.Amount || 0);
      if (isCleared) {
        totalInflow += amt;
        inflowPaidRows.push({
          id: p.paymentId || p.PaymentId,
          date: p.date || p.Date,
          party: p.party || p.Party || "N/A",
          amount: amt,
          type: p.type || p.Type || "",
        });
      } else {
        pendingInflow += amt;
        inflowPendingRows.push({
          id: p.paymentId || p.PaymentId,
          date: p.date || p.Date,
          party: p.party || p.Party || "N/A",
          amount: amt,
          type: p.type || p.Type || "",
        });
      }
    }
  });

  const outflowPaidRows = [];
  const outflowPendingRows = [];
  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "OUTFLOW") return;
    const d = new Date(fromSheetDate(p.date || p.Date || "") || 0);
    if (d < startDate || d > endDate) return;

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
        const unpaidAmt = Math.max(totalContract - paidStagesTotal, 0);
        totalUnpaid += unpaidAmt;
        stages.forEach((s) => {
          if (s.status === "Paid") {
            totalOutflow += parseFloat(s.amount) || 0;
            outflowPaidRows.push({
              id: p.paymentId || p.PaymentId,
              date: p.date || p.Date,
              party: p.party || p.Party || "N/A",
              amount: parseFloat(s.amount) || 0,
              type: p.type || p.Type || "",
              stageLabel: s.label,
            });
          } else {
            outflowPendingRows.push({
              id: p.paymentId || p.PaymentId,
              date: p.date || p.Date,
              party: p.party || p.Party || "N/A",
              amount: parseFloat(s.amount) || 0,
              type: p.type || p.Type || "",
              stageLabel: s.label,
            });
          }
        });
      } catch (e) {}
    } else {
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      const amt = parseFloat(p.amount || p.Amount || 0);
      if (isCleared) {
        totalOutflow += amt;
        outflowPaidRows.push({
          id: p.paymentId || p.PaymentId,
          date: p.date || p.Date,
          party: p.party || p.Party || "N/A",
          amount: amt,
          type: p.type || p.Type || "",
        });
      } else {
        totalUnpaid += amt;
        outflowPendingRows.push({
          id: p.paymentId || p.PaymentId,
          date: p.date || p.Date,
          party: p.party || p.Party || "N/A",
          amount: amt,
          type: p.type || p.Type || "",
        });
      }
    }
  });

  const cashExpenseRows = [];
  (cache.cashExpenses || []).forEach((c) => {
    if (!c) return;
    const d = new Date(fromSheetDate(c.date || c.Date || "") || 0);
    if (d < startDate || d > endDate) return;
    const amt = parseFloat(c.amount || c.Amount || 0);
    cashExpenses += amt;
    cashExpenseRows.push({
      id: c.cashId || c.CashId,
      date: c.date || c.Date,
      party: c.description || c.Description || "N/A",
      amount: amt,
      type: "Cash Expense",
    });
  });

  const netPosition = totalInflow - totalOutflow - cashExpenses;
  const netColor = netPosition >= 0 ? "#198754" : "#dc3545";

  let out = `<div style="font-family:'Helvetica','Inter',sans-serif; color:#000; background:#fff; box-sizing:border-box; width:100%; max-width:900px; margin:0 auto; padding:0; line-height:1.4;">`;

  out += `
    <div style="border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:flex-end;">
      <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">COMPREHENSIVE FINANCIAL LEDGER</h2>
      <div style="text-align:right; font-size:12px;">
        <p style="margin:0; color:#555;">PERIOD:</p>
        <p style="margin:2px 0 0 0; font-weight:bold;">${startDate.toLocaleDateString("en-GB")} &mdash; ${endDate.toLocaleDateString("en-GB")}</p>
      </div>
    </div>`;

  // 1. NET FINANCIAL POSITION
  out += `
    <div style="margin-bottom:25px; page-break-inside:avoid;">
      <h3 style="font-size:14px; font-weight:900; text-transform:uppercase; margin:0 0 10px 0; color:#000; border-bottom:1px solid #000; padding-bottom:4px;">1. Net Financial Position</h3>
      <div style="background:#fff; border:2px solid #000; border-radius:16px; padding:16px; page-break-inside:avoid;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e9ecef;">
          <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#000; letter-spacing:0.3px;">Total Inflow</span>
          <span style="font-size:16px; font-weight:900; font-family:'Inter',sans-serif; color:#198754;">N${formatMoney(totalInflow)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e9ecef;">
          <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#000; letter-spacing:0.3px;">Pending Inflow</span>
          <span style="font-size:16px; font-weight:900; font-family:'Inter',sans-serif; color:#0d6efd;">N${formatMoney(pendingInflow)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e9ecef;">
          <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#000; letter-spacing:0.3px;">Total Outflow</span>
          <span style="font-size:16px; font-weight:900; font-family:'Inter',sans-serif; color:#dc3545;">N${formatMoney(totalOutflow)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e9ecef;">
          <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#000; letter-spacing:0.3px;">Total Unpaid</span>
          <span style="font-size:16px; font-weight:900; font-family:'Inter',sans-serif; color:#fd7e14;">N${formatMoney(totalUnpaid)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #e9ecef;">
          <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#000; letter-spacing:0.3px;">Cash Expenses</span>
          <span style="font-size:16px; font-weight:900; font-family:'Inter',sans-serif; color:#000;">N${formatMoney(cashExpenses)}</span>
        </div>
        <div style="border-top:2px solid #adb5bd; margin:10px 0;"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0;">
          <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#000; letter-spacing:0.3px;">Net Position</span>
          <span style="font-size:16px; font-weight:900; font-family:'Inter',sans-serif; color:${netColor};">${netPosition < 0 ? "-" : ""}N${formatMoney(Math.abs(netPosition))}</span>
        </div>
      </div>
    </div>`;

  const renderTable = (title, rows, color, isPending) => {
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const pendingLabel = isPending ? " &mdash; PENDING" : " &mdash; PAID";
    return `
    <div style="margin-bottom:25px; page-break-inside:avoid;">
      <h3 style="font-size:14px; font-weight:900; text-transform:uppercase; margin:0 0 10px 0; color:${color}; border-bottom:2px solid ${color}; padding-bottom:4px;">${title}${pendingLabel}</h3>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px;">
        <thead><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;">
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">ID</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Date</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Party</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:right;">Amount</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Type</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
            <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.id)}</td>
            <td style="padding:6px; border:1px solid #ccc;">${formatDateForDisplay(r.date)}</td>
            <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.party)}${r.stageLabel ? ` <span style="font-size:10px; color:#666;">(${escapeHtml(r.stageLabel)})</span>` : ""}</td>
            <td style="padding:6px; border:1px solid #ccc; text-align:right; font-weight:700;">N${formatMoney(r.amount)}</td>
            <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.type)}</td>
          </tr>`,
            )
            .join("")}
          <tr style="background:#f9f9f9; font-weight:900;">
            <td colspan="3" style="padding:8px; border:1px solid #000; text-align:right;">TOTAL</td>
            <td style="padding:8px; border:1px solid #000; text-align:right; color:${color};">N${formatMoney(total)}</td>
            <td style="padding:8px; border:1px solid #000;"></td>
          </tr>
        </tbody>
      </table>
    </div>`;
  };

  out += renderTable("2. Total Outflow", outflowPaidRows, "#dc3545", false);
  out += renderTable("3. Outflow", outflowPendingRows, "#fd7e14", true);
  out += renderTable("4. Inflow", inflowPaidRows, "#198754", false);
  out += renderTable("5. Inflow", inflowPendingRows, "#0d6efd", true);
  out += renderTable("6. Cash Expenses", cashExpenseRows, "#000", false);

  out += `</div>`;

  const ref = generateReportRef("RPT");
  const wrapped = wrapReportContent(out, "Comprehensive Financial Ledger", ref);
  viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportFilename = "Comprehensive_Financial_Ledger_" + Date.now();
  window.currentReportAttachmentManifest = [];
  window.currentReportTitle = "Comprehensive Financial Ledger";
  window.currentReportRef = ref;
  window.currentReportRawContent = out;
  document.getElementById("report-onscreen-preview-card").style.display =
    "block";
}

// =========================================================
// § PENDING OUTFLOW REPORT
// =========================================================
function generatePendingOutflowReport() {
  const viewport = document.getElementById("report-preview-viewport");
  if (!viewport) return;

  const startRaw = document.getElementById("rep_start_date")?.value;
  const endRaw = document.getElementById("rep_end_date")?.value;
  if (!startRaw || !endRaw) {
    showToast("Please select a date range.", "warning");
    return;
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  endDate.setHours(23, 59, 59, 999);

  let totalPending = 0;
  const pendingRows = [];

  (cache.payments || []).forEach((p) => {
    if (!p || p.direction !== "OUTFLOW") return;
    const d = new Date(fromSheetDate(p.date || p.Date || "") || 0);
    if (d < startDate || d > endDate) return;

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
        const unpaidAmt = Math.max(totalContract - paidStagesTotal, 0);
        if (unpaidAmt > 0) {
          totalPending += unpaidAmt;
          pendingRows.push({
            id: p.paymentId || p.PaymentId,
            date: p.date || p.Date,
            party: p.party || p.Party || "N/A",
            amount: unpaidAmt,
            type: p.type || p.Type || "",
            stages: stages
              .filter((s) => s.status !== "Paid")
              .map((s) => s.label)
              .join(", "),
          });
        }
      } catch (e) {}
    } else {
      const isCleared =
        String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
      const amt = parseFloat(p.amount || p.Amount || 0);
      if (!isCleared && amt > 0) {
        totalPending += amt;
        pendingRows.push({
          id: p.paymentId || p.PaymentId,
          date: p.date || p.Date,
          party: p.party || p.Party || "N/A",
          amount: amt,
          type: p.type || p.Type || "",
        });
      }
    }
  });

  let out = `<div style="font-family:'Helvetica','Inter',sans-serif; color:#000; background:#fff; box-sizing:border-box; width:100%; max-width:900px; margin:0 auto; padding:0; line-height:1.4;">`;

  out += `
    <div style="border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:flex-end;">
      <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">PENDING OUTFLOW</h2>
      <div style="text-align:right; font-size:12px;">
        <p style="margin:0; color:#555;">PERIOD:</p>
        <p style="margin:2px 0 0 0; font-weight:bold;">${startDate.toLocaleDateString("en-GB")} &mdash; ${endDate.toLocaleDateString("en-GB")}</p>
      </div>
    </div>`;

  out += `
    <div style="background:#fff3cd; border:2px solid #ffc107; border-radius:12px; padding:16px; margin-bottom:20px; page-break-inside:avoid;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:14px; font-weight:800; text-transform:uppercase; color:#856404;">Total Pending Outflow</span>
        <span style="font-size:22px; font-weight:900; color:#dc3545;">N${formatMoney(totalPending)}</span>
      </div>
    </div>`;

  out += `<table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px;">
    <thead><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;">
      <th style="padding:8px 6px; border:1px solid #000; text-align:left;">ID</th>
      <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Date</th>
      <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Party</th>
      <th style="padding:8px 6px; border:1px solid #000; text-align:right;">Amount</th>
      <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Type</th>
    </tr></thead>
    <tbody>
      ${
        pendingRows.length > 0
          ? pendingRows
              .map(
                (r) => `<tr>
        <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.id)}</td>
        <td style="padding:6px; border:1px solid #ccc;">${formatDateForDisplay(r.date)}</td>
        <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.party)}${r.stages ? ` <span style="font-size:10px; color:#666;">(${escapeHtml(r.stages)})</span>` : ""}</td>
        <td style="padding:6px; border:1px solid #ccc; text-align:right; font-weight:700;">N${formatMoney(r.amount)}</td>
        <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.type)}</td>
      </tr>`,
              )
              .join("")
          : `<tr><td colspan="5" style="padding:10px; text-align:center; color:#666;">No records</td></tr>`
      }
      <tr style="background:#f9f9f9; font-weight:900;">
        <td colspan="3" style="padding:8px; border:1px solid #000; text-align:right;">TOTAL</td>
        <td style="padding:8px; border:1px solid #000; text-align:right; color:#dc3545;">N${formatMoney(totalPending)}</td>
        <td style="padding:8px; border:1px solid #000;"></td>
      </tr>
    </tbody>
  </table>`;

  out += `</div>`;

  const ref = generateReportRef("RPT");
  const wrapped = wrapReportContent(out, "Pending Outflow", ref);
  viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportFilename = "Pending_Outflow_" + Date.now();
  window.currentReportAttachmentManifest = [];
  window.currentReportTitle = "Pending Outflow";
  window.currentReportRef = ref;
  window.currentReportRawContent = out;
  document.getElementById("report-onscreen-preview-card").style.display =
    "block";
}

// =========================================================
// § LEDGER REPORT (Inflow/Outflow/Cash with Paid & Pending)
// =========================================================
function generateLedgerReport(ledgerType) {
  const viewport = document.getElementById("report-preview-viewport");
  if (!viewport) return;

  const startRaw = document.getElementById("rep_start_date")?.value;
  const endRaw = document.getElementById("rep_end_date")?.value;
  if (!startRaw || !endRaw) {
    showToast("Please select a date range.", "warning");
    return;
  }
  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  endDate.setHours(23, 59, 59, 999);

  let out = `<div style="font-family:'Helvetica','Inter',sans-serif; color:#000; background:#fff; box-sizing:border-box; width:100%; max-width:900px; margin:0 auto; padding:0; line-height:1.4;">`;

  const renderTable = (title, rows, color, isPending) => {
    if (rows.length === 0)
      return `<p style="padding:15px; text-align:center; font-weight:700; color:#666;">No ${isPending ? "pending" : "paid"} records found.</p>`;
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    const statusLabel = isPending ? "PENDING" : "PAID";
    return `
    <div style="margin-bottom:20px; page-break-inside:avoid;">
      <h3 style="font-size:13px; font-weight:900; text-transform:uppercase; margin:0 0 8px 0; color:${color}; border-bottom:2px solid ${color}; padding-bottom:4px;">${title} &mdash; ${statusLabel}</h3>
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px;">
        <thead><tr style="background:#f4f4f4; -webkit-print-color-adjust:exact;">
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">ID</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Date</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Party</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:right;">Amount</th>
          <th style="padding:8px 6px; border:1px solid #000; text-align:left;">Type</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
            <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.id)}</td>
            <td style="padding:6px; border:1px solid #ccc;">${formatDateForDisplay(r.date)}</td>
            <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.party)}${r.stageLabel ? ` <span style="font-size:10px; color:#666;">(${escapeHtml(r.stageLabel)})</span>` : ""}</td>
            <td style="padding:6px; border:1px solid #ccc; text-align:right; font-weight:700;">N${formatMoney(r.amount)}</td>
            <td style="padding:6px; border:1px solid #ccc;">${escapeHtml(r.type)}</td>
          </tr>`,
            )
            .join("")}
          <tr style="background:#f9f9f9; font-weight:900;">
            <td colspan="3" style="padding:8px; border:1px solid #000; text-align:right;">TOTAL</td>
            <td style="padding:8px; border:1px solid #000; text-align:right; color:${color};">N${formatMoney(total)}</td>
            <td style="padding:8px; border:1px solid #000;"></td>
          </tr>
        </tbody>
      </table>
    </div>`;
  };

  if (ledgerType === "inflow_paid_pending") {
    const paidRows = [];
    const pendingRows = [];
    let totalPaid = 0,
      totalPending = 0;

    (cache.payments || []).forEach((p) => {
      if (!p || p.direction !== "INFLOW") return;
      const d = new Date(fromSheetDate(p.date || p.Date || "") || 0);
      if (d < startDate || d > endDate) return;

      if (p.stages || p.Stages) {
        try {
          const stages = JSON.parse(p.stages || p.Stages);
          stages.forEach((s) => {
            const amt = parseFloat(s.amount) || 0;
            if (s.status === "Paid") {
              totalPaid += amt;
              paidRows.push({
                id: p.paymentId || p.PaymentId,
                date: p.date || p.Date,
                party: p.party || p.Party || "N/A",
                amount: amt,
                type: p.type || p.Type || "",
                stageLabel: s.label,
              });
            } else {
              totalPending += amt;
              pendingRows.push({
                id: p.paymentId || p.PaymentId,
                date: p.date || p.Date,
                party: p.party || p.Party || "N/A",
                amount: amt,
                type: p.type || p.Type || "",
                stageLabel: s.label,
              });
            }
          });
        } catch (e) {}
      } else {
        const isCleared =
          String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
        const amt = parseFloat(p.amount || p.Amount || 0);
        if (isCleared) {
          totalPaid += amt;
          paidRows.push({
            id: p.paymentId || p.PaymentId,
            date: p.date || p.Date,
            party: p.party || p.Party || "N/A",
            amount: amt,
            type: p.type || p.Type || "",
          });
        } else {
          totalPending += amt;
          pendingRows.push({
            id: p.paymentId || p.PaymentId,
            date: p.date || p.Date,
            party: p.party || p.Party || "N/A",
            amount: amt,
            type: p.type || p.Type || "",
          });
        }
      }
    });

    out += `
      <div style="border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:flex-end;">
        <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">INFLOW LEDGER</h2>
        <div style="text-align:right; font-size:12px;">
          <p style="margin:0; color:#555;">PERIOD:</p>
          <p style="margin:2px 0 0 0; font-weight:bold;">${startDate.toLocaleDateString("en-GB")} &mdash; ${endDate.toLocaleDateString("en-GB")}</p>
        </div>
      </div>`;

    out += `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
        <div style="background:#e8f5e9; border:2px solid #198754; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;">
          <div style="font-size:11px; font-weight:800; color:#198754; text-transform:uppercase;">Total Paid</div>
          <div style="font-size:20px; font-weight:900; color:#198754;">N${formatMoney(totalPaid)}</div>
        </div>
        <div style="background:#e8f4fd; border:2px solid #0d6efd; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;">
          <div style="font-size:11px; font-weight:800; color:#0d6efd; text-transform:uppercase;">Total Pending</div>
          <div style="font-size:20px; font-weight:900; color:#0d6efd;">N${formatMoney(totalPending)}</div>
        </div>
      </div>`;

    out += renderTable("Inflow", paidRows, "#198754", false);
    out += renderTable("Inflow", pendingRows, "#0d6efd", true);
  } else if (ledgerType === "outflow_paid_pending") {
    const paidRows = [];
    const pendingRows = [];
    let totalPaid = 0,
      totalPending = 0;

    (cache.payments || []).forEach((p) => {
      if (!p || p.direction !== "OUTFLOW") return;
      const d = new Date(fromSheetDate(p.date || p.Date || "") || 0);
      if (d < startDate || d > endDate) return;

      if (p.stages || p.Stages) {
        try {
          const stages = JSON.parse(p.stages || p.Stages);
          stages.forEach((s) => {
            const amt = parseFloat(s.amount) || 0;
            if (s.status === "Paid") {
              totalPaid += amt;
              paidRows.push({
                id: p.paymentId || p.PaymentId,
                date: p.date || p.Date,
                party: p.party || p.Party || "N/A",
                amount: amt,
                type: p.type || p.Type || "",
                stageLabel: s.label,
              });
            } else {
              totalPending += amt;
              pendingRows.push({
                id: p.paymentId || p.PaymentId,
                date: p.date || p.Date,
                party: p.party || p.Party || "N/A",
                amount: amt,
                type: p.type || p.Type || "",
                stageLabel: s.label,
              });
            }
          });
        } catch (e) {}
      } else {
        const isCleared =
          String(p.isPaid).toUpperCase() === "TRUE" || p.isPaid === true;
        const amt = parseFloat(p.amount || p.Amount || 0);
        if (isCleared) {
          totalPaid += amt;
          paidRows.push({
            id: p.paymentId || p.PaymentId,
            date: p.date || p.Date,
            party: p.party || p.Party || "N/A",
            amount: amt,
            type: p.type || p.Type || "",
          });
        } else {
          totalPending += amt;
          pendingRows.push({
            id: p.paymentId || p.PaymentId,
            date: p.date || p.Date,
            party: p.party || p.Party || "N/A",
            amount: amt,
            type: p.type || p.Type || "",
          });
        }
      }
    });

    out += `
      <div style="border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:flex-end;">
        <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">OUTFLOW LEDGER</h2>
        <div style="text-align:right; font-size:12px;">
          <p style="margin:0; color:#555;">PERIOD:</p>
          <p style="margin:2px 0 0 0; font-weight:bold;">${startDate.toLocaleDateString("en-GB")} &mdash; ${endDate.toLocaleDateString("en-GB")}</p>
        </div>
      </div>`;

    out += `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
        <div style="background:#fdecea; border:2px solid #dc3545; border-radius:12px; padding:14px; text-align:center; page-break-inside:avoid;">
          <div style="font-size:11px; font-weight:800; color:#dc3545; text-transform:uppercase;">Total Paid</div>
          <div style="font-size:20px; font-weight:900; color:#dc3545;">N${formatMoney(totalPaid)}</div>
        </div>
        <div style="background:#fff3cd; border:2px solid #ffc107; border-radius:12px; padding:14px; text-align:center;">
          <div style="font-size:11px; font-weight:800; color:#856404; text-transform:uppercase;">Total Pending</div>
          <div style="font-size:20px; font-weight:900; color:#fd7e14;">N${formatMoney(totalPending)}</div>
        </div>
      </div>`;

    out += renderTable("Outflow", paidRows, "#dc3545", false);
    out += renderTable("Outflow", pendingRows, "#fd7e14", true);
  } else if (ledgerType === "cash_expenses") {
    const rows = [];
    let total = 0;

    (cache.cashExpenses || []).forEach((c) => {
      if (!c) return;
      const d = new Date(fromSheetDate(c.date || c.Date || "") || 0);
      if (d < startDate || d > endDate) return;
      const amt = parseFloat(c.amount || c.Amount || 0);
      total += amt;
      rows.push({
        id: c.cashId || c.CashId,
        date: c.date || c.Date,
        party: c.description || c.Description || "N/A",
        amount: amt,
        type: "Cash Expense",
      });
    });

    out += `
      <div style="border-bottom:2px solid #000; padding-bottom:10px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:flex-end;">
        <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">CASH EXPENSES LEDGER</h2>
        <div style="text-align:right; font-size:12px;">
          <p style="margin:0; color:#555;">PERIOD:</p>
          <p style="margin:2px 0 0 0; font-weight:bold;">${startDate.toLocaleDateString("en-GB")} &mdash; ${endDate.toLocaleDateString("en-GB")}</p>
        </div>
      </div>`;

    out += `
      <div style="background:#f8f9fa; border:2px solid #000; border-radius:12px; padding:14px; margin-bottom:20px; text-align:center;">
        <div style="font-size:11px; font-weight:800; color:#000; text-transform:uppercase;">Total Cash Expenses</div>
        <div style="font-size:22px; font-weight:900; color:#000;">N${formatMoney(total)}</div>
      </div>`;

    out += renderTable("Cash Expenses", rows, "#000", false);
  }

  out += `</div>`;

  const ref = generateReportRef("RPT");
  const titleMap = {
    inflow_paid_pending: "Inflow Ledger",
    outflow_paid_pending: "Outflow Ledger",
    cash_expenses: "Cash Expenses Ledger",
  };
  const wrapped = wrapReportContent(out, titleMap[ledgerType], ref);
  viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportFilename =
    titleMap[ledgerType].replace(/\s+/g, "_") + "_" + Date.now();
  window.currentReportAttachmentManifest = [];
  window.currentReportTitle = titleMap[ledgerType];
  window.currentReportRef = ref;
  window.currentReportRawContent = out;
  document.getElementById("report-onscreen-preview-card").style.display =
    "block";
}

function downloadCurrentReportPDF() {
  const source = document.getElementById("report-preview-viewport");
  if (!source || !source.innerHTML.trim()) {
    showToast("Please generate a report first.", "warning");
    return;
  }
  const rawContent = window.currentReportRawContent || source.innerHTML;
  compileAndDownloadUnifiedPDF(
    rawContent,
    window.currentReportAttachmentManifest || [],
    window.currentReportFilename || "Facility_Report",
    window.currentReportTitle || "Report",
    window.currentReportRef || "",
  );
}

function printCurrentReport() {
  const source = document.getElementById("report-preview-viewport");
  if (!source || !source.innerHTML.trim()) {
    showToast("Please generate a report first.", "warning");
    return;
  }
  const originalTitle = document.title;
  document.title = window.currentReportFilename || "Facility_Report";
  window.print();
  setTimeout(() => {
    document.title = originalTitle;
  }, 1000);
}

function generateApartmentManifestReport() {
  const viewport = document.getElementById("report-preview-viewport");
  if (!viewport) return;
  window.currentReportFilename = "Apartment_Manifest_" + Date.now();
  window.currentReportAttachmentManifest = [];

  let html = `<div style="font-family:'Arial',sans-serif; color:#000; background:#fff; padding:0; width:100%; margin:0 auto; line-height:1.4;">
    <h3 style="font-size:16px; font-weight:900; text-transform:uppercase; margin:0 0 15px 0; text-decoration:underline;">Apartments Manifest</h3>`;

  (cache.apts || [])
    .filter((a) => a && String(a.type || "").toLowerCase() !== "services")
    .forEach((apt) => {
      const unitId = escapeHtml(getUnitNumber(apt));
      const tenant = escapeHtml(apt.tenant || apt.Tenant || "VACANT");
      const type = escapeHtml(apt.type || apt.Type || "Standard");
      const meter = escapeHtml(
        apt.meterNo || apt.MeterNo || apt.meter || "N/A",
      );
      const rent = apt.rent || apt.Rent;
      const deposit = apt.serviceChargeDeposit || apt.ServiceChargeDeposit;
      const unitAssets = (cache.assets || []).filter(
        (a) =>
          a &&
          String(getUnitNumber(a)) === String(getUnitNumber(apt)) &&
          String(a.status || "") !== "Archived",
      );

      html += `<div style="margin-bottom:25px; page-break-inside:avoid;">
      <table style="width:100%; border-collapse:collapse; border:2px solid #000; font-size:14px; font-weight:bold;">
        <tr><td style="border:1px solid #000; padding:6px; width:15%; background:#f9f9f9;">Unit</td><td style="border:1px solid #000; padding:6px; width:35%;">${unitId}</td><td style="border:1px solid #000; padding:6px; width:15%; background:#f9f9f9;">Tenant</td><td style="border:1px solid #000; padding:6px; width:35%; color:${tenant.toUpperCase() === "VACANT" ? "#DC3545" : "#198754"};">${tenant.toUpperCase()}</td></tr>
        <tr><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Type</td><td style="border:1px solid #000; padding:6px;">${type}</td><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Meter No</td><td style="border:1px solid #000; padding:6px;">${meter}</td></tr>
        <tr><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Current Rent</td><td style="border:1px solid #000; padding:6px;">${rent ? "₦" + formatMoney(rent) + " / yr" : "N/A"}</td><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Service Charge Deposit</td><td style="border:1px solid #000; padding:6px;">${deposit ? "₦" + formatMoney(deposit) : "N/A"}</td></tr>
      </table>
      <div style="margin-top:10px;"><p style="margin:0 0 5px 0; font-size:13px; font-weight:bold; text-decoration:underline;">REGISTERED ASSETS:</p>
        <ul style="margin:0; padding-left:20px; font-size:13px;">
          ${unitAssets.length > 0 ? unitAssets.map((asset) => `<li style="margin-bottom:4px;">${escapeHtml(asset.type || "Asset")} (${escapeHtml(asset.tag || asset.Tag || "NO-TAG")})${asset.specs || asset.Specs ? ` - ${escapeHtml(asset.specs || asset.Specs)}` : ""}</li>`).join("") : `<li style="color:#666; font-style:italic;">No registered assets</li>`}
        </ul>
      </div>
    </div>`;
    });

  html += `</div>`;
  const ref = generateReportRef("RPT");
  const wrapped = wrapReportContent(html, "Apartments Manifest", ref);
  viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportTitle = "Apartments Manifest";
  window.currentReportRef = ref;
  window.currentReportRawContent = html;
  document.getElementById("report-onscreen-preview-card").style.display =
    "block";
}

function generateApartmentDossierReport(targetUnitId) {
  const viewport = document.getElementById("report-preview-viewport");
  if (!viewport) return;
  window.currentReportFilename =
    `Apartment_Dossier_${targetUnitId}_` + Date.now();
  window.currentReportAttachmentManifest = [];

  const apt = (cache.apts || []).find(
    (a) => a && String(getUnitNumber(a)) === String(targetUnitId),
  );
  if (!apt) {
    showToast("Apartment not found.", "error");
    return;
  }

  const type = escapeHtml(apt.type || apt.Type || "Standard");
  const status = escapeHtml(apt.status || apt.Status || "Vacant");
  const meter = escapeHtml(apt.meterNo || apt.MeterNo || apt.meter || "N/A");
  const rent = apt.rent || apt.Rent;
  const deposit = apt.serviceChargeDeposit || apt.ServiceChargeDeposit;

  let html = `<div style="font-family:'Arial',sans-serif; color:#000; background:#fff; padding:0; width:100%; margin:0 auto; line-height:1.4;">
    <h3 style="font-size:16px; font-weight:900; text-transform:uppercase; margin:0 0 15px 0; text-decoration:underline;">Apartment Dossier &bull; Unit ${escapeHtml(targetUnitId)}</h3>
    <table style="width:100%; border-collapse:collapse; border:2px solid #000; font-size:14px; font-weight:bold; margin-bottom:20px;">
      <tr><td style="border:1px solid #000; padding:6px; width:15%; background:#f9f9f9;">Type</td><td style="border:1px solid #000; padding:6px; width:35%;">${type}</td><td style="border:1px solid #000; padding:6px; width:15%; background:#f9f9f9;">Status</td><td style="border:1px solid #000; padding:6px; width:35%; color:${status.toUpperCase() === "VACANT" ? "#DC3545" : "#198754"};">${status}</td></tr>
      <tr><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Meter No</td><td style="border:1px solid #000; padding:6px;">${meter}</td><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Current Rent</td><td style="border:1px solid #000; padding:6px;">${rent ? "₦" + formatMoney(rent) + " / yr" : "N/A"}</td></tr>
      <tr><td style="border:1px solid #000; padding:6px; background:#f9f9f9;">Service Charge Deposit</td><td colspan="3" style="border:1px solid #000; padding:6px;">${deposit ? "₦" + formatMoney(deposit) : "N/A"}</td></tr>
    </table>
    <h3 style="font-size:14px; font-weight:bold; margin:20px 0 10px 0; text-decoration:underline;">ASSETS:</h3>
    <div style="display:flex; flex-wrap:wrap; gap:2%; row-gap:15px;">`;

  const unitAssets = (cache.assets || []).filter(
    (a) =>
      a &&
      String(getUnitNumber(a)) === String(targetUnitId) &&
      String(a.status || "") !== "Archived",
  );
  if (unitAssets.length > 0) {
    unitAssets.forEach((asset) => {
      let imgHtml = `<div style="height:120px; background:#eee; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; color:#aaa; border-bottom:1px solid #ccc;">No Image</div>`;
      if (asset.photos || asset.Photos) {
        const firstPhoto = String(asset.photos || asset.Photos).split(",")[0];
        if (firstPhoto)
          imgHtml = `<div style="height:120px; border-bottom:1px solid #ccc; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fff;"><img src="${getDirectImageUrl(firstPhoto)}" style="max-width:100%; max-height:100%; object-fit:contain;" alt="${escapeHtml(asset.type || "Asset")}"></div>`;
      }
      html += `<div style="width:32%; border:1px solid #000; border-radius:4px; overflow:hidden; page-break-inside:avoid;">${imgHtml}<div style="padding:10px; font-size:12px; line-height:1.5;"><div style="font-weight:900; font-size:13px; margin-bottom:5px;">${escapeHtml(asset.type || asset.Type || "Asset")}</div><div><strong>Specs:</strong> ${escapeHtml(asset.specs || asset.Specs || "N/A")}</div><div><strong>Tag:</strong> ${escapeHtml(asset.tag || asset.Tag)}</div><div><strong>Status:</strong> ${escapeHtml(asset.status || asset.Status || "N/A")}</div></div></div>`;
    });
  } else {
    html += `<div style="font-style:italic; color:#666; font-size:13px;">No physical assets recorded for this unit.</div>`;
  }

  html += `</div></div>`;
  const ref = generateReportRef("RPT");
  const wrapped = wrapReportContent(
    html,
    `Apartment Dossier - Unit ${targetUnitId}`,
    ref,
  );
  viewport.innerHTML = wrapped;
  const printContainer = document.getElementById("report-print-container");
  if (printContainer) printContainer.innerHTML = wrapped;
  window.currentReportTitle = `Apartment Dossier - Unit ${targetUnitId}`;
  window.currentReportRef = ref;
  window.currentReportRawContent = html;
  document.getElementById("report-onscreen-preview-card").style.display =
    "block";
}
