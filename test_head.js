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
  // A driver or operator in the cloud holds only the lists they may read (js/cloud-map.js); the rest are empty.
  const LISTS = ['items', 'moves', 'pos', 'products', 'batches', 'orders', 'dos', 'machines', 'maint', 'breakdowns', 'licences'];
  // Inventory is on when HR switched it on (Settings → Modules), or the workspace already carries stock data and it was not switched off. Turning
  // it off hides the pages and never deletes anything. A new company starts with an empty structure the first time it is used.
  const modOn = () => st().settings?.modules?.inventory;
  const has = () => modOn() === true || (!!st().ops && modOn() !== false);
  const ops = () => { if (!st().ops) st().ops = O.emptyOps(); const o = st().ops; LISTS.forEach((k) => { if (!Array.isArray(o[k])) o[k] = []; }); return o; };
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const money = (n) => ctx.money(n);
  const T = () => U.today();
  const fmt = (d, o = { day: 'numeric', month: 'short' }) => (d ? U.fmtDate(d.slice(0, 10), o) : '—');
  const can = () => !!window.AllurusAccess?.can('operations');
  const canFinance = () => !!window.AllurusAccess?.can('finance');
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
  // A delivery's invoice is issued (sent) at delivery, with any cash collected recorded as a payment
  // (js/invoice-store.js; in the cloud, its own document).
  function invoiceFromDO(d, so, cash, date) {
    const c = contact(so.clientId);
    const inv = { no: invNo(), customer: c?.name || so.clientId, contactId: so.clientId, email: c?.email || '', issue: T(), due: so.terms === 'COD' ? T() : U.addDays(T(), 30), items: so.lines.map((l) => ({ desc: prod(l.productId)?.name || l.productId, qty: l.qty, unit: window.AllurusInvoiceRules.UNITS.some((u) => u.code === prod(l.productId)?.unit) ? prod(l.productId).unit : 'unit', price: l.price, classification: '022' })), taxRate: 0, category: 'Product sales', doId: d.id, soId: so.id, einvoice: { status: 'Draft' } };
    return ctx.invoices.issueDelivered(inv, cash, date);
  }
  const soTotal = (so) => O.r2((so?.lines || []).reduce((s, l) => s + l.qty * l.price, 0));
  // What the driver needs about a delivery, kept on the delivery order itself: a driver can't read the sales
  // orders, the client list or the batches. Older delivery orders without it are read from those lists.
  const slipFor = (so, picks) => { const c = contact(so.clientId); return { client: c?.name || '', address: [c?.address?.line1, c?.address?.city].filter(Boolean).join(', '), phone: c?.phone || '', terms: so.terms, total: soTotal(so), lines: so.lines.map((l) => ({ name: prod(l.productId)?.name || '', qty: l.qty, price: l.price })), batches: [...new Set(picks.map((p) => ops().batches.find((b) => b.id === p.batchId)?.no).filter(Boolean))] }; };
  const slipOf = (d) => d.slip || slipFor(ops().orders.find((x) => x.id === d.soId) || { lines: [] }, d.picks || []);
  // A machine is down when someone says so, or while a breakdown reported as stopping it is open (an operator
  // without the operations area can report a breakdown but not change the machine list).
  const isDown = (m) => m.status === 'Down' || ops().breakdowns.some((b) => b.machineId === m.id && b.stopped && b.status !== 'Fixed');

  // The invoice for a delivery, with the cash collected on delivery against it. Needs the finance area; a driver's
  // delivery waits (invoicePending) until someone with it opens Operations.
  function invoiceDelivery(d) {
    const so = ops().orders.find((x) => x.id === d.soId);
    if (!so) return null;
    const total = soTotal(so), cash = d.cash || 0, inv = invoiceFromDO(d, so, cash, (d.deliveredAt || T()).slice(0, 10));
    d.invoiceId = inv.id; d.invoicePending = false; so.status = 'Delivered';
    if (cash > 0) {
      fin().txns.push({ id: U.uid('x'), date: (d.deliveredAt || T()).slice(0, 10), desc: `${cash >= total ? 'Cash' : 'Part payment'} on delivery from ${inv.customer}`, type: 'in', category: 'Product sales', amount: cash, tax: 0, ref: inv.no, source: 'invoice', reconciled: false });
    }
    return inv;
  }
  const toInvoice = () => ops().dos.filter((d) => d.status === 'Delivered' && !d.invoiceId);

  // ---------- Stock & purchasing ----------
  const KIND = { raw: 'Raw material', pack: 'Packaging', goods: 'Trading goods' };
  // People who look after the store: accounts with the operations area, unless limited to other pages.
  const storePeople = () => st().accounts.filter((a) => a.roles.includes('admin') && (!Array.isArray(a.perms) || a.perms.includes('operations')) && (!a.opsScope || a.opsScope.includes('stock'))).map((a) => a.empId).filter(Boolean);
  // Purchase orders on their way: approved or sent, or partly received, soonest first.
  const drafted = (itemId) => ops().pos.find((p) => p.status === 'Draft' && p.lines.some((l) => l.itemId === itemId));
  const incoming = () => ops().pos.filter((p) => ['Approved', 'Sent', 'Partial'].includes(p.status)).sort((a, b) => (a.expected || '').localeCompare(b.expected || ''));
  const poItems = (p) => p.lines.map((l) => `${qty(Math.max(0, l.qty - (l.received || 0)))} ${esc(item(l.itemId)?.unit || '')} ${esc(item(l.itemId)?.name.toLowerCase() || '')}`).join(', ');
  function incomingCard() {
    const list = incoming();
    if (!list.length) return '';
    return `<div class="card ops-incoming"><div class="card-head"><h3>Coming in</h3><span class="hint">What has been bought and when it arrives</span></div>
      <ul class="hr-list">${list.map((p) => `<li class="clickable" data-act="ops-po-open" data-id="${p.id}"><div><strong>${esc(p.no)} · ${esc(contact(p.vendorId)?.name || '')}</strong><div class="person-sub">${poItems(p)}</div></div>
        <span>${p.status === 'Partial' ? pill('Partial', 'Rest due') : ''} ${pill(p.expected < T() ? 'Overdue' : p.expected === T() ? 'Due' : 'Open', p.expected < T() ? `Late, ${fmt(p.expected)}` : p.expected === T() ? 'Today' : fmt(p.expected, { weekday: 'short', day: 'numeric', month: 'short' }))}</span></li>`).join('')}</ul></div>`;
  }
  // The stock list: search, category, location and low-stock filters (done in the page, so typing never redraws it), a table on a computer
  // and cards with big + / − buttons on a phone. Every quantity change is a stock move (docs/INVENTORY-ON-SPEC.md).
  const cats = () => [...new Set(ops().items.map((i) => i.category).filter(Boolean))].sort();
  const locs = () => [...new Set(ops().items.map((i) => i.location).filter(Boolean))].sort();
  function stockView() {
    const lv = levels(), low = lv.filter((x) => x.low), open = ops().pos.filter((p) => ['Draft', 'Approved', 'Sent', 'Partial'].includes(p.status));
    const val = O.stockValue(lv);
    const acts = can() ? `<button class="btn" data-act="ops-reports">${icon('download')}Reports</button><button class="btn" data-act="ops-count">${icon('check')}Stock count</button><button class="btn" data-act="ops-import">${icon('doc')}Import items</button><button class="btn" data-act="ops-item-new">${icon('plus')}Add item</button><button class="btn btn-primary" data-act="ops-po-new">${icon('plus')}New purchase order</button>` : '';
    const tabs = [['stock', 'Stock'], ['pos', `Purchase orders${open.length ? ` (${open.length})` : ''}`], ['moves', 'Stock movements'], ['stockOuts', `Stock out requests <span class="hint">${pendingStockOuts().length} awaiting</span>`]];
    const activeTab = ui.stockTab;
    const showTab = (key) => {
      ui.stockTab = key;
      if (key === 'stockOuts') return stockOutList();
      if (key === 'pos') return poTable();
      if (key === 'moves') return movesTable();
      return incomingCard() + stockTable(lv);
    };
    return `${head('Stock &amp; purchasing', `${lv.length} item${lv.length === 1 ? '' : 's'} · ${low.length} below reorder level · ${open.filter((p) => ['Sent', 'Partial'].includes(p.status)).length} orders waiting for delivery · stock worth ${money(val.cost)} at cost`, acts)}
      <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-act="ops-stock-tab" data-v="${k}" class="${ui.stockTab === k ? 'on' : ''}" aria-selected="${ui.stockTab === k}">${l}</button>`).join('')}</div>
      ${showTab(ui.stockTab)}`;`;
  }
function stockTable(lv) {
