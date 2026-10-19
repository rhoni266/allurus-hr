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
      ['Daniel', 'Reyes', 'Senior Software Engineer', 'd-eng', 142000, '2020-10-19', 'Remote'],
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
    const upcoming = { 2: 5, 6: 0, 11: 23, 15: 29 }; // index -> birthday in N days (Hana's is today)
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
    // 360°: Daniel asked three colleagues (two answered); Ethan's feedback is complete; Samuel asked Daniel.
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

    // Dates the reminders watch: Samuel is on a fixed-term contract with a work permit; Nurul is on probation.
    Object.assign(employees[17], { nationality: 'Nigeria', contractEnd: U.addDays(T, 25), passportNo: 'A09817263', passportExpiry: U.addDays(T, 150), permitNo: 'EP 2024-118273', permitExpiry: U.addDays(T, 60) });
    Object.assign(employees[18], { nationality: 'Malaysia', probationEnd: U.addDays(T, 26) });
    employees.forEach((e) => ['probationEnd', 'confirmedOn', 'contractEnd', 'nationality', 'passportNo', 'passportExpiry', 'permitNo', 'permitExpiry'].forEach((k) => { if (e[k] === undefined) e[k] = k === 'nationality' ? 'Malaysia' : ''; }));

    // Announcements and policies, with acknowledgements so far.
    const iso = (d, h) => new Date(`${d}T${h}:00`).toISOString();
    const ackBy = (ids, d) => Object.fromEntries(ids.map((id, i) => [id, iso(U.addDays(d, i % 3), `${10 + (i % 6)}:${10 + i}`)]));
    const announcements = [
      { id: 'an1', kind: 'policy', title: 'Work from home policy 2026', at: iso(U.addDays(T, -9), '09:30'), by: 'e1', depts: [], pinned: false, attachment: null,
        html: '<p>From 1 November, everyone can work from home up to <strong>two days a week</strong>, agreed with your manager.</p><ul><li>Check in with <em>Work remotely</em> on the days you’re at home.</li><li>Be reachable on Slack between 10am and 4pm (core hours).</li><li>Customer-facing roles keep their office roster.</li></ul><p>Questions? Ask Amara or Aisha in People.</p>',
        acks: ackBy(['e1', 'e3', 'e4', 'e6', 'e7', 'e9', 'e11', 'e13', 'e14', 'e15', 'e17'], U.addDays(T, -9)) },
      { id: 'an2', kind: 'announcement', title: 'Deepavali open house, 6 November', at: iso(U.addDays(T, -2), '15:10'), by: 'e15', depts: [], pinned: true, attachment: null,
        html: '<p>Join us for <strong>Deepavali open house</strong> on Friday 6 November from 12pm at the Kemaman office. Murukku, kuih and teh tarik on us.</p><p>Families are welcome. Tell Aisha by 30 October if you’re coming.</p>', acks: {} },
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
      note('request.submitted', { who: 'Ethan Brooks', kind: 'ot', summary: 'covering for Omar', href: '#my-approvals' }, 'e2', iso(U.addDays(T, -1), '09:12')),
      note('announcement.new', { title: 'Deepavali open house, 6 November', excerpt: 'Join us for Deepavali open house on Friday 6 November.', href: '#news' }, 'e2', iso(U.addDays(T, -2), '15:10')),
      note('request.approved', { kind: 'correction', summary: 'forgot to check out', by: 'Amara Okafor', href: '#my-time' }, 'e2', iso(U.addDays(T, -3), '10:14'), true),
      note('payslip.ready', { month: U.addMonths(thisMonth, -1), net: 'RM 8,421.50', href: '#my-pay' }, 'e2', iso(U.addDays(T, -21), '17:30'), true),
      note('appraisal.peer', { who: 'Samuel Adeyemi', cycle: `H2 ${y}`, href: '#my-appraisal' }, 'e2', iso(U.addDays(T, -5), '11:02')),
      note('checkin.flagged', { who: 'Yusuf Demir', reason: 'The phone reported a suspiciously precise accuracy of exactly 1 m.', href: '#attendance' }, 'e1', iso(T, '08:28')),
      note('request.submitted', { who: 'Lucas Moreau', kind: 'claim', summary: 'Client visit to Kuala Terengganu, RM 185.90', href: '#claims' }, 'e1', iso(U.addDays(T, -4), '17:40')),
      note('payroll.paid', { month: U.addMonths(thisMonth, -1), count: 18, net: 'RM 134,842.24', href: '#payroll' }, 'e1', iso(U.addDays(T, -21), '17:28'), true),
    ];
    seeded.forEach((x, i) => { if ([2, 3, 7].includes(i)) x.notifications.forEach((n) => { n.read = true; }); });
    const outbox = seeded.flatMap((x) => x.emails);

    // HR admin: the employee file (addresses, emergency contacts, education, past jobs, career history), assets,
    // staff loans, insurance, documents and letters, Nurul's onboarding, Julian's offboarding and a pending change.
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
    // Checklists: Nurul started on the 7th; Julian leaves at the end of next month.
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
    return { version: 3, session, accounts, workspaces: {}, finance, reliefs, taxProfiles: {}, claims, plans, leaveCarry, leaveCredits, rosters, timeRequests, attAudit, statutory, projects, announcements, notifications: seeded.flatMap((x) => x.notifications), outbox, notifyKeys: [], settings, departments, employees, leaves, attendance, payroll, jobs, candidates, reviews, cycles, goals, payChanges, editRequests, checklists, assets, loans, insurance, documents, activity, platform };
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
