// Payment schedule on the invoice form (Suria demo, admin): rows must add up to the total or saving is blocked; a good schedule saves,
// the invoice due date follows the first instalment, and the saved invoice prints with Due now / Invoice total.
//   node tests-e2e/invoice-schedule.e2e.js
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright-core'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=suria`); await p.waitForSelector('[data-act=demo-as]');
  await p.locator('[data-act=demo-as][data-v^="rosli"]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(700);
  await p.evaluate(() => { location.hash = 'finance'; }); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('[data-act=fin-new-inv]')?.click()); await p.waitForSelector('#lg-sched');
  await p.fill('#lg-cust', 'Kedai Maju'); await p.fill('.lg-line [name=d]', 'Allurus HR annual subscription'); await p.fill('.lg-line [name=q]', '1'); await p.fill('.lg-line [name=p]', '3000');
  await p.selectOption('#lg-tax', '0').catch(() => {});
  await p.click('[data-lg=sadd]'); await p.click('[data-lg=sadd]');
  const rows = p.locator('.lg-srow');
  await rows.nth(0).locator('[name=sl]').fill('Deposit'); await rows.nth(0).locator('[name=sa]').fill('1000'); await rows.nth(0).locator('[name=sd]').fill('2026-12-05');
  await rows.nth(1).locator('[name=sl]').fill('Balance'); await rows.nth(1).locator('[name=sa]').fill('1500'); await rows.nth(1).locator('[name=st]').fill('At go-live');
  await p.waitForTimeout(200);
  ok('Live sum: short by 500.00', /short by 500\.00/.test(await p.textContent('#lg-ssum')), await p.textContent('#lg-ssum'));
  await p.click('[data-lg=save]'); await p.waitForTimeout(400);
  ok('Saving is blocked while the instalments do not add up', await p.evaluate(() => /adds up to 2500\.00/.test(document.querySelector('#lg-errors')?.innerText || '') && !document.querySelector('#lg-errors').hidden));
  await rows.nth(1).locator('[name=sa]').fill('2000'); await p.waitForTimeout(200);
  ok('Live sum: equals the invoice total', /= invoice total/.test(await p.textContent('#lg-ssum')));
  ok('The invoice due date follows the first instalment', (await p.inputValue('#lg-due')) === '2026-12-05');
  await p.click('[data-lg=save]'); await p.waitForTimeout(800);
  const saved = await p.evaluate(() => { const l = window.AllurusApp.state.finance.invoices.filter((i) => i.customer === 'Kedai Maju'); const x = l[l.length - 1]; return x && { n: l.length, sched: x.schedule, status: x.status }; });
  ok('A good schedule saves with the invoice', saved && saved.n === 1 && saved.sched.length === 2 && saved.sched[0].label === 'Deposit' && saved.sched[1].dueText === 'At go-live' && saved.status === 'Draft', JSON.stringify(saved));
  const html = await p.evaluate(() => { const A = window.AllurusApp.state.finance, i = A.invoices.find((x) => x.customer === 'Kedai Maju'); const IR = window.AllurusInvoiceRules; return { due: IR.dueNow(i, '2026-11-14'), first: IR.instalments(i, '2026-11-14')[0].status }; });
  ok('Due now is the deposit', html.due === 1000 && html.first === 'Due', JSON.stringify(html));
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
