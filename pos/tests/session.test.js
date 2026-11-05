// The day's session: log in, open (count the register), sell, close (cash must tally). Until a cashier or supervisor has opened they
// can use nothing else; after a cashier closes that cashier can't check out, after a supervisor closes the day nobody can; waste still
// works. (apps-script/Code.gs, against the fake Sheet from code.test.js.) Run: node --test pos/tests/*.test.js
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
const day = (n) => new Date(Date.UTC(2026, 9, 31 + n)).toISOString().slice(0, 10);
const cash = (rm) => { let sen = Math.round(rm * 100); const out = {}; for (const v of [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5]) { const n = Math.floor(sen / v); if (n) { out[v] = n; sen -= n * v; } } return out; };

function world() {
  const w = load(); // the helper signs people in and reads the menu with the gate off ...
  w.ctx.requireOpening_ = () => true; // ... then the gate is switched on for the test
  w.setDay = (n) => { w.ctx.today_ = () => day(n); w.ctx.addDays_ = (k) => day(n + k); };
  w.setDay(0);
  return w;
}
const sale = (w, id, as) => w.call('createSale', { sale_id: id, payment_method: 'cash', items: [{ product_id: w.prods.Latte.id, qty: 1 }] }, undefined, as);
const open = (w, as, rm, id) => ok(w.call('setOpening', { open_id: id || 'open-' + as + '-0001', denoms: cash(rm) }, undefined, as));
const waste = (w, as, id) => w.call('logWaste', { waste_id: id, items: [{ product_id: w.prods.Latte.id, qty: 1, reason: 'dropped' }] }, undefined, as);

test('step 1-2: until they open, a cashier or supervisor can use nothing but the opening screen; admin is not held up', () => {
  const w = world();
  for (const as of ['c1', 'sv1']) {
    for (const a of ['getProducts', 'createSale', 'logWaste', 'getSale']) assert.match(w.call(a, {}, undefined, as).error, /^OPENING_REQUIRED/, as + ' ' + a);
  }
  for (const a of ['getDailySummary', 'getStockReport', 'getWaste']) assert.match(w.call(a, {}, undefined, 'sv1').error, /^OPENING_REQUIRED/, a);
  // what they can do: see who they are (and that they must open), see the opening screen, and open
  const me = ok(w.call('whoami', {}, undefined, 'c1'));
  assert.deepEqual(J([me.state.required, me.state.opened, me.state.closed, me.state.day_closed]), [true, false, false, false]);
  assert.equal(ok(w.call('getClosing', {}, undefined, 'c1')).state.opened, false);
  // the admin has no drawer and is not held up
  assert.equal(w.call('getProducts', {}, undefined, 'admin').ok, true);
  assert.equal(w.call('getDailySummary', {}, undefined, 'admin').ok, true);
  // opening unlocks everything for that person only
  open(w, 'c1', 200);
  assert.equal(ok(w.call('whoami', {}, undefined, 'c1')).state.opened, true);
  assert.equal(w.call('getProducts', {}, undefined, 'c1').ok, true);
  assert.equal(sale(w, 'sale-ses001', 'c1').ok, true);
  assert.equal(waste(w, 'c1', 'waste-ses001').ok, true);
  assert.match(w.call('getProducts', {}, undefined, 'sv1').error, /^OPENING_REQUIRED/);
});

test('step 4: after a cashier closes, that cashier can\'t check out or void; waste still works; others carry on', () => {
  const w = world();
  open(w, 'c1', 100);
  open(w, 'sv1', 50);
  sale(w, 'sale-ses010', 'c1');
  sale(w, 'sale-ses011', 'c1');
  // the day does not close until the cash tallies
  assert.match(w.call('closeDay', { close_id: 'close-c1-ses1', denoms: cash(100) }, undefined, 'c1').error, /short by RM 21\.80/);
  assert.equal(sale(w, 'sale-ses012', 'c1').ok, true); // still open: a failed close changes nothing
  const r = ok(w.call('closeDay', { close_id: 'close-c1-ses2', denoms: cash(132.7) }, undefined, 'c1')); // 100 + 3 x 10.90
  assert.equal(r.close.cash_status, 'balanced');
  assert.deepEqual(J([r.state.opened, r.state.closed, r.state.day_closed]), [true, true, false]);
  assert.match(sale(w, 'sale-ses013', 'c1').error, /closed your session\. Checkout and voids are off for you until tomorrow/);
  assert.match(w.call('voidSale', { sale_id: 'sale-ses010', reason: 'wrong_item', approver_id: 'sv1', approver_pin: '2468' }, undefined, 'c1').error, /closed your session/);
  assert.equal(waste(w, 'c1', 'waste-ses010').ok, true);
  assert.equal(w.call('getClosing', {}, undefined, 'c1').ok, true);
  assert.match(w.call('setOpening', { open_id: 'open-c1-late', denoms: cash(10), note: 'again' }, undefined, 'c1').error, /already closed today/);
  assert.match(w.call('closeDay', { close_id: 'close-c1-ses3', denoms: cash(132.7) }, undefined, 'c1').error, /already closed today/);
  // the supervisor has not closed: they can still sell
  assert.equal(sale(w, 'sale-ses014', 'sv1').ok, true);
});

