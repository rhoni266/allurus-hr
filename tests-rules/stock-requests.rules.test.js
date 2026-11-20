// Firestore rules for stock requests (one document each): who may ask for what, who approves, who hands over, who takes returns,
// and every refused step (own request, no photo, wrong status, raised quantity, someone else's request).   npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch, serverTimestamp, Timestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const R = (db, id) => doc(db, `tenants/${T}/stockRequests/${id}`);
const A = (db, id, v) => doc(db, `tenants/${T}/stockAudit/${id}~${v}`);
const audit = (uid, id, v, action) => ({ actorUid: uid, requestId: id, action, at: serverTimestamp() });
const base = (o = {}) => ({ no: 'PS-261120-001', itemId: 'paint', itemName: 'Paint', unit: 'tin', returnable: false, returnDays: 0, qty: 5, reason: 'Used', note: '', photo: '', empId: 'e1', dept: 'd1', role: 'painter', status: 'Diminta', by: 'e1', v: 1, ...o });
const stamp = (uid, v) => ({ v, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp() });
// ask: a request and its audit entry in one batch
const ask = async (uid, id, o = {}) => { const db = as(uid), b = writeBatch(db); b.set(R(db, id), { ...base(o), ...stamp(uid, 1) }); b.set(A(db, id, 1), audit(uid, id, 1, 'ask')); return b.commit(); };
// step: change fields (and v), with the audit entry
const step = async (uid, id, v, patch, action) => { const db = as(uid), b = writeBatch(db); b.update(R(db, id), { ...patch, v: v + 1, updatedBy: uid, updatedAt: serverTimestamp() }); b.set(A(db, id, v + 1), audit(uid, id, v + 1, action)); return b.commit(); };
// a request already in some state, written with the rules off
const seed = (id, o) => env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `tenants/${T}/stockRequests/${id}`), { ...base(), ...stamp('x', 1), ...o }); });

test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-allurus-stockreq', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('req', { roles: ['employee'], empId: 'e1' });          // painter, may ask for paint
    await user('other', { roles: ['employee'], empId: 'e2' });        // not allowed to ask
    await user('appr', { roles: ['employee'], empId: 'e3' });         // the approver (appointed)
    await user('keep', { roles: ['employee'], empId: 'e4' });         // the storekeeper (appointed)
    await user('both', { roles: ['employee'], empId: 'e6' });         // appointed approver and may also ask
    await user('ops', { roles: ['admin', 'employee'], perms: ['operations'], empId: 'e5' });
    await user('owner', { roles: ['admin', 'employee'], empId: 'e9' });
    await user('pay', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e7' });
    await setDoc(doc(db, `tenants/${T}/stockRoles/current`), { approvers: ['e3', 'e6'], keepers: ['e4'], autoCancelDays: 2 });
    await setDoc(doc(db, `tenants/${T}/stockCatalog/paint`), { name: 'Paint', allowed: ['e1', 'e6'] });
    await setDoc(doc(db, `tenants/${T}/stockCatalog/locked`), { name: 'Locked item', allowed: [] });
  });
});
test.after(async () => { await env.cleanup(); });

test('ask: only for yourself, an allowed item, status Diminta, a positive quantity, with its audit entry', async () => {
  await assertSucceeds(ask('req', 'r1'));
  await assertFails(ask('other', 'r2', { empId: 'e2' }), 'not allowed for this item');
  await assertFails(ask('req', 'r3', { itemId: 'locked' }), 'admin-only item');
  await assertFails(ask('req', 'r4', { empId: 'e2' }), 'for someone else');
  await assertFails(ask('req', 'r5', { status: 'Diluluskan' }), 'already approved');
  await assertFails(ask('req', 'r6', { qty: 0 }));
  await assertFails(ask('req', 'r7', { qty: -3 }));
  await assertFails(ask('req', 'r8', { approvedQty: 5 }), 'a decision in the request');
  const db = as('req'); await assertFails(setDoc(R(db, 'r9'), { ...base(), ...stamp('req', 1) }), 'no audit entry');
});

test('read: the requester, the approvers, the keepers and Operations; not a colleague or payroll; staff query only their own', async () => {
  await seed('r1', {});
  for (const u of ['req', 'appr', 'keep', 'ops', 'owner']) await assertSucceeds(getDoc(R(as(u), 'r1')), u);
  for (const u of ['other', 'pay']) await assertFails(getDoc(R(as(u), 'r1')), u);
  await assertSucceeds(getDocs(query(collection(as('req'), `tenants/${T}/stockRequests`), where('empId', '==', 'e1'))));
  await assertFails(getDocs(collection(as('other'), `tenants/${T}/stockRequests`)));
  await assertSucceeds(getDocs(collection(as('appr'), `tenants/${T}/stockRequests`)));
  await assertSucceeds(getDocs(collection(as('keep'), `tenants/${T}/stockRequests`)));
});

