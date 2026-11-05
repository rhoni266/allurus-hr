const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/cloud-map.js');
const M = global.AllurusCloudMap;

test('phone: normalised the way the join page saves it', () => {
  assert.equal(M.normPhone('012-345 6789'), '0123456789');
  assert.equal(M.normPhone('+60 12-345 6789'), '0123456789');
  assert.equal(M.normPhone('601123456789'), '01123456789');
  assert.equal(M.normPhone('+44 7700 900123'), '+447700900123');
  assert.equal(M.normPhone(''), '');
});

test('phone: Malaysian mobiles 10 to 12 digits, or + and a country code (max 16 characters)', () => {
  for (const ok of ['0123456789', '01123456789', '011234567890', '+447700900123', '+6591234567']) assert.ok(M.validPhone(ok), ok);
  for (const bad of ['0123', '0312345678', '01234567890123', '+0123456', '+12345678901234567', 'abc', '']) assert.ok(!M.validPhone(bad), bad);
});

test('phone: shown as 012-345 6789', () => {
  assert.equal(M.fmtPhone('0123456789'), '012-345 6789');
  assert.equal(M.fmtPhone('01123456789'), '011-2345 6789');
  assert.equal(M.fmtPhone('+447700900123'), '+447700900123');
});
