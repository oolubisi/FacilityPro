// mobile-sync.js — Pushes a read-only snapshot of the local data into
// the Google Drive-synced folder on this machine, one JSON file per
// collection plus a manifest.json. Drive's own desktop client is what
// actually gets this to the cloud; this file just writes plain JSON to
// a local path, the same way db.js writes the main database file.
//
// Replaces the previous design, which POSTed the whole snapshot to a
// small Apps Script relay (uploadMobileSnapshot in Code.gs) for the
// phone PWA to pull from. That relay — and Apps Script generally — is
// no longer used anywhere in this app; see drive-sync.js (mobile side)
// for how the phone now reads these same files directly out of Drive
// via the Drive API.

const fs = require('fs');
const path = require('path');
const db = require('./db');

// Location of the Drive-synced folder this machine writes into, set
// via Settings.driveSyncFolder (see main.js's select-drive-sync-folder
// handler and the "Choose Folder" control it powers in Settings).
//
// [BUG FIX] This used to be one absolute path hardcoded for a single
// Mac account ('/Users/kayodeolubisi/Library/CloudStorage/...'),
// which only ever resolved on that one machine. On any other machine
// — different OS, different account, different Drive mount point —
// it just produced an EPERM/ENOENT on every sync attempt. There was
// no UI to set Settings.driveSyncFolder, so the override this file
// already claimed existed was never actually reachable. There's no
// way to guess a Drive-synced path on a fresh machine, so there's no
// default anymore — getSyncFolder() returns null until it's set, and
// syncMobileSnapshot() reports that plainly instead of trying an
// unrelated path first.
const DEFAULT_SYNC_FOLDER = null;

// Collections meaningful to view on mobile. Sessions and Users are
// deliberately excluded — Sessions has no purpose once desktop dropped
// login entirely, and Users still holds a pinHash field that has no
// reason to leave this machine even though it's no longer functionally
// used for anything.
const SNAPSHOT_COLLECTIONS = [
  'Apartments', 'Assets', 'Maintenance', 'Utilities', 'Staff', 'Vendors',
  'Payments', 'MaintenanceLog', 'EnergyLedger', 'InventoryItems',
  'InventoryMovements', 'OccupancyLog', 'PettyCash',
  'RecurringExpenseTemplates', 'ServiceChargeBudgets', 'ServiceChargeLedger',
];

function getSyncFolder() {
  const settings = db.getCollection('Settings');
  const configured = settings && settings.driveSyncFolder;
  return (configured && typeof configured === 'string') ? configured : DEFAULT_SYNC_FOLDER;
}

// Writes `value` to `<folder>/<name>.json` atomically — via a temp
// file + rename, same pattern as db.js's persist() — so Drive's
// desktop client never catches a half-written file mid-sync and
// uploads a corrupt/truncated snapshot.
function writeJsonFile(folder, name, value) {
  const finalPath = path.join(folder, name + '.json');
  const tmpPath = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(value), 'utf8');
  fs.renameSync(tmpPath, finalPath);
}

// [FEATURE] Records the outcome of every sync attempt — success
// timestamp or failure reason — directly in Settings, so both the
// desktop Settings screen and the next app launch can tell someone
// how current (or how stale) the mobile view actually is, rather than
// syncing being an entirely invisible background action. Automatic
// exit-syncs in particular fail completely silently otherwise (see
// main.js's before-quit handler, which quits regardless of the
// result) — this is what makes that failure visible the next time the
// app opens, instead of mobile just quietly going stale with no trace
// of why.
function recordSyncOutcome(result) {
  const settings = db.getCollection('Settings');
  if (result.status === 'success') {
    settings.lastSyncAt = new Date().toISOString();
    settings.lastSyncError = '';
  } else {
    settings.lastSyncError = result.message || 'Sync failed.';
  }
  db.persist();
}

