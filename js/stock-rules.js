// Stock requests: request, approve, hand over, receive, return (docs: the "Stock request spec"). Pure rules, no screen.
//   Request  { id, no, itemId, itemName, unit, returnable, returnDays, qty, reason, photo, empId, dept, role, status,
//              approvedQty, decidedBy, decidedAt, decisionNote, handedQty, handedBy, handedAt, handPhoto, receivedAt,
//              returnedQty, returnedBy, returnedAt, condition, returnPhoto, lost, cancelledAt, cancelNote, by, at, v }
//   Status   Diminta → Diluluskan (qty reserved) → Diserahkan (stock goes down; photo needed) → [Dipulangkan]
//            Diminta | Diluluskan → Dibatalkan; Diminta → Ditolak.
// Stock on hand never changes by editing a number: it is the item's stock (opening + moves) less what was handed over, plus what came
// back in good or damaged condition. The same arithmetic runs on every phone, so nobody can take stock without a handover.
window.AllurusStockRules = (function () {
  'use strict';
  const S = { REQUESTED: 'Diminta', APPROVED: 'Diluluskan', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan', HANDED: 'Diserahkan', RETURNED: 'Dipulangkan' };
  const CONDITIONS = ['Baik', 'Rosak', 'Hilang'];
  const REASONS = ['Used', 'Sold', 'Damaged'];   // from the stock reasons that take stock out (js/ops-rules.js)
  const DAY = 864e5;
  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  const txt = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
  const lc = (s) => String(s || '').trim().toLowerCase();
  const ms = (t) => (t ? (typeof t === 'number' ? t : Date.parse(t)) : NaN);
  const iso = (t) => (typeof t === 'number' ? new Date(t).toISOString() : t || '');   // the cloud sends times as milliseconds, the demo as ISO text

  // ---------- Items ----------
  // Item fields: jenis 'consume' (Habis guna, the default) | 'return' (Perlu dipulang); returnDays; allowDepts [dept id]; allowRoles [job title].
  const isReturnable = (item) => !!item && item.jenis === 'return';
  const returnDays = (item) => Math.max(1, Math.round(Number(item?.returnDays) || 1));
  /** Employee ids who may request this item: people in an allowed department or holding an allowed job title. Empty lists: nobody (admin only). */
  function requesters(item, employees) {
    const d = new Set((item?.allowDepts || []).map(String)), r = new Set((item?.allowRoles || []).map(lc).filter(Boolean));
    if (!d.size && !r.size) return [];
    return employees.filter((e) => e && e.status !== 'Inactive' && ((e.dept && d.has(String(e.dept))) || (e.role && r.has(lc(e.role))))).map((e) => e.id);
  }
  /** Who an appointment names: { depts: [dept id], roles: [job title], people: [emp id] } → employee ids (any combination). */
  function appointees(rule, employees) {
    const d = new Set((rule?.depts || []).map(String)), r = new Set((rule?.roles || []).map(lc).filter(Boolean)), p = new Set((rule?.people || []).map(String));
    return [...new Set(employees.filter((e) => e && e.status !== 'Inactive' && (p.has(String(e.id)) || (e.dept && d.has(String(e.dept))) || (e.role && r.has(lc(e.role))))).map((e) => e.id))];
  }
  /** The stored appointment document (what the rules read): rule sets and the employee ids they resolve to. */
  function rolesDoc(settings, employees) {
    const s = settings || {};
    return { approverRule: s.approverRule || { depts: [], roles: [], people: [] }, keeperRule: s.keeperRule || { depts: [], roles: [], people: [] },
      approvers: appointees(s.approverRule, employees), keepers: appointees(s.keeperRule, employees), autoCancelDays: Math.max(1, Math.round(Number(s.autoCancelDays) || 2)) };
  }
  /** What staff see of an item (no cost, no supplier): the catalog entry, with who may request it and its stock before requests (opening + moves). */
  const catalogEntry = (item, base, employees) => ({ id: item.id, name: item.name, unit: item.unit || '', category: item.category || '', jenis: isReturnable(item) ? 'return' : 'consume',
    returnDays: isReturnable(item) ? returnDays(item) : 0, allowed: requesters(item, employees), base: r3(base) });

  // ---------- Quantities ----------
  const reservedOf = (reqs, itemId) => r3(reqs.filter((r) => r.itemId === itemId && r.status === S.APPROVED).reduce((a, r) => a + (Number(r.approvedQty) || 0), 0));
  /** Net quantity that left the store and has not come back in a usable state. */
  const outOf = (reqs, itemId) => r3(reqs.filter((r) => r.itemId === itemId && (r.status === S.HANDED || r.status === S.RETURNED)).reduce((a, r) => {
    const out = Number(r.handedQty) || 0, back = r.status === S.RETURNED && (r.condition === 'Baik' || r.condition === 'Rosak') ? Number(r.returnedQty) || 0 : 0;
    return a + out - back;
  }, 0));
  /** Stock on hand: the item's own stock (opening + moves) less what is out. */
  const onHand = (base, reqs, itemId) => r3(base - outOf(reqs, itemId));
  /** Available to promise: on hand less what is reserved by approved requests. */
  const available = (base, reqs, itemId) => r3(onHand(base, reqs, itemId) - reservedOf(reqs, itemId));
  /** The same movements as stock moves (for an item's history); negative for handed over, positive for a return. */
  function moves(reqs) {
    const out = [];
    reqs.forEach((r) => {
      if (r.handedQty && (r.status === S.HANDED || r.status === S.RETURNED)) out.push({ id: `${r.id}~out`, itemId: r.itemId, date: iso(r.handedAt || r.at).slice(0, 10), qty: -Number(r.handedQty), kind: 'Used', ref: r.no, note: `Stock request ${r.no}`, by: r.handedBy || '', at: iso(r.handedAt) });
      if (r.status === S.RETURNED && r.returnedQty && (r.condition === 'Baik' || r.condition === 'Rosak')) out.push({ id: `${r.id}~in`, itemId: r.itemId, date: iso(r.returnedAt).slice(0, 10), qty: Number(r.returnedQty), kind: 'Returned', ref: r.no, note: `Returned ${r.condition.toLowerCase()}, ${r.no}`, by: r.returnedBy || '', at: iso(r.returnedAt) });
    });
    return out;
  }

  // ---------- Steps. Each returns { ok, request } or { ok: false, error }. The request given is never changed. ----------
  const no = (date, n) => `PS-${String(date).slice(2, 4)}${String(date).slice(5, 7)}${String(date).slice(8, 10)}-${String(n).padStart(3, '0')}`;
  const fail = (error) => ({ ok: false, error });
  /** A new request. entry: the catalog entry of the item; the person must be allowed to request it. */
  function make({ entry, qty, reason = 'Used', note = '', photo = '', emp, by, at, id = '', no: number = '', availableQty = null }) {
    if (!entry) return fail('Choose the item.');
    if (!emp || !emp.id) return fail('Sign in again.');
    if (!(entry.allowed || []).includes(emp.id)) return fail('You are not allowed to request this item.');
    const q = r3(qty);
    if (!Number.isFinite(q) || q <= 0) return fail('Enter a quantity above zero.');
    if (availableQty != null && q > availableQty + 1e-9) return fail(`Only ${availableQty} ${entry.unit} available.`.replace(/\s+\./, '.'));
    if (!REASONS.includes(reason)) return fail('Choose a reason.');
    return { ok: true, request: { id, no: number, itemId: entry.id, itemName: entry.name, unit: entry.unit, returnable: entry.jenis === 'return', returnDays: entry.returnDays || 0, qty: q, reason,
      note: txt(note, 200), photo: photo || '', empId: emp.id, dept: emp.dept || '', role: txt(emp.role, 60), status: S.REQUESTED, by, at } };
  }
  /** An approver approves (optionally with a lower quantity) or rejects (with a reason). Never their own request. */
  function decide(req, decision, { by, qty, availableQty = null, note = '', at = '' } = {}) {
    if (!req || req.status !== S.REQUESTED) return fail('That request has already been decided.');
    if (by === req.empId) return fail('You cannot decide your own request.');
    if (decision === 'reject') {
      if (!txt(note, 200)) return fail('Say why it is rejected.');
      return { ok: true, request: { ...req, status: S.REJECTED, decidedBy: by, decidedAt: at, decisionNote: txt(note, 200) } };
    }
    if (decision !== 'approve') return fail('Approve or reject.');
    const q = r3(qty == null || qty === '' ? req.qty : qty);
    if (!Number.isFinite(q) || q <= 0) return fail('Enter a quantity above zero.');
    if (q > req.qty + 1e-9) return fail('You can lower the quantity, not raise it.');
    if (availableQty != null && q > availableQty + 1e-9) return fail(`Only ${availableQty} ${req.unit} available.`);
    return { ok: true, request: { ...req, status: S.APPROVED, approvedQty: q, decidedBy: by, decidedAt: at, decisionNote: txt(note, 200) } };
  }
  /** The storekeeper hands the items over. A photo of what is handed over is required. Not to themselves. */
  function handOver(req, { by, qty, photo, at = '' } = {}) {
    if (!req || req.status !== S.APPROVED) return fail('That request is not approved, or was already handed over.');
    if (by === req.empId) return fail('You cannot hand over to yourself.');
    if (!photo) return fail('Take a photo of the items you hand over.');
    const q = r3(qty == null || qty === '' ? req.approvedQty : qty);
    if (!Number.isFinite(q) || q <= 0) return fail('Enter the quantity handed over.');
    if (q > req.approvedQty + 1e-9) return fail('That is more than was approved.');
    return { ok: true, request: { ...req, status: S.HANDED, handedQty: q, handedBy: by, handedAt: at, handPhoto: photo } };
  }
  /** The requester taps Terima. */
  function receive(req, { by, at = '' } = {}) {
    if (!req || req.status !== S.HANDED) return fail('Nothing to receive.');
    if (by !== req.empId) return fail('Only the person who asked can confirm receiving.');
    if (req.receivedAt) return fail('Already received.');
    return { ok: true, request: { ...req, receivedAt: at } };
  }
  /** The storekeeper takes a returnable item back: Baik, Rosak or Hilang. Baik and Rosak put the quantity back; Hilang does not and is flagged. */
  function giveBack(req, { by, condition, qty, photo = '', at = '' } = {}) {
    if (!req || req.status !== S.HANDED) return fail('Nothing to take back.');
    if (!req.returnable) return fail('This item does not have to be returned.');
    if (!CONDITIONS.includes(condition)) return fail('Choose Baik, Rosak or Hilang.');
    const q = condition === 'Hilang' ? 0 : r3(qty == null || qty === '' ? req.handedQty : qty);
    if (condition !== 'Hilang' && (!Number.isFinite(q) || q <= 0 || q > req.handedQty + 1e-9)) return fail('Enter the quantity returned (not more than was handed over).');
    return { ok: true, request: { ...req, status: S.RETURNED, condition, returnedQty: q, returnedBy: by, returnedAt: at, returnPhoto: photo || '', lost: condition === 'Hilang' } };
  }
  /** The requester cancels while it is still Diminta or Diluluskan. */
  function cancel(req, { by, at = '', note = '', auto = false } = {}) {
    if (!req || (req.status !== S.REQUESTED && req.status !== S.APPROVED)) return fail('This request can no longer be cancelled.');
    if (!auto && by !== req.empId) return fail('Only the person who asked can cancel it.');
    return { ok: true, request: { ...req, status: S.CANCELLED, cancelledAt: at, cancelNote: auto ? 'Not collected in time' : txt(note, 200) } };
  }

  // ---------- Time ----------
  /** Approved requests not collected within `days` (a setting, 2 by default): cancel them and release the reservation. */
  const expired = (reqs, nowIso, days = 2) => reqs.filter((r) => r.status === S.APPROVED && ms(r.decidedAt) + days * DAY <= ms(nowIso));
  const dueOn = (req) => (req.returnable && req.handedAt ? new Date(ms(req.handedAt) + (Number(req.returnDays) || 1) * DAY).toISOString().slice(0, 10) : '');
  const when = iso;
  const isLate = (req, today) => req.status === S.HANDED && req.returnable && !!dueOn(req) && dueOn(req) < today;
  /** Returnable items a person holds now. */
  const held = (reqs, empId) => reqs.filter((r) => r.empId === empId && r.status === S.HANDED && r.returnable);
  /** The label key shown on a request: waiting, approved (ready to collect), handed, rejected, cancelled, to return, late, returned, lost. */
  function pillOf(req, today) {
    if (req.status === S.REQUESTED) return 'waiting';
    if (req.status === S.APPROVED) return 'ready';
    if (req.status === S.REJECTED) return 'rejected';
    if (req.status === S.CANCELLED) return 'cancelled';
    if (req.status === S.RETURNED) return req.lost ? 'lost' : 'returned';
    if (isLate(req, today)) return 'late';
    return req.returnable ? 'toreturn' : 'handed';
  }
  /** Old "Minta stok" tickets (ops.stockOuts) become requests in status Diminta. Their person or role is kept in the note. */
  const fromTicket = (t, items = []) => {
    const it = items.find((i) => i.id === t.itemId) || {};
    return { id: t.id, no: t.ticketNo || t.id, itemId: t.itemId || '', itemName: t.itemName, unit: t.unit || it.unit || '', returnable: isReturnable(it), returnDays: isReturnable(it) ? returnDays(it) : 0,
      qty: t.qty, reason: REASONS.includes(t.reason) ? t.reason : 'Used', note: txt([t.note, t.requesterType === 'role' ? `For role: ${t.role}` : '', t.department ? `Dept: ${t.department}` : ''].filter(Boolean).join('. '), 200), photo: '',
      empId: t.requesterType === 'individual' && t.staffId ? t.staffId : t.by, dept: '', role: t.role || '', status: S.REQUESTED, by: t.by, at: t.at, migrated: true };
  };

  return { when, S, STATUS: S, CONDITIONS, REASONS, isReturnable, returnDays, requesters, appointees, rolesDoc, catalogEntry, reservedOf, outOf, onHand, available, moves, no, make, decide, handOver, receive, giveBack, cancel, expired, dueOn, isLate, held, pillOf, fromTicket };
})();
