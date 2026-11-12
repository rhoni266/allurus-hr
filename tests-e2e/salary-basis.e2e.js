// docs/SALARY-BASIS-SPEC.md in the browser (demo mode, no emulator): monthly by default, the grey line, the lists and profile, the Settings switch,
// Major Far East locked to monthly, and the pay-run safety checks with the tick.   npm run test:e2e-salary
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
    await p.evaluate(() => { const s = document.getElementById('role-switch'); if (s && s.value !== 'admin') { s.value = 'admin'; s.dispatchEvent(new Event('change')); } }); await p.waitForTimeout(400);
    return p;
  };
  const go = async (p, h) => { await p.evaluate((x) => { location.hash = 'dashboard'; }, h); await p.waitForTimeout(250); await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(900); };

  // ---- Major Far East demo: monthly, locked ----
  let p = await open('majorfe');
  await go(p, 'employees');
  const target = await p.evaluate(() => { const s = window.AllurusApp.state, e = s.employees.find((x) => x.status === 'Active' && x.salary > 0 && x.id !== 'e1'); return { id: e.id, yearly: e.salary }; });
  await p.click(`[data-act=edit-emp][data-id="${target.id}"]`); await p.waitForSelector('#f-salary');
  const f1 = await p.evaluate(() => ({ label: document.querySelector('label[for=f-salary]').innerText, val: document.getElementById('f-salary').value, other: document.getElementById('f-salary-other').innerText }));
  ok('Employee form: "Basic salary (monthly) / Gaji pokok (bulanan)" and the monthly figure (yearly ÷ 12)', /Basic salary \(monthly\)/.test(f1.label) && /Gaji pokok \(bulanan\)/.test(f1.label) && Math.abs(Number(f1.val) - target.yearly / 12) < 0.006, `${f1.label} | ${f1.val}`);
  ok('…with the yearly figure underneath in grey', /= RM\s?[\d,]+\.\d\d a year/.test(f1.other), f1.other);
  await p.fill('#f-salary', '2345.55'); await p.waitForTimeout(200);
  ok('…the grey line follows what is typed: "= RM28,146.60 a year"', /= RM\s?28,146\.60 a year/.test(await p.evaluate(() => document.getElementById('f-salary-other').innerText)));
  await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(800);
  const saved = await p.evaluate((id) => window.AllurusApp.state.employees.find((e) => e.id === id).salary, target.id);
  ok('Saved: RM2,345.55 a month is stored as 28,146.60 a year (exact), as payroll has always stored it', saved === 28146.6, String(saved));
  const row = await p.evaluate((id) => document.querySelector(`[data-act=edit-emp][data-id="${id}"]`).closest('tr').innerText.replace(/\s+/g, ' '), target.id);
  const head = await p.evaluate(() => [...document.querySelectorAll('thead th')].map((x) => x.innerText.trim()).join('|'));
  ok('The employee list shows the monthly figure under "Salary / mo"', /Salary \/ mo/.test(head) && /RM\s?2,345\.55/.test(row), row.slice(0, 120));
  await p.evaluate(() => { location.hash = 'settings/payroll'; }); await p.waitForTimeout(1200);
  const set1 = await p.evaluate(() => document.body.innerText);
  ok('Settings → Payroll at Major Far East: "Monthly (fixed for this company)", no switch to yearly', /Salaries are entered as/.test(set1) && /Monthly \(fixed for this company\)/.test(set1) && !(await p.$('[data-act=sal-basis]')));
  const forced = await p.evaluate(() => { window.AllurusApp.state.settings.salaryBasis = 'yearly'; window.AllurusApp.render(); return document.body.innerText; });
  ok('…even if the setting were yearly, the screens stay monthly', /Monthly \(fixed for this company\)/.test(forced));
  await p.evaluate(() => { window.AllurusApp.state.settings.salaryBasis = 'monthly'; });

  // ---- pay run safety checks ----
  await go(p, 'payroll');
  const setup = await p.evaluate(() => {
    const s = window.AllurusApp.state, act = s.employees.filter((e) => e.status === 'Active' && e.id !== 'e1');
    act[0].salary = 0; act[1].salary = 12 * 1500;                    // no salary; below the minimum wage
    return { none: `${act[0].first}`, low: `${act[1].first}` };
  });
  await p.click('[data-act=pay-run]'); await p.waitForTimeout(1200);
  await p.click('[data-act=pay-approve]'); await p.waitForTimeout(800);
  const m1 = await p.evaluate(() => ({ t: (document.querySelector('.modal, [role=dialog]')?.innerText || '').split(/\s+/).join(' '), tick: !!document.getElementById('sal-tick'), status: window.AllurusApp.state.payroll[Object.keys(window.AllurusApp.state.payroll).sort().pop()].status }));
  ok('Approve and pay with a no-salary person and one below RM1,700: "Check these before paying" lists them', /Check these before paying/.test(m1.t) && m1.t.includes(setup.none) && m1.t.includes(setup.low) && /No salary/.test(m1.t) && /Below the minimum wage/.test(m1.t), m1.t.slice(0, 160));
  ok('…the run is still a draft, and a tick is required', m1.status === 'Draft' && m1.tick);
  await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(700);
  const still = await p.evaluate(() => window.AllurusApp.state.payroll[Object.keys(window.AllurusApp.state.payroll).sort().pop()].status);
  ok('…pressing the button without the tick does not pay', still === 'Draft');
  await p.check('#sal-tick'); await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(1200);
  // Major Far East also asks about production days that need a look: confirm that one too
  if (/needs a look/.test(await p.evaluate(() => document.querySelector('.modal, [role=dialog]')?.innerText || ''))) { await p.click('.modal [type=submit], [role=dialog] [type=submit]'); await p.waitForTimeout(1200); }
  const after = await p.evaluate(() => window.AllurusApp.state.payroll[Object.keys(window.AllurusApp.state.payroll).sort().pop()].status);
  ok('…with the tick it pays', after === 'Paid', after);

  // ---- a company that is free to choose ----
  p = await open('');
  await p.evaluate(() => { location.hash = 'settings/payroll'; }); await p.waitForTimeout(1200);
  ok('Another company: Settings → Payroll has the Monthly / Yearly switch, monthly selected', await p.evaluate(() => [...document.querySelectorAll('[data-act=sal-basis]')].map((x) => x.innerText + (x.classList.contains('on') ? '*' : '')).join(',') === 'Monthly*,Yearly'));
  await p.click('[data-act=sal-basis][data-v=yearly]'); await p.waitForTimeout(500);
  ok('…choosing Yearly changes only how it is typed and shown', await p.evaluate(() => window.AllurusApp.state.settings.salaryBasis === 'yearly'));
  await go(p, 'employees');
  const tgt = await p.evaluate(() => { const e = window.AllurusApp.state.employees.find((x) => x.status === 'Active' && x.salary > 0); return { id: e.id, y: e.salary }; });
  await p.click(`[data-act=edit-emp][data-id="${tgt.id}"]`); await p.waitForSelector('#f-salary');
  const f2 = await p.evaluate(() => ({ label: document.querySelector('label[for=f-salary]').innerText, val: Number(document.getElementById('f-salary').value), other: document.getElementById('f-salary-other').innerText }));
  ok('Yearly company: "Basic salary (yearly) / Gaji pokok (tahunan)", the stored figure, and "= RM… a month" underneath', /Basic salary \(yearly\)/.test(f2.label) && /tahunan/.test(f2.label) && f2.val === tgt.y && /a month/.test(f2.other), `${f2.label} | ${f2.val} | ${f2.other}`);
  await p.keyboard.press('Escape');
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
