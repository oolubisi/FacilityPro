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
    return { status: 'error', message: 'Could not reach the cloud relay: ' + String(err && err.message ? err.message : err) };
  }

  if (!response.ok) {
    return { status: 'error', message: 'Cloud relay returned HTTP ' + response.status + '.' };
  }

  let result;
  try {
    result = await response.json();
  } catch (err) {
    return { status: 'error', message: 'Cloud relay returned an unreadable response.' };
  }

  if (!result || result.status !== 'success') {
    return { status: 'error', message: (result && result.message) || 'Snapshot upload failed.' };
  }
  return { status: 'success', timestamp: result.timestamp };
}

module.exports = { syncMobileSnapshot };
