// Show, and with --yes correct, which employee record ONE sign-in is linked to.
//
//   node scripts/set-link.js "<company name or id>" <sign-in uid> <employee record id>          check only
//   node scripts/set-link.js "<company name or id>" <sign-in uid> <employee record id> --yes    change it
//
// Changes only users/{uid}.empId (and the display name on the sign-in, to the record's name). Deletes nothing.
// Written for the 11 Nov 2026 incident: a worker's IC sign-in was linked to HR admin Nadia's record.
const { admin } = require('./admin');

const low = (s) => String(s || '').trim().toLowerCase();
// Employee fields are stored as JSON text ("\"NUR NADIA\""); read them back as plain values.
const dec = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } };
const nameOf = (r) => `${dec(r.first) || ''} ${dec(r.last) || ''}`.replace(/\s+/g, ' ').trim() || '(no name)';

(async () => {
  const yes = process.argv.includes('--yes');
  const [companyArg, uid, empId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!companyArg || !uid || !empId) { console.log('Usage: node scripts/set-link.js "<company>" <sign-in uid> <employee record id> [--yes]'); process.exit(1); }
  const fb = admin(), db = fb.firestore();

  let t = await db.collection('tenants').doc(companyArg).get().catch(() => null);
  if (!t || !t.exists) {
    const hits = (await db.collection('tenants').get()).docs.filter((d) => low(d.data().name).includes(low(companyArg)));
    if (hits.length !== 1) { console.log(hits.length ? 'More than one company matches; use the id.' : 'No company matches.'); process.exit(1); }
    t = hits[0];
  }
  const tid = t.id;

  const uref = db.collection('users').doc(uid), u = await uref.get();
  if (!u.exists) { console.log(`No sign-in with uid ${uid}.`); process.exit(1); }
  const ud = u.data();
  if (ud.tenantId !== tid) { console.log(`That sign-in belongs to another company (${ud.tenantId}). Stopping.`); process.exit(1); }

  const recRef = db.collection('tenants').doc(tid).collection('people');
  const cur = ud.empId ? await recRef.doc(ud.empId).get() : null;
  const target = await recRef.doc(empId).get();
  if (!target.exists) { console.log(`No employee record "${empId}" in ${t.data().name}. Stopping.`); process.exit(1); }

  const others = (await db.collection('users').where('tenantId', '==', tid).where('empId', '==', empId).get()).docs.filter((d) => d.id !== uid);
  console.log(`Company: ${t.data().name}`);
  console.log(`Sign-in ${uid}  (${String(ud.email || '').endsWith('@staff.allurus.invalid') ? 'IC sign-in' : 'email sign-in'}, roles ${JSON.stringify(ud.roles || [])}, name on sign-in "${ud.name || ''}")`);
  console.log(`  linked now to: ${ud.empId ? (cur && cur.exists ? nameOf(cur.data()) + ' [' + ud.empId + ']' : 'missing record [' + ud.empId + ']') : '(nothing)'}`);
  console.log(`  will link to:  ${nameOf(target.data())} [${empId}]`);
  if (others.length) console.log(`  note: ${others.length} other sign-in(s) are also linked to that record: ${others.map((d) => d.id).join(', ')}`);
  if ((ud.roles || []).includes('admin')) { console.log('\nThis is an admin sign-in. Not changing it with this script.'); process.exit(1); }
  if (!yes) { console.log('\nCheck only, nothing changed. If "will link to" is the right person, run again with --yes.'); process.exit(0); }

  await uref.update({ empId, name: nameOf(target.data()) });
  console.log(`\nDone. ${uid} is now linked to ${nameOf(target.data())}. He should sign out and in again (or reload twice).`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
