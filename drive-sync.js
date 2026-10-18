// =========================================================
// DRIVE-SYNC.JS — Mobile's read-only data source, replacing the old
//                 Apps Script relay (see mobile-sync.js on the
//                 desktop side for the other half of this swap).
// Load order: must load before Login.js (which calls
//             fetchMobileSnapshotFromDrive() at boot).
// Depends on: Google Identity Services (loaded via <script> tag in
//             index.html, exposes window.google.accounts.oauth2)
//
// How this fits together:
//   - Desktop writes one JSON file per collection (plus manifest.json)
//     into a local folder that Google Drive's desktop client keeps
//     synced to the cloud. Desktop never calls this file or any
//     Google API directly — see electron/mobile-sync.js.
//   - Mobile (this file) signs in with the same Google account via
//     OAuth (drive.readonly scope — read-only on purpose, matching
//     the read-only viewer this app already is) and reads those same
//     files straight out of Drive. No backend of any kind in between.
//
// Setup required once, outside this code:
//   1. A Google Cloud project with the Drive API enabled.
//   2. An OAuth Client ID (Web application type) with this app's
//      origin listed under Authorized JavaScript origins.
//   Paste that client ID into GOOGLE_CLIENT_ID below.
// =========================================================

const GOOGLE_CLIENT_ID = "PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_SYNC_FOLDER_NAME = "FacilityPro Sync";

// Matches electron/mobile-sync.js's SNAPSHOT_COLLECTIONS exactly —
// these are the files desktop writes, one per collection, plus
// Settings and manifest.json handled separately below.
const DRIVE_SYNC_COLLECTIONS = [
  "Apartments", "Assets", "Maintenance", "Utilities", "Staff", "Vendors",
  "Payments", "MaintenanceLog", "EnergyLedger", "InventoryItems",
  "InventoryMovements", "OccupancyLog", "PettyCash",
  "RecurringExpenseTemplates", "ServiceChargeBudgets", "ServiceChargeLedger",
];

const DRIVE_TOKEN_STORAGE_KEY = "facility_pro_drive_token";
const DRIVE_FOLDER_ID_STORAGE_KEY = "facility_pro_drive_folder_id";

let driveTokenClient = null;

// ─────────────────────────────────────────────
// § TOKEN MANAGEMENT
// ─────────────────────────────────────────────
// A cached access token is reused across page loads until it's within
// 60s of expiring (Drive API tokens from GIS last ~1hr) — avoids
// re-prompting on every single visit. Once it's gone stale, callers
// fall through to requestDriveAccessToken()'s silent-then-interactive
// flow below.
function getCachedDriveToken() {
  try {
    const raw = localStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached && cached.token && cached.expiresAt && Date.now() < cached.expiresAt - 60000) {
      return cached.token;
    }
  } catch (e) {
    // Corrupt cache entry — treat as no token.
  }
  return null;
}

function cacheDriveToken(token, expiresInSeconds) {
  try {
    localStorage.setItem(
      DRIVE_TOKEN_STORAGE_KEY,
      JSON.stringify({ token, expiresAt: Date.now() + expiresInSeconds * 1000 }),
    );
  } catch (e) {
    // Storage full/unavailable — token just won't be cached across
    // reloads; every boot falls back to a fresh request instead.
  }
}

function waitForGoogleIdentityServices(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Google sign-in script didn't load (check your connection)."));
        return;
      }
      setTimeout(poll, 100);
    })();
  });
}

