// Firestore rules for IC sign-in (staff with no work email).  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, Timestamp } = require('firebase/firestore');

let env;
const T = 'Co1X';
const IC = '900101145678';
const LINK = 'k'.repeat(30);
const soon = () => Timestamp.fromMillis(Date.now() + 3 * 864e5);
const mail = (ic, g, t = T) => `${ic}.${t.toLowerCase()}.g${g}@staff.allurus.invalid`;
const staff = (uid, email) => env.authenticatedContext(uid, { email, email_verified: false }).firestore();
const hr = () => env.authenticatedContext('hr', { email: 'hr@co1.my', email_verified: true }).firestore();
const prof = (email, o = {}) => ({ tenantId: T, email, roles: ['employee'], empId: 'e7', via: 'ic', link: LINK, ...o });
const invite = (o = {}) => ({ tenantId: T, ic: IC, empId: 'e7', gen: 1, link: LINK, expiresAt: soon(), ...o });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-ic', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'users/hr'), { tenantId: T, roles: ['admin', 'employee'], perms: ['settings'], empId: 'e4' });
    await setDoc(doc(db, 'users/pay'), { tenantId: T, roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await setDoc(doc(db, 'users/other'), { tenantId: 'co2', roles: ['admin', 'employee'], empId: 'e1' });
  });
});
test.after(async () => { await env.cleanup(); });

test('HR with the settings area invites an IC; others can’t', async () => {
  await assertSucceeds(setDoc(doc(hr(), `staffInvites/${T}~${IC}`), invite()));
  await assertSucceeds(setDoc(doc(hr(), `staffKeys/${T}~${IC}`), { tenantId: T, gen: 1 }));
  await assertSucceeds(setDoc(doc(hr(), `joinLinks/${LINK}`), { tenantId: T, company: 'Co 1', code: 'co1', gen: 1, expiresAt: soon() }));
  await assertSucceeds(setDoc(doc(hr(), 'companyCodes/co1'), { tenantId: T }));
  const pay = env.authenticatedContext('pay', { email: 'pay@co1.my', email_verified: true }).firestore();
  await assertFails(setDoc(doc(pay, `staffInvites/${T}~${IC}`), invite()));
  const oth = env.authenticatedContext('other', { email: 'o@co2.my', email_verified: true }).firestore();
  await assertFails(setDoc(doc(oth, `staffInvites/${T}~${IC}`), invite()));
  await assertFails(setDoc(doc(hr(), `staffInvites/${T}~123`), invite({ ic: '123' })));
  await assertFails(setDoc(doc(hr(), `staffInvites/${T}~${IC}`), invite({ link: 'short' })));
});

test('keys, links and codes are read by id only; invites only by HR', async () => {
  await setDoc(doc(hr(), `staffInvites/${T}~${IC}`), invite());
  await setDoc(doc(hr(), `staffKeys/${T}~${IC}`), { tenantId: T, gen: 1 });
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anon, `staffKeys/${T}~${IC}`)));
  await assertFails(getDocs(collection(anon, 'staffKeys')));
  await assertFails(getDocs(collection(anon, 'joinLinks')));
  await assertFails(getDoc(doc(anon, `staffInvites/${T}~${IC}`)));
});

test('a staff member joins with the right IC, generation and link; nothing else works', async () => {
  await setDoc(doc(hr(), `staffInvites/${T}~${IC}`), invite());
  await assertFails(setDoc(doc(staff('s0', mail('900101149999', 1)), 'users/s0'), prof(mail('900101149999', 1))));        // another IC
  await assertFails(setDoc(doc(staff('s1', mail(IC, 2)), 'users/s1'), prof(mail(IC, 2))));                                  // wrong generation
  await assertFails(setDoc(doc(staff('s2', mail(IC, 1)), 'users/s2'), prof(mail(IC, 1), { link: 'x'.repeat(30) })));        // wrong link
  await assertFails(setDoc(doc(staff('s3', mail(IC, 1)), 'users/s3'), prof(mail(IC, 1), { roles: ['admin', 'employee'] })));
  await assertFails(setDoc(doc(staff('s4', mail(IC, 1)), 'users/s4'), prof(mail(IC, 1), { empId: 'e1' })));
  await assertFails(setDoc(doc(staff('s5', `${IC}.${T.toLowerCase()}.g1@gmail.com`), 'users/s5'), prof(`${IC}.${T.toLowerCase()}.g1@gmail.com`)));
  await assertSucceeds(setDoc(doc(staff('s6', mail(IC, 1)), 'users/s6'), prof(mail(IC, 1))));
});

test('after Reset sign-in (generation 2) the old generation can’t join', async () => {
  await setDoc(doc(hr(), `staffInvites/${T}~${IC}`), invite({ gen: 2 }));
  await assertFails(setDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), prof(mail(IC, 1))));
  await assertSucceeds(setDoc(doc(staff('s2', mail(IC, 2)), 'users/s2'), prof(mail(IC, 2))));
});

test('an expired invitation can’t be used', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `staffInvites/${T}~${IC}`), invite({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })));
  await assertFails(setDoc(doc(staff('s1', mail(IC, 1)), 'users/s1'), prof(mail(IC, 1))));
});
