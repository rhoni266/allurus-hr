// docs/SALARY-BASIS-SPEC.md: a company with the salaryMonthlyOnly add-on (Major Far East) cannot switch salaries to yearly. npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');

let env;
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.my`, email_verified: true }).firestore();
const settings = (t) => `tenants/${t}/buckets/settings`;

test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-allurus-salary', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/Locked'), { owner: 'o', name: 'Locked Co', status: 'active', addons: { salaryMonthlyOnly: true } });
    await setDoc(doc(db, 'tenants/Free'), { owner: 'o', name: 'Free Co', status: 'active' });
    await setDoc(doc(db, 'users/hrL'), { tenantId: 'Locked', roles: ['admin', 'employee'], perms: ['settings', 'payroll'], empId: 'e1' });
    await setDoc(doc(db, 'users/hrF'), { tenantId: 'Free', roles: ['admin', 'employee'], perms: ['settings', 'payroll'], empId: 'e1' });
    await setDoc(doc(db, settings('Locked')), { t: 's', r: 'm', f: { company: '"Locked Co"', salaryBasis: '"monthly"' } });
    await setDoc(doc(db, settings('Free')), { t: 's', r: 'm', f: { company: '"Free Co"' } });
  });
});
test.after(async () => { await env.cleanup(); });

test('a company with salaryMonthlyOnly cannot set the salary basis to yearly (monthly and other settings are fine)', async () => {
  await assertFails(updateDoc(doc(as('hrL'), settings('Locked')), { 'f.salaryBasis': '"yearly"' }));
  await assertSucceeds(updateDoc(doc(as('hrL'), settings('Locked')), { 'f.salaryBasis': '"monthly"' }));
  await assertSucceeds(updateDoc(doc(as('hrL'), settings('Locked')), { 'f.minWage': '1700' }));
  await assertSucceeds(updateDoc(doc(as('hrL'), settings('Locked')), { 'f.company': '"Locked Co Sdn Bhd"' }));
});
test('every other company may choose yearly or monthly', async () => {
  await assertSucceeds(updateDoc(doc(as('hrF'), settings('Free')), { 'f.salaryBasis': '"yearly"' }));
  await assertSucceeds(updateDoc(doc(as('hrF'), settings('Free')), { 'f.salaryBasis': '"monthly"' }));
});
test('the company cannot switch the lock off itself: the add-on is only changed by the owner’s command', async () => {
  await assertFails(updateDoc(doc(as('hrL'), 'tenants/Locked'), { 'addons.salaryMonthlyOnly': false }));
});
test('only the settings bucket is guarded: nothing else about a locked company changes', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'tenants/Locked/buckets/leaves'), { t: 'l', r: 'm', f: {} }));
  await assertSucceeds(updateDoc(doc(as('hrL'), 'tenants/Locked/buckets/leaves'), { 'f.salaryBasis': '"yearly"' }));   // a field of that name elsewhere is not the setting
});
