// docs/JOIN-AUTOLINK-SPEC.md: staffLinks/<tenant>~<IC> and the rule that lets a new join-page sign-up link ITSELF to its own record.
//   npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, serverTimestamp } = require('firebase/firestore');

let env;
const T = 'Co1X', IC = '900101015551', IC2 = '900202025552';
const mail = (ic, g = 1) => `${ic}.${T.toLowerCase()}.g${g}@staff.allurus.invalid`;
const staff = (uid, ic) => env.authenticatedContext(uid, { email: mail(ic), email_verified: false }).firestore();
const hr = () => env.authenticatedContext('hr', { email: 'hr@co1.my', email_verified: true }).firestore();
const pay = () => env.authenticatedContext('pay', { email: 'pay@co1.my', email_verified: true }).firestore();
const L = (ic) => `staffLinks/${T}~${ic}`;
const link = (o = {}) => ({ tenantId: T, empId: 'e2', gen: 1, hasSignIn: false, phone4: '0001', updatedAt: serverTimestamp(), ...o });
const prof = (ic, o = {}) => ({ tenantId: T, email: mail(ic), code: 'co1', roles: ['employee'], empId: '', pending: false, via: 'open', name: 'Staff', phone: '+60123450001', ...o });
const setSwitch = (on) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `tenants/${T}/buckets/settings`), { t: 's', r: 'm', f: { joinAutoLink: on ? 'true' : 'false' } }));
const seedLink = (ic, o) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), L(ic)), link(o)));
const link1 = () => ({ empId: 'e2', autoLinkedAt: serverTimestamp() });

test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-allurus-links', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'users/hr'), { tenantId: T, roles: ['admin', 'employee'], perms: ['settings', 'people'], empId: 'e4' });
    await setDoc(doc(db, 'users/pay'), { tenantId: T, roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await setDoc(doc(db, 'users/s1'), prof(IC));
    await setDoc(doc(db, 'users/s2'), prof(IC2, { phone: '' }));
    await setDoc(doc(db, L(IC)), link());
    await setDoc(doc(db, L(IC2)), link({ empId: 'e3', phone4: '' }));
  });
  await setSwitch(true);
});
test.after(async () => { await env.cleanup(); });

test('a staff sign-in reads only the link made for its own IC; nobody lists them; signed-out visitors read nothing', async () => {
  await assertSucceeds(getDoc(doc(staff('s1', IC), L(IC))));
  await assertFails(getDoc(doc(staff('s1', IC), L(IC2))));                                   // another worker's
  await assertFails(getDocs(collection(staff('s1', IC), 'staffLinks')));                      // no listing
  await assertFails(getDocs(query(collection(staff('s1', IC), 'staffLinks'), where('tenantId', '==', T))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), L(IC))));
  await assertFails(getDoc(doc(env.authenticatedContext('x', { email: 'nadia@co1.my', email_verified: true }).firestore(), L(IC))));   // an ordinary email
  await assertFails(getDoc(doc(env.authenticatedContext('y', { email: `${IC}.other.g1@staff.allurus.invalid`, email_verified: false }).firestore(), L(IC))));   // another company's pattern
});

test('HR with the People area writes, lists and deletes them; payroll-only HR and staff cannot; no name or extra field', async () => {
  await assertSucceeds(getDocs(query(collection(hr(), 'staffLinks'), where('tenantId', '==', T))));
  await assertFails(getDocs(query(collection(pay(), 'staffLinks'), where('tenantId', '==', T))));
  await assertSucceeds(setDoc(doc(hr(), L('900303035553')), link({ empId: 'e5' })));
  await assertFails(setDoc(doc(hr(), L('900303035554')), { ...link({ empId: 'e6' }), name: 'Aina Rahman' }));   // no name
  await assertFails(setDoc(doc(hr(), L('900303035555')), link({ empId: '' })));
  await assertFails(setDoc(doc(hr(), L('900303035556')), link({ empId: 'e6', tenantId: 'Other' })));          // another company's
  await assertFails(setDoc(doc(staff('s1', IC), L(IC)), link({ empId: 'e1' })));                              // a worker cannot choose their own link
  await assertFails(setDoc(doc(pay(), L('900303035557')), link({ empId: 'e7' })));
  await assertFails(deleteDoc(doc(staff('s1', IC), L(IC))));
  await assertSucceeds(deleteDoc(doc(hr(), L(IC2))));
});