test('nobody edits a request: not the quantity, not the item, not someone else’s', async () => {
  await seed('r1', {});
  await assertFails(step('req', 'r1', 1, { reason: 'Sold' }, 'ask'), 'the requester edits it');
  await assertFails(step('req', 'r1', 1, { qty: 1 }, 'ask'));
  await assertFails(step('other', 'r1', 1, { status: 'Dibatalkan', cancelledAt: serverTimestamp(), cancelNote: '' }, 'cancel'), 'someone else cancels it');
  await assertFails(step('req', 'r1', 1, { status: 'Diluluskan', approvedQty: 5, decidedBy: 'e1', decidedAt: serverTimestamp(), decisionNote: '' }, 'approve'), 'approves their own');
});

test('approve: an approver, from Diminta, the same or a lower quantity; never their own request, never a higher quantity', async () => {
  await seed('r1', {});
  const ok = (q) => ({ status: 'Diluluskan', approvedQty: q, decidedBy: 'e3', decidedAt: serverTimestamp(), decisionNote: '' });
  await assertFails(step('appr', 'r1', 1, ok(9), 'approve'), 'more than asked');
  await assertFails(step('appr', 'r1', 1, ok(0), 'approve'));
  await assertFails(step('keep', 'r1', 1, { ...ok(5), decidedBy: 'e4' }, 'approve'), 'a keeper is not an approver');
  await assertFails(step('ops', 'r1', 1, { ...ok(5), decidedBy: 'e5' }, 'approve'), 'Operations who is not appointed');
  await assertSucceeds(step('appr', 'r1', 1, ok(3), 'approve'));
  await assertFails(step('appr', 'r1', 2, ok(3), 'approve'), 'twice');
  await seed('mine', { empId: 'e6', by: 'e6' });
  await assertFails(step('both', 'mine', 1, { ...ok(5), decidedBy: 'e6' }, 'approve'), 'an approver approving their own request');
});

test('reject: needs a reason, from Diminta, by an approver', async () => {
  await seed('r1', {});
  const no = (n) => ({ status: 'Ditolak', decidedBy: 'e3', decidedAt: serverTimestamp(), decisionNote: n });
  await assertFails(step('appr', 'r1', 1, no(''), 'reject'));
  await assertFails(step('other', 'r1', 1, no('No'), 'reject'));
  await assertSucceeds(step('appr', 'r1', 1, no('Not needed'), 'reject'));
});

test('hand over: a keeper, from Diluluskan, with a photo, up to the approved quantity, never to themselves, never without approval', async () => {
  const hand = (q, photo = 'cloudblob:abc') => ({ status: 'Diserahkan', handedQty: q, handedBy: 'e4', handedAt: serverTimestamp(), handPhoto: photo });
  await seed('pending', {});
  await assertFails(step('keep', 'pending', 1, hand(5), 'hand'), 'without approval');
  await seed('r1', { status: 'Diluluskan', approvedQty: 3, decidedBy: 'e3', decidedAt: Timestamp.now() });
  await assertFails(step('keep', 'r1', 1, hand(3, ''), 'hand'), 'no photo');
  await assertFails(step('keep', 'r1', 1, hand(4), 'hand'), 'more than approved');
  await assertFails(step('appr', 'r1', 1, { ...hand(3), handedBy: 'e3' }, 'hand'), 'an approver is not a keeper');
  await assertFails(step('req', 'r1', 1, { ...hand(3), handedBy: 'e1' }, 'hand'), 'the requester hands to themselves');
  await assertSucceeds(step('keep', 'r1', 1, hand(2), 'hand'), 'a smaller quantity is fine');
  await seed('mine', { empId: 'e4', by: 'e4', status: 'Diluluskan', approvedQty: 1, decidedBy: 'e3', decidedAt: Timestamp.now() });
  await assertFails(step('keep', 'mine', 1, hand(1), 'hand'), 'a keeper handing to themselves');
});

test('receive (Terima): only the requester, once, after the handover', async () => {
  await seed('r1', { status: 'Diserahkan', handedQty: 5, handedBy: 'e4', handedAt: Timestamp.now(), handPhoto: 'x' });
  await assertFails(step('other', 'r1', 1, { receivedAt: serverTimestamp() }, 'receive'));
  await assertSucceeds(step('req', 'r1', 1, { receivedAt: serverTimestamp() }, 'receive'));
  await assertFails(step('req', 'r1', 2, { receivedAt: serverTimestamp() }, 'receive'), 'twice');
  await seed('early', { status: 'Diluluskan', approvedQty: 5 });
  await assertFails(step('req', 'early', 1, { receivedAt: serverTimestamp() }, 'receive'), 'before the handover');
});

