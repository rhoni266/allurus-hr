// docs/JOIN-AUTOLINK-SPEC.md: PIN typed twice, the automatic link plan (staffLinks), the email-prefix check used by the rules, and the
// wording and wiring of the join page and Team access. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = { window: {}, globalThis: null };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-map.js'), 'utf8'), ctx);
const M = ctx.window.AllurusCloudMap || ctx.AllurusCloudMap;
const plain = (x) => JSON.parse(JSON.stringify(x));
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('PIN typed twice: ready only when both have 6 digits and match; a mismatch is reported; digits only', () => {
  assert.deepEqual(plain(M.pinPair('482915', '482915')), { ready: true, mismatch: false, pin: '482915' });
  assert.deepEqual(plain(M.pinPair('482915', '482916')), { ready: false, mismatch: true, pin: '482915' });
  assert.equal(M.pinPair('48291', '48291').ready, false, 'five digits');
  assert.equal(M.pinPair('482915', '').ready, false, 'confirm empty');
  assert.equal(M.pinPair('482915', '48291').mismatch, false, 'not both full yet, so not a mismatch');
  assert.equal(M.pinPair('48 29-15', '482915').ready, true, 'spaces and dashes are ignored');
  assert.equal(M.pinPair(null, undefined).ready, false);
  assert.equal(M.pinPair('000000', '000000').ready, true, 'the join page allows any 6 digits (zero-friction decision, tests/activation.test.js)');
});

test('the email-prefix check the rules make: <ic>.<company in lower case>.g<n>@staff.allurus.invalid', () => {
  const ic = '900101015555', e = M.staffEmail(ic, 'Co1X', 3);
  assert.equal(M.staffEmailMatches(e, 'Co1X', ic), true);
  assert.equal(M.staffEmailMatches(e, 'co1x', ic), true, 'the company is compared in lower case');
  assert.equal(M.staffEmailMatches(e, 'Co1X', '900101015556'), false, 'another IC');
  assert.equal(M.staffEmailMatches(e, 'Other', ic), false, 'another company');
  assert.equal(M.staffEmailMatches('nadia@x.my', 'Co1X', ic), false, 'an ordinary email');
  assert.equal(M.staffEmailMatches(`${ic}.co1x.g1@evil.example`, 'Co1X', ic), false, 'another host');
  assert.equal(M.staffEmailMatches(`x${ic}.co1x.g1@staff.allurus.invalid`, 'Co1X', ic), false, 'a prefix in front of the IC');
  const rules = read('firestore.rules');
  assert.match(rules, /myEmail\(\)\.matches\(id\.split\('~'\)\[1\] \+ '\[\.\]' \+ id\.split\('~'\)\[0\]\.lower\(\) \+ '\[\.\]g\[0-9\]\{1,4\}@staff\[\.\]allurus\[\.\]invalid'\)/, 'the rule has the same pattern');
});

const emps = [
  { id: 'e1', first: 'Admin', ic: '', status: 'Active' },
  { id: 'e2', first: 'Aina', ic: '900101-01-5551', phone: '+60 12-345 0001', status: 'Active' },
  { id: 'e3', first: 'Budi', ic: '900202025552', phone: '', status: 'Active' },
  { id: 'e4', first: 'Cik', ic: '900303035553', phone: '+60123450004', status: 'Active' },
  { id: 'e5', first: 'Dua', ic: '900303035553', phone: '+60123450005', status: 'Active' },          // shares an IC with e4
  { id: 'e6', first: 'Eka', ic: '900404045554', phone: '+60123450006', status: 'Active' },          // already has an email sign-in
  { id: 'e7', first: 'Fiq', ic: '900505055555', phone: '+60123450007', status: 'Left' },
  { id: 'e8', first: 'Gita', ic: '900606065556', phone: '+60123450008', status: 'Active' },         // has an admin sign-in
  { id: 'e9', first: 'Hana', ic: 'P1234567', idType: 'passport', phone: '+60123450009', status: 'Active' },
];
const users = [
  { uid: 'u6', email: 'eka@x.my', empId: 'e6', roles: ['employee'] },
  { uid: 'u8', email: 'gita@x.my', empId: 'e8', roles: ['admin', 'employee'] },
  { uid: 'old', email: 'old@x.my', empId: 'e3', roles: ['employee'], disabled: true },              // turned off: does not count
];
const plan = (o = {}) => plain(M.staffLinksPlan(emps, users, { tenantId: 'Co1X', ...o }));

test('staffLinks plan: one document per record with a unique IC; none for admins, shared ICs, leavers, passports or blanks', () => {
  const p = plan();
  assert.deepEqual(Object.keys(p).sort(), ['Co1X~900101015551', 'Co1X~900202025552', 'Co1X~900404045554']);
  assert.deepEqual(p['Co1X~900101015551'], { empId: 'e2', hasSignIn: false, phone4: '0001' });
  assert.deepEqual(p['Co1X~900202025552'], { empId: 'e3', hasSignIn: false, phone4: '' }, 'a turned-off sign-in does not count; no phone on file');
  assert.deepEqual(p['Co1X~900404045554'], { empId: 'e6', hasSignIn: true, phone4: '0006' }, 'an email sign-in already exists: the sign-up must wait for HR');
  assert.ok(!('Co1X~900303035553' in p), 'two records share the IC: HR decides');
  assert.ok(!('Co1X~900606065556' in p), 'an admin sign-in is on the record: never linked automatically');
  assert.ok(!('Co1X~900505055555' in p), 'a person who left');
});

