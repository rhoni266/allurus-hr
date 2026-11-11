// Daily production commission (docs/PRODUCTION-COMMISSION-SPEC.md). Pure: no DOM, unit tested in tests/prod.test.js.
//
// An admin keys in the day's total production. Pool = units × rate per unit. The pool is split equally among the staff
// who attended that day (any check-in counts, late or half day included; leave or no check-in gets nothing), in the
// departments chosen in Settings. Money is whole sen, never floating point; the leftover sen is not paid out.
(function (root) {
  'use strict';
  const MONTH = (d) => String(d).slice(0, 7);

  // ---------- Numbers, in whole sen ----------
  // "0.05" → 500 (ten-thousandths of a ringgit), so a rate of up to 4 decimals stays exact. null if it isn't a rate.
  function rateUnits(rate) {
    const s = String(rate ?? '').trim().replace(/^RM\s*/i, '');
    if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
    const [a, b = ''] = s.split('.');
    return Number(a) * 10000 + Number((b + '0000').slice(0, 4));
  }
  // Units as hundredths (2,000 → 200000; 12.5 kg → 1250), so units with 2 decimals stay exact. null if not a number.
  function unitsCenti(units) {
    const s = String(units ?? '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const [a, b = ''] = s.split('.');
    return Number(a) * 100 + Number((b + '00').slice(0, 2));
  }
  // The day's money: pool = round-half-up(units × rate × 100) sen; share = floor(pool ÷ people); the rest isn't paid.
  function commissionDay({ units, rate, attendees }) {
    const u = unitsCenti(units), r = rateUnits(rate), n = Math.max(0, Math.floor(Number(attendees) || 0));
    if (u == null || r == null) return { ok: false, poolSen: 0, shareSen: 0, remainderSen: 0, attendees: n };
    const poolSen = Math.floor((u * r + 5000) / 10000);
    if (!n) return { ok: true, poolSen, shareSen: 0, remainderSen: poolSen, attendees: 0, noAttendees: true };
    const shareSen = Math.floor(poolSen / n);
    return { ok: true, poolSen, shareSen, remainderSen: poolSen - shareSen * n, attendees: n };
  }
  const rm = (sen) => `RM${(Math.round(sen) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  const fmtUnits = (units, unit = '') => `${String(units).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${unit ? ' ' + unit : ''}`;

  // ---------- Who counts ----------
  // employee: { id, start, endDate, dept, status }; date: 'YYYY-MM-DD'; checkin: that day's attendance record for the
  // person ({ s, in }) or null; leaves: approved leaves { empId, from, to, half }; settings: { depts: [ids] }.
  // → { ok: true, flag? } | { ok: false, reason }. A full-day leave wins over a check-in (and flags the day for HR).
  function attendedForCommission({ employee: e, date, checkin, leaves = [], settings = {} }) {
    if (!e) return { ok: false, reason: 'Not found' };
    if (!e.start || e.start > date) return { ok: false, reason: 'Not yet started' };
    if (e.endDate && e.endDate < date) return { ok: false, reason: 'Already left' };
    const depts = settings.depts || [];
    if (!e.dept) return { ok: false, reason: 'No department' };
    if (!depts.includes(e.dept)) return { ok: false, reason: 'Not in a commission department' };
    const lv = (leaves || []).find((l) => l.empId === e.id && (!l.status || l.status === 'Approved') && l.from <= date && date <= (l.to || l.from));
    const fullLeave = !!lv && !(lv.half && lv.from === lv.to);
    const checked = !!checkin && (checkin.s === 'present' || checkin.s === 'remote') && !!checkin.in;
    if (fullLeave) return { ok: false, reason: `On leave${lv.type ? ` (${lv.type})` : ''}`, flag: checked ? 'Checked in on a day of approved leave' : '' };
    if (!checked) return { ok: false, reason: 'No check-in' };
    return { ok: true };
  }

  // The whole day: who gets a share and who doesn't (with the reason). employees: everyone; att: { empId: record };
  // → { poolSen, shareSen, remainderSen, count, attendees: [{id, firstIn}], excluded: [{id, reason}], flags: [{id, flag}], sig }
  function planDay({ date, units, rate, employees = [], att = {}, leaves = [], settings = {} }) {
    const yes = [], no = [], flags = [];
    employees.forEach((e) => {
      const r = attendedForCommission({ employee: e, date, checkin: att[e.id] || null, leaves, settings });
      if (r.flag) flags.push({ id: e.id, flag: r.flag });
      if (r.ok) yes.push({ id: e.id, firstIn: (att[e.id] || {}).in || '' });
      // People in another department are not listed as missing out; people with no department are, so HR can fix them.
      else if (r.reason !== 'Not in a commission department') no.push({ id: e.id, reason: r.reason });
    });
    const d = commissionDay({ units, rate, attendees: yes.length });
    return { ...d, count: yes.length, attendees: yes, excluded: no, flags, sig: yes.map((x) => x.id).sort().join(',') };
  }

  // ---------- A month, from the saved days ----------
  // days: { 'YYYY-MM-DD': { shareSen, attendees: [ids] | shares: {id: sen} } } → { empId: { sen, days } }
  function monthTotals(days, month) {
    const out = {};
    Object.keys(days || {}).filter((d) => MONTH(d) === month).forEach((d) => {
      const x = days[d]; if (!x || !x.shareSen) return;
      (x.attendees || []).forEach((id) => { const e = (out[id] = out[id] || { sen: 0, days: 0 }); e.sen += x.shareSen; e.days += 1; });
    });
    return out;
  }
  // Days in the month where HR should look before finalising payroll: check-ins in a commission department but no
  // production entered, and days whose attendance changed since they were saved.
  function monthWarnings({ month, days = {}, employees = [], attByDay = {}, leaves = [], settings = {}, isWorkday = () => true }) {
    const missing = [], changed = [];
    const dates = new Set([...Object.keys(attByDay).filter((d) => MONTH(d) === month), ...Object.keys(days).filter((d) => MONTH(d) === month)]);
    [...dates].sort().forEach((d) => {
      const saved = days[d];
      const plan = planDay({ date: d, units: saved ? saved.units : 0, rate: saved ? saved.rate : settings.rate, employees, att: attByDay[d] || {}, leaves, settings });
      if (!saved) { if (plan.count > 0 && isWorkday(d)) missing.push(d); }
      else if (saved.sig !== plan.sig) changed.push(d);
    });
    return { missing, changed };
  }

  const api = { rateUnits, unitsCenti, commissionDay, attendedForCommission, planDay, monthTotals, monthWarnings, rm, fmtUnits, MONTH };
  root.AllurusProd = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
