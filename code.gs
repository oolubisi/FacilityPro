function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents || '{}');

    // [SECURITY FIX] Require a shared-secret token on every write/read
    // call before touching any data. Set the expected value once via
    // setApiToken() (see bottom of this file) — do NOT hardcode it here.
    var authError = checkApiToken(request);
    if (authError) return jsonResponse(authError);

    var action = request.action;
    var data = request.data || {};

    // [FEATURE] Per-user login/session. login and getUsersForLogin are
    // the only actions reachable before a session exists (the login
    // screen needs to list users and let someone authenticate). Every
    // other action requires a valid, non-expired session token — see
    // resolveSession()/createSession() near the bottom of this file.
    if (action === 'login') {
      return jsonResponse(handleLogin(data));
    }
    if (action === 'getUsersForLogin') {
      return jsonResponse(getUsersForLogin());
    }

    var actor = resolveSession(request.sessionToken);
    if (!actor) {
      return jsonResponse({
        status: 'error',
        code: 'AUTH_REQUIRED',
        message: 'Session expired or invalid. Please log in again.'
      });
    }

    if (action === 'logout') {
      invalidateSession(request.sessionToken);
      return jsonResponse({ status: 'success' });
    }

    // [FEATURE] User management — admin only. Deliberately checked
    // inline here rather than via a general role-rules table, since
    // broader role-based permissions for business actions (approve
    // Work Orders, mark Payments paid, etc) are a separate, larger
    // change; this just covers the two actions login itself depends on.
    if (action === 'createUser' || action === 'updateUserPin' || action === 'updateUser' || action === 'getUsers') {
      if (actor.role !== 'admin' && !(action === 'updateUserPin' && data.userId === actor.userId)) {
        return jsonResponse({ status: 'error', message: 'Only admins can manage users.' });
      }
      if (action === 'createUser') return jsonResponse(createUser(data));
      if (action === 'updateUserPin') return jsonResponse(updateUserPin(data));
      if (action === 'updateUser') return jsonResponse(updateUserProfile(data));
      if (action === 'getUsers') return jsonResponse(getUsersForAdmin());
    }

    // [FEATURE] Role-based permissions. This is the actual enforcement —
    // any button-hiding done client-side for a given role is UX only.
    // See checkBusinessPermission() near resolveSession() for the rules.
    var permissionError = checkBusinessPermission(action, data, actor);
    if (permissionError) {
      return jsonResponse({ status: 'error', message: permissionError });
    }

    // [FEATURE] Service Charge ledger — manager+ only, checked inside
    // checkBusinessPermission() above (including the read action,
    // getServiceChargeLedger — deliberately NOT part of the universal
    // getAllData payload, so staff/viewer accounts never even receive
    // this data, not just have it hidden in the UI). Routed here as its
    // own block since these have custom logic (weighted-split
    // computation, same-day-edit enforcement) that doesn't fit the
    // generic save/update/delete dispatch below.
    if (action === 'getServiceChargeLedger') {
      return jsonResponse(fetchSheetDataAsJSON('ServiceChargeLedger'));
    }
    if (action === 'getOccupancyLog') {
      return jsonResponse(fetchSheetDataAsJSON('OccupancyLog'));
    }
    if (action === 'getPettyCashLedger') {
      return jsonResponse(fetchSheetDataAsJSON('PettyCash'));
    }
    if (action === 'logPettyCashInflow') {
      return jsonResponse(logPettyCashInflow(data, actor));
    }
    if (action === 'logPettyCashOutflow') {
      return jsonResponse(logPettyCashOutflow(data, actor));
    }
    if (action === 'updatePettyCashEntry') {
      return jsonResponse(updatePettyCashEntry(data, actor));
    }
    if (action === 'deletePettyCashEntry') {
      return jsonResponse(deletePettyCashEntry(data, actor));
    }
    if (action === 'getInventoryItems') {
      return jsonResponse(fetchSheetDataAsJSON('InventoryItems'));
    }
    if (action === 'getInventoryMovements') {
      return jsonResponse(fetchSheetDataAsJSON('InventoryMovements'));
    }
    if (action === 'saveInventoryItem') {
      return jsonResponse(saveInventoryItem(data, actor));
    }
    if (action === 'updateInventoryItem') {
      return jsonResponse(updateInventoryItem(data, actor));
    }
    if (action === 'receiveStock') {
      return jsonResponse(receiveStock(data, actor));
    }
    if (action === 'issueStock') {
      return jsonResponse(issueStock(data, actor));
    }
    if (action === 'adjustStock') {
      return jsonResponse(adjustStock(data, actor));
    }
    if (action === 'logContribution') {
      return jsonResponse(logContribution(data, actor));
    }
    if (action === 'logApartmentExpense') {
      return jsonResponse(logApartmentExpense(data, actor));
    }
    if (action === 'logSharedExpense') {
      return jsonResponse(logSharedExpense(data, actor));
    }
    if (action === 'updateServiceChargeEntry') {
      return jsonResponse(updateServiceChargeEntry(data, actor));
    }
    if (action === 'deleteServiceChargeEntry') {
      return jsonResponse(deleteServiceChargeEntry(data, actor));
    }

    // [SECURITY FIX] Sanitize all string inputs to prevent formula injection
    data = sanitizePayload(data);

    // [BUG FIX] Phone numbers (11 digits, e.g. 08012345678) were losing
    // their leading zero because Sheets auto-detects numeric-looking
    // strings and coerces the cell to a Number. A leading apostrophe is
    // the standard Sheets convention for "force this as text" and is
    // stripped automatically on read — getValues() returns the plain
    // digits, no apostrophe.
    data = forceTextForPhoneFields(data);

    if (action === 'generatePDF') {
      return handleGeneratePDF(request, data);
    }

    if (action === 'uploadImage') {
      // [SECURITY FIX] Enforce file size limit (5MB)
      var base64Str = data.base64 || '';
      var approxBytes = base64Str.length * 0.75;
      if (approxBytes > 5 * 1024 * 1024) {
        return jsonResponse({
          status: 'error',
          message: 'File exceeds 5MB limit.'
        });
      }
      return jsonResponse(executeDriveUploadPipeline(data));
    }

    if (action === 'getFileBase64') {
      // [SECURITY FIX] Restrict file access to app folder only
      return jsonResponse(getFileBase64Restricted(data));
    }

    if (action === 'saveSettings') {
      return jsonResponse(saveSettings(data));
    }

    if (action === 'getSettings') {
      return jsonResponse(getSettings());
    }

    if (action === 'getAllData') {
      return jsonResponse(getAllData());
    }

    if (action === 'generateId') {
      return jsonResponse(generateId(data));
    }

    if (action === 'deleteExpenseRequest') {
      var expenseSheet = getSheet('ExpenseRequests', false);
      if (expenseSheet) deleteRecordDynamically(expenseSheet, data, 'reqId');
      return jsonResponse({ status: 'success' });
    }

    if (action === 'deleteMaintenanceLog') {
      var logSheet = getSheet('MaintenanceLog', false);
      if (logSheet) deleteRecordDynamically(logSheet, data, 'logId');
      return jsonResponse({ status: 'success' });
    }

    var readMap = {
      getApartments: 'Apartments',
      getAssets: 'Assets',
      getMaintenance: 'Maintenance',
      getWorkOrders: 'WorkOrders',
      getStaff: 'Staff',
      getVendors: 'Vendors',
      getUtilities: 'Utilities',
      getPayments: 'Payments',
      getExpenseRequests: 'ExpenseRequests',
      getCashExpenses: 'CashExpenses',
      getMaintenanceLog: 'MaintenanceLog'
    };

    if (readMap[action]) {
      return jsonResponse(fetchSheetDataAsJSON(readMap[action]));
    }

    if (action === 'getStats') {
      return jsonResponse(getStats());
    }

    var sheetMap = {
      saveApartment: 'Apartments',
      updateApartment: 'Apartments',
      saveAsset: 'Assets',
      updateAsset: 'Assets',
      saveMaintenance: 'Maintenance',
      updateMaintenance: 'Maintenance',
      saveWorkOrder: 'WorkOrders',
      updateWorkOrder: 'WorkOrders',
      saveUtility: 'Utilities',
      updateUtility: 'Utilities',
      saveStaff: 'Staff',
      updateStaff: 'Staff',
      saveVendor: 'Vendors',
      updateVendor: 'Vendors',
      savePayment: 'Payments',
      updatePayment: 'Payments',
      saveExpenseRequest: 'ExpenseRequests',
      updateExpenseRequest: 'ExpenseRequests',
      saveCashExpense: 'CashExpenses',
      updateCashExpense: 'CashExpenses',
      saveMaintenanceLog: 'MaintenanceLog',
      updateMaintenanceLog: 'MaintenanceLog'
    };

    var sheetName = sheetMap[action];
    if (!sheetName) {
      return jsonResponse({
        status: 'error',
        message: 'Action route not found: ' + action
      });
    }

    var sheet = getSheet(sheetName, true);
    data = applyAuditFields(data, action, actor);
    var primaryKeyMap = {
      Apartments: 'apt',
      Assets: 'tag',
      Maintenance: 'ticketId',
      WorkOrders: 'workOrderId',
      Inventory: 'itemId',
      Staff: 'rowId',
      Vendors: 'rowId',
      Payments: 'paymentId',
      Utilities: 'rowId',
      ExpenseRequests: 'reqId',
      CashExpenses: 'cashId',
      MaintenanceLog: 'logId'
    };

    var pkField = primaryKeyMap[sheetName];

    // [FEATURE] Optimistic-concurrency conflict check. The client sends
    // expectedUpdatedAt = the updatedAt value it last saw for this
    // record (captured when the edit form was opened). If the record's
    // current updatedAt doesn't match that anymore, someone else saved
    // a change to it in the meantime — reject rather than silently
    // overwriting their edit. Only runs when the client actually sent
    // expectedUpdatedAt; callers that don't send it (e.g. the small
    // showPaymentRequest toggle, which isn't a real conflict risk)
    // aren't blocked by this.
    if (action.indexOf('update') === 0 && data.expectedUpdatedAt) {
      var recordForConflictCheck = findRecordByPK(sheet, pkField, data[pkField]);
      if (recordForConflictCheck) {
        var currentUpdatedAt = recordForConflictCheck.updatedAt || recordForConflictCheck.UpdatedAt;
        var expectedTime = new Date(data.expectedUpdatedAt).getTime();
        var currentTime = currentUpdatedAt ? new Date(currentUpdatedAt).getTime() : NaN;
        if (!isNaN(expectedTime) && !isNaN(currentTime) && expectedTime !== currentTime) {
          return jsonResponse({
            status: 'error',
            code: 'CONFLICT',
            message: (recordForConflictCheck.updatedBy || recordForConflictCheck.UpdatedBy || 'Someone') +
              ' already changed this record. Your edit was not saved — reopen it to see the latest version.'
          });
        }
      }
      // Only used for the check above — strip it so it doesn't get
      // written into the sheet as a stray column.
      delete data.expectedUpdatedAt;
    }

    // [BUSINESS LOGIC FIX] Enforce immutable states
    if (action.indexOf('update') === 0) {
      if (sheetName === 'WorkOrders') {
        var existingWO = findRecordByPK(sheet, pkField, data[pkField]);
        if (existingWO && String(existingWO.status || existingWO.Status || '').toUpperCase() === 'APPROVED') {
          return jsonResponse({
            status: 'error',
            message: 'Approved Work Orders cannot be modified.'
          });
        }
      }
      if (sheetName === 'Payments') {
        var existingPay = findRecordByPK(sheet, pkField, data[pkField]);
        if (existingPay && (String(existingPay.isPaid || existingPay.IsPaid || '').toUpperCase() === 'TRUE' || existingPay.isPaid === true || existingPay.IsPaid === true)) {
          return jsonResponse({
            status: 'error',
            message: 'Paid/Cleared Payment records cannot be modified.'
          });
        }
      }
      // [FEATURE] Automatic occupancy history — apt.status only ever
      // reflects "right now," so a report run today has no way to know
      // whether a unit was occupied during some past period once its
      // status has since changed. Whenever an apartment's status
      // actually transitions to/from Occupied, log it here — this is
      // the only place status changes happen, so it can't drift out of
      // sync with the apartment record the way a manually-maintained
      // log could.
      if (sheetName === 'Apartments' && data.status !== undefined) {
        var existingApt = findRecordByPK(sheet, pkField, data[pkField]);
        var oldStatus = existingApt ? String(existingApt.status || existingApt.Status || '').toLowerCase() : '';
        var newStatus = String(data.status || '').toLowerCase();
        if (oldStatus !== newStatus && (oldStatus === 'occupied' || newStatus === 'occupied')) {
          logOccupancyTransition(data[pkField], newStatus === 'occupied' ? 'occupied' : 'vacated', actor);
        }
      }
      updateRecordDynamically(sheet, data, pkField);
    } else if (action.indexOf('save') === 0) {
      // [BUG FIX] Prevent duplicate primary keys on save
      var saveHeaders = getHeaders(sheet);
      var savePkIndex = saveHeaders.indexOf(pkField);
      if (pkField && data[pkField] && savePkIndex !== -1 && findRowByPrimaryKey(sheet, savePkIndex + 1, data[pkField]) !== -1) {
        return jsonResponse({
          status: 'error',
          message: 'Record with ID ' + data[pkField] + ' already exists. Use update instead.'
        });
      }
      saveRecordDynamically(sheet, data);
      // A brand-new apartment created already-Occupied needs its first
      // occupancy stint recorded too — there's no prior "update" that
      // would have caught this transition otherwise.
      if (sheetName === 'Apartments' && String(data.status || '').toLowerCase() === 'occupied') {
        logOccupancyTransition(data[pkField], 'occupied', actor);
      }
    }

    return jsonResponse({ status: 'success' });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: err && err.stack ? err.stack : String(err)
    });
  }
}

