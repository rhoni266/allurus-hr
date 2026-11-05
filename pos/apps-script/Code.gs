/**
 * Cafe POS (trial): backend on one Google Sheet.
 *
 * Tabs (one header row each): Products, Sales, SaleItems, Waste, StockMovements, Recipes, Purchases, OpenContainers,
 * StockCounts. Run setup() to create or update them.
 * Inventory is the StockMovements ledger: every change writes a row (purchase, sale, sale_usage, void_return,
 * sale_usage_reversal, waste_dish, waste_ingredient, waste_reversal, stocktake_adjustment, container_open/finish, and
 * the older stock_in, adjustment, waste). The stock column is the server's running total of it; getStockReport checks
 * the two agree.
 * Script Properties (Project Settings > Script Properties):
 *   SECRET_KEY        required. Same value as config.js.
 *   SST_PERCENT       optional, default 0. e.g. 6
 *   SERVICE_PERCENT   optional, default 0. e.g. 10 (charged on dine-in only)
 *   LOW_STOCK         optional, default 5. Warn when stock falls to this or below.
 *   COUNT_VARIANCE_PERCENT  optional, default 5. A stocktake line further off than this needs a reason.
 *   ALLURUS_TENANT    the company id in allurus-hr whose staff may be added (e.g. banafsha-test).
 *   ALLURUS_PROJECT   optional, default allurus-hr. SESSION_IDLE_MIN optional, default 15. OUTLET_NAME optional.
 * Every call except login also needs a staff session (Employee ID + PIN); see "staff, login and roles".
 *
 * Money is integer sen inside this file and RM with 2 decimals in the Sheet.
 * All calls are POST (text/plain body with JSON) so the secret never sits in a URL.
 * Never stores card numbers or customer details.
 */

var TZ = 'Asia/Kuala_Lumpur';
var TABS = {
  Products: ['id', 'name', 'price', 'stock', 'category', 'active', 'unit', 'cost', 'track_stock', 'kind',
    'pack_size', 'pack_unit', 'base_unit', 'reorder_level', 'open_shelf_life_days', 'max_open_containers', 'track_open'],
  Sales: ['sale_id', 'datetime', 'subtotal', 'discount', 'service', 'tax', 'rounding', 'total',
    'payment_method', 'order_type', 'table_no', 'device_id', 'status', 'void_reason', 'made_at', 'cashier_id'],
  SaleItems: ['sale_id', 'product_id', 'name', 'qty', 'unit_price', 'subtotal', 'note'],
  Waste: ['waste_id', 'line_no', 'datetime', 'product_id', 'name', 'qty', 'unit', 'unit_cost', 'cost', 'reason', 'note',
    'staff_name', 'device_id', 'status', 'reverses_waste_id', 'waste_type', 'emp_id', 'role'],
  StockMovements: ['movement_id', 'datetime', 'product_id', 'name', 'change_qty', 'reason_type', 'ref_id', 'balance_after',
    'staff_name', 'device_id', 'unit_cost', 'value'],
  Recipes: ['recipe_id', 'menu_product_id', 'ingredient_id', 'qty', 'unit', 'note', 'modifier_id'],
  Purchases: ['purchase_id', 'line_no', 'datetime', 'supplier', 'invoice_no', 'ingredient_id', 'name', 'pack_qty', 'pack_size',
    'base_unit', 'total_qty', 'pack_cost', 'line_cost', 'unit_cost', 'batch_no', 'expiry_date', 'received_by', 'status',
    'reverses_purchase_id'],
  OpenContainers: ['container_id', 'ingredient_id', 'size', 'opened_at', 'opened_by', 'use_by', 'status', 'est_remaining',
    'finished_at', 'discarded_reason', 'note', 'station', 'open_reason', 'allocated_qty', 'variance', 'overrun'],
  StockCounts: ['count_id', 'line_no', 'datetime', 'ingredient_id', 'name', 'counted_qty', 'expected_qty', 'variance',
    'variance_value', 'counted_by', 'note', 'status'],
  // Staff accounts (PINs hashed). The three logs below are append-only: the code only ever adds rows to them.
  Staff: ['emp_id', 'name', 'role', 'pin_hash', 'pin_salt', 'status', 'failed_attempts', 'must_change_pin', 'hr_status', 'created_at', 'updated_at'],
  VoidLog: ['void_id', 'datetime', 'outlet', 'terminal', 'sale_id', 'receipt_no', 'items', 'amount', 'requested_by', 'approved_by', 'reason',
    'note', 'made'],
  StaffLog: ['log_id', 'datetime', 'actor', 'action', 'emp_id', 'detail'],
  ChangeLog: ['log_id', 'datetime', 'actor', 'entity', 'entity_id', 'field', 'old_value', 'new_value'],
  // End of day. Closings is append-only (one row per close). ShopList is the stock checklist: open items stay until ticked.
  Closings: ['close_id', 'datetime', 'date', 'closed_by', 'role', 'scope', 'orders', 'total_sales', 'cash_expected', 'cash_counted',
    'cash_variance', 'voided', 'void_amount', 'by_method', 'note', 'opening', 'cash_status', 'approved_by', 'denoms'],
  // Opening cash (the float) set at the start of the day; append-only, the latest one per person wins.
  Openings: ['open_id', 'datetime', 'date', 'opened_by', 'role', 'amount', 'note', 'denoms'],
  ShopList: ['product_id', 'name', 'unit', 'reason', 'stock', 'first_listed', 'last_listed', 'times_listed', 'status', 'done_at', 'done_by']
};
var METHODS = ['cash', 'duitnow_qr', 'card', 'ewallet'];
var ORDER_TYPES = ['dine_in', 'takeaway'];
var UNITS = ['pcs', 'cup', 'g', 'ml', 'kg', 'l'];
var DECIMAL_UNITS = ['g', 'ml', 'kg', 'l'];
var KINDS = ['menu', 'ingredient'];
// Reasons for a made dish thrown away, and for raw stock lost. Older values stay valid so old entries still read.
var DISH_REASONS = ['cancelled_after_made', 'quality_low', 'wrong_order', 'customer_returned', 'remake', 'dropped', 'staff_meal',
  'spoiled', 'expired', 'overproduction', 'sample', 'other'];
var INGREDIENT_REASONS = ['spoiled', 'expired', 'expired_after_open', 'spilled', 'broken', 'dropped', 'contaminated', 'staff_meal',
  'sample', 'other'];
var WASTE_REASONS = DISH_REASONS.concat(INGREDIENT_REASONS.filter(function (r) { return DISH_REASONS.indexOf(r) < 0; }));
var OPEN_REASONS = ['first_finished', 'other_station', 'first_contaminated', 'first_expired', 'other'];
var DISCARD_REASONS = ['expired_after_open', 'spilled', 'contaminated', 'other'];

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
    getProducts: getProducts_, getDailySummary: getDailySummary_, getSale: getSale_, findSale: findSale_ByReceipt_,
    createSale: createSale_, voidSale: approvedVoid_, saveProduct: saveProduct_,
    logWaste: logWaste_, reverseWaste: reverseWaste_, getWaste: getWaste_, stockAdjust: stockAdjust_,
    receivePurchase: receivePurchase_, reversePurchase: reversePurchase_, getPurchases: getPurchases_,
    saveRecipe: saveRecipe_, getRecipes: getRecipes_,
    openContainer: openContainer_, finishContainer: finishContainer_, discardContainer: discardContainer_, getContainers: getContainers_,
    stockCount: stockCount_, getStockReport: getStockReport_, getUsageReport: getUsageReport_,
    whoami: whoami_, logout: logout_, changePin: changePin_, getVoidLog: getVoidLog_,
    listStaff: listStaff_, hrSearch: hrSearch_, addStaff: addStaff_, updateStaff: updateStaff_, getAuditLog: getAuditLog_,
    getClosing: getClosing_, closeDay: closeDay_, getClosings: getClosings_, setShopItem: setShopItem_,
    setOpening: setOpening_, getClosingStock: getClosingStock_, getClosingDetail: getClosingDetail_
  };
  if (body.action === 'login') {
    try { return json_({ ok: true, data: login_(body.data || {}) }); } catch (err) { return json_(err && err.userError ? { ok: false, error: err.message } : { ok: false, error: 'Server error. Try again.' }); }
  }
  var fn = routes[body.action];
  if (!fn) return json_({ ok: false, error: 'Unknown action' });
  try {
    var sess = session_(body.token);
    if (ACCESS[body.action].indexOf(sess.role) < 0) fail_('Not allowed for a ' + sess.role);
    if (sess.must_change_pin && ['changePin', 'logout', 'whoami'].indexOf(body.action) < 0) fail_('CHANGE_PIN: Change your PIN first');
    var gate = gateError_(body.action, sess);
    if (gate) fail_(gate);
    var data = body.data || {};
    // Who did it comes from the session, never from the request.
    data._actor = sess.emp_id; data._role = sess.role;
    ['staff_name', 'received_by', 'counted_by'].forEach(function (k) { data[k] = sess.name; });
    return json_({ ok: true, data: fn(data, sess) });
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

function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function r3_(n) { return Math.round(Number(n) * 1000) / 1000; }
function tracked_(r) { return r.stock !== '' && r.stock !== null && r.stock !== undefined; } // blank stock = not tracked

function rm6_(n) { return Math.round(Number(n) * 1e6) / 1e6; } // RM per base unit, kept to 6 decimals
function blank_(v) { return v === '' || v === null || v === undefined; }
function costOf_(r) { return blank_(r.cost) ? '' : rm6_(r.cost); }
function valueSen_(unitCost, qty) { return unitCost === '' ? '' : Math.round(unitCost * 100 * qty); }

function product_(r) {
  var tracked = tracked_(r);
  var unit = UNITS.indexOf(String(r.unit)) >= 0 ? String(r.unit) : 'pcs';
  var num = function (v) { return blank_(v) ? '' : Number(v); };
  return {
    id: String(r.id), name: String(r.name), price: toRm_(toSen_(r.price)),
    stock: tracked ? Number(r.stock) : '',
    category: String(r.category || ''), active: bool_(r.active),
    unit: unit, cost: costOf_(r),
    track_stock: tracked, kind: String(r.kind) === 'ingredient' ? 'ingredient' : 'menu',
    pack_size: num(r.pack_size), pack_unit: String(r.pack_unit || ''), base_unit: unit,
    reorder_level: num(r.reorder_level), open_shelf_life_days: num(r.open_shelf_life_days),
    max_open_containers: blank_(r.max_open_containers) ? 1 : Number(r.max_open_containers), track_open: bool_(r.track_open)
  };
}

/** Whole numbers for pcs/cup; up to 3 decimals for g, ml, kg, l. Text like "2x" is refused. */
function qtyOk_(q, unit) {
  if (typeof q === 'string' && !/^-?\d+(\.\d+)?$/.test(q.trim())) return false;
  if (typeof q !== 'number' && typeof q !== 'string') return false;
  q = Number(q);
  if (!isFinite(q)) return false;
  if (DECIMAL_UNITS.indexOf(unit) >= 0) return Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6;
  return Math.floor(q) === q;
}

/**
 * Changes stock for several products and writes one StockMovements row per product.
 * changes: [{ r (Products row), qty (+in / -out), unitCost? (RM per unit; default the product's average cost) }].
 * Untracked products are skipped. Returns warnings.
 * ids: optional movement ids to use instead of new UUIDs (stockAdjust passes the client's id).
 */
function moveStock_(changes, reasonType, refId, staff, device, ids) {
  var set = settings_();
  var per = {};
  var order = [];
  changes.forEach(function (c) {
    if (!tracked_(c.r)) return;
    var id = String(c.r.id);
    if (!per[id]) { per[id] = { r: c.r, qty: 0, unitCost: c.unitCost }; order.push(id); }
    per[id].qty = r3_(per[id].qty + Number(c.qty));
  });
  var rows = [];
  var warnings = [];
  var when = now_();
  order.forEach(function (id, i) {
    var c = per[id];
    if (!c.qty) return;
    var left = r3_(Number(c.r.stock) + c.qty);
    setCell_('Products', c.r._row, 'stock', left);
    c.r.stock = left;
    var uc = c.unitCost !== undefined ? c.unitCost : costOf_(c.r);
    var v = valueSen_(uc, c.qty);
    rows.push({ movement_id: (ids && ids[i]) || Utilities.getUuid(), datetime: when, product_id: id, name: String(c.r.name),
      change_qty: c.qty, reason_type: reasonType, ref_id: refId, balance_after: left, staff_name: staff || '', device_id: device || '',
      unit_cost: uc, value: v === '' ? '' : toRm_(v) });
    if (c.qty < 0) {
      if (left < 0) warnings.push(c.r.name + ': stock is now ' + left + ' (negative). Please recount.');
      else if (left <= set.lowStock) warnings.push(c.r.name + ': only ' + left + ' left.');
    }
  });
  append_('StockMovements', rows);
  return warnings;
}

/** A movement row that changes no quantity (container_open, container_finish): the state change is in OpenContainers. */
function noteMove_(r, reasonType, refId, staff, device) {
  append_('StockMovements', [{ movement_id: Utilities.getUuid(), datetime: now_(), product_id: String(r.id), name: String(r.name),
    change_qty: 0, reason_type: reasonType, ref_id: refId, balance_after: tracked_(r) ? Number(r.stock) : '',
    staff_name: staff || '', device_id: device || '', unit_cost: costOf_(r), value: 0 }]);
}

function productsById_() {
  var o = {};
  rows_('Products').forEach(function (r) { o[String(r.id)] = r; });
  return o;
}

/** Recipe lines by menu item (modifier lines are for later and are skipped). */
function recipeIndex_() {
  var idx = {};
  rows_('Recipes').forEach(function (x) {
    if (String(x.modifier_id || '')) return;
    var k = String(x.menu_product_id);
    (idx[k] || (idx[k] = [])).push(x);
  });
  return idx;
}

/**
 * What `qty` of a menu item takes from stock: itself, when it tracks its own stock, and each recipe line.
 * Both can apply to one item (a croissant and its paper bag). Returns { own: [changes], ing: [changes] }.
 */
function usageOf_(r, qty, products, recipes) {
  var own = tracked_(r) ? [{ r: r, qty: -qty }] : [];
  var ing = (recipes[String(r.id)] || []).map(function (x) {
    var ir = products[String(x.ingredient_id)];
    return ir ? { r: ir, qty: -r3_(Number(x.qty) * qty) } : null;
  }).filter(Boolean);
  return { own: own, ing: ing };
}

/**
 * Cost of one unit of a menu item, in sen: its recipe, plus its own cost when it tracks its own stock or has no recipe
 * (a cost typed on an untracked item with a recipe would count twice). missing = some part has no cost.
 */
function dishCost_(r, products, recipes) {
  var lines = recipes[String(r.id)] || [];
  var sen = 0;
  var missing = false;
  if (tracked_(r) || !lines.length) {
    var own = costOf_(r);
    if (own === '') missing = true; else sen += own * 100;
  }
  lines.forEach(function (x) {
    var ir = products[String(x.ingredient_id)];
    var c = ir ? costOf_(ir) : '';
    if (c === '') missing = true; else sen += c * 100 * Number(x.qty);
  });
  return { sen: Math.round(sen), missing: missing };
}

/**
 * Open containers: usage of an opened ingredient is put against the oldest open container first. When usage runs past
 * a container's size it rolls to the next; past the last one that container is flagged overrun. sign -1 takes usage
 * back (a void before made), newest container first. Ingredients without track_open are ignored.
 */
function allocate_(changes, sign) {
  var cons = null;
  changes.forEach(function (c) {
    if (!bool_(c.r.track_open)) return;
    if (!cons) cons = rows_('OpenContainers');
    var mine = cons.filter(function (k) { return k.status === 'open' && String(k.ingredient_id) === String(c.r.id); })
      .sort(function (a, b) { return String(a.opened_at) < String(b.opened_at) ? -1 : String(a.opened_at) > String(b.opened_at) ? 1 : a._row - b._row; });
    if (!mine.length) return;
    var left = Math.abs(Number(c.qty));
    if (sign < 0) mine.reverse();
    mine.forEach(function (k, i) {
      if (left <= 0) return;
      var size = Number(k.size);
      var alloc = Number(k.allocated_qty || 0);
      var take;
      if (sign > 0) take = i === mine.length - 1 ? left : Math.min(left, Math.max(size - alloc, 0));
      else take = Math.min(left, alloc);
      if (!take) return;
      alloc = r3_(alloc + sign * take);
      left = r3_(left - take);
      k.allocated_qty = alloc;
      setCell_('OpenContainers', k._row, 'allocated_qty', alloc);
      setCell_('OpenContainers', k._row, 'est_remaining', r3_(Math.max(size - alloc, 0)));
      var over = alloc > size + 1e-9;
      if (over !== bool_(k.overrun)) { k.overrun = over; setCell_('OpenContainers', k._row, 'overrun', over); }
    });
  });
}

/** Movements of one reference (sale, waste entry) with these reason types, summed per product. */
function movesOf_(refId, types) {
  var per = {};
  rows_('StockMovements').forEach(function (m) {
    if (String(m.ref_id) !== refId || types.indexOf(String(m.reason_type)) < 0) return;
    var k = String(m.product_id) + '|' + m.reason_type;
    if (!per[k]) per[k] = { product_id: String(m.product_id), type: String(m.reason_type), qty: 0, unitCost: blank_(m.unit_cost) ? '' : rm6_(m.unit_cost) };
    per[k].qty = r3_(per[k].qty + Number(m.change_qty));
  });
  return Object.keys(per).map(function (k) { return per[k]; });
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
  var w = wasteTotals_(rows_('Waste').filter(function (x) { return String(x.datetime).slice(0, 10) === day; }));
  return { date: day, total_sales: toRm_(totalSen), orders: sales.length, voided: all.length - sales.length,
    by_method: methods, top_items: top, sales: list,
    waste_cost: toRm_(w.waste_cost_sen), waste_count: w.waste_count,
    waste_by_reason: w.by_reason.map(function (x) { return { reason: x.reason, cost: x.cost, lines: x.lines }; }),
    waste_by_staff: w.by_staff,
    waste_percent_of_sales: totalSen > 0 ? Math.round(w.waste_cost_sen * 10000 / totalSen) / 100 : null,
    staff_meal_cost: w.staff_meal_cost, staff_meal_count: w.staff_meal_count, waste_cost_missing_lines: w.cost_missing_lines,
    waste_dish_cost: w.dish_cost, waste_ingredient_cost: w.ingredient_cost,
    purchases_received: getPurchases_({ date_from: day, date_to: day }).total_received,
    below_reorder: rows_('Products').map(product_).filter(function (p) {
      return p.track_stock && p.reorder_level !== '' && p.stock <= p.reorder_level;
    }).map(function (p) { return { product_id: p.id, name: p.name, stock: p.stock, unit: p.unit, reorder_level: p.reorder_level }; }) };
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

    var products = productsById_();
    var recipes = recipeIndex_();
    var noRecipe = [];

    var set = settings_();
    var subtotal = 0;
    var itemRows = [];
    var own = [];
    var ing = [];
    lines.forEach(function (l) {
      var r = products[String(l.product_id)];
      if (!r) fail_('Unknown product');
      var p = product_(r);
      if (!p.active || p.kind !== 'menu') fail_(p.name + ' is not on sale');
      var qty = Number(l.qty);
      if (!(qty > 0) || Math.floor(qty) !== qty || qty > 999) fail_('Bad quantity for ' + p.name);
      var unit = toSen_(r.price);
      var lineSen = unit * qty;
      subtotal += lineSen;
      itemRows.push({ sale_id: saleId, product_id: p.id, name: p.name, qty: qty, unit_price: toRm_(unit),
        subtotal: toRm_(lineSen), note: cleanText_(l.note, 100) });
      var u = usageOf_(r, qty, products, recipes);
      own = own.concat(u.own);
      ing = ing.concat(u.ing);
      if (!u.own.length && !u.ing.length && noRecipe.indexOf(p.name) < 0) noRecipe.push(p.name);
    });

    var disc = d.discount || {};
    if (d._role === 'cashier' && Number(disc.value || 0) > 0) fail_('Only a supervisor can give a discount');
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
      status: 'paid', void_reason: '', made_at: '', cashier_id: String(d._actor || '')
    };
    sale.made_at = sale.datetime; // a paid order counts as made (a void asks whether it really was)
    var saleRow = sheet_('Sales').getLastRow() + 1;
    append_('Sales', [sale]);
    append_('SaleItems', itemRows);

    var warnings = moveStock_(own, 'sale', saleId, '', deviceId).concat(moveStock_(ing, 'sale_usage', saleId, '', deviceId));
    allocate_(ing, 1);

    var out2 = saleOut_(sale, itemRows, receiptNo_(saleRow));
    out2.duplicate = false;
    out2.warnings = warnings;
    out2.no_recipe = noRecipe;
    return out2;
  });
}

