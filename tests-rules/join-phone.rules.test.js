// Firestore rules tests for the phone typed on the join page and the note for HR, against the emulator:
//   npm run test:rules        (needs Java 11+)
// Fake companies and people only.
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = require('firebase/firestore');

let env;
const J = (v) => JSON.stringify(v);
const STAFF = '900101015555.ta.g1@staff.allurus.invalid';

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-phone', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/tA'), { owner: 'owner', name: 'Syarikat A' });
    await setDoc(doc(db, 'users/owner'), { email: 'boss@a.my', tenantId: 'tA', roles: ['admin', 'employee'], empId: 'e1' });
    await setDoc(doc(db, 'users/siti'), { email: STAFF, tenantId: 'tA', roles: ['employee'], empId: 'e7', via: 'open' });
    await setDoc(doc(db, 'tenants/tA/people/e7'), { first: J('Siti'), ic: J('900101015555') });
    await setDoc(doc(db, 'tenants/tA/people/e8'), { first: J('Ali'), phone: J('0191112222') });
    await setDoc(doc(db, 'users/ali'), { email: '900202025555.ta.g1@staff.allurus.invalid', tenantId: 'tA', roles: ['employee'], empId: 'e8', via: 'open' });
  });
});
test.after(async () => { await env.cleanup(); });

const siti = () => env.authenticatedContext('siti', { email: STAFF }).firestore();
const ali = () => env.authenticatedContext('ali', { email: '900202025555.ta.g1@staff.allurus.invalid' }).firestore();
const owner = () => env.authenticatedContext('owner', { email: 'boss@a.my', email_verified: true }).firestore();

test('empty record: the person sets their own phone, valid shape only', async () => {
  await assertFails(updateDoc(doc(siti(), 'tenants/tA/people/e7'), { phone: J('12345') }));
  await assertFails(updateDoc(doc(siti(), 'tenants/tA/people/e7'), { phone: J('0123456789'), first: J('X') }));
  await assertSucceeds(updateDoc(doc(siti(), 'tenants/tA/people/e7'), { phone: J('0123456789') }));
  await assertSucceeds(getDoc(doc(owner(), 'tenants/tA/people/e7')));
});

test('a phone already set: the person can’t change it, only suggest phoneNew; HR decides', async () => {
  await assertFails(updateDoc(doc(ali(), 'tenants/tA/people/e8'), { phone: J('0123456789') }));
  await assertSucceeds(updateDoc(doc(ali(), 'tenants/tA/people/e8'), { phoneNew: J('0123456789'), phoneNewAt: J('2026-11-06') }));
  await assertSucceeds(updateDoc(doc(owner(), 'tenants/tA/people/e8'), { phone: J('0123456789') }));
});

test('no other field, and never someone else’s record', async () => {
  await assertFails(updateDoc(doc(siti(), 'tenants/tA/people/e7'), { ic: J('900101019999') }));
  await assertFails(updateDoc(doc(siti(), 'tenants/tA/people/e8'), { phoneNew: J('0123456789'), phoneNewAt: J('2026-11-06') }));
  await assertFails(updateDoc(doc(siti(), 'tenants/tA/people/e8'), { phone: J('0123456789') }));
  await assertFails(updateDoc(doc(siti(), 'tenants/tA/people/e7'), { phone: J('+123456789012345678') }));
});

test('note for HR: made by that staff sign-in for its own company only; read by HR', async () => {
  const stranger = env.authenticatedContext('newUid', { email: '900303035555.ta.g1@staff.allurus.invalid' }).firestore();
  await assertSucceeds(setDoc(doc(stranger, 'tenants/tA/joinIssues/newUid'), { kind: 'profile', empId: 'e9', at: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, 'tenants/tA/joinIssues/otherUid'), { kind: 'profile', empId: 'e9', at: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, 'tenants/tB/joinIssues/newUid'), { kind: 'profile', empId: 'e9', at: serverTimestamp() }));
  await assertFails(setDoc(doc(stranger, 'tenants/tA/joinIssues/newUid'), { kind: 'profile', empId: 'e9', at: serverTimestamp(), phone: '0123456789' }));
  const email = env.authenticatedContext('e', { email: 'someone@gmail.com' }).firestore();
  await assertFails(setDoc(doc(email, 'tenants/tA/joinIssues/e'), { kind: 'profile', empId: 'e9', at: serverTimestamp() }));
  await assertFails(getDoc(doc(siti(), 'tenants/tA/joinIssues/newUid')));
  await assertSucceeds(getDoc(doc(owner(), 'tenants/tA/joinIssues/newUid')));
});
