// Unit tests for the statutory documents and files, run against the seeded demo payroll: every file builder,
// totals that reconcile with the pay run, EA figures that equal the sum of the year's payslips, the event forms,
// reminders and ID validation.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {}, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['utils', 'leave-rules', 'attendance-rules', 'statutory', 'claims-rules', 'notify-rules', 'appraisal-rules', 'hr-rules', 'finance', 'tax', 'claims', 'planner', 'seed']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
}
const S = sandbox.AllurusStatutory;
const U = sandbox.U;
const seed = sandbox.AllurusSeed.create();
const { payroll, employees, settings } = seed;
const employer = settings.employer;
const paidMonths = Object.keys(payroll).filter((mk) => payroll[mk].status === 'Paid').sort();
const mk = paidMonths[paidMonths.length - 1];
const run = payroll[mk];
const r2 = (n) => Math.round(n * 100) / 100;
const total = (k, items = run.items) => r2(items.reduce((s, i) => s + (i[k] || 0), 0));
const ctx = { month: mk, employees, employer };
const csvLines = (f) => f.csv.trim().split('\r\n');

test('the seed has paid payroll to test against', () => {
  assert.ok(paidMonths.length >= 6);
  assert.ok(run.items.length >= 15);
});

test('IC, account and employee checks', () => {
  assert.equal(S.validIC('900115-11-5123'), true);
  assert.equal(S.validIC('900230115123'), false); // 30 February
  assert.equal(S.validIC('90011511512'), false);
  assert.equal(S.validIC('901315115123'), false);
  assert.equal(S.fmtIC('900115115123'), '900115-11-5123');
  assert.equal(S.validAccount('1640 1234 5678', 'Maybank'), true);
  assert.equal(S.validAccount('12AB5678', 'Maybank'), false);
  assert.equal(S.validAccount('12345', 'Maybank'), false);
  const bad = S.checkEmployee({ ic: '123', accountNo: '99', bank: '' });
  assert.equal(bad.errors.map((e) => e.field).sort().join(), 'accountNo,bank,ic');
  assert.equal(S.checkEmployee({ idType: 'passport', ic: 'A1234567', bank: 'Maybank', accountNo: '164012345678' }).errors.length, 0);
  // Every seeded IC is valid.
  employees.forEach((e) => assert.equal(S.validIC(e.ic), true, `${e.first} ${e.ic}`));
});

test('payslip lines add up to gross and net for every seeded payslip', () => {
  paidMonths.forEach((m) => payroll[m].items.forEach((it) => {
    const e = employees.find((x) => x.id === it.empId);
    const p = S.payslipData(it, e, { month: m });
    assert.equal(r2(p.earnings.reduce((s, l) => s + l.amount, 0)), r2(it.gross), `${m} ${e.first} gross`);
    assert.equal(r2(p.gross - p.totalDeductions + p.reimbursements.reduce((s, l) => s + l.amount, 0)), r2(it.net), `${m} ${e.first} net`);
  }));
});

test('KWSP file reconciles with the pay run', () => {
  const f = S.epfFile(run, ctx);
  assert.equal(f.rows.length, run.items.length);
  assert.equal(f.meta.sums.ee, total('epf'));
  assert.equal(f.meta.sums.er, total('erEpf'));
  assert.equal(f.meta.sums.all, r2(total('epf') + total('erEpf')));
  assert.equal(csvLines(f).length, run.items.length + 2);
  assert.match(csvLines(f)[0], /^EPF member no,IC \/ passport no,Name/);
  assert.match(f.csv, /TOTAL/);
  assert.equal(f.filename, `kwsp-epf-${mk}.csv`);
});

test('PERKESO SOCSO and EIS file reconciles with the pay run', () => {
  const f = S.socsoFile(run, ctx);
  assert.equal(f.meta.sums.socsoEe, total('socso'));
  assert.equal(f.meta.sums.socsoEr, total('erSocso'));
  assert.equal(f.meta.sums.eisEe, total('eis'));
  assert.equal(f.meta.sums.eisEr, total('erEis'));
  assert.equal(f.meta.sums.all, r2(total('socso') + total('erSocso') + total('eis') + total('erEis')));
});

test('LHDN PCB (CP39) file reconciles and flags missing tax numbers', () => {
  const f = S.pcbFile(run, ctx);
  assert.equal(f.meta.sums.pcb, total('tax'));
  assert.equal(f.meta.sums.zakat, total('zakat'));
  // Samuel has no income tax number in the seed.
  const samuel = employees.find((e) => e.first === 'Samuel');
  const it = run.items.find((i) => i.empId === samuel.id);
  if (it.tax > 0) assert.ok(f.issues.some((x) => x.empId === samuel.id));
});

test('HRD Corp levy summary reconciles', () => {
  const f = S.hrdfSummary(run, { ...ctx, rate: 1 });
  assert.equal(f.meta.sums.levy, total('hrdf'));
  assert.ok(f.meta.sums.levy > 0);
});

