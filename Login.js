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

  const result = await callApi("getUsersForLogin", {});

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

  const result = await callApi("login", { userId: loginPickedUserId, pin });

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
