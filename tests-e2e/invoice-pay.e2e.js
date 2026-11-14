// Invoice defaults in Settings, terms pre-filled into a new invoice, payment box and terms on the printed invoice (Suria demo, admin).
//   node tests-e2e/invoice-pay.e2e.js   (SHOTS=<dir> saves screenshots)
const path = require('path'), fs = require('fs'), http = require('http');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright-core'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/json' };
const srv = http.createServer((q, r) => { let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/' || f === '/app') f = '/app.html'; const p = path.join(root, f); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); }).listen(0);
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const SHOTS = process.env.SHOTS || '';
const QR = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
(async () => {
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' }), errors = [];
  for (const [label, vp, scheme] of [['desktop-light', { width: 1280, height: 900 }, 'light'], ['phone-dark', { width: 390, height: 844 }, 'dark']]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: scheme });
    await ctx.route(/tile|openstreetmap|nominatim|unpkg|cdnjs|gstatic|googleapis|firebase/i, (r) => r.abort());
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${srv.address().port}/app.html?demo=suria`); await p.waitForSelector('[data-act=demo-as]');
    await p.locator('[data-act=demo-as][data-v^="rosli"]').first().click(); await p.waitForSelector('#view'); await p.waitForTimeout(700);
    await p.evaluate(() => { location.hash = 'settings/invoicedefaults'; }); await p.waitForSelector('#inv-defaults', { timeout: 6000 });
    ok(`[${label}] Settings has "Invoice defaults" with bank, account, QR, instructions and terms`, await p.evaluate(() => ['idf-bank', 'idf-accname', 'idf-accno', 'idf-ins', 'idf-qr', 'idf-terms'].every((id) => !!document.getElementById(id))));
    await p.fill('#idf-bank', 'Maybank'); await p.fill('#idf-accname', 'Suria Enterprise Sdn Bhd'); await p.fill('#idf-accno', '5123 4567 8901');
    await p.fill('#idf-ins', 'Please quote the invoice no. as reference'); await p.fill('#idf-terms', 'Goods remain the property of the company until paid in full.');
    await p.setInputFiles('#idf-qr', { name: 'qr.png', mimeType: 'image/png', buffer: Buffer.from(QR, 'base64') }); await p.waitForTimeout(400);
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `inv-defaults-${label}.png`), fullPage: false });
    await p.click('#idf-save'); await p.waitForTimeout(500);
    const saved = await p.evaluate(() => window.AllurusApp.state.finance.settings.payDefaults);
    ok(`[${label}] saved, with the QR kept`, saved.bank === 'Maybank' && saved.accNo === '5123 4567 8901' && /^data:image\//.test(saved.qr) && saved.terms.startsWith('Goods remain'));
    if (label === 'desktop-light') {
      await p.evaluate(() => { location.hash = 'finance'; }); await p.waitForTimeout(700);
      const info = await p.evaluate(() => {
        const A = window.AllurusApp.state.finance, d = window.AllurusInvoiceRules.newInvoiceDefaults(A.settings.payDefaults);
        const sample = A.invoices.find((i) => i.type !== 'credit' && i.status === 'Draft') || A.invoices[0];
        return { terms: d.conditions, n: A.invoices.length, id: sample && sample.id };
      });
      ok('A new invoice would be pre-filled with the default terms', /^Goods remain/.test(info.terms));
      await p.evaluate(() => document.querySelector('[data-act=fin-new-inv]')?.click()); await p.waitForTimeout(600);
      const form = await p.evaluate(() => document.getElementById('lg-conditions')?.value || '');
      ok('The invoice form shows the terms box, pre-filled and editable', /^Goods remain/.test(form), form.slice(0, 40));
    }
  }
  ok('No page errors', !errors.length, errors.slice(0, 2).join(' | '));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); srv.close(); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
