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

// [CLEANUP] GAS_URL and API_TOKEN used to live here, pointing at a
// Google-Sheets-backed Apps Script deployment that was this app's
// original database. Nothing uses that backend anymore:
//
//   - Desktop reads and writes a local JSON file through window.localApi
//     (electron/local-api.js + db.js). No network involved at all.
//   - Mobile is a read-only viewer of the JSON snapshot the desktop
//     pushes to the "FacilityPro Sync" Drive folder, fetched through the
//     separate token-gated proxy in Code.gs (see drive-sync.js).
//
// The old deployment is in fact still reachable, which is what made this
// worth removing rather than leaving alone: it answers every request
// with `Action "<x>" is not available. This deployment only supports
// exportAllForMigration, uploadMobileSnapshot, and getMobileSnapshot.`
// So each call to it burned ~2.6s on a round trip that could never
// succeed, then fell through to a local fallback — pure latency, plus a
// stale shared token sitting in a public static file.
//
// Every path that used to reach it is now local-only: callApi below,
// generateNextRecordId, and pdf.js's PDF generation (which has used the
// system print dialog on both shells for a while now).

// Written only by versions of this app that still had a remote backend.
// processSyncQueue clears them on boot; nothing writes them now. Named
// here rather than inline so the cleanup and the status bar can't drift
// apart on a mistyped key.
const LEGACY_SYNC_QUEUE_KEY = "facility_pro_sync_queue";
const LEGACY_SYNC_CONFLICTS_KEY = "facility_pro_sync_conflicts";

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

// [FEATURE] Moved here from desktop.js — needed by the shared mobile
// read-only record-detail view (Records.js) too now, not just
// desktop's multi-window snapshot feature that originally owned it.
function labelize(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .trim();
}

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

// [FEATURE] The one definition of "is this record archived" for the
// three archivable record types, so every live list/dropdown that must
// hide archived records asks the same question the Archive view and the
// server (isRecordArchived in local-api.js) do. Assets can be archived
// either by status or by the archived flag; staff and vendors only by
// the flag.
function isRecordArchived(type, item) {
  if (!item) return false;
  const archivedFlag = String(item.archived || item.Archived || "").toLowerCase() === "yes";
  if (type === "asset") {
    return archivedFlag || String(item.status || item.Status || "").toLowerCase() === "archived";
  }
  return archivedFlag;
}

