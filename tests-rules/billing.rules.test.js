// Firestore rules tests for company self sign-up, trials and subscriptions, against the emulator:
//   npm run test:rules        (needs Java 11+). Fake companies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, writeBatch, collection, serverTimestamp, Timestamp } = require('firebase/firestore');

let env;
const DAY = 864e5;
const at = (days) => Timestamp.fromMillis(Date.now() + days * DAY);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const as = (uid, token) => env.authenticatedContext(uid, token).firestore();
const SUPER = { role: 'superadmin', email: 'boss@allurus.my', email_verified: true };

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-billing', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const co = async (id, data) => {
      await setDoc(doc(db, `tenants/${id}`), { owner: `own_${id}`, name: id, admin: `boss@${id}.my`, ...data });
      await setDoc(doc(db, `users/own_${id}`), { email: `boss@${id}.my`, tenantId: id, roles: ['admin', 'employee'], empId: 'e1' });
      await setDoc(doc(db, `users/staff_${id}`), { email: `staff@${id}.my`, tenantId: id, roles: ['employee'], empId: 'e2' });
      await setDoc(doc(db, `tenants/${id}/buckets/leaves`), { t: 'a', r: 'm', f: {} });
    };
    await co('legacy', {});                                                   // from before billing: no status
    await co('trialOk', { status: 'trial', trialEndsAt: at(10) });
    await co('trialOver', { status: 'trial', trialEndsAt: at(-1) });
    await co('paidOk', { status: 'active', paidUntil: at(20) });
    await co('grace', { status: 'active', paidUntil: at(-3) });              // 3 days late: past due, still working
    await co('lapsed', { status: 'active', paidUntil: at(-9) });             // beyond 7 days' grace: expired
    await co('susp', { status: 'suspended', trialEndsAt: at(10) });
  });
});
test.after(async () => { await env.cleanup(); });

const admin = (id) => as(`own_${id}`, { email: `boss@${id}.my`, email_verified: true });
const staff = (id) => as(`staff_${id}`, { email: `staff@${id}.my`, email_verified: true });
const leaves = (db, id) => doc(db, `tenants/${id}/buckets/leaves`);
const write = (db, id) => setDoc(leaves(db, id), { t: 'a', r: 'm', f: { x: '"1"' } });

function signup(db, uid, email, o = {}) {
  const phone = o.phone || '60123456789';
  const b = writeBatch(db), tid = o.tenantId || `self_${uid}`;
  b.set(doc(db, `signupAttempts/${sha(phone)}`), { uid, createdAt: serverTimestamp() });
  b.set(doc(db, `tenants/${tid}`), { owner: uid, name: 'Kedai Baru', admin: email, adminName: 'Aminah', phone, industryIds: ['fnb'], staffRange: '1-10',
    status: 'trial', plan: 'trial', isTest: false, trialStartedAt: serverTimestamp(), trialEndsAt: o.trialEndsAt || at(30), createdVia: 'self_signup',
    termsVersion: '2026-10-29', termsAcceptedAt: serverTimestamp(), createdAt: serverTimestamp(), ...(o.extra || {}) });
  b.set(doc(db, `users/${uid}`), { email, name: 'Aminah', tenantId: tid, roles: o.roles || ['admin', 'employee'], empId: 'e1' });
  return b.commit();
}
const founder = (uid, email, verified = true) => as(uid, { email, email_verified: verified });

test('1 self sign-up: company, trial and Owner profile are created together', async () => {
  const db = founder('u1', 'aminah@kedai.my');
  await assertSucceeds(signup(db, 'u1', 'aminah@kedai.my'));
  await assertSucceeds(getDoc(doc(db, 'tenants/self_u1')));
  await assertSucceeds(setDoc(doc(db, 'tenants/self_u1/buckets/leaves'), { t: 'a', r: 'm', f: {} }));
});

test('2 the same mobile number can’t start a second trial (and the same email is one Firebase sign-in)', async () => {
  await assertSucceeds(signup(founder('u1', 'aminah@kedai.my'), 'u1', 'aminah@kedai.my'));
  await assertFails(signup(founder('u2', 'other@kedai.my'), 'u2', 'other@kedai.my'));
  await assertSucceeds(signup(founder('u3', 'third@kedai.my'), 'u3', 'third@kedai.my', { phone: '60198765432' }));
});

test('3 disposable or unconfirmed emails can’t sign up', async () => {
  await assertFails(signup(founder('u4', 'x@mailinator.com'), 'u4', 'x@mailinator.com'));
  await assertFails(signup(founder('u5', 'x@kedai.my', false), 'u5', 'x@kedai.my'));
});

