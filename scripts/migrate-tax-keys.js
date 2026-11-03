// Tax reliefs and tax profiles are now kept by employee id, not email (so staff with no email keep theirs).
// In the cloud they already live in tenants/{t}/personal/{empId} (fields reliefs, tax); this checks that, and looks
// for any older email-keyed copy in shared buckets ('reliefs', 'taxProfiles') that would need copying to the
// person's personal document. Old copies are never deleted.
//
//   node scripts/migrate-tax-keys.js                 dry run: reads only, prints counts (no names or emails)
//   node scripts/migrate-tax-keys.js --tenant co1    dry run for one company
//   node scripts/migrate-tax-keys.js --apply         copies (after the dry run has been checked)
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const FIELD = { reliefs: 'reliefs', taxProfiles: 'tax' };

(async () => {
  const db = admin().firestore();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  const total = { personal: 0, withTax: 0, emailKeyed: 0, toCopy: 0, noMatch: 0, already: 0 };
  for (const t of tenants) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); continue; }
    const personal = await db.collection(`tenants/${t.id}/personal`).get();
    const have = new Map(personal.docs.map((d) => [d.id, d.data()]));
    const withTax = personal.docs.filter((d) => d.data().reliefs !== undefined || d.data().tax !== undefined).length;
    // Email → employee id, from the full employee records.
    const people = await db.collection(`tenants/${t.id}/people`).get();
    const byEmail = new Map();
    people.docs.forEach((d) => { const x = d.data(), e = String(x.f?.email ? JSON.parse(x.f.email) : x.email || '').trim().toLowerCase(); if (e) byEmail.set(e, d.id); });
    const writes = [];
    let emailKeyed = 0, noMatch = 0, already = 0;
    for (const id of Object.keys(FIELD)) {
      const b = await db.doc(`tenants/${t.id}/buckets/${id}`).get();
      if (!b.exists) continue;
      Object.entries(b.data().f || {}).forEach(([k, v]) => {
        if (!k.includes('@')) return;
        emailKeyed++;
        const emp = byEmail.get(k.toLowerCase());
        if (!emp) { noMatch++; return; }
        if (have.get(emp)?.[FIELD[id]] !== undefined) { already++; return; }
        writes.push([`personal/${emp}`, { [FIELD[id]]: v }]);
      });
    }
    console.log(`${t.id}: ${personal.size} personal documents (${withTax} with tax data, already by id) · ${emailKeyed} email-keyed copies in old buckets · copy ${writes.length} · already by id ${already} · no matching employee ${noMatch}`);
    if (APPLY && writes.length) {
      const batch = db.batch();
      writes.forEach(([p, d]) => batch.set(db.doc(`tenants/${t.id}/${p}`), d, { merge: true }));
      await batch.commit();
      console.log(`${t.id}: copied ${writes.length}; old copies kept.`);
    }
    Object.assign(total, { personal: total.personal + personal.size, withTax: total.withTax + withTax, emailKeyed: total.emailKeyed + emailKeyed, toCopy: total.toCopy + writes.length, noMatch: total.noMatch + noMatch, already: total.already + already });
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing changed)'}: ${total.personal} personal documents, ${total.withTax} with tax data already by id; ${total.emailKeyed} email-keyed copies found, ${total.toCopy} to copy, ${total.already} already by id, ${total.noMatch} with no matching employee.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
