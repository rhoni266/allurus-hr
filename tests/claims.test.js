// Unit tests for the claims rules: mileage, limits per claim / month / year and medical limits, validation,
// HR edits with a logged reason, the payroll split by tax treatment, GL rows, reports and the medical migration.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'claims-rules.js'), 'utf8'), sandbox);
const C = sandbox.window.AllurusClaimRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

const cats = C.defaultCategories();
const MED = [{ id: 'outpatient', name: 'Outpatient', perClaim: 80, annual: 1000 }, { id: 'dental', name: 'Dental', perClaim: 0, annual: 400 }];
const line = (id, cat, amount, date = '2026-10-10', extra = {}) => ({ id, cat, date, merchant: 'X', amount, approved: null, img: 'data:', fields: {}, ...extra });
const claim = (id, lines, status = 'Pending', empId = 'e1') => ({ id, empId, status, lines });

test('mileage: distance × rate per vehicle', () => {
  const r = C.defaultMileage();
  assert.equal(r.car, 0.6);
  assert.equal(r.motorcycle, 0.3);
  assert.equal(C.mileageAmount(145, 'car', r), 87);
  assert.equal(C.mileageAmount(40, 'motorcycle', r), 12);
  assert.equal(C.mileageAmount(-5, 'car', r), 0);
  assert.equal(C.mileageAmount(100, 'car', { car: 0.7 }), 70);
});

test('default categories include every requested template', () => {
  deq(cats.map((c) => c.id), ['travel', 'mileage', 'meals', 'parking', 'accommodation', 'phone', 'training', 'entertainment', 'medical', 'other']);
  cats.forEach((c) => { assert.ok(c.gl, c.id); assert.equal(typeof c.taxable, 'boolean'); });
});

test('per-claim limit is shared by lines of the same category', () => {
  // Meals: RM60 per claim.
  const c = claim('c1', [line('a', 'meals', 40), line('b', 'meals', 35), line('t', 'travel', 100)]);
  const l = C.limitsFor(c, { cats, claims: [c] });
  deq(l.lines.map((x) => x.max), [40, 20, 100]);
  assert.ok(l.lines[1].capped[0].includes('per-claim'));
  assert.equal(l.max, 160);
});

test('monthly limit counts approved claims from the same month only', () => {
  // Phone: RM100 a month.
  const old = claim('old', [{ ...line('o', 'phone', 70, '2026-10-02'), approved: 70 }], 'Paid');
  const lastMonth = claim('lm', [{ ...line('p', 'phone', 90, '2026-09-30'), approved: 90 }], 'Paid');
  const pending = claim('pd', [line('q', 'phone', 50, '2026-10-05')], 'Pending');
  const c = claim('c2', [line('n', 'phone', 60, '2026-10-20')]);
  const l = C.limitsFor(c, { cats, claims: [old, lastMonth, pending, c] });
  assert.equal(l.lines[0].max, 30);
  const rem = C.remaining({ empId: 'e1', cats, claims: [old, lastMonth, pending], date: '2026-10-20' }).find((x) => x.cat === 'phone');
  assert.equal(rem.monthLeft, 30);
  assert.equal(rem.pending, 50);
});

test('yearly limit and medical policy limits', () => {
  // Training: RM2,000 a year.
  const done = claim('d', [{ ...line('x', 'training', 1800, '2026-03-01'), approved: 1800 }], 'Approved');
  const c = claim('c3', [line('y', 'training', 600, '2026-10-01')]);
  assert.equal(C.limitsFor(c, { cats, claims: [done, c] }).lines[0].max, 200);
  // Outpatient: RM80 per claim, RM1,000 a year.
  const med = claim('m', [line('m1', 'medical', 120, '2026-10-01', { sub: 'outpatient' }), line('m2', 'medical', 50, '2026-10-02', { sub: 'dental' })]);
  const lm = C.limitsFor(med, { cats, claims: [med], medicalTypes: MED });
  deq(lm.lines.map((x) => x.max), [80, 50]);
  const usedDental = claim('ud', [{ ...line('u', 'medical', 380, '2026-01-01', { sub: 'dental' }), approved: 380 }], 'Paid');
  assert.equal(C.limitsFor(med, { cats, claims: [usedDental, med], medicalTypes: MED }).lines[1].max, 20);
});

