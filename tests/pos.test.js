// Point of sale rules (js/pos-rules.js): totals to the sen, cash rounding, split payments, the card flow with a
// mock SoftPOS, offline sync, stock, shifts, permissions and the Finance posting. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pos-rules.js');

// Sample outlet settings for the tests only (rates are set per outlet in the app, never assumed).
const outlet = { taxes: { SST: { rateBp: 600, label: 'SST 6%' }, ZR: { rateBp: 0, label: 'Exempt' } }, serviceCharge: { enabled: true, rateBp: 1000, orderTypes: ['dine_in'], taxCode: 'SST' } };
const line = (id, unitPrice, qty, extra = {}) => ({ id, itemId: id, name: id, unitPrice, qty, modifiers: [], taxCode: 'SST', ...extra });

test('ringgit typed by a person becomes sen without float drift', () => {
  assert.equal(P.toSen('12.9'), 1290); assert.equal(P.toSen('0.07'), 7); assert.equal(P.toSen('1,234.56'), 123456);
  assert.ok(Number.isNaN(P.toSen('1.234'))); assert.ok(Number.isNaN(P.toSen('abc')));
  assert.equal(P.fmt(123456), 'RM 1,234.56');
});

test('5-sen cash rounding (Bank Negara rule)', () => {
  assert.deepEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010].map(P.roundCash), [1000, 1000, 1005, 1005, 1005, 1005, 1005, 1010, 1010, 1010]);
});

test('1. modifiers, combo, discount, service charge and tax: correct to the sen', () => {
  const order = { type: 'dine_in', discountRule: { kind: 'pct', value: 1000 }, lines: [
    line('latte', 1290, 2, { modifiers: [{ name: 'Oat milk', priceDelta: 200 }, { name: 'Less sugar', priceDelta: 0 }] }), // 2 × 14.90 = 29.80
    line('combo', 1890, 1, { modifiers: [{ name: 'Nasi lemak', priceDelta: 0 }, { name: 'Upsize teh tarik', priceDelta: 150 }] }), // 20.40
    line('water', 200, 1, { taxCode: 'ZR' }), // 2.00
  ] };
  const t = P.totals(order, outlet);
  assert.equal(t.subtotal, 5220);
  assert.equal(t.discount, 522);                 // 10%
  assert.equal(t.serviceCharge, 470);            // 10% of 46.98 = 4.698 → 4.70
  // SST base: discounted lattes + combo (5020 less its share of 522) + service charge
  const shares = P.allocate(522, [2980, 2040, 200]);
  assert.deepEqual(shares, [298, 204, 20]);
  assert.equal(t.taxLines.find((x) => x.code === 'SST').base, 2980 - 298 + 2040 - 204 + 470);
  assert.equal(t.tax, P.bp(4988, 600));          // 299.28 → 299
  assert.equal(t.tax, 299);
  assert.equal(t.total, 5220 - 522 + 470 + 299); // 54.67
  // Paid in cash: 54.67 → 54.65
  const s = P.settle(t.total, [{ method: 'cash', status: 'approved', ...P.cashApply(t.total, 6000), tendered: 6000 }]);
  assert.equal(s.due, 5465); assert.equal(s.rounding, -2); assert.equal(s.change, 535); assert.ok(s.fullyPaid);
  // Paid by card: exact, no rounding.
  assert.equal(P.settle(t.total, [{ method: 'card_external', amount: t.total, status: 'approved' }]).rounding, 0);
  // Takeaway: no service charge.
  assert.equal(P.totals({ ...order, type: 'takeaway' }, outlet).serviceCharge, 0);
  // Voided lines don't count; an amount discount never goes below zero.
  assert.equal(P.totals({ lines: [line('a', 500, 1), line('b', 900, 1, { status: 'void' })], discountRule: { kind: 'amt', value: 9999 } }, {}).total, 0);
});

