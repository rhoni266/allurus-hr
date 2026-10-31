// Unit tests for invoice rules: units and quantities, totals in sen, statuses, part payments, duplicating and
// numbering. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'invoice-rules.js'), 'utf8'), sandbox);
const R = sandbox.window.AllurusInvoiceRules;
const plain = (x) => JSON.parse(JSON.stringify(x));
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const inv = (o = {}) => ({ id: 'i1', type: 'invoice', no: 'INV-202610-0001', status: 'Draft', customer: 'Kedai Ali', issue: '2026-10-01', due: '2026-10-31', taxRate: 0, items: [], ...o });

test('kg takes decimals; pcs, box and the like take whole numbers only', () => {
  assert.equal(R.qtyError(12.5, 'kg'), '');
  assert.equal(R.qtyError(0.125, 'l'), '');
  assert.equal(R.qtyError(1.5, 'hour'), '');
  assert.equal(R.qtyError(2.5, 'pcs'), 'Quantity in pcs must be a whole number');
  assert.equal(R.qtyError(1.5, 'box'), 'Quantity in box must be a whole number');
  assert.equal(R.qtyError(3, 'pcs'), '');
  assert.equal(R.qtyError(0, 'kg'), 'Enter a quantity above 0');
  assert.equal(R.qtyError(1.2345, 'kg'), 'Use at most 3 decimal places');
});

test('an old line with no unit counts as "unit" (whole numbers) and still works', () => {
  assert.equal(R.unitOf(undefined).code, 'unit');
  assert.equal(R.unitOf('nonsense').code, 'unit');
  assert.equal(R.fmtQty(12.5, 'kg'), '12.5 kg');
  assert.equal(R.fmtQty(3, undefined), '3 unit');
});

test('every unit maps to an LHDN e-Invoice unit code', () => {
  for (const u of R.UNITS) assert.match(u.lhdn, /^[A-Z0-9]{2,3}$/, u.code);
  assert.equal(R.unitOf('kg').lhdn, 'KGM');
  assert.equal(R.unitOf('pcs').lhdn, 'H87');
});

test('line total is qty × price, worked in sen and rounded once per line', () => {
  // Rice 5kg bag | 12.5 kg | RM 4.20 | RM 52.50
  assert.equal(R.lineSen({ qty: 12.5, price: 4.2 }), 5250);
  // 0.333 kg × RM 1.99 = 66.267 sen → 66 sen
  assert.equal(R.lineSen({ qty: 0.333, price: 1.99 }), 66);
  const t = R.totals(inv({ taxRate: 8, items: [{ qty: 12.5, price: 4.2 }, { qty: 0.333, price: 1.99 }] }));
  assert.deepEqual(plain(t), { sub: 53.16, tax: 4.25, total: 57.41, balance: 57.41, paid: 0, due: 57.41 });
});

test('old invoices (whole quantities, 2-decimal prices) total exactly as before', () => {
  const r2 = (n) => Math.round(n * 100) / 100;
  const old = (i) => { const sub = r2(i.items.reduce((s, x) => s + x.qty * x.price, 0)); const tax = r2(sub * i.taxRate / 100); return { sub, tax, total: r2(sub + tax) }; };
  for (const items of [[{ qty: 12, price: 950 }], [{ qty: 3, price: 19.99 }, { qty: 7, price: 0.05 }], [{ qty: 1, price: 1234.56 }, { qty: 40, price: 12.35 }]]) {
    for (const taxRate of [0, 6, 8, 10]) {
      const i = inv({ items, taxRate }), t = R.totals(i), o = old(i);
      assert.deepEqual([t.sub, t.tax, t.total], [o.sub, o.tax, o.total], JSON.stringify({ items, taxRate }));
    }
  }
});

test('only a Draft can be edited, deleted or sent; Sent and later are locked', () => {
  assert.ok(R.canEdit(inv()));
  assert.ok(R.canDelete(inv()) && R.canSend(inv()));
  for (const status of ['Sent', 'Partially paid', 'Paid', 'Void']) assert.equal(R.canEdit(inv({ status })), false, status);
  assert.equal(R.canEdit({ type: 'credit', status: 'Issued' }), false);
});

test('reports count Sent, part paid and Paid, never Drafts or Void', () => {
  assert.deepEqual(['Draft', 'Sent', 'Partially paid', 'Paid', 'Void'].map((status) => R.counts(inv({ status }))), [false, true, true, true, false]);
  assert.equal(R.counts({ type: 'credit', status: 'Issued' }), false);
});

