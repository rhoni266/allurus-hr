// Talent rules: hiring analytics (time to hire, sources, stage conversion), interview and room booking conflicts,
// interview scorecards, careers applications, courses (who must take what, quiz scoring, completion and
// certificate expiry), and grievance SLAs. Pure functions with no DOM access, unit tested in tests/talent.test.js.
window.AllurusTalentRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const parse = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const addDays = (s, n) => new Date(parse(s) + n * 864e5).toISOString().slice(0, 10);
  const addMonths = (s, n) => { const d = new Date(parse(s)); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
  const toMin = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); return h * 60 + (m || 0); };
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : r2((s[m - 1] + s[m]) / 2); };

  // ---------- Recruitment ----------
  const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];
  const SOURCES = ['Careers page', 'LinkedIn', 'JobStreet', 'Indeed', 'MyFutureJobs', 'Referral', 'Walk-in', 'Agency'];
  // The furthest stage a candidate reached (a rejected candidate keeps the stage they were rejected at).
  const reached = (c) => Math.max(STAGES.indexOf(c.stage), ...Object.keys(c.stageDates || {}).map((s) => STAGES.indexOf(s)));
  /**
   * Hiring analytics for candidates who applied in a range. Returns time to hire (applied → hired, days),
   * candidates and hires by source, and stage conversion (how many reached each stage, and the share of those
   * at the stage before).
   */
  function hiringAnalytics(candidates, { from = '', to = '' } = {}) {
    const list = candidates.filter((c) => (!from || c.applied >= from) && (!to || c.applied <= to));
    const hired = list.filter((c) => c.stage === 'Hired' && (c.hiredOn || c.stageDates?.Hired));
    const tth = hired.map((c) => days(c.applied, c.hiredOn || c.stageDates.Hired)).filter((d) => d >= 0);
    const bySource = {};
    list.forEach((c) => { const s = c.source || 'Not recorded'; const r = (bySource[s] = bySource[s] || { source: s, candidates: 0, hires: 0 }); r.candidates++; if (c.stage === 'Hired') r.hires++; });
    const counts = STAGES.map((s, i) => list.filter((c) => reached(c) >= i).length);
    const funnel = STAGES.map((s, i) => ({ stage: s, count: counts[i], fromPrev: i === 0 ? 100 : counts[i - 1] ? r2((counts[i] / counts[i - 1]) * 100) : 0, fromStart: counts[0] ? r2((counts[i] / counts[0]) * 100) : 0 }));
    return {
      total: list.length, hires: hired.length, rejected: list.filter((c) => c.rejected).length,
      timeToHire: { avg: tth.length ? r2(tth.reduce((s, x) => s + x, 0) / tth.length) : null, median: median(tth), min: tth.length ? Math.min(...tth) : null, max: tth.length ? Math.max(...tth) : null },
      bySource: Object.values(bySource).map((r) => ({ ...r, hireRate: r.candidates ? r2((r.hires / r.candidates) * 100) : 0 })).sort((a, b) => b.candidates - a.candidates),
      funnel,
    };
  }
  /** What a careers-page application is missing. Returns a list of { field, message }. */
  function applicationProblems(a) {
    const out = [];
    if (!String(a.name || '').trim()) out.push({ field: 'name', message: 'Your full name is needed' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email || '')) out.push({ field: 'email', message: 'A valid email is needed so we can reply' });
    if (a.phone && !/^\+?[\d\s-]{8,20}$/.test(a.phone)) out.push({ field: 'phone', message: 'That phone number doesn’t look right' });
    if (!a.consent) out.push({ field: 'consent', message: 'Please agree to how we use your details (PDPA)' });
    return out;
  }
  /**
   * Interview scorecards: average score per criterion and overall (1–5), and the recommendations.
   * cards = { empId: { scores: { criterion: 1-5 }, recommend } }.
   */
  function scorecardSummary(cards = {}, criteria = []) {
    const list = Object.values(cards).filter((c) => c && c.scores);
    const avg = (vs) => (vs.length ? r2(vs.reduce((s, x) => s + x, 0) / vs.length) : null);
    const byCrit = criteria.map((k) => ({ criterion: k, avg: avg(list.map((c) => Number(c.scores[k])).filter((x) => x > 0)) }));
    const all = list.flatMap((c) => Object.values(c.scores).map(Number).filter((x) => x > 0));
    const rec = {};
    list.forEach((c) => { if (c.recommend) rec[c.recommend] = (rec[c.recommend] || 0) + 1; });
    return { count: list.length, overall: avg(all), byCrit, recommend: rec };
  }

  // ---------- Time slots (interviews and rooms) ----------
  /** Two time slots on the same day overlap when one starts before the other ends. */
  const overlaps = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  /** Room bookings that clash with a new one (same room, overlapping time, not cancelled). */
  const roomConflicts = (bookings, b) => bookings.filter((x) => x.id !== b.id && x.roomId === b.roomId && x.status !== 'Cancelled' && overlaps(x, b));
  function bookingProblems(b, { rooms = [], bookings = [], now = '' } = {}) {
    const out = [], room = rooms.find((r) => r.id === b.roomId);
    if (!room) out.push('Choose a room');
    if (!b.date) out.push('Choose a date');
    if (!(toMin(b.end) > toMin(b.start))) out.push('The end must be after the start');
    if (room && b.people > room.capacity) out.push(`${room.name} seats ${room.capacity}`);
    if (now && b.date && `${b.date}T${b.end}` <= now) out.push('That time has already passed');
    const c = roomConflicts(bookings, b);
    if (c.length) out.push(`${room?.name || 'The room'} is booked ${c.map((x) => `${x.start}–${x.end}${x.title ? ` (${x.title})` : ''}`).join(', ')}`);
    return out;
  }
  /**
   * Who can't make an interview: interviewers with another interview at the same time, or on leave.
   * interviews = [{ id, date, start, end, interviewers }]; onLeave(empId, date) tells whether someone is away.
   */
  function interviewConflicts(iv, interviews, onLeave = () => false) {
    const out = [];
    (iv.interviewers || []).forEach((id) => {
      if (onLeave(id, iv.date)) out.push({ empId: id, reason: 'on leave' });
      interviews.filter((x) => x.id !== iv.id && x.status !== 'Cancelled' && (x.interviewers || []).includes(id) && overlaps(x, iv)).forEach((x) => out.push({ empId: id, reason: `another interview ${x.start}–${x.end}` }));
    });
    return out;
  }

  // ---------- Training ----------
  /** Courses an employee must take: marked for everyone, their department, or their job title. */
  const requiredFor = (emp, courses) => courses.filter((c) => c.active !== false && c.mandatory && (c.mandatory.all || (c.mandatory.depts || []).includes(emp.dept) || (c.mandatory.roles || []).some((r) => r && emp.role && emp.role.toLowerCase().includes(r.toLowerCase()))));
  /** Quiz result: answers = { questionId: optionIndex }. Returns { correct, total, pct, passed }. */
  function scoreQuiz(quiz, answers = {}) {
    const qs = quiz?.questions || [], correct = qs.filter((q) => Number(answers[q.id]) === Number(q.answer)).length;
    const pct = qs.length ? Math.round((correct / qs.length) * 100) : 100;
    return { correct, total: qs.length, pct, passed: pct >= (Number(quiz?.passMark) || 0) };
  }
  /** When a certificate from a completion expires ('' when the course has no validity period). */
  const certExpiry = (completedAt, validMonths) => (completedAt && validMonths > 0 ? addMonths(completedAt.slice(0, 10), validMonths) : '');
  /**
   * Where an employee stands on a course: 'Not started', 'In progress', 'Overdue', 'Completed', 'Expiring' (within
   * window days) or 'Expired'. enrolment = { assigned, due, done: [moduleIds], completedAt, expires }.
   */
  function courseStatus(course, enrolment, today, window = 60) {
    if (!enrolment) return { status: 'Not started', progress: 0 };
    const mods = (course.modules || []).length, done = (enrolment.done || []).filter((id) => (course.modules || []).some((m) => m.id === id)).length;
    const progress = mods ? Math.round((done / mods) * 100) : 0;
    if (enrolment.completedAt) {
      if (enrolment.expires && enrolment.expires < today) return { status: 'Expired', progress: 100 };
      if (enrolment.expires && days(today, enrolment.expires) <= window) return { status: 'Expiring', progress: 100, left: days(today, enrolment.expires) };
      return { status: 'Completed', progress: 100 };
    }
    if (enrolment.due && enrolment.due < today) return { status: 'Overdue', progress };
    return { status: progress || (enrolment.attempts || []).length ? 'In progress' : 'Not started', progress };
  }
  /**
   * Where someone stands on a course, all their enrolments considered: a renewal assigned before the old
   * certificate expires does not hide that certificate. The open renewal is returned as `renewal`.
   */
  function standing(course, enrolments, empId, today, window = 60) {
    const last = latest(enrolments, empId, course.id), s = courseStatus(course, last, today, window);
    if (!last || last.completedAt) return s;
    const prev = enrolments.filter((x) => x.empId === empId && x.courseId === course.id && x.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    return prev && (!prev.expires || prev.expires >= today) ? { ...courseStatus(course, prev, today, window), renewal: s } : s;
  }
  /** Compliance for mandatory courses: for each person, how many required courses are current. */
  function compliance(employees, courses, enrolments, today) {
    return employees.map((e) => {
      const req = requiredFor(e, courses);
      const sts = req.map((c) => standing(c, enrolments, e.id, today).status);
      const ok = sts.filter((s) => s === 'Completed' || s === 'Expiring').length;
      return { empId: e.id, required: req.length, current: ok, pct: req.length ? Math.round((ok / req.length) * 100) : 100, statuses: Object.fromEntries(req.map((c, i) => [c.id, sts[i]])) };
    });
  }
  const latest = (enrolments, empId, courseId) => enrolments.filter((x) => x.empId === empId && x.courseId === courseId).sort((a, b) => (b.completedAt || b.assigned || '').localeCompare(a.completedAt || a.assigned || ''))[0] || null;

  // ---------- Grievances ----------
  const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
  const GSTATUSES = ['New', 'Acknowledged', 'Investigating', 'Resolved', 'Closed'];
  // Default SLA in days: how fast a grievance is acknowledged and resolved. A company policy, editable in Settings.
  const defaultSla = () => ({ Low: { ack: 5, resolve: 30 }, Normal: { ack: 3, resolve: 21 }, High: { ack: 2, resolve: 14 }, Urgent: { ack: 1, resolve: 7 } });
  const slaDates = (created, priority, sla = defaultSla()) => { const s = sla[priority] || sla.Normal; return { ackDue: addDays(created, s.ack), resolveDue: addDays(created, s.resolve) }; };
  /** SLA position on a date: acknowledged and resolved on time or not, and days left to resolve. */
  function slaState(g, today, sla = defaultSla()) {
    const { ackDue, resolveDue } = slaDates(g.created, g.priority, sla);
    const ackAt = g.ackAt || '', doneAt = g.resolvedAt || '';
    return {
      ackDue, resolveDue,
      ackBreached: ackAt ? ackAt > ackDue : today > ackDue,
      resolveBreached: doneAt ? doneAt > resolveDue : today > resolveDue,
      daysLeft: doneAt ? null : days(today, resolveDue),
      open: !['Resolved', 'Closed'].includes(g.status),
    };
  }
  const canMove = (from, to) => { const i = GSTATUSES.indexOf(from), j = GSTATUSES.indexOf(to); return j === i + 1 || (from === 'Resolved' && to === 'Investigating'); };
  /** Summary for a period: counts by category and status, average days to resolve, and SLA met (%). No names. */
  function grievanceSummary(list, today, sla = defaultSla()) {
    const by = (k) => list.reduce((m, g) => { m[g[k]] = (m[g[k]] || 0) + 1; return m; }, {});
    const done = list.filter((g) => g.resolvedAt);
    const res = done.map((g) => days(g.created, g.resolvedAt));
    const met = done.filter((g) => !slaState(g, today, sla).resolveBreached).length;
    return { total: list.length, open: list.filter((g) => !['Resolved', 'Closed'].includes(g.status)).length, byCategory: by('category'), byStatus: by('status'), byPriority: by('priority'), avgDaysToResolve: res.length ? r2(res.reduce((s, x) => s + x, 0) / res.length) : null, slaMet: done.length ? Math.round((met / done.length) * 100) : null, breachedOpen: list.filter((g) => !g.resolvedAt && slaState(g, today, sla).resolveBreached).length };
  }

  return { STAGES, SOURCES, reached, hiringAnalytics, applicationProblems, scorecardSummary, overlaps, roomConflicts, bookingProblems, interviewConflicts, requiredFor, scoreQuiz, certExpiry, courseStatus, standing, compliance, latest, PRIORITIES, GSTATUSES, defaultSla, slaDates, slaState, canMove, grievanceSummary, toMin, addDays, days };
})();
