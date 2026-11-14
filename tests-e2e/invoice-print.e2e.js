// Print check for the standard invoice at 1, 10 and 25 lines: real A4 PDFs from the browser, page count and what is on which page.
//   node tests-e2e/invoice-print.e2e.js   (SHOTS=<dir> saves the PDFs and a PNG of each first/last page)
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright-core'));
const P = require(path.join(root, 'js', 'invoice-print.js'));
const css = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
const SHOTS = process.env.SHOTS || '';
const results = []; const ok = (n, pass, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const item = (k) => ({ desc: `Allurus HR module ${k}\nOnboarding, setup and training for the ${k}th team`, qty: String(k), unit: 'unit', price: '1,000.00', amount: `${k},000.00` });
const model = (n, o = {}) => ({
  isInvoice: true, status: 'Sent', company: { name: 'Suria Enterprise Sdn Bhd', initial: 'S', reg: '202101023456', addr: ['Lot 7, Jalan Kampung Tengah, Kawasan Perindustrian Chukai', '24000 Kemaman, Terengganu'], tel: '09-859 2210', email: 'finance@suria.my', tin: 'C25845632000', sst: 'W10-2108-32000187' },
  title: 'Tax Invoice', subtitle: 'Invois Cukai · Tax invoice', no: 'INV-202611-0001', issue: '14/11/2026', due: '21/11/2026', terms: 'Net 7', currency: 'RM', amountHeadline: 'RM 1,000.00',
  customerName: 'Major Far East Sdn Bhd', customer: { addr: ['Lot 1579, KM 105, Jalan Kemaman-Dungun', '24300 Kerteh, Terengganu'], tel: '09-827 0039', email: 'majorfareast@yahoo.com' }, reference: 'PO 4471\nAnnual subscription',
  items: Array.from({ length: n }, (_, k) => item(k + 1)), words: 'Ringgit Malaysia One Thousand Only', notes: 'Thank you for your business.',
  totals: { sub: '1,000.00', taxLabel: 'SST 8%', tax: '80.00', total: '1,080.00', adj: [], hasPays: false, paid: '0.00' },
  payment: { bank: 'Maybank', accName: 'Suria Enterprise Sdn Bhd', accNo: '5630 2882 0314', instructions: 'Use INV-202611-0001 as the payment reference, then email the receipt to finance@suria.my.', qr: '' },
  conditions: 'Deposit due on confirmation; onboarding starts when paid.\nUAT 14 days; accepted on sign-off or 7 days with no major issue.\nBalance invoiced at go-live, due in 14 days.\nRenews yearly unless 30 days notice.', ...o });
const page = (m) => `<!doctype html><html class="printing"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="print-root">${P.html(m, esc)}</div></body></html>`;

(async () => {
  const pdfjs = await import(path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
  const b = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const render = async (name, m) => {
    const p = await b.newPage(); await p.setContent(page(m)); await p.emulateMedia({ media: 'print' });
    const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `invoice-${name}.pdf`), pdf);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf) }).promise, pages = [];
    for (let i = 1; i <= doc.numPages; i++) { const t = await (await doc.getPage(i)).getTextContent(); pages.push(t.items.map((x) => x.str).join(' ')); }
    await p.close(); return { n: doc.numPages, pages };
  };
  for (const n of [1, 10]) {
    const r = await render(`${n}-lines`, model(n));
    ok(`${n} line${n === 1 ? '' : 's'}: one A4 page`, r.n === 1, `${r.n} page(s)`);
    ok(`${n} line${n === 1 ? '' : 's'}: totals, Terms and How to pay are on it`, /Subtotal/i.test(r.pages[0]) && /Terma/i.test(r.pages[0]) && /How to pay/i.test(r.pages[0]));
  }
  const r25 = await render('25-lines', model(25));
  ok('25 lines: two pages', r25.n === 2, `${r25.n} page(s)`);
  ok('25 lines: the table header repeats on page 2', r25.n > 1 && /Unit price/i.test(r25.pages[0]) && /Unit price/i.test(r25.pages[1]));
  ok('25 lines: totals, Terms and How to pay only on the last page', r25.n > 1 && !/Subtotal|How to pay/i.test(r25.pages[0]) && /Subtotal/i.test(r25.pages[r25.n - 1]) && /Terma/i.test(r25.pages[r25.n - 1]) && /How to pay/i.test(r25.pages[r25.n - 1]));
  ok('25 lines: Page x of y is printed', /Page 1 of 2/.test(r25.pages[0]) && /Page 2 of 2/.test(r25.pages[1]));
  const note = await render('credit-note', model(3, { isInvoice: false, status: 'Issued', title: 'Credit note', subtitle: 'Nota kredit · Credit note', forInvoice: 'INV-202611-0001', amountHeadline: 'RM 108.00', reason: 'Returned goods', conditions: '', payment: null }));
  ok('Credit note: same layout, no How to pay, no Terms', note.n === 1 && /Credit note/.test(note.pages[0]) && !/How to pay|Cara bayaran/.test(note.pages[0]) && !/Terma/.test(note.pages[0]));
  const draft = await render('draft', model(2, { status: 'Draft' }));
  ok('Draft: watermark and pill', /DRAFT/.test(draft.pages[0]));
  const sent = await render('sent', model(2, { status: 'Sent' }));
  ok('Sent: no watermark', !/DRAFT|VOID/.test(sent.pages[0]));
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  await b.close().catch(() => {}); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
