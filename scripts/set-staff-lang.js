// Set the default language of the employee app for one company (settings.staffApp.lang: "bm" or "en"), with an audit entry.
// The owner runs this. It only reads unless you add --yes. Staff can still switch language themselves on their phone.
//
//   node scripts/set-staff-lang.js "Major Far East" bm          check only: shows what it would do
//   node scripts/set-staff-lang.js "Major Far East" bm --yes    make the change
//
// Only the "lang" key of the company's staff-app settings is touched; the other switches stay as they are.
const { admin } = require('./admin');

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [target, lang] = args, YES = process.argv.includes('--yes');
  if (!target || !['bm', 'en'].includes(lang)) { console.log('Usage: node scripts/set-staff-lang.js "<Company name or id>" <bm|en> [--yes]'); process.exit(1); }
  const fb = admin(), db = fb.firestore();
  let snap = await db.collection('tenants').doc(target).get();
  if (!snap.exists) {
    const all = await db.collection('tenants').get(), q = target.toLowerCase();
    const hits = all.docs.filter((d) => (d.data().name || '').toLowerCase().includes(q));
    if (hits.length !== 1) { console.error(hits.length ? `More than one company matches "${target}": ${hits.map((d) => d.data().name).join(', ')}. Use the id.` : `No company matches "${target}".`); process.exit(1); }
    snap = hits[0];
  }
  const ref = db.doc(`tenants/${snap.id}/buckets/settings`), b = await ref.get();
  const f = b.exists ? (b.data().f || {}) : {};
  let cur = {}; try { cur = JSON.parse(f.staffApp || '{}') || {}; } catch (e) { cur = {}; }
  const now = cur.lang === 'bm' ? 'bm' : 'en';
  console.log(`Company: ${snap.data().name} (${snap.id})\nEmployee app default language is ${now} now. It will be ${lang}.`);
  if (now === lang) { console.log('Nothing to change.'); process.exit(0); }
  if (!b.exists) { console.error('This company has no settings record yet (nobody has saved Settings). Set it in Settings > Staff app instead.'); process.exit(1); }
  if (!YES) { console.log('Check only. Add --yes to do it.'); process.exit(0); }
  const batch = db.batch(), audit = db.collection('auditLog').doc();
  batch.set(audit, { actorUid: 'script:set-staff-lang', actorEmail: 'owner (command line)', action: `staffApp.lang ${lang}`, entityType: 'tenantSettings', entityId: snap.id, before: { lang: now }, after: { lang }, createdAt: fb.firestore.FieldValue.serverTimestamp() });
  batch.update(ref, { 'f.staffApp': JSON.stringify({ ...cur, lang }) });
  await batch.commit();
  console.log(`Done: the employee app now opens in ${lang === 'bm' ? 'Bahasa Malaysia' : 'English'} for ${snap.data().name}. Audit entry ${audit.id}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
