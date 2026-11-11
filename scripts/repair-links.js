// Repair for the 11 Nov 2026 incident. DRY RUN unless --yes. Changes no document ids and deletes nothing.
//   node scripts/repair-links.js "Major Far East"            dry run: counts only
//   node scripts/repair-links.js "Major Far East" --names    dry run, with the names of affected people (for the log)
//   node scripts/repair-links.js "Major Far East" --yes      apply
// 1. Employee records: wrapping quote marks left in text values (after decoding the database's own JSON encoding) are removed.
// 2. IC sign-ins with no valid employee link get users.empId = the real document id of the one record with that IC.
// NOT done on purpose: staffKeys is readable before sign-in, so it never carries a name or an empId (security review
// 2026-11-07, see js/cloud.js). The link lives on the sign-in's own users document, which only HR can change.
const { admin } = require('./admin');
const L = require('./repair-links-lib');

(async () => {
  const args = process.argv.slice(2), flags = args.filter((a) => a.startsWith('--')), target = args.find((a) => !a.startsWith('--'));
  const YES = flags.includes('--yes'), NAMES = flags.includes('--names');
  if (!target) { console.log('Usage: node scripts/repair-links.js "<company name or id>" [--names] [--yes]'); process.exit(1); }
  const db = admin().firestore();
  let t = await db.collection('tenants').doc(target).get();
  if (!t.exists) {
    const hits = (await db.collection('tenants').get()).docs.filter((d) => String(d.data().name || '').toLowerCase().includes(target.toLowerCase()));
    if (hits.length !== 1) { console.error(hits.length ? 'More than one company matches; use the id.' : 'No company matches.'); process.exit(1); }
    t = hits[0];
  }
  const tid = t.id, pDocs = (await db.collection(`tenants/${tid}/people`).get()).docs, dec = (v) => L.decode(v).value;
  const people = pDocs.map((d) => ({ id: d.id, ic: dec(d.data().ic), first: dec(d.data().first), last: dec(d.data().last) }));
  console.log(`${YES ? 'APPLY' : 'DRY RUN'} · ${t.data().name} (${tid}) · ${people.length} employee records`);

  // 1. quote marks
  const cleaned = pDocs.map((d) => ({ id: d.id, ...L.cleanPersonFields(d.data()) })).filter((c) => c.fields.length);
  const perField = {}; cleaned.forEach((c) => c.fields.forEach((f) => { perField[f] = (perField[f] || 0) + 1; }));
  console.log(`\n1. Records with wrapping quote marks still in a value: ${cleaned.length}${cleaned.length ? '  fields: ' + JSON.stringify(perField) : ''}`);
  const idMismatch = pDocs.filter((d) => L.decode(d.data().id).value !== d.id).length;
  console.log(`   Records whose stored id field differs from the document id: ${idMismatch}`);

  // 2. sign-in links
  const users = (await db.collection('users').where('tenantId', '==', tid).get()).docs.map((d) => ({ uid: d.id, ...d.data() }));
  const plan = L.planLinks(people, users);
  const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? `${p.first || ''} ${p.last || ''}`.trim() : '?'; };
  console.log(`\n2. Sign-ins: ${users.length}   linked correctly: ${plan.linked.length}   to link now: ${plan.fix.length}   no record has that IC: ${plan.none.length}   more than one record has that IC: ${plan.many.length}   other (check by hand): ${plan.skipped.length}`);
  plan.fix.forEach((f) => console.log(`   will link sign-in ${f.uid.slice(0, 6)}… to record ${f.empId}${NAMES ? ' (' + nameOf(f.empId) + ')' : ''}  (was: ${f.from ? JSON.stringify(f.from) : 'empty'})`));
  plan.none.forEach((f) => console.log(`   NOT linked: sign-in ${f.uid.slice(0, 6)}… IC ending ${f.ic4}: no employee record has it`));
  plan.many.forEach((f) => console.log(`   NOT linked: sign-in ${f.uid.slice(0, 6)}… IC ending ${f.ic4}: more than one record has it`));
  plan.skipped.forEach((f) => console.log(`   check by hand: sign-in ${f.uid.slice(0, 6)}… ${f.why}`));

  if (!YES) { console.log('\nDry run only: nothing was changed. Add --yes to apply.'); process.exit(0); }
  if (cleaned.length + plan.fix.length > 450) { console.error('Too many writes for one batch; stopping.'); process.exit(1); }
  const batch = db.batch();
  cleaned.forEach((c) => batch.update(db.doc(`tenants/${tid}/people/${c.id}`), c.changes));
  plan.fix.forEach((f) => batch.update(db.doc(`users/${f.uid}`), { empId: f.empId }));
  await batch.commit();
  console.log(`\nDone: ${cleaned.length} records cleaned, ${plan.fix.length} sign-ins linked. No document was deleted or renamed.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
