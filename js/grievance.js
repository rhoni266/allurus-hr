// Grievances: employees raise a concern (optionally anonymous, so their department never sees who raised it),
// a grievance manager is assigned, the case moves New → Acknowledged → Investigating → Resolved → Closed against
// SLA days per priority, and a summary report shows patterns without names. Rules: js/talent-rules.js.
window.AllurusGrievance = (function () {
  'use strict';
  const R = window.AllurusTalentRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const cfg = () => st().settings.grievance;
  const list = () => (st().grievances = st().grievances || []);
  const find = (id) => list().find((g) => g.id === id);
  const emp = (id) => ctx.emp(id);
  const firstOf = (id) => emp(id)?.first || '—';
  const fmt = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? U.fmtDate(d, o) : '—');
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const notify = (type, data, to, opts) => ctx.notify?.event(type, data, to, opts);
  const isManager = (id) => (cfg().managers || []).includes(id);
  const canManage = () => ctx.role() === 'admin' || isManager(ctx.me()?.id);
  const ui = { tab: 'open', revealed: new Set() };
  const TONE = { New: 'warn', Acknowledged: 'info', Investigating: 'info', Resolved: 'ok', Closed: '' };
  const PTONE = { Low: '', Normal: '', High: 'warn', Urgent: 'bad' };
  const sla = (g) => R.slaState(g, T(), cfg().sla);
  const raiser = (g) => (g.anonymous && !ui.revealed.has(g.id) ? 'Anonymous' : ctx.fullName(emp(g.empId)));
  const slaTag = (g) => { const s = sla(g); if (!s.open) return g.resolvedAt && g.resolvedAt <= s.resolveDue ? '<span class="faint">Within SLA</span>' : '<span class="faint">Outside SLA</span>'; if (s.ackBreached) return '<span class="pill bad">Not acknowledged</span>'; if (s.resolveBreached) return `<span class="pill bad">${-s.daysLeft} day${s.daysLeft === -1 ? '' : 's'} over</span>`; return `<span class="${s.daysLeft <= 2 ? 'pill warn' : 'faint'}">${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left</span>`; };

  // ---------- Raising a concern ----------
  function raiseForm() {
    ctx.openModal({
      title: 'Raise a concern', submit: 'Send',
      body: `<p class="muted">Tell us what’s wrong. A grievance manager looks into every concern and replies here. Retaliation against anyone raising a concern in good faith is not allowed.</p>
        <div class="form-grid"><div class="field"><label for="gr-cat">About</label><select class="select" id="gr-cat" name="category">${cfg().categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="gr-pri">How urgent</label><select class="select" id="gr-pri" name="priority">${R.PRIORITIES.map((p) => `<option ${p === 'Normal' ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field full"><label for="gr-sub">Subject</label><input class="input" id="gr-sub" name="subject" required maxlength="120"></div>
        <div class="field full"><label for="gr-det">What happened</label><textarea class="textarea" id="gr-det" name="details" rows="5" required placeholder="What happened, when, and who was involved. Add what you’d like to happen next."></textarea></div>
        <label class="check field full"><input type="checkbox" name="anonymous"><span><strong>Keep my name from my department.</strong> Your manager and team never see this concern. Grievance managers see “Anonymous”; they can reveal your name only if the investigation needs it, and that is recorded.</span></label></div>`,
      onSubmit(d) {
        const me = ctx.me(), mgrs = cfg().managers.filter((id) => id !== me.id && emp(id));
        const assignee = mgrs[list().filter((g) => !g.resolvedAt).length % Math.max(1, mgrs.length)] || cfg().managers[0];
        const g = { id: U.uid('gr'), ref: `GR-${T().slice(0, 4)}-${String(list().length + 1).padStart(3, '0')}`, empId: me.id, anonymous: d.anonymous === 'on', category: d.category, subject: d.subject.trim(), details: d.details.trim(), priority: d.priority, assignee, status: 'New', created: T(), ackAt: '', resolvedAt: '', outcome: '', timeline: [{ at: T(), by: me.id, kind: 'raised', note: 'Concern raised' }] };
        list().push(g);
        const due = R.slaDates(g.created, g.priority, cfg().sla);
        notify('grievance.raised', { subject: g.subject, priority: g.priority, ackDue: due.ackDue, href: ctx.role() === 'admin' ? '#grievances' : '#grievances' }, assignee, { from: 'system' });
        ctx.commit(`Sent. ${firstOf(assignee)} will acknowledge it by ${fmt(due.ackDue, { weekday: 'short', day: 'numeric', month: 'short' })}.`);
      },
    });
  }

  // ---------- Case view ----------
  function caseView(id) {
    const g = find(id), mgr = canManage() && (ctx.role() === 'admin' || g.assignee === actor() || isManager(actor())), mine = g.empId === ctx.me()?.id && ctx.role() === 'employee';
    if (!mgr && !mine) return;
    const s = sla(g), next = R.GSTATUSES.filter((x) => R.canMove(g.status, x));
    const tl = g.timeline.filter((x) => mgr || !x.internal);
    ctx.openModal({
      title: `${g.ref} · ${g.subject}`, size: 'lg', submit: null,
      body: `<div class="gr-head"><span class="pill ${TONE[g.status]}">${g.status}</span><span class="pill ${PTONE[g.priority]}">${g.priority}</span><span class="tag">${esc(g.category)}</span>${s.open ? slaTag(g) : ''}</div>
        <dl class="kv">${mgr ? `<dt>Raised by</dt><dd>${esc(raiser(g))}${g.anonymous ? (ui.revealed.has(g.id) ? ' <span class="faint">(revealed, recorded)</span>' : ` <button type="button" class="link-btn" data-act="gr-reveal" data-id="${g.id}">Reveal name</button>`) : ''}</dd>` : `<dt>Your name</dt><dd>${g.anonymous ? 'Hidden from your department' : 'Visible to the grievance manager'}</dd>`}
          <dt>Raised</dt><dd>${fmt(g.created)}</dd><dt>Grievance manager</dt><dd>${esc(ctx.fullName(emp(g.assignee)))}</dd><dt>Acknowledge by</dt><dd>${fmt(s.ackDue)}${g.ackAt ? ` · done ${fmt(g.ackAt, { day: 'numeric', month: 'short' })}` : ''}</dd><dt>Resolve by</dt><dd>${fmt(s.resolveDue)}${g.resolvedAt ? ` · done ${fmt(g.resolvedAt, { day: 'numeric', month: 'short' })}` : ''}</dd></dl>
        <div class="gr-details">${esc(g.details).replace(/\n/g, '<br>')}</div>
        ${g.outcome ? `<div class="gr-outcome"><strong>Outcome</strong><p>${esc(g.outcome)}</p></div>` : ''}
        <h4 class="lv-h">History</h4><ol class="audit-list">${tl.map((x) => `<li><div><strong>${esc(x.by === g.empId && g.anonymous && mgr && !ui.revealed.has(g.id) ? 'Raiser' : x.by === 'system' ? 'Allurus' : firstOf(x.by))}</strong> · ${fmt(x.at, { day: 'numeric', month: 'short' })}${x.status ? ` <span class="pill ${TONE[x.status]}">${x.status}</span>` : ''}${x.internal ? ' <span class="tag">Internal note</span>' : ''}</div>${x.note ? `<div>${esc(x.note)}</div>` : ''}</li>`).join('')}</ol>
        ${g.status === 'Closed' ? '' : `<div class="field" style="margin-top:12px"><label for="gr-note">${mgr ? 'Note or reply' : 'Add a reply'}</label><textarea class="textarea" id="gr-note" rows="3"></textarea></div>
        ${mgr ? `<div class="form-grid"><div class="field"><label for="gr-to">Move to</label><select class="select" id="gr-to"><option value="">Keep as ${g.status}</option>${next.map((x) => `<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="gr-asg">Grievance manager</label><select class="select" id="gr-asg">${cfg().managers.filter((x) => emp(x) && (x !== g.empId)).map((x) => `<option value="${x}" ${g.assignee === x ? 'selected' : ''}>${esc(ctx.fullName(emp(x)))}</option>`).join('')}</select></div>
          <label class="check field full"><input type="checkbox" id="gr-int"><span>Internal note (the raiser doesn’t see it)</span></label></div>` : ''}
        <div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-act="gr-update" data-id="${g.id}">${mgr ? 'Save' : 'Send reply'}</button></div>`}`,
    });
  }
  function update(id) {
    const g = find(id), note = ctx.$('#gr-note')?.value.trim() || '', to = ctx.$('#gr-to')?.value || '', asg = ctx.$('#gr-asg')?.value || g.assignee, internal = !!ctx.$('#gr-int')?.checked;
    if (!note && !to && asg === g.assignee) { ctx.toast('Add a note or choose a new status', 'error'); return; }
    if (to === 'Resolved' && !note) { ctx.toast('Write the outcome before resolving', 'error'); ctx.$('#gr-note').focus(); return; }
    if (asg !== g.assignee) { g.timeline.push({ at: T(), by: actor(), note: `Reassigned to ${firstOf(asg)}`, internal: true }); g.assignee = asg; notify('grievance.raised', { subject: g.subject, priority: g.priority, ackDue: sla(g).ackDue, href: '#grievances' }, asg, { from: actor() }); }
    if (to) {
      g.status = to;
      if (to === 'Acknowledged' && !g.ackAt) g.ackAt = T();
      if (to === 'Resolved') { g.resolvedAt = T(); g.outcome = note; if (!g.ackAt) g.ackAt = T(); }
      if (to === 'Investigating' && g.resolvedAt) { g.resolvedAt = ''; g.outcome = ''; }
    }
    if (note || to) g.timeline.push({ at: T(), by: actor(), status: to || '', note, internal: internal && !to });
    if (g.empId !== actor() && (to || (note && !internal))) notify('grievance.update', { status: g.status, subject: g.subject, note: internal ? '' : note, href: '#my-concerns' }, g.empId, { from: actor() });
    if (g.empId === actor() && note) notify('grievance.update', { status: g.status, subject: `Reply from the raiser: ${g.subject}`, note: '', href: '#grievances' }, g.assignee, { from: 'system' });
    ctx.closeOverlay();
    ctx.commit(to ? `${g.ref} is now ${to}` : 'Saved');
  }

  // ---------- Manager views ----------
  const TABS = [['open', 'Open'], ['all', 'All cases'], ['report', 'Summary report']];
  function table(rows) {
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Case</th><th class="hide-sm">Raised by</th><th>Priority</th><th>Status</th><th class="hide-sm">Manager</th><th>SLA</th></tr></thead><tbody>
      ${rows.map((g) => `<tr class="clickable" data-act="gr-open" data-id="${g.id}"><td><strong>${esc(g.subject)}</strong><div class="person-sub">${esc(g.ref)} · ${esc(g.category)} · ${fmt(g.created, { day: 'numeric', month: 'short' })}</div></td><td class="hide-sm">${g.anonymous && !ui.revealed.has(g.id) ? `<span class="faint">${icon('eyeOff')} Anonymous</span>` : esc(raiser(g))}</td><td><span class="pill ${PTONE[g.priority]}">${g.priority}</span></td><td><span class="pill ${TONE[g.status]}">${g.status}</span></td><td class="hide-sm">${esc(firstOf(g.assignee))}</td><td>${slaTag(g)}</td></tr>`).join('')}</tbody></table>
      ${rows.length ? '' : '<div class="empty"><strong>No cases here</strong></div>'}</div></div>`;
  }
  function report() {
    const year = T().slice(0, 4), l = list().filter((g) => g.created.startsWith(year)), s = R.grievanceSummary(l, T(), cfg().sla);
    const bars = (obj) => { const max = Math.max(1, ...Object.values(obj)); return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar" style="grid-template-columns:130px minmax(0,1fr) 40px"><span>${esc(k)}</span><div class="hbar-track"><i style="width:${(v / max) * 100}%;background:var(--brand)"></i></div><span class="num r">${v}</span></div>`).join('') || '<p class="faint">None</p>'; };
    return `<p class="muted">${year} so far. No names appear in this report, so it can be shared with management.</p>
      <div class="grid g-4 keep-2"><div class="card kpi"><div class="kpi-label">Cases raised</div><div class="kpi-value">${s.total}</div><div class="kpi-foot">${l.filter((g) => g.anonymous).length} anonymous</div></div><div class="card kpi"><div class="kpi-label">Open</div><div class="kpi-value">${s.open}</div><div class="kpi-foot">${s.breachedOpen} past the SLA</div></div>
        <div class="card kpi"><div class="kpi-label">Resolved within SLA</div><div class="kpi-value">${s.slaMet == null ? '—' : `${s.slaMet}%`}</div></div><div class="card kpi"><div class="kpi-label">Average days to resolve</div><div class="kpi-value">${s.avgDaysToResolve ?? '—'}</div></div></div>
      <div class="grid g-3"><div class="card"><div class="card-head"><h3>By category</h3></div>${bars(s.byCategory)}</div><div class="card"><div class="card-head"><h3>By status</h3></div>${bars(s.byStatus)}</div><div class="card"><div class="card-head"><h3>By priority</h3></div>${bars(s.byPriority)}</div></div>
      <div class="actions" style="justify-content:flex-end;display:flex"><button class="btn" data-act="gr-csv">${icon('download')}Download summary (CSV, no names)</button></div>`;
  }
  function view() {
    const open = list().filter((g) => !['Resolved', 'Closed'].includes(g.status)), late = open.filter((g) => { const s = sla(g); return s.ackBreached || s.resolveBreached; });
    const rows = ui.tab === 'all' ? [...list()].reverse() : open.sort((a, b) => sla(a).daysLeft - sla(b).daysLeft);
    return `<div class="page-head"><div><div class="eyebrow">Employee relations</div><h1>Grievances</h1><p class="sub">${open.length} open${late.length ? `, ${late.length} past the SLA` : ''}. Only grievance managers can see this page.</p></div></div>
      <div class="seg rc-tabs" role="tablist" aria-label="Grievances">${TABS.map(([k, l]) => `<button role="tab" data-act="gr-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}</button>`).join('')}</div>
      ${ui.tab === 'report' ? report() : table(rows)}`;
  }
  function myView() {
    const me = ctx.me().id, mine = list().filter((g) => g.empId === me).reverse();
    return `<div class="page-head"><div><h1>Raise a concern</h1><p class="sub">Something wrong at work? Tell a grievance manager. You can keep your name from your department.</p></div><div class="actions"><button class="btn btn-primary" data-act="gr-new">${icon('plus')}Raise a concern</button></div></div>
      <div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>My concerns</h3></div>${mine.length ? `<div class="list">${mine.map((g) => `<button type="button" class="list-item gr-item" data-act="gr-open" data-id="${g.id}"><div class="grow"><div class="person-name">${esc(g.subject)}</div><div class="person-sub">${esc(g.ref)} · ${fmt(g.created, { day: 'numeric', month: 'short' })}${g.anonymous ? ' · name hidden from your department' : ''}</div></div><span class="pill ${TONE[g.status]}">${g.status}</span></button>`).join('')}</div>` : '<div class="empty"><strong>Nothing raised</strong>We hope it stays that way.</div>'}</div>
      ${isManager(me) ? `<p class="faint">You’re a grievance manager. <a href="#grievances">Open the grievance desk</a>.</p>` : ''}`;
  }

  // ---------- Settings ----------
  function settingsCard() {
    const c = cfg();
    return `<div class="card" id="gr-settings"><div class="card-head"><h3>Grievances</h3></div>
      <div class="settings-row"><div><div class="label">Grievance managers</div><div class="desc">They receive and handle concerns. Cases go to them in turn.</div></div><div class="rc-pick" style="max-width:340px">${ctx.activeEmployees().filter((e) => e.dept === 'd-people' || c.managers.includes(e.id) || e.manager === '' || /head|manager|lead/i.test(e.role)).map((e) => `<label class="check"><input type="checkbox" data-gr-mgr value="${e.id}" ${c.managers.includes(e.id) ? 'checked' : ''}><span>${esc(ctx.fullName(e))}</span></label>`).join('')}</div></div>
      <div class="settings-row"><div><div class="label">Response times (days)</div><div class="desc">Days to acknowledge and to resolve, by priority.</div></div><div class="table-wrap"><table class="gr-sla"><thead><tr><th>Priority</th><th class="r">Acknowledge</th><th class="r">Resolve</th></tr></thead><tbody>${R.PRIORITIES.map((p) => `<tr><td>${p}</td><td class="r"><input class="input num" type="number" min="1" max="60" data-gr-sla="${p}:ack" value="${c.sla[p].ack}" aria-label="${p}: days to acknowledge"></td><td class="r"><input class="input num" type="number" min="1" max="180" data-gr-sla="${p}:resolve" value="${c.sla[p].resolve}" aria-label="${p}: days to resolve"></td></tr>`).join('')}</tbody></table></div></div>
      <div class="settings-row"><div><div class="label">Categories</div><div class="desc">One per line.</div></div><textarea class="textarea" id="gr-cats" rows="4" style="width:min(300px,100%)">${esc(c.categories.join('\n'))}</textarea></div></div>`;
  }
  function bindSettings() {
    ctx.$$('[data-gr-mgr]').forEach((x) => x.addEventListener('change', () => { const l = ctx.$$('[data-gr-mgr]:checked').map((y) => y.value); if (!l.length) { x.checked = true; ctx.toast('Keep at least one grievance manager', 'error'); return; } cfg().managers = l; ctx.commit('Grievance managers saved'); }));
    ctx.$$('[data-gr-sla]').forEach((x) => x.addEventListener('change', () => { const [p, k] = x.dataset.grSla.split(':'); cfg().sla[p][k] = Math.max(1, Math.round(+x.value || 1)); ctx.commit('Response times saved'); }));
    ctx.$('#gr-cats')?.addEventListener('change', (ev) => { const l = ev.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (l.length) { cfg().categories = l; ctx.commit('Categories saved'); } });
  }

  function insights() {
    if (!canManage()) return [];
    const open = list().filter((g) => !['Resolved', 'Closed'].includes(g.status) && (ctx.role() === 'admin' || g.assignee === actor()));
    const late = open.filter((g) => { const s = sla(g); return s.ackBreached || s.resolveBreached; }), fresh = open.filter((g) => g.status === 'New');
    const out = [];
    if (late.length) out.push({ tone: 'bad', icon: 'shield', title: `${late.length} grievance${late.length === 1 ? ' is' : 's are'} past the response time`, detail: late.slice(0, 2).map((g) => `${g.ref} (${g.priority})`).join(', '), action: { label: 'Open', act: 'gr-open', id: late[0].id }, prio: 3 });
    else if (fresh.length) out.push({ tone: 'warn', icon: 'shield', title: `${fresh.length} new concern${fresh.length === 1 ? '' : 's'} to acknowledge`, detail: fresh.slice(0, 2).map((g) => g.ref).join(', '), action: { label: 'Open', act: 'gr-open', id: fresh[0].id }, prio: 2 });
    return out;
  }
  const badge = () => (canManage() ? list().filter((g) => g.status === 'New' || (!['Resolved', 'Closed'].includes(g.status) && sla(g).resolveBreached)).length : 0);

  function install(c) {
    ctx = c;
    ctx.VIEWS.grievances = view;
    ctx.VIEWS['my-concerns'] = myView;
    Object.assign(ctx.ACTIONS, {
      'gr-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'gr-new': () => raiseForm(),
      'gr-open': (id) => caseView(id),
      'gr-update': (id) => update(id),
      'gr-reveal': (id) => { const g = find(id); if (!confirm('Reveal the raiser’s name? This is recorded on the case.')) return; ui.revealed.add(id); g.timeline.push({ at: T(), by: actor(), note: 'Name revealed for the investigation', internal: true }); ctx.save(); ctx.closeOverlay(); caseView(id); },
      'gr-csv': () => { const y = T().slice(0, 4), s = R.grievanceSummary(list().filter((g) => g.created.startsWith(y)), T(), cfg().sla); ctx.downloadCSV(`grievance-summary-${y}.csv`, [['Group', 'Value', 'Cases'], ...Object.entries(s.byCategory).map(([k, v]) => ['Category', k, v]), ...Object.entries(s.byStatus).map(([k, v]) => ['Status', k, v]), ...Object.entries(s.byPriority).map(([k, v]) => ['Priority', k, v]), ['Total', '', s.total], ['Open', '', s.open], ['Open past SLA', '', s.breachedOpen], ['Resolved within SLA %', '', s.slaMet ?? ''], ['Average days to resolve', '', s.avgDaysToResolve ?? '']]); },
    });
    return { settingsCard, bindSettings, insights, badge, isManager, canManage };
  }
  return { install };
})();
