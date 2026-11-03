// Firestore rules for leave requests (one document each) and the safe team calendar: who reads what, nobody decides
// their own request, only an approver or HR decides, and the calendar matches the requests.  npm run test:rules
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch, serverTimestamp } = require('firebase/firestore');

let env;
const T = 'co1';
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@co1.my`, email_verified: true }).firestore();
const L = (db, id) => doc(db, `tenants/${T}/leaves/${id}`);
const C = (db, id) => doc(db, `tenants/${T}/leaveCal/${id}`);
const chain = (approver) => [{ level: 'L1', approver, backup: '', status: 'pending' }];
const req = (uid, empId, o = {}) => ({ empId, type: 'annual', from: '2026-12-01', to: '2026-12-02', half: '', days: 2, reason: 'Family trip', status: 'Pending', chain: chain('e2'), approverIds: ['e2'],
  v: 1, createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp(), ...o });
const cal = (r) => ({ empId: r.empId, from: r.from, to: r.to, half: r.half || '', status: r.status });
function create(db, uid, id, r) { const b = writeBatch(db); b.set(L(db, id), r); b.set(C(db, id), cal(r)); return b.commit(); }
function change(db, uid, id, v, patch, calNow) {
  const b = writeBatch(db); b.update(L(db, id), { ...patch, v: v + 1, updatedBy: uid, updatedAt: serverTimestamp() });
  if (calNow) b.set(C(db, id), calNow);
  return b.commit();
}

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-leave', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Co 1', status: 'active' });
    const user = (uid, o) => setDoc(doc(db, `users/${uid}`), { tenantId: T, ...o });
    await user('a', { roles: ['employee'], empId: 'e1' });          // the requester
    await user('head', { roles: ['employee'], empId: 'e2' });       // their department head (an approver, not an admin)
    await user('b', { roles: ['employee'], empId: 'e3' });          // a colleague
    await user('hr', { roles: ['admin', 'employee'], perms: ['time'], empId: 'e4' });
    await user('pay', { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e5' });
  });
});
test.after(async () => { await env.cleanup(); });

test('an employee files their own pending request, with its calendar copy', async () => {
  await assertSucceeds(create(as('a'), 'a', 'l1', req('a', 'e1')));
});

test('an employee cannot file a request already approved, for someone else, or with themselves as approver', async () => {
  await assertFails(create(as('a'), 'a', 'l1', req('a', 'e1', { status: 'Approved' })));
  await assertFails(create(as('a'), 'a', 'l2', req('a', 'e3')));
  await assertFails(create(as('a'), 'a', 'l3', req('a', 'e1', { approverIds: ['e1', 'e2'] })));
});

test('employee A’s request: read by A, the approver and HR; not by colleague B or an admin without the time area', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  await assertSucceeds(getDoc(L(as('a'), 'l1')));
  await assertSucceeds(getDoc(L(as('head'), 'l1')));
  await assertSucceeds(getDoc(L(as('hr'), 'l1')));
  await assertFails(getDoc(L(as('b'), 'l1')));
  await assertFails(getDoc(L(as('pay'), 'l1')));
});

test('the app’s queries: own requests, requests to approve, HR all; a colleague can’t list them', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  await assertSucceeds(getDocs(query(collection(as('a'), `tenants/${T}/leaves`), where('empId', '==', 'e1'))));
  await assertSucceeds(getDocs(query(collection(as('head'), `tenants/${T}/leaves`), where('approverIds', 'array-contains', 'e2'))));
  await assertSucceeds(getDocs(collection(as('hr'), `tenants/${T}/leaves`)));
  await assertFails(getDocs(collection(as('b'), `tenants/${T}/leaves`)));
  await assertFails(getDocs(query(collection(as('b'), `tenants/${T}/leaves`), where('empId', '==', 'e1'))));
});

test('the team calendar: everyone reads who is off; nobody adds an entry by hand or changes its dates', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  const c = (await getDoc(C(as('b'), 'l1'))).data();
  assert.deepEqual(Object.keys(c).sort(), ['empId', 'from', 'half', 'status', 'to'], 'no type, reason or MC on the calendar');
  await assertFails(setDoc(C(as('b'), 'fake'), { empId: 'e3', from: '2026-12-01', to: '2026-12-31', half: '', status: 'Approved' }));
  await assertFails(setDoc(C(as('a'), 'l1'), { empId: 'e1', from: '2026-12-01', to: '2026-12-20', half: '', status: 'Pending' }));
  await assertFails(setDoc(C(as('a'), 'l1'), { empId: 'e1', from: '2026-12-01', to: '2026-12-02', half: '', status: 'Pending', reason: 'x' }));
});

test('an employee cannot approve their own request; they may cancel it while pending', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  await assertFails(change(as('a'), 'a', 'l1', 1, { status: 'Approved' }, { ...cal(req('a', 'e1')), status: 'Approved' }));
  await assertFails(change(as('a'), 'a', 'l1', 1, { from: '2026-11-30' }));
  await assertSucceeds(change(as('a'), 'a', 'l1', 1, { status: 'Cancelled' }, { ...cal(req('a', 'e1')), status: 'Cancelled' }));
});

test('the approver decides (status and chain only), once, and can’t change the dates or approvers', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  await assertFails(change(as('head'), 'head', 'l1', 1, { approverIds: ['e2', 'e3'] }));
  await assertFails(change(as('head'), 'head', 'l1', 1, { to: '2026-12-10' }));
  await assertFails(change(as('b'), 'b', 'l1', 1, { status: 'Approved' }, { ...cal(req('a', 'e1')), status: 'Approved' }));   // not an approver
  await assertSucceeds(change(as('head'), 'head', 'l1', 1, { status: 'Approved', chain: [{ ...chain('e2')[0], status: 'approved', by: 'e2' }] }, { ...cal(req('a', 'e1')), status: 'Approved' }));
  await assertFails(change(as('head'), 'head', 'l1', 2, { status: 'Rejected' }));   // already decided
});

test('two decisions at once: the out-of-date one is refused', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  await assertSucceeds(change(as('hr'), 'hr', 'l1', 1, { status: 'Rejected' }, { ...cal(req('a', 'e1')), status: 'Rejected' }));
  await assertFails(change(as('head'), 'head', 'l1', 1, { status: 'Approved' }, { ...cal(req('a', 'e1')), status: 'Approved' }));
});

test('HR decides others’ leave, not their own; only HR deletes', async () => {
  await create(as('a'), 'a', 'l1', req('a', 'e1'));
  await create(as('hr'), 'hr', 'l2', req('hr', 'e4', { approverIds: ['e2'] }));
  await assertSucceeds(change(as('hr'), 'hr', 'l1', 1, { status: 'Approved' }, { ...cal(req('a', 'e1')), status: 'Approved' }));
  await assertFails(change(as('hr'), 'hr', 'l2', 1, { status: 'Approved' }, { ...cal(req('hr', 'e4')), status: 'Approved' }));
  await assertFails(deleteDoc(L(as('a'), 'l1')));
  const h = as('hr'), b = writeBatch(h); b.delete(L(h, 'l1')); b.delete(C(h, 'l1'));
  await assertSucceeds(b.commit());
});

test('the real js/leave-store.js: files a request, the approver approves, a colleague can’t', async () => {
  const app = (uid, empId) => {
    const db = as(uid), state = { leaves: [] }, toasts = [];
    const forWrite = (v) => (v && v.__now ? serverTimestamp() : Array.isArray(v) ? Array.from(v, forWrite) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, forWrite(x)])) : v);
    const cloud = { live: true, profile: { uid, empId }, async recordWrite(ops) { const b = writeBatch(db); ops.forEach(({ op, path: p, data }) => { const ref = doc(db, `tenants/${T}/${p}`); if (op === 'delete') b.delete(ref); else if (op === 'update') b.update(ref, forWrite(data)); else b.set(ref, forWrite(data)); }); try { await b.commit(); return { ok: true }; } catch (e) { return { error: 'changed' }; } } };
    const sb = { window: {}, console }; vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'leave-store.js'), 'utf8'), sb);
    return { store: sb.window.AllurusLeaveStore.install({ toast: (m) => toasts.push(m) }, () => cloud), toasts };
  };
  const l = { id: 'l9', empId: 'e1', type: 'annual', from: '2026-12-01', to: '2026-12-01', half: '', days: 1, reason: '', status: 'Pending', created: '2026-11-03', chain: chain('e2') };
  const A = app('a', 'e1');
  assert.ok((await A.store.created(l)).ok);
  const B = app('b', 'e3'), H = app('head', 'e2');
  assert.equal((await B.store.changed({ ...l, status: 'Approved' }, ['status'])).error, 'changed');
  assert.ok((await H.store.changed({ ...l, v: 1, status: 'Approved', chain: [{ ...l.chain[0], status: 'approved', by: 'e2' }] }, ['chain', 'status'])).ok);
  const after = (await getDoc(L(as('a'), 'l9'))).data();
  assert.equal(after.status, 'Approved'); assert.deepEqual(after.approverIds, ['e2']);
  assert.equal((await getDoc(C(as('b'), 'l9'))).data().status, 'Approved');
});
