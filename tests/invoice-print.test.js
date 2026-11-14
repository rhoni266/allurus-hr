// The standard printed invoice (js/invoice-print.js): structure, status pill, watermark, optional Reference, one-line items, QR only when uploaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/invoice-print.js');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const base = (o = {}) => ({
  isInvoice: true, status: 'Sent', company: { name: 'Suria Enterprise', initial: 'S', reg: '202101023456', addr: ['Lot 7, Chukai', '24000 Kemaman'], tel: '09-859 2210', email: 'finance@suria.my', tin: 'C258', sst: 'W10' },
  title: 'Tax Invoice', subtitle: 'Invois Cukai · Tax invoice', no: 'INV-202611-0001', issue: '14/11/2026', due: '21/11/2026', terms: 'Net 7', currency: 'RM', amountHeadline: 'RM 1,000.00',
  customerName: 'Major Far East', customer: { addr: ['Kerteh'], tel: '09-827 0039' }, reference: '', items: [{ desc: 'Allurus HR\nOnboarding & setup', qty: '1', unit: 'unit', price: '1,000.00', amount: '1,000.00' }],
  words: 'Ringgit Malaysia One Thousand Only', notes: '', totals: { sub: '1,000.00', taxLabel: 'SST 0%', tax: '0.00', total: '1,000.00', adj: [], hasPays: false, paid: '0.00' },
  payment: { bank: 'Maybank', accName: 'Suria', accNo: '5630 2882 0314', instructions: 'Use the invoice no. as the payment reference', qr: '' }, conditions: 'Deposit due on confirmation.\nBalance due at go-live.', ...o });

test('layout: strip, Bill to, one-line items, totals, then Terms (left) and How to pay (right) in one last block', () => {
  const h = P.html(base(), esc);
  for (const w of ['Invoice no.', 'Issued', 'Due', 'Terms', 'Amount due', 'Bill to', 'Kepada', 'Amount in words', 'Subtotal', 'SST 0%', 'Total (RM)', 'How to pay', 'Cara bayaran', 'Bank', 'Maybank', 'Account no.', 'Terma']) assert.ok(h.includes(w), w);
  assert.ok(h.indexOf('invd-strip') < h.indexOf('invd-parties') && h.indexOf('invd-parties') < h.indexOf('invd-items') && h.indexOf('invd-items') < h.indexOf('invd-last'));
  const last = h.slice(h.indexOf('invd-last'));
  assert.ok(last.indexOf('invd-after') < last.indexOf('invd-terms') && last.indexOf('invd-terms') < last.indexOf('invd-pay'), 'totals, then Terms left of How to pay');
  assert.ok(h.includes('<b>Allurus HR</b> <span>· Onboarding &amp; setup</span>'), 'item: bold name · detail on one line');
  assert.ok(!h.includes('invd-mark'), 'no watermark on a sent invoice');
});
test('status pill: Draft, Sent, Partly paid, Paid, Overdue, Void; watermark only for Draft and Void', () => {
  const want = { Draft: 'Draft', Sent: 'Sent', 'Partially paid': 'Partly paid', Paid: 'Paid', Overdue: 'Overdue', Void: 'Void' };
  for (const [st, label] of Object.entries(want)) {
    const h = P.html(base({ status: st }), esc);
    assert.ok(h.includes(`>${label}</div></div></header>`), st);
    assert.equal(h.includes('invd-mark'), st === 'Draft' || st === 'Void', `watermark for ${st}`);
  }
  assert.ok(P.html(base({ status: 'Draft' }), esc).includes('>DRAFT</div>') && P.html(base({ status: 'Void' }), esc).includes('>VOID</div>'));
});
test('Reference is optional: hidden when empty, shown (first line bold) when set', () => {
  assert.ok(!P.html(base(), esc).includes('Rujukan'));
  const h = P.html(base({ reference: 'PO 4471\nProject Kerteh' }), esc);
  assert.ok(h.includes('Rujukan') && h.includes('<div class="name">PO 4471</div>') && h.includes('Project Kerteh'));
});
test('credit, debit and refund notes: same layout, no How to pay and no Terms', () => {
  for (const [type, title] of [['credit', 'Credit note'], ['debit', 'Debit note'], ['refund', 'Refund note']]) {
    const h = P.html(base({ isInvoice: false, status: 'Issued', title, forInvoice: 'INV-1', reason: 'Returned goods' }), esc);
    assert.ok(h.includes(title) && h.includes('For invoice') && h.includes('Returned goods') && h.includes('invd-items') && h.includes('Subtotal'), type);
    assert.ok(!h.includes('How to pay') && !h.includes('invd-terms') && !h.includes('Amount due'), type);
  }
});
test('no QR box unless the company uploaded one; no payment block when nothing is set', () => {
  assert.ok(!P.html(base(), esc).includes('class="qr"'));
  assert.ok(P.html(base({ payment: { bank: 'M', qr: 'data:image/png;base64,AAAA' } }), esc).includes('class="qr"'));
  const none = P.html(base({ payment: null, conditions: '' }), esc);
  assert.ok(!none.includes('invd-bottom') && !none.includes('How to pay'));
  assert.ok(P.html(base({ payment: null }), esc).includes('invd-bottom one'), 'terms alone use the full width');
});
test('everything is escaped, and splitDesc keeps one line per item', () => {
  const h = P.html(base({ customerName: '<img src=x onerror=1>', items: [{ desc: '<b>x</b>', qty: '1', unit: '', price: '1', amount: '1' }] }), esc);
  assert.ok(!h.includes('<img src=x') && h.includes('&lt;img'));
  assert.deepEqual({ ...P.splitDesc('Name · detail here') }, { name: 'Name', detail: 'detail here' });
  assert.deepEqual({ ...P.splitDesc('A\nB\nC') }, { name: 'A', detail: 'B C' });
  assert.deepEqual({ ...P.splitDesc('Only a name') }, { name: 'Only a name', detail: '' });
});
test('print rules in the stylesheet: A4, repeating table header, last block kept together, watermark on every page', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  assert.match(css, /@page inv2 \{[^}]*size: A4 portrait/); assert.match(css, /\.invd-items thead \{ display: table-header-group/);
  assert.match(css, /\.invd-last \{ break-inside: avoid/); assert.match(css, /\.invd-mark \{ position: fixed/);
  assert.match(css, /counter\(page\) " of " counter\(pages\)/);
});
