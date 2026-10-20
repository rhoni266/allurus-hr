// Unit tests for the cloud layout: a whole workspace survives the trip to documents and back, merges keep both
// people's edits, photos move out of records, and colleagues never get each other's pay or IC numbers.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Intl, Date, Math, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);
// The demo workspace needs the rule modules the seed uses; load everything index.html loads that has no DOM.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]).filter((s) => !/vendor|app\.js|experience|geo-map|face\.js|kiosk|receipt|cloud\.js|firebase-config/.test(s));
if (!scripts.includes('js/cloud-map.js')) scripts.push('js/cloud-map.js');
scripts.forEach((s) => { try { vm.runInContext(fs.readFileSync(path.join(root, s), 'utf8'), sandbox, { filename: s }); } catch (e) { /* modules that need a browser */ } });
const M = sandbox.AllurusCloudMap;
const plain = (v) => JSON.parse(JSON.stringify(v));
const seed = () => plain(vm.runInContext('AllurusSeed.create()', sandbox));

// The workspace keys, as js/app.js lists them.
const appSrc = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const WS_KEYS = JSON.parse(appSrc.match(/const WS_KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));

function roundTrip(ws, blobs = {}) {
  const docs = M.bucketsOf(ws, WS_KEYS, (id, data) => { if (id) blobs[id] = data; });
  const out = {};
  Object.keys(docs).forEach((id) => M.applyBucket(out, id, docs[id].t, docs[id].f, (h) => blobs[h]));
  return { docs, out };
}

test('every workspace key except the private ones survives the round trip', () => {
  const ws = seed();
  const { out } = roundTrip(ws);
  WS_KEYS.filter((k) => !['employees', 'payroll', 'plans'].includes(k)).forEach((k) => {
    if (ws[k] === undefined) return;
    const want = k === 'settings' ? { ...ws.settings, theme: undefined } : ws[k];
    assert.equal(M.stable(out[k]), M.stable(want), `key ${k}`);
  });
});

test('payroll, finance and loans are admin-only; leave and attendance are for every member', () => {
  const { docs } = roundTrip(seed());
  assert.equal(docs.leaves.r, 'm');
  assert.equal(docs['finance.invoices'].r, 'a');
  assert.equal(docs.finance.r, 'a');
  assert.equal(docs.loans.r, 'a');
  assert.ok(Object.keys(docs).some((id) => id.startsWith('attendance~') && docs[id].r === 'm'));
  assert.equal(docs.payroll, undefined, 'raw payroll goes to its own bucket only via the admin path');
  assert.equal(M.canWrite('settings', false), false);
  assert.equal(M.canWrite('leaves', false), true);
  assert.equal(M.canWrite('settings', true), true);
});

test('no document comes near the 1 MiB limit', () => {
  const { docs } = roundTrip(seed());
  Object.entries(docs).forEach(([id, d]) => assert.ok(M.docBytes(d.f) < 900000, `${id} is ${M.docBytes(d.f)} bytes`));
});

test('attendance is one document per month with one field per person per day', () => {
  const ws = seed();
  const { docs, out } = roundTrip(ws);
  const date = Object.keys(ws.attendance)[0], emp = Object.keys(ws.attendance[date])[0];
  const d = docs[`attendance~${date.slice(0, 7)}`];
  assert.ok(d.f[`${date}|${emp}`]);
  assert.deepEqual(out.attendance[date][emp], ws.attendance[date][emp]);
});

test('large photos move to blobs and come back', () => {
  const ws = seed();
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
  const date = Object.keys(ws.attendance)[0], emp = Object.keys(ws.attendance[date])[0];
  ws.attendance[date][emp].photo = photo;
  const blobs = {};
  const { docs, out } = roundTrip(ws, blobs);
  const field = docs[`attendance~${date.slice(0, 7)}`].f[`${date}|${emp}`];
  assert.ok(!field.includes('AAAA'), 'the photo is not inside the record');
  assert.ok(field.includes(M.MARK));
  assert.equal(Object.keys(blobs).length, 1);
  assert.equal(out.attendance[date][emp].photo, photo);
  // Unknown blobs stay as markers until fetched.
  const later = {}; const d = docs[`attendance~${date.slice(0, 7)}`];
  M.applyBucket(later, `attendance~${date.slice(0, 7)}`, 'm', d.f, () => undefined);
  assert.ok(later.attendance[date][emp].photo.startsWith(M.MARK));
});

test('equal data always encodes the same, whatever the key order', () => {
  assert.equal(M.stable({ b: 1, a: { d: 2, c: 3 } }), M.stable({ a: { c: 3, d: 2 }, b: 1 }));
});