/**
 * data: { sale_id, reason, made }. Every paid sale counts as made, so the till asks "Was it already made?":
 *   made false (or not sent): nothing was used. The sale's own stock and recipe usage are put back exactly as the sale
 *     took them (void_return, sale_usage_reversal), and open-container usage is taken back.
 *   made true: the usage stays. It is moved from sales usage to dish waste (the same quantities back in and out as
 *     waste_dish, so stock doesn't change) and a Waste entry 'void-<sale_id>', reason cancelled_after_made, is written.
 */
function voidSale_(d) {
  var saleId = String(d.sale_id || '');
  var reason = cleanText_(d.reason, 200);
  if (reason.length < 3) fail_('A reason is required to void a sale');
  var made = d.made === true;
  return withLock_(function () {
    var s = findSale_(saleId);
    if (!s) fail_('Sale not found');
    if (s.status === 'void') return { sale_id: saleId, status: 'void', already: true };
    setCell_('Sales', s._row, 'status', 'void');
    setCell_('Sales', s._row, 'void_reason', reason);
    var products = productsById_();
    var dev = String(s.device_id || '');
    var used = movesOf_(saleId, ['sale', 'sale_usage']);
    var back = function (type) {
      return used.filter(function (u) { return u.type === type && products[u.product_id]; })
        .map(function (u) { return { r: products[u.product_id], qty: -u.qty, unitCost: u.unitCost }; });
    };
    var own = back('sale');
    var ing = back('sale_usage');
    moveStock_(own, 'void_return', saleId, '', dev);
    moveStock_(ing, 'sale_usage_reversal', saleId, '', dev);
    if (!made) {
      allocate_(ing, -1);
      return { sale_id: saleId, status: 'void', already: false, made: false };
    }
    moveStock_(own.concat(ing).map(function (c) { return { r: c.r, qty: -c.qty, unitCost: c.unitCost }; }), 'waste_dish', 'void-' + saleId, '', dev);
    var recipes = recipeIndex_();
    var when = now_();
    append_('Waste', itemsOf_(saleId).map(function (it, i) {
      var r = products[String(it.product_id)];
      var dc = r ? dishCost_(r, products, recipes) : { sen: 0, missing: true };
      var qty = Number(it.qty);
      return { waste_id: 'void-' + saleId, line_no: i + 1, datetime: when, product_id: String(it.product_id), name: it.name, qty: qty,
        unit: r ? product_(r).unit : 'pcs', unit_cost: dc.missing ? '' : toRm_(dc.sen), cost: dc.missing ? '' : toRm_(dc.sen * qty),
        reason: 'cancelled_after_made', note: reason, staff_name: '', device_id: dev, status: 'logged', reverses_waste_id: '', waste_type: 'dish' };
    }));
    return { sale_id: saleId, status: 'void', already: false, made: true, waste_id: 'void-' + saleId };
  });
}

/**
 * Add (no id) or edit a product. There is no delete: set active to false instead.
 * data: { id?, name, price, category, active, unit, cost (RM per unit, up to 6 decimals), kind, track_stock,
 *         stock (starting stock, new or newly tracked only), pack_size, pack_unit, reorder_level, open_shelf_life_days,
 *         max_open_containers, track_open }
 * Stock itself is never typed over here: starting stock is a stock_in movement, later changes go through purchases,
 * stocktakes or stockAdjust, and turning tracking off writes an adjustment that takes the balance to 0.
 * cost on an ingredient is kept by the server as its weighted average after each purchase; typing it sets it until then.
 */
function saveProduct_(d) {
  var name = cleanText_(d.name, 60);
  if (!name) fail_('Name is required');
  var price = toSen_(d.price);
  if (price < 0) fail_('Price can\'t be negative');
  var unit = String(d.unit || 'pcs');
  if (UNITS.indexOf(unit) < 0) fail_('Unit must be one of ' + UNITS.join(', '));
  var cost = blank_(d.cost) ? '' : Number(d.cost);
  if (cost !== '' && !(cost >= 0)) fail_('Cost must be a number, 0 or more');
  var kind = String(d.kind || 'menu');
  if (KINDS.indexOf(kind) < 0) fail_('Kind must be menu or ingredient');
  var blankStock = blank_(d.stock);
  var track = d.track_stock === undefined ? !blankStock : !!d.track_stock;
  var start = blankStock ? 0 : d.stock;
  if (track && !qtyOk_(start, unit)) fail_(DECIMAL_UNITS.indexOf(unit) >= 0 ? 'Stock: a number with up to 3 decimals' : 'Stock must be a whole number');
  start = r3_(start);
  var optNum = function (v, label, whole, min) {
    if (blank_(v)) return '';
    var n = Number(v);
    if (!isFinite(n) || n < min || (whole && Math.floor(n) !== n)) fail_(label);
    return whole ? n : r3_(n);
  };
  var staff = cleanText_(d.staff_name, 40);
  var dev = cleanText_(d.device_id, 40);
  var p = { name: name, price: toRm_(price), category: cleanText_(d.category, 30) || 'Other', active: d.active !== false,
    unit: unit, cost: cost === '' ? '' : rm6_(cost), kind: kind, track_stock: track,
    pack_size: optNum(d.pack_size, 'Pack size must be more than 0', false, 0.001), pack_unit: cleanText_(d.pack_unit, 20), base_unit: unit,
    reorder_level: optNum(d.reorder_level, 'Reorder level must be 0 or more', false, 0),
    open_shelf_life_days: optNum(d.open_shelf_life_days, 'Shelf life after opening: whole days, 0 or more', true, 0),
    max_open_containers: optNum(d.max_open_containers, 'Open containers allowed: a whole number, 1 or more', true, 1) || 1,
    track_open: !!d.track_open };
  if (p.track_open && !p.pack_size) fail_('Set a pack size to track open containers');
  return withLock_(function () {
    var sh = sheet_('Products');
    var write = function (row) {
      sh.getRange(row, 1, 1, TABS.Products.length).setValues([TABS.Products.map(function (c) { return p[c] === undefined ? '' : p[c]; })]);
    };
    var r;
    var startTracking = false;
    if (d.id) {
      r = rows_('Products').filter(function (x) { return String(x.id) === String(d.id); })[0];
      if (!r) fail_('Product not found');
      p.id = String(d.id);
      var old = product_(r);
      ['name', 'price', 'cost', 'category', 'active', 'unit', 'kind', 'pack_size', 'reorder_level', 'track_open'].forEach(function (k) {
        if (String(old[k]) !== String(p[k])) changeLog_(String(d._actor || ''), 'product', p.id, k, old[k], p[k]);
      });
      var was = tracked_(r);
      if (was && product_(r).unit !== unit) fail_('The unit can\'t change while stock is tracked (the history is in ' + product_(r).unit + ')');
      if (was && !track) {
        moveStock_([{ r: r, qty: -Number(r.stock) }], 'adjustment', 'tracking off', staff, dev);
        p.stock = '';
      } else if (!was && track) {
        p.stock = 0; startTracking = true;
      } else {
        p.stock = was ? Number(r.stock) : ''; // unchanged: use Receive, Count or Adjust to change it
      }
      write(r._row);
      r.cost = p.cost;
    } else {
      p.id = Utilities.getUuid();
      changeLog_(String(d._actor || ''), 'product', p.id, 'created', '', name + ' @ ' + p.price);
      p.stock = track ? 0 : '';
      r = { _row: sh.getLastRow() + 1, id: p.id, name: name, cost: p.cost };
      write(r._row);
      startTracking = track;
    }
    if (startTracking && start) {
      r.stock = 0;
      moveStock_([{ r: r, qty: start }], 'stock_in', 'starting stock', staff, dev);
      p.stock = start;
    }
    return p;
  });
}

/**
 * data: { movement_id, product_id, change_qty, reason_type: 'stock_in'|'adjustment', note, staff_name, device_id }
 * stock_in must be more than 0; an adjustment needs a reason. Stock in on an untracked product starts tracking it
 * from 0. The same movement_id twice returns the first result.
 */
function stockAdjust_(d) {
  var type = String(d.reason_type || '');
  if (type !== 'stock_in' && type !== 'adjustment') fail_('Choose Stock in or Adjust');
  var note = cleanText_(d.note, 200);
  if (type === 'adjustment' && note.length < 3) fail_('A reason is required for an adjustment');
  var mid = String(d.movement_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(mid)) fail_('Bad movement id');
  return withLock_(function () {
    var seen = rows_('StockMovements').filter(function (m) { return String(m.movement_id) === mid; })[0];
    if (seen) return { movement_id: mid, product_id: String(seen.product_id), balance_after: Number(seen.balance_after), duplicate: true, warnings: [] };
    var r = rows_('Products').filter(function (x) { return String(x.id) === String(d.product_id); })[0];
    if (!r) fail_('Unknown product');
    var p = product_(r);
    if (!qtyOk_(d.change_qty, p.unit) || Number(d.change_qty) === 0) fail_('Bad quantity for ' + p.name);
    var q = r3_(d.change_qty);
    if (Math.abs(q) > 100000) fail_('Quantity too large');
    if (type === 'stock_in' && q < 0) fail_('Stock in must be more than 0');
    if (!p.track_stock) {
      if (type !== 'stock_in') fail_(p.name + ' is not tracked. Use Stock in to start tracking it.');
      setCell_('Products', r._row, 'stock', 0);
      setCell_('Products', r._row, 'track_stock', true);
      r.stock = 0;
    }
    var warnings = moveStock_([{ r: r, qty: q }], type, note || type, cleanText_(d.staff_name, 40), cleanText_(d.device_id, 40), [mid]);
    return { movement_id: mid, product_id: p.id, balance_after: Number(r.stock), duplicate: false, warnings: warnings };
  });
}

// ---------- waste ----------

