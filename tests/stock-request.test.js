// Stock requests: request, approve, hand over, receive, return. The reserve and available arithmetic, the steps and what each refuses,
// auto-cancel after the days set, the return conditions, and how the screens and rules are wired.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sb = { window: {} }; sb.window = sb; vm.createContext(sb);
vm.runInContext(read('js/stock-rules.js'), sb);
const R = sb.AllurusStockRules;
const L = (a) => Array.from(a);   // arrays from the sandbox compare by value

const staff = [{ id: 'e1', dept: 'd-ops', role: 'Painter', status: 'Active' }, { id: 'e2', dept: 'd-sales', role: 'Clerk', status: 'Active' }, { id: 'e3', dept: 'd-sup', role: 'Supervisor', status: 'Active' }, { id: 'e4', dept: 'd-ops', role: 'Storekeeper', status: 'Active' }, { id: 'e5', dept: 'd-ops', role: 'Painter', status: 'Inactive' }];
const paint = { id: 'it1', name: 'Paint', unit: 'tin', jenis: 'consume', allowDepts: ['d-ops'], allowRoles: [] };
const drill = { id: 'it2', name: 'Drill', unit: 'pcs', jenis: 'return', returnDays: 1, allowRoles: ['clerk'] };
const entry = (i, base = 10) => R.catalogEntry(i, base, staff);
const ask = (o = {}) => R.make({ entry: entry(paint), qty: 4, emp: staff[0], by: 'e1', at: '2026-11-20T01:00:00Z', id: 'r1', no: 'PS-261120-001', ...o });