// Returns { status: 'success', timestamp } or { status: 'error', message }.
// Never throws — every failure path returns an error result instead,
// since this can be invoked over IPC (needs a result to show) or
// silently on app exit (needs to not crash the quit sequence).
async function syncMobileSnapshot() {
  const folder = getSyncFolder();
  const generatedAt = new Date().toISOString();

  if (!folder) {
    const result = {
      status: 'error',
      message: 'No Drive sync folder is set yet — pick one under Settings → Mobile Sync → Choose Folder.',
    };
    recordSyncOutcome(result);
    return result;
  }

  try {
    fs.mkdirSync(folder, { recursive: true });

    SNAPSHOT_COLLECTIONS.forEach((name) => {
      writeJsonFile(folder, name, db.getCollection(name));
    });
    writeJsonFile(folder, 'Settings', db.getCollection('Settings'));
    writeJsonFile(folder, 'manifest', { generatedAt, collections: SNAPSHOT_COLLECTIONS });
  } catch (err) {
    const result = {
      status: 'error',
      message: 'Could not write to the Drive sync folder (' + folder + '): ' +
        String(err && err.message ? err.message : err),
    };
    recordSyncOutcome(result);
    return result;
  }

  const result = { status: 'success', timestamp: generatedAt };
  recordSyncOutcome(result);
  return result;
}

// Settings fields that describe the estate itself rather than this
// machine's own local setup — safe (and necessary) to pull in from
// another machine's snapshot. Everything else in Settings
// (attachmentsFolder, driveSyncFolder, lastSyncAt/lastSyncError,
// stockImportedToPettyCash/stockImportSummary) is local-machine state
// and must never come from someone else's snapshot.
//
// [BUG FIX] The first version of this function skipped Settings.json
// entirely to avoid clobbering those local-only fields — reasonable,
// but it went too far: it also meant the estate's own name, address,
// FM name and logo (which only ever live in Settings, with no other
// UI to set them) never made it across either, silently, with no
// error to flag it. A machine that imports a snapshot ends up with a
// populated Apartments list under a blank "Facility Pro" header
// instead of the estate's actual name — worth fixing explicitly
// rather than leaving the merge all-or-nothing.
const IMPORTABLE_SETTINGS_FIELDS = ['estateName', 'estateAddress', 'fmName', 'fmAddress', 'logoUrl', 'mainFolder'];

// [FEATURE] The reverse direction of syncMobileSnapshot(): reads the
// same per-collection JSON files out of the configured Drive folder
// and loads them into THIS machine's local database. For setting the
// app up on a new/second machine sharing the same Drive account as
// one that's already been syncing — e.g. a Windows install picking up
// the Apartments list etc. that an existing Mac install already
// pushed to Drive, instead of starting from an empty database.
// Backs up the current local database first (db.backupDatabase),
// since this overwrites every data collection wholesale and that
// backup is the only way back if the snapshot turns out to be stale
// or wrong. Settings is handled separately from the other
// collections — see IMPORTABLE_SETTINGS_FIELDS above — rather than
// imported wholesale or skipped wholesale.
function importFromSyncFolder() {
  const folder = getSyncFolder();
  if (!folder) {
    return { status: 'error', message: 'No Drive sync folder is set yet — pick one under Settings → Mobile Sync → Choose Folder.' };
  }
  if (!fs.existsSync(folder)) {
    return { status: 'error', message: 'Drive sync folder does not exist yet (' + folder + '). Make sure Google Drive has finished syncing it to this machine.' };
  }

  const manifestPath = path.join(folder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { status: 'error', message: 'No manifest.json found in ' + folder + ' — nothing has been synced from another machine yet.' };
  }

  let backupPath;
  try {
    backupPath = db.backupDatabase('before-drive-import-' + Date.now());
  } catch (err) {
    return { status: 'error', message: 'Could not back up the local database before importing: ' + String(err && err.message ? err.message : err) };
  }

  const imported = [];
  try {
    SNAPSHOT_COLLECTIONS.forEach((name) => {
      const filePath = path.join(folder, name + '.json');
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const collection = db.getCollection(name);
      collection.length = 0;
      if (Array.isArray(parsed)) collection.push(...parsed);
      imported.push(name);
    });

    const settingsPath = path.join(folder, 'Settings.json');
    if (fs.existsSync(settingsPath)) {
      const incomingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const settings = db.getCollection('Settings');
      IMPORTABLE_SETTINGS_FIELDS.forEach((key) => {
        if (incomingSettings[key] !== undefined) settings[key] = incomingSettings[key];
      });
      imported.push('Settings (estate identity fields only)');
    }

    db.persist();
  } catch (err) {
    return {
      status: 'error',
      message: 'Import failed partway through (' + String(err && err.message ? err.message : err) + '). Local database was backed up to ' + backupPath + ' before this started.',
    };
  }

  return { status: 'success', imported, backupPath };
}

module.exports = { syncMobileSnapshot, importFromSyncFolder, getSyncFolder };
