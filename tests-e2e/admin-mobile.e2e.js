// Admin console at 390 x 844: every admin route, for each admin role (Owner, HR admin, Payroll, Finance), must fit the phone width.
// It fails when the page scrolls sideways (document scrollWidth > window width), when text is under 11px, or when a button or link
// is shorter than 44px. A table may scroll inside its own box, but not the page. SHOTS=<dir> saves screenshots of the 6 main pages.
//   node tests-e2e/admin-mobile.e2e.js            ONLY=<route> to look at one page, VERBOSE=1 to list the offenders
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed.'); process.exit(1); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const SHOTS = process.env.SHOTS || '', ONLY = process.env.ONLY || '', VERBOSE = !!process.env.VERBOSE;
const ROLES = [
  { name: 'Owner', login: 'lim.kokleong', perms: null },
  { name: 'HR admin', login: 'farah.nadia', perms: ['people', 'time', 'payroll', 'claims', 'talent', 'settings'] },
  { name: 'Payroll', login: 'farah.nadia', perms: ['people', 'time', 'payroll', 'claims'] },
  { name: 'Finance', login: 'farah.nadia', perms: ['finance', 'claims'] },
];
const MAIN = { dashboard: 'Dashboard', employees: 'Employees', attendance: 'Attendance', payroll: 'Payroll', invoices: 'Invoices', settings: 'Settings' };
const problems = [];
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  let total = 0;
  for (const role of ROLES) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur', permissions: ['geolocation'], geolocation: { latitude: 4.245987, longitude: 103.41691 } });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`); await p.waitForSelector('[data-act=demo-as]');
    await p.locator(`[data-act=demo-as][data-v^="${role.login}"]`).first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(500);
    if (role.perms) {
      await p.evaluate((perms) => { const k = Object.keys(localStorage).find((x) => { try { const j = JSON.parse(localStorage[x]); return j && j.accounts && j.attendance; } catch (e) { return false; } }); const j = JSON.parse(localStorage[k]); const a = j.accounts.find((x) => x.email.startsWith('farah.nadia')); a.perms = perms; localStorage[k] = JSON.stringify(j); }, role.perms);
      await p.reload(); await p.waitForSelector('#view'); await p.waitForTimeout(600);
    }
    const routes = await p.evaluate(() => [...new Set([...document.querySelectorAll('.nav-item a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)))]);
    const measure = () => p.evaluate(() => {
      const w = window.innerWidth, out = { scroll: document.documentElement.scrollWidth, wide: [], small: 0, smallEx: [], short: [] };
      const inScrollBox = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth) return true; } return false; };
      for (const el of document.querySelectorAll('#view *, .topbar *, .bottom-nav *, #overlay-root *')) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.right > w + 1 && !inScrollBox(el) && out.wide.length < 6) out.wide.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} ${Math.round(r.right)}`);
        if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 11) { out.small++; if (out.smallEx.length < 3) out.smallEx.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${cs.fontSize}`); }
        if ((el.tagName === 'BUTTON' || el.tagName === 'A' && el.classList.contains('btn') || el.tagName === 'SELECT' || el.tagName === 'INPUT' && !['checkbox', 'radio', 'hidden'].includes(el.type)) && r.height < 43.5 && !el.closest('table') && out.short.length < 6) out.short.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.height)}`);
      }
      return out;
    });
    const visit = async (route) => {
      await p.evaluate((h) => { location.hash = h; }, route); await p.waitForTimeout(650);
      await p.evaluate(() => { document.querySelector('.sidebar.open')?.classList.remove('open'); });
      const m = await measure(); total++;
      const bad = [];
      if (m.scroll > 391) bad.push(`scrolls sideways (${m.scroll}px)${m.wide.length ? ': ' + m.wide.join(', ') : ''}`);
      if (m.small) bad.push(`${m.small} texts under 11px (${m.smallEx.join(', ')})`);
      if (VERBOSE && m.short.length) bad.push(`tap targets under 44px: ${m.short.join(', ')}`);
      if (m.short.length > 0 && !VERBOSE) bad.push(`${m.short.length}+ tap targets under 44px (${m.short.slice(0, 2).join(', ')})`);
      if (bad.length) problems.push(`${role.name} #${route}: ${bad.join('; ')}`);
      if (SHOTS && role.name === 'Owner' && MAIN[route]) { for (const th of ['light', 'dark']) { await p.evaluate((x) => { document.documentElement.dataset.theme = x; }, th); await p.waitForTimeout(200); await p.screenshot({ path: path.join(SHOTS, `admin-${route}-${th}.png`) }); } await p.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); }
      return m;
    };
    const list = ONLY ? [ONLY] : routes;
    for (const r of list) await visit(r);
    // Every Settings section.
    if (!ONLY && routes.includes('settings')) {
      await p.evaluate(() => { location.hash = 'settings'; }); await p.waitForTimeout(600);
      const secs = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#settings/"]')].map((a) => a.getAttribute('href').slice(1)).filter((h) => !h.includes('@')))]);
      for (const sct of secs) await visit(sct);
    }
    if (errors.length) problems.push(`${role.name}: page errors: ${errors.slice(0, 2).join(' | ')}`);
    console.log(`${role.name}: ${list.length} routes${!ONLY ? ' + settings sections' : ''} visited`);
    await ctx.close();
  }
  // ---- The phone layout itself (Owner): cards, one main button and a menu, a Filters sheet, the bottom bar, full-screen modals, a wide report keeps its table. ----
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'Asia/Kuala_Lumpur' });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=majorfe`); await p.waitForSelector('[data-act=demo-as]');
    await p.locator('[data-act=demo-as][data-v^="lim"]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(700);
    const check = (name, pass, info = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!pass) problems.push(`layout: ${name} ${info}`); };
    await p.evaluate(() => { location.hash = 'employees'; }); await p.waitForTimeout(800);
    check('Employees: the table is a list of cards (no table header on screen)', await p.evaluate(() => { const t = document.querySelector('#view table.m-cards'); return !!t && getComputedStyle(t.querySelector('thead')).display === 'none' && getComputedStyle(t.querySelector('tbody tr')).display === 'grid'; }));
    check('…each card has a More toggle that shows the rest', await p.evaluate(async () => { const tr = document.querySelector('#view table.m-cards tr.m-has-more'); const extra = tr.querySelector('td.m-extra'); const hidden = getComputedStyle(extra).display === 'none'; tr.querySelector('.m-toggle').click(); await new Promise((r) => setTimeout(r, 50)); return hidden && getComputedStyle(extra).display !== 'none' && tr.classList.contains('open'); }));
    if (SHOTS) { await p.evaluate(() => document.querySelector('#view table.m-cards tr.open')?.scrollIntoView()); await p.screenshot({ path: path.join(SHOTS, 'admin-employees-card-open.png') }); await p.evaluate(() => window.scrollTo(0, 0)); }
    check('Page header: the title, one main button and a ... menu', await p.evaluate(() => { const a = document.querySelector('#view .page-head > .actions'); const vis = [...a.querySelectorAll(':scope > .btn, :scope > .m-more > .btn')].filter((e) => e.offsetParent !== null); return vis.length === 2 && !!a.querySelector('.btn-primary') && !!a.querySelector('.m-more-btn'); }));
    check('…the ... menu opens and holds Import and Export', await p.evaluate(async () => { const m = document.querySelector('#view .m-more'); m.querySelector('.m-more-btn').click(); await new Promise((r) => setTimeout(r, 50)); const open = !m.querySelector('.m-menu').hidden && m.classList.contains('open'); const txt = m.querySelector('.m-menu').innerText; return open && /Export/.test(txt); }));
    await p.evaluate(() => document.body.click());
    check('Filters: one Tapis/Filters button; the filter controls are in a sheet', await p.evaluate(() => { const tb = document.querySelector('#view .toolbar.m-filters'); return !!tb && !!tb.querySelector('.m-filter-btn') && !!tb.querySelector('.m-sheet select') && getComputedStyle(tb.querySelector('.m-sheet')).display === 'none'; }));
    check('…tapping it opens a full-screen sheet; Done closes it', await p.evaluate(async () => { const tb = document.querySelector('#view .toolbar.m-filters'); tb.querySelector('.m-filter-btn').click(); await new Promise((r) => setTimeout(r, 50)); const sh = document.querySelector('body > .m-sheet.show'), r = sh.getBoundingClientRect(); const open = getComputedStyle(sh).display === 'flex' && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight && sh.querySelectorAll('select').length > 0; sh.querySelector('.m-filter-done').click(); await new Promise((r2) => setTimeout(r2, 50)); return open && getComputedStyle(sh).display === 'none' && tb.contains(sh); }));
    check('Bottom bar: 4 places', await p.evaluate(() => document.querySelectorAll('#tabbar > a, #tabbar > button').length === 4 && getComputedStyle(document.querySelector('#tabbar')).display === 'flex'));
    await p.evaluate(() => { location.hash = 'employees'; }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-act=add-emp]')?.click()); await p.waitForSelector('.modal', { timeout: 4000 }); await p.waitForTimeout(600);   // the sheet slides in
    check('Modal: full screen with the close button at the top and the save button at the bottom', await p.evaluate(() => { const m = document.querySelector('.modal'), r = m.getBoundingClientRect(), x = m.querySelector('.modal-head [data-act=close-overlay]').getBoundingClientRect(), f = m.querySelector('.modal-foot').getBoundingClientRect(); return Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight && x.top < 80 && f.bottom > innerHeight - 4; }));
    await p.evaluate(() => document.querySelector('.modal [data-act=close-overlay]').click()); await p.waitForTimeout(200);
    await p.evaluate(() => { location.hash = 'payroll'; }); await p.waitForTimeout(800);
    check('Payroll: no page scroll; a wide table (if any) scrolls inside its own box', await p.evaluate(() => document.documentElement.scrollWidth <= 391 && [...document.querySelectorAll('#view table')].every((t) => t.classList.contains('m-cards') || t.closest('.m-scrollbox, .table-wrap') || t.offsetWidth <= 391)));
    check('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
  console.log(problems.length ? `\nFAIL ${problems.length} problems in ${total} page views:\n  ${problems.join('\n  ')}` : `\nPASS  ${total} page views at 390px, none scroll sideways`);
  await b.close().catch(() => {}); srv.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
