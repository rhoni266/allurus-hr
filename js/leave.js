// e-Leave: apply (with half days and MC uploads), multi-level approvals with backups, the leave calendar,
// balances with carry-forward, public holidays and the work week, and leave settings. The rules live in
// js/leave-rules.js (AllurusLeaveRules); this file is the screens around them.
window.AllurusLeave = (function () {
  'use strict';
  const R = window.AllurusLeaveRules;
  let ctx = null;
  const st = () => ctx.state;
  const cfg = () => st().settings.leave;
  const T = () => U.today();
  const yearNow = () => +T().slice(0, 4);
  const types = () => cfg().types;
  const UNKNOWN = { id: '', name: 'Leave', color: '#8A8F98', paid: true, days: 0, tiers: [0, 0, 0], includes: [], on: false, calendar: false };
  const typeOf = (id) => types().find((t) => t.id === id) || { ...UNKNOWN, id, name: id || 'Leave' };
  const typeName = (id) => typeOf(id).name;
  // Lower-case a type name inside a sentence, but keep names like “Sick (MC)” as they are.
  const lc = (name) => (/[A-Z]{2}/.test(name) ? name : name.toLowerCase());
  const ui = { tab: 'requests', filter: 'Pending', calMonth: U.monthKey(U.today()), calDept: 'all', holYear: +U.today().slice(0, 4) };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ---------- Data helpers ----------
  const calCtx = (from, to) => R.calendarCtx(cfg(), from, to);
  const leavesOf = (empId) => st().leaves.filter((l) => l.empId === empId);
  const credits = (empId, y) => (st().leaveCredits || []).filter((c) => c.empId === empId && c.date.startsWith(String(y))).reduce((s, c) => s + c.days, 0);
  const carryOf = (empId, typeId, y) => st().leaveCarry?.[y]?.[empId]?.[typeId] || null;
  function balance(empId, typeId, y = yearNow()) {
    const e = ctx.emp(empId) || { start: '' }, t = typeOf(typeId), baseId = t.poolOf || t.id;
    return R.balance({ type: t, types: types(), emp: e, year: y, leaves: leavesOf(empId), carry: carryOf(empId, baseId, y), credits: credits(empId, y), today: T() });
  }
  // Is a leave counted on this day? Working-day types skip rest days and holidays.
  function covers(l, day) {
    if (l.from > day || l.to < day) return false;
    return typeOf(l.type).calendar || R.isWorkingDay(day, calCtx(day, day));
  }
  const onLeave = (empId, day = T()) => st().leaves.some((l) => l.empId === empId && l.status === 'Approved' && covers(l, day));
  const offOn = (day, filter = () => true, statuses = ['Approved']) => st().leaves.filter((l) => statuses.includes(l.status) && covers(l, day) && filter(l));
  const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
  const isAway = (empId) => onLeave(empId, T());
  // Nobody decides their own request, in any view; HR's override needs access to time and leave.
  const mayOverride = () => ctx.role() === 'admin' && (window.AllurusAccess ? window.AllurusAccess.can('time') : true);
  function canActOn(l) {
    if (l.status !== 'Pending' || l.empId === actor()) return '';
    const step = R.nextStep(l.chain);
    if (!step) return mayOverride() ? 'override' : '';
    const as = R.canAct(step, actor(), isAway);
    if (as) return as;
    return mayOverride() ? 'override' : '';
  }
  function isApprover(empId) {
    if (!empId) return false;
    const c = cfg();
    if (c.hr === empId || c.hrBackup === empId) return true;
    return Object.values(c.chains || {}).some((x) => [x.l1, x.l1b, x.l2, x.l2b].includes(empId));
  }
  // Requests this person can decide now (as approver, or as backup while the approver is away).
  const forMe = (empId) => st().leaves.filter((l) => l.status === 'Pending' && R.canAct(R.nextStep(l.chain), empId, isAway));
  // Departments a manager looks after (as L1, L2 or backup).
  const myDepts = (empId) => Object.entries(cfg().chains || {}).filter(([, x]) => [x.l1, x.l1b, x.l2, x.l2b].includes(empId)).map(([d]) => d);
  const nameOf = (id) => ctx.fullName(ctx.emp(id));
  const firstOf = (id) => ctx.emp(id)?.first || '—';
  const fmtRange = (l) => `${U.fmtDate(l.from, { day: 'numeric', month: 'short' })}${l.to !== l.from ? ' – ' + U.fmtDate(l.to, { day: 'numeric', month: 'short' }) : ''}${l.half ? ` (${l.half})` : ''}`;
  const daysLabel = (n) => `${n} day${n === 1 ? '' : 's'}`;
  const pill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'ok', Rejected: 'bad', Cancelled: '' })[s] || ''}">${s}</span>`;
  const dot = (t) => `<i class="lv-dot" style="background:${t.color}" aria-hidden="true"></i>`;
  const fmtBal = (b) => (b.unlimited ? 'No limit' : `${b.available}`);

  // A short "who's next" line for a request.
  function nextText(l) {
    if (l.status !== 'Pending') return l.status === 'Approved' ? 'Approved' : l.status === 'Rejected' ? `Declined${(() => { const s = (l.chain || []).find((x) => x.status === 'rejected'); return s ? ' by ' + firstOf(s.by) : ''; })()}` : l.status;
    const s = R.nextStep(l.chain);
    if (!s) return 'Waiting for HR';
    const cover = s.backup && isAway(s.approver) ? ` · ${firstOf(s.backup)} covering` : '';
    return `Waiting for ${firstOf(s.approver)} (${s.level === 'Final' ? 'HR' : s.level})${cover}`;
  }
  function chainDots(l) {
    const steps = (l.chain || []).filter((s) => s.status !== 'skipped');
    if (!steps.length) return '';
    const next = R.nextStep(l.chain);
    return `<span class="chain-dots" aria-hidden="true">${steps.map((s) => `<i class="cd-${s === next ? 'next' : s.status}" title="${s.level}: ${esc(nameOf(s.approver))}"></i>`).join('')}</span>`;
  }
  const esc = (s) => ctx.esc(s);

  // ---------- Attachments ----------
  // Photos are shrunk to keep localStorage small; PDFs are kept as they are, up to 1 MB.
  function readAttachment(file) {
    return new Promise((resolve, reject) => {
      if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        if (file.size > 1024 * 1024) { reject(new Error('That PDF is over 1 MB. Take a photo of the MC instead.')); return; }
        const fr = new FileReader();
        fr.onload = () => resolve({ name: file.name, mime: 'application/pdf', data: fr.result, size: file.size });
        fr.onerror = () => reject(new Error('Could not read that file.'));
        fr.readAsDataURL(file); return;
      }
      if (!/^image\//.test(file.type)) { reject(new Error('Attach a photo or a PDF.')); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', 0.65);
        URL.revokeObjectURL(img.src);
        resolve({ name: file.name, mime: 'image/jpeg', data, size: Math.round(data.length * 0.75) });
      };
      img.onerror = () => reject(new Error('Could not read that photo.'));
      img.src = URL.createObjectURL(file);
    });
  }
  function attachmentView(a) {
    if (!a) return '<span class="faint">None</span>';
    if (/^image\//.test(a.mime)) return `<figure class="lv-att"><img src="${a.data}" alt="${esc(a.name)}"><figcaption>${esc(a.name)}</figcaption></figure>`;
    return `<button type="button" class="btn btn-sm" data-act="lv-open-att" data-id="${a.__id || ''}">${ctx.icon('doc')}Open ${esc(a.name)}</button>`;
  }
  function openAttachment(id) {
    const l = st().leaves.find((x) => x.id === id); if (!l?.attachment) return;
    const [meta, b64] = l.attachment.data.split(',');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: meta.slice(5).split(';')[0] }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- Apply ----------
  function eligibleTypes(e) {
    return types().filter((t) => t.on).map((t) => ({ t, el: R.eligible(t, e, T()) }));
  }
  function openApply(empId) {
    const self = ctx.role() === 'employee';
    if (self || !empId) empId = self ? ctx.me().id : (empId || ctx.activeEmployees()[0].id);
    let att = null;
    const start = (() => { let d = U.addDays(T(), 7); while (!R.isWorkingDay(d, calCtx(d, d))) d = U.addDays(d, 1); return d; })();
    const typeOptions = (e) => eligibleTypes(e).map(({ t, el }) => `<option value="${t.id}" ${el.ok ? '' : 'disabled'}>${esc(t.name)}${el.ok ? '' : ' (not available)'}</option>`).join('');
    ctx.openModal({
      title: 'Apply for leave', submit: 'Submit request',
      body: `<div class="form-grid lv-apply">
        ${self ? '' : `<div class="field full"><label for="lv-emp">Employee</label><select class="select" id="lv-emp" name="empId">${ctx.activeEmployees().map((x) => `<option value="${x.id}" ${x.id === empId ? 'selected' : ''}>${esc(ctx.fullName(x))}</option>`).join('')}</select></div>`}
        <div class="field full"><label for="lv-type">Leave type</label><select class="select" id="lv-type" name="type">${typeOptions(ctx.emp(empId))}</select><span class="field-hint" id="lv-type-hint"></span></div>
        <div class="field"><label for="lv-from">From</label><input class="input" type="date" id="lv-from" name="from" required value="${start}"></div>
        <div class="field"><label for="lv-to">To</label><input class="input" type="date" id="lv-to" name="to" required value="${start}"></div>
        <fieldset class="field full lv-half" id="lv-half-wrap"><legend>Duration</legend><div class="seg" role="radiogroup">${[['', 'Full day'], ['AM', 'Morning (AM)'], ['PM', 'Afternoon (PM)']].map(([v, l], i) => `<label class="seg-radio"><input type="radio" name="half" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div></fieldset>
        <div class="field full" id="lv-att-wrap"><label for="lv-file">Medical certificate or document</label>
          <div class="rp-row"><img id="lv-att-img" alt="" hidden><div class="rp-actions"><label class="btn" for="lv-file">${ctx.icon('camera')}Snap or upload (photo or PDF)</label><span class="field-hint" id="lv-att-msg">Required for this leave type.</span></div></div>
          <input type="file" id="lv-file" accept="image/*,application/pdf" capture="environment" hidden></div>
        <div class="field full"><label for="lv-reason">Reason</label><textarea class="textarea" id="lv-reason" name="reason" style="min-height:64px" placeholder="For example: fever, MC from Klinik Kesihatan Kemaman"></textarea></div>
        <div class="field full lv-summary" id="lv-sum" aria-live="polite"></div></div>`,
      onSubmit(d) {
        const e = ctx.emp(d.empId || empId), t = typeOf(d.type), el = R.eligible(t, e, T());
        if (!el.ok) { ctx.toast(el.reason, 'error'); return false; }
        if (d.to < d.from) { ctx.toast('The end date must be on or after the start date.', 'error'); return false; }
        const half = t.halfDay && d.from === d.to ? (d.half || '') : '';
        const c = R.countDays({ from: d.from, to: d.to, half, calendar: t.calendar }, calCtx(d.from, d.to));
        if (!c.days) { ctx.toast('Those dates are all rest days or public holidays. Pick at least one working day.', 'error'); return false; }
        if (t.attachment && !att) { ctx.toast(`${t.name} needs a medical certificate or document.`, 'error'); return false; }
        const b = balance(e.id, t.id, +d.from.slice(0, 4));
        if (!b.unlimited && c.days > b.available) { ctx.toast(`Not enough ${lc(typeName(t.poolOf || t.id))} leave: ${b.available} day${b.available === 1 ? '' : 's'} left.`, 'error'); return false; }
        const clash = leavesOf(e.id).find((l) => ['Pending', 'Approved'].includes(l.status) && l.from <= d.to && l.to >= d.from && !(l.half && half && l.half !== half && l.from === d.from));
        if (clash) { ctx.toast(`That overlaps ${lc(typeName(clash.type))} leave on ${fmtRange(clash)}.`, 'error'); return false; }
        const chain = R.buildChain({ applicant: e.id, chain: cfg().chains?.[e.dept], hr: cfg().hr, hrBackup: cfg().hrBackup });
        const rec = { id: U.uid('l'), empId: e.id, type: t.id, from: d.from, to: d.to, half, days: c.days, reason: d.reason.trim(), attachment: att, status: 'Pending', created: T(), chain };
        if (!R.nextStep(chain)) { rec.status = 'Approved'; markAttendance(rec); }
        st().leaves.push(rec);
        ui.filter = 'Pending';
        const next = R.nextStep(chain);
        if (next) ctx.notify?.request('leave', rec, 'submitted', { summary: `${daysLabel(c.days)} ${lc(t.name)}` });
        ctx.commit(next ? `Sent to ${nameOf(next.approver)} for approval` : 'Leave recorded', `${ctx.fullName(e)} applied for ${daysLabel(c.days)} of ${lc(t.name)} leave`);
      },
    });
    const f = ctx.$('#overlay-root form');
    const q = (s) => f.querySelector(s);
    const refresh = () => {
      const e = ctx.emp(q('#lv-emp')?.value || empId), t = typeOf(q('#lv-type').value);
      const from = q('#lv-from').value, to = q('#lv-to').value;
      const single = from && from === to;
      q('#lv-half-wrap').hidden = !(t.halfDay && single);
      q('#lv-att-wrap').hidden = !t.attachment;
      const el = R.eligible(t, e, T());
      q('#lv-type-hint').textContent = el.ok ? (t.note || '') : el.reason;
      const half = t.halfDay && single ? (f.querySelector('input[name=half]:checked')?.value || '') : '';
      const sum = q('#lv-sum');
      if (!from || !to || to < from) { sum.innerHTML = '<span class="field-error">Pick an end date on or after the start date.</span>'; return; }
      const c = R.countDays({ from, to, half, calendar: t.calendar }, calCtx(from, to));
      const b = balance(e.id, t.id, +from.slice(0, 4));
      const hol = R.holidaysFor(+from.slice(0, 4), cfg());
      const skippedTxt = c.skipped.length ? `Not counted: ${c.skipped.slice(0, 4).map((s) => `${U.fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })} (${s.why === 'holiday' ? esc(hol.find((h) => h.date === s.date)?.name || 'holiday') : 'rest day'})`).join(', ')}${c.skipped.length > 4 ? ` and ${c.skipped.length - 4} more` : ''}.` : '';
      const after = b.unlimited ? 'No limit' : `${Math.round((b.available - c.days) * 10) / 10} left after this`;
      const chain = R.buildChain({ applicant: e.id, chain: cfg().chains?.[e.dept], hr: cfg().hr, hrBackup: cfg().hrBackup }).filter((s) => s.status === 'pending');
      sum.innerHTML = `<div class="lv-sum-row"><strong>${daysLabel(c.days)}</strong>${t.calendar ? ' (calendar days)' : ''} · ${t.poolOf ? `from ${esc(lc(typeName(t.poolOf)))} leave · ` : ''}${b.unlimited ? 'No limit' : `${b.available} available, ${after}`}</div>
        ${skippedTxt ? `<div class="faint">${skippedTxt}</div>` : ''}
        ${!b.unlimited && c.days > b.available ? `<div class="field-error">${ctx.icon('x')}Not enough balance for this request.</div>` : ''}
        <div class="faint">Approval: ${chain.length ? chain.map((s) => `${esc(firstOf(s.approver))} (${s.level === 'Final' ? 'HR' : s.level})`).join(' → ') : 'No approver set; it will be recorded straight away.'}</div>`;
    };
    q('#lv-type').addEventListener('change', () => {
      const t = typeOf(q('#lv-type').value);
      if (t.calendar && t.days) q('#lv-to').value = R.addDays(q('#lv-from').value, t.days - 1);
      refresh();
    });
    ['#lv-from', '#lv-to'].forEach((s) => q(s).addEventListener('change', () => { if (s === '#lv-from' && q('#lv-to').value < q('#lv-from').value) q('#lv-to').value = q('#lv-from').value; refresh(); }));
    q('#lv-emp')?.addEventListener('change', () => { const e = ctx.emp(q('#lv-emp').value); const cur = q('#lv-type').value; q('#lv-type').innerHTML = typeOptions(e); if ([...q('#lv-type').options].some((o) => o.value === cur && !o.disabled)) q('#lv-type').value = cur; refresh(); });
    f.querySelectorAll('input[name=half]').forEach((r) => r.addEventListener('change', refresh));
    q('#lv-file').addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0]; if (!file) return;
      const msg = q('#lv-att-msg'); msg.textContent = 'Reading…'; msg.classList.remove('field-error');
      try {
        att = await readAttachment(file);
        const img = q('#lv-att-img');
        if (att.mime.startsWith('image/')) { img.src = att.data; img.hidden = false; } else img.hidden = true;
        msg.textContent = `${att.name} attached (${Math.max(1, Math.round(att.size / 1024))} KB).`;
      } catch (err) { att = null; msg.textContent = err.message; msg.classList.add('field-error'); }
    });
    // Pick the first available type
    const firstOk = [...q('#lv-type').options].find((o) => !o.disabled); if (firstOk) q('#lv-type').value = firstOk.value;
    refresh();
  }

  function markAttendance(l) {
    const c = R.countDays({ from: l.from, to: l.to, calendar: false }, calCtx(l.from, l.to));
    c.dates.forEach((d) => { st().attendance[d] = st().attendance[d] || {}; st().attendance[d][l.empId] = { s: 'leave', in: '' }; });
  }

  // ---------- Review and decide ----------
  function openReview(id) {
    const l = st().leaves.find((x) => x.id === id); if (!l) return;
    const e = ctx.emp(l.empId), t = typeOf(l.type), as = canActOn(l), next = R.nextStep(l.chain);
    const b = balance(l.empId, l.type, +l.from.slice(0, 4));
    const avail = b.unlimited ? null : (l.status === 'Pending' ? r1(b.available + l.days) : b.available);
    const overlap = st().leaves.filter((x) => x.id !== l.id && ['Approved', 'Pending'].includes(x.status) && x.from <= l.to && x.to >= l.from && ctx.emp(x.empId)?.dept === e.dept);
    const hol = R.holidaysFor(+l.from.slice(0, 4), cfg());
    const c = R.countDays({ from: l.from, to: l.to, half: l.half, calendar: t.calendar }, calCtx(l.from, l.to));
    const stepRow = (s) => {
      const who = s.by && s.by !== s.approver ? `${esc(nameOf(s.by))} for ${esc(nameOf(s.approver))}` : esc(nameOf(s.by || s.approver));
      const icon = { approved: 'check', rejected: 'x', skipped: 'minus', cancelled: 'minus', pending: s === next ? 'clock' : 'minus' }[s.status];
      return `<li class="ch-${s === next ? 'next' : s.status}"><span class="ch-ic">${ctx.icon(icon)}</span><div><strong>${s.level === 'Final' ? 'HR (final)' : s.level}</strong> · ${who}
        <div class="faint">${s.status === 'pending' ? (s === next ? `Next to decide${s.backup ? ` · backup ${esc(firstOf(s.backup))}${isAway(s.approver) ? ` is covering while ${esc(firstOf(s.approver))} is on leave` : ''}` : ''}` : 'Waiting') : s.status === 'skipped' ? esc(s.note) : `${s.status === 'approved' ? 'Approved' : s.status === 'rejected' ? 'Declined' : 'Not needed'}${s.at ? ' ' + U.fmtDate(s.at, { day: 'numeric', month: 'short' }) : ''}${s.actedAs === 'backup' ? ' as backup' : s.actedAs === 'override' ? ' by HR admin' : ''}${s.note && s.status !== 'pending' ? ` · “${esc(s.note)}”` : ''}`}</div></div></li>`;
    };
    const actLabel = as === 'override' && next ? `Approve for ${firstOf(next.approver)}` : as === 'backup' ? `Approve as backup` : 'Approve';
    ctx.openModal({
      title: `${ctx.fullName(e)} · ${t.name}`, size: l.attachment ? 'lg' : '', submit: null,
      body: `<div class="${l.attachment ? 'rc-review' : ''}">${l.attachment ? `<div class="rc-side">${attachmentView({ ...l.attachment, __id: l.id })}</div>` : ''}
        <div class="rc-main">
          <dl class="kv"><dt>Status</dt><dd>${pill(l.status)} <span class="faint">${esc(nextText(l))}</span></dd>
            <dt>Dates</dt><dd>${fmtRange(l)} · <strong>${daysLabel(l.days)}</strong>${t.calendar ? ' (calendar days)' : ''}</dd>
            ${c.skipped.length ? `<dt>Not counted</dt><dd class="faint">${c.skipped.map((s) => `${U.fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' })}${s.why === 'holiday' ? ` (${esc(hol.find((h) => h.date === s.date)?.name || 'holiday')})` : ''}`).join(', ')}</dd>` : ''}
            <dt>Reason</dt><dd>${esc(l.reason || '—')}</dd>
            <dt>Balance</dt><dd>${avail === null ? 'No limit' : `${avail} days of ${esc(typeName(t.poolOf || t.id))} before this · <strong>${r1(avail - (l.status === 'Rejected' ? 0 : l.days))}</strong> after`}${b.lapsed ? ` <span class="faint">(${b.lapsed} carried days lapsed)</span>` : ''}</dd>
            ${!t.paid ? `<dt>Pay</dt><dd>Unpaid: deducted from ${esc(e.first)}’s basic pay in payroll.</dd>` : ''}
            ${t.attachment && !l.attachment ? '<dt>Document</dt><dd style="color:var(--bad)">Missing</dd>' : ''}</dl>
          <h4 class="lv-h">Approval</h4><ol class="chain">${(l.chain || []).map(stepRow).join('') || '<li class="faint">Recorded before approval chains were set up.</li>'}</ol>
          <h4 class="lv-h">Also off in ${esc(ctx.dept(e.dept)?.name || 'the team')}</h4>
          ${overlap.length ? `<ul class="lv-overlap">${overlap.map((x) => `<li>${ctx.avatar(nameOf(x.empId), 'sm')}<span><strong>${esc(nameOf(x.empId))}</strong> · ${esc(typeName(x.type))} · ${fmtRange(x)}</span>${pill(x.status)}</li>`).join('')}</ul>` : '<p class="faint">No one else in the department is off on these dates.</p>'}
          ${as ? `<div class="review-box"><div class="field"><label for="lv-note">Note to ${esc(e.first)} (required to decline)</label><input class="input" id="lv-note" placeholder="Optional when approving"></div>
            <div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-danger" data-act="reject-leave" data-id="${l.id}">Decline</button><button class="btn btn-primary" data-act="approve-leave" data-id="${l.id}">${ctx.icon('check')}${esc(actLabel)}</button></div></div>` : ''}
        </div></div>`,
    });
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  function decide(id, approve) {
    const l = st().leaves.find((x) => x.id === id); if (!l) return;
    const as = canActOn(l);
    if (!as) { ctx.toast(l.empId === actor() ? 'You can’t decide your own request. It goes to your approver.' : 'This request is waiting for someone else.', 'error'); return; }
    const note = ctx.$('#lv-note')?.value.trim() || '';
    if (!approve && ctx.$('#lv-note') && !note) { ctx.toast('Add a short note so they know why.', 'error'); ctx.$('#lv-note').focus(); return; }
    const chain = l.chain?.length ? l.chain : [{ level: 'Final', label: 'HR', approver: actor(), backup: '', status: 'pending' }];
    const r = R.decide(chain, { by: actor(), approve, note, at: T(), actedAs: as });
    l.chain = r.chain; l.status = r.status;
    if (r.status === 'Approved') markAttendance(l);
    ctx.closeOverlay();
    const n = ctx.fullName(ctx.emp(l.empId)), next = R.nextStep(l.chain);
    ctx.notify?.request('leave', l, !approve ? 'rejected' : r.status === 'Approved' ? 'approved' : 'step', { summary: `${daysLabel(l.days)} ${lc(typeName(l.type))}, ${fmtRange(l)}`, note });
    ctx.commit(!approve ? `Declined for ${n}` : r.status === 'Approved' ? `Approved for ${n}` : `Approved. Now with ${nameOf(next.approver)}`,
      `${n}'s ${lc(typeName(l.type))} leave was ${!approve ? 'declined' : r.status === 'Approved' ? 'approved' : `approved at ${l.chain.filter((s) => s.status === 'approved').pop()?.level || 'one step'}`}`);
  }

  // ---------- Calendar ----------
  function calendarGrid(mk, filter) {
    const [y, m] = mk.split('-').map(Number), first = `${mk}-01`, last = R.monthEnd(mk);
    const ctxM = calCtx(first, last);
    const hol = Object.fromEntries(R.holidaysFor(y, cfg()).filter((h) => !h.off).map((h) => [h.date, h.name]));
    const rest = R.weekendDays(cfg());
    const list = st().leaves.filter((l) => ['Approved', 'Pending'].includes(l.status) && l.from <= last && l.to >= first && filter(l));
    const lead = (R.dow(first) + 6) % 7;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="lc-cell blank" aria-hidden="true"></div>');
    for (let d = first; d <= last; d = R.addDays(d, 1)) {
      const isRest = rest.includes(R.dow(d)), h = hol[d];
      const here = list.filter((l) => l.from <= d && l.to >= d && (typeOf(l.type).calendar || R.isWorkingDay(d, ctxM)));
      const label = `${U.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}${h ? `, ${h}` : isRest ? ', rest day' : ''}${here.length ? ': ' + here.map((l) => `${firstOf(l.empId)} (${typeName(l.type)}${l.status === 'Pending' ? ', pending' : ''})`).join(', ') : ''}`;
      cells.push(`<div class="lc-cell ${isRest ? 'rest' : ''} ${h ? 'hol' : ''} ${d === T() ? 'today' : ''}" role="gridcell" aria-label="${esc(label)}">
        <div class="lc-date">${+d.slice(8)}</div>${h ? `<div class="lc-hol" title="${esc(h)}">${esc(h)}</div>` : ''}
        <div class="lc-chips">${here.slice(0, 3).map((l) => `<button type="button" class="lc-chip ${l.status === 'Pending' ? 'pending' : ''}" style="--c:${typeOf(l.type).color}" data-act="lv-review" data-id="${l.id}" title="${esc(`${nameOf(l.empId)} · ${typeName(l.type)}${l.half ? ' ' + l.half : ''} · ${l.status}`)}" tabindex="-1"><span class="lc-full">${esc(firstOf(l.empId))}${l.half ? ' ½' : ''}</span><span class="lc-ini">${esc(firstOf(l.empId).slice(0, 1))}</span></button>`).join('')}${here.length > 3 ? `<span class="lc-more">+${here.length - 3}</span>` : ''}</div></div>`);
    }
    const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<div class="lc-head ${rest.includes((i + 1) % 7) ? 'rest' : ''}" role="columnheader">${d}</div>`).join('');
    const legend = types().filter((t) => list.some((l) => l.type === t.id)).map((t) => `<span>${dot(t)}${esc(t.name)}</span>`).join('');
    return `<div class="lc-grid" role="grid" aria-label="Leave in ${MONTHS[m - 1]} ${y}"><div class="lc-row" role="row">${heads}</div><div class="lc-days">${cells.join('')}</div></div>
      <div class="legend lc-legend">${legend}<span><i class="lc-key pending"></i>Pending</span><span><i class="lc-key rest"></i>Rest day</span><span><i class="lc-key hol"></i>Public holiday</span></div>`;
  }
  function calendarCard({ depts = null } = {}) {
    const mk = ui.calMonth, [y, m] = mk.split('-').map(Number);
    const allowed = depts ? st().departments.filter((d) => depts.includes(d.id)) : st().departments;
    const deptSel = allowed.length > 1 ? `<select class="select" data-lv-caldept aria-label="Filter by department"><option value="all">All departments</option>${allowed.map((d) => `<option value="${d.id}" ${ui.calDept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : '';
    const filter = (l) => { const e = ctx.emp(l.empId); if (!e) return false; if (depts && !depts.includes(e.dept)) return false; return ui.calDept === 'all' || e.dept === ui.calDept; };
    return `<div class="card"><div class="card-head lc-toolbar"><div class="actions"><button class="btn btn-icon" data-act="lv-cal" data-v="-1" aria-label="Previous month">${ctx.icon('left')}</button><h3>${MONTHS[m - 1]} ${y}</h3><button class="btn btn-icon" data-act="lv-cal" data-v="1" aria-label="Next month">${ctx.icon('right')}</button>${mk !== U.monthKey(T()) ? '<button class="btn btn-sm btn-ghost" data-act="lv-cal" data-v="0">Today</button>' : ''}</div>${deptSel}</div>
      ${calendarGrid(mk, filter)}</div>`;
  }

  // ---------- Who's off ----------
  function nextWorkingDay(d) { let x = R.addDays(d, 1); for (let i = 0; i < 14 && !R.isWorkingDay(x, calCtx(x, x)); i++) x = R.addDays(x, 1); return x; }
  function whoOffCard({ depts = null, title = 'Who’s off today' } = {}) {
    const inScope = (l) => { const e = ctx.emp(l.empId); return e && (!depts || depts.includes(e.dept)); };
    const today = offOn(T(), inScope), nwd = nextWorkingDay(T()), tomorrow = offOn(nwd, inScope);
    const isTomorrow = nwd === R.addDays(T(), 1);
    const back = (l) => { let d = R.addDays(l.to, 1); while (!R.isWorkingDay(d, calCtx(d, d))) d = R.addDays(d, 1); return d; };
    const restToday = !R.isWorkingDay(T(), calCtx(T(), T()));
    return `<div class="card"><div class="card-head"><h3>${title}</h3><span class="hint">${today.length ? `${today.length} off` : ''}</span></div>
      ${restToday ? `<p class="faint" style="margin-bottom:8px">${R.holidaysFor(yearNow(), cfg()).find((h) => h.date === T() && !h.off)?.name || 'Today is a rest day'}.</p>` : ''}
      ${today.length ? `<div class="list">${today.map((l) => `<div class="list-item">${ctx.avatar(nameOf(l.empId), 'sm')}<div class="grow"><div class="person-name">${esc(nameOf(l.empId))}</div><div class="person-sub">${dot(typeOf(l.type))}${esc(typeName(l.type))}${l.half ? ` · ${l.half}` : ''} · back ${U.fmtDate(back(l), { weekday: 'short', day: 'numeric', month: 'short' })}</div></div></div>`).join('')}</div>` : `<div class="empty"><strong>Everyone’s in</strong>No approved leave today.</div>`}
      <p class="lv-tomorrow">${ctx.icon('calendar')}<span><strong>${isTomorrow ? 'Tomorrow' : U.fmtDate(nwd, { weekday: 'long' })}:</strong> ${tomorrow.length ? tomorrow.map((l) => `${esc(firstOf(l.empId))} (${esc(typeName(l.type))})`).join(', ') : 'no one off'}</span></p>
      ${ctx.role() === 'admin' ? `<button class="hint card-link link-btn" data-act="lv-open-cal">Leave calendar ${ctx.icon('right')}</button>` : '<a class="hint card-link" href="#my-approvals">Team calendar ' + ctx.icon('right') + '</a>'}</div>`;
  }

  // ---------- Insights for dashboards ----------
  function insights() {
    const out = [], r = ctx.role(), add = (tone, icon, title, detail, action, prio) => out.push({ tone, icon, title, detail, action, prio });
    const nwd = nextWorkingDay(T());
    const when = nwd === R.addDays(T(), 1) ? 'tomorrow' : `on ${U.fmtDate(nwd, { weekday: 'long' })}`;
    if (r === 'admin') {
      const today = offOn(T());
      if (today.length) add('info', 'calendar', `${today.length} ${today.length === 1 ? 'person is' : 'people are'} off today`, today.slice(0, 4).map((l) => firstOf(l.empId)).join(', ') + (today.length > 4 ? ' and others' : ''), { label: 'Calendar', act: 'lv-open-cal' }, 1);
      const tm = offOn(nwd);
      if (tm.length) add('info', 'calendar', `${tm.length === 1 ? `${firstOf(tm[0].empId)} is` : `${tm.length} people are`} off ${when}`, tm.map((l) => `${firstOf(l.empId)} (${typeName(l.type)})`).slice(0, 4).join(', '), { label: 'Calendar', act: 'lv-open-cal' }, 2);
      const lapse = types().filter((t) => t.carryMax > 0 && t.carryExpiry);
      lapse.forEach((t) => {
        const exp = R.monthEnd(`${yearNow()}-${String(t.carryExpiry).padStart(2, '0')}`);
        const left = Math.round((U.parse(exp) - U.parse(T())) / 864e5);
        const at = Object.entries(st().leaveCarry?.[yearNow()] || {}).filter(([eid, x]) => x[t.id] && balance(eid, t.id).available > 0).length;
        if (left >= 0 && left <= 45 && at) add('warn', 'calendar', `Carried ${t.name.toLowerCase()} leave lapses in ${left} days`, `${at} ${at === 1 ? 'person has' : 'people have'} carried days to use by ${U.fmtDate(exp, { day: 'numeric', month: 'short' })}.`, { label: 'Balances', act: 'lv-open-bal' }, 2);
      });
    }
    if (r === 'employee') {
      const me = ctx.me();
      const mine = forMe(me.id);
      if (mine.length) add('warn', 'check', `${mine.length} leave ${mine.length === 1 ? 'request needs' : 'requests need'} your approval`, mine.slice(0, 3).map((l) => `${firstOf(l.empId)} (${typeName(l.type)})`).join(', '), { label: 'Review', href: '#my-approvals' }, 3);
      const depts = myDepts(me.id);
      if (depts.length) {
        const tm = offOn(nwd, (l) => depts.includes(ctx.emp(l.empId)?.dept) && l.empId !== me.id);
        if (tm.length) add('info', 'calendar', `${tm.length === 1 ? `${firstOf(tm[0].empId)} is` : `${tm.length} of your team are`} off ${when}`, tm.map((l) => `${firstOf(l.empId)} (${typeName(l.type)})`).join(', '), { label: 'Team calendar', href: '#my-approvals' }, 2);
        const covering = depts.map((d) => cfg().chains[d]).filter((c) => [c.l1b, c.l2b].includes(me.id) && [c.l1, c.l2].some((a) => a && isAway(a)));
        if (covering.length) add('info', 'people', 'You’re covering approvals today', `Your manager is on leave, so leave requests come to you.`, { label: 'Approvals', href: '#my-approvals' }, 2);
      }
      const b = balance(me.id, 'annual');
      if (b.lapsed) add('info', 'calendar', `${b.lapsed} carried annual days lapsed`, 'They had to be used by the expiry date in your leave policy.', { label: 'My time off', href: '#my-leave' }, 0);
    }
    return out;
  }

  // ---------- Views ----------
  function requestRows(list, { showEmp = true } = {}) {
    return list.map((l) => {
      const e = ctx.emp(l.empId); if (!e) return '';
      const t = typeOf(l.type), as = canActOn(l);
      return `<tr>
        ${showEmp ? `<td>${ctx.person(e, ctx.dept(e.dept)?.name || e.role)}</td>` : ''}
        <td><span class="lv-type">${dot(t)}${esc(t.name)}</span>${l.attachment ? ` <span class="tag" title="Document attached">${ctx.icon('doc')}</span>` : ''}</td>
        <td class="num" style="white-space:nowrap">${fmtRange(l)}</td><td class="r num">${l.days}<span class="sm-only"> ${l.days === 1 ? 'day' : 'days'}</span></td>
        <td class="hide-sm"><div class="lv-next">${chainDots(l)}<span class="faint">${esc(nextText(l))}</span></div></td>
        <td>${pill(l.status)}</td>
        <td><div class="row-actions">${as ? `<button class="btn btn-sm btn-primary" data-act="lv-review" data-id="${l.id}">Review</button>` : `<button class="btn btn-sm btn-ghost" data-act="lv-review" data-id="${l.id}">View</button>`}
          ${ctx.role() === 'admin' && l.status !== 'Pending' ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="del-leave" data-id="${l.id}" aria-label="Delete this request">${ctx.icon('trash')}</button>` : ''}
          ${ctx.role() === 'employee' && l.empId === ctx.me().id && l.status === 'Pending' ? `<button class="btn btn-sm btn-ghost" data-act="del-leave" data-id="${l.id}">Cancel</button>` : ''}</div></td></tr>`;
    }).join('');
  }
  function adminView() {
    const c = cfg(), y = yearNow(), hols = R.holidaysFor(y, c).filter((h) => !h.off);
    const tabs = [['requests', 'Requests'], ['calendar', 'Calendar'], ['balances', 'Balances']];
    const counts = { Pending: 0, Approved: 0, Rejected: 0 }; st().leaves.forEach((l) => { if (counts[l.status] != null) counts[l.status]++; });
    let body = '';
    if (ui.tab === 'requests') {
      const list = st().leaves.filter((l) => ui.filter === 'All' || l.status === ui.filter).sort((a, b) => (ui.filter === 'Pending' ? a.from.localeCompare(b.from) : b.from.localeCompare(a.from)));
      body = `<div class="card card-flush"><div class="toolbar"><div class="seg" role="group" aria-label="Filter requests">${['Pending', 'Approved', 'Rejected', 'All'].map((s) => `<button data-act="leave-filter" data-v="${s}" class="${ui.filter === s ? 'on' : ''}" aria-pressed="${ui.filter === s}">${s}${s !== 'All' ? ` <span class="faint">${counts[s]}</span>` : ''}</button>`).join('')}</div></div>
        <div class="table-wrap"><table class="lv-req"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="r">Days</th><th class="hide-sm">Approval</th><th>Status</th><th></th></tr></thead>
        <tbody>${requestRows(list)}</tbody></table>${list.length ? '' : `<div class="empty"><strong>No ${ui.filter.toLowerCase()} requests</strong>${ui.filter === 'Pending' ? 'You’re all caught up.' : ''}</div>`}</div></div>`;
    } else if (ui.tab === 'calendar') body = calendarCard();
    else body = balancesCard();
    return `<div class="page-head"><div><div class="eyebrow">Time off</div><h1>Leave</h1>
        <p class="sub">${c.state ? `${esc(c.state)} calendar` : 'Company calendar'} · rest days ${(R.WEEKEND_LABELS[c.weekend] || R.WEEKEND_LABELS['sat-sun']).replace(' only', '')} · ${hols.length} public holidays in ${y}. <a href="#settings" data-act="lv-goto-settings">Leave settings</a></p></div>
        <div class="actions"><button class="btn" data-act="lv-export">${ctx.icon('download')}Export CSV</button><button class="btn btn-primary" data-act="new-leave">${ctx.icon('plus')}New request</button></div></div>
      <div class="seg lv-tabs" role="tablist" aria-label="Leave views">${tabs.map(([id, l]) => `<button role="tab" aria-selected="${ui.tab === id}" class="${ui.tab === id ? 'on' : ''}" data-act="lv-tab" data-v="${id}">${l}${id === 'requests' && counts.Pending ? ` <span class="faint">${counts.Pending}</span>` : ''}</button>`).join('')}</div>
      ${ui.tab === 'calendar' ? `<div class="grid g-main lv-top"><div>${body}</div><div class="lv-side">${whoOffCard()}${holidayListCard(4)}</div></div>` : `${body}<div class="grid g-2">${whoOffCard()}${holidayListCard(4)}</div>`}`;
  }
  function balancesCard() {
    const y = yearNow();
    const cols = ['annual', 'sick', 'hospital', 'replacement'].map(typeOf).filter((t) => t.on);
    const unpaid = typeOf('unpaid');
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Balances, ${y}</h3><button class="btn btn-sm" data-act="lv-credit">${ctx.icon('plus')}Grant replacement days</button></div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th>${cols.map((t) => `<th class="r">${esc(t.name)}</th>`).join('')}${unpaid.on ? '<th class="r hide-sm">Unpaid taken</th>' : ''}</tr></thead>
      <tbody>${ctx.activeEmployees().sort((a, b) => a.first.localeCompare(b.first)).map((e) => `<tr><td>${ctx.person(e)}</td>${cols.map((t) => {
        const b = balance(e.id, t.id, y);
        const carry = carryOf(e.id, t.id, y);
        return `<td class="r num"><strong>${fmtBal(b)}</strong><span class="faint"> / ${b.unlimited ? '—' : r1(b.entitled + (carry?.days || 0) - b.lapsed)}</span>${carry ? `<div class="person-sub">${b.lapsed ? `${b.lapsed} carried lapsed` : `${carry.days} carried · use by ${U.fmtDate(carry.expires, { day: 'numeric', month: 'short' })}`}</div>` : ''}${b.pending ? `<div class="person-sub">${b.pending} pending</div>` : ''}</td>`;
      }).join('')}${unpaid.on ? `<td class="r num hide-sm">${balance(e.id, 'unpaid', y).used || '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div></div>`;
  }
  function holidayListCard(n = 5) {
    const up = [yearNow(), yearNow() + 1].flatMap((y) => R.holidaysFor(y, cfg())).filter((h) => !h.off && h.date >= T()).slice(0, n);
    return `<div class="card"><div class="card-head"><h3>Public holidays</h3>${ctx.role() === 'admin' ? '<a class="hint" href="#settings" data-act="lv-goto-settings">Edit</a>' : `<span class="hint">${esc(cfg().state || '')}</span>`}</div>
      ${up.length ? `<div class="list">${up.map((h) => `<div class="list-item"><div class="lv-hdate"><b>${+h.date.slice(8)}</b><span>${U.fmtDate(h.date, { month: 'short' })}</span></div><div class="grow"><div class="person-name" style="white-space:normal">${esc(h.name)}</div><div class="person-sub">${U.fmtDate(h.date, { weekday: 'long' })}${h.kind === 'state' ? ` · ${esc(cfg().state)}` : h.kind === 'company' ? ' · Company' : h.kind === 'replacement' ? ' · Replacement' : ''}</div></div></div>`).join('')}</div>` : '<div class="empty"><strong>None coming up</strong>Add next year’s holidays in Settings.</div>'}</div>`;
  }
  function myView() {
    const e = ctx.me(), y = yearNow();
    const list = leavesOf(e.id).sort((a, b) => b.from.localeCompare(a.from));
    const cards = types().filter((t) => t.on && !t.poolOf && R.eligible(t, e, T()).ok).map((t) => ({ t, b: balance(e.id, t.id, y) })).filter(({ t, b }) => !(t.earned && !b.entitled) && !(t.calendar && !b.used && !b.pending) && !(b.unlimited && !b.used));
    return `<div class="page-head"><div><div class="eyebrow">Time off</div><h1>My time off</h1><p class="sub">Rest days and public holidays are not counted. ${esc(cfg().state ? cfg().state + ' calendar.' : '')}</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="new-leave">${ctx.icon('plus')}Apply for leave</button></div></div>
      <div class="grid g-4 keep-2">${cards.map(({ t, b }) => { const carry = carryOf(e.id, t.id, y); const total = b.unlimited ? 0 : b.entitled + (carry?.days || 0) - b.lapsed; return `<div class="card kpi"><div class="kpi-label">${dot(t)}${esc(t.name)}</div>
        <div class="kpi-value">${b.unlimited ? `${b.used}<span class="faint" style="font-size:16px"> taken</span>` : `${b.available}<span class="faint" style="font-size:16px"> left</span>`}</div>
        ${b.unlimited ? '' : `<div class="progress"><i style="width:${total ? Math.min(100, ((b.used + b.pending) / total) * 100) : 0}%;background:${t.color}"></i></div>`}
        <div class="kpi-foot">${b.unlimited ? 'No limit' : `of ${r1(total)} · ${b.used} used${b.pending ? ` · ${b.pending} pending` : ''}`}${carry ? `<br>${b.lapsed ? `${b.lapsed} carried days lapsed ${U.fmtDate(carry.expires, { day: 'numeric', month: 'short' })}` : `Includes ${carry.days} carried, use by ${U.fmtDate(carry.expires, { day: 'numeric', month: 'short' })}`}` : ''}</div></div>`; }).join('')}</div>
      <div class="grid g-main"><div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>My requests</h3></div>
        <div class="table-wrap"><table class="lv-req"><thead><tr><th>Type</th><th>Dates</th><th class="r">Days</th><th class="hide-sm">Approval</th><th>Status</th><th></th></tr></thead><tbody>${requestRows(list, { showEmp: false })}</tbody></table>
        ${list.length ? '' : '<div class="empty"><strong>No requests yet</strong>Plan a break with Apply for leave.</div>'}</div></div>
        <div>${holidayListCard(6)}</div></div>`;
  }
  function approvalsView() {
    const e = ctx.me(), mine = forMe(e.id), depts = myDepts(e.id);
    const watching = st().leaves.filter((l) => l.status === 'Pending' && !mine.includes(l) && depts.includes(ctx.emp(l.empId)?.dept) && l.empId !== e.id);
    const covering = depts.map((d) => ({ d, c: cfg().chains[d] })).filter(({ c }) => [c.l1b, c.l2b].includes(e.id) && [c.l1, c.l2].some((a) => a && isAway(a)));
    if (!depts.length && ui.calDept === 'all') ui.calDept = 'all';
    return `<div class="page-head"><div><div class="eyebrow">Time off</div><h1>Approvals</h1><p class="sub">Leave requests waiting for you, and who in your team is off.</p></div></div>
      ${covering.length ? `<div class="lock-banner info">${ctx.icon('people')}<span>You’re covering for ${covering.map(({ d, c }) => `${esc(nameOf([c.l1, c.l2].find((a) => a && isAway(a))))} (${esc(ctx.dept(d)?.name)})`).join(', ')} while they’re on leave.</span></div>` : ''}
      <div class="grid g-main"><div class="card card-flush"><div class="card-head" style="padding-bottom:12px"><h3>Waiting for you</h3><span class="hint">${mine.length}</span></div>
        <div class="table-wrap"><table class="lv-req"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="r">Days</th><th class="hide-sm">Approval</th><th>Status</th><th></th></tr></thead><tbody>${requestRows(mine)}</tbody></table>
        ${mine.length ? '' : '<div class="empty"><strong>All caught up</strong>New requests from your team will show here.</div>'}</div>
        ${watching.length ? `<div class="card-head" style="padding:14px 22px 12px"><h3>With someone else</h3></div><div class="table-wrap"><table class="lv-req"><tbody>${requestRows(watching)}</tbody></table></div>` : ''}</div>
        <div>${whoOffCard({ depts, title: 'Who’s off today in your team' })}</div></div>
      ${calendarCard({ depts })}`;
  }

  // ---------- Settings ----------
  function settingsCards() {
    const c = cfg(), emps = ctx.activeEmployees().sort((a, b) => a.first.localeCompare(b.first));
    const opt = (v, none = 'None') => `<option value="">${none}</option>${emps.map((e) => `<option value="${e.id}" ${v === e.id ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}`;
    const monthSel = (t) => `<select class="select" data-lt="${t.id}" data-f="carryExpiry" aria-label="${esc(t.name)} carried days expire at the end of"><option value="0">Never (end of next year)</option>${MONTHS.map((m, i) => `<option value="${i + 1}" ${t.carryExpiry === i + 1 ? 'selected' : ''}>End of ${m}</option>`).join('')}</select>`;
    const y = ui.holYear, hols = R.holidaysFor(y, c), built = R.builtInYears().includes(y);
    const rows = types().map((t) => `<tr class="${t.on ? '' : 'off'}">
      <td><input class="input" data-lt="${t.id}" data-f="name" value="${esc(t.name)}" aria-label="Leave type name"><div class="person-sub" style="white-space:normal">${esc(t.note || '')}</div></td>
      <td>${t.poolOf ? `<span class="faint">From ${esc(typeName(t.poolOf).toLowerCase())}</span>` : t.earned ? '<span class="faint">Granted by HR</span>' : t.days === null ? '<span class="faint">No limit</span>'
        : t.byService ? `<div class="lt-tiers">${t.tiers.map((d, i) => `<label><span>${['<2y', '2–5y', '5y+'][i]}</span><input class="input num" type="number" min="0" max="365" data-lt="${t.id}" data-f="tier${i}" value="${d}" aria-label="${esc(t.name)} days, ${R.TIER_LABELS[i]}"></label>`).join('')}</div>`
        : `<input class="input num" type="number" min="0" max="365" data-lt="${t.id}" data-f="days" value="${t.days}" aria-label="${esc(t.name)} days a year" style="width:76px">`}${t.calendar ? '<div class="person-sub">Calendar days</div>' : ''}</td>
      <td><input type="checkbox" data-lt="${t.id}" data-f="paid" ${t.paid ? 'checked' : ''} aria-label="${esc(t.name)} is paid"></td>
      <td><input type="checkbox" data-lt="${t.id}" data-f="attachment" ${t.attachment ? 'checked' : ''} aria-label="${esc(t.name)} needs an attachment"></td>
      <td><input type="checkbox" data-lt="${t.id}" data-f="halfDay" ${t.halfDay ? 'checked' : ''} ${t.calendar ? 'disabled' : ''} aria-label="${esc(t.name)} allows half days"></td>
      <td>${t.poolOf || t.days === null || t.earned ? '<span class="faint">—</span>' : `<div class="lt-carry"><input class="input num" type="number" min="0" max="60" data-lt="${t.id}" data-f="carryMax" value="${t.carryMax}" aria-label="${esc(t.name)} days that can be carried forward" style="width:64px">${t.carryMax ? monthSel(t) : ''}</div>`}</td>
      <td><select class="select" data-lt="${t.id}" data-f="gender" aria-label="${esc(t.name)} is for"><option value="any" ${t.gender === 'any' ? 'selected' : ''}>Everyone</option><option value="female" ${t.gender === 'female' ? 'selected' : ''}>Women</option><option value="male" ${t.gender === 'male' ? 'selected' : ''}>Men</option></select>
        <label class="check lt-small"><input type="checkbox" data-lt="${t.id}" data-f="married" ${t.married ? 'checked' : ''}><span>Married</span></label>${t.minServiceMonths ? `<div class="person-sub">${t.minServiceMonths}+ months’ service</div>` : ''}</td>
      <td><input type="checkbox" data-lt="${t.id}" data-f="prorate" ${t.prorate ? 'checked' : ''} ${t.days === null || t.poolOf || t.earned ? 'disabled' : ''} aria-label="Pro-rate ${esc(t.name)} for new joiners"></td>
      <td><input type="checkbox" data-lt="${t.id}" data-f="on" ${t.on ? 'checked' : ''} aria-label="Offer ${esc(t.name)}"></td>
      <td>${t.builtin ? '' : `<button class="btn btn-sm btn-icon btn-ghost" data-act="lv-type-del" data-id="${t.id}" aria-label="Remove ${esc(t.name)}">${ctx.icon('trash')}</button>`}</td></tr>`).join('');
    const preview = R.carryForward({ types: types(), employees: ctx.activeEmployees(), leaves: st().leaves, carries: st().leaveCarry?.[yearNow()] || {}, year: yearNow() });
    const done = c.lastCarry && c.lastCarry.year === yearNow();
    const carriedIn = Object.entries(st().leaveCarry?.[yearNow()] || {}).flatMap(([eid, x]) => Object.entries(x).map(([tid, v]) => ({ eid, tid, v, b: balance(eid, tid) })));
    return `
      <div class="card card-flush" id="leave-types"><div class="card-head" style="padding-bottom:6px"><h3>Leave types</h3><button class="btn btn-sm" data-act="lv-type-add">${ctx.icon('plus')}Add a leave type</button></div>
        <p class="muted" style="padding:0 22px 12px">Days are per calendar year. Annual and sick leave follow years of service (as at 1 January). New joiners get a share for the months they work, rounded to the nearest day.</p>
        <div class="table-wrap"><table class="policy lt-table"><thead><tr><th>Leave type</th><th>Days a year</th><th>Paid</th><th>Needs MC or document</th><th>Half day</th><th>Carry forward</th><th>Who can take it</th><th>Pro-rate</th><th>Offered</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="settings-row" style="padding:14px 22px"><div><div class="label">Unpaid leave deduction</div><div class="desc">Basic pay ÷ this number × unpaid days, taken off in payroll before EPF, SOCSO, EIS and PCB.</div></div>
          <div class="seg" role="group" aria-label="Unpaid leave divisor">${[['working', 'Working days in the month'], ['26', '26 days'], ['calendar', 'Days in the month']].map(([v, l]) => `<button data-act="lv-divisor" data-v="${v}" class="${c.unpaidDivisor === v ? 'on' : ''}" aria-pressed="${c.unpaidDivisor === v}">${l}</button>`).join('')}</div></div>
        <p class="disclaimer" style="padding:0 22px 18px">${ctx.icon('pin')}<span>Defaults follow the Employment Act 1955 minimums (annual 8/12/16, sick 14/18/22, hospitalisation 60, maternity 98, paternity 7). Check them against your contracts and the latest amendments.</span></p></div>

      <div class="card" id="leave-holidays"><div class="card-head"><h3>Public holidays and work week</h3><div class="actions"><button class="btn btn-sm btn-icon" data-act="lv-holyear" data-v="-1" aria-label="Previous year">${ctx.icon('left')}</button><strong class="num">${y}</strong><button class="btn btn-sm btn-icon" data-act="lv-holyear" data-v="1" aria-label="Next year">${ctx.icon('right')}</button></div></div>
        <div class="settings-row"><div><div class="label"><label for="lv-state">State</label></div><div class="desc">Sets the state holidays and the usual rest days.</div></div><select class="select" id="lv-state"><option value="">Outside Malaysia (no built-in holidays)</option>${R.STATES.map((s) => `<option ${c.state === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="settings-row"><div><div class="label">Rest days</div><div class="desc">Kedah, Kelantan and Terengganu usually rest on Friday and Saturday. Leave days and attendance skip rest days.</div></div><div class="seg" role="group" aria-label="Rest days">${[['sat-sun', 'Saturday & Sunday'], ['fri-sat', 'Friday & Saturday'], ['sun', 'Sunday only']].map(([v, l]) => `<button data-act="lv-weekend" data-v="${v}" class="${c.weekend === v ? 'on' : ''}" aria-pressed="${c.weekend === v}">${l}</button>`).join('')}</div></div>
        <div class="settings-row"><div><div class="label">Replacement holidays</div><div class="desc">When a holiday falls on a rest day, the next working day is a holiday.</div></div><div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="lv-replace" data-v="${v}" class="${(c.replacement !== false ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${c.state && !built ? `<div class="lock-banner warn">${ctx.icon('pin')}<span>No built-in holidays for ${y} yet. Add them below as company holidays once they’re gazetted.</span></div>` : ''}
        <div class="table-wrap"><table class="hol-table"><thead><tr><th>Date</th><th>Holiday</th><th class="hide-sm">Type</th><th>Observed</th><th></th></tr></thead><tbody>
        ${hols.map((h) => `<tr class="${h.off ? 'off' : ''}"><td class="num" style="white-space:nowrap">${U.fmtDate(h.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${esc(h.name)}</td><td class="hide-sm"><span class="tag">${{ national: 'National', state: esc(c.state), company: 'Company', replacement: 'Replacement' }[h.kind]}</span></td>
          <td>${h.kind === 'national' || h.kind === 'state' ? `<input type="checkbox" data-act-hol="${h.date}" ${h.off ? '' : 'checked'} aria-label="Observe ${esc(h.name)}">` : '<span class="faint">Yes</span>'}</td>
          <td>${h.kind === 'company' ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="lv-hol-del" data-id="${h.date}" data-v="${esc(h.name)}" aria-label="Remove ${esc(h.name)}">${ctx.icon('trash')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5"><div class="empty">No holidays for ${y}.</div></td></tr>`}</tbody></table></div>
        <form class="lv-hol-add" id="lv-hol-add"><input class="input" type="date" name="date" required aria-label="Company holiday date" value="${y}-12-24"><input class="input" name="name" required placeholder="Company holiday, e.g. Family Day" aria-label="Company holiday name"><button class="btn" type="submit">${ctx.icon('plus')}Add holiday</button></form>
        <p class="disclaimer">${ctx.icon('pin')}<span>Built-in dates are for ${R.builtInYears().join(', ')} and must be checked against the official gazette (kabinet.gov.my and the State Secretary). Islamic holidays can move by a day after moon sighting.</span></p></div>

      <div class="card card-flush" id="leave-approvals"><div class="card-head" style="padding-bottom:6px"><h3>Leave approvals</h3></div>
        <p class="muted" style="padding:0 22px 12px">Up to three steps per department: L1 (usually the department head), an optional L2, then HR. A backup decides when an approver is on leave. Steps are skipped when someone would approve their own leave.</p>
        <div class="settings-row" style="padding:12px 22px"><div><div class="label">HR (final approver)</div><div class="desc">Approves every request last.</div></div><div class="actions"><select class="select" data-lv-hr="hr" aria-label="HR approver">${opt(c.hr)}</select><select class="select" data-lv-hr="hrBackup" aria-label="HR backup">${opt(c.hrBackup, 'No backup')}</select></div></div>
        <div class="table-wrap"><table class="policy"><thead><tr><th>Department</th><th>L1</th><th>L1 backup</th><th>L2 (optional)</th><th>L2 backup</th></tr></thead><tbody>
        ${st().departments.map((d) => { const ch = c.chains?.[d.id] || {}; return `<tr><td><span class="dept"><i style="background:${d.color}"></i>${esc(d.name)}</span></td>${['l1', 'l1b', 'l2', 'l2b'].map((k) => `<td><select class="select" data-lv-chain="${d.id}" data-f="${k}" aria-label="${esc(d.name)} ${k.toUpperCase()}">${opt(ch[k] || '', k === 'l1' ? 'None (straight to L2/HR)' : k === 'l2' ? 'None' : 'No backup')}</select></td>`).join('')}</tr>`; }).join('')}</tbody></table></div></div>

      <div class="card card-flush" id="leave-yearend"><div class="card-head" style="padding-bottom:6px"><h3>Year-end carry forward</h3><button class="btn btn-sm ${done ? '' : 'btn-primary'}" data-act="lv-carry">${ctx.icon('calendar')}${done ? 'Run again' : `Carry ${yearNow()} into ${yearNow() + 1}`}</button></div>
        <p class="muted" style="padding:0 22px 12px">${done ? `Done on ${U.fmtDate(c.lastCarry.at)}. Running again replaces the days carried into ${yearNow() + 1}.` : 'Run this after the last working day of the year. It moves each person’s unused days, up to the carry-forward limit, into next year with an expiry date. In the demo you can run it any time.'}</p>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Leave</th><th class="r">Unused</th><th class="r">Carried</th><th class="r hide-sm">Forfeited</th><th class="hide-sm">Use by</th></tr></thead>
        <tbody>${preview.slice(0, 50).map((r) => `<tr><td>${esc(nameOf(r.empId))}</td><td>${esc(typeName(r.typeId))}</td><td class="r num">${r.unused}</td><td class="r num"><strong>${r.carry}</strong></td><td class="r num hide-sm">${r.forfeited || '—'}</td><td class="hide-sm">${U.fmtDate(r.expires)}</td></tr>`).join('')}</tbody></table>
        ${preview.length ? '' : '<div class="empty"><strong>Nothing to carry</strong>No one has unused days in leave types with a carry-forward limit.</div>'}</div>
        ${carriedIn.length ? `<div style="padding:12px 22px 18px"><div class="label" style="margin-bottom:6px">Carried into ${yearNow()}</div><div class="chips">${carriedIn.map(({ eid, tid, v, b }) => `<span class="chip" style="cursor:default">${esc(firstOf(eid))} · ${v.days} ${esc(lc(typeName(tid)))}<span class="n">${b.lapsed ? `${b.lapsed} lapsed` : `by ${U.fmtDate(v.expires, { day: 'numeric', month: 'short' })}`}</span></span>`).join('')}</div></div>` : ''}</div>`;
  }
  function bindSettings() {
    const c = cfg();
    ctx.$$('[data-lt]').forEach((el) => el.addEventListener('change', () => {
      const t = types().find((x) => x.id === el.dataset.lt), f = el.dataset.f; if (!t) return;
      if (el.type === 'checkbox') t[f] = el.checked;
      else if (f === 'name') t.name = el.value.trim() || t.name;
      else if (f === 'gender') t.gender = el.value;
      else if (/^tier\d$/.test(f)) t.tiers[+f.slice(4)] = Math.max(0, Math.round(+el.value || 0));
      else t[f] = Math.max(0, Math.round(+el.value || 0));
      ctx.commit('Leave policy saved');
    }));
    ctx.$('#lv-state')?.addEventListener('change', (ev) => { c.state = ev.target.value; c.weekend = c.state ? R.stateWeekend(c.state) : c.weekend; ctx.commit(c.state ? `${c.state} calendar. Rest days set to ${c.weekend === 'fri-sat' ? 'Friday and Saturday' : 'Saturday and Sunday'}.` : 'Built-in holidays turned off'); });
    ctx.$$('[data-act-hol]').forEach((el) => el.addEventListener('change', () => {
      const off = new Set(c.holidaysOff || []); if (el.checked) off.delete(el.dataset.actHol); else off.add(el.dataset.actHol);
      c.holidaysOff = [...off]; ctx.commit(el.checked ? 'Holiday observed' : 'Holiday removed from your calendar');
    }));
    ctx.$('#lv-hol-add')?.addEventListener('submit', (ev) => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target));
      if (!d.date || !d.name.trim()) return;
      c.holidaysCustom = [...(c.holidaysCustom || []), { date: d.date, name: d.name.trim() }];
      ui.holYear = +d.date.slice(0, 4); ctx.commit(`${d.name.trim()} added`);
    });
    ctx.$$('[data-lv-hr]').forEach((el) => el.addEventListener('change', () => { c[el.dataset.lvHr] = el.value; ctx.commit('Approvers saved'); }));
    ctx.$$('[data-lv-chain]').forEach((el) => el.addEventListener('change', () => { c.chains = c.chains || {}; const d = (c.chains[el.dataset.lvChain] = c.chains[el.dataset.lvChain] || {}); d[el.dataset.f] = el.value; ctx.commit('Approval chain saved'); }));
  }
  function bindViews() {
    ctx.$$('[data-lv-caldept]').forEach((el) => el.addEventListener('change', () => { ui.calDept = el.value; ctx.render(); }));
  }

  // ---------- Install ----------
  function install(c) {
    ctx = c;
    const { VIEWS, AFTER, ACTIONS } = ctx;
    VIEWS.leave = adminView; AFTER.leave = bindViews;
    VIEWS['my-leave'] = myView; AFTER['my-leave'] = bindViews;
    VIEWS['my-approvals'] = approvalsView; AFTER['my-approvals'] = bindViews;
    Object.assign(ACTIONS, {
      'new-leave': (id) => openApply(id),
      'lv-review': (id) => openReview(id),
      'approve-leave': (id) => decide(id, true),
      'reject-leave': (id) => decide(id, false),
      'del-leave': (id) => { const l = st().leaves.find((x) => x.id === id); st().leaves = st().leaves.filter((x) => x.id !== id); ctx.commit(l && l.status === 'Pending' && ctx.role() === 'employee' ? 'Request cancelled' : 'Request deleted'); },
      'leave-filter': (_, v) => { ui.filter = v; ctx.render(); },
      'lv-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'lv-open-cal': () => { ui.tab = 'calendar'; ui.calMonth = U.monthKey(T()); if (location.hash !== '#leave') location.hash = 'leave'; else ctx.render(); },
      'lv-open-bal': () => { ui.tab = 'balances'; if (location.hash !== '#leave') location.hash = 'leave'; else ctx.render(); },
      'lv-cal': (_, v) => { ui.calMonth = +v === 0 ? U.monthKey(T()) : U.addMonths(ui.calMonth, +v); ctx.render(); },
      'lv-open-att': (id) => openAttachment(id),
      'lv-goto-settings': () => { location.hash = 'settings'; setTimeout(() => ctx.$('#leave-types')?.scrollIntoView({ block: 'start' }), 60); },
      'lv-export': () => ctx.downloadCSV(`leave-${yearNow()}.csv`, [['Employee', 'Department', 'Type', 'From', 'To', 'Half day', 'Days', 'Paid', 'Status', 'Next approver', 'Reason'],
        ...st().leaves.map((l) => { const e = ctx.emp(l.empId); const n = R.nextStep(l.chain); return [ctx.fullName(e), ctx.dept(e?.dept)?.name || '', typeName(l.type), l.from, l.to, l.half || '', l.days, typeOf(l.type).paid ? 'Yes' : 'No', l.status, n ? nameOf(n.approver) : '', l.reason || '']; })]),
      'lv-divisor': (_, v) => { cfg().unpaidDivisor = v; ctx.commit('Unpaid leave deduction saved'); },
      'lv-weekend': (_, v) => { cfg().weekend = v; ctx.commit(`Rest days: ${R.WEEKEND_LABELS[v] || v}`); },
      'lv-replace': (_, v) => { cfg().replacement = v === 'on'; ctx.commit(v === 'on' ? 'Replacement holidays on' : 'Replacement holidays off'); },
      'lv-holyear': (_, v) => { ui.holYear += +v; ctx.render(); setTimeout(() => ctx.$('#leave-holidays')?.scrollIntoView({ block: 'start' }), 30); },
      'lv-hol-del': (date, name) => { cfg().holidaysCustom = (cfg().holidaysCustom || []).filter((h) => !(h.date === date && h.name === name)); ctx.commit('Holiday removed'); },
      'lv-type-del': (id) => { cfg().types = types().filter((t) => t.id !== id); ctx.commit('Leave type removed'); },
      'lv-type-add': () => ctx.openModal({
        title: 'Add a leave type', size: 'sm', submit: 'Add',
        body: `<div class="form-grid"><div class="field full"><label for="nt-name">Name</label><input class="input" id="nt-name" name="name" required placeholder="Hajj, Marriage, Study…"></div>
          <div class="field"><label for="nt-days">Days a year</label><input class="input num" id="nt-days" name="days" type="number" min="0" value="3"></div>
          <div class="field"><label for="nt-paid">Pay</label><select class="select" id="nt-paid" name="paid"><option value="yes">Paid</option><option value="no">Unpaid</option></select></div>
          <label class="check field full"><input type="checkbox" name="attachment"><span>Needs a document</span></label>
          <label class="check field full"><input type="checkbox" name="halfDay"><span>Allow half days</span></label></div>`,
        onSubmit(d) { types().push({ ...R.defaultTypes()[5], id: U.uid('lt'), name: d.name.trim(), days: Math.max(0, +d.days || 0), paid: d.paid === 'yes', attachment: d.attachment === 'on', halfDay: d.halfDay === 'on', note: '', color: '#2F6AD0', builtin: false }); ctx.commit('Leave type added'); },
      }),
      'lv-credit': () => ctx.openModal({
        title: 'Grant replacement leave', size: 'sm', submit: 'Grant',
        body: `<div class="form-grid"><div class="field full"><label for="cr-emp">Employee</label><select class="select" id="cr-emp" name="empId">${ctx.activeEmployees().map((e) => `<option value="${e.id}">${esc(ctx.fullName(e))}</option>`).join('')}</select></div>
          <div class="field"><label for="cr-days">Days</label><input class="input num" id="cr-days" name="days" type="number" min="0.5" step="0.5" value="1" required></div>
          <div class="field"><label for="cr-date">Date worked</label><input class="input" id="cr-date" name="date" type="date" value="${T()}" required></div>
          <div class="field full"><label for="cr-why">Reason</label><input class="input" id="cr-why" name="reason" placeholder="Worked on Deepavali for the server move"></div></div>`,
        onSubmit(d) { st().leaveCredits = [...(st().leaveCredits || []), { id: U.uid('cr'), empId: d.empId, days: Math.max(0.5, +d.days || 1), date: d.date, reason: d.reason.trim() }]; ctx.commit(`${d.days} replacement day${+d.days === 1 ? '' : 's'} granted to ${firstOf(d.empId)}`); },
      }),
      'lv-carry': () => {
        const y = yearNow(), rows = R.carryForward({ types: types(), employees: ctx.activeEmployees(), leaves: st().leaves, carries: st().leaveCarry?.[y] || {}, year: y });
        ctx.openModal({
          title: `Carry ${y} into ${y + 1}`, size: 'sm', submit: 'Carry forward',
          body: `<p class="muted">${rows.length ? `${rows.length} balances will move into ${y + 1}: ${rows.reduce((s, r) => s + r.carry, 0)} days carried and ${rows.reduce((s, r) => s + r.forfeited, 0)} forfeited over the limit.` : 'No one has days to carry.'} ${cfg().lastCarry?.year === y ? `This replaces the carry done on ${U.fmtDate(cfg().lastCarry.at)}.` : ''}</p>`,
          onSubmit() {
            const out = {}; rows.forEach((r) => { (out[r.empId] = out[r.empId] || {})[r.typeId] = { days: r.carry, expires: r.expires, from: y }; });
            st().leaveCarry = { ...(st().leaveCarry || {}), [y + 1]: out };
            cfg().lastCarry = { year: y, at: T() };
            ctx.commit(`Carried ${rows.reduce((s, r) => s + r.carry, 0)} days into ${y + 1}`, `Year-end carry forward from ${y} to ${y + 1}: ${rows.length} balances`);
          },
        });
      },
    });
    return {
      typeOf, typeName, balance, onLeave, offOn, isApprover, forMe, pendingCount: () => st().leaves.filter((l) => l.status === 'Pending').length,
      myCount: (empId) => forMe(empId).length, whoOffCard, insights, settingsCards, bindSettings, myDepts,
      // Approved unpaid leave in a pay month, and what it costs: basic ÷ divisor × days.
      unpaidFor(empId, mk, base) {
        const ctxM = calCtx(`${mk}-01`, R.monthEnd(mk));
        const days = st().leaves.filter((l) => l.empId === empId && l.status === 'Approved' && !typeOf(l.type).paid && l.from <= R.monthEnd(mk) && l.to >= `${mk}-01`)
          .reduce((s, l) => s + R.countDaysInMonth(l, mk, ctxM, typeOf(l.type).calendar), 0);
        const div = R.divisor(cfg().unpaidDivisor, mk, ctxM);
        return { days, divisor: div, amount: R.unpaidDeduction({ base, days, divisor: div }) };
      },
    };
  }

  return { install };
})();
