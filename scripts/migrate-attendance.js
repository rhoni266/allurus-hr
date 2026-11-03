// Splits each company's attendance into one bucket per person per month ("attendance~2026-11~e5", class
// 'u:time:e5'), readable only by that person and the time area. The old month-wide buckets ("attendance~2026-11")
// are kept as admin-only backups (class 'a'); the app no longer reads them.
//
//   node scripts/migrate-attendance.js                 dry run: reads only, prints counts (no names)
//   node scripts/migrate-attendance.js --tenant co1    dry run for one company
//   node scripts/migrate-attendance.js --apply         writes (after the dry run has been checked)
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;

(async () => {
  const db = admin().firestore();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  const total = { months: 0, records: 0, buckets: 0 };
  for (const t of tenants) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); continue; }
    const all = await db.collection(`tenants/${t.id}/buckets`).get();
    const months = all.docs.filter((d) => /^attendance~\d{4}-\d{2}$/.test(d.id));
    if (!months.length) continue;
    const writes = [];
    let recs = 0;
    months.forEach((d) => {
      const m = d.id.split('~')[1], f = d.data().f || {}, per = {};
      Object.keys(f).forEach((k) => { const emp = k.split('|')[1]; if (!emp) return; (per[emp] = per[emp] || {})[k] = f[k]; recs++; });
      Object.entries(per).forEach(([emp, fields]) => writes.push([`buckets/attendance~${m}~${emp}`, { t: 'm', r: `u:time:${emp}`, f: fields }]));
      if (d.data().r !== 'a') writes.push([`buckets/${d.id}`, { r: 'a' }]);
    });
    const people = writes.filter(([p]) => p.split('~').length === 3).length;
    console.log(`${t.id}: ${months.length} months, ${recs} day records → ${people} person-month buckets; old month buckets kept as admin-only backups`);
    Object.assign(total, { months: total.months + months.length, records: total.records + recs, buckets: total.buckets + people });
    if (!APPLY) continue;
    for (let k = 0; k < writes.length; k += 300) { const b = db.batch(); writes.slice(k, k + 300).forEach(([p, data]) => b.set(db.doc(`tenants/${t.id}/${p}`), data, { merge: true })); await b.commit(); }
    console.log(`${t.id}: done.`);
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing written)'}: ${total.months} months, ${total.records} day records, ${total.buckets} person-month buckets.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });