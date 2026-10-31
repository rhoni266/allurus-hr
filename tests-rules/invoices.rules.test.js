// Firestore rules tests for invoices: drafts editable, locked once sent, audited status changes, part payments,
// void with a reason, numbers held once, and stale saves refused. Against the emulator:
//   npm run test:rules        (needs Java 11+). Fake companies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, serverTimestamp, Timestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const fin = () => as('fin');        // Company Admin with the finance area
const hr = () => as('hr');          // Company Admin without it
const staff = () => as('staff');    // employee
const inv = (db, id) => doc(db, `tenants/${T}/invoices/${id}`);
const audit = (db, id) => doc(db, `tenants/${T}/invoiceAudit/${id}`);
const noDoc = (db, no) => doc(db, `tenants/${T}/invoiceNos/${no}`);
const lines = [{ desc: 'Rice 5kg bag', qty: 12.5, unit: 'kg', price: 4.2, classification: '022' }];
const draft = (uid, o = {}) => ({ type: 'invoice', no: 'INV-202610-0001', status: 'Draft', customer: 'Kedai Ali', issue: '2026-10-01', due: '2026-10-31',
  items: lines, taxRate: 8, v: 1, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp(), ...o });
let seq = 0;

// A new draft and its number, in one batch (as the app does).
function create(db, uid, id, o = {}, auditAction) {
  const b = writeBatch(db), d = draft(uid, o);
  if (auditAction) { const a = `a${++seq}`; d.lastAuditId = a; b.set(audit(db, a), { action: auditAction, invoiceId: id, actorUid: uid, at: serverTimestamp() }); }
  b.set(inv(db, id), d); b.set(noDoc(db, d.no), { invoiceId: id });
  return b.commit();
}
// An update with the next version, stamped, optionally with an audit entry in the same batch.
function change(db, uid, id, v, patch, auditAction, auditFor = id, auditBy = uid) {
  const b = writeBatch(db), p = { v: v + 1, updatedBy: uid, updatedAt: serverTimestamp(), ...patch };
  if (auditAction) { const a = `a${++seq}`; p.lastAuditId = a; b.set(audit(db, a), { action: auditAction, invoiceId: auditFor, actorUid: auditBy, at: serverTimestamp() }); }
  b.update(inv(db, id), p);
  return b.commit();
}
const send = (db, uid, id, v) => change(db, uid, id, v, { status: 'Sent', sentAt: serverTimestamp(), sentBy: uid }, 'send');

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-invoices', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'tenants/gone'), { owner: 'own2', name: 'Gone', status: 'expired' });
    await setDoc(doc(db, 'users/fin'), { tenantId: T, roles: ['admin', 'employee'], perms: ['finance', 'claims'], empId: 'e1' });
    await setDoc(doc(db, 'users/fin2'), { tenantId: T, roles: ['admin', 'employee'], perms: ['finance'], empId: 'e3' });
    await setDoc(doc(db, 'users/hr'), { tenantId: T, roles: ['admin', 'employee'], perms: ['people', 'time'], empId: 'e2' });
    await setDoc(doc(db, 'users/staff'), { tenantId: T, roles: ['employee'], empId: 'e4' });
    await setDoc(doc(db, 'users/goneFin'), { tenantId: 'gone', roles: ['admin', 'employee'], empId: 'e1' });
  });
});
test.after(async () => { await env.cleanup(); });

test('finance admins create a draft with its number; staff and admins without finance cannot read or write', async () => {
  await assertSucceeds(create(fin(), 'fin', 'i1'));
  await assertSucceeds(getDoc(inv(fin(), 'i1')));
  await assertFails(getDoc(inv(staff(), 'i1')));
  await assertFails(getDoc(inv(hr(), 'i1')));
  await assertFails(create(staff(), 'staff', 'i2', { no: 'INV-202610-0002' }));
  await assertFails(create(hr(), 'hr', 'i3', { no: 'INV-202610-0003' }));
});

test('a number is held once: a second invoice with the same number is refused', async () => {
  await assertSucceeds(create(fin(), 'fin', 'i1'));
  await assertFails(create(fin(), 'fin', 'i2'));
  await assertSucceeds(create(fin(), 'fin', 'i2', { no: 'INV-202610-0002' }));
});

test('a new invoice must start as a Draft at version 1', async () => {
  await assertFails(create(fin(), 'fin', 'i1', { status: 'Sent' }));
  await assertFails(create(fin(), 'fin', 'i2', { no: 'INV-202610-0002', v: 3 }));
});

