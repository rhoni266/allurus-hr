// Runs the same cases through both hosts of pos/shared/pos-core.js: the real backend (a fake Google Sheet, as in
// code.test.js) and the public demo (a fake localStorage, as in demo/local-host.js). Confirms POS-DEMO-SPEC's
// promise that the demo computes totals, SST, service charge, rounding, duplicate sale_id, void, recipe usage,
// waste and purchases exactly as the real till would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---------- the real backend: a fake Google Sheet (same technique as code.test.js) ----------

function loadSheetHost(props = {}) {
  const tabs = {};
  const sheet = (name) => ({
    getDataRange: () => ({ getValues: () => tabs[name].map((r) => r.slice()) }),
    getLastRow: () => tabs[name].length,
    getMaxRows: () => 1000,
    setFrozenRows() {},
    getRange: (row, col, nr = 1, nc = 1) => ({
      setValues(v) { v.forEach((r, i) => { const t = tabs[name]; while (t.length < row + i) t.push([]); r.forEach((x, j) => { t[row - 1 + i][col - 1 + j] = x; }); }); return this; },
      setValue(x) { tabs[name][row - 1][col - 1] = x; return this; },
      setFontWeight() { return this; }, setNumberFormat() { return this; },
      clearContent() { const t = tabs[name]; for (let i = row - 1; i < row - 1 + nr && i < t.length; i++) t[i] = []; while (t.length && !t[t.length - 1].length) t.pop(); return this; },
    }),
  });
  const ss = {
    getSheetByName: (n) => (tabs[n] ? sheet(n) : null),
    insertSheet: (n) => { tabs[n] = []; return sheet(n); },
    setSpreadsheetTimeZone() {}, getSheets: () => Object.keys(tabs),
  };
  let uuid = 0;
  const P = { SECRET_KEY: 'test-secret-123', ...props };
  const ctx = {
    console, Math, JSON, Number, String, Array, Object, Error, isFinite, Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in P ? String(P[k]) : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => `uuid-${String(++uuid).padStart(8, '0')}`, formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? '2026-10-31' : '2026-10-31T10:00:00+08:00') },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'pos-core.js'), 'utf8'), ctx);
  Object.keys(ctx.TABS).forEach((name) => { tabs[name] = [ctx.TABS[name]]; }); // header row only, as setup() would leave it
  return ctx; // has every *_ function as a global, e.g. ctx.createSale_(...)
}

// ---------- the demo: a fake localStorage, in a context that is its own `window` (as in a real browser) ----------

function loadDemoHost() {
  const ctx = {};
  ctx.window = ctx; // browsers: window === globalThis, so demo/local-host.js's `window.PosHost = ...` is a bare global too
  Object.assign(ctx, { console, Math, JSON, Number, String, Array, Object, Error, isFinite, Date, Intl, Uint8Array, RegExp });
  let store = null;
  let uuid = 0;
  ctx.localStorage = {
    getItem: (k) => (store && k in store ? store[k] : null),
    setItem: (k, v) => { store = store || {}; store[k] = v; },
    removeItem: (k) => { if (store) delete store[k]; },
  };
  ctx.crypto = { randomUUID: () => `uuid-${String(++uuid).padStart(8, '0')}` };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'demo', 'local-host.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'pos-core.js'), 'utf8'), ctx);
  // The demo's fixed defaults (demo/seed.js sets the same); tests below override per case via saveProduct_/settings.
  ctx.PosDemoStore.setMeta({ sstPercent: 0, servicePercent: 0, lowStock: 5, countVariancePercent: 5 });
  return ctx;
}

function sameMenu(ctx) {
  const latte = ctx.saveProduct_({ name: 'Latte', price: 10.90, category: 'Coffee', unit: 'cup', staff_name: 't' });
  const croissant = ctx.saveProduct_({ name: 'Butter Croissant', price: 7.50, category: 'Food', unit: 'pcs', cost: 2.80, track_stock: true, stock: 20, staff_name: 't' });
  const americano = ctx.saveProduct_({ name: 'Americano', price: 7.90, category: 'Coffee', unit: 'cup', staff_name: 't' });
  return { latte, croissant, americano };
}

