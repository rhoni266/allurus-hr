// Appraisals: templates and grade bands (Settings), review cycles launched by HR, self-review, L1 and optional L2
// manager scoring, HR final approval, 360° peer feedback, SMART goals with check-ins, recommendations that become
// scheduled pay changes for payroll, and reports. The rules live in js/appraisal-rules.js (AllurusAppraisalRules).
window.AllurusAppraisal = (function () {
  'use strict';
  const A = window.AllurusAppraisalRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const T = () => U.today();
  const cfg = () => st().settings.appraisal;
  const cycles = () => (st().cycles = st().cycles || []);
  const reviews = () => st().reviews;
  const goals = () => (st().goals = st().goals || []);
  const changes = () => (st().payChanges = st().payChanges || []);
  const tplOf = (id) => cfg().templates.find((t) => t.id === id) || cfg().templates[0];
  const cycleOf = (id) => cycles().find((c) => c.id === id);
  const ui = { cycle: '', tab: 'list', stage: 'all', dept: 'all' };
  const current = () => cycleOf(ui.cycle) || [...cycles()].filter((c) => c.status === 'Open').sort((a, b) => b.launched.localeCompare(a.launched))[0] || cycles()[cycles().length - 1];
  const nameOf = (id) => ctx.fullName(ctx.emp(id));
  const firstOf = (id) => ctx.emp(id)?.first || '—';
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const hrId = () => st().settings.leave?.hr || 'e1';
  // L1 is the manager; someone without one is scored by HR, and HR's own head goes straight to HR final.
  const l1Of = (a) => ctx.emp(a.empId)?.manager || (hrId() !== a.empId ? hrId() : '');
  const l2Of = (a) => { const m = l1Of(a) && ctx.emp(l1Of(a)); return m?.manager && m.manager !== a.empId && m.manager !== l1Of(a) ? m.manager : ''; };
  const owner = (a) => ({ self: a.empId, l1: l1Of(a), l2: l2Of(a), hr: hrId() })[a.stage] || '';
  const fmt = (d, o = { day: 'numeric', month: 'short' }) => (d ? U.fmtDate(d, o) : '—');
  const sc = (v) => (v == null ? '—' : v.toFixed(2));
  const notify = (type, data, to, opts) => ctx.notify?.event(type, data, to, opts);
  const bandOf = (v) => A.grade(v, cfg().bands);
  const gradePill = (v) => { const b = bandOf(v); return b ? `<span class="pill ${({ A: 'ok', B: 'ok', C: 'info', D: 'warn', E: 'bad' })[b.code] || ''}" title="${esc(b.label)}">${b.code} · ${sc(v)}</span>` : '<span class="faint">—</span>'; };
  const stagePill = (a, c) => `<span class="pill ${a.stage === 'done' ? 'ok' : a.stage === 'hr' ? 'info' : a.stage === 'self' ? '' : 'warn'}">${A.STAGES[a.stage]}</span>${c && A.overdue(a, c, T()) ? ' <span class="tag bad">Overdue</span>' : ''}`;
  const tplFor = (a) => tplOf(a.templateId);
  const scoreOf = (a, who) => (a[who]?.scores ? A.score(tplFor(a), a[who].scores) : null);
  const recOf = (a) => a.hr?.rec || a.l2?.rec || a.l1?.rec || null;
  const recText = (r) => (r ? [r.inc ? `+${r.inc}%` : '', r.bonus ? `${r.bonus} mo bonus` : '', r.promo ? `→ ${r.promo}` : ''].filter(Boolean).join(' · ') || 'No change' : '—');
  // Keeps the old review fields (status, rating, progress) in step, for the home page and reminders.
  function sync(a) {
    a.status = A.statusOf(a);
    a.rating = a.final?.score != null ? Math.round(a.final.score) : 0;
    a.progress = A.goalProgress(goals().filter((g) => g.empId === a.empId && g.cycleId === a.cycleId));
  }

  // ---------- Pay changes ----------
  const changesOf = (empId) => changes().filter((c) => c.empId === empId);
  const salaryFor = (e, mk) => A.salaryFor(e.salary, changesOf(e.id), mk);
  const bonusFor = (empId, mk) => A.bonusFor(changesOf(empId), mk);
  // What payroll shows for the month: the increment in effect, and the appraisal bonus paid.
  function payNote(e, mk) {
    const sal = changesOf(e.id).filter((c) => c.type === 'salary' && c.effective.slice(0, 7) <= mk && (c.status === 'scheduled' || c.effective.slice(0, 7) === mk)).pop();
    const b = changesOf(e.id).find((c) => c.type === 'bonus' && c.payMonth === mk && c.status !== 'cancelled');
    return { salary: sal ? `+${sal.pct}% from ${U.fmtMonth(sal.effective.slice(0, 7), { month: 'short', year: 'numeric' })}` : '', bonus: b ? `${b.cycle} appraisal, ${b.months} month${b.months === 1 ? '' : 's'}` : '' };
  }
  function applyDue() {
    const r = A.applyDue(changes(), T());
    if (!r.applied.length) return;
    Object.entries(r.updates).forEach(([id, u]) => Object.assign(ctx.emp(id) || {}, u));
    // The career history on the employee file shows each applied increment and promotion.
    changes().filter((c) => r.applied.includes(c.id)).forEach((c) => ctx.hr?.addCareer(c.empId, [{ date: c.effective, type: c.type === 'salary' ? 'increment' : 'promotion', from: c.from, to: c.to, ...(c.type === 'salary' ? { pct: c.pct } : {}), note: `${c.cycle} appraisal` }]));
    changes().forEach((c) => { if (r.applied.includes(c.id)) { c.status = 'applied'; c.appliedOn = T(); } });
    ctx.save();
  }
  const markBonusPaid = (mk, ids) => changes().forEach((c) => { if (c.type === 'bonus' && c.status === 'scheduled' && c.payMonth === mk && ids.includes(c.empId)) { c.status = 'paid'; c.paidIn = mk; } });

  // ---------- Flow ----------
  const stepper = (a, c) => {
    const steps = ['self', ...(l1Of(a) ? ['l1'] : []), ...(c?.l2 && l2Of(a) ? ['l2'] : []), 'hr', 'done'];
    const at = steps.indexOf(a.stage);
    return `<ol class="ap-steps">${steps.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span>${i < at ? ctx.icon('check') : i + 1}</span><div><strong>${A.STAGES[s]}</strong><small>${s === 'done' ? (a.final ? fmt(a.hr?.at) : '') : esc(firstOf(s === 'self' ? a.empId : s === 'l1' ? l1Of(a) : s === 'l2' ? l2Of(a) : hrId()))}${i === at && A.dueFor(s, c) ? ` · due ${fmt(A.dueFor(s, c))}` : ''}</small></div></li>`).join('')}</ol>`;
  };
  function advance(a, extra = {}) {
    const c = cycleOf(a.cycleId);
    a.stage = A.nextStage(a.stage, { l2: c?.l2, hasL2: !!l2Of(a), hasL1: !!l1Of(a) });
    Object.assign(a, extra);
    sync(a);
    const who = owner(a);
    if (a.stage !== 'done' && who) notify(a.stage === 'hr' ? 'appraisal.final' : 'appraisal.toscore', { who: nameOf(a.empId), cycle: c?.name || a.cycle, href: a.stage === 'hr' ? '#performance' : '#my-appraisal' }, who);
  }

  // ---------- Scoring form ----------
  function scaleRadios(t, name, val, label) {
    const s = t.scale || A.SCALE_1_5, opts = [];
    for (let v = s.min; v <= s.max; v++) opts.push(v);
    return `<div class="ap-scale" role="radiogroup" aria-label="${esc(label)}">${opts.map((v, i) => `<label class="ap-rate" title="${esc(s.labels?.[i] || '')}"><input type="radio" name="${name}" value="${v}" ${String(val) === String(v) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>`;
  }
  function scoreForm(id, as) {
    const a = reviews().find((x) => x.id === id), t = tplFor(a), c = cycleOf(a.cycleId), e = ctx.emp(a.empId);
    const mine = (as === 'self' ? a.self : a.l1)?.scores || {};
    const g = goals().filter((x) => x.empId === a.empId && x.cycleId === a.cycleId);
    const body = `${as === 'l1' ? `<div class="ap-who">${ctx.person(e)}<span class="faint">Self score ${sc(scoreOf(a, 'self')?.total)}</span></div>` : ''}
      ${g.length ? `<details class="ap-goals-mini"><summary>Goals this cycle · ${A.goalProgress(g)}% done</summary><ul>${g.map((x) => `<li>${esc(x.title)} <span class="faint">${x.progress}%</span></li>`).join('')}</ul></details>` : ''}
      ${t.sections.map((s) => `<fieldset class="ap-sec"><legend>${esc(s.name)} <span class="faint">${s.weight}%</span></legend>
        ${s.questions.map((q) => { const self = a.self?.scores?.[q.id]; return `<div class="ap-q"><div class="ap-q-text">${esc(q.text)}${q.weight !== 1 ? ` <span class="tag">×${q.weight}</span>` : ''}${as === 'l1' && self?.r ? `<div class="faint">${esc(e.first)}: ${self.r}${self.c ? ` · “${esc(self.c)}”` : ''}</div>` : ''}</div>
          ${scaleRadios(t, `q-${q.id}`, mine[q.id]?.r, q.text)}
          ${q.comment ? `<textarea class="textarea ap-c" name="c-${q.id}" rows="1" aria-label="Comment on ${esc(q.text)}" placeholder="Comment (optional)">${esc(mine[q.id]?.c || '')}</textarea>` : ''}</div>`; }).join('')}</fieldset>`).join('')}
      <div class="field"><label for="ap-comment">${as === 'self' ? 'Overall, how did the period go?' : `Overall comment for ${esc(e.first)}`}</label><textarea class="textarea" id="ap-comment" name="comment" rows="2">${esc((as === 'self' ? a.self : a.l1)?.comment || '')}</textarea></div>
      ${as === 'l1' ? `<fieldset class="ap-sec"><legend>Recommendation</legend><p class="faint" id="ap-guide"></p><div class="form-grid">
        <div class="field"><label for="ap-inc">Increment (%)</label><input class="input num" id="ap-inc" name="inc" type="number" min="0" max="50" step="0.5" value="${a.l1?.rec?.inc ?? ''}"></div>
        <div class="field"><label for="ap-bonus">Bonus (months of basic)</label><input class="input num" id="ap-bonus" name="bonus" type="number" min="0" max="12" step="0.25" value="${a.l1?.rec?.bonus ?? ''}"></div>
        <div class="field full"><label for="ap-promo">Promote to (optional)</label><input class="input" id="ap-promo" name="promo" value="${esc(a.l1?.rec?.promo || '')}" placeholder="New job title"></div>
        <div class="field full"><label for="ap-why">Why</label><input class="input" id="ap-why" name="why" value="${esc(a.l1?.rec?.why || '')}" placeholder="One line for HR"></div></div></fieldset>` : ''}
      <div class="ap-live" id="ap-live" role="status"></div>`;
    ctx.openModal({
      title: as === 'self' ? `My ${c?.name || ''} self-review` : `Score ${e.first} · ${c?.name || ''}`, size: 'lg', submit: as === 'self' ? 'Submit to my manager' : 'Submit',
      body: `${body}${as === 'self' ? '<div class="ci-actions" style="justify-content:flex-start"><button type="button" class="btn" data-act="ap-draft" data-id="' + a.id + '">Save draft</button></div>' : ''}`,
      onSubmit(d) {
        const scores = read(t, d), s = A.score(t, scores);
        if (!s.complete) { ctx.toast('Rate every item before submitting', 'error'); return false; }
        if (as === 'self') {
          a.self = { scores, comment: d.comment.trim(), draftAt: a.self?.draftAt || new Date().toISOString(), submittedAt: new Date().toISOString() };
          advance(a);
          ctx.commit(`Sent to ${a.stage === 'hr' ? 'HR' : firstOf(l1Of(a))}`, `${nameOf(a.empId)} submitted their ${c?.name} self-review`);
        } else {
          const g = bandOf(s.total);
          a.l1 = { by: actor(), scores, comment: d.comment.trim(), at: T(), rec: { inc: d.inc === '' ? g?.inc ?? 0 : +d.inc, bonus: d.bonus === '' ? g?.bonus ?? 0 : +d.bonus, promo: d.promo.trim(), why: d.why.trim() } };
          advance(a);
          ctx.commit(`${e.first}’s appraisal sent to ${a.stage === 'l2' ? firstOf(l2Of(a)) : 'HR'}`, `${nameOf(actor())} scored ${nameOf(a.empId)}’s ${c?.name} appraisal (${sc(s.total)})`);
        }
      },
    });
    const form = ctx.$('#overlay-root form');
    const live = () => {
      const s = A.score(t, read(t, Object.fromEntries(new FormData(form).entries()))), g = bandOf(s.total);
      ctx.$('#ap-live').innerHTML = s.total == null ? 'Rate the items to see the score.' : `Score <strong>${sc(s.total)}</strong> of 5 ${g ? `· ${g.code} ${esc(g.label)}` : ''}${s.complete ? '' : ' <span class="faint">(not every item rated yet)</span>'}`;
      const gd = ctx.$('#ap-guide'); if (gd) gd.textContent = g ? `Guideline for ${g.code}: ${g.inc}% increment and ${g.bonus} month${g.bonus === 1 ? '' : 's'} bonus. Leave blank to use it.` : '';
    };
    form.addEventListener('change', live); live();
  }
  function read(t, d) {
    const out = {};
    A.questions(t).forEach((q) => { if (d[`q-${q.id}`] != null) out[q.id] = { r: +d[`q-${q.id}`], c: (d[`c-${q.id}`] || '').trim() }; else if ((d[`c-${q.id}`] || '').trim()) out[q.id] = { r: null, c: d[`c-${q.id}`].trim() }; });
    return out;
  }

  // ---------- One appraisal ----------
  function openAppraisal(id) {
    const a = reviews().find((x) => x.id === id); if (!a) return;
    const t = tplFor(a), c = cycleOf(a.cycleId), e = ctx.emp(a.empId), me = actor();
    const isHR = ctx.role() === 'admin', self = scoreOf(a, 'self'), l1 = scoreOf(a, 'l1');
    const canSee = isHR || me !== a.empId || a.stage === 'done';
    const peers = A.peerSummary(a.peers || [], A.questions(t).filter((q) => q.kind !== 'kpi'), { min: cfg().peerMin || 2 });
    const g = goals().filter((x) => x.empId === a.empId && x.cycleId === a.cycleId);
    const rec = recOf(a);
    const row = (q) => `<tr><td>${esc(q.text)}</td><td class="r num">${a.self?.scores?.[q.id]?.r ?? '—'}</td>${canSee ? `<td class="r num">${a.l1?.scores?.[q.id]?.r ?? '—'}</td>` : ''}</tr>${[a.self?.scores?.[q.id]?.c && `<tr class="ap-cmt"><td colspan="3">${esc(e.first)}: “${esc(a.self.scores[q.id].c)}”</td></tr>`, canSee && a.l1?.scores?.[q.id]?.c && `<tr class="ap-cmt"><td colspan="3">${esc(firstOf(a.l1.by))}: “${esc(a.l1.scores[q.id].c)}”</td></tr>`].filter(Boolean).join('')}`;
    const actions = [];
    if (a.stage === 'self' && me === a.empId) actions.push(`<button class="btn btn-primary" data-act="ap-self" data-id="${a.id}">Continue my self-review</button>`);
    if (a.stage === 'l1' && (me === l1Of(a) || isHR)) actions.push(`<button class="btn btn-primary" data-act="ap-l1" data-id="${a.id}">${me === l1Of(a) ? 'Score' : `Score for ${esc(firstOf(l1Of(a)))}`}</button>`);
    if (a.stage === 'l2' && (me === l2Of(a) || isHR)) actions.push(`<button class="btn btn-primary" data-act="ap-l2" data-id="${a.id}">Review as second manager</button>`);
    if (isHR && a.stage !== 'done' && a.stage !== 'hr' && owner(a)) actions.push(`<button class="btn" data-act="ap-remind" data-id="${a.id}">Remind ${esc(firstOf(owner(a)))}</button>`);
    const hrBox = a.stage === 'hr' && isHR ? `<div class="review-box"><h4 class="lv-h" style="margin-top:0">HR final: approve or edit</h4><div class="form-grid">
        <div class="field"><label for="hr-inc">Increment (%)</label><input class="input num" id="hr-inc" type="number" min="0" max="50" step="0.5" value="${rec?.inc ?? 0}"></div>
        <div class="field"><label for="hr-bonus">Bonus (months)</label><input class="input num" id="hr-bonus" type="number" min="0" max="12" step="0.25" value="${rec?.bonus ?? 0}"></div>
        <div class="field full"><label for="hr-promo">Promote to</label><input class="input" id="hr-promo" value="${esc(rec?.promo || '')}" placeholder="Leave blank for no change"></div>
        <div class="field full"><label for="hr-note">Note</label><input class="input" id="hr-note" placeholder="Optional; required to send back"></div></div>
        <p class="faint">Increment and promotion take effect ${fmt(c?.effective, { day: 'numeric', month: 'long', year: 'numeric' })}; the bonus is paid with ${c?.bonusMonth ? U.fmtMonth(c.bonusMonth) : 'the chosen'} payroll. Current salary ${ctx.money(e.salary)} a year.</p>
        <div class="ci-actions" style="justify-content:flex-end"><button class="btn" data-act="ap-back" data-id="${a.id}">Send back to manager</button><button class="btn btn-primary" data-act="ap-final" data-id="${a.id}">${ctx.icon('check')}Approve final</button></div></div>` : '';
    ctx.openModal({
      title: `${ctx.fullName(e)} · ${c?.name || a.cycle}`, size: 'lg', submit: null,
      body: `${stepper(a, c)}
        <div class="ap-scores"><div class="kpi"><div class="kpi-label">Self</div><div class="kpi-value" style="font-size:24px">${sc(self?.total)}</div></div>
          ${canSee ? `<div class="kpi"><div class="kpi-label">Manager</div><div class="kpi-value" style="font-size:24px">${sc(l1?.total)}</div></div><div class="kpi"><div class="kpi-label">Final</div><div class="kpi-value" style="font-size:24px">${a.final ? gradePill(a.final.score) : '—'}</div>${a.final ? `<div class="kpi-foot">${esc(bandOf(a.final.score)?.label || '')}</div>` : ''}</div>` : ''}</div>
        <div class="table-wrap"><table class="ap-table"><thead><tr><th>Item</th><th class="r">Self</th>${canSee ? '<th class="r">Manager</th>' : ''}</tr></thead>
          ${t.sections.map((s) => `<tbody><tr class="ap-sec-row"><th colspan="${canSee ? 3 : 2}">${esc(s.name)} · ${s.weight}% <span class="faint">self ${sc(self?.sections.find((x) => x.id === s.id)?.score)}${canSee ? ` · manager ${sc(l1?.sections.find((x) => x.id === s.id)?.score)}` : ''}</span></th></tr>${s.questions.map(row).join('')}</tbody>`).join('')}</table></div>
        ${[a.self?.comment && `<p><strong>${esc(e.first)}:</strong> ${esc(a.self.comment)}</p>`, canSee && a.l1?.comment && `<p><strong>${esc(firstOf(a.l1.by))}:</strong> ${esc(a.l1.comment)}</p>`, canSee && a.l2?.comment && `<p><strong>${esc(firstOf(a.l2.by))} (L2):</strong> ${esc(a.l2.comment)}</p>`].filter(Boolean).join('')}
        ${c?.peers ? `<h4 class="lv-h">360° feedback</h4>${peers.shown ? `<div class="ap-peers">${peers.questions.map((q) => `<div><span>${esc(q.text)}</span><strong class="num">${q.avg ?? '—'}</strong></div>`).join('')}</div>${peers.comments.map((x) => `<p class="faint">“${esc(x)}”</p>`).join('')}<p class="faint">${peers.responses} colleagues answered. Names are never shown.</p>` : `<p class="faint">${peers.responses} of ${(a.peers || []).length} colleagues have answered. The summary shows once ${peers.needed} have, so answers stay anonymous.</p>`}` : ''}
        ${g.length ? `<h4 class="lv-h">Goals · ${A.goalProgress(g)}%</h4><ul class="ap-goal-list">${g.map((x) => `<li><span>${esc(x.title)}</span><div class="progress"><i style="width:${x.progress}%"></i></div><span class="num">${x.progress}%</span></li>`).join('')}</ul>` : ''}
        ${canSee && rec ? `<h4 class="lv-h">Recommendation</h4><p>${esc(recText(rec))}${rec.why ? ` <span class="faint">· ${esc(rec.why)}</span>` : ''}${a.stage === 'done' ? ' <span class="tag ok">Approved</span>' : ''}</p>` : ''}
        ${hrBox}
        ${actions.length ? `<div class="ci-actions">${actions.join('')}</div>` : ''}`,
    });
  }
  function l2Review(id) {
    const a = reviews().find((x) => x.id === id), e = ctx.emp(a.empId), rec = a.l1?.rec || {};
    ctx.openModal({
      title: `Second review · ${e.first}`, size: 'sm', submit: 'Agree and send to HR',
      body: `<p class="muted">${esc(firstOf(a.l1?.by))} scored ${sc(scoreOf(a, 'l1')?.total)} and recommends ${esc(recText(rec))}. Adjust if needed.</p><div class="form-grid">
        <div class="field"><label for="l2-inc">Increment (%)</label><input class="input num" id="l2-inc" name="inc" type="number" min="0" max="50" step="0.5" value="${rec.inc ?? 0}"></div>
        <div class="field"><label for="l2-bonus">Bonus (months)</label><input class="input num" id="l2-bonus" name="bonus" type="number" min="0" max="12" step="0.25" value="${rec.bonus ?? 0}"></div>
        <div class="field full"><label for="l2-promo">Promote to</label><input class="input" id="l2-promo" name="promo" value="${esc(rec.promo || '')}"></div>
        <div class="field full"><label for="l2-c">Comment</label><textarea class="textarea" id="l2-c" name="comment" rows="2"></textarea></div></div>`,
      onSubmit(d) {
        a.l2 = { by: actor(), at: T(), comment: d.comment.trim(), rec: { ...rec, inc: +d.inc || 0, bonus: +d.bonus || 0, promo: d.promo.trim() } };
        advance(a);
        ctx.commit(`Sent to HR`, `${nameOf(actor())} reviewed ${nameOf(a.empId)}’s appraisal as second manager`);
      },
    });
  }
  function finalApprove(id) {
    const a = reviews().find((x) => x.id === id), e = ctx.emp(a.empId), c = cycleOf(a.cycleId);
    const rec = { ...(recOf(a) || {}), inc: Math.max(0, +ctx.$('#hr-inc').value || 0), bonus: Math.max(0, +ctx.$('#hr-bonus').value || 0), promo: ctx.$('#hr-promo').value.trim() };
    // The manager's score is final; with no manager, the self-review score is.
    const total = l1Of(a) ? scoreOf(a, 'l1')?.total : scoreOf(a, 'self')?.total;
    if (total == null) { ctx.toast('The manager hasn’t scored this yet', 'error'); return; }
    const g = bandOf(total);
    a.hr = { by: actor(), at: T(), rec, note: ctx.$('#hr-note').value.trim() };
    a.final = { score: total, grade: g?.code || '', pct: Math.round((total / 5) * 100) };
    const made = A.changesFrom({ review: a, emp: e, cycle: c, rec, by: actor(), at: T() });
    st().payChanges = [...changes().filter((x) => x.ref !== a.id), ...made];
    advance(a);
    notify('appraisal.done', { cycle: c.name, grade: g ? `${g.code}, ${g.label}` : '', href: '#my-appraisal' }, a.empId);
    ctx.closeOverlay();
    ctx.commit(`${e.first}’s appraisal approved${made.length ? `: ${recText(rec)}` : ''}`, `${nameOf(a.empId)}’s ${c.name} appraisal was approved (${g?.code || ''} ${sc(total)})${made.length ? `; pay changes scheduled` : ''}`);
  }

  // ---------- Cycles ----------
  function launch() {
    const y = +T().slice(0, 4), h2 = +T().slice(5, 7) > 6;
    ctx.openModal({
      title: 'Launch a review cycle', size: 'lg', submit: 'Launch',
      body: `<div class="form-grid">
        <div class="field"><label for="cy-name">Name</label><input class="input" id="cy-name" name="name" required value="${h2 ? 'H2' : 'H1'} ${y}"></div>
        <div class="field"><label for="cy-tpl">Template</label><select class="select" id="cy-tpl" name="templateId">${cfg().templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><span class="field-hint">Templates assigned to a department or person win.</span></div>
        <div class="field"><label for="cy-start">Period from</label><input class="input" type="date" id="cy-start" name="start" required value="${y}-${h2 ? '07' : '01'}-01"></div>
        <div class="field"><label for="cy-end">to</label><input class="input" type="date" id="cy-end" name="end" required value="${y}-${h2 ? '12-31' : '06-30'}"></div>
        <div class="field"><label for="cy-self">Self-reviews due</label><input class="input" type="date" id="cy-self" name="selfDue" required value="${U.addDays(T(), 14)}"></div>
        <div class="field"><label for="cy-mgr">Manager scores due</label><input class="input" type="date" id="cy-mgr" name="managerDue" required value="${U.addDays(T(), 28)}"></div>
        <div class="field"><label for="cy-hr">HR final due</label><input class="input" type="date" id="cy-hr" name="hrDue" required value="${U.addDays(T(), 42)}"></div>
        <div class="field"><label for="cy-eff">Increments take effect</label><input class="input" type="month" id="cy-eff" name="effective" required value="${h2 ? y + 1 : y}-${h2 ? '01' : '07'}"></div>
        <div class="field"><label for="cy-bonus">Bonus paid with</label><input class="input" type="month" id="cy-bonus" name="bonusMonth" required value="${y}-${h2 ? '12' : '06'}"></div>
        <label class="check field"><input type="checkbox" name="l2" checked><span>Second manager (L2) reviews too</span></label>
        <label class="check field"><input type="checkbox" name="peers" checked><span>360° peer feedback, up to <input class="input num" name="maxPeers" type="number" min="1" max="8" value="3" style="width:56px;display:inline-block" aria-label="Most peers"> colleagues</span></label>
        <div class="field full"><span class="label-like">Who takes part</span><div class="an-depts"><label class="check"><input type="checkbox" id="cy-all" checked><span>Everyone</span></label>${st().departments.map((d) => `<label class="check"><input type="checkbox" name="dept" value="${d.id}" data-cy-dept><span>${esc(d.name)}</span></label>`).join('')}</div></div></div>`,
      onSubmit(d) {
        const depts = ctx.$$('[data-cy-dept]:checked').map((x) => x.value), all = ctx.$('#cy-all').checked;
        if (!all && !depts.length) { ctx.toast('Pick who takes part', 'error'); return false; }
        const c = { id: U.uid('cy'), name: d.name.trim(), start: d.start, end: d.end, templateId: d.templateId, selfDue: d.selfDue, managerDue: d.managerDue, hrDue: d.hrDue, effective: `${d.effective}-01`, bonusMonth: d.bonusMonth, l2: d.l2 === 'on', peers: d.peers === 'on', maxPeers: Math.max(1, +d.maxPeers || 3), status: 'Open', launched: T(), by: actor() };
        cycles().push(c);
        const people = ctx.activeEmployees().filter((e) => all || depts.includes(e.dept));
        people.forEach((e) => addParticipant(e, c));
        ui.cycle = c.id;
        notify('appraisal.launched', { cycle: c.name, date: c.selfDue, href: '#my-appraisal' }, people.map((e) => e.id));
        ctx.commit(`${c.name} launched for ${people.length} people`, `${c.name} review cycle launched`);
      },
    });
    const all = ctx.$('#cy-all');
    all.addEventListener('change', () => { if (all.checked) ctx.$$('[data-cy-dept]').forEach((x) => { x.checked = false; }); });
    ctx.$$('[data-cy-dept]').forEach((x) => x.addEventListener('change', () => { if (x.checked) all.checked = false; }));
  }
  function addParticipant(e, c = current()) {
    if (!c || reviews().some((a) => a.empId === e.id && a.cycleId === c.id)) return;
    const a = { id: U.uid('r'), empId: e.id, cycleId: c.id, cycle: c.name, templateId: A.templateFor(e, c, cfg().templates)?.id, stage: 'self', self: null, l1: null, l2: null, hr: null, final: null, peers: [], due: c.hrDue, notes: '' };
    sync(a);
    reviews().push(a);
  }

  // ---------- Admin page ----------
  function adminView() {
    const c = current();
    if (!c) return `<div class="page-head"><div><div class="eyebrow">Performance</div><h1>Appraisals</h1><p class="sub">Launch a review cycle to start self-reviews, manager scoring and HR approval.</p></div><div class="actions"><button class="btn btn-primary" data-act="ap-launch">${ctx.icon('plus')}Launch a cycle</button></div></div>`;
    const list = reviews().filter((a) => a.cycleId === c.id && ctx.emp(a.empId));
    const shown = list.filter((a) => (ui.stage === 'all' || a.stage === ui.stage) && (ui.dept === 'all' || ctx.emp(a.empId).dept === ui.dept)).sort((a, b) => nameOf(a.empId).localeCompare(nameOf(b.empId)));
    const done = list.filter((a) => a.stage === 'done'), late = list.filter((a) => A.overdue(a, c, T()));
    const avg = done.length ? done.reduce((s, a) => s + a.final.score, 0) / done.length : null;
    const comp = A.completion(list);
    return `<div class="page-head"><div><div class="eyebrow">Performance</div><h1>${esc(c.name)} appraisals</h1><p class="sub">${fmt(c.start, { day: 'numeric', month: 'short' })} – ${fmt(c.end, { day: 'numeric', month: 'short', year: 'numeric' })}. Self-reviews due ${fmt(c.selfDue)}, managers ${fmt(c.managerDue)}, HR final ${fmt(c.hrDue)}.</p></div>
        <div class="actions">${cycles().length > 1 ? `<label class="sr-only" for="ap-cycle">Cycle</label><select class="select" id="ap-cycle">${cycles().map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}<button class="btn btn-primary" data-act="ap-launch">${ctx.icon('plus')}Launch a cycle</button></div></div>
      <div class="seg" role="tablist" aria-label="Performance">${[['list', 'Appraisals'], ['reports', 'Reports'], ['pay', 'Pay changes']].map(([k, l]) => `<button role="tab" data-act="ap-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}</button>`).join('')}</div>
      ${ui.tab === 'reports' ? reportsView(list) : ui.tab === 'pay' ? payView() : `
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label">Taking part</div><div class="kpi-value">${list.length}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Completed</div><div class="kpi-value">${done.length}</div><div class="progress"><i style="width:${list.length ? (done.length / list.length) * 100 : 0}%"></i></div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Overdue steps</div><div class="kpi-value">${late.length}</div>${late.length ? `<div class="kpi-foot"><button class="link-btn" data-act="ap-remind-all">Remind them</button></div>` : ''}</div>
        <div class="card kpi"><div class="kpi-label">Average final score</div><div class="kpi-value">${avg == null ? '—' : avg.toFixed(2)}</div><div class="kpi-foot">${avg == null ? 'None final yet' : esc(bandOf(avg)?.label || '')}</div></div></div>
      <div class="card card-flush"><div class="toolbar ap-bar"><div class="seg">${[['all', 'All'], ...Object.entries(A.STAGES)].filter(([k]) => k !== 'l2' || c.l2).map(([k, l]) => `<button data-act="ap-stage" data-v="${k}" class="${ui.stage === k ? 'on' : ''}">${l}${k !== 'all' ? ` <span class="faint">${comp[k]}</span>` : ''}</button>`).join('')}</div>
          <label class="sr-only" for="ap-dept">Department</label><select class="select" id="ap-dept" style="width:auto"><option value="all">All departments</option>${st().departments.map((d) => `<option value="${d.id}" ${ui.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Stage</th><th class="r hide-sm">Self</th><th class="r hide-sm">Manager</th><th>Final</th><th class="hide-sm">Recommendation</th><th></th></tr></thead>
          <tbody>${shown.map((a) => `<tr class="clickable" data-act="ap-open" data-id="${a.id}"><td>${ctx.person(ctx.emp(a.empId))}</td><td>${stagePill(a, c)}${a.stage !== 'done' && owner(a) ? `<div class="person-sub">With ${esc(firstOf(owner(a)))}</div>` : ''}</td>
            <td class="r num hide-sm">${sc(scoreOf(a, 'self')?.total)}</td><td class="r num hide-sm">${sc(scoreOf(a, 'l1')?.total)}</td><td>${a.final ? gradePill(a.final.score) : '<span class="faint">—</span>'}</td>
            <td class="hide-sm muted">${esc(recText(recOf(a)))}</td>
            <td><div class="row-actions"><button class="btn btn-sm ${a.stage === 'hr' ? 'btn-primary' : ''}" data-act="ap-open" data-id="${a.id}">${a.stage === 'hr' ? 'Final review' : 'Open'}</button></div></td></tr>`).join('')}</tbody></table>
          ${shown.length ? '' : '<div class="empty"><strong>No one here</strong></div>'}</div></div>`}`;
  }
  function reportsView(list) {
    const bands = cfg().bands, rows = A.distribution(list, { employees: st().employees, departments: st().departments, bands }), comp = A.completion(list);
    const totals = Object.fromEntries(bands.map((b) => [b.code, rows.reduce((s, r) => s + r.counts[b.code], 0)])), maxB = Math.max(1, ...Object.values(totals));
    return `<div class="grid g-2">
      <div class="card"><div class="card-head"><h3>Score distribution</h3><span class="hint">${Object.values(totals).reduce((s, x) => s + x, 0)} final</span></div>
        ${bands.map((b) => `<div class="hbar" style="grid-template-columns:150px minmax(0,1fr) 28px"><span>${b.code} · ${esc(b.label)}</span><div class="hbar-track"><i style="width:${(totals[b.code] / maxB) * 100}%;background:var(--brand)"></i></div><span class="num r">${totals[b.code]}</span></div>`).join('')}</div>
      <div class="card"><div class="card-head"><h3>Completion</h3><span class="hint">${list.length} taking part</span></div>
        ${Object.entries(A.STAGES).map(([k, l]) => `<div class="hbar" style="grid-template-columns:150px minmax(0,1fr) 28px"><span>${l}</span><div class="hbar-track"><i style="width:${list.length ? (comp[k] / list.length) * 100 : 0}%;background:${k === 'done' ? 'var(--ok)' : 'var(--warn)'}"></i></div><span class="num r">${comp[k]}</span></div>`).join('')}</div></div>
      <div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>By department</h3><button class="btn btn-sm" data-act="ap-csv">${ctx.icon('download')}Export CSV</button></div>
        <div class="table-wrap"><table><thead><tr><th>Department</th>${bands.map((b) => `<th class="r">${b.code}</th>`).join('')}<th class="r">Average</th><th class="r">Completed</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td>${bands.map((b) => `<td class="r num">${r.counts[b.code] || '<span class="faint">0</span>'}</td>`).join('')}<td class="r num">${sc(r.avg)}</td><td class="r num">${r.done} of ${r.total}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function reportCSV() {
    const c = current(), list = reviews().filter((a) => a.cycleId === c.id && ctx.emp(a.empId));
    const rows = [['Employee', 'Department', 'Stage', 'Self score', 'Manager score', 'Final score', 'Grade', 'Increment %', 'Bonus months', 'Promotion', 'Goals %'], ...list.map((a) => { const e = ctx.emp(a.empId), r = recOf(a); return [ctx.fullName(e), ctx.dept(e.dept)?.name || '', A.STAGES[a.stage], scoreOf(a, 'self')?.total ?? '', scoreOf(a, 'l1')?.total ?? '', a.final?.score ?? '', a.final?.grade || '', a.stage === 'done' ? r?.inc ?? 0 : '', a.stage === 'done' ? r?.bonus ?? 0 : '', a.stage === 'done' ? r?.promo || '' : '', a.progress]; })];
    ctx.downloadCSV(`appraisals-${c.name.replace(/\s+/g, '-').toLowerCase()}.csv`, rows);
  }
  function payView() {
    const list = [...changes()].sort((a, b) => (a.effective || a.payMonth).localeCompare(b.effective || b.payMonth));
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><div><h3>Pay changes from appraisals</h3><div class="faint">Scheduled changes are picked up by payroll from their month and applied to the employee on the date.</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Change</th><th>From</th><th>Status</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>${ctx.person(ctx.emp(c.empId))}</td><td>${c.type === 'salary' ? `Salary ${ctx.money(c.from)} → <strong>${ctx.money(c.to)}</strong> a year (+${c.pct}%)` : c.type === 'bonus' ? `Bonus <strong>${ctx.money(c.amount, 2)}</strong> (${c.months} month${c.months === 1 ? '' : 's'})` : `Promotion: ${esc(c.from)} → <strong>${esc(c.to)}</strong>`}<div class="person-sub">${esc(c.cycle)} appraisal</div></td>
        <td class="num">${c.type === 'bonus' ? `${U.fmtMonth(c.payMonth)} payroll` : fmt(c.effective, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td><span class="pill ${c.status === 'scheduled' ? 'info' : 'ok'}">${c.status === 'scheduled' ? 'Scheduled' : c.status === 'paid' ? `Paid ${U.fmtMonth(c.paidIn, { month: 'short' })}` : 'Applied'}</span></td></tr>`).join('')}</tbody></table>
      ${list.length ? '' : '<div class="empty"><strong>No pay changes yet</strong>Approving an appraisal with an increment, bonus or promotion schedules them here.</div>'}</div></div>`;
  }

  // ---------- Employee page ----------
  function myView() {
    const e = ctx.me(), c = current();
    const a = c && reviews().find((x) => x.empId === e.id && x.cycleId === c.id);
    const mine = goals().filter((g) => g.empId === e.id && (!c || g.cycleId === c.id));
    const team = c ? reviews().filter((x) => x.cycleId === c.id && x.empId !== e.id && (l1Of(x) === e.id || l2Of(x) === e.id) && ctx.emp(x.empId)) : [];
    const asks = c ? reviews().filter((x) => x.cycleId === c.id && (x.peers || []).some((p) => p.empId === e.id && p.status === 'requested')) : [];
    const myPeers = a?.peers || [];
    return `<div class="page-head"><div><div class="eyebrow">Me</div><h1>Appraisal and goals</h1><p class="sub">${c ? `${esc(c.name)}: self-review due ${fmt(c.selfDue, { day: 'numeric', month: 'long' })}.` : 'No review cycle is open.'}</p></div>
        <div class="actions"><button class="btn" data-act="ap-goal-new">${ctx.icon('plus')}Add a goal</button>${a?.stage === 'self' ? `<button class="btn btn-primary" data-act="ap-self" data-id="${a.id}">${a.self?.draftAt ? 'Continue my self-review' : 'Start my self-review'}</button>` : ''}</div></div>
      ${a ? `<div class="card"><div class="card-head"><h3>My ${esc(c.name)} appraisal</h3>${stagePill(a, c)}</div>${stepper(a, c)}
        ${a.stage === 'done' ? `<div class="ap-result"><div>${gradePill(a.final.score)}</div><div><strong>${esc(bandOf(a.final.score)?.label || '')}</strong><div class="faint">Final score ${sc(a.final.score)} of 5</div></div>${changesOf(e.id).filter((x) => x.ref === a.id).map((x) => `<span class="tag ok">${x.type === 'salary' ? `+${x.pct}% from ${fmt(x.effective, { month: 'short', year: 'numeric' })}` : x.type === 'bonus' ? `${x.months}-month bonus in ${U.fmtMonth(x.payMonth, { month: 'short' })}` : `New role: ${esc(x.to)}`}</span>`).join('')}</div>` : ''}
        <div class="actions" style="margin-top:12px"><button class="btn btn-sm" data-act="ap-open" data-id="${a.id}">Open</button></div></div>` : ''}
      <div class="grid g-main"><div class="card"><div class="card-head"><h3>My goals</h3><span class="hint">${A.goalProgress(mine)}% overall</span></div>
        ${mine.length ? `<div class="list">${mine.map((g) => `<div class="list-item ap-goal"><div class="grow"><div class="person-name">${esc(g.title)} <span class="tag ${g.status === 'At risk' ? 'warn' : g.progress >= 100 ? 'ok' : ''}">${g.progress >= 100 ? 'Done' : esc(g.status || 'On track')}</span></div>
          <div class="person-sub" style="white-space:normal">${esc(g.measure)} · target ${esc(g.target)} · due ${fmt(g.due)}${g.weight !== 1 ? ` · weight ${g.weight}` : ''}</div>
          <div class="ap-goal-bar"><div class="progress"><i style="width:${g.progress}%"></i></div><span class="num">${g.progress}%</span></div>
          ${g.checkins?.length ? `<div class="faint" style="font-size:12.5px">Last check-in ${fmt(g.checkins[g.checkins.length - 1].at)}: “${esc(g.checkins[g.checkins.length - 1].note)}”</div>` : ''}</div>
          <button class="btn btn-sm" data-act="ap-checkin" data-id="${g.id}">Check in</button></div>`).join('')}</div>` : '<div class="empty"><strong>No goals yet</strong>Add two to four SMART goals for this cycle.</div>'}</div>
        <div>${c?.peers && a ? `<div class="card"><div class="card-head"><h3>360° feedback</h3><span class="hint">Up to ${c.maxPeers}</span></div>
            ${myPeers.length ? `<div class="list">${myPeers.map((p) => `<div class="list-item">${ctx.avatar(nameOf(p.empId), 'sm')}<div class="grow"><div class="person-name">${esc(nameOf(p.empId))}</div><div class="person-sub">${p.status === 'done' ? 'Answered' : 'Asked'}</div></div></div>`).join('')}</div>` : '<p class="muted">Ask colleagues you work with for anonymous feedback.</p>'}
            ${myPeers.length < c.maxPeers && a.stage !== 'done' ? `<div style="margin-top:10px"><button class="btn btn-sm" data-act="ap-peers" data-id="${a.id}">${ctx.icon('people')}Ask for feedback</button></div>` : ''}</div>` : ''}
          ${asks.length ? `<div class="card"><div class="card-head"><h3>Feedback requests</h3><span class="hint">${asks.length}</span></div><div class="list">${asks.map((x) => `<div class="list-item">${ctx.avatar(nameOf(x.empId), 'sm')}<div class="grow"><div class="person-name">${esc(nameOf(x.empId))}</div><div class="person-sub">Your answers are anonymous</div></div><button class="btn btn-sm btn-primary" data-act="ap-give" data-id="${x.id}">Give feedback</button></div>`).join('')}</div></div>` : ''}</div></div>
      ${team.length ? `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>My team’s appraisals</h3><span class="hint">${team.filter((x) => (x.stage === 'l1' && l1Of(x) === e.id) || (x.stage === 'l2' && l2Of(x) === e.id)).length} waiting for you</span></div>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Stage</th><th class="r">Self</th><th class="r">Your score</th><th></th></tr></thead><tbody>${team.map((x) => { const mineStep = (x.stage === 'l1' && l1Of(x) === e.id) || (x.stage === 'l2' && l2Of(x) === e.id); return `<tr><td>${ctx.person(ctx.emp(x.empId))}</td><td>${stagePill(x, c)}</td><td class="r num">${sc(scoreOf(x, 'self')?.total)}</td><td class="r num">${sc(scoreOf(x, 'l1')?.total)}</td>
          <td><div class="row-actions">${mineStep ? `<button class="btn btn-sm btn-primary" data-act="${x.stage === 'l1' ? 'ap-l1' : 'ap-l2'}" data-id="${x.id}">${x.stage === 'l1' ? 'Score' : 'Review'}</button>` : `<button class="btn btn-sm" data-act="ap-open" data-id="${x.id}">View</button>`}</div></td></tr>`; }).join('')}</tbody></table></div></div>` : ''}`;
  }
  function goalForm() {
    const e = ctx.me(), c = current();
    ctx.openModal({
      title: 'Add a SMART goal', submit: 'Add goal',
      body: `<div class="form-grid"><div class="field full"><label for="g-title">Goal (Specific)</label><input class="input" id="g-title" name="title" required placeholder="Launch the Kenyir Resorts booking app"></div>
        <div class="field full"><label for="g-measure">How it’s measured (Measurable)</label><input class="input" id="g-measure" name="measure" required placeholder="App live in the stores; 200 bookings a month"></div>
        <div class="field"><label for="g-target">Target (Achievable)</label><input class="input" id="g-target" name="target" required placeholder="200 bookings a month"></div>
        <div class="field"><label for="g-due">Due (Time-bound)</label><input class="input" id="g-due" name="due" type="date" required value="${c?.end || U.addDays(T(), 60)}"></div>
        <div class="field full"><label for="g-why">Why it matters (Relevant)</label><input class="input" id="g-why" name="why" placeholder="Our biggest client deliverable this half"></div>
        <div class="field"><label for="g-weight">Weight</label><input class="input num" id="g-weight" name="weight" type="number" min="1" max="5" value="1"></div></div>`,
      onSubmit(d) {
        const g = { id: U.uid('g'), empId: e.id, cycleId: c?.id || '', title: d.title.trim(), measure: d.measure.trim(), target: d.target.trim(), due: d.due, why: d.why.trim(), weight: Math.max(1, +d.weight || 1), progress: 0, status: 'On track', checkins: [], created: T() };
        const p = A.goalProblems(g); if (p.length) { ctx.toast(p[0], 'error'); return false; }
        goals().push(g); reviews().filter((a) => a.empId === e.id && a.cycleId === g.cycleId).forEach(sync);
        ctx.commit('Goal added');
      },
    });
  }
  function checkin(id) {
    const g = goals().find((x) => x.id === id); if (!g) return;
    ctx.openModal({
      title: `Check in · ${g.title}`, size: 'sm', submit: 'Save check-in',
      body: `<div class="form-grid"><div class="field full"><label for="ck-prog">Progress: <output id="ck-out">${g.progress}%</output></label><input id="ck-prog" name="progress" type="range" min="0" max="100" step="5" value="${g.progress}" style="accent-color:var(--brand)" oninput="document.getElementById('ck-out').textContent=this.value+'%'"></div>
        <div class="field full"><label for="ck-status">Status</label><select class="select" id="ck-status" name="status">${['On track', 'At risk', 'Off track'].map((s) => `<option ${g.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field full"><label for="ck-note">What changed?</label><textarea class="textarea" id="ck-note" name="note" rows="2" required placeholder="Beta with 3 hotels; payment gateway next"></textarea></div></div>
        ${g.checkins?.length ? `<h4 class="lv-h">Earlier check-ins</h4><ol class="audit-list">${[...g.checkins].reverse().map((x) => `<li><div><strong>${x.progress}%</strong> <span class="faint">· ${fmt(x.at)} · ${esc(firstOf(x.by))}</span></div><div>${esc(x.note)}</div></li>`).join('')}</ol>` : ''}`,
      onSubmit(d) {
        g.progress = +d.progress; g.status = d.status;
        g.checkins = [...(g.checkins || []), { at: T(), by: actor(), progress: g.progress, note: d.note.trim() }];
        reviews().filter((a) => a.empId === g.empId && a.cycleId === g.cycleId).forEach(sync);
        ctx.commit(`Check-in saved: ${g.progress}%`);
      },
    });
  }
  function askPeers(id) {
    const a = reviews().find((x) => x.id === id), c = cycleOf(a.cycleId), e = ctx.emp(a.empId);
    const taken = new Set((a.peers || []).map((p) => p.empId)), left = c.maxPeers - taken.size;
    const options = ctx.activeEmployees().filter((x) => x.id !== e.id && x.id !== l1Of(a) && !taken.has(x.id)).sort((x, y) => (y.dept === e.dept) - (x.dept === e.dept) || x.first.localeCompare(y.first));
    ctx.openModal({
      title: 'Ask for 360° feedback', size: 'sm', submit: 'Send requests',
      body: `<p class="muted" style="margin-bottom:10px">Pick up to ${left} colleague${left === 1 ? '' : 's'} you work with. Their answers are combined, and only shown once ${cfg().peerMin || 2} have answered.</p><div class="ap-peer-pick">${options.map((x) => `<label class="check"><input type="checkbox" name="peer" value="${x.id}" data-peer><span>${esc(ctx.fullName(x))} <span class="faint">${esc(ctx.dept(x.dept)?.name || '')}</span></span></label>`).join('')}</div>`,
      onSubmit() {
        const ids = ctx.$$('[data-peer]:checked').map((x) => x.value);
        if (!ids.length) { ctx.toast('Pick at least one colleague', 'error'); return false; }
        if (ids.length > left) { ctx.toast(`Pick up to ${left}`, 'error'); return false; }
        a.peers = [...(a.peers || []), ...ids.map((id2) => ({ empId: id2, status: 'requested', asked: T() }))];
        notify('appraisal.peer', { who: ctx.fullName(e), cycle: c.name, href: '#my-appraisal' }, ids);
        ctx.commit(`Asked ${ids.length} colleague${ids.length === 1 ? '' : 's'}`);
      },
    });
  }
  function givePeer(id) {
    const a = reviews().find((x) => x.id === id), t = tplFor(a), e = ctx.emp(a.empId), me = ctx.me().id;
    const p = (a.peers || []).find((x) => x.empId === me); if (!p) return;
    const qs = A.questions(t).filter((q) => q.kind !== 'kpi');
    ctx.openModal({
      title: `Feedback for ${e.first}`, submit: 'Send feedback',
      body: `<p class="muted" style="margin-bottom:10px">Anonymous: ${esc(e.first)} sees only the combined answers of everyone asked.</p>${qs.map((q) => `<div class="ap-q"><div class="ap-q-text">${esc(q.text)}</div>${scaleRadios(t, `q-${q.id}`, '', q.text)}</div>`).join('')}
        <div class="field"><label for="pf-c">One thing ${esc(e.first)} does well, and one to grow</label><textarea class="textarea" id="pf-c" name="comment" rows="2"></textarea></div>`,
      onSubmit(d) {
        const answers = Object.fromEntries(qs.filter((q) => d[`q-${q.id}`]).map((q) => [q.id, +d[`q-${q.id}`]]));
        if (Object.keys(answers).length < qs.length) { ctx.toast('Rate every item', 'error'); return false; }
        Object.assign(p, { status: 'done', answers, comment: d.comment.trim(), at: T() });
        ctx.commit(`Thanks. Your feedback for ${e.first} is in.`);
      },
    });
  }

  // ---------- Settings ----------
  function settingsCards() {
    const ts = cfg().templates, bands = cfg().bands;
    return `<div class="card card-flush" id="appr-templates"><div class="card-head" style="padding-bottom:6px"><h3>Appraisal templates</h3><button class="btn btn-sm" data-act="ap-tpl-new">${ctx.icon('plus')}Add a template</button></div>
        <div class="table-wrap"><table><thead><tr><th>Template</th><th>Sections</th><th class="hide-sm">Scale</th><th class="hide-sm">Used for</th><th></th></tr></thead><tbody>
        ${ts.map((t) => `<tr><td><strong>${esc(t.name)}</strong></td><td class="muted">${t.sections.map((s) => `${esc(s.name)} ${s.weight}%`).join(' · ')}</td><td class="hide-sm num">${t.scale.min}–${t.scale.max}</td><td class="hide-sm muted">${[t.depts?.length ? t.depts.map((d) => ctx.dept(d)?.name).join(', ') : '', t.people?.length ? `${t.people.length} people` : ''].filter(Boolean).join(' · ') || 'Cycle default'}</td>
          <td><div class="row-actions"><button class="btn btn-sm" data-act="ap-tpl-edit" data-id="${t.id}">Edit</button>${ts.length > 1 ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="ap-tpl-del" data-id="${t.id}" aria-label="Remove ${esc(t.name)}">${ctx.icon('trash')}</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div></div>
      <div class="card" id="appr-bands"><div class="card-head"><h3>Grade bands</h3><span class="hint">On the 5-point final score</span></div>
        <div class="table-wrap"><table class="policy"><thead><tr><th>Grade</th><th>Name</th><th class="r">From score</th><th class="r">Guideline increment %</th><th class="r">Guideline bonus (months)</th></tr></thead><tbody>
        ${bands.map((b, i) => `<tr><td><strong>${esc(b.code)}</strong></td><td><input class="input" data-band="${i}" data-f="label" value="${esc(b.label)}" aria-label="Grade ${esc(b.code)} name"></td><td class="r"><input class="input num" data-band="${i}" data-f="min" type="number" min="0" max="5" step="0.05" value="${b.min}" style="width:80px" aria-label="Grade ${esc(b.code)} from score"></td>
          <td class="r"><input class="input num" data-band="${i}" data-f="inc" type="number" min="0" max="50" step="0.5" value="${b.inc}" style="width:80px" aria-label="Grade ${esc(b.code)} increment"></td><td class="r"><input class="input num" data-band="${i}" data-f="bonus" type="number" min="0" max="12" step="0.25" value="${b.bonus}" style="width:80px" aria-label="Grade ${esc(b.code)} bonus months"></td></tr>`).join('')}</tbody></table></div>
        <p class="disclaimer">${ctx.icon('pin')}<span>Guidelines prefill managers’ recommendations; HR approves the final numbers. Increments and bonuses are company policy.</span></p></div>`;
  }
  function bindSettings() {
    ctx.$$('[data-band]').forEach((el) => el.addEventListener('change', () => {
      const b = cfg().bands[+el.dataset.band]; const f = el.dataset.f;
      b[f] = f === 'label' ? el.value.trim() || b.label : Math.max(0, +el.value || 0);
      ctx.commit('Grade bands saved');
    }));
  }
  function editTemplate(id) {
    const orig = id ? cfg().templates.find((t) => t.id === id) : null;
    const t = JSON.parse(JSON.stringify(orig || { ...A.defaultTemplate(), id: U.uid('tpl'), name: 'New template', depts: [], people: [] }));
    const draw = () => {
      const box = ctx.$('#tpl-ed'); if (!box) return;
      box.innerHTML = t.sections.map((s, si) => `<fieldset class="ap-sec"><legend><input class="input" data-s="${si}" data-f="name" value="${esc(s.name)}" aria-label="Section name"></legend>
        <div class="tpl-sec-meta"><label>Type <select class="select" data-s="${si}" data-f="kind">${[['kpi', 'KPIs'], ['competency', 'Competencies'], ['value', 'Values']].map(([k, l]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Weight % <input class="input num" data-s="${si}" data-f="weight" type="number" min="0" max="100" value="${s.weight}" style="width:70px"></label><button type="button" class="btn btn-sm btn-ghost" data-sdel="${si}">Remove section</button></div>
        ${s.questions.map((q, qi) => `<div class="tpl-q"><input class="input" data-s="${si}" data-q="${qi}" data-f="text" value="${esc(q.text)}" aria-label="Question"><input class="input num" data-s="${si}" data-q="${qi}" data-f="weight" type="number" min="0.5" max="5" step="0.5" value="${q.weight}" style="width:64px" aria-label="Question weight"><label class="check lt-small"><input type="checkbox" data-s="${si}" data-q="${qi}" data-f="comment" ${q.comment ? 'checked' : ''}><span>Comment</span></label><button type="button" class="btn btn-sm btn-icon btn-ghost" data-qdel="${si}:${qi}" aria-label="Remove question">${ctx.icon('trash')}</button></div>`).join('')}
        <button type="button" class="btn btn-sm" data-qadd="${si}">${ctx.icon('plus')}Question</button></fieldset>`).join('') + `<button type="button" class="btn btn-sm" data-sadd>${ctx.icon('plus')}Section</button><p class="faint" id="tpl-sum">Section weights total ${t.sections.reduce((x, s) => x + (+s.weight || 0), 0)}%.</p>`;
    };
    const pull = () => ctx.$$('#tpl-ed [data-s]').forEach((el) => {
      const s = t.sections[+el.dataset.s]; if (!s) return;
      const o = el.dataset.q != null ? s.questions[+el.dataset.q] : s, f = el.dataset.f;
      o[f] = el.type === 'checkbox' ? el.checked : ['weight'].includes(f) ? Math.max(0, +el.value || 0) : el.value;
    });
    ctx.openModal({
      title: orig ? `Edit ${orig.name}` : 'New appraisal template', size: 'lg', submit: 'Save template',
      body: `<div class="form-grid"><div class="field full"><label for="tp-name">Name</label><input class="input" id="tp-name" name="name" required value="${esc(t.name)}"></div>
        <div class="field"><label for="tp-min">Rating scale from</label><input class="input num" id="tp-min" name="min" type="number" min="0" max="5" value="${t.scale.min}"></div>
        <div class="field"><label for="tp-max">to</label><input class="input num" id="tp-max" name="max" type="number" min="2" max="10" value="${t.scale.max}"></div>
        <div class="field full"><span class="label-like">Use for departments (optional)</span><div class="an-depts">${st().departments.map((d) => `<label class="check"><input type="checkbox" data-tdept value="${d.id}" ${t.depts?.includes(d.id) ? 'checked' : ''}><span>${esc(d.name)}</span></label>`).join('')}</div></div>
        <div class="field full"><label for="tp-people">Use for these people (optional)</label><select class="select" id="tp-people" multiple size="4">${ctx.activeEmployees().map((e) => `<option value="${e.id}" ${t.people?.includes(e.id) ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select><span class="field-hint">A person’s template wins over their department’s, which wins over the cycle’s.</span></div></div>
        <div id="tpl-ed" class="tpl-ed"></div>`,
      onSubmit(d) {
        pull();
        const total = t.sections.reduce((x, s) => x + (+s.weight || 0), 0);
        if (!t.sections.length || t.sections.some((s) => !s.questions.length)) { ctx.toast('Every section needs at least one question', 'error'); return false; }
        if (Math.abs(total - 100) > 0.01) { ctx.toast(`Section weights add up to ${total}%. Make them 100%.`, 'error'); return false; }
        const min = Math.round(+d.min), max = Math.round(+d.max);
        if (!(max > min)) { ctx.toast('The scale needs a higher top than bottom', 'error'); return false; }
        Object.assign(t, { name: d.name.trim(), scale: { min, max, labels: min === 1 && max === 5 ? [...A.SCALE_1_5.labels] : [] }, depts: ctx.$$('[data-tdept]:checked').map((x) => x.value), people: [...ctx.$('#tp-people').selectedOptions].map((o) => o.value) });
        t.sections.forEach((s, i) => { s.id = s.id || U.uid('s'); s.questions.forEach((q) => { q.id = q.id || U.uid('q'); q.text = q.text.trim() || 'Untitled'; }); if (!s.name.trim()) s.name = `Section ${i + 1}`; });
        cfg().templates = orig ? cfg().templates.map((x) => (x.id === t.id ? t : x)) : [...cfg().templates, t];
        ctx.commit('Template saved');
      },
    });
    draw();
    ctx.$('#tpl-ed').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-qadd],[data-qdel],[data-sadd],[data-sdel]'); if (!b) return;
      pull();
      if (b.dataset.qadd != null) t.sections[+b.dataset.qadd].questions.push({ id: '', text: 'New question', weight: 1, comment: true });
      if (b.dataset.qdel) { const [si, qi] = b.dataset.qdel.split(':').map(Number); t.sections[si].questions.splice(qi, 1); }
      if (b.dataset.sadd != null) t.sections.push({ id: '', name: 'New section', kind: 'competency', weight: 0, questions: [{ id: '', text: 'New question', weight: 1, comment: true }] });
      if (b.dataset.sdel != null) t.sections.splice(+b.dataset.sdel, 1);
      draw();
    });
    ctx.$('#tpl-ed').addEventListener('change', () => { pull(); const s = ctx.$('#tpl-sum'); if (s) s.textContent = `Section weights total ${t.sections.reduce((x, y) => x + (+y.weight || 0), 0)}%.`; });
  }

  // ---------- Reminders and insights ----------
  function runReminders() {
    const c = current(); if (!c || c.status !== 'Open') return;
    const week = Math.floor((U.parse(T()) - U.parse('2020-01-06')) / 6048e5);
    // Self-reviews are reminded by the daily reminders in js/notify.js; this covers the manager and HR steps.
    reviews().filter((a) => a.cycleId === c.id && a.stage !== 'self' && A.overdue(a, c, T()) && ctx.emp(a.empId)).forEach((a) => {
      const to = owner(a); if (!to) return;
      notify('appraisal.overdue', { who: nameOf(a.empId), self: to === a.empId, step: A.STAGES[a.stage].toLowerCase(), date: A.dueFor(a.stage, c), cycle: c.name, href: to === hrId() && a.stage === 'hr' ? '#performance' : '#my-appraisal' }, to, { from: 'system', self: true, key: `apov:${a.id}:${a.stage}:${week}` });
    });
  }
  function insights() {
    const out = [], c = current(); if (!c) return out;
    if (ctx.role() === 'employee') {
      const e = ctx.me(), a = reviews().find((x) => x.empId === e.id && x.cycleId === c.id);
      if (a?.stage === 'self') out.push({ tone: A.overdue(a, c, T()) ? 'bad' : 'warn', icon: 'trend', title: A.overdue(a, c, T()) ? 'Your self-review is overdue' : `Your ${c.name} self-review is due ${fmt(c.selfDue)}`, detail: 'Rate yourself on each item and add a comment.', action: { label: 'Start', act: 'ap-self', id: a.id }, prio: 3 });
      const team = reviews().filter((x) => x.cycleId === c.id && ((x.stage === 'l1' && l1Of(x) === e.id) || (x.stage === 'l2' && l2Of(x) === e.id)));
      if (team.length) out.push({ tone: 'warn', icon: 'trend', title: `${team.length} appraisal${team.length === 1 ? '' : 's'} to score`, detail: team.slice(0, 3).map((x) => firstOf(x.empId)).join(', '), action: { label: 'Score', href: '#my-appraisal' }, prio: 3 });
      const asks = reviews().filter((x) => x.cycleId === c.id && (x.peers || []).some((p) => p.empId === e.id && p.status === 'requested'));
      if (asks.length) out.push({ tone: 'info', icon: 'people', title: `${asks.length} colleague${asks.length === 1 ? '' : 's'} asked for your feedback`, detail: asks.map((x) => firstOf(x.empId)).join(', '), action: { label: 'Give feedback', href: '#my-appraisal' }, prio: 2 });
    }
    if (ctx.role() === 'admin') {
      const hr = reviews().filter((x) => x.cycleId === c.id && x.stage === 'hr');
      if (hr.length) out.push({ tone: 'warn', icon: 'trend', title: `${hr.length} appraisal${hr.length === 1 ? '' : 's'} waiting for HR final`, detail: hr.slice(0, 3).map((x) => firstOf(x.empId)).join(', '), action: { label: 'Review', href: '#performance' }, prio: 2 });
    }
    return out;
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.performance = adminView;
    ctx.AFTER.performance = () => {
      ctx.$('#ap-cycle')?.addEventListener('change', (ev) => { ui.cycle = ev.target.value; ctx.render(); });
      ctx.$('#ap-dept')?.addEventListener('change', (ev) => { ui.dept = ev.target.value; ctx.render(); });
    };
    ctx.VIEWS['my-appraisal'] = myView;
    Object.assign(ctx.ACTIONS, {
      'ap-launch': () => launch(),
      'ap-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'ap-stage': (_, v) => { ui.stage = v; ctx.render(); },
      'ap-open': (id) => openAppraisal(id),
      'ap-self': (id) => scoreForm(id, 'self'),
      'ap-l1': (id) => scoreForm(id, 'l1'),
      'ap-l2': (id) => l2Review(id),
      'ap-draft': (id) => {
        const a = reviews().find((x) => x.id === id), form = ctx.$('#overlay-root form');
        const d = Object.fromEntries(new FormData(form).entries());
        a.self = { ...(a.self || {}), scores: read(tplFor(a), d), comment: (d.comment || '').trim(), draftAt: new Date().toISOString() };
        sync(a); ctx.closeOverlay(); ctx.commit('Draft saved. Submit when you’re ready.');
      },
      'ap-final': (id) => finalApprove(id),
      'ap-back': (id) => {
        const a = reviews().find((x) => x.id === id), note = ctx.$('#hr-note')?.value.trim();
        if (!note) { ctx.toast('Add a note so the manager knows what to change', 'error'); ctx.$('#hr-note')?.focus(); return; }
        a.stage = 'l1'; a.hr = { by: actor(), at: T(), note, back: true }; sync(a);
        notify('appraisal.toscore', { who: nameOf(a.empId), cycle: a.cycle, note, href: '#my-appraisal' }, l1Of(a));
        ctx.closeOverlay(); ctx.commit(`Sent back to ${firstOf(l1Of(a))}`);
      },
      'ap-remind': (id) => { const a = reviews().find((x) => x.id === id), c2 = cycleOf(a.cycleId); notify('appraisal.overdue', { who: nameOf(a.empId), self: owner(a) === a.empId, step: A.STAGES[a.stage].toLowerCase(), date: A.dueFor(a.stage, c2), cycle: c2.name, href: '#my-appraisal' }, owner(a), { from: actor() }); ctx.closeOverlay(); ctx.commit(`Reminder sent to ${firstOf(owner(a))}`); },
      'ap-remind-all': () => { const c2 = current(); const late = reviews().filter((a) => a.cycleId === c2.id && A.overdue(a, c2, T())); late.forEach((a) => notify('appraisal.overdue', { who: nameOf(a.empId), self: owner(a) === a.empId, step: A.STAGES[a.stage].toLowerCase(), date: A.dueFor(a.stage, c2), cycle: c2.name, href: '#my-appraisal' }, owner(a), { from: actor() })); ctx.commit(`Reminded ${late.length} people`); },
      'ap-csv': () => reportCSV(),
      'ap-my-self': () => { const c = current(), a = c && reviews().find((x) => x.empId === ctx.me()?.id && x.cycleId === c.id); if (a?.stage === 'self') scoreForm(a.id, 'self'); else if (a) openAppraisal(a.id); else ctx.toast('No review cycle is open for you'); },
      'ap-goal-new': () => goalForm(),
      'ap-checkin': (id) => checkin(id),
      'ap-peers': (id) => askPeers(id),
      'ap-give': (id) => givePeer(id),
      'ap-tpl-new': () => editTemplate(''),
      'ap-tpl-edit': (id) => editTemplate(id),
      'ap-tpl-del': (id) => { cfg().templates = cfg().templates.filter((t) => t.id !== id); ctx.commit('Template removed'); },
    });
    applyDue();
    const teamCount = (id) => { const c = current(); return c ? reviews().filter((x) => x.cycleId === c.id && ((x.stage === 'l1' && l1Of(x) === id) || (x.stage === 'l2' && l2Of(x) === id))).length : 0; };
    const badge = (id) => { const c = current(); if (!c) return 0; if (id === 'performance') return reviews().filter((x) => x.cycleId === c.id && x.stage === 'hr').length; const me = ctx.me()?.id; return teamCount(me) + reviews().filter((x) => x.cycleId === c.id && (x.peers || []).some((p) => p.empId === me && p.status === 'requested')).length; };
    return { badge, teamCount, salaryFor, bonusFor, payNote, markBonusPaid, applyDue, addParticipant, settingsCards, bindSettings, runReminders, insights, current, sync };
  }

  return { install };
})();
