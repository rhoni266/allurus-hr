// Pay run table at a company with production commission (Major Far East demo): the Bonus column is replaced by Output (the month's
// commission and its days), with a summary chip; other companies keep Bonus. Demo mode: no emulator needed.
//   npm run test:e2e-demo
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = (() => { try { return require(process.env.PW || path.join(root, 'node_modules', 'playwright-core')); } catch (e) { console.error('playwright-core is not installed (npm install), or set PW.'); process.exit(2); } })();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const base = () => `http://127.0.0.1:${srv.address().port}`;
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  const open = async (company) => {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${base()}/app.html?demo${company ? '=' + company : ''}`); await p.waitForSelector('[data-act=demo-as]');
    await p.locator('[data-act=demo-as]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(600);
    await p.evaluate(() => { const s = document.getElementById('role-switch'); if (s && s.value !== 'admin') { s.value = 'admin'; s.dispatchEvent(new Event('change')); } });
    await p.waitForTimeout(400);
    return p;
  };

  // Major Far East: three people checked in today, one production day, then payroll.
  let p = await open('majorfe');
  const setup = await p.evaluate(() => {
    const s = window.AllurusApp.state, T = new Date().toLocaleDateString('en-CA');
    const wh = s.employees.filter((e) => e.dept === 'd-wh' && e.status === 'Active').slice(0, 5);
    s.attendance[T] = s.attendance[T] || {};
    wh.forEach((e, i) => { s.attendance[T][e.id] = i < 3 ? { s: 'present', in: '08:' + (50 + i) } : { s: 'absent', in: '' }; });
    s.employees.filter((e) => !wh.includes(e) && e.dept === 'd-wh').forEach((e) => { s.attendance[T][e.id] = { s: 'absent', in: '' }; });
    return { T, ids: wh.map((e) => e.id) };
  });
  await p.evaluate(() => { location.hash = 'production'; }); await p.waitForTimeout(900);
  await p.fill('#pd-units', '1000'); await p.waitForTimeout(300); await p.click('#pd-form [type=submit]'); await p.waitForTimeout(800);
  await p.evaluate(() => { location.hash = 'dashboard'; }); await p.waitForTimeout(300); await p.evaluate(() => { location.hash = 'payroll'; }); await p.waitForTimeout(900);
  await p.click('[data-act=pay-run]'); await p.waitForTimeout(1200);
  const heads = await p.evaluate(() => [...document.querySelectorAll('.card-flush thead th')].map((x) => x.innerText.trim()));
  ok('Major Far East pay run: the Bonus column is replaced by Output', heads[0] === 'Employee' && heads[1] === 'Output' && !heads.includes('Bonus'), heads.join(' | '));
  const rows = await p.evaluate((ids) => [...document.querySelectorAll('.card-flush tbody tr')].map((tr) => ({ id: tr.querySelector('[data-act=payslip]')?.dataset.id, out: tr.children[1].innerText.trim(), hasInput: !!tr.querySelector('[data-bonus]') })).filter((r) => r.id), setup.ids);
  const withOut = rows.filter((r) => /RM\s?[\d,.]+ · \d+ day/.test(r.out));
  ok('…each person who shared the pool shows "RM16.66 · 1 day"-style output; everyone else shows a dash', withOut.length === 3 && rows.filter((r) => r.out === '—').length === rows.length - 3 && withOut.every((r) => /16\.66 · 1 day/.test(r.out)), withOut.map((r) => r.out).join(', '));
  ok('…no bonus input boxes in the table', !rows.some((r) => r.hasInput));
  const chip = await p.evaluate(() => document.getElementById('output-chip')?.innerText || '');
  ok('…a summary chip at the top: "Output: RM49.98 to 3 staff"', /^Output: RM\s?49\.98 to 3 staff$/.test(chip), chip);
  await p.screenshot({ path: (process.env.SHOTS || '.') + '/output-column.png' });
  await p.click(`[data-act=out-days][data-id="${withOut.length ? rows.find((r) => /day/.test(r.out)).id : ''}"]`); await p.waitForTimeout(500);
  const modal = await p.evaluate(() => (document.querySelector('.modal, [role=dialog]')?.innerText || '').split(/\s+/).join(' '));
  ok('…clicking it opens that person\'s day list (the day, the production, the share, Paid)', /Output ·/.test(modal) && /1,000/.test(modal) && /16\.66/.test(modal) && /Paid/.test(modal), modal.slice(0, 140));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // A bonus, if ever needed, in the payslip editor only.
  const target = rows.find((r) => /day/.test(r.out)).id;
  await p.click(`[data-act=payslip][data-id="${target}"]`); await p.waitForTimeout(500);
  ok('A bonus can still be added in the payslip editor (draft run)', await p.evaluate(() => !!document.getElementById('slip-bonus')));
  await p.fill('#slip-bonus', '100'); await p.click('[data-act=slip-bonus]'); await p.waitForTimeout(800);
  const item = await p.evaluate((id) => { const s = window.AllurusApp.state, r = s.payroll[Object.keys(s.payroll).sort().pop()]; const it = r.items.find((i) => i.empId === id); return { bonus: it.bonus, gross: it.gross, prod: (it.extraLines || []).some((l) => l.key === 'prod') }; }, target);
  ok('…it is saved on that person and the commission line is still there', item.bonus === 100 && item.prod && item.gross > 100, JSON.stringify(item));
  const heads2 = await p.evaluate(() => [...document.querySelectorAll('.card-flush thead th')].map((x) => x.innerText.trim()));
  ok('…the table still shows Output, not Bonus', heads2[1] === 'Output');

  // Another company keeps Bonus.
  const q = await open('');
  await q.evaluate(() => { location.hash = 'payroll'; }); await q.waitForTimeout(900);
  await q.click('[data-act=pay-run]').catch(() => {}); await q.waitForTimeout(1200);
  const h3 = await q.evaluate(() => ({ heads: [...document.querySelectorAll('.card-flush thead th')].map((x) => x.innerText.trim()), inputs: document.querySelectorAll('[data-bonus]').length, chip: !!document.getElementById('output-chip') }));
  ok('Another company (no production commission): Bonus column with its inputs, no Output chip', h3.heads[1] === 'Bonus' && h3.inputs > 0 && !h3.chip, h3.heads.join(' | '));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
