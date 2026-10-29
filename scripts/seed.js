// Load the starter catalogue (seed/*.json) into Firestore: modules, features, industries, their links and the finder
// scoring. Safe by default: documents that already exist are left alone (so superadmin edits are never undone).
//   npm run seed              add what's missing, report what was skipped
//   npm run seed -- --dry-run show what would be written, write nothing
//   npm run seed -- --force   overwrite existing documents with the seed version (asks you to type "overwrite")
// Every document written gets an audit-log entry with actor "seed-script".
const readline = require('readline');
const { admin } = require('./admin');
const F = require('../seed/features.json');
const I = require('../seed/industries.json');
const R = require('../seed/finderRules.json');

const dry = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

function docs() {
  const out = [];
  for (const m of F.modules) out.push(['modules', m.key, 'module', { key: m.key, name: m.name, order: m.order }]);
  for (const f of F.features) out.push(['features', f.key, 'feature', { key: f.key, name: f.name, description: f.description || '', moduleKey: f.moduleKey, status: f.status, icon: f.icon || '', isAddon: !!f.isAddon, dependsOn: f.dependsOn || [], archived: false }]);
  const areaKeys = F.features.filter((f) => f.key.startsWith('area.')).map((f) => f.key);
  for (const i of I.industries) {
    const { features, ...rest } = i;
    out.push(['industries', i.slug, 'industry', { ...rest, illustration: i.illustration || '', archived: false }]);
    features.forEach((f, n) => out.push(['industryFeatures', `${i.slug}_${f.key}`, 'industryFeature', {
      industryId: i.slug, featureId: f.key, linked: true, showPublic: true, isHeadline: !!f.headline, customLabel: f.label || '', customDescription: '', order: n,
    }]));
    // Core app areas: on for every industry, hidden from the public page. Superadmin can switch one off per industry.
    for (const k of areaKeys) if (!features.some((f) => f.key === k)) out.push(['industryFeatures', `${i.slug}_${k}`, 'industryFeature', {
      industryId: i.slug, featureId: k, linked: true, showPublic: false, isHeadline: false, customLabel: '', customDescription: '', order: 90,
    }]);
  }
  for (const q of R.questions) q.options.forEach((o, n) => out.push(['finderRules', `${q.id}_${o.id}`, 'finderRule', {
    questionId: q.id, questionText: q.text, questionOrder: q.order, optionId: o.id, optionText: o.text, optionOrder: n, reason: o.reason || '', points: o.points,
  }]));
  return out;
}

const ask = (q) => new Promise((res) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); res(a); }); });

(async () => {
  const fb = admin();
  const db = fb.firestore();
  const now = fb.firestore.FieldValue.serverTimestamp();
  const list = docs();
  const existing = await Promise.all(list.map(([c, id]) => db.collection(c).doc(id).get()));
  const toWrite = list.filter((_, n) => force || !existing[n].exists);
  const skipped = list.length - toWrite.length;
  console.log(`${list.length} seed documents: ${toWrite.length} to write, ${skipped} already exist${force ? ' (will be OVERWRITTEN)' : ' (left alone)'}.`);
  if (dry || !toWrite.length) { if (dry) for (const [c, id] of toWrite) console.log(`  would write ${c}/${id}`); process.exit(0); }
  if (force && existing.some((d) => d.exists) && (await ask('Type "overwrite" to replace existing documents: ')).trim() !== 'overwrite') { console.log('Cancelled.'); process.exit(1); }
  for (let i = 0; i < toWrite.length; i += 200) {
    const batch = db.batch();
    for (const [c, id, type, data] of toWrite.slice(i, i + 200)) {
      const before = existing[list.findIndex((x) => x[0] === c && x[1] === id)];
      const audit = db.collection('auditLog').doc();
      batch.set(audit, { actorUid: 'seed-script', actorEmail: 'seed-script', action: before.exists ? 'seed-overwrite' : 'seed-create', entityType: type, entityId: id,
        before: before.exists ? before.data() : null, after: data, createdAt: now });
      batch.set(db.collection(c).doc(id), { ...data, lastAuditId: audit.id, createdAt: before.exists ? before.data().createdAt || now : now, updatedAt: now });
    }
    await batch.commit();
  }
  console.log(`Done: wrote ${toWrite.length} documents.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
