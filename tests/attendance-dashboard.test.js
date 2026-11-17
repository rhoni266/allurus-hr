// Tests for the Attendance Dashboard enhancements
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

test('Attendance dashboard: KPI cards, breakdown bar, and interactive filters', () => {
  const attView = appSrc.slice(appSrc.indexOf('VIEWS.attendance ='), appSrc.indexOf('AFTER.attendance ='));

  // KPI cards
  assert.match(attView, /Attendance rate/, 'shows attendance rate KPI');
  assert.match(attView, /data-act="att-filter-status" data-v="all"/, 'all KPI is clickable to filter');
  assert.match(attView, /data-act="att-filter-status" data-v="present"/, 'in office KPI is clickable to filter');
  assert.match(attView, /data-act="att-filter-status" data-v="remote"/, 'remote KPI is clickable to filter');
  assert.match(attView, /data-act="att-filter-status" data-v="late"/, 'late KPI is clickable to filter');
  assert.match(attView, /data-act="att-filter-status" data-v="absent"/, 'absent KPI is clickable to filter');
  assert.match(attView, /data-act="att-filter-status" data-v="leave"/, 'leave KPI is clickable to filter');

  // Breakdown bar
  assert.match(attView, /class="ops-aging"/, 'includes visual distribution progress bar');
  assert.match(attView, /Attendance breakdown/, 'labeled attendance breakdown');

  // Search and department filter toolbar
  assert.match(attView, /id="att-q"/, 'includes search input for employee name or role');
  assert.match(attView, /id="att-dept"/, 'includes department select dropdown');

  // Quick navigation and export
  assert.match(attView, /data-act="att-today"/, 'includes quick jump to today');
  assert.match(attView, /data-act="att-yesterday"/, 'includes quick jump to yesterday');
  assert.match(attView, /data-act="att-week"/, 'includes quick jump to this week');
  assert.match(attView, /data-act="att-month"/, 'includes quick jump to this month');
  assert.match(attView, /data-act="att-export"/, 'includes CSV export button');

  // Analytics Bento Grid
  assert.match(attView, /class="att-bento"/, 'includes bento grid layout for analytics');
  assert.match(attView, /data-act="att-trend-range"/, 'includes interactive trend duration switcher');
  assert.match(attView, /Department Turnout/, 'includes department attendance turnout breakdown');

  // Daily Activity & Exceptions Feed
  assert.match(attView, /Daily Attendance Activity &amp; Exceptions/, 'includes daily activity & exceptions feed');
  assert.match(attView, /First Check-ins/, 'includes earliest check-ins block');
  assert.match(attView, /Late Arrivals/, 'includes late arrivals exception block');
  assert.match(attView, /Missing Check-outs/, 'includes missing check-outs alert block');

  // Multi-facet filtering & sorting
  assert.match(attView, /id="att-loc"/, 'includes location / workplace filter');
  assert.match(attView, /id="att-shift-pat"/, 'includes shift pattern filter');
  assert.match(attView, /id="att-sort"/, 'includes sort dropdown');

  // Pagination & detail view
  assert.match(attView, /class="att-pagination"/, 'includes table pagination bar');
  assert.match(attView, /data-act="att-page"/, 'includes pagination navigation buttons');
  assert.match(attView, /id="att-page-size"/, 'includes page size selector');
  assert.match(attView, /data-act="att-detail"/, 'includes detail modal triggers');

  // View mode switcher: Daily log vs 7-day trend
  assert.match(attView, /data-act="att-view" data-v="log"/, 'includes Daily log view tab');
  assert.match(attView, /data-act="att-view" data-v="trend"/, 'includes 7-day trend view tab');
});

test('Attendance dashboard actions: filters, navigation, and export are registered', () => {
  assert.match(appSrc, /'att-today':/, 'att-today action exists');
  assert.match(appSrc, /'att-yesterday':/, 'att-yesterday action exists');
  assert.match(appSrc, /'att-week':/, 'att-week action exists');
  assert.match(appSrc, /'att-month':/, 'att-month action exists');
  assert.match(appSrc, /'att-trend-range':/, 'att-trend-range action exists');
  assert.match(appSrc, /'att-page':/, 'att-page action exists');
  assert.match(appSrc, /'att-detail':/, 'att-detail action exists');
  assert.match(appSrc, /'att-filter-status':/, 'att-filter-status action exists');
  assert.match(appSrc, /'att-filter-clear':/, 'att-filter-clear action exists');
  assert.match(appSrc, /'att-view':/, 'att-view action exists');
  assert.match(appSrc, /'att-export':/, 'att-export action exists');
});

test('Attendance input listener: preserves input cursor and handles department change', () => {
  const afterAtt = appSrc.slice(appSrc.indexOf('AFTER.attendance ='), appSrc.indexOf('function setAttendance('));
  assert.match(afterAtt, /#att-q/, 'binds search input in AFTER.attendance');
  assert.match(afterAtt, /#att-dept/, 'binds department select in AFTER.attendance');
  assert.match(afterAtt, /#att-loc/, 'binds location select in AFTER.attendance');
  assert.match(afterAtt, /#att-shift-pat/, 'binds shift select in AFTER.attendance');
  assert.match(afterAtt, /#att-sort/, 'binds sort select in AFTER.attendance');
  assert.match(afterAtt, /#att-page-size/, 'binds page size select in AFTER.attendance');
  assert.match(afterAtt, /selectionStart/, 'preserves cursor position on search input');
});

test('Attendance detail modal and 12-hour formatting helpers are defined', () => {
  assert.match(appSrc, /function openAttendanceDetail\(/, 'openAttendanceDetail function is defined');
  assert.match(appSrc, /const fmt12 =/, 'fmt12 12-hour converter is defined');
});
