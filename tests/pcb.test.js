// Tests for the PCB (MTD) calculation, foreign worker contributions and CP38 deductions.
// The PCB figures are worked out by hand from LHDN's 2026 MTD specification (Table 1 and the normal and additional
// remuneration methods); see the comments for each case. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['utils', 'statutory']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
}
const U = sandbox.U, S = sandbox.AllurusStatutory;
const settings = { currency: 'MYR', taxRate: 10, benefitsRate: 10 };
const monthly = (n) => n * 12;

test('tax table: category 1 and 3 versus 2, and the RM400 rebate cliff at RM35,000', () => {
  assert.equal(U.mtdTax(5000, 1), 0);
  assert.equal(U.mtdTax(20000, 1), 0); // the RM400 rebate cancels the tax
  assert.equal(U.mtdTax(35000, 1), 200); // 150 + 450 - 400 rebate (band 20,001 to 35,000: 450 - 250)
  assert.equal(U.mtdTax(35001, 1), 600.06); // rebate no longer applies above RM35,000
  assert.equal(U.mtdTax(47000, 1), 1320);
  assert.equal(U.mtdTax(100000, 1), 9400);
  assert.equal(U.mtdTax(2000001, 1), 528400.3);
  assert.equal(U.mtdTax(30000, 2), 0); // category 2 carries a further RM400 rebate
});

test('PCB for RM5,000 a month, single, in January', () => {
  // EPF 11% = RM550. K2 = (4,000 - 550) / 11 = 313.63. P = 4,450 + (5,000 - 313.63) x 11 - 9,000 = 47,000.07.
  // Tax = (47,000.07 - 35,000) x 6% + 600 = 1,320.00. MTD = 1,320.00 / 12 = 110.00.
  assert.equal(U.mtdOfficial({ month: 1, y1: 5000, k1: 550 }), 110);
  // Later months with the same pay stay at RM110 when earlier months were paid the same.
  assert.equal(U.mtdOfficial({ month: 7, y1: 5000, k1: 550 }), 110);
});

test('PCB category 2 with two children takes RM8,000 off chargeable income', () => {
  // Spouse RM4,000 + 2 children RM4,000: P = 39,000.07, tax = 4,000.07 x 6% + 600 = 840.00, MTD = 70.00.
  assert.equal(U.mtdOfficial({ month: 1, y1: 5000, k1: 550, cat: 2, children: 2 }), 70);
});

test('PCB in December uses the year to date and the RM4,000 EPF cap', () => {
  // Eleven months at RM5,000: EPF paid 6,050 is capped at 4,000, MTD paid 1,210. December: P = 51,000 + 5,000 - 9,000.
  const m = U.mtdOfficial({ month: 12, y1: 5000, k1: 550, ytd: { y: 55000, k: 6050, x: 1210, z: 0 } });
  assert.equal(m, 110);
  // Zakat paid earlier counts towards the year's tax: RM100 paid reduces what is left to deduct.
  assert.equal(U.mtdOfficial({ month: 12, y1: 5000, k1: 550, ytd: { y: 55000, k: 6050, x: 1110, z: 100 } }), 110);
});

test('bonus: extra tax from the additional remuneration method', () => {
  // RM10,000 bonus in January with 11% EPF (RM1,100). K2 falls to (4,000 - 550 - 1,100) / 11 = 213.63.
  // P with bonus = 57,000.00, tax = 7,000 x 11% + 1,500 = 2,270.00; without bonus 1,320.00.
  // Bonus MTD = 949.99 (truncated), total = 110.00 + 949.99 = 1,059.99, rounded up to 5 sen = 1,060.00.
  assert.equal(U.mtdOfficial({ month: 1, y1: 5000, k1: 550, bonus: 10000, kBonus: 1100 }), 1060);
});

test('PCB is rounded up to 5 sen and nothing is deducted below RM10', () => {
  assert.equal(U.mtdOfficial({ month: 1, y1: 2500, k1: 275 }), 0);
  const m = U.mtdOfficial({ month: 1, y1: 7000, k1: 770 });
  assert.equal(Math.round(m * 100) % 5, 0);
  assert.ok(m > 10);
});

