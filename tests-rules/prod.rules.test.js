// Firestore rules for the daily production commission (docs/PRODUCTION-COMMISSION-SPEC.md): only where the company has the
// addon; written by the operations or payroll area; a finalised month is locked; staff read only their own share; nothing is
// deleted; support never reads it; the superadmin switches the addon on with an audit entry.  npm run test:rules
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, writeBatch, serverTimestamp } = require('firebase/firestore');

let env;
const T = 'co1', OFF = 'co2';
const as = (uid, extra = {}) => env.authenticatedContext(uid, { email: `${uid}@x.my`, email_verified: true, ...extra }).firestore();
const sa = () => as('sa', { role: 'superadmin' });
const D = (db, d, t = T) => doc(db, `tenants/${t}/prodDays/${d}`);
const S = (db, id, t = T) => doc(db, `tenants/${t}/prodShares/${id}`);
const day = (date, o = {}) => ({ date, units: '2000', unit: 'pcs', rate: '0.05', poolSen: 10000, shareSen: 400, remainderSen: 0, count: 25, attendees: ['e5', 'e6'], excluded: [{ id: 'e7', reason: 'No check-in' }], flags: [], sig: 'e5,e6', note: '', savedBy: 'e3', savedAt: '2026-11-10T10:00:00Z', v: 1, ...o });
const share = (date, empId, o = {}) => ({ date, empId, status: 'paid', shareSen: 400, units: '2000', unit: 'pcs', poolSen: 10000, count: 25, reason: '', ...o });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-allurus-prod', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, `tenants/${T}`), { owner: 'own', name: 'Major', status: 'active', addons: { prodCommission: true } });
    await setDoc(doc(db, `tenants/${OFF}`), { owner: 'own2', name: 'Other', status: 'active' });
    const user = (uid, t, o) => setDoc(doc(db, `users/${uid}`), { tenantId: t, ...o });
    await user('own', T, { roles: ['admin', 'employee'], empId: 'e1' });
    await user('ops', T, { roles: ['admin', 'employee'], perms: ['operations'], empId: 'e3' });
    await user('pay', T, { roles: ['admin', 'employee'], perms: ['payroll'], empId: 'e4' });
    await user('hr', T, { roles: ['admin', 'employee'], perms: ['people'], empId: 'e2' });
    await user('a', T, { roles: ['employee'], empId: 'e5' });
    await user('b', T, { roles: ['employee'], empId: 'e6' });
    await user('sup', T, { roles: ['employee'], empId: 'e8', prodEntry: true });
    await user('sup2', T, { roles: ['employee'], empId: 'e10', prodEntry: true });
    await user('setadm', T, { roles: ['admin', 'employee'], perms: ['settings'], empId: 'e9' });
    await setDoc(doc(db, `tenants/${T}/buckets/settings`), { t: 's', r: 'm', f: { prod: '{"products":[{"id":"pp-1","name":"A","unit":"jar","rate":"0.05","on":true}],"depts":["d1"]}' } });
    await user('off', OFF, { roles: ['admin', 'employee'], empId: 'e1' });
    await setDoc(doc(db, `tenants/${T}/prodDays/2026-11-09`), day('2026-11-09'));
    await setDoc(doc(db, `tenants/${T}/prodShares/2026-11-09~e5`), share('2026-11-09', 'e5'));
    await setDoc(doc(db, `tenants/${T}/prodShares/2026-11-09~e6`), share('2026-11-09', 'e6'));
  });
});
test.after(async () => { await env.cleanup(); });

// One save the way the app makes it: the day and each person's share in one batch.
const saveDay = (db, date, d = day(date, { savedBy: 'e3' }), shares = [share(date, 'e5'), share(date, 'e6')]) => {
  const b = writeBatch(db); b.set(D(db, date), d); shares.forEach((s) => b.set(S(db, `${s.date}~${s.empId}`), s)); return b.commit();
};

