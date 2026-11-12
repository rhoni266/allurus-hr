// Salary basis (docs/SALARY-BASIS-SPEC.md). The STORED salary is always the yearly figure, as it has always been: payroll, EPF, SOCSO,
// PCB, reports and payslips do not change. These functions only convert at the edge, where a person types or reads a salary, in whole
// sen so nothing drifts. Pure: no DOM, unit tested in tests/salary-basis.test.js.
(function (root) {
  'use strict';
  const sen = (n) => Math.round((Number(n) || 0) * 100);
  const MIN_WAGE_DEFAULT = 1700;      // RM a month: the current national minimum wage. A setting (settings.minWage), never hard-coded elsewhere.

  // The basis a company uses: 'monthly' (default) or 'yearly'. A company with the add-on salaryMonthlyOnly is always monthly.
  const basisOf = (settings, addons) => (addons && addons.salaryMonthlyOnly === true ? 'monthly' : settings && settings.salaryBasis === 'yearly' ? 'yearly' : 'monthly');
  const lockedMonthly = (addons) => !!(addons && addons.salaryMonthlyOnly === true);

  // yearly (stored) → monthly, to the nearest sen. monthly → yearly is exact: sen × 12.
  const monthlyOfYearly = (yearly) => Math.round(sen(yearly) / 12) / 100;
  const yearlyOfMonthly = (monthly) => (sen(monthly) * 12) / 100;
  // What to show for a stored (yearly) salary, and what to store for what was typed, in a basis.
  const shown = (yearly, basis) => (basis === 'yearly' ? sen(yearly) / 100 : monthlyOfYearly(yearly));
  const stored = (typed, basis) => (basis === 'yearly' ? sen(typed) / 100 : yearlyOfMonthly(typed));

  const LABELS = {
    monthly: { en: 'Basic salary (monthly)', ms: 'Gaji pokok (bulanan)', unit: 'month', short: 'monthly' },
    yearly: { en: 'Basic salary (yearly)', ms: 'Gaji pokok (tahunan)', unit: 'year', short: 'yearly' },
  };
  const label = (basis) => LABELS[basis === 'yearly' ? 'yearly' : 'monthly'];
  // The other figure, for the grey line under the field: "= RM24,000.00 a year" / "= RM2,000.00 a month". fmt formats a number as money.
  const otherLine = (yearly, basis, fmt) => (basis === 'yearly' ? `= ${fmt(monthlyOfYearly(yearly))} a month` : `= ${fmt(sen(yearly) / 100)} a year`);

  // ---------- Pay run safety checks (all companies) ----------
  // items: the run's items ({ empId, base = the month's basic pay }); employees: records; prevItems: last month's items (or null).
  // A person is skipped for "no salary" and "below minimum wage" when they are paid by the trip, day or hour. The minimum-wage check is for
  // full-time workers only. A jump is a change of more than 50% in the basic pay since last month, up or down.
  const PER_UNIT = ['trip', 'day', 'daily', 'hour', 'hourly'];
  function payrollChecks({ items, employees, prevItems = null, minWage = MIN_WAGE_DEFAULT }) {
    const byId = Object.fromEntries((employees || []).map((e) => [e.id, e])), prev = Object.fromEntries((prevItems || []).map((i) => [i.empId, i]));
    const out = [];
    (items || []).forEach((it) => {
      const e = byId[it.empId]; if (!e) return;
      const perUnit = PER_UNIT.includes(String(e.pay || e.payBasis || '').toLowerCase());
      const base = Number(it.base) || 0, kinds = [];
      if (!perUnit && base <= 0) kinds.push('none');
      else if (!perUnit && (e.type || 'Full-time') === 'Full-time' && base < Number(minWage)) kinds.push('minwage');
      const p = prev[it.empId], pb = p ? Number(p.base) || 0 : 0;
      if (pb > 0 && base > 0 && Math.abs(base - pb) / pb > 0.5) kinds.push('jump');
      if (kinds.length) out.push({ empId: it.empId, kinds, base, prevBase: pb || null });
    });
    return out;
  }
  const CHECK_TEXT = { none: 'No salary', minwage: 'Below the minimum wage', jump: 'Basic pay changed by more than 50% since last month' };

  const api = { sen, MIN_WAGE_DEFAULT, basisOf, lockedMonthly, monthlyOfYearly, yearlyOfMonthly, shown, stored, label, otherLine, payrollChecks, CHECK_TEXT, PER_UNIT };
  root.AllurusSalary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
