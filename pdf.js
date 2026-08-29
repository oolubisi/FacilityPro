// =========================================================
// PDF.JS — Image Compression · PDF Engine · Single-Record
//          Print Functions (work order, expense, cash, payment)
// Load order: 6th
// Depends on: core.js, records.js (cache lookups)
// =========================================================

// § IMAGE COMPRESSION
// ─────────────────────────────────────────────
function compressImageToTargetLimit(base64Str, targetMaxBytes) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width,
        h = img.height;
      if (w > h) {
        if (w > 1000) {
          h *= 1000 / w;
          w = 1000;
        }
      } else {
        if (h > 1000) {
          w *= 1000 / h;
          h = 1000;
        }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      let q = 0.8,
        res = canvas.toDataURL("image/jpeg", q);
      while (res.length > targetMaxBytes && q > 0.15) {
        q -= 0.1;
        res = canvas.toDataURL("image/jpeg", q);
      }
      resolve(res);
    };
    img.onerror = () => resolve(base64Str);
  });
}

// ─────────────────────────────────────────────
// § PDF ENGINE
// ─────────────────────────────────────────────
function generateReportRef(prefix = "RPT") {
  const now = new Date(),
    pad = (n) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${String(now.getTime()).slice(-4)}`;
}

function generateStandardReportHeader(
  reportTitle,
  reportRef = "",
  showTitleLine = true,
) {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = new Date().toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `
    <div style="padding-bottom: 14px; margin-bottom: 18px; page-break-inside: avoid;">
      <table style="width:100%; border-collapse:collapse; border:none; margin:0;">
        <tr style="border:none;">
          <td style="border:none; vertical-align:top; width:55%; padding:0;">
            <h1 style="margin:0; font-size:24px; font-weight:900; text-transform:uppercase; color:#000;">${escapeHtml(appSettings.estateName || "FACILITY PRO ESTATE")}</h1>
            <p style="margin:3px 0 0 0; font-size:10px; color:#333; line-height:1.4;">${escapeHtml(appSettings.estateAddress || "")}</p>
            <p style="margin:8px 0 0 0; font-size:11px; color:#555; font-weight:700;">Managed by: ${escapeHtml(appSettings.fmName || "Facility Management")}</p>
            ${showTitleLine && reportTitle ? `<p style="margin:10px 0 0 0; font-size:16px; font-weight:900; text-transform:uppercase; color:#000;">${escapeHtml(reportTitle)}</p>` : ""}
          </td>
          <td style="border:none; vertical-align:top; text-align:right; width:45%; padding:0;">
            <div style="background:#f4f4f4; border:1px solid #ccc; padding:8px 10px; border-radius:6px; display:inline-block; text-align:left;">
              <p style="margin:0 0 2px 0; font-size:9px; color:#555; font-weight:700; text-transform:uppercase;">Report Ref</p>
              <p style="margin:0; font-size:13px; font-weight:900; font-family:monospace; color:#000;">${escapeHtml(reportRef || generateReportRef())}</p>
              <p style="margin:6px 0 2px 0; font-size:9px; color:#555; font-weight:700; text-transform:uppercase;">Date Generated</p>
              <p style="margin:0; font-size:12px; font-weight:800; color:#000;">${escapeHtml(today)} <span style="font-weight:400; color:#666;">at ${escapeHtml(time)}</span></p>
            </div>
          </td>
        </tr>
      </table>
    </div>`;
}

function wrapReportContent(
  contentHtml,
  reportTitle,
  reportRef = "",
  showTitleLine = true,
) {
  return `<div style="font-family: 'Helvetica', 'Arial', sans-serif; color: #000; background: #fff; width: 100%; max-width: 900px; margin: 0 auto; padding: 0; line-height: 1.4; box-sizing: border-box;">
    ${generateStandardReportHeader(reportTitle, reportRef, showTitleLine)}
    <div style="min-height: 500px;">${contentHtml}</div>
  </div>`;
}

function normalizeReportSource(source) {
  if (typeof source === "string") {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = source;
    return wrapper;
  }
  return source;
}

// Sanitize HTML string before sending to server
function sanitizeHtmlForServer(htmlString) {
  if (!htmlString) return "";
  // Remove script tags and event handlers
  let clean = String(htmlString)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*["']?[^"'>]*["']?/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  return clean;
}

function enableReportTablePagination(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;

  root.querySelectorAll("table").forEach((table) => {
    table.classList.add("report-flow-table");
    table.style.pageBreakInside = "auto";
    table.style.breakInside = "auto";
    table.style.borderCollapse = "collapse";
    table.style.width = "100%";

    table.querySelectorAll("thead").forEach((thead) => {
      thead.style.display = "table-header-group";
    });
    table.querySelectorAll("tbody").forEach((tbody) => {
      tbody.style.display = "table-row-group";
    });
    table.querySelectorAll("tr").forEach((row) => {
      row.style.pageBreakInside = "avoid";
      row.style.breakInside = "avoid";
      row.style.pageBreakAfter = "auto";
      row.style.breakAfter = "auto";
    });
    table.querySelectorAll("th, td").forEach((cell) => {
      cell.style.pageBreakInside = "auto";
      cell.style.breakInside = "auto";
      cell.style.overflowWrap = "anywhere";
      cell.style.wordBreak = "break-word";
    });

    let parent = table.parentElement;
    while (parent && parent !== root) {
      const hasOnlyThisTable =
        parent.querySelectorAll("table").length === 1 &&
        parent.textContent.trim() === table.textContent.trim();
      if (!hasOnlyThisTable) parent.classList.add("report-flow-section");
      parent.style.pageBreakInside = "auto";
      parent.style.breakInside = "auto";
      parent = parent.parentElement;
    }
  });
}

async function compileAndDownloadUnifiedPDF(
  sourceElement,
  attachmentUrls = [],
  filename = "Facility_Report",
  reportTitle = "Facility Report",
  reportRef = "",
  showTitleLine = true,
) {
  const normalizedSource = normalizeReportSource(sourceElement);
  if (!normalizedSource || typeof normalizedSource.cloneNode !== "function") {
    showToast("Report content is not ready yet.", "error");
    return;
  }

  // [BUG FIX] If a previous PDF generation is still in its 2.5s cleanup
  // grace window (or somehow got orphaned entirely — e.g. a tab
  // switch/crash mid-request), remove it before starting a new one.
  // Without this, two overlapping #pdf-loading-screen elements could
  // exist at once, and — combined with this element previously being
  // missing from the @media print hide-list — a completely unrelated
  // native print (window.print(), used by printSinglePaymentSystem on
  // desktop) could end up capturing this overlay instead of its own
  // intended content if it fired while one was still on screen.
  document.getElementById("pdf-loading-screen")?.remove();

  const loadingScreen = document.createElement("div");
  loadingScreen.id = "pdf-loading-screen";
  loadingScreen.style.cssText =
    "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.92); z-index:999999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif;";
  loadingScreen.innerHTML = `<i class="fas fa-server fa-spin" style="font-size:50px; margin-bottom:20px; color:#0D6EFD;"></i><h2 style="margin:0;">Generating PDF...</h2><p style="margin-top:8px; color:#aaa; font-size:14px;">Preparing a shareable document.</p>`;
  document.body.appendChild(loadingScreen);

  try {
    const clone = normalizedSource.cloneNode(true);
    const originalInputs = normalizedSource.querySelectorAll(
      "input, select, textarea",
    );
    const clonedInputs = clone.querySelectorAll("input, select, textarea");
    originalInputs.forEach((original, index) => {
      const cloneNode = clonedInputs[index];
      if (!cloneNode) return;
      const span = document.createElement("span");
      if (original.type === "checkbox" || original.type === "radio") {
        span.innerHTML = original.checked ? "<b>Yes</b>" : "No";
        span.style.fontSize = "14px";
      } else {
        span.textContent = original.value || original.textContent || "";
      }
      span.style.cssText =
        "display:inline-block; font-weight:bold; color:#000;";
      if (cloneNode.parentNode)
        cloneNode.parentNode.replaceChild(span, cloneNode);
    });
    enableReportTablePagination(clone);

    const rawHtml = wrapReportContent(
      clone.innerHTML,
      reportTitle,
      reportRef,
      showTitleLine,
    );
    const sanitizedHtml = sanitizeHtmlForServer(rawHtml);

    const cleanHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        @page { size: A4 portrait; margin: 12mm 10mm 12mm 10mm; }
        body { font-family: Arial, sans-serif; color: #333; background: #fff; padding: 0; margin: 0; font-size: 11px; line-height: 1.4; }
        * { box-sizing: border-box; }

        /* Table page-break flow */
        .report-flow-section {
          page-break-inside: auto !important;
          break-inside: auto !important;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-bottom: 12px; 
          border: 1px solid #444 !important;
          page-break-inside: auto !important;
          break-inside: auto !important;
        }
        thead { 
          display: table-header-group !important; 
        }
        tbody { 
          display: table-row-group !important; 
        }
        tr { 
          page-break-inside: avoid !important;
          break-inside: avoid !important;
          page-break-after: auto !important;
          break-after: auto !important;
        }
        th, td { 
          text-align: left; 
          padding: 6px 8px; 
          border: 1px solid #ccc !important; 
          vertical-align: top;
          page-break-inside: auto !important;
          break-inside: auto !important;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        th { 
          background-color: #f4f4f4; 
          -webkit-print-color-adjust: exact; 
          print-color-adjust: exact; 
        }
        img { max-width: 100%; }
        h1, h2, h3, h4 { page-break-after: avoid; }
      </style>
    </head><body>${sanitizedHtml}</body></html>`;

    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "generatePDF", html: cleanHTML, token: API_TOKEN, sessionToken: currentUser?.sessionToken || null }),
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      throw new Error("Invalid PDF response");
    }
    if (result.code === "AUTH_REQUIRED") {
      clearStoredSession();
      if (typeof window.handleSessionExpired === "function") window.handleSessionExpired();
      throw new Error("Your session expired. Please log in again.");
    }
    if (result.status !== "success")
      throw new Error(result.message || "PDF generation failed");
    if (!result.base64) throw new Error("No PDF data received");

    loadingScreen.querySelector("h2").innerText = "Processing Attachments...";
    const { PDFDocument, degrees, rgb } = PDFLib;
    const pdfBytes = Uint8Array.from(atob(result.base64), (c) =>
      c.charCodeAt(0),
    );
    const masterPdf = await PDFDocument.load(pdfBytes);

    for (const url of attachmentUrls || []) {
      if (!url) continue;
      const fileId = extractDriveFileId(url);
      if (!fileId) continue;
      try {
        const fileData = await callApi("getFileBase64", { id: fileId });
        if (fileData?.status === "success" && fileData.base64) {
          const bytes = Uint8Array.from(
            atob(fileData.base64.replace(/\s/g, "")),
            (c) => c.charCodeAt(0),
          );
          if (fileData.mimeType?.startsWith("application/pdf")) {
            const extPdf = await PDFDocument.load(bytes);
            const pages = await masterPdf.copyPages(
              extPdf,
              extPdf.getPageIndices(),
            );
            pages.forEach((p) => masterPdf.addPage(p));
          } else if (fileData.mimeType?.startsWith("image/")) {
            const img =
              fileData.mimeType === "image/png"
                ? await masterPdf.embedPng(bytes)
                : await masterPdf.embedJpg(bytes);
            const page = masterPdf.addPage();
            const ratio = Math.min(
              (page.getWidth() - 80) / img.width,
              (page.getHeight() - 80) / img.height,
              1,
            );
            page.drawImage(img, {
              x: (page.getWidth() - img.width * ratio) / 2,
              y: (page.getHeight() - img.height * ratio) / 2,
              width: img.width * ratio,
              height: img.height * ratio,
            });
          }
        }
      } catch (e) {
        console.error("Attachment error:", e);
      }
    }

    const pages = masterPdf.getPages();
    pages.forEach((page) => {
      const { width, height } = page.getSize();
      // Watermark only — footer (page numbers, branding) has been removed per request.
      page.drawText("Facility Pro", {
        x: width / 4,
        y: height / 2,
        size: 48,
        rotate: degrees(-45),
        opacity: 0.08,
        color: rgb(0.5, 0.5, 0.5),
      });
    });

    loadingScreen.querySelector("h2").innerText = "Finishing up...";
    const finalPdfBytes = await masterPdf.save();
    const file = new File([finalPdfBytes], filename + ".pdf", {
      type: "application/pdf",
    });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: filename,
        text: "Facility Pro report attached.",
        files: [file],
      });
      loadingScreen.innerHTML =
        '<i class="fas fa-check-circle" style="font-size:50px; margin-bottom:20px; color:#198754;"></i><h2 style="margin:0;">Shared Successfully!</h2>';
      showToast("PDF shared successfully", "success");
    } else {
      loadingScreen.innerHTML =
        '<i class="fas fa-download" style="font-size:50px; margin-bottom:20px; color:#198754;"></i><h2 style="margin:0;">Downloading...</h2>';
      const blob = new Blob([finalPdfBytes], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename + ".pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(link.href), 3000);
      showToast("PDF downloaded", "success");
    }
  } catch (err) {
    console.error("PDF Generation Failed:", err);
    showToast(err?.message || "PDF generation failed. Check connection.", "error");
  } finally {
    setTimeout(() => {
      const screen = document.getElementById("pdf-loading-screen");
      if (screen) screen.remove();
    }, 2500);
  }
}

