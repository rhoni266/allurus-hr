/**
 * Allurus POS Server: one central Apps Script web app, one Google Sheet per company
 * (POS-LIVE-APPSCRIPT-SPEC.md). Paste this file, PosCore.gs (synced from pos/shared/pos-core.js,
 * npm run sync-pos-core) and Provision.gs into one Apps Script project.
 *
 * Every request proves who it's from with a Firebase ID token, not a shared secret (api-live.js gets a fresh
 * token from the signed-in person's own Firebase session before each call). This file checks the token against
 * Firebase Auth, then reads users/{uid} and tenants/{tenantId} from Firestore using THAT SAME TOKEN - so the
 * existing firestore.rules decide what it may read, exactly as if a browser had asked. No service account key.
 *
 * Script Properties (Project Settings > Script Properties):
 *   FIREBASE_API_KEY     required. The Allurus web app's Firebase Web API key (same project as the HR app).
 *   FIREBASE_PROJECT_ID  required. 'allurus-hr'.
 *   REGISTRY_ID          required. Spreadsheet id of the registry Sheet (tenantId -> company Sheet id).
 *   CLIENTS_FOLDER_ID    required for provision. Drive folder "Allurus POS clients".
 *   BACKUPS_FOLDER_ID    required for backupAll. Drive folder "Allurus POS backups".
 *
 * Caching: a verified {uid, tenantId, posRole, posOn} is cached 5 minutes (CacheService), keyed by a hash of the
 * token (never the token itself) - so a removed POS role takes up to 5 minutes to take effect. Manager-only money
 * actions (void, price change, stock adjust, reverse waste/purchase) always re-check fresh, uncached.
 */

var ROLE_ACTIONS = {
  // manager: every action. cashier: the ones listed here. waiter/kitchen: not yet supported by this till (it has
  // no orders/tables/tickets screens - that's the other POS module's model, see POS-LIVE-FLOW-SPEC.md "Build on
  // what exists"), so those roles get "Not allowed" for now rather than a silently wrong permission.
  cashier: ['getProducts', 'getDailySummary', 'getSale', 'createSale', 'logWaste', 'getWaste',
    'getRecipes', 'openContainer', 'finishContainer', 'getContainers', 'getStockReport', 'getUsageReport', 'getPurchases'],
  // Money-moving or data-changing actions a cashier must not do even once the cache would otherwise allow it:
  // checked fresh (uncached) every time, whoever is calling.
  managerOnly: ['voidSale', 'saveProduct', 'reverseWaste', 'stockAdjust', 'receivePurchase', 'reversePurchase',
    'saveRecipe', 'discardContainer', 'stockCount', 'removeSampleMenu'],
  // After the POS trial ends (and until paid), reads still work (POS-LIVE-FLOW-SPEC.md section 7: "Managers can
  // view Today and reports and download CSV") but every write is refused.
  reads: ['getProducts', 'getDailySummary', 'getSale', 'getWaste', 'getRecipes', 'getContainers', 'getStockReport', 'getUsageReport', 'getPurchases']
};

/** JSON reply for the web app (was only in the single-cafe Code.gs, so the server crashed on every request without it). */
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return json_({ ok: true, data: { service: 'allurus-pos-server' } }); }

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    return json_({ ok: true, data: handle_(body) });
  } catch (err) {
    if (err && err.userError) return json_({ ok: false, error: err.message });
    console.error((body.action || '?') + ' failed: ' + (err && err.message));
    return json_({ ok: false, error: 'Server error. Nothing was saved twice; try again.' });
  }
}

