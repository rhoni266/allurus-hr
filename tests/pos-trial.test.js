// js/pos-trial.js: the addons.pos payload POS-LIVE-FLOW-SPEC.md's "Start POS trial" writes, and that
// firestore.rules' validated tenants/{t} update rule checks (30 days, startedBy/startedAt this write).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, Date: Date };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'billing-rules.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'pos-trial.js'), 'utf8'), sandbox);
const PosTrial = sandbox.window.AllurusPosTrial;

test('trialPayload: 30 days from now, started by this uid, at this moment', () => {
  const now = Date.UTC(2026, 10, 7, 4, 0); // 2026-11-07 12:00 MYT
  const p = PosTrial.trialPayload('uid-123', now);
  assert.equal(p.status, 'trial');
  assert.equal(p.startedBy, 'uid-123');
  assert.equal(p.startedAt.getTime(), now);
  // Matches firestore.rules' own window: more than 29 days and less than 31 days from the write.
  const days = (p.trialEndsAt.getTime() - now) / 864e5;
  assert.ok(days > 29 && days < 31, `expected 29-31 days, got ${days}`);
});

test('start(): calls updateDoc with addons.pos only, nothing else', async () => {
  const calls = [];
  const fakeUpdateDoc = (ref, data) => { calls.push({ ref, data }); return Promise.resolve(); };
  await PosTrial.start(fakeUpdateDoc, 'tenants/t1', 'uid-9');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref, 'tenants/t1');
  assert.deepEqual(Object.keys(calls[0].data), ['addons']);
  assert.deepEqual(Object.keys(calls[0].data.addons), ['pos']);
  assert.equal(calls[0].data.addons.pos.status, 'trial');
  assert.equal(calls[0].data.addons.pos.startedBy, 'uid-9');
});
