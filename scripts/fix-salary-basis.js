// Check, and with --yes --only fix, employee salaries typed as MONTHLY into the YEARLY salary field (docs/SALARY-BASIS-SPEC.md).
//
//   node scripts/fix-salary-basis.js "<company name or id>"                          dry run: lists every active employee with a suggestion
//   node scripts/fix-salary-basis.js "<company name or id>" --yes --only e12,e34     multiplies by 12 ONLY the people you name (never all at once)
//
// The stored field is the yearly `salary`, as always. A person is flagged:
//   LOOKS MONTHLY  the yearly value is between RM1 and the limit (default RM20,400 = RM1,700 minimum wage x 12): proposed yearly = value x 12
//   NO SALARY      0 or empty: HR must fill it in (this script never invents a salary)
//   OK             anything else
// Names and money are printed to the screen only (and go in the owner's log). Never ICs. Each applied change writes an audit line to the
// company's activity log and nothing else is touched. Then discard the draft payroll and run it again.
const { admin } = require('./admin');
const L = require('./repair-links-lib');

(async () => {
  const args = process.argv.slice(2), YES = args.includes('--yes');
  const oi = args.indexOf('--only');
  const target = args.find((a, i) => !a.startsWith('--') && i !== oi + 1 || (oi < 0 && !a.startsWith('--')));
  const onlyArg = oi >= 0 ? args[oi + 1] : '';
  const only = onlyArg ? onlyArg.split(',').map((x) => x.trim()).filter(Boolean) : [];
  const limitArg = args.find((a) => a.startsWith('--limit=')); const LIMIT = limitArg ? Number(limitArg.slice(8)) : 20400;
  if (!target) { console.log('Usage: node scripts/fix-salary-basis.js "<company name or id>" [--limit=20400] [--yes --only id,id,...]'); process.exit(1); }
  if (YES && !only.length) { console.error('--yes needs --only <id,id,...>: it is never applied to everyone at once.'); process.exit(1); }
  const db = admin().firestore(), dec = (v) => L.decode(v).value;
  let t = await db.collection('tenants').doc(target).get();
  if (!t.exists) {
    const hits = (await db.collection('tenants').get()).docs.filter((d) => String(d.data().name || '').toLowerCase().includes(target.toLowerCase()));
    if (hits.length !== 1) { console.error(hits.length ? 'More than one company matches; use the id.' : 'No company matches.'); process.exit(1); }
    t = hits[0];
  }
  const tid = t.id, rm = (n) => 'RM' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const docs = (await db.collection(`tenants/${tid}/people`).get()).docs;
  const rows = docs.map((d) => {
    const f = d.data(), yearly = Number(dec(f.salary)) || 0, status = dec(f.status) || 'Active';
    const kind = status !== 'Active' ? 'SKIP (not active)' : yearly <= 0 ? 'NO SALARY' : yearly < LIMIT ? 'LOOKS MONTHLY' : 'OK';
    return { id: d.id, name: `${dec(f.first) || ''} ${dec(f.last) || ''}`.replace(/\s+/g, ' ').trim(), role: dec(f.role) || '', status, yearly, monthlyNow: yearly / 12, kind, proposed: kind === 'LOOKS MONTHLY' ? Math.round(yearly * 12 * 100) / 100 : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  console.log(`${YES ? 'APPLY' : 'DRY RUN'} · ${t.data().name} (${tid}) · ${rows.length} records · limit ${rm(LIMIT)} a year\n`);
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(pad('id', 10) + pad('name', 40) + pad('stored yearly', 16) + pad('= monthly now', 16) + pad('suggestion', 18) + 'proposed yearly (monthly)');
  rows.forEach((r) => console.log(pad(r.id, 10) + pad(r.name, 40) + pad(rm(r.yearly), 16) + pad(rm(r.monthlyNow), 16) + pad(r.kind, 18) + (r.proposed != null ? `${rm(r.proposed)} (${rm(r.proposed / 12)})` : '')));
  const c = (k) => rows.filter((r) => r.kind === k).length;
  console.log(`\nLOOKS MONTHLY: ${c('LOOKS MONTHLY')} · NO SALARY: ${c('NO SALARY')} · OK: ${c('OK')} · not active: ${rows.length - c('LOOKS MONTHLY') - c('NO SALARY') - c('OK')}`);
  if (!YES) { console.log('\nDry run only: nothing was changed. After HR confirms who is wrong: --yes --only <id,id,...>'); process.exit(0); }

  // Apply: only the named people, only if they still look monthly (re-checked now), one batch, with an audit line each.
  const chosen = only.map((id) => rows.find((r) => r.id === id) || { id, missing: true });
  const bad = chosen.filter((r) => r.missing || r.kind !== 'LOOKS MONTHLY');
  if (bad.length) { console.error('Stopped: these are not people flagged LOOKS MONTHLY right now: ' + bad.map((r) => r.id + (r.name ? ` (${r.name}: ${r.kind})` : ' (no such record)')).join(', ')); process.exit(1); }
  const batch = db.batch();
  chosen.forEach((r) => batch.update(db.doc(`tenants/${tid}/people/${r.id}`), { salary: JSON.stringify(r.proposed) }));
  // Activity log lines: the company's activity bucket holds one list under field "_" (see js/cloud-map.js); appended in the same format.
  const aref = db.doc(`tenants/${tid}/buckets/activity`), asnap = await aref.get();
  if (asnap.exists) {
    const list = (() => { try { return JSON.parse((asnap.data().f || {})._ || '[]'); } catch (e) { return []; } })();
    const lines = chosen.map((r) => ({ t: Date.now(), text: `Salary corrected from ${rm(r.yearly)}/yr to ${rm(r.proposed)}/yr, monthly basis fix: ${r.name}` }));
    batch.update(aref, { 'f._': JSON.stringify([...lines, ...(Array.isArray(list) ? list : [])].slice(0, 500)) });
  }
  await batch.commit();
  console.log(`\nDone: ${chosen.length} salary field(s) multiplied by 12. Audit lines ${asnap.exists ? 'written to the activity log' : 'NOT written (no activity log found): note them in the owner log'}. Now discard the draft payroll and run it again.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
