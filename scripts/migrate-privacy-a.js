// Privacy phase A: moves existing company data to the new read classes (firestore.rules, js/cloud-map.js).
//   • grievances, candidates, requisitions → class 't' (talent area); statutory → 'p'; activity → 'a'
//   • documents and editRequests → one bucket per person ("documents~e5", class 'u:people:e5'); the old shared
//     bucket is kept as an admin-only backup (class 'a'), which the app no longer reads.
//
//   node scripts/migrate-privacy-a.js                 dry run: reads only, prints what it would do (no names)
//   node scripts/migrate-privacy-a.js --tenant co1    dry run for one company
//   node scripts/migrate-privacy-a.js --apply         writes (after the dry run has been checked)
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const RECLASS = { grievances: 't', candidates: 't', requisitions: 't', statutory: 'p', activity: 'a' };
const SPLIT = ['documents', 'editRequests'];

(async () => {
  const db = admin().firestore();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  const total = { reclass: 0, split: 0, people: 0, backups: 0 };
  for (const t of tenants) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); continue; }
    const writes = [], notes = [];
    for (const [id, r] of Object.entries(RECLASS)) {
      const s = await db.doc(`tenants/${t.id}/buckets/${id}`).get();
      if (s.exists && s.data().r !== r) { writes.push([`buckets/${id}`, { r }]); notes.push(`${id} ${s.data().r}→${r}`); total.reclass++; }
    }
    for (const list of SPLIT) {
      const s = await db.doc(`tenants/${t.id}/buckets/${list}`).get();
      if (!s.exists) continue;
      const f = s.data().f || {}, groups = {};
      Object.keys(f).filter((k) => k !== '~ord' && k !== '_').forEach((k) => {
        let rec; try { rec = JSON.parse(f[k]); } catch (e) { return; }
        const who = String(rec && rec.empId ? rec.empId : '_');
        (groups[who] = groups[who] || {})[k] = f[k];
      });
      Object.entries(groups).forEach(([who, fields]) => {
        writes.push([`buckets/${list}~${who}`, { t: 's', r: `u:people:${who}`, f: { ...fields, '~ord': JSON.stringify(Object.keys(fields)) } }]);
        total.people++;
      });
      if (s.data().r !== 'a') { writes.push([`buckets/${list}`, { r: 'a' }]); total.backups++; }
      notes.push(`${list}: ${Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0)} records → ${Object.keys(groups).length} people; old bucket kept as admin-only backup`);
      total.split++;
    }
    if (!writes.length) continue;
    console.log(`${t.id}: ${notes.join(' · ')}`);
    if (!APPLY) continue;
    const b = db.batch();
    writes.forEach(([p, data]) => b.set(db.doc(`tenants/${t.id}/${p}`), data, { merge: true }));
    await b.commit();
    console.log(`${t.id}: done (${writes.length} writes).`);
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing written)'}: ${total.reclass} lists re-classed, ${total.split} lists split into ${total.people} per-person buckets, ${total.backups} old buckets kept as admin-only backups.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