function wasteOut_(rows) {
  return rows.map(function (w) {
    return { waste_id: String(w.waste_id), line_no: Number(w.line_no), datetime: String(w.datetime), product_id: String(w.product_id),
      name: String(w.name), qty: Number(w.qty), unit: String(w.unit), unit_cost: blank_(w.unit_cost) ? '' : Number(w.unit_cost),
      cost: blank_(w.cost) ? '' : Number(w.cost), cost_missing: blank_(w.cost), reason: String(w.reason), note: String(w.note || ''),
      staff_name: String(w.staff_name || ''), status: String(w.status), reverses_waste_id: String(w.reverses_waste_id || ''),
      waste_type: String(w.waste_type || ''), emp_id: String(w.emp_id || ''), role: String(w.role || '') };
  });
}

/**
 * data: { waste_id, items: [{ product_id, qty, reason, note }], staff_name, device_id }
 * A menu item is dish waste: it takes out what a sale would (itself if stocked, plus its recipe) as waste_dish. An
 * ingredient is ingredient waste (waste_ingredient). Cost comes from the server: the dish cost, or the ingredient's
 * average cost; blank when unknown (cost_missing). The same waste_id again returns the lines already saved.
 */
function logWaste_(d) {
  var wid = String(d.waste_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(wid)) fail_('Bad waste id');
  return withLock_(function () {
    var saved = rows_('Waste').filter(function (w) { return String(w.waste_id) === wid; });
    if (saved.length) return { waste_id: wid, lines: wasteOut_(saved), duplicate: true, warnings: [] };

    var lines = Array.isArray(d.items) ? d.items : [];
    if (!lines.length) fail_('Add at least one item');
    if (lines.length > 50) fail_('At most 50 lines in one entry');
    var staff = cleanText_(d.staff_name, 40);
    var dev = cleanText_(d.device_id, 40);
    var products = productsById_();
    var recipes = recipeIndex_();
    var when = now_();
    var out = [];
    var dish = [];
    var dishIng = [];
    var ingr = [];
    lines.forEach(function (l, i) {
      var r = products[String(l.product_id)];
      if (!r) fail_('Unknown product');
      var p = product_(r);
      if (!p.active && !p.track_stock) fail_(p.name + ' is inactive and not tracked');
      if (!qtyOk_(l.qty, p.unit) || !(Number(l.qty) > 0)) {
        fail_('Bad quantity for ' + p.name + (DECIMAL_UNITS.indexOf(p.unit) >= 0 ? ' (more than 0, up to 3 decimals)' : ' (a whole number, 1 or more)'));
      }
      var qty = r3_(l.qty);
      if (qty > 999 && DECIMAL_UNITS.indexOf(p.unit) < 0) fail_('Quantity too large for ' + p.name + ' (999 at most)');
      if (qty > 100000) fail_('Quantity too large for ' + p.name);
      var type = p.kind === 'menu' ? 'dish' : 'ingredient';
      var reason = String(l.reason || '');
      if ((type === 'dish' ? DISH_REASONS : INGREDIENT_REASONS).indexOf(reason) < 0) fail_('Choose a reason for ' + p.name);
      var note = cleanText_(l.note, 100);
      if (reason === 'other' && note.length < 3) fail_('Add a note when the reason is "other"');
      var unitCostSen;
      var costSen;
      if (type === 'dish') {
        var dc = dishCost_(r, products, recipes);
        unitCostSen = dc.missing ? '' : dc.sen;
        costSen = dc.missing ? '' : dc.sen * qty;
        var u = usageOf_(r, qty, products, recipes);
        dish = dish.concat(u.own, u.ing);
        dishIng = dishIng.concat(u.ing);
      } else {
        var c = costOf_(r);
        unitCostSen = c === '' ? '' : c * 100;
        costSen = c === '' ? '' : valueSen_(c, qty);
        ingr.push({ r: r, qty: -qty });
      }
      out.push({ waste_id: wid, line_no: i + 1, datetime: when, product_id: p.id, name: p.name, qty: qty, unit: p.unit,
        unit_cost: unitCostSen === '' ? '' : (type === 'dish' ? toRm_(unitCostSen) : rm6_(unitCostSen / 100)),
        cost: costSen === '' ? '' : toRm_(costSen), reason: reason, note: note, staff_name: staff, device_id: dev,
        status: 'logged', reverses_waste_id: '', waste_type: type, emp_id: String(d._actor || ''), role: String(d._role || '') });
    });
    append_('Waste', out);
    var warnings = moveStock_(dish, 'waste_dish', wid, staff, dev).concat(moveStock_(ingr, 'waste_ingredient', wid, staff, dev));
    allocate_(dishIng, 1);
    return { waste_id: wid, lines: wasteOut_(out), duplicate: false, warnings: warnings };
  });
}

/**
 * data: { waste_id, reason, staff_name, device_id }. Marks the entry's lines 'reversed', adds reversal rows
 * (waste_id 'rev-<id>', negative qty and cost, status 'reversal', reverses_waste_id = the entry, note = the reason)
 * and puts back exactly what the entry took out (waste_reversal). A second call does nothing.
 */
function reverseWaste_(d) {
  var wid = String(d.waste_id || '');
  var reason = cleanText_(d.reason, 200);
  if (reason.length < 3) fail_('A reason is required to reverse waste');
  return withLock_(function () {
    var lines = rows_('Waste').filter(function (w) { return String(w.waste_id) === wid; });
    if (!lines.length) fail_('Waste entry not found');
    if (lines[0].status === 'reversal') fail_('That entry is itself a reversal');
    var open = lines.filter(function (w) { return w.status === 'logged'; });
    if (!open.length) return { waste_id: wid, status: 'reversed', already: true };
    var staff = cleanText_(d.staff_name, 40);
    var dev = cleanText_(d.device_id, 40);
    var products = productsById_();
    var when = now_();
    var rev = [];
    open.forEach(function (w) {
      setCell_('Waste', w._row, 'status', 'reversed');
      rev.push({ waste_id: 'rev-' + wid, line_no: Number(w.line_no), datetime: when, product_id: String(w.product_id), name: w.name,
        qty: -Number(w.qty), unit: w.unit, unit_cost: w.unit_cost, cost: blank_(w.cost) ? '' : -Number(w.cost), reason: w.reason,
        note: reason, staff_name: staff, device_id: dev, status: 'reversal', reverses_waste_id: wid, waste_type: w.waste_type,
        emp_id: String(d._actor || ''), role: String(d._role || '') });
    });
    append_('Waste', rev);
    var taken = movesOf_(wid, ['waste', 'waste_dish', 'waste_ingredient']).filter(function (m) { return products[m.product_id]; });
    var changes = taken.map(function (m) { return { r: products[m.product_id], qty: -m.qty, unitCost: m.unitCost }; });
    moveStock_(changes, 'waste_reversal', wid, staff, dev);
    allocate_(taken.filter(function (m) { return m.type === 'waste_dish'; }).map(function (m) { return { r: products[m.product_id], qty: m.qty }; }), -1);
    return { waste_id: wid, status: 'reversed', already: false };
  });
}

/**
 * Totals over logged lines only. Staff meals are left out of waste cost and reported on their own. Dish and
 * ingredient waste are split (rows from before waste_type existed are typed by the product's kind).
 */
function wasteTotals_(rows) {
  var kinds = null;
  var typeOf = function (w) {
    if (w.waste_type) return String(w.waste_type);
    if (!kinds) { kinds = {}; rows_('Products').forEach(function (r) { kinds[String(r.id)] = String(r.kind) === 'ingredient' ? 'ingredient' : 'dish'; }); }
    return kinds[String(w.product_id)] || 'dish';
  };
  var logged = rows.filter(function (w) { return w.status === 'logged'; });
  var waste = logged.filter(function (w) { return w.reason !== 'staff_meal'; });
  var meals = logged.filter(function (w) { return w.reason === 'staff_meal'; });
  var costOf = function (w) { return blank_(w.cost) ? 0 : toSen_(w.cost); };
  var sumSen = function (xs) { return xs.reduce(function (a, w) { return a + costOf(w); }, 0); };
  var entries = function (xs) { var o = {}; xs.forEach(function (w) { o[w.waste_id] = true; }); return Object.keys(o).length; };
  var byReason = {};
  var byProduct = {};
  var byStaff = {};
  var byType = { dish: 0, ingredient: 0 };
  waste.forEach(function (w) {
    byType[typeOf(w)] += costOf(w);
    var br = byReason[w.reason] || (byReason[w.reason] = { reason: String(w.reason), cost: 0, lines: 0 });
    br.cost += costOf(w); br.lines++;
    var k = String(w.product_id);
    var bp = byProduct[k] || (byProduct[k] = { product_id: k, name: String(w.name), unit: String(w.unit), qty: 0, cost: 0 });
    bp.qty = r3_(bp.qty + Number(w.qty)); bp.cost += costOf(w);
  });
  logged.forEach(function (w) {
    var who = String(w.emp_id || '') || String(w.staff_name || '') || '(unknown)';
    var bs = byStaff[who] || (byStaff[who] = { emp_id: String(w.emp_id || ''), name: String(w.staff_name || ''), role: String(w.role || ''), ids: {}, cost: 0, meal_cost: 0 });
    bs.ids[w.waste_id] = true;
    if (w.reason === 'staff_meal') bs.meal_cost += costOf(w); else bs.cost += costOf(w);
  });
  var staffList = Object.keys(byStaff).map(function (k) {
    var x = byStaff[k];
    return { emp_id: x.emp_id, name: x.name, role: x.role, entries: Object.keys(x.ids).length, cost: toRm_(x.cost), meal_cost: toRm_(x.meal_cost) };
  }).sort(function (a, b) { return b.cost - a.cost || b.entries - a.entries; });
  var list = function (o, by) {
    return Object.keys(o).map(function (k) { return o[k]; })
      .sort(function (a, b) { return b.cost - a.cost || b[by] - a[by]; })
      .map(function (x) { var y = {}; for (var f in x) y[f] = x[f]; y.cost = toRm_(x.cost); return y; });
  };
  return {
    waste_cost_sen: sumSen(waste), waste_count: entries(waste), by_reason: list(byReason, 'lines'), by_product: list(byProduct, 'qty'),
    by_staff: staffList,
    dish_cost: toRm_(byType.dish), ingredient_cost: toRm_(byType.ingredient),
    staff_meal_cost: toRm_(sumSen(meals)), staff_meal_count: entries(meals),
    cost_missing_lines: logged.filter(function (w) { return blank_(w.cost); }).length
  };
}

