// Firestore rules for attendance: one bucket per person per month ("attendance~2026-11~e1", class 'u:time:e1').
// The person reads and writes their own; the time area everyone's; colleagues, approvers and supervisors never write
// someone else's (their approved leave and corrections are applied by the person's own app or HR's).  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const A = (db, id) => doc(db, `tenants/${T}/buckets/${id}`);
const rec = (emp, inT = '08:55') => ({ t: 'm', r: `u:time:${emp}`, f: { [`2026-11-03|${emp}`]: JSON.stringify({ s: 'present', in: inT, out: '' }) } });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-att', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('a', { roles: ['employee'], empId: 'e1' });
    await user('head', { roles: ['employee'], empId: 'e2' });      // A's approver / supervisor, not an admin
    await user('hr', { roles: ['admin', 'employee'], perms: ['time'], empId: 'e4' });
    await user('pay', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await setDoc(A(db, 'attendance~2026-11~e1'), rec('e1'));
  });
});
test.after(async () => { await env.cleanup(); });

test('a person reads and writes their own month (check-in)', async () => {
  await assertSucceeds(getDoc(A(as('a'), 'attendance~2026-11~e1')));
  await assertSucceeds(setDoc(A(as('a'), 'attendance~2026-11~e1'), rec('e1', '08:50'), { merge: true }));
  await assertSucceeds(setDoc(A(as('a'), 'attendance~2026-12~e1'), rec('e1')));
});

test('a colleague, an approver or another admin can’t read or change someone else’s attendance', async () => {
  for (const u of ['head', 'pay']) await assertFails(getDoc(A(as(u), 'attendance~2026-11~e1')), u);
  await assertFails(setDoc(A(as('head'), 'attendance~2026-11~e1'), rec('e1', '07:00'), { merge: true }));
  await assertFails(setDoc(A(as('head'), 'attendance~2026-12~e1'), rec('e1')));      // not even a new month
  await assertFails(setDoc(A(as('a'), 'attendance~2026-11~e1'), { ...rec('e1'), r: 'm' }, { merge: true }));   // can’t make it public
});

test('the time area reads and corrects everyone’s, with the range query the app uses', async () => {
  await assertSucceeds(getDoc(A(as('hr'), 'attendance~2026-11~e1')));
  await assertSucceeds(setDoc(A(as('hr'), 'attendance~2026-11~e1'), rec('e1', '09:00'), { merge: true }));
  await assertSucceeds(getDocs(query(collection(as('hr'), `tenants/${T}/buckets`), where('r', '>=', 'u:time:'), where('r', '<', 'u:time;'))));
  await assertFails(getDocs(query(collection(as('head'), `tenants/${T}/buckets`), where('r', '>=', 'u:time:'), where('r', '<', 'u:time;'))));
  await assertSucceeds(getDocs(query(collection(as('a'), `tenants/${T}/buckets`), where('r', 'in', ['m', 'u:people:e1', 'u:time:e1', 'd:e1']))));
});
