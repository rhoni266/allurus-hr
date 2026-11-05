// Logins, roles, supervisor-approved voids, staff from allurus-hr and the audit logs (POS role & access spec), against
// the fake Sheet and fake allurus-hr directory from code.test.js. Run: node --test pos/tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'code.test.js'), 'utf8');
const helper = src.slice(src.indexOf('function load('), src.indexOf("test('3 items"));
const load = new Function('fs', 'path', 'vm', '__dirname', 'require', helper + '\nreturn load;')(fs, path, vm, __dirname, require);

const J = (x) => JSON.parse(JSON.stringify(x));
const rowsOf = (tabs, name) => tabs[name].slice(1).map((r) => Object.fromEntries(tabs[name][0].map((h, i) => [h, r[i]])));
const sale = (w, id, as, extra = {}) => w.call('createSale', { sale_id: id, payment_method: 'cash', items: [{ product_id: w.prods.Latte.id, qty: 1 }], ...extra }, undefined, as);

test('no session, no access; the shared key alone is not enough', () => {
  const w = load();
  assert.match(w.raw('getProducts', {}).error, /^SIGNED_OUT/);
  assert.match(w.raw('createSale', {}, undefined, 'f'.repeat(64)).error, /^SIGNED_OUT/);
  assert.equal(w.raw('getProducts', {}, 'wrong-key-xxxxxxx', w.tokens.sv1).error, 'Not allowed');
  assert.equal(w.raw('login', { emp_id: 'sv1', pin: '9999' }).ok, false);
});

test('starter admin: 0000 works once, must be changed before anything else, and can never be 0000 again', () => {
  const w = load();
  const t = w.raw('login', { emp_id: 'admin', pin: '4826' }).data.token; // the helper already changed it
  assert.equal(w.raw('login', { emp_id: 'admin', pin: '0000' }).ok, false);
  w.raw('updateStaff', { emp_id: 'sv1', reset_pin: '1357' }, undefined, t);
  const s = w.raw('login', { emp_id: 'sv1', pin: '1357' }).data;
  assert.equal(s.must_change_pin, true);
  assert.match(w.raw('createSale', {}, undefined, s.token).error, /^CHANGE_PIN/);
  assert.match(w.raw('changePin', { old_pin: '1357', new_pin: '0000' }, undefined, s.token).error, /harder to guess/);
  assert.equal(w.raw('changePin', { old_pin: '1357', new_pin: '8642' }, undefined, s.token).ok, true);
  assert.match(sale(w, 'sale-pin01', 'sv1').error, /^SIGNED_OUT: Your PIN was changed/); // the reset ended sv1's older session
  assert.equal(w.raw('createSale', { sale_id: 'sale-pin02', payment_method: 'cash', items: [{ product_id: w.prods.Latte.id, qty: 1 }] }, undefined, s.token).ok, true);
});

test('cashier: checkout and logging waste only; no discount, reports, stock, menu or staff', () => {
  const w = load();
  assert.equal(sale(w, 'sale-cash1', 'c1').ok, true);
  assert.match(sale(w, 'sale-cash2', 'c1', { discount: { type: 'pct', value: 10 } }).error, /Only a supervisor can give a discount/);
  for (const a of ['getDailySummary', 'getVoidLog', 'getWaste', 'reverseWaste', 'getStockReport', 'receivePurchase', 'stockCount', 'getRecipes', 'saveProduct', 'listStaff', 'getAuditLog']) {
    assert.equal(w.call(a, {}, undefined, 'c1').error, 'Not allowed for a cashier', a);
  }
  assert.equal(w.call('getProducts', {}, undefined, 'c1').ok, true);
  assert.equal(rowsOf(w.tabs, 'Sales')[0].cashier_id, 'c1');
});

