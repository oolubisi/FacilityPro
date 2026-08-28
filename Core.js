// =========================================================
// CORE.JS — Security · UX Utilities · Formatting · API Layer
//           Data Cache & State
// Load order: 1st (must load before all other app files)
// Depends on: nothing
// =========================================================

// =========================================================
// FACILITY PRO MOBILE — REFACTORED EDITION
// Modules: Security · UX Utilities · Formatting · API Layer
//          Data Cache · Initialization · Navigation
//          Rendering · Modal System · PDF Engine · Reports
// =========================================================

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbywuJnim2WBgSIrM-uFvLxKyBtKvMevnbbs0QOHQBShlsHHtAHbUdJAxeaP524v_Boj/exec";

// [SECURITY FIX] Shared-secret token sent with every request so the
// endpoint above can reject calls that didn't come from this app. This
// is NOT real per-user auth (anyone reading this file can see the
// token too) — it blocks blind/automated hits against the bare GAS URL
// and lets you revoke access by rotating the value in Script Properties
// (see setApiToken() in Code.gs) without redeploying this client.
// IMPORTANT: this value must exactly match what setApiToken() saved on
// the server, or every request will be rejected as unauthorized.
const API_TOKEN = "38f1f6e7-86f7-4a27-bffe-96303db14298";

// ─────────────────────────────────────────────
// § SECURITY UTILITIES
//
// escapeHtml and sanitizeInput look similar (both take a string, both
// strip/encode "dangerous" characters) but serve different moments and
// should NOT be merged or used interchangeably:
//
//   escapeHtml   — OUTPUT encoding. Called every time a value is placed
//                  into innerHTML for display. This is the actual XSS
//                  defense — it entity-encodes &, <, >, ", ' so stored
//                  data can never be interpreted as markup, no matter
//                  what it contains. Almost every renderXxx()/template
//                  literal in the app calls this at render time.
//
//   sanitizeInput — INPUT normalization. Called once, when reading a
//                  free-text form field before sending it to the
//                  server. Trims whitespace and strips only `<`/`>` as
//                  a lightweight defense-in-depth measure (the Apps
//                  Script backend re-sanitizes independently in
//                  sanitizePayload/forceTextForPhoneFields — this is
//                  belt-and-suspenders, not the only line of defense).
//                  It intentionally does NOT touch &, ", ' — encoding
//                  those at input time would corrupt legitimate text
//                  like "Tom & Jerry" or a name with an apostrophe.
//
// Select/dropdown/numeric/date fields don't call either — their values
// are already constrained by the <select> options, populateUnitDropdown,
// input type="number", or inline digit-only filters, so there's nothing
// for either function to protect against.
// ─────────────────────────────────────────────
const escapeHtml = (unsafe) => {
  if (unsafe == null) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const sanitizeInput = (str) => {
  if (!str) return "";
  return String(str).trim().replace(/[<>]/g, "");
};

// ─────────────────────────────────────────────
// § UX UTILITIES
// ─────────────────────────────────────────────
function showToast(message, type = "info", duration = 3000) {
  updateStatusBarMessage(message, type, duration);
  const container = document.getElementById("toast-container");
  if (!container) return;
  const icons = {
    success: "fa-check-circle",
    error: "fa-exclamation-circle",
    warning: "fa-exclamation-triangle",
  };
  const toast = document.createElement("div");
  toast.className = `toast ${escapeHtml(type)}`;
  toast.innerHTML = `<i class="fas ${icons[type] || "fa-info-circle"}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setGlobalLoading(show, text = "Loading...") {
  const loader = document.getElementById("global-loader");
  if (!loader) return;
  const txt = loader.querySelector(".loader-text");
  if (txt) txt.textContent = text;
  loader.style.display = show ? "flex" : "none";
}

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ─────────────────────────────────────────────
// § FORMATTING HELPERS
// ─────────────────────────────────────────────
function formatMoney(amount) {
  const val = parseFloat(amount);
  if (isNaN(val)) return "0.00";
  return val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function convertAmountToWords(amount) {
  const val = parseFloat(amount);
  if (isNaN(val) || val === 0) return "Zero Naira Only";
  const a = [
    "",
    "One ",
    "Two ",
    "Three ",
    "Four ",
    "Five ",
    "Six ",
    "Seven ",
    "Eight ",
    "Nine ",
    "Ten ",
    "Eleven ",
    "Twelve ",
    "Thirteen ",
    "Fourteen ",
    "Fifteen ",
    "Sixteen ",
    "Seventeen ",
    "Eighteen ",
    "Nineteen ",
  ];
  const b = [
    "",
    "",
    "Twenty ",
    "Thirty ",
    "Forty ",
    "Fifty ",
    "Sixty ",
    "Seventy ",
    "Eighty ",
    "Ninety ",
  ];
  const toWords = (num) => {
    if (num === 0) return "";
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + a[num % 10];
    if (num < 1000)
      return (
        a[Math.floor(num / 100)] +
        "Hundred " +
        (num % 100 > 0 ? "and " + toWords(num % 100) : "")
      );
    if (num < 1000000)
      return (
        toWords(Math.floor(num / 1000)) + "Thousand " + toWords(num % 1000)
      );
    if (num < 1000000000)
      return (
        toWords(Math.floor(num / 1000000)) + "Million " + toWords(num % 1000000)
      );
    return (
      toWords(Math.floor(num / 1000000000)) +
      "Billion " +
      toWords(num % 1000000000)
    );
  };
  const naira = Math.floor(val);
  const kobo = Math.round((val - naira) * 100);
  let result = toWords(naira).trim() + " Naira";
  if (kobo > 0) result += " and " + toWords(kobo).trim() + " Kobo";
  return result + " Only";
}

function fromSheetDate(dStr) {
  if (!dStr) return "";
  dStr = String(dStr).trim();
  if (dStr.match(/^\d{4}-\d{2}-\d{2}/)) return dStr.substring(0, 10);
  if (dStr.includes("/")) {
    const parts = dStr.split(" ")[0].split("/");
    if (parts.length === 3) {
      const day = parts[0].padStart(2, "0"),
        month = parts[1].padStart(2, "0");
      let year = parts[2];
      if (year.length === 2) year = "20" + year;
      return `${year}-${month}-${day}`;
    }
  }
  const parsed = Date.parse(dStr);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  return "";
}

function toSheetDate(dStr) {
  if (!dStr) return "";
  const [y, m, d] = dStr.split("-");
  if (!y || !m || !d) return "";
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

function formatDateForDisplay(dStr) {
  if (!dStr) return "Not Tracked";
  dStr = String(dStr).trim();
  if (dStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) return dStr;
  if (dStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    const parts = dStr.substring(0, 10).split("-");
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  if (dStr.includes("/")) {
    const parts = dStr.split(" ")[0].split("/");
    if (parts.length === 3)
      return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[2]}`;
  }
  const parsed = Date.parse(dStr);
  if (!isNaN(parsed)) {
    const dt = new Date(parsed);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
  }
  return dStr;
}

