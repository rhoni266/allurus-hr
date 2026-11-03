// Leave requests in the cloud: one document each in tenants/{t}/leaves, so the rules can check them (the requester
// can't decide their own request; only someone in its approverIds, never the requester, or HR can). Each request
// also has a safe calendar copy in tenants/{t}/leaveCal (who, dates, half day, status; no type, reason or MC) that
// every member may read for the team calendar.
//
// js/leave.js changes the request on screen as before, then calls created / changed / removed here. In the demo
// these do nothing (the browser copy is everything). In the cloud they write one batch; if the rules refuse it (for
// example someone else decided first), the live listener in js/cloud.js puts the server's copy back.
window.AllurusLeaveStore = (function () {
  'use strict';
  const NOW = { __now: true };
  function install(ctx, cloud) {
    const live = () => !!(cloud() && cloud().live);
    const uid = () => cloud()?.profile?.uid || '';
    // Everyone who may act on a request: each step's approver and backup, never the applicant.
    const approverIds = (l) => [...new Set((l.chain || []).flatMap((s) => [s.approver, s.backup]).filter((x) => x && x !== l.empId))];
    const docOf = (l) => { const { id, masked, v, ...rest } = l; return { ...rest, approverIds: approverIds(l) }; };
    const cal = (l) => ({ empId: l.empId, from: l.from, to: l.to, half: l.half || '', status: l.status });
    const write = async (ops) => {
      const r = await cloud().recordWrite(ops);
      if (r.error) ctx.toast(r.error === 'changed' ? 'This leave request changed or isn’t yours to decide. Reload.' : 'That didn’t save. Try again.', 'error');
      return r;
    };
    return {
      live,
      approverIds,
      created(l) {
        if (!live()) return null;
        l.v = 1;
        return write([{ op: 'set', path: `leaves/${l.id}`, data: { ...docOf(l), v: 1, createdBy: uid(), createdAt: NOW, updatedBy: uid(), updatedAt: NOW } },
          { op: 'set', path: `leaveCal/${l.id}`, data: cal(l) }]);
      },
      // After the request was changed on screen: send the named fields, one version on.
      changed(l, fields) {
        if (!live() || l.masked) return null;
        const v = (Number(l.v) || 1) + 1, data = Object.fromEntries(fields.map((k) => [k, l[k] ?? null]));
        l.v = v;
        return write([{ op: 'update', path: `leaves/${l.id}`, data: { ...data, v, updatedBy: uid(), updatedAt: NOW } },
          { op: 'set', path: `leaveCal/${l.id}`, data: cal(l) }]);
      },
      removed(l) {
        if (!live() || l.masked) return null;
        return write([{ op: 'delete', path: `leaves/${l.id}` }, { op: 'delete', path: `leaveCal/${l.id}` }]);
      },
    };
  }
  return { install };
})();