test('staffLinks plan: nothing when the switch is off; the phone check can be turned off', () => {
  assert.deepEqual(plan({ on: false }), {});
  assert.equal(plan({ phone4On: false })['Co1X~900101015551'].phone4, '');
  assert.equal(plan({ phone4On: true })['Co1X~900101015551'].phone4, '0001');
});

test('staffLinks diff: only what changed is written; what is no longer planned is deleted', () => {
  const p = plan(), sigs = {}; Object.keys(p).forEach((k) => { sigs[k] = M.staffLinksDiff({}, p).sig(p[k]); });
  const none = M.staffLinksDiff(sigs, p);
  assert.deepEqual([...none.write], []); assert.deepEqual([...none.del], []);
  const changed = plain(p); changed['Co1X~900101015551'].hasSignIn = true;
  const d = M.staffLinksDiff(sigs, changed);
  assert.deepEqual([...d.write], ['Co1X~900101015551']);
  const gone = M.staffLinksDiff({ ...sigs, 'Co1X~900999999999': 'e9|0|' }, p);
  assert.deepEqual([...gone.del], ['Co1X~900999999999']);
  assert.deepEqual([...M.staffLinksDiff(undefined, p).write].sort(), Object.keys(p).sort(), 'first run writes everything');
});

test('the sign-up key still holds no name and no employee id (security review 2026-11-07); the link lives in staffLinks', () => {
  const rules = read('firestore.rules'), cloud = read('js/cloud.js');
  assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly\(\['tenantId', 'gen', 'deviceId'\]\)/, 'staffKeys: no name, no empId');
  assert.match(rules, /match \/staffLinks\/\{id\}/);
  assert.ok(!/allow list: if true|allow read: if true/.test(rules.slice(rules.indexOf('match /staffLinks/{id}'), rules.indexOf('match /staffLinks/{id}') + 1200)), 'not open to everyone');
  assert.match(cloud, /staffLinks\/\$\{k\}/, 'written by HR in js/cloud.js');
});

test('join page: PIN in two boxes with one Show, button off until both are full, mismatch clears only the confirm box', () => {
  const j = read('js/join.js');
  assert.match(j, /id="pin-in"/); assert.match(j, /id="pin2-in"/);
  assert.match(j, /Masukkan semula PIN \/ Confirm PIN/);
  assert.match(j, /id="go-pin" disabled/);
  assert.match(j, /btn\.disabled = !\(pinIn\.value\.length === 6 && pin2In\.value\.length === 6\)/);
  assert.match(j, /pinIn\.type = pin2In\.type = isPw \? 'text' : 'password'/);
  assert.match(j, /M\.pinPair\(pinIn\.value, pin2In\.value\)/);
  assert.match(j, /PIN tidak sama\. Sila cuba lagi\. \/ PINs don’t match\./);
  assert.match(j, /if \(pp\.mismatch\) \{ pin2In\.value = ''/, 'only the confirm box is cleared');
});

test('join page: auto-link after sign-up, straight into the app, waiting wording, wrong PIN, no "account already exists"', () => {
  const j = read('js/join.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(j, /staffLinks\/\$\{ctx\.tenantId\}~\$\{ctx\.staff\.ic\}/, 'reads the link made for this IC');
  assert.match(j, /M\.linkProblem\(L\.empId/, 'the same check HR’s approval makes');
  assert.match(j, /updateDoc\(FS\.doc\(db, `users\/\$\{uid\}`\), \{ empId: L\.empId, autoLinkedAt: FS\.serverTimestamp\(\) \}\)/);
  assert.match(j, /location\.replace\('\/app\?activated'\)/, 'straight into the app');
  assert.match(j, /Akaun anda sedang menunggu kelulusan HR/);
  assert.match(j, /PIN salah\. Lupa PIN\? Minta HR tekan Reset sign-in\./);
  assert.ok(!/Klik di sini untuk log masuk/.test(j) && !/Akaun dengan No\. IC ini sudah wujud/.test(j));
  assert.match(j, /sessionStorage\.setItem\('allurus-welcome'/, 'one-time welcome');
  const app = read('js/app.js');
  assert.match(app, /Selamat datang, \$\{w\}!/);
  assert.match(app, /Akaun anda sedang menunggu kelulusan HR/);
  assert.ok(!/Your sign-in isn’t linked to your staff record yet/.test(app));
});

test('HR: a notice for every automatic link, "This isn’t them", "Linked automatically" in Team access, the risk and the phone setting', () => {
  const app = read('js/app.js'), nr = read('js/notify-rules.js');
  assert.match(nr, /'staff\.autolinked'/);
  assert.match(app, /notifyApi\.event\('staff\.autolinked'/);
  assert.match(app, /Linked automatically on the join page: \$\{who\} \(IC ••••\$\{ic4\}\)/, 'audit line without the full IC');
  assert.match(app, /'acc-auto-no': \(uid\) => teamAccess\.refuseAuto\(uid\)/);
  assert.match(app, /fire\(\)\.rejectAuto\(u, this\.icOf\(u\)\)/);
  assert.match(app, /Linked automatically\$\{auAt/);
  assert.match(app, /Know the risk\./);
  assert.match(app, /Also ask the last 4 digits of the phone on file/);
  assert.match(app, /\['joinAutoLink', 'joinPhone4'\]\.includes\(key\)/, 'only the two known switches');
});
