// Demo company 2: Suria Enterprise, a small cili boh (chilli paste) factory in Muar, Johor. It makes, sells and
// delivers a product, so besides HR and payroll it shows the Operations module: raw material stock and purchase
// orders, production batches, sales and delivery orders, and machine maintenance. Opened with ?demo=suria.
// All names, registration numbers, clients and vendors are made up. Dates are relative to today.
(function () {
  'use strict';
  const O = window.AllurusOpsRules;
  const r2 = (n) => Math.round(n * 100) / 100;
  const COMPANY = 'Suria Enterprise';
  // The factory's check-in point (Bakri, Muar). Drivers and sales reps may check in outside it (field staff).
  const published = { company: COMPANY, label: 'Suria factory, Bakri', lat: 2.051832, lng: 102.619514, radius: 80, field: ['e23', 'e24', 'e25', 'e26', 'e27', 'e28'], at: Date.UTC(2026, 9, 24, 1, 0) };

  function create() {
    const T = U.today();
    const rnd = U.rng(2026);
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const iso = (d, hm) => new Date(`${d}T${hm}:00`).toISOString();
    const START = U.addDays(T, -95);

    // ---------- Company ----------
    const checkin = { label: published.label, lat: published.lat, lng: published.lng, radius: published.radius, remote: false, field: [...published.field], setAt: published.at, kiosks: [], supervisor: true, projects: 'off' };
    const settings = { company: COMPANY, domain: 'suriaenterprise.my', currency: 'MYR', office: 'Muar', checkin, taxRate: 0, benefitsRate: 11.7, theme: 'system', statutory: { ...U.STATUTORY }, claims: AllurusClaims.policyDefaults() };
    // A sole proprietorship: the registration and statutory numbers are clearly fake.
    settings.employer = { ssm: '000000-X (DEMO ONLY)', epfNo: '00000000 (DEMO)', socsoNo: 'E0000000000X (DEMO)', lhdnNo: 'E 0000000000 (DEMO)', hrdNo: 'HRDC-DEMO-0000', address: 'Lot 12, Jalan Perindustrian Bakri 3, Kawasan Perindustrian Bakri, 84200 Muar, Johor', phone: '+60 6-000 0000', signatory: 'Norhayati binti Ismail', signatoryTitle: 'Admin Manager' };
    const departments = [
      { id: 'd-mgmt', name: 'Management', lead: 'e1', color: '#14302E', about: 'Runs the business.', duties: 'Strategy, Key clients, Approvals' },
      { id: 'd-admin', name: 'Admin & Accounts', lead: 'e2', color: '#0F766E', about: 'Keeps the office, the books and purchasing running.', duties: 'Payroll, Invoicing, Purchasing, Payments' },
      { id: 'd-prod', name: 'Production', lead: 'e6', color: '#C2577A', about: 'Cooks, fills and labels cili boh in two shifts.', duties: 'Cooking, Filling, Capping, Labelling, Packing' },
      { id: 'd-qc', name: 'QC & Store', lead: 'e18', color: '#B8914A', about: 'Checks every batch and keeps raw materials and finished goods.', duties: 'Quality checks, Receiving, Stock' },
      { id: 'd-maint', name: 'Maintenance', lead: 'e21', color: '#4A6FD1', about: 'Keeps the machines, chiller and vehicles running.', duties: 'Preventive maintenance, Repairs' },
      { id: 'd-sales', name: 'Sales & Delivery', lead: 'e23', color: '#7A62C9', about: 'Takes orders and delivers to shops, restaurants and wholesalers.', duties: 'Orders, Deliveries, Collections' },
    ];

    // Leave: Johor calendar with a six-day week (Sunday rest). Johor's own state holidays are not built in yet
    // (js/leave-rules.js): TODO add them as company holidays from the official state gazette.
    const L = AllurusLeaveRules;
    settings.leave = L.defaultSettings({ state: 'Johor', departments, hr: 'e2', hrBackup: 'e3' });
    settings.leave.weekend = 'sun';
    Object.assign(settings.leave.chains, {
      'd-mgmt': { l1: 'e1', l1b: '', l2: '', l2b: '' }, 'd-admin': { l1: 'e2', l1b: 'e1', l2: '', l2b: '' },
      'd-prod': { l1: 'e6', l1b: 'e7', l2: '', l2b: '' }, 'd-qc': { l1: 'e18', l1b: 'e6', l2: '', l2b: '' },
      'd-maint': { l1: 'e21', l1b: 'e6', l2: '', l2b: '' }, 'd-sales': { l1: 'e23', l1b: 'e2', l2: '', l2b: '' },
    });
    U.setWeekend(L.weekendDays(settings.leave));
    const lctx = L.calendarCtx(settings.leave, `${+T.slice(0, 4) - 1}-01-01`, `${+T.slice(0, 4) + 1}-12-31`);
    const isWork = (d) => L.isWorkingDay(d, lctx);
    const workdays = (from, to) => { const out = []; for (let d = from; d <= to; d = U.addDays(d, 1)) if (isWork(d)) out.push(d); return out; };
    const wd = (n) => { let d = U.addDays(T, n); while (!isWork(d)) d = U.addDays(d, n < 0 ? -1 : 1); return d; };

    // ---------- People ----------
    // [first, last, job title, department, monthly salary (RM), start, gender, married]
    const people = [
      ['Rosli', 'bin Hamzah', 'Owner', 'd-mgmt', 0, '2009-04-01', 'male', true],
      ['Norhayati', 'binti Ismail', 'Admin Manager', 'd-mgmt', 5500, '2012-06-04', 'female', true],
      ['Siti Khadijah', 'binti Omar', 'Admin Executive', 'd-admin', 2800, '2019-02-11', 'female', true],
      ['Mei Fong', 'Tan', 'Account Clerk', 'd-admin', 2600, '2020-08-03', 'female', false],
      ['Mohd Faiz', 'bin Rahim', 'Purchasing Clerk', 'd-admin', 2500, '2021-03-15', 'male', true],
      ['Azman', 'bin Yusof', 'Production Supervisor', 'd-prod', 3800, '2013-01-07', 'male', true],
      ['Kamal', 'bin Ariffin', 'Shift Leader', 'd-prod', 2600, '2016-05-16', 'male', true],
      ['Ramesh', 'a/l Muniandy', 'Shift Leader', 'd-prod', 2600, '2017-09-04', 'male', true],
      ['Nurul Huda', 'binti Salleh', 'Machine Operator', 'd-prod', 1900, '2022-04-18', 'female', false],
      ['Ahmad Zaki', 'bin Hashim', 'Machine Operator', 'd-prod', 1850, '2023-01-09', 'male', false],
      ['Faridah', 'binti Ahmad', 'Machine Operator', 'd-prod', 2000, '2018-11-12', 'female', true],
      ['Kok Wai', 'Lim', 'Machine Operator', 'd-prod', 1950, '2021-07-05', 'male', true],
      ['Hafiz', 'bin Jamal', 'Machine Operator', 'd-prod', 1800, '2024-02-19', 'male', false],
      ['Rosnah', 'binti Abdullah', 'Machine Operator', 'd-prod', 2000, '2015-10-05', 'female', true],
      ['Syahmi', 'bin Roslan', 'Machine Operator', 'd-prod', 1750, '2025-03-03', 'male', false],
      ['Kavitha', 'a/p Raman', 'Machine Operator', 'd-prod', 1850, '2022-10-24', 'female', true],
      ['Zulkifli', 'bin Mat', 'Machine Operator', 'd-prod', 1900, '2020-01-13', 'male', true],
      ['Aina Sofea', 'binti Kamarudin', 'QC Officer', 'd-qc', 3000, '2020-06-01', 'female', false],
      ['Halim', 'bin Saad', 'Storekeeper', 'd-qc', 2400, '2014-08-11', 'male', true],
      ['Wan Amirul', 'bin Wan Ismail', 'Store Assistant', 'd-qc', 1800, '2024-07-01', 'male', false],
      ['Shahrul Nizam', 'bin Ahmad', 'Technician', 'd-maint', 3200, '2016-03-07', 'male', true],
      ['Danial', 'bin Hakimi', 'Assistant Technician', 'd-maint', 2200, '2023-05-15', 'male', false],
      ['Siew Ling', 'Lee', 'Sales Executive', 'd-sales', 3500, '2018-04-02', 'female', true],
      ['Mohd Hairi', 'bin Karim', 'Sales Representative', 'd-sales', 2300, '2021-09-13', 'male', true],
      ['Nadia', 'binti Zainal', 'Sales Representative', 'd-sales', 2300, '2023-02-06', 'female', false],
      ['Ismail', 'bin Daud', 'Lorry Driver', 'd-sales', 2200, '2015-02-02', 'male', true],
      ['Rahman', 'bin Sulaiman', 'Van Driver', 'd-sales', 2000, '2019-11-04', 'male', true],
      ['Firdaus', 'bin Aziz', 'Delivery Helper', 'd-sales', 1750, '2024-09-09', 'male', false],
    ];
    const STREETS = ['Jalan Bakri, 84200 Muar', 'Taman Sri Bakri, 84200 Muar', 'Jalan Abdul Rahman, 84000 Muar', 'Kampung Parit Jawa, 84150 Muar', 'Taman Tangkak Jaya, 84900 Tangkak', 'Jalan Salleh, 84000 Muar', 'Taman Pagoh Indah, 84600 Pagoh', 'Kampung Sungai Mati, 84400 Muar'];
    const KIN = [['Rohani binti Said', 'Spouse'], ['Ahmad bin Ismail', 'Father'], ['Lim Siew Kim', 'Mother'], ['Saraswathy a/p Muthu', 'Mother'], ['Nor Azlina binti Hassan', 'Sister'], ['Mohd Shukri bin Jamil', 'Brother']];
    const S = AllurusStatutory;
    const employees = people.map(([first, last, role, dept, monthly, start, gender, married], i) => {
      const id = 'e' + (i + 1);
      const birthday = `${1975 + ((i * 7) % 25)}-${U.pad(1 + ((i * 5) % 12))}-${U.pad(2 + ((i * 11) % 26))}`;
      const handle = first.toLowerCase().replace(/[^a-z]/g, '');
      return {
        id, first, last, role, dept, salary: monthly * 12, start, location: 'Muar', birthday,
        email: `${handle}@suriaenterprise.my`, phone: `01${[2, 3, 7, 9][i % 4]}-${String(6100000 + i * 391117).slice(0, 3)} ${String(2000 + i * 413).slice(-4)}`,
        type: role === 'Owner' ? 'Owner' : 'Full-time', status: 'Active', manager: '', gender, married,
        idType: 'mykad', ic: `${birthday.replace(/-/g, '').slice(2)}01${String(1000 + i * 43).slice(-4)}`.replace(/(\d{6})(\d{2})(\d{4})/, (m, a, b, c) => `${a}${b}${c.slice(0, 3)}${gender === 'male' ? 1 + (i % 4) * 2 : 2 + (i % 4) * 2}`),
        epfNo: String(19000000 + i * 271843).slice(0, 8), socsoNo: '', taxNo: role === 'Owner' ? '' : `SG ${String(2400000000 + i * 3711397).slice(0, 10)}`,
        bank: S.BANKS[i % 7], accountNo: String(1580000000000 + i * 1234567891).slice(0, 12),
        endDate: '', leaveReason: '', cp22Filed: start, leaverFiled: '', timePattern: '', probationEnd: '', confirmedOn: '', contractEnd: '',
        nationality: 'Malaysia', passportNo: '', passportExpiry: '', permitNo: '', permitExpiry: '',
        personalEmail: `${handle}.${last.toLowerCase().replace(/[^a-z]/g, '').slice(-6)}@gmail.com`,
        address: `No. ${8 + i * 5}, ${STREETS[i % STREETS.length]}, Johor`,
        emergency: { name: KIN[i % KIN.length][0], relation: KIN[i % KIN.length][1], phone: `01${(i + 3) % 10}-${String(7300000 + i * 81111).slice(0, 3)} ${String(1000 + i * 197).slice(-4)}` },
        education: [{ level: i < 6 || role.includes('Officer') || role.includes('Executive') ? 'Diploma' : 'SPM', field: '', institution: i % 2 ? 'SMK Sultan Abu Bakar, Muar' : 'Politeknik Muar', year: String(+start.slice(0, 4) - 2) }],
        employment: [], career: [{ id: `cr-${id}`, date: start, type: 'joined', to: role, note: departments.find((d) => d.id === dept).name }],
      };
    });
    const E = (id) => employees.find((e) => e.id === id);
    employees.forEach((e) => { const d = departments.find((x) => x.id === e.dept); e.manager = d.lead === e.id ? (e.id === 'e1' ? '' : 'e1') : d.lead; });
    // Drivers' delivery hours; the rest follow their department or the production roster.
    ['e26', 'e27', 'e28'].forEach((id) => { E(id).timePattern = 'p-drv'; });
    E('e15').probationEnd = U.addDays(T, 20); // Syahmi joined in March on a six-month probation, extended

    // ---------- Shifts and rosters ----------
    // Two production shifts: morning 7:00–15:00 and afternoon 15:00–23:00. On Friday the morning shift has a longer
    // break (90 minutes) so staff can go for Friday prayers, and ends at 15:30. The crews swap shifts every week.
    const TR = AllurusTimeRules, wk6 = [1, 2, 3, 4, 5, 6];
    settings.time = TR.defaultSettings({ restDays: L.weekendDays(settings.leave) });
    Object.assign(settings.time, {
      patterns: [
        { id: 'p-office', name: 'Office hours', start: '08:30', end: '17:30', breakMin: 60, grace: 10, days: wk6, flexible: false, color: '#0F766E' },
        { id: 'p-am', name: 'Morning shift', start: '07:00', end: '15:00', breakMin: 60, grace: 5, days: wk6, flexible: false, color: '#4A6FD1' },
        { id: 'p-am-fri', name: 'Morning shift (Friday)', start: '07:00', end: '15:30', breakMin: 90, grace: 5, days: [5], flexible: false, color: '#5E7FD8' },
        { id: 'p-pm', name: 'Afternoon shift', start: '15:00', end: '23:00', breakMin: 60, grace: 5, days: wk6, flexible: false, color: '#7A62C9' },
        { id: 'p-drv', name: 'Delivery', start: '08:00', end: '17:00', breakMin: 60, grace: 10, days: wk6, flexible: false, color: '#B8914A' },
      ],
      deptPattern: { 'd-mgmt': 'p-office', 'd-admin': 'p-office', 'd-prod': 'p-am', 'd-qc': 'p-am', 'd-maint': 'p-am', 'd-sales': 'p-office' },
      minStaff: { 'd-prod': 8 },
      templates: [{ id: 't-crews', name: 'Production crews (weekly swap)', weeks: [['p-am', 'p-am', 'p-am', 'p-am', 'p-am-fri', 'p-am', 'off'], ['p-pm', 'p-pm', 'p-pm', 'p-pm', 'p-pm', 'p-pm', 'off']] }],
    });
    // Overtime: the Employment Act rates already in the app (js/attendance-rules.js defaultOT, 1.5× on a working
    // day). Supervisors confirm hours from the time cards, so overtime is counted from check-out without a request.
    // Only staff earning RM4,000 a month or less are paid overtime, as in the brief; check the current wage limit
    // in the Employment Act First Schedule before relying on it.
    Object.assign(settings.time.ot, { preApproval: false, eligibleMax: 4000 });
    const crewA = ['e7', 'e9', 'e10', 'e11', 'e12', 'e13'], crewB = ['e8', 'e14', 'e15', 'e16', 'e17'];
    const monday = TR.mondayOf(START), weeks = Math.ceil((U.parse(T) - U.parse(monday)) / 6048e5) + 2;
    const rosters = {};
    [[crewA, 0], [crewB, 1]].forEach(([ids, sw]) => {
      const r = TR.applyTemplate(settings.time.templates[0], { monday, weeks, empIds: ids, startWeek: sw, stagger: false });
      Object.entries(r).forEach(([d, v]) => { rosters[d] = { ...(rosters[d] || {}), ...v }; });
    });
    const shiftOf = (e, d) => TR.resolveDay({ day: d, roster: rosters[d]?.[e.id], empPattern: e.timePattern, deptPattern: settings.time.deptPattern[e.dept], cfg: settings.time, holiday: lctx.holidays.has(d) });

    // ---------- Leave ----------
    const doc = (title, lines) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560"><rect width="420" height="560" fill="#fbfaf6"/><rect x="18" y="18" width="384" height="524" fill="none" stroke="#c9c3b3" stroke-width="2"/><text x="40" y="70" font-family="Arial" font-size="20" font-weight="700" fill="#1c3f6e">${title}</text>${lines.map((l, i) => `<text x="40" y="${120 + i * 34}" font-family="Arial" font-size="15" fill="#333">${l}</text>`).join('')}<circle cx="320" cy="470" r="42" fill="none" stroke="#b5382f" stroke-width="3"/><text x="320" y="476" font-family="Arial" font-size="12" text-anchor="middle" fill="#b5382f">CHOP</text></svg>`;
      return { name: `${title.toLowerCase().replace(/[^a-z]+/g, '-')}.jpg`, mime: 'image/svg+xml', data: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), size: svg.length };
    };
    const span = (from, n) => { let d = from, k = 1; while (k < n) { d = U.addDays(d, 1); if (isWork(d)) k++; } return d; };
    const leaves = [];
    const leave = (empId, type, from, to, reason, decisions = [], extra = {}) => {
      const e = E(empId), t = settings.leave.types.find((x) => x.id === type);
      let chain = L.buildChain({ applicant: empId, chain: settings.leave.chains[e.dept], hr: settings.leave.hr, hrBackup: settings.leave.hrBackup });
      let status = 'Pending';
      decisions.forEach((dec) => { const step = L.nextStep(chain); if (!step) return; const r = L.decide(chain, { by: step.approver, approve: dec === true, note: dec === true ? '' : dec, at: U.addDays(from, -2) < T ? U.addDays(from, -2) : T }); chain = r.chain; status = r.status; });
      const days = extra.half ? 0.5 : L.countDays({ from, to, calendar: t.calendar }, lctx).days;
      leaves.push({ id: `l${leaves.length + 1}`, empId, type, from, to, half: '', days, reason, attachment: null, status, created: U.addDays(from, -7) < T ? U.addDays(from, -7) : T, chain, ...extra });
    };
    const ALL = [true, true, true];
    const mc = (who, clinic, day) => ({ attachment: doc('Medical Certificate', [clinic, `Patient: ${who}`, `Unfit for duty: ${U.fmtDate(day)}`, '1 day', 'Dr. Aishah binti Mokhtar', 'MMC 61234']) });
    leave('e10', 'sick', wd(-1), wd(-1), 'Food poisoning. MC attached.', ALL, mc('Ahmad Zaki bin Hashim', 'Klinik Kesihatan Bakri', wd(-1)));
    leave('e14', 'sick', wd(-9), wd(-9), 'Fever. MC from Klinik Muar.', ALL, mc('Rosnah binti Abdullah', 'Klinik Mediviron Muar', wd(-9)));
    leave('e27', 'sick', wd(-23), wd(-23), 'Back pain after loading. MC attached.', ALL, mc('Rahman bin Sulaiman', 'Klinik Kesihatan Muar', wd(-23)));
    leave('e11', 'annual', wd(-30), span(wd(-30), 3), 'Balik kampung to Kuala Pilah', ALL);
    leave('e19', 'annual', wd(-45), span(wd(-45), 2), 'Son’s school registration', ALL);
    leave('e16', 'emergency', wd(-5), wd(-5), 'Mother admitted to Hospital Pakar Sultanah Fatimah', ALL);
    leave('e24', 'annual', wd(-60), span(wd(-60), 4), 'Family holiday in Melaka', ALL);
    leave('e3', 'annual', wd(-15), wd(-15), 'Personal matter', ALL, { half: 'PM' });
    // Waiting for the production supervisor (Azman) to decide.
    leave('e12', 'annual', wd(4), span(wd(4), 2), 'Cousin’s wedding in Batu Pahat');
    leave('e17', 'annual', wd(9), span(wd(9), 3), 'Family trip to Cameron Highlands');
    leave('e13', 'emergency', wd(1), wd(1), 'Car service appointment, only slot available');
    leave('e22', 'annual', wd(6), wd(6), 'Renew driving licence at JPJ');
    leave('e9', 'annual', wd(-2), wd(-2), 'Hari Raya open house at my aunt’s', ['Deepavali orders week; please take it after the 8th.']);

    // ---------- Attendance ----------
    // Mostly on time; a few late arrivals and absences. In the two busy weeks before Deepavali (shops stock up),
    // the morning crew, drivers and the store stay back 2–3 hours; otherwise the odd hour of overtime.
    const attendance = {};
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const busyFrom = wd(-14), busyTo = wd(-1);
    const otTeams = (e) => ['d-prod', 'd-qc'].includes(e.dept) || ['e26', 'e27', 'e28'].includes(e.id);
    const leaveDays = {};
    leaves.filter((l) => l.status === 'Approved').forEach((l) => L.countDays({ from: l.from, to: l.to }, lctx).dates.forEach((d) => { (leaveDays[d] = leaveDays[d] || new Set()).add(l.empId); }));
    for (const day of workdays(START, T)) {
      attendance[day] = {};
      employees.forEach((e) => {
        if (e.id === 'e1' || e.start > day) return;
        if (leaveDays[day]?.has(e.id)) { attendance[day][e.id] = { s: 'leave', in: '' }; return; }
        // People who sign in for the demo check in themselves today.
        if (day === T && ['e9', 'e26'].includes(e.id)) return;
        const sh = shiftOf(e, day);
        if (!sh.pattern || sh.off) return;
        const p = sh.pattern, x = rnd(), j = rnd(), o = rnd();
        if (x < 0.015) { attendance[day][e.id] = { s: 'absent', in: '' }; return; }
        const late = x > 0.94;
        const inM = TR.toMin(p.start) + (late ? 8 + Math.floor(j * 28) : -18 + Math.floor(j * 20));
        if (day === T && inM > nowMin) return;
        let outM = TR.toMin(p.end) + Math.floor(o * 12);
        if (otTeams(e) && p.id !== 'p-pm') {
          if (day >= busyFrom && day <= busyTo && o < 0.85) outM = TR.toMin(p.end) + 120 + Math.floor(o * 60);
          else if (o > 0.9) outM = TR.toMin(p.end) + 60 + Math.floor((o - 0.9) * 300);
        }
        attendance[day][e.id] = { s: 'present', in: TR.fmtMin(inM), out: day === T ? '' : TR.fmtMin(Math.min(outM, 23 * 60 + 50)) };
      });
    }

    // ---------- Claims ----------
    const receipt = AllurusClaims.receiptSvg;
    const claimChain = (empId, status, at) => {
      const e = E(empId);
      let ch = L.buildChain({ applicant: empId, chain: settings.leave.chains[e.dept], hr: settings.leave.hr, hrBackup: settings.leave.hrBackup });
      if (status !== 'Pending') ch = ch.map((s) => (s.status === 'pending' ? { ...s, status: status === 'Rejected' ? 'rejected' : 'approved', by: s.approver, at, actedAs: 'approver' } : s));
      return ch;
    };
    let ln = 0;
    const line = (cat, date, merchant, amount, item, fields = {}) => ({ id: `ln${++ln}`, cat, date, merchant, receiptNo: `R${40100 + ln}`, amount: r2(amount), approved: null, img: receipt(merchant, [[item, amount.toFixed(2)]], amount.toFixed(2), date, `R${40100 + ln}`), notes: '', fields });
    const claims = [];
    const claim = (empId, title, lines, status, paidIn = '') => {
      if (['Approved', 'Paid'].includes(status)) lines.forEach((l) => { l.approved = l.amount; });
      const c = { id: `cl${claims.length + 1}`, empId, title, lines, status, submitted: lines[0].date, date: lines[0].date, chain: claimChain(empId, status, U.addDays(lines[0].date, 2)), edits: [], ...(paidIn ? { paidIn } : {}) };
      c.approved = ['Approved', 'Paid'].includes(status) ? r2(lines.reduce((s, l) => s + l.approved, 0)) : null;
      claims.push(c);
    };
    const thisMonth = U.monthKey(T), months = [3, 2, 1].map((k) => U.addMonths(thisMonth, -k));
    months.forEach((mk, k) => {
      const d = (n) => `${mk}-${U.pad(n)}`;
      claim('e26', `Delivery trips, ${U.fmtMonth(mk)}`, [
        line('parking', d(6), 'PLUS (Touch ’n Go)', 38.6, 'Toll Pagoh – Yong Peng return', { purpose: 'Delivery to wholesaler, Batu Pahat' }),
        line('parking', d(14), 'Majlis Perbandaran parking', 6, 'Parking, Batu Pahat town', { purpose: 'Delivery' }),
        line('travel', d(19), 'Stesen Minyak Bakri Jaya', 180, 'Diesel for lorry JUB 3307 (company card declined)', { purpose: 'Delivery route B' }),
      ], 'Paid', mk);
      claim('e27', `Van parking and toll, ${U.fmtMonth(mk)}`, [
        line('parking', d(8), 'PLUS (Touch ’n Go)', 12.4, 'Toll Tangkak return', { purpose: 'Delivery route A' }),
        line('parking', d(21), 'Parking Pasar Besar Muar', 4, 'Parking for unloading', { purpose: 'Delivery' }),
      ], 'Paid', mk);
      if (k !== 1) claim('e21', 'Spare parts paid in cash', [line('other', d(11), 'Kedai Alat Ganti Mesin Teknikal (demo)', k ? 245 : 168, k ? 'Bearing set and V-belt for grinder' : 'Thermocouple for kawah burner', { purpose: 'Repair' })], 'Paid', mk);
    });
    claim('e26', 'Delivery trips, this month', [line('parking', U.addDays(T, -6), 'PLUS (Touch ’n Go)', 38.6, 'Toll Pagoh – Yong Peng return', { purpose: 'Delivery to wholesaler' }), line('travel', U.addDays(T, -3), 'Stesen Minyak Bakri Jaya', 150, 'Diesel for lorry JUB 3307', { purpose: 'Delivery route B' })], 'Pending');
    claim('e21', 'Seal kit for filling machine (cash)', [line('other', U.addDays(T, -2), 'Kedai Alat Ganti Mesin Teknikal (demo)', 96, 'Temporary O-rings for filling nozzle', { purpose: 'Breakdown repair' })], 'Approved');
    claim('e23', 'Client visits, Batu Pahat', [line('mileage', U.addDays(T, -4), 'Own car', 64.8, 'Mileage 108 km', { purpose: 'Visit new mini markets', from: 'Muar', to: 'Batu Pahat', km: 108 })], 'Pending');

    // ---------- Payroll: the last three months, with overtime at the app's rates ----------
    const otRules = settings.time.ot;
    const otLines = (e, mk) => {
      const days = Object.keys(attendance).filter((d) => d.startsWith(mk)).map((d) => {
        const rec = attendance[d][e.id], sh = shiftOf(e, d);
        return { day: d, buckets: TR.evaluate({ rec, pattern: sh.pattern, type: sh.type, rules: otRules }).buckets };
      });
      const cap = TR.capMonth(days, otRules), pay = TR.otPay(cap.buckets, e.salary / 12, otRules);
      if (!(pay.amount > 0)) return [];
      const mins = TR.paidMinutes(cap.buckets);
      return [{ key: 'ot', label: `Overtime, ${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`, amount: pay.amount, epf: !!otRules.epf, socso: !!otRules.socso, tax: !!otRules.tax, detail: `${pay.lines.map((l) => `${TR.fmtDur ? TR.fmtDur(l.minutes) : l.minutes + ' min'} × ${l.rate}`).join(', ')} at RM ${pay.hourly?.toFixed?.(2) ?? ''} an hour` }];
    };
    const payroll = {};
    months.forEach((mk) => {
      const end = U.monthEnd(mk);
      const items = employees.filter((e) => e.type !== 'Owner' && e.start <= end).map((e) => {
        const extra = otLines(e, mk);
        const it = { empId: e.id, ...U.payCalc(e.salary, 0, settings, e, U.addDays(end, -1), { extra }), extraLines: extra };
        claims.filter((c) => c.status === 'Paid' && c.paidIn === mk && c.empId === e.id).forEach((c) => {
          it.claims = r2((it.claims || 0) + c.approved); it.claimIds = [...(it.claimIds || []), c.id]; it.net = r2(it.net + c.approved);
          AllurusClaimRules.glRows(c, settings.claims.categories).forEach((g) => { it.claimGL = { ...(it.claimGL || {}), [g.gl]: r2((it.claimGL?.[g.gl] || 0) + g.amount) }; });
        });
        return it;
      });
      payroll[mk] = { status: 'Paid', paidOn: U.addDays(end, -1), items };
    });
    const statutory = { filed: {}, eaIssued: {}, formEFiled: {} };
    months.forEach((mk) => { const d = `${U.addMonths(mk, 1)}-10`; if (d <= T) statutory.filed[mk] = { epf: d, socso: d, pcb: d, hrdf: d }; });

    // ---------- Staff documents with expiry dates ----------
    // Food handlers (production, QC and store) keep a typhoid vaccination record and a food handler training
    // certificate on file (Food Hygiene Regulations 2009); drivers keep their driving licence and, for the lorry,
    // a GDL. Three of these expire within the next 30 days so the reminders show.
    const docImg = (title, who, line) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380"><rect width="600" height="380" rx="18" fill="#f5f5f7" stroke="#d0d3d9"/><rect x="0" y="0" width="600" height="64" rx="18" fill="#0F766E"/><text x="28" y="41" font-family="Arial" font-size="22" fill="#fff" font-weight="700">${title}</text><text x="28" y="130" font-family="Arial" font-size="26" fill="#16181D">${who}</text><text x="28" y="175" font-family="Arial" font-size="18" fill="#575B63">${line}</text><text x="28" y="350" font-family="Arial" font-size="13" fill="#8A8F98">Sample copy for the Allurus demo</text></svg>`);
    let dn = 0;
    const fileDoc = (empId, title, category, expiry, line, uploaded) => { const e = E(empId); return { id: `doc${++dn}`, empId, title, category, expiry, file: { name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`, type: 'image/svg+xml', data: docImg(title, `${e.first} ${e.last}`, line) }, uploaded: uploaded || U.addDays(T, -200), by: 'e2' }; };
    const foodHandlers = employees.filter((e) => ['d-prod', 'd-qc'].includes(e.dept));
    const SOON = { e12: ['Typhoid vaccination', 12], e19: ['Food handler certificate', 20] };
    const documents = [];
    foodHandlers.forEach((e, i) => {
      const typh = SOON[e.id]?.[0] === 'Typhoid vaccination' ? U.addDays(T, SOON[e.id][1]) : U.addDays(T, 120 + i * 37);
      const fh = SOON[e.id]?.[0] === 'Food handler certificate' ? U.addDays(T, SOON[e.id][1]) : U.addDays(T, 200 + i * 29);
      documents.push(fileDoc(e.id, 'Typhoid vaccination', 'Certificate', typh, `Vaccinated · valid until ${U.fmtDate(typh)}`));
      documents.push(fileDoc(e.id, 'Food handler certificate', 'Certificate', fh, `Food handler training · valid until ${U.fmtDate(fh)}`));
    });
    documents.push(fileDoc('e26', 'Driving licence (D, E)', 'Licence', U.addDays(T, 410), 'Class D and E'), fileDoc('e26', 'GDL (goods vehicle)', 'Licence', U.addDays(T, 25), 'Goods Driving Licence'));
    documents.push(fileDoc('e27', 'Driving licence (D)', 'Licence', U.addDays(T, 640), 'Class D'), fileDoc('e28', 'Driving licence (D)', 'Licence', U.addDays(T, 300), 'Class D'));

    // ---------- Operations ----------
    const ops = { items: [], moves: [], pos: [], products: [], batches: [], orders: [], dos: [], machines: [], maint: [], breakdowns: [], licences: [], seq: {} };
    let mv = 0;
    const move = (itemId, date, qty, ref, note) => ops.moves.push({ id: `mv${++mv}`, itemId, date, qty: Math.round(qty * 1000) / 1000, ref, note });
    // Vendors (made-up businesses) with their payment terms and delivery lead time.
    const VENDORS = [
      ['v-chilli', 'Syarikat Bekalan Cili Jaya', 'Raw materials', 14, 4], ['v-bawang', 'Muar Agro Trading', 'Raw materials', 14, 3],
      ['v-oil', 'Kilang Minyak Masak Seri Pagoh (demo)', 'Raw materials', 30, 3], ['v-runcit', 'Bekalan Runcit Hup Seng', 'Raw materials', 30, 2],
      ['v-pack', 'Pembungkusan Kaca Selatan Sdn Bhd', 'Packaging', 30, 5], ['v-label', 'Cetak Label Pantas', 'Packaging', 30, 4],
      ['v-carton', 'Kotak Karton Muar Sdn Bhd', 'Packaging', 30, 3], ['v-gas', 'Gas Muar Trading', 'Utilities', 7, 0],
      ['v-elec', 'Utiliti Elektrik Selatan (demo)', 'Utilities', 14, 0], ['v-water', 'Syarikat Air Muar (demo)', 'Utilities', 14, 0],
      ['v-diesel', 'Stesen Minyak Bakri Jaya', 'Fuel and transport', 7, 0], ['v-parts', 'Kedai Alat Ganti Mesin Teknikal (demo)', 'Repairs and maintenance', 14, 2],
    ];
    const vend = (id) => VENDORS.find((v) => v[0] === id);
    // [id, code, name, kind, unit, opening, reorder, vendor, price]
    [['i-chilli', 'RM-CHL', 'Dried chilli', 'raw', 'kg', 650, 250, 'v-chilli', 14.5], ['i-shallot', 'RM-SHL', 'Shallots and onions', 'raw', 'kg', 520, 200, 'v-bawang', 6.2],
      ['i-garlic', 'RM-GAR', 'Garlic', 'raw', 'kg', 160, 60, 'v-bawang', 8.8], ['i-oil', 'RM-OIL', 'Cooking oil', 'raw', 'kg', 480, 180, 'v-oil', 5.9],
      ['i-salt', 'RM-SLT', 'Salt', 'raw', 'kg', 110, 40, 'v-runcit', 1.2], ['i-sugar', 'RM-SUG', 'Sugar', 'raw', 'kg', 260, 100, 'v-runcit', 2.95],
      ['i-jar', 'PK-JAR', 'Glass jar 500 g', 'pack', 'pcs', 4200, 1500, 'v-pack', 0.95], ['i-cap', 'PK-CAP', 'Jar cap', 'pack', 'pcs', 4400, 1500, 'v-pack', 0.22],
      ['i-tub', 'PK-TUB', 'Tub 1 kg with lid', 'pack', 'pcs', 1100, 400, 'v-pack', 1.15], ['i-pail', 'PK-PAL', 'Pail 5 kg with lid', 'pack', 'pcs', 200, 80, 'v-pack', 3.8],
      ['i-label', 'PK-LBL', 'Labels and stickers', 'pack', 'pcs', 6500, 2000, 'v-label', 0.11], ['i-carton', 'PK-CTN', 'Cartons', 'pack', 'pcs', 420, 150, 'v-carton', 1.45],
    ].forEach(([id, code, name, kind, unit, opening, reorder, vendorId, lastPrice]) => ops.items.push({ id, code, name, kind, unit, opening, reorder, vendorId, lastPrice, openingDate: START }));
    const base = (chilli) => [['i-chilli', chilli], ['i-shallot', 50], ['i-garlic', 12], ['i-oil', 40], ['i-salt', 6], ['i-sugar', 18]];
    const bom = (rows) => rows.map(([itemId, qty]) => ({ itemId, qty }));
    ops.products = [
      { id: 'p-o500', code: 'CB-O500', name: 'Cili Boh Original 500 g jar', unit: 'jar', price: 9.5, batchSize: 400, shelfDays: 270, bom: bom([...base(60), ['i-jar', 400], ['i-cap', 400], ['i-label', 400], ['i-carton', 17]]) },
      { id: 'p-o1k', code: 'CB-O1K', name: 'Cili Boh Original 1 kg tub', unit: 'tub', price: 17.5, batchSize: 200, shelfDays: 270, bom: bom([...base(60), ['i-tub', 200], ['i-label', 200], ['i-carton', 17]]) },
      { id: 'p-p500', code: 'CB-P500', name: 'Cili Boh Pedas 500 g jar', unit: 'jar', price: 10, batchSize: 400, shelfDays: 270, bom: bom([['i-chilli', 75], ['i-shallot', 45], ['i-garlic', 12], ['i-oil', 42], ['i-salt', 6], ['i-sugar', 15], ['i-jar', 400], ['i-cap', 400], ['i-label', 400], ['i-carton', 17]]) },
      { id: 'p-pail', code: 'CB-P5K', name: 'Cili Boh 5 kg pail (food trade)', unit: 'pail', price: 78, batchSize: 40, shelfDays: 180, bom: bom([...base(60), ['i-pail', 40], ['i-label', 40]]) },
    ];
    const prod = (id) => ops.products.find((p) => p.id === id);
    const levels = () => O.stockLevels(ops.items, ops.moves, ops.pos);
    const no = (prefix, d) => { const k = `${prefix}${d.slice(2, 4)}${d.slice(5, 7)}`; ops.seq[k] = (ops.seq[k] || 0) + 1; return `${prefix}-${d.slice(2, 4)}${d.slice(5, 7)}-${String(ops.seq[k]).padStart(3, '0')}`; };

    // Clients (made-up): [id, name, kind, terms, route, orders per week, usual order]
    const CLIENTS = [
      ['c-pakmat', 'Kedai Runcit Pak Mat', 'shop', 'COD', 'A', 2, { 'p-o500': 12, 'p-p500': 6 }],
      ['c-maksu', 'Kedai Runcit Mak Su, Parit Jawa', 'shop', 'COD', 'A', 2, { 'p-o500': 12, 'p-p500': 6, 'p-o1k': 3 }],
      ['c-ahseng', 'Kedai Runcit Ah Seng, Bakri', 'shop', 'COD', 'A', 2, { 'p-o500': 12, 'p-p500': 6 }],
      ['c-hjosman', 'Kedai Runcit Haji Osman, Tangkak', 'shop', 'COD', 'B', 1, { 'p-o500': 24, 'p-p500': 12 }],
      ['c-kakyah', 'Kedai Runcit Kak Yah, Pagoh', 'shop', 'COD', 'B', 1, { 'p-o500': 12, 'p-o1k': 6 }],
      ['c-sribakri', 'Mini Market Sri Bakri', 'mini', 'Credit 30', 'B', 1, { 'p-o500': 36, 'p-p500': 12, 'p-o1k': 12 }],
      ['c-harmoni', 'Mini Market Harmoni, Tangkak', 'mini', 'Credit 30', 'B', 1, { 'p-o500': 36, 'p-p500': 12, 'p-o1k': 12 }],
      ['c-pantai', 'Mini Market Pantai Leka', 'mini', 'Credit 30', 'A', 1, { 'p-o500': 36, 'p-p500': 12, 'p-o1k': 12 }],
      ['c-jayabp', 'Pasar Mini Jaya, Batu Pahat', 'mini', 'Credit 30', 'B', 1, { 'p-o500': 36, 'p-p500': 12, 'p-o1k': 12 }],
      ['c-wangi', 'Restoran Nasi Lemak Wangi', 'restaurant', 'Credit 30', 'A', 1, { 'p-pail': 2, 'p-o1k': 6 }],
      ['c-selera', 'Restoran Selera Kampung Muar', 'restaurant', 'Credit 30', 'A', 1, { 'p-pail': 1, 'p-o1k': 6 }],
      ['c-meebandung', 'Restoran Mee Bandung Haji Ali', 'restaurant', 'COD', 'A', 1, { 'p-pail': 2 }],
      ['c-paklong', 'Gerai Nasi Ayam Pak Long', 'restaurant', 'COD', 'A', 1, { 'p-o1k': 6 }],
      ['c-sinar', 'Syarikat Borong Sinar Selatan', 'wholesale', 'Credit 30', 'B', 0.5, { 'p-o500': 240, 'p-p500': 96, 'p-o1k': 48, 'p-pail': 6 }],
      ['c-teguh', 'Pemborong Makanan Teguh Jaya', 'wholesale', 'Credit 30', 'B', 0.5, { 'p-o500': 240, 'p-p500': 96, 'p-o1k': 24 }],
    ];
    // How long each client usually takes to pay a credit invoice (days after the invoice). Selera pays very late.
    const PAYS = { 'c-sribakri': 26, 'c-harmoni': 30, 'c-pantai': 48, 'c-jayabp': 33, 'c-wangi': 28, 'c-selera': 999, 'c-sinar': 35, 'c-teguh': 40 };
    const FG_MIN = { 'p-o500': 650, 'p-o1k': 260, 'p-p500': 320, 'p-pail': 30 };

    // Machines and vehicles: also on the asset register (Assets & loans), linked by assetId.
    // [id, name, kind, pmDays, pmHours, hours, lastPm (days ago), lastPmHours, extra]
    const MACHINES = [
      ['m-grinder', 'Chilli grinder', 'machine', 0, 500, 2210, 40, 1850, { location: 'Prep room' }],
      ['m-kawah1', 'Cooking kettle (kawah) 1', 'machine', 30, 0, 0, 25, 0, { location: 'Cooking line' }],
      ['m-kawah2', 'Cooking kettle (kawah) 2', 'machine', 30, 0, 0, 12, 0, { location: 'Cooking line' }],
      ['m-filler', 'Filling machine', 'machine', 0, 250, 1980, 20, 1820, { location: 'Filling line' }],
      ['m-capper', 'Capping machine', 'machine', 30, 0, 0, 27, 0, { location: 'Filling line' }],
      ['m-sealer', 'Induction sealer', 'machine', 60, 0, 0, 30, 0, { location: 'Filling line' }],
      ['m-labeller', 'Label applicator', 'machine', 60, 0, 0, 41, 0, { location: 'Packing' }],
      ['m-chiller', 'Chiller room', 'machine', 90, 0, 0, 50, 0, { location: 'Store' }],
      ['m-burner', 'Gas burner (cooking line)', 'machine', 30, 0, 0, 38, 0, { location: 'Cooking line' }],
      ['v-van', 'Delivery van (JRM 4521)', 'vehicle', 180, 0, 0, 70, 0, { plate: 'JRM 4521', roadTax: U.addDays(T, 22), insurance: U.addDays(T, 22), serviceKm: 10000, mileage: 84230, lastServiceKm: 80100 }],
      ['v-lorry', 'Lorry 3-tonne (JUB 3307)', 'vehicle', 180, 0, 0, 100, 0, { plate: 'JUB 3307', roadTax: U.addDays(T, 140), insurance: U.addDays(T, 140), serviceKm: 10000, mileage: 152870, lastServiceKm: 145600 }],
    ];
    MACHINES.forEach(([id, name, kind, pmDays, pmHours, hours, ago, lastPmHours, extra]) => ops.machines.push({ id, name, kind, pmDays, pmHours, hours, lastPm: U.addDays(T, -ago), lastPmHours, status: 'Running', assetId: `as-${id}`, ...extra }));
    MACHINES.forEach(([id, name, kind, pmDays, , , ago]) => {
      const every = pmDays || 35;
      for (let back = ago; back <= 95; back += every) ops.maint.push({ id: `pm-${id}-${back}`, machineId: id, date: U.addDays(T, -back), kind: 'PM', by: back % 2 ? 'e22' : 'e21', notes: kind === 'vehicle' ? 'Service at the workshop: oil, filters, brakes checked' : 'Cleaned, lubricated, checked seals and wiring', cost: kind === 'vehicle' ? 680 : 0 });
    });

    // ---------- Finance books ----------
    const fin = AllurusFinance.blank({ taxLabel: 'SST', auditorFirm: '', auditorName: '', auditorEmail: '' });
    fin.openingCash = 145000; fin.openingDate = U.monthKey(START) + '-01';
    fin.budgets = { Payroll: 75000, 'Raw materials': 26000, Packaging: 9000, Utilities: 4200, 'Fuel and transport': 2400, 'Repairs and maintenance': 1500, 'Office supplies': 300, 'Bank charges': 60 };
    const contacts = [];
    const addr = (line1, city, postcode) => ({ line1, line2: '', line3: '', city, postcode, state: '01', country: 'MYS' });
    CLIENTS.forEach(([id, name, kind, terms], i) => contacts.push({ id, kind: 'customer', name, tin: '', idType: 'BRN', idNo: '', sst: 'NA', email: `${id.slice(2)}@example.my`, phone: `+60 6-${String(9500000 + i * 73117).slice(0, 3)} ${String(1000 + i * 271).slice(-4)}`, contactName: '', address: addr(`No. ${3 + i * 4}, Jalan ${['Bakri', 'Abdullah', 'Sulaiman', 'Meriam', 'Haji Abu'][i % 5]}`, ['Muar', 'Tangkak', 'Batu Pahat', 'Pagoh'][i % 4], ['84000', '84900', '83000', '84600'][i % 4]), terms, segment: kind }));
    VENDORS.forEach(([id, name, category, terms], i) => contacts.push({ id, kind: 'supplier', name, tin: '', idType: 'BRN', idNo: '', sst: 'NA', email: `accounts@${id.slice(2)}.example.my`, phone: `+60 6-${String(9800000 + i * 51173).slice(0, 3)} ${String(2000 + i * 317).slice(-4)}`, contactName: '', address: addr(`Lot ${10 + i}, Jalan Perusahaan`, 'Muar', '84000'), category, terms: `${terms} days` }));
    const cName = (id) => contacts.find((c) => c.id === id)?.name || id;
    const tx = (o) => { if (o.date <= T && o.date >= fin.openingDate) fin.txns.push({ id: `x${fin.txns.length + 1}`, tax: 0, ref: '', source: 'manual', reconciled: o.date < `${thisMonth}-01`, ...o }); };
    const billFor = (vendorId, date, amount, desc, extra = {}) => {
      const v = vend(vendorId), b = { id: `b${fin.bills.length + 1}`, supplier: v[1], contactId: vendorId, ref: extra.ref || `${v[1].replace(/[^A-Z]/g, '').slice(0, 3) || 'BIL'}-${date.replace(/-/g, '').slice(2)}`, category: v[2], issue: date, due: U.addDays(date, v[3]), amount: r2(amount), tax: 0, status: 'Unpaid', paidOn: '', note: desc, ...extra };
      fin.bills.push(b);
      return b;
    };
    let invN = 0;
    const invoiceFor = (d, doRec, so) => {
      const c = contacts.find((x) => x.id === so.clientId);
      const items = so.lines.filter((l) => l.qty > 0).map((l) => ({ desc: prod(l.productId).name, qty: l.qty, price: l.price, classification: '022' }));
      const inv = { id: `i${++invN}`, no: `INV-${d.slice(2, 4)}${d.slice(5, 7)}-${String(invN).padStart(4, '0')}`, customer: c.name, contactId: c.id, email: c.email, issue: d, due: so.terms === 'COD' ? d : U.addDays(d, 30), items, taxRate: 0, status: 'Sent', paidOn: '', type: 'invoice', category: 'Product sales', doId: doRec.id, soId: so.id };
      fin.invoices.push(inv);
      return inv;
    };

    // ---------- Simulate the last three months, day by day ----------
    // Morning: cook what is running low (up to two batches a day, one per shift). Day: deliver the day's orders,
    // oldest expiry first. Evening: reorder raw materials that dropped to their reorder level.
    let batchN = 0, poN = 0, soN = 0;
    const OPS_OPERATORS = { A: crewA, B: crewB };
    const makeBatch = (d, productId, shift, opts = {}) => {
      const p = prod(productId), planned = p.batchSize;
      const actual = opts.actual ?? Math.round(planned * (0.955 + rnd() * 0.04));
      const reject = opts.reject ?? (actual ? planned - actual : 0);
      const made = opts.status === 'Planned' ? 0 : planned;
      const used = made ? O.recipeUsage(p, made) : [];
      const b = { id: `bt${++batchN}`, no: no('B', d), date: d, shift, productId, planned, actual, reject, operators: [...(rosters[d] && Object.entries(rosters[d]).filter(([, v]) => (shift === 'AM' ? ['p-am', 'p-am-fri'] : ['p-pm']).includes(v)).map(([k]) => k) || [])].slice(0, 6), used, qc: opts.qc || 'Pass', qcNote: opts.qcNote || '', qcBy: 'e18', expiry: U.addDays(d, p.shelfDays), status: opts.status || 'Done', machineIds: ['m-kawah1', 'm-filler'] };
      if (!b.operators.length) b.operators = shift === 'AM' ? OPS_OPERATORS.A.slice(0, 4) : OPS_OPERATORS.B.slice(0, 4);
      used.forEach((u) => move(u.itemId, d, -u.qty, b.no, 'Used in production'));
      ops.batches.push(b);
      return b;
    };
    // Opening finished goods: one batch of each product made in the weeks before the period.
    ops.products.forEach((p, i) => { const d = wd(-100 - i * 4); const b = makeBatch(d, p.id, 'AM'); b.used.forEach((u) => { ops.moves.pop(); }); b.used = O.recipeUsage(p, p.batchSize); });
    // (the opening batches used stock before the opening count, so their usage is not in the moves)
    const fgAvail = (productId, d) => O.lots(ops.batches.filter((b) => b.date <= d), ops.dos, productId, d).reduce((s, l) => s + l.available, 0);
    const openPOFor = (itemId) => ops.pos.find((p) => ['Approved', 'Sent', 'Partial'].includes(p.status) && p.lines.some((l) => l.itemId === itemId));
    const placePOs = (d) => {
      const low = levels().filter((lv) => lv.low && !openPOFor(lv.id));
      const byVendor = {};
      low.forEach((lv) => (byVendor[lv.vendorId] = byVendor[lv.vendorId] || []).push(lv));
      Object.entries(byVendor).forEach(([vendorId, lvs]) => {
        const v = vend(vendorId);
        const lines = lvs.map((lv) => { const q = Math.max(O.suggestQty(lv), 3 * lv.reorder - lv.onHand - (lv.onOrder || 0)), unit = lv.unit === 'pcs' ? 100 : 10; return { itemId: lv.id, qty: Math.ceil(q / unit) * unit, price: lv.lastPrice, received: 0 }; });
        ops.pos.push({ id: `po${++poN}`, no: no('PO', d), vendorId, date: d, expected: U.addDays(d, v[4] || 2), status: 'Sent', lines, by: 'e5', approvedBy: 'e2', approvedOn: d, sentOn: d, billId: '' });
      });
    };
    const receivePOs = (d) => {
      ops.pos.filter((p) => ['Sent', 'Partial'].includes(p.status) && p.expected <= d).forEach((p) => {
        // One jar delivery arrives short; the rest comes later.
        const partial = p.lines.some((l) => l.itemId === 'i-jar') && p.date >= U.addDays(T, -14) && !p.partialDone;
        const got = Object.fromEntries(p.lines.map((l) => [l.itemId, partial ? Math.floor((l.qty - (l.received || 0)) * 0.6 / 100) * 100 : l.qty]));
        const res = O.receive(p, got, { date: d, ids: () => `mv${++mv}` });
        Object.assign(p, res.po); ops.moves.push(...res.moves);
        if (partial) { p.partialDone = true; p.expected = U.addDays(T, 3); return; }
        const b = billFor(p.vendorId, d, O.poTotal(p), `${p.no}: ${p.lines.map((l) => ops.items.find((i) => i.id === l.itemId).name.toLowerCase()).join(', ')}`, { ref: `${p.no}`, poId: p.id });
        p.status = 'Billed'; p.billId = b.id;
      });
    };
    const dayOrders = (d, i) => CLIENTS.filter(([, , , , , perWeek], k) => {
      if (perWeek >= 2) return (i + k) % 3 === 0;
      if (perWeek === 1) return (i + k) % 6 === 0;
      return (i + k) % 12 === 0;
    });
    const deliver = (d, client, status = 'Delivered', seq = 1) => {
      const [clientId, , , terms, route, , usual] = client;
      const so = { id: `so${++soN}`, no: no('SO', d), clientId, date: U.addDays(d, -1), terms, lines: [], status: status === 'Delivered' ? 'Delivered' : 'Open', doId: '' };
      const doRec = { id: `do${soN}`, no: no('DO', d), soId: so.id, date: d, driverId: route === 'A' ? 'e27' : 'e26', helperId: route === 'B' ? 'e28' : '', vehicleId: route === 'A' ? 'v-van' : 'v-lorry', route: route === 'A' ? 'Route A: Muar town, Bakri, Parit Jawa' : 'Route B: Tangkak, Pagoh, Batu Pahat', seq, status, picks: [], deliveredAt: '', cash: 0, invoiceId: '' };
      Object.entries(usual).forEach(([productId, q]) => {
        const qty = Math.max(0, Math.round(q * (0.75 + rnd() * 0.5)));
        const { picks } = O.pickFEFO(O.lots(ops.batches.filter((b) => b.date <= d), ops.dos, productId, d), qty);
        const got = picks.reduce((s, p) => s + p.qty, 0);
        if (!got) return;
        so.lines.push({ productId, qty: got, price: prod(productId).price });
        picks.forEach((p) => doRec.picks.push({ productId, batchId: p.batchId, qty: p.qty }));
      });
      if (!so.lines.length) { soN--; return null; }
      so.doId = doRec.id;
      ops.orders.push(so); ops.dos.push(doRec);
      if (status === 'Delivered') {
        doRec.deliveredAt = iso(d, `${String(9 + seq).padStart(2, '0')}:${String(10 + (seq * 17) % 45).padStart(2, '0')}`);
        const inv = invoiceFor(d, doRec, so);
        doRec.invoiceId = inv.id;
        const total = AllurusFinance.invoiceTotals(inv).total;
        if (terms === 'COD') {
          doRec.cash = total; inv.status = 'Paid'; inv.paidOn = d;
          tx({ date: d, desc: `Cash on delivery from ${cName(clientId)}`, type: 'in', category: 'Product sales', amount: total, ref: inv.no, source: 'invoice' });
        } else {
          const payDay = U.addDays(d, (PAYS[clientId] || 30) + between(-4, 6));
          if (payDay <= T && payDay <= U.addDays(T, -1)) { inv.status = 'Paid'; inv.paidOn = payDay; tx({ date: payDay, desc: `Payment from ${cName(clientId)}`, type: 'in', category: 'Product sales', amount: total, ref: inv.no, source: 'invoice' }); }
        }
      }
      return doRec;
    };
    const days = workdays(START, U.addDays(T, -1));
    days.forEach((d, i) => {
      receivePOs(d);
      // Production: up to two batches, the products with the least stock against their minimum first.
      const need = ops.products.map((p) => ({ p, gap: fgAvail(p.id, d) / FG_MIN[p.id] })).filter((x) => x.gap < 1).sort((a, b) => a.gap - b.gap).slice(0, 2);
      need.forEach(({ p }, k) => {
        if (O.shortfalls(p, p.batchSize, levels()).length) return;
        makeBatch(d, p.id, k ? 'PM' : 'AM');
      });
      dayOrders(d, i).forEach((c, k) => deliver(d, c, 'Delivered', k + 1));
      placePOs(d);
    });
    // Today: a morning batch in progress and an afternoon batch planned; one Pedas batch from two days ago on QC hold.
    const hold = ops.batches.filter((b) => b.productId === 'p-p500' && b.date < T).slice(-1)[0];
    if (hold) Object.assign(hold, { qc: 'Hold', qcNote: 'Colour darker than the standard sample and oil separating. Sent a sample to the lab; keep off sale until the result is back.' });
    receivePOs(T);
    makeBatch(T, 'p-o500', 'AM', { actual: 0, reject: 0, status: 'In progress', qc: 'Pending' });
    makeBatch(T, 'p-o1k', 'PM', { actual: 0, reject: 0, status: 'Planned', qc: 'Pending' });
    // Today's deliveries: two routes, three drops each, the first drop on each route already delivered.
    const TODAY = [[CLIENTS[0], 'Delivered'], [CLIENTS[11], 'Out'], [CLIENTS[2], 'Out'], [CLIENTS[5], 'Delivered'], [CLIENTS[8], 'Out'], [CLIENTS[13], 'Planned']];
    const routeSeq = { A: 0, B: 0 };
    TODAY.forEach(([c, status]) => { routeSeq[c[4]]++; const dr = deliver(T, c, status, routeSeq[c[4]]); if (dr && status === 'Delivered') dr.photo = docImg('Proof of delivery', cName(c[0]), `Received by the shop · ${U.fmtDate(T)}`); });
    // Purchase orders: two waiting for delivery and the partly received jar order; keep exactly three items low.
    placePOs(T);
    if (!ops.pos.some((p) => p.status === 'Partial')) {
      const it = ops.items.find((x) => x.id === 'i-jar');
      const p = { id: `po${++poN}`, no: no('PO', wd(-6)), vendorId: 'v-pack', date: wd(-6), expected: U.addDays(T, 3), status: 'Sent', lines: [{ itemId: 'i-jar', qty: 3000, price: it.lastPrice, received: 0 }, { itemId: 'i-cap', qty: 3000, price: 0.22, received: 0 }], by: 'e5', approvedBy: 'e2', approvedOn: wd(-6), sentOn: wd(-6), billId: '' };
      const res = O.receive(p, { 'i-jar': 1800, 'i-cap': 3000 }, { date: wd(-1), ids: () => `mv${++mv}` });
      Object.assign(p, res.po, { expected: U.addDays(T, 3), note: 'Supplier short-shipped jars; balance of 1,200 promised this week.' }); ops.moves.push(...res.moves);
      ops.pos.push(p);
    }
    // A draft PO waiting for the Admin Manager's approval.
    ops.pos.push({ id: `po${++poN}`, no: no('PO', T), vendorId: 'v-runcit', date: T, expected: U.addDays(T, 3), status: 'Draft', lines: [{ itemId: 'i-sugar', qty: 200, price: 2.95, received: 0 }], by: 'e5', approvedBy: '', billId: '' });
    // Exactly three items below their reorder level: two with nothing on order yet (they get the "Make PO" button)
    // and the jars, whose order arrived short. Reorder levels are only ever raised here, never lowered.
    {
      const lv = levels();
      const free = lv.filter((x) => !openPOFor(x.id) && x.kind === 'raw').sort((a, b) => a.onHand / a.reorder - b.onHand / b.reorder).slice(0, 2).map((x) => x.id);
      const lowSet = new Set([...free, 'i-jar']);
      lv.forEach((x) => {
        const it = ops.items.find((i) => i.id === x.id);
        if (lowSet.has(x.id) && x.onHand > it.reorder) it.reorder = Math.ceil((x.onHand * 1.15) / 10) * 10;
        // Anything else still low has its order on the way: top it up as if that delivery had come in.
        if (!lowSet.has(x.id) && x.onHand <= it.reorder) {
          const po = openPOFor(x.id);
          if (po && po.status === 'Sent') {
            const res = O.receive(po, Object.fromEntries(po.lines.map((l) => [l.itemId, l.qty])), { date: wd(-1), ids: () => `mv${++mv}` });
            Object.assign(po, res.po); ops.moves.push(...res.moves);
            const b = billFor(po.vendorId, wd(-1), O.poTotal(po), `${po.no}: ${po.lines.map((l) => ops.items.find((i) => i.id === l.itemId).name.toLowerCase()).join(', ')}`, { ref: po.no, poId: po.id });
            po.status = 'Billed'; po.billId = b.id;
          }
        }
      });
    }
    // Two more orders on the way: labels and cartons bought ahead of the Deepavali rush.
    ['i-label', 'i-carton'].forEach((itemId, k) => {
      if (openPOFor(itemId) || ops.pos.filter((p) => p.status === 'Sent').length >= 2) return;
      const it = ops.items.find((x) => x.id === itemId), v = vend(it.vendorId);
      ops.pos.push({ id: `po${++poN}`, no: no('PO', wd(-2 + k)), vendorId: it.vendorId, date: wd(-2 + k), expected: U.addDays(T, 2 + k), status: 'Sent', lines: [{ itemId, qty: itemId === 'i-label' ? 6000 : 300, price: it.lastPrice, received: 0 }], by: 'e5', approvedBy: 'e2', approvedOn: wd(-2 + k), sentOn: wd(-2 + k), billId: '' });
      void v;
    });
    // Machines: the filling machine is down since this morning, waiting for a seal kit; history of fixed breakdowns.
    const nowIso = new Date().toISOString();
    let bkN = 0;
    const breakdown = (machineId, daysAgo, hm, problem, hours, parts, by, extra = {}) => {
      const at = iso(U.addDays(T, -daysAgo), hm);
      const b = { id: `bk${++bkN}`, no: `BD-${String(bkN).padStart(3, '0')}`, machineId, reportedBy: by, reportedAt: at, problem, photo: null, assignee: 'e21', status: hours == null ? 'Waiting for part' : 'Fixed', fixedAt: hours == null ? '' : new Date(Date.parse(at) + hours * 36e5).toISOString(), downtime: hours ?? 0, fix: extra.fix || '', parts, billId: '' };
      if (parts.length && extra.bill) { const bill = billFor('v-parts', U.addDays(T, -daysAgo + 1), parts.reduce((s, p) => s + p.qty * p.cost, 0), `Parts for ${b.no}: ${parts.map((p) => p.name).join(', ')}`, { ref: `PARTS-${b.no}` }); b.billId = bill.id; }
      ops.breakdowns.push(b);
      return b;
    };
    breakdown('m-grinder', 82, '10:20', 'Grinder motor overheating and tripping', 6, [{ name: 'Motor bearing set', qty: 1, cost: 185 }, { name: 'V-belt', qty: 2, cost: 30 }], 'e10', { bill: true, fix: 'Replaced bearings and belts; cleaned the motor vents.' });
    breakdown('m-capper', 64, '14:05', 'Caps not tightening, jars leaking', 2.5, [], 'e14', { fix: 'Adjusted torque clutch.' });
    breakdown('m-burner', 51, '07:40', 'Burner won’t light on kawah 2', 4, [{ name: 'Thermocouple', qty: 1, cost: 168 }], 'e11', { fix: 'Replaced the thermocouple.' });
    breakdown('m-labeller', 33, '09:15', 'Labels going on crooked', 1.5, [], 'e13', { fix: 'Re-aligned the guide rollers.' });
    breakdown('v-van', 21, '11:30', 'Van battery flat at Parit Jawa', 3, [{ name: 'Battery NS70', qty: 1, cost: 320 }], 'e27', { bill: true, fix: 'Battery replaced on site.' });
    breakdown('m-chiller', 9, '06:50', 'Chiller room at 9 °C at the start of shift', 5, [{ name: 'Refrigerant top-up', qty: 1, cost: 260 }], 'e19', { bill: true, fix: 'Leak sealed at the evaporator and gas topped up. Stock checked by QC: fine.' });
    const down = breakdown('m-filler', 0, '08:10', 'Filling nozzle leaking paste; seal worn. Line stopped.', null, [{ name: 'Nozzle seal kit (ordered)', qty: 1, cost: 410 }], 'e9');
    Object.assign(down, { notes: 'Seal kit ordered from the supplier, arriving tomorrow. Temporary O-rings fitted for one test run only.' });
    ops.machines.find((m) => m.id === 'm-filler').status = 'Down';
    void nowIso;

    // Company licences and certificates, with expiry dates (also in "Expiring soon").
    ops.licences = [
      { id: 'lic-halal', name: 'Halal certificate', issuer: 'JAKIM', no: 'JAKIM/DEMO/0000', expiry: U.addDays(T, 150) },
      { id: 'lic-mesti', name: 'MeSTI certificate', issuer: 'Ministry of Health (food safety)', no: 'MeSTI-DEMO-0000', expiry: U.addDays(T, 48) },
      { id: 'lic-council', name: 'Business and factory licence', issuer: 'Local council (Majlis Perbandaran Muar)', no: 'MPM-DEMO-0000', expiry: `${T.slice(0, 4)}-12-31` },
    ];

    // Utility, gas and diesel bills over the period; most paid, some due this week and two overdue.
    months.concat([thisMonth]).forEach((mk, k) => {
      const d = (n) => `${mk}-${U.pad(n)}`;
      if (d(5) <= T) billFor('v-elec', d(5), 2650 + k * 140, `Electricity, ${U.fmtMonth(U.addMonths(mk, -1))}`);
      if (d(7) <= T) billFor('v-water', d(7), 380 + k * 25, `Water, ${U.fmtMonth(U.addMonths(mk, -1))}`);
      [2, 9, 16, 23].forEach((n) => { if (d(n) <= T) billFor('v-gas', d(n), 620 + ((n + k) % 3) * 40, 'LPG cylinders, cooking line'); });
      [4, 11, 18, 25].forEach((n) => { if (d(n) <= T) billFor('v-diesel', d(n), 240 + ((n + k) % 4) * 25, 'Diesel, van and lorry (fleet account)'); });
    });
    // Pay bills: anything due more than a few days ago is paid, except two left overdue.
    const overdueKeep = new Set();
    fin.bills.filter((b) => b.due < T).sort((a, b) => b.due.localeCompare(a.due)).filter((b) => ['v-gas', 'v-pack'].includes(b.contactId)).slice(0, 2).forEach((b) => overdueKeep.add(b.id));
    fin.bills.forEach((b) => {
      if (overdueKeep.has(b.id) || b.due > U.addDays(T, -1)) return;
      b.status = 'Paid'; b.paidOn = b.due < U.addDays(T, -1) ? b.due : U.addDays(T, -1);
      tx({ date: b.paidOn, desc: `${b.supplier} · ${b.note || b.ref}`, type: 'out', category: b.category, amount: b.amount, tax: 0, ref: b.ref, source: 'bill' });
    });
    months.forEach((mk) => tx({ date: U.monthEnd(mk), desc: 'Bank service charges', type: 'out', category: 'Bank charges', amount: 42 }));
    fin.contacts = contacts;

    // Assets: the machines and vehicles above, plus office laptops and the sales team's phones.
    let an = 0;
    const asset = (id, type, name, value, holder, bought, notes = '') => ({ id: id || `as${++an}`, tag: `SE-${String(++an).padStart(4, '0')}`, type, name, serial: `SE${String(31907 + an * 4127).slice(-5)}${'KQMRTX'[an % 6]}`, value, bought, holder, issued: holder ? bought : '', returned: '', notes, history: [] });
    const VALUES = { 'm-grinder': 18500, 'm-kawah1': 26000, 'm-kawah2': 26000, 'm-filler': 42000, 'm-capper': 15800, 'm-sealer': 12400, 'm-labeller': 21000, 'm-chiller': 38000, 'm-burner': 8600, 'v-van': 96000, 'v-lorry': 138000 };
    const assets = ops.machines.map((m) => asset(m.assetId, m.kind === 'vehicle' ? 'Vehicle' : 'Machine', m.name, VALUES[m.id] || 10000, m.id === 'v-van' ? 'e27' : m.id === 'v-lorry' ? 'e26' : '', '2021-03-01', m.plate ? `Plate ${m.plate}; road tax and insurance to ${U.fmtDate(m.roadTax)}` : m.location || ''));
    ['e2', 'e3', 'e4', 'e5'].forEach((id) => assets.push(asset('', 'Laptop', 'Acer Aspire 5', 2899, id, '2024-01-08')));
    ['e23', 'e24', 'e25', 'e26', 'e27'].forEach((id) => assets.push(asset('', 'Phone', 'Samsung Galaxy A35', 1399, id, '2025-02-03', 'For orders, deliveries and check-in')));

    // HR, appraisals, notifications and announcements.
    const HR = AllurusHRRules, AR = AllurusAppraisalRules, NR = AllurusNotifyRules;
    settings.hr = { onboarding: HR.defaultOnboarding(), offboarding: HR.defaultOffboarding(), letters: HR.defaultLetters(), it: 'e3', payroll: 'e4' };
    settings.appraisal = { templates: [AR.defaultTemplate()], bands: AR.defaultBands(), peerMin: 2 };
    const td = AllurusSeed.talentDefaults();
    Object.assign(settings, { recruit: td.recruit, grievance: { ...td.grievance, managers: ['e2', 'e3'] }, training: { window: 60 } });
    let nid = 0;
    const note = (type, data, to, at) => NR.deliver(type, { company: COMPANY, ...data }, [{ id: to, email: E(to).email, first: E(to).first, prefs: {} }], { at, ids: () => `sn${++nid}` });
    const seeded = [
      note('request.submitted', { who: 'Kamal bin Ariffin', kind: 'leave', summary: 'Hafiz, cousin’s wedding', href: '#my-approvals' }, 'e6', iso(T, '07:45')),
      note('payslip.ready', { month: months[2], net: 'RM 1,742.30', href: '#my-pay' }, 'e9', iso(U.addDays(T, -20), '17:30')),
    ];
    const announcements = [
      { id: 'an1', kind: 'announcement', title: 'Deepavali orders: overtime this week and next', at: iso(wd(-14), '08:00'), by: 'e2', depts: ['d-prod', 'd-qc', 'd-sales'], pinned: true, attachment: null,
        html: '<p>Shops are stocking up for Deepavali. The <strong>morning crew, store and drivers</strong> will stay back 2–3 hours until the 7th. Overtime is paid at the normal rates and shows on your payslip.</p><p>Talk to Azman if you can’t stay on a given day.</p>', acks: {} },
      { id: 'an2', kind: 'policy', title: 'Food hygiene: keep your typhoid jab and food handler certificate valid', at: iso(U.addDays(T, -30), '09:00'), by: 'e2', depts: ['d-prod', 'd-qc'], pinned: false, attachment: null,
        html: '<p>Everyone who handles food must have a <strong>valid typhoid vaccination</strong> and a <strong>food handler certificate</strong> on file. Allurus reminds you and Admin before they expire.</p><p>Book your renewal with Siti Khadijah.</p>',
        acks: Object.fromEntries(['e6', 'e7', 'e8', 'e9', 'e11', 'e14', 'e18', 'e19'].map((id, i) => [id, iso(U.addDays(T, -29 + (i % 3)), '10:00')])) },
    ];
    const accounts = [
      { email: 'rosli@suriaenterprise.my', name: 'Rosli bin Hamzah', hash: '5e602f7073a57837eac00890654ede94e2860d9814dab3c076663fbda1cabeea', roles: ['admin', 'employee'], tenantId: 't1', empId: 'e1' },
      { email: 'norhayati@suriaenterprise.my', name: 'Norhayati binti Ismail', hash: '23956a9ce8ba052aa225306c1019a2ed78934e30d07129639898be7b05f851d1', roles: ['admin', 'employee'], perms: ['people', 'time', 'payroll', 'claims', 'finance', 'operations', 'settings'], tenantId: 't1', empId: 'e2' },
      { email: 'meifong@suriaenterprise.my', name: 'Tan Mei Fong', hash: 'fe4d69199efa5cfd6d665b7a2625e4fbc26a0098a2cc55f0c9d28c9cf4cec58e', roles: ['admin', 'employee'], perms: ['finance', 'claims'], tenantId: 't1', empId: 'e4' },
      { email: 'azman@suriaenterprise.my', name: 'Azman bin Yusof', hash: '01fdc451d759245fd58004f98df976f108ea2c8516d1ae0a33466a0d7de428ed', roles: ['employee'], tenantId: 't1', empId: 'e6' },
      { email: 'halim@suriaenterprise.my', name: 'Halim bin Saad', hash: '884a1f6b52259ed1cecb8abd8ef6662656ec7996764456db8900f59fb0ef430d', roles: ['admin', 'employee'], perms: ['operations'], opsScope: ['stock', 'production'], tenantId: 't1', empId: 'e19' },
      { email: 'shahrul@suriaenterprise.my', name: 'Shahrul Nizam bin Ahmad', hash: '8403c437a841daebb7f1f09b026912bd879b9a67223f22cfef454f29e084af0f', roles: ['admin', 'employee'], perms: ['operations'], opsScope: ['machines'], tenantId: 't1', empId: 'e21' },
      { email: 'siewling@suriaenterprise.my', name: 'Lee Siew Ling', hash: '0be9e0b047720e5e68dfd8f1689e451a4f25032650d35e17b55c80dd2169ec0d', roles: ['admin', 'employee'], perms: ['operations'], opsScope: ['sales'], tenantId: 't1', empId: 'e23' },
      { email: 'ismail@suriaenterprise.my', name: 'Ismail bin Daud', hash: '986a6baa82eab77a3014551e0116b0a253c65674c77287dd5d78e090fbc2707b', roles: ['employee'], tenantId: 't1', empId: 'e26' },
      { email: 'nurulhuda@suriaenterprise.my', name: 'Nurul Huda binti Salleh', hash: '0f54e81db1fc3ce507f469f750c08f5c62cc7601568757bcbf951818ee208e39', roles: ['employee'], tenantId: 't1', empId: 'e9' },
    ];
    const platform = AllurusSeed.platform(employees.length, { row: [COMPANY, 'Muar', 'Food manufacturing', 'Malaysia', 'growth', employees.length, 'Active', 95], admin: 'norhayati@suriaenterprise.my' });
    const now = Date.now();
    const activity = [
      { t: now - 1000 * 60 * 20, text: 'Nurul Huda reported a breakdown: filling machine' },
      { t: now - 1000 * 60 * 60 * 2, text: `Batch ${ops.batches.filter((b) => b.date < T).slice(-1)[0]?.no || ''} released by QC` },
      { t: now - 1000 * 60 * 60 * 26, text: `Payroll for ${U.fmtMonth(months[2])} was paid` },
    ];
    return {
      version: 3, demoCompany: 'suria', session: { account: null, roles: [], role: null, empId: 'e9', tenantId: 't1' }, accounts, workspaces: {},
      finance: fin, reliefs: {}, taxProfiles: {}, claims, plans: {}, leaveCarry: {}, leaveCredits: [], rosters, timeRequests: [], attAudit: [], statutory, projects: [],
      announcements, notifications: seeded.flatMap((x) => x.notifications), outbox: seeded.flatMap((x) => x.emails), notifyKeys: [], settings, departments, employees, leaves, attendance, payroll,
      jobs: [], candidates: [], reviews: [], cycles: [], goals: [], payChanges: [], costing: { groups: [], jobs: [], timesheets: [] }, savedReports: [],
      requisitions: [], courses: td.courses, enrolments: [], trainingRequests: [], grievances: [], rooms: [], bookings: [],
      editRequests: [], checklists: [], assets, loans: [], insurance: [], documents, activity, platform, ops,
    };
  }

  AllurusSeed.companies.suria = {
    id: 'suria', name: COMPANY, short: 'Suria Enterprise', blurb: 'Cili boh factory, Muar', storeKey: 'allurus-hr-suria-v1', published, create,
    logins: [
      ['rosli@suriaenterprise.my', 'Owner', 'Rosli · everything, month summary'], ['norhayati@suriaenterprise.my', 'Admin Manager', 'Norhayati · operations today'],
      ['meifong@suriaenterprise.my', 'Accounts', 'Mei Fong · invoices and bills'], ['azman@suriaenterprise.my', 'Supervisor', 'Azman · approves production'],
      ['halim@suriaenterprise.my', 'Store', 'Halim · stock and POs'], ['shahrul@suriaenterprise.my', 'Technician', 'Shahrul · machines'],
      ['siewling@suriaenterprise.my', 'Sales', 'Siew Ling · orders and deliveries'], ['ismail@suriaenterprise.my', 'Driver', 'Ismail · deliveries (phone)'],
      ['nurulhuda@suriaenterprise.my', 'Operator', 'Nurul Huda · check in, breakdowns'],
    ],
  };
})();
