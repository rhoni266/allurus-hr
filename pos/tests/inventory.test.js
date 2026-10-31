// Inventory ledger: recipes, purchases, open containers, stocktakes and reports in apps-script/Code.gs, against the
// fake Sheet from code.test.js. Run: node --test pos/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'code.test.js'), 'utf8');
const helper = src.slice(src.indexOf('function load('), src.indexOf("test('3 items"));
const load = new Function('fs', 'path', 'vm', '__dirname', helper + '\nreturn load;')(fs, path, vm, __dirname);

const J = (x) => JSON.parse(JSON.stringify(x));
const rowsOf = (tabs, name) => tabs[name].slice(1).map((r) => Object.fromEntries(tabs[name][0].map((h, i) => [h, r[i]])));

// Latte: 200 ml milk + 18 g beans + 1 cup. Caramel latte adds 30 ml syrup. Croissant deducts itself (stock 20) and a cup.
function world() {
  const w = load();
  w.ctx.loadSampleIngredients();
  const all = w.call('getProducts', { includeInactive: true }).data;
  const ids = Object.fromEntries(all.map((p) => [p.name.replace(' (sample)', ''), p.id]));
  const ok = (r) => { assert.equal(r.ok, true, r.error); return r.data; };
  ok(w.call('saveRecipe', { menu_product_id: ids.Latte, lines: [
    { ingredient_id: ids['Fresh milk'], qty: 200 }, { ingredient_id: ids['Coffee beans'], qty: 18 }, { ingredient_id: ids['Takeaway cups'], qty: 1 }] }));
  ok(w.call('saveRecipe', { menu_product_id: ids['Spanish Latte'], lines: [
    { ingredient_id: ids['Fresh milk'], qty: 200 }, { ingredient_id: ids['Caramel syrup'], qty: 30 }] }));
  ok(w.call('saveRecipe', { menu_product_id: ids['Butter Croissant'], lines: [{ ingredient_id: ids['Takeaway cups'], qty: 1 }] }));
  const stock = () => Object.fromEntries(w.call('getProducts', { includeInactive: true }).data.map((p) => [p.name.replace(' (sample)', ''), p.stock]));
  const sale = (id, items) => ok(w.call('createSale', { sale_id: id, payment_method: 'card', items }));
  return { ...w, ids, ok, stock, sale };
}

test('purchase: 2 × 750 ml syrup adds 1500 ml, weighted average cost, retry is one delivery, tampered size ignored', () => {
  const { call, ids, ok, stock, tabs } = world();
  const d = { purchase_id: 'buy-0001', supplier: 'Monin MY', invoice_no: 'INV-77', received_by: 'Aina',
    lines: [{ ingredient_id: ids['Caramel syrup'], pack_qty: 2, pack_cost: 45, pack_size: 9999, total_qty: 1, unit_cost: 0.0001, expiry_date: '2027-06-30' }] };
  const r = ok(call('receivePurchase', d));
  assert.deepEqual(J([r.lines[0].total_qty, r.lines[0].pack_size, r.lines[0].line_cost, r.lines[0].unit_cost]), [1500, 750, 90, 0.06]);
  assert.equal(stock()['Caramel syrup'], 3000);
  // 1500 ml at 0.053333 (RM 79.9995) + RM 90.00 for 1500 ml = RM 169.9995 / 3000 ml = 0.0566665
  const avg = call('getProducts', { includeInactive: true }).data.find((p) => p.id === ids['Caramel syrup']).cost;
  assert.equal(avg, 0.056666);
  assert.equal(ok(call('receivePurchase', d)).duplicate, true);
  assert.equal(stock()['Caramel syrup'], 3000);
  const mv = rowsOf(tabs, 'StockMovements').filter((m) => m.reason_type === 'purchase');
  assert.deepEqual(J(mv.map((m) => [m.change_qty, m.unit_cost, m.value, m.balance_after])), [[1500, 0.06, 90, 3000]]);
  for (const [line, msg] of [[{ ingredient_id: 'nope', pack_qty: 1, pack_cost: 1 }, /Unknown/], [{ ingredient_id: ids['Caramel syrup'], pack_qty: 0, pack_cost: 1 }, /pack quantity/],
    [{ ingredient_id: ids['Caramel syrup'], pack_qty: 1 }, /cost per pack/], [{ ingredient_id: ids['Caramel syrup'], pack_qty: 1, pack_cost: 1, expiry_date: '30/06/2027' }, /YYYY-MM-DD/]]) {
    assert.match(call('receivePurchase', { purchase_id: 'buy-bad01', supplier: 'X', received_by: 'A', lines: [line] }).error, msg);
  }
  // Reverse: stock back out, average worked back
  ok(call('reversePurchase', { purchase_id: 'buy-0001', reason: 'Wrong invoice' }));
  assert.equal(stock()['Caramel syrup'], 1500);
  // Worked back to within 0.000001 of the 0.053333 it started at (6-decimal rounding, RM 0.0015 on 1500 ml)
  assert.equal(call('getProducts', { includeInactive: true }).data.find((p) => p.id === ids['Caramel syrup']).cost, 0.053332);
  assert.equal(ok(call('reversePurchase', { purchase_id: 'buy-0001', reason: 'Wrong invoice' })).already, true);
});

