// mobile-sync.js — Pushes a read-only snapshot of the local data to
// the small Apps Script relay added for exactly this purpose (see
// uploadMobileSnapshot in Code.gs), so the mobile app can pull it down
// and show a read-only view. This is the one deliberately narrow
// exception to "the desktop app doesn't talk to Apps Script anymore" —
// everything else in this app (db.js, local-api.js) never touches the
// network at all.

const db = require('./db');

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbxG8ubpGZdJtvY61-wmVw2O9J6NOwstoQQ4SMsXq0JMsttXf61dKwSrbEVfcBPQysmY/exec';
const API_TOKEN = '38f1f6e7-86f7-4a27-bffe-96303db14298';

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

function buildSnapshot() {
  const snapshot = {};
  SNAPSHOT_COLLECTIONS.forEach((name) => {
    snapshot[name] = db.getCollection(name);
  });
  snapshot.Settings = db.getCollection('Settings');
  snapshot.generatedAt = new Date().toISOString();
  return snapshot;
}

// Returns { status: 'success', ... } or { status: 'error', message }.
// Never throws — every failure path returns an error result instead,
// since this can be invoked over IPC (needs a result to show) or
// silently on app exit (needs to not crash the quit sequence).
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

async function syncMobileSnapshot() {
  const snapshot = buildSnapshot();
  let response;
  try {
    response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'uploadMobileSnapshot', data: { snapshot }, token: API_TOKEN }),
    });
  } catch (err) {
    const result = { status: 'error', message: 'Could not reach the cloud relay: ' + String(err && err.message ? err.message : err) };
    recordSyncOutcome(result);
    return result;
  }

  if (!response.ok) {
    const result = { status: 'error', message: 'Cloud relay returned HTTP ' + response.status + '.' };
    recordSyncOutcome(result);
    return result;
  }

  let result;
  try {
    result = await response.json();
  } catch (err) {
    const failResult = { status: 'error', message: 'Cloud relay returned an unreadable response.' };
    recordSyncOutcome(failResult);
    return failResult;
  }

  if (!result || result.status !== 'success') {
    const failResult = { status: 'error', message: (result && result.message) || 'Snapshot upload failed.' };
    recordSyncOutcome(failResult);
    return failResult;
  }
  const successResult = { status: 'success', timestamp: result.timestamp };
  recordSyncOutcome(successResult);
  return successResult;
}

module.exports = { syncMobileSnapshot };
