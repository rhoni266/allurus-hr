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
      if (now > 0) moves.push({ id: ids(), itemId: l.itemId, date, qty: now, ref: po.no, note: 'Received' });
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

  return { onHand, stockLevels, suggestQty, poTotal, poReceivedValue, PO_FLOW, receive, recipeUsage, shortfalls, yieldPct, lots, pickFEFO, daysCover, pmStatus, downtime, aging, topDebtors, billsDue, addDays, days, r2 };
})();
