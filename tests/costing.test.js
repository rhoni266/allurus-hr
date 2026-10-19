// Unit tests for project costing: the tree, splitting check-in time across projects, timesheets replacing
// check-in time, hourly labour cost with employer contributions, and the roll-ups against targets and budgets.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'costing-rules.js'), 'utf8'), sandbox);
const C = sandbox.window.AllurusCostingRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

const projects = [{ id: 'p1', code: 'P1', name: 'Booking app' }, { id: 'p2', code: 'P2', name: 'Plant system' }];
const groups = [{ id: 'g1', projectId: 'p1', name: 'Build' }, { id: 'g2', projectId: 'p1', name: 'Launch' }, { id: 'g3', projectId: 'p2', name: 'Design' }];
const jobs = [
  { id: 'j1', groupId: 'g1', name: 'Front end', targetHours: 200, budget: 20000 },
  { id: 'j2', groupId: 'g1', name: 'Back end', targetHours: 150, budget: 15000 },
  { id: 'j3', groupId: 'g2', name: 'Store release', targetHours: 20, budget: 2000 },
  { id: 'j4', groupId: 'g3', name: 'Survey', targetHours: 40, budget: 3600 },
];

test('tree: three levels with targets and budgets rolled up', () => {
  const t = C.tree(projects, groups, jobs);
  deq(t.map((p) => [p.id, p.targetHours, p.budget, p.groups.length]), [['p1', 370, 37000, 2], ['p2', 40, 3600, 1]]);
  deq(t[0].groups.map((g) => [g.id, g.targetHours, g.budget]), [['g1', 350, 35000], ['g2', 20, 2000]]);
  deq(C.locate('j3', groups, jobs).projectId, 'p1');
});

test('a day is split across projects in proportion to each check-in', () => {
  // 09:00–12:00 on j1, 13:00–18:00 on p2 without a job: 3 h and 5 h of span; 7 h worked after the break.
  const a = C.allocateDay([{ in: '09:00', out: '12:00', project: 'p1', job: 'j1' }, { in: '13:00', out: '18:00', project: 'p2', job: '' }], 420);
  deq(a, [{ project: 'p1', job: 'j1', minutes: 158 }, { project: 'p2', job: '', minutes: 262 }]);
  assert.equal(a.reduce((s, x) => s + x.minutes, 0), 420, 'no minutes lost to rounding');
  // Same project twice is merged; an open check-in (no out) is ignored; a night shift wraps midnight.
  deq(C.allocateDay([{ in: '22:00', out: '02:00', project: 'p1', job: 'j2' }, { in: '02:30', out: '06:00', project: 'p1', job: 'j2' }, { in: '06:00', out: '', project: 'p2' }], 450), [{ project: 'p1', job: 'j2', minutes: 450 }]);
  deq(C.allocateDay([], 480), []);
});

test('a timesheet for a day replaces that day’s check-in time', () => {
  const checkins = [{ empId: 'e1', day: '2026-10-01', project: 'p1', job: 'j1', minutes: 480 }, { empId: 'e1', day: '2026-10-02', project: 'p1', job: 'j1', minutes: 480 }];
  const sheets = [{ empId: 'e1', day: '2026-10-02', project: 'p2', job: 'j4', minutes: 300 }];
  const m = C.mergeTime(checkins, sheets);
  deq(m.map((x) => [x.day, x.job, x.minutes, x.source]), [['2026-10-01', 'j1', 480, 'check-in'], ['2026-10-02', 'j4', 300, 'timesheet']]);
});

test('hourly labour cost includes employer EPF, SOCSO and EIS', () => {
  // RM 5,200 basic, employer EPF 13% = 676, SOCSO 89.65, EIS 10.40 → RM 5,976.05 ÷ 208 h = RM 28.73.
  deq(C.hourlyCost({ basic: 5200, erEpf: 676, erSocso: 89.65, erEis: 10.4 }), { monthly: 5976.05, standardHours: 208, hourly: 28.73 });
  // Other bases: 22 days × 8 h.
  assert.equal(C.hourlyCost({ basic: 4400, days: 22, hours: 8 }).hourly, 25);
  const costed = C.costEntries([{ empId: 'e1', day: '2026-10-01', project: 'p1', job: 'j1', minutes: 90 }], () => 28.73);
  deq(costed.map((x) => [x.hours, x.rate, x.cost]), [[1.5, 28.73, 43.1]]);
});

test('roll-up: actual hours and cost per job, group and project against targets and budgets', () => {
  const t = C.tree(projects, groups, jobs);
  const costed = C.costEntries([
    { empId: 'e1', day: '2026-09-02', project: 'p1', job: 'j1', minutes: 6000 }, // 100 h
    { empId: 'e2', day: '2026-09-03', project: 'p1', job: 'j1', minutes: 1200 }, // 20 h
    { empId: 'e2', day: '2026-10-03', project: 'p1', job: 'j3', minutes: 1800 }, // 30 h, over the 20 h target
    { empId: 'e1', day: '2026-10-04', project: 'p1', job: '', minutes: 120 }, // 2 h without a job
  ], (empId) => (empId === 'e1' ? 50 : 40));
  const r = C.rollup(t, costed);
  const p1 = r[0], g1 = p1.groups[0], j1 = g1.jobs[0], j3 = p1.groups[1].jobs[0];
  deq([j1.hours, j1.cost, j1.hoursPct, j1.costPct, j1.hoursLeft], [120, 5800, 60, 29, 80]);
  deq([j3.hours, j3.cost, j3.hoursPct, j3.hoursLeft, j3.budgetLeft], [30, 1200, 150, -10, 800]);
  deq([g1.hours, g1.cost], [120, 5800]);
  deq([p1.hours, p1.cost, p1.unassignedHours, p1.unassignedCost], [152, 7100, 2, 100]);
  assert.equal(r[1].hours, 0);
  const pivot = C.byMonth(costed, ['2026-09', '2026-10'], (x) => x.project, 'hours');
  deq(pivot, [{ key: 'p1', total: 152, '2026-09': 120, '2026-10': 32 }]);
  deq(C.byMonth(costed, ['2026-10'], (x) => x.empId, 'cost').map((x) => [x.key, x['2026-10']]), [['e2', 1200], ['e1', 100]]);
});
