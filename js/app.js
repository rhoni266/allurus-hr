// Allurus HR — single-page app. All data lives in localStorage under STORE_KEY.
(function () {
  'use strict';

  const APP_VERSION = '3.17';
  // Bump the key when the demo data changes shape, so every browser starts fresh.
  // Cloud mode (a Firebase config, and no ?demo in the address) caches its copy under its own key, so the demo
  // company and a real workspace never mix in one browser.
  const CLOUD_ON = !!(window.ALLURUS_FIREBASE && window.ALLURUS_FIREBASE.apiKey) && !/[?&]demo(\b|=)/.test(location.search);
  // Demo mode can show more than one sample company: ?demo or ?demo=serimaju opens Seri Maju, ?demo=suria opens
  // Suria Enterprise. Each has its own storage key (js/seed.js, AllurusSeed.companies).
  const DEMO = AllurusSeed.company((/[?&]demo=([a-z0-9-]+)/i.exec(location.search)?.[1] || 'serimaju').toLowerCase());
  const STORE_KEY = CLOUD_ON ? 'allurus-hr-cloud-v1' : DEMO.storeKey;
  // A fresh copy of the sample data: the chosen demo company, or Seri Maju as the base for the cloud workspace.
  const seedNew = () => (CLOUD_ON ? AllurusSeed.create() : DEMO.create());
  const esc = U.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- State ----------
  let state = load();
  function load() {
    let s = null;
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { /* storage unavailable */ }
    if (!s) { s = seedNew(); if (CLOUD_ON || DEMO.id === 'serimaju') carryOverZones(s); }
    [s.settings, ...Object.values(s.workspaces || {}).map((w) => w.settings)].forEach((st) => {
      if (!st.checkin) st.checkin = defaultZone(st.company);
      const c = st.checkin, city = U.city(st.office);
      // Older versions silently copied the head office city centre into the check-in point. Treat an untouched
      // copy as "not set", so Settings warns instead of measuring check-ins from the middle of the city.
      if (!c.setAt && city && U.hasCoords(c) && Math.abs(c.lat - city.lat) < 1e-4 && Math.abs(c.lng - city.lng) < 1e-4) { c.lat = null; c.lng = null; }
      if (U.hasCoords(c)) { c.lat = +c.lat; c.lng = +c.lng; }
      // Old builds seeded every browser with a placeholder point in Kuantan (3.769833, 103.224556) and no setAt,
      // so employees' phones measured check-ins from there. Replace it with the published point.
      U.applyPublishedZone(st, CLOUD_ON ? AllurusSeed.published : DEMO.published);
    });
    [s, ...Object.values(s.workspaces || {})].forEach(migrateLeave);
    [s, ...Object.values(s.workspaces || {})].forEach(migrateTime);
    [s, ...Object.values(s.workspaces || {})].forEach(migrateStatutory);
    [s, ...Object.values(s.workspaces || {})].forEach(migrateClaims);
    // Notifications, the email outbox, announcements, and the dates the reminders watch.
    [s, ...Object.values(s.workspaces || {})].forEach((w) => {
      w.notifications = w.notifications || []; w.outbox = w.outbox || []; w.announcements = w.announcements || []; w.notifyKeys = w.notifyKeys || [];
      (w.employees || []).forEach((e) => ['probationEnd', 'confirmedOn', 'contractEnd', 'nationality', 'passportNo', 'passportExpiry', 'permitNo', 'permitExpiry'].forEach((k) => { if (e[k] === undefined) e[k] = ''; }));
      (w.reviews || []).forEach((r) => { if (!r.due) { const m = /^(H[12]) (\d{4})/.exec(r.cycle || ''); if (m) r.due = `${m[2]}-${m[1] === 'H1' ? '06' : '12'}-15`; } });
    });
    [s, ...Object.values(s.workspaces || {})].forEach(migrateAppraisal);
    [s, ...Object.values(s.workspaces || {})].forEach(migrateHR);
    // Reports and project costing: saved custom reports, and job groups, jobs and timesheets under projects.
    [s, ...Object.values(s.workspaces || {})].forEach((w) => { w.savedReports = w.savedReports || []; w.costing = { groups: [], jobs: [], timesheets: [], ...(w.costing || {}) }; w.projects = w.projects || []; });
    [s, ...Object.values(s.workspaces || {})].forEach((w) => {
      const c = w.settings?.checkin; if (!c) return;
      c.kiosks = c.kiosks || []; if (c.supervisor === undefined) c.supervisor = true; c.projects = c.projects || 'off';
      w.projects = w.projects || [];
    });
    if (!s.finance) s.finance = AllurusFinance.blank();
    Object.values(s.workspaces || {}).forEach((w) => { if (!w.finance) w.finance = AllurusFinance.blank(); });
    [s, ...Object.values(s.workspaces || {})].forEach(migrateEInvoice);
    [s, ...Object.values(s.workspaces || {})].forEach(migrateTalent);
    s.reliefs = s.reliefs || {}; s.taxProfiles = s.taxProfiles || {};
    // Employee imports: the log (with what undo needs) and remembered column mappings. Admins only.
    [s, ...Object.values(s.workspaces || {})].forEach((w) => { w.importData = w.importData || { logs: [], mappings: [] }; });
    [s, ...Object.values(s.workspaces || {})].forEach((w) => { w.claims = w.claims || []; w.plans = w.plans || {}; });
    return s;
  }
  // e-Leave: older saved data gets leave settings, type ids, approval chains, carry-forward and credits.
  function migrateLeave(ws) {
    const LEGACY_LEAVE_TYPES = { Annual: 'annual', Sick: 'sick', Personal: 'emergency', Parental: 'paternity', Unpaid: 'unpaid' };
    const st = ws.settings, L = AllurusLeaveRules;
    if (!st) return;
    if (!st.leave) {
      const stateName = st.company === AllurusSeed.published.company ? 'Terengganu' : st.currency === 'MYR' ? (st.headOffice?.countryCode === 'MY' && st.headOffice.state) || L.CITY_STATE[st.office] || '' : '';
      st.leave = L.defaultSettings({ state: stateName, departments: ws.departments || [], hr: (ws.employees || [])[0]?.id || '' });
      // Keep a flat annual allowance the company had set, if it meets the statutory minimum.
      if (st.annualDays >= 8) Object.assign(st.leave.types.find((t) => t.id === 'annual'), { byService: false, days: st.annualDays });
    }
    st.leave.types = st.leave.types || L.defaultTypes();
    st.leave.chains = st.leave.chains || {};
    (ws.employees || []).forEach((e) => { if (e.gender === undefined) e.gender = ''; if (e.married === undefined) e.married = false; });
    ws.leaveCarry = ws.leaveCarry || {};
    ws.leaveCredits = ws.leaveCredits || [];
    (ws.leaves || []).forEach((l) => {
      if (LEGACY_LEAVE_TYPES[l.type]) l.type = LEGACY_LEAVE_TYPES[l.type];
      if (l.half === undefined) l.half = '';
      if (!l.chain) {
        const e = (ws.employees || []).find((x) => x.id === l.empId);
        l.chain = l.status === 'Pending' && e ? L.buildChain({ applicant: e.id, chain: st.leave.chains[e.dept], hr: st.leave.hr, hrBackup: st.leave.hrBackup }) : [];
      }
    });
  }
  // Appraisals: templates and grade bands, review cycles, goals and pay changes. Older single-rating reviews become
  // a cycle each, keeping their status, rating and notes.
  function migrateAppraisal(ws) {
    const A = AllurusAppraisalRules, st = ws.settings;
    if (!st) return;
    st.appraisal = st.appraisal || { templates: [A.defaultTemplate()], bands: A.defaultBands(), peerMin: 2 };
    if (!st.appraisal.templates?.length) st.appraisal.templates = [A.defaultTemplate()];
    st.appraisal.bands = st.appraisal.bands || A.defaultBands();
    if (st.appraisal.peerMin == null) st.appraisal.peerMin = 2;
    ws.cycles = ws.cycles || []; ws.goals = ws.goals || []; ws.payChanges = ws.payChanges || [];
    (ws.reviews || []).filter((r) => !r.cycleId).forEach((r) => {
      const name = r.cycle || 'Review', id = 'cy-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      let c = ws.cycles.find((x) => x.id === id);
      if (!c) {
        const m = /^(H[12]) (\d{4})/.exec(name), y = m ? +m[2] : +U.today().slice(0, 4), h2 = !m || m[1] === 'H2';
        const due = r.due || `${y}-${h2 ? '12' : '06'}-15`;
        c = { id, name, start: `${y}-${h2 ? '07' : '01'}-01`, end: `${y}-${h2 ? '12-31' : '06-30'}`, templateId: st.appraisal.templates[0].id, selfDue: due, managerDue: U.addDays(due, 14), hrDue: U.addDays(due, 28), l2: false, peers: false, maxPeers: 3, effective: `${h2 ? y + 1 : y}-${h2 ? '01' : '07'}-01`, bonusMonth: `${y}-${h2 ? '12' : '06'}`, status: 'Open', launched: `${y}-${h2 ? '07' : '01'}-01`, by: '' };
        ws.cycles.push(c);
      }
      Object.assign(r, { cycleId: c.id, templateId: c.templateId, stage: r.status === 'Completed' ? 'done' : 'self', self: r.status === 'In progress' ? { scores: {}, comment: '', draftAt: new Date().toISOString() } : null, l1: null, l2: null, hr: null, peers: [] });
      if (r.status === 'Completed' && r.rating) r.final = { score: r.rating, grade: A.grade(r.rating, st.appraisal.bands)?.code || '', pct: r.rating * 20 };
      else r.final = null;
    });
  }
  // HR admin: checklist and letter templates, the employee file fields, and the registers.
  function migrateHR(ws) {
    const H = AllurusHRRules, st = ws.settings;
    if (!st) return;
    st.hr = st.hr || {};
    st.hr.onboarding = st.hr.onboarding || H.defaultOnboarding();
    st.hr.offboarding = st.hr.offboarding || H.defaultOffboarding();
    st.hr.letters = st.hr.letters || H.defaultLetters();
    ['it', 'payroll'].forEach((k) => { if (st.hr[k] === undefined) st.hr[k] = ''; });
    ['editRequests', 'checklists', 'assets', 'loans', 'insurance', 'documents'].forEach((k) => { ws[k] = ws[k] || []; });
    (ws.employees || []).forEach((e) => {
      ['address', 'personalEmail'].forEach((k) => { if (e[k] === undefined) e[k] = ''; });
      e.emergency = e.emergency || { name: '', relation: '', phone: '' };
      ['education', 'employment'].forEach((k) => { e[k] = e[k] || []; });
      if (!e.career) e.career = e.start ? [{ id: 'cr-' + e.id, date: e.start, type: 'joined', to: e.role, note: (ws.departments || []).find((d) => d.id === e.dept)?.name || '' }] : [];
    });
  }
  // e-Invoice: company details, customers and suppliers from the names already on invoices and bills, and an
  // e-Invoice status on every invoice, note and self-billed bill.
  function migrateEInvoice(ws) {
    if (!ws.settings || !ws.finance) return;
    ws.settings.einvoice = ws.settings.einvoice || AllurusEInvoice.blankCompany(ws.settings);
    const f = ws.finance;
    f.contacts = f.contacts || [];
    const add = (kind, name, email = '') => {
      if (!name || f.contacts.some((c) => c.kind === kind && c.name === name)) return;
      f.contacts.push({ id: 'ct-' + kind[0] + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind, name, tin: '', idType: 'BRN', idNo: '', sst: 'NA', email, phone: '', contactName: '', address: { line1: '', line2: '', line3: '', city: '', postcode: '', state: '', country: 'MYS' } });
    };
    f.invoices.forEach((i) => { i.type = i.type || 'invoice'; i.einvoice = i.einvoice || { status: 'Draft' }; if ((i.type === 'invoice')) add('customer', i.customer, i.email); i.items.forEach((it) => { it.classification = it.classification || '022'; }); });
    f.bills.forEach((b) => { add('supplier', b.supplier); if (b.selfBilled) b.einvoice = b.einvoice || { status: 'Draft' }; });
    [...f.invoices, ...f.bills].forEach((r) => { if (!r.contactId) { const c = f.contacts.find((x) => x.name === (r.customer || r.supplier)); if (c) r.contactId = c.id; } });
  }
  // Talent: requisitions, job posts and careers page, interviews and offers, training, grievances and rooms.
  function migrateTalent(ws) {
    if (!ws.settings) return;
    const d = AllurusSeed.talentDefaults();
    ws.settings.recruit = { ...d.recruit, ...(ws.settings.recruit || {}) };
    ws.settings.grievance = { ...d.grievance, ...(ws.settings.grievance || {}) };
    ws.settings.training = { window: 60, ...(ws.settings.training || {}) };
    ['requisitions', 'courses', 'enrolments', 'trainingRequests', 'grievances', 'rooms', 'bookings'].forEach((k) => { ws[k] = ws[k] || []; });
    ws.jobs = ws.jobs || []; ws.candidates = ws.candidates || [];
    ws.jobs.forEach((j) => { if (j.published === undefined) j.published = false; j.description = j.description || {}; j.boards = j.boards || {}; });
    ws.candidates.forEach((c) => { c.stageDates = c.stageDates || { Applied: c.applied }; c.source = c.source || ''; c.interviews = c.interviews || []; c.offers = c.offers || []; });
  }
  // A new company has no check-in point until the admin sets one. Until then check-ins are blocked
  // and Settings shows a warning. The city centre is only used to centre the map picker.
  function defaultZone(company) {
    return { label: `${company} office`, lat: null, lng: null, radius: 50, remote: false };
  }
  // When the storage key changes, keep each company's saved check-in point from the previous version.
  function carryOverZones(s) {
    for (let v = 8; v >= 1; v--) {
      let old = null;
      try { old = JSON.parse(localStorage.getItem(`allurus-hr-v${v}`) || 'null'); } catch (e) { /* unreadable */ }
      if (!old) continue;
      const zones = { [old.session?.tenantId || 't1']: old.settings?.checkin };
      Object.entries(old.workspaces || {}).forEach(([tid, w]) => { zones[tid] = w.settings?.checkin; });
      const keep = zones[s.session.tenantId];
      if (keep && U.hasCoords(keep)) s.settings.checkin = { ...s.settings.checkin, ...keep, setAt: keep.setAt || Date.now() };
      return;
    }
  }
  // Cloud mode: js/firebase-config.js holds a Firebase web config. Sign-in and data then go through js/cloud.js.
  // Adding ?demo to the address keeps the sample company in this browser, for presentations and trials.
  const CLOUD = CLOUD_ON;
  const CAN_CLOUD = !!(window.ALLURUS_FIREBASE && window.ALLURUS_FIREBASE.apiKey);
  const fire = () => (CLOUD ? window.AllurusCloud : null);
  // A signed-in cloud user reopening the app waits for the workspace to load before seeing it.
  let cloudWaiting = CLOUD && !!state.session.cloud && !!state.session.account;
  let warnedFull = false;
  function save() {
    saveLocal();
    fire()?.changed();
    // Demo mode: share a new check-in point with the other phones (set up further down, so not during start-up).
    try { demoZone.publish(); } catch (e) { /* not set up yet */ }
    // Settings shows "Saved 10:02", and nothing typed is left unsaved.
    try { if (route() === 'settings') { stUi.dirty = false; stUi.savedAt = Date.now(); const el = $('#st-saved'); if (el) el.textContent = `Saved ${new Date(stUi.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; } } catch (e) { /* not set up yet */ }
  }
  function saveLocal() {
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
    payMonth: U.monthKey(U.today()), jobFilter: 'all',
    tenantQuery: '', tenantStatus: 'all',
  };

  // ---------- Icons ----------
  const ICONS = {
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
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
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17.2v.1"/>',
    chart: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
    layers: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    org: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    starFill: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.3-3.2 3.6M6.4 7.6C4.6 8.9 3.2 10.7 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
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
  const onLeaveOn = (id, day) => (leaveApi ? leaveApi.onLeave(id, day) : false);
  const empStatus = (e) => e.status !== 'Active' ? 'Inactive' : onLeaveOn(e.id, U.today()) ? 'On leave' : 'Active';
  const statusPill = (s) => `<span class="pill ${({ Active: 'ok', 'On leave': 'gold', Inactive: '' })[s] ?? ''}">${esc(s)}</span>`;
  const leavePill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'ok', Rejected: 'bad' })[s]}">${s}</span>`;
  const pendingLeaves = () => state.leaves.filter((l) => l.status === 'Pending');
  // Days of a leave type used this year (type ids: annual, sick, …).
  const leaveUsed = (id, type) => (leaveApi ? leaveApi.balance(id, type).used : 0);
  function dayStats(day) {
    const rec = state.attendance[day] || {};
    const c = { present: 0, remote: 0, absent: 0, leave: 0, none: 0 };
    activeEmployees().filter((e) => e.start <= day).forEach((e) => { const r = rec[e.id]; c[r ? r.s : 'none']++; });
    c.total = c.present + c.remote + c.absent + c.leave + c.none;
    return c;
  }
  // Time attendance: working patterns, overtime and allowance rules, rosters, requests and the audit trail.
  function migrateTime(ws) {
    const st = ws.settings, TR = AllurusTimeRules;
    if (!st) return;
    const d = TR.defaultSettings({ restDays: AllurusLeaveRules.weekendDays(st.leave) });
    st.time = st.time || d;
    const t = st.time;
    t.patterns = t.patterns || d.patterns;
    t.deptPattern = t.deptPattern || {};
    t.minStaff = t.minStaff || {};
    t.templates = t.templates || [];
    t.ot = { ...d.ot, ...(t.ot || {}) };
    t.allowances = t.allowances || d.allowances;
    if (t.autoShift === undefined) t.autoShift = true;
    ws.rosters = ws.rosters || {};
    ws.timeRequests = ws.timeRequests || [];
    ws.attAudit = ws.attAudit || [];
    (ws.employees || []).forEach((e) => { if (e.timePattern === undefined) e.timePattern = ''; });
  }
  // Statutory documents: employer registration numbers, employee IDs and bank details, and what has been submitted.
  function migrateStatutory(ws) {
    if (!ws.settings) return;
    ws.settings.employer = ws.settings.employer || {};
    ws.statutory = ws.statutory || {};
    ['filed', 'eaIssued', 'formEFiled'].forEach((k) => { ws.statutory[k] = ws.statutory[k] || {}; });
    (ws.employees || []).forEach((e) => {
      ['idType', 'ic', 'epfNo', 'socsoNo', 'taxNo', 'bank', 'accountNo', 'endDate', 'leaveReason', 'leaverFiled'].forEach((k) => { if (e[k] === undefined) e[k] = k === 'idType' ? 'mykad' : ''; });
      // People already on staff before this update are not new joiners.
      if (e.cp22Filed === undefined) e.cp22Filed = e.start || '';
    });
  }
  // Claims: medical-only claims become one-line claims in the Medical category; categories and mileage rates are added.
  function migrateClaims(ws) {
    if (!ws.settings) return;
    const R = AllurusClaimRules, d = AllurusClaims.policyDefaults();
    const p = ws.settings.claims = ws.settings.claims || d;
    p.types = p.types || d.types;
    p.categories = p.categories || R.defaultCategories();
    p.mileage = p.mileage || R.defaultMileage();
    const lv = ws.settings.leave;
    ws.claims = (ws.claims || []).map((c) => {
      const n = R.migrateLegacy(c, p.types);
      if (n.status === 'Pending' && !(n.chain || []).length && lv) {
        const e = (ws.employees || []).find((x) => x.id === n.empId);
        if (e) n.chain = AllurusLeaveRules.buildChain({ applicant: e.id, chain: lv.chains?.[e.dept], hr: lv.hr, hrBackup: lv.hrBackup });
      }
      return n;
    });
  }
  const PAY_KEYS = ['gross', 'tax', 'benefits', 'net', 'epf', 'socso', 'eis', 'zakat', 'erEpf', 'erSocso', 'erEis', 'hrdf', 'erCost', 'claims', 'extras'];
  const payTotal = (run) => run.items.reduce((a, i) => { PAY_KEYS.forEach((k) => { a[k] = U.round2(a[k] + (i[k] || 0)); }); return a; }, Object.fromEntries(PAY_KEYS.map((k) => [k, 0])));

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
      { id: 'my-deliveries', label: 'My deliveries', icon: 'pin', group: 'Me' },
      { id: 'my-machines', label: 'Machines', icon: 'sliders', group: 'Me' },
      { id: 'pos', label: 'Till', icon: 'receipt', group: 'Point of sale' },
      { id: 'pos-tables', label: 'Tables', icon: 'grip', group: 'Point of sale' },
      { id: 'pos-kitchen', label: 'Kitchen display', icon: 'clock', group: 'Point of sale' },
      { id: 'pos-shift', label: 'Shift & cash', icon: 'wallet', group: 'Point of sale' },
      { id: 'my-time', label: 'My attendance', icon: 'clock', group: 'Me' },
      { id: 'my-leave', label: 'My time off', icon: 'calendar', group: 'Me' },
      { id: 'my-approvals', label: 'Approvals', icon: 'check', group: 'Me' },
      { id: 'my-appraisal', label: 'Appraisal & goals', icon: 'trend', group: 'Me' },
      { id: 'my-timesheet', label: 'Timesheet', icon: 'layers', group: 'Me' },
      { id: 'my-training', label: 'My training', icon: 'book', group: 'Me' },
      { id: 'my-concerns', label: 'Raise a concern', icon: 'shield', group: 'Me' },
      { id: 'grievances', label: 'Grievance desk', icon: 'shield', group: 'Me' },
      { id: 'my-profile', label: 'Profile', icon: 'people', group: 'Me' },
      { id: 'my-pay', label: 'Payslips', icon: 'wallet', group: 'Finance' },
      { id: 'my-claims', label: 'Claims', icon: 'receipt', group: 'Finance' },
      { id: 'my-tax', label: 'Tax reliefs', icon: 'percent', group: 'Finance' },
      { id: 'my-plan', label: 'Financial planner', icon: 'target', group: 'Finance' },
      { id: 'news', label: 'Announcements', icon: 'doc', group: 'Company' },
      { id: 'org-chart', label: 'Org chart', icon: 'org', group: 'Company' },
      { id: 'rooms', label: 'Meeting rooms', icon: 'calendar', group: 'Company' },
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

  // ---------- Access: what each person may do in the company console ----------
  // "Company Admin" is one view, but people get only the areas their role template gives them. An account with
  // no `perms` (the founder, older accounts, the platform owner) has every area, like an Owner.
  const AREAS = {
    people: 'Staff records, onboarding, assets, org chart',
    time: 'Attendance, schedules, leave and overtime',
    payroll: 'Payroll, statutory files, pay changes, loans',
    claims: 'Claims',
    finance: 'Books, invoices, bills, budget, tax, audit',
    talent: 'Hiring, appraisals, training, grievances',
    operations: 'Stock, purchasing, production, deliveries, machines',
    pos: 'Point of sale: till, tables, kitchen, menu and sales',
    settings: 'Company settings and team access',
  };
  const ALL_AREAS = Object.keys(AREAS);
  const TEMPLATES = {
    owner: { label: 'Owner', desc: 'Everything, including the books and who has access', perms: ALL_AREAS },
    hr: { label: 'HR admin', desc: 'People, time, payroll, claims, hiring and settings. Sees salaries.', perms: ['people', 'time', 'payroll', 'claims', 'talent', 'settings'] },
    payroll: { label: 'Payroll', desc: 'Staff records, attendance, payroll and claims', perms: ['people', 'time', 'payroll', 'claims'] },
    finance: { label: 'Finance', desc: 'The books and claims. No staff records or payroll detail.', perms: ['finance', 'claims'] },
    // For a company that makes and delivers (a workspace with operations data); hidden elsewhere.
    operations: { label: 'Operations', desc: 'Stock, purchasing, production, deliveries and machines', perms: ['operations'], ops: true },
    outlet: { label: 'Outlet manager', desc: 'Runs the outlet: the till, menu, voids, shifts and sales reports, plus stock', perms: ['pos', 'operations', 'time'], pos: true },
    manager: { label: 'Admin manager', desc: 'Runs the office and the floor: everything but hiring and appraisals', perms: ['people', 'time', 'payroll', 'claims', 'finance', 'operations', 'settings'], ops: true },
  };
  const shownTemplates = () => Object.entries(TEMPLATES).filter(([, t]) => (!t.ops || state.ops) && (!t.pos || state.pos));
  const templateOf = (perms) => (!perms ? 'owner' : Object.keys(TEMPLATES).find((k) => TEMPLATES[k].perms.length === perms.length && TEMPLATES[k].perms.every((x) => perms.includes(x))) || 'custom');
  const ROUTE_AREA = {
    employees: 'people', departments: 'people', onboarding: 'people', assets: 'people', 'org-chart': 'people', rooms: 'people', announcements: 'people', 'hr-reports': 'people',
    attendance: 'time', schedule: 'time', leave: 'time',
    payroll: 'payroll', claims: 'claims',
    finance: 'finance', books: 'finance', invoices: 'finance', bills: 'finance', contacts: 'finance', budget: 'finance', tax: 'finance', reports: 'finance', projects: 'payroll',
    recruitment: 'talent', performance: 'talent', training: 'talent', grievances: 'talent',
    'ops-today': 'operations', 'ops-stock': 'operations', 'ops-production': 'operations', 'ops-sales': 'operations', 'ops-machines': 'operations',
    pos: 'pos', 'pos-tables': 'pos', 'pos-kitchen': 'pos', 'pos-shift': 'pos', 'pos-menu': 'pos', 'pos-reports': 'pos',
  };
  const myPerms = () => { const a = account(); return a && Array.isArray(a.perms) ? a.perms : null; };
  // Whether the person may work in an area of the company console (only ever in Company Admin view).
  // Also off when the company's industries don't include that area (window.AllurusFeatures, set by cloud.js).
  const can = (area) => role() === 'admin' && (!myPerms() || myPerms().includes(area)) && (!window.AllurusFeatures || (area === 'pos' ? window.AllurusFeatures.has('pos') : window.AllurusFeatures.area(area)));
  window.AllurusAccess = { can, AREAS, TEMPLATES, templateOf };
  // "HR admin", "Finance", "Owner"… for the company console; the role's own name otherwise.
  const roleLabel = (r) => (r === 'admin' && myPerms() ? TEMPLATES[templateOf(myPerms())]?.label || 'Company Admin' : ROLES[r]?.label || r);
  ROLE_ROUTES.admin = [
    { id: 'ops-today', label: 'Operations today', icon: 'chart', group: 'Overview' },
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Overview' },
    { id: 'ops-stock', label: 'Stock & purchasing', icon: 'box', group: 'Operations' },
    { id: 'ops-production', label: 'Production', icon: 'layers', group: 'Operations' },
    { id: 'ops-sales', label: 'Sales & delivery', icon: 'pin', group: 'Operations' },
    { id: 'ops-machines', label: 'Machines', icon: 'sliders', group: 'Operations' },
    { id: 'pos', label: 'Till', icon: 'receipt', group: 'Point of sale' },
    { id: 'pos-tables', label: 'Tables', icon: 'grip', group: 'Point of sale' },
    { id: 'pos-kitchen', label: 'Kitchen display', icon: 'clock', group: 'Point of sale' },
    { id: 'pos-shift', label: 'Shift & cash', icon: 'wallet', group: 'Point of sale' },
    { id: 'pos-menu', label: 'Menu & settings', icon: 'book', group: 'Point of sale' },
    { id: 'pos-reports', label: 'Sales reports', icon: 'chart', group: 'Point of sale' },
    { id: 'employees', label: 'Employees', icon: 'people', group: 'Workforce' },
    { id: 'departments', label: 'Departments', icon: 'building', group: 'Workforce' },
    { id: 'onboarding', label: 'Onboarding', icon: 'userplus', group: 'Workforce' },
    { id: 'assets', label: 'Assets & loans', icon: 'box', group: 'Workforce' },
    { id: 'org-chart', label: 'Org chart', icon: 'org', group: 'Workforce' },
    { id: 'rooms', label: 'Meeting rooms', icon: 'calendar', group: 'Workforce' },
    { id: 'announcements', label: 'Announcements', icon: 'doc', group: 'Workforce' },
    { id: 'attendance', label: 'Attendance', icon: 'clock', group: 'Time' },
    { id: 'schedule', label: 'Schedule', icon: 'grip', group: 'Time' },
    { id: 'leave', label: 'Time off', icon: 'calendar', group: 'Time' },
    { id: 'finance', label: 'Overview', icon: 'coins', group: 'Finance & Accounting' },
    { id: 'books', label: 'Bookkeeping', icon: 'book', group: 'Finance & Accounting' },
    { id: 'invoices', label: 'Invoices', icon: 'doc', group: 'Finance & Accounting' },
    { id: 'bills', label: 'Bills', icon: 'receipt', group: 'Finance & Accounting' },
    { id: 'contacts', label: 'Customers & suppliers', icon: 'building', group: 'Finance & Accounting' },
    { id: 'payroll', label: 'Payroll', icon: 'wallet', group: 'Finance & Accounting' },
    { id: 'claims', label: 'Claims', icon: 'receipt', group: 'Finance & Accounting' },
    { id: 'budget', label: 'Budget', icon: 'target', group: 'Finance & Accounting' },
    { id: 'tax', label: 'Tax (LHDN)', icon: 'percent', group: 'Finance & Accounting' },
    { id: 'guide', label: 'Statutory & Claim Guide', icon: 'shield', group: 'Finance & Accounting' },
    { id: 'reports', label: 'Reports & audit', icon: 'shield', group: 'Finance & Accounting' },
    { id: 'recruitment', label: 'Recruitment', icon: 'briefcase', group: 'Talent' },
    { id: 'performance', label: 'Performance', icon: 'trend', group: 'Talent' },
    { id: 'training', label: 'Training', icon: 'book', group: 'Talent' },
    { id: 'grievances', label: 'Grievances', icon: 'shield', group: 'Talent' },
    { id: 'hr-reports', label: 'HR reports', icon: 'chart', group: 'Insights' },
    { id: 'projects', label: 'Project costing', icon: 'layers', group: 'Insights' },
    { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Workspace' },
    { id: 'billing', label: 'Billing', icon: 'doc', group: 'Workspace' },
  ];
  const routes = () => (ROLE_ROUTES[role()] || []).filter((r) => (r.id !== 'billing' || (CLOUD && (!myPerms() || myPerms().includes('settings')))) && (role() !== 'admin' || !ROUTE_AREA[r.id] || can(ROUTE_AREA[r.id])) && (r.id !== 'my-claims' || claimsApi?.enabled()) && (r.id !== 'my-approvals' || leaveApi?.isApprover(me()?.id) || hrApi?.hasTasks(me()?.id) || recruitApi?.hasTasks(me()?.id) || lmsApi?.hasTasks(me()?.id)) && (r.id !== 'grievances' || role() === 'admin' || grievApi?.isManager(me()?.id)) && (r.id !== 'my-timesheet' || costingApi?.hasProjects()) && (opsApi ? opsApi.routeAllowed(r.id) : !/^(ops-|my-deliveries|my-machines)/.test(r.id)) && (posApi ? posApi.routeAllowed(r.id) : !/^pos(-|$)/.test(r.id)));
  // A page may carry a query after "?" (#ops-stock?po=…); it is the page's to read.
  const route = () => { const h = location.hash.replace('#', '').split('?')[0].replace(/^settings\/.*/, 'settings'); const rs = routes(); return rs.some((r) => r.id === h) ? h : rs[0].id; };

  function renderNav() {
    let html = '', group = '';
    const rs = routes(), pinned = AllurusUX.pins().map((id) => rs.find((r) => r.id === id)).filter(Boolean);
    const navItem = (r) => {
      const count = r.id === 'my-approvals' ? leaveApi.myCount(me().id) + timeApi.myCount(me().id) + claimsApi.myCount(me().id) + (recruitApi?.taskCount(me().id) || 0) : r.id === 'training' ? lmsApi?.pendingCount() || 0 : r.id === 'my-training' ? lmsApi?.todoCount(me().id) || 0 : r.id === 'grievances' ? grievApi?.badge() || 0 : r.id === 'recruitment' ? recruitApi?.badge() || 0 : r.id === 'leave' ? pendingLeaves().length : r.id === 'attendance' ? securityQueue().count : r.id === 'claims' ? claimsApi.pendingCount() : r.id === 'employees' ? hrApi?.pendingCount() || 0 : r.id === 'onboarding' ? hrApi?.overdueCount() || 0 : r.id === 'performance' || r.id === 'my-appraisal' ? appraisalApi?.badge(r.id) || 0 : r.id === 'companies' ? state.platform.tenants.filter((t) => t.status === 'Past due').length : (finApi?.badge(r.id) || opsApi?.badge(r.id) || posApi?.badge(r.id) || 0);
      const on = AllurusUX.pins().includes(r.id), cur = route() === r.id;
      return `<div class="nav-item"><a href="#${r.id}" class="${cur ? 'active' : ''}" ${cur ? 'aria-current="page"' : ''}>${icon(r.icon)}<span>${r.label}</span>${count ? `<span class="count" aria-label="${count} waiting">${count}</span>` : ''}</a><button type="button" class="nav-pin ${on ? 'on' : ''}" data-act="ux-pin" data-id="${r.id}" aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(r.label)}" title="${on ? 'Unpin' : 'Pin to top'}">${icon(on ? 'starFill' : 'star')}</button></div>`;
    };
    if (pinned.length) html += `<div class="nav-label">Pinned</div>${pinned.map(navItem).join('')}`;
    rs.forEach((r) => {
      if (r.group !== group) { group = r.group; html += `<div class="nav-label">${group}</div>`; }
      html += navItem(r);
    });
    $('#nav').innerHTML = html;
    $('#company-name').textContent = role() === 'super' ? 'Platform console' : state.settings.company;
    const who = role() === 'super' ? { name: 'You', sub: 'Super Admin' } : role() === 'admin' ? { name: fullName(me()), sub: `${roleLabel('admin')} · ${state.settings.company}` } : { name: fullName(me()), sub: me().role };
    const acct = account();
    if (role() === 'super') { who.name = acct?.name || 'Allurus HQ'; who.sub = 'Super Admin'; }
    if (role() === 'admin' && acct?.roles.includes('super')) who.name = acct.name || who.name;
    if (role() === 'auditor') { who.name = acct?.name || 'Auditor'; who.sub = 'Auditor'; }
    $('#me-card').innerHTML = `<div class="me-row">${avatar(who.name, 'sm')}<div style="min-width:0;flex:1"><div class="me-name">${esc(who.name)}</div><div class="me-role">${esc(acct?.email || who.sub)}</div></div></div>
      <div class="me-actions">${state.session.roles.length > 1 ? `<select class="select" id="role-switch" aria-label="Switch view">${state.session.roles.map((r) => `<option value="${r}" ${r === role() ? 'selected' : ''}>${roleLabel(r)} view</option>`).join('')}</select>` : `<span class="pill brand">${roleLabel(role())}</span>`}<button class="btn btn-sm btn-ghost" data-act="logout">Sign out</button></div>`;
    $('#role-switch')?.addEventListener('change', (ev) => switchRole(ev.target.value));
  }

  function switchRole(r) {
    state.session.role = r; save();
    if (location.hash) location.hash = ''; else render();
    toast(`Switched to ${ROLES[r].label} view`);
  }
  let navigated = false;
  function render() {
    applyTheme();
    // Rest days follow the company's leave settings (Friday–Saturday in Kedah, Kelantan and Terengganu).
    if (state.settings.leave) U.setWeekend(AllurusLeaveRules.weekendDays(state.settings.leave));
    // A device set up as a check-in kiosk shows only the kiosk, signed in or not.
    if (kioskApi?.kioskOn()) { kioskApi.renderKiosk(); return; }
    // The public careers page (#careers/<company>/<role>) needs no sign-in.
    const careers = /^#careers\/([^/]+)(?:\/(.+))?/.exec(location.hash);
    $('#login').classList.toggle('is-careers', !!careers);
    if (careers) { $('#login').hidden = false; $('.app').hidden = true; $('#login').innerHTML = recruitApi.careersPage(careers[1], careers[2] || ''); recruitApi.bindCareers(careers[1], careers[2] || ''); document.title = `Careers · ${recruitApi.tenantName(careers[1]) || 'Allurus'}`; return; }
    if (cloudWaiting) { $('#login').hidden = false; $('.app').hidden = true; $('#login').innerHTML = `<div class="login-inner"><div class="login-brand">${LOGO_MARK.replace('width="30" height="30"', 'width="56" height="56"')}</div><h1>Loading your workspace…</h1><p class="sub">Getting the latest from the cloud.</p></div>`; return; }
    const signedIn = !!role();
    $('#login').hidden = signedIn;
    $('.app').hidden = !signedIn;
    if (!signedIn) { $('#login').innerHTML = loginView(); bindLogin(); return; }
    // A link to an Operations page of the person's other view (a notification opened in the employee app)
    // switches to that view.
    const want = location.hash.slice(1).split('?')[0];
    if (/^ops-/.test(want) && !routes().some((x) => x.id === want)) {
      const was = state.session.role, other = state.session.roles.find((x) => x !== was && (ROLE_ROUTES[x] || []).some((rr) => rr.id === want));
      if (other) { state.session.role = other; if (routes().some((x) => x.id === want)) save(); else state.session.role = was; }
    }
    const r = route();
    AllurusUX.beforeRender(r);
    renderNav();
    const view = $('#view');
    // Super Admin and auditor pages have no dashboard, so their setup checklist sits on their first page.
    const setup = ['super', 'auditor'].includes(role()) && r === routes()[0].id ? AllurusUX.setupCard() : '';
    view.innerHTML = billingUi.banner() + (r === routes()[0].id ? billingUi.checklist() : '') + setup + VIEWS[r]();
    AFTER[r]?.();
    $('#sidebar').classList.remove('open');
    AllurusUX.afterRender(r, navigated);
    navigated = false;
    checkLocationGate();
    if (r !== 'settings' && zonePicker) { zonePicker.destroy(); zonePicker = null; }
    applySetupLink();
    // Daily reminders run once a day on the first load; the bell shows the unread count.
    notifyApi?.runReminders();
    notifyApi?.updateBell();
  }

  // ---------- Views ----------
  const VIEWS = {};
  const AFTER = {};
  const ACTIONS_EXTRA = {};
  let finApi = null, claimsApi = null, leaveApi = null, timeApi = null, docsApi = null, kioskApi = null, notifyApi = null, appraisalApi = null, hrApi = null, costingApi = null, einvApi = null, recruitApi = null, lmsApi = null, grievApi = null, roomsApi = null, opsApi = null, posApi = null;
  let clockTimer = null;

  // ---------- Automated insights (what needs attention, trends and wellbeing nudges) ----------
  const MS_DAY = 86400000;
  const daysUntil = (day) => Math.round((U.parse(day) - U.parse(U.today())) / MS_DAY);
  function insights() {
    const r = role(), T = U.today(), out = [], h = new Date().getHours();
    const add = (tone, ic, title, detail, action, prio = 1) => out.push({ tone, icon: ic, title, detail, action, prio });
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (r === 'admin') {
      const pend = pendingLeaves();
      if (pend.length && can('time')) add('warn', 'calendar', `${plural(pend.length, 'time-off request', 'time-off requests')} waiting`, 'Decide soon so people can plan their break.', { label: 'Review', href: '#leave' }, 3);
      const cl = claimsApi?.enabled() ? claimsApi.pendingCount() : 0;
      if (cl && can('claims')) add('warn', 'receipt', `${plural(cl, 'claim', 'claims')} waiting for approval`, 'Approved claims are paid with the next payroll.', { label: 'Review', href: '#claims' }, 3);
      const sec = securityQueue().count;
      if (sec && can('time')) add('bad', 'shield', `${plural(sec, 'check-in needs', 'check-ins need')} a look`, 'A face mismatch, an uploaded photo or a new phone.', { label: 'Check', href: '#attendance' }, 4);
      const days = []; let d = U.addDays(T, -1);
      while (days.length < 7) { if (!U.isWeekend(d)) days.push(d); d = U.addDays(d, -1); }
      const rateOf = (day) => { const s = dayStats(day); return s.total ? ((s.present + s.remote) / s.total) * 100 : 0; };
      const avg = days.reduce((s, x) => s + rateOf(x), 0) / days.length;
      if (!U.isWeekend(T) && can('time')) {
        const now = rateOf(T);
        if (h >= 11) add(now >= avg - 5 ? 'good' : 'warn', 'clock', `Attendance today is ${Math.round(now)}%`, `Your 7-day average is ${Math.round(avg)}%.`, { label: 'See who’s in', href: '#attendance' }, now >= avg - 5 ? 0 : 2);
        else add('info', 'clock', `${plural(dayStats(T).present + dayStats(T).remote, 'person has', 'people have')} checked in`, `By the end of the day ${Math.round(avg)}% are usually in.`, { label: 'Attendance', href: '#attendance' }, 0);
      }
      const mk = U.monthKey(T), run = state.payroll[mk], left = daysUntil(U.lastWorkday(U.monthEnd(mk)));
      if (!can('payroll')) { /* payroll reminders are for payroll staff */ }
      else if (!run && left <= 10) add('warn', 'wallet', `${U.fmtMonth(mk, { month: 'long' })} payroll isn’t run yet`, `Payday is in ${plural(Math.max(0, left), 'day', 'days')}.`, { label: 'Run payroll', href: '#payroll' }, 3);
      else if (run?.status === 'Draft') add('info', 'wallet', 'A payroll draft is waiting', 'Check bonuses, then approve and pay.', { label: 'Open', href: '#payroll' }, 2);
      const paid = Object.keys(state.payroll).filter((k) => state.payroll[k].status === 'Paid').sort();
      if (paid.length >= 2 && can('payroll')) {
        const a = payTotal(state.payroll[paid[paid.length - 2]]), b = payTotal(state.payroll[paid[paid.length - 1]]);
        const ca = a.gross + a.erCost, cb = b.gross + b.erCost, ch = ca ? ((cb - ca) / ca) * 100 : 0;
        add(Math.abs(ch) < 3 ? 'info' : ch > 0 ? 'warn' : 'good', 'trend', `Payroll cost ${ch >= 0 ? 'up' : 'down'} ${Math.abs(ch).toFixed(1)}%`, `${U.fmtMonth(paid[paid.length - 1], { month: 'long' })} cost ${money(cb)} with employer contributions.`, { label: 'Payroll', href: '#payroll' }, 0);
      }
      const od = (state.finance?.invoices || []).filter((i) => i.status === 'Sent' && i.due < T);
      if (od.length && can('finance')) add('warn', 'doc', `${plural(od.length, 'invoice is', 'invoices are')} overdue`, `${money(od.reduce((s, i) => s + AllurusFinance.invoiceTotals(i).total, 0))} is owed to you.`, { label: 'Chase', href: '#invoices' }, 2);
      const since = U.addDays(T, -183);
      const tired = activeEmployees().filter((e) => e.start < since && !state.leaves.some((l) => l.empId === e.id && l.status === 'Approved' && l.type === 'annual' && l.to >= since));
      if (tired.length && can('time')) add('info', 'heart', `${plural(tired.length, 'person hasn’t', 'people haven’t')} had a break in 6 months`, `${tired.slice(0, 3).map((e) => e.first).join(', ')}${tired.length > 3 ? ' and others' : ''}. A nudge to rest goes a long way.`, { label: 'Time off', href: '#leave' }, 1);
      const bdays = activeEmployees().filter((e) => e.birthday && [0, 1, 2, 3, 4, 5, 6].some((i) => U.addDays(T, i).slice(5) === e.birthday.slice(5)));
      if (bdays.length) add('good', 'sparkle', bdays.length === 1 ? `${bdays[0].first}’s birthday is this week` : `${bdays.length} birthdays this week`, bdays.map((e) => fullName(e)).join(', '), null, 1);
    }
    if (r === 'employee') {
      const e = me(), rec = myRecord(T);
      if (!U.isWeekend(T) && rec?.s !== 'leave' && !rec?.in) add('warn', 'camera', h < 12 ? 'Ready to start your day?' : 'You haven’t checked in today', (isField(me()) ? 'Check in from wherever you are, with a selfie.' : `Check in within ${zone().radius} m of ${zone().label} with a selfie.`), { label: 'Check in', act: 'check-in', v: 'present' }, 4);
      else if (rec?.in && !rec.out && h >= 17) add('info', 'clock', 'Don’t forget to check out', `You’ve been in since ${rec.lastIn || rec.in}.`, { label: 'Check out', act: 'check-out' }, 3);
      let streak = 0, d = rec?.in ? T : U.addDays(T, -1);
      for (let i = 0; i < 90; i++) {
        if (U.isWeekend(d)) { d = U.addDays(d, -1); continue; }
        const x = myRecord(d);
        if (x && ['present', 'remote'].includes(x.s)) { streak++; d = U.addDays(d, -1); } else break;
      }
      if (streak >= 3) add('good', 'sparkle', `${streak}-day check-in streak`, streak >= 15 ? 'A great run. Remember to plan some rest too.' : 'Nice and consistent. Keep it going!', null, 0);
      const aLeft = leaveApi.balance(e.id, 'annual').available, toYearEnd = daysUntil(T.slice(0, 4) + '-12-31');
      if (aLeft >= 3 && toYearEnd <= 120) add('info', 'calendar', `${aLeft} annual leave days left`, `The year ends in ${toYearEnd} days. You’ve earned a break.`, { label: 'Plan time off', act: 'new-leave' }, 2);
      const claims = (state.claims || []).filter((c) => c.empId === e.id);
      const coming = claims.filter((c) => c.status === 'Approved').reduce((s, c) => s + c.approved, 0);
      if (coming) add('good', 'heart', `${money(coming, 2)} in claims on the way`, 'Approved and added to your next salary.', { label: 'Claims', href: '#my-claims' }, 1);
      const waiting = claims.filter((c) => c.status === 'Pending').length;
      if (waiting) add('info', 'heart', `${plural(waiting, 'claim is', 'claims are')} with HR`, 'You’ll see the decision on Claims.', { label: 'View', href: '#my-claims' }, 0);
      const ps = AllurusPlanner.summary(state, e);
      if (ps?.filled) add(ps.left >= 0 ? 'good' : 'bad', 'target', ps.left >= 0 ? `${money(ps.left)} left to spend this month` : `Your plan is short by ${money(-ps.left)}`, ps.left >= 0 ? `About ${money(ps.left / 30)} a day after bills and savings.` : 'Trim a cost or look again at your savings.', { label: 'Planner', href: '#my-plan' }, ps.left >= 0 ? 0 : 3);
      else add('info', 'target', 'Know what’s really yours to spend', 'Two minutes in the planner shows what’s left after bills.', { label: 'Start planning', href: '#my-plan' }, 1);
      const payday = U.lastWorkday(U.monthEnd(U.monthKey(T))), pd = daysUntil(payday);
      if (pd >= 0 && pd <= 7) add('good', 'wallet', pd === 0 ? 'It’s payday' : `Payday in ${plural(pd, 'day', 'days')}`, U.fmtDate(payday, { weekday: 'long', month: 'short', day: 'numeric' }), { label: 'Payslips', href: '#my-pay' }, 1);
      if (+T.slice(5, 7) >= 9) add('info', 'percent', 'Lower your tax before the year ends', 'Add receipts for books, sports, medical and courses.', { label: 'Tax reliefs', href: '#my-tax' }, 0);
    }
    if (leaveApi) out.push(...leaveApi.insights());
    if (timeApi) out.push(...timeApi.insights());
    if (docsApi) out.push(...docsApi.insights());
    if (claimsApi) out.push(...claimsApi.insights());
    if (notifyApi) out.push(...notifyApi.insights());
    if (appraisalApi) out.push(...appraisalApi.insights());
    if (hrApi) out.push(...hrApi.insights());
    if (costingApi) out.push(...costingApi.insights());
    if (einvApi) out.push(...einvApi.insights());
    [recruitApi, lmsApi, grievApi, roomsApi, opsApi, posApi].forEach((a) => { if (a) out.push(...a.insights()); });
    return out.sort((a, b) => b.prio - a.prio);
  }
  const actionLink = (a, cls = 'btn btn-sm') => a.href ? `<a class="${cls}" href="${a.href}">${esc(a.label)}</a>` : `<button type="button" class="${cls}" data-act="${a.act}" ${a.id ? `data-id="${a.id}"` : ''} ${a.v ? `data-v="${a.v}"` : ''}>${esc(a.label)}</button>`;
  const insightRow = (x) => `<div class="insight tone-${x.tone}"><span class="insight-ic">${icon(x.icon)}</span><div class="grow"><div class="insight-t">${esc(x.title)}</div><div class="insight-d">${esc(x.detail)}</div></div>${x.action ? actionLink(x.action, 'btn btn-sm btn-ghost') : ''}</div>`;
  function insightsCard(list) {
    return `<div class="card"><div class="card-head"><h3>Insights</h3><span class="hint">${icon('sparkle')}Updated as things change</span></div>
      ${list.length ? `<div class="insights">${list.slice(0, 5).map(insightRow).join('')}</div>` : '<div class="empty"><strong>All quiet</strong>Nothing unusual today. Enjoy it.</div>'}</div>`;
  }
  function focusItem(x) {
    const inner = `<span class="focus-ic">${icon(x.icon)}</span><span class="grow"><strong>${esc(x.title)}</strong><small>${esc(x.detail)}</small></span><span class="focus-go">${esc(x.action.label)}${icon('right')}</span>`;
    return x.action.href ? `<a class="focus-item tone-${x.tone}" href="${x.action.href}">${inner}</a>` : `<button type="button" class="focus-item tone-${x.tone}" data-act="${x.action.act}" ${x.action.id ? `data-id="${x.action.id}"` : ''} ${x.action.v ? `data-v="${x.action.v}"` : ''}>${inner}</button>`;
  }
  // The welcome card at the top of each dashboard: greeting, what to focus on, quick actions.
  function hero({ title, sub, actions = '', side = '', focus = [], calm }) {
    const T = U.today();
    return `<div class="card hero"><div class="hero-top"><div class="hero-text"><div class="eyebrow">${U.fmtDate(T, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>${title}</h1><p class="sub">${sub}</p>
        <div class="actions hero-actions">${actions}<button type="button" class="btn btn-ghost" data-act="ux-customize" aria-pressed="${AllurusUX.isEditing()}">${icon('dashboard')}${AllurusUX.isEditing() ? 'Done' : 'Customize'}</button></div></div>${side}</div>
      ${focus.length ? `<div class="focus"><div class="focus-label">${icon('sparkle')}Focus for today</div><div class="focus-list">${focus.map(focusItem).join('')}</div></div>` : `<div class="focus calm">${icon('check')}<span>${calm}</span></div>`}</div>`;
  }
  function greeting(first) {
    const h = new Date().getHours();
    return `${h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${esc(first)}.`;
  }
  const dayNote = () => ['Enjoy your Sunday.', 'A fresh week starts here.', 'Hope the week is off to a good start.', 'Halfway through the week.', 'Nearly there.', 'Almost the weekend.', 'Enjoy your Saturday.'][new Date().getDay()];
  const delta = (v, unit = '', invert = false) => {
    if (!v || !isFinite(v)) return '';
    const up = v > 0, good = invert ? !up : up;
    return `<span class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(v * 10) / 10)}${unit}</span>`;
  };

  function liveWidget() {
    const T = U.today(), rec = state.attendance[T] || {};
    const rows = Object.entries(rec).filter(([, r]) => r.in).map(([id, r]) => ({ e: emp(id), r })).filter((x) => x.e).sort((a, b) => (b.r.lastIn || b.r.in).localeCompare(a.r.lastIn || a.r.in));
    const inNow = rows.filter((x) => !x.r.out);
    return `<div class="card"><div class="card-head"><h3>Who’s in now</h3><span class="live-dot" title="Live"><span class="sr-only">Live</span></span></div>
      <div class="kpi"><div class="kpi-value">${inNow.length}<span class="faint" style="font-size:16px"> of ${activeEmployees().length}</span></div><div class="kpi-foot">${rows.filter((x) => x.r.s === 'remote' && !x.r.out).length} remote · ${rows.length - inNow.length} checked out</div></div>
      ${rows.length ? `<div class="list" style="margin-top:10px">${rows.slice(0, 5).map(({ e, r }) => `<div class="list-item">${avatar(fullName(e), 'sm')}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">${r.out ? `Checked out at ${r.out}` : `${r.s === 'remote' ? 'Remote' : 'In office'} since ${r.lastIn || r.in}`}</div></div>${r.out ? '' : '<span class="pill ok">In</span>'}</div>`).join('')}</div>`
        : `<div class="empty"><strong>No one yet</strong>${U.isWeekend(T) ? 'It’s the weekend.' : 'Check-ins appear here the moment they happen.'}</div>`}
      <a class="hint card-link" href="#attendance">Open attendance ${icon('right')}</a></div>`;
  }

  VIEWS.dashboard = () => {
    const T = U.today();
    const active = activeEmployees();
    const wd = U.lastWorkday(T);
    const ds = dayStats(wd);
    const inOffice = ds.present + ds.remote;
    const rate = ds.total ? Math.round((inOffice / ds.total) * 100) : 0;
    const prev = []; let d = U.addDays(wd, -1);
    while (prev.length < 7) { if (!U.isWeekend(d)) prev.push(d); d = U.addDays(d, -1); }
    const avg = prev.reduce((s, x) => { const st = dayStats(x); return s + (st.total ? ((st.present + st.remote) / st.total) * 100 : 0); }, 0) / prev.length;
    const out = active.filter((e) => onLeaveOn(e.id, T));
    const joined = active.filter((e) => e.start.slice(0, 7) === T.slice(0, 7)).length;
    const pend = can('time') ? pendingLeaves().filter((l) => l.empId !== me()?.id) : [], pendC = can('claims') ? (state.claims || []).filter((c) => c.status === 'Pending' && c.empId !== me()?.id) : [];
    const paidMonths = Object.keys(state.payroll).filter((k) => state.payroll[k].status === 'Paid').sort();
    const lastPaid = paidMonths[paidMonths.length - 1];
    const ins = insights(), focus = ins.filter((x) => x.prio >= 2 && x.action).slice(0, 3);
    const nowIn = Object.values(state.attendance[T] || {}).filter((r) => r.in && !r.out).length;
    const W = [
      { id: 'today', title: 'Today', span: 12, fixed: true, render: () => hero({
        title: greeting(me()?.first || 'there'),
        sub: `${U.isWeekend(T) ? 'It’s the weekend at' : `${nowIn} ${nowIn === 1 ? 'person is' : 'people are'} in at`} ${esc(state.settings.company)} right now. ${focus.length ? `${focus.length} ${focus.length === 1 ? 'thing needs' : 'things need'} you today.` : dayNote()}`,
        actions: `${can('people') ? `<button class="btn btn-primary" data-act="add-emp">${icon('plus')}Add employee</button>` : ''}${can('time') ? `<button class="btn" data-act="new-leave">${icon('calendar')}Request time off</button>` : ''}`,
        focus, calm: 'You’re all caught up. Nothing needs your attention right now.' }) },
      { id: 'setup', title: 'Getting started', span: 12, fixed: true, render: () => AllurusUX.setupCard() },
      { id: 'kpis', title: 'Key numbers', span: 12, render: () => `<div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Employees</div><div class="kpi-value">${active.length}</div><div class="kpi-foot">${joined ? `${delta(joined)} joined this month` : `${state.departments.length} departments`}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Attendance</div><div class="kpi-value">${rate}%</div><div class="kpi-foot">${delta(rate - avg, ' pts')} vs 7-day average · ${wd === T ? 'today' : U.fmtDate(wd, { weekday: 'short' })}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>On leave today</div><div class="kpi-value">${out.length}</div><div class="kpi-foot">${out.length ? esc(out.map((e) => e.first).join(', ')) : 'Everyone is in'}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Open roles</div><div class="kpi-value">${state.jobs.length}</div><div class="kpi-foot">${state.candidates.filter((c) => c.stage !== 'Hired').length} candidates in the pipeline</div></div></div>` },
      { id: 'attendance', area: 'time', title: 'Attendance trend', span: 8, render: () => `<div class="card"><div class="card-head"><h3>Attendance, last 7 workdays</h3><div class="legend"><span><i style="background:var(--brand)"></i>In office</span><span><i style="background:var(--gold)"></i>Remote</span></div></div>${attendanceChart(wd)}</div>` },
      { id: 'live', area: 'time', title: 'Who’s in now', span: 4, render: liveWidget },
      { id: 'off', area: 'time', title: 'Who’s off today', span: 4, render: () => leaveApi.whoOffCard() },
      { id: 'approvals', title: 'Waiting for approval', span: 4, render: () => `<div class="card"><div class="card-head"><h3>Waiting for you</h3><span class="hint">${pend.length + pendC.length} open</span></div>
        ${pend.length || pendC.length ? `<div class="list">${pend.slice(0, 3).map((l) => { const e = emp(l.empId); return `<div class="list-item">${avatar(fullName(e), 'sm')}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">${esc(leaveApi.typeName(l.type))} leave · ${l.days} day${l.days > 1 ? 's' : ''} · ${U.fmtDate(l.from, { month: 'short', day: 'numeric' })}</div></div>
            <button class="btn btn-sm btn-icon btn-ok" data-act="approve-leave" data-id="${l.id}" aria-label="Approve ${esc(fullName(e))}’s leave">${icon('check')}</button><button class="btn btn-sm btn-icon btn-danger" data-act="reject-leave" data-id="${l.id}" aria-label="Decline ${esc(fullName(e))}’s leave">${icon('x')}</button></div>`; }).join('')}
          ${pendC.slice(0, 3).map((c) => { const e = emp(c.empId); return e ? `<div class="list-item">${avatar(fullName(e), 'sm')}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">${esc(c.title)} · ${money(AllurusClaimRules.claimTotal(c), 2)}</div></div><button class="btn btn-sm" data-act="cl-review" data-id="${c.id}">Review</button></div>` : ''; }).join('')}</div>`
          : '<div class="empty"><strong>All caught up</strong>New requests will show up here.</div>'}</div>` },
      { id: 'insights', title: 'Insights', span: 4, render: () => insightsCard(ins) },
      { id: 'payroll', area: 'payroll', title: 'Payroll trend', span: 4, render: () => `<div class="card"><div class="card-head"><h3>Net payroll</h3><span class="hint">${lastPaid ? 'Last paid ' + U.fmtMonth(lastPaid, { month: 'short' }) : ''}</span></div>${payrollChart()}</div>` },
      { id: 'headcount', title: 'Headcount by department', span: 4, render: () => `<div class="card"><div class="card-head"><h3>Headcount by department</h3></div>${deptBars()}</div>` },
      { id: 'upcoming', title: 'Coming up', span: 4, render: () => `<div class="card"><div class="card-head"><h3>Coming up</h3><span class="hint">Next 30 days</span></div>${upcomingList()}</div>` },
      { id: 'activity', title: 'Recent activity', span: 4, render: () => `<div class="card"><div class="card-head"><h3>Recent activity</h3></div>
        <div class="list">${state.activity.slice(0, 6).map((a) => `<div class="list-item"><div class="grow" style="font-size:13.5px">${esc(a.text)}</div><span class="faint" style="white-space:nowrap;font-size:12.5px">${timeAgo(a.t)}</span></div>`).join('') || '<div class="empty">No activity yet.</div>'}</div></div>` },
    ];
    return AllurusUX.board('admin', W.filter((w) => !w.area || can(w.area)));
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
    state.leaves.filter((l) => l.status === 'Approved' && l.from > T && l.from <= end).forEach((l) => items.push({ date: l.from, e: emp(l.empId), text: `${leaveApi.typeName(l.type)} leave, ${l.days} day${l.days > 1 ? 's' : ''}` }));
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
    const acc = teamAccess.on();
    return `
      <div class="page-head">
        <div><h1>Employees</h1><p class="sub">${activeEmployees().length} active people across ${state.departments.length} departments.</p></div>
        <div class="actions">${can('people') ? `<button class="btn" data-act="import-emps">${icon('doc')}Import</button>` : ''}<button class="btn" data-act="export-emps">${icon('download')}Export CSV</button><button class="btn btn-primary" data-act="add-emp">${icon('plus')}Add employee</button></div>
      </div>
      ${hrApi.requestsCard()}
      <div class="card card-flush">
        <div class="toolbar">
          <input class="input" id="emp-q" type="search" placeholder="Search by name, email or role" value="${esc(ui.empQuery)}" style="flex:1;min-width:200px">
          <select class="select" id="emp-dept"><option value="all">All departments</option>${state.departments.map((d) => `<option value="${d.id}" ${ui.empDept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
          <div class="seg" role="group" aria-label="Status">${['all', 'Active', 'On leave', 'Inactive'].map((s) => `<button data-act="emp-status" data-v="${s}" class="${ui.empStatus === s ? 'on' : ''}">${s === 'all' ? 'All' : s}</button>`).join('')}</div>
        </div>
        ${acc && (ui.empSel || new Set()).size ? `<div class="toolbar" style="background:var(--brand-soft)"><span style="flex:1"><b>${ui.empSel.size}</b> selected</span><button class="btn btn-sm" data-act="emp-sel-none">Clear</button><button class="btn btn-sm btn-primary" data-act="acc-bulk">Send invitations</button></div>` : ''}
        <div class="table-wrap"><table>
          <thead><tr>${acc ? `<th style="width:34px"><input type="checkbox" id="emp-sel-all" aria-label="Select everyone shown" ${list.length && list.every((e) => ui.empSel?.has(e.id)) ? 'checked' : ''}></th>` : ''}<th>Name</th><th class="hide-sm">Department</th><th>Status</th>${acc ? '<th>Sign-in</th>' : ''}<th class="hide-sm">Location</th><th class="hide-sm">Start date</th><th class="r">Salary</th><th></th></tr></thead>
          <tbody>${list.map((e) => `<tr class="clickable" data-act="view-emp" data-id="${e.id}">
            ${acc ? `<td><input type="checkbox" data-sel="${e.id}" aria-label="Select ${esc(fullName(e))}" ${ui.empSel?.has(e.id) ? 'checked' : ''}></td>` : ''}
            <td>${person(e)}</td><td class="hide-sm">${deptTag(e.dept)}</td><td>${statusPill(empStatus(e))}</td>${acc ? `<td>${teamAccess.badge(e)}</td>` : ''}
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
    if (!teamAccess.on()) return;
    // Who has signed in, who is invited: loaded once per visit to the page.
    if (!teamAccess.data && !teamAccess.loading) { teamAccess.loading = true; teamAccess.load().finally(() => { teamAccess.loading = false; if (route() === 'employees') render(); }); }
    ui.empSel = ui.empSel || new Set();
    $$('[data-sel]').forEach((c) => c.addEventListener('click', (ev) => { ev.stopPropagation(); c.checked ? ui.empSel.add(c.dataset.sel) : ui.empSel.delete(c.dataset.sel); render(); }));
    $('#emp-sel-all')?.addEventListener('click', (ev) => { const ids = $$('[data-sel]').map((c) => c.dataset.sel); ids.forEach((id) => (ev.target.checked ? ui.empSel.add(id) : ui.empSel.delete(id))); render(); });
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
      <div class="field"><label for="f-manager">Reports to</label><select class="select" id="f-manager" name="manager"><option value="">No manager</option>${opt(state.employees.filter((x) => x.id !== e.id).map((x) => [x.id, fullName(x)]), e.manager)}</select></div>
      <div class="field"><label for="f-pattern">Working pattern</label><select class="select" id="f-pattern" name="timePattern">${opt([['', 'Department’s pattern'], ...state.settings.time.patterns.map((p) => [p.id, `${p.name} (${AllurusTimeRules.shiftLabel(p)})`])], e.timePattern || '')}</select><span class="field-hint">The Schedule can change single days.</span></div>
      <div class="field"><label for="f-type">Employment type</label><select class="select" id="f-type" name="type">${opt(['Full-time', 'Part-time', 'Contract', 'Intern', 'Owner'], e.type || 'Full-time')}</select></div>
      <div class="field"><label for="f-location">Location</label><input class="input" id="f-location" name="location" value="${esc(e.location)}"></div>
      <div class="field"><label for="f-salary">Annual salary (${esc(state.settings.currency)})</label><input class="input" id="f-salary" name="salary" type="number" min="0" step="500" required value="${esc(e.salary)}"></div>
      <div class="field"><label for="f-start">Start date</label><input class="input" id="f-start" name="start" type="date" required value="${esc(e.start || U.today())}"></div>
      <div class="field"><label for="f-gender">Gender</label><select class="select" id="f-gender" name="gender">${opt([['', 'Not set'], ['female', 'Female'], ['male', 'Male']], e.gender || '')}</select><span class="field-hint">Used for maternity and paternity leave.</span></div>
      <div class="field"><label for="f-married">Marital status</label><select class="select" id="f-married" name="married">${opt([['no', 'Single'], ['yes', 'Married']], e.married ? 'yes' : 'no')}</select></div>
      <div class="field"><label for="f-birthday">Date of birth</label><input class="input" id="f-birthday" name="birthday" type="date" value="${esc(e.birthday)}"><span class="field-hint">Sets EPF, SOCSO and EIS rules from age 60.</span></div>
      ${state.settings.currency === 'MYR' ? `<div class="field"><label for="f-zakat">Zakat through payroll (RM a month)</label><input class="input num" id="f-zakat" name="zakat" type="number" min="0" step="1" value="${esc(e.zakat || 0)}"><span class="field-hint">Deducted from pay and offsets the PCB.</span></div>` : ''}
      ${docsApi.employeeFields(e)}
      ${notifyApi.employeeFields(e)}
      <div class="field"><label for="f-status">Status</label><select class="select" id="f-status" name="status">${opt(['Active', 'Inactive'], e.status || 'Active')}</select></div>
    </div>`;
  }
  function openEmployeeModal(id, prefill, onCreated) {
    const e = id ? emp(id) : (prefill || {});
    openModal({
      title: id ? 'Edit employee' : 'Add employee', body: employeeForm(e), submit: id ? 'Save changes' : 'Add employee',
      onSubmit(d) {
        d.salary = Number(d.salary) || 0;
        d.married = d.married === 'yes';
        if ('zakat' in d) d.zakat = Math.max(0, Number(d.zakat) || 0);
        if (!docsApi.validateEmployee(d, $('#overlay-root form'))) return false;
        if (id) {
          const before = { ...emp(id) };
          // A new email cancels any invitation sent to the old one, so that link stops working. Send a new one.
          const oldEmail = (before.email || '').trim().toLowerCase(), newEmail = (d.email || '').trim().toLowerCase();
          if (CLOUD && fire()?.live && oldEmail && oldEmail !== newEmail) {
            const st = teamAccess.data ? teamAccess.status(before) : null;
            fire().cancelInvite(oldEmail).then(() => { teamAccess.data = null; });
            if (st?.key === 'joined') toast(`${d.first} still signs in with ${oldEmail}. Ask them to change it in their account, or turn their access off and invite the new email.`, 'info');
            else toast(`Email changed. Any invitation to ${oldEmail} is cancelled; send a new invitation to ${newEmail}.`, 'info');
          }
          Object.assign(emp(id), d);
          const note = [docsApi.afterSave(before, emp(id)), hrApi.afterEdit(before, emp(id))].filter(Boolean).join(' ');
          commit(note ? `Changes saved. ${note}` : 'Changes saved', `${d.first} ${d.last}'s profile was updated`);
        }
        else {
          const ne = { id: U.uid('e'), cp22Filed: '', leaverFiled: '', ...d };
          state.employees.push(ne);
          if (appraisalApi.current()?.status === 'Open') appraisalApi.addParticipant(ne);
          hrApi.onCreated(ne);
          onCreated?.(ne);
          commit(`${d.first} added. ${docsApi.afterSave(null, ne)} Onboarding checklist started.`, `${d.first} ${d.last} joined as ${d.role}`);
        }
      },
    });
  }

  function openProfile(id, tab = 'summary') {
    const e = emp(id); if (!e) return;
    if (tab !== 'summary') {
      openDrawer(`<div class="drawer-hero"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div style="display:flex;gap:12px;align-items:center;min-width:0">${avatar(fullName(e))}<div style="min-width:0"><h2 style="font-size:20px">${esc(fullName(e))}</h2><div class="muted">${esc(e.role)}</div></div></div><button class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close">${icon('x')}</button></div>${hrApi.tabBar(e, tab)}</div>${hrApi.tabBody(e, tab)}`);
      return;
    }
    const T = U.today();
    const days = []; let d = U.lastWorkday(T);
    while (days.length < 10) { if (!U.isWeekend(d)) days.unshift(d); d = U.addDays(d, -1); }
    const mgr = emp(e.manager);
    const lvA = leaveApi.balance(id, 'annual'), lvS = leaveApi.balance(id, 'sick');
    const label = { present: 'P', remote: 'R', absent: 'A', leave: 'L', none: '·' };
    openDrawer(`
      <div class="drawer-hero">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">${avatar(fullName(e), 'lg')}<button class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close">${icon('x')}</button></div>
        <div><h2 style="font-size:24px;letter-spacing:-0.02em">${esc(fullName(e))}</h2><div class="muted" style="margin-top:2px">${esc(e.role)}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${statusPill(empStatus(e))}${deptTag(e.dept)}</div>
        <div class="actions"><button class="btn btn-sm btn-primary" data-act="edit-emp" data-id="${e.id}">${icon('edit')}Edit</button><button class="btn btn-sm" data-act="new-leave" data-id="${e.id}">${icon('calendar')}Request leave</button><button class="btn btn-sm btn-danger" data-act="ask-delete-emp" data-id="${e.id}">${icon('trash')}Remove</button></div>
        ${teamAccess.on() && e.email ? `<div class="actions" id="acc-prof" data-emp="${e.id}" style="align-items:center"><span class="muted" style="font-size:13px">Sign-in:</span>${teamAccess.badge(e)}${teamAccess.actions(e)}</div>` : ''}
        <div id="del-confirm"></div>
        ${hrApi.tabBar(e, 'summary')}
      </div>
      <div class="drawer-section"><h4>Contact</h4><dl class="kv"><dt>Email</dt><dd>${esc(e.email)}</dd><dt>Phone</dt><dd>${esc(e.phone || '—')}</dd><dt>Location</dt><dd>${esc(e.location || '—')}</dd></dl></div>
      <div class="drawer-section"><h4>Employment</h4><dl class="kv">
        <dt>Type</dt><dd>${esc(e.type)}</dd><dt>Manager</dt><dd>${mgr ? esc(fullName(mgr)) : '—'}</dd>
        <dt>Start date</dt><dd>${U.fmtDate(e.start)}</dd><dt>Date of birth</dt><dd>${U.fmtDate(e.birthday)}</dd>
        <dt>Salary</dt><dd class="num">${money(e.salary)} / year</dd><dt>Monthly gross</dt><dd class="num">${money(e.salary / 12)}</dd></dl></div>
      <div class="drawer-section"><h4>Time off this year</h4>
        ${[['Annual', lvA, 'var(--brand)'], ['Sick', lvS, 'var(--gold)']].map(([n, b, c]) => { const total = b.entitled + b.carried - b.lapsed; return `<div class="hbar" style="grid-template-columns:70px minmax(0,1fr) 90px"><span>${n}</span><div class="hbar-track"><i style="width:${total ? Math.min(100, (b.used / total) * 100) : 0}%;background:${c}"></i></div><span class="num r muted">${b.used} of ${total}</span></div>`; }).join('')}
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
    const tt = timeApi.dayTotals(day, people);
    return `
      <div class="page-head"><div><h1>Attendance</h1><p class="sub">Mark who is in, remote or out. Approved leave is filled in automatically. Lateness, early-outs and overtime follow each person’s shift.</p></div>
        <div class="actions">
          <button class="btn btn-icon" data-act="att-shift" data-v="-1" aria-label="Previous day">${icon('left')}</button>
          <input class="input" type="date" id="att-date" value="${day}" max="${U.addDays(U.today(), 30)}">
          <button class="btn btn-icon" data-act="att-shift" data-v="1" aria-label="Next day">${icon('right')}</button>
          <button class="btn" data-act="att-today">Today</button>
          <button class="btn" data-act="tm-batch">${icon('edit')}Batch edit</button>
          <button class="btn btn-primary" data-act="att-all">${icon('check')}Mark rest present</button>
        </div></div>
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>In office</div><div class="kpi-value">${s.present}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Remote</div><div class="kpi-value">${s.remote}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Absent</div><div class="kpi-value">${s.absent}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>On leave</div><div class="kpi-value">${s.leave}</div><div class="kpi-foot">${s.none} not marked</div></div>
      </div>
      ${securityCard()}
      ${timeApi.requestsCard()}
      <div class="card card-flush">
        <div class="card-head" style="padding-bottom:14px"><h3>${U.fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3><div class="actions">${tt.late ? `<span class="tag bad">${tt.late} late</span>` : ''}${tt.early ? `<span class="tag warn">${tt.early} left early</span>` : ''}${tt.ot ? `<span class="tag ok">${U.round2(tt.ot / 60)} h overtime</span>` : ''}${U.isWeekend(day) ? '<span class="pill gold">Weekend</span>' : ''}</div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Employee</th><th class="hide-sm">Shift</th><th>Check-in</th><th class="hide-sm">Location</th><th>Status</th></tr></thead>
          <tbody>${people.map((e) => { const r = rec[e.id], tc = timeApi.attCells(e, day); return `<tr>
            <td>${person(e)}</td><td class="hide-sm">${tc.shift}</td>
            <td class="num muted"><span class="att-time">${r?.in || '—'}${r?.out ? '–' + r.out : ''}<button class="btn btn-sm btn-icon btn-ghost" data-act="tm-edit" data-id="${e.id}" data-v="${day}" title="Edit times${tc.history ? ` (${tc.history} change${tc.history === 1 ? '' : 's'})` : ''}" aria-label="Edit times for ${esc(fullName(e))}">${icon('edit')}${tc.history ? '<i class="att-edited" aria-hidden="true"></i>' : ''}</button></span>${r?.history?.length ? `<div class="faint" style="font-size:12px">${r.history.length + 1} check-ins</div>` : ''}${r && (r.via === 'kiosk' || r.via === 'supervisor' || r.offline || r.project || r.flags?.length) ? `<div class="tm-tags">${r.via === 'kiosk' ? '<span class="tag">Kiosk</span>' : r.via === 'supervisor' ? `<span class="tag" title="Checked in by a supervisor">By ${esc(emp(r.by)?.first || 'supervisor')}</span>` : ''}${r.offline ? `<span class="tag ${r.syncedAt ? '' : 'warn'}" title="${r.syncedAt ? 'Synced ' + new Date(r.syncedAt).toLocaleString('en-MY') : 'Waiting to sync'}">Captured offline</span>` : ''}${r.flags?.length && !r.reviewed ? '<span class="tag bad" title="Location looks unusual">GPS check</span>' : ''}${kioskApi.projectTag(r)}</div>` : ''}${tc.tags ? `<div class="tm-tags">${tc.tags}</div>` : ''}${r?.face ? `<div style="margin-top:3px">${faceTag(r)}</div>` : ''}</td>
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
      else time = timeApi.shiftStart(emp(id), day) || '09:00';
    }
    // Manual changes are kept in the audit trail.
    timeApi.setRecord(day, id, { s, in: time, out: prev?.out || '' }, 'Status set on Attendance');
    save(); render();
  }

  // ----- Payroll -----
  const isMY = () => state.settings.currency === 'MYR' && U.statutory(state.settings).on;
  // One employee's line in a pay run: salary, overtime and allowances, statutory deductions and approved claims.
  function payItem(e0, bonus, mk) {
    // The salary in effect that month: an appraisal increment counts from its effective month.
    const e = appraisalApi ? { ...e0, salary: appraisalApi.salaryFor(e0, mk) } : e0;
    // Approved unpaid leave in the month comes off basic pay before statutory deductions.
    const up = leaveApi ? leaveApi.unpaidFor(e.id, mk, U.round2(e.salary / 12)) : { days: 0, amount: 0, divisor: 0 };
    // Approved overtime and daily allowances from attendance, each flagged for EPF, SOCSO/EIS and PCB, and approved
    // claims: taxable categories go into gross pay (PCB), the rest are reimbursed on top of net pay.
    const cl = claimsApi?.enabled() ? claimsApi.forPayroll(e.id, mk) : null;
    const extra = [...(timeApi ? timeApi.forPayroll(e, mk) : []), ...(cl?.taxable ? [{ key: 'claims-taxable', label: `Taxable claims (${cl.taxableCats.join(', ')})`, amount: cl.taxable, epf: false, socso: false, tax: true, detail: 'Benefit reimbursed through payroll' }] : [])];
    const it = { empId: e.id, ...U.payCalc(e.salary, bonus, state.settings, e, U.monthEnd(mk), { unpaid: up.amount, unpaidDays: up.days, extra }) };
    if (it.unpaid) it.unpaidDivisor = up.divisor;
    it.extraLines = extra;
    it.claimIds = cl ? cl.ids : [];
    it.claims = cl ? cl.nonTaxable : 0;
    it.claimGL = cl ? cl.byGL : {};
    it.net = U.round2(it.net + it.claims);
    const note = appraisalApi ? appraisalApi.payNote(e0, mk) : {};
    it.salaryNote = note.salary || ''; it.bonusNote = it.bonus ? note.bonus || '' : '';
    return it;
  }
  VIEWS.payroll = () => {
    const mk = ui.payMonth;
    const run = state.payroll[mk];
    const t = run ? payTotal(run) : null;
    const cur = U.monthKey(U.today());
    const eligible = activeEmployees().filter((e) => e.start <= U.monthEnd(mk));
    const projected = eligible.reduce((s, e) => s + U.payCalc(e.salary, 0, state.settings, e).net, 0);
    const pill = run ? (run.status === 'Paid' ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">Draft</span>') : '<span class="pill">Not run</span>';
    const my = isMY(), due = U.fmtDate(U.addMonths(mk, 1) + '-15', { month: 'short', day: 'numeric', year: 'numeric' });
    const remit = t && my ? [
      ['KWSP (EPF)', 'Employee and employer EPF', t.epf + t.erEpf, 'i-Akaun (Majikan)'],
      ['PERKESO (SOCSO and EIS)', 'Employee and employer SOCSO and EIS', t.socso + t.erSocso + t.eis + t.erEis, 'PERKESO ASSIST'],
      ['LHDN (PCB)', 'Monthly tax deductions', t.tax, 'e-PCB Plus'],
      ...(t.zakat ? [['Zakat', 'Zakat deducted for your state zakat body', t.zakat, 'State zakat portal']] : []),
      ...(t.hrdf ? [['HRD Corp levy', 'Employer levy for training', t.hrdf, 'eTRiS']] : []),
    ] : [];
    // Statutory files, the bank file and year-end forms live on their own tabs.
    if (docsApi.tab() !== 'run') return `
      <div class="page-head"><div><div class="eyebrow">Payroll</div><h1>${U.fmtMonth(mk)}</h1><p class="sub">${run?.status === 'Paid' ? `Paid on ${U.fmtDate(run.paidOn)} to ${run.items.length} people.` : run ? 'This run is still a draft.' : 'Not run yet.'}</p></div>
        <div class="actions">
          <button class="btn btn-icon" data-act="pay-shift" data-v="-1" aria-label="Previous month">${icon('left')}</button>
          ${pill}
          <button class="btn btn-icon" data-act="pay-shift" data-v="1" aria-label="Next month" ${mk >= U.addMonths(cur, 1) ? 'disabled' : ''}>${icon('right')}</button>
        </div></div>
      ${docsApi.tabBar()}
      ${docsApi.tabView(mk)}`;
    return `
      <div class="page-head"><div><div class="eyebrow">Payroll</div><h1>${U.fmtMonth(mk)}</h1><p class="sub">${run?.status === 'Paid' ? `Paid on ${U.fmtDate(run.paidOn)} to ${run.items.length} people.` : run ? 'Review bonuses, then approve to mark this run as paid. Click a name to see the payslip.' : `${eligible.length} people are eligible. Estimated net pay is ${money(projected)}.`}</p></div>
        <div class="actions">
          <button class="btn btn-icon" data-act="pay-shift" data-v="-1" aria-label="Previous month">${icon('left')}</button>
          ${pill}
          <button class="btn btn-icon" data-act="pay-shift" data-v="1" aria-label="Next month" ${mk >= U.addMonths(cur, 1) ? 'disabled' : ''}>${icon('right')}</button>
          ${!run ? `<button class="btn btn-primary" data-act="pay-run">${icon('wallet')}Run payroll</button>` : ''}
          ${run?.status === 'Draft' ? `<button class="btn" data-act="pay-discard">Discard draft</button><button class="btn btn-primary" data-act="pay-approve">${icon('check')}Approve and pay</button>` : ''}
          ${run ? `<button class="btn" data-act="pay-export">${icon('download')}Export CSV</button><button class="btn" data-act="pd-slips-all" data-v="${mk}">${icon('doc')}Print all payslips</button>` : ''}
        </div></div>
      ${role() === 'admin' ? docsApi.tabBar() : ''}
      ${run?.status === 'Paid' ? `<div class="lock-banner info">${icon('shield')}<span>Paid. The KWSP, PERKESO, LHDN and HRD Corp files and the bank file are ready. <button class="link-btn" data-act="pd-tab" data-v="files">Open statutory files</button></span></div>` : ''}
      ${run ? `
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label">Gross pay</div><div class="kpi-value">${compactMoney(t.gross)}</div><div class="kpi-foot num">${money(t.gross)}</div></div>
        <div class="card kpi"><div class="kpi-label">Deducted from staff</div><div class="kpi-value">${compactMoney(t.tax + t.benefits + t.zakat)}</div><div class="kpi-foot">${my ? `EPF ${money(t.epf)} · PCB ${money(t.tax)}` : `Tax ${money(t.tax)} · benefits ${money(t.benefits)}`}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Net pay to staff</div><div class="kpi-value">${compactMoney(t.net)}</div><div class="kpi-foot">${t.claims ? `Includes ${money(t.claims)} reimbursed claims` : money(t.net)}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>Total cost to company</div><div class="kpi-value">${compactMoney(t.gross + t.erCost + t.claims)}</div><div class="kpi-foot">${my ? `Employer contributions ${money(t.erCost)}` : 'Gross pay'}</div></div>
      </div>
      ${my ? `<div class="card"><div class="card-head"><h3>Statutory payments</h3><span class="hint">Due by ${due}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Pay to</th><th class="hide-sm">What it covers</th><th class="hide-sm">Where</th><th class="r">Amount</th></tr></thead>
        <tbody>${remit.map(([to, what, amt, where]) => `<tr><td><strong>${to}</strong></td><td class="hide-sm muted">${what}</td><td class="hide-sm muted">${where}</td><td class="r num" style="font-weight:600">${money(amt, 2)}</td></tr>`).join('')}
        <tr><td><strong>Total</strong></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="r num" style="font-weight:600">${money(remit.reduce((s, x) => s + x[2], 0), 2)}</td></tr></tbody></table></div>
        <p class="disclaimer">${icon('pin')}<span>EPF ${U.statutory(state.settings).epfEe}% employee, ${U.statutory(state.settings).epfEr}% employer (${U.statutory(state.settings).epfErHigh}% above RM5,000). SOCSO and EIS by PERKESO wage bands up to RM6,000. PCB is estimated from LHDN tax bands with the individual relief only; staff can update their TP1 reliefs with you. Check against the official calculators before paying.</span></p></div>` : ''}
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th class="r">Bonus</th><th class="r">Gross</th>${my ? '<th class="r hide-sm">EPF</th><th class="r hide-sm">SOCSO + EIS</th><th class="r hide-sm">PCB</th>' : '<th class="r hide-sm">Tax</th><th class="r hide-sm">Benefits</th>'}${t.claims ? '<th class="r hide-sm">Claims</th>' : ''}<th class="r">Net</th></tr></thead>
        <tbody>${run.items.map((it) => { const e = emp(it.empId); if (!e) return ''; return `<tr>
          <td><button class="cell-btn" data-act="payslip" data-id="${it.empId}" title="Open payslip">${person(e)}</button>${it.salaryNote ? `<div class="person-sub"><span class="tag ok">${esc(it.salaryNote)}</span></div>` : ''}</td>
          <td class="r num">${run.status === 'Draft' ? `<input class="input num" style="width:84px;text-align:right" type="number" min="0" step="100" data-bonus="${it.empId}" value="${it.bonus}" aria-label="Bonus for ${esc(fullName(e))}">` : money(it.bonus)}${it.bonusNote ? `<div class="person-sub">${esc(it.bonusNote)}</div>` : ''}</td>
          <td class="r num">${money(it.gross, 2)}${it.unpaid ? `<div class="person-sub">−${money(it.unpaid, 2)} unpaid leave</div>` : ''}${it.extras ? `<div class="person-sub">+${money(it.extras, 2)} added earnings</div>` : ''}</td>
          ${my ? `<td class="r num muted hide-sm">${money(it.epf ?? it.benefits, 2)}</td><td class="r num muted hide-sm">${money((it.socso || 0) + (it.eis || 0), 2)}</td><td class="r num muted hide-sm">${money(it.tax + (it.zakat || 0), 2)}</td>` : `<td class="r num muted hide-sm">${money(it.tax, 2)}</td><td class="r num muted hide-sm">${money(it.benefits, 2)}</td>`}
          ${t.claims ? `<td class="r num hide-sm">${it.claims ? money(it.claims, 2) : '<span class="faint">—</span>'}</td>` : ''}
          <td class="r num" style="font-weight:600">${money(it.net, 2)}</td></tr>`; }).join('')}</tbody>
      </table></div></div>` : `
      <div class="card"><div class="empty" style="padding:48px 12px"><strong>No payroll for ${U.fmtMonth(mk)} yet</strong>Running payroll creates a draft from current salaries, adds approved overtime and daily allowances, works out ${my ? 'EPF, SOCSO, EIS and PCB' : 'deductions'}, and adds approved claims. You can add bonuses before approving it.<div style="margin-top:16px"><button class="btn btn-primary" data-act="pay-run">${icon('wallet')}Run payroll</button></div></div></div>`}`;
  };
  AFTER.payroll = () => {
    docsApi.bindTabs();
    $$('[data-bonus]').forEach((inp) => inp.addEventListener('change', () => {
      const run = state.payroll[ui.payMonth];
      const it = run.items.find((i) => i.empId === inp.dataset.bonus);
      Object.assign(it, payItem(emp(it.empId), Math.max(0, Number(inp.value) || 0), ui.payMonth));
      save(); render(); toast('Bonus updated');
    }));
  };
  function openPayslip(empId, month = ui.payMonth) {
    const run = state.payroll[month]; const it = run.items.find((i) => i.empId === empId); const e = emp(empId);
    const row = (k, v, strong) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);${strong ? 'font-weight:600;font-size:16px;border:0' : ''}"><span>${k}</span><span class="num">${v}</span></div>`;
    const head = (k) => `<div class="eyebrow" style="margin:14px 0 2px">${k}</div>`;
    const neg = (n) => '−' + money(n, 2);
    const statutory = it.epf != null;
    const flags = (l) => statutory ? [l.epf ? 'EPF' : '', l.socso ? 'SOCSO' : '', l.tax ? 'taxed' : 'not taxed'].filter(Boolean).join(' · ') : '';
    const extras = (it.extraLines || []).map((l) => row(`${esc(l.label)}<div class="person-sub">${esc(l.detail || '')}${flags(l) ? ` · ${flags(l)}` : ''}</div>`, money(l.amount, 2))).join('');
    const lines = statutory
      ? `${head('Earnings')}${row('Basic salary', money(it.base, 2))}${it.unpaid ? row(`Unpaid leave, ${it.unpaidDays} day${it.unpaidDays === 1 ? '' : 's'} (basic ÷ ${it.unpaidDivisor})`, neg(it.unpaid)) : ''}${extras}${it.bonus ? row(it.bonusNote ? `Bonus<div class="person-sub">${esc(it.bonusNote)}</div>` : 'Bonus', money(it.bonus, 2)) : ''}${row('Gross pay', money(it.gross, 2))}
         ${head('Deductions')}${row('EPF (KWSP), employee', neg(it.epf))}${row('SOCSO (PERKESO), employee', neg(it.socso))}${row('EIS, employee', neg(it.eis))}${row('Income tax (PCB)', neg(it.tax))}${it.zakat ? row('Zakat', neg(it.zakat)) : ''}
         ${it.claims ? `${head('Reimbursements')}${row('Claims reimbursed (not taxed)', money(it.claims, 2))}` : ''}
         ${row('Net pay', money(it.net, 2), true)}
         ${head('Paid by the company on top of your pay')}${row('EPF, employer', money(it.erEpf, 2))}${row('SOCSO, employer', money(it.erSocso, 2))}${row('EIS, employer', money(it.erEis, 2))}`
      : `${row('Base salary', money(it.base, 2))}${it.unpaid ? row(`Unpaid leave, ${it.unpaidDays} day${it.unpaidDays === 1 ? '' : 's'}`, neg(it.unpaid)) : ''}${extras}${row('Bonus', money(it.bonus, 2))}${row('Gross pay', money(it.gross, 2))}${row(`Income tax (${state.settings.taxRate}%)`, neg(it.tax))}${row(`Benefits (${state.settings.benefitsRate}%)`, neg(it.benefits))}${it.claims ? row('Claims reimbursed', money(it.claims, 2)) : ''}${row('Net pay', money(it.net, 2), true)}`;
    openModal({
      title: 'Payslip', size: 'sm', submit: null,
      body: `<div style="display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:10px">${LOGO_MARK}<div><div style="font-weight:600;letter-spacing:.24em">${esc(state.settings.company.toUpperCase())}</div><div class="faint" style="font-size:12px">${U.fmtMonth(month)}</div></div></div>${run.status === 'Paid' ? '<span class="pill ok">Paid</span>' : '<span class="pill warn">Draft</span>'}</div>
        ${person(e, `${e.role} · ${dept(e.dept)?.name || ''}`)}
        <div>${lines}</div>
        <button type="button" class="btn" data-act="pd-slip" data-id="${empId}" data-v="${month}">${icon('download')}Print or save as PDF</button></div>`,
    });
  }

  // ----- Recruitment -----
  const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];
  function openCandidateModal() {
    if (!state.jobs.length) { toast('Create a role first'); return; }
    openModal({
      title: 'Add candidate', size: 'sm', submit: 'Add candidate',
      body: `<div class="form-grid">
        <div class="field full"><label for="c-name">Full name</label><input class="input" id="c-name" name="name" required></div>
        <div class="field full"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email"></div>
        <div class="field"><label for="c-job">Role</label><select class="select" id="c-job" name="jobId">${state.jobs.map((j) => `<option value="${j.id}" ${ui.jobFilter === j.id ? 'selected' : ''}>${esc(j.title)}</option>`).join('')}</select></div>
        <div class="field"><label for="c-src">Source</label><select class="select" id="c-src" name="source">${AllurusTalentRules.SOURCES.map((x) => `<option>${x}</option>`).join('')}</select></div>
        <div class="field full"><label for="c-phone">Phone</label><input class="input" id="c-phone" name="phone" type="tel"></div></div>`,
      onSubmit(d) { state.candidates.push({ id: U.uid('c'), ...d, rating: 3, stage: 'Applied', applied: U.today(), stageDates: { Applied: U.today() }, interviews: [], offers: [] }); commit('Candidate added', `${d.name} applied for ${state.jobs.find((j) => j.id === d.jobId).title}`); },
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

  // ----- Performance: appraisals live in js/appraisal.js -----

  // ----- Settings -----
  // ----- Check-in location (Settings) -----
  // Everything here reads and writes state.settings.checkin only. The head office city is never used for
  // check-ins; it only centres the map while no check-in point is set.
  let zonePicker = null;
  function checkinCard(s) {
    const c = s.checkin, z = zone(), set = z.source === 'checkin';
    return `<div class="card" id="checkin-card"><div class="card-head"><h3>Check-in location</h3><a class="hint" id="z-maplink" href="${mapsLink(z)}" target="_blank" rel="noopener">View on Google Maps</a></div>
        <p class="muted" style="margin-bottom:6px">Employees must be inside this circle and take a selfie to check in. This is separate from the head office city above.</p>
        <div class="dept-note" id="z-record">${icon('shield')}<span>${CLOUD ? `Editing: <b>Real account</b> · ${esc(s.company)}. Saved to your company’s cloud workspace; staff phones signed in to it check in against this point.` : `Editing: <b>Demo</b> · ${esc(DEMO.name)} (<code>?demo=${esc(DEMO.id)}</code>). Saved in this browser and shared to phones that open the same demo link. Your real account is not changed.`}</span></div>
        <div class="lock-banner warn" id="z-warn" ${set ? 'hidden' : ''}>${icon('pin')}<span>No check-in point is set, so employees can’t check in yet. Drop the pin on the map or paste coordinates below.</span></div>
        <div class="settings-row"><div><div class="label">Name</div><div class="desc">Shown to employees, for example “Allurus HQ”.</div></div><input class="input" id="z-label" value="${esc(c.label || '')}" style="width:min(260px,100%)"></div>
        <div class="settings-row zone-coords"><div><div class="label"><label for="z-coords">Coordinates</label></div><div class="desc">Paste from Google Maps, as decimals (4.238203, 103.419428) or degrees (4°14'17.5"N 103°25'10.0"E). Saves automatically.</div></div>
          <div class="zone-field"><div class="actions"><input class="input num" id="z-coords" value="${set ? esc(U.fmtCoords(c)) : ''}" placeholder="4.238203, 103.419428" autocomplete="off" spellcheck="false" inputmode="text" aria-describedby="z-coords-msg"><button class="btn" data-act="zone-here">${icon('pin')}Use my location</button></div>
          <span class="field-hint" id="z-coords-msg" role="status">${set ? `${pointWhen(c)}.` : 'Not set yet.'}</span></div></div>
        <div class="map-pick">
          <form class="map-search" id="z-search" role="search"><input class="input" type="search" id="z-q" placeholder="Search a place or address" aria-label="Search a place or address" autocomplete="off"><button class="btn" type="submit">${icon('search')}<span>Search</span></button></form>
          <div class="map-results" id="z-results" hidden></div>
          <div class="map-canvas" id="z-map" role="application" aria-label="Map. Tap to place the check-in point, then drag the pin to adjust it."><div class="map-loading">Loading map…</div></div>
          <p class="field-hint">Tap the map to drop the pin, then drag it to fine-tune. The circle shows the radius.</p>
        </div>
        <div class="settings-row"><div><div class="label"><label for="z-radius">Radius</label></div><div class="desc">How close employees must be, in meters. Default is 50 m. GPS readings get up to ${U.GPS_SLACK_M} m of leeway.</div></div><input class="input num" id="z-radius" type="number" min="10" max="5000" step="5" value="${z.radius}" style="width:100px"></div>
        <div class="settings-row"><div><div class="label">Field staff</div><div class="desc">${(c.field || []).length ? `${(c.field || []).map((id) => emp(id)).filter(Boolean).map((e) => esc(fullName(e))).join(', ')} can check in from anywhere, with a selfie.` : 'Nobody yet.'} Change this on each person’s profile under Employees.</div></div></div>
        <div class="settings-row"><div><div class="label">Staff phones</div><div class="desc">In this demo every browser keeps its own copy of the settings. Send staff this link once so their phone uses this exact check-in point.</div></div><button class="btn" data-act="zone-link" ${set ? '' : 'disabled'}>Copy setup link</button></div>`;
  }
  // When the point was set: the real time HR saved it, or "demo default" for the demo company's starting point.
  const pointWhen = (c) => (!c.setAt ? 'Saved' : !CLOUD && c.setAt === DEMO.published?.at ? 'Demo default point (not yet changed in Settings)' : `Saved ${new Date(c.setAt).toLocaleString()}`);
  // Head office (Settings → Company): a typed place with suggestions (js/places-field.js). Saved as
  // settings.headOffice, and as the plain name in settings.office that older parts of the app read.
  // Only places the company on the Allurus map: it never changes the check-in point.
  function bindHeadOffice() {
    const host = $('#s-office-field'); if (!host) return;
    const s = state.settings;
    AllurusPlaceField.mount(host, { id: 's-office', value: s.headOffice || s.office || '', onChange: (v) => { s.headOffice = v; s.office = AllurusPlaces.officeName(v); save(); toast(`Head office: ${v.label}`); headOfficePin(); } });
    headOfficePin();
  }
  // A place typed by hand isn't on the map until it has a pin.
  function headOfficePin() {
    const el = $('#s-office-pin'), v = state.settings.headOffice; if (!el) return;
    if (!v || AllurusPlaces.onMap(v)) { el.innerHTML = ''; return; }
    el.innerHTML = `<p class="field-hint" style="margin-top:6px">Not shown on the map yet. <button type="button" class="link-btn" id="ho-pin-btn">Drop a pin</button> to place it.</p><div class="map-canvas map-sm" id="ho-map" hidden style="margin-top:8px"></div>`;
    $('#ho-pin-btn').addEventListener('click', () => {
      const m = $('#ho-map'); m.hidden = false;
      const start = U.city(state.settings.office) || { lat: 4.2105, lng: 101.9758 };
      AllurusMap.picker(m, { lat: start.lat, lng: start.lng, radius: 300, approx: true, onPick: (p) => {
        Object.assign(state.settings.headOffice, { lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), updatedAt: Date.now() }); save(); toast('Head office placed on the map');
      } }).catch(() => { m.innerHTML = '<div class="map-loading">The map couldn’t load here.</div>'; });
    });
  }
  // Save a new check-in point without re-rendering the page, and keep the field, link and map in sync.
  function setZonePoint(p, how) {
    const c = state.settings.checkin;
    Object.assign(c, { lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6), setAt: Date.now() });
    save();
    const f = $('#z-coords');
    if (f) { f.value = U.fmtCoords(c); f.removeAttribute('aria-invalid'); }
    const msg = $('#z-coords-msg'); if (msg) { msg.textContent = `Saved ${new Date(c.setAt).toLocaleString()}.`; msg.classList.remove('field-error'); }
    $('#z-maplink')?.setAttribute('href', mapsLink(c));
    $('#z-warn')?.setAttribute('hidden', '');
    $('[data-act=zone-link]')?.removeAttribute('disabled');
    log(`Check-in point moved to ${U.fmtCoords(c)} (${how === 'gps' ? 'GPS' : how === 'field' ? 'typed' : 'map'})`);
    toast(how === 'gps' ? 'Check-in point set to your location' : 'Check-in point saved');
  }
  function bindCheckinCard() {
    const c = state.settings.checkin, f = $('#z-coords'), msg = $('#z-coords-msg');
    $('#z-label').addEventListener('change', (ev) => { c.label = ev.target.value.trim() || c.label; if (U.hasCoords(c)) c.setAt = Date.now(); save(); toast('Check-in name saved'); });
    let typeTimer = null;
    const showError = (text) => { f.setAttribute('aria-invalid', 'true'); msg.textContent = text; msg.classList.add('field-error'); };
    f.addEventListener('input', () => { if (f.getAttribute('aria-invalid')) { f.removeAttribute('aria-invalid'); msg.classList.remove('field-error'); msg.textContent = 'Saves when you stop typing.'; }
      clearTimeout(typeTimer); typeTimer = setTimeout(() => { if (U.parseCoordsDetailed(f.value).ok) commitField(); }, 900); });
    const commitField = () => {
      const r = U.parseCoordsDetailed(f.value);
      if (!r.ok) { showError(r.error); return; }
      if (U.hasCoords(c) && r.lat === c.lat && r.lng === c.lng) { f.value = U.fmtCoords(c); return; }
      setZonePoint(r, 'field');
      zonePicker?.setPoint(r, { zoom: 17 });
    };
    f.addEventListener('change', () => { clearTimeout(typeTimer); commitField(); });
    f.addEventListener('blur', () => { clearTimeout(typeTimer); if (f.value.trim()) commitField(); });
    f.addEventListener('paste', () => setTimeout(() => { clearTimeout(typeTimer); commitField(); }, 0));
    f.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitField(); } });
    const rf = $('#z-radius');
    const radiusVal = () => Math.min(5000, Math.max(10, Math.round(Number(rf.value) || 50)));
    rf.addEventListener('input', () => zonePicker?.setRadius(radiusVal()));
    rf.addEventListener('change', () => { c.radius = radiusVal(); rf.value = c.radius; c.setAt = Date.now(); save(); zonePicker?.setRadius(c.radius); toast(`Radius set to ${c.radius} m`); });
    // Map picker
    zonePicker?.destroy(); zonePicker = null;
    const z = zone(), el = $('#z-map');
    AllurusMap.picker(el, { lat: z.lat, lng: z.lng, radius: z.radius, approx: z.source !== 'checkin', onPick: (p) => setZonePoint(p, 'map') })
      .then((pk) => { if (!pk) return; zonePicker = pk; el.querySelector('.map-loading')?.remove(); })
      .catch(() => { el.innerHTML = '<div class="map-loading">The map couldn’t load here. You can still paste coordinates above.</div>'; });
    // Place search (Nominatim)
    const results = $('#z-results');
    $('#z-search').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const q = $('#z-q').value.trim(), btn = ev.target.querySelector('button');
      if (q.length < 3) { $('#z-q').focus(); return; }
      btn.disabled = true; results.hidden = false; results.innerHTML = '<div class="map-loading">Searching…</div>';
      try {
        const list = await AllurusMap.search(q);
        results.innerHTML = list.length ? list.map((x, i) => `<button type="button" data-i="${i}">${icon('pin')}<span>${esc(x.name)}</span></button>`).join('') : `<div class="map-loading">No places found for “${esc(q)}”. Try a street, building or town.</div>`;
        results.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
          const x = list[+b.dataset.i];
          results.hidden = true;
          zonePicker?.view(x, 18);
          toast('Moved the map there. Tap the exact spot to drop the pin.', 'info');
        }));
      } catch (e) { results.innerHTML = '<div class="map-loading">Search isn’t available right now. Drag the map or paste coordinates instead.</div>'; }
      btn.disabled = false;
    });
  }
  // A setup link from HR (#setup?co=…&lat=…) makes this phone use the company's check-in point.
  function captureSetupLink() {
    const h = location.hash;
    if (!h.startsWith('#setup?')) return;
    try { sessionStorage.setItem('allurus-setup', h.slice(7)); } catch (e) { /* private mode */ }
    history.replaceState(null, '', location.pathname + location.search);
  }
  function applySetupLink() {
    let raw = null;
    try { raw = sessionStorage.getItem('allurus-setup'); } catch (e) { /* private mode */ }
    if (!raw || !role()) return;
    try { sessionStorage.removeItem('allurus-setup'); } catch (e) { /* private mode */ }
    const q = new URLSearchParams(raw), p = U.parseCoords(`${q.get('lat')}, ${q.get('lng')}`), t = Number(q.get('t')) || 0;
    if (!p) { toast('That setup link is damaged. Ask HR for a new one.', 'error'); return; }
    if ((q.get('co') || '').toLowerCase() !== state.settings.company.toLowerCase()) { toast(`That setup link is for ${q.get('co')}, not ${state.settings.company}.`, 'error'); return; }
    const c = state.settings.checkin;
    if (c.setAt && c.setAt >= t) { toast('This phone already has the latest check-in point.', 'info'); return; }
    Object.assign(c, { lat: p.lat, lng: p.lng, radius: Math.min(5000, Math.max(10, Number(q.get('r')) || 50)), label: q.get('label') || c.label, setAt: t || Date.now() });
    if (q.has('field')) c.field = (q.get('field') || '').split(',').filter((id) => state.employees.some((e) => e.id === id));
    save(); render();
    toast(`Check-in point updated: ${c.label}, ${c.radius} m`);
  }

  // Malaysian statutory deductions, used by payroll.
  function statutoryCard(s) {
    const st = U.statutory(s);
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="stat-set" data-id="${key}" data-v="${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const num = (key, max) => `<input class="input num" data-stat="${key}" type="number" min="0" max="${max}" step="0.5" value="${st[key]}" style="width:90px">`;
    return `<div class="card"><div class="card-head"><h3>Statutory deductions (Malaysia)</h3>${seg('on', [[false, 'Off'], [true, 'On']])}</div>
      <p class="muted" style="margin-bottom:6px">Worked out for every payslip. Employees aged 60 and over follow the senior rules automatically.</p>
      <div class="settings-row"><div><div class="label">EPF (KWSP), employee</div><div class="desc">Percent of wages. The standard rate is 11%.</div></div>${num('epfEe', 20)}</div>
      <div class="settings-row"><div><div class="label">EPF, employer</div><div class="desc">13% for wages up to RM5,000, 12% above.</div></div><div class="actions">${num('epfEr', 20)}${num('epfErHigh', 20)}</div></div>
      <div class="settings-row"><div><div class="label">SOCSO (PERKESO)</div><div class="desc">Employment injury and invalidity. Employer 1.75%, employee 0.5%, wages up to RM6,000.</div></div>${seg('socso', [[false, 'Off'], [true, 'On']])}</div>
      <div class="settings-row"><div><div class="label">EIS</div><div class="desc">Employment Insurance System. 0.2% each, wages up to RM6,000.</div></div>${seg('eis', [[false, 'Off'], [true, 'On']])}</div>
      <div class="settings-row"><div><div class="label">Income tax (PCB)</div><div class="desc">${st.pcb === 'flat' ? 'A flat percent of gross pay.' : 'Estimated from LHDN tax bands each month, including bonuses.'}</div></div><div class="actions">${seg('pcb', [['lhdn', 'LHDN schedule'], ['flat', 'Flat %']])}${st.pcb === 'flat' ? `<input class="input num" id="s-tax" type="number" min="0" max="60" step="0.5" value="${s.taxRate}" style="width:80px" aria-label="Flat PCB percent">` : ''}</div></div>
      <div class="settings-row"><div><div class="label">HRD Corp levy</div><div class="desc">Paid by the company on basic pay: 1% with 10 or more Malaysian staff, 0.5% optional for 5 to 9.</div></div>${seg('hrdf', [[0, 'None'], [0.5, '0.5%'], [1, '1%']])}</div>
      <p class="disclaimer">${icon('pin')}<span>Payments are due to KWSP, PERKESO, LHDN and HRD Corp by the 15th of the following month. Rates change; check the official contribution tables.</span></p></div>`;
  }
  // Settings is split into sections, one shown at a time: #settings/<section> (a side menu on a computer, a list
  // then the section full screen on a phone). Every card keeps its own markup, ids and saving; only where it sits
  // changed. All sections are drawn (others hidden) so the existing bindings and "go to this card" links work.
  const SETTINGS_KEY = 'allurus-settings-sec';
  const stUi = { dirty: false, savedAt: 0, jump: null, prevSec: null };
  const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
  const settingsSections = () => {
    const s = state.settings, admin = role() === 'admin' && can('settings'), my = s.currency === 'MYR';
    const currencies = ['MYR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'INR', 'PKR', 'CAD', 'AUD', 'SGD'];
    const row = (label, desc, ctl) => `<div class="settings-row"><div><div class="label">${label}</div><div class="desc">${desc}</div></div>${ctl}</div>`;
    const account = { id: 'account', label: 'My account', icon: 'people', summary: 'Theme, text size and your password', keys: 'theme dark light appearance accessibility font contrast motion password sign in',
      html: () => AllurusUX.appearanceCard() + accountCard() };
    const notifications = { id: 'notifications', label: 'Notifications', icon: 'bell', summary: 'Which emails and alerts you get', keys: 'email alert reminder outbox notification',
      html: () => notifyApi.prefsCard() + (admin ? notifyApi.outboxCard() : '') };
    const resetCard = (desc) => `<div class="card st-danger"><div class="card-head"><h3>Danger zone</h3></div>
      ${row('Reset demo workspace', desc, '<button class="btn btn-danger" data-act="ask-reset">Reset data</button>')}<div id="reset-confirm"></div></div>`;
    if (!admin) return [account, notifications, ...(role() === 'super' ? [{ id: 'data', label: 'Data', icon: 'box', summary: 'Reset the demo workspace', keys: 'reset demo data', html: () => resetCard('Data is stored in this browser only.') }] : [])];
    const feats = window.AllurusFeatures, B = window.AllurusBilling?.CFG || { graceDays: 7, keepDays: 90 };
    return [
      { id: 'company', label: 'Company', icon: 'building', summary: 'Name, head office, registration numbers', keys: 'company name head office city town state address phone ssm registration tin sst myinvois e-invoice brand logo colours',
        html: () => `<div class="card"><div class="card-head"><h3>Company</h3></div>
          ${row('Company name', 'Shown in the sidebar and on payslips.', `<input class="input" id="s-company" value="${esc(s.company)}" style="width:220px">`)}
          ${row('Head office city', 'Only places your company on the Allurus map. Check-ins use the check-in location (Check-in &amp; attendance).', '<div><div id="s-office-field"></div><div id="s-office-pin"></div></div>')}</div>
          ${my ? docsApi.settingsCard() + einvApi.settingsCard() : ''}
          <div class="card"><div class="card-head"><h3>Brand</h3><a class="hint" href="brand.html">Open brand kit</a></div>
            <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">${LOGO_FULL}<div class="chips">${[['Allurus Teal', '#0F766E'], ['Champagne', '#D9B66F'], ['Obsidian', '#16181D'], ['Mist', '#F5F5F7']].map(([n, c]) => `<span class="chip" style="cursor:default"><i style="width:14px;height:14px;border-radius:50%;background:${c};border:1px solid var(--line-strong)"></i>${n}<span class="n">${c}</span></span>`).join('')}</div></div></div>` },
      { id: 'checkin', label: 'Check-in & attendance', icon: 'pin', summary: 'Location and radius, selfie rules, work hours', keys: 'check-in checkin location radius map gps coordinates pin selfie face camera phone device remote field staff kiosk supervisor project working pattern hours shift roster overtime allowance',
        // The check-in card (with its map) is drawn only while this section is open.
        html: (open) => `${open ? `${checkinCard(s)}
          ${row('Remote check-in', 'Lets employees check in from anywhere with a selfie. Marked as Remote.', `<div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="zone-remote" data-v="${v}" class="${(s.checkin.remote ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`)}
          ${[['deviceLock', 'One phone per person', 'Each person checks in only from their approved phone, and a phone checks in for one person. New phones need your approval.'],
             ['faceCheck', 'Face check', 'Compares each selfie with the person’s reference photo, on their phone. Asks for consent first.'],
             ['liveOnly', 'Live camera only', 'Blocks uploading a saved photo instead of taking a selfie.']].map(([k, label, desc]) => row(label, desc, `<div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="sec-toggle" data-id="${k}" data-v="${v}" class="${(s.checkin[k] !== false ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`)).join('')}
          </div>` : ''}${kioskApi.settingsCard()}${timeApi.settingsCards()}` },
      { id: 'leave', label: 'Leave & holidays', icon: 'calendar', summary: 'Leave types, public holidays, rest days', keys: 'leave type entitlement annual sick public holiday state weekend rest day work week approver approval carry forward year-end',
        html: () => leaveApi.settingsCards() },
      { id: 'payroll', label: 'Payroll', icon: 'wallet', summary: my ? 'Currency, EPF, SOCSO, EIS, PCB' : 'Currency, tax and benefits', keys: 'payroll currency salary epf kwsp socso perkeso eis pcb income tax lhdn hrdf hrd corp levy benefit contribution statutory deduction',
        html: () => `<div class="card"><div class="card-head"><h3>Pay</h3></div>
          ${row('Currency', 'Used for salaries and payroll.', `<select class="select" id="s-currency" aria-label="Currency">${currencies.map((c) => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
          ${my ? '<p class="field-hint">Registration numbers (SSM, EPF, SOCSO, LHDN) are under <a href="#settings/company">Company</a>.</p>' : row('Income tax withholding', 'Percent of gross pay.', `<input class="input num" id="s-tax" type="number" min="0" max="60" step="0.5" value="${s.taxRate}" style="width:100px" aria-label="Income tax withholding percent">`) + row('Benefit contributions', 'Deducted from pay, as percent of gross.', `<input class="input num" id="s-benefits" type="number" min="0" max="30" step="0.5" value="${s.benefitsRate}" style="width:100px" aria-label="Benefit contributions percent">`)}</div>
          ${my ? statutoryCard(s) : ''}` },
      { id: 'claims', label: 'Claims', icon: 'receipt', summary: 'Claim categories, limits, mileage, medical', keys: 'claim category limit mileage medical expense reimbursement',
        html: () => claimsApi.settingsCards() },
      { id: 'people', label: 'People & talent', icon: 'userplus', summary: 'Onboarding, letters, hiring, appraisals', keys: 'employee department position import onboarding offboarding checklist letter template recruitment job offer appraisal grade band grievance',
        html: () => `<div class="card"><div class="card-head"><h3>Employees and departments</h3></div>
          ${row('Employees', 'Add people, import from Excel or CSV, and set each person’s details.', `<a class="btn" href="#employees">${icon('people')}Open Employees</a>`)}
          ${row('Departments', 'Departments and who leads them.', `<a class="btn" href="#departments">${icon('building')}Open Departments</a>`)}</div>
          ${hrApi.settingsCards()}${recruitApi.settingsCard()}${appraisalApi.settingsCards()}${grievApi.settingsCard()}` },
      { id: 'users', label: 'Users & roles', icon: 'shield', summary: 'Who can sign in, and what they can do', keys: 'user role admin permission access invite invitation disable owner hr finance',
        html: () => (CLOUD ? '<div class="card" id="team-access"><div class="card-head"><h3>Team access</h3><span class="hint">Loading…</span></div></div>'
          : '<div class="card"><div class="card-head"><h3>Team access</h3></div><p class="muted">Invitations and roles are set up in your real workspace. In this demo, sign in as the sample people from the sign-in page.</p></div>') },
      ...(CLOUD ? [{ id: 'billing', label: 'Billing & subscription', icon: 'doc', summary: 'Plan, trial, invoices, payment proof', keys: 'billing plan trial subscription invoice payment proof upgrade paid',
        html: () => `<div class="card"><div class="card-head"><h3>Billing &amp; subscription</h3></div>${row('Plan and invoices', 'Your plan, trial or paid-until date, invoices and payment proof.', `<a class="btn btn-primary" href="#billing">${icon('doc')}Open Billing</a>`)}</div>` }] : []),
      { id: 'security', label: 'Security', icon: 'shield', summary: 'Password rules', keys: 'security password rule length two-step session sign-in',
        html: () => `<div class="card"><div class="card-head"><h3>Password rules</h3></div>
          <p class="muted">Everyone’s password must be at least ${window.AllurusPassword?.MIN || 10} characters, and can’t be a common password or contain their name, email or company name. Change your own in <a href="#settings/account">My account</a>.</p></div>` },
      { id: 'data', label: 'Data & privacy', icon: 'box', summary: CLOUD ? 'How long data is kept' : 'Reset the demo workspace', keys: 'data privacy pdpa retention reset delete export',
        html: () => `<div class="card"><div class="card-head"><h3>Data retention</h3></div><p class="muted">${CLOUD ? `If a subscription ends, company admins can still open the workspace, Billing and their data for a ${B.graceDays}-day grace period. The data is then kept for ${B.keepDays} days before it is deleted.` : 'This demo is saved in this browser only.'}</p></div>
          ${CLOUD ? '' : resetCard(`Data is stored in this browser only. Resetting puts ${esc(s.company)} back to its sample data; other demo companies are not touched.`)}` },
      ...(feats ? [{ id: 'features', label: 'Features', icon: 'layers', summary: 'Modules switched on for your company', keys: 'feature module industry',
        html: () => `<div class="card"><div class="card-head"><h3>Features</h3><span class="hint">Set by Allurus for your industry</span></div><div class="chips" style="flex-wrap:wrap">${[...feats.keys].sort().map((k) => `<span class="tag">${esc(k)}</span>`).join('') || '<span class="faint">None</span>'}</div></div>` }] : []),
      account, notifications,
    ];
  };
  // Setup progress: the four things a new company needs, each linking to where it's done.
  function setupProgress() {
    const s = state.settings, my = s.currency === 'MYR';
    const items = [['Company profile', 'company', !!(s.headOffice || s.office) && (!my || !!s.employer?.address)], ['Check-in location', 'checkin', zone().source === 'checkin'],
      ['Staff added', '#employees', activeEmployees().length > 1], ['Payroll set', my ? 'company' : 'payroll', my ? !!s.employer?.epfNo : true]];
    const done = items.filter((x) => x[2]).length;
    if (done === items.length) return '';
    return `<div class="card st-progress"><div class="card-head"><h3>Setup progress</h3><span class="hint">${done} of ${items.length} done</span></div><ul class="st-steps">${items.map(([l, to, ok]) => `<li class="${ok ? 'ok' : ''}">${icon(ok ? 'check' : 'pin')}${ok ? `<span>${l}</span>` : `<a href="${to.startsWith('#') ? to : `#settings/${to}`}">${l}</a>`}</li>`).join('')}</ul></div>`;
  }
  // #settings/<id>, #settings (a phone shows the list; a computer opens the last section) or #settings/@<card id>.
  function settingsSection(list) {
    const want = (location.hash.split('?')[0].split('/')[1] || '');
    if (want.startsWith('@')) { stUi.jump = { id: want.slice(1) }; return list[0].id; }
    if (list.some((x) => x.id === want)) return want;
    if (want === '' && isPhone()) return '';
    let last = ''; try { last = localStorage.getItem(SETTINGS_KEY) || ''; } catch (e) { /* storage unavailable */ }
    const sec = list.some((x) => x.id === last) ? last : list[0].id;
    history.replaceState(null, '', `#settings/${sec}`);
    return sec;
  }
  VIEWS.settings = () => {
    const list = settingsSections(), sec = settingsSection(list), cur = list.find((x) => x.id === sec);
    const admin = role() === 'admin' && can('settings');
    stUi.dirty = false;
    return `
      <div class="page-head"><div><h1>Settings</h1><p class="sub">${admin ? 'Company details, pay rules and appearance. Changes save automatically.' : 'Your appearance, notifications and password.'}</p></div></div>
      ${admin && !cur ? setupProgress() : ''}
      <div class="st" data-mode="${cur ? 'sec' : 'list'}">
        <aside class="st-side">
          <div class="st-search" role="search"><input class="input" type="search" id="st-q" placeholder="Search settings" aria-label="Search settings" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="st-results" aria-expanded="false"><div class="st-results" id="st-results" role="listbox" aria-label="Matching settings" hidden></div></div>
          <nav class="st-nav" aria-label="Settings sections">${list.map((x) => `<a href="#settings/${x.id}" class="${x.id === sec ? 'active' : ''}" ${x.id === sec ? 'aria-current="page"' : ''}>${icon(x.icon)}<span><b>${esc(x.label)}</b><small>${esc(x.summary)}</small></span></a>`).join('')}</nav>
        </aside>
        <div class="st-body">
          ${cur ? `<div class="st-head"><a class="btn btn-sm btn-ghost st-back" href="#settings" aria-label="Back to all settings">${icon('left')}Back</a><h2 id="st-h" tabindex="-1">${esc(cur.label)}</h2>${admin && cur.id !== 'account' ? `<span class="st-saved faint" id="st-saved" role="status">${stUi.savedAt ? `Saved ${new Date(stUi.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Changes save automatically'}</span>` : ''}</div>
            ${admin && cur.id === list[0].id ? setupProgress() : ''}` : ''}
          ${list.map((x) => `<section class="st-sec" data-sec="${x.id}" aria-labelledby="st-h" ${x.id === sec ? '' : 'hidden'}>${x.html(x.id === sec)}</section>`).join('')}
        </div>
      </div>`;
  };
  // The search index: each section's card titles and setting names, plus extra words (radius, EPF…).
  function settingsIndex(list) {
    const out = [];
    list.forEach((x) => {
      out.push({ sec: x.id, text: x.label, where: x.summary, words: `${x.label} ${x.summary} ${x.keys}`.toLowerCase() });
      $$(`[data-sec="${x.id}"] h3, [data-sec="${x.id}"] .settings-row .label`).forEach((el) => { const t = el.textContent.trim(); if (t && t.length < 60) out.push({ sec: x.id, text: t, where: x.label, words: t.toLowerCase() }); });
    });
    return out;
  }
  function bindSettingsLayout(list, sec) {
    const q = $('#st-q'), res = $('#st-results'); if (!q) return;
    let index = null, hits = [], active = -1;
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      if (t.length < 2) { res.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
      index = index || settingsIndex(list);
      const seen = new Set(), words = t.split(/\s+/);
      // Setting names first, then whole sections matched by their extra words.
      hits = index.filter((h) => words.every((w) => h.words.includes(w))).sort((a, b) => (a.words.length > 60) - (b.words.length > 60))
        .filter((h) => { const k = h.sec + h.text; return !seen.has(k) && seen.add(k); }).slice(0, 8);
      active = hits.length ? 0 : -1;
      res.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" role="option" id="st-r${i}" data-i="${i}" aria-selected="${i === active}"><b>${esc(h.text)}</b><small>${esc(h.where)}</small></button>`).join('') : `<div class="faint" style="padding:10px">No settings match “${esc(q.value.trim())}”.</div>`;
      res.hidden = false; q.setAttribute('aria-expanded', 'true');
    };
    const pick = (h) => { if (!h) return; stUi.jump = { text: h.text }; res.hidden = true; q.value = ''; if (h.sec === sec) render(); else location.hash = `settings/${h.sec}`; };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!hits.length) return; active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; $$('[role=option]', res).forEach((b, i) => b.setAttribute('aria-selected', String(i === active))); q.setAttribute('aria-activedescendant', `st-r${active}`); }
      else if (ev.key === 'Enter') { ev.preventDefault(); pick(hits[active]); }
      else if (ev.key === 'Escape') { res.hidden = true; q.setAttribute('aria-expanded', 'false'); }
    });
    res.addEventListener('mousedown', (ev) => ev.preventDefault());
    res.addEventListener('click', (ev) => { const b = ev.target.closest('[data-i]'); if (b) pick(hits[+b.dataset.i]); });
    q.addEventListener('blur', () => setTimeout(() => { res.hidden = true; q.setAttribute('aria-expanded', 'false'); }, 150));
    // Saved time, and typing not yet saved (fields save when you leave them).
    const body = $('.st-body');
    body.addEventListener('input', (ev) => { if (ev.target.closest('.st-sec') && !ev.target.closest('#reset-confirm')) stUi.dirty = true; }, true);
    // Fields save when you leave them, so leaving one is done (saved, or unchanged); one marked invalid isn't.
    body.addEventListener('focusout', (ev) => setTimeout(() => { if (ev.target.getAttribute?.('aria-invalid') !== 'true') stUi.dirty = false; }, 0));
    try { if (sec) localStorage.setItem(SETTINGS_KEY, sec); } catch (e) { /* storage unavailable */ }
    // Focus the section heading when moving between sections, so screen readers announce it.
    if (sec && stUi.prevSec !== null && stUi.prevSec !== sec && !stUi.jump) setTimeout(() => $('#st-h')?.focus({ preventScroll: true }), 0);
    stUi.prevSec = sec;
    // A link to one card (#settings/@leave-types) or a search result: open its section, then scroll to it.
    const j = stUi.jump; stUi.jump = null;
    if (j?.id) {
      const el = document.getElementById(j.id), to = el?.closest('[data-sec]')?.dataset.sec;
      history.replaceState(null, '', `#settings/${to || sec || list[0].id}`);
      if (to && !j.done && el.closest('[hidden]')) { stUi.jump = { id: j.id, done: true }; render(); return; }
    }
    const target = j?.id ? document.getElementById(j.id) : j?.text ? $$(`[data-sec="${sec}"] h3, [data-sec="${sec}"] .settings-row .label`).find((el) => el.textContent.trim() === j.text) : null;
    if (target) setTimeout(() => { target.scrollIntoView({ block: 'center' }); const box = target.closest('.settings-row, .card') || target; box.classList.add('st-flash'); setTimeout(() => box.classList.remove('st-flash'), 1600); }, 30);
  }
  // Open the section holding a card, by the card's id (used by "Leave settings", "Edit" and similar links).
  const settingsGo = (id) => { if (location.hash === `#settings/@${id}`) render(); else location.hash = `settings/@${id}`; };
  window.AllurusSettingsGo = settingsGo;
  // Leaving with a field typed in but not saved asks first.
  document.addEventListener('click', (ev) => {
    if (!stUi.dirty || route() !== 'settings') return;
    const a = ev.target.closest('a[href^="#"]'); if (!a || a.closest('.st-sec')) return;
    if (!confirm('You have a change that isn’t saved yet. Leave this section without saving it?')) { ev.preventDefault(); ev.stopPropagation(); } else stUi.dirty = false;
  }, true);
  window.addEventListener('beforeunload', (ev) => { if (stUi.dirty && route() === 'settings') { ev.preventDefault(); ev.returnValue = ''; } });
  AFTER.settings = () => {
    const list = settingsSections(), sec = (location.hash.split('?')[0].split('/')[1] || '');
    bindAccountCard();
    notifyApi.bindSettings();
    bindSettingsLayout(list, list.some((x) => x.id === sec) ? sec : '');
    if (role() !== 'admin' || !can('settings')) return;
    if (CLOUD) teamAccess.mount();
    const bind = (id, key, num) => $(id)?.addEventListener('change', (ev) => { state.settings[key] = num ? Math.max(0, Number(ev.target.value) || 0) : ev.target.value.trim() || state.settings[key]; commit('Settings saved'); });
    if ($('#z-label')) bindCheckinCard();
    leaveApi.bindSettings();
    timeApi.bindSettings();
    docsApi.bindSettings();
    appraisalApi.bindSettings();
    hrApi.bindSettings();
    recruitApi.bindSettings();
    grievApi.bindSettings();
    einvApi.bindSettings();
    claimsApi.bindSettings();
    kioskApi.bindSettings();
    bind('#s-company', 'company'); bind('#s-currency', 'currency'); bindHeadOffice(); if ($('#s-tax')) bind('#s-tax', 'taxRate', 1); if ($('#s-benefits')) bind('#s-benefits', 'benefitsRate', 1);
    $$('[data-stat]').forEach((el) => el.addEventListener('change', () => { state.settings.statutory = { ...U.statutory(state.settings), [el.dataset.stat]: Math.min(20, Math.max(0, Number(el.value) || 0)) }; commit('Statutory rates saved'); }));
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
        ${CLOUD ? '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13.5px"><button type="button" class="link-btn" data-act="cloud-reset">Forgot password?</button><a class="link-btn" href="/activate">First time? Activate your account</a></div>' : ''}
      </form>
      ${CLOUD ? '' : `<div class="card demo-pick" style="width:100%;max-width:440px;margin:0 auto 16px;padding:18px 20px"><div style="font-weight:600;margin-bottom:4px">Explore the demo company</div>${Object.keys(AllurusSeed.companies).length > 1 ? `<div class="seg demo-co" role="group" aria-label="Demo company" style="margin:4px 0 8px;width:100%">${Object.values(AllurusSeed.companies).map((c) => `<button type="button" data-act="demo-company" data-v="${c.id}" class="${c.id === DEMO.id ? 'on' : ''}" aria-pressed="${c.id === DEMO.id}" style="flex:1">${esc(c.short)}</button>`).join('')}</div>` : ''}<p class="muted" style="font-size:13.5px;margin-bottom:12px">${esc(state.settings.company)}${DEMO.blurb ? ` · ${esc(DEMO.blurb)}` : ''}. A sample business; changes stay in this browser.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${DEMO.logins.filter(([e]) => state.accounts.some((a) => a.email === e)).map(([e, label, sub]) => `<button type="button" class="btn" style="flex-direction:column;align-items:flex-start;height:auto;padding:10px 12px;text-align:left" data-act="demo-as" data-v="${e}"><span style="font-weight:600">${label}</span><span class="muted" style="font-size:12px;font-weight:400">${sub}</span></button>`).join('')}</div></div>`}
      ${CLOUD ? '<div class="register-cta"><div><strong>New to Allurus?</strong><span class="muted"> Sign up your company and try it free for 30 days.</span></div><a class="btn btn-primary" href="/signup">Start free trial</a></div>' : `<div class="register-cta"><div><strong>New to Allurus?</strong><span class="muted"> Register your company and start a free trial.</span></div><button class="btn btn-primary" data-act="register">${icon('plus')}Register company</button></div>`}
      <p class="faint" style="font-size:12.5px">${CLOUD ? 'Your company’s data is kept securely in the cloud and shared live with your team. <a href="?demo">Try the demo company instead</a>.' : CAN_CLOUD ? `Demo company, saved in this browser only. <a href="${location.pathname}">Sign in to your real workspace</a>.` : `Demo mode. Your workspace is saved in this browser${cloud.db ? '; company sign-ups and check-ins are also shared with the Allurus team' : ''}.`} Version ${APP_VERSION}</p>
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
      if (CLOUD) {
        if (!fire()) { btn.disabled = false; btn.textContent = 'Sign in'; err.textContent = 'Still connecting to the server. Try again in a moment.'; err.hidden = false; return; }
        // After 5 wrong passwords in this browser, each try waits longer (up to 30 s), on top of Firebase's own lockout.
        const FAIL_KEY = 'allurus-signin-fails';
        let fails = 0; try { fails = +sessionStorage.getItem(FAIL_KEY) || 0; } catch (e) { /* no storage */ }
        if (fails >= 5) { btn.textContent = 'Please wait…'; await new Promise((r) => setTimeout(r, Math.min(30, 2 ** (fails - 4)) * 1000)); }
        const res = await fire().signIn(email, pw);
        try { sessionStorage.setItem(FAIL_KEY, res.ok ? '0' : String(fails + 1)); } catch (e) { /* no storage */ }
        if (!res.ok) { btn.disabled = false; btn.textContent = 'Sign in'; err.textContent = res.error; err.hidden = false; form.password.value = ''; form.password.focus(); return; }
        startSession(state.accounts[0]);
        return;
      }
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
  // People with both an HR role and an employee role start in Employee view on a phone and in the company
  // console on a computer. They can still switch views from the menu.
  const onPhone = () => { try { return matchMedia('(max-width: 760px)').matches || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600); } catch (e) { return false; } };
  function preferredRole(roles) {
    if (onPhone() && roles.includes('employee')) return 'employee';
    if (!roles.includes('super') && roles.includes('admin')) return 'admin';
    return roles[0];
  }
  function startSession(acct) {
    if (acct.tenantId && acct.tenantId !== state.session.tenantId && state.workspaces[acct.tenantId]) switchWorkspace(acct.tenantId);
    Object.assign(state.session, { account: acct.email, roles: acct.roles.slice(), role: preferredRole(acct.roles), empId: acct.empId });
    save();
    // Pick up where this person left off last time.
    const last = AllurusUX.prefs().lastRoute?.[state.session.role];
    // An expired company's admin opens on Billing (the rest is read-only until it's paid).
    const target = CLOUD && fire()?.profile?.billingOnly ? 'billing' : last && routes().some((r) => r.id === last) ? last : posApi?.landing(state.session.role) || opsApi?.landing(state.session.role) || '';
    if (location.hash.slice(1) !== target) location.hash = target; else render();
    window.scrollTo(0, 0);
    toast(target && target !== routes()[0].id ? `Welcome back. You’re where you left off.` : `Signed in as ${acct.email}`);
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
      if (CLOUD) {
        if (f.next.value.length < 8) { toast('Use at least 8 characters for the new password', 'error'); f.next.focus(); return; }
        const res = await fire().changePassword(f.current.value, f.next.value);
        if (!res.ok) { toast(res.error, 'error'); f.current.focus(); return; }
        f.reset(); toast('Password changed'); return;
      }
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
  // A check-out earlier than the check-in is after midnight.
  const hoursBetween = (a, b) => { if (!a || !b) return 0; const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return ((h2 * 60 + m2 - h1 * 60 - m1 + 1440) % 1440) / 60; };
  const myRecord = (day) => state.attendance[day]?.[me().id];
  const myRuns = () => Object.keys(state.payroll).filter((k) => state.payroll[k].status === 'Paid' && state.payroll[k].items.some((i) => i.empId === me().id)).sort().reverse();

  VIEWS.home = () => {
    const e = me(), T = U.today();
    const rec = myRecord(T);
    const lvA = leaveApi.balance(e.id, 'annual'), lvS = leaveApi.balance(e.id, 'sick');
    const aLeft = lvA.available, sLeft = lvS.available;
    const aTot = lvA.entitled + lvA.carried - lvA.lapsed, sTot = lvS.entitled;
    const monthDays = Object.keys(state.attendance).filter((d) => d.startsWith(U.monthKey(T)) && !U.isWeekend(d));
    const inDays = monthDays.filter((d) => ['present', 'remote'].includes(state.attendance[d][e.id]?.s)).length;
    const runs = myRuns();
    const lastPay = runs[0] ? state.payroll[runs[0]].items.find((i) => i.empId === e.id) : null;
    const myLeaves = state.leaves.filter((l) => l.empId === e.id && l.to >= T).sort((a, b) => a.from.localeCompare(b.from));
    const out = activeEmployees().filter((x) => x.dept === e.dept && x.id !== e.id && onLeaveOn(x.id, T));
    const cyc = appraisalApi.current(), review = cyc && state.reviews.find((r) => r.empId === e.id && r.cycleId === cyc.id);
    const birthday = e.birthday && e.birthday.slice(5) === T.slice(5);
    const ins = insights(), focus = ins.filter((x) => x.prio >= 2 && x.action).slice(0, 3);
    let clock;
    if (rec?.s === 'leave') clock = `<span class="pill gold">On leave today. Enjoy it!</span>`;
    else if (!rec || !rec.in) clock = `<div class="actions"><button class="btn btn-primary btn-lg" data-act="check-in" data-v="present">${icon('camera')}Check in with selfie</button>${zone().remote ? '<button class="btn" data-act="check-in" data-v="remote">Work remotely</button>' : ''}</div>`;
    else if (!rec.out) clock = `<div class="clock-state"><div class="actions">${selfieThumb(me().id, T, rec)}<span class="pill ok">${rec.s === 'remote' ? 'Remote' : 'In office'} since ${rec.lastIn || rec.in}</span><button class="btn btn-primary" data-act="check-out">Check out</button></div>${rec.loc ? `<span class="faint" style="font-size:12.5px">${esc(locText(rec.loc))}</span>` : ''}</div>`;
    else clock = `<div class="clock-state"><div class="actions">${selfieThumb(me().id, T, rec)}<span class="pill brand">Checked out at ${rec.out} · ${hoursBetween(rec.in, rec.out).toFixed(1)} h today</span><button class="btn btn-primary" data-act="check-in" data-v="present">${icon('camera')}Check in again</button>${zone().remote ? '<button class="btn" data-act="check-in" data-v="remote">Work remotely</button>' : ''}</div><span class="faint" style="font-size:12.5px">Checked out by mistake? Check in again. Your hours still count from ${rec.in}.</span></div>`;
    const ps = AllurusPlanner.summary(state, e);
    const coming = (state.claims || []).filter((c) => c.empId === e.id && c.status === 'Approved').reduce((s, c) => s + c.approved, 0);
    const payday = U.lastWorkday(U.monthEnd(U.monthKey(T)));
    const W = [
      { id: 'today', title: 'Today', span: 12, fixed: true, render: () => hero({
        title: birthday ? `Happy birthday, ${esc(e.first)}!` : greeting(e.first),
        sub: `${esc(e.role)} · ${esc(dept(e.dept)?.name || '')}. ${birthday ? 'Everyone at ' + esc(state.settings.company) + ' wishes you a great day.' : dayNote()}`,
        actions: `<button class="btn" data-act="new-leave">${icon('calendar')}Request time off</button>${opsApi?.heroAction() || ''}`,
        side: `<div class="clock-box"><div class="kpi-label">${icon('clock')}Time clock</div><div class="kpi-value clock-time" id="live-clock">${nowHM()}</div>${clock}<div class="kpi-foot">${U.isWeekend(T) ? 'It’s the weekend. Check-ins still count. ' : ''}${isField(me()) ? 'Field staff: check in from anywhere, with a selfie.' : `Within ${zone().radius} m of ${esc(zone().label)}, with a selfie.`}${phoneStatus(me()) ? ` ${phoneStatus(me())}` : ''}${timeApi.todayShift(e) ? `<div class="clock-shift">${esc(timeApi.todayShift(e))}</div>` : ''}${kioskApi.syncBanner(e.id)}${kioskApi.isSupervisor(e) ? `<button class="btn btn-sm" data-act="sv-open" style="margin-top:10px">${icon('people')}Check in a team member</button>` : ''}</div></div>`,
        focus: focus.filter((f) => f.action.act !== 'check-in'), calm: 'Nothing needs you right now. Have a good day.' }) },
      { id: 'setup', title: 'Getting started', span: 12, fixed: true, render: () => AllurusUX.setupCard() },
      ...(opsApi?.homeCard() ? [{ id: 'ops', title: 'Work', span: 12, fixed: true, render: () => opsApi.homeCard() }] : []),
      { id: 'kpis', title: 'My numbers', span: 12, render: () => `<div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Annual leave left</div><div class="kpi-value">${aLeft}</div><div class="progress"><i style="width:${aTot ? Math.min(100, (aLeft / aTot) * 100) : 0}%"></i></div><div class="kpi-foot">of ${aTot} days${lvA.pending ? ` · ${lvA.pending} pending` : ''}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>Sick leave left</div><div class="kpi-value">${sLeft}</div><div class="progress"><i style="width:${sTot ? Math.min(100, (sLeft / sTot) * 100) : 0}%;background:var(--gold)"></i></div><div class="kpi-foot">of ${sTot} days</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Days worked</div><div class="kpi-value">${inDays}<span class="faint" style="font-size:18px"> / ${monthDays.length}</span></div><div class="kpi-foot">${U.fmtMonth(U.monthKey(T), { month: 'long' })} so far</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Last net pay</div><div class="kpi-value">${lastPay ? compactMoney(lastPay.net) : '—'}</div><div class="kpi-foot">${runs[0] ? U.fmtMonth(runs[0]) : 'No payslips yet'}</div></div></div>` },
      { id: 'insights', title: 'For you', span: 4, render: () => insightsCard(ins.filter((x) => x.action?.act !== 'check-in')) },
      { id: 'money', title: 'My money', span: 4, render: () => `<div class="card"><div class="card-head"><h3>My money</h3><a class="hint" href="#my-plan">Planner</a></div>
        <dl class="kv kv-wide"><dt>Last net pay</dt><dd class="num">${lastPay ? money(lastPay.net, 2) : '—'}</dd>
          <dt>Left to spend</dt><dd class="num">${ps?.filled ? `<strong style="color:${ps.left >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money(ps.left)}</strong> a month` : '<a href="#my-plan">Set up your planner</a>'}</dd>
          <dt>Claims coming</dt><dd class="num">${coming ? money(coming, 2) : '—'}</dd>
          <dt>Next payday</dt><dd>${U.fmtDate(payday, { weekday: 'short', month: 'short', day: 'numeric' })}</dd></dl>
        <div class="actions" style="margin-top:14px"><a class="btn btn-sm" href="#my-pay">${icon('wallet')}Payslips</a>${claimsApi?.enabled() ? `<a class="btn btn-sm" href="#my-claims">${icon('heart')}Claims</a>` : ''}</div></div>` },
      { id: 'timeoff', title: 'My time off', span: 4, render: () => `<div class="card"><div class="card-head"><h3>My time off</h3><a class="hint" href="#my-leave">All requests</a></div>
        ${myLeaves.length ? `<div class="list">${myLeaves.slice(0, 4).map((l) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(leaveApi.typeName(l.type))} · ${l.days} day${l.days === 1 ? '' : 's'}</div><div class="person-sub">${U.fmtDate(l.from, { month: 'short', day: 'numeric' })}${l.to !== l.from ? ' – ' + U.fmtDate(l.to, { month: 'short', day: 'numeric' }) : ''}</div></div>${leavePill(l.status)}</div>`).join('')}</div>` : `<div class="empty"><strong>Nothing booked</strong>You have ${aLeft} days to enjoy. <button class="link-btn" data-act="new-leave">Plan a break</button></div>`}</div>` },
      { id: 'shifts', title: 'My shifts', span: 4, render: () => timeApi.myShiftsCard(e) },
      { id: 'news', title: 'Announcements', span: 6, render: () => notifyApi.homeCard(e) },
      ...(leaveApi.isApprover(e.id) ? [{ id: 'teamoff', title: 'Who’s off in your team', span: 4, render: () => leaveApi.whoOffCard({ depts: leaveApi.myDepts(e.id), title: 'Who’s off in your team' }) }] : []),
      { id: 'goals', title: 'My goals', span: 6, render: () => `<div class="card"><div class="card-head"><h3>My goals</h3><a class="hint" href="#my-appraisal">Update</a></div>
        ${review ? `<div class="kpi"><div class="kpi-value">${review.progress}%</div><div class="progress"><i style="width:${review.progress}%"></i></div><div class="kpi-foot" style="margin-top:6px">${esc(cyc.name)} · ${AllurusAppraisalRules.STAGES[review.stage]}${review.final ? ` · grade ${esc(review.final.grade)}` : ''}</div></div>` : '<div class="empty">No review cycle yet.</div>'}</div>` },
      { id: 'team', title: 'Team', span: 6, render: () => `<div class="card"><div class="card-head"><h3>Team</h3><span class="hint">${esc(dept(e.dept)?.name || '')}</span></div>
        <div class="kpi-foot" style="margin-bottom:10px">${out.length ? `Out today: ${esc(out.map((x) => x.first).join(', '))}` : 'Everyone on your team is in today.'}</div>${upcomingList()}</div>` },
    ];
    return AllurusUX.board('employee', W);
  };
  AFTER.home = () => {
    clearInterval(clockTimer);
    clockTimer = setInterval(() => { const c = $('#live-clock'); if (c) c.textContent = nowHM(); else clearInterval(clockTimer); }, 5000);
  };

  VIEWS['my-time'] = () => {
    const e = me(), T = U.today();
    // Workdays on the person's own pattern or roster, plus any day they actually worked.
    const days = []; let d = T;
    for (let i = 0; i < 60 && days.length < 22 && d >= e.start; i++) {
      const x = timeApi.dayInfo(e, d);
      if (x.rec || x.type === 'normal') days.push(x);
      d = U.addDays(d, -1);
    }
    const c = { present: 0, remote: 0, absent: 0, leave: 0 }; let hours = 0;
    days.forEach((x) => { const r = x.rec; if (r) { c[r.s]++; hours += r.out ? hoursBetween(r.in, r.out) : (r.in ? 8 : 0); } });
    const m = timeApi.monthFor(e, U.monthKey(T));
    const pill = { present: '<span class="pill ok">In office</span>', remote: '<span class="pill info">Remote</span>', absent: '<span class="pill bad">Absent</span>', leave: '<span class="pill gold">Leave</span>' };
    return `
      <div class="page-head"><div><h1>My attendance</h1><p class="sub">Your shifts, check-ins and overtime. Days without a check-out count as 8 hours.</p></div>
        <div class="actions">${kioskApi.isSupervisor(e) ? `<button class="btn" data-act="sv-open">${icon('people')}Check in a team member</button>` : ''}<button class="btn" data-act="tm-request">${icon('plus')}New request</button><a class="btn btn-primary" href="#home">${icon('clock')}Open time clock</a></div></div>
      ${kioskApi.syncBanner(e.id)}
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label">Days worked</div><div class="kpi-value">${c.present + c.remote}</div><div class="kpi-foot">${c.remote} remote · last ${days.length} workdays</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Late this month</div><div class="kpi-value">${m.late.days}</div><div class="kpi-foot">${m.late.min ? `${m.late.min} minutes in all` : 'On time every day'}</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Overtime this month</div><div class="kpi-value">${U.round2(m.paidMin / 60)}<span class="faint" style="font-size:18px"> h</span></div><div class="kpi-foot">${m.unapproved ? `${U.round2(m.unapproved / 60)} h waiting for approval` : m.pay.amount ? `About ${money(m.pay.amount)} before deductions` : 'Approved overtime shows here'}</div></div>
        <div class="card kpi"><div class="kpi-label">Hours logged</div><div class="kpi-value">${Math.round(hours)}</div><div class="kpi-foot">Leave or absent: ${c.leave + c.absent} days</div></div>
      </div>
      <div class="grid g-2">${timeApi.myShiftsCard(e, { days: 14, title: 'My roster', link: false })}${timeApi.myRequestsCard(e)}</div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th class="hide-sm">Shift</th><th>Status</th><th>Check-in</th><th>Check-out</th><th class="r">Hours</th><th></th></tr></thead>
        <tbody>${days.map((x) => { const r = x.rec, tags = timeApi.tagsFor(x); return `<tr><td class="num">${U.fmtDate(x.day, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td class="hide-sm">${timeApi.shiftCell(x)}</td><td>${r ? pill[r.s] : '<span class="pill">Not marked</span>'}${tags ? `<div class="tm-tags">${tags}</div>` : ''}</td><td class="num muted"><div class="loc-cell">${selfieThumb(me().id, x.day, r)}<span>${r?.in || '—'}</span></div></td><td class="num muted">${r?.out || '—'}</td><td class="r num">${r?.in ? (r.out ? hoursBetween(r.in, r.out) : 8).toFixed(1) : '—'}</td>
          <td><div class="row-actions">${x.ev.unapproved ? `<button class="btn btn-sm" data-act="tm-request-day" data-id="${x.day}" data-v="ot">Ask for OT</button>` : x.ev.late ? `<button class="btn btn-sm btn-ghost" data-act="tm-request-day" data-id="${x.day}" data-v="waiver">Waive</button>` : x.day < T && (!r || (r.in && !r.out)) && x.type === 'normal' && !x.leave ? `<button class="btn btn-sm btn-ghost" data-act="tm-request-day" data-id="${x.day}" data-v="correction">Correct</button>` : ''}</div></td></tr>`; }).join('')}</tbody>
      </table></div></div>`;
  };

  VIEWS['my-pay'] = () => {
    const e = me(), runs = myRuns();
    const items = runs.map((m) => ({ m, it: state.payroll[m].items.find((i) => i.empId === e.id), run: state.payroll[m] }));
    const ytd = items.filter((x) => x.m.startsWith(U.today().slice(0, 4))).reduce((a, x) => ({ gross: a.gross + x.it.gross, net: a.net + x.it.net, tax: a.tax + x.it.tax, epf: a.epf + (x.it.epf || 0) + (x.it.erEpf || 0) }), { gross: 0, net: 0, tax: 0, epf: 0 });
    return `
      <div class="page-head"><div><div class="eyebrow">Finance</div><h1>Payslips</h1><p class="sub">Annual salary ${money(e.salary)}. Payslips appear here once payroll is paid.</p></div>
        <div class="actions"><a class="btn" href="#my-plan">${icon('target')}Plan my month</a></div></div>
      <div class="grid g-4 keep-2">
        <div class="card kpi"><div class="kpi-label">Gross this year</div><div class="kpi-value">${compactMoney(ytd.gross)}</div><div class="kpi-foot num">${money(ytd.gross)}</div></div>
        <div class="card kpi"><div class="kpi-label">Tax (PCB) this year</div><div class="kpi-value">${compactMoney(ytd.tax)}</div><div class="kpi-foot num">${money(ytd.tax)}</div></div>
        <div class="card kpi"><div class="kpi-label">Into your EPF this year</div><div class="kpi-value">${compactMoney(ytd.epf)}</div><div class="kpi-foot">Your share and the company’s</div></div>
        <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Net this year</div><div class="kpi-value">${compactMoney(ytd.net)}</div><div class="kpi-foot num">${money(ytd.net)}</div></div>
      </div>
      <div class="card card-flush"><div class="table-wrap"><table>
        <thead><tr><th>Period</th><th class="hide-sm">Paid on</th><th class="r">Gross</th><th class="r hide-sm">Deductions</th><th class="r hide-sm">Claims</th><th class="r">Net</th><th></th></tr></thead>
        <tbody>${items.map(({ m, it, run }) => `<tr class="clickable" data-act="my-payslip" data-id="${m}"><td>${U.fmtMonth(m)}</td><td class="hide-sm muted num">${U.fmtDate(run.paidOn)}</td><td class="r num">${money(it.gross, 2)}</td><td class="r num muted hide-sm">−${money(it.tax + it.benefits + (it.zakat || 0), 2)}</td><td class="r num hide-sm">${it.claims ? money(it.claims, 2) : '<span class="faint">—</span>'}</td><td class="r num" style="font-weight:600">${money(it.net, 2)}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="my-payslip" data-id="${m}">${icon('doc')}View</button><button class="btn btn-sm" data-act="pd-my-slip" data-id="${m}" aria-label="Save ${U.fmtMonth(m)} payslip as PDF">${icon('download')}PDF</button></div></td></tr>`).join('')}</tbody>
      </table>${items.length ? '' : '<div class="empty"><strong>No payslips yet</strong>Your first payslip appears after payroll runs.</div>'}</div></div>
      ${docsApi.myTaxCard(e)}`;
  };

  VIEWS['my-profile'] = () => {
    const e = me(), cyc = appraisalApi.current(), r = state.reviews.find((x) => x.empId === e.id && (!cyc || x.cycleId === cyc.id)), mgr = emp(e.manager);
    return `
      <div class="page-head"><div><h1>Profile</h1><p class="sub">Your details, documents and what’s been issued to you. Changes to your details go to HR to approve.</p></div></div>
      <div class="grid g-2">
        <div>
          <div class="card">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px">${avatar(fullName(e), 'lg')}<div><h2 style="font-size:22px">${esc(fullName(e))}</h2><div class="muted">${esc(e.role)}</div><div style="margin-top:6px">${deptTag(e.dept)}</div></div></div>
            <dl class="kv" style="margin:0"><dt>Work email</dt><dd>${esc(e.email)}</dd><dt>Reports to</dt><dd>${mgr ? esc(fullName(mgr)) : '—'}</dd><dt>Start date</dt><dd>${U.fmtDate(e.start)}</dd><dt>Type</dt><dd>${esc(e.type)}</dd><dt>Location</dt><dd>${esc(e.location || '—')}</dd></dl>
          </div>
          <div class="card">
            <div class="card-head"><h3>${esc(r?.cycle || 'Appraisal')}</h3>${r ? `<span class="pill ${({ Completed: 'ok', 'In progress': 'info', 'Not started': '' })[r.status]}">${r.status}</span>` : ''}</div>
            ${r ? `<div class="kpi"><div class="kpi-label">Goal progress</div><div class="kpi-value">${r.progress}%</div><div class="progress"><i style="width:${r.progress}%"></i></div><div class="kpi-foot" style="margin-top:6px">${AllurusAppraisalRules.STAGES[r.stage] || ''}${r.final ? ` · grade ${esc(r.final.grade)}` : ''}</div></div>` : '<div class="empty">No review yet.</div>'}
            <div class="actions" style="margin-top:14px"><a class="btn" href="#my-appraisal">${icon('trend')}Appraisal and goals</a></div>
          </div>
        </div>
        <div>${hrApi.myProfileCards(e)}</div>
      </div>`;
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
  const WS_KEYS = ['settings', 'departments', 'employees', 'leaves', 'attendance', 'payroll', 'jobs', 'candidates', 'reviews', 'activity', 'finance', 'claims', 'plans', 'leaveCarry', 'leaveCredits', 'rosters', 'timeRequests', 'attAudit', 'statutory', 'projects', 'notifications', 'outbox', 'announcements', 'notifyKeys', 'reminderRun', 'cycles', 'goals', 'payChanges', 'editRequests', 'checklists', 'assets', 'loans', 'insurance', 'documents', 'costing', 'savedReports', 'requisitions', 'courses', 'enrolments', 'trainingRequests', 'grievances', 'rooms', 'bookings', 'ops'];
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
      settings: { ...base.settings, company: d.name, domain, office: d.city, currency: d.currency, checkin: defaultZone(d.name) },
      departments: base.departments.map((x) => ({ ...x, lead: withSamples ? x.lead : (x.id === 'd-people' ? 'e1' : '') })),
      employees: [admin], leaves: [], attendance: {}, payroll: {}, jobs: [], candidates: [],
      reviews: [], cycles: [], goals: [], payChanges: [], editRequests: [], checklists: [], assets: [], loans: [], insurance: [], documents: [], costing: { groups: [], jobs: [], timesheets: [] }, savedReports: [], requisitions: [], courses: [], enrolments: [], trainingRequests: [], grievances: [], rooms: [], bookings: [],
      activity: [{ t: Date.now(), text: `${d.name} joined Allurus on the ${plan(d.plan).name} plan` }],
      finance: AllurusFinance.blank({ taxLabel: d.currency === 'MYR' ? 'SST' : 'Sales tax' }),
      claims: [], plans: {}, leaveCarry: {}, leaveCredits: [], rosters: {}, timeRequests: [], attAudit: [], statutory: { filed: {}, eaIssued: {}, formEFiled: {} }, projects: [], notifications: [], outbox: [], announcements: [], notifyKeys: [],
    };
    if (withSamples) {
      const team = base.employees.slice(1).map((e) => ({ ...e, email: `${e.first}.${e.last}`.toLowerCase() + '@' + domain, location: d.city }));
      Object.assign(ws, { employees: [admin, ...team], leaves: base.leaves, attendance: base.attendance, payroll: base.payroll, jobs: base.jobs, candidates: base.candidates, reviews: base.reviews, cycles: base.cycles, goals: base.goals, payChanges: base.payChanges, editRequests: base.editRequests, checklists: base.checklists, assets: base.assets, loans: base.loans, insurance: base.insurance, documents: base.documents, costing: base.costing, requisitions: base.requisitions, courses: base.courses, enrolments: base.enrolments, trainingRequests: base.trainingRequests, grievances: [], rooms: base.rooms, bookings: base.bookings, finance: base.finance, claims: base.claims, leaveCarry: base.leaveCarry, leaveCredits: base.leaveCredits, rosters: base.rosters, timeRequests: base.timeRequests, attAudit: [], statutory: base.statutory, projects: base.projects });
    }
    ws.settings.leave = AllurusLeaveRules.defaultSettings({ state: d.currency === 'MYR' ? (AllurusLeaveRules.CITY_STATE[d.city] || '') : '', departments: ws.departments, hr: 'e1' });
    ws.settings.employer = withSamples ? { ...base.settings.employer } : { signatory: d.adminName.trim(), signatoryTitle: 'HR Administrator' };
    ws.settings.time = withSamples ? JSON.parse(JSON.stringify(base.settings.time)) : AllurusTimeRules.defaultSettings({ restDays: AllurusLeaveRules.weekendDays(ws.settings.leave) });
    ws.settings.grievance = { ...AllurusSeed.talentDefaults().grievance, managers: ['e1'] };
    if (!withSamples) { ws.courses = AllurusSeed.talentDefaults().courses; }
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
        <div class="field"><label for="rg-city">Head office</label><select class="select" id="rg-city" name="city">${cities}</select><span class="field-hint">Places your company on the Allurus map. You’ll pin the exact check-in point in Settings.</span></div>
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
        if (CLOUD) {
          if (!fire()) { toast('Still connecting to the server. Try again in a moment.'); return false; }
          const ws = newWorkspace({ ...d, email }, !!d.samples);
          toast('Creating your workspace…');
          fire().register({ ...d, email, city: c.name, country: c.country, seats }, ws).then((res) => {
            if (!res.ok) { toast(res.error, 'error'); return; }
            startSession(state.accounts[0]); toast(`Welcome to Allurus, ${d.name}. We’ve sent a link to confirm your email.`);
          });
          return;
        }
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
  // Where check-ins are measured from: always the saved check-in point; the head office city only when none is set.
  const zone = () => U.resolveZone(state.settings);

  // ---------- Demo: one check-in point for every phone ----------
  // In demo mode each browser keeps its own copy of the company, so a point the demo admin sets would stay on their
  // computer. The point (only that: coordinates, radius, name, field staff) is also kept in the cloud database at
  // demoZones/<demo company>, through Firestore's REST interface, and phones pick it up when the app opens, when
  // they come back to it, and every minute. Anyone using the public demo can move it; that is all it holds.
  // Needs the demoZones rule in firestore.rules to be published; without it this does nothing and the setup link
  // still works.
  const demoZone = (() => {
    const cfg = window.ALLURUS_FIREBASE;
    const on = () => !CLOUD && !!cfg?.apiKey && !!cfg?.projectId && state.settings?.company === DEMO.name;
    const url = () => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/demoZones/${DEMO.id}?key=${cfg.apiKey}`;
    let sent = 0, busy = false;
    const pack = (c) => ({ fields: {
      lat: { doubleValue: +c.lat }, lng: { doubleValue: +c.lng }, radius: { integerValue: String(Math.round(c.radius || 50)) },
      label: { stringValue: String(c.label || '').slice(0, 79) }, field: { arrayValue: { values: (c.field || []).slice(0, 49).map((x) => ({ stringValue: String(x) })) } },
      setAt: { integerValue: String(Math.round(c.setAt)) },
    } });
    const num = (v) => (v ? Number(v.doubleValue ?? v.integerValue) : NaN);
    function publish() {
      if (!on()) return;
      const c = state.settings.checkin;
      if (!c?.setAt || c.setAt <= sent || !U.hasCoords(c) || c.setAt <= (DEMO.published?.at || 0)) return;
      sent = c.setAt;
      fetch(url(), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pack(c)) })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); console.info('[check-in] demo point shared', pack(c).fields); })
        .catch((e) => { sent = 0; console.warn('[check-in] demo point not shared:', e.message); toast('Saved on this computer only: phones can’t get the new check-in point yet (shared point not available)', 'error'); });
    }
    async function pull() {
      if (!on() || busy) return;
      busy = true;
      try {
        const r = await fetch(url(), { cache: 'no-store' });
        if (!r.ok) return;
        const f = (await r.json()).fields || {};
        const p = { lat: num(f.lat), lng: num(f.lng), radius: num(f.radius), setAt: num(f.setAt), label: f.label?.stringValue || '', field: (f.field?.arrayValue?.values || []).map((v) => v.stringValue) };
        const c = state.settings.checkin || (state.settings.checkin = {});
        if (!U.hasCoords(p) || !(p.setAt > (c.setAt || 0))) return;
        Object.assign(c, { lat: p.lat, lng: p.lng, radius: Math.min(5000, Math.max(10, p.radius || 50)), label: p.label || c.label, field: p.field, setAt: p.setAt });
        sent = p.setAt;
        saveLocal();
        if (role()) { render(); toast(`HR updated the check-in point: ${c.label}`, 'info'); }
      } catch (e) { /* offline or not published: keep this phone's point */ } finally { busy = false; }
    }
    return { publish, pull };
  })();
  demoZone.pull();
  setInterval(() => demoZone.pull(), 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') demoZone.pull(); });
  const lockOn = () => zone().deviceLock !== false;
  const faceOn = () => zone().faceCheck !== false;
  const liveOnly = () => zone().liveOnly !== false;
  const mapsLink = (p) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
  // Field staff (for example sales) may check in from anywhere. Only an admin can grant it, per person.
  // The selfie, face check and phone lock still apply; only the location rule is lifted.
  // Stored on the check-in settings so the setup link carries it to staff phones.
  const isField = (e) => !!e && (state.settings.checkin.field || []).includes(e.id);
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
  // What to tell someone whose phone gave no position, by the reason and the kind of phone.
  function locationHelp(why) {
    const ua = navigator.userAgent || '', ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp/i.test(ua);
    if (why === 'denied') {
      if (ios) return ['Location is blocked for this site', `On your iPhone: open <b>Settings → Privacy &amp; Security → Location Services</b>, make sure it is on, then tap <b>Safari Websites</b> and choose <b>While Using the App</b> (turn on <b>Precise Location</b>). Then in Safari tap <b>aA</b> (or the page menu) → <b>Website Settings → Location → Allow</b>, reload this page and try again.${inApp ? ' If you opened this from WhatsApp, tap the Safari icon to open it in Safari first.' : ''}`];
      return ['Location is blocked for this site', `Turn on your phone’s location, then allow it for this site: in Chrome tap the icon left of the address → <b>Permissions → Location → Allow</b>, reload and try again.${inApp ? ' If you opened this from an app such as WhatsApp, open it in Chrome first.' : ''}`];
    }
    if (why === 'timeout') return ['Couldn’t get a GPS fix', 'Your phone took too long to find you, which happens indoors. Move near a window or step outside for a moment, make sure location is on with <b>Precise Location</b>, then try again.'];
    if (why === 'unsupported') return ['This browser can’t share your location', 'Open this page in Safari (iPhone) or Chrome (Android) and try again.'];
    return ['Location is off', `Check-in needs your phone’s GPS position. Turn on location${ios ? ' (Settings → Privacy &amp; Security → Location Services)' : ''}, allow it for this site, then try again.`];
  }

  // ----- Location gate: an employee's phone must share its location before using the app -----
  // A web page can't open the phone's Settings app, so on a phone the employee app shows a screen that stays until
  // location is allowed: it asks the browser at once (one tap), or, if location is blocked, shows the steps and
  // checks again by itself when they come back from Settings. Field staff and computers are not asked.
  let gateState = '', gateBusy = false;
  async function locPermission() {
    try { const r = await navigator.permissions.query({ name: 'geolocation' }); return r.state; } catch (e) { return ''; }
  }
  function gateHtml(perm, why) {
    const [title, how] = perm === 'denied' ? locationHelp('denied') : why ? locationHelp(why) : ['Turn on your location', `${esc(state.settings?.company || '')} checks you in at ${esc(zone().label)}. Allow location so the app can see you’re there. It’s only read when you check in.`];
    return `<div class="loc-gate" role="dialog" aria-modal="true" aria-labelledby="loc-gate-t"><div class="loc-gate-card">
      <div class="loc-gate-icon">${icon('pin')}</div><h2 id="loc-gate-t">${title}</h2><p>${how}</p>
      <div class="loc-gate-actions"><button class="btn btn-primary btn-lg" data-act="loc-allow">${perm === 'denied' ? 'I’ve turned it on, check again' : 'Allow location'}</button>
      <button class="btn btn-ghost" data-act="logout">Sign out</button></div></div></div>`;
  }
  function showGate(perm, why = '') {
    let g = document.getElementById('loc-gate-root');
    if (!g) { g = document.createElement('div'); g.id = 'loc-gate-root'; document.body.appendChild(g); }
    g.innerHTML = gateHtml(perm, why);
  }
  const hideGate = () => { const g = document.getElementById('loc-gate-root'); if (g) g.innerHTML = ''; };
  const gateNeeded = () => role() === 'employee' && onPhone() && !kioskApi?.kioskOn() && !isField(me()) && zone().source === 'checkin' && !!navigator.geolocation;
  async function checkLocationGate() {
    if (!gateNeeded()) { hideGate(); return; }
    const perm = await locPermission();
    gateState = perm;
    if (perm === 'granted') { hideGate(); return; }
    // Safari asks again in each visit unless the site is set to Allow; ask once per visit, not on every page.
    if (perm === 'prompt' || perm === '') { try { if (sessionStorage.getItem('loc-ok')) { hideGate(); return; } } catch (e) { /* no storage */ } }
    showGate(perm === 'denied' ? 'denied' : 'prompt');
  }
  async function gateAllow() {
    if (gateBusy) return;
    gateBusy = true;
    const btn = document.querySelector('[data-act=loc-allow]'); if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    const loc = await U.locate({ gpsOnly: true });
    gateBusy = false;
    if (loc) { try { sessionStorage.setItem('loc-ok', '1'); } catch (e) { /* no storage */ } hideGate(); toast('Location is on. You can check in.'); return; }
    const why = U.locateError();
    showGate(why === 'denied' ? 'denied' : 'prompt', why === 'denied' ? '' : why);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gateState && gateState !== 'granted') checkLocationGate(); });
  document.addEventListener('click', (ev) => { if (ev.target.closest('[data-act=loc-allow]')) { ev.preventDefault(); gateAllow(); } });

  async function ciLocate() {
    const z = zone();
    if (isField(me())) {
      ciStep(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Noting where you are</strong><p class="muted">You can check in from anywhere. Your location is saved with the check-in if your phone shares it.</p></div></div>`);
      const loc = await U.locate({ gpsOnly: true });
      if (!$('#ci-body')) return;
      ci.loc = { ...(loc || { lat: null, lng: null, accuracy: null }), field: true, inside: true, m: loc && z.source === 'checkin' ? U.checkZone(loc, z).m : null };
      ci.loc.flags = kioskApi.gpsCheck(me(), ci.loc);
      ciSelfie();
      return;
    }
  // Never guess: without a check-in point set by HR there is nothing to measure against.
    if (z.source !== 'checkin') {
      ciProblem('Your admin hasn’t set a check-in location yet', `Ask HR to set the check-in point in Settings, then send you the setup link. ${esc(state.settings.company)} check-ins open once it’s set.`);
      return;
    }
    ciStep(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>Finding your location</strong><p class="muted">Allow location access if your browser asks. You need to be within ${z.radius} m of ${esc(z.label)}.</p></div></div>`);
    const loc = await U.locate({ gpsOnly: true });
    if (!$('#ci-body')) return;
    if (!loc) {
      const [title, how] = locationHelp(U.locateError());
      ciProblem(title, how);
      return;
    }
    const { m, inside } = U.checkZone(loc, z);
    // Debug trail for phone testing: where the phone is, where it measures from, and the Haversine distance.
    console.info('[check-in]', { phone: { lat: loc.lat, lng: loc.lng }, accuracyM: loc.accuracyRaw ?? loc.accuracy, target: { lat: z.lat, lng: z.lng, label: z.label }, radiusM: z.radius, distanceM: m, inside, company: state.settings.company, demo: CLOUD ? null : DEMO.id });
    const debug = `<dl class="kv zone-debug"><dt>Check-in point</dt><dd class="num">${U.fmtCoords(z)} · ${z.radius} m</dd><dt>You are at</dt><dd class="num">${U.fmtCoords(loc)} · ±${loc.accuracy} m</dd>
      <dt>Distance</dt><dd class="num">${m} m</dd>${z.setAt ? `<dt>Point updated</dt><dd>${pointWhen(z)}</dd>` : ''}<dt>Record</dt><dd>${CLOUD ? 'Real account' : `Demo (${esc(DEMO.id)})`}</dd></dl>`;
    // A fix less precise than the zone itself can't tell inside from outside: ask for a better one, never guess.
    if (ci.mode === 'present' && loc.accuracy > z.radius) {
      ciProblem('Your GPS reading isn’t precise enough', `Your phone is accurate to ±${loc.accuracy} m, but the check-in zone is ${z.radius} m. Turn on Precise Location, move near a window or outside, and try again.`, debug);
      return;
    }
    loc.m = m;
    loc.inside = inside;
    // Fake-GPS heuristics flag the check-in for HR; they never block it.
    loc.flags = kioskApi.gpsCheck(me(), loc);
    ci.loc = loc;
    if (ci.mode === 'present' && !loc.inside) {
      ciProblem(`You are ${U.fmtDist(m)} from ${esc(z.label)}`, `Move inside the ${z.radius} m check-in zone and try again. Your GPS accuracy is ±${loc.accuracy} m.`,
        `<div class="map-canvas map-sm" id="ci-map" role="img" aria-label="Map of the check-in zone and your position"></div>
        ${debug}
        <a class="hint" href="${mapsLink(z)}" target="_blank" rel="noopener">Open the check-in point in Google Maps</a>`);
      AllurusMap.preview($('#ci-map'), z, loc).catch((e) => { console.warn('Check-in map unavailable:', e); $('#ci-map')?.remove(); });
      return;
    }
    ciSelfie();
  }
  function ciWhere() {
    const z = zone(), L = ci.loc;
    if (L.field) return `<div class="ci-where ok">${icon('pin')}<span>Field check-in · ${L.lat != null ? `location saved (±${L.accuracy} m)` : 'location not shared'}</span></div>`;
    return `<div class="ci-where ${L.inside ? 'ok' : ''}">${icon(L.inside ? 'check' : 'pin')}<span>${L.inside ? `Inside the check-in zone · ${U.fmtDist(L.m)} from ${esc(z.label)} (${U.fmtCoords(z)}, ±${L.accuracy} m)` : `Remote · ${U.fmtDist(L.m)} from ${esc(z.label)}`}</span></div>`;
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
    if (!faces.length) { ciProblem('No face found', 'Face the camera in good light.', '', retake); return; }
    if (faces.length > 1) { ciProblem('More than one face found', 'Only you should be in your check-in selfie. Retake it on your own.', '', retake); return; }
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
    ciStep(`${ciWhere()}${f ? FACE_NOTE[f.result](f) : ''}${ci.loc?.flags?.length ? `<div class="ci-where">${icon('pin')}<span>HR will double-check this location.</span></div>` : ''}${navigator.onLine === false ? `<div class="ci-where">${icon('clock')}<span>You’re offline. The check-in is saved on this phone and syncs later.</span></div>` : ''}<div class="ci-cam"><img class="ci-photo" src="${ci.photo}" alt="Your selfie"></div>
      ${kioskApi.projectField('ci-project', [myRecord(U.today())?.project, myRecord(U.today())?.job].filter(Boolean).join('|'))}
      <div class="ci-actions"><button class="btn" data-act="ci-retake">Retake</button><button class="btn btn-primary" data-act="ci-confirm">${icon('check')}${f?.result === 'mismatch' ? 'Check in for HR review' : `Check in at ${nowHM()}`}</button></div>`);
  }
  // Saves a check-in for e today: a new record, or a new session after a check-out (the first check-in time is
  // kept so hours still count from it, and the earlier session goes into the day's history). Used by the
  // employee's own check-in, the kiosk and supervisor check-in.
  function writeCheckin(e, { mode = 'present', time, photo, loc, face = null, device, upload = false, via = 'self', by = '', project = '', flags = [], offline = false }) {
    const T = U.today();
    state.attendance[T] = state.attendance[T] || {};
    // The picker sends "project|job" when a job is chosen; costing reads both.
    const [pj = '', job = ''] = String(project || '').split('|');
    const extra = { photo, loc, face, device, upload, via, by, project: pj, job, flags, offline, reviewed: null, syncedAt: '' };
    const prev = state.attendance[T][e.id];
    if (prev?.in && prev.out) {
      prev.history = [...(prev.history || []), { in: prev.lastIn || prev.in, out: prev.out, photo: prev.photo, loc: prev.loc, face: prev.face, via: prev.via, project: prev.project, job: prev.job || '' }];
      Object.assign(prev, { s: mode, out: '', lastIn: time, ...extra });
    } else {
      state.attendance[T][e.id] = { s: mode, in: time, out: '', ...extra };
    }
    pruneSelfies();
    const tn = currentTenant(); if (tn) tn.lastActive = T;
    return state.attendance[T][e.id];
  }
  function ciConfirm() {
    const L = ci.loc, T = U.today(), t = nowHM(), z = zone(), e = me();
    if (!L || !ci.photo) return;
    const project = kioskApi.pickedProject('ci-project');
    if (project === false) return;
    const loc = L.field
      ? { lat: L.lat, lng: L.lng, accuracy: L.accuracy, source: L.lat != null ? 'gps' : 'none', field: true, m: L.m, zone: z.label }
      : { lat: L.lat, lng: L.lng, accuracy: L.accuracy, label: L.label, source: 'gps', m: L.m, inside: L.inside, zone: z.label, radius: z.radius, zoneAt: { lat: z.lat, lng: z.lng, source: z.source } };
    const face = ci.face ? { result: ci.face.result, sim: ci.face.sim ?? null } : null;
    const device = { id: deviceId(), name: deviceName() };
    if (ci.first && lockOn()) {
      e.devices = [...(e.devices || []), { id: device.id, name: device.name, status: 'approved', added: T, auto: true }];
      log(`${fullName(e)} registered a phone for check-in (${device.name})`);
    }
    if (ci.face?.result === 'enrolled') e.face = { photo: ci.photo, descriptor: ci.face.descriptor, status: 'pending', enrolledOn: T, consentOn: T };
    const offline = navigator.onLine === false;
    const rec = writeCheckin(e, { mode: ci.mode, time: t, photo: ci.photo, loc, face, device, upload: ci.upload, via: 'self', project, flags: L.flags || [], offline });
    const where = L.field ? (L.m != null ? `field · ${U.fmtDist(L.m)} from ${z.label}` : 'field') : `${U.fmtDist(L.m)} from ${z.label}`;
    // Every check-in goes through the outbox, so one taken offline reaches the server when the phone reconnects.
    kioskApi.rememberFix(L);
    kioskApi.queue(e, T, rec, 'self');
    closeOverlay();
    const flagged = face && ['mismatch', 'unavailable'].includes(face.result);
    if (!flagged) setTimeout(() => AllurusUX.celebrate(), 150);
    commit(offline ? `Checked in at ${t}, captured offline. It syncs when you’re back online.` : flagged ? `Checked in at ${t}. HR will review your selfie.` : `Checked in at ${t}`,
      `${fullName(e)} checked in${ci.mode === 'remote' ? ' remotely' : ''} with a selfie, ${where}${face?.result === 'mismatch' ? '. The face did not match.' : ''}`);
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
    const flagged = kioskApi ? kioskApi.flagged() : [];
    return { devices, faces, flagged, count: devices.length + faces.length + flagged.length };
  }
  function securityCard() {
    const q = securityQueue();
    if (!q.count) return '';
    return `<div class="card" id="sec-review"><div class="card-head"><h3>Check-ins, phones and faces to review</h3><span class="hint">${q.count} items</span></div><div class="list">
      ${q.faces.map((e) => `<div class="list-item"><img class="ref-thumb" src="${e.face.photo}" alt="Reference photo of ${esc(fullName(e))}"><div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">New reference photo from ${U.fmtDate(e.face.enrolledOn)}. Is this really ${esc(e.first)}?</div></div>
        <button class="btn btn-sm btn-ok" data-act="face-confirm" data-id="${e.id}">${icon('check')}It’s ${esc(e.first)}</button><button class="btn btn-sm btn-danger" data-act="face-reset" data-id="${e.id}">Not them</button></div>`).join('')}
      ${q.devices.map(({ e, d }) => `<div class="list-item">${avatar(fullName(e), 'sm')}<div class="grow"><div class="person-name">${esc(fullName(e))}</div><div class="person-sub">Wants to check in from a new phone: ${esc(d.name)}, requested ${U.fmtDate(d.added)}</div></div>
        <button class="btn btn-sm btn-ok" data-act="dev-approve" data-id="${e.id}" data-v="${d.id}">Approve</button><button class="btn btn-sm btn-danger" data-act="dev-reject" data-id="${e.id}" data-v="${d.id}">Reject</button></div>`).join('')}
      ${kioskApi.reviewItems()}
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
        <dt>Phone</dt><dd>${r.device ? esc(r.device.name) : '—'}${r.via && r.via !== 'self' ? ` · ${esc(kioskApi.viaText(r))}` : ''}${r.offline ? ` · captured offline${r.syncedAt ? ', synced' : ', waiting to sync'}` : ''}</dd>
        ${r.flags?.length ? `<dt>GPS checks</dt><dd>${r.flags.map((f) => esc(f.reason)).join('<br>')}</dd>` : ''}
        ${r.project && kioskApi.projectOf(r.project) ? `<dt>Project</dt><dd>${esc(kioskApi.projectOf(r.project).code)} · ${esc(kioskApi.projectOf(r.project).name)}</dd>` : ''}
        <dt>Checked in</dt><dd>${r.in}${r.out ? ` · out ${r.out}` : ''}</dd><dt>Location</dt><dd>${r.loc ? esc(locText(r.loc)) : '—'}</dd>
        ${r.loc?.lat != null ? `<dt>Coordinates</dt><dd><a href="${mapsLink(r.loc)}" target="_blank" rel="noopener">${U.fmtCoords(r.loc)}</a></dd>` : ''}
        ${r.history?.length ? `<dt>Earlier today</dt><dd>${r.history.map((h) => `${h.in}–${h.out}`).join(', ')} · latest check-in ${r.lastIn}</dd>` : ''}</dl></div>`,
    });
  }
  const locText = (loc) => {
    if (!loc) return '';
    if (loc.field) return loc.lat != null ? `Field check-in · GPS ±${loc.accuracy} m${loc.m != null ? ` · ${U.fmtDist(loc.m)} from ${loc.zone || 'check-in point'}` : ''}` : 'Field check-in · location not shared';
    if (loc.m != null) return `${loc.inside ? 'Inside zone' : 'Outside zone'} · ${U.fmtDist(loc.m)} from ${loc.zone || 'check-in point'} · GPS ±${loc.accuracy} m`;
    const how = loc.source === 'gps' ? `GPS ±${loc.accuracy < 1000 ? loc.accuracy + ' m' : (loc.accuracy / 1000).toFixed(1) + ' km'}` : 'approx. from time zone';
    return `${loc.label} (${how})`;
  };
  const selfieThumb = (empId, day, r) => (r?.photo ? `<button class="selfie-thumb" data-act="view-selfie" data-id="${empId}" data-v="${day}" aria-label="View selfie"><img src="${r.photo}" alt=""></button>` : '');
  function securitySection(e) {
    const devs = e.devices || [];
    const field = isField(e);
    return `<div class="drawer-section"><h4>Check-in location</h4>
      <div class="settings-row" style="padding:0"><div><div class="label">Check in from anywhere</div><div class="desc">For field staff such as sales. The selfie and face check still apply; only the location rule is lifted.</div></div>
        <div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="field-toggle" data-id="${e.id}" data-v="${v}" class="${(field ? 'on' : 'off') === v ? 'on' : ''}" ${role() === 'admin' ? '' : 'disabled'}>${l}</button>`).join('')}</div></div></div>
      <div class="drawer-section"><h4>Check-in identity</h4>
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
    // Demo mode only: in the cloud, companies are opened by Allurus (superadmin), not by sign-up.
    'register': () => { if (CLOUD) return; openRegister(); },
    // Demo mode only: sign in as one of the sample people without a password.
    'demo-as': (_, email) => { if (CLOUD) return; const a = state.accounts.find((x) => x.email === email); if (a) startSession(a); },
    'cloud-reset': () => {
      openModal({
        title: 'Reset your password', submit: 'Send reset link', size: 'sm',
        body: `<p class="muted" style="margin-bottom:12px">We’ll email you a link to choose a new password.</p><div class="field"><label for="rs-email">Work email</label><input class="input" id="rs-email" name="email" type="email" required value="${esc($('#login-email')?.value || '')}"></div>`,
        onSubmit(d) {
          if (!fire()) { toast('Still connecting to the server. Try again in a moment.'); return false; }
          fire().resetPassword(d.email).then((r) => toast(r.ok ? `If ${d.email.trim()} has an Allurus account, a reset link is on its way.` : r.error, r.ok ? '' : 'error'));
        },
      });
    },
    // First-time sign-in moved to its own page, from the invitation email.
    'cloud-activate': () => { location.href = '/activate'; },
    'acc-invite': (empId) => teamAccess.invite(empId),
    'acc-invite-all': () => teamAccess.inviteAll(),
    'acc-bulk': () => teamAccess.bulk([...(ui.empSel || [])]),
    'emp-sel-none': () => { ui.empSel = new Set(); render(); },
    'acc-cancel': (email) => teamAccess.cancel(email),
    'acc-disable': (uid) => teamAccess.setDisabled(uid, true),
    'acc-enable': (uid) => teamAccess.setDisabled(uid, false),
    'acc-revoke': (email) => teamAccess.revoke(email),
    'toggle-pw': () => { const i = $('#login-password'), b = $('[data-act="toggle-pw"]'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); },
    'logout': () => {
      if (CLOUD) { closeOverlay(); fire()?.signOut().finally(() => { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage unavailable */ } location.hash = ''; location.reload(); }); return; }
      Object.assign(state.session, { account: null, roles: [], role: null }); closeOverlay(); save(); history.replaceState(null, '', location.pathname + location.search); render(); toast('Signed out'); },
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
    'field-toggle': (empId, v) => {
      if (role() !== 'admin') { toast('Only an admin can change this.', 'error'); return; }
      const e = emp(empId); if (!e) return;
      const c = state.settings.checkin, list = new Set(c.field || []);
      if (v === 'on') list.add(empId); else list.delete(empId);
      c.field = [...list]; c.setAt = Date.now();
      commit(v === 'on' ? `${e.first} can now check in from anywhere. Send staff the updated setup link.` : `${e.first} must check in at ${zone().label} again. Send staff the updated setup link.`,
        `${fullName(e)} ${v === 'on' ? 'can now check in from anywhere (field staff)' : 'was set back to check in at the office'}`);
      if ($('.drawer')) openProfile(empId);
    },
    'sec-toggle': (key, v) => {
      state.settings.checkin[key] = v === 'on';
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
      setZonePoint(loc, 'gps');
      zonePicker?.setPoint(loc, { zoom: 18 });
      if (loc.accuracy > zone().radius) toast(`Your GPS is only accurate to ±${loc.accuracy} m, more than the ${zone().radius} m radius. Drag the pin to the exact spot.`, 'info');
    },
    'zone-link': () => {
      const z = zone();
      if (z.source !== 'checkin') { toast('Set the check-in point first.', 'error'); return; }
      const q = new URLSearchParams({ co: state.settings.company, lat: z.lat, lng: z.lng, r: z.radius, label: z.label, field: (state.settings.checkin.field || []).join(','), t: z.setAt || Date.now() });
      const url = `${location.origin}${location.pathname}#setup?${q}`;
      const done = () => toast('Setup link copied. Send it to staff to open once on their phone.');
      (navigator.clipboard?.writeText(url) || Promise.reject()).then(done, () => openModal({ title: 'Setup link for staff phones', size: 'sm', submit: null, body: `<p class="muted" style="margin-bottom:10px">Copy this link and send it to staff. Opening it once makes their phone use this check-in point.</p><textarea class="textarea" readonly style="width:100%;min-height:110px" onfocus="this.select()">${esc(url)}</textarea>` }));
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
  function closeOverlay() { const had = $('#overlay-root').children.length; stopCamera(); $('#overlay-root').innerHTML = ''; if (had) AllurusUX.restoreFocus(); }
  function openModal({ title, body, submit = 'Save', onSubmit, size = '' }) {
    $('#overlay-root').innerHTML = `<div class="scrim" data-scrim><form class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate>
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn btn-icon btn-ghost" data-act="close-overlay" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"><button type="button" class="btn" data-act="close-overlay">${submit ? 'Cancel' : 'Done'}</button>${submit ? `<button type="submit" class="btn btn-primary">${esc(submit)}</button>` : ''}</div></form></div>`;
    const form = $('#overlay-root form');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const missing = $$('[required]', form).filter((el) => !el.value.trim());
      $$('.field-error', form).forEach((x) => x.remove());
      $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
      if (missing.length) {
        missing.forEach((el) => { el.setAttribute('aria-invalid', 'true'); const f = el.closest('.field'); if (f) f.insertAdjacentHTML('beforeend', `<span class="field-error" id="${el.id}-err">${icon('x')}Fill this in to continue</span>`); el.setAttribute('aria-describedby', `${el.id}-err`); });
        missing[0].focus(); form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
        toast(`${missing[0].closest('.field')?.querySelector('label')?.textContent || 'A field'} is required`, 'error'); return;
      }
      const d = Object.fromEntries(new FormData(form).entries());
      if (onSubmit?.(d) !== false) closeOverlay();
    });
    AllurusUX.trapFocus(form);
    form.addEventListener('input', (ev) => { if (ev.target.value?.trim() && ev.target.getAttribute('aria-invalid')) { ev.target.removeAttribute('aria-invalid'); document.getElementById(ev.target.id + '-err')?.remove(); } });
    setTimeout(() => $('input:not([type=hidden]), select, textarea', form)?.focus(), 30);
  }
  function openDrawer(html) {
    $('#overlay-root').innerHTML = `<div class="scrim drawer-scrim" data-scrim><aside class="drawer" role="dialog" aria-modal="true">${html}</aside></div>`;
    AllurusUX.trapFocus($('.drawer'));
  }
  // Destructive actions and decisions can be undone for a few seconds from their toast.
  let undoSnap = null;
  function toast(msg, kind) {
    const snap = undoSnap; undoSnap = null;
    AllurusUX.toast(msg, kind || 'ok', snap && kind !== 'error' ? { undo: () => { state = JSON.parse(snap); save(); render(); AllurusUX.toast('Undone', 'info'); } } : {});
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
  function applyTheme() { AllurusUX.applyPrefs(); }

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
      hrApi.remove(id);
      state.goals = (state.goals || []).filter((g) => g.empId !== id);
      state.payChanges = (state.payChanges || []).filter((c) => c.empId !== id);
      state.departments.forEach((d) => { if (d.lead === id) d.lead = ''; });
      state.employees.forEach((e) => { if (e.manager === id) e.manager = ''; });
      closeOverlay(); commit(`${n} removed`, `${n} was removed from the directory`);
    },
    'emp-status': (_, v) => { ui.empStatus = v; render(); },
    // 'export-emps' and 'import-emps' are in js/import/import.js (the export uses the import's headers, so it round-trips).
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
      if (state.attendance[day]?.[id]) timeApi.setRecord(day, id, null, 'Cleared on Attendance');
      commit(`Check-in cleared for ${fullName(emp(id))}`, `${fullName(emp(id))}'s check-in on ${U.fmtDate(day)} was cleared`);
    },
    'att-all': () => {
      const day = ui.attDate; state.attendance[day] = state.attendance[day] || {};
      let n = 0;
      const batch = U.uid('b-');
      activeEmployees().filter((e) => e.start <= day).forEach((e) => { if (!state.attendance[day][e.id]) { const lv = onLeaveOn(e.id, day); timeApi.setRecord(day, e.id, { s: lv ? 'leave' : 'present', in: lv ? '' : timeApi.shiftStart(e, day) || '09:00', out: '' }, 'Marked present in bulk', batch); n++; } });
      commit(n ? `${n} marked present` : 'Everyone is already marked');
    },
    'stat-set': (key, v) => { state.settings.statutory = { ...U.statutory(state.settings), [key]: v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v }; commit('Statutory settings saved'); },
    'pay-shift': (_, v) => { ui.payMonth = U.addMonths(ui.payMonth, Number(v)); render(); },
    'pay-run': () => {
      const mk = ui.payMonth;
      // The owner of a sole proprietorship or partnership draws profits, not a salary, so isn't on the pay run.
      const items = activeEmployees().filter((e) => e.start <= U.monthEnd(mk) && e.type !== 'Owner').map((e) => payItem(e, appraisalApi ? appraisalApi.bonusFor(e.id, mk) : 0, mk));
      if (!items.length) { toast('No employees were active that month'); return; }
      state.payroll[mk] = { status: 'Draft', items };
      commit('Draft created', `Payroll draft created for ${U.fmtMonth(mk)}`);
    },
    'pay-discard': () => { delete state.payroll[ui.payMonth]; commit('Draft discarded'); },
    'pay-approve': () => {
      const run = state.payroll[ui.payMonth]; run.status = 'Paid'; run.paidOn = U.today();
      state.statutory.filed[ui.payMonth] = {};
      claimsApi.markPaid(run.items.flatMap((i) => i.claimIds || []), ui.payMonth);
      appraisalApi.markBonusPaid(ui.payMonth, run.items.filter((i) => i.bonus > 0).map((i) => i.empId));
      notifyApi.event('payroll.paid', { month: ui.payMonth, count: run.items.length, net: money(payTotal(run).net), href: '#payroll' }, 'hr');
      run.items.forEach((i) => notifyApi.event('payslip.ready', { month: ui.payMonth, net: money(i.net, 2), href: '#my-pay' }, i.empId, { self: true }));
      commit('Payroll paid', `Payroll for ${U.fmtMonth(ui.payMonth)} was paid (${money(payTotal(run).net)} net)`);
    },
    'pay-export': () => {
      const run = state.payroll[ui.payMonth];
      downloadCSV(`payroll-${ui.payMonth}.csv`, [['Employee', 'Email', 'Base', 'Unpaid leave days', 'Unpaid leave deduction', 'Overtime', 'Allowances', 'Bonus', 'Gross', 'EPF (employee)', 'SOCSO (employee)', 'EIS (employee)', 'PCB', 'Zakat', 'Claims reimbursed', 'Net pay', 'EPF (employer)', 'SOCSO (employer)', 'EIS (employer)', 'HRD levy', 'Employer cost'],
        ...run.items.map((i) => { const e = emp(i.empId); return [fullName(e), e?.email, i.base, i.unpaidDays || 0, i.unpaid || 0, U.round2((i.extraLines || []).filter((l) => l.key === 'ot').reduce((s, l) => s + l.amount, 0)), U.round2((i.extraLines || []).filter((l) => l.key !== 'ot').reduce((s, l) => s + l.amount, 0)), i.bonus, i.gross, i.epf ?? i.benefits, i.socso || 0, i.eis || 0, i.tax, i.zakat || 0, i.claims || 0, i.net, i.erEpf || 0, i.erSocso || 0, i.erEis || 0, i.hrdf || 0, U.round2(i.gross + (i.erCost || 0))]; })]);
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
    'theme': (_, v) => ACTIONS['ux-pref']('theme', v),
    // Danger zone: type the company name to confirm.
    'ask-reset': () => {
      const name = state.settings.company;
      $('#reset-confirm').innerHTML = `<div class="confirm-bar" style="flex-wrap:wrap"><label for="reset-name" style="flex:1 1 220px">Put ${esc(name)} back to its sample data? Type <b>${esc(name)}</b> to confirm.</label><input class="input" id="reset-name" autocomplete="off" style="width:min(220px,100%)"><button class="btn btn-sm" data-act="cancel-reset">Cancel</button><button class="btn btn-sm btn-danger" data-act="do-reset" disabled>Reset</button></div>`;
      const f = $('#reset-name'), b = $('[data-act=do-reset]');
      f.addEventListener('input', () => { b.disabled = f.value.trim().toLowerCase() !== name.trim().toLowerCase(); });
      f.focus();
    },
    'cancel-reset': () => { $('#reset-confirm').innerHTML = ''; },
    'do-reset': () => { if ($('#reset-name') && $('#reset-name').value.trim().toLowerCase() !== state.settings.company.trim().toLowerCase()) return; state = seedNew(); commit('Workspace reset'); },
    // Switch demo company: each one lives under its own address and storage key.
    'demo-company': (_, id) => { if (CLOUD || id === DEMO.id) return; location.href = `${location.pathname}?demo${id === 'serimaju' ? '' : `=${id}`}`; },
    'menu': () => $('#sidebar').classList.toggle('open'),
    ...ACTIONS_EXTRA,
  };

  const UNDOABLE = new Set(['lv-type-del', 'lv-hol-del', 'del-leave', 'approve-leave', 'reject-leave', 'cand-del', 'cand-move', 'close-job', 'pay-discard', 'att-clear', 'dev-remove', 'cl-cancel', 'cl-approve', 'cl-reject', 'cl-paynow', 'cl-type-del', 'plan-del', 'rel-del', 'fin-del-txn', 'ux-w-hide', 'ro-copy', 'ro-clear', 'tm-approve', 'tm-reject', 'tm-cancel', 'tm-pat-del', 'tm-al-del', 'tm-tpl-del']);
  document.addEventListener('click', (ev) => {
    const scrim = ev.target.closest('[data-scrim]');
    if (scrim && ev.target === scrim) { closeOverlay(); return; }
    const el = ev.target.closest('[data-act]');
    if (!el) {
      if (!ev.target.closest('.sidebar') && !ev.target.closest('.menu-btn')) $('#sidebar').classList.remove('open');
      return;
    }
    // Buttons inside a clickable row should not also open the row.
    const name = el.dataset.act, fn = ACTIONS[name];
    if (!fn) return;
    ev.preventDefault(); ev.stopPropagation();
    if (role()) AllurusUX.onAction(name);
    undoSnap = UNDOABLE.has(name) ? JSON.stringify(state) : null;
    fn(el.dataset.id, el.dataset.v);
    undoSnap = null;
    if (name === 'pay-approve' || (name === 'approve-leave' && !pendingLeaves().length)) AllurusUX.celebrate();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeOverlay();
  });

  // ---------- Finance & Accounting and tax modules ----------
  const moduleCtx = {
    get state() { return state; }, VIEWS, AFTER, ACTIONS, $, $$, esc, icon, money, compactMoney, openModal, closeOverlay, toast, commit, render,
    downloadCSV, role, account, me, LOGO_MARK, emp, fullName, person, avatar, activeEmployees, payTotal, myRuns,
    save, routes, route, ROLES, switchRole, openProfile, openDrawer, claimsOn: () => claimsApi?.enabled(), dept, deptTag,
    get leave() { return leaveApi; }, get time() { return timeApi; }, get notify() { return notifyApi; }, get appraisal() { return appraisalApi; }, get hr() { return hrApi; }, get docs() { return docsApi; }, get einvoice() { return einvApi; }, get lms() { return lmsApi; }, get recruit() { return recruitApi; }, get ops() { return opsApi; }, get ui() { return ui; }, kioskSupervisor: () => kioskApi?.isSupervisor(me()), setPayMonth: (mk) => { ui.payMonth = mk; },
  };
  AllurusUX.install(moduleCtx);
  finApi = AllurusFinance.install(moduleCtx);
  AllurusTax.install(moduleCtx);
  AllurusGuide.install(moduleCtx);
  claimsApi = AllurusClaims.install(moduleCtx);
  AllurusPlanner.install(moduleCtx);
  leaveApi = AllurusLeave.install(moduleCtx);
  timeApi = AllurusTime.install(moduleCtx);
  docsApi = AllurusPayDocs.install(moduleCtx);
  notifyApi = AllurusNotify.install(moduleCtx);
  hrApi = AllurusHR.install(moduleCtx);
  AllurusReports.install(moduleCtx);
  einvApi = AllurusEInvoice.install(moduleCtx);
  costingApi = AllurusCosting.install(moduleCtx);
  appraisalApi = AllurusAppraisal.install(moduleCtx);
  recruitApi = AllurusRecruit.install(moduleCtx);
  lmsApi = AllurusLMS.install(moduleCtx);
  grievApi = AllurusGrievance.install(moduleCtx);
  roomsApi = AllurusRooms.install(moduleCtx);
  opsApi = AllurusOps.install(moduleCtx);
  posApi = AllurusPos.install(moduleCtx);
  AllurusImport.install(moduleCtx);
  kioskApi = AllurusKiosk.install(moduleCtx, { write: writeCheckin, zone, deviceId, deviceName, squareCanvas, nowHM, isField, selfieThumb, cloudWrite: (p, d) => cloudWrite(p, d), cloudOn: () => !!cloud.db });
  // Approvers see their team's claims under Approvals, after leave and attendance requests.
  const approvalsBase = VIEWS['my-approvals'];
  VIEWS['my-approvals'] = () => (leaveApi.isApprover(me().id) ? approvalsBase() + claimsApi.approvalsCard(me().id) : '<div class="page-head"><div><h1>Approvals</h1><p class="sub">Tasks waiting for you.</p></div></div>') + hrApi.myTasksCard(me().id) + recruitApi.approvalsCard(me().id) + lmsApi.approvalsCard(me().id);

  // ---------- Trial, subscription and billing (cloud mode) ----------
  // The status comes from the company record (js/billing-rules.js; firestore.rules enforces the same). Admins see a
  // countdown banner and the Billing page; an expired company opens read-only on Billing until it's paid.
  const billingUi = {
    data: null,
    company: () => window.AllurusCompany || null,
    status: () => AllurusBilling.effective(billingUi.company() || {}),
    readOnly: () => !!fire()?.profile?.billingOnly,
    banner() {
      if (!CLOUD || role() !== 'admin' || !billingUi.company()) return '';
      const b = AllurusBilling.banner(billingUi.company());
      const ro = billingUi.readOnly();
      if (!b && !ro) return '';
      const tone = { info: 'var(--info-soft);color:var(--info)', amber: 'var(--warn-soft);color:var(--warn)', red: 'var(--bad-soft);color:var(--bad)' }[b?.level || 'red'];
      const del = AllurusBilling.deletion(billingUi.company());
      return `<div class="lock-banner" role="status" style="background:${tone};margin-bottom:14px;flex-wrap:wrap">${icon('clock')}<span style="flex:1">${esc(b?.text || '')}${ro ? ' Everything is read-only until then; you can still export your data.' : ''}${del ? ` Data is kept until ${esc(U.fmtDate(AllurusBilling.myDate(del.at)))}.` : ''}</span>
        ${route() === 'billing' ? '' : `<a class="btn btn-sm btn-primary" href="#billing">${esc(b?.action || 'Subscribe')}</a>`}</div>`;
    },
    // First steps for a company that signed itself up, until they're done or dismissed.
    checklist() {
      const c = billingUi.company();
      if (!CLOUD || role() !== 'admin' || !c || c.createdVia !== 'self_signup' || state.settings.onboardDone) return '';
      const steps = [
        ['Company profile', 'Name, address, statutory numbers', '#settings/company', !!state.settings.employer?.address],
        ['Work site and check-in radius', 'Where staff check in', '#settings/checkin', zone().source === 'checkin'],
        ['Add your staff', 'Import from Excel, or add one', '#employees', state.employees.length > 1],
        ['Invite staff', 'They get an email to set their password', '#employees', !!(teamAccess.data?.invites?.length || teamAccess.data?.users?.length > 1)],
        ['Test a check-in on a phone', 'Open allurus.my/app on your phone', '#attendance', Object.keys(state.attendance || {}).length > 0],
      ];
      const done = steps.filter((s) => s[3]).length;
      return `<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Get started · ${done} of ${steps.length}</h3><button class="btn btn-sm btn-ghost" data-act="onboard-hide">Hide</button></div>
        <div class="list">${steps.map(([t, d, href, ok]) => `<a class="list-item" href="${href}" style="text-decoration:none;color:inherit"><span class="pill ${ok ? 'ok' : ''}">${ok ? 'Done' : 'To do'}</span><div class="grow"><div class="person-name">${esc(t)}</div><div class="person-sub">${esc(d)}</div></div></a>`).join('')}</div></div>`;
    },
    // Staff of an expired or suspended company: a clear stop, never a broken app.
    blocked(eff) {
      cloudWaiting = false;
      $('#login').hidden = false; $('.app').hidden = true;
      $('#login').innerHTML = `<div class="login-inner"><div class="login-brand">${LOGO_MARK.replace('width="30" height="30"', 'width="56" height="56"')}</div>
        <h1>${eff === 'suspended' ? 'Account suspended' : 'Subscription ended'}</h1><p class="sub">${eff === 'suspended' ? 'Your company’s Allurus account is suspended. Please contact your admin.' : 'Your company’s subscription has expired. Please contact your admin.'}</p>
        <button class="btn" data-act="logout">Sign out</button></div>`;
    },
    view() {
      const c = billingUi.company() || {}, eff = billingUi.status(), d = billingUi.data;
      const end = AllurusBilling.endsAt(c), ref = AllurusBilling.reference(c.id || state.session.tenantId || '');
      const label = { trial: 'Free trial', active: 'Active', past_due: 'Payment overdue', expired: 'Expired', suspended: 'Suspended', cancelled: 'Cancelled' }[eff];
      const pill = { trial: 'info', active: 'ok', past_due: 'bad', expired: 'bad', suspended: 'bad', cancelled: '' }[eff];
      const plans = (d?.plans || []).filter((p) => Number(p.priceMyr) > 0);
      const bank = d?.config || {};
      return `<div class="page-head"><div><h1>Billing</h1><p class="sub">Your plan, payments and invoices.</p></div><div class="actions"><button class="btn" data-act="bill-export">${icon('download')}Export all data</button></div></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
          <div class="card"><div class="kpi-label">Status</div><div style="margin:6px 0"><span class="pill ${pill}">${label}</span></div>
            <p class="muted">${eff === 'trial' ? `Trial ends ${esc(U.fmtDate(AllurusBilling.myDate(end)))}.` : eff === 'active' && end ? `Paid until ${esc(U.fmtDate(AllurusBilling.myDate(end)))}.` : eff === 'past_due' ? `Pay by ${esc(U.fmtDate(AllurusBilling.myDate(end)))} to keep using Allurus.` : 'Subscribe to continue. Your data is kept safe.'}</p>
            <p class="faint">Plan: ${esc(c.plan || 'trial')}</p></div>
          <div class="card"><div class="kpi-label">Pay by bank transfer or DuitNow</div>
            ${bank.bankName ? `<dl class="kv" style="margin-top:8px"><dt>Bank</dt><dd>${esc(bank.bankName)}</dd><dt>Account name</dt><dd>${esc(bank.accountName || '')}</dd><dt>Account no.</dt><dd class="num">${esc(bank.accountNo || '')}</dd>${bank.duitnow ? `<dt>DuitNow</dt><dd>${esc(bank.duitnow)}</dd>` : ''}<dt>Reference</dt><dd class="num"><b>${esc(ref)}</b></dd></dl>${bank.qr ? `<img src="${esc(bank.qr)}" alt="DuitNow QR code" style="width:160px;margin-top:8px;border-radius:12px">` : ''}`
              : `<p class="muted" style="margin-top:8px">Payment details are being set up. Contact <a href="mailto:${esc(bank.contact || 'hello@allurus.my')}">${esc(bank.contact || 'hello@allurus.my')}</a> to subscribe.</p><p class="faint">Your reference: <b>${esc(ref)}</b></p>`}</div>
        </div>
        <div class="card" style="margin-top:14px"><div class="card-head"><h3>Send payment proof</h3></div>
          ${!d ? '<p class="muted">Loading…</p>' : plans.length ? `<form id="bill-form" class="form-grid" novalidate>
            <div class="field"><label for="b-plan">Plan</label><select class="select" id="b-plan" name="planId">${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · RM ${Number(p.priceMyr).toFixed(2)} a ${esc(p.period || 'month')}${p.employeeLimit ? ` · up to ${p.employeeLimit} staff` : ''}</option>`).join('')}</select></div>
            <div class="field"><label for="b-months">Months</label><select class="select" id="b-months" name="months">${[1, 3, 6, 12].map((m) => `<option value="${m}">${m}</option>`).join('')}</select></div>
            <div class="field"><label>Amount</label><div class="num" id="b-amount" style="font-size:20px;font-weight:700"></div><span class="field-hint">Transfer this amount with reference ${esc(ref)}.</span></div>
            <div class="field"><label for="b-proof">Proof of payment</label><input class="input" id="b-proof" type="file" accept="image/*,application/pdf" required><span class="field-hint">A photo or screenshot of the receipt, or a PDF under 700 KB.</span></div>
            <div class="field full"><button class="btn btn-primary" type="submit">Send for review</button></div></form>`
            : '<p class="muted">Plans and prices aren’t published yet. Contact <a href="mailto:hello@allurus.my">hello@allurus.my</a> to subscribe.</p>'}</div>
        <div class="card card-flush" style="margin-top:14px"><div class="card-head" style="padding:16px 18px 0"><h3>Payments and invoices</h3></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>What</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>
          ${[...(d?.payments || []).map((p) => [p.createdAt, `Payment ${esc(p.reference)} · ${p.months} month${p.months > 1 ? 's' : ''}`, p.amountMyr, `<span class="pill ${p.status === 'approved' ? 'ok' : p.status === 'rejected' ? 'bad' : 'warn'}">${{ submitted: 'Waiting for review', approved: 'Approved', rejected: 'Rejected' }[p.status] || esc(p.status)}</span>${p.note ? `<div class="field-hint">${esc(p.note)}</div>` : ''}`]),
            ...(d?.invoices || []).map((i) => [i.issuedAt, `Invoice ${esc(i.number)}`, i.amountMyr, '<span class="pill ok">Paid</span>'])].map(([t, w, a, s]) => `<tr><td class="num">${t?.seconds ? esc(U.fmtDate(AllurusBilling.myDate(t.seconds * 1000))) : ''}</td><td>${w}</td><td class="r num">RM ${Number(a || 0).toFixed(2)}</td><td>${s}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}
          </tbody></table></div></div>`;
    },
    async load() { try { billingUi.data = await fire().billing(); } catch (e) { billingUi.data = { plans: [], payments: [], invoices: [], config: {} }; } if (route() === 'billing') render(); },
    bind() {
      if (!billingUi.data) { billingUi.load(); return; }
      const f = $('#bill-form'); if (!f) return;
      const amt = () => { const p = billingUi.data.plans.find((x) => x.id === f.planId.value); const v = (Number(p?.priceMyr) || 0) * Number(f.months.value); $('#b-amount').textContent = `RM ${v.toFixed(2)}`; return v; };
      amt(); f.addEventListener('change', amt);
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const file = $('#b-proof').files[0]; if (!file) { toast('Choose the proof of payment', 'error'); return; }
        let proof;
        try { proof = await billingUi.shrink(file); } catch (e) { toast(e.message, 'error'); return; }
        const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
        const r = await fire().submitPayment({ planId: f.planId.value, months: Number(f.months.value), amountMyr: amt(), reference: AllurusBilling.reference(billingUi.company()?.id || ''), method: 'bank', proof, proofName: file.name, proofType: file.type });
        toast(r.ok ? 'Sent. We’ll check it and confirm, usually within one working day.' : r.error, r.ok ? '' : 'error');
        billingUi.data = null; billingUi.load();
      });
    },
    // Photos are shrunk to a JPEG under 700 KB; PDFs must already be that small (the record limit is 1 MB).
    async shrink(file) {
      const read = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Couldn’t read that file.')); r.readAsDataURL(f); });
      if (file.type === 'application/pdf') { if (file.size > 700 * 1024) throw new Error('That PDF is over 700 KB. Send a screenshot or photo of the receipt instead.'); return read(file); }
      if (!file.type.startsWith('image/')) throw new Error('Send a photo, screenshot or PDF.');
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Couldn’t open that image.')); i.src = URL.createObjectURL(file); });
      for (const max of [1600, 1200, 900]) {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        for (const q of [0.8, 0.65, 0.5]) { const url = c.toDataURL('image/jpeg', q); if (url.length < 700 * 1024) return url; }
      }
      throw new Error('That image is too large. Try a screenshot instead.');
    },
    // Everything this admin can see, as an Excel workbook (people, leave, attendance) plus a full JSON backup.
    async exportAll() {
      try {
        const X = window.XLSX || await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'js/vendor/xlsx.full.min.js?v=0.20.3'; s.onload = () => ok(window.XLSX); s.onerror = no; document.head.appendChild(s); });
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(AllurusImportRules.exportRows(state.employees, (id) => dept(id)?.name || '')), 'Employees');
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Employee', 'Type', 'From', 'To', 'Days', 'Status'], ...(state.leaves || []).map((l) => [fullName(emp(l.empId) || {}), l.type, l.from, l.to, l.days, l.status])]), 'Leave');
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Date', 'Employee', 'Status', 'In', 'Out'], ...Object.entries(state.attendance || {}).flatMap(([day, recs]) => Object.entries(recs).map(([id, r]) => [day, fullName(emp(id) || {}), r.status || '', r.in || '', r.out || '']))]), 'Attendance');
        const stamp = U.today();
        X.writeFile(wb, `allurus-export-${stamp}.xlsx`);
        const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), company: state.settings.company, data: Object.fromEntries(WS_KEYS.map((k) => [k, state[k]])) })], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `allurus-backup-${stamp}.json`; document.body.appendChild(a); a.click(); a.remove();
        toast('Exported: an Excel workbook and a full backup file.');
      } catch (e) { toast('The export couldn’t be made here. Try again on a computer.', 'error'); }
    },
  };
  VIEWS.billing = () => billingUi.view();
  AFTER.billing = () => billingUi.bind();
  ACTIONS['bill-export'] = () => billingUi.exportAll();
  ACTIONS['onboard-hide'] = () => { state.settings.onboardDone = true; commit('Checklist hidden'); };

  // ---------- Team access (cloud mode): who can sign in, and as what ----------
  const teamAccess = {
    data: null,
    on: () => CLOUD && can('settings') && !!fire()?.live,
    async load() {
      try { this.data = await fire().access(); } catch (e) { this.data = { invites: [], users: [] }; }
      return this.data;
    },
    async mount() {
      const el = $('#team-access'); if (!el || !fire()?.live) return;
      await this.load();
      this.draw();
    },
    // Not invited, Invited (with the date sent), Invitation expired, Active or Disabled (js/invite-rules.js).
    status(e) {
      const email = (e.email || '').toLowerCase(), d = this.data || { invites: [], users: [] };
      const user = d.users.find((u) => u.empId === e.id), inv = d.invites.find((i) => i.email === email);
      const tpl = (x) => ((x.roles || []).includes('admin') ? templateOf(Array.isArray(x.perms) ? x.perms : null) : 'employee');
      const s = AllurusInvite.status({ user, invite: user ? null : inv });
      const key = s.key === 'active' ? 'joined' : s.key;
      return { ...s, key, template: user ? tpl(user) : inv ? tpl(inv) : 'employee', email: user?.email || inv?.email || email };
    },
    badge(e) {
      if (!this.data) {
        // Not loaded yet (for example a profile opened from search): load, then fill in the profile's line.
        if (!this.loading) { this.loading = true; this.load().finally(() => { this.loading = false; const p = $('#acc-prof'), x = p && emp(p.dataset.emp); if (x) p.innerHTML = `<span class="muted" style="font-size:13px">Sign-in:</span>${this.badge(x)}${this.actions(x)}`; }); }
        return '<span class="faint">…</span>';
      }
      const s = this.status(e);
      return `<span class="pill ${s.pill}">${s.label}</span>${s.key === 'invited' && s.sentAt ? `<div class="field-hint">Sent ${U.fmtDate(new Date(s.sentAt).toISOString().slice(0, 10))}</div>` : ''}`;
    },
    // The buttons for one person, used on the Employees list, their profile and Settings → Team access.
    actions(e) {
      if (!this.data || e.id === fire()?.profile?.empId) return '';
      const s = this.status(e), b = (act, label, id, cls = '') => `<button class="btn btn-sm ${cls}" data-act="${act}" data-id="${esc(id)}">${label}</button>`;
      if (s.key === 'none') return b('acc-invite', 'Send invitation', e.id, 'btn-primary');
      if (s.key === 'invited' || s.key === 'expired') return b('acc-invite', 'Resend invitation', e.id) + b('acc-cancel', 'Cancel invitation', s.email);
      if (s.key === 'joined') return b('acc-disable', 'Turn off access', s.uid, 'btn-danger');
      if (s.key === 'disabled') return b('acc-enable', 'Turn access back on', s.uid);
      return '';
    },
    draw() {
      const el = $('#team-access'); if (!el) return;
      const people = activeEmployees(), self = fire().profile;
      const rows = people.map((e) => {
        const st = this.status(e), isMe = e.id === self.empId;
        return `<tr><td>${person(e)}</td><td class="muted">${esc(e.email || 'No email')}</td>
          <td>${this.badge(e)}</td>
          <td>${isMe ? `<span class="muted">You · ${esc(roleLabel('admin'))}</span>` : `<select class="select" data-acc-role="${e.id}" aria-label="Access for ${esc(fullName(e))}">${this.options(st.template)}</select>`}</td>
          <td class="r"><div class="row-actions" style="opacity:1">${isMe ? '' : e.email ? this.actions(e) : '<span class="faint">No email</span>'}</div></td></tr>`;
      }).join('');
      const waiting = people.filter((e) => e.email && this.status(e).key === 'none').length;
      el.innerHTML = `<div class="card-head"><h3>Team access</h3>${waiting ? `<button class="btn btn-sm" data-act="acc-invite-all">Invite all ${waiting}</button>` : ''}</div>
        <p class="muted" style="margin-bottom:12px">Send someone an invitation and they get an email with a sign-in link to <b>allurus.my/activate</b>, where they create their password. Invitations last ${AllurusInvite.DAYS} days. Everyone gets the employee app; a role adds parts of the company console. Managers need no role: being an approver in the leave settings is enough.</p>
        <div class="chips" style="margin-bottom:12px;flex-wrap:wrap">${shownTemplates().map(([, t]) => `<span class="tag" title="${esc(t.desc)}"><b>${esc(t.label)}</b>: ${esc(t.desc)}</span>`).join('')}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Person</th><th>Email</th><th>Status</th><th>Access</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
      $$('[data-acc-role]', el).forEach((sel) => sel.addEventListener('change', () => this.setRole(sel.dataset.accRole, sel.value)));
    },
    // The templates this person may give: only ones within their own areas; Owner only by an Owner.
    options(current) {
      const mine = myPerms(), ok = (k) => k === 'employee' || (k === 'owner' ? !mine : !mine || TEMPLATES[k].perms.every((a) => mine.includes(a)));
      const list = [['employee', 'Employee'], ...shownTemplates().map(([k, t]) => [k, t.label])];
      if (current === 'custom') list.push(['custom', 'Custom']);
      return list.map(([k, label]) => `<option value="${k}" ${k === current ? 'selected' : ''} ${ok(k) || k === current ? '' : 'disabled'}>${label}</option>`).join('');
    },
    async invite(empId, quiet) {
      const e = emp(empId); if (!e) return;
      const st = this.status(e);
      const chosen = this.pending?.[empId] || (st.template === 'custom' ? 'employee' : st.template);
      const r = await fire().invite(e, chosen);
      if (r.ok && this.pending) delete this.pending[empId];
      if (r.ok) { log(`Invitation ${st.key === 'none' ? 'sent' : 'resent'} to ${fullName(e)}${r.emailed ? '' : ' (email not sent)'}`); save(); }
      if (!quiet) toast(r.ok && r.emailed ? `Invitation sent to ${e.email}. It’s valid until ${U.fmtDate(r.expiresAt.toISOString().slice(0, 10))}.` : r.error, r.ok && r.emailed ? '' : 'error');
      if (!quiet) await this.refresh();
      return r.ok && r.emailed;
    },
    async inviteAll() { this.bulk(activeEmployees().filter((e) => e.email && this.status(e).key === 'none').map((e) => e.id)); },
    // Several at once, after confirming the count.
    bulk(ids) {
      const list = ids.map(emp).filter((e) => e?.email && ['none', 'invited', 'expired'].includes(this.status(e).key));
      if (!list.length) { toast('None of those people can be invited: they need a work email and no active account.', 'error'); return; }
      openModal({ title: 'Send invitations', size: 'sm', submit: `Send to ${list.length}`, body: `<p>Send an invitation email to ${list.length} ${list.length === 1 ? 'employee' : 'employees'}?</p><p class="muted" style="margin-top:8px">${list.slice(0, 8).map((e) => esc(fullName(e))).join(', ')}${list.length > 8 ? ` and ${list.length - 8} more` : ''}.</p>`,
        onSubmit: () => {
          (async () => { let n = 0; for (const e of list) { if (await this.invite(e.id, true)) n++; } toast(`${n} of ${list.length} invitations sent`, n === list.length ? '' : 'error'); ui.empSel = new Set(); await this.refresh(); })();
        } });
    },
    async cancel(email) {
      const e = state.employees.find((x) => (x.email || '').toLowerCase() === String(email).toLowerCase());
      const r = await fire().cancelInvite(email);
      if (r.ok) { log(`Invitation cancelled for ${e ? fullName(e) : email}`); save(); }
      toast(r.ok ? 'Invitation cancelled. The link in their email no longer works.' : r.error, r.ok ? '' : 'error');
      await this.refresh();
    },
    async setDisabled(uid, off) {
      const u = (this.data?.users || []).find((x) => x.uid === uid), e = u && emp(u.empId);
      const r = await fire().setDisabled(uid, off);
      if (r.ok) { log(`Access ${off ? 'turned off' : 'turned back on'} for ${e ? fullName(e) : u?.email || 'a user'}`); save(); }
      toast(r.ok ? (off ? `${e?.first || 'Their'} access is off. They can’t open any company data, starting now.` : 'Access is back on.') : r.error, r.ok ? '' : 'error');
      await this.refresh();
    },
    async refresh() { await this.load(); if ($('#team-access')) this.draw(); else render(); },
    async setRole(empId, template) {
      const e = emp(empId), st = this.status(e);
      if (st.key === 'none') { this.pending = { ...(this.pending || {}), [empId]: template }; toast(`${e.first} will be invited as ${template === 'employee' ? 'an Employee' : TEMPLATES[template].label}. Choose Invite.`); return; }
      const r = st.key === 'joined' ? await fire().setRole(st.uid, template) : await fire().invite(e, template);
      toast(r.ok ? `${e.first} is now ${template === 'employee' ? 'an Employee' : TEMPLATES[template].label}${st.key === 'joined' ? '. It applies the next time they sign in.' : ''}` : r.error, r.ok ? '' : 'error');
      await this.mount();
    },
    async revoke(email) {
      const d = this.data || { users: [] }, u = d.users.find((x) => x.email === email);
      const r = await fire().revoke(email, u?.uid);
      toast(r.ok ? 'Access removed. They can’t sign in to this company any more.' : r.error, r.ok ? '' : 'error');
      await this.mount();
    },
  };

  // ---------- Bridge for js/cloud.js ----------
  window.AllurusApp = {
    get state() { return state; },
    WS_KEYS, STORE_KEY,
    toast: (m, k) => toast(m, k),
    // A company with nothing in it, for the cloud copy to be laid onto.
    blankWorkspace() {
      const ws = newWorkspace({ name: '', email: 'blank@example.com', adminName: 'Admin', city: state.settings.office || 'Kuala Lumpur', currency: 'MYR', plan: 'growth' }, false);
      ws.employees = []; ws.activity = [];
      return ws;
    },
    // Make the cloud copy this browser's workspace, signed in as the given person.
    adoptCloud(ws, p) {
      const s = AllurusSeed.create(), theme = state.settings?.theme;
      WS_KEYS.forEach((k) => { if (ws[k] !== undefined) s[k] = ws[k]; });
      s.plans = ws.plans || {}; s.reliefs = ws.reliefs || {}; s.taxProfiles = ws.taxProfiles || {};
      s.workspaces = {};
      if (theme) s.settings.theme = theme;
      s.accounts = [{ email: p.email, name: p.name, hash: '', roles: p.roles.slice(), perms: Array.isArray(p.perms) ? p.perms.slice() : null, tenantId: p.tenantId, empId: p.empId, cloud: true }];
      const keep = state.session.account === p.email && p.roles.includes(state.session.role) ? state.session.role : preferredRole(p.roles);
      s.session = { account: state.session.account === p.email ? p.email : null, roles: p.roles.slice(), role: keep, empId: p.empId, tenantId: p.tenantId, cloud: { uid: p.uid } };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* storage full or unavailable */ }
      state = load();
      if (!state.session.cloud) state.session.cloud = { uid: p.uid };
    },
    // Show changes that arrived from elsewhere, unless someone is mid-way through a form.
    refresh(force) {
      saveLocal();
      if (cloudWaiting) return;
      if (force || (!$('#overlay-root').children.length && !AllurusUX.isEditing() && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName))) render();
      if (!force) AllurusUX.pulseLive();
    },
    // The cloud finished reconnecting (or the sign-in had expired).
    // A company the superadmin opened, set up by its first admin when they activate: empty, with them as e1.
    firstWorkspace(d) { return newWorkspace({ currency: 'MYR', plan: 'growth', city: 'Kuala Lumpur', ...d }, false); },
    // Staff of an expired or suspended company (js/cloud.js start()).
    companyBlocked(eff) { billingUi.blocked(eff); },
    // Superadmin viewing a company: open it as its Owner would see it, with a banner; changes are never saved.
    cloudViewOnly(name) {
      cloudWaiting = false; startSession(state.accounts[0]);
      let bar = document.getElementById('view-only-bar');
      if (!bar) { bar = document.createElement('div'); bar.id = 'view-only-bar'; bar.setAttribute('role', 'status'); bar.style.cssText = 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:90;background:#16181D;color:#fff;padding:8px 14px;border-radius:999px;font:600 13px/1.3 var(--font);box-shadow:var(--shadow-lg);display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px)'; document.body.appendChild(bar); }
      bar.innerHTML = `<span>Viewing ${esc(name)} as superadmin · read-only, nothing you change is saved</span><a href="/superadmin" style="color:#D9B66F">Back to superadmin</a>`;
    },
    // Just activated on /activate and already signed in: open the app as them.
    cloudSignedIn() { cloudWaiting = false; startSession(state.accounts[0]); toast('Your account is ready. Welcome to Allurus.'); },
    cloudReady(reason) {
      cloudWaiting = false;
      if (reason === 'signed-out') { Object.assign(state.session, { account: null, roles: [], role: null }); saveLocal(); toast('Please sign in again.'); }
      render();
    },
  };

  // ---------- Boot ----------
  if (state.session.account && state.session.roles?.length > 1) state.session.role = preferredRole(state.session.roles);
  $('#today').textContent = U.fmtDate(U.today(), { weekday: 'short', month: 'short', day: 'numeric' });
  $('#brand-mark').innerHTML = LOGO_MARK;
  captureSetupLink();
  window.addEventListener('hashchange', () => { captureSetupLink(); navigated = true; render(); window.scrollTo(0, 0); });
  // Live: when another tab on this browser changes data (a check-in, an approval), refresh this screen.
  window.addEventListener('storage', (ev) => {
    if (ev.key !== STORE_KEY || !ev.newValue) return;
    const sess = state.session, next = load();
    if (next.session.tenantId !== sess.tenantId) return;
    state = next; state.session = sess;
    if (!$('#overlay-root').children.length && !AllurusUX.isEditing() && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) render();
    AllurusUX.pulseLive();
  });
  render();
  if (CLOUD) {
    import('./cloud.js?v=' + APP_VERSION).catch((e) => {
      console.error('[Allurus cloud]', e);
      cloudWaiting = false; render();
      toast('Couldn’t reach the Allurus server. Check your connection and reload.', 'error');
    });
  } else connectCloud();
})();
