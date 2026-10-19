// Training: courses with modules (text, video link, PDF link) and a quiz with a pass mark, mandatory courses by
// department or job title, printable completion certificates whose expiry feeds the daily reminders, training
// requests through the approval chain, and an HRD Corp claimable flag per course. Rules: js/talent-rules.js.
window.AllurusLMS = (function () {
  'use strict';
  const R = window.AllurusTalentRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const courses = () => (st().courses = st().courses || []);
  const enrolments = () => (st().enrolments = st().enrolments || []);
  const requests = () => (st().trainingRequests = st().trainingRequests || []);
  const course = (id) => courses().find((c) => c.id === id);
  const emp = (id) => ctx.emp(id);
  const firstOf = (id) => emp(id)?.first || '—';
  const fmt = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? U.fmtDate(d, o) : '—');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const long = (d) => (d ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '');
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const notify = (type, data, to, opts) => ctx.notify?.event(type, data, to, opts);
  const LR = () => window.AllurusLeaveRules;
  const ui = { tab: 'courses', dept: 'all', open: '' };
  const KINDS = { text: 'Reading', video: 'Video', pdf: 'PDF' };
  const TONE = { Completed: 'ok', Expiring: 'warn', Expired: 'bad', Overdue: 'bad', 'In progress': 'info', 'Not started': '' };
  const statusPill = (s) => `<span class="pill ${TONE[s.status] || ''}">${s.status === 'Expiring' ? `Expires in ${s.left} day${s.left === 1 ? '' : 's'}` : esc(s.status)}</span>`;
  const latest = (empId, courseId) => R.latest(enrolments(), empId, courseId);
  const statusOf = (empId, c) => R.standing(c, enrolments(), empId, T(), st().settings.training?.window || 60);

  // ---------- Assigning ----------
  /** Enrols people in a course unless they already have an open enrolment or a current certificate. */
  function assign(courseId, empIds, due, source = 'Assigned') {
    const c = course(courseId), added = [];
    empIds.forEach((id) => {
      // Skip anyone with an open enrolment, or a certificate that isn't close to expiring.
      if ((latest(id, courseId) && !latest(id, courseId).completedAt) || statusOf(id, c).status === 'Completed') return;
      const x = { id: U.uid('en'), courseId, empId: id, assigned: T(), due, source, done: [], attempts: [], completedAt: '', certNo: '', expires: '' };
      enrolments().push(x); added.push(x);
    });
    return added;
  }
  /** Assigns every mandatory course to the people it applies to (new joiners, renewals of expiring certificates). */
  function syncMandatory() {
    const due = U.addDays(T(), 30), byEmp = {};
    courses().filter((c) => c.active !== false && c.mandatory).forEach((c) => {
      const who = ctx.activeEmployees().filter((e) => R.requiredFor(e, [c]).length).map((e) => e.id);
      const need = who.filter((id) => !latest(id, c.id) || (latest(id, c.id).completedAt && ['Expired', 'Expiring'].includes(statusOf(id, c).status)));
      assign(c.id, need, due, 'Mandatory').forEach((x) => (byEmp[x.empId] = byEmp[x.empId] || []).push(c.title));
    });
    Object.entries(byEmp).forEach(([id, titles]) => notify('training.assigned', { count: titles.length, title: titles[0], due, href: '#my-training' }, id, { from: 'system', self: true }));
    return Object.values(byEmp).reduce((s, l) => s + l.length, 0);
  }

  // ---------- Course editor ----------
  const quizText = (q) => (q?.questions || []).map((x) => `Q: ${x.q}\n${x.options.map((o, i) => `${i === Number(x.answer) ? '*' : '-'} ${o}`).join('\n')}`).join('\n\n');
  /** Reads quiz questions written as "Q: question" followed by "- wrong" and "* right" options. */
  function parseQuiz(text) {
    const qs = [], errs = [];
    String(text || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).forEach((b, n) => {
      const lines = b.split('\n').map((l) => l.trim()).filter(Boolean), q = lines[0].replace(/^Q:\s*/i, '');
      const opts = lines.slice(1).filter((l) => /^[-*]/.test(l)), answer = opts.findIndex((l) => l.startsWith('*'));
      if (opts.length < 2 || answer < 0) errs.push(`Question ${n + 1} needs at least two options and one marked with *`);
      qs.push({ id: 'q' + (n + 1), q, options: opts.map((l) => l.replace(/^[-*]\s*/, '')), answer });
    });
    return { qs, errs };
  }
  const moduleRow = (m = { kind: 'text', title: '', body: '', url: '' }) => `<div class="lms-mod-row" data-mod="${m.id || ''}"><select class="select" aria-label="Module type" data-f="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input class="input" data-f="title" aria-label="Module title" placeholder="Module title" value="${esc(m.title)}"><textarea class="textarea" data-f="body" rows="2" aria-label="Text or link" placeholder="${m.kind === 'text' ? 'Text' : 'https://'}">${esc(m.kind === 'text' ? m.body : m.url)}</textarea><button type="button" class="btn btn-sm btn-icon btn-ghost" data-lms-del aria-label="Remove module">${icon('trash')}</button></div>`;
  function courseForm(id = '') {
    const c = id ? course(id) : { title: '', category: 'Compliance', provider: 'In-house', hours: 1, desc: '', modules: [{ kind: 'text', title: 'Introduction', body: '' }], quiz: { passMark: 80, questions: [] }, mandatory: null, validMonths: 0, hrdc: { claimable: false, fee: 0 }, active: true };
    const m = c.mandatory || {};
    ctx.openModal({
      title: id ? `Edit ${c.title}` : 'New course', size: 'lg', submit: 'Save course',
      body: `<div class="form-grid"><div class="field full"><label for="co-t">Title</label><input class="input" id="co-t" name="title" required value="${esc(c.title)}"></div>
        <div class="field"><label for="co-cat">Category</label><input class="input" id="co-cat" name="category" list="co-cats" value="${esc(c.category)}"><datalist id="co-cats">${['Compliance', 'Safety', 'Skills', 'Leadership', 'Onboarding'].map((x) => `<option>${x}</option>`).join('')}</datalist></div>
        <div class="field"><label for="co-p">Provider</label><input class="input" id="co-p" name="provider" value="${esc(c.provider)}"></div>
        <div class="field"><label for="co-h">Hours</label><input class="input num" id="co-h" name="hours" type="number" min="0" step="0.5" value="${c.hours}"></div>
        <div class="field"><label for="co-v">Certificate valid for (months, 0 = no expiry)</label><input class="input num" id="co-v" name="validMonths" type="number" min="0" max="120" value="${c.validMonths || 0}"></div>
        <div class="field full"><label for="co-d">Description</label><textarea class="textarea" id="co-d" name="desc" rows="2">${esc(c.desc)}</textarea></div>
        <div class="field full"><span class="label-like">Modules</span><div id="co-mods" class="lms-mods">${(c.modules || []).map(moduleRow).join('')}</div><button type="button" class="btn btn-sm" id="co-add-mod" style="margin-top:6px">${icon('plus')}Add module</button></div>
        <div class="field"><label for="co-pm">Quiz pass mark (%)</label><input class="input num" id="co-pm" name="passMark" type="number" min="0" max="100" value="${c.quiz?.passMark ?? 80}"></div>
        <div class="field full"><label for="co-q">Quiz questions (optional)</label><textarea class="textarea" id="co-q" name="quiz" rows="6" placeholder="Q: Who do you report a hazard to?&#10;- Nobody&#10;* Your supervisor or the safety officer">${esc(quizText(c.quiz))}</textarea><span class="field-hint">Start each question with “Q:”, then one option per line. Mark the right answer with * and others with -. Leave a blank line between questions.</span></div>
        <fieldset class="field full lms-fs"><legend>Mandatory for</legend><label class="check"><input type="checkbox" name="mAll" ${m.all ? 'checked' : ''}><span>Everyone</span></label>
          <div class="rc-pick">${st().departments.map((d) => `<label class="check"><input type="checkbox" data-co-dept value="${d.id}" ${(m.depts || []).includes(d.id) ? 'checked' : ''}><span>${esc(d.name)}</span></label>`).join('')}</div>
          <label for="co-roles" style="margin-top:6px">Job titles containing (comma separated)</label><input class="input" id="co-roles" name="roles" placeholder="e.g. Manager, Head of" value="${esc((m.roles || []).join(', '))}"></fieldset>
        <label class="check field"><input type="checkbox" name="hrdc" ${c.hrdc?.claimable ? 'checked' : ''}><span>HRD Corp claimable</span></label>
        <div class="field"><label for="co-fee">Course fee (RM)</label><input class="input num" id="co-fee" name="fee" type="number" min="0" step="10" value="${c.hrdc?.fee || 0}"></div>
        <label class="check field full"><input type="checkbox" name="active" ${c.active !== false ? 'checked' : ''}><span>Active (shown to staff)</span></label></div>`,
      onSubmit(d) {
        const mods = ctx.$$('#co-mods .lms-mod-row').map((r, i) => { const kind = r.querySelector('[data-f=kind]').value, v = r.querySelector('[data-f=body]').value.trim(); return { id: r.dataset.mod || `m${Date.now().toString(36)}${i}`, kind, title: r.querySelector('[data-f=title]').value.trim(), ...(kind === 'text' ? { body: v } : { url: v }) }; }).filter((x) => x.title);
        if (!mods.length) { ctx.toast('Add at least one module', 'error'); return false; }
        const bad = mods.find((x) => x.kind !== 'text' && !/^https?:\/\//.test(x.url));
        if (bad) { ctx.toast(`“${bad.title}” needs a link starting with https://`, 'error'); return false; }
        const q = parseQuiz(d.quiz);
        if (q.errs.length) { ctx.toast(q.errs[0], 'error'); return false; }
        const depts = ctx.$$('[data-co-dept]:checked').map((x) => x.value), roles = d.roles.split(',').map((x) => x.trim()).filter(Boolean);
        const x = { title: d.title.trim(), category: d.category.trim() || 'Skills', provider: d.provider.trim(), hours: +d.hours || 0, desc: d.desc.trim(), validMonths: Math.max(0, +d.validMonths || 0), modules: mods, quiz: { passMark: Math.min(100, Math.max(0, +d.passMark || 0)), questions: q.qs }, mandatory: d.mAll === 'on' || depts.length || roles.length ? { all: d.mAll === 'on', depts, roles } : null, hrdc: { claimable: d.hrdc === 'on', fee: +d.fee || 0 }, active: d.active === 'on' };
        if (id) Object.assign(c, x); else courses().push({ id: U.uid('co'), ...x });
        ctx.commit('Course saved', `Course “${x.title}” saved`);
      },
    });
    const box = ctx.$('#co-mods');
    ctx.$('#co-add-mod').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', moduleRow()); box.lastElementChild.querySelector('[data-f=title]').focus(); });
    box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-lms-del]'); if (b) b.closest('.lms-mod-row').remove(); });
    box.addEventListener('change', (ev) => { if (ev.target.dataset.f === 'kind') ev.target.closest('.lms-mod-row').querySelector('[data-f=body]').placeholder = ev.target.value === 'text' ? 'Text' : 'https://'; });
  }
  function assignForm(courseId) {
    const c = course(courseId);
    ctx.openModal({
      title: `Assign ${c.title}`, submit: 'Assign',
      body: `<div class="field"><label for="as-due">Finish by</label><input class="input" id="as-due" name="due" type="date" required value="${U.addDays(T(), 30)}"></div>
        <div class="chips" style="margin:10px 0"><button type="button" class="chip" data-as-all>Everyone</button>${st().departments.map((d) => `<button type="button" class="chip" data-as-dept="${d.id}">${esc(d.name)}</button>`).join('')}</div>
        <div class="rc-pick">${ctx.activeEmployees().map((e) => { const s = statusOf(e.id, c); return `<label class="check"><input type="checkbox" data-as-who value="${e.id}" data-dept="${e.dept}"><span>${esc(ctx.fullName(e))} <span class="faint">${esc(s.status)}</span></span></label>`; }).join('')}</div>`,
      onSubmit(d) {
        const who = ctx.$$('[data-as-who]:checked').map((x) => x.value);
        if (!who.length) { ctx.toast('Pick at least one person', 'error'); return false; }
        const added = assign(courseId, who, d.due);
        added.forEach((x) => notify('training.assigned', { count: 1, title: c.title, due: d.due, href: '#my-training' }, x.empId, { from: actor() }));
        ctx.commit(added.length ? `Assigned to ${added.length} ${added.length === 1 ? 'person' : 'people'}` : 'Everyone picked already has this course');
      },
    });
    ctx.$('[data-as-all]').addEventListener('click', () => ctx.$$('[data-as-who]').forEach((x) => { x.checked = true; }));
    ctx.$$('[data-as-dept]').forEach((b) => b.addEventListener('click', () => ctx.$$(`[data-as-who][data-dept="${b.dataset.asDept}"]`).forEach((x) => { x.checked = true; })));
  }

  // ---------- Taking a course ----------
  function player(courseId) {
    const c = course(courseId), me = ctx.me().id;
    let en = latest(me, courseId);
    // An expired certificate is renewed by taking the course again.
    if (!en || (en.completedAt && statusOf(me, c).status === 'Expired')) { en = { id: U.uid('en'), courseId, empId: me, assigned: T(), due: '', source: 'Self-enrolled', done: [], attempts: [], completedAt: '', certNo: '', expires: '' }; enrolments().push(en); ctx.save(); }
    const s = statusOf(me, c), prog = en.completedAt ? 100 : R.courseStatus(c, en, T()).progress, allDone = c.modules.every((m) => en.done.includes(m.id) || en.completedAt);
    const last = (en.attempts || []).slice(-1)[0];
    const modBody = (m) => m.kind === 'text' ? `<div class="lms-text">${esc(m.body || '').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>` : `<p><a class="btn btn-sm" href="${esc(m.url)}" target="_blank" rel="noopener">${icon(m.kind === 'pdf' ? 'doc' : 'right')}${m.kind === 'pdf' ? 'Open the PDF' : 'Watch the video'}</a> <span class="faint">Opens in a new tab.</span></p>`;
    ctx.openModal({
      title: c.title, size: 'lg', submit: null,
      body: `<div class="lms-head"><div class="faint">${esc(c.category)} · ${c.hours} hour${c.hours === 1 ? '' : 's'} · ${esc(c.provider)}${en.due ? ` · finish by ${fmt(en.due)}` : ''}</div>${statusPill(s)}</div>
        ${c.desc ? `<p class="muted">${esc(c.desc)}</p>` : ''}
        <div class="lms-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${prog}" aria-label="Progress"><i style="width:${prog}%"></i></div>${s.renewal ? '<p class="faint">Your certificate is still valid. Finish this renewal before it expires.</p>' : ''}
        <ol class="lms-modules">${c.modules.map((m, i) => { const done = en.done.includes(m.id) || !!en.completedAt; return `<li class="${done ? 'done' : ''}"><details ${!done && c.modules.slice(0, i).every((x) => en.done.includes(x.id)) && !en.completedAt ? 'open' : ''}><summary><span class="lms-dot">${done ? icon('check') : i + 1}</span><strong>${esc(m.title)}</strong><span class="tag">${KINDS[m.kind]}</span></summary>${modBody(m)}${done ? '' : `<button type="button" class="btn btn-sm btn-primary" data-act="lms-done" data-id="${en.id}" data-v="${m.id}">${icon('check')}Mark as done</button>`}</details></li>`; }).join('')}</ol>
        ${en.completedAt ? `<div class="lms-done-box">${icon('star')}<div><strong>Completed ${fmt(en.completedAt)}</strong>${en.expires ? `<div class="faint">Certificate valid until ${fmt(en.expires)}</div>` : ''}</div><button type="button" class="btn btn-sm" data-act="lms-cert" data-id="${en.id}">${icon('download')}Certificate</button></div>`
          : c.quiz?.questions?.length ? `<h4 class="lv-h">Quiz <span class="faint">· pass mark ${c.quiz.passMark}%</span></h4>${allDone ? `${last && !last.passed ? `<p class="tag warn">Last try ${last.pct}%. Have another go.</p>` : ''}<div id="lms-quiz" role="group" aria-label="Quiz">${c.quiz.questions.map((q, n) => `<fieldset class="lms-q"><legend>${n + 1}. ${esc(q.q)}</legend>${q.options.map((o, k) => `<label class="check"><input type="radio" name="${q.id}" value="${k}"><span>${esc(o)}</span></label>`).join('')}</fieldset>`).join('')}<button type="button" class="btn btn-primary" data-act="lms-quiz" data-id="${en.id}">Submit answers</button></div>` : '<p class="faint">Finish every module to unlock the quiz.</p>'}` : ''}`,
    });
  }
  function complete(en) {
    const c = course(en.courseId);
    en.completedAt = T();
    en.expires = R.certExpiry(en.completedAt, c.validMonths);
    const n = enrolments().filter((x) => x.certNo).length + 1;
    en.certNo = `${(st().settings.company || 'AL').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-TR-${T().slice(0, 4)}-${String(n).padStart(4, '0')}`;
  }
  function certHtml(en) {
    const c = course(en.courseId), e = emp(en.empId), s = st().settings, er = s.employer || {};
    return `<article class="doc cert"><div class="cert-frame"><div class="cert-co">${esc(s.company.toUpperCase())}</div><div class="cert-title">Certificate of completion</div>
      <p class="cert-line">This certifies that</p><div class="cert-name">${esc(ctx.fullName(e))}</div><p class="cert-line">completed</p><div class="cert-course">${esc(c.title)}</div>
      <p class="cert-meta">${c.hours} hour${c.hours === 1 ? '' : 's'} · ${esc(c.provider)}${en.attempts?.length ? ` · quiz score ${en.attempts.slice(-1)[0].pct}%` : ''}</p>
      <div class="cert-foot"><div><div class="cert-sign">${esc(er.signatory || '')}</div><div class="faint">${esc(er.signatoryTitle || '')}</div></div><div class="r"><div>Completed ${esc(long(en.completedAt))}</div>${en.expires ? `<div>Valid until ${esc(long(en.expires))}</div>` : ''}<div class="faint">No. ${esc(en.certNo)}</div></div></div></div></article>`;
  }
  const printCert = (id) => { const en = enrolments().find((x) => x.id === id); ctx.docs.preview(`Certificate · ${course(en.courseId).title}`, certHtml(en), `Certificate ${course(en.courseId).title} ${ctx.fullName(emp(en.empId))}`); };

  // ---------- Training requests ----------
  function requestForm() {
    const me = ctx.me();
    ctx.openModal({
      title: 'Request training', submit: 'Send request',
      body: `<div class="form-grid"><div class="field full"><label for="tr-t">Course or event</label><input class="input" id="tr-t" name="title" required placeholder="e.g. Advanced Excel for Finance"></div>
        <div class="field"><label for="tr-p">Provider</label><input class="input" id="tr-p" name="provider" required></div>
        <div class="field"><label for="tr-c">Fee (RM)</label><input class="input num" id="tr-c" name="cost" type="number" min="0" step="10" value="0"></div>
        <div class="field"><label for="tr-s">From</label><input class="input" id="tr-s" name="start" type="date" required min="${T()}"></div>
        <div class="field"><label for="tr-e">To</label><input class="input" id="tr-e" name="end" type="date" required min="${T()}"></div>
        <label class="check field full"><input type="checkbox" name="hrdc"><span>The provider says it is HRD Corp claimable</span></label>
        <div class="field full"><label for="tr-w">How it helps your work</label><textarea class="textarea" id="tr-w" name="reason" rows="3" required></textarea></div></div>`,
      onSubmit(d) {
        if (d.end < d.start) { ctx.toast('The end date is before the start', 'error'); return false; }
        const lv = st().settings.leave, chain = LR().buildChain({ applicant: me.id, chain: lv.chains?.[me.dept], hr: lv.hr, hrBackup: lv.hrBackup });
        const x = { id: U.uid('tr'), empId: me.id, title: d.title.trim(), provider: d.provider.trim(), cost: +d.cost || 0, start: d.start, end: d.end, hrdc: d.hrdc === 'on', reason: d.reason.trim(), chain, status: 'Pending', at: T() };
        requests().push(x);
        const next = LR().nextStep(chain);
        if (next) notify('request.submitted', { who: ctx.fullName(me), kind: 'training', summary: x.title, href: next.approver === lv.hr ? '#training' : '#my-approvals' }, next.approver, { from: me.id });
        ctx.commit('Request sent for approval');
      },
    });
  }
  const canAct = (r, id) => { const s = LR().nextStep(r.chain); return r.status === 'Pending' && s && (LR().canAct(s, id, () => false) || (ctx.role() === 'admin' && s.level === 'Final')); };
  function reviewRequest(id) {
    const r = requests().find((x) => x.id === id), act = canAct(r, actor());
    ctx.openModal({
      title: `Training request · ${r.title}`, submit: null,
      body: `<dl class="kv"><dt>Who</dt><dd>${esc(ctx.fullName(emp(r.empId)))}</dd><dt>Provider</dt><dd>${esc(r.provider)}</dd><dt>When</dt><dd>${fmt(r.start)}${r.end !== r.start ? ` – ${fmt(r.end)}` : ''}</dd><dt>Fee</dt><dd>${ctx.money(r.cost)}</dd><dt>HRD Corp</dt><dd>${r.hrdc ? 'Claimable (check the grant before the course starts)' : 'Not claimable'}</dd></dl>
        <p style="margin-top:10px">${esc(r.reason)}</p>
        <h4 class="lv-h">Approvals</h4><ol class="audit-list">${r.chain.map((s) => `<li><div><strong>${esc(s.label)}</strong> · ${esc(firstOf(s.approver))} <span class="pill ${s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'bad' : ''}">${s.status}</span></div>${s.note ? `<div class="faint">“${esc(s.note)}”</div>` : ''}</li>`).join('')}</ol>
        ${act ? `<div class="field" style="margin-top:12px"><label for="tr-note">Note (needed to decline)</label><input class="input" id="tr-note"></div><div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn" data-act="lms-req-decide" data-id="${r.id}" data-v="no">Decline</button><button type="button" class="btn btn-primary" data-act="lms-req-decide" data-id="${r.id}" data-v="yes">${icon('check')}Approve</button></div>` : ''}
        ${r.status === 'Approved' && ctx.role() === 'admin' ? `<div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-act="lms-req-attended" data-id="${r.id}">${icon('check')}Mark as attended</button></div>` : ''}`,
    });
  }
  function decide(id, approve) {
    const r = requests().find((x) => x.id === id), note = ctx.$('#tr-note')?.value.trim() || '';
    if (!approve && !note) { ctx.toast('Say why, so they know', 'error'); ctx.$('#tr-note')?.focus(); return; }
    r.chain = LR().decide(r.chain, { by: actor(), approve, note, at: T() }).chain || r.chain;
    const next = LR().nextStep(r.chain);
    if (!approve) r.status = 'Rejected'; else if (!next) r.status = 'Approved';
    else notify('request.step', { who: ctx.fullName(emp(r.empId)), kind: 'training', summary: r.title, by: ctx.fullName(emp(actor())), href: next.approver === st().settings.leave.hr ? '#training' : '#my-approvals' }, next.approver);
    if (r.status !== 'Pending') notify(r.status === 'Approved' ? 'request.approved' : 'request.rejected', { kind: 'training', summary: r.title, by: ctx.fullName(emp(actor())) || 'HR', note, href: '#my-training' }, r.empId);
    ctx.closeOverlay();
    ctx.commit(r.status === 'Approved' ? 'Training approved' : r.status === 'Rejected' ? 'Request declined' : 'Approved; sent to the next approver');
  }
  const reqPill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'ok', Attended: 'ok', Rejected: 'bad' })[s] || ''}">${s === 'Rejected' ? 'Declined' : s}</span>`;

  // ---------- Admin views ----------
  const TABS = [['courses', 'Courses'], ['compliance', 'Compliance'], ['requests', 'Requests'], ['certificates', 'Certificates']];
  function coursesTab() {
    const cs = courses(), y = T().slice(0, 4);
    const claimable = enrolments().filter((e) => e.completedAt?.startsWith(y) && course(e.courseId)?.hrdc?.claimable).reduce((s, e) => s + (course(e.courseId).hrdc.fee || 0), 0) + requests().filter((r) => r.hrdc && ['Approved', 'Attended'].includes(r.status) && r.start.startsWith(y)).reduce((s, r) => s + r.cost, 0);
    return `<div class="grid g-4 keep-2"><div class="card kpi"><div class="kpi-label">Courses</div><div class="kpi-value">${cs.filter((c) => c.active !== false).length}</div><div class="kpi-foot">${cs.filter((c) => c.mandatory && c.active !== false).length} mandatory</div></div>
        <div class="card kpi"><div class="kpi-label">Completions this year</div><div class="kpi-value">${enrolments().filter((e) => e.completedAt?.startsWith(y)).length}</div></div>
        <div class="card kpi"><div class="kpi-label">Mandatory compliance</div><div class="kpi-value">${complianceRate()}%</div></div>
        <div class="card kpi"><div class="kpi-label">HRD Corp claimable ${y}</div><div class="kpi-value">${ctx.compactMoney(claimable)}</div><div class="kpi-foot">Fees for claimable courses</div></div></div>
      <div class="lms-grid">${cs.map((c) => { const en = enrolments().filter((e) => e.courseId === c.id); return `<div class="card lms-card ${c.active === false ? 'is-off' : ''}"><div class="lms-card-top"><span class="tag">${esc(c.category)}</span>${c.mandatory ? '<span class="pill warn">Mandatory</span>' : ''}${c.hrdc?.claimable ? '<span class="pill info">HRD Corp claimable</span>' : ''}${c.active === false ? '<span class="pill">Inactive</span>' : ''}</div>
        <h3>${esc(c.title)}</h3><p class="faint">${c.modules.length} module${c.modules.length === 1 ? '' : 's'}${c.quiz?.questions?.length ? ` · quiz (${c.quiz.passMark}% to pass)` : ''} · ${c.hours} h${c.validMonths ? ` · renew every ${c.validMonths} months` : ''}</p>
        <p class="muted lms-desc">${esc(c.desc)}</p>
        <div class="lms-card-foot"><span class="faint">${en.filter((e) => e.completedAt).length} completed · ${en.filter((e) => !e.completedAt).length} in progress</span><div class="row-actions"><button class="btn btn-sm" data-act="lms-course" data-id="${c.id}">Edit</button><button class="btn btn-sm" data-act="lms-assign" data-id="${c.id}">Assign</button></div></div></div>`; }).join('')}</div>`;
  }
  const mandatoryCourses = () => courses().filter((c) => c.active !== false && c.mandatory);
  const complianceRate = () => { const rows = R.compliance(ctx.activeEmployees(), courses(), enrolments(), T()), req = rows.reduce((s, r) => s + r.required, 0); return req ? Math.round((rows.reduce((s, r) => s + r.current, 0) / req) * 100) : 100; };
  function complianceTab() {
    const mc = mandatoryCourses(), people = ctx.activeEmployees().filter((e) => ui.dept === 'all' || e.dept === ui.dept);
    const rows = R.compliance(people, courses(), enrolments(), T());
    const cell = (empId, c) => { const s = rows.find((r) => r.empId === empId).statuses[c.id]; if (!s) return '<td class="c faint">—</td>'; const x = statusOf(empId, c); return `<td class="c"><span class="lms-cell s-${s.replace(/ /g, '-').toLowerCase()}" title="${esc(s)}">${s === 'Completed' ? icon('check') : s === 'Expiring' ? `${x.left}d` : s === 'Not started' ? '' : s === 'In progress' ? `${x.progress}%` : '!'}</span><span class="sr-only">${esc(s)}</span></td>`; };
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Mandatory training</h3><div class="row-actions"><select class="select" id="lms-dept" aria-label="Department"><option value="all">All departments</option>${st().departments.map((d) => `<option value="${d.id}" ${ui.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select><button class="btn btn-sm" data-act="lms-sync">${icon('userplus')}Assign what’s missing</button><button class="btn btn-sm" data-act="lms-csv">${icon('download')}CSV</button></div></div>
      <div class="table-wrap"><table class="lms-matrix"><thead><tr><th>Employee</th>${mc.map((c) => `<th class="c" title="${esc(c.title)}"><span class="lms-th">${esc(c.title)}</span></th>`).join('')}<th class="r">Current</th></tr></thead><tbody>
      ${people.map((e) => { const r = rows.find((x) => x.empId === e.id); return `<tr><td>${ctx.person(e)}</td>${mc.map((c) => cell(e.id, c)).join('')}<td class="r num">${r.required ? `${r.pct}%` : '—'}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="lms-legend">${[['completed', 'Current'], ['expiring', 'Expiring (days left)'], ['in-progress', 'In progress'], ['not-started', 'Not started'], ['overdue', 'Overdue'], ['expired', 'Expired']].map(([k, l]) => `<span><i class="lms-cell s-${k}"></i>${l}</span>`).join('')}</div></div>`;
  }
  function requestsTab() {
    const l = [...requests()].sort((a, b) => (b.status === 'Pending') - (a.status === 'Pending') || b.at.localeCompare(a.at));
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Who</th><th>Training</th><th class="hide-sm">When</th><th class="r">Fee</th><th>Status</th><th></th></tr></thead><tbody>
      ${l.map((r) => { const nx = LR().nextStep(r.chain); return `<tr class="clickable" data-act="lms-req" data-id="${r.id}"><td>${ctx.person(emp(r.empId))}</td><td><strong>${esc(r.title)}</strong><div class="person-sub">${esc(r.provider)}${r.hrdc ? ' · HRD Corp claimable' : ''}</div></td><td class="hide-sm muted">${fmt(r.start, { day: 'numeric', month: 'short' })}</td><td class="r num">${ctx.money(r.cost)}</td><td>${reqPill(r.status)}${r.status === 'Pending' && nx ? `<div class="person-sub">With ${esc(firstOf(nx.approver))}</div>` : ''}</td><td><div class="row-actions"><button class="btn btn-sm ${canAct(r, actor()) ? 'btn-primary' : ''}" data-act="lms-req" data-id="${r.id}">${canAct(r, actor()) ? 'Review' : 'Open'}</button></div></td></tr>`; }).join('')}</tbody></table>
      ${l.length ? '' : '<div class="empty"><strong>No training requests</strong>Staff can ask for external courses from My training.</div>'}</div></div>`;
  }
  function certificatesTab() {
    const l = enrolments().filter((e) => e.completedAt && emp(e.empId)).sort((a, b) => (a.expires || '9999').localeCompare(b.expires || '9999'));
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Employee</th><th>Course</th><th class="hide-sm">Completed</th><th>Valid until</th><th class="hide-sm">Number</th><th></th></tr></thead><tbody>
      ${l.map((e) => { const c = course(e.courseId), s = R.courseStatus(c, e, T()); return `<tr><td>${ctx.person(emp(e.empId))}</td><td>${esc(c?.title || '')}</td><td class="hide-sm muted">${fmt(e.completedAt)}</td><td>${e.expires ? `${fmt(e.expires)} ${s.status !== 'Completed' ? statusPill(s) : ''}` : '<span class="faint">No expiry</span>'}</td><td class="hide-sm num faint">${esc(e.certNo)}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="lms-cert" data-id="${e.id}">${icon('download')}Print</button></div></td></tr>`; }).join('')}</tbody></table>
      ${l.length ? '' : '<div class="empty"><strong>No certificates yet</strong></div>'}</div></div>`;
  }
  function view() {
    const pend = requests().filter((r) => r.status === 'Pending').length;
    return `<div class="page-head"><div><div class="eyebrow">Talent</div><h1>Training</h1><p class="sub">Courses, mandatory training and certificates. ${complianceRate()}% of mandatory training is current.</p></div><div class="actions"><button class="btn btn-primary" data-act="lms-course" data-id="">${icon('plus')}New course</button></div></div>
      <div class="seg rc-tabs" role="tablist" aria-label="Training">${TABS.map(([k, l]) => `<button role="tab" data-act="lms-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}${k === 'requests' && pend ? ` <span class="faint">${pend}</span>` : ''}</button>`).join('')}</div>
      ${ui.tab === 'compliance' ? complianceTab() : ui.tab === 'requests' ? requestsTab() : ui.tab === 'certificates' ? certificatesTab() : coursesTab()}`;
  }

  // ---------- Employee view ----------
  function myView() {
    const me = ctx.me(), req = R.requiredFor(me, courses());
    const mine = courses().filter((c) => c.active !== false && (req.includes(c) || latest(me.id, c.id)));
    const rows = mine.map((c) => ({ c, s: statusOf(me.id, c), en: latest(me.id, c.id) })).sort((a, b) => ['Overdue', 'Expired', 'Expiring', 'In progress', 'Not started', 'Completed'].indexOf(a.s.status) - ['Overdue', 'Expired', 'Expiring', 'In progress', 'Not started', 'Completed'].indexOf(b.s.status));
    const more = courses().filter((c) => c.active !== false && !mine.includes(c));
    const certs = enrolments().filter((e) => e.empId === me.id && e.completedAt);
    const reqs = requests().filter((r) => r.empId === me.id).reverse();
    const todo = rows.filter((r) => !['Completed', 'Expiring'].includes(r.s.status) || r.s.renewal).length;
    return `<div class="page-head"><div><h1>My training</h1><p class="sub">${todo ? `${todo} course${todo === 1 ? '' : 's'} to do.` : 'You’re up to date.'}</p></div><div class="actions"><button class="btn" data-act="lms-request">${icon('plus')}Request training</button></div></div>
      <div class="lms-grid">${rows.map(({ c, s, en }) => `<div class="card lms-card"><div class="lms-card-top">${req.includes(c) ? '<span class="pill warn">Mandatory</span>' : `<span class="tag">${esc(c.category)}</span>`}${statusPill(s)}</div><h3>${esc(c.title)}</h3><p class="faint">${c.modules.length} module${c.modules.length === 1 ? '' : 's'} · ${c.hours} h${en?.due && !en.completedAt ? ` · finish by ${fmt(en.due, { day: 'numeric', month: 'short' })}` : ''}</p>
        <div class="lms-progress" aria-hidden="true"><i style="width:${s.renewal ? s.renewal.progress : s.progress}%"></i></div>
        <div class="lms-card-foot">${en?.completedAt ? `<button class="btn btn-sm" data-act="lms-cert" data-id="${en.id}">${icon('download')}Certificate</button>` : '<span></span>'}<button class="btn btn-sm ${['Completed', 'Expiring'].includes(s.status) && !s.renewal ? '' : 'btn-primary'}" data-act="lms-play" data-id="${c.id}">${s.renewal || s.status === 'Expired' ? 'Renew' : s.status === 'Not started' ? 'Start' : ['Completed', 'Expiring'].includes(s.status) ? 'Review' : 'Continue'}</button></div></div>`).join('')}
        ${rows.length ? '' : '<div class="card empty"><strong>No courses yet</strong>Pick one below or ask for external training.</div>'}</div>
      ${more.length ? `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Course library</h3></div><div class="list">${more.map((c) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(c.title)}</div><div class="person-sub">${esc(c.category)} · ${c.hours} h${c.hrdc?.claimable ? ' · HRD Corp claimable' : ''}</div></div><button class="btn btn-sm" data-act="lms-play" data-id="${c.id}">Start</button></div>`).join('')}</div></div>` : ''}
      <div class="grid g-2"><div class="card"><div class="card-head"><h3>My certificates</h3></div>${certs.length ? `<div class="list">${certs.map((e) => { const c = course(e.courseId), s = R.courseStatus(c, e, T()); return `<div class="list-item"><div class="grow"><div class="person-name">${esc(c?.title || '')}</div><div class="person-sub">${fmt(e.completedAt)}${e.expires ? ` · valid until ${fmt(e.expires)}` : ''}</div></div>${s.status !== 'Completed' ? statusPill(s) : ''}<button class="btn btn-sm btn-icon btn-ghost" data-act="lms-cert" data-id="${e.id}" aria-label="Print certificate">${icon('download')}</button></div>`; }).join('')}</div>` : '<p class="faint">Certificates appear here when you finish a course.</p>'}</div>
        <div class="card"><div class="card-head"><h3>My requests</h3></div>${reqs.length ? `<div class="list">${reqs.map((r) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(r.title)}</div><div class="person-sub">${esc(r.provider)} · ${fmt(r.start, { day: 'numeric', month: 'short' })}</div></div>${reqPill(r.status)}</div>`).join('')}</div>` : '<p class="faint">Ask for an external course or conference here.</p>'}</div></div>`;
  }

  // ---------- Shared ----------
  function approvalsCard(id) {
    const l = requests().filter((r) => canAct(r, id));
    if (!l.length) return '';
    return `<div class="card"><div class="card-head"><h3>Training requests</h3></div><div class="list">${l.map((r) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(ctx.fullName(emp(r.empId)))}: ${esc(r.title)}</div><div class="person-sub">${esc(r.provider)} · ${ctx.money(r.cost)}${r.hrdc ? ' · HRD Corp claimable' : ''}</div></div><button class="btn btn-sm btn-primary" data-act="lms-req" data-id="${r.id}">Review</button></div>`).join('')}</div></div>`;
  }
  /** Certificates for the daily reminders (latest completion per person and course, if it has an expiry). */
  const expiringItems = () => {
    const seen = new Set(), out = [];
    [...enrolments()].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')).forEach((e) => {
      const k = `${e.empId}:${e.courseId}`; if (seen.has(k) || !e.completedAt) return; seen.add(k);
      if (e.expires && emp(e.empId) && emp(e.empId).status !== 'Inactive') out.push({ id: e.id, empId: e.empId, title: `${course(e.courseId)?.title || 'Training'} certificate`, expiry: e.expires });
    });
    return out;
  };
  function insights() {
    const out = [];
    if (ctx.role() === 'admin') {
      const exp = expiringItems().filter((x) => x.expiry <= U.addDays(T(), 60));
      if (exp.length) out.push({ tone: exp.some((x) => x.expiry < T()) ? 'bad' : 'warn', icon: 'book', title: `${exp.length} training certificate${exp.length === 1 ? '' : 's'} expiring or expired`, detail: exp.slice(0, 3).map((x) => `${firstOf(x.empId)} (${x.title.replace(' certificate', '')})`).join(', '), action: { label: 'Assign renewals', act: 'lms-sync' }, prio: 2 });
      const p = requests().filter((r) => canAct(r, actor()));
      if (p.length) out.push({ tone: 'info', icon: 'book', title: `${p.length} training request${p.length === 1 ? '' : 's'} to approve`, detail: p.map((r) => `${firstOf(r.empId)}: ${r.title}`).slice(0, 2).join(', '), action: { label: 'Review', act: 'lms-req', id: p[0].id }, prio: 2 });
    }
    if (ctx.role() === 'employee') {
      const me = ctx.me(), todo = R.requiredFor(me, courses()).map((c) => ({ c, s: statusOf(me.id, c) })).filter((x) => ['Overdue', 'Expired', 'Not started', 'In progress'].includes(x.s.status) || x.s.renewal);
      if (todo.length) out.push({ tone: todo.some((x) => ['Overdue', 'Expired'].includes(x.s.status)) ? 'bad' : 'info', icon: 'book', title: `${todo.length} mandatory course${todo.length === 1 ? '' : 's'} to finish`, detail: todo.slice(0, 2).map((x) => `${x.c.title} (${x.s.status.toLowerCase()})`).join(', '), action: { label: 'Open', href: '#my-training' }, prio: 2 });
    }
    return out;
  }
  const todoCount = (id) => { const e = emp(id); return e ? R.requiredFor(e, courses()).filter((c) => ['Overdue', 'Expired', 'Not started', 'In progress'].includes(statusOf(id, c).status)).length : 0; };

  function install(c) {
    ctx = c;
    ctx.VIEWS.training = view;
    ctx.AFTER.training = () => ctx.$('#lms-dept')?.addEventListener('change', (ev) => { ui.dept = ev.target.value; ctx.render(); });
    ctx.VIEWS['my-training'] = myView;
    Object.assign(ctx.ACTIONS, {
      'lms-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'lms-course': (id) => courseForm(id),
      'lms-assign': (id) => assignForm(id),
      'lms-sync': () => { const n = syncMandatory(); ctx.commit(n ? `${n} course${n === 1 ? '' : 's'} assigned` : 'Everyone has their mandatory courses'); },
      'lms-csv': () => { const mc = mandatoryCourses(), rows = R.compliance(ctx.activeEmployees(), courses(), enrolments(), T()); ctx.downloadCSV(`training-compliance-${T()}.csv`, [['Employee', 'Department', ...mc.map((x) => x.title), 'Current %'], ...rows.map((r) => [ctx.fullName(emp(r.empId)), ctx.dept(emp(r.empId).dept)?.name || '', ...mc.map((x) => r.statuses[x.id] || 'Not required'), r.pct])]); },
      'lms-play': (id) => player(id),
      'lms-done': (id, v) => { const en = enrolments().find((x) => x.id === id), c = course(en.courseId); if (!en.done.includes(v)) en.done.push(v); if (!c.quiz?.questions?.length && c.modules.every((m) => en.done.includes(m.id))) complete(en); ctx.save(); ctx.closeOverlay(); ctx.render(); setTimeout(() => player(c.id), 40); if (en.completedAt) ctx.toast('Course complete. Your certificate is ready.', 'ok'); },
      'lms-quiz': (id) => {
        const en = enrolments().find((x) => x.id === id), c = course(en.courseId), f = ctx.$('#lms-quiz');
        const answers = Object.fromEntries(c.quiz.questions.map((q) => [q.id, f.querySelector(`[name="${q.id}"]:checked`)?.value]));
        if (Object.values(answers).some((v) => v == null)) { ctx.toast('Answer every question', 'error'); return; }
        const r = R.scoreQuiz(c.quiz, answers);
        en.attempts = [...(en.attempts || []), { at: T(), pct: r.pct, passed: r.passed }];
        if (r.passed) complete(en);
        ctx.save(); ctx.closeOverlay(); ctx.render(); setTimeout(() => player(c.id), 40);
        ctx.toast(r.passed ? `Passed with ${r.pct}%. Your certificate is ready.` : `${r.pct}%. You need ${c.quiz.passMark}% to pass. Try again.`, r.passed ? 'ok' : 'error');
      },
      'lms-cert': (id) => printCert(id),
      'lms-request': () => requestForm(),
      'lms-req': (id) => reviewRequest(id),
      'lms-req-decide': (id, v) => decide(id, v === 'yes'),
      'lms-req-attended': (id) => { const r = requests().find((x) => x.id === id); r.status = 'Attended'; ctx.closeOverlay(); ctx.commit(`${firstOf(r.empId)} attended ${r.title}`); },
    });
    return { approvalsCard, expiringItems, insights, syncMandatory, todoCount, hasTasks: (id) => requests().some((r) => canAct(r, id)), pendingCount: () => requests().filter((r) => canAct(r, actor())).length, certHtml };
  }
  return { install };
})();
