// READ-ONLY check: which employee record and which sign-in an IC number is linked to.
// Changes nothing. Prints names and the last 4 digits of ICs only.
//
//   node scripts/check-ic-link.js "<company name or id>" <12-digit IC> "<name you expect, e.g. Alif>" ["<other name, e.g. Nadia>"]
//
// Written after the 11 Nov 2026 incident: signing in with a worker's IC opened HR admin Nadia's record.
const { admin } = require('./admin');

const digits = (s) => String(s || '').replace(/\D/g, '');
const low = (s) => String(s || '').trim().toLowerCase();
const last4 = (ic) => (ic ? '••••••••' + String(ic).slice(-4) : '(none)');
const nameOf = (p) => `${p.first || ''} ${p.last || ''}`.trim() || p.name || '(no name)';

(async () => {
  const [companyArg, icArg, expectArg, otherArg] = process.argv.slice(2);
  const ic = digits(icArg);
  if (!companyArg || ic.length !== 12) {
    console.log('Usage: node scripts/check-ic-link.js "<company name or id>" <12-digit IC> "<expected name>" ["<other name>"]');
    process.exit(1);
  }
  const fb = admin(), db = fb.firestore();

  let t = await db.collection('tenants').doc(companyArg).get().catch(() => null);
  if (!t || !t.exists) {
    const hits = (await db.collection('tenants').get()).docs.filter((d) => low(d.data().name).includes(low(companyArg)));
    if (hits.length !== 1) { console.log(hits.length ? 'More than one company matches; use the id:' : 'No company matches.'); hits.forEach((d) => console.log(' ', d.id, d.data().name)); process.exit(1); }
    t = hits[0];
  }
  const tid = t.id;
  console.log(`Company: ${t.data().name} (${tid})   IC checked: ${last4(ic)}\n`);

  const dec = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } };
  const people = (await db.collection('tenants').doc(tid).collection('people').get()).docs.map((d) => { const o = {}; Object.entries(d.data()).forEach(([k, v]) => { o[k] = dec(v); }); return { ...o, id: d.id }; });   // fields are stored as JSON text; the id is always the real document id
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const show = (p) => p ? `${nameOf(p)}  [record ${p.id}]  IC ${last4(digits(p.ic))}  ${p.role || p.title || ''}${p.dept || p.department ? ' · ' + (p.dept || p.department) : ''}` : '(record not found)';

  // 1. Employee records carrying this IC
  const withIc = people.filter((p) => digits(p.ic) === ic);
  console.log(`1. Employee records with this IC: ${withIc.length}`);
  withIc.forEach((p) => console.log('   ' + show(p)));

  // 2. The IC key used by the join page and IC sign-in
  const key = await db.collection('staffKeys').doc(`${tid}~${ic}`).get();
  console.log(`\n2. IC key (staffKeys): ${key.exists ? 'points to → ' + show(byId[key.data().empId]) + `   (name on key: ${key.data().name || '-'}, sign-in generation ${key.data().gen || 1})` : 'none'}`);

  // 3. Sign-ins made from this IC (email <ic>.<company>.g<n>@staff.allurus.invalid)
  const users = (await db.collection('users').where('tenantId', '==', tid).get()).docs.map((d) => ({ uid: d.id, ...d.data() }));
  const icUsers = users.filter((u) => String(u.email || '').startsWith(ic + '.'));
  console.log(`\n3. Sign-ins made from this IC: ${icUsers.length}`);
  icUsers.forEach((u) => console.log(`   uid ${u.uid}  name on sign-in: ${u.name || '-'}  roles ${JSON.stringify(u.roles || [])}${Array.isArray(u.perms) ? ' perms ' + JSON.stringify(u.perms) : ''}  via ${u.via || '-'}${u.disabled ? '  DISABLED' : ''}\n      linked to employee → ${show(byId[u.empId])}`));

  // 4. The names you gave
  for (const n of [expectArg, otherArg].filter(Boolean)) {
    const ps = people.filter((p) => low(nameOf(p)).includes(low(n)));
    console.log(`\n4. Employee records named "${n}": ${ps.length}`);
    ps.forEach((p) => {
      console.log('   ' + show(p));
      users.filter((u) => u.empId === p.id).forEach((u) => console.log(`      sign-in uid ${u.uid}  ${String(u.email || '').endsWith('@staff.allurus.invalid') ? 'IC sign-in ' + last4(String(u.email).split('.')[0]) : 'email sign-in'}  roles ${JSON.stringify(u.roles || [])}`));
    });
  }

  // 5. Verdict
  console.log('\n5. Verdict');
  const expect = low(expectArg || '');
  const target = key.exists ? byId[key.data().empId] : null;
  if (withIc.length > 1) console.log('   PROBLEM: more than one employee record has this IC. Fix the wrong record\'s IC first.');
  if (withIc.length === 1 && expect && !low(nameOf(withIc[0])).includes(expect)) console.log(`   PROBLEM: this IC is saved on ${nameOf(withIc[0])}'s record, not on "${expectArg}". Correct the IC on that record.`);
  if (target && expect && !low(nameOf(target)).includes(expect)) console.log(`   PROBLEM: the IC key points to ${nameOf(target)}, not "${expectArg}". Anyone signing in with this IC opens that record.`);
  icUsers.forEach((u) => { const p = byId[u.empId]; if (p && expect && !low(nameOf(p)).includes(expect)) console.log(`   PROBLEM: sign-in ${u.uid} (made from this IC) is linked to ${nameOf(p)}'s record.`); });
  if (!withIc.length) console.log('   No employee record has this IC.');
  console.log('\nNothing was changed. Send this output (it has no full IC numbers) to Claude or your agent.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
