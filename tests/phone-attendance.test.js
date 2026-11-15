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
test('no scheduled shift is never absent (status and meters)', () => {
  const now = { day: '2026-11-12', hm: '18:00' };
  assert.equal(st(info('2026-11-11', null, null), now).status, 'rest');
  const m = H.meters([info('2026-11-10', null, null), info('2026-11-11', null, OFFICE)], { today: '2026-11-12' });
  assert.equal(m.absent.days, 1, 'only the day with a shift counts');
});

// ---------- Several punches a day, early punches, failed punches (Major Far East UAT, 2026-11-15) ----------
const rec = (o) => ({ s: 'present', in: '', out: '', ...o });
test('several sessions in a day: hours are the sum of the sessions', () => {
  // 08:00-10:00, stepped out, 10:30-12:00, out for lunch, 13:00-17:00
  const r = rec({ in: '08:00', out: '17:00', lastIn: '13:00', history: [{ in: '08:00', out: '10:00' }, { in: '10:30', out: '12:00' }] });
  assert.deepEqual(R.sessions(r).map((x) => `${x.in}-${x.out}`), ['08:00-10:00', '10:30-12:00', '13:00-17:00']);
  assert.equal(R.sessionMin(r), 120 + 90 + 240, 'the time away is not counted');
  assert.equal(R.stepOutMin(r), 30 + 60);
  assert.equal(R.evaluate({ rec: r, pattern: OFFICE }).worked, 450, 'the pay engine counts the same sum');
  // a single session still takes the break off, as before
  assert.equal(R.evaluate({ rec: rec({ in: '08:00', out: '17:00' }), pattern: OFFICE }).worked, 480);
  // an open session counts up to now
  assert.equal(R.sessionMin(rec({ in: '08:00', out: '', lastIn: '10:30', history: [{ in: '08:00', out: '10:00' }] }), '11:00'), 120 + 30);
});
test('several sessions: late is from the first check-in only', () => {
  const r = rec({ in: '08:20', out: '17:00', lastIn: '13:00', history: [{ in: '08:20', out: '12:00' }] });
  const ev = R.evaluate({ rec: r, pattern: OFFICE });
  assert.equal(ev.lateRaw, 20, 'OFFICE starts 08:00; coming back at 13:00 does not add lateness'); assert.equal(ev.late, 20);
  const onTime = R.evaluate({ rec: rec({ in: '07:55', out: '17:00', lastIn: '14:00', history: [{ in: '07:55', out: '12:00' }] }), pattern: OFFICE });
  assert.equal(onTime.late, 0, 'a late return is not late');
});
test('an early punch 1 and 2 hours before the shift counts for that day and is not late', () => {
  for (const hm of ['07:00', '06:00']) {
    assert.equal(R.shiftDayFor({ day: '2026-11-14', hm, prevPattern: OFFICE }), '2026-11-14', hm + ' with a day shift');
    const ev = R.evaluate({ rec: rec({ in: hm, out: '17:00' }), pattern: OFFICE });
    assert.equal(ev.late, 0); assert.equal(ev.lateRaw, 0);
  }
  // Last night's shift ended at 06:00. An early punch at 05:00 with nothing checked in last night is today's, not last night's.
  assert.equal(R.shiftDayFor({ day: '2026-11-14', hm: '05:00', prevPattern: NIGHT, prevChecked: false }), '2026-11-14');
  assert.equal(R.shiftDayFor({ day: '2026-11-14', hm: '05:00', prevPattern: NIGHT, prevChecked: true }), '2026-11-13', 'still last night when they were in');
  assert.equal(R.shiftDayFor({ day: '2026-11-14', hm: '05:00', prevPattern: NIGHT }), '2026-11-13', 'unknown keeps the old rule');
  // an overnight shift 20:00-04:00: an early punch at 18:30 is its own day
  const GUARD = { id: 'g', start: '20:00', end: '04:00', breakMin: 60, grace: 10, days: [0, 1, 2, 3, 4, 5, 6], flexible: false };
  assert.equal(R.shiftDayFor({ day: '2026-11-14', hm: '18:30', prevPattern: GUARD, prevChecked: true }), '2026-11-14');
  assert.equal(R.evaluate({ rec: rec({ in: '18:30', out: '04:00' }), pattern: GUARD }).late, 0);
});
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const cloudSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
test('the phone screen offers Check in again after Check out, in English and BM', () => {
  const home = appSrc.slice(appSrc.indexOf('function simpleHomeView()'), appSrc.indexOf('const meters = rec?.in'));
  assert.match(home, /ss-done[\s\S]*data-act="check-in" data-v="present"[\s\S]*checkInAgain/, 'a button after the done line');
  assert.match(appSrc, /checkInAgain: 'Check in again'/); assert.match(appSrc, /checkInAgain: 'Daftar masuk semula'/);
});
test('a second check-in while already in does not restart the day', () => {
  const w = appSrc.slice(appSrc.indexOf('function writeCheckin('), appSrc.indexOf('function ciConfirm('));
  assert.match(w, /prev\?\.in && !prev\.out[^\n]*return prev/);
  assert.match(w, /history = \[\.\.\.\(prev\.history \|\| \[\]\), \{ in: prev\.lastIn \|\| prev\.in/, 'the earlier session goes into the history');
});
test('a failed check-in always shows an error, never a silent return', () => {
  const c = appSrc.slice(appSrc.indexOf('function ciConfirm('), appSrc.indexOf('// Selfies are kept for 30 days'));
  assert.doesNotMatch(c, /if \(!L \|\| !ci\.photo\) return;/, 'no silent return when the selfie or location is missing');
  assert.match(c, /if \(!L \|\| !ci\.photo\) \{ ciProblem\('The check-in did not go through'/);
  assert.match(c, /catch \(err\)[\s\S]*ciProblem\('The check-in did not go through'/, 'a save that throws shows the error and not the success message');
  assert.match(appSrc, /The camera isn’t ready yet[^\n]*'error'/, 'the shutter before the camera is ready tells the person');
  // the server refusing or not being reached is said every time for a check-in, not once per session
  assert.match(cloudSrc, /attendance~[\s\S]*Your check-in was not saved/);
  assert.match(cloudSrc, /Couldn’t reach the server\. Your check-in is kept on this phone/);
});