// [FEATURE] Live currency mask for text inputs — treats the last two
// typed digits as cents as you go, so the field always reads as a
// proper amount (e.g. typing "150000" progressively shows "1.50",
// "15.00", "150.00", "1,500.00") rather than a bare integer with no
// decimal place at all. Call via oninput="maskCurrencyInput(this)".
function maskCurrencyInput(inputEl) {
  let digits = inputEl.value.replace(/[^0-9]/g, "");
  if (!digits) {
    inputEl.value = "";
    return;
  }
  digits = digits.replace(/^0+(?=\d)/, "");
  while (digits.length < 3) digits = "0" + digits;
  const cents = digits.slice(-2);
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  inputEl.value = `${whole}.${cents}`;
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

// [BUG FIX] For defaulting a date <input> to "today" — new
// Date().toISOString().slice(0, 10) looks equivalent but isn't:
// toISOString() converts to UTC first, so in any timezone ahead of UTC
// (this app's actual context is WAT, UTC+1), the early hours of a new
// local day still show as "yesterday" in UTC, silently defaulting the
// field to the wrong date right when someone's most likely to be
// logging something first thing in the morning. This formats from
// local date components instead, with no UTC conversion at all.
function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// [PERFORMANCE FIX] `arr.sort((a, b) => new Date(a.date) - new Date(b.date))`
// re-parses each date string on every single comparison the sort makes
// — O(n log n) calls to `new Date(...)`, not O(n). For a few dozen
// rows that's invisible; for a few thousand (exactly what "the
// ledgers get slower as entries grow" describes) it's real, repeated
// work for no reason, since every item's date only needs parsing
// once. This parses once per item up front (decorate/sort/undecorate)
// instead, then sorts on the pre-computed numbers.
function sortByDate(arr, dateField = "date", ascending = true) {
  const decorated = (arr || []).map((item) => [
    new Date(item?.[dateField]).getTime(),
    item,
  ]);
  decorated.sort((a, b) => (ascending ? a[0] - b[0] : b[0] - a[0]));
  return decorated.map((pair) => pair[1]);
}

// [FEATURE] Local-cache-first loading for the manager-only ledgers
// (Service Charge, Petty Cash, Energy, Inventory) — none of them ride
// along in the getAllData bundle (deliberately, so staff/viewer never
// receive this data even in transit), which meant every single visit
// to one of these sections paid Apps Script's full round-trip latency
// before showing anything at all. This shows whatever was cached from
// the last successful fetch immediately, then quietly re-fetches in
// the background and re-renders once fresh data arrives — the
// round-trip itself doesn't get any faster, but the user isn't stuck
// staring at a blank "Loading..." for it on every visit, only the
// very first one (or after a cache-clearing logout).
const LEDGER_CACHE_PREFIX = "facility_pro_ledger_cache_";

function getLedgerCache(key) {
  try {
    const raw = localStorage.getItem(LEDGER_CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setLedgerCache(key, data) {
  try {
    localStorage.setItem(LEDGER_CACHE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    // Storage full/unavailable — caching is a nice-to-have speed
    // boost, not required for correctness, so fail silently rather
    // than interrupt the actual data load.
  }
}

function clearAllLedgerCaches() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(LEDGER_CACHE_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

// Small "syncing in the background" note shown only while a
// cache-first render is waiting on the real fetch behind it — created
// once per container and reused afterward, so this never accumulates
// duplicate badges across repeated visits to the same section.
function showSyncBadge(containerId, show) {
  const container = document.getElementById(containerId);
  if (!container || !container.parentNode) return;
  let badge = document.getElementById(containerId + "-sync-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = containerId + "-sync-badge";
    badge.style.cssText =
      "font-size:11px; color:var(--muted, #888); margin-bottom:6px; display:none;";
    badge.innerHTML =
      '<i class="fas fa-rotate fa-spin"></i> Syncing latest data...';
    container.parentNode.insertBefore(badge, container);
  }
  badge.style.display = show ? "block" : "none";
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
    if (
      /^[\w.-]+\.[a-z]{2,}\//i.test(normalized) ||
      normalized.includes("drive.google.com")
    ) {
      normalized = "https://" + normalized.replace(/^\/+/, "");
    } else {
      return "";
    }
  }
  if (normalized.includes("drive.google.com")) {
    const fileId =
      normalized.split("/d/")[1]?.split("/")[0] ||
      normalized.split("id=")[1]?.split("&")[0];
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

// [CLEANUP] Used to report on the offline write queue and parked sync
// conflicts. Neither exists now: every desktop save is written straight
// to the local file before the call returns, so by the time this runs
// there is never anything in flight or pending. "Saved locally" says
// what is actually true, where the old "All changes synced" implied a
// successful round trip to a server that is no longer there.
function updateStatusBarSync() {
  const text = document.getElementById("statusbar-sync-text");
  const icon = document.querySelector("#statusbar-sync i");
  if (!text) return;
  text.textContent = "Saved locally";
  if (icon) icon.className = "fas fa-check-circle";
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
// [FEATURE] Maps a read action name to the matching key in the
// snapshot the desktop app pushes (see mobile-sync.js's
// SNAPSHOT_COLLECTIONS — these names match exactly on purpose).
// getAllData and getSettings are handled separately in the callApi
// branch below since they need a reshaped/bundled result rather than
// one collection returned as-is.
const MOBILE_SNAPSHOT_READ_MAP = {
  getApartments: "Apartments", getAssets: "Assets", getMaintenance: "Maintenance",
  getStaff: "Staff", getVendors: "Vendors", getUtilities: "Utilities",
  getPayments: "Payments", getMaintenanceLog: "MaintenanceLog",
  getServiceChargeLedger: "ServiceChargeLedger", getPettyCashLedger: "PettyCash",
  getEnergyLedger: "EnergyLedger", getInventoryItems: "InventoryItems",
  getInventoryMovements: "InventoryMovements", getServiceChargeBudgets: "ServiceChargeBudgets",
  getRecurringExpenseTemplates: "RecurringExpenseTemplates",
  // [BUG FIX] Missing entirely, same gap as local-api.js's READ_MAP —
  // Reports.js's Service Charge report needs this for its
  // weighted-split reconciliation.
  getOccupancyLog: "OccupancyLog",
};

async function callApi(action, data = {}, options = {}) {
  // [FEATURE] Local desktop data bridge — when running inside
  // Electron, window.localApi is exposed by preload.js and every call
  // goes straight to the local JSON store (db.js/local-api.js)
  // instead of over the network to Apps Script. An IPC call to a local
  // file has no network latency and no transient failures, which is why
  // the timeout/retry/queue machinery that used to wrap the remote call
  // is gone rather than reused here.
  //
  // This branch is why the desktop app works with no internet at all:
  // nothing below it touches the network.
  if (window.localApi) {
    try {
      return await window.localApi.call(action, data, currentUser?.sessionToken || null);
    } catch (err) {
      return { status: "error", message: "Local data error: " + String(err && err.message ? err.message : err) };
    }
  }

  // [FEATURE] Mobile read-only viewer — every read comes back out of
  // the snapshot already loaded in memory (see bootMobileReadOnlyViewer
  // in Login.js) instead of the network, and every write is blocked
  // outright rather than silently doing nothing: someone filling out a
  // form on mobile should see a clear "read-only" message, not a save
  // button that appears to work but never actually persists anything.
  // getMobileSnapshot itself bypasses this (it's what loads the
  // snapshot in the first place, before this flag is ever set), and
  // logout is allowed through as a no-op so the button doesn't error.
  if (window.isMobileReadOnly) {
    if (action === "logout") return { status: "success" };
    const collectionName = MOBILE_SNAPSHOT_READ_MAP[action];
    if (collectionName) return window.mobileSnapshot[collectionName] || [];
    if (action === "getAllData") {
      const s = window.mobileSnapshot;
      return {
        apartments: s.Apartments || [], assets: s.Assets || [], maintenance: s.Maintenance || [],
        inventory: s.InventoryItems || [], staff: s.Staff || [], vendors: s.Vendors || [],
        payments: s.Payments || [], utilities: s.Utilities || [], maintenanceLog: s.MaintenanceLog || [],
        settings: s.Settings || {},
      };
    }
    if (action === "getSettings") return window.mobileSnapshot.Settings || {};
    // [BUG FIX] Missing entirely — the Executive KPI Dashboard has
    // called this bundled action since before mobile became a
    // read-only snapshot viewer, but it fell through the gap between
    // this file's per-action read map and the getAllData special case
    // right above. Left unfixed, every card on that dashboard showed
    // "Unavailable" on mobile even with a perfectly good snapshot
    // loaded — the six collections it needs (see mobile-sync.js's
    // SNAPSHOT_COLLECTIONS) are all already in the snapshot; they just
    // weren't being bundled under the specific key names that screen
    // expects.
    if (action === "getKpiDashboardData") {
      const s = window.mobileSnapshot;
      return {
        serviceCharge: s.ServiceChargeLedger || [], pettyCash: s.PettyCash || [],
        energy: s.EnergyLedger || [], occupancyLog: s.OccupancyLog || [],
        inventoryItems: s.InventoryItems || [], inventoryMovements: s.InventoryMovements || [],
      };
    }
    return { status: "error", message: "This is a read-only view of data from the desktop app. Make changes there instead." };
  }

  // [CLEANUP] Everything below this point used to be the network leg:
  // a POST to the old Sheets-backed Apps Script, wrapped in timeout
  // handling, a stale-backup fallback for reads, and an offline write
  // queue that replayed queued saves once the browser came back online.
  //
  // None of it can run anymore. Both shells are answered above —
  // desktop by window.localApi (a local JSON file), mobile by
  // window.mobileSnapshot (the Drive snapshot) — so reaching this line
  // means the app is running outside both, with no data source at all.
  // Keeping the old code here would have been actively harmful: its
  // queue told people "Saved locally. Will sync when online." for a
  // sync that can never happen, which loses writes silently.
  //
  // Returning an error is the honest answer. Every caller already
  // handles result.status === "error".
  return {
    status: "error",
    message:
      "No data source available. Open this in the desktop app to make changes, or reload the mobile app to view the latest synced snapshot.",
  };
}

// [FEATURE] For fetches where a confident-looking wrong number is
// worse than an honest "couldn't load" — gives a transient network
// blip a couple of extra chances to resolve itself (short delay
// between attempts) before finally reporting failure via null, rather
// than immediately falling back to callApi's normal stale-backup/[]
// behavior, which a caller checking Array.isArray() can't tell apart
// from a real, successful, genuinely-empty result.
// [BUG FIX] Genuine, fundamental gap this fixes: a result of {status:
// 'error', message: 'HTTP_ERROR_404'} — a real, completed HTTP
// response, not a timeout or thrown network error — used to make this
// loop return immediately without retrying at all, because it isn't
// strictly === null. That's exactly the shape a redirect-downgrade
// 404 produces (the request DID complete, just against the wrong
// page), which is precisely the transient failure this function
// exists to survive. The retry logic was silently never engaging for
// the most common real-world failure mode it was built for. Now
// retries on both: no response at all (null, from a timeout or thrown
// fetch error) or a completed-but-HTTP-error response — anything else
// (a real success, or a business-logic error like "Item name is
// required" that no retry would fix) still returns immediately.
// [CLEANUP] The retry loop that used to live here existed purely to
// absorb Apps Script's redirect quirks and transient network blips.
// Both data sources are now local — a file read on desktop, an
// in-memory snapshot on mobile — and neither has a transient failure
// mode a retry could help with: if the first attempt fails the
// hundredth will too, and the delay between them is dead time in front
// of the user. The signature keeps retries/delayMs so the existing call
// sites need no changes; both are simply ignored now.
async function callApiStrict(action, data = {}, retries = 2, delayMs = 1500) {
  return await callApi(action, data, { strict: true });
}

// [CLEANUP] This used to exist to work around Apps Script serialising
// concurrent requests to the same deployment: firing several callApi()
// calls at once via Promise.all() meant all but the first sat queued,
// and a long enough wait could expire the one-time redirect URL Google
// issued for that request, producing a 404 that never reached the
// server at all. Hence one-at-a-time, plus a deliberate 400ms pause
// between calls to space the batch out further.
//
// With no remote backend left, both of those are now just cost. The
// calls resolve against a local file or an in-memory snapshot, nothing
// serialises them, and the pause alone added 400ms x (n-1) of dead
// time to every batch — two full seconds on a six-call screen like the
// KPI dashboard. Kept as a function (same signature, same ordered
// results) so its call sites are unchanged, but it now runs the batch
// concurrently with no artificial delay.
async function callApiSequential(calls) {
  return await Promise.all(calls.map(([action, data]) => callApiStrict(action, data)));
}

// [CLEANUP] This used to drain an offline write queue: saves made while
// the browser was offline were parked in localStorage and replayed
// against the remote backend once connectivity returned, with a
// conflict-parking system (getSyncConflicts / addSyncConflict /
// retrySyncConflict / getSyncConflictsHtml, all removed with it) for
// writes the server rejected because the record had changed meanwhile.
//
// Nothing can enqueue anything anymore. Desktop writes straight to a
// local file, which does not fail for being offline, and mobile is
// read-only and refuses writes outright. So the queue is permanently
// empty and the conflict path permanently unreachable.
//
// Kept as a function because Init.js and desktop.js's "Sync Now" both
// call it, and because of the one job that genuinely remains: clearing
// any writes a previous version left parked in localStorage. Those
// could never be replayed now — the backend they were meant for is
// gone — and leaving them would strand a stale "N changes pending
// sync" in the status bar forever.
async function processSyncQueue() {
  try {
    if (localStorage.getItem(LEGACY_SYNC_QUEUE_KEY) !== null) {
      localStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
    }
    if (localStorage.getItem(LEGACY_SYNC_CONFLICTS_KEY) !== null) {
      localStorage.removeItem(LEGACY_SYNC_CONFLICTS_KEY);
    }
  } catch (err) {
    /* localStorage unavailable — nothing to clean up. */
  }
  const syncStatus = document.getElementById("sync-status");
  if (syncStatus) syncStatus.style.display = "none";
  updateStatusBarSync();
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
  inventory: [],
  payments: [],
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
  inventory: "inventory",
  staff: "staff",
  vendors: "vendors",
  utilities: "utilities",
  payments: "payments",
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
    // [BUG FIX] Without this, bumping sw.js's CACHE_NAME to ship updated
    // files required reloading the app TWICE: the first reload is what
    // lets the browser notice the new sw.js and activate it
    // (skipWaiting + clients.claim take over immediately), but the page
    // that triggered that reload was already mid-flight when the new
    // Service Worker took control, so it was still served from the OLD
    // cache. Only a second, separate reload actually got the new files.
    // That's exactly the "I restarted the app and my change still isn't
    // there" confusion this caused repeatedly. Reloading automatically
    // the moment a new Service Worker takes control closes that gap —
    // guarded with a flag so it fires at most once per page load, since
    // controllerchange firing a second time (e.g. from an unrelated
    // update) shouldn't trigger a reload loop.
    //
    // [BUG FIX] ...but it must NOT fire on a first install. With no
    // controller yet, nothing on this page was served from a stale
    // cache, so there is nothing for a reload to fix — and reloading
    // anyway threw away whatever was already in flight. On mobile that
    // meant the ~10s snapshot fetch got cancelled a second or two in
    // and restarted from scratch, doubling an already slow first load
    // (and looking, from the outside, exactly like the app hanging).
    // Only a null -> worker transition is skipped; a worker -> worker
    // transition is a genuine update and still reloads.
    const hadControllerAtBoot = !!navigator.serviceWorker.controller;
    let reloadedForNewServiceWorker = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadControllerAtBoot) return;
      if (reloadedForNewServiceWorker) return;
      reloadedForNewServiceWorker = true;
      window.location.reload();
    });
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
    staff: "getStaff",
    vendors: "getVendors",
    utilities: "getUtilities",
    payments: "getPayments",
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
  const result = await callApiStrict("getAllData", {});
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
      .map((c) =>
        escapeCsvValue(typeof c.value === "function" ? c.value(r) : r[c.value]),
      )
      .join(","),
  );
  const csvContent = [header, ...rows].join("\r\n");

  // Leading BOM so Excel opens the file as UTF-8 (otherwise ₦ and other
  // non-ASCII characters render as garbled text on Windows).
  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showToast(
    `Exported ${records.length} record${records.length === 1 ? "" : "s"}.`,
    "success",
  );
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
        r.isPaid === true ||
        String(r.isPaid || r.IsPaid || "").toUpperCase() === "TRUE"
          ? "Yes"
          : "No",
    },
    { label: "Reference", value: (r) => r.reference || r.Reference || "" },
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

// [BUG FIX] This used to POST to the old Sheets-backed Apps Script to
// reserve the next ID, falling back to the local generator if that
// failed. The callers never guarded it, so on desktop every new asset,
// ticket, payment, staff member, vendor and maintenance log fired that
// request and waited on it — measured at ~2.6s for a reply that is now
// always `Action "generateId" is not available`. It then fell through
// to the local fallback and produced the right ID anyway, so the only
// visible symptom was that saving a new record felt slow for no reason.
//
// Worse than slow, had that endpoint still worked: it numbered records
// from a Sheet that no longer has any relationship to the local
// database, so a "successful" reply would have handed back an ID based
// on entirely unrelated data.
//
// The local generator is the right answer in both shells — it reads the
// list the record is about to be added to, which is the authoritative
// source now. `sheetName` is dead but kept in the signature so the six
// call sites in Modals-forms.js need no edits.
async function generateNextRecordId(prefix, sheetName, idKey, fallbackList) {
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
        if (typeof sortApartmentsCacheList === "function")
          sortApartmentsCacheList();
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
      if (String(u.status || u.Status || "").toLowerCase() !== "occupied")
        return;
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
        if (typeof sortApartmentsCacheList === "function")
          sortApartmentsCacheList();
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
