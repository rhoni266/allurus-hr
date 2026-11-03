// Grant (or revoke) support access for a client company using the Firebase Admin SDK.
// Useful when a client (e.g., visually impaired or locked out) needs administrative assistance.
//
// Usage:
//   node scripts/grant-support.js <tenantId or companyName> [--days 7] [--no-pay] [--off]
//
// Examples:
//   node scripts/grant-support.js "Butter Buku"
//   node scripts/grant-support.js UxY0jUJoNU7z7d502P0g --days 14
//   node scripts/grant-support.js "Butter Buku" --off

const { admin } = require('./admin');

(async () => {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const isOff = args.includes('--off') || args.includes('--remove');
  const noPay = args.includes('--no-pay');
  const daysIndex = args.indexOf('--days');
  const days = daysIndex !== -1 && args[daysIndex + 1] ? Math.max(1, parseInt(args[daysIndex + 1], 10) || 7) : 7;

  if (!target) {
    console.log('Usage: node scripts/grant-support.js <tenantId or "Company Name"> [--days 7] [--no-pay] [--off]');
    process.exit(1);
  }

  const fb = admin();
  const db = fb.firestore();

  // Find tenant
  let tenantDoc = null;
  const directSnap = await db.collection('tenants').doc(target).get();
  if (directSnap.exists) {
    tenantDoc = directSnap;
  } else {
    // Search by name (case-insensitive substring)
    const allTenants = await db.collection('tenants').get();
    const queryLower = target.toLowerCase();
    const matches = allTenants.docs.filter((d) => {
      const name = (d.data().name || '').toLowerCase();
      return name === queryLower || name.includes(queryLower);
    });

    if (matches.length === 0) {
      console.error(`No company found matching "${target}". Check the company ID or name.`);
      process.exit(1);
    } else if (matches.length > 1) {
      console.log(`Multiple companies match "${target}":`);
      matches.forEach((d) => console.log(`  - ${d.id}: "${d.data().name}" (${d.data().admin || 'no admin'})`));
      console.log('Please specify the exact ID or full company name.');
      process.exit(1);
    }
    tenantDoc = matches[0];
  }

  const tenantId = tenantDoc.id;
  const companyName = tenantDoc.data().name || tenantId;

  if (isOff) {
    await db.collection('tenants').doc(tenantId).collection('support').doc('grant').set({
      until: null,
      payUntil: null,
      by: 'superadmin-cli',
      at: fb.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Support access revoked for "${companyName}" (${tenantId}).`);
    process.exit(0);
  }

  const untilDate = new Date(Date.now() + days * 864e5 - 60e3);
  const until = fb.firestore.Timestamp.fromDate(untilDate);
  const payUntil = noPay ? null : until;

  await db.collection('tenants').doc(tenantId).collection('support').doc('grant').set({
    until,
    payUntil,
    by: 'superadmin-cli',
    at: fb.firestore.FieldValue.serverTimestamp()
  });

  // Log session activation for audit trail
  await db.collection('tenants').doc(tenantId).collection('supportLog').add({
    kind: 'session',
    actorUid: 'superadmin-cli',
    actorEmail: 'owner-cli',
    at: fb.firestore.FieldValue.serverTimestamp(),
    label: `Support grant activated via admin script (${days} days${payUntil ? ', with pay and ID data' : ''})`,
    pay: !!payUntil
  });

  console.log(`\n======================================================`);
  console.log(`  Support Access ACTIVATED for "${companyName}"`);
  console.log(`======================================================`);
  console.log(`Tenant ID:     ${tenantId}`);
  console.log(`Duration:      ${days} days (valid until ${untilDate.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })})`);
  console.log(`Pay/ID Access: ${payUntil ? 'Allowed' : 'Disabled'}`);
  console.log(`\nYou can now open this company directly in your browser:`);
  console.log(`👉 https://allurus.my/app?view=${tenantId}\n`);

  process.exit(0);
})().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
