// Project costing rules: the project → job group → job tree, time per job from check-ins (split across the
// projects picked during the day) or manual timesheets, each person's hourly labour cost including employer EPF,
// SOCSO and EIS, and the roll-ups for man-hours, wages, target vs actual hours and budget vs actual cost. Pure
// functions with no DOM access, unit tested in tests/costing.test.js.
window.AllurusCostingRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const toMin = (hm) => { if (!/^\d{1,2}:\d{2}$/.test(hm || '')) return null; const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

  // ---------- The tree ----------
  /** Projects with their groups and jobs, plus each level's target hours and budget (the sum of its jobs). */
  function tree(projects, groups, jobs) {
    return projects.map((p) => {
      const gs = groups.filter((g) => g.projectId === p.id).map((g) => {
        const js = jobs.filter((j) => j.groupId === g.id);
        return { ...g, jobs: js, targetHours: r2(js.reduce((s, j) => s + (+j.targetHours || 0), 0)), budget: r2(js.reduce((s, j) => s + (+j.budget || 0), 0)) };
      });
      return { ...p, groups: gs, targetHours: r2(gs.reduce((s, g) => s + g.targetHours, 0)), budget: r2(gs.reduce((s, g) => s + g.budget, 0)) };
    });
  }
  /** Where a job sits: { job, group, project } (any can be undefined). */
  function locate(jobId, groups, jobs) {
    const job = jobs.find((j) => j.id === jobId), group = job && groups.find((g) => g.id === job.groupId);
    return { job, group, projectId: group?.projectId || '' };
  }

  // ---------- Time ----------
  /**
   * Splits a day's worked minutes across the projects picked at each check-in. segments = [{ in, out, project, job }]
   * in time order; the minutes go to each segment in proportion to its length (so breaks are shared out).
   * A segment with no project is "unassigned". Returns [{ project, job, minutes }] merged by project and job.
   */
  function allocateDay(segments, workedMin) {
    const spans = segments.map((s) => { const a = toMin(s.in), b = toMin(s.out); return { ...s, len: a != null && b != null ? ((b - a + 1440) % 1440) : 0 }; }).filter((s) => s.len > 0);
    const total = spans.reduce((t, s) => t + s.len, 0);
    if (!total || !workedMin) return [];
    const out = new Map();
    let given = 0;
    spans.forEach((s, i) => {
      const m = i === spans.length - 1 ? workedMin - given : Math.round((workedMin * s.len) / total);
      given += m;
      const k = `${s.project || ''}|${s.job || ''}`;
      out.set(k, (out.get(k) || 0) + m);
    });
    return [...out.entries()].map(([k, minutes]) => { const [project, job] = k.split('|'); return { project, job, minutes }; }).filter((x) => x.minutes > 0);
  }
  /**
   * Combines check-in time and manual timesheets: for any person and day with a timesheet entry, the timesheet
   * replaces the check-in time (so nothing is counted twice). Entries: { empId, day, project, job, minutes, source }.
   */
  function mergeTime(fromCheckins, timesheets) {
    const manual = new Set(timesheets.map((t) => `${t.empId}|${t.day}`));
    return [...fromCheckins.filter((t) => !manual.has(`${t.empId}|${t.day}`)).map((t) => ({ ...t, source: 'check-in' })), ...timesheets.map((t) => ({ ...t, source: 'timesheet' }))];
  }

  // ---------- Labour cost ----------
  /**
   * Hourly labour cost: (monthly basic + employer EPF + SOCSO + EIS) ÷ standard hours in a month
   * (working days × normal hours, 26 × 8 = 208 by default, the same basis as the overtime rate).
   */
  function hourlyCost({ basic, erEpf = 0, erSocso = 0, erEis = 0, days = 26, hours = 8 }) {
    const std = (Number(days) || 26) * (Number(hours) || 8);
    const monthly = (Number(basic) || 0) + (Number(erEpf) || 0) + (Number(erSocso) || 0) + (Number(erEis) || 0);
    return { monthly: r2(monthly), standardHours: std, hourly: r2(monthly / std) };
  }
  /** Cost of time entries: each entry gets hours and cost from rateOf(empId, month) (an hourly cost). */
  const costEntries = (entries, rateOf) => entries.map((t) => { const h = t.minutes / 60, rate = rateOf(t.empId, t.day.slice(0, 7)); return { ...t, hours: r2(h), rate, cost: r2(h * rate) }; });

  // ---------- Roll-ups ----------
  /** Hours and cost per job, group and project, against target hours and budget. */
  function rollup(treeRows, costed) {
    const byJob = {}, byProject = {};
    costed.forEach((t) => {
      if (t.job) { const j = (byJob[t.job] = byJob[t.job] || { hours: 0, cost: 0 }); j.hours = r2(j.hours + t.hours); j.cost = r2(j.cost + t.cost); }
      const p = (byProject[t.project || ''] = byProject[t.project || ''] || { hours: 0, cost: 0, unassignedHours: 0, unassignedCost: 0 });
      p.hours = r2(p.hours + t.hours); p.cost = r2(p.cost + t.cost);
      if (!t.job) { p.unassignedHours = r2(p.unassignedHours + t.hours); p.unassignedCost = r2(p.unassignedCost + t.cost); }
    });
    const vs = (o, actual) => ({ ...o, hours: actual.hours, cost: actual.cost, hoursPct: o.targetHours ? r2((actual.hours / o.targetHours) * 100) : null, costPct: o.budget ? r2((actual.cost / o.budget) * 100) : null, hoursLeft: r2((o.targetHours || 0) - actual.hours), budgetLeft: r2((o.budget || 0) - actual.cost) });
    return treeRows.map((p) => {
      const groups = p.groups.map((g) => {
        const jobs = g.jobs.map((j) => vs(j, byJob[j.id] || { hours: 0, cost: 0 }));
        return { ...vs(g, { hours: r2(jobs.reduce((s, j) => s + j.hours, 0)), cost: r2(jobs.reduce((s, j) => s + j.cost, 0)) }), jobs };
      });
      const a = byProject[p.id] || { hours: 0, cost: 0, unassignedHours: 0, unassignedCost: 0 };
      return { ...vs(p, a), groups, unassignedHours: a.unassignedHours, unassignedCost: a.unassignedCost };
    });
  }
  /** A pivot of hours or cost: one row per key(entry), one column per month. */
  function byMonth(costed, mks, key, field = 'hours') {
    const rows = new Map();
    costed.forEach((t) => {
      const k = key(t), mk = t.day.slice(0, 7);
      if (!mks.includes(mk)) return;
      const r = rows.get(k) || { key: k, total: 0, ...Object.fromEntries(mks.map((m) => [m, 0])) };
      r[mk] = r2(r[mk] + t[field]); r.total = r2(r.total + t[field]);
      rows.set(k, r);
    });
    return [...rows.values()].sort((a, b) => b.total - a.total);
  }

  return { tree, locate, allocateDay, mergeTime, hourlyCost, costEntries, rollup, byMonth, toMin };
})();