function parseToLocalDateObject(dateStr) {
  if (!dateStr) return null;
  const normalized = fromSheetDate(dateStr);
  if (!normalized) return null;
  const [y, m, d] = normalized.split("-");
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
}

function getUnitNumber(u) {
  if (!u) return "";
  const keys = [
    "apt",
    "Apt",
    "APT",
    "unit",
    "Unit",
    "UNIT",
    "apartment",
    "Apartment",
  ];
  for (const key of keys)
    if (u[key] !== undefined && u[key] !== null) return String(u[key]);
  for (const key in u)
    if (
      key.toLowerCase().trim() === "apt" ||
      key.toLowerCase().trim() === "unit"
    )
      return String(u[key]);
  return "";
}

function getDirectImageUrl(url) {
  if (!url) return "";
  let normalized = String(url).trim();
  // [BUG FIX] Was previously an all-or-nothing check requiring an
  // explicit http(s):// scheme — someone pasting a link copied straight
  // from a browser address bar without the scheme (e.g.
  // "drive.google.com/file/d/.../view") would silently fail to resolve
  // at all, which (combined with the display-toggle bug in
  // applySettingsToUIHeaders) showed up as a broken-image placeholder
  // instead of the intended logo. Assume https:// if no scheme is
  // present, rather than giving up.
  if (!/^https?:\/\//i.test(normalized)) {
    if (/^[\w.-]+\.[a-z]{2,}\//i.test(normalized) || normalized.includes("drive.google.com")) {
      normalized = "https://" + normalized.replace(/^\/+/, "");
    } else {
      return "";
    }
  }
  if (normalized.includes("drive.google.com")) {
    const fileId =
      normalized.split("/d/")[1]?.split("/")[0] || normalized.split("id=")[1]?.split("&")[0];
    if (fileId)
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  }
  return normalized;
}

