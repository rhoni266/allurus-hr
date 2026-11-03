// Firestore rules for claims (one document each): who reads them, nobody approves their own, only an approver or
// the claims/payroll area decides, the claimant only cancels while pending, payroll marks paid.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, updateDoc, serverTimestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const K = (db, id) => doc(db, `tenants/${T}/claims/${id}`);
const lines = [{ id: 'x1', cat: 'medical', amount: 65, approved: null, merchant: 'Klinik' }];
const claim = (uid, empId, o = {}) => ({ empId, title: 'Clinic visit', lines, status: 'Pending', chain: [{ level: 'L1', approver: 'e2', backup: '', status: 'pending' }], approverIds: ['e2'],
  v: 1, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp(), ...o });
const change = (db, uid, id, v, patch) => updateDoc(K(db, id), { ...patch, v: v + 1, updatedBy: uid, updatedAt: serverTimestamp() });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-claims', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('a', { roles: ['employee'], empId: 'e1' });
    await user('head', { roles: ['employee'], empId: 'e2' });
    await user('b', { roles: ['employee'], empId: 'e3' });
    await user('fin', { roles: ['admin', 'employee'], perms: ['claims'], empId: 'e4' });
    await user('pay', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await user('ops', { roles: ['admin', 'employee'], perms: ['operations'], empId: 'e6' });
  });
});
test.after(async () => { await env.cleanup(); });

test('a claimant files their own pending claim; not approved, not for someone else, not as their own approver', async () => {
  await assertSucceeds(setDoc(K(as('a'), 'c1'), claim('a', 'e1')));
  await assertFails(setDoc(K(as('a'), 'c2'), claim('a', 'e1', { status: 'Approved' })));
  await assertFails(setDoc(K(as('a'), 'c3'), claim('a', 'e3')));
  await assertFails(setDoc(K(as('a'), 'c4'), claim('a', 'e1', { approverIds: ['e1'] })));
});

test('employee A’s claim (medical): read by A, the approver, claims and payroll; not by colleague B or other admins', async () => {
  await setDoc(K(as('a'), 'c1'), claim('a', 'e1'));
  for (const u of ['a', 'head', 'fin', 'pay']) await assertSucceeds(getDoc(K(as(u), 'c1')), u);
  for (const u of ['b', 'ops']) await assertFails(getDoc(K(as(u), 'c1')), u);
  await assertFails(getDocs(collection(as('b'), `tenants/${T}/claims`)));
  await assertSucceeds(getDocs(query(collection(as('a'), `tenants/${T}/claims`), where('empId', '==', 'e1'))));
  await assertSucceeds(getDocs(query(collection(as('head'), `tenants/${T}/claims`), where('approverIds', 'array-contains', 'e2'))));
  await assertSucceeds(getDocs(collection(as('fin'), `tenants/${T}/claims`)));
});

test('a claimant cannot approve their own claim or raise the approved amount; they may cancel while pending', async () => {
  await setDoc(K(as('a'), 'c1'), claim('a', 'e1'));
  await assertFails(change(as('a'), 'a', 'c1', 1, { status: 'Approved', approved: 65 }));
  await assertFails(change(as('a'), 'a', 'c1', 1, { lines: [{ ...lines[0], amount: 650 }] }));
  await assertSucceeds(change(as('a'), 'a', 'c1', 1, { status: 'Cancelled' }));
});

test('the approver decides once; a colleague can’t; the approver can’t change who approves', async () => {
  await setDoc(K(as('a'), 'c1'), claim('a', 'e1'));
  await assertFails(change(as('b'), 'b', 'c1', 1, { status: 'Approved' }));
  await assertFails(change(as('head'), 'head', 'c1', 1, { approverIds: ['e2', 'e3'] }));
  await assertSucceeds(change(as('head'), 'head', 'c1', 1, { status: 'Approved', approved: 65, lines: [{ ...lines[0], approved: 65 }], decidedOn: '2026-11-03', decidedBy: 'Head' }));
  await assertFails(change(as('head'), 'head', 'c1', 2, { status: 'Rejected' }));
});

test('claims area corrects others’ claims but doesn’t decide its own; payroll marks approved claims paid, even its own', async () => {
  await setDoc(K(as('a'), 'c1'), claim('a', 'e1'));
  await setDoc(K(as('fin'), 'c2'), claim('fin', 'e4'));
  await assertSucceeds(change(as('fin'), 'fin', 'c1', 1, { edits: [{ field: 'amount', reason: 'Service charge' }], lines: [{ ...lines[0], amount: 60 }] }));
  await assertFails(change(as('fin'), 'fin', 'c2', 1, { status: 'Approved' }));
  await setDoc(K(as('pay'), 'c3'), claim('pay', 'e5'));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `tenants/${T}/claims/c3`), { status: 'Approved' }));
  await assertSucceeds(change(as('pay'), 'pay', 'c3', 1, { status: 'Paid', paidIn: '2026-11', paidOn: '2026-11-25' }));
  await assertFails(deleteDoc(K(as('a'), 'c1')));
  await assertSucceeds(deleteDoc(K(as('fin'), 'c1')));
});

test('an out-of-date save is refused', async () => {
  await setDoc(K(as('a'), 'c1'), claim('a', 'e1'));
  await assertSucceeds(change(as('fin'), 'fin', 'c1', 1, { status: 'Rejected', reason: 'No receipt' }));
  await assertFails(change(as('head'), 'head', 'c1', 1, { status: 'Approved' }));
});
