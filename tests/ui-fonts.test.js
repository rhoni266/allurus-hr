// Fonts by job, soft capitals, and the card rules that keep figures and initials from overlapping or being cut.
// The browser check (390px and 1280px, every admin page) is tests-e2e/ui-clip.e2e.js (npm run test:e2e-ui-clip).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('css/styles.css'), doc = read('docs/design-system.md');
const sb = { window: {}, document: {}, navigator: {}, Intl }; sb.window = sb; vm.createContext(sb);
vm.runInContext(read('js/utils.js'), sb);
const U = sb.U;

test('font tokens: SF Pro first, Inter self-hosted, Compact for dense text, Mono only for IDs and codes', () => {
  assert.match(css, /--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, "Segoe UI", Roboto, sans-serif;/);
  assert.match(css, /--font-compact: "SF Compact Text", "SF Compact", var\(--font-sans\);/);
  assert.match(css, /--font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;/);
  assert.match(css, /--font: var\(--font-sans\);/, 'older rules keep working');
  assert.match(css, /@font-face \{ font-family: Inter;[^}]*assets\/fonts\/inter-latin\.woff2/);
  assert.ok(fs.statSync(path.join(root, 'assets/fonts/inter-latin.woff2')).size > 10000, 'the font file is in the repo');
  assert.match(read('assets/fonts/OFL-Inter.txt'), /SIL Open Font License/);
  assert.ok(!fs.readdirSync(path.join(root, 'assets/fonts')).some((f) => /SF-?Pro|SFPro|SF-?Compact|SF-?Mono/i.test(f)), 'SF fonts are never bundled');
  assert.match(css, /\.stat-l, \.pill, \.tag, \.chip, \.kpi-chip, \.tabbar a[^{]*\{ font-family: var\(--font-compact\); \}/);
  assert.match(css, /\.mono, \.inv-no, \.emp-id, \.ticket-id, \.acct-no, \.einv-link \{ font-family: var\(--font-mono\)/);
  assert.match(css, /\.num, \.kpi-value[^{]*\{ font-family: var\(--font-sans\); font-variant-numeric: tabular-nums; \}/, 'money and figures are not mono');
  assert.ok(!/\.(num|kpi-value|stat-v|money)[^{]*\{[^}]*--font-mono/.test(css));
});
test('the design system doc names the same tokens', () => {
  for (const k of ['--font-sans', '--font-compact', '--font-mono', 'U.soften', 'tabular-nums', 'clamp()']) assert.ok(doc.includes(k), k);
  assert.ok(!doc.includes('Manrope (variable'), 'the old font line is gone');
});
test('names typed in capitals are shown softly; the stored text is never changed', () => {
  assert.equal(U.soften('SUPERVISORY STAFF'), 'Supervisory staff');
  assert.equal(U.soften('SUPERVICE DAILY PRODUCTION'), 'Supervice daily production');
  assert.equal(U.soften('HR, ADMIN & ACCOUNTS'), 'HR, admin & accounts', 'HR stays');
  assert.equal(U.soften('IT SUPPORT'), 'IT support'); assert.equal(U.soften('R&D TEAM'), 'R&D team');
  assert.equal(U.soften('Warehouse'), 'Warehouse', 'already fine');
  assert.equal(U.soften('sales dept'), 'sales dept', 'lower case is left as typed');
  assert.equal(U.soften('HR'), 'HR'); assert.equal(U.soften('QA'), 'QA'); assert.equal(U.soften(''), ''); assert.equal(U.soften(null), '');
  const app = read('js/app.js');
  assert.ok(app.includes('U.soften(d.name)') && app.includes('U.soften(d.about)'), 'used for the department cards');
  assert.ok(!/d\.name = U\.soften|dept\.name = U\.soften/.test(app), 'display only');
});
test('department cards: 3 figures that fit (clamp), 2 + 1 when narrow, auto-fill grid, compact money with the full amount in a tooltip', () => {
  assert.match(css, /\.stats \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.stat-v \{[^}]*font-size: clamp\(12px, 5cqi, 20px\)/);
  assert.match(css, /@container \(max-width: 270px\) \{ \.stats \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.match(css, /\.dcard \{[^}]*container-type: inline-size/);
  assert.match(css, /\.dept-grid \{[^}]*repeat\(auto-fill, minmax\(min\(300px, 100%\), 1fr\)\)/);
  assert.ok(!/\.stat-v[^{]*\{[^}]*font-size: 28px/.test(read('css/mac.css')), 'nothing later makes the figures big again');
  const app = read('js/app.js');
  assert.ok(app.includes('class="dept-grid"') && app.includes('title="${esc(money(payroll))}"'));
});
test('avatars: 2 letters at 40% of the circle, never clipped', () => {
  for (const [sel, d, f] of [['.avatar', 36, 14.4], ['.avatar.lg', 64, 25.6], ['.avatar.sm', 28, 11.2]]) {
    const m = css.match(new RegExp(`${sel.replace(/\./g, '\\.')} \\{ width: (\\d+)px; height: (\\d+)px;[^}]*font-size: ([\\d.]+)px`));
    assert.ok(m, sel); assert.equal(+m[1], d); assert.equal(+m[2], d); assert.ok(Math.abs(+m[3] / d - 0.4) < 0.01, `${sel} ${m[3]}/${d}`);
  }
  assert.match(css, /\.avatar \{[^}]*overflow: hidden/);
  assert.ok(read('js/app.js').includes(".slice(0, 2).join('').toUpperCase()"), 'two letters at most');
});
test('KPI figures shrink with their card', () => {
  assert.match(css, /\.kpi-value \{ font-size: clamp\(18px, 15cqi, 32px\)/);
  assert.match(css, /\.card\.kpi, \.kpi \{ container-type: inline-size/);
});

test('people names typed in capitals are shown as names; the stored name and the statutory files are untouched', () => {
  assert.equal(`${U.softName('MUHAMMAD AMIRUL HAKIM', true)} ${U.softName('BIN MOHD ZAKARIA', false)}`, 'Muhammad Amirul Hakim bin Mohd Zakaria');
  assert.equal(U.softName('MOHD NOOR', true), 'Mohd Noor');
  assert.equal(`${U.softName('SITI', true)} ${U.softName('NUR-AIN A/P KUMAR', false)}`, 'Siti Nur-Ain a/p Kumar');
  assert.equal(U.softName('N.W', true), 'N.W', 'initials stay'); assert.equal(U.softName('C. W.', true), 'C. W.');
  assert.equal(U.softName('Farah Nadia', true), 'Farah Nadia', 'mixed case is exactly as typed'); assert.equal(U.softName('binti Rahman', false), 'binti Rahman');
  assert.equal(U.softName('', true), ''); assert.equal(U.softName(null, true), '');
  const app = read('js/app.js');
  assert.ok(app.includes('U.softName(e.first, true)} ${U.softName(e.last, false)}'), 'one place: how the app shows a name');
  const stat = read('js/statutory.js');
  assert.ok(stat.includes("const fullName = (e) => `${e?.first || ''} ${e?.last || ''}`.trim();") && !stat.includes('softName'), 'EPF, SOCSO, tax and bank files use the name exactly as stored');
});