test('waste: a cashier can log it; every line carries who keyed it, and only a supervisor or admin can read or reverse', () => {
  const w = load();
  const id = w.prods.Latte.id;
  // the person comes from the session: a name or ID typed into the request is ignored
  const r = w.call('logWaste', { waste_id: 'waste-cash01', staff_name: 'Someone Else', emp_id: 'sv1', items: [{ product_id: id, qty: 1, reason: 'dropped' }] }, undefined, 'c1');
  assert.equal(r.ok, true);
  const row = rowsOf(w.tabs, 'Waste')[0];
  assert.equal(row.emp_id, 'c1');
  assert.equal(row.role, 'cashier');
  assert.notEqual(row.staff_name, 'Someone Else');
  // a supervisor logs one too
  assert.equal(w.call('logWaste', { waste_id: 'waste-sv0001', items: [{ product_id: id, qty: 2, reason: 'spoiled' }] }, undefined, 'sv1').ok, true);
  // the cashier can neither read nor reverse
  assert.equal(w.call('getWaste', {}, undefined, 'c1').error, 'Not allowed for a cashier');
  assert.equal(w.call('reverseWaste', { waste_id: 'waste-cash01', reason: 'mistake' }, undefined, 'c1').error, 'Not allowed for a cashier');
  // supervisor and admin see who keyed each entry, and a total per person
  for (const as of ['sv1', 'admin']) {
    const g = w.call('getWaste', {}, undefined, as).data;
    const mine = g.rows.filter((x) => x.waste_id === 'waste-cash01')[0];
    assert.equal(mine.emp_id, 'c1');
    assert.equal(mine.role, 'cashier');
    assert.deepEqual(J(g.by_staff.map((x) => [x.emp_id, x.role, x.entries]).sort()), [['c1', 'cashier', 1], ['sv1', 'supervisor', 1]]);
  }
  // filter by person
  assert.deepEqual(J(w.call('getWaste', { emp_id: 'c1' }, undefined, 'sv1').data.rows.map((x) => x.emp_id)), ['c1']);
  // the Today summary carries the same per-person totals
  assert.equal(w.call('getDailySummary', {}, undefined, 'sv1').data.waste_by_staff.length, 2);
  // a supervisor reversing it is tagged on the reversal row; the original keeps the cashier
  assert.equal(w.call('reverseWaste', { waste_id: 'waste-cash01', reason: 'logged by mistake' }, undefined, 'sv1').ok, true);
  const rows = rowsOf(w.tabs, 'Waste').filter((x) => x.waste_id === 'waste-cash01' || x.waste_id === 'rev-waste-cash01');
  assert.deepEqual(J(rows.map((x) => [x.waste_id, x.emp_id, x.role])), [['waste-cash01', 'c1', 'cashier'], ['rev-waste-cash01', 'sv1', 'supervisor']]);
});

test('waste: an admin can log waste too (back office), still never checkout or void', () => {
  const w = load();
  assert.equal(w.call('logWaste', { waste_id: 'waste-adm001', items: [{ product_id: w.prods.Latte.id, qty: 1, reason: 'expired' }] }, undefined, 'admin').ok, true);
  assert.equal(rowsOf(w.tabs, 'Waste')[0].role, 'admin');
});

test('admin: back office but never checkout or void; supervisor: floor but never prices, menu or staff', () => {
  const w = load();
  assert.equal(sale(w, 'sale-adm01', 'admin').error, 'Not allowed for a admin');
  sale(w, 'sale-adm02', 'sv1');
  assert.equal(w.call('voidSale', { sale_id: 'sale-adm02', reason: 'customer_changed' }, undefined, 'admin').error, 'Not allowed for a admin');
  assert.equal(w.call('getDailySummary', {}, undefined, 'admin').ok, true);
  assert.equal(w.call('saveProduct', { ...w.prods.Latte, price: 11.5 }, undefined, 'sv1').error, 'Not allowed for a supervisor');
  assert.equal(w.call('saveRecipe', { menu_product_id: w.prods.Latte.id, lines: [] }, undefined, 'sv1').error, 'Not allowed for a supervisor');
  assert.equal(w.call('listStaff', {}, undefined, 'sv1').error, 'Not allowed for a supervisor');
  assert.equal(sale(w, 'sale-sv001', 'sv1', { discount: { type: 'rm', value: 1 } }).ok, true);
  assert.equal(w.call('logWaste', { waste_id: 'waste-sv001', items: [{ product_id: w.prods.Latte.id, qty: 1, reason: 'dropped' }] }, undefined, 'sv1').ok, true);
});

test('price and menu changes are logged with who, old and new; past bills keep their price', () => {
  const w = load();
  sale(w, 'sale-prc01', 'sv1');
  assert.equal(w.call('saveProduct', { ...w.prods.Latte, price: 11.5 }).ok, true);
  const log = rowsOf(w.tabs, 'ChangeLog').filter((x) => x.field === 'price');
  assert.deepEqual(J(log.map((x) => [x.actor, x.entity, x.old_value, x.new_value])), [['admin', 'product', '10.9', '11.5']]);
  assert.equal(rowsOf(w.tabs, 'SaleItems')[0].unit_price, 10.9);
  sale(w, 'sale-prc02', 'sv1');
  assert.equal(rowsOf(w.tabs, 'SaleItems')[1].unit_price, 11.5);
});

