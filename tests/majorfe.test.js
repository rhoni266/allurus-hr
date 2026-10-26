// The Major Far East Sdn Bhd demo company: three logins, a stock-only Operations setup, and the warehouse
// supervisor told about every purchase order that is on its way. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sb = { console };
sb.window = sb;
vm.createContext(sb);
for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'talent-rules', 'einvoice-rules', 'finance', 'tax', 'claims', 'planner', 'seed', 'ops-rules', 'seed-suria', 'seed-majorfe']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
}
const O = sb.AllurusOpsRules, T = sb.U.today();
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const C = sb.AllurusSeed.companies;
const mfe = C.majorfe.create();
const ops = mfe.ops;

test('a third demo company with its own storage, and the other two unchanged', () => {
  deq(Object.keys(C), ['serimaju', 'suria', 'majorfe']);
  assert.equal(new Set(Object.values(C).map((c) => c.storeKey)).size, 3);
  assert.equal(C.serimaju.storeKey, 'allurus-hr-v9');
  assert.equal(mfe.settings.company, 'Major Far East Sdn Bhd');
  assert.equal(mfe.settings.leave.state, 'Kuala Lumpur');
  deq(sb.AllurusLeaveRules.weekendDays(mfe.settings.leave), [6, 0], 'Monday to Friday');
});

test('three logins: the admin (Owner), the HR admin, and the warehouse supervisor with the stock page only', () => {
  C.majorfe.logins.forEach(([email]) => assert.ok(mfe.accounts.some((a) => a.email === email), email));
  const [admin, hr, sup] = mfe.accounts;
  assert.equal(admin.perms, undefined, 'the admin has every area');
  deq(hr.perms, ['people', 'time', 'payroll', 'claims', 'talent', 'settings'], 'the HR admin template: no books, no stock');
  deq(sup.roles, ['admin', 'employee']);
  deq(sup.perms, ['operations']);
  deq(sup.opsScope, ['stock']);
  assert.equal(mfe.employees.find((e) => e.id === sup.empId).role, 'Warehouse Supervisor');
  assert.ok(mfe.accounts.every((a) => /^[0-9a-f]{64}$/.test(a.hash)), 'passwords stored hashed');
});

test('stock: trading goods only, never negative, one low with nothing ordered, orders on their way', () => {
  assert.equal(ops.products.length, 0, 'no production or deliveries');
  assert.ok(ops.items.every((x) => x.kind === 'goods'));
  const lv = O.stockLevels(ops.items, ops.moves, ops.pos);
  assert.ok(lv.every((x) => x.onHand >= 0));
  const drafts = ops.pos.filter((p) => p.status === 'Draft');
  assert.equal(drafts.length, 1, 'one PO waiting for approval');
  assert.notEqual(drafts[0].by, 'e1', 'raised by purchasing, for the MD to approve');
  assert.ok(lv.some((x) => x.low && !x.onOrder && !drafts[0].lines.some((l) => l.itemId === x.id)), 'an item to Make PO for');
  assert.ok(ops.pos.filter((p) => p.status === 'Sent').length >= 2);
  assert.equal(ops.pos.filter((p) => p.status === 'Partial').length, 1);
  ops.pos.filter((p) => p.status === 'Billed').forEach((p) => assert.equal(mfe.finance.bills.find((b) => b.id === p.billId)?.category, 'Stock purchases', p.no));
});

test('the supervisor was told about each order on its way, with a link straight to it', () => {
  const coming = ops.pos.filter((p) => ['Sent', 'Partial'].includes(p.status));
  const told = mfe.notifications.filter((n) => n.to === 'e3' && n.type === 'ops.incoming');
  assert.equal(told.length, coming.length);
  coming.forEach((p) => assert.ok(told.some((n) => n.href === `#ops-stock?po=${p.id}`), p.no));
  assert.ok(mfe.notifications.some((n) => n.to === 'e1' && n.type === 'ops.po'), 'the MD has the draft to approve');
});

test('money: sales invoices with some unpaid, two paid payrolls without the owner', () => {
  const open = mfe.finance.invoices.filter((i) => i.status !== 'Paid');
  assert.ok(open.length > 0 && O.aging(open.map((i) => ({ client: i.customer, due: i.due, balance: sb.AllurusFinance.invoiceTotals(i).balance })), T).overdue > 0);
  const runs = Object.values(mfe.payroll);
  assert.equal(runs.length, 2);
  runs.forEach((r) => { assert.equal(r.status, 'Paid'); assert.ok(!r.items.some((i) => i.empId === 'e1')); });
});