test('4 a browser can’t forge a longer trial, another status, a role, or join an existing company', async () => {
  await assertFails(signup(founder('u6', 'a@k.my'), 'u6', 'a@k.my', { trialEndsAt: at(365) }));
  await assertFails(signup(founder('u7', 'b@k.my'), 'u7', 'b@k.my', { phone: '60111111111', extra: { status: 'active' } }));
  await assertFails(signup(founder('u8', 'c@k.my'), 'u8', 'c@k.my', { phone: '60122222222', roles: ['admin', 'employee', 'superadmin'] }));
  await assertFails(signup(founder('u9', 'd@k.my'), 'u9', 'd@k.my', { phone: '60133333333', tenantId: 'paidOk' }));
  const solo = founder('u10', 'e@k.my');   // a profile on its own, without creating its company in the same batch
  await assertFails(setDoc(doc(solo, 'users/u10'), { email: 'e@k.my', name: 'E', tenantId: 'trialOk', roles: ['admin', 'employee'], empId: 'e1' }));
});

test('13 companies from before billing, trials and paid companies work normally', async () => {
  for (const id of ['legacy', 'trialOk', 'paidOk']) { await assertSucceeds(getDoc(leaves(staff(id), id))); await assertSucceeds(write(admin(id), id)); }
});

test('9 past due: still working inside the 7-day grace, expired after it', async () => {
  await assertSucceeds(write(staff('grace'), 'grace'));
  await assertFails(getDoc(leaves(staff('lapsed'), 'lapsed')));
});

test('6 trial over: staff blocked, admin reads (export) but can’t change anything, data intact', async () => {
  await assertFails(getDoc(leaves(staff('trialOver'), 'trialOver')));
  await assertSucceeds(getDoc(leaves(admin('trialOver'), 'trialOver')));
  await assertFails(write(admin('trialOver'), 'trialOver'));
  await assertSucceeds(getDoc(doc(staff('trialOver'), 'tenants/trialOver')), 'the company record itself stays readable, for the message');
});

test('suspended: everyone blocked', async () => {
  await assertFails(getDoc(leaves(admin('susp'), 'susp')));
  await assertFails(getDoc(leaves(staff('susp'), 'susp')));
});

test('7 expired admin can send payment proof; staff and other companies can’t', async () => {
  const pay = (db, tenantId, o = {}) => setDoc(doc(collection(db, 'payments')), { tenantId, planId: 'basic', months: 1, amountMyr: 99, reference: 'ALR-TRIALO-202611', method: 'bank',
    proof: 'data:image/jpeg;base64,AAAA', proofName: 'slip.jpg', status: 'submitted', submittedBy: `boss@${tenantId}.my`.toLowerCase(), createdAt: serverTimestamp(), ...o });
  await assertSucceeds(pay(admin('trialOver'), 'trialOver'));
  await assertFails(pay(staff('trialOver'), 'trialOver', { submittedBy: 'staff@trialover.my' }));
  await assertFails(pay(admin('paidOk'), 'trialOver', { submittedBy: 'boss@paidok.my' }));
  await assertFails(pay(admin('trialOver'), 'trialOver', { status: 'approved' }));
});

test('admins can’t change their own status, trial or plan; superadmin can, with an audit entry', async () => {
  await assertFails(updateDoc(doc(admin('trialOver'), 'tenants/trialOver'), { trialEndsAt: at(30) }));
  await assertFails(updateDoc(doc(admin('trialOk'), 'tenants/trialOk'), { status: 'active' }));
  const sup = as('super1', SUPER), b = writeBatch(sup), a = doc(collection(sup, 'auditLog'));
  b.set(a, { actorUid: 'super1', actorEmail: 'boss@allurus.my', action: 'mark-paid', entityType: 'tenant', entityId: 'trialOver', before: null, after: {}, createdAt: serverTimestamp() });
  b.set(doc(sup, 'tenants/trialOver'), { status: 'active', plan: 'basic', paidUntil: at(31), lastAuditId: a.id }, { merge: true });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDoc(leaves(staff('trialOver'), 'trialOver')), 'reactivated at once');
  await assertFails(setDoc(doc(sup, 'tenants/trialOver'), { status: 'active', paidUntil: at(400) }, { merge: true }), 'not without an audit entry');
});

test('11 company A can’t read company B; plans are public, billing settings need sign-in', async () => {
  await assertFails(getDoc(leaves(admin('trialOk'), 'paidOk')));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'plans/basic')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'config/billing')));
  await assertFails(setDoc(doc(admin('trialOk'), 'plans/basic'), { priceMyr: 1 }));
});