// ─────────────────────────────────────────────
// § PRINT FUNCTIONS
// ─────────────────────────────────────────────
function printSingleWorkOrderDirect(woId, includeAttachments = true) {
  const orderItem = cache.workorders.find(
    (w) => w && String(w.workOrderId || w.WorkOrderId) === woId,
  );
  if (!orderItem) {
    showToast("Work order not found", "error");
    return;
  }
  const unitId = getUnitNumber(orderItem);
  const woStatus = String(
    orderItem.status || orderItem.Status || "PENDING",
  ).toUpperCase();
  const statusBadge =
    woStatus === "APPROVED"
      ? `<span style="background-color:#198754; color:#fff; padding:4px 10px; border-radius:4px;">${escapeHtml(woStatus)}</span>`
      : escapeHtml(woStatus);
  let assetInfo = "N/A";
  if (orderItem.asset || orderItem.Asset) {
    const ast = cache.assets.find(
      (a) =>
        a &&
        String(a.tag || a.Tag) === String(orderItem.asset || orderItem.Asset),
    );
    assetInfo = ast
      ? `${ast.tag || "N/A"}; ${ast.type || "N/A"}; ${ast.specs || "N/A"}; ${ast.loc || ast.Loc || "N/A"}`
      : orderItem.asset || orderItem.Asset;
  }
  const html = `<div style="width:100%; padding:0; font-family:'Inter', sans-serif; color:#000; background:#fff; box-sizing:border-box;">
    <h3 style="text-transform:uppercase; margin-bottom:15px; font-size:16px; font-weight:900;">Work Order Authorization Form</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px; page-break-inside:auto;">
      <tr><th style="width:30%; padding:10px; border:1px solid #000; background:#f0f0f0;">Work Order Ref</th><td style="padding:10px; border:1px solid #000;"><strong>${escapeHtml(orderItem.workOrderId || orderItem.WorkOrderId)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Date</th><td style="padding:10px; border:1px solid #000;">${formatDateForDisplay(orderItem.date || orderItem.Date)}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Target Node</th><td style="padding:10px; border:1px solid #000;">Unit ${escapeHtml(unitId)} | Asset: ${escapeHtml(assetInfo)}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Assigned</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.assigned || orderItem.Assigned || "Unassigned")}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Duration</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.duration || orderItem.Duration || "Not Specified")}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f9f9f9;">Submitted Value</th><td style="padding:10px; border:1px solid #000; font-size:15px; color:#555;"><strong>₦${formatMoney(orderItem.submittedValue || orderItem.SubmittedValue)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#e8f4fd;">Negotiated Value</th><td style="padding:10px; border:1px solid #000; background:#e8f4fd; font-size:18px;"><strong>₦${formatMoney(orderItem.amount || orderItem.Amount)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f9f9f9;">Amount in Words</th><td style="padding:10px; border:1px solid #000; font-style:italic;"><strong>${convertAmountToWords(orderItem.amount || orderItem.Amount)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Status</th><td style="padding:10px; border:1px solid #000;"><strong>${statusBadge}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0; vertical-align:top;">Scope</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.description || orderItem.Description || "")}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0; vertical-align:top;">Notes</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.notes || orderItem.Notes || "")}</td></tr>
    </table>
  </div>`;
  const attachmentsArr =
    includeAttachments && (orderItem.attachments || orderItem.Attachments)
      ? String(orderItem.attachments || orderItem.Attachments)
          .split(",")
          .filter(Boolean)
      : [];
  compileAndDownloadUnifiedPDF(
    html,
    attachmentsArr,
    `WorkOrder_${woId}`,
    `Work Order Authorization - ${woId}`,
    woId,
    false,
  );
}