function extractDriveFileId(url) {
  if (!url) return null;
  const match =
    url.match(/\/d\/(.+?)(\/|$)/) ||
    url.match(/id=(.+?)(&|$)/) ||
    url.match(/\/file\/d\/(.+?)\//);
  return match ? match[1] : null;
}

// ─────────────────────────────────────────────
// § STATUS BAR (desktop app footer)
// Safe no-op if the markup isn't present (e.g. on mobile), so these can
// be called from shared code (showToast, callApi, etc.) unconditionally.
// ─────────────────────────────────────────────
let statusBarMessageTimer = null;

function updateStatusBarMessage(message, type = "info", duration = 4000) {
  const bar = document.getElementById("statusbar-message");
  const text = document.getElementById("statusbar-message-text");
  if (!bar || !text) return;
  bar.classList.remove("success", "error", "warning", "info");
  bar.classList.add(type);
  text.textContent = message;
  clearTimeout(statusBarMessageTimer);
  statusBarMessageTimer = setTimeout(() => {
    bar.classList.remove("success", "error", "warning", "info");
    text.textContent = "Ready";
  }, duration);
}

function updateStatusBarConnection() {
  const wrap = document.getElementById("statusbar-connection");
  const text = document.getElementById("statusbar-connection-text");
  if (!wrap || !text) return;
  const online = navigator.onLine;
  wrap.classList.toggle("offline", !online);
  text.textContent = online ? "Online" : "Offline";
}

function updateStatusBarSync() {
  const text = document.getElementById("statusbar-sync-text");
  const icon = document.querySelector("#statusbar-sync i");
  if (!text) return;
  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem("facility_pro_sync_queue") || "[]");
  } catch (e) {}
  const conflicts = getSyncConflicts();
  if (conflicts.length > 0) {
    text.textContent = `${conflicts.length} sync conflict${conflicts.length === 1 ? "" : "s"} need review — see Settings`;
    if (icon) icon.className = "fas fa-triangle-exclamation";
  } else if (queue.length > 0) {
    text.textContent = `${queue.length} change${queue.length === 1 ? "" : "s"} pending sync`;
    if (icon) icon.className = "fas fa-rotate";
  } else {
    text.textContent = "All changes synced";
    if (icon) icon.className = "fas fa-check-circle";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", updateStatusBarConnection);
  window.addEventListener("offline", updateStatusBarConnection);
  window.addEventListener("DOMContentLoaded", () => {
    updateStatusBarConnection();
    updateStatusBarSync();
  });
}

// ─────────────────────────────────────────────
// § SESSION (see Login.js for the login screen itself)
// currentUser holds { userId, name, role, sessionToken } once logged in.
// Persisted to localStorage so a page reload doesn't force a re-login —
// Login.js validates/clears this on boot if the server says it's expired.
// ─────────────────────────────────────────────
const SESSION_STORAGE_KEY = "facility_pro_session";
let currentUser = null;

function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function persistSession(session) {
  currentUser = session;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}
}

function clearStoredSession() {
  currentUser = null;
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (e) {}
}

// [FEATURE] Role-based permissions (UX only — see checkBusinessPermission
// in Code.gs for the actual server-side enforcement, which is what
// really matters). Used to hide/disable controls a given role can't
// use, so people aren't shown buttons that would just get rejected.
const ROLE_LEVELS = { viewer: 0, staff: 1, manager: 2, admin: 3 };

function currentUserMeetsRole(minRole) {
  const role = currentUser && currentUser.role;
  const level = ROLE_LEVELS.hasOwnProperty(role) ? ROLE_LEVELS[role] : 0;
  return level >= ROLE_LEVELS[minRole];
}