test('two people editing different records both keep their change', () => {
  const ws = seed();
  const base = M.bucketsOf(ws, ['leaves']).leaves.f;
  const mine = plain(ws); mine.leaves[0].status = 'Approved';
  const theirs = plain(ws); theirs.leaves[1].reason = 'Family event';
  const local = M.bucketsOf(mine, ['leaves']).leaves.f, remote = M.bucketsOf(theirs, ['leaves']).leaves.f;
  const merged = M.merge3(base, local, remote);
  const out = {}; M.applyBucket(out, 'leaves', 'a', merged);
  assert.equal(out.leaves[0].status, 'Approved');
  assert.equal(out.leaves[1].reason, 'Family event');
  assert.equal(out.leaves.length, ws.leaves.length);
});

test('a record added at the top elsewhere does not undo my edit to an older one', () => {
  const ws = seed();
  const base = M.bucketsOf(ws, ['notifications']).notifications.f;
  const mine = plain(ws); mine.notifications[2].read = true;
  const theirs = plain(ws); theirs.notifications.unshift({ id: 'n-new', text: 'New request' });
  const merged = M.merge3(base, M.bucketsOf(mine, ['notifications']).notifications.f, M.bucketsOf(theirs, ['notifications']).notifications.f);
  const out = {}; M.applyBucket(out, 'notifications', 'a', merged);
  assert.equal(out.notifications[0].id, 'n-new');
  assert.equal(out.notifications.find((n) => n.id === ws.notifications[2].id).read, true);
  assert.equal(out.notifications.length, ws.notifications.length + 1);
});

test('a record I add and one someone else adds are both kept', () => {
  const ws = seed();
  const base = M.bucketsOf(ws, ['leaves']).leaves.f;
  const mine = plain(ws); mine.leaves.push({ id: 'l-mine', empId: 'e2', status: 'Pending' });
  const theirs = plain(ws); theirs.leaves.push({ id: 'l-theirs', empId: 'e3', status: 'Pending' });
  const merged = M.merge3(base, M.bucketsOf(mine, ['leaves']).leaves.f, M.bucketsOf(theirs, ['leaves']).leaves.f);
  const out = {}; M.applyBucket(out, 'leaves', 'a', merged);
  const ids = out.leaves.map((l) => l.id);
  assert.ok(ids.includes('l-mine') && ids.includes('l-theirs'));
});

test('a delete on the server wins when I had not touched the record', () => {
  const ws = seed();
  const base = M.bucketsOf(ws, ['leaves']).leaves.f;
  const theirs = plain(ws); const gone = theirs.leaves.shift().id;
  const merged = M.merge3(base, base, M.bucketsOf(theirs, ['leaves']).leaves.f);
  assert.equal(merged[gone], undefined);
});

test('diff sends only what changed', () => {
  const ws = seed();
  const base = M.bucketsOf(ws, ['leaves']).leaves.f;
  const mine = plain(ws); mine.leaves[0].status = 'Rejected';
  const d = M.diff(base, M.bucketsOf(mine, ['leaves']).leaves.f);
  assert.deepEqual(plain(Object.keys(d.set)), [String(ws.leaves[0].id)]);
  assert.equal(d.del.length, 0);
});

test('colleagues see a directory card without pay, bank or IC details', () => {
  const ws = seed();
  const dir = M.directoryFrom(M.directoryFields(ws.employees));
  const card = dir.find((e) => e.id === 'e2');
  ['salary', 'ic', 'accountNo', 'bank', 'taxNo', 'epfNo', 'face'].forEach((k) => assert.equal(card[k], undefined, k));
  assert.equal(card.first, 'Daniel');
  const own = M.personFrom(M.personFields(ws.employees[1], 1));
  const list = M.employeesFor(dir, own);
  assert.equal(list.find((e) => e.id === 'e2').salary, ws.employees[1].salary, 'my own record is complete');
  assert.equal(list.find((e) => e.id === 'e3').salary, undefined, 'a colleague’s is not');
  assert.equal(list.length, ws.employees.length);
});

test('a payslip document holds only that person’s lines', () => {
  const ws = seed();
  const f = M.payslipFields(ws.payroll, 'e2');
  const p = M.payrollFrom(f);
  Object.values(p).forEach((run) => { assert.equal(run.items.length, 1); assert.equal(run.items[0].empId, 'e2'); });
  const m = Object.keys(ws.payroll)[0];
  assert.equal(p[m].status, ws.payroll[m].status);
});

test('personal plans and reliefs round-trip for their owner only', () => {
  const ws = seed();
  const f = M.personalFields(ws, 'e2', 'emp@allurus.com');
  const out = {}; M.applyPersonal(out, f, 'e2', 'emp@allurus.com');
  assert.deepEqual(out.plans.e2, ws.plans.e2);
  assert.deepEqual(out.reliefs['emp@allurus.com'], ws.reliefs['emp@allurus.com']);
  assert.equal(out.reliefs['admin@allurus.com'], undefined);
});