function printSingleExpenseRequestDirect(reqId) {
  const orderItem = cache.expenseRequests.find(
    (w) => w && String(w.reqId || w.ReqId) === reqId,
  );
  if (!orderItem) {
    showToast("Request not found", "error");
    return;
  }
  const unitId = getUnitNumber(orderItem);
  const html = `<div style="width:100%; padding:0; font-family:'Inter', sans-serif; color:#000; background:#fff; box-sizing:border-box;">
    <h3 style="text-transform:uppercase; margin-bottom:15px; font-size:16px; font-weight:900;">Expense Request Form</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px; page-break-inside:auto;">
      <tr><th style="width:30%; padding:10px; border:1px solid #000; background:#f0f0f0;">Request Ref</th><td style="padding:10px; border:1px solid #000;"><strong>${escapeHtml(orderItem.reqId || orderItem.ReqId)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Apt : Asset</th><td style="padding:10px; border:1px solid #000;">Unit ${escapeHtml(unitId)} : ${escapeHtml(orderItem.assetTag || "N/A")}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#e8f4fd;">Estimated Cost</th><td style="padding:10px; border:1px solid #000; background:#e8f4fd; font-size:18px;"><strong>₦${formatMoney(orderItem.cost || orderItem.Cost)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f9f9f9;">Amount in Words</th><td style="padding:10px; border:1px solid #000; font-style:italic;"><strong>${convertAmountToWords(orderItem.cost || orderItem.Cost)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0; vertical-align:top;">Job Scope</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.job || orderItem.Job || "")}</td></tr>
    </table>
  </div>`;
  const attachmentsArr =
    orderItem.attachments || orderItem.Attachments
      ? String(orderItem.attachments || orderItem.Attachments)
          .split(",")
          .filter(Boolean)
      : [];
  compileAndDownloadUnifiedPDF(
    html,
    attachmentsArr,
    `ExpenseReq_${reqId}`,
    `Expense Request - ${reqId}`,
    reqId,
    false,
  );
}

