// Firestore rules tests for role access (areas per person), against the emulator:
//   npm run test:rules        (needs Java 11+)
// Fake companies and people only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteField } = require('firebase/firestore');

let env;
const T = { HR: ['people', 'time', 'payroll', 'claims', 'talent', 'settings'], PAY: ['people', 'time', 'payroll', 'claims'], FIN: ['finance', 'claims'], OPS: ['operations'],
  OUTLET: ['pos', 'operations', 'time'], MGR: ['people', 'time', 'payroll', 'claims', 'finance', 'operations', 'settings'] };
// One bucket per area, with the read class the rules expect (js/cloud-map.js readClass).
const B = { payroll: ['payroll', 'p'], finance: ['finance.bills', 'f'], operations: ['ops.stock', 'o'], talent: ['candidates', 't'], time: ['attendance~2026-11~e9', 'u:time:e9'], people: ['documents~e9', 'u:people:e9'] };
const AREAS = Object.keys(B);

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-roles', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/tA'), { owner: 'owner', name: 'Syarikat A' });
    const u = (uid, o) => setDoc(doc(db, `users/${uid}`), { email: `${uid}@a.my`, tenantId: 'tA', roles: ['admin', 'employee'], empId: 'e-' + uid, ...o });
    await u('owner', {});
    await u('owner2', {});
    await u('hr', { perms: T.HR });
    await u('pay', { perms: T.PAY });
    await u('fin', { perms: T.FIN });
    await u('ops', { perms: T.OPS });
    await u('outlet', { perms: T.OUTLET });
    await u('mgr', { perms: T.MGR });
    await u('claimsOnly', { perms: ['claims'] });
    await u('emp', { roles: ['employee'] });
    await u('icStaff', { roles: ['employee'], email: '900101015555.ta.g1@staff.allurus.invalid', via: 'ic' });
    for (const [b, r] of Object.values(B)) await setDoc(doc(db, `tenants/tA/buckets/${b}`), { t: 'a', r, f: { x: 1 } });
    await setDoc(doc(db, 'tenants/tA/people/e9'), { first: 'Siti', ic: '900101015555', basic: 4000 });
    await setDoc(doc(db, 'tenants/tA/payslips/e9'), { lines: [] });
  });
});
test.after(async () => { await env.cleanup(); });

const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@a.my`, email_verified: true }).firestore();
const read = (uid, area) => getDoc(doc(as(uid), `tenants/tA/buckets/${B[area][0]}`));
const write = (uid, area) => setDoc(doc(as(uid), `tenants/tA/buckets/${B[area][0]}`), { t: 'a', r: B[area][1], f: { x: 2 } });

// Which of the bucket areas each role may read and write. (Time and people buckets here belong to e9, not the user.)
const EXPECT = {
  owner: AREAS, hr: ['payroll', 'talent', 'time', 'people'], pay: ['payroll', 'time', 'people'], fin: ['finance'], ops: ['operations'],
  outlet: ['operations', 'time'], mgr: ['payroll', 'finance', 'operations', 'time', 'people'], claimsOnly: [], emp: [],
};
for (const [uid, ok] of Object.entries(EXPECT)) {
  test(`${uid}: reads and writes only its own areas`, async () => {
    for (const a of AREAS) {
      if (ok.includes(a)) { await assertSucceeds(read(uid, a)); await assertSucceeds(write(uid, a)); }
      else { await assertFails(read(uid, a)); await assertFails(write(uid, a)); }
    }
  });
}

test('staff records (pay, IC) and payslips: never Finance, Operations, Outlet or a Claims-only person', async () => {
  for (const uid of ['fin', 'ops', 'outlet', 'claimsOnly', 'emp']) {
    await assertFails(getDoc(doc(as(uid), 'tenants/tA/people/e9')));
    await assertFails(getDoc(doc(as(uid), 'tenants/tA/payslips/e9')));
  }
  for (const uid of ['owner', 'hr', 'pay', 'mgr']) await assertSucceeds(getDoc(doc(as(uid), 'tenants/tA/people/e9')));
});

test('unticking an area refuses it straight away', async () => {
  await assertSucceeds(read('hr', 'payroll'));
  await assertSucceeds(updateDoc(doc(as('owner'), 'users/hr'), { perms: ['people', 'settings'] }));
  await assertFails(read('hr', 'payroll'));
});

test('giving: only areas you have, and Owner only by an Owner', async () => {
  await assertSucceeds(updateDoc(doc(as('hr'), 'users/emp'), { roles: ['admin', 'employee'], perms: ['people', 'time'] }));
  await assertFails(updateDoc(doc(as('hr'), 'users/emp'), { roles: ['admin', 'employee'], perms: ['finance'] }));
  await assertFails(updateDoc(doc(as('hr'), 'users/emp'), { roles: ['admin', 'employee'], perms: deleteField() })); // no list = Owner
  await assertFails(updateDoc(doc(as('mgr'), 'users/fin'), { perms: ['finance', 'claims', 'talent'] })); // mgr has no talent
  await assertSucceeds(updateDoc(doc(as('owner'), 'users/emp'), { roles: ['admin', 'employee'] }));      // Owner makes an Owner
});

test('nobody changes their own access, and a non-Owner can’t lower an Owner (the last Owner stays)', async () => {
  await assertFails(updateDoc(doc(as('owner'), 'users/owner'), { perms: ['people'] }));
  await assertFails(updateDoc(doc(as('hr'), 'users/owner'), { perms: ['people'] }));
  await assertFails(updateDoc(doc(as('hr'), 'users/owner'), { disabled: true }));
  await assertSucceeds(updateDoc(doc(as('owner'), 'users/owner2'), { perms: ['people'] }));               // another Owner can
});

test('an IC staff member (no email) can be made Finance and then reads the books', async () => {
  const ic = () => env.authenticatedContext('icStaff', { email: '900101015555.ta.g1@staff.allurus.invalid' }).firestore();
  await assertFails(getDoc(doc(ic(), `tenants/tA/buckets/${B.finance[0]}`)));
  await assertSucceeds(updateDoc(doc(as('owner'), 'users/icStaff'), { roles: ['admin', 'employee'], perms: ['finance', 'claims'] }));
  await assertSucceeds(getDoc(doc(ic(), `tenants/tA/buckets/${B.finance[0]}`)));
  await assertFails(getDoc(doc(ic(), 'tenants/tA/people/e9')));
});

test('POS role: an admin with settings gives it; nobody gives it to themselves', async () => {
  await assertSucceeds(updateDoc(doc(as('owner'), 'users/emp'), { posRole: 'cashier' }));
  await assertFails(updateDoc(doc(as('emp'), 'users/emp'), { posRole: 'manager' }));
  await assertFails(updateDoc(doc(as('owner'), 'users/emp'), { posRole: 'boss' }));
});

test('Owner back to a list: perms removed means every area', async () => {
  await assertSucceeds(updateDoc(doc(as('owner'), 'users/fin'), { perms: deleteField() }));
  await assertSucceeds(read('fin', 'payroll'));
  assert.ok(true);
});
