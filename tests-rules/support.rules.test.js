// Firestore rules for Allurus support (the superadmin) inside a company: read-only without the client's grant,
// edits only while it's on and each with a supportLog entry, pay and ID data only with the second switch, a log
// the client reads and nobody changes.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const later = (d) => Timestamp.fromMillis(Date.now() + d * 864e5);
const sup = () => env.authenticatedContext('sa', { email: 'rhoni.ent@gmail.com', email_verified: true, role: 'superadmin' }).firestore();
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const other = () => env.authenticatedContext('x', { email: 'x@co2.my', email_verified: true }).firestore();
let n = 0;
// One support write: the document plus its log entry, in one batch.
async function supportWrite(db, p, data, { log = true, logPath = p } = {}) {
  const id = `L${++n}`, b = writeBatch(db);
  if (log) b.set(doc(db, `tenants/${T}/supportLog/${id}`), { kind: 'change', actorUid: 'sa', actorEmail: 'rhoni.ent@gmail.com', at: serverTimestamp(), path: logPath, label: 'x', changes: [] });
  b.set(doc(db, `tenants/${T}/${p}`), { ...data, _support: id }, { merge: true });
  return b.commit();
}
const grant = (o) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), `tenants/${T}/support/grant`), o));

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-support', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'tenants/co2'), { owner: 'x', name: 'Co 2', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('own', { roles: ['admin', 'employee'], empId: 'e1' });
    await user('hr', { roles: ['admin', 'employee'], perms: ['people'], empId: 'e2' });
    await user('a', { roles: ['employee'], empId: 'e3' });
    await setDoc(doc(db, 'users/x'), { tenantId: 'co2', roles: ['admin', 'employee'], empId: 'e1' });
    await setDoc(doc(db, `tenants/${T}/buckets/settings`), { t: 's', r: 'm', f: { company: '"Co 1"' } });
    await setDoc(doc(db, `tenants/${T}/buckets/payroll`), { t: 'o', r: 'p', f: {} });
    await setDoc(doc(db, `tenants/${T}/people/e3`), { first: '"Ali"', role: '"Crew"', ic: '"900101145678"', salary: '36000' });
    await setDoc(doc(db, `tenants/${T}/payslips/e3`), { '2026-10': '{}' });
    await setDoc(doc(db, `tenants/${T}/personal/e3`), { plan: '{}' });
  });
});
test.after(async () => { await env.cleanup(); });

test('without a grant: support views (not pay and ID data) and can’t write', async () => {
  await assertSucceeds(getDoc(doc(sup(), `tenants/${T}/buckets/settings`)));
  await assertSucceeds(getDoc(doc(sup(), `tenants/${T}/people/e3`)));
  await assertFails(getDoc(doc(sup(), `tenants/${T}/buckets/payroll`)));
  await assertFails(getDoc(doc(sup(), `tenants/${T}/payslips/e3`)));
  await assertFails(getDoc(doc(sup(), `tenants/${T}/personal/e3`)));
  await assertFails(supportWrite(sup(), 'buckets/settings', { t: 's', r: 'm', f: { company: '"New"' } }));
  await assertFails(supportWrite(sup(), 'people/e3', { role: '"Supervisor"' }));
});

test('with a grant: writes with a log entry; never without one, or with a log for another document', async () => {
  await grant({ until: later(7) });
  await assertSucceeds(supportWrite(sup(), 'buckets/settings', { t: 's', r: 'm', f: { company: '"New"' } }));
  await assertSucceeds(supportWrite(sup(), 'people/e3', { role: '"Supervisor"' }));
  await assertFails(supportWrite(sup(), 'people/e3', { role: '"Lead"' }, { log: false }));
  await assertFails(supportWrite(sup(), 'people/e3', { role: '"Lead"' }, { logPath: 'people/e9' }));
  await assertFails(supportWrite(sup(), 'buckets/settings', { t: 's', r: 'a', f: {} }));            // can't change who reads it
});

test('pay and ID data: hidden and unchangeable until the second switch is on', async () => {
  await grant({ until: later(7) });
  await assertFails(supportWrite(sup(), 'people/e3', { salary: '40000' }));
  await assertFails(supportWrite(sup(), 'people/e3', { ic: '"900101149999"' }));
  await assertFails(supportWrite(sup(), 'buckets/payroll', { t: 'o', r: 'p', f: {} }));
  await grant({ until: later(7), payUntil: later(7) });
  await assertSucceeds(getDoc(doc(sup(), `tenants/${T}/buckets/payroll`)));
  await assertSucceeds(getDoc(doc(sup(), `tenants/${T}/payslips/e3`)));
  await assertSucceeds(supportWrite(sup(), 'people/e3', { salary: '40000' }));
  await assertFails(getDoc(doc(sup(), `tenants/${T}/personal/e3`)));                                   // never someone's own plan
});