test('bank file: paid plus held equals the run’s net pay', () => {
  const f = S.bankFile(run, { ...ctx, company: settings.company });
  const samuel = employees.find((e) => e.first === 'Samuel');
  assert.ok(f.issues.some((x) => x.empId === samuel.id && /No bank account/.test(x.msg)));
  assert.equal(f.rows.length, run.items.length - 1);
  assert.equal(f.meta.sums.all, total('net'));
  assert.equal(f.meta.sums.total, r2(total('net') - run.items.find((i) => i.empId === samuel.id).net));
  const first = csvLines(f)[1].split(',');
  assert.equal(first.length, 6);
  assert.match(first[5], /^SALARY [A-Z]{3} \d{4}/);
  // Account numbers stay as text with leading zeros, not numbers.
  const custom = S.bankFile({ items: [{ empId: 'x', net: 100 }] }, { month: mk, employees: [{ id: 'x', first: 'A', last: 'B', bank: 'Maybank', accountNo: '0012-3456-78' }] });
  assert.equal(custom.rows[0].cells[3], '0012345678');
});

test('Borang EA equals the sum of the year’s payslips', () => {
  const year = mk.slice(0, 4);
  const months = paidMonths.filter((m) => m.startsWith(year));
  employees.forEach((e) => {
    const items = months.map((m) => payroll[m].items.find((i) => i.empId === e.id)).filter(Boolean);
    const ea = S.eaForm({ year, emp: e, payroll, employer, company: settings.company });
    assert.equal(ea.months, items.length);
    const sumOf = (k) => r2(items.reduce((s, i) => s + (i[k] || 0), 0));
    assert.equal(ea.gross, sumOf('gross'), `${e.first} gross`);
    assert.equal(r2(ea.income.total + ea.exempt.allowances), sumOf('gross'), `${e.first} income`);
    assert.equal(ea.deductions.pcb, sumOf('tax'));
    assert.equal(ea.contributions.epf, sumOf('epf'));
    assert.equal(ea.contributions.socso, sumOf('socso'));
    assert.equal(ea.contributions.eis, sumOf('eis'));
    assert.equal(ea.exempt.medical, sumOf('claims'));
    assert.equal(ea.income.bonus, sumOf('bonus'));
  });
});

test('EA counts overtime as salary and non-taxable allowances as exempt', () => {
  const it = { empId: 'x', base: 3000, unpaid: 0, bonus: 0, gross: 3300, tax: 50, epf: 330, socso: 15, eis: 6, claims: 0,
    extraLines: [{ key: 'ot', amount: 200, tax: true }, { key: 'al-transport', amount: 60, tax: false }, { key: 'al-attend', amount: 40, tax: true }] };
  const ea = S.eaForm({ year: '2030', emp: { id: 'x', first: 'A', last: 'B' }, payroll: { '2030-01': { status: 'Paid', items: [it] }, '2030-02': { status: 'Draft', items: [it] } } });
  assert.equal(ea.months, 1);
  assert.equal(ea.income.salary, 3200);
  assert.equal(ea.income.allowances, 40);
  assert.equal(ea.exempt.allowances, 60);
  assert.equal(ea.income.total + ea.exempt.allowances, ea.gross);
});

test('CP8D and Form E totals equal the sum of everyone’s EA', () => {
  const year = mk.slice(0, 4);
  const eas = S.yearEmployees(payroll, year, employees).map((e) => S.eaForm({ year, emp: e, payroll, employer }));
  const c = S.cp8d({ year, payroll, employees, employer, company: settings.company });
  assert.equal(c.rows.length, eas.length);
  assert.equal(c.meta.sums.income, r2(eas.reduce((s, x) => s + x.income.total, 0)));
  assert.equal(c.meta.sums.pcb, r2(eas.reduce((s, x) => s + x.deductions.pcb, 0)));
  const allPcb = r2(paidMonths.filter((m) => m.startsWith(year)).reduce((s, m) => s + total('tax', payroll[m].items), 0));
  assert.equal(c.meta.sums.pcb, allPcb);
  const fe = S.formE({ year, payroll, employees, employer, company: settings.company });
  assert.equal(fe.employees, eas.length);
  assert.equal(fe.pcb, allPcb);
  assert.equal(fe.remuneration, c.meta.sums.income);
  assert.equal(fe.missingTaxNo, 1);
});

