// Daily production commission: the money and who counts (js/prod-rules.js).  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/prod-rules.js');

test('the share: 2,000 × RM0.05 = RM100.00 ÷ 25 = RM4.00 each, nothing left over', () => {
  const d = P.commissionDay({ units: 2000, rate: '0.05', attendees: 25 });
  assert.deepEqual({ pool: d.poolSen, share: d.shareSen, rest: d.remainderSen }, { pool: 10000, share: 400, rest: 0 });
  assert.equal(P.rm(d.shareSen), 'RM4.00');
});

test('the leftover sen is not paid out: 1,000 × RM0.05 = RM50.00 ÷ 3 = RM16.66 each, RM0.02 not shared', () => {
  const d = P.commissionDay({ units: 1000, rate: '0.05', attendees: 3 });
  assert.deepEqual({ pool: d.poolSen, share: d.shareSen, rest: d.remainderSen }, { pool: 5000, share: 1666, rest: 2 });
  assert.equal(P.rm(d.remainderSen), 'RM0.02');
  assert.equal(d.shareSen * 3 + d.remainderSen, d.poolSen);
});

test('rounding: a 4-decimal rate, a decimal quantity, half-up on the pool', () => {
  assert.equal(P.commissionDay({ units: 12345, rate: '0.0025', attendees: 1 }).poolSen, 3086);   // 30.8625 → RM30.86
  assert.equal(P.commissionDay({ units: '12.5', rate: '2', attendees: 1 }).poolSen, 2500);        // kg
  assert.equal(P.commissionDay({ units: '0.5', rate: '0.01', attendees: 1 }).poolSen, 1);          // 0.5 sen rounds up to 1
  assert.equal(P.commissionDay({ units: '0.4', rate: '0.01', attendees: 1 }).poolSen, 0);          // 0.4 sen rounds down
  assert.equal(P.commissionDay({ units: '1,500', rate: 'RM0.05', attendees: 5 }).shareSen, 1500);  // commas and RM are tolerated
  // never floating point: 0.1 + 0.2 style traps
  assert.equal(P.commissionDay({ units: 3, rate: '0.1', attendees: 1 }).poolSen, 30);
  assert.equal(P.commissionDay({ units: 7, rate: '0.07', attendees: 1 }).poolSen, 49);
});

test('no attendees: the pool is not paid and the day says so; bad input is refused', () => {
  const d = P.commissionDay({ units: 2000, rate: '0.05', attendees: 0 });
  assert.equal(d.shareSen, 0); assert.equal(d.noAttendees, true); assert.equal(d.remainderSen, 10000);
  assert.equal(P.commissionDay({ units: 'abc', rate: '0.05', attendees: 3 }).ok, false);
  assert.equal(P.commissionDay({ units: 100, rate: '0.00005', attendees: 3 }).ok, false);     // more than 4 decimals
  assert.equal(P.commissionDay({ units: -5, rate: '0.05', attendees: 3 }).ok, false);
  assert.equal(P.rateUnits('0.05'), 500); assert.equal(P.rateUnits('1'), 10000); assert.equal(P.rateUnits('0.0025'), 25);
});

const S = { depts: ['d-prod'] };
const emp = (o = {}) => ({ id: 'e1', start: '2026-01-01', dept: 'd-prod', ...o });
const day = '2026-11-10';
const att = (o = {}) => ({ s: 'present', in: '08:55', ...o });

test('who counts: any check-in, including late; remote and kiosk and HR-corrected records count the same', () => {
  assert.equal(P.attendedForCommission({ employee: emp(), date: day, checkin: att(), settings: S }).ok, true);
  assert.equal(P.attendedForCommission({ employee: emp(), date: day, checkin: att({ in: '11:40' }), settings: S }).ok, true);        // very late
  assert.equal(P.attendedForCommission({ employee: emp(), date: day, checkin: att({ s: 'remote' }), settings: S }).ok, true);
  assert.equal(P.attendedForCommission({ employee: emp(), date: day, checkin: att({ via: 'kiosk' }), settings: S }).ok, true);
  assert.equal(P.attendedForCommission({ employee: emp(), date: day, checkin: att({ corr: 'q1' }), settings: S }).ok, true);
});