test('recipe sale deducts each ingredient once; an item can deduct itself and a recipe; tampered usage ignored', () => {
  const { tabs, ids, stock, sale } = world();
  const before = stock();
  const s = sale('sale-rcp01', [{ product_id: ids.Latte, qty: 2, usage: [{ product_id: ids['Fresh milk'], qty: 1 }] }, { product_id: ids['Butter Croissant'], qty: 1 }]);
  const after = stock();
  assert.equal(after['Fresh milk'], before['Fresh milk'] - 400);
  assert.equal(after['Coffee beans'], before['Coffee beans'] - 36);
  assert.equal(after['Takeaway cups'], before['Takeaway cups'] - 3); // 2 lattes + 1 croissant bag
  assert.equal(after['Butter Croissant'], before['Butter Croissant'] - 1);
  const mv = rowsOf(tabs, 'StockMovements').filter((m) => m.ref_id === 'sale-rcp01');
  assert.deepEqual(J(mv.map((m) => [m.reason_type, m.name.replace(' (sample)', ''), m.change_qty]).sort()), [
    ['sale', 'Butter Croissant', -1], ['sale_usage', 'Coffee beans', -36], ['sale_usage', 'Fresh milk', -400], ['sale_usage', 'Takeaway cups', -3]]);
  assert.deepEqual(J(s.no_recipe), []);
  assert.equal(rowsOf(tabs, 'Sales')[0].made_at, rowsOf(tabs, 'Sales')[0].datetime);
});

test('menu item with no stock and no recipe: nothing deducted, warned', () => {
  const { tabs, ids, sale, call } = world();
  const s = sale('sale-norc1', [{ product_id: ids.Americano, qty: 1 }]);
  assert.deepEqual(J(s.no_recipe), ['Americano (sample)']);
  assert.equal(rowsOf(tabs, 'StockMovements').filter((m) => m.ref_id === 'sale-norc1').length, 0);
  assert.equal(call('getRecipes').data.find((r) => r.menu_product_id === ids.Americano).warning, 'No recipe: stock not tracked for this dish');
});

test('void before made puts usage back; void after made keeps it, moves it to dish waste and logs the entry', () => {
  const { tabs, ids, stock, sale, call, ok } = world();
  const start = stock();
  sale('sale-vd001', [{ product_id: ids.Latte, qty: 1 }, { product_id: ids['Butter Croissant'], qty: 1 }]);
  ok(call('voidSale', { sale_id: 'sale-vd001', reason: 'Customer left', made: false }));
  assert.deepEqual(stock(), start);
  sale('sale-vd002', [{ product_id: ids.Latte, qty: 1 }, { product_id: ids['Butter Croissant'], qty: 1 }]);
  const afterSale = stock();
  const v = ok(call('voidSale', { sale_id: 'sale-vd002', reason: 'Customer left', made: true }));
  assert.equal(v.waste_id, 'void-sale-vd002');
  assert.deepEqual(stock(), afterSale); // used once, still used
  const w = rowsOf(tabs, 'Waste').filter((x) => x.waste_id === 'void-sale-vd002');
  assert.deepEqual(J(w.map((x) => [x.name.replace(' (sample)', ''), x.reason, x.waste_type, x.cost])),
    [['Latte', 'cancelled_after_made', 'dish', 4.01], ['Butter Croissant', 'cancelled_after_made', 'dish', 3.05]]);
  const types = rowsOf(tabs, 'StockMovements').filter((m) => /sale-vd002/.test(m.ref_id)).map((m) => m.reason_type);
  assert.deepEqual([...new Set(types)].sort(), ['sale', 'sale_usage', 'sale_usage_reversal', 'void_return', 'waste_dish']);
  const s = call('getDailySummary', { date: '2026-10-31' }).data;
  assert.deepEqual(J([s.waste_dish_cost, s.waste_ingredient_cost]), [7.06, 0]);
});

