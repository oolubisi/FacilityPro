// db.js — Local JSON-file data store, replacing Google Sheets as the
// storage layer for the desktop app.
//
// Design: the whole database is ONE JSON file (all 19 collections
// nested inside it), loaded into memory once at startup and written
// back to disk (synchronously — the file is small enough that this
// takes single-digit milliseconds even with years of ledger history)
// after every change. This deliberately mirrors how Code.gs already
// treats a Google Sheet: each collection is just an array of plain
// objects, filtered/mapped/reduced with ordinary JavaScript, not SQL.
// That's what makes porting Code.gs's existing logic here direct
// rather than a rewrite into a different query language.
//
// A useful side effect of "one file is the whole database": that same
// file IS the backup. Exporting a backup is just copying it; nothing
// to transform.

const fs = require('fs');
const path = require('path');

const COLLECTIONS = [
  'Apartments', 'Assets', 'Maintenance', 'Utilities', 'Staff', 'Vendors',
  'Payments', 'MaintenanceLog', 'EnergyLedger', 'InventoryItems',
  'InventoryMovements', 'OccupancyLog', 'PettyCash',
  'RecurringExpenseTemplates', 'ServiceChargeBudgets', 'ServiceChargeLedger',
  'Sessions', 'Settings', 'Users',
];

let dbPath = null;
let data = null;
let userDataDir = null;

function emptyDatabase() {
  const db = {};
  COLLECTIONS.forEach((name) => {
    db[name] = [];
  });
  // Settings isn't a list of rows the way the others are — Code.gs
  // treats it as a single object of key/value settings, same shape
  // kept here for a direct port of getSettings/saveSettings.
  db.Settings = {};
  return db;
}

// Called once at app startup (see main.js). userDataDir is Electron's
// app.getPath('userData') — the standard, OS-appropriate place for a
// desktop app's own data, separate from the app's install location so
// it survives app updates/reinstalls.
function initDatabase(dir) {
  userDataDir = dir;
  dbPath = path.join(userDataDir, 'facility-pro-data.json');
  if (fs.existsSync(dbPath)) {
    try {
      const raw = fs.readFileSync(dbPath, 'utf8');
      data = JSON.parse(raw);
      // Any collection added to the schema after this file was first
      // created won't exist in an older saved file — filled in here
      // rather than crashing on a missing array.
      COLLECTIONS.forEach((name) => {
        if (data[name] === undefined) data[name] = name === 'Settings' ? {} : [];
      });
    } catch (e) {
      throw new Error('Local database file exists but could not be read: ' + String(e));
    }
  } else {
    data = emptyDatabase();
    persist();
  }
  return dbPath;
}

function persist() {
  // Synchronous write, and to a temp file renamed over the real one —
  // if the app crashes or loses power mid-write, the previous
  // complete file is never left half-overwritten (a partial write
  // followed by a rename failure just leaves the old file in place;
  // a partial direct write could otherwise corrupt the only copy of
  // every ledger this app has).
  const tmpPath = dbPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpPath, dbPath);
}

function getCollection(name) {
  if (!Object.prototype.hasOwnProperty.call(data, name)) {
    throw new Error('Unknown collection: ' + name);
  }
  return data[name];
}

function getDbPath() {
  return dbPath;
}

// [FEATURE] Shared by main.js (the folder picker, the attachment://
// protocol handler) and local-api.js (uploadImage) — kept in one
// place rather than duplicated in both, since both need the exact
// same answer to "where do attachments live". Falls back to a
// subfolder of Electron's userData directory until the person picks
// a real one in Settings, so uploads work on first run rather than
// erroring until someone visits Settings first.
function getAttachmentsFolder() {
  const settings = data.Settings;
  const configured = settings && settings.attachmentsFolder;
  if (configured && typeof configured === 'string') return configured;
  const fallback = path.join(userDataDir, 'attachments');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

module.exports = { COLLECTIONS, initDatabase, persist, getCollection, getDbPath, getAttachmentsFolder };
