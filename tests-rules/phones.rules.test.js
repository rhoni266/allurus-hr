// Firestore rules for one phone per person (docs/ONE-PHONE-SPEC.md): tenants/{t}/phones/{empId}.
// A person can ask for a phone, register a first one when the company approves first phones automatically, and
// touch lastUsed; only people with the people or time area approve, decline or remove, never their own, except an
// Owner who has just typed their password again.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, updateDoc } = require('firebase/firestore');

let env;
const T = 'co1';
const nowS = () => Math.floor(Date.now() / 1000);
const ctx = (uid, extra = {}) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true, ...extra }).firestore();
const P = (db, e) => doc(db, `tenants/${T}/phones/${e}`);
const phone = (id, o = {}) => ({ id, name: `Phone ${id}`, added: '2026-11-10', ...o });
const seed = (e, data) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `tenants/${T}/phones/${e}`), data));

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-phones', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('own', { roles: ['admin', 'employee'], empId: 'e1' });                                  // the Owner
    await user('hr', { roles: ['admin', 'employee'], perms: ['people'], empId: 'e2' });
    await user('tm', { roles: ['admin', 'employee'], perms: ['time'], empId: 'e3' });
    await user('pay', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e4' });
    await user('a', { roles: ['employee'], empId: 'e5' });
    await user('b', { roles: ['employee'], empId: 'e6' });
  });
});
test.after(async () => { await env.cleanup(); });

test('a first phone: approved at once when the company approves first phones automatically (the default)', async () => {
  await assertSucceeds(setDoc(P(ctx('a'), 'e5'), { active: phone('p1', { auto: true, lastUsed: '2026-11-10' }), pending: null, retired: [] }));
  await assertFails(setDoc(P(ctx('b'), 'e5'), { active: phone('p2', { auto: true }), pending: null, retired: [] }));          // not for someone else
  await assertFails(setDoc(P(ctx('a'), 'e5'), { active: phone('p3'), pending: null, retired: [] }));                          // not marked auto: refused
});

test('with auto-approve off, a first phone can only be asked for (pending), never self-approved', async () => {
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), `tenants/${T}`), { staffDevices: { autoFirst: false } }));
  await assertFails(setDoc(P(ctx('a'), 'e5'), { active: phone('p1', { auto: true }), pending: null, retired: [] }));
  await assertSucceeds(setDoc(P(ctx('a'), 'e5'), { active: null, pending: phone('p1', { requested: '2026-11-10' }), retired: [] }));
  await assertFails(updateDoc(P(ctx('a'), 'e5'), { active: phone('p1', { auto: true }), pending: null }));                    // can't promote their own request
});

test('a second phone: the person can only ask (pending); they can’t approve, retire or swap', async () => {
  await seed('e5', { active: phone('old', { auto: true }), pending: null, retired: [] });
  const a = ctx('a');
  await assertSucceeds(updateDoc(P(a, 'e5'), { pending: phone('new', { requested: '2026-11-11' }) }));
  await assertFails(updateDoc(P(a, 'e5'), { active: phone('new'), pending: null }));                                          // approve their own
  await assertFails(updateDoc(P(a, 'e5'), { active: null }));                                                                 // remove
  await assertFails(updateDoc(P(a, 'e5'), { retired: [phone('old')] }));                                                      // retire
  await assertFails(updateDoc(P(a, 'e5'), { 'active.id': 'new' }));                                                           // swap the id in place
  await assertFails(updateDoc(P(ctx('b'), 'e5'), { pending: phone('new') }));                                                 // someone else's record
  await assertSucceeds(updateDoc(P(a, 'e5'), { pending: null }));                                                             // take the request back
});

test('lastUsed on their own approved phone only', async () => {
  await seed('e5', { active: phone('old', { auto: true, lastUsed: '2026-11-01' }), pending: null, retired: [] });
  await assertSucceeds(updateDoc(P(ctx('a'), 'e5'), { 'active.lastUsed': '2026-11-10' }));
  await assertFails(updateDoc(P(ctx('a'), 'e5'), { 'active.name': 'Renamed' }));
  await assertFails(updateDoc(P(ctx('b'), 'e5'), { 'active.lastUsed': '2026-11-10' }));
});

