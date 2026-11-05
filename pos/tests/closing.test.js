// Closing the day: the tally per role, cash count, the stock checklist that carries over, and who can see what
// (apps-script/Code.gs, against the fake Sheet from code.test.js). Run: node --test pos/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'code.test.js'), 'utf8');
const helper = src.slice(src.indexOf('function load('), src.indexOf("test('3 items"));
const load = new Function('fs', 'path', 'vm', '__dirname', 'require', helper + '\nreturn load;')(fs, path, vm, __dirname, require);

const J = (x) => JSON.parse(JSON.stringify(x));
const rowsOf = (tabs, name) => tabs[name].slice(1).map((r) => Object.fromEntries(tabs[name][0].map((h, i) => [h, r[i]])));
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.data; };
const day = (n) => new Date(Date.UTC(2026, 9, 31 + n)).toISOString().slice(0, 10); // 2026-10-31 is "today" in the fake

// The fake clock is fixed, so tests move "today" by replacing the two date helpers.
function world() {
  const w = load();
  w.setDay = (n) => { w.ctx.today_ = () => day(n); w.ctx.addDays_ = (k) => day(n + k); };
  w.setDay(0);
  return w;
}
// cash(10.9) -> the notes and coins that add up to RM 10.90, as { "<sen>": count }
const cash = (rm) => { let sen = Math.round(rm * 100); const out = {}; for (const v of [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5]) { const n = Math.floor(sen / v); if (n) { out[v] = n; sen -= n * v; } } return out; };
const sale = (w, id, as, method = 'cash') => w.call('createSale', { sale_id: id, payment_method: method, items: [{ product_id: w.prods.Latte.id, qty: 1 }] }, undefined, as);
const milk = (w, stock) => ok(w.call('saveProduct', { name: 'Milk', price: 0, kind: 'ingredient', unit: 'l', track_stock: true, stock, reorder_level: 5, cost: 8 }));

test('tally: a cashier sees only their own sales, a supervisor all, an admin every transaction in detail', () => {
  const w = world();
  assert.equal(sale(w, 'sale-clo001', 'c1', 'card').ok, true);
  assert.equal(sale(w, 'sale-clo002', 'sv1', 'cash').ok, true);
  const c = ok(w.call('getClosing', {}, undefined, 'c1'));
  assert.deepEqual(J([c.scope, c.orders, c.total_sales, c.by_method, c.cash_expected]), ['own', 1, 10.9, { card: 10.9 }, 0]);
  assert.equal(c.stock, undefined);
  assert.equal(c.transactions, undefined);
  // the cashier can't read the stock list or the transaction detail
  assert.equal(w.call('getClosingStock', {}, undefined, 'c1').error, 'Not allowed for a cashier');
  assert.equal(w.call('getClosingDetail', {}, undefined, 'c1').error, 'Not allowed for a cashier');
  const s = ok(w.call('getClosing', {}, undefined, 'sv1'));
  assert.deepEqual(J([s.scope, s.orders, s.total_sales, s.cash_expected]), ['all', 2, 21.8, 10.9]);
  assert.ok(Array.isArray(ok(w.call('getClosingStock', {}, undefined, 'sv1')).list));
  assert.equal(w.call('getClosingDetail', {}, undefined, 'sv1').error, 'Not allowed for a supervisor');
  const a = ok(w.call('getClosingDetail', {}, undefined, 'admin'));
  assert.equal(a.transactions.length, 2);
  assert.deepEqual(J(a.transactions.map((t) => [t.cashier_id, t.payment_method, t.items.length, t.items[0].name])), [['c1', 'card', 1, 'Latte (sample)'], ['sv1', 'cash', 1, 'Latte (sample)']]);
  assert.equal(a.transactions[0].cashier_name, 'Cindy Tan');
  assert.ok(a.waste);
  assert.ok(Array.isArray(ok(w.call('getClosingStock', {}, undefined, 'admin')).list));
});

test('tally: voided sales are counted apart and the admin sees who approved the void', () => {
  const w = world();
  sale(w, 'sale-clo010', 'c1');
  sale(w, 'sale-clo011', 'c1');
  assert.equal(w.call('voidSale', { sale_id: 'sale-clo011', reason: 'wrong_item', note: '', approver_id: 'sv2', approver_pin: '2468' }, undefined, 'c1').ok, true);
  const c = ok(w.call('getClosing', {}, undefined, 'c1'));
  assert.deepEqual(J([c.orders, c.total_sales, c.voided, c.void_amount]), [1, 10.9, 1, 10.9]);
  const a = ok(w.call('getClosingDetail', {}, undefined, 'admin'));
  const v = a.transactions.filter((t) => t.status === 'void')[0];
  assert.deepEqual(J([v.voided.requested_by, v.voided.approved_by]), ['c1', 'sv2']);
});

