// Firestore rules for overtime and attendance-correction requests (one document each).  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, updateDoc, serverTimestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const Q = (db, id) => doc(db, `tenants/${T}/timeRequests/${id}`);
const req = (uid, empId, o = {}) => ({ empId, kind: 'correction', date: '2026-11-02', in: '08:55', out: '18:00', reason: 'Forgot to check in', status: 'Pending',
  chain: [{ level: 'L1', approver: 'e2', backup: '', status: 'pending' }], approverIds: ['e2'], v: 1, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp(), ...o });
const change = (db, uid, id, v, patch) => updateDoc(Q(db, id), { ...patch, v: v + 1, updatedBy: uid, updatedAt: serverTimestamp() });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-time', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
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
    await user('hr', { roles: ['admin', 'employee'], perms: ['time'], empId: 'e4' });
  });
});
test.after(async () => { await env.cleanup(); });

test('an employee files their own correction; not approved, not for someone else', async () => {
  await assertSucceeds(setDoc(Q(as('a'), 'q1'), req('a', 'e1')));
  await assertFails(setDoc(Q(as('a'), 'q2'), req('a', 'e1', { status: 'Approved' })));
  await assertFails(setDoc(Q(as('a'), 'q3'), req('a', 'e3')));
});

test('read by the person, the approver and the time area; not by a colleague', async () => {
  await setDoc(Q(as('a'), 'q1'), req('a', 'e1'));
  for (const u of ['a', 'head', 'hr']) await assertSucceeds(getDoc(Q(as(u), 'q1')), u);
  await assertFails(getDoc(Q(as('b'), 'q1')));
  await assertFails(getDocs(collection(as('b'), `tenants/${T}/timeRequests`)));
});

test('nobody approves their own request; the approver decides once; the person cancels while pending', async () => {
  await setDoc(Q(as('a'), 'q1'), req('a', 'e1'));
  await assertFails(change(as('a'), 'a', 'q1', 1, { status: 'Approved' }));
  await assertFails(change(as('a'), 'a', 'q1', 1, { in: '07:00' }));
  await assertFails(change(as('b'), 'b', 'q1', 1, { status: 'Approved' }));
  await assertSucceeds(change(as('head'), 'head', 'q1', 1, { status: 'Approved', decidedAt: '2026-11-03' }));
  await assertFails(change(as('head'), 'head', 'q1', 2, { status: 'Rejected' }));
  await setDoc(Q(as('a'), 'q2'), req('a', 'e1'));
  await assertSucceeds(change(as('a'), 'a', 'q2', 1, { status: 'Cancelled' }));
});
