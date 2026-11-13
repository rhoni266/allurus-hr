// Phone home attendance (docs/PHONE-HOME-ATTENDANCE-SPEC.md): day statuses, the week, shifts across midnight, language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('../js/simple-home-rules.js');
const sb = { window: {} };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'attendance-rules.js'), 'utf8'), sb);
const R = sb.window.AllurusTimeRules;
const NIGHT = { id: 'n', start: '22:00', end: '06:00', breakMin: 60, grace: 10, days: [0, 1, 2, 3, 4, 5, 6], flexible: false };
const LATE = { id: 'l', start: '12:00', end: '21:00', breakMin: 60, grace: 10, days: [1, 2, 3, 4, 5], flexible: false };
const OFFICE = { id: 'o', start: '08:00', end: '17:00', breakMin: 60, grace: 15, days: [1, 2, 3, 4, 5], flexible: false };
const info = (day, rec, pattern, extra = {}) => ({ day, rec, pattern, type: 'normal', leave: false, ev: R.evaluate({ rec, pattern, type: 'normal' }), ...extra });
const ended = (now) => (x) => R.shiftEnded({ day: x.day, pattern: x.pattern, nowDay: now.day, nowHM: now.hm });
const st = (x, now) => H.dayStatus(x, now, ended(now));

test('overnight 22:00-06:00: a punch after midnight counts for the day the shift started', () => {
  assert.equal(R.shiftDayFor({ day: '2026-11-13', hm: '00:30', prevPattern: NIGHT }), '2026-11-12');
  assert.equal(R.shiftDayFor({ day: '2026-11-13', hm: '05:58', prevPattern: NIGHT }), '2026-11-12', 'check-out just before the end');
  assert.equal(R.shiftDayFor({ day: '2026-11-12', hm: '21:55', prevPattern: NIGHT }), '2026-11-12', 'an evening punch is its own day');
  assert.equal(R.shiftDayFor({ day: '2026-11-13', hm: '09:00', prevPattern: NIGHT }), '2026-11-13', 'after the shift ended');
  assert.equal(R.shiftDayFor({ day: '2026-11-13', hm: '00:30', prevPattern: OFFICE }), '2026-11-13', 'a day shift never reaches back');
});
test('overnight: late uses that shift\'s own grace', () => {
  assert.equal(R.evaluate({ rec: { s: 'present', in: '22:08', out: '06:01' }, pattern: NIGHT }).late, 0);
  assert.equal(R.evaluate({ rec: { s: 'present', in: '22:25', out: '06:00' }, pattern: NIGHT }).late, 25);
  assert.equal(R.evaluate({ rec: { s: 'present', in: '21:50', out: '06:00' }, pattern: NIGHT }).late, 0, 'early arrival is not late');
});
test('overnight: absent only after 06:00 the next morning', () => {
  const x = info('2026-11-12', null, NIGHT);
  assert.equal(st(x, { day: '2026-11-12', hm: '23:30' }).status, 'notyet', 'shift is under way');
  assert.equal(st(x, { day: '2026-11-13', hm: '05:59' }).status, 'notyet');
  assert.equal(st(x, { day: '2026-11-13', hm: '06:00' }).status, 'absent');
});
test('late-ending 12:00-21:00: late, on time, and absent not before 21:00', () => {
  assert.equal(R.evaluate({ rec: { s: 'present', in: '12:20', out: '21:00' }, pattern: LATE }).late, 20);
  assert.equal(R.evaluate({ rec: { s: 'present', in: '12:09', out: '21:00' }, pattern: LATE }).late, 0);
  assert.equal(R.shiftDayFor({ day: '2026-11-13', hm: '00:10', prevPattern: LATE }), '2026-11-13', 'a 21:00 finish stays on one calendar day');
  const x = info('2026-11-12', null, LATE);
  assert.equal(st(x, { day: '2026-11-12', hm: '14:00' }).status, 'notyet', 'at 14:00 not absent');
  assert.equal(st(x, { day: '2026-11-12', hm: '20:59' }).status, 'notyet');
  assert.equal(st(x, { day: '2026-11-12', hm: '21:00' }).status, 'absent');
});
test('statuses: on time, late with minutes, leave, holiday, rest, future, absent', () => {
  const now = { day: '2026-11-12', hm: '18:00' };
  assert.deepEqual({ ...st(info('2026-11-12', { s: 'present', in: '08:10', out: '' }, OFFICE), now) }, { status: 'ontime', min: 0 }, 'inside the shift\'s 15 min grace');
  assert.deepEqual({ ...st(info('2026-11-11', { s: 'present', in: '08:40', out: '17:00' }, OFFICE), now) }, { status: 'late', min: 40 });
  assert.equal(st(info('2026-11-10', null, OFFICE, { leave: true }), now).status, 'leave');
  assert.equal(st(info('2026-11-09', null, OFFICE, { type: 'holiday' }), now).status, 'holiday');
  assert.equal(st(info('2026-11-08', null, null, { type: 'rest' }), now).status, 'rest');
  assert.equal(st(info('2026-11-14', null, OFFICE), now).status, 'none');
  assert.equal(st(info('2026-11-11', null, OFFICE), now).status, 'absent');
});
test('week is Monday to Sunday', () => {
  assert.deepEqual(H.weekOf('2026-11-12'), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  assert.equal(H.weekOf('2026-11-15')[0], '2026-11-09');
  assert.equal(H.weekOf('2026-11-09')[6], '2026-11-15');
});
test('12-hour time and the Kuala Lumpur clock', () => {
  assert.equal(H.time12('08:42'), '8:42 am'); assert.equal(H.time12('00:05'), '12:05 am'); assert.equal(H.time12('12:00'), '12:00 pm'); assert.equal(H.time12('17:06'), '5:06 pm');
  assert.deepEqual({ ...H.nowKL(new Date('2026-11-12T17:30:00Z')) }, { day: '2026-11-13', hm: '01:30' }, 'a UTC evening is already tomorrow in KL');
});
test('language: company default, own choice wins; BM days are "hari"', () => {
  assert.equal(H.pickLang('bm', undefined), 'bm'); assert.equal(H.pickLang(undefined, undefined), 'en'); assert.equal(H.pickLang('en', undefined), 'en');
  assert.equal(H.pickLang('bm', 'en'), 'en', 'the person switched to English'); assert.equal(H.pickLang('en', 'bm'), 'bm');
  assert.equal(H.daysWord(2, 'bm'), '2 hari'); assert.equal(H.daysWord(1, 'bm'), '1 hari'); assert.equal(H.daysWord(2, 'en'), '2 days'); assert.equal(H.daysWord(1, 'en'), '1 day');
});
test('no text under 11px in the phone screen styles', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const bad = [...css.matchAll(/(\.(?:ss|pa)-[\w-]*)[^{}]*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => +m[2] < 11);
  assert.equal(bad.length, 0, bad.map((m) => m[1]).join(', '));
});
