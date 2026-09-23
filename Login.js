// =========================================================
// LOGIN.JS — Login screen (user picker + PIN), session bootstrap,
//            logout. Owns the app's boot sequence: it decides whether
//            to show the login screen or go straight into the app,
//            and is the only thing that calls bootMobileApp() (mobile,
//            from Init.js) or initDesktop() (desktop, from desktop.js)
//            — neither of those files self-triggers anymore.
// Load order: 2nd (right after Core.js; must load before Init.js/
//             desktop.js execute their DOMContentLoaded work, though
//             since every script here uses `defer`, load order among
//             deferred scripts already guarantees this)
// Depends on: core.js (callApi, currentUser, persistSession, etc.)
// =========================================================

let loginPickedUserId = null;

window.addEventListener("DOMContentLoaded", () => {
  wireLogoutButtons();

  // [SIMPLIFICATION] Running against the local desktop data store
  // (window.localApi, set by preload.js) — no PIN/session system
  // exists there anymore (see LOCAL_ACTOR in local-api.js), so there's
  // nothing to log into. Goes straight into the app as the one fixed
  // local user, skipping both the stored-session check below and the
  // login screen entirely.
  if (window.localApi) {
    currentUser = { sessionToken: "local", userId: "local", name: "Admin", role: "admin" };
    bootAuthenticatedApp();
    return;
  }

  // [FEATURE] Mobile is now a read-only viewer of a snapshot the
  // desktop app pushes to a small Apps Script relay (see mobile-sync.js
  // and Code.gs's uploadMobileSnapshot/getMobileSnapshot) — not a
  // second write-capable client of its own. No PIN, no session: the
  // whole login system this file otherwise owns simply doesn't apply
  // here anymore, the same way it stopped applying to desktop once
  // that went local-only. isDesktopShell() (see below) is what
  // distinguishes "mobile" from "desktop" here, since both shells
  // load this exact file.
  if (!isDesktopShell()) {
    bootMobileReadOnlyViewer();
    return;
  }

  const stored = getStoredSession();
  if (stored && stored.sessionToken) {
    // Trust the stored session optimistically — if it's actually expired
    // server-side, the first real API call will come back with
    // AUTH_REQUIRED and handleSessionExpired() (below) will bounce us
    // back to this screen. Avoids an extra round-trip on every boot just
    // to pre-validate a session that's almost always still good.
    currentUser = stored;
    bootAuthenticatedApp();
    return;
  }

  showLoginScreen();
});

// ─────────────────────────────────────────────
// § BOOT ROUTING
// ─────────────────────────────────────────────
function isDesktopShell() {
  return document.body.classList.contains("desktop-shell");
}

