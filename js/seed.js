// Demo workspace. Dates are generated relative to today so the data always looks current.
window.AllurusSeed = {
  create() {
    const r = U.rng(42);
    const T = U.today();
    // Check-in zone: employees must be inside this circle (radius in meters) and take a selfie.
    const checkin = { label: 'Allurus HQ', lat: 3.769833, lng: 103.224556, radius: 50, remote: false };
    const settings = { company: 'Allurus', domain: 'allurus.com', currency: 'USD', office: 'Kuantan', checkin, taxRate: 20, benefitsRate: 4.5, annualDays: 20, sickDays: 10, theme: 'system' };

    const departments = [
      { id: 'd-people', name: 'People', lead: 'e1', color: '#14958A' },
      { id: 'd-eng', name: 'Engineering', lead: 'e4', color: '#4A6FD1' },
      { id: 'd-design', name: 'Design', lead: 'e3', color: '#B8914A' },
      { id: 'd-sales', name: 'Sales', lead: 'e14', color: '#C2577A' },
      { id: 'd-mkt', name: 'Marketing', lead: 'e9', color: '#7A62C9' },
      { id: 'd-fin', name: 'Finance', lead: 'e11', color: '#5E8C3A' },
    ];

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
    employees[0].manager = '';
    employees[0].email = 'admin@allurus.com';
    employees[1].email = 'emp@allurus.com';
    employees.forEach((e) => { if (e.location !== 'Remote') e.location = 'Kuantan'; });

    const leaves = [
      { empId: 'e5', type: 'Annual', from: U.addDays(T, -1), to: U.addDays(T, 3), reason: 'Family trip', status: 'Approved' },
      { empId: 'e9', type: 'Annual', from: U.addDays(T, 7), to: U.addDays(T, 11), reason: 'Holiday in Lisbon', status: 'Pending' },
      { empId: 'e8', type: 'Sick', from: U.addDays(T, 1), to: U.addDays(T, 1), reason: 'Dentist appointment', status: 'Pending' },
      { empId: 'e13', type: 'Personal', from: U.addDays(T, 14), to: U.addDays(T, 15), reason: 'Moving apartments', status: 'Pending' },
      { empId: 'e6', type: 'Annual', from: U.addDays(T, -20), to: U.addDays(T, -16), reason: 'Vacation', status: 'Approved' },
      { empId: 'e17', type: 'Sick', from: U.addDays(T, -9), to: U.addDays(T, -9), reason: 'Flu', status: 'Approved' },
      { empId: 'e10', type: 'Annual', from: U.addDays(T, -40), to: U.addDays(T, -38), reason: 'Long weekend', status: 'Rejected' },
    ].map((l, i) => ({ id: 'l' + (i + 1), days: U.workdaysBetween(l.from, l.to), created: U.addDays(l.from, -10), ...l }));

    const attendance = {};
    for (let k = -30; k <= 0; k++) {
      const day = U.addDays(T, k);
      if (U.isWeekend(day)) continue;
      attendance[day] = {};
      employees.forEach((e) => {
        if (e.start > day) return;
        // Leave today empty for people who can sign in (Amara and Daniel), so they can try checking in themselves.
        if (k === 0 && (e.id === 'e1' || e.id === 'e2')) return;
        const x = r();
        const s = x < 0.8 ? 'present' : x < 0.93 ? 'remote' : x < 0.98 ? 'absent' : 'present';
        const mins = 8 * 60 + 25 + Math.floor(r() * 60);
        attendance[day][e.id] = { s, in: s === 'absent' ? '' : `${U.pad(Math.floor(mins / 60))}:${U.pad(mins % 60)}` };
      });
    }
    leaves.filter((l) => l.status === 'Approved').forEach((l) => {
      for (let d = l.from; d <= l.to; d = U.addDays(d, 1)) {
        if (attendance[d]) attendance[d][l.empId] = { s: 'leave', in: '' };
      }
    });

    const payroll = {};
    const thisMonth = U.monthKey(T);
    for (let k = 6; k >= 1; k--) {
      const mk = U.addMonths(thisMonth, -k);
      const end = U.monthEnd(mk);
      const items = employees.filter((e) => e.start <= end).map((e, i) => ({
        empId: e.id, ...U.payCalc(e.salary, (k === 3 && i % 4 === 0) ? 1500 : 0, settings),
      }));
      payroll[mk] = { status: 'Paid', paidOn: U.addDays(end, -2), items };
    }

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
      { email: 'superadmin@allurus.com', name: 'Allurus HQ', hash: 'f1cf377d5d77bcc3a12af1c4516fb4b6d20797dc369593edf0668aee2926cef9', roles: ['super', 'admin', 'employee'], tenantId: 't1', empId: 'e2' },
      { email: 'admin@allurus.com', name: 'Amara Okafor', hash: '02333a94bab39ec8b56cd57a87830ed79f29237de26eccaf9e724305ede5cbd9', roles: ['admin', 'employee'], tenantId: 't1', empId: 'e1' },
      { email: 'emp@allurus.com', name: 'Daniel Reyes', hash: '3d18388e7dd6f616a46254f4c8eb14b0aaeca178e246cd9832d4785daa11b7c9', roles: ['employee'], tenantId: 't1', empId: 'e2' },
    ];
    return { version: 3, session, accounts, workspaces: {}, settings, departments, employees, leaves, attendance, payroll, jobs, candidates, reviews, activity, platform };
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
