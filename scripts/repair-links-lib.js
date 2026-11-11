// Pure helpers for scripts/repair-links.js (no database access, so they are unit-tested in tests/repair-links.test.js).
// Employee records are stored with every field as JSON text: the string Ali is saved as "Ali" WITH quote marks. That is
// normal storage, not damage, so the repair decodes first and only touches quote marks that are still there afterwards.
const WRAPS = { '"': '"', '“': '”', '”': '”', "'": "'", '‘': '’' };
const unwrap = (v) => { if (typeof v !== 'string') return v; let t = v.trim(); while (t.length >= 2 && WRAPS[t[0]] === t[t.length - 1]) t = t.slice(1, -1).trim(); return t; };
const decode = (raw) => { if (typeof raw !== 'string') return { ok: false, value: raw }; try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, value: raw }; } };
const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');
const STAFF_HOST = 'staff.allurus.invalid';

// One employee document's fields → { changes: { field: newEncodedValue }, fields: [names] } for text values that still have
// wrapping quotes after decoding. Fields that are not JSON text (admin bookkeeping) are left alone.
function cleanPersonFields(fields) {
  const changes = {};
  Object.keys(fields || {}).forEach((k) => {
    const d = decode(fields[k]);
    if (!d.ok || typeof d.value !== 'string') return;
    const v = unwrap(d.value);
    if (v !== d.value) changes[k] = JSON.stringify(v);
  });
  return { changes, fields: Object.keys(changes) };
}

// people: [{ id (the real document id), ic }]; users: [{ uid, email, empId }]. An IC sign-in has the made-up email
// <ic>.<company>.g<n>@staff.allurus.invalid. It is linked to a record only by that IC, never by guesswork.
function planLinks(people, users) {
  const ids = new Set(people.map((p) => p.id)), out = { linked: [], fix: [], none: [], many: [], skipped: [] };
  for (const u of users) {
    const em = String(u.email || ''), good = !!u.empId && ids.has(u.empId);
    if (!em.endsWith('@' + STAFF_HOST)) { if (good) out.linked.push({ uid: u.uid }); else out.skipped.push({ uid: u.uid, why: 'email sign-in without a valid employee link: check by hand' }); continue; }
    if (good) { out.linked.push({ uid: u.uid }); continue; }
    const ic = em.split('.')[0], hits = people.filter((p) => ic.length === 12 && digits(p.ic) === ic);
    if (hits.length === 1) out.fix.push({ uid: u.uid, from: u.empId || '', empId: hits[0].id });
    else (hits.length ? out.many : out.none).push({ uid: u.uid, ic4: ic.slice(-4) });
  }
  return out;
}
module.exports = { unwrap, decode, cleanPersonFields, planLinks, digits };