// [FEATURE] Health check endpoint. Deliberately does NOT require the API
// token — it returns no application data, just a heartbeat, so it's safe
// to leave open for uptime monitors etc.
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    service: 'Facility Pro API',
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
// [SECURITY FIX] API TOKEN AUTH
//
// The client app has no login system, so this is a shared-secret check,
// not real per-user authentication — anyone who reads the deployed
// client JS can still find the token. What it actually buys you:
//   • Blocks blind/automated hits against a bare, unauthenticated GAS
//     URL (the most common real-world exposure for these deployments).
//   • Lets you instantly revoke access by rotating the token in Script
//     Properties, without redeploying the web app.
// If you need real per-user access control, that requires a login layer
// on top of this — ask if you want that discussed.
//
// ONE-TIME SETUP:
//   1. Open this project's Apps Script editor.
//   2. Run the `setApiToken` function below ONCE, after replacing
//      'PASTE-A-LONG-RANDOM-STRING-HERE' with a real random value
//      (e.g. generate one at https://www.uuidgenerator.net/ or with
//      `openssl rand -hex 32` locally — don't reuse a password).
//   3. Authorize the script when prompted.
//   4. Copy the SAME string into API_TOKEN in Core.js on the client.
//   5. Re-deploy this Web App (Deploy > Manage deployments > Edit >
//      New version) so the change goes live.
//   6. Optional: delete/comment out setApiToken afterward so the token
//      value isn't left sitting in your script source.
// ─────────────────────────────────────────────
function setApiToken() {
  var token = 'PASTE-A-LONG-RANDOM-STRING-HERE';
  if (token === 'PASTE-A-LONG-RANDOM-STRING-HERE') {
    throw new Error('Replace the placeholder with a real random token before running this.');
  }
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  Logger.log('API_TOKEN saved to Script Properties.');
}

// Returns an error response object if the request's token is missing/
// wrong, or null if it's OK to proceed.
function checkApiToken(request) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');

  // If no token has been configured yet, don't lock out the developer
  // mid-setup — but make it loud in the logs so it isn't forgotten.
  if (!expected) {
    Logger.log('WARNING: API_TOKEN is not set — requests are currently unauthenticated. Run setApiToken() to fix this.');
    return null;
  }

  var provided = request && request.token;
  if (provided !== expected) {
    return {
      status: 'error',
      message: 'Unauthorized: missing or invalid API token.'
    };
  }

  return null;
}

// ─────────────────────────────────────────────
// [FEATURE] PER-USER LOGIN & SESSIONS
//
// PIN-based identity (not Google OAuth/SSO) — chosen because facility
// staff realistically won't have/use Google Workspace accounts for
// this, and a tap-a-name-then-PIN flow is fast on a shared device.
//
// Sheets used:
//   Users    — userId, name, pinHash, role, active, email, lastLoginAt
//   Sessions — sessionToken, userId, name, role, createdAt, expiresAt
//
// ONE-TIME SETUP (mirrors setApiToken() above):
//   1. Open the Apps Script editor.
//   2. Edit setupFirstAdmin() below: replace the placeholder PIN and
//      the PIN_SALT placeholder with real values.
//   3. Run setupFirstAdmin() once. It creates the Users sheet (if
//      missing) and one admin row.
//   4. Log into the app as that admin, then use it to create the rest
//      of your team's accounts (createUser action — see doPost).
//   5. Optional: clear/comment out the PIN placeholder in
//      setupFirstAdmin() afterward so it isn't sitting in your source.
// ─────────────────────────────────────────────
var PIN_SALT = 'PASTE-A-DIFFERENT-LONG-RANDOM-STRING-HERE';
var SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours

function setupFirstAdmin() {
  var pin = 'PASTE-A-STARTING-PIN-HERE';
  if (pin === 'PASTE-A-STARTING-PIN-HERE' || PIN_SALT === 'PASTE-A-DIFFERENT-LONG-RANDOM-STRING-HERE') {
    throw new Error('Set a real PIN_SALT above and a real starting pin before running this.');
  }

  var sheet = getSheet('Users', true);
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(['userId', 'name', 'pinHash', 'role', 'active', 'email', 'lastLoginAt']);
  }

  var userId = 'USR-0001';
  sheet.appendRow([userId, 'Admin', hashPin(pin, userId), 'admin', true, '', '']);
  Logger.log('First admin created: userId=' + userId + '. Log in with that ID and the PIN you set.');
}

function hashPin(pin, userId) {
  var raw = String(pin) + ':' + String(userId) + ':' + PIN_SALT;
  var digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digestBytes
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

function handleLogin(data) {
  var userId = String((data && data.userId) || '').trim();
  var pin = String((data && data.pin) || '').trim();
  if (!userId || !pin) {
    return { status: 'error', message: 'Select a user and enter your PIN.' };
  }

  var sheet = getSheet('Users', false);
  if (!sheet) {
    return { status: 'error', message: 'No users configured yet. Run setupFirstAdmin() in the Apps Script editor.' };
  }

  var user = findRecordByPK(sheet, 'userId', userId);
  var isActive = user && (user.active === true || String(user.active).toUpperCase() === 'TRUE');
  if (!user || !isActive) {
    return { status: 'error', message: 'Invalid user or PIN.' };
  }

  if (hashPin(pin, userId) !== String(user.pinHash || '')) {
    return { status: 'error', message: 'Invalid user or PIN.' };
  }

  var role = user.role || 'staff';
  var token = createSession(userId, user.name, role);

  try {
    updateRecordDynamically(sheet, { userId: userId, lastLoginAt: new Date().toISOString() }, 'userId');
  } catch (e) {
    // Non-fatal — don't block login over a lastLoginAt write failure.
  }

  return {
    status: 'success',
    sessionToken: token,
    userId: userId,
    name: user.name,
    role: role
  };
}

// Public (pre-login) list for the login screen's user picker. Only ever
// returns userId/name — never pinHash or role, since this is reachable
// without a session.
function getUsersForLogin() {
  var sheet = getSheet('Users', false);
  if (!sheet) return [];
  return fetchSheetDataAsJSON('Users')
    .filter(function (u) {
      return u.active === true || String(u.active).toUpperCase() === 'TRUE';
    })
    .map(function (u) {
      return { userId: u.userId, name: u.name };
    });
}

// Admin-only full roster for the "Manage Users" screen. Includes
// inactive users too (so an admin can reactivate someone) and role/
// email/lastLoginAt — but still never pinHash, which never leaves the
// server under any action.
function getUsersForAdmin() {
  var sheet = getSheet('Users', false);
  if (!sheet) return [];
  return fetchSheetDataAsJSON('Users').map(function (u) {
    return {
      userId: u.userId,
      name: u.name,
      role: u.role || 'staff',
      active: u.active === true || String(u.active).toUpperCase() === 'TRUE',
      email: u.email || '',
      lastLoginAt: u.lastLoginAt || ''
    };
  });
}

function createUser(data) {
  var name = sanitizePayload({ name: data.name || '' }).name;
  var pin = String(data.pin || '').trim();
  var role = ['admin', 'manager', 'staff', 'viewer'].indexOf(data.role) !== -1 ? data.role : 'staff';
  if (!name || !pin) {
    return { status: 'error', message: 'Name and starting PIN are required.' };
  }
  if (pin.length < 4) {
    return { status: 'error', message: 'PIN must be at least 4 digits.' };
  }

  var sheet = getSheet('Users', true);
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(['userId', 'name', 'pinHash', 'role', 'active', 'email', 'lastLoginAt']);
  }

  var userId = generateNextIdForSheet(sheet, 'userId', 'USR');
  sheet.appendRow([userId, name, hashPin(pin, userId), role, true, sanitizePayload({ e: data.email || '' }).e, '']);

  return { status: 'success', userId: userId };
}

function updateUserPin(data) {
  var userId = String(data.userId || '').trim();
  var pin = String(data.pin || '').trim();
  if (!userId || !pin) return { status: 'error', message: 'Missing userId or pin.' };
  if (pin.length < 4) return { status: 'error', message: 'PIN must be at least 4 digits.' };

  var sheet = getSheet('Users', false);
  if (!sheet) return { status: 'error', message: 'Users sheet not found.' };
  updateRecordDynamically(sheet, { userId: userId, pinHash: hashPin(pin, userId) }, 'userId');
  return { status: 'success' };
}

function updateUserProfile(data) {
  var userId = String(data.userId || '').trim();
  if (!userId) return { status: 'error', message: 'Missing userId.' };

  var sheet = getSheet('Users', false);
  if (!sheet) return { status: 'error', message: 'Users sheet not found.' };

  var update = { userId: userId };
  if (data.name !== undefined) update.name = sanitizePayload({ n: data.name }).n;
  if (data.email !== undefined) update.email = sanitizePayload({ e: data.email }).e;
  if (data.role !== undefined && ['admin', 'manager', 'staff', 'viewer'].indexOf(data.role) !== -1) {
    update.role = data.role;
  }
  if (data.active !== undefined) update.active = !!data.active;

  updateRecordDynamically(sheet, update, 'userId');
  return { status: 'success' };
}

