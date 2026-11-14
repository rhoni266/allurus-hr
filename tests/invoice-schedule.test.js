// Instalments (a payment schedule) on invoices: must add up, payments go to the deposit first, due date and due now, overdue and aging
// per instalment, receivables keep the full total, and the print.  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['invoice-rules.js', 'ops-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox);
const R = sandbox.window.AllurusInvoiceRules, O = sandbox.window.AllurusOpsRules;
const P = require('../js/invoice-print.js');
const plain = (x) => JSON.parse(JSON.stringify(x));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// RM3,000 in three instalments: a deposit due 21 Nov, a middle one due 20 Dec, and the balance "At go-live" (no date yet).
const inv = (o = {}) => ({ type: 'invoice', no: 'INV-1', status: 'Sent', customer: 'Major Far East', issue: '2026-11-14', due: '2026-11-21', taxRate: 0,
  items: [{ desc: 'Allurus HR annual subscription', qty: 1, unit: 'unit', price: 3000 }], payments: [],
  schedule: [{ label: 'Deposit', amount: 1000, due: '2026-11-21', dueText: '' }, { label: 'Second', amount: 1000, due: '2026-12-20', dueText: '' }, { label: 'Balance', amount: 1000, due: '', dueText: 'At go-live' }], ...o });
const T = '2026-11-14';

test('the schedule must add up to the invoice total, or saving is blocked', () => {
  assert.deepEqual(plain(R.scheduleErrors(inv())), []);
  assert.deepEqual(plain(R.draftErrors(inv({ status: 'Draft' }))), [], 'a good schedule saves');
  const short = R.draftErrors(inv({ status: 'Draft', schedule: [{ label: 'Deposit', amount: 1000, due: '2026-11-21' }, { label: 'Rest', amount: 1500, dueText: 'At go-live' }] }));
  assert.ok(short.some((m) => /adds up to 2500\.00, but the invoice total is 3000\.00/.test(m)), short.join(' | '));
  const tax = R.draftErrors(inv({ status: 'Draft', taxRate: 8, schedule: [{ label: 'A', amount: 1500, dueText: 'x' }, { label: 'B', amount: 1500, dueText: 'y' }] }));
  assert.ok(tax.some((m) => /3240\.00/.test(m)), 'the total includes the tax');
  assert.ok(R.draftErrors(inv({ schedule: [{ label: '', amount: 3000, due: '' }] })).length >= 2, 'a row needs a name and a date or a note');
  assert.ok(R.scheduleErrors(inv({ schedule: [{ label: 'A', amount: 0, dueText: 'x' }, { label: 'B', amount: 3000, dueText: 'y' }] })).some((m) => /above 0/.test(m)));
  assert.deepEqual(plain(R.scheduleErrors(inv({ schedule: [] }))), [], 'no schedule is fine');
  assert.deepEqual(plain(R.scheduleErrors(inv({ schedule: [{ label: '', amount: '', due: '', dueText: '' }] }))), [], 'an empty row is ignored');
});

test('payments go to the deposit first, in order; status Sent, then Partly paid, then Paid', () => {
  let i = inv();
  assert.deepEqual(R.instalments(i, T).map((x) => x.status), ['Due', 'Upcoming', 'Upcoming'], 'the first unpaid one is due now');
  const p1 = R.pay(i, 1000, '2026-11-15', 'u'); assert.equal(p1.status, 'Partially paid');
  i = { ...i, ...p1 };
  assert.deepEqual(R.instalments(i, T).map((x) => [x.status, x.paidSen / 100]), [['Paid', 1000], ['Due', 0], ['Upcoming', 0]], 'the deposit is paid, the next becomes due');
  const p2 = R.pay(i, 400, '2026-11-20', 'u'); i = { ...i, ...p2 };
  assert.deepEqual(R.instalments(i, T).map((x) => x.paidSen / 100), [1000, 400, 0], '400 goes to the second instalment');
  assert.equal(R.dueNow(i, T), 600, 'what is left of the second one');
  i = { ...i, ...R.pay(i, 1600, '2026-12-01', 'u') };
  assert.equal(i.status, 'Paid'); assert.ok(R.instalments(i, T).every((x) => x.status === 'Paid'));
  assert.equal(R.dueNow(i, T), 0);
  assert.equal(R.pay(inv({ status: 'Sent' }), 3001, '2026-11-15').error !== undefined, true, 'more than the whole invoice is refused');
});

test('due date and amount due now', () => {
  const i = inv();
  assert.equal(R.dueDate(i, T), '2026-11-21', 'the first unpaid instalment');
  assert.equal(R.dueNow(i, T), 1000, 'the deposit');
  assert.equal(R.dueNow(i, '2026-12-25'), 2000, 'the second one has come due too');
  const paid1 = { ...i, payments: [{ date: '2026-11-15', amount: 1000 }], status: 'Partially paid' };
  assert.equal(R.dueDate(paid1, T), '2026-12-20', 'after the deposit: the next instalment');
  const paid2 = { ...i, payments: [{ date: '2026-11-15', amount: 2000 }], status: 'Partially paid' };
  assert.equal(R.dueDate(paid2, T), '2026-11-21', 'a note-only instalment keeps the invoice own date');
  assert.equal(R.dueNow(paid2, T), 1000, 'the first unpaid instalment is asked for now, even with only a note');
  assert.equal(R.dueNow(inv({ schedule: [] }), T), 3000, 'no schedule: all that is unpaid');
  const credit = { ...i, adjust: -500 };
  assert.deepEqual(R.instalments(credit, T).map((x) => x.amountSen / 100), [1000, 1000, 500], 'a credit note comes off the last instalment first');
});

