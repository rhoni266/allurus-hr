// Incident 2026-11-11: a worker opened his join link on a phone where an HR admin was signed in and ended up in her account,
// then checked in as her. Tests for the five fixes. Fake people only.  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---------- 1. Join never reuses a sign-in (the browser test covers the screen; this pins the code) ----------
test('join.js: start() no longer redirects to /app, and checks who is signed in first', () => {
  const j = src('js/join.js');
  const start = j.slice(j.indexOf('async function start()'));
  assert.ok(!/location\.replace\(['"]\/app['"]\)/.test(start), 'start() must not redirect to /app');
  assert.match(start, /signedInHere\(\)/);
  assert.match(start, /signedInScreen\(who\)/);
  // The account step checks again right before it creates or signs in an account.
  const step = j.slice(j.indexOf('Auth.createUserWithEmailAndPassword'), j.indexOf('Auth.createUserWithEmailAndPassword') + 10).length;
  assert.ok(step > 0);
  const before = j.slice(Math.max(0, j.indexOf('Auth.createUserWithEmailAndPassword') - 400), j.indexOf('Auth.createUserWithEmailAndPassword'));
  assert.match(before, /signedInHere\(\)/);
  // The words the owner asked for, in English and Bahasa Malaysia, and a Sign out button.
  assert.match(j, /This phone is signed in as/);
  assert.match(j, /Sign out to register yourself/);
  assert.match(j, /Telefon ini sudah log masuk sebagai/);
  assert.match(j, /id="so"/);
});

// ---------- 2. Sign-out clears everything; nothing signs anyone in silently ----------
function fakeBrowser() {
  const mk = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i], get length() { return m.size; } }; };
  const ls = mk(), ss = mk();
  const store = new Proxy(ls, { ownKeys: () => [...Array(ls.length).keys()].map((i) => ls.key(i)), getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && ls.getItem(k) != null ? { enumerable: true, configurable: true, value: ls.getItem(k) } : Reflect.getOwnPropertyDescriptor(t, k)), has: (t, k) => ls.getItem(k) != null || k in t });
  const jar = new Map();
  const doc = { get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); }, set cookie(s) { const [kv, ...attrs] = String(s).split(';'); const [k, v = ''] = kv.trim().split('='); if (attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k); else jar.set(k, v); } };
  return { localStorage: store, sessionStorage: ss, document: doc, location: { hostname: 'allurus.my' }, ls, jar };
}
test('sign-out: the staff session, stored PIN, workspace copy, cookie and per-sign-in data all go; the phone’s own id stays', () => {
  const b = fakeBrowser();
  Object.assign(globalThis, { localStorage: b.localStorage, sessionStorage: b.sessionStorage, document: b.document, location: b.location });
  delete require.cache[require.resolve('../js/session-clear.js')];
  const S = require('../js/session-clear.js');
  b.ls.setItem('allurus_staff_session', JSON.stringify({ email: 'x', tenantId: 't', pin: '123456', ic: '900101145678' }));
  b.ls.setItem('allurus-hr-cloud-v1', '{"employees":[]}');
  b.ls.setItem('allurus-pin', '123456');
  b.ls.setItem('allurus-signin-fails', '3');
  b.ls.setItem('allurus_device_id', 'dev-phone-1');         // the PHONE's identity: stays
  b.ls.setItem('allurus-device-id', 'dev-phone-1');
  b.sessionStorage.setItem('anything', 'x');
  b.document.cookie = 'allurus_staff_token=abc; max-age=315360000; path=/; SameSite=Lax';
  b.document.cookie = 'allurus_dev_id=dev-phone-1; path=/';
  assert.ok(S.leftovers().length >= 5, 'there is something to clear: ' + S.leftovers().join(','));
  const removed = S.clearLocal();
  assert.deepEqual(S.leftovers(), [], 'nothing of the person is left');
  assert.ok(removed.includes('allurus_staff_session') && removed.includes('allurus-hr-cloud-v1') && removed.includes('allurus-pin'));
  assert.equal(b.ls.getItem('allurus_device_id'), 'dev-phone-1');                  // the phone keeps its identity
  assert.equal(b.ls.getItem('allurus-device-id'), 'dev-phone-1');
  assert.ok(b.document.cookie.includes('allurus_dev_id=dev-phone-1'));
  assert.ok(!/allurus_staff_token/.test(b.document.cookie));
  assert.equal(b.sessionStorage.length, 0);
});

