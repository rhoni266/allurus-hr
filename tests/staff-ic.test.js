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
