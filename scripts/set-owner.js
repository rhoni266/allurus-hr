// Make someone the Owner of a company, from the server side (for when nobody in the company is Owner,
// so nobody can do it in Settings > Team access).
//
//   node scripts/set-owner.js "<company name or tenantId>" "<person: name, email or IC>"         check only (no change)
//   node scripts/set-owner.js "<company name or tenantId>" "<person: name, email or IC>" --yes   make the change
//
// An Owner in Allurus = a users/{uid} profile in that company with 'admin' in roles and NO perms list
// (firestore.rules: owner() = !('perms' in me())). If the company has never been claimed (tenants/{t}.owner is
// empty), this also records the person as the company owner. Nothing else is changed. Nothing is deleted.
const { admin } = require('./admin');

const digits = (s) => String(s || '').replace(/\D/g, '');
const low = (s) => String(s || '').trim().toLowerCase();

(async () => {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const [companyArg, personArg] = args.filter((a) => !a.startsWith('--'));
  if (!companyArg || !personArg) {
    console.log('Usage: node scripts/set-owner.js "<company name or tenantId>" "<person name, email or IC>" [--yes]');
    process.exit(1);
  }
  const fb = admin();
  const db = fb.firestore();

  // 1. The company
  let tSnap = await db.collection('tenants').doc(companyArg).get().catch(() => null);
  if (!tSnap || !tSnap.exists) {
    const all = await db.collection('tenants').get();
    const hits = all.docs.filter((d) => low(d.data().name).includes(low(companyArg)));
    if (hits.length !== 1) {
      console.log(hits.length ? `More than one company matches "${companyArg}":` : `No company matches "${companyArg}".`);
      hits.forEach((d) => console.log(`  ${d.id}  ${d.data().name}`));
      console.log('Run again with the exact tenantId.');
      process.exit(1);
    }
    tSnap = hits[0];
  }
  const t = tSnap.id, td = tSnap.data();
  console.log(`Company: ${td.name} (${t})`);
  console.log(`  Recorded owner uid: ${td.owner || '(none - never claimed)'}   Admin email on file: ${td.admin || '(none)'}`);

  // 2. Everyone with a sign-in in this company
  const usersSnap = await db.collection('users').where('tenantId', '==', t).get();
  const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const isOwner = (u) => Array.isArray(u.roles) && u.roles.includes('admin') && !Array.isArray(u.perms);
  const owners = users.filter(isOwner);
  console.log(`  Accounts in this company: ${users.length}. Owners now: ${owners.length ? owners.map((u) => `${u.name || u.email} (${u.uid})`).join(', ') : 'NONE'}`);

  // 3. The person
  const p = low(personArg), pIc = digits(personArg);
  const matches = users.filter((u) =>
    (p.includes('@') && low(u.email) === p) ||
    (pIc.length === 12 && digits(String(u.email || '').split('.')[0]) === pIc) ||
    (!p.includes('@') && pIc.length !== 12 && low(u.name).includes(p)));
  if (matches.length !== 1) {
    if (!matches.length) {
      console.log(`\nNo Allurus sign-in in ${td.name} matches "${personArg}".`);
      console.log('He needs an account first: invite him from Settings > Team access (email or IC), and he must finish joining.');
      if (!td.owner && td.admin) console.log(`(This company is unclaimed: whoever activates ${td.admin} at allurus.my/activate becomes Owner automatically.)`);
      console.log('\nAccounts in this company:');
      users.forEach((u) => console.log(`  ${u.uid}  ${u.name || ''}  ${u.email || ''}  roles=${JSON.stringify(u.roles || [])}${Array.isArray(u.perms) ? ' perms=' + JSON.stringify(u.perms) : ''}${u.pending ? ' PENDING' : ''}${u.disabled ? ' DISABLED' : ''}`));
    } else {
      console.log(`\nMore than one account matches "${personArg}". Use his email or IC instead:`);
      matches.forEach((u) => console.log(`  ${u.uid}  ${u.name || ''}  ${u.email || ''}`));
    }
    process.exit(1);
  }
  const u = matches[0];
  console.log(`\nPerson: ${u.name || '(no name)'}  ${u.email}  uid=${u.uid}`);
  console.log(`  Now: roles=${JSON.stringify(u.roles || [])} perms=${Array.isArray(u.perms) ? JSON.stringify(u.perms) : '(none)'}${u.pending ? '  PENDING' : ''}${u.disabled ? '  DISABLED' : ''}`);
  if (u.pending) { console.log('\nThis account is still waiting for HR approval (pending). Approve it first, then run this again.'); process.exit(1); }
  if (u.disabled) { console.log('\nThis account is turned off (disabled). Turn it back on first, then run this again.'); process.exit(1); }
  if (isOwner(u) && td.owner) { console.log('\nHe is already an Owner. Nothing to do.'); process.exit(0); }

  const roles = Array.from(new Set([...(Array.isArray(u.roles) ? u.roles : []), 'admin', 'employee']));
  console.log(`\nWill set: roles=${JSON.stringify(roles)}, remove the perms list (= Owner: every area, can give access, can make other Owners).`);
  if (!td.owner) console.log(`Will also record him as the company owner (tenants/${t}.owner = ${u.uid}).`);

  if (!yes) { console.log('\nCheck only, nothing changed. If this is right, run the same command again with --yes at the end.'); process.exit(0); }

  const batch = db.batch();
  batch.update(db.collection('users').doc(u.uid), { roles, perms: fb.firestore.FieldValue.delete() });
  if (!td.owner) batch.update(db.collection('tenants').doc(t), { owner: u.uid });
  await batch.commit();
  console.log(`\nDone: ${u.name || u.email} is now Owner of ${td.name}. He should reload allurus.my (or sign out and in).`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
