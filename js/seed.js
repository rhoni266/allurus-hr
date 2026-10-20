// Demo workspace. Dates are generated relative to today so the data always looks current.
window.AllurusSeed = {
  // The demo company's own clients (a Kuantan software and digital agency), billed in its books.
  clients: [
    ['Pantai Timur Logistics', 'accounts@pantaitimur.com.my'], ['Kenyir Eco Resorts', 'finance@kenyireco.my'], ['Klinik Desa Sejahtera', 'admin@klinikdesa.my'],
    ['Mutiara Retail Group', 'ap@mutiararetail.com.my'], ['Teratai Properties', 'accounts@terataiprop.my'], ['Gemilang Education Centre', 'bursar@gemilang.edu.my'],
    ['Sinar Fresh Mart', 'finance@sinarfresh.my'], ['Borneo Agro Ventures', 'ap@borneoagro.com.my'],
  ].map(([name, email]) => ({ name, email })),
  // The company's check-in point as published with the app. Every browser keeps its own copy of the
  // settings (localStorage), so this is the only value an employee's phone sees until HR sends a setup
  // link. When HR moves the check-in point, update these numbers and bump `at` so phones pick it up.
  published: { company: 'Seri Maju Digital Sdn Bhd', label: 'Seri Maju HQ, Kuantan', lat: 4.238203, lng: 103.419428, radius: 50, field: [], at: Date.UTC(2026, 9, 19, 1, 0) },
  create() {
    const r = U.rng(42);
    const T = U.today();
    // Check-in zone: employees must be inside this circle (radius in meters) and take a selfie.
    const P = AllurusSeed.published;
    const checkin = { label: P.label, lat: P.lat, lng: P.lng, radius: P.radius, remote: false, field: [...P.field], setAt: P.at };
    const settings = { company: 'Seri Maju Digital Sdn Bhd', domain: 'serimaju.com.my', currency: 'MYR', office: 'Kuantan', checkin, taxRate: 8, benefitsRate: 11.7, theme: 'system', statutory: { ...U.STATUTORY }, claims: AllurusClaims.policyDefaults() };

    const departments = [
      { id: 'd-people', name: 'People', lead: 'e1', color: '#14958A', about: 'Hires, develops and looks after staff, and keeps employment practices compliant.', duties: 'Recruitment, Onboarding, Leave and attendance, Performance reviews, Employee relations' },
      { id: 'd-eng', name: 'Engineering', lead: 'e4', color: '#4A6FD1', about: 'Builds and runs the apps, websites and systems Seri Maju delivers to clients.', duties: 'Product development, Infrastructure, Security, Quality assurance' },
      { id: 'd-design', name: 'Design', lead: 'e3', color: '#B8914A', about: 'Shapes how the product and brand look and work.', duties: 'Product design, User research, Brand' },
      { id: 'd-sales', name: 'Sales', lead: 'e14', color: '#C2577A', about: 'Wins new customers and grows existing accounts.', duties: 'Prospecting, Demos, Proposals, Renewals' },
      { id: 'd-mkt', name: 'Marketing', lead: 'e9', color: '#7A62C9', about: 'Builds awareness and brings in leads.', duties: 'Campaigns, Content, Digital ads, Events' },
      { id: 'd-fin', name: 'Finance and Accounting', lead: 'e11', color: '#5E8C3A',
        about: 'Manages the company’s financial health, cash flow, and regulatory compliance.',
        duties: 'Bookkeeping, Budgeting, Payroll, Invoicing, Accounts payable and receivable, Tax filing, Financial reporting',
        note: 'Very small SMEs often outsource this function to external accounting firms or use automated cloud accounting software. In Allurus the books keep themselves and each month’s report goes to your auditor to verify.' },
    ];

    // e-Leave: Terengganu calendar (rest days Friday and Saturday), Employment Act leave types with a
    // more generous annual allowance, and approval chains per department with backups.
    const L = AllurusLeaveRules;
    settings.leave = L.defaultSettings({ state: 'Terengganu', departments, hr: 'e1', hrBackup: 'e15' });
    Object.assign(settings.leave.types.find((t) => t.id === 'annual'), { tiers: [14, 16, 20] });
    Object.assign(settings.leave.chains, {
      'd-people': { l1: 'e1', l1b: 'e15', l2: '', l2b: '' },
      'd-eng': { l1: 'e4', l1b: 'e2', l2: '', l2b: '' },
      'd-design': { l1: 'e3', l1b: 'e16', l2: '', l2b: '' },
      'd-sales': { l1: 'e14', l1b: 'e6', l2: '', l2b: '' },
      'd-mkt': { l1: 'e9', l1b: 'e13', l2: 'e14', l2b: 'e11' },
      'd-fin': { l1: 'e11', l1b: 'e17', l2: '', l2b: '' },
    });
    U.setWeekend(L.weekendDays(settings.leave));

    const people = [
      ['Aisyah', 'Rahman', 'Head of People', 'd-people', 96000, '2019-03-11', 'Kuantan'],
      ['Daniel', 'Lim', 'Senior Software Engineer', 'd-eng', 102000, '2020-10-19', 'Remote'],
      ['Farah', 'Idris', 'Lead Product Designer', 'd-design', 90000, '2020-01-20', 'Kuala Lumpur'],
      ['Arjun', 'Pillai', 'Engineering Manager', 'd-eng', 132000, '2018-09-03', 'Kuantan'],
      ['Priya', 'Nair', 'Frontend Engineer', 'd-eng', 66000, '2022-02-14', 'Remote'],
      ['Kevin', 'Tan', 'Account Executive', 'd-sales', 54000, '2021-05-17', 'Kuala Lumpur'],
      ['Nadia', 'Yusof', 'Data Analyst', 'd-fin', 60000, '2023-04-03', 'Remote'],
      ['Jason', 'Wong', 'Backend Engineer', 'd-eng', 72000, '2021-11-08', 'Kuantan'],
      ['Michelle', 'Teoh', 'Marketing Lead', 'd-mkt', 84000, '2019-10-21', 'Kuala Lumpur'],
      ['Amirul', 'Hakim', 'Sales Development Rep', 'd-sales', 39000, '2024-01-15', 'Kuantan'],
      ['Grace', 'Ng', 'Finance Manager', 'd-fin', 108000, '2018-06-25', 'Kuantan'],
      ['Faizal', 'Osman', 'DevOps Engineer', 'd-eng', 84000, '2022-08-29', 'Remote'],
      ['Syafiqah', 'Roslan', 'Content Strategist', 'd-mkt', 48000, '2023-09-11', 'Kuala Terengganu'],
      ['Ravi', 'Shankar', 'Head of Sales', 'd-sales', 120000, '2019-02-04', 'Kuala Lumpur'],
      ['Hidayah', 'Zulkifli', 'HR Generalist', 'd-people', 45000, '2024-06-03', 'Kuantan'],
      ['Iman', 'Hashim', 'Brand Designer', 'd-design', 54000, '2023-01-09', 'Kuala Lumpur'],
      ['Mei', 'Chen', 'Accountant', 'd-fin', 57000, '2022-10-17', 'George Town'],
      ['Hilmi', 'Zainal', 'QA Engineer', 'd-eng', 51000, '2024-03-18', 'Remote'],
      ['Nurul', 'Aina', 'Payroll Executive', 'd-fin', 36000, U.addDays(T, -12), 'Kuantan'],
    ];
    const upcoming = { 2: 5, 6: 0, 11: 23, 15: 29 }; // index -> birthday in N days (Nadia's is today)
    const employees = people.map((p, i) => {
      const [first, last, role, dept, salary, start, location] = p;
      let birthday;
      if (upcoming[i] != null) {
        const b = U.addDays(T, upcoming[i]);
        birthday = `${1985 + (i % 12)}${b.slice(4)}`;
      } else {
        birthday = `${1984 + (i % 14)}-${U.pad(1 + ((i * 5) % 12))}-${U.pad(3 + ((i * 7) % 25))}`;
      }
      return {
        id: 'e' + (i + 1), first, last, role, dept, salary, start, location, birthday,
        email: `${first}.${last}`.toLowerCase() + '@' + settings.domain,
        phone: `+60 1${(i % 8) + 2}-${310 + i * 7} ${4000 + i * 137}`,
        type: i === 17 ? 'Contract' : 'Full-time',
        status: 'Active',
        manager: dept === 'd-eng' && i !== 3 ? 'e4' : (departments.find((d) => d.id === dept).lead === 'e' + (i + 1) ? 'e1' : departments.find((d) => d.id === dept).lead),
      };
    });
    // Gender and marital status decide maternity and paternity leave.
    const fam = { e1: ['female', true], e2: ['male', true], e3: ['female', false], e4: ['male', true], e5: ['female', false], e6: ['male', false], e7: ['female', true], e8: ['male', false], e9: ['female', true],
      e10: ['male', true], e11: ['female', true], e12: ['male', true], e13: ['female', false], e14: ['male', true], e15: ['female', false], e16: ['male', false], e17: ['female', true], e19: ['female', false], e18: ['male', false] };
    employees.forEach((e) => { [e.gender, e.married] = fam[e.id] || ['', false]; });
    employees[0].manager = '';
    employees[0].email = 'admin@allurus.com';
    employees[1].email = 'emp@allurus.com';
    employees.forEach((e) => { if (e.location !== 'Remote') e.location = 'Kuantan'; });
    // Statutory IDs and bank accounts (all fictional). IC numbers start with the birth date; 11 is Terengganu.
    // Hilmi has no tax number or bank account yet, so the statutory and bank files show what is missing.
    const S = AllurusStatutory;
    employees.forEach((e, i) => {
      const b = e.birthday.replace(/-/g, '').slice(2);
      Object.assign(e, {
        idType: 'mykad', ic: `${b}11${String(1000 + i * 37).slice(-3)}${(e.gender === 'male' ? 1 : 2) + (i % 4) * 2}`,
        epfNo: String(14000000 + i * 271843).slice(0, 8), socsoNo: '', taxNo: `SG ${String(2100000000 + i * 3711397).slice(0, 10)}`,
        bank: S.BANKS[i % 7], accountNo: String(1640000000000 + i * 1234567891).slice(0, 12),
        endDate: '', leaveReason: '', cp22Filed: e.start < U.addDays(T, -60) ? e.start : '', leaverFiled: '',
      });
    });
    Object.assign(employees[17], { taxNo: '', bank: '', accountNo: '' });
    // Iman is leaving at the end of next month: CP22A is due 30 days before his last day.
    Object.assign(employees[15], { endDate: U.addDays(T, 40), leaveReason: 'resign' });
    settings.employer = { ssm: '202101023456 (1418823-K)', epfNo: '021784593', socsoNo: 'E1104002873X', lhdnNo: 'E 9182736401', hrdNo: 'HRDC-AL-2021-0451', address: 'Lot 7, Jalan Kampung Tengah, 24000 Kemaman, Terengganu', phone: '+60 9-859 2210', signatory: 'Aisyah Rahman', signatoryTitle: 'Head of People' };

    // Leave requests, dated around today on working days of the Terengganu calendar.
    const yr = +T.slice(0, 4);
    const lctx = L.calendarCtx(settings.leave, `${yr - 1}-01-01`, `${yr + 1}-12-31`);
    const work = (d) => { while (!L.isWorkingDay(d, lctx)) d = U.addDays(d, 1); return d; };
    const wd = (offset) => work(U.addDays(T, offset));
    const span = (from, n) => { let d = from, k = 1; while (k < n) { d = U.addDays(d, 1); if (L.isWorkingDay(d, lctx)) k++; } return d; };
    // A medical certificate image for the demo (real uploads are photos or PDFs).
    const doc = (title, lines) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560"><rect width="420" height="560" fill="#fbfaf6"/><rect x="18" y="18" width="384" height="524" fill="none" stroke="#c9c3b3" stroke-width="2"/><text x="40" y="70" font-family="Arial" font-size="20" font-weight="700" fill="#1c3f6e">${title}</text>${lines.map((l, i) => `<text x="40" y="${120 + i * 34}" font-family="Arial" font-size="15" fill="#333">${l}</text>`).join('')}<circle cx="320" cy="470" r="42" fill="none" stroke="#b5382f" stroke-width="3"/><text x="320" y="476" font-family="Arial" font-size="12" text-anchor="middle" fill="#b5382f">CHOP</text></svg>`;
      return { name: `${title.toLowerCase().replace(/[^a-z]+/g, '-')}.jpg`, mime: 'image/svg+xml', data: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), size: svg.length };
    };
    const typeById = (id) => settings.leave.types.find((t) => t.id === id);
    const leaves = [];
    // decisions: how many steps were approved (true) or the step that declined (a note string)
    const leave = (id, empId, type, from, to, reason, decisions = [], extra = {}) => {
      const e = employees.find((x) => x.id === empId), t = typeById(type);
      let chain = L.buildChain({ applicant: empId, chain: settings.leave.chains[e.dept], hr: settings.leave.hr, hrBackup: settings.leave.hrBackup });
      let status = 'Pending';
      decisions.forEach((d) => {
        const step = L.nextStep(chain); if (!step) return;
        const r = L.decide(chain, { by: step.approver, approve: d === true, note: d === true ? '' : d, at: U.addDays(from, -3) < T ? U.addDays(from, -3) : T });
        chain = r.chain; status = r.status;
      });
      const days = L.countDays({ from, to, half: extra.half || '', calendar: t.calendar }, lctx).days;
      leaves.push({ id, empId, type, from, to, half: '', days, reason, attachment: null, status, created: U.addDays(from, -10) < T ? U.addDays(from, -10) : T, chain, ...extra });
    };
    const all = [true, true, true];
    const omarFrom = wd(-1);
    leave('l1', 'e4', 'annual', omarFrom, span(omarFrom, 5), 'Family trip to Langkawi', all);
    leave('l2', 'e8', 'sick', wd(-1), wd(-1), 'Fever and cough. MC from Klinik Kesihatan Kemaman.', [], { attachment: doc('Medical Certificate', ['Klinik Kesihatan Kemaman', 'Patient: Jason Wong', `Unfit for duty: ${U.fmtDate(wd(-1))}`, '1 day', 'Dr. Nurul Huda binti Ahmad', 'MMC 54321']) });
    leave('l3', 'e5', 'annual', wd(3), span(wd(3), 3), 'Balik kampung to Ipoh');
    leave('l4', 'e13', 'annual', wd(10), span(wd(10), 3), 'Cousin’s wedding in Melaka', [true]);
    leave('l5', 'e7', 'maternity', wd(14), U.addDays(wd(14), 97), 'Expected delivery in early November', [true], { attachment: doc('Antenatal Record', ['Hospital Sultanah Nur Zahirah', 'Patient: Nadia Yusof', 'Expected date of delivery:', U.fmtDate(U.addDays(wd(14), 10)), 'Obstetrics clinic']) });
    leave('l6', 'e10', 'paternity', wd(-30), U.addDays(wd(-30), 6), 'Birth of our son', all, { attachment: doc('Birth Certificate', ['Jabatan Pendaftaran Negara', 'Child: Adam Silva', `Born: ${U.fmtDate(wd(-31))}`, 'Father: Amirul Hakim']) });
    leave('l7', 'e12', 'unpaid', wd(-6), span(wd(-6), 2), 'Family matter in Johor Bahru', all);
    leave('l8', 'e6', 'emergency', wd(-3), wd(-3), 'Car broke down on the way to work', all, { half: 'AM' });
    leave('l9', 'e17', 'compassionate', wd(-12), span(wd(-12), 3), 'Passing of my grandmother', all);
    leave('l10', 'e9', 'annual', wd(1), wd(1), 'Family day', all);
    leave('l11', 'e16', 'replacement', wd(2), wd(2), 'Replacement for working on Malaysia Day');
    leave('l12', 'e10', 'annual', wd(-40), span(wd(-40), 2), 'Long weekend in Cameron Highlands', ['Quarter-end demos that week. Can you move it a week later?']);
    leave('l13', 'e2', 'annual', work(`${yr}-03-10`), span(work(`${yr}-03-10`), 2), 'Hari Raya preparations', all);
    leave('l14', 'e2', 'annual', wd(-50), span(wd(-50), 2), 'School holidays with the kids', all);
    leave('l15', 'e15', 'sick', wd(-9), wd(-9), 'Migraine. MC attached.', all, { attachment: doc('Medical Certificate', ['Klinik Mediviron Kemaman', 'Patient: Hidayah Zulkifli', `Unfit for duty: ${U.fmtDate(wd(-9))}`, '1 day']) });
    leave('l16', 'e14', 'annual', wd(20), span(wd(20), 5), 'Umrah with my parents');
    leaves.forEach((l) => { if (l.half) l.days = 0.5; });
    // Replacement days earned and annual leave carried in from last year (expired at the end of June).
    const leaveCredits = [{ id: 'cr1', empId: 'e16', days: 2, date: `${yr}-09-16`, reason: 'Worked on Malaysia Day for the system cut-over' }];
    const leaveCarry = { [yr]: { e2: { annual: { days: 4, expires: `${yr}-06-30`, from: yr - 1 } }, e3: { annual: { days: 5, expires: `${yr}-06-30`, from: yr - 1 } }, e11: { annual: { days: 3, expires: `${yr}-06-30`, from: yr - 1 } } } };

    // Time attendance: the Terengganu week runs Sunday to Thursday. Most teams work office hours, Engineering is
    // flexible around core hours, and a support desk (Priya, Jason and Hilmi) rotates morning and evening shifts.
    const TR = AllurusTimeRules, wk = TR.workDays(L.weekendDays(settings.leave));
    settings.time = TR.defaultSettings({ restDays: L.weekendDays(settings.leave) });
    Object.assign(settings.time, {
      patterns: [
        { id: 'p-office', name: 'Office hours', start: '09:00', end: '18:00', breakMin: 60, grace: 10, days: wk, flexible: false, color: '#0F766E' },
        { id: 'p-am', name: 'Morning shift', start: '07:00', end: '16:00', breakMin: 60, grace: 5, days: wk, flexible: false, color: '#4A6FD1' },
        { id: 'p-pm', name: 'Evening shift', start: '14:00', end: '23:00', breakMin: 60, grace: 5, days: wk, flexible: false, color: '#7A62C9' },
        { id: 'p-flex', name: 'Flexible', start: '07:00', end: '19:00', coreStart: '10:00', coreEnd: '16:00', hours: 8, breakMin: 60, grace: 0, days: wk, flexible: true, color: '#B8914A' },
      ],
      deptPattern: { 'd-people': 'p-office', 'd-eng': 'p-flex', 'd-design': 'p-office', 'd-sales': 'p-office', 'd-mkt': 'p-office', 'd-fin': 'p-office' },
      minStaff: { 'd-eng': 6, 'd-sales': 3 },
      allowances: [...TR.defaultAllowances(true), { id: 'al-shift', name: 'Evening shift', kind: 'shift', weekday: 12, rest: 15, holiday: 20, late: 'full', absent: 'forfeit', partialPct: 50, remote: false, patterns: ['p-pm'], epf: true, socso: true, tax: true, on: true }],
      // Weeks run Monday to Sunday; Friday and Saturday are rest days.
      templates: [{ id: 't-support', name: 'Support desk', weeks: [['p-am', 'p-am', 'p-am', 'p-am', 'off', 'off', 'p-am'], ['p-pm', 'p-pm', 'p-pm', 'p-pm', 'off', 'off', 'p-pm']] }],
    });
    employees.forEach((e) => { e.timePattern = ''; });
    const rosters = TR.applyTemplate(settings.time.templates[0], { monday: TR.mondayOf(U.addDays(T, -35)), weeks: 8, empIds: ['e5', 'e8', 'e18'] });

    // Check-ins and check-outs follow each person's shift: mostly on time, sometimes late, early or staying on.
    const attendance = {};
    const rt = U.rng(11);
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const shiftOf = (e, day) => TR.resolveDay({ day, roster: rosters[day]?.[e.id], deptPattern: settings.time.deptPattern[e.dept], cfg: settings.time, holiday: lctx.holidays.has(day) }).pattern;
    for (let k = -30; k <= 0; k++) {
      const day = U.addDays(T, k);
      if (U.isWeekend(day) || lctx.holidays.has(day)) continue;
      attendance[day] = {};
      employees.forEach((e) => {
        if (e.start > day) return;
        // Leave today empty for people who can sign in (Aisyah and Daniel), so they can try checking in themselves.
        if (k === 0 && (e.id === 'e1' || e.id === 'e2')) return;
        const x = r(), j = r(), o = rt();
        const s = x < 0.8 ? 'present' : x < 0.93 ? 'remote' : x < 0.98 ? 'absent' : 'present';
        if (s === 'absent') { attendance[day][e.id] = { s, in: '' }; return; }
        const p = shiftOf(e, day);
        const inM = p.flexible ? 8 * 60 + Math.floor(j * 130) : TR.toMin(p.start) + (j < 0.9 ? -18 + Math.floor((j / 0.9) * 24) : 12 + Math.floor((j - 0.9) * 300));
        if (k === 0 && inM > nowMin) return;
        const endM = p.flexible ? inM + 9 * 60 : TR.toMin(p.end);
        const outM = endM + (o < 0.08 ? -(20 + Math.floor(o * 400)) : o < 0.88 ? Math.floor((o - 0.08) * 28) : 30 + Math.floor((o - 0.88) * 1000));
        attendance[day][e.id] = { s, in: TR.fmtMin(inM), out: k === 0 ? '' : TR.fmtMin(outM) };
      });
    }
    leaves.filter((l) => l.status === 'Approved').forEach((l) => {
      L.countDays({ from: l.from, to: l.to }, lctx).dates.forEach((d) => { if (attendance[d]) attendance[d][l.empId] = { s: 'leave', in: '' }; });
    });

    // Projects and jobs staff can pick at check-in (optional), and a few check-ins for HR to look at:
    // a GPS fix repeated to the last digit, one captured offline and synced, and a supervisor check-in.
    const projects = [
      { id: 'pj1', code: 'PRJ-001', name: 'Kerteh plant maintenance system', client: 'Petronas Chemicals', active: true },
      { id: 'pj2', code: 'PRJ-002', name: 'Kenyir Resorts booking app', client: 'Kenyir Resorts', active: true },
      { id: 'pj3', code: 'PRJ-003', name: 'MyInvois integration', client: 'Internal', active: true },
      { id: 'pj4', code: 'OPS', name: 'Office and admin', client: 'Internal', active: true },
    ];
    Object.assign(settings.checkin, { kiosks: [], supervisor: true, projects: 'optional' });
    const P0 = AllurusSeed.published, fixAt = (dLat, dLng) => ({ lat: +(P0.lat + dLat).toFixed(6), lng: +(P0.lng + dLng).toFixed(6) });
    const zoneLoc = (f, acc, extra = {}) => ({ ...f, accuracy: acc, source: 'gps', m: Math.round(Math.hypot(f.lat - P0.lat, f.lng - P0.lng) * 111000), inside: true, zone: P0.label, radius: P0.radius, ...extra });
    const backDay = (n) => { let d = T, k = 0; while (k < n) { d = U.addDays(d, -1); if (L.isWorkingDay(d, lctx)) k++; } return d; };
    const same = fixAt(0.000113, 0.000087);
    if (attendance[backDay(3)]?.e12?.in) attendance[backDay(3)].e12.loc = zoneLoc(same, 12);
    if (attendance[T]?.e12?.in) Object.assign(attendance[T].e12, { loc: zoneLoc(same, 1), project: 'pj3', via: 'self', flags: [
      { code: 'accuracy-round', reason: 'The phone reported a suspiciously precise accuracy of exactly 1 m.' },
      { code: 'repeat', reason: `Exactly the same coordinates as the check-in on ${backDay(3)}. Real GPS readings always differ slightly.` }] });
    if (attendance[T]?.e17?.in) Object.assign(attendance[T].e17, { loc: zoneLoc(fixAt(-0.000214, 0.000331), 16), offline: true, syncedAt: new Date(`${T}T09:41:00`).toISOString(), project: 'pj4', via: 'self' });
    if (attendance[T]?.e10?.in) Object.assign(attendance[T].e10, { loc: zoneLoc(fixAt(0.000301, -0.000122), 9), via: 'supervisor', by: 'e14', project: 'pj2', face: { result: 'match', sim: 58 }, device: { id: 'dev-noah', name: 'iPhone, Safari (Ravi’s phone)' } });
    [['e5', 'pj2'], ['e8', 'pj1'], ['e2', 'pj3']].forEach(([id, pj]) => { if (attendance[T]?.[id]?.in) attendance[T][id].project = pj; });
    // Project costing: job groups and jobs with target hours and budgets, check-ins this month tagged with a job,
    // and weekly timesheets for July to September from before the check-in app was used for projects.
    const G = (id, projectId, code, name) => ({ id, projectId, code, name });
    const J = (id, groupId, code, name, targetHours, budget) => ({ id, groupId, code, name, targetHours, budget, active: true });
    const costing = {
      groups: [G('jg1', 'pj1', '1', 'Discovery'), G('jg2', 'pj1', '2', 'Build'), G('jg3', 'pj1', '3', 'Site rollout'), G('jg4', 'pj2', '1', 'Design'), G('jg5', 'pj2', '2', 'Build'), G('jg6', 'pj2', '3', 'Launch'), G('jg7', 'pj3', '1', 'Integration')],
      jobs: [
        J('jb1', 'jg1', '1.1', 'Site survey at Kerteh', 60, 4200), J('jb2', 'jg1', '1.2', 'Requirements workshop', 40, 3000),
        J('jb3', 'jg2', '2.1', 'Maintenance scheduling module', 420, 33000), J('jb4', 'jg2', '2.2', 'Mobile work orders', 300, 24000), J('jb5', 'jg2', '2.3', 'Testing', 160, 10500),
        J('jb6', 'jg3', '3.1', 'Training plant staff', 80, 5600),
        J('jb7', 'jg4', '1.1', 'UX research and wireframes', 90, 6300), J('jb8', 'jg4', '1.2', 'Visual design', 120, 8200),
        J('jb9', 'jg5', '2.1', 'Booking engine', 360, 29000), J('jb10', 'jg5', '2.2', 'Payments (FPX and cards)', 120, 9800),
        J('jb11', 'jg6', '3.1', 'App store release', 40, 3000),
        J('jb12', 'jg7', '1.1', 'MyInvois API connection', 140, 11000), J('jb13', 'jg7', '1.2', 'e-Invoice validation and testing', 80, 5800),
      ],
      timesheets: [],
    };
    // Who works on what: [employee, [project, job, share of the week]].
    const WORK = { e2: [['pj3', 'jb12', 0.6], ['pj1', 'jb3', 0.4]], e5: [['pj2', 'jb9', 0.7], ['pj2', 'jb10', 0.3]], e8: [['pj1', 'jb3', 0.6], ['pj1', 'jb4', 0.4]], e12: [['pj1', 'jb4', 0.5], ['pj3', 'jb13', 0.5]], e18: [['pj1', 'jb5', 0.7], ['pj2', 'jb9', 0.3]], e3: [['pj2', 'jb7', 0.5], ['pj2', 'jb8', 0.5]], e16: [['pj2', 'jb8', 0.8], ['pj1', 'jb6', 0.2]], e4: [['pj1', 'jb1', 0.3], ['pj1', 'jb2', 0.3]] };
    // Daily entries Monday to Friday, split between each person's jobs.
    let tsn = 0;
    for (let d = '2026-07-01'; d < '2026-10-01'; d = U.addDays(d, 1)) {
      if (U.isWeekend(d)) continue;
      Object.entries(WORK).forEach(([id, plan], i) => {
        if ((tsn + i) % 23 === 0) { tsn++; return; } // the odd day off or on other work
        plan.forEach(([project, job, share], k) => {
          const hours = Math.round(8 * share * (0.85 + ((tsn * 7 + i * 3 + k) % 30) / 100) * 4) / 4;
          if (hours > 0) costing.timesheets.push({ id: `ts${++tsn}`, empId: id, day: d, project, job, hours, note: '', by: id, at: d });
        });
      });
    }
    // This month's check-ins: the job for the day (alternating between each person's main jobs).
    Object.keys(attendance).filter((d) => d >= '2026-10-01').forEach((d, n) => Object.entries(WORK).forEach(([id, plan], i) => {
      const r = attendance[d]?.[id];
      if (!r?.in || !['present', 'remote'].includes(r.s)) return;
      const [project, job] = plan[(n + i) % plan.length];
      Object.assign(r, { project, job });
    }));
    // Targets and budgets: most jobs part-way through, a couple running over.
    const logged = {};
    costing.timesheets.forEach((t) => { logged[t.job] = (logged[t.job] || 0) + t.hours; });
    Object.values(attendance).forEach((day) => Object.values(day).forEach((r) => { if (r.job) logged[r.job] = (logged[r.job] || 0) + 7.5; }));
    const USED = [0.55, 0.7, 0.85, 0.95, 1.08, 0.6, 0.75, 0.9, 0.5, 0.65, 0.8, 1.12, 0.7];
    costing.jobs.forEach((j, n) => {
      if (!logged[j.id]) return;
      j.targetHours = Math.ceil(logged[j.id] / USED[n % USED.length] / 10) * 10;
      j.budget = Math.round((j.targetHours * 58) / 100) * 100;
    });

    // Overtime, lateness waiver and correction requests, through the same approval chains as leave.
    const back = (n) => { let d = T, k = 0; while (k < n) { d = U.addDays(d, -1); if (L.isWorkingDay(d, lctx)) k++; } return d; };
    let restDay = U.addDays(T, -1); while (L.isWorkingDay(restDay, lctx)) restDay = U.addDays(restDay, -1);
    const setRec = (day, empId, rec) => { attendance[day] = attendance[day] || {}; attendance[day][empId] = rec; };
    const timeRequests = [];
    const treq = (id, empId, kind, date, extra, reason, decisions = []) => {
      const e = employees.find((x) => x.id === empId);
      let chain = L.buildChain({ applicant: empId, chain: settings.leave.chains[e.dept], hr: settings.leave.hr, hrBackup: settings.leave.hrBackup });
      let status = 'Pending';
      const at = U.addDays(date, 1) < T ? U.addDays(date, 1) : T;
      decisions.forEach((d) => {
        const step = L.nextStep(chain); if (!step) return;
        const r2 = L.decide(chain, { by: step.approver, approve: d === true, note: d === true ? '' : d, at });
        chain = r2.chain; status = r2.status;
      });
      timeRequests.push({ id, empId, kind, date, reason, status, created: date, chain, ...(status === 'Pending' ? {} : { decidedAt: at }), ...extra });
    };
    setRec(back(1), 'e10', { s: 'present', in: '08:52', out: '20:40' });
    treq('tr1', 'e10', 'ot', back(1), { from: '18:00', to: '20:30', minutes: 150 }, 'Finishing the Petronas tender proposal, due 9am tomorrow.');
    rosters[back(2)] = { ...(rosters[back(2)] || {}), e5: 'p-pm' };
    setRec(back(2), 'e5', { s: 'present', in: '13:55', out: '00:40' });
    treq('tr2', 'e5', 'ot', back(2), { from: '23:00', to: '00:30', minutes: 90 }, 'Production deploy window for the MyInvois integration.', [true, true]);
    setRec(back(1), 'e13', { s: 'present', in: '09:47', out: '18:05' });
    treq('tr3', 'e13', 'waiver', back(1), {}, 'Flash flood on Jalan Kemaman–Kuantan. The road was closed until 9.30am.', [true]);
    setRec(back(3), 'e2', { s: 'present', in: '09:12', out: '18:20' });
    treq('tr4', 'e2', 'correction', back(3), { s: 'present', in: '09:12', out: '18:20' }, 'Forgot to check out after the client call.', [true, true]);
    setRec(restDay, 'e6', { s: 'present', in: '09:55', out: '15:10' });
    treq('tr5', 'e6', 'ot', restDay, { from: '10:00', to: '15:00', minutes: 300 }, 'Weekend roadshow at Kuantan City Mall.', [true, true]);
    const ethan = shiftOf(employees[7], back(4));
    setRec(back(4), 'e8', { s: 'present', in: TR.fmtMin(TR.toMin(ethan.start) - 6), out: TR.fmtMin(TR.toMin(ethan.end) + 110) });
    treq('tr6', 'e8', 'ot', back(4), { from: ethan.end, to: TR.fmtMin(TR.toMin(ethan.end) + 105), minutes: 105 }, 'Server patching for the Kemaman plant, after hours.');
    setRec(back(5), 'e7', { s: 'present', in: '09:25', out: '18:00' });
    treq('tr7', 'e7', 'waiver', back(5), {}, 'Overslept.', ['Not covered by the waiver policy. Let’s talk if mornings are hard at the moment.']);
    // Manual edits keep who, when, and the old and new values.
    const stamp = (day, h) => new Date(`${day}T${h}:00`).toISOString();
    setRec(back(6), 'e12', { s: 'present', in: '09:00', out: '18:00' });
    const attAudit = [
      { id: 'au1', day: back(3), empId: 'e2', by: 'e1', byName: 'Aisyah Rahman', at: stamp(U.addDays(back(3), 1), '10:14'), changes: [{ field: 'out', from: '', to: '18:20' }], note: 'Correction approved: Forgot to check out after the client call.', batch: '' },
      { id: 'au2', day: back(6), empId: 'e12', by: 'e1', byName: 'Aisyah Rahman', at: stamp(U.addDays(back(6), 1), '09:02'), changes: [{ field: 's', from: 'absent', to: 'present' }, { field: 'in', from: '', to: '09:00' }, { field: 'out', from: '', to: '18:00' }], note: 'Phone battery died. Arjun confirmed he was in.', batch: '' },
    ];

    const payroll = {};
    const thisMonth = U.monthKey(T);
    for (let k = 6; k >= 1; k--) {
      const mk = U.addMonths(thisMonth, -k);
      const end = U.monthEnd(mk);
      const items = employees.filter((e) => e.start <= end).map((e, i) => ({
        empId: e.id, ...U.payCalc(e.salary, (k === 3 && i % 4 === 0) ? 1500 : 0, settings, e, U.addDays(end, -2)),
      }));
      payroll[mk] = { status: 'Paid', paidOn: U.addDays(end, -2), items };
    }

    // Contributions for past months were submitted on the 10th; September's PCB is still to be marked as paid.
    const statutory = { filed: {}, eaIssued: {}, formEFiled: {} };
    Object.keys(payroll).forEach((mk) => { const d = `${U.addMonths(mk, 1)}-10`; statutory.filed[mk] = { epf: d, socso: d, pcb: d, hrdf: d }; });
    delete statutory.filed[U.addMonths(thisMonth, -1)].pcb;

    // Recruitment, training, grievances and meeting rooms.
    const talent = this.talent(T, employees, settings, departments);
    const { jobs, candidates } = talent;
    Object.assign(settings, { recruit: talent.recruit, grievance: talent.grievance, training: { window: 60 } });

    // Appraisals: the H2 cycle with people at every step, SMART goals with check-ins, 360° feedback, and approved
    // results whose increments start in January and bonuses are paid with December payroll.
    const AR = AllurusAppraisalRules, y = +T.slice(0, 4);
    const salesTpl = {
      id: 'tpl-sales', name: 'Sales appraisal', scale: { ...AR.SCALE_1_5, labels: [...AR.SCALE_1_5.labels] }, depts: ['d-sales'], people: [],
      sections: [
        { id: 's-skpi', name: 'Sales results', kind: 'kpi', weight: 60, questions: [{ id: 'sk1', text: 'Revenue against target', weight: 2, comment: true }, { id: 'sk2', text: 'New accounts opened', weight: 1, comment: true }, { id: 'sk3', text: 'Pipeline kept up to date', weight: 1, comment: false }] },
        { id: 's-scomp', name: 'Selling skills', kind: 'competency', weight: 25, questions: [{ id: 'sc1', text: 'Negotiation and closing', weight: 1, comment: true }, { id: 'sc2', text: 'Product knowledge', weight: 1, comment: false }] },
        { id: 's-sval', name: 'Company values', kind: 'value', weight: 15, questions: [{ id: 'sv1', text: 'Amanah: integrity and trust', weight: 1, comment: false }, { id: 'sv2', text: 'Customer first', weight: 1, comment: true }] },
      ],
    };
    settings.appraisal = { templates: [AR.defaultTemplate(), salesTpl], bands: AR.defaultBands(), peerMin: 2 };
    const cycle = { id: 'cy-h2', name: `H2 ${y}`, start: `${y}-07-01`, end: `${y}-12-31`, templateId: 'tpl-standard', selfDue: U.addDays(T, -3), managerDue: U.addDays(T, 11), hrDue: U.addDays(T, 25), l2: true, peers: true, maxPeers: 3, effective: `${y + 1}-01-01`, bonusMonth: `${y}-12`, status: 'Open', launched: U.addDays(T, -24), by: 'e1' };
    const cycles = [cycle];
    const empById = (id) => employees.find((e) => e.id === id);
    const hrOf = 'e1', l1Of = (e) => e.manager || (e.id !== hrOf ? hrOf : ''), l2Of = (e) => { const m = empById(l1Of(e)); return m?.manager && m.manager !== e.id && m.manager !== m.id ? m.manager : ''; };
    // Ratings around a level: a fixed pattern so each person's scores differ a little from item to item.
    const WOBBLE = [0, 1, 0, -1, 0, 1, -1, 0, 0];
    const rate = (tpl, level, shift = 0) => Object.fromEntries(AR.questions(tpl).map((q, i) => [q.id, { r: Math.max(1, Math.min(5, level + WOBBLE[(i + shift) % WOBBLE.length])), c: '' }]));
    const PLAN = {
      e5: ['done', 4, 'Owned the booking app front end and mentored our intern.'], e7: ['done', 5, 'Built the cash-flow dashboard the board now uses every month.', 'Senior Data Analyst'],
      e10: ['done', 4, 'Best quarter yet for booked meetings.'], e13: ['done', 3, 'Steady content calendar; wants more SEO depth.'], e16: ['done', 3, 'Delivered the brand refresh on time.'], e17: ['done', 2, 'Month-end close slipped twice; a plan is agreed.'],
      e8: ['hr', 4, 'Led the move to the new database with no downtime.'], e12: ['hr', 4, 'Cut cloud costs by a fifth.'], e6: ['hr', 3, 'Solid pipeline, closing rate to improve.'],
      e18: ['l2', 4, 'Caught two release blockers before launch.'],
      e3: ['l1'], e9: ['l1'], e19: ['l1'], e15: ['l1'],
      e2: ['draft'], e14: ['draft'], e4: ['self'], e11: ['self'], e1: ['self'],
    };
    const reviews = employees.map((e, i) => {
      const [stage, level = 4, why = '', promo = ''] = PLAN[e.id] || ['self'];
      const tpl = AR.templateFor(e, cycle, settings.appraisal.templates);
      const a = { id: 'r' + (i + 1), empId: e.id, cycleId: cycle.id, cycle: cycle.name, templateId: tpl.id, stage: stage === 'draft' ? 'self' : stage, self: null, l1: null, l2: null, hr: null, final: null, peers: [], due: cycle.hrDue, notes: '' };
      const at = (d) => U.addDays(T, d);
      if (stage === 'draft') a.self = { scores: Object.fromEntries(Object.entries(rate(tpl, 4, i)).slice(0, 4)), comment: '', draftAt: `${at(-2)}T16:20:00.000Z` };
      if (['l1', 'l2', 'hr', 'done'].includes(stage)) a.self = { scores: rate(tpl, Math.min(5, level + (i % 2)), i), comment: 'A busy half. I am proud of what we shipped and want to grow as a lead.', draftAt: `${at(-12)}T10:00:00.000Z`, submittedAt: `${at(-6 + (i % 3))}T11:30:00.000Z` };
      if (['l2', 'hr', 'done'].includes(stage)) {
        const sc = rate(tpl, level, i + 2), g = AR.grade(AR.score(tpl, sc).total, settings.appraisal.bands);
        a.l1 = { by: l1Of(e), scores: sc, comment: why, at: at(-3 + (i % 2)), rec: { inc: g.inc, bonus: g.bonus, promo, why } };
      }
      if (['hr', 'done'].includes(stage) && l2Of(e)) a.l2 = { by: l2Of(e), at: at(-2), comment: 'Agree with the scores.', rec: { ...a.l1.rec } };
      return a;
    });
    const payChanges = [];
    reviews.filter((a) => a.stage === 'done').forEach((a) => {
      const e = empById(a.empId), tpl = settings.appraisal.templates.find((t) => t.id === a.templateId), total = AR.score(tpl, a.l1.scores).total, g = AR.grade(total, settings.appraisal.bands);
      a.hr = { by: hrOf, at: U.addDays(T, -1), rec: { ...(a.l2 || a.l1).rec }, note: '' };
      a.final = { score: total, grade: g.code, pct: Math.round((total / 5) * 100) };
      payChanges.push(...AR.changesFrom({ review: a, emp: e, cycle, rec: a.hr.rec, by: hrOf, at: a.hr.at }));
    });
    // 360°: Daniel asked three colleagues (two answered); Jason's feedback is complete; Hilmi asked Daniel.
    const peer = (empId, answers, comment, d) => (answers ? { empId, status: 'done', asked: U.addDays(T, -14), answers, comment, at: U.addDays(T, d) } : { empId, status: 'requested', asked: U.addDays(T, -5) });
    const pa = (lv) => ({ c1: lv, c2: lv, c3: Math.max(1, lv - 1), v1: 5, v2: lv, v3: lv });
    const R = (id) => reviews.find((x) => x.empId === id);
    R('e2').peers = [peer('e5', pa(4), 'Explains hard problems simply. Could delegate more.', -6), peer('e8', pa(5), 'Always first to help when production breaks.', -4), peer('e12')];
    R('e8').peers = [peer('e2', pa(4), 'Calm under pressure during the migration.', -9), peer('e5', pa(4), '', -8)];
    R('e18').peers = [peer('e2'), peer('e12', pa(4), 'Thorough testing; share findings earlier.', -7)];
    R('e5').peers = [peer('e2', pa(4), 'Great eye for detail on the booking flow.', -16), peer('e16', pa(5), 'A joy to work with on design handoffs.', -15)];
    // SMART goals for the half, with check-ins along the way.
    const GOALS = {
      'd-eng': [['Ship the Kenyir Resorts booking app', 'App live in both stores, bookings tracked', '200 bookings a month', 2], ['Cut booking API response time', 'p95 latency on the booking API', 'Under 300 ms', 1]],
      'd-sales': [['Hit the H2 sales target', 'Closed-won revenue in the CRM', 'RM 1.2 million', 2], ['Open new East Coast accounts', 'New customers signed in Pahang and Terengganu', '10 accounts', 1]],
      'd-fin': [['Close the books by working day 5', 'Month-end close date each month', 'Day 5, six months running', 1], ['Move invoicing to MyInvois', 'Invoices validated by LHDN', 'All invoices from 1 January', 1]],
      'd-mkt': [['Grow organic leads', 'Website leads in the CRM', '40% more than H1', 2], ['Launch the Hari Raya campaign', 'Campaign live with tracked results', 'Live by 1 March', 1]],
      'd-design': [['Refresh the design system', 'Components in the shared library', '60 components', 1], ['Run usability tests', 'Sessions recorded and summarised', '12 sessions', 1]],
      'd-people': [['Cut time to hire', 'Days from job opening to signed offer', 'Under 30 days', 1], ['Roll out online appraisals', 'Staff who submit their self-review on time', '95%', 1]],
    };
    const NOTES = ['Plan agreed with my manager.', 'First milestone done.', 'Halfway there; one blocker cleared.', 'On track for the due date.'];
    const goals = [];
    reviews.forEach((a, i) => {
      const e = empById(a.empId), list = GOALS[e.dept] || GOALS['d-people'];
      const base = { done: 85, hr: 75, l2: 70, l1: 65, self: a.self ? 50 : 30 }[a.stage];
      list.forEach(([title, measure, target, weight], j) => {
        const progress = Math.min(100, Math.max(0, Math.round((base + (j ? -15 : 10) + ((i * 7) % 15)) / 5) * 5));
        const steps = Math.max(1, Math.round(progress / 30));
        const checkins = Array.from({ length: steps }, (_, k) => ({ at: U.addDays(T, -6 - (steps - 1 - k) * 21 - j * 2), by: e.id, progress: Math.round((progress * (k + 1)) / steps / 5) * 5, note: progress >= 100 && k === steps - 1 ? 'Done and handed over.' : NOTES[Math.min(NOTES.length - 1, k)] }));
        goals.push({ id: `g${i + 1}-${j + 1}`, empId: e.id, cycleId: cycle.id, title, measure, target, due: cycle.end, why: '', weight, progress, status: progress < 40 && a.stage !== 'self' ? 'At risk' : 'On track', checkins, created: cycle.start });
      });
    });
    reviews.forEach((a) => {
      a.status = AR.statusOf(a);
      a.rating = a.final ? Math.round(a.final.score) : 0;
      a.progress = AR.goalProgress(goals.filter((g) => g.empId === a.empId));
    });

    // Dates the reminders watch: Hilmi is on a fixed-term contract with a work permit; Nurul is on probation.
    Object.assign(employees[17], { nationality: 'Nigeria', contractEnd: U.addDays(T, 25), passportNo: 'A09817263', passportExpiry: U.addDays(T, 150), permitNo: 'EP 2024-118273', permitExpiry: U.addDays(T, 60) });
    Object.assign(employees[18], { nationality: 'Malaysia', probationEnd: U.addDays(T, 26) });
    employees.forEach((e) => ['probationEnd', 'confirmedOn', 'contractEnd', 'nationality', 'passportNo', 'passportExpiry', 'permitNo', 'permitExpiry'].forEach((k) => { if (e[k] === undefined) e[k] = k === 'nationality' ? 'Malaysia' : ''; }));

    // Announcements and policies, with acknowledgements so far.
    const iso = (d, h) => new Date(`${d}T${h}:00`).toISOString();
    const ackBy = (ids, d) => Object.fromEntries(ids.map((id, i) => [id, iso(U.addDays(d, i % 3), `${10 + (i % 6)}:${10 + i}`)]));
    const announcements = [
      { id: 'an1', kind: 'policy', title: 'Work from home policy 2026', at: iso(U.addDays(T, -9), '09:30'), by: 'e1', depts: [], pinned: false, attachment: null,
        html: '<p>From 1 November, everyone can work from home up to <strong>two days a week</strong>, agreed with your manager.</p><ul><li>Check in with <em>Work remotely</em> on the days you’re at home.</li><li>Be reachable on Slack between 10am and 4pm (core hours).</li><li>Customer-facing roles keep their office roster.</li></ul><p>Questions? Ask Aisyah or Hidayah in People.</p>',
        acks: ackBy(['e1', 'e3', 'e4', 'e6', 'e7', 'e9', 'e11', 'e13', 'e14', 'e15', 'e17'], U.addDays(T, -9)) },
      { id: 'an2', kind: 'announcement', title: 'Deepavali open house, 6 November', at: iso(U.addDays(T, -2), '15:10'), by: 'e15', depts: [], pinned: true, attachment: null,
        html: '<p>Join us for <strong>Deepavali open house</strong> on Friday 6 November from 12pm at the Kemaman office. Murukku, kuih and teh tarik on us.</p><p>Families are welcome. Tell Hidayah by 30 October if you’re coming.</p>', acks: {} },
      { id: 'an3', kind: 'policy', title: 'Overtime needs pre-approval', at: iso(U.addDays(T, -5), '11:00'), by: 'e1', depts: ['d-eng', 'd-sales'], pinned: false, attachment: null,
        html: '<p>From this month, overtime is paid only when it was <strong>approved before</strong> you work it. Ask from <em>My attendance → New request</em>.</p><p>Emergencies: ask within the same day.</p>',
        acks: ackBy(['e4', 'e14', 'e8'], U.addDays(T, -5)) },
    ];
    // A few notifications from the last days (the daily reminders add more on the first load).
    const NR = AllurusNotifyRules;
    let nid = 0;
    const note = (type, data, to, at, read = false) => {
      const e = employees.find((x) => x.id === to);
      return NR.deliver(type, { company: settings.company, ...data }, [{ id: to, email: e.email, first: e.first, prefs: {} }], { at, ids: () => `s${++nid}` });
    };
    const seeded = [
      note('request.submitted', { who: 'Jason Wong', kind: 'ot', summary: 'covering for Arjun', href: '#my-approvals' }, 'e2', iso(U.addDays(T, -1), '09:12')),
      note('announcement.new', { title: 'Deepavali open house, 6 November', excerpt: 'Join us for Deepavali open house on Friday 6 November.', href: '#news' }, 'e2', iso(U.addDays(T, -2), '15:10')),
      note('request.approved', { kind: 'correction', summary: 'forgot to check out', by: 'Aisyah Rahman', href: '#my-time' }, 'e2', iso(U.addDays(T, -3), '10:14'), true),
      note('payslip.ready', { month: U.addMonths(thisMonth, -1), net: 'RM 8,421.50', href: '#my-pay' }, 'e2', iso(U.addDays(T, -21), '17:30'), true),
      note('appraisal.peer', { who: 'Hilmi Zainal', cycle: `H2 ${y}`, href: '#my-appraisal' }, 'e2', iso(U.addDays(T, -5), '11:02')),
      note('checkin.flagged', { who: 'Faizal Osman', reason: 'The phone reported a suspiciously precise accuracy of exactly 1 m.', href: '#attendance' }, 'e1', iso(T, '08:28')),
      note('request.submitted', { who: 'Kevin Tan', kind: 'claim', summary: 'Client visit to Kuala Terengganu, RM 185.90', href: '#claims' }, 'e1', iso(U.addDays(T, -4), '17:40')),
      note('payroll.paid', { month: U.addMonths(thisMonth, -1), count: 18, net: 'RM 134,842.24', href: '#payroll' }, 'e1', iso(U.addDays(T, -21), '17:28'), true),
    ];
    seeded.forEach((x, i) => { if ([2, 3, 7].includes(i)) x.notifications.forEach((n) => { n.read = true; }); });
    const outbox = seeded.flatMap((x) => x.emails);

    // HR admin: the employee file (addresses, emergency contacts, education, past jobs, career history), assets,
    // staff loans, insurance, documents and letters, Nurul's onboarding, Iman's offboarding and a pending change.
    const HR = AllurusHRRules;
    settings.hr = { onboarding: HR.defaultOnboarding(), offboarding: HR.defaultOffboarding(), letters: HR.defaultLetters(), it: 'e12', payroll: 'e19' };
    const deptOf = (id) => departments.find((d) => d.id === id)?.name || '';
    const STREETS = ['Jalan Teluk Sisek, 25000 Kuantan, Pahang', 'Lorong Air Putih 12, 25300 Kuantan, Pahang', 'Taman Chukai Utama, 24000 Kemaman, Terengganu', 'Jalan Sultan Zainal Abidin, 20000 Kuala Terengganu, Terengganu', 'Taman Indera Sempurna, 25150 Kuantan, Pahang', 'Bandar Indera Mahkota 3, 25200 Kuantan, Pahang', 'Jalan Bukit Ubi, 25200 Kuantan, Pahang', 'Kampung Geliga, 24000 Kemaman, Terengganu'];
    const KIN = [['Siti Aminah', 'Spouse'], ['Ahmad Faizal', 'Brother'], ['Lim Mei Hua', 'Mother'], ['Rajesh Kumar', 'Father'], ['Nor Azizah', 'Sister'], ['Tan Wei Ming', 'Spouse']];
    const UNI = [['Bachelor’s degree', 'Computer Science', 'Universiti Teknologi Malaysia'], ['Bachelor’s degree', 'Accounting', 'Universiti Kebangsaan Malaysia'], ['Bachelor’s degree', 'Business Administration', 'Universiti Malaysia Pahang'], ['Diploma', 'Graphic Design', 'UiTM Shah Alam'], ['Master’s degree', 'Information Technology', 'Universiti Malaya'], ['Bachelor’s degree', 'Marketing', 'Taylor’s University'], ['Bachelor’s degree', 'Software Engineering', 'Multimedia University'], ['Professional certificate', 'ACCA', 'Sunway College']];
    const PAST = [['Maxis', 'Analyst'], ['CIMB Bank', 'Executive'], ['AirAsia', 'Associate'], ['Petronas Digital', 'Engineer'], ['Grab Malaysia', 'Specialist'], ['Axiata', 'Officer'], ['Sapura Energy', 'Executive'], ['Top Glove', 'Coordinator']];
    employees.forEach((e, i) => {
      e.phone = `01${[2, 3, 6, 7, 9][i % 5]}-${String(2000000 + i * 734119).slice(0, 3)} ${String(4000 + i * 377).slice(-4)}`;
      e.personalEmail = `${e.first}.${e.last}`.toLowerCase().replace(/[^a-z.]/g, '') + '@gmail.com';
      e.address = `No. ${12 + i * 7}, ${STREETS[i % STREETS.length]}`;
      const [kn, rel] = KIN[i % KIN.length];
      e.emergency = { name: kn, relation: rel, phone: `01${(i + 1) % 10}-${String(5000000 + i * 91357).slice(0, 3)} ${String(1000 + i * 211).slice(-4)}` };
      const [level, field, inst] = UNI[i % UNI.length];
      e.education = [{ level, field, institution: inst, year: String(+e.start.slice(0, 4) - 2 - (i % 4)) }, ...(i % 3 === 0 ? [{ level: 'SPM', field: '', institution: 'SMK Sultan Abu Bakar, Kuantan', year: String(+e.start.slice(0, 4) - 7 - (i % 4)) }] : [])];
      const [co, role] = PAST[i % PAST.length], y0 = +e.start.slice(0, 4);
      e.employment = i === 18 ? [] : [{ company: co, role: `${role}${i % 2 ? '' : ', ' + deptOf(e.dept)}`, from: `${y0 - 3 - (i % 3)}-0${1 + (i % 9)}`, to: `${y0}-0${1 + ((i + 3) % 9)}` }];
      // Career: joined, then a yearly increment each January (working back from today's salary), plus promotions.
      const years = []; for (let y = y0 + 1; y <= 2026; y++) if (`${y}-01-01` > e.start) years.push(y);
      const pcts = years.map((y, k) => [3, 4, 5, 3.5, 6][(i + k) % 5]);
      let sal = e.salary; const backs = pcts.map((p) => { const from = Math.round(sal / (1 + p / 100) / 100) * 100; const x = { from, to: sal, pct: Math.round(((sal - from) / from) * 10000) / 100 }; sal = from; return x; }).reverse();
      e.career = [{ id: `cr-${e.id}`, date: e.start, type: 'joined', to: e.role.replace(/^(Senior|Lead|Head of) /, ''), note: deptOf(e.dept) }, ...years.map((y, k) => ({ id: `cr-${e.id}-${y}`, date: `${y}-01-01`, type: 'increment', ...backs[k], note: 'Annual review' }))];
      if (/^(Senior|Lead|Head of) /.test(e.role) && years.length) e.career.push({ id: `cr-${e.id}-p`, date: `${years[years.length - 1]}-01-01`, type: 'promotion', from: e.role.replace(/^(Senior|Lead|Head of) /, ''), to: e.role });
    });
    employees[3].career.push({ id: 'cr-e4-p', date: '2022-01-01', type: 'promotion', from: 'Senior Software Engineer', to: 'Engineering Manager' });
    employees[2].career.push({ id: 'cr-e3-t', date: '2021-07-01', type: 'transfer', from: 'Marketing', to: 'Design', note: 'Moved to lead product design' });
    // Assets: a laptop each, phones for managers and sales, the sales car, and spares in the store.
    let an = 0;
    const asset = (type, name, value, holder, issued, extra = {}) => ({ id: `as${++an}`, tag: `AL-${String(an).padStart(4, '0')}`, type, name, serial: extra.serial || `${type === 'Laptop' ? (name.includes('Mac') ? 'C02' : 'PF') : type === 'Phone' ? 'F2L' : 'VH'}${String(731905 + an * 4127).slice(-6)}${'XKQMRT'[an % 6]}`, value, bought: extra.bought || issued || U.addDays(T, -200), holder, issued: holder ? issued : '', returned: '', notes: extra.notes || '', history: [] });
    const assets = employees.filter((e) => e.status !== 'Inactive').map((e) => asset('Laptop', ['d-eng', 'd-design'].includes(e.dept) ? 'MacBook Pro 14 M3' : 'Lenovo ThinkPad T14', ['d-eng', 'd-design'].includes(e.dept) ? 8999 : 5299, e.id, e.start < '2024-01-01' ? '2024-01-08' : e.start));
    ['e1', 'e4', 'e14', 'e6', 'e10', 'e11'].forEach((id) => { const e = employees.find((x) => x.id === id); assets.push(asset('Phone', 'iPhone 15', 3999, id, e.start < '2024-06-01' ? '2024-06-03' : e.start)); });
    assets.push(asset('Vehicle', 'Proton X50 1.5T Executive', 101800, 'e14', '2025-03-01', { serial: 'PMNCX50EX5R018832', notes: 'Plate CEB 4521; road tax and insurance to 2027' }));
    assets.push(asset('Access card', 'Office access card', 35, 'e16', '2023-01-09', { serial: 'AC-0716' }));
    assets.push(asset('Laptop', 'Lenovo ThinkPad T14', 5299, '', '', { notes: 'Spare, wiped and ready' }), asset('Monitor', 'Dell 27" P2723D', 1199, '', ''), asset('Phone', 'Samsung Galaxy A55', 1799, '', '', { notes: 'Kiosk spare' }));
    const loans = [
      { id: 'loan1', empId: 'e10', purpose: 'Computer loan', amount: 3600, months: 12, start: '2026-06', extra: [], approved: '2026-05-20', by: 'e1' },
      { id: 'loan2', empId: 'e19', purpose: 'Study loan (ACCA)', amount: 5000, months: 24, start: '2026-11', extra: [], approved: U.addDays(T, -5), by: 'e1' },
      { id: 'loan3', empId: 'e6', purpose: 'Salary advance', amount: 1200, months: 6, start: '2025-11', extra: [], approved: '2025-10-28', by: 'e1' },
    ];
    const insurance = [
      { id: 'ins1', name: 'Group hospitalisation and surgical', insurer: 'AIA Bhd', policyNo: 'GHS-2025-778120', sum: 100000, premium: 22800, start: U.addDays(T, -353), end: U.addDays(T, 12), covers: 'all' },
      { id: 'ins2', name: 'Group personal accident', insurer: 'Great Eastern General', policyNo: 'GPA-ALR-2026-0041', sum: 200000, premium: 3420, start: '2026-01-01', end: '2026-12-31', covers: 'all' },
      { id: 'ins3', name: 'Motor comprehensive (CEB 4521)', insurer: 'Allianz General', policyNo: 'MC-88231947', sum: 92000, premium: 2875.4, start: '2026-03-01', end: '2027-02-28', covers: ['e14'] },
    ];
    // Documents: copies kept on file (shown as simple images in the demo), with expiry dates where they matter.
    const docImg = (title, who, line) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380"><rect width="600" height="380" rx="18" fill="#f5f5f7" stroke="#d0d3d9"/><rect x="0" y="0" width="600" height="64" rx="18" fill="#0F766E"/><text x="28" y="41" font-family="Arial" font-size="22" fill="#fff" font-weight="700">${title}</text><text x="28" y="130" font-family="Arial" font-size="26" fill="#16181D">${who}</text><text x="28" y="175" font-family="Arial" font-size="18" fill="#575B63">${line}</text><text x="28" y="350" font-family="Arial" font-size="13" fill="#8A8F98">Sample copy for the Allurus demo</text></svg>`);
    let dn = 0;
    const fileDoc = (empId, title, category, expiry, line, uploaded) => { const e = employees.find((x) => x.id === empId); return { id: `doc${++dn}`, empId, title, category, expiry, file: { name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`, type: 'image/svg+xml', data: docImg(title, `${e.first} ${e.last}`, line) }, uploaded: uploaded || e.start, by: 'e1' }; };
    const documents = [
      ...employees.filter((e) => e.nationality === 'Malaysia' || !e.nationality).slice(0, 12).map((e) => fileDoc(e.id, 'MyKad copy', 'IC or passport', '', `IC ${e.ic || ''}`)),
      fileDoc('e18', 'Passport copy', 'IC or passport', employees[17].passportExpiry, `Passport ${employees[17].passportNo}`),
      fileDoc('e18', 'Employment Pass', 'Work permit', employees[17].permitExpiry, employees[17].permitNo),
      fileDoc('e2', 'Degree certificate', 'Certificate', '', 'Bachelor of Software Engineering', '2020-10-19'),
      fileDoc('e8', 'AWS Solutions Architect', 'Certificate', U.addDays(T, 41), 'Associate certification', U.addDays(T, -1054)),
      fileDoc('e14', 'Driving licence', 'Other', U.addDays(T, 230), 'Class D', '2025-03-01'),
      fileDoc('e19', 'Signed employment contract', 'Contract', '', 'Payroll Executive, permanent', '2026-10-01'),
    ];
    const letter = (empId, tplId, date, extra) => { const e = employees.find((x) => x.id === empId), t = settings.hr.letters.find((l) => l.id === tplId), data = { 'employee.name': `${e.first} ${e.last}`, 'employee.first': e.first, 'employee.role': e.role, 'employee.department': deptOf(e.dept), 'company.name': settings.company, ...extra }; return { id: `doc${++dn}`, empId, title: t.name, category: 'Letter', expiry: '', letter: { templateId: tplId, subject: HR.fill(t.subject, data), body: HR.fill(t.body, data), date, ack: false }, uploaded: date, by: 'e1' }; };
    documents.push(letter('e15', 'confirmation', '2024-12-02', { effective_date: '2 December 2024' }), letter('e16', 'resignation', U.addDays(T, -3), { last_day: `${+employees[15].endDate.slice(8, 10)} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+employees[15].endDate.slice(5, 7) - 1]} ${employees[15].endDate.slice(0, 4)}` }));
    // Checklists: Nurul started on the 7th; Iman leaves at the end of next month.
    const owners = (e) => ({ hr: 'e1', it: 'e12', payroll: 'e19', manager: e.manager || 'e1', employee: e.id });
    const nurul = employees[18], julian = employees[15];
    const onb = HR.buildChecklist(settings.hr.onboarding, { empId: nurul.id, anchor: nurul.start, owners: owners(nurul), id: 'onb-e19', created: U.addDays(nurul.start, -14) });
    onb.tasks.forEach((x) => { if (x.due <= U.addDays(T, -9) && x.id !== 'o3') Object.assign(x, { done: true, doneAt: x.due, doneBy: x.assignee }); });
    const off = HR.buildChecklist(settings.hr.offboarding, { empId: julian.id, anchor: julian.endDate, owners: owners(julian), id: 'off-e16', created: U.addDays(T, -3) });
    Object.assign(off.tasks.find((x) => x.id === 'f1'), { done: true, doneAt: U.addDays(T, -3), doneBy: 'e1' });
    const checklists = [onb, off];
    const editRequests = [{ id: 'rq1', empId: 'e5', changes: HR.diffRequest(employees[4], { address: 'No. 8, Jalan Beserah 3, 25300 Kuantan, Pahang', 'emergency.phone': '012-778 4410' }), note: 'Moved house last weekend', at: U.addDays(T, -1), status: 'Pending' }];

    const now = Date.now();
    const activity = [
      { t: now - 1000 * 60 * 42, text: 'Michelle Teoh requested 5 days of annual leave' },
      { t: now - 1000 * 60 * 60 * 3, text: 'David Okoye accepted the Account Executive offer' },
      { t: now - 1000 * 60 * 60 * 26, text: `Payroll for ${U.fmtMonth(U.addMonths(thisMonth, -1))} was paid` },
      { t: now - 1000 * 60 * 60 * 50, text: 'Hilmi Zainal completed onboarding' },
    ];

    const platform = this.platform(employees.length);
    const session = { account: null, roles: [], role: null, empId: 'e2', tenantId: 't1' };
    // Sign-in accounts. Passwords are stored as SHA-256 of "email:password", never in plain text.
    const accounts = [
      { email: 'superadmin@allurus.com', name: 'Allurus HQ', hash: '9ba7ad31f33beee93d53e6b5e6406e45779bbb11c955c6e10dd78c16569c9e40', roles: ['super', 'admin', 'employee', 'auditor'], tenantId: 't1', empId: 'e2' },
      { email: 'admin@allurus.com', name: 'Aisyah Rahman', hash: '0924b217a20ccca3818ca0a6c768445f869cfbe2d40343c9af693fdc945b9be9', roles: ['admin', 'employee'], tenantId: 't1', empId: 'e1' },
      { email: 'auditor@allurus.com', name: 'Tan Mei Ling', hash: 'a4abcb8c3b6a761ae31ba7c4c4ae62b4f9e60d05349d5fafcddaceeb4f1c34a8', roles: ['auditor'], tenantId: 't1', empId: '' },
      // The manager who approves Daniel's requests, for showing approvals.
      { email: 'manager@allurus.com', name: 'Arjun Pillai', hash: 'd301d58d3f34698039bfff021aee0185db6a3c6b1df32af0ce98a059615f7aba', roles: ['employee'], tenantId: 't1', empId: 'e4' },
      { email: 'emp@allurus.com', name: 'Daniel Lim', hash: '77e0cec488b8862842418cc2f56e93996aaa60c33dafa80c1429694a75781c8a', roles: ['employee'], tenantId: 't1', empId: 'e2' },
    ];
    const finance = AllurusFinance.seed({ employees, payroll, today: T, customers: AllurusSeed.clients });
    // e-Invoice: the company's details, customers and suppliers with TIN, ID and address, and invoices at every
    // stage (validated, one still cancellable, one rejected, drafts), a credit note and a self-billed bill.
    settings.einvoice = { tin: 'C25845632000', brn: '202101023456', sst: 'W10-2108-32000187', ttx: 'NA', msic: '62010', activity: 'Computer programming activities (custom software, apps and websites)', phone: '+60 9-859 2210', email: 'finance@allurus.com', env: 'sandbox',
      address: { line1: 'Lot 7, Jalan Kampung Tengah', line2: 'Kawasan Perindustrian Chukai', line3: '', city: 'Kemaman', postcode: '24000', state: '13', country: 'MYS' } };
    const PLACES = [['Jalan Tun Ismail', 'Kuantan', '25000', '06'], ['Jalan Ampang', 'Kuala Lumpur', '50450', '14'], ['Persiaran Kayangan', 'Shah Alam', '40000', '10'], ['Jalan Sultan Ismail', 'Kuala Terengganu', '20200', '13'], ['Lebuh Farquhar', 'George Town', '10200', '07'], ['Jalan Wong Ah Fook', 'Johor Bahru', '80000', '01'], ['Jalan Tun Razak', 'Kuala Lumpur', '50400', '14']];
    const custNames = [...new Set(finance.invoices.map((i) => i.customer))];
    const contacts = custNames.map((name, i) => {
      const [street, city, postcode, state] = PLACES[i % PLACES.length], email = finance.invoices.find((x) => x.customer === name)?.email || '';
      const c = { id: `ct-c${i + 1}`, kind: 'customer', name: `${name} Sdn Bhd`, tin: `C${String(2190000000 + i * 7340117).slice(0, 10)}0`, idType: 'BRN', idNo: `20${15 + (i % 9)}01${String(100000 + i * 37211).slice(0, 6)}`, sst: i % 3 === 0 ? `W10-${1800 + i}-3200${String(i).padStart(4, '0')}` : 'NA', email, phone: `+60 ${3 + (i % 7)}-${String(2000 + i * 131).slice(-4)} ${String(5000 + i * 271).slice(-4)}`, contactName: ['Siti Rahman', 'Lim Wei Jie', 'Arjun Pillai', 'Nur Aisyah', 'Tan Chee Keong', 'Farid Hakim'][i % 6], address: { line1: `${12 + i * 3}, ${street}`, line2: '', line3: '', city, postcode, state, country: 'MYS' } };
      // One customer still missing details, to show the e-Invoice check.
      if (name === 'Sinar Fresh Mart') Object.assign(c, { tin: '', idNo: '', address: { ...c.address, postcode: '', state: '' } });
      return c;
    });
    contacts.push(
      { id: 'ct-s1', kind: 'supplier', name: 'Menara Kuantan Properties Sdn Bhd', tin: 'C10293847560', idType: 'BRN', idNo: '199801012345', sst: 'NA', email: 'accounts@menarakuantan.my', phone: '+60 9-513 2200', contactName: 'Mohd Azlan', address: { line1: 'Menara Kuantan, Jalan Teluk Sisek', line2: '', line3: '', city: 'Kuantan', postcode: '25000', state: '06', country: 'MYS' } },
      { id: 'ct-s2', kind: 'supplier', name: 'Tenaga Nasional Berhad', tin: 'C10012345670', idType: 'BRN', idNo: '199001009294', sst: 'NA', email: 'customer@tnb.com.my', phone: '+60 15-4600 1300', contactName: '', address: { line1: 'No. 129, Jalan Bangsar', line2: '', line3: '', city: 'Kuala Lumpur', postcode: '59200', state: '14', country: 'MYS' } },
      { id: 'ct-s3', kind: 'supplier', name: 'Google Workspace and AWS', tin: 'EI00000000030', idType: 'BRN', idNo: 'NA', sst: 'NA', email: 'billing@example.com', phone: '+65 6521 8000', contactName: '', address: { line1: '70 Pasir Panjang Road', line2: '', line3: '', city: 'Singapore', postcode: '117371', state: '17', country: 'SGP' } },
      { id: 'ct-s4', kind: 'supplier', name: 'Kilat Digital Marketing Sdn Bhd', tin: 'C24680135790', idType: 'BRN', idNo: '201901033456', sst: 'B16-1905-32001122', email: 'billing@kilatdigital.my', phone: '+60 3-7931 8800', contactName: 'Jason Lee', address: { line1: 'B-12-3, Menara Uncang Emas', line2: '', line3: '', city: 'Kuala Lumpur', postcode: '50490', state: '14', country: 'MYS' } },
      { id: 'ct-s5', kind: 'supplier', name: 'Tan & Partners Chartered Accountants', tin: 'D1357924680', idType: 'BRN', idNo: '200503002211', sst: 'NA', email: 'admin@tanpartners.my', phone: '+60 9-622 1188', contactName: 'Tan Mei Ling', address: { line1: '23, Jalan Bukit Kuang', line2: '', line3: '', city: 'Kemaman', postcode: '24000', state: '13', country: 'MYS' } },
      { id: 'ct-s6', kind: 'supplier', name: 'Ahmad Fauzi bin Hassan', tin: 'IG23456789010', idType: 'NRIC', idNo: '880214065123', sst: 'NA', msic: '00000', activity: 'Freelance photography', email: 'fauzi.lens@gmail.com', phone: '+60 13-922 4410', contactName: '', address: { line1: 'No. 5, Kampung Gelugor', line2: '', line3: '', city: 'Kuantan', postcode: '25150', state: '06', country: 'MYS' } },
    );
    const cByName = (n) => contacts.find((c) => c.name === `${n} Sdn Bhd` || c.name === n || c.name.startsWith(n));
    const uuid = (k, n = 26) => Array.from({ length: n }, (_, i) => 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'[(k * 131 + i * 17 + ((k + i) * (i + 3)) % 29) % 32]).join('');
    let ek = 0;
    finance.invoices.forEach((inv) => {
      const c = cByName(inv.customer);
      if (c) { inv.customer = c.name; inv.contactId = c.id; }
      inv.type = 'invoice'; inv.items.forEach((it) => { it.classification = '022'; });
      if (inv.status === 'Draft' || c?.tin === '') { inv.einvoice = { status: 'Draft' }; return; }
      const at = `${inv.issue}T${String(9 + (ek % 7)).padStart(2, '0')}:${String((ek * 13) % 60).padStart(2, '0')}:00.000Z`;
      inv.einvoice = { status: 'Valid', uuid: uuid(++ek), longId: uuid(ek + 500, 40), submissionUid: uuid(ek + 900), submittedAt: at, validatedAt: new Date(Date.parse(at) + 90000).toISOString(), errors: [], simulated: true };
    });
    const recent = finance.invoices.filter((i) => i.type === 'invoice' && i.status !== 'Draft' && i.einvoice.status === 'Valid').sort((a, b) => b.issue.localeCompare(a.issue));
    // The newest is still inside the 72-hour cancellation window; the one before was rejected for a TIN mismatch.
    if (recent[0]) Object.assign(recent[0].einvoice, { submittedAt: `${U.addDays(T, -1)}T07:20:00.000Z`, validatedAt: `${U.addDays(T, -1)}T07:21:30.000Z` });
    if (recent[1]) recent[1].einvoice = { status: 'Rejected', uuid: '', longId: '', submissionUid: uuid(77), submittedAt: `${recent[1].issue}T08:05:00.000Z`, validatedAt: '', errors: [{ code: 'CF321', message: 'Buyer TIN and registration number do not match LHDN records (simulated).' }], simulated: true };
    // A credit note: two seats cancelled on an unpaid invoice.
    const open = finance.invoices.filter((i) => i.type === 'invoice' && i.status === 'Sent' && i.einvoice.status === 'Valid').sort((a, b) => a.issue.localeCompare(b.issue))[0];
    if (open) {
      const cnDay = U.addDays(T, -6), sub = 1900, tax = Math.round(sub * open.taxRate) / 100;
      finance.invoices.push({ id: 'cn1', type: 'credit', ref: open.id, no: `CN-${cnDay.slice(0, 7).replace('-', '')}-01`, customer: open.customer, contactId: open.contactId, email: open.email, issue: cnDay, due: cnDay, items: [{ desc: 'Two seats cancelled from 1 October', qty: 2, price: 950, classification: '022' }], taxRate: open.taxRate, status: 'Issued', paidOn: '', reason: 'Two seats cancelled from 1 October',
        einvoice: { status: 'Valid', uuid: uuid(301), longId: uuid(302, 40), submissionUid: uuid(303), submittedAt: `${cnDay}T03:10:00.000Z`, validatedAt: `${cnDay}T03:11:20.000Z`, errors: [], simulated: true } });
      open.adjust = -Math.round((sub + tax) * 100) / 100;
    }
    finance.bills.forEach((b) => { const c = contacts.find((x) => x.kind === 'supplier' && (x.name === b.supplier || x.name.startsWith(b.supplier))); if (c) { b.supplier = c.name; b.contactId = c.id; } });
    // A self-billed purchase from a freelancer, already validated.
    const sbDay = U.addDays(T, -9);
    finance.bills.push({ id: 'bsb1', supplier: 'Ahmad Fauzi bin Hassan', contactId: 'ct-s6', ref: 'AF-OCT-01', category: 'Marketing', issue: sbDay, due: U.addDays(sbDay, 14), amount: 1200, tax: 0, status: 'Unpaid', paidOn: '', note: 'Product photography for the website', selfBilled: true, selfNo: `SBI-${sbDay.slice(0, 7).replace('-', '')}-01`,
      einvoice: { status: 'Valid', uuid: uuid(401), longId: uuid(402, 40), submissionUid: uuid(403), submittedAt: `${sbDay}T02:00:00.000Z`, validatedAt: `${sbDay}T02:01:10.000Z`, errors: [], simulated: true } });
    finance.contacts = contacts;
    const reliefs = AllurusTax.seedReliefs(T);
    // Claims: the standard categories plus a taxable wellness benefit. Claims already reimbursed through payroll
    // show on those payslips and in the books under their GL category.
    settings.claims.categories.push({ id: 'wellness', name: 'Wellness (gym)', note: 'Gym or fitness membership. A taxable benefit in this company’s policy.', perClaim: 0, perMonth: 150, perYear: 1200, receipt: true, taxable: true, gl: 'Staff benefits', fields: [], on: true, builtin: false });
    const claims = AllurusClaims.seed(employees, T, settings);
    claims.filter((c) => c.status === 'Paid' && payroll[c.paidIn]).forEach((c) => {
      const it = payroll[c.paidIn].items.find((i) => i.empId === c.empId);
      if (it) {
        it.claims = U.round2((it.claims || 0) + c.approved); it.claimIds = [...(it.claimIds || []), c.id]; it.net = U.round2(it.net + c.approved);
        AllurusClaimRules.glRows(c, settings.claims.categories).forEach((g) => { it.claimGL = { ...(it.claimGL || {}), [g.gl]: U.round2((it.claimGL?.[g.gl] || 0) + g.amount) }; });
      }
    });
    const plans = { e2: AllurusPlanner.sample() };
    return { version: 3, session, accounts, workspaces: {}, finance, reliefs, taxProfiles: {}, claims, plans, leaveCarry, leaveCredits, rosters, timeRequests, attAudit, statutory, projects, announcements, notifications: seeded.flatMap((x) => x.notifications), outbox, notifyKeys: [], settings, departments, employees, leaves, attendance, payroll, jobs, candidates, reviews, cycles, goals, payChanges, costing, savedReports: [], requisitions: talent.requisitions, courses: talent.courses, enrolments: talent.enrolments, trainingRequests: talent.trainingRequests, grievances: talent.grievances, rooms: talent.rooms, bookings: talent.bookings, editRequests, checklists, assets, loans, insurance, documents, activity, platform };
  },

  // Talent defaults for a new company: job post and offer letter templates, scorecard areas, grievance settings and
  // two starter courses.
  talentDefaults() {
    const R = AllurusTalentRules;
    const benefits = 'EPF, SOCSO and EIS contributions\nAnnual leave from 14 days, plus public holidays\nMedical, dental and hospitalisation cover\nLearning budget and HRD Corp-funded courses';
    return {
      recruit: {
        templates: [
          { id: 'tp-eng', name: 'Engineering', intro: 'We are looking for a {{job.title}} to help build and run the HR and payroll platform used by Malaysian businesses.', responsibilities: 'Design, build and test features end to end\nReview code and share what you know\nKeep the platform fast, secure and reliable\nWork closely with design and customer teams', requirements: 'Solid experience with the main language and tools for the role\nGood written and spoken English; Bahasa Melayu is a plus\nCare for quality, testing and security\nComfortable working in a small, fast team', benefits },
          { id: 'tp-sales', name: 'Sales and marketing', intro: 'Join us as {{job.title}} and help Malaysian SMEs move their HR and payroll online.', responsibilities: 'Find and qualify new customers\nRun demos and follow up with proposals\nKeep the CRM up to date\nWork with marketing on campaigns and events', requirements: 'Experience in B2B sales or marketing, ideally software\nConfident presenting in English and Bahasa Melayu\nOrganised and target-driven\nOwn transport for client visits', benefits: `${benefits}\nCommission on top of base pay` },
          { id: 'tp-general', name: 'General', intro: 'We are hiring a {{job.title}}.', responsibilities: '', requirements: '', benefits },
        ],
        offerTemplates: [
          { id: 'of-perm', name: 'Offer of employment (permanent)', subject: 'Offer of employment: {{job.title}}', body: 'Dear {{candidate.name}},\n\nThank you for your time during the interviews. We are pleased to offer you the position of {{job.title}} in our {{job.department}} team, based in {{job.location}}.\n\nYour monthly basic salary will be {{offer.salary_monthly}}, and your start date will be {{offer.start_date}}. You will be on probation for {{offer.probation_months}} months, after which your appointment will be confirmed in writing.\n\nThe company will make the employer contributions to EPF, SOCSO and EIS required by law. Your leave, medical cover and other benefits follow the company’s policies and the Employment Act 1955.\n\nPlease sign and return a copy of this letter by {{offer.expires}} to accept the offer. We look forward to welcoming you to {{company.name}}.' },
          { id: 'of-contract', name: 'Offer of employment (fixed-term contract)', subject: 'Contract offer: {{job.title}}', body: 'Dear {{candidate.name}},\n\nWe are pleased to offer you a fixed-term contract as {{job.title}} with {{company.name}}, starting on {{offer.start_date}}.\n\nYour monthly salary will be {{offer.salary_monthly}}. The contract length, notice period and renewal terms are set out in the attached contract.\n\nThe company will make the employer contributions to EPF, SOCSO and EIS required by law.\n\nPlease sign and return a copy of this letter by {{offer.expires}} to accept the offer.' },
        ],
        criteria: ['Skills for the role', 'Problem solving', 'Communication', 'Teamwork and culture'],
      },
      grievance: { managers: ['e1', 'e15'], categories: ['Pay and benefits', 'Workload', 'Manager or colleague', 'Harassment or bullying', 'Working conditions', 'Facilities', 'Discrimination', 'Other'], sla: R.defaultSla() },
      courses: [
        { id: 'co-pdpa', title: 'Personal data protection (PDPA 2010)', category: 'Compliance', provider: 'In-house', hours: 1.5, desc: 'How to collect, use, store and share personal data about staff, candidates and customers under the Personal Data Protection Act 2010.', validMonths: 24, active: true, mandatory: { all: true, depts: [], roles: [] }, hrdc: { claimable: false, fee: 0 },
          modules: [
            { id: 'm1', kind: 'text', title: 'Why it matters', body: 'Malaysia’s Personal Data Protection Act 2010 (PDPA) sets out how businesses may handle personal data used in commercial transactions, including employment.\n\nAt work, personal data includes IC numbers, addresses, salaries, bank details, medical certificates and candidates’ CVs.\n\nCollect only what you need, use it only for the purpose you told the person, keep it secure, and keep it only as long as needed.' },
            { id: 'm2', kind: 'video', title: 'Handling data day to day', url: 'https://intranet.serimaju.com.my/training/pdpa-day-to-day.mp4' },
            { id: 'm3', kind: 'pdf', title: 'Our data protection policy', url: 'https://intranet.serimaju.com.my/policies/data-protection-policy.pdf' },
          ],
          quiz: { passMark: 75, questions: [
            { id: 'q1', q: 'A candidate’s CV is personal data.', options: ['True', 'False'], answer: 0 },
            { id: 'q2', q: 'A colleague asks for another employee’s home address “to send a gift”. What do you do?', options: ['Send it, it’s a kind gesture', 'Ask HR, who checks with the employee first', 'Post it in the team chat'], answer: 1 },
            { id: 'q3', q: 'How long should we keep personal data?', options: ['Forever, just in case', 'Only as long as it is needed for its purpose or required by law', 'Until the laptop is full'], answer: 1 },
            { id: 'q4', q: 'You emailed payslips to the wrong person. What first?', options: ['Do nothing', 'Tell your manager and the data protection officer straight away', 'Delete your sent folder'], answer: 1 },
          ] } },
        { id: 'co-welcome', title: 'Welcome to the company', category: 'Onboarding', provider: 'In-house', hours: 1, desc: 'Our values, how we work, and where to find help.', validMonths: 0, active: true, mandatory: { all: true, depts: [], roles: [] }, hrdc: { claimable: false, fee: 0 },
          modules: [
            { id: 'm1', kind: 'text', title: 'How we work', body: 'Welcome aboard. This short course covers working hours, leave, claims, and who to ask for help.\n\nUse Allurus to check in, apply for leave and submit claims. Your manager and HR are always happy to help.' },
            { id: 'm2', kind: 'pdf', title: 'Employee handbook', url: 'https://intranet.serimaju.com.my/policies/employee-handbook.pdf' },
          ], quiz: { passMark: 0, questions: [] } },
      ],
    };
  },

  // Talent demo data: requisitions, published roles with candidates from different sources, interviews with
  // scorecards, offers, courses with enrolments and certificates (some expiring), training requests, grievances in
  // every state (one past its response time), meeting rooms and bookings.
  talent(T, employees, settings, departments) {
    const R = AllurusTalentRules, L = AllurusLeaveRules, d = this.talentDefaults(), lv = settings.leave;
    const ago = (n) => U.addDays(T, -n), ahead = (n) => U.addDays(T, n);
    const chainFor = (by, dept, steps) => {
      let ch = L.buildChain({ applicant: by, chain: lv.chains?.[dept], hr: lv.hr, hrBackup: lv.hrBackup });
      steps.forEach(([approve, at, note]) => { const s = ch.find((x) => x.status === 'pending'); if (!s) return; ch = L.decide(ch, { by: s.approver, approve, at, note }).chain; });
      return ch;
    };
    const finish = (by, dept, at) => chainFor(by, dept, L.buildChain({ applicant: by, chain: lv.chains?.[dept], hr: lv.hr, hrBackup: lv.hrBackup }).map(() => [true, at]));
    const desc = (tpl, title) => ({ intro: tpl.intro.replace('{{job.title}}', title), responsibilities: tpl.responsibilities, requirements: tpl.requirements, benefits: tpl.benefits });
    const [eng, sales] = d.recruit.templates;
    const requisitions = [
      { id: 'rq1', title: 'Senior Backend Engineer', dept: 'd-eng', type: 'Full-time', location: 'Kuantan · Hybrid', headcount: 1, salaryMin: 9000, salaryMax: 12000, reason: 'Growth in workload', templateId: 'tp-eng', justification: 'Payroll and e-Invoice work has doubled the backlog. We need a senior engineer to own the integrations.', by: 'e4', at: ago(26), status: 'Approved', jobId: 'j1' },
      { id: 'rq2', title: 'Digital Marketing Executive', dept: 'd-mkt', type: 'Full-time', location: 'Kuantan', headcount: 1, salaryMin: 3800, salaryMax: 5000, reason: 'New role', templateId: 'tp-sales', justification: 'Paid search and social are run by agencies today. Bringing it in-house saves about RM 4,000 a month.', by: 'e9', at: ago(16), status: 'Approved', jobId: 'j2' },
      { id: 'rq3', title: 'Account Executive', dept: 'd-sales', type: 'Full-time', location: 'Kuala Lumpur', headcount: 2, salaryMin: 4000, salaryMax: 5500, reason: 'Growth in workload', templateId: 'tp-sales', justification: 'Klang Valley leads are growing and Kevin covers the whole region alone.', by: 'e14', at: ago(50), status: 'Approved', jobId: 'j3' },
      { id: 'rq4', title: 'QA Engineer (Automation)', dept: 'd-eng', type: 'Full-time', location: 'Kuantan · Hybrid', headcount: 1, salaryMin: 5500, salaryMax: 7500, reason: 'Growth in workload', templateId: 'tp-eng', justification: 'Releases wait on manual testing. Automation would let Hilmi focus on exploratory testing.', by: 'e4', at: ago(3), status: 'Pending', jobId: '' },
      { id: 'rq5', title: 'Customer Success Executive', dept: 'd-sales', type: 'Full-time', location: 'Kuantan', headcount: 1, salaryMin: 3500, salaryMax: 4500, reason: 'New role', templateId: 'tp-sales', justification: 'Renewals and onboarding calls take a third of the sales team’s week.', by: 'e14', at: ago(1), status: 'Pending', jobId: '' },
      { id: 'rq6', title: 'Office Administrator', dept: 'd-people', type: 'Contract', location: 'Kuantan', headcount: 1, salaryMin: 2500, salaryMax: 3000, reason: 'New role', templateId: 'tp-general', justification: 'Front desk and courier handling.', by: 'e15', at: ago(40), status: 'Rejected', jobId: '' },
    ];
    requisitions.forEach((r) => {
      const n = L.buildChain({ applicant: r.by, chain: lv.chains?.[r.dept], hr: lv.hr, hrBackup: lv.hrBackup }).filter((x) => x.status === 'pending').length;
      r.chain = r.status === 'Approved' ? chainFor(r.by, r.dept, Array.from({ length: n }, () => [true, U.addDays(r.at, 1)]))
        : r.status === 'Rejected' ? chainFor(r.by, r.dept, [...Array.from({ length: n - 1 }, () => [true, U.addDays(r.at, 1)]), [false, U.addDays(r.at, 2), 'Let’s share the front desk on a rota for now and look again in Q1.']])
        : chainFor(r.by, r.dept, r.id === 'rq4' && n > 1 ? [[true, ago(2)]] : []);
    });
    const jobs = [
      { id: 'j1', title: 'Senior Backend Engineer', dept: 'd-eng', location: 'Kuantan · Hybrid', type: 'Full-time', opened: ago(24), reqId: 'rq1', headcount: 1, salaryMin: 9000, salaryMax: 12000, published: true, closes: ahead(20), description: desc(eng, 'Senior Backend Engineer'), boards: {} },
      { id: 'j2', title: 'Digital Marketing Executive', dept: 'd-mkt', location: 'Kuantan', type: 'Full-time', opened: ago(14), reqId: 'rq2', headcount: 1, salaryMin: 3800, salaryMax: 5000, published: true, closes: ahead(30), description: desc(sales, 'Digital Marketing Executive'), boards: {} },
      { id: 'j3', title: 'Account Executive', dept: 'd-sales', location: 'Kuala Lumpur', type: 'Full-time', opened: ago(48), reqId: 'rq3', headcount: 2, salaryMin: 4000, salaryMax: 5500, published: true, closes: ahead(10), description: desc(sales, 'Account Executive'), boards: {} },
    ];
    // [name, job, stage, source, applied days ago, extra]
    const people = [
      ['Ahmad Faiz bin Rahman', 'j1', 'Applied', 'Careers page', 1],
      ['Tan Wei Ming', 'j1', 'Screening', 'LinkedIn', 9],
      ['Siti Nurhaliza binti Arjun', 'j1', 'Interview', 'Referral', 15],
      ['Rajesh Kumar a/l Subramaniam', 'j1', 'Offer', 'JobStreet', 30],
      ['Lim Jia Hui', 'j1', 'Applied', 'Careers page', 0],
      ['Muhammad Hafiz bin Ismail', 'j1', 'Screening', 'Indeed', 20, { rejected: true, rejectedOn: ago(16) }],
      ['Nur Aisyah binti Kamal', 'j2', 'Applied', 'Careers page', 2],
      ['Chong Mei Ling', 'j2', 'Interview', 'LinkedIn', 10],
      ['Farah Diana binti Yusof', 'j2', 'Screening', 'MyFutureJobs', 6],
      ['Kelvin Ng Chee Keong', 'j3', 'Hired', 'Referral', 45, { hiredDays: 9 }],
      ['Amirul Hakim bin Zainal', 'j3', 'Interview', 'JobStreet', 18],
      ['Priya Devi a/p Raman', 'j3', 'Applied', 'Walk-in', 4],
      ['Goh Siew Ling', 'j3', 'Interview', 'Careers page', 40, { rejected: true, rejectedOn: ago(25) }],
      // Earlier hires this year (roles now closed), for time to hire and sources.
      ['Nurul Aina', 'j-payroll', 'Hired', 'JobStreet', 64, { hiredDays: 34, converted: true }],
      ['Wong Kar Mun', 'j-intern', 'Hired', 'Referral', 150, { hiredDays: 125, converted: true }],
      ['Mohd Hazwan bin Ali', 'j-sdr', 'Hired', 'Careers page', 220, { hiredDays: 180, converted: true }],
      ['Lee Chun Hao', 'j-payroll', 'Offer', 'Indeed', 60, { rejected: true, rejectedOn: ago(40) }],
      ['Kavitha a/p Muniandy', 'j-payroll', 'Interview', 'MyFutureJobs', 58, { rejected: true, rejectedOn: ago(45) }],
      ['Syafiq bin Harun', 'j-sdr', 'Screening', 'Agency', 210, { rejected: true, rejectedOn: ago(200) }],
    ];
    const candidates = people.map(([name, jobId, stage, source, days, x = {}], i) => {
      const applied = ago(days), reach = R.STAGES.indexOf(stage), end = x.hiredDays != null ? ago(x.hiredDays) : x.rejectedOn || T;
      const stageDates = {};
      R.STAGES.slice(0, reach + 1).forEach((s, k) => { stageDates[s] = k === 0 ? applied : U.addDays(applied, Math.round(((Math.max(1, (U.parse(end) - U.parse(applied)) / 864e5)) * k) / (reach + (stage === 'Hired' ? 0 : 1)))); });
      if (stage === 'Hired') stageDates.Hired = end;
      const first = name.split(' ')[0].toLowerCase();
      return { id: 'c' + (i + 1), name, jobId, stage, source, applied, stageDates, rating: 3, email: `${first}.${name.split(' ').slice(-1)[0].toLowerCase().replace(/[^a-z]/g, '')}@gmail.com`, phone: `01${(i % 9) + 1}-${String(2000000 + i * 734117).slice(0, 3)} ${String(4000 + i * 377).slice(0, 4)}`, interviews: [], offers: [], ...(stage === 'Hired' ? { hiredOn: end } : {}), ...(x.rejected ? { rejected: true, rejectedOn: x.rejectedOn } : {}), ...(x.converted ? { converted: true } : {}), consentAt: `${applied}T09:00:00.000Z` };
    });
    const cand = (n) => candidates.find((c) => c.name.startsWith(n));
    const card = (scores, recommend, notes, at) => ({ scores: Object.fromEntries(d.recruit.criteria.map((k, i) => [k, scores[i]])), recommend, notes, at });
    const bookings = [];
    const iv = (c, id, title, date, start, end, mode, interviewers, scorecards, roomId = '') => {
      const x = { id, title, date, start, end, mode, where: '', interviewers, scorecards, status: 'Scheduled' };
      if (roomId) { const b = { id: 'bk-' + id, roomId, date, start, end, title: `Interview: ${c.name}`, by: 'e1', people: interviewers.length + 1, status: 'Booked', ref: id }; bookings.push(b); x.bookingId = b.id; }
      else if (mode === 'Video call') x.where = 'https://meet.google.com/abc-defg-hij';
      c.interviews.push(x); return x;
    };
    const siti = cand('Siti'), raj = cand('Rajesh'), chong = cand('Chong'), amir = cand('Amirul'), kelvin = cand('Kelvin');
    iv(siti, 'iv1', 'First interview', ago(5), '10:00', '11:00', 'In person', ['e4', 'e2'], { e4: card([4, 4, 5, 4], 'Yes', 'Strong on payments systems; asked good questions about our stack.', ago(5)) }, 'rm1');
    iv(siti, 'iv2', 'Technical interview', ahead(1), '14:00', '15:30', 'In person', ['e4', 'e12'], {}, 'rm3');
    iv(raj, 'iv3', 'First interview', ago(20), '11:00', '12:00', 'Video call', ['e4', 'e2'], { e4: card([5, 4, 4, 4], 'Strong yes', 'Built a payroll engine before. Clear thinker.', ago(20)), e2: card([4, 5, 4, 4], 'Yes', 'Good at explaining trade-offs.', ago(19)) });
    iv(raj, 'iv4', 'Technical interview', ago(12), '14:00', '15:30', 'In person', ['e4', 'e12'], { e4: card([5, 5, 4, 4], 'Strong yes', '', ago(12)), e12: card([4, 4, 4, 5], 'Yes', 'Comfortable with our deployment setup.', ago(12)) }, 'rm3');
    iv(chong, 'iv5', 'First interview', ahead(2), '10:00', '11:00', 'In person', ['e9', 'e13'], {}, 'rm2');
    iv(amir, 'iv6', 'First interview', ago(4), '15:00', '16:00', 'Video call', ['e14', 'e6'], { e14: card([4, 3, 4, 4], 'Yes', 'Good hunter mentality; light on SaaS experience.', ago(4)) });
    iv(kelvin, 'iv7', 'First interview', ago(32), '10:00', '11:00', 'In person', ['e14', 'e6'], { e14: card([5, 4, 5, 5], 'Strong yes', 'Referred by Kevin. Ex-JobStreet sales.', ago(32)), e6: card([4, 4, 5, 5], 'Strong yes', '', ago(32)) }, 'rm1');
    const offerBody = (c, salary, start) => AllurusHRRules.fill(d.recruit.offerTemplates[0].body, { 'candidate.name': c.name, 'job.title': jobs.find((j) => j.id === c.jobId).title, 'job.department': departments.find((x) => x.id === jobs.find((j) => j.id === c.jobId).dept).name, 'job.location': jobs.find((j) => j.id === c.jobId).location, 'offer.salary_monthly': `RM ${salary.toLocaleString('en-MY', { minimumFractionDigits: 2 })}`, 'offer.start_date': U.fmtDate(start, { day: 'numeric', month: 'long', year: 'numeric' }), 'offer.probation_months': 3, 'offer.expires': U.fmtDate(ahead(5), { day: 'numeric', month: 'long', year: 'numeric' }), 'company.name': settings.company });
    raj.offers.push({ id: 'of1', templateId: 'of-perm', subject: 'Offer of employment: Senior Backend Engineer', body: offerBody(raj, 11000, ahead(30)), salary: 11000, start: ahead(30), probation: 3, expires: ahead(5), at: ago(2), status: 'Sent', by: 'e1' });
    kelvin.offers.push({ id: 'of2', templateId: 'of-perm', subject: 'Offer of employment: Account Executive', body: offerBody(kelvin, 5000, ahead(14)), salary: 5000, start: ahead(14), probation: 3, expires: ago(5), at: ago(12), status: 'Accepted', repliedAt: ago(9), by: 'e1' });
    // Stage dates follow the first interview and the offer.
    candidates.forEach((c) => {
      const first = c.interviews.map((x) => x.date).sort()[0], sd = c.stageDates;
      if (first && sd.Interview && first < sd.Interview) sd.Interview = first;
      if (c.offers[0] && sd.Offer) sd.Offer = c.offers[0].at;
      if (sd.Screening && sd.Interview && sd.Screening >= sd.Interview) sd.Screening = U.addDays(sd.Interview, -3);
    });

    // Rooms and bookings (weekdays here run Sunday to Thursday).
    const rooms = [
      { id: 'rm1', name: 'Bilik Kenyir', floor: 'Level 1', capacity: 8, equipment: ['TV screen', 'Video call', 'Whiteboard'], active: true },
      { id: 'rm2', name: 'Bilik Tasik', floor: 'Level 1', capacity: 4, equipment: ['TV screen'], active: true },
      { id: 'rm3', name: 'Bilik Mesyuarat Utama', floor: 'Level 2', capacity: 16, equipment: ['Projector', 'Video call', 'Whiteboard', 'Speakerphone'], active: true },
      { id: 'rm4', name: 'Pondok Fokus', floor: 'Level 2', capacity: 2, equipment: ['Video call'], active: true },
    ];
    const work = []; for (let i = -7; work.length < 12 && i < 20; i++) { const day = U.addDays(T, i); if (!U.isWeekend(day)) work.push(day); }
    const todayIdx = work.findIndex((x) => x >= T);
    const at = (k) => work[Math.max(0, todayIdx + k)];
    [['rm3', 0, '09:00', '10:00', 'Monday all-hands', 'e1', 15], ['rm1', 0, '11:00', '12:00', 'Sprint planning', 'e4', 7], ['rm2', 0, '14:30', '15:30', 'Design review', 'e3', 4], ['rm1', 0, '15:00', '16:00', 'Client call: Kemaman Logistics', 'e2', 3],
      ['rm4', 0, '16:00', '17:00', 'Call with accountant', 'e11', 1], ['rm1', 1, '09:30', '10:30', 'Pipeline review', 'e14', 6], ['rm2', 1, '11:00', '12:00', 'Payroll cut-off check', 'e19', 3], ['rm1', 1, '15:00', '16:00', 'Architecture chat', 'e2', 5],
      ['rm3', 2, '14:00', '16:00', 'Q4 marketing workshop', 'e9', 10], ['rm1', 3, '10:00', '11:00', 'One-to-one with Arjun', 'e2', 2], ['rm2', -1, '10:00', '11:00', 'Content planning', 'e13', 3], ['rm1', -2, '14:00', '15:00', 'Retro', 'e4', 7]]
      .forEach(([roomId, k, start, end, title, by, n], i) => bookings.push({ id: 'bk' + (i + 1), roomId, date: at(k), start, end, title, by, people: n, status: 'Booked', ref: '' }));
    bookings.push({ id: 'bk-x1', roomId: 'rm3', date: at(1), start: '16:00', end: '17:00', title: 'Town hall rehearsal', by: 'e15', people: 6, status: 'Cancelled', ref: '' });

    // Training: courses, enrolments with certificates (a few expiring or expired) and requests.
    const courses = [
      ...d.courses,
      { id: 'co-osh', title: 'Workplace safety and health', category: 'Safety', provider: 'In-house with the safety committee', hours: 2, desc: 'Your duties and the company’s under the Occupational Safety and Health Act 1994: hazards, reporting, fire drills and first aid points in our office.', validMonths: 12, active: true, mandatory: { all: true, depts: [], roles: [] }, hrdc: { claimable: false, fee: 0 },
        modules: [{ id: 'm1', kind: 'text', title: 'Everyone’s duty', body: 'Under the Occupational Safety and Health Act 1994, employers must provide a safe workplace, and employees must take reasonable care of themselves and others and follow safety instructions.\n\nReport hazards, near misses and injuries to your supervisor or the safety committee the same day.' }, { id: 'm2', kind: 'video', title: 'Fire drill and assembly point', url: 'https://intranet.serimaju.com.my/training/fire-drill-kuantan.mp4' }, { id: 'm3', kind: 'pdf', title: 'Office emergency plan', url: 'https://intranet.serimaju.com.my/safety/emergency-plan.pdf' }],
        quiz: { passMark: 80, questions: [{ id: 'q1', q: 'You see a trailing cable across a walkway. What do you do?', options: ['Step over it', 'Make it safe if you can and report it', 'Wait for someone else'], answer: 1 }, { id: 'q2', q: 'Where do we gather when the fire alarm goes off?', options: ['In the lift lobby', 'At the assembly point in the car park', 'At your desk'], answer: 1 }, { id: 'q3', q: 'A near miss with no injury still needs reporting.', options: ['True', 'False'], answer: 0 }] } },
      { id: 'co-harass', title: 'Preventing sexual harassment at work', category: 'Compliance', provider: 'In-house', hours: 1.5, desc: 'What sexual harassment is, how to raise a complaint, and how the company must handle it under the Employment Act 1955 and the Anti-Sexual Harassment Act 2022.', validMonths: 24, active: true, mandatory: { all: true, depts: [], roles: [] }, hrdc: { claimable: false, fee: 0 },
        modules: [{ id: 'm1', kind: 'text', title: 'What it is', body: 'Sexual harassment is any unwanted conduct of a sexual nature, whether verbal, non-verbal, visual, gestural or physical, that a reasonable person would find offensive, humiliating or threatening.\n\nIt can happen in the office, at events, on business trips and online.' }, { id: 'm2', kind: 'text', title: 'Raising a concern', body: 'Raise a concern with HR or through “Raise a concern” in Allurus. You can keep your name from your department. The company must look into every complaint, and retaliation is not allowed.' }, { id: 'm3', kind: 'pdf', title: 'Anti-harassment policy', url: 'https://intranet.serimaju.com.my/policies/anti-harassment-policy.pdf' }],
        quiz: { passMark: 75, questions: [{ id: 'q1', q: 'Harassment only counts if it happens in the office.', options: ['True', 'False'], answer: 1 }, { id: 'q2', q: 'Who can you raise a concern with?', options: ['Only your manager', 'HR, or anonymously to your department through Allurus', 'No one'], answer: 1 }] } },
      { id: 'co-lead', title: 'Leading people fairly', category: 'Leadership', provider: 'In-house', hours: 3, desc: 'Fair hiring, setting goals, handling leave and misconduct, and having difficult conversations.', validMonths: 0, active: true, mandatory: { all: false, depts: [], roles: ['Manager', 'Head of', 'Lead'] }, hrdc: { claimable: false, fee: 0 },
        modules: [{ id: 'm1', kind: 'text', title: 'Fair decisions', body: 'Base decisions about people on the job and the evidence. Write down why, and be consistent.' }, { id: 'm2', kind: 'video', title: 'Difficult conversations', url: 'https://intranet.serimaju.com.my/training/difficult-conversations.mp4' }], quiz: { passMark: 0, questions: [] } },
      { id: 'co-secure', title: 'Secure coding basics', category: 'Skills', provider: 'In-house (Engineering)', hours: 2, desc: 'The common web vulnerabilities and how our code avoids them.', validMonths: 12, active: true, mandatory: { all: false, depts: ['d-eng'], roles: [] }, hrdc: { claimable: false, fee: 0 },
        modules: [{ id: 'm1', kind: 'text', title: 'Input is untrusted', body: 'Escape output, validate input on the server, and use parameterised queries.' }, { id: 'm2', kind: 'pdf', title: 'Our secure coding checklist', url: 'https://intranet.serimaju.com.my/engineering/secure-coding-checklist.pdf' }],
        quiz: { passMark: 100, questions: [{ id: 'q1', q: 'Where must input be validated?', options: ['Only in the browser', 'On the server'], answer: 1 }] } },
      { id: 'co-excel', title: 'Advanced Excel for finance and HR', category: 'Skills', provider: 'Kursus Pintar Sdn Bhd', hours: 14, desc: 'Two-day classroom course: PivotTables, lookups, Power Query and dashboards.', validMonths: 0, active: true, mandatory: null, hrdc: { claimable: true, fee: 850 },
        modules: [{ id: 'm1', kind: 'text', title: 'Course details', body: 'Classroom course in Kuantan, two days, 9am to 5pm. Bring a laptop with Excel 365. HR applies for the HRD Corp grant before the course starts.' }], quiz: { passMark: 0, questions: [] } },
    ];
    const enrolments = [];
    let certN = 0;
    const done = (empId, courseId, completedAt, attemptsPct) => { const c = courses.find((x) => x.id === courseId); certN++; enrolments.push({ id: `en${enrolments.length + 1}`, courseId, empId, assigned: U.addDays(completedAt, -10), due: U.addDays(completedAt, 20), source: c.mandatory ? 'Mandatory' : 'Assigned', done: c.modules.map((m) => m.id), attempts: c.quiz.questions.length ? [{ at: completedAt, pct: attemptsPct || 100, passed: true }] : [], completedAt, certNo: `ALL-TR-${completedAt.slice(0, 4)}-${String(certN).padStart(4, '0')}`, expires: R.certExpiry(completedAt, c.validMonths) }); };
    const open = (empId, courseId, assigned, due, doneMods = []) => enrolments.push({ id: `en${enrolments.length + 1}`, courseId, empId, assigned, due, source: 'Mandatory', done: doneMods, attempts: [], completedAt: '', certNo: '', expires: '' });
    const active = employees.filter((e) => e.status !== 'Inactive');
    active.forEach((e, i) => {
      const startDay = e.start > '2025-01-01' ? e.start : '2025-01-01';
      if (e.id === 'e19') { done(e.id, 'co-welcome', ago(10)); open(e.id, 'co-pdpa', ago(10), ahead(20), ['m1']); open(e.id, 'co-osh', ago(10), ahead(20)); open(e.id, 'co-harass', ago(10), ahead(20)); return; }
      done(e.id, 'co-welcome', U.addDays(startDay, 3));
      // PDPA every two years: two people expiring next month, one expired with the renewal assigned.
      const pdpa = e.id === 'e6' || e.id === 'e10' ? ahead(28 + i).replace(/^\d{4}/, (y) => String(+y - 2)) : e.id === 'e13' ? '2024-09-12' : U.addDays('2025-02-10', i * 9);
      done(e.id, 'co-pdpa', pdpa < e.start ? U.addDays(e.start, 7) : pdpa, 75 + (i % 3) * 12 > 100 ? 100 : 75 + (i % 3) * 12);
      if (e.id === 'e13') open(e.id, 'co-pdpa', ago(18), ago(4), ['m1', 'm2']);
      // Safety every year: completed between last November and March, so some expire within 60 days.
      if (e.id === 'e18') open(e.id, 'co-osh', ago(30), ago(3));
      else done(e.id, 'co-osh', U.addDays('2025-11-02', (i * 11) % 140), 100);
      // Harassment course: most done; Daniel and Amirul still to finish.
      if (e.id === 'e2') open(e.id, 'co-harass', ago(6), ahead(14));
      else if (e.id === 'e10') open(e.id, 'co-harass', ago(6), ahead(14), ['m1']);
      else done(e.id, 'co-harass', U.addDays('2025-06-15', i * 5), 100);
      if (/Manager|Head of|Lead/i.test(e.role) && e.id !== 'e9') done(e.id, 'co-lead', U.addDays('2025-08-04', i * 3));
      if (e.dept === 'd-eng') { if (e.id === 'e2') open(e.id, 'co-secure', ago(12), ahead(18), ['m1']); else done(e.id, 'co-secure', U.addDays('2026-01-20', i * 6), 100); }
    });
    done('e7', 'co-excel', ago(70)); done('e11', 'co-excel', ago(70));
    const trainingRequests = [
      { id: 'tr1', empId: 'e7', title: 'Power BI for data analysts', provider: 'Kursus Pintar Sdn Bhd', cost: 1800, start: ahead(24), end: ahead(26), hrdc: true, reason: 'Our board reports are built by hand in Excel each month. Power BI would automate them.', at: ago(2), status: 'Pending', chain: chainFor('e7', 'd-fin', []) },
      { id: 'tr2', empId: 'e5', title: 'AWS Cloud Practitioner exam and course', provider: 'Amazon Web Services', cost: 650, start: ahead(35), end: ahead(35), hrdc: false, reason: 'We are moving the staging stack to AWS.', at: ago(5), status: 'Pending', chain: null },
      { id: 'tr3', empId: 'e13', title: 'Content Marketing Summit KL', provider: 'MDEC partner event', cost: 450, start: ahead(9), end: ahead(10), hrdc: false, reason: 'Talks on B2B content and SEO for Malaysian markets.', at: ago(12), status: 'Approved', chain: null },
      { id: 'tr4', empId: 'e17', title: 'MIA Budget seminar (CPE hours)', provider: 'Malaysian Institute of Accountants', cost: 380, start: ago(20), end: ago(20), hrdc: true, reason: 'Keeps my CPE hours up to date and covers the tax changes.', at: ago(40), status: 'Attended', chain: null },
    ];
    const tr2Steps = L.buildChain({ applicant: 'e5', chain: lv.chains?.['d-eng'], hr: lv.hr, hrBackup: lv.hrBackup }).filter((x) => x.status === 'pending').length;
    trainingRequests[1].chain = chainFor('e5', 'd-eng', Array.from({ length: Math.max(0, tr2Steps - 1) }, () => [true, ago(4)]));
    trainingRequests[2].chain = finish('e13', 'd-mkt', ago(10));
    trainingRequests[3].chain = finish('e17', 'd-fin', ago(38));

    // Grievances: one past its response time, anonymous ones, and resolved cases in and outside the SLA.
    const g = (id, n, x) => ({ id, ref: `GR-${T.slice(0, 4)}-${String(n).padStart(3, '0')}`, ackAt: '', resolvedAt: '', outcome: '', ...x });
    const grievances = [
      g('gr1', 1, { empId: 'e16', anonymous: false, category: 'Pay and benefits', subject: 'Overtime for the August launch not paid', details: 'I worked 12 hours of overtime in the last week of August for the brand launch. It was approved by Farah but is not on my September payslip.', priority: 'High', assignee: 'e15', status: 'Closed', created: '2026-09-08', ackAt: '2026-09-09', resolvedAt: '2026-09-15', outcome: 'The overtime claim was missed at cut-off. Paid with the September supplementary run; payroll now checks approved overtime before closing.' }),
      g('gr2', 2, { empId: 'e8', anonymous: true, category: 'Workload', subject: 'On-call rota is uneven', details: 'The same two people have been on call most weekends since July. It is affecting our health and family time.', priority: 'Normal', assignee: 'e15', status: 'Investigating', created: ago(12), ackAt: ago(11) }),
      g('gr3', 3, { empId: 'e13', anonymous: true, category: 'Harassment or bullying', subject: 'Comments at the team dinner', details: 'At the team dinner a colleague made repeated comments about my appearance after I asked them to stop. Others saw it.', priority: 'Urgent', assignee: 'e1', status: 'Acknowledged', created: ago(10), ackAt: ago(10) }),
      g('gr4', 4, { empId: 'e10', anonymous: false, category: 'Working conditions', subject: 'Air-conditioning in the sales area', details: 'The air-conditioning near the sales desks has not worked properly for two weeks. It gets very hot after lunch.', priority: 'Low', assignee: 'e15', status: 'New', created: ago(1) }),
      g('gr5', 5, { empId: 'e2', anonymous: false, category: 'Facilities', subject: 'Not enough quiet rooms for calls', details: 'Customer calls from the open office are noisy. Could we have a phone booth?', priority: 'Low', assignee: 'e15', status: 'Closed', created: '2026-08-10', ackAt: '2026-08-12', resolvedAt: '2026-08-27', outcome: 'Pondok Fokus (two seats, video call) was set up on Level 2 and can be booked under Meeting rooms.' }),
      g('gr6', 6, { empId: 'e7', anonymous: false, category: 'Manager or colleague', subject: 'Credit for the board report', details: 'My analysis was presented to the board without mentioning my work.', priority: 'Normal', assignee: 'e1', status: 'Resolved', created: '2026-07-01', ackAt: '2026-07-06', resolvedAt: '2026-07-30', outcome: 'Discussed with both people. The manager acknowledged the work at the next board pack, and analysts now present their own sections.' }),
    ];
    grievances.forEach((x) => {
      x.timeline = [{ at: x.created, by: x.empId, kind: 'raised', note: 'Concern raised' }];
      if (x.ackAt) x.timeline.push({ at: x.ackAt, by: x.assignee, status: 'Acknowledged', note: 'Thank you for raising this. I am looking into it.' });
      if (['Investigating', 'Resolved', 'Closed'].includes(x.status)) x.timeline.push({ at: U.addDays(x.ackAt, 1), by: x.assignee, status: 'Investigating', note: '' });
      if (x.id === 'gr2') x.timeline.push({ at: ago(6), by: 'e15', note: 'Pulled the on-call log from July to October. Two engineers covered 70% of weekends. Meeting Arjun on Thursday.', internal: true });
      if (x.resolvedAt) x.timeline.push({ at: x.resolvedAt, by: x.assignee, status: 'Resolved', note: x.outcome });
      if (x.status === 'Closed') x.timeline.push({ at: U.addDays(x.resolvedAt, 3), by: x.assignee, status: 'Closed', note: '' });
    });
    return { requisitions, jobs, candidates, rooms, bookings, courses, enrolments, trainingRequests, grievances, recruit: d.recruit, grievance: d.grievance };
  },

  // Super Admin data: every company subscribed to Allurus.
  platform(demoSeats) {
    const r = U.rng(7);
    const T = U.today();
    const plans = [
      { id: 'starter', name: 'Starter', price: 4, maxSeats: 25, features: 'Directory, time off, attendance' },
      { id: 'growth', name: 'Growth', price: 8, maxSeats: 250, features: 'Everything in Starter, plus payroll and recruitment' },
      { id: 'enterprise', name: 'Enterprise', price: 12, maxSeats: 0, features: 'Everything in Growth, plus performance, SSO and priority support' },
    ];
    const rows = [
      ['Seri Maju Digital Sdn Bhd', 'Kuantan', 'Software and digital services', 'Malaysia', 'growth', demoSeats, 'Active', 420],
      ['Northwind Logistics', 'Chicago', 'Logistics', 'United States', 'enterprise', 412, 'Active', 610],
      ['Cedar Health Clinics', 'Toronto', 'Healthcare', 'Canada', 'enterprise', 268, 'Active', 540],
      ['Sahara Retail Group', 'Dubai', 'Retail', 'United Arab Emirates', 'growth', 186, 'Active', 380],
      ['Bluefin Software', 'Singapore', 'Technology', 'Singapore', 'growth', 94, 'Active', 300],
      ['Atlas Engineering', 'Riyadh', 'Construction', 'Saudi Arabia', 'enterprise', 335, 'Past due', 455],
      ['Kora Coffee Roasters', 'Nairobi', 'Food & beverage', 'Kenya', 'starter', 22, 'Active', 260],
      ['Meridian Legal', 'Manchester', 'Legal services', 'United Kingdom', 'growth', 58, 'Active', 210],
      ['Pixel Forge Games', 'Warsaw', 'Gaming', 'Poland', 'starter', 17, 'Trial', 9],
      ['Indus Textiles', 'Lahore', 'Manufacturing', 'Pakistan', 'growth', 143, 'Active', 175],
      ['Oakridge Academy', 'Austin', 'Education', 'United States', 'starter', 24, 'Active', 130],
      ['Vela Fintech', 'Berlin', 'Financial services', 'Germany', 'growth', 76, 'Trial', 5],
      ['Harbor Hotels', 'Barcelona', 'Hospitality', 'Spain', 'growth', 121, 'Suspended', 390],
      ['Nimbus Analytics', 'Bengaluru', 'Technology', 'India', 'starter', 19, 'Active', 70],
    ];
    const tenants = rows.map(([name, city, industry, country, plan, seats, status, ago], i) => {
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
      const c = U.city(city);
      return { id: 't' + (i + 1), name, city, lat: c.lat, lng: c.lng, industry, country, hasWorkspace: i === 0, plan, seats, status, joined: U.addDays(T, -ago), admin: i === 0 ? 'admin@allurus.com' : 'hr@' + slug.slice(0, 12) + '.com', lastActive: U.addDays(T, -Math.floor(r() * (status === 'Suspended' ? 40 : 4))) };
    });
    const price = (t) => plans.find((p) => p.id === t.plan).price * t.seats;
    const cur = U.monthKey(T);
    const invoices = [];
    tenants.filter((t) => t.status !== 'Trial').forEach((t) => {
      for (let k = 2; k >= 0; k--) {
        const mk = U.addMonths(cur, -k);
        if (U.monthKey(t.joined) > mk) continue;
        let status = 'Paid';
        if (k === 0) status = t.status === 'Past due' ? 'Overdue' : 'Open';
        if (k === 1 && (t.status === 'Past due' || t.status === 'Suspended')) status = 'Overdue';
        if (t.status === 'Suspended' && k === 0) continue;
        invoices.push({ id: `INV-${mk.replace('-', '')}-${t.id.slice(1).padStart(3, '0')}`, tenantId: t.id, month: mk, amount: price(t), status });
      }
    });
    // Monthly recurring revenue for the last 12 months, ending at today's real figure.
    const now = tenants.filter((t) => t.status === 'Active' || t.status === 'Past due').reduce((s, t) => s + price(t), 0);
    const mrr = [];
    for (let k = 11; k >= 0; k--) mrr.push({ month: U.addMonths(cur, -k), value: Math.round(now * Math.pow(0.93, k) * (0.98 + r() * 0.04)) });
    mrr[11].value = now;
    return { plans, tenants, invoices, mrr };
  },
};
