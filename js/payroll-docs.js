// Payroll documents: printable payslips (one or all), the statutory files page (KWSP, PERKESO, LHDN CP39, HRD Corp),
// the bank salary file, year-end forms (Borang EA, Form E summary, CP8D), the CP22 / CP22A / CP21 joiner and leaver
// forms, employer registration numbers, and the reminders for each deadline. The builders live in js/statutory.js
// (AllurusStatutory); this file is the screens and print views around them.
window.AllurusPayDocs = (function () {
  'use strict';
  const S = window.AllurusStatutory;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const T = () => U.today();
  const ui = { tab: 'run', year: +U.today().slice(0, 4), bankTpl: 'generic' };
  const TABS = [['run', 'Pay run'], ['files', 'Statutory files'], ['bank', 'Bank file'], ['year', 'Year-end and forms']];
  const KINDS = {
    epf: { title: 'KWSP (EPF)', where: 'i-Akaun (Majikan)', build: S.epfFile, ok: (f, t) => f.meta.sums.ee === t.epf && f.meta.sums.er === t.erEpf, sum: (f) => f.meta.sums.all, desc: (f) => `Employee ${ctx.money(f.meta.sums.ee, 2)} · employer ${ctx.money(f.meta.sums.er, 2)}` },
    socso: { title: 'PERKESO (SOCSO and EIS)', where: 'PERKESO ASSIST', build: S.socsoFile, ok: (f, t) => f.meta.sums.socsoEe === t.socso && f.meta.sums.socsoEr === t.erSocso && f.meta.sums.eisEe === t.eis && f.meta.sums.eisEr === t.erEis, sum: (f) => f.meta.sums.all, desc: (f) => `SOCSO ${ctx.money(f.meta.sums.socsoEe + f.meta.sums.socsoEr, 2)} · EIS ${ctx.money(f.meta.sums.eisEe + f.meta.sums.eisEr, 2)}` },
    pcb: { title: 'LHDN PCB (CP39)', where: 'e-PCB Plus', build: S.pcbFile, ok: (f, t) => f.meta.sums.pcb === t.tax, sum: (f) => f.meta.sums.pcb, desc: (f) => `${f.rows.filter((r) => r.pcb > 0).length} people with PCB${f.meta.sums.zakat ? ` · zakat ${ctx.money(f.meta.sums.zakat, 2)} (pay to the state zakat body)` : ''}` },
    hrdf: { title: 'HRD Corp levy', where: 'eTRiS', build: S.hrdfSummary, ok: (f, t) => f.meta.sums.levy === t.hrdf, sum: (f) => f.meta.sums.levy, desc: (f) => `${f.meta.rate}% of basic pay` },
  };
  const employer = () => st().settings.employer || {};
  const company = () => st().settings.company;
  const stat = () => st().statutory;
  const allEmployees = () => st().employees;
  const r2 = (n) => Math.round(n * 100) / 100;
  const fmt = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? U.fmtDate(d, o) : '—');
  const rm = (n) => ctx.money(n, 2);

  // ---------- Files and printing ----------
  function download(name, text, type = 'text/csv') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: `${type};charset=utf-8` })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ctx.toast(`${name} downloaded`);
  }
  // Prints documents through the browser, which also saves them as PDF (on phones: Share → Save as PDF).
  function printDocs(html, title) {
    let root = document.getElementById('print-root');
    if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
    root.innerHTML = html;
    const prev = document.title;
    document.title = title;
    document.documentElement.classList.add('printing');
    const done = () => { document.documentElement.classList.remove('printing'); root.innerHTML = ''; document.title = prev; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { try { window.print(); } catch (e) { done(); } }, 60);
  }
  // Shows a document on screen first, with a print button; mobile-friendly.
  function preview(title, html, fileTitle) {
    ctx.openModal({ title, size: 'lg', submit: null, body: `<div class="doc-actions"><button type="button" class="btn btn-primary" data-act="pd-print-preview">${ctx.icon('download')}Print or save as PDF</button><span class="faint">Choose “Save as PDF” in the print dialog. On a phone, use Share → Save as PDF.</span></div><div class="doc-preview" id="doc-preview" data-title="${esc(fileTitle)}">${html}</div>` });
  }
  const docHead = (title, sub) => `<header class="doc-head"><div><div class="doc-co">${esc(company().toUpperCase())}</div><div class="doc-sub">${esc(employer().address || '')}${employer().ssm ? ` · ${esc(employer().ssm)}` : ''}</div></div><div class="doc-title"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div></header>`;
  const kvs = (pairs) => `<dl class="doc-kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>`;
  const table = (rows, foot) => `<table class="doc-table"><tbody>${rows.map(([k, v, note]) => `<tr><td>${esc(k)}${note ? `<div class="doc-note">${esc(note)}</div>` : ''}</td><td class="r">${v}</td></tr>`).join('')}</tbody>${foot ? `<tfoot><tr><td>${esc(foot[0])}</td><td class="r">${foot[1]}</td></tr></tfoot>` : ''}</table>`;
  const draftNote = '<p class="doc-draft">Prepared from payroll in Allurus. Check against the official form before you submit or sign it.</p>';

  // ---------- Payslips ----------
  function payslipHtml(empId, mk) {
    const run = st().payroll[mk], it = run?.items.find((i) => i.empId === empId), e = ctx.emp(empId);
    if (!it || !e) return '';
    const p = S.payslipData(it, e, { month: mk, company: company() });
    const acct = p.account ? `${p.bank} ····${p.account.slice(-4)}` : 'Not set';
    return `<section class="doc">${docHead('Payslip', U.fmtMonth(mk))}
      ${kvs([['Name', p.name], ['IC / passport', p.id], ['Position', `${p.role}${ctx.dept(e.dept) ? ' · ' + ctx.dept(e.dept).name : ''}`], ['EPF no', p.epfNo], ['Income tax no', p.taxNo], ['Paid to', acct], ['Pay date', fmt(run.paidOn)], ['Status', run.status === 'Paid' ? 'Paid' : 'Draft']])}
      <div class="doc-cols"><div><h4>Earnings</h4>${table(p.earnings.map((l) => [l.label, l.amount < 0 ? '−' + rm(-l.amount) : rm(l.amount), l.note]), ['Gross pay', rm(p.gross)])}</div>
        <div><h4>Deductions</h4>${table(p.deductions.map((l) => [l.label, rm(l.amount)]), ['Total deductions', rm(p.totalDeductions)])}
        ${p.reimbursements.length ? `<h4>Reimbursements</h4>${table(p.reimbursements.map((l) => [l.label, rm(l.amount)]))}` : ''}</div></div>
      <div class="doc-net"><span>Net pay</span><strong>${rm(p.net)}</strong></div>
      ${p.employer.length ? `<h4>Paid by the company on top of your pay</h4>${table(p.employer.map((l) => [l.label, rm(l.amount)]))}` : ''}
      <p class="doc-foot">This payslip is computer-generated and needs no signature.</p></section>`;
  }
  const printSlip = (empId, mk) => preview(`Payslip · ${U.fmtMonth(mk)}`, payslipHtml(empId, mk), `Payslip ${U.fmtMonth(mk)} ${ctx.fullName(ctx.emp(empId))}`);
  function printAllSlips(mk) {
    const run = st().payroll[mk]; if (!run) return;
    printDocs(run.items.map((i) => payslipHtml(i.empId, mk)).join(''), `Payslips ${U.fmtMonth(mk)} ${company()}`);
  }

  // ---------- Tabs ----------
  const tab = () => (ctx.role() === 'admin' ? ui.tab : 'run');
  const tabBar = () => `<div class="seg pd-tabs" role="tablist" aria-label="Payroll">${TABS.map(([k, l]) => `<button role="tab" data-act="pd-tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}" aria-selected="${ui.tab === k}">${l}</button>`).join('')}</div>`;
  function tabView(mk) {
    if (ui.tab === 'files') return filesView(mk);
    if (ui.tab === 'bank') return bankView(mk);
    if (ui.tab === 'year') return yearView();
    return '';
  }
  const fctx = (mk) => ({ month: mk, employees: allEmployees(), employer: employer(), company: company(), rate: U.statutory(st().settings).hrdf || 0 });
  const missingEmployer = (keys) => keys.filter(([k]) => !employer()[k]).map(([, l]) => l);
  const needsPaid = (mk, run) => !run ? `<div class="card empty"><strong>No payroll for ${U.fmtMonth(mk)}</strong>Run payroll first.</div>`
    : `<div class="card empty"><strong>Approve this run first</strong>Statutory and bank files are made from approved pay, so the totals match what staff receive.<div style="margin-top:14px"><button class="btn" data-act="pd-tab" data-v="run">Back to the pay run</button></div></div>`;
  const issuesHtml = (issues) => (issues.length ? `<ul class="pd-issues">${issues.slice(0, 6).map((x) => `<li>${ctx.icon('help')}<span><strong>${esc(x.name)}</strong>: ${esc(x.msg)}</span>${x.empId ? `<button class="btn btn-sm btn-ghost" data-act="edit-emp" data-id="${x.empId}">Fix</button>` : ''}</li>`).join('')}${issues.length > 6 ? `<li class="faint">and ${issues.length - 6} more</li>` : ''}</ul>` : '');
  const previewTable = (f, limit = 5) => `<details class="pd-preview"><summary>Preview ${f.rows.length} row${f.rows.length === 1 ? '' : 's'}</summary><div class="table-wrap"><table class="policy"><thead><tr>${f.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${f.rows.map((r) => `<tr>${r.cells.map((c) => `<td class="${typeof c === 'number' ? 'r num' : ''}">${typeof c === 'number' ? c.toFixed(2) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr>${f.totals.map((c) => `<td class="${typeof c === 'number' ? 'r num' : ''}"><strong>${typeof c === 'number' ? c.toFixed(2) : esc(c)}</strong></td>`).join('')}</tr></tfoot></table></div></details>`.replace('LIMIT', limit);

  function filesView(mk) {
    const run = st().payroll[mk];
    if (run?.status !== 'Paid') return needsPaid(mk, run);
    const t = ctx.payTotal(run), due = `${U.addMonths(mk, 1)}-15`, left = Math.round((U.parse(due) - U.parse(T())) / 864e5);
    const filed = stat().filed[mk] || {};
    const kinds = Object.keys(KINDS).filter((k) => k !== 'hrdf' || t.hrdf > 0);
    const done = kinds.filter((k) => filed[k]).length;
    const gaps = missingEmployer([['epfNo', 'EPF employer number'], ['socsoNo', 'SOCSO employer code'], ['lhdnNo', 'LHDN employer (E) number']]);
    return `<div class="card pd-due ${done === kinds.length ? 'ok' : left < 0 ? 'bad' : left <= 5 ? 'warn' : ''}"><div><div class="kpi-label">Due by</div><strong>${fmt(due, { weekday: 'short', day: 'numeric', month: 'long' })}</strong>
        <div class="faint">${done === kinds.length ? 'All submitted. Nice work.' : left < 0 ? `${-left} day${left === -1 ? '' : 's'} overdue` : `${left} day${left === 1 ? '' : 's'} left`} · ${done} of ${kinds.length} marked as submitted</div></div>
        <div class="pd-total"><div class="kpi-label">Total to pay</div><strong class="num">${rm(kinds.reduce((s, k) => s + KINDS[k].sum(KINDS[k].build(run, fctx(mk))), 0))}</strong></div></div>
      ${gaps.length ? `<div class="lock-banner warn">${ctx.icon('help')}<span>Add your ${gaps.join(', ')} in <button class="link-btn" data-act="pd-goto" data-v="stat-ids">Settings</button> so they print on the files.</span></div>` : ''}
      <div class="pd-files">${kinds.map((k) => {
        const K = KINDS[k], f = K.build(run, fctx(mk)), ok = K.ok(f, t);
        return `<div class="card pd-file" id="pd-${k}"><div class="card-head"><div><h3>${K.title}</h3><div class="faint">Upload or key in at ${K.where}</div></div>${filed[k] ? `<span class="pill ok">Submitted ${fmt(filed[k], { day: 'numeric', month: 'short' })}</span>` : '<span class="pill warn">To submit</span>'}</div>
          <div class="pd-sum"><strong class="num">${rm(K.sum(f))}</strong><span class="faint">${esc(K.desc(f))}</span></div>
          <div class="pd-check ${ok ? 'ok' : 'bad'}">${ctx.icon(ok ? 'check' : 'x')}${ok ? 'Totals match the pay run' : 'Totals do not match the pay run. Re-run payroll before submitting.'}</div>
          ${issuesHtml(f.issues)}${previewTable(f)}
          <div class="actions"><button class="btn" data-act="pd-dl" data-id="${k}" data-v="${mk}">${ctx.icon('download')}Download CSV</button>
          ${filed[k] ? `<button class="btn btn-ghost btn-sm" data-act="pd-filed" data-id="${k}" data-v="${mk}">Undo submitted</button>` : `<button class="btn btn-primary" data-act="pd-filed" data-id="${k}" data-v="${mk}">${ctx.icon('check')}Mark as submitted</button>`}</div></div>`;
      }).join('')}</div>
      <p class="disclaimer">${ctx.icon('pin')}<span>These CSV files list what each portal asks for, with totals checked against the pay run. They are not the official upload layouts: check each against the KWSP, PERKESO, LHDN and HRD Corp file specifications, or key the figures in, before submitting.</span></p>`;
  }

  function bankView(mk) {
    const run = st().payroll[mk];
    if (run?.status !== 'Paid' && run?.status !== 'Draft') return needsPaid(mk, run);
    const f = S.bankFile(run, { ...fctx(mk), template: ui.bankTpl });
    return `<div class="card"><div class="card-head"><h3>Salary payment file</h3><div class="actions"><label class="sr-only" for="pd-tpl">Bank template</label><select class="select" id="pd-tpl">${Object.entries(S.BANK_TEMPLATES).map(([k, x]) => `<option value="${k}" ${ui.bankTpl === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option disabled>Bank-specific templates: coming</option></select>
        <button class="btn btn-primary" data-act="pd-dl" data-id="bank" data-v="${mk}" ${f.rows.length ? '' : 'disabled'}>${ctx.icon('download')}Download CSV</button></div></div>
      ${run.status === 'Draft' ? `<div class="lock-banner warn">${ctx.icon('help')}<span>This run is still a draft. Approve it before sending the file to your bank.</span></div>` : ''}
      <div class="grid g-3 keep-2"><div class="kpi"><div class="kpi-label">Payments</div><div class="kpi-value">${f.rows.length}</div></div>
        <div class="kpi"><div class="kpi-label">Total in the file</div><div class="kpi-value num" style="font-size:24px">${rm(f.meta.sums.total)}</div></div>
        <div class="kpi"><div class="kpi-label">Held back</div><div class="kpi-value num" style="font-size:24px">${rm(f.meta.sums.held)}</div><div class="kpi-foot">Missing or wrong bank details</div></div></div>
      <div class="pd-check ${r2(f.meta.sums.all) === r2(ctx.payTotal(run).net) ? 'ok' : 'bad'}">${ctx.icon('check')}File plus held back equals net pay of ${rm(ctx.payTotal(run).net)}</div>
      ${issuesHtml(f.issues)}${previewTable(f)}
      <p class="disclaimer">${ctx.icon('pin')}<span>A plain CSV most bank portals can map for GIRO / IBG bulk payments. Check the columns against your bank’s bulk payment template before uploading.</span></p></div>`;
  }

  // ---------- Year-end ----------
  const years = () => [...new Set([...Object.keys(st().payroll).map((m) => +m.slice(0, 4)), +T().slice(0, 4)])].sort((a, b) => b - a);
  const eaOf = (e, y) => S.eaForm({ year: String(y), emp: e, payroll: st().payroll, employer: employer(), company: company() });
  function eaHtml(e, y) {
    const ea = eaOf(e, y), E = ea.employee;
    return `<section class="doc">${docHead('Borang EA', `Remuneration for the year ended 31 December ${y}`)}${draftNote}
      <h4>A. Employer and employee</h4>${kvs([['Employer', company()], ['Employer no (E)', ea.employer.lhdnNo], ['Employee', E.name], ['IC / passport', E.id], ['Income tax no', E.taxNo], ['EPF no', E.epfNo], ['SOCSO no', E.socsoNo], ['Position', E.role], ['Date started', fmt(E.start)], ['Date left', E.end ? fmt(E.end) : ''], ['Months paid in the year', String(ea.months)]])}
      <h4>B. Employment income</h4>${table([['Salary and wages, including overtime', rm(ea.income.salary)], ['Bonus, commission and fees', rm(ea.income.bonus)], ['Taxable allowances', rm(ea.income.allowances)]], ['Total gross remuneration', rm(ea.income.total)])}
      <h4>C. Tax deductions</h4>${table([['Monthly tax deductions (PCB)', rm(ea.deductions.pcb)], ['CP38 instalments', rm(ea.deductions.cp38)], ['Zakat paid through salary', rm(ea.deductions.zakat)]])}
      <h4>D. Contributions by the employee</h4>${table([['EPF (KWSP)', rm(ea.contributions.epf)], ['SOCSO (PERKESO)', rm(ea.contributions.socso)], ['EIS', rm(ea.contributions.eis)]])}
      <h4>E. Not taxed</h4>${table([['Tax-exempt allowances', rm(ea.exempt.allowances)], ['Medical claims reimbursed', rm(ea.exempt.medical)]])}
      <div class="doc-sign"><div>${esc(ea.employer.signatory || '')}<br><span class="faint">${esc(ea.employer.signatoryTitle || 'Authorised officer')}</span></div><div>Date: ${fmt(T())}</div></div></section>`;
  }
  const printEA = (empId, y) => preview(`Borang EA ${y}`, eaHtml(ctx.emp(empId), y), `EA ${y} ${ctx.fullName(ctx.emp(empId))}`);
  function formEHtml(y) {
    const f = S.formE({ year: String(y), payroll: st().payroll, employees: allEmployees(), employer: employer(), company: company() });
    return `<section class="doc">${docHead('Form E summary', `Year of remuneration ${y}`)}${draftNote}
      ${kvs([['Employer', company()], ['Employer no (E)', employer().lhdnNo], ['SSM registration', employer().ssm], ['Payroll months', f.months ? `${U.fmtMonth(f.firstMonth)} to ${U.fmtMonth(f.lastMonth)} (${f.months})` : 'None']])}
      ${table([['Employees paid in the year', String(f.employees)], ['Employees with PCB deducted', String(f.withPcb)], ['New employees in the year', String(f.newHires)], ['Employees who left in the year', String(f.leavers)], ['Total gross remuneration', rm(f.remuneration)], ['Tax-exempt allowances and claims', rm(f.exempt)], ['PCB deducted', rm(f.pcb)], ['Zakat deducted', rm(f.zakat)], ['EPF, employee share', rm(f.epf)]])}
      ${f.missingTaxNo ? `<p class="doc-draft">${f.missingTaxNo} employee${f.missingTaxNo === 1 ? ' has' : 's have'} no income tax number. Add them before filing CP8D.</p>` : ''}
      <p class="doc-foot">Submit Form E with CP8D on MyTax (LHDN).</p></section>`;
  }
  function eventHtml(empId) {
    const e = ctx.emp(empId);
    const ev = S.eventForms([e], T())[0] || { form: e.endDate ? (e.leaveReason === 'abroad' ? 'CP21' : 'CP22A') : 'CP22' };
    if (ev.form === 'CP22') {
      const f = S.cp22({ emp: e, employer: employer(), company: company() }), E = f.employee;
      return `<section class="doc">${docHead('CP22', 'Notification of a new employee')}${draftNote}
        <h4>Employer</h4>${kvs([['Name', company()], ['Employer no (E)', employer().lhdnNo], ['Address', employer().address], ['Phone', employer().phone]])}
        <h4>New employee</h4>${kvs([['Name', E.name], ['IC / passport', E.id], ['Income tax no', E.taxNo || 'None yet'], ['Position', E.role], ['Date started', fmt(E.start)], ['Monthly salary', rm(E.monthly)], ['Marital status', E.married ? 'Married' : 'Single'], ['Email', E.email], ['Phone', E.phone]])}
        <p class="doc-foot">Submit within 30 days of the start date: by ${fmt(f.due)}.</p>
        <div class="doc-sign"><div>${esc(employer().signatory || '')}<br><span class="faint">${esc(employer().signatoryTitle || 'Authorised officer')}</span></div><div>Date: ${fmt(T())}</div></div></section>`;
    }
    const f = S.cp22a({ emp: e, payroll: st().payroll, employer: employer(), company: company() }), E = f.employee;
    return `<section class="doc">${docHead(f.form, f.form === 'CP21' ? 'Notification of an employee leaving Malaysia' : 'Notification of an employee leaving employment')}${draftNote}
      <h4>Employer</h4>${kvs([['Name', company()], ['Employer no (E)', employer().lhdnNo], ['Address', employer().address]])}
      <h4>Employee</h4>${kvs([['Name', E.name], ['IC / passport', E.id], ['Income tax no', E.taxNo], ['Position', E.role], ['Date started', fmt(E.start)], ['Last day', fmt(E.end)], ['Reason', f.reason]])}
      ${f.ytd ? `<h4>Pay in ${f.ytd.year} so far</h4>${table([['Months paid', String(f.ytd.months)], ['Gross remuneration', rm(f.ytd.income)], ['PCB deducted', rm(f.ytd.pcb)], ['EPF, employee', rm(f.ytd.epf)]])}` : ''}
      <p class="doc-foot">Submit at least 30 days before the last day: by ${fmt(f.due)}. Hold back final pay as LHDN directs.</p>
      <div class="doc-sign"><div>${esc(employer().signatory || '')}<br><span class="faint">${esc(employer().signatoryTitle || 'Authorised officer')}</span></div><div>Date: ${fmt(T())}</div></div></section>`;
  }
  function yearView() {
    const y = ui.year, ys = years(), staff = S.yearEmployees(st().payroll, String(y), allEmployees());
    const months = Object.keys(st().payroll).filter((m) => m.startsWith(`${y}-`) && st().payroll[m].status === 'Paid').sort();
    const complete = months.includes(`${y}-12`), issued = stat().eaIssued[y], efiled = stat().formEFiled[y];
    const fe = S.formE({ year: String(y), payroll: st().payroll, employees: allEmployees(), employer: employer(), company: company() });
    const c8 = S.cp8d({ year: String(y), payroll: st().payroll, employees: allEmployees(), employer: employer(), company: company() });
    const ev = S.eventForms(allEmployees(), T());
    const done = allEmployees().filter((e) => e.cp22Filed && e.start >= U.addDays(T(), -120) || e.leaverFiled).slice(0, 5);
    return `<div class="pd-year"><label for="pd-year" class="kpi-label">Year</label><select class="select" id="pd-year">${ys.map((x) => `<option ${x === y ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span class="faint">${months.length ? `${months.length} paid month${months.length === 1 ? '' : 's'}${complete ? '' : '. Year to date: final figures come after December payroll.'}` : 'No paid payroll this year yet.'}</span></div>
      <div class="card card-flush" id="pd-ea"><div class="card-head" style="padding-bottom:12px"><div><h3>Borang EA</h3><div class="faint">Give every employee their EA by ${fmt(`${y + 1}-02-${new Date(y + 1, 2, 0).getDate()}`, { day: 'numeric', month: 'long', year: 'numeric' })}.</div></div>
        <div class="actions">${staff.length ? `<button class="btn" data-act="pd-ea-all">${ctx.icon('download')}Print all</button>` : ''}${issued ? `<span class="pill ok">Issued to staff ${fmt(issued, { day: 'numeric', month: 'short' })}</span>` : staff.length ? `<button class="btn btn-primary" data-act="pd-ea-issue">${ctx.icon('check')}Issue to staff</button>` : ''}</div></div>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th class="r">Months</th><th class="r">Gross remuneration</th><th class="r hide-sm">PCB</th><th class="r hide-sm">EPF</th><th></th></tr></thead>
        <tbody>${staff.map((e) => { const ea = eaOf(e, y); return `<tr><td>${ctx.person(e)}</td><td class="r num">${ea.months}</td><td class="r num">${rm(ea.income.total)}</td><td class="r num hide-sm">${rm(ea.deductions.pcb)}</td><td class="r num hide-sm">${rm(ea.contributions.epf)}</td><td><div class="row-actions"><button class="btn btn-sm" data-act="pd-ea" data-id="${e.id}">${ctx.icon('doc')}EA</button></div></td></tr>`; }).join('')}</tbody></table>
        ${staff.length ? '' : '<div class="empty"><strong>No EA forms yet</strong>They are made from paid payroll.</div>'}</div></div>
      <div class="grid g-2">
        <div class="card" id="pd-forme"><div class="card-head"><h3>Form E summary</h3>${efiled ? `<span class="pill ok">Filed ${fmt(efiled, { day: 'numeric', month: 'short' })}</span>` : `<span class="hint">Due 31 Mar ${y + 1}</span>`}</div>
          <dl class="kv kv-wide"><dt>Employees paid</dt><dd>${fe.employees}</dd><dt>Gross remuneration</dt><dd class="num">${rm(fe.remuneration)}</dd><dt>PCB deducted</dt><dd class="num">${rm(fe.pcb)}</dd><dt>Joined / left</dt><dd>${fe.newHires} / ${fe.leavers}</dd></dl>
          <div class="actions" style="margin-top:14px"><button class="btn" data-act="pd-forme">${ctx.icon('doc')}View and print</button>${efiled ? `<button class="btn btn-ghost btn-sm" data-act="pd-forme-filed">Undo filed</button>` : `<button class="btn btn-primary" data-act="pd-forme-filed">${ctx.icon('check')}Mark as filed</button>`}</div></div>
        <div class="card" id="pd-cp8d"><div class="card-head"><h3>CP8D</h3><span class="hint">Filed with Form E</span></div>
          <p class="muted">Each employee’s remuneration, PCB and zakat for ${y}. ${c8.rows.length} employees, ${rm(c8.meta.sums.income)} gross, ${rm(c8.meta.sums.pcb)} PCB.</p>
          ${issuesHtml(c8.issues)}${previewTable(c8)}
          <div class="actions" style="margin-top:12px"><button class="btn" data-act="pd-cp8d" ${c8.rows.length ? '' : 'disabled'}>${ctx.icon('download')}Download CSV</button></div>
          <p class="disclaimer">${ctx.icon('pin')}<span>Check the columns against LHDN’s CP8D format before uploading on MyTax.</span></p></div></div>
      <div class="card card-flush" id="pd-events"><div class="card-head" style="padding-bottom:12px"><div><h3>Joiners and leavers</h3><div class="faint">CP22 within 30 days of a new start. CP22A (or CP21 when leaving Malaysia) at least 30 days before the last day.</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Form</th><th>Due</th><th></th></tr></thead><tbody>
        ${ev.map((x) => `<tr><td>${ctx.person(ctx.emp(x.empId))}</td><td><strong>${x.form}</strong><div class="person-sub">${esc(x.title)}</div></td><td><span class="pill ${x.daysLeft < 0 ? 'bad' : x.daysLeft <= 7 ? 'warn' : ''}">${fmt(x.due, { day: 'numeric', month: 'short' })} · ${x.daysLeft < 0 ? `${-x.daysLeft} days late` : `${x.daysLeft} days`}</span></td>
          <td><div class="row-actions"><button class="btn btn-sm" data-act="pd-form" data-id="${x.empId}">${ctx.icon('doc')}Form</button><button class="btn btn-sm btn-primary" data-act="pd-form-filed" data-id="${x.empId}" data-v="${x.form}">${ctx.icon('check')}Submitted</button></div></td></tr>`).join('')}
        ${done.map((e) => `<tr class="off"><td>${ctx.person(e)}</td><td>${e.leaverFiled ? (e.leaveReason === 'abroad' ? 'CP21' : 'CP22A') : 'CP22'}</td><td><span class="pill ok">Submitted ${fmt(e.leaverFiled || e.cp22Filed, { day: 'numeric', month: 'short' })}</span></td><td><div class="row-actions"><button class="btn btn-sm btn-ghost" data-act="pd-form" data-id="${e.id}">View</button></div></td></tr>`).join('')}</tbody></table>
        ${ev.length || done.length ? '' : '<div class="empty"><strong>Nothing due</strong>Add a new employee or set a last day to see the form here.</div>'}</div></div>`;
  }

  // ---------- Employee self-service ----------
  function myTaxCard(e) {
    const ys = Object.keys(stat().eaIssued || {}).map(Number).filter((y) => S.yearItems(st().payroll, y, e.id).length).sort((a, b) => b - a);
    return `<div class="card"><div class="card-head"><h3>Tax forms</h3><span class="hint">Borang EA</span></div>
      ${ys.length ? `<div class="list">${ys.map((y) => { const ea = eaOf(e, y); return `<div class="list-item"><div class="grow"><div class="person-name">EA ${y}</div><div class="person-sub">${rm(ea.income.total)} gross · ${rm(ea.deductions.pcb)} PCB</div></div><button class="btn btn-sm" data-act="pd-my-ea" data-v="${y}">${ctx.icon('doc')}View</button></div>`; }).join('')}</div>`
        : '<div class="empty"><strong>No EA form yet</strong>HR issues your EA by the end of February for the year before. Use it to file your tax return on MyTax.</div>'}</div>`;
  }

  // ---------- Employee record ----------
  function employeeFields(e) {
    const opt = (list, v) => list.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div class="field full form-sep"><span class="eyebrow">Statutory and bank</span></div>
      <div class="field"><label for="f-idtype">ID type</label><select class="select" id="f-idtype" name="idType">${opt([['mykad', 'MyKad (IC)'], ['passport', 'Passport']], e.idType || 'mykad')}</select></div>
      <div class="field"><label for="f-ic">IC or passport number</label><input class="input" id="f-ic" name="ic" value="${esc(e.idType === 'passport' ? e.ic || '' : S.fmtIC(e.ic || ''))}" placeholder="900115-11-5123" autocomplete="off"></div>
      <div class="field"><label for="f-epfno">EPF member number</label><input class="input" id="f-epfno" name="epfNo" inputmode="numeric" value="${esc(e.epfNo || '')}"></div>
      <div class="field"><label for="f-socsono">SOCSO number</label><input class="input" id="f-socsono" name="socsoNo" value="${esc(e.socsoNo || '')}" placeholder="Same as IC"></div>
      <div class="field"><label for="f-taxno">Income tax number</label><input class="input" id="f-taxno" name="taxNo" value="${esc(e.taxNo || '')}" placeholder="SG 1234567890"></div>
      <div class="field"><label for="f-bank">Bank</label><select class="select" id="f-bank" name="bank"><option value="">Not set</option>${opt(S.BANKS.map((b) => [b, b]), e.bank || '')}</select></div>
      <div class="field"><label for="f-acct">Account number</label><input class="input" id="f-acct" name="accountNo" inputmode="numeric" value="${esc(e.accountNo || '')}" autocomplete="off"></div>
      <div class="field"><label for="f-end">Last day of work</label><input class="input" id="f-end" name="endDate" type="date" value="${esc(e.endDate || '')}"><span class="field-hint">Setting this reminds you to file CP22A.</span></div>
      <div class="field"><label for="f-reason">Reason for leaving</label><select class="select" id="f-reason" name="leaveReason"><option value="">Not leaving</option>${opt(Object.entries(S.REASONS), e.leaveReason || '')}</select></div>`;
  }
  // Called from the employee form. Returns false (and marks the fields) when something must be fixed.
  function validateEmployee(d, form) {
    d.ic = d.idType === 'passport' ? String(d.ic || '').trim().toUpperCase() : String(d.ic || '').replace(/[\s-]/g, '');
    d.accountNo = String(d.accountNo || '').replace(/[\s-]/g, '');
    if (d.endDate && !d.leaveReason) d.leaveReason = 'resign';
    const { errors } = S.checkEmployee(d);
    ctx.$$('.field-error', form).forEach((x) => x.remove());
    if (!errors.length) return true;
    const ids = { ic: 'f-ic', accountNo: 'f-acct', bank: 'f-bank' };
    errors.forEach((x) => { const el = document.getElementById(ids[x.field]); if (!el) return; el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', `${el.id}-err`); el.closest('.field').insertAdjacentHTML('beforeend', `<span class="field-error" id="${el.id}-err">${esc(x.msg)}</span>`); });
    document.getElementById(ids[errors[0].field])?.focus();
    ctx.toast(errors[0].msg, 'error');
    return false;
  }
  // What to tell HR after saving: a new joiner needs CP22, a leaver needs CP22A or CP21.
  function afterSave(before, e) {
    if (!before) { if (!e.cp22Filed) return `File CP22 for ${e.first} by ${fmt(U.addDays(e.start || T(), 30), { day: 'numeric', month: 'short' })}.`; return ''; }
    if (e.endDate && e.endDate !== before.endDate) { e.leaverFiled = ''; return `File ${e.leaveReason === 'abroad' ? 'CP21' : 'CP22A'} for ${e.first} by ${fmt(U.addDays(e.endDate, -30), { day: 'numeric', month: 'short' })}.`; }
    return '';
  }

  // ---------- Settings ----------
  const EMPLOYER_FIELDS = [['ssm', 'SSM registration number', 'Company registration on your SSM certificate'], ['epfNo', 'EPF employer number', 'From KWSP'], ['socsoNo', 'SOCSO employer code', 'From PERKESO'], ['lhdnNo', 'LHDN employer number (E)', 'Your E number for PCB, EA and Form E'], ['hrdNo', 'HRD Corp MyCoID', 'If you pay the HRD Corp levy'], ['address', 'Registered address', 'Printed on payslips and forms'], ['phone', 'Office phone', ''], ['signatory', 'Authorised officer', 'Signs EA, CP22 and CP22A'], ['signatoryTitle', 'Officer’s title', '']];
  const settingsCard = () => `<div class="card" id="stat-ids"><div class="card-head"><h3>Statutory registration</h3><span class="hint">Printed on payslips, files and forms</span></div>
    ${EMPLOYER_FIELDS.map(([k, l, d]) => `<div class="settings-row"><div><div class="label"><label for="emp-${k}">${l}</label></div>${d ? `<div class="desc">${d}</div>` : ''}</div><input class="input" id="emp-${k}" data-employer="${k}" value="${esc(employer()[k] || '')}" style="width:min(280px,100%)"></div>`).join('')}</div>`;
  function bindSettings() {
    ctx.$$('[data-employer]').forEach((el) => el.addEventListener('change', () => { st().settings.employer = { ...employer(), [el.dataset.employer]: el.value.trim() }; ctx.commit('Saved'); }));
  }

  // ---------- Reminders ----------
  const NAMES = { epf: 'EPF', socso: 'SOCSO and EIS', pcb: 'PCB', hrdf: 'HRD Corp levy' };
  function insights() {
    const out = [], r = ctx.role(), add = (tone, icon, title, detail, action, prio) => out.push({ tone, icon, title, detail, action, prio });
    const when = (n) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'due today' : `due in ${n} day${n === 1 ? '' : 's'}`);
    if (r === 'admin') {
      S.dueReminders({ today: T(), payroll: st().payroll, filed: stat().filed, eaIssued: stat().eaIssued, formEFiled: stat().formEFiled }).forEach((x) => {
        if (x.kind === 'statutory') add(x.daysLeft < 0 ? 'bad' : 'warn', 'shield', `${U.fmtMonth(x.month, { month: 'long' })} ${x.open.map((k) => NAMES[k]).join(', ')} ${when(x.daysLeft)}`, `Pay and mark as submitted by ${fmt(x.due, { day: 'numeric', month: 'short' })}.`, { label: 'Files', act: 'pd-open', v: x.month }, 3);
        if (x.kind === 'pay-first') add('warn', 'wallet', `Pay ${U.fmtMonth(x.month, { month: 'long' })} payroll`, `EPF, SOCSO, EIS and PCB for it are due by ${fmt(x.due, { day: 'numeric', month: 'short' })}.`, { label: 'Payroll', href: '#payroll' }, 2);
        if (x.kind === 'ea') add('warn', 'doc', `Issue ${x.year} EA forms`, `Every employee needs theirs by ${fmt(x.due, { day: 'numeric', month: 'short' })}.`, { label: 'EA forms', act: 'pd-year', v: String(x.year) }, 3);
        if (x.kind === 'formE') add('info', 'doc', `File Form E and CP8D for ${x.year}`, `Due ${fmt(x.due, { day: 'numeric', month: 'short' })} on MyTax.`, { label: 'Form E', act: 'pd-year', v: String(x.year) }, 2);
      });
      S.eventForms(allEmployees(), T()).forEach((x) => add(x.daysLeft < 0 ? 'bad' : 'warn', 'doc', `${x.form} for ${x.name.split(' ')[0]} ${when(x.daysLeft)}`, x.form === 'CP22' ? 'Tell LHDN about the new employee within 30 days of starting.' : 'Tell LHDN at least 30 days before the last day.', { label: 'Form', act: 'pd-form', id: x.empId }, x.daysLeft <= 7 ? 3 : 2));
    }
    if (r === 'employee') {
      const e = ctx.me(), y = +T().slice(0, 4) - 1;
      if (stat().eaIssued?.[y] && S.yearItems(st().payroll, y, e.id).length && +T().slice(5, 7) <= 4) add('info', 'doc', `Your ${y} EA form is ready`, 'Use it to file your tax return on MyTax.', { label: 'View', act: 'pd-my-ea', v: String(y) }, 2);
    }
    return out;
  }

  // ---------- Install ----------
  function install(c) {
    ctx = c;
    Object.assign(ctx.ACTIONS, {
      'pd-tab': (_, v) => { ui.tab = v; ctx.render(); },
      'pd-open': (_, mk) => { ui.tab = 'files'; ctx.setPayMonth(mk); location.hash = 'payroll'; ctx.render(); },
      'pd-year': (_, y) => { ui.tab = 'year'; ui.year = +y; location.hash = 'payroll'; ctx.render(); },
      'pd-goto': (_, id) => { location.hash = 'settings'; setTimeout(() => ctx.$('#' + id)?.scrollIntoView({ block: 'start' }), 80); },
      'pd-dl': (k, mk) => {
        const run = st().payroll[mk];
        const f = k === 'bank' ? S.bankFile(run, { ...fctx(mk), template: ui.bankTpl }) : KINDS[k].build(run, fctx(mk));
        download(f.filename, f.csv);
      },
      'pd-filed': (k, mk) => {
        const f = stat().filed[mk] = stat().filed[mk] || {};
        if (f[k]) delete f[k]; else f[k] = T();
        ctx.commit(f[k] ? `${KINDS[k].title} marked as submitted` : 'Marked as not submitted', f[k] ? `${KINDS[k].title} for ${U.fmtMonth(mk)} was submitted` : undefined);
      },
      'pd-slip': (empId, mk) => printSlip(empId, mk),
      'pd-my-slip': (mk) => printSlip(ctx.me().id, mk),
      'pd-slips-all': (_, mk) => printAllSlips(mk),
      'pd-print-preview': () => { const p = ctx.$('#doc-preview'); if (p) printDocs(p.innerHTML, p.dataset.title || 'Allurus'); },
      'pd-ea': (empId) => printEA(empId, ui.year),
      'pd-my-ea': (_, y) => preview(`Borang EA ${y}`, eaHtml(ctx.me(), +y), `EA ${y} ${ctx.fullName(ctx.me())}`),
      'pd-ea-all': () => printDocs(S.yearEmployees(st().payroll, String(ui.year), allEmployees()).map((e) => eaHtml(e, ui.year)).join(''), `EA ${ui.year} ${company()}`),
      'pd-ea-issue': () => { stat().eaIssued[ui.year] = T(); ctx.commit(`${ui.year} EA forms issued. Staff can see them under Payslips.`, `${ui.year} EA forms were issued to staff`); },
      'pd-forme': () => preview(`Form E summary ${ui.year}`, formEHtml(ui.year), `Form E ${ui.year} ${company()}`),
      'pd-forme-filed': () => { const f = stat().formEFiled; if (f[ui.year]) delete f[ui.year]; else f[ui.year] = T(); ctx.commit(f[ui.year] ? `Form E ${ui.year} marked as filed` : 'Marked as not filed'); },
      'pd-cp8d': () => { const f = S.cp8d({ year: String(ui.year), payroll: st().payroll, employees: allEmployees(), employer: employer(), company: company() }); download(f.filename, f.csv); },
      'pd-form': (empId) => { const e = ctx.emp(empId); preview(`${e.endDate ? (e.leaveReason === 'abroad' ? 'CP21' : 'CP22A') : 'CP22'} · ${ctx.fullName(e)}`, eventHtml(empId), `${ctx.fullName(e)} LHDN form`); },
      'pd-form-filed': (empId, form) => { const e = ctx.emp(empId); if (form === 'CP22') e.cp22Filed = T(); else e.leaverFiled = T(); ctx.commit(`${form} for ${e.first} marked as submitted`, `${form} for ${ctx.fullName(e)} was submitted to LHDN`); },
    });
    return {
      tab, tabBar, tabView, myTaxCard, employeeFields, validateEmployee, afterSave, settingsCard, bindSettings, insights,
      bindTabs: () => {
        ctx.$('#pd-year')?.addEventListener('change', (ev) => { ui.year = +ev.target.value; ctx.render(); });
        ctx.$('#pd-tpl')?.addEventListener('change', (ev) => { ui.bankTpl = ev.target.value; ctx.render(); });
      },
    };
  }

  return { install };
})();