/** Separated from doPost so it can be unit tested without going through ContentService. */
function handle_(body) {
  var action = String(body.action || '');
  var tenantId = String(body.tenantId || '');
  if (!tenantId) fail_('Missing tenantId');

  // provision_ has its own admin check (Owner or Settings area) in Provision.gs: it runs before any POS role
  // exists, so it can't go through authorize_ below, which requires one.
  if (action === 'provision') return provisionCompany_(String(body.idToken || ''), tenantId, body.data || {});

  var auth = authorize_(String(body.idToken || ''), tenantId, action);
  var spreadsheetId = registryLookup_(tenantId);
  if (!spreadsheetId) fail_('This company has not started its POS trial yet.');
  Host = buildSheetHost_(SpreadsheetApp.openById(spreadsheetId)); // reassigns pos-core.js's module-level Host;
                                                                   // safe - each web app request is its own
                                                                   // isolated execution, nothing is shared between
                                                                   // concurrent calls from different companies
  var routes = {
    getProducts: getProducts_, getDailySummary: getDailySummary_, getSale: getSale_,
    createSale: createSale_, voidSale: voidSale_, saveProduct: saveProduct_,
    logWaste: logWaste_, reverseWaste: reverseWaste_, getWaste: getWaste_, stockAdjust: stockAdjust_,
    receivePurchase: receivePurchase_, reversePurchase: reversePurchase_, getPurchases: getPurchases_,
    saveRecipe: saveRecipe_, getRecipes: getRecipes_,
    openContainer: openContainer_, finishContainer: finishContainer_, discardContainer: discardContainer_, getContainers: getContainers_,
    stockCount: stockCount_, getStockReport: getStockReport_, getUsageReport: getUsageReport_,
    removeSampleMenu: removeSampleMenu_ // Provision.gs; Products screen's "Remove sample menu"
  };
  var fn = routes[action];
  if (!fn) fail_('Unknown action');
  var out = fn(body.data || {});
  auditRow_(spreadsheetId, auth, action, body.data);
  return out;
}

/**
 * Checks the caller's token and POS role for this tenant and this action. Returns { uid, tenantId, posRole }.
 * Throws (fail_, caught by doPost as a normal "Not allowed" reply, same as a wrong SECRET_KEY used to) on any
 * problem - a bad token, someone else's company, a disabled account, no POS role, trial not on, or a role not
 * allowed to do this action. Deliberately generic messages: never say *which* check failed to an unauthenticated
 * caller.
 */
function authorize_(idToken, tenantId, action) {
  if (!idToken) fail_('Not allowed');
  var managerOnly = ROLE_ACTIONS.managerOnly.indexOf(action) >= 0;
  var isRead = ROLE_ACTIONS.reads.indexOf(action) >= 0;
  var cacheKey = 'posauth:' + tenantId + ':' + hash_(idToken);
  if (!managerOnly) {
    var cached = CacheHost.get(cacheKey);
    // posOn is cached too: without this, one read while the trial is expired (allowed, and so cached) would let a
    // write through on the next call within the cache window, skipping the trial check entirely on a cache hit.
    if (cached) { if (!cached.posOn && !isRead) fail_('Your POS trial has ended. Ask your admin to continue.'); checkRole_(cached.posRole, action); return cached; }
  }
  var uid = verifyToken_(idToken);
  var profile = firestoreGet_('users/' + uid, idToken);
  if (!profile) fail_('Not allowed');
  if (profile.tenantId !== tenantId) fail_('Not allowed');
  if (profile.disabled === true || profile.pending === true) fail_('Not allowed');
  var posRole = effectivePosRole_(profile);
  if (!posRole) fail_('You don’t have POS access. Ask your admin.');
  var company = firestoreGet_('tenants/' + tenantId, idToken);
  if (!company) fail_('Not allowed');
  var posOn = posTrialOrActive_(company);
  if (!posOn && !isRead) fail_('Your POS trial has ended. Ask your admin to continue.');
  var result = { uid: uid, tenantId: tenantId, posRole: posRole, posOn: posOn };
  if (!managerOnly) CacheHost.put(cacheKey, result, 300);
  checkRole_(posRole, action);
  return result;
}

function checkRole_(posRole, action) {
  if (posRole === 'manager') return;
  if (posRole === 'cashier' && ROLE_ACTIONS.cashier.indexOf(action) >= 0) return;
  fail_('Not allowed');
}

/** Same shape as firestore.rules' posRole(): the person's own posRole field, or 'manager' for an Owner/Settings-pos admin. */
function effectivePosRole_(profile) {
  if (profile.posRole) return String(profile.posRole);
  var isAdmin = Array.isArray(profile.roles) && profile.roles.indexOf('admin') >= 0;
  if (!isAdmin) return '';
  var isOwner = !Array.isArray(profile.perms);
  if (isOwner || profile.perms.indexOf('pos') >= 0) return 'manager';
  return '';
}

