// Salary deduction for late arrival: the formula, the grace period (two ways to count), per-trip staff and excused days.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/late-rules.js');
const S = (o = {}) => ({ on: true, grace: 10, mode: 'all', hours: 8, ...o });
const m = (days, o = {}) => L.month({ base: 3000, workingDays: 26, settings: S(o.s), days: days.map((raw, i) => ({ day: `2026-11-${String(i + 2).padStart(2, '0')}`, raw, excused: !!(o.excused || [])[i] })), employee: o.e, cancelled: o.cancelled });

test('RM3000 ÷ 26 ÷ 8 ÷ 60 × 10 minutes = RM2.40', () => {
  assert.equal(L.r2(L.rateOf(3000, 26, 8) * 10), 2.4);
  assert.equal(L.rateOf(3000, 26, 8).toFixed(6), '0.240385');
});

test('late 15 minutes with 10 minutes grace: RM3.61 (all minutes) or RM1.20 (after grace only)', () => {
  assert.equal(m([15]).minutes, 15); assert.equal(m([15]).amount, 3.61);
  assert.equal(m([15], { s: { mode: 'after' } }).minutes, 5); assert.equal(m([15], { s: { mode: 'after' } }).amount, 1.2);
});

test('late inside the grace period costs nothing, and exactly the grace is still free', () => {
  assert.equal(m([8]).amount, 0); assert.equal(m([10]).amount, 0); assert.equal(m([10]).minutes, 0);
  assert.equal(m([11]).minutes, 11);
  assert.equal(L.dayMinutes(8, S()), 0); assert.equal(L.dayMinutes(15, S()), 15); assert.equal(L.dayMinutes(15, S({ mode: 'after' })), 5);
});

test('several late days in a month add up, and the total is rounded once at the end', () => {
  const r = m([15, 8, 30, 12]);                      // counts 15 + 0 + 30 + 12 = 57 minutes
  assert.equal(r.minutes, 57);
  assert.equal(r.amount, L.r2(3000 / 26 / 8 / 60 * 57));   // 13.70, not the sum of rounded days
  assert.equal(r.amount, 13.7);
  const three = m([15, 15, 15]); assert.equal(three.amount, 10.82, 'three days together: 45 minutes, 10.82');
  assert.notEqual(three.amount, 3 * L.r2(L.rateOf(3000, 26, 8) * 15), 'rounding each day (3 × 3.61 = 10.83) would drift; this does not');
  assert.equal(m([15, 8, 30, 12], { s: { mode: 'after' } }).minutes, 5 + 0 + 20 + 2);
});

test('staff paid by the trip are left out; monthly staff are in', () => {
  assert.equal(m([30], { e: { pay: 'trip' } }).amount, 0); assert.equal(m([30], { e: { pay: 'trip' } }).skipped, 'per-unit pay');
  assert.equal(m([30], { e: { payBasis: 'Daily' } }).amount, 0);
  assert.ok(m([30], { e: { pay: 'monthly' } }).amount > 0);
  assert.ok(m([30], { e: {} }).amount > 0);
});

test('a late day with an approved waiver is excused; so is a day an admin cancels for the person', () => {
  const r = m([15, 20], { excused: [true, false] });
  assert.equal(r.minutes, 20); assert.equal(r.rows[0].excused, true); assert.equal(r.rows[0].counted, 0);
  const c = m([15, 20], { cancelled: 'Bus broke down' });
  assert.equal(c.amount, 0); assert.equal(c.cancelled, 'Bus broke down'); assert.equal(c.minutes, 35, 'the minutes stay visible for the admin');
});

test('off means nothing is deducted; settings are cleaned', () => {
  assert.equal(m([60], { s: { on: false } }).amount, 0);
  assert.deepEqual(L.clean({ on: 1, grace: -5, hours: 0, mode: 'x' }), { on: true, grace: 10, mode: 'all', hours: 8 });
  assert.deepEqual(L.clean(null), L.defaults());
  assert.equal(m([20], { s: { hours: 9 } }).amount, L.r2(3000 / 26 / 9 / 60 * 20));
});

test('payroll: the deduction comes off basic pay before EPF, SOCSO, EIS and PCB, like unpaid leave', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const sb = { window: {}, console }; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8'), sb);
  const U = sb.window.U, settings = { currency: 'MYR', taxRate: 0, benefitsRate: 0, statutory: { on: true } };
  const plain = U.payCalc(36000, 0, settings, { id: 'e', dob: '1990-01-01' }, '2026-11-30', {});
  const late = U.payCalc(36000, 0, settings, { id: 'e', dob: '1990-01-01' }, '2026-11-30', { late: 3.61, lateMinutes: 15 });
  assert.equal(plain.base, 3000); assert.equal(late.base, 3000, 'base is the full basic; the deduction is its own line');
  assert.equal(late.late, 3.61); assert.equal(late.lateMinutes, 15);
  assert.equal(late.gross, Math.round((plain.gross - 3.61) * 100) / 100);
  assert.ok(late.epf <= plain.epf && late.epfWage === Math.round((plain.epfWage - 3.61) * 100) / 100, 'EPF wage is lower by the deduction');
  assert.equal(U.payCalc(36000, 0, settings, null, '2026-11-30', { late: 99999 }).late, 3000, 'never more than the basic pay');
});

test('wiring: settings card, draft note with cancel and restore, bilingual payslip line', () => {
  const fs = require('node:fs'), path = require('node:path'), r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const app = r('js/app.js');
  assert.ok(app.includes('function lateCard()') && app.includes("'late-cancel'") && app.includes("'late-restore'") && app.includes('Potongan lewat'));
  assert.ok(r('js/statutory.js').includes('Late deduction / Potongan lewat') && r('js/roster.js').includes('function lateDays') && r('app.html').includes('js/late-rules.js'));
});

test('off by default for every company: no setting means no deduction, and payroll only asks when it is on', () => {
  assert.equal(L.defaults().on, false); assert.equal(L.clean(undefined).on, false); assert.equal(L.clean({}).on, false);
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(app.includes('lateCfg?.on'), 'payroll computes it only when the company turned it on');
  assert.ok(!/lateDeduct\s*[:=]\s*\{[^}]*on:\s*true/.test(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'seed.js'), 'utf8')), 'no seed turns it on');
  assert.ok(app.includes('Rate follows the “Unpaid leave deduction” setting (now: ${wd} days)') && app.includes('sekarang: ${wd} hari'));
});
