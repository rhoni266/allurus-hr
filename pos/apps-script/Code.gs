/**
 * Cafe POS (trial): backend on one Google Sheet.
 *
 * Tabs (one header row each): Products, Sales, SaleItems. Run setup() once to create them.
 * Script Properties (Project Settings > Script Properties):
 *   SECRET_KEY        required. Same value as config.js.
 *   SST_PERCENT       optional, default 0. e.g. 6
 *   SERVICE_PERCENT   optional, default 0. e.g. 10 (charged on dine-in only)
 *   LOW_STOCK         optional, default 5. Warn when stock falls to this or below.
 *
 * Money is integer sen inside this file and RM with 2 decimals in the Sheet.
 * All calls are POST (text/plain body with JSON) so the secret never sits in a URL.
 * Never stores card numbers or customer details.
 */

var TZ = 'Asia/Kuala_Lumpur';
var TABS = {
  Products: ['id', 'name', 'price', 'stock', 'category', 'active'],
  Sales: ['sale_id', 'datetime', 'subtotal', 'discount', 'service', 'tax', 'rounding', 'total',
    'payment_method', 'order_type', 'table_no', 'device_id', 'status', 'void_reason'],
  SaleItems: ['sale_id', 'product_id', 'name', 'qty', 'unit_price', 'subtotal', 'note']
};
var METHODS = ['cash', 'duitnow_qr', 'card', 'ewallet'];
var ORDER_TYPES = ['dine_in', 'takeaway'];

// ---------- HTTP ----------

function doGet() {
  // Health check only. Reads go through doPost so the key stays out of URLs and browser history.
  return json_({ ok: true, data: { service: 'cafe-pos' } });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  if (!keyOk_(body.key)) return json_({ ok: false, error: 'Not allowed' });
  var routes = {
    getProducts: getProducts_, getDailySummary: getDailySummary_, getSale: getSale_,
    createSale: createSale_, voidSale: voidSale_, saveProduct: saveProduct_
  };
  var fn = routes[body.action];
  if (!fn) return json_({ ok: false, error: 'Unknown action' });
  try {
    return json_({ ok: true, data: fn(body.data || {}) });
  } catch (err) {
    if (err && err.userError) return json_({ ok: false, error: err.message });
    console.error(body.action + ' failed: ' + (err && err.message)); // no request body in logs
    return json_({ ok: false, error: 'Server error. Nothing was saved twice; try again.' });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function keyOk_(key) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET_KEY');
  if (!secret || typeof key !== 'string' || key.length !== secret.length) return false;
  var diff = 0; // compare every character so timing doesn't give the key away
  for (var i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

function fail_(msg) { var e = new Error(msg); e.userError = true; throw e; }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- money and checks ----------

function toSen_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  if (!isFinite(n)) fail_('Bad amount');
  return Math.round(n * 100);
}
function toRm_(sen) { return Math.round(sen) / 100; }
function pctToBp_(p) { var n = Number(p || 0); return isFinite(n) && n > 0 ? Math.round(n * 100) : 0; }
function applyBp_(sen, bp) { return Math.round(sen * bp / 10000); }
function roundCash_(sen) { return Math.round(sen / 5) * 5; } // 1-2 sen down, 3-4 up

function settings_() {
  var p = PropertiesService.getScriptProperties();
  return {
    taxBp: pctToBp_(p.getProperty('SST_PERCENT')),
    serviceBp: pctToBp_(p.getProperty('SERVICE_PERCENT')),
    lowStock: Number(p.getProperty('LOW_STOCK') || 5)
  };
}

function looksLikeCard_(s) {
  var runs = String(s || '').replace(/[ -]/g, '').match(/\d{13,19}/g);
  return !!runs;
}

function cleanText_(s, max) {
  s = String(s === undefined || s === null ? '' : s).trim().slice(0, max);
  if (looksLikeCard_(s)) fail_('That looks like a card number. Card numbers are never stored.');
  return s;
}

function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }

// ---------- sheet helpers ----------

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) fail_('Missing tab "' + name + '". Run setup() in the script editor.');
  return sh;
}

