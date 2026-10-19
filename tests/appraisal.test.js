// Unit tests for the appraisal rules: weighted scoring, grade bands, the flow, 360° summaries, goals and the pay
// changes from approved results, including what payroll uses for each month.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'appraisal-rules.js'), 'utf8'), sandbox);
const A = sandbox.window.AllurusAppraisalRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);
const all = (t, r) => Object.fromEntries(A.questions(t).map((q) => [q.id, { r }]));

test('the default template weights add up and every question has an id', () => {
  const t = A.defaultTemplate();
  assert.equal(t.sections.reduce((s, x) => s + x.weight, 0), 100);
  assert.equal(A.questions(t).length, 9);
});

test('weighted score: all 3s, all 5s, and a mix across weighted sections and questions', () => {
  const t = A.defaultTemplate();
  assert.equal(A.score(t, all(t, 3)).total, 3);
  assert.equal(A.score(t, all(t, 5)).total, 5);
  assert.equal(A.score(t, all(t, 5)).pct, 100);
  // KPIs (50%): k1 weight 2 at 5, k2 and k3 at 3 → (10 + 3 + 3) / 4 = 4. Competencies (30%) at 4. Values (20%) at 2.
  const s = A.score(t, { ...all(t, 4), k1: { r: 5 }, k2: { r: 3 }, k3: { r: 3 }, v1: { r: 2 }, v2: { r: 2 }, v3: { r: 2 } });
  deq(s.sections.map((x) => x.score), [4, 4, 2]);
  assert.equal(s.total, 3.6); // 0.5 × 4 + 0.3 × 4 + 0.2 × 2
  assert.equal(s.complete, true);
});

test('incomplete scores: only answered questions and sections count, and it says so', () => {
  const t = A.defaultTemplate();
  const s = A.score(t, { k1: { r: 4 }, c1: { r: 2 } });
  assert.equal(s.complete, false);
  deq(s.sections.map((x) => x.score), [4, 2, null]);
  assert.equal(s.total, 3.25); // (50 × 4 + 30 × 2) / 80
  assert.equal(A.score(t, {}).total, null);
});

test('custom rating scale is converted to the 5-point score', () => {
  const t = { scale: { min: 1, max: 4 }, sections: [{ id: 's', weight: 1, questions: [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }] }] };
  assert.equal(A.score(t, { a: { r: 4 }, b: { r: 2 } }).total, 3.75); // (5 + 2.5) / 2
  const ten = { scale: { min: 0, max: 10 }, sections: [{ id: 's', weight: 1, questions: [{ id: 'a', weight: 1 }] }] };
  assert.equal(A.score(ten, { a: { r: 7 } }).total, 3.5);
});

test('grade bands', () => {
  const b = A.defaultBands();
  assert.equal(A.grade(5, b).code, 'A');
  assert.equal(A.grade(4.5, b).code, 'A');
  assert.equal(A.grade(4.49, b).code, 'B');
  assert.equal(A.grade(3.75, b).code, 'B');
  assert.equal(A.grade(3, b).code, 'C');
  assert.equal(A.grade(2, b).code, 'D');
  assert.equal(A.grade(1, b).code, 'E');
  assert.equal(A.grade(null, b), null);
  // Custom bands in any order.
  assert.equal(A.grade(3.2, [{ code: 'X', min: 0 }, { code: 'Y', min: 3 }]).code, 'Y');
});

test('template for a person: their own, then department, then the cycle default', () => {
  const std = { id: 'std', depts: [], people: [] }, sales = { id: 'sales', depts: ['d-sales'], people: [] }, one = { id: 'one', depts: [], people: ['e9'] };
  const list = [std, sales, one], cycle = { templateId: 'std' };
  assert.equal(A.templateFor({ id: 'e9', dept: 'd-sales' }, cycle, list).id, 'one');
  assert.equal(A.templateFor({ id: 'e6', dept: 'd-sales' }, cycle, list).id, 'sales');
  assert.equal(A.templateFor({ id: 'e2', dept: 'd-eng' }, cycle, list).id, 'std');
});