// ─────────────────────────────────────────────
// § API LAYER
// ─────────────────────────────────────────────
async function callApi(action, data = {}) {
  // Auth actions can't be queued for later — there's nothing meaningful
  // to "sync" about a login attempt once the caller has moved on, and
  // retrying it blind from the offline queue would silently discard
  // whatever sessionToken the eventual retry produced.
  const isAuthAction = action === "login" || action === "logout";

  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action,
        data,
        token: API_TOKEN,
        sessionToken: currentUser?.sessionToken || null,
      }),
    });
    if (!response.ok) throw new Error("HTTP_ERROR_" + response.status);

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      console.error("Invalid JSON:", text.substring(0, 200));
      throw new Error("Server returned invalid data");
    }

    if (result && result.code === "AUTH_REQUIRED") {
      clearStoredSession();
      if (typeof window.handleSessionExpired === "function") {
        window.handleSessionExpired();
      }
    }

    if (action.startsWith("get")) {
      localStorage.setItem(
        "facility_pro_backup_" + action,
        JSON.stringify(result),
      );
    }
    return result;
  } catch (err) {
    console.warn("Network Error / Offline:", err);

    if (err.message && err.message.startsWith("HTTP_ERROR_")) {
      showToast(
        "Server error: " + err.message.replace("HTTP_ERROR_", ""),
        "error",
      );
      return { status: "error", message: err.message };
    }

    if (action.startsWith("get")) {
      const backup = localStorage.getItem("facility_pro_backup_" + action);
      if (backup) {
        try {
          return JSON.parse(backup);
        } catch (e) {}
      }
      return [];
    }

    if (action === "uploadImage") {
      showToast(
        "Cannot upload photos while offline. Please reconnect.",
        "error",
      );
      return null;
    }

    if (isAuthAction) {
      showToast("Can't sign in while offline. Please reconnect.", "error");
      return { status: "error", message: "Offline" };
    }

    const queue = JSON.parse(
      localStorage.getItem("facility_pro_sync_queue") || "[]",
    );
    queue.push({ action, data, timestamp: Date.now() });
    localStorage.setItem("facility_pro_sync_queue", JSON.stringify(queue));
    const syncStatus = document.getElementById("sync-status");
    if (syncStatus) syncStatus.style.display = "block";
    updateStatusBarSync();
    showToast("Saved locally. Will sync when online.", "warning");
    return { status: "queued" };
  }
}

async function processSyncQueue() {
  const queue = JSON.parse(
    localStorage.getItem("facility_pro_sync_queue") || "[]",
  );
  if (queue.length === 0) return;
  const syncStatus = document.getElementById("sync-status");
  if (syncStatus) syncStatus.style.display = "block";
  updateStatusBarSync();

  const remaining = [];
  let conflictCount = 0;
  for (const item of queue) {
    try {
      const result = await callApi(item.action, item.data);
      if (result?.status === "queued") remaining.push(item);
      else if (result?.status === "error") {
        if (result.code === "CONFLICT") {
          // [FEATURE] Don't just drop this — the record changed on the
          // server while this write was queued offline, so silently
          // discarding it would lose the person's edit with no trace.
          // Park it for manual review (see the Diagnostics panel) so
          // they can see what they tried to save and choose to discard
          // it or force it through.
          conflictCount++;
          addSyncConflict(item, result.message);
        } else {
          console.error("Sync failed:", item, result);
          showToast("Sync failed for " + item.action, "error");
        }
      }
    } catch (err) {
      remaining.push(item);
    }
  }

  localStorage.setItem("facility_pro_sync_queue", JSON.stringify(remaining));
  updateStatusBarSync();
  if (conflictCount > 0) {
    showToast(
      conflictCount === 1
        ? "1 change couldn't sync — someone else edited that record. See Diagnostics to review."
        : conflictCount + " changes couldn't sync — someone else edited those records. See Diagnostics to review.",
      "warning",
    );
  }
  if (remaining.length === 0 && conflictCount === 0) {
    if (syncStatus) syncStatus.style.display = "none";
    showToast("All changes synced!", "success");
    bootstrapDataRegistriesPipeline();
  } else if (remaining.length === 0) {
    // Nothing left to retry, but some items became conflicts rather
    // than fully syncing — still worth refreshing the cache so the
    // person sees current data, just without the "all synced" toast.
    bootstrapDataRegistriesPipeline();
  }
}

// ─────────────────────────────────────────────
// § SYNC CONFLICTS (see submitModalRecord in Modals-forms.js for the
// live-online path; this covers the offline-queue-replay path, where
// there's no open modal to show an inline error in, so the conflict
// needs to be parked somewhere the person can come back to).
// ─────────────────────────────────────────────
function getSyncConflicts() {
  try {
    return JSON.parse(localStorage.getItem("facility_pro_sync_conflicts") || "[]");
  } catch (e) {
    return [];
  }
}

function addSyncConflict(item, message) {
  const conflicts = getSyncConflicts();
  conflicts.push({
    action: item.action,
    data: item.data,
    message: message || "This record was changed elsewhere.",
    conflictedAt: Date.now(),
  });
  localStorage.setItem("facility_pro_sync_conflicts", JSON.stringify(conflicts));
  updateStatusBarSync();
}

