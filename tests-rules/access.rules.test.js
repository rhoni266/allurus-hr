// Firestore rules tests for invitations and first-time activation (allurus.my/activate), against the emulator:
//   npm run test:rules        (needs Java 11+)
// Fake companies and people only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, serverTimestamp, Timestamp } = require('firebase/firestore');

let env;
const days = (n) => Timestamp.fromMillis(Date.now() + n * 864e5);
const invite = (o = {}) => ({ tenantId: 'tA', empId: 'e7', name: 'Siti Aminah', company: 'Syarikat A', roles: ['employee'], invitedBy: 'hr@a.my', expiresAt: days(7), ...o });
const prof = (email, o = {}) => ({ email, name: 'Siti Aminah', tenantId: 'tA', roles: ['employee'], empId: 'e7', ...o });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-access', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/tA'), { owner: 'ownerA', name: 'Syarikat A', admin: 'boss@a.my' });
    await setDoc(doc(db, 'tenants/tB'), { owner: 'ownerB', name: 'Syarikat B', admin: 'boss@b.my' });
    await setDoc(doc(db, 'users/ownerA'), { email: 'boss@a.my', tenantId: 'tA', roles: ['admin', 'employee'], empId: 'e1' });
    await setDoc(doc(db, 'users/ownerB'), { email: 'boss@b.my', tenantId: 'tB', roles: ['admin', 'employee'], empId: 'e1' });
    await setDoc(doc(db, 'users/staffA'), { email: 'ali@a.my', tenantId: 'tA', roles: ['employee'], empId: 'e2' });
    await setDoc(doc(db, 'users/goneA'), { email: 'gone@a.my', tenantId: 'tA', roles: ['employee'], empId: 'e3', disabled: true });
    await setDoc(doc(db, 'tenants/tA/buckets/leaves'), { t: 'a', r: 'm', f: {} });
    await setDoc(doc(db, 'tenants/tB/buckets/leaves'), { t: 'a', r: 'm', f: {} });
    await setDoc(doc(db, 'tenants/tA/people/e7'), { first: 'Siti' });
    await setDoc(doc(db, 'invites/siti@a.my'), invite());
    await setDoc(doc(db, 'invites/old@a.my'), invite({ empId: 'e8', expiresAt: days(-1) }));
  });
});
test.after(async () => { await env.cleanup(); });

const as = (uid, token) => env.authenticatedContext(uid, token).firestore();
const siti = (verified = true) => as('sitiUid', { email: 'siti@a.my', email_verified: verified });
const ownerA = () => as('ownerA', { email: 'boss@a.my', email_verified: true });
const staffA = () => as('staffA', { email: 'ali@a.my', email_verified: true });