// Small local counter helper (independent of generateId()'s cross-sheet
// locking/PropertiesService counter, which is overkill for a low-volume
// Users sheet) — scans the sheet's own userId column for the next number.
function generateNextIdForSheet(sheet, idKey, prefix) {
  var maxId = 0;
  if (sheet.getLastRow() > 1) {
    var headers = getHeaders(sheet);
    var idIndex = headers.indexOf(idKey);
    if (idIndex !== -1) {
      var values = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getValues();
      values.forEach(function (row) {
        var raw = String(row[0] || '');
        if (raw.indexOf(prefix + '-') === 0) {
          var n = parseInt(raw.split('-')[1], 10);
          if (!isNaN(n) && n > maxId) maxId = n;
        }
      });
    }
  }
  return prefix + '-' + String(maxId + 1).padStart(4, '0');
}

function createSession(userId, name, role) {
  var sheet = getSheet('Sessions', true);
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(['sessionToken', 'userId', 'name', 'role', 'createdAt', 'expiresAt']);
  }

  var token = Utilities.getUuid() + '-' + Utilities.getUuid();
  var now = new Date();
  var expires = new Date(now.getTime() + SESSION_LIFETIME_MS);
  sheet.appendRow([token, userId, name, role, now.toISOString(), expires.toISOString()]);

  // Best-effort cleanup of expired sessions so this sheet doesn't grow
  // forever. Cheap enough to run on every login (Sessions is small).
  try {
    pruneExpiredSessions(sheet);
  } catch (e) {}

  return token;
}

// ─────────────────────────────────────────────
// [FEATURE] ROLE-BASED PERMISSIONS
//
// Roles (least to most privileged): viewer, staff, manager, admin.
//   viewer  — read-only, no mutations at all.
//   staff   — creates/updates day-to-day records (Tickets, Assets,
//             Inventory, Work Order *requests*, etc). Cannot approve/
//             decline Work Orders, mark Payments paid, manage Staff/
//             Vendor records, or touch Settings.
//   manager — everything staff can, plus approvals, payments, and
//             Staff/Vendor management.
//   admin   — everything, plus Settings and user management (see the
//             createUser/updateUser handling above in doPost).
//
// checkBusinessPermission() is the actual enforcement — it runs
// server-side on every request before any sheet is touched. Any
// button-hiding done client-side for a given role (see Core.js's
// currentUser.role) is UX only and must never be relied on for
// security; a malicious or out-of-date client that skips it still gets
// rejected here.
// ─────────────────────────────────────────────
var ROLE_LEVELS = { viewer: 0, staff: 1, manager: 2, admin: 3 };

function actorMeetsRole(actor, minRole) {
  var level = ROLE_LEVELS.hasOwnProperty(actor.role) ? ROLE_LEVELS[actor.role] : 0;
  return level >= ROLE_LEVELS[minRole];
}

// Returns a user-facing error string if the actor isn't allowed to
// perform this action, or null if it's OK to proceed.
function checkBusinessPermission(action, data, actor) {
  // [FEATURE] Service Charge ledger AND Petty Cash — manager+ only for
  // BOTH reads and writes, per explicit design requirement: staff/
  // viewer should have no access to either section at all, not just a
  // hidden UI. Checked before the generic "any get* action is
  // readable" rule below, since the two get* actions here would
  // otherwise slip through that as plain reads.
  var managerOnlyFinancialActions = [
    'getServiceChargeLedger',
    'getOccupancyLog',
    'logContribution',
    'logApartmentExpense',
    'logSharedExpense',
    'updateServiceChargeEntry',
    'deleteServiceChargeEntry',
    'getPettyCashLedger',
    'logPettyCashInflow',
    'logPettyCashOutflow',
    'updatePettyCashEntry',
    'deletePettyCashEntry',
    'getInventoryItems',
    'getInventoryMovements',
    'saveInventoryItem',
    'updateInventoryItem',
    'receiveStock',
    'issueStock',
    'adjustStock'
  ];
  if (managerOnlyFinancialActions.indexOf(action) !== -1) {
    return actorMeetsRole(actor, 'manager') ? null : 'Only managers can access this section.';
  }

  // Reads and read-adjacent utility actions are open to every role,
  // including viewer — nothing here mutates a sheet.
  var alwaysReadable = ['generatePDF', 'getFileBase64', 'getStats', 'getSettings', 'getAllData'];
  if (action.indexOf('get') === 0 || alwaysReadable.indexOf(action) !== -1) {
    return null;
  }

  // Low-risk utility writes (bumping an ID counter / uploading a file
  // that isn't yet referenced by any record) are normal parts of the
  // staff workflow of filling out a form — allow staff+, block viewer.
  if (action === 'generateId' || action === 'uploadImage') {
    return actorMeetsRole(actor, 'staff') ? null : 'Your account is read-only.';
  }

  if (action === 'saveSettings') {
    return actorMeetsRole(actor, 'admin') ? null : 'Only admins can change settings.';
  }

  if (action === 'saveStaff' || action === 'updateStaff' || action === 'saveVendor' || action === 'updateVendor') {
    return actorMeetsRole(actor, 'manager') ? null : 'Only managers can manage staff/vendor records.';
  }

  if (action === 'deleteExpenseRequest' || action === 'deleteMaintenanceLog') {
    return actorMeetsRole(actor, 'manager') ? null : 'Only managers can delete records.';
  }

  if ((action === 'saveWorkOrder' || action === 'updateWorkOrder') && (data.status === 'Approved' || data.status === 'Declined')) {
    return actorMeetsRole(actor, 'manager') ? null : 'Only managers can approve or decline Work Orders.';
  }

  var markingPaid = data.isPaid === true || String(data.isPaid).toUpperCase() === 'TRUE';
  if ((action === 'savePayment' || action === 'updatePayment') && markingPaid) {
    return actorMeetsRole(actor, 'manager') ? null : 'Only managers can mark payments as paid.';
  }

  // Blanket rule for everything else that reaches here — the generic
  // save*/update* CRUD actions not already special-cased above (create
  // a Ticket, update an Asset, submit a Work Order request, etc). Any
  // authenticated staff+ can do these; viewer cannot.
  return actorMeetsRole(actor, 'staff') ? null : 'Your account is read-only.';
}

// Returns { userId, name, role } if the token is valid and unexpired,
// or null otherwise. Called on every non-public action in doPost.
function resolveSession(sessionToken) {
  if (!sessionToken) return null;
  var sheet = getSheet('Sessions', false);
  if (!sheet || sheet.getLastRow() < 2) return null;

  var headers = getHeaders(sheet);
  var tokenIndex = headers.indexOf('sessionToken');
  if (tokenIndex === -1) return null;

  var row = findRowByPrimaryKey(sheet, tokenIndex + 1, sessionToken);
  if (row === -1) return null;

  var values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  var record = {};
  headers.forEach(function (h, i) {
    record[h] = values[i];
  });

  var expiresAt = new Date(record.expiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return null;
  }

  return { userId: record.userId, name: record.name, role: record.role };
}

function invalidateSession(sessionToken) {
  if (!sessionToken) return;
  var sheet = getSheet('Sessions', false);
  if (!sheet || sheet.getLastRow() < 2) return;
  var headers = getHeaders(sheet);
  var tokenIndex = headers.indexOf('sessionToken');
  if (tokenIndex === -1) return;
  var row = findRowByPrimaryKey(sheet, tokenIndex + 1, sessionToken);
  if (row !== -1) sheet.deleteRow(row);
}

function pruneExpiredSessions(sheet) {
  if (sheet.getLastRow() < 2) return;
  var headers = getHeaders(sheet);
  var expiresIndex = headers.indexOf('expiresAt');
  if (expiresIndex === -1) return;

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var now = Date.now();
  // Delete bottom-up so row indices stay valid as we go.
  for (var i = values.length - 1; i >= 0; i--) {
    var expiresAt = new Date(values[i][expiresIndex]);
    if (!isNaN(expiresAt.getTime()) && expiresAt.getTime() < now) {
      sheet.deleteRow(i + 2);
    }
  }
}


// [BUG FIX] Prefix phone1/phone2 with a leading apostrophe so Sheets
// stores them as literal text and preserves the leading zero (e.g.
// "08012345678"). Applies uniformly to any entity using these field
// names (Apartments, Vendors, Staff).
function forceTextForPhoneFields(data) {
  if (!data || typeof data !== 'object') return data;
  ['phone1', 'phone2'].forEach(function(key) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
      var val = String(data[key]);
      if (val.charAt(0) !== "'") {
        data[key] = "'" + val;
      }
    }
  });
  return data;
}

// [SECURITY FIX] Sanitize string values to prevent formula injection
function sanitizePayload(data) {
  if (!data || typeof data !== 'object') return data;
  var clean = {};
  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      var val = data[key];
      if (typeof val === 'string') {
        // Strip leading formula triggers
        val = val.replace(/^[\s]*[=\+\-@]+[\s]*/, '');
        // Neutralize HTML tags
        val = val.replace(/[<>]/g, '');
      }
      clean[key] = val;
    }
  }
  return clean;
}

// [FEATURE] actor is the resolved session ({userId, name, role}) from
// doPost — replaces the old Session.getActiveUser().getEmail() call,
// which only ever resolves to a real address under a specific "execute
// as user" + domain-restricted deployment. With per-user login, we know
// exactly who's acting regardless of deployment config.
function applyAuditFields(data, action, actor) {
  var now = new Date().toISOString();
  var clean = data || {};
  var actorName = (actor && actor.name) || 'unknown';
  if (action.indexOf('save') === 0) {
    if (!clean.createdAt) clean.createdAt = now;
    if (!clean.createdBy) clean.createdBy = actorName;
  }
  clean.updatedAt = now;
  clean.updatedBy = actorName;
  return clean;
}

function generateId(data) {
  var sheetName = data.sheetName;
  var idKey = data.idKey;
  var prefix = data.prefix;
  if (!sheetName || !idKey || !prefix) {
    return {
      status: 'error',
      message: 'generateId requires sheetName, idKey and prefix.'
    };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet(sheetName, true);
    var propertyKey = 'ID_COUNTER_' + sheetName + '_' + idKey;
    var props = PropertiesService.getScriptProperties();
    var storedMax = parseInt(props.getProperty(propertyKey) || '0', 10) || 0;
    var maxId = 0;
    if (sheet.getLastColumn() > 0 && sheet.getLastRow() > 1) {
      var headers = getHeaders(sheet);
      var idIndex = headers.indexOf(idKey);
      if (idIndex === -1) {
        sheet.getRange(1, headers.length + 1).setValue(idKey);
        headers.push(idKey);
        idIndex = headers.length - 1;
      }
      var values = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < values.length; i++) {
        var raw = String(values[i][0] || '').trim();
        if (raw.indexOf(prefix + '-') === 0) {
          var n = parseInt(raw.split('-')[1], 10);
          if (!isNaN(n) && n > maxId) maxId = n;
        }
      }
    } else if (sheet.getLastColumn() === 0) {
      sheet.getRange(1, 1).setValue(idKey);
    }
    maxId = Math.max(maxId, storedMax);
    props.setProperty(propertyKey, String(maxId + 1));

    return {
      status: 'success',
      id: prefix + '-' + String(maxId + 1).padStart(4, '0')
    };
  } finally {
    lock.releaseLock();
  }
}

