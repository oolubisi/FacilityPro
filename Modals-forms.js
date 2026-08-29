// =========================================================
// MODALS-FORMS.JS — openModal(): all record-type form builders
//                   (apartment, asset, maintenance, workorder,
//                   payment, inventory, utility, generator,
//                   staff, vendor, expenserequest, cashexpense)
// Load order: 5th
// Depends on: core.js, init.js, records.js, modals-core.js
// =========================================================

// § ASSET MAINTENANCE HISTORY
// A lightweight append-only log per asset, separate from the asset's own
// lastServiced/nextService fields — this tracks the running history of
// what was actually done, not just the next due date.
// ─────────────────────────────────────────────
let editingMaintenanceLogId = null; // non-null while the mini-form is in "edit" mode

function renderAssetMaintenanceHistory(assetTag) {
  const listEl = document.getElementById("assetMaintHistoryList");
  if (!listEl) return;
  const entries = (cache.maintenanceLog || [])
    .filter((l) => l && String(l.assetTag || l.AssetTag || "") === String(assetTag))
    .sort((a, b) => {
      const da = parseToLocalDateObject(a.date || a.Date) || new Date(0);
      const db = parseToLocalDateObject(b.date || b.Date) || new Date(0);
      return db - da;
    });

  if (entries.length === 0) {
    listEl.innerHTML = `<p style="color:var(--muted); font-size:14px; margin:0;">No maintenance history logged yet.</p>`;
    return;
  }

  listEl.innerHTML = entries
    .map((entry) => {
      const cost = entry.cost || entry.Cost;
      const logId = escapeHtml(entry.logId || entry.LogId || "");
      return `<div style="padding:8px 0; border-bottom:1px solid #eee;">
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
          <strong style="font-size:14px;">${escapeHtml(formatDateForDisplay(entry.date || entry.Date))}</strong>
          <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            ${cost ? `<span style="font-size:13px; font-weight:800; color:var(--muted);">₦${escapeHtml(formatMoney(cost))}</span>` : ""}
            <button type="button" data-modal-action="edit-maintenance-log" data-log-id="${logId}" data-asset-tag="${escapeHtml(assetTag)}" style="background:none; border:0; color:var(--primary); cursor:pointer; font-size:12px; padding:0;" title="Edit"><i class="fas fa-pen"></i></button>
            <button type="button" data-modal-action="delete-maintenance-log" data-log-id="${logId}" data-asset-tag="${escapeHtml(assetTag)}" style="background:none; border:0; color:var(--danger); cursor:pointer; font-size:12px; padding:0;" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div style="font-size:14px; color:#333; margin-top:2px;">${escapeHtml(entry.note || entry.Note || "")}</div>
      </div>`;
    })
    .join("");
}

function startEditMaintenanceLogEntry(logId, assetTag) {
  const entry = (cache.maintenanceLog || []).find(
    (l) => l && String(l.logId || l.LogId || "") === String(logId),
  );
  if (!entry) return;

  editingMaintenanceLogId = logId;
  document.getElementById("a_log_date").value = fromSheetDate(entry.date || entry.Date || "");
  document.getElementById("a_log_note").value = entry.note || entry.Note || "";
  document.getElementById("a_log_cost").value = entry.cost || entry.Cost || "";
  const btn = document.getElementById("a_log_add_btn");
  btn.textContent = "Update Entry";
  const cancelBtn = document.getElementById("a_log_cancel_btn");
  if (cancelBtn) cancelBtn.style.display = "inline-block";
}

function cancelEditMaintenanceLogEntry() {
  editingMaintenanceLogId = null;
  document.getElementById("a_log_note").value = "";
  document.getElementById("a_log_cost").value = "";
  document.getElementById("a_log_date").value = new Date().toISOString().split("T")[0];
  const btn = document.getElementById("a_log_add_btn");
  btn.textContent = "Add Entry";
  const cancelBtn = document.getElementById("a_log_cancel_btn");
  if (cancelBtn) cancelBtn.style.display = "none";
}

async function deleteMaintenanceLogEntry(logId, assetTag) {
  if (!confirm("Delete this maintenance log entry? This cannot be undone.")) return;
  try {
    const result = await callApi("deleteMaintenanceLog", { logId });
    if (result && result.status === "error") {
      showToast(result.message || "Could not delete log entry.", "error");
      return;
    }
    cache.maintenanceLog = (cache.maintenanceLog || []).filter(
      (l) => String(l.logId || l.LogId || "") !== String(logId),
    );
    if (editingMaintenanceLogId === logId) cancelEditMaintenanceLogEntry();
    renderAssetMaintenanceHistory(assetTag);
    showToast("Maintenance log entry deleted", "success");
  } catch (e) {
    showToast("Could not delete log entry.", "error");
  }
}

async function addAssetMaintenanceLogEntry(assetTag) {
  const dateEl = document.getElementById("a_log_date");
  const noteEl = document.getElementById("a_log_note");
  const costEl = document.getElementById("a_log_cost");
  const btn = document.getElementById("a_log_add_btn");
  const note = sanitizeInput(noteEl.value);
  if (!dateEl.value || !note) {
    showToast("Date and note are required for a log entry.", "warning");
    return;
  }

  const isEditing = !!editingMaintenanceLogId;
  btn.disabled = true;
  btn.textContent = isEditing ? "Updating..." : "Adding...";
  try {
    const logId = isEditing
      ? editingMaintenanceLogId
      : await generateNextRecordId(
          "MLOG",
          "MaintenanceLog",
          "logId",
          cache.maintenanceLog || [],
        );
    const entry = {
      logId,
      assetTag,
      date: toSheetDate(dateEl.value),
      note,
      cost: costEl.value ? parseFloat(costEl.value) || 0 : "",
    };
    const result = await callApi(isEditing ? "updateMaintenanceLog" : "saveMaintenanceLog", entry);
    if (result && result.status === "error") {
      showToast(result.message || "Could not save log entry.", "error");
      return;
    }
    cache.maintenanceLog = cache.maintenanceLog || [];
    if (isEditing) {
      const idx = cache.maintenanceLog.findIndex(
        (l) => String(l.logId || l.LogId || "") === String(logId),
      );
      if (idx !== -1) cache.maintenanceLog[idx] = entry;
    } else {
      cache.maintenanceLog.push(entry);
    }
    renderAssetMaintenanceHistory(assetTag);
    cancelEditMaintenanceLogEntry();
    showToast(isEditing ? "Maintenance log entry updated" : "Maintenance log entry added", "success");
  } catch (e) {
    showToast("Could not save log entry.", "error");
  } finally {
    btn.disabled = false;
    if (!editingMaintenanceLogId) btn.textContent = "Add Entry";
  }
}

// § WORK ORDER ↔ PAYMENT LINK
// A payment's `reference` field already stores the linked Work Order's ID
// when it's created against an approved work order (see the "Approved
// Work Orders" optgroup in the payment form) — this just surfaces that
// existing relationship inside the Work Order modal.
// ─────────────────────────────────────────────
function renderLinkedPaymentsForWorkOrder(workOrderId) {
  const listEl = document.getElementById("woLinkedPaymentsList");
  if (!listEl) return;
  const linked = (cache.payments || []).filter(
    (p) => p && String(p.reference || p.Reference || "") === String(workOrderId),
  );

  if (linked.length === 0) {
    listEl.innerHTML = `<p style="color:var(--muted); font-size:14px; margin:0;">No payments linked to this work order yet.</p>`;
    return;
  }

  listEl.innerHTML = linked
    .map((p) => {
      const paid = String(p.isPaid || p.IsPaid || "").toUpperCase() === "TRUE" || p.isPaid === true;
      const paymentId = escapeHtml(p.paymentId || p.PaymentId || "");
      return `<div class="linked-payment-row" data-modal-action="open-linked-payment" data-id="${paymentId}" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #eee; cursor:pointer;">
        <div>
          <strong style="font-size:14px;">${escapeHtml(p.party || p.Party || paymentId)}</strong>
          <div style="font-size:12px; color:var(--muted);">${paymentId} &middot; ${escapeHtml(formatDateForDisplay(p.date || p.Date))}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900; font-size:14px;">₦${formatMoney(p.amount || p.Amount || 0)}</div>
          <span style="font-size:10px; font-weight:800; text-transform:uppercase; padding:2px 8px; border-radius:10px; background:${paid ? "var(--success)" : "#e9ecef"}; color:${paid ? "#fff" : "#666"};">${paid ? "Paid" : "Pending"}</span>
        </div>
      </div>`;
    })
    .join("");
}

function openLinkedPayment(paymentId) {
  const payment = (cache.payments || []).find(
    (p) => p && String(p.paymentId || p.PaymentId || "") === String(paymentId),
  );
  if (!payment) return;
  closeModal();
  setTimeout(() => openModal("payment", payment), 250);
}

function openLinkedWorkOrderFromPayment(workOrderId) {
  const wo = (cache.workorders || []).find(
    (w) => w && String(w.workOrderId || w.WorkOrderId || "") === String(workOrderId),
  );
  if (!wo) return;
  closeModal();
  setTimeout(() => openModal("workorder", wo), 250);
}

// ─────────────────────────────────────────────
// § MODAL FORMS
//
// submitModalRecord() is the single choke point every submit.onclick
// below routes through instead of calling callApi() directly. It does
// two things none of the 12 handlers below were doing on their own:
//
//   1. [BUG FIX] callApi() resolves normally even when the server
//      rejected the write (e.g. a permission error, an immutable-state
//      error, or the new conflict check below) — it only rejects on a
//      genuine network/JS failure. Every .then() below was written
//      assuming resolution == success, so a server-side rejection was
//      silently swallowed: the modal closed, a false "success" toast
//      showed, and refreshData() then reloaded the OLD unchanged
//      record with no explanation. submitModalRecord() checks
//      result.status itself, shows the real error, and throws so the
//      existing .catch() blocks (which already reset the Save button)
//      fire correctly instead of being skipped.
//
//   2. [FEATURE] Optimistic-concurrency conflict detection. When
//      editing an existing record, it attaches expectedUpdatedAt (the
//      updatedAt value this modal was opened with) to update* calls.
//      The server rejects the write with code:'CONFLICT' if someone
//      else has saved a change to that record since — see Code.gs.
// ─────────────────────────────────────────────
async function submitModalRecord(action, data, sourceRecord, listRefreshKey) {
  if (action.indexOf("update") === 0 && sourceRecord && data.expectedUpdatedAt === undefined) {
    const expected = sourceRecord.updatedAt || sourceRecord.UpdatedAt;
    if (expected) data = { ...data, expectedUpdatedAt: expected };
  }

  const result = await callApi(action, data);

  if (result && result.status === "error") {
    if (result.code === "CONFLICT") {
      showToast(result.message || "This record changed elsewhere. Please reopen it.", "error");
      if (listRefreshKey) refreshData(listRefreshKey);
    } else {
      showToast(result.message || "Save failed.", "error");
    }
    throw new Error(result.message || "Save failed");
  }

  return result;
}

