// Recruitment: job requisitions with approval, job post templates, the public careers page (a shareable link per
// company, no sign-in) with an application form, interviews with interviewers, conflict checks and scorecards,
// offer letters generated from the candidate, hiring analytics, and a stub for posting to job boards. The rules
// live in js/talent-rules.js (AllurusTalentRules).
window.AllurusRecruit = (function () {
  'use strict';
  const R = window.AllurusTalentRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const cfg = () => st().settings.recruit;
  const reqs = () => (st().requisitions = st().requisitions || []);
  const emp = (id) => ctx.emp(id);
  const firstOf = (id) => emp(id)?.first || '—';
  const job = (id) => st().jobs.find((j) => j.id === id);
  const cand = (id) => st().candidates.find((c) => c.id === id);
  const fmt = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? U.fmtDate(d, o) : '—');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const long = (d) => (d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const notify = (type, data, to, opts) => ctx.notify?.event(type, data, to, opts);
  const LR = () => window.AllurusLeaveRules;
  const ui = { tab: 'pipeline', from: '', to: '' };
  const interviews = () => st().candidates.flatMap((c) => (c.interviews || []).map((iv) => ({ ...iv, candId: c.id })));

  // ---------- Job boards (integration stub) ----------
  /*
   * Posting to job boards needs a server and an agreement with each board. FORMAT: verify before production.
   *  - Indeed: an XML job feed that Indeed crawls, or the Indeed Job Sync API for approved partners (OAuth).
   *  - MyFutureJobs (PERKESO): employers post on the MyFutureJobs portal; check with PERKESO whether a bulk upload
   *    or API is available to your company.
   * Until then Allurus prepares the job text for copying into each portal.
   */
  const BOARDS = { indeed: 'Indeed', myfuturejobs: 'MyFutureJobs (PERKESO)', jobstreet: 'JobStreet' };
  let boardTransport = null;
  async function postToJobBoard(board, jobPost) {
    if (typeof boardTransport !== 'function') return { ok: false, connected: false, message: `${BOARDS[board] || board} is not connected yet. Copy the job text into the portal for now.` };
    return boardTransport(board, jobPost);
  }

  // ---------- Job text ----------
  const tplOf = (id) => (cfg().templates || []).find((t) => t.id === id);
  function jobText(j) {
    const d = j.description || {}, sal = j.salaryMin ? `RM ${Number(j.salaryMin).toLocaleString('en-MY')}${j.salaryMax ? `–${Number(j.salaryMax).toLocaleString('en-MY')}` : ''} a month` : '';
    return [`${j.title} (${j.type}, ${j.location})`, sal, '', d.intro, '', 'What you will do', d.responsibilities, '', 'What you bring', d.requirements, '', 'What we offer', d.benefits].filter((x) => x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  const list = (txt) => `<ul>${String(txt || '').split('\n').map((x) => x.replace(/^[-•]\s*/, '').trim()).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

  // ---------- Requisitions ----------
  function requisitionForm(id = '') {
    const r = id ? reqs().find((x) => x.id === id) : { dept: ctx.me()?.dept || st().departments[0].id, type: 'Full-time', headcount: 1, reason: 'New role' };
    const mine = ctx.role() !== 'admin';
    ctx.openModal({
      title: 'Request a new hire', submit: 'Send for approval',
      body: `<div class="form-grid"><div class="field full"><label for="rq-title">Job title</label><input class="input" id="rq-title" name="title" required value="${esc(r.title || '')}"></div>
        <div class="field"><label for="rq-dept">Department</label><select class="select" id="rq-dept" name="dept">${st().departments.map((d) => `<option value="${d.id}" ${r.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="rq-type">Type</label><select class="select" id="rq-type" name="type">${['Full-time', 'Part-time', 'Contract', 'Intern'].map((t) => `<option ${r.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="rq-loc">Location</label><input class="input" id="rq-loc" name="location" required value="${esc(r.location || st().settings.office || '')}"></div>
        <div class="field"><label for="rq-hc">Headcount</label><input class="input num" id="rq-hc" name="headcount" type="number" min="1" max="50" value="${r.headcount}"></div>
        <div class="field"><label for="rq-min">Salary from (RM a month)</label><input class="input num" id="rq-min" name="salaryMin" type="number" min="0" step="100" value="${r.salaryMin || ''}"></div>
        <div class="field"><label for="rq-max">to</label><input class="input num" id="rq-max" name="salaryMax" type="number" min="0" step="100" value="${r.salaryMax || ''}"></div>
        <div class="field"><label for="rq-reason">Reason</label><select class="select" id="rq-reason" name="reason">${['New role', 'Replacement', 'Growth in workload', 'Project'].map((t) => `<option ${r.reason === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="rq-tpl">Job post template</label><select class="select" id="rq-tpl" name="templateId">${(cfg().templates || []).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field full"><label for="rq-why">Why this hire is needed</label><textarea class="textarea" id="rq-why" name="justification" rows="3" required>${esc(r.justification || '')}</textarea></div></div>
        <p class="faint">Goes to ${mine ? 'your department’s approvers, then HR' : 'the department’s approvers, then HR'}. When it is approved, the role opens and can be posted.</p>`,
      onSubmit(d) {
        if (d.salaryMax && +d.salaryMax < +d.salaryMin) { ctx.toast('The top of the range is below the bottom', 'error'); return false; }
        const by = actor(), lv = st().settings.leave;
        const chain = LR().buildChain({ applicant: by, chain: lv.chains?.[d.dept], hr: lv.hr, hrBackup: lv.hrBackup });
        const x = { id: U.uid('rq'), title: d.title.trim(), dept: d.dept, type: d.type, location: d.location.trim(), headcount: Math.max(1, +d.headcount || 1), salaryMin: +d.salaryMin || 0, salaryMax: +d.salaryMax || 0, reason: d.reason, templateId: d.templateId, justification: d.justification.trim(), by, at: T(), chain, status: 'Pending', jobId: '' };
        reqs().push(x);
        const next = LR().nextStep(chain);
        if (next) notify('request.submitted', { who: ctx.fullName(emp(by)) || 'HR', kind: 'requisition', summary: x.title, href: next.approver === lv.hr ? '#recruitment' : '#my-approvals' }, next.approver, { from: by });
        ui.tab = 'requisitions';
        ctx.commit('Sent for approval', `Hiring request for ${x.title} raised`);
      },
    });
  }
  const canAct = (r, id) => { const s = LR().nextStep(r.chain); return r.status === 'Pending' && s && (LR().canAct(s, id, () => false) || (ctx.role() === 'admin' && s.level === 'Final')); };
  function decide(id, approve) {
    const r = reqs().find((x) => x.id === id), note = ctx.$('#rq-note')?.value.trim() || '';
    if (!approve && !note) { ctx.toast('Say why, so the requester knows', 'error'); ctx.$('#rq-note')?.focus(); return; }
    const res = LR().decide(r.chain, { by: actor(), approve, note, at: T() });
    r.chain = res.chain || r.chain;
    const next = LR().nextStep(r.chain);
    if (!approve) r.status = 'Rejected';
    else if (!next) {
      r.status = 'Approved';
      const t = tplOf(r.templateId) || cfg().templates[0];
      const j = { id: U.uid('j'), title: r.title, dept: r.dept, location: r.location, type: r.type, opened: T(), reqId: r.id, headcount: r.headcount, salaryMin: r.salaryMin, salaryMax: r.salaryMax, published: false, closes: U.addDays(T(), 30), description: { intro: t.intro.replace('{{job.title}}', r.title), responsibilities: t.responsibilities, requirements: t.requirements, benefits: t.benefits }, boards: {} };
      st().jobs.push(j); r.jobId = j.id;
    } else notify('request.step', { who: ctx.fullName(emp(r.by)), kind: 'requisition', summary: r.title, by: ctx.fullName(emp(actor())), href: '#my-approvals' }, next.approver);
    if (r.status !== 'Pending') notify(r.status === 'Approved' ? 'request.approved' : 'request.rejected', { kind: 'requisition', summary: r.title, by: ctx.fullName(emp(actor())) || 'HR', note, href: '#recruitment' }, r.by);
    ctx.closeOverlay();
    ctx.commit(r.status === 'Approved' ? `${r.title} approved; the role is open` : r.status === 'Rejected' ? 'Request declined' : 'Approved; sent to the next approver');
  }
  function reviewReq(id) {
    const r = reqs().find((x) => x.id === id), act = canAct(r, actor());
    ctx.openModal({
      title: `Hiring request · ${r.title}`, submit: null,
      body: `<dl class="kv"><dt>Department</dt><dd>${esc(ctx.dept(r.dept)?.name || '')}</dd><dt>Type</dt><dd>${esc(r.type)}, ${esc(r.location)}</dd><dt>Headcount</dt><dd>${r.headcount}</dd><dt>Salary</dt><dd>${r.salaryMin ? `RM ${r.salaryMin.toLocaleString('en-MY')}–${(r.salaryMax || r.salaryMin).toLocaleString('en-MY')} a month` : '—'}</dd><dt>Reason</dt><dd>${esc(r.reason)}</dd><dt>Raised by</dt><dd>${esc(ctx.fullName(emp(r.by)) || 'HR')}, ${fmt(r.at)}</dd></dl>
        <p style="margin-top:10px">${esc(r.justification)}</p>
        <h4 class="lv-h">Approvals</h4><ol class="audit-list">${r.chain.map((s) => `<li><div><strong>${esc(s.label)}</strong> · ${esc(firstOf(s.approver))} <span class="pill ${s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'bad' : ''}">${s.status}</span></div>${s.note ? `<div class="faint">“${esc(s.note)}”</div>` : ''}</li>`).join('')}</ol>
        ${act ? `<div class="field" style="margin-top:12px"><label for="rq-note">Note (needed to decline)</label><input class="input" id="rq-note"></div><div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn" data-act="rc-req-decide" data-id="${r.id}" data-v="no">Decline</button><button type="button" class="btn btn-primary" data-act="rc-req-decide" data-id="${r.id}" data-v="yes">${icon('check')}Approve</button></div>` : r.jobId ? `<div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn" data-act="rc-job" data-id="${r.jobId}">Open the role</button></div>` : ''}`,
    });
  }
  const reqPill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'ok', Rejected: 'bad' })[s] || ''}">${s === 'Rejected' ? 'Declined' : s}</span>`;

  // ---------- Candidates ----------
  function moveStage(c, to) {
    c.stageDates = c.stageDates || { Applied: c.applied };
    if (!c.stageDates[to]) c.stageDates[to] = T();
    c.stage = to;
    if (to === 'Hired' && !c.hiredOn) c.hiredOn = T();
  }
  function candView(id) {
    const c = cand(id); if (!c) return;
    const j = job(c.jobId), crit = cfg().criteria;
    const ivs = c.interviews || [];
    ctx.openModal({
      title: c.name, size: 'lg', submit: null,
      body: `<div class="rc-head">${ctx.avatar(c.name)}<div><div><strong>${esc(j?.title || 'Role closed')}</strong> · <span class="pill ${c.rejected ? 'bad' : 'info'}">${c.rejected ? 'Not progressing' : esc(c.stage)}</span></div><div class="faint">${esc(c.email || '')}${c.phone ? ` · ${esc(c.phone)}` : ''} · ${esc(c.source || 'Source not recorded')} · applied ${fmt(c.applied)}</div>${c.link ? `<a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.link)}</a>` : ''}</div></div>
        ${c.note ? `<p class="muted">“${esc(c.note)}”</p>` : ''}
        <ol class="rc-steps">${R.STAGES.map((s) => `<li class="${c.stageDates?.[s] ? 'done' : ''} ${c.stage === s ? 'now' : ''}"><strong>${s}</strong><small>${c.stageDates?.[s] ? fmt(c.stageDates[s], { day: 'numeric', month: 'short' }) : ''}</small></li>`).join('')}</ol>
        <div class="rc-sec-head"><h4 class="lv-h" style="margin:0">Interviews</h4><button type="button" class="btn btn-sm" data-act="rc-iv" data-id="${c.id}">${icon('calendar')}Schedule</button></div>
        ${ivs.length ? ivs.map((iv) => { const s = R.scorecardSummary(iv.scorecards, crit); return `<div class="rc-iv"><div><strong>${esc(iv.title)}</strong> · ${fmt(iv.date, { weekday: 'short', day: 'numeric', month: 'short' })} ${esc(iv.start)}–${esc(iv.end)} · ${esc(iv.mode)}${iv.where ? ` · ${esc(iv.where)}` : ''}${iv.status === 'Cancelled' ? ' <span class="tag">Cancelled</span>' : ''}</div>
          <div class="faint">${(iv.interviewers || []).map((x) => `${esc(firstOf(x))}${iv.scorecards?.[x] ? ` (${esc(iv.scorecards[x].recommend)})` : ' (no scorecard yet)'}`).join(', ')}</div>
          ${s.count ? `<div class="rc-scores">${s.byCrit.map((b) => `<span>${esc(b.criterion)} <strong>${b.avg ?? '—'}</strong></span>`).join('')}<span>Overall <strong>${s.overall}</strong></span></div>` : ''}</div>`; }).join('') : '<p class="faint">No interviews yet.</p>'}
        <div class="rc-sec-head"><h4 class="lv-h" style="margin:0">Offer</h4>${c.stage === 'Offer' || c.stage === 'Interview' ? `<button type="button" class="btn btn-sm" data-act="rc-offer" data-id="${c.id}">${icon('doc')}Offer letter</button>` : ''}</div>
        ${(c.offers || []).length ? `<ul class="hr-list">${c.offers.map((o) => `<li><div><button class="link-btn" data-act="rc-offer-view" data-id="${c.id}" data-v="${o.id}"><strong>${esc(o.subject)}</strong></button><div class="person-sub">RM ${Number(o.salary).toLocaleString('en-MY')} a month · start ${fmt(o.start)} · ${fmt(o.at)}</div></div><span class="pill ${o.status === 'Accepted' ? 'ok' : o.status === 'Declined' ? 'bad' : 'info'}">${esc(o.status)}</span></li>`).join('')}</ul>` : '<p class="faint">No offer yet.</p>'}
        <div class="ci-actions" style="justify-content:flex-end">${c.rejected ? '' : `<button type="button" class="btn btn-ghost" data-act="rc-reject" data-id="${c.id}">Not progressing</button>`}${!c.rejected && c.stage !== 'Hired' ? `<button type="button" class="btn btn-primary" data-act="rc-next" data-id="${c.id}">Move to ${R.STAGES[R.STAGES.indexOf(c.stage) + 1]}</button>` : ''}</div>`,
    });
  }
  // ---------- Interviews ----------
  function interviewForm(candId) {
    const c = cand(candId), j = job(c.jobId);
    const rooms = (st().rooms || []).filter((r) => r.active !== false);
    const options = ctx.activeEmployees().sort((a, b) => (b.dept === j?.dept) - (a.dept === j?.dept) || a.first.localeCompare(b.first));
    ctx.openModal({
      title: `Schedule an interview · ${c.name}`, submit: 'Schedule',
      body: `<div class="form-grid"><div class="field full"><label for="iv-title">Interview</label><input class="input" id="iv-title" name="title" required value="${(c.interviews || []).length ? 'Second interview' : 'First interview'}"></div>
        <div class="field"><label for="iv-date">Date</label><input class="input" id="iv-date" name="date" type="date" required min="${T()}" value="${U.addDays(T(), 2)}"></div>
        <div class="field"><label for="iv-start">From</label><input class="input" id="iv-start" name="start" type="time" required value="10:00"></div>
        <div class="field"><label for="iv-end">To</label><input class="input" id="iv-end" name="end" type="time" required value="11:00"></div>
        <div class="field"><label for="iv-mode">How</label><select class="select" id="iv-mode" name="mode">${['In person', 'Video call', 'Phone'].map((m) => `<option>${m}</option>`).join('')}</select></div>
        <div class="field full"><label for="iv-room">Room (in person) or link</label><select class="select" id="iv-room" name="room"><option value="">No room needed</option>${rooms.map((r) => `<option value="${r.id}">${esc(r.name)} (${r.capacity} seats)</option>`).join('')}</select><input class="input" name="link" placeholder="Video link (optional)" style="margin-top:6px" aria-label="Video link"></div>
        <div class="field full"><span class="label-like">Interviewers</span><div class="rc-pick">${options.map((e) => `<label class="check"><input type="checkbox" data-iv-who value="${e.id}" ${e.id === (ctx.dept(j?.dept)?.lead || '') ? 'checked' : ''}><span>${esc(ctx.fullName(e))} <span class="faint">${esc(ctx.dept(e.dept)?.name || '')}</span></span></label>`).join('')}</div></div></div>
        <div id="iv-warn" class="faint" role="status"></div>`,
      onSubmit(d) {
        const who = ctx.$$('[data-iv-who]:checked').map((x) => x.value);
        if (!who.length) { ctx.toast('Pick at least one interviewer', 'error'); return false; }
        const iv = { id: U.uid('iv'), title: d.title.trim(), date: d.date, start: d.start, end: d.end, mode: d.mode, where: '', interviewers: who, scorecards: {}, status: 'Scheduled' };
        if (!(R.toMin(d.end) > R.toMin(d.start))) { ctx.toast('The end must be after the start', 'error'); return false; }
        const clash = R.interviewConflicts(iv, interviews(), (id, day) => ctx.leave?.onLeave(id, day));
        if (clash.length && !confirm(`${clash.map((x) => `${firstOf(x.empId)}: ${x.reason}`).join('\n')}\n\nSchedule anyway?`)) return false;
        if (d.room) {
          const b = { id: U.uid('bk'), roomId: d.room, date: d.date, start: d.start, end: d.end, title: `Interview: ${c.name}`, by: actor(), people: who.length + 1, status: 'Booked', ref: iv.id };
          const p = R.bookingProblems(b, { rooms: st().rooms, bookings: st().bookings || [] });
          if (p.length) { ctx.toast(p[p.length - 1], 'error'); return false; }
          (st().bookings = st().bookings || []).push(b); iv.where = st().rooms.find((r) => r.id === d.room)?.name || ''; iv.bookingId = b.id;
        } else iv.where = d.link.trim();
        c.interviews = [...(c.interviews || []), iv];
        if (R.STAGES.indexOf(c.stage) < 2) moveStage(c, 'Interview');
        notify('interview.scheduled', { who: c.name, role: j?.title || '', date: d.date, time: d.start, href: '#my-approvals' }, who);
        ctx.commit(`Interview booked for ${fmt(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} ${d.start}`, `Interview with ${c.name} scheduled`);
        setTimeout(() => candView(c.id), 60);
      },
    });
    const warn = () => {
      const f = ctx.$('#overlay-root form'), who = ctx.$$('[data-iv-who]:checked').map((x) => x.value);
      const iv = { id: 'new', date: f.date.value, start: f.start.value, end: f.end.value, interviewers: who };
      const clash = R.interviewConflicts(iv, interviews(), (id, day) => ctx.leave?.onLeave(id, day));
      ctx.$('#iv-warn').innerHTML = clash.length ? `<span class="tag warn">Clash</span> ${clash.map((x) => `${esc(firstOf(x.empId))}: ${esc(x.reason)}`).join('; ')}` : who.length ? `${who.length} interviewer${who.length === 1 ? '' : 's'} free.` : '';
    };
    ctx.$('#overlay-root form').addEventListener('change', warn); warn();
  }
  function scorecardForm(candId, ivId) {
    const c = cand(candId), iv = c.interviews.find((x) => x.id === ivId), me = actor(), mine = iv.scorecards?.[me] || {};
    ctx.openModal({
      title: `Scorecard · ${c.name}`, submit: 'Submit scorecard',
      body: `<p class="muted">${esc(iv.title)} for ${esc(job(c.jobId)?.title || '')}, ${fmt(iv.date)}. Rate each area from 1 (weak) to 5 (excellent).</p>
        ${cfg().criteria.map((k, i) => `<div class="ap-q"><div class="ap-q-text">${esc(k)}</div><div class="ap-scale" role="radiogroup" aria-label="${esc(k)}">${[1, 2, 3, 4, 5].map((v) => `<label class="ap-rate"><input type="radio" name="s${i}" value="${v}" ${Number(mine.scores?.[k]) === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>`).join('')}
        <div class="field" style="margin-top:10px"><label for="sc-rec">Recommendation</label><select class="select" id="sc-rec" name="recommend">${['Strong yes', 'Yes', 'No', 'Strong no'].map((x) => `<option ${mine.recommend === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="field"><label for="sc-notes">Notes</label><textarea class="textarea" id="sc-notes" name="notes" rows="3">${esc(mine.notes || '')}</textarea></div>`,
      onSubmit(d) {
        const scores = Object.fromEntries(cfg().criteria.map((k, i) => [k, +d[`s${i}`] || 0]));
        if (Object.values(scores).some((x) => !x)) { ctx.toast('Rate every area', 'error'); return false; }
        iv.scorecards = { ...(iv.scorecards || {}), [me]: { scores, recommend: d.recommend, notes: d.notes.trim(), at: T() } };
        ctx.commit('Scorecard submitted. Thank you.');
      },
    });
  }
  const myScorecards = (id) => st().candidates.flatMap((c) => (c.interviews || []).filter((iv) => iv.status !== 'Cancelled' && (iv.interviewers || []).includes(id) && !iv.scorecards?.[id]).map((iv) => ({ c, iv })));

  // ---------- Offers ----------
  function offerData(c, o) {
    const j = job(c.jobId), s = st().settings, er = s.employer || {};
    return { 'candidate.name': c.name, 'candidate.first': c.name.split(' ')[0], 'job.title': j?.title || '', 'job.department': ctx.dept(j?.dept)?.name || '', 'job.location': j?.location || '', 'job.type': j?.type || '', 'offer.salary_monthly': `RM ${Number(o.salary).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`, 'offer.start_date': long(o.start), 'offer.probation_months': o.probation, 'offer.expires': long(o.expires), 'company.name': s.company, 'company.address': er.address || '', 'signatory.name': er.signatory || '', 'signatory.title': er.signatoryTitle || '', today: long(T()) };
  }
  function offerForm(candId) {
    const c = cand(candId), j = job(c.jobId), tpls = cfg().offerTemplates;
    let tpl = tpls[0], touched = false;
    ctx.openModal({
      title: `Offer letter · ${c.name}`, size: 'lg', submit: 'Save offer',
      body: `<div class="form-grid"><div class="field"><label for="of-tpl">Template</label><select class="select" id="of-tpl">${tpls.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="of-sal">Monthly salary (RM)</label><input class="input num" id="of-sal" name="salary" type="number" min="1" step="50" required value="${j?.salaryMax ? Math.round((j.salaryMin + j.salaryMax) / 2 / 50) * 50 : 5000}"></div>
        <div class="field"><label for="of-start">Start date</label><input class="input" id="of-start" name="start" type="date" required value="${U.addDays(T(), 30)}"></div>
        <div class="field"><label for="of-prob">Probation (months)</label><input class="input num" id="of-prob" name="probation" type="number" min="0" max="12" value="3"></div>
        <div class="field"><label for="of-exp">Reply by</label><input class="input" id="of-exp" name="expires" type="date" required value="${U.addDays(T(), 7)}"></div>
        <div class="field full"><label for="of-subj">Subject</label><input class="input" id="of-subj" name="subject" required></div>
        <div class="field full"><label for="of-body">Letter</label><textarea class="textarea hr-letter-body" id="of-body" name="body" rows="12" required></textarea></div></div>`,
      onSubmit(d) {
        const o = { id: U.uid('of'), templateId: tpl.id, subject: d.subject.trim(), body: d.body.trim(), salary: +d.salary, start: d.start, probation: +d.probation, expires: d.expires, at: T(), status: 'Sent', by: actor() };
        c.offers = [...(c.offers || []), o];
        if (R.STAGES.indexOf(c.stage) < 3) moveStage(c, 'Offer');
        ctx.commit(`Offer for ${c.name} saved`, `Offer letter issued to ${c.name}`);
        setTimeout(() => offerView(c.id, o.id), 60);
      },
    });
    const vals = () => { const f = ctx.$('#overlay-root form'); return { salary: f.salary.value, start: f.start.value, probation: f.probation.value, expires: f.expires.value }; };
    const draw = () => { if (touched) return; const data = offerData(c, vals()); ctx.$('#of-subj').value = AllurusHRRules.fill(tpl.subject, data); ctx.$('#of-body').value = AllurusHRRules.fill(tpl.body, data); };
    ctx.$('#of-tpl').addEventListener('change', (ev) => { tpl = tpls.find((t) => t.id === ev.target.value); touched = false; draw(); });
    ['#of-sal', '#of-start', '#of-prob', '#of-exp'].forEach((s) => ctx.$(s).addEventListener('input', draw));
    ['#of-subj', '#of-body'].forEach((s) => ctx.$(s).addEventListener('input', () => { touched = true; }));
    draw();
  }
  function offerHtml(c, o) {
    const s = st().settings, er = s.employer || {};
    return `<article class="doc letter"><header class="doc-head"><div><div class="doc-co">${esc(s.company.toUpperCase())}</div><div class="doc-sub">${esc(er.address || '')}</div></div></header>
      <p class="letter-date">${esc(long(o.at))}</p><p class="letter-to">${esc(c.name)}<br>${esc(c.email || '')}</p><p><strong>${esc(o.subject)}</strong></p>
      ${o.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
      <p class="letter-sign">Yours sincerely,<br><br><br>${esc(er.signatory || '')}<br>${esc(er.signatoryTitle || '')}<br>${esc(s.company)}</p>
      <p class="letter-ack">I accept this offer on the terms above.<br><br>Signature: ______________________ &nbsp; Date: ____________<br>${esc(c.name)}</p></article>`;
  }
  function offerView(candId, offerId) {
    const c = cand(candId), o = (c.offers || []).find((x) => x.id === offerId);
    ctx.docs.preview(o.subject, offerHtml(c, o), `Offer ${c.name}`);
    const box = ctx.$('#overlay-root .doc-actions');
    if (box && o.status === 'Sent') box.insertAdjacentHTML('beforeend', `<button type="button" class="btn" data-act="rc-offer-reply" data-id="${c.id}" data-v="${o.id}:Declined">Declined</button><button type="button" class="btn btn-ok" data-act="rc-offer-reply" data-id="${c.id}" data-v="${o.id}:Accepted">${icon('check')}Accepted</button>`);
  }

  // ---------- Views ----------
  const TABS = [['pipeline', 'Pipeline'], ['requisitions', 'Requisitions'], ['jobs', 'Jobs and careers page'], ['interviews', 'Interviews'], ['analytics', 'Analytics']];
  const careersLink = () => `${location.origin}${location.pathname}#careers/${st().session?.tenantId || 't1'}`;
  function pipeline() {
    const jf = ctx.ui?.jobFilter || 'all';
    // Closed roles drop off the board once their hires are onboarded.
    const cs = st().candidates.filter((c) => (jf === 'all' || c.jobId === jf) && !c.rejected && (job(c.jobId) || (c.stage === 'Hired' && !c.converted)));
    return `<div class="chips"><button class="chip ${jf === 'all' ? 'on' : ''}" data-act="job-filter" data-v="all">All roles <span class="n">${st().candidates.filter((c) => !c.rejected && job(c.jobId)).length}</span></button>${st().jobs.map((j) => `<button class="chip ${jf === j.id ? 'on' : ''}" data-act="job-filter" data-v="${j.id}">${esc(j.title)} <span class="n">${st().candidates.filter((c) => c.jobId === j.id && !c.rejected).length}</span></button>`).join('')}</div>
      <div class="kanban">${R.STAGES.map((s, si) => { const l = cs.filter((c) => c.stage === s); return `<div class="kcol" data-stage="${s}"><div class="kcol-head"><span>${s}</span><span class="n">${l.length}</span></div>
        ${l.map((c) => { const iv = (c.interviews || []).filter((x) => x.status !== 'Cancelled' && x.date >= T()).sort((a, b) => a.date.localeCompare(b.date))[0]; return `<div class="kcard" draggable="true" data-cand="${c.id}">
          <button type="button" class="person rc-open" data-act="rc-cand" data-id="${c.id}">${ctx.avatar(c.name, 'sm')}<div style="min-width:0;text-align:left"><div class="person-name">${esc(c.name)}</div><div class="person-sub">${esc(job(c.jobId)?.title || 'Role closed')}</div></div></button>
          <div class="kcard-foot"><span class="tag">${esc(c.source || '—')}</span><span class="faint" style="font-size:12px">${U.fmtDate(c.applied, { month: 'short', day: 'numeric' })}</span></div>
          ${iv ? `<div class="faint" style="font-size:12px">${icon('calendar')} ${fmt(iv.date, { weekday: 'short', day: 'numeric', month: 'short' })} ${esc(iv.start)}</div>` : ''}
          <div class="kcard-foot"><button class="btn btn-sm btn-icon btn-ghost" data-act="cand-move" data-id="${c.id}" data-v="-1" ${si === 0 ? 'disabled' : ''} aria-label="Move back">${icon('left')}</button>
            ${s === 'Hired' ? (c.converted ? '<span class="pill ok">Onboarded</span>' : `<button class="btn btn-sm btn-primary" data-act="cand-hire" data-id="${c.id}">${icon('userplus')}Onboard</button>`) : `<button class="btn btn-sm btn-ghost" data-act="rc-cand" data-id="${c.id}">Open</button>`}
            <button class="btn btn-sm btn-icon btn-ghost" data-act="cand-move" data-id="${c.id}" data-v="1" ${si === R.STAGES.length - 1 ? 'disabled' : ''} aria-label="Move forward">${icon('right')}</button></div></div>`; }).join('')}
        ${l.length ? '' : '<div class="empty" style="padding:16px 4px;font-size:12.5px">No candidates</div>'}</div>`; }).join('')}
        <div class="kzone" data-zone="reject" aria-hidden="true">${icon('x')}<span>Not progressing</span><small>Drop here</small></div></div>`;
  }
  function requisitionsTab() {
    const l = [...reqs()].sort((a, b) => (a.status === 'Pending') - (b.status === 'Pending') ? (b.status === 'Pending') - (a.status === 'Pending') : b.at.localeCompare(a.at));
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Role</th><th class="hide-sm">Department</th><th class="r">Headcount</th><th class="hide-sm">Raised</th><th>Status</th><th></th></tr></thead><tbody>
      ${l.map((r) => { const nx = LR().nextStep(r.chain); return `<tr class="clickable" data-act="rc-req" data-id="${r.id}"><td><strong>${esc(r.title)}</strong><div class="person-sub">${esc(r.reason)} · ${esc(r.type)}</div></td><td class="hide-sm">${ctx.deptTag(r.dept)}</td><td class="r num">${r.headcount}</td><td class="hide-sm muted">${esc(ctx.fullName(emp(r.by)) || 'HR')}, ${fmt(r.at, { day: 'numeric', month: 'short' })}</td><td>${reqPill(r.status)}${r.status === 'Pending' && nx ? `<div class="person-sub">With ${esc(firstOf(nx.approver))}</div>` : ''}</td><td><div class="row-actions"><button class="btn btn-sm ${canAct(r, actor()) ? 'btn-primary' : ''}" data-act="rc-req" data-id="${r.id}">${canAct(r, actor()) ? 'Review' : 'Open'}</button></div></td></tr>`; }).join('')}</tbody></table>
      ${l.length ? '' : '<div class="empty"><strong>No hiring requests</strong>Managers can request a hire from Approvals; HR can raise one here.</div>'}</div></div>`;
  }
  function jobsTab() {
    return `<div class="card rc-careers"><div><h3>Careers page</h3><p class="muted">A public page with your published roles and an application form. Share the link on your website and social media.</p><div class="rc-link"><code>${esc(careersLink())}</code><button class="btn btn-sm" data-act="rc-copy-link">${icon('doc')}Copy link</button><a class="btn btn-sm" href="#careers/${esc(st().session?.tenantId || 't1')}" target="_blank" rel="noopener">Open</a></div></div></div>
      <div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Role</th><th class="hide-sm">Location</th><th>Careers page</th><th class="r">Candidates</th><th class="hide-sm">Closes</th><th></th></tr></thead><tbody>
      ${st().jobs.map((j) => `<tr class="clickable" data-act="rc-job" data-id="${j.id}"><td><strong>${esc(j.title)}</strong><div class="person-sub">${esc(ctx.dept(j.dept)?.name || '')} · ${esc(j.type)}</div></td><td class="hide-sm">${esc(j.location)}</td><td>${j.published ? '<span class="pill ok">Published</span>' : '<span class="pill">Not published</span>'}</td><td class="r num">${st().candidates.filter((c) => c.jobId === j.id).length}</td><td class="hide-sm muted">${fmt(j.closes)}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="rc-job" data-id="${j.id}">Edit post</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function jobForm(id) {
    const j = job(id), d = j.description || {};
    ctx.openModal({
      title: `Job post · ${j.title}`, size: 'lg', submit: 'Save post',
      body: `<div class="form-grid"><div class="field"><label for="jp-tpl">Start from template</label><select class="select" id="jp-tpl"><option value="">Keep the current text</option>${cfg().templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="jp-close">Applications close</label><input class="input" id="jp-close" name="closes" type="date" value="${j.closes || U.addDays(T(), 30)}"></div>
        <div class="field"><label for="jp-min">Salary from (RM a month, optional)</label><input class="input num" id="jp-min" name="salaryMin" type="number" min="0" step="100" value="${j.salaryMin || ''}"></div>
        <div class="field"><label for="jp-max">to</label><input class="input num" id="jp-max" name="salaryMax" type="number" min="0" step="100" value="${j.salaryMax || ''}"></div>
        <div class="field full"><label for="jp-intro">About the role</label><textarea class="textarea" id="jp-intro" name="intro" rows="3">${esc(d.intro || '')}</textarea></div>
        <div class="field full"><label for="jp-resp">What you will do (one per line)</label><textarea class="textarea" id="jp-resp" name="responsibilities" rows="4">${esc(d.responsibilities || '')}</textarea></div>
        <div class="field full"><label for="jp-req">What you bring (one per line)</label><textarea class="textarea" id="jp-req" name="requirements" rows="4">${esc(d.requirements || '')}</textarea></div>
        <div class="field full"><label for="jp-ben">What we offer (one per line)</label><textarea class="textarea" id="jp-ben" name="benefits" rows="3">${esc(d.benefits || '')}</textarea></div>
        <label class="check field full"><input type="checkbox" name="published" ${j.published ? 'checked' : ''}><span>Show on the careers page</span></label></div>
        <h4 class="lv-h">Job boards</h4><div class="rc-boards">${Object.entries(BOARDS).map(([k, n]) => `<div class="rc-board"><span><strong>${esc(n)}</strong><span class="faint"> · not connected</span></span><button type="button" class="btn btn-sm" data-act="rc-board" data-id="${j.id}" data-v="${k}">Post</button></div>`).join('')}<button type="button" class="btn btn-sm" data-act="rc-copy-job" data-id="${j.id}">${icon('doc')}Copy job text</button></div>`,
      onSubmit(f) {
        if (f.published === 'on' && !f.intro.trim()) { ctx.toast('Write a short “About the role” before publishing', 'error'); return false; }
        Object.assign(j, { closes: f.closes, salaryMin: +f.salaryMin || 0, salaryMax: +f.salaryMax || 0, published: f.published === 'on', description: { intro: f.intro.trim(), responsibilities: f.responsibilities.trim(), requirements: f.requirements.trim(), benefits: f.benefits.trim() } });
        ctx.commit(j.published ? `${j.title} is on the careers page` : 'Job post saved');
      },
    });
    ctx.$('#jp-tpl').addEventListener('change', (ev) => { const t = tplOf(ev.target.value); if (!t) return; ctx.$('#jp-intro').value = t.intro.replace('{{job.title}}', j.title); ctx.$('#jp-resp').value = t.responsibilities; ctx.$('#jp-req').value = t.requirements; ctx.$('#jp-ben').value = t.benefits; });
  }
  function interviewsTab() {
    const l = interviews().filter((iv) => iv.status !== 'Cancelled').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const up = l.filter((x) => x.date >= T()), past = l.filter((x) => x.date < T()).reverse();
    const row = (iv) => { const c = cand(iv.candId), s = R.scorecardSummary(iv.scorecards, cfg().criteria), missing = (iv.interviewers || []).filter((x) => !iv.scorecards?.[x]); return `<tr class="clickable" data-act="rc-cand" data-id="${c.id}"><td class="num">${fmt(iv.date, { weekday: 'short', day: 'numeric', month: 'short' })}<div class="person-sub">${esc(iv.start)}–${esc(iv.end)}</div></td><td><strong>${esc(c.name)}</strong><div class="person-sub">${esc(job(c.jobId)?.title || '')} · ${esc(iv.title)}</div></td><td class="hide-sm">${esc(iv.mode)}${iv.where ? `<div class="person-sub">${esc(iv.where)}</div>` : ''}</td><td>${(iv.interviewers || []).map((x) => esc(firstOf(x))).join(', ')}</td><td>${s.count ? `<strong>${s.overall}</strong>/5${missing.length ? ` <span class="faint">(${missing.length} to come)</span>` : ''}` : iv.date <= T() ? '<span class="tag warn">Scorecards due</span>' : '<span class="faint">—</span>'}</td></tr>`; };
    const table = (rows, empty) => `<div class="table-wrap"><table><thead><tr><th>When</th><th>Candidate</th><th class="hide-sm">Where</th><th>Interviewers</th><th>Score</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>${rows.length ? '' : `<div class="empty"><strong>${empty}</strong></div>`}</div>`;
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Coming up</h3><span class="hint">${up.length}</span></div>${table(up, 'No interviews booked')}</div>
      <div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Recent</h3></div>${table(past.slice(0, 15), 'None yet')}</div>`;
  }
  function analyticsTab() {
    if (!ui.from) { ui.from = U.addDays(T(), -180); ui.to = T(); }
    const a = R.hiringAnalytics(st().candidates, { from: ui.from, to: ui.to });
    const max = Math.max(1, ...a.funnel.map((f) => f.count));
    return `<div class="rp-filters"><div class="field"><label for="ra-from">Applied from</label><input class="input" type="date" id="ra-from" value="${ui.from}"></div><div class="field"><label for="ra-to">to</label><input class="input" type="date" id="ra-to" value="${ui.to}"></div></div>
      <div class="grid g-4 keep-2"><div class="card kpi"><div class="kpi-label">Candidates</div><div class="kpi-value">${a.total}</div></div><div class="card kpi"><div class="kpi-label">Hires</div><div class="kpi-value">${a.hires}</div></div>
        <div class="card kpi"><div class="kpi-label">Average time to hire</div><div class="kpi-value">${a.timeToHire.avg == null ? '—' : `${Math.round(a.timeToHire.avg)} days`}</div><div class="kpi-foot">${a.timeToHire.median == null ? 'No hires in this period' : `Median ${a.timeToHire.median} · ${a.timeToHire.min}–${a.timeToHire.max} days`}</div></div>
        <div class="card kpi"><div class="kpi-label">Offer to hire</div><div class="kpi-value">${a.funnel[4].fromPrev}%</div></div></div>
      <div class="grid g-2"><div class="card"><div class="card-head"><h3>Stage conversion</h3></div>${a.funnel.map((f) => `<div class="hbar" style="grid-template-columns:90px minmax(0,1fr) 110px"><span>${f.stage}</span><div class="hbar-track"><i style="width:${(f.count / max) * 100}%;background:var(--brand)"></i></div><span class="num r">${f.count}${f.stage === 'Applied' ? '' : ` · ${f.fromPrev}%`}</span></div>`).join('')}<p class="faint" style="margin-top:8px">% of the candidates who reached the stage before.</p></div>
        <div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Sources</h3></div><div class="table-wrap"><table><thead><tr><th>Source</th><th class="r">Candidates</th><th class="r">Hires</th><th class="r">Hire rate</th></tr></thead><tbody>${a.bySource.map((s) => `<tr><td>${esc(s.source)}</td><td class="r num">${s.candidates}</td><td class="r num">${s.hires}</td><td class="r num">${s.hireRate}%</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }
  function view() {
    const pending = reqs().filter((r) => r.status === 'Pending').length;
    return `<div class="page-head"><div><div class="eyebrow">Talent</div><h1>Recruitment</h1><p class="sub">${st().jobs.length} open roles and ${st().candidates.filter((c) => c.stage !== 'Hired' && !c.rejected).length} active candidates.</p></div>
        <div class="actions"><button class="btn" data-act="rc-req-new">${icon('briefcase')}Request a hire</button><button class="btn" data-act="add-job">New role</button><button class="btn btn-primary" data-act="add-cand">${icon('plus')}Add candidate</button></div></div>
      <div class="seg rc-tabs" role="tablist" aria-label="Recruitment">${TABS.map(([k, l]) => `<button role="tab" data-act="rc-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}${k === 'requisitions' && pending ? ` <span class="faint">${pending}</span>` : ''}</button>`).join('')}</div>
      ${ui.tab === 'requisitions' ? requisitionsTab() : ui.tab === 'jobs' ? jobsTab() : ui.tab === 'interviews' ? interviewsTab() : ui.tab === 'analytics' ? analyticsTab() : pipeline()}`;
  }
  function bind() {
    ctx.$('#ra-from')?.addEventListener('change', (ev) => { ui.from = ev.target.value; ctx.render(); });
    ctx.$('#ra-to')?.addEventListener('change', (ev) => { ui.to = ev.target.value; ctx.render(); });
    let dragId = null;
    ctx.$$('.kcard').forEach((c) => { c.addEventListener('dragstart', (ev) => { dragId = c.dataset.cand; c.classList.add('dragging'); ctx.$('.kanban')?.classList.add('is-dragging'); ev.dataTransfer.setData('text/plain', dragId); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); ctx.$('.kanban')?.classList.remove('is-dragging'); }); });
    // Dropping on "Not progressing" does what the candidate's own Not progressing button does (keyboard: Open → Not progressing).
    const zone = ctx.$('.kzone[data-zone=reject]');
    if (zone) {
      zone.addEventListener('dragover', (ev) => { ev.preventDefault(); zone.classList.add('drop'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drop'));
      zone.addEventListener('drop', (ev) => { ev.preventDefault(); zone.classList.remove('drop'); const id = dragId || ev.dataTransfer.getData('text/plain'); if (cand(id)) ctx.ACTIONS['rc-reject'](id); });
    }
    ctx.$$('.kcol').forEach((col) => {
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (ev) => { ev.preventDefault(); col.classList.remove('drop'); const c = cand(dragId || ev.dataTransfer.getData('text/plain')); if (c && c.stage !== col.dataset.stage) { moveStage(c, col.dataset.stage); ctx.commit(`${c.name} moved to ${c.stage}`, `${c.name} moved to ${c.stage}`); } });
    });
  }

  // ---------- Public careers page ----------
  const wsOf = (tid) => (st().session?.tenantId === tid || !tid ? st() : st().workspaces?.[tid]);
  const tenantName = (tid) => (wsOf(tid)?.settings?.company) || st().platform?.tenants?.find((t) => t.id === tid)?.name || '';
  function careersPage(tid, jobId = '') {
    const ws = wsOf(tid);
    if (!ws) return `<div class="careers"><div class="careers-wrap"><h1>Page not found</h1><p class="muted">This careers link doesn’t match a company on Allurus.</p></div></div>`;
    const open = (ws.jobs || []).filter((j) => j.published && (!j.closes || j.closes >= T()));
    const dn = (id) => (ws.departments || []).find((d) => d.id === id)?.name || '';
    const j = open.find((x) => x.id === jobId);
    const head = `<header class="careers-head"><div class="careers-wrap"><a class="careers-brand" href="#careers/${esc(tid)}">${ctx.LOGO_MARK}<span>${esc(ws.settings.company)}</span></a><span class="faint">Careers</span></div></header>`;
    if (j) {
      const d = j.description || {}, sal = j.salaryMin ? `RM ${j.salaryMin.toLocaleString('en-MY')}${j.salaryMax ? `–${j.salaryMax.toLocaleString('en-MY')}` : ''} a month` : '';
      return `<div class="careers">${head}<main class="careers-wrap"><a class="link-btn" href="#careers/${esc(tid)}">${icon('left')}All roles</a>
        <h1>${esc(j.title)}</h1><p class="muted">${esc(dn(j.dept))} · ${esc(j.type)} · ${esc(j.location)}${sal ? ` · ${esc(sal)}` : ''}${j.closes ? ` · apply by ${fmt(j.closes)}` : ''}</p>
        <section class="careers-body">${d.intro ? `<p>${esc(d.intro)}</p>` : ''}${d.responsibilities ? `<h3>What you will do</h3>${list(d.responsibilities)}` : ''}${d.requirements ? `<h3>What you bring</h3>${list(d.requirements)}` : ''}${d.benefits ? `<h3>What we offer</h3>${list(d.benefits)}` : ''}</section>
        <form class="card careers-form" id="apply-form" novalidate><h2>Apply</h2><div class="form-grid">
          <div class="field full"><label for="ap-name">Full name</label><input class="input" id="ap-name" name="name" autocomplete="name"></div>
          <div class="field"><label for="ap-email">Email</label><input class="input" id="ap-email" name="email" type="email" autocomplete="email"></div>
          <div class="field"><label for="ap-phone">Phone</label><input class="input" id="ap-phone" name="phone" type="tel" autocomplete="tel" placeholder="012-345 6789"></div>
          <div class="field full"><label for="ap-link">LinkedIn or portfolio link (optional)</label><input class="input" id="ap-link" name="link" type="url" placeholder="https://"></div>
          <div class="field full"><label for="ap-note">Why you’re a good fit</label><textarea class="textarea" id="ap-note" name="note" rows="4"></textarea></div>
          <div class="field"><label for="ap-src">Where did you hear about us?</label><select class="select" id="ap-src" name="source">${R.SOURCES.map((s) => `<option>${s}</option>`).join('')}</select></div>
          <label class="check field full"><input type="checkbox" name="consent" id="ap-consent"><span>I agree that ${esc(ws.settings.company)} may keep and use my details to consider me for this and similar roles, under the Personal Data Protection Act 2010.</span></label></div>
          <div id="ap-errors" class="field-error-list" role="alert"></div>
          <button class="btn btn-primary btn-lg" type="submit">Send application</button></form></main></div>`;
    }
    const byDept = {};
    open.forEach((x) => (byDept[dn(x.dept)] = byDept[dn(x.dept)] || []).push(x));
    return `<div class="careers">${head}<main class="careers-wrap"><h1>Work at ${esc(ws.settings.company)}</h1><p class="muted">${open.length ? `${open.length} open role${open.length === 1 ? '' : 's'}.` : 'No open roles right now. Check back soon.'}</p>
      ${Object.entries(byDept).map(([dname, js]) => `<h2 class="careers-dept">${esc(dname)}</h2><div class="careers-list">${js.map((x) => `<a class="careers-job" href="#careers/${esc(tid)}/${esc(x.id)}"><strong>${esc(x.title)}</strong><span class="faint">${esc(x.type)} · ${esc(x.location)}</span>${icon('right')}</a>`).join('')}</div>`).join('')}
      <p class="faint careers-foot">Powered by Allurus HR.</p></main></div>`;
  }
  function bindCareers(tid, jobId) {
    const f = document.getElementById('apply-form'); if (!f) return;
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries()); d.consent = !!f.consent.checked;
      const p = R.applicationProblems(d);
      f.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
      p.forEach((x) => f.querySelector(`[name="${x.field}"]`)?.setAttribute('aria-invalid', 'true'));
      document.getElementById('ap-errors').innerHTML = p.map((x) => `<div class="field-error">${icon('x')}${esc(x.message)}</div>`).join('');
      if (p.length) { f.querySelector('[aria-invalid]')?.focus(); return; }
      const ws = wsOf(tid);
      ws.candidates = ws.candidates || [];
      if (ws.candidates.some((c) => c.jobId === jobId && (c.email || '').toLowerCase() === d.email.trim().toLowerCase())) { document.getElementById('ap-errors').innerHTML = `<div class="field-error">${icon('x')}You have already applied for this role with that email.</div>`; return; }
      ws.candidates.push({ id: U.uid('c'), name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), link: d.link.trim(), note: d.note.trim(), source: d.source, jobId, stage: 'Applied', applied: T(), stageDates: { Applied: T() }, rating: 3, consentAt: new Date().toISOString(), interviews: [], offers: [] });
      ctx.save();
      const j = (ws.jobs || []).find((x) => x.id === jobId);
      f.outerHTML = `<div class="card careers-thanks" tabindex="-1" id="ap-thanks"><h2>Thank you, ${esc(d.name.trim().split(' ')[0])}</h2><p>Your application for ${esc(j?.title || 'the role')} is in. ${esc(ws.settings.company)} will be in touch by email.</p><a class="btn" href="#careers/${esc(tid)}">See other roles</a></div>`;
      document.getElementById('ap-thanks')?.focus();
      if (ws === st()) notify('candidate.applied', { who: d.name.trim(), role: j?.title || '', href: '#recruitment' }, 'hr', { from: 'system' });
    });
  }

  // ---------- Settings: job post and offer templates, scorecard areas ----------
  function settingsCard() {
    return `<div class="card card-flush" id="rc-templates"><div class="card-head" style="padding-bottom:6px"><h3>Recruitment templates</h3><div class="row-actions"><button class="btn btn-sm" data-act="rc-tpl" data-id="" data-v="job">${icon('plus')}Job post</button><button class="btn btn-sm" data-act="rc-tpl" data-id="" data-v="offer">${icon('plus')}Offer letter</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Template</th><th>Kind</th><th></th></tr></thead><tbody>
      ${cfg().templates.map((t) => `<tr><td><strong>${esc(t.name)}</strong></td><td>Job post</td><td><div class="row-actions"><button class="btn btn-sm" data-act="rc-tpl" data-id="${t.id}" data-v="job">Edit</button></div></td></tr>`).join('')}
      ${cfg().offerTemplates.map((t) => `<tr><td><strong>${esc(t.name)}</strong><div class="person-sub">${esc(t.subject)}</div></td><td>Offer letter</td><td><div class="row-actions"><button class="btn btn-sm" data-act="rc-tpl" data-id="${t.id}" data-v="offer">Edit</button></div></td></tr>`).join('')}</tbody></table></div>
      <div class="settings-row" style="padding:0 18px 14px"><div><div class="label">Interview scorecard areas</div><div class="desc">One per line; interviewers rate each from 1 to 5.</div></div><textarea class="textarea" id="rc-crit" rows="4" style="width:min(320px,100%)">${esc(cfg().criteria.join('\n'))}</textarea></div></div>`;
  }
  function bindSettings() { ctx.$('#rc-crit')?.addEventListener('change', (ev) => { const l = ev.target.value.split('\n').map((x) => x.trim()).filter(Boolean); if (!l.length) return; cfg().criteria = l; ctx.commit('Scorecard areas saved'); }); }
  function templateForm(id, kind) {
    const job_ = kind === 'job', listK = job_ ? 'templates' : 'offerTemplates';
    const t = id ? cfg()[listK].find((x) => x.id === id) : job_ ? { name: '', intro: 'Join us as {{job.title}}.', responsibilities: '', requirements: '', benefits: 'EPF, SOCSO and EIS\nAnnual leave from 14 days\nMedical and dental cover' } : { name: '', subject: 'Offer of employment: {{job.title}}', body: 'Dear {{candidate.name}},\n\n' };
    ctx.openModal({
      title: id ? `Edit ${t.name}` : job_ ? 'New job post template' : 'New offer letter template', size: 'lg', submit: 'Save template',
      body: `<div class="form-grid"><div class="field full"><label for="tp-n">Name</label><input class="input" id="tp-n" name="name" required value="${esc(t.name)}"></div>
        ${job_ ? `<div class="field full"><label for="tp-i">About the role</label><textarea class="textarea" id="tp-i" name="intro" rows="3">${esc(t.intro)}</textarea></div><div class="field full"><label for="tp-r">What you will do</label><textarea class="textarea" id="tp-r" name="responsibilities" rows="4">${esc(t.responsibilities)}</textarea></div><div class="field full"><label for="tp-q">What you bring</label><textarea class="textarea" id="tp-q" name="requirements" rows="4">${esc(t.requirements)}</textarea></div><div class="field full"><label for="tp-b">What we offer</label><textarea class="textarea" id="tp-b" name="benefits" rows="3">${esc(t.benefits)}</textarea></div>`
        : `<div class="field full"><label for="tp-s">Subject</label><input class="input" id="tp-s" name="subject" required value="${esc(t.subject)}"></div><div class="field full"><label for="tp-body">Letter</label><textarea class="textarea hr-letter-body" id="tp-body" name="body" rows="12" required>${esc(t.body)}</textarea><span class="field-hint">Placeholders: {{candidate.name}}, {{job.title}}, {{job.department}}, {{job.location}}, {{offer.salary_monthly}}, {{offer.start_date}}, {{offer.probation_months}}, {{offer.expires}}, {{company.name}}, {{signatory.name}}, {{signatory.title}}, {{today}}.</span></div>`}</div>`,
      onSubmit(d) { const x = { ...d, name: d.name.trim() }; if (id) Object.assign(t, x); else cfg()[listK].push({ id: U.uid('tp'), ...x }); ctx.commit('Template saved'); },
    });
  }

  // ---------- Approvals card and insights ----------
  function approvalsCard(id) {
    const rq = reqs().filter((r) => canAct(r, id)), sc = myScorecards(id), mine = reqs().filter((r) => r.by === id).slice(-3).reverse();
    const lead = ctx.leave?.isApprover(id);
    if (!rq.length && !sc.length && !lead && !mine.length) return '';
    return `<div class="card"><div class="card-head"><h3>Hiring</h3>${lead ? `<button class="btn btn-sm" data-act="rc-req-new">${icon('briefcase')}Request a hire</button>` : ''}</div><div class="list">
      ${rq.map((r) => `<div class="list-item"><div class="grow"><div class="person-name">Hiring request: ${esc(r.title)}</div><div class="person-sub">${esc(ctx.fullName(emp(r.by)) || 'HR')} · ${r.headcount} × ${esc(r.type)}</div></div><button class="btn btn-sm btn-primary" data-act="rc-req" data-id="${r.id}">Review</button></div>`).join('')}
      ${sc.map(({ c, iv }) => `<div class="list-item"><div class="grow"><div class="person-name">Scorecard: ${esc(c.name)}</div><div class="person-sub">${esc(job(c.jobId)?.title || '')} · ${fmt(iv.date, { weekday: 'short', day: 'numeric', month: 'short' })} ${esc(iv.start)}</div></div><button class="btn btn-sm ${iv.date <= T() ? 'btn-primary' : ''}" data-act="rc-score" data-id="${c.id}" data-v="${iv.id}">${iv.date <= T() ? 'Score' : 'Upcoming'}</button></div>`).join('')}
      ${mine.map((r) => `<div class="list-item"><div class="grow"><div class="person-name">Your request: ${esc(r.title)}</div><div class="person-sub">${fmt(r.at, { day: 'numeric', month: 'short' })}</div></div>${reqPill(r.status)}</div>`).join('')}
      ${!rq.length && !sc.length && !mine.length ? '<p class="faint">Nothing waiting. Request a hire when your team needs one.</p>' : ''}</div></div>`;
  }
  function insights() {
    const out = [];
    if (ctx.role() === 'admin') {
      const p = reqs().filter((r) => canAct(r, actor()));
      if (p.length) out.push({ tone: 'warn', icon: 'briefcase', title: `${p.length} hiring request${p.length === 1 ? '' : 's'} to approve`, detail: p.slice(0, 3).map((r) => r.title).join(', '), action: { label: 'Review', act: 'rc-req', id: p[0].id }, prio: 2 });
      const fresh = st().candidates.filter((c) => c.source === 'Careers page' && c.applied >= U.addDays(T(), -3) && c.stage === 'Applied');
      if (fresh.length) out.push({ tone: 'info', icon: 'userplus', title: `${fresh.length} new application${fresh.length === 1 ? '' : 's'} from the careers page`, detail: fresh.slice(0, 3).map((c) => c.name).join(', '), action: { label: 'Pipeline', href: '#recruitment' }, prio: 1 });
    }
    if (ctx.role() === 'employee') {
      const sc = myScorecards(ctx.me().id).filter((x) => x.iv.date <= T());
      if (sc.length) out.push({ tone: 'warn', icon: 'check', title: `${sc.length} interview scorecard${sc.length === 1 ? '' : 's'} to fill in`, detail: sc.map((x) => x.c.name).join(', '), action: { label: 'Score', act: 'rc-score', id: sc[0].c.id, v: sc[0].iv.id }, prio: 2 });
    }
    return out;
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.recruitment = view;
    ctx.AFTER.recruitment = bind;
    const baseMove = ctx.ACTIONS['cand-move'];
    Object.assign(ctx.ACTIONS, {
      'cand-move': (id, v) => { const cc = cand(id), i = Math.min(R.STAGES.length - 1, Math.max(0, R.STAGES.indexOf(cc.stage) + Number(v))); if (Number(v) > 0) { moveStage(cc, R.STAGES[i]); ctx.commit(`${cc.name} moved to ${cc.stage}`, `${cc.name} moved to ${cc.stage}`); } else baseMove(id, v); },
      'rc-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'rc-cand': (id) => candView(id),
      'rc-next': (id) => { const cc = cand(id); moveStage(cc, R.STAGES[R.STAGES.indexOf(cc.stage) + 1]); ctx.closeOverlay(); ctx.commit(`${cc.name} moved to ${cc.stage}`, `${cc.name} moved to ${cc.stage}`); },
      'rc-reject': (id) => { const cc = cand(id); cc.rejected = true; cc.rejectedOn = T(); ctx.closeOverlay(); ctx.commit(`${cc.name} marked as not progressing`); },
      'rc-iv': (id) => interviewForm(id),
      'rc-score': (id, v) => scorecardForm(id, v),
      'rc-offer': (id) => offerForm(id),
      'rc-offer-view': (id, v) => offerView(id, v),
      'rc-offer-reply': (id, v) => { const cc = cand(id), [oid, s] = v.split(':'), o = cc.offers.find((x) => x.id === oid); o.status = s; o.repliedAt = T(); if (s === 'Accepted') moveStage(cc, 'Hired'); ctx.closeOverlay(); ctx.commit(s === 'Accepted' ? `${cc.name} accepted. Onboard them from the pipeline.` : `${cc.name} declined the offer`, `${cc.name} ${s.toLowerCase()} the offer`); },
      'rc-req-new': () => requisitionForm(),
      'rc-req': (id) => reviewReq(id),
      'rc-req-decide': (id, v) => decide(id, v === 'yes'),
      'rc-job': (id) => jobForm(id),
      'rc-tpl': (id, v) => templateForm(id, v),
      'rc-copy-link': () => { navigator.clipboard?.writeText(careersLink()).then(() => ctx.toast('Careers link copied'), () => ctx.toast(careersLink())); },
      'rc-copy-job': (id) => { navigator.clipboard?.writeText(jobText(job(id))).then(() => ctx.toast('Job text copied'), () => ctx.toast('Copy failed', 'error')); },
      'rc-board': async (id, v) => { const r = await postToJobBoard(v, { ...job(id), text: jobText(job(id)) }); ctx.toast(r.message || (r.ok ? 'Posted' : 'Not posted'), r.ok ? 'ok' : 'info'); },
    });
    return { careersPage, bindCareers, approvalsCard, insights, settingsCard, bindSettings, myScorecards, hasTasks: (id) => myScorecards(id).length > 0 || reqs().some((r) => canAct(r, id)), taskCount: (id) => myScorecards(id).filter((x) => x.iv.date <= T()).length + reqs().filter((r) => canAct(r, id)).length, badge: () => (ctx.role() === 'admin' ? reqs().filter((r) => canAct(r, actor())).length : 0), postToJobBoard, moveStage, tenantName };
  }
  return { install };
})();
