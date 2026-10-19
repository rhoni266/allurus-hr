// Unit tests for the leave rules: day counting, state weekends, holidays, half days, entitlement and
// pro-rating, balances with carry-forward and expiry, approval chains and the unpaid-leave deduction.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'leave-rules.js'), 'utf8'), sandbox);
const R = sandbox.window.AllurusLeaveRules;

const SAT_SUN = { weekend: R.WEEKENDS['sat-sun'], holidays: new Set() };
const FRI_SAT = { weekend: R.WEEKENDS['fri-sat'], holidays: new Set() };
// Values built inside the vm sandbox have that realm's prototypes; compare plain copies.
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const typeOf = (id, patch = {}) => ({ ...R.defaultTypes().find((t) => t.id === id), ...patch });

test('working days skip a Saturday–Sunday weekend', () => {
  // Mon 19 Oct 2026 to Sun 25 Oct 2026
  const r = R.countDays({ from: '2026-10-19', to: '2026-10-25' }, SAT_SUN);
  assert.equal(r.days, 5);
  deq(r.skipped.map((s) => s.date), ['2026-10-24', '2026-10-25']);
});

test('Terengganu-style Friday–Saturday weekend counts Sunday as a working day', () => {
  const r = R.countDays({ from: '2026-10-19', to: '2026-10-25' }, FRI_SAT);
  assert.equal(r.days, 5);
  deq(r.skipped.map((s) => s.date), ['2026-10-23', '2026-10-24']);
  assert.equal(R.stateWeekend('Terengganu'), 'fri-sat');
  assert.equal(R.stateWeekend('Kelantan'), 'fri-sat');
  assert.equal(R.stateWeekend('Kedah'), 'fri-sat');
  assert.equal(R.stateWeekend('Selangor'), 'sat-sun');
  assert.equal(R.stateWeekend('Johor'), 'sat-sun');
});

test('public holidays are not counted', () => {
  const ctx = R.calendarCtx({ state: 'Selangor', weekend: 'sat-sun', replacement: false }, '2026-08-24', '2026-09-18');
  // Mon 24 Aug – Fri 28 Aug includes Maulidur Rasul on Tue 25 Aug
  assert.equal(R.countDays({ from: '2026-08-24', to: '2026-08-28' }, ctx).days, 4);
  // Mon 31 Aug (National Day) to Wed 2 Sep
  assert.equal(R.countDays({ from: '2026-08-31', to: '2026-09-02' }, ctx).days, 2);
  const r = R.countDays({ from: '2026-09-14', to: '2026-09-18' }, ctx);
  assert.equal(r.days, 4);
  deq(r.skipped, [{ date: '2026-09-16', why: 'holiday' }]);
});

test('state rules: Terengganu gets its own holidays and skips non-Terengganu ones', () => {
  const t = R.holidaysFor(2026, { state: 'Terengganu', replacement: false }).map((h) => h.name);
  assert.ok(t.includes('Birthday of the Sultan of Terengganu'));
  assert.ok(t.includes('Hari Arafah'));
  assert.ok(!t.includes('New Year’s Day'));
  assert.ok(!t.includes('Thaipusam'));
  const s = R.holidaysFor(2026, { state: 'Selangor', replacement: false }).map((h) => h.name);
  assert.ok(s.includes('Thaipusam') && s.includes('New Year’s Day'));
  assert.ok(!s.includes('Hari Arafah'));
  assert.ok(!R.holidaysFor(2026, { state: 'Sarawak' }).some((h) => h.name === 'Deepavali'));
});

test('a holiday on a rest day adds the next working day as a replacement holiday', () => {
  // Deepavali, Sun 8 Nov 2026: Selangor rests on Sunday, so Monday 9 Nov is the replacement.
  const sel = R.holidaysFor(2026, { state: 'Selangor', weekend: 'sat-sun' });
  assert.ok(sel.some((h) => h.kind === 'replacement' && h.date === '2026-11-09'));
  // In Terengganu Sunday is a working day: no replacement for Deepavali.
  const trg = R.holidaysFor(2026, { state: 'Terengganu', weekend: 'fri-sat' });
  assert.ok(!trg.some((h) => h.kind === 'replacement' && h.name.includes('Deepavali')));
  // Aidilfitri day 1 is Sat 21 Mar (a Terengganu rest day); Sun 22 Mar is already a holiday, so the replacement is Mon 23 Mar.
  assert.ok(trg.some((h) => h.kind === 'replacement' && h.date === '2026-03-23'));
  // Switched off: no replacement days
  assert.ok(!R.holidaysFor(2026, { state: 'Selangor', weekend: 'sat-sun', replacement: false }).some((h) => h.kind === 'replacement'));
});

