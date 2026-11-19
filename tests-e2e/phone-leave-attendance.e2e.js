const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);

const SHOTS = process.env.SHOTS || path.join(root, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation'], geolocation: { latitude: 4.245987, longitude: 103.41691 } });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`);
  await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as][data-v^="amirul"]').first().click();
  await p.waitForSelector('#view');
  await p.waitForTimeout(900);

  // Set today to have an approved leave for Amirul
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.leaves && j.session; } catch (e) { return false; } });
    const j = JSON.parse(localStorage[k]);
    const me = j.accounts.find((a) => a.email === j.session.account || a.email === j.session.email);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    j.leaves = j.leaves || [];
    j.leaves.push({
      id: 'test-leave-today',
      empId: me.empId,
      type: 'annual',
      from: day,
      to: day,
      days: 1,
      status: 'Approved',
      reason: 'Personal'
    });
    // Remove any attendance record for today so he's on leave
    if (j.attendance && j.attendance[day]) {
      delete j.attendance[day][me.empId];
    }
    localStorage[k] = JSON.stringify(j);
  });

  await p.reload();
  await p.waitForSelector('.ss');
  await p.waitForTimeout(600);

  // BM Light
  await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'phone-leave-bm-light.png') });

  // BM Dark
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'phone-leave-bm-dark.png') });

  // Click Check In to trigger modal in BM
  await p.locator('.ss-big').click();
  await p.waitForSelector('#overlay-root .modal');
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'phone-leave-modal-bm-dark.png') });

  // Close modal
  await p.locator('#overlay-root [data-act=close-overlay]').first().click();
  await p.waitForTimeout(300);

  // Switch to English
  await p.evaluate(() => document.querySelector('[data-act=ss-me]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-act=ss-lang][data-v=en]').click());
  await p.waitForTimeout(500);

  // EN Dark
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'phone-leave-en-dark.png') });

  // EN Light
  await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'phone-leave-en-light.png') });

  // Click Check In to trigger modal in EN
  await p.locator('.ss-big').click();
  await p.waitForSelector('#overlay-root .modal');
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'phone-leave-modal-en-dark.png') });

  console.log('Screenshots generated successfully in', SHOTS);
  await b.close();
  srv.close();
  process.exit(0);
})();
