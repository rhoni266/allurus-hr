// Server side of the point of sale (functions/pos-core.js) against a small in-memory Firestore that, like the real
// one, refuses a read after a write inside a transaction. Run with: npm test (repo root) or npm test in functions/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// pos-rules.js is copied in at deploy; for the tests, use the source.
const copy = path.join(__dirname, '..', 'pos-rules.js');
if (!fs.existsSync(copy)) fs.copyFileSync(path.join(__dirname, '..', '..', 'js', 'pos-rules.js'), copy);
const core = require('../pos-core.js');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  let auto = 0;
  const snap = (p) => ({ exists: docs.has(p), id: p.split('/').pop(), ref: ref(p), data: () => JSON.parse(JSON.stringify(docs.get(p))) });
  const ref = (p) => ({ path: p, id: p.split('/').pop(), kind: 'doc' });
  const query = (c, filters = []) => ({ kind: 'query', c, filters, where: (f, op, v) => query(c, [...filters, [f, v]]) });
  const run = (q) => {
    const out = [...docs.keys()].filter((k) => k.startsWith(q.c + '/') && k.split('/').length === q.c.split('/').length + 1)
      .filter((k) => q.filters.every(([f, v]) => (docs.get(k)[f] ?? null) === v)).map(snap);
    return { empty: !out.length, docs: out };
  };
  const db = {
    docs,
    doc: ref,
    collection: (c) => ({ ...query(c), doc: () => ref(`${c}/auto${++auto}`) }),
    async runTransaction(fn) {
      const writes = []; let wrote = false;
      const tx = {
        async get(r) { if (wrote) throw new Error('Firestore: all reads must come before writes'); return r.kind === 'doc' ? snap(r.path) : run(r); },
        set(r, v) { wrote = true; writes.push(() => docs.set(r.path, JSON.parse(JSON.stringify(v)))); },
        update(r, v) { wrote = true; writes.push(() => { if (!docs.has(r.path)) throw new Error('no doc ' + r.path); docs.set(r.path, { ...docs.get(r.path), ...JSON.parse(JSON.stringify(v)) }); }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
  };
  return db;
}

const T = 'tenants/t1';
const outlet = { code: 'BKL', methods: ['cash', 'card_external', 'qr_manual'], tips: true, taxes: { SST6: { rateBp: 600, label: 'SST 6%' } }, serviceCharge: { enabled: true, rateBp: 1000, orderTypes: ['dine_in'], taxCode: 'SST6' } };
const line = (id, unitPrice, qty) => ({ id, itemId: id, name: id, qty, unitPrice, modifiers: [], taxCode: 'SST6', status: 'new' });
function world(extra = {}) {
  return fakeDb({
    [T]: { status: 'active' },
    'users/cash1': { tenantId: 't1', empId: 'e3', roles: ['employee'], posRole: 'cashier' },
    'users/mgr1': { tenantId: 't1', empId: 'e2', roles: ['admin', 'employee'], perms: ['pos'], posRole: 'manager', posPin: sha256('pos-pin:e2:2468') },
    'users/kit1': { tenantId: 't1', empId: 'e5', roles: ['employee'], posRole: 'kitchen' },
    'users/other': { tenantId: 't2', empId: 'e1', roles: ['admin', 'employee'] },
    [`${T}/pos_outlets/o1`]: outlet,
    [`${T}/pos_shifts/s1`]: { outletId: 'o1', cashierUid: 'e3', openedAt: '2026-10-30T00:00:00Z', openingCash: 20000, cashMoves: [], closedAt: null },
    [`${T}/pos_tables/T3`]: { status: 'occupied', currentOrderId: 'c1' },
    // 2 × 12.90 + 1 × 7.90 = 33.70; service charge 3.37; SST on 37.07 = 2.22; total 39.29
    [`${T}/pos_orders/c1`]: { outletId: 'o1', tableId: 'T3', type: 'dine_in', status: 'sent', lines: [line('latte', 1290, 2), line('croissant', 790, 1)], total: 1 },
    ...extra,
  });
}
const pay = (db, uid, data) => core.recordPayment(db, { uid, data: { tenantId: 't1', orderId: 'c1', ...data }, clock: () => Date.parse('2026-10-30T05:00:00Z') });
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code || e.message; } };

test('cash pays the order: the server works out the total itself (ignores the till’s), rounds, gives change, numbers the receipt and frees the table', async () => {
  const db = world();
  const r = await pay(db, 'cash1', { method: 'cash', tendered: 5000, idempotencyKey: 'key-cash-0001' });
  assert.equal(r.settle.due, 3930); assert.equal(r.settle.change, 1070); assert.equal(r.receiptNo, 'BKL-000001');
  const o = db.docs.get(`${T}/pos_orders/c1`);
  assert.equal(o.total, 3929); assert.equal(o.status, 'paid'); assert.equal(o.rounding, 1);
  assert.equal(db.docs.get(`${T}/pos_tables/T3`).status, 'free');
  assert.equal(db.docs.get(`${T}/pos_counters/o1`).n, 1);
});

test('the same call twice (retry) takes the payment once', async () => {
  const db = world();
  await pay(db, 'cash1', { method: 'qr_manual', amount: 1000, reference: 'DN1', idempotencyKey: 'key-retry-001' });
  const again = await pay(db, 'cash1', { method: 'qr_manual', amount: 1000, reference: 'DN1', idempotencyKey: 'key-retry-001' });
  assert.equal(again.duplicate, true);
  assert.equal([...db.docs.keys()].filter((k) => k.includes('pos_payments/')).length, 1);
});

test('split: QR then cash; the receipt number only once fully paid; a paid order takes nothing more', async () => {
  const db = world();
  const a = await pay(db, 'cash1', { method: 'qr_manual', amount: 2000, reference: 'DN2', idempotencyKey: 'key-split-001' });
  assert.equal(a.receiptNo, ''); assert.equal(a.settle.balance, 1929);
  const b = await pay(db, 'cash1', { method: 'cash', tendered: 2000, idempotencyKey: 'key-split-002' });
  assert.equal(b.receiptNo, 'BKL-000001'); assert.equal(b.settle.change, 70); assert.equal(b.settle.rounding, 1);
  assert.equal(await code(pay(db, 'cash1', { method: 'cash', tendered: 100, idempotencyKey: 'key-split-003' })), 'failed-precondition');
});

test('card tap and DuitNow QR can never be approved through this function', async () => {
  for (const method of ['card_tap', 'duitnow_qr', 'ewallet']) assert.equal(await code(pay(world(), 'cash1', { method, amount: 3929, idempotencyKey: 'key-server-01' })), 'failed-precondition');
});

test('card data is refused; a recorded card payment keeps only code, brand and last 4', async () => {
  assert.equal(await code(pay(world(), 'cash1', { method: 'card_external', amount: 3929, approvalCode: '4111111111111111', cardLast4: '1111', idempotencyKey: 'key-card-0001' })), 'invalid-argument');
  // A card number in any field refuses the whole call, rather than being quietly dropped.
  assert.equal(await code(pay(world(), 'cash1', { method: 'card_external', amount: 3929, approvalCode: '834221', cardLast4: '0042', pan: '4111111111111111', idempotencyKey: 'key-card-0002' })), 'invalid-argument');
  const db = world();
  await pay(db, 'cash1', { method: 'card_external', amount: 3929, approvalCode: '834221', cardLast4: '0042', cardBrand: 'Visa', cvv: '123', expiry: '12/29', idempotencyKey: 'key-card-0003' });
  const p = db.docs.get(`${T}/pos_payments/key-card-0003`);
  assert.ok(!('cvv' in p) && !('expiry' in p) && !JSON.stringify(p).includes('12/29'));
  assert.equal(p.cardLast4, '0042'); assert.equal(p.reconcile, true);
});

test('permissions: kitchen can’t take payments; another company can’t touch this one; signed out is refused', async () => {
  assert.equal(await code(pay(world(), 'kit1', { method: 'cash', tendered: 5000, idempotencyKey: 'key-perm-0001' })), 'permission-denied');
  assert.equal(await code(pay(world(), 'other', { method: 'cash', tendered: 5000, idempotencyKey: 'key-perm-0002' })), 'permission-denied');
  assert.equal(await code(pay(world(), undefined, { method: 'cash', tendered: 5000, idempotencyKey: 'key-perm-0003' })), 'unauthenticated');
});

test('an expired or suspended company takes no payments', async () => {
  for (const c of [{ status: 'suspended' }, { status: 'trial', trialEndsAt: '2020-01-01T00:00:00Z' }]) {
    assert.equal(await code(pay(world({ [T]: c }), 'cash1', { method: 'cash', tendered: 5000, idempotencyKey: 'key-exp-00001' })), 'failed-precondition');
  }
});

test('no shift open, or a method switched off for the outlet: refused', async () => {
  assert.equal(await code(pay(world({ [`${T}/pos_shifts/s1`]: { outletId: 'o1', closedAt: '2026-10-30T01:00:00Z' } }), 'cash1', { method: 'cash', tendered: 5000, idempotencyKey: 'key-shift-001' })), 'failed-precondition');
  assert.equal(await code(pay(world(), 'cash1', { method: 'ewallet_manual', amount: 100, idempotencyKey: 'key-meth-0001' })), 'failed-precondition');
});

test('refund: a cashier needs a manager PIN; the refund is recorded, audited, and the payment marked refunded', async () => {
  const db = world();
  await pay(db, 'cash1', { method: 'cash', tendered: 5000, idempotencyKey: 'key-refund-01' });
  const v = (pin) => core.voidOrRefund(db, { uid: 'cash1', data: { tenantId: 't1', orderId: 'c1', reason: 'Wrong order', pin }, sha256, clock: () => 0 });
  assert.equal(await code(v('')), 'permission-denied');
  assert.equal(await code(v('1111')), 'permission-denied');
  const r = await v('2468');
  assert.deepEqual(r.refunds, ['key-refund-01']);
  assert.equal(db.docs.get(`${T}/pos_payments/key-refund-01`).status, 'refunded');
  assert.equal(db.docs.get(`${T}/pos_refunds/key-refund-01`).approvedBy, 'e2');
  assert.equal(db.docs.get(`${T}/pos_orders/c1`).status, 'void');
  assert.ok(db.docs.get(`${T}/pos_audit/c1-void`));
});

test('shift close: expected cash and variance worked out on the server', async () => {
  const db = world();
  await pay(db, 'cash1', { method: 'cash', tendered: 5000, idempotencyKey: 'key-close-001' });
  await core.shift(db, { uid: 'cash1', data: { tenantId: 't1', outletId: 'o1', op: 'out', amount: 500, reason: 'Ice' } });
  const r = await core.shift(db, { uid: 'cash1', data: { tenantId: 't1', outletId: 'o1', op: 'close', countedCash: 22900 } });
  assert.equal(r.expectedCash, 20000 + 3930 - 500); assert.equal(r.variance, 22900 - 23430);
  assert.ok(db.docs.get(`${T}/pos_audit/s1-variance`));
  assert.equal(await code(core.shift(db, { uid: 'kit1', data: { tenantId: 't1', outletId: 'o1', op: 'open', openingCash: 0 } })), 'permission-denied');
});
