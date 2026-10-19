// Unit tests for the HR admin rules: edit requests, checklists, the org tree, staff loans, letters, career history
// and expiry reminders.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'hr-rules.js'), 'utf8'), sandbox);
const H = sandbox.window.AllurusHRRules;
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, msg);

const emp = { id: 'e2', first: 'Daniel', last: 'Reyes', phone: '012-345 6789', address: 'Kuantan', salary: 142000, role: 'Engineer', emergency: { name: 'Ana', relation: 'Spouse', phone: '011' }, bank: 'Maybank', accountNo: '1234' };

test('edit requests: only personal fields count, and only real changes', () => {
  const d = H.diffRequest(emp, { phone: '012-345 6789 ', address: 'Kuala Terengganu', 'emergency.phone': '019-222', salary: 999999, role: 'CEO' });
  deq(d.map((x) => [x.field, x.from, x.to]), [['address', 'Kuantan', 'Kuala Terengganu'], ['emergency.phone', '011', '019-222']]);
  const out = H.applyRequest(emp, [...d, { field: 'salary', to: 1 }]);
  assert.equal(out.address, 'Kuala Terengganu');
  assert.equal(out.emergency.phone, '019-222');
  assert.equal(out.emergency.name, 'Ana');
  assert.equal(out.salary, 142000, 'salary is never changed by a request');
  assert.equal(emp.address, 'Kuantan', 'the original is untouched');
  // A nested field on someone without one yet.
  assert.equal(H.applyRequest({ id: 'x' }, [{ field: 'emergency.name', to: 'Siti' }]).emergency.name, 'Siti');
});

test('onboarding checklist: due dates from the start date, owners resolved, HR as fallback', () => {
  const c = H.buildChecklist(H.defaultOnboarding(), { empId: 'e9', anchor: '2026-11-02', owners: { hr: 'e1', manager: 'e4', employee: 'e9' } });
  assert.equal(c.kind, 'onboarding');
  const by = Object.fromEntries(c.tasks.map((x) => [x.id, x]));
  assert.equal(by.o1.due, '2026-10-26');
  assert.equal(by.o7.due, '2026-11-02');
  assert.equal(by.o12.due, '2026-12-02');
  assert.equal(by.o9.assignee, 'e4');
  assert.equal(by.o11.assignee, 'e9');
  assert.equal(by.o5.assignee, 'e1', 'no IT owner set → HR');
  deq(H.progress(c), { done: 0, total: 12, pct: 0, complete: false });
  c.tasks.forEach((x, i) => { x.done = i < 6; });
  deq(H.progress(c), { done: 6, total: 12, pct: 50, complete: false });
  assert.equal(H.overdueTasks([c], '2026-11-05').map((x) => x.id).join(','), 'o7,o8,o9', 'due today is not overdue yet');
});

test('offboarding checklist counts back from the last day and includes the LHDN form and final pay', () => {
  const c = H.buildChecklist(H.defaultOffboarding(), { empId: 'e16', anchor: '2026-11-30', owners: { hr: 'e1', payroll: 'e19' } });
  const f2 = c.tasks.find((x) => x.kind === 'form'), pay = c.tasks.find((x) => x.kind === 'pay');
  assert.equal(f2.due, '2026-10-31');
  assert.equal(pay.assignee, 'e19');
  assert.ok(c.tasks.some((x) => x.kind === 'interview') && c.tasks.some((x) => x.kind === 'asset'));
});

test('org tree: reports-to links, roots, sizes, inactive managers and loops', () => {
  const p = (id, manager, status = 'Active') => ({ id, first: id, last: '', manager, status });
  const tree = H.orgTree([p('ceo', ''), p('a', 'ceo'), p('b', 'ceo'), p('a1', 'a'), p('a2', 'a'), p('x', 'gone'), p('l1', 'l2'), p('l2', 'l1'), p('old', '', 'Inactive'), p('o1', 'old')]);
  const roots = tree.map((n) => n.emp.id);
  assert.equal(roots[0], 'ceo');
  assert.equal(tree[0].size, 4);
  assert.ok(roots.includes('x') && roots.includes('l1') && roots.includes('l2') && roots.includes('o1'));
  assert.ok(!roots.includes('old'));
  deq(H.flatten(tree).filter((r) => r.depth > 0).map((r) => r.emp.id), ['a', 'a1', 'a2', 'b']);
});

