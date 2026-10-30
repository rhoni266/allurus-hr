// Demo company 4: Banafsha Café Sdn Bhd, a café and kitchen in Bangsar, Kuala Lumpur, for the point of sale
// (js/pos.js). Ten staff: the owner, an outlet manager, baristas who run the till, a kitchen and waiters. Two weeks of
// sales history with shifts, a lunch rush in progress today, a recipe for every drink and dish so stock comes off as
// it sells, and earlier days already posted to Finance. Opened with ?demo=banafsha.
// The HR side (leave calendar, hours, attendance, payroll) is built from the Major Far East base and renamed, so
// this file only adds what is new. All names, numbers and prices are made up; the tax and service charge rates are
// sample settings to change in POS → Menu & settings, not advice.
(function () {
  'use strict';
  const P = window.AllurusPosRules;
  const COMPANY = 'Banafsha Café Sdn Bhd';
  const DOMAIN = 'banafsha.com.my';
  const published = { company: COMPANY, label: 'Banafsha Café, Bangsar', lat: 3.130125, lng: 101.671436, radius: 80, field: [], at: Date.UTC(2026, 9, 30, 0, 0) };

  // [first, last, job title, department, monthly salary (RM), start, gender, married, login hash, POS role]
  const PEOPLE = [
    ['Nur Banafsha', 'binti Kamal', 'Founder & Owner', 'd-mgmt', 0, '2021-02-01', 'female', true, 'f2426940cd274ddd37e524f84d7763ed8d3896b07ce6b833cbe6ce29ad961138', 'manager'],
    ['Siti Hajar', 'binti Osman', 'Outlet Manager', 'd-foh', 4800, '2021-03-01', 'female', true, 'ee52d7fe434260b59ff6552751e484d04bc0f572a32ff954c98a144d28d1d914', 'manager'],
    ['Aiman', 'bin Zulkifli', 'Senior Barista & Cashier', 'd-foh', 2600, '2022-01-10', 'male', false, 'ac6b1527241c56892ed26ef22820fcc1b3e592f528129ec2f1c18333bc2a2606', 'cashier'],
    ['Priya', 'a/p Raj', 'Barista & Cashier', 'd-foh', 2300, '2023-06-05', 'female', false, 'b7ca84ab281f645fe9039e60d07c834e63f7e4cad34b0b838aaa0f3ed2e6510c', 'cashier'],
    ['Rahim', 'bin Musa', 'Head Chef', 'd-kitchen', 4200, '2021-03-01', 'male', true, '3aec604eba0cdd04bb919c14090f586ad7c2f01120ccd0a95b07fb4261969854', 'kitchen'],
    ['Kah Mun', 'Lee', 'Cook', 'd-kitchen', 2600, '2022-08-15', 'female', false, '2a807d460bb0c96f096dcf59900065d5545f84a334cbc60da413f12779866dc5', 'kitchen'],
    ['Farid', 'bin Azman', 'Waiter', 'd-foh', 2000, '2024-02-19', 'male', false, '8bde489dd8f6544ff061fd2a68f8dd05d76869f812b954c7276fde0070b354ed', 'waiter'],
    ['Nadia', 'binti Yusof', 'Waitress', 'd-foh', 2000, '2024-09-02', 'female', false, '8675aca2273e584a05d6edef69704a47fec3deda9e85700c609b0df59541d435', 'waiter'],
    ['Kumar', 'a/l Velu', 'Kitchen Helper', 'd-kitchen', 1900, '2025-01-06', 'male', true, 'a5ff394bd744064bf2f1d0eed8a99572c9dd48293ca1c53b245346714f92b2bf', 'kitchen'],
    ['Hana', 'binti Ismail', 'Accounts & HR Executive', 'd-admin', 3500, '2022-04-04', 'female', true, '43a94b3695ef6ca24f3ce9022bf4ba9e6e10c743ca745cef8a71ce06c47ddc79', ''],
  ];
  const HANDLES = ['nur.banafsha', 'siti.hajar', 'aiman.zulkifli', 'priya.raj', 'rahim.musa', 'lee.kahmun', 'farid.azman', 'nadia.yusof', 'kumar.velu', 'hana.ismail'];
  // The outlet manager's PIN approves voids, refunds and big discounts at the till (demo: 2468).
  const MANAGER_PIN = '2468';

  function create() {
    const base = AllurusSeed.companies.majorfe.create();
    const T = U.today(), rnd = U.rng(2021);
    const keep = new Set(PEOPLE.map((_, i) => 'e' + (i + 1)));

    // ---------- Company and people ----------
    const s = base.settings;
    Object.assign(s, { company: COMPANY, domain: DOMAIN, office: 'Kuala Lumpur' });
    Object.assign(s.checkin, { label: published.label, lat: published.lat, lng: published.lng, radius: published.radius, field: [], setAt: published.at });
    s.employer = { ...s.employer, ssm: '000000000000 (DEMO ONLY)', address: '12, Jalan Telawi 3, Bangsar Baru, 59100 Kuala Lumpur', phone: '+60 3-0000 0000', signatory: 'Nur Banafsha binti Kamal', signatoryTitle: 'Founder & Owner' };
    const departments = [
      { id: 'd-mgmt', name: 'Management', lead: 'e1', color: '#4B2E83', about: 'Runs the café.', duties: 'Menu, Suppliers, Approvals' },
      { id: 'd-foh', name: 'Front of house', lead: 'e2', color: '#0F766E', about: 'Coffee bar, the till and the tables.', duties: 'Orders, Coffee, Service, Cash' },
      { id: 'd-kitchen', name: 'Kitchen', lead: 'e5', color: '#B8914A', about: 'Breakfast, lunch and pastry.', duties: 'Prep, Cooking, Hygiene, Stock' },
      { id: 'd-admin', name: 'Accounts & HR', lead: 'e10', color: '#7A62C9', about: 'Payroll, the books and purchasing.', duties: 'HR, Payroll, Bills' },
    ];
    s.leave.chains = { 'd-mgmt': { l1: 'e1', l1b: '', l2: '', l2b: '' }, 'd-foh': { l1: 'e2', l1b: 'e1', l2: '', l2b: '' }, 'd-kitchen': { l1: 'e5', l1b: 'e2', l2: '', l2b: '' }, 'd-admin': { l1: 'e1', l1b: '', l2: '', l2b: '' } };
    s.leave.hr = 'e10'; s.leave.hrBackup = 'e1';
    s.time.patterns = [
      { id: 'p-am', name: 'Morning (café)', start: '07:00', end: '16:00', breakMin: 60, grace: 5, days: [1, 2, 3, 4, 5, 6], flexible: false, color: '#0F766E' },
      { id: 'p-office', name: 'Office hours', start: '09:00', end: '18:00', breakMin: 60, grace: 10, days: [1, 2, 3, 4, 5], flexible: false, color: '#7A62C9' },
    ];
    s.time.deptPattern = { 'd-mgmt': 'p-office', 'd-foh': 'p-am', 'd-kitchen': 'p-am', 'd-admin': 'p-office' };
    s.time.minStaff = { 'd-foh': 3, 'd-kitchen': 2 };
    const employees = base.employees.filter((e) => keep.has(e.id)).map((e, i) => {
      const [first, last, role, dept, monthly, start, gender, married] = PEOPLE[i];
      return { ...e, first, last, role, dept, salary: monthly * 12, start, gender, married, location: 'Kuala Lumpur', type: i === 0 ? 'Owner' : 'Full-time', timePattern: '',
        email: `${HANDLES[i]}@${DOMAIN}`, personalEmail: `${HANDLES[i].replace('.', '')}@gmail.com`, address: `No. ${8 + i * 3}, Jalan ${['Telawi', 'Maarof', 'Bangsar', 'Riong', 'Ara'][i % 5]} ${1 + (i % 6)}, 59100 Kuala Lumpur`,
        career: [{ id: `cr-e${i + 1}`, date: start, type: 'joined', to: role, note: departments.find((d) => d.id === dept).name }] };
    });
    employees.forEach((e) => { const d = departments.find((x) => x.id === e.dept); e.manager = d.lead === e.id ? (e.id === 'e1' ? '' : 'e1') : d.lead; });
    const accounts = PEOPLE.map(([first, last, , , , , , , hash, posRole], i) => {
      const a = { email: `${HANDLES[i]}@${DOMAIN}`, name: `${first} ${last}`, hash, roles: ['employee'], tenantId: 't1', empId: 'e' + (i + 1) };
      if (i === 0) a.roles = ['admin', 'employee'];                                                         // Owner: everything
      if (i === 1) Object.assign(a, { roles: ['admin', 'employee'], perms: ['pos', 'operations', 'time'] });  // Outlet manager
      if (i === 9) Object.assign(a, { roles: ['admin', 'employee'], perms: ['people', 'time', 'payroll', 'claims', 'finance', 'settings'] });
      if (posRole) a.posRole = posRole;
      if (posRole === 'manager') a.posPin = U.sha256js(`pos-pin:${a.empId}:${MANAGER_PIN}`);
      return a;
    });
    const attendance = Object.fromEntries(Object.entries(base.attendance).map(([d, day]) => [d, Object.fromEntries(Object.entries(day).filter(([id]) => keep.has(id)))]));
    const leaves = base.leaves.filter((l) => keep.has(l.empId)).map((l) => ({ ...l, reason: l.reason.replace(/forklift|lorry/gi, 'work') }));

    // Payroll for the last two months, again for the café's people (no claims in this demo).
    const months = Object.keys(base.payroll), payroll = {};
    months.forEach((mk) => {
      const end = U.monthEnd(mk);
      payroll[mk] = { status: 'Paid', paidOn: U.addDays(end, -1), items: employees.filter((e) => e.type !== 'Owner' && e.start <= end).map((e) => ({ empId: e.id, ...U.payCalc(e.salary, 0, s, e, U.addDays(end, -1), { extra: [] }), extraLines: [] })) };
    });

    // ---------- Stock: ingredients (the Operations stock list) ----------
    const START = U.addDays(T, -15);
    const ops = { items: [], moves: [], pos: [], products: [], batches: [], orders: [], dos: [], machines: [], maint: [], breakdowns: [], licences: [], seq: {} };
    // [id, code, name, unit, opening, reorder, vendor, cost per unit (RM)]
    const ING = [
      ['g-beans', 'BN-01', 'Coffee beans (house blend)', 'kg', 14, 4, 'v-roast', 78], ['g-milk', 'MK-01', 'Fresh milk', 'L', 120, 30, 'v-dairy', 6.9],
      ['g-oat', 'MK-02', 'Oat milk', 'L', 30, 10, 'v-dairy', 14.5], ['g-tea', 'TE-01', 'BOH tea dust', 'kg', 6, 1.5, 'v-dry', 32],
      ['g-choc', 'CH-01', 'Chocolate powder', 'kg', 5, 1.5, 'v-dry', 46], ['g-rice', 'RC-01', 'Rice', 'kg', 40, 10, 'v-dry', 4.2],
      ['g-chicken', 'CK-01', 'Chicken (boneless)', 'kg', 25, 8, 'v-meat', 15.5], ['g-egg', 'EG-01', 'Eggs', 'pcs', 360, 90, 'v-meat', 0.48],
      ['g-sambal', 'SB-01', 'Sambal (house, batch)', 'kg', 8, 3, 'v-dry', 18], ['g-croissant', 'PS-01', 'Croissant (frozen)', 'pcs', 120, 40, 'v-bake', 2.1],
      ['g-bread', 'BR-01', 'Sourdough loaf', 'pcs', 30, 8, 'v-bake', 9.5], ['g-cake', 'PS-02', 'Burnt cheesecake (slice)', 'pcs', 40, 12, 'v-bake', 4.8],
      ['g-cup', 'PK-01', 'Takeaway cups 12 oz', 'pcs', 800, 200, 'v-pack', 0.32],
    ];
    ING.forEach(([id, code, name, unit, opening, reorder, vendorId, lastPrice]) => ops.items.push({ id, code, name, kind: 'ingredient', unit, opening, reorder, vendorId, lastPrice, openingDate: START }));

    // ---------- Finance: suppliers, rent and the opening position ----------
    const fin = AllurusFinance.blank({ taxLabel: 'SST', auditorFirm: '', auditorName: '', auditorEmail: '' });
    fin.openingCash = 85000; fin.openingDate = U.monthKey(START) + '-01';
    fin.budgets = { Payroll: 32000, 'Stock purchases': 28000, Rent: 9500, Utilities: 2200 };
    [['v-roast', 'Kopi Roastery KL (demo)'], ['v-dairy', 'Susu Segar Dairy (demo)'], ['v-dry', 'Borong Kering Bangsar'], ['v-meat', 'Ayam & Telur Segar (demo)'], ['v-bake', 'Roti Artisan Supply (demo)'], ['v-pack', 'Pek Hijau Packaging'], ['v-rent', 'Telawi Properties (demo)']]
      .forEach(([id, name], i) => fin.contacts.push({ id, kind: 'supplier', name, tin: '', idType: 'BRN', idNo: '', sst: 'NA', email: `accounts@${id.slice(2)}.example.my`, phone: `+60 3-${String(2200 + i * 131).slice(-4)} ${String(4100 + i * 293).slice(-4)}`, address: { line1: 'Kuala Lumpur', line2: '', line3: '', city: 'Kuala Lumpur', postcode: '59100', state: '14', country: 'MYS' }, terms: '30', category: id === 'v-rent' ? 'Rent' : 'Stock purchases' }));

    // ---------- Point of sale ----------
    const outlet = {
      id: 'o1', code: 'BKL', name: 'Banafsha Café, Bangsar', address: '12, Jalan Telawi 3, Bangsar Baru, 59100 Kuala Lumpur', phone: '+60 3-0000 0000',
      // Sample settings for the demo: change them in POS → Menu & settings to what applies to your business.
      sstNo: 'W10-0000-00000000 (DEMO)', taxes: { SST6: { rateBp: 600, label: 'Service tax 6%' }, NONE: { rateBp: 0, label: 'No tax' } }, defaultTaxCode: 'SST6',
      serviceCharge: { enabled: true, rateBp: 1000, orderTypes: ['dine_in'], taxCode: 'SST6' },
      methods: ['cash', 'card_external', 'qr_manual', 'ewallet_manual'], discountLimitBp: 1000, deductOn: 'payment', tips: true,
      receiptHeader: 'Banafsha Café · Bangsar', receiptFooter: 'Terima kasih! Follow us @banafsha.cafe (demo)',
      labels: { item: 'Menu item', items: 'Menu' }, sound: true,
    };
    const categories = [['c-coffee', 'Coffee'], ['c-tea', 'Tea & chocolate'], ['c-mains', 'Mains'], ['c-pastry', 'Pastry & cake'], ['c-sets', 'Sets']].map(([id, name], i) => ({ id, name, order: i, active: true }));
    const modifierGroups = [
      { id: 'mg-temp', name: 'Hot or iced', min: 1, max: 1, options: [{ id: 'hot', name: 'Hot', priceDelta: 0 }, { id: 'iced', name: 'Iced', priceDelta: 100, recipe: [{ itemId: 'g-cup', qty: 1 }] }] },
      { id: 'mg-sugar', name: 'Sugar', min: 1, max: 1, options: [{ id: 'normal', name: 'Normal sugar', priceDelta: 0 }, { id: 'less', name: 'Less sugar', priceDelta: 0 }, { id: 'none', name: 'No sugar', priceDelta: 0 }] },
      { id: 'mg-milk', name: 'Milk', min: 0, max: 1, options: [{ id: 'oat', name: 'Oat milk', priceDelta: 200, recipe: [{ itemId: 'g-oat', qty: 0.2 }] }] },
      { id: 'mg-shot', name: 'Add-ons', min: 0, max: 2, options: [{ id: 'shot', name: 'Extra shot', priceDelta: 200, recipe: [{ itemId: 'g-beans', qty: 0.009 }] }, { id: 'syrup', name: 'Vanilla syrup', priceDelta: 150 }] },
      { id: 'mg-spice', name: 'Spice', min: 0, max: 1, options: [{ id: 'mild', name: 'Less spicy', priceDelta: 0 }, { id: 'extra', name: 'Extra sambal', priceDelta: 100, recipe: [{ itemId: 'g-sambal', qty: 0.03 }] }] },
      { id: 'mg-egg', name: 'Egg', min: 0, max: 1, options: [{ id: 'fried', name: 'Add fried egg', priceDelta: 200, recipe: [{ itemId: 'g-egg', qty: 1 }] }] },
    ];
    const bean = (g) => ({ itemId: 'g-beans', qty: g / 1000 });
    // [id, name, price (sen), category, station, modifier groups, recipe, colour]
    const MENU = [
      ['m-espresso', 'Espresso', 800, 'c-coffee', 'bar', ['mg-shot'], [bean(18)]],
      ['m-americano', 'Americano', 1000, 'c-coffee', 'bar', ['mg-temp', 'mg-shot'], [bean(18)]],
      ['m-latte', 'Latte', 1290, 'c-coffee', 'bar', ['mg-temp', 'mg-milk', 'mg-shot'], [bean(18), { itemId: 'g-milk', qty: 0.2 }]],
      ['m-cappuccino', 'Cappuccino', 1290, 'c-coffee', 'bar', ['mg-milk', 'mg-shot'], [bean(18), { itemId: 'g-milk', qty: 0.16 }]],
      ['m-spanish', 'Spanish latte', 1490, 'c-coffee', 'bar', ['mg-temp', 'mg-milk', 'mg-shot'], [bean(18), { itemId: 'g-milk', qty: 0.2 }]],
      ['m-kopi', 'Kopi O kampung', 650, 'c-coffee', 'bar', ['mg-temp', 'mg-sugar'], [bean(12)]],
      ['m-tehtarik', 'Teh tarik', 650, 'c-tea', 'bar', ['mg-temp', 'mg-sugar'], [{ itemId: 'g-tea', qty: 0.012 }, { itemId: 'g-milk', qty: 0.05 }]],
      ['m-choc', 'Chocolate', 1390, 'c-tea', 'bar', ['mg-temp', 'mg-milk'], [{ itemId: 'g-choc', qty: 0.03 }, { itemId: 'g-milk', qty: 0.2 }]],
      ['m-nasilemak', 'Nasi lemak ayam berempah', 1890, 'c-mains', 'kitchen', ['mg-spice', 'mg-egg'], [{ itemId: 'g-rice', qty: 0.15 }, { itemId: 'g-chicken', qty: 0.18 }, { itemId: 'g-sambal', qty: 0.05 }, { itemId: 'g-egg', qty: 0.5 }]],
      ['m-eggs', 'Eggs on sourdough', 2290, 'c-mains', 'kitchen', ['mg-egg'], [{ itemId: 'g-egg', qty: 2 }, { itemId: 'g-bread', qty: 0.15 }]],
      ['m-friedrice', 'Nasi goreng kampung', 1690, 'c-mains', 'kitchen', ['mg-spice', 'mg-egg'], [{ itemId: 'g-rice', qty: 0.2 }, { itemId: 'g-chicken', qty: 0.08 }]],
      ['m-chickenchop', 'Grilled chicken chop', 2690, 'c-mains', 'kitchen', [], [{ itemId: 'g-chicken', qty: 0.25 }]],
      ['m-croissant', 'Butter croissant', 790, 'c-pastry', 'bar', [], [{ itemId: 'g-croissant', qty: 1 }]],
      ['m-cheesecake', 'Burnt cheesecake', 1490, 'c-pastry', 'bar', [], [{ itemId: 'g-cake', qty: 1 }]],
      ['m-water', 'Mineral water', 300, 'c-tea', 'bar', [], [], 'NONE'],
    ];
    const items = MENU.map(([id, name, price, categoryId, station, modifierGroupIds, recipe, taxCode]) => ({ id, name, price, categoryId, station, modifierGroupIds, recipe, taxCode: taxCode || 'SST6', active: true, soldOut: false, photo: '' }));
    const combos = [{ id: 'cb-breakfast', name: 'Breakfast set', price: 1990, categoryId: 'c-sets', station: 'kitchen', taxCode: 'SST6', active: true,
      slots: [{ name: 'Main', choices: ['m-nasilemak', 'm-croissant'] }, { name: 'Drink', choices: ['m-kopi', 'm-tehtarik', 'm-americano'] }] }];
    const tables = [...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'].map((n, i) => ({ id: `tb-${n}`, name: n, section: 'Indoor', seats: i < 4 ? 2 : 4 })), ...['P1', 'P2', 'P3', 'P4'].map((n) => ({ id: `tb-${n}`, name: n, section: 'Patio', seats: 4 }))];
    tables.forEach((t) => { t.status = 'free'; t.currentOrderId = ''; });
    const pos = { outlets: [outlet], categories, modifierGroups, items, combos, tables, orders: [], payments: [], shifts: [], refunds: [], audit: [], seq: {}, queue: 0 };
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const grp = Object.fromEntries(modifierGroups.map((g) => [g.id, g]));

    // ---------- Two weeks of sales ----------
    let on = 0, pn = 0, ln = 0;
    const iso = (d, h, m) => new Date(`${d}T${U.pad(h)}:${U.pad(m)}:00+08:00`).toISOString();
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const randomLine = (hour) => {
      const pool = hour < 11 ? ['m-latte', 'm-americano', 'm-kopi', 'm-tehtarik', 'm-croissant', 'm-nasilemak', 'm-eggs', 'm-cappuccino'] : hour < 15 ? ['m-nasilemak', 'm-friedrice', 'm-chickenchop', 'm-latte', 'm-spanish', 'm-tehtarik', 'm-water', 'm-choc'] : ['m-latte', 'm-spanish', 'm-cheesecake', 'm-choc', 'm-croissant', 'm-americano'];
      const mi = byId[pick(pool)];
      const modifiers = [];
      mi.modifierGroupIds.forEach((g) => { const G = grp[g]; if (G.min || rnd() < 0.25) { const o = G.min ? G.options[Math.floor(rnd() * G.options.length)] : pick(G.options); modifiers.push({ groupId: g, id: o.id, name: o.name, priceDelta: o.priceDelta, ...(o.recipe ? { recipe: o.recipe } : {}) }); } });
      return { id: `l${++ln}`, itemId: mi.id, name: mi.name, qty: rnd() < 0.15 ? 2 : 1, unitPrice: mi.price, modifiers, taxCode: mi.taxCode, station: mi.station, status: 'served', note: '' };
    };
    const cashiers = ['e3', 'e4'];
    const sell = (day, h, m, shiftId, opts = {}) => {
      const type = opts.type || (rnd() < 0.55 ? 'dine_in' : 'takeaway');
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => randomLine(h));
      const o = { id: `po${++on}`, clientOrderId: `seed-${on}`, outletId: 'o1', type, tableId: type === 'dine_in' ? pick(tables).id : '', queueNo: type === 'takeaway' ? ++pos.queue : null, status: 'paid', lines,
        discountRule: rnd() < 0.06 ? { kind: 'pct', value: 1000, reason: 'Staff or regular' } : null, createdBy: opts.cashier || pick(cashiers), createdAt: iso(day, h, m), sentAt: iso(day, h, m), note: '' };
      Object.assign(o, P.totals(o, outlet));
      delete o.lineNet;
      const method = rnd() < 0.42 ? 'cash' : rnd() < 0.55 ? 'qr_manual' : rnd() < 0.7 ? 'card_external' : 'ewallet_manual';
      const at = iso(day, h, Math.min(59, m + 20 + Math.floor(rnd() * 25)));
      let pay;
      if (method === 'cash') {
        const tendered = Math.ceil(P.roundCash(o.total) / 1000) * 1000, c = P.cashApply(o.total, tendered);
        pay = { method, amount: c.amount, tendered, change: c.change }; o.rounding = c.rounding;
      } else { pay = { method, amount: o.total, approvalCode: method === 'card_external' ? String(300000 + Math.floor(rnd() * 600000)) : '', cardLast4: method === 'card_external' ? String(1000 + Math.floor(rnd() * 8999)) : '', cardBrand: method === 'card_external' ? pick(['Visa', 'Mastercard', 'MyDebit']) : '', qrReference: method !== 'card_external' ? `DN${Math.floor(rnd() * 1e8)}` : '', reconcile: true, manual: true }; o.rounding = 0; }
      if (method !== 'cash' && rnd() < 0.08) pay.tip = 200;
      pos.payments.push({ id: `pp${++pn}`, orderId: o.id, outletId: 'o1', shiftId, status: 'approved', provider: method === 'cash' ? 'cash' : 'recorded', idempotencyKey: `seed-p${pn}`, createdAt: at, createdBy: o.createdBy, ...pay });
      o.paidAt = at; o.receiptNo = P.nextReceiptNo(pos.seq, outlet.code);
      pos.orders.push(o);
      P.addMoves(ops.moves, P.stockMoves(o, byId, 'sale', day));
      return o;
    };
    let sn = 0;
    const days = []; for (let d = START; d < T; d = U.addDays(d, 1)) if (U.parse(d).getDay() !== 0) days.push(d);
    days.forEach((day, k) => {
      const cashier = cashiers[k % 2], sh = { id: `sh${++sn}`, outletId: 'o1', cashierUid: cashier, openedAt: iso(day, 7, 0), openingCash: 30000, cashMoves: [] };
      if (k % 4 === 1) sh.cashMoves.push({ kind: 'out', amount: 2500, reason: 'Ice from the shop next door', at: iso(day, 11, 20), by: cashier });
      const n = 34 + Math.floor(rnd() * 22);
      for (let i = 0; i < n; i++) { const h = 7 + Math.floor(rnd() * 9); sell(day, h, Math.floor(rnd() * 40), sh.id, { cashier }); }
      // A void most days: an order keyed by mistake.
      if (k % 3 === 0) {
        const v = sell(day, 12, 10, sh.id, { cashier });
        v.status = 'void'; v.voidedAt = iso(day, 12, 40); v.voidReason = 'Customer changed their mind'; v.voidedBy = 'e2';
        pos.payments.filter((p) => p.orderId === v.id).forEach((p) => { p.status = 'refunded'; });
        pos.refunds.push({ id: `rf${pos.refunds.length + 1}`, orderId: v.id, paymentId: pos.payments.find((p) => p.orderId === v.id).id, shiftId: sh.id, method: pos.payments.find((p) => p.orderId === v.id).method, amount: pos.payments.find((p) => p.orderId === v.id).amount, reason: v.voidReason, approvedBy: 'e2', status: 'approved', at: v.voidedAt });
        P.addMoves(ops.moves, P.stockMoves(v, byId, 'void', day));
        pos.audit.push({ id: `au${pos.audit.length + 1}`, at: v.voidedAt, by: 'e2', action: 'void', ref: v.receiptNo, detail: v.voidReason });
      }
      const sum = P.shiftSummary(sh, pos.payments, pos.refunds);
      sh.closedAt = iso(day, 16, 15); sh.expectedCash = sum.expectedCash;
      sh.countedCash = sum.expectedCash + (k % 5 === 2 ? -500 : k % 7 === 3 ? 300 : 0);
      sh.variance = sh.countedCash - sh.expectedCash; sh.closedBy = cashier;
      pos.shifts.push(sh);
    });
    // Every day before yesterday is already in the books; yesterday waits for "Post to Finance".
    days.filter((d) => d < U.addDays(T, -1)).forEach((d) => P.financeEntries(P.daySales(pos.orders, pos.payments, d)).forEach((e, i) => fin.txns.push({ id: `xpos-${d}-${i}`, reconciled: false, ...e })));
    // Supplies bought over the fortnight, as paid bills, and the rent.
    ING.forEach(([id, , name, unit, , , vendorId, cost], i) => {
      const used = -ops.moves.filter((m) => m.itemId === id).reduce((a, m) => a + m.qty, 0);
      const it = ops.items.find((x) => x.id === id);
      if (used > it.opening * 0.5) {
        const qty = Math.ceil(used * 0.8), d = U.addDays(START, 6 + (i % 5));
        ops.moves.push({ id: `rcv-${id}`, itemId: id, date: d, qty, ref: `GRN-${id}`, note: 'Goods received' });
        fin.bills.push({ id: `b-${id}`, supplier: fin.contacts.find((c) => c.id === vendorId).name, contactId: vendorId, ref: `INV-${id.slice(2).toUpperCase()}`, category: 'Stock purchases', issue: d, due: U.addDays(d, 30), amount: Math.round(qty * cost * 100) / 100, tax: 0, status: 'Paid', paidOn: U.addDays(d, 3), note: `${qty} ${unit} ${name.toLowerCase()}` });
      }
    });
    fin.bills.push({ id: 'b-rent', supplier: 'Telawi Properties (demo)', contactId: 'v-rent', ref: `RENT-${U.monthKey(T)}`, category: 'Rent', issue: `${U.monthKey(T)}-01`, due: `${U.monthKey(T)}-07`, amount: 9500, tax: 0, status: 'Paid', paidOn: `${U.monthKey(T)}-05`, note: 'Shop lot rent' });
    // Oat milk is running low for the walkthrough.
    ops.moves.push({ id: 'mv-oat-spill', itemId: 'g-oat', date: U.addDays(T, -1), qty: -Math.max(0, ops.items.find((x) => x.id === 'g-oat').opening + ops.moves.filter((m) => m.itemId === 'g-oat').reduce((a, m) => a + m.qty, 0) - 6), ref: 'WASTE', note: 'Wastage: a carton past its date' });

    // ---------- Today: the lunch rush ----------
    const today = { id: `sh${++sn}`, outletId: 'o1', cashierUid: 'e3', openedAt: iso(T, 7, 0), openingCash: 30000, cashMoves: [] };
    pos.shifts.push(today);
    for (let i = 0; i < 18; i++) sell(T, 7 + Math.floor(i / 4), (i * 13) % 50, today.id, { cashier: 'e3' });
    const open = (tableId, lineSpecs, status, minsAgo) => {
      const at = new Date(Date.now() - minsAgo * 60e3).toISOString();
      const lines = lineSpecs.map(([itemId, mods = [], st = 'new']) => { const mi = byId[itemId]; return { id: `l${++ln}`, itemId, name: mi.name, qty: 1, unitPrice: mi.price, modifiers: mods.map(([g, o]) => { const opt = grp[g].options.find((x) => x.id === o); return { groupId: g, id: o, name: opt.name, priceDelta: opt.priceDelta, ...(opt.recipe ? { recipe: opt.recipe } : {}) }; }), taxCode: mi.taxCode, station: mi.station, status: st, note: '', sentAt: status === 'sent' ? at : '' }; });
      const o = { id: `po${++on}`, clientOrderId: `seed-${on}`, outletId: 'o1', type: tableId ? 'dine_in' : 'takeaway', tableId, queueNo: tableId ? null : ++pos.queue, status, lines, discountRule: null, createdBy: 'e7', createdAt: at, sentAt: status === 'sent' ? at : '', note: '' };
      Object.assign(o, P.totals(o, outlet)); delete o.lineNet;
      pos.orders.push(o);
      if (tableId) Object.assign(tables.find((t) => t.id === tableId), { status: 'occupied', currentOrderId: o.id });
      return o;
    };
    open('tb-T3', [['m-nasilemak', [['mg-spice', 'extra'], ['mg-egg', 'fried']], 'preparing'], ['m-friedrice', [], 'preparing'], ['m-latte', [['mg-temp', 'iced'], ['mg-milk', 'oat']], 'ready'], ['m-tehtarik', [['mg-temp', 'hot'], ['mg-sugar', 'less']], 'ready']], 'sent', 14);
    open('tb-P2', [['m-chickenchop', [], 'new'], ['m-spanish', [['mg-temp', 'iced']], 'new']], 'sent', 3);
    open('tb-T6', [['m-eggs'], ['m-americano', [['mg-temp', 'hot']]]], 'open', 1);
    const bill = open('tb-T1', [['m-cheesecake', [], 'served'], ['m-cappuccino', [], 'served']], 'sent', 35);
    Object.assign(tables.find((t) => t.id === bill.tableId), { status: 'billing' });

    // ---------- What's left of the base ----------
    const now = Date.now();
    return {
      ...base, demoCompany: 'banafsha', session: { account: null, roles: [], role: null, empId: 'e3', tenantId: 't1' }, accounts,
      settings: s, departments, employees, attendance, leaves, payroll, claims: [], documents: [], assets: [], announcements: [], notifications: [], outbox: [],
      statutory: { filed: Object.fromEntries(months.map((mk) => [mk, { epf: `${U.addMonths(mk, 1)}-10`, socso: `${U.addMonths(mk, 1)}-10`, pcb: `${U.addMonths(mk, 1)}-10`, hrdf: `${U.addMonths(mk, 1)}-10` }]).filter(([, v]) => v.epf <= T)), eaIssued: {}, formEFiled: {} },
      finance: fin, ops, pos,
      activity: [{ t: now - 60e3 * 12, text: 'Table T3 sent 4 items to the kitchen' }, { t: now - 60e3 * 60 * 20, text: 'Yesterday’s shift closed by Priya' }],
      platform: AllurusSeed.platform(employees.length, { row: [COMPANY, 'Kuala Lumpur', 'F&B and restaurants', 'Malaysia', 'growth', employees.length, 'Active', 98], admin: `nur.banafsha@${DOMAIN}` }),
    };
  }

  AllurusSeed.companies.banafsha = {
    id: 'banafsha', name: COMPANY, short: 'Banafsha Café', blurb: 'Café and kitchen with a point of sale, Bangsar', storeKey: 'allurus-hr-banafsha-v1', published, create,
    logins: [
      [`nur.banafsha@${DOMAIN}`, 'Owner', 'Nur Banafsha · everything, sales and the books'],
      [`siti.hajar@${DOMAIN}`, 'Outlet manager', 'Siti · the till, menu, voids and reports'],
      [`aiman.zulkifli@${DOMAIN}`, 'Cashier', 'Aiman · takes orders and payments'],
      [`rahim.musa@${DOMAIN}`, 'Kitchen', 'Chef Rahim · the kitchen display'],
    ],
  };
})();
