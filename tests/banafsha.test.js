// The Banafsha Café demo company (js/seed-banafsha.js): a café with the point of sale. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = { console, TextEncoder };
sb.window = sb;
vm.createContext(sb);
for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'talent-rules', 'einvoice-rules', 'finance', 'tax', 'claims', 'planner', 'seed', 'ops-rules', 'seed-suria', 'seed-majorfe', 'pos-rules', 'seed-banafsha']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
}
const P = sb.AllurusPosRules, T = sb.U.today();
const C = sb.AllurusSeed.companies;
const b = C.banafsha.create();
const pos = b.pos;

test('a fourth demo company with its own storage', () => {
  assert.deepEqual(Object.keys(C), ['serimaju', 'suria', 'majorfe', 'banafsha']);
  assert.equal(new Set(Object.values(C).map((c) => c.storeKey)).size, 4);
  assert.equal(b.settings.company, 'Banafsha Café Sdn Bhd');
  assert.equal(b.employees.length, 10);
  assert.ok(b.accounts.every((a) => a.email.endsWith('@banafsha.com.my')));
});

test('POS roles: owner, outlet manager with a PIN, cashiers, kitchen and waiters', () => {
  const role = (e) => b.accounts.find((a) => a.email.startsWith(e));
  assert.equal(role('siti.hajar').posRole, 'manager');
  assert.deepEqual([...role('siti.hajar').perms], ['pos', 'operations', 'time']);
  assert.ok(role('siti.hajar').posPin);
  assert.equal(role('aiman.zulkifli').posRole, 'cashier');
  assert.deepEqual([...role('aiman.zulkifli').roles], ['employee']);
  assert.equal(role('rahim.musa').posRole, 'kitchen');
  assert.ok(!role('hana.ismail').posRole);
});

test('every money value is whole sen, and every paid order is settled exactly', () => {
  const outlet = pos.outlets[0];
  for (const o of pos.orders) {
    for (const k of ['subtotal', 'discount', 'serviceCharge', 'tax', 'total']) assert.ok(Number.isInteger(o[k]), `${o.id}.${k}`);
    assert.equal(o.total, P.totals(o, outlet).total);
    if (o.status !== 'paid') continue;
    const s = P.settle(o.total, pos.payments.filter((p) => p.orderId === o.id));
    assert.ok(s.fullyPaid, `${o.receiptNo} paid`);
  }
});

test('receipt numbers run on without gaps or repeats', () => {
  const nos = pos.orders.filter((o) => o.receiptNo).map((o) => o.receiptNo);
  assert.equal(new Set(nos).size, nos.length);
  assert.equal(nos[nos.length - 1], `BKL-${String(nos.length).padStart(6, '0')}`);
});

test('no card data in the demo: only brand and last 4 digits', () => {
  const card = pos.payments.filter((p) => p.method === 'card_external');
  assert.ok(card.length > 10);
  assert.ok(card.every((p) => /^\d{4}$/.test(p.cardLast4) && !P.looksLikePan(JSON.stringify(p))));
});

test('stock came off for every sale, oat milk is low, voids put stock back', () => {
  const lv = sb.AllurusOpsRules.stockLevels(b.ops.items, b.ops.moves);
  assert.ok(lv.find((x) => x.id === 'g-oat').low);
  assert.ok(b.ops.moves.some((m) => m.note === 'POS void: stock back'));
  assert.ok(lv.every((x) => x.onHand >= 0), lv.filter((x) => x.onHand < 0).map((x) => x.id).join());
});

test('today: an open shift, tables in use, tickets in the kitchen; earlier days posted to Finance', () => {
  assert.ok(pos.shifts.some((s) => !s.closedAt));
  assert.ok(pos.tables.some((t) => t.status === 'occupied') && pos.tables.some((t) => t.status === 'billing'));
  assert.ok(pos.orders.some((o) => o.status === 'sent' && o.lines.some((l) => l.status === 'new')));
  const posted = b.finance.txns.filter((t) => t.source === 'pos');
  assert.ok(posted.length > 10);
  assert.ok(!posted.some((t) => t.date >= sb.U.addDays(T, -1)), 'yesterday waits to be posted');
  assert.ok(pos.shifts.filter((s) => s.closedAt).some((s) => s.variance !== 0));
});
