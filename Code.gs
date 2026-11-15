// ============================================================
// CODE.GS — Lightweight read-only proxy for Facility Pro Mobile.
//
// Replaces the Google-sign-in flow that used to live in drive-sync.js:
// instead of every mobile viewer signing in with their own Google
// account and reading the Drive sync files directly
// (drive.readonly scope), this script runs under YOUR Google account
// (the one that owns the "FacilityPro Sync" Drive folder) and serves
// the same files over a plain HTTPS GET. Access is gated by a shared
// secret token instead of a Google account — nobody who opens the
// mobile app needs to sign in to anything.
//
// IMPORTANT TRADE-OFF: this token is embedded in drive-sync.js, a
// static file served to anyone who loads the mobile app's URL. That's
// inherent to a backend-less static site — there's no way to hide a
// secret in client-side code. Treat the token as "keeps casual/
// accidental access out," not as real authentication. Don't publish
// the mobile app's URL anywhere public, and rotate the token (see
// below) if you ever suspect it's leaked.
//
// ── ONE-TIME SETUP ──
//   1. Go to https://script.google.com → New project.
//   2. Delete the default code and paste this whole file in.
//   3. Project Settings (gear icon, left sidebar) → Script Properties
//      → Add script property → name it ACCESS_TOKEN, value: a long
//      random string (e.g. generate one at
//      https://www.uuidgenerator.net/ — don't reuse a password).
//   4. Deploy → New deployment → gear icon → Web app.
//        Execute as: Me
//        Who has access: Anyone
//      Click Deploy, authorize when prompted, then copy the Web App
//      URL it gives you (ends in /exec).
//   5. Open drive-sync.js and paste that URL into APPS_SCRIPT_URL, and
//      the same token into ACCESS_TOKEN.
//
// To rotate the token later: change the ACCESS_TOKEN script property
// here, then update drive-sync.js to match and re-sync it to the
// desktop/GitHub Pages copies.
// ============================================================

const SYNC_FOLDER_NAME = 'FacilityPro Sync';

// Matches electron/mobile-sync.js's SNAPSHOT_COLLECTIONS exactly —
// these are the files the desktop app writes, one per collection.
const SNAPSHOT_COLLECTIONS = [
  'Apartments', 'Assets', 'Maintenance', 'Utilities', 'Staff', 'Vendors',
  'Payments', 'MaintenanceLog', 'EnergyLedger', 'InventoryItems',
  'InventoryMovements', 'OccupancyLog', 'PettyCash',
  'RecurringExpenseTemplates', 'ServiceChargeBudgets', 'ServiceChargeLedger',
];

// Settings fields safe to hand to an unauthenticated (token-gated)
// mobile viewer — mirrors electron/mobile-sync.js's
// IMPORTABLE_SETTINGS_FIELDS on the desktop import side. Deliberately
// excludes attachmentsFolder/driveSyncFolder/lastSyncAt/lastSyncError/
// stockImportedToPettyCash/stockImportSummary — those are local
// machine state, not estate identity, and some contain local file
// paths that are nobody else's business.
const PUBLIC_SETTINGS_FIELDS = ['estateName', 'estateAddress', 'fmName', 'fmAddress', 'logoUrl', 'mainFolder'];

function doGet(e) {
  try {
    const expectedToken = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
    if (!expectedToken) {
      return jsonResponse({ status: 'error', message: 'Server misconfigured: no ACCESS_TOKEN script property set. See setup instructions at the top of Code.gs.' });
    }

    const providedToken = e && e.parameter && e.parameter.token;
    if (providedToken !== expectedToken) {
      return jsonResponse({ status: 'error', message: 'Invalid or missing token.' });
    }

    const folders = DriveApp.getFoldersByName(SYNC_FOLDER_NAME);
    if (!folders.hasNext()) {
      return jsonResponse({ status: 'error', message: 'Could not find a "' + SYNC_FOLDER_NAME + '" folder in this Google account’s Drive.' });
    }
    const folder = folders.next();

    const filesByName = {};
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const file = iter.next();
      filesByName[file.getName()] = file;
    }

    const readJson = (name) => {
      const file = filesByName[name];
      if (!file) return null;
      try {
        return JSON.parse(file.getBlob().getDataAsString());
      } catch (err) {
        return null;
      }
    };

    const manifest = readJson('manifest.json') || {};

    const snapshot = {};
    SNAPSHOT_COLLECTIONS.forEach((name) => {
      snapshot[name] = readJson(name + '.json') || [];
    });

    const rawSettings = readJson('Settings.json') || {};
    const settings = {};
    PUBLIC_SETTINGS_FIELDS.forEach((key) => {
      if (rawSettings[key] !== undefined) settings[key] = rawSettings[key];
    });
    snapshot.Settings = settings;
    snapshot.generatedAt = manifest.generatedAt || null;

    return jsonResponse({ status: 'success', snapshot: snapshot });
  } catch (err) {
    return jsonResponse({ status: 'error', message: 'Server error: ' + err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