test('void: a cashier needs a supervisor\'s own ID + PIN; reason required; logged with both IDs', () => {
  const w = load();
  sale(w, 'sale-void1', 'c1');
  const v = (d) => w.call('voidSale', { sale_id: 'sale-void1', ...d }, undefined, 'c1');
  assert.match(v({ reason: 'customer_changed', approver_id: 'c1', approver_pin: '2468' }).error, /Only a supervisor can approve/);
  assert.match(v({ reason: 'customer_changed', approver_id: 'sv1', approver_pin: '1111' }).error, /Wrong Employee ID or PIN/);
  assert.match(v({ reason: '', approver_id: 'sv1', approver_pin: '2468' }).error, /void reason/);
  assert.match(v({ reason: 'other', note: '', approver_id: 'sv1', approver_pin: '2468' }).error, /note/);
  assert.equal(rowsOf(w.tabs, 'Sales')[0].status, 'paid');
  const r = v({ reason: 'customer_changed', approver_id: 'sv2', approver_pin: '2468', made: false });
  assert.deepEqual(J([r.data.void_id, r.data.approved_by]), ['V-000001', 'sv2']);
  const log = rowsOf(w.tabs, 'VoidLog')[0];
  assert.deepEqual(J([log.void_id, log.receipt_no, log.items, log.amount, log.requested_by, log.approved_by, log.reason, log.outlet]),
    ['V-000001', 'R000001', 'Latte (sample) x1', 10.9, 'c1', 'sv2', 'Customer changed order', 'Outlet 1']);
  // A supervisor voiding directly still enters their own ID + PIN; the approval covers only that one void.
  sale(w, 'sale-void2', 'sv1');
  assert.match(w.call('voidSale', { sale_id: 'sale-void2', reason: 'duplicate', approver_id: 'sv1', approver_pin: '0000' }, undefined, 'sv1').error, /Wrong/);
  assert.equal(w.call('voidSale', { sale_id: 'sale-void2', reason: 'duplicate', approver_id: 'sv1', approver_pin: '2468' }, undefined, 'sv1').data.void_id, 'V-000002');
  // read-only views, with filters
  assert.equal(w.call('getVoidLog', {}, undefined, 'admin').data.rows.length, 2);
  assert.deepEqual(J(w.call('getVoidLog', { supervisor: 'sv2' }, undefined, 'sv1').data.rows.map((x) => x.void_id)), ['V-000001']);
  assert.deepEqual(J(w.call('getVoidLog', { cashier: 'sv1', reason: 'duplicate' }, undefined, 'sv1').data.rows.map((x) => x.void_id)), ['V-000002']);
});

test('5 wrong PINs lock the account until an admin unlocks it; PINs are never stored in plain text', () => {
  const w = load();
  for (let i = 0; i < 4; i++) assert.match(w.raw('login', { emp_id: 'c1', pin: '0001' }).error, /tries left/);
  assert.match(w.raw('login', { emp_id: 'c1', pin: '0001' }).error, /now locked/);
  assert.match(w.raw('login', { emp_id: 'c1', pin: '2468' }).error, /locked/);
  assert.match(w.call('createSale', {}, undefined, 'c1').error, /^SIGNED_OUT/); // a lock ends open sessions too
  w.call('updateStaff', { emp_id: 'c1', status: 'active' });
  assert.equal(w.raw('login', { emp_id: 'c1', pin: '2468' }).ok, true);
  const staff = rowsOf(w.tabs, 'Staff');
  assert.ok(staff.every((s) => /^[0-9a-f]{64}$/.test(s.pin_hash) && s.pin_hash !== '2468'));
  assert.ok(!JSON.stringify(w.tabs).includes('"2468"'));
  assert.deepEqual(J(rowsOf(w.tabs, 'StaffLog').filter((x) => x.emp_id === 'c1').map((x) => x.action).filter((a) => a !== 'login')), ['created', 'locked', 'unlocked']);
});