async function openModal(type, editData = null) {
  lastFocusedElement = document.activeElement;
  const body = document.getElementById("modalBody");
  const submit = document.getElementById("modalSubmit");
  const title = document.getElementById("modalTitle");
  const overlay = document.getElementById("modalOverlay");
  const isEdit = !!editData;
  if (!body || !submit || !title || !overlay) return;

  overlay.style.display = "flex";
  void overlay.offsetWidth;
  overlay.classList.add("active");

  body.innerHTML = "";
  submit.disabled = false;
  submit.style.display = "block";
  submit.innerText = isEdit ? "Update" : "Save";
  submit.classList.remove("loading");

  const ls = 'style="font-size: 19px; padding: 12px; margin-bottom: 6px;"';
  const lbl =
    'style="font-size: 15px; color: var(--text); font-weight:800; display: block; margin-top: 8px; margin-bottom: 2px;"';

  currentModalFiles = [];
  currentAvatarPhoto = "";
  currentSelectedRecord = editData;

  // ── EXPENSE REQUEST ──
  if (type === "expenserequest") {
    const uniqueId = isEdit
      ? editData.reqId || editData.ReqId
      : await generateNextRecordId("EXR", "ExpenseRequests", "reqId", cache.expenseRequests || []);
    title.innerText = isEdit
      ? "Update Expense Request"
      : "Draft Expense Request";
    if (isEdit && (editData.attachments || editData.Attachments)) {
      currentModalFiles = String(editData.attachments || editData.Attachments)
        .split(",")
        .filter(Boolean);
    }
    body.innerHTML = `
      <label ${lbl}>Request ID</label><input type="text" value="${escapeHtml(uniqueId)}" disabled ${ls} style="background:#e9ecef; font-weight:900;">
      <label ${lbl}>Date Created</label><input id="er_date" type="date" value="${isEdit ? fromSheetDate(editData.date) : new Date().toISOString().split("T")[0]}" ${ls}>
      <label ${lbl}>Target Unit</label><select id="er_apt" ${ls}></select>
      <label ${lbl}>Asset Tag (Optional)</label><input id="er_asset" value="${isEdit ? escapeHtml(editData.assetTag || "") : ""}" placeholder="e.g. AST-12345" ${ls}>
      <label ${lbl}>Job Profile / Scope</label><textarea id="er_job" rows="3" placeholder="Multiline description..." ${ls}>${isEdit ? escapeHtml(editData.job || "") : ""}</textarea>
      <label ${lbl}>Estimated Cost (₦)</label><input id="er_cost" type="number" required placeholder="Amount (₦)" value="${isEdit ? escapeHtml(editData.cost || "") : ""}" ${ls}>
      <label ${lbl}>Supporting Attachments</label>
      <div id="erPreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="erCameraInput" accept="image/*,application/pdf" multiple style="display:none"></label>`;
    populateUnitDropdown("er_apt", isEdit ? getUnitNumber(editData) : "");
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("erPreviews");
    document.getElementById("erCameraInput").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "erPreviews");
    submit.onclick = () => {
      if (!document.getElementById("er_cost").value) {
        showToast("Estimated Cost is required.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateExpenseRequest" : "saveExpenseRequest", {
        reqId: uniqueId,
        date: toSheetDate(document.getElementById("er_date").value),
        apt: document.getElementById("er_apt").value,
        assetTag: sanitizeInput(document.getElementById("er_asset").value),
        job: sanitizeInput(document.getElementById("er_job").value),
        cost: document.getElementById("er_cost").value,
        attachments: currentModalFiles.join(","),
      }, editData, "expenserequests")
        .then(() => {
          closeModal();
          refreshData("expenserequests");
          showToast(isEdit ? "Request updated" : "Request saved", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── CASH EXPENSE ──
  else if (type === "cashexpense") {
    const uniqueId = isEdit
      ? editData.cashId || editData.CashId
      : await generateNextRecordId("CSH", "CashExpenses", "cashId", cache.cashExpenses || []);
    title.innerText = isEdit ? "Edit Cash Expense" : "Log Cash Expense";
    if (isEdit && (editData.attachments || editData.Attachments)) {
      currentModalFiles = String(editData.attachments || editData.Attachments)
        .split(",")
        .filter(Boolean);
    }
    body.innerHTML = `
      <label ${lbl}>Cash ID</label><input type="text" value="${escapeHtml(uniqueId)}" disabled ${ls} style="background:#e9ecef; font-weight:900;">
      <label ${lbl}>Date</label><input id="ce_date" type="date" value="${isEdit ? fromSheetDate(editData.date) : new Date().toISOString().split("T")[0]}" ${ls}>
      <label ${lbl}>Target Unit</label><select id="ce_apt" ${ls}></select>
      <label ${lbl}>Amount (₦)</label><input id="ce_amount" type="number" required placeholder="Amount (₦)" value="${isEdit ? escapeHtml(editData.amount || "") : ""}" ${ls}>
      <label ${lbl}>Description / Notes</label><textarea id="ce_desc" rows="3" ${ls}>${isEdit ? escapeHtml(editData.description || "") : ""}</textarea>
      <label ${lbl}>Supporting Attachments</label>
      <div id="cePreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="ceCameraInput" accept="image/*,application/pdf" multiple style="display:none"></label>`;
    populateUnitDropdown("ce_apt", isEdit ? getUnitNumber(editData) : "");
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("cePreviews");
    document.getElementById("ceCameraInput").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "cePreviews");
    submit.onclick = () => {
      if (!document.getElementById("ce_amount").value) {
        showToast("Amount is required.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateCashExpense" : "saveCashExpense", {
        cashId: uniqueId,
        date: toSheetDate(document.getElementById("ce_date").value),
        apt: document.getElementById("ce_apt").value,
        amount: document.getElementById("ce_amount").value,
        description: sanitizeInput(document.getElementById("ce_desc").value),
        attachments: currentModalFiles.join(","),
      }, editData, "cashexpenses")
        .then(() => {
          closeModal();
          refreshData("cashexpenses");
          showToast(isEdit ? "Expense updated" : "Expense saved", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── APARTMENT ──
  else if (type === "apartment") {
    const currentUnit = getUnitNumber(editData);
    title.innerText = "Unit Profile: " + escapeHtml(currentUnit);
    if (isEdit && (editData.photos || editData.Photos))
      currentModalFiles = String(editData.photos || editData.Photos)
        .split(",")
        .filter(Boolean);
    // The apartment record has its own meterNo field, but it's a
    // separate, one-time-set value from the per-reading meterNo that
    // shows up on Utilities log entries for this unit (those are a
    // different sheet, tied together only by matching apt numbers).
    // If the apartment doesn't have one yet, suggest whatever the most
    // recent electricity log for this unit used, rather than making
    // the admin hunt it down and retype it — still editable either way.
    const suggestedMeterNo =
      editData.meterNo ||
      editData.MeterNo ||
      [...(cache.utilities || [])]
        .filter(
          (u) =>
            u &&
            String(getUnitNumber(u)) === String(currentUnit) &&
            (u.type === "Electricity" || u.Type === "Electricity") &&
            (u.meterNo || u.MeterNo),
        )
        .sort((a, b) => new Date(b.updatedAt || b.date || 0) - new Date(a.updatedAt || a.date || 0))[0]?.meterNo ||
      "";

    // [FEATURE] Suggested weight defaults to a ratio by apartment type
    // (Studio : 1-Bedroom : 2-Bedroom = 1 : 1.25 : 1.5) when nobody's
    // set a custom weight for this unit yet — mirrors
    // getDefaultWeightForType() in Code.gs exactly, so what you see
    // here is what actually gets used if you save it as-is. Still
    // fully editable for a genuine per-unit override.
    const getDefaultWeightForType = (type) => {
      const t = String(type || "").toLowerCase();
      if (t.includes("studio")) return 1;
      if (t.includes("2") && t.includes("bed")) return 1.5;
      if (t.includes("1") && t.includes("bed")) return 1.25;
      return 1;
    };
    const suggestedWeight =
      editData.weight || editData.Weight || getDefaultWeightForType(editData.type || editData.Type);

    body.innerHTML = `
      <div class="form-grid-3">
        <div class="form-field"><label ${lbl}>Tenant Name</label><input id="f_tenant" value="${escapeHtml(editData.tenant || editData.Tenant || "")}" ${ls}></div>
        <div class="form-field"><label ${lbl}>Apartment Type</label><input id="f_type" value="${escapeHtml(editData.type || editData.Type || "Standard")}" disabled ${ls}></div>
        <div class="form-field"><label ${lbl}>Current Rent (₦)</label><input id="f_rent" type="text" inputmode="numeric" placeholder="Annual rent amount" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')" value="${(editData.rent || editData.Rent) ? Number(editData.rent || editData.Rent).toLocaleString("en-US") : ""}" ${ls}></div>
        <div class="form-field"><label ${lbl}>Service Charge Deposit (₦)</label><input id="f_deposit" type="text" inputmode="numeric" placeholder="Service charge deposit amount" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')" value="${(editData.serviceChargeDeposit || editData.ServiceChargeDeposit) ? Number(editData.serviceChargeDeposit || editData.ServiceChargeDeposit).toLocaleString("en-US") : ""}" ${ls}></div>
        <div class="form-field"><label ${lbl}>Meter No</label><input id="f_meter" value="${escapeHtml(suggestedMeterNo)}" disabled ${ls}></div>
        <div class="form-field"><label ${lbl}>Service Charge Weight <span style="font-weight:600; color:var(--muted);">(Studio 1 : 1-Bed 1.25 : 2-Bed 1.5, edited on the backend)</span></label><input id="f_weight" type="number" min="0" step="0.1" value="${escapeHtml(String(suggestedWeight))}" disabled ${ls}></div>
        <div class="form-field">
          <label ${lbl}>Status State</label>
          <select id="f_status" ${ls}>
            <option value="Occupied" ${String(editData.status || editData.Status) === "Occupied" ? "selected" : ""}>Occupied</option>
            <option value="Vacant" ${String(editData.status || editData.Status) === "Vacant" ? "selected" : ""}>Vacant</option>
            <option value="Common Area" ${String(editData.status || editData.Status) === "Common Area" ? "selected" : ""}>Common Area</option>
          </select>
        </div>
        <div class="form-field"><label ${lbl}>Phone 1</label><input id="f_p1" type="tel" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeHtml(editData.phone1 || editData.Phone1 || "")}" ${ls}></div>
        <div class="form-field"><label ${lbl}>Phone 2</label><input id="f_p2" type="tel" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeHtml(editData.phone2 || editData.Phone2 || "")}" ${ls}></div>
        <div class="form-field"><label ${lbl}>Lease End</label><input id="f_lease" type="date" value="${fromSheetDate(editData.leaseEnd || editData.LeaseEnd)}" ${ls}></div>
        <div class="form-field"><label ${lbl}>Last Inspected</label><input id="f_inspected" type="date" value="${fromSheetDate(editData.inspected || editData.Inspected)}" ${ls}></div>
        <div class="form-field span-3"><label ${lbl}>Notes 1</label><textarea id="f_notes" rows="2" ${ls}>${escapeHtml(editData.notes || editData.Notes || "")}</textarea></div>
        <div class="form-field span-3"><label ${lbl}>Notes 2</label><textarea id="f_notes2" rows="2" ${ls}>${escapeHtml(editData.notes2 || editData.Notes2 || "")}</textarea></div>
        <div class="form-field span-3">
          <label ${lbl}>Form Attachments</label>
          <div id="aptPreviews" class="modal-preview-grid" style="display:none;"></div>
          <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="cameraInput" accept="image/*,application/pdf" style="display:none"></label>
        </div>
      </div>`;
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("aptPreviews");
    document.getElementById("cameraInput").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "aptPreviews");
    submit.onclick = () => {
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord("updateApartment", {
        apt: currentUnit,
        tenant: sanitizeInput(document.getElementById("f_tenant").value),
        status: document.getElementById("f_status").value,
        rent: document.getElementById("f_rent").value.replace(/,/g, ""),
        serviceChargeDeposit: document.getElementById("f_deposit").value.replace(/,/g, ""),
        meterNo: sanitizeInput(document.getElementById("f_meter").value),
        weight: document.getElementById("f_weight").value,
        phone1: String(document.getElementById("f_p1").value),
        phone2: String(document.getElementById("f_p2").value),
        leaseEnd: toSheetDate(document.getElementById("f_lease").value),
        inspected: toSheetDate(document.getElementById("f_inspected").value),
        notes: sanitizeInput(document.getElementById("f_notes").value),
        notes2: sanitizeInput(document.getElementById("f_notes2").value),
        photos: currentModalFiles.join(","),
        type: editData.type || editData.Type || "",
        oldApt: currentUnit,
      }, editData, "apartments")
        .then(() => {
          closeModal();
          refreshData("apartments");
          showToast("Apartment updated", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── SERVICE CHARGE: CONTRIBUTION ──
  // Not a "record" in the usual cache/refreshData sense (the Service
  // Charge ledger is deliberately excluded from getAllData — see
  // Code.gs — so staff/viewer accounts never receive it at all). These
  // three branches call the API directly and refresh the dedicated
  // Service Charge section view instead of going through
  // submitModalRecord()'s cache-based flow.
  else if (type === "contribution") {
    title.innerText = "Log Contribution";
    body.innerHTML = `
      <div class="form-field span-3"><label ${lbl}>Apartment</label><select id="sc_apt" ${ls}></select></div>
      <div class="form-field"><label ${lbl}>Amount (₦)</label><input id="sc_amount" type="text" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')" ${ls}></div>
      <div class="form-field"><label ${lbl}>Date</label><input id="sc_date" type="date" value="${getLocalDateString()}" ${ls}></div>
      <div class="form-field span-3"><label ${lbl}>Notes (optional)</label><input id="sc_description" ${ls}></div>
    `;
    populateOccupiedUnitDropdown("sc_apt");

    submit.onclick = () => {
      const apt = document.getElementById("sc_apt").value;
      const amount = document.getElementById("sc_amount").value.replace(/,/g, "");
      if (!apt || !amount || Number(amount) <= 0) {
        showToast("Select an apartment and enter a positive amount.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      callApi("logContribution", {
        apt,
        amount,
        date: document.getElementById("sc_date").value,
        description: sanitizeInput(document.getElementById("sc_description").value),
      })
        .then((result) => {
          submit.disabled = false;
          submit.classList.remove("loading");
          if (!result || result.status !== "success") {
            showToast((result && result.message) || "Failed to log contribution.", "error");
            return;
          }
          closeModal();
          showToast("Contribution logged.", "success");
          if (typeof refreshServiceChargeSection === "function") refreshServiceChargeSection();
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── SERVICE CHARGE: APARTMENT-SPECIFIC EXPENSE ──
  else if (type === "apartmentexpense") {
    title.innerText = "Log Apartment Expense";
    body.innerHTML = `
      <div class="form-field span-3"><label ${lbl}>Apartment</label><select id="sc_ae_apt" ${ls}></select></div>
      <div class="form-field"><label ${lbl}>Category</label><input id="sc_ae_category" placeholder="e.g. Plumbing Repair" ${ls}></div>
      <div class="form-field"><label ${lbl}>Amount (₦)</label><input id="sc_ae_amount" type="text" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')" ${ls}></div>
      <div class="form-field"><label ${lbl}>Date</label><input id="sc_ae_date" type="date" value="${getLocalDateString()}" ${ls}></div>
      <div class="form-field span-3"><label ${lbl}>Notes (optional)</label><input id="sc_ae_description" ${ls}></div>
    `;
    populateOccupiedUnitDropdown("sc_ae_apt");

    submit.onclick = () => {
      const apt = document.getElementById("sc_ae_apt").value;
      const amount = document.getElementById("sc_ae_amount").value.replace(/,/g, "");
      if (!apt || !amount || Number(amount) <= 0) {
        showToast("Select an apartment and enter a positive amount.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      callApi("logApartmentExpense", {
        apt,
        amount,
        category: sanitizeInput(document.getElementById("sc_ae_category").value) || "Expense",
        date: document.getElementById("sc_ae_date").value,
        description: sanitizeInput(document.getElementById("sc_ae_description").value),
      })
        .then((result) => {
          submit.disabled = false;
          submit.classList.remove("loading");
          if (!result || result.status !== "success") {
            showToast((result && result.message) || "Failed to log expense.", "error");
            return;
          }
          closeModal();
          showToast("Apartment expense logged.", "success");
          if (typeof refreshServiceChargeSection === "function") refreshServiceChargeSection();
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── SERVICE CHARGE: SHARED EXPENSE ──
  // No apartment picker — the server splits this by each currently-
  // occupied real apartment's weight (see logSharedExpense in Code.gs).
  // Also the path for Common Area/Service unit costs, which never get
  // their own balance — see the Weight field's help text on the
  // apartment form.
  else if (type === "sharedexpense") {
    title.innerText = "Log Shared Expense";
    body.innerHTML = `
      <div class="form-field span-3" style="background:#f0f4ff; border:2px solid #c7d2fe; border-radius:10px; padding:10px 14px; margin-bottom:4px;">
        <small style="font-weight:700; color:#4f46e5;"><i class="fas fa-diagram-project"></i> This amount is automatically split across every currently-occupied apartment, by that unit's Service Charge Weight.</small>
      </div>
      <div class="form-field span-3"><label ${lbl}>Category</label><input id="sc_se_category" placeholder="e.g. Staff Salary, Generator Maintenance" ${ls}></div>
      <div class="form-field"><label ${lbl}>Total Amount (₦)</label><input id="sc_se_amount" type="text" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')" ${ls}></div>
      <div class="form-field"><label ${lbl}>Date</label><input id="sc_se_date" type="date" value="${getLocalDateString()}" ${ls}></div>
      <div class="form-field span-3"><label ${lbl}>Notes (optional)</label><input id="sc_se_description" ${ls}></div>
    `;

    submit.onclick = () => {
      const amount = document.getElementById("sc_se_amount").value.replace(/,/g, "");
      const category = sanitizeInput(document.getElementById("sc_se_category").value);
      if (!category || !amount || Number(amount) <= 0) {
        showToast("Enter a category and a positive amount.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      callApi("logSharedExpense", {
        amount,
        category,
        date: document.getElementById("sc_se_date").value,
        description: sanitizeInput(document.getElementById("sc_se_description").value),
      })
        .then((result) => {
          submit.disabled = false;
          submit.classList.remove("loading");
          if (!result || result.status !== "success") {
            showToast((result && result.message) || "Failed to log shared expense.", "error");
            return;
          }
          closeModal();
          showToast(`Shared expense split across ${result.splits.length} apartment(s).`, "success");
          if (typeof refreshServiceChargeSection === "function") refreshServiceChargeSection();
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── ASSET ──
  else if (type === "asset") {
    const uniqueTag = isEdit
      ? editData.tag || editData.Tag
      : await generateNextRecordId("AST", "Assets", "tag", cache.assets || []);
    title.innerText = isEdit ? "Update Asset" : "Register Facility Asset";
    if (isEdit && (editData.photos || editData.Photos))
      currentModalFiles = String(editData.photos || editData.Photos)
        .split(",")
        .filter(Boolean);

    let defaultInterval = "30";
    if (isEdit) {
      const lsN = fromSheetDate(
        editData.lastServiced || editData.LastServiced || "",
      );
      const nsN = fromSheetDate(
        editData.nextService || editData.NextService || "",
      );
      if (lsN && nsN) {
        const dDays = Math.ceil(
          Math.abs(new Date(nsN) - new Date(lsN)) / (1000 * 60 * 60 * 24),
        );
        defaultInterval = String(
          [30, 60, 90, 120, 150, 180].reduce((prev, curr) =>
            Math.abs(curr - dDays) < Math.abs(prev - dDays) ? curr : prev,
          ),
        );
      }
    }

    body.innerHTML = `
      <label ${lbl}>Asset Tag</label><input type="text" value="${escapeHtml(uniqueTag)}" disabled ${ls} style="background:#e9ecef; font-weight:900;">
      <label ${lbl}>Unit Connection</label><select id="a_apt" ${ls}></select>
      <label ${lbl}>Category Class Type</label><input id="a_type" value="${isEdit ? escapeHtml(editData.type || editData.Type) : ""}" ${ls}>
      <label ${lbl}>Functional Status</label>
      <select id="a_status" ${ls}>
        ${["Operational", "Faulty", "Under Repair", "Archived"].map((s) => `<option value="${s}" ${isEdit && String(editData.status || editData.Status) === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <label ${lbl}>Specs / Config Profile</label><input id="a_specs" value="${isEdit ? escapeHtml(editData.specs || editData.Specs) : ""}" ${ls}>
      <label ${lbl}>Internal Placement Area</label><input id="a_loc" value="${isEdit ? escapeHtml(editData.loc || editData.Loc) : ""}" ${ls}>
      <label ${lbl}>Last Serviced Date</label><input id="a_serviced" type="date" value="${isEdit ? fromSheetDate(editData.lastServiced || editData.LastServiced) : ""}" ${ls}>
      <label ${lbl}>Last Inspected Date</label><input id="a_inspected" type="date" value="${isEdit ? fromSheetDate(editData.lastInspected || editData.LastInspected) : ""}" ${ls}>
      <label ${lbl}>Next PM Due In</label>
      <select id="a_nextServiceInterval" ${ls}>
        ${[30, 60, 90, 120, 150, 180].map((d) => `<option value="${d}" ${defaultInterval === String(d) ? "selected" : ""}>${d} days</option>`).join("")}
      </select>
      <label ${lbl}>Notes</label><textarea id="a_notes" rows="2" ${ls}>${isEdit ? escapeHtml(editData.notes || editData.Notes) : ""}</textarea>
      <label ${lbl}>Form Attachments</label>
      <div id="assetPreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="assetCameraInput" accept="image/*,application/pdf" style="display:none"></label>
      ${
        isEdit
          ? `<div style="margin-top:18px; padding-top:14px; border-top:2px dashed var(--border);">
        <label ${lbl}>Maintenance History</label>
        <div id="assetMaintHistoryList" style="max-height:220px; overflow-y:auto; margin-bottom:10px;"></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:flex-end;">
          <div style="flex:1; min-width:130px;"><label style="font-size:12px; font-weight:800; margin:0 0 2px;">Date</label><input id="a_log_date" type="date" value="${new Date().toISOString().split("T")[0]}" style="margin:0; font-size:15px; padding:8px;"></div>
          <div style="flex:2; min-width:160px;"><label style="font-size:12px; font-weight:800; margin:0 0 2px;">Note</label><input id="a_log_note" type="text" placeholder="e.g. Replaced compressor belt" style="margin:0; font-size:15px; padding:8px;"></div>
          <div style="flex:1; min-width:90px;"><label style="font-size:12px; font-weight:800; margin:0 0 2px;">Cost (₦)</label><input id="a_log_cost" type="number" placeholder="Optional" style="margin:0; font-size:15px; padding:8px;"></div>
          <button id="a_log_add_btn" type="button" style="background:var(--primary); color:#fff; border:0; border-radius:8px; padding:9px 14px; font-weight:800; cursor:pointer; white-space:nowrap;">Add Entry</button>
          <button id="a_log_cancel_btn" type="button" data-modal-action="cancel-edit-maintenance-log" style="display:none; background:#e9ecef; color:#333; border:0; border-radius:8px; padding:9px 14px; font-weight:800; cursor:pointer; white-space:nowrap;">Cancel</button>
        </div>
      </div>`
          : ""
      }`;
    populateUnitDropdown("a_apt", isEdit ? getUnitNumber(editData) : "");
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("assetPreviews");
    document.getElementById("assetCameraInput").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "assetPreviews");
    if (isEdit) {
      editingMaintenanceLogId = null;
      renderAssetMaintenanceHistory(uniqueTag);
      document.getElementById("a_log_add_btn").onclick = () =>
        addAssetMaintenanceLogEntry(uniqueTag);
    }
    submit.onclick = () => {
      submit.disabled = true;
      submit.classList.add("loading");
      const lastServicedVal = document.getElementById("a_serviced").value;
      let calculatedNextServiceStr = "";
      if (lastServicedVal) {
        const [y, m, d] = lastServicedVal.split("-");
        const dt = new Date(y, m - 1, d);
        dt.setDate(
          dt.getDate() +
            (parseInt(
              document.getElementById("a_nextServiceInterval").value,
              10,
            ) || 30),
        );
        const pad = (n) => String(n).padStart(2, "0");
        calculatedNextServiceStr = `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
      }
      submitModalRecord(isEdit ? "updateAsset" : "saveAsset", {
        tag: uniqueTag,
        apt: document.getElementById("a_apt").value,
        type: sanitizeInput(document.getElementById("a_type").value),
        status: document.getElementById("a_status").value,
        specs: sanitizeInput(document.getElementById("a_specs").value),
        loc: sanitizeInput(document.getElementById("a_loc").value),
        lastServiced: toSheetDate(lastServicedVal),
        lastInspected: toSheetDate(
          document.getElementById("a_inspected").value,
        ),
        nextService: calculatedNextServiceStr,
        notes: sanitizeInput(document.getElementById("a_notes").value),
        photos: currentModalFiles.join(","),
      }, editData, "assets")
        .then(() => {
          closeModal();
          refreshData("assets");
          showToast(isEdit ? "Asset updated" : "Asset registered", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── MAINTENANCE TICKET ──
  else if (type === "maintenance") {
    const uniqueId = isEdit
      ? editData.ticketId || editData.TicketId
      : await generateNextRecordId("TKT", "Maintenance", "ticketId", cache.tickets || []);
    title.innerText = isEdit
      ? "Update Maintenance Ticket"
      : "Log Maintenance Ticket";
    if (isEdit && (editData.photos || editData.Photos))
      currentModalFiles = String(editData.photos || editData.Photos)
        .split(",")
        .filter(Boolean);
    body.innerHTML = `
      <label ${lbl}>Ticket ID</label><input value="${escapeHtml(uniqueId)}" disabled ${ls} style="background:#e9ecef; font-weight:900;">
      <label ${lbl}>Target Unit</label><select id="m_apt" ${ls}></select>
      <label ${lbl}>Category</label><input id="m_cat" value="${isEdit ? escapeHtml(editData.category || editData.Category || "") : ""}" placeholder="e.g. Plumbing, Electrical" ${ls}>
      <label ${lbl}>Description</label><textarea id="m_desc" rows="3" ${ls}>${isEdit ? escapeHtml(editData.description || editData.Description || "") : ""}</textarea>
      <label ${lbl}>Status</label>
      <select id="m_status" ${ls}>
        ${["Open", "In Progress", "Resolved"].map((s) => `<option value="${s}" ${isEdit && String(editData.status || "") === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <label ${lbl}>Date Logged</label><input id="m_date" type="date" value="${isEdit ? fromSheetDate(editData.date) : new Date().toISOString().split("T")[0]}" ${ls}>
      <label ${lbl}>Notes</label><textarea id="m_notes" rows="2" ${ls}>${isEdit ? escapeHtml(editData.notes || "") : ""}</textarea>
      <label ${lbl}>Photos</label>
      <div id="maintPreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-camera"></i><input type="file" id="maintCameraInput" accept="image/*" multiple style="display:none"></label>`;
    populateUnitDropdown("m_apt", isEdit ? getUnitNumber(editData) : "");
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("maintPreviews");
    document.getElementById("maintCameraInput").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "maintPreviews");
    submit.onclick = () => {
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateMaintenance" : "saveMaintenance", {
        ticketId: uniqueId,
        apt: document.getElementById("m_apt").value,
        category: sanitizeInput(document.getElementById("m_cat").value),
        description: sanitizeInput(document.getElementById("m_desc").value),
        status: document.getElementById("m_status").value,
        date: toSheetDate(document.getElementById("m_date").value),
        notes: sanitizeInput(document.getElementById("m_notes").value),
        photos: currentModalFiles.join(","),
      }, editData, "maint")
        .then(() => {
          closeModal();
          refreshData("maint");
          showToast(isEdit ? "Ticket updated" : "Ticket logged", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── WORK ORDER ──
  else if (type === "workorder") {
    const uniqueWO = isEdit
      ? editData.workOrderId || editData.WorkOrderId
      : await generateNextRecordId("WO", "WorkOrders", "workOrderId", cache.workorders || []);
    const isApproved =
      isEdit &&
      String(editData.status || editData.Status || "").toUpperCase() ===
        "APPROVED";
    title.innerText = isEdit ? "Update Work Order" : "Create Work Order";
    if (isEdit && (editData.attachments || editData.Attachments))
      currentModalFiles = String(editData.attachments || editData.Attachments)
        .split(",")
        .filter(Boolean);
    body.innerHTML = `
      <label ${lbl}>Work Order ID</label><input value="${escapeHtml(uniqueWO)}" disabled ${ls} style="background:#e9ecef; font-weight:900;">
      <label ${lbl}>Date</label><input id="w_date" type="date" value="${isEdit ? fromSheetDate(editData.date) : new Date().toISOString().split("T")[0]}" ${ls}>
      <label ${lbl}>Target Unit</label><select id="w_apt" ${ls}></select>
      <label ${lbl}>Asset (Optional)</label><select id="w_asset" ${ls}></select>
      <label ${lbl}>Assigned To</label><select id="w_assigned" ${ls}></select>
      <label ${lbl}>Expected Duration</label><input id="w_duration" value="${isEdit ? escapeHtml(editData.duration || editData.Duration || "") : ""}" placeholder="e.g. 3 days" ${ls}>
      <label ${lbl}>Submitted Value (₦)</label><input id="w_submitted_val" type="number" value="${isEdit ? escapeHtml(editData.submittedValue || editData.SubmittedValue || "") : ""}" placeholder="Contractor's submitted amount" ${ls}>
      <label ${lbl}>Negotiated Value (₦)</label><input id="w_amount" type="number" required value="${isEdit ? escapeHtml(editData.amount || editData.Amount || "") : ""}" placeholder="Approved/negotiated amount" ${ls} style="border-color:var(--primary); border-width:3px;">
      <label ${lbl}>Approval Status</label>
      <select id="w_status" ${ls} ${isApproved || !currentUserMeetsRole("manager") ? "disabled" : ""}>
        ${["Pending Approval", "Approved", "Declined"].map((s) => `<option value="${s}" ${isEdit && String(editData.status || editData.Status || "") === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      ${!currentUserMeetsRole("manager") ? `<small style="display:block; margin-top:-6px; color:var(--muted); font-weight:700;">Only managers can approve or decline Work Orders.</small>` : ""}
      <label ${lbl}>Scope / Description</label><textarea id="w_desc" rows="3" ${ls}>${isEdit ? escapeHtml(editData.description || editData.Description || "") : ""}</textarea>
      <label ${lbl}>Field Notes</label><textarea id="w_notes" rows="2" ${ls}>${isEdit ? escapeHtml(editData.notes || editData.Notes || "") : ""}</textarea>
      <label ${lbl}>Form Attachments</label>
      <div id="woPreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="woCameraInput" accept="image/*,application/pdf" multiple style="display:none"></label>
      ${isEdit ? `<div id="woLinkedPaymentsSection" style="margin-top:18px; padding-top:14px; border-top:2px dashed var(--border);"><label ${lbl}>Linked Payments</label><div id="woLinkedPaymentsList" style="max-height:200px; overflow-y:auto;"></div></div>` : ""}`;

    populateUnitDropdown("w_apt", isEdit ? getUnitNumber(editData) : "");
    const assetSel = document.getElementById("w_asset");
    const populateAssets = (unitNum) => {
      assetSel.innerHTML = '<option value="">-- No Specific Asset --</option>';
      if (!unitNum) return;
      (cache.assets || [])
        .filter(
          (a) =>
            a &&
            String(getUnitNumber(a)) === String(unitNum) &&
            String(a.status || a.Status) !== "Archived",
        )
        .forEach((a) => {
          const o = document.createElement("option");
          o.value = a.tag || a.Tag;
          o.textContent = `${a.type || "Asset"} (${a.tag || a.Tag})`;
          if (
            isEdit &&
            String(editData.asset || editData.Asset) === String(o.value)
          )
            o.selected = true;
          assetSel.appendChild(o);
        });
    };
    setTimeout(
      () => populateAssets(isEdit ? getUnitNumber(editData) : ""),
      100,
    );
    document
      .getElementById("w_apt")
      .addEventListener("change", (e) => populateAssets(e.target.value));

    const asSel = document.getElementById("w_assigned");
    asSel.innerHTML = '<option value="">-- Choose Participant --</option>';
    (cache.staff || []).forEach((s) => {
      if (!s) return;
      const o = document.createElement("option");
      o.value = `${s.name || s.Name} (${s.role || s.Role})`;
      o.textContent = `${s.name || s.Name} [Staff]`;
      if (isEdit && (editData.assigned || editData.Assigned) === o.value)
        o.selected = true;
      asSel.appendChild(o);
    });
    (cache.vendors || []).forEach((v) => {
      if (!v) return;
      const o = document.createElement("option");
      o.value = `${v.company || v.Company} (${v.trade || v.Trade})`;
      o.textContent = `${v.company || v.Company} [Vendor]`;
      if (isEdit && (editData.assigned || editData.Assigned) === o.value)
        o.selected = true;
      asSel.appendChild(o);
    });

    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("woPreviews");
    document.getElementById("woCameraInput").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "woPreviews");
    if (isEdit) renderLinkedPaymentsForWorkOrder(uniqueWO);

    if (isApproved) {
      submit.style.display = "none";
    } else {
      submit.onclick = () => {
        if (!document.getElementById("w_amount").value) {
          showToast("Negotiated Value is required.", "error");
          return;
        }
        submit.disabled = true;
        submit.classList.add("loading");
        submitModalRecord(isEdit ? "updateWorkOrder" : "saveWorkOrder", {
          workOrderId: uniqueWO,
          date: toSheetDate(document.getElementById("w_date").value),
          apt: document.getElementById("w_apt").value,
          asset: document.getElementById("w_asset").value,
          assigned: asSel.value,
          duration: sanitizeInput(document.getElementById("w_duration").value),
          submittedValue: document.getElementById("w_submitted_val").value,
          amount: document.getElementById("w_amount").value,
          status: document.getElementById("w_status").value,
          description: sanitizeInput(document.getElementById("w_desc").value),
          notes: sanitizeInput(document.getElementById("w_notes").value),
          attachments: currentModalFiles.join(","),
        }, editData, "workorders")
          .then(() => {
            closeModal();
            refreshData("workorders");
            showToast(
              isEdit ? "Work order updated" : "Work order saved",
              "success",
            );
          })
          .catch(() => {
            submit.disabled = false;
            submit.classList.remove("loading");
          });
      };
    }
  }

  // ── PAYMENT (STAGED) ──
  else if (type === "payment") {
    const uniqueId = isEdit
      ? editData.paymentId
      : await generateNextRecordId("PAY", "Payments", "paymentId", cache.payments);
    const isAlreadyPaid =
      isEdit &&
      (String(editData.isPaid || editData.IsPaid || "").toUpperCase() ===
        "TRUE" ||
        editData.isPaid === true ||
        editData.IsPaid === true);
    const dis = isAlreadyPaid ? "disabled" : "";
    title.innerText = isEdit ? "Edit Ledger Record" : "Log Financial Ledger";

    if (isEdit && (editData.attachments || editData.Attachments)) {
      currentModalFiles = String(editData.attachments || editData.Attachments)
        .split(",")
        .filter(Boolean);
    }

    // Initialise stages from existing data or default
    initPaymentStages(
      isEdit ? editData.stages || editData.Stages || null : null,
    );

    // Build party datalists, direction-specific:
    // INFLOW -> Apartments (tenants) only
    // OUTFLOW -> Vendors + Staff only
    let inflowPartyOpts = "";
    (cache.apts || []).forEach((a) => {
      const uNum = getUnitNumber(a);
      if (uNum && String(a.type || "").toLowerCase() !== "services") {
        const label = `Unit ${uNum}${a.tenant ? " - " + a.tenant : ""}`;
        inflowPartyOpts += `<option value="${escapeHtml(label)}">`;
      }
    });
    let outflowPartyOpts = "";
    (cache.vendors || []).forEach((v) => {
      if (v?.company) outflowPartyOpts += `<option value="${escapeHtml(v.company)}">`;
    });
    (cache.staff || []).forEach((s) => {
      const sName = s?.name || s?.Name;
      if (sName) outflowPartyOpts += `<option value="${escapeHtml(sName)}">`;
    });

    // Build reference options
    let inflowRefOpts = '<option value="">-- No Linked Unit --</option>';
    (cache.apts || []).forEach((a) => {
      if (!a) return;
      const uNum = getUnitNumber(a);
      if (uNum && String(a.type || "").toLowerCase() !== "services") {
        const val = `Unit ${uNum}`;
        inflowRefOpts += `<option value="${escapeHtml(val)}" ${isEdit && editData.reference === val ? "selected" : ""}>${escapeHtml(val)} - ${escapeHtml(a.tenant || "Vacant")}</option>`;
      }
    });
    let outflowRefOpts = '<option value="">-- No Linked Record --</option>';
    const approvedWOs = (cache.workorders || []).filter(
      (w) =>
        w && String(w.status || w.Status || "").toUpperCase() === "APPROVED",
    );
    const expReqs = cache.expenseRequests || [];
    if (approvedWOs.length > 0) {
      outflowRefOpts += '<optgroup label="Approved Work Orders">';
      approvedWOs.forEach((w) => {
        const wid = w.workOrderId || w.WorkOrderId;
        outflowRefOpts += `<option value="${escapeHtml(wid)}" ${isEdit && editData.reference === wid ? "selected" : ""}>${escapeHtml(wid)} - ₦${formatMoney(w.amount)}</option>`;
      });
      outflowRefOpts += "</optgroup>";
    }
    if (expReqs.length > 0) {
      outflowRefOpts += '<optgroup label="Expense Requests">';
      expReqs.forEach((r) => {
        if (!r) return;
        outflowRefOpts += `<option value="${escapeHtml(r.reqId)}" ${isEdit && editData.reference === r.reqId ? "selected" : ""}>${escapeHtml(r.reqId)} - ₦${formatMoney(r.cost)}</option>`;
      });
      outflowRefOpts += "</optgroup>";
    }
    if (!approvedWOs.length && !expReqs.length)
      outflowRefOpts +=
        "<option disabled>⚠️ No Approved Records Available</option>";

    body.innerHTML = `
      <label ${lbl}>Payment ID</label><input type="text" value="${escapeHtml(uniqueId)}" disabled ${ls} style="background:#e9ecef; font-weight:900;">

      <label ${lbl}>Transaction Direction</label>
      <select id="p_direction" ${ls} ${dis}>
        <option value="INFLOW" ${isEdit && (editData.direction || editData.Direction) === "INFLOW" ? "selected" : ""}>INFLOW (+ Receivables)</option>
        <option value="OUTFLOW" ${isEdit && (editData.direction || editData.Direction) === "OUTFLOW" ? "selected" : ""}>OUTFLOW (− Payables)</option>
      </select>

      <label ${lbl}>Party / Payer / Payee</label>
      <input list="party_list" id="p_party" value="${isEdit ? escapeHtml(editData.party || editData.Party || "") : ""}" placeholder="Type or select..." ${ls} ${dis}>
      <datalist id="party_list"></datalist>

      <label ${lbl}>Bank Name</label>
      <input list="bank_list" id="p_bank" type="text" value="${isEdit ? escapeHtml(editData.bank || editData.Bank || "") : ""}" placeholder="e.g. GTBank, Zenith" ${ls} ${dis}>
      <datalist id="bank_list">
        <option value="Access Bank"><option value="First Bank"><option value="GTBank"><option value="Kuda Bank"><option value="Moniepoint"><option value="Opay"><option value="UBA"><option value="Zenith Bank">
      </datalist>

      <label ${lbl}>Account Number (10 Digits)</label>
      <input id="p_account" type="text" inputmode="numeric" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${isEdit ? escapeHtml(editData.account || editData.Account || "") : ""}" placeholder="0123456789" ${ls} ${dis}>

      <label ${lbl}>Linked Record</label>
      <select id="p_reference" ${ls} ${dis}></select>
      ${
        isEdit && (cache.workorders || []).some((w) => w && String(w.workOrderId || w.WorkOrderId || "") === String(editData.reference || editData.Reference || ""))
          ? `<button type="button" data-modal-action="open-linked-work-order" data-id="${escapeHtml(editData.reference || editData.Reference || "")}" style="background:#f0f4ff; color:#4f46e5; border:2px solid #c7d2fe; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:800; cursor:pointer; margin-top:-4px; margin-bottom:8px;"><i class="fas fa-diagram-project"></i> View Linked Work Order</button>`
          : ""
      }

      <label ${lbl}>Classification Note</label>
      <input id="p_type" value="${isEdit ? escapeHtml(editData.type || editData.Type || "") : ""}" placeholder="e.g. Rent, Vendor Payment" ${ls} ${dis}>

      <label ${lbl}>Reason / Justification</label>
      <textarea id="p_reason" rows="2" placeholder="Describe the transaction..." ${ls} ${dis}>${isEdit ? escapeHtml(editData.reason || editData.Reason || "") : ""}</textarea>

      <label ${lbl}>Date</label>
      <input id="p_date" type="date" value="${isEdit ? fromSheetDate(editData.date || editData.Date) : new Date().toISOString().split("T")[0]}" ${ls} ${dis}>

      <!-- ═══ STAGED PAYMENT SCHEDULE ═══ -->
      <div style="margin:14px 0 4px 0; padding:12px; background:#f0f4ff; border-radius:12px; border:2px solid #c7d2fe;">
        <div style="font-size:12px; font-weight:800; color:#4f46e5; text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">
          <i class="fas fa-layer-group"></i> Contract Payment Schedule
        </div>
        <label ${lbl} style="margin-top:4px;">Total Contract Value (₦)</label>
        <input id="p_total_job" type="number" value="${isEdit ? escapeHtml(editData.totalJobValue || editData.TotalJobValue || "") : ""}" placeholder="Full contract value" ${ls} ${dis} oninput="refreshStagesSummaryOnly()">

        <div id="stages-table-container"></div>

        <label ${lbl}>Payment Request</label>
        <select id="p_payment_request" ${ls} ${dis} onchange="syncPaymentAmountFromRequestSelection()">
          <option value="">-- Select Stage --</option>
        </select>
        <input type="hidden" id="p_amount" value="${isEdit ? escapeHtml(editData.amount || editData.Amount || "") : ""}">
      </div>

      <!-- ═══ CLEARED STATUS ═══ -->
      <div style="margin-top:15px; padding:12px; border:2px solid ${isAlreadyPaid ? "#198754" : "#DEE2E6"}; border-radius:12px; background:${isAlreadyPaid ? "#E8F5E9" : "#F8F9FA"};">
        <label style="display:flex; align-items:center; gap:10px; margin:0; cursor:pointer;">
          <input type="checkbox" id="p_is_paid" style="width:24px; height:24px; margin:0;" ${isAlreadyPaid ? "checked disabled" : !currentUserMeetsRole("manager") ? "disabled" : ""}>
          <span style="color:${isAlreadyPaid ? "#198754" : "#212529"}; font-weight:900; font-size:16px;">
            ${isAlreadyPaid ? '<i class="fas fa-lock"></i> STATUS: PAID & LOCKED' : "MARK AS PAID / CLEARED"}
          </span>
        </label>
        ${isAlreadyPaid ? '<p style="margin:4px 0 0 0; font-size:12px; color:#198754;">This ledger record has been settled and cannot be modified.</p>' : ""}
        ${!isAlreadyPaid && !currentUserMeetsRole("manager") ? '<p style="margin:4px 0 0 0; font-size:12px; color:var(--muted);">Only managers can mark payments as paid.</p>' : ""}
      </div>

      <label ${lbl} style="margin-top:15px;">Supporting Attachments</label>
      <div id="paymentPreviews" class="modal-preview-grid" style="${currentModalFiles.length > 0 ? "" : "display:none;"}"></div>
      ${isAlreadyPaid ? "" : `<label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="p_multi_uploader" accept="image/*,application/pdf" multiple style="display:none"></label>`}`;

    if (isAlreadyPaid) {
      submit.style.display = "none";
    } else {
      submit.style.display = "block";
    }

    // Wire reference dropdown
    const pDir = document.getElementById("p_direction");
    const pRef = document.getElementById("p_reference");
    const pPartyList = document.getElementById("party_list");
    const updateRefDropdown = () => {
      pRef.innerHTML = pDir.value === "INFLOW" ? inflowRefOpts : outflowRefOpts;
      pPartyList.innerHTML = pDir.value === "INFLOW" ? inflowPartyOpts : outflowPartyOpts;
    };
    pDir.addEventListener("change", updateRefDropdown);
    updateRefDropdown();

    // Auto-fill bank/account from party selection
    document.getElementById("p_party").addEventListener("change", (e) => {
      const sel = e.target.value.trim();
      if (!sel) return;
      const vendorMatch = cache.vendors.find(
        (v) => v && (v.company || v.Company) === sel,
      );
      if (vendorMatch?.account || vendorMatch?.Account) {
        document.getElementById("p_bank").value =
          vendorMatch.bank || vendorMatch.Bank || "";
        document.getElementById("p_account").value =
          vendorMatch.account || vendorMatch.Account || "";
        return;
      }
      const staffMatch = cache.staff.find(
        (s) => s && (s.name || s.Name) === sel,
      );
      if (staffMatch?.account || staffMatch?.Account) {
        document.getElementById("p_bank").value =
          staffMatch.bank || staffMatch.Bank || "";
        document.getElementById("p_account").value =
          staffMatch.account || staffMatch.Account || "";
      }
    });

    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("paymentPreviews");
    const uploader = document.getElementById("p_multi_uploader");
    if (uploader)
      uploader.onchange = (e) =>
        processIncomingMultiAttachments(e.target.files, "paymentPreviews");

    // Render the staged table, then sync the displayed Amount with whichever
    // Payment Request stage is selected (handles pre-filled edit data too)
    setTimeout(() => {
      renderPaymentStagesTable();
      refreshPaymentRequestDropdown(
        isEdit ? editData.paymentRequest || editData.PaymentRequest || "" : "",
      );
      syncPaymentAmountFromRequestSelection();
      setupPaymentRequestAutoUncheck();
    }, 50);

    submit.onclick = () => {
      const requestVal = document.getElementById("p_payment_request").value;
      if (!requestVal) {
        showToast("Please select a Payment Request stage.", "error");
        return;
      }
      const amtVal = document.getElementById("p_amount").value;
      if (!amtVal) {
        showToast(
          `No amount set for "${requestVal}" — add an amount in the Payment Schedule above.`,
          "error",
        );
        return;
      }
      let accVal = document.getElementById("p_account").value;
      if (accVal) accVal = String(accVal).padStart(10, "0");
      if (accVal && accVal.length !== 10) {
        showToast("Account Number must be exactly 10 digits.", "error");
        return;
      }
      if (!validatePaymentStages()) return;
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updatePayment" : "savePayment", {
        paymentId: uniqueId,
        direction: document.getElementById("p_direction").value,
        party: sanitizeInput(document.getElementById("p_party").value),
        bank: sanitizeInput(document.getElementById("p_bank").value),
        account: accVal,
        reference: document.getElementById("p_reference").value,
        type: sanitizeInput(document.getElementById("p_type").value),
        reason: sanitizeInput(document.getElementById("p_reason").value),
        totalJobValue: document.getElementById("p_total_job").value,
        paymentRequest: requestVal,
        amount: amtVal,
        date: toSheetDate(document.getElementById("p_date").value),
        isPaid: document.getElementById("p_is_paid").checked,
        stages: JSON.stringify(paymentStages),

        attachments: currentModalFiles.join(","),
      }, editData, "payments")
        .then(() => {
          closeModal();
          refreshData("payments");
          showToast(isEdit ? "Payment updated" : "Payment saved", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── INVENTORY ──
  else if (type === "inventory") {
    const uniqueItem = isEdit
      ? editData.itemId || editData.ItemId
      : await generateNextRecordId("INV", "Inventory", "itemId", cache.inventory);
    title.innerText = isEdit
      ? "Edit Stock Ledger Item"
      : "Register New Inventory Item";
    body.innerHTML = `
      <label ${lbl}>Item Code</label><input id="i_id" value="${escapeHtml(uniqueItem)}" disabled ${ls}>
      <label ${lbl}>Item / Resource Name</label><input id="i_name" value="${isEdit ? escapeHtml(editData.name || editData.Name) : ""}" placeholder="e.g. Led Bulb 18W" ${ls}>
      <label ${lbl}>Stock Quantity</label><input id="i_qty" type="number" value="${isEdit ? escapeHtml(editData.qty || editData.Qty) : "0"}" ${ls}>
      <label ${lbl}>Category</label><input id="i_category" value="${isEdit ? escapeHtml(editData.category || editData.Category) : ""}" placeholder="e.g. Electrical" ${ls}>
      <label ${lbl}>Restock Alert Threshold</label><input id="i_min" type="number" value="${isEdit ? escapeHtml(editData.minAlert || editData.MinAlert) : "5"}" ${ls}>
      <label ${lbl}>Location Notes</label><textarea id="i_notes" rows="2" ${ls}>${isEdit ? escapeHtml(editData.notes || editData.Notes) : ""}</textarea>
      <label ${lbl}>Archive State</label>
      <select id="i_archived" ${ls}>
        <option value="No" ${isEdit && String(editData.archived || editData.Archived) === "Yes" ? "" : "selected"}>Active</option>
        <option value="Yes" ${isEdit && String(editData.archived || editData.Archived) === "Yes" ? "selected" : ""}>Archived</option>
      </select>`;
    submit.onclick = () => {
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateInventory" : "saveInventory", {
        itemId: uniqueItem,
        name: sanitizeInput(document.getElementById("i_name").value),
        qty: document.getElementById("i_qty").value,
        category: sanitizeInput(document.getElementById("i_category").value),
        minAlert: document.getElementById("i_min").value,
        notes: sanitizeInput(document.getElementById("i_notes").value),
        archived: document.getElementById("i_archived").value,
      }, editData, "inventory")
        .then(() => {
          closeModal();
          refreshData("inventory");
          showToast(isEdit ? "Item updated" : "Item registered", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── UTILITY ──
  else if (type === "utility") {
    title.innerText = isEdit ? "Update Utility Data" : "Record Utility Data";
    body.innerHTML = `
      <label ${lbl}>Select Asset Unit</label><select id="u_apt" ${ls}></select>
      <label ${lbl}>Utility Profile Class</label>
      <select id="u_type" ${ls}>
        <option value="Electricity" ${isEdit && editData.type === "Electricity" ? "selected" : ""}>Electricity Meter</option>
        <option value="Water" ${isEdit && editData.type === "Water" ? "selected" : ""}>Water Gauge</option>
      </select>
      <label ${lbl}>Meter Box Serial No</label><input id="u_meter" value="${isEdit ? escapeHtml(editData.meterNo || "") : ""}" disabled ${ls}>
      <label ${lbl}>Consumption Meter Reading</label><input id="u_reading" type="number" value="${isEdit ? escapeHtml(editData.reading || "") : ""}" ${ls}>
      <label ${lbl}>Token Purchase Cost (₦)</label><input id="u_amount" type="number" value="${isEdit ? escapeHtml(editData.amount || editData.Amount || "") : ""}" ${ls}>
      <label ${lbl}>Log Notes</label><textarea id="u_notes" rows="2" ${ls}>${isEdit ? escapeHtml(editData.notes || "") : ""}</textarea>`;
    populateUnitDropdown("u_apt", isEdit ? getUnitNumber(editData) : "");
    submit.onclick = () => {
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateUtility" : "saveUtility", {
        rowId: isEdit ? editData.rowId || editData.id || "" : "",
        apt: document.getElementById("u_apt").value,
        type: document.getElementById("u_type").value,
        meterNo: sanitizeInput(document.getElementById("u_meter").value),
        reading: document.getElementById("u_reading").value,
        amount: document.getElementById("u_amount").value,
        notes: sanitizeInput(document.getElementById("u_notes").value),
        photos: isEdit ? editData.photos || "" : "",
      }, editData, "utilities")
        .then(() => {
          closeModal();
          refreshData("utilities");
          showToast(isEdit ? "Utility updated" : "Utility logged", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── GENERATOR ──
  else if (type === "generator") {
    title.innerText = isEdit ? "Update Plant Status" : "Log Plant Status";
    body.innerHTML = `
      <label ${lbl}>Select Heavy Plant Machine</label>
      <select id="g_equipment" ${ls}>
        <option value="GENERATOR-1" ${isEdit && String(editData.apt || editData.Apt) === "GENERATOR-1" ? "selected" : ""}>Generator 1 (Main)</option>
        <option value="GENERATOR-2" ${isEdit && String(editData.apt || editData.Apt) === "GENERATOR-2" ? "selected" : ""}>Generator 2 (Backup)</option>
        <option value="DIESEL-TANK" ${isEdit && String(editData.apt || editData.Apt) === "DIESEL-TANK" ? "selected" : ""}>Bulk Diesel Fuel Reservoir</option>
      </select>
      <label ${lbl}>S/N</label><input id="g_sn" value="${isEdit ? escapeHtml(editData.sn || editData.SN || "") : ""}" disabled ${ls}>
      <label ${lbl}>Engine Run Hours Meter</label><input id="g_reading" type="number" step="0.1" value="${isEdit ? escapeHtml(editData.reading || "") : ""}" ${ls}>
      <label ${lbl}>Tank Current Level</label>
      <select id="g_tank" ${ls}>
        ${["Tank Level: Full (100%)", "Tank Level: Half Full (50%)", "Tank Level: Critical (10%)"].map((v) => `<option value="${v}" ${isEdit && editData.meterNo === v ? "selected" : ""}>${v.replace("Tank Level: ", "")}</option>`).join("")}
      </select>
      <label ${lbl}>Diesel Liters Added</label><input id="g_added" type="number" value="${isEdit ? escapeHtml(editData.amount || editData.Amount || "") : ""}" ${ls}>
      <label ${lbl}>Field Observations</label><textarea id="g_notes" rows="2" ${ls}>${isEdit ? escapeHtml(editData.notes || "") : ""}</textarea>`;
    setTimeout(() => {
      const updateSN = () => {
        const eq = document.getElementById("g_equipment").value;
        const snInput = document.getElementById("g_sn");
        if (!snInput) return;
        if (isEdit && editData.sn) {
          snInput.value = editData.sn;
          return;
        }
        if (eq === "GENERATOR-1") snInput.value = "SN-G1-MAIN-101";
        else if (eq === "GENERATOR-2") snInput.value = "SN-G2-STBY-202";
        else if (eq === "DIESEL-TANK") snInput.value = "SN-DT-BULK-303";
      };
      document
        .getElementById("g_equipment")
        .addEventListener("change", updateSN);
      updateSN();
    }, 0);
    submit.onclick = () => {
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateUtility" : "saveUtility", {
        rowId: isEdit ? editData.rowId || editData.id || "" : "",
        apt: document.getElementById("g_equipment").value,
        type: "Plant Check",
        meterNo: document.getElementById("g_tank").value,
        reading: document.getElementById("g_reading").value,
        amount: document.getElementById("g_added").value || 0,
        notes: sanitizeInput(document.getElementById("g_notes").value),
        photos: isEdit ? editData.photos || "" : "",
        sn: document.getElementById("g_sn").value,
      }, editData, "utilities")
        .then(() => {
          closeModal();
          refreshData("utilities");
          showToast(
            isEdit ? "Plant log updated" : "Plant log saved",
            "success",
          );
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── STAFF ──
  else if (type === "staff") {
    const uniqueId = isEdit
      ? editData.rowId || editData.RowId
      : await generateNextRecordId("STF", "Staff", "rowId", cache.staff);
    title.innerText = "Staff Profile Management";
    currentAvatarPhoto = isEdit ? editData.passport || editData.Passport : "";
    if (isEdit && (editData.attachments || editData.Attachments))
      currentModalFiles = String(editData.attachments || editData.Attachments)
        .split(",")
        .filter(Boolean);
    const avatarSrc = currentAvatarPhoto
      ? getDirectImageUrl(currentAvatarPhoto)
      : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='60' height='60'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%236c757d'/%3E%3C/svg%3E";
    body.innerHTML = `
      <div class="passport-frame-container" style="position:relative;">
        <img id="passport_frame_view" src="${avatarSrc}" style="width:100%; height:100%; object-fit:cover;" alt="Staff photo">
        <label style="position:absolute; bottom:2px; right:2px; background:var(--primary); color:#fff; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; cursor:pointer;"><i class="fas fa-camera" style="font-size:12px;"></i><input type="file" id="st_pass_uploader" accept="image/*" capture="environment" style="display:none"></label>
        <div id="p_avatar_remove_btn" data-modal-action="clear-avatar-photo" style="position:absolute; top:2px; right:2px; background:var(--danger); color:white; border:2px solid white; border-radius:50%; width:22px; height:22px; display:${currentAvatarPhoto ? "flex" : "none"}; align-items:center; justify-content:center; font-size:12px; font-weight:900; cursor:pointer; z-index:15;" role="button" aria-label="Remove">&times;</div>
      </div>
      <label ${lbl}>Staff ID</label><input id="st_id" value="${escapeHtml(uniqueId)}" ${ls} ${isEdit ? "disabled" : ""}>
      <label ${lbl}>Full Name</label><input id="st_name" value="${isEdit ? escapeHtml(editData.name || editData.Name) : ""}" ${ls}>
      <label ${lbl}>Address</label><input id="st_address" value="${isEdit ? escapeHtml(editData.address || editData.Address || "") : ""}" ${ls}>
      <label ${lbl}>Role / Specialization</label><input id="st_role" value="${isEdit ? escapeHtml(editData.role || editData.Role) : ""}" ${ls}>
      <label ${lbl}>Phone 1</label><input id="st_p1" type="tel" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${isEdit ? escapeHtml(editData.phone1 || editData.Phone1 || "") : ""}" ${ls}>
      <label ${lbl}>Phone 2</label><input id="st_p2" type="tel" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${isEdit ? escapeHtml(editData.phone2 || editData.Phone2 || "") : ""}" ${ls}>
      <label ${lbl}>Email</label><input id="st_email" type="email" value="${isEdit ? escapeHtml(editData.email || editData.Email || "") : ""}" ${ls}>
      <label ${lbl}>Bank Name</label><input list="bank_list" id="st_bank" value="${isEdit ? escapeHtml(editData.bank || editData.Bank || "") : ""}" placeholder="e.g. GTBank" ${ls}>
      <label ${lbl}>Account Number</label><input id="st_account" type="text" inputmode="numeric" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${isEdit ? escapeHtml(editData.account || editData.Account || "") : ""}" placeholder="10 Digit Account Number" ${ls}>
      <label ${lbl}>Archive State</label>
      <select id="st_archived" ${ls}>
        <option value="No" ${isEdit && String(editData.archived || editData.Archived) === "No" ? "selected" : ""}>Active Member</option>
        <option value="Yes" ${isEdit && String(editData.archived || editData.Archived) === "Yes" ? "selected" : ""}>Archived / Deactivated</option>
      </select>
      <label ${lbl}>Form Attachments</label>
      <div id="stAttachmentsPreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="st_multi_uploader" accept="image/*,application/pdf" multiple style="display:none"></label>`;
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("stAttachmentsPreviews");
    document.getElementById("st_pass_uploader").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = async (evt) => {
        let comp = evt.target.result;
        if (file.size > 200 * 1024)
          comp = await compressImageToTargetLimit(evt.target.result, 185000);
        callApi("uploadImage", {
          base64: comp,
          name: "pass_" + uniqueId + ".jpg",
        }).then((res) => {
          if (res?.url) {
            currentAvatarPhoto = res.url;
            document.getElementById("passport_frame_view").src =
              getDirectImageUrl(res.url);
            document.getElementById("p_avatar_remove_btn").style.display =
              "flex";
          }
        });
      };
      r.readAsDataURL(file);
    };
    document.getElementById("st_multi_uploader").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "stAttachmentsPreviews");
    submit.onclick = () => {
      const p1 = document.getElementById("st_p1").value;
      const p2 = document.getElementById("st_p2").value;
      if (!p1 || p1.length !== 11) {
        showToast("Phone 1 must be exactly 11 digits.", "error");
        return;
      }
      if (p2 && p2.length !== 11) {
        showToast("Phone 2 must be exactly 11 digits if provided.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateStaff" : "saveStaff", {
        rowId: document.getElementById("st_id").value,
        name: sanitizeInput(document.getElementById("st_name").value),
        address: sanitizeInput(document.getElementById("st_address").value),
        role: sanitizeInput(document.getElementById("st_role").value),
        phone1: String(p1),
        phone2: String(p2),
        email: sanitizeInput(document.getElementById("st_email").value),
        bank: sanitizeInput(document.getElementById("st_bank").value),
        account: String(document.getElementById("st_account").value).padStart(
          10,
          "0",
        ),
        passport: currentAvatarPhoto,
        attachments: currentModalFiles.join(","),
        archived: document.getElementById("st_archived").value,
      }, editData, "staff")
        .then(() => {
          closeModal();
          refreshData("staff");
          showToast(isEdit ? "Staff updated" : "Staff registered", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── VENDOR ──
  else if (type === "vendor") {
    const uniqueId = isEdit
      ? editData.rowId || editData.RowId
      : await generateNextRecordId("VND", "Vendors", "rowId", cache.vendors);
    title.innerText = "Vendor SLA Registry Profile";
    currentAvatarPhoto = isEdit ? editData.passport || editData.Passport : "";
    if (isEdit && (editData.attachments || editData.Attachments))
      currentModalFiles = String(editData.attachments || editData.Attachments)
        .split(",")
        .filter(Boolean);
    let vPhone1 = isEdit
      ? String(editData.phone1 || editData.Phone1 || "").replace(/[^0-9]/g, "")
      : "";
    if (vPhone1.length === 10 && !vPhone1.startsWith("0"))
      vPhone1 = "0" + vPhone1;
    let vPhone2 = isEdit
      ? String(editData.phone2 || editData.Phone2 || "").replace(/[^0-9]/g, "")
      : "";
    if (vPhone2.length === 10 && !vPhone2.startsWith("0"))
      vPhone2 = "0" + vPhone2;
    const avatarSrc = currentAvatarPhoto
      ? getDirectImageUrl(currentAvatarPhoto)
      : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='60' height='60'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' fill='%236c757d'/%3E%3C/svg%3E";
    body.innerHTML = `
      <div class="passport-frame-container" style="position:relative;">
        <img id="vendor_frame_view" src="${avatarSrc}" style="width:100%; height:100%; object-fit:cover;" alt="Vendor photo">
        <label style="position:absolute; bottom:2px; right:2px; background:var(--primary); color:#fff; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; cursor:pointer;"><i class="fas fa-camera" style="font-size:12px;"></i><input type="file" id="v_pass_uploader" accept="image/*" capture="environment" style="display:none"></label>
        <div id="p_avatar_remove_btn" data-modal-action="clear-avatar-photo" style="position:absolute; top:2px; right:2px; background:var(--danger); color:white; border:2px solid white; border-radius:50%; width:22px; height:22px; display:${currentAvatarPhoto ? "flex" : "none"}; align-items:center; justify-content:center; font-size:12px; font-weight:900; cursor:pointer; z-index:15;" role="button" aria-label="Remove">&times;</div>
      </div>
      <label ${lbl}>Vendor ID</label><input id="v_id" value="${escapeHtml(uniqueId)}" ${ls} ${isEdit ? "disabled" : ""}>
      <label ${lbl}>Corporate Entity Name</label><input id="v_company" value="${isEdit ? escapeHtml(editData.company || editData.Company) : ""}" ${ls}>
      <label ${lbl}>Business Address</label><input id="v_address" value="${isEdit ? escapeHtml(editData.address || editData.Address || "") : ""}" ${ls}>
      <label ${lbl}>Trade Domain</label><input id="v_trade" value="${isEdit ? escapeHtml(editData.trade || editData.Trade) : ""}" ${ls}>
      <label ${lbl}>Primary Contact Name</label><input id="v_contact" value="${isEdit ? escapeHtml(editData.contactName || editData.ContactName) : ""}" ${ls}>
      <label ${lbl}>Phone 1</label><input id="v_phone1" type="tel" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeHtml(vPhone1)}" ${ls}>
      <label ${lbl}>Phone 2</label><input id="v_phone2" type="tel" maxlength="11" inputmode="numeric" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${escapeHtml(vPhone2)}" ${ls}>
      <label ${lbl}>Corporate Email</label><input id="v_email" type="email" value="${isEdit ? escapeHtml(editData.email || editData.Email || "") : ""}" ${ls}>
      <label ${lbl}>Bank Name</label><input list="bank_list" id="v_bank" value="${isEdit ? escapeHtml(editData.bank || editData.Bank || "") : ""}" placeholder="e.g. Zenith Bank" ${ls}>
      <label ${lbl}>Account Number</label><input id="v_account" type="text" inputmode="numeric" maxlength="10" oninput="this.value=this.value.replace(/[^0-9]/g,'')" value="${isEdit ? escapeHtml(editData.account || editData.Account || "") : ""}" placeholder="10 Digit Account Number" ${ls}>
      <label ${lbl}>SLA Contract Expiration</label><input id="v_end" type="date" value="${isEdit ? fromSheetDate(editData.contractEnd || editData.ContractEnd) : ""}" ${ls}>
      <label ${lbl}>Archive State</label>
      <select id="v_archived" ${ls}>
        <option value="No" ${isEdit && String(editData.archived || editData.Archived) === "No" ? "selected" : ""}>Active Portfolio</option>
        <option value="Yes" ${isEdit && String(editData.archived || editData.Archived) === "Yes" ? "selected" : ""}>Archived</option>
      </select>
      <label ${lbl}>Form Attachments</label>
      <div id="vAttachmentsPreviews" class="modal-preview-grid" style="display:none;"></div>
      <label class="icon-upload-label"><i class="fas fa-paperclip"></i><input type="file" id="v_multi_uploader" accept="image/*,application/pdf" multiple style="display:none"></label>`;
    if (isEdit && currentModalFiles.length > 0)
      populateModalInlineImageGalleryPreviews("vAttachmentsPreviews");
    document.getElementById("v_pass_uploader").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const r = new FileReader();
      r.onload = async (evt) => {
        let comp = evt.target.result;
        if (file.size > 200 * 1024)
          comp = await compressImageToTargetLimit(evt.target.result, 185000);
        callApi("uploadImage", {
          base64: comp,
          name: "vpass_" + uniqueId + ".jpg",
        }).then((res) => {
          if (res?.url) {
            currentAvatarPhoto = res.url;
            document.getElementById("vendor_frame_view").src =
              getDirectImageUrl(res.url);
            document.getElementById("p_avatar_remove_btn").style.display =
              "flex";
          }
        });
      };
      r.readAsDataURL(file);
    };
    document.getElementById("v_multi_uploader").onchange = (e) =>
      processIncomingMultiAttachments(e.target.files, "vAttachmentsPreviews");
    submit.onclick = () => {
      const p1 = document.getElementById("v_phone1").value;
      const p2 = document.getElementById("v_phone2").value;
      if (!p1 || p1.length !== 11) {
        showToast("Phone 1 must be exactly 11 digits.", "error");
        return;
      }
      if (p2 && p2.length !== 11) {
        showToast("Phone 2 must be exactly 11 digits if provided.", "error");
        return;
      }
      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(isEdit ? "updateVendor" : "saveVendor", {
        rowId: document.getElementById("v_id").value,
        company: sanitizeInput(document.getElementById("v_company").value),
        address: sanitizeInput(document.getElementById("v_address").value),
        trade: sanitizeInput(document.getElementById("v_trade").value),
        contactName: sanitizeInput(document.getElementById("v_contact").value),
        phone1: String(p1),
        phone2: String(p2),
        email: sanitizeInput(document.getElementById("v_email").value),
        bank: sanitizeInput(document.getElementById("v_bank").value),
        account: String(document.getElementById("v_account").value).padStart(
          10,
          "0",
        ),
        contractEnd: toSheetDate(document.getElementById("v_end").value),
        passport: currentAvatarPhoto,
        attachments: currentModalFiles.join(","),
        archived: document.getElementById("v_archived").value,
      }, editData, "vendors")
        .then(() => {
          closeModal();
          refreshData("vendors");
          showToast(isEdit ? "Vendor updated" : "Vendor registered", "success");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // ── APP USER (Manage Users — admin only, enforced server-side
  //    regardless of who can reach this UI; see checkBusinessPermission
  //    in Code.gs. Not a business record, so it doesn't go through
  //    cache/refreshData like everything else — renderUsersList()
  //    below re-fetches the roster directly on success. ──
  else if (type === "user") {
    title.innerText = isEdit ? "Edit User: " + escapeHtml(editData.name) : "New User";
    body.innerHTML = `
      <div class="form-field span-3"><label ${lbl}>Full Name</label><input id="u_name" value="${isEdit ? escapeHtml(editData.name || "") : ""}" ${ls}></div>
      <div class="form-field"><label ${lbl}>Role</label>
        <select id="u_role" ${ls}>
          ${["viewer", "staff", "manager", "admin"]
            .map((r) => `<option value="${r}" ${isEdit && editData.role === r ? "selected" : ""}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="form-field"><label ${lbl}>Email <span style="font-weight:600; color:var(--muted);">(for the daily digest)</span></label><input id="u_email" type="email" value="${isEdit ? escapeHtml(editData.email || "") : ""}" ${ls}></div>
      ${
        isEdit
          ? `<div class="form-field"><label ${lbl}>Account Status</label>
              <select id="u_active" ${ls}>
                <option value="true" ${editData.active ? "selected" : ""}>Active</option>
                <option value="false" ${!editData.active ? "selected" : ""}>Disabled</option>
              </select>
            </div>`
          : `<div class="form-field"><label ${lbl}>Starting PIN</label><input id="u_pin" type="text" inputmode="numeric" placeholder="At least 4 digits" ${ls}></div>`
      }
    `;

    submit.onclick = () => {
      const name = sanitizeInput(document.getElementById("u_name").value);
      const role = document.getElementById("u_role").value;
      const email = sanitizeInput(document.getElementById("u_email").value);

      if (!name) {
        showToast("Name is required.", "error");
        return;
      }

      const action = isEdit ? "updateUser" : "createUser";
      const payload = isEdit
        ? {
            userId: editData.userId,
            name,
            role,
            email,
            active: document.getElementById("u_active").value === "true",
          }
        : { name, role, email, pin: document.getElementById("u_pin").value.trim() };

      if (!isEdit && payload.pin.length < 4) {
        showToast("Starting PIN must be at least 4 digits.", "error");
        return;
      }

      submit.disabled = true;
      submit.classList.add("loading");
      submitModalRecord(action, payload)
        .then(() => {
          closeModal();
          showToast(isEdit ? "User updated." : "User created.", "success");
          renderUsersList(isDesktopShell() ? "desktop-user-list" : "mobile-user-list");
        })
        .catch(() => {
          submit.disabled = false;
          submit.classList.remove("loading");
        });
    };
  }

  // Focus first input
  setTimeout(() => {
    const firstInput = body.querySelector(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    );
    if (firstInput) firstInput.focus();
  }, 100);
}

function closeModal() {
  const overlay = document.getElementById("modalOverlay");
  if (overlay) {
    overlay.classList.remove("active");
    setTimeout(() => {
      overlay.style.display = "none";
      document.getElementById("modalBody").innerHTML = "";
    }, 200);
  }
  if (lastFocusedElement) lastFocusedElement.focus();
  // [BUG FIX] This used to unconditionally call
  // bootstrapDataRegistriesPipeline() — a full reload of all 12 sheets,
  // with its own full-screen "Loading..." overlay — on every single
  // close, including plain Cancel clicks where nothing changed. Every
  // save handler already calls refreshData(listRefreshKey) itself for
  // just the list that actually changed, so this was firing a second,
  // much heavier reload on top of that on every successful save (and a
  // pointless one on every cancel). Given how long a full getAllData
  // can take, that full-screen loader appearing right after the modal
  // closes was easy to mistake for "the dialog didn't close" — the
  // modal really did close instantly; it was just immediately covered.
}

// ─────────────────────────────────────────────
