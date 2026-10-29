// Demo company 3: Major Far East Sdn Bhd, a wholesaler of hardware and building materials with a warehouse in
// Kepong, Kuala Lumpur. It buys stock from vendors and sells to contractors and hardware shops, so it uses the
// stock and purchasing part of Operations (no production or deliveries). Three logins: the Managing Director
// (Owner), the HR admin, and the warehouse supervisor, who sees the stock page and is told as soon as a
// purchase order is approved, with a link to it, so he knows what is coming and when. Opened with ?demo=majorfe.
// All names, registration numbers, clients and vendors are made up. Dates are relative to today.
(function () {
  'use strict';
  const O = window.AllurusOpsRules;
  const r2 = (n) => Math.round(n * 100) / 100;
  const COMPANY = 'Major Far East Sdn Bhd';
  const DOMAIN = 'majorfareast.com.my';
  // The demo's starting check-in point (the site set in Settings, Kemaman). The lorry driver may check in outside it
  // (field staff). `at` only orders it against points HR saves later (newer wins); it replaces the old Kepong point
  // (at 26 Oct) on phones that still have it. The app shows it as "demo default", not as a time someone saved it.
  const published = { company: COMPANY, label: 'Major Far East site, Kemaman', lat: 4.245987, lng: 103.41691, radius: 100, field: ['e11'], at: Date.UTC(2026, 9, 29, 0, 0) };

  function create() {
    const T = U.today();
    const rnd = U.rng(1988);
    const iso = (d, hm) => new Date(`${d}T${hm}:00`).toISOString();
    const START = U.addDays(T, -65);

    // ---------- Company ----------
    const checkin = { label: published.label, lat: published.lat, lng: published.lng, radius: published.radius, remote: false, field: [...published.field], setAt: published.at, kiosks: [], supervisor: true, projects: 'off' };
    const settings = { company: COMPANY, domain: DOMAIN, currency: 'MYR', office: 'Kuala Lumpur', checkin, taxRate: 0, benefitsRate: 11.7, theme: 'system', statutory: { ...U.STATUTORY }, claims: AllurusClaims.policyDefaults() };
    settings.employer = { ssm: '000000000000 (DEMO ONLY)', epfNo: '00000000 (DEMO)', socsoNo: 'B0000000000X (DEMO)', lhdnNo: 'C 0000000000 (DEMO)', hrdNo: 'HRDC-DEMO-0000', address: 'Lot 7, Jalan Industri Kepong 2, Kawasan Perindustrian Kepong, 52100 Kuala Lumpur', phone: '+60 3-0000 0000', signatory: 'Farah Nadia binti Rahman', signatoryTitle: 'HR & Admin Manager' };
    const departments = [
      { id: 'd-mgmt', name: 'Management', lead: 'e1', color: '#14302E', about: 'Runs the business.', duties: 'Strategy, Key accounts, Approvals' },
      { id: 'd-admin', name: 'HR, Admin & Accounts', lead: 'e2', color: '#0F766E', about: 'People, payroll, the books and purchasing.', duties: 'HR, Payroll, Invoicing, Purchasing' },
      { id: 'd-sales', name: 'Sales', lead: 'e6', color: '#7A62C9', about: 'Sells to contractors and hardware shops.', duties: 'Quotations, Orders, Collections' },
      { id: 'd-wh', name: 'Warehouse', lead: 'e3', color: '#B8914A', about: 'Receives, stores and loads the goods.', duties: 'Receiving, Stock counts, Loading, Delivery' },
    ];

    // Leave: Kuala Lumpur calendar (built in), Saturday and Sunday off.
    const L = AllurusLeaveRules;
    settings.leave = L.defaultSettings({ state: 'Kuala Lumpur', departments, hr: 'e2', hrBackup: 'e1' });
    Object.assign(settings.leave.chains, {
      'd-mgmt': { l1: 'e1', l1b: '', l2: '', l2b: '' }, 'd-admin': { l1: 'e2', l1b: 'e1', l2: '', l2b: '' },
      'd-sales': { l1: 'e6', l1b: 'e1', l2: '', l2b: '' }, 'd-wh': { l1: 'e3', l1b: 'e2', l2: '', l2b: '' },
    });
    U.setWeekend(L.weekendDays(settings.leave));
    const lctx = L.calendarCtx(settings.leave, `${+T.slice(0, 4) - 1}-01-01`, `${+T.slice(0, 4) + 1}-12-31`);
    const isWork = (d) => L.isWorkingDay(d, lctx);
    const workdays = (from, to) => { const out = []; for (let d = from; d <= to; d = U.addDays(d, 1)) if (isWork(d)) out.push(d); return out; };
    const wd = (n) => { let d = U.addDays(T, n); while (!isWork(d)) d = U.addDays(d, n < 0 ? -1 : 1); return d; };

    // ---------- People ----------
    // [first, last, job title, department, monthly salary (RM), start, gender, married]
    const people = [
      ['Kok Leong', 'Lim', 'Managing Director', 'd-mgmt', 0, '1998-03-02', 'male', true],
      ['Farah Nadia', 'binti Rahman', 'HR & Admin Manager', 'd-admin', 6800, '2015-07-01', 'female', true],
      ['Hafizuddin', 'bin Yahya', 'Warehouse Supervisor', 'd-wh', 4200, '2012-04-16', 'male', true],
      ['Mei Yee', 'Wong', 'Account Executive', 'd-admin', 3900, '2019-09-02', 'female', false],
      ['Wei Jie', 'Chong', 'Purchasing Executive', 'd-admin', 3600, '2021-01-11', 'male', false],
      ['Nor Azura', 'binti Hamid', 'Sales Manager', 'd-sales', 6200, '2014-10-06', 'female', true],
      ['Rajesh', 'a/l Subramaniam', 'Sales Executive', 'd-sales', 3500, '2020-05-18', 'male', true],
      ['Amirul', 'bin Hassan', 'Storekeeper', 'd-wh', 2700, '2017-02-20', 'male', true],
      ['Lokman', 'bin Ismail', 'Store Assistant', 'd-wh', 2100, '2023-03-06', 'male', false],
      ['Ganesan', 'a/l Muthu', 'Forklift Operator', 'd-wh', 2300, '2018-08-13', 'male', true],
      ['Zainal', 'bin Abidin', 'Lorry Driver', 'd-wh', 2400, '2016-11-01', 'male', true],
      ['Siew Mei', 'Tan', 'Admin Clerk', 'd-admin', 2500, '2024-06-03', 'female', false],
    ];
    const HANDLES = ['lim.kokleong', 'farah.nadia', 'hafiz.yahya', 'wong.meiyee', 'chong.weijie', 'nor.azura', 'rajesh.s', 'amirul.hassan', 'lokman.ismail', 'ganesan.muthu', 'zainal.abidin', 'tan.siewmei'];
    const STREETS = ['Taman Kepong Baru, 52100 Kuala Lumpur', 'Desa Jaya, 52100 Kepong', 'Taman Bukit Maluri, 52100 Kepong', 'Bandar Menjalara, 52200 Kuala Lumpur', 'Taman Selayang Baru, 68100 Batu Caves', 'Sri Damansara, 52200 Kuala Lumpur'];
    const KIN = [['Ng Siew Lan', 'Spouse'], ['Ahmad bin Rahman', 'Father'], ['Rohana binti Said', 'Mother'], ['Lakshmi a/p Raman', 'Spouse'], ['Wong Kah Hoe', 'Brother']];
    const S = AllurusStatutory;
    const employees = people.map(([first, last, role, dept, monthly, start, gender, married], i) => {
      const id = 'e' + (i + 1);
      const birthday = `${1968 + ((i * 7) % 30)}-${U.pad(1 + ((i * 5) % 12))}-${U.pad(3 + ((i * 11) % 25))}`;
      return {
        id, first, last, role, dept, salary: monthly * 12, start, location: 'Kuala Lumpur', birthday,
        email: `${HANDLES[i]}@${DOMAIN}`, phone: `01${[2, 6, 7, 9][i % 4]}-${String(3300000 + i * 417113).slice(0, 3)} ${String(3000 + i * 389).slice(-4)}`,
        type: i === 0 ? 'Owner' : 'Full-time', status: 'Active', manager: '', gender, married,
        idType: 'mykad', ic: `${birthday.replace(/-/g, '').slice(2)}14${String(5000 + i * 37).slice(-3)}${gender === 'male' ? 1 + (i % 4) * 2 : 2 + (i % 4) * 2}`,
        epfNo: String(21000000 + i * 318271).slice(0, 8), socsoNo: '', taxNo: i === 0 ? '' : `SG ${String(2600000000 + i * 4117391).slice(0, 10)}`,
        bank: S.BANKS[(i + 2) % 7], accountNo: String(5140000000000 + i * 2234567891).slice(0, 12),
        endDate: '', leaveReason: '', cp22Filed: start, leaverFiled: '', timePattern: '', probationEnd: '', confirmedOn: '', contractEnd: '',
        nationality: 'Malaysia', passportNo: '', passportExpiry: '', permitNo: '', permitExpiry: '',
        personalEmail: `${HANDLES[i].replace('.', '')}@gmail.com`,
        address: `No. ${11 + i * 6}, Jalan ${['Kepong', 'Desa', 'Menjalara', 'Ambang', 'Rimbunan'][i % 5]} ${1 + (i % 9)}, ${STREETS[i % STREETS.length]}`,
        emergency: { name: KIN[i % KIN.length][0], relation: KIN[i % KIN.length][1], phone: `01${(i + 2) % 10}-${String(6200000 + i * 71111).slice(0, 3)} ${String(1100 + i * 211).slice(-4)}` },
        education: [{ level: ['d-wh'].includes(dept) && i > 2 ? 'SPM' : 'Degree', field: '', institution: i % 2 ? 'SMK Kepong Baru' : 'Universiti Tunku Abdul Rahman', year: String(+start.slice(0, 4) - 2) }],
        employment: [], career: [{ id: `cr-${id}`, date: start, type: 'joined', to: role, note: departments.find((d) => d.id === dept).name }],
      };
    });
    const E = (id) => employees.find((e) => e.id === id);
    employees.forEach((e) => { const d = departments.find((x) => x.id === e.dept); e.manager = d.lead === e.id ? (e.id === 'e1' ? '' : 'e1') : d.lead; });
    E('e11').timePattern = 'p-wh';

    // ---------- Hours ----------
    const TR = AllurusTimeRules, wk5 = [1, 2, 3, 4, 5];
    settings.time = TR.defaultSettings({ restDays: L.weekendDays(settings.leave) });
    Object.assign(settings.time, {
      patterns: [
        { id: 'p-office', name: 'Office hours', start: '08:30', end: '17:30', breakMin: 60, grace: 10, days: wk5, flexible: false, color: '#0F766E' },
        { id: 'p-wh', name: 'Warehouse', start: '08:00', end: '17:00', breakMin: 60, grace: 5, days: wk5, flexible: false, color: '#B8914A' },
      ],
      deptPattern: { 'd-mgmt': 'p-office', 'd-admin': 'p-office', 'd-sales': 'p-office', 'd-wh': 'p-wh' },
      minStaff: { 'd-wh': 3 },
    });
    const shiftOf = (e, d) => TR.resolveDay({ day: d, roster: undefined, empPattern: e.timePattern, deptPattern: settings.time.deptPattern[e.dept], cfg: settings.time, holiday: lctx.holidays.has(d) });

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
      const days = L.countDays({ from, to, calendar: t.calendar }, lctx).days;
      leaves.push({ id: `l${leaves.length + 1}`, empId, type, from, to, half: '', days, reason, attachment: null, status, created: U.addDays(from, -7) < T ? U.addDays(from, -7) : T, chain, ...extra });
    };
    const ALL = [true, true, true];
    leave('e9', 'sick', wd(-4), wd(-4), 'Fever. MC attached.', ALL, { attachment: doc('Medical Certificate', ['Klinik Kepong Medicare (demo)', 'Patient: Lokman bin Ismail', `Unfit for duty: ${U.fmtDate(wd(-4))}`, '1 day']) });
    leave('e7', 'annual', wd(-20), span(wd(-20), 3), 'Deepavali in Ipoh', ALL);
    leave('e4', 'annual', wd(-33), wd(-33), 'Personal matter', ALL);
    // Waiting for the warehouse supervisor (Hafiz) to decide.
    leave('e10', 'annual', wd(5), span(wd(5), 2), 'Daughter’s school sports day and family visit');
    leave('e8', 'annual', wd(12), wd(12), 'Renew passport');

    // ---------- Attendance ----------
    const attendance = {};
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const leaveDays = {};
    leaves.filter((l) => l.status === 'Approved').forEach((l) => L.countDays({ from: l.from, to: l.to }, lctx).dates.forEach((d) => { (leaveDays[d] = leaveDays[d] || new Set()).add(l.empId); }));
    for (const day of workdays(START, T)) {
      attendance[day] = {};
      employees.forEach((e) => {
        if (e.id === 'e1' || e.start > day) return;
        if (leaveDays[day]?.has(e.id)) { attendance[day][e.id] = { s: 'leave', in: '' }; return; }
        // The supervisor checks in himself in the demo.
        if (day === T && e.id === 'e3') return;
        const p = shiftOf(e, day).pattern;
        if (!p) return;
        const x = rnd(), j = rnd(), o = rnd();
        if (x < 0.012) { attendance[day][e.id] = { s: 'absent', in: '' }; return; }
        const inM = TR.toMin(p.start) + (x > 0.95 ? 6 + Math.floor(j * 25) : -20 + Math.floor(j * 20));
        if (day === T && inM > nowMin) return;
        attendance[day][e.id] = { s: 'present', in: TR.fmtMin(inM), out: day === T ? '' : TR.fmtMin(TR.toMin(p.end) + Math.floor(o * 25)) };
      });
    }

    // ---------- Claims ----------
    const receipt = AllurusClaims.receiptSvg;
    const claimChain = (empId, status, at) => {
      let ch = L.buildChain({ applicant: empId, chain: settings.leave.chains[E(empId).dept], hr: settings.leave.hr, hrBackup: settings.leave.hrBackup });
      if (status !== 'Pending') ch = ch.map((s) => (s.status === 'pending' ? { ...s, status: 'approved', by: s.approver, at, actedAs: 'approver' } : s));
      return ch;
    };
    let ln = 0;
    const line = (cat, date, merchant, amount, item, fields = {}) => ({ id: `ln${++ln}`, cat, date, merchant, receiptNo: `R${70300 + ln}`, amount: r2(amount), approved: null, img: receipt(merchant, [[item, amount.toFixed(2)]], amount.toFixed(2), date, `R${70300 + ln}`), notes: '', fields });
    const claims = [];
    const claim = (empId, title, lines, status, paidIn = '') => {
      if (['Approved', 'Paid'].includes(status)) lines.forEach((l) => { l.approved = l.amount; });
      const c = { id: `cl${claims.length + 1}`, empId, title, lines, status, submitted: lines[0].date, date: lines[0].date, chain: claimChain(empId, status, U.addDays(lines[0].date, 2)), edits: [], ...(paidIn ? { paidIn } : {}) };
      c.approved = ['Approved', 'Paid'].includes(status) ? r2(lines.reduce((s, l) => s + l.approved, 0)) : null;
      claims.push(c);
    };
    const thisMonth = U.monthKey(T), months = [2, 1].map((k) => U.addMonths(thisMonth, -k));
    months.forEach((mk) => {
      const d = (n) => `${mk}-${U.pad(n)}`;
      claim('e11', `Lorry toll and parking, ${U.fmtMonth(mk)}`, [
        line('parking', d(7), 'PLUS (Touch ’n Go)', 22.4, 'Toll Kepong – Rawang return', { purpose: 'Delivery to contractor site' }),
        line('parking', d(16), 'Parking site office', 5, 'Parking, Selayang', { purpose: 'Delivery' }),
      ], 'Paid', mk);
      claim('e7', `Client visits, ${U.fmtMonth(mk)}`, [line('mileage', d(12), 'Own car', 57.6, 'Mileage 96 km', { purpose: 'Visit contractors, Rawang', from: 'Kepong', to: 'Rawang', km: 96 })], 'Paid', mk);
    });
    claim('e3', 'Pallet wrap bought in a hurry', [line('other', U.addDays(T, -3), 'Kedai Hardware Kepong Bersatu', 48, 'Stretch film, 2 rolls', { purpose: 'Wrapping a contractor order' })], 'Pending');

    // ---------- Payroll: the last two months ----------
    const payroll = {};
    months.forEach((mk) => {
      const end = U.monthEnd(mk);
      const items = employees.filter((e) => e.type !== 'Owner' && e.start <= end).map((e) => {
        const it = { empId: e.id, ...U.payCalc(e.salary, 0, settings, e, U.addDays(end, -1), { extra: [] }), extraLines: [] };
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

    // ---------- Staff documents ----------
    const docImg = (title, who, l) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380"><rect width="600" height="380" rx="18" fill="#f5f5f7" stroke="#d0d3d9"/><rect x="0" y="0" width="600" height="64" rx="18" fill="#0F766E"/><text x="28" y="41" font-family="Arial" font-size="22" fill="#fff" font-weight="700">${title}</text><text x="28" y="130" font-family="Arial" font-size="26" fill="#16181D">${who}</text><text x="28" y="175" font-family="Arial" font-size="18" fill="#575B63">${l}</text><text x="28" y="350" font-family="Arial" font-size="13" fill="#8A8F98">Sample copy for the Allurus demo</text></svg>`);
    let dn = 0;
    const fileDoc = (empId, title, category, expiry, l) => { const e = E(empId); return { id: `doc${++dn}`, empId, title, category, expiry, file: { name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`, type: 'image/svg+xml', data: docImg(title, `${e.first} ${e.last}`, l) }, uploaded: U.addDays(T, -300), by: 'e2' }; };
    const documents = [
      fileDoc('e10', 'Forklift operator training certificate', 'Certificate', U.addDays(T, 24), 'Forklift operation · refresher due'),
      fileDoc('e11', 'Driving licence (D, E)', 'Licence', U.addDays(T, 380), 'Class D and E'),
      fileDoc('e11', 'GDL (goods vehicle)', 'Licence', U.addDays(T, 150), 'Goods Driving Licence'),
    ];

    // ---------- Vendors, clients and stock ----------
    const ops = { items: [], moves: [], pos: [], products: [], batches: [], orders: [], dos: [], machines: [], maint: [], breakdowns: [], licences: [], seq: {} };
    // [id, name, expense category, payment terms (days), delivery lead time (days)]
    const VENDORS = [
      ['v-cement', 'Simen Utara Trading (demo)', 'Stock purchases', 30, 3], ['v-steel', 'Besi Rebar Selatan Sdn Bhd (demo)', 'Stock purchases', 30, 5],
      ['v-pipe', 'Paip Plastik Klang Trading', 'Stock purchases', 30, 4], ['v-paint', 'Cat Warna Jaya Sdn Bhd (demo)', 'Stock purchases', 45, 4],
      ['v-tile', 'Jubin Seramik Perak (demo)', 'Stock purchases', 30, 6], ['v-hw', 'Kedai Hardware Kepong Bersatu', 'Stock purchases', 14, 2],
      ['v-cable', 'Kabel Elektrik Gemilang', 'Stock purchases', 30, 3],
      ['v-rent', 'Hartanah Kepong Holdings (demo)', 'Rent', 7, 0], ['v-elec', 'Utiliti Elektrik Pusat (demo)', 'Utilities', 14, 0],
      ['v-diesel', 'Stesen Minyak Kepong Jaya', 'Fuel and transport', 7, 0], ['v-parts', 'Bengkel Forklift Maju (demo)', 'Repairs and maintenance', 14, 2],
    ];
    const vend = (id) => VENDORS.find((v) => v[0] === id);
    // [id, code, name, unit, opening, reorder, vendor, cost price, selling price]
    const ITEMS = [
      ['i-cement', 'TG-CEM', 'Portland cement 50 kg', 'bag', 1600, 450, 'v-cement', 21.5, 25.9],
      ['i-rebar', 'TG-RBR', 'Steel rebar 12 mm × 12 m', 'pcs', 1700, 500, 'v-steel', 28, 33.5],
      ['i-pipe', 'TG-PVC', 'PVC pipe 4 in × 6 m', 'pcs', 800, 220, 'v-pipe', 34, 41],
      ['i-paint', 'TG-PNT', 'Emulsion paint 18 L', 'pail', 330, 90, 'v-paint', 118, 145],
      ['i-tile', 'TG-TIL', 'Floor tiles 600 × 600 (box)', 'box', 650, 180, 'v-tile', 42, 52],
      ['i-screw', 'TG-SCR', 'Roofing screws (box of 500)', 'box', 260, 70, 'v-hw', 36, 45],
      ['i-cable', 'TG-CBL', 'Electrical cable 2.5 mm (90 m)', 'roll', 210, 60, 'v-cable', 165, 198],
      ['i-glove', 'TG-GLV', 'Safety gloves (dozen)', 'dozen', 170, 50, 'v-hw', 18, 24],
    ];
    ITEMS.forEach(([id, code, name, unit, opening, reorder, vendorId, lastPrice, sell]) => ops.items.push({ id, code, name, kind: 'goods', unit, opening, reorder, vendorId, lastPrice, sell, openingDate: START }));
    const item = (id) => ops.items.find((x) => x.id === id);
    let mv = 0;
    const move = (itemId, date, qty, ref, note) => ops.moves.push({ id: `mv${++mv}`, itemId, date, qty: Math.round(qty * 1000) / 1000, ref, note });
    const levels = () => O.stockLevels(ops.items, ops.moves, ops.pos);
    const onHand = (id, d) => O.onHand(item(id), ops.moves, d);
    const no = (prefix, d) => { const k = `${prefix}${d.slice(2, 4)}${d.slice(5, 7)}`; ops.seq[k] = (ops.seq[k] || 0) + 1; return `${prefix}-${d.slice(2, 4)}${d.slice(5, 7)}-${String(ops.seq[k]).padStart(3, '0')}`; };

    // Clients (made-up): [id, name, terms, orders per week, what they usually buy]
    const CLIENTS = [
      ['c-teguh', 'Binaan Teguh Sdn Bhd (demo)', 'Credit 30', 2, { 'i-cement': 60, 'i-rebar': 40, 'i-pipe': 10 }],
      ['c-murni', 'Kontraktor Seri Murni', 'Credit 30', 1, { 'i-cement': 80, 'i-rebar': 60, 'i-tile': 20 }],
      ['c-selayang', 'Kedai Hardware Selayang Baru', 'COD', 2, { 'i-paint': 6, 'i-screw': 5, 'i-glove': 8, 'i-cable': 3 }],
      ['c-idaman', 'Rumah Idaman Renovation', 'COD', 1, { 'i-tile': 30, 'i-paint': 8, 'i-cement': 20 }],
      ['c-kuasa', 'Pembinaan Kuasa Jaya (demo)', 'Credit 30', 1, { 'i-rebar': 90, 'i-cement': 100, 'i-cable': 6 }],
      ['c-ahkow', 'Hardware Ah Kow, Rawang', 'COD', 2, { 'i-screw': 6, 'i-glove': 10, 'i-pipe': 8, 'i-paint': 4 }],
    ];

    // ---------- Finance ----------
    const fin = AllurusFinance.blank({ taxLabel: 'SST', auditorFirm: '', auditorName: '', auditorEmail: '' });
    fin.openingCash = 420000; fin.openingDate = U.monthKey(START) + '-01';
    fin.budgets = { Payroll: 52000, 'Stock purchases': 190000, Rent: 12000, Utilities: 1800, 'Fuel and transport': 1600, 'Repairs and maintenance': 800, 'Bank charges': 60 };
    const addr = (line1, city, postcode) => ({ line1, line2: '', line3: '', city, postcode, state: '14', country: 'MYS' });
    const contacts = [];
    CLIENTS.forEach(([id, name, terms], i) => contacts.push({ id, kind: 'customer', name, tin: '', idType: 'BRN', idNo: '', sst: 'NA', email: `${id.slice(2)}@example.my`, phone: `+60 3-${String(6100 + i * 137).slice(-4)} ${String(2000 + i * 419).slice(-4)}`, contactName: '', address: addr(`No. ${5 + i * 9}, Jalan ${['Kuching', 'Ipoh', 'Selayang', 'Kepong', 'Rawang', 'Batu Caves'][i]}`, ['Kuala Lumpur', 'Kuala Lumpur', 'Batu Caves', 'Kuala Lumpur', 'Rawang', 'Rawang'][i], ['51200', '51100', '68100', '52100', '48000', '48000'][i]), terms: terms === 'COD' ? 'COD' : '30 days', segment: terms === 'COD' ? 'shop' : 'contractor' }));
    VENDORS.forEach(([id, name, category, terms], i) => contacts.push({ id, kind: 'supplier', name, tin: '', idType: 'BRN', idNo: '', sst: 'NA', email: `accounts@${id.slice(2)}.example.my`, phone: `+60 3-${String(6200 + i * 211).slice(-4)} ${String(4000 + i * 317).slice(-4)}`, contactName: '', address: addr(`Lot ${20 + i}, Jalan Perusahaan`, 'Kuala Lumpur', '52100'), category, terms: `${terms} days` }));
    const tx = (o) => { if (o.date <= T && o.date >= fin.openingDate) fin.txns.push({ id: `x${fin.txns.length + 1}`, tax: 0, ref: '', source: 'manual', reconciled: o.date < `${thisMonth}-01`, ...o }); };
    const billFor = (vendorId, date, amount, desc, extra = {}) => {
      const v = vend(vendorId), b = { id: `b${fin.bills.length + 1}`, supplier: v[1], contactId: vendorId, ref: extra.ref || `${v[1].replace(/[^A-Z]/g, '').slice(0, 3) || 'BIL'}-${date.replace(/-/g, '').slice(2)}`, category: v[2], issue: date, due: U.addDays(date, v[3]), amount: r2(amount), tax: 0, status: 'Unpaid', paidOn: '', note: desc, ...extra };
      fin.bills.push(b);
      return b;
    };
    let invN = 0;
    const sell = (d, client) => {
      const [clientId, name, terms, , usual] = client, c = contacts.find((x) => x.id === clientId);
      const items = [];
      Object.entries(usual).forEach(([itemId, q]) => {
        const want = Math.max(1, Math.round(q * (0.7 + rnd() * 0.6))), have = onHand(itemId);
        const qty = Math.min(want, Math.max(0, Math.floor(have)));
        if (!qty) return;
        items.push({ desc: item(itemId).name, qty, price: item(itemId).sell, classification: '022', itemId });
      });
      if (!items.length) return;
      invN++;
      const inv = { id: `i${invN}`, no: `INV-${d.slice(2, 4)}${d.slice(5, 7)}-${String(invN).padStart(4, '0')}`, customer: name, contactId: clientId, email: c.email, issue: d, due: terms === 'COD' ? d : U.addDays(d, 30), items: items.map(({ itemId, ...x }) => x), taxRate: 0, status: 'Sent', paidOn: '', type: 'invoice', category: 'Product sales' };
      items.forEach((x) => move(x.itemId, d, -x.qty, inv.no, `Sold to ${name}`));
      fin.invoices.push(inv);
    };

    // ---------- Day by day: sales, goods arriving, and purchase orders when stock runs low ----------
    let poN = 0;
    const raise = (itemId, d, status) => {
      const lv = levels().find((x) => x.id === itemId), it = item(itemId), v = vend(it.vendorId);
      const qty = Math.max(O.suggestQty(lv), Math.ceil(3 * it.reorder - lv.onHand - lv.onOrder));
      const lines = [{ itemId, qty, price: it.lastPrice, received: 0 }];
      // A second item from the same vendor if it is getting low too.
      levels().filter((x) => x.id !== itemId && x.vendorId === it.vendorId && !x.onOrder && x.onHand < x.reorder * 1.6).forEach((x) => lines.push({ itemId: x.id, qty: Math.ceil(3 * x.reorder - x.onHand), price: x.lastPrice, received: 0 }));
      let expected = U.addDays(d, v[4]);
      while (!isWork(expected)) expected = U.addDays(expected, 1);
      const p = { id: `po${++poN}`, no: no('PO', d), vendorId: it.vendorId, date: d, expected, status, lines, by: 'e5', approvedBy: status === 'Draft' ? '' : 'e1', approvedOn: status === 'Draft' ? '' : d, billId: '' };
      ops.pos.push(p);
      return p;
    };
    const receiveAll = (p, d, share = 1) => {
      const got = Object.fromEntries(p.lines.map((l) => [l.itemId, Math.floor((l.qty - (l.received || 0)) * share)]));
      const r = O.receive(p, got, { date: d, ids: () => `mv${++mv}` });
      Object.assign(p, r.po); ops.moves.push(...r.moves);
      if (p.status === 'Received') {
        const b = billFor(p.vendorId, d, O.poReceivedValue(p), `${p.no}: ${p.lines.map((l) => item(l.itemId).name.toLowerCase()).join(', ')}`, { ref: p.no, poId: p.id });
        p.status = 'Billed'; p.billId = b.id;
      }
    };
    const days = workdays(START, U.addDays(T, -1));
    let partialDone = false;
    days.forEach((d, i) => {
      const weekday = U.parse(d).getDay();
      ops.pos.filter((p) => ['Sent', 'Partial'].includes(p.status) && p.expected <= d).forEach((p) => {
        // One delivery in the last few days comes in short; the rest is still due.
        if (!partialDone && p.status === 'Sent' && d >= U.addDays(T, -4)) { partialDone = true; receiveAll(p, d, 0.6); } else if (p.status === 'Sent') receiveAll(p, d);
      });
      CLIENTS.forEach((c, k) => {
        const per = c[3];
        if ((per === 2 && (weekday === 1 + (k % 2) || weekday === 4 + (k % 2))) || (per === 1 && weekday === 2 + (k % 3))) sell(d, c);
      });
      if (i % 2 === 0) levels().filter((x) => x.low && !x.onOrder).forEach((x) => raise(x.id, d, 'Sent'));
    });
    // Today's picture for the walkthrough:
    // - at least two orders on their way this week, so the supervisor has something to expect;
    // - one delivery that came in short last week, the rest still due;
    // - a purchase order the purchasing executive raised this morning, waiting for the MD's approval;
    // - one item running low with nothing ordered yet (Make PO).
    const freeest = (skip = []) => levels().filter((l) => !l.onOrder && !skip.includes(l.id) && !ops.pos.some((p) => p.status === 'Draft' && p.lines.some((x) => x.itemId === l.id))).sort((a, b) => a.onHand / a.reorder - b.onHand / b.reorder)[0];
    while (ops.pos.filter((p) => p.status === 'Sent').length < 2) {
      const x = freeest();
      if (!x) break;
      const p = raise(x.id, wd(-1), 'Sent');
      p.expected = U.addDays(T, 1 + (ops.pos.length % 3));
    }
    if (!ops.pos.some((p) => p.status === 'Partial')) {
      const x = freeest();
      if (x) {
        const p = raise(x.id, wd(-6), 'Sent');
        p.lines = p.lines.slice(0, 1); p.expected = wd(-2);
        receiveAll(p, wd(-2), 0.5);
        p.expected = U.addDays(T, 2); p.note = 'Vendor short-shipped; the rest promised this week.';
      }
    }
    const forDraft = freeest();
    if (forDraft) { if (!forDraft.low) item(forDraft.id).reorder = Math.ceil(forDraft.onHand + 10); raise(forDraft.id, T, 'Draft'); }
    if (!levels().some((x) => x.low && !x.onOrder && !ops.pos.some((p) => p.status === 'Draft' && p.lines.some((l) => l.itemId === x.id)))) {
      const x = freeest();
      if (x) item(x.id).reorder = Math.ceil(x.onHand + 5);
    }
    // Sales invoices: cash sales paid on the day; credit clients pay after about 30–45 days, one is late.
    fin.invoices.forEach((inv) => {
      const total = AllurusFinance.invoiceTotals(inv).total;
      const late = inv.contactId === 'c-kuasa';
      const payDay = inv.due === inv.issue ? inv.issue : U.addDays(inv.due, late ? 40 : Math.floor(rnd() * 10) - 3);
      if (payDay < T) { inv.status = 'Paid'; inv.paidOn = payDay; tx({ date: payDay, desc: `Payment from ${inv.customer}`, type: 'in', category: 'Product sales', amount: total, ref: inv.no, source: 'invoice' }); }
    });
    // Rent, electricity and diesel.
    months.concat([thisMonth]).forEach((mk) => {
      const d = (n) => `${mk}-${U.pad(n)}`;
      if (d(1) <= T) billFor('v-rent', d(1), 12000, 'Warehouse rent, Kepong');
      if (d(6) <= T) billFor('v-elec', d(6), 1650, `Electricity, ${U.fmtMonth(U.addMonths(mk, -1))}`);
      [5, 19].forEach((n) => { if (d(n) <= T) billFor('v-diesel', d(n), 380, 'Diesel, lorry and forklift (fleet account)'); });
    });
    // Bills due more than a day ago are paid, except one left overdue.
    const keep = fin.bills.filter((b) => b.due < T && b.contactId === 'v-tile').slice(-1).map((b) => b.id);
    fin.bills.forEach((b) => {
      if (keep.includes(b.id) || b.due > U.addDays(T, -1)) return;
      b.status = 'Paid'; b.paidOn = b.due;
      tx({ date: b.paidOn, desc: `${b.supplier} · ${b.note || b.ref}`, type: 'out', category: b.category, amount: b.amount, tax: 0, ref: b.ref, source: 'bill' });
    });
    months.forEach((mk) => tx({ date: U.monthEnd(mk), desc: 'Bank service charges', type: 'out', category: 'Bank charges', amount: 38 }));
    fin.contacts = contacts;

    // ---------- Forklift and lorry ----------
    ops.machines = [
      { id: 'm-forklift', name: 'Forklift 2.5-tonne', kind: 'machine', pmDays: 90, pmHours: 250, hours: 4120, lastPm: U.addDays(T, -64), lastPmHours: 3890, status: 'Running', assetId: 'as-m-forklift', location: 'Warehouse' },
      { id: 'v-lorry', name: 'Lorry 5-tonne (WXK 4821)', kind: 'vehicle', pmDays: 180, pmHours: 0, hours: 0, lastPm: U.addDays(T, -120), lastPmHours: 0, status: 'Running', assetId: 'as-v-lorry', plate: 'WXK 4821', roadTax: U.addDays(T, 75), insurance: U.addDays(T, 75), serviceKm: 10000, mileage: 98210, lastServiceKm: 91500 },
    ];
    ops.maint = ops.machines.map((m, i) => ({ id: `pm${i + 1}`, machineId: m.id, date: m.lastPm, kind: 'PM', by: 'workshop', notes: m.kind === 'vehicle' ? 'Service: oil, filters, brakes' : 'Service: hydraulic oil, chains, forks checked', cost: m.kind === 'vehicle' ? 680 : 450 }));
    ops.licences = [
      { id: 'lic-dbkl', name: 'Business and premises licence', issuer: 'Local council (DBKL)', no: 'DBKL-DEMO-0000', expiry: `${T.slice(0, 4)}-12-31` },
      { id: 'lic-bomba', name: 'Fire certificate', issuer: 'Fire and Rescue Department (BOMBA)', no: 'BOMBA-DEMO-0000', expiry: U.addDays(T, 41) },
    ];

    // Assets: the forklift, the lorry, laptops.
    let an = 0;
    const asset = (id, type, name, value, holder, bought, notes = '') => ({ id: id || `as${++an}`, tag: `MFE-${String(++an).padStart(4, '0')}`, type, name, serial: `MF${String(51907 + an * 4127).slice(-5)}${'KQMRTX'[an % 6]}`, value, bought, holder, issued: holder ? bought : '', returned: '', notes, history: [] });
    const assets = [asset('as-m-forklift', 'Machine', 'Forklift 2.5-tonne', 68000, 'e10', '2019-05-02', 'Warehouse'), asset('as-v-lorry', 'Vehicle', 'Lorry 5-tonne (WXK 4821)', 165000, 'e11', '2020-02-17', `Plate WXK 4821; road tax and insurance to ${U.fmtDate(ops.machines[1].roadTax)}`)];
    ['e2', 'e3', 'e4', 'e5', 'e6', 'e7'].forEach((id) => assets.push(asset('', 'Laptop', 'Lenovo ThinkPad E14', 3499, id, '2024-03-04')));

    // ---------- HR settings, notifications and announcements ----------
    const HR = AllurusHRRules, AR = AllurusAppraisalRules, NR = AllurusNotifyRules;
    settings.hr = { onboarding: HR.defaultOnboarding(), offboarding: HR.defaultOffboarding(), letters: HR.defaultLetters(), it: 'e2', payroll: 'e2' };
    settings.appraisal = { templates: [AR.defaultTemplate()], bands: AR.defaultBands(), peerMin: 2 };
    const td = AllurusSeed.talentDefaults();
    Object.assign(settings, { recruit: td.recruit, grievance: { ...td.grievance, managers: ['e1', 'e2'] }, training: { window: 60 } });
    let nid = 0;
    const note = (type, data, to, at) => NR.deliver(type, { company: COMPANY, ...data }, [{ id: to, email: E(to).email, first: E(to).first, prefs: {} }], { at, ids: () => `sn${++nid}` });
    // What the supervisor was told when the orders now on their way were approved.
    const vName = (id) => vend(id)[1];
    const seeded = ops.pos.filter((p) => ['Sent', 'Partial'].includes(p.status)).map((p) => note('ops.incoming', {
      no: p.no, vendor: vName(p.vendorId), items: p.lines.map((l) => `${l.qty} ${item(l.itemId).unit} ${item(l.itemId).name.toLowerCase()}`).join(', '),
      expected: U.fmtDate(p.expected, { weekday: 'short', day: 'numeric', month: 'short' }), href: `#ops-stock?po=${p.id}`,
    }, 'e3', iso(p.date, '10:15')));
    const draft = ops.pos.find((p) => p.status === 'Draft');
    if (draft) seeded.push(note('ops.po', { no: draft.no, vendor: vName(draft.vendorId), total: `RM ${O.poTotal(draft).toLocaleString('en-MY', { minimumFractionDigits: 2 })}`, who: 'Chong Wei Jie', href: '#ops-stock' }, 'e1', iso(T, '09:05')));
    const announcements = [
      { id: 'an1', kind: 'announcement', title: 'Year-end stock count on 31 December', at: iso(U.addDays(T, -6), '09:00'), by: 'e2', depts: [], pinned: true, attachment: null,
        html: '<p>The warehouse will be closed to deliveries on <strong>31 December</strong> for the year-end stock count. Hafiz will share the count sheets. Sales: please tell clients to order by the 29th.</p>', acks: {} },
    ];
    const accounts = [
      { email: `lim.kokleong@${DOMAIN}`, name: 'Lim Kok Leong', hash: 'd26d5598da6f18ec3413f1100ac6b45fd588948dfcf41d7502dce2108c6efe10', roles: ['admin', 'employee'], tenantId: 't1', empId: 'e1' },
      { email: `farah.nadia@${DOMAIN}`, name: 'Farah Nadia binti Rahman', hash: '50f952befc3f17c0d2ebb8da54f054effae705fbce406689a76df35d0e519dec', roles: ['admin', 'employee'], perms: ['people', 'time', 'payroll', 'claims', 'talent', 'settings'], tenantId: 't1', empId: 'e2' },
      // The warehouse supervisor: the employee app, plus the stock page of Operations (nothing else in the console).
      { email: `hafiz.yahya@${DOMAIN}`, name: 'Hafizuddin bin Yahya', hash: '2841299af5dbe043805e434841c922bbfef42ff3879fb38cfae70a1c09794dd9', roles: ['admin', 'employee'], perms: ['operations'], opsScope: ['stock'], tenantId: 't1', empId: 'e3' },
    ];
    const platform = AllurusSeed.platform(employees.length, { row: [COMPANY, 'Kuala Lumpur', 'Wholesale trading', 'Malaysia', 'growth', employees.length, 'Active', 95], admin: `lim.kokleong@${DOMAIN}` });
    const now = Date.now();
    const activity = [
      { t: now - 1000 * 60 * 40, text: draft ? `Chong Wei Jie raised ${draft.no} for approval` : 'Stock count updated' },
      { t: now - 1000 * 60 * 60 * 26, text: `Payroll for ${U.fmtMonth(months[1])} was paid` },
    ];
    return {
      version: 3, demoCompany: 'majorfe', session: { account: null, roles: [], role: null, empId: 'e3', tenantId: 't1' }, accounts, workspaces: {},
      finance: fin, reliefs: {}, taxProfiles: {}, claims, plans: {}, leaveCarry: {}, leaveCredits: [], rosters: {}, timeRequests: [], attAudit: [], statutory, projects: [],
      announcements, notifications: seeded.flatMap((x) => x.notifications), outbox: seeded.flatMap((x) => x.emails), notifyKeys: [], settings, departments, employees, leaves, attendance, payroll,
      jobs: [], candidates: [], reviews: [], cycles: [], goals: [], payChanges: [], costing: { groups: [], jobs: [], timesheets: [] }, savedReports: [],
      requisitions: [], courses: td.courses, enrolments: [], trainingRequests: [], grievances: [], rooms: [], bookings: [],
      editRequests: [], checklists: [], assets, loans: [], insurance: [], documents, activity, platform, ops,
    };
  }

  AllurusSeed.companies.majorfe = {
    id: 'majorfe', name: COMPANY, short: 'Major Far East', blurb: 'Hardware and building materials wholesaler, Kepong', storeKey: 'allurus-hr-majorfe-v1', published, create,
    logins: [
      [`lim.kokleong@${DOMAIN}`, 'Admin', 'Lim Kok Leong · Managing Director, everything'],
      [`farah.nadia@${DOMAIN}`, 'HR admin', 'Farah Nadia · people, leave, payroll'],
      [`hafiz.yahya@${DOMAIN}`, 'Supervisor', 'Hafiz · warehouse, sees what has been bought'],
    ],
  };
})();
