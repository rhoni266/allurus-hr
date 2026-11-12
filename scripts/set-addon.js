// Switch a company addon on or off (tenants/{t}.addons.<name>), with an audit entry, using the Firebase Admin SDK.
// The owner runs this. It only reads unless you add --yes.
//
//   node scripts/set-addon.js prodCommission "Major Far East"          check only: shows what it would do
//   node scripts/set-addon.js prodCommission "Major Far East" --yes    switch it ON
//   node scripts/set-addon.js prodCommission "Major Far East" --off --yes   switch it OFF
//
// prodCommission = the daily production commission (docs/PRODUCTION-COMMISSION-SPEC.md). Nothing else is touched.
const { admin } = require('./admin');

const ADDONS = { prodCommission: 'Daily production commission', simpleStaffHome: 'Simple staff screen (Check in, Apply leave, Payslip) on phones', salaryMonthlyOnly: 'Salaries are typed and shown as monthly only (cannot be switched to yearly)' };

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [name, target] = args;
  const YES = process.argv.includes('--yes'), OFF = process.argv.includes('--off');
  if (!ADDONS[name] || !target) { console.log(`Usage: node scripts/set-addon.js <${Object.keys(ADDONS).join('|')}> "<Company name or id>" [--off] [--yes]`); process.exit(1); }
  const fb = admin(), db = fb.firestore();
  let snap = await db.collection('tenants').doc(target).get();
  if (!snap.exists) {
    const all = await db.collection('tenants').get(), q = target.toLowerCase();
    const hits = all.docs.filter((d) => (d.data().name || '').toLowerCase().includes(q));
    if (hits.length !== 1) { console.error(hits.length ? `More than one company matches "${target}": ${hits.map((d) => d.data().name).join(', ')}. Use the id.` : `No company matches "${target}".`); process.exit(1); }
    snap = hits[0];
  }
  const t = snap.data(), now = !!(t.addons && t.addons[name] === true), want = !OFF;
  console.log(`Company: ${t.name} (${snap.id})\n${ADDONS[name]} is ${now ? 'ON' : 'off'} now. It will be ${want ? 'ON' : 'off'}.`);
  if (now === want) { console.log('Nothing to change.'); process.exit(0); }
  if (!YES) { console.log('Check only. Add --yes to do it.'); process.exit(0); }
  const batch = db.batch();
  const audit = db.collection('auditLog').doc();
  batch.set(audit, { actorUid: 'script:set-addon', actorEmail: 'owner (command line)', action: `${name} ${want ? 'on' : 'off'}`, entityType: 'tenantAddon', entityId: snap.id, before: { [name]: now }, after: { [name]: want }, createdAt: fb.firestore.FieldValue.serverTimestamp() });
  batch.update(snap.ref, { [`addons.${name}`]: want, lastAuditId: audit.id });
  await batch.commit();
  console.log(`Done: ${ADDONS[name]} is now ${want ? 'ON' : 'off'} for ${t.name}. Audit entry ${audit.id}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
