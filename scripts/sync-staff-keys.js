// Sync staffKeys for employees so open registration can verify IC and auto-approve.
// Usage:
//   node scripts/sync-staff-keys.js [tenantId or "Company Name"]
const { admin } = require('./admin');

function cleanStr(s) {
  return String(s || '').replace(/[\r\n\t"]/g, '').trim();
}

function cleanIc(s) {
  return cleanStr(s).replace(/[\s-]/g, '');
}

(async () => {
  const target = process.argv[2];
  const fb = admin();
  const db = fb.firestore();

  let tenants = [];
  if (target) {
    const direct = await db.collection('tenants').doc(target).get();
    if (direct.exists) {
      tenants = [direct];
    } else {
      const all = await db.collection('tenants').get();
      tenants = all.docs.filter((d) => {
        const name = cleanStr(d.data().name).toLowerCase();
        return name.includes(target.toLowerCase());
      });
    }
  } else {
    tenants = (await db.collection('tenants').get()).docs;
  }

  if (!tenants.length) {
    console.error('No tenants found.');
    process.exit(1);
  }

  for (const t of tenants) {
    const tid = t.id;
    const tname = cleanStr(t.data().name) || tid;
    console.log(`\nSyncing staffKeys for "${tname}" (${tid})...`);

    const peopleSnap = await db.collection('tenants').doc(tid).collection('people').get();
    let synced = 0;
    const batch = db.batch();

    for (const p of peopleSnap.docs) {
      const d = p.data();
      const ic = cleanIc(d.ic);
      if (!/^\d{12}$/.test(ic)) continue;

      const key = `${tid}~${ic}`;
      const kref = db.collection('staffKeys').doc(key);
      const existing = await kref.get();
      const gen = existing.exists ? (Number(existing.data().gen) || 1) : 1;
      const first = cleanStr(d.first);
      const last = cleanStr(d.last);
      const name = `${first} ${last}`.trim() || 'Staff';

      batch.set(kref, {
        tenantId: tid,
        gen,
        empId: p.id,
        name
      }, { merge: true });
      synced++;
    }

    if (synced > 0) {
      await batch.commit();
      console.log(`  -> Synced ${synced} employees into staffKeys.`);
    } else {
      console.log(`  -> No employees with valid 12-digit IC found.`);
    }
  }

  console.log('\nAll done.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