/** data: { date_from, date_to } as YYYY-MM-DD (Malaysia time), both optional (today). Rows newest first. */
function getWaste_(d) {
  var from = String(d.date_from || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  var to = String(d.date_to || from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail_('Bad date');
  var who = String(d.emp_id || '').trim().toLowerCase();
  var rows = rows_('Waste').filter(function (w) {
    var day = String(w.datetime).slice(0, 10);
    return day >= from && day <= to && (!who || String(w.emp_id || '').toLowerCase() === who);
  });
  var t = wasteTotals_(rows);
  return { date_from: from, date_to: to, by_staff: t.by_staff, rows: wasteOut_(rows).reverse(), waste_cost: toRm_(t.waste_cost_sen), waste_count: t.waste_count,
    by_reason: t.by_reason, by_product: t.by_product, staff_meal_cost: t.staff_meal_cost, staff_meal_count: t.staff_meal_count,
    dish_cost: t.dish_cost, ingredient_cost: t.ingredient_cost,
    cost_missing_lines: t.cost_missing_lines };
}

// ---------- purchases ----------

function dateOk_(s) { return s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function addDays_(days) { return Utilities.formatDate(new Date(Date.now() + days * 864e5), TZ, 'yyyy-MM-dd'); }

/**
 * data: { purchase_id, supplier, invoice_no, received_by, lines: [{ ingredient_id, pack_qty, pack_cost, batch_no, expiry_date }] }
 * Pack size comes from the product, never the request: total_qty = pack_qty × pack_size (in the base unit).
 * Each line updates the weighted average cost: (old qty × old avg + line cost) ÷ (old qty + qty received).
 * A product that isn't tracked yet starts tracking from 0. The same purchase_id again returns the saved lines.
 */
function receivePurchase_(d) {
  var pid = String(d.purchase_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(pid)) fail_('Bad purchase id');
  return withLock_(function () {
    var saved = rows_('Purchases').filter(function (x) { return String(x.purchase_id) === pid; });
    if (saved.length) return { purchase_id: pid, lines: saved.map(purchaseOut_), duplicate: true };
    var lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.length) fail_('Add at least one line');
    if (lines.length > 50) fail_('At most 50 lines in one delivery');
    var supplier = cleanText_(d.supplier, 60);
    if (!supplier) fail_('Supplier is required');
    var invoice = cleanText_(d.invoice_no, 40);
    var by = cleanText_(d.received_by, 40);
    if (!by) fail_('Enter who received it');
    var dev = cleanText_(d.device_id, 40);
    var products = productsById_();
    var when = now_();
    var out = [];
    var work = lines.map(function (l, i) {
      var r = products[String(l.ingredient_id)];
      if (!r) fail_('Unknown item');
      var p = product_(r);
      if (!qtyOk_(l.pack_qty, 'l') || !(Number(l.pack_qty) > 0) || Number(l.pack_qty) > 10000) fail_('Bad pack quantity for ' + p.name);
      if (blank_(l.pack_cost) || !(Number(l.pack_cost) >= 0)) fail_('Enter the cost per pack for ' + p.name);
      var exp = String(l.expiry_date || '');
      if (!dateOk_(exp)) fail_('Expiry date for ' + p.name + ' must be YYYY-MM-DD');
      var size = p.pack_size || 1;
      var total = r3_(Number(l.pack_qty) * size);
      if (!qtyOk_(total, p.unit)) fail_(p.name + ': ' + l.pack_qty + ' packs of ' + size + ' ' + p.unit + ' isn\'t a whole number of ' + p.unit);
      var lineSen = Math.round(toSen_(l.pack_cost) * Number(l.pack_qty));
      return { i: i, r: r, p: p, size: size, total: total, packCost: toRm_(toSen_(l.pack_cost)), lineSen: lineSen,
        unitCost: rm6_(lineSen / 100 / total), batch: cleanText_(l.batch_no, 30), exp: exp, packQty: r3_(l.pack_qty) };
    });
    work.forEach(function (w) {
      var r = w.r;
      if (!tracked_(r)) { setCell_('Products', r._row, 'stock', 0); setCell_('Products', r._row, 'track_stock', true); r.stock = 0; }
      var oldQty = Math.max(Number(r.stock), 0);
      var oldCost = costOf_(r);
      var oldValSen = (oldCost === '' ? w.unitCost : oldCost) * 100 * oldQty;
      var avg = rm6_((oldValSen + w.lineSen) / 100 / (oldQty + w.total));
      setCell_('Products', r._row, 'cost', avg);
      r.cost = avg;
      moveStock_([{ r: r, qty: w.total, unitCost: w.unitCost }], 'purchase', pid, by, dev);
      out.push({ purchase_id: pid, line_no: w.i + 1, datetime: when, supplier: supplier, invoice_no: invoice, ingredient_id: w.p.id,
        name: w.p.name, pack_qty: w.packQty, pack_size: w.size, base_unit: w.p.unit, total_qty: w.total, pack_cost: w.packCost,
        line_cost: toRm_(w.lineSen), unit_cost: w.unitCost, batch_no: w.batch, expiry_date: w.exp, received_by: by,
        status: 'received', reverses_purchase_id: '' });
    });
    append_('Purchases', out);
    return { purchase_id: pid, lines: out.map(purchaseOut_), duplicate: false };
  });
}

function purchaseOut_(x) {
  var o = {};
  TABS.Purchases.forEach(function (c) { o[c] = x[c]; });
  ['pack_qty', 'pack_size', 'total_qty', 'pack_cost', 'line_cost', 'unit_cost', 'line_no'].forEach(function (c) { o[c] = blank_(x[c]) ? '' : Number(x[c]); });
  o.purchase_id = String(x.purchase_id); o.ingredient_id = String(x.ingredient_id); o.datetime = String(x.datetime);
  return o;
}

/**
 * data: { purchase_id, reason, staff_name }. Marks the delivery 'reversed', adds 'rev-' rows with negative quantities and
 * takes the stock back out (purchase_reversal). The average cost is worked back as if the delivery hadn't happened
 * (left as it is when that isn't possible, e.g. the stock has already gone). A second call does nothing.
 */
function reversePurchase_(d) {
  var pid = String(d.purchase_id || '');
  var reason = cleanText_(d.reason, 200);
  if (reason.length < 3) fail_('A reason is required to reverse a delivery');
  return withLock_(function () {
    var lines = rows_('Purchases').filter(function (x) { return String(x.purchase_id) === pid; });
    if (!lines.length) fail_('Delivery not found');
    if (lines[0].status === 'reversal') fail_('That entry is itself a reversal');
    var open = lines.filter(function (x) { return x.status === 'received'; });
    if (!open.length) return { purchase_id: pid, status: 'reversed', already: true };
    var staff = cleanText_(d.staff_name, 40);
    var products = productsById_();
    var when = now_();
    var rev = [];
    open.forEach(function (x) {
      setCell_('Purchases', x._row, 'status', 'reversed');
      var r = products[String(x.ingredient_id)];
      var total = Number(x.total_qty);
      if (r) {
        var qty = Number(r.stock);
        var cost = costOf_(r);
        var left = qty - total;
        if (cost !== '' && left > 0) {
          var avg = (cost * qty - Number(x.line_cost)) / left;
          if (avg >= 0) { setCell_('Products', r._row, 'cost', rm6_(avg)); r.cost = rm6_(avg); }
        }
        moveStock_([{ r: r, qty: -total, unitCost: rm6_(x.unit_cost) }], 'purchase_reversal', pid, staff, '');
      }
      var o = purchaseOut_(x);
      o.purchase_id = 'rev-' + pid; o.datetime = when; o.pack_qty = -o.pack_qty; o.total_qty = -total; o.line_cost = -o.line_cost;
      o.received_by = staff; o.status = 'reversal'; o.reverses_purchase_id = pid; o.batch_no = reason.slice(0, 30);
      rev.push(o);
    });
    append_('Purchases', rev);
    return { purchase_id: pid, status: 'reversed', already: false };
  });
}

/** data: { date_from, date_to } (YYYY-MM-DD, default today). Deliveries newest first, with the total received. */
function getPurchases_(d) {
  var from = String(d.date_from || today_());
  var to = String(d.date_to || from);
  if (!dateOk_(from) || !dateOk_(to)) fail_('Bad date');
  var rows = rows_('Purchases').filter(function (x) { var day = String(x.datetime).slice(0, 10); return day >= from && day <= to; });
  var totalSen = rows.filter(function (x) { return x.status === 'received'; }).reduce(function (a, x) { return a + toSen_(x.line_cost); }, 0);
  return { date_from: from, date_to: to, rows: rows.map(purchaseOut_).reverse(), total_received: toRm_(totalSen) };
}

// ---------- recipes ----------

/**
 * data: { menu_product_id, lines: [{ ingredient_id, qty, note }] } replaces that menu item's recipe (no lines = no recipe).
 * Quantities are per one serving, in the ingredient's unit. An item can't be in its own recipe (it already deducts
 * itself when it tracks stock), and each ingredient appears once.
 */
function saveRecipe_(d) {
  var menuId = String(d.menu_product_id || '');
  var lines = Array.isArray(d.lines) ? d.lines : [];
  if (lines.length > 50) fail_('At most 50 ingredients in a recipe');
  return withLock_(function () {
    var products = productsById_();
    var m = products[menuId];
    if (!m || product_(m).kind !== 'menu') fail_('Choose a menu item');
    var seen = {};
    var rows = lines.map(function (l) {
      var ir = products[String(l.ingredient_id)];
      if (!ir) fail_('Unknown ingredient');
      var ip = product_(ir);
      if (ip.id === menuId) fail_(ip.name + ' can\'t be in its own recipe: it already deducts itself when it tracks stock');
      if (seen[ip.id]) fail_(ip.name + ' is in the recipe twice');
      seen[ip.id] = true;
      if (!qtyOk_(l.qty, ip.unit) || !(Number(l.qty) > 0)) fail_('Bad quantity for ' + ip.name + ' (in ' + ip.unit + ')');
      return { recipe_id: Utilities.getUuid(), menu_product_id: menuId, ingredient_id: ip.id, qty: r3_(l.qty), unit: ip.unit,
        note: cleanText_(l.note, 100), modifier_id: '' };
    });
    var describe = function (list) { return list.map(function (x) { return (products[String(x.ingredient_id)] || {}).name + ' ' + x.qty + ' ' + x.unit; }).join(', '); };
    var before = describe(rows_('Recipes').filter(function (x) { return String(x.menu_product_id) === menuId && !String(x.modifier_id || ''); }));
    if (before !== describe(rows)) changeLog_(String(d._actor || ''), 'recipe', menuId, String(m.name), before, describe(rows));
    var keep = rows_('Recipes').filter(function (x) { return String(x.menu_product_id) !== menuId || String(x.modifier_id || ''); });
    rewrite_('Recipes', keep.concat(rows));
    return recipeOut_(m, products, recipeIndex_());
  });
}

/** Replaces every data row of a settings tab (Recipes only: it isn't a ledger, so rewriting it is allowed). */
function rewrite_(name, objs) {
  var sh = sheet_(name);
  var cols = TABS[name];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).clearContent();
  if (objs.length) sh.getRange(2, 1, objs.length, cols.length).setValues(objs.map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : o[c]; }); }));
}

function recipeOut_(m, products, recipes) {
  var p = product_(m);
  var lines = (recipes[p.id] || []).map(function (x) {
    var ir = products[String(x.ingredient_id)];
    var c = ir ? costOf_(ir) : '';
    return { ingredient_id: String(x.ingredient_id), name: ir ? String(ir.name) : '(missing item)', qty: Number(x.qty), unit: String(x.unit),
      unit_cost: c, cost: c === '' ? '' : toRm_(valueSen_(c, Number(x.qty))), note: String(x.note || '') };
  });
  var dc = dishCost_(m, products, recipes);
  var priceSen = toSen_(m.price);
  var deducts = (p.track_stock ? ['itself'] : []).concat(lines.length ? [lines.length + ' ingredient' + (lines.length > 1 ? 's' : '')] : []);
  return { menu_product_id: p.id, name: p.name, price: p.price, active: p.active, lines: lines, cost: toRm_(dc.sen), cost_missing: dc.missing,
    margin: toRm_(priceSen - dc.sen), margin_percent: priceSen > 0 ? Math.round((priceSen - dc.sen) * 1000 / priceSen) / 10 : null,
    deducts: deducts.length ? deducts.join(' + ') : '', warning: deducts.length ? '' : 'No recipe: stock not tracked for this dish' };
}

/** Every menu item with its recipe, cost and margin. */
function getRecipes_() {
  var products = productsById_();
  var recipes = recipeIndex_();
  return Object.keys(products).map(function (k) { return products[k]; })
    .filter(function (r) { return product_(r).kind === 'menu'; })
    .map(function (r) { return recipeOut_(r, products, recipes); });
}

// ---------- open containers ----------

function containerOut_(k) {
  var o = {};
  TABS.OpenContainers.forEach(function (c) { o[c] = k[c]; });
  ['size', 'est_remaining', 'allocated_qty'].forEach(function (c) { o[c] = blank_(k[c]) ? 0 : Number(k[c]); });
  o.variance = blank_(k.variance) ? '' : Number(k.variance);
  o.overrun = bool_(k.overrun);
  o.container_id = String(k.container_id); o.ingredient_id = String(k.ingredient_id);
  o.opened_at = String(k.opened_at); o.use_by = String(k.use_by || ''); o.finished_at = String(k.finished_at || '');
  var today = today_();
  o.use_by_flag = !o.use_by || o.status !== 'open' ? '' : o.use_by < today ? 'past' : o.use_by <= addDays_(1) ? 'near' : '';
  return o;
}

function findContainer_(id) {
  return rows_('OpenContainers').filter(function (k) { return String(k.container_id) === id; })[0];
}

/**
 * data: { container_id, ingredient_id, station, reason, note, staff_name, device_id }
 * Needs a sealed pack in stock (on hand minus what is left in open containers). When the station already has
 * max_open_containers open, nothing is written and the reply is { needs_reason, open: [...] } so the till can show who
 * opened what and when; sending again with a reason opens it. The ingredient total never changes here.
 */
function openContainer_(d) {
  var cid = String(d.container_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(cid)) fail_('Bad container id');
  return withLock_(function () {
    var seen = findContainer_(cid);
    if (seen) return { container: containerOut_(seen), duplicate: true };
    var products = productsById_();
    var r = products[String(d.ingredient_id)];
    if (!r) fail_('Unknown item');
    var p = product_(r);
    if (!p.track_open) fail_(p.name + ' isn\'t set up for open containers (Products: track open)');
    if (!p.track_stock) fail_(p.name + ' doesn\'t track stock');
    var station = cleanText_(d.station, 30) || 'bar';
    var staff = cleanText_(d.staff_name, 40);
    if (!staff) fail_('Enter your name');
    var all = rows_('OpenContainers').filter(function (k) { return k.status === 'open' && String(k.ingredient_id) === p.id; });
    var openLeft = all.reduce(function (a, k) { return a + Number(k.est_remaining || 0); }, 0);
    var sealed = r3_(p.stock - openLeft);
    if (sealed + 1e-9 < p.pack_size) {
      fail_('No sealed ' + (p.pack_unit || 'pack') + ' of ' + p.name + ' in stock (sealed: ' + Math.max(sealed, 0) + ' ' + p.unit + '). Receive stock first.');
    }
    var here = all.filter(function (k) { return String(k.station) === station; });
    var reason = String(d.reason || '');
    var note = cleanText_(d.note, 100);
    if (here.length >= p.max_open_containers) {
      if (!reason) {
        return { needs_reason: true, open: here.map(containerOut_), reasons: OPEN_REASONS,
          message: here.map(function (k) {
            return p.name + ' is already open since ' + String(k.opened_at).slice(11, 16) + (k.opened_by ? ' by ' + k.opened_by : '') +
              ', about ' + r3_(Number(k.est_remaining || 0)) + ' ' + p.unit + ' left.';
          }).join(' ') + ' Open another?' };
      }
      if (OPEN_REASONS.indexOf(reason) < 0) fail_('Choose why another one is being opened');
      if (reason === 'other' && note.length < 3) fail_('Add a note when the reason is "other"');
    } else {
      reason = '';
    }
    var k = { container_id: cid, ingredient_id: p.id, size: p.pack_size, opened_at: now_(), opened_by: staff,
      use_by: blank_(p.open_shelf_life_days) ? '' : addDays_(p.open_shelf_life_days), status: 'open', est_remaining: p.pack_size,
      finished_at: '', discarded_reason: '', note: note, station: station, open_reason: reason, allocated_qty: 0, variance: '', overrun: false };
    append_('OpenContainers', [k]);
    noteMove_(r, 'container_open', cid, staff, cleanText_(d.device_id, 40));
    return { container: containerOut_(k), duplicate: false, double_open: !!reason };
  });
}

/** data: { container_id, staff_name }. Empty: variance = size − usage the recipes put against it. Again = no change. */
function finishContainer_(d) {
  var cid = String(d.container_id || '');
  return withLock_(function () {
    var k = findContainer_(cid);
    if (!k) fail_('Container not found');
    if (k.status !== 'open') return { container: containerOut_(k), already: true };
    var variance = r3_(Number(k.size) - Number(k.allocated_qty || 0));
    var when = now_();
    setCell_('OpenContainers', k._row, 'status', 'finished');
    setCell_('OpenContainers', k._row, 'finished_at', when);
    setCell_('OpenContainers', k._row, 'est_remaining', 0);
    setCell_('OpenContainers', k._row, 'variance', variance);
    k.status = 'finished'; k.finished_at = when; k.est_remaining = 0; k.variance = variance;
    var r = productsById_()[String(k.ingredient_id)];
    if (r) noteMove_(r, 'container_finish', cid, cleanText_(d.staff_name, 40), cleanText_(d.device_id, 40));
    return { container: containerOut_(k), already: false };
  });
}

/**
 * data: { container_id, reason, remaining_estimate ('50%' or a quantity), note, staff_name }. Throws the rest away:
 * a waste_ingredient entry ('disc-<container_id>') for what was left, and the container closes as discarded.
 */
function discardContainer_(d) {
  var cid = String(d.container_id || '');
  var reason = String(d.reason || '');
  if (DISCARD_REASONS.indexOf(reason) < 0) fail_('Choose a reason');
  var note = cleanText_(d.note, 100);
  if (reason === 'other' && note.length < 3) fail_('Add a note when the reason is "other"');
  var staff = cleanText_(d.staff_name, 40);
  return withLock_(function () {
    var k = findContainer_(cid);
    if (!k) fail_('Container not found');
    if (k.status !== 'open') return { container: containerOut_(k), already: true };
    var size = Number(k.size);
    var est = String(d.remaining_estimate === undefined ? '' : d.remaining_estimate).trim();
    var rem;
    if (/^\d+(\.\d+)?%$/.test(est)) rem = size * Number(est.slice(0, -1)) / 100;
    else if (/^\d+(\.\d+)?$/.test(est)) rem = Number(est);
    else fail_('How much is left? A percentage (50%) or a quantity');
    rem = r3_(Math.min(Math.max(rem, 0), size));
    var products = productsById_();
    var r = products[String(k.ingredient_id)];
    var p = r ? product_(r) : null;
    var when = now_();
    if (rem > 0 && r) {
      var c = costOf_(r);
      append_('Waste', [{ waste_id: 'disc-' + cid, line_no: 1, datetime: when, product_id: p.id, name: p.name, qty: rem, unit: p.unit,
        unit_cost: c, cost: c === '' ? '' : toRm_(valueSen_(c, rem)), reason: reason, note: note, staff_name: staff,
        device_id: cleanText_(d.device_id, 40), status: 'logged', reverses_waste_id: '', waste_type: 'ingredient',
        emp_id: String(d._actor || ''), role: String(d._role || '') }]);
      moveStock_([{ r: r, qty: -rem }], 'waste_ingredient', 'disc-' + cid, staff, cleanText_(d.device_id, 40));
    }
    var variance = r3_(size - Number(k.allocated_qty || 0) - rem);
    setCell_('OpenContainers', k._row, 'status', 'discarded');
    setCell_('OpenContainers', k._row, 'finished_at', when);
    setCell_('OpenContainers', k._row, 'discarded_reason', reason);
    setCell_('OpenContainers', k._row, 'est_remaining', 0);
    setCell_('OpenContainers', k._row, 'variance', variance);
    if (note) setCell_('OpenContainers', k._row, 'note', note);
    k.status = 'discarded'; k.finished_at = when; k.discarded_reason = reason; k.est_remaining = 0; k.variance = variance;
    return { container: containerOut_(k), already: false, wasted: rem };
  });
}

