// Moves each company's leave requests and claims from the shared buckets into one document each (tenants/{t}/leaves,
// with a safe calendar copy in leaveCal; tenants/{t}/claims), so firestore.rules can stop anyone deciding their own.
// The old buckets are kept as admin-only backups (class 'a'); the app no longer reads them.
//
//   node scripts/migrate-requests.js                 dry run: reads only, prints counts (no names)
//   node scripts/migrate-requests.js --tenant co1    dry run for one company
//   node scripts/migrate-requests.js --apply         writes (after the dry run has been checked)
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const approverIds = (l) => [...new Set((l.chain || []).flatMap((s) => [s.approver, s.backup]).filter((x) => x && x !== l.empId))];

(async () => {
  const fb = admin(), db = fb.firestore(), now = fb.firestore.FieldValue.serverTimestamp();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  const total = { found: 0, move: 0, already: 0, bad: 0 };
  for (const t of tenants) for (const [list, withCal] of [['leaves', true], ['claims', false]]) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); break; }
    const s = await db.doc(`tenants/${t.id}/buckets/${list}`).get();
    if (!s.exists) continue;
    const f = s.data().f || {};
    const recs = Object.keys(f).filter((k) => k !== '~ord' && k !== '_').map((k) => { try { return JSON.parse(f[k]); } catch (e) { return null; } });
    const existing = new Set((await db.collection(`tenants/${t.id}/${list}`).select().get()).docs.map((d) => d.id));
    const okRec = (l) => l && l.id && l.empId && (!withCal || (l.from && l.to));
    const move = recs.filter((l) => okRec(l) && !existing.has(l.id));
    const bad = recs.filter((l) => !okRec(l)).length;
    const by = (st) => move.filter((l) => l.status === st).length;
    console.log(`${t.id} ${list}: ${recs.length} found · move ${move.length} (Pending ${by('Pending')}, Approved ${by('Approved')}, Rejected ${by('Rejected')}) · already moved ${recs.length - move.length - bad}${bad ? ` · incomplete, not moved: ${bad}` : ''} · old bucket kept as admin-only backup`);
    Object.assign(total, { found: total.found + recs.length, move: total.move + move.length, already: total.already + (recs.length - move.length - bad), bad: total.bad + bad });
    if (!APPLY) continue;
    for (let k = 0; k < move.length; k += 200) {
      const b = db.batch();
      move.slice(k, k + 200).forEach((l) => {
        const { id, ...rest } = l;
        b.set(db.doc(`tenants/${t.id}/${list}/${id}`), { ...rest, approverIds: approverIds(l), v: 1, createdBy: 'migration', createdAt: now, updatedBy: 'migration', updatedAt: now });
        if (withCal) b.set(db.doc(`tenants/${t.id}/leaveCal/${id}`), { empId: l.empId, from: l.from, to: l.to, half: l.half || '', status: l.status });
      });
      await b.commit();
    }
    if (s.data().r !== 'a') await db.doc(`tenants/${t.id}/buckets/${list}`).set({ r: 'a' }, { merge: true });
    console.log(`${t.id} ${list}: moved ${move.length}.`);
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing written)'}: ${total.found} found, ${total.move} ${APPLY ? 'moved' : 'to move'}, ${total.already} already moved, ${total.bad} left for a person to check.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