test('switched-off and company holidays', () => {
  const cfg = { state: 'Selangor', weekend: 'sat-sun', replacement: false, holidaysOff: ['2026-09-16'], holidaysCustom: [{ date: '2026-12-24', name: 'Company year-end day' }] };
  const set = R.holidaySet(cfg, '2026-01-01', '2026-12-31');
  assert.ok(!set.has('2026-09-16'));
  assert.ok(set.has('2026-12-24'));
});

test('half days count 0.5 on a working day and 0 on a rest day', () => {
  assert.equal(R.countDays({ from: '2026-10-19', to: '2026-10-19', half: 'AM' }, SAT_SUN).days, 0.5);
  assert.equal(R.countDays({ from: '2026-10-19', to: '2026-10-19', half: 'PM' }, FRI_SAT).days, 0.5);
  assert.equal(R.countDays({ from: '2026-10-23', to: '2026-10-23', half: 'AM' }, FRI_SAT).days, 0);
  // Half is ignored for multi-day requests
  assert.equal(R.countDays({ from: '2026-10-19', to: '2026-10-20', half: 'AM' }, SAT_SUN).days, 2);
});

test('calendar-day types count every day (maternity 98 days)', () => {
  const r = R.countDays({ from: '2026-11-02', to: R.addDays('2026-11-02', 97), calendar: true }, SAT_SUN);
  assert.equal(r.days, 98);
  assert.equal(R.countDays({ from: '2026-10-19', to: '2026-10-25', calendar: true }, SAT_SUN).days, 7);
});

test('service tiers follow the Employment Act minimums', () => {
  const annual = typeOf('annual', { prorate: false });
  assert.equal(R.entitlement(annual, { start: '2025-03-01' }, 2026), 8);
  assert.equal(R.entitlement(annual, { start: '2023-06-01' }, 2026), 12);
  assert.equal(R.entitlement(annual, { start: '2019-01-01' }, 2026), 16);
  const sick = typeOf('sick');
  assert.equal(R.entitlement(sick, { start: '2025-03-01' }, 2026), 14);
  assert.equal(R.entitlement(sick, { start: '2023-06-01' }, 2026), 18);
  assert.equal(R.entitlement(sick, { start: '2015-06-01' }, 2026), 22);
  assert.equal(R.entitlement(typeOf('unpaid'), { start: '2020-01-01' }, 2026), Infinity);
});

test('pro-rating for new joiners rounds half a day up', () => {
  const annual = typeOf('annual', { byService: false, days: 12 });
  assert.equal(R.monthsInYear('2026-03-01', 2026), 10);
  assert.equal(R.monthsInYear('2026-03-15', 2026), 9);
  assert.equal(R.monthsInYear('2025-03-15', 2026), 12);
  assert.equal(R.monthsInYear('2027-01-01', 2026), 0);
  assert.equal(R.entitlement(annual, { start: '2026-03-01' }, 2026), 10);
  assert.equal(R.entitlement(annual, { start: '2026-03-15' }, 2026), 9);
  // 8 days × 7/12 = 4.67 → 5
  assert.equal(R.entitlement(typeOf('annual'), { start: '2026-06-01' }, 2026), 5);
  // 8 × 3/12 = 2.0, 8 × 1/12 = 0.67 → 1
  assert.equal(R.entitlement(typeOf('annual'), { start: '2026-10-01' }, 2026), 2);
  assert.equal(R.entitlement(typeOf('annual'), { start: '2026-12-01' }, 2026), 1);
  assert.equal(R.entitlement(typeOf('annual'), { start: '2027-02-01' }, 2026), 0);
});

test('eligibility: gender, marriage and minimum service', () => {
  const mat = typeOf('maternity'), pat = typeOf('paternity');
  assert.equal(R.eligible(mat, { gender: 'female', start: '2024-01-01' }, '2026-10-19').ok, true);
  assert.equal(R.eligible(mat, { gender: 'male', start: '2024-01-01' }, '2026-10-19').ok, false);
  assert.equal(R.eligible(pat, { gender: 'male', married: true, start: '2024-01-01' }, '2026-10-19').ok, true);
  assert.match(R.eligible(pat, { gender: 'male', married: false, start: '2024-01-01' }, '2026-10-19').reason, /married/);
  assert.match(R.eligible(pat, { gender: 'male', married: true, start: '2026-03-01' }, '2026-10-19').reason, /12 months/);
  assert.match(R.eligible(mat, { gender: '', start: '2024-01-01' }, '2026-10-19').reason, /gender/);
});

