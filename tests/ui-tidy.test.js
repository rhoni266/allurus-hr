// The company console tidy-up: every app has its own icon, one tile style, Operations today lives on the home page,
// companies can hide apps, a long trial is only mentioned on the home page, and new users start in light.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('js/app.js');
const adminRoutes = () => { const a = app.indexOf('ROLE_ROUTES.admin = ['); const b = app.indexOf('];', a); return [...app.slice(a, b).matchAll(/id: '([^']+)', label: '([^']+)', icon: '([^']+)', group: '([^']+)'/g)].map((m) => ({ id: m[1], label: m[2], icon: m[3], group: m[4] })); };

test('every app in the company console has its own icon, and every icon is drawn', () => {
  const rs = adminRoutes(), seen = {};
  assert.ok(rs.length > 35, `${rs.length} apps`);
  rs.forEach((r) => { (seen[r.icon] = seen[r.icon] || []).push(r.id); assert.ok(new RegExp(`\n    ${r.icon}: '<`).test(app), `icon ${r.icon} is drawn`); });
  const dup = Object.entries(seen).filter(([, v]) => v.length > 1);
  // The two "Production" apps (daily entry and Operations) are different pages and say so by group; every other icon is used once.
  assert.deepEqual(dup, [], JSON.stringify(dup));
});

test('Operations today is part of the home page, and old links open the home page', () => {
  assert.ok(!adminRoutes().some((r) => r.id === 'ops-today'));
  assert.ok(app.includes("opsApi?.showToday?.() && can('operations')") && app.includes("opsApi.todayBody()"));
  assert.ok(app.includes(".replace(/^ops-today$/, 'dashboard')"));
});

test('the launcher uses one tile style; the section is a heading with a colour dot', () => {
  const css = read('css/mac.css');
  assert.ok(!/\.ic-(teal|deep|champagne|obsidian|slate|mist)\b/.test(css) && !/ic-\$\{/.test(app));
  assert.ok(css.includes('.launch-sec') && css.includes('.sec-dot') && app.includes('class="launch-sec"'));
});

test('a company can hide the apps it does not use, but never home, approvals, settings or billing', () => {
  assert.ok(app.includes("const KEEP_APPS = ['dashboard', 'approvals', 'settings', 'billing']"));
  assert.ok(app.includes('!appHidden(r.id)') && app.includes("'app-toggle'") && app.includes('function appsCard'));
});

test('the trial banner is quiet until the last 14 days', () => {
  const sb = { window: {} }; vm.createContext(sb); vm.runInContext(read('js/billing-rules.js'), sb);
  const B = sb.window.AllurusBilling, MY = (y, m, d, h = 9) => Date.UTC(y, m - 1, d, h - 8);
  const c = { status: 'trial', trialEndsAt: MY(2026, 12, 31) };
  assert.equal(B.banner(c, MY(2026, 11, 21)).quiet, true, '40 days left');
  assert.equal(B.banner(c, MY(2026, 12, 20)).quiet, false, '12 days left');
  assert.ok(app.includes("b?.quiet && !ro && route() !== 'dashboard'"));
});

test('new users start in light', () => {
  assert.ok(read('js/experience.js').includes(": 'light');"));
});

test('the Get started checklist folds away after the first week', () => {
  assert.ok(read('js/experience.js').includes('Date.now() - made > 7 * 864e5') && read('js/experience.js').includes('from the day the company was created'));
});

test('Title Case keeps abbreviations in capitals and never touches stock item names', () => {
  const sb = { window: {} }; vm.createContext(sb); vm.runInContext(read('js/utils.js'), sb);
  const U = sb.window.U;
  assert.equal(U.title('LHDN TAX FILING'), 'LHDN Tax Filing');
  assert.equal(U.title('HR & ADMIN'), 'HR & Admin');
  assert.equal(U.title('PO CLERK'), 'PO Clerk');
  assert.equal(U.title('MR OFFICE'), 'MR Office');
  assert.equal(U.softName('ABDUL GHANI MR', true), 'Abdul Ghani MR');
  assert.equal(U.title('Quality Control'), 'Quality Control');
  for (const f of ['js/ops.js', 'js/stock-req.js', 'js/stock-rules.js']) assert.ok(!/U\.(title|softName|soften)\(/.test(read(f).replace(/U\.title\(x\.d\.name\)/g, '').replace(/U\.softName\(e\.first, true\)/g, '')), `${f}: item and stock text is shown exactly as typed`);
});

test('hiding an app also hides the staff page for it (Employee view)', () => {
  assert.ok(app.includes("STAFF_OF = { leave: 'my-leave'") && app.includes("!['admin', 'employee'].includes(role())"));
});

test('names typed in capitals are shown as names in greetings and the Operations card', () => {
  assert.ok(app.includes("'Good evening'}, ${esc(U.softName(first, true))}.`"));
  assert.ok(read('js/ops.js').includes('esc(U.softName(e.first, true))'));
});

test('rest-day Dashboard: the KPI says "last workday", no "Everyone\'s in" on a rest day, "Working today" when people checked in', () => {
  const lv = read('js/leave.js');
  assert.ok(app.includes('last workday, ${U.fmtDate(wd'));
  assert.ok(lv.includes("restToday ? '' : `<div class=\"empty\"><strong>Everyone’s in"));
  assert.ok(lv.includes('Working today (a rest day)') && lv.includes('const workedToday'));
});
