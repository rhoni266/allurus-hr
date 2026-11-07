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
 *
 * Money is integer sen inside this file and RM with 2 decimals in the Sheet.
 * All calls are POST (text/plain body with JSON) so the secret never sits in a URL.
 * Never stores card numbers or customer details.
 *
 * The prices, totals, stock and recipe logic (createSale_, voidSale_, saveProduct_, and so on) moved out of this
 * file into PosCore.gs, so the public demo at /demo/pos runs the exact same logic in the browser. **When you paste
 * this project into Apps Script, also paste shared/pos-core.js as a second file named PosCore.gs** (Apps Script
 * runs every .gs file in one project in the same global scope, so the functions it defines are available here).
 * scripts/sync-pos-core.js keeps apps-script/PosCore.gs identical to shared/pos-core.js; tests/core-parity.test.js
 * checks the two files are byte for byte the same and that this backend and the demo API answer the same cases alike.
 */

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
    createSale: createSale_, voidSale: voidSale_, saveProduct: saveProduct_,
    logWaste: logWaste_, reverseWaste: reverseWaste_, getWaste: getWaste_, stockAdjust: stockAdjust_,
    receivePurchase: receivePurchase_, reversePurchase: reversePurchase_, getPurchases: getPurchases_,
    saveRecipe: saveRecipe_, getRecipes: getRecipes_,
    openContainer: openContainer_, finishContainer: finishContainer_, discardContainer: discardContainer_, getContainers: getContainers_,
    stockCount: stockCount_, getStockReport: getStockReport_, getUsageReport: getUsageReport_
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
      'finished_at', 'discarded_reason', 'station', 'open_reason', 'count_id', 'counted_by', 'pack_unit'];
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
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 3 && blank.getLastRow() === 0) ss.deleteSheet(blank);
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
