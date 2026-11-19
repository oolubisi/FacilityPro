// =========================================================
// DRIVE-SYNC.JS — Mobile's read-only data source, reached through a
//                 small Apps Script proxy (see Code.gs) rather than
//                 by signing in with Google.
// Load order: must load before Login.js (which calls
//             fetchMobileSnapshotFromDrive() at boot).
//
// How this fits together:
//   - Desktop writes one JSON file per collection (plus manifest.json
//     and Settings.json) into a local folder that Google Drive's
//     desktop client keeps synced to the cloud — see
//     electron/mobile-sync.js. That part is unchanged.
//   - Mobile (this file) used to sign in with the same Google account
//     via OAuth and read those files directly out of Drive. That
//     required every viewer to have a Google account and go through a
//     consent screen. This version instead calls a Google Apps Script
//     web app (Code.gs) that runs under the Drive account's owner and
//     serves the same files over a plain HTTPS GET — gated by a
//     shared secret token baked into this file instead of a Google
//     sign-in. See Code.gs's header comment for the one-time setup
//     (deploying the script, generating the token).
//
// SECURITY NOTE: ACCESS_TOKEN below is visible to anyone who views
// this file's source — that's unavoidable for a backend-less static
// site. It keeps casual/accidental access out, not determined
// attackers. Don't publish this app's URL publicly, and rotate the
// token in both this file and Code.gs's ACCESS_TOKEN script property
// if you ever suspect it's leaked.
// =========================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby5A8ZQ3_yqY7j7p3VmXkNthBa9ga2zJrUpHEgbHV9_UQGPWrSLh-oXUEj8Abib-nC0rQ/exec";
const ACCESS_TOKEN = "4b833b72-5624-4550-a2bc-92c972fd19ac";

// [BUG FIX] A cold call to the Apps Script proxy measured ~10 seconds
// end to end: doGet() reads 18 separate Drive files sequentially
// (Code.gs now caches the assembled payload to cut repeat calls, but
// the first one after a desktop push still pays full price), and the
// response is ~145 KB. On a phone over mobile data that's long enough
// that the app looked like it simply never loaded — there was no
// timeout, no cached copy to fall back on, and no error shown, just
// the "Loading latest data..." spinner forever.
//
// Two defences, both here:
//   1. FETCH_TIMEOUT_MS — the request can no longer hang indefinitely;
//      it aborts and reports a real reason.
//   2. The last successful snapshot is kept in localStorage, so a
//      failed/slow/offline load still has something to show, and
//      Login.js can paint from it instantly instead of waiting on the
//      network at all (see bootMobileReadOnlyViewer).
const SNAPSHOT_CACHE_KEY = "fp_mobile_snapshot_v1";
const SNAPSHOT_CACHE_META_KEY = "fp_mobile_snapshot_meta_v1";
const FETCH_TIMEOUT_MS = 30000;

// ─────────────────────────────────────────────
// § LOCAL SNAPSHOT CACHE
// ─────────────────────────────────────────────
// Synchronous and network-free, so Login.js can call it during boot
// and render immediately. Returns null (never throws) when there's
// nothing usable cached — private-mode localStorage, a cleared site,
// or a half-written entry from a quota failure all land here.
function readCachedMobileSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object") return null;
    let meta = {};
    try {
      meta = JSON.parse(localStorage.getItem(SNAPSHOT_CACHE_META_KEY) || "{}") || {};
    } catch (err) {
      meta = {};
    }
    return {
      snapshot: snapshot,
      cachedAt: meta.cachedAt || null,
      generatedAt: snapshot.generatedAt || null,
    };
  } catch (err) {
    return null;
  }
}

function writeCachedMobileSnapshot(snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
    localStorage.setItem(
      SNAPSHOT_CACHE_META_KEY,
      JSON.stringify({ cachedAt: new Date().toISOString() }),
    );
    return true;
  } catch (err) {
    // Out of quota (or storage blocked) — clear both keys rather than
    // leaving a truncated snapshot that readCachedMobileSnapshot would
    // happily hand to the app as if it were complete.
    try {
      localStorage.removeItem(SNAPSHOT_CACHE_KEY);
      localStorage.removeItem(SNAPSHOT_CACHE_META_KEY);
    } catch (inner) {
      /* nothing further to do */
    }
    return false;
  }
}

// ─────────────────────────────────────────────
// § PUBLIC ENTRY POINT
// ─────────────────────────────────────────────
// Returns { status: 'success', snapshot } in the exact same shape the
// old OAuth version produced (so Core.js's window.mobileSnapshot
// consumers and Login.js's caller need no changes), or
// { status: 'error', message }.
//
// On success it also returns fromCache:false and refreshes the local
// cache. When the network leg fails it falls back to the last cached
// snapshot and returns fromCache:true plus cachedAt — still a
// 'success' for the caller's purposes, since there is real data to
// show, with `message` carrying why it isn't live. Pass
// { noCacheFallback: true } to suppress that (Login.js's background
// refresh uses it: there, falling back to the very cache it's trying
// to replace would look like a successful update).
async function fetchMobileSnapshotFromDrive(options) {
  const opts = options || {};

  if (APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) {
    return {
      status: "error",
      message: "The mobile app isn't connected to a data source yet — see the setup instructions at the top of Code.gs.",
    };
  }

  let timeoutId = null;
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    if (controller) {
      timeoutId = setTimeout(
        () => controller.abort(),
        opts.timeoutMs || FETCH_TIMEOUT_MS,
      );
    }

    const separator = APPS_SCRIPT_URL.indexOf("?") === -1 ? "?" : "&";
    const url = APPS_SCRIPT_URL + separator + "token=" + encodeURIComponent(ACCESS_TOKEN);
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      throw new Error("server returned HTTP " + response.status);
    }
    const result = await response.json();
    if (!result || result.status !== "success" || !result.snapshot) {
      throw new Error((result && result.message) || "the server sent no data");
    }

    writeCachedMobileSnapshot(result.snapshot);
    return { status: "success", snapshot: result.snapshot, fromCache: false };
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? "the server took too long to respond"
        : (err && err.message) || "unknown error";

    if (!opts.noCacheFallback) {
      const cached = readCachedMobileSnapshot();
      if (cached) {
        return {
          status: "success",
          snapshot: cached.snapshot,
          fromCache: true,
          cachedAt: cached.cachedAt,
          message: reason,
        };
      }
    }

    return { status: "error", message: "Could not load data: " + reason };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
