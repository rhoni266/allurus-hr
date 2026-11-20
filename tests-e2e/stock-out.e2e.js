// Stock requests on a 390px phone, in ?demo=majorfe: Amirul (staff) asks, Hafiz (appointed approver) approves with a lower quantity,
// Lim (appointed storekeeper) hands over with a photo, Amirul taps Terima; stock goes down only at the handover.
// SHOTS=<dir> saves screenshots (light and dark).   node tests-e2e/stock-out.e2e.js
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const HERE = { latitude: 4.245987, longitude: 103.41691 };
const SHOTS = process.env.SHOTS || '', problems = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const chk = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); if (!ok) problems.push(n + ' ' + info); };
const KEY = '(function(){return Object.keys(localStorage).find(function(x){try{var j=JSON.parse(localStorage[x]);return j&&j.accounts&&j.attendance}catch(e){return false}})})()';
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const url = `http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`, errors = [];
  let carry = null;   // what the "server" holds between people: the requests (the appointments and items are set the same for everyone)
  // One person, one fresh phone: sign in, load what the others did, run fn, return what to carry on.
  async function as(login, fn) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation'], geolocation: HERE });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(`${login}: ${e.message}`));
    await p.goto(url); await p.waitForSelector('[data-act=demo-as]');
    await p.locator(`[data-act=demo-as][data-v^="${login}"]`).first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(800);
    await p.evaluate(([keyJs, c]) => {
      const k = eval(keyJs), j = JSON.parse(localStorage[k]);
      const amirul = j.employees.find((e) => /amirul/i.test(e.first)), hafiz = j.employees.find((e) => /hafiz/i.test(e.first)), lim = j.employees.find((e) => /kok/i.test(e.first));
      j.ops.items.forEach((i) => { i.allowDepts = []; });
      const cement = j.ops.items.find((i) => i.id === 'i-cement'); cement.allowDepts = [amirul.dept]; cement.jenis = 'consume';
      j.settings.stock = { approverRule: { depts: [], roles: [], people: [hafiz.id] }, keeperRule: { depts: [], roles: [], people: [lim.id] }, autoCancelDays: 2 };
      j.stockRequests = c ? c.stockRequests : [];
      localStorage[k] = JSON.stringify(j);
    }, [KEY, carry]);
    await p.reload(); await p.waitForSelector('#view'); await p.waitForTimeout(900);
    const out = await fn(p);
    carry = await p.evaluate((keyJs) => { const j = JSON.parse(localStorage[eval(keyJs)]); return { stockRequests: j.stockRequests || [], cement: j.ops.moves.filter((m) => m.itemId === 'i-cement').reduce((a, m) => a + m.qty, 0) }; }, KEY);
    await ctx.close(); return out;
  }
  const shot = async (p, n) => { if (!SHOTS) return; for (const th of ['light', 'dark']) { await p.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await p.waitForTimeout(250); await p.screenshot({ path: path.join(SHOTS, `${n}-${th}.png`) }); } await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); };
  const submit = (p) => p.locator('.modal-foot button[type=submit], .modal button[type=submit]').first().click();
  const cementQty = async (p) => { await p.evaluate(() => { location.hash = 'ops-stock'; }); await p.waitForTimeout(700); const t = await p.locator('.inv-card[data-s*="cement"] .inv-qty b').first().textContent(); return Number(t.replace(/,/g, '')); };

  // 1. Amirul asks (staff phone, simple home)
  await as('amirul', async (p) => {
    const btn = p.locator('[data-act=sr-ask]').first();
    chk('staff home shows a big "Minta stok" button for a person who may request an item', await btn.count() > 0);
    if (await btn.count()) { const h = (await btn.boundingBox()).height; chk('the button is at least 44px tall', h >= 44, `${h}px`); }
    await shot(p, 'home-stock'); await btn.click(); await p.waitForTimeout(600);
    const opts = await p.$$eval('#sq-i option', (o) => o.map((x) => x.textContent));
    chk('only the items this person may request are listed (one), with what is available', opts.length === 2 && /Portland cement/.test(opts[1]) && /\d/.test(opts[1]), JSON.stringify(opts));
    await p.selectOption('#sq-i', { index: 1 }); await p.fill('#sq-q', '5'); await p.fill('#sq-n', 'Fix the gate');
    chk('the form does not scroll sideways', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 391);
    await shot(p, 'ask-modal'); await submit(p); await p.waitForTimeout(700);
  });
  chk('a request is saved as Diminta with a number, for Amirul, and reserves nothing', carry.stockRequests.length === 1 && carry.stockRequests[0].status === 'Diminta' && /^PS-\d{6}-001$/.test(carry.stockRequests[0].no) && carry.stockRequests[0].qty === 5 && !carry.stockRequests[0].approvedQty, JSON.stringify(carry.stockRequests[0] || {}).slice(0, 150));
  const stock0 = carry.cement;

  // 2. Hafiz (the appointed approver) approves 3 of the 5
  await as('hafiz', async (p) => {
    await p.evaluate(() => { location.hash = 'ops-stock'; }); await p.waitForTimeout(700);
    await p.locator('[data-act=ops-stock-tab][data-v=stockouts]').click(); await p.waitForTimeout(500);
    const btn = p.locator('[data-act=sr-approvals]').first();
    chk('the approver sees "Kelulusan stok" with a count of 1', await btn.count() > 0 && /\(1\)/.test(await btn.textContent()), (await btn.textContent().catch(() => '')) || '');
    await btn.click(); await p.waitForTimeout(500);
    await p.fill('[id^=ap-q-]', '3'); await shot(p, 'approver');
    await p.locator('[data-act=sr-approve]').first().click(); await p.waitForTimeout(600);
  });
  chk('approved with the lower quantity (3), still not out of stock', carry.stockRequests[0].status === 'Diluluskan' && carry.stockRequests[0].approvedQty === 3 && !carry.stockRequests[0].handedQty);

  // 3. Lim (the appointed storekeeper) hands over, with a photo
  let before = 0;
  await as('lim', async (p) => {
    before = await cementQty(p);
    await p.locator('[data-act=ops-stock-tab][data-v=stockouts]').click(); await p.waitForTimeout(500);
    await p.locator('[data-act=sr-handover]').first().click(); await p.waitForTimeout(500);
    await p.locator('[data-act=sr-hand]').first().click(); await p.waitForTimeout(500);
    await p.evaluate(() => { const f = document.querySelector('#hd-p'); f.removeAttribute('required'); }); await submit(p); await p.waitForTimeout(500);
    const still = await p.evaluate((keyJs) => JSON.parse(localStorage[eval(keyJs)]).stockRequests[0].status, KEY);
    chk('a handover without a photo is refused', still === 'Diluluskan', still);
    await p.setInputFiles('#hd-p', { name: 'items.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(700);
    await shot(p, 'handover'); await submit(p); await p.waitForTimeout(800);
  });
  chk('handed over with a photo: Diserahkan, quantity 3', carry.stockRequests[0].status === 'Diserahkan' && carry.stockRequests[0].handedQty === 3 && !!carry.stockRequests[0].handPhoto);

  // 4. Amirul taps Terima
  await as('amirul', async (p) => {
    await p.locator('[data-act=sr-mine]').first().click(); await p.waitForTimeout(500);
    await shot(p, 'mine');
    await p.locator('[data-act=sr-receive]').first().click(); await p.waitForTimeout(600);
  });
  chk('Terima is recorded', !!carry.stockRequests[0].receivedAt);
  chk('no stock move was typed: the item’s own moves are unchanged', carry.cement === stock0, `${carry.cement} vs ${stock0}`);
  await as('lim', async (p) => { const after = await cementQty(p); chk('the store sees the stock exactly 3 lower, and only after the handover', after === before - 3, `${before} → ${after}`); });
  if (errors.length) problems.push('page errors: ' + errors.slice(0, 3).join(' | '));
  console.log(problems.length ? `\nFAIL ${problems.length}:\n  ${problems.join('\n  ')}` : '\nPASS');
  await b.close().catch(() => {}); srv.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