// [FEATURE] Fetches the snapshot the desktop app last pushed and
// enters read-only mode — see the callApi branch in Core.js that
// window.isMobileReadOnly switches on. Order matters here: this
// specific call must go out over the real network via the normal
// callApiStrict path BEFORE window.isMobileReadOnly is set, since
// setting that flag first would make callApi try to answer this very
// request out of a snapshot that doesn't exist yet.
async function bootMobileReadOnlyViewer() {
  const screen = document.getElementById("login-screen");
  if (screen) {
    screen.hidden = false;
    screen.innerHTML = `<div class="login-empty-state" style="padding:40px 20px; text-align:center;"><i class="fas fa-spinner fa-spin" style="font-size:32px; margin-bottom:16px; color:var(--primary);"></i><p>Loading latest data...</p></div>`;
  }

  const result = await callApiStrict("getMobileSnapshot", {});
  if (!result || result.status !== "success" || !result.snapshot) {
    if (screen) {
      screen.innerHTML = `<div class="login-empty-state" style="padding:40px 20px; text-align:center; color:var(--danger);"><i class="fas fa-triangle-exclamation" style="font-size:32px; margin-bottom:16px;"></i><p style="font-weight:700;">Couldn't load data.</p><p style="font-size:13px; color:var(--muted);">${escapeHtml((result && result.message) || "Make sure the desktop app has synced at least once, then try again.")}</p><button class="action-btn" style="margin-top:16px; width:auto;" onclick="window.location.reload()">Retry</button></div>`;
    }
    return;
  }

  window.mobileSnapshot = result.snapshot;
  window.isMobileReadOnly = true;
  currentUser = { sessionToken: "mobile-readonly", userId: "mobile-viewer", name: "Mobile Viewer", role: "admin" };
  // [BUG FIX] Every other path that shows #login-screen (the normal
  // PIN-submit flow, the idle-lock screen) calls hideLoginScreen()
  // before handing off to the rest of the app — this one didn't, so
  // the "Loading latest data..." overlay stayed on screen forever
  // even after the snapshot loaded successfully and the app rendered
  // underneath it.
  hideLoginScreen();
  // [BUG FIX] Team Access (Reset PIN / New User) is dead functionality
  // once there's no login system left to manage — same fix already
  // applied to desktop's Settings screen. Mobile's own Settings markup
  // is static HTML (not dynamically generated like desktop's), so this
  // hides it via JS rather than a template-literal conditional.
  const teamAccessCard = document.getElementById("mobile-team-access-card");
  if (teamAccessCard) teamAccessCard.style.display = "none";

  // [FEATURE] The one piece of information that actually matters for
  // a read-only viewer of a snapshot someone else pushed: how current
  // is what I'm looking at right now. Shown persistently on the
  // dashboard rather than as a one-time toast, since staleness is an
  // ongoing fact about the whole session, not a one-off event.
  const statusEl = document.getElementById("mobile-snapshot-status");
  if (statusEl && window.mobileSnapshot && window.mobileSnapshot.generatedAt) {
    const generated = new Date(window.mobileSnapshot.generatedAt);
    statusEl.textContent = "Data as of " + formatDateForDisplay(window.mobileSnapshot.generatedAt) + " at " + generated.toLocaleTimeString();
    statusEl.style.display = "block";
  }

  bootAuthenticatedApp();
}

function bootAuthenticatedApp() {
  applyCurrentUserToLogoutLabel();
  applyRoleBasedUIVisibility();
  startIdleLockWatch();
  if (isDesktopShell()) {
    initDesktop();
  } else {
    bootMobileApp();
  }
}

function applyCurrentUserToLogoutLabel() {
  const name = currentUser && currentUser.name;
  if (!name) return;
  const desktopLabel = document.getElementById("desktop-logout-label");
  if (desktopLabel) desktopLabel.textContent = `Log Out (${name})`;
  const mobileLabel = document.getElementById("more-page-logout-label");
  if (mobileLabel) mobileLabel.textContent = `Log Out (${name})`;
}

// [FEATURE] Role-based permissions — UX layer. Hides controls the
// current role can't use so people aren't shown buttons that would
// just get rejected server-side (checkBusinessPermission in Code.gs is
// the actual enforcement; this is display-only and intentionally
// duplicates none of that logic beyond currentUserMeetsRole()).
function applyRoleBasedUIVisibility() {
  if (!currentUserMeetsRole("admin")) {
    const desktopSettingsNav = document.getElementById("desktop-settings-nav");
    if (desktopSettingsNav) desktopSettingsNav.style.display = "none";
    const mobileSettingsTile = document.getElementById("mobile-settings-tile");
    if (mobileSettingsTile) mobileSettingsTile.style.display = "none";
  }
  if (!currentUserMeetsRole("manager")) {
    const desktopScNav = document.getElementById("desktop-servicecharge-nav");
    if (desktopScNav) desktopScNav.style.display = "none";
    const dashboardScTile = document.getElementById("dashboard-servicecharge-tile");
    if (dashboardScTile) dashboardScTile.style.display = "none";
    const desktopPcNav = document.getElementById("desktop-pettycash-nav");
    if (desktopPcNav) desktopPcNav.style.display = "none";
    const dashboardPcTile = document.getElementById("dashboard-pettycash-tile");
    if (dashboardPcTile) dashboardPcTile.style.display = "none";
    const desktopInvNav = document.getElementById("desktop-inventory-nav");
    if (desktopInvNav) desktopInvNav.style.display = "none";
    const dashboardInvTile = document.getElementById("dashboard-inventory-tile");
    if (dashboardInvTile) dashboardInvTile.style.display = "none";
    const desktopEnergyNav = document.getElementById("desktop-energy-nav");
    if (desktopEnergyNav) desktopEnergyNav.style.display = "none";
    const dashboardEnergyTile = document.getElementById("dashboard-energy-tile");
    if (dashboardEnergyTile) dashboardEnergyTile.style.display = "none";
  }
}