/** Open containers (use-by past first), plus finished/discarded and double-open events within the dates. */
function getContainers_(d) {
  var from = String(d.date_from || addDays_(-7));
  var to = String(d.date_to || today_());
  var all = rows_('OpenContainers').map(containerOut_);
  var rank = { past: 0, near: 1, '': 2 };
  var open = all.filter(function (k) { return k.status === 'open'; })
    .sort(function (a, b) { return rank[a.use_by_flag] - rank[b.use_by_flag] || (a.opened_at < b.opened_at ? -1 : 1); });
  var inRange = function (s) { var day = String(s).slice(0, 10); return day >= from && day <= to; };
  return {
    open: open,
    closed: all.filter(function (k) { return k.status !== 'open' && inRange(k.finished_at); }).reverse(),
    double_opens: all.filter(function (k) { return k.open_reason && inRange(k.opened_at); }).reverse()
  };
}

// ---------- stocktake ----------

/**
 * data: { count_id, counted_by, lines: [{ ingredient_id, counted_qty } or { ingredient_id, sealed_packs, open: ['50%', 120] },
 *         note }] }
 * The server works out what the ledger expects, the variance and its value, and writes a stocktake_adjustment so the
 * balance after equals the count. Above COUNT_VARIANCE_PERCENT a line needs a note. The same count_id again = no change.
 */
function stockCount_(d) {
  var cid = String(d.count_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(cid)) fail_('Bad count id');
  return withLock_(function () {
    var saved = rows_('StockCounts').filter(function (x) { return String(x.count_id) === cid; });
    if (saved.length) return { count_id: cid, lines: saved.map(countOut_), duplicate: true };
    var lines = Array.isArray(d.lines) ? d.lines : [];
    if (!lines.length) fail_('Count at least one item');
    if (lines.length > 300) fail_('At most 300 lines in one count');
    var by = cleanText_(d.counted_by, 40);
    if (!by) fail_('Enter who counted');
    var limit = Number(PropertiesService.getScriptProperties().getProperty('COUNT_VARIANCE_PERCENT') || 5);
    var products = productsById_();
    var seen = {};
    var when = now_();
    var work = lines.map(function (l, i) {
      var r = products[String(l.ingredient_id)];
      if (!r) fail_('Unknown item');
      var p = product_(r);
      if (seen[p.id]) fail_(p.name + ' is in the count twice');
      seen[p.id] = true;
      var counted;
      if (!blank_(l.counted_qty)) {
        if (!qtyOk_(l.counted_qty, p.unit) || Number(l.counted_qty) < 0) fail_('Bad count for ' + p.name);
        counted = r3_(l.counted_qty);
      } else {
        var packs = Number(l.sealed_packs || 0);
        if (!(packs >= 0) || Math.floor(packs) !== packs) fail_('Sealed packs for ' + p.name + ': a whole number');
        counted = packs * (p.pack_size || 1);
        (Array.isArray(l.open) ? l.open : []).forEach(function (o) {
          var s = String(o).trim();
          if (/^\d+(\.\d+)?%$/.test(s)) counted += (p.pack_size || 0) * Math.min(Number(s.slice(0, -1)), 100) / 100;
          else if (/^\d+(\.\d+)?$/.test(s)) counted += Number(s);
          else fail_('Open containers of ' + p.name + ': 0%, 25%, 50%, 75%, 100% or a quantity');
        });
        counted = r3_(counted);
      }
      var expected = p.track_stock ? p.stock : 0;
      var variance = r3_(counted - expected);
      var pct = expected > 0 ? Math.abs(variance) * 100 / expected : (variance ? 100 : 0);
      var note = cleanText_(l.note, 200);
      if (pct > limit && note.length < 3) {
        fail_(p.name + ': counted ' + counted + ' ' + p.unit + ', expected ' + expected + ' (' + Math.round(pct * 10) / 10 + '% off). Add a reason.');
      }
      var c = costOf_(r);
      return { r: r, row: { count_id: cid, line_no: i + 1, datetime: when, ingredient_id: p.id, name: p.name, counted_qty: counted,
        expected_qty: expected, variance: variance, variance_value: c === '' ? '' : toRm_(valueSen_(c, variance)), counted_by: by,
        note: note, status: 'confirmed' } };
    });
    append_('StockCounts', work.map(function (w) { return w.row; }));
    work.forEach(function (w) {
      if (!tracked_(w.r)) { setCell_('Products', w.r._row, 'stock', 0); setCell_('Products', w.r._row, 'track_stock', true); w.r.stock = 0; }
      if (w.row.variance) moveStock_([{ r: w.r, qty: w.row.variance }], 'stocktake_adjustment', cid, by, cleanText_(d.device_id, 40));
    });
    return { count_id: cid, lines: work.map(function (w) { return countOut_(w.row); }), duplicate: false };
  });
}

function countOut_(x) {
  var o = {};
  TABS.StockCounts.forEach(function (c) { o[c] = x[c]; });
  ['line_no', 'counted_qty', 'expected_qty', 'variance'].forEach(function (c) { o[c] = Number(x[c]); });
  o.variance_value = blank_(x.variance_value) ? '' : Number(x.variance_value);
  o.count_id = String(x.count_id); o.ingredient_id = String(x.ingredient_id); o.datetime = String(x.datetime);
  return o;
}

// ---------- reports ----------

var BUCKETS = {
  purchase: 'purchases', stock_in: 'purchases', purchase_reversal: 'purchases',
  sale: 'sales_usage', sale_usage: 'sales_usage', void_return: 'sales_usage', sale_usage_reversal: 'sales_usage',
  waste_dish: 'dish_waste', waste_ingredient: 'ingredient_waste', waste_reversal: 'waste_reversals',
  adjustment: 'adjustments', stocktake_adjustment: 'adjustments'
};

/**
 * Stock on hand per tracked item: sealed + open, value at average cost, reorder flag, nearest expiry from deliveries,
 * open containers, and the reconciliation check: the stock column must equal the sum of every movement.
 */
function getStockReport_() {
  var products = productsById_();
  var moves = rows_('StockMovements');
  var sum = {};
  moves.forEach(function (m) { var k = String(m.product_id); sum[k] = r3_((sum[k] || 0) + Number(m.change_qty || 0)); });
  var open = rows_('OpenContainers').filter(function (k) { return k.status === 'open'; });
  var today = today_();
  var expiry = {};
  rows_('Purchases').forEach(function (x) {
    var e = String(x.expiry_date || '');
    if (x.status !== 'received' || !e || e < today) return;
    var k = String(x.ingredient_id);
    if (!expiry[k] || e < expiry[k]) expiry[k] = e;
  });
  var items = Object.keys(products).map(function (k) { return products[k]; }).filter(function (r) {
    return tracked_(r) || String(r.kind) === 'ingredient';
  }).map(function (r) {
    var p = product_(r);
    var openLeft = r3_(open.filter(function (k) { return String(k.ingredient_id) === p.id; }).reduce(function (a, k) { return a + Number(k.est_remaining || 0); }, 0));
    var ledger = sum[p.id] || 0;
    var v = p.track_stock && p.cost !== '' ? valueSen_(p.cost, Math.max(p.stock, 0)) : '';
    return { product_id: p.id, name: p.name, kind: p.kind, unit: p.unit, active: p.active, track_stock: p.track_stock,
      on_hand: p.track_stock ? p.stock : '', open_remaining: openLeft, sealed: p.track_stock ? r3_(p.stock - openLeft) : '',
      avg_cost: p.cost, value: v === '' ? '' : toRm_(v), reorder_level: p.reorder_level,
      below_reorder: p.track_stock && p.reorder_level !== '' && p.stock <= p.reorder_level,
      nearest_expiry: expiry[p.id] || '', pack_size: p.pack_size, pack_unit: p.pack_unit, track_open: p.track_open,
      ledger_total: ledger, difference: p.track_stock ? r3_(p.stock - ledger) : 0 };
  });
  var totalSen = items.reduce(function (a, x) { return a + (x.value === '' ? 0 : toSen_(x.value)); }, 0);
  return { items: items, total_value: toRm_(totalSen), reconciled: items.every(function (x) { return !x.difference; }),
    containers: open.map(containerOut_) };
}

/**
 * Usage vs theoretical per item for a period: opening + purchases + sales usage + dish waste + ingredient waste
 * + waste reversals + adjustments = closing. When the period runs to today, closing must equal on hand (difference).
 * Old 'waste' rows count as dish or ingredient waste by the item's kind.
 */
function getUsageReport_(d) {
  var from = String(d.date_from || addDays_(-6));
  var to = String(d.date_to || today_());
  if (!dateOk_(from) || !dateOk_(to)) fail_('Bad date');
  var products = productsById_();
  var per = {};
  rows_('StockMovements').forEach(function (m) {
    var k = String(m.product_id);
    var r = products[k];
    if (!r) return;
    var x = per[k] || (per[k] = { product_id: k, name: String(r.name), unit: product_(r).unit, opening: 0, purchases: 0, sales_usage: 0,
      dish_waste: 0, ingredient_waste: 0, waste_reversals: 0, adjustments: 0 });
    var day = String(m.datetime).slice(0, 10);
    var q = Number(m.change_qty || 0);
    if (day < from) { x.opening = r3_(x.opening + q); return; }
    if (day > to) return;
    var type = String(m.reason_type);
    var b = type === 'waste' ? (String(r.kind) === 'ingredient' ? 'ingredient_waste' : 'dish_waste') : BUCKETS[type];
    if (b) x[b] = r3_(x[b] + q);
  });
  var toToday = to >= today_();
  var rows = Object.keys(per).map(function (k) {
    var x = per[k];
    x.closing = r3_(x.opening + x.purchases + x.sales_usage + x.dish_waste + x.ingredient_waste + x.waste_reversals + x.adjustments);
    var p = product_(products[k]);
    x.on_hand = p.track_stock ? p.stock : '';
    x.difference = toToday && p.track_stock ? r3_(p.stock - x.closing) : '';
    return x;
  });
  return { date_from: from, date_to: to, rows: rows, reconciled: rows.every(function (x) { return !x.difference; }) };
}

// ---------- staff, login and roles (POS role & access spec) ----------
//
// Every call except login needs a session token from login (Employee ID + PIN). The role on the Staff tab decides
// what the call may do; the screens hide what a role can't use, and the server refuses it anyway.
//   cashier:    checkout only. A void needs a supervisor's own ID + PIN in the same request.
//   supervisor: everything on the floor (checkout, void, discount, waste, stock, reports), not prices/menu/staff.
//   admin:      back office (prices, menu, recipes, staff, reports, stock), never checkout or void.
// PINs are stored as salted SHA-256 hashes. 5 wrong PINs lock the account until an admin unlocks it. Sessions end
// after SESSION_IDLE_MIN minutes without a call (default 15). Staff come only from allurus-hr (ALLURUS_TENANT), except
// the starter account 'admin' (PIN 0000, must be changed at first login, can't be deleted or demoted).

var ROLES = ['cashier', 'supervisor', 'admin'];
var ALL = ROLES;
var FLOOR = ['cashier', 'supervisor'];
var MANAGE = ['supervisor', 'admin'];
var ADMIN = ['admin'];
var ACCESS = {
  getProducts: ALL, getSale: ALL, findSale: ALL, whoami: ALL, logout: ALL, changePin: ALL,
  createSale: FLOOR, voidSale: FLOOR,
  getDailySummary: MANAGE, getVoidLog: MANAGE,
  logWaste: ALL, reverseWaste: MANAGE, getWaste: MANAGE, stockAdjust: MANAGE,
  receivePurchase: MANAGE, reversePurchase: MANAGE, getPurchases: MANAGE,
  openContainer: MANAGE, finishContainer: MANAGE, discardContainer: MANAGE, getContainers: MANAGE,
  stockCount: MANAGE, getStockReport: MANAGE, getUsageReport: MANAGE, getRecipes: MANAGE,
  saveProduct: ADMIN, saveRecipe: ADMIN,
  listStaff: ADMIN, hrSearch: ADMIN, addStaff: ADMIN, updateStaff: ADMIN, getAuditLog: ADMIN,
  getClosing: ALL, closeDay: ALL, getClosings: MANAGE, setShopItem: MANAGE,
  setOpening: FLOOR, getClosingStock: MANAGE, getClosingDetail: ADMIN
};
var VOID_REASONS = { customer_changed: 'Customer changed order', wrong_item: 'Wrong item keyed in', payment_failed: 'Payment failed',
  duplicate: 'Duplicate bill', complaint: 'Customer complaint', other: 'Other' };

function authSettings_() {
  var p = PropertiesService.getScriptProperties();
  return { idleMin: Number(p.getProperty('SESSION_IDLE_MIN') || 15), outlet: p.getProperty('OUTLET_NAME') || 'Outlet 1',
    project: p.getProperty('ALLURUS_PROJECT') || 'allurus-hr', tenant: p.getProperty('ALLURUS_TENANT') || '' };
}

function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function pinHash_(salt, pin) {
  var h = salt + ':' + pin;
  for (var i = 0; i < 300; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + ':' + salt));
  return h;
}
function pinOk_(pin) { return /^\d{4,6}$/.test(String(pin || '')); }
function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }

function staffRows_() { return rows_('Staff'); }
function findStaff_(id) {
  id = String(id || '').trim().toLowerCase();
  return staffRows_().filter(function (s) { return String(s.emp_id).toLowerCase() === id; })[0] || null;
}
function staffOut_(s) {
  return { emp_id: String(s.emp_id), name: String(s.name), role: String(s.role), status: String(s.status), failed_attempts: Number(s.failed_attempts || 0),
    must_change_pin: bool_(s.must_change_pin), hr_status: String(s.hr_status || ''), created_at: String(s.created_at || ''), updated_at: String(s.updated_at || '') };
}
function staffLog_(actor, action, empId, detail) {
  append_('StaffLog', [{ log_id: Utilities.getUuid(), datetime: now_(), actor: actor, action: action, emp_id: empId, detail: detail || '' }]);
}
function changeLog_(actor, entity, id, field, before, after) {
  append_('ChangeLog', [{ log_id: Utilities.getUuid(), datetime: now_(), actor: actor, entity: entity, entity_id: id, field: field,
    old_value: before === undefined ? '' : String(before), new_value: after === undefined ? '' : String(after) }]);
}

/**
 * Checks an Employee ID + PIN. Wrong PINs count towards the lock (5 = locked); a right one resets the count.
 * Returns the Staff row. Messages don't say whether the ID exists, except for a locked or disabled account.
 */
function checkPin_(empId, pin) {
  var s = findStaff_(empId);
  if (!s || !pinOk_(pin)) fail_('Wrong Employee ID or PIN');
  if (s.status === 'locked') fail_('This account is locked after 5 wrong PINs. Ask an admin to unlock it.');
  if (s.status !== 'active') fail_('This account is disabled. Ask an admin.');
  if (pinHash_(String(s.pin_salt), String(pin)) !== String(s.pin_hash)) {
    var n = Number(s.failed_attempts || 0) + 1;
    setCell_('Staff', s._row, 'failed_attempts', n);
    if (n >= 5) {
      setCell_('Staff', s._row, 'status', 'locked');
      staffLog_('system', 'locked', String(s.emp_id), '5 wrong PINs');
      fail_('Wrong PIN. The account is now locked. Ask an admin to unlock it.');
    }
    fail_('Wrong Employee ID or PIN (' + (5 - n) + ' tries left)');
  }
  if (Number(s.failed_attempts || 0)) setCell_('Staff', s._row, 'failed_attempts', 0);
  return s;
}