test('HR (people or time area) approves: the new phone becomes the only approved one, the old is retired', async () => {
  await seed('e5', { active: phone('old', { auto: true }), pending: phone('new', { requested: '2026-11-11' }), retired: [] });
  const approve = { active: phone('new'), pending: null, retired: [phone('old', { retiredOn: '2026-11-12' })] };
  await assertFails(updateDoc(P(ctx('pay'), 'e5'), approve));                                  // payroll area: no
  await assertFails(updateDoc(P(ctx('b'), 'e5'), approve));                                    // a colleague: no
  await assertFails(updateDoc(P(ctx('hr'), 'e5'), { active: phone('other'), pending: null })); // must be the asked-for phone
  await assertSucceeds(updateDoc(P(ctx('hr'), 'e5'), approve));
  await seed('e5', { active: phone('old', { auto: true }), pending: phone('new2'), retired: [] });
  await assertSucceeds(updateDoc(P(ctx('tm'), 'e5'), { active: phone('new2'), pending: null, retired: [phone('old')] }));   // the time area too
});

test('HR declines a request and removes a lost phone', async () => {
  await seed('e5', { active: phone('old', { auto: true }), pending: phone('new'), retired: [] });
  await assertSucceeds(updateDoc(P(ctx('hr'), 'e5'), { pending: null }));
  await assertSucceeds(updateDoc(P(ctx('hr'), 'e5'), { active: null, retired: [phone('old', { retiredOn: '2026-11-12' })] }));
});

test('after Remove phone the person registers a new one (auto-approve on)', async () => {
  await seed('e5', { active: null, pending: null, retired: [phone('old')] });
  await assertSucceeds(updateDoc(P(ctx('a'), 'e5'), { active: phone('n', { auto: true }), pending: null }));
});

test('nobody approves their own phone; the Owner only after typing the password again', async () => {
  const approve = { active: phone('new'), pending: null, retired: [phone('old')] };
  await seed('e2', { active: phone('old', { auto: true }), pending: phone('new'), retired: [] });
  await assertFails(updateDoc(P(ctx('hr'), 'e2'), approve));                                  // an admin approving their own
  await assertSucceeds(updateDoc(P(ctx('tm'), 'e2'), approve));                               // another admin can
  await seed('e1', { active: phone('old', { auto: true }), pending: phone('new'), retired: [] });
  await assertFails(updateDoc(P(ctx('own', { auth_time: nowS() - 3600 }), 'e1'), approve));  // the Owner, signed in an hour ago
  await assertSucceeds(updateDoc(P(ctx('own', { auth_time: nowS() }), 'e1'), approve));      // the Owner, password typed just now
  await seed('e2', { active: phone('old', { auto: true }), pending: phone('new'), retired: [] });
  await assertFails(updateDoc(P(ctx('hr', { auth_time: nowS() }), 'e2'), approve));          // a fresh password doesn't help a non-Owner
});

test('the phone records are private: the person and the people/time area only', async () => {
  await seed('e5', { active: phone('old', { auto: true }), pending: null, retired: [] });
  await assertSucceeds(getDoc(P(ctx('a'), 'e5')));
  await assertSucceeds(getDoc(P(ctx('hr'), 'e5')));
  await assertSucceeds(getDocs(collection(ctx('tm'), `tenants/${T}/phones`)));
  await assertFails(getDoc(P(ctx('b'), 'e5')));
  await assertFails(getDoc(P(ctx('pay'), 'e5')));
  await assertFails(getDocs(collection(ctx('b'), `tenants/${T}/phones`)));
});

// Incident 2026-11-11: an account with an admin role never gets an automatic first phone.
test('an admin account can’t self-approve a first phone (even with auto-approve on); it can only ask, and another admin approves', async () => {
  const hr = ctx('hr');                                                                  // e2: admin (people area)
  await assertFails(setDoc(P(hr, 'e2'), { active: phone('p1', { auto: true }), pending: null, retired: [] }));   // not approved at once
  await assertSucceeds(setDoc(P(hr, 'e2'), { active: null, pending: phone('p1', { requested: '2026-11-11' }), retired: [] }));   // it can ask
  await assertFails(updateDoc(P(hr, 'e2'), { active: phone('p1', { auto: true }), pending: null }));              // and can't promote its own request
  await assertSucceeds(updateDoc(P(ctx('tm'), 'e2'), { active: phone('p1'), pending: null }));                    // another admin approves it
  // The same person after "Remove phone" is asked again, never auto-approved.
  await seed('e3', { active: null, pending: null, retired: [phone('old')] });
  await assertFails(updateDoc(P(ctx('tm'), 'e3'), { active: phone('n', { auto: true }), pending: null }));
  // Plain staff are unchanged: their first phone is still approved at once.
  await assertSucceeds(setDoc(P(ctx('a'), 'e5'), { active: phone('s1', { auto: true }), pending: null, retired: [] }));
});