// ─────────────────────────────────────────────
// § SESSION EXPIRY (called from Core.js's callApi on AUTH_REQUIRED)
// ─────────────────────────────────────────────
function handleSessionExpired() {
  showToast("Your session expired. Please log in again.", "warning");
  showLoginScreen();
}

// ─────────────────────────────────────────────
// § IDLE AUTO-LOCK (shared-device protection)
//
// A device left logged in stays logged in for whoever picks it up
// next — a real risk on a shared facility-office tablet/desktop, and
// more so now that the app works fully offline: there's no server
// round-trip during normal use that could otherwise catch an idle
// session and bounce it back to login. After a period of inactivity,
// this re-shows a lock screen for the CURRENT user specifically (not
// the full "who's this" picker) — the session itself isn't destroyed,
// just re-covered; re-entering the same PIN unlocks it again without
// reloading the app or losing in-memory state (unsaved form drafts,
// current view, etc). A "Not you?" link falls back to full logout for
// someone else who wants to use the device.
// ─────────────────────────────────────────────
const IDLE_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let idleLockTimer = null;
let isLockedForInactivity = false;

function startIdleLockWatch() {
  ["mousemove", "keydown", "mousedown", "touchstart", "scroll"].forEach((evt) => {
    document.addEventListener(evt, resetIdleLockTimer, { passive: true });
  });
  resetIdleLockTimer();
}

function resetIdleLockTimer() {
  if (isLockedForInactivity) return;
  clearTimeout(idleLockTimer);
  idleLockTimer = setTimeout(lockForInactivity, IDLE_LOCK_TIMEOUT_MS);
}

function lockForInactivity() {
  if (isLockedForInactivity || !currentUser) return;
  isLockedForInactivity = true;
  showLockScreen();
}

