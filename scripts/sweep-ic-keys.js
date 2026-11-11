// Find (and with --yes delete) sign-up keys for ICs that no longer belong to any employee of a company.
//
//   node scripts/sweep-ic-keys.js "<company name or id>"          dry run: lists them, changes nothing
//   node scripts/sweep-ic-keys.js "<company name or id>" --yes    deletes those keys, with their invitations and personal join links
//
// A key is staffKeys/<tenantId>~<12-digit IC>. It is "stale" when no employee record of that company has that IC any more. A key whose
// IC still belongs to someone is never touched. Prints the last 4 digits only. "Pointed to" comes from the sign-in made with that IC
// (its link to an employee record), because the key itself holds no name or employee id (security review 2026-11-07).
const { admin } = require('./admin');
const L = require('./repair-links-lib');

(async () => {
  const args = process.argv.slice(2), YES = args.includes('--yes'), target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.log('Usage: node scripts/sweep-ic-keys.js "<company name or id>" [--yes]'); process.exit(1); }
  const fb = admin(), db = fb.firestore();
  let t = await db.collection('tenants').doc(target).get();
  if (!t.exists) {
    const hits = (await db.collection('tenants').get()).docs.filter((d) => String(d.data().name || '').toLowerCase().includes(target.toLowerCase()));
    if (hits.length !== 1) { console.error(hits.length ? 'More than one company matches; use the id.' : 'No company matches.'); process.exit(1); }
    t = hits[0];
  }
  const tid = t.id, dec = (v) => L.decode(v).value, digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
  console.log(`${YES ? 'DELETE' : 'DRY RUN'} · ${t.data().name} (${tid})`);

  // Current ICs: every employee record of the company that exists now.
  const people = (await db.collection(`tenants/${tid}/people`).get()).docs.map((d) => ({ id: d.id, ic: digits(dec(d.data().ic)), idType: dec(d.data().idType), name: `${dec(d.data().first) || ''} ${dec(d.data().last) || ''}`.trim() }));
  if (!people.length) { console.error('This company has no employee records in the database. Stopping: nothing is swept against an empty list.'); process.exit(1); }
  const current = new Set(people.filter((p) => p.idType !== 'passport' && /^\d{12}$/.test(p.ic)).map((p) => p.ic));
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  // Every key of the company: by its tenantId field and by the id prefix (so a key with a missing field is still found).
  const FP = fb.firestore.FieldPath, keyDocs = new Map();
  (await db.collection('staffKeys').where('tenantId', '==', tid).get()).docs.forEach((d) => keyDocs.set(d.id, d));
  (await db.collection('staffKeys').where(FP.documentId(), '>=', `${tid}~`).where(FP.documentId(), '<', `${tid}~￿`).get()).docs.forEach((d) => keyDocs.set(d.id, d));
  const keys = [...keyDocs.values()].map((d) => ({ id: d.id, ic: d.id.slice(tid.length + 1), gen: d.data().gen })).filter((k) => /^\d{12}$/.test(k.ic));

  // Invitations (and the personal join link each points to), by IC.
  const invDocs = new Map();
  (await db.collection('staffInvites').where('tenantId', '==', tid).get()).docs.forEach((d) => invDocs.set(d.id, d));
  const invByIc = Object.fromEntries([...invDocs.values()].map((d) => [d.id.slice(tid.length + 1), d]));

  // Sign-ins made with an IC: email <ic>.<company>.g<n>@staff.allurus.invalid.
  const users = (await db.collection('users').where('tenantId', '==', tid).get()).docs.map((d) => ({ uid: d.id, ...d.data() }));
  const signInOf = (ic) => users.filter((u) => String(u.email || '').startsWith(ic + '.'));

  const stale = keys.filter((k) => !current.has(k.ic)), kept = keys.length - stale.length;
  const staleInvitesNoKey = Object.keys(invByIc).filter((ic) => /^\d{12}$/.test(ic) && !current.has(ic) && !stale.some((k) => k.ic === ic));
  console.log(`\nEmployee records: ${people.length} · with a usable IC: ${current.size}\nSign-up keys for this company: ${keys.length} · still belong to someone (kept): ${kept} · stale: ${stale.length}\n`);

  const describe = (ic) => {
    const s = signInOf(ic);
    if (!s.length) return 'no sign-in was ever made with it';
    return s.map((u) => { const p = byId[u.empId]; return `sign-in ${u.uid.slice(0, 6)}…${u.disabled ? ' (turned off)' : ''} → ${u.empId ? (p ? `${p.name} (record ${u.empId}, now with IC ending ${p.ic ? p.ic.slice(-4) : 'none'})` : `record ${u.empId} (no longer exists)`) : 'no employee linked'}`; }).join('; ');
  };
  stale.forEach((k) => console.log(`  STALE  IC ending ${k.ic.slice(-4)}  gen ${k.gen ?? '-'}  ${invByIc[k.ic] ? '+ invitation' + (invByIc[k.ic].data().link ? ' and join link' : '') + '  ' : ''} · ${describe(k.ic)}`));
  staleInvitesNoKey.forEach((ic) => console.log(`  STALE invitation without a key  IC ending ${ic.slice(-4)}${invByIc[ic].data().link ? ' (with a join link)' : ''} · ${describe(ic)}`));
  if (!stale.length && !staleInvitesNoKey.length) console.log('  Nothing stale.');

  if (!YES) { console.log('\nDry run only: nothing was changed. Add --yes to delete the stale ones.'); process.exit(0); }
  // Delete, in small batches. Re-checks each IC against the employee list just before deleting.
  const todo = [...new Set([...stale.map((k) => k.ic), ...staleInvitesNoKey])].filter((ic) => !current.has(ic));
  let n = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const b = db.batch();
    todo.slice(i, i + 100).forEach((ic) => {
      const inv = invByIc[ic];
      if (inv?.data().link) b.delete(db.doc(`joinLinks/${inv.data().link}`));
      if (inv) b.delete(inv.ref);
      if (keyDocs.has(`${tid}~${ic}`)) b.delete(keyDocs.get(`${tid}~${ic}`).ref);
      n++;
    });
    await b.commit();
  }
  console.log(`\nDone: ${n} stale IC${n === 1 ? '' : 's'} removed (key, invitation and join link). Keys for ICs that still belong to an employee were not touched.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