function getAllData() {
  return {
    apartments: fetchSheetDataAsJSON('Apartments'),
    assets: fetchSheetDataAsJSON('Assets'),
    maintenance: fetchSheetDataAsJSON('Maintenance'),
    workOrders: fetchSheetDataAsJSON('WorkOrders'),
    staff: fetchSheetDataAsJSON('Staff'),
    vendors: fetchSheetDataAsJSON('Vendors'),
    utilities: fetchSheetDataAsJSON('Utilities'),
    payments: fetchSheetDataAsJSON('Payments'),
    expenseRequests: fetchSheetDataAsJSON('ExpenseRequests'),
    cashExpenses: fetchSheetDataAsJSON('CashExpenses'),
    maintenanceLog: fetchSheetDataAsJSON('MaintenanceLog'),
    settings: getSettings()
  };
}

function handleGeneratePDF(request, data) {
  try {
    var htmlString = request.html || data.html || data;
    if (!htmlString) {
      return jsonResponse({
        status: 'error',
        message: 'No HTML was supplied for PDF generation.'
      });
    }

    var blob = Utilities
      .newBlob(String(htmlString), MimeType.HTML, 'Facility_Report.html')
      .getAs(MimeType.PDF);

    return jsonResponse({
      status: 'success',
      base64: Utilities.base64Encode(blob.getBytes())
    });
  } catch (err) {
    return jsonResponse({
      status: 'error',
      message: 'Server PDF Error: ' + String(err)
    });
  }
}

// [SECURITY FIX] Restrict file access to main FacilityPro folder only
function getFileBase64Restricted(data) {
  try {
    if (!data.id) throw new Error('Missing Drive file id.');
    var file = DriveApp.getFileById(data.id);

    // Get the main folder from Settings spreadsheet
    var mainFolderName = getMainFolderName();
    if (!mainFolderName) {
      return {
        status: 'error',
        message: 'Main folder not configured in Settings.'
      };
    }

    // Verify file is inside the main FacilityPro folder (or any subfolder within it)
    var isAuthorized = isFileInMainFolder(file, mainFolderName);
    if (!isAuthorized) {
      return {
        status: 'error',
        message: 'Unauthorized file access. File must reside inside the main FacilityPro folder.'
      };
    }

    var blob = file.getBlob();
    return {
      status: 'success',
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: file.getMimeType(),
      name: file.getName()
    };
  } catch (err) {
    return {
      status: 'error',
      message: String(err)
    };
  }
}

// Read mainFolder from Settings sheet
function getMainFolderName() {
  var sheet = getSheet('Settings', false);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === 'mainFolder' && values[i]) {
      return String(values[i]).trim();
    }
  }
  // Fallback to legacy folder name for backward compatibility
  return 'FacilityPro_Attachments';
}

// Check if a file resides inside the main folder or any of its subfolders
function isFileInMainFolder(file, mainFolderName) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    var parent = parents.next();
    if (parent.getName() === mainFolderName) {
      return true;
    }
    // Also check if parent is inside the main folder (recursive subfolder check)
    var grandParents = parent.getParents();
    while (grandParents.hasNext()) {
      if (grandParents.next().getName() === mainFolderName) {
        return true;
      }
    }
  }
  return false;
}

function saveSettings(data) {
  var sheet = getSheet('Settings', true);
  sheet.clear();
  sheet.appendRow(['estateName', 'estateAddress', 'fmName', 'fmAddress', 'logoUrl', 'mainFolder']);
  sheet.appendRow([
    data.estateName || '',
    data.estateAddress || '',
    data.fmName || '',
    data.fmAddress || '',
    data.logoUrl || '',
    data.mainFolder || 'FacilityPro_Attachments'
  ]);

  return {
    status: 'success',
    message: 'Settings synced.'
  };
}

function getSettings() {
  var sheet = getSheet('Settings', false);
  var settings = {
    estateName: '',
    estateAddress: '',
    fmName: '',
    fmAddress: '',
    logoUrl: '',
    mainFolder: 'FacilityPro_Attachments'
  };

  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) {
    return settings;
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];

  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) settings[headers[i]] = String(values[i] || '').trim();
  }

  return settings;
}

function saveRecordDynamically(sheet, data) {
  ensureHeaders(sheet, data);

  var headers = getHeaders(sheet);
  var rowValues = headers.map(function(header) {
    return data[header] !== undefined ? data[header] : '';
  });

  sheet.appendRow(rowValues);
}

function updateRecordDynamically(sheet, data, pkField) {
  if (!pkField) {
    saveRecordDynamically(sheet, data);
    return;
  }

  if (sheet.getLastColumn() === 0 || sheet.getLastRow() < 2) {
    saveRecordDynamically(sheet, data);
    return;
  }

  ensureHeaders(sheet, data);

  var headers = getHeaders(sheet);
  var pkIndex = headers.indexOf(pkField);
  if (pkIndex === -1 || !data[pkField]) {
    saveRecordDynamically(sheet, data);
    return;
  }

  var targetRow = findRowByPrimaryKey(sheet, pkIndex + 1, data[pkField]);

  if (targetRow === -1 && pkField === 'tag' && data.apt && data.type) {
    targetRow = findLegacyAssetRow(sheet, headers, data);
  }

  if (targetRow === -1) {
    saveRecordDynamically(sheet, data);
    return;
  }

  Object.keys(data).forEach(function(key) {
    var colIndex = headers.indexOf(key) + 1;
    if (colIndex > 0) sheet.getRange(targetRow, colIndex).setValue(data[key]);
  });
}

function deleteRecordDynamically(sheet, data, pkField) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return;

  var headers = getHeaders(sheet);
  var pkIndex = headers.indexOf(pkField);
  if (pkIndex === -1 || !data[pkField]) return;

  var targetRow = findRowByPrimaryKey(sheet, pkIndex + 1, data[pkField]);
  if (targetRow !== -1) sheet.deleteRow(targetRow);
}

function executeDriveUploadPipeline(data) {
  try {
    if (!data.base64 || !data.name) {
      throw new Error('Upload requires base64 and name.');
    }

    // Get main folder from Settings, fallback to legacy name
    var mainFolderName = getMainFolderName();
    if (!mainFolderName) {
      mainFolderName = 'FacilityPro_Attachments';
    }

    var folders = DriveApp.getFoldersByName(mainFolderName);
    var targetFolder;
    if (folders.hasNext()) {
      targetFolder = folders.next();
    } else {
      targetFolder = DriveApp.createFolder(mainFolderName);
      // Log the new folder creation in Settings for reference
      Logger.log('Created main folder: ' + mainFolderName);
    }

    targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var parts = data.base64.split(',');
    var base64String = parts.length > 1 ? parts[1] : parts[0];
    var mimeType = inferMimeType(data.name, data.base64);
    var decodedBlob = Utilities.newBlob(
      Utilities.base64Decode(base64String),
      mimeType,
      sanitizeFileName(data.name)
    );

    var file = targetFolder.createFile(decodedBlob);

    return {
      status: 'success',
      url: file.getUrl(),
      id: file.getId()
    };
  } catch (err) {
    return {
      status: 'error',
      message: 'Drive upload failed: ' + String(err)
    };
  }
}

function getStats() {
  return {
    tenancy: fetchSheetDataAsJSON('Apartments').filter(function(a) {
      var status = String(a.status || a.Status || '').toLowerCase();
      var tenant = String(a.tenant || a.Tenant || '').toLowerCase();
      var type = String(a.type || a.Type || '').toLowerCase();
      return status !== 'services' && tenant !== 'services' && type !== 'services';
    }).length,
    asset: fetchSheetDataAsJSON('Assets').filter(function(a) {
      return String(a.status || a.Status || '') !== 'Archived' &&
        String(a.archived || a.Archived || '') !== 'Yes';
    }).length,
    inventory: fetchSheetDataAsJSON('Inventory').filter(function(i) {
      return String(i.archived || i.Archived || '') !== 'Yes';
    }).length,
    maint: fetchSheetDataAsJSON('Maintenance').filter(function(t) {
      return String(t.status || t.Status || '') !== 'Resolved';
    }).length,
    workorders: fetchSheetDataAsJSON('WorkOrders').filter(function(w) {
      return String(w.archived || w.Archived || '') !== 'Yes';
    }).length
  };
}

// ─────────────────────────────────────────────
// [FEATURE] DAILY EMAIL DIGEST
//
// Sends a once-a-day summary email to admins/managers who have an email
// address on file, covering: overdue preventive-maintenance assets,
// Work Orders awaiting approval, and Expense Requests awaiting action.
// This exists so the person responsible doesn't have to remember to
// open the app just to notice something is overdue.
//
// ONE-TIME SETUP (mirrors setApiToken()/setupFirstAdmin() above):
//   1. Give each admin/manager an email via the app's user management
//      (createUser/updateUser — the client doesn't have a "manage
//      users" screen built yet, so for now run updateUserProfile
//      manually from the editor if needed, or extend the app's
//      Settings page to call it).
//   2. Run setupDailyDigestTrigger() ONCE from the Apps Script editor.
//      It's safe to re-run — it clears any existing digest trigger
//      first, so running it twice won't double-send emails.
//   3. Authorize the script for Gmail/MailApp access when prompted.
//   4. To change the send time, edit DIGEST_HOUR below and re-run
//      setupDailyDigestTrigger().
// ─────────────────────────────────────────────
var DIGEST_HOUR = 7; // 24-hour clock, in the script's timezone (Project Settings > Time zone)

function setupDailyDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'sendDailyDigest') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('sendDailyDigest')
    .timeBased()
    .everyDays(1)
    .atHour(DIGEST_HOUR)
    .create();

  Logger.log('Daily digest trigger created — sendDailyDigest will run once a day around ' + DIGEST_HOUR + ':00.');
}

function sendDailyDigest() {
  var recipients = getDigestRecipients();
  if (recipients.length === 0) {
    Logger.log('sendDailyDigest: no admin/manager has an email on file — nothing to send.');
    return;
  }

  var overdueAssets = getOverduePmAssets();
  var pendingWorkOrders = getPendingWorkOrderApprovals();
  var pendingExpenseRequests = getPendingExpenseRequests();

  if (overdueAssets.length === 0 && pendingWorkOrders.length === 0 && pendingExpenseRequests.length === 0) {
    Logger.log('sendDailyDigest: nothing overdue or pending — skipping send.');
    return;
  }

  var settings = getSettings();
  var estateName = settings.estateName || 'Facility Pro';
  var subject = estateName + ' — Daily Digest (' +
    overdueAssets.length + ' overdue, ' +
    pendingWorkOrders.length + ' WO approval' + (pendingWorkOrders.length === 1 ? '' : 's') + ', ' +
    pendingExpenseRequests.length + ' expense request' + (pendingExpenseRequests.length === 1 ? '' : 's') + ')';

  var htmlBody = buildDigestHtml(estateName, overdueAssets, pendingWorkOrders, pendingExpenseRequests);

  recipients.forEach(function (recipient) {
    try {
      MailApp.sendEmail({
        to: recipient.email,
        subject: subject,
        htmlBody: htmlBody
      });
    } catch (err) {
      Logger.log('sendDailyDigest: failed to email ' + recipient.email + ' — ' + String(err));
    }
  });

  Logger.log('sendDailyDigest: sent to ' + recipients.length + ' recipient(s).');
}

function getDigestRecipients() {
  var sheet = getSheet('Users', false);
  if (!sheet) return [];
  return fetchSheetDataAsJSON('Users').filter(function (u) {
    var isActive = u.active === true || String(u.active).toUpperCase() === 'TRUE';
    var isManagerUp = u.role === 'admin' || u.role === 'manager';
    var hasEmail = u.email && String(u.email).indexOf('@') !== -1;
    return isActive && isManagerUp && hasEmail;
  }).map(function (u) {
    return { name: u.name, email: u.email };
  });
}