function login_(d) {
  return withLock_(function () {
    var s = checkPin_(d.emp_id, d.pin);
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    var set = authSettings_();
    // v ties the session to this PIN: a PIN change or reset ends every other session of this person.
    CacheService.getScriptCache().put('sess:' + token, JSON.stringify({ emp_id: String(s.emp_id), v: String(s.pin_salt) }), set.idleMin * 60);
    staffLog_(String(s.emp_id), 'login', String(s.emp_id), String(d.device_id || '').slice(0, 40));
    return { token: token, emp_id: String(s.emp_id), name: String(s.name), role: String(s.role), must_change_pin: bool_(s.must_change_pin),
      idle_minutes: set.idleMin, outlet: set.outlet, state: sessionState_({ emp_id: String(s.emp_id), role: String(s.role) }) };
  });
}

/** The caller behind a token, re-checked against the Staff tab on every call (a disabled account stops at once). */
function session_(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) fail_('SIGNED_OUT: Please sign in.');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('sess:' + token);
  if (!raw) fail_('SIGNED_OUT: Your session ended. Please sign in again.');
  var sess = JSON.parse(raw);
  var s = findStaff_(sess.emp_id);
  if (!s || s.status !== 'active') { cache.remove('sess:' + token); fail_('SIGNED_OUT: This account is no longer active.'); }
  if (String(s.pin_salt) !== sess.v) { cache.remove('sess:' + token); fail_('SIGNED_OUT: Your PIN was changed. Please sign in again.'); }
  cache.put('sess:' + token, raw, authSettings_().idleMin * 60); // idle timer restarts with every call
  return { token: token, emp_id: String(s.emp_id), name: String(s.name), role: String(s.role), must_change_pin: bool_(s.must_change_pin), row: s };
}

function logout_(d, sess) { CacheService.getScriptCache().remove('sess:' + sess.token); return { ok: true }; }
function whoami_(d, sess) {
  return { emp_id: sess.emp_id, name: sess.name, role: sess.role, must_change_pin: sess.must_change_pin, outlet: authSettings_().outlet,
    state: sessionState_(sess) };
}

/** data: { old_pin, new_pin }. 4-6 digits, not 0000, not the same as before. Clears "must change". */
function changePin_(d, sess) {
  return withLock_(function () {
    var s = checkPin_(sess.emp_id, d.old_pin);
    var pin = String(d.new_pin || '');
    if (!pinOk_(pin)) fail_('The new PIN must be 4 to 6 digits');
    if (/^(\d)\1+$/.test(pin) || pin === '1234' || pin === '123456') fail_('Choose a PIN that is harder to guess');
    if (pin === String(d.old_pin)) fail_('The new PIN must be different');
    var salt = newSalt_();
    setCell_('Staff', s._row, 'pin_salt', salt);
    setCell_('Staff', s._row, 'pin_hash', pinHash_(salt, pin));
    setCell_('Staff', s._row, 'must_change_pin', false);
    setCell_('Staff', s._row, 'updated_at', now_());
    CacheService.getScriptCache().put('sess:' + sess.token, JSON.stringify({ emp_id: sess.emp_id, v: salt }), authSettings_().idleMin * 60); // this session carries on
    staffLog_(sess.emp_id, 'pin_changed', sess.emp_id, 'by the staff member');
    return { ok: true };
  });
}

// ---- allurus-hr ----

/**
 * The staff directory of ALLURUS_TENANT in the allurus-hr Firestore, read with the script owner's Google login
 * (read-only REST call, needs the datastore scope in appsscript.json and access to the Firebase project).
 */
function hrDirectory_() {
  var set = authSettings_();
  if (!set.tenant) fail_('Set the Script Property ALLURUS_TENANT (the company id in allurus-hr) first');
  var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(set.project) + '/databases/(default)/documents/tenants/' +
    encodeURIComponent(set.tenant) + '/buckets/directory';
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code === 403) fail_('allurus-hr refused the read (403). The Google account that owns this script needs access to the ' + set.project + ' Firebase project.');
  if (code === 404) fail_('Company "' + set.tenant + '" has no staff directory in allurus-hr');
  if (code !== 200) fail_('Could not read allurus-hr (HTTP ' + code + '). Try again.');
  var doc = JSON.parse(res.getContentText());
  var f = (((doc.fields || {}).f || {}).mapValue || {}).fields || {};
  var ord = f['~ord'] ? JSON.parse(f['~ord'].stringValue) : [];
  var today = today_();
  return ord.filter(function (id) { return f[id] && f[id].stringValue; }).map(function (id) {
    var e = JSON.parse(f[id].stringValue);
    var status = String(e.status || 'Active');
    var ended = e.endDate && String(e.endDate) < today;
    return { emp_id: String(e.id), name: (String(e.first || '') + ' ' + String(e.last || '')).trim(), job: String(e.role || ''),
      dept: String(e.dept || ''), hr_status: ended ? 'Ended ' + e.endDate : status,
      active: !ended && !/resign|terminat|inactive|left|dismiss|deceased|disabled/i.test(status) };
  });
}

/** Disables POS accounts whose person is no longer active (or no longer listed) in allurus-hr. Returns what changed. */
function syncHr_(actor, hr) {
  hr = hr || hrDirectory_();
  var byId = {};
  hr.forEach(function (h) { byId[h.emp_id.toLowerCase()] = h; });
  var changed = [];
  staffRows_().forEach(function (s) {
    if (String(s.emp_id) === 'admin') return;
    var h = byId[String(s.emp_id).toLowerCase()];
    var hs = h ? h.hr_status : 'Not in allurus-hr';
    if (hs !== String(s.hr_status)) setCell_('Staff', s._row, 'hr_status', hs);
    if ((!h || !h.active) && s.status !== 'disabled') {
      setCell_('Staff', s._row, 'status', 'disabled');
      setCell_('Staff', s._row, 'updated_at', now_());
      staffLog_(actor || 'hr-sync', 'auto_disabled', String(s.emp_id), hs);
      changed.push(String(s.emp_id));
    }
  });
  return changed;
}

/** Time-driven: run hourly (installHrSyncTrigger) so a resignation in allurus-hr locks the POS account soon after. */
function hrSyncJob() { withLock_(function () { syncHr_('hr-sync'); }); }

function installHrSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'hrSyncJob') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('hrSyncJob').timeBased().everyHours(1).create();
}

function listStaff_(d, sess) {
  var note = '';
  if (d.sync) {
    try { withLock_(function () { syncHr_(sess.emp_id); }); } catch (e) { note = e.userError ? e.message : 'Could not reach allurus-hr just now.'; }
  }
  return { staff: staffRows_().map(staffOut_), hr_note: note };
}

/** data: { q }: people in allurus-hr matching a name or employee id, with whether they already have a POS account. */
function hrSearch_(d) {
  var q = String(d.q || '').trim().toLowerCase();
  var have = {};
  staffRows_().forEach(function (s) { have[String(s.emp_id).toLowerCase()] = String(s.role); });
  return hrDirectory_().filter(function (h) {
    return !q || h.name.toLowerCase().indexOf(q) >= 0 || h.emp_id.toLowerCase() === q || h.emp_id.toLowerCase().indexOf(q) === 0;
  }).slice(0, 50).map(function (h) { h.pos_role = have[h.emp_id.toLowerCase()] || ''; return h; });
}

/** data: { emp_id, role, pin }. The person must be active in allurus-hr; name and id come from there. */
function addStaff_(d, sess) {
  var role = String(d.role || '');
  if (ROLES.indexOf(role) < 0) fail_('Choose a role');
  if (!pinOk_(d.pin) || String(d.pin) === '0000') fail_('Set a PIN of 4 to 6 digits (not 0000)');
  var hr = hrDirectory_();
  return withLock_(function () {
    var h = hr.filter(function (x) { return x.emp_id.toLowerCase() === String(d.emp_id || '').toLowerCase(); })[0];
    if (!h) fail_('Not found in allurus-hr. HR must add this person first.');
    if (!h.active) fail_(h.name + ' is ' + h.hr_status + ' in allurus-hr and can\'t be added');
    if (findStaff_(h.emp_id)) fail_(h.name + ' already has a POS account');
    var salt = newSalt_();
    var when = now_();
    append_('Staff', [{ emp_id: h.emp_id, name: h.name, role: role, pin_hash: pinHash_(salt, String(d.pin)), pin_salt: salt, status: 'active',
      failed_attempts: 0, must_change_pin: !!d.must_change_pin, hr_status: h.hr_status, created_at: when, updated_at: when }]);
    staffLog_(sess.emp_id, 'created', h.emp_id, 'role ' + role);
    return staffOut_(findStaff_(h.emp_id));
  });
}

/**
 * data: { emp_id, role?, status?: 'active'|'disabled', reset_pin?, must_change_pin? }. Unlocking = status active
 * (also clears the wrong-PIN count). The starter 'admin' can't be disabled or demoted; nobody can change their own
 * role or disable themselves. Re-enabling someone checks allurus-hr first.
 */
function updateStaff_(d, sess) {
  var id = String(d.emp_id || '');
  var hr = d.status === 'active' && id !== 'admin' ? hrDirectory_() : null;
  return withLock_(function () {
    var s = findStaff_(id);
    if (!s) fail_('Staff not found');
    var me = String(s.emp_id) === sess.emp_id;
    var when = now_();
    if (d.role !== undefined && d.role !== s.role) {
      if (ROLES.indexOf(String(d.role)) < 0) fail_('Choose a role');
      if (String(s.emp_id) === 'admin') fail_('The starter admin account stays an admin');
      if (me) fail_('You can\'t change your own role');
      setCell_('Staff', s._row, 'role', String(d.role));
      staffLog_(sess.emp_id, 'role_changed', String(s.emp_id), s.role + ' → ' + d.role);
    }
    if (d.status !== undefined && d.status !== s.status) {
      if (['active', 'disabled'].indexOf(String(d.status)) < 0) fail_('Bad status');
      if (d.status === 'disabled' && (String(s.emp_id) === 'admin' || me)) fail_(me ? 'You can\'t disable yourself' : 'The starter admin account can\'t be disabled');
      if (d.status === 'active' && hr) {
        var h = hr.filter(function (x) { return x.emp_id.toLowerCase() === id.toLowerCase(); })[0];
        if (!h || !h.active) fail_('Not active in allurus-hr (' + (h ? h.hr_status : 'not found') + '), so the account stays disabled');
      }
      setCell_('Staff', s._row, 'status', String(d.status));
      if (d.status === 'active') setCell_('Staff', s._row, 'failed_attempts', 0);
      staffLog_(sess.emp_id, d.status === 'active' ? (s.status === 'locked' ? 'unlocked' : 'enabled') : 'disabled', String(s.emp_id), '');
    }
    if (d.reset_pin !== undefined && d.reset_pin !== '') {
      if (!pinOk_(d.reset_pin) || String(d.reset_pin) === '0000') fail_('The PIN must be 4 to 6 digits (not 0000)');
      var salt = newSalt_();
      setCell_('Staff', s._row, 'pin_salt', salt);
      setCell_('Staff', s._row, 'pin_hash', pinHash_(salt, String(d.reset_pin)));
      setCell_('Staff', s._row, 'failed_attempts', 0);
      setCell_('Staff', s._row, 'must_change_pin', d.must_change_pin !== false);
      staffLog_(sess.emp_id, 'pin_reset', String(s.emp_id), d.must_change_pin !== false ? 'must change at next login' : '');
    }
    setCell_('Staff', s._row, 'updated_at', when);
    return staffOut_(findStaff_(id));
  });
}

/** data: { type: 'staff'|'change', date_from, date_to }: the staff log or the price/menu change log (read-only). */
function getAuditLog_(d) {
  var from = String(d.date_from || addDays_(-30));
  var to = String(d.date_to || today_());
  var tab = d.type === 'change' ? 'ChangeLog' : 'StaffLog';
  return { rows: rows_(tab).filter(function (x) { var day = String(x.datetime).slice(0, 10); return day >= from && day <= to; })
    .map(function (x) { var o = {}; TABS[tab].forEach(function (c) { o[c] = String(x[c] === undefined ? '' : x[c]); }); return o; }).reverse() };
}

// ---- void with supervisor approval ----

/** A receipt number (R000012) or sale id → the sale, for the void screen. */
function findSale_ByReceipt_(d) {
  var no = String(d.receipt_no || '').trim().toUpperCase();
  var m = /^R?0*(\d{1,7})$/.exec(no);
  if (!m) fail_('Enter a receipt number like R000012');
  var row = Number(m[1]) + 1;
  var s = rows_('Sales').filter(function (x) { return x._row === row; })[0];
  if (!s) fail_('Receipt not found');
  return saleOut_(s, itemsOf_(String(s.sale_id)), receiptNo_(s._row));
}

/**
 * data: { sale_id, reason (VOID_REASONS key), note, made, approver_id, approver_pin }. Whoever asks (cashier or
 * supervisor), a supervisor's own ID + PIN must come with this one request; a cashier's PIN can never approve. The
 * approval covers this void only. Every void is written to VoidLog (append-only).
 */
function approvedVoid_(d, sess) {
  var key = String(d.reason || '');
  if (!VOID_REASONS[key]) fail_('Choose a void reason');
  var note = cleanText_(d.note, 150);
  if (key === 'other' && note.length < 3) fail_('Add a note when the reason is Other');
  var approver = withLock_(function () { return checkPin_(d.approver_id, d.approver_pin); });
  if (String(approver.role) !== 'supervisor') fail_('Only a supervisor can approve a void. ' + approver.name + ' is ' + approver.role + '.');
  var reasonText = VOID_REASONS[key] + (note ? ': ' + note : '');
  var r = voidSale_({ sale_id: d.sale_id, reason: reasonText, made: d.made === true });
  if (r.already) return r;
  return withLock_(function () {
    var s = findSale_(String(d.sale_id));
    var items = itemsOf_(String(d.sale_id)).map(function (it) { return it.name + ' x' + it.qty; }).join(', ');
    var row = sheet_('VoidLog').getLastRow() + 1;
    var vid = 'V-' + ('00000' + (row - 1)).slice(-6);
    append_('VoidLog', [{ void_id: vid, datetime: now_(), outlet: authSettings_().outlet, terminal: String(d.device_id || s.device_id || ''),
      sale_id: String(d.sale_id), receipt_no: receiptNo_(s._row), items: items, amount: Number(s.total), requested_by: sess.emp_id,
      approved_by: String(approver.emp_id), reason: VOID_REASONS[key], note: note, made: d.made === true }]);
    r.void_id = vid;
    r.approved_by = String(approver.emp_id);
    return r;
  });
}

/** data: { date_from, date_to, supervisor, cashier, reason }: the void log, newest first, read-only. */
function getVoidLog_(d) {
  var from = String(d.date_from || addDays_(-30));
  var to = String(d.date_to || today_());
  return { reasons: VOID_REASONS, rows: rows_('VoidLog').filter(function (x) {
    var day = String(x.datetime).slice(0, 10);
    return day >= from && day <= to && (!d.supervisor || String(x.approved_by) === d.supervisor) &&
      (!d.cashier || String(x.requested_by) === d.cashier) && (!d.reason || String(x.reason) === VOID_REASONS[d.reason]);
  }).map(function (x) { var o = {}; TABS.VoidLog.forEach(function (c) { o[c] = x[c]; }); o.amount = Number(x.amount); o.datetime = String(x.datetime); return o; }).reverse() };
}

