// One phone per person (docs/ONE-PHONE-SPEC.md). Read-only by default: counts, no names, no device ids.
//
//   node scripts/migrate-phones.js                 dry run for every company
//   node scripts/migrate-phones.js --tenant <id>   one company
//   node scripts/migrate-phones.js --apply         copies each person's older registered phone into
//                                                  tenants/{t}/phones/{empId} (only where there is none yet).
//                                                  The OWNER runs this, after reading the dry run.
//
// A person's registered phone, until they are moved: an approved entry in the check-in list on their record
// (people/{empId}.devices), else the sign-in binding on their account (users/{uid}.deviceId). The app already treats
// either as their phone, so nobody is locked out by shipping this. What this counts is who would be refused next on a
// DIFFERENT phone: people whose latest check-in came from a phone that is not their registered one.
const { admin } = require('./admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const parse = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } };

(async () => {
  const db = admin().firestore();
  const tenants = ONLY ? [await db.doc(`tenants/${ONLY}`).get()] : (await db.collection('tenants').get()).docs;
  const total = { people: 0, registered: 0, alreadyMoved: 0, toMove: 0, noPhone: 0, differentPhone: 0, noCheckins: 0 };
  for (const t of tenants) {
    if (!t.exists) { console.log(`${ONLY}: no such company`); continue; }
    const [people, users, phones, buckets] = await Promise.all([
      db.collection(`tenants/${t.id}/people`).get(), db.collection('users').where('tenantId', '==', t.id).get(),
      db.collection(`tenants/${t.id}/phones`).get(), db.collection(`tenants/${t.id}/buckets`).get(),
    ]);
    const moved = new Set(phones.docs.map((d) => d.id));
    const bound = new Map(); users.docs.forEach((d) => { const x = d.data(); if (x.empId && x.deviceId && !x.disabled) bound.set(x.empId, x.deviceId); });
    // The latest check-in phone per person, from the attendance buckets (never printed).
    const last = new Map();
    buckets.docs.filter((d) => /^attendance~\d{4}-\d{2}(~.+)?$/.test(d.id)).forEach((d) => {
      Object.entries(d.data().f || {}).forEach(([k, raw]) => {
        const [day, emp] = k.split('|'); const rec = parse(raw); if (!emp || !rec?.device?.id) return;
        if (!last.has(emp) || last.get(emp).day < day) last.set(emp, { day, id: rec.device.id });
      });
    });
    const c = { people: 0, registered: 0, alreadyMoved: 0, toMove: 0, noPhone: 0, differentPhone: 0, noCheckins: 0 }, writes = [];
    people.docs.forEach((d) => {
      const f = d.data(); c.people++;
      if (moved.has(d.id)) { c.alreadyMoved++; c.registered++; return; }
      const list = parse(f.devices) || [];
      const ap = (Array.isArray(list) ? list : []).find((x) => x && x.id && x.status === 'approved');
      const reg = ap ? { id: ap.id, name: ap.name || 'Registered phone', added: ap.added || '' } : bound.has(d.id) ? { id: bound.get(d.id), name: 'Registered phone', added: '' } : null;
      if (!reg) { c.noPhone++; return; }
      c.registered++; c.toMove++;
      const l = last.get(d.id);
      if (!l) c.noCheckins++; else if (l.id !== reg.id) c.differentPhone++;
      writes.push([d.id, { active: { id: reg.id, name: reg.name, added: reg.added, lastUsed: l?.day || '', auto: true }, pending: null, retired: [] }]);
    });
    console.log(`${t.id}: ${c.people} people · ${c.registered} with a registered phone (${c.alreadyMoved} already moved, ${c.toMove} to move) · ${c.noPhone} with none yet · latest check-in from a different phone: ${c.differentPhone} (no check-ins to compare: ${c.noCheckins})`);
    if (APPLY && writes.length) {
      for (let i = 0; i < writes.length; i += 400) {
        const b = db.batch();
        writes.slice(i, i + 400).forEach(([emp, data]) => b.set(db.doc(`tenants/${t.id}/phones/${emp}`), data));
        await b.commit();
      }
      console.log(`${t.id}: moved ${writes.length}. The older lists are kept as they were.`);
    }
    Object.keys(total).forEach((k) => { total[k] += c[k]; });
  }
  console.log(`\n${APPLY ? 'Done' : 'Dry run (nothing changed)'}: ${total.people} people, ${total.registered} with a registered phone, ${total.toMove} ${APPLY ? 'moved' : 'to move'}; ${total.differentPhone} would be refused on their next phone sign-in if they use a phone other than their registered one.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