test('marital status, children and tax residency flow through payCalc', () => {
  const single = U.payCalc(monthly(5000), 0, settings, { id: 'a' }, '2026-01-31');
  const marriedWorking = U.payCalc(monthly(5000), 0, settings, { id: 'b', married: true }, '2026-01-31');
  const marriedNoWork = U.payCalc(monthly(5000), 0, settings, { id: 'c', married: true, spouseWorking: false, children: 2 }, '2026-01-31');
  const nonResident = U.payCalc(monthly(5000), 0, settings, { id: 'd', taxResident: false }, '2026-01-31');
  assert.equal(single.tax, 110);
  assert.equal(marriedWorking.tax, 110); // category 3 with no children: same reliefs as single
  assert.equal(marriedNoWork.tax, 70);
  assert.equal(nonResident.tax, 1500); // flat 30%
  assert.equal(U.mtdCategory({ married: false, children: 1 }), 3);
  assert.equal(U.mtdCategory({ married: true, spouseWorking: false }), 2);
});

test('zakat through payroll reduces the PCB deducted', () => {
  const it = U.payCalc(monthly(5000), 0, settings, { id: 'a', zakat: 50 }, '2026-01-31');
  assert.equal(it.tax, 60);
  assert.equal(it.zakat, 50);
});

test('foreign workers: EPF 2% each, SOCSO employer-only injury cover, no EIS', () => {
  const f = U.payCalc(monthly(3000), 0, settings, { id: 'f', nationality: 'Indonesia' }, '2026-01-31');
  assert.equal(f.epf, 60);
  assert.equal(f.erEpf, 60);
  assert.equal(f.socso, 0);
  assert.equal(f.erSocso, 36.9); // 1.25% of the RM2,950 wage band = 36.875, rounded up to 5 sen
  assert.equal(f.eis, 0);
  assert.equal(f.erEis, 0);
  const my = U.payCalc(monthly(3000), 0, settings, { id: 'm', nationality: 'Malaysia' }, '2026-01-31');
  assert.equal(my.epf, 330);
  assert.ok(my.socso > 0 && my.eis > 0);
  // A permanent resident follows the Malaysian rules, and a domestic worker has no mandatory EPF.
  assert.equal(U.payCalc(monthly(3000), 0, settings, { id: 'p', nationality: 'India', pr: true }, '2026-01-31').epf, 330);
  assert.equal(U.payCalc(monthly(3000), 0, settings, { id: 'h', nationality: 'Indonesia', domesticWorker: true }, '2026-01-31').epf, 0);
});

test('CP38 is deducted from net pay in its period, on top of PCB, and flows to CP39 and the EA form', () => {
  const e = { id: 'x', first: 'Test', last: 'Person', ic: '900115115123', taxNo: 'SG1234567890', cp38Amount: 200, cp38From: '2026-02', cp38To: '2026-04' };
  const jan = U.payCalc(monthly(5000), 0, settings, e, '2026-01-31');
  const feb = U.payCalc(monthly(5000), 0, settings, e, '2026-02-28');
  const may = U.payCalc(monthly(5000), 0, settings, e, '2026-05-31');
  assert.equal(jan.cp38, 0);
  assert.equal(feb.cp38, 200);
  assert.equal(may.cp38, 0);
  assert.equal(feb.tax, jan.tax); // CP38 does not change PCB
  assert.equal(Math.round((jan.net - feb.net) * 100) / 100, 200);
  const run = { status: 'Paid', items: [{ empId: 'x', ...feb }] };
  const f = S.pcbFile(run, { month: '2026-02', employees: [e] });
  assert.equal(f.meta.sums.cp38, 200);
  assert.equal(f.rows[0].cp38, 200);
  const ea = S.eaForm({ year: '2026', emp: e, payroll: { '2026-02': run } });
  assert.equal(ea.deductions.cp38, 200);
});
