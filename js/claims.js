// Medical claims: employees claim medical costs with a receipt, HR approves them against the
// company's claim policy, and approved claims are reimbursed through payroll or paid straight away.
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
  const policyDefaults = () => ({ enabled: true, probationMonths: 0, types: DEFAULT_TYPES.map((t) => ({ ...t, builtin: true })) });

  // Sample claims for the demo company.
  function seed(employees, T) {
    const y = T.slice(0, 4), mk = U.monthKey(T), prev = U.addMonths(mk, -1), prev2 = U.addMonths(mk, -2);
    const c = (empId, type, date, provider, amount, status, extra = {}) => ({ id: U.uid('cl'), empId, type, date, provider, amount, approved: ['Approved', 'Paid'].includes(status) ? amount : null, patient: 'Self', notes: '', status, submitted: date, ...extra });
    return [
      c('e2', 'outpatient', `${prev2}-07`, 'Klinik Mediviron Kuantan', 65, 'Paid', { paidIn: prev2 }),
      c('e2', 'dental', `${prev}-14`, 'Klinik Pergigian Senyum', 180, 'Paid', { paidIn: prev }),
      c('e2', 'outpatient', U.addDays(T, -3), 'Klinik Kesihatan Teluk Sisek', 72, 'Pending', { notes: 'Fever and cough, 2 days MC.' }),
      c('e5', 'optical', U.addDays(T, -6), 'Focus Point Kuantan', 420, 'Pending', { notes: 'New glasses.' }),
      c('e8', 'specialist', U.addDays(T, -10), 'KPJ Pahang Specialist Hospital', 280, 'Approved'),
      c('e13', 'screening', U.addDays(T, -15), 'Pathlab Kuantan', 250, 'Approved'),
      c('e10', 'outpatient', `${prev}-03`, 'Klinik Mediviron Kuantan', 120, 'Rejected', { reason: 'Above the RM80 per-visit limit and no receipt for medicine. Please resubmit with the itemised receipt.' }),
      c('e3', 'maternity', `${prev}-20`, 'Pantai Hospital Kuantan', 1650, 'Paid', { paidIn: prev, patient: 'Spouse' }),
    ].filter((x) => x.date.startsWith(y) || x.date > `${+y - 1}-12-31`);
  }

  // How much of a type an employee has used in a year (approved or paid), and what is waiting.
  function usage(claims, empId, typeId, year) {
    const mine = claims.filter((c) => c.empId === empId && c.type === typeId && c.date.startsWith(year));
    return {
      used: r2(mine.filter((c) => ['Approved', 'Paid'].includes(c.status)).reduce((s, c) => s + (c.approved ?? c.amount), 0)),
      pending: r2(mine.filter((c) => c.status === 'Pending').reduce((s, c) => s + c.amount, 0)),
    };
  }

  function install(ctx) {
    const { VIEWS, AFTER, ACTIONS, esc, icon, money, compactMoney, openModal, closeOverlay, toast, commit } = ctx;
    const st = () => ctx.state;
    const pol = () => (st().settings.claims = st().settings.claims || policyDefaults());
    const list = () => (st().claims = st().claims || []);
    const typeOf = (id) => pol().types.find((t) => t.id === id) || { id, name: 'Removed type', annual: 0, perClaim: 0 };
    const m2 = (n) => money(n, 2);
    const year = () => U.today().slice(0, 4);
    const cui = { filter: 'Pending' };
    const pill = (s) => `<span class="pill ${({ Pending: 'warn', Approved: 'info', Paid: 'ok', Rejected: 'bad' })[s]}">${s === 'Approved' ? 'Approved, to pay' : s}</span>`;
    const remaining = (empId, t, exceptId) => {
      const u = usage(list().filter((c) => c.id !== exceptId), empId, t.id, year());
      return t.annual ? Math.max(0, r2(t.annual - u.used)) : Infinity;
    };
    // The most HR can approve for a claim under the policy.
    const maxApprovable = (c) => {
      const t = typeOf(c.type);
      return r2(Math.min(c.amount, t.perClaim || Infinity, remaining(c.empId, t, c.id)));
    };
    const eligible = (e) => {
      const months = pol().probationMonths || 0;
      return !months || U.addMonths(U.monthKey(e.start), months) <= U.monthKey(U.today());
    };

    // ----- Employee: My medical claims -----
    VIEWS['my-claims'] = () => {
      const e = ctx.me(), p = pol();
      const mine = list().filter((c) => c.empId === e.id).sort((a, b) => b.date.localeCompare(a.date));
      const types = p.types.filter((t) => t.on);
      const paidYtd = r2(mine.filter((c) => c.status === 'Paid' && c.date.startsWith(year())).reduce((s, c) => s + c.approved, 0));
      return `
        <div class="page-head"><div><div class="eyebrow">Benefits</div><h1>Medical claims</h1>
          <p class="sub">Claim medical costs with your receipt. HR approves them, and approved claims are paid with your next salary.</p></div>
          <div class="actions">${eligible(e) ? `<button class="btn btn-primary" data-act="cl-new">${icon('plus')}New claim</button>` : ''}</div></div>
        ${eligible(e) ? '' : `<div class="lock-banner info">${icon('clock')}<span>Medical claims start after ${p.probationMonths} months of service, from ${U.fmtMonth(U.addMonths(U.monthKey(e.start), p.probationMonths))}.</span></div>`}
        <div class="grid g-3">${types.map((t) => { const u = usage(list(), e.id, t.id, year()); const pct = t.annual ? Math.min(100, (u.used / t.annual) * 100) : 0; return `
          <div class="card relief"><div class="kpi-label">${esc(t.name)}</div>
            <div class="kpi-value" style="font-size:22px">${t.annual ? m2(Math.max(0, t.annual - u.used)) : 'No yearly limit'}<span class="faint" style="font-size:13px">${t.annual ? ' left' : ''}</span></div>
            ${t.annual ? `<div class="progress"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--gold)' : 'var(--brand)'}"></i></div>` : ''}
            <div class="kpi-foot">${t.annual ? `${m2(u.used)} of ${m2(t.annual)} used this year` : ''}${u.pending ? ` · ${m2(u.pending)} waiting for HR` : ''}</div>
            <p class="faint" style="font-size:12.5px">${t.perClaim ? `Up to ${m2(t.perClaim)} per claim. ` : ''}${t.family ? 'Covers your spouse and children. ' : ''}${esc(t.note || '')}</p></div>`; }).join('')}</div>
        <div class="card card-flush"><div class="card-head" style="padding-bottom:14px"><h3>My claims</h3><span class="hint">${m2(paidYtd)} paid to you this year</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Date</th><th>Claim</th><th class="hide-sm">Clinic or provider</th><th class="r">Claimed</th><th class="r">Approved</th><th>Status</th><th></th></tr></thead>
            <tbody>${mine.map((c) => `<tr><td class="num muted">${U.fmtDate(c.date, { month: 'short', day: 'numeric' })}</td>
              <td>${esc(typeOf(c.type).name)}${c.patient !== 'Self' ? ` <span class="tag">${esc(c.patient)}</span>` : ''}${c.img ? ` <button class="link-btn" data-act="cl-receipt" data-id="${c.id}">Receipt</button>` : ''}${c.reason ? `<div class="person-sub" style="white-space:normal;color:var(--bad)">${esc(c.reason)}</div>` : ''}</td>
              <td class="hide-sm muted">${esc(c.provider)}</td><td class="r num">${m2(c.amount)}</td><td class="r num">${c.approved != null ? m2(c.approved) : '—'}</td>
              <td>${pill(c.status)}${c.status === 'Paid' && c.paidIn ? `<div class="person-sub">${c.paidIn === 'now' ? 'Paid directly' : 'With ' + U.fmtMonth(c.paidIn, { month: 'short', year: 'numeric' }) + ' salary'}</div>` : c.status === 'Approved' ? '<div class="person-sub">With your next salary</div>' : ''}</td>
              <td><div class="row-actions">${c.status === 'Pending' ? `<button class="btn btn-sm btn-ghost" data-act="cl-cancel" data-id="${c.id}">Cancel</button>` : ''}</div></td></tr>`).join('')}</tbody>
          </table>${mine.length ? '' : '<div class="empty"><strong>No claims yet</strong>Keep your clinic receipt and claim it here.</div>'}</div></div>
        <p class="disclaimer">${icon('pin')}<span>Don’t also claim a reimbursed amount as a personal tax relief. Medical benefits from your employer are generally not taxable for you; check with LHDN or your tax agent if unsure.</span></p>`;
    };

    function newClaim() {
      const e = ctx.me(), types = pol().types.filter((t) => t.on);
      if (!types.length) { toast('Your company has no medical claim types switched on', 'error'); return; }
      let img = null;
      openModal({
        title: 'New medical claim', submit: 'Submit claim',
        body: `<div class="form-grid">
          <div class="field full"><label for="cl-type">Claim type</label><select class="select" id="cl-type" name="type">${types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><span class="field-hint" id="cl-type-hint"></span></div>
          <div class="field"><label for="cl-patient">Treatment for</label><select class="select" id="cl-patient" name="patient"><option>Self</option><option>Spouse</option><option>Child</option></select></div>
          <div class="field"><label for="cl-date">Date of treatment</label><input class="input" id="cl-date" name="date" type="date" required value="${U.today()}" max="${U.today()}"></div>
          <div class="field full receipt-pick"><label>Receipt</label>
            <div class="rp-row"><img id="cl-img" alt="" hidden><div class="rp-actions"><label class="btn" for="cl-file">${icon('camera')}Snap or upload receipt</label><span class="field-hint" id="cl-read">We’ll read the clinic, date and amount for you.</span></div></div>
            <input type="file" id="cl-file" accept="image/*" capture="environment" hidden></div>
          <div class="field"><label for="cl-provider">Clinic or provider</label><input class="input" id="cl-provider" name="provider" required placeholder="Klinik Mediviron Kuantan"></div>
          <div class="field"><label for="cl-amount">Amount (RM)</label><input class="input num" id="cl-amount" name="amount" type="number" min="0.01" step="0.01" required></div>
          <div class="field full"><label for="cl-notes">Note for HR</label><textarea class="textarea" id="cl-notes" name="notes" style="min-height:64px" placeholder="For example: fever, 2 days MC"></textarea></div>
          <p class="field full field-hint" id="cl-limit"></p></div>`,
        onSubmit(d) {
          const t = typeOf(d.type), amount = r2(Number(d.amount));
          if (!(amount > 0)) { toast('Enter the amount on the receipt', 'error'); return false; }
          if (t.receipt && !img) { toast(`${t.name} claims need a photo of the receipt`, 'error'); return false; }
          if (d.patient !== 'Self' && !t.family) { toast(`${t.name} covers only yourself under your company’s policy`, 'error'); return false; }
          list().push({ id: U.uid('cl'), empId: e.id, type: t.id, date: d.date, provider: d.provider.trim(), amount, approved: null, patient: d.patient, notes: d.notes.trim(), status: 'Pending', submitted: U.today(), img });
          commit('Claim sent to HR', `${ctx.fullName(e)} claimed ${m2(amount)} for ${t.name.toLowerCase()}`);
        },
      });
      const f = ctx.$('#overlay-root form');
      const hint = () => {
        const t = typeOf(f.querySelector('#cl-type').value), left = remaining(e.id, t);
        f.querySelector('#cl-type-hint').textContent = t.note || '';
        f.querySelector('#cl-limit').textContent = `${t.annual ? `You have ${m2(left)} of ${m2(t.annual)} left this year. ` : ''}${t.perClaim ? `Up to ${m2(t.perClaim)} per claim. ` : ''}${t.family ? 'Covers your spouse and children.' : 'Covers yourself only.'}${t.receipt ? ' A receipt is required.' : ''}`;
      };
      f.querySelector('#cl-type').addEventListener('change', hint); hint();
      f.querySelector('#cl-file').addEventListener('change', (ev) => {
        const file = ev.target.files?.[0]; if (!file) return;
        const im = new Image();
        im.onload = async () => {
          const c = document.createElement('canvas'), k = Math.min(1, 900 / im.naturalWidth);
          c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          img = c.toDataURL('image/jpeg', 0.6);
          const pv = f.querySelector('#cl-img'); pv.src = img; pv.hidden = false;
          const note = f.querySelector('#cl-read'); note.textContent = 'Reading the receipt…';
          try {
            const p = AllurusReceipt.parse(await AllurusReceipt.read(im));
            const set = (sel, v) => { const el = f.querySelector(sel); if (el && v && !el.value) el.value = v; };
            set('#cl-provider', p.merchant); set('#cl-amount', p.total ? p.total.toFixed(2) : '');
            if (p.date && p.date <= U.today()) f.querySelector('#cl-date').value = p.date;
            note.textContent = p.total ? `Read ${p.merchant || 'the receipt'}, total ${m2(p.total)}. Check the details below.` : 'Couldn’t find the total. Enter it below.';
          } catch (err) { note.textContent = 'Couldn’t read the receipt here. Enter the details below.'; }
          URL.revokeObjectURL(im.src);
        };
        im.src = URL.createObjectURL(file);
      });
    }

    // ----- Admin: Medical claims -----
    VIEWS.claims = () => {
      const p = pol(), all = list();
      const rows = all.filter((c) => cui.filter === 'All' || c.status === cui.filter).sort((a, b) => b.date.localeCompare(a.date));
      const sum = (xs, f) => r2(xs.reduce((s, c) => s + f(c), 0));
      const pending = all.filter((c) => c.status === 'Pending'), toPay = all.filter((c) => c.status === 'Approved');
      const paidYtd = all.filter((c) => c.status === 'Paid' && c.date.startsWith(year()));
      const byType = p.types.map((t) => ({ t, v: sum(paidYtd.filter((c) => c.type === t.id), (c) => c.approved) })).filter((x) => x.v).sort((a, b) => b.v - a.v);
      const maxV = Math.max(1, ...byType.map((x) => x.v));
      const counts = { Pending: pending.length, Approved: toPay.length, Paid: all.filter((c) => c.status === 'Paid').length, Rejected: all.filter((c) => c.status === 'Rejected').length };
      return `
        <div class="page-head"><div><div class="eyebrow">Benefits</div><h1>Medical claims</h1>
          <p class="sub">${p.enabled ? 'Review claims against your claim policy. Approved claims are reimbursed with the next payroll, or you can pay them now.' : 'Medical claims are switched off. Turn them on in the claim policy below.'}</p></div>
          <div class="actions"><button class="btn" data-act="cl-export">${icon('download')}Export CSV</button></div></div>
        <div class="grid g-4 keep-2">
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--warn)"></span>Waiting for review</div><div class="kpi-value">${pending.length}</div><div class="kpi-foot">${m2(sum(pending, (c) => c.amount))} claimed</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--info)"></span>Approved, to pay</div><div class="kpi-value">${compactMoney(sum(toPay, (c) => c.approved))}</div><div class="kpi-foot">${toPay.length} claims, with the next payroll</div></div>
          <div class="card kpi"><div class="kpi-label"><span class="dot" style="background:var(--ok)"></span>Paid this year</div><div class="kpi-value">${compactMoney(sum(paidYtd, (c) => c.approved))}</div><div class="kpi-foot">${paidYtd.length} claims</div></div>
          <div class="card kpi"><div class="kpi-label">Biggest cost this year</div><div class="kpi-value" style="font-size:20px">${byType[0] ? esc(byType[0].t.name) : '—'}</div><div class="kpi-foot">${byType[0] ? m2(byType[0].v) : 'No claims paid yet'}</div></div>
        </div>
        <div class="card card-flush">
          <div class="toolbar"><div class="seg">${['Pending', 'Approved', 'Paid', 'Rejected', 'All'].map((s) => `<button data-act="cl-filter" data-v="${s}" class="${cui.filter === s ? 'on' : ''}">${s === 'Approved' ? 'To pay' : s}${s !== 'All' ? ` <span class="faint">${counts[s]}</span>` : ''}</button>`).join('')}</div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Employee</th><th>Claim</th><th class="hide-sm">Date</th><th class="r">Claimed</th><th class="r">Approved</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows.map((c) => { const e = ctx.emp(c.empId); if (!e) return ''; return `<tr>
              <td>${ctx.person(e)}</td>
              <td>${esc(typeOf(c.type).name)}${c.patient !== 'Self' ? ` <span class="tag">${esc(c.patient)}</span>` : ''}<div class="person-sub">${esc(c.provider)}</div></td>
              <td class="hide-sm muted num">${U.fmtDate(c.date, { month: 'short', day: 'numeric' })}</td>
              <td class="r num">${m2(c.amount)}</td><td class="r num">${c.approved != null ? m2(c.approved) : '—'}</td><td>${pill(c.status)}</td>
              <td><div class="row-actions">${c.status === 'Pending' ? `<button class="btn btn-sm btn-primary" data-act="cl-review" data-id="${c.id}">Review</button>` : c.status === 'Approved' ? `<button class="btn btn-sm" data-act="cl-paynow" data-id="${c.id}">Pay now</button>` : `<button class="btn btn-sm btn-ghost" data-act="cl-review" data-id="${c.id}">View</button>`}</div></td></tr>`; }).join('')}</tbody>
          </table>${rows.length ? '' : `<div class="empty"><strong>No ${cui.filter === 'All' ? '' : cui.filter.toLowerCase() + ' '}claims</strong></div>`}</div></div>
        ${byType.length ? `<div class="card"><div class="card-head"><h3>Paid this year by type</h3></div>${byType.map((x) => `<div class="hbar" style="grid-template-columns:200px minmax(0,1fr) 110px"><span>${esc(x.t.name)}</span><div class="hbar-track"><i style="width:${(x.v / maxV) * 100}%;background:var(--brand)"></i></div><span class="num r">${m2(x.v)}</span></div>`).join('')}</div>` : ''}
        ${policyCard()}`;
    };

    function policyCard() {
      const p = pol();
      const onoff = (act, id, on) => `<div class="seg">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="${act}" data-id="${id}" data-v="${v}" class="${(on ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      return `<div class="card card-flush" id="claim-policy"><div class="card-head" style="padding-bottom:6px"><h3>Claim policy</h3>${onoff('cl-enable', 'all', p.enabled)}</div>
        <p class="muted" style="padding:0 22px 12px">Switch each claim type on to match your company policy, and set its limits. A limit of 0 means no limit. Changes apply to new reviews straight away.</p>
        <div class="settings-row" style="padding:12px 22px"><div><div class="label">Eligible after</div><div class="desc">Months of service before staff can claim. 0 means from day one.</div></div><input class="input num" id="cl-probation" type="number" min="0" max="24" value="${p.probationMonths || 0}" style="width:90px"></div>
        <div class="table-wrap"><table class="policy">
          <thead><tr><th>Claim type</th><th>Offered</th><th class="r">Yearly limit (RM)</th><th class="r">Per claim (RM)</th><th>Family</th><th>Receipt</th><th></th></tr></thead>
          <tbody>${p.types.map((t) => `<tr class="${t.on ? '' : 'off'}">
            <td><input class="input" data-pol="${t.id}" data-f="name" value="${esc(t.name)}" aria-label="Name"><div class="person-sub" style="white-space:normal">${esc(t.note || '')}</div></td>
            <td>${onoff('cl-type-on', t.id, t.on)}</td>
            <td class="r"><input class="input num" data-pol="${t.id}" data-f="annual" type="number" min="0" step="50" value="${t.annual}" aria-label="Yearly limit for ${esc(t.name)}"></td>
            <td class="r"><input class="input num" data-pol="${t.id}" data-f="perClaim" type="number" min="0" step="10" value="${t.perClaim}" aria-label="Per claim limit for ${esc(t.name)}"></td>
            <td><input type="checkbox" data-pol="${t.id}" data-f="family" ${t.family ? 'checked' : ''} aria-label="${esc(t.name)} covers spouse and children"></td>
            <td><input type="checkbox" data-pol="${t.id}" data-f="receipt" ${t.receipt ? 'checked' : ''} aria-label="${esc(t.name)} needs a receipt"></td>
            <td>${t.builtin ? '' : `<button class="btn btn-sm btn-icon btn-ghost" data-act="cl-type-del" data-id="${t.id}" aria-label="Remove ${esc(t.name)}">${icon('trash')}</button>`}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="toolbar" style="border-top:1px solid var(--line);border-bottom:0"><button class="btn" data-act="cl-type-add">${icon('plus')}Add a claim type</button><button class="btn btn-ghost" data-act="cl-reset-policy">Restore typical SME policy</button></div>
        <p class="disclaimer" style="padding:0 22px 18px">${icon('pin')}<span>Starting amounts are typical for Malaysian SMEs, not legal minimums. Under the Employment Act 1955 (section 60F), the doctor’s examination for sick leave is at the employer’s expense. SOCSO (PERKESO) covers work injuries. Check your policy with your HR adviser.</span></p></div>`;
    }
    AFTER.claims = () => {
      ctx.$$('[data-pol]').forEach((el) => el.addEventListener('change', () => {
        const t = pol().types.find((x) => x.id === el.dataset.pol), f = el.dataset.f;
        if (f === 'family' || f === 'receipt') t[f] = el.checked;
        else if (f === 'name') t.name = el.value.trim() || t.name;
        else t[f] = Math.max(0, Math.round(Number(el.value) || 0));
        commit('Claim policy saved');
      }));
      ctx.$('#cl-probation')?.addEventListener('change', (ev) => { pol().probationMonths = Math.max(0, Math.round(Number(ev.target.value) || 0)); commit('Claim policy saved'); });
    };

    function review(id) {
      const c = list().find((x) => x.id === id); if (!c) return;
      const e = ctx.emp(c.empId), t = typeOf(c.type), u = usage(list().filter((x) => x.id !== c.id), c.empId, t.id, year());
      const max = maxApprovable(c), open = c.status === 'Pending';
      const capNote = [t.perClaim && c.amount > t.perClaim ? `above the ${m2(t.perClaim)} per-claim limit` : '', t.annual && c.amount > t.annual - u.used ? `more than the ${m2(Math.max(0, t.annual - u.used))} left this year` : ''].filter(Boolean).join(' and ');
      openModal({
        title: `${ctx.fullName(e)} · ${t.name}`, size: c.img ? 'lg' : '', submit: null,
        body: `<div class="${c.img ? 'rc-review' : ''}">${c.img ? `<div class="rc-side"><img class="rc-photo" src="${c.img}" alt="Receipt for this claim"></div>` : ''}
          <div class="rc-main"><dl class="kv"><dt>Status</dt><dd>${pill(c.status)}</dd><dt>Treatment</dt><dd>${U.fmtDate(c.date)} · ${esc(c.patient)}</dd><dt>Clinic</dt><dd>${esc(c.provider)}</dd><dt>Claimed</dt><dd class="num">${m2(c.amount)}</dd>
            <dt>Policy</dt><dd>${t.annual ? `${m2(t.annual)} a year, ${m2(u.used)} used` : 'No yearly limit'}${t.perClaim ? ` · up to ${m2(t.perClaim)} per claim` : ''}</dd>
            ${c.notes ? `<dt>Note</dt><dd>${esc(c.notes)}</dd>` : ''}${c.reason ? `<dt>Reason</dt><dd>${esc(c.reason)}</dd>` : ''}${c.approved != null ? `<dt>Approved</dt><dd class="num">${m2(c.approved)}</dd>` : ''}
            ${!c.img && t.receipt ? '<dt>Receipt</dt><dd style="color:var(--bad)">Missing</dd>' : ''}</dl>
          ${open ? `${capNote ? `<div class="lock-banner warn">${icon('pin')}<span>This claim is ${capNote}. Up to ${m2(max)} can be approved under the policy.</span></div>` : ''}
            <div class="review-box"><div class="form-grid"><div class="field"><label for="cl-approve">Amount to approve</label><input class="input num" id="cl-approve" type="number" min="0" step="0.01" max="${max}" value="${max.toFixed(2)}"></div>
              <div class="field"><label for="cl-reason">Reason (required to reject)</label><input class="input" id="cl-reason" placeholder="For example: receipt not itemised"></div></div>
              <div class="ci-actions" style="justify-content:flex-end"><button class="btn btn-danger" data-act="cl-reject" data-id="${c.id}">Reject</button><button class="btn btn-primary" data-act="cl-approve" data-id="${c.id}">${icon('check')}Approve</button></div></div>` : ''}
          </div></div>`,
      });
    }

    // Pay approved claims now (outside payroll) and record the cost in the books.
    function payNow(c) {
      const T = U.today();
      c.status = 'Paid'; c.paidIn = 'now'; c.paidOn = T;
      st().finance?.txns.push({ id: U.uid('x'), date: T, desc: `Medical claim: ${ctx.fullName(ctx.emp(c.empId))}, ${typeOf(c.type).name}`, type: 'out', category: 'Staff benefits', amount: c.approved, tax: 0, ref: c.id.toUpperCase(), source: 'claim', reconciled: false });
    }

    Object.assign(ACTIONS, {
      'cl-new': () => newClaim(),
      'cl-cancel': (id) => { const c = list().find((x) => x.id === id); st().claims = list().filter((x) => x.id !== id); commit('Claim cancelled', `${ctx.fullName(ctx.emp(c.empId))} cancelled a ${typeOf(c.type).name.toLowerCase()} claim`); },
      'cl-receipt': (id) => { const c = list().find((x) => x.id === id); if (c?.img) openModal({ title: 'Receipt', size: 'sm', submit: null, body: `<img class="rc-photo" src="${c.img}" alt="Receipt" style="width:100%">` }); },
      'cl-filter': (_, v) => { cui.filter = v; ctx.render(); },
      'cl-review': (id) => review(id),
      'cl-approve': (id) => {
        const c = list().find((x) => x.id === id), max = maxApprovable(c);
        const amt = r2(Number(ctx.$('#cl-approve').value));
        if (!(amt > 0)) { toast('Enter an amount above zero, or reject the claim', 'error'); return; }
        if (amt > max + 0.001) { toast(`The policy allows up to ${m2(max)} for this claim`, 'error'); return; }
        Object.assign(c, { status: 'Approved', approved: amt, decidedOn: U.today(), decidedBy: ctx.account()?.name || 'HR' });
        closeOverlay(); commit(`Approved ${m2(amt)} for ${ctx.emp(c.empId).first}`, `${ctx.fullName(ctx.emp(c.empId))}’s ${typeOf(c.type).name.toLowerCase()} claim was approved (${m2(amt)})`);
      },
      'cl-reject': (id) => {
        const c = list().find((x) => x.id === id), reason = ctx.$('#cl-reason').value.trim();
        if (!reason) { toast('Give a reason, so the employee knows what to fix', 'error'); ctx.$('#cl-reason').focus(); return; }
        Object.assign(c, { status: 'Rejected', approved: null, reason, decidedOn: U.today(), decidedBy: ctx.account()?.name || 'HR' });
        closeOverlay(); commit('Claim rejected', `${ctx.fullName(ctx.emp(c.empId))}’s ${typeOf(c.type).name.toLowerCase()} claim was rejected`);
      },
      'cl-paynow': (id) => { const c = list().find((x) => x.id === id); payNow(c); commit(`Paid ${m2(c.approved)} to ${ctx.emp(c.empId).first}`, `Medical claim paid to ${ctx.fullName(ctx.emp(c.empId))} (${m2(c.approved)})`); },
      'cl-enable': (_, v) => { pol().enabled = v === 'on'; commit(v === 'on' ? 'Medical claims switched on' : 'Medical claims switched off'); },
      'cl-type-on': (id, v) => { pol().types.find((t) => t.id === id).on = v === 'on'; commit('Claim policy saved'); },
      'cl-type-del': (id) => { pol().types = pol().types.filter((t) => t.id !== id); commit('Claim type removed'); },
      'cl-reset-policy': () => { const keep = pol().types.filter((t) => !t.builtin); st().settings.claims = { ...policyDefaults(), enabled: pol().enabled, probationMonths: pol().probationMonths }; pol().types.push(...keep); commit('Typical SME policy restored'); },
      'cl-type-add': () => openModal({
        title: 'Add a claim type', size: 'sm', submit: 'Add',
        body: `<div class="form-grid"><div class="field full"><label for="ct-name">Name</label><input class="input" id="ct-name" name="name" required placeholder="Fertility treatment"></div>
          <div class="field"><label for="ct-annual">Yearly limit (RM)</label><input class="input num" id="ct-annual" name="annual" type="number" min="0" value="500"></div>
          <div class="field"><label for="ct-per">Per claim (RM)</label><input class="input num" id="ct-per" name="perClaim" type="number" min="0" value="0"></div>
          <div class="field full"><label for="ct-note">What it covers</label><input class="input" id="ct-note" name="note"></div>
          <label class="check field full"><input type="checkbox" name="family"><span>Covers spouse and children</span></label></div>`,
        onSubmit(d) { pol().types.push({ id: U.uid('ct'), name: d.name.trim(), annual: Math.max(0, +d.annual || 0), perClaim: Math.max(0, +d.perClaim || 0), family: d.family === 'on', receipt: true, on: true, note: d.note.trim(), builtin: false }); commit('Claim type added'); },
      }),
      'cl-export': () => ctx.downloadCSV(`medical-claims-${year()}.csv`, [['Employee', 'Type', 'Treatment for', 'Date', 'Provider', 'Claimed', 'Approved', 'Status', 'Paid with', 'Reason'],
        ...list().map((c) => [ctx.fullName(ctx.emp(c.empId)), typeOf(c.type).name, c.patient, c.date, c.provider, c.amount, c.approved ?? '', c.status, c.paidIn === 'now' ? 'Paid directly' : c.paidIn || '', c.reason || ''])]),
    });

    return {
      pendingCount: () => list().filter((c) => c.status === 'Pending').length,
      enabled: () => pol().enabled !== false,
      // Approved, unpaid claims for one employee up to a month's end, for the payroll run.
      forPayroll: (empId, mk) => list().filter((c) => c.empId === empId && c.status === 'Approved' && c.date <= U.monthEnd(mk)),
      markPaid: (ids, mk) => list().forEach((c) => { if (ids.includes(c.id)) { c.status = 'Paid'; c.paidIn = mk; } }),
    };
  }

  return { DEFAULT_TYPES, policyDefaults, seed, usage, install };
})();
