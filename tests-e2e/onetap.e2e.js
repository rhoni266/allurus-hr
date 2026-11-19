// One-tap selfie check-in at 390x844 on the Major Far East demo: one tap in, one tap out, the punch saved by itself when the place is
// inside the zone and a face is steady; outside the zone no punch; a double tap saves one; the manual photo after 8 s; a failed save shows an error.
// SHOTS=<dir> saves screenshots (BM and EN, light and dark). The camera is the browser's fake device and the face detector is stubbed.
//   node tests-e2e/onetap.e2e.js
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const SHOTS = process.env.SHOTS || '';
const HERE = { latitude: 4.245987, longitude: 103.41691 }, FAR = { latitude: 3.139, longitude: 101.6869 };
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }), errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation', 'camera'], geolocation: HERE });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage(); globalThis.__page = p; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`); await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as][data-v^="amirul"]').first().click(); await p.waitForSelector('.ss'); await p.waitForTimeout(700);
  // The face check is on (the default): the person has a confirmed reference photo, and the face models are stubbed (the same face every time).
  const setup = () => p.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.attendance && j.session; } catch (e) { return false; } });
    
    window.__face = { box: { x: 100, y: 100, width: 200, height: 240 }, count: 1 };
    AllurusFace.load = AllurusFace.loadDetector = async () => ({});
    AllurusFace.live = async () => ({ box: window.__face.box, count: window.__face.count });
    AllurusFace.describe = async () => [{ descriptor: new Array(128).fill(0.01), score: 0.9 }];   // the same face as the reference
  });
  // Start from a day with no punch for this person.
  await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.attendance && j.session; } catch (e) { return false; } }); const j = JSON.parse(localStorage[k]); const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()); if (j.attendance[day]) delete j.attendance[day].e8; const em = j.employees.find((x) => x.id === 'e8'); em.face = { photo: '', descriptor: new Array(128).fill(0.01), status: 'confirmed', enrolledOn: '2026-11-01', consentOn: '2026-11-01' }; localStorage[k] = JSON.stringify(j); });
  await p.reload(); await p.waitForSelector('.ss'); await p.waitForTimeout(500); await setup();
  const rec = () => p.evaluate(() => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.attendance && j.session; } catch (e) { return false; } }); const j = JSON.parse(localStorage[k]); const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()); return (j.attendance[day] || {}).e8 || null; });
  const shot = async (name) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name) }); };
  const theme = async (t) => { await p.evaluate((x) => { document.documentElement.dataset.theme = x; }, t); await p.waitForTimeout(200); };
  const bigText = () => p.evaluate(() => document.querySelector('.ss-big')?.innerText || '');
  ok('starts with Daftar masuk', /Daftar masuk/.test(await bigText()), await bigText());

  // 1. Outside the zone: no punch, a clear message and Cuba lagi.
  await ctx.setGeolocation(FAR);
  await p.locator('.ss-big').click();
  await p.waitForSelector('.ot-problem', { timeout: 10000 });
  ok('outside the zone: "Anda di luar kawasan" with Cuba lagi', await p.evaluate(() => /Anda di luar kawasan \(.* dari /.test(document.querySelector('.ot-problem')?.innerText || '') && /Cuba lagi/.test(document.querySelector('[data-act=ot-retry]')?.innerText || '')));
  ok('…and nothing was saved', (await rec()) === null);
  await shot('onetap-outside-bm-light.png');
  await p.locator('[data-act=close-overlay]').first().click(); await p.waitForTimeout(200);
  await ctx.setGeolocation(HERE);

  // 2. One tap: location and a steady face, and it saves by itself. A double tap saves one punch.
  await p.evaluate(() => { const b = document.querySelector('.ss-big'); b.click(); b.click(); });   // a double tap
  await p.waitForSelector('.ot-cam', { timeout: 5000 });
  ok('the camera screen has the face oval and a status line', await p.evaluate(() => !!document.querySelector('.ot-oval') && !!document.querySelector('#ot-status')?.innerText));
  await p.waitForFunction(() => /Lokasi OK|Muka dikesan|Hadapkan/.test(document.querySelector('#ot-status')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await shot('onetap-camera-bm-light.png');
  await p.waitForSelector('.ot-done', { timeout: 12000 });
  const doneText = await p.evaluate(() => document.querySelector('.ot-done')?.innerText || '');
  ok('success: a big tick, "Daftar masuk <time> pg/ptg", the place and the status', /Daftar masuk \d{1,2}:\d{2} (pg|ptg)/.test(doneText) && (await p.evaluate(() => !!document.querySelector('.ot-tick svg') && !!document.querySelector('.ot-done .pill'))), doneText.replace(/\n+/g, ' | '));
  await shot('onetap-done-bm-light.png'); await theme('dark'); await shot('onetap-done-bm-dark.png'); await theme('light');
  const r1 = await rec();
  ok('one punch saved with a selfie and a place', !!r1 && !!r1.in && !r1.out && !!r1.photo && !!r1.loc && !(r1.history || []).length, JSON.stringify({ in: r1?.in }));
  await p.waitForSelector('.ot-done', { state: 'detached', timeout: 5000 });
  ok('back to Home after about 2 s, and the button now says Daftar keluar', /Daftar keluar/.test(await bigText()));

  // 3. Daftar keluar is the same one tap. Hours; then in again for a second session.
  await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.attendance && j.session; } catch (e) { return false; } }); const j = JSON.parse(localStorage[k]); const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()); j.attendance[day].e8.in = '08:00'; localStorage[k] = JSON.stringify(j); });
  await p.reload(); await p.waitForSelector('.ss'); await p.waitForTimeout(400); await setup();
  await p.evaluate(() => { window.__otClear = 1; });
  // the one-minute rule is the guard's memory, which a reload clears; the day's record decides in or out
  await p.locator('.ss-big').click(); await p.waitForSelector('.ot-done', { timeout: 15000 });
  const outText = await p.evaluate(() => document.querySelector('.ot-done')?.innerText || '');
  ok('Daftar keluar done in one tap', /Daftar keluar \d{1,2}:\d{2}/.test(outText), outText.replace(/\n+/g, ' | '));
  const r2 = await rec();
  ok('the check-out has its own selfie and place', !!r2.out && !!r2.outPhoto && !!r2.outLoc);
  await p.waitForSelector('.ot-done', { state: 'detached', timeout: 5000 });
  ok('then the button offers Daftar masuk again (a second session)', /Daftar masuk/.test(await bigText()));

  // 4. No face for 8 s: "Muka tidak dikesan" and Ambil gambar.
  await p.evaluate(() => { window.__face = { box: null, count: 0 }; });
  await p.locator('.ss-big').click(); await p.waitForSelector('.ot-cam');
  await p.waitForFunction(() => /Muka tidak dikesan/.test(document.querySelector('#ot-status')?.innerText || ''), null, { timeout: 15000 });
  ok('after 8 s without a face: "Muka tidak dikesan" and an Ambil gambar button', await p.evaluate(() => /Ambil gambar/.test(document.querySelector('#ot-actions')?.innerText || '')));
  await shot('onetap-noface-bm-light.png');
  await p.locator('[data-act=ci-capture]').click(); await p.waitForSelector('.ot-done', { timeout: 15000 });
  const r3 = await rec();
  ok('the manual photo saves the second session', !!r3 && r3.history && r3.history.length === 1 && !!r3.lastIn && !r3.out, JSON.stringify({ lastIn: r3?.lastIn, hist: (r3?.history || []).length }));

  // 5. English, light and dark.
  await p.evaluate(() => { const id = 'e8'; localStorage.setItem(`allurus-lang-${id}`, 'en'); });
  await p.reload(); await p.waitForSelector('.ss'); await p.waitForTimeout(400); await setup();
  ok('English: Check out', /Check out/.test(await bigText()));
  await p.evaluate(() => { window.__face = { box: { x: 100, y: 100, width: 200, height: 240 }, count: 1 }; });
  await p.locator('.ss-big').click(); await p.waitForSelector('.ot-cam');
  await shot('onetap-camera-en-light.png'); await theme('dark'); await shot('onetap-camera-en-dark.png'); await theme('light');
  await p.waitForSelector('.ot-done', { timeout: 15000 });
  ok('English success: "Checked out <time>"', /Checked out \d{1,2}:\d{2} (am|pm)/.test(await p.evaluate(() => document.querySelector('.ot-done')?.innerText || '')));
  await shot('onetap-done-en-light.png'); await theme('dark'); await shot('onetap-done-en-dark.png'); await theme('light');
  ok('no sideways scroll, no text under 11px on the one-tap screens', await p.evaluate(() => document.documentElement.scrollWidth <= 391));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch(async (e) => { console.error(String(e.message).split(String.fromCharCode(10))[0]); try { console.error('OVERLAY:', JSON.stringify(await globalThis.__page.evaluate(() => document.querySelector('#overlay-root')?.innerText || '')).slice(0, 400)); } catch (x) {} process.exit(1); });
