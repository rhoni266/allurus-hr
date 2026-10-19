// Unit tests for the notification rules: messages, channel preferences, delivery, read state and reminders.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'notify-rules.js'), 'utf8'), sandbox);
const N = sandbox.window.AllurusNotifyRules;
let n = 0;
const ids = () => String(++n);

test('every type builds an in-app message and an email', () => {
  const data = { who: 'Daniel Reyes', kind: 'leave', summary: '2 days', by: 'Omar', month: '2026-10', count: 18, net: 'RM 134,842.24', title: 'Hari Raya open house', reason: 'Accuracy 0 m', date: '2026-11-01', left: 5, first: 'Daniel', years: 3, cycle: 'H2 2026', status: 'In progress', detail: 'x', week: '2026-10-19', company: 'Allurus' };
  Object.keys(N.TYPES).forEach((t) => {
    const m = N.build(t, data);
    assert.ok(m.title && m.body, t);
    assert.ok(N.CATEGORIES[m.cat], t);
    assert.match(m.subject, / · Allurus$/);
    assert.match(m.email, /^Hi there,/);
  });
  assert.throws(() => N.build('nope'), /Unknown/);
  assert.equal(N.build('request.approved', { kind: 'claim', summary: 'RM 171.40', by: 'Noah' }).title, 'Your claim (RM 171.40) was approved');
  assert.equal(N.build('reminder.contract', { who: 'Samuel A', date: '2026-11-18', left: 30 }).title, 'Samuel A’s contract ends in 30 days');
});

test('channel preferences: both, in-app, email, off, and defaults', () => {
  const d = N.defaultPrefs();
  assert.equal(d.requests, 'both');
  assert.equal(d.reminders, 'inapp');
  assert.deepEqual({ ...N.route({}, 'requests') }, { inApp: true, email: true });
  assert.deepEqual({ ...N.route({ pay: 'email' }, 'pay') }, { inApp: false, email: true });
  assert.deepEqual({ ...N.route({ pay: 'off' }, 'pay') }, { inApp: false, email: false });
  assert.deepEqual({ ...N.route(null, 'reminders') }, { inApp: true, email: false });
});

test('delivery follows each person’s preferences and skips the sender', () => {
  const people = [
    { id: 'e1', email: 'amara@x.my', first: 'Amara', prefs: {} },
    { id: 'e2', email: 'daniel@x.my', first: 'Daniel', prefs: { requests: 'inapp' } },
    { id: 'e3', email: 'sofia@x.my', first: 'Sofia', prefs: { requests: 'email' } },
    { id: 'e4', email: '', first: 'Omar', prefs: {} },
    { id: 'e5', email: 'p@x.my', first: 'Priya', prefs: { requests: 'off' } },
    { id: 'e1', email: 'amara@x.my', first: 'Amara', prefs: {} },
  ];
  const r = N.deliver('request.submitted', { who: 'Lucas', kind: 'claim', href: '#claims' }, people, { from: 'e2', at: '2026-10-19T10:00:00Z', ids });
  assert.equal(r.notifications.map((x) => x.to).join(), 'e1,e4');
  assert.equal(r.emails.map((x) => x.toId).join(), 'e1,e3');
  assert.equal(r.notifications[0].href, '#claims');
  assert.equal(r.emails[0].status, 'queued');
  assert.match(r.emails[0].body, /^Hi Amara,/);
  // Self-notifications (for example "Happy birthday") are allowed when asked for.
  assert.equal(N.deliver('reminder.birthday', { first: 'Daniel', self: true }, [people[1]], { from: 'e2', self: true, ids }).notifications.length, 1);
});

test('unread count, mark read and trimming', () => {
  const list = [{ id: 'a', to: 'e1', read: false, at: '3' }, { id: 'b', to: 'e1', read: false, at: '2' }, { id: 'c', to: 'e2', read: false, at: '1' }];
  assert.equal(N.unread(list, 'e1'), 2);
  assert.equal(N.unread(N.markRead(list, 'e1', 'a'), 'e1'), 1);
  const all = N.markRead(list, 'e1');
  assert.equal(N.unread(all, 'e1'), 0);
  assert.equal(N.unread(all, 'e2'), 1);
  assert.equal(N.trim(list, 1).map((x) => x.id).join(), 'a,c');
});

