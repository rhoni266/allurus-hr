// Unit tests for the operations rules: stock in and out, purchase orders, recipe usage, oldest-expiry-first picking,
// preventive maintenance due dates and aging of client invoices.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ops-rules.js'), 'utf8'), sandbox);
const O = sandbox.window.AllurusOpsRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

test('stock in and out: opening plus moves, as of a date, and the reorder flag', () => {
  const items = [{ id: 'chilli', opening: 100, reorder: 80 }, { id: 'jar', opening: 500, reorder: 200 }];
  const moves = [
    { itemId: 'chilli', date: '2026-10-01', qty: 50 }, { itemId: 'chilli', date: '2026-10-05', qty: -72.5 },
    { itemId: 'jar', date: '2026-10-05', qty: -320 },
  ];
  assert.equal(O.onHand(items[0], moves), 77.5);
  assert.equal(O.onHand(items[0], moves, '2026-10-02'), 150);
  const pos = [{ status: 'Sent', lines: [{ itemId: 'jar', qty: 1000, received: 0 }] }, { status: 'Billed', lines: [{ itemId: 'jar', qty: 999, received: 999 }] }];
  const lv = O.stockLevels(items, moves, pos);
  deq(lv.map((x) => [x.id, x.onHand, x.low, x.onOrder]), [['chilli', 77.5, true, 0], ['jar', 180, true, 1000]]);
  assert.equal(O.suggestQty(lv[0]), 83, 'back up to twice the reorder level: 160 − 77.5, rounded up');
  assert.equal(O.suggestQty(lv[1]), 0, 'enough already on order');
});

test('purchase order: partial then full receipt adds stock once', () => {
  let n = 0;
  const ids = () => `m${++n}`;
  const po = { no: 'PO-1', status: 'Sent', lines: [{ itemId: 'chilli', qty: 100, price: 12 }, { itemId: 'garlic', qty: 40, price: 6 }] };
  assert.equal(O.poTotal(po), 1440);
  const a = O.receive(po, { chilli: 60 }, { date: '2026-10-10', ids });
  assert.equal(a.po.status, 'Partial');
  deq(a.moves, [{ id: 'm1', itemId: 'chilli', date: '2026-10-10', qty: 60, ref: 'PO-1', note: 'Received' }]);
  const b = O.receive(a.po, { chilli: 999, garlic: 40 }, { date: '2026-10-12', ids });
  assert.equal(b.po.status, 'Received');
  deq(b.moves.map((m) => [m.itemId, m.qty]), [['chilli', 40], ['garlic', 40]], 'over-receipt is capped at what is still due');
  assert.equal(O.poReceivedValue(b.po), 1440);
  assert.throws(() => O.receive(b.po, { chilli: 1 }, { date: '2026-10-13', ids }), /received PO cannot be received/);
  assert.throws(() => O.receive({ ...po, status: 'Draft' }, {}, { date: '2026-10-13', ids }), /draft/);
});

test('recipe usage scales the batch recipe to what was cooked, and shortfalls are reported', () => {
  const product = { batchSize: 400, bom: [{ itemId: 'chilli', qty: 60 }, { itemId: 'oil', qty: 35 }, { itemId: 'jar', qty: 400 }] };
  deq(O.recipeUsage(product, 400), [{ itemId: 'chilli', qty: 60 }, { itemId: 'oil', qty: 35 }, { itemId: 'jar', qty: 400 }]);
  deq(O.recipeUsage(product, 380), [{ itemId: 'chilli', qty: 57 }, { itemId: 'oil', qty: 33.25 }, { itemId: 'jar', qty: 380 }]);
  const levels = [{ id: 'chilli', onHand: 50 }, { id: 'oil', onHand: 100 }, { id: 'jar', onHand: 1000 }];
  deq(O.shortfalls(product, 400, levels).map((x) => [x.itemId, x.qty, x.have]), [['chilli', 60, 50]]);
  assert.equal(O.yieldPct({ planned: 400, actual: 388 }), 97);
});