test('modifier groups: min and max are enforced', () => {
  const groups = [{ id: 'g1', name: 'Sugar', min: 1, max: 1 }, { id: 'g2', name: 'Add-ons', min: 0, max: 2 }];
  assert.deepEqual(P.checkModifiers(groups, []), ['Sugar: choose at least 1']);
  assert.deepEqual(P.checkModifiers(groups, [{ groupId: 'g1' }, { groupId: 'g2' }, { groupId: 'g2' }, { groupId: 'g2' }]), ['Add-ons: choose at most 2']);
});

test('2. split (cash + QR), partial payment, overpayment with change', () => {
  const total = 4567;
  // QR first for RM 20, exact.
  let pays = [{ method: 'qr_manual', amount: 2000, status: 'approved' }];
  let s = P.settle(total, pays);
  assert.equal(s.balance, 2567); assert.ok(!s.fullyPaid);
  // Partial cash RM 10.
  const c1 = P.cashApply(2567, 1000); assert.ok(c1.partial);
  pays.push({ method: 'cash', status: 'approved', amount: c1.amount, tendered: 1000 });
  s = P.settle(total, pays);
  assert.equal(s.balance, 1565);                 // rest 15.67 → due in cash 15.65
  // Overpay the rest with RM 20.
  const c2 = P.cashApply(total - 2000 - 1000, 2000);
  assert.equal(c2.amount, 1565); assert.equal(c2.change, 435);
  pays.push({ method: 'cash', status: 'approved', amount: c2.amount, tendered: 2000 });
  s = P.settle(total, pays);
  assert.ok(s.fullyPaid); assert.equal(s.change, 435); assert.equal(s.rounding, -2); assert.equal(s.paid, 4565);
});

test('3 (client part). the POS can never approve a QR or card-tap payment itself', () => {
  for (const method of ['duitnow_qr', 'card_tap', 'ewallet']) {
    assert.equal(P.canTransition({ status: 'pending', method }, 'approved', 'client'), false);
    assert.equal(P.canTransition({ status: 'pending', method }, 'approved', 'server'), true);
  }
  assert.equal(P.canTransition({ status: 'cancelled', method: 'duitnow_qr' }, 'approved', 'server'), false, 'paid after cancel is not approved');
  assert.equal(P.canTransition({ status: 'approved', method: 'duitnow_qr' }, 'approved', 'server'), false, 'a duplicate approval is ignored');
  assert.equal(P.canTransition({ status: 'pending', method: 'cash' }, 'approved', 'client'), true);
});

test('4. card (mock SoftPOS): approved, declined, cancelled, timeout, no NFC, app killed then recovered, refund', () => {
  const sp = P.mockSoftPos(['approve', 'decline', 'cancel', 'timeout', 'nonfc', 'killed']);
  const pay = (k) => ({ amount: 1200, idempotencyKey: k, status: 'pending', method: 'card_tap' });
  const a = P.runCardPayment(sp, pay('k1'));
  assert.equal(a.status, 'approved'); assert.equal(a.cardLast4, '4242'); assert.equal(a.cardBrand, 'VISA'); assert.ok(a.approvalCode);
  assert.ok(!('pan' in a) && !JSON.stringify(a).includes('4242424242424242'), 'no card number ever comes back');
  assert.equal(P.runCardPayment(sp, pay('k2')).status, 'declined');
  assert.equal(P.runCardPayment(sp, pay('k3')).status, 'cancelled');
  assert.equal(P.runCardPayment(sp, pay('k4')).status, 'cancelled');
  assert.match(P.runCardPayment(sp, pay('k5')).declineReason, /NFC/);
  // The app dies after the provider approved: recovered by querying with the idempotency key.
  const k = P.runCardPayment(sp, pay('k6'));
  assert.equal(k.status, 'approved'); assert.equal(P.recoverCardPayment(sp, pay('k6')).status, 'approved');
  assert.equal(P.recoverCardPayment(sp, pay('never-sent')).status, 'pending');
  assert.equal(sp.refund('k1', 1200).status, 'refunded');
  assert.equal(sp.refund('k2', 1200).status, 'error', 'a declined payment cannot be refunded');
});

