// HR reports: a library of ready reports (people, pay, time, leave, claims, dates due), each with date, department
// and employee filters, a table, a chart and CSV or print export, plus a custom report writer whose definitions
// are saved for reuse. The aggregations live in js/report-rules.js (AllurusReportRules).
window.AllurusReports = (function () {
  'use strict';
  const R = window.AllurusReportRules;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const T = () => U.today();
  const emp = (id) => ctx.emp(id);
  const deptName = (id) => ctx.dept(id)?.name || 'No department';
  const fmt = (d) => (d ? U.fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const mlabel = (mk) => U.fmtMonth(mk, { month: 'short', year: 'numeric' });
  const saved = () => (st().savedReports = st().savedReports || []);
  const ui = { id: 'headcount', view: '', from: '', to: '', dept: 'all', emp: 'all', custom: null };

  // ---------- Filters ----------
  const defaults = (r) => (r.future ? { from: T(), to: U.addDays(T(), r.future) } : r.past ? { from: U.addDays(T(), -r.past), to: U.addDays(T(), 60) } : { from: `${U.addMonths(U.monthKey(T()), -5)}-01`, to: T() });
  function filters() {
    const r = report();
    if (!ui.from) Object.assign(ui, defaults(r));
    return ui;
  }
  const people = (f) => st().employees.filter((e) => (f.dept === 'all' || e.dept === f.dept) && (f.emp === 'all' || e.id === f.emp));
  const pickItem = (f) => (it) => { const e = emp(it.empId); return (f.dept === 'all' || e?.dept === f.dept) && (f.emp === 'all' || it.empId === f.emp); };
  const mksIn = (f) => R.months(f.from, f.to);

  // ---------- The library ----------
  const col = (key, label, type = 'text') => ({ key, label, type });
  const LIB = [
    { id: 'headcount', group: 'People', name: 'Headcount by department', desc: 'People employed on the end date, with joiners and leavers in the period.', filters: ['range', 'dept'],
      run(f) {
        const all = st().employees.filter((e) => f.dept === 'all' || e.dept === f.dept), jl = R.joinersLeavers(all, f.from, f.to);
        const h = R.headcount(all, f.to, st().departments);
        const rows = h.rows.map((r) => ({ dept: r.name, count: r.count, joiners: jl.joiners.filter((e) => (e.dept || '') === r.id).length, leavers: jl.leavers.filter((e) => (e.dept || '') === r.id).length, share: h.total ? R.r2((r.count / h.total) * 100) : 0 }));
        return { columns: [col('dept', 'Department'), col('count', `Headcount on ${fmt(f.to)}`, 'number'), col('joiners', 'Joiners', 'number'), col('leavers', 'Leavers', 'number'), col('share', 'Share', 'pct')], rows, totals: { count: h.total, joiners: jl.joiners.length, leavers: jl.leavers.length, share: 100 },
          chart: { kind: 'hbars', label: 'dept', value: 'count' }, kpis: [['Headcount', h.total], ['Joiners', jl.joiners.length], ['Leavers', jl.leavers.length]] };
      } },
    { id: 'movers', group: 'People', name: 'Joiners and leavers', desc: 'Everyone who started or left in the period.', filters: ['range', 'dept'],
      run(f) {
        const all = st().employees.filter((e) => f.dept === 'all' || e.dept === f.dept), jl = R.joinersLeavers(all, f.from, f.to);
        const rows = [...jl.joiners.map((e) => ({ kind: 'Joiner', date: e.start, name: ctx.fullName(e), dept: deptName(e.dept), role: e.role, reason: '' })), ...jl.leavers.map((e) => ({ kind: 'Leaver', date: e.endDate, name: ctx.fullName(e), dept: deptName(e.dept), role: e.role, reason: AllurusStatutory.REASONS[e.leaveReason] || '' }))].sort((a, b) => a.date.localeCompare(b.date));
        const series = mksIn(f).map((mk) => ({ month: mlabel(mk), joiners: jl.joiners.filter((e) => e.start.startsWith(mk)).length, leavers: jl.leavers.filter((e) => e.endDate.startsWith(mk)).length }));
        return { columns: [col('date', 'Date', 'date'), col('kind', 'Joiner or leaver'), col('name', 'Employee'), col('dept', 'Department'), col('role', 'Job title'), col('reason', 'Reason')], rows,
          chart: { kind: 'bars', data: series, label: 'month', series: [['joiners', 'Joiners', 'b-present'], ['leavers', 'Leavers', 'b-remote']] }, kpis: [['Joiners', jl.joiners.length], ['Leavers', jl.leavers.length], ['Net change', jl.joiners.length - jl.leavers.length]] };
      } },
    { id: 'turnover', group: 'People', name: 'Turnover rate', desc: 'Leavers ÷ average headcount, month by month and for the whole period.', filters: ['range', 'dept'],
      run(f) {
        const all = st().employees.filter((e) => f.dept === 'all' || e.dept === f.dept), t = R.turnover(all, f.from, f.to);
        const rows = R.turnoverByMonth(all, f.from, f.to).map((m) => ({ month: m.month, start: m.start, end: m.end, avg: m.avg, leavers: m.leavers, rate: m.rate }));
        return { columns: [col('month', 'Month', 'month'), col('start', 'Headcount at start', 'number'), col('end', 'At end', 'number'), col('avg', 'Average', 'number'), col('leavers', 'Leavers', 'number'), col('rate', 'Turnover', 'pct')], rows,
          chart: { kind: 'bars', label: 'month', value: 'rate', pct: true }, kpis: [['Turnover in the period', `${t.rate}%`], ['Annualised', `${t.annualised}%`], ['Leavers', t.leavers]],
          note: 'Average headcount is the mean of the headcount at the start and end of each period.' };
      } },
    { id: 'payroll', group: 'Pay', name: 'Payroll summary and variance', desc: 'Gross, deductions, net and employer cost by month, with the change from the month before.', filters: ['range', 'dept', 'emp'],
      run(f) {
        const rows = R.payrollByMonth(st().payroll, mksIn(f), pickItem(f)).map((r) => ({ month: r.month, people: r.people, gross: r.gross, deductions: r.deductions, net: r.net, employer: r.employer, cost: r.cost, change: r.change.gross, changePct: r.change.grossPct }));
        const tot = (k) => R.sum(rows, (r) => r[k]);
        return { columns: [col('month', 'Month', 'month'), col('people', 'People', 'number'), col('gross', 'Gross', 'money'), col('deductions', 'Deductions', 'money'), col('net', 'Net', 'money'), col('employer', 'Employer contributions', 'money'), col('cost', 'Employer cost', 'money'), col('change', 'Gross change', 'delta'), col('changePct', 'Change %', 'deltaPct')], rows,
          totals: { gross: tot('gross'), deductions: tot('deductions'), net: tot('net'), employer: tot('employer'), cost: tot('cost') }, chart: { kind: 'bars', label: 'month', value: 'gross', money: true },
          kpis: rows.length ? [['Gross in the period', ctx.money(tot('gross'))], ['Employer cost', ctx.money(tot('cost'))], ['Last change', rows[rows.length - 1].changePct == null ? '—' : `${rows[rows.length - 1].changePct > 0 ? '+' : ''}${rows[rows.length - 1].changePct}%`]] : [], empty: 'No payroll runs in this period.' };
      } },
    { id: 'statutory', group: 'Pay', name: 'Statutory contributions', desc: 'EPF, SOCSO, EIS, PCB, zakat and HRD levy by month, employee and employer shares.', filters: ['range', 'dept', 'emp'],
      run(f) {
        const rows = R.statutoryByMonth(st().payroll, mksIn(f), pickItem(f));
        const keys = ['epfEe', 'epfEr', 'socsoEe', 'socsoEr', 'eisEe', 'eisEr', 'pcb', 'zakat', 'hrdf', 'total'];
        return { columns: [col('month', 'Month', 'month'), col('people', 'People', 'number'), col('epfEe', 'EPF employee', 'money'), col('epfEr', 'EPF employer', 'money'), col('socsoEe', 'SOCSO employee', 'money'), col('socsoEr', 'SOCSO employer', 'money'), col('eisEe', 'EIS employee', 'money'), col('eisEr', 'EIS employer', 'money'), col('pcb', 'PCB', 'money'), col('zakat', 'Zakat', 'money'), col('hrdf', 'HRD levy', 'money'), col('total', 'Total to pay', 'money')], rows,
          totals: Object.fromEntries(keys.map((k) => [k, R.sum(rows, (r) => r[k])])), chart: { kind: 'bars', label: 'month', value: 'total', money: true }, empty: 'No payroll runs in this period.',
          note: 'From approved and draft pay runs. Check against the KWSP, PERKESO and LHDN statements before paying.' };
      } },
    { id: 'ot', group: 'Time', name: 'Overtime by person and department', desc: 'Paid overtime hours and pay from attendance, after the monthly limits.', filters: ['range', 'dept', 'emp'], views: [['person', 'By person'], ['department', 'By department']],
      run(f) {
        const out = [];
        people(f).filter((e) => e.status !== 'Inactive' || e.endDate).forEach((e) => mksIn(f).forEach((mk) => {
          if (`${mk}-01` > T() || e.start > U.monthEnd(mk)) return;
          const m = ctx.time.monthFor(e, mk);
          if (m.paidMin || m.pay.amount) out.push({ empId: e.id, name: ctx.fullName(e), dept: deptName(e.dept), month: mk, hours: R.r2(m.paidMin / 60), amount: m.pay.amount });
        }));
        const byPerson = R.groupSum(out, (r) => r.empId, ['hours', 'amount']).map((g) => { const e = emp(g.key); return { name: ctx.fullName(e), dept: deptName(e.dept), months: g.count, hours: g.hours, amount: g.amount }; });
        const byDept = R.groupSum(out, (r) => r.dept, ['hours', 'amount']).map((g) => ({ dept: g.key, people: new Set(out.filter((x) => x.dept === g.key).map((x) => x.empId)).size, hours: g.hours, amount: g.amount }));
        const dept = ui.view === 'department';
        const rows = (dept ? byDept : byPerson).sort((a, b) => b.hours - a.hours);
        return { columns: dept ? [col('dept', 'Department'), col('people', 'People', 'number'), col('hours', 'OT hours', 'number'), col('amount', 'OT pay', 'money')] : [col('name', 'Employee'), col('dept', 'Department'), col('hours', 'OT hours', 'number'), col('amount', 'OT pay', 'money')], rows,
          totals: { hours: R.sum(rows, (r) => r.hours), amount: R.sum(rows, (r) => r.amount) }, chart: { kind: 'hbars', label: dept ? 'dept' : 'name', value: 'hours', unit: 'h' }, empty: 'No overtime in this period.',
          note: 'Worked out from check-ins and approved overtime with the overtime rules in Settings, so it covers the months with attendance records.' };
      } },
    { id: 'lateness', group: 'Time', name: 'Lateness and absenteeism', desc: 'Late days and minutes, early-outs and absences from attendance records.', filters: ['range', 'dept', 'emp'], views: [['person', 'By person'], ['department', 'By department']],
      run(f) {
        const days = Object.keys(st().attendance).filter((d) => d >= f.from && d <= f.to && d <= T()).sort();
        const rows = people(f).map((e) => {
          let rec = 0, late = 0, lateMin = 0, absent = 0, early = 0;
          days.forEach((d) => {
            const r = st().attendance[d]?.[e.id]; if (!r || r.s === 'leave') return;
            rec++;
            if (r.s === 'absent') { absent++; return; }
            const x = ctx.time.dayInfo(e, d);
            if (x.ev.late) { late++; lateMin += x.ev.late; }
            if (x.ev.early) early++;
          });
          return { empId: e.id, name: ctx.fullName(e), dept: deptName(e.dept), days: rec, late, lateMin, early, absent, rate: rec ? R.r2((absent / rec) * 100) : 0 };
        }).filter((r) => r.days);
        if (ui.view === 'department') {
          const g = R.groupSum(rows, (r) => r.dept, ['days', 'late', 'lateMin', 'early', 'absent']).map((x) => ({ dept: x.key, people: x.count, days: x.days, late: x.late, lateMin: x.lateMin, early: x.early, absent: x.absent, rate: x.days ? R.r2((x.absent / x.days) * 100) : 0 }));
          return { columns: [col('dept', 'Department'), col('people', 'People', 'number'), col('days', 'Days recorded', 'number'), col('late', 'Late days', 'number'), col('lateMin', 'Late minutes', 'number'), col('early', 'Early-outs', 'number'), col('absent', 'Absent days', 'number'), col('rate', 'Absence rate', 'pct')], rows: g.sort((a, b) => b.lateMin - a.lateMin), chart: { kind: 'hbars', label: 'dept', value: 'late', unit: ' late days' } };
        }
        return { columns: [col('name', 'Employee'), col('dept', 'Department'), col('days', 'Days recorded', 'number'), col('late', 'Late days', 'number'), col('lateMin', 'Late minutes', 'number'), col('early', 'Early-outs', 'number'), col('absent', 'Absent days', 'number'), col('rate', 'Absence rate', 'pct')], rows: rows.sort((a, b) => b.lateMin - a.lateMin),
          totals: { days: R.sum(rows, (r) => r.days), late: R.sum(rows, (r) => r.late), lateMin: R.sum(rows, (r) => r.lateMin), early: R.sum(rows, (r) => r.early), absent: R.sum(rows, (r) => r.absent) }, chart: { kind: 'hbars', label: 'name', value: 'lateMin', unit: ' min' }, empty: 'No attendance records in this period.',
          note: 'Lateness counts once past the shift’s grace minutes; waived lateness is not counted. Days on leave are left out.' };
      } },
    { id: 'leave', group: 'Time', name: 'Leave taken and balances', desc: 'Approved leave days taken in the period by type, with this year’s annual leave balance.', filters: ['range', 'dept', 'emp'], views: [['person', 'By person'], ['type', 'By leave type']],
      run(f) {
        const ids = new Set(people(f).map((e) => e.id));
        const ls = st().leaves.filter((l) => l.status === 'Approved' && ids.has(l.empId) && l.from <= f.to && l.to >= f.from);
        if (ui.view === 'type') {
          const g = R.groupSum(ls, (l) => l.type, ['days']).map((x) => ({ type: ctx.leave.typeName(x.key), requests: x.count, people: new Set(ls.filter((l) => l.type === x.key).map((l) => l.empId)).size, days: x.days })).sort((a, b) => b.days - a.days);
          return { columns: [col('type', 'Leave type'), col('requests', 'Requests', 'number'), col('people', 'People', 'number'), col('days', 'Days', 'number')], rows: g, totals: { requests: ls.length, days: R.sum(g, (r) => r.days) }, chart: { kind: 'hbars', label: 'type', value: 'days', unit: ' days' } };
        }
        const types = [...new Set(ls.map((l) => l.type))];
        const rows = people(f).filter((e) => e.status !== 'Inactive').map((e) => {
          const b = ctx.leave.balance(e.id, 'annual'), mine = ls.filter((l) => l.empId === e.id);
          return { name: ctx.fullName(e), dept: deptName(e.dept), ...Object.fromEntries(types.map((t) => [t, R.sum(mine.filter((l) => l.type === t), (l) => l.days)])), taken: R.sum(mine, (l) => l.days), entitled: R.r2(b.entitled + b.carried - b.lapsed), used: b.used, left: b.available };
        });
        return { columns: [col('name', 'Employee'), col('dept', 'Department'), ...types.map((t) => col(t, ctx.leave.typeName(t), 'number')), col('taken', 'Taken in period', 'number'), col('entitled', 'Annual entitlement', 'number'), col('used', 'Annual used', 'number'), col('left', 'Annual left', 'number')], rows,
          totals: { taken: R.sum(rows, (r) => r.taken), ...Object.fromEntries(types.map((t) => [t, R.sum(rows, (r) => r[t])])) }, chart: { kind: 'hbars', label: 'name', value: 'taken', unit: ' days' },
          note: 'Days are the working days on each approved request that overlaps the period. Balances are for this calendar year.' };
      } },
    { id: 'claims', group: 'Money', name: 'Claims by category', desc: 'Claimed and approved amounts by category for receipts dated in the period.', filters: ['range', 'dept', 'emp'],
      run(f) {
        const ids = new Set(people(f).map((e) => e.id)), cats = st().settings.claims?.categories || [];
        const lines = st().claims.filter((c) => ids.has(c.empId) && c.status !== 'Draft' && c.status !== 'Cancelled').flatMap((c) => (c.lines || []).filter((l) => l.date >= f.from && l.date <= f.to).map((l) => ({ ...l, claim: c })));
        const rows = R.groupSum(lines.map((l) => ({ cat: l.cat, amount: +l.amount || 0, approved: ['Approved', 'Paid'].includes(l.claim.status) ? +l.approved || 0 : 0, pending: l.claim.status === 'Pending' ? +l.amount || 0 : 0 })), (x) => x.cat, ['amount', 'approved', 'pending'])
          .map((g) => ({ cat: cats.find((c) => c.id === g.key)?.name || g.key, lines: g.count, claims: new Set(lines.filter((l) => l.cat === g.key).map((l) => l.claim.id)).size, amount: g.amount, approved: g.approved, pending: g.pending })).sort((a, b) => b.amount - a.amount);
        return { columns: [col('cat', 'Category'), col('claims', 'Claims', 'number'), col('lines', 'Items', 'number'), col('amount', 'Claimed', 'money'), col('approved', 'Approved or paid', 'money'), col('pending', 'Waiting', 'money')], rows,
          totals: { lines: R.sum(rows, (r) => r.lines), amount: R.sum(rows, (r) => r.amount), approved: R.sum(rows, (r) => r.approved), pending: R.sum(rows, (r) => r.pending) }, chart: { kind: 'hbars', label: 'cat', value: 'amount', money: true }, empty: 'No claims in this period.' };
      } },
    { id: 'birthdays', group: 'Dates', name: 'Birthdays', desc: 'Birthdays coming up in the period.', filters: ['range', 'dept'], future: 60,
      run(f) {
        const rows = people(f).filter((e) => e.status !== 'Inactive').flatMap((e) => R.yearly(e.birthday, f.from, f.to).map((d) => ({ date: d, name: ctx.fullName(e), dept: deptName(e.dept), age: +d.slice(0, 4) - +e.birthday.slice(0, 4) }))).sort((a, b) => a.date.localeCompare(b.date));
        const byMonth = mksIn(f).map((mk) => ({ month: mlabel(mk), count: rows.filter((r) => r.date.startsWith(mk)).length }));
        return { columns: [col('date', 'Date', 'date'), col('name', 'Employee'), col('dept', 'Department'), col('age', 'Turning', 'number')], rows, chart: { kind: 'bars', data: byMonth, label: 'month', value: 'count' }, empty: 'No birthdays in this period.' };
      } },
    { id: 'confirmations', group: 'Dates', name: 'Confirmations due', desc: 'Probation ending in the period (or already past) for people not yet confirmed.', filters: ['range', 'dept'], past: 30,
      run(f) {
        const rows = people(f).filter((e) => e.status !== 'Inactive' && e.probationEnd && !e.confirmedOn && e.probationEnd <= f.to && (e.probationEnd >= f.from || e.probationEnd < T()))
          .map((e) => ({ date: e.probationEnd, name: ctx.fullName(e), dept: deptName(e.dept), role: e.role, start: e.start, manager: emp(e.manager) ? ctx.fullName(emp(e.manager)) : '', left: Math.round((U.parse(e.probationEnd) - U.parse(T())) / 864e5) })).sort((a, b) => a.date.localeCompare(b.date));
        return { columns: [col('date', 'Probation ends', 'date'), col('name', 'Employee'), col('dept', 'Department'), col('role', 'Job title'), col('start', 'Started', 'date'), col('manager', 'Reports to'), col('left', 'Days left', 'number')], rows, empty: 'No confirmations due in this period.',
          note: 'Confirm someone by setting “Confirmed on” in their record; a confirmation letter is under their Documents.' };
      } },
  ];

  // ---------- Custom report sources ----------
  const F = (label, type = 'text') => ({ label, type });
  const SOURCES = {
    employees: { name: 'Employees', dated: false,
      fields: { name: F('Name'), dept: F('Department'), role: F('Job title'), type: F('Employment type'), status: F('Status'), location: F('Location'), manager: F('Reports to'), start: F('Start date', 'date'), years: F('Years of service', 'number'), age: F('Age', 'number'), gender: F('Gender'), nationality: F('Nationality'), salary: F('Annual salary', 'money'), monthly: F('Monthly basic', 'money'), endDate: F('Last day', 'date') },
      rows: () => st().employees.map((e) => ({ _emp: e.id, _dept: e.dept, name: ctx.fullName(e), dept: deptName(e.dept), role: e.role, type: e.type, status: e.status, location: e.location, manager: emp(e.manager) ? ctx.fullName(emp(e.manager)) : '', start: e.start, years: e.start ? R.r2((U.parse(T()) - U.parse(e.start)) / (365.25 * 864e5)) : 0, age: e.birthday ? U.ageOn(e.birthday, T()) : '', gender: e.gender, nationality: e.nationality, salary: e.salary, monthly: R.r2(e.salary / 12), endDate: e.endDate || '' })),
      defaults: ['name', 'dept', 'role', 'start', 'salary'] },
    attendance: { name: 'Attendance', dated: true,
      fields: { day: F('Date', 'date'), name: F('Employee'), dept: F('Department'), status: F('Status'), in: F('In'), out: F('Out'), hours: F('Hours worked', 'number'), late: F('Late minutes', 'number'), project: F('Project') },
      rows: (f) => Object.keys(st().attendance).filter((d) => d >= f.from && d <= f.to).sort().flatMap((d) => Object.entries(st().attendance[d]).map(([id, r]) => { const e = emp(id); if (!e) return null; const x = ['present', 'remote'].includes(r.s) ? ctx.time.dayInfo(e, d) : null; return { _emp: id, _dept: e.dept, day: d, name: ctx.fullName(e), dept: deptName(e.dept), status: r.s, in: r.in || '', out: r.out || '', hours: x ? R.r2(x.ev.worked / 60) : 0, late: x ? x.ev.late : 0, project: (st().projects || []).find((p) => p.id === r.project)?.code || '' }; }).filter(Boolean)),
      defaults: ['day', 'name', 'status', 'in', 'out', 'hours'] },
    leave: { name: 'Leave', dated: true,
      fields: { from: F('From', 'date'), to: F('To', 'date'), name: F('Employee'), dept: F('Department'), type: F('Type'), days: F('Days', 'number'), status: F('Status'), reason: F('Reason'), created: F('Applied', 'date') },
      rows: (f) => st().leaves.filter((l) => l.from <= f.to && l.to >= f.from).map((l) => { const e = emp(l.empId); return e ? { _emp: l.empId, _dept: e.dept, from: l.from, to: l.to, name: ctx.fullName(e), dept: deptName(e.dept), type: ctx.leave.typeName(l.type), days: l.days, status: l.status, reason: l.reason || '', created: l.created || '' } : null; }).filter(Boolean),
      defaults: ['from', 'name', 'type', 'days', 'status'] },
    payroll: { name: 'Payroll', dated: true,
      fields: { month: F('Month', 'month'), name: F('Employee'), dept: F('Department'), base: F('Basic', 'money'), bonus: F('Bonus', 'money'), gross: F('Gross', 'money'), epf: F('EPF employee', 'money'), socso: F('SOCSO employee', 'money'), eis: F('EIS employee', 'money'), pcb: F('PCB', 'money'), net: F('Net', 'money'), erEpf: F('EPF employer', 'money'), employer: F('Employer contributions', 'money'), cost: F('Employer cost', 'money'), status: F('Run status') },
      rows: (f) => R.months(f.from, f.to).filter((mk) => st().payroll[mk]).flatMap((mk) => st().payroll[mk].items.map((it) => { const e = emp(it.empId), p = R.payFigures(it); return e ? { _emp: it.empId, _dept: e.dept, month: mk, name: ctx.fullName(e), dept: deptName(e.dept), base: it.base, bonus: it.bonus || 0, gross: it.gross, epf: it.epf ?? it.benefits ?? 0, socso: it.socso || 0, eis: it.eis || 0, pcb: it.tax || 0, net: it.net, erEpf: it.erEpf || 0, employer: p.employer, cost: p.cost, status: st().payroll[mk].status } : null; }).filter(Boolean)),
      defaults: ['month', 'name', 'gross', 'net', 'cost'] },
    claims: { name: 'Claims', dated: true,
      fields: { date: F('Receipt date', 'date'), name: F('Employee'), dept: F('Department'), title: F('Claim'), category: F('Category'), merchant: F('Merchant'), amount: F('Amount', 'money'), approved: F('Approved', 'money'), status: F('Status') },
      rows: (f) => st().claims.flatMap((c) => (c.lines || []).filter((l) => l.date >= f.from && l.date <= f.to).map((l) => { const e = emp(c.empId); return e ? { _emp: c.empId, _dept: e.dept, date: l.date, name: ctx.fullName(e), dept: deptName(e.dept), title: c.title, category: (st().settings.claims?.categories || []).find((x) => x.id === l.cat)?.name || l.cat, merchant: l.merchant, amount: +l.amount || 0, approved: +l.approved || 0, status: c.status } : null; }).filter(Boolean)),
      defaults: ['date', 'name', 'category', 'amount', 'status'] },
  };
  const blankCustom = (source = 'employees') => ({ id: '', name: '', source, columns: [...SOURCES[source].defaults], filters: [], groupBy: '', agg: 'sum', sort: { field: SOURCES[source].defaults[0], dir: 'asc' } });
  function runCustom(def, f) {
    const src = SOURCES[def.source];
    const rows = src.rows(f).filter((r) => (f.dept === 'all' || r._dept === f.dept) && (f.emp === 'all' || r._emp === f.emp));
    const q = R.runQuery(rows, src.fields, def);
    const num = q.columns.find((c) => ['money', 'number'].includes(c.type) && c.key !== '_count');
    return { columns: q.columns, rows: q.rows, totals: q.totals, chart: def.groupBy ? { kind: 'hbars', label: def.groupBy, value: num?.key || '_count', money: num?.type === 'money' } : null, empty: 'Nothing matches these filters.' };
  }

  // ---------- Rendering ----------
  const report = () => LIB.find((r) => r.id === ui.id) || (ui.id === 'custom' || ui.id.startsWith('saved:') ? { id: ui.id, name: ui.custom?.name || 'Custom report', filters: ['range', 'dept', 'emp'], custom: true } : LIB[0]);
  function cell(v, type) {
    if (v == null || v === '') return '<span class="faint">—</span>';
    if (type === 'money') return ctx.money(v, 2);
    if (type === 'pct') return `${v}%`;
    if (type === 'date') return fmt(v);
    if (type === 'month') return mlabel(v);
    if (type === 'delta') return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${ctx.money(v, 2)}</span>`;
    if (type === 'deltaPct') return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v}%</span>`;
    if (type === 'number') return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : esc(v);
    return esc(v);
  }
  const plain = (v, type) => (v == null ? '' : type === 'month' ? v : v);
  const isNum = (t) => ['money', 'number', 'pct', 'delta', 'deltaPct'].includes(t);
  function table(res) {
    if (!res.rows.length) return `<div class="empty"><strong>${esc(res.empty || 'No data')}</strong>Try a wider date range or clear the filters.</div>`;
    const hasTot = res.totals && Object.keys(res.totals).length;
    return `<div class="table-wrap"><table class="rp-table"><thead><tr>${res.columns.map((c) => `<th class="${isNum(c.type) ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${res.rows.map((r) => `<tr>${res.columns.map((c) => `<td class="${isNum(c.type) ? 'r num' : ''}">${cell(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
      ${hasTot ? `<tfoot><tr>${res.columns.map((c, i) => `<td class="${isNum(c.type) ? 'r num' : ''}">${i === 0 ? '<strong>Total</strong>' : res.totals[c.key] != null ? `<strong>${cell(res.totals[c.key], c.type)}</strong>` : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`;
  }
  // Charts in the app's style: vertical bars for months, horizontal bars for categories.
  function chart(res) {
    const c = res.chart;
    if (!c || !res.rows.length) return '';
    const fmtV = (v) => (c.money ? ctx.compactMoney(v) : c.pct ? `${v}%` : `${R.r2(v)}${c.unit || ''}`);
    if (c.kind === 'hbars') {
      const rows = [...res.rows].filter((r) => (Number(r[c.value]) || 0) > 0).sort((a, b) => b[c.value] - a[c.value]).slice(0, 12);
      if (!rows.length) return '';
      const max = Math.max(...rows.map((r) => +r[c.value] || 0)) || 1;
      return `<div class="rp-hbars" role="img" aria-label="${esc(res.columns.find((x) => x.key === c.value)?.label || '')} chart">${rows.map((r) => `<div class="hbar" style="grid-template-columns:minmax(0,180px) minmax(0,1fr) 84px"><span class="rp-hl" title="${esc(r[c.label])}">${esc(c.label === 'month' ? mlabel(r[c.label]) : r[c.label])}</span><div class="hbar-track"><i style="width:${((+r[c.value] || 0) / max) * 100}%;background:var(--brand)"></i></div><span class="num r">${fmtV(+r[c.value] || 0)}</span></div>`).join('')}</div>`;
    }
    const data = c.data || res.rows, series = c.series || [[c.value, '', 'b-present']];
    if (!data.length) return '';
    const W = Math.max(320, data.length * 56), H = 190, top = 26, B = 26, max = Math.max(1, ...data.flatMap((d) => series.map(([k]) => Math.max(0, +d[k] || 0))));
    const bw = Math.min(34, ((W / data.length) - 10) / series.length);
    let svg = `<svg class="chart rp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s[1] || res.columns.find((x) => x.key === s[0])?.label || '').join(' and '))} by month">`;
    svg += `<line class="grid-line" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"/>`;
    data.forEach((d, i) => {
      const cx = (W / data.length) * (i + 0.5);
      series.forEach(([k, label, cls], j) => {
        const v = Math.max(0, +d[k] || 0), h = ((H - top - B) * v) / max, x = cx - (bw * series.length) / 2 + j * bw;
        svg += `<rect class="${cls}" x="${x + 1}" y="${H - B - h}" width="${bw - 2}" height="${Math.max(h, v ? 2 : 0)}" rx="3"><title>${esc(c.label === 'month' && !c.data ? mlabel(d[c.label]) : d[c.label])}${label ? ` · ${esc(label)}` : ''}: ${fmtV(v)}</title></rect>`;
        if (series.length === 1 && data.length <= 12) svg += `<text class="val" x="${cx}" y="${H - B - h - 6}" text-anchor="middle">${fmtV(v)}</text>`;
      });
      svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(c.label === 'month' && !c.data ? U.fmtMonth(d[c.label], { month: 'short' }) : String(d[c.label]).split(' ')[0])}</text>`;
    });
    svg += '</svg>';
    return `<div class="rp-chart-wrap">${svg}${series.length > 1 ? `<div class="legend">${series.map(([, l, cls]) => `<span><i class="lg-${cls}"></i>${esc(l)}</span>`).join('')}</div>` : ''}</div>`;
  }
  function result() {
    const r = report(), f = filters();
    try { return r.custom ? runCustom(ui.custom, f) : r.run(f); } catch (err) { console.error(err); return { columns: [], rows: [], empty: 'This report could not be built from the current data.' }; }
  }
  function filterBar(r) {
    const f = filters(), fs = r.filters || [];
    return `<div class="rp-filters">${fs.includes('range') ? `<div class="field"><label for="rp-from">From</label><input class="input" type="date" id="rp-from" value="${f.from}"></div><div class="field"><label for="rp-to">To</label><input class="input" type="date" id="rp-to" value="${f.to}"></div>
        <div class="field rp-quick"><span class="label-like">Quick</span><div class="seg">${[['m', 'This month'], ['q', '3 months'], ['y', 'This year']].map(([k, l]) => `<button type="button" data-act="rp-quick" data-v="${k}">${l}</button>`).join('')}</div></div>` : ''}
      ${fs.includes('dept') ? `<div class="field"><label for="rp-dept">Department</label><select class="select" id="rp-dept"><option value="all">All departments</option>${st().departments.map((d) => `<option value="${d.id}" ${f.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>` : ''}
      ${fs.includes('emp') ? `<div class="field"><label for="rp-emp">Employee</label><select class="select" id="rp-emp"><option value="all">Everyone</option>${st().employees.filter((e) => f.dept === 'all' || e.dept === f.dept).sort((a, b) => a.first.localeCompare(b.first)).map((e) => `<option value="${e.id}" ${f.emp === e.id ? 'selected' : ''}>${esc(ctx.fullName(e))}</option>`).join('')}</select></div>` : ''}</div>`;
  }
  function builder() {
    const d = ui.custom, src = SOURCES[d.source], fields = Object.entries(src.fields);
    const opt = (list, v) => list.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div class="card rp-builder"><div class="card-head"><h3>Build a report</h3><div class="row-actions">${d.id ? `<button class="btn btn-sm btn-ghost" data-act="rp-del" data-id="${d.id}">${ctx.icon('trash')}Delete</button>` : ''}<button class="btn btn-sm btn-primary" data-act="rp-save">${ctx.icon('check')}${d.id ? 'Save changes' : 'Save report'}</button></div></div>
      <div class="rp-b-grid">
        <div class="field"><label for="cb-src">Data source</label><select class="select" id="cb-src">${opt(Object.entries(SOURCES).map(([k, s]) => [k, s.name]), d.source)}</select></div>
        <div class="field"><label for="cb-group">Group by</label><select class="select" id="cb-group"><option value="">No grouping</option>${opt(fields.filter(([, x]) => !['money', 'number'].includes(x.type)).map(([k, x]) => [k, x.label]), d.groupBy)}</select></div>
        <div class="field"><label for="cb-agg">Numbers in groups</label><select class="select" id="cb-agg" ${d.groupBy ? '' : 'disabled'}>${opt([['sum', 'Total'], ['avg', 'Average'], ['min', 'Lowest'], ['max', 'Highest']], d.agg)}</select></div>
        <div class="field"><label for="cb-sort">Sort by</label><div class="rp-sort"><select class="select" id="cb-sort">${opt([...(d.groupBy ? [['_count', 'Count']] : []), ...fields.map(([k, x]) => [k, x.label])], d.sort?.field)}</select><select class="select" id="cb-dir" aria-label="Sort direction">${opt([['asc', 'A → Z, low → high'], ['desc', 'Z → A, high → low']], d.sort?.dir)}</select></div></div>
      </div>
      <fieldset class="rp-cols"><legend>Columns</legend>${fields.map(([k, x]) => `<label class="check"><input type="checkbox" data-cb-col="${k}" ${d.columns.includes(k) ? 'checked' : ''}><span>${esc(x.label)}</span></label>`).join('')}</fieldset>
      <fieldset class="rp-conds"><legend>Filters</legend>${d.filters.map((c, i) => `<div class="rp-cond"><select class="select" data-cf="${i}" data-k="field" aria-label="Field">${opt(fields.map(([k, x]) => [k, x.label]), c.field)}</select><select class="select" data-cf="${i}" data-k="op" aria-label="Condition">${opt(Object.entries(R.OPS).map(([k, o]) => [k, o.label]), c.op)}</select>${['empty', 'notempty'].includes(c.op) ? '<span></span>' : `<input class="input" data-cf="${i}" data-k="value" value="${esc(c.value ?? '')}" aria-label="Value" type="${src.fields[c.field]?.type === 'date' ? 'date' : 'text'}">`}<button class="btn btn-sm btn-icon btn-ghost" data-act="rp-cond-del" data-v="${i}" aria-label="Remove filter">${ctx.icon('x')}</button></div>`).join('')}
        <button class="btn btn-sm" data-act="rp-cond-add">${ctx.icon('plus')}Add a filter</button></fieldset>
      <p class="faint">${src.dated ? 'Uses the date range above. ' : ''}The department and employee filters above apply too.</p></div>`;
  }
  function view() {
    const r = report(), res = result(), f = filters();
    const groups = [...new Set(LIB.map((x) => x.group))];
    const nav = `<nav class="rp-lib" aria-label="Reports">${groups.map((g) => `<div class="nav-label">${g}</div>${LIB.filter((x) => x.group === g).map((x) => `<button class="rp-item ${ui.id === x.id ? 'on' : ''}" data-act="rp-pick" data-v="${x.id}" ${ui.id === x.id ? 'aria-current="true"' : ''}>${esc(x.name)}</button>`).join('')}`).join('')}
      <div class="nav-label">Custom</div>${saved().map((s) => `<button class="rp-item ${ui.id === 'saved:' + s.id ? 'on' : ''}" data-act="rp-pick" data-v="saved:${s.id}">${esc(s.name)}<span class="faint"> · ${esc(SOURCES[s.source]?.name || '')}</span></button>`).join('')}<button class="rp-item ${ui.id === 'custom' ? 'on' : ''}" data-act="rp-pick" data-v="custom">${ctx.icon('plus')}New custom report</button></nav>`;
    return `<div class="page-head"><div><div class="eyebrow">Insights</div><h1>HR reports</h1><p class="sub">Ready reports for people, pay, time, leave and claims, and your own saved reports.</p></div>
        <div class="actions"><label class="sr-only" for="rp-jump">Report</label><select class="select rp-jump" id="rp-jump">${LIB.map((x) => `<option value="${x.id}" ${ui.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${saved().map((s) => `<option value="saved:${s.id}" ${ui.id === 'saved:' + s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="custom" ${ui.id === 'custom' ? 'selected' : ''}>New custom report</option></select></div></div>
      <div class="rp-layout">${nav}<div class="rp-main">
        <div class="card"><div class="card-head"><div><h3>${esc(r.custom ? ui.custom.name || 'New custom report' : r.name)}</h3><div class="faint">${esc(r.custom ? `${SOURCES[ui.custom.source].name}${ui.custom.groupBy ? `, grouped by ${SOURCES[ui.custom.source].fields[ui.custom.groupBy].label.toLowerCase()}` : ''}` : r.desc)}</div></div>
          <div class="row-actions"><button class="btn btn-sm" data-act="rp-csv" ${res.rows.length ? '' : 'disabled'}>${ctx.icon('download')}CSV</button><button class="btn btn-sm" data-act="rp-print" ${res.rows.length ? '' : 'disabled'}>${ctx.icon('doc')}Print</button></div></div>
          ${filterBar(r)}
          ${r.views ? `<div class="seg" role="group" aria-label="View">${r.views.map(([k, l], i) => `<button data-act="rp-view" data-v="${k}" class="${(ui.view || r.views[0][0]) === k || (!ui.view && i === 0) ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
        </div>
        ${r.custom ? builder() : ''}
        ${res.kpis?.length ? `<div class="grid g-3 keep-2">${res.kpis.map(([l, v]) => `<div class="card kpi"><div class="kpi-label">${esc(l)}</div><div class="kpi-value num" style="font-size:26px">${esc(v)}</div></div>`).join('')}</div>` : ''}
        ${chart(res) ? `<div class="card">${chart(res)}</div>` : ''}
        <div class="card card-flush">${table(res)}${res.note ? `<p class="disclaimer" style="margin:12px 18px 16px">${ctx.icon('pin')}<span>${esc(res.note)}</span></p>` : ''}</div>
        <p class="faint rp-meta">${res.rows.length} row${res.rows.length === 1 ? '' : 's'} · ${fmt(f.from)} to ${fmt(f.to)}${f.dept !== 'all' ? ` · ${esc(deptName(f.dept))}` : ''}${f.emp !== 'all' && emp(f.emp) ? ` · ${esc(ctx.fullName(emp(f.emp)))}` : ''}</p>
      </div></div>`;
  }
  function bind() {
    const set = (k, v) => { ui[k] = v; if (k === 'dept') ui.emp = 'all'; ctx.render(); };
    ctx.$('#rp-from')?.addEventListener('change', (ev) => { if (ev.target.value) set('from', ev.target.value); });
    ctx.$('#rp-to')?.addEventListener('change', (ev) => { if (ev.target.value) set('to', ev.target.value); });
    ctx.$('#rp-dept')?.addEventListener('change', (ev) => set('dept', ev.target.value));
    ctx.$('#rp-emp')?.addEventListener('change', (ev) => set('emp', ev.target.value));
    ctx.$('#rp-jump')?.addEventListener('change', (ev) => pick(ev.target.value));
    if (!ui.custom) return;
    const d = ui.custom;
    ctx.$('#cb-src')?.addEventListener('change', (ev) => { ui.custom = { ...blankCustom(ev.target.value), id: d.id, name: d.name }; ctx.render(); });
    ctx.$('#cb-group')?.addEventListener('change', (ev) => { d.groupBy = ev.target.value; if (d.groupBy && !d.columns.includes(d.groupBy)) d.columns.unshift(d.groupBy); if (!d.groupBy && d.sort.field === '_count') d.sort.field = d.columns[0]; ctx.render(); });
    ctx.$('#cb-agg')?.addEventListener('change', (ev) => { d.agg = ev.target.value; ctx.render(); });
    ctx.$('#cb-sort')?.addEventListener('change', (ev) => { d.sort.field = ev.target.value; ctx.render(); });
    ctx.$('#cb-dir')?.addEventListener('change', (ev) => { d.sort.dir = ev.target.value; ctx.render(); });
    ctx.$$('[data-cb-col]').forEach((x) => x.addEventListener('change', () => { const k = x.dataset.cbCol; d.columns = x.checked ? [...d.columns, k] : d.columns.filter((c) => c !== k); ctx.render(); }));
    ctx.$$('[data-cf]').forEach((x) => x.addEventListener('change', () => { const c = d.filters[+x.dataset.cf]; c[x.dataset.k] = x.value; if (x.dataset.k === 'field') c.value = ''; ctx.render(); }));
  }
  function pick(id) {
    ui.id = id; ui.view = '';
    const r = LIB.find((x) => x.id === id);
    if (r) { ui.custom = null; Object.assign(ui, defaults(r)); }
    else if (id === 'custom') ui.custom = blankCustom();
    else { const s = saved().find((x) => 'saved:' + x.id === id); ui.custom = s ? JSON.parse(JSON.stringify(s)) : blankCustom(); }
    ctx.render();
  }
  // ---------- Export ----------
  function title() { const r = report(); return r.custom ? ui.custom.name || 'Custom report' : r.name; }
  function csv() {
    const res = result(), f = filters();
    const rows = [res.columns.map((c) => c.label), ...res.rows.map((r) => res.columns.map((c) => plain(r[c.key], c.type)))];
    if (res.totals && Object.keys(res.totals).length) rows.push(res.columns.map((c, i) => (i === 0 ? 'Total' : res.totals[c.key] ?? '')));
    ctx.downloadCSV(`${title().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${f.from}-to-${f.to}.csv`, rows);
  }
  function print() {
    const res = result(), f = filters(), s = st().settings;
    ctx.docs.printDocs(`<article class="doc rp-doc"><header class="doc-head"><div><div class="doc-co">${esc(s.company.toUpperCase())}</div><div class="doc-sub">${esc(title())} · ${fmt(f.from)} to ${fmt(f.to)}${f.dept !== 'all' ? ` · ${esc(deptName(f.dept))}` : ''}${f.emp !== 'all' && emp(f.emp) ? ` · ${esc(ctx.fullName(emp(f.emp)))}` : ''}</div></div><div class="doc-title"><strong>Report</strong><span>Printed ${fmt(T())}</span></div></header>
      ${res.kpis?.length ? `<p>${res.kpis.map(([l, v]) => `<strong>${esc(l)}:</strong> ${esc(v)}`).join(' &nbsp;·&nbsp; ')}</p>` : ''}${chart(res)}${table(res)}${res.note ? `<p class="doc-draft">${esc(res.note)}</p>` : ''}</article>`, `${title()} ${f.from} to ${f.to}`);
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS['hr-reports'] = view;
    ctx.AFTER['hr-reports'] = bind;
    Object.assign(ctx.ACTIONS, {
      'rp-pick': (_, v) => pick(v),
      'rp-view': (_, v) => { ui.view = v; ctx.render(); },
      'rp-quick': (_, v) => { const mk = U.monthKey(T()); Object.assign(ui, v === 'm' ? { from: `${mk}-01`, to: T() } : v === 'q' ? { from: `${U.addMonths(mk, -2)}-01`, to: T() } : { from: `${T().slice(0, 4)}-01-01`, to: T() }); ctx.render(); },
      'rp-csv': () => csv(),
      'rp-print': () => print(),
      'rp-cond-add': () => { const k = Object.keys(SOURCES[ui.custom.source].fields)[0]; ui.custom.filters.push({ field: k, op: 'contains', value: '' }); ctx.render(); },
      'rp-cond-del': (_, v) => { ui.custom.filters.splice(+v, 1); ctx.render(); },
      'rp-save': () => {
        const d = ui.custom;
        if (!d.columns.length) { ctx.toast('Pick at least one column', 'error'); return; }
        ctx.openModal({ title: d.id ? 'Save changes' : 'Save this report', size: 'sm', submit: 'Save', body: `<div class="field"><label for="rp-name">Name</label><input class="input" id="rp-name" name="name" required value="${esc(d.name || `${SOURCES[d.source].name} report`)}"></div><p class="faint" style="margin-top:8px">The columns, filters, grouping and sort are saved. Dates and the department and employee filters stay on the page.</p>`,
          onSubmit(x) {
            d.name = x.name.trim();
            if (d.id) Object.assign(saved().find((s) => s.id === d.id), JSON.parse(JSON.stringify(d)), { at: T() });
            else { d.id = U.uid('rpt'); saved().push({ ...JSON.parse(JSON.stringify(d)), by: ctx.account()?.empId || '', at: T() }); }
            ui.id = 'saved:' + d.id;
            ctx.commit(`“${d.name}” saved`);
          } });
      },
      'rp-del': (id) => { st().savedReports = saved().filter((s) => s.id !== id); pick('headcount'); ctx.commit('Report deleted'); },
      'rp-open': (_, v) => { location.hash = 'hr-reports'; setTimeout(() => pick(v), 60); },
    });
    return { LIB, SOURCES, runCustom, open: (id) => pick(id) };
  }
  return { install };
})();