function printSingleCashExpenseDirect(cashId) {
  const orderItem = cache.cashExpenses.find(
    (w) => w && String(w.cashId || w.CashId) === cashId,
  );
  if (!orderItem) {
    showToast("Expense not found", "error");
    return;
  }
  const unitId = getUnitNumber(orderItem);
  const html = `<div style="width:100%; padding:0; font-family:'Inter', sans-serif; color:#000; background:#fff; box-sizing:border-box;">
    <h3 style="text-transform:uppercase; margin-bottom:15px; font-size:16px; font-weight:900;">Cash Expense Voucher</h3>
    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:14px; page-break-inside:auto;">
      <tr><th style="width:30%; padding:10px; border:1px solid #000; background:#f0f0f0;">Voucher ID</th><td style="padding:10px; border:1px solid #000;"><strong>${escapeHtml(orderItem.cashId || orderItem.CashId)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Associated Unit</th><td style="padding:10px; border:1px solid #000;">Unit ${escapeHtml(unitId)}</td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#e8f4fd;">Amount Dispensed</th><td style="padding:10px; border:1px solid #000; background:#e8f4fd; font-size:22px;"><strong>₦${formatMoney(orderItem.amount || orderItem.Amount)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f9f9f9;">Amount in Words</th><td style="padding:10px; border:1px solid #000; font-style:italic;"><strong>${convertAmountToWords(orderItem.amount || orderItem.Amount)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0; vertical-align:top;">Justification</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.description || orderItem.Description || "")}</td></tr>
    </table>
  </div>`;
  const attachmentsArr =
    orderItem.attachments || orderItem.Attachments
      ? String(orderItem.attachments || orderItem.Attachments)
          .split(",")
          .filter(Boolean)
      : [];
  compileAndDownloadUnifiedPDF(
    html,
    attachmentsArr,
    `CashVoucher_${cashId}`,
    `Cash Expense Voucher - ${cashId}`,
    cashId,
    false,
  );
}