test('a new sign-up links itself to its own record, once, only to the value in its link, only while the switch is on', async () => {
  await assertSucceeds(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));
  const u = (await getDoc(doc(env.authenticatedContext('hr', { email: 'hr@co1.my', email_verified: true }).firestore(), 'users/s1'))).data();
  if (u.empId !== 'e2' || !u.autoLinkedAt) throw new Error('should be linked and stamped');
  // once: never changed afterwards, not even to a record in their own link
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { empId: 'e9', autoLinkedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { empId: 'e2', autoLinkedAt: serverTimestamp() }));
});

test('refused: switch off, another record, a record that already has a sign-in, wrong phone ending, no stamp, extra fields', async () => {
  await setSwitch(false);
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));                    // the company has the automatic link off
  await setSwitch(true);
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { empId: 'e1', autoLinkedAt: serverTimestamp() }));        // not the linked value
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { empId: 'e2' }));                                       // no stamp
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { ...link1(), roles: ['admin', 'employee'] }));           // nothing else changes with it
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { ...link1(), disabled: false }));
  await assertFails(updateDoc(doc(staff('s2', IC2), 'users/s1'), link1()));                   // not your own sign-in
  await seedLink(IC, { hasSignIn: true });
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));                    // the record already has another sign-in
  await seedLink(IC, { phone4: '9999' });
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));                    // phone typed ends 0001, HR has 9999
  await seedLink(IC, { phone4: '0001' });
  await assertSucceeds(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));                 // and now it matches
});

test('no phone on file: no phone check; a record with no link document (shared IC, admin, no IC) is never linked', async () => {
  await assertSucceeds(updateDoc(doc(staff('s2', IC2), 'users/s2'), { empId: 'e3', autoLinkedAt: serverTimestamp() }));
  await env.withSecurityRulesDisabled(async (ctx) => { const db = ctx.firestore(); await deleteDoc(doc(db, L(IC))); await setDoc(doc(db, 'users/s1'), prof(IC)); });
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));                    // HR made no link for this IC
});

test('an admin account, or one that did not join through the open page, never links itself', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/s1'), prof(IC, { roles: ['admin', 'employee'] })));
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/s1'), prof(IC, { via: 'ic' })));
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/s1'), prof(IC, { disabled: true })));
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));
});

test('the display name is set once from the placeholder, only after an automatic link', async () => {
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { name: 'Anyone' }));          // not linked yet
  await assertSucceeds(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));
  await assertSucceeds(updateDoc(doc(staff('s1', IC), 'users/s1'), { name: 'Aina binti Rahman' }));
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { name: 'Somebody Else' }));   // once
  await assertFails(updateDoc(doc(staff('s1', IC), 'users/s1'), { name: 'x'.repeat(101) }));
});

test('"This isn’t them": HR removes an automatic link and turns the sign-in off in one write; no other link can be taken back or changed', async () => {
  await assertSucceeds(updateDoc(doc(staff('s1', IC), 'users/s1'), link1()));
  await assertFails(updateDoc(doc(hr(), 'users/s1'), { empId: '' }));                          // must be turned off at the same time
  await assertFails(updateDoc(doc(hr(), 'users/s1'), { empId: 'e9', disabled: true }));       // cannot move it to someone else
  await assertSucceeds(updateDoc(doc(hr(), 'users/s1'), { empId: '', disabled: true }));
  // a link that HR or a script made some other way keeps the old rule: it cannot be cleared here
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users/s2'), prof(IC2, { empId: 'e3' })));
  await assertFails(updateDoc(doc(hr(), 'users/s2'), { empId: '', disabled: true }));
  await assertFails(updateDoc(doc(pay(), 'users/s1'), { empId: '', disabled: true }));        // payroll-only HR cannot
});
