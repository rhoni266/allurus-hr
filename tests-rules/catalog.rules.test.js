// Firestore rules tests for the industries/features system, run against the local emulator:
//   npm run test:rules        (needs Java 11+ for the Firestore emulator)
// Kept out of `npm test` (tests/), which runs without the emulator.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where, serverTimestamp, Timestamp } = require('firebase/firestore');

let env;
const SUPER = { role: 'superadmin', email: 'boss@allurus.my', email_verified: true };

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'industries/fleet'), { slug: 'fleet', name: 'Fleet and logistics', visible: true });
    await setDoc(doc(db, 'industries/secret'), { slug: 'secret', name: 'Hidden', visible: false });
    await setDoc(doc(db, 'features/pos'), { key: 'pos', name: 'Point of sale' });
    await setDoc(doc(db, 'tenants/t1'), { owner: 'owner1', name: 'Syarikat Satu' });
    await setDoc(doc(db, 'users/owner1'), { tenantId: 't1', roles: ['admin'] });
    await setDoc(doc(db, 'leads/l1'), { businessName: 'Kedai', status: 'new' });
    await setDoc(doc(db, 'tenantFeatureOverrides/t1_pos'), { tenantId: 't1', featureId: 'pos', mode: 'add' });
  });
});
test.after(async () => { await env.cleanup(); });

const superDb = () => env.authenticatedContext('super1', SUPER).firestore();
const ownerDb = () => env.authenticatedContext('owner1', { email: 'owner@co.my', email_verified: true }).firestore();
const anonDb = () => env.unauthenticatedContext().firestore();

// A superadmin change and its audit entry, saved together.
async function auditedSet(db, uid, entityType, path_, data) {
  const b = writeBatch(db);
  const a = doc(collection(db, 'auditLog'));
  b.set(a, { actorUid: uid, actorEmail: 'boss@allurus.my', action: 'update', entityType, entityId: path_.split('/')[1], before: null, after: data, createdAt: serverTimestamp() });
  b.set(doc(db, path_), { ...data, lastAuditId: a.id }, { merge: true });
  return b.commit();
}

test('public can read visible industries, features and links; not hidden industries', async () => {
  const db = anonDb();
  await assertSucceeds(getDocs(query(collection(db, 'industries'), where('visible', '==', true))));
  await assertSucceeds(getDoc(doc(db, 'features/pos')));
  await assertSucceeds(getDocs(collection(db, 'industryFeatures')));
  await assertFails(getDoc(doc(db, 'industries/secret')));
  await assertFails(getDocs(collection(db, 'industries')));   // unfiltered list would expose hidden ones
});

test('superadmin links POS to Fleet and logistics, with an audit entry', async () => {
  await assertSucceeds(auditedSet(superDb(), 'super1', 'industryFeature', 'industryFeatures/fleet_pos',
    { industryId: 'fleet', featureId: 'pos', linked: true, showPublic: true, isHeadline: false, customLabel: 'Counter and parcel POS', order: 5 }));
});

test('superadmin write without its audit entry is refused', async () => {
  await assertFails(setDoc(doc(superDb(), 'industryFeatures/fleet_kds'), { industryId: 'fleet', featureId: 'kds', linked: true }));
});

test('an audit entry about a different document does not count', async () => {
  const db = superDb();
  const b = writeBatch(db);
  const a = doc(collection(db, 'auditLog'));
  b.set(a, { actorUid: 'super1', action: 'update', entityType: 'industryFeature', entityId: 'retail_pos', before: null, after: {}, createdAt: serverTimestamp() });
  b.set(doc(db, 'industryFeatures/fleet_qr-order'), { industryId: 'fleet', featureId: 'qr-order', linked: true, lastAuditId: a.id });
  await assertFails(b.commit());
});

test('company owners and visitors cannot change the catalogue', async () => {
  await assertFails(auditedSet(ownerDb(), 'owner1', 'industryFeature', 'industryFeatures/fleet_pos', { industryId: 'fleet', featureId: 'pos', linked: true }));
  await assertFails(setDoc(doc(anonDb(), 'features/hack'), { key: 'hack' }));
  await assertFails(updateDoc(doc(ownerDb(), 'industries/fleet'), { name: 'Mine' }));
});

test('nothing in the catalogue can be deleted, even by superadmin', async () => {
  await assertFails(deleteDoc(doc(superDb(), 'features/pos')));
});

test('audit log: superadmin reads; nobody edits or deletes; others cannot read', async () => {
  await assertSucceeds(getDocs(collection(superDb(), 'auditLog')));
  await assertFails(getDocs(collection(ownerDb(), 'auditLog')));
  const snap = await getDocs(collection(superDb(), 'auditLog'));
  const id = snap.docs[0].id;
  await assertFails(updateDoc(doc(superDb(), `auditLog/${id}`), { action: 'nothing happened' }));
  await assertFails(deleteDoc(doc(superDb(), `auditLog/${id}`)));
});

test('company owner cannot set their own industries; superadmin can (audited)', async () => {
  await assertFails(updateDoc(doc(ownerDb(), 'tenants/t1'), { industryIds: ['fnb'] }));
  await assertSucceeds(auditedSet(superDb(), 'super1', 'tenant', 'tenants/t1', { industryIds: ['fleet'] }));
  await assertFails(auditedSet(superDb(), 'super1', 'tenant', 'tenants/t1', { name: 'Renamed by superadmin' }));
});

test('tenant overrides: the company reads its own; others cannot', async () => {
  await assertSucceeds(getDoc(doc(ownerDb(), 'tenantFeatureOverrides/t1_pos')));
  await assertFails(getDoc(doc(anonDb(), 'tenantFeatureOverrides/t1_pos')));
});

const lead = (extra = {}) => ({ businessName: 'Kopitiam Ali', contactName: 'Ali', phone: '0123456789', industryIds: ['fnb'], featureInterests: ['pos'],
  teamSize: '2 to 10 people', consent: true, status: 'new', createdAt: Timestamp.now(), ...extra });

test('leads: anyone can add a valid lead; nobody but superadmin reads them', async () => {
  await assertSucceeds(setDoc(doc(collection(anonDb(), 'leads')), lead()));
  await assertFails(setDoc(doc(collection(anonDb(), 'leads')), lead({ consent: false })));
  await assertFails(setDoc(doc(collection(anonDb(), 'leads')), lead({ status: 'won' })));
  await assertFails(setDoc(doc(collection(anonDb(), 'leads')), lead({ admin: true })));
  await assertFails(getDoc(doc(anonDb(), 'leads/l1')));
  await assertFails(getDoc(doc(ownerDb(), 'leads/l1')));
  await assertSucceeds(getDoc(doc(superDb(), 'leads/l1')));
  await assertSucceeds(auditedSet(superDb(), 'super1', 'lead', 'leads/l1', { status: 'contacted' }));
});
