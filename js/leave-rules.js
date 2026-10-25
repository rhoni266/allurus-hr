// Leave rules for Malaysian companies: leave types, states and weekends, public holidays, day counting,
// entitlements (service tiers and pro-rating), balances with carry-forward and expiry, the year-end job,
// approval chains and the unpaid-leave deduction. Pure functions with no DOM access, so they can be
// unit-tested in Node and moved to a server later.
(function (root) {
  'use strict';

  // ---------- Dates (local, so this module has no dependencies) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d || 1)); };
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dow = (s) => parse(s).getUTCDay();
  const monthEnd = (mk) => { const [y, m] = mk.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 0))); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const r2 = (n) => Math.round(n * 100) / 100;
  // Employment Act rounding: a fraction of half a day or more counts as one day.
  const roundHalfUp = (n) => Math.floor(n + 0.5 + 1e-9);

  // ---------- States and work weeks ----------
  // 'sun': a six-day week (Monday to Saturday), common in factories, with Sunday as the only rest day.
  const WEEKENDS = { 'sat-sun': [6, 0], 'fri-sat': [5, 6], sun: [0] };
  const WEEKEND_LABELS = { 'sat-sun': 'Saturday and Sunday', 'fri-sat': 'Friday and Saturday', sun: 'Sunday only' };
  // Kedah, Kelantan and Terengganu rest on Friday and Saturday. Johor returned to Saturday–Sunday in 2025.
  const STATES = [
    ['Johor', 'sat-sun'], ['Kedah', 'fri-sat'], ['Kelantan', 'fri-sat'], ['Melaka', 'sat-sun'], ['Negeri Sembilan', 'sat-sun'],
    ['Pahang', 'sat-sun'], ['Perak', 'sat-sun'], ['Perlis', 'sat-sun'], ['Pulau Pinang', 'sat-sun'], ['Sabah', 'sat-sun'],
    ['Sarawak', 'sat-sun'], ['Selangor', 'sat-sun'], ['Terengganu', 'fri-sat'], ['Kuala Lumpur', 'sat-sun'], ['Labuan', 'sat-sun'], ['Putrajaya', 'sat-sun'],
  ].map(([name, weekend]) => ({ name, weekend }));
  const stateWeekend = (state) => STATES.find((s) => s.name === state)?.weekend || 'sat-sun';
  const CITY_STATE = { Kuantan: 'Pahang', 'Kuala Lumpur': 'Kuala Lumpur' };
  const weekendDays = (cfg) => WEEKENDS[cfg?.weekend] || WEEKENDS['sat-sun'];

  // ---------- Public holidays ----------
  // DATES: verify against the official gazette before production — federal holidays from the Prime Minister's
  // Department (kabinet.gov.my), state holidays from each State Secretary's office. Islamic and lunar holidays
  // depend on moon sighting and can move by a day. Only Terengganu's state holidays are built in; add other
  // states' holidays as company holidays in Settings.
  // Each row: [date, name, { only: [states] } | { except: [states] }]
  const HOLIDAYS = {
    2026: [
      ['2026-01-01', 'New Year’s Day', { except: ['Johor', 'Kedah', 'Kelantan', 'Perlis', 'Terengganu'] }],
      ['2026-01-17', 'Israk dan Mikraj', { only: ['Terengganu'] }],
      ['2026-02-01', 'Thaipusam', { only: ['Johor', 'Kedah', 'Negeri Sembilan', 'Perak', 'Pulau Pinang', 'Selangor', 'Kuala Lumpur', 'Putrajaya'] }],
      ['2026-02-17', 'Chinese New Year'],
      ['2026-02-18', 'Chinese New Year (second day)', { except: ['Kelantan', 'Terengganu'] }],
      ['2026-03-04', 'Anniversary of the Installation of the Sultan of Terengganu', { only: ['Terengganu'] }],
      ['2026-03-07', 'Nuzul Al-Quran', { only: ['Terengganu'] }],
      ['2026-03-21', 'Hari Raya Aidilfitri'],
      ['2026-03-22', 'Hari Raya Aidilfitri (second day)'],
      ['2026-04-26', 'Birthday of the Sultan of Terengganu', { only: ['Terengganu'] }],
      ['2026-05-01', 'Labour Day'],
      ['2026-05-26', 'Hari Arafah', { only: ['Terengganu'] }],
      ['2026-05-27', 'Hari Raya Haji'],
      ['2026-05-28', 'Hari Raya Haji (second day)', { only: ['Terengganu'] }],
      ['2026-05-31', 'Wesak Day'],
      ['2026-06-01', 'Birthday of the Yang di-Pertuan Agong'],
      ['2026-06-17', 'Awal Muharram'],
      ['2026-08-25', 'Maulidur Rasul'],
      ['2026-08-31', 'National Day'],
      ['2026-09-16', 'Malaysia Day'],
      ['2026-11-08', 'Deepavali', { except: ['Sarawak'] }],
      ['2026-12-25', 'Christmas Day'],
    ],
  };
  const builtInYears = () => Object.keys(HOLIDAYS).map(Number);
  const appliesTo = (rule, state) => !rule || (rule.only ? rule.only.includes(state) : !(rule.except || []).includes(state));

  // The company's holidays for a year: built-in ones for its state (minus any switched off), its own company
  // holidays, and a replacement day when a holiday lands on a rest day (if switched on).
  function holidaysFor(year, cfg = {}) {
    const off = new Set(cfg.holidaysOff || []);
    const list = [];
    if (cfg.state) {
      (HOLIDAYS[year] || []).forEach(([date, name, rule]) => {
        if (!appliesTo(rule, cfg.state)) return;
        list.push({ date, name, kind: rule?.only ? 'state' : 'national', off: off.has(date) });
      });
    }
    (cfg.holidaysCustom || []).filter((h) => h.date.startsWith(String(year))).forEach((h) => list.push({ date: h.date, name: h.name, kind: 'company', off: false }));
    const active = list.filter((h) => !h.off);
    if (cfg.replacement !== false) {
      const rest = weekendDays(cfg), taken = new Set(active.map((h) => h.date));
      active.filter((h) => rest.includes(dow(h.date))).sort((a, b) => a.date.localeCompare(b.date)).forEach((h) => {
        let d = addDays(h.date, 1);
        while (rest.includes(dow(d)) || taken.has(d)) d = addDays(d, 1);
        taken.add(d);
        list.push({ date: d, name: `Replacement holiday for ${h.name}`, kind: 'replacement', off: false });
      });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }
  // A Set of every holiday date (switched-on ones) between two dates, across years.
  function holidaySet(cfg, from, to) {
    const set = new Set();
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) holidaysFor(y, cfg).filter((h) => !h.off).forEach((h) => set.add(h.date));
    return set;
  }
  const calendarCtx = (cfg, from, to) => ({ weekend: weekendDays(cfg), holidays: holidaySet(cfg, from, to) });
  const isWorkingDay = (d, ctx) => !ctx.weekend.includes(dow(d)) && !ctx.holidays.has(d);

  // ---------- Day counting ----------
  // Days a request uses. Working-day types skip rest days and public holidays; calendar-day types (maternity,
  // paternity) count every day. A half day (AM/PM) is a single working day counted as 0.5.
  function countDays({ from, to, half = '', calendar = false }, ctx) {
    if (!from || !to || to < from) return { days: 0, dates: [], skipped: [] };
    const dates = [], skipped = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (calendar || isWorkingDay(d, ctx)) dates.push(d);
      else skipped.push({ date: d, why: ctx.holidays.has(d) ? 'holiday' : 'weekend' });
    }
    let days = dates.length;
    if (half && !calendar) days = from === to && dates.length === 1 ? 0.5 : dates.length;
    return { days, dates, skipped };
  }
  // The same count, limited to one month (for payroll).
  function countDaysInMonth(leave, mk, ctx, calendar = false) {
    const start = leave.from > `${mk}-01` ? leave.from : `${mk}-01`, end = leave.to < monthEnd(mk) ? leave.to : monthEnd(mk);
    if (end < start) return 0;
    const half = leave.half && leave.from === leave.to ? leave.half : '';
    return countDays({ from: start, to: end, half, calendar }, ctx).days;
  }
  function workingDaysInMonth(mk, ctx) {
    let n = 0;
    for (let d = `${mk}-01`; d <= monthEnd(mk); d = addDays(d, 1)) if (isWorkingDay(d, ctx)) n++;
    return n;
  }

  // ---------- Leave types ----------
  // Minimums from the Employment Act 1955 (as amended in 2022). Companies may give more, never less.
  // FORMAT: verify against the Employment Act 1955 (s60E, s60F, s60FA, s37) and your employment contracts before production.
  const TIER_LABELS = ['Under 2 years', '2 to 5 years', '5 years or more'];
  const DEFAULT_TYPES = [
    { id: 'annual', name: 'Annual', color: '#0F766E', paid: true, attachment: false, halfDay: true, calendar: false, byService: true, tiers: [8, 12, 16], days: 8, carryMax: 5, carryExpiry: 6, gender: 'any', married: false, minServiceMonths: 0, prorate: true, poolOf: '', includes: [], earned: false, on: true, note: 'Paid annual leave. Grows with years of service (legal minimum 8, 12 or 16 days).' },
    { id: 'sick', name: 'Sick (MC)', color: '#C2577A', paid: true, attachment: true, halfDay: false, calendar: false, byService: true, tiers: [14, 18, 22], days: 14, carryMax: 0, carryExpiry: 0, gender: 'any', married: false, minServiceMonths: 0, prorate: false, poolOf: '', includes: [], earned: false, on: true, note: 'With a medical certificate. Grows with years of service (legal minimum 14, 18 or 22 days).' },
    { id: 'hospital', name: 'Hospitalisation', color: '#B26B00', paid: true, attachment: true, halfDay: false, calendar: false, byService: false, tiers: [60, 60, 60], days: 60, carryMax: 0, carryExpiry: 0, gender: 'any', married: false, minServiceMonths: 0, prorate: false, poolOf: '', includes: ['sick'], earned: false, on: true, note: 'Up to 60 days a year in total, including sick days already taken.' },
    { id: 'maternity', name: 'Maternity', color: '#7A62C9', paid: true, attachment: true, halfDay: false, calendar: true, byService: false, tiers: [98, 98, 98], days: 98, carryMax: 0, carryExpiry: 0, gender: 'female', married: false, minServiceMonths: 0, prorate: false, poolOf: '', includes: [], earned: false, on: true, note: '98 consecutive days.' },
    { id: 'paternity', name: 'Paternity', color: '#4A6FD1', paid: true, attachment: true, halfDay: false, calendar: true, byService: false, tiers: [7, 7, 7], days: 7, carryMax: 0, carryExpiry: 0, gender: 'male', married: true, minServiceMonths: 12, prorate: false, poolOf: '', includes: [], earned: false, on: true, note: '7 consecutive days for married fathers with at least 12 months of service.' },
    { id: 'compassionate', name: 'Compassionate', color: '#5F636B', paid: true, attachment: false, halfDay: false, calendar: false, byService: false, tiers: [3, 3, 3], days: 3, carryMax: 0, carryExpiry: 0, gender: 'any', married: false, minServiceMonths: 0, prorate: false, poolOf: '', includes: [], earned: false, on: true, note: 'Company policy: death of a close family member.' },
    { id: 'replacement', name: 'Replacement', color: '#14958A', paid: true, attachment: false, halfDay: true, calendar: false, byService: false, tiers: [0, 0, 0], days: 0, carryMax: 0, carryExpiry: 0, gender: 'any', married: false, minServiceMonths: 0, prorate: false, poolOf: '', includes: [], earned: true, on: true, note: 'Earned by working on a rest day or public holiday. HR grants the days.' },
    { id: 'unpaid', name: 'Unpaid', color: '#8A8F98', paid: false, attachment: false, halfDay: true, calendar: false, byService: false, tiers: [0, 0, 0], days: null, carryMax: 0, carryExpiry: 0, gender: 'any', married: false, minServiceMonths: 0, prorate: false, poolOf: '', includes: [], earned: false, on: true, note: 'No limit. Deducted from basic pay.' },
    { id: 'emergency', name: 'Emergency', color: '#C93434', paid: true, attachment: false, halfDay: true, calendar: false, byService: false, tiers: [0, 0, 0], days: 0, carryMax: 0, carryExpiry: 0, gender: 'any', married: false, minServiceMonths: 0, prorate: false, poolOf: 'annual', includes: [], earned: false, on: true, note: 'Taken from annual leave at short notice.' },
  ];
  const defaultTypes = () => DEFAULT_TYPES.map((t) => ({ ...t, tiers: [...t.tiers], includes: [...t.includes], builtin: true }));

  // Default leave settings for a company. Approval chains start from each department head, with HR last.
  function defaultSettings({ state = '', departments = [], hr = '', hrBackup = '' } = {}) {
    const chains = {};
    departments.forEach((d) => { chains[d.id] = { l1: d.lead || '', l1b: '', l2: '', l2b: '' }; });
    return { types: defaultTypes(), state, weekend: state ? stateWeekend(state) : 'sat-sun', replacement: true, holidaysOff: [], holidaysCustom: [], hr, hrBackup, chains, unpaidDivisor: 'working', lastCarry: null };
  }

  // ---------- Entitlement ----------
  const serviceYears = (start, onDate) => { if (!start) return 0; const a = parse(start), b = parse(onDate); let y = b.getUTCFullYear() - a.getUTCFullYear(); if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--; return Math.max(0, y); };
  const serviceMonths = (start, onDate) => { if (!start || start > onDate) return 0; const a = parse(start), b = parse(onDate); let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(); if (b.getUTCDate() < a.getUTCDate()) m--; return Math.max(0, m); };
  // Whole months worked in the year for someone who joined during it: the joining month counts only from the 1st.
  const monthsInYear = (start, year) => {
    if (!start || +start.slice(0, 4) < year) return 12;
    if (+start.slice(0, 4) > year) return 0;
    const m = +start.slice(5, 7), d = +start.slice(8, 10);
    return 12 - (m - 1) - (d > 1 ? 1 : 0);
  };
  // Who may take a type. Returns { ok, reason }.
  function eligible(type, emp, onDate) {
    if (!type.on) return { ok: false, reason: 'Not offered by your company.' };
    if (type.gender !== 'any' && emp.gender && emp.gender !== type.gender) return { ok: false, reason: `Only for ${type.gender === 'female' ? 'women' : 'men'}.` };
    if (type.gender !== 'any' && !emp.gender) return { ok: false, reason: 'Ask HR to add your gender to your profile first.' };
    if (type.married && !emp.married) return { ok: false, reason: 'Only for married employees.' };
    if (type.minServiceMonths && serviceMonths(emp.start, onDate) < type.minServiceMonths) return { ok: false, reason: `Needs ${type.minServiceMonths} months of service.` };
    return { ok: true, reason: '' };
  }
  // Days a person is entitled to for a year: service tier (as at 1 January), pro-rated for joiners.
  function entitlement(type, emp, year) {
    if (type.days === null || type.days === undefined) return Infinity;
    if (type.poolOf) return 0;
    let days = type.byService ? (type.tiers || [])[Math.min(2, (() => { const y = serviceYears(emp.start, `${year}-01-01`); return y < 2 ? 0 : y < 5 ? 1 : 2; })())] : type.days;
    days = Number(days) || 0;
    if (type.prorate) days = roundHalfUp((days * monthsInYear(emp.start, year)) / 12);
    if (emp.start && +emp.start.slice(0, 4) > year) days = 0;
    return days;
  }

  // ---------- Balances ----------
  // Leave counted against a type in a year: the type itself, types that draw from it (emergency → annual),
  // and types it includes (hospitalisation includes sick days).
  function usage(typeId, types, leaves, year, statuses) {
    const t = types.find((x) => x.id === typeId);
    const ids = new Set([typeId, ...types.filter((x) => x.poolOf === typeId).map((x) => x.id), ...(t?.includes || [])]);
    return leaves.filter((l) => ids.has(l.type) && statuses.includes(l.status) && l.from.startsWith(String(year)));
  }
  const sumDays = (list) => r2(list.reduce((s, l) => s + (Number(l.days) || 0), 0));
  // A balance for one person, type and year. Carried days are used first; any not used by their expiry date lapse.
  function balance({ type, types, emp, year, leaves, carry = null, credits = 0, today }) {
    const base = type.poolOf ? types.find((x) => x.id === type.poolOf) : type;
    if (!base) return { entitled: 0, carried: 0, lapsed: 0, used: 0, pending: 0, available: 0, unlimited: false, pooled: type.poolOf };
    const entitled = base.earned ? r2(credits) : entitlement(base, emp, year);
    const approved = usage(base.id, types, leaves, year, ['Approved']);
    const used = sumDays(approved), pending = sumDays(usage(base.id, types, leaves, year, ['Pending']));
    const carried = carry?.days || 0;
    let lapsed = 0, carryLeft = carried;
    if (carried && carry.expires) {
      const usedBefore = sumDays(approved.filter((l) => l.from <= carry.expires));
      const carryUsed = Math.min(carried, usedBefore);
      if (today > carry.expires) { lapsed = r2(carried - carryUsed); carryLeft = carryUsed; }
    }
    if (entitled === Infinity) return { entitled, carried, lapsed, used, pending, available: Infinity, unlimited: true, pooled: type.poolOf || '' };
    return { entitled, carried, lapsed, used, pending, available: r2(entitled + carryLeft - used - pending), unlimited: false, pooled: type.poolOf || '' };
  }

  // ---------- Year-end carry forward ----------
  // For each person and type with a carry-forward limit: unused days at the end of `year` (after any lapsed
  // carry), capped at the limit, expiring at the end of the type's expiry month in the next year.
  function carryForward({ types, employees, leaves, carries = {}, year }) {
    const rows = [];
    types.filter((t) => t.on && t.carryMax > 0 && !t.poolOf && t.days !== null).forEach((t) => {
      employees.forEach((e) => {
        const b = balance({ type: t, types, emp: e, year, leaves: leaves.filter((l) => l.empId === e.id), carry: carries[e.id]?.[t.id] || null, today: `${year}-12-31` });
        const unused = Math.max(0, r2(b.available + b.pending));
        if (!unused) return;
        const carry = Math.min(unused, t.carryMax);
        const expires = t.carryExpiry ? monthEnd(`${year + 1}-${pad(t.carryExpiry)}`) : `${year + 1}-12-31`;
        rows.push({ empId: e.id, typeId: t.id, unused, carry, forfeited: r2(unused - carry), expires });
      });
    });
    return rows;
  }

  // ---------- Approval chain ----------
  // Up to three steps: L1 (usually the department head), L2 (optional) and Final (HR). A step is skipped when
  // the applicant would approve their own leave, or when the same person already approves an earlier step.
  function buildChain({ applicant, chain = {}, hr = '', hrBackup = '' }) {
    const steps = [
      { level: 'L1', label: 'Department head', approver: chain.l1 || '', backup: chain.l1b || '' },
      { level: 'L2', label: 'Second approver', approver: chain.l2 || '', backup: chain.l2b || '' },
      { level: 'Final', label: 'HR', approver: hr || '', backup: hrBackup || '' },
    ].filter((s) => s.approver);
    const seen = new Set();
    return steps.map((s) => {
      let { approver, backup } = s, note = '';
      if (approver === applicant) {
        if (s.level === 'Final' && backup && backup !== applicant) { approver = backup; backup = ''; note = 'HR backup approves because HR is the applicant.'; }
        else return { ...s, status: 'skipped', note: 'The applicant is this approver.' };
      }
      if (seen.has(approver)) return { ...s, approver, status: 'skipped', note: 'Already approved at an earlier step.' };
      seen.add(approver);
      return { ...s, approver, backup: backup === applicant ? '' : backup, status: 'pending', note };
    });
  }
  const nextStep = (chain = []) => chain.find((s) => s.status === 'pending') || null;
  // Who may act on a step: the approver, or their backup while the approver is on leave.
  function canAct(step, userId, isAway) {
    if (!step || step.status !== 'pending' || !userId) return '';
    if (step.approver === userId) return 'approver';
    if (step.backup === userId && isAway(step.approver)) return 'backup';
    return '';
  }
  // Records a decision on the next step and returns the new chain and overall status.
  function decide(chain, { by, approve, note = '', at, actedAs = 'approver' }) {
    const next = chain.map((s) => ({ ...s }));
    const step = next.find((s) => s.status === 'pending');
    if (!step) return { chain: next, status: chain.some((s) => s.status === 'rejected') ? 'Rejected' : 'Approved' };
    Object.assign(step, { status: approve ? 'approved' : 'rejected', by, at, note: note || step.note || '', actedAs });
    if (!approve) { next.filter((s) => s.status === 'pending').forEach((s) => { s.status = 'cancelled'; }); return { chain: next, status: 'Rejected' }; }
    return { chain: next, status: next.some((s) => s.status === 'pending') ? 'Pending' : 'Approved' };
  }

  // ---------- Unpaid leave in payroll ----------
  // FORMAT: verify against the Employment Act 1955 (s60I, ordinary rate of pay) and your contracts before production.
  // 'working' = working days in the month (weekends and holidays excluded), '26' = fixed 26 days, 'calendar' = days in the month.
  function divisor(mode, mk, ctx) {
    if (mode === '26') return 26;
    if (mode === 'calendar') return +monthEnd(mk).slice(8);
    return workingDaysInMonth(mk, ctx) || 1;
  }
  const unpaidDeduction = ({ base, days, divisor: div }) => (days > 0 && div > 0 ? r2(Math.min(base, (base / div) * days)) : 0);

  const api = {
    WEEKENDS, WEEKEND_LABELS, STATES, CITY_STATE, HOLIDAYS, TIER_LABELS, DEFAULT_TYPES, defaultTypes, defaultSettings, stateWeekend, weekendDays, builtInYears,
    holidaysFor, holidaySet, calendarCtx, isWorkingDay, countDays, countDaysInMonth, workingDaysInMonth,
    serviceYears, serviceMonths, monthsInYear, eligible, entitlement, usage, balance, carryForward,
    buildChain, nextStep, canAct, decide, divisor, unpaidDeduction, roundHalfUp, addDays, monthEnd, daysBetween, dow,
  };
  root.AllurusLeaveRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