function showLockScreen() {
  const screen = document.getElementById("login-screen");
  if (!screen) return;
  screen.hidden = false;
  screen.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <img src="logo.png" alt="" class="login-logo">
        <span>Facility Pro</span>
      </div>
      <p class="login-subtitle">Locked after inactivity.<br>Hi, ${escapeHtml(currentUser.name)} — re-enter your PIN.</p>
      <input
        id="lock-pin-input"
        class="login-pin-input"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        maxlength="8"
        placeholder="••••"
        autofocus
      >
      <div id="lock-error" class="login-error" hidden></div>
      <button type="button" id="lock-submit-btn" class="action-btn">Unlock</button>
      <button type="button" id="lock-switch-user-btn" class="login-back-btn" style="position:static; margin-top:14px; display:block; width:100%; text-align:center;">Not you? Switch user</button>
    </div>
  `;

  const pinInput = document.getElementById("lock-pin-input");
  const submitBtn = document.getElementById("lock-submit-btn");
  const attemptUnlock = () => submitUnlock(pinInput.value, submitBtn);
  submitBtn.addEventListener("click", attemptUnlock);
  pinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") attemptUnlock();
  });
  document.getElementById("lock-switch-user-btn").addEventListener("click", logoutCurrentUser);
  pinInput.focus();
}

async function submitUnlock(pin, submitBtn) {
  const errorEl = document.getElementById("lock-error");
  if (errorEl) errorEl.hidden = true;
  if (!pin) return;

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");

  const result = await callApi("login", { userId: currentUser.userId, pin });

  submitBtn.disabled = false;
  submitBtn.classList.remove("loading");

  // Offline-safe: if the network genuinely isn't reachable right now,
  // don't lock the person out of their own already-authenticated
  // session over a PIN check that can't complete — that would defeat
  // the entire point of the offline-first work. This only applies to a
  // real connectivity failure (callApi's isAuthAction branch returns
  // exactly this message when offline) — an actual wrong-PIN response
  // from a reachable server still shows the error below as normal.
  if (result && result.message === "Offline") {
    unlockScreen();
    return;
  }

  if (!result || result.status !== "success") {
    if (errorEl) {
      errorEl.textContent = (result && result.message) || "Incorrect PIN.";
      errorEl.hidden = false;
    }
    const pinInput = document.getElementById("lock-pin-input");
    if (pinInput) {
      pinInput.value = "";
      pinInput.focus();
    }
    return;
  }

  // Refreshing the session token here is a useful side effect of
  // reusing the normal login action — it extends the 12h server-side
  // expiry from the moment of unlock, rather than leaving the original
  // login's clock running in the background the whole time the device
  // was idle.
  persistSession({
    userId: result.userId,
    name: result.name,
    role: result.role,
    sessionToken: result.sessionToken,
  });

  unlockScreen();
}

function unlockScreen() {
  isLockedForInactivity = false;
  hideLoginScreen();
  resetIdleLockTimer();
}

// ─────────────────────────────────────────────
// § LOGOUT
// ─────────────────────────────────────────────
function wireLogoutButtons() {
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="log-out"]')) {
      logoutCurrentUser();
    }
  });
}

async function logoutCurrentUser() {
  try {
    await callApi("logout", {});
  } catch (e) {
    // Best-effort — clear locally regardless of whether the server call
    // succeeded, since the whole point is to end the session on this
    // device even if we're offline.
  }
  clearStoredSession();
  // A different manager logging in next shouldn't briefly see this
  // one's cached financial data flash on screen before the real fetch
  // overwrites it — same reasoning as clearing the session itself.
  clearAllLedgerCaches();
  // Full reload rather than just re-showing the login screen: the app
  // has a lot of in-memory state (cache, appSettings, desktopState,
  // paymentStages, etc.) that isn't safe to assume is clean for a new
  // user without re-running every module's initialization from scratch.
  window.location.reload();
}

// ─────────────────────────────────────────────
// § LOGIN SCREEN
// ─────────────────────────────────────────────
function showLoginScreen() {
  const screen = document.getElementById("login-screen");
  if (!screen) return;
  screen.hidden = false;
  loginPickedUserId = null;
  renderUserPicker(screen);
  loadLoginUserList(screen);
}

function hideLoginScreen() {
  const screen = document.getElementById("login-screen");
  if (screen) screen.hidden = true;
}

function renderUserPicker(screen) {
  screen.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <img src="logo.png" alt="" class="login-logo">
        <span>Facility Pro</span>
      </div>
      <p class="login-subtitle">Who's this?</p>
      <div id="login-user-list" class="login-user-list">
        <div class="login-user-list-loading">Loading team list…</div>
      </div>
    </div>
  `;
}

