// Invoice payment details and terms: defaults into a new invoice, an issued invoice keeps its own copy, the print blocks.  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'invoice-rules.js'), 'utf8'), sandbox);
const R = sandbox.window.AllurusInvoiceRules;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const live = { bank: 'Maybank', accName: 'Kedai Ali Sdn Bhd', accNo: '5123 4567 8901', instructions: 'Please quote the invoice no. as reference', qr: QR, terms: 'Goods remain the property of the company until paid in full.' };
const inv = (o = {}) => ({ type: 'invoice', no: 'INV-202611-0001', status: 'Draft', items: [], notes: 'Deliver to the back door', ...o });

test('defaults: a new invoice gets the default terms (up to 1000 characters); payment details are not copied until it is issued', () => {
  assert.equal(R.newInvoiceDefaults(live).conditions, live.terms);
  assert.equal(R.newInvoiceDefaults({}).conditions, '');
  assert.equal(R.newInvoiceDefaults({ terms: 'x'.repeat(1500) }).conditions.length, 1000, 'cut at 1000');
  const d = R.payDefaults({ ...live, bank: ' Maybank ', qr: 'javascript:alert(1)', accNo: 'y'.repeat(100) });
  assert.equal(d.bank, 'Maybank'); assert.equal(d.qr, '', 'only a PNG, JPEG or WebP data image is kept'); assert.equal(d.accNo.length, 40);
  assert.equal(R.snapshotPayment({}), null, 'nothing set: no payment box');
  assert.deepEqual({ ...R.snapshotPayment(live) }, { bank: 'Maybank', accName: 'Kedai Ali Sdn Bhd', accNo: '5123 4567 8901', instructions: 'Please quote the invoice no. as reference', qr: QR });
  assert.equal(R.duplicate(inv({ conditions: 'Net 14' }), { id: '', no: '', today: '2026-11-14', addDays: (d) => d }).conditions, 'Net 14', 'a duplicate keeps its terms');
});

test('issued invoice: keeps the payment details it was issued with when the settings change later', () => {
  const issued = inv({ status: 'Sent', payment: R.snapshotPayment(live), conditions: 'Terms then' });
  const changed = { ...live, bank: 'CIMB', accNo: '9999', qr: '', terms: 'New terms' };
  assert.equal(R.paymentFor(issued, changed).bank, 'Maybank', 'the old invoice is unchanged');
  assert.equal(R.paymentFor(issued, changed).qr, QR);
  assert.equal(R.conditionsFor(issued), 'Terms then');
  assert.equal(R.paymentFor(inv({ status: 'Draft' }), changed).bank, 'CIMB', 'a draft shows the current settings');
  assert.equal(R.paymentFor(inv({ status: 'Paid' }), changed), null, 'an invoice issued before this feature shows no box, not today’s details');
});

test('credit, debit and refund notes: no payment box and no terms', () => {
  for (const type of ['credit', 'debit', 'refund']) {
    const n = inv({ type, status: 'Issued', payment: R.snapshotPayment(live), conditions: 'Some terms' });
    assert.equal(R.paymentFor(n, live), null); assert.equal(R.conditionsFor(n), '');
    assert.equal(R.payTermsHTML(n, live, esc), '');
  }
});

test('print layout: a separate Payment details box and Terms section, EN and BM labels, apart from Notes, kept on one page', () => {
  const html = R.payTermsHTML(inv({ status: 'Sent', payment: R.snapshotPayment(live), conditions: 'Pay <b>within</b> 30 days & no returns' }), live, esc);
  for (const w of ['Payment details', 'Butiran pembayaran', 'Bank', 'Account name', 'Nama akaun', 'Account no.', 'No. akaun', 'Terms', 'Terma']) assert.ok(html.includes(w), w);
  for (const v of ['Maybank', 'Kedai Ali Sdn Bhd', '5123 4567 8901', 'Please quote the invoice no. as reference']) assert.ok(html.includes(v), v);
  assert.ok(html.includes(`<img class="pdoc-qr" src="${QR}"`), 'the QR is printed');
  assert.ok(html.includes('Pay &lt;b&gt;within&lt;/b&gt; 30 days &amp; no returns'), 'terms are escaped');
  assert.ok(!html.includes('Deliver to the back door') && !/Notes/.test(html), 'Notes stays separate');
  assert.ok(html.indexOf('pdoc-payment') < html.indexOf('pdoc-terms'), 'payment box first, then terms');
  assert.equal((html.match(/class="pdoc-payment"/g) || []).length, 1); assert.equal((html.match(/class="pdoc-terms"/g) || []).length, 1);
  assert.equal(R.payTermsHTML(inv({ status: 'Sent' }), {}, esc), '', 'nothing set: nothing printed');
  assert.ok(R.payTermsHTML(inv({ status: 'Sent', conditions: 'Only terms' }), {}, esc).includes('pdoc-terms'), 'terms alone still print');
  assert.ok(!R.payTermsHTML(inv({ status: 'Sent', conditions: 'Only terms' }), {}, esc).includes('pdoc-payment'));
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.pdoc-payment, \.pdoc-terms \{[^}]*break-inside: avoid/, 'never split across A4 pages');
  assert.match(css, /\.pdoc-qr \{[^}]*28mm/, 'the QR has a fixed print size');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'finance.js'), 'utf8'), body = src.slice(src.indexOf('function invoiceDoc(i)'));
  assert.ok(body.indexOf('class="pdoc-end"') < body.indexOf('IR.payTermsHTML(i') && body.indexOf('IR.payTermsHTML(i') < body.indexOf('class="pdoc-sign"'), 'under the totals, before the signature boxes');
});