test('both hosts: same 3-item cash sale gives the same totals, rounding and receipt number', () => {
  const sheet = loadSheetHost();
  const demo = loadDemoHost();
  const s = sameMenu(sheet);
  const d = sameMenu(demo);
  const sale = { sale_id: 'parity-sale-1', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: s.latte.id, qty: 2 }, { product_id: s.croissant.id, qty: 1 }] };
  const r1 = sheet.createSale_(sale);
  const r2 = demo.createSale_({ ...sale, items: [{ product_id: d.latte.id, qty: 2 }, { product_id: d.croissant.id, qty: 1 }] });
  assert.equal(r1.subtotal, r2.subtotal);
  assert.equal(r1.total, r2.total);
  assert.equal(r1.receipt_no, 'R000001');
  assert.equal(r2.receipt_no, 'R000001');
  assert.equal(sheet.getProducts_({}).find((p) => p.id === s.croissant.id).stock, 19);
  assert.equal(demo.getProducts_({}).find((p) => p.id === d.croissant.id).stock, 19);
});

test('both hosts: SST and service charge (dine-in only) and cash rounding agree', () => {
  const sheet = loadSheetHost({ SST_PERCENT: 6, SERVICE_PERCENT: 10 });
  const demo = loadDemoHost();
  demo.PosDemoStore.setMeta({ sstPercent: 6, servicePercent: 10 });
  const s = sameMenu(sheet);
  const d = sameMenu(demo);
  const a1 = sheet.createSale_({ sale_id: 'parity-rnd-1', payment_method: 'cash', order_type: 'dine_in', items: [{ product_id: s.americano.id, qty: 1 }] });
  const a2 = demo.createSale_({ sale_id: 'parity-rnd-1', payment_method: 'cash', order_type: 'dine_in', items: [{ product_id: d.americano.id, qty: 1 }] });
  assert.equal(a1.service, a2.service);
  assert.equal(a1.tax, a2.tax);
  assert.equal(a1.total, a2.total);
  assert.equal(a1.total, 9.20); // 7.90 + 10% = 8.69; +6% SST = 9.21 -> cash rounds to 9.20
});

test('both hosts: the same sale_id twice returns the saved sale, not a second one', () => {
  const sheet = loadSheetHost();
  const demo = loadDemoHost();
  const s = sameMenu(sheet);
  const d = sameMenu(demo);
  const sale = { sale_id: 'parity-dup-1', payment_method: 'cash', order_type: 'takeaway' };
  sheet.createSale_({ ...sale, items: [{ product_id: s.latte.id, qty: 1 }] });
  demo.createSale_({ ...sale, items: [{ product_id: d.latte.id, qty: 1 }] });
  const r1 = sheet.createSale_({ ...sale, items: [{ product_id: s.latte.id, qty: 1 }] });
  const r2 = demo.createSale_({ ...sale, items: [{ product_id: d.latte.id, qty: 1 }] });
  assert.equal(r1.duplicate, true);
  assert.equal(r2.duplicate, true);
});

test('both hosts: void restores stock and marks the sale void', () => {
  const sheet = loadSheetHost();
  const demo = loadDemoHost();
  const s = sameMenu(sheet);
  const d = sameMenu(demo);
  const sale = { sale_id: 'parity-void-1', payment_method: 'cash', order_type: 'takeaway' };
  sheet.createSale_({ ...sale, items: [{ product_id: s.croissant.id, qty: 2 }] });
  demo.createSale_({ ...sale, items: [{ product_id: d.croissant.id, qty: 2 }] });
  sheet.voidSale_({ sale_id: sale.sale_id, reason: 'customer changed mind' });
  demo.voidSale_({ sale_id: sale.sale_id, reason: 'customer changed mind' });
  assert.equal(sheet.getProducts_({}).find((p) => p.id === s.croissant.id).stock, 20);
  assert.equal(demo.getProducts_({}).find((p) => p.id === d.croissant.id).stock, 20);
});