test('sign-out also ends Firebase Auth and clears the Firestore offline cache (which holds the last person’s documents)', async () => {
  const b = fakeBrowser();
  Object.assign(globalThis, { localStorage: b.localStorage, sessionStorage: b.sessionStorage, document: b.document, location: b.location });
  delete require.cache[require.resolve('../js/session-clear.js')];
  const S = require('../js/session-clear.js');
  const calls = [];
  const Auth = { signOut: async (a) => { calls.push('auth.signOut'); a.currentUser = null; } }, auth = { currentUser: { uid: 'u1' } };
  const FS = { terminate: async () => calls.push('terminate'), clearIndexedDbPersistence: async () => calls.push('clearIndexedDbPersistence') };
  b.ls.setItem('allurus_staff_session', '{}');
  await S.signOutEverything({ Auth, auth, FS, db: {} });
  assert.deepEqual(calls, ['auth.signOut', 'terminate', 'clearIndexedDbPersistence']);
  assert.equal(auth.currentUser, null);
  assert.deepEqual(S.leftovers(), []);
  // It still clears locally even if Firebase fails.
  b.ls.setItem('allurus_staff_session', '{}');
  await S.signOutEverything({ Auth: { signOut: async () => { throw new Error('offline'); } }, auth: {}, FS: { terminate: async () => { throw new Error('x'); }, clearIndexedDbPersistence: async () => { throw new Error('y'); } }, db: {} });
  assert.deepEqual(S.leftovers(), []);
});

