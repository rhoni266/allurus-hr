// Unit tests for the time attendance rules: lateness, early-out, overtime for each day type, rounding, caps,
// offset, pre-approval, auto-shift, allowances, overtime pay, rosters, the audit trail and payroll add-ons.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'attendance-rules.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8'), sandbox);
const T = sandbox.window.AllurusTimeRules;
const U = sandbox.window.U;
// Values built inside the vm sandbox have that realm's prototypes; compare plain copies.
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

const OFFICE = { id: 'p-office', name: 'Office', start: '09:00', end: '18:00', breakMin: 60, grace: 10, days: [1, 2, 3, 4, 5], flexible: false };
const MORNING = { id: 'p-am', name: 'Morning', start: '07:00', end: '16:00', breakMin: 60, grace: 5, days: [1, 2, 3, 4, 5, 6], flexible: false };
const EVENING = { id: 'p-pm', name: 'Evening', start: '15:00', end: '00:00', breakMin: 60, grace: 5, days: [1, 2, 3, 4, 5], flexible: false };
const NIGHT = { id: 'p-night', name: 'Night', start: '22:00', end: '07:00', breakMin: 60, grace: 5, days: [0, 1, 2, 3, 4, 5, 6], flexible: false };
const FLEX = { id: 'p-flex', name: 'Flexible', start: '07:00', end: '19:00', coreStart: '10:00', coreEnd: '16:00', hours: 8, breakMin: 60, grace: 0, days: [1, 2, 3, 4, 5], flexible: true };
const rules = (patch = {}) => ({ ...T.defaultOT(), preApproval: false, ...patch });
const day = (inT, outT, s = 'present') => ({ s, in: inT, out: outT });
const ev = (rec, patch = {}, extra = {}) => T.evaluate({ rec, pattern: OFFICE, type: 'normal', rules: rules(patch), ...extra });

test('lateness within the grace minutes is not counted; past grace it counts in full', () => {
  assert.equal(ev(day('09:08', '18:00')).late, 0);
  assert.equal(ev(day('09:08', '18:00')).lateRaw, 8);
  assert.equal(ev(day('09:10', '18:00')).late, 0);
  assert.equal(ev(day('09:15', '18:00')).late, 15);
  assert.equal(ev(day('08:50', '18:00')).late, 0);
});

test('an approved lateness waiver clears the late minutes', () => {
  const r = ev(day('09:40', '18:00'), {}, { waived: true });
  assert.equal(r.late, 0);
  assert.equal(r.waived, true);
});

test('early-out is the time left before the shift ends', () => {
  assert.equal(ev(day('09:00', '17:20')).early, 40);
  assert.equal(ev(day('09:00', '18:05')).early, 0);
  // No check-out yet: nothing to measure.
  assert.equal(ev(day('09:00', '')).early, 0);
});

test('worked time takes the break off only for longer days', () => {
  assert.equal(ev(day('09:00', '18:00')).worked, 480);
  assert.equal(ev(day('09:00', '13:00')).worked, 240);
});

test('normal-day overtime after the shift, rounded down to 15 minutes', () => {
  const r = ev(day('08:55', '20:10'));
  deq(r.buckets, { normal: 120, restIn: 0, rest: 0, holidayIn: 0, holiday: 0, night: 0 });
  assert.equal(r.rawOT, 130);
});

test('early overtime before the shift counts only when switched on', () => {
  assert.equal(ev(day('08:00', '18:00')).buckets.normal, 0);
  assert.equal(ev(day('08:00', '18:00'), { early: true }).buckets.normal, 60);
});

test('rest day: normal hours at the rest-day rate, the rest as rest-day overtime', () => {
  const r = T.evaluate({ rec: day('09:00', '20:00'), pattern: OFFICE, type: 'rest', rules: rules() });
  assert.equal(r.worked, 600);
  assert.equal(r.buckets.restIn, 480);
  assert.equal(r.buckets.rest, 120);
  assert.equal(r.late, 0);
});