test('both hosts: a recipe deducts its ingredient, and dish cost/margin agree', () => {
  const sheet = loadSheetHost();
  const demo = loadDemoHost();
  const beansS = sheet.saveProduct_({ name: 'Coffee beans', price: 0, category: 'Ingredient', unit: 'g', cost: 0.1, kind: 'ingredient', track_stock: true, stock: 1000, staff_name: 't' });
  const beansD = demo.saveProduct_({ name: 'Coffee beans', price: 0, category: 'Ingredient', unit: 'g', cost: 0.1, kind: 'ingredient', track_stock: true, stock: 1000, staff_name: 't' });
  const latteS = sheet.saveProduct_({ name: 'Latte', price: 10.90, category: 'Coffee', unit: 'cup', staff_name: 't' });
  const latteD = demo.saveProduct_({ name: 'Latte', price: 10.90, category: 'Coffee', unit: 'cup', staff_name: 't' });
  sheet.saveRecipe_({ menu_product_id: latteS.id, lines: [{ ingredient_id: beansS.id, qty: 18 }] });
  demo.saveRecipe_({ menu_product_id: latteD.id, lines: [{ ingredient_id: beansD.id, qty: 18 }] });
  const outS = sheet.getRecipes_().find((r) => r.menu_product_id === latteS.id);
  const outD = demo.getRecipes_().find((r) => r.menu_product_id === latteD.id);
  assert.equal(outS.cost, outD.cost);
  assert.equal(outS.margin, outD.margin);
  sheet.createSale_({ sale_id: 'parity-recipe-1', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: latteS.id, qty: 3 }] });
  demo.createSale_({ sale_id: 'parity-recipe-1', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: latteD.id, qty: 3 }] });
  assert.equal(sheet.getProducts_({}).find((p) => p.id === beansS.id).stock, 946); // 1000 - 18*3
  assert.equal(demo.getProducts_({}).find((p) => p.id === beansD.id).stock, 946);
});

test('both hosts: waste logs the same cost and a reversal puts stock back', () => {
  const sheet = loadSheetHost();
  const demo = loadDemoHost();
  const s = sameMenu(sheet);
  const d = sameMenu(demo);
  const w1 = sheet.logWaste_({ waste_id: 'parity-waste-1', staff_name: 't', items: [{ product_id: s.croissant.id, qty: 2, reason: 'dropped' }] });
  const w2 = demo.logWaste_({ waste_id: 'parity-waste-1', staff_name: 't', items: [{ product_id: d.croissant.id, qty: 2, reason: 'dropped' }] });
  assert.equal(w1.lines[0].cost, w2.lines[0].cost);
  assert.equal(sheet.getProducts_({}).find((p) => p.id === s.croissant.id).stock, 18);
  sheet.reverseWaste_({ waste_id: 'parity-waste-1', reason: 'miscounted' });
  demo.reverseWaste_({ waste_id: 'parity-waste-1', reason: 'miscounted' });
  assert.equal(sheet.getProducts_({}).find((p) => p.id === s.croissant.id).stock, 20);
  assert.equal(demo.getProducts_({}).find((p) => p.id === d.croissant.id).stock, 20);
});

test('both hosts: receiving a purchase sets the same weighted average cost; reversing it undoes the stock', () => {
  const sheet = loadSheetHost();
  const demo = loadDemoHost();
  const milkS = sheet.saveProduct_({ name: 'Milk', price: 0, category: 'Ingredient', unit: 'ml', kind: 'ingredient', track_stock: true, stock: 0, pack_size: 1000, pack_unit: 'carton', staff_name: 't' });
  const milkD = demo.saveProduct_({ name: 'Milk', price: 0, category: 'Ingredient', unit: 'ml', kind: 'ingredient', track_stock: true, stock: 0, pack_size: 1000, pack_unit: 'carton', staff_name: 't' });
  const poS = sheet.receivePurchase_({ purchase_id: 'parity-po-1', supplier: 'Dairy Sdn Bhd', received_by: 't', lines: [{ ingredient_id: milkS.id, pack_qty: 4, pack_cost: 6.80 }] });
  const poD = demo.receivePurchase_({ purchase_id: 'parity-po-1', supplier: 'Dairy Sdn Bhd', received_by: 't', lines: [{ ingredient_id: milkD.id, pack_qty: 4, pack_cost: 6.80 }] });
  assert.equal(poS.lines[0].unit_cost, poD.lines[0].unit_cost);
  assert.equal(sheet.getProducts_({}).find((p) => p.id === milkS.id).stock, 4000);
  sheet.reversePurchase_({ purchase_id: 'parity-po-1', reason: 'wrong delivery' });
  demo.reversePurchase_({ purchase_id: 'parity-po-1', reason: 'wrong delivery' });
  assert.equal(sheet.getProducts_({}).find((p) => p.id === milkS.id).stock, 0);
  assert.equal(demo.getProducts_({}).find((p) => p.id === milkD.id).stock, 0);
});
