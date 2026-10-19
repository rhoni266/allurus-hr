// Demo workspace. Dates are generated relative to today so the data always looks current.
window.AllurusSeed = {
  // The company's check-in point as published with the app. Every browser keeps its own copy of the
  // settings (localStorage), so this is the only value an employee's phone sees until HR sends a setup
  // link. When HR moves the check-in point, update these numbers and bump `at` so phones pick it up.
  published: { company: 'Allurus', label: 'Allurus HQ', lat: 4.238203, lng: 103.419428, radius: 50, field: [], at: Date.UTC(2026, 9, 19, 1, 0) },
  create() {
    const r = U.rng(42);
    const T = U.today();
    // Check-in zone: employees must be inside this circle (radius in meters) and take a selfie.
    const P = AllurusSeed.published;
    const checkin = { label: P.label, lat: P.lat, lng: P.lng, radius: P.radius, remote: false, field: [...P.field], setAt: P.at };
    const settings = { company: 'Allurus', domain: 'allurus.com', currency: 'MYR', office: 'Kuantan', checkin, taxRate: 8, benefitsRate: 11.7, theme: 'system', statutory: { ...U.STATUTORY }, claims: AllurusClaims.policyDefaults() };

    const departments = [
      { id: 'd-people', name: 'People', lead: 'e1', color: '#14958A', about: 'Hires, develops and looks after staff, and keeps employment practices compliant.', duties: 'Recruitment, Onboarding, Leave and attendance, Performance reviews, Employee relations' },
      { id: 'd-eng', name: 'Engineering', lead: 'e4', color: '#4A6FD1', about: 'Builds and runs the Allurus product.', duties: 'Product development, Infrastructure, Security, Quality assurance' },
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
      ['Amara', 'Okafor', 'Head of People', 'd-people', 128000, '2019-03-11', 'London'],
      ['Daniel', 'Reyes', 'Senior Software Engineer', 'd-eng', 142000, '2020-07-06', 'Remote'],
      ['Sofia', 'Lindqvist', 'Lead Product Designer', 'd-design', 124000, '2020-01-20', 'Stockholm'],
      ['Omar', 'Haddad', 'Engineering Manager', 'd-eng', 158000, '2018-09-03', 'Dubai'],
      ['Priya', 'Nair', 'Frontend Engineer', 'd-eng', 112000, '2022-02-14', 'Remote'],
      ['Lucas', 'Moreau', 'Account Executive', 'd-sales', 96000, '2021-05-17', 'Paris'],
      ['Hana', 'Sato', 'Data Analyst', 'd-fin', 98000, '2023-04-03', 'Remote'],
      ['Ethan', 'Brooks', 'Backend Engineer', 'd-eng', 118000, '2021-11-08', 'New York'],
      ['Leila', 'Rahimi', 'Marketing Lead', 'd-mkt', 121000, '2019-10-21', 'London'],
      ['Mateo', 'Silva', 'Sales Development Rep', 'd-sales', 68000, '2024-01-15', 'New York'],
      ['Grace', 'Kim', 'Finance Manager', 'd-fin', 132000, '2018-06-25', 'New York'],
      ['Yusuf', 'Demir', 'DevOps Engineer', 'd-eng', 126000, '2022-08-29', 'Remote'],
      ['Chloe', 'Martin', 'Content Strategist', 'd-mkt', 84000, '2023-09-11', 'Paris'],
      ['Noah', 'Fischer', 'Head of Sales', 'd-sales', 150000, '2019-02-04', 'Berlin'],
      ['Aisha', 'Bello', 'HR Generalist', 'd-people', 76000, '2024-06-03', 'London'],
      ['Julian', 'Rossi', 'Brand Designer', 'd-design', 92000, '2023-01-09', 'Milan'],
      ['Mei', 'Chen', 'Accountant', 'd-fin', 82000, '2022-10-17', 'Singapore'],
      ['Samuel', 'Adeyemi', 'QA Engineer', 'd-eng', 94000, '2024-03-18', 'Remote'],
      ['Nurul', 'Aina', 'Payroll Executive', 'd-fin', 54000, U.addDays(T, -12), 'Kuantan'],
    ];
    const upcoming = { 2: 5, 6: 12, 11: 23, 15: 29 }; // index -> birthday in N days
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
        phone: `+1 555 01${U.pad(i + 10)}`,
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
    // Samuel has no tax number or bank account yet, so the statutory and bank files show what is missing.
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
    // Julian is leaving at the end of next month: CP22A is due 30 days before his last day.
    Object.assign(employees[15], { endDate: U.addDays(T, 40), leaveReason: 'resign' });
    settings.employer = { ssm: '202101023456 (1418823-K)', epfNo: '021784593', socsoNo: 'E1104002873X', lhdnNo: 'E 9182736401', hrdNo: 'HRDC-AL-2021-0451', address: 'Lot 7, Jalan Kampung Tengah, 24000 Kemaman, Terengganu', phone: '+60 9-859 2210', signatory: 'Amara Okafor', signatoryTitle: 'Head of People' };

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
    leave('l2', 'e8', 'sick', wd(-1), wd(-1), 'Fever and cough. MC from Klinik Kesihatan Kemaman.', [], { attachment: doc('Medical Certificate', ['Klinik Kesihatan Kemaman', 'Patient: Ethan Brooks', `Unfit for duty: ${U.fmtDate(wd(-1))}`, '1 day', 'Dr. Nurul Huda binti Ahmad', 'MMC 54321']) });
    leave('l3', 'e5', 'annual', wd(3), span(wd(3), 3), 'Balik kampung to Ipoh');
    leave('l4', 'e13', 'annual', wd(10), span(wd(10), 3), 'Cousin’s wedding in Melaka', [true]);
    leave('l5', 'e7', 'maternity', wd(14), U.addDays(wd(14), 97), 'Expected delivery in early November', [true], { attachment: doc('Antenatal Record', ['Hospital Sultanah Nur Zahirah', 'Patient: Hana Sato', 'Expected date of delivery:', U.fmtDate(U.addDays(wd(14), 10)), 'Obstetrics clinic']) });
    leave('l6', 'e10', 'paternity', wd(-30), U.addDays(wd(-30), 6), 'Birth of our son', all, { attachment: doc('Birth Certificate', ['Jabatan Pendaftaran Negara', 'Child: Adam Silva', `Born: ${U.fmtDate(wd(-31))}`, 'Father: Mateo Silva']) });
    leave('l7', 'e12', 'unpaid', wd(-6), span(wd(-6), 2), 'Family matter in Johor Bahru', all);
    leave('l8', 'e6', 'emergency', wd(-3), wd(-3), 'Car broke down on the way to work', all, { half: 'AM' });
    leave('l9', 'e17', 'compassionate', wd(-12), span(wd(-12), 3), 'Passing of my grandmother', all);
    leave('l10', 'e9', 'annual', wd(1), wd(1), 'Family day', all);
    leave('l11', 'e16', 'replacement', wd(2), wd(2), 'Replacement for working on Malaysia Day');
    leave('l12', 'e10', 'annual', wd(-40), span(wd(-40), 2), 'Long weekend in Cameron Highlands', ['Quarter-end demos that week. Can you move it a week later?']);
    leave('l13', 'e2', 'annual', work(`${yr}-03-10`), span(work(`${yr}-03-10`), 2), 'Hari Raya preparations', all);
    leave('l14', 'e2', 'annual', wd(-50), span(wd(-50), 2), 'School holidays with the kids', all);
    leave('l15', 'e15', 'sick', wd(-9), wd(-9), 'Migraine. MC attached.', all, { attachment: doc('Medical Certificate', ['Klinik Mediviron Kemaman', 'Patient: Aisha Bello', `Unfit for duty: ${U.fmtDate(wd(-9))}`, '1 day']) });
    leave('l16', 'e14', 'annual', wd(20), span(wd(20), 5), 'Umrah with my parents');
    leaves.forEach((l) => { if (l.half) l.days = 0.5; });
    // Replacement days earned and annual leave carried in from last year (expired at the end of June).
    const leaveCredits = [{ id: 'cr1', empId: 'e16', days: 2, date: `${yr}-09-16`, reason: 'Worked on Malaysia Day for the system cut-over' }];
    const leaveCarry = { [yr]: { e2: { annual: { days: 4, expires: `${yr}-06-30`, from: yr - 1 } }, e3: { annual: { days: 5, expires: `${yr}-06-30`, from: yr - 1 } }, e11: { annual: { days: 3, expires: `${yr}-06-30`, from: yr - 1 } } } };

    // Time attendance: the Terengganu week runs Sunday to Thursday. Most teams work office hours, Engineering is
    // flexible around core hours, and a support desk (Priya, Ethan and Samuel) rotates morning and evening shifts.
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
        // Leave today empty for people who can sign in (Amara and Daniel), so they can try checking in themselves.
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
    if (attendance[T]?.e10?.in) Object.assign(attendance[T].e10, { loc: zoneLoc(fixAt(0.000301, -0.000122), 9), via: 'supervisor', by: 'e14', project: 'pj2', face: { result: 'match', sim: 58 }, device: { id: 'dev-noah', name: 'iPhone, Safari (Noah’s phone)' } });
    [['e5', 'pj2'], ['e8', 'pj1'], ['e2', 'pj3']].forEach(([id, pj]) => { if (attendance[T]?.[id]?.in) attendance[T][id].project = pj; });

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
      { id: 'au1', day: back(3), empId: 'e2', by: 'e1', byName: 'Amara Okafor', at: stamp(U.addDays(back(3), 1), '10:14'), changes: [{ field: 'out', from: '', to: '18:20' }], note: 'Correction approved: Forgot to check out after the client call.', batch: '' },
      { id: 'au2', day: back(6), empId: 'e12', by: 'e1', byName: 'Amara Okafor', at: stamp(U.addDays(back(6), 1), '09:02'), changes: [{ field: 's', from: 'absent', to: 'present' }, { field: 'in', from: '', to: '09:00' }, { field: 'out', from: '', to: '18:00' }], note: 'Phone battery died. Omar confirmed he was in.', batch: '' },
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

    const jobs = [
      { id: 'j1', title: 'Senior Backend Engineer', dept: 'd-eng', location: 'Remote', type: 'Full-time', opened: U.addDays(T, -21) },
      { id: 'j2', title: 'Product Marketing Manager', dept: 'd-mkt', location: 'London · Hybrid', type: 'Full-time', opened: U.addDays(T, -12) },
      { id: 'j3', title: 'Account Executive', dept: 'd-sales', location: 'New York', type: 'Full-time', opened: U.addDays(T, -30) },
    ];
    const candidates = [
      ['Ava Thompson', 'j1', 'Applied', 3], ['Kenji Watanabe', 'j1', 'Screening', 4], ['Fatima Zahra', 'j1', 'Interview', 5],
      ['Liam O\'Connor', 'j1', 'Offer', 4], ['Isabella Costa', 'j2', 'Applied', 3], ['Arjun Mehta', 'j2', 'Interview', 4],
      ['Zoe Laurent', 'j2', 'Screening', 3], ['Marcus Johnson', 'j3', 'Applied', 2], ['Elena Petrova', 'j3', 'Interview', 4],
      ['David Okoye', 'j3', 'Hired', 5],
    ].map(([name, jobId, stage, rating], i) => ({
      id: 'c' + (i + 1), name, jobId, stage, rating,
      email: name.toLowerCase().replace(/[^a-z ]/g, '').replace(' ', '.') + '@mail.com',
      applied: U.addDays(T, -2 - i * 2),
    }));

    const statuses = ['Completed', 'In progress', 'In progress', 'Not started'];
    const reviews = employees.map((e, i) => {
      const status = statuses[i % 4];
      return {
        id: 'r' + (i + 1), empId: e.id, cycle: 'H2 ' + T.slice(0, 4), status,
        rating: status === 'Not started' ? 0 : 3 + Math.round(r() * 2),
        progress: status === 'Completed' ? 100 : status === 'Not started' ? Math.round(r() * 20) : 35 + Math.round(r() * 50),
        notes: '',
      };
    });

    const now = Date.now();
    const activity = [
      { t: now - 1000 * 60 * 42, text: 'Leila Rahimi requested 5 days of annual leave' },
      { t: now - 1000 * 60 * 60 * 3, text: 'David Okoye accepted the Account Executive offer' },
      { t: now - 1000 * 60 * 60 * 26, text: `Payroll for ${U.fmtMonth(U.addMonths(thisMonth, -1))} was paid` },
      { t: now - 1000 * 60 * 60 * 50, text: 'Samuel Adeyemi completed onboarding' },
    ];

    const platform = this.platform(employees.length);
    const session = { account: null, roles: [], role: null, empId: 'e2', tenantId: 't1' };
    // Sign-in accounts. Passwords are stored as SHA-256 of "email:password", never in plain text.
    const accounts = [
      { email: 'superadmin@allurus.com', name: 'Allurus HQ', hash: 'f1cf377d5d77bcc3a12af1c4516fb4b6d20797dc369593edf0668aee2926cef9', roles: ['super', 'admin', 'employee', 'auditor'], tenantId: 't1', empId: 'e2' },
      { email: 'admin@allurus.com', name: 'Amara Okafor', hash: '02333a94bab39ec8b56cd57a87830ed79f29237de26eccaf9e724305ede5cbd9', roles: ['admin', 'employee'], tenantId: 't1', empId: 'e1' },
      { email: 'auditor@allurus.com', name: 'Tan Mei Ling', hash: 'de063c5c0e703dfca0ea223f81021f74d9f4abaf13918d647134e4fd064cf3ba', roles: ['auditor'], tenantId: 't1', empId: '' },
      { email: 'emp@allurus.com', name: 'Daniel Reyes', hash: '3d18388e7dd6f616a46254f4c8eb14b0aaeca178e246cd9832d4785daa11b7c9', roles: ['employee'], tenantId: 't1', empId: 'e2' },
    ];
    const finance = AllurusFinance.seed({ employees, payroll, today: T, customers: platform.tenants.filter((t) => t.id !== 't1').map((t) => ({ name: t.name, email: t.admin })) });
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
    return { version: 3, session, accounts, workspaces: {}, finance, reliefs, taxProfiles: {}, claims, plans, leaveCarry, leaveCredits, rosters, timeRequests, attAudit, statutory, projects, settings, departments, employees, leaves, attendance, payroll, jobs, candidates, reviews, activity, platform };
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
      ['Allurus', 'Kuantan', 'HR technology', 'Malaysia', 'growth', demoSeats, 'Active', 420],
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
