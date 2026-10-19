// Project costing: projects → job groups → jobs with target hours and budgets, time per job from check-ins (the
// project or job picked when checking in) or manual timesheets, labour cost from each person's hourly cost
// including employer EPF, SOCSO and EIS, and reports on man-hours, wages, target vs actual hours and budget vs
// actual cost. The maths lives in js/costing-rules.js (AllurusCostingRules).
window.AllurusCosting = (function () {
  'use strict';
  const C = window.AllurusCostingRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const co = () => (st().costing = st().costing || { groups: [], jobs: [], timesheets: [] });
  const projects = () => (st().projects = st().projects || []);
  const emp = (id) => ctx.emp(id);
  const fmt = (d) => (d ? U.fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const mlabel = (mk) => U.fmtMonth(mk, { month: 'short', year: 'numeric' });
  const hrs = (h) => `${(Math.round(h * 10) / 10).toLocaleString('en-MY')} h`;
  const ui = { tab: 'projects', from: '', to: '', report: 'hours', tsMonth: '', open: {} };
  const range = () => { if (!ui.from) { ui.from = `${U.addMonths(U.monthKey(T()), -3)}-01`; ui.to = T(); } return { from: ui.from, to: ui.to }; };
  const projectOf = (id) => projects().find((p) => p.id === id);
  const jobOf = (id) => co().jobs.find((j) => j.id === id);
  const groupOf = (id) => co().groups.find((g) => g.id === id);
  const jobLabel = (jobId) => { const j = jobOf(jobId), g = j && groupOf(j.groupId); return j ? `${g ? g.name + ' · ' : ''}${j.name}` : ''; };
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);

  // ---------- Time and cost ----------
  // Check-in time per job: each record's worked minutes, split across the projects picked at each check-in that day.
  function fromCheckins(from, to) {
    const out = [];
    Object.keys(st().attendance).filter((d) => d >= from && d <= to).forEach((d) => Object.entries(st().attendance[d]).forEach(([id, r]) => {
      if (!['present', 'remote'].includes(r.s) || !r.out) return;
      const segs = [...(r.history || []).map((h) => ({ in: h.in, out: h.out, project: h.project || '', job: h.job || '' })), { in: r.lastIn || r.in, out: r.out, project: r.project || '', job: r.job || '' }];
      if (!segs.some((s) => s.project)) return;
      const e = emp(id); if (!e) return;
      const worked = ctx.time.dayInfo(e, d).ev.worked;
      C.allocateDay(segs, worked).filter((x) => x.project).forEach((x) => out.push({ empId: id, day: d, project: x.project, job: x.job, minutes: x.minutes }));
    }));
    return out;
  }
  const sheets = (from, to) => co().timesheets.filter((t) => t.day >= from && t.day <= to).map((t) => ({ empId: t.empId, day: t.day, project: t.project, job: t.job || '', minutes: Math.round((+t.hours || 0) * 60), id: t.id, note: t.note }));
  // Hourly cost for a person in a month: from that month's pay run when there is one, otherwise estimated from salary.
  const rates = new Map();
  function rateOf(empId, mk) {
    const k = `${empId}|${mk}`;
    if (rates.has(k)) return rates.get(k).hourly;
    const e = emp(empId), it = st().payroll[mk]?.items.find((i) => i.empId === empId);
    const p = it || (e ? U.payCalc(e.salary, 0, st().settings, e, U.monthEnd(mk)) : {});
    const ot = st().settings.time?.ot || {};
    const r = C.hourlyCost({ basic: p.base || 0, erEpf: p.erEpf || 0, erSocso: p.erSocso || 0, erEis: p.erEis || 0, days: ot.divisor || 26, hours: ot.normalHours || 8 });
    rates.set(k, { ...r, source: it ? 'payroll' : 'estimate' });
    return r.hourly;
  }
  function entries(from, to) {
    rates.clear();
    return C.costEntries(C.mergeTime(fromCheckins(from, to), sheets(from, to)), rateOf);
  }
  const treeRows = () => C.tree(projects(), co().groups, co().jobs);

  // ---------- Projects tab ----------
  const bar = (pct, over) => `<div class="progress cs-bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, pct || 0)}%"></i></div>`;
  function projectsTab() {
    const all = entries('2000-01-01', T()), roll = C.rollup(treeRows(), all);
    const tot = (k) => roll.reduce((s, p) => s + (p[k] || 0), 0);
    return `<div class="grid g-4 keep-2"><div class="card kpi"><div class="kpi-label">Projects</div><div class="kpi-value">${projects().filter((p) => p.active !== false).length}</div></div>
        <div class="card kpi"><div class="kpi-label">Hours logged</div><div class="kpi-value num">${hrs(tot('hours'))}</div><div class="kpi-foot">of ${hrs(tot('targetHours'))} target</div></div>
        <div class="card kpi"><div class="kpi-label">Labour cost</div><div class="kpi-value num">${ctx.compactMoney(tot('cost'))}</div><div class="kpi-foot">of ${ctx.compactMoney(tot('budget'))} budget</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Jobs over budget</div><div class="kpi-value">${roll.flatMap((p) => p.groups.flatMap((g) => g.jobs)).filter((j) => j.costPct > 100).length}</div></div></div>
      ${roll.map((p) => { const open = ui.open[p.id] !== false; return `<div class="card card-flush cs-project ${p.active === false ? 'off' : ''}">
        <div class="cs-head"><button class="cs-toggle" data-act="cs-toggle" data-id="${p.id}" aria-expanded="${open}">${icon(open ? 'down' : 'right')}<span><strong>${esc(p.code)} · ${esc(p.name)}</strong><span class="faint"> ${esc(p.client || '')}${p.active === false ? ' · archived' : ''}</span></span></button>
          <div class="cs-sum"><span class="num">${hrs(p.hours)} / ${hrs(p.targetHours)}</span>${bar(p.hoursPct, p.hoursPct > 100)}<span class="num">${ctx.money(p.cost)} / ${ctx.money(p.budget)}</span>${bar(p.costPct, p.costPct > 100)}</div>
          <div class="row-actions"><button class="btn btn-sm" data-act="cs-group" data-id="" data-v="${p.id}">${icon('plus')}Group</button><button class="btn btn-sm btn-icon btn-ghost" data-act="cs-project" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button></div></div>
        ${open ? `<div class="table-wrap"><table class="cs-table"><thead><tr><th>Group and job</th><th class="r">Target</th><th class="r">Actual hours</th><th class="hide-sm"></th><th class="r">Budget</th><th class="r">Actual cost</th><th class="hide-sm"></th><th></th></tr></thead><tbody>
          ${p.groups.map((g) => `<tr class="cs-grow"><td><strong>${esc(g.code ? g.code + ' ' : '')}${esc(g.name)}</strong></td><td class="r num">${hrs(g.targetHours)}</td><td class="r num">${hrs(g.hours)}</td><td class="hide-sm">${bar(g.hoursPct, g.hoursPct > 100)}</td><td class="r num">${ctx.money(g.budget)}</td><td class="r num">${ctx.money(g.cost)}</td><td class="hide-sm">${bar(g.costPct, g.costPct > 100)}</td>
            <td><div class="row-actions"><button class="btn btn-sm" data-act="cs-job" data-id="" data-v="${g.id}">${icon('plus')}Job</button><button class="btn btn-sm btn-icon btn-ghost" data-act="cs-group" data-id="${g.id}" aria-label="Edit ${esc(g.name)}">${icon('edit')}</button></div></td></tr>
            ${g.jobs.map((j) => `<tr><td class="cs-job">${esc(j.code ? j.code + ' ' : '')}${esc(j.name)}${j.active === false ? ' <span class="tag">Closed</span>' : ''}</td><td class="r num">${hrs(+j.targetHours || 0)}</td><td class="r num ${j.hoursPct > 100 ? 'bad-text' : ''}">${hrs(j.hours)}</td><td class="hide-sm">${bar(j.hoursPct, j.hoursPct > 100)}</td><td class="r num">${ctx.money(+j.budget || 0)}</td><td class="r num ${j.costPct > 100 ? 'bad-text' : ''}">${ctx.money(j.cost)}</td><td class="hide-sm">${bar(j.costPct, j.costPct > 100)}</td>
              <td><div class="row-actions"><button class="btn btn-sm btn-icon btn-ghost" data-act="cs-job" data-id="${j.id}" aria-label="Edit ${esc(j.name)}">${icon('edit')}</button></div></td></tr>`).join('')}`).join('')}
          ${p.unassignedHours ? `<tr><td class="cs-job faint">No job picked</td><td></td><td class="r num">${hrs(p.unassignedHours)}</td><td class="hide-sm"></td><td></td><td class="r num">${ctx.money(p.unassignedCost)}</td><td class="hide-sm"></td><td></td></tr>` : ''}
          </tbody></table>${p.groups.length ? '' : '<div class="empty"><strong>No job groups yet</strong>Add a group (for example “Design” or “Build”), then jobs with target hours and a budget.</div>'}</div>` : ''}</div>`; }).join('')}
      ${projects().length ? '' : '<div class="card empty"><strong>No projects yet</strong>Add a project, then its job groups and jobs.</div>'}`;
  }
  function projectForm(id) {
    const p = id ? projectOf(id) : { active: true };
    ctx.openModal({
      title: id ? `Edit ${p.name}` : 'New project', size: 'sm', submit: id ? 'Save' : 'Add project',
      body: `<div class="form-grid"><div class="field"><label for="pj-code">Code</label><input class="input" id="pj-code" name="code" required value="${esc(p.code || `PRJ-${String(projects().length + 1).padStart(3, '0')}`)}"></div>
        <div class="field"><label for="pj-client">Client</label><input class="input" id="pj-client" name="client" value="${esc(p.client || '')}"></div>
        <div class="field full"><label for="pj-name">Name</label><input class="input" id="pj-name" name="name" required value="${esc(p.name || '')}"></div>
        <label class="check field full"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}><span>Active (people can pick it at check-in)</span></label></div>`,
      onSubmit(d) {
        const x = { code: d.code.trim(), name: d.name.trim(), client: d.client.trim(), active: d.active === 'on' };
        if (id) Object.assign(p, x); else projects().push({ id: U.uid('pj'), ...x });
        ctx.commit(id ? 'Project saved' : 'Project added');
      },
    });
  }
  function groupForm(id, projectId) {
    const g = id ? groupOf(id) : { projectId };
    ctx.openModal({
      title: id ? `Edit ${g.name}` : `New job group · ${projectOf(projectId)?.code || ''}`, size: 'sm', submit: id ? 'Save' : 'Add group',
      body: `<div class="form-grid"><div class="field"><label for="jg-code">Code</label><input class="input" id="jg-code" name="code" value="${esc(g.code || '')}" placeholder="1.0"></div><div class="field"><label for="jg-name">Name</label><input class="input" id="jg-name" name="name" required value="${esc(g.name || '')}" placeholder="Design"></div></div>
        ${id ? `<div class="ci-actions" style="justify-content:flex-start"><button type="button" class="btn btn-sm btn-ghost" data-act="cs-group-del" data-id="${id}">${icon('trash')}Delete group and its jobs</button></div>` : ''}`,
      onSubmit(d) { const x = { code: d.code.trim(), name: d.name.trim() }; if (id) Object.assign(g, x); else co().groups.push({ id: U.uid('jg'), projectId, ...x }); ui.open[g.projectId || projectId] = true; ctx.commit(id ? 'Group saved' : 'Group added'); },
    });
  }
  function jobForm(id, groupId) {
    const j = id ? jobOf(id) : { groupId, active: true };
    ctx.openModal({
      title: id ? `Edit ${j.name}` : `New job · ${groupOf(groupId)?.name || ''}`, size: 'sm', submit: id ? 'Save' : 'Add job',
      body: `<div class="form-grid"><div class="field"><label for="jb-code">Code</label><input class="input" id="jb-code" name="code" value="${esc(j.code || '')}" placeholder="1.1"></div><div class="field"><label for="jb-name">Name</label><input class="input" id="jb-name" name="name" required value="${esc(j.name || '')}"></div>
        <div class="field"><label for="jb-h">Target hours</label><input class="input num" id="jb-h" name="targetHours" type="number" min="0" step="1" value="${j.targetHours ?? ''}"></div>
        <div class="field"><label for="jb-b">Budget (${esc(st().settings.currency)})</label><input class="input num" id="jb-b" name="budget" type="number" min="0" step="100" value="${j.budget ?? ''}"></div>
        <label class="check field full"><input type="checkbox" name="active" ${j.active !== false ? 'checked' : ''}><span>Open for time (shown at check-in)</span></label></div>
        ${id ? `<div class="ci-actions" style="justify-content:flex-start"><button type="button" class="btn btn-sm btn-ghost" data-act="cs-job-del" data-id="${id}">${icon('trash')}Delete job</button></div>` : ''}`,
      onSubmit(d) { const x = { code: d.code.trim(), name: d.name.trim(), targetHours: Math.max(0, +d.targetHours || 0), budget: Math.max(0, +d.budget || 0), active: d.active === 'on' }; if (id) Object.assign(j, x); else co().jobs.push({ id: U.uid('jb'), groupId, ...x }); ctx.commit(id ? 'Job saved' : 'Job added'); },
    });
  }

  // ---------- Timesheets ----------
  const jobOptions = (cur = '') => projects().filter((p) => p.active !== false).map((p) => { const js = co().groups.filter((g) => g.projectId === p.id).flatMap((g) => co().jobs.filter((j) => j.groupId === g.id && j.active !== false).map((j) => ({ j, g }))); return `<optgroup label="${esc(p.code)} · ${esc(p.name)}"><option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.code)} · general</option>${js.map(({ j, g }) => `<option value="${p.id}|${j.id}" ${cur === `${p.id}|${j.id}` ? 'selected' : ''}>${esc(g.name)} · ${esc(j.name)}</option>`).join('')}</optgroup>`; }).join('');
  function timesheetForm(id, self = false) {
    const t = id ? co().timesheets.find((x) => x.id === id) : { day: T(), hours: 8, empId: self ? ctx.me().id : '' };
    ctx.openModal({
      title: id ? 'Edit time' : 'Log time', size: 'sm', submit: id ? 'Save' : 'Log time',
      body: `<div class="form-grid">${self ? '' : `<div class="field full"><label for="ts-e">Employee</label><select class="select" id="ts-e" name="empId">${ctx.activeEmployees().map((e) => `<option value="${e.id}" ${t.empId === e.id ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select></div>`}
        <div class="field"><label for="ts-d">Date</label><input class="input" id="ts-d" name="day" type="date" required max="${T()}" value="${t.day}"></div>
        <div class="field"><label for="ts-h">Hours</label><input class="input num" id="ts-h" name="hours" type="number" min="0.25" max="24" step="0.25" required value="${t.hours}"></div>
        <div class="field full"><label for="ts-j">Project and job</label><select class="select" id="ts-j" name="job" required>${jobOptions([t.project, t.job].filter(Boolean).join('|'))}</select></div>
        <div class="field full"><label for="ts-n">Note</label><input class="input" id="ts-n" name="note" value="${esc(t.note || '')}" placeholder="What you worked on"></div></div>
        <p class="faint">Time logged for a day replaces that day’s check-in time in project costing, so nothing is counted twice.</p>`,
      onSubmit(d) {
        const [project, job = ''] = d.job.split('|'), empId = self ? ctx.me().id : d.empId;
        const h = +d.hours || 0;
        const other = co().timesheets.filter((x) => x.empId === empId && x.day === d.day && x.id !== id).reduce((s, x) => s + (+x.hours || 0), 0);
        if (h <= 0 || other + h > 24) { ctx.toast('A day can’t have more than 24 hours', 'error'); return false; }
        const x = { empId, day: d.day, project, job, hours: h, note: d.note.trim() };
        if (id) Object.assign(t, x); else co().timesheets.push({ id: U.uid('ts'), ...x, by: actor(), at: T() });
        ctx.commit(id ? 'Time saved' : `${h} h logged on ${projectOf(project)?.code || 'the project'}`);
      },
    });
  }
  function timesheetsTab() {
    const mk = ui.tsMonth || U.monthKey(T()), from = `${mk}-01`, to = U.monthEnd(mk);
    const list = co().timesheets.filter((t) => t.day >= from && t.day <= to && emp(t.empId)).sort((a, b) => b.day.localeCompare(a.day) || nameCmp(a, b));
    const ci = fromCheckins(from, to);
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><div><h3>Timesheets</h3><div class="faint">${list.length} entries, ${hrs(list.reduce((s, t) => s + (+t.hours || 0), 0))} · plus ${hrs(ci.reduce((s, t) => s + t.minutes, 0) / 60)} from check-ins with a project</div></div>
        <div class="row-actions"><label class="sr-only" for="ts-m">Month</label><input class="input" type="month" id="ts-m" value="${mk}" max="${U.monthKey(T())}" style="width:auto"><button class="btn btn-sm btn-primary" data-act="cs-ts" data-id="">${icon('plus')}Log time</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Project and job</th><th class="r">Hours</th><th class="hide-sm">Note</th><th></th></tr></thead><tbody>
      ${list.map((t) => `<tr><td class="num">${U.fmtDate(t.day, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${ctx.person(emp(t.empId))}</td><td><strong>${esc(projectOf(t.project)?.code || '')}</strong> ${esc(jobLabel(t.job) || 'General')}</td><td class="r num">${t.hours}</td><td class="hide-sm muted">${esc(t.note || '')}</td>
        <td><div class="row-actions"><button class="btn btn-sm btn-icon btn-ghost" data-act="cs-ts" data-id="${t.id}" aria-label="Edit entry">${icon('edit')}</button><button class="btn btn-sm btn-icon btn-ghost" data-act="cs-ts-del" data-id="${t.id}" aria-label="Delete entry">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table>
      ${list.length ? '' : '<div class="empty"><strong>No timesheet entries this month</strong>Time from check-ins with a project counts on its own; log time here for work away from the check-in app.</div>'}</div></div>`;
  }
  const nameCmp = (a, b) => (emp(a.empId)?.first || '').localeCompare(emp(b.empId)?.first || '');

  // ---------- Reports ----------
  const REPORTS = [['hours', 'Monthly man-hours'], ['wages', 'Wages by project'], ['target', 'Target vs actual hours'], ['budget', 'Budget vs actual cost'], ['people', 'Hourly cost by person']];
  function reportData() {
    const { from, to } = range(), mks = AllurusReportRules.months(from, to), all = entries(from, to);
    const pname = (id) => (projectOf(id) ? `${projectOf(id).code} · ${projectOf(id).name}` : 'Other');
    if (ui.report === 'hours' || ui.report === 'wages') {
      const field = ui.report === 'hours' ? 'hours' : 'cost', rows = C.byMonth(all, mks, (t) => t.project, field);
      return { columns: [{ key: 'name', label: 'Project' }, ...mks.map((m) => ({ key: m, label: mlabel(m), type: field })), { key: 'total', label: 'Total', type: field }], rows: rows.map((r) => ({ ...r, name: pname(r.key) })),
        totals: Object.fromEntries([...mks, 'total'].map((m) => [m, AllurusReportRules.sum(rows, (r) => r[m])])), chart: mks.map((m) => ({ m, v: AllurusReportRules.sum(rows, (r) => r[m]) })), field };
    }
    if (ui.report === 'people') {
      const by = new Map();
      all.forEach((t) => { const r = by.get(t.empId) || { empId: t.empId, hours: 0, cost: 0, rate: t.rate }; r.hours = AllurusReportRules.r2(r.hours + t.hours); r.cost = AllurusReportRules.r2(r.cost + t.cost); by.set(t.empId, r); });
      const rows = [...by.values()].map((r) => { const e = emp(r.empId), mk = U.monthKey(to > T() ? T() : to); rateOf(r.empId, mk); const x = rates.get(`${r.empId}|${mk}`); return { name: ctx.fullName(e), dept: ctx.dept(e.dept)?.name || '', monthly: x?.monthly || 0, hourly: x?.hourly || 0, source: x?.source === 'payroll' ? 'Pay run' : 'Estimate', hours: r.hours, cost: r.cost }; }).sort((a, b) => b.cost - a.cost);
      return { columns: [{ key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'monthly', label: 'Monthly basic + employer EPF, SOCSO, EIS', type: 'cost' }, { key: 'hourly', label: 'Hourly cost', type: 'cost' }, { key: 'source', label: 'From' }, { key: 'hours', label: 'Project hours', type: 'hours' }, { key: 'cost', label: 'Project cost', type: 'cost' }], rows, totals: { hours: AllurusReportRules.sum(rows, (r) => r.hours), cost: AllurusReportRules.sum(rows, (r) => r.cost) } };
    }
    const roll = C.rollup(treeRows(), all), hoursRep = ui.report === 'target';
    const rows = roll.flatMap((p) => p.groups.flatMap((g) => g.jobs.map((j) => ({ project: p.code, group: g.name, job: j.name, target: hoursRep ? +j.targetHours || 0 : +j.budget || 0, actual: hoursRep ? j.hours : j.cost, left: hoursRep ? j.hoursLeft : j.budgetLeft, pct: hoursRep ? j.hoursPct : j.costPct }))));
    const type = hoursRep ? 'hours' : 'cost';
    return { columns: [{ key: 'project', label: 'Project' }, { key: 'group', label: 'Group' }, { key: 'job', label: 'Job' }, { key: 'target', label: hoursRep ? 'Target hours' : 'Budget', type }, { key: 'actual', label: hoursRep ? 'Actual hours' : 'Actual cost', type }, { key: 'left', label: 'Left', type }, { key: 'pct', label: 'Used', type: 'pct' }], rows,
      totals: { target: AllurusReportRules.sum(rows, (r) => r.target), actual: AllurusReportRules.sum(rows, (r) => r.actual), left: AllurusReportRules.sum(rows, (r) => r.left) }, vs: true,
      note: hoursRep ? 'Actual hours are all time logged up to the end date, from check-ins and timesheets.' : 'Labour cost only: hours × each person’s hourly cost (basic plus employer EPF, SOCSO and EIS ÷ standard monthly hours).' };
  }
  const cellOf = (v, type) => (v == null ? '<span class="faint">—</span>' : type === 'hours' ? hrs(v) : type === 'cost' ? ctx.money(v, 2) : type === 'pct' ? `<span class="${v > 100 ? 'bad-text' : ''}">${v}%</span>` : esc(v));
  function reportsTab() {
    const { from, to } = range();
    const d = (ui.report === 'target' || ui.report === 'budget') ? (() => { const keep = ui.from; ui.from = '2000-01-01'; const x = reportData(); ui.from = keep; return x; })() : reportData();
    const max = d.chart ? Math.max(1, ...d.chart.map((x) => x.v)) : 1;
    return `<div class="card"><div class="cs-rbar"><div class="seg" role="tablist" aria-label="Report">${REPORTS.map(([k, l]) => `<button role="tab" data-act="cs-rep" data-v="${k}" class="${ui.report === k ? 'on' : ''}" aria-selected="${ui.report === k}">${l}</button>`).join('')}</div>
        <div class="rp-filters">${d.vs ? `<div class="field"><label for="cs-to">Up to</label><input class="input" type="date" id="cs-to" value="${to}"></div>` : `<div class="field"><label for="cs-from">From</label><input class="input" type="date" id="cs-from" value="${from}"></div><div class="field"><label for="cs-to">To</label><input class="input" type="date" id="cs-to" value="${to}"></div>`}
          <div class="row-actions" style="align-self:flex-end"><button class="btn btn-sm" data-act="cs-csv">${icon('download')}CSV</button><button class="btn btn-sm" data-act="cs-print">${icon('doc')}Print</button></div></div></div>
      ${d.chart?.length ? `<div class="rp-hbars" style="margin-top:14px">${d.chart.map((x) => `<div class="hbar" style="grid-template-columns:90px minmax(0,1fr) 110px"><span>${mlabel(x.m)}</span><div class="hbar-track"><i style="width:${(x.v / max) * 100}%;background:var(--brand)"></i></div><span class="num r">${d.field === 'hours' ? hrs(x.v) : ctx.money(x.v)}</span></div>`).join('')}</div>` : ''}
      ${d.vs ? `<div class="rp-hbars" style="margin-top:14px">${d.rows.filter((r) => r.target || r.actual).slice(0, 14).map((r) => `<div class="hbar cs-vs" style="grid-template-columns:minmax(0,200px) minmax(0,1fr) 64px"><span class="rp-hl" title="${esc(r.group)} · ${esc(r.job)}">${esc(r.project)} ${esc(r.job)}</span><div class="hbar-track"><i style="width:${Math.min(100, r.pct || 0)}%;background:${(r.pct || 0) > 100 ? 'var(--bad)' : (r.pct || 0) > 85 ? 'var(--warn)' : 'var(--brand)'}"></i></div><span class="num r">${r.pct == null ? '—' : r.pct + '%'}</span></div>`).join('')}</div>` : ''}</div>
      <div class="card card-flush"><div class="table-wrap"><table class="rp-table"><thead><tr>${d.columns.map((c) => `<th class="${c.type ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${d.rows.map((r) => `<tr>${d.columns.map((c) => `<td class="${c.type ? 'r num' : ''}">${cellOf(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
        ${d.totals ? `<tfoot><tr>${d.columns.map((c, i) => `<td class="${c.type ? 'r num' : ''}">${i === 0 ? '<strong>Total</strong>' : d.totals[c.key] != null ? `<strong>${cellOf(d.totals[c.key], c.type)}</strong>` : ''}</td>`).join('')}</tr></tfoot>` : ''}</table>
        ${d.rows.length ? '' : '<div class="empty"><strong>No project time in this period</strong>Time comes from check-ins with a project and from timesheets.</div>'}</div>
        ${d.note ? `<p class="disclaimer" style="margin:12px 18px 16px">${icon('pin')}<span>${esc(d.note)}</span></p>` : ''}</div>`;
  }
  function exportRows() {
    const vs = ui.report === 'target' || ui.report === 'budget', keep = ui.from;
    if (vs) ui.from = '2000-01-01';
    const d = reportData(); ui.from = keep;
    return d;
  }

  // ---------- Pages ----------
  function adminView() {
    const tabs = [['projects', 'Projects and jobs'], ['timesheets', 'Timesheets'], ['reports', 'Reports']];
    return `<div class="page-head"><div><div class="eyebrow">Insights</div><h1>Project costing</h1><p class="sub">Hours and labour cost per project, job group and job, from check-ins and timesheets.</p></div>
        <div class="actions"><button class="btn" data-act="cs-ts" data-id="">${icon('clock')}Log time</button><button class="btn btn-primary" data-act="cs-project" data-id="">${icon('plus')}New project</button></div></div>
      <div class="seg" role="tablist" aria-label="Project costing">${tabs.map(([k, l]) => `<button role="tab" data-act="cs-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}</button>`).join('')}</div>
      ${ui.tab === 'timesheets' ? timesheetsTab() : ui.tab === 'reports' ? reportsTab() : projectsTab()}`;
  }
  function myView() {
    const e = ctx.me(), from = U.addDays(T(), -30);
    const mine = co().timesheets.filter((t) => t.empId === e.id && t.day >= U.addDays(T(), -62)).sort((a, b) => b.day.localeCompare(a.day));
    const ci = fromCheckins(from, T()).filter((t) => t.empId === e.id);
    const byProj = new Map(); ci.forEach((t) => byProj.set(t.project, (byProj.get(t.project) || 0) + t.minutes));
    return `<div class="page-head"><div><div class="eyebrow">Me</div><h1>Timesheet</h1><p class="sub">Log time on projects and jobs. Time on a day you log here replaces that day’s check-in time.</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="cs-ts-mine" data-id="">${icon('plus')}Log time</button></div></div>
      <div class="grid g-main"><div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>My entries</h3><span class="hint">Last two months</span></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Project and job</th><th class="r">Hours</th><th></th></tr></thead><tbody>${mine.map((t) => `<tr><td class="num">${U.fmtDate(t.day, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td><strong>${esc(projectOf(t.project)?.code || '')}</strong> ${esc(jobLabel(t.job) || 'General')}${t.note ? `<div class="person-sub">${esc(t.note)}</div>` : ''}</td><td class="r num">${t.hours}</td><td><div class="row-actions">${t.day >= U.addDays(T(), -14) ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="cs-ts-mine" data-id="${t.id}" aria-label="Edit entry">${icon('edit')}</button><button class="btn btn-sm btn-icon btn-ghost" data-act="cs-ts-del" data-id="${t.id}" aria-label="Delete entry">${icon('trash')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table>
        ${mine.length ? '' : '<div class="empty"><strong>Nothing logged yet</strong>Pick a project when you check in, or log time here.</div>'}</div></div>
        <div class="card"><div class="card-head"><h3>From my check-ins</h3><span class="hint">Last 30 days</span></div>${byProj.size ? `<div class="list">${[...byProj.entries()].map(([p, m]) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(projectOf(p)?.code || '')} · ${esc(projectOf(p)?.name || '')}</div></div><span class="num">${hrs(m / 60)}</span></div>`).join('')}</div>` : '<p class="faint">Pick a project or job when you check in and your hours land here.</p>'}</div></div>`;
  }
  function insights() {
    if (ctx.role() !== 'admin') return [];
    const roll = C.rollup(treeRows(), entries('2000-01-01', T()));
    const over = roll.flatMap((p) => p.groups.flatMap((g) => g.jobs.filter((j) => j.costPct > 100 || j.hoursPct > 100).map((j) => `${p.code} ${j.name}`)));
    return over.length ? [{ tone: 'warn', icon: 'target', title: `${over.length} job${over.length === 1 ? ' is' : 's are'} over target or budget`, detail: over.slice(0, 3).join(', '), action: { label: 'Projects', href: '#projects' }, prio: 1 }] : [];
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.projects = adminView;
    ctx.AFTER.projects = () => {
      ctx.$('#ts-m')?.addEventListener('change', (ev) => { ui.tsMonth = ev.target.value; ctx.render(); });
      ctx.$('#cs-from')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.from = ev.target.value; ctx.render(); } });
      ctx.$('#cs-to')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.to = ev.target.value; ctx.render(); } });
    };
    ctx.VIEWS['my-timesheet'] = myView;
    Object.assign(ctx.ACTIONS, {
      'cs-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'cs-toggle': (id) => { ui.open[id] = ui.open[id] === false; ctx.render(); },
      'cs-project': (id) => projectForm(id),
      'cs-group': (id, v) => groupForm(id, v),
      'cs-job': (id, v) => jobForm(id, v),
      'cs-group-del': (id) => { const jobIds = co().jobs.filter((j) => j.groupId === id).map((j) => j.id); co().groups = co().groups.filter((g) => g.id !== id); co().jobs = co().jobs.filter((j) => j.groupId !== id); co().timesheets.forEach((t) => { if (jobIds.includes(t.job)) t.job = ''; }); ctx.closeOverlay(); ctx.commit('Group deleted'); },
      'cs-job-del': (id) => { co().jobs = co().jobs.filter((j) => j.id !== id); co().timesheets.forEach((t) => { if (t.job === id) t.job = ''; }); ctx.closeOverlay(); ctx.commit('Job deleted'); },
      'cs-ts': (id) => timesheetForm(id),
      'cs-ts-mine': (id) => timesheetForm(id, true),
      'cs-ts-del': (id) => { co().timesheets = co().timesheets.filter((t) => t.id !== id); ctx.commit('Entry deleted'); },
      'cs-rep': (_, v) => { ui.report = v; ctx.render(); },
      'cs-csv': () => { const d = exportRows(); ctx.downloadCSV(`project-${ui.report}-${ui.to}.csv`, [d.columns.map((c) => c.label), ...d.rows.map((r) => d.columns.map((c) => r[c.key] ?? '')), ...(d.totals ? [d.columns.map((c, i) => (i === 0 ? 'Total' : d.totals[c.key] ?? ''))] : [])]); },
      'cs-print': () => { const d = exportRows(), name = REPORTS.find((r) => r[0] === ui.report)[1]; ctx.docs.printDocs(`<article class="doc rp-doc"><header class="doc-head"><div><div class="doc-co">${esc(st().settings.company.toUpperCase())}</div><div class="doc-sub">${esc(name)} · ${d.vs ? `up to ${fmt(ui.to)}` : `${fmt(ui.from)} to ${fmt(ui.to)}`}</div></div><div class="doc-title"><strong>Project costing</strong><span>Printed ${fmt(T())}</span></div></header>
        <table class="doc-table rp-table"><thead><tr>${d.columns.map((c) => `<th class="${c.type ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r) => `<tr>${d.columns.map((c) => `<td class="${c.type ? 'r' : ''}">${cellOf(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>${d.totals ? `<tfoot><tr>${d.columns.map((c, i) => `<td class="${c.type ? 'r' : ''}">${i === 0 ? 'Total' : d.totals[c.key] != null ? cellOf(d.totals[c.key], c.type) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table>${d.note ? `<p class="doc-draft">${esc(d.note)}</p>` : ''}</article>`, `${name} ${ui.to}`); },
    });
    return { entries, rateOf, insights, hasProjects: () => projects().some((p) => p.active !== false) };
  }
  return { install };
})();
