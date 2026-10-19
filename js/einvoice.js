// e-Invoice screens: the company's e-Invoice details (Settings), customers and suppliers with their TIN, ID and
// address, the e-Invoice panel on invoices and notes (check, JSON, submit, cancel), and self-billed bills. The
// rules live in js/einvoice-rules.js; submission goes through the stub in js/myinvois.js.
window.AllurusEInvoice = (function () {
  'use strict';
  const E = window.AllurusEInvoiceRules;
  let ctx = null;
  const st = () => ctx.state;
  const fin = () => ctx.state.finance;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const T = () => U.today();
  const cfg = () => (st().settings.einvoice = st().settings.einvoice || blankCompany(st().settings));
  const contacts = () => (fin().contacts = fin().contacts || []);
  const nowISO = () => new Date().toISOString();
  const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const ui = { kind: 'customer', q: '' };

  // ---------- Company ----------
  // Defaults for a company without e-Invoice details, taken from what Allurus already knows.
  function blankCompany(s = {}) {
    const er = s.employer || {}, m = /(\d{5})\s+([^,]+)/.exec(er.address || '');
    const state = Object.entries(E.STATES).find(([, n]) => (er.address || '').includes(n))?.[0] || '';
    return { tin: '', brn: (er.ssm || '').split(' ')[0] || '', sst: 'NA', ttx: '', msic: '', activity: '', phone: er.phone || '', email: '', env: 'sandbox',
      address: { line1: (er.address || '').split(',')[0] || '', line2: '', line3: '', city: m ? m[2].trim() : '', postcode: m ? m[1] : '', state, country: 'MYS' } };
  }
  const companyParty = () => { const c = cfg(); return { name: st().settings.company, tin: c.tin, idType: 'BRN', idNo: c.brn, sst: c.sst, ttx: c.ttx, msic: c.msic, activity: c.activity, email: c.email, phone: c.phone, address: c.address }; };
  const companyProblems = () => E.partyProblems(companyParty(), 'supplier');

  // ---------- Contacts ----------
  const contactOf = (rec) => contacts().find((c) => c.id === rec.contactId) || contacts().find((c) => c.name === (rec.customer || rec.supplier));
  const contactReady = (c) => !E.partyProblems(c, c.kind === 'supplier' ? 'supplier-lite' : 'buyer').length;
  const asParty = (c, fallback) => (c ? { name: c.name, tin: c.tin, idType: c.idType, idNo: c.idNo, sst: c.sst, email: c.email, phone: c.phone, address: c.address, msic: c.msic, activity: c.activity } : fallback);

  // ---------- Documents ----------
  function inputFor(inv) {
    const original = inv.ref ? fin().invoices.find((x) => x.id === inv.ref) : null;
    return E.fromInvoice(inv, { company: companyParty(), contact: asParty(contactOf(inv), { name: inv.customer, email: inv.email }), original, currency: st().settings.currency || 'MYR' });
  }
  function inputForBill(b) {
    const c = contactOf(b);
    // A self-billed supplier is often a person without an MSIC code; MyInvois uses 00000 (not applicable) for them.
    const sup = asParty(c, { name: b.supplier });
    return E.fromBill(b, { company: companyParty(), contact: { ...sup, msic: sup.msic || '00000', activity: sup.activity || 'NOT APPLICABLE' }, currency: st().settings.currency || 'MYR' });
  }
  const PILLS = { Draft: '', Submitted: 'info', Valid: 'ok', Rejected: 'bad', Cancelled: 'warn' };
  const pill = (e) => { const s = e?.status || 'Draft'; return `<span class="pill ${PILLS[s] || ''}" title="e-Invoice ${s.toLowerCase()}">${s === 'Draft' ? 'Not submitted' : s}${e?.simulated ? '<span class="sr-only"> (demo)</span>' : ''}</span>`; };

  function panelHtml(rec, kind) {
    const e = rec.einvoice || { status: 'Draft' }, input = kind === 'bill' ? inputForBill(rec) : inputFor(rec);
    const problems = E.validate(input, T()), can = E.canCancel(e, nowISO()), id = rec.id;
    const link = e.uuid ? E.validationLink(e.uuid, e.longId, cfg().env) : '';
    const typeName = E.TYPES[input.type]?.name || 'Invoice';
    return `<div class="einv-panel" aria-label="e-Invoice">
      <div class="einv-head"><div><strong>e-Invoice</strong> <span class="faint">${esc(typeName)} · type ${E.TYPES[input.type]?.code || ''}</span></div>${pill(e)}${e.simulated ? '<span class="tag">Demo</span>' : ''}</div>
      ${e.status === 'Draft' ? `<p class="faint">${problems.length ? `${problems.length} detail${problems.length === 1 ? ' is' : 's are'} missing before this can be submitted.` : 'Ready to submit to MyInvois.'}</p>` : ''}
      ${e.uuid || e.submissionUid ? `<dl class="kv einv-kv">${e.uuid ? `<dt>UUID</dt><dd class="num">${esc(e.uuid)}</dd>` : ''}${e.submissionUid ? `<dt>Submission</dt><dd class="num">${esc(e.submissionUid)}</dd>` : ''}<dt>Submitted</dt><dd>${fmtDT(e.submittedAt)}</dd>${e.validatedAt ? `<dt>Validated</dt><dd>${fmtDT(e.validatedAt)}</dd>` : ''}${link ? `<dt>Validation link</dt><dd><span class="einv-link" title="Placeholder until connected to MyInvois">${esc(link)}</span></dd>` : ''}${e.cancelledAt ? `<dt>Cancelled</dt><dd>${fmtDT(e.cancelledAt)}${e.reason ? `: ${esc(e.reason)}` : ''}</dd>` : ''}</dl>` : ''}
      ${e.status === 'Valid' ? `<p class="faint">${can.ok ? `Can be cancelled until ${fmtDT(can.deadline)} (${Math.floor(can.hoursLeft)} h left). After that, issue a credit note.` : esc(can.reason)}</p>` : ''}
      ${e.status === 'Rejected' && e.errors?.length ? `<ul class="einv-errors">${e.errors.map((x) => `<li><span class="tag bad">${esc(x.code || 'Error')}</span> ${esc(x.message)}</li>`).join('')}</ul>` : ''}
      ${ctx.role() === 'auditor' ? '' : `<div class="row-actions einv-actions"><button type="button" class="btn btn-sm" data-act="einv-check" data-id="${id}" data-v="${kind}">${icon('check')}Check and view JSON</button>
        ${e.status === 'Draft' ? `<button type="button" class="btn btn-sm btn-primary" data-act="einv-submit" data-id="${id}" data-v="${kind}">Submit to MyInvois</button>` : ''}
        ${e.status === 'Rejected' ? `<button type="button" class="btn btn-sm" data-act="einv-redo" data-id="${id}" data-v="${kind}">Fix and resubmit</button>` : ''}
        ${e.status === 'Valid' && can.ok ? `<button type="button" class="btn btn-sm btn-ghost" data-act="einv-cancel" data-id="${id}" data-v="${kind}">Cancel e-Invoice</button>` : ''}</div>`}</div>`;
  }
  const recOf = (id, kind) => (kind === 'bill' ? fin().bills.find((b) => b.id === id) : fin().invoices.find((i) => i.id === id));
  const reopen = (id, kind) => setTimeout(() => (kind === 'bill' ? billView(id) : ctx.ACTIONS['fin-view-inv'](id)), 60);

  function check(id, kind) {
    const rec = recOf(id, kind), input = kind === 'bill' ? inputForBill(rec) : inputFor(rec);
    const problems = E.validate(input, T()), warns = E.warnings(input, T()), doc = E.build(input), json = JSON.stringify(doc, null, 2);
    const bySection = problems.reduce((m, p) => { (m[p.section] = m[p.section] || []).push(p); return m; }, {});
    const fix = (sec) => (sec === 'Supplier' && kind !== 'bill') || (sec === 'Buyer' && kind === 'bill') ? '<button type="button" class="link-btn" data-act="einv-company">Edit company details</button>' : (sec === 'Buyer' || sec === 'Supplier') ? `<button type="button" class="link-btn" data-act="einv-contact-for" data-id="${id}" data-v="${kind}">Edit ${sec === 'Buyer' ? 'customer' : 'supplier'}</button>` : '';
    ctx.openModal({
      title: `e-Invoice check · ${rec.no || rec.selfNo || rec.ref}`, size: 'lg', submit: null,
      body: `${problems.length ? `<div class="lock-banner warn">${icon('x')}<span>${problems.length} mandatory field${problems.length === 1 ? ' is' : 's are'} missing or wrong. Fix ${problems.length === 1 ? 'it' : 'them'} before submitting.</span></div>` : `<div class="lock-banner">${icon('check')}<span>All mandatory fields are filled in. This document is ready to submit.</span></div>`}
        ${Object.entries(bySection).map(([sec, ps]) => `<div class="einv-sec"><div class="einv-sec-head"><h4 class="lv-h" style="margin:0">${esc(sec)}</h4>${fix(sec)}</div><ul class="einv-list">${ps.map((p) => `<li><strong>${esc(p.label)}</strong><span class="faint">${esc(p.message)}</span></li>`).join('')}</ul></div>`).join('')}
        ${warns.length ? `<h4 class="lv-h">Worth checking</h4><ul class="einv-list">${warns.map((w) => `<li><strong>${esc(w.label)}</strong><span class="faint">${esc(w.message)}</span></li>`).join('')}</ul>` : ''}
        <details class="einv-json"><summary>MyInvois document (JSON, ${Math.round(json.length / 1024 * 10) / 10} KB)</summary><pre tabindex="0">${esc(json)}</pre></details>
        <div class="ci-actions" style="justify-content:space-between"><span class="faint" style="font-size:12.5px">Built to the MyInvois JSON (UBL 2.1) structure. Check the codes against the LHDN SDK before going live.</span><button type="button" class="btn btn-sm" data-act="einv-json" data-id="${id}" data-v="${kind}">${icon('download')}Download JSON</button></div>`,
    });
  }
  async function submit(id, kind) {
    const rec = recOf(id, kind), input = kind === 'bill' ? inputForBill(rec) : inputFor(rec);
    if (E.validate(input, T()).length) { check(id, kind); return; }
    if (input.original && !input.original.uuid) { ctx.toast('Submit the original invoice first, so the note can refer to its UUID', 'error'); return; }
    const doc = E.build(input);
    const r = await AllurusMyInvois.submitToMyInvois(doc, { codeNumber: input.no });
    if (r.connected === false) {
      ctx.openModal({
        title: 'Not connected to MyInvois yet', size: 'sm', submit: null,
        body: `<p>${esc(r.message)}</p><p class="muted">The document is built and checked. In this demo you can simulate LHDN’s answer to try the statuses; nothing is sent to LHDN.</p>
          <div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn" data-act="einv-sim" data-id="${id}" data-v="${kind}:bad">Simulate rejected</button><button type="button" class="btn btn-primary" data-act="einv-sim" data-id="${id}" data-v="${kind}:ok">Simulate valid</button></div>`,
      });
      return;
    }
    apply(rec, r);
    ctx.closeOverlay(); ctx.commit(r.ok ? `Submitted to MyInvois: ${r.status}` : 'MyInvois did not accept the document');
    reopen(id, kind);
  }
  function apply(rec, r) {
    const prev = rec.einvoice || {};
    rec.einvoice = { status: r.status || 'Submitted', uuid: r.uuid || '', longId: r.longId || '', submissionUid: r.submissionUid || '', submittedAt: r.submittedAt || nowISO(), validatedAt: r.validatedAt || '', errors: r.errors || [], simulated: !!r.simulated, history: [...(prev.history || []), ...(prev.status && prev.status !== 'Draft' ? [{ status: prev.status, at: prev.submittedAt, errors: prev.errors }] : [])] };
  }
  function cancel(id, kind) {
    const rec = recOf(id, kind), can = E.canCancel(rec.einvoice, nowISO());
    if (!can.ok) { ctx.toast(can.reason, 'error'); return; }
    ctx.openModal({
      title: 'Cancel this e-Invoice?', size: 'sm', submit: 'Cancel e-Invoice',
      body: `<p class="muted">MyInvois allows cancelling within 72 hours of validation (until ${fmtDT(can.deadline)}). The buyer is told, and the invoice keeps its number. To change the amount instead, issue a credit or debit note.</p><div class="field"><label for="ec-r">Reason</label><input class="input" id="ec-r" name="reason" required placeholder="Wrong customer TIN"></div>`,
      async onSubmit(d) {
        const r = await AllurusMyInvois.cancelOnMyInvois(rec.einvoice.uuid, d.reason.trim());
        Object.assign(rec.einvoice, { status: 'Cancelled', cancelledAt: nowISO(), reason: d.reason.trim(), simulated: rec.einvoice.simulated || r.connected === false });
        ctx.commit('e-Invoice cancelled', `e-Invoice for ${rec.no || rec.selfNo} cancelled: ${d.reason.trim()}`);
        reopen(id, kind);
      },
    });
  }
  function billView(id) {
    const b = fin().bills.find((x) => x.id === id); if (!b) return;
    const c = contactOf(b);
    ctx.openModal({
      title: `Self-billed e-Invoice · ${b.selfNo || b.ref}`, size: 'lg', submit: null,
      body: `<p class="muted">For self-billed purchases the company issues the e-Invoice on the supplier’s behalf. On the document the supplier is <strong>${esc(b.supplier)}</strong> and the buyer is <strong>${esc(st().settings.company)}</strong>.</p>
        <dl class="kv"><dt>Supplier</dt><dd>${esc(b.supplier)}${c ? ` · ${esc(c.idType)} ${esc(c.idNo || '—')} · TIN ${esc(c.tin || '—')}` : ' · <span class="faint">not in Customers & suppliers yet</span>'}</dd><dt>For</dt><dd>${esc(b.note || b.category)}</dd><dt>Bill date</dt><dd>${U.fmtDate(b.issue)}</dd><dt>Amount</dt><dd class="num">${ctx.money(b.amount + b.tax, 2)}</dd></dl>
        ${panelHtml(b, 'bill')}`,
    });
  }

  // ---------- Contacts page ----------
  function contactsView() {
    const q = ui.q.toLowerCase(), all = contacts().filter((c) => c.kind === ui.kind);
    const list = all.filter((c) => !q || `${c.name} ${c.tin} ${c.idNo} ${c.email}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    const role = ui.kind === 'supplier' ? 'supplier-lite' : 'buyer';
    const missing = all.filter((c) => E.partyProblems(c, role).length);
    return `<div class="page-head"><div><div class="eyebrow">Finance & Accounting</div><h1>Customers and suppliers</h1><p class="sub">The details every e-Invoice needs: TIN, registration or ID number, address and contact.</p></div>
        <div class="actions">${ctx.role() === 'auditor' ? '' : `<button class="btn btn-primary" data-act="einv-contact" data-id="" data-v="${ui.kind}">${icon('plus')}Add ${ui.kind}</button>`}</div></div>
      <div class="seg" role="tablist" aria-label="Contacts">${[['customer', 'Customers'], ['supplier', 'Suppliers']].map(([k, l]) => `<button role="tab" data-act="einv-kind" data-v="${k}" class="${ui.kind === k ? 'on' : ''}" aria-selected="${ui.kind === k}">${l} <span class="faint">${contacts().filter((c) => c.kind === k).length}</span></button>`).join('')}</div>
      ${missing.length ? `<div class="lock-banner warn">${icon('help')}<span>${missing.length} ${ui.kind}${missing.length === 1 ? ' is' : 's are'} missing e-Invoice details: ${esc(missing.slice(0, 4).map((c) => c.name).join(', '))}${missing.length > 4 ? '…' : ''}</span></div>` : ''}
      <div class="card card-flush"><div class="toolbar"><label class="sr-only" for="ct-q">Search</label><input class="input" id="ct-q" type="search" placeholder="Search name, TIN, ID or email" value="${esc(ui.q)}" style="flex:1;min-width:200px"></div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>TIN</th><th class="hide-sm">ID</th><th class="hide-sm">City</th><th class="hide-sm">Email</th><th>e-Invoice</th><th></th></tr></thead><tbody>
        ${list.map((c) => { const p = E.partyProblems(c, role); return `<tr class="clickable" data-act="einv-contact" data-id="${c.id}" data-v="${c.kind}"><td><strong>${esc(c.name)}</strong>${c.contactName ? `<div class="person-sub">${esc(c.contactName)}</div>` : ''}</td><td class="num">${esc(c.tin || '—')}</td><td class="hide-sm num">${c.idNo ? `${esc(c.idType)} ${esc(c.idNo)}` : '—'}</td><td class="hide-sm">${esc(c.address?.city || '—')}</td><td class="hide-sm muted">${esc(c.email || '—')}</td>
          <td>${p.length ? `<span class="pill warn" title="${esc(p.map((x) => x.label).join(', '))}">${p.length} missing</span>` : '<span class="pill ok">Ready</span>'}</td><td><div class="row-actions"><button class="btn btn-sm btn-icon btn-ghost" data-act="einv-contact" data-id="${c.id}" data-v="${c.kind}" aria-label="Edit ${esc(c.name)}">${icon('edit')}</button></div></td></tr>`; }).join('')}</tbody></table>
        ${list.length ? '' : `<div class="empty"><strong>No ${ui.kind}s yet</strong>Add one, or they are added when you save an invoice or bill.</div>`}</div></div>`;
  }
  const addressFields = (a = {}, pre) => `<div class="field full"><label for="${pre}-l1">Address line 1</label><input class="input" id="${pre}-l1" name="line1" value="${esc(a.line1 || '')}" placeholder="Lot 7, Jalan Kampung Tengah"></div>
    <div class="field full"><label for="${pre}-l2">Address line 2 (optional)</label><input class="input" id="${pre}-l2" name="line2" value="${esc(a.line2 || '')}"></div>
    <div class="field"><label for="${pre}-pc">Postcode</label><input class="input num" id="${pre}-pc" name="postcode" value="${esc(a.postcode || '')}" inputmode="numeric" maxlength="10"></div>
    <div class="field"><label for="${pre}-city">City</label><input class="input" id="${pre}-city" name="city" value="${esc(a.city || '')}"></div>
    <div class="field"><label for="${pre}-st">State</label><select class="select" id="${pre}-st" name="state"><option value="">Choose</option>${Object.entries(E.STATES).map(([k, n]) => `<option value="${k}" ${a.state === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="field"><label for="${pre}-co">Country</label><select class="select" id="${pre}-co" name="country">${[['MYS', 'Malaysia'], ['SGP', 'Singapore'], ['IDN', 'Indonesia'], ['THA', 'Thailand'], ['GBR', 'United Kingdom'], ['USA', 'United States'], ['AUS', 'Australia'], ['CHN', 'China'], ['IND', 'India'], ['ARE', 'United Arab Emirates']].map(([k, n]) => `<option value="${k}" ${(a.country || 'MYS') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  const readAddress = (d) => ({ line1: d.line1.trim(), line2: (d.line2 || '').trim(), line3: '', postcode: d.postcode.trim(), city: d.city.trim(), state: d.state, country: d.country || 'MYS' });
  function showErrors(form, list, prefix) {
    ctx.$$('.field-error', form).forEach((x) => x.remove());
    ctx.$$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    list.forEach((p) => { const el = form.querySelector(`[name="${p.field.replace(/^address\./, '')}"]`) || form.querySelector(`#${prefix}-${p.field}`); if (!el) return; el.setAttribute('aria-invalid', 'true'); el.closest('.field')?.insertAdjacentHTML('beforeend', `<span class="field-error">${icon('x')}${esc(p.message)}</span>`); });
  }
  function contactForm(id, kind, after) {
    const c = id ? contacts().find((x) => x.id === id) : { kind, idType: 'BRN', sst: 'NA', address: { country: 'MYS' } };
    const role = c.kind === 'supplier' ? 'supplier-lite' : 'buyer';
    ctx.openModal({
      title: id ? `Edit ${c.name}` : `New ${kind}`, size: 'lg', submit: id ? 'Save' : `Add ${kind}`,
      body: `<div class="form-grid"><div class="field full"><label for="ct-name">Registered name</label><input class="input" id="ct-name" name="name" required value="${esc(c.name || '')}" placeholder="As registered with SSM, or the person’s full name"></div>
        <div class="field"><label for="ct-tin">TIN</label><input class="input num" id="ct-tin" name="tin" value="${esc(c.tin || '')}" placeholder="C25845632000"><span class="field-hint">Foreign ${c.kind === 'supplier' ? 'supplier' : 'buyer'}: ${c.kind === 'supplier' ? E.GENERAL_TIN.foreignSupplier : E.GENERAL_TIN.foreignBuyer}. Public buyer: ${E.GENERAL_TIN.publicBuyer}.</span></div>
        <div class="field"><label for="ct-idt">ID type</label><select class="select" id="ct-idt" name="idType">${Object.entries(E.ID_TYPES).map(([k, n]) => `<option value="${k}" ${c.idType === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="field"><label for="ct-idno">ID number</label><input class="input num" id="ct-idno" name="idNo" value="${esc(c.idNo || '')}" placeholder="202101023456"></div>
        <div class="field"><label for="ct-sst">SST number</label><input class="input num" id="ct-sst" name="sst" value="${esc(c.sst || 'NA')}"><span class="field-hint">NA if not registered.</span></div>
        ${c.kind === 'supplier' ? `<div class="field"><label for="ct-msic">MSIC code (optional)</label><input class="input num" id="ct-msic" name="msic" value="${esc(c.msic || '')}" maxlength="5" placeholder="00000 for individuals"></div><div class="field"><label for="ct-act">Business activity (optional)</label><input class="input" id="ct-act" name="activity" value="${esc(c.activity || '')}"></div>` : ''}
        <div class="field full form-sep"><span class="eyebrow">Address</span></div>${addressFields(c.address || {}, 'ct')}
        <div class="field full form-sep"><span class="eyebrow">Contact</span></div>
        <div class="field"><label for="ct-cn">Contact person</label><input class="input" id="ct-cn" name="contactName" value="${esc(c.contactName || '')}"></div>
        <div class="field"><label for="ct-ph">Phone</label><input class="input" id="ct-ph" name="phone" value="${esc(c.phone || '')}" placeholder="+60 9-859 2210"></div>
        <div class="field full"><label for="ct-em">Email</label><input class="input" id="ct-em" name="email" type="email" value="${esc(c.email || '')}"><span class="field-hint">Where the validated e-Invoice link goes.</span></div></div>
        ${id ? `<div class="ci-actions" style="justify-content:flex-start"><button type="button" class="btn btn-sm btn-ghost" data-act="einv-contact-del" data-id="${id}">${icon('trash')}Remove</button></div>` : ''}`,
      onSubmit(d) {
        const x = { kind: c.kind, name: d.name.trim(), tin: d.tin.trim().toUpperCase().replace(/\s/g, ''), idType: d.idType, idNo: d.idNo.trim(), sst: d.sst.trim() || 'NA', msic: (d.msic || '').trim(), activity: (d.activity || '').trim(), contactName: d.contactName.trim(), phone: d.phone.trim(), email: d.email.trim(), address: readAddress(d) };
        // Wrong formats block saving; missing details are allowed but flagged for e-Invoice.
        const bad = E.partyProblems(x, role).filter((p) => p.message !== 'Missing' && !/^Missing|^Choose/.test(p.message));
        if (bad.length) { showErrors(ctx.$('#overlay-root form'), bad, 'ct'); ctx.toast(`${bad[0].label}: ${bad[0].message}`, 'error'); return false; }
        if (contacts().some((y) => y.id !== id && y.kind === x.kind && y.name.toLowerCase() === x.name.toLowerCase())) { ctx.toast(`There is already a ${x.kind} called ${x.name}`, 'error'); return false; }
        let saved;
        if (id) { const old = c.name; Object.assign(c, x); saved = c; if (old !== x.name) [...fin().invoices.filter((i) => i.contactId === id), ...fin().bills.filter((b) => b.contactId === id)].forEach((r) => { if (r.customer) r.customer = x.name; else r.supplier = x.name; }); }
        else { saved = { id: U.uid('ct'), ...x }; contacts().push(saved); }
        const left = E.partyProblems(saved, role).length;
        ctx.commit(left ? `${x.name} saved; ${left} e-Invoice detail${left === 1 ? '' : 's'} still missing` : `${x.name} saved, ready for e-Invoice`);
        if (after) setTimeout(after, 60);
      },
    });
  }
  // ---------- Settings ----------
  function settingsCard() {
    const c = cfg(), p = companyProblems();
    const f = (k, label, hint = '', ph = '') => `<div class="field"><label for="ei-${k}">${label}</label><input class="input" id="ei-${k}" data-ei="${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}">${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
    return `<div class="card" id="einv-company"><div class="card-head"><h3>e-Invoice (MyInvois)</h3>${p.length ? `<span class="pill warn">${p.length} missing</span>` : '<span class="pill ok">Ready</span>'}</div>
      <p class="muted" style="margin-bottom:12px">Your company’s details as the supplier on every e-Invoice. Allurus builds and checks the documents; sending them to LHDN needs a server connection (not set up yet).</p>
      <div class="form-grid">${f('tin', 'TIN', 'From MyTax, for example C25845632000.', 'C25845632000')}${f('brn', 'BRN / SSM number', 'New-format registration number.', '202101023456')}
        ${f('sst', 'SST registration number', 'NA if not registered.', 'W10-1808-32000123')}${f('ttx', 'Tourism tax number (optional)', 'NA if not registered.')}
        ${f('msic', 'MSIC code', '5 digits, from your SSM business code.', '62010')}${f('activity', 'Business activity description', '', 'Computer programming activities')}
        ${f('phone', 'Phone', '', '+60 9-859 2210')}${f('email', 'Email for e-Invoices', '', 'finance@allurus.com')}
        <div class="field full form-sep"><span class="eyebrow">Registered address</span></div>${addressFields(c.address || {}, 'eia').replace(/name="/g, 'data-eia="')}
        <div class="field"><label for="ei-env">MyInvois environment</label><select class="select" id="ei-env" data-ei="env"><option value="sandbox" ${c.env !== 'production' ? 'selected' : ''}>Sandbox (pre-production)</option><option value="production" ${c.env === 'production' ? 'selected' : ''}>Production</option></select></div></div>
      ${p.length ? `<p class="faint" style="margin-top:10px">Still needed: ${esc(p.map((x) => x.label).join(', '))}.</p>` : ''}
      <p class="disclaimer">${icon('pin')}<span>Codes (document types, states, tax types, classifications) follow the LHDN MyInvois SDK as built in; check them at sdk.myinvois.hasil.gov.my before going live.</span></p></div>`;
  }
  function bindSettings() {
    ctx.$$('[data-ei]').forEach((el) => el.addEventListener('change', () => { const k = el.dataset.ei; cfg()[k] = ['tin', 'brn'].includes(k) ? el.value.trim().toUpperCase().replace(/\s/g, '') : el.value.trim(); ctx.commit('e-Invoice details saved'); }));
    ctx.$$('[data-eia]').forEach((el) => el.addEventListener('change', () => { cfg().address = { ...(cfg().address || {}), [el.dataset.eia]: el.value.trim() }; ctx.commit('Address saved'); }));
  }

  // ---------- Insights ----------
  function insights() {
    if (ctx.role() !== 'admin' || !fin()) return [];
    const out = [], p = companyProblems();
    const waiting = fin().invoices.filter((i) => i.status !== 'Draft' && (i.einvoice?.status || 'Draft') === 'Draft');
    const rejected = [...fin().invoices, ...fin().bills].filter((x) => x.einvoice?.status === 'Rejected');
    if (p.length) out.push({ tone: 'warn', icon: 'doc', title: 'Finish your e-Invoice company details', detail: p.slice(0, 3).map((x) => x.label).join(', '), action: { label: 'Settings', act: 'einv-company' }, prio: 1 });
    if (rejected.length) out.push({ tone: 'bad', icon: 'doc', title: `${rejected.length} e-Invoice${rejected.length === 1 ? ' was' : 's were'} rejected`, detail: rejected.slice(0, 3).map((x) => x.no || x.selfNo).join(', '), action: { label: 'Open', act: rejected[0].no ? 'fin-view-inv' : 'einv-bill', id: rejected[0].id }, prio: 2 });
    if (waiting.length) out.push({ tone: 'info', icon: 'doc', title: `${waiting.length} sent invoice${waiting.length === 1 ? ' is' : 's are'} not submitted as e-Invoice`, detail: waiting.slice(0, 3).map((x) => x.no).join(', '), action: { label: 'Invoices', href: '#invoices' }, prio: 1 });
    return out;
  }

  function install(c) {
    ctx = c;
    ctx.VIEWS.contacts = contactsView;
    ctx.AFTER.contacts = () => { const q = ctx.$('#ct-q'); q?.addEventListener('input', () => { ui.q = q.value; const pos = q.selectionStart; ctx.render(); const n = ctx.$('#ct-q'); n.focus(); n.setSelectionRange(pos, pos); }); };
    Object.assign(ctx.ACTIONS, {
      'einv-check': (id, v) => check(id, v),
      'einv-submit': (id, v) => submit(id, v),
      'einv-sim': (id, v) => { const [kind, how] = v.split(':'), rec = recOf(id, kind); apply(rec, AllurusMyInvois.simulate({ valid: how === 'ok', seed: rec.no || rec.selfNo || id })); ctx.closeOverlay(); ctx.commit(how === 'ok' ? 'Simulated: e-Invoice valid' : 'Simulated: e-Invoice rejected', `${rec.no || rec.selfNo} e-Invoice ${how === 'ok' ? 'validated' : 'rejected'} (demo simulation)`); reopen(id, kind); },
      'einv-redo': (id, v) => { const rec = recOf(id, v); rec.einvoice = { status: 'Draft', history: [...(rec.einvoice.history || []), { status: 'Rejected', at: rec.einvoice.submittedAt, errors: rec.einvoice.errors }] }; ctx.closeOverlay(); ctx.commit('Back to draft. Fix the details and submit again.'); reopen(id, v); },
      'einv-cancel': (id, v) => cancel(id, v),
      'einv-json': (id, v) => { const rec = recOf(id, v), input = v === 'bill' ? inputForBill(rec) : inputFor(rec); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(E.build(input), null, 2)], { type: 'application/json' })); a.download = `${input.no}.json`; document.body.appendChild(a); a.click(); a.remove(); ctx.toast(`${input.no}.json downloaded`); },
      'einv-bill': (id) => billView(id),
      'einv-kind': (_, v) => { ui.kind = v; ctx.render(); },
      'einv-contact': (id, v) => contactForm(id, v),
      'einv-contact-for': (id, v) => { const rec = recOf(id, v), cc = contactOf(rec); contactForm(cc?.id || '', v === 'bill' ? 'supplier' : 'customer', () => { if (!cc) { const made = contacts().find((x) => x.name === (rec.customer || rec.supplier)); if (made) rec.contactId = made.id; } check(id, v); }); if (!cc) { const n = ctx.$('#ct-name'); if (n) n.value = rec.customer || rec.supplier; } },
      'einv-contact-del': (id) => { const cc = contacts().find((x) => x.id === id); fin().contacts = contacts().filter((x) => x.id !== id); [...fin().invoices, ...fin().bills].forEach((r) => { if (r.contactId === id) r.contactId = ''; }); ctx.closeOverlay(); ctx.commit(`${cc.name} removed`); },
      'einv-company': () => { location.hash = 'settings'; setTimeout(() => ctx.$('#einv-company')?.scrollIntoView({ block: 'start' }), 80); },
    });
    return { pill, panel: (inv) => panelHtml(inv, 'invoice'), contactReady, settingsCard, bindSettings, insights, inputFor, inputForBill, companyProblems };
  }
  return { install, blankCompany };
})();