test('CP22 for the new joiner and CP22A for the leaver', () => {
  const today = U.today();
  const ev = S.eventForms(employees, today);
  const nurul = employees.find((e) => e.first === 'Nurul'), julian = employees.find((e) => e.first === 'Julian');
  const c22 = ev.find((x) => x.empId === nurul.id);
  assert.equal(c22.form, 'CP22');
  assert.equal(c22.due, U.addDays(nurul.start, 30));
  assert.equal(c22.daysLeft, 18);
  const c22a = ev.find((x) => x.empId === julian.id);
  assert.equal(c22a.form, 'CP22A');
  assert.equal(c22a.daysLeft, 10);
  assert.equal(ev.length, 2);
  assert.equal(S.eventForms([{ ...julian, leaveReason: 'abroad' }], today)[0].form, 'CP21');
  assert.equal(S.eventForms([{ ...nurul, cp22Filed: today }], today).length, 0);
  const f = S.cp22({ emp: nurul, employer, company: 'Allurus' });
  assert.equal(f.employee.id, S.fmtIC(nurul.ic));
  assert.equal(f.employee.monthly, r2(nurul.salary / 12));
  const l = S.cp22a({ emp: julian, payroll, employer });
  assert.equal(l.reason, 'Resignation');
  assert.equal(l.ytd.pcb, S.eaForm({ year: julian.endDate.slice(0, 4), emp: julian, payroll }).deductions.pcb);
});

test('reminders: statutory payments by the 15th, EA by end of February, Form E by 31 March', () => {
  const p = { '2027-01': { status: 'Paid', items: [{ hrdf: 10 }] } };
  const r = S.dueReminders({ today: '2027-02-05', payroll: p, filed: { '2027-01': { epf: 'x' } } });
  const st = r.find((x) => x.kind === 'statutory');
  assert.equal(st.due, '2027-02-15');
  assert.equal(st.daysLeft, 10);
  assert.deepEqual([...st.open], ['socso', 'pcb', 'hrdf']);
  const ea = r.find((x) => x.kind === 'ea');
  assert.equal(ea.year, 2026);
  assert.equal(ea.due, '2027-02-28');
  assert.equal(r.find((x) => x.kind === 'formE').due, '2027-03-31');
  // Nothing open once everything is marked and EA is issued.
  const done = S.dueReminders({ today: '2027-02-05', payroll: p, filed: { '2027-01': { epf: 1, socso: 1, pcb: 1, hrdf: 1 } }, eaIssued: { 2026: 'x' }, formEFiled: { 2026: 'x' } });
  assert.equal(done.length, 0);
  // Previous month not paid yet, before the 15th.
  assert.ok(S.dueReminders({ today: '2027-03-03', payroll: p, eaIssued: { 2026: 1 }, formEFiled: { 2026: 1 } }).some((x) => x.kind === 'pay-first' && x.month === '2027-02'));
  // Far from the deadline: no reminder.
  assert.equal(S.dueReminders({ today: '2027-01-20', payroll: { '2027-01': { status: 'Paid', items: [] } }, eaIssued: { 2026: 1 }, formEFiled: { 2026: 1 } }).filter((x) => x.kind === 'statutory').length, 0);
  // Seeded: September PCB still open after the 15th of October.
  const seeded = S.dueReminders({ today: U.today(), payroll, filed: seed.statutory.filed });
  assert.ok(seeded.some((x) => x.kind === 'statutory' && x.open.includes('pcb')));
});

test('CSV escapes commas and quotes', () => {
  assert.equal(S.toCSV([['A, B', 'say "hi"', 1.5]]), '"A, B","say ""hi""",1.50\r\n');
});

test('seeded claims: all in the new format, payroll reimbursements reconcile with the books by GL', () => {
  const CR = sandbox.AllurusClaimRules;
  assert.ok(seed.claims.every((c) => Array.isArray(c.lines) && c.lines.length && c.type === undefined));
  assert.ok(seed.claims.some((c) => c.lines.length > 1));
  const cats = settings.claims.categories;
  paidMonths.forEach((m) => {
    const items = payroll[m].items;
    const paid = seed.claims.filter((c) => c.status === 'Paid' && c.paidIn === m);
    assert.equal(r2(items.reduce((s, i) => s + (i.claims || 0), 0)), r2(paid.reduce((s, c) => s + c.approved, 0)), m);
    const gl = {}; items.forEach((i) => Object.entries(i.claimGL || {}).forEach(([k, v]) => { gl[k] = r2((gl[k] || 0) + v); }));
    const want = CR.payrollSplit(paid, cats).byGL;
    assert.equal(JSON.stringify(Object.keys(gl).sort().map((k) => [k, gl[k]])), JSON.stringify(Object.keys(want).sort().map((k) => [k, want[k]])), m);
  });
  // The approved gym claim is taxable; the approved roadshow claim is not.
  const ok = seed.claims.filter((c) => c.status === 'Approved');
  const split = CR.payrollSplit(ok, cats);
  assert.equal(split.taxable, 150);
  assert.ok(split.byGL.Travel > 0);
  assert.equal(r2(split.taxable + split.nonTaxable), r2(ok.reduce((s, c) => s + c.approved, 0)));
});
