// Claims rules: claim categories, mileage, limits per claim / month / year (and the medical policy's own limits),
// HR edits with a logged reason, the payroll split (taxable or not), postings to the books by GL category,
// reports, and the migration from the old medical-only claims. Pure functions with no DOM access, unit tested in
// tests/claims.test.js.
window.AllurusClaimRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const sum = (list, f) => r2(list.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const PAID = ['Approved', 'Paid'];

  // Optional fields a category can ask for on each line, besides date, merchant, receipt number and amount.
  const FIELDS = {
    purpose: 'Business purpose', from: 'From', to: 'To', km: 'Distance (km)', vehicle: 'Vehicle',
    location: 'City or venue', nights: 'Nights', attendees: 'Who attended', patient: 'Treatment for',
  };
  // Typical Malaysian SME expense policy. Every limit is a starting point for the company to change; 0 = no limit.
  // gl is the expense category in the books (js/finance.js EXPENSE_CATS).
  // FORMAT: verify against LHDN guidance (hasil.gov.my) before production: reimbursed business expenses are
  // generally not the employee's income, but some reimbursements (for example private benefits) are taxable perquisites.
  const DEFAULT_CATEGORIES = [
    { id: 'travel', name: 'Travel', note: 'Flights, trains, buses, taxis and e-hailing for work.', perClaim: 0, perMonth: 1500, perYear: 0, receipt: true, taxable: false, gl: 'Travel', fields: ['purpose', 'from', 'to'] },
    { id: 'mileage', name: 'Mileage', note: 'Using your own car or motorcycle for work. Distance × the company rate.', perClaim: 0, perMonth: 800, perYear: 0, receipt: false, taxable: false, gl: 'Travel', fields: ['purpose', 'from', 'to', 'km', 'vehicle'], mileage: true },
    { id: 'meals', name: 'Meals', note: 'Meals while travelling or working late for the company.', perClaim: 60, perMonth: 300, perYear: 0, receipt: true, taxable: false, gl: 'Travel', fields: ['purpose'] },
    { id: 'parking', name: 'Parking & toll', note: 'Parking and toll charges on work trips. A Touch ’n Go statement works as a receipt.', perClaim: 0, perMonth: 300, perYear: 0, receipt: true, taxable: false, gl: 'Travel', fields: ['purpose', 'location'] },
    { id: 'accommodation', name: 'Accommodation', note: 'Hotels on work trips.', perClaim: 0, perMonth: 1500, perYear: 0, receipt: true, taxable: false, gl: 'Travel', fields: ['purpose', 'location', 'nights'] },
    { id: 'phone', name: 'Phone', note: 'Work share of your mobile plan.', perClaim: 0, perMonth: 100, perYear: 0, receipt: true, taxable: false, gl: 'Utilities', fields: [] },
    { id: 'training', name: 'Training', note: 'Courses, exams and books agreed with your manager.', perClaim: 0, perMonth: 0, perYear: 2000, receipt: true, taxable: false, gl: 'Training', fields: ['purpose'] },
    { id: 'entertainment', name: 'Entertainment', note: 'Meals and events with clients.', perClaim: 300, perMonth: 500, perYear: 0, receipt: true, taxable: false, gl: 'Entertainment', fields: ['purpose', 'attendees'] },
    { id: 'medical', name: 'Medical', note: 'Clinic, dental, optical and other medical costs under the medical policy.', perClaim: 0, perMonth: 0, perYear: 0, receipt: true, taxable: false, gl: 'Staff benefits', fields: ['patient'], medical: true },
    { id: 'other', name: 'Other', note: 'Anything else agreed with your manager. Explain it in the purpose.', perClaim: 200, perMonth: 0, perYear: 0, receipt: true, taxable: false, gl: 'Other expenses', fields: ['purpose'] },
  ];
  const defaultCategories = () => DEFAULT_CATEGORIES.map((c) => ({ ...c, fields: [...c.fields], builtin: true, on: true }));
  // Company mileage rates in RM per km (a company policy, not a statutory rate).
  const defaultMileage = () => ({ car: 0.6, motorcycle: 0.3 });
  const VEHICLES = { car: 'Car', motorcycle: 'Motorcycle' };
  const mileageAmount = (km, vehicle, rates = defaultMileage()) => r2(Math.max(0, Number(km) || 0) * (Number(rates[vehicle]) || 0));

  // ---------- Totals ----------
  const claimTotal = (c) => sum(c.lines || [], (l) => l.amount);
  const approvedTotal = (c) => sum(c.lines || [], (l) => (l.approved == null ? 0 : l.approved));
  const monthOf = (d) => (d || '').slice(0, 7), yearOf = (d) => (d || '').slice(0, 4);
  // Lines from other claims that count against a person's limits (approved or paid; pending shown separately).
  function usage(claims, empId, { cat, sub = '', month = '', year = '', exceptId = '' }) {
    const lines = claims.filter((c) => c.empId === empId && c.id !== exceptId).flatMap((c) => (c.lines || []).map((l) => ({ c, l })))
      .filter(({ l }) => l.cat === cat && (!sub || l.sub === sub) && (!month || monthOf(l.date) === month) && (!year || yearOf(l.date) === year));
    return {
      used: sum(lines.filter(({ c }) => PAID.includes(c.status)), ({ l }) => (l.approved == null ? l.amount : l.approved)),
      pending: sum(lines.filter(({ c }) => c.status === 'Pending'), ({ l }) => l.amount),
    };
  }
  /**
   * The most that can be approved on each line under the limits, taking lines of the same category in order.
   * cats = categories; medicalTypes = the medical policy's types ({ id, perClaim, annual }).
   * Returns [{ lineId, max, capped: [reasons] }], plus per-category { month and year left before this claim }.
   */
  function limitsFor(claim, { cats, claims, medicalTypes = [] }) {
    const left = {};
    const key = (...k) => k.join('|');
    const get = (k, init) => (left[k] === undefined ? (left[k] = init()) : left[k]);
    const lines = (claim.lines || []).map((l) => {
      const cat = cats.find((c) => c.id === l.cat) || { perClaim: 0, perMonth: 0, perYear: 0 };
      const caps = [];
      const take = (k, init, label) => { if (init === null) return; const v = get(k, init); caps.push({ k, v, label }); };
      if (cat.perClaim) take(key('claim', l.cat), () => cat.perClaim, `${cat.name} per-claim limit`);
      if (cat.perMonth) take(key('month', l.cat, monthOf(l.date)), () => Math.max(0, r2(cat.perMonth - usage(claims, claim.empId, { cat: l.cat, month: monthOf(l.date), exceptId: claim.id }).used)), `${cat.name} monthly limit`);
      if (cat.perYear) take(key('year', l.cat, yearOf(l.date)), () => Math.max(0, r2(cat.perYear - usage(claims, claim.empId, { cat: l.cat, year: yearOf(l.date), exceptId: claim.id }).used)), `${cat.name} yearly limit`);
      if (cat.medical && l.sub) {
        const t = medicalTypes.find((x) => x.id === l.sub);
        if (t?.perClaim) take(key('mclaim', l.sub), () => t.perClaim, `${t.name} per-claim limit`);
        if (t?.annual) take(key('myear', l.sub, yearOf(l.date)), () => Math.max(0, r2(t.annual - usage(claims, claim.empId, { cat: 'medical', sub: l.sub, year: yearOf(l.date), exceptId: claim.id }).used)), `${t.name} yearly limit`);
      }
      const max = r2(Math.max(0, Math.min(Number(l.amount) || 0, ...caps.map((c) => c.v))));
      caps.forEach((c) => { left[c.k] = r2(left[c.k] - max); });
      return { lineId: l.id, max, capped: caps.filter((c) => c.v < (Number(l.amount) || 0)).map((c) => c.label) };
    });
    return { lines, max: sum(lines, (x) => x.max) };
  }
  // What a person has left in each category this month and year (for the employee and the approver).
  function remaining({ empId, cats, claims, date, exceptId = '' }) {
    return cats.filter((c) => c.on !== false && !c.medical).map((c) => {
      const m = usage(claims, empId, { cat: c.id, month: monthOf(date), exceptId }), y = usage(claims, empId, { cat: c.id, year: yearOf(date), exceptId });
      return { cat: c.id, name: c.name, perMonth: c.perMonth, perYear: c.perYear, monthUsed: m.used, yearUsed: y.used, pending: m.pending,
        monthLeft: c.perMonth ? Math.max(0, r2(c.perMonth - m.used)) : null, yearLeft: c.perYear ? Math.max(0, r2(c.perYear - y.used)) : null };
    });
  }

  // ---------- Checks and edits ----------
  // Problems that stop a claim being submitted.
  function validate(claim, cats) {
    const errs = [];
    if (!(claim.lines || []).length) errs.push('Add at least one item.');
    (claim.lines || []).forEach((l, i) => {
      const cat = cats.find((c) => c.id === l.cat), n = `Item ${i + 1}`;
      if (!cat) { errs.push(`${n}: pick a category.`); return; }
      if (!(Number(l.amount) > 0)) errs.push(`${n}: enter the amount.`);
      if (!l.date) errs.push(`${n}: enter the date.`);
      if (cat.receipt && !l.img) errs.push(`${n}: ${cat.name} needs a photo of the receipt.`);
      if (cat.mileage && !(Number(l.fields?.km) > 0)) errs.push(`${n}: enter the distance.`);
      if (cat.medical && !l.sub) errs.push(`${n}: pick the medical claim type.`);
    });
    return errs;
  }
  const EDITABLE = { amount: 'Amount', approved: 'Approved amount', receiptNo: 'Receipt number', merchant: 'Merchant' };
  // HR edits a line. A reason is required; the change is logged with who and when.
  function applyEdit(claim, { lineId, field, value, reason, by, byName, at }) {
    if (!EDITABLE[field]) throw new Error('This field cannot be edited');
    if (!String(reason || '').trim()) throw new Error('Give a reason for the change');
    const line = (claim.lines || []).find((l) => l.id === lineId);
    if (!line) throw new Error('Item not found');
    const v = ['amount', 'approved'].includes(field) ? r2(Math.max(0, Number(value) || 0)) : String(value || '').trim();
    const from = line[field] == null ? '' : line[field];
    if (String(from) === String(v)) return { claim, changed: false };
    const lines = claim.lines.map((l) => (l.id === lineId ? { ...l, [field]: v } : l));
    return { claim: { ...claim, lines, edits: [...(claim.edits || []), { lineId, field, from, to: v, reason: reason.trim(), by, byName, at }] }, changed: true };
  }

  // ---------- Payroll and the books ----------
  // Approved claims for one pay run, split into taxable (added to gross pay, so PCB applies) and not taxed
  // (reimbursed on top of net pay), with the amount per GL category for the books.
  // FORMAT: verify which reimbursements are taxable perquisites against LHDN guidance before production.
  function payrollSplit(claims, cats) {
    const out = { ids: [], taxable: 0, nonTaxable: 0, byGL: {}, taxableCats: [] };
    claims.forEach((c) => {
      out.ids.push(c.id);
      (c.lines || []).forEach((l) => {
        const amt = Number(l.approved) || 0; if (!amt) return;
        const cat = cats.find((x) => x.id === l.cat) || { gl: 'Other expenses', taxable: false, name: 'Claim' };
        if (cat.taxable) { out.taxable = r2(out.taxable + amt); if (!out.taxableCats.includes(cat.name)) out.taxableCats.push(cat.name); }
        else out.nonTaxable = r2(out.nonTaxable + amt);
        out.byGL[cat.gl] = r2((out.byGL[cat.gl] || 0) + amt);
      });
    });
    return out;
  }
  // Rows for the books when a claim is paid outside payroll: one per GL category.
  function glRows(claim, cats) {
    const s = payrollSplit([claim], cats);
    return Object.entries(s.byGL).map(([gl, amount]) => ({ gl, amount }));
  }

  // ---------- Reports ----------
  const GROUPS = { employee: 'Employee', category: 'Category', department: 'Department', month: 'Month' };
  // Claimed and approved amounts per group, from lines (so a trip with several categories splits properly).
  function report(claims, { by = 'category', year = '', statuses = ['Pending', 'Approved', 'Paid'], employees = [], cats = [], departments = [] }) {
    const rows = {};
    claims.filter((c) => statuses.includes(c.status)).forEach((c) => (c.lines || []).forEach((l) => {
      if (year && yearOf(l.date) !== String(year)) return;
      const e = employees.find((x) => x.id === c.empId);
      const k = by === 'employee' ? c.empId : by === 'department' ? e?.dept || '' : by === 'month' ? monthOf(l.date) : l.cat;
      const label = by === 'employee' ? `${e?.first || ''} ${e?.last || ''}`.trim() || c.empId : by === 'department' ? departments.find((d) => d.id === k)?.name || 'No department' : by === 'month' ? k : cats.find((x) => x.id === k)?.name || k;
      const r = rows[k] = rows[k] || { key: k, label, claims: new Set(), lines: 0, claimed: 0, approved: 0 };
      r.claims.add(c.id); r.lines++; r.claimed = r2(r.claimed + (Number(l.amount) || 0));
      if (PAID.includes(c.status)) r.approved = r2(r.approved + (Number(l.approved) || 0));
    }));
    const list = Object.values(rows).map((r) => ({ ...r, claims: r.claims.size })).sort((a, b) => (by === 'month' ? a.key.localeCompare(b.key) : b.claimed - a.claimed));
    return { by, rows: list, totals: { claims: new Set(claims.filter((c) => statuses.includes(c.status) && (c.lines || []).some((l) => !year || yearOf(l.date) === String(year))).map((c) => c.id)).size, lines: sum(list, (r) => r.lines), claimed: sum(list, (r) => r.claimed), approved: sum(list, (r) => r.approved) } };
  }
  const cell = (v) => { const s = v == null ? '' : typeof v === 'number' ? v.toFixed(2) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function reportCSV(rep) {
    const rows = [[GROUPS[rep.by], 'Claims', 'Items', 'Claimed (RM)', 'Approved (RM)'], ...rep.rows.map((r) => [r.label, String(r.claims), String(r.lines), r.claimed, r.approved]), ['TOTAL', String(rep.totals.claims), String(rep.totals.lines), rep.totals.claimed, rep.totals.approved]];
    return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- Migration ----------
  // Old medical claims (one amount, a medical type) become one-line claims in the Medical category.
  function migrateLegacy(c, medicalTypes = []) {
    if (c.lines) return c;
    const t = medicalTypes.find((x) => x.id === c.type);
    const line = { id: `${c.id}-1`, cat: 'medical', sub: c.type, date: c.date, merchant: c.provider || '', receiptNo: '', amount: r2(c.amount), approved: c.approved == null ? null : r2(c.approved), img: c.img || null, notes: c.notes || '', fields: { patient: c.patient || 'Self' } };
    const { type, provider, amount, img, patient, notes, ...rest } = c;
    return { ...rest, title: t ? t.name : 'Medical claim', lines: [line], approved: c.approved == null ? null : r2(c.approved), chain: c.chain || [], edits: c.edits || [] };
  }

  return { FIELDS, VEHICLES, GROUPS, DEFAULT_CATEGORIES, defaultCategories, defaultMileage, mileageAmount, claimTotal, approvedTotal, usage, limitsFor, remaining, validate, EDITABLE, applyEdit, payrollSplit, glRows, report, reportCSV, migrateLegacy };
})();