function discardSyncConflict(index) {
  const conflicts = getSyncConflicts();
  conflicts.splice(index, 1);
  localStorage.setItem("facility_pro_sync_conflicts", JSON.stringify(conflicts));
  updateStatusBarSync();
  if (typeof renderDiagnosticsPanel === "function") renderDiagnosticsPanel();
  if (typeof renderSettingsShortcuts === "function" && typeof desktopState !== "undefined" && desktopState.view === "settings") {
    renderSettingsShortcuts();
  }
  showToast("Discarded.", "success");
}

// Force the queued edit through despite the conflict, by resubmitting
// without expectedUpdatedAt (the server only runs the conflict check
// when that field is present — see Code.gs) — i.e. "yes, overwrite
// whatever is there now with my version."
async function retrySyncConflict(index) {
  const conflicts = getSyncConflicts();
  const item = conflicts[index];
  if (!item) return;

  const forcedData = { ...item.data };
  delete forcedData.expectedUpdatedAt;

  const result = await callApi(item.action, forcedData);
  if (result && result.status === "error") {
    showToast(result.message || "Retry failed.", "error");
    return;
  }

  conflicts.splice(index, 1);
  localStorage.setItem("facility_pro_sync_conflicts", JSON.stringify(conflicts));
  updateStatusBarSync();
  if (typeof renderDiagnosticsPanel === "function") renderDiagnosticsPanel();
  if (typeof renderSettingsShortcuts === "function" && typeof desktopState !== "undefined" && desktopState.view === "settings") {
    renderSettingsShortcuts();
  }
  showToast("Change applied.", "success");
  bootstrapDataRegistriesPipeline();
}

// Shared markup for the conflict list — rendered inside the mobile
// Diagnostics panel (Init.js) and the desktop Settings view (desktop.js)
// so there's exactly one place this HTML is built, even though it
// appears in two different container elements across the two shells.
function getSyncConflictsHtml() {
  const conflicts = getSyncConflicts();
  if (conflicts.length === 0) {
    return `<p style="color:var(--muted); font-size:13px; margin:6px 0 0;">No sync conflicts.</p>`;
  }
  return conflicts
    .map((c, i) => {
      const label = c.data && (c.data.reqId || c.data.cashId || c.data.ticketId || c.data.workOrderId ||
        c.data.paymentId || c.data.itemId || c.data.tag || c.data.rowId || c.data.logId || c.data.apt || c.action);
      return `
        <div style="border:2px solid #e0b34d; background:#fff8ea; border-radius:10px; padding:10px 12px; margin-top:8px;">
          <div style="font-weight:800; font-size:13px;">${escapeHtml(c.action)} — ${escapeHtml(String(label || ""))}</div>
          <div style="font-size:12px; color:#6b4e00; margin:2px 0 8px;">${escapeHtml(c.message)}</div>
          <div style="display:flex; gap:8px;">
            <button data-action="retry-conflict" data-index="${i}" style="flex:1; background:var(--primary); color:#fff; border:0; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:800; cursor:pointer;">Overwrite With My Version</button>
            <button data-action="discard-conflict" data-index="${i}" style="background:#e9ecef; color:#333; border:0; border-radius:6px; padding:6px 10px; font-size:12px; font-weight:800; cursor:pointer;">Discard</button>
          </div>
        </div>`;
    })
    .join("");
}

function handleSyncConflictClick(event) {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const index = Number(actionEl.dataset.index);
  if (actionEl.dataset.action === "discard-conflict") discardSyncConflict(index);
  else if (actionEl.dataset.action === "retry-conflict") retrySyncConflict(index);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", handleSyncConflictClick);
}

// ─────────────────────────────────────────────
// § DATA CACHE & STATE
// ─────────────────────────────────────────────
let cache = {
  apts: [],
  assets: [],
  tickets: [],
  staff: [],
  vendors: [],
  utilities: [],
  workorders: [],
  inventory: [],
  payments: [],
  expenseRequests: [],
  cashExpenses: [],
  maintenanceLog: [],
};

let currentModalFiles = [];
let currentAvatarPhoto = "";
let currentSelectedRecord = null;
let lastFocusedElement = null;

let appSettings = {
  estateName: "Facility Pro Estate",
  estateAddress: "123 Infrastructure Way, Lagos, Nigeria",
  fmName: "Facility Operations Management",
  fmAddress: "Primary Support Office Center",
  logoUrl: "",
  mainFolder: "FacilityPro_Attachments",
};

