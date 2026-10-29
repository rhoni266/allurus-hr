// Grant (or remove) the superadmin role for allurus.my/superadmin.
//   node scripts/set-superadmin.js you@example.com          grant
//   node scripts/set-superadmin.js you@example.com --remove remove
// The person must already have an Allurus sign-in (email and password). They need to sign out and in again (or wait
// up to an hour) before the new role reaches their browser.
const { admin } = require('./admin');

(async () => {
  const [email, flag] = process.argv.slice(2);
  if (!email || !email.includes('@')) { console.error('Usage: node scripts/set-superadmin.js <email> [--remove]'); process.exit(1); }
  const fb = admin();
  let user;
  try { user = await fb.auth().getUserByEmail(email.toLowerCase()); } catch (e) {
    console.error(`No sign-in for ${email}. Create one first (register a company at allurus.my/app, or Firebase console → Authentication → Add user).`);
    process.exit(1);
  }
  const claims = { ...(user.customClaims || {}) };
  if (flag === '--remove') delete claims.role; else claims.role = 'superadmin';
  await fb.auth().setCustomUserClaims(user.uid, claims);
  console.log(`${flag === '--remove' ? 'Removed superadmin from' : 'Granted superadmin to'} ${email} (uid ${user.uid}). Sign out and in again to pick it up.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