// Mirrors the client's isAssetOverdue() (Init.js) — same rule (not
// archived, has a nextService date, that date is today or earlier) —
// kept independent rather than shared, since this runs in a completely
// separate execution context (a time trigger, no client involved).
function getOverduePmAssets() {
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  return fetchSheetDataAsJSON('Assets').filter(function (a) {
    if (String(a.status || a.Status || '').toLowerCase() === 'archived') return false;
    if (String(a.archived || a.Archived || '').toLowerCase() === 'yes') return false;

    var raw = a.nextService || a.NextService;
    if (!raw) return false;
    var due = raw instanceof Date ? new Date(raw) : new Date(raw);
    if (isNaN(due.getTime())) return false;
    due.setHours(0, 0, 0, 0);
    return due <= today;
  }).map(function (a) {
    var raw = a.nextService || a.NextService;
    var due = raw instanceof Date ? new Date(raw) : new Date(raw);
    var daysOverdue = Math.floor((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
    return {
      tag: a.tag || a.Tag || '',
      name: a.name || a.Name || a.type || a.Type || 'Asset',
      apt: a.apt || a.Apt || '',
      daysOverdue: daysOverdue
    };
  }).sort(function (a, b) {
    return b.daysOverdue - a.daysOverdue;
  });
}

function getPendingWorkOrderApprovals() {
  return fetchSheetDataAsJSON('WorkOrders').filter(function (w) {
    if (String(w.archived || w.Archived || '') === 'Yes') return false;
    return String(w.status || w.Status || '') === 'Pending Approval';
  }).map(function (w) {
    return {
      workOrderId: w.workOrderId || w.WorkOrderId || '',
      apt: w.apt || w.Apt || '',
      amount: w.amount || w.Amount || 0
    };
  });
}

function getPendingExpenseRequests() {
  return fetchSheetDataAsJSON('ExpenseRequests').map(function (r) {
    return {
      reqId: r.reqId || r.ReqId || '',
      apt: r.apt || r.Apt || '',
      job: r.job || r.Job || '',
      cost: r.cost || r.Cost || 0
    };
  });
}

function buildDigestHtml(estateName, overdueAssets, pendingWorkOrders, pendingExpenseRequests) {
  function section(title, rows, emptyText, rowRenderer) {
    var body = rows.length === 0
      ? '<p style="color:#6c757d; margin:4px 0 16px;">' + emptyText + '</p>'
      : '<table style="width:100%; border-collapse:collapse; margin:4px 0 16px;">' +
          rows.map(rowRenderer).join('') +
        '</table>';
    return '<h3 style="margin:20px 0 4px; font-size:15px;">' + title + '</h3>' + body;
  }

  var overdueSection = section(
    '🔧 Overdue Preventive Maintenance (' + overdueAssets.length + ')',
    overdueAssets,
    'Nothing overdue.',
    function (a) {
      return '<tr style="border-bottom:1px solid #eee;">' +
        '<td style="padding:6px 8px;">' + escapeHtmlForEmail(a.name) + (a.apt ? ' — Unit ' + escapeHtmlForEmail(String(a.apt)) : '') + '</td>' +
        '<td style="padding:6px 8px; color:#cb3b3b; font-weight:bold; text-align:right;">' + a.daysOverdue + ' day' + (a.daysOverdue === 1 ? '' : 's') + ' overdue</td>' +
        '</tr>';
    }
  );

  var woSection = section(
    '📋 Work Orders Awaiting Approval (' + pendingWorkOrders.length + ')',
    pendingWorkOrders,
    'Nothing awaiting approval.',
    function (w) {
      return '<tr style="border-bottom:1px solid #eee;">' +
        '<td style="padding:6px 8px;">' + escapeHtmlForEmail(w.workOrderId) + (w.apt ? ' — Unit ' + escapeHtmlForEmail(String(w.apt)) : '') + '</td>' +
        '<td style="padding:6px 8px; text-align:right;">₦' + Number(w.amount || 0).toLocaleString() + '</td>' +
        '</tr>';
    }
  );

  var expenseSection = section(
    '🧾 Expense Requests Pending (' + pendingExpenseRequests.length + ')',
    pendingExpenseRequests,
    'Nothing pending.',
    function (r) {
      return '<tr style="border-bottom:1px solid #eee;">' +
        '<td style="padding:6px 8px;">' + escapeHtmlForEmail(r.reqId) + (r.apt ? ' — Unit ' + escapeHtmlForEmail(String(r.apt)) : '') + '</td>' +
        '<td style="padding:6px 8px; text-align:right;">₦' + Number(r.cost || 0).toLocaleString() + '</td>' +
        '</tr>';
    }
  );

  return '<div style="font-family:Arial,sans-serif; color:#212529; max-width:600px;">' +
    '<h2 style="margin:0 0 4px;">' + escapeHtmlForEmail(estateName) + ' — Daily Digest</h2>' +
    '<p style="color:#6c757d; margin:0 0 12px; font-size:13px;">' + new Date().toDateString() + '</p>' +
    overdueSection + woSection + expenseSection +
    '<p style="margin-top:24px; font-size:12px; color:#adb5bd;">Automated message from Facility Pro. Open the app for full details.</p>' +
    '</div>';
}

// MailApp.sendEmail's htmlBody isn't escaped automatically the way
// browser innerHTML rendering is — this keeps record data (asset
// names, work order IDs, etc, all of which came through
// sanitizePayload on the way in but are still just plain strings) from
// breaking the email's HTML structure if it ever contains < or >.
function escapeHtmlForEmail(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────
// [FEATURE] SERVICE CHARGE LEDGER
//
// One row per apartment per transaction. A shared expense split across
// N occupied apartments creates N linked rows (same expenseId); a
// contribution or an apartment-specific expense creates exactly one
// row (expenseId === entryId for these).
//
// A given apartment's balance as of any date = the sum of its ledger
// rows dated on or before that date (credits positive, debits
// negative) — computed client-side from the full ledger fetch, not
// stored as a running total anywhere, so there's nothing to keep in
// sync. The "pooled estate balance" is likewise just the sum of every
// apartment's own balance at that moment — there is no separate,
// independently-funded pool ledger by design (see conversation this
// was scoped in): contributions only ever credit individual apartment
// balances, so the pool is a derived total, not its own account.
//
// Only real, occupied apartments (type !== 'services', status ===
// 'Occupied') ever participate in a shared-expense split or hold a
// balance at all — Common Area/Service units and vacant units never
// get their own ledger rows; costs tied to them flow through the
// shared-expense mechanism instead of a direct apartment debit.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// [FEATURE] OCCUPANCY HISTORY
// Automatically populated by the Apartments update/save handling in
// doPost above — never written to directly from a form, so it can't
// drift out of sync with what actually happened to an apartment's
// status. Lets reports answer "was this unit occupied during period
// X" accurately even if its status has since changed, rather than
// only ever knowing "is this unit occupied right now."
// ─────────────────────────────────────────────
function logOccupancyTransition(apt, event, actor) {
  var sheet = getSheet('OccupancyLog', true);
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(['entryId', 'apt', 'event', 'date', 'createdAt', 'createdBy']);
  }
  var entryId = generateNextIdForSheet(sheet, 'entryId', 'OCC');
  var now = new Date().toISOString();
  sheet.appendRow([entryId, apt, event, now, now, (actor && actor.name) || 'unknown']);
}

// [BUG FIX] Mirrors the client's wasApartmentOccupiedDuringPeriod
// (Modals-core.js) but for a single point in time rather than a date
// range — used by logSharedExpense below so that BACKDATING a shared
// expense's date actually uses occupancy as of THAT date, not
// whatever the apartment's live status happens to be at the moment the
// API call runs. Without this, backdating an expense to before a unit
// moved in could still incorrectly charge that unit, if its status was
// already flipped to Occupied ahead of the entered date (e.g. marked
// occupied in the system slightly before the tenant's move-in date).
function wasApartmentOccupiedOnDate(apt, occupancyLog, targetDateStr, currentAptRecord) {
  var events = occupancyLog
    .filter(function (e) { return e && String(e.apt) === String(apt); })
    .map(function (e) { return { event: String(e.event || '').toLowerCase(), date: new Date(e.date) }; })
    .filter(function (e) { return !isNaN(e.date.getTime()); })
    .sort(function (a, b) { return a.date - b.date; });

  if (events.length === 0) {
    // No tracked history for this unit — fall back to its current
    // status, same reasoning as the client-side equivalent.
    return String((currentAptRecord && (currentAptRecord.status || currentAptRecord.Status)) || '').toLowerCase() === 'occupied';
  }

  var target = new Date(targetDateStr);
  var stintStart = null;
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.event === 'occupied' && stintStart === null) {
      stintStart = e.date;
    } else if (e.event === 'vacated' && stintStart !== null) {
      if (stintStart <= target && target < e.date) return true;
      stintStart = null;
    }
  }
  // Still occupied with no later "vacated" event — the stint is
  // ongoing, so it covers the target date if it started on or before it.
  if (stintStart !== null && stintStart <= target) return true;

  return false;
}

// [BUG FIX] entryNumber deliberately sits at the END of this list, not
// inserted in the middle where it was originally added. Inserting a
// column in the middle only works correctly for a brand-new, empty
// sheet — for a sheet that already had rows (like this one did),
// ensureServiceChargeLedgerHeaders below only ever wrote headers once,
// on an empty sheet, so an EXISTING sheet's header row never picked up
// the new column at all. Every subsequent row still got written using
// this NEW column order though, silently shifting every value from
// 'apt' onward one column to the right relative to the sheet's actual
// (unmigrated) header row. Putting new columns at the end means
// extending an existing sheet's headers is always a pure append —
// nothing already there ever shifts.
var SERVICE_CHARGE_LEDGER_HEADERS = [
  'entryId', 'expenseId', 'apt', 'date', 'type', 'category',
  'description', 'amount', 'direction', 'createdAt', 'createdBy',
  'updatedAt', 'updatedBy', 'entryNumber'
];

// [FEATURE] Human-readable entry number (yy/mm/NNN), scoped to the
// calendar month of the TRANSACTION's own date — not when it was
// logged — so a backdated entry gets a number matching the period it
// actually belongs to, consistent with standard accounting practice.
// All rows belonging to one shared expense (same expenseId) share the
// SAME entry number, since they're one logical transaction split
// across apartments, not N separate ones.
// [CHANGE] Format is now mm-NNN (e.g. "08-001"), no year — the
// previous yy/mm/NNN format ("26/08/001") looked enough like a date
// that Google Sheets' auto-detection kept silently converting it to an
// actual date value, corrupting the column. A plain hyphenated
// mm-NNN string doesn't trigger that.
//
// Dropping the year from the DISPLAYED number means we can no longer
// tell two Augusts apart just by reading a past entryNumber's prefix
// back — so the monthly counter now resets by checking each existing
// row's actual `date` column against the target month/year, not by
// parsing prior entryNumber strings. This is what correctly makes
// count restart at 001 every new month, including across a year
// boundary, without ever colliding two different Augusts a year apart.
function generateNextServiceChargeEntryNumber(sheet, dateStr) {
  var d = new Date(dateStr);
  var targetYear = d.getFullYear();
  var targetMonth = d.getMonth();
  var mm = String(targetMonth + 1).padStart(2, '0');

  var maxNum = 0;
  if (sheet.getLastRow() > 1) {
    var headers = getHeaders(sheet);
    var dateIndex = headers.indexOf('date');
    var entryNumIndex = headers.indexOf('entryNumber');
    if (dateIndex !== -1 && entryNumIndex !== -1) {
      var lastCol = Math.max(dateIndex, entryNumIndex) + 1;
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      values.forEach(function (row) {
        var rowDate = new Date(row[dateIndex]);
        if (isNaN(rowDate.getTime())) return;
        if (rowDate.getFullYear() !== targetYear || rowDate.getMonth() !== targetMonth) return;
        var val = String(row[entryNumIndex] || '');
        var parts = val.split('-');
        var n = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      });
    }
  }
  return mm + '-' + String(maxNum + 1).padStart(3, '0');
}

