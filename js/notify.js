// Notification centre: the bell with unread count, delivery of in-app notifications and queued emails under each
// person's preferences, local browser notifications, the daily reminders run, and announcements and policies
// (with acknowledgements). The rules live in js/notify-rules.js (AllurusNotifyRules).
window.AllurusNotify = (function () {
  'use strict';
  const N = window.AllurusNotifyRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const T = () => U.today();

  // ---------- EMAIL / PUSH PROVIDER HOOK ----------
  // Nothing is sent from this demo. To send for real, set these to functions that hand the message to a provider
  // (for example an HTTPS endpoint of your own that calls Amazon SES, SendGrid or Firebase Cloud Messaging) and
  // return true once it was accepted:
  //   AllurusNotify.providers.email = async ({ to, subject, body }) => (await fetch('/api/email', {...})).ok;
  //   AllurusNotify.providers.push = async ({ to, title, body, href }) => ...;
  // Queued emails stay in state.outbox until the email provider accepts them.
  const providers = { email: null, push: null };

  // ---------- Who ----------
  const viewer = () => (ctx.role() === 'admin' || ctx.role() === 'super' || ctx.role() === 'auditor' ? ctx.account()?.empId || '' : ctx.me()?.id || '');
  const person = (id) => { const e = ctx.emp(id); return e ? { id, email: e.email, first: e.first, prefs: e.notifyPrefs } : null; };
  // HR: the company's admin accounts (not the platform's own super-admin login) and the HR approver from leave settings.
  const hrIds = () => [...new Set([...st().accounts.filter((a) => a.roles?.includes('admin') && !a.roles.includes('super') && a.empId).map((a) => a.empId), st().settings.leave?.hr].filter(Boolean))];
  const isHR = (id) => hrIds().includes(id);
  function resolve(to) {
    const list = Array.isArray(to) ? to : [to];
    return list.flatMap((x) => (x === 'hr' ? hrIds() : x === 'all' ? ctx.activeEmployees().map((e) => e.id) : [x])).map(person).filter(Boolean);
  }
  const list = () => (st().notifications = st().notifications || []);
  const outbox = () => (st().outbox = st().outbox || []);

  // ---------- Deliver ----------
  // Adds the notifications and queued emails for an event. Callers save (commit) as usual afterwards.
  function event(type, data, to, { from = viewer(), self = false, key = '' } = {}) {
    if (key) { const keys = (st().notifyKeys = st().notifyKeys || []); if (keys.includes(key)) return 0; keys.push(key); if (keys.length > 2000) keys.splice(0, keys.length - 2000); }
    const link = `${location.origin}${location.pathname}${data.href || ''}`;
    const r = N.deliver(type, { company: st().settings.company, link, ...data }, resolve(to), { from, self, at: new Date().toISOString(), key, ids: () => U.uid('') });
    st().notifications = N.trim([...r.notifications, ...list()], 100);
    st().outbox = [...r.emails, ...outbox()].slice(0, 500);
    if (r.emails.length) flush();
    if (r.notifications.some((n) => n.to === viewer())) setTimeout(() => updateBell(), 0);
    return r.notifications.length + r.emails.length;
  }
  // Sends queued emails through the provider, when one is plugged in.
  async function flush() {
    if (!providers.email) return;
    let changed = false;
    for (const m of outbox().filter((x) => x.status === 'queued')) {
      try { if (await providers.email(m)) { m.status = 'sent'; m.sentAt = new Date().toISOString(); changed = true; } } catch (e) { m.error = e?.message || 'Not sent'; changed = true; }
    }
    if (changed) ctx.save();
  }
  const NAMES = { leave: ['#leave', '#my-leave'], claim: ['#claims', '#my-claims'], ot: ['#attendance', '#my-time'], waiver: ['#attendance', '#my-time'], correction: ['#attendance', '#my-time'] };
  // A request moved: submitted or at a new step (to the next approver, or the backup covering), or decided (to the person).
  function request(kind, rec, phase, { summary = '', note = '' } = {}) {
    const who = ctx.fullName(ctx.emp(rec.empId)), by = ctx.fullName(ctx.emp(viewer())) || 'HR';
    if (phase === 'submitted' || phase === 'step') {
      const s = AllurusLeaveRules.nextStep(rec.chain || []);
      const to = s ? [s.approver, ...(s.backup && ctx.leave?.onLeave(s.approver, T()) ? [s.backup] : [])] : hrIds();
      to.forEach((id) => event(phase === 'submitted' ? 'request.submitted' : 'request.step', { who, kind, summary, by, href: isHR(id) ? NAMES[kind][0] : '#my-approvals' }, id, { from: rec.empId === viewer() ? rec.empId : viewer() }));
    } else event(phase === 'approved' ? 'request.approved' : 'request.rejected', { kind, summary, by, note, href: NAMES[kind][1] }, rec.empId);
  }

  // ---------- Browser notifications ----------
  const canPush = () => 'Notification' in window;
  const shown = new Set();
  async function showLocal(n) {
    if (!canPush() || Notification.permission !== 'granted') return;
    const opts = { body: n.body, icon: 'assets/logo-mark.svg', tag: n.id, data: { href: n.href } };
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) await reg.showNotification(n.title, opts);
      else { const x = new Notification(n.title, opts); x.onclick = () => { window.focus(); if (n.href) location.hash = n.href.replace('#', ''); x.close(); }; }
    } catch (e) { /* some browsers only allow notifications from a service worker */ }
    if (providers.push) providers.push({ to: n.to, title: n.title, body: n.body, href: n.href }).catch?.(() => {});
  }
  // New notifications for the viewer that someone else caused (here or in another tab) pop up as browser notifications.
  function checkNew() {
    const me = viewer(), recent = Date.now() - 120000;
    list().filter((n) => n.to === me && !shown.has(n.id)).forEach((n) => { shown.add(n.id); if (!n.read && n.from !== me && Date.parse(n.at) > recent) showLocal(n); });
  }

  // ---------- Bell ----------
  const ui = { open: false, filter: 'all' };
  function updateBell() {
    const b = document.getElementById('nt-bell'); if (!b) return;
    const me = viewer();
    b.hidden = !me;
    const n = me ? N.unread(list(), me) : 0, c = b.querySelector('.bell-count');
    c.textContent = n > 99 ? '99+' : String(n); c.hidden = !n;
    b.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
    checkNew();
    if (ui.open) drawPanel();
  }
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : U.fmtDate(iso.slice(0, 10), { day: 'numeric', month: 'short' }); };
  function drawPanel() {
    let p = document.getElementById('nt-panel');
    if (!p) { p = document.createElement('div'); p.id = 'nt-panel'; p.className = 'nt-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications'); document.body.appendChild(p); }
    const me = viewer(), mine = list().filter((n) => n.to === me && (ui.filter === 'all' || !n.read)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
    const unread = N.unread(list(), me);
    p.hidden = false;
    p.innerHTML = `<div class="nt-head"><h3>Notifications</h3><div class="actions">${unread ? '<button class="btn btn-sm btn-ghost" data-act="nt-read-all">Mark all read</button>' : ''}<button class="btn btn-icon btn-sm btn-ghost" data-act="nt-close" aria-label="Close">${ctx.icon('x')}</button></div></div>
      <div class="seg nt-filter" role="group" aria-label="Show">${[['all', 'All'], ['unread', `Unread${unread ? ` (${unread})` : ''}`]].map(([k, l]) => `<button data-act="nt-filter" data-v="${k}" class="${ui.filter === k ? 'on' : ''}" aria-pressed="${ui.filter === k}">${l}</button>`).join('')}</div>
      <div class="nt-list">${mine.map((n) => `<button class="nt-item ${n.read ? '' : 'unread'}" data-act="nt-go" data-id="${n.id}"><span class="nt-ic">${ctx.icon(n.icon || 'help')}</span><span class="nt-text"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span><time datetime="${n.at}">${ago(n.at)}</time></span>${n.read ? '' : '<i class="nt-dot" aria-label="Unread"></i>'}</button>`).join('') || `<div class="empty"><strong>${ui.filter === 'unread' ? 'All read' : 'Nothing yet'}</strong>Approvals, payslips, announcements and reminders show here.</div>`}</div>
      <div class="nt-foot"><button class="link-btn" data-act="nt-prefs">Notification settings</button></div>`;
  }
  function openPanel() { ui.open = true; drawPanel(); setTimeout(() => document.querySelector('#nt-panel .nt-item, #nt-panel button')?.focus(), 20); }
  function closePanel(focusBell = true) { ui.open = false; const p = document.getElementById('nt-panel'); if (p) p.hidden = true; if (focusBell) document.getElementById('nt-bell')?.focus(); }

  // ---------- Reminders (once a day, on load) ----------
  // Self-reviews still to submit, due on their cycle's self-review date. The manager and HR steps have their own
  // overdue reminders in js/appraisal.js.
  const appraisalReminders = () => (st().reviews || []).filter((r) => !r.cycleId || r.stage === 'self').map((r) => {
    const c = r.cycleId && (st().cycles || []).find((x) => x.id === r.cycleId);
    return c ? { ...r, due: c.status === 'Open' ? c.selfDue : '' } : r;
  });
  function runReminders() {
    if (!viewer() && ctx.role() !== 'employee') return;
    if (st().reminderRun === T()) return;
    st().reminderRun = T();
    const stat = [];
    if (window.AllurusStatutory && st().statutory) {
      AllurusStatutory.dueReminders({ today: T(), payroll: st().payroll, filed: st().statutory.filed, eaIssued: st().statutory.eaIssued, formEFiled: st().statutory.formEFiled }).forEach((x) => {
        const when = x.daysLeft < 0 ? `${-x.daysLeft} days overdue` : `due ${U.fmtDate(x.due, { day: 'numeric', month: 'short' })}`;
        if (x.kind === 'statutory') stat.push({ key: `${x.month}-${x.open.join('-')}`, title: `${U.fmtMonth(x.month, { month: 'long' })} ${x.open.map((k) => k.toUpperCase()).join(', ')} ${when}`, detail: 'Pay and mark as submitted under Payroll → Statutory files.' });
        if (x.kind === 'ea') stat.push({ key: `ea-${x.year}`, title: `Issue ${x.year} EA forms, ${when}`, detail: 'Under Payroll → Year-end and forms.' });
        if (x.kind === 'formE') stat.push({ key: `forme-${x.year}`, title: `File Form E and CP8D for ${x.year}, ${when}`, detail: 'On MyTax (LHDN).' });
      });
      AllurusStatutory.eventForms(st().employees, T()).forEach((x) => stat.push({ key: `${x.form}-${x.empId}`, title: `${x.form} for ${x.name} ${x.daysLeft < 0 ? `${-x.daysLeft} days late` : `due in ${x.daysLeft} days`}`, detail: x.form === 'CP22' ? 'Tell LHDN about the new employee.' : 'Tell LHDN before their last day.' }));
    }
    const hrefFor = (r) => (r.type === 'reminder.statutory' ? '#payroll' : r.type.startsWith('reminder.appraisal') ? (r.to === 'hr' ? '#performance' : '#my-appraisal') : r.data.empId ? '#employees' : r.type === 'reminder.document' ? '#assets' : '#dashboard');
    let n = 0;
    N.reminders({ employees: st().employees, today: T(), reviews: appraisalReminders(), statutory: stat, documents: ctx.hr ? ctx.hr.expiringItems() : [] }).forEach((r) => {
      const to = Array.isArray(r.to) ? r.to : [r.to];
      to.forEach((t) => {
        const self = t !== 'hr';
        n += event(r.type, { ...r.data, self, href: self ? (r.type.startsWith('reminder.appraisal') ? '#my-appraisal' : r.type === 'reminder.document' ? '#my-profile' : '#home') : hrefFor(r) }, t, { from: 'system', self, key: `${r.key}:${self ? 'self' : 'hr'}` });
      });
    });
    ctx.appraisal?.runReminders();
    ctx.hr?.runReminders();
    ctx.save();
    updateBell();
    return n;
  }

  // ---------- Preferences and outbox ----------
  function prefsCard() {
    const e = ctx.emp(viewer());
    if (!e) return '';
    const p = { ...N.defaultPrefs(), ...(e.notifyPrefs || {}) };
    const perm = canPush() ? Notification.permission : 'unsupported';
    return `<div class="card" id="nt-prefs"><div class="card-head"><h3>Notifications</h3><span class="hint">${esc(e.email)}</span></div>
      ${Object.entries(N.CATEGORIES).map(([k, l]) => `<div class="settings-row"><div><div class="label"><label for="ntp-${k}">${l}</label></div></div><select class="select" id="ntp-${k}" data-ntp="${k}" style="width:auto">${Object.entries(N.CHANNELS).map(([v, t]) => `<option value="${v}" ${p[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`).join('')}
      <div class="settings-row"><div><div class="label">Browser notifications</div><div class="desc">${perm === 'granted' ? 'On. New notifications pop up while Allurus is open.' : perm === 'denied' ? 'Blocked in this browser. Allow notifications for this site in your browser settings.' : perm === 'unsupported' ? 'This browser can’t show notifications.' : 'Pop up new notifications while Allurus is open in a tab.'}</div></div>${perm === 'default' ? '<button class="btn" data-act="nt-push">Turn on</button>' : perm === 'granted' ? '<button class="btn btn-ghost" data-act="nt-test">Send a test</button>' : ''}</div>
      <p class="faint" style="font-size:12.5px">Emails are queued now and sent once your company connects an email service.</p></div>`;
  }
  function outboxCard() {
    const box = outbox(), queued = box.filter((m) => m.status === 'queued').length;
    return `<div class="card card-flush" id="nt-outbox"><div class="card-head" style="padding-bottom:12px"><div><h3>Email outbox</h3><div class="faint">${queued} queued · ${box.length - queued} sent</div></div>${box.length ? '<button class="btn btn-sm btn-ghost" data-act="nt-outbox-clear">Clear sent and old</button>' : ''}</div>
      <p class="muted" style="padding:0 22px 12px">Emails wait here until an email service is connected (<code>AllurusNotify.providers.email</code>). Nothing has been sent yet.</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>
      ${box.slice(0, 20).map((m) => `<tr><td class="muted num" style="white-space:nowrap">${ago(m.at)}</td><td style="overflow-wrap:anywhere">${esc(m.to)}</td><td>${esc(m.subject)}</td><td><span class="pill ${m.status === 'sent' ? 'ok' : 'warn'}">${m.status === 'sent' ? 'Sent' : 'Queued'}</span></td><td><button class="btn btn-sm btn-ghost" data-act="nt-mail" data-id="${m.id}">Preview</button></td></tr>`).join('')}</tbody></table>
      ${box.length ? '' : '<div class="empty"><strong>No emails yet</strong>They queue here when people choose email in their notification settings.</div>'}</div></div>`;
  }
  function bindSettings() {
    ctx.$$('[data-ntp]').forEach((el) => el.addEventListener('change', () => {
      const e = ctx.emp(viewer()); if (!e) return;
      e.notifyPrefs = { ...N.defaultPrefs(), ...(e.notifyPrefs || {}), [el.dataset.ntp]: el.value };
      ctx.commit('Notification settings saved');
    }));
  }

  // ---------- Announcements and policies ----------
  const anns = () => (st().announcements = st().announcements || []);
  const forEmp = (a, e) => !a.depts?.length || a.depts.includes(e.dept);
  const audience = (a) => ctx.activeEmployees().filter((e) => forEmp(a, e));
  const needsAck = (a, e) => a.kind === 'policy' && forEmp(a, e) && !a.acks?.[e.id];
  // Keeps simple formatting only: bold, italic, underline, paragraphs, lists, headings and safe links.
  function sanitize(html) {
    const t = document.createElement('template'); t.innerHTML = html;
    const OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'P', 'BR', 'UL', 'OL', 'LI', 'A', 'H3']);
    const walk = (node) => [...node.childNodes].forEach((c) => {
      if (c.nodeType === 8) { c.remove(); return; }
      if (c.nodeType !== 1) return;
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(c.tagName)) { c.remove(); return; }
      walk(c);
      if (c.tagName === 'DIV') { const p = document.createElement('p'); p.append(...c.childNodes); c.replaceWith(p); return; }
      if (!OK.has(c.tagName)) { c.replaceWith(...c.childNodes); return; }
      const href = c.tagName === 'A' ? c.getAttribute('href') || '' : '';
      [...c.attributes].forEach((a) => c.removeAttribute(a.name));
      if (c.tagName === 'A') { if (/^(https?:|mailto:)/i.test(href)) { c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); } else c.replaceWith(...c.childNodes); }
    });
    walk(t.content);
    return t.innerHTML.trim();
  }
  const plain = (html) => { const t = document.createElement('template'); t.innerHTML = String(html).replace(/<\/(p|li|h3)>|<br\s*\/?>/gi, ' $&'); return (t.content.textContent || '').replace(/\s+/g, ' ').trim(); };
  const kindPill = (a) => (a.kind === 'policy' ? '<span class="pill gold">Policy</span>' : '<span class="pill info">Announcement</span>');
  const target = (a) => (a.depts?.length ? a.depts.map((d) => ctx.dept(d)?.name || d).join(', ') : 'Everyone');
  function adminView() {
    const list = [...anns()].sort((a, b) => (b.pinned - a.pinned) || b.at.localeCompare(a.at));
    return `<div class="page-head"><div><div class="eyebrow">Company</div><h1>Announcements</h1><p class="sub">Post news and policies to everyone or chosen departments. Staff must acknowledge policies; you see who has.</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="an-new">${ctx.icon('plus')}New announcement</button></div></div>
      ${list.map((a) => { const aud = audience(a), acked = aud.filter((e) => a.acks?.[e.id]), pending = aud.filter((e) => !a.acks?.[e.id]); return `<article class="card an-card">
        <div class="card-head"><div><div class="an-meta">${kindPill(a)}${a.pinned ? '<span class="tag">Pinned</span>' : ''}<span class="faint">${U.fmtDate(a.at.slice(0, 10))} · ${esc(ctx.fullName(ctx.emp(a.by)) || 'HR')} · ${esc(target(a))}</span></div><h3>${esc(a.title)}</h3></div>
          <div class="actions"><button class="btn btn-sm btn-ghost" data-act="an-open" data-id="${a.id}">Open</button><button class="btn btn-sm btn-icon btn-ghost" data-act="an-del" data-id="${a.id}" aria-label="Delete ${esc(a.title)}">${ctx.icon('trash')}</button></div></div>
        <p class="muted an-excerpt">${esc(plain(a.html).slice(0, 220))}${plain(a.html).length > 220 ? '…' : ''}</p>
        ${a.attachment ? `<a class="an-file" href="${a.attachment.data}" download="${esc(a.attachment.name)}">${ctx.icon('doc')}${esc(a.attachment.name)}</a>` : ''}
        ${a.kind === 'policy' ? `<div class="an-acks"><div class="an-ack-bar"><div class="progress"><i style="width:${aud.length ? (acked.length / aud.length) * 100 : 0}%"></i></div><span class="num"><strong>${acked.length}</strong> of ${aud.length} acknowledged</span>${pending.length ? `<button class="btn btn-sm" data-act="an-remind" data-id="${a.id}">Remind ${pending.length}</button>` : ''}</div>
          <details><summary>Who has acknowledged</summary><div class="an-who"><div><div class="kpi-label">Acknowledged</div>${acked.map((e) => `<div>${esc(ctx.fullName(e))} <span class="faint">${U.fmtDate(a.acks[e.id].slice(0, 10), { day: 'numeric', month: 'short' })}</span></div>`).join('') || '<div class="faint">No one yet</div>'}</div>
            <div><div class="kpi-label">Not yet</div>${pending.map((e) => `<div>${esc(ctx.fullName(e))}</div>`).join('') || '<div class="faint">Everyone has</div>'}</div></div></details></div>` : ''}
      </article>`; }).join('') || '<div class="card empty"><strong>No announcements yet</strong>Post the first one for your team.</div>'}`;
  }
  function staffList(e, limit) {
    const mine = anns().filter((a) => forEmp(a, e)).sort((a, b) => (needsAck(b, e) - needsAck(a, e)) || (b.pinned - a.pinned) || b.at.localeCompare(a.at));
    return (limit ? mine.slice(0, limit) : mine).map((a) => `<div class="list-item an-item"><div class="grow"><div class="an-meta">${kindPill(a)}${needsAck(a, e) ? '<span class="tag warn">Please acknowledge</span>' : a.kind === 'policy' ? '<span class="tag ok">Acknowledged</span>' : ''}<span class="faint">${U.fmtDate(a.at.slice(0, 10), { day: 'numeric', month: 'short' })}</span></div><div class="person-name">${esc(a.title)}</div><div class="person-sub" style="white-space:normal">${esc(plain(a.html).slice(0, 120))}${plain(a.html).length > 120 ? '…' : ''}</div></div>
      <button class="btn btn-sm ${needsAck(a, e) ? 'btn-primary' : ''}" data-act="an-open" data-id="${a.id}">${needsAck(a, e) ? 'Read and acknowledge' : 'Read'}</button></div>`).join('');
  }
  const staffView = () => { const e = ctx.me(); const body = staffList(e); return `<div class="page-head"><div><div class="eyebrow">Company</div><h1>Announcements</h1><p class="sub">News and policies from ${esc(st().settings.company)}.</p></div></div><div class="card"><div class="list">${body || '<div class="empty"><strong>Nothing yet</strong>Announcements from HR show here.</div>'}</div></div>`; };
  function homeCard(e) {
    const body = staffList(e, 3), todo = anns().filter((a) => needsAck(a, e)).length;
    return `<div class="card"><div class="card-head"><h3>Announcements</h3><a class="hint" href="#news">${todo ? `${todo} to acknowledge` : 'All'}</a></div><div class="list">${body || '<div class="empty"><strong>Nothing new</strong>News from HR shows here.</div>'}</div></div>`;
  }
  function openAnn(id) {
    const a = anns().find((x) => x.id === id); if (!a) return;
    const e = ctx.role() === 'admin' ? null : ctx.me(), must = e && needsAck(a, e);
    ctx.openModal({
      title: a.title, size: '', submit: null,
      body: `<div class="an-meta">${kindPill(a)}<span class="faint">${U.fmtDate(a.at.slice(0, 10))} · ${esc(ctx.fullName(ctx.emp(a.by)) || 'HR')}</span></div>
        <div class="an-body">${a.html}</div>
        ${a.attachment ? `<a class="an-file" href="${a.attachment.data}" download="${esc(a.attachment.name)}">${ctx.icon('doc')}${esc(a.attachment.name)}</a>` : ''}
        ${must ? `<div class="review-box" style="margin-top:14px"><label class="check"><input type="checkbox" id="an-agree"><span>I have read and understood this policy</span></label><div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-primary" data-act="an-ack" data-id="${a.id}">${ctx.icon('check')}Acknowledge</button></div></div>`
          : e && a.kind === 'policy' && a.acks?.[e.id] ? `<p class="faint" style="margin-top:12px">You acknowledged this on ${U.fmtDate(a.acks[e.id].slice(0, 10))}.</p>` : ''}`,
    });
  }
  function compose() {
    const depts = st().departments;
    let file = null;
    ctx.openModal({
      title: 'New announcement', size: 'lg', submit: 'Post',
      body: `<div class="form-grid">
        <fieldset class="field full an-kind"><legend class="label-like">Type</legend><label class="check"><input type="radio" name="kind" value="announcement" checked><span>Announcement</span></label><label class="check"><input type="radio" name="kind" value="policy"><span>Policy (staff must acknowledge)</span></label></fieldset>
        <div class="field full"><label for="an-title">Title</label><input class="input" id="an-title" name="title" required placeholder="Deepavali open house"></div>
        <div class="field full"><span class="label-like" id="an-body-label">Message</span>
          <div class="rte-bar" role="toolbar" aria-label="Formatting">${[['bold', 'B', 'Bold'], ['italic', 'I', 'Italic'], ['underline', 'U', 'Underline'], ['insertUnorderedList', '•', 'Bulleted list'], ['insertOrderedList', '1.', 'Numbered list'], ['link', '↗', 'Add a link']].map(([c, l, t]) => `<button type="button" class="btn btn-sm btn-ghost" data-rte="${c}" aria-label="${t}" title="${t}">${l}</button>`).join('')}</div>
          <div class="input rte" id="an-body" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="an-body-label"></div></div>
        <div class="field full"><span class="label-like">Send to</span><div class="an-depts"><label class="check"><input type="checkbox" id="an-all" checked><span>Everyone</span></label>${depts.map((d) => `<label class="check"><input type="checkbox" name="dept" value="${d.id}" data-dept><span>${esc(d.name)}</span></label>`).join('')}</div></div>
        <div class="field"><label for="an-file">Attachment (optional)</label><input class="input" type="file" id="an-file" accept=".pdf,image/*"><span class="field-hint">PDF or image, up to 1 MB.</span></div>
        <label class="check field" style="align-self:end"><input type="checkbox" name="pinned"><span>Pin to the top</span></label></div>`,
      onSubmit(d) {
        const html = sanitize(document.getElementById('an-body').innerHTML);
        if (!plain(html)) { ctx.toast('Write the message', 'error'); document.getElementById('an-body').focus(); return false; }
        const chosen = ctx.$$('[data-dept]:checked').map((x) => x.value);
        const a = { id: U.uid('an'), kind: d.kind, title: d.title.trim(), html, depts: document.getElementById('an-all').checked ? [] : chosen, attachment: file, pinned: d.pinned === 'on', at: new Date().toISOString(), by: viewer(), acks: {} };
        if (!document.getElementById('an-all').checked && !chosen.length) { ctx.toast('Pick who to send it to', 'error'); return false; }
        anns().push(a);
        event('announcement.new', { title: a.title, policy: a.kind === 'policy', excerpt: plain(html).slice(0, 90), href: '#news' }, audience(a).map((e) => e.id));
        ctx.commit(`${a.kind === 'policy' ? 'Policy' : 'Announcement'} posted to ${audience(a).length} people`, `${a.kind === 'policy' ? 'Policy' : 'Announcement'} posted: ${a.title}`);
      },
    });
    const form = ctx.$('#overlay-root form');
    form.querySelectorAll('[data-rte]').forEach((b) => b.addEventListener('click', () => {
      const ed = document.getElementById('an-body'); ed.focus();
      if (b.dataset.rte === 'link') { const url = prompt('Link address (https://…)'); if (url && /^(https?:|mailto:)/i.test(url)) document.execCommand('createLink', false, url); return; }
      document.execCommand(b.dataset.rte, false);
    }));
    const all = form.querySelector('#an-all');
    all.addEventListener('change', () => { if (all.checked) form.querySelectorAll('[data-dept]').forEach((x) => { x.checked = false; }); });
    form.querySelectorAll('[data-dept]').forEach((x) => x.addEventListener('change', () => { if (x.checked) all.checked = false; }));
    form.querySelector('#an-file').addEventListener('change', (ev) => {
      const f = ev.target.files?.[0]; if (!f) { file = null; return; }
      if (f.size > 1024 * 1024) { ctx.toast('That file is over 1 MB', 'error'); ev.target.value = ''; return; }
      const r = new FileReader(); r.onload = () => { file = { name: f.name, mime: f.type, data: r.result, size: f.size }; }; r.readAsDataURL(f);
    });
  }

  // ---------- Employee record: probation, contract and documents ----------
  function employeeFields(e) {
    const f = (id, name, label, type = 'date', hint = '') => `<div class="field"><label for="f-${id}">${label}</label><input class="input" id="f-${id}" name="${name}" type="${type}" value="${esc(e[name] || '')}">${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
    return `<div class="field full form-sep"><span class="eyebrow">Probation, contract and documents</span></div>
      ${f('probation', 'probationEnd', 'Probation ends', 'date', 'HR is reminded 30 days before.')}${f('confirmed', 'confirmedOn', 'Confirmed on')}
      ${f('contract', 'contractEnd', 'Contract ends', 'date', 'For fixed-term contracts.')}${f('nation', 'nationality', 'Nationality', 'text')}
      ${f('passport', 'passportNo', 'Passport number', 'text')}${f('passexp', 'passportExpiry', 'Passport expires')}
      ${f('permit', 'permitNo', 'Work permit or pass number', 'text', 'For foreign staff (for example an Employment Pass).')}${f('permexp', 'permitExpiry', 'Permit expires')}`;
  }

  // ---------- Insights ----------
  function insights() {
    const out = [];
    if (ctx.role() === 'employee') {
      const e = ctx.me(), todo = anns().filter((a) => needsAck(a, e));
      if (todo.length) out.push({ tone: 'warn', icon: 'doc', title: `${todo.length} ${todo.length === 1 ? 'policy needs' : 'policies need'} your acknowledgement`, detail: todo.map((a) => a.title).slice(0, 2).join(', '), action: { label: 'Read', act: 'an-open', id: todo[0].id }, prio: 3 });
    }
    if (ctx.role() === 'admin') {
      const open = anns().filter((a) => a.kind === 'policy' && audience(a).some((e) => !a.acks?.[e.id]));
      if (open.length) { const a = open[0], left = audience(a).filter((e) => !a.acks?.[e.id]).length; out.push({ tone: 'info', icon: 'doc', title: `${left} ${left === 1 ? 'person hasn’t' : 'people haven’t'} acknowledged “${a.title}”`, detail: 'Send them a reminder from Announcements.', action: { label: 'Announcements', href: '#announcements' }, prio: 1 }); }
    }
    return out;
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.announcements = adminView;
    ctx.VIEWS.news = staffView;
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.open) closePanel(); });
    document.addEventListener('click', (ev) => { if (ui.open && !ev.target.closest('#nt-panel') && !ev.target.closest('#nt-bell')) closePanel(false); });
    navigator.serviceWorker?.addEventListener?.('message', (ev) => { if (ev.data?.href) location.hash = ev.data.href.replace('#', ''); });
    Object.assign(ctx.ACTIONS, {
      'nt-open': () => (ui.open ? closePanel() : openPanel()),
      'nt-close': () => closePanel(),
      'nt-filter': (_, v) => { ui.filter = v; drawPanel(); },
      'nt-go': (id) => {
        const n = list().find((x) => x.id === id); if (!n) return;
        st().notifications = N.markRead(list(), viewer(), id); ctx.save();
        closePanel(false);
        if (n.href && location.hash !== n.href) location.hash = n.href.replace('#', ''); else ctx.render();
      },
      'nt-read-all': () => { st().notifications = N.markRead(list(), viewer()); ctx.save(); updateBell(); },
      'nt-prefs': () => { closePanel(false); location.hash = 'settings'; setTimeout(() => ctx.$('#nt-prefs')?.scrollIntoView({ block: 'start' }), 80); },
      'nt-push': async () => { if (!canPush()) return; const p = await Notification.requestPermission(); ctx.toast(p === 'granted' ? 'Browser notifications are on' : 'Browser notifications stay off', p === 'granted' ? undefined : 'info'); ctx.render(); },
      'nt-test': () => showLocal({ id: U.uid('t'), title: 'Notifications are working', body: 'You’ll see new approvals, payslips and announcements like this.', href: '#home' }),
      'nt-mail': (id) => { const m = outbox().find((x) => x.id === id); if (m) ctx.openModal({ title: m.subject, submit: null, body: `<dl class="kv"><dt>To</dt><dd>${esc(m.to)}</dd><dt>Status</dt><dd>${m.status === 'sent' ? `Sent ${new Date(m.sentAt).toLocaleString('en-MY')}` : 'Queued, waiting for an email service'}</dd></dl><pre class="mail-body">${esc(m.body)}</pre>` }); },
      'nt-outbox-clear': () => { const cut = new Date(Date.now() - 30 * 864e5).toISOString(); st().outbox = outbox().filter((m) => m.status === 'queued' && m.at > cut); ctx.commit('Outbox cleared'); },
      'an-new': () => compose(),
      'an-open': (id) => openAnn(id),
      'an-ack': (id) => {
        const a = anns().find((x) => x.id === id), e = ctx.me();
        if (!document.getElementById('an-agree')?.checked) { ctx.toast('Tick the box to confirm you’ve read it', 'error'); return; }
        a.acks = { ...(a.acks || {}), [e.id]: new Date().toISOString() };
        ctx.closeOverlay(); ctx.commit('Thanks, acknowledged', `${ctx.fullName(e)} acknowledged the policy “${a.title}”`);
      },
      'an-remind': (id) => { const a = anns().find((x) => x.id === id); const left = audience(a).filter((e) => !a.acks?.[e.id]); event('announcement.remind', { title: a.title, href: '#news' }, left.map((e) => e.id)); ctx.commit(`Reminder sent to ${left.length} ${left.length === 1 ? 'person' : 'people'}`); },
      'an-del': (id) => { st().announcements = anns().filter((a) => a.id !== id); ctx.commit('Announcement deleted'); },
    });
    return { event, request, updateBell, runReminders, prefsCard, outboxCard, bindSettings, homeCard, employeeFields, insights, sanitize, viewer, hrIds };
  }

  return { install, providers };
})();