test('balances: pooled emergency leave, hospitalisation includes sick days, pending reduces available', () => {
  const types = R.defaultTypes();
  const emp = { id: 'e1', start: '2018-01-01' };
  const leaves = [
    { empId: 'e1', type: 'annual', from: '2026-02-02', to: '2026-02-04', days: 3, status: 'Approved' },
    { empId: 'e1', type: 'emergency', from: '2026-05-04', to: '2026-05-04', days: 0.5, status: 'Approved' },
    { empId: 'e1', type: 'annual', from: '2026-11-02', to: '2026-11-03', days: 2, status: 'Pending' },
    { empId: 'e1', type: 'sick', from: '2026-03-02', to: '2026-03-03', days: 2, status: 'Approved' },
    { empId: 'e1', type: 'annual', from: '2025-12-01', to: '2025-12-02', days: 2, status: 'Approved' },
  ];
  const annual = R.balance({ type: types[0], types, emp, year: 2026, leaves, today: '2026-10-19' });
  assert.equal(annual.entitled, 16); assert.equal(annual.used, 3.5); assert.equal(annual.pending, 2); assert.equal(annual.available, 10.5);
  const emergency = R.balance({ type: types.find((t) => t.id === 'emergency'), types, emp, year: 2026, leaves, today: '2026-10-19' });
  assert.equal(emergency.available, 10.5, 'emergency shows the annual balance');
  const hosp = R.balance({ type: types.find((t) => t.id === 'hospital'), types, emp, year: 2026, leaves, today: '2026-10-19' });
  assert.equal(hosp.available, 58);
  const repl = R.balance({ type: types.find((t) => t.id === 'replacement'), types, emp, year: 2026, leaves: [], credits: 2, today: '2026-10-19' });
  assert.equal(repl.available, 2);
});

test('carry-forward: used before expiry, then the rest lapses', () => {
  const types = R.defaultTypes(), t = types[0];
  const emp = { id: 'e2', start: '2020-01-01' };
  const carry = { days: 4, expires: '2026-06-30' };
  const leaves = [{ empId: 'e2', type: 'annual', from: '2026-03-10', to: '2026-03-11', days: 2, status: 'Approved' }];
  const before = R.balance({ type: t, types, emp, year: 2026, leaves, carry, today: '2026-05-01' });
  assert.equal(before.lapsed, 0); assert.equal(before.available, 16 + 4 - 2);
  const after = R.balance({ type: t, types, emp, year: 2026, leaves, carry, today: '2026-10-19' });
  assert.equal(after.lapsed, 2); assert.equal(after.available, 16 + 2 - 2);
  const late = [{ empId: 'e2', type: 'annual', from: '2026-08-03', to: '2026-08-05', days: 3, status: 'Approved' }];
  const allLapsed = R.balance({ type: t, types, emp, year: 2026, leaves: late, carry, today: '2026-10-19' });
  assert.equal(allLapsed.lapsed, 4); assert.equal(allLapsed.available, 13);
});

test('year-end job carries unused days up to the limit with an expiry date', () => {
  const types = R.defaultTypes();
  const employees = [{ id: 'a', start: '2015-01-01' }, { id: 'b', start: '2015-01-01' }, { id: 'c', start: '2015-01-01' }];
  const leaves = [
    { empId: 'a', type: 'annual', from: '2026-02-02', to: '2026-02-13', days: 14, status: 'Approved' },
    { empId: 'b', type: 'annual', from: '2026-02-02', to: '2026-02-03', days: 2, status: 'Approved' },
    { empId: 'c', type: 'annual', from: '2026-02-02', to: '2026-02-24', days: 16, status: 'Approved' },
  ];
  const rows = R.carryForward({ types, employees, leaves, year: 2026 });
  const a = rows.find((r) => r.empId === 'a'), b = rows.find((r) => r.empId === 'b');
  deq([a.unused, a.carry, a.forfeited, a.expires], [2, 2, 0, '2027-06-30']);
  deq([b.unused, b.carry, b.forfeited], [14, 5, 9]);
  assert.ok(!rows.some((r) => r.empId === 'c'), 'nothing to carry when all days were used');
  assert.ok(rows.every((r) => r.typeId === 'annual'), 'only types with a carry limit');
  const noExpiry = R.carryForward({ types: [{ ...types[0], carryExpiry: 0 }], employees: [employees[1]], leaves, year: 2026 });
  assert.equal(noExpiry[0].expires, '2027-12-31');
});

