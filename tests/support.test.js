// Allurus support: what a change looks like in the client's support log. No secret or pay/ID value, no full IC,
// no join link ever appears in it. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../js/cloud-map.js');
const M = globalThis.AllurusCloudMap;

test('a plain change: field, old value, new value', () => {
  const c = M.supportChanges({ role: '"Crew"', first: '"Ali"' }, { role: '"Supervisor"', first: '"Ali"' });
  assert.deepEqual(c, [{ field: 'role', from: 'Crew', to: 'Supervisor' }]);
});

test('pay and ID fields, secrets, full ICs and join links never appear as values', () => {
  const before = { ic: '"900101145678"', salary: '36000', accountNo: '"1234567890"', password: '"x"', keyProof: '"ab"', role: '"Crew"', _support: 'L1', '~o': '3' };
  const after = { ic: '"900101149999"', salary: '40000', accountNo: '"1111"', password: '"y"', keyProof: '"cd"', role: '"Crew"', note: '"IC 880202145678, link https://allurus.my/join?k=abcdefabcdefabcdefabcdef"' };
  const c = M.supportChanges(before, after);
  const text = JSON.stringify(c);
  for (const leak of ['900101145678', '900101149999', '36000', '40000', '1234567890', '880202145678', 'join?k=', '"x"', '"y"']) assert.ok(!text.includes(leak), `leaked ${leak}`);
  assert.ok(!c.some((x) => x.field === '_support' || x.field === '~o'));
  assert.equal(c.find((x) => x.field === 'ic').to, '(pay or ID data)');
  assert.equal(c.find((x) => x.field === 'password').to, '(hidden)');
  assert.match(c.find((x) => x.field === 'note').to, /••••••••5678.*\(join link\)/);
});

test('records inside a list: nested pay/ID and secret keys are hidden too', () => {
  const rec = (o) => JSON.stringify({ id: 'e3', first: 'Ali', ...o });
  const c = M.supportChanges({ e3: rec({ salary: 3000 }) }, { e3: rec({ salary: 3500, pin: '123456', bank: 'Maybank' }) });
  const t = JSON.stringify(c);
  assert.ok(!t.includes('3500') && !t.includes('123456') && !t.includes('Maybank'), t);
  assert.match(t, /pay or ID data/);
});

test('long values are cut short; at most 200 changes per entry', () => {
  const c = M.supportChanges({ a: JSON.stringify('x'.repeat(1000)) }, { a: '"y"' });
  assert.ok(c[0].from.length <= 160);
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, `"${i}"`]));
  assert.equal(M.supportChanges({}, many).length, 200);
});

test('the client notice: "Allurus support opened your company"', () => {
  const sb = { window: {} }; vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'notify-rules.js'), 'utf8'), sb);
  const N = sb.window.AllurusNotifyRules;
  assert.equal(N.build('support.opened', {}).title, 'Allurus support opened your company');
  // It follows each admin's notice settings: with email notices on (the default) in the app and by email; with
  // them off, nothing is emailed.
  const on = N.deliver('support.opened', {}, [{ id: 'a', email: 'a@x.my', prefs: {} }], { ids: () => '1', self: true });
  assert.equal(on.notifications.length, 1); assert.equal(on.emails.length, 1);
  const off = N.deliver('support.opened', {}, [{ id: 'b', email: 'b@x.my', prefs: { requests: 'off' } }], { ids: () => '2', self: true });
  assert.equal(off.emails.length, 0);
});