// ---------- closing the day ----------

// ---- the day's session: open (count the register) -> sell -> close (cash must tally) ----
// A cashier or supervisor can use nothing but the Open/Close screen until they have opened today. After a cashier closes, that cashier can
// no longer check out or void; after a supervisor closes the day, nobody can until tomorrow. Waste can still be keyed in. Admin is exempt
// (no drawer). Script Property REQUIRE_OPENING=off switches this gate off (for tests).

var OPEN_FREE = ['whoami', 'logout', 'changePin', 'getClosing', 'setOpening']; // allowed before opening
var TILL_ACTIONS = ['createSale', 'voidSale'];

function requireOpening_() { return PropertiesService.getScriptProperties().getProperty('REQUIRE_OPENING') !== 'off'; }

/** { required, opened, closed, day_closed } for this person today. Cached for 10 minutes; opening and closing refresh it. */
function sessionState_(sess) {
  var day = today_();
  var cache = CacheService.getScriptCache();
  var dc = cache.get('dc:' + day);
  if (dc === null) {
    dc = rows_('Closings').some(function (c) { return String(c.date) === day && String(c.role) === 'supervisor'; }) ? '1' : '0';
    cache.put('dc:' + day, dc, 600);
  }
  var out = { required: requireOpening_() && String(sess.role) !== 'admin', opened: true, closed: false, day_closed: dc === '1' };
  if (String(sess.role) === 'admin') return out;
  var key = 'st:' + sess.emp_id + ':' + day;
  var st = cache.get(key);
  if (st === null) {
    var emp = String(sess.emp_id);
    var o = rows_('Openings').some(function (x) { return String(x.date) === day && String(x.opened_by) === emp; }) ? '1' : '0';
    var c = rows_('Closings').some(function (x) { return String(x.date) === day && String(x.closed_by) === emp; }) ? '1' : '0';
    st = o + c;
    cache.put(key, st, 600);
  }
  out.opened = st.charAt(0) === '1';
  out.closed = st.charAt(1) === '1';
  return out;
}

function dropState_(empId) {
  var cache = CacheService.getScriptCache();
  cache.remove('st:' + empId + ':' + today_());
  cache.remove('dc:' + today_());
}

function gateError_(action, sess) {
  if (!requireOpening_() || String(sess.role) === 'admin') return '';
  var st = sessionState_(sess);
  if (!st.opened && OPEN_FREE.indexOf(action) < 0) return 'OPENING_REQUIRED: Count the cash in the register to start your session first';
  if (TILL_ACTIONS.indexOf(action) >= 0) {
    if (st.day_closed) return 'The day is closed. Checkout and voids are off until tomorrow.';
    if (st.closed) return 'You have closed your session. Checkout and voids are off for you until tomorrow.';
  }
  return '';
}

// Notes and coins, in sen: RM100, 50, 20, 10, 5, 1, then 50, 20, 10, 5 sen. Cash is always counted by these, never typed as one amount.
var DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5];

/** { "<sen>": count } -> { sen: total, parts: only the non-zero counts }. A blank box is zero. Null when nothing was sent. */
function countDenoms_(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var total = 0;
  var parts = {};
  Object.keys(obj).forEach(function (k) { if (DENOMS.indexOf(Number(k)) < 0) fail_('Unknown note or coin'); });
  DENOMS.forEach(function (v) {
    var n = obj[String(v)];
    if (n === undefined || n === null || n === '') return;
    var q = Number(n);
    if (!isFinite(q) || q < 0 || Math.floor(q) !== q || q > 100000) fail_('Bad count for ' + (v >= 100 ? 'RM' + v / 100 : v + ' sen') + ': a whole number, 0 or more');
    if (q) { parts[String(v)] = q; total += q * v; }
  });
  return { sen: total, parts: parts };
}

/**
 * What needs a look before tomorrow's service: tracked stock at or below its reorder level (LOW_STOCK when none is set),
 * negative stock, a delivery batch that expires within 2 days, an opened pack that must be used up by tomorrow.
 */
function stockAttention_() {
  var set = settings_();
  var rep = getStockReport_();
  var soon = addDays_(2);
  var tomorrow = addDays_(1);
  var opened = {};
  rows_('OpenContainers').forEach(function (k) {
    if (k.status !== 'open') return;
    var u = String(k.use_by || '').slice(0, 10);
    var id = String(k.ingredient_id);
    if (u && u <= tomorrow && (!opened[id] || u < opened[id])) opened[id] = u;
  });
  var out = [];
  rep.items.forEach(function (x) {
    if (!x.active) return;
    var why = [];
    if (x.track_stock) {
      var level = x.reorder_level === '' ? set.lowStock : Number(x.reorder_level);
      if (x.on_hand < 0) why.push('stock is negative, please recount');
      else if (x.on_hand === 0) why.push('out of stock');
      else if (x.on_hand <= level) why.push('only ' + x.on_hand + ' ' + x.unit + ' left (reorder at ' + level + ')');
    }
    if (x.nearest_expiry && x.nearest_expiry <= soon) why.push('batch expires ' + x.nearest_expiry);
    if (opened[x.product_id]) why.push('opened pack: use by ' + opened[x.product_id]);
    if (why.length) out.push({ product_id: x.product_id, name: x.name, unit: x.unit, stock: x.track_stock ? x.on_hand : '', reason: why.join('; ') });
  });
  return out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
}

/** The live row of the checklist for a product: open, or ticked (done). Older rows (resolved) are history. */
function shopCurrent_() {
  var cur = {};
  rows_('ShopList').forEach(function (r) { if (r.status === 'open' || r.status === 'done') cur[String(r.product_id)] = r; });
  return cur;
}

/**
 * Keeps the checklist in step with stock. An unticked (open) item stays on every closing until someone ticks it, or until
 * stock is back above the level (then it is resolved by itself). A ticked item is done; if it is still a problem 2 days
 * later it comes back as open again.
 */
function syncShopList_(att) {
  var today = today_();
  var cur = shopCurrent_();
  var byId = {};
  att.forEach(function (a) { byId[a.product_id] = a; });
  Object.keys(cur).forEach(function (id) {
    var r = cur[id];
    if (r.status === 'open' && !byId[id]) {
      setCell_('ShopList', r._row, 'status', 'resolved');
      setCell_('ShopList', r._row, 'done_at', today);
      setCell_('ShopList', r._row, 'done_by', 'auto: stock is back');
    }
  });
  att.forEach(function (a) {
    var r = cur[a.product_id];
    if (!r) {
      append_('ShopList', [{ product_id: a.product_id, name: a.name, unit: a.unit, reason: a.reason, stock: a.stock, first_listed: today,
        last_listed: today, times_listed: 1, status: 'open', done_at: '', done_by: '' }]);
    } else if (r.status === 'open') {
      if (String(r.last_listed) !== today) {
        setCell_('ShopList', r._row, 'last_listed', today);
        setCell_('ShopList', r._row, 'times_listed', Number(r.times_listed || 0) + 1);
      }
      setCell_('ShopList', r._row, 'reason', a.reason);
      setCell_('ShopList', r._row, 'stock', a.stock);
    } else if (String(r.done_at) <= addDays_(-2)) {
      setCell_('ShopList', r._row, 'status', 'open');
      setCell_('ShopList', r._row, 'last_listed', today);
      setCell_('ShopList', r._row, 'times_listed', Number(r.times_listed || 0) + 1);
      setCell_('ShopList', r._row, 'reason', a.reason + ' (still a problem after it was ticked)');
      setCell_('ShopList', r._row, 'stock', a.stock);
      setCell_('ShopList', r._row, 'done_at', '');
      setCell_('ShopList', r._row, 'done_by', '');
    }
  });
}

/** Open items first (oldest first), then what was ticked in the last 2 days. */
function shopListOut_() {
  var today = today_();
  var days = function (from) { return Math.max(0, Math.round((Date.parse(today) - Date.parse(String(from))) / 864e5)); };
  var cur = shopCurrent_();
  return Object.keys(cur).map(function (k) { return cur[k]; }).map(function (r) {
    return { product_id: String(r.product_id), name: String(r.name), unit: String(r.unit), reason: String(r.reason), stock: r.stock,
      first_listed: String(r.first_listed), days_open: days(r.first_listed), times_listed: Number(r.times_listed || 1), status: String(r.status),
      done_at: String(r.done_at || ''), done_by: String(r.done_by || '') };
  }).sort(function (a, b) {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return a.first_listed < b.first_listed ? -1 : a.first_listed > b.first_listed ? 1 : a.name < b.name ? -1 : 1;
  });
}

/**
 * data: { date? }. The tally for the closing screen, fast: sales by payment method, the opening cash, the cash that should be
 * in the drawer and this role's earlier closes. A cashier gets their own sales and opening cash, a supervisor or admin all.
 * The stock checklist (getClosingStock) and the admin's transaction list (getClosingDetail) are read separately so this
 * screen opens at once. Nothing about sales is changed here (see closeDay for the record).
 */
function getClosing_(d, sess) {
  var day = String(d.date || today_());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail_('Bad date');
  var role = String(sess.role);
  var own = role === 'cashier';
  var all = closingSales_(day, sess);
  var sold = all.filter(function (s) { return s.status !== 'void'; });
  var voided = all.filter(function (s) { return s.status === 'void'; });
  var t = { subtotal: 0, discount: 0, service: 0, tax: 0, rounding: 0, total: 0 };
  var by = {};
  sold.forEach(function (s) {
    Object.keys(t).forEach(function (k) { t[k] += toSen_(s[k]); });
    by[s.payment_method] = (by[s.payment_method] || 0) + toSen_(s.total);
  });
  var methods = {};
  Object.keys(by).forEach(function (m) { methods[m] = toRm_(by[m]); });
  var voidSen = voided.reduce(function (a, s) { return a + toSen_(s.total); }, 0);
  // opening cash: the latest entry of each person that day (a cashier only their own)
  var latest = {};
  rows_('Openings').forEach(function (o) {
    var who = String(o.opened_by);
    if (String(o.date) !== day || (own && who !== String(sess.emp_id))) return;
    latest[who] = o;
  });
  var openSen = 0;
  var openings = Object.keys(latest).map(function (k) {
    var o = latest[k];
    openSen += toSen_(o.amount);
    return { opened_by: k, role: String(o.role), amount: Number(o.amount), datetime: String(o.datetime), note: String(o.note || '') };
  });
  var mine = latest[String(sess.emp_id)];
  // The whole-day tally also carries the cash differences cashiers already closed with (approved by a supervisor), so the same
  // shortage or surplus is not asked for twice.
  var closedToday = rows_('Closings').filter(function (c) { return String(c.date) === day; });
  var diffSen = 0;
  if (!own) closedToday.forEach(function (c) { if (String(c.role) === 'cashier' && c.cash_variance !== '') diffSen += toSen_(c.cash_variance); });
  var closedBy = {};
  closedToday.forEach(function (c) { closedBy[String(c.closed_by)] = true; });
  var waiting = [];
  if (!own) {
    var names0 = {};
    staffRows_().forEach(function (s) { names0[String(s.emp_id)] = String(s.name); });
    rows_('Openings').forEach(function (o) {
      var who = String(o.opened_by);
      if (String(o.date) === day && String(o.role) === 'cashier' && !closedBy[who] && !waiting.some(function (x) { return x.emp_id === who; })) waiting.push({ emp_id: who, name: names0[who] || who });
    });
  }
  var out = { date: day, today: today_(), denoms: DENOMS, role: role, scope: own ? 'own' : 'all', orders: sold.length, subtotal: toRm_(t.subtotal), discount: toRm_(t.discount),
    service: toRm_(t.service), tax: toRm_(t.tax), rounding: toRm_(t.rounding), total_sales: toRm_(t.total), by_method: methods,
    opening: toRm_(openSen), openings: openings, mine: mine ? { amount: Number(mine.amount), datetime: String(mine.datetime) } : null,
    cash_sales: toRm_(by.cash || 0), approved_diff: toRm_(diffSen), cash_expected: toRm_(openSen + (by.cash || 0) + diffSen), waiting: waiting,
    state: sessionState_(sess), voided: voided.length, void_amount: toRm_(voidSen) };
  out.closings = rows_('Closings').filter(function (c) {
    return String(c.date) === day && (!own || String(c.closed_by) === String(sess.emp_id));
  }).slice(-5).reverse().map(function (c) {
    return { close_id: String(c.close_id), datetime: String(c.datetime), closed_by: String(c.closed_by), role: String(c.role),
      cash_counted: c.cash_counted === '' ? '' : Number(c.cash_counted), cash_variance: c.cash_variance === '' ? '' : Number(c.cash_variance), cash_status: String(c.cash_status || ''),
      approved_by: String(c.approved_by || ''), note: String(c.note || '') };
  });
  return out;
}

/** The day's sales a role may see in its closing: a cashier their own, others all. */
function closingSales_(day, sess) {
  var own = String(sess.role) === 'cashier';
  return rows_('Sales').filter(function (s) {
    return String(s.datetime).slice(0, 10) === day && (!own || String(s.cashier_id) === String(sess.emp_id));
  });
}

/** data: { date? }. Supervisor, admin: the stock checklist (kept up to date here) for tomorrow. */
function getClosingStock_() {
  return withLock_(function () { var att = stockAttention_(); syncShopList_(att); return { attention: att.length, list: shopListOut_() }; });
}

/** data: { date? }. Admin: every transaction of the day with its items, who rang it, any void and who approved it, and the day's waste. */
function getClosingDetail_(d, sess) {
  var day = String(d.date || today_());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail_('Bad date');
  var all = closingSales_(day, sess);
  var names = {};
  staffRows_().forEach(function (s) { names[String(s.emp_id)] = String(s.name); });
  var itemsBy = {};
  rows_('SaleItems').forEach(function (it) {
    var k = String(it.sale_id);
    (itemsBy[k] || (itemsBy[k] = [])).push({ name: String(it.name), qty: Number(it.qty), unit_price: Number(it.unit_price), subtotal: Number(it.subtotal), note: String(it.note || '') });
  });
  var voidBy = {};
  rows_('VoidLog').forEach(function (v) { voidBy[String(v.sale_id)] = v; });
  var transactions = all.map(function (s) {
    var v = voidBy[String(s.sale_id)];
    return { receipt_no: receiptNo_(s._row), sale_id: String(s.sale_id), datetime: String(s.datetime), cashier_id: String(s.cashier_id || ''),
      cashier_name: names[String(s.cashier_id)] || '', payment_method: s.payment_method, order_type: s.order_type, table_no: String(s.table_no || ''),
      subtotal: Number(s.subtotal), discount: Number(s.discount), service: Number(s.service), tax: Number(s.tax), rounding: Number(s.rounding),
      total: Number(s.total), status: s.status, void_reason: String(s.void_reason || ''),
      voided: v ? { requested_by: String(v.requested_by), approved_by: String(v.approved_by), reason: String(v.reason), note: String(v.note || ''), made: bool_(v.made) } : null,
      items: itemsBy[String(s.sale_id)] || [] };
  });
  var w = wasteTotals_(rows_('Waste').filter(function (x) { return String(x.datetime).slice(0, 10) === day; }));
  return { transactions: transactions, waste: { cost: toRm_(w.waste_cost_sen), entries: w.waste_count, staff_meal_cost: w.staff_meal_cost, by_staff: w.by_staff } };
}