test('a category with no limits allows the full amount', () => {
  const c = claim('c4', [line('a', 'travel', 2000, '2026-10-01')]);
  // Travel has a RM1,500 monthly limit by default; with no limits set it's uncapped.
  assert.equal(C.limitsFor(c, { cats, claims: [c] }).lines[0].max, 1500);
  const open = cats.map((x) => (x.id === 'travel' ? { ...x, perMonth: 0 } : x));
  assert.equal(C.limitsFor(c, { cats: open, claims: [c] }).lines[0].max, 2000);
});

test('validation: receipts, mileage distance and medical type', () => {
  const errs = C.validate({ lines: [line('a', 'meals', 20, '2026-10-01', { img: null }), line('b', 'mileage', 30, '2026-10-01', { img: null }), line('c', 'medical', 30, '2026-10-01')] }, cats);
  assert.equal(errs.length, 3);
  assert.match(errs[0], /receipt/);
  assert.match(errs[1], /distance/);
  assert.match(errs[2], /medical claim type/);
  assert.equal(C.validate({ lines: [line('b', 'mileage', 30, '2026-10-01', { img: null, fields: { km: 50 } })] }, cats).length, 0);
  assert.equal(C.validate({ lines: [] }, cats).length, 1);
});

test('HR edits need a reason and are logged with the old and new value', () => {
  const c = claim('c5', [line('a', 'meals', 45, '2026-10-01', { receiptNo: 'R-1' })]);
  assert.throws(() => C.applyEdit(c, { lineId: 'a', field: 'amount', value: 40, reason: ' ' }), /reason/);
  assert.throws(() => C.applyEdit(c, { lineId: 'a', field: 'cat', value: 'x', reason: 'y' }), /cannot be edited/);
  const r = C.applyEdit(c, { lineId: 'a', field: 'amount', value: '40.5', reason: 'Tip not claimable', by: 'e1', byName: 'Amara', at: '2026-10-19T10:00:00Z' });
  assert.equal(r.changed, true);
  assert.equal(r.claim.lines[0].amount, 40.5);
  deq(r.claim.edits[0], { lineId: 'a', field: 'amount', from: 45, to: 40.5, reason: 'Tip not claimable', by: 'e1', byName: 'Amara', at: '2026-10-19T10:00:00Z' });
  assert.equal(c.lines[0].amount, 45, 'the original is not changed');
  const r2 = C.applyEdit(r.claim, { lineId: 'a', field: 'receiptNo', value: 'R-2', reason: 'Typo', by: 'e1' });
  assert.equal(r2.claim.edits.length, 2);
  assert.equal(C.applyEdit(r2.claim, { lineId: 'a', field: 'receiptNo', value: 'R-2', reason: 'Same' }).changed, false);
});

test('payroll split: taxable claims into gross, the rest reimbursed, totals by GL', () => {
  const myCats = [...cats, { id: 'wellness', name: 'Wellness', taxable: true, gl: 'Staff benefits' }];
  const a = claim('a', [{ ...line('1', 'mileage', 87), approved: 87 }, { ...line('2', 'parking', 12.4), approved: 12.4 }, { ...line('3', 'entertainment', 86.5), approved: 80 }], 'Approved');
  const b = claim('b', [{ ...line('4', 'wellness', 150), approved: 150 }, { ...line('5', 'medical', 60), approved: 60 }], 'Approved');
  const s = C.payrollSplit([a, b], myCats);
  deq(s.ids, ['a', 'b']);
  assert.equal(s.taxable, 150);
  assert.equal(s.nonTaxable, 239.4);
  deq(s.byGL, { Travel: 99.4, Entertainment: 80, 'Staff benefits': 210 });
  deq(s.taxableCats, ['Wellness']);
  assert.equal(Object.values(s.byGL).reduce((x, y) => x + y, 0), s.taxable + s.nonTaxable);
  deq(C.glRows(a, myCats), [{ gl: 'Travel', amount: 99.4 }, { gl: 'Entertainment', amount: 80 }]);
});