// Builds the printable HTML for a single payment record.
// Returns { html, documentTitle, orderItem } or null if the payment can't be found.
// Shared by printSinglePaymentDirect (PDF/share pipeline) and
// printSinglePaymentSystem (native window.print() pipeline).
function buildPaymentDocumentHtml(paymentId, includeDisbursement = true) {
  const orderItem = cache.payments.find(
    (p) => p && String(p.paymentId || p.PaymentId) === paymentId,
  );
  if (!orderItem) {
    showToast("Payment not found", "error");
    return null;
  }
  const isOutflow = orderItem.direction === "OUTFLOW";
  const documentTitle = isOutflow
    ? "Payment Voucher / Request"
    : "Official Receipt";
  const partyLabel = isOutflow ? "Payee / Vendor" : "Received From";

  // Build staged payment schedule table for print if available
  let stagesHtml = "";
  let parsedStages = [];
  if (orderItem.stages || orderItem.Stages) {
    try {
      parsedStages = JSON.parse(orderItem.stages || orderItem.Stages);
      if (Array.isArray(parsedStages) && parsedStages.length > 0) {
        const stageTotalPaid = parsedStages
          .filter((s) => s.status === "Paid")
          .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
        stagesHtml = `
          <h4 style="margin:20px 0 8px 0; font-size:13px; text-transform:uppercase; color:#444; border-bottom:1px solid #ccc; padding-bottom:4px;">Payment Schedule — Staged Breakdown</h4>
          <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:15px;">
            <thead><tr style="background:#f0f0f0;">
              <th style="padding:8px; border:1px solid #000; text-align:left;">Stage</th>
              <th style="padding:8px; border:1px solid #000; text-align:right;">Amount (₦)</th>
              <th style="padding:8px; border:1px solid #000; text-align:center;">Status</th>
            </tr></thead>
            <tbody>
              ${parsedStages
                .map(
                  (s) => `<tr>
                <td style="padding:8px; border:1px solid #ccc;">${escapeHtml(s.label)}</td>
                <td style="padding:8px; border:1px solid #ccc; text-align:right; font-weight:700;">₦${formatMoney(s.amount)}</td>
                <td style="padding:8px; border:1px solid #ccc; text-align:center; font-weight:800; color:${s.status === "Paid" ? "#198754" : s.status === "Partial" ? "#856404" : "#dc3545"};">${escapeHtml(s.status)}</td>
              </tr>`,
                )
                .join("")}
              <tr style="background:#f9f9f9; font-weight:900;">
                <td style="padding:8px; border:1px solid #000;">Total Paid Stages</td>
                <td style="padding:8px; border:1px solid #000; text-align:right; color:#198754;">₦${formatMoney(stageTotalPaid)}</td>
                <td style="padding:8px; border:1px solid #000;"></td>
              </tr>
            </tbody>
          </table>`;
      }
    } catch (e) {}
  }

  // Disbursement amount is always derived from the selected Payment Request stage,
  // never trusted directly from a stored "amount" field — this guarantees the
  // printed amount reflects the current stage selection even on older records,
  // and falls back to 0.00 if no stage is selected or the label doesn't match
  // any row in the schedule.
  const disbursement = getDisbursementDetails(orderItem, parsedStages, partyLabel);
  const { selectedStageLabel, disbursementAmount, showPaymentRequest } = disbursement;

  let finalLayoutHtml = `<div style="width:100%; padding:0; font-family:'Inter', sans-serif; color:#000; background:#fff; box-sizing:border-box;">
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:15px;">
      <h3 style="text-transform:uppercase; margin:0; font-size:16px; font-weight:900;">${escapeHtml(documentTitle)} - ${escapeHtml(orderItem.paymentId || orderItem.PaymentId)}</h3>
      <div style="font-size:13px; font-weight:700;">Date <span style="font-weight:900;">${formatDateForDisplay(orderItem.date || orderItem.Date)}</span></div>
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:10px; font-size:14px;">
      ${orderItem.reference || orderItem.Reference ? `<tr><th style="width:30%; padding:10px; border:1px solid #000; background:#f0f0f0;">Linked Record</th><td style="padding:10px; border:1px solid #000;"><strong>${escapeHtml(orderItem.reference || orderItem.Reference)}</strong></td></tr>` : ""}
      <tr><th style="width:30%; padding:10px; border:1px solid #000; background:#f0f0f0;">Reason</th><td style="padding:10px; border:1px solid #000;">${escapeHtml(orderItem.reason || orderItem.Reason || "")}</td></tr>
      ${orderItem.totalJobValue || orderItem.TotalJobValue ? `<tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Total Contract Value</th><td style="padding:10px; border:1px solid #000; font-size:16px;"><strong>₦${formatMoney(orderItem.totalJobValue || orderItem.TotalJobValue)}</strong></td></tr>` : ""}
      ${showPaymentRequest && (orderItem.paymentRequest || orderItem.PaymentRequest) ? `<tr><th style="padding:10px; border:1px solid #000; background:#f0f0f0;">Payment Request</th><td style="padding:10px; border:1px solid #000;"><strong>${escapeHtml(orderItem.paymentRequest || orderItem.PaymentRequest)}</strong></td></tr>` : ""}
      <tr><th style="padding:10px; border:1px solid #000; background:#e8f4fd;">Amount to Pay</th><td style="padding:10px; border:1px solid #000; background:#e8f4fd; font-size:18px;"><strong>₦${formatMoney(orderItem.amount || orderItem.Amount)}</strong></td></tr>
      <tr><th style="padding:10px; border:1px solid #000; background:#f9f9f9;">Amount in Words</th><td style="padding:10px; border:1px solid #000; font-style:italic;"><strong>${convertAmountToWords(orderItem.amount || orderItem.Amount)}</strong></td></tr>
    </table>
    ${stagesHtml}
    ${showPaymentRequest && includeDisbursement ? renderDisbursementBoxHtml(orderItem, disbursement) : ""}
  </div>`;

  return { html: finalLayoutHtml, documentTitle, orderItem };
}