test('close: the cash is counted by notes and coins and the day closes only when it tallies', () => {
  const w = world();
  sale(w, 'sale-clo020', 'c1');
  assert.match(w.call('closeDay', { close_id: 'bad' }, undefined, 'c1').error, /Bad close id/);
  assert.match(w.call('closeDay', { close_id: 'close-c1-0001' }, undefined, 'c1').error, /Count the cash by notes and coins first/);
  assert.match(w.call('closeDay', { close_id: 'close-c1-0001', denoms: { 123: 1 } }, undefined, 'c1').error, /Unknown note or coin/);
  assert.match(w.call('closeDay', { close_id: 'close-c1-0001', denoms: { 1000: -1 } }, undefined, 'c1').error, /Bad count for RM10/);
  assert.match(w.call('closeDay', { close_id: 'close-c1-0001', denoms: { 20: 1.5 } }, undefined, 'c1').error, /Bad count for 20 sen/);
  // exact: RM10 + 50 sen + 2 x 20 sen. The total is added up by the server; a typed total is ignored
  const r = ok(w.call('closeDay', { close_id: 'close-c1-0001', denoms: cash(10.9), cash_counted: 999 }, undefined, 'c1'));
  assert.deepEqual(J([r.close.duplicate, r.close.cash_counted, r.close.cash_variance, r.close.cash_status, r.close.approved_by]), [false, 10.9, 0, 'balanced', '']);
  assert.deepEqual(J([r.closings[0].close_id, r.closings[0].cash_status]), ['close-c1-0001', 'balanced']);
  // a retry saves once
  assert.equal(ok(w.call('closeDay', { close_id: 'close-c1-0001', denoms: cash(10.9) }, undefined, 'c1')).close.duplicate, true);
  // a supervisor counts the whole drawer; an admin has no drawer and closes without counting
  assert.equal(ok(w.call('closeDay', { close_id: 'close-sv1-001', denoms: cash(10.9) }, undefined, 'sv1')).close.cash_status, 'balanced');
  const a = ok(w.call('closeDay', { close_id: 'close-adm-001' }, undefined, 'admin'));
  assert.deepEqual(J([a.close.cash_status, a.close.cash_counted]), ['', '']);
  const rows = rowsOf(w.tabs, 'Closings');
  assert.deepEqual(J(rows.map((x) => [x.closed_by, x.role, x.scope, x.cash_status])), [['c1', 'cashier', 'own', 'balanced'], ['sv1', 'supervisor', 'all', 'balanced'], ['admin', 'admin', 'all', '']]);
  assert.deepEqual(J(JSON.parse(rows[0].denoms)), { 1000: 1, 50: 1, 20: 2 });
  // a cashier sees their own closes; reading the history is for supervisor and admin
  assert.equal(ok(w.call('getClosing', {}, undefined, 'c1')).closings.length, 1);
  assert.equal(w.call('getClosings', {}, undefined, 'c1').error, 'Not allowed for a cashier');
  assert.equal(ok(w.call('getClosings', {}, undefined, 'sv1')).rows.length, 3);
});

test('close: a shortage or surplus needs a note and a supervisor\'s own ID + PIN, and is marked on the close', () => {
  const w = world();
  sale(w, 'sale-clo030', 'c1');
  const short = { close_id: 'close-c1-0002', denoms: cash(10) }; // RM 0.90 short
  assert.match(w.call('closeDay', short, undefined, 'c1').error, /short by RM 0\.90\. Add a note/);
  assert.match(w.call('closeDay', { ...short, note: 'gave wrong change' }, undefined, 'c1').error, /A supervisor must approve it/);
  // the cashier can't approve their own, and a wrong PIN is refused (and counted)
  assert.match(w.call('closeDay', { ...short, note: 'gave wrong change', approver_id: 'c1', approver_pin: '2468' }, undefined, 'c1').error, /Only a supervisor can approve/);
  assert.match(w.call('closeDay', { ...short, note: 'gave wrong change', approver_id: 'sv1', approver_pin: '0000' }, undefined, 'c1').error, /Wrong Employee ID or PIN/);
  assert.equal(rowsOf(w.tabs, 'Closings').length, 0);
  const r = ok(w.call('closeDay', { ...short, note: 'gave wrong change', approver_id: 'sv1', approver_pin: '2468' }, undefined, 'c1'));
  assert.deepEqual(J([r.close.cash_status, r.close.cash_variance, r.close.approved_by]), ['shortage', -0.9, 'sv1']);
  assert.deepEqual(J([r.closings[0].cash_status, r.closings[0].approved_by]), ['shortage', 'sv1']);
  const log = rowsOf(w.tabs, 'StaffLog').filter((x) => x.action === 'cash_shortage');
  assert.deepEqual(J(log.map((x) => [x.actor, x.detail])), [['c1', 'RM 0.90 approved by sv1: gave wrong change']]);
  // a surplus is the same, marked surplus
  const w2 = world();
  sale(w2, 'sale-clo031', 'c1');
  const over = ok(w2.call('closeDay', { close_id: 'close-c1-0003', denoms: cash(11), note: 'a customer left a tip in the drawer', approver_id: 'sv2', approver_pin: '2468' }, undefined, 'c1'));
  assert.deepEqual(J([over.close.cash_status, over.close.cash_variance, over.close.approved_by]), ['surplus', 0.1, 'sv2']);
  assert.deepEqual(J(rowsOf(w2.tabs, 'Closings').map((x) => [x.cash_status, x.approved_by])), [['surplus', 'sv2']]);
});