test('dish waste takes the recipe out; ingredient waste only the ingredient; reasons checked by type; reversal puts it back', () => {
  const { ids, stock, call, ok } = world();
  const start = stock();
  ok(call('logWaste', { waste_id: 'waste-dsh01', staff_name: 'Aina', items: [{ product_id: ids.Latte, qty: 1, reason: 'remake' },
    { product_id: ids['Fresh milk'], qty: 500, reason: 'expired_after_open' }] }));
  const s = stock();
  assert.equal(s['Fresh milk'], start['Fresh milk'] - 700);
  assert.equal(s['Coffee beans'], start['Coffee beans'] - 18);
  assert.match(call('logWaste', { waste_id: 'waste-dsh02', items: [{ product_id: ids['Fresh milk'], qty: 1, reason: 'quality_low' }] }).error, /reason/);
  assert.match(call('logWaste', { waste_id: 'waste-dsh03', items: [{ product_id: ids.Latte, qty: 1, reason: 'spilled' }] }).error, /reason/);
  const w = call('getWaste', {}).data;
  assert.deepEqual(J([w.dish_cost, w.ingredient_cost]), [4.01, 4]);
  ok(call('reverseWaste', { waste_id: 'waste-dsh01', reason: 'Logged twice' }));
  assert.deepEqual(stock(), start);
});