// [BUG FIX] Was: `if (sheet.getLastColumn() === 0) { appendRow(...); }`
// — only ever wrote headers on a completely empty sheet. For a sheet
// that already had data (this one did, from before entryNumber was
// added), that meant new schema columns were NEVER added to the
// header row at all, while rows kept being WRITTEN using the new
// column order — silently misaligning every column after the
// insertion point. Mirrors the app's existing generic ensureHeaders()
// pattern: migrate a populated sheet by appending any missing columns,
// only fall back to writing the whole header row from scratch if the
// sheet is genuinely empty.
function ensureServiceChargeLedgerHeaders(sheet) {
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(SERVICE_CHARGE_LEDGER_HEADERS);
    return;
  }
  var headers = getHeaders(sheet);
  SERVICE_CHARGE_LEDGER_HEADERS.forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
    }
  });
}

// [BUG FIX] A plain "YYYY-MM-DD" string — exactly what an HTML date
// input sends — is parsed as UTC MIDNIGHT per the JS/ECMAScript date
// spec, and Google Sheets applies the same interpretation when it
// auto-converts a date-like string written into a cell. Depending on
// the spreadsheet's configured timezone, that UTC-midnight instant can
// display as the PREVIOUS calendar day once rendered — exactly the
// "entry date is today but saved as yesterday" symptom this fixes.
// Explicitly building the Date from its own year/month/day components
// (which the Date constructor treats as LOCAL time, not UTC) avoids
// that ambiguity entirely — the stored date always matches exactly
// what was typed, regardless of the spreadsheet's timezone setting.
function parseDateOnlyLocal(dateStr) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!match) return dateStr;
  return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
}

