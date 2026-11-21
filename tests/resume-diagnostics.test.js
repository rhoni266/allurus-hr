// Resume failures are traceable (full stack in the console and under "Details for support"), a slow cloud gets Try again, and no
// demo seed reads .flexible off a missing pattern.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('js/app.js'), cloud = read('js/cloud.js');

test('the resume catch logs the full stack and hands it to the error screen', () => {
  assert.ok(cloud.includes("e?.stack || '(no stack)'"));
  assert.ok(cloud.includes("app.cloudFailed(lastErr.code || lastErr.message || 'unknown error', lastErr.stack || '')"));
  assert.ok(app.includes('cloudFailed(why, stack = \'\')') && app.includes('Details for support') && app.includes('esc(cloudError.stack)'));
});

test('"Signing you in…" turns into a slow notice with Try again and Sign out after the time limit', () => {
  assert.ok(/CLOUD_SLOW_MS = Number\(window\.ALLURUS_CLOUD_SLOW_MS\) \|\| 20000/.test(app));
  assert.ok(app.includes('if (cloudWaiting) setTimeout(() => { if (cloudWaiting) { cloudSlow = true; render(); } }, CLOUD_SLOW_MS)'));
  assert.ok(app.includes('taking longer than usual') && /cloudSlow \?[^`]*data-act="cloud-retry"/.test(app));
});

test('no .flexible read is left on a value that can be null (seeds included)', () => {
  const seed = read('js/seed.js');
  assert.ok(/const p = shiftOf\(e, day\);\s*if \(!p\) return;/.test(seed));
});

test('cloud.js and app.js still parse (a stray line break in a string once stopped the whole cloud module loading)', () => {
  const os = require('node:os'), cp = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-'));
  try {
    fs.writeFileSync(path.join(dir, 'cloud.mjs'), cloud);
    fs.writeFileSync(path.join(dir, 'app.js'), app);
    cp.execFileSync(process.execPath, ['--check', path.join(dir, 'cloud.mjs')]);
    cp.execFileSync(process.execPath, ['--check', path.join(dir, 'app.js')]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