test('open containers: second open warns and needs a reason; total unchanged; oldest first; no sealed pack refused', () => {
  const { tabs, ids, stock, call, ok, sale } = world();
  const syrup = ids['Caramel syrup']; // 1500 ml = 2 bottles of 750
  const first = ok(call('openContainer', { container_id: 'cont-0001', ingredient_id: syrup, station: 'bar', staff_name: 'Aini' }));
  assert.equal(first.container.est_remaining, 750);
  const second = ok(call('openContainer', { container_id: 'cont-0002', ingredient_id: syrup, station: 'bar', staff_name: 'Badrul' }));
  assert.equal(second.needs_reason, true);
  assert.match(second.message, /already open since .* by Aini, about 750 ml left\. Open another\?/);
  assert.equal(rowsOf(tabs, 'OpenContainers').length, 1); // nothing written yet
  assert.match(call('openContainer', { container_id: 'cont-0002', ingredient_id: syrup, station: 'bar', staff_name: 'Badrul', reason: 'other' }).error, /note/);
  const opened = ok(call('openContainer', { container_id: 'cont-0002', ingredient_id: syrup, station: 'bar', staff_name: 'Badrul', reason: 'other_station', note: '' }));
  assert.equal(opened.double_open, true);
  assert.equal(stock()['Caramel syrup'], 1500); // opening moves nothing
  assert.match(call('openContainer', { container_id: 'cont-0003', ingredient_id: syrup, station: 'bar', staff_name: 'C', reason: 'first_finished' }).error, /No sealed bottle/);
  assert.match(call('openContainer', { container_id: 'cont-0004', ingredient_id: ids['Takeaway cups'], staff_name: 'C' }).error, /isn't set up for open containers/);
  // 26 Spanish lattes × 30 ml = 780 ml: 750 against the first bottle, 30 rolls to the second
  sale('sale-cnt01', [{ product_id: ids['Spanish Latte'], qty: 26 }]);
  const c = Object.fromEntries(rowsOf(tabs, 'OpenContainers').map((k) => [k.container_id, [k.allocated_qty, k.est_remaining, k.overrun]]));
  assert.deepEqual(J(c), { 'cont-0001': [750, 0, false], 'cont-0002': [30, 720, false] });
  assert.deepEqual(J(rowsOf(tabs, 'StockMovements').filter((m) => m.reason_type === 'container_open').map((m) => [m.change_qty, m.balance_after])), [[0, 1500], [0, 1500]]);
  assert.equal(call('getContainers', {}).data.double_opens.length, 1);
});

test('finish computes variance; discard writes waste for the rest; void before made takes usage back off the container', () => {
  const { tabs, ids, stock, call, ok, sale } = world();
  const syrup = ids['Caramel syrup'];
  ok(call('openContainer', { container_id: 'cont-fin01', ingredient_id: syrup, staff_name: 'Aini' }));
  sale('sale-fin01', [{ product_id: ids['Spanish Latte'], qty: 3 }]); // 90 ml
  sale('sale-fin02', [{ product_id: ids['Spanish Latte'], qty: 1 }]); // 30 ml
  ok(call('voidSale', { sale_id: 'sale-fin02', reason: 'Not made', made: false }));
  const f = ok(call('finishContainer', { container_id: 'cont-fin01', staff_name: 'Aini' }));
  assert.deepEqual(J([f.container.status, f.container.allocated_qty, f.container.variance]), ['finished', 90, 660]);
  assert.equal(ok(call('finishContainer', { container_id: 'cont-fin01' })).already, true);
  ok(call('openContainer', { container_id: 'cont-dis01', ingredient_id: syrup, staff_name: 'Aini' }));
  const before = stock()['Caramel syrup'];
  assert.match(call('discardContainer', { container_id: 'cont-dis01', reason: 'spilled', remaining_estimate: 'half' }).error, /How much is left/);
  const dsc = ok(call('discardContainer', { container_id: 'cont-dis01', reason: 'expired_after_open', remaining_estimate: '50%', staff_name: 'Aini' }));
  assert.deepEqual(J([dsc.wasted, dsc.container.status, dsc.container.variance]), [375, 'discarded', 375]);
  assert.equal(stock()['Caramel syrup'], before - 375);
  const w = rowsOf(tabs, 'Waste').find((x) => x.waste_id === 'disc-cont-dis01');
  assert.deepEqual(J([w.qty, w.reason, w.waste_type, w.cost]), [375, 'expired_after_open', 'ingredient', 20]);
});

test('use-by: containers past their date are flagged and listed first', () => {
  const { tabs, ids, call, ok } = world();
  ok(call('openContainer', { container_id: 'cont-ub001', ingredient_id: ids['Fresh milk'], staff_name: 'A' }));
  ok(call('openContainer', { container_id: 'cont-ub002', ingredient_id: ids['Coffee beans'], staff_name: 'A' }));
  const t = tabs.OpenContainers;
  t[2][t[0].indexOf('use_by')] = '2026-10-01';
  const open = call('getContainers', {}).data.open;
  assert.deepEqual(J(open.map((k) => [k.container_id, k.use_by_flag])), [['cont-ub002', 'past'], ['cont-ub001', 'near']]);
});

test('stocktake: variance and value from the server, reason over 5%, adjustment makes balance equal the count', () => {
  const { tabs, ids, stock, call, ok } = world();
  assert.match(call('stockCount', { count_id: 'count-001', counted_by: 'Aina', lines: [{ ingredient_id: ids['Fresh milk'], counted_qty: 9000 }] }).error,
    /expected 10000 \(10% off\)\. Add a reason/);
  const r = ok(call('stockCount', { count_id: 'count-001', counted_by: 'Aina', lines: [
    { ingredient_id: ids['Fresh milk'], counted_qty: 9000, note: 'Carton leaked', expected_qty: 1, variance: 0 },
    { ingredient_id: ids['Caramel syrup'], sealed_packs: 1, open: ['100%', '50%'], note: 'Delivery not entered' },
    { ingredient_id: ids['Coffee beans'], counted_qty: 1950 }] }));
  assert.deepEqual(J(r.lines.map((l) => [l.counted_qty, l.expected_qty, l.variance, l.variance_value])),
    [[9000, 10000, -1000, -8], [1875, 1500, 375, 20], [1950, 2000, -50, -6]]);
  const s = stock();
  assert.deepEqual([s['Fresh milk'], s['Caramel syrup'], s['Coffee beans']], [9000, 1875, 1950]);
  assert.equal(ok(call('stockCount', { count_id: 'count-001', counted_by: 'Aina', lines: [{ ingredient_id: ids['Fresh milk'], counted_qty: 1 }] })).duplicate, true);
  assert.equal(rowsOf(tabs, 'StockMovements').filter((m) => m.reason_type === 'stocktake_adjustment').length, 3);
});

test('balance_after equals the recomputed balance after purchase, sale, void, dish and ingredient waste, open, finish, count', () => {
  const { tabs, ids, call, ok, sale } = world();
  const syrup = ids['Caramel syrup'];
  ok(call('receivePurchase', { purchase_id: 'buy-mix01', supplier: 'S', received_by: 'A', lines: [{ ingredient_id: syrup, pack_qty: 1, pack_cost: 40 },
    { ingredient_id: ids['Fresh milk'], pack_qty: 6, pack_cost: 7.5 }] }));
  ok(call('openContainer', { container_id: 'cont-mix01', ingredient_id: syrup, staff_name: 'A' }));
  sale('sale-mix01', [{ product_id: ids['Spanish Latte'], qty: 4 }, { product_id: ids['Butter Croissant'], qty: 2 }]);
  sale('sale-mix02', [{ product_id: ids.Latte, qty: 3 }]);
  ok(call('voidSale', { sale_id: 'sale-mix01', reason: 'Wrong order', made: true }));
  ok(call('voidSale', { sale_id: 'sale-mix02', reason: 'Card declined', made: false }));
  ok(call('logWaste', { waste_id: 'waste-mix01', items: [{ product_id: ids.Latte, qty: 1, reason: 'quality_low' }, { product_id: syrup, qty: 15, reason: 'spilled' }] }));
  ok(call('finishContainer', { container_id: 'cont-mix01' }));
  ok(call('stockCount', { count_id: 'count-mix1', counted_by: 'A', lines: [{ ingredient_id: ids['Coffee beans'], counted_qty: 1980 }] }));
  ok(call('stockAdjust', { movement_id: 'move-mix01', product_id: ids['Takeaway cups'], change_qty: -4, reason_type: 'adjustment', note: 'Crushed' }));
  const moves = rowsOf(tabs, 'StockMovements');
  const bal = {};
  for (const m of moves) {
    bal[m.product_id] = Math.round(((bal[m.product_id] || 0) + m.change_qty) * 1000) / 1000;
    assert.equal(m.balance_after, bal[m.product_id], `${m.name} ${m.reason_type}`);
  }
  const rep = call('getStockReport', {}).data;
  assert.equal(rep.reconciled, true);
  const use = call('getUsageReport', { date_from: '2026-10-31', date_to: '2026-10-31' }).data;
  assert.equal(use.reconciled, true);
  const milk = use.rows.find((x) => x.product_id === ids['Fresh milk']);
  // 10000 opening (stock_in today counts as purchases) + 6000 bought; mix01 void made: −800 sale usage moved to dish waste; latte waste −200
  assert.deepEqual(J([milk.purchases, milk.sales_usage, milk.dish_waste, milk.closing, milk.on_hand]), [16000, 0, -1000, 15000, 15000]);
});

test('recipes: cost and margin; refused when an item is in its own recipe, twice, or with a bad quantity', () => {
  const { ids, call } = world();
  const latte = call('getRecipes').data.find((r) => r.menu_product_id === ids.Latte);
  assert.deepEqual(J([latte.cost, latte.margin, latte.margin_percent, latte.deducts]), [4.01, 6.89, 63.2, '3 ingredients']);
  const cr = call('getRecipes').data.find((r) => r.menu_product_id === ids['Butter Croissant']);
  assert.deepEqual(J([cr.cost, cr.deducts]), [3.05, 'itself + 1 ingredient']);
  const save = (lines, menu = ids.Latte) => call('saveRecipe', { menu_product_id: menu, lines });
  assert.match(save([{ ingredient_id: ids['Butter Croissant'], qty: 1 }], ids['Butter Croissant']).error, /own recipe/);
  assert.match(save([{ ingredient_id: ids['Fresh milk'], qty: 1 }, { ingredient_id: ids['Fresh milk'], qty: 2 }]).error, /twice/);
  assert.match(save([{ ingredient_id: ids['Takeaway cups'], qty: 0.5 }]).error, /Bad quantity/);
  assert.match(save([], ids['Fresh milk']).error, /menu item/);
  assert.equal(save([]).data.warning, 'No recipe: stock not tracked for this dish');
});

test('products: unit can\'t change while tracked; open tracking needs a pack size; cost keeps 6 decimals', () => {
  const { call, ids } = world();
  const milk = call('getProducts', { includeInactive: true }).data.find((p) => p.id === ids['Fresh milk']);
  assert.match(call('saveProduct', { ...milk, unit: 'l' }).error, /unit can't change/);
  assert.match(call('saveProduct', { name: 'Oat milk', kind: 'ingredient', unit: 'ml', track_open: true }).error, /pack size/);
  const p = call('saveProduct', { name: 'Vanilla syrup', kind: 'ingredient', unit: 'ml', cost: 0.0466667, pack_size: 750, track_open: true }).data;
  assert.equal(p.cost, 0.046667);
});
