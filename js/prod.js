// Daily production commission (docs/PRODUCTION-COMMISSION-SPEC.md): Settings card, the "Production" page where an admin
// keys in the day's total units (with a live preview of who shares the pool), the payroll line, and each person's own
// view. Only for companies that have the addon (tenants/{t}.addons.prodCommission, set by the superadmin); everyone
// else sees nothing of it. The maths and who counts are in js/prod-rules.js; the documents are in firestore.rules.
window.AllurusProduction = (function () {
  'use strict';
  const P = window.AllurusProd;
  let ctx = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const rm = P.rm;
  const NAME = 'Production commission / Komisen pengeluaran';
  const ui = { day: '', vals: null, note: '', month: '' };

  // ---------- Is it on, who may use it ----------
  // The cloud: the company's addon. The demo: a company that has production settings (Major Far East's demo).
  const on = () => (ctx.cloud() ? !!window.AllurusCompany?.addons?.prodCommission : !!st().settings?.prod);
  const canEntry = () => on() && ctx.role() === 'admin' && (ctx.can('operations') || ctx.can('payroll'));
  const canSettings = () => on() && ctx.role() === 'admin' && ctx.can('payroll');
  const cfg = () => (st().settings.prod = st().settings.prod || { products: [], depts: [] });
  // The products in the order set. A company that only had the single total reads as one product, "Production", at its old rate.
  const prods = () => P.productsOf(cfg());
  const store = () => { const s = st(); if (!s.prod || !s.prod.days) s.prod = { days: {}, locks: {} }; s.prod.locks = s.prod.locks || {}; return s.prod; };
  const days = () => store().days;
  const emps = () => ctx.activeEmployees();
  const allEmps = () => st().employees || [];
  const configured = () => { const a = prods().filter((p) => p.on !== false); return a.length > 0 && a.every((p) => P.rateUnits(p.rate) != null) && (cfg().depts || []).length > 0; };
  const approvedLeaves = () => (st().leaves || []).filter((l) => l.status === 'Approved');
  const isLocked = (date) => { const mk = P.MONTH(date); return !!store().locks[mk] || st().payroll?.[mk]?.status === 'Paid'; };
  const fmtD = (d, o = { weekday: 'short', day: 'numeric', month: 'short' }) => U.fmtDate(d, o);

  // ---------- The day: plan, save, recalculate ----------
  // The values typed on the page: { productId: "2000" }. A product left blank is not filled for that day.
  const itemsFor = (date, values, rateOf) => {
    const old = P.dayItems(days()[date]), byPid = new Map(old.map((i) => [i.pid, i]));
    const live = prods().filter((p) => p.on !== false).map((p) => ({ pid: p.id, name: p.name, unit: p.unit, rate: byPid.get(p.id)?.rate ?? p.rate, units: values[p.id] }));
    // Lines for products that were switched off after the day was saved stay as they were: history keeps its figures.
    const kept = old.filter((i) => !live.some((l) => l.pid === i.pid)).map((i) => ({ pid: i.pid, name: i.name, unit: i.unit, rate: i.rate, units: i.units }));
    return [...live, ...kept];
  };
  function plan(date, items) {
    return P.planDay({ date, items, employees: allEmps(), att: st().attendance?.[date] || {}, leaves: approvedLeaves(), settings: cfg() });
  }
  const summary = (x) => P.dayItems(x).map((i) => P.fmtUnits(i.units, i.unit)).join(' + ');
  const shareDocs = (date, p, sum) => [
    ...p.attendees.map((a) => ({ date, empId: a.id, status: 'paid', shareSen: p.shareSen, units: sum, unit: '', poolSen: p.poolSen, count: p.count, reason: '' })),
    ...p.excluded.map((x) => ({ date, empId: x.id, status: 'missed', shareSen: 0, units: sum, unit: '', poolSen: p.poolSen, count: p.count, reason: x.reason })),
  ];
  // Everyone listed on the old save who is no longer listed gets a "removed" record, so no stale share stays visible.
  function staleShares(date, old, p, sum) {
    const now = new Set([...p.attendees.map((a) => a.id), ...p.excluded.map((x) => x.id)]);
    return [...(old?.attendees || []), ...((old?.excluded || []).map((x) => x.id))].filter((id) => !now.has(id))
      .map((id) => ({ date, empId: id, status: 'missed', shareSen: 0, units: sum, unit: '', poolSen: p.poolSen, count: p.count, reason: 'Removed from this day' }));
  }
  // values = { productId: units } from the page; null = recalculate the saved lines against today's attendance.
  async function saveDay(date, values, note) {
    if (!canEntry()) return;
    if (isLocked(date)) { ctx.toast('That month is finalised in payroll, so its days are locked. A correction goes in the next open month.', 'error'); return; }
    if (date > T()) { ctx.toast('You can’t enter production for a day that hasn’t happened.', 'error'); return; }
    if (!configured()) { ctx.toast('Add a product with its rate, and pick the departments, in Settings first.', 'error'); return; }
    const old = days()[date];
    const items = values ? itemsFor(date, values) : P.dayItems(old).map((i) => ({ ...i }));
    const filled = items.filter((i) => i.units != null && String(i.units).trim() !== '');
    if (!filled.length) { ctx.toast('Type at least one product’s total first.', 'error'); return; }
    if (filled.some((i) => P.unitsCenti(i.units) == null)) { ctx.toast('Type each total as a number (whole units, or up to 2 decimals).', 'error'); return; }
    const p = plan(date, items);
    if (!p.ok) { ctx.toast('Check the rates in Settings: each is a number with up to 4 decimals.', 'error'); return; }
    const sum = p.lines.map((i) => P.fmtUnits(i.units, i.unit)).join(' + '), by = ctx.me()?.id || '';
    const doc = { date, items: p.lines, units: sum, unit: '', rate: p.lines.length === 1 ? p.lines[0].rate : '', poolSen: p.poolSen, shareSen: p.shareSen, remainderSen: p.remainderSen, count: p.count,
      attendees: p.attendees.map((a) => a.id), excluded: p.excluded, flags: p.flags, sig: p.sig, note: String(note || '').slice(0, 200), savedBy: by, savedAt: new Date().toISOString(), v: (old?.v || 0) + 1 };
    if (old) doc.prev = { units: summary(old), poolSen: old.poolSen, shareSen: old.shareSen, savedBy: old.savedBy, savedAt: old.savedAt };
    const shares = [...shareDocs(date, p, sum), ...staleShares(date, old, p, sum)];
    const before = old ? { ...old } : null;
    days()[date] = doc;
    if (ctx.cloud() && ctx.fire()?.prodSave) {
      const r = await ctx.fire().prodSave(doc, shares);
      if (!r.ok) { if (before) days()[date] = before; else delete days()[date]; ctx.toast(r.error, 'error'); ctx.render(); return; }
    }
    ctx.log(old ? `Production for ${fmtD(date)} changed: ${summary(old)} → ${sum} (${rm(old.poolSen)} → ${rm(doc.poolSen)}, ${old.count} → ${doc.count} people)` : `Production for ${fmtD(date)}: ${sum}, ${rm(doc.poolSen)} shared by ${doc.count} (${rm(doc.shareSen)} each)`);
    if (!ctx.cloud()) store();
    ctx.commit(old ? 'Production day updated' : 'Production day saved');
  }
  const changedSince = (d) => { const x = days()[d]; return !!x && x.sig !== plan(d, P.dayItems(x)).sig; };

  // ---------- The Production page ----------
  const unlockedFrom = () => { const mk = U.monthKey(T()); let m = mk, k = 0; while (k++ < 36 && isLocked(m + '-01')) m = U.addMonths(m, 1); return m + '-01'; };
  const monthOfDay = () => P.MONTH(ui.day || T());
  // The pool for the typed values: each product's qty × rate, then the total and each person's share.
  function previewHTML(date, values) {
    if (!configured()) return `<div class="empty"><strong>Set it up first / Sediakan dahulu</strong>Add a product with its rate, and pick the departments, in Settings.</div>`;
    const items = itemsFor(date, values || {}), typed = items.filter((i) => i.units != null && String(i.units).trim() !== '');
    const bad = typed.some((i) => P.unitsCenti(i.units) == null);
    const p = plan(date, bad ? [] : items), name = (id) => ctx.fullName(ctx.emp(id));
    const line = (a) => { const e = ctx.emp(a.id); return `<tr><td>${esc(name(a.id))}</td><td class="muted">${esc(ctx.dept(e?.dept)?.name || '—')}</td><td class="num">${esc(a.firstIn || '—')}</td></tr>`; };
    const no = (x) => { const e = ctx.emp(x.id); return `<tr><td>${esc(name(x.id))}</td><td class="muted">${esc(ctx.dept(e?.dept)?.name || '—')}</td><td>${esc(x.reason)}</td></tr>`; };
    const ok = !bad && p.ok && typed.length > 0;
    const pool = ok ? `<div class="card card-flush" style="margin-bottom:12px"><div class="card-head"><h3>The day’s pool / Kumpulan hari ini</h3></div><div class="table-wrap"><table class="table pd-pool"><thead><tr><thNone>Product<span lang="ms" class="th-ms">Produk</span></th><th class="r">Qty<span lang="ms" class="th-ms">Kuantiti</span></th><th class="r">Rate<span lang="ms" class="th-ms">Kadar</span></th><th class="r">Amount<span lang="ms" class="th-ms">Jumlah</span></th></tr></thead><tbody>${p.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r num">${esc(P.fmtUnits(l.units, l.unit))}</td><td class="r num">RM${esc(l.rate)}</td><td class="r num">${rm(l.poolSen)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="3">Total pool / Jumlah</th><th class="r num" id="pv-pool">${rm(p.poolSen)}</th></tr></tfoot></table></div></div>` : '';
    return `${pool}<div class="grid g-4 keep-2" style="margin-bottom:12px">
        <div class="card kpi"><div class="kpi-label">Pool <span lang="ms">/ Kumpulan</span></div><div class="kpi-value" ${ok ? '' : 'id="pv-pool"'}>${ok ? rm(p.poolSen) : '—'}</div><div class="kpi-foot">${ok ? `${typed.length} product${typed.length === 1 ? '' : 's'}` : 'Type at least one total'}</div></div>
        <div class="card kpi"><div class="kpi-label">Share the pool <span lang="ms">/ Kongsi kumpulan</span></div><div class="kpi-value">${p.count}</div><div class="kpi-foot">checked in that day</div></div>
        <div class="card kpi"><div class="kpi-label">Each person <span lang="ms">/ Setiap orang</span></div><div class="kpi-value">${ok && p.count ? rm(p.shareSen) : '—'}</div><div class="kpi-foot">${ok && p.count ? (p.remainderSen ? `${rm(p.remainderSen)} not shared out` : 'nothing left over') : p.count ? '' : 'Nobody checked in: the pool is not paid'}</div></div>
        <div class="card kpi"><div class="kpi-label">Not sharing <span lang="ms">/ Tidak berkongsi</span></div><div class="kpi-value">${p.excluded.length}</div><div class="kpi-foot">${p.excluded.length ? 'see the reasons below' : 'everyone in is included'}</div></div></div>
      ${p.flags.length ? `<p class="lock-banner" role="note" style="margin-bottom:12px">${p.flags.map((f) => `${esc(name(f.id))}: ${esc(f.flag)}. Leave wins, so they don’t share.`).join('<br>')}</p>` : ''}
      <div class="grid g-2" style="gap:12px"><div class="card card-flush"><div class="card-head"><h3>Gets a share <span lang="ms" class="faint">/ Dapat bahagian</span> (${p.count})</h3></div><div class="table-wrap"><table><thead><tr><thNone>Name<span lang="ms" class="th-ms">Nama</span></th><thNone>Department<span lang="ms" class="th-ms">Jabatan</span></th><thNone>First check-in<span lang="ms" class="th-ms">Daftar masuk pertama</span></th></tr></thead><tbody>${p.attendees.map(line).join('') || '<tr><td colspan="3" class="muted">Nobody yet.</td></tr>'}</tbody></table></div></div>
      <div class="card card-flush"><div class="card-head"><h3>Doesn’t <span lang="ms" class="faint">/ Tidak dapat</span> (${p.excluded.length})</h3></div><div class="table-wrap"><table><thead><tr><thNone>Name<span lang="ms" class="th-ms">Nama</span></th><thNone>Department<span lang="ms" class="th-ms">Jabatan</span></th><thNone>Why<span lang="ms" class="th-ms">Sebab</span></th></tr></thead><tbody>${p.excluded.map(no).join('') || '<tr><td colspan="3" class="muted">Nobody is left out.</td></tr>'}</tbody></table></div></div></div>`;
  }
  function monthList(month) {
    const first = month + '-01', last = U.monthEnd(month), dates = [];
    for (let d = first; d <= last && d <= T(); d = U.addDays(d, 1)) dates.push(d);
    const atts = st().attendance || {};
    const row = (d) => {
      const x = days()[d], lock = isLocked(d);
      const anyIn = Object.values(atts[d] || {}).some((r) => r && (r.s === 'present' || r.s === 'remote') && r.in);
      if (!x && !anyIn) return '';
      const status = x ? (changedSince(d) ? '<span class="pill warn">Attendance changed: recalculate</span>' : lock ? '<span class="pill">Locked</span>' : '<span class="pill ok">Saved</span>') : '<span class="pill bad">No production entered</span>';
      return `<tr><td>${esc(fmtD(d))}</td><td class="num">${x ? esc(summary(x)) : '—'}</td><td class="num">${x ? rm(x.poolSen) : '—'}</td><td class="num">${x ? x.count : '—'}</td><td class="num">${x ? rm(x.shareSen) : '—'}</td><td>${status}</td>
        <td class="r"><button class="btn btn-sm" data-act="prod-day" data-v="${d}">${x ? 'Open' : 'Enter'}</button>${x && changedSince(d) && !lock ? `<button class="btn btn-sm btn-primary" data-act="prod-recalc" data-v="${d}">Recalculate</button>` : ''}</td></tr>`;
    };
    const rows = dates.reverse().map(row).join('');
    const tot = P.monthTotals(days(), month), sum = Object.values(tot).reduce((s, v) => s + v.sen, 0);
    return `<div class="card card-flush" style="margin-top:12px"><div class="card-head"><h3>${esc(U.fmtMonth(month))}</h3><div class="actions">
        <button class="btn btn-icon" data-act="prod-month" data-v="-1" aria-label="Previous month">${icon('left')}</button><button class="btn btn-icon" data-act="prod-month" data-v="1" aria-label="Next month" ${month >= U.monthKey(T()) ? 'disabled' : ''}>${icon('right')}</button>
        ${ctx.can('payroll') ? `<button class="btn btn-sm" data-act="prod-csv" data-v="${month}">${icon('download')}Export CSV</button>` : ''}</div></div>
      <p class="muted" style="padding:0 22px 10px">${Object.keys(tot).length} people · ${rm(sum)} paid out this month${store().locks[month] || st().payroll?.[month]?.status === 'Paid' ? ' · locked: payroll is finalised' : ''}</p>
      <div class="table-wrap"><table><thead><tr><thNone>Day<span lang="ms" class="th-ms">Hari</span></th><thNone>Total<span lang="ms" class="th-ms">Jumlah</span></th><thNone>Pool<span lang="ms" class="th-ms">Kumpulan</span></th><thNone>People<span lang="ms" class="th-ms">Orang</span></th><thNone>Each<span lang="ms" class="th-ms">Setiap orang</span></th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">No check-ins or production this month.</td></tr>'}</tbody></table></div></div>${monthByPerson(tot)}`;
  }
  // The month by person and by department (payroll area: it is what each person is paid).
  function monthByPerson(tot) {
    if (!ctx.can('payroll') || !Object.keys(tot).length) return '';
    const people = Object.entries(tot).map(([id, v]) => ({ id, e: ctx.emp(id), ...v })).sort((x, y) => y.sen - x.sen);
    const byDept = {}; people.forEach((p) => { const n = ctx.dept(p.e?.dept)?.name || 'No department'; const d = (byDept[n] = byDept[n] || { sen: 0, people: 0 }); d.sen += p.sen; d.people += 1; });
    return `<div class="grid g-2" style="gap:12px;margin-top:12px"><div class="card card-flush"><div class="card-head"><h3>By person <span lang="ms" class="faint">/ Mengikut orang</span></h3></div><div class="table-wrap"><table><thead><tr><thNone>Name<span lang="ms" class="th-ms">Nama</span></th><thNone>Days<span lang="ms" class="th-ms">Hari</span></th><thNone>Total<span lang="ms" class="th-ms">Jumlah</span></th></tr></thead><tbody>${people.map((p) => `<tr><td>${esc(ctx.fullName(p.e) || p.id)}</td><td class="num">${p.days}</td><td class="num">${rm(p.sen)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card card-flush"><div class="card-head"><h3>By department <span lang="ms" class="faint">/ Mengikut jabatan</span></h3></div><div class="table-wrap"><table><thead><tr><thNone>Department<span lang="ms" class="th-ms">Jabatan</span></th><thNone>People<span lang="ms" class="th-ms">Orang</span></th><thNone>Total<span lang="ms" class="th-ms">Jumlah</span></th></tr></thead><tbody>${Object.entries(byDept).map(([n, d]) => `<tr><td>${esc(n)}</td><td class="num">${d.people}</td><td class="num">${rm(d.sen)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  }
  // The values on the form: what was typed, else what the saved day holds.
  const savedValues = (saved) => Object.fromEntries(P.dayItems(saved).map((i) => [i.pid, i.units]));
  const formValues = (day) => (ui.vals != null ? ui.vals : savedValues(days()[day]));
  function view() {
    if (!canEntry()) return '<div class="empty"><strong>Not available</strong>Production commission isn’t switched on for your account.</div>';
    const day = ui.day || (ui.day = T()), saved = days()[day], locked = isLocked(day);
    const vals = formValues(day);
    const note = ui.note !== '' ? ui.note : saved?.note || '';
    const min = unlockedFrom(), active = prods().filter((p) => p.on !== false);
    const hist = P.dayItems(saved).filter((i) => !active.some((p) => p.id === i.pid));   // switched off since: shown, read only
    const input = (p) => `<div class="field"><label for="pd-u-${esc(p.id)}">${esc(p.name || 'Product')} (${esc(p.unit || 'units')}) <span class="faint">× RM${esc(String(p.rate))}</span></label><input class="input" id="pd-u-${esc(p.id)}" data-pid="${esc(p.id)}" inputmode="decimal" autocomplete="off" value="${esc(String(vals[p.id] ?? ''))}" ${locked ? 'disabled' : ''} placeholder="e.g. 2000"></div>`;
    return `<div class="page-head"><div><h1>Production</h1><p class="sub">Type each product’s total for the day. The pool is shared equally by everyone who checked in, in the commission departments.</p></div>
        <div class="actions"><button class="btn btn-icon" data-act="prod-shift" data-v="-1" aria-label="Previous day" ${day <= min ? 'disabled' : ''}>${icon('left')}</button>
          <input class="input" type="date" id="pd-date" value="${day}" min="${min}" max="${T()}" aria-label="Day">
          <button class="btn btn-icon" data-act="prod-shift" data-v="1" aria-label="Next day" ${day >= T() ? 'disabled' : ''}>${icon('right')}</button><button class="btn" data-act="prod-shift" data-v="0">Today</button></div></div>
      ${locked ? '<p class="lock-banner" role="note" style="margin-bottom:12px">This month is finalised in payroll, so this day is locked. A correction goes in the next open month.</p>' : ''}
      ${saved && changedSince(day) && !locked ? `<p class="lock-banner" role="note" style="margin-bottom:12px">Attendance changed since this was saved (for example a check-in correction). <button class="btn btn-sm btn-primary" data-act="prod-recalc" data-v="${day}">Recalculate</button></p>` : ''}
      <div class="card" style="margin-bottom:12px"><form id="pd-form" novalidate>
        ${active.length ? `<div class="form-grid pd-inputs">${active.map(input).join('')}</div>` : '<div class="empty"><strong>No products yet / Belum ada produk</strong>Add one in Settings → Payroll → Production commission.</div>'}
        ${hist.length ? `<p class="faint" style="font-size:12.5px;margin-top:8px">Switched off since, kept on this day: ${hist.map((i) => `${esc(i.name)} ${esc(P.fmtUnits(i.units, i.unit))}`).join(' · ')}</p>` : ''}
        <div class="form-grid" style="margin-top:10px"><div class="field"><label for="pd-note">Note (optional)</label><input class="input" id="pd-note" name="note" maxlength="200" value="${esc(note)}" ${locked ? 'disabled' : ''}></div>
        <div class="field" style="align-self:end"><button class="btn btn-primary" type="submit" ${locked || !configured() ? 'disabled' : ''}>${saved ? 'Save changes' : 'Save the day'} <span lang="ms">/ Simpan hari ini</span></button></div></div></form>
        ${saved ? `<p class="faint" style="font-size:12.5px;margin-top:8px">Saved by ${esc(ctx.fullName(ctx.emp(saved.savedBy)) || 'someone')} on ${esc(U.fmtDate(String(saved.savedAt).slice(0, 10), { day: 'numeric', month: 'short' }))}. A saved day keeps the rates it was saved with; a rate change applies to days saved afterwards.</p>` : ''}</div>
      <div id="pd-preview">${previewHTML(day, vals)}</div>
      ${monthList(monthOfDay())}`;
  }
  function after() {
    const form = ctx.$('#pd-form'); if (!form) return;
    const read = () => { const v = {}; form.querySelectorAll('[data-pid]').forEach((el) => { v[el.dataset.pid] = el.value; }); return v; };
    const live = () => { ui.vals = read(); const el = ctx.$('#pd-preview'); if (el) el.innerHTML = previewHTML(ui.day, ui.vals); };
    form.querySelectorAll('[data-pid]').forEach((el) => el.addEventListener('input', live));
    form.note?.addEventListener('input', () => { ui.note = form.note.value; });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); saveDay(ui.day, read(), form.note.value).then(() => { ui.vals = null; ui.note = ''; }); });
    ctx.$('#pd-date')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.day = ev.target.value; ui.vals = null; ui.note = ''; ctx.render(); } });
  }

  // ---------- Settings → Payroll ----------
  function settingsCard() {
    if (!canSettings()) return '';
    const c = cfg(), depts = st().departments || [], list = prods();
    const noDept = allEmps().filter((e) => e.status === 'Active' && !e.dept);
    const used = (p) => P.productUsed(p.id, days());
    const rowHTML = (p, i) => `<div class="pc-prod${p.on === false ? ' off' : ''}" data-pc-row="${esc(p.id)}">
        <div class="field"><label for="pcp-n-${esc(p.id)}">Product name / Nama produk</label><input class="input" id="pcp-n-${esc(p.id)}" data-pc="name" maxlength="40" value="${esc(p.name)}"></div>
        <div class="field"><label for="pcp-u-${esc(p.id)}">Unit / Unit</label><input class="input" id="pcp-u-${esc(p.id)}" data-pc="unit" maxlength="20" value="${esc(p.unit)}" placeholder="pcs, kg, box"></div>
        <div class="field"><label for="pcp-r-${esc(p.id)}">Rate per unit (RM) / Kadar</label><input class="input" id="pcp-r-${esc(p.id)}" data-pc="rate" inputmode="decimal" value="${esc(String(p.rate ?? ''))}" placeholder="0.05"></div>
        <div class="pc-actions"><div class="seg" role="group" aria-label="Active">${[['on', 'On'], ['off', 'Off']].map(([v, l]) => `<button type="button" data-pc-on="${v}" class="${(p.on === false ? 'off' : 'on') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button type="button" class="btn btn-icon" data-pc-move="-1" aria-label="Move ${esc(p.name)} up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button><button type="button" class="btn btn-icon" data-pc-move="1" aria-label="Move ${esc(p.name)} down" ${i === list.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
          ${used(p) ? '<span class="faint pc-used">Used: switch off instead of deleting</span>' : `<button type="button" class="btn btn-sm btn-danger" data-pc-del="1">Delete</button>`}</div></div>`;
    return `<div class="card" id="prod-settings"><div class="card-head"><h3>Production commission</h3><span class="hint">Komisen pengeluaran</span></div>
      <p class="muted" style="margin-bottom:10px">Add each product the company makes, with its own rate. Each day an admin keys in the quantity of each product. The pool (qty × rate, added up) is shared equally by the staff who checked in that day, and each person’s days are added to their pay at month end.</p>
      <div class="pc-list">${list.map(rowHTML).join('') || '<p class="muted">No products yet.</p>'}</div>
      <button type="button" class="btn" id="pc-add" style="margin-top:8px" ${list.length >= 8 ? 'disabled' : ''}>${icon('plus')}Add product <span lang="ms">/ Tambah produk</span></button>
      <div class="field" style="margin-top:12px"><label>Departments that take part</label><div style="display:flex;gap:14px;flex-wrap:wrap">${depts.map((d) => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-pc-dept="${esc(d.id)}" ${(c.depts || []).includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div></div>
      ${noDept.length ? `<p class="lock-banner" role="note" style="margin-top:10px">${noDept.length} ${noDept.length === 1 ? 'person has' : 'people have'} no department and ${noDept.length === 1 ? 'is' : 'are'} left out: ${esc(noDept.slice(0, 6).map((e) => ctx.fullName(e)).join(', '))}${noDept.length > 6 ? '…' : ''}. Set their department so they share the pool.</p>` : ''}
      <p class="faint" style="font-size:12.5px;margin-top:6px">Up to 8 products. A rate change applies to days saved afterwards; each saved day keeps its rates. A product that has been used can be switched off but not deleted, so history stays correct. In payroll the commission counts as wages for EPF, SOCSO, EIS and PCB. It isn’t part of the HRD levy (HRD Corp exempts commissions and production incentives).</p></div>`;
  }
  const setProducts = (list, what) => { cfg().products = list; ctx.commit('Production commission settings saved', `Production commission settings changed (${what})`); };
  function bindSettings() {
    const el = ctx.$('#prod-settings'); if (!el) return;
    const rowOf = (n) => n.closest('[data-pc-row]'), mutate = (n, f, what) => setProducts(prods().map((p) => (p.id === rowOf(n).dataset.pcRow ? f({ ...p }) : p)), what);
    ctx.$$('[data-pc]').forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.pc, v = inp.value.trim();
      if (k === 'rate' && v && P.rateUnits(v) == null) { ctx.toast('The rate is a number with up to 4 decimals, for example 0.05.', 'error'); ctx.render(); return; }
      if (k === 'name' && !v) { ctx.toast('A product needs a name.', 'error'); ctx.render(); return; }
      mutate(inp, (p) => { p[k] = k === 'unit' ? v.slice(0, 20) : v; return p; }, `${k} of ${v || 'product'}`);
    }));
    ctx.$$('[data-pc-on]').forEach((b) => b.addEventListener('click', () => mutate(b, (p) => { p.on = b.dataset.pcOn === 'on'; return p; }, 'on/off')));
    ctx.$$('[data-pc-move]').forEach((b) => b.addEventListener('click', () => {
      const list = prods().slice(), i = list.findIndex((p) => p.id === rowOf(b).dataset.pcRow), j = i + Number(b.dataset.pcMove);
      if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; setProducts(list, 'order');
    }));
    ctx.$$('[data-pc-del]').forEach((b) => b.addEventListener('click', () => {
      const id = rowOf(b).dataset.pcRow; if (P.productUsed(id, days())) { ctx.toast('This product has been used. Switch it off instead.', 'error'); return; }
      setProducts(prods().filter((p) => p.id !== id), 'product deleted');
    }));
    ctx.$('#pc-add')?.addEventListener('click', () => setProducts([...prods(), { id: U.uid('pp'), name: `Product ${prods().length + 1}`, unit: 'pcs', rate: '', on: true }], 'product added'));
    ctx.$$('[data-pc-dept]').forEach((cb) => cb.addEventListener('change', () => { const s = new Set(cfg().depts || []); if (cb.checked) s.add(cb.dataset.pcDept); else s.delete(cb.dataset.pcDept); cfg().depts = [...s]; ctx.commit('Production commission settings saved', 'Production commission settings changed (departments)'); }));
  }
  // The dashboard card: active products not yet filled for today (and yesterday, if people shared that day).
  function fillCard() {
    if (!canEntry() || !configured()) return '';
    const hadWork = (d) => !!days()[d] || Object.values(st().attendance?.[d] || {}).some((r) => r && (r.s === 'present' || r.s === 'remote') && r.in);
    const todo = P.toFill({ products: prods(), days: days(), today: T(), hadWork });
    if (!todo.length) return '';
    const label = (d) => (d === T() ? 'Today / Hari ini' : 'Yesterday / Semalam');
    return `<div class="card" id="prod-fill"><div class="card-head"><h3>Production to fill <span lang="ms" class="faint">/ Pengeluaran perlu diisi</span></h3><span class="hint">${todo.reduce((n, x) => n + x.products.length, 0)} open</span></div>
      <div class="list">${todo.map((x) => `<a class="list-item pf-row" href="#production" data-act="prod-day" data-v="${x.date}"><div class="grow"><div class="person-name">${esc(label(x.date))}</div><div class="person-sub">${x.products.map((p) => esc(p.name)).join(', ')}</div></div><span class="pill warn">${x.products.length}</span></a>`).join('')}</div></div>`;
  }

  // ---------- Payroll ----------
  // One earning line per person for the month: the sum of their daily shares, with the number of days.
  function forPayroll(e, mk) {
    if (!on()) return [];
    const t = P.monthTotals(days(), mk)[e.id];
    if (!t || !t.sen) return [];
    const by = Object.values(P.monthByProduct(days(), mk, e.id)).filter((x) => x.sen > 0).map((x) => `${x.name} ${rm(x.sen)}`);
    return [{ key: 'prod', label: NAME, amount: t.sen / 100, epf: true, socso: true, tax: true, hrd: false, detail: `${t.days} day${t.days === 1 ? '' : 's'}${by.length > 1 || (by.length === 1 && by[0].split(' RM')[0] !== 'Production') ? ' · ' + by.join(' · ') : ''}` }];
  }
  function warnings(mk) {
    const attByDay = {}; Object.keys(st().attendance || {}).forEach((d) => { if (P.MONTH(d) === mk) attByDay[d] = st().attendance[d]; });
    return P.monthWarnings({ month: mk, days: days(), employees: allEmps(), attByDay, leaves: approvedLeaves(), settings: cfg(), isWorkday: (d) => !U.isWeekend(d) });
  }
  const lockMonth = (mk) => { store().locks[mk] = true; if (ctx.cloud() && ctx.fire()?.prodLock) ctx.fire().prodLock(mk).catch(() => {}); };
  function payrollBanner(mk) {
    if (!on() || !ctx.can('payroll')) return '';
    const w = warnings(mk); if (!w.missing.length && !w.changed.length) return '';
    return `<p class="lock-banner" role="note" style="margin-bottom:12px"><b>Production commission:</b> ${w.missing.length ? `${w.missing.length} day${w.missing.length > 1 ? 's' : ''} with check-ins but no production entered (${esc(w.missing.slice(0, 4).map((d) => fmtD(d, { day: 'numeric', month: 'short' })).join(', '))}${w.missing.length > 4 ? '…' : ''}). ` : ''}${w.changed.length ? `${w.changed.length} day${w.changed.length > 1 ? 's' : ''} where attendance changed since saving (${esc(w.changed.slice(0, 4).map((d) => fmtD(d, { day: 'numeric', month: 'short' })).join(', '))}). ` : ''}<a href="#production">Open Production</a></p>`;
  }

  // ---------- Staff: their own ----------
  // A person's days for a month: from the saved days (admins, the demo) or from their own share records (the cloud).
  function mine(empId, month) {
    const out = [];
    const d = days();
    if (Object.keys(d).length) {
      Object.keys(d).filter((x) => P.MONTH(x) === month).sort().forEach((x) => {
        const y = d[x], inDay = (y.attendees || []).includes(empId), ex = (y.excluded || []).find((z) => z.id === empId);
        if (inDay) out.push({ date: x, status: 'paid', shareSen: y.shareSen, units: summary(y), unit: '', count: y.count, reason: '' });
        else if (ex) out.push({ date: x, status: 'missed', shareSen: 0, units: summary(y), unit: '', count: y.count, reason: ex.reason });
      });
    } else {
      Object.values(st().prodShares || {}).filter((x) => x.empId === empId && P.MONTH(x.date) === month).sort((a, b) => a.date.localeCompare(b.date)).forEach((x) => out.push(x));
    }
    return out;
  }
  const inScheme = (e) => on() && !!e && (cfg().depts || []).includes(e.dept);
  const totalOf = (list) => ({ sen: list.reduce((s, x) => s + (x.status === 'paid' ? x.shareSen : 0), 0), days: list.filter((x) => x.status === 'paid').length });
  function homeCard(e) {
    if (!inScheme(e) && !Object.keys(st().prodShares || {}).length) return '';
    const mk = U.monthKey(T()), t = totalOf(mine(e.id, mk));
    return `<div class="card"><div class="card-head"><h3>Production commission</h3><a class="hint" href="#my-production">Details</a></div>
      <div class="kpi"><div class="kpi-value">${rm(t.sen)}</div><div class="kpi-foot">${esc(U.fmtMonth(mk))} · ${t.days} day${t.days === 1 ? '' : 's'}</div></div></div>`;
  }
  function myView() {
    const e = ctx.me(); if (!e || !on()) return '<div class="empty"><strong>Not available</strong></div>';
    const mk = ui.month || U.monthKey(T()), list = mine(e.id, mk), t = totalOf(list);
    const rows = list.slice().reverse().map((x) => `<tr><td>${esc(fmtD(x.date))}</td><td class="num">${esc(P.fmtUnits(x.units, x.unit))}</td><td class="num">${x.count}</td>
      <td class="num">${x.status === 'paid' ? `<b>${rm(x.shareSen)}</b>` : '—'}</td><td>${x.status === 'paid' ? '<span class="pill ok">Shared</span>' : `<span class="pill">${esc(x.reason || 'Not shared')}</span>`}</td></tr>`).join('');
    return `<div class="page-head"><div><h1>Production commission</h1><p class="sub">Komisen pengeluaran. Your share of each day’s pool, added to your pay at month end.</p></div>
        <div class="actions"><button class="btn btn-icon" data-act="myprod-month" data-v="-1" aria-label="Previous month">${icon('left')}</button><span class="pill">${esc(U.fmtMonth(mk))}</span><button class="btn btn-icon" data-act="myprod-month" data-v="1" aria-label="Next month" ${mk >= U.monthKey(T()) ? 'disabled' : ''}>${icon('right')}</button></div></div>
      <div class="grid g-4 keep-2" style="margin-bottom:12px"><div class="card kpi"><div class="kpi-label">This month</div><div class="kpi-value">${rm(t.sen)}</div><div class="kpi-foot">${t.days} day${t.days === 1 ? '' : 's'}</div></div></div>
      <div class="card card-flush"><div class="table-wrap"><table><thead><tr><thNone>Day<span lang="ms" class="th-ms">Hari</span></th><thNone>Total made<span lang="ms" class="th-ms">Jumlah dibuat</span></th><thNone>Shared by<span lang="ms" class="th-ms">Dikongsi oleh</span></th><thNone>Your share<span lang="ms" class="th-ms">Bahagian anda</span></th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No days yet this month.</td></tr>'}</tbody></table></div></div>
      <p class="faint" style="font-size:12.5px;margin-top:8px">You see only your own share, the day’s total and how many people shared it.</p>`;
  }

  // ---------- CSV (payroll area) ----------
  function csv(month) {
    const t = P.monthTotals(days(), month), rows = Object.entries(t).map(([id, v]) => { const e = ctx.emp(id); return [ctx.fullName(e) || id, ctx.dept(e?.dept)?.name || '', v.days, (v.sen / 100).toFixed(2)]; });
    ctx.downloadCSV(`production-commission-${month}.csv`, [['Name', 'Department', 'Days', 'Commission (RM)'], ...rows, [], ['Total', '', '', (Object.values(t).reduce((s, v) => s + v.sen, 0) / 100).toFixed(2)]]);
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.production = view; ctx.AFTER.production = after;
    ctx.VIEWS['my-production'] = myView;
    Object.assign(ctx.ACTIONS, {
      'prod-day': (_, v) => { ui.day = v; ui.vals = null; ui.note = ''; window.scrollTo(0, 0); ctx.render(); },
      'prod-shift': (_, v) => { ui.day = +v === 0 ? T() : U.addDays(ui.day || T(), +v); if (ui.day > T()) ui.day = T(); ui.vals = null; ui.note = ''; ctx.render(); },
      'prod-month': (_, v) => { ui.day = U.addMonths(monthOfDay(), +v) + '-01'; if (ui.day > T()) ui.day = T(); ui.vals = null; ui.note = ''; ctx.render(); },
      'prod-recalc': (_, v) => saveDay(v, null, days()[v]?.note),
      'prod-csv': (_, v) => csv(v),
      'myprod-month': (_, v) => { ui.month = U.addMonths(ui.month || U.monthKey(T()), +v); ctx.render(); },
    });
    // Finalising payroll: warn about days that need a look, then lock the month's production days.
    const approve = ctx.ACTIONS['pay-approve'];
    ctx.ACTIONS['pay-approve'] = (...a) => {
      const mk = ctx.payMonth();
      if (on()) {
        const w = warnings(mk), n = w.missing.length + w.changed.length;
        const go = () => { approve(...a); lockMonth(mk); ctx.save(); ctx.render(); };
        if (n && !ui.confirmed) { ctx.openModal({ title: 'Production commission needs a look', size: 'sm', submit: 'Finalise anyway', body: `<p>${w.missing.length ? `${w.missing.length} day(s) have check-ins but no production entered. ` : ''}${w.changed.length ? `${w.changed.length} day(s) changed since they were saved. ` : ''}Finalising locks this month’s production days.</p>`, onSubmit: () => { setTimeout(go, 0); } }); return; }
        go(); return;
      }
      approve(...a);
    };
    return { on, canEntry, canSettings, settingsCard, bindSettings, fillCard, products: prods, forPayroll, payrollBanner, homeCard, inScheme, mine, totalOf, plan, warnings, days, isLocked, lockMonth, showStaff: () => on() && (inScheme(ctx.me()) || Object.keys(st().prodShares || {}).length > 0) };
  }
  return { install };
})();