test('after the grant ends, or the client turns it off: no more writes', async () => {
  await grant({ until: Timestamp.fromMillis(Date.now() - 1000) });
  await assertFails(supportWrite(sup(), 'buckets/settings', { t: 's', r: 'm', f: {} }));
  await grant({ until: null });
  await assertFails(supportWrite(sup(), 'buckets/settings', { t: 's', r: 'm', f: {} }));
});

test('only the company’s own Settings admins set the grant, at most 31 days; support never does', async () => {
  const g = (o) => ({ until: later(7), payUntil: null, by: 'own', at: serverTimestamp(), ...o });
  await assertSucceeds(setDoc(doc(as('own'), `tenants/${T}/support/grant`), g()));
  await assertFails(setDoc(doc(as('own'), `tenants/${T}/support/grant`), g({ until: later(40) })));
  await assertFails(setDoc(doc(as('own'), `tenants/${T}/support/grant`), g({ by: 'someone' })));
  await assertFails(setDoc(doc(as('hr'), `tenants/${T}/support/grant`), g({ by: 'hr' })));             // no Settings area
  await assertFails(setDoc(doc(as('a'), `tenants/${T}/support/grant`), g({ by: 'a' })));
  await assertFails(setDoc(doc(sup(), `tenants/${T}/support/grant`), g({ by: 'sa' })));
  await assertFails(setDoc(doc(other(), `tenants/${T}/support/grant`), g({ by: 'x' })));
});

test('the support log: the client’s admins read it; nobody edits or deletes it; only support adds to it', async () => {
  await grant({ until: later(7) });
  await supportWrite(sup(), 'buckets/settings', { t: 's', r: 'm', f: {} });
  await assertSucceeds(getDocs(collection(as('own'), `tenants/${T}/supportLog`)));
  await assertSucceeds(getDocs(collection(as('hr'), `tenants/${T}/supportLog`)));
  await assertFails(getDocs(collection(as('a'), `tenants/${T}/supportLog`)));
  await assertFails(getDocs(collection(other(), `tenants/${T}/supportLog`)));
  const first = (await env.withSecurityRulesDisabled(async (ctx) => (await getDocs(collection(ctx.firestore(), `tenants/${T}/supportLog`))).docs[0].id));
  await assertFails(updateDoc(doc(as('own'), `tenants/${T}/supportLog/${first}`), { label: 'edited' }));
  await assertFails(deleteDoc(doc(as('own'), `tenants/${T}/supportLog/${first}`)));
  await assertFails(updateDoc(doc(sup(), `tenants/${T}/supportLog/${first}`), { label: 'edited' }));
  await assertFails(deleteDoc(doc(sup(), `tenants/${T}/supportLog/${first}`)));
  await assertFails(setDoc(doc(as('own'), `tenants/${T}/supportLog/fake`), { kind: 'session', actorUid: 'own', actorEmail: 'own@co1.my', at: serverTimestamp() }));
  // A session entry can be written without the grant (read-only visits are logged too), but not in someone else's name.
  await grant({ until: null });
  await assertSucceeds(setDoc(doc(sup(), `tenants/${T}/supportLog/s1`), { kind: 'session', actorUid: 'sa', actorEmail: 'rhoni.ent@gmail.com', at: serverTimestamp(), label: 'Session started' }));
  await assertFails(setDoc(doc(sup(), `tenants/${T}/supportLog/s2`), { kind: 'session', actorUid: 'other', actorEmail: 'rhoni.ent@gmail.com', at: serverTimestamp() }));
  await assertFails(setDoc(doc(sup(), `tenants/${T}/supportLog/s3`), { kind: 'change', actorUid: 'sa', actorEmail: 'rhoni.ent@gmail.com', at: serverTimestamp() }));
});

test('another company’s admin or a normal user gets none of this, and nobody can make themselves superadmin', async () => {
  await grant({ until: later(7), payUntil: later(7) });
  await assertFails(getDoc(doc(other(), `tenants/${T}/buckets/settings`)));
  await assertFails(supportWrite(other(), 'buckets/settings', { t: 's', r: 'm', f: {} }));
  await assertFails(supportWrite(as('a'), 'people/e3', { salary: '1' }));
  await assertFails(getDoc(doc(other(), `tenants/${T}/support/grant`)));
  // The role comes only from the token claim (set with the Admin tools); a profile field does nothing.
  await assertFails(updateDoc(doc(as('own'), 'users/own'), { role: 'superadmin' }));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users/x'), { role: 'superadmin' }));
  await assertFails(supportWrite(other(), 'buckets/settings', { t: 's', r: 'm', f: {} }));
  await assertFails(getDoc(doc(other(), `tenants/${T}/payslips/e3`)));
});
