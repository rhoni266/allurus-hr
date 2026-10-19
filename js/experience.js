// The experience layer shared by every role: personal preferences and themes, the command palette (⌘K),
// customizable dashboards, guided setup and tour, contextual help, richer feedback and live updates.
window.AllurusUX = (function () {
  'use strict';
  let ctx = null;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- Preferences (per signed-in account, kept with the app data) ----------
  const ACCENTS = {
    teal: { name: 'Allurus teal', light: ['#0F766E', '#0B5F59'], dark: ['#2FB4A4', '#45C7B7'] },
    ocean: { name: 'Ocean', light: ['#1F5FCC', '#184DA6'], dark: ['#6EA0FF', '#8DB5FF'] },
    violet: { name: 'Violet', light: ['#6A47D1', '#5638B0'], dark: ['#A68BFF', '#BBA6FF'] },
    rose: { name: 'Rose', light: ['#C23B66', '#A02F54'], dark: ['#FF7DA4', '#FF9BBB'] },
    champagne: { name: 'Champagne', light: ['#8A6628', '#735420'], dark: ['#D9B66F', '#E5C88C'] },
    graphite: { name: 'Graphite', light: ['#3B4049', '#2A2E35'], dark: ['#C9CDD4', '#E1E4E9'] },
  };
  function prefs() {
    const s = ctx.state;
    s.prefs = s.prefs || {};
    const k = s.session.account || 'guest';
    return (s.prefs[k] = s.prefs[k] || {});
  }
  const theme = () => prefs().theme || ctx.state.settings.theme || 'system';
  const mq = (q) => window.matchMedia && matchMedia(q).matches;
  const isDark = () => theme() === 'dark' || (theme() === 'system' && mq('(prefers-color-scheme: dark)'));
  const reduceMotion = () => prefs().motion === 'reduce' || (prefs().motion !== 'full' && mq('(prefers-reduced-motion: reduce)'));
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
  let styleEl = null;
  function applyPrefs() {
    const p = prefs(), root = document.documentElement, t = theme();
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    root.dataset.density = p.density || 'comfortable';
    root.dataset.text = p.text || 'default';
    root.dataset.contrast = p.contrast ? 'more' : 'normal';
    root.dataset.motion = reduceMotion() ? 'reduce' : 'full';
    const a = ACCENTS[p.accent] || ACCENTS.teal, dark = isDark(), [brand, hover] = dark ? a.dark : a.light;
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'ux-vars'; document.head.appendChild(styleEl); }
    root.dataset.accent = p.accent || 'teal';
    styleEl.textContent = `html:root[data-accent]{--brand:${brand};--brand-hover:${hover};--brand-soft:${hexA(brand, dark ? 0.18 : 0.1)};--brand-ring:${hexA(brand, 0.28)};--on-brand:${dark ? '#0B0B0D' : '#FFFFFF'};}`;
    const tb = $('#theme-btn');
    if (tb) { tb.innerHTML = ctx.icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'auto'); tb.setAttribute('aria-label', `Theme: ${t === 'system' ? 'automatic' : t}. Switch theme`); tb.title = 'Switch theme'; }
  }
  function setPref(key, value) {
    prefs()[key] = value;
    markDone('act:ux-look');
    applyPrefs(); ctx.save(); ctx.render();
  }

  // ---------- Feedback: toasts with undo, celebrations, count-up numbers ----------
  function toast(msg, kind = 'ok', opts = {}) {
    const root = $('#toast-root'); if (!root) return;
    const ms = opts.undo ? 6500 : kind === 'error' ? 5200 : 3000;
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.innerHTML = `<span class="toast-ic">${ctx.icon(kind === 'error' ? 'x' : kind === 'info' ? 'sparkle' : 'check')}</span><span class="toast-msg">${ctx.esc(msg)}</span>${opts.undo ? '<button class="toast-btn" type="button">Undo</button>' : ''}<i class="toast-bar" style="animation-duration:${ms}ms"></i>`;
    let timer, left = ms, start = 0;
    const close = () => { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), 180); };
    const run = () => { start = Date.now(); timer = setTimeout(close, left); };
    t.addEventListener('mouseenter', () => { clearTimeout(timer); left -= Date.now() - start; t.classList.add('paused'); });
    t.addEventListener('mouseleave', () => { t.classList.remove('paused'); run(); });
    if (opts.undo) t.querySelector('.toast-btn').addEventListener('click', () => { close(); opts.undo(); });
    root.appendChild(t);
    while (root.children.length > 3) root.firstChild.remove();
    run();
  }
  function celebrate() {
    if (reduceMotion()) return;
    const box = document.createElement('div'); box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
    const colors = ['var(--brand)', 'var(--gold)', 'var(--ok)', 'var(--info)', '#FF7DA4'];
    box.innerHTML = Array.from({ length: 28 }, (_, i) => `<i style="--x:${Math.round((Math.random() - 0.5) * 520)}px;--y:${Math.round(-160 - Math.random() * 260)}px;--r:${Math.round(Math.random() * 720)}deg;--d:${(0.9 + Math.random() * 0.7).toFixed(2)}s;background:${colors[i % colors.length]}"></i>`).join('');
    document.body.appendChild(box); setTimeout(() => box.remove(), 1800);
  }
  // Animate KPI numbers from zero, keeping their currency and suffix.
  function countUp(scope) {
    if (reduceMotion()) return;
    $$('.kpi-value', scope).forEach((el) => {
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
      if (!node) return;
      const m = node.textContent.match(/(\d[\d,]*)(\.\d+)?/); if (!m) return;
      const target = Number((m[1] + (m[2] || '')).replace(/,/g, '')), dec = m[2] ? m[2].length - 1 : 0;
      if (!target) return;
      const pre = node.textContent.slice(0, m.index), post = node.textContent.slice(m.index + m[0].length);
      const fmt = (v) => pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: m[1].includes(',') }) + post;
      const t0 = performance.now(), dur = 650;
      const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); node.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step); else node.textContent = fmt(target); };
      requestAnimationFrame(step);
    });
  }

  // ---------- Accessibility helpers ----------
  let lastFocus = null;
  function trapFocus(container) {
    lastFocus = document.activeElement;
    container.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const f = $$('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', container).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
  }
  function restoreFocus() { if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); lastFocus = null; }

  // ---------- Guided setup (per role) ----------
  const SETUP = {
    admin: [
      ['visit:dashboard', 'Look around your dashboard', '#dashboard'],
      ['visit:settings', 'Check your office check-in location', '#settings'],
      ['visit:employees', 'Review your team', '#employees'],
      ['visit:claims', 'Set up claim categories', '#claims'],
      ['visit:payroll', 'Preview this month’s payroll', '#payroll'],
      ['act:ux-palette', 'Jump anywhere with ⌘K', 'ux-palette'],
      ['act:ux-customize', 'Arrange your dashboard', 'ux-customize'],
    ],
    employee: [
      ['act:check-in', 'Check in with a selfie', '#home'],
      ['visit:my-leave', 'See your time off', '#my-leave'],
      ['visit:my-plan', 'Plan your month', '#my-plan'],
      ['visit:my-tax', 'Add a tax relief receipt', '#my-tax'],
      ['act:ux-palette', 'Jump anywhere with ⌘K', 'ux-palette'],
      ['act:ux-customize', 'Arrange your home page', 'ux-customize'],
    ],
    super: [
      ['visit:platform', 'See your companies on the map', '#platform'],
      ['visit:companies', 'Review subscribed companies', '#companies'],
      ['visit:billing', 'Check plans and billing', '#billing'],
      ['act:ux-palette', 'Jump anywhere with ⌘K', 'ux-palette'],
      ['act:ux-look', 'Pick your theme and colour', '#settings'],
    ],
    auditor: [
      ['visit:reports', 'Open the reports to verify', '#reports'],
      ['visit:tax', 'Review tax deductions', '#tax'],
      ['visit:books', 'Browse the books', '#books'],
      ['act:ux-palette', 'Jump anywhere with ⌘K', 'ux-palette'],
    ],
  };
  function markDone(key) {
    const p = prefs(); p.done = p.done || {};
    if (p.done[key]) return false;
    p.done[key] = Date.now();
    return true;
  }
  function setupState() {
    const list = SETUP[ctx.role()] || [], done = prefs().done || {};
    const n = list.filter(([k]) => done[k]).length;
    return { list, done, n, total: list.length, complete: n === list.length };
  }
  function setupCard() {
    const p = prefs(), r = ctx.role(), s = setupState();
    if (!s.total || (p.setupHidden || {})[r]) return '';
    if (s.complete) {
      if (!(p.setupCelebrated || {})[r]) { p.setupCelebrated = { ...(p.setupCelebrated || {}), [r]: true }; ctx.save(); setTimeout(() => { celebrate(); toast('You’re all set up. Nice work!'); }, 250); }
      return '';
    }
    const pct = Math.round((s.n / s.total) * 100);
    return `<div class="card setup" aria-labelledby="setup-title">
      <div class="setup-head"><div class="ring" style="--p:${pct}" role="img" aria-label="${s.n} of ${s.total} steps done"><span class="num">${s.n}/${s.total}</span></div>
        <div class="grow"><h3 id="setup-title">Get started with Allurus</h3><p class="muted">A few quick steps to make it work for you. You can come back to these any time from Help.</p></div>
        <div class="actions"><button class="btn btn-sm" data-act="ux-tour">${ctx.icon('sparkle')}Take the 1-minute tour</button><button class="btn btn-sm btn-ghost" data-act="ux-setup-hide">Hide</button></div></div>
      <ol class="setup-list">${s.list.map(([k, label, to]) => {
        const ok = !!s.done[k], inner = `<span class="tick ${ok ? 'on' : ''}" aria-hidden="true">${ok ? ctx.icon('check') : ''}</span><span>${label}</span><span class="sr-only">${ok ? ' (done)' : ''}</span>`;
        return `<li class="${ok ? 'done' : ''}">${to.startsWith('#') ? `<a href="${to}">${inner}</a>` : `<button type="button" data-act="${to}">${inner}</button>`}</li>`;
      }).join('')}</ol></div>`;
  }

  // ---------- Customizable dashboards ----------
  const editing = {};
  const SIZES = [[4, 'S'], [6, 'M'], [8, 'L'], [12, 'Full']];
  function layout(boardId, widgets) {
    const p = prefs(); p.boards = p.boards || {};
    const lay = p.boards[boardId] || {};
    const ids = widgets.map((w) => w.id);
    const order = [...(lay.order || []).filter((id) => ids.includes(id)), ...ids.filter((id) => !(lay.order || []).includes(id))];
    return { order, hidden: (lay.hidden || []).filter((id) => ids.includes(id)), spans: lay.spans || {} };
  }
  function saveLayout(boardId, patch) {
    const p = prefs(); p.boards = p.boards || {};
    p.boards[boardId] = { ...(p.boards[boardId] || {}), ...patch };
    ctx.save(); ctx.render();
  }
  let current = null;
  function board(boardId, widgets) {
    current = { id: boardId, widgets };
    const ed = !!editing[boardId], L = layout(boardId, widgets);
    const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));
    const shown = [...widgets.filter((w) => w.fixed).map((w) => w.id), ...L.order.filter((id) => !byId[id].fixed && !L.hidden.includes(id))];
    const cells = shown.map((id) => {
      const w = byId[id], html = w.render(ed);
      if (!html) return '';
      const span = L.spans[id] || w.span, title = ctx.esc(w.title);
      const tools = ed && !w.fixed ? `<div class="widget-tools"><span class="grip" title="Drag to move">${ctx.icon('grip')}</span><span class="widget-name">${title}</span>
        <div class="seg seg-xs" role="group" aria-label="Width of ${title}">${SIZES.map(([n, l]) => `<button type="button" data-act="ux-w-size" data-id="${id}" data-v="${n}" class="${span === n ? 'on' : ''}" aria-pressed="${span === n}">${l}</button>`).join('')}</div>
        <button type="button" class="btn btn-sm btn-icon btn-ghost" data-act="ux-w-move" data-id="${id}" data-v="-1" aria-label="Move ${title} earlier">${ctx.icon('up')}</button>
        <button type="button" class="btn btn-sm btn-icon btn-ghost" data-act="ux-w-move" data-id="${id}" data-v="1" aria-label="Move ${title} later">${ctx.icon('down')}</button>
        <button type="button" class="btn btn-sm btn-icon btn-ghost" data-act="ux-w-hide" data-id="${id}" aria-label="Hide ${title}">${ctx.icon('eyeOff')}</button></div>` : '';
      return `<section class="widget s-${span}" data-widget="${id}" aria-label="${title}" ${ed && !w.fixed ? 'draggable="true"' : ''}>${tools}${html}</section>`;
    }).join('');
    const hidden = L.hidden.filter((id) => !byId[id].fixed);
    const bar = ed ? `<div class="board-bar" role="region" aria-label="Customize layout"><div>${ctx.icon('dashboard')}<span><strong>Customizing.</strong> Drag cards to move them, pick a width, or hide what you don’t need. Changes save as you go.</span></div>
      <div class="actions"><button class="btn btn-sm btn-ghost" data-act="ux-w-reset">Reset to default</button><button class="btn btn-sm btn-primary" data-act="ux-customize">${ctx.icon('check')}Done</button></div>
      ${hidden.length ? `<div class="board-tray"><span class="faint">Hidden cards:</span>${hidden.map((id) => `<button class="chip" data-act="ux-w-show" data-id="${id}">${ctx.icon('plus')}${ctx.esc(byId[id].title)}</button>`).join('')}</div>` : ''}</div>` : '';
    return `${bar}<div class="board ${ed ? 'editing' : ''}" data-board="${boardId}">${cells}</div>`;
  }
  function bindBoard() {
    const el = $('.board.editing'); if (!el || !current) return;
    let dragId = null;
    const clear = () => $$('.drop-before, .drop-after, .dragging').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    $$('.widget[draggable=true]', el).forEach((w) => {
      w.addEventListener('dragstart', (ev) => { dragId = w.dataset.widget; w.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', dragId); });
      w.addEventListener('dragend', () => { dragId = null; clear(); });
      w.addEventListener('dragover', (ev) => {
        if (!dragId || dragId === w.dataset.widget) return;
        ev.preventDefault();
        const r = w.getBoundingClientRect(), wide = r.width > el.getBoundingClientRect().width * 0.8;
        const after = wide ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
        w.classList.toggle('drop-after', after); w.classList.toggle('drop-before', !after);
      });
      w.addEventListener('dragleave', () => w.classList.remove('drop-before', 'drop-after'));
      w.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const target = w.dataset.widget, after = w.classList.contains('drop-after');
        clear();
        if (!dragId || dragId === target) return;
        const L = layout(current.id, current.widgets), order = L.order.filter((x) => x !== dragId);
        order.splice(order.indexOf(target) + (after ? 1 : 0), 0, dragId);
        saveLayout(current.id, { order });
        toast('Layout saved');
      });
    });
  }
  const isEditing = () => Object.values(editing).some(Boolean);

  // ---------- Command palette ----------
  let pal = null;
  const ROLE_ACTIONS = [
    { roles: ['employee'], label: 'Check in with a selfie', icon: 'camera', keywords: 'clock in attendance', run: () => goThen('home', 'check-in', undefined, 'present') },
    { roles: ['employee'], label: 'Apply for leave', icon: 'calendar', keywords: 'request time off holiday vacation sick mc cuti half day', run: () => act('new-leave') },
    { roles: ['employee'], label: 'Approve my team’s leave', icon: 'check', keywords: 'approvals leave requests manager', when: () => ctx.leave?.isApprover(ctx.me()?.id), run: () => go('my-approvals') },
    { roles: ['employee'], label: 'Request overtime', icon: 'clock', keywords: 'ot overtime extra hours claim approval', run: () => goThen('my-time', 'tm-request', undefined, 'ot') },
    { roles: ['employee'], label: 'Ask for a lateness waiver', icon: 'clock', keywords: 'late waive excuse flood traffic', run: () => goThen('my-time', 'tm-request', undefined, 'waiver') },
    { roles: ['employee'], label: 'Correct my attendance', icon: 'edit', keywords: 'forgot check out missed check in fix correction', run: () => goThen('my-time', 'tm-request', undefined, 'correction') },
    { roles: ['employee'], label: 'Check in a team member', icon: 'people', keywords: 'supervisor team check in photo crew site', when: () => ctx.kioskSupervisor?.(), run: () => act('sv-open') },
    { roles: ['employee'], label: 'My shifts and roster', icon: 'grip', keywords: 'shift roster schedule rota this week', run: () => go('my-time') },
    { roles: ['employee'], label: 'Log time on a project', icon: 'layers', keywords: 'timesheet hours project job log', when: () => ctx.routes().some((r) => r.id === 'my-timesheet'), run: () => goThen('my-timesheet', 'cs-ts-mine') },
    { roles: ['employee'], label: 'Change my address or bank details', icon: 'edit', keywords: 'update details phone address emergency contact bank account married', run: () => goThen('my-profile', 'hr-req-new') },
    { roles: ['employee'], label: 'Add a document', icon: 'doc', keywords: 'upload certificate passport document', run: () => goThen('my-profile', 'hr-doc-mine') },
    { roles: ['admin', 'employee'], label: 'Org chart', icon: 'org', keywords: 'organisation organization chart reports to hierarchy manager team', run: () => go('org-chart') },
    { roles: ['employee'], label: 'My self-review', icon: 'trend', keywords: 'appraisal performance review self evaluation rate kpi', run: () => goThen('my-appraisal', 'ap-my-self') },
    { roles: ['employee'], label: 'Add a goal', icon: 'target', keywords: 'smart goal objective kpi okr', run: () => goThen('my-appraisal', 'ap-goal-new') },
    { roles: ['employee'], label: 'Update my goals', icon: 'trend', keywords: 'goal progress check in update', run: () => go('my-appraisal') },
    { roles: ['employee'], label: 'Score my team’s appraisals', icon: 'check', keywords: 'appraisal manager score team review recommend increment bonus', when: () => ctx.appraisal?.teamCount(ctx.me()?.id) > 0, run: () => go('my-appraisal') },
    { roles: ['employee'], label: 'Give 360° feedback', icon: 'people', keywords: '360 peer feedback colleague anonymous', run: () => go('my-appraisal') },
    { roles: ['employee'], label: 'Download my payslip', icon: 'download', keywords: 'pdf payslip salary slip print', run: () => go('my-pay') },
    { roles: ['employee'], label: 'My EA form', icon: 'doc', keywords: 'borang ea tax form year end mytax', run: () => go('my-pay') },
    { roles: ['employee'], label: 'My leave balance', icon: 'calendar', keywords: 'annual sick days left time off', run: () => go('my-leave') },
    { roles: ['employee'], label: 'New claim', icon: 'receipt', keywords: 'expense travel meals parking toll hotel phone training receipt reimburse medical clinic', when: () => ctx.claimsOn(), run: () => goThen('my-claims', 'cl-new') },
    { roles: ['employee'], label: 'Mileage claim', icon: 'pin', keywords: 'km distance car motorcycle petrol mileage', when: () => ctx.claimsOn(), run: () => goThen('my-claims', 'cl-new', undefined, 'mileage') },
    { roles: ['employee'], label: 'New medical claim', icon: 'heart', keywords: 'clinic doctor receipt reimburse dental optical', when: () => ctx.claimsOn(), run: () => goThen('my-claims', 'cl-new', undefined, 'medical') },
    { roles: ['employee'], label: 'Scan a tax relief receipt', icon: 'receipt', keywords: 'lhdn relief be form', run: () => goThen('my-tax', 'rel-scan') },
    { roles: ['employee'], label: 'Plan my month', icon: 'target', keywords: 'budget planner disposable spend', run: () => go('my-plan') },
    { roles: ['admin'], label: 'Add an employee', icon: 'userplus', keywords: 'hire new staff onboard', run: () => act('add-emp') },
    { roles: ['admin'], label: 'Run payroll', icon: 'wallet', keywords: 'salary pay epf socso pcb', run: () => go('payroll') },
    { roles: ['admin'], label: 'Approve time off', icon: 'calendar', keywords: 'leave requests pending', run: () => go('leave') },
    { roles: ['admin'], label: 'Leave calendar', icon: 'calendar', keywords: 'who is off month team holidays', run: () => act('lv-open-cal') },
    { roles: ['admin'], label: 'Leave balances', icon: 'calendar', keywords: 'annual sick carried entitlement', run: () => act('lv-open-bal') },
    { roles: ['admin'], label: 'Public holidays and rest days', icon: 'calendar', keywords: 'holiday state terengganu weekend friday cuti umum', run: () => goSection('leave-holidays') },
    { roles: ['admin'], label: 'Leave types and entitlements', icon: 'sliders', keywords: 'maternity paternity hospitalisation policy', run: () => goSection('leave-types') },
    { roles: ['admin'], label: 'Leave approval chains', icon: 'people', keywords: 'approver backup department head hr', run: () => goSection('leave-approvals') },
    { roles: ['admin'], label: 'Year-end carry forward', icon: 'calendar', keywords: 'carry forward expiry year end leave', run: () => goSection('leave-yearend') },
    { roles: ['admin'], label: 'Statutory files (KWSP, PERKESO, LHDN CP39, HRD Corp)', icon: 'shield', keywords: 'epf socso eis pcb cp39 hrdf levy contribution file submit 15th', run: () => goThen('payroll', 'pd-tab', undefined, 'files') },
    { roles: ['admin'], label: 'Bank salary file (GIRO / IBG)', icon: 'download', keywords: 'bank payment bulk giro ibg duitnow salary transfer account', run: () => goThen('payroll', 'pd-tab', undefined, 'bank') },
    { roles: ['admin'], label: 'EA forms, Form E and CP8D', icon: 'doc', keywords: 'borang ea form e cp8d year end lhdn tax', run: () => goThen('payroll', 'pd-tab', undefined, 'year') },
    { roles: ['admin'], label: 'CP22 and CP22A forms', icon: 'doc', keywords: 'new employee leaving resign cp21 cp22 cp22a lhdn notify', run: () => goThen('payroll', 'pd-tab', undefined, 'year') },
    { roles: ['admin'], label: 'Print all payslips', icon: 'doc', keywords: 'pdf payslips download print all', run: () => goThen('payroll', 'pd-tab', undefined, 'run') },
    { roles: ['admin'], label: 'Company registration numbers', icon: 'shield', keywords: 'ssm epf employer number socso code lhdn e number hrd corp mycoid', run: () => goSection('stat-ids') },
    { roles: ['admin'], label: 'Post an announcement or policy', icon: 'doc', keywords: 'announcement news policy notice memo acknowledge', run: () => goThen('announcements', 'an-new') },
    { roles: ['admin'], label: 'Who acknowledged a policy', icon: 'check', keywords: 'policy acknowledgement read confirm', run: () => go('announcements') },
    { roles: ['admin'], label: 'Email outbox', icon: 'doc', keywords: 'email queued notifications outbox provider', run: () => goSection('nt-outbox') },
    { roles: ['admin'], label: 'Review flagged check-ins', icon: 'shield', keywords: 'fake gps mock location spoof speed review selfie face mismatch', run: () => { go('attendance'); setTimeout(() => $('#sec-review')?.scrollIntoView({ block: 'start' }), 80); } },
    { roles: ['admin'], label: 'Set up a check-in kiosk', icon: 'camera', keywords: 'kiosk tablet entrance face recognition shared device', run: () => goSection('ck-kiosks') },
    { roles: ['admin'], label: 'Projects and jobs at check-in', icon: 'briefcase', keywords: 'project job costing code client check-in', run: () => goSection('ck-kiosks') },
    { roles: ['admin'], label: 'Edit this week’s roster', icon: 'grip', keywords: 'schedule shift rota roster week copy rotation', run: () => go('schedule') },
    { roles: ['admin'], label: 'Review overtime and attendance requests', icon: 'clock', keywords: 'ot overtime waiver correction late approve', run: () => act('tm-open-requests') },
    { roles: ['admin'], label: 'Batch edit attendance', icon: 'edit', keywords: 'global change bulk date range fix records audit', run: () => goThen('attendance', 'tm-batch') },
    { roles: ['admin'], label: 'Working patterns and shifts', icon: 'clock', keywords: 'shift pattern office hours grace flexible core hours auto-shift', run: () => goSection('time-patterns') },
    { roles: ['admin'], label: 'Overtime rules', icon: 'sliders', keywords: 'ot rate 1.5 rest day public holiday rounding 104 hours employment act', run: () => goSection('time-ot') },
    { roles: ['admin'], label: 'Daily allowances', icon: 'coins', keywords: 'meal transport attendance shift allowance forfeit late', run: () => goSection('time-allowances') },
    { roles: ['admin'], label: 'Rotating rosters', icon: 'grip', keywords: 'rotation template shift cycle', run: () => goSection('time-rosters') },
    { roles: ['admin'], label: 'Headcount report', icon: 'chart', keywords: 'report headcount department staff numbers', run: () => act('rp-open', undefined, 'headcount') },
    { roles: ['admin'], label: 'Turnover report', icon: 'chart', keywords: 'report turnover attrition leavers rate', run: () => act('rp-open', undefined, 'turnover') },
    { roles: ['admin'], label: 'Payroll variance report', icon: 'chart', keywords: 'report payroll summary variance month on month gross net cost', run: () => act('rp-open', undefined, 'payroll') },
    { roles: ['admin'], label: 'Statutory contributions report', icon: 'chart', keywords: 'report epf socso eis pcb hrdf contributions kwsp perkeso', run: () => act('rp-open', undefined, 'statutory') },
    { roles: ['admin'], label: 'Overtime report', icon: 'chart', keywords: 'report ot overtime hours pay department', run: () => act('rp-open', undefined, 'ot') },
    { roles: ['admin'], label: 'Lateness and absenteeism report', icon: 'chart', keywords: 'report late lateness absent absenteeism', run: () => act('rp-open', undefined, 'lateness') },
    { roles: ['admin'], label: 'Leave report', icon: 'chart', keywords: 'report leave taken balances annual sick', run: () => act('rp-open', undefined, 'leave') },
    { roles: ['admin'], label: 'Build a custom report', icon: 'chart', keywords: 'custom report writer columns filter group sort export', run: () => act('rp-open', undefined, 'custom') },
    { roles: ['admin'], label: 'Project costing', icon: 'layers', keywords: 'project job cost budget hours man-hours wages labour', run: () => go('projects') },
    { roles: ['admin'], label: 'Budget vs actual cost', icon: 'layers', keywords: 'project budget actual cost overrun', run: () => { go('projects'); setTimeout(() => { act('cs-tab', undefined, 'reports'); act('cs-rep', undefined, 'budget'); }, 80); } },
    { roles: ['admin'], label: 'Log time on a project', icon: 'clock', keywords: 'timesheet hours project job log', run: () => goThen('projects', 'cs-ts') },
    { roles: ['admin'], label: 'Start offboarding', icon: 'userplus', keywords: 'resign resignation leaver exit last day offboard checklist cp22a', run: () => goThen('onboarding', 'hr-offboard') },
    { roles: ['admin'], label: 'Onboarding checklists', icon: 'userplus', keywords: 'onboard new starter joiner checklist tasks', run: () => go('onboarding') },
    { roles: ['admin'], label: 'Issue an asset', icon: 'box', keywords: 'laptop phone access card vehicle car asset register serial', run: () => goThen('assets', 'hr-asset-issue') },
    { roles: ['admin'], label: 'Add a staff loan', icon: 'coins', keywords: 'loan advance instalment repayment', run: () => goThen('assets', 'hr-loan') },
    { roles: ['admin'], label: 'Insurance policies', icon: 'shield', keywords: 'insurance hospitalisation gpa policy expiry premium', run: () => goThen('assets', 'hr-atab', undefined, 'insurance') },
    { roles: ['admin'], label: 'Letter templates', icon: 'doc', keywords: 'letter offer confirmation increment warning transfer resignation template placeholder', run: () => goSection('hr-letters') },
    { roles: ['admin'], label: 'Detail changes to approve', icon: 'edit', keywords: 'employee request change address bank emergency contact approve', when: () => ctx.hr?.pendingCount() > 0, run: () => go('employees') },
    { roles: ['admin'], label: 'Launch a review cycle', icon: 'trend', keywords: 'appraisal performance review cycle kpi start', run: () => goThen('performance', 'ap-launch') },
    { roles: ['admin'], label: 'Appraisals waiting for HR final', icon: 'check', keywords: 'appraisal final approve increment bonus promotion', run: () => goThen('performance', 'ap-stage', undefined, 'hr') },
    { roles: ['admin'], label: 'Appraisal report', icon: 'download', keywords: 'appraisal score distribution grade department completion csv', run: () => goThen('performance', 'ap-tab', undefined, 'reports') },
    { roles: ['admin'], label: 'Scheduled pay changes', icon: 'wallet', keywords: 'increment raise salary bonus promotion effective date appraisal', run: () => goThen('performance', 'ap-tab', undefined, 'pay') },
    { roles: ['admin'], label: 'Appraisal templates and grade bands', icon: 'sliders', keywords: 'appraisal template kpi competencies values weights rating scale grade bands', run: () => goSection('appr-templates') },
    { roles: ['admin'], label: 'Review claims', icon: 'receipt', keywords: 'claims approve expense medical travel mileage reimburse', run: () => go('claims') },
    { roles: ['admin'], label: 'Claims report', icon: 'download', keywords: 'claims by employee category department month csv export', run: () => goThen('claims', 'cl-tab', undefined, 'reports') },
    { roles: ['admin'], label: 'Claim categories and limits', icon: 'sliders', keywords: 'travel mileage meals parking toll accommodation phone training entertainment limit gl rate per km', run: () => goSection('claim-categories') },
    { roles: ['admin'], label: 'Medical benefits policy', icon: 'heart', keywords: 'outpatient dental optical specialist medical limit', run: () => goSection('claim-policy') },
    { roles: ['admin'], label: 'Scan a receipt into the books', icon: 'receipt', keywords: 'expense bookkeeping ocr', run: () => goThen('finance', 'fin-scan') },
    { roles: ['admin'], label: 'Request time off', icon: 'calendar', keywords: 'leave', run: () => act('new-leave') },
    { roles: ['admin', 'employee'], label: 'Open notifications', icon: 'bell', keywords: 'notifications bell unread alerts inbox', run: () => act('nt-open') },
    { roles: ['admin', 'employee'], label: 'Notification settings', icon: 'sliders', keywords: 'notifications email push browser preferences off', run: () => goSection('nt-prefs') },
    { roles: ['employee'], label: 'Announcements and policies', icon: 'doc', keywords: 'news announcement policy acknowledge', run: () => go('news') },
    { roles: ['admin', 'employee'], label: 'Customize this dashboard', icon: 'dashboard', keywords: 'layout widgets arrange drag', run: () => { go(ctx.routes()[0].id); setTimeout(() => act('ux-customize'), 60); } },
    { roles: ['*'], label: 'Use dark mode', icon: 'moon', keywords: 'theme night appearance', run: () => setPref('theme', 'dark') },
    { roles: ['*'], label: 'Use light mode', icon: 'sun', keywords: 'theme day appearance', run: () => setPref('theme', 'light') },
    { roles: ['*'], label: 'Match my device’s theme', icon: 'auto', keywords: 'theme auto system appearance', run: () => setPref('theme', 'system') },
    { roles: ['*'], label: 'Change colours, text size and density', icon: 'palette', keywords: 'accent appearance accessibility font contrast', run: () => { go('settings'); setTimeout(() => $('#appearance')?.scrollIntoView({ block: 'start' }), 80); } },
    { roles: ['*'], label: 'Take the tour', icon: 'sparkle', keywords: 'help onboarding guide', run: () => startTour() },
    { roles: ['*'], label: 'Help and keyboard shortcuts', icon: 'help', keywords: 'support tips', run: () => openHelp() },
    { roles: ['*'], label: 'Sign out', icon: 'lock', keywords: 'logout log out', run: () => act('logout') },
  ];
  const goSection = (id) => { go('settings'); setTimeout(() => $('#' + id)?.scrollIntoView({ block: 'start' }), 80); };
  const go = (id) => { if (location.hash === '#' + id) ctx.render(); else location.hash = id; };
  const act = (name, id, v) => ctx.ACTIONS[name]?.(id, v);
  const goThen = (route, name, id, v) => { go(route); setTimeout(() => act(name, id, v), 80); };
  function commands() {
    const r = ctx.role(), items = [];
    ctx.routes().forEach((rt) => items.push({ key: 'page:' + rt.id, group: 'Go to', label: rt.label, sub: rt.group, icon: rt.icon, run: () => go(rt.id) }));
    ROLE_ACTIONS.filter((a) => (a.roles.includes('*') || a.roles.includes(r)) && (!a.when || a.when())).forEach((a) => items.push({ key: 'act:' + a.label, group: 'Actions', label: a.label, icon: a.icon, keywords: a.keywords, run: a.run }));
    ctx.state.session.roles.filter((x) => x !== r).forEach((x) => items.push({ key: 'role:' + x, group: 'Switch view', label: `Switch to ${ctx.ROLES[x].label} view`, icon: 'people', run: () => ctx.switchRole(x) }));
    if (r === 'admin' || r === 'employee') ctx.activeEmployees().forEach((e) => items.push({ key: 'person:' + e.id, group: 'People', label: ctx.fullName(e), sub: e.role, person: e, keywords: `${e.email} ${e.role}`, run: () => (r === 'admin' ? ctx.openProfile(e.id) : go('directory')) }));
    return items;
  }
  function score(q, s) {
    if (!s) return 0;
    s = s.toLowerCase();
    const i = s.indexOf(q);
    if (i === 0) return 100;
    if (i > 0) return (/[\s(·-]/.test(s[i - 1]) ? 80 : 55) - i * 0.1;
    let j = 0; for (const ch of s) { if (ch === q[j]) j++; if (j === q.length) return 18; }
    return 0;
  }
  function search(items, query) {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      const recent = (prefs().recentCmds || []).map((k) => items.find((x) => x.key === k)).filter(Boolean).slice(0, 5).map((x) => ({ ...x, group: 'Recent' }));
      const suggested = suggestions(items).filter((x) => !recent.some((r) => r.key === x.key)).map((x) => ({ ...x, group: 'Suggested' }));
      return [...recent, ...suggested, ...items.filter((x) => x.group === 'Go to')];
    }
    return items.map((x) => {
      let total = 0;
      for (const w of words) { const s = Math.max(score(w, x.label), score(w, x.keywords) * 0.8, score(w, x.sub) * 0.5); if (!s) return null; total += s; }
      return { x, total: total + (x.group === 'Actions' ? 2 : 0) };
    }).filter(Boolean).sort((a, b) => b.total - a.total).slice(0, 40).map((r) => r.x);
  }
  // Suggestions adapt to the role and the time of day.
  function suggestions(items) {
    const r = ctx.role(), h = new Date().getHours(), pick = (label) => items.find((x) => x.label === label);
    const list = r === 'employee' ? [h < 12 ? 'Check in with a selfie' : null, 'Apply for leave', 'New medical claim', 'Plan my month']
      : r === 'admin' ? ['Approve time off', 'Review claims', new Date().getDate() >= 20 ? 'Run payroll' : 'Add an employee']
        : ['Take the tour'];
    return list.filter(Boolean).map(pick).filter(Boolean);
  }
  function openPalette() {
    if (pal) return;
    if (markDone('act:ux-palette')) ctx.save();
    const root = $('#cmdk-root'), prev = document.activeElement, items = commands();
    root.innerHTML = `<div class="scrim cmdk-scrim" data-cmdk-scrim><div class="cmdk" role="dialog" aria-modal="true" aria-label="Search and commands">
      <div class="cmdk-input">${ctx.icon('search')}<input id="cmdk-q" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list" placeholder="Search people, pages and actions…" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div>
      <div class="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div></div></div>`;
    const input = $('#cmdk-q'), listEl = $('#cmdk-list');
    pal = { items, results: [], active: 0, prev };
    const draw = () => {
      pal.results = search(items, input.value);
      let g = '', html = '';
      pal.results.forEach((x, i) => {
        if (x.group !== g) { g = x.group; html += `<div class="cmdk-group" role="presentation">${g}</div>`; }
        html += `<div class="cmdk-item ${i === pal.active ? 'on' : ''}" role="option" id="cmdk-o${i}" aria-selected="${i === pal.active}" data-i="${i}">${x.person ? ctx.avatar(ctx.fullName(x.person), 'sm') : `<span class="cmdk-ic">${ctx.icon(x.icon || 'right')}</span>`}<span class="grow"><span class="cmdk-label">${ctx.esc(x.label)}</span>${x.sub ? `<span class="cmdk-sub">${ctx.esc(x.sub)}</span>` : ''}</span>${i === pal.active ? '<kbd>↵</kbd>' : ''}</div>`;
      });
      listEl.innerHTML = html || `<div class="cmdk-empty"><strong>No matches for “${ctx.esc(input.value)}”</strong>Try a name, a page like “payroll”, or an action like “check in”.</div>`;
      input.setAttribute('aria-activedescendant', pal.results.length ? 'cmdk-o' + pal.active : '');
      $('#cmdk-o' + pal.active)?.scrollIntoView({ block: 'nearest' });
    };
    const runAt = (i) => {
      const x = pal.results[i]; if (!x) return;
      const p = prefs(); p.recentCmds = [x.key, ...(p.recentCmds || []).filter((k) => k !== x.key)].slice(0, 8);
      closePalette(false); ctx.save(); x.run();
    };
    input.addEventListener('input', () => { pal.active = 0; draw(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); pal.active = Math.min(pal.results.length - 1, pal.active + 1); draw(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); pal.active = Math.max(0, pal.active - 1); draw(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); runAt(pal.active); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closePalette(); }
      else if (ev.key === 'Tab') ev.preventDefault();
    });
    listEl.addEventListener('mousemove', (ev) => { const o = ev.target.closest('[data-i]'); if (o && +o.dataset.i !== pal.active) { pal.active = +o.dataset.i; draw(); } });
    listEl.addEventListener('click', (ev) => { const o = ev.target.closest('[data-i]'); if (o) runAt(+o.dataset.i); });
    root.querySelector('[data-cmdk-scrim]').addEventListener('mousedown', (ev) => { if (ev.target.matches('[data-cmdk-scrim]')) closePalette(); });
    draw(); input.focus();
  }
  function closePalette(restore = true) {
    if (!pal) return;
    const prev = pal.prev; pal = null; $('#cmdk-root').innerHTML = '';
    if (restore && prev && document.contains(prev)) prev.focus({ preventScroll: true });
  }

  // ---------- Contextual help ----------
  const HELP = {
    announcements: ['News and policies for your team.', ['Policies ask everyone in the chosen departments to acknowledge them; the bar shows who has.', 'Remind sends a notification to the people who haven’t yet.', 'Formatting is kept simple: bold, italic, lists and links.']],
    news: ['News and policies from HR.', ['Policies need your acknowledgement: open one, read it and tick the box.']],
    dashboard: ['Your company at a glance.', ['Focus for today lists what needs you first.', 'Customize to drag, resize or hide cards.', 'Numbers update live when staff check in on this browser.']],
    attendance: ['Who checked in, from where, and with which selfie.', ['Check-ins with unusual GPS (impossible speed, 0 m accuracy, repeated coordinates, wrong time zone) wait in the review card with the reason. Choose Looks fine once checked.', 'Tags show kiosk and supervisor check-ins, ones captured offline, and the project.', 'Late, early-out and overtime tags follow each person’s shift and grace minutes.', 'Every edit (the pencil, or Batch edit) keeps who, when, and the old and new times.', 'Overtime, lateness waiver and correction requests wait at the top.', 'Flagged check-ins (face mismatch, uploaded photo) need a look.']],
    schedule: ['Who works which shift this week.', ['Click a cell to set a shift or a day off. Faded cells follow the usual pattern.', 'Copy last week, or apply a rotation from Settings.', 'Red cells clash with the next shift or with approved leave. The bottom row warns below the minimum on shift.']],
    'my-time': ['Your shifts, check-ins and overtime.', ['Ask for overtime, a lateness waiver or a correction with New request.', 'Overtime is paid once approved. It goes through the same approvers as leave.', 'Your roster for the next two weeks is at the top.']],
    leave: ['Requests, the leave calendar and balances.', ['Requests go L1 → L2 → HR, as set per department in Settings. The dots show where each one is.', 'Review shows the balance before and after, who else in the team is off, and any MC.', 'Rest days and public holidays are never counted. Maternity and paternity count calendar days.', 'Run the year-end carry forward in Settings.']],
    'my-leave': ['Your balances and requests.', ['Half days (AM or PM) are allowed for annual, emergency, replacement and unpaid leave.', 'Sick leave needs a photo or PDF of your MC.', 'Carried days must be used by their expiry date.']],
    'my-approvals': ['Leave and attendance requests waiting for you.', ['You see requests when you’re the next approver, or the backup while your manager is on leave.', 'Overtime, lateness waivers and corrections are below the leave requests.', 'The team calendar shows who is already off.']],
    'hr-reports': ['Ready reports and your own.', ['Pick a report on the left; set the dates, department or employee, and the table and chart update.', 'CSV opens in Excel or Google Sheets; Print saves a PDF.', 'Custom report: choose a data source, tick the columns, add filters, then group and sort. Save it to find it under Custom next time.']],
    projects: ['Hours and labour cost per project.', ['Projects have job groups, and groups have jobs with target hours and a budget.', 'Time comes from check-ins (people pick a project or job when they check in) and from timesheets. A timesheet for a day replaces that day’s check-in time.', 'Labour cost is hours × each person’s hourly cost: basic plus employer EPF, SOCSO and EIS, ÷ 26 days × 8 hours (the overtime basis in Settings).', 'Reports show man-hours and wages by month, and target and budget against actual for each job.']],
    'my-timesheet': ['Your time on projects.', ['Pick a project or job when you check in and the hours count automatically.', 'Log time here for work away from the check-in app; it replaces that day’s check-in time.']],
    onboarding: ['Checklists for joiners and leavers.', ['Adding an employee, or onboarding a hired candidate, starts an onboarding checklist from the template; each task has an owner (HR, IT, payroll, the manager or the employee) and a due date.', 'Start offboarding sets the last day, so the CP22A/CP21 reminder, asset return and final pay follow.', 'Owners see their tasks under Approvals and on their home page; overdue tasks are reminded weekly.', 'Edit the templates under Settings.']],
    assets: ['Company assets, staff loans and insurance.', ['Issue an asset from the store or add a new one; returning it puts it back in the store with its history.', 'Assets held by leavers are flagged, and the offboarding asset task completes when everything is back.', 'Loans are equal monthly instalments; record extra repayments as they come in.', 'Policy expiry dates feed the daily reminders.']],
    'org-chart': ['Who reports to whom.', ['Built from each person’s “Reports to” on their record.', 'Pick a department to focus on it; managers above are kept for context.', 'Print saves it as a PDF.']],
    employees: ['Everyone at the company.', ['Open a person for their full file: personal details, career history, documents and letters, assets and checklists.', 'Detail changes that staff ask for appear at the top to approve.', 'Search by name, email or role, and filter by department or status.']],
    'my-profile': ['Your details and documents.', ['Request a change to your phone, address, emergency contact or bank account; HR approves it before it goes on your record.', 'Add certificates or documents with an expiry date and you’ll be reminded before they run out.']],
    performance: ['Appraisal cycles: self-review, manager scores, HR final.', ['Launch a cycle to pick the template, due dates for each step, an optional second manager (L2) and 360° feedback.', 'Overdue steps are flagged; Remind sends a notification to whoever has it.', 'HR final: approve or edit the increment, bonus and promotion. Approved changes appear under Pay changes and in payroll from their month.', 'Templates and grade bands are under Settings.']],
    'my-appraisal': ['Your appraisal, goals and 360° feedback.', ['Save a draft of your self-review any time; submit it when you’re done.', 'Goals should say what, how it’s measured, the target and the due date. Check in as you go.', '360° answers are combined and only shown once two colleagues have answered.', 'If you manage people, their appraisals wait for you under My team.']],
    payroll: ['Monthly payroll with EPF, SOCSO, EIS, PCB and HRD Corp.', ['Run payroll to create a draft, add bonuses, then approve and pay.', 'Approved overtime and daily allowances from Attendance are added, flagged for EPF, SOCSO and tax as set in Settings.', 'Once paid, Statutory files has the KWSP, PERKESO, LHDN CP39 and HRD Corp files, each checked against the run; Bank file has the salary payment CSV.', 'Year-end and forms has Borang EA, Form E, CP8D, and CP22 / CP22A for joiners and leavers.', 'Statutory payments are due by the 15th of the next month.', 'Click a name to see the payslip.']],
    claims: ['Business expense and medical claims.', ['Review shows every receipt side by side, what each item is allowed under the limits, and what the person has left.', 'Use the pencil to correct an amount or receipt number; the reason is kept on the claim.', 'Claims go L1 → L2 → HR like leave. Approved claims go out with the next payroll, or pay them now.', 'Reports group claims by employee, category, department or month.']],
    finance: ['Cash, profit and what is owed.', ['Scan a receipt to add expenses item by item.', 'Close a month and send it to your auditor from Reports.']],
    settings: ['Company rules and your own preferences.', ['Appearance is personal: theme, accent colour, density, text size and motion.']],
    home: ['Your day at work.', ['Check in with a selfie inside the office zone.', 'Customize to arrange your home page.']],
    'my-pay': ['Your payslips and tax forms.', ['PDF opens a print view: choose Save as PDF (on a phone, Share → Save as PDF).', 'Your Borang EA appears here once HR issues it, by the end of February.']],
    'my-plan': ['Your monthly money plan.', ['Tick bills as you pay them.', 'Loans count towards your debt service ratio.']],
    'my-claims': ['Claim work costs and medical bills.', ['Add several items to one claim, for example a trip with mileage, toll and a meal.', 'Snap each receipt and the shop, date and amount are filled in.', 'Mileage works out distance × the company rate.', 'What you can claim shows how much of each limit is left.']],
    'my-tax': ['Personal tax reliefs and the BE form helper.', ['Every suggestion should be checked before you file with LHDN.']],
    platform: ['Every company subscribed to Allurus.', ['The map shows active company locations.']],
    reports: ['Monthly reports waiting for your verification.', ['Verified months are locked for changes.']],
  };
  function openHelp() {
    const r = ctx.route(), h = HELP[r], label = ctx.routes().find((x) => x.id === r)?.label || 'This page';
    const s = setupState(), hidden = (prefs().setupHidden || {})[ctx.role()];
    ctx.openDrawer(`<div class="drawer-hero"><div class="card-head" style="margin:0"><h2 style="font-size:22px">Help</h2><button class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close help">${ctx.icon('x')}</button></div><p class="muted">${ctx.esc(label)}${h ? ': ' + ctx.esc(h[0]) : ''}</p></div>
      ${h ? `<div class="drawer-section"><h4>Tips for this page</h4><ul class="help-list">${h[1].map((t) => `<li>${ctx.icon('sparkle')}<span>${ctx.esc(t)}</span></li>`).join('')}</ul></div>` : ''}
      <div class="drawer-section"><h4>Getting started</h4><p class="muted">${s.n} of ${s.total} setup steps done.</p><div class="actions"><button class="btn btn-sm" data-act="ux-tour">${ctx.icon('sparkle')}Take the tour</button>${hidden || s.complete ? `<button class="btn btn-sm btn-ghost" data-act="ux-setup-show">Show setup checklist</button>` : ''}</div></div>
      <div class="drawer-section"><h4>Keyboard shortcuts</h4><dl class="kv shortcuts"><dt><kbd>⌘</kbd><kbd>K</kbd> or <kbd>/</kbd></dt><dd>Search people, pages and actions</dd><dt><kbd>?</kbd></dt><dd>Open this help</dd><dt><kbd>esc</kbd></dt><dd>Close a window</dd><dt><kbd>↑</kbd><kbd>↓</kbd> <kbd>↵</kbd></dt><dd>Move and choose in search</dd></dl></div>
      <div class="drawer-section"><h4>Accessibility</h4><p class="muted">Turn on larger text, more contrast or less motion in <a href="#settings" data-act="close-overlay">Settings → Appearance</a>. Everything works with a keyboard and screen reader.</p></div>`);
    trapFocus($('.drawer'));
    setTimeout(() => $('.drawer button')?.focus(), 30);
  }

  // ---------- Guided tour ----------
  let tour = null;
  function tourSteps() {
    const s = [
      { sel: '#nav', title: 'Everything in one menu', body: 'Your menu matches your role. Star a page to pin it to the top.' },
      { sel: '.cmdk-trigger', title: 'Jump anywhere with ⌘K', body: 'Search people, open pages and run actions like “check in” or “run payroll” from the keyboard.' },
      { sel: '[data-act=ux-customize]', title: 'Make it yours', body: 'Drag cards around, change their width or hide the ones you don’t need.' },
      { sel: '#theme-btn', title: 'Light, dark or automatic', body: 'Switch themes here. Pick an accent colour, text size and density in Settings → Appearance.' },
      { sel: '[data-act=ux-help]', title: 'Help is always here', body: 'Tips for the page you’re on, keyboard shortcuts and this tour.' },
    ];
    return s.filter((x) => { const el = $(x.sel); return el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'; });
  }
  function startTour() {
    ctx.closeOverlay(); closePalette(false);
    const first = ctx.routes()[0]?.id;
    if (first && ctx.route() !== first) { location.hash = first; setTimeout(startTour, 120); return; }
    if (window.innerWidth <= 900) { toast('The tour works best on a larger screen. Try ⌘K or the Help button instead.', 'info'); return; }
    tour = { steps: tourSteps(), i: 0 };
    if (!tour.steps.length) return;
    drawTour();
  }
  function drawTour() {
    const root = $('#tour-root'), st = tour.steps[tour.i], el = $(st.sel);
    if (!el) { endTour(); return; }
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), pad = 6;
    const top = Math.min(window.innerHeight - 200, r.bottom + 14), left = Math.max(16, Math.min(window.innerWidth - 356, r.left + (r.right > window.innerWidth - 300 ? -260 : 0)));
    const below = r.bottom + 220 < window.innerHeight;
    root.innerHTML = `<div class="tour-spot" style="top:${r.top - pad}px;left:${r.left - pad}px;width:${r.width + pad * 2}px;height:${Math.min(r.height + pad * 2, window.innerHeight - 20)}px"></div>
      <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-t" style="${below ? `top:${top}px` : `top:${Math.max(16, r.top - 200)}px`};left:${r.height > window.innerHeight * 0.6 ? Math.min(r.right + 16, window.innerWidth - 356) : left}px">
        <div class="tour-step">${tour.i + 1} of ${tour.steps.length}</div><h3 id="tour-t">${st.title}</h3><p class="muted">${st.body}</p>
        <div class="tour-foot"><button class="btn btn-sm btn-ghost" data-act="ux-tour-end">Skip</button><div class="actions">${tour.i ? '<button class="btn btn-sm" data-act="ux-tour-step" data-v="-1">Back</button>' : ''}<button class="btn btn-sm btn-primary" data-act="ux-tour-step" data-v="1">${tour.i === tour.steps.length - 1 ? 'Finish' : 'Next'}</button></div></div></div>`;
    trapFocus($('.tour-pop'));
    $('.tour-pop .btn-primary').focus();
  }
  function endTour(finished) {
    if (!tour) return;
    tour = null; $('#tour-root').innerHTML = '';
    prefs().tourDone = true; ctx.save();
    if (finished) toast('That’s the tour. Press ⌘K any time you need something.', 'info');
  }

  // ---------- Live updates ----------
  let liveAt = Date.now();
  function pulseLive() {
    liveAt = Date.now();
    const p = $('#live-pill'); if (!p) return;
    p.classList.remove('pulse'); void p.offsetWidth; p.classList.add('pulse');
    updateLivePill();
  }
  function updateLivePill() {
    const p = $('#live-pill'); if (!p) return;
    const m = Math.round((Date.now() - liveAt) / 60000);
    p.querySelector('span').textContent = m < 1 ? 'Live · updated just now' : `Live · updated ${m} min ago`;
  }

  // ---------- Mobile tab bar ----------
  const TABS = { admin: ['dashboard', 'employees', 'attendance', 'payroll'], employee: ['home', 'my-time', 'my-pay', 'my-plan'], super: ['platform', 'companies', 'billing'], auditor: ['reports', 'tax', 'books'] };
  function renderTabbar(route) {
    const bar = $('#tabbar'); if (!bar) return;
    const rs = ctx.routes(), pins = pinsFor(rs);
    const ids = (pins.length >= 2 ? pins : TABS[ctx.role()] || rs.map((r) => r.id)).slice(0, 4);
    bar.innerHTML = ids.map((id) => rs.find((r) => r.id === id)).filter(Boolean).map((r) => `<a href="#${r.id}" ${route === r.id ? 'aria-current="page" class="on"' : ''}>${ctx.icon(r.icon)}<span>${ctx.esc(r.label.replace(/^My (\w)/, (_, c) => c.toUpperCase()))}</span></a>`).join('')
      + `<button type="button" data-act="menu" aria-label="More pages">${ctx.icon('more')}<span>More</span></button>`;
  }
  const pins = () => prefs().pins || [];
  const pinsFor = (rs) => pins().filter((id) => rs.some((r) => r.id === id));

  // ---------- Appearance card (Settings) ----------
  function appearanceCard() {
    const p = prefs(), t = theme();
    const seg = (key, cur, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-act="ux-pref" data-id="${key}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
    return `<div class="card" id="appearance"><div class="card-head"><h3>Appearance and accessibility</h3><span class="hint">Just for you, on this account</span></div>
      <div class="settings-row"><div><div class="label">Theme</div><div class="desc">Follow your device, or always light or dark.</div></div>${seg('theme', t, [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div class="settings-row"><div><div class="label">Accent colour</div><div class="desc">Used for buttons, links and highlights.</div></div>
        <div class="swatches" role="radiogroup" aria-label="Accent colour">${Object.entries(ACCENTS).map(([k, a]) => `<button type="button" role="radio" aria-checked="${(p.accent || 'teal') === k}" aria-label="${a.name}" title="${a.name}" data-act="ux-pref" data-id="accent" data-v="${k}" class="swatch ${(p.accent || 'teal') === k ? 'on' : ''}" style="--c:${(isDark() ? a.dark : a.light)[0]}"></button>`).join('')}</div></div>
      <div class="settings-row"><div><div class="label">Density</div><div class="desc">Compact fits more on screen.</div></div>${seg('density', p.density || 'comfortable', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}</div>
      <div class="settings-row"><div><div class="label">Text size</div><div class="desc">Makes everything larger and easier to read.</div></div>${seg('text', p.text || 'default', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']])}</div>
      <div class="settings-row"><div><div class="label">More contrast</div><div class="desc">Darker text and stronger borders.</div></div>${seg('contrast', !!p.contrast, [[false, 'Off'], [true, 'On']])}</div>
      <div class="settings-row"><div><div class="label">Motion</div><div class="desc">Animations and celebrations. Auto follows your device’s reduce-motion setting.</div></div>${seg('motion', p.motion || 'system', [['system', 'Auto'], ['full', 'On'], ['reduce', 'Reduced']])}</div>
      <div class="settings-row"><div><div class="label">Guided help</div><div class="desc">Replay the tour or bring back the setup checklist.</div></div><div class="actions"><button class="btn btn-sm" data-act="ux-tour">${ctx.icon('sparkle')}Take the tour</button><button class="btn btn-sm btn-ghost" data-act="ux-setup-show">Show checklist</button></div></div></div>`;
  }

  // ---------- Hooks called by the app ----------
  let lastRoute = null;
  function beforeRender(route) {
    if (markDone('visit:' + route)) ctx.save();
  }
  function afterRender(route, navigated) {
    renderTabbar(route);
    const changed = route !== lastRoute;
    lastRoute = route;
    const p = prefs();
    if (changed) {
      p.recentPages = [route, ...(p.recentPages || []).filter((x) => x !== route)].slice(0, 6);
      p.lastRoute = { ...(p.lastRoute || {}), [ctx.role()]: route };
      countUp($('#view'));
      if (navigated) { const h = $('#view h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }
    }
    const live = $('#live-pill'); if (live) { live.hidden = !$('.board'); updateLivePill(); }
    bindBoard();
  }
  function onAction(name) {
    if (markDone('act:' + name)) { ctx.save(); return true; }
    return false;
  }

  function install(c) {
    ctx = c;
    Object.assign(ctx.ACTIONS, {
      'ux-palette': () => openPalette(),
      'ux-help': () => openHelp(),
      'ux-tour': () => startTour(),
      'ux-tour-step': (_, v) => { if (!tour) return; tour.i += Number(v); if (tour.i >= tour.steps.length) endTour(true); else if (tour.i >= 0) drawTour(); else tour.i = 0; },
      'ux-tour-end': () => endTour(),
      'ux-theme': () => { const order = ['system', 'light', 'dark'], next = order[(order.indexOf(theme()) + 1) % 3]; setPref('theme', next); toast(next === 'system' ? 'Theme follows your device' : `${next === 'dark' ? 'Dark' : 'Light'} mode on`, 'info'); },
      'ux-pref': (key, v) => setPref(key, v === 'true' ? true : v === 'false' ? false : v),
      'ux-pin': (id) => {
        const p = prefs(), on = (p.pins || []).includes(id);
        p.pins = on ? p.pins.filter((x) => x !== id) : [...(p.pins || []), id];
        ctx.save(); ctx.render();
        toast(on ? 'Unpinned' : 'Pinned to the top of your menu');
      },
      'ux-customize': () => {
        const id = $('.board')?.dataset.board; if (!id) return;
        editing[id] = !editing[id]; ctx.render();
        if (editing[id]) $('.board-bar .btn-primary')?.focus(); else toast('Layout saved');
      },
      'ux-w-size': (wid, n) => { const L = layout(current.id, current.widgets); saveLayout(current.id, { spans: { ...L.spans, [wid]: Number(n) } }); },
      'ux-w-move': (wid, d) => {
        const L = layout(current.id, current.widgets), fixed = (x) => current.widgets.find((w) => w.id === x)?.fixed, order = L.order.filter((x) => !L.hidden.includes(x) && !fixed(x)), i = order.indexOf(wid), j = i + Number(d);
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        saveLayout(current.id, { order: [...order, ...L.hidden] });
        setTimeout(() => $(`[data-act=ux-w-move][data-id="${wid}"][data-v="${d}"]`)?.focus(), 0);
      },
      'ux-w-hide': (wid) => { const L = layout(current.id, current.widgets); saveLayout(current.id, { hidden: [...L.hidden, wid] }); toast('Card hidden. Bring it back from Hidden cards.', 'info'); },
      'ux-w-show': (wid) => { const L = layout(current.id, current.widgets); saveLayout(current.id, { hidden: L.hidden.filter((x) => x !== wid) }); },
      'ux-w-reset': () => { const p = prefs(); delete (p.boards || {})[current.id]; ctx.save(); ctx.render(); toast('Layout reset'); },
      'ux-setup-hide': () => { const p = prefs(); p.setupHidden = { ...(p.setupHidden || {}), [ctx.role()]: true }; ctx.save(); ctx.render(); toast('Checklist hidden. Find it again under Help.', 'info'); },
      'ux-setup-show': () => { const p = prefs(); p.setupHidden = { ...(p.setupHidden || {}), [ctx.role()]: false }; if (p.setupCelebrated) p.setupCelebrated[ctx.role()] = false; ctx.closeOverlay(); ctx.save(); go(ctx.routes()[0].id); },
      'ux-skip': () => { const v = $('#view'); v.focus(); },
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (theme() === 'system') { applyPrefs(); ctx.render(); } });
    window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyPrefs);
    window.addEventListener('resize', () => { if (tour) drawTour(); });
    setInterval(updateLivePill, 30000);
    // Keyboard: ⌘K or / for search, ? for help, Esc closes the palette or tour.
    document.addEventListener('keydown', (ev) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (ctx.role()) (pal ? closePalette() : openPalette()); return; }
      if (ev.key === 'Escape') { if (pal) { ev.stopImmediatePropagation(); closePalette(); return; } if (tour) { ev.stopImmediatePropagation(); endTour(); return; } }
      if (typing || !ctx.role() || pal || tour || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === '/') { ev.preventDefault(); openPalette(); }
      else if (ev.key === '?') { ev.preventDefault(); openHelp(); }
    }, true);
  }

  return { install, prefs, applyPrefs, toast, celebrate, countUp, trapFocus, restoreFocus, board, bindBoard, isEditing, setupCard, appearanceCard, openPalette, closePalette, openHelp, startTour, beforeRender, afterRender, onAction, pins, pulseLive, isDark, reduceMotion, ACCENTS };
})();