test('flow: self → L1 → optional L2 → HR → done, and overdue steps', () => {
  assert.equal(A.nextStage('self'), 'l1');
  assert.equal(A.nextStage('l1', { l2: true, hasL2: true }), 'l2');
  assert.equal(A.nextStage('l1', { l2: true, hasL2: false }), 'hr');
  assert.equal(A.nextStage('l1', { l2: false, hasL2: true }), 'hr');
  assert.equal(A.nextStage('l2'), 'hr');
  assert.equal(A.nextStage('self', { hasL1: false }), 'hr');
  assert.equal(A.nextStage('hr'), 'done');
  const cycle = { selfDue: '2026-10-17', managerDue: '2026-10-29', hrDue: '2026-11-08' };
  assert.equal(A.overdue({ stage: 'self' }, cycle, '2026-10-19'), true);
  assert.equal(A.overdue({ stage: 'l1' }, cycle, '2026-10-19'), false);
  assert.equal(A.overdue({ stage: 'done' }, cycle, '2027-01-01'), false);
  assert.equal(A.statusOf({ stage: 'self' }), 'Not started');
  assert.equal(A.statusOf({ stage: 'self', self: { draftAt: 'x' } }), 'In progress');
  assert.equal(A.statusOf({ stage: 'done' }), 'Completed');
});

test('360° summary stays hidden until enough peers answer, and has no names', () => {
  const qs = [{ id: 'c1', text: 'Skills' }, { id: 'v2', text: 'Teamwork' }];
  const one = A.peerSummary([{ empId: 'e3', status: 'done', answers: { c1: 4 } }, { empId: 'e5', status: 'requested' }], qs);
  deq({ shown: one.shown, responses: one.responses, needed: one.needed }, { shown: false, responses: 1, needed: 2 });
  const s = A.peerSummary([
    { empId: 'e3', status: 'done', answers: { c1: 4, v2: 5 }, comment: 'Always helps the team.' },
    { empId: 'e5', status: 'done', answers: { c1: 3, v2: 4 }, comment: '' },
  ], qs);
  assert.equal(s.shown, true);
  deq(s.questions.map((q) => q.avg), [3.5, 4.5]);
  deq(s.comments, ['Always helps the team.']);
  assert.ok(!JSON.stringify(s).includes('e3'), 'no peer ids in the summary');
});

test('goals: weighted progress and SMART checks', () => {
  assert.equal(A.goalProgress([{ progress: 100, weight: 1 }, { progress: 40, weight: 3 }]), 55);
  assert.equal(A.goalProgress([]), 0);
  assert.equal(A.goalProgress([{ progress: 140 }]), 100);
  assert.equal(A.goalProblems({ title: 'Ship v2', measure: 'Release date', target: 'By 30 Nov', due: '2026-11-30' }).length, 0);
  assert.equal(A.goalProblems({ title: 'Be better' }).length, 3);
});

const emp = { id: 'e2', salary: 120000, role: 'Software Engineer' };
const cycle = { name: 'H2 2026', effective: '2027-01-01', bonusMonth: '2026-12' };

test('approved recommendations become scheduled pay changes', () => {
  const ch = A.changesFrom({ review: { id: 'r2' }, emp, cycle, rec: { inc: 6, bonus: 1.5, promo: 'Senior Software Engineer' } });
  deq(ch.map((c) => [c.type, c.from ?? null, c.to ?? null, c.amount ?? null, c.effective ?? c.payMonth]), [
    ['salary', 120000, 127200, null, '2027-01-01'],
    ['bonus', null, null, 15000, '2026-12'],
    ['role', 'Software Engineer', 'Senior Software Engineer', null, '2027-01-01'],
  ]);
  assert.ok(ch.every((c) => c.status === 'scheduled'));
  assert.equal(A.changesFrom({ review: { id: 'r' }, emp, cycle, rec: { inc: 0, bonus: 0, promo: 'Software Engineer' } }).length, 0);
});