// Computes the selected stage / disbursement amount / party label for a payment.
// Shared by the single-record layout and the bulk "Print Pending PRs" view.
function getDisbursementDetails(orderItem, parsedStages, partyLabel) {
  const selectedStageLabel =
    orderItem.paymentRequest || orderItem.PaymentRequest || "";
  const matchedStage = selectedStageLabel
    ? (parsedStages || []).find(
        (s) =>
          String(s.label).trim().toLowerCase() ===
          String(selectedStageLabel).trim().toLowerCase(),
      )
    : null;
  const disbursementAmount = matchedStage
    ? parseFloat(matchedStage.amount) || 0
    : 0;
  const showPaymentRequest =
    orderItem.showPaymentRequest !== false &&
    orderItem.ShowPaymentRequest !== false;

  return { selectedStageLabel, disbursementAmount, partyLabel, showPaymentRequest };
}

// Renders the dashed "Disbursement Details" box. Shared by the single-record
// layout and the bulk "Print Pending PRs" view.
function renderDisbursementBoxHtml(orderItem, disbursement) {
  const { selectedStageLabel, disbursementAmount, partyLabel } = disbursement;
  return `<div style="border:2px dashed #000; padding:20px; margin-top:25px; background:#fafafa; border-radius:8px; page-break-inside:avoid; page-break-before:auto;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:15px; border-bottom:1px solid #ccc; padding-bottom:5px;">
        <h4 style="margin:0; text-transform:uppercase; font-size:14px; color:#444;">Disbursement Details</h4>
        <span style="font-weight:900; font-size:21px; text-align:right; color:#000;">${escapeHtml(selectedStageLabel || "Not Selected")}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:16px; align-items:flex-end;">
        <div style="width:35%;"><small style="color:#666; font-weight:700; font-size:12px; display:block; text-transform:uppercase;">${escapeHtml(partyLabel)}</small><strong>${escapeHtml(orderItem.party || orderItem.Party || "N/A")}</strong></div>
        <div style="width:30%;"><small style="color:#666; font-weight:700; font-size:12px; display:block; text-transform:uppercase;">Bank Account</small><strong>${orderItem.account || orderItem.Account ? String(orderItem.account || orderItem.Account).padStart(10, "0") : "N/A"}</strong><br><span style="font-size:14px; color:#555;">${escapeHtml(orderItem.bank || orderItem.Bank || "")}</span></div>
        <div style="width:35%; text-align:right;"><small style="color:#666; font-weight:700; font-size:12px; display:block; text-transform:uppercase; margin-bottom:4px;">Amount</small><span style="font-size:30px; font-weight:900; color:#000; display:block; line-height:1;">₦${formatMoney(disbursementAmount)}</span></div>
      </div>
    </div>`;
}