// Resolves with an access token, or rejects if silent acquisition
// failed and interactive consent is needed. `interactive: true` is
// only safe to pass from inside a direct user-gesture handler (a
// click) — browsers block consent popups opened any other way.
async function requestDriveAccessToken({ interactive }) {
  const cached = getCachedDriveToken();
  if (cached) return cached;

  await waitForGoogleIdentityServices();

  if (!driveTokenClient) {
    driveTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // overridden per-request below
    });
  }

  return new Promise((resolve, reject) => {
    driveTokenClient.callback = (response) => {
      if (response && response.access_token) {
        cacheDriveToken(response.access_token, response.expires_in || 3500);
        resolve(response.access_token);
      } else {
        reject(new Error((response && response.error) || "Sign-in was cancelled or failed."));
      }
    };
    driveTokenClient.error_callback = (err) => {
      reject(new Error((err && err.message) || "Sign-in was cancelled or failed."));
    };
    driveTokenClient.requestAccessToken({ prompt: interactive ? "consent" : "none" });
  });
}

// ─────────────────────────────────────────────
// § DRIVE FILE LOOKUP
// ─────────────────────────────────────────────
async function driveApiGet(path, token) {
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("Drive API returned HTTP " + response.status + " for " + path);
  }
  return response.json();
}

async function findSyncFolderId(token) {
  const cachedId = localStorage.getItem(DRIVE_FOLDER_ID_STORAGE_KEY);
  if (cachedId) return cachedId;

  const query = encodeURIComponent(
    `name='${DRIVE_SYNC_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const result = await driveApiGet(`files?q=${query}&fields=files(id,name)`, token);
  const folder = result.files && result.files[0];
  if (!folder) {
    throw new Error(`Couldn't find a "${DRIVE_SYNC_FOLDER_NAME}" folder in this Google account's Drive.`);
  }
  localStorage.setItem(DRIVE_FOLDER_ID_STORAGE_KEY, folder.id);
  return folder.id;
}

async function listSyncFolderFiles(folderId, token) {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const result = await driveApiGet(`files?q=${query}&fields=files(id,name)&pageSize=100`, token);
  const byName = {};
  (result.files || []).forEach((file) => {
    byName[file.name] = file.id;
  });
  return byName;
}

async function fetchDriveFileJson(fileId, token) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("Drive API returned HTTP " + response.status + " fetching a sync file.");
  }
  return response.json();
}

// ─────────────────────────────────────────────
// § PUBLIC ENTRY POINT
// ─────────────────────────────────────────────
// Returns { status: 'success', snapshot } in the exact same shape
// mobile-sync.js/getMobileSnapshot used to produce (so Core.js's
// window.mobileSnapshot consumers need no changes at all), or
// { status: 'error', message, needsSignIn } — needsSignIn tells the
// caller (Login.js) to show a "Sign in with Google" button rather
// than a plain retry, since the failure was a consent prompt that
// couldn't be shown without a user gesture.
async function fetchMobileSnapshotFromDrive({ interactive = false } = {}) {
  let token;
  try {
    token = await requestDriveAccessToken({ interactive });
  } catch (err) {
    return {
      status: "error",
      needsSignIn: !interactive,
      message: interactive
        ? "Google sign-in failed: " + err.message
        : "Sign in with Google to load data.",
    };
  }

  try {
    const folderId = await findSyncFolderId(token);
    const filesByName = await listSyncFolderFiles(folderId, token);

    const manifestId = filesByName["manifest.json"];
    const manifest = manifestId ? await fetchDriveFileJson(manifestId, token) : {};

    const snapshot = {};
    for (const name of DRIVE_SYNC_COLLECTIONS) {
      const fileId = filesByName[name + ".json"];
      snapshot[name] = fileId ? await fetchDriveFileJson(fileId, token) : [];
    }
    const settingsId = filesByName["Settings.json"];
    snapshot.Settings = settingsId ? await fetchDriveFileJson(settingsId, token) : {};
    snapshot.generatedAt = manifest.generatedAt || null;

    return { status: "success", snapshot };
  } catch (err) {
    // A stale/revoked token surfaces here as an API error (401), not
    // through requestDriveAccessToken — drop the cached token so the
    // next attempt re-authenticates instead of repeating the same
    // failure forever.
    localStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    return { status: "error", message: "Could not load data from Google Drive: " + err.message };
  }
}
