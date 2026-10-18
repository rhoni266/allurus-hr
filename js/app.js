// Allurus HR — single-page app. All data lives in localStorage under STORE_KEY.
(function () {
  'use strict';

  const APP_VERSION = '1.8';
  // Bump the key when the demo data changes shape, so every browser starts fresh.
  const STORE_KEY = 'allurus-hr-v6';
  const esc = U.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- State ----------
  let state = load();
  function load() {
    let s = null;
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { /* storage unavailable */ }
    s = s || AllurusSeed.create();
    [s.settings, ...Object.values(s.workspaces || {}).map((w) => w.settings)].forEach((st) => { if (!st.checkin) st.checkin = defaultZone(st.company, st.office); });
    if (!s.finance) s.finance = AllurusFinance.blank();
    Object.values(s.workspaces || {}).forEach((w) => { if (!w.finance) w.finance = AllurusFinance.blank(); });
    s.reliefs = s.reliefs || {}; s.taxProfiles = s.taxProfiles || {};
    return s;
  }
  function defaultZone(company, office) {
    const c = U.city(office) || U.CITIES[0];
    return { label: `${company} office`, lat: c.lat, lng: c.lng, radius: 50, remote: false };
  }
  let warnedFull = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {
      // Receipt photos and selfies can fill the browser's storage; say so rather than lose changes silently.
      if (e && /quota/i.test(e.name + e.message) && !warnedFull) { warnedFull = true; setTimeout(() => toast('This browser’s storage is full, so your latest change wasn’t saved. Delete old receipts or selfies, or move to the server version.', 'error'), 0); }
    }
  }
  function log(text) { state.activity.unshift({ t: Date.now(), text }); state.activity = state.activity.slice(0, 40); }
  function commit(msg, activity) { if (activity) log(activity); save(); render(); if (msg) toast(msg); }

  // UI-only state (not persisted)
  const ui = {
    empQuery: '', empDept: 'all', empStatus: 'all',
    attDate: U.today(), leaveFilter: 'Pending',
    payMonth: U.monthKey(U.today()), jobFilter: 'all', perfDept: 'all',
    tenantQuery: '', tenantStatus: 'all',
  };

  // ---------- Icons ----------
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    wallet: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
    trend: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.1-.9-1.5-.9-2.6 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="11" cy="7.5" r="1.2"/><circle cx="15.5" cy="8.5" r="1.2"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    minus: '<path d="M5 12h14"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M19 8v6M16 11h6"/>',
  };
  const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

  // ---------- Lookups & formatting ----------
  const emp = (id) => state.employees.find((e) => e.id === id);
  const dept = (id) => state.departments.find((d) => d.id === id);
  const fullName = (e) => (e ? `${e.first} ${e.last}` : 'Unknown');
  // Local symbols where they read better, for example RM for Malaysian ringgit.
  const locale = () => ({ MYR: 'en-MY', SGD: 'en-SG', GBP: 'en-GB', INR: 'en-IN', AUD: 'en-AU', CAD: 'en-CA' })[state.settings.currency] || 'en-US';
  const money = (n, digits = 0) => {
    try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: state.settings.currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n); }
    catch (e) { return state.settings.currency + ' ' + Math.round(n).toLocaleString(); }
  };
  const compactMoney = (n) => {
    try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: state.settings.currency, notation: 'compact', maximumFractionDigits: 1 }).format(n); }
    catch (e) { return money(n); }
  };
  function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function avatar(name, size = '') {
    const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="avatar ${size}" style="background:hsl(${hue(name)} 38% 46%)">${esc(initials)}</span>`;
  }
  function person(e, sub) {
    const n = fullName(e);
    return `<div class="person">${avatar(n)}<div style="min-width:0"><div class="person-name">${esc(n)}</div><div class="person-sub">${esc(sub ?? e.role)}</div></div></div>`;
  }
  const deptTag = (id) => { const d = dept(id); return d ? `<span class="dept"><i style="background:${d.color}"></i>${esc(d.name)}</span>` : '<span class="faint">—</span>'; };
  const timeAgo = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Just now'; if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24); return d === 1 ? 'Yesterday' : `${d} days ago`;
  };
  const stars = (n) => n ? `<span class="stars" aria-label="${n} of 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>` : '<span class="faint">Not rated</span>';

  // ---------- Derived data ----------
  const activeEmployees = () => state.employees.filter((e) => e.status === 'Active');
  const onLeaveOn = (id, day) => state.leaves.some((l) => l.empId === id && l.status === 'Approved' && l.from <= day && l.to >= day);
  const empStatus = (e) => e.status !== 'Active' ? 'Inactive' : onLeaveOn(e.id, U.today()) ? 'On leave' : 'Active';
  const statusPill = (s) => `<span class="pill ${({ Active: 'ok', 'On leave': 'gold', Inactive: '' })[s] ?? ''}">${esc(s)}</span>`;
  const leavePill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'ok', Rejected: 'bad' })[s]}">${s}</span>`;
  const pendingLeaves = () => state.leaves.filter((l) => l.status === 'Pending');
  function leaveUsed(id, type) {
    const y = U.today().slice(0, 4);
    return state.leaves.filter((l) => l.empId === id && l.type === type && l.status === 'Approved' && l.from.startsWith(y)).reduce((s, l) => s + l.days, 0);
  }
  function dayStats(day) {
    const rec = state.attendance[day] || {};
    const c = { present: 0, remote: 0, absent: 0, leave: 0, none: 0 };
    activeEmployees().filter((e) => e.start <= day).forEach((e) => { const r = rec[e.id]; c[r ? r.s : 'none']++; });
    c.total = c.present + c.remote + c.absent + c.leave + c.none;
    return c;
  }
  const payTotal = (run) => run.items.reduce((a, i) => ({ gross: a.gross + i.gross, tax: a.tax + i.tax, benefits: a.benefits + i.benefits, net: a.net + i.net }), { gross: 0, tax: 0, benefits: 0, net: 0 });

  // ---------- Routing ----------
  const ROLES = {
    super: { label: 'Super Admin', desc: 'Monitor every company subscribed to Allurus: plans, revenue and account health.' },
    admin: { label: 'Company Admin', desc: 'Run HR for your company: people, attendance, time off, payroll and hiring.' },
    employee: { label: 'Employee', desc: 'Check in, request time off, see payslips and track your goals.' },
    auditor: { label: 'Auditor', desc: 'Review and verify the company’s monthly financial reports.' },
  };
  const ROLE_ROUTES = {
    super: [
      { id: 'platform', label: 'Overview', icon: 'dashboard', group: 'Platform' },
      { id: 'companies', label: 'Companies', icon: 'building', group: 'Platform' },
      { id: 'billing', label: 'Plans & billing', icon: 'wallet', group: 'Platform' },
      { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Account' },
    ],
    employee: [
      { id: 'home', label: 'Home', icon: 'dashboard', group: 'Me' },
      { id: 'my-time', label: 'My attendance', icon: 'clock', group: 'Me' },
      { id: 'my-leave', label: 'My time off', icon: 'calendar', group: 'Me' },
      { id: 'my-pay', label: 'Payslips', icon: 'wallet', group: 'Me' },
      { id: 'my-profile', label: 'Profile & goals', icon: 'trend', group: 'Me' },
      { id: 'my-tax', label: 'Tax reliefs', icon: 'percent', group: 'Me' },
      { id: 'directory', label: 'Directory', icon: 'people', group: 'Company' },
      { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Account' },
    ],
    auditor: [
      { id: 'reports', label: 'Reports to verify', icon: 'shield', group: 'Audit' },
      { id: 'tax', label: 'Tax deductions', icon: 'percent', group: 'Audit' },
      { id: 'books', label: 'Bookkeeping', icon: 'book', group: 'Records' },
      { id: 'invoices', label: 'Invoices', icon: 'doc', group: 'Records' },
      { id: 'bills', label: 'Bills', icon: 'receipt', group: 'Records' },
      { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Account' },
    ],
  };
  const role = () => (state.session?.account && state.session.roles?.includes(state.session.role) ? state.session.role : null);
  const account = () => state.accounts.find((a) => a.email === state.session.account);
  const me = () => emp(state.session.empId) || activeEmployees()[0];
  ROLE_ROUTES.admin = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Overview' },
    { id: 'employees', label: 'Employees', icon: 'people', group: 'Workforce' },
    { id: 'departments', label: 'Departments', icon: 'building', group: 'Workforce' },
    { id: 'attendance', label: 'Attendance', icon: 'clock', group: 'Time' },
    { id: 'leave', label: 'Time off', icon: 'calendar', group: 'Time' },
    { id: 'finance', label: 'Overview', icon: 'coins', group: 'Finance & Accounting' },
    { id: 'books', label: 'Bookkeeping', icon: 'book', group: 'Finance & Accounting' },
    { id: 'invoices', label: 'Invoices', icon: 'doc', group: 'Finance & Accounting' },
    { id: 'bills', label: 'Bills', icon: 'receipt', group: 'Finance & Accounting' },
    { id: 'payroll', label: 'Payroll', icon: 'wallet', group: 'Finance & Accounting' },
    { id: 'budget', label: 'Budget', icon: 'target', group: 'Finance & Accounting' },
    { id: 'tax', label: 'Tax (LHDN)', icon: 'percent', group: 'Finance & Accounting' },
    { id: 'reports', label: 'Reports & audit', icon: 'shield', group: 'Finance & Accounting' },
    { id: 'recruitment', label: 'Recruitment', icon: 'briefcase', group: 'Talent' },
    { id: 'performance', label: 'Performance', icon: 'trend', group: 'Talent' },
    { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Workspace' },
  ];
  const routes = () => ROLE_ROUTES[role()] || [];
  const route = () => { const h = location.hash.replace('#', ''); const rs = routes(); return rs.some((r) => r.id === h) ? h : rs[0].id; };

  function renderNav() {
    let html = '', group = '';
    routes().forEach((r) => {
      if (r.group !== group) { group = r.group; html += `<div class="nav-label">${group}</div>`; }
      const count = r.id === 'leave' ? pendingLeaves().length : r.id === 'attendance' ? securityQueue().count : r.id === 'companies' ? state.platform.tenants.filter((t) => t.status === 'Past due').length : (finApi?.badge(r.id) || 0);
      html += `<a href="#${r.id}" class="${route() === r.id ? 'active' : ''}">${icon(r.icon)}<span>${r.label}</span>${count ? `<span class="count">${count}</span>` : ''}</a>`;
    });
    $('#nav').innerHTML = html;
    $('#company-name').textContent = role() === 'super' ? 'Platform console' : state.settings.company;
    const who = role() === 'super' ? { name: 'You', sub: 'Super Admin' } : role() === 'admin' ? { name: fullName(state.employees.find((e) => e.id === 'e1')) , sub: `Admin · ${state.settings.company}` } : { name: fullName(me()), sub: me().role };
    const acct = account();
    if (role() === 'super') { who.name = acct?.name || 'Allurus HQ'; who.sub = 'Super Admin'; }
    if (role() === 'auditor') { who.name = acct?.name || 'Auditor'; who.sub = 'Auditor'; }
    $('#me-card').innerHTML = `<div class="me-row">${avatar(who.name, 'sm')}<div style="min-width:0;flex:1"><div class="me-name">${esc(who.name)}</div><div class="me-role">${esc(acct?.email || who.sub)}</div></div></div>
      <div class="me-actions">${state.session.roles.length > 1 ? `<select class="select" id="role-switch" aria-label="Switch view">${state.session.roles.map((r) => `<option value="${r}" ${r === role() ? 'selected' : ''}>${ROLES[r].label} view</option>`).join('')}</select>` : `<span class="pill brand">${ROLES[role()].label}</span>`}<button class="btn btn-sm btn-ghost" data-act="logout">Sign out</button></div>`;
    $('#role-switch')?.addEventListener('change', (ev) => {
      state.session.role = ev.target.value; save();
      if (location.hash) location.hash = ''; else render();
      toast(`Switched to ${ROLES[ev.target.value].label} view`);
    });
    $('.search').hidden = role() !== 'admin';
  }

  function render() {
    applyTheme();
    const signedIn = !!role();
    $('#login').hidden = signedIn;
    $('.app').hidden = !signedIn;
    if (!signedIn) { $('#login').innerHTML = loginView(); bindLogin(); return; }
    renderNav();
    const view = $('#view');
    view.innerHTML = VIEWS[route()]();
    AFTER[route()]?.();
    $('#sidebar').classList.remove('open');
  }

  // ---------- Views ----------
  const VIEWS = {};
  const AFTER = {};
  const ACTIONS_EXTRA = {};
  let finApi = null;
  let clockTimer = null;

  VIEWS.dashboard = () => {
    const T = U.today();
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const active = activeEmployees();
    const wd = U.lastWorkday(T);
    const ds = dayStats(wd);
    const inOffice = ds.present + ds.remote;
    const rate = ds.total ? Math.round((inOffice / ds.total) * 100) : 0;
    const out = active.filter((e) => onLeaveOn(e.id, T));
    const openRoles = state.jobs.length;
    const activeCands = state.candidates.filter((c) => c.stage !== 'Hired').length;
    const pend = pendingLeaves();
    const paidMonths = Object.keys(state.payroll).filter((k) => state.payroll[k].status === 'Paid').sort();
    const lastPaid = paidMonths[paidMonths.length - 1];

    return `
      <div class="page-head">
        <div>
          <div class="eyebrow">${U.fmtDate(T, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <h1>${greet}, ${esc(state.employees.find((e) => e.id === 'e1')?.first || 'there')}.</h1>
          <p class="sub">Here is how ${esc(state.settings.company)} is doing today. ${pend.length ? `You have ${pend.length} time-off request${pend.length > 1 ? 's' : ''} waiting for review.` : 'Nothing is waiting for your review.'}</p>
        </div>
        <div class="actions">
          <button class="btn" data-act="new-leave">${icon('calendar')}Request time off</button>
          <button class="btn btn-primary" data-act="add-emp">${icon('plus')}Add employee</button>
        </div>
      </div>

      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Employees</div><div class="kpi-value">${active.length}</div><div class="kpi-foot">${state.departments.length} departments</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Attendance</div><div class="kpi-value">${rate}%</div><div class="kpi-foot">${inOffice} of ${ds.total} in · ${wd === T ? 'today' : U.fmtDate(wd, { weekday: 'short', month: 'short', day: 'numeric' })}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>On leave today</div><div class="kpi-value">${out.length}</div><div class="kpi-foot">${out.length ? esc(out.map((e) => e.first).join(', ')) : 'Everyone is in'}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Open roles</div><div class="kpi-value">${openRoles}</div><div class="kpi-foot">${activeCands} candidates in pipeline</div></div>
      </div>

      <div class="grid g-main">
        <div class="card">
          <div class="card-head"><h3>Attendance, last 7 workdays</h3><div class="legend"><span><i style="background:var(--brand)"></i>In office</span><span><i style="background:var(--gold)"></i>Remote</span></div></div>
          ${attendanceChart(wd)}
        </div>
        <div class="card">
          <div class="card-head"><h3>Waiting for approval</h3><a href="#leave" class="hint">View all</a></div>
          ${pend.length ? `<div class="list">${pend.slice(0, 4).map((l) => {
            const e = emp(l.empId);
            return `<div class="list-item">${avatar(fullName(e))}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">${l.type} · ${l.days} day${l.days > 1 ? 's' : ''} · ${U.fmtDate(l.from, { month: 'short', day: 'numeric' })}${l.to !== l.from ? ' – ' + U.fmtDate(l.to, { month: 'short', day: 'numeric' }) : ''}</div></div>
              <button class="btn btn-sm btn-icon btn-ok" data-act="approve-leave" data-id="${l.id}" aria-label="Approve">${icon('check')}</button>
              <button class="btn btn-sm btn-icon btn-danger" data-act="reject-leave" data-id="${l.id}" aria-label="Decline">${icon('x')}</button></div>`;
          }).join('')}</div>` : '<div class="empty"><strong>All caught up</strong>New requests will appear here.</div>'}
        </div>
      </div>

      <div class="grid g-3">
        <div class="card">
          <div class="card-head"><h3>Headcount by department</h3></div>
          ${deptBars()}
        </div>
        <div class="card">
          <div class="card-head"><h3>Net payroll</h3><span class="hint">${lastPaid ? 'Last paid ' + U.fmtMonth(lastPaid, { month: 'short' }) : ''}</span></div>
          ${payrollChart()}
        </div>
        <div class="card">
          <div class="card-head"><h3>Coming up</h3><span class="hint">Next 30 days</span></div>
          ${upcomingList()}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Recent activity</h3></div>
        <div class="list">${state.activity.slice(0, 6).map((a) => `<div class="list-item"><div class="grow">${esc(a.text)}</div><span class="faint" style="white-space:nowrap">${timeAgo(a.t)}</span></div>`).join('') || '<div class="empty">No activity yet.</div>'}</div>
      </div>`;
  };

  function attendanceChart(endDay) {
    const days = [];
    let d = endDay;
    while (days.length < 7) { if (!U.isWeekend(d)) days.unshift(d); d = U.addDays(d, -1); }
    const W = 560, H = 220, L = 34, B = 26, top = 18, cw = (W - L) / days.length, bw = Math.min(38, cw * 0.5);
    const y = (p) => top + (H - top - B) * (1 - p / 100);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Attendance rate per day">`;
    [0, 50, 100].forEach((p) => { svg += `<line class="grid-line" x1="${L}" x2="${W}" y1="${y(p)}" y2="${y(p)}"/><text class="axis" x="${L - 8}" y="${y(p) + 4}" text-anchor="end">${p}%</text>`; });
    days.forEach((day, i) => {
      const s = dayStats(day);
      const pp = s.total ? (s.present / s.total) * 100 : 0;
      const rp = s.total ? (s.remote / s.total) * 100 : 0;
      const x = L + cw * i + (cw - bw) / 2;
      svg += `<rect class="b-present" x="${x}" y="${y(pp)}" width="${bw}" height="${y(0) - y(pp)}" rx="5"><title>${U.fmtDate(day)}: ${s.present} in office</title></rect>`;
      if (rp > 0) svg += `<rect class="b-remote" x="${x}" y="${y(pp + rp)}" width="${bw}" height="${Math.max(0, y(pp) - y(pp + rp) - 2)}" rx="5"><title>${s.remote} remote</title></rect>`;
      svg += `<text class="val" x="${x + bw / 2}" y="${y(pp + rp) - 6}" text-anchor="middle">${Math.round(pp + rp)}%</text>`;
      svg += `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${U.fmtDate(day, { weekday: 'short' })} ${U.parse(day).getDate()}</text>`;
    });
    return svg + '</svg>';
  }

  function deptBars() {
    const counts = state.departments.map((d) => ({ d, n: activeEmployees().filter((e) => e.dept === d.id).length }));
    const max = Math.max(1, ...counts.map((c) => c.n));
    return counts.map(({ d, n }) => `<div class="hbar"><span class="dept" style="overflow:hidden">${esc(d.name)}</span><div class="hbar-track"><i style="width:${(n / max) * 100}%;background:${d.color}"></i></div><span class="num r">${n}</span></div>`).join('');
  }

  function payrollChart() {
    const months = Object.keys(state.payroll).filter((k) => state.payroll[k].status === 'Paid').sort().slice(-6);
    if (months.length < 2) return '<div class="empty"><strong>Not enough history</strong>Run payroll for two months to see the trend.</div>';
    const vals = months.map((m) => payTotal(state.payroll[m]).net);
    const W = 320, H = 170, L = 6, R = 6, top = 34, B = 24;
    const min = Math.min(...vals) * 0.97, max = Math.max(...vals) * 1.01;
    const x = (i) => L + ((W - L - R) * i) / (months.length - 1);
    const y = (v) => top + (H - top - B) * (1 - (v - min) / (max - min || 1));
    const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const last = vals.length - 1;
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net payroll by month">`;
    svg += `<line class="grid-line" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>`;
    svg += `<polygon class="area" points="${x(0)},${H - B} ${pts} ${x(last)},${H - B}"/>`;
    svg += `<polyline class="line" points="${pts}"/>`;
    vals.forEach((v, i) => { svg += `<circle class="${i === last ? 'pt-end' : 'pt'}" cx="${x(i)}" cy="${y(v)}" r="${i === last ? 5.5 : 3.5}"><title>${U.fmtMonth(months[i])}: ${money(v)}</title></circle>`; });
    months.forEach((m, i) => { svg += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === last ? 'end' : 'middle'}">${U.fmtMonth(m, { month: 'short' })}</text>`; });
    svg += `<text class="val" x="${x(last)}" y="${y(vals[last]) - 14}" text-anchor="end">${compactMoney(vals[last])}</text>`;
    return svg + '</svg>';
  }

  function upcomingList() {
    const T = U.today(), end = U.addDays(T, 30);
    const items = [];
    activeEmployees().forEach((e) => {
      const yr = T.slice(0, 4);
      [yr, String(+yr + 1)].forEach((y) => {
        const b = y + e.birthday.slice(4);
        if (b >= T && b <= end) items.push({ date: b, e, text: 'Birthday' });
        const a = y + e.start.slice(4);
        const years = +y - +e.start.slice(0, 4);
        if (years > 0 && a >= T && a <= end) items.push({ date: a, e, text: `${years}-year work anniversary` });
      });
    });
    state.leaves.filter((l) => l.status === 'Approved' && l.from > T && l.from <= end).forEach((l) => items.push({ date: l.from, e: emp(l.empId), text: `${l.type} leave, ${l.days} day${l.days > 1 ? 's' : ''}` }));
    items.sort((a, b) => a.date.localeCompare(b.date));
    if (!items.length) return '<div class="empty"><strong>A quiet month</strong>No birthdays, anniversaries or leave ahead.</div>';
    return `<div class="list">${items.slice(0, 5).map((it) => `<div class="list-item">${avatar(fullName(it.e), 'sm')}<div class="grow"><div class="person-name">${esc(fullName(it.e))}</div><div class="person-sub">${esc(it.text)}</div></div><span class="pill ${it.text === 'Birthday' ? 'gold' : 'brand'}">${U.fmtDate(it.date, { month: 'short', day: 'numeric' })}</span></div>`).join('')}</div>`;
  }

  // ----- Employees -----
  VIEWS.employees = () => {
    const q = ui.empQuery.toLowerCase();
    const list = state.employees.filter((e) => {
      if (ui.empDept !== 'all' && e.dept !== ui.empDept) return false;
      if (ui.empStatus !== 'all' && empStatus(e) !== ui.empStatus) return false;
      return !q || `${fullName(e)} ${e.email} ${e.role}`.toLowerCase().includes(q);
    }).sort((a, b) => a.first.localeCompare(b.first));
    return `
      <div class="page-head">
        <div><h1>Employees</h1><p class="sub">${activeEmployees().length} active people across ${state.departments.length} departments.</p></div>
        <div class="actions"><button class="btn" data-act="export-emps">${icon('download')}Export CSV</button><button class="btn btn-primary" data-act="add-emp">${icon('plus')}Add employee</button></div>
      </div>
      <div class="card card-flush">
        <div class="toolbar">
          <input class="input" id="emp-q" type="search" placeholder="Search by name, email or role" value="${esc(ui.empQuery)}" style="flex:1;min-width:200px">
          <select class="select" id="emp-dept"><option value="all">All departments</option>${state.departments.map((d) => `<option value="${d.id}" ${ui.empDept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
          <div class="seg" role="group" aria-label="Status">${['all', 'Active', 'On leave', 'Inactive'].map((s) => `<button data-act="emp-status" data-v="${s}" class="${ui.empStatus === s ? 'on' : ''}">${s === 'all' ? 'All' : s}</button>`).join('')}</div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th class="hide-sm">Department</th><th>Status</th><th class="hide-sm">Location</th><th class="hide-sm">Start date</th><th class="r">Salary</th><th></th></tr></thead>
          <tbody>${list.map((e) => `<tr class="clickable" data-act="view-emp" data-id="${e.id}">
            <td>${person(e)}</td><td class="hide-sm">${deptTag(e.dept)}</td><td>${statusPill(empStatus(e))}</td>
            <td class="hide-sm muted">${esc(e.location)}</td><td class="hide-sm muted num">${U.fmtDate(e.start)}</td>
            <td class="r num">${money(e.salary)}</td>
            <td><div class="row-actions"><button class="btn btn-sm btn-icon btn-ghost" data-act="edit-emp" data-id="${e.id}" aria-label="Edit ${esc(fullName(e))}">${icon('edit')}</button></div></td></tr>`).join('')}</tbody>
        </table>${list.length ? '' : '<div class="empty"><strong>No one matches those filters</strong>Try a different search or clear the filters.</div>'}</div>
      </div>`;
  };
  AFTER.employees = () => {
    const q = $('#emp-q');
    q.addEventListener('input', () => { ui.empQuery = q.value; const pos = q.selectionStart; render(); const n = $('#emp-q'); n.focus(); n.setSelectionRange(pos, pos); });
    $('#emp-dept').addEventListener('change', (ev) => { ui.empDept = ev.target.value; render(); });
  };

  function employeeForm(e = {}) {
    const opt = (arr, v) => arr.map((o) => { const [val, label] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(label)}</option>`; }).join('');
    return `<div class="form-grid">
      <div class="field"><label for="f-first">First name</label><input class="input" id="f-first" name="first" required value="${esc(e.first)}"></div>
      <div class="field"><label for="f-last">Last name</label><input class="input" id="f-last" name="last" required value="${esc(e.last)}"></div>
      <div class="field"><label for="f-email">Work email</label><input class="input" id="f-email" name="email" type="email" required value="${esc(e.email)}"></div>
      <div class="field"><label for="f-phone">Phone</label><input class="input" id="f-phone" name="phone" value="${esc(e.phone)}"></div>
      <div class="field"><label for="f-role">Job title</label><input class="input" id="f-role" name="role" required value="${esc(e.role)}"></div>
      <div class="field"><label for="f-dept">Department</label><select class="select" id="f-dept" name="dept">${opt(state.departments.map((d) => [d.id, d.name]), e.dept)}</select></div>
      <div class="field"><label for="f-manager">Manager</label><select class="select" id="f-manager" name="manager"><option value="">No manager</option>${opt(state.employees.filter((x) => x.id !== e.id).map((x) => [x.id, fullName(x)]), e.manager)}</select></div>
      <div class="field"><label for="f-type">Employment type</label><select class="select" id="f-type" name="type">${opt(['Full-time', 'Part-time', 'Contract', 'Intern'], e.type || 'Full-time')}</select></div>
      <div class="field"><label for="f-location">Location</label><input class="input" id="f-location" name="location" value="${esc(e.location)}"></div>
      <div class="field"><label for="f-salary">Annual salary (${esc(state.settings.currency)})</label><input class="input" id="f-salary" name="salary" type="number" min="0" step="500" required value="${esc(e.salary)}"></div>
      <div class="field"><label for="f-start">Start date</label><input class="input" id="f-start" name="start" type="date" required value="${esc(e.start || U.today())}"></div>
      <div class="field"><label for="f-birthday">Date of birth</label><input class="input" id="f-birthday" name="birthday" type="date" value="${esc(e.birthday)}"></div>
      <div class="field"><label for="f-status">Status</label><select class="select" id="f-status" name="status">${opt(['Active', 'Inactive'], e.status || 'Active')}</select></div>
    </div>`;
  }
  function openEmployeeModal(id, prefill, onCreated) {
    const e = id ? emp(id) : (prefill || {});
    openModal({
      title: id ? 'Edit employee' : 'Add employee', body: employeeForm(e), submit: id ? 'Save changes' : 'Add employee',
      onSubmit(d) {
        d.salary = Number(d.salary) || 0;
        if (id) { Object.assign(emp(id), d); commit('Changes saved', `${d.first} ${d.last}'s profile was updated`); }
        else {
          const ne = { id: U.uid('e'), ...d };
          state.employees.push(ne);
          state.reviews.push({ id: U.uid('r'), empId: ne.id, cycle: 'H2 ' + U.today().slice(0, 4), status: 'Not started', rating: 0, progress: 0, notes: '' });
          onCreated?.(ne);
          commit(`${d.first} added`, `${d.first} ${d.last} joined as ${d.role}`);
        }
      },
    });
  }

  function openProfile(id) {
    const e = emp(id); if (!e) return;
    const T = U.today();
    const days = []; let d = U.lastWorkday(T);
    while (days.length < 10) { if (!U.isWeekend(d)) days.unshift(d); d = U.addDays(d, -1); }
    const mgr = emp(e.manager);
    const aU = leaveUsed(id, 'Annual'), sU = leaveUsed(id, 'Sick');
    const label = { present: 'P', remote: 'R', absent: 'A', leave: 'L', none: '·' };
    openDrawer(`
      <div class="drawer-hero">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">${avatar(fullName(e), 'lg')}<button class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close">${icon('x')}</button></div>
        <div><h2 style="font-size:24px;letter-spacing:-0.02em">${esc(fullName(e))}</h2><div class="muted" style="margin-top:2px">${esc(e.role)}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${statusPill(empStatus(e))}${deptTag(e.dept)}</div>
        <div class="actions"><button class="btn btn-sm btn-primary" data-act="edit-emp" data-id="${e.id}">${icon('edit')}Edit</button><button class="btn btn-sm" data-act="new-leave" data-id="${e.id}">${icon('calendar')}Request leave</button><button class="btn btn-sm btn-danger" data-act="ask-delete-emp" data-id="${e.id}">${icon('trash')}Remove</button></div>
        <div id="del-confirm"></div>
      </div>
      <div class="drawer-section"><h4>Contact</h4><dl class="kv"><dt>Email</dt><dd>${esc(e.email)}</dd><dt>Phone</dt><dd>${esc(e.phone || '—')}</dd><dt>Location</dt><dd>${esc(e.location || '—')}</dd></dl></div>
      <div class="drawer-section"><h4>Employment</h4><dl class="kv">
        <dt>Type</dt><dd>${esc(e.type)}</dd><dt>Manager</dt><dd>${mgr ? esc(fullName(mgr)) : '—'}</dd>
        <dt>Start date</dt><dd>${U.fmtDate(e.start)}</dd><dt>Date of birth</dt><dd>${U.fmtDate(e.birthday)}</dd>
        <dt>Salary</dt><dd class="num">${money(e.salary)} / year</dd><dt>Monthly gross</dt><dd class="num">${money(e.salary / 12)}</dd></dl></div>
      <div class="drawer-section"><h4>Time off this year</h4>
        <div class="hbar" style="grid-template-columns:70px minmax(0,1fr) 70px"><span>Annual</span><div class="hbar-track"><i style="width:${Math.min(100, (aU / state.settings.annualDays) * 100)}%;background:var(--brand)"></i></div><span class="num r muted">${aU}/${state.settings.annualDays}</span></div>
        <div class="hbar" style="grid-template-columns:70px minmax(0,1fr) 70px"><span>Sick</span><div class="hbar-track"><i style="width:${Math.min(100, (sU / state.settings.sickDays) * 100)}%;background:var(--gold)"></i></div><span class="num r muted">${sU}/${state.settings.sickDays}</span></div>
      </div>
      ${securitySection(e)}
      <div class="drawer-section"><h4>Last 10 workdays</h4>
        <div class="dots">${days.map((dd) => { const r = state.attendance[dd]?.[e.id]; const s = r ? r.s : 'none'; return `<span class="d-${s}" title="${U.fmtDate(dd)}: ${s === 'none' ? 'Not marked' : s}">${label[s]}</span>`; }).join('')}</div>
        <div class="legend"><span><i class="d-present"></i>Present</span><span><i class="d-remote"></i>Remote</span><span><i class="d-absent"></i>Absent</span><span><i class="d-leave"></i>Leave</span></div>
      </div>`);
  }

  // ----- Departments -----
  VIEWS.departments = () => `
    <div class="page-head"><div><h1>Departments</h1><p class="sub">What each team is responsible for, who leads it and what it costs.</p></div>
      <div class="actions"><button class="btn btn-primary" data-act="add-dept">${icon('plus')}New department</button></div></div>
    <div class="grid g-3">${state.departments.map((d) => {
      const members = activeEmployees().filter((e) => e.dept === d.id);
      const payroll = members.reduce((s, e) => s + e.salary, 0);
      const lead = emp(d.lead);
      return `<div class="card dcard">
        <div class="dcard-top"><h3><i style="background:${d.color}"></i>${esc(d.name)}</h3>
          <div class="row-actions"><button class="btn btn-sm btn-icon btn-ghost" data-act="edit-dept" data-id="${d.id}" aria-label="Edit ${esc(d.name)}">${icon('edit')}</button><button class="btn btn-sm btn-icon btn-ghost" data-act="del-dept" data-id="${d.id}" aria-label="Delete ${esc(d.name)}">${icon('trash')}</button></div></div>
        ${d.about ? `<p class="muted" style="font-size:13.5px">${esc(d.about)}</p>` : ''}
        ${d.duties ? `<div class="duties">${d.duties.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
        ${d.note ? `<p class="dept-note">${icon('pin')}<span>${esc(d.note)}</span></p>` : ''}
        ${lead ? person(lead, 'Department lead') : '<div class="faint">No lead assigned</div>'}
        <div class="stats"><div><div class="stat-v">${members.length}</div><div class="stat-l">People</div></div><div><div class="stat-v">${compactMoney(members.length ? payroll / members.length : 0)}</div><div class="stat-l">Avg salary</div></div><div><div class="stat-v">${compactMoney(payroll)}</div><div class="stat-l">Annual cost</div></div></div>
        <div class="faces">${members.slice(0, 7).map((e) => avatar(fullName(e), 'sm')).join('')}${members.length > 7 ? `<span class="avatar sm" style="background:var(--fg-3)">+${members.length - 7}</span>` : ''}</div>
      </div>`;
    }).join('')}</div>`;

  function openDeptModal(id) {
    const d = id ? dept(id) : { color: '#14958A' };
    const colors = ['#14958A', '#4A6FD1', '#B8914A', '#C2577A', '#7A62C9', '#5E8C3A', '#D07A3A', '#3A8FB0'];
    openModal({
      title: id ? 'Edit department' : 'New department', size: 'sm', submit: id ? 'Save' : 'Create department',
      body: `<div class="form-grid" style="grid-template-columns:1fr">
        <div class="field"><label for="d-name">Name</label><input class="input" id="d-name" name="name" required value="${esc(d.name)}"></div>
        <div class="field"><label for="d-lead">Department lead</label><select class="select" id="d-lead" name="lead"><option value="">No lead</option>${state.employees.map((e) => `<option value="${e.id}" ${d.lead === e.id ? 'selected' : ''}>${esc(fullName(e))}</option>`).join('')}</select></div>
        <div class="field"><label for="d-color">Color</label><select class="select" id="d-color" name="color">${colors.map((c, i) => `<option value="${c}" ${d.color === c ? 'selected' : ''}>${['Teal', 'Blue', 'Champagne', 'Rose', 'Violet', 'Olive', 'Amber', 'Sky'][i]}</option>`).join('')}</select></div>
        <div class="field"><label for="d-about">Role</label><textarea class="textarea" id="d-about" name="about" style="min-height:64px" placeholder="What this department is responsible for">${esc(d.about || '')}</textarea></div>
        <div class="field"><label for="d-duties">Key responsibilities</label><input class="input" id="d-duties" name="duties" value="${esc(d.duties || '')}" placeholder="Separate with commas"></div>
        <div class="field"><label for="d-note">Note</label><textarea class="textarea" id="d-note" name="note" style="min-height:64px">${esc(d.note || '')}</textarea></div></div>`,
      onSubmit(f) {
        if (id) { Object.assign(dept(id), f); commit('Department saved'); }
        else { state.departments.push({ id: U.uid('d-'), ...f }); commit('Department created', `${f.name} department was created`); }
      },
    });
  }

  // ----- Attendance -----
  VIEWS.attendance = () => {
    const day = ui.attDate;
    const rec = state.attendance[day] || {};
    const s = dayStats(day);
    const people = activeEmployees().filter((e) => e.start <= day).sort((a, b) => a.first.localeCompare(b.first));
    const opts = [['present', 'Present'], ['remote', 'Remote'], ['absent', 'Absent'], ['leave', 'Leave']];
    return `
      <div class="page-head"><div><h1>Attendance</h1><p class="sub">Mark who is in, remote or out. Approved leave is filled in automatically.</p></div>
        <div class="actions">
          <button class="btn btn-icon" data-act="att-shift" data-v="-1" aria-label="Previous day">${icon('left')}</button>
          <input class="input" type="date" id="att-date" value="${day}" max="${U.addDays(U.today(), 30)}">
          <button class="btn btn-icon" data-act="att-shift" data-v="1" aria-label="Next day">${icon('right')}</button>
          <button class="btn" data-act="att-today">Today</button>
          <button class="btn btn-primary" data-act="att-all">${icon('check')}Mark rest present</button>
        </div></div>
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>In office</div><div class="kpi-value">${s.present}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Remote</div><div class="kpi-value">${s.remote}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Absent</div><div class="kpi-value">${s.absent}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>On leave</div><div class="kpi-value">${s.leave}</div><div class="kpi-foot">${s.none} not marked</div></div>
      </div>
      ${securityCard()}
      <div class="card card-flush">
        <div class="card-head" style="padding-bottom:14px"><h3>${U.fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3>${U.isWeekend(day) ? '<span class="pill gold">Weekend</span>' : ''}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th class="hide-sm">Department</th><th>Check-in</th><th class="hide-sm">Location</th><th>Status</th></tr></thead>
          <tbody>${people.map((e) => { const r = rec[e.id]; return `<tr>
            <td>${person(e)}</td><td class="hide-sm">${deptTag(e.dept)}</td>
            <td class="num muted">${r?.in || '—'}${r?.out ? '–' + r.out : ''}${r?.history?.length ? `<div class="faint" style="font-size:12px">${r.history.length + 1} check-ins</div>` : ''}${r?.face ? `<div style="margin-top:3px">${faceTag(r)}</div>` : ''}</td>
            <td class="hide-sm muted" style="font-size:12.5px;max-width:300px"><div class="loc-cell">${selfieThumb(e.id, day, r)}<span>${r?.loc ? esc(locText(r.loc)) : '—'}</span></div></td>
            <td><div class="att-controls"><div class="seg status" role="group" aria-label="Status for ${esc(fullName(e))}">${opts.map(([v, l]) => `<button data-act="att-set" data-id="${e.id}" data-v="${v}" class="${r?.s === v ? 'on' : ''}">${l}</button>`).join('')}</div>${r ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="att-clear" data-id="${e.id}" title="Clear check-in" aria-label="Clear check-in for ${esc(fullName(e))}">${icon('x')}</button>` : ''}</div></td></tr>`; }).join('')}</tbody>
        </table></div>
      </div>`;
  };
  AFTER.attendance = () => { $('#att-date').addEventListener('change', (ev) => { if (ev.target.value) { ui.attDate = ev.target.value; render(); } }); };
  function setAttendance(id, s) {
    const day = ui.attDate;
    state.attendance[day] = state.attendance[day] || {};
    const prev = state.attendance[day][id];
    let time = '';
    if (s === 'present' || s === 'remote') {
      if (prev?.in) time = prev.in;
      else if (day === U.today()) { const n = new Date(); time = `${U.pad(n.getHours())}:${U.pad(n.getMinutes())}`; }
      else time = '09:00';
    }
    state.attendance[day][id] = { s, in: time };
    save(); render();
  }

  // ----- Leave -----
  VIEWS.leave = () => {
    const f = ui.leaveFilter;
    const list = state.leaves.filter((l) => f === 'All' || l.status === f).sort((a, b) => b.from.localeCompare(a.from));
    const counts = { Pending: 0, Approved: 0, Rejected: 0 }; state.leaves.forEach((l) => counts[l.status]++);
    return `
      <div class="page-head"><div><h1>Time off</h1><p class="sub">Policy: ${state.settings.annualDays} annual days and ${state.settings.sickDays} sick days per person each year. Weekends are not counted.</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="new-leave">${icon('plus')}New request</button></div></div>
      <div class="card card-flush">
        <div class="toolbar"><div class="seg" role="group" aria-label="Filter">${['Pending', 'Approved', 'Rejected', 'All'].map((s) => `<button data-act="leave-filter" data-v="${s}" class="${f === s ? 'on' : ''}">${s}${s !== 'All' ? ` <span class="faint">${counts[s]}</span>` : ''}</button>`).join('')}</div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th class="r">Days</th><th class="hide-sm">Reason</th><th>Status</th><th></th></tr></thead>
          <tbody>${list.map((l) => { const e = emp(l.empId); if (!e) return ''; return `<tr>
            <td>${person(e)}</td><td>${l.type}</td>
            <td class="num" style="white-space:nowrap">${U.fmtDate(l.from, { month: 'short', day: 'numeric' })}${l.to !== l.from ? ' – ' + U.fmtDate(l.to, { month: 'short', day: 'numeric' }) : ''}</td>
            <td class="r num">${l.days}</td><td class="hide-sm muted">${esc(l.reason || '—')}</td><td>${leavePill(l.status)}</td>
            <td><div class="row-actions">${l.status === 'Pending'
              ? `<button class="btn btn-sm btn-ok" data-act="approve-leave" data-id="${l.id}">Approve</button><button class="btn btn-sm btn-danger" data-act="reject-leave" data-id="${l.id}">Decline</button>`
              : `<button class="btn btn-sm btn-icon btn-ghost" data-act="del-leave" data-id="${l.id}" aria-label="Delete request">${icon('trash')}</button>`}</div></td></tr>`; }).join('')}</tbody>
        </table>${list.length ? '' : `<div class="empty"><strong>No ${f.toLowerCase()} requests</strong>${f === 'Pending' ? 'You are all caught up.' : ''}</div>`}</div>
      </div>
      <div class="card card-flush">
        <div class="card-head" style="padding-bottom:14px"><h3>Balances, ${U.today().slice(0, 4)}</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th>Annual leave</th><th class="r">Remaining</th><th>Sick leave</th><th class="r">Remaining</th></tr></thead>
          <tbody>${activeEmployees().sort((a, b) => a.first.localeCompare(b.first)).map((e) => {
            const a = leaveUsed(e.id, 'Annual'), s = leaveUsed(e.id, 'Sick');
            return `<tr><td>${person(e)}</td>
              <td><div class="progress"><i style="width:${Math.min(100, (a / state.settings.annualDays) * 100)}%"></i></div></td><td class="r num">${state.settings.annualDays - a}</td>
              <td><div class="progress"><i style="width:${Math.min(100, (s / state.settings.sickDays) * 100)}%;background:var(--gold)"></i></div></td><td class="r num">${state.settings.sickDays - s}</td></tr>`;
          }).join('')}</tbody></table></div>
      </div>`;
  };
  function openLeaveModal(empId) {
    const T = U.today();
    const self = role() === 'employee';
    if (self) empId = me().id;
    openModal({
      title: 'Request time off', size: 'sm', submit: 'Submit request',
      body: `<div class="form-grid">
        ${self ? `<input type="hidden" name="empId" value="${empId}">` : `<div class="field full"><label for="l-emp">Employee</label><select class="select" id="l-emp" name="empId">${activeEmployees().map((e) => `<option value="${e.id}" ${e.id === empId ? 'selected' : ''}>${esc(fullName(e))}</option>`).join('')}</select></div>`}
        <div class="field full"><label for="l-type">Type</label><select class="select" id="l-type" name="type">${['Annual', 'Sick', 'Personal', 'Parental', 'Unpaid'].map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="l-from">From</label><input class="input" type="date" id="l-from" name="from" required value="${U.addDays(T, 7)}"></div>
        <div class="field"><label for="l-to">To</label><input class="input" type="date" id="l-to" name="to" required value="${U.addDays(T, 8)}"></div>
        <div class="field full"><label for="l-reason">Note</label><textarea class="textarea" id="l-reason" name="reason" placeholder="Optional"></textarea></div></div>`,
      onSubmit(d) {
        if (d.to < d.from) { toast('The end date must be on or after the start date'); return false; }
        const days = U.workdaysBetween(d.from, d.to);
        if (!days) { toast('Those dates fall on a weekend. Pick at least one weekday.'); return false; }
        state.leaves.push({ id: U.uid('l'), ...d, days, status: 'Pending', created: U.today() });
        ui.leaveFilter = 'Pending';
        commit(self ? 'Request sent to your manager' : 'Request submitted', `${fullName(emp(d.empId))} requested ${days} day${days > 1 ? 's' : ''} of ${d.type.toLowerCase()} leave`);
      },
    });
  }
  function decideLeave(id, approve) {
    const l = state.leaves.find((x) => x.id === id); if (!l) return;
    l.status = approve ? 'Approved' : 'Rejected';
    if (approve) {
      for (let d = l.from; d <= l.to; d = U.addDays(d, 1)) {
        if (U.isWeekend(d)) continue;
        state.attendance[d] = state.attendance[d] || {};
        state.attendance[d][l.empId] = { s: 'leave', in: '' };
      }
    }
    const n = fullName(emp(l.empId));
    commit(approve ? `Approved for ${n}` : `Declined for ${n}`, `${n}'s ${l.type.toLowerCase()} leave was ${approve ? 'approved' : 'declined'}`);
  }

  // ----- Payroll -----
  VIEWS.payroll = () => {
    const mk = ui.payMonth;
    const run = state.payroll[mk];
    const t = run ? payTotal(run) : null;
    const cur = U.monthKey(U.today());
    const eligible = activeEmployees().filter((e) => e.start <= U.monthEnd(mk));
    const projected = eligible.reduce((s, e) => s + U.payCalc(e.salary, 0, state.settings).net, 0);
    const pill = run ? (run.status === 'Paid' ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">Draft</span>') : '<span class="pill">Not run</span>';
    return `
      <div class="page-head"><div><div class="eyebrow">Payroll</div><h1>${U.fmtMonth(mk)}</h1><p class="sub">${run?.status === 'Paid' ? `Paid on ${U.fmtDate(run.paidOn)} to ${run.items.length} people.` : run ? 'Review bonuses, then approve to mark this run as paid.' : `${eligible.length} people are eligible. Estimated net pay is ${money(projected)}.`}</p></div>
        <div class="actions">
          <button class="btn btn-icon" data-act="pay-shift" data-v="-1" aria-label="Previous month">${icon('left')}</button>
          ${pill}
          <button class="btn btn-icon" data-act="pay-shift" data-v="1" aria-label="Next month" ${mk >= U.addMonths(cur, 1) ? 'disabled' : ''}>${icon('right')}</button>
          ${!run ? `<button class="btn btn-primary" data-act="pay-run">${icon('wallet')}Run payroll</button>` : ''}
          ${run?.status === 'Draft' ? `<button class="btn" data-act="pay-discard">Discard draft</button><button class="btn btn-primary" data-act="pay-approve">${icon('check')}Approve and pay</button>` : ''}
          ${run ? `<button class="btn" data-act="pay-export">${icon('download')}Export CSV</button>` : ''}
        </div></div>
      ${run ? `
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label">Gross pay</div><div class="kpi-value">${compactMoney(t.gross)}</div><div class="kpi-foot num">${money(t.gross)}</div></div>
        <div class="card kpi"><div class="kpi-label">Income tax</div><div class="kpi-value">${compactMoney(t.tax)}</div><div class="kpi-foot">${state.settings.taxRate}% withheld</div></div>
        <div class="card kpi"><div class="kpi-label">EPF, SOCSO & EIS</div><div class="kpi-value">${compactMoney(t.benefits)}</div><div class="kpi-foot">${state.settings.benefitsRate}% of gross</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Net pay</div><div class="kpi-value">${compactMoney(t.net)}</div><div class="kpi-foot num">${money(t.net)}</div></div>
      </div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="r hide-sm">Base</th><th class="r">Bonus</th><th class="r">Gross</th><th class="r hide-sm">PCB tax</th><th class="r hide-sm">EPF, SOCSO, EIS</th><th class="r">Net</th><th></th></tr></thead>
        <tbody>${run.items.map((it) => { const e = emp(it.empId); if (!e) return ''; return `<tr>
          <td>${person(e)}</td><td class="r num hide-sm">${money(it.base, 2)}</td>
          <td class="r num">${run.status === 'Draft' ? `<input class="input num" style="width:110px;text-align:right" type="number" min="0" step="100" data-bonus="${it.empId}" value="${it.bonus}" aria-label="Bonus for ${esc(fullName(e))}">` : money(it.bonus)}</td>
          <td class="r num">${money(it.gross, 2)}</td><td class="r num muted hide-sm">${money(it.tax, 2)}</td><td class="r num muted hide-sm">${money(it.benefits, 2)}</td>
          <td class="r num" style="font-weight:600">${money(it.net, 2)}</td>
          <td><div class="row-actions"><button class="btn btn-sm" data-act="payslip" data-id="${it.empId}">${icon('doc')}Payslip</button></div></td></tr>`; }).join('')}</tbody>
      </table></div></div>` : `
      <div class="card"><div class="empty" style="padding:48px 12px"><strong>No payroll for ${U.fmtMonth(mk)} yet</strong>Running payroll creates a draft from current salaries. You can add bonuses before approving it.<div style="margin-top:16px"><button class="btn btn-primary" data-act="pay-run">${icon('wallet')}Run payroll</button></div></div></div>`}`;
  };
  AFTER.payroll = () => {
    $$('[data-bonus]').forEach((inp) => inp.addEventListener('change', () => {
      const run = state.payroll[ui.payMonth];
      const it = run.items.find((i) => i.empId === inp.dataset.bonus);
      Object.assign(it, U.payCalc(emp(it.empId).salary, Math.max(0, Number(inp.value) || 0), state.settings));
      save(); render(); toast('Bonus updated');
    }));
  };
  function openPayslip(empId, month = ui.payMonth) {
    const run = state.payroll[month]; const it = run.items.find((i) => i.empId === empId); const e = emp(empId);
    const row = (k, v, strong) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);${strong ? 'font-weight:600;font-size:16px;border:0' : ''}"><span>${k}</span><span class="num">${v}</span></div>`;
    openModal({
      title: 'Payslip', size: 'sm', submit: null,
      body: `<div style="display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:10px">${LOGO_MARK}<div><div style="font-weight:600;letter-spacing:.24em">${esc(state.settings.company.toUpperCase())}</div><div class="faint" style="font-size:12px">${U.fmtMonth(month)}</div></div></div>${run.status === 'Paid' ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">Draft</span>'}</div>
        ${person(e, `${e.role} · ${dept(e.dept)?.name || ''}`)}
        <div>${row('Base salary', money(it.base, 2))}${row('Bonus', money(it.bonus, 2))}${row('Gross pay', money(it.gross, 2))}${row(`Income tax, PCB (${state.settings.taxRate}%)`, '−' + money(it.tax, 2))}${row(`EPF, SOCSO & EIS (${state.settings.benefitsRate}%)`, '−' + money(it.benefits, 2))}${row('Net pay', money(it.net, 2), true)}</div></div>`,
    });
  }

  // ----- Recruitment -----
  const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];
  VIEWS.recruitment = () => {
    const jf = ui.jobFilter;
    const cands = state.candidates.filter((c) => jf === 'all' || c.jobId === jf);
    const job = (id) => state.jobs.find((j) => j.id === id);
    const selected = jf !== 'all' ? job(jf) : null;
    return `
      <div class="page-head"><div><h1>Recruitment</h1><p class="sub">${state.jobs.length} open roles and ${state.candidates.filter((c) => c.stage !== 'Hired').length} active candidates. Drag a card to move it between stages.</p></div>
        <div class="actions"><button class="btn" data-act="add-job">${icon('briefcase')}New role</button><button class="btn btn-primary" data-act="add-cand">${icon('plus')}Add candidate</button></div></div>
      <div class="chips">
        <button class="chip ${jf === 'all' ? 'on' : ''}" data-act="job-filter" data-v="all">All roles <span class="n">${state.candidates.length}</span></button>
        ${state.jobs.map((j) => `<button class="chip ${jf === j.id ? 'on' : ''}" data-act="job-filter" data-v="${j.id}">${esc(j.title)} <span class="n">${state.candidates.filter((c) => c.jobId === j.id).length}</span></button>`).join('')}
      </div>
      ${selected ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div><h3 style="font-size:17px">${esc(selected.title)}</h3><div class="muted" style="margin-top:4px">${deptTag(selected.dept)} · ${esc(selected.location)} · ${esc(selected.type)} · Opened ${U.fmtDate(selected.opened)}</div></div><button class="btn btn-danger btn-sm" data-act="close-job" data-id="${selected.id}">Close role</button></div>` : ''}
      <div class="kanban">${STAGES.map((st, si) => {
        const list = cands.filter((c) => c.stage === st);
        return `<div class="kcol" data-stage="${st}"><div class="kcol-head"><span>${st}</span><span class="n">${list.length}</span></div>
          ${list.map((c) => `<div class="kcard" draggable="true" data-cand="${c.id}">
            <div class="person">${avatar(c.name, 'sm')}<div style="min-width:0"><div class="person-name">${esc(c.name)}</div><div class="person-sub">${esc(job(c.jobId)?.title || 'Role closed')}</div></div></div>
            <div class="kcard-foot">${stars(c.rating)}<span class="faint" style="font-size:12px">${U.fmtDate(c.applied, { month: 'short', day: 'numeric' })}</span></div>
            <div class="kcard-foot">
              <button class="btn btn-sm btn-icon btn-ghost" data-act="cand-move" data-id="${c.id}" data-v="-1" ${si === 0 ? 'disabled' : ''} aria-label="Move back">${icon('left')}</button>
              ${st === 'Hired' ? (c.converted ? '<span class="pill ok">Onboarded</span>' : `<button class="btn btn-sm btn-primary" data-act="cand-hire" data-id="${c.id}">${icon('userplus')}Onboard</button>`) : `<button class="btn btn-sm btn-ghost" data-act="cand-del" data-id="${c.id}" aria-label="Remove candidate">${icon('trash')}</button>`}
              <button class="btn btn-sm btn-icon btn-ghost" data-act="cand-move" data-id="${c.id}" data-v="1" ${si === STAGES.length - 1 ? 'disabled' : ''} aria-label="Move forward">${icon('right')}</button>
            </div></div>`).join('')}
          ${list.length ? '' : '<div class="empty" style="padding:16px 4px;font-size:12.5px">No candidates</div>'}
        </div>`;
      }).join('')}</div>`;
  };
  AFTER.recruitment = () => {
    let dragId = null;
    $$('.kcard').forEach((c) => {
      c.addEventListener('dragstart', (ev) => { dragId = c.dataset.cand; c.classList.add('dragging'); ev.dataTransfer.setData('text/plain', dragId); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    $$('.kcol').forEach((col) => {
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (ev) => {
        ev.preventDefault(); col.classList.remove('drop');
        const c = state.candidates.find((x) => x.id === (dragId || ev.dataTransfer.getData('text/plain')));
        if (c && c.stage !== col.dataset.stage) { c.stage = col.dataset.stage; commit(`${c.name} moved to ${c.stage}`, `${c.name} moved to ${c.stage}`); }
      });
    });
  };
  function openCandidateModal() {
    if (!state.jobs.length) { toast('Create a role first'); return; }
    openModal({
      title: 'Add candidate', size: 'sm', submit: 'Add candidate',
      body: `<div class="form-grid">
        <div class="field full"><label for="c-name">Full name</label><input class="input" id="c-name" name="name" required></div>
        <div class="field full"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email"></div>
        <div class="field"><label for="c-job">Role</label><select class="select" id="c-job" name="jobId">${state.jobs.map((j) => `<option value="${j.id}" ${ui.jobFilter === j.id ? 'selected' : ''}>${esc(j.title)}</option>`).join('')}</select></div>
        <div class="field"><label for="c-rating">Rating</label><select class="select" id="c-rating" name="rating">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n} star${n > 1 ? 's' : ''}</option>`).join('')}</select></div></div>`,
      onSubmit(d) { state.candidates.push({ id: U.uid('c'), ...d, rating: Number(d.rating), stage: 'Applied', applied: U.today() }); commit('Candidate added', `${d.name} applied for ${state.jobs.find((j) => j.id === d.jobId).title}`); },
    });
  }
  function openJobModal() {
    openModal({
      title: 'New role', size: 'sm', submit: 'Open role',
      body: `<div class="form-grid">
        <div class="field full"><label for="j-title">Job title</label><input class="input" id="j-title" name="title" required></div>
        <div class="field"><label for="j-dept">Department</label><select class="select" id="j-dept" name="dept">${state.departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="j-type">Type</label><select class="select" id="j-type" name="type">${['Full-time', 'Part-time', 'Contract', 'Intern'].map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div class="field full"><label for="j-loc">Location</label><input class="input" id="j-loc" name="location" placeholder="e.g. Remote, London · Hybrid" required></div></div>`,
      onSubmit(d) { const j = { id: U.uid('j'), ...d, opened: U.today() }; state.jobs.push(j); ui.jobFilter = j.id; commit('Role opened', `${d.title} role was opened`); },
    });
  }

  // ----- Performance -----
  VIEWS.performance = () => {
    const reviews = state.reviews.filter((r) => { const e = emp(r.empId); return e && e.status === 'Active' && (ui.perfDept === 'all' || e.dept === ui.perfDept); });
    const rated = reviews.filter((r) => r.rating);
    const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 0;
    const done = reviews.filter((r) => r.status === 'Completed').length;
    const prog = reviews.length ? Math.round(reviews.reduce((s, r) => s + r.progress, 0) / reviews.length) : 0;
    const pill = (s) => `<span class="pill ${({ Completed: 'ok', 'In progress': 'info', 'Not started': '' })[s]}">${s}</span>`;
    return `
      <div class="page-head"><div><div class="eyebrow">Review cycle</div><h1>Performance, ${esc(state.reviews[0]?.cycle || 'H2')}</h1><p class="sub">Goal progress and ratings for every active employee.</p></div>
        <div class="actions"><select class="select" id="perf-dept" aria-label="Department"><option value="all">All departments</option>${state.departments.map((d) => `<option value="${d.id}" ${ui.perfDept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div></div>
      <div class="grid g-3">
        <div class="card kpi"><div class="kpi-label">Average rating</div><div class="kpi-value">${avg ? avg.toFixed(1) : '—'}<span class="faint" style="font-size:18px"> / 5</span></div><div class="kpi-foot">${rated.length} people rated</div></div>
        <div class="card kpi"><div class="kpi-label">Reviews completed</div><div class="kpi-value">${done}<span class="faint" style="font-size:18px"> of ${reviews.length}</span></div><div class="progress" style="margin-top:6px"><i style="width:${reviews.length ? (done / reviews.length) * 100 : 0}%"></i></div></div>
        <div class="card kpi"><div class="kpi-label">Average goal progress</div><div class="kpi-value">${prog}%</div><div class="progress" style="margin-top:6px"><i style="width:${prog}%;background:var(--gold)"></i></div></div>
      </div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="hide-sm">Department</th><th>Goals</th><th>Rating</th><th>Status</th><th></th></tr></thead>
        <tbody>${reviews.map((r) => { const e = emp(r.empId); return `<tr>
          <td>${person(e)}</td><td class="hide-sm">${deptTag(e.dept)}</td>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="progress" style="flex:1"><i style="width:${r.progress}%"></i></div><span class="num muted" style="width:36px">${r.progress}%</span></div></td>
          <td>${stars(r.rating)}</td><td>${pill(r.status)}</td>
          <td><div class="row-actions"><button class="btn btn-sm" data-act="review" data-id="${r.id}">Review</button></div></td></tr>`; }).join('')}</tbody>
      </table></div></div>`;
  };
  AFTER.performance = () => { $('#perf-dept').addEventListener('change', (ev) => { ui.perfDept = ev.target.value; render(); }); };
  function openReviewModal(id) {
    const r = state.reviews.find((x) => x.id === id); const e = emp(r.empId);
    openModal({
      title: `Review ${e.first}`, size: 'sm', submit: 'Save review',
      body: `<div class="form-grid">
        <div class="field full">${person(e)}</div>
        <div class="field"><label for="r-rating">Rating</label><select class="select" id="r-rating" name="rating"><option value="0">Not rated</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${r.rating === n ? 'selected' : ''}>${n} — ${['Below expectations', 'Needs improvement', 'Meets expectations', 'Exceeds expectations', 'Outstanding'][n - 1]}</option>`).join('')}</select></div>
        <div class="field"><label for="r-status">Status</label><select class="select" id="r-status" name="status">${['Not started', 'In progress', 'Completed'].map((s) => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field full"><label for="r-progress">Goal progress: <output id="r-out">${r.progress}%</output></label><input id="r-progress" name="progress" type="range" min="0" max="100" step="5" value="${r.progress}" oninput="document.getElementById('r-out').textContent=this.value+'%'" style="accent-color:var(--brand)"></div>
        <div class="field full"><label for="r-notes">Manager notes</label><textarea class="textarea" id="r-notes" name="notes" placeholder="Strengths, growth areas, next steps">${esc(r.notes)}</textarea></div></div>`,
      onSubmit(d) { Object.assign(r, { rating: Number(d.rating), status: d.status, progress: Number(d.progress), notes: d.notes }); commit('Review saved', d.status === 'Completed' ? `${fullName(e)}'s review was completed` : null); },
    });
  }

  // ----- Settings -----
  VIEWS.settings = () => {
    const s = state.settings;
    if (role() !== 'admin') return `
      <div class="page-head"><div><h1>Settings</h1><p class="sub">Appearance and demo data for this browser.</p></div></div>
      <div class="card"><div class="card-head"><h3>Appearance</h3></div>
        <div class="settings-row"><div><div class="label">Theme</div><div class="desc">Follow the device or pick a theme.</div></div><div class="seg">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="settings-row"><div><div class="label">Brand kit</div><div class="desc">Allurus logo, colors and type.</div></div><a class="btn" href="brand.html">${icon('palette')}Open brand kit</a></div>
      </div>
      ${accountCard()}
      ${role() === 'super' ? `<div class="card"><div class="card-head"><h3>Data</h3></div>
        <div class="settings-row"><div><div class="label">Reset demo workspace</div><div class="desc">Data is stored in this browser only.</div></div><button class="btn btn-danger" data-act="ask-reset">Reset data</button></div>
        <div id="reset-confirm"></div></div>` : ''}`;
    const currencies = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'INR', 'PKR', 'CAD', 'AUD', 'SGD'];
    return `
      <div class="page-head"><div><h1>Settings</h1><p class="sub">Company details, pay rules and appearance. Changes apply right away.</p></div></div>
      <div class="grid g-2">
        <div class="card"><div class="card-head"><h3>Company</h3></div>
          <div class="settings-row"><div><div class="label">Company name</div><div class="desc">Shown in the sidebar and on payslips.</div></div><input class="input" id="s-company" value="${esc(s.company)}" style="width:220px"></div>
          <div class="settings-row"><div><div class="label">Head office city</div><div class="desc">Where your company appears on the Allurus map.</div></div><select class="select" id="s-office">${U.CITIES.map((c) => `<option value="${esc(c.name)}" ${s.office === c.name ? 'selected' : ''}>${esc(c.name)}, ${esc(c.country)}</option>`).join('')}</select></div>
          <div class="settings-row"><div><div class="label">Currency</div><div class="desc">Used for salaries and payroll.</div></div><select class="select" id="s-currency">${currencies.map((c) => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="settings-row"><div><div class="label">Appearance</div><div class="desc">Follow the device or pick a theme.</div></div><div class="seg">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        </div>
        <div class="card"><div class="card-head"><h3>Pay and leave rules</h3></div>
          <div class="settings-row"><div><div class="label">Income tax withholding</div><div class="desc">Percent of gross pay.</div></div><input class="input num" id="s-tax" type="number" min="0" max="60" step="0.5" value="${s.taxRate}" style="width:100px"></div>
          <div class="settings-row"><div><div class="label">Statutory contributions</div><div class="desc">EPF, SOCSO and EIS deducted from pay, as percent of gross.</div></div><input class="input num" id="s-benefits" type="number" min="0" max="30" step="0.5" value="${s.benefitsRate}" style="width:100px"></div>
          <div class="settings-row"><div><div class="label">Annual leave</div><div class="desc">Days per person per year.</div></div><input class="input num" id="s-annual" type="number" min="0" max="60" value="${s.annualDays}" style="width:100px"></div>
          <div class="settings-row"><div><div class="label">Sick leave</div><div class="desc">Days per person per year.</div></div><input class="input num" id="s-sick" type="number" min="0" max="60" value="${s.sickDays}" style="width:100px"></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Check-in location</h3><a class="hint" href="${mapsLink(s.checkin)}" target="_blank" rel="noopener">View on Google Maps</a></div>
        <p class="muted" style="margin-bottom:6px">Employees must be inside this zone and take a selfie to check in.</p>
        <div class="settings-row"><div><div class="label">Name</div><div class="desc">Shown to employees, for example “Allurus HQ”.</div></div><input class="input" id="z-label" value="${esc(s.checkin.label)}" style="width:240px"></div>
        <div class="settings-row"><div><div class="label">Coordinates</div><div class="desc">Paste from Google Maps, as 3.769833, 103.224556 or 3°46'11.4"N 103°13'28.4"E.</div></div>
          <div class="actions"><input class="input num" id="z-coords" value="${esc(U.fmtCoords(s.checkin))}" style="width:240px" aria-label="Check-in coordinates"><button class="btn" data-act="zone-here">${icon('pin')}Use my location</button></div></div>
        <div class="settings-row"><div><div class="label">Radius</div><div class="desc">How close employees must be, in meters. Default is 50 m.</div></div><input class="input num" id="z-radius" type="number" min="10" max="5000" step="5" value="${s.checkin.radius}" style="width:100px"></div>
        <div class="settings-row"><div><div class="label">Remote check-in</div><div class="desc">Lets employees check in from anywhere with a selfie. Marked as Remote.</div></div><div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="zone-remote" data-v="${v}" class="${(s.checkin.remote ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        ${[['deviceLock', 'One phone per person', 'Each person checks in only from their approved phone, and a phone checks in for one person. New phones need your approval.'],
           ['faceCheck', 'Face check', 'Compares each selfie with the person’s reference photo, on their phone. Asks for consent first.'],
           ['liveOnly', 'Live camera only', 'Blocks uploading a saved photo instead of taking a selfie.']].map(([k, label, desc]) => `<div class="settings-row"><div><div class="label">${label}</div><div class="desc">${desc}</div></div><div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="sec-toggle" data-id="${k}" data-v="${v}" class="${(s.checkin[k] !== false ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('')}
      </div>
      <div class="card"><div class="card-head"><h3>Brand</h3><a class="hint" href="brand.html">Open brand kit</a></div>
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">${LOGO_FULL}<div class="chips">${[['Allurus Teal', '#0F766E'], ['Champagne', '#D9B66F'], ['Obsidian', '#16181D'], ['Mist', '#F5F5F7']].map(([n, c]) => `<span class="chip" style="cursor:default"><i style="width:14px;height:14px;border-radius:50%;background:${c};border:1px solid var(--line-strong)"></i>${n}<span class="n">${c}</span></span>`).join('')}</div></div>
      </div>
      ${accountCard()}
      <div class="card"><div class="card-head"><h3>Data</h3></div>
        <div class="settings-row"><div><div class="label">Reset demo workspace</div><div class="desc">Data is stored in this browser only. Resetting replaces everything with the sample company.</div></div><button class="btn btn-danger" data-act="ask-reset">Reset data</button></div>
        <div id="reset-confirm"></div>
      </div>`;
  };
  AFTER.settings = () => {
    bindAccountCard();
    if (role() !== 'admin') return;
    const bind = (id, key, num) => $(id).addEventListener('change', (ev) => { state.settings[key] = num ? Math.max(0, Number(ev.target.value) || 0) : ev.target.value.trim() || state.settings[key]; commit('Settings saved'); });
    $('#z-label').addEventListener('change', (ev) => { state.settings.checkin.label = ev.target.value.trim() || state.settings.checkin.label; commit('Check-in location saved'); });
    $('#z-coords').addEventListener('change', (ev) => {
      const p = U.parseCoords(ev.target.value);
      if (!p) { toast('Those coordinates aren’t valid. Paste them from Google Maps, for example 3.769833, 103.224556.', 'error'); ev.target.value = U.fmtCoords(state.settings.checkin); return; }
      Object.assign(state.settings.checkin, p); commit('Check-in point saved');
    });
    $('#z-radius').addEventListener('change', (ev) => { state.settings.checkin.radius = Math.min(5000, Math.max(10, Math.round(Number(ev.target.value) || 50))); commit(`Radius set to ${state.settings.checkin.radius} m`); });
    bind('#s-company', 'company'); bind('#s-currency', 'currency'); bind('#s-office', 'office'); bind('#s-tax', 'taxRate', 1); bind('#s-benefits', 'benefitsRate', 1); bind('#s-annual', 'annualDays', 1); bind('#s-sick', 'sickDays', 1);
  };

  // ---------- Sign-in ----------
  function loginView() {
    return `<div class="login-inner">
      <div class="login-brand">${LOGO_MARK.replace('width="30" height="30"', 'width="56" height="56"')}</div>
      <h1>Sign in to Allurus</h1>
      <p class="sub">People operations for growing companies.</p>
      <form class="login-card" id="login-form" novalidate>
        <div class="field"><label for="login-email">Email</label><input class="input" id="login-email" name="email" type="email" autocomplete="username" placeholder="you@company.com" required></div>
        <div class="field"><label for="login-password">Password</label>
          <div class="pw-wrap"><input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required><button type="button" class="pw-toggle" data-act="toggle-pw" aria-label="Show password">Show</button></div></div>
        <p class="login-error" id="login-error" role="alert" hidden></p>
        <button class="btn btn-primary login-submit" type="submit">Sign in</button>
      </form>
      <div class="register-cta"><div><strong>New to Allurus?</strong><span class="muted"> Register your company and start a free trial.</span></div><button class="btn btn-primary" data-act="register">${icon('plus')}Register company</button></div>
      <p class="faint" style="font-size:12.5px">Demo mode. Your workspace is saved in this browser${cloud.db ? '; company sign-ups and check-ins are also shared with the Allurus team' : ''}. Version ${APP_VERSION}</p>
    </div>`;
  }
  function bindLogin() {
    const form = $('#login-form'), err = $('#login-error');
    setTimeout(() => $('#login-email')?.focus(), 30);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = form.email.value.trim().toLowerCase(), pw = form.password.value;
      if (!email || !pw) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
      const acct = state.accounts.find((a) => a.email === email);
      const ok = acct && acct.hash === await U.hashPassword(email, pw);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 500));
        btn.disabled = false; btn.textContent = 'Sign in';
        err.textContent = 'That email and password don’t match an Allurus account.'; err.hidden = false;
        form.password.value = ''; form.password.focus();
        return;
      }
      startSession(acct);
    });
  }
  function startSession(acct) {
    if (acct.tenantId && acct.tenantId !== state.session.tenantId && state.workspaces[acct.tenantId]) switchWorkspace(acct.tenantId);
    Object.assign(state.session, { account: acct.email, roles: acct.roles.slice(), role: acct.roles[0], empId: acct.empId });
    save();
    if (location.hash) location.hash = ''; else render();
    window.scrollTo(0, 0);
    toast(`Signed in as ${acct.email}`);
  }
  function accountCard() {
    const a = account();
    return `<div class="card"><div class="card-head"><h3>Your account</h3><span class="hint">${esc(a?.email || '')}</span></div>
      <form id="pw-form" class="form-grid">
        <div class="field"><label for="pw-current">Current password</label><input class="input" id="pw-current" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required><span class="field-hint">At least 8 characters.</span></div>
        <div class="field full" style="align-items:flex-start"><button class="btn btn-primary" type="submit">Change password</button></div>
      </form></div>`;
  }
  function bindAccountCard() {
    $('#pw-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const a = account(), f = ev.target;
      if (a.hash !== await U.hashPassword(a.email, f.current.value)) { toast('Your current password is not right', 'error'); f.current.focus(); return; }
      if (f.next.value.length < 8) { toast('Use at least 8 characters for the new password', 'error'); f.next.focus(); return; }
      a.hash = await U.hashPassword(a.email, f.next.value);
      save(); f.reset(); toast('Password changed');
    });
  }

  // ---------- Shared chart ----------
  function lineChart(labels, vals, fmt, label) {
    const W = 560, H = 220, L = 6, R = 6, top = 34, B = 24;
    const min = Math.min(...vals) * 0.9, max = Math.max(...vals) * 1.02;
    const x = (i) => L + ((W - L - R) * i) / (vals.length - 1);
    const y = (v) => top + (H - top - B) * (1 - (v - min) / (max - min || 1));
    const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const last = vals.length - 1;
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
    [0.33, 0.66].forEach((f) => { svg += `<line class="grid-line" x1="0" x2="${W}" y1="${top + (H - top - B) * f}" y2="${top + (H - top - B) * f}"/>`; });
    svg += `<line class="grid-line" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>`;
    svg += `<polygon class="area" points="${x(0)},${H - B} ${pts} ${x(last)},${H - B}"/><polyline class="line" points="${pts}"/>`;
    vals.forEach((v, i) => { svg += `<circle class="${i === last ? 'pt-end' : 'pt'}" cx="${x(i)}" cy="${y(v)}" r="${i === last ? 5.5 : 3}"><title>${esc(labels[i])}: ${fmt(v)}</title></circle>`; });
    labels.forEach((l, i) => { if (i % 2 === last % 2) svg += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === last ? 'end' : 'middle'}">${esc(l)}</text>`; });
    svg += `<text class="val" x="${x(last)}" y="${y(vals[last]) - 14}" text-anchor="end">${fmt(vals[last])}</text>`;
    return svg + '</svg>';
  }

  // ---------- Super Admin ----------
  const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const plan = (id) => state.platform.plans.find((p) => p.id === id);
  const paying = (t) => t.status === 'Active' || t.status === 'Past due';
  const tenantMRR = (t) => paying(t) ? plan(t.plan).price * t.seats : 0;
  const tenantPill = (s) => `<span class="pill ${({ Active: 'ok', Trial: 'info', 'Past due': 'warn', Suspended: 'bad' })[s]}">${s}</span>`;
  const invoicePill = (s) => `<span class="pill ${({ Paid: 'ok', Open: 'info', Overdue: 'bad' })[s]}">${s}</span>`;
  const tenantRow = (t, sub) => `<div class="person"><span class="avatar" style="border-radius:10px;background:hsl(${hue(t.name)} 32% 42%)">${esc(t.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span><div style="min-width:0"><div class="person-name">${esc(t.name)}</div><div class="person-sub">${esc(sub ?? t.industry)}</div></div></div>`;

  VIEWS.platform = () => {
    const P = state.platform, T = U.today();
    const mrr = P.tenants.reduce((s, t) => s + tenantMRR(t), 0);
    const prev = P.mrr[P.mrr.length - 2]?.value || mrr;
    const growth = prev ? ((mrr - prev) / prev) * 100 : 0;
    const payingN = P.tenants.filter(paying).length;
    const seats = P.tenants.filter(paying).reduce((s, t) => s + t.seats, 0);
    const trials = P.tenants.filter((t) => t.status === 'Trial');
    const overdue = P.invoices.filter((i) => i.status === 'Overdue');
    const attention = [
      ...P.tenants.filter((t) => t.status === 'Past due').map((t) => ({ t, text: `Payment overdue · ${usd(overdue.filter((i) => i.tenantId === t.id).reduce((s, i) => s + i.amount, 0))}`, pill: 'warn', label: 'Past due' })),
      ...trials.map((t) => { const left = Math.max(0, 14 - Math.round((U.parse(T) - U.parse(t.joined)) / 864e5)); return { t, text: `Trial ends in ${left} day${left === 1 ? '' : 's'} · ${t.seats} seats`, pill: 'info', label: 'Trial' }; }),
      ...P.tenants.filter((t) => t.status === 'Suspended').map((t) => ({ t, text: `Suspended · last active ${U.fmtDate(t.lastActive, { month: 'short', day: 'numeric' })}`, pill: 'bad', label: 'Suspended' })),
    ];
    const byPlan = P.plans.map((p) => ({ p, n: P.tenants.filter((t) => t.plan === p.id && paying(t)).length, m: P.tenants.filter((t) => t.plan === p.id).reduce((s, t) => s + tenantMRR(t), 0) }));
    const maxM = Math.max(1, ...byPlan.map((b) => b.m));
    const planColor = { starter: 'var(--gold)', growth: 'var(--brand)', enterprise: 'var(--info)' };
    return `
      <div class="page-head"><div><div class="eyebrow">${U.fmtDate(T, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>Platform overview</h1><p class="sub">${P.tenants.length} companies use Allurus. ${attention.length ? `${attention.length} accounts need a look.` : 'Every account is healthy.'}</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="add-tenant">${icon('plus')}Add company</button></div></div>
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Monthly recurring revenue</div><div class="kpi-value">${usd(mrr)}</div><div class="kpi-foot"><span style="color:${growth >= 0 ? 'var(--ok)' : 'var(--bad)'}">${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth).toFixed(1)}%</span> vs last month</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Paying companies</div><div class="kpi-value">${payingN}</div><div class="kpi-foot">ARR ${usd(mrr * 12)}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>Seats billed</div><div class="kpi-value">${seats.toLocaleString()}</div><div class="kpi-foot">${usd(seats ? mrr / seats : 0)} average per seat</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>In trial</div><div class="kpi-value">${trials.length}</div><div class="kpi-foot">${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}</div></div>
      </div>
      <div class="grid g-main">
        <div class="card"><div class="card-head"><h3>MRR, last 12 months</h3><span class="hint">USD</span></div>${lineChart(P.mrr.map((m) => U.fmtMonth(m.month, { month: 'short' })), P.mrr.map((m) => m.value), (v) => usd(v), 'Monthly recurring revenue')}</div>
        <div class="card"><div class="card-head"><h3>Needs attention</h3><a class="hint" href="#companies">All companies</a></div>
          ${attention.length ? `<div class="list">${attention.slice(0, 5).map((a) => `<div class="list-item" style="cursor:pointer" data-act="tenant-view" data-id="${a.t.id}"><div class="grow">${tenantRow(a.t, a.text)}</div><span class="pill ${a.pill}">${a.label}</span></div>`).join('')}</div>` : '<div class="empty"><strong>All healthy</strong>No overdue, trial or suspended accounts.</div>'}</div>
      </div>
      <div class="card"><div class="card-head"><h3>Where customers are</h3><div class="legend"><span><i style="background:var(--brand)"></i>Active</span><span><i style="background:var(--info)"></i>Trial</span><span><i style="background:var(--warn)"></i>Past due</span><span><i style="background:var(--bad)"></i>Suspended</span></div></div>
        <div id="tenant-map" class="map-box" role="img" aria-label="World map of customer head offices"></div>
        <div class="chips" style="margin-top:14px">${Object.entries(P.tenants.reduce((a, t) => { a[t.country] = (a[t.country] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="chip" style="cursor:default">${esc(c)} <span class="n">${n}</span></span>`).join('')}</div>
      </div>
      ${cloud.on && cloud.owner ? `<div class="card"><div class="card-head"><h3>Live from your shared link</h3><span class="hint">${cloud.db ? 'Updates in real time' : 'Shared data is off for this view'}</span></div>
        ${cloud.checkins.length || cloud.registrations.length ? `<div class="list">${[...cloud.registrations.map((r) => ({ at: r.joined, text: `<strong>${esc(r.company)}</strong> registered · ${esc(r.city)} · ${r.seats} seats`, pill: '<span class="pill info">Sign-up</span>' })), ...cloud.checkins.map((c) => ({ at: c.time, text: `<strong>${esc(c.employee)}</strong> at ${esc(c.company)} checked in ${c.mode === 'remote' ? 'remotely ' : ''}· ${esc(c.label)}${c.source === 'gps' ? '' : ' (approx.)'}`, pill: '<span class="pill ok">Check-in</span>' }))].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map((x) => `<div class="list-item"><div class="grow">${x.text}</div>${x.pill}</div>`).join('')}</div>` : '<div class="empty"><strong>Nothing yet</strong>When a client registers a company or an employee checks in through your link, it shows up here.</div>'}</div>` : ''}
      <div class="grid g-2">
        <div class="card"><div class="card-head"><h3>Revenue by plan</h3></div>
          ${byPlan.map((b) => `<div class="hbar" style="grid-template-columns:96px minmax(0,1fr) 84px"><span>${b.p.name} <span class="faint">${b.n}</span></span><div class="hbar-track"><i style="width:${(b.m / maxM) * 100}%;background:${planColor[b.p.id]}"></i></div><span class="num r">${usd(b.m)}</span></div>`).join('')}</div>
        <div class="card"><div class="card-head"><h3>Newest companies</h3></div>
          <div class="list">${[...P.tenants].sort((a, b) => b.joined.localeCompare(a.joined)).slice(0, 4).map((t) => `<div class="list-item" style="cursor:pointer" data-act="tenant-view" data-id="${t.id}"><div class="grow">${tenantRow(t, `${plan(t.plan).name} · ${t.seats} seats · ${t.country}`)}</div><span class="faint">${U.fmtDate(t.joined, { month: 'short', day: 'numeric' })}</span></div>`).join('')}</div></div>
      </div>`;
  };

  AFTER.platform = () => drawMap();

  VIEWS.companies = () => {
    const P = state.platform, q = ui.tenantQuery.toLowerCase();
    const list = P.tenants.filter((t) => (ui.tenantStatus === 'all' || t.status === ui.tenantStatus) && (!q || `${t.name} ${t.industry} ${t.country} ${t.admin}`.toLowerCase().includes(q)));
    return `
      <div class="page-head"><div><h1>Companies</h1><p class="sub">Every workspace subscribed to Allurus, with plan, seats and billing status.</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="add-tenant">${icon('plus')}Add company</button></div></div>
      <div class="card card-flush">
        <div class="toolbar">
          <input class="input" id="tenant-q" type="search" placeholder="Search companies, industries or countries" value="${esc(ui.tenantQuery)}" style="flex:1;min-width:200px">
          <div class="seg">${['all', 'Active', 'Trial', 'Past due', 'Suspended'].map((s) => `<button data-act="tenant-filter" data-v="${s}" class="${ui.tenantStatus === s ? 'on' : ''}">${s === 'all' ? 'All' : s}</button>`).join('')}</div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Company</th><th>Plan</th><th class="r">Seats</th><th class="r">MRR</th><th>Status</th><th class="hide-sm">Head office</th><th class="hide-sm">Customer since</th></tr></thead>
          <tbody>${list.map((t) => `<tr class="clickable" data-act="tenant-view" data-id="${t.id}"><td>${tenantRow(t)}</td><td>${plan(t.plan).name}</td><td class="r num">${t.seats}</td><td class="r num">${usd(tenantMRR(t))}</td><td>${tenantPill(t.status)}</td><td class="hide-sm muted">${esc(t.city)}, ${esc(t.country)}</td><td class="hide-sm muted num">${U.fmtDate(t.joined)}${t.viaLink ? ' <span class="pill gold">Via link</span>' : ''}</td></tr>`).join('')}</tbody>
        </table>${list.length ? '' : '<div class="empty"><strong>No companies match</strong>Try another search or status.</div>'}</div>
      </div>`;
  };
  AFTER.companies = () => {
    const q = $('#tenant-q');
    q.addEventListener('input', () => { ui.tenantQuery = q.value; const pos = q.selectionStart; render(); const n = $('#tenant-q'); n.focus(); n.setSelectionRange(pos, pos); });
  };

  function openTenant(id) {
    const t = state.platform.tenants.find((x) => x.id === id); if (!t) return;
    const inv = state.platform.invoices.filter((i) => i.tenantId === id).sort((a, b) => b.month.localeCompare(a.month));
    openDrawer(`
      <div class="drawer-hero">
        <div style="display:flex;justify-content:space-between;align-items:flex-start"><span class="avatar lg" style="border-radius:18px;background:hsl(${hue(t.name)} 32% 42%)">${esc(t.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span><button class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close">${icon('x')}</button></div>
        <div><h2 style="font-size:24px;letter-spacing:-0.02em">${esc(t.name)}</h2><div class="muted" style="margin-top:2px">${esc(t.industry)} · ${esc(t.country)}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${tenantPill(t.status)}<span class="pill brand">${plan(t.plan).name}</span></div>
        <div class="actions">
          ${t.hasWorkspace ? `<button class="btn btn-sm btn-primary" data-act="tenant-open" data-id="${t.id}">${icon('right')}Open workspace</button>` : ''}
          ${t.status === 'Suspended' ? `<button class="btn btn-sm btn-ok" data-act="tenant-status" data-id="${t.id}" data-v="Active">Reactivate</button>` : `<button class="btn btn-sm btn-danger" data-act="tenant-status" data-id="${t.id}" data-v="Suspended">Suspend</button>`}
          ${t.status === 'Trial' ? `<button class="btn btn-sm" data-act="tenant-status" data-id="${t.id}" data-v="Active">Convert to paid</button>` : ''}
        </div>
      </div>
      <div class="drawer-section"><h4>Subscription</h4>
        <div class="form-grid">
          <div class="field"><label for="t-plan">Plan</label><select class="select" id="t-plan">${state.platform.plans.map((p) => `<option value="${p.id}" ${p.id === t.plan ? 'selected' : ''}>${p.name} · ${usd(p.price)}/seat</option>`).join('')}</select></div>
          <div class="field"><label for="t-seats">Seats</label><input class="input num" id="t-seats" type="number" min="1" value="${t.seats}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="muted">Current MRR <strong class="num" style="color:var(--fg)">${usd(tenantMRR(t))}</strong></span><button class="btn btn-sm btn-primary" data-act="tenant-save" data-id="${t.id}">Save changes</button></div>
      </div>
      <div class="drawer-section"><h4>Account</h4><dl class="kv"><dt>Head office</dt><dd>${esc(t.city)}, ${esc(t.country)}</dd><dt>Admin email</dt><dd>${esc(t.admin)}</dd><dt>Customer since</dt><dd>${U.fmtDate(t.joined)}</dd><dt>Last active</dt><dd>${U.fmtDate(t.lastActive)}</dd><dt>Seat limit</dt><dd>${plan(t.plan).maxSeats || 'Unlimited'}</dd></dl></div>
      <div class="drawer-section"><h4>Invoices</h4>
        ${inv.length ? `<div class="list">${inv.map((i) => `<div class="list-item"><div class="grow"><div class="person-name num">${i.id}</div><div class="person-sub">${U.fmtMonth(i.month)}</div></div><span class="num">${usd(i.amount)}</span>${invoicePill(i.status)}</div>`).join('')}</div>` : '<div class="faint">No invoices yet. Trials are not billed.</div>'}
      </div>`);
  }

  VIEWS.billing = () => {
    const P = state.platform;
    const inv = [...P.invoices].sort((a, b) => b.month.localeCompare(a.month) || a.status.localeCompare(b.status));
    const sum = (s) => inv.filter((i) => i.status === s).reduce((a, i) => a + i.amount, 0);
    return `
      <div class="page-head"><div><h1>Plans & billing</h1><p class="sub">Per-seat pricing, billed monthly. Price changes apply to every company on that plan.</p></div></div>
      <div class="grid g-3">${P.plans.map((p) => { const ts = P.tenants.filter((t) => t.plan === p.id); return `
        <div class="card dcard">
          <div class="dcard-top"><h3>${p.name}</h3><button class="btn btn-sm btn-icon btn-ghost" data-act="edit-plan" data-id="${p.id}" aria-label="Edit ${p.name}">${icon('edit')}</button></div>
          <div><span class="kpi-value">${usd(p.price)}</span> <span class="muted">per seat / month</span></div>
          <p class="muted">${esc(p.features)}</p>
          <div class="stats"><div><div class="stat-v">${ts.length}</div><div class="stat-l">Companies</div></div><div><div class="stat-v">${p.maxSeats || '∞'}</div><div class="stat-l">Seat limit</div></div><div><div class="stat-v">${usd(ts.reduce((s, t) => s + tenantMRR(t), 0))}</div><div class="stat-l">MRR</div></div></div>
        </div>`; }).join('')}</div>
      <div class="grid g-3">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Collected</div><div class="kpi-value">${usd(sum('Paid'))}</div><div class="kpi-foot">Last 3 months</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Open</div><div class="kpi-value">${usd(sum('Open'))}</div><div class="kpi-foot">Due this month</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Overdue</div><div class="kpi-value">${usd(sum('Overdue'))}</div><div class="kpi-foot">${inv.filter((i) => i.status === 'Overdue').length} invoices</div></div>
      </div>
      <div class="card card-flush"><div class="card-head" style="padding-bottom:14px"><h3>Invoices</h3></div><div class="table-wrap"><table>
        <thead><tr><th>Invoice</th><th>Company</th><th class="hide-sm">Period</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>${inv.map((i) => { const t = P.tenants.find((x) => x.id === i.tenantId); return `<tr><td class="num">${i.id}</td><td>${esc(t?.name)}</td><td class="hide-sm muted">${U.fmtMonth(i.month)}</td><td class="r num">${usd(i.amount)}</td><td>${invoicePill(i.status)}</td>
          <td><div class="row-actions">${i.status !== 'Paid' ? `<button class="btn btn-sm btn-ok" data-act="invoice-paid" data-id="${i.id}">Mark paid</button>` : ''}</div></td></tr>`; }).join('')}</tbody>
      </table></div></div>`;
  };

  // ---------- Employee self-service ----------
  const nowHM = () => { const n = new Date(); return `${U.pad(n.getHours())}:${U.pad(n.getMinutes())}`; };
  const hoursBetween = (a, b) => { if (!a || !b) return 0; const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60); };
  const myRecord = (day) => state.attendance[day]?.[me().id];
  const myRuns = () => Object.keys(state.payroll).filter((k) => state.payroll[k].status === 'Paid' && state.payroll[k].items.some((i) => i.empId === me().id)).sort().reverse();

  VIEWS.home = () => {
    const e = me(), T = U.today();
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const rec = myRecord(T);
    const aLeft = state.settings.annualDays - leaveUsed(e.id, 'Annual');
    const sLeft = state.settings.sickDays - leaveUsed(e.id, 'Sick');
    const monthDays = Object.keys(state.attendance).filter((d) => d.startsWith(U.monthKey(T)) && !U.isWeekend(d));
    const inDays = monthDays.filter((d) => ['present', 'remote'].includes(state.attendance[d][e.id]?.s)).length;
    const runs = myRuns();
    const lastPay = runs[0] ? state.payroll[runs[0]].items.find((i) => i.empId === e.id) : null;
    const myLeaves = state.leaves.filter((l) => l.empId === e.id && l.to >= T).sort((a, b) => a.from.localeCompare(b.from));
    const out = activeEmployees().filter((x) => x.dept === e.dept && x.id !== e.id && onLeaveOn(x.id, T));
    const review = state.reviews.find((r) => r.empId === e.id);
    let clock;
    if (rec?.s === 'leave') clock = `<span class="pill gold">On leave today</span>`;
    else if (!rec || !rec.in) clock = `<div class="actions"><button class="btn btn-primary" data-act="check-in" data-v="present">${icon('camera')}Check in with selfie</button>${zone().remote ? '<button class="btn" data-act="check-in" data-v="remote">Work remotely</button>' : ''}</div>`;
    else if (!rec.out) clock = `<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><div class="actions">${selfieThumb(me().id, T, rec)}<span class="pill ok">${rec.s === 'remote' ? 'Remote' : 'In office'} since ${rec.lastIn || rec.in}</span><button class="btn btn-primary" data-act="check-out">Check out</button></div>${rec.loc ? `<span class="faint" style="font-size:12.5px;text-align:right">${esc(locText(rec.loc))}</span>` : ''}</div>`;
    else clock = `<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><div class="actions">${selfieThumb(me().id, T, rec)}<span class="pill brand">Checked out at ${rec.out} · ${hoursBetween(rec.in, rec.out).toFixed(1)} h today</span><button class="btn btn-primary" data-act="check-in" data-v="present">${icon('camera')}Check in again</button>${zone().remote ? '<button class="btn" data-act="check-in" data-v="remote">Work remotely</button>' : ''}</div><span class="faint" style="font-size:12.5px;text-align:right">Checked out by mistake? Check in again. Your hours still count from ${rec.in}.</span></div>`;
    return `
      <div class="page-head"><div><div class="eyebrow">${U.fmtDate(T, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>${greet}, ${esc(e.first)}.</h1><p class="sub">${esc(e.role)} · ${esc(dept(e.dept)?.name || '')} · ${esc(state.settings.company)}</p></div>
        <div class="actions"><button class="btn" data-act="new-leave">${icon('calendar')}Request time off</button></div></div>
      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap">
        <div><div class="kpi-label">Time clock</div><div class="kpi-value" id="live-clock" style="font-size:44px">${nowHM()}</div><div class="kpi-foot">${U.isWeekend(T) ? 'It is the weekend. Check-ins still count. ' : ''}Check in within ${zone().radius} m of ${esc(zone().label)} and take a selfie.${phoneStatus(me()) ? ` ${phoneStatus(me())}` : ''}</div></div>
        ${clock}
      </div>
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Annual leave left</div><div class="kpi-value">${aLeft}</div><div class="kpi-foot">of ${state.settings.annualDays} days</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>Sick leave left</div><div class="kpi-value">${sLeft}</div><div class="kpi-foot">of ${state.settings.sickDays} days</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Days worked</div><div class="kpi-value">${inDays}<span class="faint" style="font-size:18px"> / ${monthDays.length}</span></div><div class="kpi-foot">${U.fmtMonth(U.monthKey(T), { month: 'long' })} so far</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Last net pay</div><div class="kpi-value">${lastPay ? compactMoney(lastPay.net) : '—'}</div><div class="kpi-foot">${runs[0] ? U.fmtMonth(runs[0]) : 'No payslips yet'}</div></div>
      </div>
      <div class="grid g-3">
        <div class="card"><div class="card-head"><h3>My time off</h3><a class="hint" href="#my-leave">All requests</a></div>
          ${myLeaves.length ? `<div class="list">${myLeaves.slice(0, 4).map((l) => `<div class="list-item"><div class="grow"><div class="person-name">${l.type} · ${l.days} day${l.days > 1 ? 's' : ''}</div><div class="person-sub">${U.fmtDate(l.from, { month: 'short', day: 'numeric' })}${l.to !== l.from ? ' – ' + U.fmtDate(l.to, { month: 'short', day: 'numeric' }) : ''}</div></div>${leavePill(l.status)}</div>`).join('')}</div>` : '<div class="empty"><strong>Nothing booked</strong>Plan a break with Request time off.</div>'}</div>
        <div class="card"><div class="card-head"><h3>My goals</h3><a class="hint" href="#my-profile">Update</a></div>
          ${review ? `<div class="kpi"><div class="kpi-value">${review.progress}%</div><div class="progress"><i style="width:${review.progress}%"></i></div><div class="kpi-foot" style="margin-top:6px">${esc(review.cycle)} · ${review.status}</div><div style="margin-top:6px">${stars(review.rating)}</div></div>` : '<div class="empty">No review cycle yet.</div>'}</div>
        <div class="card"><div class="card-head"><h3>Team</h3><span class="hint">${esc(dept(e.dept)?.name || '')}</span></div>
          <div class="kpi-foot" style="margin-bottom:10px">${out.length ? `Out today: ${esc(out.map((x) => x.first).join(', '))}` : 'Everyone on your team is in today.'}</div>
          ${upcomingList()}</div>
      </div>`;
  };
  AFTER.home = () => {
    clearInterval(clockTimer);
    clockTimer = setInterval(() => { const c = $('#live-clock'); if (c) c.textContent = nowHM(); else clearInterval(clockTimer); }, 5000);
  };

  VIEWS['my-time'] = () => {
    const e = me(), T = U.today();
    const days = []; let d = T;
    while (days.length < 22) { if (!U.isWeekend(d) && d >= e.start) days.push(d); d = U.addDays(d, -1); if (d < e.start) break; }
    const c = { present: 0, remote: 0, absent: 0, leave: 0 }; let hours = 0;
    days.forEach((x) => { const r = myRecord(x); if (r) { c[r.s]++; hours += r.out ? hoursBetween(r.in, r.out) : (r.in ? 8 : 0); } });
    const pill = { present: '<span class="pill ok">In office</span>', remote: '<span class="pill info">Remote</span>', absent: '<span class="pill bad">Absent</span>', leave: '<span class="pill gold">Leave</span>' };
    return `
      <div class="page-head"><div><h1>My attendance</h1><p class="sub">Your last ${days.length} workdays. Days without a check-out count as 8 hours.</p></div>
        <div class="actions"><a class="btn btn-primary" href="#home">${icon('clock')}Open time clock</a></div></div>
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label">In office</div><div class="kpi-value">${c.present}</div></div>
        <div class="card kpi"><div class="kpi-label">Remote</div><div class="kpi-value">${c.remote}</div></div>
        <div class="card kpi"><div class="kpi-label">Leave or absent</div><div class="kpi-value">${c.leave + c.absent}</div></div>
        <div class="card kpi"><div class="kpi-label">Hours logged</div><div class="kpi-value">${Math.round(hours)}</div></div>
      </div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th class="hide-sm">Location</th><th class="r">Hours</th></tr></thead>
        <tbody>${days.map((x) => { const r = myRecord(x); return `<tr><td class="num">${U.fmtDate(x, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${r ? pill[r.s] : '<span class="pill">Not marked</span>'}</td><td class="num muted">${r?.in || '—'}</td><td class="num muted">${r?.out || '—'}</td><td class="hide-sm muted" style="font-size:12.5px"><div class="loc-cell">${selfieThumb(me().id, x, r)}<span>${r?.loc ? esc(locText(r.loc)) : '—'}</span></div></td><td class="r num">${r?.in ? (r.out ? hoursBetween(r.in, r.out) : 8).toFixed(1) : '—'}</td></tr>`; }).join('')}</tbody>
      </table></div></div>`;
  };

  VIEWS['my-leave'] = () => {
    const e = me();
    const list = state.leaves.filter((l) => l.empId === e.id).sort((a, b) => b.from.localeCompare(a.from));
    const aU = leaveUsed(e.id, 'Annual'), sU = leaveUsed(e.id, 'Sick');
    return `
      <div class="page-head"><div><h1>My time off</h1><p class="sub">Requests go to your manager${emp(e.manager) ? `, ${esc(fullName(emp(e.manager)))}` : ''}, for approval.</p></div>
        <div class="actions"><button class="btn btn-primary" data-act="new-leave">${icon('plus')}Request time off</button></div></div>
      <div class="grid g-2">
        <div class="card kpi"><div class="kpi-label">Annual leave</div><div class="kpi-value">${state.settings.annualDays - aU}<span class="faint" style="font-size:18px"> days left</span></div><div class="progress" style="margin-top:6px"><i style="width:${Math.min(100, (aU / state.settings.annualDays) * 100)}%"></i></div><div class="kpi-foot">${aU} used this year</div></div>
        <div class="card kpi"><div class="kpi-label">Sick leave</div><div class="kpi-value">${state.settings.sickDays - sU}<span class="faint" style="font-size:18px"> days left</span></div><div class="progress" style="margin-top:6px"><i style="width:${Math.min(100, (sU / state.settings.sickDays) * 100)}%;background:var(--gold)"></i></div><div class="kpi-foot">${sU} used this year</div></div>
      </div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>Dates</th><th class="r">Days</th><th class="hide-sm">Note</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map((l) => `<tr><td>${l.type}</td><td class="num">${U.fmtDate(l.from, { month: 'short', day: 'numeric' })}${l.to !== l.from ? ' – ' + U.fmtDate(l.to, { month: 'short', day: 'numeric' }) : ''}</td><td class="r num">${l.days}</td><td class="hide-sm muted">${esc(l.reason || '—')}</td><td>${leavePill(l.status)}</td>
          <td><div class="row-actions">${l.status === 'Pending' ? `<button class="btn btn-sm btn-ghost" data-act="del-leave" data-id="${l.id}">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody>
      </table>${list.length ? '' : '<div class="empty"><strong>No requests yet</strong>Your time-off history will show here.</div>'}</div></div>`;
  };

  VIEWS['my-pay'] = () => {
    const e = me(), runs = myRuns();
    const items = runs.map((m) => ({ m, it: state.payroll[m].items.find((i) => i.empId === e.id), run: state.payroll[m] }));
    const ytd = items.filter((x) => x.m.startsWith(U.today().slice(0, 4))).reduce((a, x) => ({ gross: a.gross + x.it.gross, net: a.net + x.it.net, tax: a.tax + x.it.tax }), { gross: 0, net: 0, tax: 0 });
    return `
      <div class="page-head"><div><h1>Payslips</h1><p class="sub">Annual salary ${money(e.salary)}. Payslips appear here once payroll is paid.</p></div></div>
      <div class="grid g-3">
        <div class="card kpi"><div class="kpi-label">Gross this year</div><div class="kpi-value">${compactMoney(ytd.gross)}</div><div class="kpi-foot num">${money(ytd.gross)}</div></div>
        <div class="card kpi"><div class="kpi-label">Tax this year</div><div class="kpi-value">${compactMoney(ytd.tax)}</div><div class="kpi-foot num">${money(ytd.tax)}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Net this year</div><div class="kpi-value">${compactMoney(ytd.net)}</div><div class="kpi-foot num">${money(ytd.net)}</div></div>
      </div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Period</th><th class="hide-sm">Paid on</th><th class="r">Gross</th><th class="r hide-sm">Deductions</th><th class="r">Net</th><th></th></tr></thead>
        <tbody>${items.map(({ m, it, run }) => `<tr class="clickable" data-act="my-payslip" data-id="${m}"><td>${U.fmtMonth(m)}</td><td class="hide-sm muted num">${U.fmtDate(run.paidOn)}</td><td class="r num">${money(it.gross, 2)}</td><td class="r num muted hide-sm">−${money(it.tax + it.benefits, 2)}</td><td class="r num" style="font-weight:600">${money(it.net, 2)}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="my-payslip" data-id="${m}">${icon('doc')}View</button></div></td></tr>`).join('')}</tbody>
      </table>${items.length ? '' : '<div class="empty"><strong>No payslips yet</strong>Your first payslip appears after payroll runs.</div>'}</div></div>`;
  };

  VIEWS['my-profile'] = () => {
    const e = me(), r = state.reviews.find((x) => x.empId === e.id), mgr = emp(e.manager);
    return `
      <div class="page-head"><div><h1>Profile & goals</h1><p class="sub">Keep your contact details current and track progress on your goals.</p></div></div>
      <div class="grid g-2">
        <div class="card">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">${avatar(fullName(e), 'lg')}<div><h2 style="font-size:22px">${esc(fullName(e))}</h2><div class="muted">${esc(e.role)}</div><div style="margin-top:6px">${deptTag(e.dept)}</div></div></div>
          <dl class="kv" style="margin:0 0 18px"><dt>Email</dt><dd>${esc(e.email)}</dd><dt>Manager</dt><dd>${mgr ? esc(fullName(mgr)) : '—'}</dd><dt>Start date</dt><dd>${U.fmtDate(e.start)}</dd><dt>Type</dt><dd>${esc(e.type)}</dd></dl>
          <form id="profile-form" class="form-grid">
            <div class="field"><label for="p-phone">Phone</label><input class="input" id="p-phone" name="phone" value="${esc(e.phone)}"></div>
            <div class="field"><label for="p-location">Location</label><input class="input" id="p-location" name="location" value="${esc(e.location)}"></div>
            <div class="field full" style="align-items:flex-start"><button class="btn btn-primary" type="submit">Save details</button></div>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h3>${esc(r?.cycle || 'Review')}</h3>${r ? `<span class="pill ${({ Completed: 'ok', 'In progress': 'info', 'Not started': '' })[r.status]}">${r.status}</span>` : ''}</div>
          ${r ? `<form id="goal-form" style="display:flex;flex-direction:column;gap:16px">
            <div class="field"><label for="g-progress">My goal progress: <output id="g-out">${r.progress}%</output></label><input id="g-progress" name="progress" type="range" min="0" max="100" step="5" value="${r.progress}" style="accent-color:var(--brand)" oninput="document.getElementById('g-out').textContent=this.value+'%'"></div>
            <div><div class="field-hint" style="margin-bottom:4px">Manager rating</div>${stars(r.rating)}</div>
            <div><div class="field-hint" style="margin-bottom:4px">Manager notes</div><p>${esc(r.notes) || '<span class="faint">No notes yet.</span>'}</p></div>
            <div><button class="btn btn-primary" type="submit">Update progress</button></div></form>` : '<div class="empty">No review yet.</div>'}
        </div>
      </div>`;
  };
  AFTER['my-profile'] = () => {
    $('#profile-form').addEventListener('submit', (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); Object.assign(me(), d); commit('Details saved'); });
    $('#goal-form')?.addEventListener('submit', (ev) => {
      ev.preventDefault(); const r = state.reviews.find((x) => x.empId === me().id);
      r.progress = Number(new FormData(ev.target).get('progress'));
      if (r.status === 'Not started' && r.progress > 0) r.status = 'In progress';
      commit('Progress updated', `${fullName(me())} updated goal progress to ${r.progress}%`);
    });
  };

  VIEWS.directory = () => {
    const q = ui.empQuery.toLowerCase();
    const list = activeEmployees().filter((e) => !q || `${fullName(e)} ${e.role} ${dept(e.dept)?.name}`.toLowerCase().includes(q)).sort((a, b) => a.first.localeCompare(b.first));
    return `
      <div class="page-head"><div><h1>Directory</h1><p class="sub">${activeEmployees().length} people at ${esc(state.settings.company)}.</p></div>
        <input class="input" id="dir-q" type="search" placeholder="Search people or teams" value="${esc(ui.empQuery)}" style="width:min(320px,100%)"></div>
      <div class="grid g-3">${list.map((e) => `<div class="card" style="display:flex;flex-direction:column;gap:12px">${person(e)}<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">${deptTag(e.dept)}${onLeaveOn(e.id, U.today()) ? '<span class="pill gold">Out today</span>' : ''}</div><div class="muted" style="font-size:13px;overflow-wrap:anywhere">${esc(e.email)} · ${esc(e.location)}</div></div>`).join('')}</div>
      ${list.length ? '' : '<div class="card empty"><strong>No one found</strong>Try another name or team.</div>'}`;
  };
  AFTER.directory = () => {
    const q = $('#dir-q');
    q.addEventListener('input', () => { ui.empQuery = q.value; const pos = q.selectionStart; render(); const n = $('#dir-q'); n.focus(); n.setSelectionRange(pos, pos); });
  };

  // ---------- Workspaces (one per company) ----------
  const WS_KEYS = ['settings', 'departments', 'employees', 'leaves', 'attendance', 'payroll', 'jobs', 'candidates', 'reviews', 'activity', 'finance'];
  function switchWorkspace(tid) {
    if (tid === state.session.tenantId) return;
    const cur = {}; WS_KEYS.forEach((k) => { cur[k] = state[k]; });
    cur.settings = { ...cur.settings };
    state.workspaces[state.session.tenantId] = cur;
    const next = state.workspaces[tid];
    const theme = state.settings.theme;
    WS_KEYS.forEach((k) => { state[k] = next[k]; });
    state.settings.theme = theme;
    delete state.workspaces[tid];
    state.session.tenantId = tid;
    state.session.empId = state.employees[0]?.id;
    ui.payMonth = U.monthKey(U.today()); ui.jobFilter = 'all'; ui.empQuery = '';
  }
  const currentTenant = () => state.platform.tenants.find((t) => t.id === state.session.tenantId);

  // A brand-new company workspace, optionally filled with the sample team.
  function newWorkspace(d, withSamples) {
    const domain = (d.email.split('@')[1] || 'company.com').toLowerCase();
    const base = AllurusSeed.create();
    const [first, ...rest] = d.adminName.trim().split(/\s+/);
    const admin = { id: 'e1', first, last: rest.join(' ') || '', role: 'HR Administrator', dept: 'd-people', salary: 90000, start: U.today(), location: d.city, birthday: '', email: d.email, phone: '', type: 'Full-time', status: 'Active', manager: '' };
    const ws = {
      settings: { ...base.settings, company: d.name, domain, office: d.city, currency: d.currency, checkin: defaultZone(d.name, d.city) },
      departments: base.departments.map((x) => ({ ...x, lead: withSamples ? x.lead : (x.id === 'd-people' ? 'e1' : '') })),
      employees: [admin], leaves: [], attendance: {}, payroll: {}, jobs: [], candidates: [],
      reviews: [{ id: 'r1', empId: 'e1', cycle: 'H2 ' + U.today().slice(0, 4), status: 'Not started', rating: 0, progress: 0, notes: '' }],
      activity: [{ t: Date.now(), text: `${d.name} joined Allurus on the ${plan(d.plan).name} plan` }],
      finance: AllurusFinance.blank({ taxLabel: d.currency === 'MYR' ? 'SST' : 'Sales tax' }),
    };
    if (withSamples) {
      const team = base.employees.slice(1).map((e) => ({ ...e, email: `${e.first}.${e.last}`.toLowerCase() + '@' + domain, location: d.city }));
      Object.assign(ws, { employees: [admin, ...team], leaves: base.leaves, attendance: base.attendance, payroll: base.payroll, jobs: base.jobs, candidates: base.candidates, reviews: base.reviews, finance: base.finance });
      ws.reviews[0] = { ...ws.reviews[0], empId: 'e1' };
    }
    return ws;
  }

  // ---------- Shared link (claude.ai artifact) ----------
  // When this page runs as a published artifact, registrations and check-ins are also
  // written to the artifact's shared database so the owner (Super Admin) sees them live.
  const cloud = { on: false, db: null, uid: null, owner: true, registrations: [], checkins: [] };
  async function connectCloud() {
    if (!window.claude?.use) return;
    cloud.on = true; cloud.owner = false;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (user) {
      try { const v = await user.me(); cloud.owner = !!v.isOwner; cloud.uid = v.id; } catch (e) { /* identity unavailable */ }
    }
    cloud.db = db && cloud.uid ? db : null;
    if (cloud.db && cloud.owner) {
      cloud.db.collection('registrations').onSnapshot((snap) => { cloud.registrations = snap.docs.map((d) => ({ id: d.id, ...d.data() })); mergeRegistrations(); render(); }, () => {});
      cloud.db.collection('checkins').onSnapshot((snap) => { cloud.checkins = snap.docs.map((d) => ({ id: d.id, ...d.data() })); if (route() === 'platform') render(); }, () => {});
    }
    render();
  }
  function mergeRegistrations() {
    cloud.registrations.forEach((r) => {
      const id = 'reg-' + r.id;
      const t = state.platform.tenants.find((x) => x.id === id);
      const row = { id, name: r.company, city: r.city, lat: r.lat, lng: r.lng, industry: r.industry, country: r.country, plan: r.plan, seats: r.seats, status: t?.status || 'Trial', joined: r.joined, admin: r.email, lastActive: r.lastActive || r.joined, viaLink: true };
      if (t) Object.assign(t, row, { status: t.status, plan: t.plan, seats: t.seats }); else state.platform.tenants.push(row);
    });
    save();
  }
  async function cloudWrite(path, data) {
    if (!cloud.db) return false;
    try { await cloud.db.doc(`${path}/${cloud.uid}`).set(data); return true; } catch (e) { return false; }
  }

  function openRegister() {
    const cities = U.CITIES.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}, ${esc(c.country)}</option>`).join('');
    const guess = (() => { try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return U.CITIES.find((c) => c.tz === tz)?.name; } catch (e) { return null; } })();
    openModal({
      title: 'Register your company', submit: 'Create workspace',
      body: `<p class="muted" style="margin-bottom:16px">Start a 14-day free trial. You will be the Company Admin and can invite employees right away.</p>
        <div class="form-grid">
        <div class="field"><label for="rg-name">Company name</label><input class="input" id="rg-name" name="name" required placeholder="Acme Trading LLC"></div>
        <div class="field"><label for="rg-ind">Industry</label><select class="select" id="rg-ind" name="industry">${['Technology', 'Retail', 'Healthcare', 'Manufacturing', 'Construction', 'Hospitality', 'Education', 'Financial services', 'Logistics', 'Professional services', 'Other'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label for="rg-admin">Your full name</label><input class="input" id="rg-admin" name="adminName" required placeholder="Sara Ahmed"></div>
        <div class="field"><label for="rg-email">Work email</label><input class="input" id="rg-email" name="email" type="email" required placeholder="sara@acme.com"></div>
        <div class="field"><label for="rg-city">Head office</label><select class="select" id="rg-city" name="city">${cities}</select><span class="field-hint">Used for check-in distance and your spot on the map.</span></div>
        <div class="field"><label for="rg-cur">Currency</label><select class="select" id="rg-cur" name="currency">${['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'PKR', 'INR', 'MYR', 'SGD', 'AUD', 'CAD'].map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field"><label for="rg-plan">Plan</label><select class="select" id="rg-plan" name="plan">${state.platform.plans.map((p) => `<option value="${p.id}" ${p.id === 'growth' ? 'selected' : ''}>${p.name} · $${p.price}/seat/month</option>`).join('')}</select></div>
        <div class="field"><label for="rg-seats">Team size</label><input class="input" id="rg-seats" name="seats" type="number" min="1" value="25" required></div>
        <div class="field"><label for="rg-pw">Password</label><input class="input" id="rg-pw" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="field-hint">At least 8 characters. You will sign in with your work email.</span></div>
        <div class="field"><label for="rg-pw2">Confirm password</label><input class="input" id="rg-pw2" name="password2" type="password" autocomplete="new-password" required></div>
        <label class="field full" style="flex-direction:row;align-items:center;gap:10px;font-size:13.5px"><input type="checkbox" name="samples" checked style="accent-color:var(--brand);width:16px;height:16px"> Add a sample team so I can try payroll, attendance and hiring</label>
        </div>`,
      onSubmit(d) {
        const email = d.email.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Enter a valid work email'); return false; }
        if (state.accounts.some((a) => a.email === email)) { toast('An account with that email already exists. Sign in instead.'); return false; }
        if (d.password.length < 8) { toast('Use at least 8 characters for your password'); return false; }
        if (d.password !== d.password2) { toast('The two passwords don’t match'); return false; }
        const p = plan(d.plan), seats = Math.max(1, Number(d.seats) || 1);
        if (p.maxSeats && seats > p.maxSeats) { toast(`${p.name} covers up to ${p.maxSeats} people. Pick a bigger plan.`); return false; }
        const c = U.city(d.city);
        const tid = U.uid('t');
        state.platform.tenants.push({ id: tid, name: d.name, city: c.name, lat: c.lat, lng: c.lng, industry: d.industry, country: c.country, plan: d.plan, seats, status: 'Trial', joined: U.today(), admin: d.email, lastActive: U.today(), hasWorkspace: true });
        state.workspaces[tid] = newWorkspace({ ...d, email }, !!d.samples);
        const acct = { email, name: d.adminName.trim(), hash: '', roles: ['admin', 'employee'], tenantId: tid, empId: 'e1' };
        state.accounts.push(acct);
        U.hashPassword(email, d.password).then((h) => { acct.hash = h; startSession(acct); toast(`Welcome to Allurus, ${d.name}`); });
        cloudWrite('registrations', { company: d.name, industry: d.industry, city: c.name, country: c.country, lat: c.lat, lng: c.lng, plan: d.plan, seats, email: d.email, joined: U.today(), lastActive: U.today() });
      },
    });
    if (guess) setTimeout(() => { const s = $('#rg-city'); if (s) s.value = guess; }, 0);
  }

  // ---------- Selfie check-in inside the company's check-in zone ----------
  // Who is checking in is confirmed three ways: the phone (one approved phone per person),
  // the place (GPS inside the zone) and the face (selfie compared on the phone with a reference photo).
  let camStream = null;
  const stopCamera = () => { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; };
  const ci = { mode: 'present', loc: null, photo: null, canvas: null, face: null, fails: 0, consent: false, first: false, upload: false };
  const zone = () => state.settings.checkin;
  const lockOn = () => zone().deviceLock !== false;
  const faceOn = () => zone().faceCheck !== false;
  const liveOnly = () => zone().liveOnly !== false;
  const mapsLink = (p) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  const ciStep = (html) => { const b = $('#ci-body'); if (b) b.innerHTML = html; return !!b; };
  const ciProblem = (title, text, extra = '', buttons) => ciStep(`<div class="ci-problem">${icon('pin')}<div><strong>${title}</strong><p class="muted">${text}</p>${extra}</div></div>
    <div class="ci-actions">${buttons || '<button class="btn" data-act="close-overlay">Cancel</button><button class="btn btn-primary" data-act="ci-retry">Try again</button>'}</div>`);

  // ----- This phone -----
  const DEVICE_KEY = 'allurus-device-id';
  // A random id kept in this browser, separate from the app's data, so Reset data doesn't change it.
  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = 'dev-' + (crypto.randomUUID ? crypto.randomUUID() : U.uid('') + U.uid('')); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return 'dev-unsaved'; }
  }
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux computer' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
    return `${os}, ${br}`;
  }
  // Whether this phone may check in for employee e.
  function deviceGate(e) {
    if (!lockOn()) return { ok: true };
    const id = deviceId();
    const owner = state.employees.find((x) => x.id !== e.id && (x.devices || []).some((d) => d.id === id && d.status === 'approved'));
    if (owner) return { ok: false, title: 'This phone belongs to someone else', text: `This phone is registered for ${esc(fullName(owner))}. Each phone checks in for one person only, so please use your own phone.` };
    const mine = (e.devices || []).find((d) => d.id === id);
    if (mine?.status === 'approved') return { ok: true };
    if (mine?.status === 'pending') return { ok: false, title: 'Waiting for HR to approve this phone', text: `You asked to use this phone on ${U.fmtDate(mine.added)}. HR approves it on the Attendance page.` };
    const approved = (e.devices || []).filter((d) => d.status === 'approved');
    if (!approved.length) return { ok: true, first: true };
    return { ok: false, request: true, title: 'This isn’t your registered phone', text: `You check in from your ${esc(approved.map((d) => d.name).join(', '))}. Got a new phone? Ask HR to approve this one.` };
  }
  const phoneStatus = (e) => {
    if (!lockOn()) return '';
    const g = deviceGate(e);
    return g.ok ? (g.first ? 'Your first check-in registers this phone as yours.' : 'This phone is registered for your check-ins.') : g.title + '.';
  };

  function checkIn(mode) {
    Object.assign(ci, { mode, loc: null, photo: null, canvas: null, face: null, fails: 0, consent: false, first: false, upload: false });
    openModal({ title: mode === 'remote' ? 'Check in remotely' : 'Check in', size: 'sm', submit: null, body: '<div id="ci-body"></div>' });
    $('#overlay-root .modal-foot').hidden = true;
    const g = deviceGate(me());
    if (!g.ok) {
      ciProblem(g.title, g.text, '', `<button class="btn" data-act="close-overlay">Close</button>${g.request ? '<button class="btn btn-primary" data-act="dev-request">Ask HR to approve this phone</button>' : ''}`);
      return;
    }
    ci.first = !!g.first;
    if (faceOn()) AllurusFace.load().catch(() => {});
    if (faceOn() && !me().face) { ciConsent(); return; }
    ciLocate();
  }
  function ciConsent() {
    ciStep(`<div class="ci-problem">${icon('shield')}<div><strong>Set up your face check</strong>
      <p class="muted">To stop anyone else checking in for you, ${esc(state.settings.company)} compares each check-in selfie with a reference photo of you.</p>
      <ul class="consent-list"><li>Your next selfie becomes your reference photo, and HR confirms it’s you.</li><li>The comparison runs on this phone. Your face is stored as a photo and a set of 128 numbers.</li><li>HR can see your reference photo and check-in selfies. They are used only for attendance.</li></ul></div></div>
      <label class="check"><input type="checkbox" id="ci-agree"><span>I agree to my face being used to verify my check-ins</span></label>
      <div class="ci-actions"><button class="btn" data-act="close-overlay">Not now</button><button class="btn btn-primary" data-act="ci-consent">Continue</button></div>`);
  }
  async function ciLocate() {
    const z = zone();
    ciStep(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Finding your location</strong><p class="muted">Allow location access if your browser asks. You need to be within ${z.radius} m of ${esc(z.label)}.</p></div></div>`);
    const loc = await U.locate({ gpsOnly: true });
    if (!$('#ci-body')) return;
    if (!loc) {
      ciProblem('Location is off', 'Check-in needs your phone’s GPS position. Turn on location for this browser, allow access for this site, then try again.');
      return;
    }
    const m = Math.round(U.distanceKm(loc, z) * 1000);
    loc.m = m;
    loc.inside = m - Math.min(loc.accuracy || 0, 50) <= z.radius;
    ci.loc = loc;
    if (ci.mode === 'present' && !loc.inside) {
      ciProblem(`You are ${U.fmtDist(m)} from ${esc(z.label)}`, `Move inside the ${z.radius} m check-in zone and try again. Your GPS accuracy is ±${loc.accuracy} m.`,
        `<a class="hint" href="${mapsLink(z)}" target="_blank" rel="noopener">Open the check-in point in Google Maps</a>`);
      return;
    }
    ciSelfie();
  }
  function ciWhere() {
    const z = zone(), L = ci.loc;
    return `<div class="ci-where ${L.inside ? 'ok' : ''}">${icon(L.inside ? 'check' : 'pin')}<span>${L.inside ? `Inside the check-in zone · ${U.fmtDist(L.m)} from ${esc(z.label)}` : `Remote · ${U.fmtDist(L.m)} from ${esc(z.label)}`}</span></div>`;
  }
  async function ciSelfie() {
    ci.photo = null; ci.canvas = null;
    ciStep(`${ciWhere()}
      <div class="ci-cam"><video id="ci-video" playsinline autoplay muted></video></div>
      <p class="muted ci-hint" id="ci-hint">${faceOn() && me().face ? 'Look straight at the camera in good light. Only you should be in the photo.' : 'Center your face in the frame, then take your selfie.'}</p>
      <div class="ci-actions"><button class="btn btn-primary" data-act="ci-capture" id="ci-shoot" disabled>${icon('camera')}Take selfie</button></div>
      <input type="file" id="ci-file" accept="image/*" capture="user" hidden>`);
    $('#ci-file').addEventListener('change', (ev) => {
      const f = ev.target.files?.[0]; if (!f) return;
      const img = new Image();
      img.onload = () => {
        ci.canvas = squareCanvas(img, img.naturalWidth, img.naturalHeight, false, 480);
        ci.photo = squareCanvas(img, img.naturalWidth, img.naturalHeight, false, 320).toDataURL('image/jpeg', 0.72);
        ci.upload = true; URL.revokeObjectURL(img.src); ciVerify();
      };
      img.onerror = () => toast('That file is not a photo. Try again.', 'error');
      img.src = URL.createObjectURL(f);
    });
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      const v = $('#ci-video');
      if (!v) { stopCamera(); return; }
      v.srcObject = camStream; await v.play();
      $('#ci-shoot').disabled = false;
    } catch (e) {
      stopCamera();
      if (!$('.ci-cam')) return;
      if (liveOnly()) {
        ciProblem('Allow the camera to check in', 'Check-in needs a live selfie. Allow camera access for this site in your browser settings, then try again. Uploading a saved photo isn’t allowed.', '',
          '<button class="btn" data-act="close-overlay">Cancel</button><button class="btn btn-primary" data-act="ci-retake">Try again</button>');
        return;
      }
      $('.ci-cam').innerHTML = `<div class="ci-cam-empty">${icon('camera')}<span>Live camera isn’t available here.</span></div>`;
      $('#ci-hint').textContent = 'Use your phone’s front camera to take a selfie instead.';
      const b = $('#ci-shoot'); b.disabled = false; b.dataset.act = 'ci-pick'; b.innerHTML = `${icon('camera')}Open camera`;
    }
  }
  // Center-square crop. 320 px JPEG is kept (about 20 KB); a 480 px copy is used for the face check.
  function squareCanvas(src, w, h, mirror, size) {
    const side = Math.min(w, h), c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    return c;
  }
  async function ciVerify() {
    if (!faceOn()) { ci.face = null; ciReview(); return; }
    const first = !me().face;
    ciStep(`${ciWhere()}<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>${first ? 'Reading your face' : 'Checking it’s you'}</strong><p class="muted">The first check on a phone takes a few seconds while the face check loads.</p></div></div>`);
    let faces;
    try { faces = await AllurusFace.describe(ci.canvas); } catch (e) {
      ci.face = { result: 'unavailable' }; if ($('#ci-body')) ciReview(); return;
    }
    if (!$('#ci-body')) return;
    const retake = '<button class="btn" data-act="close-overlay">Cancel</button><button class="btn btn-primary" data-act="ci-retake">Retake selfie</button>';
    if (!faces.length) { ciProblem('We couldn’t see a face', 'Hold the phone at eye level in good light, with your whole face in the frame.', '', retake); return; }
    if (faces.length > 1) { ciProblem(`We found ${faces.length} faces`, 'Only you should be in your check-in selfie. Retake it on your own.', '', retake); return; }
    const desc = faces[0].descriptor, ref = me().face;
    if (!ref) { ci.face = { result: 'enrolled', descriptor: desc }; ciReview(); return; }
    const d = AllurusFace.distance(desc, ref.descriptor), v = AllurusFace.verdict(d);
    if (v === 'mismatch' && ++ci.fails < 2) {
      ciProblem(`This doesn’t look like ${esc(me().first)}`, 'Make sure it’s you in the photo, facing the camera in good light without a mask or sunglasses, then retake it.', '', retake);
      return;
    }
    ci.face = { result: v, d: +d.toFixed(3), sim: AllurusFace.similarity(d) };
    ciReview();
  }
  const FACE_NOTE = {
    match: (f) => `<div class="ci-where ok">${icon('check')}<span>Face matches your reference photo (${f.sim}% similar)</span></div>`,
    weak: (f) => `<div class="ci-where">${icon('pin')}<span>Weak face match (${f.sim}%). HR may review this check-in.</span></div>`,
    mismatch: () => `<div class="ci-where bad">${icon('x')}<span>Your face didn’t match after two tries. You can still check in, and HR will review it.</span></div>`,
    enrolled: () => `<div class="ci-where">${icon('shield')}<span>This selfie becomes your reference photo. HR will confirm it’s you.</span></div>`,
    unavailable: () => `<div class="ci-where">${icon('pin')}<span>The face check couldn’t run on this phone. HR will review your selfie.</span></div>`,
  };
  function ciReview() {
    const f = ci.face;
    ciStep(`${ciWhere()}${f ? FACE_NOTE[f.result](f) : ''}<div class="ci-cam"><img class="ci-photo" src="${ci.photo}" alt="Your selfie"></div>
      <div class="ci-actions"><button class="btn" data-act="ci-retake">Retake</button><button class="btn btn-primary" data-act="ci-confirm">${icon('check')}${f?.result === 'mismatch' ? 'Check in for HR review' : `Check in at ${nowHM()}`}</button></div>`);
  }
  function ciConfirm() {
    const L = ci.loc, T = U.today(), t = nowHM(), z = zone(), e = me();
    if (!L || !ci.photo) return;
    state.attendance[T] = state.attendance[T] || {};
    const loc = { lat: L.lat, lng: L.lng, accuracy: L.accuracy, label: L.label, source: 'gps', m: L.m, inside: L.inside, zone: z.label, radius: z.radius };
    const face = ci.face ? { result: ci.face.result, sim: ci.face.sim ?? null } : null;
    const device = { id: deviceId(), name: deviceName() };
    if (ci.first && lockOn()) {
      e.devices = [...(e.devices || []), { id: device.id, name: device.name, status: 'approved', added: T, auto: true }];
      log(`${fullName(e)} registered a phone for check-in (${device.name})`);
    }
    if (ci.face?.result === 'enrolled') e.face = { photo: ci.photo, descriptor: ci.face.descriptor, status: 'pending', enrolledOn: T, consentOn: T };
    const extra = { photo: ci.photo, loc, face, device, upload: ci.upload };
    const prev = state.attendance[T][e.id];
    if (prev?.in && prev.out) {
      // Checking in again after a check-out: keep the first check-in time so hours still count from it,
      // and keep the earlier session (with its selfie) in the day's history.
      prev.history = [...(prev.history || []), { in: prev.lastIn || prev.in, out: prev.out, photo: prev.photo, loc: prev.loc, face: prev.face }];
      Object.assign(prev, { s: ci.mode, out: '', lastIn: t, ...extra });
    } else {
      state.attendance[T][e.id] = { s: ci.mode, in: t, out: '', ...extra };
    }
    pruneSelfies();
    cloudWrite('checkins', { company: state.settings.company, employee: fullName(e), mode: ci.mode, time: new Date().toISOString(), label: `${U.fmtDist(L.m)} from ${z.label}`, source: 'gps', lat: L.lat, lng: L.lng, accuracy: L.accuracy });
    const tn = currentTenant(); if (tn) tn.lastActive = T;
    closeOverlay();
    const flagged = face && ['mismatch', 'unavailable'].includes(face.result);
    commit(flagged ? `Checked in at ${t}. HR will review your selfie.` : `Checked in at ${t}`,
      `${fullName(e)} checked in${ci.mode === 'remote' ? ' remotely' : ''} with a selfie, ${U.fmtDist(L.m)} from ${z.label}${face?.result === 'mismatch' ? '. The face did not match.' : ''}`);
  }
  // Selfies are kept for 30 days so browser storage does not fill up.
  function pruneSelfies() {
    const cutoff = U.addDays(U.today(), -30);
    Object.keys(state.attendance).forEach((d) => { if (d < cutoff) Object.values(state.attendance[d]).forEach((r) => { delete r.photo; (r.history || []).forEach((h) => { delete h.photo; }); }); });
  }

  // ----- How HR sees it -----
  const faceTag = (r) => {
    const f = r?.face; if (!f) return '';
    return ({
      match: `<span class="tag ok" title="Face matches the reference photo">Face ${f.sim}%</span>`,
      weak: `<span class="tag warn" title="Weak face match">Weak ${f.sim}%</span>`,
      mismatch: '<span class="tag bad" title="Face did not match the reference photo">No match</span>',
      enrolled: '<span class="tag" title="This selfie became the reference photo">Reference</span>',
      unavailable: '<span class="tag warn" title="The face check could not run">Not checked</span>',
    })[f.result] || '';
  };
  function securityQueue() {
    const devices = [], faces = [];
    activeEmployees().forEach((e) => {
      (e.devices || []).filter((d) => d.status === 'pending').forEach((d) => devices.push({ e, d }));
      if (e.face?.status === 'pending') faces.push(e);
    });
    return { devices, faces, count: devices.length + faces.length };
  }
  function securityCard() {
    const q = securityQueue(), T = U.today();
    const flagged = activeEmployees().map((e) => ({ e, r: state.attendance[T]?.[e.id] })).filter((x) => x.r && (['mismatch', 'unavailable'].includes(x.r.face?.result) || x.r.upload));
    if (!q.count && !flagged.length) return '';
    return `<div class="card"><div class="card-head"><h3>Phones and faces to review</h3><span class="hint">${q.count + flagged.length} items</span></div><div class="list">
      ${q.faces.map((e) => `<div class="list-item"><img class="ref-thumb" src="${e.face.photo}" alt="Reference photo of ${esc(fullName(e))}"><div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">New reference photo from ${U.fmtDate(e.face.enrolledOn)}. Is this really ${esc(e.first)}?</div></div>
        <button class="btn btn-sm btn-ok" data-act="face-confirm" data-id="${e.id}">${icon('check')}It’s ${esc(e.first)}</button><button class="btn btn-sm btn-danger" data-act="face-reset" data-id="${e.id}">Not them</button></div>`).join('')}
      ${q.devices.map(({ e, d }) => `<div class="list-item">${avatar(fullName(e), 'sm')}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">Wants to check in from a new phone: ${esc(d.name)}, requested ${U.fmtDate(d.added)}</div></div>
        <button class="btn btn-sm btn-ok" data-act="dev-approve" data-id="${e.id}" data-v="${d.id}">Approve</button><button class="btn btn-sm btn-danger" data-act="dev-reject" data-id="${e.id}" data-v="${d.id}">Reject</button></div>`).join('')}
      ${flagged.map(({ e, r }) => `<div class="list-item">${selfieThumb(e.id, T, r)}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">${r.upload ? 'Checked in with an uploaded photo instead of the live camera.' : r.face?.result === 'mismatch' ? 'Checked in today, but the face didn’t match the reference photo.' : 'The face check couldn’t run for today’s check-in.'} Tap the photo to compare.</div></div></div>`).join('')}
    </div></div>`;
  }
  function openSelfie(empId, day) {
    const r = state.attendance[day]?.[empId], e = emp(empId);
    if (!r?.photo) return;
    const ref = e?.face?.photo;
    openModal({
      title: `${fullName(e)} · ${U.fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' })}`, size: ref ? '' : 'sm', submit: null,
      body: `<div style="display:flex;flex-direction:column;gap:14px">
        <div class="compare">${ref ? `<figure><img class="ci-photo" src="${ref}" alt="Reference photo of ${esc(fullName(e))}"><figcaption>Reference photo${e.face.status === 'pending' ? ' (not confirmed yet)' : ''}</figcaption></figure>` : ''}
          <figure><img class="ci-photo" src="${r.photo}" alt="Check-in selfie of ${esc(fullName(e))}"><figcaption>Check-in selfie, ${r.lastIn || r.in}</figcaption></figure></div>
        <dl class="kv" style="width:100%"><dt>Face check</dt><dd>${r.face ? `${faceTag(r)} ${r.face.result === 'match' ? 'Matches the reference photo' : r.face.result === 'weak' ? 'Weak match; compare the photos' : r.face.result === 'mismatch' ? 'Did not match after two tries' : r.face.result === 'enrolled' ? 'Became the reference photo' : 'Could not run on the phone'}` : 'Not used'}${r.upload ? ' · uploaded photo, not live camera' : ''}</dd>
        <dt>Phone</dt><dd>${r.device ? esc(r.device.name) : '—'}</dd>
        <dt>Checked in</dt><dd>${r.in}${r.out ? ` · out ${r.out}` : ''}</dd><dt>Location</dt><dd>${r.loc ? esc(locText(r.loc)) : '—'}</dd>
        ${r.loc?.lat != null ? `<dt>Coordinates</dt><dd><a href="${mapsLink(r.loc)}" target="_blank" rel="noopener">${U.fmtCoords(r.loc)}</a></dd>` : ''}
        ${r.history?.length ? `<dt>Earlier today</dt><dd>${r.history.map((h) => `${h.in}–${h.out}`).join(', ')} · latest check-in ${r.lastIn}</dd>` : ''}</dl></div>`,
    });
  }
  const locText = (loc) => {
    if (!loc) return '';
    if (loc.m != null) return `${loc.inside ? 'Inside zone' : 'Outside zone'} · ${U.fmtDist(loc.m)} from ${loc.zone || 'check-in point'} · GPS ±${loc.accuracy} m`;
    const how = loc.source === 'gps' ? `GPS ±${loc.accuracy < 1000 ? loc.accuracy + ' m' : (loc.accuracy / 1000).toFixed(1) + ' km'}` : 'approx. from time zone';
    return `${loc.label} (${how})`;
  };
  const selfieThumb = (empId, day, r) => (r?.photo ? `<button class="selfie-thumb" data-act="view-selfie" data-id="${empId}" data-v="${day}" aria-label="View selfie"><img src="${r.photo}" alt=""></button>` : '');
  function securitySection(e) {
    const devs = e.devices || [];
    return `<div class="drawer-section"><h4>Check-in identity</h4>
      <div style="display:flex;gap:14px;align-items:center">${e.face ? `<img class="ref-thumb lg" src="${e.face.photo}" alt="Reference photo of ${esc(fullName(e))}">` : `<span class="ref-thumb lg empty">${icon('camera')}</span>`}
        <div style="flex:1;min-width:0"><div class="person-name">${e.face ? (e.face.status === 'confirmed' ? 'Reference photo confirmed' : 'Reference photo waiting for HR') : 'No reference photo yet'}</div>
          <div class="person-sub" style="white-space:normal">${e.face ? `Set on ${U.fmtDate(e.face.enrolledOn)}, with consent.` : 'Taken at their first check-in, after they agree.'}</div>
          <div class="actions" style="margin-top:8px">${e.face?.status === 'pending' ? `<button class="btn btn-sm btn-ok" data-act="face-confirm" data-id="${e.id}">Confirm</button>` : ''}${e.face ? `<button class="btn btn-sm" data-act="face-reset" data-id="${e.id}">Retake at next check-in</button>` : ''}</div></div></div>
      <div class="list">${devs.length ? devs.map((d) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(d.name)}</div><div class="person-sub">${d.status === 'approved' ? 'Approved' : 'Waiting for approval'} · added ${U.fmtDate(d.added)}${d.id === deviceId() ? ' · this device' : ''}</div></div>
        ${d.status === 'pending' ? `<button class="btn btn-sm btn-ok" data-act="dev-approve" data-id="${e.id}" data-v="${d.id}">Approve</button>` : ''}<button class="btn btn-sm btn-ghost" data-act="dev-remove" data-id="${e.id}" data-v="${d.id}">Remove</button></div>`).join('') : '<p class="faint" style="font-size:13px">No phone registered. Their first check-in registers it.</p>'}</div></div>`;
  }

  // ---------- Platform map ----------
  let mapInstance = null;
  function drawMap() {
    const el = $('#tenant-map');
    if (!el) return;
    if (!window.jsVectorMap) { el.innerHTML = '<div class="empty">The map could not load. Company locations are listed below.</div>'; return; }
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    const colors = { Active: v('--brand'), Trial: v('--info'), 'Past due': v('--warn'), Suspended: v('--bad') };
    const ts = state.platform.tenants.filter((t) => t.lat != null);
    try { mapInstance?.destroy?.(); } catch (e) { /* already gone */ }
    el.innerHTML = '';
    mapInstance = new jsVectorMap({
      selector: '#tenant-map', map: 'world', zoomButtons: true, zoomOnScroll: false, backgroundColor: 'transparent',
      regionStyle: { initial: { fill: v('--map-land'), stroke: v('--surface'), strokeWidth: 0.4, fillOpacity: 1 }, hover: { fill: v('--map-land-hover'), cursor: 'default' } },
      markers: ts.map((t) => ({ name: t.name, coords: [t.lat, t.lng], style: { fill: colors[t.status] } })),
      markerStyle: { initial: { r: 6, stroke: v('--surface'), strokeWidth: 2.5, strokeOpacity: 1, fillOpacity: 1 }, hover: { r: 8, cursor: 'pointer', fill: v('--gold') } },
      onRegionTooltipShow(ev) { ev.preventDefault(); },
      onMarkerTooltipShow(ev, tip, i) { const t = ts[i]; tip.text(`<strong>${esc(t.name)}</strong><br>${esc(t.city)} · ${t.seats} seats · ${t.status}`, true); },
      onMarkerClick(ev, i) { openTenant(ts[i].id); },
    });
  }

  // Role-specific actions
  Object.assign(ACTIONS_EXTRA, {
    'register': () => openRegister(),
    'toggle-pw': () => { const i = $('#login-password'), b = $('[data-act="toggle-pw"]'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); },
    'logout': () => { Object.assign(state.session, { account: null, roles: [], role: null }); closeOverlay(); save(); history.replaceState(null, '', location.pathname + location.search); render(); toast('Signed out'); },
    'check-in': (_, v) => checkIn(v),
    'ci-retry': () => ciLocate(),
    'ci-capture': () => {
      const v = $('#ci-video'); if (!v?.videoWidth) return;
      ci.canvas = squareCanvas(v, v.videoWidth, v.videoHeight, true, 480);
      ci.photo = squareCanvas(v, v.videoWidth, v.videoHeight, true, 320).toDataURL('image/jpeg', 0.72);
      ci.upload = false; stopCamera(); ciVerify();
    },
    'ci-consent': () => { if (!$('#ci-agree')?.checked) { toast('Tick the box to agree, or choose Not now', 'error'); return; } ci.consent = true; ciLocate(); },
    'dev-request': () => {
      const e = me(), id = deviceId();
      e.devices = [...(e.devices || []).filter((d) => d.id !== id), { id, name: deviceName(), status: 'pending', added: U.today() }];
      closeOverlay(); commit('Request sent to HR', `${fullName(e)} asked to check in from a new phone (${deviceName()})`);
    },
    'dev-approve': (empId, devId) => {
      const e = emp(empId), d = e?.devices?.find((x) => x.id === devId); if (!d) return;
      const other = state.employees.find((x) => x.id !== empId && (x.devices || []).some((y) => y.id === devId && y.status === 'approved'));
      if (other) { toast(`That phone is already registered for ${fullName(other)}. Remove it there first.`, 'error'); return; }
      d.status = 'approved'; d.approvedOn = U.today();
      commit(`Phone approved for ${e.first}`, `${fullName(e)}’s new phone was approved (${d.name})`);
      if ($('.drawer')) openProfile(empId);
    },
    'dev-reject': (empId, devId) => { const e = emp(empId); e.devices = (e.devices || []).filter((x) => x.id !== devId); commit('Phone request rejected', `${fullName(e)}’s phone request was rejected`); },
    'dev-remove': (empId, devId) => { const e = emp(empId); e.devices = (e.devices || []).filter((x) => x.id !== devId); commit(`Phone removed from ${e.first}`, `A phone was removed from ${fullName(e)}’s check-in`); openProfile(empId); },
    'face-confirm': (empId) => { const e = emp(empId); e.face.status = 'confirmed'; e.face.confirmedOn = U.today(); commit(`Reference photo confirmed for ${e.first}`, `${fullName(e)}’s reference photo was confirmed`); if ($('.drawer')) openProfile(empId); },
    'face-reset': (empId) => { const e = emp(empId); delete e.face; commit(`${e.first} will set a new reference photo at the next check-in`, `${fullName(e)}’s reference photo was reset`); if ($('.drawer')) openProfile(empId); },
    'sec-toggle': (key, v) => {
      zone()[key] = v === 'on';
      const label = { deviceLock: 'Phone lock', faceCheck: 'Face check', liveOnly: 'Live camera only' }[key];
      commit(`${label} turned ${v}`);
    },
    'ci-pick': () => $('#ci-file')?.click(),
    'ci-retake': () => ciSelfie(),
    'ci-confirm': () => ciConfirm(),
    'view-selfie': (id, day) => openSelfie(id, day),
    'zone-here': async () => {
      toast('Finding your location…');
      const loc = await U.locate({ gpsOnly: true });
      if (!loc) { toast('Could not get your GPS position. Turn on location and try again.', 'error'); return; }
      Object.assign(state.settings.checkin, { lat: loc.lat, lng: loc.lng });
      commit(`Check-in point set to your location (±${loc.accuracy} m)`);
    },
    'zone-remote': (_, v) => { state.settings.checkin.remote = v === 'on'; commit(v === 'on' ? 'Remote check-in allowed' : 'Remote check-in turned off'); },
    'check-out': () => { const r = myRecord(U.today()); r.out = nowHM(); commit(`Checked out at ${r.out}`); },
    'my-payslip': (m) => openPayslip(me().id, m),
    'tenant-view': (id) => openTenant(id),
    'tenant-filter': (_, v) => { ui.tenantStatus = v; render(); },
    'tenant-status': (id, v) => {
      const t = state.platform.tenants.find((x) => x.id === id); t.status = v;
      closeOverlay(); commit(`${t.name} is now ${v.toLowerCase()}`);
    },
    'tenant-save': (id) => {
      const t = state.platform.tenants.find((x) => x.id === id);
      const p = plan($('#t-plan').value), seats = Math.max(1, Number($('#t-seats').value) || 1);
      if (p.maxSeats && seats > p.maxSeats) { toast(`${p.name} allows up to ${p.maxSeats} seats`); return; }
      t.plan = p.id; t.seats = seats; closeOverlay(); commit(`${t.name} updated`);
    },
    'tenant-open': (id) => { switchWorkspace(id); state.session.role = 'admin'; closeOverlay(); save(); location.hash = 'dashboard'; render(); toast(`Viewing ${state.settings.company} as Company Admin`); },
    'invoice-paid': (id) => { const i = state.platform.invoices.find((x) => x.id === id); i.status = 'Paid'; commit(`${id} marked paid`); },
    'edit-plan': (id) => {
      const p = plan(id);
      openModal({
        title: `Edit ${p.name}`, size: 'sm', submit: 'Save plan',
        body: `<div class="form-grid">
          <div class="field"><label for="pl-price">Price per seat (USD)</label><input class="input" id="pl-price" name="price" type="number" min="0" step="0.5" required value="${p.price}"></div>
          <div class="field"><label for="pl-max">Seat limit</label><input class="input" id="pl-max" name="maxSeats" type="number" min="0" value="${p.maxSeats}"><span class="field-hint">0 means unlimited</span></div>
          <div class="field full"><label for="pl-feat">What is included</label><textarea class="textarea" id="pl-feat" name="features">${esc(p.features)}</textarea></div></div>`,
        onSubmit(d) { Object.assign(p, { price: Number(d.price), maxSeats: Number(d.maxSeats) || 0, features: d.features }); commit(`${p.name} plan saved`); },
      });
    },
    'add-tenant': () => openModal({
      title: 'Add company', submit: 'Start trial',
      body: `<div class="form-grid">
        <div class="field"><label for="tn-name">Company name</label><input class="input" id="tn-name" name="name" required></div>
        <div class="field"><label for="tn-ind">Industry</label><input class="input" id="tn-ind" name="industry" required></div>
        <div class="field"><label for="tn-country">Country</label><input class="input" id="tn-country" name="country" required></div>
        <div class="field"><label for="tn-admin">Admin email</label><input class="input" id="tn-admin" name="admin" type="email" required></div>
        <div class="field"><label for="tn-plan">Plan</label><select class="select" id="tn-plan" name="plan">${state.platform.plans.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
        <div class="field"><label for="tn-seats">Seats</label><input class="input" id="tn-seats" name="seats" type="number" min="1" value="10" required></div></div>`,
      onSubmit(d) {
        state.platform.tenants.push({ id: U.uid('t'), ...d, seats: Number(d.seats), status: 'Trial', joined: U.today(), lastActive: U.today() });
        commit(`${d.name} started a 14-day trial`);
      },
    }),
  });

  // ---------- Brand marks ----------
  const LOGO_MARK = '<svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0F766E"/><path d="M19 47 L32 17 L45 47" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 37.5 Q32 32 40.5 37.5" fill="none" stroke="#D9B66F" stroke-width="4.5" stroke-linecap="round"/></svg>';
  const LOGO_FULL = `<span style="display:inline-flex;align-items:center;gap:12px">${LOGO_MARK.replace(/width="30" height="30"/, 'width="44" height="44"')}<span style="font-size:22px;font-weight:600;letter-spacing:.3em">ALLURUS</span></span>`;

  // ---------- Overlays ----------
  function closeOverlay() { stopCamera(); $('#overlay-root').innerHTML = ''; }
  function openModal({ title, body, submit = 'Save', onSubmit, size = '' }) {
    $('#overlay-root').innerHTML = `<div class="scrim" data-scrim><form class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate>
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"><button type="button" class="btn" data-act="close-overlay">${submit ? 'Cancel' : 'Done'}</button>${submit ? `<button type="submit" class="btn btn-primary">${esc(submit)}</button>` : ''}</div></form></div>`;
    const form = $('#overlay-root form');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const bad = $$('[required]', form).find((el) => !el.value.trim());
      if (bad) { bad.focus(); toast(`${bad.closest('.field').querySelector('label').textContent} is required`); return; }
      const d = Object.fromEntries(new FormData(form).entries());
      if (onSubmit?.(d) !== false) closeOverlay();
    });
    setTimeout(() => $('input:not([type=hidden]), select, textarea', form)?.focus(), 30);
  }
  function openDrawer(html) {
    $('#overlay-root').innerHTML = `<div class="scrim drawer-scrim" data-scrim><aside class="drawer" role="dialog" aria-modal="true">${html}</aside></div>`;
  }
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast' + (kind === 'error' ? ' toast-error' : ''); t.innerHTML = icon(kind === 'error' ? 'x' : 'check') + esc(msg);
    $('#toast-root').appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  // ---------- CSV ----------
  function downloadCSV(name, rows) {
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    toast(`${name} exported`);
  }

  // ---------- Theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  // ---------- Actions ----------
  const ACTIONS = {
    'close-overlay': closeOverlay,
    'add-emp': () => openEmployeeModal(),
    'edit-emp': (id) => openEmployeeModal(id),
    'view-emp': (id) => openProfile(id),
    'ask-delete-emp': (id) => {
      $('#del-confirm').innerHTML = `<div class="confirm-bar"><span style="flex:1">Remove ${esc(fullName(emp(id)))} and their records?</span><button class="btn btn-sm" data-act="close-overlay">Keep</button><button class="btn btn-sm btn-danger" data-act="delete-emp" data-id="${id}">Remove</button></div>`;
    },
    'delete-emp': (id) => {
      const n = fullName(emp(id));
      state.employees = state.employees.filter((e) => e.id !== id);
      state.leaves = state.leaves.filter((l) => l.empId !== id);
      state.reviews = state.reviews.filter((r) => r.empId !== id);
      state.departments.forEach((d) => { if (d.lead === id) d.lead = ''; });
      state.employees.forEach((e) => { if (e.manager === id) e.manager = ''; });
      closeOverlay(); commit(`${n} removed`, `${n} was removed from the directory`);
    },
    'emp-status': (_, v) => { ui.empStatus = v; render(); },
    'export-emps': () => downloadCSV('employees.csv', [['Name', 'Email', 'Phone', 'Role', 'Department', 'Status', 'Type', 'Location', 'Start date', 'Salary'],
      ...state.employees.map((e) => [fullName(e), e.email, e.phone, e.role, dept(e.dept)?.name, empStatus(e), e.type, e.location, e.start, e.salary])]),
    'add-dept': () => openDeptModal(),
    'edit-dept': (id) => openDeptModal(id),
    'del-dept': (id) => {
      const n = state.employees.filter((e) => e.dept === id).length;
      if (n) { toast(`Move the ${n} people in this department first`); return; }
      state.departments = state.departments.filter((d) => d.id !== id); commit('Department deleted');
    },
    'att-shift': (_, v) => { ui.attDate = U.addDays(ui.attDate, Number(v)); render(); },
    'att-today': () => { ui.attDate = U.today(); render(); },
    'att-set': (id, v) => setAttendance(id, v),
    'att-clear': (id) => {
      const day = ui.attDate;
      if (state.attendance[day]) delete state.attendance[day][id];
      commit(`Check-in cleared for ${fullName(emp(id))}`, `${fullName(emp(id))}'s check-in on ${U.fmtDate(day)} was cleared`);
    },
    'att-all': () => {
      const day = ui.attDate; state.attendance[day] = state.attendance[day] || {};
      let n = 0;
      activeEmployees().filter((e) => e.start <= day).forEach((e) => { if (!state.attendance[day][e.id]) { state.attendance[day][e.id] = { s: onLeaveOn(e.id, day) ? 'leave' : 'present', in: '09:00' }; n++; } });
      commit(n ? `${n} marked present` : 'Everyone is already marked');
    },
    'new-leave': (id) => openLeaveModal(id),
    'approve-leave': (id) => decideLeave(id, true),
    'reject-leave': (id) => decideLeave(id, false),
    'del-leave': (id) => { state.leaves = state.leaves.filter((l) => l.id !== id); commit('Request deleted'); },
    'leave-filter': (_, v) => { ui.leaveFilter = v; render(); },
    'pay-shift': (_, v) => { ui.payMonth = U.addMonths(ui.payMonth, Number(v)); render(); },
    'pay-run': () => {
      const mk = ui.payMonth;
      const items = activeEmployees().filter((e) => e.start <= U.monthEnd(mk)).map((e) => ({ empId: e.id, ...U.payCalc(e.salary, 0, state.settings) }));
      if (!items.length) { toast('No employees were active that month'); return; }
      state.payroll[mk] = { status: 'Draft', items };
      commit('Draft created', `Payroll draft created for ${U.fmtMonth(mk)}`);
    },
    'pay-discard': () => { delete state.payroll[ui.payMonth]; commit('Draft discarded'); },
    'pay-approve': () => {
      const run = state.payroll[ui.payMonth]; run.status = 'Paid'; run.paidOn = U.today();
      commit('Payroll paid', `Payroll for ${U.fmtMonth(ui.payMonth)} was paid (${money(payTotal(run).net)} net)`);
    },
    'pay-export': () => {
      const run = state.payroll[ui.payMonth];
      downloadCSV(`payroll-${ui.payMonth}.csv`, [['Employee', 'Email', 'Base', 'Bonus', 'Gross', 'PCB tax', 'EPF SOCSO EIS', 'Net'], ...run.items.map((i) => { const e = emp(i.empId); return [fullName(e), e?.email, i.base, i.bonus, i.gross, i.tax, i.benefits, i.net]; })]);
    },
    'payslip': (id) => openPayslip(id),
    'job-filter': (_, v) => { ui.jobFilter = v; render(); },
    'add-job': () => openJobModal(),
    'close-job': (id) => {
      const j = state.jobs.find((x) => x.id === id);
      state.jobs = state.jobs.filter((x) => x.id !== id);
      state.candidates = state.candidates.filter((c) => c.jobId !== id || c.stage === 'Hired');
      ui.jobFilter = 'all'; commit('Role closed', `${j.title} role was closed`);
    },
    'add-cand': () => openCandidateModal(),
    'cand-move': (id, v) => {
      const c = state.candidates.find((x) => x.id === id);
      const i = Math.min(STAGES.length - 1, Math.max(0, STAGES.indexOf(c.stage) + Number(v)));
      c.stage = STAGES[i]; commit(`${c.name} moved to ${c.stage}`, `${c.name} moved to ${c.stage}`);
    },
    'cand-del': (id) => { state.candidates = state.candidates.filter((c) => c.id !== id); commit('Candidate removed'); },
    'cand-hire': (id) => {
      const c = state.candidates.find((x) => x.id === id);
      const j = state.jobs.find((x) => x.id === c.jobId);
      const [first, ...rest] = c.name.split(' ');
      openEmployeeModal(null, { first, last: rest.join(' '), email: `${first}.${rest.join('')}`.toLowerCase().replace(/[^a-z.]/g, '') + '@' + state.settings.domain, role: j?.title || '', dept: j?.dept, location: j?.location || '', start: U.addDays(U.today(), 14) }, () => { c.converted = true; });
    },
    'review': (id) => openReviewModal(id),
    'theme': (_, v) => { state.settings.theme = v; commit(); },
    'ask-reset': () => { $('#reset-confirm').innerHTML = `<div class="confirm-bar"><span style="flex:1">Replace all data with the sample company?</span><button class="btn btn-sm" data-act="cancel-reset">Cancel</button><button class="btn btn-sm btn-danger" data-act="do-reset">Reset</button></div>`; },
    'cancel-reset': () => { $('#reset-confirm').innerHTML = ''; },
    'do-reset': () => { state = AllurusSeed.create(); commit('Workspace reset'); },
    'menu': () => $('#sidebar').classList.toggle('open'),
    ...ACTIONS_EXTRA,
  };

  document.addEventListener('click', (ev) => {
    const scrim = ev.target.closest('[data-scrim]');
    if (scrim && ev.target === scrim) { closeOverlay(); return; }
    const el = ev.target.closest('[data-act]');
    if (!el) {
      if (!ev.target.closest('.sidebar') && !ev.target.closest('.menu-btn')) $('#sidebar').classList.remove('open');
      return;
    }
    // Buttons inside a clickable row should not also open the row.
    const fn = ACTIONS[el.dataset.act];
    if (fn) { ev.preventDefault(); ev.stopPropagation(); fn(el.dataset.id, el.dataset.v); }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { closeOverlay(); $('#search-results').hidden = true; }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); $('#global-search').focus(); }
  });

  // ---------- Global search ----------
  function setupSearch() {
    const input = $('#global-search'), box = $('#search-results');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.hidden = true; return; }
      const hits = state.employees.filter((e) => `${fullName(e)} ${e.role} ${e.email}`.toLowerCase().includes(q)).slice(0, 7);
      box.innerHTML = hits.length ? hits.map((e) => `<button data-act="search-pick" data-id="${e.id}">${person(e)}</button>`).join('') : '<div class="empty" style="padding:14px">No people found</div>';
      box.hidden = false;
    });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    ACTIONS['search-pick'] = (id) => { input.value = ''; box.hidden = true; openProfile(id); };
  }

  // ---------- Finance & Accounting and tax modules ----------
  const moduleCtx = {
    get state() { return state; }, VIEWS, AFTER, ACTIONS, $, $$, esc, icon, money, compactMoney, openModal, closeOverlay, toast, commit, render,
    downloadCSV, role, account, me, LOGO_MARK,
  };
  finApi = AllurusFinance.install(moduleCtx);
  AllurusTax.install(moduleCtx);

  // ---------- Boot ----------
  $('#today').textContent = U.fmtDate(U.today(), { weekday: 'short', month: 'short', day: 'numeric' });
  $('#brand-mark').innerHTML = LOGO_MARK;
  setupSearch();
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  render();
  connectCloud();
})();
