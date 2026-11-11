// An IC's sign-up key (staffKeys): readable by anyone (the join page checks the IC before sign-in), deleted by HR with the Settings
// area when an IC is removed, so a removed IC can no longer register.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, writeBatch } = require('firebase/firestore');

let env;
const T = 'Co1X', IC = '900101015555', KEY = `staffKeys/${T}~${IC}`;
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-allurus-ickeys', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'users/hr'), { tenantId: T, roles: ['admin', 'employee'], perms: ['settings', 'people'], empId: 'e4' });
    await setDoc(doc(db, 'users/pay'), { tenantId: T, roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await setDoc(doc(db, 'users/staff'), { tenantId: T, roles: ['employee'], empId: 'e9' });
    await setDoc(doc(db, KEY), { tenantId: T, gen: 1 });
    await setDoc(doc(db, `staffInvites/${T}~${IC}`), { tenantId: T, ic: IC, gen: 1, link: 'lnk1', expiresAt: 1 });
    await setDoc(doc(db, 'joinLinks/lnk1'), { tenantId: T, gen: 1, ic: IC });
  });
});
test.after(async () => { await env.cleanup(); });

test('the key is readable before sign-in (the join page checks the IC), and exists for a current IC', async () => {
  const s = await assertSucceeds(getDoc(doc(anon(), KEY)));
  if (!s.exists()) throw new Error('key should exist');
});
test('HR with the Settings area deletes the key, its invitation and its personal join link; then the IC is unknown to the join page', async () => {
  const db = as('hr'), b = writeBatch(db);
  b.delete(doc(db, `joinLinks/lnk1`)); b.delete(doc(db, `staffInvites/${T}~${IC}`)); b.delete(doc(db, KEY));
  await assertSucceeds(b.commit());
  const after = await getDoc(doc(anon(), KEY));
  if (after.exists()) throw new Error('key should be gone');
});
test('nobody else deletes it: payroll-only HR, staff and signed-out visitors cannot', async () => {
  await assertFails(deleteDoc(doc(as('pay'), KEY)));
  await assertFails(deleteDoc(doc(as('staff'), KEY)));
  await assertFails(deleteDoc(doc(anon(), KEY)));
});
test('another company’s HR cannot delete it', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/Other'), { owner: 'o2', name: 'Other', status: 'active' });
    await setDoc(doc(db, 'users/hr2'), { tenantId: 'Other', roles: ['admin', 'employee'], perms: ['settings', 'people'], empId: 'e1' });
  });
  await assertFails(deleteDoc(doc(as('hr2'), KEY)));
});