async function loadLoginUserList(screen) {
  const listEl = document.getElementById("login-user-list");
  if (!listEl) return;

  const result = await callApiStrict("getUsersForLogin", {});

  // [BUG FIX] A null result (callApiStrict exhausted its retries on a
  // genuine network/redirect failure) used to fall through to the
  // same "no accounts set up yet" empty state as an error-shaped
  // response below — actively misleading here, since it points
  // someone at running setupFirstAdmin() in Apps Script when the real
  // problem is just a fetch that never got through.
  if (result === null) {
    listEl.innerHTML = `
      <div class="login-empty-state" style="color: var(--danger);">
        Couldn't reach the server.<br>
        <span style="font-weight:700;">Please check your connection and try again.</span>
      </div>
    `;
    return;
  }

  // [BUG FIX] An error-shaped response ({status:'error', message:...})
  // used to fall through to the "no accounts set up yet" empty state
  // (Array.isArray(result) is false either way), silently masking real
  // problems like a bad API token or a network failure behind a message
  // that pointed at the wrong fix entirely.
  if (result && !Array.isArray(result) && result.status === "error") {
    listEl.innerHTML = `
      <div class="login-empty-state" style="color: var(--danger);">
        Couldn't reach the server.<br>
        <span style="font-weight:700;">${escapeHtml(result.message || "Unknown error")}</span>
      </div>
    `;
    return;
  }

  const users = Array.isArray(result) ? result : [];

  if (users.length === 0) {
    listEl.innerHTML = `
      <div class="login-empty-state">
        No accounts are set up yet.<br>
        Run <code>setupFirstAdmin()</code> in the Apps Script editor to create the first admin account.
      </div>
    `;
    return;
  }

  listEl.innerHTML = users
    .map(
      (u) => `
      <button class="login-user-btn" data-user-id="${escapeHtml(u.userId)}" data-user-name="${escapeHtml(u.name)}">
        <span class="login-user-avatar">${escapeHtml((u.name || "?").charAt(0).toUpperCase())}</span>
        <span>${escapeHtml(u.name)}</span>
      </button>
    `,
    )
    .join("");

  listEl.querySelectorAll(".login-user-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      renderPinPad(screen, btn.dataset.userId, btn.dataset.userName);
    });
  });
}

function renderPinPad(screen, userId, userName) {
  loginPickedUserId = userId;
  screen.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <img src="logo.png" alt="" class="login-logo">
        <span>Facility Pro</span>
      </div>
      <button type="button" class="login-back-btn" id="login-back-btn"><i class="fas fa-arrow-left"></i> Back</button>
      <p class="login-subtitle">Hi, ${escapeHtml(userName)}. Enter your PIN.</p>
      <input
        id="login-pin-input"
        class="login-pin-input"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        maxlength="8"
        placeholder="••••"
        autofocus
      >
      <div id="login-error" class="login-error" hidden></div>
      <button type="button" id="login-submit-btn" class="action-btn">Log In</button>
    </div>
  `;

  const pinInput = document.getElementById("login-pin-input");
  const submitBtn = document.getElementById("login-submit-btn");

  document.getElementById("login-back-btn").addEventListener("click", () => {
    showLoginScreen();
  });

  const attemptLogin = () => submitLogin(pinInput.value, submitBtn);
  submitBtn.addEventListener("click", attemptLogin);
  pinInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") attemptLogin();
  });
  pinInput.focus();
}

async function submitLogin(pin, submitBtn) {
  const errorEl = document.getElementById("login-error");
  if (errorEl) errorEl.hidden = true;

  if (!pin || !loginPickedUserId) return;

  submitBtn.disabled = true;
  submitBtn.classList.add("loading");
  // [FEATURE] Full-screen overlay, not just the button spinner — a
  // slow Apps Script round-trip on login otherwise looked identical
  // to the app being frozen, with nothing on screen confirming
  // anything was actually happening.
  setGlobalLoading(true, "Logging in...");

  const result = await callApi("login", { userId: loginPickedUserId, pin });

  setGlobalLoading(false);
  submitBtn.disabled = false;
  submitBtn.classList.remove("loading");

  if (!result || result.status !== "success") {
    if (errorEl) {
      errorEl.textContent = (result && result.message) || "Login failed. Please try again.";
      errorEl.hidden = false;
    }
    const pinInput = document.getElementById("login-pin-input");
    if (pinInput) {
      pinInput.value = "";
      pinInput.focus();
    }
    return;
  }

  persistSession({
    userId: result.userId,
    name: result.name,
    role: result.role,
    sessionToken: result.sessionToken,
  });

  hideLoginScreen();
  bootAuthenticatedApp();
}