test('who does not: no check-in, absent, other or no department, not started, already left', () => {
  const r = (e, c) => P.attendedForCommission({ employee: e, date: day, checkin: c, settings: S });
  assert.deepEqual(r(emp(), null), { ok: false, reason: 'No check-in' });
  assert.equal(r(emp(), { s: 'absent', in: '' }).reason, 'No check-in');
  assert.equal(r(emp(), att({ in: '' })).reason, 'No check-in');
  assert.equal(r(emp({ dept: 'd-office' }), att()).reason, 'Not in a commission department');
  assert.equal(r(emp({ dept: '' }), att()).reason, 'No department');
  assert.equal(r(emp({ dept: undefined }), att()).reason, 'No department');
  assert.equal(r(emp({ start: '2026-11-11' }), att()).reason, 'Not yet started');               // starts tomorrow
  assert.equal(r(emp({ endDate: '2026-11-09' }), att()).reason, 'Already left');                 // left yesterday
  assert.equal(r(emp({ endDate: day }), att()).ok, true);                                        // last day counts
  assert.equal(r(emp({ start: day }), att()).ok, true);                                          // first day counts
});

test('leave: a full day wins over a check-in (and flags the day); a half day with a check-in counts', () => {
  const full = [{ empId: 'e1', from: day, to: day, half: '', status: 'Approved', type: 'annual' }];
  const half = [{ empId: 'e1', from: day, to: day, half: 'AM', status: 'Approved' }];
  const span = [{ empId: 'e1', from: '2026-11-09', to: '2026-11-11', half: '', status: 'Approved' }];
  const pending = [{ empId: 'e1', from: day, to: day, half: '', status: 'Pending' }];
  const other = [{ empId: 'e2', from: day, to: day, half: '', status: 'Approved' }];
  const go = (leaves, c) => P.attendedForCommission({ employee: emp(), date: day, checkin: c, leaves, settings: S });
  assert.deepEqual(go(full, null), { ok: false, reason: 'On leave (annual)', flag: '' });
  assert.equal(go(full, att()).ok, false);
  assert.match(go(full, att()).flag, /Checked in on a day of approved leave/);                  // both exist: leave wins, HR sees a flag
  assert.equal(go(span, att()).ok, false);                                                      // a multi-day leave
  assert.equal(go(half, att()).ok, true);                                                       // half day + check-in counts
  assert.equal(go(half, null).ok, false);                                                       // half day, no check-in: nothing
  assert.equal(go(pending, att()).ok, true);                                                    // not approved: doesn't count as leave
  assert.equal(go(other, att()).ok, true);                                                      // someone else's leave
});

