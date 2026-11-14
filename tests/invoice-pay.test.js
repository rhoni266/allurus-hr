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
  }
});

test('print: the standard layout shows How to pay and Terms from the invoice own copy, never on notes', () => {
  const P = require('../js/invoice-print.js');
  const model = (inv2, live2) => ({ isInvoice: R.isInvoice(inv2), status: inv2.status, company: { name: 'Co', initial: 'C' }, title: 'Invoice', no: 'N1', issue: '14/11/2026', due: '21/11/2026', terms: 'Net 7', amountHeadline: 'RM 10.00', customerName: 'Ali', customer: {}, items: [{ desc: 'Rice', qty: '1', unit: 'kg', price: '10.00', amount: '10.00' }], words: 'x', totals: { sub: '10.00', tax: '0.00', total: '10.00' }, payment: R.paymentFor(inv2, live2), conditions: R.conditionsFor(inv2) });
  const html = P.html(model(inv({ status: 'Sent', payment: R.snapshotPayment(live), conditions: 'Pay within 30 days' }), { ...live, bank: 'CIMB' }), esc);
  assert.ok(html.includes('Maybank') && !html.includes('CIMB'), 'the issued copy, not the current settings');
  assert.ok(html.includes('How to pay') && html.includes('Cara bayaran') && html.includes('Terma'));
  assert.ok(html.indexOf('invd-terms') < html.indexOf('invd-pay'), 'Terms on the left, How to pay on the right');
  for (const type of ['credit', 'debit', 'refund']) {
    const h = P.html(model(inv({ type, status: 'Issued', payment: R.snapshotPayment(live), conditions: 'x' }), live), esc);
    assert.ok(!h.includes('How to pay') && !h.includes('invd-terms'), type);
  }
});