function printSinglePaymentDirect(paymentId) {
  const built = buildPaymentDocumentHtml(paymentId);
  if (!built) return;
  const { orderItem, documentTitle } = built;
  let finalLayoutHtml = built.html;

  let combinedAttachments =
    orderItem.attachments || orderItem.Attachments
      ? String(orderItem.attachments || orderItem.Attachments)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const ref = orderItem.reference || orderItem.Reference;
  if (ref?.startsWith("WO-")) {
    const wo = cache.workorders.find(
      (w) => w && String(w.workOrderId || w.WorkOrderId) === ref,
    );
    if (wo) {
      finalLayoutHtml += `<div style="page-break-before:always;"><br><h3 style="text-transform:uppercase; font-size:15px; font-weight:900;">[Supporting Doc] Work Order ${escapeHtml(ref)}</h3></div>`;
      if (wo.attachments || wo.Attachments)
        combinedAttachments.push(
          ...String(wo.attachments || wo.Attachments)
            .split(",")
            .filter(Boolean),
        );
    }
  } else if (ref?.startsWith("EXR-")) {
    const exr = cache.expenseRequests.find(
      (r) => r && String(r.reqId || r.ReqId) === ref,
    );
    if (exr && (exr.attachments || exr.Attachments))
      combinedAttachments.push(
        ...String(exr.attachments || exr.Attachments)
          .split(",")
          .filter(Boolean),
      );
  }

  combinedAttachments = Array.from(new Set(combinedAttachments));
  compileAndDownloadUnifiedPDF(
    finalLayoutHtml,
    combinedAttachments,
    `Ledger_${orderItem.paymentId || orderItem.PaymentId}`,
    `${documentTitle} - ${orderItem.paymentId || orderItem.PaymentId}`,
    orderItem.paymentId || orderItem.PaymentId,
    false,
  );
}

