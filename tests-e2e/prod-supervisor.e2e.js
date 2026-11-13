// Production supervisor on a phone (390x844), Major Far East demo, Amirul: the Fill production card, a quantities-only form (no rates,
// pool or RM), BM and EN, saved quantities reach the admin's Production page.   node tests-e2e/prod-supervisor.e2e.js  (SHOTS=<dir>)
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright-core'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const SHOTS = process.env.SHOTS || '';
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation'], geolocation: { latitude: 4.245987, longitude: 103.41691 } });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`); await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as][data-v^="amirul"]').first().click(); await p.waitForSelector('.ss'); await p.waitForTimeout(800);
  ok('Supervisor home: "Isi pengeluaran" card (BM by default)', await p.evaluate(() => /Isi pengeluaran/.test(document.querySelector('#prod-fill')?.innerText || '')));
  if (SHOTS) await p.evaluate(() => document.querySelector('#prod-fill')?.scrollIntoView()).then(() => p.screenshot({ path: path.join(SHOTS, 'sup-card-bm.png') }));
  await p.click('#prod-fill [data-act=prod-sup] >> nth=-1'); await p.waitForSelector('.modal input[name^="q-"]');
  const form = await p.evaluate(() => ({ inputs: document.querySelectorAll('.modal input[name^="q-"]').length, text: document.querySelector('.modal').innerText }));
  ok('Form: one input per active product, quantities only: no RM, rate or pool', form.inputs >= 1 && !/RM|rate|kadar|pool|kumpulan|\d\.\d\d/i.test(form.text), JSON.stringify(form.text.slice(0, 120)));
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'sup-form-bm.png') });
  await p.fill('.modal input[name^="q-"]', 'abc'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300);
  ok('A bad quantity keeps the form open', await p.evaluate(() => !!document.querySelector('.modal')));
  await p.fill('.modal input[name^="q-"]', '2000'); await p.click('.modal [type=submit]'); await p.waitForTimeout(600);
  ok('Saved: quantity kept, and Today is no longer in the list to fill', await p.evaluate(() => Object.keys(window.AllurusApp.state.prodQty || {}).length === 1 && !/Hari ini/.test(document.querySelector('#prod-fill')?.innerText || '')));
  await p.evaluate(() => { document.querySelector('[data-act=ss-me]').click(); }); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('[data-act=ss-lang][data-v=en]').click()); await p.waitForTimeout(500);
  ok('English: "Fill production"', await p.evaluate(() => /Fill production/.test(document.querySelector('#prod-fill h2').innerText)));
  if (SHOTS) await p.evaluate(() => document.querySelector('#prod-fill')?.scrollIntoView()).then(() => p.screenshot({ path: path.join(SHOTS, 'sup-card-en.png') }));
  ok('No sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= 391));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
