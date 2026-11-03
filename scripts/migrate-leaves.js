// Moves each company's leave requests from the shared "leaves" bucket into one document each (tenants/{t}/leaves),
// with a safe calendar copy (tenants/{t}/leaveCal), so firestore.rules can stop anyone deciding their own request.
// The old bucket is kept as an admin-only backup (class 'a'); the app no longer reads it.
//
//   node scripts/migrate-leaves.js                 dry run: reads only, prints counts (no names)
//   node scripts/migrate-leaves.js --tenant co1    dry run for one company
//   node scripts/migrate-leaves.js --apply         writes (after the dry run has been checked)
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const approverIds = (l) => [...new Set((l.chain || []).flatMap((s) => [s.approver, s.backup]).filter((x) => x && x !== l.empId))];

(async () => {
  const fb = admin(), db = fb.firestore(), now = fb.firestore.FieldValue.serverTimestamp();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  const total = { found: 0, move: 0, already: 0, bad: 0 };
  for (const t of tenants) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); continue; }
    const s = await db.doc(`tenants/${t.id}/buckets/leaves`).get();
    if (!s.exists) continue;
    const f = s.data().f || {};
    const list = Object.keys(f).filter((k) => k !== '~ord' && k !== '_').map((k) => { try { return JSON.parse(f[k]); } catch (e) { return null; } });
    const existing = new Set((await db.collection(`tenants/${t.id}/leaves`).select().get()).docs.map((d) => d.id));
    const move = list.filter((l) => l && l.id && l.empId && l.from && l.to && !existing.has(l.id));
    const bad = list.filter((l) => !l || !l.id || !l.empId || !l.from || !l.to).length;
    const by = (st) => move.filter((l) => l.status === st).length;
    console.log(`${t.id}: ${list.length} found · move ${move.length} (Pending ${by('Pending')}, Approved ${by('Approved')}, Rejected ${by('Rejected')}) · already moved ${list.length - move.length - bad}${bad ? ` · incomplete, not moved: ${bad}` : ''} · old bucket kept as admin-only backup`);
    Object.assign(total, { found: total.found + list.length, move: total.move + move.length, already: total.already + (list.length - move.length - bad), bad: total.bad + bad });
    if (!APPLY) continue;
    for (let k = 0; k < move.length; k += 200) {
      const b = db.batch();
      move.slice(k, k + 200).forEach((l) => {
        const { id, ...rest } = l;
        b.set(db.doc(`tenants/${t.id}/leaves/${id}`), { ...rest, approverIds: approverIds(l), v: 1, createdBy: 'migration', createdAt: now, updatedBy: 'migration', updatedAt: now });
        b.set(db.doc(`tenants/${t.id}/leaveCal/${id}`), { empId: l.empId, from: l.from, to: l.to, half: l.half || '', status: l.status });
      });
      await b.commit();
    }
    if (s.data().r !== 'a') await db.doc(`tenants/${t.id}/buckets/leaves`).set({ r: 'a' }, { merge: true });
    console.log(`${t.id}: moved ${move.length}.`);
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing written)'}: ${total.found} found, ${total.move} ${APPLY ? 'moved' : 'to move'}, ${total.already} already moved, ${total.bad} left for a person to check.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
