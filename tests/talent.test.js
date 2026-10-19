// Unit tests for the talent rules: hiring analytics, careers applications, scorecards, interview and room
// conflicts, mandatory courses, quiz scoring, course status and certificate expiry, and grievance SLAs.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'talent-rules.js'), 'utf8'), sandbox);
const R = sandbox.window.AllurusTalentRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

test('hiring analytics: time to hire, sources and stage conversion', () => {
  const c = (stage, applied, source, extra = {}) => ({ stage, applied, source, stageDates: { Applied: applied }, ...extra });
  const list = [
    c('Hired', '2026-08-01', 'Referral', { hiredOn: '2026-08-31' }),
    c('Hired', '2026-08-10', 'Careers page', { stageDates: { Applied: '2026-08-10', Hired: '2026-09-29' } }),
    c('Offer', '2026-09-01', 'LinkedIn'),
    c('Interview', '2026-09-05', 'Careers page'),
    c('Screening', '2026-09-07', 'LinkedIn', { rejected: true }),
    c('Applied', '2026-09-20', 'Careers page'),
    c('Applied', '2025-01-01', 'Agency'),
  ];
  const a = R.hiringAnalytics(list, { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(a.total, 6);
  assert.equal(a.hires, 2);
  deq(a.timeToHire, { avg: 40, median: 40, min: 30, max: 50 });
  deq(a.bySource.map((s) => [s.source, s.candidates, s.hires, s.hireRate]), [['Careers page', 3, 1, 33.33], ['LinkedIn', 2, 0, 0], ['Referral', 1, 1, 100]]);
  deq(a.funnel.map((f) => [f.stage, f.count, f.fromPrev]), [['Applied', 6, 100], ['Screening', 5, 83.33], ['Interview', 4, 80], ['Offer', 3, 75], ['Hired', 2, 66.67]]);
  assert.equal(R.hiringAnalytics([], {}).timeToHire.avg, null);
});

test('careers applications need a name, email and PDPA consent', () => {
  deq(R.applicationProblems({ name: ' ', email: 'x', consent: false }).map((p) => p.field), ['name', 'email', 'consent']);
  deq(R.applicationProblems({ name: 'Nur Aisyah', email: 'aisyah@mail.com', phone: '12', consent: true }).map((p) => p.field), ['phone']);
  deq(R.applicationProblems({ name: 'Nur Aisyah', email: 'aisyah@mail.com', phone: '012-345 6789', consent: true }), []);
});

test('scorecards: averages per criterion and recommendations', () => {
  const s = R.scorecardSummary({ e1: { scores: { Skills: 4, Communication: 5 }, recommend: 'Yes' }, e4: { scores: { Skills: 3, Communication: 4 }, recommend: 'Strong yes' }, e9: null }, ['Skills', 'Communication', 'Culture']);
  assert.equal(s.count, 2);
  assert.equal(s.overall, 4);
  deq(s.byCrit, [{ criterion: 'Skills', avg: 3.5 }, { criterion: 'Communication', avg: 4.5 }, { criterion: 'Culture', avg: null }]);
  deq(s.recommend, { Yes: 1, 'Strong yes': 1 });
});

test('time slots, room conflicts and booking checks', () => {
  assert.equal(R.overlaps({ date: 'd', start: '09:00', end: '10:00' }, { date: 'd', start: '09:30', end: '11:00' }), true);
  assert.equal(R.overlaps({ date: 'd', start: '09:00', end: '10:00' }, { date: 'd', start: '10:00', end: '11:00' }), false, 'back to back is fine');
  assert.equal(R.overlaps({ date: 'd', start: '09:00', end: '10:00' }, { date: 'e', start: '09:00', end: '10:00' }), false);
  const rooms = [{ id: 'r1', name: 'Kenyir', capacity: 6 }, { id: 'r2', name: 'Tasik', capacity: 12 }];
  const bookings = [{ id: 'b1', roomId: 'r1', date: '2026-10-20', start: '10:00', end: '11:00', title: 'Sprint review' }, { id: 'b2', roomId: 'r1', date: '2026-10-20', start: '14:00', end: '15:00', status: 'Cancelled' }];
  const b = { roomId: 'r1', date: '2026-10-20', start: '10:30', end: '11:30', people: 8 };
  deq(R.bookingProblems(b, { rooms, bookings }), ['Kenyir seats 6', 'Kenyir is booked 10:00–11:00 (Sprint review)']);
  deq(R.bookingProblems({ ...b, start: '14:00', end: '15:00', people: 4 }, { rooms, bookings }), [], 'a cancelled booking frees the slot');
  deq(R.bookingProblems({ ...b, roomId: 'r2' }, { rooms, bookings }), []);
  deq(R.bookingProblems({ ...b, roomId: 'r2', end: '10:00' }, { rooms, bookings }), ['The end must be after the start']);
  deq(R.bookingProblems({ ...b, roomId: 'r2', date: '2026-10-19', start: '08:00', end: '09:00' }, { rooms, bookings, now: '2026-10-19T10:00' }), ['That time has already passed']);
  // Editing a booking does not clash with itself.
  deq(R.roomConflicts(bookings, { ...bookings[0] }), []);
});

test('interview conflicts: another interview or leave', () => {
  const others = [{ id: 'i1', date: '2026-10-21', start: '10:00', end: '11:00', interviewers: ['e4', 'e2'] }, { id: 'i2', date: '2026-10-21', start: '10:00', end: '11:00', interviewers: ['e9'], status: 'Cancelled' }];
  const iv = { id: 'new', date: '2026-10-21', start: '10:30', end: '11:30', interviewers: ['e4', 'e9', 'e5'] };
  deq(R.interviewConflicts(iv, others, (id) => id === 'e5'), [{ empId: 'e4', reason: 'another interview 10:00–11:00' }, { empId: 'e5', reason: 'on leave' }]);
});

test('mandatory courses by everyone, department or job title', () => {
  const courses = [{ id: 'all', mandatory: { all: true } }, { id: 'eng', mandatory: { depts: ['d-eng'] } }, { id: 'mgr', mandatory: { roles: ['Manager', 'Head of'] } }, { id: 'opt', mandatory: null }, { id: 'old', active: false, mandatory: { all: true } }];
  deq(R.requiredFor({ dept: 'd-eng', role: 'Engineering Manager' }, courses).map((c) => c.id), ['all', 'eng', 'mgr']);
  deq(R.requiredFor({ dept: 'd-sales', role: 'Head of Sales' }, courses).map((c) => c.id), ['all', 'mgr']);
  deq(R.requiredFor({ dept: 'd-fin', role: 'Accountant' }, courses).map((c) => c.id), ['all']);
});

test('quiz scoring against the pass mark', () => {
  const quiz = { passMark: 70, questions: [{ id: 'a', answer: 1 }, { id: 'b', answer: 0 }, { id: 'c', answer: 2 }] };
  deq(R.scoreQuiz(quiz, { a: 1, b: 0, c: 1 }), { correct: 2, total: 3, pct: 67, passed: false });
  deq(R.scoreQuiz(quiz, { a: '1', b: '0', c: '2' }), { correct: 3, total: 3, pct: 100, passed: true });
  deq(R.scoreQuiz({ passMark: 0, questions: [] }, {}), { correct: 0, total: 0, pct: 100, passed: true });
});

test('course status, certificate expiry and compliance', () => {
  const course = { id: 'c1', modules: [{ id: 'm1' }, { id: 'm2' }], validMonths: 12, mandatory: { all: true } };
  assert.equal(R.certExpiry('2025-11-30T08:00:00Z', 12), '2026-11-30');
  assert.equal(R.certExpiry('2025-11-30', 0), '');
  const T = '2026-10-19';
  deq(R.courseStatus(course, null, T), { status: 'Not started', progress: 0 });
  deq(R.courseStatus(course, { done: ['m1'], due: '2026-11-01' }, T), { status: 'In progress', progress: 50 });
  deq(R.courseStatus(course, { done: ['m1'], due: '2026-10-01' }, T), { status: 'Overdue', progress: 50 });
  deq(R.courseStatus(course, { completedAt: '2025-11-30', expires: '2026-11-30' }, T), { status: 'Expiring', progress: 100, left: 42 });
  deq(R.courseStatus(course, { completedAt: '2025-01-30', expires: '2026-01-30' }, T), { status: 'Expired', progress: 100 });
  deq(R.courseStatus(course, { completedAt: '2026-09-30', expires: '2027-09-30' }, T), { status: 'Completed', progress: 100 });
  const enrol = [{ empId: 'a', courseId: 'c1', completedAt: '2026-09-30', expires: '2027-09-30' }, { empId: 'b', courseId: 'c1', completedAt: '2025-01-30', expires: '2026-01-30' }, { empId: 'b', courseId: 'c1', assigned: '2026-10-01', done: [] }];
  // A renewal assigned early keeps the valid certificate's status, with the renewal alongside.
  const early = [{ empId: 'c', courseId: 'c1', completedAt: '2025-11-30', expires: '2026-11-30' }, { empId: 'c', courseId: 'c1', assigned: '2026-10-15', done: ['m1'] }];
  deq(R.standing(course, early, 'c', T), { status: 'Expiring', progress: 100, left: 42, renewal: { status: 'In progress', progress: 50 } });
  deq(R.standing(course, enrol, 'b', T), { status: 'Not started', progress: 0 }, 'an expired certificate does not count');
  deq(R.compliance([{ id: 'c' }], [course], early, T).map((x) => [x.current, x.statuses.c1]), [[1, 'Expiring']]);
  deq(R.compliance([{ id: 'a' }, { id: 'b' }], [course], enrol, T).map((x) => [x.empId, x.current, x.pct, x.statuses.c1]), [['a', 1, 100, 'Completed'], ['b', 0, 0, 'Not started']], 'b’s certificate expired and the renewal is assigned');
});

test('grievance SLA: due dates, breaches and summary', () => {
  const sla = R.defaultSla();
  deq(R.slaDates('2026-10-01', 'High', sla), { ackDue: '2026-10-03', resolveDue: '2026-10-15' });
  const late = { created: '2026-10-01', priority: 'High', status: 'Investigating', ackAt: '2026-10-02' };
  const s = R.slaState(late, '2026-10-19', sla);
  deq({ ack: s.ackBreached, res: s.resolveBreached, left: s.daysLeft }, { ack: false, res: true, left: -4 });
  const ok = R.slaState({ created: '2026-10-10', priority: 'Normal', status: 'New' }, '2026-10-12', sla);
  deq({ ack: ok.ackBreached, res: ok.resolveBreached, left: ok.daysLeft }, { ack: false, res: false, left: 19 });
  assert.equal(R.slaState({ created: '2026-10-10', priority: 'Normal', status: 'New' }, '2026-10-14', sla).ackBreached, true);
  assert.equal(R.canMove('New', 'Acknowledged'), true);
  assert.equal(R.canMove('New', 'Resolved'), false);
  assert.equal(R.canMove('Resolved', 'Investigating'), true, 'reopen');
  const list = [
    { created: '2026-09-01', priority: 'Normal', status: 'Closed', category: 'Pay', resolvedAt: '2026-09-11' },
    { created: '2026-09-01', priority: 'Urgent', status: 'Resolved', category: 'Harassment', resolvedAt: '2026-09-20' },
    late,
    { created: '2026-10-15', priority: 'Low', status: 'New', category: 'Pay' },
  ].map((g) => ({ category: 'Manager', ...g }));
  const sum = R.grievanceSummary(list, '2026-10-19', sla);
  deq({ total: sum.total, open: sum.open, avg: sum.avgDaysToResolve, met: sum.slaMet, breached: sum.breachedOpen, pay: sum.byCategory.Pay }, { total: 4, open: 2, avg: 14.5, met: 50, breached: 1, pay: 2 });
  assert.ok(!JSON.stringify(sum).includes('empId'));
});
