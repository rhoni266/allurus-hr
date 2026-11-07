// demo/seed.js runs the real business functions (saveProduct_, saveRecipe_, createSale_, logWaste_,
// receivePurchase_, openContainer_) to fill the demo, so this just checks it runs cleanly end to end and leaves a
// believable cafe behind: 20-25 menu items in several categories, some low stock, one open container, a week of
// sales, and that running it twice doesn't double the data (demo/local-host.js's isEmpty() guard).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDemo() {
  const ctx = {};
  ctx.window = ctx;
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
  ['local-host.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'demo', f), 'utf8'), ctx));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'pos-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'demo', 'seed.js'), 'utf8'), ctx);
  return ctx;
}

test('seeds 20-25 active menu items across several categories', () => {
  const demo = loadDemo();
  const menu = demo.getProducts_({}).filter((p) => p.kind === 'menu');
  assert.ok(menu.length >= 20 && menu.length <= 25, `expected 20-25 menu items, got ${menu.length}`);
  assert.ok(menu.every((p) => p.active));
  const categories = new Set(menu.map((p) => p.category));
  assert.ok(categories.size >= 4, `expected at least 4 categories, got ${[...categories]}`);
});

test('at least 3 ingredients are at or below their reorder level, and none of the heavily-used ones ran negative', () => {
  const demo = loadDemo();
  const items = demo.getStockReport_().items;
  const low = items.filter((i) => i.below_reorder);
  assert.ok(low.length >= 3, `expected at least 3 low-stock items, got ${low.length}`);
  const negative = items.filter((i) => i.track_stock && i.on_hand < 0);
  assert.deepEqual(negative.map((i) => i.name), [], 'a believable week should not sell out any ingredient entirely');
});

test('one open container and one received purchase exist', () => {
  const demo = loadDemo();
  const containers = demo.getContainers_({});
  assert.equal(containers.open.length, 1);
  const purchases = demo.getPurchases_({ date_from: '2000-01-01', date_to: '2999-01-01' });
  assert.ok(purchases.rows.length >= 2); // one delivery, 2 ingredient lines
});

test('there are sales today and on each of the last 7 days, and a few waste entries', () => {
  const demo = loadDemo();
  for (let day = 0; day <= 7; day++) {
    const d = new Date(Date.now() - day * 86400000);
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
    const summary = demo.getDailySummary_({ date: iso });
    assert.ok(summary.orders > 0, `expected sales on ${iso}, got 0`);
  }
  const waste = demo.getWaste_({ date_from: '2000-01-01', date_to: '2999-01-01' });
  assert.ok(waste.rows.length >= 4);
});

test('at least one menu item has a recipe, so dish cost and margin show', () => {
  const demo = loadDemo();
  const withCost = demo.getRecipes_().filter((r) => !r.cost_missing && r.lines.length);
  assert.ok(withCost.length >= 5, `expected several recipes with a cost, got ${withCost.length}`);
});

test('running the seed twice does not duplicate the menu (isEmpty guard)', () => {
  const demo = loadDemo();
  const before = demo.getProducts_({ includeInactive: true }).length;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'demo', 'seed.js'), 'utf8'), demo);
  const after = demo.getProducts_({ includeInactive: true }).length;
  assert.equal(after, before);
});
