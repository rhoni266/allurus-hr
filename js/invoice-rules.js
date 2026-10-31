// Invoice rules (pure, no screen or database code; unit tested in tests/invoice-rules.test.js):
// units on lines, quantities, totals in sen, statuses and what each allows, payments, duplicating and numbering.
//
// Money: prices are stored in ringgit with 2 decimals, as before. Each line is worked out in whole sen and rounded
// once: line = round(qty × price in sen). Subtotal = sum of lines; tax = round(subtotal × rate%) once on the
// invoice, as before; total = subtotal + tax. Old invoices (whole quantities, 2-decimal prices) total exactly as before.
//
// Statuses: Draft (editable, can be deleted, not in reports) → Sent (locked; counts) → Partially paid → Paid,
// or Void (from Sent or Partially paid, with a reason; keeps its number). Overdue is shown, not stored.
// Credit, debit and refund notes are 'Issued' when made and never edited.
window.AllurusInvoiceRules = (function () {
  'use strict';
  // code, label on screen, may the quantity have decimals, LHDN e-Invoice (UN/ECE) unit code.
  // The LHDN codes need checking against the MyInvois code list before going live.
  const UNITS = [
    ['pcs', 'pcs', false, 'H87'], ['kg', 'kg', true, 'KGM'], ['g', 'g', true, 'GRM'], ['l', 'l', true, 'LTR'], ['ml', 'ml', true, 'MLT'],
    ['m', 'm', true, 'MTR'], ['box', 'box', false, 'XBX'], ['pack', 'pack', false, 'XPK'], ['set', 'set', false, 'SET'], ['unit', 'unit', false, 'C62'],
    ['hour', 'hour', true, 'HUR'], ['day', 'day', true, 'DAY'], ['month', 'month', true, 'MON'], ['service', 'service', false, 'C62'], ['lot', 'lot', false, 'XLT'],
  ].map(([code, label, decimal, lhdn]) => ({ code, label, decimal, lhdn }));
  const DEFAULT_UNIT = 'unit';
  const unitOf = (code) => UNITS.find((u) => u.code === code) || UNITS.find((u) => u.code === DEFAULT_UNIT);
  // Up to 3 decimals for kg, l, hours…; whole numbers for pcs, box, set…
  function qtyError(qty, unit) {
    const q = Number(qty), u = unitOf(unit);
    if (!Number.isFinite(q) || q <= 0) return 'Enter a quantity above 0';
    if (!u.decimal && !Number.isInteger(q)) return `Quantity in ${u.label} must be a whole number`;
    if (u.decimal && Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) return 'Use at most 3 decimal places';
    return '';
  }
  const fmtQty = (qty, unit) => `${Number(qty).toLocaleString('en-MY', { maximumFractionDigits: 3 })} ${unitOf(unit).label}`;

  // ---------- Money in sen ----------
  const sen = (rm) => Math.round(Number((Number(rm) * 100).toFixed(4)));
  const rm = (s) => s / 100;
  const lineSen = (it) => Math.round(Number(it.qty) * sen(it.price));
  const paidSen = (inv) => (inv.payments || []).reduce((s, p) => s + sen(p.amount), 0);
  // The same shape as before (sub, tax, total, balance in ringgit), plus paid and due.
  function totals(inv) {
    const subS = (inv.items || []).reduce((s, it) => s + lineSen(it), 0);
    const taxS = Math.round((subS * (Number(inv.taxRate) || 0)) / 100);
    const totalS = subS + taxS, balanceS = totalS + sen(inv.adjust || 0);
    // Invoices paid before part payments existed have no payments list: Paid means paid in full.
    const paidS = inv.payments ? paidSen(inv) : inv.status === 'Paid' ? balanceS : 0;
    return { sub: rm(subS), tax: rm(taxS), total: rm(totalS), balance: rm(balanceS), paid: rm(paidS), due: rm(Math.max(0, balanceS - paidS)) };
  }

  // ---------- Statuses ----------
  const STATUSES = ['Draft', 'Sent', 'Partially paid', 'Paid', 'Void'];
  const isInvoice = (i) => (i.type || 'invoice') === 'invoice';
  const canEdit = (i) => isInvoice(i) && i.status === 'Draft';
  const canDelete = canEdit;
  const canSend = canEdit;
  const canPay = (i) => isInvoice(i) && ['Sent', 'Partially paid'].includes(i.status);
  const canVoid = (i) => isInvoice(i) && ['Sent', 'Partially paid'].includes(i.status) && !(i.payments || []).length;
  const counts = (i) => isInvoice(i) && i.status !== 'Draft' && i.status !== 'Void';  // in reports and receivables
  const shown = (i, today) => (['Sent', 'Partially paid'].includes(i.status) && i.due < today ? 'Overdue' : i.status);

  // A draft's problems before saving or sending ([] when fine).
  function draftErrors(d) {
    const e = [];
    if (!String(d.customer || '').trim()) e.push('Add the customer');
    if (!d.issue) e.push('Add the issue date');
    if (d.due && d.issue && d.due < d.issue) e.push('The due date must be on or after the issue date');
    const lines = (d.items || []).filter((it) => String(it.desc || '').trim() || it.qty || it.price);
    if (!lines.length) e.push('Add at least one item');
    lines.forEach((it, n) => {
      if (!String(it.desc || '').trim()) e.push(`Line ${n + 1}: add a description`);
      const q = qtyError(it.qty, it.unit); if (q) e.push(`Line ${n + 1}: ${q}`);
      const p = Number(it.price);
      if (!(p >= 0) || Math.abs(p * 100 - Math.round(p * 100)) > 1e-6) e.push(`Line ${n + 1}: price must be in ringgit with at most 2 decimals`);
    });
    return e;
  }

  // A payment: part or all of what's still due. Returns the new payments list and status, or an error.
  function pay(inv, amount, date, by) {
    if (!canPay(inv)) return { error: 'Only a sent invoice can be paid' };
    const t = totals(inv), a = sen(amount), dueS = sen(t.due);
    if (!(a > 0)) return { error: 'Enter an amount above zero' };
    if (a > dueS) return { error: `That’s more than the ${t.due.toFixed(2)} still due` };
    const payments = [...(inv.payments || []), { date, amount: rm(a), by: by || '' }];
    const status = a === dueS ? 'Paid' : 'Partially paid';
    return { payments, status, paidOn: status === 'Paid' ? date : '' };
  }

  // ---------- Duplicate: a new Draft with the same customer and lines ----------
  function duplicate(inv, { id, no, today, dueDays = 30, addDays }) {
    const items = (inv.items || []).map((it) => ({ desc: it.desc, qty: it.qty, unit: it.unit || DEFAULT_UNIT, price: it.price, classification: it.classification || '022' }));
    return {
      id, type: 'invoice', no, status: 'Draft', customer: inv.customer, contactId: inv.contactId || '', email: inv.email || '',
      issue: today, due: addDays(today, dueDays), items, taxRate: inv.taxRate, notes: inv.notes || '', currency: inv.currency || 'MYR',
      paidOn: '', payments: [], duplicatedFrom: { id: inv.id, no: inv.no }, einvoice: { status: 'Draft' },
    };
  }

  // ---------- Numbers: INV-YYYYMM-0001, the highest used that month + 1 (a deleted draft never causes a repeat) ----------
  function nextNo(list, prefix, monthKey) {
    const head = `${prefix}-${monthKey.replace('-', '')}-`;
    const max = list.reduce((m, x) => { const s = String(x.no || ''); if (!s.startsWith(head)) return m; const n = parseInt(s.slice(head.length), 10); return Number.isFinite(n) && n > m ? n : m; }, 0);
    return `${head}${String(max + 1).padStart(4, '0')}`;
  }

  // ---------- Last unit used per item (by description) ----------
  const itemKey = (desc) => String(desc || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  const rememberUnits = (memo, items) => { const m = { ...(memo || {}) }; (items || []).forEach((it) => { const k = itemKey(it.desc); if (k && it.unit) m[k] = it.unit; }); return m; };
  const unitFor = (memo, desc) => (memo || {})[itemKey(desc)] || '';

  // ---------- Amount in words, as on a Malaysian invoice ----------
  // 1234.5 → "Ringgit Malaysia One Thousand Two Hundred Thirty Four and Cents Fifty Only"; 0 → "Ringgit Malaysia Zero Only".
  const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function words(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
    if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${words(n % 100)}` : ''}`;
    for (const [size, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']]) {
      if (n >= size) return `${words(Math.floor(n / size))} ${name}${n % size ? ` ${words(n % size)}` : ''}`;
    }
    return '';
  }
  function amountInWords(amount) {
    const s = sen(amount), a = Math.abs(s), r = Math.floor(a / 100), c = a % 100;
    return `${s < 0 ? 'Minus ' : ''}Ringgit Malaysia ${words(r)}${c ? ` and Cents ${words(c)}` : ''} Only`;
  }

  return { amountInWords, UNITS, DEFAULT_UNIT, unitOf, qtyError, fmtQty, sen, lineSen, totals, STATUSES, isInvoice, canEdit, canDelete, canSend, canPay, canVoid, counts, shown, draftErrors, pay, duplicate, nextNo, rememberUnits, unitFor };
})();