test('part payments: Sent → Partially paid → Paid; never more than is due', () => {
  let i = inv({ status: 'Sent', items: [{ qty: 1, price: 100 }] });
  let r = R.pay(i, 40, '2026-10-05', 'u1');
  assert.equal(r.status, 'Partially paid'); assert.equal(r.paidOn, '');
  i = { ...i, ...r };
  assert.equal(R.totals(i).due, 60);
  assert.match(R.pay(i, 60.01, '2026-10-06').error, /more than/);
  r = R.pay(i, 60, '2026-10-06', 'u1');
  assert.equal(r.status, 'Paid'); assert.equal(r.paidOn, '2026-10-06'); assert.equal(r.payments.length, 2);
  assert.match(R.pay(inv(), 1, '2026-10-06').error, /sent/);
});

test('an old Paid invoice with no payment list counts as paid in full', () => {
  const t = R.totals(inv({ status: 'Paid', items: [{ qty: 2, price: 50 }], taxRate: 8 }));
  assert.equal(t.paid, 108); assert.equal(t.due, 0);
});

test('void: a sent invoice with no payments, not a draft or a paid one', () => {
  assert.equal(R.canVoid(inv({ status: 'Sent' })), true);
  assert.equal(R.canVoid(inv()), false);
  assert.equal(R.canVoid(inv({ status: 'Paid' })), false);
  assert.equal(R.canVoid(inv({ status: 'Partially paid', payments: [{ amount: 1 }] })), false);
});

test('duplicate: a new Draft with the same customer, lines and units; no number, payments or dates carried over', () => {
  const orig = inv({ status: 'Paid', sentAt: 1, sentBy: 'u', paidOn: '2026-10-09', payments: [{ amount: 52.5 }], voidReason: 'x',
    taxRate: 8, notes: 'Thanks', items: [{ desc: 'Rice 5kg bag', qty: 12.5, unit: 'kg', price: 4.2, classification: '022' }, { desc: 'Old line', qty: 2, price: 3 }] });
  const before = JSON.stringify(orig);
  const d = plain(R.duplicate(orig, { id: 'i2', no: 'INV-202611-0004', today: '2026-11-02', addDays }));
  assert.equal(d.status, 'Draft'); assert.equal(d.id, 'i2'); assert.equal(d.no, 'INV-202611-0004');
  assert.equal(d.issue, '2026-11-02'); assert.equal(d.due, '2026-12-02');
  assert.deepEqual(d.payments, []); assert.equal(d.paidOn, '');
  for (const k of ['sentAt', 'sentBy', 'voidReason']) assert.equal(d[k], undefined, k);
  assert.deepEqual(d.items.map((x) => [x.desc, x.qty, x.unit, x.price]), [['Rice 5kg bag', 12.5, 'kg', 4.2], ['Old line', 2, 'unit', 3]]);
  assert.deepEqual(d.duplicatedFrom, { id: 'i1', no: 'INV-202610-0001' });
  assert.equal(d.notes, 'Thanks'); assert.equal(d.taxRate, 8);
  assert.equal(JSON.stringify(orig), before, 'the original is unchanged');
});

test('numbers: highest used that month + 1, so deleting a draft never repeats a number', () => {
  const list = [{ no: 'INV-202610-0001' }, { no: 'INV-202610-0003' }, { no: 'INV-202609-0007' }, { no: 'CN-202610-0009' }];
  assert.equal(R.nextNo(list, 'INV', '2026-10'), 'INV-202610-0004');
  assert.equal(R.nextNo(list, 'INV', '2026-11'), 'INV-202611-0001');
  assert.equal(R.nextNo(list, 'CN', '2026-10'), 'CN-202610-0010');
});

test('draft checks: customer, dates, lines, quantities per unit and 2-decimal prices', () => {
  assert.deepEqual(plain(R.draftErrors({ customer: 'A', issue: '2026-10-01', due: '2026-10-31', items: [{ desc: 'Rice', qty: 12.5, unit: 'kg', price: 4.2 }] })), []);
  const e = plain(R.draftErrors({ customer: '', issue: '2026-10-05', due: '2026-10-01', items: [{ desc: 'Cups', qty: 2.5, unit: 'pcs', price: 1.234 }] }));
  assert.deepEqual(e, ['Add the customer', 'The due date must be on or after the issue date', 'Line 1: Quantity in pcs must be a whole number', 'Line 1: price must be in ringgit with at most 2 decimals']);
  assert.deepEqual(plain(R.draftErrors({ customer: 'A', issue: '2026-10-01', items: [] })), ['Add at least one item']);
});

test('remembers the last unit used for an item', () => {
  const m = R.rememberUnits({}, [{ desc: '  Rice 5kg  Bag ', unit: 'kg' }, { desc: 'Cups', unit: 'pcs' }]);
  assert.equal(R.unitFor(m, 'rice 5kg bag'), 'kg');
  assert.equal(R.unitFor(m, 'Plates'), '');
});
