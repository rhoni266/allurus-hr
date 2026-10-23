// Statutory documents and files from payroll: payslip data, KWSP / PERKESO / LHDN / HRD Corp contribution files,
// the bank salary file, Borang EA, Form E and CP8D, the CP22 / CP22A / CP21 event forms, due-date reminders and
// ID validation. Pure functions with no DOM access, unit tested in tests/statutory.test.js.
//
// None of these files claim to match an official upload layout. Each builder makes a clearly labelled CSV or data
// object with the fields the authority asks for; check every one against its official specification before using it
// for a real submission (see the FORMAT comment on each builder).
window.AllurusStatutory = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const sum = (list, f) => r2(list.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +(s.slice(8, 10) || 1)));
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const addMonths = (mk, n) => { const d = new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7) - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
  const monthEnd = (mk) => iso(new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7), 0)));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const fullName = (e) => `${e?.first || ''} ${e?.last || ''}`.trim();
  const digits = (s) => String(s || '').replace(/[\s-]/g, '');
  const ymLabel = (mk) => { const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']; return `${m[+mk.slice(5, 7) - 1]} ${mk.slice(0, 4)}`; };

  // ---------- CSV ----------
  const cell = (v) => { const s = v == null ? '' : typeof v === 'number' ? v.toFixed(2) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // Numbers print with two decimals; text such as IC and account numbers stays as typed.
  const toCSV = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  function file({ filename, header, rows, totals, issues = [], meta = {} }) {
    const body = [header, ...rows.map((r) => r.cells)];
    if (totals) body.push(totals);
    return { filename, header, rows, totals, issues, meta, csv: toCSV(body) };
  }

  // ---------- IDs and validation ----------
  // NRIC (MyKad) numbers are 12 digits: birth date YYMMDD, a 2-digit place-of-birth code and 4 digits.
  function validIC(s) {
    const d = digits(s);
    if (!/^\d{12}$/.test(d)) return false;
    const mm = +d.slice(2, 4), dd = +d.slice(4, 6);
    if (mm < 1 || mm > 12 || dd < 1) return false;
    return dd <= new Date(Date.UTC(2000 + +d.slice(0, 2), mm, 0)).getUTCDate();
  }
  const fmtIC = (s) => { const d = digits(s); return /^\d{12}$/.test(d) ? `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}` : String(s || ''); };
  // Malaysian banks for the employee record. Per-bank account rules and file templates can be added to BANK_RULES.
  const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'Bank Rakyat', 'BSN', 'Affin Bank', 'Alliance Bank', 'Bank Muamalat', 'OCBC Bank', 'HSBC Bank', 'UOB', 'Standard Chartered', 'Agrobank', 'MBSB Bank'];
  // FORMAT: verify against each bank's account numbering before production. Until per-bank rules are added,
  // any 6 to 20 digits is accepted.
  const BANK_RULES = {};
  function validAccount(acc, bank) {
    const d = digits(acc), rule = BANK_RULES[bank];
    if (!/^\d+$/.test(d)) return false;
    return rule ? rule.lengths.includes(d.length) : d.length >= 6 && d.length <= 20;
  }
  // Errors block saving; warnings are gaps that will show on statutory files.
  function checkEmployee(e) {
    const errors = [], warnings = [];
    if (e.idType === 'passport') { if (e.ic && !/^[A-Z0-9]{6,12}$/i.test(String(e.ic).trim())) errors.push({ field: 'ic', msg: 'Passport numbers are 6 to 12 letters and digits.' }); }
    else if (e.ic && !validIC(e.ic)) errors.push({ field: 'ic', msg: 'An IC number is 12 digits starting with the birth date, like 900115-11-5123.' });
    if (e.accountNo && !validAccount(e.accountNo, e.bank)) errors.push({ field: 'accountNo', msg: 'Account numbers are 6 to 20 digits.' });
    if (e.accountNo && !e.bank) errors.push({ field: 'bank', msg: 'Pick the bank for this account.' });
    if (e.epfNo && !/^\d{5,10}$/.test(digits(e.epfNo))) warnings.push({ field: 'epfNo', msg: 'EPF member numbers are usually digits only.' });
    if (e.taxNo && !/^[A-Z]{1,2}\s?\d{6,13}$/i.test(String(e.taxNo).trim())) warnings.push({ field: 'taxNo', msg: 'Income tax numbers usually start with letters such as SG or OG, then digits.' });
    if (!e.ic) warnings.push({ field: 'ic', msg: 'No IC or passport number.' });
    if (!e.bank || !e.accountNo) warnings.push({ field: 'accountNo', msg: 'No bank account.' });
    return { errors, warnings };
  }
  const idOf = (e) => (e?.ic ? (e.idType === 'passport' ? String(e.ic).toUpperCase() : fmtIC(e.ic)) : '');

  // ---------- Pay items ----------
  // Statutory wages for old runs that were saved before payCalc returned them.
  const epfWageOf = (it) => (it.epfWage != null ? it.epfWage : r2((it.base || 0) - (it.unpaid || 0) + (it.bonus || 0)));
  const socsoWageOf = (it) => (it.socsoWage != null ? it.socsoWage : r2((it.base || 0) - (it.unpaid || 0) + (it.bonus || 0)));
  const lines = (it) => it.extraLines || [];
  const otOf = (it) => sum(lines(it).filter((l) => l.key === 'ot'), (l) => l.amount);

  // The lines on one payslip. Earnings add up to gross; gross − deductions + reimbursements = net.
  function payslipData(it, e, { month, company = '' } = {}) {
    const earnings = [{ label: 'Basic salary', amount: r2(it.base) }];
    if (it.unpaid) earnings.push({ label: `Unpaid leave, ${it.unpaidDays || 0} day${it.unpaidDays === 1 ? '' : 's'}`, amount: -r2(it.unpaid) });
    lines(it).forEach((l) => earnings.push({ label: l.label, amount: r2(l.amount), note: l.detail || '' }));
    if (it.bonus) earnings.push({ label: it.bonusNote ? `Bonus (${it.bonusNote})` : 'Bonus', amount: r2(it.bonus) });
    const statutory = it.epf != null && (it.epf || it.socso || it.eis || it.erEpf);
    const deductions = statutory
      ? [['EPF (KWSP), employee', it.epf], ['SOCSO (PERKESO), employee', it.socso], ['EIS, employee', it.eis], ['Income tax (PCB)', it.tax], ['CP38 (LHDN instalment)', it.cp38], ['Zakat', it.zakat]].filter(([, v]) => v).map(([label, amount]) => ({ label, amount: r2(amount) }))
      : [['Income tax', it.tax], ['Benefits', it.benefits]].filter(([, v]) => v).map(([label, amount]) => ({ label, amount: r2(amount) }));
    const reimbursements = it.claims ? [{ label: 'Claims reimbursed (not taxed)', amount: r2(it.claims) }] : [];
    const employer = statutory ? [['EPF, employer', it.erEpf], ['SOCSO, employer', it.erSocso], ['EIS, employer', it.erEis]].filter(([, v]) => v).map(([label, amount]) => ({ label, amount: r2(amount) })) : [];
    return {
      company, month, name: fullName(e), id: idOf(e), role: e?.role || '', epfNo: e?.epfNo || '', taxNo: e?.taxNo || '', bank: e?.bank || '', account: e?.accountNo || '',
      earnings, deductions, reimbursements, employer,
      gross: r2(it.gross), totalDeductions: sum(deductions, (d) => d.amount), net: r2(it.net),
    };
  }

  // ---------- Monthly files ----------
  const people = (run, employees) => run.items.map((it) => ({ it, e: employees.find((x) => x.id === it.empId) || { id: it.empId, first: it.empId, last: '' } }));
  const missing = (list, field, label) => list.filter(({ e }) => !e[field]).map(({ e }) => ({ empId: e.id, name: fullName(e), msg: `No ${label}` }));

  // FORMAT: verify against the KWSP e-Caruman / i-Akaun (Majikan) contribution file specification (kwsp.gov.my)
  // before production. This is a contribution schedule as CSV, not the official upload layout.
  function epfFile(run, { month, employees, employer = {} }) {
    const list = people(run, employees).filter(({ it }) => it.epf != null);
    const rows = list.map(({ it, e }) => ({ empId: e.id, epfWage: epfWageOf(it), ee: r2(it.epf), er: r2(it.erEpf), cells: [e.epfNo || '', idOf(e), fullName(e).toUpperCase(), epfWageOf(it), r2(it.epf), r2(it.erEpf), r2(it.epf + it.erEpf)] }));
    const totals = { wages: sum(rows, (r) => r.epfWage), ee: sum(rows, (r) => r.ee), er: sum(rows, (r) => r.er) };
    totals.all = r2(totals.ee + totals.er);
    return file({
      filename: `kwsp-epf-${month}.csv`,
      header: ['EPF member no', 'IC / passport no', 'Name', 'Wages (RM)', 'Employee share (RM)', 'Employer share (RM)', 'Total (RM)'],
      rows, totals: ['TOTAL', '', `${rows.length} employees`, totals.wages, totals.ee, totals.er, totals.all],
      issues: [...missing(list, 'epfNo', 'EPF member number'), ...missing(list, 'ic', 'IC or passport number')],
      meta: { authority: 'KWSP', employerNo: employer.epfNo || '', month, sums: totals },
    });
  }
  // FORMAT: verify against the PERKESO ASSIST / e-Caruman contribution file specification (perkeso.gov.my) before
  // production. SOCSO and EIS are listed together as CSV, not in the official text layout.
  function socsoFile(run, { month, employees, employer = {} }) {
    const list = people(run, employees).filter(({ it }) => it.epf != null);
    const rows = list.map(({ it, e }) => ({ empId: e.id, wage: socsoWageOf(it), socsoEe: r2(it.socso), socsoEr: r2(it.erSocso), eisEe: r2(it.eis), eisEr: r2(it.erEis),
      cells: [idOf(e), e.socsoNo || idOf(e), fullName(e).toUpperCase(), socsoWageOf(it), r2(it.socso), r2(it.erSocso), r2(it.eis), r2(it.erEis), r2(it.socso + it.erSocso + it.eis + it.erEis)] }));
    const totals = { wages: sum(rows, (r) => r.wage), socsoEe: sum(rows, (r) => r.socsoEe), socsoEr: sum(rows, (r) => r.socsoEr), eisEe: sum(rows, (r) => r.eisEe), eisEr: sum(rows, (r) => r.eisEr) };
    totals.all = r2(totals.socsoEe + totals.socsoEr + totals.eisEe + totals.eisEr);
    return file({
      filename: `perkeso-socso-eis-${month}.csv`,
      header: ['IC / passport no', 'SOCSO no', 'Name', 'Wages (RM)', 'SOCSO employee (RM)', 'SOCSO employer (RM)', 'EIS employee (RM)', 'EIS employer (RM)', 'Total (RM)'],
      rows, totals: ['TOTAL', '', `${rows.length} employees`, totals.wages, totals.socsoEe, totals.socsoEr, totals.eisEe, totals.eisEr, totals.all],
      issues: missing(list, 'ic', 'IC or passport number'),
      meta: { authority: 'PERKESO', employerNo: employer.socsoNo || '', month, sums: totals },
    });
  }
  // FORMAT: verify against the LHDN e-PCB Plus / CP39 data specification (hasil.gov.my) before production.
  // CP38 (extra amounts LHDN orders on top of PCB) comes from the employee's CP38 notice set up on their profile.
  function pcbFile(run, { month, employees, employer = {} }) {
    const list = people(run, employees);
    const rows = list.map(({ it, e }) => ({ empId: e.id, pcb: r2(it.tax), cp38: r2(it.cp38 || 0), zakat: r2(it.zakat || 0),
      cells: [e.taxNo || '', idOf(e), fullName(e).toUpperCase(), r2(it.tax), r2(it.cp38 || 0), r2(it.zakat || 0)] }));
    const totals = { pcb: sum(rows, (r) => r.pcb), cp38: sum(rows, (r) => r.cp38), zakat: sum(rows, (r) => r.zakat) };
    return file({
      filename: `lhdn-pcb-cp39-${month}.csv`,
      header: ['Income tax no', 'IC / passport no', 'Name', 'PCB (RM)', 'CP38 (RM)', 'Zakat deducted (RM)'],
      rows, totals: ['TOTAL', '', `${rows.length} employees`, totals.pcb, totals.cp38, totals.zakat],
      issues: [...missing(list.filter(({ it }) => it.tax > 0 || it.cp38 > 0), 'taxNo', 'income tax number'), ...missing(list, 'ic', 'IC or passport number')],
      meta: { authority: 'LHDN', employerNo: employer.lhdnNo || '', month, sums: totals },
    });
  }
  // FORMAT: verify against HRD Corp's levy rules and eTRiS (hrdcorp.gov.my) before production. The levy here is on
  // basic pay, as in payroll; HRD Corp counts monthly wages as basic plus fixed allowances.
  function hrdfSummary(run, { month, employees, employer = {}, rate = 0 }) {
    const list = people(run, employees).filter(({ it }) => it.hrdf != null);
    const rows = list.map(({ it, e }) => ({ empId: e.id, wage: r2((it.base || 0) - (it.unpaid || 0)), levy: r2(it.hrdf || 0), cells: [idOf(e), fullName(e).toUpperCase(), r2((it.base || 0) - (it.unpaid || 0)), r2(it.hrdf || 0)] }));
    const totals = { wages: sum(rows, (r) => r.wage), levy: sum(rows, (r) => r.levy) };
    return file({
      filename: `hrdcorp-levy-${month}.csv`,
      header: ['IC / passport no', 'Name', 'Basic wages (RM)', 'Levy (RM)'],
      rows, totals: ['TOTAL', `${rows.length} employees at ${rate}%`, totals.wages, totals.levy],
      meta: { authority: 'HRD Corp', employerNo: employer.hrdNo || '', month, sums: totals, rate },
    });
  }

  // ---------- Bank salary file ----------
  // FORMAT: verify against your bank's bulk payment (GIRO / IBG / DuitNow bulk) file specification before production.
  // 'generic' is a plain CSV most cash-management portals can map; add bank-specific templates to BANK_TEMPLATES.
  const BANK_TEMPLATES = {
    generic: { name: 'Generic GIRO / IBG (CSV)', header: ['Beneficiary name', 'IC / passport no', 'Bank', 'Account number', 'Amount (RM)', 'Payment reference'] },
  };
  function bankFile(run, { month, employees, company = '', template = 'generic' }) {
    const t = BANK_TEMPLATES[template] || BANK_TEMPLATES.generic;
    const ref = `SALARY ${ymLabel(month)}`;
    const list = people(run, employees).filter(({ it }) => it.net > 0);
    const issues = [];
    const ok = list.filter(({ e }) => {
      if (!e.bank || !e.accountNo) { issues.push({ empId: e.id, name: fullName(e), msg: 'No bank account' }); return false; }
      if (!validAccount(e.accountNo, e.bank)) { issues.push({ empId: e.id, name: fullName(e), msg: 'Account number looks wrong' }); return false; }
      return true;
    });
    const rows = ok.map(({ it, e }) => ({ empId: e.id, amount: r2(it.net), cells: [fullName(e).toUpperCase(), idOf(e), e.bank, digits(e.accountNo), r2(it.net), `${ref}${company ? ' ' + company.toUpperCase().slice(0, 12) : ''}`.slice(0, 30)] }));
    const total = sum(rows, (r) => r.amount), held = sum(list.filter(({ e }) => !ok.some((x) => x.e === e)), ({ it }) => it.net);
    return file({
      filename: `salary-${template}-${month}.csv`, header: t.header, rows,
      totals: ['TOTAL', `${rows.length} payments`, '', '', total, ''], issues,
      meta: { month, template, templateName: t.name, sums: { total, held, all: r2(total + held) } },
    });
  }

  // ---------- Year-end ----------
  // Paid runs of a year for one person, oldest first.
  const yearItems = (payroll, year, empId) => Object.keys(payroll).filter((mk) => mk.startsWith(`${year}-`) && payroll[mk].status === 'Paid').sort()
    .map((mk) => ({ mk, it: payroll[mk].items.find((i) => i.empId === empId) })).filter((x) => x.it);
  // FORMAT: verify against the official Borang EA (LHDN, hasil.gov.my) for the year before production. The sections
  // follow the form's main parts; issue the official form, filled from these figures.
  function eaForm({ year, emp, payroll, employer = {}, company = '' }) {
    const items = yearItems(payroll, year, emp.id).map((x) => x.it);
    const taxable = (it) => lines(it).filter((l) => l.tax);
    const salary = sum(items, (it) => (it.base || 0) - (it.unpaid || 0) + sum(taxable(it).filter((l) => l.key === 'ot'), (l) => l.amount));
    const bonus = sum(items, (it) => it.bonus || 0);
    const allowances = sum(items, (it) => sum(taxable(it).filter((l) => l.key !== 'ot'), (l) => l.amount));
    const exemptAllowances = sum(items, (it) => sum(lines(it).filter((l) => !l.tax), (l) => l.amount));
    const medical = sum(items, (it) => it.claims || 0);
    const total = r2(salary + bonus + allowances);
    const first = items.length ? yearItems(payroll, year, emp.id)[0].mk : '';
    return {
      year, months: items.length, firstMonth: first,
      employer: { name: company, lhdnNo: employer.lhdnNo || '', address: employer.address || '', signatory: employer.signatory || '', signatoryTitle: employer.signatoryTitle || '' },
      employee: { name: fullName(emp), id: idOf(emp), taxNo: emp.taxNo || '', epfNo: emp.epfNo || '', socsoNo: emp.socsoNo || idOf(emp), role: emp.role || '', start: emp.start || '', end: emp.endDate || '', married: !!emp.married },
      income: { salary, bonus, allowances, total },
      exempt: { allowances: exemptAllowances, medical },
      deductions: { pcb: sum(items, (it) => it.tax), zakat: sum(items, (it) => it.zakat || 0), cp38: sum(items, (it) => it.cp38 || 0) },
      contributions: { epf: sum(items, (it) => it.epf || 0), socso: sum(items, (it) => it.socso || 0), eis: sum(items, (it) => it.eis || 0) },
      gross: sum(items, (it) => it.gross),
    };
  }
  // Everyone paid in a year, with their EA figures.
  function yearEmployees(payroll, year, employees) {
    const ids = new Set(Object.keys(payroll).filter((mk) => mk.startsWith(`${year}-`) && payroll[mk].status === 'Paid').flatMap((mk) => payroll[mk].items.map((i) => i.empId)));
    return employees.filter((e) => ids.has(e.id));
  }
  // FORMAT: verify against LHDN's CP8D specification (hasil.gov.my) before production. CSV of each employee's
  // remuneration for the year, filed with Form E.
  function cp8d({ year, payroll, employees, employer = {}, company = '' }) {
    const list = yearEmployees(payroll, year, employees).map((e) => ({ e, ea: eaForm({ year, emp: e, payroll, employer, company }) }));
    const rows = list.map(({ e, ea }) => ({ empId: e.id, total: ea.income.total, pcb: ea.deductions.pcb, cells: [fullName(e).toUpperCase(), e.taxNo || '', idOf(e), ea.income.total, 0, 0, r2(ea.exempt.allowances + ea.exempt.medical), ea.contributions.epf, ea.deductions.zakat, ea.deductions.pcb, ea.deductions.cp38] }));
    const totals = { income: sum(rows, (r) => r.total), pcb: sum(rows, (r) => r.pcb) };
    return file({
      filename: `lhdn-cp8d-${year}.csv`,
      header: ['Name', 'Income tax no', 'IC / passport no', 'Gross remuneration (RM)', 'Benefits in kind (RM)', 'Living accommodation (RM)', 'Exempt allowances and perquisites (RM)', 'EPF employee (RM)', 'Zakat (RM)', 'PCB (RM)', 'CP38 (RM)'],
      rows, totals: ['TOTAL', '', `${rows.length} employees`, totals.income, 0, 0, sum(list, (x) => x.ea.exempt.allowances + x.ea.exempt.medical), sum(list, (x) => x.ea.contributions.epf), sum(list, (x) => x.ea.deductions.zakat), totals.pcb, sum(list, (x) => x.ea.deductions.cp38)],
      issues: [...list.filter(({ e }) => !e.taxNo).map(({ e }) => ({ empId: e.id, name: fullName(e), msg: 'No income tax number' }))],
      meta: { year, employerNo: employer.lhdnNo || '', sums: totals },
    });
  }
  // FORMAT: verify against the official Form E (LHDN, hasil.gov.my) before production. A summary of the figures HR
  // needs to complete it; file the real return on MyTax.
  function formE({ year, payroll, employees, employer = {}, company = '' }) {
    const staff = yearEmployees(payroll, year, employees);
    const eas = staff.map((e) => eaForm({ year, emp: e, payroll, employer, company }));
    const runs = Object.keys(payroll).filter((mk) => mk.startsWith(`${year}-`) && payroll[mk].status === 'Paid').sort();
    return {
      year, company, employer, months: runs.length, firstMonth: runs[0] || '', lastMonth: runs[runs.length - 1] || '',
      employees: staff.length, withPcb: eas.filter((x) => x.deductions.pcb > 0).length,
      newHires: employees.filter((e) => (e.start || '').startsWith(`${year}-`)).length,
      leavers: employees.filter((e) => (e.endDate || '').startsWith(`${year}-`)).length,
      remuneration: sum(eas, (x) => x.income.total), exempt: sum(eas, (x) => x.exempt.allowances + x.exempt.medical),
      pcb: sum(eas, (x) => x.deductions.pcb), zakat: sum(eas, (x) => x.deductions.zakat), epf: sum(eas, (x) => x.contributions.epf),
      missingTaxNo: staff.filter((e) => !e.taxNo).length,
    };
  }

  // ---------- Joiners and leavers ----------
  const REASONS = { resign: 'Resignation', retire: 'Retirement', terminate: 'Termination', contract: 'End of contract', abroad: 'Leaving Malaysia', death: 'Death' };
  // FORMAT: verify deadlines against LHDN guidance (hasil.gov.my) before production: CP22 within 30 days of a new
  // employee starting; CP22A and CP21 at least 30 days before the last day (CP21 when they leave Malaysia).
  // LHDN exempts some leavers from CP22A, for example when PCB was deducted and they are not retiring.
  function eventForms(employees, today) {
    const out = [];
    employees.forEach((e) => {
      if (e.start && !e.cp22Filed && daysBetween(e.start, today) <= 90 && daysBetween(today, e.start) <= 30) {
        const due = addDays(e.start, 30);
        out.push({ empId: e.id, name: fullName(e), form: 'CP22', title: 'New employee (CP22)', due, daysLeft: daysBetween(today, due) });
      }
      if (e.endDate && !e.leaverFiled && daysBetween(e.endDate, today) <= 60) {
        const form = e.leaveReason === 'abroad' ? 'CP21' : 'CP22A';
        const due = addDays(e.endDate, -30);
        out.push({ empId: e.id, name: fullName(e), form, title: form === 'CP21' ? 'Leaving Malaysia (CP21)' : 'Employee leaving (CP22A)', due, daysLeft: daysBetween(today, due) });
      }
    });
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }
  // FORMAT: verify against the official CP22 (LHDN) before production.
  function cp22({ emp, employer = {}, company = '' }) {
    return { form: 'CP22', company, employer, employee: { name: fullName(emp), id: idOf(emp), taxNo: emp.taxNo || '', role: emp.role || '', start: emp.start || '', married: !!emp.married, gender: emp.gender || '', email: emp.email || '', phone: emp.phone || '', monthly: r2((emp.salary || 0) / 12) }, due: emp.start ? addDays(emp.start, 30) : '' };
  }
  // FORMAT: verify against the official CP22A and CP21 (LHDN) before production.
  function cp22a({ emp, payroll, employer = {}, company = '' }) {
    const year = (emp.endDate || '').slice(0, 4);
    const ea = year ? eaForm({ year, emp, payroll, employer, company }) : null;
    return { form: emp.leaveReason === 'abroad' ? 'CP21' : 'CP22A', company, employer, reason: REASONS[emp.leaveReason] || 'Leaving', employee: { name: fullName(emp), id: idOf(emp), taxNo: emp.taxNo || '', role: emp.role || '', start: emp.start || '', end: emp.endDate || '' },
      ytd: ea ? { year, months: ea.months, income: ea.income.total, pcb: ea.deductions.pcb, epf: ea.contributions.epf } : null, due: emp.endDate ? addDays(emp.endDate, -30) : '' };
  }

  // ---------- Reminders ----------
  // FORMAT: verify deadlines before production: KWSP, PERKESO, LHDN (PCB) and HRD Corp by the 15th of the next month;
  // Borang EA to staff by the end of February; Form E with CP8D by 31 March (e-filing may allow longer).
  const STAT_KINDS = ['epf', 'socso', 'pcb', 'hrdf'];
  function dueReminders({ today, payroll = {}, filed = {}, eaIssued = {}, formEFiled = {} }) {
    const out = [], ym = today.slice(0, 7), prev = addMonths(ym, -1);
    Object.keys(payroll).filter((mk) => payroll[mk].status === 'Paid').forEach((mk) => {
      const due = `${addMonths(mk, 1)}-15`, left = daysBetween(today, due);
      const kinds = STAT_KINDS.filter((k) => k !== 'hrdf' || payroll[mk].items.some((i) => i.hrdf > 0));
      const open = kinds.filter((k) => !filed[mk]?.[k]);
      if (open.length && left <= 14 && left >= -60) out.push({ kind: 'statutory', month: mk, due, daysLeft: left, open });
    });
    if (payroll[prev]?.status !== 'Paid' && +today.slice(8, 10) <= 15) out.push({ kind: 'pay-first', month: prev, due: `${ym}-15`, daysLeft: daysBetween(today, `${ym}-15`) });
    const m = +today.slice(5, 7), lastYear = +today.slice(0, 4) - 1;
    if (m <= 2 && !eaIssued[lastYear]) { const due = monthEnd(`${today.slice(0, 4)}-02`); out.push({ kind: 'ea', year: lastYear, due, daysLeft: daysBetween(today, due) }); }
    if (m <= 4 && !formEFiled[lastYear]) { const due = `${today.slice(0, 4)}-03-31`; out.push({ kind: 'formE', year: lastYear, due, daysLeft: daysBetween(today, due) }); }
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }

  return {
    toCSV, validIC, fmtIC, validAccount, checkEmployee, idOf, BANKS, BANK_RULES, BANK_TEMPLATES, REASONS, STAT_KINDS,
    epfWageOf, socsoWageOf, otOf, payslipData, epfFile, socsoFile, pcbFile, hrdfSummary, bankFile,
    yearItems, yearEmployees, eaForm, cp8d, formE, eventForms, cp22, cp22a, dueReminders, ymLabel,
  };
})();
