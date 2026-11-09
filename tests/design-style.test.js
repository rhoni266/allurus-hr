// Design standard checks (docs/MACOS-STYLE-UI-SPEC.md): no lime or Manrope left anywhere the app ships, the brand
// colours live in brand/tokens.css, the macOS layer uses tokens only, and text colours pass 4.5:1. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
function files(dir, out = []) {
  for (const n of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, n), st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) { if (!/^(node_modules|vendor|docs|tests|tests-rules|pos|functions|scripts|\.git|redirect)$/.test(n)) files(rel, out); }
    else if (/\.(css|js|html)$/.test(n)) out.push(rel);
  }
  return out;
}

test('no lime accent or Manrope font is shipped', () => {
  const bad = files('.').filter((f) => /manrope|c6f432|#d3f75e|\blime\b/i.test(read(f)));
  assert.deepEqual(bad, []);
});

test('the brand colours are defined in brand/tokens.css, and css/mac.css uses tokens only', () => {
  const t = read('brand/tokens.css');
  for (const c of ['#0F766E', '#0B5F59', '#D9B66F', '#16181D', '#5F636B', '#F5F5F7', '#17804A', '#A05F00', '#B3261E', '#2F6AD0']) assert.ok(t.includes(c), c);
  for (const k of ['--radius-window: 14px', '--radius-card: 16px', '--radius-control: 8px', '--sidebar-bg', '--window-bg', '--desktop-bg', '--selection', '--on-selection']) assert.ok(t.includes(k), k);
  assert.deepEqual(read('css/mac.css').match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
  assert.ok(!/SF Pro/.test(read('brand/tokens.css') + read('css/mac.css')), 'SF Pro is not bundled or named');
});

const lum = (hex) => { const n = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('text and background pairs pass 4.5:1, light and dark', () => {
  const pairs = [
    ['#FFFFFF', '#0F766E', 'white on teal selection'], ['#16181D', '#2BB3A3', 'obsidian on dark selection'],
    ['#5F636B', '#F1F2F4', 'slate label on sidebar'], ['#5F636B', '#F5F5F7', 'slate on mist'], ['#686C74', '#FFFFFF', 'faint text on white'],
    ['#16181D', '#FFFFFF', 'body text'], ['#B4B7BE', '#1D2025', 'dark secondary text'], ['#9A9EA6', '#1D2025', 'dark faint text'],
    ['#17804A', '#FFFFFF', 'ok'], ['#A05F00', '#FFFFFF', 'warn'], ['#B3261E', '#FFFFFF', 'bad'], ['#2F6AD0', '#FFFFFF', 'info'],
    ['#FFFFFF', '#B3261E', 'white on destructive button'], ['#16181D', '#D9B66F', 'obsidian glyph on champagne tile'],
  ];
  for (const [fg, bg, what] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${what}: ${ratio(fg, bg).toFixed(2)}`);
});