test('the operations or payroll area keys in a day (with the person’s own share records); nobody else', async () => {
  await assertSucceeds(saveDay(as('ops'), '2026-11-10'));
  await assertSucceeds(saveDay(as('pay'), '2026-11-11', day('2026-11-11', { savedBy: 'e4' })));
  await assertSucceeds(saveDay(as('own'), '2026-11-12', day('2026-11-12', { savedBy: 'e1' })));
  await assertFails(saveDay(as('hr'), '2026-11-13', day('2026-11-13', { savedBy: 'e2' })));                    // people area only: no
  await assertFails(saveDay(as('a'), '2026-11-13', day('2026-11-13', { savedBy: 'e5' })));                      // staff: no
  await assertFails(saveDay(as('ops'), '2026-11-13', day('2026-11-13', { savedBy: 'e99' })));                   // in someone else's name
  await assertFails(setDoc(D(as('ops'), '2026-11-14'), day('2026-11-15', { savedBy: 'e3' })));                  // the date must match the id
  await assertFails(setDoc(D(as('ops'), '2026-11-14'), { ...day('2026-11-14', { savedBy: 'e3' }), secret: 'x' })); // only the known fields
});

test('a company without the addon has no access at all: no read, no write', async () => {
  await assertFails(saveDay(as('off'), '2026-11-10', day('2026-11-10', { savedBy: 'e1' })));
  await assertFails(getDocs(collection(as('off'), `tenants/${OFF}/prodDays`)));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), `tenants/${T}`), { addons: { prodCommission: false } }));
  await assertFails(saveDay(as('ops'), '2026-11-10'));                                                          // switched off: stops at once
  await assertFails(getDoc(D(as('ops'), '2026-11-09')));
});

test('staff read only their own share, and never the attendee list; admins read all', async () => {
  await assertSucceeds(getDoc(S(as('a'), '2026-11-09~e5')));
  await assertFails(getDoc(S(as('a'), '2026-11-09~e6')));                                                       // a colleague's
  await assertFails(getDoc(D(as('a'), '2026-11-09')));                                                          // the day, with names
  await assertFails(getDocs(collection(as('a'), `tenants/${T}/prodDays`)));
  await assertFails(getDocs(collection(as('a'), `tenants/${T}/prodShares`)));                                   // an unfiltered list
  await assertSucceeds(getDocs(query(collection(as('a'), `tenants/${T}/prodShares`), where('empId', '==', 'e5'))));   // the app's own query
  await assertFails(getDocs(query(collection(as('a'), `tenants/${T}/prodShares`), where('empId', '==', 'e6'))));
  await assertSucceeds(getDoc(D(as('ops'), '2026-11-09')));
  await assertSucceeds(getDocs(collection(as('pay'), `tenants/${T}/prodShares`)));
  await assertFails(getDoc(D(as('hr'), '2026-11-09')));                                                         // people area: no
  await assertFails(getDoc(S(as('hr'), '2026-11-09~e5')));
});

test('staff cannot write shares or days; nobody can delete', async () => {
  await assertFails(setDoc(S(as('a'), '2026-11-10~e5'), share('2026-11-10', 'e5', { shareSen: 99999 })));
  await assertFails(updateDoc(S(as('a'), '2026-11-09~e5'), { shareSen: 99999 }));
  await assertFails(deleteDoc(D(as('ops'), '2026-11-09')));
  await assertFails(deleteDoc(S(as('ops'), '2026-11-09~e5')));
  await assertFails(deleteDoc(D(as('own'), '2026-11-09')));
  await assertSucceeds(updateDoc(D(as('ops'), '2026-11-09'), { units: '0', poolSen: 0, shareSen: 0, v: 2, note: 'removed: wrong day' }));   // "remove" = units 0 with a note
});

