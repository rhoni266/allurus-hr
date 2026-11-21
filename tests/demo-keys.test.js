// Demo companies' local copies are removed after a real (cloud) sign-in succeeds, and only those four keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function world(keys) {
  const m = new Map(Object.entries(keys));
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
  Object.keys = ((o) => (k) => (k === ls ? [...m.keys()] : o(k)))(Object.keys);
  const sb = { localStorage: ls, sessionStorage: { clear() {}, length: 0 }, document: { cookie: '' }, location: { hostname: 'x' }, window: undefined }; sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(read('js/session-clear.js'), sb);
  return { S: sb.AllurusSession, m };
}
const ALL = { 'allurus-hr-suria-v1': '1', 'allurus-hr-majorfe-v1': '2', 'allurus-hr-banafsha-v1': '3', 'allurus-hr-v9': '4', 'allurus-hr-cloud-v1': 'CLOUD', allurus_pos_demo_v1: 'POS', other: 'x' };

test('clearDemoData removes the four demo keys and nothing else', () => {
  const { S, m } = world(ALL);
  assert.deepEqual(Array.from(S.DEMO_KEYS).sort(), ['allurus-hr-banafsha-v1', 'allurus-hr-majorfe-v1', 'allurus-hr-suria-v1', 'allurus-hr-v9']);
  const gone = S.clearDemoData();
  assert.deepEqual(Array.from(gone).sort(), Array.from(S.DEMO_KEYS).sort());
  assert.equal(m.get('allurus-hr-cloud-v1'), 'CLOUD', 'the cloud workspace is untouched');
  assert.equal(m.get('allurus_pos_demo_v1'), 'POS', 'the POS demo is untouched');
  assert.equal(m.get('other'), 'x');
  assert.equal(S.clearDemoData().length, 0, 'nothing left, no error');
});

test('sign-out does not remove the demo copies (they are not a person\'s data)', () => {
  const { S, m } = world(ALL);
  S.clearLocal();
  assert.ok(m.has('allurus-hr-suria-v1') && m.has('allurus_pos_demo_v1'));
});

test('it runs once adoptCloud has built the signed-in state, and nowhere a sign-in can fail', () => {
  const app = read('js/app.js'), cloud = read('js/cloud.js');
  const adopt = app.slice(app.indexOf('adoptCloud(ws, p) {'), app.indexOf('// Show changes that arrived from elsewhere'));
  assert.ok(adopt.includes('AllurusSession?.clearDemoData()'));
  assert.ok(adopt.indexOf('state = hydrate(') < adopt.indexOf('clearDemoData'), 'after the state was built');
  assert.equal((app.match(/clearDemoData\(\)/g) || []).length, 1, 'only here');
  assert.ok(!cloud.includes('clearDemoData'), 'not in the cloud sign-in and error paths');
  const cr = app.slice(app.indexOf('cloudReady(reason) {'), app.indexOf('cloudReady(reason) {') + 900);
  assert.ok(!cr.includes('clearDemoData'), 'not on the signed-out path');
});
