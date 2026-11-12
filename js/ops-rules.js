// Operations rules for a company that makes, sells and delivers a product: stock of raw materials and packaging,
// purchase orders, production batches with a recipe (bill of materials), finished goods by batch with oldest-expiry-
// first picking, preventive maintenance due dates, and aging of what clients owe. Pure functions, no DOM, so they can
// be tested in Node (tests/ops.test.js). js/ops.js draws the screens.
//
// Data shapes (state.ops):
//   items      [{ id, code, name, kind: 'raw' | 'pack', unit, opening, reorder, vendorId, lastPrice }]
//   moves      [{ id, itemId, date, qty (+ in / − out), ref, note }]          stock in and out, never edited
//   pos        [{ id, no, vendorId, date, expected, status, lines: [{ itemId, qty, price, received }], billId }]
//   products   [{ id, code, name, unit, price, batchSize, shelfDays, bom: [{ itemId, qty }] }]   bom is per batch
//   batches    [{ id, no, date, shift, productId, planned, actual, reject, operators, used, qc, expiry }]
//   orders     [{ id, no, clientId, date, terms, lines: [{ productId, qty, price }], status, doId }]
//   dos        [{ id, no, soId, date, driverId, vehicleId, route, seq, status, picks: [{ productId, batchId, qty }], … }]
//   machines   [{ id, name, kind: 'machine' | 'vehicle', pmDays, pmHours, hours, lastPm, lastPmHours, status, … }]
//   breakdowns [{ id, no, machineId, reportedBy, reportedAt, problem, status, fixedAt, downtime, parts, billId }]
//   licences   [{ id, name, issuer, no, expiry }]
window.AllurusOpsRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  const sum = (xs, f) => xs.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const DAY = 864e5;
  const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
  const addDays = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

  // ---------- Stock ----------
  /** Stock on hand of one item: its opening quantity plus every move in and out (up to `asOf`, if given). */
  const onHand = (item, moves, asOf = '') => r3((Number(item.opening) || 0) + sum(moves.filter((m) => m.itemId === item.id && (!asOf || m.date <= asOf)), (m) => m.qty));
  /** Each item with its stock on hand, whether it is at or below its reorder level, and what is already on order. */
  function stockLevels(items, moves, pos = []) {
    return items.map((it) => {
      const qty = onHand(it, moves);
      const onOrder = r3(sum(pos.filter((p) => ['Approved', 'Sent', 'Partial'].includes(p.status)), (p) => sum(p.lines.filter((l) => l.itemId === it.id), (l) => Math.max(0, l.qty - (l.received || 0)))));
      return { ...it, onHand: qty, onOrder, low: qty <= (Number(it.reorder) || 0) };
    });
  }
  /** What to put on a purchase order for a low item: enough to get back to twice the reorder level. */
  const suggestQty = (level) => Math.max(0, Math.ceil(2 * (Number(level.reorder) || 0) - level.onHand - (level.onOrder || 0)));

  // ---------- Purchase orders ----------
  const poTotal = (po) => r2(sum(po.lines, (l) => l.qty * l.price));
  const poReceivedValue = (po) => r2(sum(po.lines, (l) => (l.received || 0) * l.price));
  /** The order a PO goes through. 'Billed' is the end: the goods are in and the vendor bill is in Finance. */
  const PO_FLOW = ['Draft', 'Approved', 'Sent', 'Partial', 'Received', 'Billed'];
  /**
   * Receive goods against a PO. got = { itemId: qty received now }. Returns the updated PO (status Partial or
   * Received) and the stock moves to add. Receiving more than is still due is capped at what is due.
   */
  function receive(po, got, { date, ids = () => '' } = {}) {
    if (!['Sent', 'Partial', 'Approved'].includes(po.status)) throw new Error(`A ${po.status.toLowerCase()} PO cannot be received`);
    const moves = [];
    const lines = po.lines.map((l) => {
      const due = Math.max(0, l.qty - (l.received || 0)), now = Math.min(due, Math.max(0, Number(got[l.itemId]) || 0));
      if (now > 0) moves.push({ id: ids(), itemId: l.itemId, date, qty: now, ref: po.no, note: 'Received', kind: 'Received', unitCost: r2(l.price) });
      return { ...l, received: r3((l.received || 0) + now) };
    });
    const full = lines.every((l) => l.received >= l.qty);
    return { po: { ...po, lines, status: full ? 'Received' : 'Partial', receivedOn: date }, moves };
  }

  // ---------- Production ----------
  /** Raw materials a batch uses: the recipe is per batch of `batchSize` units, scaled to what was cooked (good + reject). */
  const recipeUsage = (product, made) => (product.bom || []).map((b) => ({ itemId: b.itemId, qty: r3((b.qty * made) / (product.batchSize || 1)) }));
  /** Whether there is enough stock for a batch; returns the items that are short. */
  function shortfalls(product, made, levels) {
    return recipeUsage(product, made).map((u) => { const lv = levels.find((x) => x.id === u.itemId); return { ...u, have: lv ? lv.onHand : 0 }; }).filter((u) => u.have < u.qty);
  }
  const yieldPct = (b) => (b.planned ? Math.round((b.actual / b.planned) * 1000) / 10 : 0);

  // ---------- Finished goods and picking ----------
  /**
   * Finished goods by batch for one product: what each released batch made, less what delivery orders took.
   * Batches on QC hold are listed but not available. Sorted oldest expiry first.
   */
  function lots(batches, dos, productId, today = '') {
    const taken = {};
    dos.filter((d) => d.status !== 'Cancelled').forEach((d) => (d.picks || []).forEach((p) => { taken[p.batchId] = (taken[p.batchId] || 0) + p.qty; }));
    return batches.filter((b) => b.productId === productId && b.actual > 0)
      .map((b) => { const left = Math.max(0, b.actual - (taken[b.id] || 0)); return { batchId: b.id, no: b.no, expiry: b.expiry, made: b.actual, left, hold: b.qc !== 'Pass', expired: !!(today && b.expiry && b.expiry < today), available: b.qc === 'Pass' && !(today && b.expiry && b.expiry < today) ? left : 0 }; })
      .sort((a, b) => (a.expiry || '').localeCompare(b.expiry || '') || a.no.localeCompare(b.no));
  }
  /** Oldest-expiry-first picking: take from the batch that expires first. Returns the picks and anything short. */
  function pickFEFO(available, qty) {
    let need = Math.max(0, Math.floor(qty));
    const picks = [];
    for (const l of available) {
      if (!need) break;
      if (l.available <= 0) continue;
      const take = Math.min(l.available, need);
      picks.push({ batchId: l.batchId, no: l.no, qty: take, expiry: l.expiry });
      need -= take;
    }
    return { picks, short: need };
  }
  /** How many days a stock lasts at the average daily sales of the last `window` days. */
  function daysCover(stock, deliveredQtyInWindow, window = 30) {
    const perDay = deliveredQtyInWindow / window;
    return perDay > 0 ? Math.floor(stock / perDay) : null;
  }

  // ---------- Machines ----------
  /**
   * Preventive maintenance: next service by date (every pmDays) and/or by running hours (every pmHours), whichever
   * comes first. status: 'Overdue', 'Due' (within `window` days or 10% of the hours) or 'OK'.
   */
  function pmStatus(m, today, window = 7) {
    const byDate = m.pmDays && m.lastPm ? addDays(m.lastPm, m.pmDays) : '';
    const hoursLeft = m.pmHours ? (Number(m.lastPmHours) || 0) + m.pmHours - (Number(m.hours) || 0) : null;
    const daysLeft = byDate ? days(today, byDate) : null;
    const overdue = (daysLeft != null && daysLeft < 0) || (hoursLeft != null && hoursLeft < 0);
    const due = !overdue && ((daysLeft != null && daysLeft <= window) || (hoursLeft != null && hoursLeft <= m.pmHours * 0.1));
    return { nextDate: byDate, daysLeft, hoursLeft, status: overdue ? 'Overdue' : due ? 'Due' : 'OK' };
  }
  /** Downtime hours from breakdowns in a month ('YYYY-MM'): fixed ones count their downtime, open ones count up to now. */
  function downtime(breakdowns, month, nowIso) {
    return r2(sum(breakdowns.filter((b) => (b.reportedAt || '').startsWith(month)), (b) => (b.fixedAt ? b.downtime : Math.max(0, (Date.parse(nowIso) - Date.parse(b.reportedAt)) / 36e5))));
  }

  // ---------- Money ----------
  /**
   * Aging of what clients owe: each open invoice's balance by days past its due date.
   * invoices: [{ due, balance, client }]. Buckets: current (not yet due), 1–30, 31–60, 60+ days overdue.
   */
  function aging(invoices, today) {
    const b = { current: 0, d30: 0, d60: 0, d60p: 0 };
    invoices.forEach((i) => {
      const late = days(i.due, today), v = Number(i.balance) || 0;
      if (late <= 0) b.current += v; else if (late <= 30) b.d30 += v; else if (late <= 60) b.d60 += v; else b.d60p += v;
    });
    Object.keys(b).forEach((k) => { b[k] = r2(b[k]); });
    return { ...b, total: r2(b.current + b.d30 + b.d60 + b.d60p), overdue: r2(b.d30 + b.d60 + b.d60p) };
  }
  /** The clients who owe the most, biggest first. */
  function topDebtors(invoices, n = 5) {
    const by = {};
    invoices.forEach((i) => { by[i.client] = r2((by[i.client] || 0) + (Number(i.balance) || 0)); });
    return Object.entries(by).map(([client, owed]) => ({ client, owed })).filter((x) => x.owed > 0).sort((a, b) => b.owed - a.owed).slice(0, n);
  }
  /** Bills to pay: overdue, and due within the next `n` days. */
  function billsDue(bills, today, n = 7) {
    const open = bills.filter((b) => b.status !== 'Paid');
    return { overdue: open.filter((b) => b.due < today), week: open.filter((b) => b.due >= today && days(today, b.due) <= n) };
  }


  // ---------- Inventory for a real company (docs/INVENTORY-ON-SPEC.md) ----------
  // Item (stock list): { id, code, name, kind, unit, category, location, opening, reorder, lastPrice (cost), price (selling), vendorId, supplier }.
  // Every change of quantity is a move, never an edit: { id, itemId, date, qty (+in / −out), kind, ref, note, by, at }.
  const emptyOps = () => ({ items: [], moves: [], pos: [], products: [], batches: [], orders: [], dos: [], machines: [], maint: [], breakdowns: [], licences: [], seq: {} });
  // Reasons, and which way each one moves stock. 'Count correction' and 'Adjustment' may go either way.
  const MOVE_KINDS = [
    { key: 'Received', sign: 1 }, { key: 'Returned', sign: 1 }, { key: 'Opening stock', sign: 1 },
    { key: 'Used', sign: -1 }, { key: 'Sold', sign: -1 }, { key: 'Damaged', sign: -1 },
    { key: 'Count correction', sign: 0 }, { key: 'Adjustment', sign: 0 },
  ];
  const kindOf = (k) => MOVE_KINDS.find((x) => x.key === k) || null;
  /**
   * One stock move from what a person typed. direction: 'in' | 'out' | 'adjust'. For in/out the quantity is positive and the sign comes
   * from the direction; for adjust it is the signed difference. Returns { ok, move } or { ok: false, error }.
   */
  function makeMove({ itemId, direction, qty, kind, note = '', date, by = '', at = '', id = '', unitCost = null }) {
    const q = r3(qty);
    if (!itemId) return { ok: false, error: 'Choose an item.' };
    if (!kindOf(kind)) return { ok: false, error: 'Choose a reason.' };
    if (!Number.isFinite(q) || q === 0) return { ok: false, error: 'Enter a quantity.' };
    if ((direction === 'in' || direction === 'out') && q < 0) return { ok: false, error: 'Enter the quantity as a positive number.' };
    const k = kindOf(kind);
    if (direction === 'in' && k.sign < 0) return { ok: false, error: `“${kind}” takes stock out, not in.` };
    if (direction === 'out' && k.sign > 0) return { ok: false, error: `“${kind}” puts stock in, not out.` };
    if (direction === 'adjust' && k.sign !== 0) return { ok: false, error: 'An adjustment uses the reason “Count correction” or “Adjustment”.' };
    const signed = direction === 'out' ? -q : q;
    // Stock added carries what one unit cost (RM), so the history can be costed later. Nothing is averaged or valued from it here.
    const move = { id, itemId, date, qty: signed, kind, ref: '', note: String(note || '').trim().slice(0, 200), by, at };
    if (signed > 0 && unitCost != null && unitCost !== '' && Number.isFinite(Number(unitCost)) && Number(unitCost) >= 0) move.unitCost = r2(unitCost);
    return { ok: true, move };
  }
  /** Every move of one item, oldest first, with the balance after each (opening stock first). Moves on the same date keep their order. */
  function history(item, moves) {
    let bal = r3(Number(item.opening) || 0);
    const rows = moves.map((m, i) => ({ m, i })).filter((x) => x.m.itemId === item.id).sort((a, b) => (a.m.date || '').localeCompare(b.m.date || '') || a.i - b.i)
      .map(({ m }) => { bal = r3(bal + (Number(m.qty) || 0)); return { ...m, balance: bal }; });
    return { opening: r3(Number(item.opening) || 0), rows, onHand: bal };
  }
  /** Value at cost of what is on hand, and at selling price. Items without a cost count as 0 (and are listed as unpriced). */
  function stockValue(levels) {
    return { cost: r2(sum(levels, (x) => Math.max(0, x.onHand) * (Number(x.lastPrice) || 0))), selling: r2(sum(levels, (x) => Math.max(0, x.onHand) * (Number(x.price) || 0))), unpriced: levels.filter((x) => !Number(x.lastPrice) && x.onHand > 0).length };
  }
  /** Low-stock list with what to reorder. */
  const lowList = (levels) => levels.filter((x) => x.low).map((x) => ({ id: x.id, code: x.code, name: x.name, unit: x.unit, onHand: x.onHand, reorder: Number(x.reorder) || 0, onOrder: x.onOrder || 0, suggest: suggestQty(x) }));

  // A stock count: counts = { itemId: typed quantity or '' }. Items left blank are not counted. Returns the differences, and the moves to post.
  function countPlan(levels, counts) {
    const lines = [];
    levels.forEach((x) => {
      const raw = counts[x.id]; if (raw === '' || raw == null || !Number.isFinite(Number(raw))) return;
      const counted = r3(raw), diff = r3(counted - x.onHand);
      lines.push({ itemId: x.id, code: x.code, name: x.name, unit: x.unit, system: x.onHand, counted, diff, cost: r2(x.lastPrice) });
    });
    return { lines, differences: lines.filter((l) => l.diff !== 0) };
  }
  const countMoves = (plan, { date, note, by, at, ids = () => '' }) => plan.differences.map((l) => ({ id: ids(), itemId: l.itemId, date, qty: l.diff, kind: 'Count correction', ref: 'COUNT', note: String(note || 'Stock count').slice(0, 200), by, at, ...(l.diff > 0 ? { unitCost: l.cost } : {}) }));

  // ---------- Import of the item list ----------
  const IMPORT_COLUMNS = [
    ['code', 'Code', ['code', 'item code', 'sku', 'kod', 'kod item']], ['name', 'Name', ['name', 'item', 'item name', 'description', 'nama', 'nama item', 'barang']],
    ['unit', 'Unit', ['unit', 'uom', 'unit of measure', 'unit ukuran']], ['category', 'Category', ['category', 'kategori', 'group', 'jenis']],
    ['location', 'Location', ['location', 'shelf', 'location shelf', 'shelf location', 'lokasi', 'rak', 'bin']],
    ['opening', 'Opening quantity', ['opening quantity', 'opening qty', 'opening stock', 'quantity', 'qty', 'on hand', 'stock', 'kuantiti', 'baki']],
    ['reorder', 'Reorder level', ['reorder level', 'reorder', 'reorder at', 'min', 'minimum', 'min stock', 'paras semula']],
    ['cost', 'Cost price', ['cost price', 'cost', 'purchase price', 'buy price', 'harga kos', 'harga beli']],
    ['price', 'Selling price', ['selling price', 'sell price', 'price', 'sale price', 'harga jual', 'harga']],
    ['supplier', 'Supplier', ['supplier', 'vendor', 'pembekal']],
  ];
  const normH = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const WRAPS = { '"': '"', '“': '”', '”': '”', "'": "'", '‘': '’' };
  const stripQ = (v) => { if (typeof v !== 'string') return v; let t = v.trim(); while (t.length >= 2 && WRAPS[t[0]] === t[t.length - 1]) t = t.slice(1, -1).trim(); return t; };
  const cell = (v) => (v == null ? '' : typeof v === 'string' ? stripQ(v.replace(/^﻿/, '')).replace(/\s+/g, ' ').trim() : v);
  const num = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : NaN; const s = String(v).replace(/rm|myr|,|\s/gi, ''); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
  /**
   * Rows of a sheet (first row = headers; any title rows above are skipped by looking for the row that names Code and Name) → a plan:
   * { items: [{ row, code, name, unit, category, location, opening, reorder, cost, price, supplier }], errors: [{ row, message }],
   *   skipped: [{ row, code, why }], missing: [column names not found] }. existingCodes: codes already in the stock list (skipped, never changed).
   */
  function parseItems(rows, existingCodes = []) {
    const out = { items: [], errors: [], skipped: [], missing: [], headerRow: -1 };
    const grid = (rows || []).map((r) => (r || []).map(cell));
    let h = grid.findIndex((r) => { const names = r.map(normH); return IMPORT_COLUMNS.some(([, , syn]) => names.some((n) => syn.includes(n))) && names.some((n) => ['code', 'item code', 'sku', 'kod', 'kod item'].includes(n)) && names.some((n) => ['name', 'item', 'item name', 'description', 'nama', 'nama item', 'barang'].includes(n)); });
    if (h < 0) { out.missing = ['Code', 'Name']; return out; }
    out.headerRow = h;
    const heads = grid[h].map(normH), col = {};
    IMPORT_COLUMNS.forEach(([key, , syn]) => { const i = heads.findIndex((n) => syn.includes(n)); if (i >= 0) col[key] = i; });
    out.missing = IMPORT_COLUMNS.filter(([key]) => ['code', 'name'].includes(key) && col[key] == null).map(([, label]) => label);
    if (out.missing.length) return out;
    const seen = new Set(existingCodes.map((c) => String(c).trim().toUpperCase()));
    grid.slice(h + 1).forEach((r, k) => {
      const n = h + 2 + k;                                                       // the row number as a spreadsheet shows it (1-based)
      if (r.every((v) => v === '' || v == null)) return;
      const get = (key) => (col[key] == null ? '' : r[col[key]]);
      const code = String(get('code')).trim(), name = String(get('name')).trim();
      if (!code && !name) return;
      if (!code) { out.errors.push({ row: n, message: 'No code' }); return; }
      if (!name) { out.errors.push({ row: n, message: `${code}: no name` }); return; }
      const key = code.toUpperCase();
      if (seen.has(key)) { out.skipped.push({ row: n, code, why: 'That code is already in the list (or earlier in this file): skipped, nothing changed' }); return; }
      const bad = [];
      const numeric = (k2, label, min = 0) => { const raw = get(k2); if (raw === '' || raw == null) return 0; const v = num(raw); if (!Number.isFinite(v)) { bad.push(`${label} “${raw}” isn’t a number`); return 0; } if (v < min) { bad.push(`${label} can’t be negative`); return 0; } return Math.round(v * 1000) / 1000; };
      const opening = numeric('opening', 'Opening quantity'), reorder = numeric('reorder', 'Reorder level'), cost = numeric('cost', 'Cost price'), price = numeric('price', 'Selling price');
      if (bad.length) { out.errors.push({ row: n, message: `${code}: ${bad.join('; ')}` }); return; }
      seen.add(key);
      out.items.push({ row: n, code, name, unit: String(get('unit')).trim() || 'pcs', category: String(get('category')).trim(), location: String(get('location')).trim(), opening, reorder, cost, price, supplier: String(get('supplier')).trim() });
    });
    return out;
  }
  const TEMPLATE_HEAD = IMPORT_COLUMNS.map(([, label]) => label);
  const TEMPLATE_ROWS = [['HW-001', 'Cement 50kg bag', 'bag', 'Building materials', 'Rack A1', 120, 40, 18.5, 24, 'Ah Seng Hardware'], ['HW-002', 'Steel nails 3 inch (1kg)', 'pack', 'Fasteners', 'Rack B2', 60, 20, 6.2, 9.5, '']];

  // ---------- Reports (CSV rows) ----------
  const q2 = (n) => r2(n).toFixed(2);
  function stockCsvRows(levels, supplierName = () => '') {
    const head = ['Code', 'Name', 'Category', 'Location', 'Unit', 'On hand', 'Reorder level', 'Low stock', 'On order', 'Cost price', 'Value at cost', 'Selling price', 'Supplier'];
    return [head, ...[...levels].sort((a, b) => a.code.localeCompare(b.code)).map((x) => [x.code, x.name, x.category || '', x.location || '', x.unit, x.onHand, Number(x.reorder) || 0, x.low ? 'LOW' : '', x.onOrder || 0, q2(x.lastPrice), q2(Math.max(0, x.onHand) * (Number(x.lastPrice) || 0)), q2(x.price), supplierName(x) || x.supplier || ''])];
  }
  function movesCsvRows(items, moves, from, to, who = (x) => x) {
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    const list = moves.filter((m) => (!from || m.date >= from) && (!to || m.date <= to)).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return [['Date', 'Code', 'Item', 'Reason', 'Quantity', 'Unit', 'Unit cost', 'Reference', 'Note', 'By'], ...list.map((m) => [m.date, by[m.itemId]?.code || '', by[m.itemId]?.name || '', m.kind || (m.qty > 0 ? 'In' : 'Out'), m.qty, by[m.itemId]?.unit || '', m.unitCost != null && m.qty > 0 ? q2(m.unitCost) : '', m.ref || '', m.note || '', who(m.by) || ''])];
  }
  const lowCsvRows = (levels) => [['Code', 'Name', 'Unit', 'On hand', 'Reorder level', 'On order', 'Suggested order'], ...lowList(levels).map((x) => [x.code, x.name, x.unit, x.onHand, x.reorder, x.onOrder, x.suggest])];

  return { emptyOps, MOVE_KINDS, kindOf, makeMove, history, stockValue, lowList, countPlan, countMoves, IMPORT_COLUMNS, parseItems, TEMPLATE_HEAD, TEMPLATE_ROWS, stockCsvRows, movesCsvRows, lowCsvRows, onHand, stockLevels, suggestQty, poTotal, poReceivedValue, PO_FLOW, receive, recipeUsage, shortfalls, yieldPct, lots, pickFEFO, daysCover, pmStatus, downtime, aging, topDebtors, billsDue, addDays, days, r2 };
})();
