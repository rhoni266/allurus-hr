// Point of sale: the rules, with no DOM or network access, so they run under Node (tests/pos.test.js) and, later,
// in Cloud Functions. The screens are in js/pos.js.
//
// Money is always an integer number of sen (RM 12.90 = 1290), never a float. Rates are integer basis points
// (6% = 600), set per outlet and per item tax code; nothing here assumes a rate. Time zone Asia/Kuala_Lumpur.
//
// Card data: nothing in this module (or anywhere in Allurus) ever sees a card number, expiry, CVV, PIN, track or
// EMV data. Card payments are taken by a certified SoftPOS app or a separate terminal; we keep only the result:
// approved or declined, amount, brand, last 4 digits, approval code and the provider's transaction id.
(function (root) {
  'use strict';

  // ---------- Money ----------
  const isSen = (n) => Number.isInteger(n);
  // Ringgit typed by a person ("12.9", "12.90", 12.9) → sen, without float drift.
  function toSen(v) {
    const s = String(v ?? '').trim().replace(/,/g, '');
    if (!/^-?\d*(\.\d{0,2})?$/.test(s) || s === '' || s === '-' || s === '.') return NaN;
    const neg = s.startsWith('-'), [a, b = ''] = s.replace('-', '').split('.');
    const n = Number(a || 0) * 100 + Number((b + '00').slice(0, 2));
    return neg ? -n : n;
  }
  const fmt = (sen) => `${sen < 0 ? '-' : ''}RM ${(Math.abs(sen) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  // amount × basis points, rounded half up (away from zero), in sen.
  const bp = (amount, rateBp) => { const x = amount * rateBp; return Math.sign(x) * Math.floor((Math.abs(x) + 5000) / 10000); };
  // Cash is rounded to the nearest 5 sen (1–2 sen down, 3–4 sen up; 6–7 down to 5, 8–9 up). Only for cash.
  const roundCash = (sen) => { const r = ((sen % 5) + 5) % 5; return r <= 2 ? sen - r : sen + (5 - r); };
  // Split `total` across `weights` (integers) in proportion, so the parts always add up exactly (largest remainder).
  function allocate(total, weights) {
    const W = weights.reduce((s, w) => s + w, 0);
    if (!W) return weights.map((_, i) => (i === 0 ? total : 0));
    const raw = weights.map((w) => (total * w) / W), base = raw.map((x) => Math.floor(x));
    let left = total - base.reduce((s, x) => s + x, 0);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
    return base;
  }

  // ---------- Lines and totals ----------
  // A line: { itemId, name, qty, unitPrice (sen), modifiers: [{ name, priceDelta (sen) }], taxCode, status }.
  // A combo is one line whose modifiers are the chosen slot items (their priceDelta is the upgrade, usually 0).
  const unitWithMods = (l) => l.unitPrice + (l.modifiers || []).reduce((s, m) => s + (m.priceDelta || 0), 0);
  const lineGross = (l) => (l.status === 'void' ? 0 : unitWithMods(l) * l.qty);

  // Check a modifier choice against its group's min and max.
  function checkModifiers(groups, chosen) {
    const errs = [];
    groups.forEach((g) => {
      const n = chosen.filter((c) => c.groupId === g.id).length;
      if (n < (g.min || 0)) errs.push(`${g.name}: choose at least ${g.min}`);
      if (g.max && n > g.max) errs.push(`${g.name}: choose at most ${g.max}`);
    });
    return errs;
  }

  // Totals for an order. outlet: { taxes: { CODE: { rateBp, label } }, serviceCharge: { enabled, rateBp, orderTypes: [..],
  // taxCode } }. The discount rule (order.discountRule) is { kind: 'pct', value: bp } or { kind: 'amt', value: sen }, on the subtotal; it is
  // shared across the lines in proportion before tax, so tax is charged on what the customer actually pays.
  // Service charge is on the discounted subtotal, and taxed at its own tax code if it has one.
  function totals(order, outlet = {}) {
    const lines = (order.lines || []).filter((l) => l.status !== 'void');
    const gross = lines.map(lineGross), subtotal = gross.reduce((s, x) => s + x, 0);
    const d = order.discountRule;
    let discount = !d ? 0 : d.kind === 'pct' ? bp(subtotal, d.value) : Math.min(d.value, subtotal);
    discount = Math.max(0, Math.min(discount, subtotal));
    const lineDisc = allocate(discount, gross), net = gross.map((g, i) => g - lineDisc[i]), netSub = subtotal - discount;
    const sc = outlet.serviceCharge || {};
    const scApplies = !!sc.enabled && (!sc.orderTypes || sc.orderTypes.includes(order.type || 'dine_in'));
    const serviceCharge = scApplies ? bp(netSub, sc.rateBp || 0) : 0;
    const taxes = outlet.taxes || {}, byCode = {};
    lines.forEach((l, i) => { if (l.taxCode && taxes[l.taxCode]) byCode[l.taxCode] = (byCode[l.taxCode] || 0) + net[i]; });
    if (serviceCharge && sc.taxCode && taxes[sc.taxCode]) byCode[sc.taxCode] = (byCode[sc.taxCode] || 0) + serviceCharge;
    // Tax per code on the code's total (not per line), so the receipt's tax lines add up.
    const taxLines = Object.entries(byCode).map(([code, base]) => ({ code, label: taxes[code].label || code, rateBp: taxes[code].rateBp, base, tax: bp(base, taxes[code].rateBp) }));
    const tax = taxLines.reduce((s, t) => s + t.tax, 0);
    const total = netSub + serviceCharge + tax;
    return { subtotal, discount, serviceCharge, tax, taxLines, total, lineNet: net };
  }

  // ---------- Payments on an order ----------
  // Methods. `server` methods may only be approved by the server (a verified webhook or status query), never by the
  // POS itself. The others are recorded by the cashier and are flagged for reconciliation unless they are cash.
  const METHODS = {
    cash: { label: 'Cash', server: false, manual: false },
    card_tap: { label: 'Card (tap on phone)', server: true, manual: false },
    card_external: { label: 'Card (terminal)', server: false, manual: true },
    duitnow_qr: { label: 'DuitNow QR', server: true, manual: false },
    qr_manual: { label: 'QR (confirmed by cashier)', server: false, manual: true },
    ewallet: { label: 'E-wallet', server: true, manual: false },
    ewallet_manual: { label: 'E-wallet (confirmed by cashier)', server: false, manual: true },
    other: { label: 'Other', server: false, manual: true },
  };
  const STATUSES = ['pending', 'approved', 'declined', 'cancelled', 'refunded', 'expired'];
  const NEXT = { pending: ['approved', 'declined', 'cancelled', 'expired'], approved: ['refunded'], declined: [], cancelled: [], expired: [], refunded: [] };
  // Whether a payment may move from one status to another, and who may do it: 'client' (the POS) or 'server'.
  function canTransition(p, to, by = 'client') {
    if (!NEXT[p.status]?.includes(to)) return false;
    if (to === 'approved' && METHODS[p.method]?.server && by !== 'server') return false;
    if (to === 'refunded' && METHODS[p.method]?.server && by !== 'server') return false;
    return true;
  }

  // Where an order stands with its approved payments. Cash rounding applies only when cash settles the balance:
  // the part already paid by card or QR is exact, and the rest is rounded to 5 sen if paid in cash.
  //   payments: [{ method, amount (sen, what was applied to the bill), tendered? (cash handed over), status, tip? }]
  function settle(total, payments) {
    const ok = payments.filter((p) => p.status === 'approved');
    const nonCash = ok.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
    const cashApplied = ok.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    const tendered = ok.filter((p) => p.method === 'cash').reduce((s, p) => s + (p.tendered ?? p.amount), 0);
    const tips = ok.reduce((s, p) => s + (p.tip || 0), 0);
    const exactLeft = Math.max(0, total - nonCash);
    // If cash is (or will be) used for what is left, that remainder is due rounded.
    const cashDue = roundCash(exactLeft);
    const rounding = cashApplied > 0 || exactLeft === 0 ? cashDue - exactLeft : 0;
    const due = nonCash + (cashApplied > 0 ? cashDue : exactLeft);
    const paid = nonCash + cashApplied;
    const balance = Math.max(0, due - paid);
    const change = Math.max(0, tendered - cashApplied);
    return { total, due, paid, balance, rounding: paid >= due ? rounding : 0, change, tips, fullyPaid: total === 0 || paid >= due };
  }
  // What a cash payment applies to the bill when `tendered` is handed over for an order with this balance left
  // (exact, before rounding): the rounded balance, or all of it if it's a part payment.
  function cashApply(exactLeft, tendered) {
    const due = roundCash(exactLeft);
    return tendered >= due ? { amount: due, change: tendered - due, rounding: due - exactLeft } : { amount: tendered, change: 0, rounding: 0, partial: true };
  }

  // ---------- Provider adapter ----------
  // Everything else in the POS talks only to a PaymentProvider:
  //   createPayment(order, amount, method, { idempotencyKey }) → payment fields (pending or approved)
  //   getStatus(payment) → { status, ...result }   cancel(payment)   refund(payment, amount)   parseWebhook(request)
  // Providers here: cash, recorded methods (external card terminal, QR or e-wallet confirmed by the cashier), and a
  // mock SoftPOS used by the tests and the demo. The real SoftPOS and the DuitNow QR gateway plug in later
  // (Phase 2 and 3) behind the same interface, running in Cloud Functions.
  const SAFE_RESULT = ['status', 'approvalCode', 'cardBrand', 'cardLast4', 'providerTxnId', 'qrReference', 'declineReason'];
  // Keep only the fields we're allowed to hold; anything else a provider or bridge returns is dropped.
  function safeResult(r = {}) {
    const out = {};
    SAFE_RESULT.forEach((k) => { if (r[k] != null) out[k] = String(r[k]).slice(0, 64); });
    if (out.cardLast4 && !/^\d{4}$/.test(out.cardLast4)) delete out.cardLast4;
    return out;
  }
  // A string that looks like a full card number (13–19 digits, Luhn-valid) is refused anywhere we take free text.
  function looksLikePan(s) {
    const d = String(s || '').replace(/[\s-]/g, '');
    const runs = d.match(/\d{13,19}/g) || [];
    return runs.some((r) => { let sum = 0; for (let i = 0; i < r.length; i++) { let x = +r[r.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; } return sum % 10 === 0; });
  }

  function recordedProvider(method) {
    return {
      id: method === 'cash' ? 'cash' : 'recorded',
      createPayment(order, amount, m, { idempotencyKey, approvalCode = '', cardLast4 = '', cardBrand = '', reference = '' } = {}) {
        if (m !== 'cash' && [approvalCode, reference].some(looksLikePan)) throw new Error('That looks like a card number. Enter only the approval code and the last 4 digits.');
        if (cardLast4 && !/^\d{4}$/.test(cardLast4)) throw new Error('Last 4 digits only');
        return { method: m, amount, status: 'approved', provider: this.id, idempotencyKey, manual: !!METHODS[m]?.manual, reconcile: !!METHODS[m]?.manual,
          ...safeResult({ approvalCode, cardLast4, cardBrand, qrReference: reference }) };
      },
      getStatus: (p) => ({ status: p.status }),
      cancel: (p) => ({ status: p.status === 'pending' ? 'cancelled' : p.status }),
      refund: (p, amount) => ({ status: 'refunded', amount }),
      parseWebhook: () => { throw new Error('Recorded payments have no webhook'); },
    };
  }

  // A stand-in SoftPOS for tests and the demo. `script` decides the outcome of each attempt: 'approve', 'decline',
  // 'cancel', 'timeout', 'pin' (needs PIN; approves after), 'nonfc', or 'killed' (the app dies mid-payment; the
  // provider still approves it, and we find out by querying with the idempotency key).
  function mockSoftPos(script = []) {
    const ledger = new Map(); let n = 0;
    const next = () => script.shift() || 'approve';
    return {
      id: 'mock-softpos', ledger,
      // The native bridge call: returns only the safe result, never card data.
      startCardPayment(amount, reference) {
        const outcome = next();
        if (outcome === 'nonfc') return { status: 'error', declineReason: 'This device has no NFC' };
        const txn = { providerTxnId: `MOCK${++n}`, amount, reference };
        if (outcome === 'cancel') return { status: 'cancelled' };
        if (outcome === 'timeout') return { status: 'timeout' };
        if (outcome === 'decline') { ledger.set(reference, { ...txn, status: 'declined' }); return safeResult({ status: 'declined', declineReason: 'Declined by issuer', providerTxnId: txn.providerTxnId }); }
        const ok = { ...txn, status: 'approved', approvalCode: String(100000 + n), cardBrand: 'VISA', cardLast4: '4242', pan: '4242424242424242' };
        ledger.set(reference, ok);
        if (outcome === 'killed') throw new Error('App closed during payment');
        return safeResult(ok);
      },
      // The provider's server-side query, by our idempotency key.
      queryByReference(reference) { const t = ledger.get(reference); return t ? safeResult(t) : { status: 'not_found' }; },
      refund(reference, amount) { const t = ledger.get(reference); if (!t || t.status !== 'approved') return { status: 'error' }; t.status = 'refunded'; t.refunded = amount; return { status: 'refunded' }; },
    };
  }
  // The card flow: the pending payment exists first (with its idempotency key), then the bridge is called, then the
  // result is confirmed with the provider's query before the payment changes. Returns the payment's new fields.
  function runCardPayment(provider, payment) {
    let r;
    try { r = provider.startCardPayment(payment.amount, payment.idempotencyKey); } catch (e) { return recoverCardPayment(provider, payment); }
    if (['cancelled', 'timeout', 'error'].includes(r.status)) {
      // A timeout may still have gone through: ask the provider before giving up.
      if (r.status === 'timeout') { const q = provider.queryByReference(payment.idempotencyKey); if (q.status === 'approved') return { ...safeResult(q), status: 'approved' }; }
      return { status: 'cancelled', declineReason: r.declineReason || (r.status === 'timeout' ? 'Timed out' : 'Cancelled') };
    }
    const confirmed = provider.queryByReference(payment.idempotencyKey);
    return confirmed.status === r.status ? { ...safeResult(confirmed) } : { status: 'pending', declineReason: 'Waiting for the provider to confirm' };
  }
  // After the app was killed: a payment still pending is settled by asking the provider with its idempotency key.
  function recoverCardPayment(provider, payment) {
    const q = provider.queryByReference(payment.idempotencyKey);
    if (q.status === 'approved' || q.status === 'declined') return safeResult(q);
    return { status: 'pending', declineReason: 'Not confirmed yet; check again' };
  }

  // ---------- Shifts ----------
  // Expected cash in the drawer = opening float + cash taken (after change) − cash refunds + cash in − cash out.
  function shiftSummary(shift, payments, refunds = []) {
    const mine = payments.filter((p) => p.shiftId === shift.id && p.status !== 'declined' && p.status !== 'cancelled');
    const cash = mine.filter((p) => p.method === 'cash' && ['approved', 'refunded'].includes(p.status)).reduce((s, p) => s + p.amount + (p.tip || 0), 0);
    const cashRefunds = refunds.filter((r) => r.shiftId === shift.id && r.method === 'cash' && r.status === 'approved').reduce((s, r) => s + r.amount, 0);
    const ins = (shift.cashMoves || []).filter((m) => m.kind === 'in').reduce((s, m) => s + m.amount, 0);
    const outs = (shift.cashMoves || []).filter((m) => m.kind === 'out').reduce((s, m) => s + m.amount, 0);
    const expectedCash = (shift.openingCash || 0) + cash - cashRefunds + ins - outs;
    const byMethod = {};
    mine.filter((p) => p.status === 'approved' || p.status === 'refunded').forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });
    const counted = shift.countedCash;
    return { expectedCash, cashSales: cash, cashRefunds, cashIn: ins, cashOut: outs, byMethod, variance: counted == null ? null : counted - expectedCash };
  }

  // ---------- Stock ----------
  // Stock movements (in the Operations stock list) for an order's lines. A menu item's recipe is [{ itemId, qty }]
  // per portion, and modifiers can carry their own recipe (extra shot). reason 'sale' takes stock off; 'void' puts
  // it back. Movements are keyed so the same order line is never deducted twice.
  function stockMoves(order, menuById, reason = 'sale', date = '') {
    const sign = reason === 'void' ? 1 : -1, out = [];
    (order.lines || []).forEach((l) => {
      if (reason === 'sale' && l.status === 'void') return;
      const mi = menuById[l.itemId];
      const recipe = [...(mi?.recipe || []), ...(l.modifiers || []).flatMap((m) => m.recipe || [])];
      recipe.forEach((r, k) => out.push({ id: `pos-${order.id}-${l.id}-${k}-${r.itemId}-${reason}`, itemId: r.itemId, date, qty: Math.round(sign * r.qty * l.qty * 1000) / 1000, ref: order.no || order.id, note: reason === 'void' ? 'POS void: stock back' : 'POS sale', source: 'pos', orderId: order.id }));
    });
    return out;
  }
  // Add movements once: ids already in the list are skipped.
  function addMoves(list, moves) { const have = new Set(list.map((m) => m.id)); moves.forEach((m) => { if (!have.has(m.id)) { list.push(m); have.add(m.id); } }); return list; }

  // ---------- Receipt numbers ----------
  // Sequential per outlet, never reused: B1-000123. In the cloud this counter lives in a transaction on the server.
  function nextReceiptNo(seq, outletCode) { const n = (seq[outletCode] || 0) + 1; seq[outletCode] = n; return `${outletCode}-${String(n).padStart(6, '0')}`; }

  // ---------- Offline queue ----------
  // Orders made offline wait in a queue with their clientOrderId (idempotency key); syncing adds each once.
  function mergeQueued(orders, queued) {
    const have = new Set(orders.map((o) => o.clientOrderId));
    const added = [];
    queued.forEach((q) => { if (!have.has(q.clientOrderId)) { orders.push(q); have.add(q.clientOrderId); added.push(q.clientOrderId); } });
    return { orders, added, skipped: queued.length - added.length };
  }
  // Card and QR need a connection; cash and recorded methods work offline.
  const methodAllowed = (method, online) => online || !(METHODS[method]?.server);

  // ---------- Permissions ----------
  // POS roles (account.posRole). An admin with the pos area and no posRole counts as manager.
  const ROLE_CAN = {
    manager: ['order', 'pay', 'discount', 'discount_over_limit', 'void', 'refund', 'price', 'menu', 'settings', 'shift', 'reports', 'kitchen', 'approve'],
    cashier: ['order', 'pay', 'discount', 'shift', 'kitchen'],
    waiter: ['order', 'kitchen'],
    kitchen: ['kitchen'],
  };
  const canDo = (posRole, action) => !!ROLE_CAN[posRole]?.includes(action);
  // Whether a discount needs a manager: above the outlet's limit for cashiers (limitBp of the subtotal).
  const discountNeedsManager = (posRole, discountSen, subtotal, limitBp) => !canDo(posRole, 'discount_over_limit') && discountSen > bp(subtotal, limitBp || 0);

  // ---------- Reports and Finance ----------
  // Sales for a day (yyyy-mm-dd, by the order's paidAt in Kuala Lumpur time).
  const klDay = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 10);
  const klHour = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).getUTCHours();
  function daySales(orders, payments, day) {
    const paid = orders.filter((o) => o.status === 'paid' && o.paidAt && klDay(o.paidAt) === day);
    const ids = new Set(paid.map((o) => o.id));
    const pays = payments.filter((p) => ids.has(p.orderId) && (p.status === 'approved' || p.status === 'refunded'));
    const sum = (f) => paid.reduce((s, o) => s + (f(o) || 0), 0);
    const byMethod = {}, byHour = {}, byItem = {}, byCashier = {};
    pays.forEach((p) => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });
    paid.forEach((o) => {
      const h = klHour(o.paidAt); byHour[h] = (byHour[h] || 0) + o.total;
      byCashier[o.createdBy] = (byCashier[o.createdBy] || 0) + o.total;
      (o.lines || []).filter((l) => l.status !== 'void').forEach((l) => { const k = l.itemId; byItem[k] = byItem[k] || { name: l.name, qty: 0, sales: 0 }; byItem[k].qty += l.qty; byItem[k].sales += lineGross(l); });
    });
    const tips = pays.reduce((s, p) => s + (p.tip || 0), 0);
    return { day, orders: paid.length, gross: sum((o) => o.subtotal), discount: sum((o) => o.discount), serviceCharge: sum((o) => o.serviceCharge), tax: sum((o) => o.tax), rounding: sum((o) => o.rounding), total: sum((o) => o.total + (o.rounding || 0)), tips, byMethod, byHour, byItem, byCashier,
      voids: orders.filter((o) => o.status === 'void' && o.voidedAt && klDay(o.voidedAt) === day).length };
  }
  // The day's posting to Finance (the single-entry book, finance.txns): one entry per payment method for the sales
  // (net of service charge and tax, with that method's share of the tax in `tax`), one for service charge, one for
  // cash rounding and one for tips (owed to staff). Each has a fixed ref, so posting the same day twice adds nothing.
  function financeEntries(sum, labels = {}) {
    const methods = Object.keys(sum.byMethod).filter((m) => sum.byMethod[m]).sort();
    const collected = methods.map((m) => sum.byMethod[m]);
    const salesNet = sum.gross - sum.discount, ref = (k) => `POS-${sum.day.replace(/-/g, '')}-${k}`;
    // Collected = sales + service charge + tax + rounding (tips are on top). Share sales and tax across methods.
    const salesShare = allocate(salesNet, collected), taxShare = allocate(sum.tax, collected);
    const out = methods.map((m, i) => ({ date: sum.day, type: 'in', category: 'Product sales', desc: `POS sales, ${labels[m] || METHODS[m]?.label || m}`, amount: salesShare[i] / 100, tax: taxShare[i] / 100, ref: ref(m), source: 'pos', method: m }));
    if (sum.serviceCharge) out.push({ date: sum.day, type: 'in', category: 'Other income', desc: 'POS service charge', amount: sum.serviceCharge / 100, tax: 0, ref: ref('svc'), source: 'pos' });
    if (sum.rounding) out.push({ date: sum.day, type: 'in', category: 'Other income', desc: 'POS cash rounding', amount: sum.rounding / 100, tax: 0, ref: ref('rnd'), source: 'pos' });
    if (sum.tips) out.push({ date: sum.day, type: 'in', category: 'Other income', desc: 'POS tips (payable to staff)', amount: sum.tips / 100, tax: 0, ref: ref('tip'), source: 'pos' });
    return out;
  }
  // Payment reconciliation: recorded (manual) payments and server ones without a provider id, to check against
  // the provider's settlement report.
  const toReconcile = (payments) => payments.filter((p) => p.status === 'approved' && (p.reconcile || (METHODS[p.method]?.server && !p.providerTxnId)));

  // ---------- Subscription ----------
  // An expired, suspended or cancelled company takes no new orders or payments (same as js/billing-rules.js and
  // the working() rule in firestore.rules).
  const canTrade = (effectiveStatus) => ['trial', 'active', 'past_due', undefined, null, ''].includes(effectiveStatus);

  // ---------- CSV ----------
  const csv = (rows) => rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');

  const api = { isSen, toSen, fmt, bp, roundCash, allocate, unitWithMods, lineGross, checkModifiers, totals, METHODS, STATUSES, canTransition, settle, cashApply,
    safeResult, looksLikePan, recordedProvider, mockSoftPos, runCardPayment, recoverCardPayment, shiftSummary, stockMoves, addMoves, nextReceiptNo,
    mergeQueued, methodAllowed, ROLE_CAN, canDo, discountNeedsManager, klDay, klHour, daySales, financeEntries, toReconcile, canTrade, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AllurusPosRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
