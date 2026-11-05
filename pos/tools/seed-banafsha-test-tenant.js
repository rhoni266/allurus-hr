// Puts a "Banafsha Café (test)" company with the 10 demo staff into the live allurus-hr Firestore, so the café POS
// trial can read its staff list from allurus-hr. Dry run by default (prints what it would write); --commit writes.
// Uses the admin service account (scripts/serviceAccount.json, git-ignored). Writes only:
//   tenants/banafsha-test                      { name, industry, isTest: true, status: 'active', ... }
//   tenants/banafsha-test/buckets/directory    the staff directory, in the same layout js/cloud.js writes
// Nothing else in Firestore is read or changed. Run: node pos/tools/seed-banafsha-test-tenant.js [--commit]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const sb = { console, TextEncoder };
sb.window = sb;
vm.createContext(sb);
for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'talent-rules', 'einvoice-rules', 'finance', 'tax', 'claims', 'planner', 'seed', 'ops-rules', 'seed-suria', 'seed-majorfe', 'pos-rules', 'seed-banafsha', 'cloud-map']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' });
}
const M = sb.AllurusCloudMap;
const b = sb.AllurusSeed.companies.banafsha.create();
const TENANT = 'banafsha-test';
const tenantDoc = { name: 'Banafsha Café (test)', industry: 'fnb', city: 'Kuala Lumpur', country: 'MY', plan: 'trial', status: 'active',
  isTest: true, createdVia: 'pos-trial-seed', createdAt: new Date().toISOString(), owner: null };
const dir = M.directoryFields(b.employees, () => {});
const dirDoc = { f: dir, t: 'a', r: 'm' }; // same shape cloud.js puts: fields under f, writer class t, read class r

console.log('Would write to project allurus-hr:');
console.log(`\ntenants/${TENANT}`, JSON.stringify(tenantDoc, null, 1));
console.log(`\ntenants/${TENANT}/buckets/directory: ${Object.keys(dir).length - 1} staff (+ "~ord"), read class "m"`);
b.employees.forEach((e) => console.log(`  ${e.id.padEnd(4)} ${(e.first + ' ' + e.last).padEnd(24)} ${String(e.role).padEnd(22)} ${e.status || 'Active'}`));

if (process.argv.includes('--commit')) {
  const admin = require(path.join(root, 'node_modules', 'firebase-admin'));
  admin.initializeApp({ credential: admin.credential.cert(require(path.join(root, 'scripts', 'serviceAccount.json'))) });
  const db = admin.firestore();
  (async () => {
    const t = db.doc(`tenants/${TENANT}`);
    if ((await t.get()).exists) { console.log('\ntenants/' + TENANT + ' already exists: not overwritten.'); process.exit(0); }
    await t.set(tenantDoc);
    await db.doc(`tenants/${TENANT}/buckets/directory`).set(dirDoc);
    console.log('\nWritten.');
    process.exit(0);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