test('the supervisor closes the day: every cashier closes first, approved differences carry over, then nobody can check out', () => {
  const w = world();
  open(w, 'c1', 100);
  open(w, 'sv1', 50);
  sale(w, 'sale-ses020', 'c1');
  sale(w, 'sale-ses021', 'sv1');
  // the cashier has not closed their drawer: the supervisor can't close the day
  assert.match(w.call('closeDay', { close_id: 'close-sv1-d1', denoms: cash(171.8) }, undefined, 'sv1').error, /These cashiers have not closed yet: Cindy Tan \(c1\)/);
  assert.deepEqual(J(ok(w.call('getClosing', {}, undefined, 'sv1')).waiting.map((x) => x.emp_id)), ['c1']);
  // the cashier closes RM 0.90 short, approved by a supervisor
  const c = ok(w.call('closeDay', { close_id: 'close-c1-d1', denoms: cash(110), note: 'wrong change given', approver_id: 'sv1', approver_pin: '2468' }, undefined, 'c1'));
  assert.deepEqual(J([c.close.cash_status, c.close.cash_variance]), ['shortage', -0.9]);
  // the day: openings 150 + cash sales 21.80 - the approved 0.90 = 170.90
  const t = ok(w.call('getClosing', {}, undefined, 'sv1'));
  assert.deepEqual(J([t.opening, t.cash_sales, t.approved_diff, t.cash_expected, t.waiting]), [150, 21.8, -0.9, 170.9, []]);
  assert.match(w.call('closeDay', { close_id: 'close-sv1-d2', denoms: cash(171.8) }, undefined, 'sv1').error, /over by RM 0\.90/);
  const d = ok(w.call('closeDay', { close_id: 'close-sv1-d3', denoms: cash(170.9) }, undefined, 'sv1'));
  assert.deepEqual(J([d.close.cash_status, d.state.day_closed]), ['balanced', true]);
  // closed for everyone: no checkout, no void, no new opening; waste and reading still work
  for (const as of ['c1', 'sv1']) assert.match(sale(w, 'sale-ses03' + as, as).error, /The day is closed\. Checkout and voids are off until tomorrow/);
  assert.match(w.call('voidSale', { sale_id: 'sale-ses020', reason: 'wrong_item', approver_id: 'sv1', approver_pin: '2468' }, undefined, 'sv1').error, /The day is closed/);
  assert.match(w.call('setOpening', { open_id: 'open-sv2-0001', denoms: cash(10) }, undefined, 'sv2').error, /day is already closed/);
  assert.match(w.call('closeDay', { close_id: 'close-sv2-d1', denoms: cash(0) }, undefined, 'sv2').error, /^OPENING_REQUIRED|day is already closed/);
  assert.equal(waste(w, 'c1', 'waste-ses020').ok, true);
  assert.equal(waste(w, 'sv1', 'waste-ses021').ok, true);
  assert.equal(w.call('getDailySummary', {}, undefined, 'sv1').ok, true);
  assert.equal(ok(w.call('whoami', {}, undefined, 'admin')).state.day_closed, true);
  // the records
  assert.deepEqual(J(rowsOf(w.tabs, 'Closings').map((x) => [x.closed_by, x.role, x.cash_status, x.approved_by])), [['c1', 'cashier', 'shortage', 'sv1'], ['sv1', 'supervisor', 'balanced', '']]);
});

test('the admin\'s close only records the day; it does not close it. Tomorrow everyone must open again', () => {
  const w = world();
  open(w, 'c1', 100);
  assert.equal(ok(w.call('closeDay', { close_id: 'close-adm-s01' }, undefined, 'admin')).state.day_closed, false);
  assert.equal(sale(w, 'sale-ses040', 'c1').ok, true);
  // a supervisor closes the day (the cashier first)
  open(w, 'sv1', 0);
  ok(w.call('closeDay', { close_id: 'close-c1-s01', denoms: cash(110.9) }, undefined, 'c1'));
  ok(w.call('closeDay', { close_id: 'close-sv1-s01', denoms: cash(110.9) }, undefined, 'sv1'));
  assert.match(sale(w, 'sale-ses041', 'c1').error, /closed/);
  w.setDay(1);
  assert.match(sale(w, 'sale-ses042', 'c1').error, /^OPENING_REQUIRED/);
  assert.match(w.call('getProducts', {}, undefined, 'sv1').error, /^OPENING_REQUIRED/);
  const me = ok(w.call('whoami', {}, undefined, 'c1'));
  assert.deepEqual(J([me.state.opened, me.state.closed, me.state.day_closed]), [false, false, false]);
  open(w, 'c1', 100, 'open-c1-0002');
  assert.equal(sale(w, 'sale-ses043', 'c1').ok, true);
});