function rows_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var head = values.shift() || [];
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function append_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var cols = TABS[name];
  var data = objs.map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : o[c]; }); });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, cols.length).setValues(data);
}

function setCell_(name, row, col, value) {
  sheet_(name).getRange(row, TABS[name].indexOf(col) + 1).setValue(value);
}

function product_(r) {
  return {
    id: String(r.id), name: String(r.name), price: toRm_(toSen_(r.price)),
    stock: r.stock === '' || r.stock === null ? '' : Number(r.stock),
    category: String(r.category || ''), active: r.active === true || String(r.active).toUpperCase() === 'TRUE'
  };
}

// ---------- reads ----------

function getProducts_(d) {
  var list = rows_('Products').map(product_);
  return d.includeInactive ? list : list.filter(function (p) { return p.active; });
}

function saleOut_(s, items, receiptNo) {
  var out = {};
  TABS.Sales.forEach(function (c) { out[c] = s[c]; });
  out.datetime = String(s.datetime);
  out.receipt_no = receiptNo;
  out.items = items.map(function (it) {
    return { product_id: String(it.product_id), name: it.name, qty: Number(it.qty),
      unit_price: Number(it.unit_price), subtotal: Number(it.subtotal), note: it.note };
  });
  return out;
}

function receiptNo_(row) { return 'R' + ('00000' + (row - 1)).slice(-6); } // row 2 = R000001; rows are never deleted

function findSale_(saleId) {
  var sales = rows_('Sales');
  for (var i = 0; i < sales.length; i++) if (String(sales[i].sale_id) === saleId) return sales[i];
  return null;
}

function itemsOf_(saleId) {
  return rows_('SaleItems').filter(function (it) { return String(it.sale_id) === saleId; });
}

function getSale_(d) {
  var s = findSale_(String(d.sale_id || ''));
  if (!s) fail_('Sale not found');
  return saleOut_(s, itemsOf_(s.sale_id), receiptNo_(s._row));
}

