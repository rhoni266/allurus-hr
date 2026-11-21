// A returning person is never signed out by a failure that is not a sign-out (3.84 incident: accounts = [] with the uid still there).
// The behaviour itself is tests-e2e/inventory.e2e.js section 9 (browser storage full, against the emulators); these guard the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('js/app.js'), cloud = read('js/cloud.js');

test('a workspace just built from the cloud is never read back from browser storage', () => {
  const adopt = app.slice(app.indexOf('adoptCloud(ws, p) {'), app.indexOf('// Show changes that arrived from elsewhere'));
  assert.ok(adopt.includes('state = hydrate(JSON.parse(JSON.stringify(s)))'), 'built in memory');
  assert.ok(!/state = load\(\)/.test(adopt), 'not load(), which reads storage');
  assert.ok(app.includes('function hydrate(s) {') && /return hydrate\(s\);\s*\}/.test(app), 'load() = read storage + hydrate');
  assert.ok(adopt.includes('let stored = true') && adopt.includes('can’t keep a copy'));
});

test('while the cloud answers: "Signing you in…" whenever a cloud sign-in is remembered, even with no account yet', () => {
  assert.ok(app.includes('let cloudWaiting = CLOUD && (!!state.session.cloud?.uid || hasStaffSess())'));
  assert.ok(app.includes('<h1>Signing you in…</h1>'));
});

test('a failure to open the workspace is retried and then reported with Try again; it never signs the person out', () => {
  assert.ok(cloud.includes('for (let attempt = 0; attempt < 3; attempt++)'));
  assert.ok(cloud.includes('app.cloudFailed('));
  const resume = cloud.slice(cloud.indexOf('A returning person is only shown the sign-in page'), cloud.indexOf("app.cloudReady('signed-out');\n});"));
  assert.ok(resume.indexOf('app.cloudFailed(') < resume.length && !/catch \(e\) \{[^}]*cloudReady\('signed-out'\)/.test(resume), 'a thrown error does not go to the signed-out branch');
  assert.ok(app.includes('Couldn’t open your workspace') && app.includes("'cloud-retry'") && app.includes('cloudFailed(why)'));
  assert.ok(app.includes("if (!state.accounts[0]) { this.cloudFailed('no account'); return; }"), 'no accounts is a failure to report, not a silent logout');
});
