// Salary deduction for late arrival (Payroll). Pure functions, no DOM; used by payroll and by tests/late-deduction.test.js.
//   rate per minute = basic salary ÷ working days in the month ÷ hours a day ÷ 60
//   deduction       = rate per minute × minutes late
// Nothing is rounded along the way; the month's total is rounded to 2 decimals once.
// FORMAT: check the Employment Act 1955 (s24, deductions from wages) and the contract before turning this on for a company.
(function (root) {
  'use strict';
  const MODES = { all: 'All late minutes, counted from the start time', after: 'Only the minutes after the grace period' };
  const defaults = () => ({ on: false, grace: 10, mode: 'all', hours: 8 });
  // The company's settings with safe values (a broken number falls back to the default).
  function clean(s) {
    const d = defaults(), x = s || {};
    const grace = Number(x.grace), hours = Number(x.hours);
    return { on: !!x.on, grace: Number.isFinite(grace) && grace >= 0 ? Math.min(240, Math.round(grace)) : d.grace, mode: x.mode === 'after' ? 'after' : 'all', hours: Number.isFinite(hours) && hours > 0 ? Math.min(24, hours) : d.hours };
  }
  // Minutes that count for one day. Within the grace period nothing counts.
  //   grace 10: 8 min late → 0;  15 min late → 15 ("all") or 5 ("after").
  function dayMinutes(raw, s) {
    const c = clean(s), m = Math.max(0, Math.round(Number(raw) || 0));
    if (m <= c.grace) return 0;
    return c.mode === 'after' ? m - c.grace : m;
  }
  // Paid by the trip, day or hour: the monthly formula does not apply to them.
  const PER_UNIT = ['trip', 'day', 'daily', 'hour', 'hourly'];
  const perUnit = (e) => PER_UNIT.includes(String((e && (e.pay || e.payBasis)) || '').toLowerCase());
  const rateOf = (base, workingDays, hours) => (base > 0 && workingDays > 0 && hours > 0 ? base / workingDays / hours / 60 : 0);
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  /**
   * One person's month.
   *   base = the monthly basic salary; workingDays = the divisor (the company's "working days in the month");
   *   days = [{ day, raw, excused }] raw = minutes late from the shift start; excused = an approved waiver or leave.
   *   cancelled = a reason when an admin cancelled it for this person (then nothing is deducted).
   */
  function month({ base, workingDays, settings, days = [], employee = null, cancelled = '' }) {
    const c = clean(settings), out = { on: c.on, minutes: 0, rate: 0, amount: 0, rows: [], cancelled: '', skipped: '' };
    if (!c.on) return out;
    if (employee && perUnit(employee)) { out.skipped = 'per-unit pay'; return out; }
    out.rate = rateOf(Number(base) || 0, Number(workingDays) || 0, c.hours);
    out.rows = days.map((d) => { const counted = d.excused ? 0 : dayMinutes(d.raw, c); return { day: d.day, raw: Math.round(Number(d.raw) || 0), excused: !!d.excused, counted }; }).filter((r) => r.raw > 0);
    out.minutes = out.rows.reduce((s, r) => s + r.counted, 0);
    if (cancelled) { out.cancelled = String(cancelled); return out; }
    out.amount = r2(out.rate * out.minutes);
    return out;
  }
  const api = { MODES, defaults, clean, dayMinutes, perUnit, rateOf, month, r2 };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AllurusLateRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