test('finalising payroll locks the month: the days and shares can’t change; only payroll writes the lock', async () => {
  const lock = (db, m = '2026-11') => setDoc(doc(db, `tenants/${T}/prodLocks/${m}`), { month: m, by: 'u', at: serverTimestamp() });
  await assertFails(lock(as('ops')));                                                                           // the operations area can't lock
  await assertFails(lock(as('a')));
  await assertSucceeds(lock(as('pay')));
  await assertFails(saveDay(as('ops'), '2026-11-10'));                                                          // a new day in a locked month
  await assertFails(updateDoc(D(as('ops'), '2026-11-09'), { units: '5', v: 2 }));                               // an old one
  await assertFails(updateDoc(S(as('ops'), '2026-11-09~e5'), { shareSen: 1 }));
  await assertSucceeds(saveDay(as('ops'), '2026-12-02', day('2026-12-02', { savedBy: 'e3' })));                 // the next month is open
  await assertFails(updateDoc(doc(as('pay'), `tenants/${T}/prodLocks/2026-11`), { by: 'x' }));                  // a lock can't be undone
  await assertFails(deleteDoc(doc(as('pay'), `tenants/${T}/prodLocks/2026-11`)));
});

test('support (the superadmin) can’t read production pay data', async () => {
  await assertFails(getDoc(D(sa(), '2026-11-09')));
  await assertFails(getDoc(S(sa(), '2026-11-09~e5')));
});

test('only the superadmin switches the addon, with an audit entry, and only that key', async () => {
  const on = async (db, aid, extra = {}) => { const b = writeBatch(db); b.set(doc(db, `auditLog/${aid}`), { entityType: 'tenantAddon', entityId: OFF, actorUid: 'sa', actorEmail: 'sa@x.my', action: 'prodCommission on', createdAt: serverTimestamp() }); b.update(doc(db, `tenants/${OFF}`), { addons: { prodCommission: true }, lastAuditId: aid, ...extra }); return b.commit(); };
  await assertFails(updateDoc(doc(as('off'), `tenants/${OFF}`), { addons: { prodCommission: true } }));       // the company's own admin can't switch it on
  await assertFails(updateDoc(doc(sa(), `tenants/${OFF}`), { addons: { prodCommission: true } }));              // not without an audit entry
  await assertSucceeds(on(sa(), 'a1'));
  await assertFails(on(sa(), 'a2', { name: 'Hijack' }));                                                        // only the addon key
  await assertFails(updateDoc(doc(as('own'), `tenants/${T}`), { addons: { prodCommission: false } }));          // not even Major Far East's Owner
});

// ---- several products on one day: the new items field ----
const line = (o = {}) => ({ pid: 'pp-1', name: 'Cili boh', unit: 'jar', rate: '0.05', units: '2000', poolSen: 10000, ...o });
const multi = (date, items, o = {}) => day(date, { savedBy: 'e3', items, units: '2000 jar', unit: '', rate: '', ...o });

test('items: a valid list written by someone with production access is accepted (one product, several, and at the 8-line limit)', async () => {
  await assertSucceeds(saveDay(as('ops'), '2026-11-10', multi('2026-11-10', [line()])));
  await assertSucceeds(saveDay(as('pay'), '2026-11-11', multi('2026-11-11', [line(), line({ pid: 'pp-2', name: 'Sambal', unit: 'kg', rate: '0.4', units: '12.5', poolSen: 500 })], { savedBy: 'e4', poolSen: 10500, shareSen: 420 })));
  await assertSucceeds(saveDay(as('ops'), '2026-11-12', multi('2026-11-12', Array.from({ length: 8 }, (_, i) => line({ pid: `p${i}` })))));
  await assertSucceeds(saveDay(as('ops'), '2026-11-13', multi('2026-11-13', [])));                                  // an empty list is a list
});