test('payroll uses the salary in effect for each month', () => {
  const ch = A.changesFrom({ review: { id: 'r2' }, emp, cycle, rec: { inc: 6, bonus: 1.5 } });
  // Before the effective month: the old salary; from it: the new one.
  assert.equal(A.salaryFor(120000, ch, '2026-12'), 120000);
  assert.equal(A.salaryFor(120000, ch, '2027-01'), 127200);
  assert.equal(A.salaryFor(120000, ch, '2027-06'), 127200);
  // Once applied to the employee, re-running December still uses the old salary.
  const applied = ch.map((c) => (c.type === 'salary' ? { ...c, status: 'applied' } : c));
  assert.equal(A.salaryFor(127200, applied, '2026-12'), 120000);
  assert.equal(A.salaryFor(127200, applied, '2027-02'), 127200);
  // Two increments in a row.
  const more = [...applied, { type: 'salary', from: 127200, to: 133560, effective: '2027-07-01', status: 'scheduled' }];
  assert.equal(A.salaryFor(127200, more, '2027-07'), 133560);
  assert.equal(A.salaryFor(127200, more, '2026-11'), 120000);
  // The bonus is paid in its month only, until it's paid.
  assert.equal(A.bonusFor(ch, '2026-12'), 15000);
  assert.equal(A.bonusFor(ch, '2027-01'), 0);
  assert.equal(A.bonusFor(ch.map((c) => ({ ...c, status: 'paid' })), '2026-12'), 0);
});

test('changes due by today are applied to the employee record', () => {
  const ch = A.changesFrom({ review: { id: 'r2' }, emp, cycle, rec: { inc: 6, bonus: 1, promo: 'Lead' } });
  deq(A.applyDue(ch, '2026-12-31'), { updates: {}, applied: [] });
  const r = A.applyDue(ch, '2027-01-01');
  deq(r.updates, { e2: { salary: 127200, role: 'Lead' } });
  deq(r.applied, ['r2-salary', 'r2-role']);
});

test('reports: distribution by department and completion by stage', () => {
  const employees = [{ id: 'a', dept: 'd1' }, { id: 'b', dept: 'd1' }, { id: 'c', dept: 'd2' }];
  const reviews = [{ empId: 'a', stage: 'done', final: { score: 4.6 } }, { empId: 'b', stage: 'l1' }, { empId: 'c', stage: 'done', final: { score: 3 } }];
  const d = A.distribution(reviews, { employees, departments: [{ id: 'd1', name: 'One' }, { id: 'd2', name: 'Two' }, { id: 'd3', name: 'Empty' }] });
  deq(d.map((r) => [r.name, r.total, r.done, r.counts.A, r.counts.C, r.avg]), [['One', 2, 1, 1, 0, 4.6], ['Two', 1, 1, 0, 1, 3]]);
  deq(A.completion(reviews), { self: 0, l1: 1, l2: 0, hr: 0, done: 2 });
});

test('payroll: a scheduled increment and bonus flow into the pay calculation', () => {
  const sb = { console };
  sb.window = sb;
  vm.createContext(sb);
  for (const f of ['utils', 'appraisal-rules']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), sb);
  const U = sb.U, R = sb.AllurusAppraisalRules;
  const settings = { currency: 'MYR', taxRate: 8, benefitsRate: 11.7, statutory: { ...U.STATUTORY } };
  const ch = R.changesFrom({ review: { id: 'r5' }, emp: { id: 'e5', salary: 112000, role: 'Frontend Engineer' }, cycle, rec: { inc: 6, bonus: 1.5 } });
  const pay = (mk) => U.payCalc(R.salaryFor(112000, ch, mk), R.bonusFor(ch, mk), settings, null, U.monthEnd(mk));
  const nov = pay('2026-11'), dec = pay('2026-12'), jan = pay('2027-01');
  assert.equal(nov.base, 9333.33);
  assert.equal(nov.bonus, 0);
  // December: same basic, plus 1.5 months of the old basic as bonus, which is in gross pay and PCB.
  assert.equal(dec.base, 9333.33);
  assert.equal(dec.bonus, 14000);
  assert.equal(dec.gross, U.round2(nov.gross + 14000));
  assert.ok(dec.tax > nov.tax);
  // January: the new basic (112,000 × 1.06 = 118,720 a year).
  assert.equal(jan.base, 9893.33);
  assert.equal(jan.bonus, 0);
  assert.ok(jan.net > nov.net);
});
