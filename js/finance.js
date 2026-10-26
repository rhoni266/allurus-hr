// Finance & Accounting: bookkeeping, invoices (receivables), bills (payables), budgets and
// monthly reports that the company's external auditor verifies. Verified months are locked.
window.AllurusFinance = (function () {
  'use strict';

  const INCOME_CATS = ['Subscriptions', 'Services', 'Product sales', 'Other income'];
  const EXPENSE_CATS = ['Payroll', 'Rent', 'Utilities', 'Software', 'Marketing', 'Travel', 'Entertainment', 'Training', 'Professional fees', 'Repairs and maintenance', 'Office supplies', 'Bank charges', 'Staff benefits', 'Raw materials', 'Packaging', 'Fuel and transport', 'Other expenses'];
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
  // balance = what the customer still owes after credit and debit notes (adjust is their net effect).
  const invoiceTotals = (inv) => {
    const sub = sum(inv.items, (i) => i.qty * i.price);
    const tax = r2(sub * inv.taxRate / 100);
    const total = r2(sub + tax);
    return { sub, tax, total, balance: r2(total + (inv.adjust || 0)) };
  };
  // Credit, debit and refund notes live with the invoices but are not receivables themselves.
  const isInvoice = (i) => (i.type || 'invoice') === 'invoice';
  const invoiceStatus = (inv, today) => (inv.status === 'Sent' && inv.due < today ? 'Overdue' : inv.status);
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
    const ar = sum(fin.invoices.filter((i) => isInvoice(i) && i.status !== 'Draft' && i.issue <= end && (i.status !== 'Paid' || i.paidOn > end)), (i) => invoiceTotals(i).balance);
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
    const invPill = (s) => `<span class="pill ${({ Draft: '', Sent: 'info', Overdue: 'bad', Paid: 'ok' })[s]}">${s}</span>`;
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
      const out = f.invoices.filter((i) => isInvoice(i) && ['Sent', 'Overdue'].includes(invoiceStatus(i, T())));
      const overdueInv = out.filter((i) => invoiceStatus(i, T()) === 'Overdue');
      const unpaid = f.bills.filter((b) => b.status !== 'Paid');
      const overdueBills = unpaid.filter((b) => billStatus(b, T()) === 'Overdue');
      const due14 = unpaid.filter((b) => b.due <= U.addDays(T(), 14));
      const recent = months().slice(0, 6).reverse();
      const attention = [
        ...overdueInv.map((i) => ({ text: `<strong>${esc(i.customer)}</strong> owes ${money(invoiceTotals(i).balance)} on ${esc(i.no)}, due ${U.fmtDate(i.due, { month: 'short', day: 'numeric' })}`, pill: '<span class="pill bad">Overdue invoice</span>', act: `data-act="fin-view-inv" data-id="${i.id}"` })),
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
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Customers owe you</div><div class="kpi-value">${compactMoney(sum(out, (i) => invoiceTotals(i).balance))}</div><div class="kpi-foot">${out.length} open invoices${overdueInv.length ? ` · <span style="color:var(--bad)">${overdueInv.length} overdue</span>` : ''}</div></div>
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
    VIEWS.invoices = () => {
      const f = fin();
      const list = f.invoices.map((i) => ({ ...i, st: invoiceStatus(i, T()), tot: invoiceTotals(i) })).filter((i) => fui.inv === 'all' || (fui.inv === 'Notes' ? !isInvoice(i) : isInvoice(i) && i.st === fui.inv)).sort((a, b) => b.issue.localeCompare(a.issue) || b.no.localeCompare(a.no));
      const open = f.invoices.filter((i) => isInvoice(i) && ['Sent', 'Overdue'].includes(invoiceStatus(i, T())));
      const overdue = open.filter((i) => invoiceStatus(i, T()) === 'Overdue');
      const paidMonth = f.invoices.filter((i) => isInvoice(i) && i.status === 'Paid' && i.paidOn.startsWith(cur()));
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>Invoices</h1><p class="sub">Bill your customers and track who has paid. Recording a payment adds it to the books.</p></div>
          <div class="actions">${isAuditor() ? '' : `<button class="btn btn-primary" data-act="fin-new-inv">${icon('plus')}New invoice</button>`}</div></div>
        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label">Outstanding</div><div class="kpi-value">${compactMoney(sum(open, (i) => invoiceTotals(i).balance))}</div><div class="kpi-foot">${open.length} invoices</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Overdue</div><div class="kpi-value">${compactMoney(sum(overdue, (i) => invoiceTotals(i).balance))}</div><div class="kpi-foot">${overdue.length} invoices</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Paid this month</div><div class="kpi-value">${compactMoney(sum(paidMonth, (i) => invoiceTotals(i).balance))}</div><div class="kpi-foot">${paidMonth.length} invoices</div></div>
          <div class="card kpi"><div class="kpi-label">Drafts</div><div class="kpi-value">${f.invoices.filter((i) => isInvoice(i) && i.status === 'Draft').length}</div><div class="kpi-foot">Not sent yet</div></div>
        </div>
        <div class="card card-flush">
          <div class="toolbar"><div class="seg">${['all', 'Draft', 'Sent', 'Overdue', 'Paid', 'Notes'].map((s) => `<button data-act="fin-inv-filter" data-v="${s}" class="${fui.inv === s ? 'on' : ''}">${s === 'all' ? 'All' : s === 'Notes' ? 'Credit, debit and refund notes' : s}</button>`).join('')}</div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Number</th><th>Customer</th><th class="hide-sm">Issued</th><th class="hide-sm">Due</th><th class="r">Total</th><th>Status</th><th class="hide-sm">e-Invoice</th><th></th></tr></thead>
            <tbody>${list.map((i) => `<tr class="clickable" data-act="fin-view-inv" data-id="${i.id}">
              <td class="num inv-no">${esc(i.no)}${isInvoice(i) ? '' : `<div><span class="tag ${i.type === 'credit' ? 'warn' : i.type === 'refund' ? 'bad' : 'info'}">${esc(noteName(i))}</span></div>`}</td><td>${esc(i.customer)}</td><td class="hide-sm muted num">${U.fmtDate(i.issue, { month: 'short', day: 'numeric' })}</td>
              <td class="muted num hide-sm">${isInvoice(i) ? U.fmtDate(i.due, { month: 'short', day: 'numeric' }) : '—'}</td><td class="r num">${isInvoice(i) ? m2(i.tot.balance) : `${i.type === 'debit' ? '' : '−'}${m2(i.tot.total)}`}${isInvoice(i) && i.tot.balance !== i.tot.total ? `<div class="person-sub">was ${m2(i.tot.total)}</div>` : ''}</td><td>${isInvoice(i) ? invPill(i.st) : '<span class="pill">Issued</span>'}</td><td class="hide-sm">${ctx.einvoice ? ctx.einvoice.pill(i.einvoice) : ''}</td>
              <td><div class="row-actions">${isAuditor() || !isInvoice(i) ? '' : i.st === 'Draft' ? `<button class="btn btn-sm" data-act="fin-send-inv" data-id="${i.id}">Mark sent</button>` : i.st !== 'Paid' ? `<button class="btn btn-sm btn-ok" data-act="fin-pay-inv" data-id="${i.id}">Record payment</button>` : ''}</div></td></tr>`).join('')}</tbody>
          </table>${list.length ? '' : '<div class="empty"><strong>No invoices here</strong>Create one with New invoice.</div>'}</div>
        </div>`;
    };

    function invoiceModal() {
      const rate = fin().settings.taxRate, label = fin().settings.taxLabel;
      const custs = [...new Set([...(fin().contacts || []).filter((c) => c.kind === 'customer').map((c) => c.name), ...fin().invoices.map((i) => i.customer)])].sort();
      const row = (n) => `<div class="inv-line"><input class="input" name="d${n}" placeholder="Description" aria-label="Line ${n + 1} description" ${n === 0 ? 'required' : ''}><input class="input num" name="q${n}" type="number" min="0" step="1" placeholder="Qty" value="${n === 0 ? 1 : ''}" aria-label="Line ${n + 1} quantity"><input class="input num" name="p${n}" type="number" min="0" step="0.01" placeholder="Unit price" aria-label="Line ${n + 1} unit price"></div>`;
      openModal({
        title: 'New invoice', submit: 'Save draft',
        body: `<div class="form-grid">
          <div class="field"><label for="in-cust">Customer</label><input class="input" id="in-cust" name="customer" list="cust-list" required><datalist id="cust-list">${custs.map((c) => `<option value="${esc(c)}">`).join('')}</datalist><span class="field-hint" id="in-cust-hint">Pick a saved customer so the e-Invoice has their TIN and address.</span></div>
          <div class="field"><label for="in-email">Customer email</label><input class="input" id="in-email" name="email" type="email"></div>
          <div class="field"><label for="in-issue">Issue date</label><input class="input" id="in-issue" name="issue" type="date" required value="${T()}"></div>
          <div class="field"><label for="in-due">Due date</label><input class="input" id="in-due" name="due" type="date" required value="${U.addDays(T(), 30)}"></div>
          <div class="field full"><label>Items</label>${row(0)}${row(1)}${row(2)}</div>
          <div class="field"><label for="in-tax">${esc(label)}</label><select class="select" id="in-tax" name="taxRate"><option value="${rate}">${rate}%</option><option value="0">No ${esc(label)}</option></select></div></div>`,
        onSubmit(d) {
          const items = [0, 1, 2].map((n) => ({ desc: (d['d' + n] || '').trim(), qty: Number(d['q' + n]) || 0, price: Number(d['p' + n]) || 0 })).filter((i) => i.desc && i.qty > 0 && i.price > 0);
          if (!items.length) { toast('Add at least one item with a quantity and price', 'error'); return false; }
          if (d.due < d.issue) { toast('The due date must be on or after the issue date', 'error'); return false; }
          const mk = U.monthKey(d.issue).replace('-', '');
          const n = fin().invoices.filter((i) => i.no.includes(mk)).length + 1;
          const contact = (fin().contacts || []).find((c) => c.kind === 'customer' && c.name.toLowerCase() === d.customer.trim().toLowerCase());
          const inv = { id: U.uid('i'), type: 'invoice', no: `INV-${mk}-${U.pad(n)}`, customer: contact?.name || d.customer.trim(), contactId: contact?.id || '', email: d.email.trim() || contact?.email || '', issue: d.issue, due: d.due, items: items.map((x) => ({ ...x, classification: '022' })), taxRate: Number(d.taxRate), status: 'Draft', paidOn: '', einvoice: { status: 'Draft' } };
          fin().invoices.push(inv);
          fui.inv = 'all';
          commit(`${inv.no} saved as a draft`, `Invoice ${inv.no} created for ${inv.customer}`);
          setTimeout(() => viewInvoice(inv.id), 50);
        },
      });
      ctx.$('#in-cust')?.addEventListener('change', (ev) => {
        const c = (fin().contacts || []).find((x) => x.kind === 'customer' && x.name.toLowerCase() === ev.target.value.trim().toLowerCase());
        const em = ctx.$('#in-email'); if (c && em && !em.value) em.value = c.email || '';
        const h = ctx.$('#in-cust-hint'); if (h) h.textContent = c ? (ctx.einvoice?.contactReady(c) ? 'Saved customer, ready for e-Invoice.' : 'Saved customer, but some e-Invoice details are missing.') : 'New name: add them under Customers & suppliers for the e-Invoice.';
      });
    }

    function viewInvoice(id) {
      const i = fin().invoices.find((x) => x.id === id); if (!i) return;
      const t = invoiceTotals(i), st = isInvoice(i) ? invoiceStatus(i, T()) : 'Issued', s = ctx.state.settings, e = s.einvoice || {}, c = contactOf(i);
      const orig = i.ref ? fin().invoices.find((x) => x.id === i.ref) : null;
      const notes = isInvoice(i) ? fin().invoices.filter((x) => x.ref === i.id) : [];
      const party = (p) => p ? [p.tin && `TIN ${esc(p.tin)}`, p.idNo && `${esc(p.idType || 'BRN')} ${esc(p.idNo)}`, p.sst && p.sst !== 'NA' && `SST ${esc(p.sst)}`].filter(Boolean).join(' · ') : '';
      const addr = (a) => (a ? [a.line1, a.line2, a.line3, [a.postcode, a.city].filter(Boolean).join(' '), window.AllurusEInvoiceRules?.STATES[a.state]].filter(Boolean).map(esc).join(', ') : '');
      openModal({
        title: `${noteName(i)} ${i.no}`, size: 'lg', submit: null,
        body: `<div class="doc">
          <div class="doc-head"><div style="display:flex;align-items:center;gap:12px">${ctx.LOGO_MARK}<div><div style="font-weight:600;letter-spacing:.2em">${esc(s.company.toUpperCase())}</div><div class="faint" style="font-size:12px">${esc(addr(e.address) || s.office || '')}</div>${e.tin ? `<div class="faint" style="font-size:12px">TIN ${esc(e.tin)}${e.brn ? ` · SSM ${esc(e.brn)}` : ''}${e.sst && e.sst !== 'NA' ? ` · SST ${esc(e.sst)}` : ''}</div>` : ''}</div></div>
            <div style="text-align:right"><div class="doc-title">${esc(noteName(i))}</div><div class="num muted">${esc(i.no)}</div>${isInvoice(i) ? invPill(st) : ''}</div></div>
          <div class="doc-meta"><div><div class="faint">Bill to</div><strong>${esc(i.customer)}</strong><div class="muted">${esc(i.email || c?.email || '')}</div>${c ? `<div class="faint" style="font-size:12px">${party(c)}</div><div class="faint" style="font-size:12px">${addr(c.address)}</div>` : ''}</div>
            <div><div class="faint">Issued</div>${U.fmtDate(i.issue)}</div>${isInvoice(i) ? `<div><div class="faint">Due</div>${U.fmtDate(i.due)}</div>` : `<div><div class="faint">For invoice</div>${orig ? `<button class="link-btn" data-act="fin-view-inv" data-id="${orig.id}">${esc(orig.no)}</button>` : '—'}</div>`}${i.paidOn ? `<div><div class="faint">Paid</div>${U.fmtDate(i.paidOn)}</div>` : ''}</div>
          ${i.reason ? `<p class="muted"><strong>Reason:</strong> ${esc(i.reason)}</p>` : ''}
          <div class="table-wrap"><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
            <tbody>${i.items.map((it) => `<tr><td>${esc(it.desc)}</td><td class="r num">${it.qty}</td><td class="r num">${m2(it.price)}</td><td class="r num">${m2(it.qty * it.price)}</td></tr>`).join('')}</tbody></table></div>
          <div class="doc-totals"><div><span>Subtotal</span><span class="num">${m2(t.sub)}</span></div><div><span>${esc(fin().settings.taxLabel)} ${i.taxRate}%</span><span class="num">${m2(t.tax)}</span></div><div class="grand"><span>Total</span><span class="num">${m2(t.total)}</span></div>
            ${notes.length ? notes.map((n) => `<div><span><button class="link-btn" data-act="fin-view-inv" data-id="${n.id}">${esc(noteName(n))} ${esc(n.no)}</button></span><span class="num">${n.type === 'debit' ? '+' : '−'}${m2(invoiceTotals(n).total)}</span></div>`).join('') + `<div class="grand"><span>${st === 'Paid' ? 'Paid' : 'Still owed'}</span><span class="num">${m2(t.balance)}</span></div>` : ''}</div>
          ${ctx.einvoice ? ctx.einvoice.panel(i) : ''}
          ${isAuditor() ? '' : `<div class="ci-actions" style="justify-content:flex-end">${!isInvoice(i) ? '' : st === 'Draft' ? `<button class="btn" data-act="fin-del-inv" data-id="${i.id}">Delete draft</button><button class="btn btn-primary" data-act="fin-send-inv" data-id="${i.id}">Mark as sent</button>` : st !== 'Paid' ? `<button class="btn" data-act="fin-note" data-id="${i.id}" data-v="credit">Credit note</button><button class="btn" data-act="fin-note" data-id="${i.id}" data-v="debit">Debit note</button><button class="btn btn-primary" data-act="fin-pay-inv" data-id="${i.id}">${icon('check')}Record payment today</button>` : `<button class="btn" data-act="fin-note" data-id="${i.id}" data-v="refund">Refund note</button>`}</div>`}
        </div>`,
      });
    }
    // Credit and debit notes change what an unpaid invoice is owed; a refund note on a paid invoice pays money back.
    function noteModal(id, type) {
      const inv = fin().invoices.find((x) => x.id === id), t = invoiceTotals(inv), label = noteName({ type });
      const max = type === 'refund' ? r2(t.balance - (inv.refunded || 0)) : type === 'credit' ? t.balance : Infinity;
      openModal({
        title: `${label} for ${inv.no}`, size: 'sm', submit: `Issue ${label.toLowerCase()}`,
        body: `<p class="muted" style="margin-bottom:10px">${type === 'debit' ? `Adds to what ${esc(inv.customer)} owes, for example for work not on the invoice.` : type === 'credit' ? `Reduces what ${esc(inv.customer)} owes on ${esc(inv.no)} (${m2(t.balance)} now).` : `Records money paid back to ${esc(inv.customer)} on the paid invoice ${esc(inv.no)}.`}</p>
          <div class="form-grid"><div class="field full"><label for="nt-desc">Description</label><input class="input" id="nt-desc" name="desc" required value="${esc(type === 'debit' ? 'Additional ' : 'Adjustment to ')}${esc(inv.items[0].desc)}"></div>
          <div class="field"><label for="nt-amt">Amount before ${esc(fin().settings.taxLabel)}</label><input class="input num" id="nt-amt" name="amount" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label for="nt-date">Date</label><input class="input" id="nt-date" name="issue" type="date" required value="${T()}" max="${T()}"></div>
          <div class="field full"><label for="nt-reason">Reason</label><input class="input" id="nt-reason" name="reason" required placeholder="${type === 'credit' ? 'Two seats cancelled in October' : type === 'debit' ? 'Extra onboarding session' : 'Refund for cancelled seats'}"></div></div>
          <p class="faint">${esc(fin().settings.taxLabel)} ${inv.taxRate}% is added, as on the invoice.</p>`,
        onSubmit(d) {
          const amount = r2(+d.amount), tax = r2((amount * inv.taxRate) / 100), total = r2(amount + tax);
          if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
          if (total > max + 0.005) { toast(`That’s more than the ${m2(max)} ${type === 'refund' ? 'paid and not yet refunded' : 'still owed'}`, 'error'); return false; }
          const pre = { credit: 'CN', debit: 'DN', refund: 'RN' }[type], mk = d.issue.slice(0, 7).replace('-', '');
          const n = fin().invoices.filter((x) => x.no.startsWith(`${pre}-${mk}`)).length + 1;
          const note = { id: U.uid('i'), type, ref: inv.id, no: `${pre}-${mk}-${U.pad(n)}`, customer: inv.customer, contactId: inv.contactId || '', email: inv.email, issue: d.issue, due: d.issue, items: [{ desc: d.desc.trim(), qty: 1, price: amount, classification: inv.items[0].classification || '022' }], taxRate: inv.taxRate, status: 'Issued', paidOn: '', reason: d.reason.trim(), einvoice: { status: 'Draft' } };
          fin().invoices.push(note);
          if (type === 'credit') inv.adjust = r2((inv.adjust || 0) - total);
          if (type === 'debit') inv.adjust = r2((inv.adjust || 0) + total);
          if (type === 'refund') {
            inv.refunded = r2((inv.refunded || 0) + total);
            // Money back to the customer: negative income in the month of the refund, with its tax.
            fin().txns.push({ id: U.uid('x'), date: d.issue, desc: `Refund to ${inv.customer}`, type: 'in', category: /service|implement|consult/i.test(inv.items[0].desc) ? 'Services' : 'Subscriptions', amount: -amount, tax: -tax, ref: note.no, source: 'invoice', reconciled: false });
          }
          commit(`${label} ${note.no} issued`, `${label} ${note.no} issued to ${inv.customer} for ${money(total)}`);
          setTimeout(() => viewInvoice(note.id), 50);
        },
      });
    }

    // ----- Bills -----
    VIEWS.bills = () => {
      const f = fin();
      const list = f.bills.map((b) => ({ ...b, st: billStatus(b, T()) })).filter((b) => fui.bill === 'all' || b.st === fui.bill).sort((a, b) => (a.status === 'Paid') - (b.status === 'Paid') || a.due.localeCompare(b.due));
      const unpaid = f.bills.filter((b) => b.status !== 'Paid');
      const overdue = unpaid.filter((b) => billStatus(b, T()) === 'Overdue');
      const soon = unpaid.filter((b) => b.due >= T() && b.due <= U.addDays(T(), 14));
      const paidMonth = f.bills.filter((b) => b.status === 'Paid' && b.paidOn.startsWith(cur()));
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>Bills</h1><p class="sub">What you owe suppliers. Paying a bill adds it to the books with its ${esc(f.settings.taxLabel)}.</p></div>
          <div class="actions">${isAuditor() ? '' : `<button class="btn btn-primary" data-act="fin-new-bill">${icon('plus')}Add bill</button>`}</div></div>
        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label">Unpaid</div><div class="kpi-value">${compactMoney(sum(unpaid, (b) => b.amount + b.tax))}</div><div class="kpi-foot">${unpaid.length} bills</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Overdue</div><div class="kpi-value">${compactMoney(sum(overdue, (b) => b.amount + b.tax))}</div><div class="kpi-foot">${overdue.length} bills</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--warn)"></span>Due in 14 days</div><div class="kpi-value">${compactMoney(sum(soon, (b) => b.amount + b.tax))}</div><div class="kpi-foot">${soon.length} bills</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Paid this month</div><div class="kpi-value">${compactMoney(sum(paidMonth, (b) => b.amount + b.tax))}</div><div class="kpi-foot">${paidMonth.length} bills</div></div>
        </div>
        <div class="card card-flush">
          <div class="toolbar"><div class="seg">${['all', 'Unpaid', 'Overdue', 'Paid'].map((s) => `<button data-act="fin-bill-filter" data-v="${s}" class="${fui.bill === s ? 'on' : ''}">${s === 'all' ? 'All' : s}</button>`).join('')}</div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Supplier</th><th class="hide-sm">Reference</th><th class="hide-sm">Category</th><th>Due</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>${list.map((b) => `<tr><td>${esc(b.supplier)}${b.selfBilled ? `<div><button class="link-btn" data-act="einv-bill" data-id="${b.id}"><span class="tag info">Self-billed</span></button> ${ctx.einvoice ? ctx.einvoice.pill(b.einvoice) : ''}</div>` : ''}</td><td class="hide-sm muted num">${esc(b.ref)}</td><td class="hide-sm">${esc(b.category)}</td>
              <td class="muted num">${U.fmtDate(b.due, { month: 'short', day: 'numeric' })}</td><td class="r num">${m2(b.amount + b.tax)}</td><td>${billPill(b.st)}</td>
              <td><div class="row-actions">${isAuditor() || b.status === 'Paid' ? (b.paidOn ? `<span class="faint num">Paid ${U.fmtDate(b.paidOn, { month: 'short', day: 'numeric' })}</span>` : '') : `<button class="btn btn-sm btn-ok" data-act="fin-pay-bill" data-id="${b.id}">Pay today</button><button class="btn btn-sm btn-icon btn-ghost" data-act="fin-del-bill" data-id="${b.id}" aria-label="Delete bill">${icon('trash')}</button>`}</div></td></tr>`).join('')}</tbody>
          </table>${list.length ? '' : '<div class="empty"><strong>No bills here</strong></div>'}</div>
        </div>`;
    };

    function billModal() {
      const rate = fin().settings.taxRate, label = fin().settings.taxLabel;
      openModal({
        title: 'Add bill', size: 'sm', submit: 'Add bill',
        body: `<div class="form-grid">
          <div class="field full"><label for="bl-sup">Supplier</label><input class="input" id="bl-sup" name="supplier" required list="sup-list"><datalist id="sup-list">${(fin().contacts || []).filter((c) => c.kind === 'supplier').map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist></div>
          <div class="field"><label for="bl-ref">Supplier’s reference</label><input class="input" id="bl-ref" name="ref" required></div>
          <div class="field"><label for="bl-cat">Category</label><select class="select" id="bl-cat" name="category">${EXPENSE_CATS.filter((c) => c !== 'Payroll').map((c) => `<option>${c}</option>`).join('')}</select></div>
          <div class="field"><label for="bl-issue">Bill date</label><input class="input" id="bl-issue" name="issue" type="date" required value="${T()}"></div>
          <div class="field"><label for="bl-due">Due date</label><input class="input" id="bl-due" name="due" type="date" required value="${U.addDays(T(), 30)}"></div>
          <div class="field"><label for="bl-amt">Amount before tax</label><input class="input num" id="bl-amt" name="amount" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label for="bl-tax">${esc(label)}</label><select class="select" id="bl-tax" name="taxRate"><option value="0">No ${esc(label)}</option><option value="${rate}">${rate}%</option></select></div>
          <div class="field full"><label for="bl-desc">What is it for?</label><input class="input" id="bl-desc" name="desc" placeholder="Google Ads campaign, office rental, aircond servicing"></div>
          <label class="check field full"><input type="checkbox" name="selfBilled"><span>Self-billed: we issue the e-Invoice for this supplier (for example a freelancer, an agent or a foreign supplier)</span></label>
          ${window.AllurusTax.formFields()}</div>`,
        onSubmit(d) {
          const amount = r2(Number(d.amount));
          if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
          const extra = window.AllurusTax.readForm(d, `${d.supplier} ${d.desc}`);
          const sup = (fin().contacts || []).find((c) => c.kind === 'supplier' && c.name.toLowerCase() === d.supplier.trim().toLowerCase());
          const self = d.selfBilled === 'on';
          const nb = { id: U.uid('b'), supplier: sup?.name || d.supplier.trim(), contactId: sup?.id || '', ref: d.ref.trim(), category: d.category, issue: d.issue, due: d.due, amount, tax: r2((amount * Number(d.taxRate)) / 100), status: 'Unpaid', paidOn: '', note: (d.desc || '').trim(), ...extra, ...(self ? { selfBilled: true, selfNo: `SBI-${d.issue.slice(0, 7).replace('-', '')}-${U.pad(fin().bills.filter((x) => x.selfBilled && x.issue.slice(0, 7) === d.issue.slice(0, 7)).length + 1)}`, einvoice: { status: 'Draft' } } : {}) };
          fin().bills.push(nb);
          if (self) setTimeout(() => ctx.ACTIONS['einv-bill']?.(nb.id), 60);
          commit('Bill added', `Bill from ${d.supplier.trim()} added, ${money(amount)}`);
        },
      });
      window.AllurusTax.bindForm(ctx.$('#overlay-root form'), { desc: ['#bl-sup', '#bl-desc'], cat: '#bl-cat' });
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
      'fin-new-inv': () => invoiceModal(),
      'fin-view-inv': (id) => viewInvoice(id),
      'fin-note': (id, v) => noteModal(id, v),
      'fin-inv-filter': (_, v) => { fui.inv = v; ctx.render(); },
      'fin-send-inv': (id) => { const i = fin().invoices.find((x) => x.id === id); i.status = 'Sent'; closeOverlay(); commit(`${i.no} marked as sent`, `Invoice ${i.no} sent to ${i.customer}`); },
      'fin-del-inv': (id) => { const i = fin().invoices.find((x) => x.id === id); fin().invoices = fin().invoices.filter((x) => x.id !== id); closeOverlay(); commit(`${i.no} deleted`); },
      'fin-pay-inv': (id) => {
        const i = fin().invoices.find((x) => x.id === id), t = invoiceTotals(i);
        // After credit or debit notes the payment is the balance, split between amount and tax in proportion.
        const k = t.total ? t.balance / t.total : 1, tax = r2(t.tax * k);
        i.status = 'Paid'; i.paidOn = T();
        fin().txns.push({ id: U.uid('x'), date: T(), desc: `Payment from ${i.customer}`, type: 'in', category: i.category || (/service|implement|consult/i.test(i.items[0].desc) ? 'Services' : 'Subscriptions'), amount: r2(t.balance - tax), tax, ref: i.no, source: 'invoice', reconciled: false });
        closeOverlay(); commit(`${money(t.balance)} received from ${i.customer}`, `Payment of ${money(t.balance)} received for ${i.no}`);
      },
      'fin-new-bill': () => billModal(),
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