test('items: wrong types, negatives, unknown fields and more than 8 lines are rejected', async () => {
  const bad = (items, o) => assertFails(saveDay(as('ops'), '2026-11-10', multi('2026-11-10', items, o)));
  await bad('not a list');
  await bad([line({ units: 2000 })]);                      // a number where text is expected
  await bad([line({ poolSen: '10000' })]);                  // text where a whole number is expected
  await bad([line({ poolSen: 100.5 })]);
  await bad([line({ name: 7 })]);
  await bad(['x']);                                         // not a map
  await bad([line({ units: '-5' })]);                       // negative quantity
  await bad([line({ rate: '-0.05' })]);                     // negative rate
  await bad([line({ poolSen: -1 })]);                       // negative amount
  await bad([line({ secret: 'x' })]);                       // unknown field on a line
  await bad([line(), line(), line({ units: '-1' })]);       // the bad one is not first
  await bad(Array.from({ length: 9 }, (_, i) => line({ pid: `p${i}` })));
  await bad([line()], { poolSen: -100 });                   // a negative day pool
  await bad([line()], { shareSen: -1 });
});

test('items: an employee without access, the people area, and a company without the add-on are still refused', async () => {
  await assertFails(saveDay(as('a'), '2026-11-10', multi('2026-11-10', [line()], { savedBy: 'e5' })));
  await assertFails(saveDay(as('hr'), '2026-11-10', multi('2026-11-10', [line()], { savedBy: 'e2' })));
  await assertFails(saveDay(as('off'), '2026-11-10', multi('2026-11-10', [line()], { savedBy: 'e1' })));
  await assertFails(getDoc(D(as('a'), '2026-11-10')));
});

test('items: existing single-total days (no items) still pass, and can be re-saved; a finalised month still locks items', async () => {
  await assertSucceeds(saveDay(as('ops'), '2026-11-10', day('2026-11-10', { savedBy: 'e3' })));                   // the old shape
  await assertSucceeds(setDoc(D(as('ops'), '2026-11-09'), day('2026-11-09', { savedBy: 'e3', v: 2 })));           // re-save an old day
  await assertSucceeds(setDoc(D(as('ops'), '2026-11-09'), multi('2026-11-09', [line()], { v: 3 })));             // and move it to items
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `tenants/${T}/prodLocks/2026-11`), { month: '2026-11' }));
  await assertFails(saveDay(as('ops'), '2026-11-11', multi('2026-11-11', [line()])));
});

// ---- the production supervisor: an employee (no admin role) who keys in quantities only ----
const Q = (db, id, t = T) => doc(db, `tenants/${t}/prodQty/${id}`);
const qty = (date, pid, o = {}) => ({ date, pid, units: '2000', by: 'e8', at: '2026-11-13T09:00:00Z', ...o });

test('supervisor: may key in a quantity (and change it); a normal employee may not; nobody may delete', async () => {
  await assertSucceeds(setDoc(Q(as('sup'), '2026-11-13~pp-1'), qty('2026-11-13', 'pp-1')));
  await assertSucceeds(setDoc(Q(as('sup'), '2026-11-13~pp-1'), qty('2026-11-13', 'pp-1', { units: '2100.5' })));
  await assertSucceeds(getDoc(Q(as('sup'), '2026-11-13~pp-1')));
  await assertFails(setDoc(Q(as('a'), '2026-11-13~pp-1'), qty('2026-11-13', 'pp-1', { by: 'e5' })));            // a normal employee
  await assertFails(setDoc(Q(as('hr'), '2026-11-13~pp-1'), qty('2026-11-13', 'pp-1', { by: 'e2' })));          // people area only
  await assertFails(getDoc(Q(as('a'), '2026-11-13~pp-1')));
  await assertSucceeds(setDoc(Q(as('ops'), '2026-11-13~pp-2'), qty('2026-11-13', 'pp-2', { by: 'e3' })));       // an admin with the area still can
  await assertFails(deleteDoc(Q(as('sup'), '2026-11-13~pp-1')));
});

