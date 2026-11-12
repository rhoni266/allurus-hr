// docs/SALARY-BASIS-SPEC.md: monthly/yearly conversion at the edge (stored value stays yearly), labels, import in each basis, the fix script's
// rules and the pay run safety checks. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../js/salary-rules.js');

const sb = { window: {} }; vm.createContext(sb);
for (const f of ['importFieldMap.js', 'import-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'import', f), 'utf8'), sb);
const R = sb.window.AllurusImportRules;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const rm = (n) => 'RM' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test('conversion: stored is yearly; monthly typed ×12 exactly, shown ÷12 to the sen; round trips', () => {
  assert.equal(S.stored(2345.55, 'monthly'), 28146.6);
  assert.equal(S.shown(28146.6, 'monthly'), 2345.55);
  assert.equal(S.stored(1700, 'monthly'), 20400);
  assert.equal(S.shown(20400, 'monthly'), 1700);
  assert.equal(S.stored(2000, 'monthly'), 24000);
  assert.equal(S.shown(24000, 'yearly'), 24000, 'yearly basis: shown as stored');
  assert.equal(S.stored(24000.5, 'yearly'), 24000.5);
  // round trip in sen, for many values including awkward ones
  for (const m of [0, 0.01, 1699.99, 1700, 2345.55, 3333.33, 4999.99, 12345.67, 99999.99]) assert.equal(S.shown(S.stored(m, 'monthly'), 'monthly'), m, `monthly ${m}`);
  for (const y of [0, 20400, 24000, 27600, 41400, 55200, 12345.6]) assert.equal(S.stored(S.shown(y, 'yearly'), 'yearly'), y, `yearly ${y}`);
  assert.equal(S.shown(1000, 'monthly'), 83.33, 'a yearly figure that is not a multiple of 12 sen is shown to the nearest sen');
  assert.equal(S.stored(S.shown(1000, 'monthly'), 'monthly'), 999.96, '…and that is why the field is monthly for typing: the stored value is exact for any typed monthly');
  assert.equal(S.stored('', 'monthly'), 0); assert.equal(S.stored(undefined, 'yearly'), 0);
});

test('the incident figures: RM2,000 and RM2,300 typed as yearly are RM166.67 and RM191.67 a month', () => {
  assert.equal(S.shown(2000, 'monthly'), 166.67); assert.equal(S.shown(2300, 'monthly'), 191.67);
});

test('basis: monthly by default; yearly only when chosen; a company with salaryMonthlyOnly is always monthly', () => {
  assert.equal(S.basisOf({}), 'monthly'); assert.equal(S.basisOf(undefined), 'monthly');
  assert.equal(S.basisOf({ salaryBasis: 'yearly' }), 'yearly');
  assert.equal(S.basisOf({ salaryBasis: 'yearly' }, { salaryMonthlyOnly: true }), 'monthly');
  assert.equal(S.basisOf({ salaryBasis: 'monthly' }, { salaryMonthlyOnly: false }), 'monthly');
  assert.equal(S.lockedMonthly({ salaryMonthlyOnly: true }), true); assert.equal(S.lockedMonthly({}), false); assert.equal(S.lockedMonthly(null), false);
});

test('labels name the basis, in English and Bahasa Malaysia, with the other figure underneath', () => {
  assert.equal(S.label('monthly').en, 'Basic salary (monthly)'); assert.equal(S.label('monthly').ms, 'Gaji pokok (bulanan)');
  assert.equal(S.label('yearly').en, 'Basic salary (yearly)'); assert.equal(S.label('yearly').ms, 'Gaji pokok (tahunan)');
  assert.equal(S.label(undefined).ms, 'Gaji pokok (bulanan)');
  assert.equal(S.otherLine(24000, 'monthly', rm), '= RM24,000.00 a year');
  assert.equal(S.otherLine(24000, 'yearly', rm), '= RM2,000.00 a month');
});

// ---- import in each basis ----
const rows = (h) => [['Name', 'IC', h], ['Ali bin Abu', '900101015555', '2000'], ['Siti binti Omar', '910202025555', '2300']];
function plan(h, basis) {
  const grid = R.tidyGrid(rows(h)), hi = R.detectHeaderRow(grid), headers = grid.rows[hi].cells.map(String);
  const columns = headers.map((_, i) => grid.rows.slice(hi + 1).map((r) => r.cells[i]));
  const mapping = R.autoMap(headers, columns, { today: '2026-11-12', basis });
  const p = R.buildPlan({ grid, headerIndex: hi, mapping, existing: [], departments: [], banks: ['Maybank'], today: '2026-11-12' });
  return { mapping: JSON.parse(JSON.stringify(mapping)), rows: JSON.parse(JSON.stringify(p.rows)) };
}
test('import: a plain "Salary" / "Gaji pokok" column is read in the company basis (monthly by default: stored ×12)', () => {
  for (const h of ['Salary', 'Gaji Pokok', 'Basic salary']) {
    const m = plan(h, 'monthly'); const f = m.mapping.find((x) => x.header === h).field;
    assert.equal(f, 'salaryMonthly', h); assert.equal(m.rows[0].values.salary, 24000, h + ': RM2,000 a month is stored as 24,000 a year');
    assert.equal(m.rows[1].values.salary, 27600);
    assert.equal(plan(h, undefined).rows[0].values.salary, 24000, 'monthly is the default');
  }
});
test('import: in a yearly company the same plain column is yearly (stored as typed)', () => {
  const y = plan('Salary', 'yearly');
  assert.equal(y.mapping.find((x) => x.header === 'Salary').field, 'salaryAnnual');
  assert.equal(y.rows[0].values.salary, 2000);
});
test('import: a header that says which basis wins in either company', () => {
  assert.equal(plan('Annual salary', 'monthly').mapping.find((x) => x.header === 'Annual salary').field, 'salaryAnnual');
  assert.equal(plan('Gaji tahunan', 'monthly').mapping.find((x) => x.header === 'Gaji tahunan').field, 'salaryAnnual');
  assert.equal(plan('Monthly salary', 'yearly').mapping.find((x) => x.header === 'Monthly salary').field, 'salaryMonthly');
  assert.equal(plan('Gaji bulanan', 'yearly').mapping.find((x) => x.header === 'Gaji bulanan').field, 'salaryMonthly');
  assert.equal(plan('Monthly salary', 'yearly').rows[0].values.salary, 24000);
});

// ---- pay run safety checks ----
const emps = [
  { id: 'a', first: 'A', type: 'Full-time' }, { id: 'b', first: 'B', type: 'Full-time' }, { id: 'c', first: 'C', type: 'Part-time' },
  { id: 'd', first: 'D', type: 'Full-time', pay: 'trip' }, { id: 'e', first: 'E', type: 'Full-time' }, { id: 'f', first: 'F', type: 'Full-time' }, { id: 'g', first: 'G', type: 'Full-time' },
];
const run = [{ empId: 'a', base: 0 }, { empId: 'b', base: 1500 }, { empId: 'c', base: 900 }, { empId: 'd', base: 0 }, { empId: 'e', base: 3000 }, { empId: 'f', base: 1700 }, { empId: 'g', base: 1200 }];
const prev = [{ empId: 'e', base: 1900 }, { empId: 'f', base: 1700 }, { empId: 'b', base: 1500 }, { empId: 'g', base: 3000 }];
test('payroll checks: no salary, below minimum wage, a jump of more than 50% (up or down); per-trip and part-time workers are not flagged for pay level', () => {
  const r = S.payrollChecks({ items: run, employees: emps, prevItems: prev });
  const by = Object.fromEntries(r.map((x) => [x.empId, x.kinds]));
  assert.deepEqual(by.a, ['none']);
  assert.deepEqual(by.b, ['minwage']);
  assert.ok(!by.c, 'part-time: no minimum wage check');
  assert.ok(!by.d, 'paid by the trip: no salary is fine');
  assert.deepEqual(by.e, ['jump'], '1,900 → 3,000 is +58%');
  assert.ok(!by.f, 'exactly the minimum wage, no change');
  assert.deepEqual(by.g, ['minwage', 'jump'], '3,000 → 1,200 is −60% and below the minimum');
  assert.equal(S.payrollChecks({ items: run, employees: emps, prevItems: null }).some((x) => x.kinds.includes('jump')), false, 'no last month, no jump');
  assert.equal(S.payrollChecks({ items: [{ empId: 'e', base: 2850 }], employees: emps, prevItems: [{ empId: 'e', base: 1900 }] }).length, 0, 'exactly +50% is not more than 50%');
});
test('payroll checks: the minimum wage is a setting, not a constant in the checks', () => {
  assert.equal(S.MIN_WAGE_DEFAULT, 1700);
  const items = [{ empId: 'b', base: 1500 }];
  assert.equal(S.payrollChecks({ items, employees: emps, minWage: 1400 }).length, 0);
  assert.equal(S.payrollChecks({ items, employees: emps, minWage: 1800 }).length, 1);
  assert.equal((read('js/app.js').match(/\b1700\b/g) || []).length, 0, 'js/app.js has no hard-coded 1700');
});

// ---- the fix script's rules ----
test('fix script: dry run first, only named people, only if they still look monthly; limit RM20,400 = RM1,700 × 12', () => {
  const src = read('scripts/fix-salary-basis.js');
  assert.match(src, /--yes needs --only/);
  assert.match(src, /kind !== 'LOOKS MONTHLY'/, 're-checked at apply time');
  assert.match(src, /LIMIT = limitArg \? Number\(limitArg\.slice\(8\)\) : 20400/);
  assert.match(src, /Salary corrected from \$\{rm\(r\.yearly\)\}\/yr to \$\{rm\(r\.proposed\)\}\/yr, monthly basis fix/);
  assert.ok(!/\bic\b\s*[:=]/.test(src.replace(/\/\/.*$/gm, '')), 'never prints ICs');
  assert.equal(20400, S.yearlyOfMonthly(S.MIN_WAGE_DEFAULT));
});