// ─────────────────────────────────────────────
// § SYSTEM (NATIVE) PRINT — used by the desktop app, bypasses the
// mobile PDF-generation/share pipeline and just opens the OS print dialog.
// ─────────────────────────────────────────────
function printSinglePaymentSystem(paymentId) {
  const built = buildPaymentDocumentHtml(paymentId);
  if (!built) return;

  const container = document.getElementById("report-print-container");
  if (!container) {
    showToast("Print container not found on this page.", "error");
    return;
  }

  container.innerHTML = built.html;
  const originalTitle = document.title;
  document.title = `${built.documentTitle} - ${paymentId}`;
  showToast(`Sending ${paymentId} to printer...`, "info", 2500);
  // [BUG FIX] Belt-and-suspenders on top of the @media print fix — if a
  // completely unrelated PDF-download request left its loading overlay
  // in the DOM, this print would otherwise capture that instead of
  // `built.html` above.
  document.getElementById("pdf-loading-screen")?.remove();
  window.print();
  setTimeout(() => {
    document.title = originalTitle;
  }, 1000);
}

// Prints only the "Disbursement Details" (Payment Request) section for every
// pending (unpaid) payment that has "Show PR" enabled — used by the desktop
// Accounts view's "Print Pending PRs" button.
function printAllPendingPaymentRequests() {
  const pending = (cache.payments || []).filter((p) => {
    if (!p) return false;
    const isPaid =
      String(p.isPaid || p.IsPaid || "").toUpperCase() === "TRUE" || p.isPaid === true;
    const showPaymentRequest = p.showPaymentRequest !== false && p.ShowPaymentRequest !== false;
    return !isPaid && showPaymentRequest;
  });

  if (pending.length === 0) {
    showToast("No pending payment requests to print.", "warning");
    return;
  }

  const boxesHtml = pending
    .map((orderItem) => {
      const isOutflow = orderItem.direction === "OUTFLOW";
      const partyLabel = isOutflow ? "Payee / Vendor" : "Received From";
      let parsedStages = [];
      if (orderItem.stages || orderItem.Stages) {
        try {
          parsedStages = JSON.parse(orderItem.stages || orderItem.Stages);
        } catch (e) {
          parsedStages = [];
        }
      }
      const disbursement = getDisbursementDetails(orderItem, parsedStages, partyLabel);
      const idLine = `<div style="font-size:12px; font-weight:800; color:#666; margin:18px 0 4px;">${escapeHtml(orderItem.paymentId || orderItem.PaymentId || "")}</div>`;
      return idLine + renderDisbursementBoxHtml(orderItem, disbursement);
    })
    .join("");

  const html = `<div style="width:100%; padding:0; font-family:'Inter', sans-serif; color:#000; background:#fff; box-sizing:border-box;">
    <h3 style="text-transform:uppercase; margin:0 0 10px; font-size:16px; font-weight:900;">Pending Payment Requests</h3>
    <div style="font-size:12px; font-weight:700; color:#555; margin-bottom:10px;">${pending.length} pending request${pending.length === 1 ? "" : "s"}</div>
    ${boxesHtml}
  </div>`;

  const voucherPairs = [];
  for (let i = 0; i < pending.length; i += 2) {
    voucherPairs.push(pending.slice(i, i + 2));
  }

  const vouchersHtml = voucherPairs
    .map((pair) => {
      const pageContent = pair
        .map((orderItem, idx) => {
          const built = buildPaymentDocumentHtml(orderItem.paymentId || orderItem.PaymentId, false);
          if (!built) return "";
          const spacer =
            idx === 0 && pair.length > 1
              ? `<div style="height:22px; border-bottom:2px dashed #ccc; margin-bottom:22px;"></div>`
              : "";
          return built.html + spacer;
        })
        .join("");
      return `<div style="page-break-before:always; break-before:page; page-break-inside:avoid;">${pageContent}</div>`;
    })
    .join("");

  const combinedHtml = html + vouchersHtml;

  const container = document.getElementById("report-print-container");
  if (!container) {
    showToast("Print container not found on this page.", "error");
    return;
  }

  container.innerHTML = combinedHtml;
  const originalTitle = document.title;
  document.title = "Pending_Payment_Requests";
  showToast(`Sending ${pending.length} pending payment request${pending.length === 1 ? "" : "s"} to printer...`, "info", 2500);
  document.getElementById("pdf-loading-screen")?.remove();
  window.print();
  setTimeout(() => {
    document.title = originalTitle;
  }, 1000);
}

// ─────────────────────────────────────────────
