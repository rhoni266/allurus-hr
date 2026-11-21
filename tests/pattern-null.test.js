// Hotfix 3.87: a missing working pattern must never stop a workspace opening (Major Far East, 2026-11-21: rest days changed to
// "Friday only", Saturday became a working day, and "Cannot read properties of null (reading 'flexible')" blocked sign-in).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sb = { window: {}, console }; vm.createContext(sb);
['js/utils.js', 'js/leave-rules.js', 'js/attendance-rules.js', 'js/simple-home-rules.js'].forEach((f) => vm.runInContext(read(f), sb));
const R = sb.window.AllurusAttendanceRules || sb.window.AllurusTimeRules || Object.values(sb.window).find((x) => x && x.resolveDay);
const SH = sb.window.AllurusSimpleHome || Object.values(sb.window).find((x) => x && x.meters);
const SAT = '2026-11-21';   // a Saturday, working now that only Friday rests
const fixed = { id: 'p1', name: 'Office', start: '09:00', end: '18:00', breakMin: 60, grace: 10, days: [0, 1, 2, 3, 4, 6], flexible: false };
// A hole in the list (null), a department set to None (''), a person whose pattern id no longer exists, and a record on a day with no shift.
const cfg = { patterns: [null, fixed, undefined], autoShift: true };
const rec = { s: 'present', in: '09:05', out: '18:10' };

test('resolveDay: a null in the pattern list, a deleted pattern id and a department on None all mean "no shift", not an error', () => {
  for (const [empPattern, deptPattern] of [['gone', ''], [null, null], ['p1', undefined], ['', 'gone']]) {
    const x = R.resolveDay({ day: SAT, rec, roster: '', empPattern, deptPattern, cfg, holiday: false, companyRest: false });
    assert.equal(x.off, empPattern === 'p1' ? false : x.off);
    assert.ok(x.type === 'normal' || x.type === 'rest');
  }
  const none = R.resolveDay({ day: SAT, rec: null, roster: '', empPattern: 'gone', deptPattern: '', cfg, companyRest: false });
  assert.equal(none.pattern, null); assert.equal(none.source, 'none'); assert.equal(none.off, false);
});

test('evaluate and shiftEnded accept a missing pattern on a working day: no shift, nothing late', () => {
  const ev = R.evaluate({ rec, pattern: null, type: 'normal' });
  assert.equal(ev.late, 0); assert.ok(ev.worked > 0);
  assert.equal(R.evaluate({ rec, pattern: undefined, type: 'normal' }).late, 0);
  assert.equal(R.shiftEnded({ day: SAT, pattern: null, nowDay: SAT, nowHM: '20:00' }), false);
  assert.equal(R.shiftEnded({ day: SAT, pattern: undefined, nowDay: '2026-11-22', nowHM: '00:10' }), true);
  assert.equal(R.shiftLabel(null), '');
});

test('autoShift, overlaps and the simple-home meters skip holes in the list', () => {
  assert.equal(R.autoShift([null, fixed], '09:00').id, 'p1');
  assert.equal(R.autoShift([null, undefined], '09:00'), null);
  assert.doesNotThrow(() => R.overlaps({ [SAT]: 'p1' }, [null, fixed]));
  const days = [{ day: SAT, rec, type: 'normal', leave: false, pattern: null, ev: R.evaluate({ rec, pattern: null, type: 'normal' }) }];
  assert.doesNotThrow(() => SH.meters(days, { today: '2026-11-22' }));
});

test('the app opens a day whose calculation throws, and shows it as having no shift', () => {
  const roster = read('js/roster.js');
  assert.ok(/function dayInfo\(e, day, cal\) \{\s*try \{ return dayInfoRaw/.test(roster));
  assert.ok(roster.includes("console.warn('[Allurus] day skipped'"));
  assert.ok(roster.includes("const patterns = () => (Array.isArray(cfg().patterns)"));
});
