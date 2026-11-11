// The staff-app switches (settings.staffApp: simple screen, payslip PDF password) live in the company's settings bucket:
// every member reads them (the app needs them), only HR with the Settings area changes them.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc } = require('firebase/firestore');

let env;
const T = 'Co1X';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const bucket = (db) => doc(db, `tenants/${T}/buckets/settings`);
const on = '{"simple":true,"pdfPw":true}', off = '{"simple":false,"pdfPw":true}';

test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-allurus-staffapp', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active', addons: { simpleStaffHome: true } });
    await setDoc(doc(db, 'users/staff'), { tenantId: T, roles: ['employee'], empId: 'e9' });
    await setDoc(doc(db, 'users/hr'), { tenantId: T, roles: ['admin', 'employee'], perms: ['settings'], empId: 'e4' });
    await setDoc(doc(db, 'users/pay'), { tenantId: T, roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    await setDoc(bucket(db), { t: 's', r: 'm', f: { staffApp: on } });
  });
});
test.after(async () => { await env.cleanup(); });

test('staff can read the switches but not change them', async () => {
  await assertSucceeds(getDoc(bucket(as('staff'))));
  await assertFails(updateDoc(bucket(as('staff')), { 'f.staffApp': off }));
});
test('only HR with the Settings area changes them; payroll-only HR cannot', async () => {
  await assertFails(updateDoc(bucket(as('pay')), { 'f.staffApp': off }));
  await assertSucceeds(updateDoc(bucket(as('hr')), { 'f.staffApp': off }));
});
test('the switches cannot be hidden from staff: the bucket stays readable by every member', async () => {
  await assertFails(updateDoc(bucket(as('hr')), { r: 'a' }));
});
test('the add-on itself (tenants/{t}.addons) is not writable by the company, only by the owner’s command', async () => {
  await assertFails(updateDoc(doc(as('hr'), `tenants/${T}`), { 'addons.simpleStaffHome': false }));
  await assertFails(updateDoc(doc(as('staff'), `tenants/${T}`), { 'addons.simpleStaffHome': true }));
});
