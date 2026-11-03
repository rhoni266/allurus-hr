// Firestore rules, privacy phase A: sensitive lists are no longer readable or writable by every member.
// Grievances, candidates and hiring requests → talent area; statutory → payroll; activity log → admins; documents
// and change requests → one bucket per person (the person and the people area); photos and files can't be listed.
//   npm run test:rules        (needs Java 11+). Fake companies only.
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const B = (db, id) => doc(db, `tenants/${T}/buckets/${id}`);
const write = (db, id, r, f = { x: '"1"' }) => setDoc(B(db, id), { t: 'a', r, f }, { merge: true });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-privacy-a', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('staffA', { roles: ['employee'], empId: 'e1' });
    await user('staffB', { roles: ['employee'], empId: 'e2' });
    await user('talent', { roles: ['admin', 'employee'], perms: ['talent'], empId: 'e3' });
    await user('people', { roles: ['admin', 'employee'], perms: ['people'], empId: 'e4' });
    await user('payroll', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
    const put = (id, r) => setDoc(B(db, id), { t: 'a', r, f: { a: '"x"' } });
    await put('grievances', 't'); await put('candidates', 't'); await put('requisitions', 't');
    await put('statutory', 'p'); await put('activity', 'a'); await put('leaves', 'm');
    await put('documents~e1', 'u:people:e1'); await put('documents~e2', 'u:people:e2'); await put('editRequests~e1', 'u:people:e1');
    await setDoc(doc(db, `tenants/${T}/blobs/b1`), { d: 'data:image/png;base64,AAAA' });
  });
});
test.after(async () => { await env.cleanup(); });

test('staff cannot read grievances, candidates, hiring requests, statutory filings or the activity log', async () => {
  const db = as('staffA');
  for (const id of ['grievances', 'candidates', 'requisitions', 'statutory', 'activity']) await assertFails(getDoc(B(db, id)), id);
  await assertSucceeds(getDoc(B(db, 'leaves')));   // still shared until phase B
});

test('the right admins read them: talent area the talent lists, payroll the statutory, any admin the activity log', async () => {
  for (const id of ['grievances', 'candidates', 'requisitions']) { await assertSucceeds(getDoc(B(as('talent'), id))); await assertFails(getDoc(B(as('people'), id))); }
  await assertSucceeds(getDoc(B(as('payroll'), 'statutory'))); await assertFails(getDoc(B(as('talent'), 'statutory')));
  await assertSucceeds(getDoc(B(as('people'), 'activity')));
});

test('staff cannot write grievances, candidates, hiring requests or the activity log; the talent area can', async () => {
  for (const id of ['grievances', 'candidates', 'requisitions']) { await assertFails(write(as('staffA'), id, 't'), id); await assertSucceeds(write(as('talent'), id, 't')); }
  await assertFails(write(as('staffA'), 'activity', 'a'));
  await assertSucceeds(write(as('people'), 'activity', 'a'));
});

test('a person reads their own documents and change requests, not a colleague’s', async () => {
  const a = as('staffA');
  await assertSucceeds(getDoc(B(a, 'documents~e1')));
  await assertSucceeds(getDoc(B(a, 'editRequests~e1')));
  await assertFails(getDoc(B(as('staffB'), 'documents~e1')));
  await assertFails(getDoc(B(a, 'documents~e2')));
});

test('the people area reads everyone’s documents; other admins do not', async () => {
  await assertSucceeds(getDoc(B(as('people'), 'documents~e1')));
  await assertSucceeds(getDoc(B(as('people'), 'documents~e2')));
  await assertFails(getDoc(B(as('talent'), 'documents~e1')));
});

test('the app’s queries: staff get their own classes, the people area its range; staff cannot query the range', async () => {
  await assertSucceeds(getDocs(query(collection(as('staffA'), `tenants/${T}/buckets`), where('r', 'in', ['m', 'd:e1', 'u:people:e1']))));
  await assertFails(getDocs(query(collection(as('staffA'), `tenants/${T}/buckets`), where('r', 'in', ['m', 'u:people:e2']))));
  await assertSucceeds(getDocs(query(collection(as('people'), `tenants/${T}/buckets`), where('r', '>=', 'u:people:'), where('r', '<', 'u:people;'))));
  await assertFails(getDocs(query(collection(as('staffA'), `tenants/${T}/buckets`), where('r', '>=', 'u:people:'), where('r', '<', 'u:people;'))));
  await assertSucceeds(getDocs(query(collection(as('talent'), `tenants/${T}/buckets`), where('r', 'in', ['m', 'a', 't']))));
});

test('a person writes only their own documents bucket, with the right class; the people area writes any', async () => {
  await assertSucceeds(write(as('staffA'), 'documents~e1', 'u:people:e1'));
  await assertFails(write(as('staffA'), 'documents~e2', 'u:people:e2'));
  await assertFails(write(as('staffA'), 'documents~e1', 'm'));            // can't make it readable by everyone
  await assertSucceeds(write(as('people'), 'documents~e2', 'u:people:e2'));
  await assertSucceeds(write(as('staffA'), 'editRequests~e1', 'u:people:e1'));
  await assertFails(write(as('staffB'), 'editRequests~e1', 'u:people:e1'));
});

test('photos and files: one at a time by id, never listed', async () => {
  await assertSucceeds(getDoc(doc(as('staffA'), `tenants/${T}/blobs/b1`)));
  await assertFails(getDocs(collection(as('staffA'), `tenants/${T}/blobs`)));
  await assertFails(getDocs(collection(as('people'), `tenants/${T}/blobs`)));
});
