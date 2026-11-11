// Sign a person out of EVERY device at once (Firebase refresh tokens revoked). For an account that may have been used by
// someone else (incident 2026-11-11). The owner runs this. Prints counts and roles only: no names, emails or ICs.
//
//   node scripts/revoke-sessions.js "<Company name or id>" "<first name>"          check only: shows who matches
//   node scripts/revoke-sessions.js "<Company name or id>" "<first name>" --yes    revoke
//
// What happens next: their next request fails and they have to sign in again (an old sign-in stays valid for up to an
// hour on a device that is already open, so ask for the phone to be signed out too). It does NOT change their password.
const { admin } = require('./admin');

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--')), YES = process.argv.includes('--yes');
  const [target, first] = args;
  if (!target || !first) { console.log('Usage: node scripts/revoke-sessions.js "<Company name or id>" "<first name>" [--yes]'); process.exit(1); }
  const fb = admin(), db = fb.firestore();
  let snap = await db.collection('tenants').doc(target).get();
  if (!snap.exists) {
    const all = await db.collection('tenants').get(), q = target.toLowerCase();
    const hits = all.docs.filter((d) => (d.data().name || '').toLowerCase().includes(q));
    if (hits.length !== 1) { console.error(hits.length ? `More than one company matches "${target}". Use the id.` : `No company matches "${target}".`); process.exit(1); }
    snap = hits[0];
  }
  const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } };
  const people = await db.collection(`tenants/${snap.id}/people`).get();
  const word = new RegExp('\\b' + first.replace(/[^a-z]/gi, '') + '\\b', 'i');   // the name as a whole word in their first or last name
  const ids = people.docs.filter((d) => word.test(`${parse(d.data().first) || ''} ${parse(d.data().last) || ''}`)).map((d) => d.id);
  const users = (await db.collection('users').where('tenantId', '==', snap.id).get()).docs.filter((u) => ids.includes(u.data().empId));
  console.log(`Company: ${snap.data().name} (${snap.id})\nPeople with that first name: ${ids.length} · accounts: ${users.length}`);
  users.forEach((u) => console.log(`  account ${u.id.slice(0, 6)}…  roles=${JSON.stringify(u.data().roles)}  disabled=${!!u.data().disabled}`));
  if (users.length !== 1) { console.log(users.length ? 'More than one account matches: use a more exact first name.' : 'No account to revoke.'); process.exit(users.length ? 1 : 0); }
  if (!YES) { console.log('Check only. Add --yes to sign this account out of every device.'); process.exit(0); }
  await fb.auth().revokeRefreshTokens(users[0].id);
  console.log('Done: that account is signed out of every device. They sign in again with their own password. Change the password too if you are not sure who has it.');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
