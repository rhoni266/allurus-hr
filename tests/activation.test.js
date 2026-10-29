// Unit tests for activation: password rules (length, personal details, common passwords, breach check) and
// invitation status and expiry. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const sandbox = { window: {}, crypto: crypto.webcrypto, TextEncoder, fetch: () => Promise.reject(new Error('offline')) };
vm.createContext(sandbox);
for (const f of ['password-rules.js', 'invite-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox);
const P = sandbox.window.AllurusPassword, I = sandbox.window.AllurusInvite;
const common = new Set(fs.readFileSync(path.join(__dirname, '..', 'js', 'vendor', 'common-passwords.txt'), 'utf8').split('\n'));
const who = { email: 'siti.aminah@contoh.my', name: 'Siti Aminah binti Yusof', ic: '900101-14-5678', phone: '+60123456789' };
const failing = (pw) => JSON.parse(JSON.stringify(P.check(pw, who, common).rules.filter((r) => !r.ok).map((r) => r.id)));

test('7 weak, common and personal passwords are refused', () => {
  assert.deepEqual(failing('Kx9#tq2'), ['length']);
  assert.ok(failing('password123').includes('common'));
  assert.ok(failing('qwertyuiop').includes('common'));
  assert.ok(failing('siti.aminah@contoh.my').includes('personal'), 'the email itself');
  assert.ok(failing('Aminah2026!!').includes('personal'), 'part of the name');
  assert.ok(failing('Kopi900101145678').includes('personal'), 'the IC');
  assert.ok(failing('Teh0123456789x').includes('personal'), 'the phone');
  assert.ok(failing('aaaaaaaaaaaa').includes('varied'));
  assert.deepEqual(failing('Nasi-Lemak-Pedas-77'), []);
  assert.equal(common.size >= 9900, true);
});

test('breach check sends only the first 5 characters of the SHA-1 and reads the count', async () => {
  const pw = 'Nasi-Lemak-Pedas-77', h = (await P.sha1Hex(pw));
  let asked = '';
  const fake = async (url) => { asked = url; return { ok: true, text: async () => `0000000000000000000000000000000000A:3\n${h.slice(5)}:42\n` }; };
  assert.equal(await P.breachCount(pw, fake), 42);
  assert.equal(asked, `https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`);
  assert.ok(!asked.includes(h.slice(5)) && !asked.includes(pw));
  assert.equal(await P.breachCount(pw, async () => ({ ok: true, text: async () => 'ABC:1' })), 0);
  assert.equal(await P.breachCount(pw, async () => { throw new Error('offline'); }), null, 'offline: not blocking');
});

test('invitation status: not invited, invited, expired, active, disabled', () => {
  const now = Date.UTC(2026, 9, 29);
  assert.equal(I.status({ now }).key, 'none');
  const inv = { sentAt: now - 864e5, expiresAt: { seconds: (now + 6 * 864e5) / 1000 } };
  assert.equal(I.status({ invite: inv, now }).key, 'invited');
  assert.equal(I.status({ invite: inv, now: now + 7 * 864e5 }).key, 'expired');
  assert.equal(I.status({ user: { uid: 'u' }, invite: inv, now }).key, 'active');
  assert.equal(I.status({ user: { uid: 'u', disabled: true }, now }).key, 'disabled');
  assert.equal(I.usable(inv, now), true); assert.equal(I.usable({ ...inv, expiresAt: null }, now), false);
  assert.equal(Math.round((I.expiry(now).getTime() - now) / 864e5), 7);
});

test('the activation link carries only the company code, never email, IC or a code', () => {
  const l = I.link('https://allurus.my', 'abc123');
  assert.equal(l, 'https://allurus.my/activate?c=abc123');
});