const emp = (id, extra = {}) => ({ id, first: id.toUpperCase(), last: 'X', status: 'Active', start: '2024-01-15', birthday: '1990-05-05', ...extra });
const types = (list) => list.map((x) => x.type).join(',');

test('reminders: probation, contract, passport and permit windows', () => {
  const today = '2026-10-19';
  const r = N.reminders({ today, employees: [
    emp('a', { probationEnd: '2026-10-30' }), // 11 days: due (30-day window)
    emp('b', { probationEnd: '2026-10-30', confirmedOn: '2026-10-01' }), // already confirmed
    emp('c', { probationEnd: '2026-12-30' }), // too far
    emp('d', { contractEnd: '2026-11-18' }), // 30 days
    emp('e', { passportExpiry: '2027-03-01', permitExpiry: '2026-12-01' }), // 133 and 43 days
    emp('f', { permitExpiry: '2026-10-10' }), // expired 9 days ago
    emp('g', { contractEnd: '2026-11-18', status: 'Inactive' }),
  ] });
  assert.equal(types(r), 'reminder.probation,reminder.contract,reminder.passport,reminder.permit,reminder.permit');
  assert.equal(r[0].data.left, 11);
  assert.equal(r[0].to, 'hr');
  assert.equal(r[4].data.left, -9);
  assert.match(N.build(r[4].type, r[4].data).title, /has expired/);
  // Keys stay the same within a week, so a daily run doesn't repeat them.
  const again = N.reminders({ today: '2026-10-20', employees: [emp('a', { probationEnd: '2026-10-30' })] });
  assert.equal(again[0].key, r[0].key);
  const nextWeek = N.reminders({ today: '2026-10-27', employees: [emp('a', { probationEnd: '2026-10-30' })] });
  assert.notEqual(nextWeek[0].key, r[0].key);
});

test('reminders: birthdays and work anniversaries today', () => {
  const r = N.reminders({ today: '2026-10-19', employees: [emp('a', { birthday: '1991-10-19' }), emp('b', { start: '2023-10-19' }), emp('c', { start: '2026-10-19' }), emp('d', { birthday: '1992-02-29' })] });
  assert.equal(types(r), 'reminder.birthday,reminder.anniversary');
  assert.equal(r[1].data.years, 3);
  assert.deepEqual([...r[0].to], ['hr', 'a']);
  // 29 February birthdays are remembered on 28 February in other years.
  assert.equal(N.reminders({ today: '2027-02-28', employees: [emp('d', { birthday: '1992-02-29', start: '2027-01-01' })] }).length, 1);
});

test('reminders: appraisals not submitted, and statutory deadlines passed in', () => {
  const r = N.reminders({ today: '2026-10-19', employees: [emp('a'), emp('b')], reviews: [
    { id: 'r1', empId: 'a', cycle: 'H2 2026', status: 'In progress', due: '2026-10-29' },
    { id: 'r2', empId: 'b', cycle: 'H2 2026', status: 'Completed', due: '2026-10-29' },
    { id: 'r3', empId: 'b', cycle: 'H2 2026', status: 'Not started', due: '2026-12-31' },
  ], statutory: [{ key: 'pcb-2026-09', title: 'September PCB is overdue', detail: 'Due 15 Oct.' }] });
  assert.equal(types(r), 'reminder.appraisal,reminder.appraisals,reminder.statutory');
  assert.equal(r[0].data.left, 10);
  assert.equal(r[0].to, 'a');
  assert.equal(r[1].to, 'hr');
  assert.equal(N.build('reminder.appraisals', r[1].data).title, '1 appraisal is not submitted');
  assert.equal(N.build('reminder.statutory', r[2].data).title, 'September PCB is overdue');
  assert.equal(r[2].key, 'statutory:pcb-2026-09:2026-10-19');
});