test('a whole day: who shares, who does not and why; people in other departments are not listed', () => {
  const E = [emp({ id: 'a' }), emp({ id: 'b' }), emp({ id: 'c' }), emp({ id: 'd' }), emp({ id: 'e' }), emp({ id: 'o', dept: 'd-office' }), emp({ id: 'n', dept: '' })];
  const A = { a: att(), b: att({ in: '10:05' }), c: att({ s: 'remote' }), d: { s: 'leave', in: '' } };
  const L = [{ empId: 'd', from: day, to: day, half: '', status: 'Approved', type: 'annual' }];
  const p = P.planDay({ date: day, units: 1000, rate: '0.05', employees: E, att: A, leaves: L, settings: S });
  assert.equal(p.count, 3);
  assert.equal(p.poolSen, 5000); assert.equal(p.shareSen, 1666); assert.equal(p.remainderSen, 2);
  assert.deepEqual(p.attendees.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(Object.fromEntries(p.excluded.map((x) => [x.id, x.reason])), { d: 'On leave (annual)', e: 'No check-in', n: 'No department' });
  assert.equal(p.sig, 'a,b,c');
});

test('a month: each person’s total and days; a later correction shows as changed; days with check-ins but no entry are missing', () => {
  const E = [emp({ id: 'a' }), emp({ id: 'b' })];
  const days = {
    '2026-11-03': { shareSen: 400, attendees: ['a', 'b'], units: 1000, rate: '0.05', sig: 'a,b' },
    '2026-11-04': { shareSen: 700, attendees: ['a'], units: 700, rate: '0.1', sig: 'a' },
    '2026-10-31': { shareSen: 999, attendees: ['a'], units: 1, rate: '1', sig: 'a' },
  };
  assert.deepEqual(P.monthTotals(days, '2026-11'), { a: { sen: 1100, days: 2 }, b: { sen: 400, days: 1 } });
  const attByDay = { '2026-11-03': { a: att(), b: att() }, '2026-11-04': { a: att(), b: att({ in: '09:30' }) }, '2026-11-05': { a: att() } };
  const w = P.monthWarnings({ month: '2026-11', days, employees: E, attByDay, settings: { ...S, rate: '0.05' } });
  assert.deepEqual(w.changed, ['2026-11-04']);        // b was added by a correction after the day was saved
  assert.deepEqual(w.missing, ['2026-11-05']);        // check-ins but no production entered
  const none = P.monthWarnings({ month: '2026-11', days: {}, employees: E, attByDay: { '2026-11-08': { a: att() } }, settings: S, isWorkday: () => false });
  assert.deepEqual(none.missing, []);                 // a day off isn't flagged
});

// ---------- Payroll: the commission line goes through EPF, SOCSO/EIS and PCB like wages; not the HRD levy ----------
test('payroll: production commission is wages for EPF, SOCSO, EIS and PCB, but not the HRD levy, overtime or leave pay', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const sb = { console }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8'), sb, { filename: 'utils.js' });
  const U = sb.AllurusUtils || sb.U || sb.window.U;
  const settings = { currency: 'MYR', taxRate: 8, benefitsRate: 11.7, statutory: { ...U.STATUTORY, hrdf: 1 } };
  const e = { birthday: '1990-05-05' };
  const commission = { key: 'prod', label: 'Production commission / Komisen pengeluaran', amount: 84, epf: true, socso: true, tax: true, hrd: false, detail: '21 days' };
  const plain = U.payCalc(24000, 0, settings, e, '2026-11-30', {});
  const withC = U.payCalc(24000, 0, settings, e, '2026-11-30', { extra: [commission] });
  assert.equal(withC.extras, 84);
  assert.equal(withC.gross, plain.gross + 84);
  assert.equal(withC.epfWage, plain.epfWage + 84);                  // EPF wage includes it
  assert.ok(withC.epf >= plain.epf);
  assert.equal(withC.socsoWage, plain.socsoWage + 84);              // SOCSO and EIS band wage includes it
  assert.ok(withC.tax >= plain.tax);                                // PCB is on basic + commission
  assert.equal(withC.hrdf, plain.hrdf);                            // HRD levy: excluded (HRD Corp's levy guideline exempts commissions and production incentives)
  assert.ok(U.payCalc(24000, 0, settings, e, '2026-11-30', { extra: [{ ...commission, hrd: true }] }).hrdf > plain.hrdf);   // the flag still works if an accountant ever turns it on
  // Turning each flag off (the accountant's choice) removes it from that one only.
  const noEpf = U.payCalc(24000, 0, settings, e, '2026-11-30', { extra: [{ ...commission, epf: false }] });
  assert.equal(noEpf.epfWage, plain.epfWage); assert.equal(noEpf.socsoWage, plain.socsoWage + 84);
  const noHrd = U.payCalc(24000, 0, settings, e, '2026-11-30', { extra: [{ ...commission, hrd: false }] });
  assert.equal(noHrd.hrdf, plain.hrdf);
  // Other earnings never get the HRD flag by accident.
  assert.equal(U.payCalc(24000, 0, settings, e, '2026-11-30', { extra: [{ key: 'ot', amount: 50, epf: true, socso: true, tax: true }] }).hrdf, plain.hrdf);
});