test('finished goods: QC hold and expired batches are not available, and picking takes the oldest expiry first', () => {
  const batches = [
    { id: 'b1', no: 'B-001', productId: 'p1', actual: 100, qc: 'Pass', expiry: '2027-03-01' },
    { id: 'b2', no: 'B-002', productId: 'p1', actual: 100, qc: 'Pass', expiry: '2027-02-01' },
    { id: 'b3', no: 'B-003', productId: 'p1', actual: 100, qc: 'Hold', expiry: '2027-01-15' },
    { id: 'b4', no: 'B-004', productId: 'p1', actual: 50, qc: 'Pass', expiry: '2026-10-01' },
    { id: 'b5', no: 'B-005', productId: 'p2', actual: 100, qc: 'Pass', expiry: '2027-01-01' },
  ];
  const dos = [{ status: 'Delivered', picks: [{ batchId: 'b2', qty: 30 }] }, { status: 'Cancelled', picks: [{ batchId: 'b1', qty: 100 }] }];
  const l = O.lots(batches, dos, 'p1', '2026-10-19');
  deq(l.map((x) => [x.no, x.left, x.available, x.hold, x.expired]), [['B-004', 50, 0, false, true], ['B-003', 100, 0, true, false], ['B-002', 70, 70, false, false], ['B-001', 100, 100, false, false]]);
  const p = O.pickFEFO(l, 120);
  deq(p.picks.map((x) => [x.no, x.qty]), [['B-002', 70], ['B-001', 50]]);
  assert.equal(p.short, 0);
  assert.equal(O.pickFEFO(l, 500).short, 330);
  assert.equal(O.daysCover(170, 300, 30), 17);
  assert.equal(O.daysCover(170, 0, 30), null);
});

test('preventive maintenance: by days or running hours, whichever is first', () => {
  const T = '2026-10-19';
  deq(O.pmStatus({ pmDays: 30, lastPm: '2026-10-01' }, T), { nextDate: '2026-10-31', daysLeft: 12, hoursLeft: null, status: 'OK' });
  assert.equal(O.pmStatus({ pmDays: 30, lastPm: '2026-09-22' }, T).status, 'Due');
  assert.equal(O.pmStatus({ pmDays: 30, lastPm: '2026-09-10' }, T).status, 'Overdue');
  // By hours: 500-hour service, last at 1,200 hours.
  assert.equal(O.pmStatus({ pmHours: 500, lastPmHours: 1200, hours: 1500 }, T).status, 'OK');
  assert.equal(O.pmStatus({ pmHours: 500, lastPmHours: 1200, hours: 1660 }, T).status, 'Due');
  assert.equal(O.pmStatus({ pmHours: 500, lastPmHours: 1200, hours: 1710, pmDays: 90, lastPm: '2026-10-01' }, T).status, 'Overdue', 'hours run out before the date');
  const br = [{ reportedAt: '2026-10-02T08:00:00Z', fixedAt: '2026-10-02T12:30:00Z', downtime: 4.5 }, { reportedAt: '2026-10-19T08:00:00Z', fixedAt: '' }, { reportedAt: '2026-09-29T08:00:00Z', downtime: 9, fixedAt: 'x' }];
  assert.equal(O.downtime(br, '2026-10', '2026-10-19T10:30:00Z'), 7);
});

test('aging of client invoices, top debtors and bills due', () => {
  const T = '2026-10-19';
  const inv = [
    { client: 'A', due: '2026-10-25', balance: 100 }, { client: 'A', due: '2026-10-10', balance: 180 },
    { client: 'B', due: '2026-09-01', balance: 300 }, { client: 'C', due: '2026-07-01', balance: 400 }, { client: 'D', due: '2026-10-19', balance: 50 },
  ];
  deq(O.aging(inv, T), { current: 150, d30: 180, d60: 300, d60p: 400, total: 1030, overdue: 880 });
  deq(O.topDebtors(inv, 2), [{ client: 'C', owed: 400 }, { client: 'B', owed: 300 }]);
  const bills = [{ due: '2026-10-18', status: 'Unpaid' }, { due: '2026-10-20', status: 'Unpaid' }, { due: '2026-10-26', status: 'Unpaid' }, { due: '2026-10-27', status: 'Unpaid' }, { due: '2026-10-01', status: 'Paid' }];
  const d = O.billsDue(bills, T);
  assert.equal(d.overdue.length, 1);
  assert.equal(d.week.length, 2);
});
