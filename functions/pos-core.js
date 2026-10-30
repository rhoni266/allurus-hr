// The point of sale's server side: everything that touches money, run inside Firestore transactions with the Admin
// SDK (which the rules don't apply to). Kept apart from index.js so tests can run it against a small in-memory
// database (functions/test/pos-core.test.js). The arithmetic is js/pos-rules.js, copied here at deploy.
//
// Layout: tenants/{t}/pos_outlets, pos_menu, pos_tables, pos_orders (id = clientOrderId), pos_payments
// (id = idempotencyKey, so a retried call never takes a payment twice), pos_refunds, pos_shifts, pos_counters
// (receipt numbers per outlet) and pos_audit. users/{uid} says who the caller is (tenantId, empId, roles, perms,
// posRole, posPin). Card data is never accepted: see docs/pci-scope.md.
'use strict';
const P = require('./pos-rules.js');

class PosError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, msg) => { throw new PosError(code, msg); };

// Who is calling, and may they do this? Mirrors posRole() in firestore.rules.
async function caller(db, tx, uid, tenantId) {
  if (!uid) fail('unauthenticated', 'Sign in first');
  const u = await tx.get(db.doc(`users/${uid}`));
  if (!u.exists) fail('permission-denied', 'No profile');
  const me = u.data();
  if (me.tenantId !== tenantId || me.disabled) fail('permission-denied', 'Not a member of this company');
  const admin = (me.roles || []).includes('admin');
  const posRole = me.posRole || (admin && (!Array.isArray(me.perms) || me.perms.includes('pos')) ? 'manager' : '');
  const co = await tx.get(db.doc(`tenants/${tenantId}`));
  const status = effectiveStatus(co.exists ? co.data() : {});
  if (!P.canTrade(status)) fail('failed-precondition', 'The subscription has ended; no new orders or payments');
  return { uid, empId: me.empId, posRole, me };
}
// Same as js/billing-rules.js effective() for what matters here.
function effectiveStatus(c, now = Date.now()) {
  const s = c.status || 'active', ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v ? Date.parse(v) : null);
  if (['suspended', 'cancelled', 'expired'].includes(s)) return s;
  if (s === 'trial') return ms(c.trialEndsAt) != null && ms(c.trialEndsAt) < now ? 'expired' : 'trial';
  if (ms(c.paidUntil) != null && ms(c.paidUntil) + 7 * 864e5 < now) return 'expired';
  return s;
}
const must = (who, action) => { if (!P.canDo(who.posRole, action)) fail('permission-denied', `Your POS role can't ${action}`); };
// A manager approves: the caller if they are one, or a manager whose PIN is given (hash checked here, never sent back).
async function managerApproval(db, tx, who, tenantId, pin, sha256) {
  if (P.canDo(who.posRole, 'approve')) return who.empId;
  if (!pin) fail('permission-denied', 'A manager must approve');
  const q = await tx.get(db.collection('users').where('tenantId', '==', tenantId).where('posRole', '==', 'manager'));
  const hit = q.docs.find((d) => d.data().posPin && d.data().posPin === sha256(`pos-pin:${d.data().empId}:${pin}`));
  if (!hit) fail('permission-denied', 'That PIN is not a manager’s');
  return hit.data().empId;
}
const col = (t, name) => `tenants/${t}/${name}`;
const nowIso = (clock) => new Date(clock()).toISOString();
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// recordPayment: cash and the recorded methods (card on a separate terminal, QR or e-wallet confirmed by the
// cashier). Card tap and dynamic DuitNow QR are refused here: only their provider's verified callback approves them.
async function recordPayment(db, { uid, data, clock = Date.now }) {
  const t = str(data.tenantId, 64), orderId = str(data.orderId, 64), key = str(data.idempotencyKey, 64), method = str(data.method, 20);
  if (!t || !orderId || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) fail('invalid-argument', 'Missing order or idempotency key');
  if (!P.METHODS[method]) fail('invalid-argument', 'Unknown method');
  if (P.METHODS[method].server) fail('failed-precondition', `${P.METHODS[method].label} is approved only by the payment provider`);
  // Before anything is trimmed: no field may carry a card number.
  if (Object.values(data).some((v) => typeof v === 'string' && P.looksLikePan(v))) fail('invalid-argument', 'That looks like a card number. Enter only the approval code and the last 4 digits.');
  return db.runTransaction(async (tx) => {
    const who = await caller(db, tx, uid, t);
    must(who, 'pay');
    const payRef = db.doc(`${col(t, 'pos_payments')}/${key}`);
    const prior = await tx.get(payRef);
    if (prior.exists) {
      // The same call again (a retry after a dropped connection): same answer, nothing new.
      if (prior.data().orderId !== orderId) fail('already-exists', 'That idempotency key belongs to another order');
      return { payment: prior.data(), duplicate: true };
    }
    const oRef = db.doc(`${col(t, 'pos_orders')}/${orderId}`), oSnap = await tx.get(oRef);
    if (!oSnap.exists) fail('not-found', 'No such order');
    const o = oSnap.data();
    if (!['open', 'sent'].includes(o.status)) fail('failed-precondition', `The order is ${o.status}`);
    const outSnap = await tx.get(db.doc(`${col(t, 'pos_outlets')}/${o.outletId}`));
    if (!outSnap.exists) fail('failed-precondition', 'No outlet');
    const outlet = outSnap.data();
    if (!(outlet.methods || []).includes(method)) fail('failed-precondition', 'That method is not switched on for this outlet');
    // The server works the total out again from the lines; it never trusts the total sent by the till.
    const tot = P.totals(o, outlet);
    const shifts = await tx.get(db.collection(col(t, 'pos_shifts')).where('outletId', '==', o.outletId).where('closedAt', '==', null));
    if (shifts.empty) fail('failed-precondition', 'Open a shift before taking payments');
    const shiftId = shifts.docs[0].id;
    const prev = await tx.get(db.collection(col(t, 'pos_payments')).where('orderId', '==', orderId));
    const pays = prev.docs.map((d) => d.data());
    const paidSoFar = pays.filter((p) => p.status === 'approved').reduce((s, p) => s + p.amount, 0);
    const left = Math.max(0, tot.total - paidSoFar);
    if (!left) fail('failed-precondition', 'Already paid');
    // Every read before the first write (a Firestore transaction rule): the receipt counter too.
    const cRef = db.doc(`${col(t, 'pos_counters')}/${o.outletId}`), cSnap = await tx.get(cRef);
    const tip = Number.isInteger(data.tip) && data.tip > 0 && outlet.tips ? data.tip : 0;
    let rec;
    if (method === 'cash') {
      const tendered = data.tendered;
      if (!Number.isInteger(tendered) || tendered <= 0) fail('invalid-argument', 'Cash received must be whole sen');
      const c = P.cashApply(left, tendered);
      rec = { ...P.recordedProvider('cash').createPayment(o, c.amount, 'cash', { idempotencyKey: key }), tendered, change: c.change };
    } else {
      const amount = data.amount;
      if (!Number.isInteger(amount) || amount <= 0) fail('invalid-argument', 'Amount must be whole sen');
      try {
        rec = P.recordedProvider(method).createPayment(o, Math.min(amount, left), method, method === 'card_external'
          ? { idempotencyKey: key, approvalCode: str(data.approvalCode, 12), cardLast4: str(data.cardLast4, 4), cardBrand: str(data.cardBrand, 20) }
          : { idempotencyKey: key, reference: str(data.reference, 40) });
      } catch (e) { fail('invalid-argument', e.message); }
      if (method === 'card_external' && (!rec.approvalCode || !rec.cardLast4)) fail('invalid-argument', 'Approval code and last 4 digits are needed');
    }
    const at = nowIso(clock);
    const payment = { ...rec, orderId, outletId: o.outletId, shiftId, createdAt: at, createdBy: who.empId, createdByUid: uid, ...(tip ? { tip } : {}) };
    tx.set(payRef, payment);
    const s = P.settle(tot.total, [...pays, payment]);
    const orderPatch = { subtotal: tot.subtotal, discount: tot.discount, serviceCharge: tot.serviceCharge, tax: tot.tax, taxLines: tot.taxLines, total: tot.total };
    let receiptNo = '';
    if (s.fullyPaid) {
      const seq = { [outlet.code]: cSnap.exists ? cSnap.data().n || 0 : 0 };
      receiptNo = P.nextReceiptNo(seq, outlet.code);
      tx.set(cRef, { n: seq[outlet.code] });
      Object.assign(orderPatch, { status: 'paid', paidAt: at, rounding: s.rounding, receiptNo });
      if (o.tableId) tx.update(db.doc(`${col(t, 'pos_tables')}/${o.tableId}`), { status: 'free', currentOrderId: '' });
    }
    tx.update(oRef, orderPatch);
    return { payment, settle: s, receiptNo, duplicate: false };
  });
}