/**
 * data: { open_id (made by the till), denoms: { "<sen>": count }, note? }. A cashier or supervisor records the cash they start the
 * day with (the float), counted by notes and coins. Only for today. Changing it later the same day needs a note; every entry is
 * kept and the latest counts. The same open_id again returns the saved entry. At closing, expected cash is opening cash + cash sales.
 */
function setOpening_(d, sess) {
  var oid = String(d.open_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(oid)) fail_('Bad opening id');
  var cnt = countDenoms_(d.denoms);
  if (!cnt) fail_('Count the opening cash by notes and coins');
  if (cnt.sen > 10000000) fail_('Opening cash is too large');
  var note = cleanText_(d.note, 150);
  return withLock_(function () {
    var day = today_();
    var rows = rows_('Openings');
    if (rows.some(function (o) { return String(o.open_id) === oid; })) return getClosing_({ date: day }, sess);
    var st = sessionState_(sess);
    if (st.day_closed) fail_('The day is already closed. Opening starts again tomorrow.');
    if (st.closed) fail_('You already closed today. Opening starts again tomorrow.');
    var mine = rows.filter(function (o) { return String(o.date) === day && String(o.opened_by) === String(sess.emp_id); });
    if (mine.length && note.length < 3) fail_('You already set the opening cash today. Add a note saying why it changed.');
    append_('Openings', [{ open_id: oid, datetime: now_(), date: day, opened_by: String(sess.emp_id), role: String(sess.role),
      amount: toRm_(cnt.sen), note: note, denoms: JSON.stringify(cnt.parts) }]);
    dropState_(String(sess.emp_id));
    return getClosing_({ date: day }, sess);
  });
}

/**
 * data: { close_id (made by the till), denoms: { "<sen>": count }, note?, approver_id?, approver_pin? }. Closes TODAY.
 * A cashier or supervisor counts the cash in the drawer by notes and coins, and the day can only be closed when it TALLIES:
 * counted = opening cash + cash sales. If it doesn't, the close is marked surplus or shortage and needs a note and a supervisor's
 * own ID + PIN (a different supervisor when the closer is a supervisor). An admin has no drawer and closes without counting.
 * The server adds up the notes and coins itself. The same close_id again returns the saved close.
 */
function closeDay_(d, sess) {
  var cid = String(d.close_id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(cid)) fail_('Bad close id');
  var res = getClosing_({}, sess); // closing is for today only
  var role = String(sess.role);
  var seen = rows_('Closings').filter(function (c) { return String(c.close_id) === cid; })[0];
  if (seen) { res.close = { close_id: cid, duplicate: true }; return res; }
  if (role !== 'admin') {
    var mineToday = rows_('Closings').some(function (c) { return String(c.date) === res.date && String(c.closed_by) === String(sess.emp_id); });
    if (mineToday) fail_('You already closed today.');
    if (res.state.day_closed) fail_('The day is already closed.');
  }
  // closing the day (a supervisor) comes after every cashier has closed their own drawer
  if (role === 'supervisor' && res.waiting.length) {
    fail_('These cashiers have not closed yet: ' + res.waiting.map(function (x) { return x.name + ' (' + x.emp_id + ')'; }).join(', ') + '. They must close first.');
  }
  var note = cleanText_(d.note, 150);
  var counted = '';
  var variance = '';
  var status = '';
  var parts = {};
  var approver = '';
  if (role !== 'admin') {
    var cnt = countDenoms_(d.denoms);
    if (!cnt) fail_('Count the cash by notes and coins first. Leave a box empty if there are none.');
    counted = toRm_(cnt.sen);
    parts = cnt.parts;
    variance = toRm_(cnt.sen - toSen_(res.cash_expected));
    if (variance === 0) {
      status = 'balanced';
    } else {
      status = variance > 0 ? 'surplus' : 'shortage';
      var diff = 'The cash is ' + (variance > 0 ? 'over' : 'short') + ' by RM ' + Math.abs(variance).toFixed(2);
      if (note.length < 3) fail_(diff + '. Add a note saying why, and ask a supervisor to approve it.');
      if (!String(d.approver_id || '').trim()) fail_(diff + '. A supervisor must approve it: enter their ID and PIN.');
      var sup = withLock_(function () { return checkPin_(d.approver_id, d.approver_pin); });
      if (String(sup.role) !== 'supervisor') fail_('Only a supervisor can approve a cash difference. ' + sup.name + ' is ' + sup.role + '.');
      if (String(sup.emp_id) === String(sess.emp_id)) fail_('You cannot approve your own cash difference. Ask another supervisor.');
      approver = String(sup.emp_id);
    }
  }
  return withLock_(function () {
    var again = rows_('Closings').filter(function (c) { return String(c.close_id) === cid; })[0];
    if (again) { res.close = { close_id: cid, duplicate: true }; return res; }
    var row = { close_id: cid, datetime: now_(), date: res.date, closed_by: String(sess.emp_id), role: role, scope: res.scope,
      orders: res.orders, total_sales: res.total_sales, opening: res.opening, cash_expected: res.cash_expected, cash_counted: counted,
      cash_variance: variance, voided: res.voided, void_amount: res.void_amount, by_method: JSON.stringify(res.by_method), note: note,
      cash_status: status, approved_by: approver, denoms: JSON.stringify(parts) };
    append_('Closings', [row]);
    dropState_(String(sess.emp_id));
    res.state = sessionState_(sess);
    if (status === 'shortage' || status === 'surplus') {
      staffLog_(String(sess.emp_id), 'cash_' + status, String(sess.emp_id), 'RM ' + Math.abs(variance).toFixed(2) + ' approved by ' + approver + ': ' + note);
    }
    // show this close at once (the tally above was read before it was saved)
    res.closings = [{ close_id: cid, datetime: row.datetime, closed_by: row.closed_by, role: role, cash_counted: counted,
      cash_variance: variance, cash_status: status, approved_by: approver, note: note }].concat(res.closings).slice(0, 5);
    res.close = { close_id: cid, duplicate: false, cash_counted: counted, cash_variance: variance, cash_status: status, approved_by: approver };
    return res;
  });
}

/** data: { date_from, date_to }: past closes, newest first (supervisor, admin). */
function getClosings_(d) {
  var from = String(d.date_from || addDays_(-30));
  var to = String(d.date_to || today_());
  return { rows: rows_('Closings').filter(function (c) { var day = String(c.date); return day >= from && day <= to; }).map(function (c) {
    var o = {}; TABS.Closings.forEach(function (k) { o[k] = c[k]; });
    ['close_id', 'datetime', 'date', 'closed_by', 'role', 'scope', 'by_method', 'note'].forEach(function (k) { o[k] = String(c[k] === undefined ? '' : c[k]); });
    return o;
  }).reverse() };
}

/** data: { product_id, done }. Ticks (bought / handled) or unticks an item on the stock checklist. Returns the list. */
function setShopItem_(d, sess) {
  var id = String(d.product_id || '');
  return withLock_(function () {
    var r = shopCurrent_()[id];
    if (!r) fail_('That item is not on the checklist any more. Refresh.');
    if (d.done === true) {
      setCell_('ShopList', r._row, 'status', 'done');
      setCell_('ShopList', r._row, 'done_at', today_());
      setCell_('ShopList', r._row, 'done_by', String(sess.emp_id));
    } else {
      setCell_('ShopList', r._row, 'status', 'open');
      setCell_('ShopList', r._row, 'done_at', '');
      setCell_('ShopList', r._row, 'done_by', '');
    }
    return { list: shopListOut_() };
  });
}

/** First run: the starter admin (PIN 0000, must change) when the Staff tab is empty. */
function ensureStarterAdmin_() {
  if (staffRows_().length) return;
  var salt = newSalt_();
  var when = now_();
  append_('Staff', [{ emp_id: 'admin', name: 'Starter admin', role: 'admin', pin_hash: pinHash_(salt, '0000'), pin_salt: salt, status: 'active',
    failed_attempts: 0, must_change_pin: true, hr_status: 'Starter account', created_at: when, updated_at: when }]);
  staffLog_('setup', 'created', 'admin', 'starter account, PIN must be changed');
}

// ---------- run these once from the script editor ----------

/**
 * Creates the tabs with headers and formats. Safe to run again: it adds new columns at the end of existing tabs and,
 * on Products rows that don't have them yet, fills unit (pcs), kind (menu) and track_stock (from stock).
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = TABS[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var text = ['id', 'sale_id', 'product_id', 'datetime', 'table_no', 'device_id', 'note', 'void_reason', 'waste_id',
      'movement_id', 'ref_id', 'reason', 'reason_type', 'staff_name', 'reverses_waste_id', 'unit', 'kind', 'status', 'made_at',
      'waste_type', 'recipe_id', 'menu_product_id', 'ingredient_id', 'modifier_id', 'purchase_id', 'supplier', 'invoice_no', 'base_unit',
      'batch_no', 'expiry_date', 'received_by', 'reverses_purchase_id', 'container_id', 'opened_at', 'opened_by', 'use_by',
      'finished_at', 'discarded_reason', 'station', 'open_reason', 'count_id', 'counted_by', 'pack_unit', 'cashier_id', 'emp_id',
      'name', 'role', 'pin_hash', 'pin_salt', 'hr_status', 'created_at', 'updated_at', 'close_id', 'date', 'closed_by', 'scope', 'open_id', 'opened_by',
      'first_listed', 'last_listed', 'done_at', 'done_by', 'void_id', 'outlet', 'terminal', 'items',
      'requested_by', 'approved_by', 'log_id', 'actor', 'action', 'detail', 'entity', 'entity_id', 'field', 'old_value', 'new_value'];
    var money = ['price', 'subtotal', 'discount', 'service', 'tax', 'rounding', 'total', 'unit_price', 'line_cost', 'pack_cost',
      'value', 'variance_value'];
    var fine = ['cost', 'unit_cost']; // RM per base unit, up to 6 decimals
    cols.forEach(function (c, i) {
      var col = sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1);
      if (text.indexOf(c) >= 0) col.setNumberFormat('@'); // keep ids and dates as plain text
      if (money.indexOf(c) >= 0) col.setNumberFormat('0.00');
      if (fine.indexOf(c) >= 0) col.setNumberFormat('0.00####');
    });
  });
  rows_('Products').forEach(function (r) {
    if (r.unit === '' || r.unit === undefined) setCell_('Products', r._row, 'unit', 'pcs');
    if (r.kind === '' || r.kind === undefined) setCell_('Products', r._row, 'kind', 'menu');
    if (blank_(r.base_unit)) setCell_('Products', r._row, 'base_unit', blank_(r.unit) ? 'pcs' : r.unit);
    if (blank_(r.max_open_containers)) setCell_('Products', r._row, 'max_open_containers', 1);
    if (blank_(r.track_open)) setCell_('Products', r._row, 'track_open', false);
    setCell_('Products', r._row, 'track_stock', tracked_(r));
  });
  openingBalances_();
  ensureStarterAdmin_();
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 3 && blank.getLastRow() === 0) ss.deleteSheet(blank);
}

/**
 * Recovery, run by the Sheet's owner from the script editor only: unlocks the starter 'admin' account and sets its PIN
 * back to 0000 (must be changed at the next sign-in). For when every admin is locked out. Logged in StaffLog.
 */
function resetStarterAdmin() {
  withLock_(function () {
    var s = findStaff_('admin');
    if (!s) { ensureStarterAdmin_(); return; }
    var salt = newSalt_();
    setCell_('Staff', s._row, 'pin_salt', salt);
    setCell_('Staff', s._row, 'pin_hash', pinHash_(salt, '0000'));
    setCell_('Staff', s._row, 'status', 'active');
    setCell_('Staff', s._row, 'failed_attempts', 0);
    setCell_('Staff', s._row, 'must_change_pin', true);
    setCell_('Staff', s._row, 'updated_at', now_());
    staffLog_('script owner', 'starter_admin_reset', 'admin', 'unlocked, PIN 0000, must change');
  });
}

/** Adds 10 sample cafe items (names end in "(sample)") if Products is empty. */
function loadSampleMenu() {
  if (rows_('Products').length) throw new Error('Products already has rows; sample menu not loaded.');
  var s = [ // name, price, stock, category, unit, cost
    ['Americano', 7.90, '', 'Coffee', 'cup', 1.80], ['Latte', 10.90, '', 'Coffee', 'cup', 2.60], ['Cappuccino', 10.90, '', 'Coffee', 'cup', 2.50],
    ['Spanish Latte', 12.90, '', 'Coffee', 'cup', 3.10], ['Teh Tarik', 5.50, '', 'Tea', 'cup', 1.10], ['Iced Lemon Tea', 6.90, '', 'Tea', 'cup', 1.30],
    ['Butter Croissant', 7.50, 20, 'Food', 'pcs', 2.80], ['Chicken Sandwich', 14.90, 15, 'Food', 'pcs', 5.40],
    ['Burnt Cheesecake', 13.90, 8, 'Dessert', 'pcs', 4.20], ['Chocolate Brownie', 8.90, 12, 'Dessert', 'pcs', 2.90]
  ];
  append_('Products', s.map(function (x) {
    return { id: 'sample-' + Utilities.getUuid(), name: x[0] + ' (sample)', price: x[1], stock: x[2], category: x[3], active: true,
      unit: x[4], cost: x[5], track_stock: x[2] !== '', kind: 'menu' };
  }));
  openingBalances_();
}

/**
 * Gives every tracked product that has no StockMovements row yet a stock_in row ('opening balance') for its current
 * stock, so the movement trail always adds up to the stock column. Safe to run again.
 */
function openingBalances_() {
  var moved = {};
  rows_('StockMovements').forEach(function (m) { moved[String(m.product_id)] = true; });
  var rows = [];
  var when = now_();
  rows_('Products').forEach(function (r) {
    if (!tracked_(r) || moved[String(r.id)]) return;
    rows.push({ movement_id: Utilities.getUuid(), datetime: when, product_id: String(r.id), name: String(r.name),
      change_qty: Number(r.stock), reason_type: 'stock_in', ref_id: 'opening balance', balance_after: Number(r.stock),
      staff_name: 'setup', device_id: '' });
  });
  append_('StockMovements', rows);
}

/**
 * Adds 4 sample ingredients in base units (ml, g, pcs) with packs, reorder levels and open tracking; starting stock is
 * written as stock_in movements. Skips any that already exist by name.
 */
function loadSampleIngredients() {
  var have = {};
  rows_('Products').forEach(function (r) { have[String(r.name)] = true; });
  [ // name, unit, cost per unit, stock, pack size, pack unit, reorder, open shelf life, track open
    ['Fresh milk (sample)', 'ml', 0.008, 10000, 1000, 'carton', 3000, 3, true],
    ['Coffee beans (sample)', 'g', 0.12, 2000, 1000, 'bag', 1000, 14, true],
    ['Caramel syrup (sample)', 'ml', 0.053333, 1500, 750, 'bottle', 750, 30, true],
    ['Takeaway cups (sample)', 'pcs', 0.25, 200, 50, 'sleeve', 100, '', false]
  ].forEach(function (x) {
    if (have[x[0]]) return;
    saveProduct_({ name: x[0], price: 0, category: 'Ingredient', unit: x[1], cost: x[2], kind: 'ingredient', track_stock: true, stock: x[3],
      pack_size: x[4], pack_unit: x[5], reorder_level: x[6], open_shelf_life_days: x[7], max_open_containers: 1, track_open: x[8],
      staff_name: 'setup' });
  });
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
