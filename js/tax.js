// Malaysian tax helper (LHDN). Suggests the Section 33(1) business deduction category for each company
// expense from its description, flags what needs a decision, and tracks personal relief caps.
// It is rule-based keyword matching to help prepare records; it is not tax advice.
window.AllurusTax = (function () {
  'use strict';

  const DISCLAIMER = 'Suggested categorization based on receipt text. Verify context prior to official LHDN submission.';
  const r2 = (n) => Math.round(n * 100) / 100;

  // Business expenses: Income Tax Act 1967, Section 33(1), "wholly and exclusively incurred in the production of gross income".
  const BUSINESS = [
    { id: 'BUS_SALARY_WAGES', cat: 'Payroll', name: 'Staff Salaries, Bonuses & Allowances', keywords: ['salary', 'wage', 'bonus', 'commission', 'allowance', 'overtime'], deductibility: '100% Fully Deductible', trigger: 'Ensure EPF, SOCSO, and EIS statutory contributions are logged concurrently.' },
    { id: 'BUS_RENTAL_PREMISES', cat: 'Rent', name: 'Office, Shop, or Factory Rental', keywords: ['rental', 'lease', 'office rent', 'warehouse lease', 'shop lot'], deductibility: '100% Fully Deductible (Business Portion Only)', trigger: 'If premises are mixed-use (home-office), apportion the business percentage.' },
    { id: 'BUS_UTILITIES_COMM', cat: 'Utilities', name: 'Utilities and Telecommunications', keywords: ['electricity', 'tnb', 'water', 'air selangor', 'internet', 'broadband', 'telecom', 'digi', 'celcom', 'maxis'], deductibility: '100% Fully Deductible for Business Premises', trigger: 'Home-based utility bills: claim only the documented business usage portion.' },
    { id: 'BUS_MARKETING_ADS', cat: 'Marketing', name: 'Digital Marketing and Advertising', keywords: ['meta ads', 'google ads', 'tiktok ads', 'marketing', 'promotion', 'printing', 'signboard'], deductibility: '100% Fully Deductible', trigger: 'High-priority eligible operational marketing expense.' },
    { id: 'BUS_PROFESSIONAL_FEES', cat: 'Professional fees', name: 'Professional and Legal Fees', keywords: ['audit fee', 'tax agent', 'accounting', 'legal fee', 'secretary fee', 'consultant'], deductibility: '100% Fully Deductible', trigger: 'Verify whether legal fees relate to buying a capital asset (not deductible) or to debt recovery and routine operations (deductible).' },
    { id: 'BUS_REPAIRS_MAINT', cat: 'Repairs and maintenance', name: 'Repairs and Maintenance', keywords: ['repair', 'maintenance', 'servicing', 'spare parts', 'hardware fixing', 'plumbing'], deductibility: '100% Fully Deductible', trigger: 'Repairs must keep the asset in its original state. Major improvements or renovation fall under capital rules.' },
    { id: 'BUS_TECH_SUBSCRIPTIONS', cat: 'Software', name: 'Software, Cloud & Domain Subscriptions', keywords: ['aws', 'google workspace', 'cloudflare', 'github', 'laravel', 'saas', 'domain', 'hosting', 'microsoft 365'], deductibility: '100% Fully Deductible', trigger: 'Software and technology operational cost.' },
    { id: 'BUS_TRAVEL_TRANSPORT', cat: 'Travel', name: 'Business Travel, Tolls & Parking', keywords: ['flight', 'hotel', 'grab', 'toll', 'rfid', "touch 'n go", 'parking', 'petrol'], deductibility: 'Fully Deductible (Strictly Business Travel)', trigger: 'Was this trip for client meetings or company operations? Log purpose for audit safety.' },
  ];

  // Personal reliefs for resident individuals (directors, freelancers, staff). Caps are per year of assessment, in RM.
  const RELIEFS = [
    { id: 'REL_LIFESTYLE', name: 'Lifestyle', cap: 2500, keywords: ['books', 'book', 'journal', 'computer', 'laptop', 'smartphone', 'tablet', 'broadband', 'gym', 'sports equipment', 'ai software subscription', 'pet adoption'], trigger: 'Eligible tech and reading purchases can go here if they were not claimed as a business expense.' },
    { id: 'REL_SPORTS', name: 'Sports equipment and activities', cap: 1000, keywords: ['sports shoes', 'gym membership', 'sports facility rental', 'sports training'], trigger: 'A separate cap from Lifestyle. Match sports receipts here first.' },
    { id: 'REL_HEALTH_WELLBEING', name: 'Medical, health and well-being', cap: 10000, keywords: ['medical checkup', 'medical check-up', 'dental', 'vaccination', 'fertility treatment', 'serious illness', 'child learning disability', 'breastfeeding equipment', 'postnatal care'], confirm: 'Issued by a registered medical practitioner or approved institution', trigger: 'Validate the receipt against approved medical practitioner or institution criteria.' },
    { id: 'REL_EDUCATION_SKILLS', name: 'Education and skills training', cap: 7000, keywords: ['course fee', 'master degree', "master's degree", 'upskilling', 'professional certification', 'seminar', 'workshop'], trigger: 'Self-enhancement and professional courses for yourself.' },
    { id: 'REL_PARENTS_MEDICAL', name: 'Medical treatment for parents', cap: 8000, keywords: ['parents medical', 'eldercare', 'medical treatment parents', 'dental parents'], confirm: 'My parents are Malaysian residents and were treated by a certified practitioner', trigger: 'Confirm your parents are residents and treatment was by a certified practitioner.' },
  ];

  // Guardrail: these are never suggested as business deductions.
  const PERSONAL = ['grocery', 'groceries', 'supermarket', 'hypermarket', 'family vacation', 'family holiday', 'vacation', 'holiday', 'family trip', 'honeymoon', 'cinema', 'movie', 'karaoke', 'birthday party', 'entertainment', 'personal'];

  const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const has = (text, kw) => norm(text).includes(norm(kw));
  const best = (text, list) => {
    let top = null, len = 0;
    list.forEach((r) => r.keywords.forEach((k) => { if (k.length > len && has(text, k)) { top = r; len = k.length; } }));
    return top;
  };
  const looksPersonal = (text) => PERSONAL.find((k) => has(text, k)) || null;
  const ruleFor = (category) => BUSINESS.find((r) => r.cat === category) || null;

  // How a company expense is treated under the rules.
  function assess(t) {
    if (!t || t.type !== 'out') return null;
    const rule = ruleFor(t.category), total = r2(t.amount + (t.tax || 0));
    if (t.personal) return { status: 'not', ded: 0, label: 'Personal', rule, note: 'Looks personal. Personal spending is never claimed as a business expense.' };
    if (!rule) return { status: 'check', ded: 0, label: 'Not in rules', rule: null, note: 'Not covered by your deduction rules. Confirm with your tax agent.' };
    if (t.capital) return { status: 'not', ded: 0, label: 'Capital', rule, note: rule.id === 'BUS_REPAIRS_MAINT' ? 'Improvement or renovation is capital spending, not a repair.' : 'Fees for buying a capital asset are not deductible.' };
    const pct = t.bizPct != null ? t.bizPct : 100;
    const ded = r2((total * pct) / 100);
    if (rule.id === 'BUS_TRAVEL_TRANSPORT' && !t.purpose) return { status: 'review', ded, label: 'Add purpose', rule, note: 'Log the business purpose of this trip for audit safety.' };
    return { status: 'ok', ded, label: pct < 100 ? `Business ${pct}%` : 'Deductible', rule, note: pct < 100 ? `Only the business portion (${pct}%) is claimed.` : '' };
  }
  const tag = (t) => {
    const a = assess(t); if (!a) return '';
    return `<span class="tag ${({ ok: 'ok', review: 'warn', check: '', not: 'bad' })[a.status]}" title="${a.note.replace(/"/g, '&quot;')}">${a.label}</span>`;
  };

  // ---------- Expense form helpers (used by Record expense and Add bill) ----------
  function formFields() {
    return `<div class="field full tax-suggest" id="tax-suggest" hidden></div>
      <div class="field full" data-tx-extra="purpose" hidden><label for="tx-purpose">Business purpose</label><input class="input" id="tx-purpose" name="purpose" placeholder="Client meeting with Bluefin Software in Kuala Lumpur"><span class="field-hint">Was this for client meetings or company operations? Log the purpose for audit safety.</span></div>
      <div class="field" data-tx-extra="pct" hidden><label for="tx-pct">Business use (%)</label><input class="input num" id="tx-pct" name="bizPct" type="number" min="1" max="100" step="1" value="100"><span class="field-hint">For a home office, enter only the business share.</span></div>
      <div class="field full" data-tx-extra="capital" hidden><label class="check"><input type="checkbox" name="capital" id="tx-capital"><span id="tx-capital-text"></span></label></div>`;
  }
  function bindForm(form, { desc, cat }) {
    if (!form) return;
    const sel = form.querySelector(cat), box = form.querySelector('#tax-suggest');
    const descEls = desc.map((s) => form.querySelector(s)).filter(Boolean);
    let touched = false;
    const show = (key, on) => { const el = form.querySelector(`[data-tx-extra="${key}"]`); if (el) el.hidden = !on; };
    const extras = () => {
      const r = ruleFor(sel.value);
      show('purpose', r?.id === 'BUS_TRAVEL_TRANSPORT');
      show('pct', r?.id === 'BUS_RENTAL_PREMISES' || r?.id === 'BUS_UTILITIES_COMM');
      show('capital', r?.id === 'BUS_PROFESSIONAL_FEES' || r?.id === 'BUS_REPAIRS_MAINT');
      const ct = form.querySelector('#tx-capital-text');
      if (ct) ct.textContent = r?.id === 'BUS_REPAIRS_MAINT' ? 'This is an improvement or renovation, not a repair (capital, not deductible)' : 'These fees are for buying a capital asset, for example legal fees to buy property (not deductible)';
    };
    const suggest = () => {
      const text = descEls.map((el) => el.value).join(' ');
      if (!text.trim()) { box.hidden = true; return; }
      const p = looksPersonal(text);
      if (p) {
        box.hidden = false; box.className = 'field full tax-suggest warn';
        box.innerHTML = `<strong>This looks personal (“${p}”).</strong><span>It won’t be suggested as a business deduction. Record it only if it was wholly for the business.</span>
          <label class="check"><input type="checkbox" name="bizConfirm"><span>It was wholly and exclusively for the business</span></label><span class="faint">${DISCLAIMER}</span>`;
        return;
      }
      const r = best(text, BUSINESS);
      if (!r) { box.hidden = true; return; }
      const opt = [...sel.options].some((o) => o.value === r.cat);
      if (opt && !touched) { sel.value = r.cat; extras(); }
      box.hidden = false; box.className = 'field full tax-suggest';
      box.innerHTML = `<strong>Suggested: ${r.name}</strong><span>${r.deductibility}. ${r.trigger}</span><span class="faint">${DISCLAIMER}</span>`;
    };
    sel.addEventListener('change', () => { touched = true; extras(); });
    descEls.forEach((el) => el.addEventListener('input', suggest));
    extras();
  }
  function readForm(d, descText) {
    const out = { purpose: (d.purpose || '').trim(), bizPct: Math.min(100, Math.max(1, Math.round(Number(d.bizPct) || 100))), capital: d.capital === 'on' };
    out.personal = !!looksPersonal(descText) && d.bizConfirm !== 'on';
    return out;
  }

  // ---------- Personal income tax estimate (resident individual) ----------
  // Resident rates used for YA2023 to YA2025. Check LHDN for the year you file.
  const BANDS = [[5000, 0], [20000, 1], [35000, 3], [50000, 6], [70000, 11], [100000, 19], [400000, 25], [600000, 26], [2000000, 28], [Infinity, 30]];
  const SELF_RELIEF = 9000, EPF_CAP = 4000, REBATE_LIMIT = 35000, REBATE = 400;
  function residentTax(chargeable) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of BANDS) {
      if (chargeable > lower) tax += ((Math.min(chargeable, upper) - lower) * rate) / 100;
      lower = upper;
    }
    if (chargeable <= REBATE_LIMIT) tax -= REBATE;
    return r2(Math.max(0, tax));
  }

  // ---------- Personal relief claims ----------
  function claims(list, year) {
    const used = {};
    return list.filter((x) => x.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((x) => {
      const rel = RELIEFS.find((r) => r.id === x.cat);
      if (!rel) return { ...x, claim: 0, status: 'Not a relief' };
      if (rel.confirm && !x.confirmed) return { ...x, claim: 0, status: 'Needs confirmation' };
      const room = Math.max(0, rel.cap - (used[rel.id] || 0));
      const claim = r2(Math.min(x.amount, room));
      used[rel.id] = r2((used[rel.id] || 0) + claim);
      return { ...x, claim, status: claim === x.amount ? 'Counted' : claim > 0 ? 'Partly counted' : 'Cap reached' };
    });
  }

  function seedReliefs(T) {
    const y = T.slice(0, 4), d = (md) => `${y}-${md}`;
    const mk = (date, desc, amount, cat, confirmed = false) => ({ id: U.uid('rl'), date, desc, amount, cat, confirmed });
    return {
      'emp@allurus.com': [
        mk(d('02-11'), 'Books from MPH and Kinokuniya', 186.5, 'REL_LIFESTYLE'),
        mk(d('03-04'), 'Smartphone, Samsung Galaxy', 2199, 'REL_LIFESTYLE'),
        mk(d('04-20'), 'Gym membership, 12 months', 720, 'REL_SPORTS'),
        mk(d('05-08'), 'Dental scaling and filling', 380, 'REL_HEALTH_WELLBEING', true),
        mk(d('06-15'), 'AWS professional certification course fee', 1850, 'REL_EDUCATION_SKILLS'),
        mk(d('07-02'), 'Weekly groceries at Lotus', 214.3, ''),
      ].filter((x) => x.date <= T),
      'admin@allurus.com': [
        mk(d('01-18'), 'Laptop for personal use', 3299, 'REL_LIFESTYLE'),
        mk(d('03-09'), 'Medical check-up at KPJ', 650, 'REL_HEALTH_WELLBEING', true),
        mk(d('05-27'), 'Parents medical treatment, cataract surgery', 4200, 'REL_PARENTS_MEDICAL'),
      ].filter((x) => x.date <= T),
    };
  }

  // ---------- Screens ----------
  function install(ctx) {
    const { VIEWS, AFTER, ACTIONS, esc, icon, money, compactMoney, openModal, toast, commit, downloadCSV } = ctx;
    const F = window.AllurusFinance;
    const fin = () => ctx.state.finance;
    const tui = { year: U.today().slice(0, 4), ryear: U.today().slice(0, 4) };
    const rm = (n) => 'RM' + Number(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const disclaimer = `<p class="disclaimer">${icon('pin')}<span>${DISCLAIMER} Rule-based matching on the description, not tax advice. Check caps and rules for the current year of assessment with LHDN or your tax agent.</span></p>`;
    const years = () => { const y = +U.today().slice(0, 4); return [y, y - 1, y - 2].map(String); };
    const STATUS = { ok: 'Deductible', review: 'Needs a decision', check: 'Not in your rules', not: 'Not deductible' };

    // ----- Company: Tax (LHDN) -----
    VIEWS.tax = () => {
      const rows = F.allTxns(fin(), ctx.state.payroll).filter((t) => t.type === 'out' && t.date.startsWith(tui.year)).map((t) => ({ t, a: assess(t), total: r2(t.amount + t.tax) }));
      const total = rows.reduce((s, x) => s + x.total, 0);
      const ded = rows.reduce((s, x) => s + x.a.ded, 0);
      const flagged = rows.filter((x) => x.a.status !== 'ok');
      const notDed = rows.filter((x) => x.a.status === 'not');
      const byRule = BUSINESS.map((r) => { const xs = rows.filter((x) => x.a.rule?.id === r.id); return { r, n: xs.length, spent: xs.reduce((s, x) => s + x.total, 0), ded: xs.reduce((s, x) => s + x.a.ded, 0) }; });
      const other = rows.filter((x) => !x.a.rule);
      const ro = ctx.role() === 'auditor';
      return `
        <div class="page-head"><div><div class="eyebrow">Finance & Accounting · Malaysia (LHDN)</div><h1>Tax deductions</h1>
          <p class="sub">Each company expense is matched to a Section 33(1) category: spending wholly and exclusively incurred in producing gross income. Fix the flagged entries before your tax agent files.</p></div>
          <div class="actions"><select class="select" id="tax-year" aria-label="Year of assessment">${years().map((y) => `<option value="${y}" ${tui.year === y ? 'selected' : ''}>Year of assessment ${y}</option>`).join('')}</select><button class="btn" data-act="tax-export">${icon('download')}Export for tax agent</button></div></div>
        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label">Business expenses</div><div class="kpi-value">${compactMoney(total)}</div><div class="kpi-foot">${rows.length} entries, incl. SST paid</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Deductible under the rules</div><div class="kpi-value">${compactMoney(ded)}</div><div class="kpi-foot">${total ? Math.round((ded / total) * 100) : 0}% of spending</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--warn)"></span>Needs a decision</div><div class="kpi-value">${flagged.length - notDed.length}</div><div class="kpi-foot">Entries to check</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--bad)"></span>Not deductible</div><div class="kpi-value">${compactMoney(notDed.reduce((s, x) => s + x.total, 0))}</div><div class="kpi-foot">${notDed.length} personal or capital</div></div>
        </div>
        <div class="card card-flush"><div class="card-head" style="padding-bottom:14px"><h3>By deduction category</h3><span class="hint">Section 33(1), Income Tax Act 1967</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Category</th><th class="hide-sm">Treatment</th><th class="r">Entries</th><th class="r">Spent</th><th class="r">Deductible</th></tr></thead>
            <tbody>${byRule.map((b) => `<tr><td><strong>${esc(b.r.name)}</strong><div class="person-sub" style="white-space:normal">${esc(b.r.trigger)}</div></td><td class="hide-sm"><span class="tag ok">${esc(b.r.deductibility)}</span></td>
              <td class="r num">${b.n}</td><td class="r num">${money(b.spent)}</td><td class="r num" style="font-weight:600">${money(b.ded)}</td></tr>`).join('')}
              ${other.length ? `<tr><td><strong>Not covered by your rules</strong><div class="person-sub">${esc([...new Set(other.map((x) => x.t.category))].join(', '))}. Confirm with your tax agent.</div></td><td class="hide-sm"><span class="tag">Check</span></td><td class="r num">${other.length}</td><td class="r num">${money(other.reduce((s, x) => s + x.total, 0))}</td><td class="r num faint">—</td></tr>` : ''}</tbody>
          </table></div></div>
        <div class="card"><div class="card-head"><h3>Needs your attention</h3><span class="hint">${flagged.length} entries</span></div>
          ${flagged.length ? `<div class="list">${flagged.filter((x) => x.a.status !== 'check').concat(flagged.filter((x) => x.a.status === 'check')).slice(0, 40).map(({ t, a, total: tt }) => `<div class="list-item">
            <div class="grow"><div class="person-name" style="white-space:normal">${esc(t.desc)}</div><div class="person-sub" style="white-space:normal">${U.fmtDate(t.date, { month: 'short', day: 'numeric' })} · ${esc(t.category)} · ${money(tt)} · ${esc(a.note)}</div></div>
            <span class="tag ${({ review: 'warn', check: '', not: 'bad' })[a.status]}">${STATUS[a.status]}</span>
            ${!ro && t.source !== 'payroll' && (a.status === 'review' || a.status === 'not' || (a.rule && ['BUS_RENTAL_PREMISES', 'BUS_UTILITIES_COMM'].includes(a.rule.id))) ? `<button class="btn btn-sm" data-act="tax-fix" data-id="${t.id}">Update</button>` : ''}</div>`).join('')}</div>` : '<div class="empty"><strong>Nothing to fix</strong>Every expense this year has a clear treatment.</div>'}
        </div>
        <div class="card"><div class="card-head"><h3>Payroll contributions</h3></div><p class="muted">${esc(BUSINESS[0].trigger)} Salaries in this app post automatically from paid payroll runs. Record EPF, SOCSO and EIS payments as you make them so the deduction is supported.</p></div>
        <details class="card rules"><summary><h3>How expenses are matched</h3><span class="hint">Your rule set</span></summary>
          <div class="table-wrap"><table><thead><tr><th>Category</th><th>Keywords in the description</th><th class="hide-sm">Check</th></tr></thead>
          <tbody>${BUSINESS.map((r) => `<tr><td>${esc(r.name)}</td><td class="muted" style="white-space:normal">${esc(r.keywords.join(', '))}</td><td class="hide-sm muted" style="white-space:normal">${esc(r.trigger)}</td></tr>`).join('')}
          <tr><td>Never suggested as business</td><td class="muted" style="white-space:normal">${esc(PERSONAL.join(', '))}</td><td class="hide-sm muted">Personal groceries, family holidays and non-business entertainment are flagged, never converted.</td></tr></tbody></table></div></details>
        ${disclaimer}`;
    };
    AFTER.tax = () => { ctx.$('#tax-year').addEventListener('change', (ev) => { tui.year = ev.target.value; ctx.render(); }); };

    function fixModal(id) {
      const t = fin().txns.find((x) => x.id === id); if (!t) return;
      const rule = ruleFor(t.category), a = assess(t);
      const fields = [];
      if (t.personal) fields.push(`<label class="check"><input type="checkbox" name="bizConfirm" ${t.personal ? '' : 'checked'}><span>This was wholly and exclusively for the business</span></label><div class="field full"><label for="fx-purpose">Business purpose (required)</label><input class="input" id="fx-purpose" name="purpose" value="${esc(t.purpose || '')}"></div>`);
      else if (rule?.id === 'BUS_TRAVEL_TRANSPORT') fields.push(`<div class="field full"><label for="fx-purpose">Business purpose</label><input class="input" id="fx-purpose" name="purpose" value="${esc(t.purpose || '')}" placeholder="Client meeting with Cedar Health in Kuala Lumpur" required><span class="field-hint">${esc(rule.trigger)}</span></div>`);
      if (!t.personal && (rule?.id === 'BUS_RENTAL_PREMISES' || rule?.id === 'BUS_UTILITIES_COMM')) fields.push(`<div class="field"><label for="fx-pct">Business use (%)</label><input class="input num" id="fx-pct" name="bizPct" type="number" min="1" max="100" value="${t.bizPct ?? 100}"><span class="field-hint">${esc(rule.trigger)}</span></div>`);
      if (!t.personal && (rule?.id === 'BUS_PROFESSIONAL_FEES' || rule?.id === 'BUS_REPAIRS_MAINT')) fields.push(`<label class="check"><input type="checkbox" name="capital" ${t.capital ? 'checked' : ''}><span>${rule.id === 'BUS_REPAIRS_MAINT' ? 'Improvement or renovation (capital, not deductible)' : 'For buying a capital asset (not deductible)'}</span></label><p class="field-hint">${esc(rule.trigger)}</p>`);
      if (!fields.length) { toast('Change this entry’s category in Bookkeeping, or ask your tax agent', 'error'); return; }
      openModal({
        title: 'Update tax treatment', size: 'sm', submit: 'Save',
        body: `<div class="form-grid" style="grid-template-columns:1fr"><div><strong>${esc(t.desc)}</strong><div class="muted">${U.fmtDate(t.date)} · ${esc(t.category)} · ${money(t.amount + t.tax)}</div><p class="muted" style="margin-top:6px">${esc(a.note)}</p></div>${fields.join('')}<p class="disclaimer">${DISCLAIMER}</p></div>`,
        onSubmit(d) {
          if (t.personal) {
            if (d.bizConfirm !== 'on') { toast('Left as personal. It stays out of your deductions.'); return; }
            if (!(d.purpose || '').trim()) { toast('Write the business purpose before claiming it', 'error'); return false; }
            t.personal = false;
          }
          if (d.purpose != null) t.purpose = d.purpose.trim();
          if (d.bizPct != null) t.bizPct = Math.min(100, Math.max(1, Math.round(Number(d.bizPct) || 100)));
          if (rule?.id === 'BUS_PROFESSIONAL_FEES' || rule?.id === 'BUS_REPAIRS_MAINT') t.capital = d.capital === 'on';
          commit('Tax treatment saved', `Tax treatment updated for ${t.desc}`);
        },
      });
    }

    // ----- Personal: Tax reliefs -----
    const key = () => ctx.account()?.email || 'me';
    const myList = () => { ctx.state.reliefs = ctx.state.reliefs || {}; return (ctx.state.reliefs[key()] = ctx.state.reliefs[key()] || []); };
    VIEWS['my-tax'] = () => {
      const list = claims(myList(), tui.ryear);
      const usedBy = (id) => list.filter((x) => x.cat === id).reduce((s, x) => s + x.claim, 0);
      const total = RELIEFS.reduce((s, r) => s + usedBy(r.id), 0);
      const pill = (s) => `<span class="pill ${({ Counted: 'ok', 'Partly counted': 'warn', 'Cap reached': 'bad', 'Needs confirmation': 'warn', 'Not a relief': '' })[s]}">${s}</span>`;
      return `
        <div class="page-head"><div><div class="eyebrow">Personal income tax · LHDN</div><h1>Tax reliefs</h1>
          <p class="sub">Keep your personal receipts here through the year. Each one is matched to a relief and counted against its yearly cap. These are your own reliefs, separate from the company’s books.</p></div>
          <div class="actions"><select class="select" id="rel-year" aria-label="Year of assessment">${years().map((y) => `<option value="${y}" ${tui.ryear === y ? 'selected' : ''}>Year of assessment ${y}</option>`).join('')}</select><button class="btn btn-primary" data-act="rel-add">${icon('plus')}Add receipt</button></div></div>
        <div class="grid g-3">${RELIEFS.map((r) => { const u = usedBy(r.id), pct = (u / r.cap) * 100; return `<div class="card relief">
          <div class="kpi-label">${esc(r.name)}</div><div class="kpi-value" style="font-size:24px">${rm(u)}<span class="faint" style="font-size:14px"> of ${rm(r.cap)}</span></div>
          <div class="progress"><i style="width:${Math.min(100, pct)}%;background:${pct >= 100 ? 'var(--gold)' : 'var(--brand)'}"></i></div>
          <div class="kpi-foot">${pct >= 100 ? 'Cap reached. Further receipts in this relief won’t reduce your tax.' : `${rm(r.cap - u)} of room left`}</div>
          <p class="faint" style="font-size:12.5px">${esc(r.trigger)}</p></div>`; }).join('')}
          <div class="card relief" style="background:var(--brand-soft)"><div class="kpi-label">Total counted</div><div class="kpi-value" style="font-size:24px">${rm(total)}</div><div class="kpi-foot">Across these ${RELIEFS.length} reliefs for ${tui.ryear}. Claim them in your e-Filing form.</div></div>
        </div>
        ${beCard(list)}
        <div class="card card-flush"><div class="card-head" style="padding-bottom:14px"><h3>Receipts</h3><span class="hint">${list.length} for ${tui.ryear}</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Receipt</th><th class="hide-sm">Relief</th><th class="r">Amount</th><th class="r">Counted</th><th>Status</th><th></th></tr></thead>
            <tbody>${list.slice().reverse().map((x) => `<tr><td class="num muted">${U.fmtDate(x.date, { month: 'short', day: 'numeric' })}</td><td>${esc(x.desc)}</td>
              <td class="hide-sm">${esc(RELIEFS.find((r) => r.id === x.cat)?.name || '—')}</td><td class="r num">${rm(x.amount)}</td><td class="r num" style="font-weight:600">${rm(x.claim)}</td><td>${pill(x.status)}</td>
              <td><div class="row-actions">${x.status === 'Needs confirmation' ? `<button class="btn btn-sm" data-act="rel-confirm" data-id="${x.id}">Confirm</button>` : ''}<button class="btn btn-sm btn-icon btn-ghost" data-act="rel-del" data-id="${x.id}" aria-label="Delete receipt">${icon('trash')}</button></div></td></tr>`).join('')}</tbody>
          </table>${list.length ? '' : '<div class="empty"><strong>No receipts yet</strong>Add receipts as you get them so nothing is missed at tax time.</div>'}</div></div>
        <p class="disclaimer">${icon('pin')}<span>Don’t claim the same receipt twice: if the company already recorded it as a business expense, leave it out here. ${DISCLAIMER}</span></p>`;
    };
    AFTER['my-tax'] = () => {
      ctx.$('#rel-year').addEventListener('change', (ev) => { tui.ryear = ev.target.value; ctx.render(); });
      ctx.$('#be-epf')?.addEventListener('change', (ev) => { profile(tui.ryear).epf = ev.target.value === '' ? null : Math.max(0, r2(Number(ev.target.value) || 0)); commit('EPF amount saved'); });
    };

    // ----- BE form helper: pulls income and PCB from this person's paid payslips -----
    const profile = (year) => {
      ctx.state.taxProfiles = ctx.state.taxProfiles || {};
      const p = (ctx.state.taxProfiles[key()] = ctx.state.taxProfiles[key()] || {});
      return (p[year] = p[year] || { epf: null });
    };
    function beFigures(list) {
      const year = tui.ryear, e = ctx.me();
      const slips = Object.entries(ctx.state.payroll || {}).filter(([mk, run]) => mk.startsWith(year) && run.status === 'Paid').map(([mk, run]) => ({ mk, it: run.items.find((i) => i.empId === e?.id) })).filter((x) => x.it);
      const income = r2(slips.reduce((s, x) => s + x.it.gross, 0));
      const pcb = r2(slips.reduce((s, x) => s + x.it.tax, 0));
      const fromPay = r2(slips.reduce((s, x) => s + x.it.benefits, 0));
      const epfIn = profile(year).epf != null ? profile(year).epf : fromPay;
      const epf = Math.min(epfIn, EPF_CAP);
      const lines = [
        { label: 'Individual relief (automatic)', amt: SELF_RELIEF },
        ...RELIEFS.map((r) => ({ label: r.name, amt: r2(list.filter((x) => x.cat === r.id).reduce((s, x) => s + x.claim, 0)) })),
        { label: `EPF contributions (up to ${rm(EPF_CAP)})`, amt: epf },
      ];
      const reliefs = r2(lines.reduce((s, l) => s + l.amt, 0));
      const chargeable = Math.max(0, r2(income - reliefs));
      const tax = residentTax(chargeable);
      return { year, slips, income, pcb, fromPay, lines, reliefs, chargeable, tax, balance: r2(tax - pcb) };
    }
    function beCard(list) {
      const b = beFigures(list);
      return `<div class="card be"><div class="card-head"><h3>BE form helper, ${b.year}</h3><span class="hint">Linked to Allurus payroll</span></div>
        <p class="muted" style="margin-bottom:14px">Your income and the tax already deducted (PCB) come from your ${b.slips.length} paid payslip${b.slips.length === 1 ? '' : 's'} for ${b.year}. Your reliefs come from the receipts below. Check them against the EA form from your employer, then copy them into e-Filing.</p>
        <div class="report-grid">
          <section><h4>Income</h4><div class="rep-lines">
            <div><span>Employment income, from payslips</span><span class="num">${rm(b.income)}</span></div>
            <div><span>Tax deducted through payroll (PCB)</span><span class="num">${rm(b.pcb)}</span></div></div>
            <h4>Reliefs</h4><div class="rep-lines">${b.lines.map((l) => `<div><span>${esc(l.label)}</span><span class="num">${rm(l.amt)}</span></div>`).join('')}
            <div class="tot"><span>Total reliefs</span><span class="num">${rm(b.reliefs)}</span></div></div>
            <div class="field" style="margin-top:12px"><label for="be-epf">EPF contributions this year</label><input class="input num" id="be-epf" type="number" min="0" step="0.01" value="${profile(b.year).epf ?? b.fromPay}" style="max-width:200px"><span class="field-hint">${profile(b.year).epf == null ? `Taken from your payslips (EPF, SOCSO and EIS deducted: ${rm(b.fromPay)}). Change it to the EPF figure on your EA form.` : 'Entered by you. Clear the box to use your payslips again.'}</span></div></section>
          <section><h4>Estimate</h4><div class="rep-lines">
            <div><span>Chargeable income</span><span class="num">${rm(b.chargeable)}</span></div>
            <div><span>Estimated income tax${b.chargeable <= REBATE_LIMIT ? `, after ${rm(REBATE)} rebate` : ''}</span><span class="num">${rm(b.tax)}</span></div>
            <div><span>Already paid through PCB</span><span class="num">−${rm(b.pcb)}</span></div>
            <div class="grand"><span>${b.balance > 0 ? 'Estimated balance to pay' : 'Estimated refund'}</span><span class="num" style="color:${b.balance > 0 ? 'var(--bad)' : 'var(--ok)'}">${rm(Math.abs(b.balance))}</span></div></div>
            <p class="faint" style="font-size:12.5px;margin-top:10px">Estimate using resident tax rates for YA2023 to YA2025. ${b.year === U.today().slice(0, 4) ? 'This year isn’t finished, so the figures will change. ' : ''}File the BE form by 30 April, or 15 May if you file online.</p>
            <div class="ci-actions" style="justify-content:flex-start"><button class="btn" data-act="be-copy">${icon('doc')}Copy summary</button><button class="btn" data-act="be-export">${icon('download')}Export CSV</button></div></section>
        </div></div>`;
    }
    const beText = () => {
      const b = beFigures(claims(myList(), tui.ryear));
      return [`BE form ${b.year} summary (prepared in Allurus, estimate only)`, `Employment income: ${rm(b.income)}`, `PCB deducted: ${rm(b.pcb)}`,
        ...b.lines.map((l) => `${l.label}: ${rm(l.amt)}`), `Total reliefs: ${rm(b.reliefs)}`, `Chargeable income: ${rm(b.chargeable)}`,
        `Estimated tax: ${rm(b.tax)}`, `${b.balance > 0 ? 'Estimated balance to pay' : 'Estimated refund'}: ${rm(Math.abs(b.balance))}`, DISCLAIMER].join('\n');
    };

    function reliefModal() {
      openModal({
        title: 'Add receipt', size: 'sm', submit: 'Save receipt',
        body: `<div class="form-grid">
          <div class="field full"><label for="rl-desc">What did you buy?</label><input class="input" id="rl-desc" name="desc" required placeholder="Gym membership, dental check-up, course fee"></div>
          <div class="field"><label for="rl-date">Receipt date</label><input class="input" id="rl-date" name="date" type="date" required value="${U.today()}" max="${U.today()}"></div>
          <div class="field"><label for="rl-amt">Amount (RM)</label><input class="input num" id="rl-amt" name="amount" type="number" min="0.01" step="0.01" required></div>
          <div class="field full"><label for="rl-cat">Relief</label><select class="select" id="rl-cat" name="cat"><option value="">Not a tax relief</option>${RELIEFS.map((r) => `<option value="${r.id}">${esc(r.name)} (cap ${rm(r.cap)})</option>`).join('')}</select></div>
          <div class="field full tax-suggest" id="rl-suggest" hidden></div>
          <label class="field full check" id="rl-confirm-wrap" hidden><input type="checkbox" name="confirmed" id="rl-confirm"><span id="rl-confirm-text"></span></label></div>`,
        onSubmit(d) {
          const amount = r2(Number(d.amount));
          if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
          myList().push({ id: U.uid('rl'), date: d.date, desc: d.desc.trim(), amount, cat: d.cat, confirmed: d.confirmed === 'on' });
          tui.ryear = d.date.slice(0, 4);
          commit('Receipt saved');
        },
      });
      const form = ctx.$('#overlay-root form'), sel = form.querySelector('#rl-cat'), box = form.querySelector('#rl-suggest');
      let touched = false;
      const conf = () => { const r = RELIEFS.find((x) => x.id === sel.value); form.querySelector('#rl-confirm-wrap').hidden = !r?.confirm; form.querySelector('#rl-confirm-text').textContent = r?.confirm || ''; };
      sel.addEventListener('change', () => { touched = true; conf(); });
      form.querySelector('#rl-desc').addEventListener('input', (ev) => {
        const text = ev.target.value;
        const p = looksPersonal(text);
        if (p) { if (!touched) sel.value = ''; conf(); box.hidden = false; box.className = 'field full tax-suggest warn'; box.innerHTML = `<strong>Not a tax relief</strong><span>Everyday spending like “${esc(p)}” isn’t covered by these reliefs.</span>`; return; }
        const r = best(text, RELIEFS);
        if (!r) { box.hidden = true; return; }
        if (!touched) { sel.value = r.id; conf(); }
        const used = claims(myList(), (form.querySelector('#rl-date').value || U.today()).slice(0, 4)).filter((x) => x.cat === r.id).reduce((s, x) => s + x.claim, 0);
        box.hidden = false; box.className = 'field full tax-suggest';
        box.innerHTML = `<strong>Suggested: ${esc(r.name)}</strong><span>${used >= r.cap ? `You have already reached the ${rm(r.cap)} cap this year.` : `${rm(r.cap - used)} of ${rm(r.cap)} left this year.`} ${esc(r.trigger)}</span><span class="faint">${DISCLAIMER}</span>`;
      });
      conf();
    }

    Object.assign(ACTIONS, {
      'tax-fix': (id) => fixModal(id),
      'tax-export': () => downloadCSV(`lhdn-deductions-${tui.year}.csv`, [['Date', 'Description', 'Reference', 'Book category', 'LHDN category', 'Treatment', 'Amount incl. SST', 'Deductible', 'Status', 'Note', 'Purpose', 'Business %'],
        ...F.allTxns(fin(), ctx.state.payroll).filter((t) => t.type === 'out' && t.date.startsWith(tui.year)).map((t) => { const a = assess(t); return [t.date, t.desc, t.ref, t.category, a.rule?.name || '', a.rule?.deductibility || '', r2(t.amount + t.tax), a.ded, STATUS[a.status], a.note, t.purpose || '', t.bizPct ?? 100]; }),
        [], ['Disclaimer', DISCLAIMER]]),
      'rel-add': () => reliefModal(),
      'be-copy': () => {
        const text = beText();
        navigator.clipboard?.writeText(text).then(() => toast('Summary copied. Paste it into your notes or e-Filing.'), () => {
          openModal({ title: 'BE form summary', size: 'sm', submit: null, body: `<textarea class="textarea" style="width:100%;min-height:260px" readonly>${esc(text)}</textarea><p class="field-hint">Select the text and copy it.</p>` });
        });
      },
      'be-export': () => { const b = beFigures(claims(myList(), tui.ryear)); downloadCSV(`be-form-${b.year}.csv`, [['Item', 'Amount (RM)'], ['Employment income', b.income], ['PCB deducted', b.pcb], ...b.lines.map((l) => [l.label, l.amt]), ['Total reliefs', b.reliefs], ['Chargeable income', b.chargeable], ['Estimated tax', b.tax], [b.balance > 0 ? 'Estimated balance to pay' : 'Estimated refund', Math.abs(b.balance)], [], ['Disclaimer', DISCLAIMER]]); },
      'rel-del': (id) => { ctx.state.reliefs[key()] = myList().filter((x) => x.id !== id); commit('Receipt removed'); },
      'rel-confirm': (id) => {
        const x = myList().find((r) => r.id === id), rel = RELIEFS.find((r) => r.id === x.cat);
        openModal({ title: 'Confirm receipt', size: 'sm', submit: 'Confirm', body: `<p><strong>${esc(x.desc)}</strong> · ${rm(x.amount)}</p><label class="check" style="margin-top:12px"><input type="checkbox" name="ok" required><span>${esc(rel.confirm)}</span></label>`,
          onSubmit(d) { if (d.ok !== 'on') { toast('Tick the box to confirm', 'error'); return false; } x.confirmed = true; commit('Receipt confirmed'); } });
      },
    });
  }

  return { residentTax, BUSINESS, RELIEFS, PERSONAL, DISCLAIMER, assess, tag, formFields, bindForm, readForm, claims, seedReliefs, looksPersonal, install };
})();