test('staff loans: equal instalments, rounding in the last, balance by month and extra repayments', () => {
  const loan = { amount: 5000, months: 12, start: '2026-08' };
  const s = H.loanSchedule(loan);
  assert.equal(s.length, 12);
  assert.equal(s[0].amount, 416.66);
  assert.equal(s[11].amount, 416.74);
  assert.equal(s[11].month, '2027-07');
  assert.equal(Math.round(s.reduce((x, y) => x + y.amount, 0) * 100) / 100, 5000);
  deq(H.loanBalance(loan, '2026-10'), { paid: 1249.98, balance: 3750.02, settled: false });
  deq(H.loanBalance(loan, '2027-07'), { paid: 5000, balance: 0, settled: true });
  deq(H.loanBalance({ ...loan, extra: [{ month: '2026-09', amount: 3750.02 }] }, '2026-10'), { paid: 5000, balance: 0, settled: true });
});

test('letters: placeholders filled, missing ones visible, unknown ones reported', () => {
  const text = 'Dear {{employee.name}}, from {{ effective_date }} you are {{new_role}}. {{bogus.field}}';
  assert.equal(H.fill(text, { 'employee.name': 'Daniel Reyes', effective_date: '1 January 2027' }), 'Dear Daniel Reyes, from 1 January 2027 you are [new_role]. [bogus.field]');
  deq(H.unknownPlaceholders(text), ['bogus.field']);
  const all = H.defaultLetters();
  deq(all.map((l) => l.id), ['offer', 'confirmation', 'increment', 'warning', 'transfer', 'resignation']);
  all.forEach((l) => { deq(H.unknownPlaceholders(l.body + l.subject), [], l.id); l.asks.forEach((k) => assert.ok(H.PLACEHOLDERS[k], `${l.id} asks for ${k}`)); });
});

test('career history: joined, promotion, transfer and increment from record changes', () => {
  const names = { 'd-eng': 'Engineering', 'd-design': 'Design' };
  deq(H.careerChanges(null, { role: 'Engineer', dept: 'd-eng', start: '2024-03-01' }, '2026-10-19', { deptName: (d) => names[d] }), [{ date: '2024-03-01', type: 'joined', to: 'Engineer', note: 'Engineering' }]);
  const c = H.careerChanges({ role: 'Engineer', dept: 'd-eng', salary: 100000 }, { role: 'Lead Designer', dept: 'd-design', salary: 106000 }, '2026-10-19', { deptName: (d) => names[d] });
  deq(c.map((x) => [x.type, x.from, x.to]), [['promotion', 'Engineer', 'Lead Designer'], ['transfer', 'Engineering', 'Design'], ['increment', 100000, 106000]]);
  assert.equal(c[2].pct, 6);
  assert.equal(H.careerChanges({ role: 'A', dept: 'd', salary: 1 }, { role: 'A', dept: 'd', salary: 1 }, 'x').length, 0);
});

test('expiry: within the window or up to 30 days past, soonest first', () => {
  const items = [{ id: 'a', expiry: '2026-12-31' }, { id: 'b', expiry: '2026-11-01' }, { id: 'c', expiry: '2026-09-01' }, { id: 'd', expiry: '2026-10-10' }, { id: 'e', expiry: '' }];
  deq(H.expiring(items, '2026-10-19').map((x) => [x.id, x.left]), [['d', -9], ['b', 13]]);
  deq(H.expiring(items, '2026-10-19', 90).map((x) => x.id), ['d', 'b', 'a']);
});

test('daily reminders include expiring documents and policies', () => {
  const sb = { window: {} };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'notify-rules.js'), 'utf8'), sb);
  const N = sb.window.AllurusNotifyRules;
  const employees = [{ id: 'e18', first: 'Samuel', last: 'Adeyemi', status: 'Active' }, { id: 'e5', first: 'Old', last: 'Leaver', status: 'Inactive' }];
  const documents = [
    { id: 'd1', empId: 'e18', title: 'Employment Pass', expiry: '2026-12-01' },
    { id: 'd2', empId: 'e18', title: 'Degree', expiry: '' },
    { id: 'd3', empId: 'e5', title: 'Passport', expiry: '2026-11-01' },
    { id: 'p1', empId: '', title: 'Group hospitalisation', expiry: '2026-10-31' },
    { id: 'p2', empId: '', title: 'Car insurance', expiry: '2027-06-01' },
  ];
  const r = N.reminders({ employees, today: '2026-10-19', documents }).filter((x) => x.type === 'reminder.document');
  deq(r.map((x) => [x.data.title, x.to, x.data.left]), [['Employment Pass', ['hr', 'e18'], 43], ['Group hospitalisation', 'hr', 12]]);
  const m = N.build('reminder.document', { ...r[0].data, self: true });
  assert.equal(m.title, 'Your Employment Pass expires in 43 days');
});
