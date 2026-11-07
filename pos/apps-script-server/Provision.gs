/**
 * "Start POS trial": creates a company's own Google Sheet (POS-LIVE-APPSCRIPT-SPEC.md section 4), the server side
 * of js/pos-trial.js's AllurusPosTrial.start(). Called by Router.gs's doPost for action 'provision'.
 */

/**
 * Router.gs's handle_ calls this directly for action 'provision', BEFORE its usual authorize_ (which needs an
 * existing POS role - there isn't one yet for a company starting its trial). Checks its own thing instead: the
 * caller must be Owner or have the Settings area, read from users/{uid} with the caller's own token.
 * data: { outletName, sstRegistered, sstPercent, sstNumber, servicePercent, receiptHeader, receiptFooter,
 *         sampleMenu (bool) }
 */
function provisionCompany_(idToken, tenantId, data) {
  var uid = verifyToken_(idToken);
  var profile = firestoreGet_('users/' + uid, idToken);
  if (!profile || profile.tenantId !== tenantId) fail_('Not allowed');
  var isAdmin = Array.isArray(profile.roles) && profile.roles.indexOf('admin') >= 0;
  var isOwner = !Array.isArray(profile.perms);
  if (!isAdmin || !(isOwner || profile.perms.indexOf('settings') >= 0)) fail_('Only an Owner or a Settings admin can start the POS trial.');

  // One provision at a time, so two quick clicks can't both pass the registry check and make two Sheets.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var existing = registryLookup_(tenantId);
    if (existing) return { spreadsheetId: existing, created: false }; // double-click safe: don't make a second Sheet
    return provisionLocked_(uid, idToken, tenantId, data);
  } finally { lock.releaseLock(); }
}

function provisionLocked_(uid, idToken, tenantId, data) {

  var company = firestoreGet_('tenants/' + tenantId, idToken);
  var outletName = cleanText_(data.outletName, 80) || (company && company.name) || 'My Cafe';
  var ss = createCompanySpreadsheet_(outletName, tenantId);
  Host = buildSheetHost_(ss);
  setupCompanyTabs_(ss);
  writeCompanySettings_(ss, {
    BUSINESS_NAME: outletName,
    SST_PERCENT: data.sstRegistered ? Number(data.sstPercent || 0) : 0,
    SST_NUMBER: data.sstRegistered ? cleanText_(data.sstNumber, 40) : '',
    SERVICE_PERCENT: Number(data.servicePercent || 0),
    RECEIPT_HEADER: cleanText_(data.receiptHeader, 120),
    RECEIPT_FOOTER: cleanText_(data.receiptFooter, 120) || 'Thank you! See you again.',
    LOW_STOCK: 5
  });
  if (data.sampleMenu) loadSampleMenuNamed_(outletName + ' sample menu');

  RegistryHost.append({ tenantId: tenantId, spreadsheetId: ss.getId(), outletName: outletName, createdAt: now_(), createdByUid: uid, status: 'trial', lastSaleAt: '' });
  return { spreadsheetId: ss.getId(), created: true };
}

function createCompanySpreadsheet_(outletName, tenantId) {
  var folderId = PropertiesService.getScriptProperties().getProperty('CLIENTS_FOLDER_ID');
  var ss = SpreadsheetApp.create('Allurus POS – ' + outletName + ' – ' + tenantId);
  if (folderId) {
    var file = DriveApp.getFileById(ss.getId());
    DriveApp.getFolderById(folderId).addFile(file);
    DriveApp.getRootFolder().removeFile(file); // moved, not copied, into the clients folder
  }
  return ss;
}

/** Same tabs pos-core.js's TABS expects, plus Settings and Audit, which aren't in TABS (not pos-core.js tables). */
function setupCompanyTabs_(ss) {
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABS[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var settings = ss.getSheetByName('Settings') || ss.insertSheet('Settings');
  settings.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold');
  settings.setFrozenRows(1);
  var audit = ss.getSheetByName('Audit') || ss.insertSheet('Audit');
  audit.getRange(1, 1, 1, 4).setValues([['datetime', 'uid', 'action', 'ids']]).setFontWeight('bold');
  audit.setFrozenRows(1);
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 3 && blank.getLastRow() === 0) ss.deleteSheet(blank);
}

function writeCompanySettings_(ss, map) {
  var sh = ss.getSheetByName('Settings');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  var rows = Object.keys(map).map(function (k) { return [k, map[k]]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

/** Loads pos/demo/seed.js's menu shape, but through saveProduct_/saveRecipe_ so costs and stock are real rows,
 * names marked "(sample)" exactly like Code.gs's own loadSampleMenu, for "Remove sample menu" to find later. */
function loadSampleMenuNamed_() {
  var items = [
    ['Americano', 7.90, '', 'Coffee', 'cup', 1.80], ['Latte', 10.90, '', 'Coffee', 'cup', 2.60],
    ['Teh Tarik', 5.50, '', 'Tea', 'cup', 1.10], ['Butter Croissant', 7.50, 20, 'Food', 'pcs', 2.80],
    ['Chicken Sandwich', 14.90, 15, 'Food', 'pcs', 5.40], ['Burnt Cheesecake', 13.90, 8, 'Dessert', 'pcs', 4.20]
  ];
  items.forEach(function (x) {
    saveProduct_({ name: x[0] + ' (sample)', price: x[1], stock: x[2], category: x[3], unit: x[4], cost: x[5], active: true, staff_name: 'provision' });
  });
}

/** Products screen's "Remove sample menu": deactivates every "(sample)" item in one go. */
function removeSampleMenu_() {
  rows_('Products').filter(function (r) { return String(r.name).indexOf('(sample)') >= 0 && bool_(r.active); })
    .forEach(function (r) { setCell_('Products', r._row, 'active', false); });
  return { removed: true };
}