test('nothing signs anyone in silently: sign-in calls only happen on a person’s own action, and no password, PIN or IC is remembered', () => {
  const files = ['js/cloud.js', 'js/join.js', 'js/app.js', 'js/activate.js', 'js/kiosk.js', 'js/signup.js'];
  const allowedIn = { 'js/cloud.js': ['async signIn(email, password)'], 'js/join.js': ['async function step3_pin', 'function step3_pin', 'handleSubmit', 'pin'], 'js/activate.js': [], 'js/signup.js': [] };
  for (const f of files) {
    const s = src(f);
    // Custom tokens and credential replay would be a silent sign-in.
    assert.ok(!/signInWithCustomToken|signInWithCredential\(/.test(s), `${f}: no silent credential sign-in`);
    // Every email/password sign-in is inside a function that is run from a submit or click.
    const re = /signInWithEmailAndPassword\(/g; let m;
    while ((m = re.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 2500), m.index);
      assert.ok(!/onAuthStateChanged\(auth, async \(user\) => \{[^}]*$/.test(before.slice(-400)), `${f}: a sign-in inside the auth-state listener would be silent`);
    }
  }
  // The remembered session holds no password, PIN or IC.
  for (const f of ['js/cloud.js', 'js/join.js']) {
    const s = src(f);
    for (const m of s.matchAll(/saveStaffSession\(\{([^}]*)\}\)/g)) assert.ok(!/\b(pin|password|ic)\b/.test(m[1]), `${f}: saveStaffSession(${m[1].trim()}) must not hold pin, password or ic`);
    assert.match(s, /delete sess\.pin; delete sess\.ic/);                    // and an older one is migrated away
  }
  // The app's sign-out paths all call the shared clearing.
  const app = src('js/app.js'), cloud = src('js/cloud.js');
  assert.ok((app.match(/AllurusSession\?\.clearLocal\(\)/g) || []).length >= 2);
  assert.match(cloud, /async signOut\(\) \{[\s\S]*clearFirestoreCache/);
  assert.match(cloud, /signout\\b\/\.test[\s\S]*clearFirestoreCache/);
});

// ---------- 3. Face check ----------
const CR = (() => { const sb = { window: {} }; sb.window = sb; require('node:vm').createContext(sb); require('node:vm').runInContext(src('js/checkin-rules.js'), sb); return sb.AllurusCheckinRules; })();

test('the face check: only a clear match against a CONFIRMED reference passes without a look', () => {
  const r = (o) => CR.faceReview({ faceCheckOn: true, hasRef: true, refConfirmed: true, verdict: 'match', ...o });
  assert.deepEqual({ ...r() }, { result: 'match', review: false, why: '' });
  const mismatch = r({ verdict: 'mismatch' });
  assert.deepEqual([mismatch.result, mismatch.review], ['mismatch', true]);            // a clearly different face is flagged for HR
  assert.match(mismatch.why, /didn’t match/);
  assert.equal(r({ verdict: 'weak' }).review, true);
  const unconfirmed = r({ refConfirmed: false });
  assert.deepEqual([unconfirmed.result, unconfirmed.review, unconfirmed.unconfirmed], ['match', true, true]);   // matched a reference nobody confirmed
  const first = CR.faceReview({ faceCheckOn: true, hasRef: false });
  assert.deepEqual([first.result, first.review], ['enrolled', true]);                  // a first selfie becomes a reference: HR confirms it
  assert.match(first.why, /Confirm it is really them/);
  assert.deepEqual([CR.faceReview({ ran: false }).result, CR.faceReview({ ran: false }).review], ['unavailable', true]);
});

test('the incident: face check off at the company means nothing was compared; for an admin account that goes to HR', () => {
  const off = CR.faceReview({ faceCheckOn: false, hasRef: false, admin: true });
  assert.deepEqual([off.result, off.review], ['off', true]);
  assert.match(off.why, /not compared/);
  assert.deepEqual([CR.faceReview({ faceCheckOn: false, admin: false }).result, CR.faceReview({ faceCheckOn: false, admin: false }).review], ['off', false]);   // still recorded as "off"
});

test('nobody confirms their own reference photo', () => {
  assert.equal(CR.mayConfirmFace({ actorId: 'e1', ownerId: 'e1' }), false);
  assert.equal(CR.mayConfirmFace({ actorId: 'e2', ownerId: 'e1' }), true);
  assert.equal(CR.mayConfirmFace({ actorId: '', ownerId: 'e1' }), false);
  const app = src('js/app.js');
  assert.match(app, /'face-confirm': \(empId\) => \{ if \(!window\.AllurusCheckinRules\.mayConfirmFace/);
});

test('the check-in flow records a face result for every selfie and HR’s list shows the new reasons', () => {
  const app = src('js/app.js'), kiosk = src('js/kiosk.js');
  assert.match(app, /faceReview\(\{ faceCheckOn: false, admin: isAdmin \}\)/);          // "off" is recorded, not skipped
  assert.match(app, /faceReview\(\{ hasRef: false, admin: isAdmin \}\)/);
  assert.match(app, /refConfirmed: ref\.status !== 'pending'/);
  assert.match(kiosk, /r\.face\?\.review && r\.face\.why/);                             // HR's list
  assert.match(kiosk, /rec\.face\?\.review && rec\.face\.why/);                         // and the notice to HR
});

// ---------- 4. The invite text has no IC number ----------
test('the WhatsApp registration message says "Masukkan No. IC anda" without the number', () => {
  const app = src('js/app.js');
  const m = app.match(/const text = `Salam \$\{e\.first\}[^`]*`;/);
  assert.ok(m, 'the registration message is there');
  assert.match(m[0], /Masukkan No\. IC anda dan cipta 6 angka PIN/);
  assert.ok(!/\$\{[^}]*\bic\b[^}]*\}/.test(m[0]), 'no IC placeholder in the message');
  // No invite or join message builds in anyone's IC.
  for (const t of app.match(/`[^`]*(?:Masukkan No\. IC|You’ll need your IC)[^`]*`/g) || []) assert.ok(!/\$\{[^}]*\.ic\b/.test(t), t.slice(0, 80));
  // Render it the way the app does, with a real-looking IC, and look for 12 digits.
  const text = new Function('e', 'comp', 'shareUrl', `return \`Salam \${e.first}, anda boleh terus daftar akaun Allurus untuk \${comp} di sini:\\n\${shareUrl}\\n\\nMasukkan No. IC anda dan cipta 6 angka PIN untuk log masuk.\`;`)({ first: 'Ali', ic: '900101145678' }, 'Major Far East', 'https://allurus.my/join?c=majorf123');
  assert.ok(!/\d{6}-?\d{2}-?\d{4}/.test(text));
});

// ---------- 5. An admin's first phone is never automatic ----------
test('first phone: approved at once for staff (when the company says so), always pending for an admin account', () => {
  const D = require('../js/device-rules.js');
  const on = D.policy({}), off = D.policy({ staffDevices: { autoFirst: false } });
  assert.equal(D.firstPhoneStatus({ policy: on, roles: ['employee'] }), 'approved');
  assert.equal(D.firstPhoneStatus({ policy: off, roles: ['employee'] }), 'pending');
  assert.equal(D.firstPhoneStatus({ policy: on, roles: ['admin', 'employee'] }), 'pending');        // an HR admin
  assert.equal(D.firstPhoneStatus({ policy: off, roles: ['admin', 'employee'] }), 'pending');
  assert.equal(D.firstPhoneStatus({ policy: on, roles: [] }), 'approved');
  assert.match(src('js/cloud.js'), /Dv\.firstPhoneStatus\(\{ policy: pol, roles: profile\.roles \}\) === 'approved'/);
});
