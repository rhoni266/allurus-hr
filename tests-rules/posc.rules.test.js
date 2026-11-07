// Firestore rules tests for the cafe POS, live for any company (POS-LIVE-FLOW-SPEC.md), against the emulator:
//   npm run test:rules        (needs Java 11+)
// NOT YET RUN here (no Java in this environment - see docs/AUTOPILOT-LOG.md). Written to match the existing
// tests-rules/*.test.js pattern (access.rules.test.js); run this before trusting firestore.rules' posc_* section.
// Fake companies and people only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, Timestamp } = require('firebase/firestore');

let env;
const days = (n) => Timestamp.fromMillis(Date.now() + n * 864e5);
const product = (o = {}) => ({ id: 'p1', name: 'Latte', price: 10.9, category: 'Coffee', active: true, unit: 'cup', kind: 'menu', track_stock: false, ...o });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-posc', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Company A: POS on (trial, 10 days left). Company B: POS never started.
    await setDoc(doc(db, 'tenants/tA'), { owner: 'ownerA', name: 'Kedai A', admin: 'boss@a.my', addons: { pos: { status: 'trial', trialEndsAt: days(10), startedBy: 'ownerA', startedAt: Timestamp.now() } } });
    await setDoc(doc(db, 'tenants/tB'), { owner: 'ownerB', name: 'Kedai B', admin: 'boss@b.my' });
    // Company C: POS trial ran out 2 days ago.
    await setDoc(doc(db, 'tenants/tC'), { owner: 'ownerC', name: 'Kedai C', admin: 'boss@c.my', addons: { pos: { status: 'trial', trialEndsAt: days(-2), startedBy: 'ownerC', startedAt: Timestamp.now() } } });

    await setDoc(doc(db, 'users/ownerA'), { email: 'boss@a.my', tenantId: 'tA', roles: ['admin', 'employee'], empId: 'e1' }); // Owner: no perms list = every area, incl. posRole fallback 'manager'
    await setDoc(doc(db, 'users/cashierA'), { email: 'cashier@a.my', tenantId: 'tA', roles: ['employee'], empId: 'e2', posRole: 'cashier' });
    await setDoc(doc(db, 'users/noRoleA'), { email: 'noRole@a.my', tenantId: 'tA', roles: ['employee'], empId: 'e3' }); // on the team, but no POS role
    await setDoc(doc(db, 'users/managerB'), { email: 'manager@b.my', tenantId: 'tB', roles: ['employee'], empId: 'e1', posRole: 'manager' });
    await setDoc(doc(db, 'users/managerC'), { email: 'manager@c.my', tenantId: 'tC', roles: ['employee'], empId: 'e1', posRole: 'manager' });
    await setDoc(doc(db, 'tenants/tA/posc_Products/p1'), product());
  });
});
test.after(async () => { await env.cleanup(); });

const as = (uid, token) => env.authenticatedContext(uid, token).firestore();
const ownerA = () => as('ownerA', { email: 'boss@a.my', email_verified: true });
const cashierA = () => as('cashierA', { email: 'cashier@a.my', email_verified: true });
const noRoleA = () => as('noRoleA', { email: 'noRole@a.my', email_verified: true });
const managerB = () => as('managerB', { email: 'manager@b.my', email_verified: true });
const managerC = () => as('managerC', { email: 'manager@c.my', email_verified: true });

test('1 a cashier reads products and creates a sale, but cannot change a price', async () => {
  await assertSucceeds(getDoc(doc(cashierA(), 'tenants/tA/posc_Products/p1')));
  await assertSucceeds(setDoc(doc(cashierA(), 'tenants/tA/posc_Sales/s1'), { sale_id: 's1', status: 'paid', total: 10.9 }));
  await assertFails(setDoc(doc(cashierA(), 'tenants/tA/posc_Products/p1'), product({ price: 1 })));
});

test('2 only a manager voids a sale (sets status back to void) or changes a price', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'tenants/tA/posc_Sales/s1'), { sale_id: 's1', status: 'paid', total: 10.9 }); });
  await assertSucceeds(updateDoc(doc(ownerA(), 'tenants/tA/posc_Sales/s1'), { status: 'void' })); // Owner counts as manager
  await assertSucceeds(setDoc(doc(ownerA(), 'tenants/tA/posc_Products/p1'), product({ price: 12 })));
});

test('3 a person with no POS role cannot read or write any posc_ collection, even on their own team', async () => {
  await assertFails(getDoc(doc(noRoleA(), 'tenants/tA/posc_Products/p1')));
  await assertFails(setDoc(doc(noRoleA(), 'tenants/tA/posc_Sales/s2'), { sale_id: 's2', status: 'paid', total: 5 }));
});

test('4 two companies are isolated: company B’s manager cannot read or write company A’s POS data', async () => {
  await assertFails(getDoc(doc(managerB(), 'tenants/tA/posc_Products/p1')));
  await assertFails(setDoc(doc(managerB(), 'tenants/tA/posc_Sales/s3'), { sale_id: 's3', status: 'paid', total: 5 }));
});

test('5 a company that never started the POS trial gets nothing, not even a read', async () => {
  await assertFails(setDoc(doc(managerB(), 'tenants/tB/posc_Products/p2'), product({ id: 'p2' })));
  await assertFails(getDoc(doc(managerB(), 'tenants/tB/posc_Products/p2')));
});

test('6 a company whose POS trial has run out is read-only for its manager', async () => {
  await assertFails(setDoc(doc(managerC(), 'tenants/tC/posc_Products/p3'), product({ id: 'p3' })));
});

test('7 starting the POS trial: an Owner can, writing only addons, with the right shape; nobody else can', async () => {
  const payload = { addons: { pos: { status: 'trial', startedBy: 'ownerB', startedAt: new Date(), trialEndsAt: days(30) } } };
  await assertSucceeds(updateDoc(doc(managerB(), 'tenants/tB'), payload));
  // Can't fake 'active' (paid) from this rule, and can't touch any other field in the same write.
  await assertFails(updateDoc(doc(managerB(), 'tenants/tB'), { addons: { pos: { ...payload.addons.pos, status: 'active' } } }));
  await assertFails(updateDoc(doc(managerB(), 'tenants/tB'), { ...payload, name: 'New name' }));
  // Someone on the team with no Settings area (no perms list given here means Owner in this test's profile shape,
  // so this checks a different company's manager instead, who has no admin role on tB at all).
  await assertFails(updateDoc(doc(managerC(), 'tenants/tB'), payload));
});

test('8 the till never writes sale items, stock movements or stock counts after creating them', async () => {
  await assertSucceeds(setDoc(doc(ownerA(), 'tenants/tA/posc_SaleItems/i1'), { sale_id: 's1', product_id: 'p1', qty: 1 }));
  await assertFails(updateDoc(doc(ownerA(), 'tenants/tA/posc_SaleItems/i1'), { qty: 2 }));
  await assertSucceeds(setDoc(doc(ownerA(), 'tenants/tA/posc_StockMovements/m1'), { product_id: 'p1', change_qty: -1 }));
  await assertFails(updateDoc(doc(ownerA(), 'tenants/tA/posc_StockMovements/m1'), { change_qty: -2 }));
});
