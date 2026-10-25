// Operations: for a company that makes, sells and delivers a product. Stock & purchasing (raw materials, packaging
// and purchase orders that become vendor bills), production (batches against a recipe, QC hold and release,
// finished goods by batch), sales & delivery (sales orders, delivery orders picked oldest expiry first, the driver's
// phone view, invoices on delivery) and machines (preventive maintenance, breakdowns reported from a phone, company
// licences). The rules are in js/ops-rules.js (AllurusOpsRules). Only shown for a workspace with `state.ops`.
window.AllurusOps = (function () {
  'use strict';
  const O = window.AllurusOpsRules;
  let ctx = null;
  const st = () => ctx.state;
  const ops = () => st().ops;
  const has = () => !!st().ops;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const money = (n) => ctx.money(n);
  const T = () => U.today();
  const fmt = (d, o = { day: 'numeric', month: 'short' }) => (d ? U.fmtDate(d.slice(0, 10), o) : '—');
  const can = () => !!window.AllurusAccess?.can('operations');
  // A storekeeper, technician or sales executive may see only their part of Operations (account.opsScope).
  const scope = () => ctx.account()?.opsScope || null;
  const inScope = (tab) => !scope() || scope().includes(tab);
  const actor = () => ctx.account()?.empId || ctx.me()?.id || '';
  const fin = () => st().finance;
  const contact = (id) => fin().contacts.find((c) => c.id === id);
  const item = (id) => ops().items.find((x) => x.id === id);
  const prod = (id) => ops().products.find((x) => x.id === id);
  const machine = (id) => ops().machines.find((x) => x.id === id);
  const emp = (id) => ctx.emp(id);
  const first = (id) => emp(id)?.first || '—';
  const levels = () => O.stockLevels(ops().items, ops().moves, ops().pos);
  const qty = (n, unit) => `${(Math.round(n * 100) / 100).toLocaleString('en-MY')}${unit ? ` ${unit}` : ''}`;
  const termDays = (c) => parseInt(c?.terms, 10) || (c?.terms === 'COD' ? 0 : 30);
  const nextNo = (prefix) => { const d = T(), k = `${prefix}${d.slice(2, 4)}${d.slice(5, 7)}`; ops().seq = ops().seq || {}; ops().seq[k] = (ops().seq[k] || 0) + 1; return `${prefix}-${d.slice(2, 4)}${d.slice(5, 7)}-${String(ops().seq[k]).padStart(3, '0')}`; };
  const notify = (type, data, to, opts) => ctx.notify?.event(type, data, to, opts);
  // People who look after operations: accounts with the operations area (or the owner), as employee ids.
  const opsPeople = () => st().accounts.filter((a) => a.roles.includes('admin') && (!Array.isArray(a.perms) || a.perms.includes('operations')) && !a.opsScope).map((a) => a.empId).filter(Boolean);
  const technicians = () => ctx.activeEmployees().filter((e) => e.dept === 'd-maint' || /technician/i.test(e.role));
  const drivers = () => ctx.activeEmployees().filter((e) => /driver|delivery/i.test(e.role));
  const PILL = { Draft: '', Approved: 'info', Sent: 'info', Partial: 'warn', Received: 'ok', Billed: 'ok', Planned: '', 'In progress': 'info', Done: 'ok', Pass: 'ok', Hold: 'bad', Rejected: 'bad', Pending: 'warn', Out: 'info', Delivered: 'ok', Failed: 'bad', Open: 'info', Running: 'ok', Down: 'bad', Reported: 'bad', Assigned: 'warn', 'Waiting for part': 'warn', Fixed: 'ok', OK: 'ok', Due: 'warn', Overdue: 'bad' };
  const pill = (s, label) => `<span class="pill ${PILL[s] ?? ''}">${esc(label || s)}</span>`;
  const ui = { stockTab: 'stock', prodTab: 'batches', salesTab: 'deliveries', machTab: 'machines', day: '' };
  const tabs = (key, list, act) => `<div class="seg rc-tabs" role="tablist">${list.map(([k, l]) => `<button role="tab" data-act="${act}" data-v="${k}" class="${ui[key] === k ? 'on' : ''}" aria-selected="${ui[key] === k}">${l}</button>`).join('')}</div>`;
  const head = (title, sub, actions = '') => `<div class="page-head"><div><div class="eyebrow">Operations</div><h1>${title}</h1><p class="sub">${sub}</p></div><div class="actions">${actions}</div></div>`;
  const empty = (t, d) => `<div class="empty"><strong>${t}</strong>${d}</div>`;

  // ---------- Finance links ----------
  function billFrom({ vendorId, amount, note, ref, category, extra = {} }) {
    const c = contact(vendorId);
    const b = { id: U.uid('b'), supplier: c?.name || vendorId, contactId: vendorId, ref, category: category || c?.category || 'Raw materials', issue: T(), due: U.addDays(T(), termDays(c)), amount: O.r2(amount), tax: 0, status: 'Unpaid', paidOn: '', note, ...extra };
    fin().bills.push(b);
    return b;
  }
  // Invoice numbers run on across months (INV-YYMM-0001), after the highest number already used.
  const invNo = () => { const n = Math.max(0, ...fin().invoices.map((i) => +(/^INV-\d{4}-(\d+)$/.exec(i.no || '') || [])[1] || 0)) + 1; return `INV-${T().slice(2, 4)}${T().slice(5, 7)}-${String(n).padStart(4, '0')}`; };
  function invoiceFromDO(d, so) {
    const c = contact(so.clientId);
    const inv = { id: U.uid('i'), no: invNo(), customer: c?.name || so.clientId, contactId: so.clientId, email: c?.email || '', issue: T(), due: so.terms === 'COD' ? T() : U.addDays(T(), 30), items: so.lines.map((l) => ({ desc: prod(l.productId)?.name || l.productId, qty: l.qty, price: l.price, classification: '022' })), taxRate: 0, status: 'Sent', paidOn: '', type: 'invoice', category: 'Product sales', doId: d.id, soId: so.id, einvoice: { status: 'Draft' } };
    fin().invoices.push(inv);
    return inv;
  }
  const soTotal = (so) => O.r2(so.lines.reduce((s, l) => s + l.qty * l.price, 0));

  // ---------- Stock & purchasing ----------
  function stockView() {
    const lv = levels(), low = lv.filter((x) => x.low), open = ops().pos.filter((p) => ['Draft', 'Approved', 'Sent', 'Partial'].includes(p.status));
    const value = lv.reduce((s, x) => s + x.onHand * (x.lastPrice || 0), 0);
    return `${head('Stock &amp; purchasing', `${low.length} item${low.length === 1 ? '' : 's'} below reorder level · ${open.filter((p) => ['Sent', 'Partial'].includes(p.status)).length} orders waiting for delivery · stock worth ${money(value)}`, can() ? `<button class="btn btn-primary" data-act="ops-po-new">${icon('plus')}New purchase order</button>` : '')}
      ${tabs('stockTab', [['stock', 'Stock'], ['pos', `Purchase orders${open.length ? ` (${open.length})` : ''}`], ['moves', 'Stock movements']], 'ops-stock-tab')}
      ${ui.stockTab === 'pos' ? poTable() : ui.stockTab === 'moves' ? movesTable() : stockTable(lv)}`;
  }
  function stockTable(lv) {
    const row = (x) => `<tr class="clickable ${x.low ? 'ops-low' : ''}" data-act="ops-item" data-id="${x.id}"><td><strong>${esc(x.name)}</strong><div class="person-sub">${esc(x.code)} · ${x.kind === 'raw' ? 'Raw material' : 'Packaging'}</div></td>
      <td class="r num"><strong>${qty(x.onHand)}</strong> <span class="faint">${esc(x.unit)}</span>${x.low ? `<div>${pill('Overdue', 'Below reorder')}</div>${can() && !x.onOrder ? `<button class="btn btn-sm btn-primary" style="margin-top:6px" data-act="ops-po-new" data-id="${x.id}">Make PO</button>` : ''}` : ''}</td><td class="r num hide-sm">${qty(x.reorder)}</td>
      <td class="r num hide-sm">${x.onOrder ? qty(x.onOrder) : '—'}</td><td class="hide-sm">${esc(contact(x.vendorId)?.name || '—')}</td><td class="r num hide-sm">${money(x.lastPrice)}</td>
</tr>`;
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Item</th><th class="r">On hand</th><th class="r hide-sm">Reorder at</th><th class="r hide-sm">On order</th><th class="hide-sm">Usual vendor</th><th class="r hide-sm">Last price</th></tr></thead>
      <tbody>${[...lv].sort((a, b) => b.low - a.low || a.code.localeCompare(b.code)).map(row).join('')}</tbody></table></div></div>`;
  }
  function poTable() {
    const list = [...ops().pos].sort((a, b) => (b.date + b.no).localeCompare(a.date + a.no));
    const act = (p) => {
      if (!can()) return '';
      if (p.status === 'Draft') return `<button class="btn btn-sm btn-primary" data-act="ops-po-approve" data-id="${p.id}">Approve</button>`;
      if (p.status === 'Approved') return `<button class="btn btn-sm" data-act="ops-po-send" data-id="${p.id}">Mark sent</button>`;
      if (['Sent', 'Partial'].includes(p.status)) return `<button class="btn btn-sm btn-primary" data-act="ops-po-receive" data-id="${p.id}">Receive</button>`;
      if (p.status === 'Received') return `<button class="btn btn-sm btn-primary" data-act="ops-po-bill" data-id="${p.id}">Create bill</button>`;
      return p.billId ? `<a class="btn btn-sm btn-ghost" href="#bills">Bill</a>` : '';
    };
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>PO</th><th class="hide-sm">Vendor</th><th>Status</th><th class="r">Total</th><th class="hide-sm">Expected</th><th></th></tr></thead><tbody>
      ${list.map((p) => { const got = O.poReceivedValue(p), tot = O.poTotal(p); return `<tr class="clickable" data-act="ops-po-open" data-id="${p.id}"><td><strong>${esc(p.no)}</strong><div class="person-sub">${fmt(p.date)} · ${p.lines.map((l) => esc(item(l.itemId)?.name || '')).join(', ')}</div></td><td class="hide-sm">${esc(contact(p.vendorId)?.name || '')}</td>
        <td>${pill(p.status)}${p.status === 'Partial' ? `<div class="person-sub">${Math.round((got / tot) * 100)}% received</div>` : ''}</td><td class="r num">${money(tot)}</td><td class="hide-sm">${['Sent', 'Partial', 'Approved'].includes(p.status) ? `${fmt(p.expected)}${p.expected < T() ? ` ${pill('Overdue', 'Late')}` : ''}` : '—'}</td><td><div class="row-actions">${act(p)}</div></td></tr>`; }).join('')}</tbody></table>
      ${list.length ? '' : empty('No purchase orders', 'Make one from an item below its reorder level.')}</div></div>`;
  }
  function movesTable() {
    const list = [...ops().moves].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
    return `<div class="card card-flush"><div class="card-head" style="padding-bottom:10px"><h3>Latest stock movements</h3><span class="hint">In from deliveries, out to production</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th class="r">Qty</th><th class="hide-sm">Reference</th></tr></thead><tbody>
      ${list.map((m) => { const it = item(m.itemId); return `<tr><td class="num">${fmt(m.date)}</td><td>${esc(it?.name || '')}<div class="person-sub">${esc(m.note || '')}</div></td><td class="r num" style="color:${m.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${qty(m.qty)} ${esc(it?.unit || '')}</td><td class="hide-sm faint">${esc(m.ref || '')}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  function itemModal(id) {
    const x = levels().find((l) => l.id === id), moves = ops().moves.filter((m) => m.itemId === id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
    ctx.openModal({
      title: x.name, submit: can() ? 'Save count' : null,
      body: `<div class="grid g-3 keep-2"><div class="card kpi"><div class="kpi-label">On hand</div><div class="kpi-value">${qty(x.onHand)}</div><div class="kpi-foot">${esc(x.unit)}</div></div><div class="card kpi"><div class="kpi-label">Reorder at</div><div class="kpi-value">${qty(x.reorder)}</div></div><div class="card kpi"><div class="kpi-label">On order</div><div class="kpi-value">${qty(x.onOrder)}</div></div></div>
        <h4 class="lv-h">Recent movements</h4><ul class="hr-list">${moves.map((m) => `<li><div><strong>${m.qty > 0 ? '+' : ''}${qty(m.qty)} ${esc(x.unit)}</strong><div class="person-sub">${fmt(m.date)} · ${esc(m.note || '')} ${esc(m.ref || '')}</div></div></li>`).join('') || '<li class="faint">None yet</li>'}</ul>
        ${can() ? `<div class="form-grid" style="margin-top:12px"><div class="field"><label for="it-count">Stock count (${esc(x.unit)})</label><input class="input num" id="it-count" name="count" type="number" min="0" step="0.1" value="${x.onHand}"></div><div class="field"><label for="it-reorder">Reorder level</label><input class="input num" id="it-reorder" name="reorder" type="number" min="0" step="1" value="${x.reorder}"></div></div><p class="faint">A different count records a stock adjustment with your name.</p>` : ''}`,
      onSubmit(d) {
        const it = item(id), diff = O.r2((Number(d.count) || 0) - x.onHand);
        if (diff) ops().moves.push({ id: U.uid('mv'), itemId: id, date: T(), qty: diff, ref: 'COUNT', note: `Stock count by ${first(actor())}` });
        it.reorder = Math.max(0, Number(d.reorder) || 0);
        ctx.commit(diff ? `Stock of ${it.name} adjusted by ${diff > 0 ? '+' : ''}${qty(diff)} ${it.unit}` : 'Saved', diff ? `Stock count: ${it.name} ${diff > 0 ? '+' : ''}${qty(diff)} ${it.unit}` : '');
      },
    });
  }
  const lineRow = (l = {}) => `<div class="ops-line"><select class="select" data-f="itemId" aria-label="Item">${ops().items.map((i) => `<option value="${i.id}" ${l.itemId === i.id ? 'selected' : ''}>${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select><input class="input num" data-f="qty" type="number" min="0" step="1" value="${l.qty || ''}" aria-label="Quantity" placeholder="Qty"><input class="input num" data-f="price" type="number" min="0" step="0.01" value="${l.price ?? ''}" aria-label="Unit price (RM)" placeholder="RM"><button type="button" class="btn btn-sm btn-icon btn-ghost" data-ops-del aria-label="Remove line">${icon('trash')}</button></div>`;
  function poModal(itemId) {
    const lv = itemId ? levels().find((x) => x.id === itemId) : null;
    const vendorId = lv?.vendorId || fin().contacts.find((c) => c.kind === 'supplier' && ['Raw materials', 'Packaging'].includes(c.category))?.id;
    const start = lv ? [{ itemId, qty: Math.max(O.suggestQty(lv), Math.ceil(3 * lv.reorder - lv.onHand - lv.onOrder)), price: lv.lastPrice }] : [{}];
    ctx.openModal({
      title: 'New purchase order', size: 'lg', submit: 'Save for approval',
      body: `<div class="form-grid"><div class="field"><label for="po-v">Vendor</label><select class="select" id="po-v" name="vendorId">${fin().contacts.filter((c) => c.kind === 'supplier' && ['Raw materials', 'Packaging'].includes(c.category)).map((c) => `<option value="${c.id}" ${c.id === vendorId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="po-exp">Expected delivery</label><input class="input" id="po-exp" name="expected" type="date" value="${U.addDays(T(), 4)}"></div>
        <div class="field full"><span class="label-like">Items</span><div id="po-lines" class="ops-lines">${start.map(lineRow).join('')}</div><button type="button" class="btn btn-sm" id="po-add" style="margin-top:6px">${icon('plus')}Add line</button></div></div>
        <p class="faint" id="po-total"></p><p class="faint">Someone other than you approves it before it is sent.</p>`,
      onSubmit(d) {
        const lines = ctx.$$('#po-lines .ops-line').map((r) => ({ itemId: r.querySelector('[data-f=itemId]').value, qty: Number(r.querySelector('[data-f=qty]').value) || 0, price: Number(r.querySelector('[data-f=price]').value) || 0, received: 0 })).filter((l) => l.qty > 0);
        if (!lines.length) { ctx.toast('Add at least one line with a quantity', 'error'); return false; }
        const p = { id: U.uid('po'), no: nextNo('PO'), vendorId: d.vendorId, date: T(), expected: d.expected || U.addDays(T(), 4), status: 'Draft', lines, by: actor(), approvedBy: '', billId: '' };
        ops().pos.push(p);
        const total = money(O.poTotal(p));
        opsPeople().filter((id) => id !== actor()).forEach((id) => notify('ops.po', { no: p.no, vendor: contact(p.vendorId)?.name || '', total, who: ctx.fullName(emp(actor())), href: '#ops-stock' }, id, { from: actor() }));
        ui.stockTab = 'pos';
        ctx.commit(`${p.no} saved, waiting for approval`, `Purchase order ${p.no} raised (${total})`);
      },
    });
    const box = ctx.$('#po-lines'), total = () => { const t = ctx.$$('#po-lines .ops-line').reduce((s, r) => s + (Number(r.querySelector('[data-f=qty]').value) || 0) * (Number(r.querySelector('[data-f=price]').value) || 0), 0); ctx.$('#po-total').textContent = `Total ${money(t)}`; };
    ctx.$('#po-add').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', lineRow({})); total(); });
    box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-ops-del]'); if (b && box.children.length > 1) { b.closest('.ops-line').remove(); total(); } });
    box.addEventListener('change', (ev) => { if (ev.target.dataset.f === 'itemId') ev.target.closest('.ops-line').querySelector('[data-f=price]').value = item(ev.target.value)?.lastPrice ?? ''; total(); });
    box.addEventListener('input', total); total();
  }
  function poOpen(id) {
    const p = ops().pos.find((x) => x.id === id);
    ctx.openModal({
      title: `${p.no} · ${contact(p.vendorId)?.name || ''}`, submit: null,
      body: `<div style="margin-bottom:10px">${pill(p.status)} <span class="faint">Raised ${fmt(p.date)} by ${esc(first(p.by))}${p.approvedBy ? ` · approved by ${esc(first(p.approvedBy))}` : ''}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Item</th><th class="r">Ordered</th><th class="r">Received</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${p.lines.map((l) => { const it = item(l.itemId); return `<tr><td>${esc(it?.name || '')}</td><td class="r num">${qty(l.qty, it?.unit)}</td><td class="r num">${qty(l.received || 0)}</td><td class="r num">${money(l.price)}</td><td class="r num">${money(l.qty * l.price)}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="r" style="margin-top:8px"><strong>Total ${money(O.poTotal(p))}</strong></p>${p.note ? `<p class="faint">${esc(p.note)}</p>` : ''}
        ${p.status === 'Draft' && can() ? `<div class="ci-actions" style="justify-content:flex-end"><button type="button" class="btn btn-danger" data-act="ops-po-del" data-id="${p.id}">Delete draft</button><button type="button" class="btn btn-primary" data-act="ops-po-approve" data-id="${p.id}">${icon('check')}Approve</button></div>` : ''}`,
    });
  }
  function receiveModal(id) {
    const p = ops().pos.find((x) => x.id === id);
    ctx.openModal({
      title: `Receive ${p.no}`, submit: 'Receive into stock',
      body: `<p class="muted">Count what arrived. Anything still due stays on the order.</p><div class="form-grid">${p.lines.map((l, i) => { const it = item(l.itemId), due = Math.max(0, l.qty - (l.received || 0)); return `<div class="field"><label for="rc-${i}">${esc(it.name)} <span class="faint">(${qty(due)} ${esc(it.unit)} due)</span></label><input class="input num" id="rc-${i}" name="q${i}" type="number" min="0" max="${due}" step="1" value="${due}"></div>`; }).join('')}</div>
        <label class="check field" style="margin-top:8px"><input type="checkbox" name="bill" checked><span>Create the vendor bill in Finance when everything is in</span></label>`,
      onSubmit(d) {
        const got = Object.fromEntries(p.lines.map((l, i) => [l.itemId, Number(d[`q${i}`]) || 0]));
        if (!Object.values(got).some((v) => v > 0)) { ctx.toast('Enter what arrived', 'error'); return false; }
        const res = O.receive(p, got, { date: T(), ids: () => U.uid('mv') });
        Object.assign(p, res.po); ops().moves.push(...res.moves);
        let msg = p.status === 'Received' ? `${p.no} fully received` : `${p.no} partly received`;
        if (p.status === 'Received' && d.bill === 'on') { createBill(p); msg += '; bill added to Finance'; }
        ctx.commit(msg, `Goods received against ${p.no}`);
      },
    });
  }
  function createBill(p) {
    const cat = p.lines.every((l) => item(l.itemId)?.kind === 'pack') ? 'Packaging' : 'Raw materials';
    const b = billFrom({ vendorId: p.vendorId, amount: O.poReceivedValue(p), note: `${p.no}: ${p.lines.map((l) => item(l.itemId)?.name.toLowerCase()).join(', ')}`, ref: p.no, category: cat, extra: { poId: p.id } });
    p.status = 'Billed'; p.billId = b.id;
    p.lines.forEach((l) => { const it = item(l.itemId); if (it) it.lastPrice = l.price; });
    return b;
  }

  // ---------- Production ----------
  function prodView() {
    const b = ops().batches, hold = b.filter((x) => x.qc === 'Hold'), today = b.filter((x) => x.date === T());
    return `${head('Production', `${today.length} batch${today.length === 1 ? '' : 'es'} today${hold.length ? ` · ${hold.length} on QC hold` : ''} · ${b.filter((x) => x.date.slice(0, 7) === T().slice(0, 7) && x.status === 'Done').length} done this month`, can() ? `<button class="btn btn-primary" data-act="ops-batch-new">${icon('plus')}Plan a batch</button>` : '')}
      ${tabs('prodTab', [['batches', 'Batches'], ['fg', 'Finished goods'], ['recipes', 'Products and recipes']], 'ops-prod-tab')}
      ${ui.prodTab === 'fg' ? fgView() : ui.prodTab === 'recipes' ? recipesView() : batchTable()}`;
  }
  function batchTable() {
    const list = [...ops().batches].filter((b) => b.date >= U.addDays(T(), -60)).sort((a, b) => (b.date + b.no).localeCompare(a.date + a.no));
    const act = (b) => {
      if (!can()) return '';
      if (['Planned', 'In progress'].includes(b.status)) return `<button class="btn btn-sm btn-primary" data-act="ops-batch-record" data-id="${b.id}">Record output</button>`;
      if (b.qc === 'Hold') return `<button class="btn btn-sm btn-ok" data-act="ops-batch-qc" data-id="${b.id}" data-v="Pass">Release</button><button class="btn btn-sm" data-act="ops-batch-qc" data-id="${b.id}" data-v="Rejected">Reject</button>`;
      return '';
    };
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Batch</th><th>Product</th><th class="r">Planned</th><th class="r">Actual</th><th class="r hide-sm">Yield</th><th>QC</th><th class="hide-sm">Expiry</th><th></th></tr></thead><tbody>
      ${list.map((b) => { const p = prod(b.productId); return `<tr class="clickable ${b.qc === 'Hold' ? 'ops-low' : ''}" data-act="ops-batch-open" data-id="${b.id}"><td><strong>${esc(b.no)}</strong><div class="person-sub">${fmt(b.date)} · ${b.shift === 'AM' ? 'Morning' : 'Afternoon'}</div></td><td>${esc(p?.name || '')}</td><td class="r num">${b.planned}</td><td class="r num">${b.status === 'Done' ? b.actual : pill(b.status)}</td><td class="r num hide-sm">${b.status === 'Done' ? `${O.yieldPct(b)}%` : '—'}</td>
        <td>${b.status === 'Done' ? pill(b.qc, b.qc === 'Pass' ? 'Released' : b.qc === 'Hold' ? 'On hold' : b.qc) : '<span class="faint">—</span>'}</td><td class="hide-sm">${b.status === 'Done' ? fmt(b.expiry, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td><td><div class="row-actions">${act(b)}</div></td></tr>`; }).join('')}</tbody></table>
      ${list.length ? '' : empty('No batches yet', 'Plan one to start.')}</div></div>`;
  }
  // Average daily sales of a product over the last 30 days, from delivered DOs.
  const sold30 = (productId) => ops().dos.filter((d) => d.status === 'Delivered' && d.date > U.addDays(T(), -30)).reduce((s, d) => s + d.picks.filter((p) => p.productId === productId).reduce((a, p) => a + p.qty, 0), 0);
  function fgView() {
    return `<div class="ops-grid">${ops().products.map((p) => {
      const l = O.lots(ops().batches, ops().dos, p.id, T()), avail = l.reduce((s, x) => s + x.available, 0), hold = l.filter((x) => x.hold).reduce((s, x) => s + x.left, 0), cover = O.daysCover(avail, sold30(p.id));
      return `<div class="card"><div class="card-head"><h3>${esc(p.name)}</h3>${cover != null ? `<span class="pill ${cover < 7 ? 'bad' : cover < 14 ? 'warn' : 'ok'}">${cover} days of sales</span>` : ''}</div>
        <div class="kpi-value" style="font-size:28px">${avail.toLocaleString('en-MY')} <span class="faint" style="font-size:15px">${esc(p.unit)}s ready to sell</span></div>${hold ? `<p class="faint">${hold} more on QC hold</p>` : ''}
        <ul class="hr-list">${l.filter((x) => x.left > 0).map((x) => `<li><div><strong>${esc(x.no)}</strong><div class="person-sub">Expires ${fmt(x.expiry, { day: 'numeric', month: 'short', year: 'numeric' })}</div></div><span class="num">${x.left}${x.hold ? ` ${pill('Hold', 'On hold')}` : x.expired ? ` ${pill('Overdue', 'Expired')}` : ''}</span></li>`).join('') || '<li class="faint">Nothing in stock</li>'}</ul></div>`;
    }).join('')}</div>`;
  }
  function recipesView() {
    return `<div class="ops-grid">${ops().products.map((p) => `<div class="card"><div class="card-head"><h3>${esc(p.name)}</h3><span class="hint">${money(p.price)} a ${esc(p.unit)}</span></div><p class="faint">Per batch of ${p.batchSize} ${esc(p.unit)}s · keeps ${p.shelfDays} days</p>
      <div class="table-wrap"><table><tbody>${p.bom.map((b) => { const it = item(b.itemId); return `<tr><td>${esc(it?.name || '')}</td><td class="r num">${qty(b.qty, it?.unit)}</td><td class="r num faint">${money(b.qty * (it?.lastPrice || 0))}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="faint" style="margin-top:6px">Materials ${money(p.bom.reduce((s, b) => s + b.qty * (item(b.itemId)?.lastPrice || 0), 0) / p.batchSize)} a ${esc(p.unit)} at last prices.</p></div>`).join('')}</div>`;
  }
  function batchNew() {
    ctx.openModal({
      title: 'Plan a batch', submit: 'Plan batch',
      body: `<div class="form-grid"><div class="field full"><label for="bt-p">Product</label><select class="select" id="bt-p" name="productId">${ops().products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="bt-d">Date</label><input class="input" id="bt-d" name="date" type="date" value="${T()}"></div>
        <div class="field"><label for="bt-s">Shift</label><select class="select" id="bt-s" name="shift"><option value="AM">Morning</option><option value="PM">Afternoon</option></select></div>
        <div class="field"><label for="bt-q">Planned output</label><input class="input num" id="bt-q" name="planned" type="number" min="1" step="1"></div></div><div id="bt-check" class="bk-check" role="status"></div>`,
      onSubmit(d) {
        const p = prod(d.productId), planned = Number(d.planned) || p.batchSize;
        ops().batches.push({ id: U.uid('bt'), no: nextNo('B'), date: d.date || T(), shift: d.shift, productId: p.id, planned, actual: 0, reject: 0, operators: [], used: [], qc: 'Pending', qcNote: '', expiry: '', status: 'Planned', machineIds: [] });
        ui.prodTab = 'batches';
        ctx.commit(`Batch of ${p.name} planned`);
      },
    });
    const f = ctx.$('#overlay-root form'), check = () => {
      const p = prod(f.productId.value); if (!f.planned.value) f.planned.placeholder = p.batchSize;
      const short = O.shortfalls(p, Number(f.planned.value) || p.batchSize, levels());
      ctx.$('#bt-check').innerHTML = short.length ? `<div class="bk-bad">${icon('x')}Not enough ${short.map((s) => `${esc(item(s.itemId).name.toLowerCase())} (need ${qty(s.qty)}, have ${qty(s.have)})`).join(', ')}.</div>` : `<div class="bk-ok">${icon('check')}Enough stock for this batch.</div>`;
    };
    f.addEventListener('input', check); f.addEventListener('change', check); check();
  }
  function batchRecord(id) {
    const b = ops().batches.find((x) => x.id === id), p = prod(b.productId);
    const crew = ctx.activeEmployees().filter((e) => e.dept === 'd-prod');
    ctx.openModal({
      title: `Record ${b.no}`, submit: 'Save batch',
      body: `<p class="muted">${esc(p.name)}, planned ${b.planned}. Raw materials are taken off stock using the recipe.</p><div class="form-grid">
        <div class="field"><label for="br-a">Good output</label><input class="input num" id="br-a" name="actual" type="number" min="0" step="1" value="${b.planned}" required></div>
        <div class="field"><label for="br-r">Reject or waste</label><input class="input num" id="br-r" name="reject" type="number" min="0" step="1" value="0"></div>
        <div class="field"><label for="br-q">QC</label><select class="select" id="br-q" name="qc"><option value="Pass">Pass, release for sale</option><option value="Hold">Hold</option></select></div>
        <div class="field full"><label for="br-n">QC note</label><input class="input" id="br-n" name="qcNote" placeholder="Needed for a hold"></div>
        <div class="field full"><span class="label-like">Operators on the shift</span><div class="rc-pick">${crew.map((e) => `<label class="check"><input type="checkbox" data-op value="${e.id}" ${(b.operators || []).includes(e.id) ? 'checked' : ''}><span>${esc(ctx.fullName(e))}</span></label>`).join('')}</div></div></div>`,
      onSubmit(d) {
        const actual = Math.max(0, Math.round(Number(d.actual) || 0)), reject = Math.max(0, Math.round(Number(d.reject) || 0));
        if (d.qc === 'Hold' && !d.qcNote.trim()) { ctx.toast('Say why the batch is on hold', 'error'); return false; }
        const used = O.recipeUsage(p, actual + reject);
        Object.assign(b, { actual, reject, used, qc: d.qc, qcNote: d.qcNote.trim(), qcBy: actor(), expiry: U.addDays(b.date, p.shelfDays), status: 'Done', operators: ctx.$$('[data-op]:checked').map((x) => x.value) });
        used.forEach((u) => ops().moves.push({ id: U.uid('mv'), itemId: u.itemId, date: b.date, qty: -u.qty, ref: b.no, note: 'Used in production' }));
        if (b.qc === 'Hold') opsPeople().forEach((pid) => notify('ops.qc', { no: b.no, note: b.qcNote, href: '#ops-production' }, pid, { from: actor() }));
        ctx.commit(`${b.no}: ${actual} made${b.qc === 'Hold' ? ', on QC hold' : ''}`, `Batch ${b.no} recorded: ${actual} ${p.unit}s of ${p.name}`);
      },
    });
  }
  function batchOpen(id) {
    const b = ops().batches.find((x) => x.id === id), p = prod(b.productId);
    const out = ops().dos.filter((d) => (d.picks || []).some((x) => x.batchId === id));
    ctx.openModal({
      title: `${b.no} · ${p.name}`, submit: null,
      body: `<dl class="kv"><dt>Made</dt><dd>${fmt(b.date, { weekday: 'short', day: 'numeric', month: 'short' })}, ${b.shift === 'AM' ? 'morning' : 'afternoon'} shift</dd><dt>Output</dt><dd>${b.status === 'Done' ? `${b.actual} good, ${b.reject} reject (${O.yieldPct(b)}%)` : esc(b.status)}</dd><dt>QC</dt><dd>${b.status === 'Done' ? `${pill(b.qc)} ${esc(b.qcNote || '')}` : '—'}</dd><dt>Expiry</dt><dd>${b.expiry ? fmt(b.expiry, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</dd><dt>Operators</dt><dd>${(b.operators || []).map((x) => esc(first(x))).join(', ') || '—'}</dd></dl>
        ${b.used?.length ? `<h4 class="lv-h">Materials used</h4><ul class="hr-list">${b.used.map((u) => `<li><span>${esc(item(u.itemId)?.name || '')}</span><span class="num">${qty(u.qty, item(u.itemId)?.unit)}</span></li>`).join('')}</ul>` : ''}
        ${out.length ? `<h4 class="lv-h">Delivered to (traceability)</h4><ul class="hr-list">${out.map((d) => { const so = ops().orders.find((s) => s.id === d.soId); return `<li><span>${esc(contact(so?.clientId)?.name || '')} <span class="faint">${esc(d.no)}, ${fmt(d.date)}</span></span><span class="num">${d.picks.filter((x) => x.batchId === id).reduce((s, x) => s + x.qty, 0)}</span></li>`; }).join('')}</ul>` : ''}`,
    });
  }

  // ---------- Sales & delivery ----------
  const doTotal = (d) => { const so = ops().orders.find((s) => s.id === d.soId); return so ? soTotal(so) : 0; };
  function salesView() {
    const day = ui.day || T(), list = ops().dos.filter((d) => d.date === day);
    const cash = list.reduce((s, d) => s + (d.cash || 0), 0);
    return `${head('Sales &amp; delivery', `${list.length} deliveries on ${fmt(day, { weekday: 'long', day: 'numeric', month: 'short' })}: ${list.filter((d) => d.status === 'Delivered').length} delivered · ${money(cash)} cash collected`, can() ? `<button class="btn btn-primary" data-act="ops-so-new">${icon('plus')}New order</button>` : '')}
      ${tabs('salesTab', [['deliveries', 'Deliveries'], ['orders', 'Sales orders'], ['clients', 'Clients']], 'ops-sales-tab')}
      ${ui.salesTab === 'orders' ? ordersTable() : ui.salesTab === 'clients' ? clientsTable() : deliveriesBoard(day, list)}`;
  }
  function stopCard(d, { mine = false } = {}) {
    const so = ops().orders.find((s) => s.id === d.soId), c = contact(so?.clientId), total = soTotal(so);
    const items = so.lines.map((l) => `${l.qty} × ${esc(prod(l.productId)?.name.replace('Cili Boh ', '') || '')}`).join(', ');
    const batches = [...new Set(d.picks.map((p) => ops().batches.find((b) => b.id === p.batchId)?.no))].join(', ');
    const canAct = mine || can();
    return `<div class="ops-stop ${d.status === 'Delivered' ? 'done' : ''}"><span class="ops-seq">${d.seq}</span><div class="grow">
      <div class="ops-stop-head"><strong>${esc(c?.name || '')}</strong>${pill(d.status)}</div>
      <div class="person-sub">${esc(c?.address?.line1 || '')}, ${esc(c?.address?.city || '')}${c?.phone ? ` · <a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : ''}</div>
      <div style="margin-top:4px">${items}</div><div class="faint" style="font-size:12.5px">${esc(d.no)} · batches ${esc(batches)}</div>
      <div class="ops-stop-foot">${so.terms === 'COD' ? `<span class="tag ${d.status === 'Delivered' ? '' : 'warn'}">COD ${money(total)}${d.cash ? ' collected' : ''}</span>` : `<span class="tag">Credit · ${money(total)}</span>`}
        ${canAct && d.status === 'Planned' ? `<button class="btn btn-sm" data-act="ops-do-out" data-id="${d.id}">Out for delivery</button>` : ''}
        ${canAct && ['Planned', 'Out'].includes(d.status) ? `<button class="btn btn-sm" data-act="ops-do-fail" data-id="${d.id}">Couldn’t deliver</button><button class="btn btn-sm btn-primary" data-act="ops-do-deliver" data-id="${d.id}">${icon('check')}Delivered</button>` : ''}
        ${d.status === 'Delivered' && d.photo ? `<button class="btn btn-sm btn-ghost" data-act="ops-do-photo" data-id="${d.id}">Proof</button>` : ''}</div></div></div>`;
  }
  function deliveriesBoard(day, list) {
    const routes = [...new Set(list.map((d) => d.driverId))];
    return `<div class="rm-bar"><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="ops-day" data-v="-1" aria-label="Previous day">${icon('left')}</button><input class="input" type="date" id="ops-day" value="${day}" aria-label="Day"><button class="btn btn-sm btn-icon" data-act="ops-day" data-v="1" aria-label="Next day">${icon('right')}</button>${day !== T() ? '<button class="btn btn-sm btn-ghost" data-act="ops-day" data-v="0">Today</button>' : ''}</div></div>
      ${routes.length ? `<div class="ops-grid">${routes.map((drv) => { const ds = list.filter((d) => d.driverId === drv).sort((a, b) => a.seq - b.seq), v = machine(ds[0].vehicleId); return `<div class="card"><div class="card-head"><h3>${esc(first(drv))}${ds[0].helperId ? ` + ${esc(first(ds[0].helperId))}` : ''}</h3><span class="hint">${esc(v?.plate || '')}</span></div><p class="faint" style="margin-bottom:10px">${esc(ds[0].route || '')}</p>${ds.map((d) => stopCard(d)).join('')}</div>`; }).join('')}</div>` : `<div class="card">${empty('No deliveries', 'Orders for this day will show here.')}</div>`}`;
  }
  function ordersTable() {
    const list = [...ops().orders].sort((a, b) => (b.date + b.no).localeCompare(a.date + a.no)).slice(0, 60);
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Order</th><th>Client</th><th class="hide-sm">Terms</th><th class="r">Total</th><th>Status</th><th class="hide-sm">Invoice</th></tr></thead><tbody>
      ${list.map((so) => { const d = ops().dos.find((x) => x.id === so.doId), inv = d?.invoiceId && fin().invoices.find((i) => i.id === d.invoiceId); return `<tr><td><strong>${esc(so.no)}</strong><div class="person-sub">${fmt(so.date)}${d ? ` · ${esc(d.no)}` : ''}</div></td><td>${esc(contact(so.clientId)?.name || '')}</td><td class="hide-sm">${esc(so.terms)}</td><td class="r num">${money(soTotal(so))}</td><td>${pill(d?.status || so.status)}</td><td class="hide-sm">${inv ? `${esc(inv.no)} ${pill(inv.status === 'Paid' ? 'Done' : inv.due < T() ? 'Overdue' : 'Open', inv.status === 'Paid' ? 'Paid' : inv.due < T() ? 'Overdue' : 'Unpaid')}` : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  function openInvoices() { return fin().invoices.filter((i) => i.type === 'invoice' && !['Paid', 'Draft'].includes(i.status)).map((i) => ({ client: i.customer, contactId: i.contactId, due: i.due, balance: AllurusFinance.invoiceTotals(i).balance, no: i.no, id: i.id })); }
  function clientsTable() {
    const open = openInvoices();
    const rows = fin().contacts.filter((c) => c.kind === 'customer').map((c) => { const mine = open.filter((i) => i.contactId === c.id), a = O.aging(mine, T()); const last = ops().orders.filter((s) => s.clientId === c.id).map((s) => s.date).sort().pop(); return { c, a, last }; }).sort((x, y) => y.a.total - x.a.total);
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Client</th><th class="hide-sm">Terms</th><th class="r">Owes</th><th class="r">Overdue</th><th class="hide-sm">Last order</th></tr></thead><tbody>
      ${rows.map(({ c, a, last }) => `<tr><td><strong>${esc(c.name)}</strong><div class="person-sub">${esc(c.address?.city || '')}</div></td><td class="hide-sm">${esc(c.terms || '')}</td><td class="r num">${a.total ? money(a.total) : '—'}</td><td class="r num">${a.overdue ? `<span style="color:var(--bad)">${money(a.overdue)}</span>${a.d60p ? `<div class="person-sub">${money(a.d60p)} over 60 days</div>` : ''}` : '—'}</td><td class="hide-sm">${fmt(last)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  const soLine = (l = {}) => `<div class="ops-line"><select class="select" data-f="productId" aria-label="Product">${ops().products.map((p) => `<option value="${p.id}" ${l.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><input class="input num" data-f="qty" type="number" min="1" step="1" value="${l.qty || ''}" aria-label="Quantity" placeholder="Qty"><input class="input num" data-f="price" type="number" min="0" step="0.01" value="${l.price ?? prod(l.productId || ops().products[0].id).price}" aria-label="Unit price (RM)"><button type="button" class="btn btn-sm btn-icon btn-ghost" data-ops-del aria-label="Remove line">${icon('trash')}</button></div>`;
  function soNew() {
    const clients = fin().contacts.filter((c) => c.kind === 'customer'), ds = drivers(), vans = ops().machines.filter((m) => m.kind === 'vehicle');
    ctx.openModal({
      title: 'New sales order', size: 'lg', submit: 'Save and plan delivery',
      body: `<div class="form-grid"><div class="field full"><label for="so-c">Client</label><select class="select" id="so-c" name="clientId">${clients.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.terms || '')}</option>`).join('')}</select></div>
        <div class="field full"><span class="label-like">Products</span><div id="so-lines" class="ops-lines">${soLine({ productId: ops().products[0].id })}</div><button type="button" class="btn btn-sm" id="so-add" style="margin-top:6px">${icon('plus')}Add product</button></div>
        <div class="field"><label for="so-d">Delivery date</label><input class="input" id="so-d" name="date" type="date" min="${T()}" value="${U.addDays(T(), 1)}"></div>
        <div class="field"><label for="so-drv">Driver</label><select class="select" id="so-drv" name="driverId">${ds.filter((e) => /driver/i.test(e.role)).map((e) => `<option value="${e.id}">${esc(ctx.fullName(e))}</option>`).join('')}</select></div>
        <div class="field"><label for="so-v">Vehicle</label><select class="select" id="so-v" name="vehicleId">${vans.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="so-r">Route</label><input class="input" id="so-r" name="route" placeholder="e.g. Route A: Muar town"></div></div><div id="so-check" class="bk-check" role="status"></div>`,
      onSubmit(d) {
        const lines = ctx.$$('#so-lines .ops-line').map((r) => ({ productId: r.querySelector('[data-f=productId]').value, qty: Math.round(Number(r.querySelector('[data-f=qty]').value) || 0), price: Number(r.querySelector('[data-f=price]').value) || 0 })).filter((l) => l.qty > 0);
        if (!lines.length) { ctx.toast('Add at least one product with a quantity', 'error'); return false; }
        const picks = [];
        for (const l of lines) {
          const r = O.pickFEFO(O.lots(ops().batches, ops().dos, l.productId, d.date), l.qty);
          if (r.short) { ctx.toast(`Only ${l.qty - r.short} ${prod(l.productId).unit}s of ${prod(l.productId).name} are ready to sell`, 'error'); return false; }
          r.picks.forEach((p) => picks.push({ productId: l.productId, batchId: p.batchId, qty: p.qty }));
        }
        const c = contact(d.clientId), terms = c?.terms === 'COD' ? 'COD' : 'Credit 30';
        const so = { id: U.uid('so'), no: nextNo('SO'), clientId: d.clientId, date: T(), terms, lines, status: 'Open', doId: '' };
        const seq = ops().dos.filter((x) => x.date === d.date && x.driverId === d.driverId).length + 1;
        const doRec = { id: U.uid('do'), no: nextNo('DO'), soId: so.id, date: d.date, driverId: d.driverId, helperId: '', vehicleId: d.vehicleId, route: d.route.trim(), seq, status: 'Planned', picks, deliveredAt: '', cash: 0, invoiceId: '' };
        so.doId = doRec.id;
        ops().orders.push(so); ops().dos.push(doRec);
        notify('ops.delivery', { count: 1, when: d.date === T() ? 'today' : `on ${U.fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}`, route: `${c?.name || ''}, stop ${seq}`, href: '#my-deliveries' }, d.driverId, { from: actor() });
        ui.salesTab = 'deliveries'; ui.day = d.date;
        ctx.commit(`${so.no} saved; ${doRec.no} planned for ${first(d.driverId)}`, `Order ${so.no} from ${c?.name || ''} (${money(soTotal(so))})`);
      },
    });
    const box = ctx.$('#so-lines'), f = ctx.$('#overlay-root form');
    const check = () => {
      const lines = ctx.$$('#so-lines .ops-line').map((r) => ({ productId: r.querySelector('[data-f=productId]').value, qty: Number(r.querySelector('[data-f=qty]').value) || 0, price: Number(r.querySelector('[data-f=price]').value) || 0 }));
      const short = lines.filter((l) => l.qty).map((l) => ({ l, r: O.pickFEFO(O.lots(ops().batches, ops().dos, l.productId, f.date.value || T()), l.qty) })).filter((x) => x.r.short);
      ctx.$('#so-check').innerHTML = short.length ? `<div class="bk-bad">${icon('x')}${short.map((x) => `Only ${x.l.qty - x.r.short} of ${esc(prod(x.l.productId).name)} ready`).join('. ')}.</div>` : lines.some((l) => l.qty) ? `<div class="bk-ok">${icon('check')}In stock. Total ${money(lines.reduce((s, l) => s + l.qty * l.price, 0))}. Picked oldest expiry first.</div>` : '';
    };
    ctx.$('#so-add').addEventListener('click', () => { box.insertAdjacentHTML('beforeend', soLine({ productId: ops().products[0].id })); check(); });
    box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-ops-del]'); if (b && box.children.length > 1) { b.closest('.ops-line').remove(); check(); } });
    box.addEventListener('change', (ev) => { if (ev.target.dataset.f === 'productId') ev.target.closest('.ops-line').querySelector('[data-f=price]').value = prod(ev.target.value).price; check(); });
    f.addEventListener('input', check);
  }
  function deliverModal(id) {
    const d = ops().dos.find((x) => x.id === id), so = ops().orders.find((s) => s.id === d.soId), total = soTotal(so);
    let photo = null;
    ctx.openModal({
      title: `Delivered: ${contact(so.clientId)?.name || ''}`, submit: 'Confirm delivery',
      body: `<div class="form-grid"><div class="field full"><label for="dv-p">Photo of the goods or signed DO</label><input class="input" id="dv-p" type="file" accept="image/*" capture="environment"><span class="field-hint" id="dv-ph">Optional, but helps if there’s a question later.</span></div>
        <div class="field"><label for="dv-by">Received by</label><input class="input" id="dv-by" name="by" placeholder="Name"></div>
        ${so.terms === 'COD' ? `<div class="field"><label for="dv-cash">Cash collected (RM)</label><input class="input num" id="dv-cash" name="cash" type="number" min="0" step="0.01" value="${total.toFixed(2)}"></div>` : `<p class="faint field full">Credit client: the invoice goes to Finance with 30-day terms.</p>`}</div>`,
      onSubmit(f) {
        const cash = so.terms === 'COD' ? Math.max(0, Number(f.cash) || 0) : 0;
        Object.assign(d, { status: 'Delivered', deliveredAt: new Date().toISOString(), receivedBy: f.by.trim(), cash, photo: photo || d.photo || null, deliveredBy: actor() });
        so.status = 'Delivered';
        const inv = invoiceFromDO(d, so);
        d.invoiceId = inv.id;
        if (cash >= total) {
          inv.status = 'Paid'; inv.paidOn = T();
          fin().txns.push({ id: U.uid('x'), date: T(), desc: `Cash on delivery from ${inv.customer}`, type: 'in', category: 'Product sales', amount: cash, tax: 0, ref: inv.no, source: 'invoice', reconciled: false });
        } else if (cash > 0) {
          inv.adjust = 0; inv.note = `RM ${cash.toFixed(2)} collected on delivery, balance due`;
          fin().txns.push({ id: U.uid('x'), date: T(), desc: `Part payment on delivery from ${inv.customer}`, type: 'in', category: 'Product sales', amount: cash, tax: 0, ref: inv.no, source: 'invoice', reconciled: false });
        }
        ctx.commit(`${d.no} delivered${cash ? `, ${money(cash)} collected` : ''}`, `${d.no} delivered to ${inv.customer}`);
      },
    });
    ctx.$('#dv-p').addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0]; if (!file) return;
      try { photo = (await ctx.leave.readAttachment(file)).data; ctx.$('#dv-ph').textContent = 'Photo added.'; } catch (e) { ctx.toast(e.message, 'error'); }
    });
  }

  // ---------- Machines & maintenance ----------
  function machView() {
    const ms = ops().machines, down = ms.filter((m) => m.status === 'Down'), pm = ms.map((m) => O.pmStatus(m, T()));
    return `${head('Machines &amp; maintenance', `${down.length} down now · ${pm.filter((x) => x.status === 'Due').length} services due this week · ${pm.filter((x) => x.status === 'Overdue').length} overdue`, `<button class="btn btn-primary" data-act="ops-bd-new">${icon('plus')}Report a breakdown</button>`)}
      ${tabs('machTab', [['machines', 'Machines and vehicles'], ['breakdowns', `Breakdowns${ops().breakdowns.filter((b) => b.status !== 'Fixed').length ? ` (${ops().breakdowns.filter((b) => b.status !== 'Fixed').length})` : ''}`], ['licences', 'Licences']], 'ops-mach-tab')}
      ${ui.machTab === 'breakdowns' ? bdTable() : ui.machTab === 'licences' ? licTable() : machTable()}`;
  }
  const expiryPill = (d) => { if (!d) return '—'; const left = O.days(T(), d); return `${fmt(d, { day: 'numeric', month: 'short', year: 'numeric' })}${left < 0 ? ` ${pill('Overdue', 'Expired')}` : left <= 30 ? ` ${pill('Due', `${left} days`)}` : ''}`; };
  function machTable() {
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Machine</th><th>Status</th><th>Next service</th><th class="hide-sm">Last service</th><th class="hide-sm">Hours / mileage</th><th></th></tr></thead><tbody>
      ${ops().machines.map((m) => { const s = O.pmStatus(m, T()); return `<tr class="clickable ${m.status === 'Down' ? 'ops-low' : ''}" data-act="ops-mach-open" data-id="${m.id}"><td><strong>${esc(m.name)}</strong><div class="person-sub">${esc(m.plate ? `Road tax ${fmt(m.roadTax, { day: 'numeric', month: 'short', year: 'numeric' })}` : m.location || '')}</div></td><td>${pill(m.status)}</td>
        <td>${pill(s.status, s.status === 'OK' ? 'On schedule' : s.status)}<div class="person-sub">${s.nextDate ? fmt(s.nextDate) : ''}${s.hoursLeft != null ? `${s.nextDate ? ' or ' : ''}${Math.max(0, Math.round(s.hoursLeft))} h left` : ''}</div></td><td class="hide-sm">${fmt(m.lastPm)}</td><td class="hide-sm num">${m.kind === 'vehicle' ? `${(m.mileage || 0).toLocaleString('en-MY')} km` : m.pmHours ? `${(m.hours || 0).toLocaleString('en-MY')} h` : '—'}</td>
        <td><div class="row-actions">${can() ? `<button class="btn btn-sm" data-act="ops-pm-log" data-id="${m.id}">Log service</button>` : ''}</div></td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  function bdTable(list = ops().breakdowns) {
    const rows = [...list].sort((a, b) => (a.status === 'Fixed') - (b.status === 'Fixed') || b.reportedAt.localeCompare(a.reportedAt));
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Breakdown</th><th>Status</th><th class="hide-sm">Technician</th><th class="r hide-sm">Downtime</th><th></th></tr></thead><tbody>
      ${rows.map((b) => `<tr class="${b.status !== 'Fixed' ? 'ops-low' : ''}"><td><strong>${esc(machine(b.machineId)?.name || '')}</strong><div class="person-sub">${esc(b.no)} · ${fmt(b.reportedAt)} by ${esc(first(b.reportedBy))}: ${esc(b.problem)}</div>${b.notes ? `<div class="faint" style="font-size:12.5px">${esc(b.notes)}</div>` : ''}${b.fix ? `<div class="faint" style="font-size:12.5px">Fix: ${esc(b.fix)}</div>` : ''}</td>
        <td>${pill(b.status)}</td><td class="hide-sm">${esc(first(b.assignee))}</td><td class="r num hide-sm">${b.status === 'Fixed' ? `${b.downtime} h` : `${Math.round((Date.now() - Date.parse(b.reportedAt)) / 36e5)} h so far`}</td>
        <td><div class="row-actions">${b.photo ? `<button class="btn btn-sm btn-ghost" data-act="ops-bd-photo" data-id="${b.id}">Photo</button>` : ''}${b.status !== 'Fixed' && (can() || b.assignee === actor()) ? `<button class="btn btn-sm btn-primary" data-act="ops-bd-fix" data-id="${b.id}">Mark fixed</button>` : ''}</div></td></tr>`).join('')}</tbody></table>
      ${rows.length ? '' : empty('No breakdowns', 'Nice.')}</div></div>`;
  }
  function licTable() {
    const vehicles = ops().machines.filter((m) => m.kind === 'vehicle');
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Licence or certificate</th><th class="hide-sm">Issued by</th><th>Expires</th><th></th></tr></thead><tbody>
      ${ops().licences.map((l) => `<tr><td><strong>${esc(l.name)}</strong><div class="person-sub">${esc(l.no)}</div></td><td class="hide-sm">${esc(l.issuer)}</td><td>${expiryPill(l.expiry)}</td><td><div class="row-actions">${can() ? `<button class="btn btn-sm" data-act="ops-lic-renew" data-id="${l.id}">Renewed</button>` : ''}</div></td></tr>`).join('')}
      ${vehicles.map((v) => `<tr><td><strong>Road tax: ${esc(v.plate)}</strong><div class="person-sub">${esc(v.name)}</div></td><td class="hide-sm">JPJ</td><td>${expiryPill(v.roadTax)}</td><td><div class="row-actions">${can() ? `<button class="btn btn-sm" data-act="ops-lic-renew" data-id="road:${v.id}">Renewed</button>` : ''}</div></td></tr><tr><td><strong>Insurance: ${esc(v.plate)}</strong></td><td class="hide-sm">Insurer</td><td>${expiryPill(v.insurance)}</td><td><div class="row-actions">${can() ? `<button class="btn btn-sm" data-act="ops-lic-renew" data-id="ins:${v.id}">Renewed</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function machOpen(id) {
    const m = machine(id), hist = [...ops().maint.filter((x) => x.machineId === id).map((x) => ({ at: x.date, t: `Service: ${x.notes}`, by: x.by })), ...ops().breakdowns.filter((b) => b.machineId === id).map((b) => ({ at: b.reportedAt.slice(0, 10), t: `Breakdown: ${b.problem}${b.status === 'Fixed' ? ` (fixed, ${b.downtime} h down)` : ` (${b.status.toLowerCase()})`}`, by: b.reportedBy }))].sort((a, b) => b.at.localeCompare(a.at));
    const s = O.pmStatus(m, T());
    ctx.openModal({
      title: m.name, submit: null,
      body: `<dl class="kv"><dt>Status</dt><dd>${pill(m.status)}</dd><dt>Service</dt><dd>${m.pmDays ? `Every ${m.pmDays} days` : ''}${m.pmDays && m.pmHours ? ' or ' : ''}${m.pmHours ? `every ${m.pmHours} running hours` : ''} · next ${pill(s.status, s.status === 'OK' ? 'on schedule' : s.status)}</dd>${m.plate ? `<dt>Road tax</dt><dd>${expiryPill(m.roadTax)}</dd><dt>Insurance</dt><dd>${expiryPill(m.insurance)}</dd><dt>Mileage</dt><dd>${(m.mileage || 0).toLocaleString('en-MY')} km (service every ${(m.serviceKm || 0).toLocaleString('en-MY')} km)</dd>` : ''}<dt>On the asset register</dt><dd><a href="#assets">${esc(m.assetId || '')}</a></dd></dl>
        <h4 class="lv-h">History</h4><ol class="audit-list">${hist.slice(0, 12).map((h) => `<li><div><strong>${fmt(h.at, { day: 'numeric', month: 'short', year: 'numeric' })}</strong> · ${esc(first(h.by))}</div><div>${esc(h.t)}</div></li>`).join('')}</ol>`,
    });
  }
  function pmLog(id) {
    const m = machine(id);
    ctx.openModal({
      title: `Log service: ${m.name}`, submit: 'Save service',
      body: `<div class="form-grid"><div class="field"><label for="pm-d">Date</label><input class="input" id="pm-d" name="date" type="date" max="${T()}" value="${T()}"></div>
        ${m.kind === 'vehicle' ? `<div class="field"><label for="pm-km">Mileage (km)</label><input class="input num" id="pm-km" name="km" type="number" min="0" value="${m.mileage || 0}"></div>` : m.pmHours ? `<div class="field"><label for="pm-h">Running hours</label><input class="input num" id="pm-h" name="hours" type="number" min="0" value="${m.hours || 0}"></div>` : ''}
        <div class="field full"><label for="pm-n">What was done</label><input class="input" id="pm-n" name="notes" required value="${m.kind === 'vehicle' ? 'Service: oil, filters, brakes' : 'Cleaned, lubricated, checked seals and wiring'}"></div>
        <div class="field"><label for="pm-by">Done by</label><select class="select" id="pm-by" name="by">${technicians().map((e) => `<option value="${e.id}">${esc(ctx.fullName(e))}</option>`).join('')}<option value="workshop">Outside workshop</option></select></div>
        <div class="field"><label for="pm-c">Cost (RM)</label><input class="input num" id="pm-c" name="cost" type="number" min="0" step="0.01" value="0"></div></div>`,
      onSubmit(d) {
        ops().maint.push({ id: U.uid('pm'), machineId: id, date: d.date, kind: 'PM', by: d.by, notes: d.notes.trim(), cost: Number(d.cost) || 0 });
        m.lastPm = d.date;
        if (d.hours != null) { m.hours = Number(d.hours) || m.hours; m.lastPmHours = m.hours; }
        if (d.km != null) { m.mileage = Number(d.km) || m.mileage; m.lastServiceKm = m.mileage; }
        if (Number(d.cost) > 0) billFrom({ vendorId: 'v-parts', amount: Number(d.cost), note: `Service: ${m.name}`, ref: `SVC-${T().replace(/-/g, '').slice(2)}`, category: m.kind === 'vehicle' ? 'Fuel and transport' : 'Repairs and maintenance' });
        ctx.commit(`Service logged for ${m.name}`, `${m.name} serviced`);
      },
    });
  }
  function bdNew() {
    let photo = null;
    ctx.openModal({
      title: 'Report a breakdown', submit: 'Send to the technician',
      body: `<div class="form-grid"><div class="field full"><label for="bd-m">Machine</label><select class="select" id="bd-m" name="machineId">${ops().machines.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
        <div class="field full"><label for="bd-p">What’s wrong</label><textarea class="textarea" id="bd-p" name="problem" rows="3" required placeholder="What you saw or heard, and when it started"></textarea></div>
        <div class="field full"><label for="bd-ph">Photo</label><input class="input" id="bd-ph" type="file" accept="image/*" capture="environment"><span class="field-hint" id="bd-phh">Optional.</span></div>
        <label class="check field full"><input type="checkbox" name="stopped" checked><span>The machine has stopped</span></label></div>`,
      onSubmit(d) {
        if (!d.problem.trim()) { ctx.toast('Say what’s wrong', 'error'); return false; }
        const m = machine(d.machineId), tech = technicians()[0];
        const b = { id: U.uid('bk'), no: `BD-${String(ops().breakdowns.length + 1).padStart(3, '0')}`, machineId: m.id, reportedBy: ctx.me()?.id || actor(), reportedAt: new Date().toISOString(), problem: d.problem.trim(), photo, assignee: tech?.id || '', status: tech ? 'Assigned' : 'Reported', fixedAt: '', downtime: 0, parts: [], billId: '' };
        ops().breakdowns.push(b);
        if (d.stopped === 'on') m.status = 'Down';
        const to = [...new Set([tech?.id, ...opsPeople()].filter(Boolean))];
        notify('ops.breakdown', { machine: m.name, who: ctx.fullName(emp(b.reportedBy)) || 'Someone', problem: b.problem, href: '#ops-machines' }, to, { from: b.reportedBy });
        ui.machTab = 'breakdowns';
        ctx.commit(`Sent to ${tech ? first(tech.id) : 'the technician'}. Thank you.`, `Breakdown reported: ${m.name}`);
      },
    });
    ctx.$('#bd-ph').addEventListener('change', async (ev) => { const file = ev.target.files?.[0]; if (!file) return; try { photo = (await ctx.leave.readAttachment(file)).data; ctx.$('#bd-phh').textContent = 'Photo added.'; } catch (e) { ctx.toast(e.message, 'error'); } });
  }
  const partRow = (p = {}) => `<div class="ops-line"><input class="input" data-f="name" placeholder="Part" aria-label="Part" value="${esc(p.name || '')}"><input class="input num" data-f="qty" type="number" min="1" step="1" value="${p.qty || 1}" aria-label="Quantity"><input class="input num" data-f="cost" type="number" min="0" step="0.01" value="${p.cost ?? ''}" aria-label="Cost each (RM)" placeholder="RM each"><button type="button" class="btn btn-sm btn-icon btn-ghost" data-ops-del aria-label="Remove part">${icon('trash')}</button></div>`;
  function bdFix(id) {
    const b = ops().breakdowns.find((x) => x.id === id), m = machine(b.machineId), hours = Math.max(0.5, Math.round(((Date.now() - Date.parse(b.reportedAt)) / 36e5) * 2) / 2);
    ctx.openModal({
      title: `Fixed: ${m.name}`, submit: 'Machine is running',
      body: `<p class="muted">${esc(b.problem)}</p><div class="form-grid"><div class="field full"><label for="fx-n">What you did</label><input class="input" id="fx-n" name="fix" required></div>
        <div class="field"><label for="fx-h">Downtime (hours)</label><input class="input num" id="fx-h" name="hours" type="number" min="0" step="0.5" value="${hours}"></div>
        <div class="field full"><span class="label-like">Parts used</span><div id="fx-parts" class="ops-lines">${(b.parts.length ? b.parts : [{}]).map(partRow).join('')}</div><button type="button" class="btn btn-sm" id="fx-add" style="margin-top:6px">${icon('plus')}Add part</button></div>
        <label class="check field full"><input type="checkbox" name="bill" ${b.parts.some((p) => p.cost) ? 'checked' : ''}><span>Parts bought from the supplier: add their bill to Finance</span></label></div>`,
      onSubmit(d) {
        if (!d.fix.trim()) { ctx.toast('Say what you did', 'error'); return false; }
        b.parts = ctx.$$('#fx-parts .ops-line').map((r) => ({ name: r.querySelector('[data-f=name]').value.trim(), qty: Number(r.querySelector('[data-f=qty]').value) || 1, cost: Number(r.querySelector('[data-f=cost]').value) || 0 })).filter((p) => p.name);
        Object.assign(b, { status: 'Fixed', fix: d.fix.trim(), fixedAt: new Date().toISOString(), downtime: Number(d.hours) || 0, fixedBy: actor() });
        m.status = 'Running';
        const cost = b.parts.reduce((s, p) => s + p.qty * p.cost, 0);
        if (d.bill === 'on' && cost > 0) { const bill = billFrom({ vendorId: 'v-parts', amount: cost, note: `Parts for ${b.no}: ${b.parts.map((p) => p.name).join(', ')}`, ref: `PARTS-${b.no}`, category: 'Repairs and maintenance' }); b.billId = bill.id; }
        notify('ops.fixed', { machine: m.name, who: ctx.fullName(emp(actor())), hours: b.downtime, href: '#ops-machines' }, [...new Set([b.reportedBy, ...opsPeople()])].filter((x) => x && x !== actor()), { from: actor() });
        ctx.commit(`${m.name} is running again`, `${m.name} fixed after ${b.downtime} hours`);
      },
    });
    const box = ctx.$('#fx-parts');
    ctx.$('#fx-add').addEventListener('click', () => box.insertAdjacentHTML('beforeend', partRow()));
    box.addEventListener('click', (ev) => { const x = ev.target.closest('[data-ops-del]'); if (x && box.children.length > 1) x.closest('.ops-line').remove(); });
  }

  // ---------- Operations today: the admin manager's one page; the owner also gets the month so far ----------
  const card = (title, link, body, tone = '') => `<div class="card ops-card ${tone}"><div class="card-head"><h3>${title}</h3>${link ? `<a class="hint" href="#${link}">Open</a>` : ''}</div>${body}</div>`;
  const big = (v, label) => `<div class="ops-big"><span class="kpi-value">${v}</span><span class="faint">${label}</span></div>`;
  const rows = (list, none = 'Nothing') => `<ul class="hr-list">${list.join('') || `<li class="faint">${none}</li>`}</ul>`;
  function manpower() {
    const t = T(), att = st().attendance[t] || {}, staff = ctx.activeEmployees().filter((e) => e.type !== 'Owner');
    const L = window.AllurusLeaveRules, cal = L ? L.calendarCtx(st().settings.leave, t, t) : null;
    const working = !cal || L.isWorkingDay(t, cal);
    const by = { in: [], leave: [], absent: [], late: [] };
    staff.forEach((e) => {
      const r = att[e.id];
      if (ctx.leave?.onLeave(e.id, t) || r?.s === 'leave') by.leave.push(e);
      else if (r?.in) { by.in.push(e); if (ctx.time?.dayInfo(e, t).ev.late) by.late.push(e); }
      else if (working) by.absent.push(e);
    });
    const depts = st().departments.map((d) => ({ d, n: staff.filter((e) => e.dept === d.id).length, inN: by.in.filter((e) => e.dept === d.id).length })).filter((x) => x.n);
    // Overtime worked this month, after the monthly limits, from the time rules.
    const ot = ctx.time ? staff.reduce((s, e) => s + (ctx.time.monthFor(e, t.slice(0, 7)).paidMin || 0), 0) : 0;
    return card('Manpower', 'attendance', `${big(`${by.in.length}<span class="faint" style="font-size:18px"> / ${staff.length}</span>`, working ? 'in today' : 'Rest day')}
      <div class="chips" style="margin:8px 0">${by.leave.length ? `<span class="tag">On leave: ${by.leave.map((e) => esc(e.first)).join(', ')}</span>` : ''}${by.absent.length ? `<span class="tag warn">Not in yet: ${by.absent.map((e) => esc(e.first)).join(', ')}</span>` : ''}${by.late.length ? `<span class="tag">Late: ${by.late.map((e) => esc(e.first)).join(', ')}</span>` : ''}</div>
      ${rows(depts.map((x) => `<li><span>${esc(x.d.name)}</span><span class="num">${x.inN} / ${x.n}</span></li>`))}${ot ? `<p class="faint">${Math.round(ot / 60)} h overtime worked this month</p>` : ''}`, by.absent.length > 2 ? 'warn' : '');
  }
  // Average daily use of a raw material over the last 30 days, from production moves.
  const used30 = (itemId) => -ops().moves.filter((m) => m.itemId === itemId && m.qty < 0 && m.date > U.addDays(T(), -30)).reduce((s, m) => s + m.qty, 0);
  function stockCard() {
    const lv = levels().map((x) => ({ ...x, cover: O.daysCover(x.onHand, used30(x.id)) })).sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9));
    const low = lv.filter((x) => x.low);
    return card('Stock', 'ops-stock', `${big(low.length, `item${low.length === 1 ? '' : 's'} below reorder level`)}
      ${rows(lv.slice(0, 6).map((x) => `<li><div><strong>${esc(x.name)}</strong><div class="person-sub">${qty(x.onHand, x.unit)}${x.onOrder ? ` · ${qty(x.onOrder)} on order` : ''}</div></div>${x.cover != null ? `<span class="pill ${x.cover < 5 ? 'bad' : x.cover < 10 ? 'warn' : 'ok'}">${x.cover} days</span>` : ''}</li>`))}
      ${low.some((x) => !x.onOrder) && can() ? `<button class="btn btn-sm btn-primary" data-act="ops-po-new" data-id="${low.find((x) => !x.onOrder).id}">Make PO for ${esc(low.find((x) => !x.onOrder).name.toLowerCase())}</button>` : ''}`, low.some((x) => !x.onOrder) ? 'warn' : '');
  }
  const units = (bs) => bs.filter((b) => b.status === 'Done').reduce((s, b) => s + b.actual, 0);
  function productionCard() {
    const t = T(), today = ops().batches.filter((b) => b.date === t), hold = ops().batches.filter((b) => b.qc === 'Hold');
    const wk = units(ops().batches.filter((b) => b.date > U.addDays(t, -7) && b.date <= t)), prev = units(ops().batches.filter((b) => b.date > U.addDays(t, -14) && b.date <= U.addDays(t, -7)));
    return card('Production', 'ops-production', `${big(units(today).toLocaleString('en-MY'), `made today · ${today.length} batch${today.length === 1 ? '' : 'es'}`)}
      <p class="faint">${wk.toLocaleString('en-MY')} units in the last 7 days${prev ? ` (${wk >= prev ? '+' : ''}${Math.round(((wk - prev) / prev) * 100)}% on the week before)` : ''}</p>
      ${rows(today.map((b) => `<li><span>${esc(b.no)} · ${esc(prod(b.productId)?.name || '')}</span>${b.status === 'Done' ? pill(b.qc, b.qc === 'Pass' ? `${b.actual} made` : 'On hold') : pill(b.status)}</li>`), 'No batches today')}
      ${hold.length ? `<p style="margin-top:8px">${pill('Hold', 'QC hold')} ${hold.map((b) => `${esc(b.no)}: ${esc(b.qcNote || '')}`).join('; ')}</p>` : ''}`, hold.length ? 'warn' : '');
  }
  function deliveriesCard() {
    const list = ops().dos.filter((d) => d.date === T()), cash = list.reduce((s, d) => s + (d.cash || 0), 0);
    const toCollect = list.filter((d) => ['Planned', 'Out'].includes(d.status)).reduce((s, d) => { const so = ops().orders.find((x) => x.id === d.soId); return s + (so?.terms === 'COD' ? soTotal(so) : 0); }, 0);
    const count = (s) => list.filter((d) => d.status === s).length;
    return card('Deliveries and cash', 'ops-sales', `${big(`${count('Delivered')}<span class="faint" style="font-size:18px"> / ${list.length}</span>`, 'delivered today')}
      <div class="chips" style="margin:8px 0">${count('Out') ? `<span class="tag">${count('Out')} out now</span>` : ''}${count('Planned') ? `<span class="tag">${count('Planned')} not left yet</span>` : ''}${count('Failed') ? `<span class="tag warn">${count('Failed')} not delivered</span>` : ''}</div>
      <dl class="kv"><dt>Cash collected</dt><dd class="num">${money(cash)}</dd><dt>Cash still to collect</dt><dd class="num">${money(toCollect)}</dd></dl>`, count('Failed') ? 'warn' : '');
  }
  function moneyInCard() {
    const open = openInvoices(), a = O.aging(open, T()), top = O.topDebtors(open, 5);
    const bar = (v, c) => (a.total ? `<i style="width:${(v / a.total) * 100}%;background:${c}"></i>` : '');
    return card('Money in', 'invoices', `${big(money(a.total), `owed by clients · ${money(a.overdue)} overdue`)}
      <div class="ops-aging" aria-hidden="true">${bar(a.current, 'var(--ok)')}${bar(a.d30, 'var(--gold)')}${bar(a.d60, 'var(--warn, var(--gold))')}${bar(a.d60p, 'var(--bad)')}</div>
      <dl class="kv"><dt>Not yet due</dt><dd class="num">${money(a.current)}</dd><dt>1–30 days late</dt><dd class="num">${money(a.d30)}</dd><dt>31–60 days late</dt><dd class="num">${money(a.d60)}</dd><dt>Over 60 days</dt><dd class="num" style="color:${a.d60p ? 'var(--bad)' : ''}">${money(a.d60p)}</dd></dl>
      <h4 class="lv-h">Owe the most</h4>${rows(top.map((x) => `<li><span>${esc(x.client)}</span><span class="num">${money(x.owed)}</span></li>`))}`, a.d60p ? 'warn' : '');
  }
  function moneyOutCard() {
    const d = O.billsDue(fin().bills, T()), tot = (xs) => xs.reduce((s, b) => s + (Number(b.amount) || 0) + (Number(b.tax) || 0), 0);
    const line = (b) => `<li><div><strong>${esc(b.supplier)}</strong><div class="person-sub">${esc(b.ref || '')} · due ${fmt(b.due)}</div></div><span class="num">${money(b.amount)}</span></li>`;
    return card('Money out', 'bills', `${big(money(tot(d.overdue) + tot(d.week)), 'to pay vendors this week')}
      ${d.overdue.length ? `<h4 class="lv-h" style="color:var(--bad)">Overdue · ${money(tot(d.overdue))}</h4>${rows(d.overdue.map(line))}` : ''}
      <h4 class="lv-h">Due in 7 days · ${money(tot(d.week))}</h4>${rows(d.week.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6).map(line), 'Nothing due this week')}`, d.overdue.length ? 'warn' : '');
  }
  function machinesCard() {
    const ms = ops().machines, down = ms.filter((m) => m.status === 'Down'), pm = ms.map((m) => ({ m, s: O.pmStatus(m, T()) })).filter((x) => x.s.status !== 'OK');
    const hrs = O.downtime(ops().breakdowns, T().slice(0, 7), new Date().toISOString());
    return card('Machines', 'ops-machines', `${big(`${ms.length - down.length}<span class="faint" style="font-size:18px"> / ${ms.length}</span>`, 'running')}
      ${down.map((m) => { const b = ops().breakdowns.find((x) => x.machineId === m.id && x.status !== 'Fixed'); return `<p>${pill('Down')} <strong>${esc(m.name)}</strong>${b ? `<span class="faint"> · ${esc(b.status.toLowerCase())}, ${esc(first(b.assignee))}</span>` : ''}</p>`; }).join('')}
      ${rows(pm.map((x) => `<li><span>${esc(x.m.name)}</span>${pill(x.s.status, x.s.status === 'Due' ? `Service due ${x.s.nextDate ? fmt(x.s.nextDate) : ''}` : 'Service overdue')}</li>`), 'All services on schedule')}
      <p class="faint">${hrs} h downtime this month</p>`, down.length ? 'bad' : '');
  }
  function expiringCard() {
    const t = T(), end = U.addDays(t, 30);
    const staff = (ctx.hr?.expiringItems() || []).filter((x) => x.expiry && x.expiry <= end).map((x) => ({ ...x, who: x.empId ? ctx.fullName(emp(x.empId)) : '' }));
    const list = [...staff, ...expiringItems().filter((x) => x.expiry <= end)].sort((a, b) => a.expiry.localeCompare(b.expiry));
    return card('Expiring soon', '', `${big(list.length, 'in the next 30 days')}
      ${rows(list.map((x) => `<li><div><strong>${esc(x.title)}</strong>${x.who ? `<div class="person-sub">${esc(x.who)}</div>` : ''}</div>${pill(x.expiry < t ? 'Overdue' : 'Due', x.expiry < t ? 'Expired' : fmt(x.expiry))}</li>`))}`, list.some((x) => x.expiry < t) ? 'bad' : list.length ? 'warn' : '');
  }
  // The owner's month so far: what was sold, made and bought, and what the people cost.
  function monthCard() {
    const mk = T().slice(0, 7), name = U.fmtMonth(mk, { month: 'long' });
    const sales = fin().invoices.filter((i) => i.type === 'invoice' && i.issue?.startsWith(mk)).reduce((s, i) => s + AllurusFinance.invoiceTotals(i).total, 0);
    const made = units(ops().batches.filter((b) => b.date.startsWith(mk)));
    const bought = fin().bills.filter((b) => b.issue?.startsWith(mk) && ['Raw materials', 'Packaging'].includes(b.category)).reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const paid = Object.keys(st().payroll).filter((k) => st().payroll[k].status === 'Paid').sort().pop(), pt = paid ? ctx.payTotal(st().payroll[paid]) : null;
    const pay = pt ? pt.gross + pt.erCost : 0;
    const k = (label, v, foot) => `<div class="card kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${v}</div><div class="kpi-foot">${foot}</div></div>`;
    return `<h3 class="lv-h">${esc(name)} so far</h3><div class="grid g-4 keep-2" style="margin-bottom:16px">${k('Sales', money(sales), 'invoiced to clients')}${k('Output', made.toLocaleString('en-MY'), 'units made')}${k('Raw materials bought', money(bought), 'ingredients and packaging')}${k('Payroll cost', money(pay), paid ? `${U.fmtMonth(paid, { month: 'long' })}, with employer contributions` : 'No payroll paid yet')}</div>`;
  }
  function todayView() {
    const owner = !Array.isArray(ctx.account()?.perms);
    return `${head('Operations today', `${fmt(T(), { weekday: 'long', day: 'numeric', month: 'long' })} at ${esc(st().settings.company)}. Everything that needs a look, on one page.`)}
      ${owner ? monthCard() : ''}
      <div class="ops-grid ops-today">${[manpower(), stockCard(), productionCard(), deliveriesCard(), moneyInCard(), moneyOutCard(), machinesCard(), expiringCard()].join('')}</div>`;
  }

  // ---------- Employee views: the driver's deliveries and machine breakdowns ----------
  const myDOs = (id, day = T()) => ops().dos.filter((d) => d.date === day && (d.driverId === id || d.helperId === id)).sort((a, b) => a.seq - b.seq);
  function myDeliveries() {
    const me = ctx.me(), list = myDOs(me.id), left = list.filter((d) => ['Planned', 'Out'].includes(d.status)), cash = list.reduce((s, d) => s + (d.cash || 0), 0);
    const codDue = left.reduce((s, d) => { const so = ops().orders.find((x) => x.id === d.soId); return s + (so?.terms === 'COD' ? soTotal(so) : 0); }, 0);
    const v = list[0] ? machine(list[0].vehicleId) : null;
    return `<div class="page-head"><div><h1>My deliveries today</h1><p class="sub">${list.length ? `${left.length} to go of ${list.length}${v ? ` · ${esc(v.name)}` : ''}` : 'Nothing assigned to you today.'}</p></div></div>
      ${list.length ? `<div class="grid g-2 keep-2"><div class="card kpi"><div class="kpi-label">Cash collected</div><div class="kpi-value">${money(cash)}</div></div><div class="card kpi"><div class="kpi-label">Cash still to collect</div><div class="kpi-value">${money(codDue)}</div></div></div>
        <div class="card">${list[0].route ? `<p class="faint" style="margin-bottom:10px">${esc(list[0].route)}</p>` : ''}${list.map((d) => stopCard(d, { mine: true })).join('')}</div>` : `<div class="card">${empty('All clear', 'New deliveries for you will show here.')}</div>`}`;
  }
  function myMachines() {
    const me = ctx.me(), mine = ops().breakdowns.filter((b) => b.reportedBy === me.id), jobs = ops().breakdowns.filter((b) => b.assignee === me.id && b.status !== 'Fixed');
    const ms = ops().machines, pm = ms.filter((m) => O.pmStatus(m, T()).status !== 'OK');
    return `<div class="page-head"><div><h1>Machines</h1><p class="sub">${ms.filter((m) => m.status === 'Down').length} down now. Report anything that isn’t working right.</p></div><div class="actions"><button class="btn btn-primary" data-act="ops-bd-new">${icon('plus')}Report a breakdown</button></div></div>
      ${jobs.length ? `<h3 class="lv-h">Assigned to you</h3>${bdTable(jobs)}` : ''}
      ${technicians().some((e) => e.id === me.id) && pm.length ? `<div class="card"><div class="card-head"><h3>Services due</h3></div><ul class="hr-list">${pm.map((m) => { const s = O.pmStatus(m, T()); return `<li><div><strong>${esc(m.name)}</strong><div class="person-sub">${s.nextDate ? fmt(s.nextDate) : ''}${s.hoursLeft != null ? ` · ${Math.round(s.hoursLeft)} h left` : ''}</div></div>${pill(s.status)}</li>`; }).join('')}</ul></div>` : ''}
      <h3 class="lv-h">Reported by you</h3>${mine.length ? bdTable(mine) : `<div class="card">${empty('Nothing reported', 'Tap Report a breakdown if a machine stops or sounds wrong.')}</div>`}`;
  }
  // Quick actions on the employee's Home: deliveries for drivers, breakdown reports for the factory floor.
  const isFloor = (e) => ['d-prod', 'd-qc', 'd-maint'].includes(e?.dept);
  function homeCard() {
    if (!has() || ctx.role() !== 'employee') return '';
    const me = ctx.me(), dos = myDOs(me.id), left = dos.filter((d) => ['Planned', 'Out'].includes(d.status)).length;
    const jobs = ops().breakdowns.filter((b) => b.assignee === me.id && b.status !== 'Fixed').length;
    const bits = [
      dos.length ? `<a class="btn btn-primary" href="#my-deliveries">${icon('pin')}My deliveries today (${left} to go)</a>` : '',
      jobs ? `<a class="btn btn-primary" href="#my-machines">${icon('sliders')}${jobs} breakdown${jobs === 1 ? '' : 's'} to fix</a>` : '',
      isFloor(me) || dos.length ? `<button class="btn" data-act="ops-bd-new">${icon('sliders')}Report a breakdown</button>` : '',
    ].filter(Boolean);
    return bits.length ? `<div class="card ops-home"><div class="ci-actions" style="justify-content:flex-start;flex-wrap:wrap">${bits.join('')}</div></div>` : '';
  }

  // ---------- Insights, reminders, badges ----------
  function insights() {
    if (!has()) return [];
    const out = [];
    if (can()) {
      const lv = levels(), lowFree = lv.filter((x) => x.low && !x.onOrder), down = ops().machines.filter((m) => m.status === 'Down'), over = ops().machines.filter((m) => O.pmStatus(m, T()).status === 'Overdue'), hold = ops().batches.filter((b) => b.qc === 'Hold'), drafts = ops().pos.filter((p) => p.status === 'Draft' && p.by !== actor());
      if (down.length && inScope('machines')) out.push({ tone: 'bad', icon: 'sliders', title: `${down.map((m) => m.name).join(', ')} ${down.length === 1 ? 'is' : 'are'} down`, detail: ops().breakdowns.filter((b) => b.status !== 'Fixed').map((b) => b.problem).slice(0, 1).join(''), action: { label: 'Open', href: '#ops-machines' }, prio: 3 });
      if (lowFree.length && inScope('stock')) out.push({ tone: 'warn', icon: 'box', title: `${lowFree.length} item${lowFree.length === 1 ? '' : 's'} below reorder level with nothing on order`, detail: lowFree.map((x) => x.name).join(', '), action: { label: 'Make PO', act: 'ops-po-new', id: lowFree[0].id }, prio: 2 });
      if (drafts.length && inScope('stock')) out.push({ tone: 'info', icon: 'box', title: `${drafts.length} purchase order${drafts.length === 1 ? '' : 's'} to approve`, detail: drafts.map((p) => `${p.no} (${money(O.poTotal(p))})`).join(', '), action: { label: 'Review', act: 'ops-po-open', id: drafts[0].id }, prio: 2 });
      if (hold.length && inScope('production')) out.push({ tone: 'warn', icon: 'shield', title: `Batch ${hold[0].no} is on QC hold`, detail: hold[0].qcNote, action: { label: 'Open', href: '#ops-production' }, prio: 2 });
      if (over.length && inScope('machines')) out.push({ tone: 'warn', icon: 'sliders', title: `${over.length} machine service${over.length === 1 ? ' is' : 's are'} overdue`, detail: over.map((m) => m.name).join(', '), action: { label: 'Open', href: '#ops-machines' }, prio: 2 });
    }
    if (ctx.role() === 'employee') {
      const left = myDOs(ctx.me().id).filter((d) => ['Planned', 'Out'].includes(d.status));
      if (left.length) out.push({ tone: 'info', icon: 'pin', title: `${left.length} deliver${left.length === 1 ? 'y' : 'ies'} to go today`, detail: left.map((d) => contact(ops().orders.find((s) => s.id === d.soId)?.clientId)?.name).join(', '), action: { label: 'Open', href: '#my-deliveries' }, prio: 3 });
      const jobs = ops().breakdowns.filter((b) => b.assignee === ctx.me().id && b.status !== 'Fixed');
      if (jobs.length) out.push({ tone: 'bad', icon: 'sliders', title: `${jobs.length} breakdown${jobs.length === 1 ? '' : 's'} assigned to you`, detail: jobs.map((b) => machine(b.machineId)?.name).join(', '), action: { label: 'Open', href: '#my-machines' }, prio: 3 });
    }
    return out;
  }
  // Company licences, vehicle road tax and insurance for the daily reminders (sent to HR / admin).
  const expiringItems = () => has() ? [
    ...ops().licences.map((l) => ({ id: l.id, empId: '', title: l.name, expiry: l.expiry })),
    ...ops().machines.filter((m) => m.kind === 'vehicle').flatMap((v) => [{ id: `road-${v.id}`, empId: '', title: `Road tax ${v.plate}`, expiry: v.roadTax }, { id: `ins-${v.id}`, empId: '', title: `Insurance ${v.plate}`, expiry: v.insurance }]),
  ].filter((x) => x.expiry) : [];
  function badge(routeId) {
    if (!has()) return 0;
    if (routeId === 'ops-stock') return ops().pos.filter((p) => p.status === 'Draft').length;
    if (routeId === 'ops-machines') return ops().machines.filter((m) => m.status === 'Down').length;
    if (routeId === 'ops-production') return ops().batches.filter((b) => b.qc === 'Hold').length;
    if (routeId === 'my-deliveries') return myDOs(ctx.me()?.id).filter((d) => ['Planned', 'Out'].includes(d.status)).length;
    if (routeId === 'my-machines') return ops().breakdowns.filter((b) => b.assignee === ctx.me()?.id && b.status !== 'Fixed').length;
    return 0;
  }
  // Which Operations pages a person sees, and the page a driver opens on a phone.
  const ROUTE_TAB = { 'ops-stock': 'stock', 'ops-production': 'production', 'ops-sales': 'sales', 'ops-machines': 'machines' };
  const routeAllowed = (id) => {
    if (!/^(ops-|my-deliveries|my-machines)/.test(id)) return true;
    if (!has()) return false;
    if (id === 'my-deliveries') return ops().dos.some((d) => d.driverId === ctx.me()?.id || d.helperId === ctx.me()?.id);
    if (id === 'my-machines') return true;
    if (id === 'ops-today') return !scope();
    return !ROUTE_TAB[id] || inScope(ROUTE_TAB[id]);
  };
  const landing = (role) => (has() && role === 'employee' && myDOs(ctx.me()?.id).length ? 'my-deliveries' : '');

  function install(c) {
    ctx = c;
    Object.assign(ctx.VIEWS, { 'ops-today': todayView, 'ops-stock': stockView, 'ops-production': prodView, 'ops-sales': salesView, 'ops-machines': machView, 'my-deliveries': myDeliveries, 'my-machines': myMachines });
    ctx.AFTER['ops-sales'] = () => ctx.$('#ops-day')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.day = ev.target.value; ctx.render(); } });
    const tab = (k) => (_, v) => { ui[k] = v; ctx.render(); };
    const po = (id) => ops().pos.find((x) => x.id === id);
    Object.assign(ctx.ACTIONS, {
      'ops-stock-tab': tab('stockTab'), 'ops-prod-tab': tab('prodTab'), 'ops-sales-tab': tab('salesTab'), 'ops-mach-tab': tab('machTab'),
      'ops-item': (id) => itemModal(id),
      'ops-po-new': (id) => poModal(id),
      'ops-po-open': (id) => poOpen(id),
      'ops-po-approve': (id) => {
        const p = po(id);
        if (p.by === actor()) { ctx.toast('Someone else must approve a purchase order you raised', 'error'); return; }
        Object.assign(p, { status: 'Approved', approvedBy: actor(), approvedOn: T() });
        ctx.closeOverlay(); ctx.commit(`${p.no} approved`, `Purchase order ${p.no} approved`);
      },
      'ops-po-send': (id) => { const p = po(id); Object.assign(p, { status: 'Sent', sentOn: T() }); ctx.commit(`${p.no} sent to ${contact(p.vendorId)?.name || 'the vendor'}`); },
      'ops-po-receive': (id) => receiveModal(id),
      'ops-po-bill': (id) => { const p = po(id), b = createBill(p); ctx.commit(`Bill for ${money(b.amount)} added to Finance`, `Bill created from ${p.no}`); },
      'ops-po-del': (id) => { const p = po(id); ops().pos = ops().pos.filter((x) => x.id !== id); ctx.closeOverlay(); ctx.commit(`${p.no} deleted`); },
      'ops-batch-new': () => batchNew(),
      'ops-batch-record': (id) => batchRecord(id),
      'ops-batch-open': (id) => batchOpen(id),
      'ops-batch-qc': (id, v) => { const b = ops().batches.find((x) => x.id === id); b.qc = v; b.qcBy = actor(); b.qcAt = T(); ctx.commit(v === 'Pass' ? `${b.no} released for sale` : `${b.no} rejected`, `QC ${v === 'Pass' ? 'released' : 'rejected'} batch ${b.no}`); },
      'ops-so-new': () => soNew(),
      'ops-day': (_, v) => { ui.day = +v === 0 ? T() : U.addDays(ui.day || T(), +v); ctx.render(); },
      'ops-do-out': (id) => { const d = ops().dos.find((x) => x.id === id); d.status = 'Out'; ctx.commit(`${d.no} out for delivery`); },
      'ops-do-deliver': (id) => deliverModal(id),
      'ops-do-fail': (id) => {
        const d = ops().dos.find((x) => x.id === id), why = prompt('Why couldn’t it be delivered?', 'Shop closed');
        if (why == null) return;
        Object.assign(d, { status: 'Failed', failReason: why, failedAt: new Date().toISOString() });
        ctx.commit(`${d.no} marked as not delivered; the stock is back`, `${d.no} not delivered: ${why}`);
      },
      'ops-do-photo': (id) => { const d = ops().dos.find((x) => x.id === id); ctx.openModal({ title: `Proof of delivery · ${d.no}`, submit: null, body: `<img src="${d.photo}" alt="Proof of delivery for ${esc(d.no)}" style="width:100%;border-radius:12px">${d.receivedBy ? `<p class="faint">Received by ${esc(d.receivedBy)}</p>` : ''}` }); },
      'ops-mach-open': (id) => machOpen(id),
      'ops-pm-log': (id) => pmLog(id),
      'ops-bd-new': () => bdNew(),
      'ops-bd-fix': (id) => bdFix(id),
      'ops-bd-photo': (id) => { const b = ops().breakdowns.find((x) => x.id === id); ctx.openModal({ title: b.no, submit: null, body: `<img src="${b.photo}" alt="Photo of the breakdown" style="width:100%;border-radius:12px">` }); },
      'ops-lic-renew': (id) => {
        const [kind, vid] = id.includes(':') ? id.split(':') : ['lic', id];
        const cur = kind === 'lic' ? ops().licences.find((l) => l.id === vid).expiry : machine(vid)[kind === 'road' ? 'roadTax' : 'insurance'];
        const next = prompt('New expiry date (YYYY-MM-DD)', U.addDays(cur || T(), 365));
        if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
        if (kind === 'lic') ops().licences.find((l) => l.id === vid).expiry = next; else machine(vid)[kind === 'road' ? 'roadTax' : 'insurance'] = next;
        ctx.commit('Expiry date updated');
      },
    });
    return { has, insights, expiringItems, badge, routeAllowed, landing, homeCard, levels, openInvoices, sold30, myDOs, technicians, ui };
  }
  return { install };
})();
