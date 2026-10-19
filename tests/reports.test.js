// Unit tests for report aggregations (headcount, joiners and leavers, turnover, payroll variance, statutory totals,
// grouping, yearly dates) and the custom report engine. Also checks the payroll summary against the seeded data.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'report-rules.js'), 'utf8'), sandbox);
const R = sandbox.window.AllurusReportRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

const emps = [
  { id: 'a', dept: 'd1', start: '2020-01-01', status: 'Active' },
  { id: 'b', dept: 'd1', start: '2026-03-15', status: 'Active' },
  { id: 'c', dept: 'd2', start: '2021-05-01', status: 'Active', endDate: '2026-04-30' },
  { id: 'd', dept: 'd2', start: '2022-01-01', status: 'Inactive' },
  { id: 'e', dept: 'd2', start: '2026-07-01', status: 'Active' },
  { id: 'f', dept: 'zz', start: '2019-01-01', status: 'Active', endDate: '2026-09-30' },
];
const depts = [{ id: 'd1', name: 'One' }, { id: 'd2', name: 'Two' }];

test('months and month ends', () => {
  deq(R.months('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(R.monthEnd('2028-02'), '2028-02-29');
  assert.equal(R.monthEnd('2026-04'), '2026-04-30');
});

test('headcount by department on a date', () => {
  const h = R.headcount(emps, '2026-04-01', depts);
  assert.equal(h.total, 4); // a, b, c, f (d is inactive, e not started)
  deq(h.rows.map((r) => [r.name, r.count]), [['One', 2], ['Two', 1], ['No department', 1]]);
  assert.equal(R.headcount(emps, '2026-10-01', depts).total, 3); // a, b, e
});

test('joiners and leavers in a range', () => {
  const j = R.joinersLeavers(emps, '2026-01-01', '2026-06-30');
  deq(j.joiners.map((e) => e.id), ['b']);
  deq(j.leavers.map((e) => e.id), ['c']);
});

test('turnover rate: leavers over average headcount, annualised', () => {
  // 1 Jan: a, c, f (3). 30 Jun: a, b, f (3). One leaver (c) → 1 ÷ 3 = 33.33%.
  const t = R.turnover(emps, '2026-01-01', '2026-06-30');
  deq({ start: t.start, end: t.end, leavers: t.leavers, avg: t.avg, rate: t.rate }, { start: 3, end: 3, leavers: 1, avg: 3, rate: 33.33 });
  assert.equal(t.annualised, 67.21); // 33.33 × 365 ÷ 181 days
  const m = R.turnoverByMonth(emps, '2026-09-01', '2026-10-31');
  deq(m.map((x) => [x.month, x.leavers, x.rate]), [['2026-09', 1, 25], ['2026-10', 0, 0]]);
  assert.equal(R.turnover([], '2026-01-01', '2026-01-31').rate, 0);
});

test('payroll by month with month-on-month variance and a department filter', () => {
  const it = (empId, gross, extra = {}) => ({ empId, gross, net: gross * 0.8, epf: gross * 0.11, socso: 10, eis: 4, tax: 50, erEpf: gross * 0.13, erSocso: 30, erEis: 4, hrdf: gross * 0.01, ...extra });
  const payroll = { '2026-08': { status: 'Paid', items: [it('a', 5000), it('b', 4000)] }, '2026-09': { status: 'Paid', items: [it('a', 5500), it('b', 4000), it('c', 3000)] } };
  const rows = R.payrollByMonth(payroll, ['2026-07', '2026-08', '2026-09']);
  deq(rows.map((r) => [r.month, r.people, r.gross]), [['2026-08', 2, 9000], ['2026-09', 3, 12500]]);
  assert.equal(rows[0].change.gross, null);
  deq({ g: rows[1].change.gross, p: rows[1].change.grossPct, n: rows[1].change.people }, { g: 3500, p: 38.89, n: 1 });
  // Employer cost = gross + employer EPF + SOCSO + EIS + HRD levy.
  assert.equal(rows[0].employer, 1170 + 60 + 8 + 90);
  assert.equal(rows[0].cost, 9000 + 1328);
  const onlyA = R.payrollByMonth(payroll, ['2026-08', '2026-09'], (i) => i.empId === 'a');
  assert.equal(onlyA[1].change.gross, 500);
  const s = R.statutoryByMonth(payroll, ['2026-08']);
  deq({ epfEe: s[0].epfEe, epfEr: s[0].epfEr, pcb: s[0].pcb, socsoEe: s[0].socsoEe }, { epfEe: 990, epfEr: 1170, pcb: 100, socsoEe: 20 });
  assert.equal(s[0].total, R.r2(990 + 1170 + 20 + 60 + 8 + 8 + 100 + 0 + 90));
});

test('group and sum', () => {
  const g = R.groupSum([{ d: 'x', h: 2, c: 10 }, { d: 'y', h: 1, c: 5 }, { d: 'x', h: 1.5, c: 7.25 }], (r) => r.d, ['h', 'c']);
  deq(g, [{ key: 'x', count: 2, h: 3.5, c: 17.25 }, { key: 'y', count: 1, h: 1, c: 5 }]);
});

test('yearly dates in a range, including 29 February', () => {
  deq(R.yearly('1990-11-02', '2026-10-19', '2026-11-18'), ['2026-11-02']);
  deq(R.yearly('1990-11-02', '2026-11-03', '2027-11-02'), ['2027-11-02']);
  deq(R.yearly('1992-02-29', '2027-02-01', '2027-03-01'), ['2027-02-28']);
  deq(R.yearly('', '2026-01-01', '2026-12-31'), []);
});

test('custom report engine: columns, filters, sort and totals', () => {
  const fields = { name: { label: 'Name', type: 'text' }, dept: { label: 'Department', type: 'text' }, salary: { label: 'Salary', type: 'money' }, start: { label: 'Start', type: 'date' } };
  const rows = [
    { name: 'Ana', dept: 'Sales', salary: 5000, start: '2021-01-01' },
    { name: 'Ben', dept: 'Tech', salary: 9000, start: '2023-06-01' },
    { name: 'Cai', dept: 'Tech', salary: 7000, start: '2019-02-01' },
    { name: 'Dee', dept: 'Sales', salary: 4000, start: '2024-09-01' },
  ];
  const r = R.runQuery(rows, fields, { columns: ['name', 'salary', 'bogus'], filters: [{ field: 'salary', op: 'gte', value: '5000' }], sort: { field: 'salary', dir: 'desc' } });
  deq(r.columns.map((c) => c.key), ['name', 'salary']);
  deq(r.rows, [{ name: 'Ben', salary: 9000 }, { name: 'Cai', salary: 7000 }, { name: 'Ana', salary: 5000 }]);
  deq(r.totals, { salary: 21000 });
  // Dates compare as text, case-insensitive matching for "is".
  assert.equal(R.runQuery(rows, fields, { columns: ['name'], filters: [{ field: 'start', op: 'lt', value: '2022-01-01' }, { field: 'dept', op: 'eq', value: 'sales' }] }).rows.length, 1);
  assert.equal(R.runQuery(rows, fields, { columns: ['name'], filters: [{ field: 'name', op: 'contains', value: 'E' }] }).rows.length, 2);
});

test('custom report engine: grouping with sum, average and count', () => {
  const fields = { dept: { label: 'Department', type: 'text' }, salary: { label: 'Salary', type: 'money' }, days: { label: 'Days', type: 'number' }, name: { label: 'Name', type: 'text' } };
  const rows = [{ dept: 'Tech', salary: 9000, days: 2, name: 'B' }, { dept: 'Sales', salary: 4000, days: 1, name: 'D' }, { dept: 'Tech', salary: 7000, days: 3, name: 'C' }];
  const s = R.runQuery(rows, fields, { columns: ['name', 'salary', 'days'], groupBy: 'dept', agg: 'sum', sort: { field: 'salary', dir: 'desc' } });
  deq(s.columns.map((c) => c.key), ['dept', '_count', 'salary', 'days']);
  deq(s.rows, [{ dept: 'Tech', _count: 2, salary: 16000, days: 5 }, { dept: 'Sales', _count: 1, salary: 4000, days: 1 }]);
  deq(s.totals, { _count: 3, salary: 20000, days: 6 });
  const a = R.runQuery(rows, fields, { columns: ['salary'], groupBy: 'dept', agg: 'avg' });
  deq(a.rows.map((r) => [r.dept, r.salary]), [['Tech', 8000], ['Sales', 4000]]);
  assert.equal(a.columns[2].label, 'Salary (avg)');
});

test('seeded payroll: the summary reconciles with the pay items', () => {
  const sb = { console };
  sb.window = sb;
  vm.createContext(sb);
  for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'report-rules', 'costing-rules', 'finance', 'tax', 'claims', 'planner', 'seed']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
  const seed = sb.AllurusSeed.create(), S = sb.AllurusReportRules;
  const mks = Object.keys(seed.payroll).sort();
  const rows = S.payrollByMonth(seed.payroll, mks);
  assert.equal(rows.length, mks.length);
  rows.forEach((r) => {
    const items = seed.payroll[r.month].items;
    assert.equal(r.gross, S.r2(items.reduce((s, i) => s + i.gross, 0)), r.month);
    assert.equal(r.net, S.r2(items.reduce((s, i) => s + i.net, 0)), r.month);
    assert.equal(r.cost, S.r2(items.reduce((s, i) => s + i.gross + i.erCost, 0)), `${r.month} employer cost matches erCost`);
  });
  // Department totals add up to the company total.
  const last = mks[mks.length - 1];
  const byDept = seed.departments.map((d) => S.payrollByMonth(seed.payroll, [last], (i) => seed.employees.find((e) => e.id === i.empId)?.dept === d.id)[0]?.gross || 0);
  assert.equal(S.r2(byDept.reduce((s, x) => s + x, 0)), rows[rows.length - 1].gross);
});
