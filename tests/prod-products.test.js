// Production with several products: the list, switching off, the pool, migrating the old single total, the dashboard reminder.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/prod-rules.js');

const item = (pid, name, unit, rate, units) => ({ pid, name, unit, rate, units });

test('migrating the old single total: one product "Production" at the current rate and unit', () => {
  const list = P.productsOf({ rate: '0.05', unit: 'pcs', depts: ['d1'] });
  assert.deepEqual(list, [{ id: 'p-prod', name: 'Production', unit: 'pcs', rate: '0.05', on: true }]);
  // an old saved day (units, unit, rate, no items) reads as one "Production" line, so history is unchanged
  const old = { units: '2000', unit: 'pcs', rate: '0.05', poolSen: 10000, shareSen: 400, count: 25, attendees: ['a'] };
  assert.deepEqual(P.dayItems(old), [{ pid: 'p-prod', name: 'Production', unit: 'pcs', rate: '0.05', units: '2000', poolSen: 10000 }]);
  assert.equal(P.commissionItems({ items: [item('p-prod', 'Production', 'pcs', '0.05', '2000')], attendees: 25 }).shareSen, 400, 'same money as before');
  assert.deepEqual(P.productsOf({ products: [], depts: [] }), [], 'an explicit empty list stays empty');
});

test('adding a product: the list grows in the order set and each keeps its own rate', () => {
  const cfg = { products: P.productsOf({ rate: '0.05', unit: 'pcs' }) };
  cfg.products = [...cfg.products, { id: 'pp-2', name: 'Sambal', unit: 'kg', rate: '0.4', on: true }];
  assert.deepEqual(P.productsOf(cfg).map((p) => p.name), ['Production', 'Sambal']);
  [cfg.products[0], cfg.products[1]] = [cfg.products[1], cfg.products[0]];
  assert.deepEqual(P.productsOf(cfg).map((p) => p.name), ['Sambal', 'Production'], 'reordered');
});

test('the pool: each product qty × rate, added up, shared equally', () => {
  const r = P.commissionItems({ items: [item('a', 'Cili boh', 'jar', '0.05', '2000'), item('b', 'Sambal', 'kg', '0.4', '12.5'), item('c', 'Sos', 'box', '1.2', '')], attendees: 25 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines.map((l) => [l.pid, l.poolSen]), [['a', 10000], ['b', 500]], 'a blank product is not a line');
  assert.equal(r.poolSen, 10500);
  assert.equal(r.shareSen, 420); assert.equal(r.remainderSen, 0);
  const odd = P.commissionItems({ items: [item('a', 'A', 'u', '0.05', '1000'), item('b', 'B', 'u', '0.0025', '12345')], attendees: 3 });
  assert.equal(odd.poolSen, 5000 + 3086);
  assert.equal(odd.shareSen * 3 + odd.remainderSen, odd.poolSen, 'nothing created or lost');
  assert.equal(P.commissionItems({ items: [item('a', 'A', 'u', 'x', '5')], attendees: 3 }).ok, false, 'a bad rate is refused');
  assert.equal(P.commissionItems({ items: [item('a', 'A', 'u', '1', '5')], attendees: 0 }).noAttendees, true);
});

test('planDay with items shares the pool among those who checked in', () => {
  const emps = [{ id: 'e1', start: '2026-01-01', dept: 'd' }, { id: 'e2', start: '2026-01-01', dept: 'd' }, { id: 'e3', start: '2026-01-01', dept: 'd' }];
  const att = { e1: { s: 'present', in: '08:00' }, e2: { s: 'present', in: '08:10' } };
  const p = P.planDay({ date: '2026-11-12', items: [item('a', 'A', 'u', '1', '10'), item('b', 'B', 'u', '2', '5')], employees: emps, att, settings: { depts: ['d'] } });
  assert.equal(p.count, 2); assert.equal(p.poolSen, 2000); assert.equal(p.shareSen, 1000);
});

test('a switched-off product is hidden from the form but kept in history; a used product cannot be deleted', () => {
  const products = [{ id: 'a', name: 'A', unit: 'u', rate: '1', on: true }, { id: 'b', name: 'B', unit: 'kg', rate: '2', on: false }];
  const active = products.filter((p) => p.on !== false);
  assert.deepEqual(active.map((p) => p.id), ['a'], 'off is not on the form');
  const days = { '2026-11-10': { items: [{ pid: 'b', name: 'B', unit: 'kg', rate: '2', units: '5', poolSen: 1000 }], shareSen: 500, count: 2, attendees: ['x', 'y'] } };
  assert.equal(P.productUsed('b', days), true, 'used: may only be switched off');
  assert.equal(P.productUsed('a', days), false, 'unused: may be deleted');
  assert.equal(P.dayItems(days['2026-11-10'])[0].name, 'B', 'the saved day still shows B with its own rate');
  assert.deepEqual(P.monthByProduct(days, '2026-11', 'x'), { b: { name: 'B', unit: 'kg', sen: 500 } }, 'the payslip breakdown keeps it');
});

test('payslip breakdown by product for one person', () => {
  const days = { '2026-11-10': { items: [{ pid: 'a', name: 'A', unit: 'u', poolSen: 1000 }, { pid: 'b', name: 'B', unit: 'u', poolSen: 500 }], shareSen: 750, count: 2, attendees: ['x', 'y'] },
    '2026-11-11': { items: [{ pid: 'a', name: 'A', unit: 'u', poolSen: 400 }], shareSen: 200, count: 2, attendees: ['x', 'y'] } };
  assert.deepEqual(P.monthByProduct(days, '2026-11', 'x'), { a: { name: 'A', unit: 'u', sen: 700 }, b: { name: 'B', unit: 'u', sen: 250 } });
  assert.deepEqual(P.monthByProduct(days, '2026-11', 'zzz'), {}, 'someone who did not share has none');
  assert.equal(P.monthTotals(days, '2026-11').x.sen, 950, 'the month total is the sum of the shares (unchanged rule)');
});

test('dashboard reminder: active products not yet filled for today and yesterday; hidden when all are filled', () => {
  const products = [{ id: 'a', name: 'A', on: true }, { id: 'b', name: 'B', on: true }, { id: 'c', name: 'C', on: false }];
  const today = '2026-11-13', y = '2026-11-12';
  let r = P.toFill({ products, days: {}, today });
  assert.deepEqual(r.map((x) => [x.date, x.products.map((p) => p.id)]), [[today, ['a', 'b']], [y, ['a', 'b']]], 'today first; the switched-off one is never asked for');
  r = P.toFill({ products, days: { [today]: { items: [{ pid: 'a' }] } }, today, hadWork: (d) => d === today });
  assert.deepEqual(r.map((x) => [x.date, x.products.map((p) => p.id)]), [[today, ['b']]], 'only B left today; yesterday had no work');
  const full = { [today]: { items: [{ pid: 'a' }, { pid: 'b' }] }, [y]: { items: [{ pid: 'a' }, { pid: 'b' }] } };
  assert.deepEqual(P.toFill({ products, days: full, today }), [], 'all filled: the card is hidden');
  assert.equal(P.toFill({ products, days: { [today]: { units: '5', unit: 'pcs', rate: '1' } }, today, hadWork: () => false }).length, 1, 'an old single-total day counts only as "Production"');
});