test('supervisor: same validation as production days (type, negative, id, own name, locked month, add-on off)', async () => {
  const bad = (id, d) => assertFails(setDoc(Q(as('sup'), id), d));
  await bad('2026-11-13~pp-1', qty('2026-11-13', 'pp-1', { units: '-5' }));
  await bad('2026-11-13~pp-1', qty('2026-11-13', 'pp-1', { units: 'abc' }));
  await bad('2026-11-13~pp-1', qty('2026-11-13', 'pp-1', { units: 2000 }));                                      // a number, not text
  await bad('2026-11-13~pp-1', qty('2026-11-13', 'pp-1', { units: '1.234' }));                                   // more than 2 decimals
  await bad('2026-11-13~pp-1', qty('2026-11-13', 'pp-1', { by: 'e5' }));                                         // in someone else's name
  await bad('2026-11-13~pp-2', qty('2026-11-13', 'pp-1'));                                                       // id must match date~product
  await bad('2026-11-13~pp-1', { ...qty('2026-11-13', 'pp-1'), poolSen: 10000 });                                // no money fields
  await bad('2026-11-13~pp-1', { ...qty('2026-11-13', 'pp-1'), rate: '9' });                                     // no rate
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `tenants/${T}/prodLocks/2026-11`), { month: '2026-11' }));
  await bad('2026-11-13~pp-1', qty('2026-11-13', 'pp-1'));                                                       // a finalised month
});

test('supervisor: cannot change rates, write days or shares, read days or shares of others, or grant themselves the permission', async () => {
  const sup = as('sup');
  await assertFails(updateDoc(doc(sup, `tenants/${T}/buckets/settings`), { 'f.prod': '{"products":[{"id":"pp-1","name":"A","unit":"jar","rate":"9","on":true}],"depts":["d1"]}' }));   // the rates
  await assertSucceeds(getDoc(doc(sup, `tenants/${T}/buckets/settings`)));                                       // may read what the app needs
  await assertFails(saveDay(sup, '2026-11-13', day('2026-11-13', { savedBy: 'e8' })));                           // a day with money
  await assertFails(setDoc(S(sup, '2026-11-13~e5'), share('2026-11-13', 'e5')));
  await assertFails(getDoc(D(sup, '2026-11-09')));
  await assertFails(getDoc(S(sup, '2026-11-09~e5')));
  await assertFails(updateDoc(doc(sup, 'users/sup'), { prodEntry: false }));                                     // not their own access
  await assertFails(updateDoc(doc(sup, 'users/a'), { prodEntry: true }));
});

test('supervisor permission: set by an Owner or an admin with the Settings area, nobody else; true or false only', async () => {
  await assertSucceeds(updateDoc(doc(as('own'), 'users/a'), { prodEntry: true }));
  await assertSucceeds(updateDoc(doc(as('setadm'), 'users/b'), { prodEntry: true }));
  await assertSucceeds(updateDoc(doc(as('setadm'), 'users/sup'), { prodEntry: false }));
  await assertFails(updateDoc(doc(as('setadm'), 'users/b'), { prodEntry: 'yes' }));
  await assertFails(updateDoc(doc(as('hr'), 'users/b'), { prodEntry: true }));                                   // people area is not enough
  await assertFails(updateDoc(doc(as('a'), 'users/b'), { prodEntry: true }));
  await assertFails(updateDoc(doc(as('own'), 'users/off'), { prodEntry: true }));                                // another company
});

test('supervisor: a company without the add-on, or a switched-off supervisor, has no access', async () => {
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'users/sup'), { disabled: true }));
  await assertFails(setDoc(Q(as('sup'), '2026-11-13~pp-1'), qty('2026-11-13', 'pp-1')));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), `tenants/${T}`), { addons: { prodCommission: false } }));
  await assertFails(setDoc(Q(as('sup2'), '2026-11-13~pp-1'), qty('2026-11-13', 'pp-1', { by: 'e10' })));
});