/** Mirrors js/billing-rules.js's effective() for the company as a whole, plus addons.pos (POS-LIVE-FLOW-SPEC.md). */
function posTrialOrActive_(company) {
  var status = company.status || 'active';
  if (status === 'suspended' || status === 'cancelled') return false;
  var addons = company.addons || {};
  var pos = addons.pos || {};
  if (pos.status === 'active') return true;
  if (pos.status === 'trial') return !pos.trialEndsAt || Date.parse(pos.trialEndsAt) > Date.now();
  return false;
}

// ---------- Firebase Auth and Firestore REST (the caller's own token; no service account) ----------

function verifyToken_(idToken) {
  var key = PropertiesService.getScriptProperties().getProperty('FIREBASE_API_KEY');
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + key, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) fail_('Not allowed');
  var body = JSON.parse(res.getContentText());
  var user = body.users && body.users[0];
  if (!user) fail_('Not allowed');
  return user.localId;
}

/** One document, decoded from Firestore's REST field encoding to plain JS. null if it doesn't exist or the token can't read it. */
function firestoreGet_(path, idToken) {
  var project = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  var url = 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents/' + path;
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var doc = JSON.parse(res.getContentText());
  return decodeFirestore_(doc.fields || {});
}

function decodeFirestore_(fields) {
  var o = {};
  Object.keys(fields).forEach(function (k) { o[k] = decodeFirestoreValue_(fields[k]); });
  return o;
}
function decodeFirestoreValue_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeFirestoreValue_);
  if ('mapValue' in v) return decodeFirestore_(v.mapValue.fields || {});
  return null;
}

// ---------- registry: tenantId -> this company's Sheet ----------

function registryLookup_(tenantId) {
  var rows = RegistryHost.rows();
  for (var i = 0; i < rows.length; i++) if (rows[i].tenantId === tenantId && rows[i].status !== 'removed') return rows[i].spreadsheetId;
  return null;
}

function auditRow_(spreadsheetId, auth, action, data) {
  try {
    var ids = []; // ids only - never names, phones, IC, card data or PINs (POS-LIVE-APPSCRIPT-SPEC.md section 1)
    ['sale_id', 'waste_id', 'movement_id', 'purchase_id', 'container_id', 'count_id', 'id'].forEach(function (k) { if (data && data[k]) ids.push(k + '=' + data[k]); });
    SpreadsheetApp.openById(spreadsheetId).getSheetByName('Audit').appendRow([now_(), auth.uid, action, ids.join(' ')]);
  } catch (e) { console.error('audit row failed: ' + e); } // never block the actual action over an audit write
}

// ---------- small host seams, so tests can swap CacheService/registry access out ----------

var CacheHost = {
  get: function (key) { var v = CacheService.getScriptCache().get(key); return v ? JSON.parse(v) : null; },
  put: function (key, value, seconds) { CacheService.getScriptCache().put(key, JSON.stringify(value), seconds); }
};
var RegistryHost = {
  rows: function () {
    var id = PropertiesService.getScriptProperties().getProperty('REGISTRY_ID');
    var sh = SpreadsheetApp.openById(id).getSheetByName('Registry');
    var values = sh.getDataRange().getValues();
    var head = values.shift() || [];
    return values.map(function (r) { var o = {}; head.forEach(function (h, j) { o[h] = r[j]; }); return o; });
  },
  append: function (row) {
    var id = PropertiesService.getScriptProperties().getProperty('REGISTRY_ID');
    var sh = SpreadsheetApp.openById(id).getSheetByName('Registry');
    sh.appendRow(['tenantId', 'spreadsheetId', 'outletName', 'createdAt', 'createdByUid', 'status', 'lastSaleAt'].map(function (c) { return row[c] === undefined ? '' : row[c]; }));
  }
};

/** A short, non-reversible key for caching by token without storing the token itself. Not for anything security-sensitive beyond cache keys. */
function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('').slice(0, 16);
}
