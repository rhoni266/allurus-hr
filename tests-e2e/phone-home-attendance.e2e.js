// Phone home attendance at 390x844: Today status, the week, BM default for Major Far East, EN switch remembered,
// Suria (no simple screen) unchanged, nothing under 11px. SHOTS=<dir> saves screenshots (EN, light and dark).
//   npm run test:e2e-phone-home
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const SHOTS = process.env.SHOTS || '';
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  const open = async (demo, login) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation'], geolocation: { latitude: 4.245987, longitude: 103.41691 } });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=${demo}`); await p.waitForSelector('[data-act=demo-as]');
    await p.locator(`[data-act=demo-as][data-v^="${login}"]`).first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(900);
    return p;
  };
  // Major Far East: a plain staff member (Amirul) gets the simple screen, in Bahasa Malaysia
  const m = await open('majorfe', 'amirul');
  ok('Major Far East staff: simple screen, BM by default', await m.evaluate(() => !!document.querySelector('.ss[lang="ms"]') && /Daftar (masuk|keluar)/.test(document.querySelector('.ss-big')?.innerText || '')));
  ok('…today status pill and the week of 7 dots', await m.evaluate(() => !!document.querySelector('.pa-pill') && document.querySelectorAll('.pa-dot').length === 7));
  ok('…every dot has a screen-reader label with the date', await m.evaluate(() => [...document.querySelectorAll('.pa-dot')].every((d) => /\d{4}/.test(d.getAttribute('aria-label') || ''))));
  ok('…no sideways scroll, and no text under 11px', await m.evaluate(() => {
    const small = [...document.querySelectorAll('.ss *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11);
    window.__small = small.map((e) => e.className).join(',');
    return document.documentElement.scrollWidth <= 391 && !small.length;
  }), await m.evaluate(() => window.__small));
  if (SHOTS) await m.screenshot({ path: path.join(SHOTS, 'phone-home-bm-dark.png') });
  await m.evaluate(() => document.querySelector('[data-act=ss-me]').click()); await m.waitForTimeout(300);
  await m.evaluate(() => document.querySelector('[data-act=ss-lang][data-v=en]').click()); await m.waitForTimeout(500);
  ok('Staff can switch to English, and the choice is remembered', await m.evaluate(() => /Check (in|out)/.test(document.querySelector('.ss-big')?.innerText || '') && !!document.querySelector('.ss[lang="en"]')));
  await m.reload(); await m.waitForSelector('.ss'); await m.waitForTimeout(500);
  ok('…still English after a reload', await m.evaluate(() => /Check (in|out)/.test(document.querySelector('.ss-big')?.innerText || '')));
  if (SHOTS) {
    await m.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await m.waitForTimeout(300); await m.screenshot({ path: path.join(SHOTS, 'phone-home-en-dark.png') });
    await m.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await m.waitForTimeout(300);
    await m.screenshot({ path: path.join(SHOTS, 'phone-home-en-light.png') });
  }
  await m.evaluate(() => document.querySelector('.pa-week').click()); await m.waitForTimeout(400);
  ok('Tapping the week opens the attendance history', await m.evaluate(() => !!document.querySelector('.modal table')));
  // Suria: no simple screen; the normal app loads
  const s = await open('suria', 'azman');
  ok('Suria employee: the normal Home loads', await s.evaluate(() => !document.querySelector('.ss') && !!document.querySelector('#view')?.innerText.trim()));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
