// scripts/set-owner.js against a fake Firestore: check-only changes nothing, --yes makes exactly one person Owner,
// and it refuses pending, disabled or ambiguous matches. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'set-owner.js');
const PRE = path.join(__dirname, 'fixtures', 'fake-admin.js');
const base = (users, tenant = {}) => ({ tenants: { t1: { name: 'Contoh Kilang Sdn Bhd', owner: '', admin: 'boss@contoh.my', ...tenant }, t2: { name: 'Lain Co' } }, users });
function run(db, ...args) {
  const out = path.join(os.tmpdir(), `owner-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, ['-r', PRE, SCRIPT, ...args], { env: { ...process.env, FAKE_DB: JSON.stringify(db), FAKE_OUT: out }, encoding: 'utf8' });
  const after = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  if (after) fs.unlinkSync(out);
  return { code: r.status, text: r.stdout + r.stderr, after };
}
const ali = { tenantId: 't1', name: 'Ali Bakar', email: 'ali@contoh.my', roles: ['employee'] };
const hr = { tenantId: 't1', name: 'Siti HR', email: 'siti@contoh.my', roles: ['admin', 'employee'], perms: ['people'] };

test('check only: shows the plan and changes nothing', () => {
  const r = run(base({ u1: ali, u2: hr }), 'Contoh Kilang', 'Ali');
  assert.equal(r.code, 0);
  assert.match(r.text, /Owners now: NONE/);
  assert.match(r.text, /Check only, nothing changed/);
  assert.equal(r.after, null);
});

test('--yes makes that one person Owner (admin, no perms list) and claims the company; nobody else changes', () => {
  const r = run(base({ u1: ali, u2: hr }), 'Contoh Kilang', 'Ali', '--yes');
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.after.users.u1.roles, ['employee', 'admin']);
  assert.equal('perms' in r.after.users.u1, false);
  assert.equal(r.after.tenants.t1.owner, 'u1');
  assert.deepEqual(r.after.users.u2, hr);
});

test('a company already claimed keeps its recorded owner', () => {
  const r = run(base({ u1: ali, u2: hr }, { owner: 'u9' }), 't1', 'Ali', '--yes');
  assert.equal(r.code, 0, r.text);
  assert.equal(r.after.tenants.t1.owner, 'u9');
  assert.equal('perms' in r.after.users.u1, false);
});

test('refuses pending, disabled, unknown and ambiguous people, and changes nothing', () => {
  assert.match(run(base({ u1: { ...ali, pending: true } }), 't1', 'Ali', '--yes').text, /waiting for HR approval/);
  assert.match(run(base({ u1: { ...ali, disabled: true } }), 't1', 'Ali', '--yes').text, /turned off/);
  assert.match(run(base({ u1: ali }), 't1', 'Nobody', '--yes').text, /No Allurus sign-in/);
  const two = run(base({ u1: ali, u3: { ...ali, email: 'ali2@contoh.my' } }), 't1', 'Ali', '--yes');
  assert.match(two.text, /More than one account matches/);
  assert.equal(two.after, null);
  assert.match(run(base({ u1: ali }), 'Co', 'Ali').text, /More than one company matches/);
});
