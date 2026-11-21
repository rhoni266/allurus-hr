// The company's rest days: any of the seven, presets (incl. Friday only), one source for every working-day count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sb = { window: {}, console }; vm.createContext(sb);
['js/utils.js', 'js/leave-rules.js'].forEach((f) => vm.runInContext(read(f), sb));
const R = sb.window.AllurusLeaveRules, U = sb.window.U, L = (a) => Array.from(a);

test('Friday only is a preset, and any of the seven days can be chosen', () => {
  assert.deepEqual(L(R.weekendDays({ weekend: 'fri' })), [5]);
  const c = { weekend: 'fri-sat' };
  assert.equal(R.setRestDays(c, [5]), true); assert.equal(c.weekend, 'fri'); assert.deepEqual(L(R.weekendDays(c)), [5]);
  assert.equal(R.setRestDays(c, [2, 4]), true); assert.equal(c.weekend, 'custom'); assert.equal(R.restLabel(R.weekendDays(c)), 'Tuesday and Thursday');
  assert.equal(R.setRestDays(c, [0, 1, 2, 3, 4, 5, 6]), false, 'at least one working day');
  assert.equal(R.setRestDays(c, []), false);
  assert.deepEqual(L(R.weekendDays({ weekend: 'sat-sun' })), [6, 0], 'old settings still work');
  assert.deepEqual(L(R.weekendDays({ weekend: 'custom', restDays: [5] })), [5]);
  assert.deepEqual(L(R.weekendDays({ weekend: 'zzz', restDays: [9] })), [6, 0], 'a broken value falls back safely');
});

test('with Friday as the only rest day, Saturday is a working day for leave, the calendar and the dashboard', () => {
  const cfg = { weekend: 'fri' }; R.setRestDays(cfg, [5]);
  const ctx = R.calendarCtx(cfg, '2026-11-01', '2026-11-30');
  assert.equal(R.isWorkingDay('2026-11-21', ctx), true, 'Saturday');
  assert.equal(R.isWorkingDay('2026-11-20', ctx), false, 'Friday');
  U.setWeekendSource(() => R.weekendDays(cfg));
  assert.equal(U.isWeekend('2026-11-21'), false); assert.equal(U.isWeekend('2026-11-20'), true);
  assert.equal(U.lastWorkday('2026-11-20'), '2026-11-19', 'the last workday before a Friday rest day is Thursday');
  assert.equal(U.workdaysBetween('2026-11-16', '2026-11-22'), 6, 'Monday to Sunday: six working days');
  cfg.restDays = [6, 0]; assert.equal(U.isWeekend('2026-11-21'), true, 'the source is read live, never a stale copy');
});

test('the settings screen offers the presets and the seven day buttons', () => {
  const lv = read('js/leave.js');
  assert.ok(lv.includes("['fri', 'Friday only']") && lv.includes("data-act=\"lv-restday\"") && lv.includes("'lv-restday'"));
  assert.ok(read('js/app.js').includes('U.setWeekendSource('));
});