test('1 happy path: a confirmed, invited email activates and then reads only its own company', async () => {
  await assertSucceeds(getDoc(doc(siti(), 'invites/siti@a.my')));
  await assertSucceeds(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my')));
  await assertSucceeds(getDoc(doc(siti(), 'tenants/tA/buckets/leaves')));
  await assertSucceeds(getDoc(doc(siti(), 'tenants/tA/people/e7')));
  await assertFails(getDoc(doc(siti(), 'tenants/tB/buckets/leaves')));      // 13: company A can't read company B
});

test('2 no invitation: a stranger’s sign-in can’t join any company or read another person’s invite', async () => {
  const x = as('xUid', { email: 'stranger@x.my', email_verified: true });
  await assertFails(setDoc(doc(x, 'users/xUid'), prof('stranger@x.my')));
  await assertFails(getDoc(doc(x, 'invites/siti@a.my')));
});

test('4 an expired invitation can’t be activated', async () => {
  const o = as('oldUid', { email: 'old@a.my', email_verified: true });
  await assertFails(setDoc(doc(o, 'users/oldUid'), prof('old@a.my', { empId: 'e8' })));
});

test('activation needs the email confirmed (the sign-in link does that)', async () => {
  await assertFails(setDoc(doc(siti(false), 'users/sitiUid'), prof('siti@a.my')));
});

test('role, company and employee come only from the invitation', async () => {
  await assertFails(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my', { roles: ['admin', 'employee'] })));
  await assertFails(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my', { tenantId: 'tB' })));
  await assertFails(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my', { empId: 'e1' })));
  await assertFails(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my', { perms: ['payroll'] })));
});

test('8 activating twice is refused (the profile exists)', async () => {
  await assertSucceeds(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my')));
  await assertFails(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my')));
});

test('10 cancelling or changing the email kills the invitation', async () => {
  await assertSucceeds(deleteDoc(doc(ownerA(), 'invites/siti@a.my')));
  await assertFails(setDoc(doc(siti(), 'users/sitiUid'), prof('siti@a.my')));
});

test('11 a non-admin can’t invite, register people or open a company', async () => {
  await assertFails(setDoc(doc(staffA(), 'invites/new@a.my'), invite({ empId: 'e9' })));
  await assertFails(setDoc(doc(staffA(), 'tenants/tA/people/e9'), { first: 'New' }));
  const x = as('xUid', { email: 'founder@x.my', email_verified: true });
  await assertFails(setDoc(doc(x, 'tenants/tNew'), { owner: 'xUid', name: 'Self signup' }));
  await assertFails(setDoc(doc(x, 'tenants/tNew'), { owner: null, name: 'Self signup', admin: 'founder@x.my' }));
});

test('admins invite with an expiry of at most 8 days', async () => {
  await assertSucceeds(setDoc(doc(ownerA(), 'invites/new@a.my'), invite({ empId: 'e9' })));
  await assertFails(setDoc(doc(ownerA(), 'invites/new2@a.my'), invite({ empId: 'e9', expiresAt: days(30) })));
  await assertFails(setDoc(doc(ownerA(), 'invites/new3@a.my'), { ...invite({ empId: 'e9' }), expiresAt: null }));
  await assertFails(setDoc(doc(ownerA(), 'invites/new4@a.my'), invite({ empId: 'e9', tenantId: 'tB' })));   // not their company
});

test('12 a disabled person is blocked at once, can’t re-enable themselves, and only admins disable', async () => {
  const gone = as('goneA', { email: 'gone@a.my', email_verified: true });
  await assertFails(getDoc(doc(gone, 'tenants/tA/buckets/leaves')));
  await assertFails(updateDoc(doc(gone, 'users/goneA'), { disabled: false }));
  await assertFails(updateDoc(doc(staffA(), 'users/goneA'), { disabled: false }));
  await assertSucceeds(updateDoc(doc(ownerA(), 'users/staffA'), { disabled: true }));
  await assertFails(getDoc(doc(staffA(), 'tenants/tA/buckets/leaves')));
  await assertFails(updateDoc(doc(ownerA(), 'users/staffA'), { tenantId: 'tB' }));
});

test('employees can’t change their own role, company, status or link', async () => {
  for (const patch of [{ roles: ['admin', 'employee'] }, { tenantId: 'tB' }, { disabled: false }, { empId: 'e1' }]) await assertFails(updateDoc(doc(staffA(), 'users/staffA'), patch));
});

test('superadmin views every company’s data but can’t change it; other admins can’t view other companies', async () => {
  const sup = as('super1', { role: 'superadmin', email: 'boss@allurus.my', email_verified: true });
  for (const p of ['tenants/tA/buckets/leaves', 'tenants/tB/buckets/leaves', 'tenants/tA/people/e7', 'users/staffA', 'invites/siti@a.my']) await assertSucceeds(getDoc(doc(sup, p)));
  await assertFails(setDoc(doc(sup, 'tenants/tA/buckets/leaves'), { t: 'a', r: 'm', f: { x: '1' } }));
  await assertFails(setDoc(doc(sup, 'tenants/tA/people/e7'), { first: 'Changed' }));
  await assertFails(deleteDoc(doc(sup, 'tenants/tB/buckets/leaves')));
  await assertFails(getDoc(doc(ownerA(), 'tenants/tB/people/e7')));
  await assertFails(getDoc(doc(as('fake', { role: 'admin', email: 'x@x.my', email_verified: true }), 'tenants/tA/buckets/leaves')));
});

test('superadmin opens a company (audited) and invites its first admin, who claims it once', async () => {
  const sup = as('super1', { role: 'superadmin', email: 'boss@allurus.my', email_verified: true });
  const b = writeBatch(sup), a = doc(collection(sup, 'auditLog'));
  b.set(a, { actorUid: 'super1', actorEmail: 'boss@allurus.my', action: 'create-company', entityType: 'tenant', entityId: 'tC', before: null, after: {}, createdAt: serverTimestamp() });
  b.set(doc(sup, 'tenants/tC'), { owner: null, name: 'Syarikat C', admin: 'first@c.my', lastAuditId: a.id });
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(doc(sup, 'invites/first@c.my'), { tenantId: 'tC', empId: 'e1', name: 'Puan C', roles: ['admin', 'employee'], expiresAt: days(7) }));
  // Invitation status for Retry invite: audited, and only "sent" or "failed".
  const mark = async (status, audited = true) => { const bb = writeBatch(sup), aa = doc(collection(sup, 'auditLog'));
    if (audited) bb.set(aa, { actorUid: 'super1', actorEmail: 'boss@allurus.my', action: 'invite-' + status, entityType: 'tenant', entityId: 'tC', before: null, after: {}, createdAt: serverTimestamp() });
    bb.set(doc(sup, 'tenants/tC'), { inviteStatus: status, lastAuditId: aa.id }, { merge: true }); return bb.commit(); };
  await assertSucceeds(mark('failed'));
  await assertFails(mark('hacked'));
  await assertFails(mark('sent', false));
  const first = as('firstUid', { email: 'first@c.my', email_verified: true });
  await assertSucceeds(setDoc(doc(first, 'users/firstUid'), { email: 'first@c.my', name: 'Puan C', tenantId: 'tC', roles: ['admin', 'employee'], empId: 'e1' }));
  await assertSucceeds(updateDoc(doc(first, 'tenants/tC'), { owner: 'firstUid' }));
  await assertFails(updateDoc(doc(first, 'tenants/tC'), { owner: 'someoneElse' }));
});