test('a draft can be saved many times, each save one version on', async () => {
  const db = fin();
  await create(db, 'fin', 'i1');
  await assertSucceeds(change(db, 'fin', 'i1', 1, { customer: 'Kedai Abu' }));
  await assertSucceeds(change(db, 'fin', 'i1', 2, { items: [...lines, { desc: 'Cups', qty: 3, unit: 'pcs', price: 1 }] }));
  await assertSucceeds(change(db, 'fin', 'i1', 3, { taxRate: 0, notes: 'Thanks' }));
  assert.equal((await getDoc(inv(db, 'i1'))).data().status, 'Draft', 'saving never sends');
});

test('two people saving the same draft: the out-of-date save is refused', async () => {
  await create(fin(), 'fin', 'i1');
  await assertSucceeds(change(as('fin2'), 'fin2', 'i1', 1, { customer: 'From fin2' }));   // v1 → v2
  await assertFails(change(fin(), 'fin', 'i1', 1, { customer: 'From fin, stale' }));      // still thinks v1
});

test('a draft save cannot change its number, type or creator, or sneak in a status or payment', async () => {
  const db = fin();
  await create(db, 'fin', 'i1');
  await assertFails(change(db, 'fin', 'i1', 1, { no: 'INV-202610-0099' }));
  await assertFails(change(db, 'fin', 'i1', 1, { type: 'credit' }));
  await assertFails(change(db, 'fin', 'i1', 1, { createdBy: 'someone' }));
  await assertFails(change(db, 'fin', 'i1', 1, { payments: [{ amount: 1 }] }));
  await assertFails(change(db, 'fin', 'i1', 1, { status: 'Paid' }));
});

test('mark as sent: only with an audit entry, and only status, sentAt and sentBy change', async () => {
  const db = fin();
  await create(db, 'fin', 'i1');
  await assertFails(change(db, 'fin', 'i1', 1, { status: 'Sent', sentAt: serverTimestamp(), sentBy: 'fin' }));                  // no audit
  await assertFails(change(db, 'fin', 'i1', 1, { status: 'Sent', sentAt: serverTimestamp(), sentBy: 'fin', customer: 'X' }, 'send')); // edits too
  await assertFails(change(db, 'fin', 'i1', 1, { status: 'Sent', sentAt: serverTimestamp(), sentBy: 'fin' }, 'void'));         // wrong action
  await assertFails(change(db, 'fin', 'i1', 1, { status: 'Sent', sentAt: serverTimestamp(), sentBy: 'fin' }, 'send', 'other')); // audit about another invoice
  await assertSucceeds(send(db, 'fin', 'i1', 1));
});

test('a sent invoice is locked: lines, customer, prices, number and dates are refused', async () => {
  const db = fin();
  await create(db, 'fin', 'i1'); await send(db, 'fin', 'i1', 1);
  for (const patch of [{ items: [{ desc: 'Changed', qty: 1, unit: 'pcs', price: 1 }] }, { customer: 'Other' }, { taxRate: 0 }, { due: '2027-01-01' }, { no: 'INV-1' }, { status: 'Draft' }])
    await assertFails(change(db, 'fin', 'i1', 2, patch), JSON.stringify(patch));
  await assertFails(deleteDoc(inv(db, 'i1')));
});

test('payments after sending: part paid then paid, each status change audited', async () => {
  const db = fin();
  await create(db, 'fin', 'i1'); await send(db, 'fin', 'i1', 1);
  await assertFails(change(db, 'fin', 'i1', 2, { status: 'Partially paid', payments: [{ date: '2026-10-05', amount: 20, by: 'fin' }] }));          // not audited
  await assertSucceeds(change(db, 'fin', 'i1', 2, { status: 'Partially paid', payments: [{ date: '2026-10-05', amount: 20, by: 'fin' }] }, 'pay'));
  await assertSucceeds(change(db, 'fin', 'i1', 3, { status: 'Paid', paidOn: '2026-10-06', payments: [{ date: '2026-10-05', amount: 20, by: 'fin' }, { date: '2026-10-06', amount: 36.7, by: 'fin' }] }, 'pay'));
  await assertSucceeds(change(db, 'fin', 'i1', 4, { einvoice: { status: 'Valid' } }));
});

test('void: needs a reason and an audit entry; a voided invoice is final and keeps its number', async () => {
  const db = fin();
  await create(db, 'fin', 'i1');
  await assertFails(change(db, 'fin', 'i1', 1, { status: 'Void', voidReason: 'Wrong customer', voidedAt: serverTimestamp(), voidedBy: 'fin' }, 'void')); // a draft is deleted, not voided
  await send(db, 'fin', 'i1', 1);
  await assertFails(change(db, 'fin', 'i1', 2, { status: 'Void', voidReason: '', voidedAt: serverTimestamp(), voidedBy: 'fin' }, 'void'));
  await assertFails(change(db, 'fin', 'i1', 2, { status: 'Void', voidReason: 'Wrong customer', voidedAt: serverTimestamp(), voidedBy: 'fin' }));
  await assertSucceeds(change(db, 'fin', 'i1', 2, { status: 'Void', voidReason: 'Wrong customer', voidedAt: serverTimestamp(), voidedBy: 'fin' }, 'void'));
  await assertFails(change(db, 'fin', 'i1', 3, { status: 'Sent' }, 'send'));
  await assertFails(change(db, 'fin', 'i1', 3, { customer: 'X' }));
  await assertFails(deleteDoc(inv(db, 'i1')));
  await assertFails(deleteDoc(noDoc(db, 'INV-202610-0001')));
});

