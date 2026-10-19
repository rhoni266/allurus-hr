// Appraisal rules: templates, weighted scoring, grade bands, the review flow (self → L1 → optional L2 → HR), 360°
// peer summaries, SMART goal progress, and turning approved results into pay changes that payroll picks up from
// their effective date. Pure functions with no DOM access, unit tested in tests/appraisal.test.js.
window.AllurusAppraisalRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const sumBy = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

  // ---------- Templates and bands ----------
  const SCALE_1_5 = { min: 1, max: 5, labels: ['Well below', 'Below', 'Meets', 'Exceeds', 'Outstanding'] };
  function defaultTemplate() {
    const q = (id, text, weight = 1) => ({ id, text, weight, comment: true });
    return {
      id: 'tpl-standard', name: 'Standard staff appraisal', scale: { ...SCALE_1_5, labels: [...SCALE_1_5.labels] }, depts: [], people: [],
      sections: [
        { id: 's-kpi', name: 'Key results (KPIs)', kind: 'kpi', weight: 50, questions: [q('k1', 'Delivered the agreed goals for the period', 2), q('k2', 'Quality and accuracy of work'), q('k3', 'Met deadlines and commitments')] },
        { id: 's-comp', name: 'Competencies', kind: 'competency', weight: 30, questions: [q('c1', 'Job knowledge and skills'), q('c2', 'Problem solving and initiative'), q('c3', 'Communication')] },
        { id: 's-val', name: 'Company values', kind: 'value', weight: 20, questions: [q('v1', 'Amanah: integrity and trust'), q('v2', 'Teamwork and helping others'), q('v3', 'Customer first')] },
      ],
    };
  }
  // Bands on the 5-point final score, with the company's guideline increment (%) and bonus (months of basic).
  // These are a company policy, not a statutory rule; edit them in Settings.
  const defaultBands = () => [
    { code: 'A', label: 'Outstanding', min: 4.5, inc: 8, bonus: 2 },
    { code: 'B', label: 'Exceeds expectations', min: 3.75, inc: 6, bonus: 1.5 },
    { code: 'C', label: 'Meets expectations', min: 2.75, inc: 4, bonus: 1 },
    { code: 'D', label: 'Needs improvement', min: 1.75, inc: 0, bonus: 0.5 },
    { code: 'E', label: 'Unsatisfactory', min: 0, inc: 0, bonus: 0 },
  ];
  // The template for one person in a cycle: one assigned to them, then to their department, then the cycle's.
  function templateFor(emp, cycle, templates) {
    return templates.find((t) => (t.people || []).includes(emp.id)) || templates.find((t) => (t.depts || []).includes(emp.dept)) || templates.find((t) => t.id === cycle?.templateId) || templates[0] || null;
  }
  const questions = (t) => (t?.sections || []).flatMap((s) => s.questions.map((q) => ({ ...q, section: s.id, kind: s.kind })));

  // ---------- Scoring ----------
  /**
   * Weighted score. scores = { questionId: { r } }. Each rating is put on a 5-point scale (r ÷ scale max × 5);
   * questions are weighted within their section, sections by their weight. Returns { sections, total, pct, complete }.
   */
  function score(template, scores = {}) {
    const max = template.scale?.max || 5;
    let complete = true;
    const sections = template.sections.map((s) => {
      const rated = s.questions.filter((q) => scores[q.id]?.r != null && scores[q.id].r !== '');
      if (rated.length < s.questions.length) complete = false;
      const w = sumBy(rated, (q) => q.weight || 1);
      const v = w ? sumBy(rated, (q) => (q.weight || 1) * (Number(scores[q.id].r) / max) * 5) / w : null;
      return { id: s.id, name: s.name, weight: s.weight, score: v == null ? null : r2(v) };
    });
    const scored = sections.filter((s) => s.score != null);
    const sw = sumBy(scored, (s) => s.weight);
    const total = sw ? r2(sumBy(scored, (s) => s.weight * s.score) / sw) : null;
    return { sections, total, pct: total == null ? null : Math.round((total / 5) * 100), complete: complete && scored.length === sections.length };
  }
  const grade = (total, bands = defaultBands()) => (total == null ? null : [...bands].sort((a, b) => b.min - a.min).find((b) => total >= b.min - 1e-9) || null);

  // ---------- Flow ----------
  const STAGES = { self: 'Self review', l1: 'Manager', l2: 'Second manager', hr: 'HR final', done: 'Completed' };
  // The next stage after one is finished. L1 is skipped for someone with no manager (they go straight to HR);
  // L2 is skipped when the cycle doesn't use it or there is no L2 manager.
  function nextStage(stage, { l2 = false, hasL2 = false, hasL1 = true } = {}) {
    if (stage === 'self') return hasL1 ? 'l1' : 'hr';
    if (stage === 'l1') return l2 && hasL2 ? 'l2' : 'hr';
    if (stage === 'l2') return 'hr';
    return 'done';
  }
  const dueFor = (stage, cycle) => ({ self: cycle.selfDue, l1: cycle.managerDue, l2: cycle.managerDue, hr: cycle.hrDue })[stage] || '';
  // Overdue: the current step's deadline has passed.
  const overdue = (a, cycle, today) => a.stage !== 'done' && !!dueFor(a.stage, cycle) && dueFor(a.stage, cycle) < today;
  const statusOf = (a) => (a.stage === 'done' ? 'Completed' : a.stage === 'self' && !a.self?.draftAt ? 'Not started' : 'In progress');

  // ---------- 360° peer feedback ----------
  // Averages per question and comments, without names. Hidden until at least `min` peers have answered.
  function peerSummary(peers = [], qs = [], { min = 2 } = {}) {
    const done = peers.filter((p) => p.status === 'done');
    if (done.length < min) return { shown: false, responses: done.length, needed: min };
    return {
      shown: true, responses: done.length,
      questions: qs.map((q) => { const rs = done.map((p) => Number(p.answers?.[q.id])).filter((x) => x > 0); return { id: q.id, text: q.text, avg: rs.length ? r2(sumBy(rs, (x) => x) / rs.length) : null, n: rs.length }; }),
      comments: done.map((p) => (p.comment || '').trim()).filter(Boolean).sort(),
    };
  }

  // ---------- Goals ----------
  // Weighted progress of a set of goals (0–100).
  function goalProgress(goals) {
    const w = sumBy(goals, (g) => g.weight || 1);
    return w ? Math.round(sumBy(goals, (g) => (g.weight || 1) * Math.min(100, Math.max(0, g.progress || 0))) / w) : 0;
  }
  // A goal is SMART enough to save when it says what, how it's measured, the target and the due date.
  const goalProblems = (g) => [!g.title?.trim() && 'Say what the goal is.', !g.measure?.trim() && 'Say how it will be measured.', !String(g.target ?? '').trim() && 'Set a target.', !g.due && 'Set a due date.'].filter(Boolean);

  // ---------- Pay changes ----------
  /**
   * Pay changes from an approved recommendation. rec = { inc (%), bonus (months), promo (new title) }.
   * The increment and promotion start from cycle.effective (the 1st of a month); the bonus is paid in cycle.bonusMonth.
   */
  function changesFrom({ review, emp, cycle, rec, by = '', at = '' }) {
    const out = [], base = { empId: emp.id, source: 'appraisal', ref: review.id, cycle: cycle.name, status: 'scheduled', by, at };
    const inc = Number(rec.inc) || 0, months = Number(rec.bonus) || 0;
    if (inc > 0) out.push({ ...base, id: `${review.id}-salary`, type: 'salary', from: emp.salary, to: Math.round(emp.salary * (1 + inc / 100)), pct: inc, effective: cycle.effective });
    if (months > 0) out.push({ ...base, id: `${review.id}-bonus`, type: 'bonus', amount: r2((emp.salary / 12) * months), months, payMonth: cycle.bonusMonth });
    if (rec.promo && rec.promo.trim() && rec.promo.trim() !== emp.role) out.push({ ...base, id: `${review.id}-role`, type: 'role', from: emp.role, to: rec.promo.trim(), effective: cycle.effective });
    return out;
  }
  const monthOf = (d) => (d || '').slice(0, 7);
  /**
   * Annual salary to use for a pay month. current = the employee's salary now; changes = their salary changes.
   * Applied changes dated after the month are undone (for re-running an older month); scheduled changes dated in
   * or before the month are added.
   */
  function salaryFor(current, changes, mk) {
    const sal = changes.filter((c) => c.type === 'salary');
    let s = current;
    sal.filter((c) => c.status === 'applied' && monthOf(c.effective) > mk).sort((a, b) => b.effective.localeCompare(a.effective)).forEach((c) => { s = c.from; });
    sal.filter((c) => c.status === 'scheduled' && monthOf(c.effective) <= mk).sort((a, b) => a.effective.localeCompare(b.effective)).forEach((c) => { s = c.to; });
    return s;
  }
  // Appraisal bonuses to pay in a month (not yet paid).
  const bonusFor = (changes, mk) => r2(sumBy(changes.filter((c) => c.type === 'bonus' && c.status === 'scheduled' && c.payMonth === mk), (c) => c.amount));
  /** Changes due by today: salary and role changes are applied to the employee. Returns { updates: {empId: {...}}, applied: [ids] }. */
  function applyDue(changes, today) {
    const updates = {}, applied = [];
    changes.filter((c) => c.status === 'scheduled' && c.type !== 'bonus' && c.effective <= today).sort((a, b) => a.effective.localeCompare(b.effective)).forEach((c) => {
      updates[c.empId] = { ...(updates[c.empId] || {}), [c.type === 'salary' ? 'salary' : 'role']: c.to };
      applied.push(c.id);
    });
    return { updates, applied };
  }

  // ---------- Reports ----------
  function distribution(reviews, { employees, departments, bands = defaultBands() }) {
    const rows = departments.map((d) => ({ id: d.id, name: d.name, counts: Object.fromEntries(bands.map((b) => [b.code, 0])), total: 0, done: 0, scores: [] }));
    reviews.forEach((a) => {
      const e = employees.find((x) => x.id === a.empId), row = rows.find((r) => r.id === e?.dept);
      if (!row) return;
      row.total++;
      if (a.stage === 'done' && a.final?.score != null) { row.done++; row.scores.push(a.final.score); const g = grade(a.final.score, bands); if (g) row.counts[g.code]++; }
    });
    return rows.filter((r) => r.total).map((r) => ({ ...r, avg: r.scores.length ? r2(sumBy(r.scores, (x) => x) / r.scores.length) : null }));
  }
  const completion = (reviews) => Object.fromEntries(Object.keys(STAGES).map((s) => [s, reviews.filter((a) => a.stage === s).length]));

  return { SCALE_1_5, STAGES, defaultTemplate, defaultBands, templateFor, questions, score, grade, nextStage, dueFor, overdue, statusOf, peerSummary, goalProgress, goalProblems, changesFrom, salaryFor, bonusFor, applyDue, distribution, completion };
})();
