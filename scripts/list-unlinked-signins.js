// READ-ONLY. Lists every sign-in, at every company, that had no employee record linked at some time since a start time, so HR knows
// who may have seen the first employee's record (the v3.48 hotfix tested the wrong flag; fixed in v3.57).
//
//   node scripts/list-unlinked-signins.js [--since 2026-11-11T13:00+08:00] [--names]
//
// Without --names it prints counts and the last 4 digits only. With --names it also prints names (for the log).
// "Unlinked" means users/{uid}.empId is empty or points to a record that does not exist. Times come from the sign-in's creation time
// (joinedAt) and, for a join-page registration that was linked afterwards, the "Approved join-page registration" line in the
// company's activity log. When the link time cannot be found the sign-in is listed as "unclear", not left out.
const { admin } = require('./admin');
const L = require('./repair-links-lib');

(async () => {
  const args = process.argv.slice(2), NAMES = args.includes('--names');
  const sinceArg = (args.find((a) => a.startsWith('--since=')) || '').slice(8) || (args.includes('--since') ? args[args.indexOf('--since') + 1] : '') || '2026-11-11T13:00:00+08:00';
  const since = new Date(sinceArg).getTime();
  if (!Number.isFinite(since)) { console.error('Could not read --since'); process.exit(1); }
  const db = admin().firestore(), dec = (v) => L.decode(v).value, now = Date.now();
  const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  console.log(`Window: from ${fmt(since)} (${sinceArg}) until now (${fmt(now)})${NAMES ? '' : '   [counts only; add --names for the log]'}\n`);

  const tenants = (await db.collection('tenants').get()).docs;
  const users = (await db.collection('users').get()).docs.map((d) => ({ uid: d.id, ...d.data(), _changed: d.updateTime ? d.updateTime.toMillis() : null }));
  const out = [];
  for (const t of tenants) {
    const people = (await db.collection(`tenants/${t.id}/people`).get()).docs.map((d) => ({ id: d.id, name: `${dec(d.data().first) || ''} ${dec(d.data().last) || ''}`.replace(/\s+/g, ' ').trim(), ord: Number(dec(d.data()['~o'])) || 0, status: dec(d.data().status), ic: String(dec(d.data().ic) || '').replace(/\D/g, '') }));
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    // The record the old fallback showed: the first active employee, in the order of the staff list.
    const first = people.filter((p) => p.status !== 'Left').sort((a, b) => a.ord - b.ord)[0];
    let lines = [];
    try { const a = await db.doc(`tenants/${t.id}/buckets/activity`).get(); const f = a.exists ? (a.data().f || {}) : {}; lines = Object.values(f).flatMap((v) => { const x = dec(v); return Array.isArray(x) ? x : []; }); } catch (e) { /* no log */ }
    const approvals = lines.map((l) => { const m = /^Approved join-page registration for (.+)$/.exec(l.text || ''); return m ? { name: m[1].trim().toLowerCase(), t: l.t } : null; }).filter(Boolean);

    for (const u of users.filter((x) => x.tenantId === t.id)) {
      const created = u.joinedAt && u.joinedAt.toMillis ? u.joinedAt.toMillis() : (u.joinedAt && u.joinedAt._seconds ? u.joinedAt._seconds * 1000 : null);
      const rec = u.empId ? byId[u.empId] : null, ic = String(u.email || '').split('.')[0].replace(/\D/g, '');
      const row = { company: t.data().name, uid: u.uid.slice(0, 6), via: u.via || 'invite', roles: (u.roles || []).join('+'), created, ic4: /^\d{12}$/.test(ic) ? ic.slice(-4) : '', pending: !!u.pending, disabled: !!u.disabled, linkedTo: rec ? rec.name : '', first: first ? first.name : '' };
      if (!rec) {
        // Unlinked now: exposed from creation (or the window start) until now.
        const from = Math.max(created || since, since);
        out.push({ ...row, kind: 'UNLINKED NOW', from, to: now, shown: first ? first.name : '(nobody)' });
      } else if (u.via === 'open') {
        const ap = approvals.filter((a) => a.name === rec.name.toLowerCase()).sort((a, b) => b.t - a.t)[0];
        if (ap && created && ap.t > created && ap.t >= since) out.push({ ...row, kind: 'UNLINKED, THEN LINKED', from: Math.max(created, since), to: ap.t, shown: first ? first.name : '(nobody)' });
        else if (!ap) out.push({ ...row, kind: 'UNCLEAR (linked now; no approval line in the log, so linked by a script or by hand)', from: Math.max(created || since, since), to: u._changed && u._changed >= since ? u._changed : null, toNote: 'the sign-in record last changed then (the link was made at or before this)', shown: first ? first.name : '(nobody)' });
      }
    }
  }
  const order = { 'UNLINKED NOW': 0, 'UNLINKED, THEN LINKED': 1 };
  out.sort((a, b) => (order[a.kind] ?? 2) - (order[b.kind] ?? 2) || a.company.localeCompare(b.company));
  const count = (k) => out.filter((x) => x.kind.startsWith(k)).length;
  console.log(`Companies: ${tenants.length} · sign-ins: ${users.length}`);
  console.log(`Listed: ${out.length}  (unlinked now: ${count('UNLINKED NOW')} · unlinked then linked: ${count('UNLINKED, THEN')} · unclear: ${count('UNCLEAR')})\n`);
  out.forEach((x) => {
    const when = `${fmt(x.from)} → ${x.to ? fmt(x.to) : 'unknown'}${x.toNote && x.to ? ' (' + x.toNote + ')' : ''}${x.created && x.created < since ? ` · created before the window (${fmt(x.created)})` : ''}`;
    console.log(`${x.kind}\n  company: ${NAMES ? x.company : '(' + x.company.length + ' chars)'} · sign-in ${x.uid}… (${x.via}, ${x.roles || 'no roles'}${x.pending ? ', pending: no data access' : ''}${x.disabled ? ', turned off' : ''}) · IC ending ${x.ic4 || '-'}\n  could have seen: ${NAMES ? x.shown : 'the first employee of that company'} · ${when}${NAMES && x.linkedTo ? ` · now linked to ${x.linkedTo}` : ''}`);
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
