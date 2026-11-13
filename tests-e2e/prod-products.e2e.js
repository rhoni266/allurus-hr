// Production with several products, at 390x844 in the Suria demo (admin): dashboard reminder, one input per product, Save the day.
//   node tests-e2e/prod-products.e2e.js   (SHOTS=<dir> saves screenshots)
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright-core'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const SHOTS = process.env.SHOTS || '';
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=suria`); await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as][data-v^="rosli"]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(900);
  await p.evaluate(() => { location.hash = 'dashboard'; }); await p.waitForSelector('#prod-fill', { timeout: 5000 }).catch(() => {}); ok('Dashboard: "Production to fill" card lists the three products', await p.evaluate(() => { const c = document.querySelector('#prod-fill'); window.__t = c ? c.innerText : 'none:' + location.hash; return !!c && /Cili boh/.test(c.innerText) && /Sos cili/.test(c.innerText); }), await p.evaluate(() => window.__t));
  if (SHOTS) await p.evaluate(() => document.querySelector('#prod-fill')?.scrollIntoView()).then(() => p.screenshot({ path: path.join(SHOTS, 'prod-fill.png') }));
  await p.evaluate(() => { location.hash = 'production'; }); await p.waitForTimeout(800);
  ok('Production page: one input per active product', await p.evaluate(() => document.querySelectorAll('.pd-inputs [data-pid]').length === 3));
  await p.fill('[data-pid=pp-cili]', '2000'); await p.fill('[data-pid=pp-sambal]', '10'); await p.waitForTimeout(300);
  ok('The pool shows each qty × rate and the total (RM100 + RM4 = RM104)', await p.evaluate(() => /104\.00/.test(document.querySelector('#pv-pool')?.innerText || '')));
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'prod-page.png'), fullPage: false });
  await p.click('#pd-form [type=submit]'); await p.waitForTimeout(800);
  ok('Save the day keeps the day with both products', await p.evaluate(() => { const d = window.AllurusApp.state.prod.days; const x = Object.values(d)[0]; return !!x && x.items.length === 2 && x.poolSen === 10400; }));
  await p.evaluate(() => { location.hash = 'dashboard'; }); await p.waitForTimeout(800);
  ok('Dashboard card now lists only the unfilled product', await p.evaluate(() => { const c = document.querySelector('#prod-fill'); return !!c && /Sos cili/.test(c.innerText) && !/Cili boh/.test(c.innerText.split('Yesterday')[0]); }));
  ok('No sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= 391));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
