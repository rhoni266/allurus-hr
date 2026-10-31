// Waste, stock movements and stock adjustments in apps-script/Code.gs, against the same fake Sheet as code.test.js.
// Run: node --test pos/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// code.test.js registers its own tests when required, so load the helper by re-reading it with tests stubbed out.
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, 'code.test.js'), 'utf8');
const helper = src.slice(src.indexOf('function load('), src.indexOf("test('3 items"));
const load = new Function('fs', 'path', 'vm', '__dirname', helper + '\nreturn load;')(fs, path, vm, __dirname);

const J = (x) => JSON.parse(JSON.stringify(x)); // values from the vm realm, for deepEqual
const stockOf = (call, id) => call('getProducts', { includeInactive: true }).data.find((p) => p.id === id).stock;
const head = (tabs, name) => tabs[name][0];
const rowsOf = (tabs, name) => tabs[name].slice(1).map((r) => Object.fromEntries(head(tabs, name).map((h, i) => [h, r[i]])));

function world() {
  const w = load();
  w.ctx.loadSampleIngredients();
  const all = w.call('getProducts', { includeInactive: true }).data;
  w.ids = Object.fromEntries(all.map((p) => [p.name.replace(' (sample)', ''), p.id]));
  return w;
}

test('log waste: stock drops once, Waste and StockMovements rows, cost = qty × unit cost (from the server)', () => {
  const { tabs, call, ids } = world();
  const r = call('logWaste', { waste_id: 'waste-0001', staff_name: 'Aina', items: [
    { product_id: ids['Butter Croissant'], qty: 3, reason: 'expired', unit_cost: 0.01, cost: 0.01 },
    { product_id: ids['Fresh milk'], qty: '250', reason: 'spoiled' },
    { product_id: ids.Latte, qty: 1, reason: 'dropped' }] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(J(r.data.lines.map((l) => [l.line_no, l.qty, l.unit, l.unit_cost, l.cost])),
    [[1, 3, 'pcs', 2.8, 8.4], [2, 250, 'ml', 0.008, 2], [3, 1, 'cup', 2.6, 2.6]]);
  assert.equal(stockOf(call, ids['Butter Croissant']), 17);
  assert.equal(stockOf(call, ids['Fresh milk']), 9750);
  assert.equal(stockOf(call, ids.Latte), ''); // not tracked: no stock, no movement
  const w = rowsOf(tabs, 'Waste');
  assert.equal(w.length, 3); assert.ok(w.every((x) => x.waste_id === 'waste-0001' && x.status === 'logged' && x.staff_name === 'Aina'));
  const m = rowsOf(tabs, 'StockMovements').filter((x) => /^waste_/.test(x.reason_type));
  assert.deepEqual(J(m.map((x) => [x.reason_type, x.change_qty, x.balance_after, x.ref_id, x.value])),
    [['waste_dish', -3, 17, 'waste-0001', -8.4], ['waste_ingredient', -250, 9750, 'waste-0001', -2]]);
});

test('same waste_id twice (double tap / retry): one record, stock drops once', () => {
  const { tabs, call, ids } = world();
  const d = { waste_id: 'waste-dup01', items: [{ product_id: ids['Burnt Cheesecake'], qty: 1, reason: 'dropped' }] };
  call('logWaste', d);
  const again = call('logWaste', d);
  assert.equal(again.data.duplicate, true); assert.equal(again.data.lines.length, 1);
  assert.equal(rowsOf(tabs, 'Waste').length, 1);
  assert.equal(stockOf(call, ids['Burnt Cheesecake']), 7);
});

test('bad input is refused with a clear message', () => {
  const { tabs, call, ids } = world();
  const bad = (items, extra = {}) => call('logWaste', { waste_id: 'waste-bad01', items, ...extra });
  const c = ids['Butter Croissant'];
  for (const [items, msg] of [
    [[{ product_id: c, qty: 0, reason: 'spoiled' }], /Bad quantity/],
    [[{ product_id: c, qty: -2, reason: 'spoiled' }], /Bad quantity/],
    [[{ product_id: c, qty: 'two', reason: 'spoiled' }], /Bad quantity/],
    [[{ product_id: c, qty: 1.5, reason: 'spoiled' }], /whole number/],
    [[{ product_id: ids['Fresh milk'], qty: 0.0005, reason: 'spoiled' }], /3 decimals/],
    [[{ product_id: c, qty: 1000, reason: 'spoiled' }], /too large/],
    [[{ product_id: 'nope', qty: 1, reason: 'spoiled' }], /Unknown product/],
    [[{ product_id: c, qty: 1, reason: 'stolen' }], /Choose a reason/],
    [[{ product_id: c, qty: 1, reason: 'other' }], /note/],
    [[{ product_id: c, qty: 1, reason: 'other', note: '4111-1111-1111-1111' }], /card number/],
    [[], /at least one/],
    [Array.from({ length: 51 }, () => ({ product_id: c, qty: 1, reason: 'spoiled' })), /50 lines/],
  ]) {
    const r = bad(items);
    assert.equal(r.ok, false, JSON.stringify(items).slice(0, 80)); assert.match(r.error, msg);
  }
  assert.equal(rowsOf(tabs, 'Waste').length, 0);
  assert.equal(stockOf(call, c), 20);
  assert.equal(call('logWaste', { waste_id: 'waste-oth01', items: [{ product_id: c, qty: 1, reason: 'other', note: 'Fly landed on it' }] }).ok, true);
});

test('reverse: reason required, stock back, entry reversed, reversal rows added, second call does nothing', () => {
  const { tabs, call, ids } = world();
  call('logWaste', { waste_id: 'waste-rev01', items: [{ product_id: ids['Chocolate Brownie'], qty: 2, reason: 'remake' }] });
  assert.equal(stockOf(call, ids['Chocolate Brownie']), 10);
  assert.match(call('reverseWaste', { waste_id: 'waste-rev01', reason: '' }).error, /reason/);
  assert.equal(call('reverseWaste', { waste_id: 'waste-rev01', reason: 'Logged by mistake' }).data.already, false);
  assert.equal(call('reverseWaste', { waste_id: 'waste-rev01', reason: 'Logged by mistake' }).data.already, true);
  assert.equal(stockOf(call, ids['Chocolate Brownie']), 12);
  const w = rowsOf(tabs, 'Waste');
  assert.deepEqual(J(w.map((x) => [x.waste_id, x.status, x.qty, x.cost, x.reverses_waste_id])),
    [['waste-rev01', 'reversed', 2, 5.8, ''], ['rev-waste-rev01', 'reversal', -2, -5.8, 'waste-rev01']]);
  assert.equal(rowsOf(tabs, 'StockMovements').filter((x) => x.reason_type === 'waste_reversal').length, 1);
  assert.equal(call('getWaste', {}).data.waste_cost, 0);
});

test('daily summary: waste cost and % of sales; staff meals kept apart; voids and sales unchanged', () => {
  const { call, ids } = world();
  call('createSale', { sale_id: 'sale-sum01', payment_method: 'cash', items: [{ product_id: ids['Chicken Sandwich'], qty: 2 }] }); // 29.80
  call('logWaste', { waste_id: 'waste-sum01', items: [
    { product_id: ids['Butter Croissant'], qty: 1, reason: 'expired' }, // 2.80
    { product_id: ids['Chicken Sandwich'], qty: 1, reason: 'staff_meal' }] }); // 5.40, not waste
  call('logWaste', { waste_id: 'waste-sum02', items: [{ product_id: ids['Fresh milk'], qty: 100, reason: 'spoiled' }] }); // 0.80
  const s = call('getDailySummary', { date: '2026-10-31' }).data;
  assert.deepEqual(J([s.total_sales, s.orders, s.waste_cost, s.waste_count, s.waste_percent_of_sales, s.staff_meal_cost, s.staff_meal_count]),
    [29.8, 1, 3.6, 2, 12.08, 5.4, 1]);
  assert.deepEqual(J(s.waste_by_reason), [{ reason: 'expired', cost: 2.8, lines: 1 }, { reason: 'spoiled', cost: 0.8, lines: 1 }]);
  const none = load().call('getDailySummary', { date: '2026-10-31' }).data;
  assert.equal(none.waste_percent_of_sales, null); // no sales: no division by zero
});

test('missing cost: waste is saved with qty and flagged, not priced', () => {
  const { call } = world();
  const p = call('saveProduct', { name: 'Oat milk', price: 0, unit: 'l', kind: 'ingredient', track_stock: true, stock: 5 }).data;
  const r = call('logWaste', { waste_id: 'waste-nocost', items: [{ product_id: p.id, qty: 0.5, reason: 'spoiled' }] }).data;
  assert.equal(r.lines[0].cost_missing, true); assert.equal(r.lines[0].cost, '');
  assert.equal(call('getWaste', {}).data.cost_missing_lines, 1);
});

test('stock in / adjust: reasons, idempotent by movement_id, untracked starts tracking on stock in', () => {
  const { tabs, call, ids } = world();
  const c = ids['Butter Croissant'];
  const adj = (d) => call('stockAdjust', { product_id: c, movement_id: 'move-' + Math.random().toString(36).slice(2, 10), ...d });
  assert.match(adj({ change_qty: 5, reason_type: 'adjustment', note: '' }).error, /reason/);
  assert.match(adj({ change_qty: -5, reason_type: 'stock_in' }).error, /more than 0/);
  assert.match(adj({ change_qty: 1.5, reason_type: 'stock_in' }).error, /Bad quantity/);
  const once = { movement_id: 'move-fixed01', product_id: c, change_qty: 12, reason_type: 'stock_in', note: 'Morning delivery' };
  call('stockAdjust', once);
  assert.equal(call('stockAdjust', once).data.duplicate, true);
  assert.equal(stockOf(call, c), 32);
  assert.equal(adj({ change_qty: -2, reason_type: 'adjustment', note: 'Recount' }).data.balance_after, 30);
  assert.match(call('stockAdjust', { movement_id: 'move-late01', product_id: ids.Latte, change_qty: -1, reason_type: 'adjustment', note: 'x x x' }).error, /not tracked/);
  call('stockAdjust', { movement_id: 'move-late02', product_id: ids.Latte, change_qty: 40, reason_type: 'stock_in' });
  assert.equal(stockOf(call, ids.Latte), 40);
  assert.equal(rowsOf(tabs, 'StockMovements').filter((x) => x.movement_id === 'move-fixed01').length, 1);
});

test('products: editing never types over stock; tracking off writes an adjustment; ingredients can\'t be sold', () => {
  const { tabs, call, ids } = world();
  const all = call('getProducts', { includeInactive: true }).data;
  const cr = all.find((p) => p.id === ids['Butter Croissant']);
  call('saveProduct', { ...cr, stock: 999, cost: 3 });
  assert.equal(stockOf(call, cr.id), 20);
  call('saveProduct', { ...cr, track_stock: false });
  assert.equal(stockOf(call, cr.id), '');
  const last = rowsOf(tabs, 'StockMovements').pop();
  assert.deepEqual(J([last.reason_type, last.change_qty, last.balance_after]), ['adjustment', -20, 0]);
  const r = call('createSale', { sale_id: 'sale-ingr1', payment_method: 'cash', items: [{ product_id: ids['Fresh milk'], qty: 1 }] });
  assert.equal(r.ok, false); assert.match(r.error, /not on sale/);
});

test('balance_after always equals the product\'s stock after a mix of sale, waste, void, reversal and adjust', () => {
  const { tabs, call, ids } = world();
  const c = ids['Butter Croissant'];
  call('createSale', { sale_id: 'sale-mix01', payment_method: 'card', items: [{ product_id: c, qty: 4 }, { product_id: c, qty: 1, note: 'warm' }] });
  call('logWaste', { waste_id: 'waste-mix01', items: [{ product_id: c, qty: 2, reason: 'dropped' }] });
  call('voidSale', { sale_id: 'sale-mix01', reason: 'Wrong table' });
  call('stockAdjust', { movement_id: 'move-mix01', product_id: c, change_qty: -1, reason_type: 'adjustment', note: 'Recount' });
  call('reverseWaste', { waste_id: 'waste-mix01', reason: 'Was fine' });
  call('createSale', { sale_id: 'sale-mix02', payment_method: 'cash', items: [{ product_id: c, qty: 25 }] }); // goes negative: warn only
  const moves = rowsOf(tabs, 'StockMovements').filter((m) => m.product_id === c);
  assert.deepEqual(J(moves.map((m) => [m.reason_type, m.change_qty, m.balance_after])), [
    ['stock_in', 20, 20], ['sale', -5, 15], ['waste_dish', -2, 13], ['void_return', 5, 18], ['adjustment', -1, 17],
    ['waste_reversal', 2, 19], ['sale', -25, -6]]);
  assert.equal(stockOf(call, c), -6);
  let bal = 0;
  for (const m of moves) { bal = Math.round((bal + m.change_qty) * 1000) / 1000; assert.equal(m.balance_after, bal); }
});