// Void an unpaid order, or refund a paid one (recorded methods only; card tap and QR refund through the provider).
async function voidOrRefund(db, { uid, data, clock = Date.now, sha256 }) {
  const t = str(data.tenantId, 64), orderId = str(data.orderId, 64), reason = str(data.reason, 80);
  if (!t || !orderId || !reason) fail('invalid-argument', 'A reason is needed');
  return db.runTransaction(async (tx) => {
    const who = await caller(db, tx, uid, t);
    const by = await managerApproval(db, tx, who, t, str(data.pin, 12), sha256);
    const oRef = db.doc(`${col(t, 'pos_orders')}/${orderId}`), oSnap = await tx.get(oRef);
    if (!oSnap.exists) fail('not-found', 'No such order');
    const o = oSnap.data();
    if (o.status === 'void') return { already: true };
    const prev = await tx.get(db.collection(col(t, 'pos_payments')).where('orderId', '==', orderId));
    const at = nowIso(clock), refunds = [];
    for (const d of prev.docs.filter((x) => x.data().status === 'approved')) {
      const p = d.data();
      if (!P.canTransition(p, 'refunded', 'client')) fail('failed-precondition', `${P.METHODS[p.method].label} is refunded through the provider`);
      tx.update(d.ref, { status: 'refunded', refundedAt: at });
      const rRef = db.doc(`${col(t, 'pos_refunds')}/${d.id}`);
      tx.set(rRef, { orderId, paymentId: d.id, shiftId: p.shiftId, method: p.method, amount: p.amount, reason, approvedBy: by, status: 'approved', at });
      refunds.push(d.id);
    }
    tx.update(oRef, { status: 'void', voidedAt: at, voidedBy: by, voidReason: reason, refunded: refunds.length > 0 });
    if (o.tableId) tx.update(db.doc(`${col(t, 'pos_tables')}/${o.tableId}`), { status: 'free', currentOrderId: '' });
    tx.set(db.doc(`${col(t, 'pos_audit')}/${orderId}-void`), { at, by, action: refunds.length ? 'refund' : 'void', ref: o.receiptNo || orderId, detail: reason });
    return { refunds };
  });
}