test('staff only from allurus-hr: search, add, refuse unknown or resigned, auto-disable on resignation', () => {
  const w = load();
  const found = w.call('hrSearch', { q: 'han' }).data;
  assert.deepEqual(J(found.map((h) => [h.emp_id, h.name, h.pos_role])), [['ad1', 'Hana Ismail', '']]);
  assert.equal(w.call('hrSearch', { q: 'aina' }).data[0].pos_role, 'supervisor');
  assert.match(w.call('addStaff', { emp_id: 'zz1', role: 'cashier', pin: '2468' }).error, /HR must add this person first/);
  assert.match(w.call('addStaff', { emp_id: 'x9', role: 'cashier', pin: '2468' }).error, /Resigned in allurus-hr/);
  assert.match(w.call('addStaff', { emp_id: 'c1', role: 'cashier', pin: '2468' }).error, /already has a POS account/);
  assert.match(w.call('addStaff', { emp_id: 'ad1', role: 'admin', pin: '0000' }).error, /not 0000/);
  const a = w.call('addStaff', { emp_id: 'ad1', role: 'admin', pin: '5791' }).data;
  assert.deepEqual(J([a.emp_id, a.name, a.role, a.status]), ['ad1', 'Hana Ismail', 'admin', 'active']);
  // HR marks the cashier resigned: the next sync disables the POS account and ends their session at once
  w.hr.find((e) => e.id === 'c1').status = 'Resigned';
  const list = w.call('listStaff', { sync: true }).data.staff;
  assert.deepEqual(J(list.filter((s) => s.emp_id === 'c1').map((s) => [s.status, s.hr_status])), [['disabled', 'Resigned']]);
  assert.match(w.call('getProducts', {}, undefined, 'c1').error, /^SIGNED_OUT/);
  assert.match(w.call('updateStaff', { emp_id: 'c1', status: 'active' }).error, /Not active in allurus-hr/);
  assert.ok(rowsOf(w.tabs, 'StaffLog').some((x) => x.action === 'auto_disabled' && x.emp_id === 'c1'));
});

test('allurus-hr refuses the read: clear message, POS staff untouched', () => {
  const w = load();
  w.ctx.PropertiesService.getScriptProperties = () => ({ getProperty: (k) => ({ SECRET_KEY: 'test-secret-123', ALLURUS_TENANT: 'other-company' })[k] || null });
  assert.match(w.call('hrSearch', { q: '' }).error, /refused the read \(403\)/);
  const r = w.call('listStaff', { sync: true }).data;
  assert.match(r.hr_note, /403/);
  assert.ok(r.staff.every((s) => s.status === 'active'));
});

test('the starter admin can\'t be disabled or demoted; nobody changes their own role; role changes are logged', () => {
  const w = load();
  w.call('addStaff', { emp_id: 'ad1', role: 'admin', pin: '5791' });
  w.signIn('ad1', '5791');
  assert.match(w.call('updateStaff', { emp_id: 'admin', status: 'disabled' }, undefined, 'ad1').error, /can't be disabled/);
  assert.match(w.call('updateStaff', { emp_id: 'admin', role: 'cashier' }, undefined, 'ad1').error, /stays an admin/);
  assert.match(w.call('updateStaff', { emp_id: 'ad1', role: 'cashier' }, undefined, 'ad1').error, /your own role/);
  assert.equal(w.call('updateStaff', { emp_id: 'sv3', role: 'cashier' }, undefined, 'ad1').data.role, 'cashier');
  const log = rowsOf(w.tabs, 'StaffLog').filter((x) => x.action === 'role_changed');
  assert.deepEqual(J(log.map((x) => [x.actor, x.emp_id, x.detail])), [['ad1', 'sv3', 'supervisor → cashier']]);
  assert.equal(w.call('getAuditLog', { type: 'staff' }, undefined, 'ad1').data.rows[0].action, 'role_changed');
});

test('an idle session ends; logout ends it at once', () => {
  const w = load();
  assert.equal(w.call('getProducts', {}, undefined, 'c1').ok, true);
  w.cache.delete('sess:' + w.tokens.c1); // what the cache does after SESSION_IDLE_MIN without a call
  assert.match(w.call('getProducts', {}, undefined, 'c1').error, /^SIGNED_OUT/);
  w.call('logout', {}, undefined, 'sv1');
  assert.match(w.call('getProducts', {}, undefined, 'sv1').error, /^SIGNED_OUT/);
});

test('locked-out admin: the script owner can reset the starter admin from the editor', () => {
  const w = load();
  for (let i = 0; i < 5; i++) w.raw('login', { emp_id: 'admin', pin: '1111' });
  assert.match(w.raw('login', { emp_id: 'admin', pin: '4826' }).error, /locked/);
  w.ctx.resetStarterAdmin();
  const s = w.raw('login', { emp_id: 'admin', pin: '0000' }).data;
  assert.equal(s.must_change_pin, true);
  assert.ok(rowsOf(w.tabs, 'StaffLog').some((x) => x.action === 'starter_admin_reset'));
});
