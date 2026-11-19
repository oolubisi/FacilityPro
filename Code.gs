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

// [BUG FIX] Assembling the payload below means ~18 separate
// file.getBlob() round-trips to Drive, one per collection, and that
// measured ~10 seconds wall-clock per request. Every mobile load paid
// it in full, which on a phone looked indistinguishable from the app
// not loading at all. The assembled JSON is now cached so only the
// first call after a desktop push pays that cost.
//
// CacheService caps a single value at 100 KB and the payload is well
// past that (~145 KB), so it's split into chunks across several keys
// with a small meta entry recording the count. A partially-expired set
// is treated as a miss — see readCachedPayload.
const CACHE_KEY_PREFIX = 'fp_snapshot_';
const CACHE_CHUNK_SIZE = 90000;
const CACHE_TTL_SECONDS = 300;

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

    // &fresh=1 bypasses the cache — useful right after a desktop sync
    // when you don't want to wait out the TTL to confirm it landed.
    const wantsFresh = e && e.parameter && e.parameter.fresh === '1';
    if (!wantsFresh) {
      const cachedPayload = readCachedPayload();
      if (cachedPayload) {
        return ContentService.createTextOutput(cachedPayload).setMimeType(ContentService.MimeType.JSON);
      }
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

    const payload = JSON.stringify({ status: 'success', snapshot: snapshot });
    writeCachedPayload(payload);
    return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return jsonResponse({ status: 'error', message: 'Server error: ' + err.message });
  }
}

// ── PAYLOAD CACHE ──
// Both helpers are best-effort: any failure degrades to "no cache",
// which costs latency but never correctness. Only successful payloads
// are ever cached — errors always re-run so a transient Drive failure
// doesn't get pinned in place for the whole TTL.
function readCachedPayload() {
  try {
    const cache = CacheService.getScriptCache();
    const rawMeta = cache.get(CACHE_KEY_PREFIX + 'meta');
    if (!rawMeta) return null;
    const meta = JSON.parse(rawMeta);
    if (!meta || !meta.chunks) return null;

    const keys = [];
    for (var i = 0; i < meta.chunks; i++) keys.push(CACHE_KEY_PREFIX + i);
    const parts = cache.getAll(keys);

    var payload = '';
    for (var j = 0; j < meta.chunks; j++) {
      const part = parts[CACHE_KEY_PREFIX + j];
      // Chunks expire independently; a gap means the set is no longer
      // whole, and stitching around it would hand back truncated JSON.
      if (part === null || part === undefined) return null;
      payload += part;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

function writeCachedPayload(payload) {
  try {
    const cache = CacheService.getScriptCache();
    const entries = {};
    var chunkCount = 0;
    for (var i = 0; i < payload.length; i += CACHE_CHUNK_SIZE) {
      entries[CACHE_KEY_PREFIX + chunkCount] = payload.substring(i, i + CACHE_CHUNK_SIZE);
      chunkCount++;
    }
    entries[CACHE_KEY_PREFIX + 'meta'] = JSON.stringify({ chunks: chunkCount });
    cache.putAll(entries, CACHE_TTL_SECONDS);
  } catch (err) {
    /* Caching is an optimisation only — a failure here is not fatal. */
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