test('public holiday: short day is all within normal hours', () => {
  const r = T.evaluate({ rec: day('09:00', '14:00'), pattern: OFFICE, type: 'holiday', rules: rules() });
  assert.equal(r.buckets.holidayIn, 300);
  assert.equal(r.buckets.holiday, 0);
  const long = T.evaluate({ rec: day('08:00', '20:00'), pattern: OFFICE, type: 'holiday', rules: rules() });
  assert.equal(long.buckets.holidayIn, 480);
  assert.equal(long.buckets.holiday, 180);
});

test('rounding: down to 15 minutes or to the nearest 30', () => {
  assert.equal(T.roundOT(140, 15, 'down'), 135);
  assert.equal(T.roundOT(130, 30, 'nearest'), 120);
  assert.equal(T.roundOT(140, 30, 'nearest'), 150);
  assert.equal(T.roundOT(140, 0), 140);
  assert.equal(ev(day('09:00', '20:20'), { round: 30, roundMode: 'nearest' }).buckets.normal, 150);
});

test('daily minimum and maximum overtime', () => {
  // 25 minutes rounds to 15, below the 30-minute minimum.
  assert.equal(ev(day('09:00', '18:25')).buckets.normal, 0);
  // 5 h 30 min is capped at 4 hours.
  assert.equal(ev(day('09:00', '23:30')).buckets.normal, 240);
  assert.equal(ev(day('09:00', '23:30'), { maxDayMin: 0 }).buckets.normal, 330);
});

test('monthly maximum trims the latest days first and the 104-hour warning', () => {
  const d = (n, normal) => ({ day: `2026-10-${String(n).padStart(2, '0')}`, buckets: { normal, restIn: 0, rest: 0, holidayIn: 0, holiday: 0, night: 0 } });
  const capped = T.capMonth([d(1, 120), d(2, 120)], rules({ maxMonthH: 3 }));
  assert.equal(capped.total, 180);
  assert.equal(capped.days[0].buckets.normal, 120);
  assert.equal(capped.days[1].buckets.normal, 60);
  assert.equal(capped.trimmed, 60);
  const many = Array.from({ length: 27 }, (_, i) => d(i + 1, 240)); // 108 hours
  assert.equal(T.capMonth(many, rules()).warn, true);
  assert.equal(T.capMonth(many.slice(0, 26), rules()).warn, false); // 104 hours exactly
  const low = T.capMonth([d(1, 60)], rules({ minMonthH: 2 }));
  assert.equal(low.belowMin, true);
  assert.equal(low.total, 0);
});

test('overtime offsets lateness on the same day', () => {
  const r = ev(day('09:30', '19:30'), { offset: true });
  assert.equal(r.offset, 30);
  assert.equal(r.late, 0);
  assert.equal(r.buckets.normal, 60);
  const off = ev(day('09:30', '19:30'));
  assert.equal(off.late, 30);
  assert.equal(off.buckets.normal, 90);
});

test('pre-approval: only the approved minutes are paid', () => {
  const r = ev(day('09:00', '20:00'), { preApproval: true }, { approvedMin: 60 });
  assert.equal(r.buckets.normal, 60);
  assert.equal(r.unapproved, 60);
  assert.equal(ev(day('09:00', '20:00'), { preApproval: true }).buckets.normal, 0);
  const rest = T.evaluate({ rec: day('09:00', '13:00'), pattern: OFFICE, type: 'rest', rules: rules({ preApproval: true }), approvedMin: 120 });
  assert.equal(rest.buckets.restIn, 120);
});

test('dinner break is taken off long overtime', () => {
  assert.equal(ev(day('09:00', '21:00'), { dinner: true, maxDayMin: 0 }).buckets.normal, 150);
  assert.equal(ev(day('09:00', '20:00'), { dinner: true }).buckets.normal, 120);
});

