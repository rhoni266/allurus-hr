// Copies the phone that people typed on the join page (users/{uid}.phone, staff who joined by IC: via 'open' or
// 'ic') onto their employee record (tenants/{t}/people/{empId}.phone), the same way the join page now does:
// into an empty phone only; a different phone already on the record goes to phoneNew for HR to use or keep.
//
//   node scripts/migrate-join-phones.js                 dry run: reads only, prints counts (no names, no numbers)
//   node scripts/migrate-join-phones.js --tenant co1    dry run for one company
//   node scripts/migrate-join-phones.js --apply         writes (only after the owner has checked the dry run)
const { admin } = require('./admin');
global.window = global;
require('../js/cloud-map.js');
const M = global.AllurusCloudMap;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null;
const dec = (v) => { try { return v ? String(M.dec(v) || '') : ''; } catch (e) { return ''; } };

(async () => {
  const db = admin().firestore();
  let q = db.collection('users').where('via', 'in', ['open', 'ic']);
  if (ONLY) q = q.where('tenantId', '==', ONLY);
  const users = await q.get();
  const per = {}, writes = [];
  const add = (t, k) => { per[t] = per[t] || { joined: 0, noPhone: 0, invalid: 0, noRecord: 0, same: 0, fill: 0, differs: 0 }; per[t][k]++; };
  for (const u of users.docs) {
    const d = u.data(), t = d.tenantId || '?';
    add(t, 'joined');
    const p = M.normPhone(d.phone || '');
    if (!p) { add(t, 'noPhone'); continue; }
    if (!M.validPhone(p)) { add(t, 'invalid'); continue; }
    if (!d.empId) { add(t, 'noRecord'); continue; }
    const ref = db.doc(`tenants/${t}/people/${d.empId}`), rec = await ref.get();
    if (!rec.exists) { add(t, 'noRecord'); continue; }
    const cur = M.normPhone(dec(rec.data().phone));
    if (cur === p) { add(t, 'same'); continue; }
    if (!cur) { add(t, 'fill'); writes.push([ref, { phone: M.enc(p) }]); continue; }
    add(t, 'differs');
    if (!rec.data().phoneNew) writes.push([ref, { phoneNew: M.enc(p), phoneNewAt: M.enc(new Date().toISOString().slice(0, 10)) }]);
  }
  console.log('Per company (counts only):');
  console.table(per);
  console.log(`${writes.length} employee record(s) would change: "fill" puts the phone into an empty record, "differs" adds phoneNew for HR.`);
  if (!APPLY) { console.log('Dry run: nothing written. Run with --apply after the owner has checked these counts.'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    writes.slice(i, i + 400).forEach(([ref, data]) => b.update(ref, data));
    await b.commit();
  }
  console.log(`Written: ${writes.length}.`);
})().catch((e) => { console.error('Failed:', e.code || e.message); process.exit(1); });