function isSameCalendarDay(isoString) {
  if (!isoString) return false;
  var d = new Date(isoString);
  var now = new Date();
  if (isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function logContribution(data, actor) {
  var apt = String(data.apt || '').trim();
  var amount = parseFloat(data.amount);
  if (!apt || !amount || amount <= 0) {
    return { status: 'error', message: 'Apartment and a positive amount are required.' };
  }

  var sheet = getSheet('ServiceChargeLedger', true);
  ensureServiceChargeLedgerHeaders(sheet);
  var entryId = generateNextIdForSheet(sheet, 'entryId', 'SCL');
  var entryDate = data.date ? parseDateOnlyLocal(data.date) : new Date();
  var entryNumber = generateNextServiceChargeEntryNumber(sheet, entryDate);
  var now = new Date().toISOString();

  sheet.appendRow(SERVICE_CHARGE_LEDGER_HEADERS.map(function (h) {
    var row = {
      entryId: entryId, expenseId: entryId, entryNumber: entryNumber, apt: apt, date: entryDate,
      type: 'contribution', category: 'Contribution',
      description: sanitizePayload({ d: data.description || '' }).d,
      amount: amount, direction: 'credit',
      createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  return { status: 'success', entryId: entryId };
}

function logApartmentExpense(data, actor) {
  var apt = String(data.apt || '').trim();
  var amount = parseFloat(data.amount);
  var category = sanitizePayload({ c: data.category || 'Expense' }).c;
  if (!apt || !amount || amount <= 0) {
    return { status: 'error', message: 'Apartment and a positive amount are required.' };
  }

  var sheet = getSheet('ServiceChargeLedger', true);
  ensureServiceChargeLedgerHeaders(sheet);
  var entryId = generateNextIdForSheet(sheet, 'entryId', 'SCL');
  var entryDate = data.date ? parseDateOnlyLocal(data.date) : new Date();
  var entryNumber = generateNextServiceChargeEntryNumber(sheet, entryDate);
  var now = new Date().toISOString();

  sheet.appendRow(SERVICE_CHARGE_LEDGER_HEADERS.map(function (h) {
    var row = {
      entryId: entryId, expenseId: entryId, entryNumber: entryNumber, apt: apt, date: entryDate,
      type: 'apartment_expense', category: category,
      description: sanitizePayload({ d: data.description || '' }).d,
      amount: amount, direction: 'debit',
      createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  // [FEATURE] Optional link to Petty Cash — when the "pay from petty
  // cash" checkbox is ticked on this form, also record a matching
  // outflow there. The Service Charge debit above is unaffected either
  // way; this just additionally tracks that the cash itself came out
  // of the physical petty cash fund. Best-effort: if this fails for
  // any reason, the Service Charge entry above has already succeeded
  // and stays valid — a Petty Cash hiccup shouldn't block logging the
  // expense itself.
  if (data.fromPettyCash) {
    try {
      appendPettyCashEntry(
        'outflow',
        { amount: amount, category: category, description: 'Service Charge ' + entryNumber + ': ' + (data.description || category), date: entryDate, apt: apt },
        actor,
        entryNumber
      );
    } catch (e) {
      Logger.log('Petty Cash link failed for Service Charge entry ' + entryNumber + ': ' + String(e));
    }
  }

  return { status: 'success', entryId: entryId };
}

// [FEATURE] Default weight-by-type ratios (Studio : 1-Bedroom :
// 2-Bedroom = 1 : 1.25 : 1.5) — used only when an apartment doesn't
// have its own custom weight set. A manually-set weight (the "weight"
// field on the apartment record) always takes priority over this; this
// is purely the fallback for units nobody has explicitly configured
// yet. Matched by substring rather than exact string equality since
// apartment "type" values are free text ("1-Bedroom", "1 Bedroom",
// "1BR" etc could all reasonably appear) — order matters below since
// a 2-bedroom type string could otherwise also match the "1" check.
function getDefaultWeightForType(type) {
  var t = String(type || '').toLowerCase();
  if (t.indexOf('studio') !== -1) return 1;
  if (t.indexOf('2') !== -1 && t.indexOf('bed') !== -1) return 1.5;
  if (t.indexOf('1') !== -1 && t.indexOf('bed') !== -1) return 1.25;
  return 1;
}

function logSharedExpense(data, actor) {
  var amount = parseFloat(data.amount);
  var category = sanitizePayload({ c: data.category || 'Shared Expense' }).c;
  var description = sanitizePayload({ d: data.description || '' }).d;
  if (!amount || amount <= 0) {
    return { status: 'error', message: 'A positive amount is required.' };
  }

  var expenseDate = data.date ? parseDateOnlyLocal(data.date) : new Date();
  var occupancyLog = fetchSheetDataAsJSON('OccupancyLog');

  var occupiedApts = fetchSheetDataAsJSON('Apartments').filter(function (a) {
    var type = String(a.type || a.Type || '').toLowerCase();
    if (type === 'services') return false;
    return wasApartmentOccupiedOnDate(a.apt || a.Apt, occupancyLog, expenseDate, a);
  });

  if (occupiedApts.length === 0) {
    return { status: 'error', message: 'No occupied apartments to split this expense across.' };
  }

  var totalWeight = occupiedApts.reduce(function (sum, a) {
    var w = parseFloat(a.weight || a.Weight);
    return sum + (isNaN(w) || w <= 0 ? getDefaultWeightForType(a.type || a.Type) : w);
  }, 0);

  var sheet = getSheet('ServiceChargeLedger', true);
  ensureServiceChargeLedgerHeaders(sheet);

  var expenseId = generateNextIdForSheet(sheet, 'expenseId', 'SCE');
  var entryNumber = generateNextServiceChargeEntryNumber(sheet, expenseDate);
  var startId = generateNextIdForSheet(sheet, 'entryId', 'SCL');
  var startNum = parseInt(startId.split('-')[1], 10);

  var now = new Date().toISOString();
  var rows = [];
  var splits = [];

  occupiedApts.forEach(function (a, i) {
    var w = parseFloat(a.weight || a.Weight);
    if (isNaN(w) || w <= 0) w = getDefaultWeightForType(a.type || a.Type);
    var share = Math.round(amount * (w / totalWeight) * 100) / 100;
    var entryId = 'SCL-' + String(startNum + i).padStart(4, '0');
    var aptId = a.apt || a.Apt;

    rows.push(SERVICE_CHARGE_LEDGER_HEADERS.map(function (h) {
      var row = {
        entryId: entryId, expenseId: expenseId, entryNumber: entryNumber, apt: aptId, date: expenseDate,
        type: 'shared_expense', category: category, description: description,
        amount: share, direction: 'debit',
        createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name
      };
      return row[h] !== undefined ? row[h] : '';
    }));
    splits.push({ apt: aptId, share: share });
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SERVICE_CHARGE_LEDGER_HEADERS.length).setValues(rows);

  // [FEATURE] Optional link to Petty Cash — the TOTAL shared amount
  // becomes one outflow entry (not each apartment's individual share;
  // Petty Cash tracks actual cash movement, not how it's internally
  // allocated). Apt left blank since this covers multiple units. Same
  // best-effort handling as logApartmentExpense above.
  if (data.fromPettyCash) {
    try {
      appendPettyCashEntry(
        'outflow',
        { amount: amount, category: category, description: 'Service Charge ' + entryNumber + ' (shared, ' + splits.length + ' apts): ' + (description || category), date: expenseDate, apt: 'Shared (' + splits.length + ' apt' + (splits.length === 1 ? '' : 's') + ')' },
        actor,
        entryNumber
      );
    } catch (e) {
      Logger.log('Petty Cash link failed for Service Charge entry ' + entryNumber + ': ' + String(e));
    }
  }

  return { status: 'success', expenseId: expenseId, splits: splits };
}

function updateServiceChargeEntry(data, actor) {
  var entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };

  var sheet = getSheet('ServiceChargeLedger', false);
  if (!sheet) return { status: 'error', message: 'No ledger entries found.' };

  var existing = findRecordByPK(sheet, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };

  if (existing.type === 'shared_expense') {
    return {
      status: 'error',
      message: "Shared-expense entries can't be edited directly — delete and re-log the expense instead, so the split recalculates correctly."
    };
  }

  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'This entry can only be edited on the day it was created.' };
  }

  var update = { entryId: entryId, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  if (data.amount !== undefined) {
    var amt = parseFloat(data.amount);
    if (!amt || amt <= 0) return { status: 'error', message: 'Amount must be positive.' };
    update.amount = amt;
  }
  if (data.date !== undefined) update.date = data.date;
  if (data.category !== undefined) update.category = sanitizePayload({ c: data.category }).c;
  if (data.description !== undefined) update.description = sanitizePayload({ d: data.description }).d;

  updateRecordDynamically(sheet, update, 'entryId');
  return { status: 'success' };
}

function deleteServiceChargeEntry(data, actor) {
  var entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };

  var sheet = getSheet('ServiceChargeLedger', false);
  if (!sheet) return { status: 'error', message: 'No ledger entries found.' };

  var existing = findRecordByPK(sheet, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };

  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'This entry can only be deleted on the day it was created.' };
  }

  // A shared expense is really N linked rows sharing one expenseId —
  // delete all of them together so the split can never end up
  // half-reversed (some apartments' shares gone, others still debited).
  var idsToDelete = [entryId];
  if (existing.type === 'shared_expense' && existing.expenseId) {
    idsToDelete = fetchSheetDataAsJSON('ServiceChargeLedger')
      .filter(function (r) { return r.expenseId === existing.expenseId; })
      .map(function (r) { return r.entryId; });
  }

  idsToDelete.forEach(function (id) {
    deleteRecordDynamically(sheet, { entryId: id }, 'entryId');
  });

  return { status: 'success', deletedCount: idsToDelete.length };
}

// ─────────────────────────────────────────────
// [FEATURE] PETTY CASH
// Independent of the Service Charge ledger and the older CashExpenses
// sheet (untouched, deliberately not merged) — its own sheet, its own
// running balance, its own manager+ access gate. A Service Charge
// Apartment/Shared Expense can optionally also create a linked Petty
// Cash outflow (see logApartmentExpense/logSharedExpense below) when
// its "pay from petty cash" checkbox is ticked — that's the only
// point of contact between the two systems.
// ─────────────────────────────────────────────
var PETTY_CASH_HEADERS = [
  'entryId', 'direction', 'apt', 'date', 'category', 'description',
  'amount', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  'linkedServiceChargeEntry'
];

function ensurePettyCashHeaders(sheet) {
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(PETTY_CASH_HEADERS);
    return;
  }
  var headers = getHeaders(sheet);
  PETTY_CASH_HEADERS.forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
    }
  });
}

// Shared by the public logPettyCashInflow/logPettyCashOutflow actions
// AND the auto-linked entry created from a Service Charge expense —
// one place building a Petty Cash row so both paths can't drift apart.
function appendPettyCashEntry(direction, data, actor, linkedEntry) {
  var amount = parseFloat(data.amount);
  if (!amount || amount <= 0) {
    return { status: 'error', message: 'A positive amount is required.' };
  }

  var sheet = getSheet('PettyCash', true);
  ensurePettyCashHeaders(sheet);
  var entryId = generateNextIdForSheet(sheet, 'entryId', 'PC');
  var now = new Date().toISOString();
  var category = sanitizePayload({ c: data.category || (direction === 'inflow' ? 'Inflow' : 'Outflow') }).c;

  sheet.appendRow(PETTY_CASH_HEADERS.map(function (h) {
    var row = {
      entryId: entryId, direction: direction, apt: String(data.apt || '').trim(),
      date: data.date ? parseDateOnlyLocal(data.date) : now, category: category,
      description: sanitizePayload({ d: data.description || '' }).d,
      amount: amount, createdAt: now, createdBy: actor.name,
      updatedAt: now, updatedBy: actor.name,
      linkedServiceChargeEntry: linkedEntry || ''
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  return { status: 'success', entryId: entryId };
}

function logPettyCashInflow(data, actor) {
  return appendPettyCashEntry('inflow', data, actor);
}

function logPettyCashOutflow(data, actor) {
  return appendPettyCashEntry('outflow', data, actor);
}

function updatePettyCashEntry(data, actor) {
  var entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };

  var sheet = getSheet('PettyCash', false);
  if (!sheet) return { status: 'error', message: 'No entries found.' };

  var existing = findRecordByPK(sheet, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };

  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'This entry can only be edited on the day it was created.' };
  }

  var update = { entryId: entryId, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  if (data.amount !== undefined) {
    var amt = parseFloat(data.amount);
    if (!amt || amt <= 0) return { status: 'error', message: 'Amount must be positive.' };
    update.amount = amt;
  }
  if (data.date !== undefined) update.date = data.date;
  if (data.category !== undefined) update.category = sanitizePayload({ c: data.category }).c;
  if (data.description !== undefined) update.description = sanitizePayload({ d: data.description }).d;
  if (data.apt !== undefined) update.apt = String(data.apt || '').trim();

  updateRecordDynamically(sheet, update, 'entryId');
  return { status: 'success' };
}

function deletePettyCashEntry(data, actor) {
  var entryId = String(data.entryId || '').trim();
  if (!entryId) return { status: 'error', message: 'Missing entryId.' };

  var sheet = getSheet('PettyCash', false);
  if (!sheet) return { status: 'error', message: 'No entries found.' };

  var existing = findRecordByPK(sheet, 'entryId', entryId);
  if (!existing) return { status: 'error', message: 'Entry not found.' };

  if (!isSameCalendarDay(existing.createdAt)) {
    return { status: 'error', message: 'This entry can only be deleted on the day it was created.' };
  }

  deleteRecordDynamically(sheet, { entryId: entryId }, 'entryId');
  return { status: 'success' };
}

// ─────────────────────────────────────────────
// [FEATURE] INVENTORY MODULE — full replacement of the old basic
// Inventory feature (that sheet is left untouched but no longer read
// by the app; this is a clean start, not a migration). Manager+ only
// for everything, same access model as Service Charge/Petty Cash —
// not part of getAllData, fetched lazily only when a manager+ user
// opens the section.
//
// Same module covers both consumables (stock that gets used up and
// reordered) and tools/equipment (durable items with a custodian) —
// distinguished by itemType, not a separate sheet.
//
// Costing is weighted-average: every stock receipt blends the new
// purchase price into the item's running unitCost, rather than just
// overwriting it — see receiveStock().
//
// Issuing stock is where this connects to Service Charge: it is
// ALWAYS automatic (no checkbox, no opt-out) — issuing to a specific
// apartment debits that apartment directly; issuing to a shared/common
// area splits the cost by weight across occupied units, reusing the
// exact same logSharedExpense/logApartmentExpense functions a manually
// logged Service Charge expense would use.
// ─────────────────────────────────────────────
var INVENTORY_ITEM_HEADERS = [
  'itemCode', 'name', 'category', 'subCategory', 'unit', 'currentQty',
  'minQty', 'reorderQty', 'reorderLevel', 'unitCost', 'lastPurchasePrice',
  'specification', 'photoUrl', 'itemType', 'status', 'preferredSupplier',
  'leadTimeDays', 'assetNumber', 'location', 'custodian', 'condition',
  'purchaseDate', 'calibrationDue', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
];

var INVENTORY_MOVEMENT_HEADERS = [
  'entryId', 'itemCode', 'movementType', 'date', 'quantity', 'unitCostAtTime',
  'totalValue', 'apt', 'department', 'purpose', 'maintenanceTicket', 'recipient',
  'authorizedBy', 'deliveryNote', 'invoiceRef', 'reason', 'linkedServiceChargeEntry',
  'createdAt', 'createdBy'
];

function ensureInventorySheetHeaders(sheet, headerList) {
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(headerList);
    return;
  }
  var headers = getHeaders(sheet);
  headerList.forEach(function (h) {
    if (headers.indexOf(h) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(h);
      headers.push(h);
    }
  });
}

// Item codes are prefixed by category (e.g. "Plumbing" → "PLB-001"),
// matching the example in the original spec, with a per-prefix
// sequential counter scanning existing codes for that prefix only.
function generateNextItemCode(sheet, category) {
  var prefix = String(category || 'GEN').trim().substring(0, 3).toUpperCase() || 'GEN';
  var maxNum = 0;
  if (sheet.getLastRow() > 1) {
    var headers = getHeaders(sheet);
    var codeIndex = headers.indexOf('itemCode');
    if (codeIndex !== -1) {
      var values = sheet.getRange(2, codeIndex + 1, sheet.getLastRow() - 1, 1).getValues();
      values.forEach(function (row) {
        var raw = String(row[0] || '');
        if (raw.indexOf(prefix + '-') === 0) {
          var n = parseInt(raw.split('-')[1], 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        }
      });
    }
  }
  return prefix + '-' + String(maxNum + 1).padStart(3, '0');
}

function saveInventoryItem(data, actor) {
  var name = sanitizePayload({ n: data.name || '' }).n;
  if (!name) return { status: 'error', message: 'Item name is required.' };

  var sheet = getSheet('InventoryItems', true);
  ensureInventorySheetHeaders(sheet, INVENTORY_ITEM_HEADERS);
  var category = sanitizePayload({ c: data.category || '' }).c;
  var itemCode = generateNextItemCode(sheet, category);
  var now = new Date().toISOString();
  var startingCost = parseFloat(data.unitCost) || 0;

  sheet.appendRow(INVENTORY_ITEM_HEADERS.map(function (h) {
    var row = {
      itemCode: itemCode, name: name, category: category,
      subCategory: sanitizePayload({ s: data.subCategory || '' }).s,
      unit: sanitizePayload({ u: data.unit || '' }).u,
      currentQty: parseFloat(data.currentQty) || 0,
      minQty: parseFloat(data.minQty) || 0,
      reorderQty: parseFloat(data.reorderQty) || 0,
      reorderLevel: parseFloat(data.reorderLevel) || 0,
      unitCost: startingCost,
      lastPurchasePrice: startingCost,
      specification: sanitizePayload({ s: data.specification || '' }).s,
      photoUrl: data.photoUrl || '',
      itemType: data.itemType === 'tool' ? 'tool' : 'consumable',
      status: data.status || 'Active',
      preferredSupplier: sanitizePayload({ p: data.preferredSupplier || '' }).p,
      leadTimeDays: parseFloat(data.leadTimeDays) || 0,
      assetNumber: sanitizePayload({ a: data.assetNumber || '' }).a,
      location: sanitizePayload({ l: data.location || '' }).l,
      custodian: sanitizePayload({ c: data.custodian || '' }).c,
      condition: sanitizePayload({ c: data.condition || '' }).c,
      purchaseDate: data.purchaseDate ? parseDateOnlyLocal(data.purchaseDate) : '',
      calibrationDue: data.calibrationDue ? parseDateOnlyLocal(data.calibrationDue) : '',
      createdAt: now, createdBy: actor.name, updatedAt: now, updatedBy: actor.name
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  return { status: 'success', itemCode: itemCode };
}

function updateInventoryItem(data, actor) {
  var itemCode = String(data.itemCode || '').trim();
  if (!itemCode) return { status: 'error', message: 'Missing itemCode.' };
  var sheet = getSheet('InventoryItems', false);
  if (!sheet) return { status: 'error', message: 'Inventory sheet not found.' };

  // Quantity is deliberately NOT editable here — it only ever changes
  // via receiveStock/issueStock/adjustStock, so every quantity change
  // always has a corresponding InventoryMovements record explaining it.
  var update = { itemCode: itemCode, updatedAt: new Date().toISOString(), updatedBy: actor.name };
  var textFields = ['name', 'category', 'subCategory', 'unit', 'specification', 'photoUrl',
    'itemType', 'status', 'preferredSupplier', 'assetNumber', 'location', 'custodian', 'condition'];
  textFields.forEach(function (f) {
    if (data[f] !== undefined) update[f] = sanitizePayload({ v: data[f] }).v;
  });
  var numericFields = ['minQty', 'reorderQty', 'reorderLevel', 'leadTimeDays'];
  numericFields.forEach(function (f) {
    if (data[f] !== undefined) update[f] = parseFloat(data[f]) || 0;
  });
  if (data.purchaseDate !== undefined) update.purchaseDate = data.purchaseDate ? parseDateOnlyLocal(data.purchaseDate) : '';
  if (data.calibrationDue !== undefined) update.calibrationDue = data.calibrationDue ? parseDateOnlyLocal(data.calibrationDue) : '';

  updateRecordDynamically(sheet, update, 'itemCode');
  return { status: 'success' };
}

function receiveStock(data, actor) {
  var itemCode = String(data.itemCode || '').trim();
  var qty = parseFloat(data.quantity);
  if (!itemCode || !qty || qty <= 0) {
    return { status: 'error', message: 'Item and a positive quantity are required.' };
  }
  var unitCost = parseFloat(data.unitCost);
  if (isNaN(unitCost) || unitCost < 0) unitCost = 0;

  var itemSheet = getSheet('InventoryItems', false);
  if (!itemSheet) return { status: 'error', message: 'Inventory sheet not found.' };
  var item = findRecordByPK(itemSheet, 'itemCode', itemCode);
  if (!item) return { status: 'error', message: 'Item not found.' };

  var oldQty = parseFloat(item.currentQty) || 0;
  var oldCost = parseFloat(item.unitCost) || 0;
  var newQty = oldQty + qty;
  // Weighted-average cost: blends the existing valuation with this
  // receipt's price, rather than overwriting with just the latest
  // purchase price.
  var newAvgCost = newQty > 0 ? ((oldQty * oldCost) + (qty * unitCost)) / newQty : unitCost;
  newAvgCost = Math.round(newAvgCost * 100) / 100;

  updateRecordDynamically(itemSheet, {
    itemCode: itemCode,
    currentQty: newQty,
    unitCost: newAvgCost,
    lastPurchasePrice: unitCost,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name
  }, 'itemCode');

  var moveSheet = getSheet('InventoryMovements', true);
  ensureInventorySheetHeaders(moveSheet, INVENTORY_MOVEMENT_HEADERS);
  var entryId = generateNextIdForSheet(moveSheet, 'entryId', 'IM');
  var now = new Date().toISOString();
  var moveDate = data.date ? parseDateOnlyLocal(data.date) : new Date();

  moveSheet.appendRow(INVENTORY_MOVEMENT_HEADERS.map(function (h) {
    var row = {
      entryId: entryId, itemCode: itemCode, movementType: 'receive', date: moveDate,
      quantity: qty, unitCostAtTime: unitCost, totalValue: Math.round(qty * unitCost * 100) / 100,
      deliveryNote: sanitizePayload({ d: data.deliveryNote || '' }).d,
      invoiceRef: sanitizePayload({ i: data.invoiceRef || '' }).i,
      recipient: sanitizePayload({ r: data.personReceiving || '' }).r,
      createdAt: now, createdBy: actor.name
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  return { status: 'success', entryId: entryId, newQty: newQty, newUnitCost: newAvgCost };
}

function issueStock(data, actor) {
  var itemCode = String(data.itemCode || '').trim();
  var qty = parseFloat(data.quantity);
  if (!itemCode || !qty || qty <= 0) {
    return { status: 'error', message: 'Item and a positive quantity are required.' };
  }

  var itemSheet = getSheet('InventoryItems', false);
  if (!itemSheet) return { status: 'error', message: 'Inventory sheet not found.' };
  var item = findRecordByPK(itemSheet, 'itemCode', itemCode);
  if (!item) return { status: 'error', message: 'Item not found.' };

  var oldQty = parseFloat(item.currentQty) || 0;
  if (qty > oldQty) {
    return {
      status: 'error',
      message: 'Cannot issue more than the current stock (' + oldQty + ' ' + (item.unit || '') + ' available).'
    };
  }
  var unitCost = parseFloat(item.unitCost) || 0;
  var totalValue = Math.round(qty * unitCost * 100) / 100;
  var newQty = oldQty - qty;

  updateRecordDynamically(itemSheet, {
    itemCode: itemCode, currentQty: newQty,
    updatedAt: new Date().toISOString(), updatedBy: actor.name
  }, 'itemCode');

  var apt = String(data.apt || '').trim();
  var isShared = !apt || apt.toLowerCase() === 'shared';
  var moveDate = data.date ? parseDateOnlyLocal(data.date) : new Date();

  var scResult = null;
  if (totalValue > 0) {
    var scCategory = 'Inventory: ' + (item.name || itemCode);
    var scDescription = qty + ' ' + (item.unit || '') + ' issued' + (data.purpose ? ' — ' + data.purpose : '');
    if (isShared) {
      scResult = logSharedExpense({
        amount: totalValue, category: scCategory, description: scDescription, date: moveDate
      }, actor);
    } else {
      scResult = logApartmentExpense({
        apt: apt, amount: totalValue, category: scCategory, description: scDescription, date: moveDate
      }, actor);
    }
  }

  var moveSheet = getSheet('InventoryMovements', true);
  ensureInventorySheetHeaders(moveSheet, INVENTORY_MOVEMENT_HEADERS);
  var entryId = generateNextIdForSheet(moveSheet, 'entryId', 'IM');
  var now = new Date().toISOString();
  var linkedEntry = (scResult && scResult.status === 'success')
    ? (scResult.entryId || scResult.expenseId || '')
    : '';

  moveSheet.appendRow(INVENTORY_MOVEMENT_HEADERS.map(function (h) {
    var row = {
      entryId: entryId, itemCode: itemCode, movementType: 'issue', date: moveDate,
      quantity: -qty, unitCostAtTime: unitCost, totalValue: -totalValue,
      apt: isShared ? 'Shared' : apt,
      department: sanitizePayload({ d: data.department || '' }).d,
      purpose: sanitizePayload({ p: data.purpose || '' }).p,
      maintenanceTicket: sanitizePayload({ t: data.maintenanceTicket || '' }).t,
      recipient: sanitizePayload({ r: data.recipient || '' }).r,
      authorizedBy: actor.name,
      linkedServiceChargeEntry: linkedEntry,
      createdAt: now, createdBy: actor.name
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  return {
    status: 'success', entryId: entryId, newQty: newQty,
    serviceChargeLinked: !!linkedEntry,
    serviceChargeWarning: (scResult && scResult.status !== 'success') ? scResult.message : null
  };
}

function adjustStock(data, actor) {
  var itemCode = String(data.itemCode || '').trim();
  var qtyDelta = parseFloat(data.quantityDelta);
  if (!itemCode || !qtyDelta) {
    return { status: 'error', message: 'Item and a non-zero quantity adjustment are required.' };
  }
  var reason = sanitizePayload({ r: data.reason || 'Correction' }).r;

  var itemSheet = getSheet('InventoryItems', false);
  if (!itemSheet) return { status: 'error', message: 'Inventory sheet not found.' };
  var item = findRecordByPK(itemSheet, 'itemCode', itemCode);
  if (!item) return { status: 'error', message: 'Item not found.' };

  var oldQty = parseFloat(item.currentQty) || 0;
  var newQty = oldQty + qtyDelta;
  if (newQty < 0) {
    return { status: 'error', message: 'This adjustment would take stock below zero.' };
  }
  var unitCost = parseFloat(item.unitCost) || 0;

  updateRecordDynamically(itemSheet, {
    itemCode: itemCode, currentQty: newQty,
    updatedAt: new Date().toISOString(), updatedBy: actor.name
  }, 'itemCode');

  var moveSheet = getSheet('InventoryMovements', true);
  ensureInventorySheetHeaders(moveSheet, INVENTORY_MOVEMENT_HEADERS);
  var entryId = generateNextIdForSheet(moveSheet, 'entryId', 'IM');
  var now = new Date().toISOString();
  var moveDate = data.date ? parseDateOnlyLocal(data.date) : new Date();

  moveSheet.appendRow(INVENTORY_MOVEMENT_HEADERS.map(function (h) {
    var row = {
      entryId: entryId, itemCode: itemCode, movementType: 'adjustment', date: moveDate,
      quantity: qtyDelta, unitCostAtTime: unitCost, totalValue: Math.round(qtyDelta * unitCost * 100) / 100,
      reason: reason, authorizedBy: actor.name,
      createdAt: now, createdBy: actor.name
    };
    return row[h] !== undefined ? row[h] : '';
  }));

  return { status: 'success', entryId: entryId, newQty: newQty };
}

function fetchSheetDataAsJSON(sheetName) {
  var sheet = getSheet(sheetName, false);
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return [];

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var hasValue = false;

    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      if (!key) continue;
      var val = data[i][j];
      // [BUG FIX] A genuinely date-typed cell (as opposed to a plain
      // text string) is a JS Date object here. Storing it as-is means
      // JSON.stringify later converts it to UTC when building the
      // response — for Lagos (UTC+1), local midnight becomes
      // 23:00 the PREVIOUS day once serialized, and any client code
      // that reads just the date portion of that string displays the
      // wrong calendar day entirely, despite the sheet cell itself
      // being completely correct. Explicitly formatting using Lagos
      // wall-clock time before it ever reaches JSON.stringify avoids
      // that UTC round-trip entirely — this affects every date field
      // read through this one function, not just Service Charge.
      if (val instanceof Date) {
        val = Utilities.formatDate(val, 'Africa/Lagos', "yyyy-MM-dd'T'HH:mm:ss");
      }
      obj[key] = val;
      if (data[i][j] !== '' && data[i][j] !== null) hasValue = true;
    }

    if (hasValue) result.push(obj);
  }

  return result;
}

function ensureHeaders(sheet, data) {
  var keys = Object.keys(data || {});

  if (sheet.getLastColumn() === 0) {
    if (keys.length) sheet.getRange(1, 1, 1, keys.length).setValues([keys]);
    return;
  }

  var headers = getHeaders(sheet);
  keys.forEach(function(key) {
    if (headers.indexOf(key) === -1) {
      sheet.getRange(1, headers.length + 1).setValue(key);
      headers.push(key);
    }
  });
}

function getHeaders(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function findRowByPrimaryKey(sheet, pkColumn, pkValue) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var values = sheet.getRange(2, pkColumn, lastRow - 1, 1).getValues();
  var needle = String(pkValue).trim();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === needle) return i + 2;
  }

  return -1;
}

function findLegacyAssetRow(sheet, headers, data) {
  var aptIndex = headers.indexOf('apt');
  var typeIndex = headers.indexOf('type');
  var tagIndex = headers.indexOf('tag');

  if (aptIndex === -1 || typeIndex === -1 || tagIndex === -1) return -1;

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  for (var i = 0; i < rows.length; i++) {
    if ((rows[i][tagIndex] === '' || rows[i][tagIndex] === undefined) &&
        String(rows[i][aptIndex]).trim() === String(data.apt).trim() &&
        String(rows[i][typeIndex]).trim() === String(data.type).trim()) {
      return i + 2;
    }
  }

  return -1;
}

// [HELPER] Find full record by PK for business logic checks
function findRecordByPK(sheet, pkField, pkValue) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  var headers = getHeaders(sheet);
  var pkIndex = headers.indexOf(pkField);
  if (pkIndex === -1) return null;
  var rowNum = findRowByPrimaryKey(sheet, pkIndex + 1, pkValue);
  if (rowNum === -1) return null;
  var rowValues = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) obj[headers[i]] = rowValues[i];
  }
  return obj;
}

function getSheet(sheetName, createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(sheetName);
  }

  return sheet;
}

function inferMimeType(fileName, base64Data) {
  var lower = String(fileName || '').toLowerCase();

  if (lower.indexOf('.pdf') !== -1 || lower.indexOf('pdf_') === 0) {
    return 'application/pdf';
  }

  if (String(base64Data || '').indexOf('data:image/png') === 0 || lower.indexOf('.png') !== -1) {
    return 'image/png';
  }

  return 'image/jpeg';
}

function sanitizeFileName(fileName) {
  return String(fileName || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 120);
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}