test('a different rate after midnight', () => {
  const r = ev(day('09:00', '01:30'), { night: 2, maxDayMin: 0 });
  assert.equal(r.buckets.night, 90);
  assert.equal(r.buckets.normal, 360);
  // Without a night rate everything stays at the day's rate.
  assert.equal(ev(day('09:00', '01:30'), { maxDayMin: 0 }).buckets.normal, 450);
});

test('night shift across midnight: lateness and overtime', () => {
  const late = T.evaluate({ rec: day('00:10', '07:00'), pattern: NIGHT, type: 'normal', rules: rules() });
  assert.equal(late.late, 130);
  const ot = T.evaluate({ rec: day('21:55', '09:10'), pattern: NIGHT, type: 'normal', rules: rules() });
  assert.equal(ot.late, 0);
  assert.equal(ot.buckets.normal, 120);
});

test('flexible pattern: core hours and required hours', () => {
  const f = (i, o) => T.evaluate({ rec: day(i, o), pattern: FLEX, type: 'normal', rules: rules() });
  deq([f('08:00', '17:00').late, f('08:00', '17:00').early, f('08:00', '17:00').short], [0, 0, 0]);
  assert.equal(f('10:20', '19:00').late, 20);
  assert.equal(f('08:00', '15:30').early, 30);
  assert.equal(f('08:00', '15:30').short, 90);
  assert.equal(f('08:00', '19:00').buckets.normal, 120);
  // Starting before the window opens: the day is counted from 07:00.
  assert.equal(f('06:30', '16:00').buckets.normal, 0);
});

test('auto-shift picks the pattern whose start is closest to the check-in', () => {
  const list = [MORNING, OFFICE, EVENING, NIGHT, FLEX];
  assert.equal(T.autoShift(list, '08:10').id, 'p-office');
  assert.equal(T.autoShift(list, '06:20').id, 'p-am');
  assert.equal(T.autoShift(list, '14:40').id, 'p-pm');
  // Across midnight: 00:30 is 2.5 h after the night shift's 22:00, and 6.5 h before 07:00.
  assert.equal(T.autoShift(list, '00:30').id, 'p-night');
  // A tie goes to the first pattern in the list.
  assert.equal(T.autoShift(list, '08:00').id, 'p-am');
  assert.equal(T.autoShift([FLEX], '08:00'), null);
  assert.equal(T.autoShift(list, ''), null);
});

test('which pattern applies: roster, then the person, then the department', () => {
  const cfg = { patterns: [OFFICE, MORNING, NIGHT], autoShift: true };
  const mon = '2026-10-19', sun = '2026-10-25';
  assert.equal(T.resolveDay({ day: mon, roster: 'p-night', empPattern: 'p-am', deptPattern: 'p-office', cfg }).pattern.id, 'p-night');
  assert.equal(T.resolveDay({ day: mon, empPattern: 'p-am', deptPattern: 'p-office', cfg }).pattern.id, 'p-am');
  assert.equal(T.resolveDay({ day: mon, deptPattern: 'p-office', cfg }).source, 'department');
  assert.equal(T.resolveDay({ day: mon, roster: 'off', deptPattern: 'p-office', cfg }).type, 'rest');
  // Sunday is outside the office pattern's working days.
  assert.equal(T.resolveDay({ day: sun, deptPattern: 'p-office', cfg }).type, 'rest');
  // No pattern: auto-shift from the check-in, and the company rest days decide the day type.
  const auto = T.resolveDay({ day: mon, rec: { s: 'present', in: '06:50' }, cfg });
  deq([auto.source, auto.pattern.id, auto.type], ['auto', 'p-am', 'normal']);
  assert.equal(T.resolveDay({ day: sun, rec: { s: 'present', in: '09:00' }, cfg, companyRest: true }).type, 'rest');
  assert.equal(T.resolveDay({ day: mon, deptPattern: 'p-office', cfg, holiday: true }).type, 'holiday');
  assert.equal(T.resolveDay({ day: mon, rec: { s: 'present', in: '09:00' }, cfg: { ...cfg, autoShift: false } }).pattern, null);
});

