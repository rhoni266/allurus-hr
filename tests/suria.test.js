// The Suria Enterprise demo company: the facts the demo walkthrough relies on, and that the two demo companies
// stay separate. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = { console };
sb.window = sb;
vm.createContext(sb);
for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'talent-rules', 'einvoice-rules', 'invoice-rules', 'finance', 'tax', 'claims', 'planner', 'seed', 'ops-rules', 'seed-suria']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
}
const O = sb.AllurusOpsRules, T = sb.U.today();
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const suria = sb.AllurusSeed.companies.suria.create();
const ops = suria.ops;

test('the registry keeps the two demo companies apart', () => {
  const C = sb.AllurusSeed.companies;
  deq(Object.keys(C), ['serimaju', 'suria']);
  assert.notEqual(C.serimaju.storeKey, C.suria.storeKey);
  assert.equal(C.serimaju.storeKey, 'allurus-hr-v9', 'Seri Maju keeps its existing key');
  assert.equal(sb.AllurusSeed.company('nope').id, 'serimaju');
  // Each company's one-click logins exist in its own seed.
  const sm = sb.AllurusSeed.create();
  C.serimaju.logins.forEach(([email]) => assert.ok(sm.accounts.some((a) => a.email === email), email));
  C.suria.logins.forEach(([email]) => assert.ok(suria.accounts.some((a) => a.email === email), email));
  assert.equal(sm.settings.company, 'Seri Maju Digital Sdn Bhd');
  assert.ok(!sm.ops, 'Seri Maju has no operations data');
});

test('company and people', () => {
  assert.equal(suria.settings.company, 'Suria Enterprise');
  assert.equal(suria.settings.leave.state, 'Johor');
  deq(sb.AllurusLeaveRules.weekendDays(suria.settings.leave), [0], 'Monday to Saturday, Sunday rest');
  assert.equal(suria.employees.length, 28);
  const by = (d) => suria.employees.filter((e) => e.dept === d).length;
  deq(['d-mgmt', 'd-admin', 'd-prod', 'd-qc', 'd-maint', 'd-sales'].map(by), [2, 3, 12, 3, 2, 6]);
  assert.ok(suria.employees.filter((e) => e.type !== 'Owner').every((e) => e.salary / 12 >= 1700 && /^01\d-/.test(e.phone)));
  assert.equal(suria.employees.filter((e) => e.type !== 'Owner' && e.salary / 12 <= 4000).length, 26, 'most are non-executive, within the overtime wage limit');
  // Passwords are stored hashed, never in plain text.
  assert.ok(suria.accounts.every((a) => /^[0-9a-f]{64}$/.test(a.hash)));
});

test('payroll: three paid months with overtime from the time rules, and no owner salary', () => {
  const runs = Object.values(suria.payroll);
  assert.equal(runs.length, 3);
  runs.forEach((r) => {
    assert.equal(r.status, 'Paid');
    assert.ok(!r.items.some((i) => i.empId === 'e1'));
    assert.ok(r.items.some((i) => (i.extraLines || []).some((l) => l.key === 'ot' && l.amount > 0)));
  });
  // Overtime only for those earning up to RM4,000 a month.
  runs.forEach((r) => r.items.filter((i) => suria.employees.find((e) => e.id === i.empId).salary / 12 > 4000).forEach((i) => assert.ok(!(i.extraLines || []).length)));
});

test('documents: food handlers and drivers, three expiring within 30 days', () => {
  const soon = suria.documents.filter((d) => d.expiry && d.expiry >= T && d.expiry <= sb.U.addDays(T, 30));
  assert.equal(soon.length, 3);
  const handlers = suria.employees.filter((e) => ['d-prod', 'd-qc'].includes(e.dept));
  handlers.forEach((e) => ['Typhoid vaccination', 'Food handler certificate'].forEach((t) => assert.ok(suria.documents.some((d) => d.empId === e.id && d.title === t), `${e.id} ${t}`)));
  assert.ok(suria.documents.some((d) => d.empId === 'e26' && /GDL/.test(d.title)));
  assert.equal(ops.licences.length, 3);
});

test('stock and purchasing: three items low, two POs on the way, one partly received', () => {
  const lv = O.stockLevels(ops.items, ops.moves, ops.pos);
  assert.equal(ops.items.length, 12);
  assert.ok(lv.every((x) => x.onHand >= 0), 'stock never negative');
  assert.equal(lv.filter((x) => x.low).length, 3);
  assert.equal(ops.pos.filter((p) => p.status === 'Sent').length, 2);
  assert.equal(ops.pos.filter((p) => p.status === 'Partial').length, 1);
  // Every billed PO has its bill in Finance, for the PO's value.
  ops.pos.filter((p) => p.status === 'Billed').forEach((p) => { const b = suria.finance.bills.find((x) => x.id === p.billId); assert.ok(b, p.no); assert.equal(b.amount, O.poTotal(p)); });
});

test('production, deliveries and machines', () => {
  assert.ok(ops.batches.length >= 38 && ops.batches.length <= 46, `${ops.batches.length} batches`);
  assert.equal(ops.batches.filter((b) => b.qc === 'Hold').length, 1);
  deq(ops.products.map((p) => p.code), ['CB-O500', 'CB-O1K', 'CB-P500', 'CB-P5K']);
  // Nothing was ever delivered from a batch on hold or beyond what a batch made.
  ops.products.forEach((p) => O.lots(ops.batches, ops.dos, p.id, T).forEach((l) => assert.ok(l.left >= 0, l.no)));
  const today = ops.dos.filter((d) => d.date === T);
  assert.equal(today.length, 6);
  assert.equal(today.filter((d) => d.status === 'Delivered').length, 2);
  deq([...new Set(today.map((d) => d.vehicleId))].sort(), ['v-lorry', 'v-van']);
  // A delivered DO has its invoice; cash on delivery is paid.
  ops.dos.filter((d) => d.status === 'Delivered').forEach((d) => { const inv = suria.finance.invoices.find((i) => i.id === d.invoiceId); assert.ok(inv, d.no); if (d.cash) assert.equal(inv.status, 'Paid'); });
  const st = Object.fromEntries(ops.machines.map((m) => [m.id, O.pmStatus(m, T).status]));
  assert.equal(ops.machines.filter((m) => m.status === 'Down').length, 1);
  assert.equal(Object.values(st).filter((s) => s === 'Due').length, 2);
  assert.equal(Object.values(st).filter((s) => s === 'Overdue').length, 1);
});

test('money: overdue client invoices and bills due', () => {
  const open = suria.finance.invoices.filter((i) => i.status !== 'Paid').map((i) => ({ client: i.customer, due: i.due, balance: sb.AllurusFinance.invoiceTotals(i).balance }));
  const a = O.aging(open, T);
  assert.ok(a.overdue > 0 && a.d60p > 0, 'some invoices are more than 60 days overdue');
  const due = O.billsDue(suria.finance.bills, T);
  assert.ok(due.overdue.length >= 1 && due.week.length >= 1);
  assert.equal(suria.finance.contacts.filter((c) => c.kind === 'customer').length, 15);
});
