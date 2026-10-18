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

// Default location of the Drive-synced folder this machine writes
// into. Overridable via Settings.driveSyncFolder (same pattern as
// Settings.attachmentsFolder) for anyone running this on a different
// machine or Drive account later — falls back to this path when unset.
const DEFAULT_SYNC_FOLDER =
  '/Users/kayodeolubisi/Library/CloudStorage/GoogleDrive-oolubisi@gmail.com/My Drive/FacilityPro Sync';

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

module.exports = { syncMobileSnapshot, getSyncFolder };