test('allowances: full, partial or forfeit when late or absent, and day-type rates', () => {
  const [att, meal, transport] = T.defaultAllowances(true);
  assert.equal(T.allowanceFor(att, { status: 'present' }).amount, 5);
  deq(T.allowanceFor(att, { status: 'present', late: 15 }), { amount: 0, rate: 5, outcome: 'forfeit', reason: 'Late' });
  assert.equal(T.allowanceFor(transport, { status: 'present', late: 15 }).amount, 4);
  assert.equal(T.allowanceFor(transport, { status: 'present', late: 15 }).outcome, 'partial');
  assert.equal(T.allowanceFor(meal, { status: 'present', late: 15, type: 'rest' }).amount, 15);
  assert.equal(T.allowanceFor(att, { status: 'absent' }).outcome, 'forfeit');
  assert.equal(T.allowanceFor(att, { status: '' }).outcome, 'forfeit');
  assert.equal(T.allowanceFor(att, { status: '', scheduled: false }).outcome, 'none');
  assert.equal(T.allowanceFor(att, { status: 'leave' }).outcome, 'none');
  assert.equal(T.allowanceFor(transport, { status: 'remote' }).outcome, 'none');
  assert.equal(T.allowanceFor(att, { status: 'remote' }).amount, 5);
  assert.equal(T.allowanceFor(meal, { status: 'present' }).outcome, 'none'); // no weekday meal rate
  assert.equal(T.allowanceFor(transport, { status: 'present', type: 'holiday' }).amount, 10);
  assert.equal(T.allowanceFor({ ...att, on: false }, { status: 'present' }).amount, 0);
  const shift = { ...att, id: 'al-night', kind: 'shift', weekday: 15, late: 'full', patterns: ['p-night'] };
  assert.equal(T.allowanceFor(shift, { status: 'present', patternId: 'p-night' }).amount, 15);
  assert.equal(T.allowanceFor(shift, { status: 'present', patternId: 'p-office' }).amount, 0);
});

test('overtime pay: monthly basic ÷ 26 ÷ normal hours × rate', () => {
  const R = rules();
  assert.equal(T.hourlyRate(2600, R), 12.5);
  assert.equal(T.otPay({ normal: 120 }, 2600, R).amount, 37.5);
  assert.equal(T.otPay({ restIn: 480, rest: 60 }, 2600, R).amount, 125);
  assert.equal(T.otPay({ holidayIn: 480, holiday: 60 }, 2600, R).amount, 237.5);
  assert.equal(T.otPay({ night: 60 }, 2600, rules({ night: 2 })).amount, 25);
  // Editable divisor and normal hours.
  assert.equal(T.hourlyRate(2600, rules({ divisor: 26, normalHours: 10 })), 10);
  // Flat rate: RM10 an hour for every bucket.
  assert.equal(T.otPay({ normal: 90, rest: 60 }, 2600, rules({ flat: true, flatRate: 10 })).amount, 25);
  // Above the wage limit for overtime: nothing paid.
  assert.equal(T.otPay({ normal: 120 }, 5000, rules({ eligibleMax: 4000 })).ineligible, true);
});