test('approval chain: three levels, skips self-approval and duplicates, backups act while the approver is away', () => {
  const chain = R.buildChain({ applicant: 'e13', chain: { l1: 'e9', l1b: 'e14', l2: 'e14', l2b: 'e11' }, hr: 'e1', hrBackup: 'e15' });
  deq(chain.map((s) => [s.level, s.approver, s.status]), [['L1', 'e9', 'pending'], ['L2', 'e14', 'pending'], ['Final', 'e1', 'pending']]);
  // Department head applying: L1 is skipped
  const head = R.buildChain({ applicant: 'e4', chain: { l1: 'e4', l1b: 'e2' }, hr: 'e1', hrBackup: 'e15' });
  deq(head.map((s) => s.status), ['skipped', 'pending']);
  // HR applying: HR backup approves the final step
  const hr = R.buildChain({ applicant: 'e1', chain: { l1: 'e1' }, hr: 'e1', hrBackup: 'e15' });
  deq(hr.map((s) => [s.status, s.approver]), [['skipped', 'e1'], ['pending', 'e15']]);
  // Same person at L1 and Final: second step skipped
  const dup = R.buildChain({ applicant: 'e15', chain: { l1: 'e1' }, hr: 'e1' });
  deq(dup.map((s) => s.status), ['pending', 'skipped']);
  // Backup can act only while the approver is away
  const step = R.nextStep(chain);
  assert.equal(R.canAct(step, 'e9', () => false), 'approver');
  assert.equal(R.canAct(step, 'e14', () => false), '');
  assert.equal(R.canAct(step, 'e14', (id) => id === 'e9'), 'backup');
});

test('decisions move through the chain', () => {
  let chain = R.buildChain({ applicant: 'e13', chain: { l1: 'e9', l2: 'e14' }, hr: 'e1' });
  let r = R.decide(chain, { by: 'e9', approve: true, at: '2026-10-19' });
  assert.equal(r.status, 'Pending'); assert.equal(R.nextStep(r.chain).level, 'L2');
  r = R.decide(r.chain, { by: 'e14', approve: true, at: '2026-10-19' });
  r = R.decide(r.chain, { by: 'e1', approve: true, at: '2026-10-19' });
  assert.equal(r.status, 'Approved'); assert.equal(R.nextStep(r.chain), null);
  chain = R.buildChain({ applicant: 'e13', chain: { l1: 'e9', l2: 'e14' }, hr: 'e1' });
  r = R.decide(chain, { by: 'e9', approve: false, note: 'Busy month', at: '2026-10-19' });
  assert.equal(r.status, 'Rejected');
  deq(r.chain.map((s) => s.status), ['rejected', 'cancelled', 'cancelled']);
});

test('unpaid leave deduction: basic ÷ divisor × days', () => {
  const ctx = R.calendarCtx({ state: 'Selangor', weekend: 'sat-sun', replacement: false }, '2026-10-01', '2026-10-31');
  assert.equal(R.workingDaysInMonth('2026-10', ctx), 22);
  assert.equal(R.divisor('working', '2026-10', ctx), 22);
  assert.equal(R.divisor('26', '2026-10', ctx), 26);
  assert.equal(R.divisor('calendar', '2026-10', ctx), 31);
  assert.equal(R.unpaidDeduction({ base: 4400, days: 2, divisor: 22 }), 400);
  assert.equal(R.unpaidDeduction({ base: 5200, days: 1.5, divisor: 26 }), 300);
  assert.equal(R.unpaidDeduction({ base: 3000, days: 40, divisor: 22 }), 3000, 'never more than the basic');
  assert.equal(R.unpaidDeduction({ base: 3000, days: 0, divisor: 22 }), 0);
  // Fri–Sat weekend month, and a leave split across two months
  const trg = R.calendarCtx({ state: 'Terengganu', weekend: 'fri-sat', replacement: false }, '2026-10-01', '2026-11-30');
  assert.equal(R.workingDaysInMonth('2026-10', trg), 21, 'October 2026 has 5 Fridays and 5 Saturdays');
  // Thu 29 Oct – Tue 3 Nov: Fri 30 and Sat 31 are rest days, Sun 1 Nov is a working day in Terengganu
  const leave = { from: '2026-10-29', to: '2026-11-03', half: '' };
  assert.equal(R.countDaysInMonth(leave, '2026-10', trg), 1);
  assert.equal(R.countDaysInMonth(leave, '2026-11', trg), 3);
  assert.equal(R.countDaysInMonth({ from: '2026-10-19', to: '2026-10-19', half: 'PM' }, '2026-10', trg), 0.5);
});
