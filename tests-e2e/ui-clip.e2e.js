// No overlapping numbers and no clipped text, at 390px and 1280px, on every admin page (Owner), with hard cases typed in:
// department names in capitals, a very long description, large salaries (so the compact money is "RM 415.2K" and wider), long names.
// It fails when: a figure or label is cut (scrollWidth > clientWidth), two figures in one row overlap, initials do not fit their circle,
// or the page scrolls sideways. SHOTS=<dir> saves screenshots of the departments page (390 and 1280, light and dark).
//   node tests-e2e/ui-clip.e2e.js
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const SHOTS = process.env.SHOTS || '';
const problems = [];
const STATE_KEY = '(function(){return Object.keys(localStorage).find(function(x){try{var j=JSON.parse(localStorage[x]);return j&&j.accounts&&j.attendance}catch(e){return false}})})()';
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  let views = 0;
  for (const vp of [{ w: 390, h: 844, mobile: true }, { w: 1280, h: 800, mobile: false }]) {
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur' });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`); await p.waitForSelector('[data-act=demo-as]');
    await p.locator('[data-act=demo-as][data-v^="lim"]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(500);
    // Hard cases, typed as real data was: capitals, long text, big money, long names.
    await p.evaluate((keyJs) => {
      const k = eval(keyJs); const j = JSON.parse(localStorage[k]);
      const caps = ['SUPERVISORY STAFF', 'SUPERVICE DAILY PRODUCTION AND DELIVERY', 'HR, ADMIN & ACCOUNTS', 'WAREHOUSE'];
      j.departments.forEach((d, i) => { d.name = caps[i % caps.length]; d.about = i % 2 ? 'SUPERVICE DAILY PRODUCTION' : 'Looks after the whole yard, the lorries, the stock count and the daily orders for every contractor and shop.'; });
      j.employees.forEach((e, i) => { e.salary = (i % 3 === 0 ? 415200 : i % 3 === 1 ? 48000 : 19800) * 12 / 12 * (i % 2 ? 1 : 10); });
      j.employees[0].first = 'MUHAMMAD AMIRUL HAKIM'; j.employees[0].last = 'BIN MOHD ZAKARIA';
      localStorage[k] = JSON.stringify(j);
    }, STATE_KEY);
    await p.reload(); await p.waitForSelector('#view'); await p.waitForTimeout(700);
    const routes = await p.evaluate(() => [...new Set([...document.querySelectorAll('.nav-item a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)))]);
    const scan = () => p.evaluate(() => {
      const bad = [], w = window.innerWidth;
      const clipped = (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline';
      for (const el of document.querySelectorAll('#view .stat-v, #view .stat-l, #view .kpi-value, #view .kpi-chip, #view .kpi-label, #view .avatar, #view .pill, #view .tag, #view .dcard-top h3')) {
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        if (clipped(el)) bad.push(`clipped ${el.className.toString().split(' ')[0]} "${el.textContent.trim().slice(0, 24)}" (${el.scrollWidth}>${el.clientWidth})`);
      }
      // two figures in one row must not overlap
      for (const row of document.querySelectorAll('#view .stats, #view .grid.g-4, #view .kpis')) {
        const kids = [...row.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width);
        for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i], c = kids[j]; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) bad.push(`overlap in ${row.className.toString().split(' ')[0]}`); }
      }
      if (document.documentElement.scrollWidth > w + 1) bad.push(`page scrolls sideways (${document.documentElement.scrollWidth}>${w})`);
      return [...new Set(bad)].slice(0, 6);
    });
    for (const r of routes) {
      await p.evaluate((h) => { location.hash = h; }, r); await p.waitForTimeout(550); views++;
      const bad = await scan(); if (bad.length) problems.push(`${vp.w}px #${r}: ${bad.join('; ')}`);
    }
    // The departments page in detail.
    await p.evaluate(() => { location.hash = 'departments'; }); await p.waitForTimeout(700);
    const d = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('.dcard')];
      const names = cards.map((c) => c.querySelector('.dcard-top h3').innerText.trim());
      const initials = [...document.querySelectorAll('.dcard .avatar')].map((a) => ({ t: a.textContent, ok: a.scrollWidth <= a.clientWidth + 1 && a.textContent.length <= 2, fs: parseFloat(getComputedStyle(a).fontSize) / a.getBoundingClientRect().width }));
      const money = [...document.querySelectorAll('.dcard .stats > div:not(:first-child) .stat-v')].map((e) => ({ t: e.textContent, title: e.getAttribute('title'), ok: e.scrollWidth <= e.clientWidth + 1 }));
      const grid = getComputedStyle(document.querySelector('.dept-grid')).gridTemplateColumns;
      const fonts = { sans: getComputedStyle(document.body).fontFamily.split(',')[0], compact: getComputedStyle(document.querySelector('.stat-l')).fontFamily };
      const caps = names.filter((n) => n === n.toUpperCase() && n.length > 3 && !/^HR/.test(n));
      return { names, caps: caps.length, initials, money, grid, fonts, sw: document.documentElement.scrollWidth, tab: getComputedStyle(document.querySelector('.stat-v')).fontVariantNumeric };
    });
    const chk = (n, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${vp.w}px ${n}${info ? '  — ' + info : ''}`); if (!ok) problems.push(`${vp.w}px ${n} ${info}`); };
    chk('department names are not shouted (only the first letter is a capital)', d.caps === 0, d.names.slice(0, 3).join(' | '));
    chk('initials are 2 letters at about 40% of the circle and fit', d.initials.length > 0 && d.initials.every((i) => i.ok && Math.abs(i.fs - 0.4) < 0.03), d.initials.filter((i) => !i.ok).map((i) => i.t).join(','));
    chk('money is compact with the full amount in a tooltip, and fits', d.money.length > 0 && d.money.every((m) => m.ok && m.title && /RM|\d/.test(m.title)), d.money.slice(0, 3).map((m) => `${m.t} [${m.title}]`).join(' '));
    await p.evaluate(() => { location.hash = 'employees'; }); await p.waitForTimeout(700);
    const nm = await p.evaluate(() => { const all = [...document.querySelectorAll('#view .person *, #view table tbody td *')].filter((e) => !e.children.length).map((e) => e.textContent.trim()); const hasLead = all.some((t) => /^Muhammad Amirul Hakim bin Mohd Zakaria$/.test(t)); return { hasLead, shouted: all.filter((t) => t.length > 6 && t === t.toUpperCase() && /[A-Z]{4}/.test(t) && !/^(RM|ACTIVE|INACTIVE)/.test(t)) }; });
    chk('people names typed in capitals are shown as names (and the test data was in capitals)', nm.hasLead && nm.shouted.length === 0, JSON.stringify({ lead: nm.hasLead, shouted: nm.shouted.slice(0, 2) }));
    await p.evaluate(() => { location.hash = 'departments'; }); await p.waitForTimeout(500);
    chk('figures use tabular numbers', /tabular-nums/.test(d.tab), d.tab);
    chk('the card grid is auto-fill, no sideways scroll', /px/.test(d.grid) && d.sw <= vp.w + 1, d.grid);
    chk('the app font starts with the system stack (SF Pro first) and Inter is available', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-sans').includes('SF Pro Text') && getComputedStyle(document.documentElement).getPropertyValue('--font-sans').includes('Inter') && document.fonts.check('12px Inter')));
    if (SHOTS) for (const th of ['light', 'dark']) { await p.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await p.waitForTimeout(250); await p.screenshot({ path: path.join(SHOTS, `departments-${vp.w}-${th}.png`), fullPage: false }); }
    if (errors.length) problems.push(`${vp.w}px page errors: ${errors.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }
  console.log(problems.length ? `\nFAIL ${problems.length} problems in ${views} page views:\n  ${problems.join('\n  ')}` : `\nPASS  ${views} page views at 390px and 1280px: no overlapping or clipped figures`);
  await b.close().catch(() => {}); srv.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