test('close: a supervisor can\'t approve their own cash difference; another supervisor can', () => {
  const w = world();
  sale(w, 'sale-clo040', 'sv1');
  const d = { close_id: 'close-sv1-002', denoms: cash(5), note: 'drawer was short' };
  assert.match(w.call('closeDay', { ...d, approver_id: 'sv1', approver_pin: '2468' }, undefined, 'sv1').error, /cannot approve your own cash difference/);
  const r = ok(w.call('closeDay', { ...d, approver_id: 'sv2', approver_pin: '2468' }, undefined, 'sv1'));
  assert.deepEqual(J([r.close.cash_status, r.close.cash_variance, r.close.approved_by]), ['shortage', -5.9, 'sv2']);
});

test('stock checklist: low stock is listed, an unticked item comes back every day, a ticked one is done, restocking resolves it', () => {
  const w = world();
  const m = milk(w, 3);
  ok(w.call('saveProduct', { name: 'Napkins', price: 0, kind: 'ingredient', unit: 'pcs', track_stock: false }));
  let l = ok(w.call('getClosingStock', {}, undefined, 'sv1')).list;
  assert.deepEqual(J(l.map((x) => [x.name, x.status, x.days_open])), [['Milk', 'open', 0]]);
  assert.match(l[0].reason, /only 3 l left \(reorder at 5\)/);
  // not ticked: it is still there tomorrow and the day after, with how long it has been waiting
  w.setDay(1);
  l = ok(w.call('getClosingStock', {}, undefined, 'admin')).list;
  assert.deepEqual(J(l.map((x) => [x.name, x.status, x.days_open, x.times_listed])), [['Milk', 'open', 1, 2]]);
  w.setDay(2);
  l = ok(w.call('getClosingStock', {}, undefined, 'sv1')).list;
  assert.deepEqual(J(l.map((x) => [x.status, x.days_open, x.times_listed])), [['open', 2, 3]]);
  // only a supervisor or admin can tick; the cashier can't even see the list
  assert.equal(w.call('setShopItem', { product_id: m.id, done: true }, undefined, 'c1').error, 'Not allowed for a cashier');
  l = ok(w.call('setShopItem', { product_id: m.id, done: true }, undefined, 'sv1')).list;
  assert.deepEqual(J(l.map((x) => [x.status, x.done_by])), [['done', 'sv1']]);
  // ticked: done, not nagging the next day
  w.setDay(3);
  assert.deepEqual(J(ok(w.call('getClosingStock', {}, undefined, 'sv1')).list.map((x) => x.status)), ['done']);
  // unticking puts it back
  assert.equal(ok(w.call('setShopItem', { product_id: m.id, done: false }, undefined, 'admin')).list[0].status, 'open');
  assert.equal(ok(w.call('setShopItem', { product_id: m.id, done: true }, undefined, 'admin')).list[0].status, 'done');
  // ticked but still short 2 days later: it comes back as open
  w.setDay(5);
  l = ok(w.call('getClosingStock', {}, undefined, 'sv1')).list;
  assert.deepEqual(J(l.map((x) => x.status)), ['open']);
  assert.match(l[0].reason, /still a problem after it was ticked/);
  // delivery arrives: stock is back above the level, the item resolves by itself
  ok(w.call('stockAdjust', { movement_id: 'move-milk-001', product_id: m.id, change_qty: 10, reason_type: 'stock_in', note: 'delivery' }, undefined, 'sv1'));
  w.setDay(6);
  assert.deepEqual(J(ok(w.call('getClosingStock', {}, undefined, 'sv1')).list), []);
  const rows = rowsOf(w.tabs, 'ShopList');
  assert.deepEqual(J(rows.map((x) => [x.name, x.status])), [['Milk', 'resolved']]);
});