test('recorded card payments refuse anything that looks like a card number', () => {
  const pr = P.recordedProvider('card_external');
  assert.throws(() => pr.createPayment({}, 100, 'card_external', { approvalCode: '4111 1111 1111 1111' }), /card number/);
  assert.throws(() => pr.createPayment({}, 100, 'card_external', { cardLast4: '12345' }), /Last 4/);
  const p = pr.createPayment({}, 100, 'card_external', { approvalCode: '834221', cardLast4: '0042', cardBrand: 'Mastercard', idempotencyKey: 'x' });
  assert.equal(p.status, 'approved'); assert.equal(p.reconcile, true); assert.equal(p.cardLast4, '0042');
  assert.deepEqual(Object.keys(P.safeResult({ status: 'approved', pan: '4242424242424242', cvv: '123', track2: 'x', cardLast4: '4242' })).sort(), ['cardLast4', 'status']);
});

test('5. offline: queued orders sync once (no duplicates); card and QR are blocked offline', () => {
  const orders = [{ clientOrderId: 'c1' }];
  const r = P.mergeQueued(orders, [{ clientOrderId: 'c1' }, { clientOrderId: 'c2' }, { clientOrderId: 'c2' }]);
  assert.deepEqual(r.added, ['c2']); assert.equal(r.skipped, 2); assert.equal(orders.length, 2);
  assert.equal(P.methodAllowed('cash', false), true);
  assert.equal(P.methodAllowed('card_external', false), true);
  assert.equal(P.methodAllowed('duitnow_qr', false), false);
  assert.equal(P.methodAllowed('card_tap', false), false);
  assert.equal(P.methodAllowed('card_tap', true), true);
});

test('6. stock: deducted on sale (with modifier recipes), restored on void, never twice', () => {
  const menu = { latte: { recipe: [{ itemId: 'beans', qty: 0.018 }, { itemId: 'milk', qty: 0.2 }] } };
  const order = { id: 'o1', no: 'B1-000001', lines: [line('latte', 1290, 2, { modifiers: [{ name: 'Extra shot', priceDelta: 200, recipe: [{ itemId: 'beans', qty: 0.009 }] }] })] };
  const moves = [];
  P.addMoves(moves, P.stockMoves(order, menu, 'sale', '2026-10-30'));
  P.addMoves(moves, P.stockMoves(order, menu, 'sale', '2026-10-30'));
  const net = (id) => Math.round(moves.filter((m) => m.itemId === id).reduce((s, m) => s + m.qty, 0) * 1000) / 1000;
  assert.equal(net('beans'), -0.054); assert.equal(net('milk'), -0.4); assert.equal(moves.length, 3, "three recipe rows, added once");
  P.addMoves(moves, P.stockMoves(order, menu, 'void', '2026-10-30'));
  assert.equal(net('beans'), 0); assert.equal(net('milk'), 0);
  // Low stock comes from the Operations rules (reorder level).
  const O = loadOps();
  const lv = O.stockLevels([{ id: 'milk', opening: 1, reorder: 2 }], moves.filter((m) => m.itemId === 'milk'));
  assert.equal(lv[0].low, true);
});

test('7. shift close: expected cash and variance', () => {
  const shift = { id: 's1', openingCash: 20000, cashMoves: [{ kind: 'in', amount: 5000 }, { kind: 'out', amount: 1200 }], countedCash: 41500 };
  const pays = [
    { shiftId: 's1', method: 'cash', amount: 5465, status: 'approved' },
    { shiftId: 's1', method: 'cash', amount: 12240, status: 'approved', tip: 500 },
    { shiftId: 's1', method: 'card_external', amount: 3000, status: 'approved' },
    { shiftId: 's1', method: 'cash', amount: 999, status: 'cancelled' },
    { shiftId: 's2', method: 'cash', amount: 7777, status: 'approved' },
  ];
  const refunds = [{ shiftId: 's1', method: 'cash', amount: 1000, status: 'approved' }];
  const s = P.shiftSummary(shift, pays, refunds);
  assert.equal(s.expectedCash, 20000 + 5465 + 12240 + 500 - 1000 + 5000 - 1200); // 41005
  assert.equal(s.variance, 495);
  assert.equal(s.byMethod.card_external, 3000);
});