// ─────────────────────────────────────────────
// § UNIFIED DATA LOADING
// Loads every registry in a single round-trip (getAllData) instead of
// ~11 separate parallel requests — Apps Script serializes concurrent
// executions against the same deployment, so many "parallel" calls end
// up queued server-side. One combined call is significantly faster.
//
// Also supports instant "cached-first" painting: on boot, hydrate `cache`
// synchronously from the last successful local backup before the network
// call even starts, so the UI can render real (if slightly stale) data
// immediately instead of sitting behind a blocking loader.
// ─────────────────────────────────────────────
const CACHE_TO_PAYLOAD_KEY_MAP = {
  apts: "apartments",
  assets: "assets",
  tickets: "maintenance",
  workorders: "workOrders",
  inventory: "inventory",
  staff: "staff",
  vendors: "vendors",
  utilities: "utilities",
  payments: "payments",
  expenseRequests: "expenseRequests",
  cashExpenses: "cashExpenses",
  maintenanceLog: "maintenanceLog",
};

function applyAllDataPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  let applied = false;
  Object.entries(CACHE_TO_PAYLOAD_KEY_MAP).forEach(([cacheKey, payloadKey]) => {
    if (Array.isArray(payload[payloadKey])) {
      cache[cacheKey] = payload[payloadKey];
      applied = true;
    }
  });
  if (payload.settings && typeof payload.settings === "object") {
    appSettings = { ...appSettings, ...payload.settings };
  }
  return applied;
}

// [BUG FIX] Only the mobile shell (Init.js) ever called
// navigator.serviceWorker.register(...) — the desktop/Electron shell
// never registered a Service Worker at all, so it got none of the
// app-shell precaching sw.js provides. This was largely masked by
// main.js's random-port bug (a Service Worker registered under one
// origin was orphaned on the next launch anyway, so it didn't matter
// much whether desktop tried), but now that main.js uses a fixed port,
// this is worth doing properly on both shells. Shared here so both
// call sites (bootMobileApp in Init.js, initDesktop in desktop.js)
// can't drift out of sync again.
function registerServiceWorkerIfSupported() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
}

// Synchronous, no network: paints instantly from whatever was saved
// locally on the last successful load. Falls back to legacy per-action
// backups (from before the single-request getAllData migration) so
// existing users still get an instant paint on their first load after
// updating.
function hydrateCacheFromLocalBackup() {
  try {
    const combined = localStorage.getItem("facility_pro_backup_getAllData");
    if (combined && applyAllDataPayload(JSON.parse(combined))) return true;
  } catch (e) {}

  const legacyActionMap = {
    apts: "getApartments",
    assets: "getAssets",
    tickets: "getMaintenance",
    workorders: "getWorkOrders",
    inventory: "getInventory",
    staff: "getStaff",
    vendors: "getVendors",
    utilities: "getUtilities",
    payments: "getPayments",
    expenseRequests: "getExpenseRequests",
    cashExpenses: "getCashExpenses",
  };
  let applied = false;
  Object.entries(legacyActionMap).forEach(([cacheKey, action]) => {
    try {
      const raw = localStorage.getItem("facility_pro_backup_" + action);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cache[cacheKey] = parsed;
          applied = true;
        }
      }
    } catch (e) {}
  });
  return applied;
}

// Single network round-trip that refreshes every registry at once.
async function loadAllDataFromServer() {
  const result = await callApi("getAllData", {});
  return applyAllDataPayload(result);
}

