// Admin console on a phone: the pure rules in js/mobile-admin.js, and the style rules that keep every page inside 390px.
// The browser check of every admin route, for each role, is tests-e2e/admin-mobile.e2e.js (npm run test:e2e-admin-mobile).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sb = { window: {}, document: { addEventListener() {}, getElementById() { return null; } } };
sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'mobile-admin.js'), 'utf8'), sb);
const M = sb.AllurusMobile;
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
const phoneCss = css.slice(css.indexOf('/* Admin console on a phone'));

test('the bottom bar holds the 4 pages most used by what the person can open', () => {
  const hr = ['dashboard', 'approvals', 'employees', 'attendance', 'leave', 'payroll', 'claims', 'settings'];
  assert.deepEqual([...M.pickTabs(hr)], ['dashboard', 'employees', 'attendance', 'payroll'], 'Owner or HR: today, people, attendance, payroll');
  const payroll = ['dashboard', 'employees', 'attendance', 'payroll', 'claims', 'settings'];
  assert.deepEqual([...M.pickTabs(payroll)], ['dashboard', 'employees', 'attendance', 'payroll']);
  const finance = ['dashboard', 'invoices', 'bills', 'books', 'claims', 'settings'];
  assert.deepEqual([...M.pickTabs(finance)], ['dashboard', 'invoices', 'bills', 'claims'], 'Finance: money pages, no staff pages');
  const store = ['dashboard', 'inventory', 'ops-today', 'settings'];
  assert.deepEqual([...M.pickTabs(store)], ['dashboard', 'inventory', 'ops-today', 'settings'], 'short lists are filled from the page order');
  assert.deepEqual([...M.pickTabs(hr, 3)], ['dashboard', 'employees', 'attendance'], 'an admin who is also staff keeps the last place for Me');
  assert.equal(M.pickTabs(['dashboard']).length, 1);
  assert.equal(M.tabLabel('employees'), 'People'); assert.equal(M.tabLabel('dashboard'), 'Today');
});
test('tables become cards, except wide reports which keep their table in a scroll box', () => {
  assert.equal(M.cardOrScroll({ cols: 6 }), 'cards');
  assert.equal(M.cardOrScroll({ cols: M.MAX_CARD_COLS }), 'cards');
  assert.equal(M.cardOrScroll({ cols: M.MAX_CARD_COLS + 1 }), 'scroll', 'a pay run or an aging report');
  assert.equal(M.cardOrScroll({ cols: 4, wide: true }), 'scroll', 'marked data-wide');
  assert.equal(M.cardOrScroll({ cols: 5, empty: true }), 'skip', 'an empty state is left alone');
  assert.equal(M.cardOrScroll({ cols: 0 }), 'skip');
});
test('phone styles: 44px tap targets, 11px text, full-screen modals, one column forms, two-column key numbers', () => {
  assert.ok(phoneCss.includes('@media (max-width: 480px)'));
  assert.match(phoneCss, /\.view \.btn[^{]*\{[^}]*min-height: 44px/);
  assert.match(phoneCss, /\.view button, \.modal button[^{]*\{ min-height: 44px; \}/);
  assert.match(phoneCss, /\.view small \{ font-size: 11px; \}/);
  assert.match(phoneCss, /\.modal-foot \{ position: sticky; bottom: 0/, 'the save button stays visible');
  assert.match(phoneCss, /> \.modal \{ width: 100%; max-width: none; height: 100%/, 'modals are full screen');
  assert.match(phoneCss, /\.form-grid, \.field-row \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(phoneCss, /\.g-4\.keep-2, \.kpis \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(phoneCss, /\.sidebar \{ width: 100%/, 'the menu is a full-screen list');
  assert.match(phoneCss, /overflow-x: hidden/, 'the page itself never scrolls sideways');
  assert.match(phoneCss, /table\.m-scroll td:first-child[^{]*\{ position: sticky; left: 0/, 'a wide report pins its first column');
  assert.match(phoneCss, /table\.m-cards thead \{ display: none; \}/);
});
test('the module is loaded, runs after every render for admins, and the tab bar uses it', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8'), /js\/mobile-admin\.js\?v=/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.ok(app.includes("if (role() !== 'employee' && window.AllurusMobile) {") && app.includes('AllurusMobile.enhance(view)'));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'js', 'experience.js'), 'utf8').includes('window.AllurusMobile.pickTabs('));
});
test('the Filters button is Tapis in Bahasa Malaysia', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'mobile-admin.js'), 'utf8');
  assert.ok(src.includes("filters: 'Tapis'") && src.includes("filters: 'Filters'"));
});
