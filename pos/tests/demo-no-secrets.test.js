// POS-DEMO-SPEC.md: "Add a test that fails if a deployed file contains SECRET_KEY with a value, a
// script.google.com/macros URL, or a file named config.js under the public demo path." firebase.json controls what
// Firebase Hosting actually serves; this checks both that config, and the files it leaves public.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const POS = path.join(__dirname, '..');

// Directories under pos/ that firebase.json keeps out of the public deploy (the real backend's source, tests, and
// docs - see the "ignore" list). Walked here with the same exclusions, so this test checks what visitors can
// actually fetch, not the whole repo.
const EXCLUDED_DIRS = new Set(['apps-script', 'tests', 'docs', 'tools', 'node_modules', '.git']);

function publicPosFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...publicPosFiles(path.join(dir, entry.name)));
    } else if (entry.name !== 'config.js' && !entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

test('firebase.json keeps pos/config.js and the Apps Script source out of the public deploy', () => {
  const fb = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  const ignore = fb.hosting.find((h) => h.target === 'main').ignore;
  assert.ok(ignore.includes('pos/config.js'), 'firebase.json hosting.ignore must list pos/config.js');
  assert.ok(ignore.includes('pos/apps-script/**'), 'firebase.json hosting.ignore must list pos/apps-script/**');
  assert.ok(ignore.includes('pos/tests/**'), 'firebase.json hosting.ignore must list pos/tests/**');
});

test('pos/config.js is git-ignored, so a local setup (the owner runs one) can never be committed or deployed', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gitignore.split(/\r?\n/).includes('pos/config.js'), '.gitignore must list pos/config.js');
});

test('no publicly-deployed pos/ file contains a real Apps Script URL or a filled-in SECRET_KEY', () => {
  const files = publicPosFiles(POS);
  assert.ok(files.length > 10, 'sanity check: expected to find the demo and app files'); // catches a broken exclusion list silently returning nothing
  const offenders = [];
  files.forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const urls = text.match(/script\.google\.com\/macros\/s\/[^\s'")]+/g) || [];
    urls.filter((u) => !u.includes('PASTE_')).forEach((u) => offenders.push(`${file}: contains an Apps Script URL ("${u}")`));
    const m = text.match(/SECRET_KEY\s*[:=]\s*['"]([^'"]*)['"]/);
    if (m && !/^(PASTE_|test-|$)/.test(m[1])) offenders.push(`${file}: SECRET_KEY has a value that isn't a placeholder ("${m[1]}")`);
  });
  assert.deepEqual(offenders, []);
});
