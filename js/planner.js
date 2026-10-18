// Financial planner: shows an employee what they earn, what they must pay each month and what is left to spend.
window.AllurusPlanner = (function () {
  'use strict';
  const r2 = (n) => Math.round(n * 100) / 100;
  const GROUPS = [
    { id: 'income', label: 'Other income', hint: 'Side income, rental or allowances not on your payslip.', add: 'Add income' },
    { id: 'commit', label: 'Must pay', hint: 'Loans, rent and bills due every month. Tick “Loan” for debt repayments.', add: 'Add a payment' },
    { id: 'living', label: 'Living costs', hint: 'Day-to-day spending: food, petrol, family support.', add: 'Add a cost' },
    { id: 'save', label: 'Savings and goals', hint: 'Pay yourself first: emergency fund, ASB, Tabung Haji, investments.', add: 'Add a goal' },
  ];
  const item = (group, name, amount, debt = false) => ({ id: U.uid('pl'), group, name, amount, debt });
  // A typical Malaysian starting list, so the page is never empty.
  const template = () => [
    item('commit', 'House rent or home loan', 0, false), item('commit', 'Car loan', 0, true), item('commit', 'PTPTN', 0, true),
    item('commit', 'Utilities and internet', 0), item('commit', 'Phone', 0), item('commit', 'Insurance or takaful', 0),
    item('living', 'Groceries', 0), item('living', 'Petrol and tolls', 0), item('living', 'Eating out', 0),
    item('save', 'Emergency fund', 0),
  ];
  const sample = () => ({ items: [
    item('income', 'Freelance design', 300),
    item('commit', 'House rent', 1100), item('commit', 'Car loan (hire purchase)', 780, true), item('commit', 'PTPTN', 200, true), item('commit', 'Credit card', 300, true),
    item('commit', 'Utilities and internet', 250), item('commit', 'Phone', 80), item('commit', 'Takaful', 180),
    item('living', 'Groceries', 600), item('living', 'Petrol and tolls', 350), item('living', 'Eating out', 450), item('living', 'Allowance for parents', 400),
    item('save', 'Emergency fund', 400), item('save', 'ASB', 300),
  ], paid: {} });

  function install(ctx) {
    const { VIEWS, AFTER, ACTIONS, esc, icon, money, commit } = ctx;
    const m2 = (n) => money(n, 2);
    const plan = () => {
      const all = (ctx.state.plans = ctx.state.plans || {}), id = ctx.me().id;
      return (all[id] = all[id] || { items: template(), paid: {} });
    };
    const total = (g) => r2(plan().items.filter((x) => x.group === g).reduce((s, x) => s + (Number(x.amount) || 0), 0));

    // A regular month's pay (no bonus, no claims), with the latest paid payslip for reference.
    function pay() {
      const e = ctx.me(), s = ctx.state.settings;
      const reg = U.payCalc(e.salary, 0, s, e);
      const last = ctx.myRuns()[0];
      const it = last ? ctx.state.payroll[last].items.find((i) => i.empId === e.id) : null;
      return { reg, last, it };
    }

    VIEWS['my-plan'] = () => {
      const e = ctx.me(), p = plan(), { reg, last, it } = pay(), mk = U.monthKey(U.today());
      const other = total('income'), commitT = total('commit'), living = total('living'), saving = total('save');
      const deductions = r2(reg.tax + reg.benefits + (reg.zakat || 0));
      const takeHome = r2(reg.net + other);
      const left = r2(takeHome - commitT - living - saving);
      const debt = r2(p.items.filter((x) => x.group === 'commit' && x.debt).reduce((s, x) => s + (Number(x.amount) || 0), 0));
      const dsr = takeHome ? (debt / takeHome) * 100 : 0;
      const saveRate = takeHome ? (saving / takeHome) * 100 : 0;
      const needs = commitT + living, monthsCost = needs || 1;
      const daysLeft = Number(U.monthEnd(mk).slice(8)) - Number(U.today().slice(8)) + 1;
      const comingClaims = (ctx.state.claims || []).filter((c) => c.empId === e.id && c.status === 'Approved').reduce((s, c) => s + c.approved, 0);
      const paidNow = p.paid[mk] || [];
      const commits = p.items.filter((x) => x.group === 'commit' && Number(x.amount) > 0);
      const unpaid = r2(commits.filter((x) => !paidNow.includes(x.id)).reduce((s, x) => s + Number(x.amount), 0));

      // The bar splits gross pay plus other income into where it goes.
      const base = r2(reg.gross + other) || 1;
      const segs = [
        ['Tax, EPF, SOCSO, EIS', deductions, 'var(--fg-3)'],
        ['Must pay', commitT, 'var(--warn)'],
        ['Living costs', living, 'var(--info)'],
        ['Savings', saving, 'var(--brand)'],
        [left >= 0 ? 'Left to spend' : 'Short by', Math.abs(left), left >= 0 ? 'var(--gold)' : 'var(--bad)'],
      ];
      const scale = Math.max(base, deductions + commitT + living + saving);
      const health = (v, good, watch) => (v <= good ? ['ok', 'Healthy'] : v <= watch ? ['warn', 'Watch'] : ['bad', 'High']);
      const [dsrCls, dsrLbl] = health(dsr, 40, 60);
      const rule = [
        ['Needs', 'Must pay and living costs', (needs / (takeHome || 1)) * 100, 50],
        ['Wants', 'Left to spend', (Math.max(0, left) / (takeHome || 1)) * 100, 30],
        ['Savings', 'Savings and goals', saveRate, 20],
      ];
      const group = (g) => {
        const rows = p.items.filter((x) => x.group === g.id);
        return `<div class="plan-group"><div class="plan-group-head"><div><h4>${g.label}</h4><span class="faint">${g.hint}</span></div><span class="num" style="font-weight:600">${m2(total(g.id))}</span></div>
          ${rows.map((x) => `<div class="plan-row">
            ${g.id === 'commit' ? `<label class="plan-paid" title="Paid this month"><input type="checkbox" data-plan-paid="${x.id}" ${paidNow.includes(x.id) ? 'checked' : ''} aria-label="${esc(x.name)} paid this month"></label>` : '<span></span>'}
            <input class="input" data-plan="${x.id}" data-f="name" value="${esc(x.name)}" aria-label="Name">
            <input class="input num" data-plan="${x.id}" data-f="amount" type="number" min="0" step="10" value="${x.amount || ''}" placeholder="0" aria-label="Monthly amount for ${esc(x.name)}">
            ${g.id === 'commit' ? `<label class="check plan-debt"><input type="checkbox" data-plan="${x.id}" data-f="debt" ${x.debt ? 'checked' : ''}><span>Loan</span></label>` : '<span class="hide-sm"></span>'}
            <button class="btn btn-sm btn-icon btn-ghost" data-act="plan-del" data-id="${x.id}" aria-label="Remove ${esc(x.name)}">${icon('trash')}</button></div>`).join('')}
          <button class="btn btn-sm btn-ghost" data-act="plan-add" data-v="${g.id}">${icon('plus')}${g.add}</button></div>`;
      };
      return `
        <div class="page-head"><div><div class="eyebrow">Finance</div><h1>Financial planner</h1>
          <p class="sub">What you earn, what you must pay and what’s left to spend each month. Only you can see your plan.</p></div>
          <div class="actions"><button class="btn" data-act="plan-reset">Start again</button></div></div>

        <div class="card"><div class="card-head"><h3>Where your money goes each month</h3><span class="hint">${m2(reg.gross)} salary${other ? ` + ${m2(other)} other income` : ''}</span></div>
          <div class="plan-bar" role="img" aria-label="${segs.map(([l, v]) => `${l} ${m2(v)}`).join(', ')}">${segs.filter(([, v]) => v > 0).map(([l, v, c]) => `<i style="width:${(v / scale) * 100}%;background:${c}" title="${l}: ${m2(v)}"></i>`).join('')}</div>
          <div class="plan-legend">${segs.map(([l, v, c]) => `<div><span class="dot" style="background:${c}"></span><span>${l}</span><strong class="num">${m2(v)}</strong></div>`).join('')}</div>
          ${left < 0 ? `<div class="lock-banner warn">${icon('pin')}<span>You plan to spend ${m2(-left)} more than you take home. Trim living costs or savings, or look at refinancing a loan.</span></div>` : ''}</div>

        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label">Take-home pay</div><div class="kpi-value">${m2(takeHome)}</div><div class="kpi-foot">After ${m2(deductions)} tax and contributions</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--warn)"></span>Must pay</div><div class="kpi-value">${m2(commitT)}</div><div class="kpi-foot">${unpaid ? `${m2(unpaid)} still to pay this month` : commits.length ? 'All paid this month' : 'Add your bills below'}</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:${left >= 0 ? 'var(--gold)' : 'var(--bad)'}"></span>Left to spend</div><div class="kpi-value" style="${left < 0 ? 'color:var(--bad)' : ''}">${m2(left)}</div><div class="kpi-foot">${left > 0 ? `About ${m2(left / 30)} a day, ${m2(left / Math.max(1, daysLeft))} a day for the rest of this month` : 'Nothing spare this month'}</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--brand)"></span>Saving</div><div class="kpi-value">${Math.round(saveRate)}%</div><div class="kpi-foot">${m2(saving)} a month; aim for 20%</div></div>
        </div>

        <div class="grid g-2">
          <div class="card"><div class="card-head"><h3>Health check</h3></div>
            <div class="settings-row"><div><div class="label">Debt service ratio</div><div class="desc">Loan repayments ÷ take-home pay. Banks in Malaysia look at this before approving new loans; under 40% is comfortable, above 60% is hard to get approved.</div></div><div style="text-align:right"><div class="num" style="font-size:20px;font-weight:600">${Math.round(dsr)}%</div><span class="pill ${dsrCls}">${dsrLbl}</span></div></div>
            <div class="settings-row"><div><div class="label">Emergency fund target</div><div class="desc">3 to 6 months of must-pay and living costs.</div></div><div style="text-align:right"><div class="num" style="font-weight:600">${m2(monthsCost * 3)} – ${m2(monthsCost * 6)}</div><span class="faint" style="font-size:12.5px">${saving ? `About ${Math.ceil((monthsCost * 6) / saving)} months at your saving rate` : 'Start with any amount'}</span></div></div>
            <div style="margin-top:14px"><div class="label" style="margin-bottom:8px">50 / 30 / 20 guide</div>
              ${rule.map(([n, d, v, target]) => `<div class="plan-rule"><div><strong>${n}</strong> <span class="faint">${d}</span></div><div class="plan-rule-track"><i style="width:${Math.min(100, v)}%;background:${(n === 'Savings' ? v >= target : v <= target) ? 'var(--brand)' : 'var(--warn)'}"></i><b style="left:${target}%"></b></div><span class="num">${Math.round(v)}% <span class="faint">/ ${target}%</span></span></div>`).join('')}</div></div>
          <div class="card"><div class="card-head"><h3>Your pay package</h3>${last ? `<a class="hint" href="#my-pay">Latest payslip: ${U.fmtMonth(last, { month: 'short', year: 'numeric' })}</a>` : ''}</div>
            <dl class="kv">
              <dt>Monthly salary</dt><dd class="num">${m2(reg.gross)}</dd>
              <dt>Your EPF</dt><dd class="num">−${m2(reg.epf ?? reg.benefits)}</dd>
              ${reg.epf != null ? `<dt>SOCSO and EIS</dt><dd class="num">−${m2(reg.socso + reg.eis)}</dd>` : ''}
              <dt>Income tax (PCB)</dt><dd class="num">−${m2(reg.tax)}</dd>
              ${reg.zakat ? `<dt>Zakat</dt><dd class="num">−${m2(reg.zakat)}</dd>` : ''}
              <dt><strong>Take-home salary</strong></dt><dd class="num"><strong>${m2(reg.net)}</strong></dd>
              ${reg.erCost ? `<dt>Company also pays</dt><dd class="num">${m2(reg.erEpf + reg.erSocso + reg.erEis)} <span class="faint">EPF, SOCSO, EIS</span></dd>
              <dt>Into your EPF a month</dt><dd class="num">${m2(reg.epf + reg.erEpf)}</dd>` : ''}
            </dl>
            ${comingClaims ? `<div class="lock-banner info">${icon('heart')}<span>${m2(comingClaims)} in approved medical claims will be added to your next salary. It’s a refund of what you spent, so it isn’t counted as income here.</span></div>` : ''}
            ${it && it.bonus ? `<p class="faint" style="font-size:12.5px">Your latest payslip included a ${m2(it.bonus)} bonus. The plan uses a regular month.</p>` : ''}
            <p class="faint" style="font-size:12.5px;margin-top:8px">Paying too much tax? <a href="#my-tax">Claim your tax reliefs</a> and ask HR to update your PCB.</p></div>
        </div>

        <div class="card"><div class="card-head"><h3>Your monthly plan</h3><span class="hint">Tick bills as you pay them in ${U.fmtMonth(mk, { month: 'long' })}</span></div>
          ${GROUPS.map(group).join('')}</div>
        <p class="disclaimer">${icon('pin')}<span>A planning guide, not financial advice. Pay figures are estimates from your salary; your payslip is the final amount.</span></p>`;
    };

    AFTER['my-plan'] = () => {
      ctx.$$('[data-plan]').forEach((el) => el.addEventListener('change', () => {
        const x = plan().items.find((i) => i.id === el.dataset.plan); if (!x) return;
        const f = el.dataset.f;
        if (f === 'debt') x.debt = el.checked;
        else if (f === 'amount') x.amount = Math.max(0, r2(Number(el.value) || 0));
        else x.name = el.value.trim() || x.name;
        commit();
      }));
      ctx.$$('[data-plan-paid]').forEach((el) => el.addEventListener('change', () => {
        const mk = U.monthKey(U.today()), p = plan();
        const list = new Set(p.paid[mk] || []);
        if (el.checked) list.add(el.dataset.planPaid); else list.delete(el.dataset.planPaid);
        p.paid = { [mk]: [...list] };
        commit(el.checked ? 'Marked as paid' : null);
      }));
    };

    Object.assign(ACTIONS, {
      'plan-add': (_, g) => { const x = item(g, g === 'income' ? 'Other income' : g === 'save' ? 'New goal' : 'New item', 0); plan().items.push(x); commit(); const el = ctx.$(`[data-plan="${x.id}"][data-f="name"]`); el?.focus(); el?.select(); },
      'plan-del': (id) => { plan().items = plan().items.filter((x) => x.id !== id); commit('Removed'); },
      'plan-reset': () => { ctx.state.plans[ctx.me().id] = { items: template(), paid: {} }; commit('Plan cleared'); },
    });
  }

  return { install, sample, template, GROUPS };
})();
