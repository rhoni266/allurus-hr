// Requests in the cloud, one document each, so the rules can check them: leave (tenants/{t}/leaves) and claims
// (tenants/{t}/claims). The requester can't decide their own request; only someone in its approverIds (never the
// requester) or HR can. Leave also has a safe calendar copy in tenants/{t}/leaveCal (who, dates, half day, status;
// no type, reason or MC) that every member may read for the team calendar.
//
// js/leave.js and js/claims.js change the request on screen as before, then call created / changed / removed here.
// In the demo these do nothing (the browser copy is everything). In the cloud they write one batch; if the rules
// refuse it (for example someone else decided first), the live listener in js/cloud.js puts the server's copy back.
window.AllurusRequestStore = (function () {
  'use strict';
  const NOW = { __now: true };
  // coll: the collection; what: words for messages; cal: the calendar copy of a request (leave only).
  function make(ctx, cloud, { coll, what, calColl, cal }) {
    const live = () => !!(cloud() && cloud().live);
    const uid = () => cloud()?.profile?.uid || '';
    // Everyone who may act on a request: each step's approver and backup, never the applicant.
    const approverIds = (r) => [...new Set((r.chain || []).flatMap((s) => [s.approver, s.backup]).filter((x) => x && x !== r.empId))];
    const docOf = (r) => { const { id, masked, v, ...rest } = r; return { ...rest, approverIds: approverIds(r) }; };
    const calOp = (r) => (calColl ? [{ op: 'set', path: `${calColl}/${r.id}`, data: cal(r) }] : []);
    const write = async (ops) => {
      const res = await cloud().recordWrite(ops);
      if (res.error) ctx.toast(res.error === 'changed' ? `This ${what} changed or isn’t yours to decide. Reload.` : 'That didn’t save. Try again.', 'error');
      return res;
    };
    return {
      live,
      approverIds,
      created(r) {
        if (!live()) return null;
        r.v = 1;
        return write([{ op: 'set', path: `${coll}/${r.id}`, data: { ...docOf(r), v: 1, createdBy: uid(), createdAt: NOW, updatedBy: uid(), updatedAt: NOW } }, ...calOp(r)]);
      },
      // After the request was changed on screen: send the named fields, one version on.
      changed(r, fields) {
        if (!live() || r.masked) return null;
        const v = (Number(r.v) || 1) + 1, data = Object.fromEntries(fields.map((k) => [k, r[k] ?? null]));
        r.v = v;
        return write([{ op: 'update', path: `${coll}/${r.id}`, data: { ...data, v, updatedBy: uid(), updatedAt: NOW } }, ...calOp(r)]);
      },
      removed(r) {
        if (!live() || r.masked) return null;
        return write([{ op: 'delete', path: `${coll}/${r.id}` }, ...(calColl ? [{ op: 'delete', path: `${calColl}/${r.id}` }] : [])]);
      },
    };
  }
  return { make };
})();
window.AllurusLeaveStore = { install: (ctx, cloud) => window.AllurusRequestStore.make(ctx, cloud, { coll: 'leaves', what: 'leave request', calColl: 'leaveCal', cal: (l) => ({ empId: l.empId, from: l.from, to: l.to, half: l.half || '', status: l.status }) }) };
window.AllurusClaimStore = { install: (ctx, cloud) => window.AllurusRequestStore.make(ctx, cloud, { coll: 'claims', what: 'claim' }) };
