// Runs apps-script/Code.gs in Node against a fake Google Sheet. Run: node --test pos/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(props = {}) {
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
    Utilities: { getUuid: () => `uuid-${String(++uuid).padStart(8, '0')}`, formatDate: () => '2026-10-31T10:00:00+08:00' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  ctx.setup();
  ctx.loadSampleMenu();
  const call = (action, data, key = P.SECRET_KEY) => ctx.doPost({ postData: { contents: JSON.stringify({ key, action, data }) } });
  const prods = Object.fromEntries(call('getProducts', {}).data.map((p) => [p.name.replace(' (sample)', ''), p]));
  return { tabs, call, prods };
}

test('3 items cash: server totals, 5-sen rounding, rows written, stock reduced', () => {
  const { tabs, call, prods } = load();
  const r = call('createSale', { sale_id: 'sale-0001', payment_method: 'cash', order_type: 'takeaway', items: [
    { product_id: prods.Latte.id, qty: 2, note: 'less sugar' }, { product_id: prods['Butter Croissant'].id, qty: 1 }, { product_id: prods['Teh Tarik'].id, qty: 1 }] });
  assert.equal(r.ok, true);
  assert.equal(r.data.subtotal, 34.8); assert.equal(r.data.total, 34.8); assert.equal(r.data.receipt_no, 'R000001');
  assert.equal(tabs.Sales.length, 2); assert.equal(tabs.SaleItems.length, 4);
  assert.equal(call('getProducts', {}).data.find((p) => p.id === prods['Butter Croissant'].id).stock, 19);
  assert.equal(call('getProducts', {}).data.find((p) => p.id === prods.Latte.id).stock, ''); // not tracked
});

test('cash rounding and tax/service from Script Properties (service on dine-in only)', () => {
  const { call, prods } = load({ SST_PERCENT: 6, SERVICE_PERCENT: 10 });
  // 7.90 + 10% = 8.69; 6% of 8.69 = 0.52; 9.21 → cash 9.20
  const a = call('createSale', { sale_id: 'sale-rnd1', payment_method: 'cash', order_type: 'dine_in', items: [{ product_id: prods.Americano.id, qty: 1 }] }).data;
  assert.equal(JSON.stringify([a.service, a.tax, a.rounding, a.total]), '[0.79, 0.52, -0.01, 9.2]'.replace(/ /g, ''));
  const b = call('createSale', { sale_id: 'sale-rnd2', payment_method: 'card', order_type: 'takeaway', items: [{ product_id: prods.Americano.id, qty: 1 }] }).data;
  assert.equal(JSON.stringify([b.service, b.tax, b.rounding, b.total]), '[0, 0.47, 0, 8.37]'.replace(/ /g, ''));
});

test('same sale_id twice (double tap / retry) saves one sale', () => {
  const { tabs, call, prods } = load();
  const d = { sale_id: 'sale-dup1', payment_method: 'cash', items: [{ product_id: prods['Butter Croissant'].id, qty: 1 }] };
  call('createSale', d); const again = call('createSale', d);
  assert.equal(again.data.duplicate, true); assert.equal(tabs.Sales.length, 2);
  assert.equal(call('getProducts', {}).data.find((p) => p.id === prods['Butter Croissant'].id).stock, 19);
});

test('tampered price is ignored; bad lines rejected', () => {
  const { call, prods } = load();
  const r = call('createSale', { sale_id: 'sale-tamp', payment_method: 'ewallet', items: [{ product_id: prods.Latte.id, qty: 1, unit_price: 0.01, price: 0.01 }], total: 0.01 });
  assert.equal(r.data.total, 10.9);
  for (const items of [[{ product_id: 'nope', qty: 1 }], [{ product_id: prods.Latte.id, qty: 0 }], [{ product_id: prods.Latte.id, qty: 1.5 }], []]) {
    assert.equal(call('createSale', { sale_id: 'sale-bad1', payment_method: 'cash', items }).ok, false);
  }
  call('saveProduct', { ...prods.Latte, active: false });
  assert.equal(call('createSale', { sale_id: 'sale-bad2', payment_method: 'cash', items: [{ product_id: prods.Latte.id, qty: 1 }] }).ok, false);
});

test('card number in a note is refused', () => {
  const { call, prods } = load();
  const r = call('createSale', { sale_id: 'sale-card', payment_method: 'card', items: [{ product_id: prods.Latte.id, qty: 1, note: '4111 1111 1111 1111' }] });
  assert.equal(r.ok, false); assert.match(r.error, /card number/);
});

test('void: reason required, stock restored, summary excludes it', () => {
  const { call, prods } = load();
  const id = prods['Burnt Cheesecake'].id;
  call('createSale', { sale_id: 'sale-void1', payment_method: 'cash', items: [{ product_id: id, qty: 2 }] });
  call('createSale', { sale_id: 'sale-void2', payment_method: 'duitnow_qr', items: [{ product_id: prods.Latte.id, qty: 1 }] });
  assert.equal(call('voidSale', { sale_id: 'sale-void1', reason: '' }).ok, false);
  assert.equal(call('voidSale', { sale_id: 'sale-void1', reason: 'Wrong order' }).ok, true);
  assert.equal(call('voidSale', { sale_id: 'sale-void1', reason: 'Wrong order' }).data.already, true);
  assert.equal(call('getProducts', {}).data.find((p) => p.id === id).stock, 8);
  const s = call('getDailySummary', { date: '2026-10-31' }).data;
  assert.equal(JSON.stringify([s.orders, s.total_sales, s.by_method]), '[1,10.9,{"duitnow_qr":10.9}]');
  assert.equal(s.top_items[0].qty, 1);
  assert.equal(s.voided, 1); assert.equal(s.sales.length, 2);
  assert.equal(s.sales.find((x) => x.sale_id === 'sale-void1').status, 'void');
});

test('wrong or missing key: generic refusal', () => {
  const { call } = load();
  assert.equal(JSON.stringify(call('getProducts', {}, 'wrong-secret-12')), '{"ok":false,"error":"Not allowed"}');
  assert.equal(JSON.stringify(call('getProducts', {}, null)), '{"ok":false,"error":"Not allowed"}');
});

test('products: add, edit, deactivate (hidden from the till, still listed for management)', () => {
  const { call } = load();
  const p = call('saveProduct', { name: 'Matcha Latte', price: '12.9', stock: '', category: 'Tea' }).data;
  call('saveProduct', { ...p, price: 13.5, active: false });
  assert.equal(call('getProducts', {}).data.some((x) => x.id === p.id), false);
  assert.equal(call('getProducts', { includeInactive: true }).data.find((x) => x.id === p.id).price, 13.5);
});
