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
  assert.match(attView, /data-act="att-yesterday"/, 'includes quick jump to yesterday');
  assert.match(attView, /data-act="att-export"/, 'includes CSV export button');

  // View mode switcher: Daily log vs 7-day trend
  assert.match(attView, /data-act="att-view" data-v="log"/, 'includes Daily log view tab');
  assert.match(attView, /data-act="att-view" data-v="trend"/, 'includes 7-day trend view tab');
});

test('Attendance dashboard actions: filters, navigation, and export are registered', () => {
  assert.match(appSrc, /'att-yesterday':/, 'att-yesterday action exists');
  assert.match(appSrc, /'att-filter-status':/, 'att-filter-status action exists');
  assert.match(appSrc, /'att-filter-clear':/, 'att-filter-clear action exists');
  assert.match(appSrc, /'att-view':/, 'att-view action exists');
  assert.match(appSrc, /'att-export':/, 'att-export action exists');
});

test('Attendance input listener: preserves input cursor and handles department change', () => {
  const afterAtt = appSrc.slice(appSrc.indexOf('AFTER.attendance ='), appSrc.indexOf('function setAttendance('));
  assert.match(afterAtt, /#att-q/, 'binds search input in AFTER.attendance');
  assert.match(afterAtt, /#att-dept/, 'binds department select in AFTER.attendance');
  assert.match(afterAtt, /selectionStart/, 'preserves cursor position on search input');
});
