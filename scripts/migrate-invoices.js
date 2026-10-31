// Moves each company's invoices from the shared finance.invoices bucket into one document each
// (tenants/{t}/invoices/{id}), where firestore.rules can lock sent invoices.
//
//   node scripts/migrate-invoices.js                 dry run: reads only, prints what it would do (no names or emails)
//   node scripts/migrate-invoices.js --tenant co1    dry run for one company
//   node scripts/migrate-invoices.js --apply         writes (only after the dry run has been checked)
//
// Nothing is changed in the old bucket: it stays as a backup until the new screens have been checked.
// Statuses carry over (Draft stays editable; Sent and Paid stay locked); lines keep no unit (shown as "unit").
// Each invoice gets v: 1, and its number is held in invoiceNos. Two invoices with the same number (possible with
// the old numbering) are reported and NOT moved, so a person can choose which keeps the number.
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const STATUSES = new Set(['Draft', 'Sent', 'Paid', 'Issued']);

(async () => {
  const db = admin().firestore();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  let total = { found: 0, move: 0, already: 0, skipped: 0 };
  for (const t of tenants) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); continue; }
    const bucket = await db.doc(`tenants/${t.id}/buckets/finance.invoices`).get();
    const f = bucket.exists ? bucket.data().f || {} : {};
    const list = Object.keys(f).filter((k) => k !== '~ord' && k !== '_').map((k) => { try { return JSON.parse(f[k]); } catch (e) { return null; } }).filter(Boolean);
    if (!list.length) continue;
    const existing = new Set((await db.collection(`tenants/${t.id}/invoices`).select().get()).docs.map((d) => d.id));
    const byNo = new Map(); list.forEach((i) => byNo.set(i.no, (byNo.get(i.no) || 0) + 1));
    const rows = { move: [], already: 0, dupNo: [], bad: [] };
    for (const i of list) {
      if (existing.has(i.id)) { rows.already++; continue; }
      if (!i.id || !i.no || !STATUSES.has(i.status) || !Array.isArray(i.items) || !i.items.length) { rows.bad.push(i.no || i.id || '?'); continue; }
      if (byNo.get(i.no) > 1) { rows.dupNo.push(i.no); continue; }
      rows.move.push(i);
    }
    const count = (s) => rows.move.filter((i) => (i.type || 'invoice') === 'invoice' && i.status === s).length;
    console.log(`${t.id}: ${list.length} found · move ${rows.move.length} (Draft ${count('Draft')}, Sent ${count('Sent')}, Paid ${count('Paid')}, notes ${rows.move.filter((i) => (i.type || 'invoice') !== 'invoice').length})`
      + ` · already moved ${rows.already}${rows.dupNo.length ? ` · SAME NUMBER, not moved: ${[...new Set(rows.dupNo)].join(', ')}` : ''}${rows.bad.length ? ` · incomplete, not moved: ${rows.bad.join(', ')}` : ''}`);
    total.found += list.length; total.move += rows.move.length; total.already += rows.already; total.skipped += rows.dupNo.length + rows.bad.length;
    if (!APPLY) continue;
    for (let k = 0; k < rows.move.length; k += 200) {
      const b = db.batch(), now = admin().firestore.FieldValue.serverTimestamp();
      rows.move.slice(k, k + 200).forEach((i) => {
        const { id, ...rest } = i;
        b.set(db.doc(`tenants/${t.id}/invoices/${id}`), { ...rest, type: i.type || 'invoice', v: 1, createdBy: 'migration', createdAt: now, updatedBy: 'migration', updatedAt: now });
        b.set(db.doc(`tenants/${t.id}/invoiceNos/${i.no}`), { invoiceId: id });
      });
      await b.commit();
    }
    console.log(`${t.id}: moved ${rows.move.length}.`);
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing written)'}: ${total.found} found, ${total.move} ${APPLY ? 'moved' : 'to move'}, ${total.already} already moved, ${total.skipped} left for a person to check.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
