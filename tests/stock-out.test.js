// Stock-out tickets: a person, or a role in a department, asks for stock; the store approves or rejects; the ticket never moves stock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sb = { window: {} }; sb.window = sb; vm.createContext(sb);
vm.runInContext(read('js/ops-rules.js'), sb);
const O = sb.AllurusOpsRules;
const paint = { id: 'it1', name: 'White paint', unit: 'litre' };
const base = { item: paint, qty: 5, department: 'Operations', reason: 'Used', by: 'e9', at: '2026-11-26T09:00:00Z', id: 's1', no: 'STO-261126-001' };

test('a role in a department: stored as pending, no staff id', () => {
  const r = O.makeStockOut({ ...base, requesterType: 'role', role: 'painter' });
  assert.ok(r.ok);
  assert.deepEqual([r.ticket.staffId, r.ticket.role, r.ticket.department, r.ticket.status, r.ticket.qty, r.ticket.unit, r.ticket.itemId, r.ticket.ticketNo], [null, 'painter', 'Operations', 'pending', 5, 'litre', 'it1', 'STO-261126-001']);
});
test('a person in a department: stored as pending, no role', () => {
  const r = O.makeStockOut({ ...base, requesterType: 'individual', staffId: 'e5' });
  assert.ok(r.ok); assert.equal(r.ticket.role, null); assert.equal(r.ticket.staffId, 'e5'); assert.equal(r.ticket.status, 'pending');
});
test('a person without the item list can type the item name', () => {
  const r = O.makeStockOut({ ...base, item: null, itemName: 'Thinner 5L', requesterType: 'individual', staffId: 'e5' });
  assert.ok(r.ok); assert.equal(r.ticket.itemId, ''); assert.equal(r.ticket.itemName, 'Thinner 5L');
});
test('rejected: no department, no requester type, no person or role, no item, quantity zero or less, a reason that adds stock', () => {
  const ok = { ...base, requesterType: 'role', role: 'painter' };
  for (const bad of [{ department: '' }, { department: '  ' }, { requesterType: '' }, { requesterType: 'team' }, { requesterType: 'individual', staffId: '' }, { role: '' }, { item: null }, { qty: 0 }, { qty: -2 }, { qty: NaN }, { reason: 'Received' }]) {
    const r = O.makeStockOut({ ...ok, ...bad }); assert.equal(r.ok, false, JSON.stringify(bad)); assert.ok(r.error);
  }
});
test('reasons are the ones that take stock out; numbers run per day', () => {
  assert.deepEqual([...O.STOCK_OUT_REASONS], ['Used', 'Sold', 'Damaged']);
  assert.equal(O.stockOutNo('2026-11-26', 7), 'STO-261126-007');
});
test('approve or reject once; a rejection needs a reason; no stock is touched', () => {
  const t = O.makeStockOut({ ...base, requesterType: 'role', role: 'painter' }).ticket;
  assert.equal(O.decideStockOut(t, 'rejected', { by: 'e1' }).ok, false, 'reason needed');
  const a = O.decideStockOut(t, 'approved', { by: 'e1', at: 'x' });
  assert.ok(a.ok); assert.equal(a.ticket.status, 'approved'); assert.equal(a.ticket.decidedBy, 'e1'); assert.equal(t.status, 'pending', 'the original is not changed');
  assert.equal(O.decideStockOut(a.ticket, 'rejected', { note: 'no' }).ok, false, 'only once');
  assert.equal(O.decideStockOut(t, 'rejected', { note: 'Not in budget' }).ticket.decisionNote, 'Not in budget');
  assert.ok(!read('js/ops.js').match(/stockOutDecide[\s\S]{0,900}ops\(\)\.moves\.push/), 'deciding adds no move');
  assert.deepEqual(Object.keys(O.emptyOps()).includes('stockOuts'), true);
});
test('the old Minta stok tickets still have their rules; the screens moved to js/stock-req.js (see tests/stock-request.test.js)', () => {
  const s = read('js/ops.js');
  assert.ok(s.includes("'stockouts'") && s.includes('...SR.actions') && s.includes("'breakdowns', 'licences', 'stockOuts']"));
  const n = read('js/notify-rules.js'); assert.ok(n.includes("'ops.stockout':") && n.includes("'ops.stockout.decided':"));
});
test('the bucket is shared like breakdowns: every member reads, a member only adds; nothing deployed by this test', () => {
  const rules = read('firestore.rules'), map = read('js/cloud-map.js');
  assert.match(rules, /function opsShared\(b\) \{ return b in \['ops\.machines', 'ops\.products', 'ops\.breakdowns', 'ops\.stockOuts'\]; \}/);
  assert.match(rules, /b in \['ops\.breakdowns', 'ops\.stockOuts'\] && \(hasArea\(t, 'operations'\) \|\| \(member\(t\) && onlyAdds\(\)\)\)/);
  assert.match(rules, /isOps\(b\) && !\(b in \['ops\.breakdowns', 'ops\.stockOuts'\]\) \? 'operations'/);
  assert.match(map, /OPS_SHARED = \['ops\.machines', 'ops\.products', 'ops\.breakdowns', 'ops\.stockOuts'\]/);
  assert.match(map, /b !== 'ops\.breakdowns' && b !== 'ops\.stockOuts' \? 'operations'/);
});