test('overdue counts only instalments past their due date; the aging uses each instalment', () => {
  const i = inv({ status: 'Sent' });
  assert.equal(R.shown(i, '2026-11-21'), 'Sent', 'due today is not overdue');
  assert.equal(R.shown(i, '2026-11-22'), 'Overdue', 'the deposit is a day late');
  const dep = { ...i, status: 'Partially paid', payments: [{ date: '2026-11-22', amount: 1000 }] };
  assert.equal(R.shown(dep, '2026-12-01'), 'Partially paid', 'the deposit is paid; the next is not yet due');
  assert.equal(R.shown(dep, '2026-12-21'), 'Overdue', 'the second one is late');
  assert.equal(R.shown(inv({ schedule: [], due: '2026-11-21' }), '2026-11-22'), 'Overdue', 'no schedule: as before');
  assert.equal(R.shown(inv({ status: 'Paid' }), '2027-01-01'), 'Paid');
  // aging: the deposit is 12 days late, the second is current, the note-only one is current
  const rows = R.agingRows(i, '2026-12-03');
  assert.deepEqual(plain(rows), [{ due: '2026-11-21', balance: 1000 }, { due: '2026-12-20', balance: 1000 }, { due: '9999-12-31', balance: 1000 }]);
  const a = plain(O.aging(rows, '2026-12-03'));
  assert.equal(a.d30, 1000, 'the deposit is 1-30 days late'); assert.equal(a.current, 2000); assert.equal(a.overdue, 1000); assert.equal(a.total, 3000);
  assert.deepEqual(plain(R.agingRows(inv({ schedule: [], due: '2026-11-21' }), T)), [{ due: '2026-11-21', balance: 3000 }], 'no schedule: one row, as before');
  assert.equal(R.totals(i).due, 3000, 'receivables and sales reports keep using the full invoice total');
});

const model = (i, today) => ({ isInvoice: true, status: R.shown(i, today), company: { name: 'Co', initial: 'C' }, title: 'Invoice', no: i.no, issue: '14/11/2026', due: '21/11/2026', terms: 'Net 7', currency: 'RM',
  amountHeadline: `RM ${R.dueNow(i, today).toFixed(2)}`, customerName: 'Ali', customer: {}, items: [{ desc: 'Sub', qty: '1', unit: 'unit', price: '3,000.00', amount: '3,000.00' }], words: 'x',
  totals: { sub: '3,000.00', tax: '0.00', total: '3,000.00', adj: [], hasPays: false, paid: '0.00' },
  schedule: R.hasSchedule(i) ? { invoiceTotal: 'RM 3,000.00', rows: R.instalments(i, today).map((x) => ({ label: x.label, amount: (x.amountSen / 100).toFixed(2), due: x.due ? x.due.split('-').reverse().join('/') : x.dueText, status: x.status })) } : null });

test('print: Due now and Invoice total in the strip, the schedule under the totals, the Amount due bar shows what is due now', () => {
  const h = P.html(model(inv(), T), esc);
  assert.ok(/Due now/.test(h) && h.includes('Perlu dibayar sekarang'), 'strip: Due now (EN and BM)');
  assert.ok(h.includes('RM 1000.00') && /Invoice total/.test(h) && h.includes('Jumlah invois') && h.includes('RM 3,000.00'), 'strip: RM1,000 due now and RM3,000 total');
  assert.ok(h.includes('Amount due now') && h.indexOf('Amount due now') < h.indexOf('invd-sched'), 'the bar says what is due now');
  assert.ok(h.indexOf('invd-after') < h.indexOf('invd-sched'), 'the schedule is under the totals');
  assert.ok(h.includes('Payment schedule') && h.includes('Jadual bayaran'));
  for (const w of ['Deposit', 'Second', 'Balance', '21/11/2026', '20/12/2026', 'At go-live']) assert.ok(h.includes(w), w);
  assert.deepEqual(['sch-due', 'sch-upcoming', 'sch-upcoming'].map((c) => h.includes(`class="${c}"`)), [true, true, true]);
  const after = { ...inv(), payments: [{ date: '2026-11-15', amount: 1000 }], status: 'Partially paid' };
  const h2 = P.html(model(after, T), esc);
  assert.ok(h2.includes('class="sch-paid">Paid') && h2.includes('Dibayar'), 'the deposit shows Paid');
  assert.ok(h2.includes('>Partly paid<'), 'the status pill');
  const plainInv = P.html(model(inv({ schedule: [] }), T), esc);
  assert.ok(!plainInv.includes('invd-sched') && !/Due now/.test(plainInv) && plainInv.includes('Amount due'), 'no schedule: the layout is unchanged');
  const credit = P.html({ ...model(inv(), T), isInvoice: false, status: 'Issued', title: 'Credit note' }, esc);
  assert.ok(!credit.includes('invd-sched') && !/Due now/.test(credit), 'notes have no schedule');
});
