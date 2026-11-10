// Firestore rules for who uses which device (docs/DEVICE-RULES-SPEC.md): the company setting
// (tenants/{t}.staffDevices) and the per-person exception (users/{uid}.allowComputer). Only the Owner or the
// Settings area changes them.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-device', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('own', { roles: ['admin', 'employee'], empId: 'e1' });
    await user('set', { roles: ['admin', 'employee'], perms: ['settings'], empId: 'e2' });
    await user('pay', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e3' });
    await user('a', { roles: ['employee'], empId: 'e4' });
  });
});
test.after(async () => { await env.cleanup(); });

test('the company setting: Owner or Settings area only', async () => {
  await assertSucceeds(updateDoc(doc(as('own'), `tenants/${T}`), { staffDevices: { phonesOnly: false, tablets: true } }));
  await assertSucceeds(updateDoc(doc(as('set'), `tenants/${T}`), { staffDevices: { phonesOnly: true, tablets: false } }));
  await assertFails(updateDoc(doc(as('pay'), `tenants/${T}`), { staffDevices: { phonesOnly: false, tablets: false } }));
  await assertFails(updateDoc(doc(as('a'), `tenants/${T}`), { staffDevices: { phonesOnly: false, tablets: false } }));
});

test('allow one person on a computer: Settings area only, never yourself', async () => {
  await assertSucceeds(updateDoc(doc(as('set'), 'users/a'), { allowComputer: true }));
  await assertSucceeds(updateDoc(doc(as('own'), 'users/a'), { allowComputer: false }));
  await assertFails(updateDoc(doc(as('pay'), 'users/a'), { allowComputer: true }));
  await assertFails(updateDoc(doc(as('a'), 'users/a'), { allowComputer: true }));                  // not for yourself
  await assertFails(updateDoc(doc(as('set'), 'users/a'), { allowComputer: 'yes' }));
});
