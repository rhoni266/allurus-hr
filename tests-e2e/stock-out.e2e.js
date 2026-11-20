// Stock-out request on a 390px phone: an employee raises a request from Home (role + department), the owner sees it in Stock and approves it.
// SHOTS=<dir> saves screenshots (light and dark).   node tests-e2e/stock-out.e2e.js
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const HERE = { latitude: 4.245987, longitude: 103.41691 };
const SHOTS = process.env.SHOTS || '', problems = [];
const chk = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); if (!ok) problems.push(n + ' ' + info); };
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation'], geolocation: HERE });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  const shot = async (n) => { if (!SHOTS) return; for (const th of ['light', 'dark']) { await p.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await p.waitForTimeout(250); await p.screenshot({ path: path.join(SHOTS, `${n}-${th}.png`) }); } await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); };
  const url = `http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`;
  // 1. an employee on the factory floor
  await p.goto(url); await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as][data-v^="amirul"]').first().click();
  await p.waitForSelector('#view'); await p.waitForTimeout(900);
  const btn = p.locator('[data-act=ops-so-request]').first();
  chk('the employee Home has a big Request stock button', await btn.count() > 0);
  if (await btn.count()) {
    const h = (await btn.boundingBox()).height; chk('the button is at least 44px tall', h >= 44, `${h}px`);
    await shot('home-stockout'); await btn.click(); await p.waitForTimeout(600);
    await p.selectOption('#so-t', 'role'); await p.fill('#so-ro', 'painter'); await p.fill('#so-d', 'Operations'); await p.fill('#so-q', '5');
    const sel = await p.$('#so-i'); const tag = await sel.evaluate((e) => e.tagName);
    if (tag === 'SELECT') await p.selectOption('#so-i', { index: 1 }); else await p.fill('#so-i', 'White paint');
    await shot('modal-stockout');
    const w = await p.evaluate(() => document.documentElement.scrollWidth); chk('the form does not scroll sideways', w <= 391, `${w}`);
    await p.locator('.modal-foot button[type=submit], .modal button[type=submit]').first().click(); await p.waitForTimeout(700);
  }
  const saved = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.accounts && j.attendance; } catch (e) { return false; } }); return k ? (JSON.parse(localStorage[k]).ops?.stockOuts || []) : []; });
  chk('the ticket is saved as pending, for a role, with its department', saved.length === 1 && saved[0].status === 'pending' && saved[0].requesterType === 'role' && saved[0].role === 'painter' && saved[0].department === 'Operations' && /^STO-\d{6}-001$/.test(saved[0].ticketNo), JSON.stringify(saved[0] || {}).slice(0, 160));
  const stockBefore = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.accounts && j.attendance; } catch (e) { return false; } }); return JSON.parse(localStorage[k]).ops.moves.length; });
  // 2. the owner sees it and approves
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur' });
  await ctx2.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(url); await p2.waitForSelector('[data-act=demo-as]');
  await p2.locator('[data-act=demo-as][data-v^="lim"]').first().click(); await p2.waitForSelector('#view'); await p2.waitForTimeout(500);
  await p2.evaluate((t) => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.accounts && j.attendance; } catch (e) { return false; } }); const j = JSON.parse(localStorage[k]); j.ops.stockOuts = [t]; localStorage[k] = JSON.stringify(j); }, saved[0]); await p2.reload(); await p2.waitForSelector('#view'); await p2.waitForTimeout(600);
  await p2.evaluate(() => { location.hash = 'ops-stock'; }); await p2.waitForTimeout(700);
  await p2.locator('[data-act=ops-stock-tab][data-v=stockouts]').click(); await p2.waitForTimeout(500);
  const rows = await p2.locator('[data-act=ops-sotk-approve]').count(); chk('the owner sees the pending request with Approve and Reject', rows === 1);
  if (SHOTS) for (const th of ['light', 'dark']) { await p2.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await p2.waitForTimeout(250); await p2.screenshot({ path: path.join(SHOTS, `admin-stockouts-${th}.png`) }); }
  if (rows) { await p2.locator('[data-act=ops-sotk-approve]').first().click(); await p2.waitForTimeout(500); }
  const after = await p2.evaluate(() => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.accounts && j.attendance; } catch (e) { return false; } }); const o = JSON.parse(localStorage[k]).ops; return { moves: o.moves.length, st: (o.stockOuts || []).map((t) => t.status) }; });
  chk('approving changes the status and moves no stock', (after.st.includes('approved') && after.moves === stockBefore), JSON.stringify({ rows, after, stockBefore }));
  if (errors.length) problems.push('page errors: ' + errors.slice(0, 2).join(' | '));
  console.log(problems.length ? `\nFAIL ${problems.length}:\n  ${problems.join('\n  ')}` : '\nPASS');
  await b.close().catch(() => {}); srv.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
