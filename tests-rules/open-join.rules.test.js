// Firestore rules for the open join page: company code + IC + password while HR has Open registration on; the
// profile is pending (no access) until HR approves it.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, Timestamp } = require('firebase/firestore');

let env;
const T = 'Co1X';
const IC = '900101145678';
const later = (d) => Timestamp.fromMillis(Date.now() + d * 864e5);
const mail = (ic, g) => `${ic}.${T.toLowerCase()}.g${g}@staff.allurus.invalid`;
const staff = (uid, email) => env.authenticatedContext(uid, { email, email_verified: false }).firestore();
const hr = () => env.authenticatedContext('hr', { email: 'hr@co1.my', email_verified: true }).firestore();
const prof = (email, o = {}) => ({ tenantId: T, email, code: 'co1', roles: ['employee'], empId: '', pending: true, via: 'open', ...o });
const setCode = (o) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'companyCodes/co1'), { tenantId: T, ...o }));

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-open', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'users/hr'), { tenantId: T, roles: ['admin', 'employee'], perms: ['settings'], empId: 'e4' });
    await setDoc(doc(db, 'users/pay'), { tenantId: T, roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await setDoc(doc(db, `tenants/${T}/buckets/directory`), { r: 'm', f: {} });
  });
  await setCode({ openUntil: later(7) });
});
test.after(async () => { await env.cleanup(); });

test('while open: joins as pending, with no employee, employee role only', async () => {
  await assertSucceeds(setDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), prof(mail(IC, 1))));
  await assertFails(setDoc(doc(staff('s2', mail('900101149999', 1)), 'users/s2'), prof(mail('900101149999', 1), { pending: false })));
  await assertFails(setDoc(doc(staff('s3', mail('900101149998', 1)), 'users/s3'), prof(mail('900101149998', 1), { empId: 'e1' })));
  await assertFails(setDoc(doc(staff('s4', mail('900101149997', 1)), 'users/s4'), prof(mail('900101149997', 1), { roles: ['admin', 'employee'] })));
  await assertFails(setDoc(doc(staff('s5', mail('900101149996', 1)), 'users/s5'), prof(mail('900101149996', 1), { code: 'nope' })));
});

test('closed or expired: nobody joins', async () => {
  await setCode({ openUntil: null });
  await assertFails(setDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), prof(mail(IC, 1))));
  await setCode({ openUntil: Timestamp.fromMillis(Date.now() - 1000) });
  await assertFails(setDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), prof(mail(IC, 1))));
});

test('the generation must be the current one (1 if never invited)', async () => {
  await assertFails(setDoc(doc(staff('s1', mail(IC, 2)), 'users/s1'), prof(mail(IC, 2))));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `staffKeys/${T}~${IC}`), { tenantId: T, gen: 3 }));
  await assertFails(setDoc(doc(staff('s2', mail(IC, 1)), 'users/s2'), prof(mail(IC, 1))));
  await assertSucceeds(setDoc(doc(staff('s3', mail(IC, 3)), 'users/s3'), prof(mail(IC, 3))));
});

test('a pending person sees nothing of the company until approved', async () => {
  const db = staff('s1', mail(IC, 1));
  await setDoc(doc(db, 'users/s1'), prof(mail(IC, 1)));
  await assertSucceeds(getDoc(doc(db, 'users/s1')));                 // their own profile, to show "waiting"
  await assertFails(getDoc(doc(db, `tenants/${T}/buckets/directory`)));
  await assertFails(getDoc(doc(db, `tenants/${T}`)));
  await assertSucceeds(updateDoc(doc(hr(), 'users/s1'), { pending: false, empId: 'e7' }));
  await assertSucceeds(getDoc(doc(db, `tenants/${T}/buckets/directory`)));
});

test('only HR with Settings approves; nobody makes someone pending or changes an approved employee', async () => {
  await setDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), prof(mail(IC, 1)));
  const pay = env.authenticatedContext('pay', { email: 'pay@co1.my', email_verified: true }).firestore();
  await assertFails(updateDoc(doc(pay, 'users/s1'), { pending: false, empId: 'e7' }));
  await assertFails(updateDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), { pending: false, empId: 'e7' }));
  await assertSucceeds(updateDoc(doc(hr(), 'users/s1'), { pending: false, empId: 'e7' }));
  await assertFails(updateDoc(doc(hr(), 'users/s1'), { empId: 'e8' }));
  await assertFails(updateDoc(doc(hr(), 'users/pay'), { pending: true }));
  await assertSucceeds(updateDoc(doc(hr(), 'users/s1'), { disabled: true }));          // "This is not them"
});

test('HR opens and closes registration; at most 31 days; others can’t', async () => {
  await assertSucceeds(setDoc(doc(hr(), 'companyCodes/co1'), { tenantId: T, openUntil: later(7), company: 'Co 1' }));
  await assertSucceeds(setDoc(doc(hr(), 'companyCodes/co1'), { tenantId: T, openUntil: null, company: 'Co 1' }));
  await assertFails(setDoc(doc(hr(), 'companyCodes/co1'), { tenantId: T, openUntil: later(40) }));
  await assertFails(setDoc(doc(hr(), 'companyCodes/co1'), { tenantId: 'other', openUntil: later(7) }));
  const pay = env.authenticatedContext('pay', { email: 'pay@co1.my', email_verified: true }).firestore();
  await assertFails(setDoc(doc(pay, 'companyCodes/co1'), { tenantId: T, openUntil: later(7) }));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'companyCodes/co1'), { tenantId: T, openUntil: later(7) }));
});
