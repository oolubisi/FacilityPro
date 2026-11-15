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

// ─────────────────────────────────────────────
// § PUBLIC ENTRY POINT
// ─────────────────────────────────────────────
// Returns { status: 'success', snapshot } in the exact same shape the
// old OAuth version produced (so Core.js's window.mobileSnapshot
// consumers and Login.js's caller need no changes), or
// { status: 'error', message }. Takes the same `{ interactive }`
// options object Login.js already passes in, but ignores it — there's
// no consent screen to distinguish a silent vs. interactive attempt
// for anymore, so there's also never a `needsSignIn: true` in the
// result; Login.js's "Sign in with Google" branch simply never
// triggers and falls through to its generic retry screen on failure.
async function fetchMobileSnapshotFromDrive() {
  if (APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) {
    return {
      status: "error",
      message: "The mobile app isn't connected to a data source yet — see the setup instructions at the top of Code.gs.",
    };
  }

  try {
    const separator = APPS_SCRIPT_URL.indexOf("?") === -1 ? "?" : "&";
    const url = APPS_SCRIPT_URL + separator + "token=" + encodeURIComponent(ACCESS_TOKEN);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Server returned HTTP " + response.status);
    }
    const result = await response.json();
    if (!result || result.status !== "success" || !result.snapshot) {
      return { status: "error", message: (result && result.message) || "Could not load data." };
    }
    return { status: "success", snapshot: result.snapshot };
  } catch (err) {
    return { status: "error", message: "Could not load data: " + err.message };
  }
}