test('an invoice with payments cannot be voided (refund or credit note it instead)', async () => {
  const db = fin();
  await create(db, 'fin', 'i1'); await send(db, 'fin', 'i1', 1);
  await change(db, 'fin', 'i1', 2, { status: 'Partially paid', payments: [{ date: '2026-10-05', amount: 20, by: 'fin' }] }, 'pay');
  await assertFails(change(db, 'fin', 'i1', 3, { status: 'Void', voidReason: 'Wrong customer', voidedAt: serverTimestamp(), voidedBy: 'fin' }, 'void'));
});

test('only a draft can be deleted; deleting it in the same batch frees its number', async () => {
  const db = fin();
  await create(db, 'fin', 'i1');
  await assertFails(deleteDoc(noDoc(db, 'INV-202610-0001')));         // still held by the draft
  const b = writeBatch(db); b.delete(inv(db, 'i1')); b.delete(noDoc(db, 'INV-202610-0001'));
  await assertSucceeds(b.commit());
  await assertSucceeds(create(db, 'fin', 'i2'));                       // the number can be used again
});

test('a duplicate is a new audited Draft; the original is untouched', async () => {
  const db = fin();
  await create(db, 'fin', 'i1'); await send(db, 'fin', 'i1', 1);
  await assertFails(create(db, 'fin', 'i2', { no: 'INV-202610-0002', duplicatedFrom: { id: 'i1', no: 'INV-202610-0001' } }));
  await assertSucceeds(create(db, 'fin', 'i2', { no: 'INV-202610-0002', duplicatedFrom: { id: 'i1', no: 'INV-202610-0001' } }, 'duplicate'));
  const o = (await getDoc(inv(db, 'i1'))).data();
  assert.equal(o.status, 'Sent'); assert.equal(o.v, 2);
});

test('a delivery invoice may be created already sent (or paid by cash), but only audited and in your own name', async () => {
  const db = fin();
  await assertFails(create(db, 'fin', 'd1', { no: 'INV-2610-0001', status: 'Sent', sentAt: serverTimestamp(), sentBy: 'fin' }));
  await assertFails(create(db, 'fin', 'd1', { no: 'INV-2610-0001', status: 'Paid', sentAt: serverTimestamp(), sentBy: 'fin2' }, 'send'));
  await assertSucceeds(create(db, 'fin', 'd1', { no: 'INV-2610-0001', status: 'Paid', paidOn: '2026-10-31', payments: [{ date: '2026-10-31', amount: 52.5, by: 'fin' }], sentAt: serverTimestamp(), sentBy: 'fin' }, 'send'));
  await assertFails(change(db, 'fin', 'd1', 1, { customer: 'X' }));
});

test('credit, debit and refund notes are issued final with an audit entry', async () => {
  const db = fin();
  await assertFails(create(db, 'fin', 'n1', { type: 'credit', status: 'Issued', no: 'CN-202610-0001' }));
  await assertSucceeds(create(db, 'fin', 'n1', { type: 'credit', status: 'Issued', no: 'CN-202610-0001' }, 'issue'));
  await assertFails(change(db, 'fin', 'n1', 1, { items: lines.map((l) => ({ ...l, price: 99 })) }));
  await assertSucceeds(change(db, 'fin', 'n1', 1, { einvoice: { status: 'Valid' } }));
});

test('audit entries are added only: never changed or removed, and only in your own name', async () => {
  const db = fin();
  await create(db, 'fin', 'i1'); await send(db, 'fin', 'i1', 1);
  await assertFails(setDoc(audit(db, 'x1'), { action: 'send', invoiceId: 'i1', actorUid: 'fin2', at: serverTimestamp() }));
  const id = `a${seq}`;
  await assertFails(updateDoc(audit(db, id), { action: 'void' }));
  await assertFails(deleteDoc(audit(db, id)));
  await assertFails(getDoc(audit(staff(), id)));
});

test('an expired company: nothing is written', async () => {
  const db = as('goneFin'), b = writeBatch(db), d = draft('goneFin');
  b.set(doc(db, 'tenants/gone/invoices/i1'), d); b.set(doc(db, `tenants/gone/invoiceNos/${d.no}`), { invoiceId: 'i1' });
  await assertFails(b.commit());
});