test('reports by category, employee, department and month', () => {
  const employees = [{ id: 'e1', first: 'Amara', last: 'O', dept: 'd1' }, { id: 'e2', first: 'Daniel', last: 'R', dept: 'd2' }];
  const departments = [{ id: 'd1', name: 'People' }, { id: 'd2', name: 'Engineering' }];
  const list = [
    claim('a', [{ ...line('1', 'travel', 100, '2026-09-10'), approved: 100 }, { ...line('2', 'meals', 50, '2026-09-10'), approved: 40 }], 'Paid', 'e1'),
    claim('b', [line('3', 'travel', 30, '2026-10-02')], 'Pending', 'e2'),
    claim('c', [line('4', 'travel', 999, '2026-10-02')], 'Rejected', 'e2'),
    claim('d', [line('5', 'travel', 10, '2025-12-30')], 'Paid', 'e2'),
  ];
  const opts = { year: 2026, employees, departments, cats };
  const byCat = C.report(list, { ...opts, by: 'category' });
  deq(byCat.rows.map((r) => [r.label, r.claims, r.claimed, r.approved]), [['Travel', 2, 130, 100], ['Meals', 1, 50, 40]]);
  deq(byCat.totals, { claims: 2, lines: 3, claimed: 180, approved: 140 });
  deq(C.report(list, { ...opts, by: 'employee' }).rows.map((r) => [r.label, r.claimed]), [['Amara O', 150], ['Daniel R', 30]]);
  deq(C.report(list, { ...opts, by: 'department' }).rows.map((r) => r.label), ['People', 'Engineering']);
  deq(C.report(list, { ...opts, by: 'month' }).rows.map((r) => [r.key, r.claimed]), [['2026-09', 150], ['2026-10', 30]]);
  const csv = C.reportCSV(byCat).trim().split('\r\n');
  assert.equal(csv[0], 'Category,Claims,Items,Claimed (RM),Approved (RM)');
  assert.equal(csv[csv.length - 1], 'TOTAL,2,3,180.00,140.00');
});

test('old medical claims migrate to one-line Medical claims', () => {
  const old = { id: 'cl1', empId: 'e2', type: 'dental', date: '2026-09-14', provider: 'Klinik Pergigian', amount: 180, approved: 180, patient: 'Self', notes: 'Scaling', status: 'Paid', submitted: '2026-09-14', paidIn: '2026-09', img: 'data:x' };
  const n = C.migrateLegacy(old, MED);
  assert.equal(n.title, 'Dental');
  assert.equal(n.status, 'Paid');
  assert.equal(n.paidIn, '2026-09');
  assert.equal(n.approved, 180);
  assert.equal(n.type, undefined);
  deq(n.lines[0], { id: 'cl1-1', cat: 'medical', sub: 'dental', date: '2026-09-14', merchant: 'Klinik Pergigian', receiptNo: '', amount: 180, approved: 180, img: 'data:x', notes: 'Scaling', fields: { patient: 'Self' } });
  assert.equal(C.claimTotal(n), 180);
  assert.equal(C.approvedTotal(n), 180);
  assert.equal(C.migrateLegacy(n, MED), n, 'already migrated claims are left alone');
  const pending = C.migrateLegacy({ ...old, status: 'Pending', approved: null }, MED);
  assert.equal(pending.lines[0].approved, null);
  // Usage still works on migrated claims.
  assert.equal(C.usage([n], 'e2', { cat: 'medical', sub: 'dental', year: '2026' }).used, 180);
});