test('payroll add-ons: overtime and allowances follow their EPF, SOCSO and tax flags', () => {
  const s = { currency: 'MYR', taxRate: 8, benefitsRate: 0, statutory: { ...U.STATUTORY, hrdf: 0 } };
  const e = { birthday: '1990-01-01' };
  const plain = U.payCalc(36000, 0, s, e, '2026-10-31');
  const withOT = U.payCalc(36000, 0, s, e, '2026-10-31', { extra: [{ amount: 200, epf: false, socso: true, tax: true }] });
  assert.equal(withOT.gross, 3200);
  assert.equal(withOT.extras, 200);
  assert.equal(withOT.epf, plain.epf); // overtime is not EPF wages by default
  assert.ok(withOT.socso >= plain.socso);
  assert.ok(withOT.tax >= plain.tax);
  const withAllow = U.payCalc(36000, 0, s, e, '2026-10-31', { extra: [{ amount: 100, epf: true, socso: true, tax: false }] });
  assert.equal(withAllow.epf, Math.ceil(3100 * 0.11));
  assert.equal(withAllow.tax, plain.tax);
  assert.equal(U.payCalc(36000, 0, s, e, '2026-10-31', { extra: [] }).gross, plain.gross);
});

test('copy last week and rotating roster templates', () => {
  const rosters = { '2026-10-12': { a: 'p-am', b: 'off' }, '2026-10-13': { a: 'p-pm' } };
  const c = T.copyWeek(rosters, '2026-10-12', '2026-10-19', ['a', 'b']);
  deq(c['2026-10-19'], { a: 'p-am', b: 'off' });
  deq(c['2026-10-20'], { a: 'p-pm' });
  assert.equal(Object.keys(c).length, 7);
  const tpl = { weeks: [Array(7).fill('p-am'), Array(7).fill('p-pm')] };
  const out = T.applyTemplate(tpl, { monday: '2026-10-19', weeks: 2, empIds: ['a', 'b'] });
  deq([out['2026-10-19'].a, out['2026-10-19'].b, out['2026-10-26'].a, out['2026-10-26'].b], ['p-am', 'p-pm', 'p-pm', 'p-am']);
  const same = T.applyTemplate(tpl, { monday: '2026-10-19', empIds: ['a', 'b'], stagger: false, startWeek: 1 });
  deq([same['2026-10-19'].a, same['2026-10-19'].b], ['p-pm', 'p-pm']);
  assert.equal(T.mondayOf('2026-10-25'), '2026-10-19');
});

test('overlapping shifts: a night shift running into the next morning', () => {
  const pats = [MORNING, NIGHT, EVENING];
  deq(T.overlaps({ '2026-10-19': 'p-night', '2026-10-20': 'p-am' }, pats), []);
  deq(T.overlaps({ '2026-10-19': 'p-night', '2026-10-20': 'p-night' }, pats), []);
  const night2am = { ...NIGHT, end: '08:00' };
  deq(T.overlaps({ '2026-10-19': 'p-night', '2026-10-20': 'p-am' }, [MORNING, night2am]), ['2026-10-20']);
  deq(T.overlaps({ '2026-10-19': 'p-pm', '2026-10-20': 'off' }, pats), []);
});

test('audit diff and batch edit plan', () => {
  deq(T.diff({ s: 'present', in: '09:00' }, { s: 'present', in: '08:30', out: '18:00' }), [{ field: 'in', from: '09:00', to: '08:30' }, { field: 'out', from: '', to: '18:00' }]);
  deq(T.diff({ s: 'absent', in: '' }, { s: 'absent', in: '' }), []);
  const recs = { '2026-10-19|a': { s: 'present', in: '09:05' } };
  const plan = T.batchPlan({ from: '2026-10-19', to: '2026-10-21', empIds: ['a', 'b'], set: { s: 'present', in: '09:00', out: '18:00' }, get: (d, id) => recs[`${d}|${id}`], isWorking: (d) => d !== '2026-10-20' });
  assert.equal(plan.length, 4);
  deq(plan[0].after, { s: 'present', in: '09:00', out: '18:00' });
  const empty = T.batchPlan({ from: '2026-10-19', to: '2026-10-19', empIds: ['a', 'b'], set: { s: 'absent' }, onlyEmpty: true, get: (d, id) => recs[`${d}|${id}`] });
  deq(empty.map((x) => [x.empId, x.after]), [['b', { s: 'absent', in: '', out: '' }]]);
});
