// Daily production commission (docs/PRODUCTION-COMMISSION-SPEC.md): Settings card, the "Production" page where an admin
// keys in the day's total units (with a live preview of who shares the pool), the payroll line, and each person's own
// view. Only for companies that have the addon (tenants/{t}.addons.prodCommission, set by the superadmin); everyone
// else sees nothing of it. The maths and who counts are in js/prod-rules.js; the documents are in firestore.rules.
window.AllurusProduction = (function () {
  'use strict';
  const P = window.AllurusProd;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const rm = P.rm;
  const NAME = 'Production commission / Komisen pengeluaran';
  const ui = { day: '', units: null, note: '', month: '' };

  // ---------- Is it on, who may use it ----------
  // The cloud: the company's addon. The demo: a company that has production settings (Major Far East's demo).
  const on = () => (ctx.cloud() ? !!window.AllurusCompany?.addons?.prodCommission : !!st().settings?.prod);
  const canEntry = () => on() && ctx.role() === 'admin' && (ctx.can('operations') || ctx.can('payroll'));
  const canSettings = () => on() && ctx.role() === 'admin' && ctx.can('payroll');
  const cfg = () => (st().settings.prod = st().settings.prod || { rate: '', unit: 'pcs', depts: [] });
  const store = () => { const s = st(); if (!s.prod || !s.prod.days) s.prod = { days: {}, locks: {} }; s.prod.locks = s.prod.locks || {}; return s.prod; };
  const days = () => store().days;
  const emps = () => ctx.activeEmployees();
  const allEmps = () => st().employees || [];
  const configured = () => P.rateUnits(cfg().rate) != null && (cfg().depts || []).length > 0;
  const approvedLeaves = () => (st().leaves || []).filter((l) => l.status === 'Approved');
  const isLocked = (date) => { const mk = P.MONTH(date); return !!store().locks[mk] || st().payroll?.[mk]?.status === 'Paid'; };
  const fmtD = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => U.fmtDate(d, o);
  const unitName = () => cfg().unit || 'units';

  // ---------- The day: plan, save, recalculate ----------
  function plan(date, units, rate) {
    return P.planDay({ date, units, rate, employees: allEmps(), att: st().attendance?.[date] || {}, leaves: approvedLeaves(), settings: cfg() });
  }
  const shareDocs = (date, p, unit) => [
    ...p.attendees.map((a) => ({ date, empId: a.id, status: 'paid', shareSen: p.shareSen, units: p.units, unit, poolSen: p.poolSen, count: p.count, reason: '' })),
    ...p.excluded.map((x) => ({ date, empId: x.id, status: 'missed', shareSen: 0, units: p.units, unit, poolSen: p.poolSen, count: p.count, reason: x.reason })),
  ];
  // Everyone listed on the old save who is no longer listed gets a "removed" record, so no stale share stays visible.
  function staleShares(date, old, p, unit) {
    const now = new Set([...p.attendees.map((a) => a.id), ...p.excluded.map((x) => x.id)]);
    return [...(old?.attendees || []), ...((old?.excluded || []).map((x) => x.id))].filter((id) => !now.has(id))
      .map((id) => ({ date, empId: id, status: 'missed', shareSen: 0, units: p.units, unit, poolSen: p.poolSen, count: p.count, reason: 'Removed from this day' }));
  }
  async function saveDay(date, units, note, rateOverride) {
    if (!canEntry()) return;
    if (isLocked(date)) { ctx.toast('That month is finalised in payroll, so its days are locked. A correction goes in the next open month.', 'error'); return; }
    if (date > T()) { ctx.toast('You can’t enter production for a day that hasn’t happened.', 'error'); return; }
    if (!configured()) { ctx.toast('Set the rate and the departments in Settings → Payroll first.', 'error'); return; }
    const old = days()[date], rate = rateOverride || old?.rate || cfg().rate;
    const u = P.unitsCenti(units);
    if (u == null) { ctx.toast('Type the total as a number (whole units, or up to 2 decimals).', 'error'); return; }
    const p = { ...plan(date, units, rate), units: String(units).replace(/,/g, '') };
    const by = ctx.me()?.id || '';
    const doc = { date, units: p.units, unit: unitName(), rate, poolSen: p.poolSen, shareSen: p.shareSen, remainderSen: p.remainderSen, count: p.count,
      attendees: p.attendees.map((a) => a.id), excluded: p.excluded, flags: p.flags, sig: p.sig, note: String(note || '').slice(0, 200), savedBy: by, savedAt: new Date().toISOString(), v: (old?.v || 0) + 1 };
    if (old) doc.prev = { units: old.units, poolSen: old.poolSen, shareSen: old.shareSen, savedBy: old.savedBy, savedAt: old.savedAt };
    const shares = [...shareDocs(date, p, unitName()), ...staleShares(date, old, p, unitName())];
    const before = old ? { ...old } : null;
    days()[date] = doc;
    if (ctx.cloud() && ctx.fire()?.prodSave) {
      const r = await ctx.fire().prodSave(doc, shares);
      if (!r.ok) { if (before) days()[date] = before; else delete days()[date]; ctx.toast(r.error, 'error'); ctx.render(); return; }
    }
    ctx.log(old ? `Production for ${fmtD(date)} changed: ${old.units} → ${doc.units} ${doc.unit} (${rm(old.poolSen)} → ${rm(doc.poolSen)}, ${old.count} → ${doc.count} people)` : `Production for ${fmtD(date)}: ${doc.units} ${doc.unit}, ${rm(doc.poolSen)} shared by ${doc.count} (${rm(doc.shareSen)} each)`);
    if (!ctx.cloud()) store();
    ctx.commit(old ? 'Production day updated' : 'Production day saved');
  }
  const changedSince = (d) => { const x = days()[d]; return !!x && x.sig !== plan(d, x.units, x.rate).sig; };

  // ---------- The Production page ----------
  const unlockedFrom = () => { const mk = U.monthKey(T()); let m = mk, k = 0; while (k++ < 36 && isLocked(m + '-01')) m = U.addMonths(m, 1); return m + '-01'; };
  const monthOfDay = () => P.MONTH(ui.day || T());
  function previewHTML(date, units) {
    if (!configured()) return `<div class="empty"><strong>Set it up first</strong>Add the rate per unit and the departments in Settings → Payroll.</div>`;
    const ok = P.unitsCenti(units) != null;
    const saved = days()[date], rate = saved?.rate || cfg().rate;
    const p = plan(date, ok ? units : 0, rate), name = (id) => ctx.fullName(ctx.emp(id));
    const line = (a) => { const e = ctx.emp(a.id); return `<tr><td>${esc(name(a.id))}</td><td class="muted">${esc(ctx.dept(e?.dept)?.name || '—')}</td><td class="num">${esc(a.firstIn || '—')}</td></tr>`; };
    const no = (x) => { const e = ctx.emp(x.id); return `<tr><td>${esc(name(x.id))}</td><td class="muted">${esc(ctx.dept(e?.dept)?.name || '—')}</td><td>${esc(x.reason)}</td></tr>`; };
    return `<div class="grid g-4 keep-2" style="margin-bottom:12px">
        <div class="card kpi"><div class="kpi-label">Pool</div><div class="kpi-value" id="pv-pool">${ok ? rm(p.poolSen) : '—'}</div><div class="kpi-foot">${ok ? `${esc(P.fmtUnits(units, unitName()))} × RM${esc(String(rate))}` : 'Type the total units'}</div></div>
        <div class="card kpi"><div class="kpi-label">Share the pool</div><div class="kpi-value">${p.count}</div><div class="kpi-foot">checked in that day</div></div>
        <div class="card kpi"><div class="kpi-label">Each person</div><div class="kpi-value">${ok && p.count ? rm(p.shareSen) : '—'}</div><div class="kpi-foot">${ok && p.count ? (p.remainderSen ? `${rm(p.remainderSen)} not shared out` : 'nothing left over') : p.count ? '' : 'Nobody checked in: the pool is not paid'}</div></div>
        <div class="card kpi"><div class="kpi-label">Not sharing</div><div class="kpi-value">${p.excluded.length}</div><div class="kpi-foot">${p.excluded.length ? 'see the reasons below' : 'everyone in is included'}</div></div></div>
      ${p.flags.length ? `<p class="lock-banner" role="note" style="margin-bottom:12px">${p.flags.map((f) => `${esc(name(f.id))}: ${esc(f.flag)}. Leave wins, so they don’t share.`).join('<br>')}</p>` : ''}
      <div class="grid g-2" style="gap:12px"><div class="card card-flush"><div class="card-head"><h3>Gets a share (${p.count})</h3></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>First check-in</th></tr></thead><tbody>${p.attendees.map(line).join('') || '<tr><td colspan="3" class="muted">Nobody checked in yet.</td></tr>'}</tbody></table></div></div>
      <div class="card card-flush"><div class="card-head"><h3>Doesn’t (${p.excluded.length})</h3></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Department</th><th>Why</th></tr></thead><tbody>${p.excluded.map(no).join('') || '<tr><td colspan="3" class="muted">Nobody is left out.</td></tr>'}</tbody></table></div></div></div>`;
  }
  function monthList(month) {
    const first = month + '-01', last = U.monthEnd(month), dates = [];
    for (let d = first; d <= last && d <= T(); d = U.addDays(d, 1)) dates.push(d);
    const atts = st().attendance || {};
    const row = (d) => {
      const x = days()[d], lock = isLocked(d);
      const anyIn = Object.values(atts[d] || {}).some((r) => r && (r.s === 'present' || r.s === 'remote') && r.in);
      if (!x && !anyIn) return '';
      const status = x ? (changedSince(d) ? '<span class="pill warn">Attendance changed: recalculate</span>' : lock ? '<span class="pill">Locked</span>' : '<span class="pill ok">Saved</span>') : '<span class="pill bad">No production entered</span>';
      return `<tr><td>${esc(fmtD(d))}</td><td class="num">${x ? esc(P.fmtUnits(x.units, x.unit)) : '—'}</td><td class="num">${x ? rm(x.poolSen) : '—'}</td><td class="num">${x ? x.count : '—'}</td><td class="num">${x ? rm(x.shareSen) : '—'}</td><td>${status}</td>
        <td class="r"><button class="btn btn-sm" data-act="prod-day" data-v="${d}">${x ? 'Open' : 'Enter'}</button>${x && changedSince(d) && !lock ? `<button class="btn btn-sm btn-primary" data-act="prod-recalc" data-v="${d}">Recalculate</button>` : ''}</td></tr>`;
    };
    const rows = dates.reverse().map(row).join('');
    const tot = P.monthTotals(days(), month), sum = Object.values(tot).reduce((s, v) => s + v.sen, 0);
    return `<div class="card card-flush" style="margin-top:12px"><div class="card-head"><h3>${esc(U.fmtMonth(month))}</h3><div class="actions">
        <button class="btn btn-icon" data-act="prod-month" data-v="-1" aria-label="Previous month">${icon('left')}</button><button class="btn btn-icon" data-act="prod-month" data-v="1" aria-label="Next month" ${month >= U.monthKey(T()) ? 'disabled' : ''}>${icon('right')}</button>
        ${ctx.can('payroll') ? `<button class="btn btn-sm" data-act="prod-csv" data-v="${month}">${icon('download')}Export CSV</button>` : ''}</div></div>
      <p class="muted" style="padding:0 22px 10px">${Object.keys(tot).length} people · ${rm(sum)} paid out this month${store().locks[month] || st().payroll?.[month]?.status === 'Paid' ? ' · locked: payroll is finalised' : ''}</p>
      <div class="table-wrap"><table><thead><tr><th>Day</th><th>Total</th><th>Pool</th><th>People</th><th>Each</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No check-ins or production this month.</td></tr>'}</tbody></table></div></div>${monthByPerson(tot)}`;
  }
  // The month by person and by department (payroll area: it is what each person is paid).
  function monthByPerson(tot) {
    if (!ctx.can('payroll') || !Object.keys(tot).length) return '';
    const people = Object.entries(tot).map(([id, v]) => ({ id, e: ctx.emp(id), ...v })).sort((x, y) => y.sen - x.sen);
    const byDept = {}; people.forEach((p) => { const n = ctx.dept(p.e?.dept)?.name || 'No department'; const d = (byDept[n] = byDept[n] || { sen: 0, people: 0 }); d.sen += p.sen; d.people += 1; });
    return `<div class="grid g-2" style="gap:12px;margin-top:12px"><div class="card card-flush"><div class="card-head"><h3>By person</h3></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Days</th><th>Total</th></tr></thead><tbody>${people.map((p) => `<tr><td>${esc(ctx.fullName(p.e) || p.id)}</td><td class="num">${p.days}</td><td class="num">${rm(p.sen)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card card-flush"><div class="card-head"><h3>By department</h3></div><div class="table-wrap"><table><thead><tr><th>Department</th><th>People</th><th>Total</th></tr></thead><tbody>${Object.entries(byDept).map(([n, d]) => `<tr><td>${esc(n)}</td><td class="num">${d.people}</td><td class="num">${rm(d.sen)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }
  function view() {
    if (!canEntry()) return '<div class="empty"><strong>Not available</strong>Production commission isn’t switched on for your account.</div>';
    const day = ui.day || (ui.day = T()), saved = days()[day], locked = isLocked(day);
    const units = ui.units != null ? ui.units : saved?.units ?? '';
    const note = ui.note !== '' ? ui.note : saved?.note || '';
    const min = unlockedFrom();
    return `<div class="page-head"><div><h1>Production</h1><p class="sub">Type the day’s total. The pool is shared equally by everyone who checked in, in the commission departments.</p></div>
        <div class="actions"><button class="btn btn-icon" data-act="prod-shift" data-v="-1" aria-label="Previous day" ${day <= min ? 'disabled' : ''}>${icon('left')}</button>
          <input class="input" type="date" id="pd-date" value="${day}" min="${min}" max="${T()}" aria-label="Day">
          <button class="btn btn-icon" data-act="prod-shift" data-v="1" aria-label="Next day" ${day >= T() ? 'disabled' : ''}>${icon('right')}</button><button class="btn" data-act="prod-shift" data-v="0">Today</button></div></div>
      ${locked ? '<p class="lock-banner" role="note" style="margin-bottom:12px">This month is finalised in payroll, so this day is locked. A correction goes in the next open month.</p>' : ''}
      ${saved && changedSince(day) && !locked ? `<p class="lock-banner" role="note" style="margin-bottom:12px">Attendance changed since this was saved (for example a check-in correction). <button class="btn btn-sm btn-primary" data-act="prod-recalc" data-v="${day}">Recalculate</button></p>` : ''}
      <div class="card" style="margin-bottom:12px"><form id="pd-form" novalidate class="form-grid">
        <div class="field"><label for="pd-units">Total production (${esc(unitName())})</label><input class="input" id="pd-units" name="units" inputmode="decimal" autocomplete="off" value="${esc(String(units))}" ${locked ? 'disabled' : ''} placeholder="e.g. 2000"></div>
        <div class="field"><label for="pd-note">Note (optional)</label><input class="input" id="pd-note" name="note" maxlength="200" value="${esc(note)}" ${locked ? 'disabled' : ''}></div>
        <div class="field" style="align-self:end"><button class="btn btn-primary" type="submit" ${locked || !configured() ? 'disabled' : ''}>${saved ? 'Save changes' : 'Save the day'}</button></div></form>
        ${saved ? `<p class="faint" style="font-size:12.5px;margin-top:8px">Saved by ${esc(ctx.fullName(ctx.emp(saved.savedBy)) || 'someone')} on ${esc(U.fmtDate(String(saved.savedAt).slice(0, 10), { day: 'numeric', month: 'short' }))} at RM${esc(String(saved.rate))} per ${esc(unitName())}. A saved day keeps the rate it was saved with.</p>` : ''}</div>
      <div id="pd-preview">${previewHTML(day, units)}</div>
      ${monthList(monthOfDay())}`;
  }
  function after() {
    const form = ctx.$('#pd-form'); if (!form) return;
    const live = () => { ui.units = form.units.value; ui.note = form.note.value; const el = ctx.$('#pd-preview'); if (el) el.innerHTML = previewHTML(ui.day, ui.units); };
    form.units?.addEventListener('input', live); form.note?.addEventListener('input', () => { ui.note = form.note.value; });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); saveDay(ui.day, form.units.value, form.note.value).then(() => { ui.units = null; ui.note = ''; }); });
    ctx.$('#pd-date')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.day = ev.target.value; ui.units = null; ui.note = ''; ctx.render(); } });
  }

  // ---------- Settings → Payroll ----------
  function settingsCard() {
    if (!canSettings()) return '';
    const c = cfg(), depts = st().departments || [];
    const noDept = allEmps().filter((e) => e.status === 'Active' && !e.dept);
    const sample = P.rateUnits(c.rate) != null ? P.commissionDay({ units: 2000, rate: c.rate, attendees: 25 }) : null;
    return `<div class="card" id="prod-settings"><div class="card-head"><h3>Production commission</h3><span class="hint">Komisen pengeluaran</span></div>
      <p class="muted" style="margin-bottom:10px">Each day an admin keys in the total production. The pool (units × rate) is shared equally by the staff who checked in that day, and each person’s days are added to their pay at month end.</p>
      <div class="form-grid"><div class="field"><label for="pc-rate">Rate per unit (RM)</label><input class="input" id="pc-rate" inputmode="decimal" value="${esc(String(c.rate ?? ''))}" placeholder="0.05"><span class="field-hint">Up to 4 decimals, for example 0.05 or 0.0025.</span></div>
        <div class="field"><label for="pc-unit">Unit name</label><input class="input" id="pc-unit" maxlength="20" value="${esc(c.unit || '')}" placeholder="pcs, kg, cartons"></div></div>
      <div class="field" style="margin-top:8px"><label>Departments that take part</label><div style="display:flex;gap:14px;flex-wrap:wrap">${depts.map((d) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-pc-dept="${esc(d.id)}" ${(c.depts || []).includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('') || '<span class="muted">No departments yet.</span>'}</div></div>
      ${noDept.length ? `<p class="lock-banner" role="note" style="margin-top:10px">${noDept.length} ${noDept.length === 1 ? 'person has' : 'people have'} no department and ${noDept.length === 1 ? 'is' : 'are'} left out: ${esc(noDept.slice(0, 6).map((e) => ctx.fullName(e)).join(', '))}${noDept.length > 6 ? '…' : ''}. Set their department on their profile.</p>` : ''}
      <p class="muted" style="margin-top:10px">${sample ? `Example: ${esc(P.fmtUnits(2000, c.unit || ''))} × RM${esc(String(c.rate))} = ${rm(sample.poolSen)} shared by 25 people = <b>${rm(sample.shareSen)}</b> each${sample.remainderSen ? ` (${rm(sample.remainderSen)} not shared out)` : ''}.` : 'Type a rate to see an example.'}</p>
      <p class="faint" style="font-size:12.5px;margin-top:6px">A rate change applies to days saved afterwards; each saved day keeps its rate. In payroll the commission counts as wages for EPF, SOCSO, EIS, PCB and the HRD levy. It isn’t part of the overtime rate or leave pay. Please have your accountant confirm this before the first payroll with commission.</p></div>`;
  }
  function bindSettings() {
    const el = ctx.$('#prod-settings'); if (!el) return;
    const save = (what) => { ctx.commit('Production commission settings saved', `Production commission settings changed (${what})`); };
    ctx.$('#pc-rate')?.addEventListener('change', (ev) => { const v = ev.target.value.trim(); if (v && P.rateUnits(v) == null) { ctx.toast('The rate is a number with up to 4 decimals, for example 0.05.', 'error'); ev.target.value = cfg().rate; return; } cfg().rate = v; save('rate'); });
    ctx.$('#pc-unit')?.addEventListener('change', (ev) => { cfg().unit = ev.target.value.trim().slice(0, 20); save('unit'); });
    ctx.$$('[data-pc-dept]').forEach((cb) => cb.addEventListener('change', () => { const s = new Set(cfg().depts || []); if (cb.checked) s.add(cb.dataset.pcDept); else s.delete(cb.dataset.pcDept); cfg().depts = [...s]; save('departments'); }));
  }

  // ---------- Payroll ----------
  // One earning line per person for the month: the sum of their daily shares, with the number of days.
  function forPayroll(e, mk) {
    if (!on()) return [];
    const t = P.monthTotals(days(), mk)[e.id];
    if (!t || !t.sen) return [];
    return [{ key: 'prod', label: NAME, amount: t.sen / 100, epf: true, socso: true, tax: true, hrd: true, detail: `${t.days} day${t.days === 1 ? '' : 's'}` }];
  }
  function warnings(mk) {
    const attByDay = {}; Object.keys(st().attendance || {}).forEach((d) => { if (P.MONTH(d) === mk) attByDay[d] = st().attendance[d]; });
    return P.monthWarnings({ month: mk, days: days(), employees: allEmps(), attByDay, leaves: approvedLeaves(), settings: cfg(), isWorkday: (d) => !U.isWeekend(d) });
  }
  const lockMonth = (mk) => { store().locks[mk] = true; if (ctx.cloud() && ctx.fire()?.prodLock) ctx.fire().prodLock(mk).catch(() => {}); };
  function payrollBanner(mk) {
    if (!on() || !ctx.can('payroll')) return '';
    const w = warnings(mk); if (!w.missing.length && !w.changed.length) return '';
    return `<p class="lock-banner" role="note" style="margin-bottom:12px"><b>Production commission:</b> ${w.missing.length ? `${w.missing.length} day${w.missing.length > 1 ? 's' : ''} with check-ins but no production entered (${esc(w.missing.slice(0, 4).map((d) => fmtD(d, { day: 'numeric', month: 'short' })).join(', '))}${w.missing.length > 4 ? '…' : ''}). ` : ''}${w.changed.length ? `${w.changed.length} day${w.changed.length > 1 ? 's' : ''} where attendance changed since saving (${esc(w.changed.slice(0, 4).map((d) => fmtD(d, { day: 'numeric', month: 'short' })).join(', '))}). ` : ''}<a href="#production">Open Production</a></p>`;
  }

  // ---------- Staff: their own ----------
  // A person's days for a month: from the saved days (admins, the demo) or from their own share records (the cloud).
  function mine(empId, month) {
    const out = [];
    const d = days();
    if (Object.keys(d).length) {
      Object.keys(d).filter((x) => P.MONTH(x) === month).sort().forEach((x) => {
        const y = d[x], inDay = (y.attendees || []).includes(empId), ex = (y.excluded || []).find((z) => z.id === empId);
        if (inDay) out.push({ date: x, status: 'paid', shareSen: y.shareSen, units: y.units, unit: y.unit, count: y.count, reason: '' });
        else if (ex) out.push({ date: x, status: 'missed', shareSen: 0, units: y.units, unit: y.unit, count: y.count, reason: ex.reason });
      });
    } else {
      Object.values(st().prodShares || {}).filter((x) => x.empId === empId && P.MONTH(x.date) === month).sort((a, b) => a.date.localeCompare(b.date)).forEach((x) => out.push(x));
    }
    return out;
  }
  const inScheme = (e) => on() && !!e && (cfg().depts || []).includes(e.dept);
  const totalOf = (list) => ({ sen: list.reduce((s, x) => s + (x.status === 'paid' ? x.shareSen : 0), 0), days: list.filter((x) => x.status === 'paid').length });
  function homeCard(e) {
    if (!inScheme(e) && !Object.keys(st().prodShares || {}).length) return '';
    const mk = U.monthKey(T()), t = totalOf(mine(e.id, mk));
    return `<div class="card"><div class="card-head"><h3>Production commission</h3><a class="hint" href="#my-production">Details</a></div>
      <div class="kpi"><div class="kpi-value">${rm(t.sen)}</div><div class="kpi-foot">${esc(U.fmtMonth(mk))} · ${t.days} day${t.days === 1 ? '' : 's'}</div></div></div>`;
  }
  function myView() {
    const e = ctx.me(); if (!e || !on()) return '<div class="empty"><strong>Not available</strong></div>';
    const mk = ui.month || U.monthKey(T()), list = mine(e.id, mk), t = totalOf(list);
    const rows = list.slice().reverse().map((x) => `<tr><td>${esc(fmtD(x.date))}</td><td class="num">${esc(P.fmtUnits(x.units, x.unit))}</td><td class="num">${x.count}</td>
      <td class="num">${x.status === 'paid' ? `<b>${rm(x.shareSen)}</b>` : '—'}</td><td>${x.status === 'paid' ? '<span class="pill ok">Shared</span>' : `<span class="pill">${esc(x.reason || 'Not shared')}</span>`}</td></tr>`).join('');
    return `<div class="page-head"><div><h1>Production commission</h1><p class="sub">Komisen pengeluaran. Your share of each day’s pool, added to your pay at month end.</p></div>
        <div class="actions"><button class="btn btn-icon" data-act="myprod-month" data-v="-1" aria-label="Previous month">${icon('left')}</button><span class="pill">${esc(U.fmtMonth(mk))}</span><button class="btn btn-icon" data-act="myprod-month" data-v="1" aria-label="Next month" ${mk >= U.monthKey(T()) ? 'disabled' : ''}>${icon('right')}</button></div></div>
      <div class="grid g-4 keep-2" style="margin-bottom:12px"><div class="card kpi"><div class="kpi-label">This month</div><div class="kpi-value">${rm(t.sen)}</div><div class="kpi-foot">${t.days} day${t.days === 1 ? '' : 's'}</div></div></div>
      <div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Day</th><th>Total made</th><th>Shared by</th><th>Your share</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No days yet this month.</td></tr>'}</tbody></table></div></div>
      <p class="faint" style="font-size:12.5px;margin-top:8px">You see only your own share, the day’s total and how many people shared it.</p>`;
  }

  // ---------- CSV (payroll area) ----------
  function csv(month) {
    const t = P.monthTotals(days(), month), rows = Object.entries(t).map(([id, v]) => { const e = ctx.emp(id); return [ctx.fullName(e) || id, ctx.dept(e?.dept)?.name || '', v.days, (v.sen / 100).toFixed(2)]; });
    ctx.downloadCSV(`production-commission-${month}.csv`, [['Name', 'Department', 'Days', 'Commission (RM)'], ...rows, [], ['Total', '', '', (Object.values(t).reduce((s, v) => s + v.sen, 0) / 100).toFixed(2)]]);
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.production = view; ctx.AFTER.production = after;
    ctx.VIEWS['my-production'] = myView;
    Object.assign(ctx.ACTIONS, {
      'prod-day': (_, v) => { ui.day = v; ui.units = null; ui.note = ''; window.scrollTo(0, 0); ctx.render(); },
      'prod-shift': (_, v) => { ui.day = +v === 0 ? T() : U.addDays(ui.day || T(), +v); if (ui.day > T()) ui.day = T(); ui.units = null; ui.note = ''; ctx.render(); },
      'prod-month': (_, v) => { ui.day = U.addMonths(monthOfDay(), +v) + '-01'; if (ui.day > T()) ui.day = T(); ui.units = null; ui.note = ''; ctx.render(); },
      'prod-recalc': (_, v) => saveDay(v, days()[v]?.units, days()[v]?.note),
      'prod-csv': (_, v) => csv(v),
      'myprod-month': (_, v) => { ui.month = U.addMonths(ui.month || U.monthKey(T()), +v); ctx.render(); },
    });
    // Finalising payroll: warn about days that need a look, then lock the month's production days.
    const approve = ctx.ACTIONS['pay-approve'];
    ctx.ACTIONS['pay-approve'] = (...a) => {
      const mk = ctx.payMonth();
      if (on()) {
        const w = warnings(mk), n = w.missing.length + w.changed.length;
        const go = () => { approve(...a); lockMonth(mk); ctx.save(); ctx.render(); };
        if (n && !ui.confirmed) { ctx.openModal({ title: 'Production commission needs a look', size: 'sm', submit: 'Finalise anyway', body: `<p>${w.missing.length ? `${w.missing.length} day(s) have check-ins but no production entered. ` : ''}${w.changed.length ? `${w.changed.length} day(s) changed since they were saved. ` : ''}Finalising locks this month’s production days.</p>`, onSubmit: () => { setTimeout(go, 0); } }); return; }
        go(); return;
      }
      approve(...a);
    };
    return { on, canEntry, canSettings, settingsCard, bindSettings, forPayroll, payrollBanner, homeCard, inScheme, mine, totalOf, plan, warnings, days, isLocked, lockMonth, showStaff: () => on() && (inScheme(ctx.me()) || Object.keys(st().prodShares || {}).length > 0) };
  }
  return { install };
})();
