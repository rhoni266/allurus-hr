// docs/INVENTORY-ON-SPEC.md: in a REAL company (not a demo) the stock lists (ops.* buckets) are read and written by people with the Operations
// area and the Owner, and by nobody else; a storekeeper with only Operations sees nothing of payroll or people.   npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, getDocs, collection, query, where } = require('firebase/firestore');

let env;
const T = 'Co1X';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@x.my`, email_verified: true }).firestore();
const b = (name) => `tenants/${T}/buckets/${name}`;
const stockDoc = { t: 'o', r: 'o', f: { i1: JSON.stringify({ id: 'i1', code: 'HW-001', name: 'Cement', unit: 'bag', opening: 0, reorder: 10 }) } };

test.before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-allurus-inventory', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } }); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    await setDoc(doc(db, 'users/owner'), { tenantId: T, roles: ['admin', 'employee'], empId: 'e1' });                                  // no perms = Owner
    await setDoc(doc(db, 'users/store'), { tenantId: T, roles: ['admin', 'employee'], perms: ['operations'], empId: 'e2' });          // the storekeeper
    await setDoc(doc(db, 'users/pay'), { tenantId: T, roles: ['admin', 'employee'], perms: ['payroll', 'people'], empId: 'e3' });
    await setDoc(doc(db, 'users/staff'), { tenantId: T, roles: ['employee'], empId: 'e4' });
    await setDoc(doc(db, b('ops.items')), stockDoc);
    await setDoc(doc(db, b('ops.moves')), { t: 'o', r: 'o', f: {} });
    await setDoc(doc(db, b('payroll')), { t: 'p', r: 'p', f: { '2026-10': '{}' } });
    await setDoc(doc(db, `tenants/${T}/people/e4`), { first: '"Ali"' });
  });
});
test.after(async () => { await env.cleanup(); });

test('the Owner and the storekeeper (Operations area) read and write the stock lists of a real company', async () => {
  for (const u of ['owner', 'store']) {
    await assertSucceeds(getDoc(doc(as(u), b('ops.items'))));
    await assertSucceeds(updateDoc(doc(as(u), b('ops.items')), { 'f.i2': JSON.stringify({ id: 'i2', code: 'HW-002', name: 'Nails' }) }));
    await assertSucceeds(setDoc(doc(as(u), b('ops.moves')), { t: 'o', r: 'o', f: { m1: JSON.stringify({ id: 'm1', itemId: 'i1', qty: 5, kind: 'Received' }) } }));
  }
  await assertSucceeds(getDocs(query(collection(as('store'), `tenants/${T}/buckets`), where('r', '==', 'o'))));
});
test('without the area nothing of the stock lists can be read or written: payroll-and-people admins, staff', async () => {
  for (const u of ['pay', 'staff']) {
    await assertFails(getDoc(doc(as(u), b('ops.items'))));
    await assertFails(updateDoc(doc(as(u), b('ops.items')), { 'f.i9': '"x"' }));
    await assertFails(setDoc(doc(as(u), b('ops.moves')), { t: 'o', r: 'o', f: {} }));
    await assertFails(getDocs(query(collection(as(u), `tenants/${T}/buckets`), where('r', '==', 'o'))));
  }
});
test('a storekeeper with only Operations cannot read payroll or people, or write them', async () => {
  await assertFails(getDoc(doc(as('store'), b('payroll'))));
  await assertFails(getDoc(doc(as('store'), `tenants/${T}/people/e4`)));
  await assertFails(setDoc(doc(as('store'), b('payroll')), { t: 'p', r: 'p', f: {} }));
  await assertFails(updateDoc(doc(as('store'), b('settings')), { 'f.modules': '{}' }));       // the Modules switch is a Settings-area change, not Operations
});
test('the stock lists cannot be relabelled to be readable by everyone', async () => {
  await assertFails(setDoc(doc(as('store'), b('ops.items')), { t: 'o', r: 'm', f: {} }));
});