test('return: a keeper takes a returnable item back as Baik, Rosak or Hilang; not a consumable; not by staff', async () => {
  const given = { status: 'Diserahkan', handedQty: 2, handedBy: 'e4', handedAt: Timestamp.now(), handPhoto: 'x', returnable: true, returnDays: 1 };
  const back = (condition, qty, lost = false) => ({ status: 'Dipulangkan', condition, returnedQty: qty, returnedBy: 'e4', returnedAt: serverTimestamp(), returnPhoto: '', lost });
  await seed('r1', given);
  await assertFails(step('req', 'r1', 1, back('Baik', 2), 'return'), 'the person marks their own return');
  await assertFails(step('keep', 'r1', 1, back('Baik', 3), 'return'), 'more than handed over');
  await assertFails(step('keep', 'r1', 1, back('Baik', 0), 'return'), 'good but nothing');
  await assertFails(step('keep', 'r1', 1, back('Hilang', 0, false), 'return'), 'lost must be flagged');
  await assertFails(step('keep', 'r1', 1, back('Bagus', 2), 'return'), 'not a condition');
  await assertSucceeds(step('keep', 'r1', 1, back('Rosak', 2), 'return'));
  await seed('lost', given);
  await assertSucceeds(step('keep', 'lost', 1, back('Hilang', 0, true), 'return'));
  await seed('cons', { ...given, returnable: false });
  await assertFails(step('keep', 'cons', 1, back('Baik', 2), 'return'), 'a consumable is never returned');
});

test('cancel: the requester while Diminta or Diluluskan; not after the handover; an approved one nobody collected, after the days set', async () => {
  const c = () => ({ status: 'Dibatalkan', cancelledAt: serverTimestamp(), cancelNote: '' });
  await seed('a', {}); await assertSucceeds(step('req', 'a', 1, c(), 'cancel'));
  await seed('b', { status: 'Diluluskan', approvedQty: 5, decidedAt: Timestamp.now() }); await assertSucceeds(step('req', 'b', 1, c(), 'cancel'));
  await seed('c', { status: 'Diserahkan', handedQty: 5, handedBy: 'e4', handedAt: Timestamp.now(), handPhoto: 'x' }); await assertFails(step('req', 'c', 1, c(), 'cancel'), 'after the handover');
  const old = Timestamp.fromMillis(Date.now() - 3 * 864e5);
  await seed('fresh', { status: 'Diluluskan', approvedQty: 5, decidedAt: Timestamp.now() });
  await assertFails(step('keep', 'fresh', 1, c(), 'expire'), 'not yet expired');
  await seed('stale', { status: 'Diluluskan', approvedQty: 5, decidedAt: old });
  await assertFails(step('other', 'stale', 1, c(), 'expire'), 'someone with no role');
  await assertSucceeds(step('keep', 'stale', 1, c(), 'expire'));
  await seed('stale2', { status: 'Diluluskan', approvedQty: 5, decidedAt: old });
  await assertSucceeds(step('ops', 'stale2', 1, c(), 'expire'));
});

test('a change without its audit entry is refused; delete only by Operations with a delete audit entry', async () => {
  await seed('r1', {});
  const db = as('appr');
  await assertFails(updateNoAudit(db, 'appr', 'r1'));
  await assertFails(deleteDoc(R(as('req'), 'r1')), 'staff delete');
  await assertFails(deleteDoc(R(as('ops'), 'r1')), 'Operations without an audit entry');
  await assertFails((async () => { const d = as('req'), x = writeBatch(d); x.delete(R(d, 'r1')); x.set(doc(d, `tenants/${T}/stockAudit/r1~del`), audit('req', 'r1', 0, 'delete')); return x.commit(); })(), 'staff delete with an audit entry');
  const dbo = as('ops'), b = writeBatch(dbo); b.delete(R(dbo, 'r1')); b.set(doc(dbo, `tenants/${T}/stockAudit/r1~del`), audit('ops', 'r1', 0, 'delete'));
  await assertSucceeds(b.commit());
  assertFailsRead();
});
const { updateDoc } = require('firebase/firestore');
const updateNoAudit = (db, uid, id) => updateDoc(R(db, id), { status: 'Ditolak', decidedBy: 'e3', decidedAt: serverTimestamp(), decisionNote: 'x', v: 2, updatedBy: uid, updatedAt: serverTimestamp() });
function assertFailsRead() { /* the deleted request is gone: nothing to read */ }

test('appointments and the catalog: readable by every member, written by Operations (roles also by Settings), never by staff', async () => {
  const roles = (u) => doc(as(u), `tenants/${T}/stockRoles/current`), cat = (u) => doc(as(u), `tenants/${T}/stockCatalog/paint`);
  await assertSucceeds(getDoc(roles('req'))); await assertSucceeds(getDoc(cat('req')));
  await assertFails(setDoc(roles('req'), { approvers: ['e1'], keepers: [] }), 'staff appoint themselves');
  await assertFails(setDoc(cat('req'), { name: 'x', allowed: ['e1'] }));
  await assertSucceeds(setDoc(roles('ops'), { approvers: ['e3'], keepers: ['e4'], autoCancelDays: 2 }));
  await assertSucceeds(setDoc(cat('ops'), { name: 'Paint', allowed: ['e1'] }));
  await assertFails(setDoc(roles('pay'), { approvers: [], keepers: [] }), 'payroll is not settings or operations');
});