test('8 (logic part). permissions: cashier cannot refund, void, change prices or exceed the discount limit', () => {
  assert.equal(P.canDo('cashier', 'refund'), false); assert.equal(P.canDo('cashier', 'price'), false); assert.equal(P.canDo('cashier', 'void'), false);
  assert.equal(P.canDo('manager', 'refund'), true); assert.equal(P.canDo('kitchen', 'pay'), false); assert.equal(P.canDo('waiter', 'pay'), false);
  assert.equal(P.discountNeedsManager('cashier', 600, 5000, 1000), true);   // 12% > 10% limit
  assert.equal(P.discountNeedsManager('cashier', 500, 5000, 1000), false);
  assert.equal(P.discountNeedsManager('manager', 5000, 5000, 1000), false);
});

test('9. expired, suspended or cancelled companies cannot take orders or payments', () => {
  assert.equal(P.canTrade('expired'), false); assert.equal(P.canTrade('suspended'), false); assert.equal(P.canTrade('cancelled'), false);
  assert.equal(P.canTrade('trial'), true); assert.equal(P.canTrade('past_due'), true);
});

test('receipt numbers are sequential per outlet and never reused', () => {
  const seq = {};
  assert.equal(P.nextReceiptNo(seq, 'B1'), 'B1-000001'); assert.equal(P.nextReceiptNo(seq, 'B1'), 'B1-000002'); assert.equal(P.nextReceiptNo(seq, 'B2'), 'B2-000001');
});

test('daily Finance posting: one entry per method, service charge, rounding and tips apart, adding up exactly', () => {
  const day = '2026-10-30', at = '2026-10-30T04:00:00Z';
  const orders = [
    { id: 'o1', status: 'paid', paidAt: at, subtotal: 5220, discount: 522, serviceCharge: 470, tax: 299, total: 5467, rounding: -2, createdBy: 'e3', lines: [] },
    { id: 'o2', status: 'paid', paidAt: at, subtotal: 1000, discount: 0, serviceCharge: 0, tax: 60, total: 1060, rounding: 0, createdBy: 'e3', lines: [] },
  ];
  const pays = [{ orderId: 'o1', method: 'cash', amount: 5465, status: 'approved', tip: 300 }, { orderId: 'o2', method: 'qr_manual', amount: 1060, status: 'approved' }];
  const sum = P.daySales(orders, pays, day);
  assert.equal(sum.total, 5465 + 1060);
  const fx = P.financeEntries(sum);
  const cents = (x) => Math.round(x * 100);
  const salesAndTax = fx.filter((e) => e.category === 'Product sales').reduce((s, e) => s + cents(e.amount) + cents(e.tax), 0);
  const others = fx.filter((e) => e.category === 'Other income').reduce((s, e) => s + cents(e.amount), 0);
  assert.equal(salesAndTax + others, sum.total + sum.tips, 'the book gets exactly what was collected');
  assert.equal(fx.filter((e) => e.category === 'Product sales').reduce((s, e) => s + cents(e.tax), 0), 359, 'tax kept apart for the SST summary');
  assert.deepEqual(fx.map((e) => e.ref), ['POS-20261030-cash', 'POS-20261030-qr_manual', 'POS-20261030-svc', 'POS-20261030-rnd', 'POS-20261030-tip']);
  // Kuala Lumpur day: 23:30 UTC on the 29th is the 30th in KL.
  assert.equal(P.klDay('2026-10-29T16:30:00Z'), '2026-10-30');
});

test('CSV export guards against formula injection', () => {
  assert.equal(P.csv([['=SUM(A1)', 'ok', 'a,b']]), `"'=SUM(A1)",ok,"a,b"`);
});

function loadOps() {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const sb = { console }; sb.window = sb; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ops-rules.js'), 'utf8'), sb);
  return sb.AllurusOpsRules;
}