// ─────────────────────────────────────────────
// § CSV EXPORT
// Shared by both shells. Column configs live in CSV_EXPORT_COLUMNS
// below — add an entry there to support exporting a new view; nothing
// else needs to change.
// ─────────────────────────────────────────────
function escapeCsvValue(value) {
  const str = value === null || value === undefined ? "" : String(value);
  // Quote (and escape internal quotes) any value containing a comma,
  // quote, or newline — the standard CSV escaping rule.
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportRecordsAsCsv(records, columns, filename) {
  if (!records || records.length === 0) {
    showToast("Nothing to export.", "warning");
    return;
  }

  const header = columns.map((c) => escapeCsvValue(c.label)).join(",");
  const rows = records.map((r) =>
    columns
      .map((c) => escapeCsvValue(typeof c.value === "function" ? c.value(r) : r[c.value]))
      .join(","),
  );
  const csvContent = [header, ...rows].join("\r\n");

  // Leading BOM so Excel opens the file as UTF-8 (otherwise ₦ and other
  // non-ASCII characters render as garbled text on Windows).
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast(`Exported ${records.length} record${records.length === 1 ? "" : "s"}.`, "success");
}

const CSV_EXPORT_COLUMNS = {
  payments: [
    { label: "Payment ID", value: (r) => r.paymentId || r.PaymentId || "" },
    { label: "Direction", value: (r) => r.direction || r.Direction || "" },
    { label: "Party", value: (r) => r.party || r.Party || "" },
    { label: "Unit", value: (r) => getUnitNumber(r) },
    { label: "Amount", value: (r) => r.amount || r.Amount || 0 },
    { label: "Bank", value: (r) => r.bank || r.Bank || "" },
    { label: "Account", value: (r) => r.account || r.Account || "" },
    { label: "Date", value: (r) => r.date || r.Date || "" },
    {
      label: "Paid",
      value: (r) =>
        r.isPaid === true || String(r.isPaid || r.IsPaid || "").toUpperCase() === "TRUE" ? "Yes" : "No",
    },
    { label: "Reference", value: (r) => r.reference || r.Reference || "" },
    { label: "Created By", value: (r) => r.createdBy || r.CreatedBy || "" },
    { label: "Last Updated", value: (r) => r.updatedAt || r.UpdatedAt || "" },
  ],
  expenserequests: [
    { label: "Request ID", value: (r) => r.reqId || r.ReqId || "" },
    { label: "Unit", value: (r) => getUnitNumber(r) },
    { label: "Job", value: (r) => r.job || r.Job || "" },
    { label: "Cost", value: (r) => r.cost || r.Cost || 0 },
    { label: "Date", value: (r) => r.date || r.Date || "" },
    { label: "Created By", value: (r) => r.createdBy || r.CreatedBy || "" },
    { label: "Last Updated", value: (r) => r.updatedAt || r.UpdatedAt || "" },
  ],
};

function exportViewAsCsv(viewKey, records) {
  const columns = CSV_EXPORT_COLUMNS[viewKey];
  if (!columns) {
    showToast("Export isn't available for this section yet.", "warning");
    return;
  }
  const dateStamp = new Date().toISOString().split("T")[0];
  exportRecordsAsCsv(records, columns, `${viewKey}-${dateStamp}.csv`);
}

// ─────────────────────────────────────────────
// § SHARED ID GENERATION & SETTINGS
// Used by both the mobile shell (Init.js) and the desktop shell
// (desktop.js). Kept here as a single source of truth so the two shells
// can't silently drift apart on behavior (they used to each ship their
// own copy of these — see CHANGELOG in the repo for the cleanup).
// ─────────────────────────────────────────────
function generateNextId(prefix, list, idKey) {
  let maxId = 0;
  const safeList = Array.isArray(list) ? list : [];
  safeList.forEach((item) => {
    if (!item) return;
    const idVal =
      item[idKey] ||
      item[idKey.charAt(0).toUpperCase() + idKey.slice(1)] ||
      item[idKey.toUpperCase()];
    if (idVal && typeof idVal === "string" && idVal.startsWith(prefix)) {
      const parts = idVal.split("-");
      if (parts.length > 1) {
        const n = parseInt(parts[1], 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      }
    }
  });
  return `${prefix}-${String(maxId + 1).padStart(4, "0")}`;
}

async function generateNextRecordId(prefix, sheetName, idKey, fallbackList) {
  try {
    const response = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "generateId",
        data: { prefix, sheetName, idKey },
        token: API_TOKEN,
        sessionToken: currentUser?.sessionToken || null,
      }),
    });
    if (!response.ok) throw new Error("ID_HTTP_" + response.status);
    const result = await response.json();
    if (result?.status === "success" && result.id) return result.id;
  } catch (err) {
    console.warn("Backend ID generation unavailable; using local fallback.", err);
  }
  return generateNextId(prefix, fallbackList || [], idKey);
}

