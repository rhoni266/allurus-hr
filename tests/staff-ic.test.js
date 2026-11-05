// IC sign-in helpers in js/cloud-map.js (the email format must match firestore.rules staffJoin).
const test = require('node:test');
const assert = require('assert');
require('../js/cloud-map.js');
const M = globalThis.AllurusCloudMap;

test('the made-up email: IC digits, lowercase company id, generation', () => {
  assert.strictEqual(M.staffEmail('900101-14-5678', 'Co1X', 2), '900101145678.co1x.g2@staff.allurus.invalid');
  assert.match(M.staffEmail('900101145678', 'aBc_9-Z', 1), /^[0-9]{12}[.][a-z0-9_-]+[.]g[0-9]{1,4}@staff[.]allurus[.]invalid$/);
  assert.ok(M.isStaffEmail('900101145678.co1x.g1@STAFF.allurus.invalid'));
  assert.ok(!M.isStaffEmail('a@co1.my'));
});

test('IC check, keys, company codes and join secrets', () => {
  assert.ok(M.validIc('900101-14-5678'));
  assert.ok(!M.validIc('90010114567'));
  assert.ok(!M.validIc('A00101145678'));
  assert.strictEqual(M.staffKey('Co1X', '900101 14 5678'), 'Co1X~900101145678');
  assert.match(M.companyCode('Major Far East Sdn Bhd', () => 0.5), /^[a-z0-9]{3,12}$/);
  assert.strictEqual(M.companyCode('Major Far East', () => 0), 'majorf100');
  assert.match(M.companyCode('123', () => 0.99), /^co\d{3}$/);
  const s = M.joinSecret(new Uint8Array(32).map((_, i) => i * 7));
  assert.strictEqual(s.length, 32);
  assert.match(s, /^[a-z2-9]+$/);
});

test('join key: only a salted sha256 in hex; the same key and salt give the same proof, a new salt a new one', async () => {
  const nodeCrypto = require('crypto');
  const want = nodeCrypto.createHash('sha256').update('0123456789abcdef0123456789abcdef:Kunci Kilang 2026').digest('hex');
  assert.strictEqual(await M.joinKeyHash('0123456789abcdef0123456789abcdef', '  Kunci Kilang 2026 '), want);   // trimmed
  assert.notStrictEqual(await M.joinKeyHash('f'.repeat(32), 'Kunci Kilang 2026'), want);
  assert.match(M.newSalt(new Uint8Array(16).fill(171)), /^[0-9a-f]{32}$/);
});

test('join key warning: short, digits only, common words or the company name', () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const sb = { window: {} }; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'invite-rules.js'), 'utf8'), sb);
  const W = sb.window.AllurusInvite.joinKeyWarning;
  assert.match(W('abc'), /short/);
  assert.match(W('12345678'), /digits/);
  assert.match(W('Password2026'), /common word/);
  assert.match(W('MajorFar!77', 'Major Far East Sdn Bhd'), /company name/);
  assert.strictEqual(W('Teh-Ais-Limau-41'), '');
});

test('persistent device binding: getDeviceId returns valid dev- id and syncs both storage keys', () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  globalThis.document = { cookie: '' };

  const id = M.getDeviceId();
  assert.ok(id.startsWith('dev-'), 'id must start with dev-');
  assert.strictEqual(store[M.DEVICE_KEY_A], id);
  assert.strictEqual(store[M.DEVICE_KEY_B], id);
  assert.ok(globalThis.document.cookie.includes(id));

  // If one key was already set, getDeviceId preserves it
  store[M.DEVICE_KEY_A] = 'dev-existing-phone-123';
  delete store[M.DEVICE_KEY_B];
  const preserved = M.getDeviceId();
  assert.strictEqual(preserved, 'dev-existing-phone-123');
  assert.strictEqual(store[M.DEVICE_KEY_B], 'dev-existing-phone-123');

  delete globalThis.localStorage;
  delete globalThis.document;
});
