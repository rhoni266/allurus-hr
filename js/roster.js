// Time attendance and rostering: working patterns, the Schedule page (a week roster), lateness, early-out and
// overtime on Attendance and My attendance, overtime / lateness waiver / correction requests with approvals,
// daily allowances, the audit trail and batch edits, and the overtime and allowances that feed payroll.
// The rules live in js/attendance-rules.js (AllurusTimeRules); this file is the screens around them.
window.AllurusTime = (function () {
  'use strict';
  const R = window.AllurusTimeRules, LR = window.AllurusLeaveRules;
  let ctx = null;
  const st = () => ctx.state;
  const cfg = () => st().settings.time;
  const otRules = () => cfg().ot;
  const T = () => U.today();
  const esc = (s) => ctx.esc(s);
  const ui = { week: R.mondayOf(U.today()), dept: 'all' };
  const KINDS = { ot: 'Overtime', waiver: 'Lateness waiver', correction: 'Correction' };
  const KIND_HELP = { ot: 'Ask before (or right after) working extra time.', waiver: 'Ask HR to excuse lateness, for example a flood or a breakdown.', correction: 'Fix a missed or wrong check-in or check-out.' };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STATUS = { present: 'In office', remote: 'Remote', absent: 'Absent', leave: 'Leave' };

  // ---------- Data helpers ----------
  const patterns = () => cfg().patterns;
  const pat = (id) => patterns().find((p) => p.id === id) || null;
  const calFor = (from, to) => LR.calendarCtx(st().settings.leave, from, to);
  const recOf = (day, id) => st().attendance[day]?.[id] || null;
  const rosterOf = (day, id) => st().rosters?.[day]?.[id] || '';
  const reqs = () => st().timeRequests;
  const approvedReqs = (empId, day, kind) => reqs().filter((q) => q.empId === empId && q.date === day && q.kind === kind && q.status === 'Approved');
  const approvedMin = (empId, day) => approvedReqs(empId, day, 'ot').reduce((s, q) => s + (q.minutes || 0), 0);
  const onLeave = (id, day) => !!ctx.leave?.onLeave(id, day);
  const basicOf = (e) => U.round2((Number(e.salary) || 0) / 12);
  const nameOf = (id) => ctx.fullName(ctx.emp(id));
  const firstOf = (id) => ctx.emp(id)?.first || '—';
  const hrs = (min) => `${U.round2(min / 60)} h`;
  const fmtDay = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => U.fmtDate(d, o);
  const defaultFor = (e) => pat(e.timePattern) || pat(cfg().deptPattern?.[e.dept]);
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const actorName = () => (ctx.role() === 'admin' ? ctx.account()?.name || nameOf(actor()) : nameOf(actor()));
  const pill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'ok', Rejected: 'bad', Cancelled: '' })[s] || ''}">${s === 'Rejected' ? 'Declined' : s}</span>`;

  function resolve(e, day, rec, cal) {
    return R.resolveDay({ day, rec, roster: rosterOf(day, e.id), empPattern: e.timePattern, deptPattern: cfg().deptPattern?.[e.dept], cfg: cfg(), holiday: cal.holidays.has(day), companyRest: cal.weekend.includes(R.dow(day)) });
  }
  // Everything about one person's day: the shift, the day type, lateness, early-out and overtime.
  function dayInfo(e, day, cal = calFor(day, day)) {
    const rec = recOf(day, e.id), res = resolve(e, day, rec, cal);
    const ev = R.evaluate({ rec, pattern: res.pattern, type: res.type, rules: otRules(), waived: approvedReqs(e.id, day, 'waiver').length > 0, approvedMin: approvedMin(e.id, day) });
    return { day, rec, ...res, ev, leave: rec?.s === 'leave' || onLeave(e.id, day) };
  }
  // A person's month: each day, overtime after the monthly limits, overtime pay and allowances.
  function monthFor(e, mk) {
    const first = `${mk}-01`, last = U.monthEnd(mk), end = last < T() ? last : T(), cal = calFor(first, last);
    const days = [];
    for (let d = first > e.start ? first : e.start; d <= end; d = U.addDays(d, 1)) days.push(dayInfo(e, d, cal));
    const cap = R.capMonth(days.map((x) => ({ day: x.day, buckets: x.ev.buckets })), otRules());
    const pay = R.otPay(cap.buckets, basicOf(e), otRules());
    const allow = cfg().allowances.filter((a) => a.on).map((a) => {
      const out = { rule: a, amount: 0, full: 0, partial: 0, forfeit: 0 };
      days.forEach((x) => {
        const r = R.allowanceFor(a, { type: x.type, status: x.leave ? 'leave' : x.rec?.s || '', late: x.ev.late, patternId: x.pattern?.id || '', scheduled: x.type === 'normal' });
        out.amount += r.amount; if (r.outcome in out) out[r.outcome]++;
      });
      out.amount = U.round2(out.amount);
      return out;
    });
    const sum = (f) => days.reduce((s, x) => s + f(x), 0);
    return {
      days, cap, pay, allow,
      late: { days: days.filter((x) => x.ev.late).length, min: sum((x) => x.ev.late) },
      early: { days: days.filter((x) => x.ev.early).length, min: sum((x) => x.ev.early) },
      unapproved: sum((x) => x.ev.unapproved), paidMin: R.paidMinutes(cap.buckets),
    };
  }
  // Earnings lines for a pay run: approved overtime and the month's allowances, with their EPF, SOCSO and tax flags.
  function forPayroll(e, mk) {
    const m = monthFor(e, mk), o = otRules(), lines = [];
    if (m.pay.amount > 0) {
      lines.push({ key: 'ot', label: `Overtime, ${hrs(m.paidMin)}`, amount: m.pay.amount, epf: !!o.epf, socso: !!o.socso, tax: !!o.tax,
        detail: o.flat ? `Flat ${ctx.money(o.flatRate, 2)} an hour` : `${m.pay.lines.map((l) => `${hrs(l.minutes)} × ${l.rate}`).join(', ')} at ${ctx.money(m.pay.hourly, 2)} an hour` });
    }
    m.allow.filter((a) => a.amount > 0).forEach((a) => lines.push({ key: a.rule.id, label: `${a.rule.name} allowance`, amount: a.amount, epf: !!a.rule.epf, socso: !!a.rule.socso, tax: !!a.rule.tax,
      detail: `${a.full + a.partial} day${a.full + a.partial === 1 ? '' : 's'}${a.partial ? `, ${a.partial} part-paid` : ''}${a.forfeit ? `, ${a.forfeit} forfeited` : ''}` }));
    return lines;
  }

  // ---------- Audit trail ----------
  function audit(day, empId, before, after, note = '', batch = '') {
    const changes = R.diff(before, after);
    if (!changes.length) return false;
    st().attAudit.unshift({ id: U.uid('au-'), day, empId, by: actor(), byName: actorName(), at: new Date().toISOString(), changes, note, batch });
    if (st().attAudit.length > 3000) st().attAudit.length = 3000;
    return true;
  }
  // Every manual change to a record goes through here so it is audited. after = null clears the day.
  function setRecord(day, empId, after, note = '', batch = '') {
    const before = recOf(day, empId);
    const b = before ? { s: before.s, in: before.in || '', out: before.out || '' } : null;
    if (after && !['present', 'remote'].includes(after.s)) after = { ...after, in: '', out: '' };
    audit(day, empId, b, after, note, batch);
    st().attendance[day] = st().attendance[day] || {};
    if (!after) delete st().attendance[day][empId];
    else st().attendance[day][empId] = { ...(before || {}), ...after };
  }
  const auditFor = (day, empId) => st().attAudit.filter((a) => a.day === day && a.empId === empId);
  const FIELD = { s: 'Status', in: 'Check-in', out: 'Check-out' };
  const val = (k, v) => (k === 's' ? STATUS[v] || 'Not marked' : v || '—');
  function historyHtml(list) {
    if (!list.length) return '<p class="faint" style="margin-top:14px">No manual changes to this day.</p>';
    return `<h4 class="lv-h" style="margin-top:16px">Change history</h4><ol class="audit-list">${list.map((a) => `<li>
      <div><strong>${esc(a.byName || nameOf(a.by))}</strong> <span class="faint">· ${new Date(a.at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${a.batch ? ' · batch edit' : ''}</span></div>
      <div>${a.changes.map((c) => `${FIELD[c.field]} <span class="num">${esc(val(c.field, c.from))}</span> → <span class="num">${esc(val(c.field, c.to))}</span>`).join('; ')}</div>
      ${a.note ? `<div class="faint">“${esc(a.note)}”</div>` : ''}</li>`).join('')}</ol>`;
  }

  // ---------- Small pieces ----------
  const chip = (p, sub = true) => (p ? `<span class="shift-chip" style="--c:${esc(p.color || '#0F766E')}">${esc(p.name)}</span>${sub ? `<div class="person-sub">${esc(R.shiftLabel(p))}</div>` : ''}` : '');
  function tagsFor(x) {
    const t = [], ev = x.ev, paid = R.paidMinutes(ev.buckets);
    if (ev.late) t.push(`<span class="tag bad">Late ${R.fmtDur(ev.late)}</span>`);
    if (ev.waived) t.push('<span class="tag">Lateness waived</span>');
    if (ev.early) t.push(`<span class="tag warn">Out ${R.fmtDur(ev.early)} early</span>`);
    if (ev.short && !ev.early) t.push(`<span class="tag warn">${R.fmtDur(ev.short)} short</span>`);
    if (paid) t.push(`<span class="tag ok">${x.type === 'normal' ? 'OT' : x.type === 'rest' ? 'Rest day' : 'Holiday'} ${hrs(paid)}</span>`);
    if (ev.unapproved) t.push(`<span class="tag info" title="Overtime is only paid once it is approved">${hrs(ev.unapproved)} OT not approved</span>`);
    if (ev.offset) t.push(`<span class="tag" title="Late minutes taken off overtime">${ev.offset} min offset</span>`);
    return t.join(' ');
  }
  const shiftCell = (x) => (x.leave ? '<span class="faint">On leave</span>' : x.pattern && !x.off ? `${chip(x.pattern)}${x.source === 'auto' ? '<div class="person-sub">Auto-shift from check-in</div>' : ''}` : x.type === 'holiday' ? '<span class="faint">Public holiday</span>' : x.off ? '<span class="faint">Rest day</span>' : '<span class="faint">No shift</span>');
  // Shift and lateness / overtime cells for the Attendance table.
  function attCells(e, day) {
    const x = dayInfo(e, day);
    return { shift: shiftCell(x), tags: tagsFor(x), info: x, history: auditFor(day, e.id).length };
  }
  function dayTotals(day, people) {
    const cal = calFor(day, day), xs = people.map((e) => dayInfo(e, day, cal));
    return { late: xs.filter((x) => x.ev.late).length, early: xs.filter((x) => x.ev.early).length, ot: xs.reduce((s, x) => s + R.paidMinutes(x.ev.buckets), 0) };
  }
  function todayShift(e) {
    const x = dayInfo(e, T());
    if (x.leave) return 'You’re on leave today.';
    if (x.type === 'holiday' && !x.pattern) return 'Public holiday today.';
    if (x.off) return 'Rest day today. Time worked counts as rest-day pay.';
    if (!x.pattern) return '';
    return `Today: ${x.pattern.name}, ${R.shiftLabel(x.pattern)}${x.source === 'auto' ? ' (picked from your check-in)' : ''}.`;
  }

  // ---------- Schedule (week roster) ----------
  const people = () => ctx.activeEmployees().filter((e) => ui.dept === 'all' || e.dept === ui.dept).sort((a, b) => (a.dept === b.dept ? a.first.localeCompare(b.first) : (ctx.dept(a.dept)?.name || '').localeCompare(ctx.dept(b.dept)?.name || '')));
  function weekModel(monday = ui.week, list = people(), dept = ui.dept) {
    const days = R.weekDays(monday), cal = calFor(R.addDays(days[0], -1), days[6]);
    const rows = list.map((e) => {
      const cells = days.map((d) => {
        const x = resolve(e, d, recOf(d, e.id), cal), lv = onLeave(e.id, d), v = rosterOf(d, e.id);
        return { day: d, v, x, leave: lv, working: !!(x.pattern && !x.off && !lv && (x.type !== 'holiday' || v)) };
      });
      // Overlaps include the day before the week, so Monday is checked too.
      const assign = {};
      [R.addDays(days[0], -1), ...days].forEach((d) => { const x = resolve(e, d, null, cal); assign[d] = x.pattern && !x.off ? x.pattern.id : 'off'; });
      const clash = R.overlaps(assign, patterns());
      cells.forEach((c) => { c.overlap = clash.includes(c.day); c.leaveClash = c.leave && c.v && c.v !== 'off'; });
      return { e, cells };
    });
    const min = Number(cfg().minStaff?.[dept]) || 0;
    const counts = days.map((d, i) => rows.filter((r) => r.cells[i].working).length);
    const workday = days.map((d) => !cal.weekend.includes(R.dow(d)) && !cal.holidays.has(d));
    const below = days.filter((d, i) => min && (workday[i] || counts[i]) && counts[i] < min);
    return { days, cal, rows, counts, min, below, workday };
  }
  function scheduleView() {
    const m = weekModel(), depts = st().departments;
    const holName = Object.fromEntries(LR.holidaysFor(+m.days[0].slice(0, 4), st().settings.leave).concat(LR.holidaysFor(+m.days[6].slice(0, 4), st().settings.leave)).filter((h) => !h.off).map((h) => [h.date, h.name]));
    const overlaps = m.rows.flatMap((r) => r.cells.filter((c) => c.overlap).map((c) => `${r.e.first} on ${fmtDay(c.day, { weekday: 'short' })}`));
    const leaveClash = m.rows.flatMap((r) => r.cells.filter((c) => c.leaveClash).map((c) => `${r.e.first} on ${fmtDay(c.day, { weekday: 'short' })}`));
    const issues = [
      ...(m.below.length ? [`Below the minimum of ${m.min} on shift: ${m.below.map((d) => fmtDay(d, { weekday: 'short', day: 'numeric' })).join(', ')}.`] : []),
      ...(overlaps.length ? [`Shifts run into the next one: ${overlaps.join(', ')}.`] : []),
      ...(leaveClash.length ? [`Rostered while on approved leave: ${leaveClash.join(', ')}.`] : []),
    ];
    const cell = (e, c) => {
      const p = c.x.pattern, label = c.leave ? 'On leave' : c.x.off || !p ? (c.x.type === 'holiday' ? 'Holiday' : 'Off') : p.name;
      const aria = `${ctx.fullName(e)}, ${fmtDay(c.day, { weekday: 'long', day: 'numeric', month: 'long' })}: ${label}${p && !c.x.off ? ` ${R.shiftLabel(p)}` : ''}${c.v ? '' : ' (default)'}. Change`;
      const cls = ['ro-cell', c.v ? 'set' : 'default', c.leave ? 'leave' : '', (c.x.off || !p) && !c.leave ? 'off' : '', c.overlap || c.leaveClash ? 'clash' : ''].join(' ');
      return `<td><button type="button" class="${cls}" style="--c:${esc(p?.color || '#8A8F98')}" data-act="ro-cell" data-id="${e.id}" data-v="${c.day}" aria-label="${esc(aria)}">
        <span class="ro-name">${esc(label)}</span>${p && !c.x.off && !c.leave ? `<span class="ro-time">${esc(R.shiftLabel(p))}</span>` : ''}</button></td>`;
    };
    return `
      <div class="page-head"><div><div class="eyebrow">Time</div><h1>Schedule</h1><p class="sub">Week of ${fmtDay(m.days[0], { day: 'numeric', month: 'long', year: 'numeric' })}. Click a cell to set a shift or a day off. Faded cells follow the person’s or department’s pattern.</p></div>
        <div class="actions">
          <button class="btn btn-icon" data-act="ro-week" data-v="-1" aria-label="Previous week">${ctx.icon('left')}</button>
          <button class="btn" data-act="ro-this">This week</button>
          <button class="btn btn-icon" data-act="ro-week" data-v="1" aria-label="Next week">${ctx.icon('right')}</button>
          <button class="btn" data-act="ro-copy">Copy last week</button>
          <button class="btn btn-primary" data-act="ro-template">${ctx.icon('calendar')}Apply rotation</button>
        </div></div>
      <div class="card ro-bar">
        <div class="field"><label for="ro-dept">Team</label><select class="select" id="ro-dept"><option value="all">Everyone</option>${depts.map((d) => `<option value="${d.id}" ${ui.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ro-min">Minimum on shift</label><input class="input num" id="ro-min" type="number" min="0" max="999" value="${m.min || ''}" placeholder="None" style="width:110px"></div>
        <div class="legend ro-legend">${patterns().map((p) => `<span><i class="ro-key" style="--c:${esc(p.color || '#0F766E')}"></i>${esc(p.name)}</span>`).join('')}<span><i class="ro-key off"></i>Off</span><span><i class="ro-key leave"></i>Leave</span></div>
        <button class="btn btn-sm btn-ghost" data-act="ro-clear">Clear this week</button>
      </div>
      ${issues.length ? `<div class="lock-banner warn" role="status">${ctx.icon('help')}<span>${issues.map(esc).join('<br>')}</span></div>` : ''}
      <div class="card card-flush"><div class="table-wrap ro-wrap"><table class="ro-table">
        <thead><tr><th scope="col">Person</th>${m.days.map((d) => `<th scope="col" class="${m.workday[m.days.indexOf(d)] ? '' : 'rest'} ${d === T() ? 'today' : ''}"><div>${DOW[R.dow(d)]} ${+d.slice(8)}</div>${holName[d] ? `<div class="ro-hol" title="${esc(holName[d])}">${esc(holName[d])}</div>` : ''}</th>`).join('')}</tr></thead>
        <tbody>${m.rows.map((r) => `<tr><th scope="row">${ctx.person(r.e, defaultFor(r.e)?.name || 'No default pattern')}</th>${r.cells.map((c) => cell(r.e, c)).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><th scope="row">On shift${m.min ? ` <span class="faint">(min ${m.min})</span>` : ''}</th>${m.counts.map((n, i) => `<td class="num ${m.below.includes(m.days[i]) ? 'ro-low' : ''}">${n}${m.below.includes(m.days[i]) ? ` <span class="sr-only">below minimum</span>` : ''}</td>`).join('')}</tr></tfoot>
      </table></div>${m.rows.length ? '' : '<div class="empty"><strong>No one in this team</strong>Pick another team.</div>'}</div>
      <p class="faint" style="font-size:12.5px">Working patterns, rotations and the minimum per team are in <button class="link-btn" data-act="tm-goto" data-v="time-patterns">Settings</button>.</p>`;
  }
  function bindSchedule() {
    ctx.$('#ro-dept')?.addEventListener('change', (ev) => { ui.dept = ev.target.value; ctx.render(); });
    ctx.$('#ro-min')?.addEventListener('change', (ev) => {
      const n = Math.max(0, Math.round(Number(ev.target.value) || 0));
      cfg().minStaff = { ...(cfg().minStaff || {}), [ui.dept]: n };
      ctx.commit(n ? `Minimum ${n} on shift saved` : 'Minimum removed');
    });
  }
  function setRoster(day, empId, v) {
    st().rosters[day] = st().rosters[day] || {};
    if (v) st().rosters[day][empId] = v; else delete st().rosters[day][empId];
    if (!Object.keys(st().rosters[day]).length) delete st().rosters[day];
  }
  // Tells each person whose shifts changed, once per change.
  function rosterNotify(empIds, monday, detail) {
    [...new Set(empIds)].forEach((id) => ctx.notify?.event('roster.changed', { week: monday, detail: detail || `Your shifts for the week of ${fmtDay(monday, { day: 'numeric', month: 'short' })} were updated.`, href: '#my-time' }, id));
  }
  function mergeRoster(plan, empIds, days) {
    days.forEach((d) => empIds.forEach((id) => setRoster(d, id, '')));
    Object.entries(plan).forEach(([d, x]) => Object.entries(x).forEach(([id, v]) => setRoster(d, id, v)));
  }
  function openCell(empId, day) {
    const e = ctx.emp(empId), cur = rosterOf(day, empId), def = defaultFor(e);
    const lv = onLeave(empId, day);
    const opt = (v, label, sub, color) => `<label class="ro-opt"><input type="radio" name="v" value="${esc(v)}" ${cur === v ? 'checked' : ''}><i class="ro-key ${v === 'off' ? 'off' : ''}" style="--c:${esc(color || '#8A8F98')}"></i><span><strong>${esc(label)}</strong>${sub ? `<span class="faint"> ${esc(sub)}</span>` : ''}</span></label>`;
    ctx.openModal({
      title: `${e.first} · ${fmtDay(day, { weekday: 'long', day: 'numeric', month: 'short' })}`, size: 'sm', submit: 'Save',
      body: `${lv ? `<div class="lock-banner warn">${ctx.icon('calendar')}<span>${esc(e.first)} is on approved leave this day.</span></div>` : ''}
        <fieldset class="ro-opts"><legend class="sr-only">Shift</legend>
        ${opt('', 'Usual pattern', def ? `${def.name}, ${R.shiftLabel(def)}${def.days.includes(R.dow(day)) ? '' : ' (not a working day)'}` : cfg().autoShift ? 'Auto-shift from check-in' : 'No pattern', def?.color)}
        ${patterns().map((p) => opt(p.id, p.name, R.shiftLabel(p), p.color)).join('')}
        ${opt('off', 'Day off', 'Rest day')}</fieldset>
        <label class="check" style="margin-top:12px"><input type="checkbox" name="rest"><span>Same for the rest of the week</span></label>`,
      onSubmit(d) {
        const days = d.rest ? R.weekDays(R.mondayOf(day)).filter((x) => x >= day) : [day];
        days.forEach((x) => setRoster(x, empId, d.v || ''));
        const p = pat(d.v);
        rosterNotify([empId], R.mondayOf(day), `${fmtDay(day, { weekday: 'long', day: 'numeric', month: 'short' })}${days.length > 1 ? ' onwards' : ''}: ${d.v === 'off' ? 'day off' : p ? `${p.name}, ${R.shiftLabel(p)}` : 'your usual pattern'}.`);
        ctx.commit(`${e.first}: ${d.v === 'off' ? 'day off' : p ? p.name : 'usual pattern'}${days.length > 1 ? ` for ${days.length} days` : ''}`);
      },
    });
  }
  function openTemplate() {
    const list = cfg().templates || [];
    if (!list.length) { ctx.toast('Add a rotation in Settings first', 'info'); goto('time-rosters'); return; }
    const team = people();
    ctx.openModal({
      title: 'Apply a rotation', size: 'sm', submit: 'Apply',
      body: `<div class="form-grid">
        <div class="field full"><label for="rt-tpl">Rotation</label><select class="select" id="rt-tpl" name="tpl">${list.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.weeks.length} week${t.weeks.length === 1 ? '' : 's'})</option>`).join('')}</select></div>
        <div class="field"><label for="rt-weeks">Weeks to fill</label><input class="input num" id="rt-weeks" name="weeks" type="number" min="1" max="12" value="4"></div>
        <div class="field"><label for="rt-start">Start at week</label><input class="input num" id="rt-start" name="start" type="number" min="1" max="12" value="1"></div>
        <label class="check full"><input type="checkbox" name="stagger" checked><span>Stagger people, so each starts one week further into the cycle</span></label>
        <p class="field-hint full">From ${fmtDay(ui.week, { day: 'numeric', month: 'short' })} for ${team.length} ${ui.dept === 'all' ? 'people' : `people in ${esc(ctx.dept(ui.dept)?.name || '')}`}. It replaces their roster for those weeks.</p></div>`,
      onSubmit(d) {
        const t = list.find((x) => x.id === d.tpl), weeks = Math.min(12, Math.max(1, Number(d.weeks) || 1));
        const plan = R.applyTemplate(t, { monday: ui.week, weeks, empIds: team.map((e) => e.id), startWeek: Math.max(0, (Number(d.start) || 1) - 1), stagger: !!d.stagger });
        const days = Array.from({ length: weeks * 7 }, (_, i) => R.addDays(ui.week, i));
        mergeRoster(plan, team.map((e) => e.id), days);
        rosterNotify(team.map((e) => e.id), ui.week, `${t.name} rotation applied from the week of ${fmtDay(ui.week, { day: 'numeric', month: 'short' })} for ${weeks} week${weeks === 1 ? '' : 's'}.`);
        ctx.commit(`${t.name} applied for ${weeks} week${weeks === 1 ? '' : 's'}`, `${t.name} rotation applied to ${team.length} people from ${U.fmtDate(ui.week)}`);
      },
    });
  }

  // ---------- Requests: overtime, lateness waiver, correction ----------
  const isAway = (id) => onLeave(id, T());
  function canActOn(q) {
    if (q.status !== 'Pending') return '';
    const step = LR.nextStep(q.chain);
    const as = step ? LR.canAct(step, actor(), isAway) : '';
    return as || (ctx.role() === 'admin' ? 'override' : '');
  }
  const forMe = (empId) => reqs().filter((q) => q.status === 'Pending' && LR.canAct(LR.nextStep(q.chain), empId, isAway));
  const detailOf = (q) => (q.kind === 'ot' ? `${q.from}–${q.to} · ${hrs(q.minutes)}` : q.kind === 'correction' ? `${STATUS[q.s] || 'In office'}${q.in ? ` · in ${q.in}` : ''}${q.out ? ` · out ${q.out}` : ''}` : (() => { const e = ctx.emp(q.empId); const x = e ? dayInfo(e, q.date) : null; return x?.ev.lateRaw ? `${R.fmtDur(x.ev.lateRaw)} late` : 'Late'; })());
  function chainDots(q) {
    const steps = (q.chain || []).filter((s) => s.status !== 'skipped');
    const next = LR.nextStep(q.chain);
    return steps.length ? `<span class="chain-dots" aria-hidden="true">${steps.map((s) => `<i class="cd-${s === next ? 'next' : s.status}" title="${s.level}: ${esc(nameOf(s.approver))}"></i>`).join('')}</span>` : '';
  }
  const nextText = (q) => { const n = LR.nextStep(q.chain); return q.status !== 'Pending' ? '' : n ? `With ${firstOf(n.approver)}` : 'With HR'; };
  function rows(list, { showEmp = true, mine = false } = {}) {
    return list.map((q) => `<tr class="clickable" data-act="tm-review" data-id="${q.id}">
      ${showEmp ? `<td>${ctx.person(ctx.emp(q.empId))}</td>` : ''}
      <td><strong>${KINDS[q.kind]}</strong><div class="person-sub">${esc(detailOf(q))}</div><div class="tm-reason">“${esc(q.reason)}”</div></td>
      <td class="num" style="white-space:nowrap">${fmtDay(q.date)}</td>
      <td class="hide-sm"><div class="lv-next">${chainDots(q)}<span class="faint">${esc(nextText(q))}</span></div></td>
      <td>${pill(q.status)}</td>
      <td><div class="row-actions">${mine && q.status === 'Pending' ? `<button class="btn btn-sm btn-ghost" data-act="tm-cancel" data-id="${q.id}">Cancel</button>` : `<button class="btn btn-sm" data-act="tm-review" data-id="${q.id}">${canActOn(q) ? 'Review' : 'View'}</button>`}</div></td></tr>`).join('');
  }
  const head = (showEmp = true) => `<thead><tr>${showEmp ? '<th>Employee</th>' : ''}<th>Request</th><th>Date</th><th class="hide-sm">Approval</th><th>Status</th><th></th></tr></thead>`;
  // Admin: requests waiting, on the Attendance page.
  function requestsCard() {
    const pend = reqs().filter((q) => q.status === 'Pending').sort((a, b) => a.date.localeCompare(b.date));
    const recent = reqs().filter((q) => q.status !== 'Pending').sort((a, b) => (b.decidedAt || b.date).localeCompare(a.decidedAt || a.date)).slice(0, 4);
    return `<div class="card card-flush" id="time-requests"><div class="card-head" style="padding-bottom:12px"><h3>Overtime and attendance requests</h3><span class="hint">${pend.length ? `${pend.length} waiting` : 'All decided'}</span></div>
      <div class="table-wrap"><table class="lv-req">${head()}<tbody>${rows(pend)}${rows(recent)}</tbody></table>
      ${pend.length + recent.length ? '' : '<div class="empty"><strong>No requests yet</strong>Staff ask for overtime, lateness waivers and corrections from My attendance.</div>'}</div></div>`;
  }
  // Approvers: requests from their team, on the Approvals page.
  function approvalsCard(empId) {
    const mine = forMe(empId);
    const depts = ctx.leave?.myDepts(empId) || [];
    const watching = reqs().filter((q) => q.status === 'Pending' && !mine.includes(q) && depts.includes(ctx.emp(q.empId)?.dept) && q.empId !== empId);
    return `<div class="card card-flush" id="time-approvals"><div class="card-head" style="padding-bottom:12px"><h3>Overtime and attendance</h3><span class="hint">${mine.length}</span></div>
      <div class="table-wrap"><table class="lv-req">${head()}<tbody>${rows(mine)}${rows(watching)}</tbody></table>
      ${mine.length || watching.length ? '' : '<div class="empty"><strong>All caught up</strong>Overtime, lateness waivers and corrections from your team show here.</div>'}</div></div>`;
  }
  function myRequestsCard(e) {
    const list = reqs().filter((q) => q.empId === e.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>My requests</h3><button class="btn btn-sm" data-act="tm-request">${ctx.icon('plus')}New request</button></div>
      <div class="table-wrap"><table class="lv-req">${head(false)}<tbody>${rows(list, { showEmp: false, mine: true })}</tbody></table>
      ${list.length ? '' : '<div class="empty"><strong>No requests</strong>Ask for overtime, a lateness waiver or a correction.</div>'}</div></div>`;
  }
  function openRequest(kind = 'ot', day = '') {
    const e = ctx.me();
    if (!day) { day = T(); if (kind !== 'ot') { const x = dayInfo(e, day); if (!x.rec?.in) day = U.addDays(day, -1); } }
    const info = (d) => {
      const x = dayInfo(e, d), p = x.pattern;
      return `${p && !x.off ? `${esc(p.name)}, ${esc(R.shiftLabel(p))}` : x.type === 'holiday' ? 'Public holiday' : 'Rest day'}${x.rec?.in ? ` · in ${x.rec.in}${x.rec.out ? `, out ${x.rec.out}` : ''}` : ' · no check-in'}${x.ev.late ? ` · ${R.fmtDur(x.ev.late)} late` : ''}`;
    };
    const p = dayInfo(e, day).pattern, end = p && !p.flexible ? p.end : '18:00';
    const plus = R.fmtMin(R.toMin(end) + 120);
    ctx.openModal({
      title: 'New request', size: 'sm', submit: 'Send request',
      body: `<div class="form-grid">
        <div class="field full"><label for="tr-kind">What do you need?</label><select class="select" id="tr-kind" name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="field-hint" id="tr-help">${KIND_HELP[kind]}</span></div>
        <div class="field full"><label for="tr-date">Date</label><input class="input" type="date" id="tr-date" name="date" value="${day}" max="${U.addDays(T(), 31)}" required><span class="field-hint" id="tr-info">${info(day)}</span></div>
        <div class="field" data-k="ot"><label for="tr-from">From</label><input class="input" type="time" id="tr-from" name="from" value="${end}"></div>
        <div class="field" data-k="ot"><label for="tr-to">To</label><input class="input" type="time" id="tr-to" name="to" value="${plus}"></div>
        <div class="field full" data-k="correction"><label for="tr-s">Status</label><select class="select" id="tr-s" name="s"><option value="present">In office</option><option value="remote">Remote</option></select></div>
        <div class="field" data-k="correction"><label for="tr-in">Check-in</label><input class="input" type="time" id="tr-in" name="in"></div>
        <div class="field" data-k="correction"><label for="tr-out">Check-out</label><input class="input" type="time" id="tr-out" name="out"></div>
        <div class="field full"><label for="tr-reason">Reason</label><textarea class="input" id="tr-reason" name="reason" rows="2" required placeholder="A short note for your manager"></textarea></div>
        <p class="field-hint full">Goes to ${esc(approverText(e))}.</p></div>`,
      onSubmit(d) {
        const r = d.reason.trim();
        const q = { id: U.uid('tr-'), empId: e.id, kind: d.kind, date: d.date, reason: r, status: 'Pending', created: T() };
        if (d.kind === 'ot') {
          const a = R.toMin(d.from), b = R.toMin(d.to);
          if (a == null || b == null || a === b) { ctx.toast('Add the overtime start and end', 'error'); return false; }
          Object.assign(q, { from: d.from, to: d.to, minutes: (b - a + 1440) % 1440 });
        } else if (d.date > T()) { ctx.toast('Pick a day that has already happened', 'error'); return false; }
        if (d.kind === 'correction') {
          if (!d.in && !d.out) { ctx.toast('Add the right check-in or check-out time', 'error'); return false; }
          Object.assign(q, { s: d.s, in: d.in || recOf(d.date, e.id)?.in || '', out: d.out || recOf(d.date, e.id)?.out || '' });
        }
        if (reqs().some((x) => x.empId === e.id && x.kind === q.kind && x.date === q.date && x.status === 'Pending')) { ctx.toast('You already have this request waiting for that day', 'error'); return false; }
        const L = st().settings.leave;
        q.chain = LR.buildChain({ applicant: e.id, chain: L.chains?.[e.dept], hr: L.hr, hrBackup: L.hrBackup });
        reqs().push(q);
        const n = LR.nextStep(q.chain);
        ctx.notify?.request(q.kind, q, 'submitted', { summary: `${fmtDay(q.date)}${q.kind === 'ot' ? `, ${hrs(q.minutes)}` : ''}` });
        ctx.commit(`Sent to ${n ? firstOf(n.approver) : 'HR'}`, `${ctx.fullName(e)} asked for ${KINDS[q.kind].toLowerCase()} on ${U.fmtDate(q.date)}`);
      },
    });
    const form = ctx.$('#overlay-root form');
    const sync = () => {
      const k = ctx.$('#tr-kind').value;
      ctx.$$('[data-k]', form).forEach((f) => { f.hidden = f.dataset.k !== k; });
      ctx.$('#tr-help').textContent = KIND_HELP[k];
    };
    ctx.$('#tr-kind').addEventListener('change', sync);
    ctx.$('#tr-date').addEventListener('change', (ev) => { if (ev.target.value) ctx.$('#tr-info').innerHTML = info(ev.target.value); });
    sync();
  }
  function approverText(e) {
    const L = st().settings.leave, chain = LR.buildChain({ applicant: e.id, chain: L.chains?.[e.dept], hr: L.hr, hrBackup: L.hrBackup }).filter((s) => s.status === 'pending');
    return chain.length ? chain.map((s) => firstOf(s.approver)).join(', then ') : 'HR';
  }
  function openReview(id) {
    const q = reqs().find((x) => x.id === id); if (!q) return;
    const e = ctx.emp(q.empId), x = dayInfo(e, q.date), as = canActOn(q), next = LR.nextStep(q.chain);
    const stepRow = (s) => {
      const who = s.by && s.by !== s.approver ? `${esc(nameOf(s.by))} for ${esc(nameOf(s.approver))}` : esc(nameOf(s.by || s.approver));
      const ic = { approved: 'check', rejected: 'x', skipped: 'minus', cancelled: 'minus', pending: s === next ? 'clock' : 'minus' }[s.status];
      return `<li class="ch-${s === next ? 'next' : s.status}"><span class="ch-ic">${ctx.icon(ic)}</span><div><strong>${s.level === 'Final' ? 'HR (final)' : s.level}</strong> · ${who}
        <div class="faint">${s.status === 'pending' ? (s === next ? 'Next to decide' : 'Waiting') : s.status === 'skipped' ? esc(s.note) : `${s.status === 'approved' ? 'Approved' : s.status === 'rejected' ? 'Declined' : 'Not needed'}${s.at ? ' ' + fmtDay(s.at, { day: 'numeric', month: 'short' }) : ''}${s.actedAs === 'backup' ? ' as backup' : s.actedAs === 'override' ? ' by HR admin' : ''}${s.note && s.status !== 'pending' ? ` · “${esc(s.note)}”` : ''}`}</div></div></li>`;
    };
    const m = q.kind === 'ot' ? monthFor(e, q.date.slice(0, 7)) : null;
    const actLabel = as === 'override' && next ? `Approve for ${firstOf(next.approver)}` : as === 'backup' ? 'Approve as backup' : 'Approve';
    ctx.openModal({
      title: `${ctx.fullName(e)} · ${KINDS[q.kind]}`, submit: null,
      body: `<dl class="kv kv-wide">
        <dt>Date</dt><dd>${fmtDay(q.date, { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
        <dt>Asked for</dt><dd>${esc(detailOf(q))}</dd>
        <dt>Shift</dt><dd>${x.pattern && !x.off ? `${esc(x.pattern.name)}, ${esc(R.shiftLabel(x.pattern))}` : x.type === 'holiday' ? 'Public holiday' : 'Rest day'}</dd>
        <dt>Clocked</dt><dd>${x.rec?.in ? `${x.rec.in}${x.rec.out ? ` – ${x.rec.out}` : ', no check-out yet'}` : 'No check-in'} ${tagsFor(x)}</dd>
        ${m ? `<dt>This month</dt><dd>${hrs(m.paidMin)} paid overtime${m.cap.rawTotal > otRules().warnMonthH * 60 ? ` <span class="tag bad">Over ${otRules().warnMonthH} h</span>` : ''}</dd>` : ''}
        <dt>Reason</dt><dd>${esc(q.reason)}</dd></dl>
        <h4 class="lv-h">Approval</h4><ol class="chain">${(q.chain || []).map(stepRow).join('') || '<li class="faint">Goes straight to HR.</li>'}</ol>
        ${as ? `<div class="review-box"><div class="field"><label for="tm-note">Note to ${esc(e.first)} (required to decline)</label><input class="input" id="tm-note" placeholder="Optional when approving"></div>
          <div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-danger" data-act="tm-reject" data-id="${q.id}">Decline</button><button class="btn btn-primary" data-act="tm-approve" data-id="${q.id}">${ctx.icon('check')}${esc(actLabel)}</button></div></div>` : ''}`,
    });
  }
  function decide(id, approve) {
    const q = reqs().find((x) => x.id === id); if (!q) return;
    const as = canActOn(q);
    if (!as) { ctx.toast('This request is waiting for someone else.', 'error'); return; }
    const note = ctx.$('#tm-note')?.value.trim() || '';
    if (!approve && ctx.$('#tm-note') && !note) { ctx.toast('Add a short note so they know why.', 'error'); ctx.$('#tm-note').focus(); return; }
    const chain = q.chain?.length ? q.chain : [{ level: 'Final', label: 'HR', approver: actor(), backup: '', status: 'pending' }];
    const r = LR.decide(chain, { by: actor(), approve, note, at: T(), actedAs: as });
    q.chain = r.chain; q.status = r.status;
    if (r.status !== 'Pending') q.decidedAt = T();
    if (r.status === 'Approved' && q.kind === 'correction') setRecord(q.date, q.empId, { s: q.s || 'present', in: q.in, out: q.out }, `Correction approved: ${q.reason}`);
    ctx.closeOverlay();
    const n = ctx.fullName(ctx.emp(q.empId)), nx = LR.nextStep(q.chain);
    ctx.notify?.request(q.kind, q, !approve ? 'rejected' : r.status === 'Approved' ? 'approved' : 'step', { summary: `${fmtDay(q.date)}${q.kind === 'ot' ? `, ${hrs(q.minutes)}` : ''}`, note });
    ctx.commit(!approve ? `Declined for ${n}` : r.status === 'Approved' ? `Approved for ${n}` : `Approved. Now with ${nameOf(nx.approver)}`,
      `${n}'s ${KINDS[q.kind].toLowerCase()} request for ${U.fmtDate(q.date)} was ${!approve ? 'declined' : r.status === 'Approved' ? 'approved' : 'approved at one step'}`);
  }

  // ---------- Manual edits and batch edit ----------
  function openEdit(empId, day) {
    const e = ctx.emp(empId), r = recOf(day, empId);
    ctx.openModal({
      title: `${ctx.fullName(e)} · ${fmtDay(day)}`, size: 'sm', submit: 'Save change',
      body: `<div class="form-grid">
        <div class="field full"><label for="te-s">Status</label><select class="select" id="te-s" name="s">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${r?.s === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="te-in">Check-in</label><input class="input" type="time" id="te-in" name="in" value="${esc(r?.in || '')}"></div>
        <div class="field"><label for="te-out">Check-out</label><input class="input" type="time" id="te-out" name="out" value="${esc(r?.out || '')}"></div>
        <div class="field full"><label for="te-note">Reason for the change</label><input class="input" id="te-note" name="note" required placeholder="For example: forgot to check out"></div></div>
        ${historyHtml(auditFor(day, empId))}`,
      onSubmit(d) {
        if (['present', 'remote'].includes(d.s) && !d.in) { ctx.toast('Add a check-in time for someone who worked', 'error'); return false; }
        const before = recOf(day, empId);
        const changed = R.diff(before && { s: before.s, in: before.in, out: before.out }, ['present', 'remote'].includes(d.s) ? d : { s: d.s, in: '', out: '' }).length;
        if (!changed) { ctx.toast('Nothing changed', 'info'); return; }
        setRecord(day, empId, { s: d.s, in: d.in, out: d.out }, d.note.trim());
        ctx.commit('Attendance updated', `${ctx.fullName(e)}'s attendance on ${U.fmtDate(day)} was edited: ${d.note.trim()}`);
      },
    });
  }
  function openBatch() {
    const mon = R.mondayOf(T());
    ctx.openModal({
      title: 'Batch edit attendance', submit: 'Apply changes',
      body: `<p class="muted" style="margin-bottom:12px">Change many records at once, for example after a system outage or a company event. Every change is kept in the audit trail.</p>
        <div class="form-grid">
        <div class="field"><label for="tb-from">From</label><input class="input" type="date" id="tb-from" name="from" value="${mon}" max="${T()}" required></div>
        <div class="field"><label for="tb-to">To</label><input class="input" type="date" id="tb-to" name="to" value="${T()}" max="${T()}" required></div>
        <div class="field full"><label for="tb-who">Who</label><select class="select" id="tb-who" name="who"><option value="all">Everyone</option>${st().departments.map((d) => `<option value="d:${d.id}">${esc(d.name)}</option>`).join('')}${ctx.activeEmployees().sort((a, b) => a.first.localeCompare(b.first)).map((x) => `<option value="e:${x.id}">${esc(ctx.fullName(x))}</option>`).join('')}</select></div>
        <div class="field full"><label for="tb-s">Set status</label><select class="select" id="tb-s" name="s"><option value="">Keep as it is</option>${Object.entries(STATUS).filter(([k]) => k !== 'leave').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="field"><label for="tb-in">Set check-in</label><input class="input" type="time" id="tb-in" name="in"></div>
        <div class="field"><label for="tb-out">Set check-out</label><input class="input" type="time" id="tb-out" name="out"></div>
        <label class="check full"><input type="checkbox" name="onlyEmpty" id="tb-empty"><span>Only days with no record</span></label>
        <label class="check full"><input type="checkbox" name="allDays" id="tb-all"><span>Include rest days and public holidays</span></label>
        <div class="field full"><label for="tb-note">Reason</label><input class="input" id="tb-note" name="note" required placeholder="For example: check-in system down on 14 Oct"></div>
        <p class="field-hint full" id="tb-count" role="status"></p></div>`,
      onSubmit(d) {
        const plan = batchFrom(d);
        if (!plan.length) { ctx.toast('Nothing to change with these settings', 'info'); return false; }
        const id = U.uid('b-');
        plan.forEach((p) => setRecord(p.day, p.empId, p.after, d.note.trim(), id));
        ctx.commit(`${plan.length} record${plan.length === 1 ? '' : 's'} updated`, `Batch edit of ${plan.length} attendance records, ${U.fmtDate(d.from)} to ${U.fmtDate(d.to)}: ${d.note.trim()}`);
      },
    });
    const form = ctx.$('#overlay-root form');
    const count = () => {
      const d = Object.fromEntries(new FormData(form).entries());
      const n = batchFrom(d).length;
      ctx.$('#tb-count').textContent = d.s || d.in || d.out ? `${n} record${n === 1 ? '' : 's'} will change.` : 'Pick what to set.';
    };
    form.addEventListener('input', count); form.addEventListener('change', count); count();
  }
  function batchFrom(d) {
    if (!d.s && !d.in && !d.out) return [];
    const who = d.who || 'all';
    const ids = ctx.activeEmployees().filter((e) => who === 'all' || (who.startsWith('d:') && e.dept === who.slice(2)) || who === `e:${e.id}`).map((e) => e.id);
    const cal = d.from && d.to && d.from <= d.to ? calFor(d.from, d.to) : null;
    if (!cal) return [];
    return R.batchPlan({
      from: d.from, to: d.to > T() ? T() : d.to, empIds: ids, set: { s: d.s || undefined, in: d.in, out: d.out }, onlyEmpty: !!d.onlyEmpty, allDays: !!d.allDays,
      isWorking: (day) => LR.isWorkingDay(day, cal), get: (day, id) => { const r = recOf(day, id); return r ? { s: r.s, in: r.in || '', out: r.out || '' } : null; },
    }).filter((p) => { const e = ctx.emp(p.empId); return e.start <= p.day && !onLeave(p.empId, p.day); });
  }

  // ---------- Employee: my shifts ----------
  function myShiftsCard(e, { days = 7, title = 'My shifts', link = true } = {}) {
    const from = T(), cal = calFor(from, U.addDays(from, days));
    const list = Array.from({ length: days }, (_, i) => U.addDays(from, i)).map((d) => ({ d, x: dayInfo(e, d, cal) }));
    return `<div class="card"><div class="card-head"><h3>${title}</h3>${link ? '<a class="hint" href="#my-time">My attendance</a>' : `<span class="hint">Next ${days} days</span>`}</div>
      <ul class="shift-list">${list.map(({ d, x }) => `<li class="${d === T() ? 'today' : ''}"><span class="sl-day"><strong>${DOW[R.dow(d)]}</strong> ${+d.slice(8)}</span>
        <span class="sl-what">${x.leave ? '<span class="pill gold">Leave</span>' : x.pattern && !x.off ? `<span class="shift-chip" style="--c:${esc(x.pattern.color || '#0F766E')}">${esc(x.pattern.name)}</span> <span class="num muted">${esc(x.pattern.flexible ? `core ${x.pattern.coreStart}–${x.pattern.coreEnd}` : `${x.pattern.start}–${x.pattern.end}`)}</span>${x.source === 'auto' ? ' <span class="faint">auto</span>' : ''}` : x.type === 'holiday' ? '<span class="faint">Public holiday</span>' : '<span class="faint">Rest day</span>'}</span></li>`).join('')}</ul></div>`;
  }

  // ---------- Settings ----------
  function goto(id) { location.hash = 'settings'; setTimeout(() => ctx.$('#' + id)?.scrollIntoView({ block: 'start' }), 80); }
  const seg = (act, key, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-id="${key}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  const onOff = (key, cur) => seg('tm-ot-set', key, cur ? 'true' : 'false', [['false', 'Off'], ['true', 'On']]);
  function settingsCards() {
    const c = cfg(), o = c.ot, rest = LR.weekendDays(st().settings.leave);
    const num = (key, min, max, step = 1, w = 80, label = key) => `<input class="input num" type="number" data-ot="${key}" min="${min}" max="${max}" step="${step}" value="${o[key]}" style="width:${w}px" aria-label="${esc(label)}">`;
    const patRows = patterns().map((p) => `<tr>
      <td><input class="input" data-tp="${p.id}" data-f="name" value="${esc(p.name)}" aria-label="Pattern name" style="min-width:130px"><div class="lt-small"><input type="color" data-tp="${p.id}" data-f="color" value="${esc(p.color || '#0F766E')}" aria-label="${esc(p.name)} colour"></div></td>
      <td><div class="tp-times"><input class="input" type="time" data-tp="${p.id}" data-f="start" value="${p.start}" aria-label="${esc(p.name)} ${p.flexible ? 'earliest start' : 'start'}"><span>–</span><input class="input" type="time" data-tp="${p.id}" data-f="end" value="${p.end}" aria-label="${esc(p.name)} ${p.flexible ? 'latest end' : 'end'}"></div>
        ${p.flexible ? `<div class="tp-times"><span class="faint">Core</span><input class="input" type="time" data-tp="${p.id}" data-f="coreStart" value="${p.coreStart || '10:00'}" aria-label="${esc(p.name)} core start"><span>–</span><input class="input" type="time" data-tp="${p.id}" data-f="coreEnd" value="${p.coreEnd || '16:00'}" aria-label="${esc(p.name)} core end"></div>
        <label class="tp-hours"><span class="faint">Hours a day</span><input class="input num" type="number" min="1" max="16" step="0.5" data-tp="${p.id}" data-f="hours" value="${p.hours || 8}" style="width:64px"></label>` : ''}</td>
      <td><input class="input num" type="number" min="0" max="180" data-tp="${p.id}" data-f="breakMin" value="${p.breakMin}" style="width:64px" aria-label="${esc(p.name)} break minutes"></td>
      <td><input class="input num" type="number" min="0" max="120" data-tp="${p.id}" data-f="grace" value="${p.grace}" style="width:64px" aria-label="${esc(p.name)} grace minutes"></td>
      <td><div class="tp-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="${rest.includes(d) ? 'rest' : ''}"><input type="checkbox" data-tp="${p.id}" data-f="day" data-d="${d}" ${p.days.includes(d) ? 'checked' : ''}><span>${DOW[d].slice(0, 2)}</span></label>`).join('')}</div></td>
      <td><input type="checkbox" data-tp="${p.id}" data-f="flexible" ${p.flexible ? 'checked' : ''} aria-label="${esc(p.name)} is flexible"></td>
      <td><button class="btn btn-sm btn-icon btn-ghost" data-act="tm-pat-del" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${ctx.icon('trash')}</button></td></tr>`).join('');
    const patOpts = (cur, none = 'None') => `<option value="">${none}</option>${patterns().map((p) => `<option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
    const mode = (k) => ['full', 'partial', 'forfeit'].map((m) => `<option value="${m}" ${k === m ? 'selected' : ''}>${{ full: 'Full', partial: 'Part', forfeit: 'Forfeit' }[m]}</option>`).join('');
    const alRows = c.allowances.map((a) => `<tr class="${a.on ? '' : 'off'}">
      <td><input class="input" data-al="${a.id}" data-f="name" value="${esc(a.name)}" aria-label="Allowance name" style="min-width:110px">
        <select class="select lt-small" data-al="${a.id}" data-f="kind" aria-label="${esc(a.name)} kind">${['attendance', 'meal', 'transport', 'shift', 'custom'].map((k) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
        ${a.kind === 'shift' ? `<select class="select lt-small" data-al="${a.id}" data-f="patterns" aria-label="${esc(a.name)} paid on shift">${patOpts(a.patterns?.[0], 'Any shift')}</select>` : ''}</td>
      ${['weekday', 'rest', 'holiday'].map((k) => `<td><input class="input num" type="number" min="0" step="0.5" data-al="${a.id}" data-f="${k}" value="${a[k]}" style="width:70px" aria-label="${esc(a.name)} ${k === 'weekday' ? 'working day' : k === 'rest' ? 'rest day' : 'public holiday'} rate"></td>`).join('')}
      <td><select class="select" data-al="${a.id}" data-f="late" aria-label="${esc(a.name)} when late">${mode(a.late)}</select></td>
      <td><select class="select" data-al="${a.id}" data-f="absent" aria-label="${esc(a.name)} when absent">${mode(a.absent)}</select></td>
      <td><input class="input num" type="number" min="0" max="100" data-al="${a.id}" data-f="partialPct" value="${a.partialPct}" style="width:60px" aria-label="${esc(a.name)} part percent"></td>
      <td><input type="checkbox" data-al="${a.id}" data-f="remote" ${a.remote ? 'checked' : ''} aria-label="${esc(a.name)} paid on remote days"></td>
      <td class="al-flags">${['epf', 'socso', 'tax'].map((k) => `<label class="check lt-small"><input type="checkbox" data-al="${a.id}" data-f="${k}" ${a[k] ? 'checked' : ''}><span>${k === 'tax' ? 'Tax' : k.toUpperCase()}</span></label>`).join('')}</td>
      <td><input type="checkbox" data-al="${a.id}" data-f="on" ${a.on ? 'checked' : ''} aria-label="Pay ${esc(a.name)}"></td>
      <td><button class="btn btn-sm btn-icon btn-ghost" data-act="tm-al-del" data-id="${a.id}" aria-label="Remove ${esc(a.name)}">${ctx.icon('trash')}</button></td></tr>`).join('');
    const tplOpts = (cur) => `<option value="" ${!cur ? 'selected' : ''}>Usual</option>${patterns().map((p) => `<option value="${p.id}" ${cur === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="off" ${cur === 'off' ? 'selected' : ''}>Off</option>`;
    const tpls = (c.templates || []).map((t) => `<div class="tpl"><div class="tpl-head"><input class="input" data-tt="${t.id}" data-f="name" value="${esc(t.name)}" aria-label="Rotation name"><div class="actions"><button class="btn btn-sm" data-act="tm-tpl-week" data-id="${t.id}" data-v="1">${ctx.icon('plus')}Week</button>${t.weeks.length > 1 ? `<button class="btn btn-sm" data-act="tm-tpl-week" data-id="${t.id}" data-v="-1">${ctx.icon('minus')}Week</button>` : ''}<button class="btn btn-sm btn-icon btn-ghost" data-act="tm-tpl-del" data-id="${t.id}" aria-label="Remove ${esc(t.name)}">${ctx.icon('trash')}</button></div></div>
      <div class="table-wrap"><table class="policy tpl-table"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<th>${DOW[d]}</th>`).join('')}</tr></thead><tbody>${t.weeks.map((w, wi) => `<tr><th scope="row">Week ${wi + 1}</th>${w.map((v, di) => `<td><select class="select" data-tt="${t.id}" data-w="${wi}" data-d="${di}" aria-label="${esc(t.name)} week ${wi + 1} ${DOW[(di + 1) % 7]}">${tplOpts(v)}</select></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('');
    return `
      <div class="card card-flush" id="time-patterns"><div class="card-head" style="padding-bottom:6px"><h3>Working patterns</h3><button class="btn btn-sm" data-act="tm-pat-add">${ctx.icon('plus')}Add a pattern</button></div>
        <p class="muted" style="padding:0 22px 12px">Lateness counts once someone is later than the grace minutes. The break comes off days longer than 5 hours. Flexible patterns set a window, core hours and hours a day.</p>
        <div class="table-wrap"><table class="policy tp-table"><thead><tr><th>Pattern</th><th>Hours</th><th>Break (min)</th><th>Grace (min)</th><th>Working days</th><th>Flexible</th><th></th></tr></thead><tbody>${patRows || '<tr><td colspan="7"><div class="empty">No patterns yet.</div></td></tr>'}</tbody></table></div>
        <div class="settings-row" style="padding:14px 22px"><div><div class="label">Auto-shift</div><div class="desc">For people with no pattern or roster, use the pattern whose start is closest to their check-in.</div></div>${seg('tm-auto', 'auto', c.autoShift ? 'on' : 'off', [['off', 'Off'], ['on', 'On']])}</div>
        <div style="padding:0 22px 18px"><div class="label" style="margin-bottom:8px">Pattern by department</div><div class="tp-depts">${st().departments.map((d) => `<label class="field"><span>${esc(d.name)}</span><select class="select" data-dp="${d.id}">${patOpts(c.deptPattern?.[d.id])}</select></label>`).join('')}</div>
          <p class="faint" style="font-size:12.5px;margin-top:8px">A person’s own pattern (on their profile) wins over the department’s, and the Schedule wins over both.</p></div></div>

      <div class="card" id="time-ot"><div class="card-head"><h3>Overtime rules</h3><span class="hint">Employment Act defaults</span></div>
        <div class="settings-row"><div><div class="label">Rates</div><div class="desc">Times the hourly rate. Rest days and public holidays pay up to normal hours at the first rate and the rest at the second.</div></div>
          <div class="ot-rates">
            <label><span>Normal day</span>${num('normal', 1, 5, 0.5, 70, 'Normal day overtime rate')}</label>
            <label><span>Rest day</span><span class="ot-pair">${num('restIn', 0, 5, 0.5, 62, 'Rest day rate up to normal hours')}${num('rest', 1, 5, 0.5, 62, 'Rest day overtime rate')}</span></label>
            <label><span>Public holiday</span><span class="ot-pair">${num('holidayIn', 0, 5, 0.5, 62, 'Public holiday rate up to normal hours')}${num('holiday', 1, 5, 0.5, 62, 'Public holiday overtime rate')}</span></label>
            <label><span>After midnight</span>${num('night', 0, 5, 0.5, 70, 'After midnight rate, 0 for the same as the day')}</label></div></div>
        <div class="settings-row"><div><div class="label">Hourly rate</div><div class="desc">Monthly basic ÷ ${o.divisor} ÷ ${o.normalHours} normal hours. Example: RM2,600 basic is ${ctx.money(R.hourlyRate(2600, o), 2)} an hour.</div></div><div class="actions">${num('divisor', 1, 31, 1, 70, 'Days divisor')}${num('normalHours', 1, 12, 0.5, 70, 'Normal hours a day')}</div></div>
        <div class="settings-row"><div><div class="label">Flat rate instead</div><div class="desc">Pay the same ringgit an hour for all overtime.</div></div><div class="actions">${onOff('flat', o.flat)}${o.flat ? num('flatRate', 0, 500, 0.5, 80, 'Flat rate per hour') : ''}</div></div>
        <div class="settings-row"><div><div class="label">Needs approval first</div><div class="desc">Only overtime approved through a request is paid. Unapproved time shows on Attendance.</div></div>${onOff('preApproval', o.preApproval)}</div>
        <div class="settings-row"><div><div class="label">Early overtime</div><div class="desc">Count time before the shift starts.</div></div>${onOff('early', o.early)}</div>
        <div class="settings-row"><div><div class="label">Offset against lateness</div><div class="desc">Late minutes come off the same day’s overtime.</div></div>${onOff('offset', o.offset)}</div>
        <div class="settings-row"><div><div class="label">Rounding</div><div class="desc">Each day’s overtime, in blocks.</div></div><div class="actions">${seg('tm-ot-set', 'round', o.round, [[0, 'None'], [15, '15 min'], [30, '30 min']])}${o.round ? seg('tm-ot-set', 'roundMode', o.roundMode, [['down', 'Down'], ['nearest', 'Nearest']]) : ''}</div></div>
        <div class="settings-row"><div><div class="label">Per day</div><div class="desc">Minimum minutes before it counts, and the most paid in a day.</div></div><div class="actions"><label class="ot-lbl">Min ${num('minMin', 0, 240, 5, 70, 'Minimum minutes a day')}</label><label class="ot-lbl">Max ${num('maxDayMin', 0, 720, 15, 76, 'Maximum minutes a day, 0 for no limit')}</label></div></div>
        <div class="settings-row"><div><div class="label">Per month</div><div class="desc">Hours. Warns above the warning line (the Employment Act limit is 104 hours). 0 = no limit.</div></div><div class="actions"><label class="ot-lbl">Min ${num('minMonthH', 0, 200, 1, 64, 'Minimum hours a month')}</label><label class="ot-lbl">Max ${num('maxMonthH', 0, 300, 1, 64, 'Maximum hours a month')}</label><label class="ot-lbl">Warn ${num('warnMonthH', 1, 300, 1, 64, 'Warn above hours a month')}</label></div></div>
        <div class="settings-row"><div><div class="label">Dinner break</div><div class="desc">${o.dinner ? `Take ${o.dinnerMin} minutes off overtime of ${o.dinnerAfter} minutes or more after the shift.` : 'Take a dinner break off long overtime after the shift.'}</div></div><div class="actions">${onOff('dinner', o.dinner)}${o.dinner ? `<label class="ot-lbl">After ${num('dinnerAfter', 0, 600, 15, 70, 'Dinner break after minutes')}</label><label class="ot-lbl">Minutes ${num('dinnerMin', 0, 120, 5, 64, 'Dinner break minutes')}</label>` : ''}</div></div>
        <div class="settings-row"><div><div class="label">Who gets overtime</div><div class="desc">Only staff with monthly basic up to this amount. 0 = everyone.</div></div>${num('eligibleMax', 0, 100000, 100, 100, 'Overtime wage limit')}</div>
        <div class="settings-row"><div><div class="label">In payroll</div><div class="desc">Which statutory wages overtime counts towards.</div></div><div class="actions">${['epf', 'socso', 'tax'].map((k) => `<label class="check"><input type="checkbox" data-ot="${k}" ${o[k] ? 'checked' : ''}><span>${k === 'tax' ? 'Taxable (PCB)' : k === 'epf' ? 'EPF' : 'SOCSO and EIS'}</span></label>`).join('')}</div></div>
        <p class="disclaimer">${ctx.icon('pin')}<span>Defaults follow the Employment Act 1955: 1.5× on normal days, 2× beyond normal hours on rest days, 3× beyond normal hours on public holidays, hourly rate from basic ÷ 26, and the 104-hour monthly limit. Overtime is not usually EPF wages. Check these against the Act, KWSP, PERKESO and LHDN guidance and your contracts before paying.</span></p></div>

      <div class="card card-flush" id="time-allowances"><div class="card-head" style="padding-bottom:6px"><h3>Daily allowances</h3><button class="btn btn-sm" data-act="tm-al-add">${ctx.icon('plus')}Add an allowance</button></div>
        <p class="muted" style="padding:0 22px 12px">Ringgit a day by day type. When someone is late or absent the allowance is paid in full, in part (the % column) or forfeited. Leave days get nothing.</p>
        <div class="table-wrap"><table class="policy al-table"><thead><tr><th>Allowance</th><th>Working day</th><th>Rest day</th><th>Holiday</th><th>If late</th><th>If absent</th><th>Part %</th><th>Remote</th><th>Counts for</th><th>On</th><th></th></tr></thead><tbody>${alRows}</tbody></table></div>
        <p class="disclaimer" style="padding:0 22px 18px">${ctx.icon('pin')}<span>Check which allowances are EPF wages, SOCSO wages and taxable (some travel allowances are tax-exempt up to a yearly limit) with KWSP, PERKESO and LHDN.</span></p></div>

      <div class="card" id="time-rosters"><div class="card-head"><h3>Rotating rosters</h3><button class="btn btn-sm" data-act="tm-tpl-add">${ctx.icon('plus')}Add a rotation</button></div>
        <p class="muted" style="margin-bottom:12px">A rotation repeats week by week. Apply it to a team from the Schedule page; staggering starts each person one week further on, so shifts are shared out.</p>
        ${tpls || '<div class="empty">No rotations yet.</div>'}</div>`;
  }
  function bindSettings() {
    const $$ = ctx.$$;
    const save = (msg = 'Saved') => ctx.commit(msg);
    $$('[data-tp]').forEach((el) => el.addEventListener('change', () => {
      const p = pat(el.dataset.tp); if (!p) return;
      const f = el.dataset.f;
      if (f === 'day') { const d = +el.dataset.d; p.days = el.checked ? [...new Set([...p.days, d])].sort() : p.days.filter((x) => x !== d); }
      else if (f === 'flexible') { p.flexible = el.checked; if (p.flexible) { p.coreStart = p.coreStart || '10:00'; p.coreEnd = p.coreEnd || '16:00'; p.hours = p.hours || 8; } }
      else if (['breakMin', 'grace', 'hours'].includes(f)) p[f] = Math.max(0, Number(el.value) || 0);
      else if (f === 'name') p.name = el.value.trim() || p.name;
      else if (el.value) p[f] = el.value;
      save('Pattern saved');
    }));
    $$('[data-dp]').forEach((el) => el.addEventListener('change', () => { cfg().deptPattern = { ...(cfg().deptPattern || {}), [el.dataset.dp]: el.value }; save('Department pattern saved'); }));
    $$('[data-ot]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.ot;
      otRules()[k] = el.type === 'checkbox' ? el.checked : Math.max(0, Number(el.value) || 0);
      if (k === 'divisor' && !otRules().divisor) otRules().divisor = 26;
      if (k === 'normalHours' && !otRules().normalHours) otRules().normalHours = 8;
      save('Overtime rules saved');
    }));
    $$('[data-al]').forEach((el) => el.addEventListener('change', () => {
      const a = cfg().allowances.find((x) => x.id === el.dataset.al); if (!a) return;
      const f = el.dataset.f;
      if (el.type === 'checkbox') a[f] = el.checked;
      else if (['weekday', 'rest', 'holiday', 'partialPct'].includes(f)) a[f] = Math.max(0, Number(el.value) || 0);
      else if (f === 'patterns') a.patterns = el.value ? [el.value] : [];
      else if (f === 'name') a.name = el.value.trim() || a.name;
      else a[f] = el.value;
      save('Allowance saved');
    }));
    $$('[data-tt]').forEach((el) => el.addEventListener('change', () => {
      const t = cfg().templates.find((x) => x.id === el.dataset.tt); if (!t) return;
      if (el.dataset.f === 'name') t.name = el.value.trim() || t.name;
      else t.weeks[+el.dataset.w][+el.dataset.d] = el.value;
      save('Rotation saved');
    }));
  }

  // ---------- Insights ----------
  function insights() {
    const out = [], r = ctx.role(), add = (tone, icon, title, detail, action, prio) => out.push({ tone, icon, title, detail, action, prio });
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (r === 'admin') {
      const pend = reqs().filter((q) => q.status === 'Pending');
      if (pend.length) add('warn', 'clock', `${plural(pend.length, 'attendance request', 'attendance requests')} waiting`, pend.slice(0, 3).map((q) => `${firstOf(q.empId)} (${KINDS[q.kind].toLowerCase()})`).join(', '), { label: 'Review', act: 'tm-open-requests' }, 3);
      const team = ctx.activeEmployees();
      const t = dayTotals(T(), team);
      if (t.late) add('info', 'clock', `${plural(t.late, 'person was', 'people were')} late today`, 'Lateness counts after each pattern’s grace minutes.', { label: 'Attendance', href: '#attendance' }, 2);
      const wk = weekModel(R.mondayOf(T()), team, 'all');
      const lowDepts = st().departments.filter((d) => Number(cfg().minStaff?.[d.id]) > 0).filter((d) => weekModel(R.mondayOf(T()), team.filter((e) => e.dept === d.id), d.id).below.some((x) => x >= T()));
      if (wk.below.some((x) => x >= T()) || lowDepts.length) add('warn', 'people', 'Short-staffed shifts this week', lowDepts.length ? `${lowDepts.map((d) => d.name).join(', ')} ${lowDepts.length === 1 ? 'is' : 'are'} below the minimum on some days.` : 'Some days are below the minimum on shift.', { label: 'Schedule', href: '#schedule' }, 2);
      const mk = U.monthKey(T());
      const heavy = team.filter((e) => monthFor(e, mk).cap.rawTotal > otRules().warnMonthH * 60);
      if (heavy.length) add('warn', 'clock', `${plural(heavy.length, 'person is', 'people are')} over ${otRules().warnMonthH} hours of overtime`, `${heavy.map((e) => e.first).join(', ')}. The Employment Act limit is 104 hours a month.`, { label: 'Attendance', href: '#attendance' }, 2);
    }
    if (r === 'employee') {
      const me = ctx.me();
      const mine = forMe(me.id);
      if (mine.length) add('warn', 'check', `${plural(mine.length, 'attendance request needs', 'attendance requests need')} your approval`, mine.slice(0, 3).map((q) => `${firstOf(q.empId)} (${KINDS[q.kind].toLowerCase()})`).join(', '), { label: 'Review', href: '#my-approvals' }, 3);
      const x = dayInfo(me, T());
      if (x.pattern && !x.off && !x.leave && !x.rec?.in && !x.pattern.flexible) add('info', 'clock', `Your shift starts at ${x.pattern.start}`, `${x.pattern.name}, ${R.shiftLabel(x.pattern)}. Grace ${x.pattern.grace} minutes.`, { label: 'My shifts', href: '#my-time' }, 1);
      const yd = [1, 2, 3].map((n) => U.addDays(T(), -n)).map((d) => dayInfo(me, d)).find((y) => y.ev.unapproved > 0 && !reqs().some((q) => q.empId === me.id && q.date === y.day && q.kind === 'ot'));
      if (yd) add('info', 'clock', `${hrs(yd.ev.unapproved)} of overtime isn’t approved yet`, `From ${fmtDay(yd.day)}. Ask your manager so it’s paid.`, { label: 'Request', act: 'tm-request' }, 2);
    }
    return out;
  }

  // ---------- Install ----------
  function install(c) {
    ctx = c;
    ctx.VIEWS.schedule = scheduleView;
    ctx.AFTER.schedule = bindSchedule;
    // Approvers see their team's attendance requests under the leave approvals.
    const leaveApprovals = ctx.VIEWS['my-approvals'];
    if (leaveApprovals) ctx.VIEWS['my-approvals'] = () => leaveApprovals() + approvalsCard(ctx.me().id);
    Object.assign(ctx.ACTIONS, {
      'ro-week': (_, v) => { ui.week = R.addDays(ui.week, 7 * Number(v)); ctx.render(); },
      'ro-this': () => { ui.week = R.mondayOf(T()); ctx.render(); },
      'ro-cell': (id, day) => openCell(id, day),
      'ro-copy': () => {
        const ids = people().map((e) => e.id), last = R.addDays(ui.week, -7);
        const plan = R.copyWeek(st().rosters, last, ui.week, ids);
        if (!Object.values(plan).some((x) => Object.keys(x).length)) { ctx.toast('Last week has no roster to copy', 'info'); return; }
        mergeRoster(plan, ids, R.weekDays(ui.week));
        rosterNotify(Object.values(plan).flatMap((x) => Object.keys(x)), ui.week);
        ctx.commit('Copied last week', `Roster for the week of ${U.fmtDate(ui.week)} copied from the week before`);
      },
      'ro-clear': () => { mergeRoster({}, people().map((e) => e.id), R.weekDays(ui.week)); ctx.commit('Week cleared. Everyone is back on their usual pattern.'); },
      'ro-template': () => openTemplate(),
      'tm-goto': (_, id) => goto(id),
      'tm-request': (_, v) => openRequest(v || 'ot'),
      'tm-request-day': (day, v) => openRequest(v || 'ot', day),
      'tm-review': (id) => openReview(id),
      'tm-approve': (id) => decide(id, true),
      'tm-reject': (id) => decide(id, false),
      'tm-cancel': (id) => { const q = reqs().find((x) => x.id === id); if (!q || q.status !== 'Pending') return; q.status = 'Cancelled'; ctx.commit('Request cancelled'); },
      'tm-open-requests': () => { location.hash = 'attendance'; setTimeout(() => ctx.$('#time-requests')?.scrollIntoView({ block: 'start' }), 80); },
      'tm-edit': (id, day) => openEdit(id, day),
      'tm-batch': () => openBatch(),
      'tm-auto': (_, v) => { cfg().autoShift = v === 'on'; ctx.commit(v === 'on' ? 'Auto-shift on' : 'Auto-shift off'); },
      'tm-ot-set': (k, v) => { otRules()[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v; ctx.commit('Overtime rules saved'); },
      'tm-pat-add': () => {
        const n = patterns().length + 1;
        patterns().push({ id: U.uid('p-'), name: `Shift ${n}`, start: '08:00', end: '17:00', breakMin: 60, grace: 10, days: R.workDays(LR.weekendDays(st().settings.leave)), flexible: false, color: ['#4A6FD1', '#B8914A', '#C2577A', '#7A62C9', '#5E8C3A'][n % 5] });
        ctx.commit('Pattern added');
      },
      'tm-pat-del': (id) => {
        const p = pat(id); if (!p) return;
        cfg().patterns = patterns().filter((x) => x.id !== id);
        Object.keys(cfg().deptPattern || {}).forEach((d) => { if (cfg().deptPattern[d] === id) cfg().deptPattern[d] = ''; });
        st().employees.forEach((e) => { if (e.timePattern === id) e.timePattern = ''; });
        ctx.commit(`${p.name} removed`);
      },
      'tm-al-add': () => { cfg().allowances.push({ id: U.uid('al-'), name: 'New allowance', kind: 'custom', weekday: 0, rest: 0, holiday: 0, late: 'full', absent: 'forfeit', partialPct: 50, remote: true, patterns: [], epf: true, socso: true, tax: true, on: false }); ctx.commit('Allowance added'); },
      'tm-al-del': (id) => { cfg().allowances = cfg().allowances.filter((a) => a.id !== id); ctx.commit('Allowance removed'); },
      'tm-tpl-add': () => { cfg().templates.push({ id: U.uid('t-'), name: 'New rotation', weeks: [Array(7).fill('')] }); ctx.commit('Rotation added'); },
      'tm-tpl-del': (id) => { cfg().templates = cfg().templates.filter((t) => t.id !== id); ctx.commit('Rotation removed'); },
      'tm-tpl-week': (id, v) => { const t = cfg().templates.find((x) => x.id === id); if (!t) return; if (+v > 0) t.weeks.push(Array(7).fill('')); else if (t.weeks.length > 1) t.weeks.pop(); ctx.commit('Rotation saved'); },
    });
    return {
      dayInfo, monthFor, forPayroll, attCells, dayTotals, tagsFor, shiftCell, todayShift, setRecord, auditFor, historyHtml,
      requestsCard, myRequestsCard, myShiftsCard, approvalsCard, settingsCards, bindSettings, insights,
      pendingCount: () => reqs().filter((q) => q.status === 'Pending').length, myCount: (empId) => forMe(empId).length,
      shiftStart: (e, day) => { const x = dayInfo(e, day); return x.pattern && !x.off ? (x.pattern.flexible ? x.pattern.coreStart : x.pattern.start) : ''; },
    };
  }

  return { install };
})();