// Populates a unit-reference <select>. Excludes "services" (Common Area)
// units from the list — those aren't real tenancy units and shouldn't be
// pickable as a unit reference on tickets/assets/etc. Lazily fetches
// apartments from the server if the cache hasn't been loaded yet, so this
// is safe to call before the initial data load has finished.
function populateUnitDropdown(selectElementId, currentlySelectedValue) {
  const sel = document.getElementById(selectElementId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choose Unit Reference --</option>';

  const renderOptions = () => {
    (cache.apts || []).forEach((u) => {
      const uNum = getUnitNumber(u);
      if (!uNum && uNum !== 0) return;
      if (String(u.type || u.Type || "").toLowerCase() === "services") return;
      const opt = document.createElement("option");
      opt.value = uNum;
      opt.textContent = "Unit " + uNum;
      if (
        currentlySelectedValue &&
        String(uNum) === String(currentlySelectedValue)
      )
        opt.selected = true;
      sel.appendChild(opt);
    });
  };

  if (!cache.apts || cache.apts.length === 0) {
    callApi("getApartments", {}).then((res) => {
      if (res && Array.isArray(res)) {
        cache.apts = res;
        if (typeof sortApartmentsCacheList === "function") sortApartmentsCacheList();
        renderOptions();
      }
    });
  } else {
    renderOptions();
  }
}

// [FEATURE] Service Charge contributions/apartment-specific expenses
// only make sense for a tenanted unit — a vacant apartment has no
// tenant to receive a contribution or be charged a specific expense.
// Deliberately a SEPARATE function rather than adding this filter to
// populateUnitDropdown() above, since that shared function is used
// throughout the app (Work Orders, Tickets, Assets, Cash Expenses,
// etc.) where picking a vacant unit is often legitimate — restricting
// it there would silently break those.
function populateOccupiedUnitDropdown(selectElementId, currentlySelectedValue) {
  const sel = document.getElementById(selectElementId);
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Choose Occupied Unit --</option>';

  const renderOptions = () => {
    (cache.apts || []).forEach((u) => {
      const uNum = getUnitNumber(u);
      if (!uNum && uNum !== 0) return;
      if (String(u.type || u.Type || "").toLowerCase() === "services") return;
      if (String(u.status || u.Status || "").toLowerCase() !== "occupied") return;
      const opt = document.createElement("option");
      opt.value = uNum;
      opt.textContent = "Unit " + uNum;
      if (
        currentlySelectedValue &&
        String(uNum) === String(currentlySelectedValue)
      )
        opt.selected = true;
      sel.appendChild(opt);
    });
  };

  if (!cache.apts || cache.apts.length === 0) {
    callApi("getApartments", {}).then((res) => {
      if (res && Array.isArray(res)) {
        cache.apts = res;
        if (typeof sortApartmentsCacheList === "function") sortApartmentsCacheList();
        renderOptions();
      }
    });
  } else {
    renderOptions();
  }
}

// Pushes appSettings values into the shared settings form fields
// (#cfg-estate-name etc). Same field IDs are used in both the mobile
// Settings page and the desktop Settings modal.
function syncSettingsInputsToUIFields() {
  const map = [
    ["cfg-estate-name", "estateName"],
    ["cfg-estate-address", "estateAddress"],
    ["cfg-fm-name", "fmName"],
    ["cfg-fm-address", "fmAddress"],
    ["cfg-logo-url", "logoUrl"],
    ["cfg-main-folder", "mainFolder"],
  ];
  map.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.value = appSettings[key] || "";
  });
}

// Reads the shared settings form fields, sanitizes them into appSettings,
// persists locally + to the server. Returns true/false for whether the
// cloud save succeeded so each shell can decide how to react (toast text,
// whether to navigate away, etc.) without duplicating the read/sanitize/
// persist logic itself.
async function saveApplicationSettingsFromForm() {
  appSettings.estateName = sanitizeInput(
    document.getElementById("cfg-estate-name")?.value,
  );
  appSettings.estateAddress = sanitizeInput(
    document.getElementById("cfg-estate-address")?.value,
  );
  appSettings.fmName = sanitizeInput(
    document.getElementById("cfg-fm-name")?.value,
  );
  appSettings.fmAddress = sanitizeInput(
    document.getElementById("cfg-fm-address")?.value,
  );
  appSettings.logoUrl = sanitizeInput(
    document.getElementById("cfg-logo-url")?.value,
  );
  appSettings.mainFolder =
    sanitizeInput(document.getElementById("cfg-main-folder")?.value) ||
    "FacilityPro_Attachments";

  localStorage.setItem("facility_pro_config_meta", JSON.stringify(appSettings));
  applySettingsToUIHeaders();

  try {
    await callApi("saveSettings", appSettings);
    return true;
  } catch (err) {
    return false;
  }
}
