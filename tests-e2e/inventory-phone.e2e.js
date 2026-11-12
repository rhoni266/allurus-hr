// Stock list on a phone (390 px): cards with big + / − buttons instead of the wide table. Major Far East demo, an admin with the Operations area.
//   npm run test:e2e-inventory-phone
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(2); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`); await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(800);
  await p.evaluate(() => { location.hash = 'ops-stock'; }); await p.waitForTimeout(1200);
  const v = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), shown: getComputedStyle(e).display !== 'none' }; }; return { cards: document.querySelectorAll('.inv-card').length, table: r('.inv-table'), card: r('.inv-card'), plus: r('.inv-plus'), minus: r('.inv-minus'), hscroll: document.documentElement.scrollWidth > innerWidth }; });
  ok('Phone: the stock list is cards, the wide table is hidden', v.cards > 0 && v.table && !v.table.shown, JSON.stringify(v.table));
  ok('…big + and − buttons (at least 56 px tall, wide)', v.plus && v.minus && v.plus.h >= 56 && v.minus.h >= 56 && v.plus.w >= 120, JSON.stringify([v.plus, v.minus]));
  ok('…no sideways scroll', !v.hscroll);
  await p.screenshot({ path: (process.env.SHOTS || '.') + '/inventory-phone.png' });
  await p.click('.inv-plus'); await p.waitForSelector('#mv-q', { timeout: 5000 });
  const m = await p.evaluate(() => ({ title: document.querySelector('.modal h2')?.innerText, reasons: [...document.querySelectorAll('#mv-k option')].map((o) => o.textContent) }));
  ok('Tapping + opens "Stock in" with the quantity first and the reasons Received / Returned', /Stock in/.test(m.title) && m.reasons.join() === 'Received,Returned', JSON.stringify(m));
  await p.fill('#mv-q', '3'); await p.click('.modal [type=submit]'); await p.waitForTimeout(600);
  ok('…and saving adds a movement', await p.evaluate(() => window.AllurusApp.state.ops.moves.some((x) => x.kind === 'Received' && x.qty === 3 && x.by)));
  await p.fill('#inv-q', 'zzzz-nothing'); await p.waitForTimeout(300);
  ok('The search filters the cards without redrawing the page', await p.evaluate(() => [...document.querySelectorAll('.inv-card')].every((c) => c.hidden)));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