test('stock checklist: unknown item, negative stock, an expiring batch and an opened pack are all reasons', () => {
  const w = world();
  const m = milk(w, 3);
  assert.match(w.call('setShopItem', { product_id: 'nope', done: true }, undefined, 'sv1').error, /not on the checklist/);
  ok(w.call('stockAdjust', { movement_id: 'move-milk-002', product_id: m.id, change_qty: -5, reason_type: 'adjustment', note: 'spilled' }, undefined, 'sv1'));
  const l = ok(w.call('getClosingStock', {}, undefined, 'sv1')).list;
  assert.match(l[0].reason, /negative/);
});

test('opening cash: counted by notes and coins, expected cash = opening + cash sales, a change needs a note, admin has no drawer', () => {
  const w = world();
  assert.equal(w.call('setOpening', { open_id: 'open-adm-001', denoms: cash(100) }, undefined, 'admin').error, 'Not allowed for a admin');
  assert.match(w.call('setOpening', { open_id: 'bad', denoms: cash(100) }, undefined, 'c1').error, /Bad opening id/);
  assert.match(w.call('setOpening', { open_id: 'open-c1-0001' }, undefined, 'c1').error, /Count the opening cash by notes and coins/);
  assert.match(w.call('setOpening', { open_id: 'open-c1-0001', denoms: { 77: 1 } }, undefined, 'c1').error, /Unknown note or coin/);
  assert.match(w.call('setOpening', { open_id: 'open-c1-0001', denoms: { 1000: 1.5 } }, undefined, 'c1').error, /Bad count/);
  assert.equal(ok(w.call('getClosing', {}, undefined, 'c1')).mine, null);
  const r = ok(w.call('setOpening', { open_id: 'open-c1-0001', denoms: { 10000: 1, 5000: 1, 1000: 5 }, amount: 9999 }, undefined, 'c1'));
  assert.deepEqual(J([r.opening, r.cash_expected, r.mine.amount]), [200, 200, 200]);
  assert.deepEqual(J(JSON.parse(rowsOf(w.tabs, 'Openings')[0].denoms)), { 10000: 1, 5000: 1, 1000: 5 });
  ok(w.call('setOpening', { open_id: 'open-c1-0001', denoms: cash(200) }, undefined, 'c1')); // a retry saves once
  assert.equal(rowsOf(w.tabs, 'Openings').length, 1);
  sale(w, 'sale-opn001', 'c1', 'cash');
  sale(w, 'sale-opn002', 'c1', 'card');
  let c = ok(w.call('getClosing', {}, undefined, 'c1'));
  assert.deepEqual(J([c.opening, c.cash_sales, c.cash_expected]), [200, 10.9, 210.9]);
  assert.match(w.call('setOpening', { open_id: 'open-c1-0002', denoms: cash(250) }, undefined, 'c1').error, /Add a note/);
  c = ok(w.call('setOpening', { open_id: 'open-c1-0002', denoms: cash(250), note: 'owner added 50 for change' }, undefined, 'c1'));
  assert.deepEqual(J([c.opening, c.cash_expected]), [250, 260.9]);
  assert.equal(rowsOf(w.tabs, 'Openings').length, 2);
  ok(w.call('setOpening', { open_id: 'open-sv1-001', denoms: cash(100) }, undefined, 'sv1'));
  const s = ok(w.call('getClosing', {}, undefined, 'sv1'));
  assert.deepEqual(J([s.opening, s.cash_expected, s.openings.map((o) => [o.opened_by, o.amount])]), [350, 360.9, [['c1', 250], ['sv1', 100]]]);
  assert.equal(ok(w.call('getClosing', {}, undefined, 'c1')).opening, 250);
  assert.equal(ok(w.call('getClosing', {}, undefined, 'admin')).opening, 350);
  // closing: the day only closes when the count equals opening + cash sales
  assert.match(w.call('closeDay', { close_id: 'close-op-0001', denoms: cash(250) }, undefined, 'c1').error, /short by RM 10\.90/);
  const k = ok(w.call('closeDay', { close_id: 'close-op-0001', denoms: cash(260.9) }, undefined, 'c1'));
  assert.deepEqual(J([k.close.cash_status, rowsOf(w.tabs, 'Closings')[0].opening, rowsOf(w.tabs, 'Closings')[0].cash_expected]), ['balanced', 250, 260.9]);
});

test('opening cash: only for today, and another day starts with none', () => {
  const w = world();
  ok(w.call('setOpening', { open_id: 'open-day-0001', denoms: cash(150) }, undefined, 'c1'));
  w.setDay(1);
  const c = ok(w.call('getClosing', {}, undefined, 'c1'));
  assert.deepEqual(J([c.opening, c.mine, c.cash_expected]), [0, null, 0]);
  assert.deepEqual(J(c.denoms), [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5]);
  assert.equal(ok(w.call('setOpening', { open_id: 'open-day-0002', denoms: cash(120) }, undefined, 'c1')).opening, 120);
  assert.equal(ok(w.call('getClosing', { date: day(0) }, undefined, 'c1')).opening, 150);
});
