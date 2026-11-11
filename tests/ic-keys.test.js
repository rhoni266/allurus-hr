// When HR removes or changes an employee's IC, that IC's sign-up key is removed, so a removed IC cannot register any more.
// Also: the old "1 Pekerja = 1 Telefon" lock is gone from the join page. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { window: {}, globalThis: null };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-map.js'), 'utf8'), ctx);
const M = ctx.window.AllurusCloudMap || ctx.AllurusCloudMap;
const stale = (a, b) => [...M.staleIcs(a, b)];
const staff = [
  { id: 'e1', ic: '900101-01-5555' }, { id: 'e2', ic: '910202025555' }, { id: 'e3', ic: '920303035555' },
  { id: 'e4', ic: 'A1234567', idType: 'passport' }, { id: 'e5', ic: '' }, { id: 'e6', ic: '12345' },
];

test('icMap: only valid 12-digit ICs of people with one (no passports, blanks or short numbers)', () => {
  assert.deepEqual({ ...M.icMap(staff) }, { e1: '900101015555', e2: '910202025555', e3: '920303035555' });
  assert.deepEqual({ ...M.icMap(null) }, {});
});

test('staleIcs: an IC that was cleared, changed or whose employee was removed is stale', () => {
  const before = M.icMap(staff);
  assert.deepEqual(stale(before, staff), [], 'nothing changed');
  const cleared = staff.map((e) => (e.id === 'e1' ? { ...e, ic: '' } : e));
  assert.deepEqual(stale(before, cleared), ['900101015555'], 'IC removed from the record');
  const changed = staff.map((e) => (e.id === 'e2' ? { ...e, ic: '910202026666' } : e));
  assert.deepEqual(stale(before, changed), ['910202025555'], 'IC changed: the old one goes, the new one is added by the normal sync');
  assert.deepEqual(stale(before, staff.filter((e) => e.id !== 'e3')), ['920303035555'], 'employee removed');
  assert.deepEqual(stale(before, staff.map((e) => (e.id === 'e1' ? { ...e, ic: 'A9999999', idType: 'passport' } : e))), ['900101015555'], 'switched to a passport');
});

test('staleIcs: an IC another employee still has is kept; formatting differences are not changes', () => {
  const before = M.icMap(staff);
  const moved = staff.map((e) => (e.id === 'e1' ? { ...e, ic: '' } : e.id === 'e2' ? { ...e, ic: '900101-01-5555' } : e));
  assert.deepEqual(stale(before, moved), ['910202025555'], 'e1’s IC now belongs to e2, so only e2’s old IC goes');
  assert.deepEqual(stale(before, staff.map((e) => (e.id === 'e1' ? { ...e, ic: '900101015555' } : e))), [], 'dashes added or removed is the same IC');
});

test('staleIcs: a person added during the session is picked up once their IC is remembered, then changed', () => {
  const seen = { ...M.icMap(staff), e7: '930404045555' };            // remembered when the key was made
  const edited = [...staff, { id: 'e7', ic: '930404046666' }];
  assert.deepEqual(stale(seen, edited), ['930404045555']);
});

test('wiring: removal runs after every push, only for HR with Settings and People, keeps the join link and invitation in step, and ignores a mass drop', () => {
  const cloud = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
  assert.match(cloud, /S\.icSeen = M\.icMap\(ws\.employees\)/, 'baseline when the workspace loads');
  const i = cloud.indexOf('async function pruneStaffKeys()');
  assert.ok(i > 0);
  const body = cloud.slice(i, i + 2200);
  assert.match(body, /!can\('settings'\) \|\| !can\('people'\)/, 'needs the Settings and People areas');
  assert.match(body, /M\.staleIcs\(S\.icSeen, emps\)/);
  assert.match(body, /stale\.length > 5 && stale\.length > Object\.keys\(S\.icSeen\)\.length \/ 2/, 'a bad load is not mistaken for edits');
  assert.match(body, /joinLinks\/\$\{inv\.data\(\)\.link\}/, 'the pending personal link goes too');
  assert.match(body, /b\.delete\(doc\(db, key\)\)/, 'the sign-up key is deleted');
  const push = cloud.slice(cloud.indexOf('async function push()'), i);
  assert.match(push, /S\.pushing = false;[\s\S]*pruneStaffKeys\(\);/, 'called after each push');
});

test('the join page no longer has the 1 Pekerja = 1 Telefon lock, and no longer writes a device id to the IC key', () => {
  const join = fs.readFileSync(path.join(__dirname, '..', 'js', 'join.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');   // code only, not the comments
  assert.ok(!/1 Pekerja = 1 Telefon/.test(join));
  assert.ok(!/kData\.deviceId/.test(join), 'the IC step does not read a device id');
  assert.ok(!/existingDev/.test(join), 'the sign-in step does not compare a device id');
  assert.ok(!/staffKeys\/\$\{ctx\.tenantId\}~\$\{ctx\.staff\.ic\}`\), \{ deviceId \}/.test(join), 'no deviceId write to staffKeys');
  assert.match(join, /staffKeys\/\$\{ctx\.tenantId\}~\$\{ic\}/, 'the IC step still looks the IC up: a removed IC is "not in the HR record"');
});