// Shifts: open with a float, cash in and out, close with the counted cash. The expected figure and the variance are
// worked out here from the payments, so a till can't change them.
async function shift(db, { uid, data, clock = Date.now }) {
  const t = str(data.tenantId, 64), op = str(data.op, 10), outletId = str(data.outletId, 64);
  return db.runTransaction(async (tx) => {
    const who = await caller(db, tx, uid, t);
    must(who, 'shift');
    const open = await tx.get(db.collection(col(t, 'pos_shifts')).where('outletId', '==', outletId).where('closedAt', '==', null));
    const at = nowIso(clock);
    if (op === 'open') {
      if (!open.empty) fail('failed-precondition', 'A shift is already open');
      if (!Number.isInteger(data.openingCash) || data.openingCash < 0) fail('invalid-argument', 'Opening cash in whole sen');
      const ref = db.collection(col(t, 'pos_shifts')).doc();
      tx.set(ref, { outletId, cashierUid: who.empId, openedAt: at, openingCash: data.openingCash, cashMoves: [], closedAt: null });
      return { id: ref.id };
    }
    if (open.empty) fail('failed-precondition', 'No shift is open');
    const sh = { id: open.docs[0].id, ...open.docs[0].data() };
    if (op === 'in' || op === 'out') {
      const reason = str(data.reason, 60);
      if (!Number.isInteger(data.amount) || data.amount <= 0 || !reason) fail('invalid-argument', 'Amount and reason');
      tx.update(open.docs[0].ref, { cashMoves: [...(sh.cashMoves || []), { kind: op, amount: data.amount, reason, at, by: who.empId }] });
      return { ok: true };
    }
    if (op !== 'close') fail('invalid-argument', 'Unknown operation');
    if (!Number.isInteger(data.countedCash) || data.countedCash < 0) fail('invalid-argument', 'Counted cash in whole sen');
    const pays = (await tx.get(db.collection(col(t, 'pos_payments')).where('shiftId', '==', sh.id))).docs.map((d) => d.data());
    const refs = (await tx.get(db.collection(col(t, 'pos_refunds')).where('shiftId', '==', sh.id))).docs.map((d) => d.data());
    const sum = P.shiftSummary({ ...sh, countedCash: data.countedCash }, pays, refs);
    tx.update(open.docs[0].ref, { closedAt: at, closedBy: who.empId, countedCash: data.countedCash, expectedCash: sum.expectedCash, variance: sum.variance });
    if (sum.variance) tx.set(db.doc(`${col(t, 'pos_audit')}/${sh.id}-variance`), { at, by: who.empId, action: 'shift-variance', ref: sh.id, detail: `Expected ${P.fmt(sum.expectedCash)}, counted ${P.fmt(data.countedCash)}` });
    return { expectedCash: sum.expectedCash, variance: sum.variance };
  });
}

module.exports = { recordPayment, voidOrRefund, shift, effectiveStatus, PosError };
