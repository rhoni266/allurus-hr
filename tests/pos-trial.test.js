// js/pos-trial.js: the "Start POS trial" flow (POS-LIVE-APPSCRIPT-SPEC.md section 4) - provision the company's
// Google Sheet through the central Apps Script server, then set addons.pos, matching firestore.rules' validated
// shape exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, Date: Date, JSON: JSON };
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

test('provision(): posts { idToken, tenantId, action: provision, data } and returns the spreadsheet result', async () => {
  const calls = [];
  const fakeFetch = (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ ok: true, data: { spreadsheetId: 'ss-1', created: true } })) });
  };
  const out = await PosTrial.provision({ apiUrl: 'https://script.google.com/x/exec', idToken: 'tok', tenantId: 'tA', data: { outletName: 'Kedai A' }, fetch: fakeFetch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://script.google.com/x/exec');
  assert.equal(calls[0].body.action, 'provision');
  assert.equal(calls[0].body.tenantId, 'tA');
  assert.equal(calls[0].body.idToken, 'tok');
  assert.equal(calls[0].body.data.outletName, 'Kedai A');
  assert.deepEqual(out, { spreadsheetId: 'ss-1', created: true });
});

test('provision(): a server error ({ ok: false }) rejects with its message', async () => {
  const fakeFetch = () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ ok: false, error: 'Only an Owner or a Settings admin can start the POS trial.' })) });
  await assert.rejects(
    PosTrial.provision({ apiUrl: 'x', idToken: 't', tenantId: 'tA', data: {}, fetch: fakeFetch }),
    /Only an Owner or a Settings admin/
  );
});

test('start(): provisions first, then updateDoc writes addons.pos only, nothing else', async () => {
  const fakeFetch = () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ ok: true, data: { spreadsheetId: 'ss-9', created: true } })) });
  const updateCalls = [];
  const fakeUpdateDoc = (ref, data) => { updateCalls.push({ ref, data }); return Promise.resolve(); };
  const out = await PosTrial.start({
    apiUrl: 'https://script.google.com/x/exec', idToken: 'tok', tenantId: 'tA', uid: 'uid-9',
    data: { outletName: 'Kedai A', sampleMenu: true }, updateDoc: fakeUpdateDoc, tenantDocRef: 'tenants/tA', fetch: fakeFetch
  });
  assert.deepEqual(out, { spreadsheetId: 'ss-9', created: true });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].ref, 'tenants/tA');
  assert.deepEqual(Object.keys(updateCalls[0].data), ['addons']);
  assert.deepEqual(Object.keys(updateCalls[0].data.addons), ['pos']);
  assert.equal(updateCalls[0].data.addons.pos.status, 'trial');
  assert.equal(updateCalls[0].data.addons.pos.startedBy, 'uid-9');
});

test('start(): if provisioning fails, addons.pos is never written', async () => {
  const fakeFetch = () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ ok: false, error: 'Not allowed' })) });
  const updateCalls = [];
  const fakeUpdateDoc = (ref, data) => { updateCalls.push({ ref, data }); return Promise.resolve(); };
  await assert.rejects(PosTrial.start({
    apiUrl: 'x', idToken: 't', tenantId: 'tA', uid: 'u', data: {}, updateDoc: fakeUpdateDoc, tenantDocRef: 'tenants/tA', fetch: fakeFetch
  }));
  assert.equal(updateCalls.length, 0);
});
