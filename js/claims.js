// Claims: staff claim travel, mileage, meals, parking and toll, accommodation, phone, training, entertainment,
// medical and other costs, with several items and receipts per claim (each read by the receipt scanner). Claims go
// through the same approval chain as leave (L1 → L2 → HR, with backups); approvers see the receipts side by side with
// the limits left. HR can correct amounts or receipt numbers with a logged reason. Approved claims are reimbursed with
// the next payroll or paid now, and post to the books under each category's GL account.
// The rules live in js/claims-rules.js (AllurusClaimRules); the medical policy (types and limits) stays here.
window.AllurusClaims = (function () {
  'use strict';
  const r2 = (n) => Math.round(n * 100) / 100;

  // Typical Malaysian SME medical benefits. Every amount is a starting point for the company to change.
  const DEFAULT_TYPES = [
    { id: 'outpatient', name: 'Outpatient (GP clinic)', annual: 1000, perClaim: 80, family: false, receipt: true, on: true, note: 'Consultation and medicine at a general practitioner, including visits for sick leave.' },
    { id: 'specialist', name: 'Specialist consultation', annual: 2000, perClaim: 300, family: false, receipt: true, on: true, note: 'With a referral letter from a GP.' },
    { id: 'dental', name: 'Dental', annual: 400, perClaim: 0, family: false, receipt: true, on: true, note: 'Check-ups, scaling, fillings and extractions. Cosmetic treatment is not covered.' },
    { id: 'optical', name: 'Optical', annual: 300, perClaim: 0, family: false, receipt: true, on: true, note: 'Eye tests, prescription glasses and contact lenses.' },
    { id: 'screening', name: 'Health screening', annual: 400, perClaim: 0, family: false, receipt: true, on: true, note: 'Yearly medical check-up and blood tests.' },
    { id: 'hospital', name: 'Hospitalisation and surgery', annual: 20000, perClaim: 0, family: false, receipt: true, on: true, note: 'Claim the part not covered by the group insurance (GHS/GPA) first.' },
    { id: 'maternity', name: 'Maternity', annual: 3000, perClaim: 0, family: true, receipt: true, on: true, note: 'Pre-natal check-ups, delivery and post-natal care.' },
    { id: 'vaccination', name: 'Vaccination', annual: 200, perClaim: 0, family: false, receipt: true, on: true, note: 'Flu, hepatitis, HPV and similar vaccines.' },
    { id: 'physio', name: 'Physiotherapy and chiropractic', annual: 500, perClaim: 150, family: false, receipt: true, on: false, note: 'With a doctor’s referral.' },
    { id: 'tcm', name: 'Traditional and complementary medicine', annual: 300, perClaim: 80, family: false, receipt: true, on: false, note: 'TCM, acupuncture and similar, by a registered T&CM practitioner.' },
    { id: 'mental', name: 'Mental health and counselling', annual: 500, perClaim: 200, family: false, receipt: true, on: false, note: 'Sessions with a registered counsellor, psychologist or psychiatrist.' },
    { id: 'preemployment', name: 'Pre-employment medical check-up', annual: 200, perClaim: 0, family: false, receipt: true, on: false, note: 'Reimbursed once, when joining.' },
    { id: 'other', name: 'Other medical', annual: 300, perClaim: 0, family: false, receipt: true, on: true, note: 'Anything else the company agrees to cover. Describe it in the note.' },
  ];
  const policyDefaults = () => ({ enabled: true, probationMonths: 0, types: DEFAULT_TYPES.map((t) => ({ ...t, builtin: true })), categories: AllurusClaimRules.defaultCategories(), mileage: AllurusClaimRules.defaultMileage() });

  // A receipt image for the demo (real claims use photos).
  function receiptSvg(merchant, items, total, date, no) {
    const rows = items.map(([k, v], i) => `<text x="24" y="${150 + i * 22}" font-size="13">${k}</text><text x="276" y="${150 + i * 22}" font-size="13" text-anchor="end">${v}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="${250 + items.length * 22}" viewBox="0 0 300 ${250 + items.length * 22}"><rect width="100%" height="100%" fill="#fffdf7"/><g font-family="Courier New, monospace" fill="#222"><text x="150" y="42" font-size="15" font-weight="bold" text-anchor="middle">${merchant}</text><text x="150" y="64" font-size="11" text-anchor="middle">Kemaman, Terengganu</text><text x="24" y="100" font-size="12">Date: ${date}</text><text x="24" y="118" font-size="12">Receipt: ${no}</text>${rows}<line x1="24" x2="276" y1="${158 + items.length * 22}" y2="${158 + items.length * 22}" stroke="#222" stroke-dasharray="4 3"/><text x="24" y="${184 + items.length * 22}" font-size="14" font-weight="bold">TOTAL</text><text x="276" y="${184 + items.length * 22}" font-size="14" font-weight="bold" text-anchor="end">RM ${total}</text><text x="150" y="${222 + items.length * 22}" font-size="11" text-anchor="middle">Terima kasih</text></g></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  // Sample claims for the demo company: medical claims from before, and multi-item business claims.
  function seed(employees, T, settings) {
    const R = AllurusClaimRules, L = AllurusLeaveRules;
    const y = T.slice(0, 4), mk = U.monthKey(T), prev = U.addMonths(mk, -1), prev2 = U.addMonths(mk, -2);
    const lv = settings?.leave;
    const chainFor = (empId) => { const e = employees.find((x) => x.id === empId); return lv && e ? L.buildChain({ applicant: empId, chain: lv.chains[e.dept], hr: lv.hr, hrBackup: lv.hrBackup }) : []; };
    let n = 0;
    const ln = (cat, date, merchant, amount, extra = {}) => ({ id: `ln${++n}`, cat, date, merchant, receiptNo: extra.receiptNo || `R${10230 + n}`, amount: r2(amount), approved: null, img: extra.noImg ? null : receiptSvg(merchant, extra.items || [[extra.item || 'Item', amount.toFixed(2)]], amount.toFixed(2), date, extra.receiptNo || `R${10230 + n}`), notes: extra.notes || '', fields: extra.fields || {}, ...(extra.sub ? { sub: extra.sub } : {}) });
    const claim = (id, empId, title, lines, status, extra = {}) => {
      const done = ['Approved', 'Paid'].includes(status);
      if (done) lines.forEach((l) => { l.approved = extra.approve?.[l.id] ?? l.amount; });
      let chain = chainFor(empId);
      if (status !== 'Pending') chain = chain.map((s) => (s.status === 'pending' ? { ...s, status: status === 'Rejected' ? 'rejected' : 'approved', by: s.approver, at: lines[0].date, actedAs: 'approver', note: status === 'Rejected' && s.level === 'Final' ? extra.reason || '' : '' } : s));
      (extra.steps || []).forEach(() => { const s = L.nextStep(chain); if (s) Object.assign(s, { status: 'approved', by: s.approver, at: T, actedAs: 'approver' }); });
      const c = { id, empId, title, lines, status, submitted: lines[0].date, date: lines[0].date, chain, edits: [], ...extra };
      delete c.approve; delete c.steps;
      c.approved = done ? R.approvedTotal(c) : null;
      return c;
    };
    const med = (sub, date, clinic, amount, extra = {}) => ln('medical', date, clinic, amount, { ...extra, sub, fields: { patient: extra.patient || 'Self' }, item: 'Consultation and medicine' });
    const list = [
      claim('cl1', 'e2', 'Outpatient (GP clinic)', [med('outpatient', `${prev2}-07`, 'Klinik Mediviron Kuantan', 65)], 'Paid', { paidIn: prev2 }),
      claim('cl2', 'e2', 'Dental', [med('dental', `${prev}-14`, 'Klinik Pergigian Senyum', 180)], 'Paid', { paidIn: prev }),
      claim('cl3', 'e2', 'Clinic visit', [med('outpatient', U.addDays(T, -3), 'Klinik Kesihatan Teluk Sisek', 72, { notes: 'Fever and cough, 2 days MC.' })], 'Pending'),
      claim('cl4', 'e5', 'New glasses', [med('optical', U.addDays(T, -6), 'Focus Point Kuantan', 420)], 'Pending'),
      claim('cl5', 'e8', 'Specialist consultation', [med('specialist', U.addDays(T, -10), 'KPJ Pahang Specialist Hospital', 280)], 'Approved'),
      claim('cl6', 'e13', 'Health screening', [med('screening', U.addDays(T, -15), 'Pathlab Kuantan', 250)], 'Approved'),
      claim('cl7', 'e10', 'Clinic visit', [med('outpatient', `${prev}-03`, 'Klinik Mediviron Kuantan', 120)], 'Rejected', { reason: 'Above the RM80 per-visit limit and no receipt for medicine. Please resubmit with the itemised receipt.' }),
      claim('cl8', 'e3', 'Maternity', [med('maternity', `${prev}-20`, 'Pantai Hospital Kuantan', 1650, { patient: 'Spouse' })], 'Paid', { paidIn: prev }),
      // A sales trip: mileage, toll and a client lunch, waiting for Ravi (L1) then HR.
      claim('cl9', 'e6', 'Client visit to Kuala Terengganu', [
        ln('mileage', U.addDays(T, -4), 'Own car', 87, { noImg: true, receiptNo: '', fields: { purpose: 'Demo for Kenyir Resorts', from: 'Kemaman office', to: 'Kuala Terengganu', km: 145, vehicle: 'car' } }),
        ln('parking', U.addDays(T, -4), 'PLUS / Touch ’n Go', 12.4, { item: 'Toll Kemaman – Kuala Terengganu', fields: { purpose: 'Client visit', location: 'LPT2' } }),
        ln('entertainment', U.addDays(T, -4), 'Restoran Ikan Bakar Pantai', 86.5, { items: [['Ikan bakar set x3', '72.00'], ['Drinks', '14.50']], fields: { purpose: 'Lunch after the demo', attendees: 'Encik Hafiz and Puan Rosnah, Kenyir Resorts' } }),
      ], 'Pending'),
      // A roadshow in KL: flight, two hotel nights and e-hailing, approved and waiting for payroll.
      claim('cl10', 'e14', 'MATRADE roadshow, Kuala Lumpur', [
        ln('travel', U.addDays(T, -18), 'AirAsia', 289, { item: 'KUA–KUL return', fields: { purpose: 'MATRADE SME roadshow', from: 'Kuantan', to: 'Kuala Lumpur' } }),
        ln('accommodation', U.addDays(T, -18), 'Hotel Stripes Kuala Lumpur', 640, { items: [['Deluxe room x2 nights', '600.00'], ['Tourism tax', '20.00'], ['Service tax', '20.00']], fields: { purpose: 'MATRADE SME roadshow', location: 'Kuala Lumpur', nights: 2 } }),
        ln('travel', U.addDays(T, -17), 'Grab', 45, { item: 'MITEC – hotel', fields: { purpose: 'Roadshow venue' } }),
      ], 'Approved'),
      claim('cl11', 'e10', 'Mobile plan, September', [ln('phone', `${prev}-28`, 'Maxis', 80, { item: 'Postpaid 98' })], 'Paid', { paidIn: prev }),
      // A training course: Daniel's manager (Arjun) is on leave, so it waits until he's back or HR steps in.
      claim('cl12', 'e2', 'AWS Solutions Architect exam', [ln('training', U.addDays(T, -2), 'Pearson VUE', 650, { item: 'AWS SAA-C03 exam voucher', fields: { purpose: 'Certification agreed in my review' } })], 'Pending'),
      // Gym membership is a taxable benefit in this demo company's policy, so it goes into gross pay.
      claim('cl13', 'e9', 'Gym membership, October', [ln('wellness', U.addDays(T, -12), 'Anytime Fitness Kuantan', 150, { item: 'Monthly membership', fields: {} })], 'Approved'),
    ];
    return list.filter((x) => x.date.startsWith(y) || x.date > `${+y - 1}-12-31`);
  }

  // How much of a medical type an employee has used in a year (kept for older callers).
  const usage = (claims, empId, typeId, year) => AllurusClaimRules.usage(claims, empId, { cat: 'medical', sub: typeId, year });

  function install(ctx) {
    const R = AllurusClaimRules, LR = AllurusLeaveRules;
    const { VIEWS, AFTER, ACTIONS, esc, icon, money, compactMoney, openModal, closeOverlay, toast, commit } = ctx;
    const st = () => ctx.state;
    const pol = () => (st().settings.claims = st().settings.claims || policyDefaults());
    const cats = () => pol().categories;
    const catOf = (id) => cats().find((c) => c.id === id) || { id, name: 'Removed category', gl: 'Other expenses', fields: [], perClaim: 0, perMonth: 0, perYear: 0 };
    const medTypes = () => pol().types;
    const medOf = (id) => medTypes().find((t) => t.id === id);
    const list = () => (st().claims = st().claims || []);
    const find = (id) => list().find((c) => c.id === id);
    const m2 = (n) => money(n, 2);
    const T = () => U.today();
    const year = () => T().slice(0, 4);
    const cui = { filter: 'Pending', tab: 'review', by: 'category', year: +U.today().slice(0, 4), statuses: 'approved' };
    const pill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'info', Paid: 'ok', Rejected: 'bad', Cancelled: '' })[s] || ''}">${s === 'Approved' ? 'Approved, to pay' : s}</span>`;
    const nameOf = (id) => ctx.fullName(ctx.emp(id));
    const firstOf = (id) => ctx.emp(id)?.first || '—';
    const catNames = (c) => [...new Set(c.lines.map((l) => (l.cat === 'medical' && medOf(l.sub) ? medOf(l.sub).name : catOf(l.cat).name)))];
    const eligible = (e) => { const months = pol().probationMonths || 0; return !months || U.addMonths(U.monthKey(e.start), months) <= U.monthKey(T()); };

    // ---------- Approvals (the leave approval chain) ----------
    const leaveCfg = () => st().settings.leave;
    const actor = () => (ctx.role() === 'admin' ? ctx.account()?.empId || 'e1' : ctx.me()?.id);
    const isAway = (id) => !!ctx.leave?.onLeave(id, T());
    // Nobody decides their own claim, in any view; HR's override needs access to claims.
    function canActOn(c) {
      if (c.status !== 'Pending' || c.empId === actor()) return '';
      const step = LR.nextStep(c.chain);
      const as = step ? LR.canAct(step, actor(), isAway) : '';
      return as || (ctx.role() === 'admin' && (window.AllurusAccess ? window.AllurusAccess.can('claims') : true) ? 'override' : '');
    }
    const forMe = (empId) => list().filter((c) => c.status === 'Pending' && LR.canAct(LR.nextStep(c.chain), empId, isAway));
    const chainFor = (e) => LR.buildChain({ applicant: e.id, chain: leaveCfg().chains?.[e.dept], hr: leaveCfg().hr, hrBackup: leaveCfg().hrBackup });
    const nextText = (c) => { if (c.status !== 'Pending') return ''; const n = LR.nextStep(c.chain); return n ? `With ${firstOf(n.approver)}` : 'With HR'; };
    function chainDots(c) {
      const steps = (c.chain || []).filter((s) => s.status !== 'skipped'), next = LR.nextStep(c.chain);
      return steps.length ? `<span class="chain-dots" aria-hidden="true">${steps.map((s) => `<i class="cd-${s === next ? 'next' : s.status}" title="${s.level}: ${esc(nameOf(s.approver))}"></i>`).join('')}</span>` : '';
    }
    const limitsOf = (c) => R.limitsFor(c, { cats: cats(), claims: list(), medicalTypes: medTypes() });

    // ---------- Shared rows ----------
    function rows(items, { showEmp = true, mine = false } = {}) {
      return items.map((c) => { const e = ctx.emp(c.empId); if (!e) return ''; return `<tr class="clickable" data-act="cl-review" data-id="${c.id}">
        ${showEmp ? `<td>${ctx.person(e)}</td>` : ''}
        <td><strong>${esc(c.title)}</strong><div class="cl-tags">${catNames(c).map((n) => `<span class="tag">${esc(n)}</span>`).join('')}${c.lines.length > 1 ? `<span class="faint">${c.lines.length} items</span>` : ''}</div>${c.reason && c.status === 'Rejected' ? `<div class="person-sub" style="white-space:normal;color:var(--bad)">${esc(c.reason)}</div>` : ''}</td>
        <td class="hide-sm muted num">${U.fmtDate(c.date, { month: 'short', day: 'numeric' })}</td>
        <td class="r num">${m2(R.claimTotal(c))}</td><td class="r num">${c.approved != null ? m2(c.approved) : '—'}</td>
        <td>${pill(c.status)}${c.status === 'Pending' ? `<div class="lv-next">${chainDots(c)}<span class="faint">${esc(nextText(c))}</span></div>` : c.status === 'Paid' && c.paidIn ? `<div class="person-sub">${c.paidIn === 'now' ? 'Paid directly' : 'With ' + U.fmtMonth(c.paidIn, { month: 'short', year: 'numeric' }) + ' salary'}</div>` : c.status === 'Approved' ? '<div class="person-sub">With the next salary</div>' : ''}</td>
        <td><div class="row-actions">${mine && c.status === 'Pending' ? `<button class="btn btn-sm btn-ghost" data-act="cl-cancel" data-id="${c.id}">Cancel</button>` : !mine && c.status === 'Approved' && ctx.role() === 'admin' ? `<button class="btn btn-sm" data-act="cl-paynow" data-id="${c.id}">Pay now</button>` : `<button class="btn btn-sm ${canActOn(c) ? 'btn-primary' : 'btn-ghost'}" data-act="cl-review" data-id="${c.id}">${canActOn(c) ? 'Review' : 'View'}</button>`}</div></td></tr>`; }).join('');
    }
    const head = (showEmp = true) => `<thead><tr>${showEmp ? '<th>Employee</th>' : ''}<th>Claim</th><th class="hide-sm">Date</th><th class="r">Claimed</th><th class="r">Approved</th><th>Status</th><th></th></tr></thead>`;
    function limitsCard(e) {
      const rem = R.remaining({ empId: e.id, cats: cats(), claims: list(), date: T() }).filter((x) => x.perMonth || x.perYear);
      const meds = medTypes().filter((t) => t.on && t.annual).map((t) => ({ t, u: R.usage(list(), e.id, { cat: 'medical', sub: t.id, year: year() }) }));
      return `<div class="card"><div class="card-head"><h3>What you can claim</h3><span class="hint">${U.fmtMonth(U.monthKey(T()), { month: 'long' })}</span></div>
        <div class="cl-limits">${rem.map((x) => `<div><div class="cl-lim-name">${esc(x.name)}</div><div class="num"><strong>${m2(x.monthLeft ?? x.yearLeft)}</strong> <span class="faint">left this ${x.monthLeft != null ? 'month' : 'year'}</span></div>
          <div class="progress"><i style="width:${Math.min(100, ((x.monthLeft != null ? x.monthUsed : x.yearUsed) / (x.monthLeft != null ? x.perMonth : x.perYear)) * 100)}%"></i></div>${x.pending ? `<div class="faint">${m2(x.pending)} waiting</div>` : ''}</div>`).join('')}</div>
        ${meds.length ? `<details class="cl-med"><summary>Medical balances this year</summary><div class="cl-limits">${meds.map(({ t, u }) => `<div><div class="cl-lim-name">${esc(t.name)}</div><div class="num"><strong>${m2(Math.max(0, t.annual - u.used))}</strong> <span class="faint">of ${m2(t.annual)}</span></div></div>`).join('')}</div></details>` : ''}</div>`;
    }

    // ---------- Employee: Claims ----------
    VIEWS['my-claims'] = () => {
      const e = ctx.me(), p = pol();
      const mine = list().filter((c) => c.empId === e.id).sort((a, b) => b.date.localeCompare(a.date));
      const paidYtd = r2(mine.filter((c) => c.status === 'Paid' && c.date.startsWith(year())).reduce((s, c) => s + (c.approved || 0), 0));
      const coming = r2(mine.filter((c) => c.status === 'Approved').reduce((s, c) => s + (c.approved || 0), 0));
      return `
        <div class="page-head"><div><div class="eyebrow">Finance</div><h1>Claims</h1>
          <p class="sub">Claim work costs and medical bills with your receipts. Your manager and HR approve them, and approved claims are paid with your next salary.</p></div>
          <div class="actions">${eligible(e) ? `<button class="btn" data-act="cl-new" data-v="mileage">${icon('pin')}Mileage</button><button class="btn btn-primary" data-act="cl-new">${icon('plus')}New claim</button>` : ''}</div></div>
        ${eligible(e) ? '' : `<div class="lock-banner info">${icon('clock')}<span>Claims start after ${p.probationMonths} months of service, from ${U.fmtMonth(U.addMonths(U.monthKey(e.start), p.probationMonths))}.</span></div>`}
        ${coming ? `<div class="lock-banner info">${icon('wallet')}<span>${m2(coming)} approved and coming with your next salary.</span></div>` : ''}
        <div class="grid g-main"><div class="card card-flush"><div class="card-head" style="padding-bottom:14px"><h3>My claims</h3><span class="hint">${m2(paidYtd)} paid to you this year</span></div>
          <div class="table-wrap"><table class="lv-req">${head(false)}<tbody>${rows(mine, { showEmp: false, mine: true })}</tbody></table>
          ${mine.length ? '' : '<div class="empty"><strong>No claims yet</strong>Keep your receipts and claim them here.</div>'}</div></div>
          <div>${limitsCard(e)}</div></div>
        <p class="disclaimer">${icon('pin')}<span>Don’t also claim a reimbursed amount as a personal tax relief. Business expenses paid back by your employer are generally not your income; categories your company marks as taxable are added to your pay and taxed.</span></p>`;
    };

    // ---------- New claim (several items, each with a receipt) ----------
    function newClaim(startCat) {
      const e = ctx.me(), on = cats().filter((c) => c.on !== false);
      if (!on.length) { toast('Your company has no claim categories switched on', 'error'); return; }
      const rates = pol().mileage || R.defaultMileage();
      const blank = (cat) => ({ id: U.uid('ln'), cat, sub: cat === 'medical' ? (medTypes().find((t) => t.on)?.id || '') : '', date: T(), merchant: cat === 'mileage' ? 'Own vehicle' : '', receiptNo: '', amount: '', img: null, notes: '', fields: cat === 'mileage' ? { vehicle: 'car' } : cat === 'medical' ? { patient: 'Self' } : {} });
      const lines = [blank(startCat && catOf(startCat).on !== false ? startCat : on[0].id)];
      const draft = () => ({ id: 'draft', empId: e.id, lines: lines.map((l) => ({ ...l, amount: Number(l.amount) || 0 })) });
      const fieldInput = (l, k) => {
        const v = l.fields[k] ?? '', id = `f-${l.id}-${k}`, lab = R.FIELDS[k];
        if (k === 'vehicle') return `<div class="field"><label for="${id}">${lab}</label><select class="select" id="${id}" data-ff="vehicle">${Object.entries(R.VEHICLES).map(([vk, vl]) => `<option value="${vk}" ${v === vk ? 'selected' : ''}>${vl} (${m2(rates[vk] || 0)}/km)</option>`).join('')}</select></div>`;
        if (k === 'patient') return `<div class="field"><label for="${id}">${lab}</label><select class="select" id="${id}" data-ff="patient">${['Self', 'Spouse', 'Child'].map((o) => `<option ${v === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
        return `<div class="field ${k === 'purpose' || k === 'attendees' ? 'full' : ''}"><label for="${id}">${lab}</label><input class="input ${k === 'km' || k === 'nights' ? 'num' : ''}" id="${id}" data-ff="${k}" ${k === 'km' || k === 'nights' ? 'type="number" min="0" step="0.1" inputmode="decimal"' : ''} value="${esc(v)}"></div>`;
      };
      const lineHtml = (l, i) => {
        const c = catOf(l.cat), id = l.id;
        return `<fieldset class="cl-line" data-line="${id}"><legend>Item ${i + 1}</legend>
          ${lines.length > 1 ? `<button type="button" class="btn btn-sm btn-icon btn-ghost cl-line-del" data-del="${id}" aria-label="Remove item ${i + 1}">${icon('trash')}</button>` : ''}
          <div class="form-grid">
            <div class="field"><label for="c-${id}">Category</label><select class="select" id="c-${id}" data-f="cat">${on.map((x) => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
            ${c.medical ? `<div class="field"><label for="s-${id}">Medical type</label><select class="select" id="s-${id}" data-f="sub">${medTypes().filter((t) => t.on).map((t) => `<option value="${t.id}" ${t.id === l.sub ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>` : ''}
            <div class="field"><label for="d-${id}">Date</label><input class="input" type="date" id="d-${id}" data-f="date" value="${l.date}" max="${T()}"></div>
            ${c.mileage ? '' : `<div class="field full receipt-pick"><span class="label-like">Receipt${c.receipt ? '' : ' (optional)'}</span>
              <div class="rp-row"><img class="cl-thumb" alt="" ${l.img ? `src="${l.img}"` : 'hidden'}><div class="rp-actions"><label class="btn btn-sm" for="file-${id}">${icon('camera')}${l.img ? 'Retake' : 'Snap or upload'}</label><span class="field-hint" data-read>${l.img ? 'Receipt added.' : 'We’ll read the shop, date and amount for you.'}</span></div></div>
              <input type="file" id="file-${id}" data-file accept="image/*" capture="environment" hidden></div>
              <div class="field"><label for="m-${id}">${c.medical ? 'Clinic or provider' : 'Merchant'}</label><input class="input" id="m-${id}" data-f="merchant" value="${esc(l.merchant)}"></div>
              <div class="field"><label for="r-${id}">Receipt number</label><input class="input" id="r-${id}" data-f="receiptNo" value="${esc(l.receiptNo)}"></div>`}
            ${(c.fields || []).filter((k) => k !== 'patient' || c.medical).map((k) => fieldInput(l, k)).join('')}
            <div class="field"><label for="a-${id}">Amount (RM)</label><input class="input num" id="a-${id}" data-f="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${l.amount}" ${c.mileage ? 'readonly aria-describedby="h-' + id + '"' : ''}></div>
            <p class="field full field-hint cl-hint" id="h-${id}" data-hint></p>
          </div></fieldset>`;
      };
      openModal({
        title: 'New claim', size: 'lg', submit: 'Submit claim',
        body: `<div class="form-grid"><div class="field full"><label for="cl-title">What is this claim for?</label><input class="input" id="cl-title" name="title" required placeholder="Client visit to Kuala Terengganu"></div></div>
          <div id="cl-lines" class="cl-lines"></div>
          <div class="cl-foot"><button type="button" class="btn" id="cl-add">${icon('plus')}Add another item</button><div class="cl-total" id="cl-total" role="status"></div></div>
          <p class="field-hint">Goes to ${esc(chainFor(e).filter((s) => s.status === 'pending').map((s) => firstOf(s.approver)).join(', then ') || 'HR')}.</p>`,
        onSubmit(d) {
          const c = { id: U.uid('cl'), empId: e.id, title: d.title.trim(), lines: lines.map((l) => ({ ...l, amount: r2(Number(l.amount) || 0), approved: null, merchant: l.merchant.trim(), receiptNo: l.receiptNo.trim() })), status: 'Pending', submitted: T(), edits: [] };
          c.date = c.lines.map((l) => l.date).sort()[0];
          const errs = R.validate(c, cats());
          const fam = c.lines.find((l) => l.cat === 'medical' && l.fields.patient !== 'Self' && !medOf(l.sub)?.family);
          if (fam) errs.push(`${medOf(fam.sub)?.name || 'This medical type'} covers only yourself under your company’s policy.`);
          if (errs.length) { toast(errs[0], 'error'); return false; }
          c.chain = chainFor(e);
          list().push(c);
          const nx = LR.nextStep(c.chain);
          ctx.notify?.request('claim', c, 'submitted', { summary: `${c.title}, ${m2(R.claimTotal(c))}` });
          commit(`Claim sent to ${nx ? firstOf(nx.approver) : 'HR'}`, `${ctx.fullName(e)} claimed ${m2(R.claimTotal(c))} for ${c.title}`);
        },
      });
      const form = ctx.$('#overlay-root form'), box = form.querySelector('#cl-lines');
      const lineOf = (el) => lines.find((l) => l.id === el.closest('[data-line]')?.dataset.line);
      const update = () => {
        const lim = R.limitsFor(draft(), { cats: cats(), claims: list(), medicalTypes: medTypes() });
        lines.forEach((l, i) => {
          const h = box.querySelector(`[data-line="${l.id}"] [data-hint]`), c = catOf(l.cat), x = lim.lines[i], amt = Number(l.amount) || 0;
          const caps = [c.perClaim ? `${m2(c.perClaim)} per claim` : '', c.perMonth ? `${m2(c.perMonth)} a month` : '', c.perYear ? `${m2(c.perYear)} a year` : '', c.medical && medOf(l.sub)?.perClaim ? `${m2(medOf(l.sub).perClaim)} per claim` : '', c.medical && medOf(l.sub)?.annual ? `${m2(medOf(l.sub).annual)} a year` : ''].filter(Boolean).join(', ');
          if (h) { h.textContent = `${c.mileage ? `${l.fields.km || 0} km × ${m2(rates[l.fields.vehicle] || 0)}. ` : ''}${caps ? `Limit ${caps}. ` : ''}${amt && x.max < amt ? `Up to ${m2(x.max)} can be approved (${x.capped.join(', ')}).` : ''}${c.taxable ? ' Taxable: added to your pay.' : ''}`; h.classList.toggle('warn', !!(amt && x.max < amt)); }
        });
        const total = r2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
        form.querySelector('#cl-total').innerHTML = `Total <strong class="num">${m2(total)}</strong>${lim.max < total ? ` <span class="faint">· up to ${m2(lim.max)} under your limits</span>` : ''}`;
      };
      const draw = (focusId) => { box.innerHTML = lines.map(lineHtml).join(''); update(); if (focusId) box.querySelector(`#c-${focusId}`)?.focus(); };
      const mileage = (l) => { if (catOf(l.cat).mileage) { l.amount = R.mileageAmount(l.fields.km, l.fields.vehicle, rates) || ''; const a = box.querySelector(`#a-${l.id}`); if (a) a.value = l.amount; } };
      box.addEventListener('input', (ev) => {
        const el = ev.target, l = lineOf(el); if (!l) return;
        if (el.dataset.f && el.dataset.f !== 'cat' && el.dataset.f !== 'sub') l[el.dataset.f] = el.value;
        if (el.dataset.ff) { l.fields[el.dataset.ff] = el.value; mileage(l); }
        update();
      });
      box.addEventListener('change', (ev) => {
        const el = ev.target, l = lineOf(el); if (!l) return;
        if (el.dataset.f === 'cat') { const keep = { id: l.id, date: l.date, img: l.img, merchant: l.merchant, receiptNo: l.receiptNo, amount: l.amount }; Object.assign(l, blank(el.value), keep, catOf(el.value).mileage ? { amount: '', img: null, merchant: 'Own vehicle' } : {}); draw(l.id); return; }
        if (el.dataset.f === 'sub') { l.sub = el.value; update(); return; }
        if (el.dataset.ff === 'vehicle') { l.fields.vehicle = el.value; mileage(l); update(); }
        if (el.dataset.file !== undefined) scan(el.files?.[0], l, el.closest('[data-line]'), update);
      });
      box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-del]'); if (!b) return; ev.preventDefault(); const i = lines.findIndex((l) => l.id === b.dataset.del); lines.splice(i, 1); draw(lines[Math.max(0, i - 1)]?.id); });
      form.querySelector('#cl-add').addEventListener('click', () => { const last = lines[lines.length - 1]; const l = blank(last.cat === 'mileage' ? on.find((x) => !x.mileage)?.id || last.cat : last.cat); l.date = last.date; lines.push(l); draw(l.id); });
      draw();
    }
    // Reads a receipt photo with the scanner and fills the merchant, date and amount of one line.
    function scan(file, l, el, done) {
      if (!file) return;
      const im = new Image();
      im.onload = async () => {
        const c = document.createElement('canvas'), k = Math.min(1, 900 / im.naturalWidth);
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        l.img = c.toDataURL('image/jpeg', 0.6);
        const pv = el.querySelector('.cl-thumb'); pv.src = l.img; pv.hidden = false;
        const note = el.querySelector('[data-read]'); note.textContent = 'Reading the receipt…';
        try {
          const p = AllurusReceipt.parse(await AllurusReceipt.read(im));
          const set = (f, v) => { const inp = el.querySelector(`[data-f="${f}"]`); if (v && !l[f]) { l[f] = v; if (inp) inp.value = v; } };
          set('merchant', p.merchant); set('amount', p.total ? p.total.toFixed(2) : '');
          if (p.date && p.date <= T()) { l.date = p.date; el.querySelector('[data-f="date"]').value = p.date; }
          note.textContent = p.total ? `Read ${p.merchant || 'the receipt'}, total ${m2(p.total)}. Check the details.` : 'Couldn’t find the total. Enter it below.';
        } catch (err) { note.textContent = 'Couldn’t read the receipt here. Enter the details below.'; }
        URL.revokeObjectURL(im.src);
        done();
      };
      im.src = URL.createObjectURL(file);
    }

    // ---------- Review (approvers and HR) ----------
    const FIELD_LABEL = R.EDITABLE;
    function review(id) {
      const c = find(id); if (!c) return;
      const e = ctx.emp(c.empId), as = canActOn(c), admin = ctx.role() === 'admin', next = LR.nextStep(c.chain);
      const lim = limitsOf(c), rem = R.remaining({ empId: c.empId, cats: cats(), claims: list(), date: c.date, exceptId: c.id }).filter((x) => c.lines.some((l) => l.cat === x.cat) && (x.perMonth || x.perYear));
      const fieldText = (l) => Object.entries(l.fields || {}).filter(([k, v]) => v && k !== 'vehicle').map(([k, v]) => `${R.FIELDS[k] || k}: ${k === 'km' ? `${v} km${l.fields.vehicle ? ` by ${R.VEHICLES[l.fields.vehicle]?.toLowerCase()}` : ''}` : v}`).join(' · ');
      const stepRow = (s) => {
        const who = s.by && s.by !== s.approver ? `${esc(nameOf(s.by))} for ${esc(nameOf(s.approver))}` : esc(nameOf(s.by || s.approver));
        const ic = { approved: 'check', rejected: 'x', skipped: 'minus', cancelled: 'minus', pending: s === next ? 'clock' : 'minus' }[s.status];
        return `<li class="ch-${s === next ? 'next' : s.status}"><span class="ch-ic">${icon(ic)}</span><div><strong>${s.level === 'Final' ? 'HR (final)' : s.level}</strong> · ${who}<div class="faint">${s.status === 'pending' ? (s === next ? 'Next to decide' : 'Waiting') : s.status === 'skipped' ? esc(s.note) : `${s.status === 'approved' ? 'Approved' : s.status === 'rejected' ? 'Declined' : 'Not needed'}${s.at ? ' ' + U.fmtDate(s.at, { day: 'numeric', month: 'short' }) : ''}${s.actedAs === 'backup' ? ' as backup' : s.actedAs === 'override' ? ' by HR admin' : ''}${s.note && s.status !== 'pending' ? ` · “${esc(s.note)}”` : ''}`}</div></div></li>`;
      };
      const imgs = c.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.img);
      openModal({
        title: `${ctx.fullName(e)} · ${c.title}`, size: 'lg', submit: null,
        body: `<div class="cr-review">
          <div class="cr-receipts" aria-label="Receipts">${imgs.length ? imgs.map(({ l, i }) => `<figure><button type="button" class="cr-zoom" data-act="cl-receipt" data-id="${c.id}" data-v="${l.id}" aria-label="Open receipt for item ${i + 1}"><img src="${l.img}" alt="Receipt for item ${i + 1}, ${esc(l.merchant)}"></button><figcaption>Item ${i + 1} · ${esc(catOf(l.cat).name)} · ${m2(l.amount)}</figcaption></figure>`).join('') : '<p class="faint">No receipts on this claim.</p>'}</div>
          <div class="rc-main">
            <dl class="kv"><dt>Status</dt><dd>${pill(c.status)}</dd><dt>Submitted</dt><dd>${U.fmtDate(c.submitted)}</dd><dt>Department</dt><dd>${esc(ctx.dept(e.dept)?.name || '—')}</dd>${c.reason ? `<dt>Reason</dt><dd>${esc(c.reason)}</dd>` : ''}</dl>
            <div class="table-wrap"><table class="cr-lines"><thead><tr><th>Item</th><th class="r">Claimed</th><th class="r">Allowed</th><th class="r">${as ? 'Approve' : 'Approved'}</th></tr></thead><tbody>
            ${c.lines.map((l, i) => { const x = lim.lines[i], cat = catOf(l.cat); return `<tr><td><strong>${i + 1}. ${esc(cat.medical && medOf(l.sub) ? medOf(l.sub).name : cat.name)}</strong>${cat.taxable ? ' <span class="tag warn">Taxable</span>' : ''}<div class="person-sub" style="white-space:normal">${U.fmtDate(l.date, { day: 'numeric', month: 'short' })} · ${esc(l.merchant || '—')}${l.receiptNo ? ` · #${esc(l.receiptNo)}` : ''}${fieldText(l) ? `<br>${esc(fieldText(l))}` : ''}${!l.img && cat.receipt ? '<br><span style="color:var(--bad)">Receipt missing</span>' : ''}</div>${admin && c.status !== 'Paid' ? `<button type="button" class="link-btn cr-fix" data-act="cl-edit" data-id="${c.id}" data-v="${l.id}">${icon('edit')}Correct item ${i + 1}</button>` : ''}</td>
              <td class="r num">${m2(l.amount)}</td><td class="r num ${x.max < l.amount ? 'cl-capped' : ''}" title="${esc(x.capped.join(', '))}">${m2(x.max)}</td>
              <td class="r">${as ? `<input class="input num" style="width:96px" type="number" min="0" step="0.01" max="${x.max}" data-approve="${l.id}" value="${(l.approved ?? x.max).toFixed(2)}" aria-label="Approve for item ${i + 1}">` : `<span class="num">${l.approved != null ? m2(l.approved) : '—'}</span>`}</td>
              </tr>`; }).join('')}
            </tbody><tfoot><tr><td><strong>Total</strong></td><td class="r num"><strong>${m2(R.claimTotal(c))}</strong></td><td class="r num"><strong>${m2(lim.max)}</strong></td><td class="r num">${c.approved != null ? `<strong>${m2(c.approved)}</strong>` : ''}</td></tr></tfoot></table></div>
            ${rem.length ? `<div class="cr-left"><div class="kpi-label">Left before this claim</div>${rem.map((x) => `<span><strong>${esc(x.name)}</strong> ${x.monthLeft != null ? `${m2(x.monthLeft)} this month` : ''}${x.monthLeft != null && x.yearLeft != null ? ' · ' : ''}${x.yearLeft != null ? `${m2(x.yearLeft)} this year` : ''}</span>`).join('')}</div>` : ''}
            ${(c.edits || []).length ? `<h4 class="lv-h">Corrections by HR</h4><ol class="audit-list">${c.edits.map((x) => { const li = c.lines.findIndex((l) => l.id === x.lineId); return `<li><div><strong>${esc(x.byName || nameOf(x.by))}</strong> <span class="faint">· ${new Date(x.at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div><div>Item ${li + 1}: ${FIELD_LABEL[x.field]} ${esc(['amount', 'approved'].includes(x.field) ? m2(Number(x.from) || 0) : x.from || '—')} → ${esc(['amount', 'approved'].includes(x.field) ? m2(x.to) : x.to)}</div><div class="faint">“${esc(x.reason)}”</div></li>`; }).join('')}</ol>` : ''}
            ${(c.chain || []).length ? `<h4 class="lv-h">Approval</h4><ol class="chain">${c.chain.map(stepRow).join('')}</ol>` : ''}
            ${as ? `<div class="review-box"><div class="field"><label for="cl-note">Note to ${esc(e.first)} (required to decline)</label><input class="input" id="cl-note" placeholder="Optional when approving"></div>
              <div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-danger" data-act="cl-reject" data-id="${c.id}">Decline</button><button class="btn btn-primary" data-act="cl-approve" data-id="${c.id}">${icon('check')}${as === 'override' && next ? `Approve for ${esc(firstOf(next.approver))}` : as === 'backup' ? 'Approve as backup' : 'Approve'}</button></div></div>` : ''}
            ${admin && c.status === 'Approved' ? `<div class="actions"><button class="btn btn-primary" data-act="cl-paynow" data-id="${c.id}">${icon('wallet')}Pay now instead of with payroll</button></div>` : ''}
          </div></div>`,
      });
    }
    function decide(id, approve) {
      const c = find(id); if (!c) return;
      const as = canActOn(c);
      if (!as) { toast(c.empId === actor() ? 'You can’t decide your own claim. It goes to your approver.' : 'This claim is waiting for someone else.', 'error'); return; }
      const note = ctx.$('#cl-note')?.value.trim() || '';
      if (!approve && !note) { toast('Give a reason, so they know what to fix', 'error'); ctx.$('#cl-note')?.focus(); return; }
      if (approve) {
        const lim = limitsOf(c);
        for (const [i, l] of c.lines.entries()) {
          const inp = ctx.$(`[data-approve="${l.id}"]`), v = r2(Number(inp?.value ?? lim.lines[i].max));
          if (!(v >= 0)) { toast('Enter an amount for every item', 'error'); inp?.focus(); return; }
          if (v > lim.lines[i].max + 0.001) { toast(`Item ${i + 1}: up to ${m2(lim.lines[i].max)} under the limits`, 'error'); inp?.focus(); return; }
        }
        c.lines.forEach((l, i) => { const inp = ctx.$(`[data-approve="${l.id}"]`); l.approved = r2(Number(inp?.value ?? lim.lines[i].max)); });
        if (!(R.approvedTotal(c) > 0)) { toast('Approve an amount above zero, or decline the claim', 'error'); return; }
      }
      const chain = c.chain?.length ? c.chain : [{ level: 'Final', label: 'HR', approver: actor(), backup: '', status: 'pending' }];
      const r = LR.decide(chain, { by: actor(), approve, note, at: T(), actedAs: as });
      c.chain = r.chain; c.status = r.status;
      if (r.status === 'Approved') Object.assign(c, { approved: R.approvedTotal(c), decidedOn: T(), decidedBy: ctx.account()?.name || nameOf(actor()) });
      if (r.status === 'Rejected') { c.lines.forEach((l) => { l.approved = null; }); Object.assign(c, { approved: null, reason: note, decidedOn: T(), decidedBy: ctx.account()?.name || nameOf(actor()) }); }
      closeOverlay();
      const n = ctx.fullName(ctx.emp(c.empId)), nx = LR.nextStep(c.chain);
      ctx.notify?.request('claim', c, !approve ? 'rejected' : r.status === 'Approved' ? 'approved' : 'step', { summary: `${c.title}, ${m2(r.status === 'Approved' ? c.approved : R.claimTotal(c))}`, note });
      commit(!approve ? `Declined for ${ctx.emp(c.empId).first}` : r.status === 'Approved' ? `Approved ${m2(c.approved)} for ${ctx.emp(c.empId).first}` : `Approved. Now with ${nameOf(nx.approver)}`,
        `${n}'s claim “${c.title}” was ${!approve ? 'declined' : r.status === 'Approved' ? `approved (${m2(c.approved)})` : 'approved at one step'}`);
    }
    function editLine(id, lineId) {
      const c = find(id), l = c?.lines.find((x) => x.id === lineId); if (!l) return;
      const i = c.lines.indexOf(l);
      openModal({
        title: `Correct item ${i + 1}`, size: 'sm', submit: 'Save correction',
        body: `<div class="form-grid"><div class="field full"><label for="ce-field">What to correct</label><select class="select" id="ce-field" name="field">${Object.entries(FIELD_LABEL).filter(([k]) => k !== 'approved' || c.status === 'Approved').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div class="field full"><label for="ce-value">New value</label><input class="input" id="ce-value" name="value" required value="${esc(l.amount)}"></div>
          <div class="field full"><label for="ce-reason">Reason</label><input class="input" id="ce-reason" name="reason" required placeholder="For example: service charge not claimable"></div>
          <p class="field-hint full">Corrections are kept on the claim with your name and the time.</p></div>`,
        onSubmit(d) {
          try {
            const r = R.applyEdit(c, { lineId, field: d.field, value: d.value, reason: d.reason, by: actor(), byName: ctx.account()?.name || nameOf(actor()), at: new Date().toISOString() });
            if (!r.changed) { toast('Nothing changed', 'info'); return false; }
            if (d.field === 'approved') { const lim = limitsOf(r.claim).lines[i]; if (r.claim.lines[i].approved > lim.max + 0.001) { toast(`Up to ${m2(lim.max)} under the limits`, 'error'); return false; } }
            Object.assign(c, r.claim);
            if (c.status === 'Approved') c.approved = R.approvedTotal(c);
            commit(`Item ${i + 1} corrected`, `${FIELD_LABEL[d.field]} on ${nameOf(c.empId)}'s claim “${c.title}” corrected: ${d.reason.trim()}`);
            setTimeout(() => review(id), 50);
          } catch (err) { toast(err.message, 'error'); return false; }
        },
      });
      const f = ctx.$('#ce-field'), v = ctx.$('#ce-value');
      f.addEventListener('change', () => { v.value = l[f.value] ?? ''; v.type = ['amount', 'approved'].includes(f.value) ? 'number' : 'text'; });
      v.type = 'number'; v.step = '0.01';
    }
    // Pay an approved claim now (outside payroll) and post it to the books under each GL category.
    function payNow(c) {
      Object.assign(c, { status: 'Paid', paidIn: 'now', paidOn: T() });
      const fin = st().finance;
      if (fin) R.glRows(c, cats()).forEach((g, i) => fin.txns.push({ id: U.uid('x'), date: T(), desc: `Claim: ${nameOf(c.empId)}, ${c.title}`, type: 'out', category: g.gl, amount: g.amount, tax: 0, ref: `${c.id.toUpperCase()}${i ? '-' + (i + 1) : ''}`, source: 'claim', reconciled: false }));
    }

    // ---------- Admin: Claims ----------
    VIEWS.claims = () => {
      const all = list();
      const sum = (xs, f) => r2(xs.reduce((s, c) => s + f(c), 0));
      const pending = all.filter((c) => c.status === 'Pending'), toPay = all.filter((c) => c.status === 'Approved');
      const paidYtd = all.filter((c) => c.status === 'Paid' && c.date.startsWith(year()));
      const top = R.report(all, { by: 'category', year: year(), statuses: ['Paid'], cats: cats() }).rows[0];
      const counts = { Pending: pending.length, Approved: toPay.length, Paid: all.filter((c) => c.status === 'Paid').length, Rejected: all.filter((c) => c.status === 'Rejected').length };
      const shown = all.filter((c) => cui.filter === 'All' || c.status === cui.filter).sort((a, b) => b.date.localeCompare(a.date));
      return `
        <div class="page-head"><div><div class="eyebrow">Finance</div><h1>Claims</h1>
          <p class="sub">${pol().enabled !== false ? 'Business expenses and medical claims. Approved claims go out with the next payroll or are paid now, and post to the books by category.' : 'Claims are switched off. Turn them on in Settings.'}</p></div>
          <div class="actions"><button class="btn" data-act="cl-goto" data-v="claim-categories">${icon('sliders')}Categories and limits</button></div></div>
        <div class="seg" role="tablist" aria-label="Claims">${[['review', 'Claims'], ['reports', 'Reports']].map(([k, l]) => `<button role="tab" data-act="cl-tab" data-v="${k}" class="${cui.tab === k ? 'on' : ''}" aria-selected="${cui.tab === k}">${l}</button>`).join('')}</div>
        ${cui.tab === 'reports' ? reportsView() : `
        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--warn)"></span>Waiting for approval</div><div class="kpi-value">${pending.length}</div><div class="kpi-foot">${m2(sum(pending, (c) => R.claimTotal(c)))} claimed</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Approved, to pay</div><div class="kpi-value">${compactMoney(sum(toPay, (c) => c.approved || 0))}</div><div class="kpi-foot">${toPay.length} claims, with the next payroll</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Paid this year</div><div class="kpi-value">${compactMoney(sum(paidYtd, (c) => c.approved || 0))}</div><div class="kpi-foot">${paidYtd.length} claims</div></div>
          <div class="card kpi"><div class="kpi-label">Biggest cost this year</div><div class="kpi-value" style="font-size:20px">${top ? esc(top.label) : '—'}</div><div class="kpi-foot">${top ? m2(top.approved) : 'No claims paid yet'}</div></div>
        </div>
        <div class="card card-flush">
          <div class="toolbar"><div class="seg">${['Pending', 'Approved', 'Paid', 'Rejected', 'All'].map((s) => `<button data-act="cl-filter" data-v="${s}" class="${cui.filter === s ? 'on' : ''}">${s === 'Approved' ? 'To pay' : s}${s !== 'All' ? ` <span class="faint">${counts[s]}</span>` : ''}</button>`).join('')}</div></div>
          <div class="table-wrap"><table class="lv-req">${head()}<tbody>${rows(shown)}</tbody></table>
          ${shown.length ? '' : `<div class="empty"><strong>No ${cui.filter === 'All' ? '' : cui.filter.toLowerCase() + ' '}claims</strong></div>`}</div></div>`}`;
    };
    function reportOpts() {
      const statuses = cui.statuses === 'approved' ? ['Approved', 'Paid'] : ['Pending', 'Approved', 'Paid'];
      return { by: cui.by, year: cui.year, statuses, employees: st().employees, departments: st().departments, cats: cats() };
    }
    function reportsView() {
      const rep = R.report(list(), reportOpts()), max = Math.max(1, ...rep.rows.map((r) => r.claimed));
      const years = [...new Set([+year(), ...list().map((c) => +c.date.slice(0, 4))])].sort((a, b) => b - a);
      return `<div class="card card-flush"><div class="toolbar cl-rep-bar">
          <div class="seg" role="group" aria-label="Group by">${Object.entries(R.GROUPS).map(([k, l]) => `<button data-act="cl-by" data-v="${k}" class="${cui.by === k ? 'on' : ''}" aria-pressed="${cui.by === k}">${l}</button>`).join('')}</div>
          <label class="sr-only" for="cl-year">Year</label><select class="select" id="cl-year" style="width:100px">${years.map((y) => `<option ${y === cui.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <label class="sr-only" for="cl-stat">Which claims</label><select class="select" id="cl-stat" style="width:auto"><option value="approved" ${cui.statuses === 'approved' ? 'selected' : ''}>Approved and paid</option><option value="all" ${cui.statuses === 'all' ? 'selected' : ''}>Everything submitted</option></select>
          <button class="btn" data-act="cl-report-csv">${icon('download')}Export CSV</button></div>
        <div class="table-wrap"><table><thead><tr><th>${R.GROUPS[cui.by]}</th><th class="r">Claims</th><th class="r hide-sm">Items</th><th class="r">Claimed</th><th class="r">Approved</th><th class="hide-sm" style="width:30%"></th></tr></thead>
          <tbody>${rep.rows.map((r) => `<tr><td>${esc(cui.by === 'month' ? U.fmtMonth(r.key) : r.label)}</td><td class="r num">${r.claims}</td><td class="r num hide-sm">${r.lines}</td><td class="r num">${m2(r.claimed)}</td><td class="r num">${m2(r.approved)}</td><td class="hide-sm"><div class="hbar-track"><i style="width:${(r.claimed / max) * 100}%;background:var(--brand)"></i></div></td></tr>`).join('')}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td class="r num"><strong>${rep.totals.claims}</strong></td><td class="r num hide-sm"><strong>${rep.totals.lines}</strong></td><td class="r num"><strong>${m2(rep.totals.claimed)}</strong></td><td class="r num"><strong>${m2(rep.totals.approved)}</strong></td><td class="hide-sm"></td></tr></tfoot></table>
          ${rep.rows.length ? '' : '<div class="empty"><strong>No claims for this year</strong></div>'}</div></div>`;
    }
    AFTER.claims = () => {
      ctx.$('#cl-year')?.addEventListener('change', (ev) => { cui.year = +ev.target.value; ctx.render(); });
      ctx.$('#cl-stat')?.addEventListener('change', (ev) => { cui.statuses = ev.target.value; ctx.render(); });
    };

    // ---------- Approvers: claims from their team ----------
    function approvalsCard(empId) {
      const mine = forMe(empId);
      if (!mine.length && !ctx.leave?.isApprover(empId)) return '';
      return `<div class="card card-flush" id="claim-approvals"><div class="card-head" style="padding-bottom:12px"><h3>Claims</h3><span class="hint">${mine.length}</span></div>
        <div class="table-wrap"><table class="lv-req">${head()}<tbody>${rows(mine)}</tbody></table>
        ${mine.length ? '' : '<div class="empty"><strong>All caught up</strong>Claims from your team show here.</div>'}</div></div>`;
    }

    // ---------- Settings ----------
    const onoff = (act, id, on) => `<div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button type="button" data-act="${act}" data-id="${id}" data-v="${v}" class="${(on ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    function settingsCards() {
      const p = pol(), gls = AllurusFinance.EXPENSE_CATS.filter((g) => g !== 'Payroll'), rates = p.mileage || R.defaultMileage();
      const num = (c, f, step = 10) => `<input class="input num" data-cc="${c.id}" data-f="${f}" type="number" min="0" step="${step}" value="${c[f] || 0}" style="width:84px" aria-label="${esc(c.name)} ${f === 'perClaim' ? 'per claim' : f === 'perMonth' ? 'per month' : 'per year'} limit"${c.medical ? ' disabled title="Medical limits are set per medical type below"' : ''}>`;
      return `<div class="card card-flush" id="claim-categories"><div class="card-head" style="padding-bottom:6px"><h3>Claim categories</h3>${onoff('cl-enable', 'all', p.enabled !== false)}</div>
        <p class="muted" style="padding:0 22px 12px">Limits are in RM; 0 means no limit. Taxable categories are added to gross pay (PCB and EA); the rest are paid back on top of net pay. The GL category is where the cost lands in the books.</p>
        <div class="table-wrap"><table class="policy cc-table"><thead><tr><th>Category</th><th>On</th><th class="r">Per claim</th><th class="r">Per month</th><th class="r">Per year</th><th>Receipt</th><th>Taxable</th><th>GL category</th><th>Extra fields</th><th></th></tr></thead>
          <tbody>${p.categories.map((c) => `<tr class="${c.on !== false ? '' : 'off'}">
            <td><input class="input" data-cc="${c.id}" data-f="name" value="${esc(c.name)}" aria-label="Category name" style="min-width:130px"><div class="person-sub" style="white-space:normal">${esc(c.note || '')}</div></td>
            <td><input type="checkbox" data-cc="${c.id}" data-f="on" ${c.on !== false ? 'checked' : ''} aria-label="Offer ${esc(c.name)}"></td>
            <td class="r">${num(c, 'perClaim')}</td><td class="r">${num(c, 'perMonth')}</td><td class="r">${num(c, 'perYear', 50)}</td>
            <td><input type="checkbox" data-cc="${c.id}" data-f="receipt" ${c.receipt ? 'checked' : ''} aria-label="${esc(c.name)} needs a receipt" ${c.mileage ? 'disabled' : ''}></td>
            <td><input type="checkbox" data-cc="${c.id}" data-f="taxable" ${c.taxable ? 'checked' : ''} aria-label="${esc(c.name)} is taxable"></td>
            <td><select class="select" data-cc="${c.id}" data-f="gl" aria-label="${esc(c.name)} GL category">${gls.map((g) => `<option ${c.gl === g ? 'selected' : ''}>${g}</option>`).join('')}</select></td>
            <td><div class="cc-fields">${Object.entries(R.FIELDS).filter(([k]) => !['km', 'vehicle', 'patient'].includes(k)).map(([k, l]) => `<label class="check lt-small"><input type="checkbox" data-cc="${c.id}" data-f="field" data-k="${k}" ${c.fields?.includes(k) ? 'checked' : ''} ${c.mileage && ['from', 'to'].includes(k) ? 'disabled' : ''}><span>${l}</span></label>`).join('')}</div></td>
            <td>${c.builtin ? '' : `<button class="btn btn-sm btn-icon btn-ghost" data-act="cl-cat-del" data-id="${c.id}" aria-label="Remove ${esc(c.name)}">${icon('trash')}</button>`}</td></tr>`).join('')}</tbody></table></div>
        <div class="toolbar" style="border-top:1px solid var(--line);border-bottom:0"><button class="btn" data-act="cl-cat-add">${icon('plus')}Add a category</button></div>
        <div class="settings-row" style="padding:12px 22px"><div><div class="label">Mileage rates</div><div class="desc">RM per km for staff using their own vehicle. Your company rate, not a statutory one.</div></div>
          <div class="actions">${Object.entries(R.VEHICLES).map(([k, l]) => `<label class="ot-lbl">${l} <input class="input num" data-mileage="${k}" type="number" min="0" step="0.05" value="${rates[k] ?? 0}" style="width:80px" aria-label="${l} rate per km"></label>`).join('')}</div></div>
        <div class="settings-row" style="padding:12px 22px"><div><div class="label">Eligible after</div><div class="desc">Months of service before staff can claim. 0 means from day one.</div></div><input class="input num" id="cl-probation" type="number" min="0" max="24" value="${p.probationMonths || 0}" style="width:90px" aria-label="Months before staff can claim"></div>
        <p class="disclaimer" style="padding:0 22px 18px">${icon('pin')}<span>Check which reimbursements are taxable perquisites with LHDN or your tax agent. Approvals follow the leave approval chains (department head, second approver, then HR).</span></p></div>
        ${medicalCard()}`;
    }
    function medicalCard() {
      const p = pol();
      return `<div class="card card-flush" id="claim-policy"><div class="card-head" style="padding-bottom:6px"><h3>Medical benefits</h3><span class="hint">The Medical category</span></div>
        <p class="muted" style="padding:0 22px 12px">Switch each medical type on to match your policy, and set its limits. A limit of 0 means no limit.</p>
        <div class="table-wrap"><table class="policy">
          <thead><tr><th>Medical type</th><th>Offered</th><th class="r">Yearly limit (RM)</th><th class="r">Per claim (RM)</th><th>Family</th><th></th></tr></thead>
          <tbody>${p.types.map((t) => `<tr class="${t.on ? '' : 'off'}">
            <td><input class="input" data-pol="${t.id}" data-f="name" value="${esc(t.name)}" aria-label="Name"><div class="person-sub" style="white-space:normal">${esc(t.note || '')}</div></td>
            <td>${onoff('cl-type-on', t.id, t.on)}</td>
            <td class="r"><input class="input num" data-pol="${t.id}" data-f="annual" type="number" min="0" step="50" value="${t.annual}" aria-label="Yearly limit for ${esc(t.name)}"></td>
            <td class="r"><input class="input num" data-pol="${t.id}" data-f="perClaim" type="number" min="0" step="10" value="${t.perClaim}" aria-label="Per claim limit for ${esc(t.name)}"></td>
            <td><input type="checkbox" data-pol="${t.id}" data-f="family" ${t.family ? 'checked' : ''} aria-label="${esc(t.name)} covers spouse and children"></td>
            <td>${t.builtin ? '' : `<button class="btn btn-sm btn-icon btn-ghost" data-act="cl-type-del" data-id="${t.id}" aria-label="Remove ${esc(t.name)}">${icon('trash')}</button>`}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="toolbar" style="border-top:1px solid var(--line);border-bottom:0"><button class="btn" data-act="cl-type-add">${icon('plus')}Add a medical type</button><button class="btn btn-ghost" data-act="cl-reset-policy">Restore typical SME medical policy</button></div>
        <p class="disclaimer" style="padding:0 22px 18px">${icon('pin')}<span>Starting amounts are typical for Malaysian SMEs, not legal minimums. Under the Employment Act 1955 (section 60F), the doctor’s examination for sick leave is at the employer’s expense. SOCSO (PERKESO) covers work injuries.</span></p></div>`;
    }
    function bindSettings() {
      ctx.$$('[data-pol]').forEach((el) => el.addEventListener('change', () => {
        const t = pol().types.find((x) => x.id === el.dataset.pol), f = el.dataset.f;
        if (f === 'family') t[f] = el.checked;
        else if (f === 'name') t.name = el.value.trim() || t.name;
        else t[f] = Math.max(0, Math.round(Number(el.value) || 0));
        commit('Medical policy saved');
      }));
      ctx.$$('[data-cc]').forEach((el) => el.addEventListener('change', () => {
        const c = cats().find((x) => x.id === el.dataset.cc), f = el.dataset.f; if (!c) return;
        if (f === 'field') c.fields = el.checked ? [...new Set([...(c.fields || []), el.dataset.k])] : (c.fields || []).filter((k) => k !== el.dataset.k);
        else if (['on', 'receipt', 'taxable'].includes(f)) c[f] = el.checked;
        else if (f === 'name') c.name = el.value.trim() || c.name;
        else if (f === 'gl') c.gl = el.value;
        else c[f] = Math.max(0, Math.round((Number(el.value) || 0) * 100) / 100);
        commit('Claim category saved');
      }));
      ctx.$$('[data-mileage]').forEach((el) => el.addEventListener('change', () => { pol().mileage = { ...(pol().mileage || R.defaultMileage()), [el.dataset.mileage]: Math.max(0, Number(el.value) || 0) }; commit('Mileage rate saved'); }));
      ctx.$('#cl-probation')?.addEventListener('change', (ev) => { pol().probationMonths = Math.max(0, Math.round(Number(ev.target.value) || 0)); commit('Claim policy saved'); });
    }

    // ---------- Insights ----------
    function insights() {
      const out = [], r = ctx.role(), add = (tone, ic, title, detail, action, prio) => out.push({ tone, icon: ic, title, detail, action, prio });
      if (r === 'employee') {
        const mine = forMe(ctx.me().id);
        if (mine.length) add('warn', 'check', `${mine.length} ${mine.length === 1 ? 'claim needs' : 'claims need'} your approval`, mine.slice(0, 3).map((c) => `${firstOf(c.empId)} (${m2(R.claimTotal(c))})`).join(', '), { label: 'Review', href: '#my-approvals' }, 3);
      }
      return out;
    }

    Object.assign(ACTIONS, {
      'cl-new': (_, v) => newClaim(v),
      'cl-cancel': (id) => { const c = find(id); if (!c || c.status !== 'Pending') return; st().claims = list().filter((x) => x.id !== id); commit('Claim cancelled', `${nameOf(c.empId)} cancelled the claim “${c.title}”`); },
      'cl-receipt': (id, lineId) => { const l = find(id)?.lines.find((x) => x.id === lineId); if (l?.img) openModal({ title: `Receipt · ${l.merchant || ''}`, submit: null, body: `<img class="rc-photo" src="${l.img}" alt="Receipt" style="width:100%;max-height:none">` }); },
      'cl-filter': (_, v) => { cui.filter = v; ctx.render(); },
      'cl-tab': (_, v) => { cui.tab = v; ctx.render(); },
      'cl-by': (_, v) => { cui.by = v; ctx.render(); },
      'cl-report-csv': () => { const rep = R.report(list(), reportOpts()); const text = R.reportCSV(rep); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = `claims-by-${cui.by}-${cui.year}.csv`; document.body.appendChild(a); a.click(); a.remove(); toast(`${a.download} downloaded`); },
      'cl-goto': (_, id) => { location.hash = 'settings'; setTimeout(() => ctx.$('#' + id)?.scrollIntoView({ block: 'start' }), 80); },
      'cl-review': (id) => review(id),
      'cl-approve': (id) => decide(id, true),
      'cl-reject': (id) => decide(id, false),
      'cl-edit': (id, lineId) => editLine(id, lineId),
      'cl-paynow': (id) => { const c = find(id); if (!c || c.status !== 'Approved') return; payNow(c); closeOverlay(); commit(`Paid ${m2(c.approved)} to ${ctx.emp(c.empId).first}`, `Claim “${c.title}” paid to ${nameOf(c.empId)} (${m2(c.approved)})`); },
      'cl-enable': (_, v) => { pol().enabled = v === 'on'; commit(v === 'on' ? 'Claims switched on' : 'Claims switched off'); },
      'cl-type-on': (id, v) => { pol().types.find((t) => t.id === id).on = v === 'on'; commit('Medical policy saved'); },
      'cl-type-del': (id) => { pol().types = pol().types.filter((t) => t.id !== id); commit('Medical type removed'); },
      'cl-cat-del': (id) => { pol().categories = cats().filter((c) => c.id !== id); commit('Category removed'); },
      'cl-reset-policy': () => { const keep = pol().types.filter((t) => !t.builtin); pol().types = [...policyDefaults().types, ...keep]; commit('Typical SME medical policy restored'); },
      'cl-cat-add': () => openModal({
        title: 'Add a claim category', size: 'sm', submit: 'Add',
        body: `<div class="form-grid"><div class="field full"><label for="cc-name">Name</label><input class="input" id="cc-name" name="name" required placeholder="Uniform"></div>
          <div class="field"><label for="cc-month">Per month (RM)</label><input class="input num" id="cc-month" name="perMonth" type="number" min="0" value="0"></div>
          <div class="field"><label for="cc-year">Per year (RM)</label><input class="input num" id="cc-year" name="perYear" type="number" min="0" value="500"></div>
          <div class="field full"><label for="cc-gl">GL category</label><select class="select" id="cc-gl" name="gl">${AllurusFinance.EXPENSE_CATS.filter((g) => g !== 'Payroll').map((g) => `<option ${g === 'Staff benefits' ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
          <div class="field full"><label for="cc-note">What it covers</label><input class="input" id="cc-note" name="note"></div>
          <label class="check field full"><input type="checkbox" name="taxable"><span>Taxable (added to gross pay)</span></label></div>`,
        onSubmit(d) { cats().push({ id: U.uid('cc'), name: d.name.trim(), note: d.note.trim(), perClaim: 0, perMonth: Math.max(0, +d.perMonth || 0), perYear: Math.max(0, +d.perYear || 0), receipt: true, taxable: d.taxable === 'on', gl: d.gl, fields: ['purpose'], on: true, builtin: false }); commit('Category added'); },
      }),
      'cl-type-add': () => openModal({
        title: 'Add a medical type', size: 'sm', submit: 'Add',
        body: `<div class="form-grid"><div class="field full"><label for="ct-name">Name</label><input class="input" id="ct-name" name="name" required placeholder="Fertility treatment"></div>
          <div class="field"><label for="ct-annual">Yearly limit (RM)</label><input class="input num" id="ct-annual" name="annual" type="number" min="0" value="500"></div>
          <div class="field"><label for="ct-per">Per claim (RM)</label><input class="input num" id="ct-per" name="perClaim" type="number" min="0" value="0"></div>
          <div class="field full"><label for="ct-note">What it covers</label><input class="input" id="ct-note" name="note"></div>
          <label class="check field full"><input type="checkbox" name="family"><span>Covers spouse and children</span></label></div>`,
        onSubmit(d) { pol().types.push({ id: U.uid('ct'), name: d.name.trim(), annual: Math.max(0, +d.annual || 0), perClaim: Math.max(0, +d.perClaim || 0), family: d.family === 'on', receipt: true, on: true, note: d.note.trim(), builtin: false }); commit('Medical type added'); },
      }),
    });

    return {
      pendingCount: () => list().filter((c) => c.status === 'Pending').length,
      myCount: (empId) => forMe(empId).length,
      enabled: () => pol().enabled !== false,
      // Approved, unpaid claims for one employee up to a month's end, split for the pay run.
      forPayroll: (empId, mk) => {
        const cl = list().filter((c) => c.empId === empId && c.status === 'Approved' && c.date <= U.monthEnd(mk));
        return { claims: cl, ...R.payrollSplit(cl, cats()) };
      },
      markPaid: (ids, mk) => list().forEach((c) => { if (ids.includes(c.id)) { c.status = 'Paid'; c.paidIn = mk; c.paidOn = U.today(); } }),
      approvalsCard, settingsCards, bindSettings, insights,
    };
  }

  return { DEFAULT_TYPES, policyDefaults, seed, usage, receiptSvg, install };
})();