function getDailySummary_(d) {
  var day = String(d.date || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail_('Bad date');
  var all = rows_('Sales').filter(function (s) { return String(s.datetime).slice(0, 10) === day; });
  var list = all.map(function (s) {
    return { sale_id: String(s.sale_id), receipt_no: receiptNo_(s._row), datetime: String(s.datetime), total: Number(s.total),
      payment_method: s.payment_method, order_type: s.order_type, table_no: String(s.table_no), status: s.status, void_reason: s.void_reason };
  }).reverse();
  var sales = all.filter(function (s) { return s.status !== 'void'; });
  var ids = {};
  var byMethod = {};
  var totalSen = 0;
  sales.forEach(function (s) {
    ids[s.sale_id] = true;
    var t = toSen_(s.total);
    totalSen += t;
    byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + t;
  });
  var items = {};
  rows_('SaleItems').forEach(function (it) {
    if (!ids[it.sale_id]) return;
    var k = String(it.product_id);
    if (!items[k]) items[k] = { product_id: k, name: it.name, qty: 0, sales: 0 };
    items[k].qty += Number(it.qty);
    items[k].sales += toSen_(it.subtotal);
  });
  var top = Object.keys(items).map(function (k) { return items[k]; })
    .sort(function (a, b) { return b.qty - a.qty || b.sales - a.sales; }).slice(0, 10)
    .map(function (x) { return { product_id: x.product_id, name: x.name, qty: x.qty, sales: toRm_(x.sales) }; });
  var methods = {};
  Object.keys(byMethod).forEach(function (m) { methods[m] = toRm_(byMethod[m]); });
  return { date: day, total_sales: toRm_(totalSen), orders: sales.length, voided: all.length - sales.length,
    by_method: methods, top_items: top, sales: list };
}

// ---------- writes ----------

/**
 * data: { sale_id, items: [{ product_id, qty, note }], discount: { type: 'rm'|'pct', value },
 *         payment_method, order_type, table_no, device_id }
 * Prices and totals come from this server, never from the client.
 * Same sale_id again (a retry) returns the sale already saved.
 */
function createSale_(d) {
  var saleId = String(d.sale_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(saleId)) fail_('Bad sale id');
  return withLock_(function () {
    var existing = findSale_(saleId);
    if (existing) {
      var out = saleOut_(existing, itemsOf_(saleId), receiptNo_(existing._row));
      out.duplicate = true;
      out.warnings = [];
      return out;
    }

    var method = String(d.payment_method || '');
    if (METHODS.indexOf(method) < 0) fail_('Choose a payment method');
    var orderType = String(d.order_type || 'takeaway');
    if (ORDER_TYPES.indexOf(orderType) < 0) fail_('Bad order type');
    var tableNo = cleanText_(d.table_no, 10);
    var deviceId = cleanText_(d.device_id, 40);
    var lines = Array.isArray(d.items) ? d.items : [];
    if (!lines.length) fail_('The cart is empty');
    if (lines.length > 100) fail_('Too many lines');

    var products = {};
    rows_('Products').forEach(function (r) { products[String(r.id)] = r; });

    var set = settings_();
    var subtotal = 0;
    var itemRows = [];
    var stockUse = {};
    lines.forEach(function (l) {
      var r = products[String(l.product_id)];
      if (!r) fail_('Unknown product');
      var p = product_(r);
      if (!p.active) fail_(p.name + ' is not on sale');
      var qty = Number(l.qty);
      if (!(qty > 0) || Math.floor(qty) !== qty || qty > 999) fail_('Bad quantity for ' + p.name);
      var unit = toSen_(r.price);
      var lineSen = unit * qty;
      subtotal += lineSen;
      itemRows.push({ sale_id: saleId, product_id: p.id, name: p.name, qty: qty, unit_price: toRm_(unit),
        subtotal: toRm_(lineSen), note: cleanText_(l.note, 100) });
      if (p.stock !== '') stockUse[p.id] = (stockUse[p.id] || 0) + qty;
    });

    var disc = d.discount || {};
    var discount = 0;
    if (disc.type === 'pct') {
      var pct = Number(disc.value || 0);
      if (!(pct >= 0 && pct <= 100)) fail_('Discount % must be 0 to 100');
      discount = applyBp_(subtotal, Math.round(pct * 100));
    } else if (disc.type === 'rm') {
      discount = toSen_(disc.value);
      if (discount < 0) fail_('Discount can\'t be negative');
    }
    discount = Math.min(discount, subtotal);
    var net = subtotal - discount;
    var service = orderType === 'dine_in' ? applyBp_(net, set.serviceBp) : 0;
    var tax = applyBp_(net + service, set.taxBp);
    var exact = net + service + tax;
    var total = method === 'cash' ? roundCash_(exact) : exact; // whole bill paid in cash only

    var sale = {
      sale_id: saleId, datetime: now_(), subtotal: toRm_(subtotal), discount: toRm_(discount),
      service: toRm_(service), tax: toRm_(tax), rounding: toRm_(total - exact), total: toRm_(total),
      payment_method: method, order_type: orderType, table_no: tableNo, device_id: deviceId,
      status: 'paid', void_reason: ''
    };
    var saleRow = sheet_('Sales').getLastRow() + 1;
    append_('Sales', [sale]);
    append_('SaleItems', itemRows);

    var warnings = [];
    Object.keys(stockUse).forEach(function (id) {
      var r = products[id];
      var left = Number(r.stock) - stockUse[id];
      setCell_('Products', r._row, 'stock', left);
      if (left < 0) warnings.push(r.name + ': stock is now ' + left + ' (negative). Please recount.');
      else if (left <= set.lowStock) warnings.push(r.name + ': only ' + left + ' left.');
    });

    var out2 = saleOut_(sale, itemRows, receiptNo_(saleRow));
    out2.duplicate = false;
    out2.warnings = warnings;
    return out2;
  });
}

function voidSale_(d) {
  var saleId = String(d.sale_id || '');
  var reason = cleanText_(d.reason, 200);
  if (reason.length < 3) fail_('A reason is required to void a sale');
  return withLock_(function () {
    var s = findSale_(saleId);
    if (!s) fail_('Sale not found');
    if (s.status === 'void') return { sale_id: saleId, status: 'void', already: true };
    setCell_('Sales', s._row, 'status', 'void');
    setCell_('Sales', s._row, 'void_reason', reason);
    var products = {};
    rows_('Products').forEach(function (r) { products[String(r.id)] = r; });
    var back = {};
    itemsOf_(saleId).forEach(function (it) { back[it.product_id] = (back[it.product_id] || 0) + Number(it.qty); });
    Object.keys(back).forEach(function (id) {
      var r = products[id];
      if (r && r.stock !== '' && r.stock !== null) setCell_('Products', r._row, 'stock', Number(r.stock) + back[id]);
    });
    return { sale_id: saleId, status: 'void', already: false };
  });
}

/** Add (no id) or edit a product. There is no delete: set active to false instead. */
function saveProduct_(d) {
  var name = cleanText_(d.name, 60);
  if (!name) fail_('Name is required');
  var price = toSen_(d.price);
  if (price < 0) fail_('Price can\'t be negative');
  var stock = d.stock === '' || d.stock === null || d.stock === undefined ? '' : Number(d.stock);
  if (stock !== '' && (!isFinite(stock) || Math.floor(stock) !== stock)) fail_('Stock must be a whole number, or blank for "not tracked"');
  var p = { name: name, price: toRm_(price), stock: stock, category: cleanText_(d.category, 30) || 'Other', active: d.active !== false };
  return withLock_(function () {
    if (d.id) {
      var r = rows_('Products').filter(function (x) { return String(x.id) === String(d.id); })[0];
      if (!r) fail_('Product not found');
      p.id = String(d.id);
      var sh = sheet_('Products');
      sh.getRange(r._row, 1, 1, TABS.Products.length).setValues([TABS.Products.map(function (c) { return p[c]; })]);
    } else {
      p.id = Utilities.getUuid();
      append_('Products', [p]);
    }
    return p;
  });
}

// ---------- run these once from the script editor ----------

/** Creates the three tabs with headers and formats. Safe to run again. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABS[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var text = ['id', 'sale_id', 'product_id', 'datetime', 'table_no', 'device_id', 'note', 'void_reason'];
    var money = ['price', 'subtotal', 'discount', 'service', 'tax', 'rounding', 'total', 'unit_price'];
    cols.forEach(function (c, i) {
      var col = sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
      if (text.indexOf(c) >= 0) col.setNumberFormat('@'); // keep ids and dates as plain text
      if (money.indexOf(c) >= 0) col.setNumberFormat('0.00');
    });
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 3 && blank.getLastRow() === 0) ss.deleteSheet(blank);
}

/** Adds 10 sample cafe items (names end in "(sample)") if Products is empty. */
function loadSampleMenu() {
  if (rows_('Products').length) throw new Error('Products already has rows; sample menu not loaded.');
  var s = [
    ['Americano', 7.90, '', 'Coffee'], ['Latte', 10.90, '', 'Coffee'], ['Cappuccino', 10.90, '', 'Coffee'],
    ['Spanish Latte', 12.90, '', 'Coffee'], ['Teh Tarik', 5.50, '', 'Tea'], ['Iced Lemon Tea', 6.90, '', 'Tea'],
    ['Butter Croissant', 7.50, 20, 'Food'], ['Chicken Sandwich', 14.90, 15, 'Food'],
    ['Burnt Cheesecake', 13.90, 8, 'Dessert'], ['Chocolate Brownie', 8.90, 12, 'Dessert']
  ];
  append_('Products', s.map(function (x) {
    return { id: 'sample-' + Utilities.getUuid(), name: x[0] + ' (sample)', price: x[1], stock: x[2], category: x[3], active: true };
  }));
}

/** Copies the whole spreadsheet into Drive folder "Cafe POS backups"; keeps the newest 30. */
function backupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var it = DriveApp.getFoldersByName('Cafe POS backups');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Cafe POS backups');
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'), folder);
  var files = [];
  var f = folder.getFiles();
  while (f.hasNext()) files.push(f.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(30).forEach(function (x) { x.setTrashed(true); });
}

/** Run once: backs up every day between 2 and 3 am. Running it again doesn't add a second trigger. */
function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupSheet').timeBased().everyDays(1).atHour(2).inTimezone(TZ).create();
}
