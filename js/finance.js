// Finance & Accounting: bookkeeping, invoices (receivables), bills (payables), budgets and
// monthly reports that the company's external auditor verifies. Verified months are locked.
window.AllurusFinance = (function () {
  'use strict';

  const INCOME_CATS = ['Subscriptions', 'Services', 'Product sales', 'Other income'];
  const EXPENSE_CATS = ['Payroll', 'Rent', 'Utilities', 'Software', 'Marketing', 'Travel', 'Entertainment', 'Training', 'Professional fees', 'Repairs and maintenance', 'Office supplies', 'Bank charges', 'Staff benefits', 'Raw materials', 'Packaging', 'Stock purchases', 'Fuel and transport', 'Other expenses'];
  const r2 = (n) => Math.round(n * 100) / 100;
  const sum = (rows, f) => r2(rows.reduce((s, x) => s + f(x), 0));

  function blank(settings = {}) {
    return {
      openingCash: 0, openingDate: U.today().slice(0, 7) + '-01',
      txns: [], invoices: [], bills: [], contacts: [], budgets: {}, reports: {},
      settings: { taxRate: 8, taxLabel: 'SST', auditorFirm: '', auditorName: '', auditorEmail: '', ...settings },
    };
  }

  // ---------- Calculations (pure; used by the seed and the screens) ----------
  // sub, tax, total; balance = after credit and debit notes (adjust is their net effect); paid and due after
  // payments. Lines in sen, rounded once each (js/invoice-rules.js).
  const invoiceTotals = (inv) => window.AllurusInvoiceRules.totals(inv);
  // Credit, debit and refund notes live with the invoices but are not receivables themselves.
  const isInvoice = (i) => (i.type || 'invoice') === 'invoice';
  const invoiceStatus = (inv, today) => window.AllurusInvoiceRules.shown(inv, today);
  // What a customer still owed on an invoice at the end of a day: sent (not void), less payments made by then.
  const owedAt = (i, end) => {
    if (!window.AllurusInvoiceRules.counts(i) || i.issue > end) return 0;
    const t = invoiceTotals(i);
    if (!i.payments) return i.status === 'Paid' && i.paidOn <= end ? 0 : t.balance;
    return r2(t.balance - i.payments.filter((p) => p.date <= end).reduce((s, p) => s + Number(p.amount || 0), 0));
  };
  const billStatus = (b, today) => (b.status === 'Unpaid' && b.due < today ? 'Overdue' : b.status);

  // Paid payroll runs appear in the books automatically, so nobody keys them in twice.
  // Paid payroll runs appear in the books as wages, employer statutory contributions and reimbursed claims.
  function payrollRows(payroll) {
    return Object.entries(payroll || {}).filter(([, run]) => run.status === 'Paid').flatMap(([mk, run]) => {
      const row = (key, desc, category, amount) => ({ id: `pay-${key}-${mk}`, date: run.paidOn, desc, type: 'out', category, amount, tax: 0, ref: `PAY-${mk.replace('-', '')}`, source: 'payroll', reconciled: true });
      const er = sum(run.items, (i) => i.erCost || 0);
      // Claims post under each category's GL account: reimbursed ones, and taxable ones paid inside gross pay.
      // Runs saved before claim categories post everything to Staff benefits.
      const taxed = sum(run.items, (i) => sum((i.extraLines || []).filter((l) => l.key === 'claims-taxable'), (l) => l.amount));
      const byGL = {};
      run.items.forEach((i) => {
        if (i.claimGL && Object.keys(i.claimGL).length) Object.entries(i.claimGL).forEach(([gl, v]) => { byGL[gl] = r2((byGL[gl] || 0) + v); });
        else if (i.claims) byGL['Staff benefits'] = r2((byGL['Staff benefits'] || 0) + i.claims);
      });
      return [
        row('wages', `Payroll · ${U.fmtMonth(mk)} (${run.items.length} people)`, 'Payroll', r2(sum(run.items, (i) => i.gross) - taxed)),
        er ? row('er', `Employer EPF, SOCSO, EIS and HRD levy · ${U.fmtMonth(mk)}`, 'Payroll', er) : null,
        ...Object.entries(byGL).filter(([, v]) => v).map(([gl, v]) => row(`claims-${gl.toLowerCase().replace(/[^a-z]+/g, '-')}`, `Claims reimbursed with ${U.fmtMonth(mk)} payroll · ${gl}`, gl, v)),
      ].filter(Boolean);
    });
  }
  const allTxns = (fin, payroll) => [...fin.txns, ...payrollRows(payroll)].sort((a, b) => b.date.localeCompare(a.date) || a.desc.localeCompare(b.desc));

  function compute(fin, payroll, mk) {
    const all = allTxns(fin, payroll);
    const start = mk + '-01', end = U.monthEnd(mk);
    const inMonth = all.filter((t) => t.date >= start && t.date <= end);
    const byCat = (type) => {
      const m = {};
      inMonth.filter((t) => t.type === type).forEach((t) => { m[t.category] = r2((m[t.category] || 0) + t.amount); });
      return m;
    };
    const income = byCat('in'), expenses = byCat('out');
    const totalIn = sum(Object.values(income), (v) => v), totalOut = sum(Object.values(expenses), (v) => v);
    const flow = (rows) => rows.reduce((s, t) => s + (t.type === 'in' ? 1 : -1) * (t.amount + t.tax), 0);
    const opening = r2(fin.openingCash + flow(all.filter((t) => t.date < start)));
    const cashIn = sum(inMonth.filter((t) => t.type === 'in'), (t) => t.amount + t.tax);
    const cashOut = sum(inMonth.filter((t) => t.type === 'out'), (t) => t.amount + t.tax);
    const run = payroll?.[mk];
    const pay = run && run.status === 'Paid'
      ? { people: run.items.length, gross: sum(run.items, (i) => i.gross), tax: sum(run.items, (i) => i.tax), benefits: sum(run.items, (i) => i.benefits), net: sum(run.items, (i) => i.net) }
      : null;
    const ar = sum(fin.invoices, (i) => owedAt(i, end));
    const ap = sum(fin.bills.filter((b) => b.issue <= end && (b.status !== 'Paid' || b.paidOn > end)), (b) => b.amount + b.tax);
    return {
      mk, income, expenses, totalIn, totalOut, net: r2(totalIn - totalOut),
      cash: { opening, in: cashIn, out: cashOut, closing: r2(opening + cashIn - cashOut) },
      tax: { output: sum(inMonth.filter((t) => t.type === 'in'), (t) => t.tax), input: sum(inMonth.filter((t) => t.type === 'out'), (t) => t.tax) },
      payroll: pay, ar, ap, count: inMonth.length,
    };
  }
  // A short fingerprint of a month's figures, to tell whether the books changed after submission.
  const fingerprint = (c) => JSON.stringify([c.totalIn, c.totalOut, c.cash.closing, c.tax.output, c.tax.input, c.ar, c.ap, c.count]);

  // ---------- Sample books for the demo company ----------
  function seed({ employees, payroll, customers, today: T }) {
    const r = U.rng(99);
    const fin = blank({ auditorFirm: 'Tan & Partners Chartered Accountants', auditorName: 'Tan Mei Ling', auditorEmail: 'meiling@tanpartners.com.my' });
    const cur = U.monthKey(T), first = U.addMonths(cur, -6);
    fin.openingCash = 180000; fin.openingDate = first + '-01';
    fin.budgets = { Payroll: 140000, 'Staff benefits': 1500, Rent: 4500, Utilities: 700, Software: 2000, Marketing: 5000, Travel: 1500, 'Professional fees': 1500, 'Office supplies': 400, 'Bank charges': 60 };
    const day = (mk, d) => `${mk}-${U.pad(Math.min(d, +U.monthEnd(mk).slice(8)))}`;
    // Entries before the books start are not recorded; their invoices still show as paid.
    const tx = (o) => { if (o.date <= T && o.date >= fin.openingDate) fin.txns.push({ id: U.uid('x'), tax: 0, ref: '', source: 'manual', reconciled: o.date < cur + '-01', ...o }); };

    for (let k = 7; k >= 0; k--) {
      const mk = U.addMonths(cur, -k);
      const gross = payroll[mk] ? sum(payroll[mk].items, (i) => i.gross + (i.erCost || 0) + (i.claims || 0)) : sum(employees, (e) => e.salary / 12) * 1.14;
      const target = gross * 1.28 + 22000;
      const weights = Array.from({ length: 6 }, () => 0.6 + r());
      const wsum = weights.reduce((a, b) => a + b, 0);
      weights.forEach((w, i) => {
        const issue = day(mk, 2 + i * 3);
        if (issue > T) return;
        const cust = customers[Math.floor(r() * customers.length)];
        const service = i % 3 === 2;
        const inv = {
          id: U.uid('i'), no: `INV-${mk.replace('-', '')}-${U.pad(i + 1)}`, customer: cust.name, email: cust.email, issue, due: U.addDays(issue, 30),
          items: [{ desc: service ? 'Mobile app development, milestone payment' : 'Website and app support retainer', qty: 1, price: Math.round((target * w) / wsum / 50) * 50 }],
          taxRate: 8, status: 'Sent', paidOn: '',
        };
        const payDay = U.addDays(issue, 8 + Math.floor(r() * 18));
        const keepOpen = (k === 1 && i === 5) || (k === 2 && i === 5) || (k === 0 && i >= 1);
        if (!keepOpen && payDay <= T) {
          const t = invoiceTotals(inv);
          inv.status = 'Paid'; inv.paidOn = payDay;
          tx({ date: payDay, desc: `Payment from ${cust.name}`, type: 'in', category: service ? 'Services' : 'Subscriptions', amount: t.sub, tax: t.tax, ref: inv.no, source: 'invoice' });
        }
        fin.invoices.push(inv);
      });
      // An annual prepayment in the first month of the books, so the opening month isn't a loss.
      if (mk === first && customers[0]) tx({ date: day(mk, 5), desc: `Annual support retainer prepaid by ${customers[0].name}`, type: 'in', category: 'Subscriptions', amount: 36000, tax: 2880, ref: `PRE-${mk.replace('-', '')}`, source: 'manual' });
      if (k === 0) {
        const cust = customers[Math.floor(r() * customers.length)];
        fin.invoices.push({ id: U.uid('i'), no: `INV-${mk.replace('-', '')}-${U.pad(9)}`, customer: cust.name, email: cust.email, issue: T, due: U.addDays(T, 30), items: [{ desc: 'Annual website and app support retainer', qty: 12, price: 950 }], taxRate: 8, status: 'Draft', paidOn: '' });
      }

      const bill = (supplier, category, d, amount, taxRate, dueDays) => {
        const issue = day(mk, d);
        if (issue > T || k === 7) return;
        const b = { id: U.uid('b'), supplier, ref: `${supplier.replace(/[^A-Z]/g, '').slice(0, 3) || 'BIL'}-${mk.replace('-', '')}`, category, issue, due: U.addDays(issue, dueDays), amount: r2(amount), tax: r2((amount * taxRate) / 100), status: 'Unpaid', paidOn: '' };
        const payDay = U.addDays(issue, Math.min(dueDays, 4 + Math.floor(r() * 9)));
        const leaveUnpaid = k === 0 || (k === 1 && category === 'Marketing');
        if (!leaveUnpaid && payDay <= T) {
          b.status = 'Paid'; b.paidOn = payDay;
          tx({ date: payDay, desc: `${supplier} · ${b.ref}`, type: 'out', category, amount: b.amount, tax: b.tax, ref: b.ref, source: 'bill' });
        }
        fin.bills.push(b);
      };
      bill('Menara Kuantan Properties', 'Rent', 1, 4500, 0, 7);
      bill('Tenaga Nasional Berhad', 'Utilities', 8, 520 + r() * 220, 0, 21);
      bill('Google Workspace and AWS', 'Software', 4, 1600 + r() * 450, 8, 14);
      bill('Kilat Digital Marketing', 'Marketing', 10, 2500 + r() * 3200, 8, 30);
      if (k % 3 === 0) bill('Tan & Partners Chartered Accountants', 'Professional fees', 20, 1500, 8, 30);

      const trips = ['Flight and hotel, client meetings in Kuala Lumpur', 'Petrol, tolls and parking for client visits', 'Grab rides to customer onboarding sessions'];
      tx({ date: day(mk, 6 + Math.floor(r() * 18)), desc: trips[k % 3], type: 'out', category: 'Travel', amount: r2(300 + r() * 1300), purpose: k % 2 === 0 ? 'Client meetings and project handovers for Seri Maju customers' : '' });
      if (k === 1) tx({ date: day(mk, 22), desc: 'Legal fee for office unit purchase, S&P agreement', type: 'out', category: 'Professional fees', amount: 3800, tax: 304, capital: true });
      if (k === 0) {
        tx({ date: day(mk, 3), desc: 'Meta ads and Google Ads campaign', type: 'out', category: 'Marketing', amount: 1850, tax: 148 });
        tx({ date: day(mk, 5), desc: 'Aircond servicing and spare parts', type: 'out', category: 'Repairs and maintenance', amount: 420 });
        tx({ date: day(mk, 7), desc: 'Family vacation, Langkawi', type: 'out', category: 'Other expenses', amount: 2650, personal: true });
      }
      tx({ date: day(mk, 15), desc: 'Office supplies', type: 'out', category: 'Office supplies', amount: r2(120 + r() * 300), tax: 0 });
      tx({ date: U.monthEnd(mk), desc: 'Bank service charges', type: 'out', category: 'Bank charges', amount: r2(35 + r() * 25) });
    }

    // Closed months: older ones already verified by the auditor, last month waiting for review.
    for (let k = 6; k >= 1; k--) {
      const mk = U.addMonths(cur, -k), end = U.monthEnd(mk);
      const submitted = U.addDays(end, 6), verified = U.addDays(end, 12);
      if (submitted > T) continue;
      const c = compute(fin, payroll, mk);
      const rep = { status: 'Submitted', snapshot: c, fp: fingerprint(c), trail: [{ t: submitted, who: 'Aisyah Rahman', action: 'Submitted to auditor', note: '' }] };
      if (k >= 2 && verified <= T) {
        rep.status = 'Verified';
        rep.trail.push({ t: verified, who: 'Tan Mei Ling, Tan & Partners', action: 'Verified', note: 'Bank balance agreed to statement. Payroll, invoices and bills traced to supporting documents. No exceptions.' });
      }
      fin.reports[mk] = rep;
    }
    return fin;
  }

  // ---------- Screens ----------
  function install(ctx) {
    const { VIEWS, AFTER, ACTIONS, esc, icon, money, compactMoney, openModal, closeOverlay, toast, commit, downloadCSV } = ctx;
    const fin = () => ctx.state.finance;
    const pay = () => ctx.state.payroll;
    const T = () => U.today();
    const cur = () => U.monthKey(T());
    const isAuditor = () => ctx.role() === 'auditor';
    const locked = (date) => fin().reports[U.monthKey(date)]?.status === 'Verified';
    const fui = { month: cur(), type: 'all', cat: 'all', q: '', inv: 'all', bill: 'all', budgetMonth: cur() };
    const m2 = (n) => money(n, 2);
    const signed = (t) => `<span class="num ${t.type === 'in' ? 'amt-in' : 'amt-out'}">${t.type === 'in' ? '+' : '−'}${m2(t.amount + t.tax)}</span>`;
    const SOURCE = { invoice: 'Invoice', bill: 'Bill', payroll: 'Payroll', manual: 'Manual', receipt: 'Receipt', claim: 'Claim' };
    const invPill = (s) => `<span class="pill ${({ Draft: '', Sent: 'info', 'Partially paid': 'warn', Overdue: 'bad', Paid: 'ok', Void: 'void' })[s] ?? ''}">${s === 'Partially paid' ? 'Part paid' : s}</span>`;
    const billPill = (s) => `<span class="pill ${({ Unpaid: 'warn', Overdue: 'bad', Paid: 'ok' })[s]}">${s}</span>`;
    const NOTE_NAMES = { invoice: 'Invoice', credit: 'Credit note', debit: 'Debit note', refund: 'Refund note' };
    const noteName = (i) => NOTE_NAMES[i.type || 'invoice'] || 'Invoice';
    const contactOf = (i) => (fin().contacts || []).find((c) => c.id === i.contactId) || (fin().contacts || []).find((c) => c.kind === 'customer' && c.name === i.customer);
    const repStatus = (mk) => {
      if (mk >= cur()) return 'Open';
      return fin().reports[mk]?.status || 'Not submitted';
    };
    const repPill = (s) => `<span class="pill ${({ Open: '', 'Not submitted': 'warn', Submitted: 'info', Verified: 'ok', 'Changes requested': 'bad' })[s]}">${s === 'Submitted' ? 'Awaiting auditor' : s}</span>`;
    const lockedMsg = (date) => `${U.fmtMonth(U.monthKey(date))} is verified by your auditor and locked.`;
    const months = () => {
      const first = U.monthKey(fin().openingDate || T());
      const out = [];
      for (let mk = cur(); mk >= first && out.length < 24; mk = U.addMonths(mk, -1)) out.push(mk);
      return out;
    };
    const who = () => {
      const a = ctx.account();
      return isAuditor() ? `${a?.name || 'Auditor'}${fin().settings.auditorFirm ? ', ' + fin().settings.auditorFirm : ''}` : (a?.name || 'Admin');
    };

    function badge(id) {
      const f = ctx.state.finance; if (!f) return 0;
      if (id === 'invoices') return f.invoices.filter((i) => invoiceStatus(i, T()) === 'Overdue').length;
      if (id === 'bills') return f.bills.filter((b) => billStatus(b, T()) === 'Overdue').length;
      if (id === 'reports') return Object.values(f.reports).filter((r) => r.status === (isAuditor() ? 'Submitted' : 'Changes requested')).length;
      return 0;
    }

    // ----- Overview -----
    function flowChart(list) {
      const data = list.map((mk) => { const c = compute(fin(), pay(), mk); return { mk, in: c.totalIn, out: c.totalOut }; });
      const W = 560, H = 230, L = 52, B = 26, top = 22;
      const max = Math.max(1, ...data.flatMap((d) => [d.in, d.out])) * 1.1;
      const cw = (W - L) / data.length, bw = Math.min(22, cw * 0.28);
      const y = (v) => top + (H - top - B) * (1 - v / max);
      let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money in and out by month">`;
      [0, 0.5, 1].forEach((f) => { svg += `<line class="grid-line" x1="${L}" x2="${W}" y1="${y(max * f / 1.1)}" y2="${y(max * f / 1.1)}"/><text class="axis" x="${L - 8}" y="${y(max * f / 1.1) + 4}" text-anchor="end">${compactMoney(max * f / 1.1)}</text>`; });
      data.forEach((d, i) => {
        const x = L + cw * i + cw / 2 - bw - 2;
        svg += `<rect class="b-in" x="${x}" y="${y(d.in)}" width="${bw}" height="${y(0) - y(d.in)}" rx="4"><title>${U.fmtMonth(d.mk)} money in: ${money(d.in)}</title></rect>`;
        svg += `<rect class="b-out" x="${x + bw + 4}" y="${y(d.out)}" width="${bw}" height="${y(0) - y(d.out)}" rx="4"><title>${U.fmtMonth(d.mk)} money out: ${money(d.out)}</title></rect>`;
        svg += `<text class="axis" x="${x + bw + 2}" y="${H - 6}" text-anchor="middle">${U.fmtMonth(d.mk, { month: 'short' })}${d.mk === cur() ? ' (so far)' : ''}</text>`;
      });
      return svg + '</svg>';
    }

    function budgetRows(mk) {
      const c = compute(fin(), pay(), mk);
      return EXPENSE_CATS.filter((cat) => fin().budgets[cat] || c.expenses[cat]).map((cat) => {
        const budget = fin().budgets[cat] || 0, actual = c.expenses[cat] || 0;
        return { cat, budget, actual, pct: budget ? (actual / budget) * 100 : (actual ? 100 : 0) };
      });
    }
    const budgetBar = (b) => `<div class="progress"><i style="width:${Math.min(100, b.pct)}%;background:${b.pct > 100 ? 'var(--bad)' : b.pct > 85 ? 'var(--warn)' : 'var(--brand)'}"></i></div>`;

    VIEWS.finance = () => {
      const f = fin(), mk = cur(), c = compute(f, pay(), mk);
      const out = f.invoices.filter((i) => isInvoice(i) && window.AllurusInvoiceRules.canPay(i));
      const overdueInv = out.filter((i) => invoiceStatus(i, T()) === 'Overdue');
      const unpaid = f.bills.filter((b) => b.status !== 'Paid');
      const overdueBills = unpaid.filter((b) => billStatus(b, T()) === 'Overdue');
      const due14 = unpaid.filter((b) => b.due <= U.addDays(T(), 14));
      const recent = months().slice(0, 6).reverse();
      const attention = [
        ...overdueInv.map((i) => ({ text: `<strong>${esc(i.customer)}</strong> owes ${money(invoiceTotals(i).due)} on ${esc(i.no)}, due ${U.fmtDate(i.due, { month: 'short', day: 'numeric' })}`, pill: '<span class="pill bad">Overdue invoice</span>', act: `data-act="fin-view-inv" data-id="${i.id}"` })),
        ...overdueBills.map((b) => ({ text: `Pay <strong>${esc(b.supplier)}</strong> ${money(b.amount + b.tax)}, due ${U.fmtDate(b.due, { month: 'short', day: 'numeric' })}`, pill: '<span class="pill bad">Overdue bill</span>', act: 'data-act="fin-go" data-v="bills"' })),
        ...Object.entries(f.reports).filter(([, r]) => r.status === 'Changes requested').map(([k]) => ({ text: `Your auditor asked for changes to the ${U.fmtMonth(k)} report`, pill: '<span class="pill warn">Auditor</span>', act: `data-act="fin-report" data-v="${k}"` })),
        ...months().filter((k) => k < mk && repStatus(k) === 'Not submitted').slice(0, 2).map((k) => ({ text: `${U.fmtMonth(k)} is closed. Submit its report to your auditor.`, pill: '<span class="pill warn">To submit</span>', act: `data-act="fin-report" data-v="${k}"` })),
      ];
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>Finance overview</h1>
          <p class="sub">Invoices, bills and payroll post to the books automatically. Each month's report goes to ${esc(f.settings.auditorFirm || 'your auditor')} to verify, so there is no ledger to keep by hand.</p></div>
          <div class="actions"><button class="btn" data-act="fin-scan">${icon('camera')}Scan receipt</button><button class="btn" data-act="fin-new-txn" data-v="out">${icon('minus')}Record expense</button><button class="btn btn-primary" data-act="fin-new-inv">${icon('plus')}New invoice</button></div></div>
        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Cash in bank</div><div class="kpi-value">${compactMoney(c.cash.closing)}</div><div class="kpi-foot num">${money(c.cash.closing)} today</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:${c.net >= 0 ? 'var(--ok)' : 'var(--bad)'}"></span>Profit this month</div><div class="kpi-value">${compactMoney(c.net)}</div><div class="kpi-foot">${money(c.totalIn)} in · ${money(c.totalOut)} out so far</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Customers owe you</div><div class="kpi-value">${compactMoney(sum(out, (i) => invoiceTotals(i).due))}</div><div class="kpi-foot">${out.length} open invoices${overdueInv.length ? ` · <span style="color:var(--bad)">${overdueInv.length} overdue</span>` : ''}</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--gold)"></span>You owe suppliers</div><div class="kpi-value">${compactMoney(sum(unpaid, (b) => b.amount + b.tax))}</div><div class="kpi-foot">${due14.length} due in 14 days${overdueBills.length ? ` · <span style="color:var(--bad)">${overdueBills.length} overdue</span>` : ''}</div></div>
        </div>
        <div class="grid g-main">
          <div class="card"><div class="card-head"><h3>Money in and out</h3><div class="legend"><span><i style="background:var(--brand)"></i>In</span><span><i style="background:var(--gold)"></i>Out</span></div></div>${flowChart(recent)}</div>
          <div class="card"><div class="card-head"><h3>Auditor sign-off</h3><a class="hint" href="#reports">All reports</a></div>
            <div class="list">${months().slice(0, 5).map((k) => `<div class="list-item" style="cursor:pointer" data-act="fin-report" data-v="${k}"><div class="grow"><div class="person-name">${U.fmtMonth(k)}</div><div class="person-sub">${k === mk ? `Closes ${U.fmtDate(U.monthEnd(k), { month: 'short', day: 'numeric' })}` : `Net ${money(compute(f, pay(), k).net)}`}</div></div>${repPill(repStatus(k))}</div>`).join('')}</div></div>
        </div>
        <div class="grid g-2">
          <div class="card"><div class="card-head"><h3>Budget, ${U.fmtMonth(mk, { month: 'long' })}</h3><a class="hint" href="#budget">Edit budget</a></div>
            ${budgetRows(mk).slice(0, 6).map((b) => `<div class="hbar" style="grid-template-columns:120px minmax(0,1fr) 120px"><span>${esc(b.cat)}</span>${budgetBar(b)}<span class="num r muted">${compactMoney(b.actual)} / ${compactMoney(b.budget)}</span></div>`).join('')}</div>
          <div class="card"><div class="card-head"><h3>Needs attention</h3></div>
            ${attention.length ? `<div class="list">${attention.slice(0, 6).map((a) => `<div class="list-item" style="cursor:pointer" ${a.act}><div class="grow">${a.text}</div>${a.pill}</div>`).join('')}</div>` : '<div class="empty"><strong>All clear</strong>No overdue invoices or bills, and every closed month is with your auditor.</div>'}</div>
        </div>`;
    };

    // ----- Bookkeeping -----
    VIEWS.books = () => {
      const f = fin(), q = fui.q.toLowerCase();
      const rows = allTxns(f, pay()).filter((t) => (fui.month === 'all' || t.date.startsWith(fui.month)) && (fui.type === 'all' || t.type === fui.type) && (fui.cat === 'all' || t.category === fui.cat) && (!q || `${t.desc} ${t.ref} ${t.category}`.toLowerCase().includes(q)));
      const inSum = sum(rows.filter((t) => t.type === 'in'), (t) => t.amount + t.tax), outSum = sum(rows.filter((t) => t.type === 'out'), (t) => t.amount + t.tax);
      const lockedMonth = fui.month !== 'all' && locked(fui.month + '-01');
      const rep = f.reports[fui.month];
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>Bookkeeping</h1><p class="sub">Every ringgit and dollar in and out. Paid invoices, paid bills and payroll are added for you. Record anything else here.</p></div>
          <div class="actions">${isAuditor() ? '' : `<button class="btn btn-primary" data-act="fin-scan">${icon('camera')}Scan receipt</button><button class="btn" data-act="fin-new-txn" data-v="in">${icon('plus')}Record income</button><button class="btn" data-act="fin-new-txn" data-v="out">${icon('minus')}Record expense</button>`}<button class="btn" data-act="fin-export-books">${icon('download')}Export CSV</button></div></div>
        ${lockedMonth ? `<div class="lock-banner">${icon('lock')}<span>${U.fmtMonth(fui.month)} was verified by ${esc(rep.trail[rep.trail.length - 1].who)} on ${U.fmtDate(rep.trail[rep.trail.length - 1].t)}. This month is locked.</span></div>` : ''}
        <div class="card card-flush">
          <div class="toolbar">
            <select class="select" id="bk-month" aria-label="Month"><option value="all">All months</option>${months().map((k) => `<option value="${k}" ${fui.month === k ? 'selected' : ''}>${U.fmtMonth(k)}</option>`).join('')}</select>
            <div class="seg">${[['all', 'All'], ['in', 'Money in'], ['out', 'Money out']].map(([v, l]) => `<button data-act="fin-bk-type" data-v="${v}" class="${fui.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
            <select class="select" id="bk-cat" aria-label="Category"><option value="all">All categories</option>${[...INCOME_CATS, ...EXPENSE_CATS].map((c) => `<option ${fui.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <input class="input" id="bk-q" type="search" placeholder="Search description or reference" value="${esc(fui.q)}" style="flex:1;min-width:180px">
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th class="r hide-sm">Tax</th><th class="r">Amount</th><th class="hide-sm">Reconciled</th><th></th></tr></thead>
            <tbody>${rows.map((t) => `<tr>
              <td class="num muted" style="white-space:nowrap">${U.fmtDate(t.date, { month: 'short', day: 'numeric' })}</td>
              <td><div class="person-name" style="white-space:normal">${esc(t.desc)}</div><div class="person-sub"><span class="tag">${SOURCE[t.source]}</span> ${esc(t.ref || '')}${t.receipt ? ` <button class="link-btn" data-act="fin-receipt" data-id="${t.receipt}">View receipt</button>` : ''}</div></td>
              <td class="hide-sm">${esc(t.category)}${t.type === 'out' && window.AllurusTax ? `<div style="margin-top:3px">${AllurusTax.tag(t)}</div>` : ''}</td>
              <td class="r num muted hide-sm">${t.tax ? m2(t.tax) : '—'}</td>
              <td class="r">${signed(t)}</td>
              <td class="hide-sm">${t.source === 'payroll' || isAuditor() ? (t.reconciled ? `<span class="pill ok">Matched</span>` : '<span class="pill">Not yet</span>') : `<button class="btn btn-sm ${t.reconciled ? 'btn-ok' : ''}" data-act="fin-reconcile" data-id="${t.id}">${t.reconciled ? `${icon('check')}Matched` : 'Match to bank'}</button>`}</td>
              <td><div class="row-actions">${['manual', 'receipt'].includes(t.source) && !isAuditor() && !locked(t.date) ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="fin-del-txn" data-id="${t.id}" aria-label="Delete ${esc(t.desc)}">${icon('trash')}</button>` : locked(t.date) ? `<span class="faint" title="Locked by auditor">${icon('lock')}</span>` : ''}</div></td></tr>`).join('')}</tbody>
            ${rows.length ? `<tfoot><tr><td colspan="2"><strong>${rows.length} entries</strong></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="r num"><div class="amt-in">+${m2(inSum)}</div><div class="amt-out">−${m2(outSum)}</div><strong>${m2(inSum - outSum)}</strong></td><td class="hide-sm"></td><td></td></tr></tfoot>` : ''}
          </table>${rows.length ? '' : '<div class="empty"><strong>No entries match</strong>Try another month or category.</div>'}</div>
        </div>`;
    };
    AFTER.books = () => {
      ctx.$('#bk-month').addEventListener('change', (ev) => { fui.month = ev.target.value; ctx.render(); });
      ctx.$('#bk-cat').addEventListener('change', (ev) => { fui.cat = ev.target.value; ctx.render(); });
      const q = ctx.$('#bk-q');
      q.addEventListener('input', () => { fui.q = q.value; const pos = q.selectionStart; ctx.render(); const n = ctx.$('#bk-q'); n.focus(); n.setSelectionRange(pos, pos); });
    };

    function txnModal(type) {
      const cats = type === 'in' ? INCOME_CATS : EXPENSE_CATS;
      const TX = window.AllurusTax;
      const rate = fin().settings.taxRate, label = fin().settings.taxLabel;
      openModal({
        title: type === 'in' ? 'Record income' : 'Record expense', size: 'sm', submit: 'Save',
        body: `<div class="form-grid">
          <div class="field full"><label for="tx-desc">Description</label><input class="input" id="tx-desc" name="desc" required placeholder="${type === 'in' ? 'Consulting for Bluefin Software' : 'Team lunch with client'}"></div>
          <div class="field"><label for="tx-date">Date</label><input class="input" id="tx-date" name="date" type="date" required value="${T()}" max="${T()}"></div>
          <div class="field"><label for="tx-cat">Category</label><select class="select" id="tx-cat" name="category">${cats.map((c) => `<option ${c === (type === 'in' ? 'Services' : 'Other expenses') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="tx-amt">Amount before tax</label><input class="input num" id="tx-amt" name="amount" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label for="tx-tax">${esc(label)}</label><select class="select" id="tx-tax" name="taxRate"><option value="0">No ${esc(label)}</option><option value="${rate}">${rate}%</option></select></div>
          <div class="field full"><label for="tx-ref">Reference</label><input class="input" id="tx-ref" name="ref" placeholder="Receipt or bank reference"></div>
          ${type === 'out' ? TX.formFields() : ''}</div>`,
        onSubmit(d) {
          if (locked(d.date)) { toast(lockedMsg(d.date), 'error'); return false; }
          const amount = r2(Number(d.amount));
          if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
          const extra = type === 'out' ? TX.readForm(d, d.desc) : {};
          if (extra.personal) toast('Saved as personal. It won’t count as a business deduction.');
          fin().txns.push({ id: U.uid('x'), date: d.date, desc: d.desc.trim(), type, category: d.category, amount, tax: r2((amount * Number(d.taxRate)) / 100), ref: d.ref.trim(), source: 'manual', reconciled: false, ...extra });
          fui.month = U.monthKey(d.date);
          commit(type === 'in' ? 'Income recorded' : 'Expense recorded', `${type === 'in' ? 'Income' : 'Expense'} recorded: ${d.desc.trim()}, ${money(amount)}`);
        },
      });
      if (type === 'out') TX.bindForm(ctx.$('#overlay-root form'), { desc: ['#tx-desc', '#tx-ref'], cat: '#tx-cat' });
    }

    // ----- Invoices -----
    // Every change goes through ctx.invoices (js/invoice-store.js): a Draft is edited freely; Mark as sent locks it;
    // after that only payments, notes and Void (with a reason). The rules are in js/invoice-rules.js.
    const IR = window.AllurusInvoiceRules;
    const store = () => ctx.invoices;
    const reopen = (id) => setTimeout(() => openDoc(id), 50);
    // A refused change: say why. "This invoice changed" reopens it with the latest copy.
    const failed = (r, id) => { if (r.error === 'busy') return; toast(r.message, 'error'); if (r.error === 'changed' && id) { closeOverlay(); reopen(id); } };
    const submitBtn = () => ctx.$('#overlay-root button[type=submit]');
    const working = (on, label) => { const b = submitBtn(); if (b) { b.disabled = on; if (label) b.textContent = label; } };
    // Money received on an invoice, as payments (older paid invoices: the whole balance on the day it was paid).
    const paymentsOf = (i) => (i.payments && i.payments.length ? i.payments : i.status === 'Paid' && i.paidOn ? [{ date: i.paidOn, amount: invoiceTotals(i).balance }] : []);

    // ----- Document lists (SQL Account style): Invoices and Bills share one grid -----
    // Toolbar (acts on the selected row; a button that can't be used says why), filter bar, sortable columns with a
    // chooser remembered per user, a totals row and paging. Click selects, double-click or Enter opens, arrows move.
    function makeList(cfg) {
      const lf = { from: '', to: '', status: 'all', who: '', ref: '', min: '', max: '', sort: 'date', dir: -1, page: 1, size: 50, sel: '' };
      const colsKey = () => `allurus-${cfg.id}-cols:${ctx.account()?.email || 'guest'}`;
      const hiddenCols = () => { try { const v = JSON.parse(localStorage.getItem(colsKey()) || 'null'); return Array.isArray(v) ? v : cfg.hidden; } catch (e) { return cfg.hidden; } };
      const numeric = cfg.cols.filter((c) => c[2]).map((c) => c[0]);
      function rows() {
        const q = (s) => String(s || '').toLowerCase();
        return cfg.rows().filter((r) => {
          if (!cfg.match(r, lf.status)) return false;
          if (lf.from && r.date < lf.from) return false;
          if (lf.to && r.date > lf.to) return false;
          if (lf.who && !q(r.who).includes(q(lf.who))) return false;
          if (lf.ref && !q(r.ref).includes(q(lf.ref))) return false;
          const amt = Math.abs(r[cfg.amountKey]);
          if (lf.min !== '' && amt < Number(lf.min)) return false;
          if (lf.max !== '' && amt > Number(lf.max)) return false;
          return true;
        }).sort((a, b) => {
          const x = a[lf.sort], y = b[lf.sort], c = typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
          return (c || String(a.ref).localeCompare(String(b.ref))) * lf.dir;
        });
      }
      function screen() {
        return `<div class="ledger lg-list-screen" data-list="${cfg.id}">
          <div class="lg-title"><div><h1>${cfg.title}</h1> <span class="lg-faint">Finance &amp; Accounting</span></div><div class="lg-title-r"><span class="lg-faint" id="lg-count"></span></div></div>
          <div class="lg-toolbar" role="toolbar" aria-label="${cfg.title} actions" id="lg-toolbar"></div>
          <form class="lg-filters" id="lg-filters" role="search" aria-label="Filter ${cfg.title.toLowerCase()}" onsubmit="return false">
            <label>From <input class="lg-in" type="date" name="from" value="${lf.from}"></label>
            <label>To <input class="lg-in" type="date" name="to" value="${lf.to}"></label>
            <label>Status <select class="lg-in" name="status">${cfg.statuses.map(([v, l]) => `<option value="${v}" ${lf.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label>${cfg.whoLabel} <input class="lg-in" type="search" name="who" value="${esc(lf.who)}" placeholder="Name"></label>
            <label>${cfg.refLabel} <input class="lg-in" type="search" name="ref" value="${esc(lf.ref)}" placeholder="${cfg.refHint}"></label>
            <label>Amount <input class="lg-in num lg-amt-in" name="min" inputmode="decimal" value="${lf.min}" placeholder="min" aria-label="Amount from"> – <input class="lg-in num lg-amt-in" name="max" inputmode="decimal" value="${lf.max}" placeholder="max" aria-label="Amount to"></label>
            <button type="button" class="lg-linkbtn" data-lg="clear">Clear filters</button>
            <details class="lg-cols"><summary>Columns</summary><div class="lg-cols-pop">${cfg.cols.slice(1).map(([k, l]) => `<label><input type="checkbox" data-col="${k}" ${hiddenCols().includes(k) ? '' : 'checked'}> ${l}</label>`).join('')}</div></details>
          </form>
          <div id="lg-list"></div>
        </div>`;
      }
      function draw() {
        const box = ctx.$('#lg-list'); if (!box) return;
        const all = rows(), hide = hiddenCols(), cols = cfg.cols.filter(([k]) => !hide.includes(k));
        const pages = Math.max(1, Math.ceil(all.length / lf.size)); lf.page = Math.min(lf.page, pages);
        const shown = all.slice((lf.page - 1) * lf.size, lf.page * lf.size);
        if (lf.sel && !all.some((r) => r.id === lf.sel)) lf.sel = '';
        const counted = all.filter(cfg.counted), sumOf = (k) => counted.reduce((s, r) => s + (Number(r[k]) || 0), 0);
        const mark = (k) => (lf.sort === k ? (lf.dir > 0 ? ' ▲' : ' ▼') : '');
        const lead = Math.max(1, cols.findIndex(([k]) => numeric.includes(k)));
        box.innerHTML = `<div class="lg-grid-wrap lg-list-wrap"><table class="lg-grid lg-list" aria-label="${cfg.title}" aria-rowcount="${all.length}">
            <thead><tr>${cols.map(([k, l]) => `<th class="${numeric.includes(k) ? 'r' : ''}" aria-sort="${lf.sort === k ? (lf.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="lg-sort" data-sort="${k}">${l}${mark(k)}</button></th>`).join('')}</tr></thead>
            <tbody>${shown.map((r, n) => `<tr class="lg-row ${lf.sel === r.id ? 'is-sel' : ''}" data-id="${r.id}" tabindex="${lf.sel === r.id || (!lf.sel && n === 0) ? 0 : -1}" aria-selected="${lf.sel === r.id}">${cols.map(([k]) => cfg.cell(r, k)).join('')}</tr>`).join('')
              || `<tr><td colspan="${cols.length}" class="lg-empty">No ${cfg.title.toLowerCase()} match these filters.</td></tr>`}</tbody>
            ${all.length ? `<tfoot><tr class="lg-totals"><td colspan="${lead}"><strong>Total</strong> <span class="lg-faint">${counted.length} ${cfg.totalsNote}</span></td>${cols.slice(lead).map(([k]) => (numeric.includes(k) ? `<td class="r num">${n2(sumOf(k))}</td>` : '<td></td>')).join('')}</tr></tfoot>` : ''}
          </table></div>
          <div class="lg-pager"><span>${all.length ? `${(lf.page - 1) * lf.size + 1}–${Math.min(all.length, lf.page * lf.size)} of ${all.length}` : '0 of 0'}</span>
            <label>Rows per page <select class="lg-in" data-lg="size">${[25, 50, 100, 200].map((n) => `<option ${lf.size === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <button type="button" class="lg-btn" data-lg="prev" ${lf.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span class="num">Page ${lf.page} of ${pages}</span><button type="button" class="lg-btn" data-lg="next" ${lf.page >= pages ? 'disabled' : ''}>Next ›</button></div>`;
        ctx.$('#lg-count').textContent = `${all.length} document${all.length === 1 ? '' : 's'}`;
        toolbar();
      }
      function toolbar() {
        const tb = ctx.$('#lg-toolbar'); if (!tb) return;
        const sel = lf.sel ? cfg.find(lf.sel) : null;
        const btn = ([lg, label, off, cls = '']) => `<button type="button" class="lg-btn ${cls}" data-lg="${lg}" ${off ? `disabled title="${esc(off)}"` : ''}>${label}</button>`;
        tb.innerHTML = `${cfg.tools(sel).map(btn).join('')}<span class="lg-sep" aria-hidden="true"></span>${btn(['csv', 'Export CSV', ''])}${btn(['refresh', 'Refresh', ''])}`;
      }
      function bind() {
        const root = ctx.$('.lg-list-screen'); if (!root) return;
        draw();
        const form = ctx.$('#lg-filters');
        let typing = null;
        const read = () => { const f = new FormData(form); ['from', 'to', 'status', 'who', 'ref', 'min', 'max'].forEach((k) => { lf[k] = String(f.get(k) ?? '').trim(); }); lf.page = 1; draw(); };
        form.addEventListener('input', (ev) => { if (ev.target.dataset.col) return; clearTimeout(typing); typing = setTimeout(read, 200); });
        form.addEventListener('change', (ev) => {
          if (!ev.target.dataset.col) return;
          const hide = cfg.cols.slice(1).map(([k]) => k).filter((k) => !ctx.$(`[data-col="${k}"]`, form).checked);
          try { localStorage.setItem(colsKey(), JSON.stringify(hide)); } catch (e) { /* storage unavailable */ }
          draw();
        });
        const select = (id, focus) => { lf.sel = id; ctx.$$('.lg-row', root).forEach((tr) => { const on = tr.dataset.id === id; tr.classList.toggle('is-sel', on); tr.setAttribute('aria-selected', String(on)); tr.tabIndex = on ? 0 : -1; if (on && focus) tr.focus(); }); toolbar(); };
        root.addEventListener('click', (ev) => {
          const s = ev.target.closest('[data-sort]');
          if (s) { const k = s.dataset.sort; lf.dir = lf.sort === k ? -lf.dir : (k === 'date' || k === 'due' || numeric.includes(k) ? -1 : 1); lf.sort = k; draw(); return; }
          const tr = ev.target.closest('.lg-row');
          if (tr && !ev.target.closest('a')) { select(tr.dataset.id); return; }
          const b = ev.target.closest('[data-lg]'); if (!b || b.disabled) return;
          const k = b.dataset.lg, id = lf.sel;
          if (cfg.act[k]) { cfg.act[k](id); return; }
          ({
            csv: () => cfg.csv(rows()), refresh: () => { ctx.render(); toast('Refreshed', 'info'); },
            clear: () => { Object.assign(lf, { from: '', to: '', status: 'all', who: '', ref: '', min: '', max: '', page: 1 }); ctx.$$('input[name], select[name]', form).forEach((x) => { x.value = x.name === 'status' ? 'all' : ''; }); draw(); },
            prev: () => { lf.page--; draw(); }, next: () => { lf.page++; draw(); },
          }[k] || (() => {}))();
        });
        root.addEventListener('change', (ev) => { if (ev.target.dataset.lg === 'size') { lf.size = Number(ev.target.value); lf.page = 1; draw(); } });
        root.addEventListener('dblclick', (ev) => { const tr = ev.target.closest('.lg-row'); if (tr) cfg.open(tr.dataset.id); });
        root.addEventListener('keydown', (ev) => {
          const tr = ev.target.closest?.('.lg-row'); if (!tr) return;
          if (ev.key === 'Enter') { ev.preventDefault(); cfg.open(tr.dataset.id); }
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const nx = ev.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling; if (nx?.dataset.id) select(nx.dataset.id, true); }
        });
      }
      return { screen, bind, rows };
    }
    const moneyCell = (v, cls = '') => `<td class="r num ${cls}">${v < 0 ? `(${n2(-v)})` : n2(v)}</td>`;

    // Invoices (and credit, debit and refund notes) in the list.
    const invList = makeList({
      id: 'inv', title: 'Invoices', whoLabel: 'Customer', refLabel: 'Doc No', refHint: 'INV-', amountKey: 'amount', totalsNote: 'sent invoices; drafts, void and notes left out',
      cols: [['ref', 'Doc No'], ['date', 'Date'], ['who', 'Customer'], ['items', 'Items'], ['terms', 'Terms'], ['due', 'Due Date'], ['currency', 'Currency'], ['amount', 'Amount (RM)', 1], ['paid', 'Paid', 1], ['balance', 'Balance', 1], ['st', 'Status'], ['einv', 'e-Invoice']],
      hidden: ['currency', 'terms'],
      statuses: [['all', 'All'], ['Draft', 'Draft'], ['Sent', 'Sent'], ['Partially paid', 'Part paid'], ['Overdue', 'Overdue'], ['Paid', 'Paid'], ['Void', 'Void'], ['Notes', 'Credit / debit / refund notes']],
      rows: () => fin().invoices.map((i) => {
        const t = invoiceTotals(i), st = isInvoice(i) ? invoiceStatus(i, T()) : 'Issued', note = !isInvoice(i), sign = note && i.type !== 'debit' ? -1 : 1;
        return { id: i.id, i, st, note, ref: i.no, date: i.issue, who: i.customer, terms: isInvoice(i) ? termsText(contactOf(i)) : '', due: isInvoice(i) ? i.due : '', currency: i.currency || 'MYR',
          amount: note ? sign * t.total : t.balance, paid: note ? 0 : t.paid, balance: note || st === 'Void' || st === 'Draft' ? 0 : t.due,
          items: (i.items || []).map((it) => `${it.desc} · ${IR.fmtQty(it.qty, it.unit)}`).join('; ') };
      }),
      match: (r, s) => (s === 'Notes' ? r.note : s === 'all' || (!r.note && r.st === s)),
      counted: (r) => !r.note && r.st !== 'Void' && r.st !== 'Draft',
      find: (id) => fin().invoices.find((x) => x.id === id),
      cell: (r, k) => {
        const bad = r.st === 'Overdue' ? ' lg-bad' : '';
        if (k === 'ref') return `<td class="num lg-docno"><a href="#invoices?doc=${r.id}" tabindex="-1">${esc(r.ref)}</a>${r.note ? ` <span class="lg-tag">${esc(noteName(r.i))}</span>` : ''}</td>`;
        if (k === 'date') return `<td class="num">${fmtD(r.date)}</td>`;
        if (k === 'due') return `<td class="num${bad}">${fmtD(r.due)}</td>`;
        if (k === 'who') return `<td><div class="lg-ellip lg-w-cust" title="${esc(r.who)}">${esc(r.who)}</div></td>`;
        if (k === 'items') return `<td><div class="lg-ellip lg-w-items lg-faint inv-items" title="${esc(r.items)}">${esc(r.items)}</div></td>`;
        if (k === 'amount') return moneyCell(r.amount, `${r.amount < 0 ? 'lg-neg' : ''}${r.st === 'Void' ? ' lg-strike' : ''}`);
        if (k === 'paid') return r.note ? '<td></td>' : moneyCell(r.paid);
        if (k === 'balance') return r.note || r.st === 'Void' || r.st === 'Draft' ? '<td></td>' : moneyCell(r.balance, bad);
        if (k === 'st') return `<td>${r.note ? '<span class="pill">Issued</span>' : invPill(r.st)}</td>`;
        if (k === 'einv') return `<td>${ctx.einvoice ? ctx.einvoice.pill(r.i.einvoice) : ''}</td>`;
        return `<td>${esc(r[k] ?? '')}</td>`;
      },
      tools: (i) => {
        const ro = isAuditor(), inv = i && isInvoice(i), why = !i ? 'Select an invoice first' : ro ? 'Auditors can only view' : '';
        return [
          ['new', '+ New', ro ? 'Auditors can only view' : '', 'lg-primary'],
          ['edit', 'Edit', why || (!inv ? 'Notes are issued final' : !IR.canEdit(i) ? `${i.status === 'Void' ? 'Void' : 'Sent'} invoices can’t be edited; duplicate it instead` : '')],
          ['dup', 'Duplicate', why || (!inv ? 'Notes can’t be duplicated' : '')],
          ['send', 'Mark as Sent', why || (!IR.canSend(i) ? 'Only a draft can be marked as sent' : '')],
          ['void', 'Void', why || (!IR.canVoid(i) ? ((i.payments || []).length ? 'Has payments: issue a credit note instead' : 'Only a sent invoice with no payments can be voided') : '')],
          ['print', 'Print', !i ? 'Select an invoice first' : ''],
        ];
      },
      act: { new: () => openDoc('new'), edit: (id) => openDoc(id), dup: (id) => duplicateInvoice(id), send: (id) => sendInvoice(id), void: (id) => voidInvoice(id), print: (id) => printInvoice(id) },
      open: (id) => openDoc(id),
      csv: (rs) => exportInvoices(rs.map((r) => r.i)),
    });

    VIEWS.invoices = () => (docParam() ? docScreen(docParam()) : invList.screen());

    // ----- Bills: the same list, a bill screen, and a printout -----
    const openBill = (id) => { const h = `bills?doc=${id}`; if (location.hash.slice(1) === h) ctx.render(); else location.hash = h; };
    const supOf = (name) => (fin().contacts || []).find((c) => c.kind === 'supplier' && c.name.toLowerCase() === String(name || '').trim().toLowerCase());
    const billContact = (b) => (fin().contacts || []).find((c) => c.id === b.contactId) || supOf(b.supplier);
    const billTotal = (b) => r2((Number(b.amount) || 0) + (Number(b.tax) || 0));
    // The same supplier invoice number from the same supplier again: allowed, but warned about.
    const dupBill = (supplier, ref, exceptId) => fin().bills.find((x) => x.id !== exceptId && String(x.ref || '').trim().toLowerCase() === String(ref || '').trim().toLowerCase() && String(x.supplier || '').trim().toLowerCase() === String(supplier || '').trim().toLowerCase());
    const billList = makeList({
      id: 'bill', title: 'Bills', whoLabel: 'Supplier', refLabel: 'Supplier Inv No', refHint: 'Ref', amountKey: 'total', totalsNote: 'bills',
      cols: [['ref', 'Supplier Inv No'], ['date', 'Date'], ['who', 'Supplier'], ['category', 'Category'], ['terms', 'Terms'], ['due', 'Due Date'], ['amount', 'Amount (RM)', 1], ['tax', 'Tax', 1], ['total', 'Total', 1], ['paid', 'Paid', 1], ['balance', 'Balance', 1], ['st', 'Status']],
      hidden: ['terms', 'tax'],
      statuses: [['all', 'All'], ['Unpaid', 'Unpaid'], ['Overdue', 'Overdue'], ['Paid', 'Paid']],
      rows: () => fin().bills.map((b) => { const total = billTotal(b), paid = b.status === 'Paid' ? total : 0; return { id: b.id, b, st: billStatus(b, T()), ref: b.ref, date: b.issue, who: b.supplier, category: b.category, terms: termsText(billContact(b)), due: b.due, amount: Number(b.amount) || 0, tax: Number(b.tax) || 0, total, paid, balance: r2(total - paid) }; }),
      match: (r, s) => s === 'all' || r.st === s,
      counted: () => true,
      find: (id) => fin().bills.find((x) => x.id === id),
      cell: (r, k) => {
        const bad = r.st === 'Overdue' ? ' lg-bad' : '';
        if (k === 'ref') return `<td class="num lg-docno"><a href="#bills?doc=${r.id}" tabindex="-1">${esc(r.ref || '—')}</a>${r.b.selfBilled ? ' <span class="lg-tag">Self-billed</span>' : ''}</td>`;
        if (k === 'date') return `<td class="num">${fmtD(r.date)}</td>`;
        if (k === 'due') return `<td class="num${bad}">${fmtD(r.due)}</td>`;
        if (k === 'who') return `<td><div class="lg-ellip lg-w-cust" title="${esc(r.who)}">${esc(r.who)}</div></td>`;
        if (['amount', 'tax', 'total', 'paid'].includes(k)) return moneyCell(r[k]);
        if (k === 'balance') return moneyCell(r.balance, bad);
        if (k === 'st') return `<td>${billPill(r.st)}</td>`;
        return `<td>${esc(r[k] ?? '')}</td>`;
      },
      tools: (b) => {
        const ro = isAuditor(), why = !b ? 'Select a bill first' : ro ? 'Auditors can only view' : '';
        return [
          ['new', '+ New', ro ? 'Auditors can only view' : '', 'lg-primary'],
          ['open', 'Open', !b ? 'Select a bill first' : ''],
          ['pay', 'Pay today', why || (b.status === 'Paid' ? 'Already paid' : '')],
          ['del', 'Delete', why || (b.status === 'Paid' ? 'Paid bills can’t be deleted' : '')],
          ['print', 'Print', !b ? 'Select a bill first' : ''],
        ];
      },
      act: { new: () => openBill('new'), open: (id) => openBill(id), pay: (id) => payBill(id), del: (id) => deleteBill(id), print: (id) => printBill(id) },
      open: (id) => openBill(id),
      csv: (rs) => downloadCSV(`bills-${T()}.csv`, [['Supplier Inv No', 'Self-billed No', 'Date', 'Supplier', 'Category', 'Description', 'Due Date', 'Amount', fin().settings.taxLabel, 'Total', 'Status', 'Paid On'],
        ...rs.map((r) => [r.ref, r.b.selfNo || '', r.date, r.who, r.category, r.b.note || '', r.due, r.amount, r.tax, r.total, r.st, r.b.paidOn || ''])]),
    });

    VIEWS.bills = () => (docParam() ? billScreen(docParam()) : billList.screen());
    AFTER.bills = () => { if (docParam()) bindBill(); else billList.bind(); };

    // A new bill (as before: a single amount with its tax) or a saved bill, read-only.
    function billScreen(param) {
      const isNew = param === 'new', b = isNew ? null : fin().bills.find((x) => x.id === param);
      if (!isNew && !b) return `<div class="ledger lg-doc"><p class="lg-pad">That bill isn’t here any more. <a href="#bills">Back to bills</a></p></div>`;
      if (isNew && isAuditor()) return `<div class="ledger lg-doc"><p class="lg-pad">Auditors can’t add bills. <a href="#bills">Back to bills</a></p></div>`;
      const rate = fin().settings.taxRate, label = fin().settings.taxLabel, c = b ? billContact(b) : null, st = b ? billStatus(b, T()) : 'Unpaid';
      const ro = (v) => `<span class="lg-ro">${v || '<span class="lg-faint">—</span>'}</span>`;
      const fld = (id, lbl, html) => `<div class="lg-f"><label ${id ? `for="${id}"` : ''}>${lbl}</label>${html}</div>`;
      const sups = (fin().contacts || []).filter((x) => x.kind === 'supplier').map((x) => x.name).sort();
      const cats = EXPENSE_CATS.filter((x) => x !== 'Payroll');
      let bar = '<button type="button" class="lg-btn" data-lg="close">Close</button>';
      if (b) bar += `<button type="button" class="lg-btn" data-lg="print">Print / PDF</button>`;
      if (b?.selfBilled) bar += `<button type="button" class="lg-btn" data-act="einv-bill" data-id="${b.id}">Self-billed e-Invoice</button>`;
      if (b && !isAuditor() && b.status !== 'Paid') bar += '<button type="button" class="lg-btn" data-lg="del">Delete</button><button type="button" class="lg-btn lg-primary" data-lg="pay">Pay today</button>';
      if (isNew) bar += '<button type="button" class="lg-btn lg-primary" data-lg="save">Save Bill</button>';
      const amtRow = isNew
        ? `<tr><td class="lg-no num">1</td><td><input class="lg-in" id="bl-desc" name="desc" maxlength="140" placeholder="Google Ads campaign, office rental, aircond servicing" aria-label="What is it for"></td>
            <td><select class="lg-in" id="bl-cat" name="category" aria-label="Category">${cats.map((x) => `<option>${x}</option>`).join('')}</select></td>
            <td class="r"><input class="lg-in num" id="bl-amt" name="amount" inputmode="decimal" required aria-label="Amount before tax"></td>
            <td><select class="lg-in" id="bl-tax" name="taxRate" aria-label="${esc(label)}"><option value="0">No ${esc(label)}</option><option value="${rate}">${rate}%</option></select></td>
            <td class="r num lg-amt" id="bl-total"></td></tr>`
        : `<tr><td class="lg-no num">1</td><td class="lg-desc">${esc(b.note || b.category)}</td><td>${esc(b.category)}</td><td class="r num">${n2(b.amount)}</td><td class="r num">${n2(b.tax)}</td><td class="r num">${n2(billTotal(b))}</td></tr>`;
      return `<div class="ledger lg-doc ${isNew ? 'is-edit' : 'is-read'}" data-bill="${b ? b.id : 'new'}">
        <div class="lg-title"><div><a class="lg-back" href="#bills">Bills</a> / <h1>Bill</h1></div>
          <div class="lg-title-r"><span class="lg-lock">${isNew ? 'New: editable' : 'Saved'}</span>${billPill(st)}<strong class="num">${b ? esc(b.ref) : '(new)'}</strong></div></div>
        ${b ? `<div class="lg-history">Bill date ${fmtD(b.issue)}${b.selfNo ? ` · Self-billed ${esc(b.selfNo)}` : ''}${b.paidOn ? ` · Paid ${fmtD(b.paidOn)}` : ''}</div>` : ''}
        <form id="bl-form" onsubmit="return false">
        <div class="lg-head">
          <div class="lg-col">
            ${fld('bl-sup', 'Supplier', isNew ? `<input class="lg-in" id="bl-sup" name="supplier" list="bl-sup-list" required autocomplete="off"><datalist id="bl-sup-list">${sups.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ro(esc(b.supplier)))}
            ${fld('', 'Address', `<span class="lg-ro lg-addr" id="bl-addr">${addrLines(c?.address).map(esc).join('<br>') || '<span class="lg-faint">No address on file</span>'}</span>`)}
            ${fld('', 'Phone', `<span class="lg-ro" id="bl-phone">${esc(c?.phone || '') || '<span class="lg-faint">—</span>'}</span>`)}
          </div>
          <div class="lg-col">
            ${fld('bl-ref', 'Supplier Inv No', isNew ? `<input class="lg-in" id="bl-ref" name="ref" required autocomplete="off"><small class="lg-cell-err" id="bl-dup" role="status" hidden></small>` : ro(`<span class="num">${esc(b.ref)}</span>`))}
            ${fld('bl-issue', 'Bill Date', isNew ? `<input class="lg-in num" id="bl-issue" name="issue" type="date" value="${T()}" required>` : ro(fmtD(b.issue)))}
            ${fld('', 'Terms', `<span class="lg-ro" id="bl-terms">${termsText(c) || '<span class="lg-faint">—</span>'}</span>`)}
            ${fld('bl-due', 'Due Date', isNew ? `<input class="lg-in num" id="bl-due" name="due" type="date" value="${U.addDays(T(), 30)}" required>` : ro(`<span class="${st === 'Overdue' ? 'lg-bad' : ''}">${fmtD(b.due)}</span>`))}
          </div>
          <div class="lg-col">
            ${isNew ? `<label class="lg-check"><input type="checkbox" name="selfBilled"> Self-billed: we issue the e-Invoice for this supplier (for example a freelancer, an agent or a foreign supplier)</label>` : b.selfBilled ? fld('', 'e-Invoice', ro(ctx.einvoice ? ctx.einvoice.pill(b.einvoice) : '')) : ''}
            ${!isNew && b.purpose ? fld('', 'Purpose', ro(esc(b.purpose))) : ''}
            ${!isNew && b.bizPct != null && b.bizPct < 100 ? fld('', 'Business use', ro(`${b.bizPct}%`)) : ''}
          </div>
        </div>
        <div class="lg-grid-wrap"><table class="lg-grid lg-bill-grid" aria-label="Bill amount">
          <thead><tr><th class="lg-no">No</th><th>Description</th><th>Category</th><th class="r">Amount (RM)</th><th>${esc(label)}</th><th class="r">Total (RM)</th></tr></thead>
          <tbody>${amtRow}</tbody></table></div>
        ${isNew ? `<div class="lg-taxfields form-grid">${window.AllurusTax.formFields()}</div>` : ''}
        </form>
        <div class="lg-errors" id="lg-errors" role="alert" hidden></div>
        <div class="lg-foot"><div class="lg-foot-l"><p class="lg-words" id="bl-words">${b ? esc(IR.amountInWords(billTotal(b))) : ''}</p></div>
          <div class="lg-sum">
            <div><span>Amount</span><span class="num" id="bl-s-amt">${n2(b?.amount || 0)}</span></div>
            <div><span>${esc(label)}</span><span class="num" id="bl-s-tax">${n2(b?.tax || 0)}</span></div>
            <div class="lg-total"><span>Total (RM)</span><span class="num" id="bl-s-total">${n2(b ? billTotal(b) : 0)}</span></div>
            ${b ? `<div><span>Paid</span><span class="num">${n2(b.status === 'Paid' ? billTotal(b) : 0)}</span></div><div class="lg-total"><span>Balance</span><span class="num ${st === 'Overdue' ? 'lg-bad' : ''}">${n2(b.status === 'Paid' ? 0 : billTotal(b))}</span></div>` : ''}
          </div></div>
        <div class="lg-bar">${isNew ? '<span class="lg-keys">Tab next field · Ctrl+S save · Esc close</span>' : '<span></span>'}<div class="lg-bar-btns">${bar}</div></div>
      </div>`;
    }
    function bindBill() {
      const root = ctx.$('.lg-doc[data-bill]'); if (!root) return;
      lg.dirty = false;
      const id = root.dataset.bill === 'new' ? null : root.dataset.bill;
      ctx.$('[data-lg=close]', root).addEventListener('click', () => closeDoc());
      ctx.$('[data-lg=print]', root)?.addEventListener('click', () => printBill(id));
      ctx.$('[data-lg=pay]', root)?.addEventListener('click', () => payBill(id));
      ctx.$('[data-lg=del]', root)?.addEventListener('click', () => deleteBill(id));
      if (id) return;
      const form = ctx.$('#bl-form');
      window.AllurusTax.bindForm(form, { desc: ['#bl-sup', '#bl-desc'], cat: '#bl-cat' });
      const refresh = () => {
        const amount = r2(Number(ctx.$('#bl-amt').value) || 0), tax = r2((amount * Number(ctx.$('#bl-tax').value)) / 100);
        ctx.$('#bl-total').textContent = amount ? n2(amount + tax) : '';
        ctx.$('#bl-s-amt').textContent = n2(amount); ctx.$('#bl-s-tax').textContent = n2(tax); ctx.$('#bl-s-total').textContent = n2(amount + tax);
        ctx.$('#bl-words').textContent = amount ? IR.amountInWords(amount + tax) : '';
        const dup = dupBill(ctx.$('#bl-sup').value, ctx.$('#bl-ref').value), w = ctx.$('#bl-dup');
        w.hidden = !dup; w.textContent = dup ? `Already entered: a bill from this supplier with this number (${fmtD(dup.issue)}, RM ${n2(billTotal(dup))}).` : '';
      };
      root.addEventListener('input', () => { lg.dirty = true; refresh(); });
      root.addEventListener('change', (ev) => {
        lg.dirty = true;
        if (ev.target.id === 'bl-sup' || ev.target.id === 'bl-issue') {
          const c = supOf(ctx.$('#bl-sup').value);
          ctx.$('#bl-addr').innerHTML = addrLines(c?.address).map(esc).join('<br>') || '<span class="lg-faint">No address on file</span>';
          ctx.$('#bl-phone').textContent = c?.phone || '—'; ctx.$('#bl-terms').textContent = termsText(c) || '—';
          if (c) { ctx.$('#bl-due').value = U.addDays(ctx.$('#bl-issue').value, termDays(c)); if (c.category && [...ctx.$('#bl-cat').options].some((o) => o.value === c.category)) ctx.$('#bl-cat').value = c.category; }
        }
        refresh();
      });
      const save = () => {
        const d = Object.fromEntries(new FormData(form).entries()), box = ctx.$('#lg-errors'), errs = [];
        if (!String(d.supplier || '').trim()) errs.push('Add the supplier');
        if (!String(d.ref || '').trim()) errs.push('Add the supplier invoice number');
        if (!(Number(d.amount) > 0)) errs.push('Enter an amount above zero');
        if (d.due && d.issue && d.due < d.issue) errs.push('The due date must be on or after the bill date');
        if (errs.length) { box.hidden = false; box.innerHTML = `<ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`; return; }
        const dup = dupBill(d.supplier, d.ref);
        if (dup && !confirm(`A bill from ${d.supplier.trim()} with number ${d.ref.trim()} is already entered (${fmtD(dup.issue)}). Save this one too?`)) return;
        const nb = createBill(d);
        lg.dirty = false;
        openBill(nb.id);
      };
      ctx.$('[data-lg=save]', root).addEventListener('click', save);
      root.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); } });
      refresh();
      setTimeout(() => ctx.$('#bl-sup')?.focus(), 0);
    }
    // Adding a bill: exactly as before (a single amount, its tax, the tax-relief details and the self-billed number).
    function createBill(d) {
      const amount = r2(Number(d.amount));
      const extra = window.AllurusTax.readForm(d, `${d.supplier} ${d.desc}`);
      const sup = supOf(d.supplier);
      const self = d.selfBilled === 'on';
      const nb = { id: U.uid('b'), supplier: sup?.name || d.supplier.trim(), contactId: sup?.id || '', ref: d.ref.trim(), category: d.category, issue: d.issue, due: d.due, amount, tax: r2((amount * Number(d.taxRate)) / 100), status: 'Unpaid', paidOn: '', note: (d.desc || '').trim(), ...extra, ...(self ? { selfBilled: true, selfNo: `SBI-${d.issue.slice(0, 7).replace('-', '')}-${U.pad(fin().bills.filter((x) => x.selfBilled && x.issue.slice(0, 7) === d.issue.slice(0, 7)).length + 1)}`, einvoice: { status: 'Draft' } } : {}) };
      fin().bills.push(nb);
      if (self) setTimeout(() => ctx.ACTIONS['einv-bill']?.(nb.id), 60);
      commit('Bill added', `Bill from ${d.supplier.trim()} added, ${money(amount)}`);
      return nb;
    }
    function payBill(id) {
      const b = fin().bills.find((x) => x.id === id); if (!b || b.status === 'Paid') return;
      confirmInv(`Pay ${b.supplier} today?`, `<p>Records RM ${n2(billTotal(b))} paid today for ${esc(b.ref)}, and adds it to the books.</p>`, 'Pay today', () => {
        ctx.ACTIONS['fin-pay-bill'](id); closeOverlay(); if (docParam()) openBill(id); return Promise.resolve({ ok: true });
      });
    }
    function deleteBill(id) {
      const b = fin().bills.find((x) => x.id === id); if (!b || b.status === 'Paid') return;
      confirmInv(`Delete bill ${b.ref}?`, `<p>The bill from ${esc(b.supplier)} is removed. Paid bills can’t be deleted.</p>`, 'Delete bill', () => {
        ctx.ACTIONS['fin-del-bill'](id); closeOverlay(); lg.dirty = false; location.hash = 'bills'; return Promise.resolve({ ok: true });
      });
    }
    // The bill printed for the file (A4, the same layout as invoices).
    function printBill(id) {
      const b = fin().bills.find((x) => x.id === id); if (!b) return;
      const s = ctx.state.settings, c = billContact(b), st = billStatus(b, T()), total = billTotal(b);
      const kv = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '');
      const html = `<div class="pdoc">
        <header class="pdoc-top"><div class="pdoc-co"><div class="pdoc-coname">${esc(s.company)}</div><div>Purchase record</div></div>
          <div class="pdoc-title"><div class="pdoc-h">${b.selfBilled ? 'SELF-BILLED INVOICE' : 'SUPPLIER BILL'}</div><table class="pdoc-kv">${kv('Supplier Inv No', `<strong>${esc(b.ref)}</strong>`)}${b.selfNo ? kv('Self-billed No', esc(b.selfNo)) : ''}${kv('Date', fmtD(b.issue))}</table></div></header>
        <div class="pdoc-boxes"><div class="pdoc-box"><div class="pdoc-boxh">Supplier</div><strong>${esc(b.supplier)}</strong>${addrLines(c?.address).map((l) => `<div>${esc(l)}</div>`).join('')}${c?.tin ? `<div>TIN: ${esc(c.tin)}</div>` : ''}${c?.phone ? `<div>Tel: ${esc(c.phone)}</div>` : ''}</div>
          <div class="pdoc-box"><table class="pdoc-kv">${kv('Bill Date', fmtD(b.issue))}${kv('Terms', esc(termsText(c)))}${kv('Due Date', fmtD(b.due))}${kv('Category', esc(b.category))}${kv('Status', esc(st))}${b.paidOn ? kv('Paid on', fmtD(b.paidOn)) : ''}</table></div></div>
        <table class="pdoc-lines"><thead><tr><th class="c">No</th><th>Description</th><th class="r">Amount (RM)</th></tr></thead>
          <tbody><tr><td class="c">1</td><td class="pdoc-desc">${esc(b.note || b.category)}</td><td class="r">${n2(b.amount)}</td></tr></tbody></table>
        <div class="pdoc-end"><div class="pdoc-words"><div class="pdoc-boxh">Amount in words</div>${esc(IR.amountInWords(total))}</div>
          <table class="pdoc-sum"><tr><th>Amount</th><td>${n2(b.amount)}</td></tr><tr><th>${esc(fin().settings.taxLabel)}</th><td>${n2(b.tax)}</td></tr><tr class="pdoc-grand"><th>Total (RM)</th><td>${n2(total)}</td></tr>
            ${b.status === 'Paid' ? `<tr><th>Paid</th><td>-${n2(total)}</td></tr><tr class="pdoc-grand"><th>Balance (RM)</th><td>0.00</td></tr>` : ''}</table></div>
        <div class="pdoc-sign"><div><span></span>Checked by</div><div><span></span>Approved by</div></div>
      </div>`;
      ctx.docs.printDocs(html, `Bill ${b.ref}`);
    }

    AFTER.invoices = () => { if (docParam()) bindDoc(); else invList.bind(); };

    // ----- The document screen (SQL Account style): #invoices?doc=<id> or #invoices?doc=new -----
    // One screen for entering a draft and for reading a sent invoice or a note: header fields, a line grid, totals
    // with the amount in words, and an action bar. A draft is edited in place; anything else is read-only text.
    // Keyboard: Tab across the grid, Enter to the next cell (a new line from the last one), Ctrl+S saves, Esc closes.
    const docParam = () => new URLSearchParams(location.hash.split('?')[1] || '').get('doc');
    const openDoc = (id) => { const h = `invoices?doc=${id}`; if (location.hash.slice(1) === h) ctx.render(); else location.hash = h; };
    const lg = { dirty: false, saving: false };
    const MIN_ROWS = 10;
    const termDays = (c) => (c?.terms === 'COD' ? 0 : Number(c?.terms) || 30);
    const termsText = (c) => (!c ? '' : c.terms === 'COD' ? 'COD' : `Net ${termDays(c)}`);
    const addrLines = (a) => (a ? [a.line1, a.line2, a.line3, [a.postcode, a.city].filter(Boolean).join(' '), window.AllurusEInvoiceRules?.STATES[a.state]].filter(Boolean) : []);
    const custOf = (name) => (fin().contacts || []).find((c) => c.kind === 'customer' && c.name.toLowerCase() === String(name || '').trim().toLowerCase());
    const fmtD = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');   // DD/MM/YYYY, whatever the browser's language
    const when = (ms) => (ms ? fmtD(new Date(ms).toISOString().slice(0, 10)) : '');
    const n2 = (n) => Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function docScreen(param) {
      const isNew = param === 'new', i = isNew ? null : fin().invoices.find((x) => x.id === param);
      if (!isNew && !i) return `<div class="ledger lg-doc"><p class="lg-pad">That invoice isn’t here any more. <a href="#invoices">Back to invoices</a></p></div>`;
      if (isNew && isAuditor()) return `<div class="ledger lg-doc"><p class="lg-pad">Auditors can’t create invoices. <a href="#invoices">Back to invoices</a></p></div>`;
      const edit = isNew || (IR.canEdit(i) && !isAuditor());
      const d = i || { customer: '', email: '', issue: T(), due: U.addDays(T(), 30), items: [], taxRate: fin().settings.taxRate, notes: '' };
      const st = i ? (isInvoice(i) ? invoiceStatus(i, T()) : 'Issued') : 'Draft';
      const c = custOf(d.customer) || (i ? contactOf(i) : null);
      const t = invoiceTotals(d), label = fin().settings.taxLabel;
      const custs = [...new Set([...(fin().contacts || []).filter((x) => x.kind === 'customer').map((x) => x.name), ...fin().invoices.map((x) => x.customer)])].sort();
      const ro = (v) => `<span class="lg-ro">${v || '<span class="lg-faint">—</span>'}</span>`;
      const fld = (id, lbl, html) => `<div class="lg-f"><label ${id ? `for="${id}"` : ''}>${lbl}</label>${html}</div>`;
      const lockNote = st === 'Draft' ? '<span class="lg-lock">Draft: editable</span>' : st === 'Void' ? '<span class="lg-lock">Void: locked</span>' : isInvoice(d) ? '<span class="lg-lock">Sent: locked</span>' : '<span class="lg-lock">Issued: locked</span>';
      // Lines: a draft always shows at least 10 rows to type into.
      const unitSel = (u, n) => `<select class="lg-in" name="u" aria-label="Line ${n} unit">${IR.UNITS.map((x) => `<option value="${x.code}" ${x.code === u ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`;
      const editRow = (it, n) => `<tr class="lg-line">
          <td class="lg-no num">${n}</td>
          <td><textarea class="lg-in" name="d" rows="1" maxlength="200" aria-label="Line ${n} description">${esc(it.desc || '')}</textarea></td>
          <td class="r"><input class="lg-in num" name="q" inputmode="decimal" value="${it.qty ?? ''}" aria-label="Line ${n} quantity" autocomplete="off"><small class="lg-cell-err" role="alert" hidden></small></td>
          <td>${unitSel(it.unit || IR.DEFAULT_UNIT, n)}</td>
          <td class="r"><input class="lg-in num" name="p" inputmode="decimal" value="${it.price ?? ''}" aria-label="Line ${n} unit price" autocomplete="off"></td>
          <td class="r num lg-amt"></td>
          <td class="lg-rowact"><button type="button" data-row="up" aria-label="Move line ${n} up" title="Move up">↑</button><button type="button" data-row="down" aria-label="Move line ${n} down" title="Move down">↓</button><button type="button" data-row="ins" aria-label="Insert a line above line ${n}" title="Insert above">⊕</button><button type="button" data-row="del" aria-label="Delete line ${n}" title="Delete">✕</button></td></tr>`;
      const readRow = (it, n) => `<tr><td class="lg-no num">${n}</td><td class="lg-desc">${esc(it.desc)}</td><td class="r num">${Number(it.qty).toLocaleString('en-MY', { maximumFractionDigits: 3 })}</td><td>${esc(IR.unitOf(it.unit).label)}</td><td class="r num">${n2(it.price)}</td><td class="r num">${n2(IR.lineSen(it) / 100)}</td><td></td></tr>`;
      const items = d.items || [];
      const rows = edit ? [...items, ...Array(Math.max(0, MIN_ROWS - items.length)).fill({})].map((it, k) => editRow(it, k + 1)).join('') : items.map((it, k) => readRow(it, k + 1)).join('');
      // Payments and history for a saved document.
      const pays = i && isInvoice(i) ? paymentsOf(i) : [];
      const notes = i && isInvoice(i) ? fin().invoices.filter((x) => x.ref === i.id) : [];
      const orig = i?.ref ? fin().invoices.find((x) => x.id === i.ref) : null;
      const history = i ? [
        i.createdAt ? `Created ${when(i.createdAt)}` : '',
        i.duplicatedFrom ? `Duplicated from <a href="#invoices?doc=${esc(i.duplicatedFrom.id)}">${esc(i.duplicatedFrom.no)}</a>` : '',
        i.sentAt ? `Sent ${when(i.sentAt)}` : '',
        ...pays.map((p) => `Paid RM ${n2(p.amount)} on ${fmtD(p.date)}`),
        ...notes.map((x) => `${esc(noteName(x))} <a href="#invoices?doc=${x.id}">${esc(x.no)}</a>`),
        orig ? `For invoice <a href="#invoices?doc=${orig.id}">${esc(orig.no)}</a>` : '',
        i.voidedAt || i.status === 'Void' ? `Voided ${when(i.voidedAt)}${i.voidReason ? `: ${esc(i.voidReason)}` : ''}` : '',
      ].filter(Boolean) : [];
      // The action bar.
      const b = (act, txt, cls = '', v = '', dis = '') => `<button type="button" class="lg-btn ${cls}" data-act="${act}" ${i ? `data-id="${i.id}"` : ''}${v ? ` data-v="${v}"` : ''}${dis ? ` disabled title="${esc(dis)}"` : ''}>${txt}</button>`;
      let bar = `<button type="button" class="lg-btn" data-lg="close">Close</button>`;
      if (i) bar += b('fin-print-inv', 'Print / PDF');
      if (i && isInvoice(i) && !isAuditor()) bar += b('fin-dup-inv', 'Duplicate');
      if (edit) bar += `${i ? b('fin-del-inv', 'Delete draft') : ''}<button type="button" class="lg-btn" data-lg="send">Mark as Sent</button><button type="button" class="lg-btn lg-primary" data-lg="save">Save Draft</button>`;
      else if (i && isInvoice(i) && !isAuditor()) {
        if (IR.canPay(i)) bar += `${b('fin-note', 'Credit note', '', 'credit')}${b('fin-note', 'Debit note', '', 'debit')}${b('fin-void-inv', 'Void', '', '', IR.canVoid(i) ? '' : 'An invoice with payments can’t be voided; issue a credit note')}${b('fin-pay-inv', 'Record payment', 'lg-primary')}`;
        else if (i.status === 'Paid') bar += b('fin-note', 'Refund note');
      }
      return `<div class="ledger lg-doc ${edit ? 'is-edit' : 'is-read'}" data-doc="${i ? i.id : 'new'}">
        <div class="lg-title"><div><a class="lg-back" href="#invoices">Invoices</a> / <h1>${i && !isInvoice(i) ? esc(noteName(i)) : 'Invoice'}</h1></div>
          <div class="lg-title-r">${lockNote}${i ? (isInvoice(i) ? invPill(st) : '<span class="pill">Issued</span>') : invPill('Draft')}<strong class="num">${i ? esc(i.no) : '(new)'}</strong></div></div>
        ${history.length ? `<div class="lg-history">${history.join('<span aria-hidden="true"> · </span>')}</div>` : ''}
        <div class="lg-head">
          <div class="lg-col">
            ${fld('lg-cust', 'Customer', edit ? `<input class="lg-in" id="lg-cust" list="lg-cust-list" value="${esc(d.customer)}" autocomplete="off" required><datalist id="lg-cust-list">${custs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ro(esc(d.customer)))}
            ${fld('', 'Bill To', `<span class="lg-ro lg-addr" id="lg-addr">${addrLines(c?.address).map(esc).join('<br>') || '<span class="lg-faint">No address on file</span>'}${c ? ` <a href="#contacts" class="lg-link">Edit</a>` : ''}</span>`)}
            ${fld('', 'Phone', `<span class="lg-ro" id="lg-phone">${esc(c?.phone || '') || '<span class="lg-faint">—</span>'}</span>`)}
            ${fld('lg-email', 'Email', edit ? `<input class="lg-in" id="lg-email" type="email" value="${esc(d.email || '')}">` : ro(esc(d.email || c?.email || '')))}
          </div>
          <div class="lg-col">
            ${fld('', 'Doc No', ro(`<span class="num">${i ? esc(i.no) : 'Given when saved'}</span>`))}
            ${fld('lg-issue', 'Date', edit ? `<input class="lg-in num" id="lg-issue" type="date" value="${d.issue}" required>` : ro(fmtD(d.issue)))}
            ${isInvoice(d) ? fld('', 'Terms', `<span class="lg-ro" id="lg-terms">${termsText(c) || '<span class="lg-faint">—</span>'}</span>`) : ''}
            ${isInvoice(d) ? fld('lg-due', 'Due Date', edit ? `<input class="lg-in num" id="lg-due" type="date" value="${d.due}" required>` : ro(`<span class="${st === 'Overdue' ? 'lg-bad' : ''}">${fmtD(d.due)}</span>`)) : ''}
            ${d.currency && d.currency !== 'MYR' ? fld('', 'Currency', ro(esc(d.currency))) : ''}
          </div>
          <div class="lg-col">
            ${i?.reason ? fld('', 'Reason', ro(esc(i.reason))) : ''}
            ${st === 'Void' ? fld('', 'Void reason', ro(`<span class="lg-bad">${esc(i.voidReason || '')}</span>`)) : ''}
            ${i && ctx.einvoice ? fld('', 'e-Invoice', ro(ctx.einvoice.pill(i.einvoice))) : ''}
          </div>
        </div>
        <div class="lg-grid-wrap"><table class="lg-grid" aria-label="Invoice lines">
          <thead><tr><th class="lg-no">No</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit Price</th><th class="r">Amount (RM)</th><th><span class="sr-only">Line actions</span></th></tr></thead>
          <tbody id="lg-lines">${rows}</tbody>
          ${edit ? '<tfoot><tr><td colspan="7"><button type="button" class="lg-add" data-lg="add">+ Add line</button></td></tr></tfoot>' : ''}
        </table></div>
        <div class="lg-errors" id="lg-errors" role="alert" hidden></div>
        <div class="lg-foot">
          <div class="lg-foot-l">
            ${fld('lg-notes', 'Notes (printed)', edit ? `<textarea class="lg-in" id="lg-notes" rows="3" maxlength="500" placeholder="Payment details, thanks…">${esc(d.notes || '')}</textarea>` : ro(esc(d.notes || '')))}
            <p class="lg-words" id="lg-words">${IR.amountInWords(t.total)}</p>
          </div>
          <div class="lg-sum">
            <div><span>Sub Total</span><span class="num" id="lg-sub">${n2(t.sub)}</span></div>
            <div><span>${edit ? `<label for="lg-tax">${esc(label)}</label> <select class="lg-in lg-tax" id="lg-tax">${[...new Set([d.taxRate, fin().settings.taxRate, 0])].map((r) => `<option value="${r}" ${r === d.taxRate ? 'selected' : ''}>${r ? `${r}%` : 'None'}</option>`).join('')}</select>` : `${esc(label)} ${d.taxRate}%`}</span><span class="num" id="lg-taxamt">${n2(t.tax)}</span></div>
            <div class="lg-total"><span>Total (RM)</span><span class="num" id="lg-total">${n2(t.total)}</span></div>
            ${i && isInvoice(i) && (t.balance !== t.total) ? `<div><span>After notes</span><span class="num">${n2(t.balance)}</span></div>` : ''}
            ${i && isInvoice(i) && st !== 'Draft' && st !== 'Void' ? `<div><span>Paid</span><span class="num">${n2(t.paid)}</span></div><div class="lg-total"><span>Balance</span><span class="num ${st === 'Overdue' ? 'lg-bad' : ''}">${n2(t.due)}</span></div>` : ''}
          </div>
        </div>
        ${pays.length ? `<table class="lg-grid lg-pays" aria-label="Payments"><thead><tr><th>Payment date</th><th class="r">Amount (RM)</th></tr></thead><tbody>${pays.map((p) => `<tr><td class="num">${fmtD(p.date)}</td><td class="r num">${n2(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
        ${i && ctx.einvoice && st !== 'Void' && st !== 'Draft' ? `<div class="lg-einv">${ctx.einvoice.panel(i)}</div>` : ''}
        <div class="lg-bar">${edit ? '<span class="lg-keys">Tab next cell · Enter next cell or new line · Ctrl+S save · Esc close</span>' : '<span></span>'}<div class="lg-bar-btns">${bar}</div></div>
      </div>`;
    }

    // The draft as typed (lines with nothing in them are left out).
    function readDoc(root) {
      const lines = ctx.$$('.lg-line', root).map((tr) => {
        const v = (n) => tr.querySelector(`[name="${n}"]`).value;
        return { desc: v('d').trim(), qty: v('q').trim() === '' ? 0 : Number(v('q')), unit: v('u'), price: v('p').trim() === '' ? 0 : Number(v('p')), classification: '022' };
      }).filter((it) => it.desc || it.qty || it.price);
      const name = ctx.$('#lg-cust').value.trim(), c = custOf(name);
      return { customer: c?.name || name, contactId: c?.id || '', email: ctx.$('#lg-email').value.trim() || c?.email || '', issue: ctx.$('#lg-issue').value, due: ctx.$('#lg-due').value,
        items: lines, taxRate: Number(ctx.$('#lg-tax').value), notes: ctx.$('#lg-notes').value.trim() };
    }
    function bindDoc() {
      const root = ctx.$('.lg-doc'); if (!root) return;
      lg.dirty = false;
      ctx.$('[data-lg=close]', root)?.addEventListener('click', () => closeDoc());
      if (!root.classList.contains('is-edit')) return;
      const id = root.dataset.doc === 'new' ? null : root.dataset.doc, body = ctx.$('#lg-lines');
      const renumber = () => ctx.$$('.lg-line', root).forEach((tr, k) => {
        tr.querySelector('.lg-no').textContent = k + 1;
        tr.querySelectorAll('[aria-label]').forEach((x) => x.setAttribute('aria-label', x.getAttribute('aria-label').replace(/line \d+|Line \d+/, (m) => `${m.split(' ')[0]} ${k + 1}`)));
      });
      const blank = () => { const tmp = document.createElement('tbody'); tmp.innerHTML = ctx.$('.lg-line', root).outerHTML; const tr = tmp.firstElementChild; tr.querySelectorAll('input, textarea').forEach((x) => { x.value = ''; }); tr.querySelector('select').value = IR.DEFAULT_UNIT; tr.querySelector('.lg-cell-err').hidden = true; tr.querySelector('[name=q]').removeAttribute('aria-invalid'); return tr; };
      // Live amounts, totals and words; quantity checked against its unit, shown under the cell.
      const refresh = () => {
        const d = readDoc(root);
        ctx.$$('.lg-line', root).forEach((tr) => {
          const q = tr.querySelector('[name=q]'), qv = q.value.trim(), u = tr.querySelector('[name=u]').value, p = tr.querySelector('[name=p]').value.trim();
          const err = qv === '' ? '' : !/^\d*\.?\d+$/.test(qv) ? 'Enter a number' : IR.qtyError(Number(qv), u);
          const e = tr.querySelector('.lg-cell-err'); e.textContent = err; e.hidden = !err;
          if (err) q.setAttribute('aria-invalid', 'true'); else q.removeAttribute('aria-invalid');
          tr.querySelector('.lg-amt').textContent = qv && p && !err ? n2(IR.lineSen({ qty: Number(qv), price: Number(p) }) / 100) : '';
        });
        const t = invoiceTotals(d);
        ctx.$('#lg-sub').textContent = n2(t.sub); ctx.$('#lg-taxamt').textContent = n2(t.tax); ctx.$('#lg-total').textContent = n2(t.total);
        ctx.$('#lg-words').textContent = IR.amountInWords(t.total);
      };
      root.addEventListener('input', () => { lg.dirty = true; refresh(); });
      root.addEventListener('change', (ev) => {
        lg.dirty = true;
        // A description used before suggests its unit.
        if (ev.target.name === 'd') { const tr = ev.target.closest('.lg-line'), sel = tr.querySelector('[name=u]'), u = IR.unitFor(fin().unitMemo, ev.target.value); if (u && sel.value === IR.DEFAULT_UNIT) sel.value = u; }
        // The customer fills the address, phone, email, terms and due date.
        if (ev.target.id === 'lg-cust' || ev.target.id === 'lg-issue') {
          const c = custOf(ctx.$('#lg-cust').value);
          ctx.$('#lg-addr').innerHTML = `${addrLines(c?.address).map(esc).join('<br>') || '<span class="lg-faint">No address on file</span>'}${c ? ' <a href="#contacts" class="lg-link">Edit</a>' : ''}`;
          ctx.$('#lg-phone').textContent = c?.phone || '—';
          ctx.$('#lg-terms').textContent = termsText(c) || '—';
          if (c && ev.target.id === 'lg-cust' && !ctx.$('#lg-email').value) ctx.$('#lg-email').value = c.email || '';
          if (c) ctx.$('#lg-due').value = U.addDays(ctx.$('#lg-issue').value, termDays(c));
        }
        refresh();
      });
      // Row actions: move up or down, insert above, delete (a draft keeps at least one row).
      root.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-row]'); if (!btn) return;
        const tr = btn.closest('.lg-line'), act = btn.dataset.row;
        if (act === 'up' && tr.previousElementSibling) tr.parentNode.insertBefore(tr, tr.previousElementSibling);
        if (act === 'down' && tr.nextElementSibling) tr.parentNode.insertBefore(tr.nextElementSibling, tr);
        if (act === 'ins') tr.parentNode.insertBefore(blank(), tr);
        if (act === 'del') { if (ctx.$$('.lg-line', root).length > 1) tr.remove(); else tr.replaceWith(blank()); }
        lg.dirty = true; renumber(); refresh();
      });
      ctx.$('[data-lg=add]', root).addEventListener('click', () => { body.appendChild(blank()); renumber(); body.lastElementChild.querySelector('[name=d]').focus(); });
      // Enter moves to the next cell; from the last cell of the last line it adds a line. Shift+Enter: a new line in a description.
      body.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
        ev.preventDefault();
        const cells = ctx.$$('.lg-line .lg-in', root), k = cells.indexOf(ev.target);
        if (k === cells.length - 1) { body.appendChild(blank()); renumber(); body.lastElementChild.querySelector('[name=d]').focus(); return; }
        cells[k + 1]?.focus();
      });
      const save = async (thenSend) => {
        if (lg.saving) return;
        const d = readDoc(root), errs = IR.draftErrors(d), box = ctx.$('#lg-errors');
        if (errs.length) { box.hidden = false; box.innerHTML = `<ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`; box.scrollIntoView({ block: 'nearest' }); return; }
        box.hidden = true; lg.saving = true;
        ctx.$$('[data-lg=save], [data-lg=send]', root).forEach((x) => { x.disabled = true; });
        const r = await (id ? store().saveDraft(id, d) : store().createDraft(d));
        lg.saving = false;
        if (!r.ok) {
          ctx.$$('[data-lg=save], [data-lg=send]', root).forEach((x) => { x.disabled = false; });
          box.hidden = false; box.innerHTML = `<ul><li>${esc(r.message)}</li></ul>${r.error === 'changed' ? '<button type="button" class="lg-btn" data-lg="reload">Reload</button>' : ''}`;
          ctx.$('[data-lg=reload]', box)?.addEventListener('click', () => { lg.dirty = false; ctx.render(); });
          return;
        }
        lg.dirty = false;
        const newId = id || r.id;
        if (thenSend) { openDoc(newId); setTimeout(() => sendInvoice(newId), 60); } else if (!id) openDoc(newId); else ctx.render();
      };
      ctx.$('[data-lg=save]', root).addEventListener('click', () => save(false));
      ctx.$('[data-lg=send]', root).addEventListener('click', () => save(true));
      root.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(false); } });
      refresh();
      // (After the app's own focus on the page heading.)
      if (!id) setTimeout(() => ctx.$('#lg-cust')?.focus(), 0);
    }
    // Leaving a draft with unsaved changes asks first.
    function closeDoc() { if (lg.dirty && !confirm('Leave without saving?')) return; lg.dirty = false; location.hash = location.hash.slice(1).split('?')[0]; }
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || !ctx.$('.lg-doc') || ctx.$('#overlay-root')?.children.length) return;
      ev.preventDefault(); closeDoc();
    });
    document.addEventListener('click', (ev) => {
      if (!lg.dirty || !ctx.$('.lg-doc.is-edit')) return;
      const a = ev.target.closest('a[href^="#"]'); if (!a || a.closest('.lg-grid')) return;
      if (!confirm('Leave without saving this draft?')) { ev.preventDefault(); ev.stopPropagation(); } else lg.dirty = false;
    }, true);
    window.addEventListener('beforeunload', (ev) => { if (lg.dirty && ctx.$('.lg-doc.is-edit')) { ev.preventDefault(); ev.returnValue = ''; } });
    // The printed invoice (A4, black on white, fine on a mono printer): company at the top left, the document title,
    // number and date at the top right, Bill To and document boxes, the lines (their header repeats on every page),
    // then the amount in words and totals once at the end, and signature boxes. "Page x of y" is printed in the page
    // margin; drafts and void invoices carry a light DRAFT / VOID watermark on every page. "TAX INVOICE" only when the
    // company has an SST number (Settings → Company → e-Invoice).
    function invoiceDoc(i) {
      const s = ctx.state.settings, e = s.einvoice || {}, er = s.employer || {}, c = contactOf(i), t = invoiceTotals(i);
      const st = isInvoice(i) ? invoiceStatus(i, T()) : 'Issued', sst = e.sst && e.sst !== 'NA' ? e.sst : '';
      const title = isInvoice(i) ? (sst ? 'TAX INVOICE' : 'INVOICE') : noteName(i).toUpperCase();
      const coAddr = addrLines(e.address).length ? addrLines(e.address) : String(er.address || s.office || '').split(/,\s*/).filter(Boolean);
      const reg = e.brn || er.ssm || '';
      const pays = isInvoice(i) ? paymentsOf(i) : [], notes = isInvoice(i) ? fin().invoices.filter((x) => x.ref === i.id) : [];
      const orig = i.ref ? fin().invoices.find((x) => x.id === i.ref) : null;
      const kv = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '');
      const mark = st === 'Draft' ? 'DRAFT' : st === 'Void' ? 'VOID' : '';
      return `<div class="pdoc">
        ${mark ? `<div class="pdoc-mark" aria-hidden="true">${mark}</div>` : ''}
        <header class="pdoc-top">
          <div class="pdoc-co"><div class="pdoc-coname">${esc(s.company)}</div>
            ${reg ? `<div>Company No: ${esc(reg)}</div>` : ''}
            ${coAddr.map((l) => `<div>${esc(l)}</div>`).join('')}
            ${[e.phone || er.phone ? `Tel: ${esc(e.phone || er.phone)}` : '', e.email ? `Email: ${esc(e.email)}` : ''].filter(Boolean).map((l) => `<div>${l}</div>`).join('')}
            ${e.tin ? `<div>TIN: ${esc(e.tin)}</div>` : ''}${sst ? `<div>SST Reg No: ${esc(sst)}</div>` : ''}</div>
          <div class="pdoc-title"><div class="pdoc-h">${title}</div><table class="pdoc-kv">${kv('No.', `<strong>${esc(i.no)}</strong>`)}${kv('Date', fmtD(i.issue))}</table></div>
        </header>
        <div class="pdoc-boxes">
          <div class="pdoc-box"><div class="pdoc-boxh">Bill To</div><strong>${esc(i.customer)}</strong>
            ${addrLines(c?.address).map((l) => `<div>${esc(l)}</div>`).join('')}
            ${c?.tin ? `<div>TIN: ${esc(c.tin)}</div>` : ''}${c?.idNo ? `<div>${esc(c.idType || 'BRN')}: ${esc(c.idNo)}</div>` : ''}
            ${c?.phone ? `<div>Tel: ${esc(c.phone)}</div>` : ''}${i.email || c?.email ? `<div>Email: ${esc(i.email || c.email)}</div>` : ''}</div>
          <div class="pdoc-box"><table class="pdoc-kv">
            ${kv('Doc No', esc(i.no))}${kv('Date', fmtD(i.issue))}
            ${isInvoice(i) ? kv('Terms', esc(termsText(c))) + kv('Due Date', fmtD(i.due)) : kv('For invoice', orig ? esc(orig.no) : '')}
            ${kv('Currency', esc(i.currency || 'MYR'))}${i.reason ? kv('Reason', esc(i.reason)) : ''}${st === 'Void' ? kv('Void', esc(i.voidReason || '')) : ''}</table></div>
        </div>
        <table class="pdoc-lines">
          <thead><tr><th class="c">No</th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Unit Price (RM)</th><th class="r">Amount (RM)</th></tr></thead>
          <tbody>${i.items.map((it, k) => `<tr><td class="c">${k + 1}</td><td class="pdoc-desc">${esc(it.desc)}</td><td class="r">${Number(it.qty).toLocaleString('en-MY', { maximumFractionDigits: 3 })}</td><td>${esc(IR.unitOf(it.unit).label)}</td><td class="r">${n2(it.price)}</td><td class="r">${n2(IR.lineSen(it) / 100)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="pdoc-end">
          <div class="pdoc-words"><div class="pdoc-boxh">Amount in words</div>${esc(IR.amountInWords(t.total))}${i.notes ? `<div class="pdoc-notes"><div class="pdoc-boxh">Notes</div>${esc(i.notes)}</div>` : ''}</div>
          <table class="pdoc-sum">
            <tr><th>Sub Total</th><td>${n2(t.sub)}</td></tr>
            <tr><th>${esc(fin().settings.taxLabel)} ${i.taxRate}%</th><td>${n2(t.tax)}</td></tr>
            <tr class="pdoc-grand"><th>Total (RM)</th><td>${n2(t.total)}</td></tr>
            ${notes.map((n) => `<tr><th>${esc(noteName(n))} ${esc(n.no)}</th><td>${n.type === 'debit' ? '' : '-'}${n2(invoiceTotals(n).total)}</td></tr>`).join('')}
            ${pays.length ? `<tr><th>Paid</th><td>-${n2(t.paid)}</td></tr><tr class="pdoc-grand"><th>Balance Due (RM)</th><td>${n2(t.due)}</td></tr>` : ''}
          </table>
        </div>
        <div class="pdoc-sign"><div><span></span>Received by</div><div><span></span>Authorised by</div></div>
      </div>`;
    }

    // Opening an invoice or note shows its document screen.
    function viewInvoice(id) { closeOverlay(); openDoc(id); }

    // Confirm a status change in a small dialog; the change is the store's.
    function confirmInv(title, body, submit, run) {
      openModal({ title, size: 'sm', submit, body, onSubmit(d) { working(true, 'Working…'); run(d).then((r) => { if (!r.ok) working(false, submit); }); return false; } });
    }
    function sendInvoice(id) {
      const i = fin().invoices.find((x) => x.id === id); if (!i) return;
      confirmInv(`Mark ${i.no} as sent?`, `<p>Do this after you have sent it to ${esc(i.customer)}. It is then <strong>locked</strong>: lines, prices, units and the customer can’t change. Mistakes are fixed with a credit note, or by voiding and duplicating.</p><p class="faint">Allurus doesn’t email it; you send it yourself (Print or PDF).</p>`, 'Mark as sent',
        () => store().send(id).then((r) => { if (r.ok) { closeOverlay(); reopen(id); } else failed(r, id); return r; }));
    }
    function deleteDraft(id) {
      const i = fin().invoices.find((x) => x.id === id); if (!i) return;
      confirmInv(`Delete draft ${i.no}?`, '<p>The draft is removed. Sent invoices are never deleted.</p>', 'Delete draft',
        () => store().remove(id).then((r) => { if (r.ok) closeOverlay(); else failed(r, id); return r; }));
    }
    function voidInvoice(id) {
      const i = fin().invoices.find((x) => x.id === id); if (!i) return;
      confirmInv(`Void ${i.no}?`, `<p>A void invoice keeps its number and stays on record, but no longer counts as owed or as income. Use Duplicate for a corrected copy.</p>
        <div class="field"><label for="void-why">Reason</label><input class="input" id="void-why" name="reason" required minlength="3" maxlength="300" placeholder="Wrong customer"></div>`, 'Void invoice',
        (d) => store().void(id, d.reason).then((r) => { if (r.ok) { closeOverlay(); reopen(id); } else failed(r, id); return r; }));
    }
    function payInvoice(id) {
      const i = fin().invoices.find((x) => x.id === id); if (!i) return;
      const t = invoiceTotals(i);
      confirmInv(`Record a payment on ${i.no}`, `<p class="muted">${esc(i.customer)} still owes <strong>${m2(t.due)}</strong>${t.paid ? ` (${m2(t.paid)} paid so far)` : ''}. Enter less for a part payment.</p>
        <div class="form-grid"><div class="field"><label for="py-amt">Amount received</label><input class="input num" id="py-amt" name="amount" type="number" min="0.01" step="0.01" max="${t.due}" required value="${t.due.toFixed(2)}"></div>
        <div class="field"><label for="py-date">Date</label><input class="input" id="py-date" name="date" type="date" required value="${T()}" max="${T()}"></div></div>`, 'Record payment',
        (d) => store().pay(id, d.amount, d.date).then((r) => {
          if (!r.ok) { failed(r, id); return r; }
          // Into the books: the payment, with its share of the tax.
          const a = r2(Number(d.amount)), tax = t.total ? r2((t.tax * a) / t.total) : 0;
          fin().txns.push({ id: U.uid('x'), date: d.date, desc: `${r.status === 'Paid' ? 'Payment' : 'Part payment'} from ${i.customer}`, type: 'in', category: i.category || (/service|implement|consult/i.test(i.items[0].desc) ? 'Services' : 'Subscriptions'), amount: r2(a - tax), tax, ref: i.no, source: 'invoice', reconciled: false });
          closeOverlay(); commit(`${money(a)} received from ${i.customer}`, `Payment of ${money(a)} received for ${i.no}`); reopen(id);
          return r;
        }));
    }
    function duplicateInvoice(id) {
      return store().duplicate(id).then((r) => { if (r.ok) { closeOverlay(); fui.inv = 'all'; openDoc(r.id); } else failed(r, id); });
    }
    function printInvoice(id) {
      const i = fin().invoices.find((x) => x.id === id); if (!i) return;
      ctx.docs.printDocs(invoiceDoc(i), `${noteName(i)} ${i.no}`);
    }
    function exportInvoices(only) {
      const rows = [['Number', 'Type', 'Status', 'Customer', 'Issued', 'Due', 'Item', 'Qty', 'Unit', 'Unit price', 'Amount', `${fin().settings.taxLabel} %`, 'Invoice total', 'Paid', 'Still owed', 'Duplicated from', 'Void reason']];
      (only || fin().invoices).slice().sort((a, b) => a.issue.localeCompare(b.issue) || a.no.localeCompare(b.no)).forEach((i) => {
        const t = invoiceTotals(i);
        i.items.forEach((it, n) => rows.push([i.no, noteName(i), isInvoice(i) ? invoiceStatus(i, T()) : 'Issued', i.customer, i.issue, isInvoice(i) ? i.due : '', it.desc, it.qty, IR.unitOf(it.unit).label, it.price, IR.lineSen(it) / 100, i.taxRate,
          n ? '' : t.total, n ? '' : t.paid, n ? '' : t.due, n ? '' : i.duplicatedFrom?.no || '', n ? '' : i.voidReason || '']));
      });
      downloadCSV(`invoices-${T()}.csv`, rows);
    }
    // Credit and debit notes change what an unpaid invoice is owed; a refund note on a paid invoice pays money back.
    function noteModal(id, type) {
      const inv = fin().invoices.find((x) => x.id === id), t = invoiceTotals(inv), label = noteName({ type });
      const max = type === 'refund' ? r2(t.paid - (inv.refunded || 0)) : type === 'credit' ? t.due : Infinity;
      openModal({
        title: `${label} for ${inv.no}`, size: 'sm', submit: `Issue ${label.toLowerCase()}`,
        body: `<p class="muted" style="margin-bottom:10px">${type === 'debit' ? `Adds to what ${esc(inv.customer)} owes, for example for work not on the invoice.` : type === 'credit' ? `Reduces what ${esc(inv.customer)} owes on ${esc(inv.no)} (${m2(t.due)} now).` : `Records money paid back to ${esc(inv.customer)} on the paid invoice ${esc(inv.no)}.`}</p>
          <div class="form-grid"><div class="field full"><label for="nt-desc">Description</label><input class="input" id="nt-desc" name="desc" required value="${esc(type === 'debit' ? 'Additional ' : 'Adjustment to ')}${esc(inv.items[0].desc)}"></div>
          <div class="field"><label for="nt-amt">Amount before ${esc(fin().settings.taxLabel)}</label><input class="input num" id="nt-amt" name="amount" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label for="nt-date">Date</label><input class="input" id="nt-date" name="issue" type="date" required value="${T()}" max="${T()}"></div>
          <div class="field full"><label for="nt-reason">Reason</label><input class="input" id="nt-reason" name="reason" required placeholder="${type === 'credit' ? 'Two seats cancelled in October' : type === 'debit' ? 'Extra onboarding session' : 'Refund for cancelled seats'}"></div></div>
          <p class="faint">${esc(fin().settings.taxLabel)} ${inv.taxRate}% is added, as on the invoice.</p>`,
        onSubmit(d) {
          const amount = r2(+d.amount), tax = r2((amount * inv.taxRate) / 100), total = r2(amount + tax);
          if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
          if (total > max + 0.005) { toast(`That’s more than the ${m2(max)} ${type === 'refund' ? 'paid and not yet refunded' : 'still owed'}`, 'error'); return false; }
          const pre = { credit: 'CN', debit: 'DN', refund: 'RN' }[type];
          const note = { type, ref: inv.id, no: IR.nextNo(fin().invoices, pre, d.issue.slice(0, 7)), customer: inv.customer, contactId: inv.contactId || '', email: inv.email, issue: d.issue, due: d.issue, items: [{ desc: d.desc.trim(), qty: 1, unit: 'unit', price: amount, classification: inv.items[0].classification || '022' }], taxRate: inv.taxRate, reason: d.reason.trim() };
          const patch = type === 'credit' ? { adjust: r2((inv.adjust || 0) - total) } : type === 'debit' ? { adjust: r2((inv.adjust || 0) + total) } : { refunded: r2((inv.refunded || 0) + total) };
          working(true, 'Issuing…');
          store().issueNote(note, inv.id, patch).then((r) => {
            if (!r.ok) { working(false, `Issue ${label.toLowerCase()}`); failed(r, inv.id); return; }
            // Money back to the customer: negative income in the month of the refund, with its tax.
            if (type === 'refund') fin().txns.push({ id: U.uid('x'), date: d.issue, desc: `Refund to ${inv.customer}`, type: 'in', category: /service|implement|consult/i.test(inv.items[0].desc) ? 'Services' : 'Subscriptions', amount: -amount, tax: -tax, ref: note.no, source: 'invoice', reconciled: false });
            closeOverlay(); commit(`${label} ${note.no} issued`, `${label} ${note.no} issued to ${inv.customer} for ${money(total)}`);
            reopen(r.id);
          });
          return false;
        },
      });
    }


    // ----- Budget -----
    VIEWS.budget = () => {
      const mk = fui.budgetMonth, rows = budgetRows(mk);
      const tb = sum(rows, (b) => b.budget), ta = sum(rows, (b) => b.actual);
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>Budget</h1><p class="sub">Monthly spending limits by category, compared with what was actually spent. Change a budget by editing its number.</p></div>
          <div class="actions"><button class="btn btn-icon" data-act="fin-budget-shift" data-v="-1" aria-label="Previous month">${icon('left')}</button><span class="pill">${U.fmtMonth(mk)}</span><button class="btn btn-icon" data-act="fin-budget-shift" data-v="1" aria-label="Next month" ${mk >= cur() ? 'disabled' : ''}>${icon('right')}</button></div></div>
        <div class="grid g-3">
          <div class="card kpi"><div class="kpi-label">Budget</div><div class="kpi-value">${compactMoney(tb)}</div><div class="kpi-foot num">${money(tb)}</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:${ta > tb ? 'var(--bad)' : 'var(--brand)'}"></span>Spent</div><div class="kpi-value">${compactMoney(ta)}</div><div class="kpi-foot">${tb ? Math.round((ta / tb) * 100) : 0}% of budget${mk === cur() ? ' so far' : ''}</div></div>
          <div class="card kpi"><div class="kpi-label">${ta > tb ? 'Over budget' : 'Left to spend'}</div><div class="kpi-value" style="color:${ta > tb ? 'var(--bad)' : 'inherit'}">${compactMoney(Math.abs(tb - ta))}</div><div class="kpi-foot">${rows.filter((b) => b.pct > 100).length} categories over</div></div>
        </div>
        <div class="card card-flush"><div class="table-wrap"><table>
          <thead><tr><th>Category</th><th class="r">Monthly budget</th><th class="r">Spent</th><th style="width:30%">Used</th><th class="r">Left</th></tr></thead>
          <tbody>${rows.map((b) => `<tr><td>${esc(b.cat)}</td>
            <td class="r">${isAuditor() ? `<span class="num">${money(b.budget)}</span>` : `<input class="input num" style="width:120px;text-align:right" type="number" min="0" step="50" value="${b.budget}" data-budget="${esc(b.cat)}" aria-label="Budget for ${esc(b.cat)}">`}</td>
            <td class="r num">${money(b.actual)}</td><td>${budgetBar(b)}</td>
            <td class="r num" style="color:${b.actual > b.budget ? 'var(--bad)' : 'inherit'}">${b.actual > b.budget ? '−' : ''}${money(Math.abs(b.budget - b.actual))}</td></tr>`).join('')}</tbody>
        </table></div></div>`;
    };
    AFTER.budget = () => {
      ctx.$$('[data-budget]').forEach((inp) => inp.addEventListener('change', () => {
        fin().budgets[inp.dataset.budget] = Math.max(0, Math.round(Number(inp.value) || 0));
        commit(`${inp.dataset.budget} budget saved`);
      }));
    };

    // ----- Reports & audit -----
    VIEWS.reports = () => {
      const f = fin(), s = f.settings;
      const list = months();
      const waiting = list.filter((k) => repStatus(k) === 'Submitted');
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>${isAuditor() ? 'Reports to verify' : 'Reports & audit'}</h1>
          <p class="sub">${isAuditor() ? `${waiting.length ? `${waiting.length} monthly report${waiting.length > 1 ? 's are' : ' is'} waiting for your review.` : 'Nothing is waiting for your review.'} Open a month to check the figures, then verify it or ask for changes.` : 'Each closed month produces its reports automatically. Submit them to your auditor instead of keeping a ledger by hand.'}</p></div>
          <div class="actions">${isAuditor() ? '' : `<button class="btn" data-act="fin-settings">${icon('sliders')}Accounting settings</button>`}</div></div>
        <div class="steps">
          <div><span>1</span><strong>Books update themselves</strong><p>Invoices, bills and payroll post automatically.</p></div>
          <div><span>2</span><strong>Submit the month</strong><p>Profit and loss, cash, ${esc(s.taxLabel)} and payroll in one report.</p></div>
          <div><span>3</span><strong>Auditor verifies</strong><p>${esc(s.auditorFirm || 'Your auditor')} checks it or asks for changes.</p></div>
          <div><span>4</span><strong>Month is locked</strong><p>Verified months can’t be edited.</p></div>
        </div>
        <div class="card card-flush"><div class="table-wrap"><table>
          <thead><tr><th>Month</th><th class="r">Revenue</th><th class="r hide-sm">Expenses</th><th class="r">Net profit</th><th>Status</th><th></th></tr></thead>
          <tbody>${list.map((k) => { const c = compute(f, pay(), k), st = repStatus(k); return `<tr class="clickable" data-act="fin-report" data-v="${k}">
            <td><strong>${U.fmtMonth(k)}</strong>${k === cur() ? '<div class="person-sub">Open until month end</div>' : ''}</td>
            <td class="r num">${money(c.totalIn)}</td><td class="r num hide-sm">${money(c.totalOut)}</td>
            <td class="r num" style="color:${c.net < 0 ? 'var(--bad)' : 'inherit'};font-weight:600">${money(c.net)}</td><td>${repPill(st)}</td>
            <td><div class="row-actions"><button class="btn btn-sm" data-act="fin-report" data-v="${k}">${isAuditor() && st === 'Submitted' ? 'Review' : !isAuditor() && ['Not submitted', 'Changes requested'].includes(st) ? 'Review and submit' : 'View'}</button></div></td></tr>`; }).join('')}</tbody>
        </table></div></div>
        <div class="card"><div class="card-head"><h3>Your auditor</h3></div>
          ${s.auditorFirm ? `<dl class="kv"><dt>Firm</dt><dd>${esc(s.auditorFirm)}</dd><dt>Contact</dt><dd>${esc(s.auditorName || '—')}</dd><dt>Email</dt><dd>${esc(s.auditorEmail || '—')}</dd><dt>${esc(s.taxLabel)} rate</dt><dd>${s.taxRate}%</dd></dl>` : `<div class="empty"><strong>No auditor yet</strong>${isAuditor() ? '' : 'Add your accounting firm under Accounting settings.'}</div>`}
        </div>`;
    };

    function reportBody(c) {
      const lines = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span>${esc(k)}</span><span class="num">${m2(v)}</span></div>`).join('') || '<div><span class="faint">None</span><span></span></div>';
      const tl = fin().settings.taxLabel;
      return `<div class="report-grid">
        <section><h4>Profit and loss</h4>
          <div class="rep-lines"><div class="sub-h">Revenue</div>${lines(c.income)}<div class="tot"><span>Total revenue</span><span class="num">${m2(c.totalIn)}</span></div>
          <div class="sub-h">Expenses</div>${lines(c.expenses)}<div class="tot"><span>Total expenses</span><span class="num">${m2(c.totalOut)}</span></div>
          <div class="grand"><span>Net profit</span><span class="num" style="color:${c.net < 0 ? 'var(--bad)' : 'inherit'}">${m2(c.net)}</span></div></div></section>
        <section><h4>Cash</h4><div class="rep-lines">
          <div><span>Opening balance</span><span class="num">${m2(c.cash.opening)}</span></div><div><span>Money in, incl. ${esc(tl)}</span><span class="num">${m2(c.cash.in)}</span></div>
          <div><span>Money out, incl. ${esc(tl)}</span><span class="num">−${m2(c.cash.out)}</span></div><div class="grand"><span>Closing balance</span><span class="num">${m2(c.cash.closing)}</span></div></div>
          <h4>${esc(tl)}</h4><div class="rep-lines">
          <div class="grand"><span>${esc(tl)} charged to customers, to pay to Customs</span><span class="num">${m2(c.tax.output)}</span></div>
          <div><span>${esc(tl)} paid to suppliers, included in costs</span><span class="num">${m2(c.tax.input)}</span></div></div>
          <h4>Payroll</h4><div class="rep-lines">${c.payroll ? `<div><span>People paid</span><span class="num">${c.payroll.people}</span></div><div><span>Gross pay</span><span class="num">${m2(c.payroll.gross)}</span></div><div><span>Income tax withheld (PCB)</span><span class="num">${m2(c.payroll.tax)}</span></div><div><span>EPF, SOCSO and EIS deducted</span><span class="num">${m2(c.payroll.benefits)}</span></div><div class="tot"><span>Net paid to staff</span><span class="num">${m2(c.payroll.net)}</span></div>` : '<div><span class="faint">No payroll paid this month</span><span></span></div>'}</div>
          <h4>At month end</h4><div class="rep-lines"><div><span>Customers owed you</span><span class="num">${m2(c.ar)}</span></div><div><span>You owed suppliers</span><span class="num">${m2(c.ap)}</span></div><div><span>Entries in the books</span><span class="num">${c.count}</span></div></div>
        </section></div>`;
    }

    function openReport(mk) {
      const f = fin(), rep = f.reports[mk], st = repStatus(mk), live = compute(f, pay(), mk);
      const frozen = rep && ['Submitted', 'Verified'].includes(rep.status);
      const c = frozen ? rep.snapshot : live;
      const changed = frozen && rep.fp !== fingerprint(live);
      const canSubmit = !isAuditor() && ['Not submitted', 'Changes requested'].includes(st);
      const canReview = isAuditor() && st === 'Submitted';
      openModal({
        title: `${U.fmtMonth(mk)} report`, size: 'lg', submit: null,
        body: `<div class="report">
          <div class="report-top">${repPill(st)}<span class="muted">${ctx.state.settings.company} · ${U.fmtDate(mk + '-01', { month: 'short', day: 'numeric' })} to ${U.fmtDate(U.monthEnd(mk), { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <button class="btn btn-sm" data-act="fin-export-report" data-v="${mk}" style="margin-left:auto">${icon('download')}Export CSV</button></div>
          ${st === 'Open' ? `<div class="lock-banner info">${icon('clock')}<span>This month is still open. Figures so far; you can submit it after ${U.fmtDate(U.monthEnd(mk))}.</span></div>` : ''}
          ${changed ? `<div class="lock-banner warn">${icon('pin')}<span>The books for this month changed after it was submitted. These are the submitted figures. ${rep.status === 'Verified' ? '' : isAuditor() ? 'Ask for changes so the company resubmits.' : 'Resubmit so your auditor sees the current figures.'}</span></div>` : ''}
          ${st === 'Verified' ? `<div class="lock-banner ok">${icon('lock')}<span>Verified and locked. Entries in this month can’t be changed.</span></div>` : ''}
          ${reportBody(c)}
          <section class="trail"><h4>Audit trail</h4>${rep?.trail?.length ? `<ol>${rep.trail.map((e) => `<li><div><strong>${esc(e.action)}</strong> · ${esc(e.who)} · <span class="faint">${U.fmtDate(e.t)}</span></div>${e.note ? `<p class="muted">“${esc(e.note)}”</p>` : ''}</li>`).join('')}</ol>` : '<p class="faint">Not submitted yet.</p>'}</section>
          ${canSubmit ? `<div class="review-box"><label for="rep-note">Note to ${esc(f.settings.auditorFirm || 'your auditor')} (optional)</label><textarea class="textarea" id="rep-note" placeholder="For example: two customer refunds are in Other income."></textarea>
            <div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-primary" data-act="fin-submit" data-v="${mk}">${icon('check')}Submit to auditor</button></div></div>` : ''}
          ${canReview ? `<div class="review-box"><label for="rep-note">Your notes</label><textarea class="textarea" id="rep-note" placeholder="What you checked, or what needs to change"></textarea>
            <div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-danger" data-act="fin-changes" data-v="${mk}">Ask for changes</button><button class="btn btn-primary" data-act="fin-verify" data-v="${mk}">${icon('check')}Verify report</button></div></div>` : ''}
          ${isAuditor() && st === 'Verified' ? `<div class="ci-actions" style="justify-content:flex-end"><button class="btn" data-act="fin-reopen" data-v="${mk}">Reopen month</button></div>` : ''}
        </div>`,
      });
    }
    const note = () => (ctx.$('#rep-note')?.value || '').trim();
    function addTrail(mk, action, n) { fin().reports[mk].trail.push({ t: T(), who: who(), action, note: n }); }

    function settingsModal() {
      const s = fin().settings;
      openModal({
        title: 'Accounting settings', submit: 'Save',
        body: `<div class="form-grid">
          <div class="field full"><label for="as-firm">Audit or accounting firm</label><input class="input" id="as-firm" name="auditorFirm" value="${esc(s.auditorFirm)}" placeholder="Tan & Partners Chartered Accountants"></div>
          <div class="field"><label for="as-name">Contact person</label><input class="input" id="as-name" name="auditorName" value="${esc(s.auditorName)}"></div>
          <div class="field"><label for="as-email">Contact email</label><input class="input" id="as-email" name="auditorEmail" type="email" value="${esc(s.auditorEmail)}"></div>
          <div class="field"><label for="as-label">Sales tax name</label><input class="input" id="as-label" name="taxLabel" value="${esc(s.taxLabel)}" required><span class="field-hint">For example SST, VAT or GST.</span></div>
          <div class="field"><label for="as-rate">Sales tax rate (%)</label><input class="input num" id="as-rate" name="taxRate" type="number" min="0" max="30" step="0.5" value="${s.taxRate}" required></div>
          <div class="field"><label for="as-open">Opening bank balance</label><input class="input num" id="as-open" name="openingCash" type="number" step="0.01" value="${fin().openingCash}"></div>
          <div class="field"><label for="as-odate">Books start on</label><input class="input" id="as-odate" name="openingDate" type="date" value="${fin().openingDate}"></div></div>`,
        onSubmit(d) {
          Object.assign(s, { auditorFirm: d.auditorFirm.trim(), auditorName: d.auditorName.trim(), auditorEmail: d.auditorEmail.trim(), taxLabel: d.taxLabel.trim() || 'Tax', taxRate: Math.max(0, Number(d.taxRate) || 0) });
          fin().openingCash = r2(Number(d.openingCash) || 0); fin().openingDate = d.openingDate || fin().openingDate;
          commit('Accounting settings saved');
        },
      });
    }

    // ----- Receipts -----
    function scanReceipt() {
      AllurusReceipt.open(ctx, {
        mode: 'business', title: 'Scan a receipt', money: m2,
        categories: EXPENSE_CATS.map((c) => [c, c]),
        onSave({ merchant, date, ref, rows, img, text, tax, total, allItems }) {
          if (locked(date)) { toast(lockedMsg(date), 'error'); return false; }
          const id = U.uid('rc');
          fin().receipts = fin().receipts || {};
          fin().receipts[id] = { img, merchant, date, ref, total, text: String(text).slice(0, 4000), added: T() };
          const groups = {};
          rows.forEach((r) => { (groups[r.cat] = groups[r.cat] || []).push(r); });
          Object.entries(groups).forEach(([cat, items]) => {
            const amount = r2(items.reduce((s, r) => s + r.amount, 0));
            fin().txns.push({
              id: U.uid('x'), date, type: 'out', category: cat, amount,
              tax: tax && allItems ? r2((tax * amount) / allItems) : 0,
              desc: `${merchant}: ${items.map((r) => r.desc).join(', ')}`.slice(0, 140), ref, source: 'receipt', reconciled: false, receipt: id,
              items: items.map((r) => ({ desc: r.desc, amount: r.amount })),
              // Personal-looking items the user ticked anyway stay flagged until a business purpose is given.
              personal: items.every((r) => r.personal),
            });
          });
          fui.month = U.monthKey(date);
          const n = Object.keys(groups).length;
          commit(`${n} ${n === 1 ? 'entry' : 'entries'} added from ${merchant}`, `Receipt from ${merchant} scanned into ${n} book ${n === 1 ? 'entry' : 'entries'}`);
        },
      });
    }
    function viewReceipt(id) {
      const rc = fin().receipts?.[id]; if (!rc) return;
      const linked = fin().txns.filter((t) => t.receipt === id);
      openModal({
        title: rc.merchant || 'Receipt', size: 'lg', submit: null,
        body: `<div class="rc-review"><div class="rc-side"><img class="rc-photo" src="${rc.img}" alt="Receipt from ${esc(rc.merchant)}"></div>
          <div class="rc-main"><dl class="kv"><dt>Date</dt><dd>${U.fmtDate(rc.date)}</dd><dt>Receipt number</dt><dd>${esc(rc.ref || '—')}</dd><dt>Total on receipt</dt><dd class="num">${rc.total != null ? m2(rc.total) : '—'}</dd><dt>Scanned</dt><dd>${U.fmtDate(rc.added)}</dd></dl>
          <h4 class="rc-h">In the books</h4><div class="list">${linked.map((t) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(t.category)}</div><div class="person-sub" style="white-space:normal">${esc((t.items || []).map((x) => `${x.desc} ${m2(x.amount)}`).join(' · '))}</div></div><span class="num">${m2(t.amount + t.tax)}</span>${window.AllurusTax ? AllurusTax.tag(t) : ''}</div>`).join('') || '<p class="faint">No entries left from this receipt.</p>'}</div></div></div>`,
      });
    }

    const csv = (name, rows) => downloadCSV(name, rows);
    Object.assign(ACTIONS, {
      'fin-go': (_, v) => { location.hash = v; },
      'fin-new-txn': (_, v) => txnModal(v),
      'fin-scan': () => scanReceipt(),
      'fin-receipt': (id) => viewReceipt(id),
      'fin-del-txn': (id) => {
        const t = fin().txns.find((x) => x.id === id); if (!t) return;
        if (locked(t.date)) { toast(lockedMsg(t.date), 'error'); return; }
        fin().txns = fin().txns.filter((x) => x.id !== id); commit('Entry deleted', `Book entry deleted: ${t.desc}`);
      },
      'fin-reconcile': (id) => {
        const t = fin().txns.find((x) => x.id === id); if (!t) return;
        if (locked(t.date)) { toast(lockedMsg(t.date), 'error'); return; }
        t.reconciled = !t.reconciled; commit(t.reconciled ? 'Matched to bank statement' : 'Marked as not matched');
      },
      'fin-bk-type': (_, v) => { fui.type = v; ctx.render(); },
      'fin-export-books': () => csv(`books-${fui.month}.csv`, [['Date', 'Description', 'Reference', 'Source', 'Category', 'Type', 'Amount', fin().settings.taxLabel, 'Total', 'Reconciled'],
        ...allTxns(fin(), pay()).filter((t) => fui.month === 'all' || t.date.startsWith(fui.month)).map((t) => [t.date, t.desc, t.ref, SOURCE[t.source], t.category, t.type === 'in' ? 'In' : 'Out', t.amount, t.tax, r2(t.amount + t.tax), t.reconciled ? 'Yes' : 'No'])]),
      'fin-new-inv': () => openDoc('new'),
      'fin-view-inv': (id) => viewInvoice(id),
      'fin-note': (id, v) => noteModal(id, v),
      'fin-inv-filter': (_, v) => { fui.inv = v; ctx.render(); },
      'fin-edit-inv': (id) => { closeOverlay(); openDoc(id); },
      'fin-send-inv': (id) => { closeOverlay(); setTimeout(() => sendInvoice(id), 30); },
      'fin-del-inv': (id) => { closeOverlay(); setTimeout(() => deleteDraft(id), 30); },
      'fin-void-inv': (id) => { closeOverlay(); setTimeout(() => voidInvoice(id), 30); },
      'fin-pay-inv': (id) => { closeOverlay(); setTimeout(() => payInvoice(id), 30); },
      'fin-dup-inv': (id) => duplicateInvoice(id),
      'fin-print-inv': (id) => printInvoice(id),
      'fin-export-inv': () => exportInvoices(),
      'fin-new-bill': () => openBill('new'),
      'fin-bill-filter': (_, v) => { fui.bill = v; ctx.render(); },
      'fin-pay-bill': (id) => {
        const b = fin().bills.find((x) => x.id === id);
        b.status = 'Paid'; b.paidOn = T();
        fin().txns.push({ id: U.uid('x'), date: T(), desc: `${b.supplier} · ${b.note || b.ref}`, type: 'out', category: b.category, amount: b.amount, tax: b.tax, ref: b.ref, source: 'bill', reconciled: false, purpose: b.purpose || '', bizPct: b.bizPct ?? 100, capital: !!b.capital, personal: !!b.personal });
        commit(`Paid ${b.supplier} ${money(b.amount + b.tax)}`, `Bill ${b.ref} from ${b.supplier} paid`);
      },
      'fin-del-bill': (id) => { fin().bills = fin().bills.filter((x) => x.id !== id); commit('Bill deleted'); },
      'fin-budget-shift': (_, v) => { fui.budgetMonth = U.addMonths(fui.budgetMonth, Number(v)); ctx.render(); },
      'fin-report': (_, mk) => openReport(mk),
      'fin-settings': () => settingsModal(),
      'fin-submit': (_, mk) => {
        const c = compute(fin(), pay(), mk);
        const prev = fin().reports[mk];
        fin().reports[mk] = { status: 'Submitted', snapshot: c, fp: fingerprint(c), trail: prev?.trail || [] };
        addTrail(mk, prev ? 'Resubmitted to auditor' : 'Submitted to auditor', note());
        closeOverlay(); commit(`${U.fmtMonth(mk)} sent to ${fin().settings.auditorFirm || 'your auditor'}`, `${U.fmtMonth(mk)} report submitted to the auditor`);
      },
      'fin-verify': (_, mk) => {
        fin().reports[mk].status = 'Verified'; addTrail(mk, 'Verified', note());
        closeOverlay(); commit(`${U.fmtMonth(mk)} verified and locked`, `${U.fmtMonth(mk)} report verified by the auditor`);
      },
      'fin-changes': (_, mk) => {
        const n = note();
        if (!n) { toast('Write what needs to change, so the company knows what to fix', 'error'); ctx.$('#rep-note')?.focus(); return; }
        fin().reports[mk].status = 'Changes requested'; addTrail(mk, 'Asked for changes', n);
        closeOverlay(); commit('Changes requested', `The auditor asked for changes to the ${U.fmtMonth(mk)} report`);
      },
      'fin-reopen': (_, mk) => {
        fin().reports[mk].status = 'Changes requested'; addTrail(mk, 'Reopened', 'Month reopened for corrections.');
        closeOverlay(); commit(`${U.fmtMonth(mk)} reopened`);
      },
      'fin-export-report': (_, mk) => {
        const rep = fin().reports[mk], c = rep && ['Submitted', 'Verified'].includes(rep.status) ? rep.snapshot : compute(fin(), pay(), mk), tl = fin().settings.taxLabel;
        csv(`report-${mk}.csv`, [['Section', 'Line', 'Amount'],
          ...Object.entries(c.income).map(([k, v]) => ['Revenue', k, v]), ['Revenue', 'Total revenue', c.totalIn],
          ...Object.entries(c.expenses).map(([k, v]) => ['Expenses', k, v]), ['Expenses', 'Total expenses', c.totalOut], ['Profit and loss', 'Net profit', c.net],
          ['Cash', 'Opening balance', c.cash.opening], ['Cash', 'Money in', c.cash.in], ['Cash', 'Money out', c.cash.out], ['Cash', 'Closing balance', c.cash.closing],
          [tl, 'Charged to customers (payable to Customs)', c.tax.output], [tl, 'Paid to suppliers (included in costs)', c.tax.input],
          ['Month end', 'Customers owed', c.ar], ['Month end', 'Owed to suppliers', c.ap], ['Status', repStatus(mk), '']]);
      },
    });

    return { badge };
  }

  return { blank, seed, install, compute, allTxns, invoiceTotals, isInvoice, INCOME_CATS, EXPENSE_CATS };
})();