test('who may request: by department, by job title, never an inactive person; empty lists mean admin only', () => {
  assert.deepEqual(L(R.requesters(paint, staff)), ['e1', 'e4'], 'the department, not the inactive painter');
  assert.deepEqual(L(R.requesters(drill, staff)), ['e2'], 'by job title, any case');
  assert.deepEqual(L(R.requesters({ id: 'x' }, staff)), []);
});
test('appointments: by department, by job title or by person, any mix, resolved to employee ids', () => {
  assert.deepEqual(L(R.appointees({ people: ['e3'] }, staff)), ['e3']);
  assert.deepEqual(L(R.appointees({ depts: ['d-sup'], roles: ['storekeeper'] }, staff)).sort(), ['e3', 'e4']);
  assert.deepEqual(L(R.appointees({}, staff)), []);
  const d = R.rolesDoc({ approverRule: { people: ['e3'] }, keeperRule: { roles: ['Storekeeper'] }, autoCancelDays: 3 }, staff);
  assert.deepEqual([L(d.approvers), L(d.keepers), d.autoCancelDays], [['e3'], ['e4'], 3]);
  assert.equal(R.rolesDoc({}, staff).autoCancelDays, 2, 'two days by default');
});
test('asking: needs an allowed item, a positive quantity, a reason; nothing is reserved yet', () => {
  assert.ok(ask().ok); assert.equal(ask().request.status, 'Diminta'); assert.equal(ask().request.returnable, false);
  assert.equal(ask({ emp: staff[1] }).ok, false, 'not allowed for this item');
  assert.equal(ask({ qty: 0 }).ok, false); assert.equal(ask({ qty: -1 }).ok, false); assert.equal(ask({ reason: 'Received' }).ok, false);
  assert.equal(ask({ availableQty: 3 }).ok, false, 'more than available');
  assert.equal(R.available(10, [ask().request], 'it1'), 10, 'a request reserves nothing until it is approved');
  assert.equal(R.make({ entry: entry(drill), qty: 1, emp: staff[1], by: 'e2', at: 'x', id: 'r2' }).request.returnable, true);
});
test('approve: reserves the quantity; may lower it, never raise it; never your own; reject needs a reason', () => {
  const q = ask().request;
  const a = R.decide(q, 'approve', { by: 'e3', qty: 3, availableQty: 10, at: 'T' });
  assert.ok(a.ok); assert.equal(a.request.status, 'Diluluskan'); assert.equal(a.request.approvedQty, 3);
  assert.equal(R.available(10, [a.request], 'it1'), 7, 'available = on hand − reserved');
  assert.equal(R.onHand(10, [a.request], 'it1'), 10, 'on hand is unchanged until the handover');
  assert.equal(R.decide(q, 'approve', { by: 'e3', qty: 5 }).ok, false, 'higher than asked');
  assert.equal(R.decide(q, 'approve', { by: 'e3', qty: 4, availableQty: 2 }).ok, false, 'more than available');
  assert.equal(R.decide(q, 'approve', { by: 'e1' }).ok, false, 'your own request');
  assert.equal(R.decide(a.request, 'approve', { by: 'e3' }).ok, false, 'twice');
  assert.equal(R.decide(q, 'reject', { by: 'e3' }).ok, false, 'a reason');
  assert.equal(R.decide(q, 'reject', { by: 'e3', note: 'No budget', at: 'T' }).request.status, 'Ditolak');
});
test('hand over: stock goes down and the reservation goes away; a photo is required; not to yourself; not without approval', () => {
  const q = ask().request, a = R.decide(q, 'approve', { by: 'e3', qty: 3, at: 'T0' }).request;
  assert.equal(R.handOver(q, { by: 'e4', photo: 'p' }).ok, false, 'not approved');
  assert.equal(R.handOver(a, { by: 'e4' }).ok, false, 'no photo');
  assert.equal(R.handOver(a, { by: 'e1', photo: 'p' }).ok, false, 'to yourself');
  assert.equal(R.handOver(a, { by: 'e4', photo: 'p', qty: 4 }).ok, false, 'more than approved');
  const h = R.handOver(a, { by: 'e4', photo: 'p', qty: 2, at: '2026-11-20T02:00:00Z' });
  assert.ok(h.ok); assert.equal(h.request.status, 'Diserahkan');
  assert.equal(R.onHand(10, [h.request], 'it1'), 8); assert.equal(R.available(10, [h.request], 'it1'), 8, 'the reservation is released');
  const m = R.moves([h.request]); assert.equal(m.length, 1); assert.equal(m[0].qty, -2); assert.equal(m[0].date, '2026-11-20');
});
test('receive (Terima): only the requester, once, after the handover', () => {
  const h = R.handOver(R.decide(ask().request, 'approve', { by: 'e3', at: 'T' }).request, { by: 'e4', photo: 'p', at: 'H' }).request;
  assert.equal(R.receive(h, { by: 'e2' }).ok, false);
  const r = R.receive(h, { by: 'e1', at: 'R' }); assert.ok(r.ok); assert.equal(R.receive(r.request, { by: 'e1' }).ok, false, 'once');
  assert.equal(R.receive(ask().request, { by: 'e1' }).ok, false, 'before the handover');
});
test('return: Baik and Rosak put the quantity back, Hilang does not and is flagged; a consumable is never returned', () => {
  const give = (item, emp) => R.handOver(R.decide(R.make({ entry: entry(item), qty: 2, emp, by: emp.id, at: 'x', id: 'q' }).request, 'approve', { by: 'e3', at: '2026-11-20T00:00:00Z' }).request, { by: 'e4', photo: 'p', at: '2026-11-20T00:00:00Z' }).request;
  const d = give(drill, staff[1]);
  assert.equal(R.giveBack(give(paint, staff[0]), { by: 'e4', condition: 'Baik' }).ok, false, 'consumable');
  assert.equal(R.giveBack(d, { by: 'e4', condition: 'Bagus' }).ok, false);
  assert.equal(R.giveBack(d, { by: 'e4', condition: 'Baik', qty: 3 }).ok, false, 'more than handed over');
  const good = R.giveBack(d, { by: 'e4', condition: 'Baik', at: 'B' }).request; assert.equal(R.onHand(10, [good], 'it2'), 10);
  const bad = R.giveBack(d, { by: 'e4', condition: 'Rosak' }).request; assert.equal(R.onHand(10, [bad], 'it2'), 10, 'damaged goes back on hand (the admin sees the flag)');
  const lost = R.giveBack(d, { by: 'e4', condition: 'Hilang' }).request; assert.equal(lost.lost, true); assert.equal(R.onHand(10, [lost], 'it2'), 8, 'lost does not come back'); assert.equal(R.pillOf(lost, '2026-11-21'), 'lost');
  assert.equal(R.moves([good]).length, 2, 'out and back in');
});
test('cancel: while Diminta or Diluluskan, by the requester; a handed-over request cannot be cancelled', () => {
  const q = ask().request, a = R.decide(q, 'approve', { by: 'e3', at: 'T' }).request;
  assert.equal(R.cancel(q, { by: 'e1' }).request.status, 'Dibatalkan'); assert.equal(R.cancel(a, { by: 'e1' }).ok, true);
  assert.equal(R.cancel(q, { by: 'e2' }).ok, false);
  assert.equal(R.cancel(R.handOver(a, { by: 'e4', photo: 'p' }).request, { by: 'e1' }).ok, false);
  assert.equal(R.available(10, [R.cancel(a, { by: 'e1' }).request], 'it1'), 10, 'the reservation is released');
});
test('auto-cancel: an approved request not collected within the days set is released; the milliseconds the cloud sends work too', () => {
  const a = R.decide(ask().request, 'approve', { by: 'e3', at: '2026-11-18T00:00:00Z' }).request;
  assert.equal(R.expired([a], '2026-11-19T23:00:00Z', 2).length, 0); assert.equal(R.expired([a], '2026-11-20T00:00:00Z', 2).length, 1);
  assert.equal(R.expired([{ ...a, decidedAt: Date.parse('2026-11-18T00:00:00Z') }], '2026-11-21T00:00:00Z', 2).length, 1);
  assert.equal(R.expired([a], '2026-11-20T00:00:00Z', 3).length, 0, 'the setting');
  const c = R.cancel(a, { auto: true, at: 'x' }); assert.ok(c.ok); assert.match(c.request.cancelNote, /Not collected/);
});
test('returnable items: due date, late, and what a person holds', () => {
  const h = R.handOver(R.decide(R.make({ entry: entry(drill), qty: 1, emp: staff[1], by: 'e2', at: 'x', id: 'q', no: 'PS-1' }).request, 'approve', { by: 'e3', at: '2026-11-20T00:00:00Z' }).request, { by: 'e4', photo: 'p', at: '2026-11-20T08:00:00Z' }).request;
  assert.equal(R.dueOn(h), '2026-11-21'); assert.equal(R.isLate(h, '2026-11-21'), false); assert.equal(R.isLate(h, '2026-11-22'), true);
  assert.equal(R.pillOf(h, '2026-11-21'), 'toreturn'); assert.equal(R.pillOf(h, '2026-11-22'), 'late');
  assert.deepEqual(L(R.held([h], 'e2').map((x) => x.id)), ['q']); assert.deepEqual(L(R.held([h], 'e1')), []);
  assert.equal(R.dueOn(ask().request), '', 'a consumable has no return date');
});
test('old Minta stok tickets become requests in status Diminta', () => {
  const r = R.fromTicket({ id: 's1', ticketNo: 'STO-261119-001', itemId: 'it1', itemName: 'Paint', qty: 2, unit: 'tin', reason: 'Used', requesterType: 'role', role: 'painter', department: 'Operations', by: 'e1', at: 'A', status: 'pending' }, [paint]);
  assert.equal(r.status, 'Diminta'); assert.equal(r.empId, 'e1'); assert.match(r.note, /role: painter/); assert.equal(r.migrated, true);
});
test('the screens, notifications and rules are wired; staff never write a stock quantity', () => {
  const ops = read('js/ops.js'), req = read('js/stock-req.js'), rules = read('firestore.rules'), app = read('js/app.js'), html = read('app.html');
  assert.ok(html.includes('js/stock-rules.js?v=') && html.includes('js/stock-req.js?v='));
  assert.ok(ops.includes('SR.adminList()') && ops.includes('...SR.actions') && ops.includes('SRR.moves(reqList())'), 'tab, actions, and stock counts handed-over requests');
  assert.ok(app.includes("opsApi?.stockBits('simple')") && app.includes('opsApi?.stockSettings()'), 'simple home and Settings');
  for (const k of ['Minta stok', 'Kelulusan stok', 'Serahan stok', 'Pulangan', 'Permintaan saya', 'Barang dipegang', 'Terima', 'Sedia diambil', 'Perlu dipulang', 'Lewat']) assert.ok(req.includes(k), k);
  for (const n of ['stock.ask', 'stock.approved', 'stock.ready', 'stock.rejected', 'stock.handed', 'stock.low', 'stock.lost']) assert.ok(read('js/notify-rules.js').includes(`'${n}'`), n);
  assert.match(rules, /match \/stockRequests\/\{id\}/); assert.match(rules, /match \/stockAudit\/\{a\}/); assert.match(rules, /match \/stockRoles\/\{id\}/);
  assert.match(rules, /isKeeper|let kp = e in sr\.get\('keepers'/); assert.match(rules, /ns == 'Diserahkan' && n\.handedBy == e/);
  assert.ok(!/stockCatalog[^\n]*allow write: if member/.test(rules), 'the catalog is written by Operations only');
  assert.match(read('js/cloud-map.js'), /'stockRequests', 'stockRoles', 'stockCatalog'/);
  assert.ok(!/ops\(\)\.moves\.push[^\n]*stockRequest/.test(req), 'a request never writes a stock move');
});
