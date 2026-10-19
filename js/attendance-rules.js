// Time attendance rules: working patterns, rosters, lateness, early-out, overtime and daily allowances.
// Pure functions with no DOM access, so they can be unit tested (tests/attendance.test.js) and later moved
// to a server. Times are "HH:MM" strings; durations are whole minutes; days are "YYYY-MM-DD".
window.AllurusTimeRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (hm) => { if (typeof hm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hm)) return null; const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const fmtMin = (m) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
  const fmtDur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
  const parse = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const iso = (d) => d.toISOString().slice(0, 10);
  const dow = (s) => parse(s).getUTCDay();
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));
  const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const WORKED = ['present', 'remote'];
  // A break is only taken off when someone is in for longer than this.
  const BREAK_AFTER = 300;
  // Employment Act monthly overtime limit, used for the warning.
  const EA_MONTH_LIMIT_H = 104;

  // ---------- Settings ----------
  // Working days default to the company's work week (rest days from the leave settings).
  const workDays = (restDays = [0, 6]) => [0, 1, 2, 3, 4, 5, 6].filter((d) => !restDays.includes(d));
  const defaultPatterns = (restDays) => [
    { id: 'p-office', name: 'Office hours', start: '09:00', end: '18:00', breakMin: 60, grace: 10, days: workDays(restDays), flexible: false, color: '#0F766E' },
  ];
  // FORMAT: verify against the Employment Act 1955 before production — s60A (overtime at 1.5×, 104 hours a month),
  // s60(3) (rest day work), s60D(3) (public holiday work), s60I (hourly rate = monthly basic ÷ 26 ÷ normal hours)
  // and the First Schedule wage limit for overtime. Every rate here is editable in Settings.
  const defaultOT = () => ({
    normal: 1.5, // after (or before) the shift on a working day
    restIn: 1.0, // rest day, up to normal hours
    rest: 2.0, // rest day, beyond normal hours
    holidayIn: 2.0, // public holiday, up to normal hours (on top of the holiday's pay)
    holiday: 3.0, // public holiday, beyond normal hours
    night: 0, // a different rate after midnight; 0 keeps the day's rate
    flat: false, flatRate: 0, // flat ringgit per hour instead of multipliers
    early: false, // count time before the shift starts as overtime
    offset: false, // take late minutes off the same day's overtime
    round: 15, roundMode: 'down', // round each day's overtime to blocks of this many minutes
    minMin: 30, maxDayMin: 240, // per day
    minMonthH: 0, maxMonthH: 0, warnMonthH: EA_MONTH_LIMIT_H, // per month; 0 = no limit
    dinner: false, dinnerAfter: 180, dinnerMin: 30, // dinner break taken off long overtime after the shift
    preApproval: true, // only approved overtime is paid
    divisor: 26, normalHours: 8, // hourly rate = monthly basic ÷ divisor ÷ normal hours
    eligibleMax: 0, // overtime only for monthly basic up to this; 0 = everyone
    epf: false, socso: true, tax: true,
  });
  // FORMAT: verify against KWSP (which payments are wages for EPF), PERKESO (wages for SOCSO and EIS) and LHDN
  // (taxable perquisites and exemptions, such as travel allowance) before production.
  const defaultAllowances = (on = false) => [
    { id: 'al-attend', name: 'Attendance', kind: 'attendance', weekday: 5, rest: 0, holiday: 0, late: 'forfeit', absent: 'forfeit', partialPct: 50, remote: true, patterns: [], epf: true, socso: true, tax: true, on },
    { id: 'al-meal', name: 'Meal', kind: 'meal', weekday: 0, rest: 15, holiday: 20, late: 'full', absent: 'forfeit', partialPct: 50, remote: true, patterns: [], epf: true, socso: true, tax: true, on },
    { id: 'al-transport', name: 'Transport', kind: 'transport', weekday: 8, rest: 10, holiday: 10, late: 'partial', absent: 'forfeit', partialPct: 50, remote: false, patterns: [], epf: false, socso: true, tax: true, on },
  ];
  const defaultSettings = ({ restDays } = {}) => ({
    patterns: defaultPatterns(restDays), deptPattern: {}, autoShift: true, minStaff: {}, templates: [],
    ot: defaultOT(), allowances: defaultAllowances(false),
  });

  // ---------- Which shift applies ----------
  // The roster comes first (a pattern id, or 'off'), then the person's own pattern, then their department's.
  // A fixed pattern does not apply on days outside its working days: that is a rest day.
  function patternFor({ day, roster, empPattern, deptPattern, patterns }) {
    const byId = (id) => (id && patterns.find((p) => p.id === id)) || null;
    if (roster === 'off') return { pattern: null, source: 'roster', off: true };
    if (byId(roster)) return { pattern: byId(roster), source: 'roster', off: false };
    for (const [id, source] of [[empPattern, 'employee'], [deptPattern, 'department']]) {
      const p = byId(id);
      if (p) return { pattern: p, source, off: !(p.days || []).includes(dow(day)) };
    }
    return { pattern: null, source: 'none', off: false };
  }
  // Auto-shift: with no fixed shift, use the pattern whose start is closest to the check-in, across midnight too.
  // Flexible patterns are never picked. On a tie the first pattern in the list wins.
  function autoShift(patterns, inHM) {
    const m = toMin(inHM);
    if (m == null) return null;
    let best = null, bestD = Infinity;
    (patterns || []).filter((p) => !p.flexible).forEach((p) => {
      const d0 = Math.abs(m - toMin(p.start)), d = Math.min(d0, 1440 - d0);
      if (d < bestD) { best = p; bestD = d; }
    });
    return best;
  }
  // The shift and day type for one person on one day. companyRest = the company's rest day; holiday = a public holiday.
  function resolveDay({ day, rec, roster, empPattern, deptPattern, cfg, holiday = false, companyRest = false }) {
    let { pattern, source, off } = patternFor({ day, roster, empPattern, deptPattern, patterns: cfg.patterns || [] });
    if (source === 'none') {
      off = companyRest;
      if (cfg.autoShift && rec?.in) { pattern = autoShift(cfg.patterns, rec.in); if (pattern) source = 'auto'; }
    }
    return { pattern, source, off, type: holiday ? 'holiday' : off ? 'rest' : 'normal' };
  }

  // ---------- One day ----------
  function roundOT(min, block, mode = 'down') {
    if (!block || block <= 1) return min;
    return (mode === 'nearest' ? Math.round(min / block) : Math.floor(min / block)) * block;
  }
  // Absolute minutes for the shift, check-in and check-out, allowing for shifts and check-outs past midnight.
  function clock(rec, pattern) {
    let I = toMin(rec?.in);
    if (I == null) return null;
    let S = null, E = null;
    if (pattern) {
      S = toMin(pattern.flexible ? pattern.coreStart || pattern.start : pattern.start);
      E = toMin(pattern.flexible ? pattern.coreEnd || pattern.end : pattern.end);
      if (E <= S) E += 1440;
      // Checked in after midnight for a night shift that started the evening before.
      if (E > 1440 && I < S - 720) I += 1440;
    }
    let O = toMin(rec?.out);
    if (O != null) while (O <= I) O += 1440;
    return { I, O, S, E };
  }
  const EMPTY_BUCKETS = () => ({ normal: 0, restIn: 0, rest: 0, holidayIn: 0, holiday: 0, night: 0 });
  // Total overtime minutes (the in-normal-hours rest day and holiday minutes are paid work, but not overtime).
  const otMinutes = (b) => (b.normal || 0) + (b.rest || 0) + (b.holiday || 0) + (b.night || 0);
  const paidMinutes = (b) => otMinutes(b) + (b.restIn || 0) + (b.holidayIn || 0);

  /**
   * Lateness, early-out and overtime for one day.
   * rec = { s, in, out }; pattern = the shift (or null); type = 'normal' | 'rest' | 'holiday';
   * waived = an approved lateness waiver; approvedMin = approved overtime minutes (used with pre-approval).
   */
  function evaluate({ rec, pattern = null, type = 'normal', rules = defaultOT(), waived = false, approvedMin = 0 }) {
    const res = { worked: 0, lateRaw: 0, late: 0, early: 0, short: 0, offset: 0, waived: false, rawOT: 0, unapproved: 0, dinner: 0, buckets: EMPTY_BUCKETS(), open: false };
    if (!rec || !WORKED.includes(rec.s)) return res;
    const c = clock(rec, pattern);
    if (!c) return res;
    const { I, O, S, E } = c;
    res.open = O == null;
    const brk = pattern ? Number(pattern.breakMin) || 0 : 60;
    const span = O == null ? 0 : O - I;
    res.worked = Math.max(0, span - (span > BREAK_AFTER ? brk : 0));
    const normalMin = (Number(rules.normalHours) || 8) * 60;
    let ot = 0, nightRaw = 0, inMin = 0;

    if (type === 'normal') {
      if (!pattern) return res;
      // Lateness counts in full once it goes past the grace minutes.
      res.lateRaw = Math.max(0, I - S);
      res.late = res.lateRaw > (Number(pattern.grace) || 0) ? res.lateRaw : 0;
      if (waived && res.late) { res.waived = true; res.late = 0; }
      if (O != null) {
        res.early = Math.max(0, E - O);
        let after, before = 0, endAt;
        if (pattern.flexible) {
          // Flexible: the day ends once the required hours (plus the break) are done, starting no earlier than the window.
          const need = (Number(pattern.hours) || 8) * 60;
          endAt = Math.max(I, toMin(pattern.start)) + need + brk;
          res.short = Math.max(0, need - res.worked);
          after = Math.max(0, O - Math.max(endAt, E));
        } else {
          endAt = E;
          after = Math.max(0, O - E);
          if (rules.early) before = Math.max(0, S - I);
        }
        if (rules.dinner && after >= (Number(rules.dinnerAfter) || 0)) { res.dinner = Math.min(after, Number(rules.dinnerMin) || 0); after -= res.dinner; }
        ot = after + before;
        nightRaw = Math.max(0, O - Math.max(1440, endAt));
      }
      if (rules.offset && res.late && ot) { res.offset = Math.min(res.late, ot); ot -= res.offset; res.late -= res.offset; }
    } else {
      // A rest day or public holiday: every minute worked is paid, the part beyond normal hours as overtime.
      if (O == null) return res;
      let total = res.worked;
      res.rawOT = total;
      if (rules.preApproval) { res.unapproved = Math.max(0, total - (approvedMin || 0)); total -= res.unapproved; }
      inMin = Math.min(total, normalMin);
      ot = total - inMin;
      nightRaw = Math.max(0, O - Math.max(1440, I));
    }
    if (type === 'normal') {
      res.rawOT = ot;
      if (rules.preApproval) { res.unapproved = Math.max(0, ot - (approvedMin || 0)); ot -= res.unapproved; }
    }
    ot = roundOT(ot, Number(rules.round) || 0, rules.roundMode);
    if (ot < (Number(rules.minMin) || 0)) ot = 0;
    if (rules.maxDayMin > 0) ot = Math.min(ot, rules.maxDayMin);
    const night = rules.night > 0 ? Math.min(ot, nightRaw) : 0;
    const b = res.buckets;
    b.night = night;
    if (type === 'normal') b.normal = ot - night;
    else if (type === 'rest') { b.restIn = inMin; b.rest = ot - night; }
    else { b.holidayIn = inMin; b.holiday = ot - night; }
    return res;
  }

  // ---------- A month ----------
  // Applies the monthly minimum and maximum to evaluated days (in date order). Overtime past the maximum is
  // trimmed from the latest days first. Returns the capped buckets per day, totals and the 104-hour warning.
  function capMonth(days, rules = defaultOT()) {
    const out = days.map((d) => ({ ...d, buckets: { ...d.buckets }, trimmed: 0 }));
    let total = out.reduce((s, d) => s + otMinutes(d.buckets), 0);
    const max = (Number(rules.maxMonthH) || 0) * 60, min = (Number(rules.minMonthH) || 0) * 60;
    let trimmed = 0;
    if (max > 0 && total > max) {
      let over = total - max;
      for (let i = out.length - 1; i >= 0 && over > 0; i--) {
        for (const k of ['night', 'holiday', 'rest', 'normal']) {
          const take = Math.min(over, out[i].buckets[k] || 0);
          out[i].buckets[k] -= take; out[i].trimmed += take; over -= take; trimmed += take;
          if (!over) break;
        }
      }
      total = max;
    }
    let belowMin = false;
    if (min > 0 && total > 0 && total < min) {
      belowMin = true; trimmed += total;
      out.forEach((d) => { ['night', 'holiday', 'rest', 'normal'].forEach((k) => { d.trimmed += d.buckets[k]; d.buckets[k] = 0; }); });
      total = 0;
    }
    const sum = EMPTY_BUCKETS();
    out.forEach((d) => Object.keys(sum).forEach((k) => { sum[k] += d.buckets[k] || 0; }));
    const raw = days.reduce((s, d) => s + otMinutes(d.buckets), 0);
    return { days: out, buckets: sum, total, trimmed, belowMin, warn: raw > (Number(rules.warnMonthH) || EA_MONTH_LIMIT_H) * 60, rawTotal: raw };
  }

  // ---------- Pay ----------
  // FORMAT: verify against the Employment Act 1955 s60I before production: hourly rate = monthly basic ÷ 26 ÷ normal hours.
  const hourlyRaw = (monthlyBasic, rules = defaultOT()) => (Number(monthlyBasic) || 0) / (Number(rules.divisor) || 26) / (Number(rules.normalHours) || 8);
  const hourlyRate = (monthlyBasic, rules) => r2(hourlyRaw(monthlyBasic, rules));
  const rateOf = (k, rules) => (k === 'night' ? Number(rules.night) || 0 : Number(rules[k]) || 0);
  // Overtime pay for a set of buckets. Flat-rate overtime pays the same ringgit per hour for every bucket.
  function otPay(buckets, monthlyBasic, rules = defaultOT()) {
    if (rules.eligibleMax > 0 && monthlyBasic > rules.eligibleMax) return { amount: 0, lines: [], ineligible: true };
    const h = hourlyRaw(monthlyBasic, rules);
    const lines = Object.keys(EMPTY_BUCKETS()).filter((k) => buckets[k] > 0).map((k) => {
      const rate = rules.flat ? null : rateOf(k, rules);
      const amount = r2(rules.flat ? (buckets[k] / 60) * (Number(rules.flatRate) || 0) : (buckets[k] / 60) * h * rate);
      return { key: k, minutes: buckets[k], rate, amount };
    });
    return { amount: r2(lines.reduce((s, l) => s + l.amount, 0)), lines, hourly: r2(h) };
  }

  // ---------- Allowances ----------
  // One allowance for one day. late = late minutes after grace and waivers; scheduled = a working day for this person.
  // Absent means no check-in on a scheduled working day. Leave days get nothing.
  function allowanceFor(rule, { type = 'normal', status = '', late = 0, patternId = '', scheduled = true } = {}) {
    const rate = Number(type === 'holiday' ? rule.holiday : type === 'rest' ? rule.rest : rule.weekday) || 0;
    const none = (reason) => ({ amount: 0, rate, outcome: 'none', reason });
    if (!rule.on) return none('Off');
    if (!rate) return none(`Not paid on ${type === 'normal' ? 'working days' : type === 'rest' ? 'rest days' : 'public holidays'}`);
    if (rule.kind === 'shift' && rule.patterns?.length && !rule.patterns.includes(patternId)) return none('Not this shift');
    if (status === 'leave') return none('On leave');
    const apply = (mode, reason) => {
      if (mode === 'forfeit') return { amount: 0, rate, outcome: 'forfeit', reason };
      if (mode === 'partial') return { amount: r2((rate * (Number(rule.partialPct) || 0)) / 100), rate, outcome: 'partial', reason };
      return { amount: rate, rate, outcome: 'full', reason };
    };
    if (!WORKED.includes(status)) return type === 'normal' && scheduled ? apply(rule.absent || 'forfeit', 'Absent') : none('Not working');
    if (status === 'remote' && !rule.remote) return none('Remote day');
    if (late > 0) return apply(rule.late || 'full', 'Late');
    return { amount: rate, rate, outcome: 'full', reason: '' };
  }

  // ---------- Rosters ----------
  // Copies one week's roster onto another, for the given people. Returns { day: { empId: patternId|'off' } }.
  function copyWeek(rosters, fromMonday, toMonday, empIds) {
    const out = {};
    weekDays(toMonday).forEach((d, i) => {
      const src = rosters[addDays(fromMonday, i)] || {};
      out[d] = {};
      empIds.forEach((id) => { if (src[id]) out[d][id] = src[id]; });
    });
    return out;
  }
  // A rotating template is a list of weeks, each 7 entries from Monday (a pattern id, 'off' or '' for the default).
  // With stagger on, person i starts i weeks further into the cycle, so a team covers every shift.
  function applyTemplate(template, { monday, weeks = 1, empIds, startWeek = 0, stagger = true }) {
    const out = {}, n = template.weeks?.length || 0;
    if (!n) return out;
    for (let w = 0; w < weeks; w++) {
      weekDays(addDays(monday, w * 7)).forEach((d, di) => {
        out[d] = out[d] || {};
        empIds.forEach((id, i) => {
          const v = template.weeks[(startWeek + w + (stagger ? i : 0)) % n][di];
          if (v) out[d][id] = v;
        });
      });
    }
    return out;
  }
  // Shifts that run into the next one: a shift ending after the next day's shift has started.
  // assign = { day: patternId|'off'|'' } for one person; returns the days whose shift clashes with the day before.
  function overlaps(assign, patterns) {
    const byId = (id) => patterns.find((p) => p.id === id);
    const days = Object.keys(assign).sort(), out = [];
    days.forEach((d) => {
      const prev = byId(assign[addDays(d, -1)]), cur = byId(assign[d]);
      if (!prev || !cur) return;
      let pe = toMin(prev.end); const ps = toMin(prev.start);
      if (pe <= ps) pe += 1440;
      if (pe > 1440 + toMin(cur.start)) out.push(d);
    });
    return out;
  }
  const shiftLabel = (p) => (p ? (p.flexible ? `core ${p.coreStart}–${p.coreEnd}` : `${p.start}–${p.end}`) : '');
  const shiftMinutes = (p) => { if (!p) return 0; let s = toMin(p.start), e = toMin(p.end); if (e <= s) e += 1440; return p.flexible ? (Number(p.hours) || 8) * 60 : Math.max(0, e - s - (Number(p.breakMin) || 0)); };

  // ---------- Audit trail ----------
  const AUDIT_FIELDS = ['s', 'in', 'out'];
  // The fields a manual edit changed; empty when nothing did.
  function diff(before, after) {
    return AUDIT_FIELDS.filter((k) => (before?.[k] || '') !== (after?.[k] || '')).map((k) => ({ field: k, from: before?.[k] || '', to: after?.[k] || '' }));
  }
  // Plan a batch edit: every day in the range (working days only unless allDays) for each person.
  // set = { s?, in?, out? }; onlyEmpty leaves days that already have a record. get(day, empId) reads the current record.
  function batchPlan({ from, to, empIds, set, onlyEmpty = false, allDays = false, isWorking = () => true, get }) {
    const out = [];
    if (!from || !to || from > to) return out;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!allDays && !isWorking(d)) continue;
      empIds.forEach((id) => {
        const before = get(d, id) || null;
        if (onlyEmpty && before) return;
        const after = { ...(before || {}) };
        ['s', 'in', 'out'].forEach((k) => { if (set[k] !== undefined && set[k] !== '') after[k] = set[k]; });
        if (!after.s) after.s = 'present';
        if (!WORKED.includes(after.s)) { after.in = ''; after.out = ''; }
        if (diff(before, after).length) out.push({ day: d, empId: id, before, after });
      });
    }
    return out;
  }

  return {
    toMin, fmtMin, fmtDur, dow, addDays, mondayOf, weekDays, workDays, EA_MONTH_LIMIT_H,
    defaultPatterns, defaultOT, defaultAllowances, defaultSettings,
    patternFor, autoShift, resolveDay, roundOT, evaluate, capMonth, otMinutes, paidMinutes,
    hourlyRate, otPay, allowanceFor, copyWeek, applyTemplate, overlaps, shiftLabel, shiftMinutes, diff, batchPlan,
  };
})();
