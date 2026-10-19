// HR admin rules: personal-detail edit requests, onboarding and offboarding checklists from templates, the org
// chart tree, staff loan schedules, letter placeholders, career history, and expiry reminders for documents and
// insurance. Pure functions with no DOM access, unit tested in tests/hr.test.js.
window.AllurusHRRules = (function () {
  'use strict';
  const parse = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const addMonths = (mk, n) => { const d = new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7) - 1 + n, 1)); return iso(d).slice(0, 7); };
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // ---------- Personal details that employees can ask to change ----------
  // Everything else (job, pay, statutory numbers) is changed by HR only.
  const PERSONAL = {
    phone: 'Phone', personalEmail: 'Personal email', address: 'Home address', married: 'Marital status',
    'emergency.name': 'Emergency contact', 'emergency.relation': 'Relationship', 'emergency.phone': 'Emergency contact phone',
    bank: 'Bank', accountNo: 'Account number',
  };
  const get = (o, k) => k.split('.').reduce((x, p) => (x == null ? undefined : x[p]), o);
  const norm = (v) => (typeof v === 'boolean' ? v : v == null ? '' : String(v).trim());
  /** What an employee's proposed details change: [{ field, label, from, to }]. Fields outside PERSONAL are ignored. */
  function diffRequest(emp, proposed) {
    return Object.keys(PERSONAL).filter((k) => k in proposed && norm(proposed[k]) !== norm(get(emp, k)))
      .map((k) => ({ field: k, label: PERSONAL[k], from: norm(get(emp, k)), to: norm(proposed[k]) }));
  }
  /** Applies approved changes to a copy of the employee. Unknown fields are never written. */
  function applyRequest(emp, changes) {
    const out = JSON.parse(JSON.stringify(emp));
    changes.filter((c) => PERSONAL[c.field]).forEach((c) => {
      const parts = c.field.split('.');
      let o = out;
      parts.slice(0, -1).forEach((p) => { o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; o = o[p]; });
      o[parts[parts.length - 1]] = c.to;
    });
    return out;
  }

  // ---------- Checklists ----------
  const KINDS = { document: 'Documents', account: 'Accounts', asset: 'Assets', training: 'Training', pay: 'Final pay', form: 'LHDN form', interview: 'Exit interview', other: 'Other' };
  const OWNERS = { hr: 'HR', manager: 'Manager', it: 'IT', employee: 'Employee', payroll: 'Payroll' };
  // Days are relative to the start date (onboarding) or the last day (offboarding).
  const t = (id, title, kind, owner, day) => ({ id, title, kind, owner, day });
  const defaultOnboarding = () => ({ id: 'onb-standard', kind: 'onboarding', name: 'New starter', items: [
    t('o1', 'Collect a copy of IC or passport', 'document', 'hr', -7), t('o2', 'Collect bank account details', 'document', 'hr', -7),
    t('o3', 'Collect EPF, SOCSO and income tax numbers', 'document', 'hr', -7), t('o4', 'Signed employment contract', 'document', 'hr', -5),
    t('o5', 'Create email and chat accounts', 'account', 'it', -2), t('o6', 'Add to payroll and the attendance app', 'account', 'hr', -1),
    t('o7', 'Issue laptop', 'asset', 'it', 0), t('o8', 'Issue access card', 'asset', 'hr', 0),
    t('o9', 'Welcome and team introductions', 'training', 'manager', 0), t('o10', 'Workplace safety and PDPA briefing', 'training', 'hr', 3),
    t('o11', 'Read and acknowledge the employee handbook', 'training', 'employee', 7), t('o12', 'First-month check-in with manager', 'training', 'manager', 30),
  ] });
  const defaultOffboarding = () => ({ id: 'off-standard', kind: 'offboarding', name: 'Leaver', items: [
    t('f1', 'Accept the resignation in writing', 'document', 'hr', -30), t('f2', 'File CP22A or CP21 with LHDN', 'form', 'hr', -30),
    t('f3', 'Hand over work and documents', 'other', 'manager', -5), t('f4', 'Exit interview', 'interview', 'hr', -3),
    t('f5', 'Return company assets', 'asset', 'employee', 0), t('f6', 'Close email and system accounts', 'account', 'it', 0),
    t('f7', 'Final pay: salary to last day, unused leave, deductions', 'pay', 'payroll', 0), t('f8', 'Issue certificate of service', 'document', 'hr', 7),
  ] });
  /**
   * A checklist for one person from a template. anchor = start date or last day; owners maps owner roles to
   * employee ids ({ hr, it, payroll, manager, employee }); a missing one falls back to HR.
   */
  function buildChecklist(template, { empId, anchor, owners = {}, id = '', created = '' }) {
    return {
      id: id || `${template.kind}-${empId}`, empId, kind: template.kind, templateId: template.id, anchor, created,
      tasks: template.items.map((x) => ({ id: x.id, title: x.title, kind: x.kind, owner: x.owner, assignee: owners[x.owner] || owners.hr || '', due: addDays(anchor, x.day), done: false, doneAt: '', doneBy: '' })),
    };
  }
  function progress(list) {
    const tasks = list?.tasks || [];
    const done = tasks.filter((x) => x.done).length;
    return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, complete: tasks.length > 0 && done === tasks.length };
  }
  const overdueTasks = (lists, today) => lists.flatMap((l) => l.tasks.filter((x) => !x.done && x.due < today).map((x) => ({ ...x, listId: l.id, empId: l.empId, kind2: l.kind })));

  // ---------- Org chart ----------
  /**
   * Builds the "reports to" tree. People whose manager is missing, inactive or inside a loop become roots.
   * Returns [{ emp, children: [...], size }] sorted by name, where size counts everyone below.
   */
  function orgTree(employees) {
    const people = employees.filter((e) => e.status !== 'Inactive');
    const byId = Object.fromEntries(people.map((e) => [e.id, e]));
    const parentOf = (e) => {
      const seen = new Set([e.id]);
      let m = byId[e.manager];
      while (m) { if (seen.has(m.id)) return null; seen.add(m.id); m = byId[m.manager]; }
      return byId[e.manager] ? e.manager : null;
    };
    const kids = {};
    const roots = [];
    people.forEach((e) => { const p = parentOf(e); if (p) (kids[p] = kids[p] || []).push(e); else roots.push(e); });
    const name = (e) => `${e.first} ${e.last}`;
    const node = (e) => { const children = (kids[e.id] || []).sort((a, b) => name(a).localeCompare(name(b))).map(node); return { emp: e, children, size: children.reduce((s, c) => s + 1 + c.size, 0) }; };
    return roots.sort((a, b) => (kids[b.id] || []).length - (kids[a.id] || []).length || name(a).localeCompare(name(b))).map(node);
  }
  const flatten = (tree, depth = 0) => tree.flatMap((n) => [{ emp: n.emp, depth, reports: n.children.length, size: n.size }, ...flatten(n.children, depth + 1)]);

  // ---------- Staff loans ----------
  /** Equal monthly instalments (no interest) from the first month; the last one takes the rounding. */
  function loanSchedule({ amount, months, start }) {
    const n = Math.max(1, Math.round(months)), each = r2(Math.floor((amount / n) * 100) / 100);
    return Array.from({ length: n }, (_, i) => ({ month: addMonths(start, i), amount: i === n - 1 ? r2(amount - each * (n - 1)) : each }));
  }
  /** Paid so far and the balance after a month; extra one-off repayments count too. */
  function loanBalance(loan, mk) {
    const paid = r2(loanSchedule(loan).filter((x) => x.month <= mk).reduce((s, x) => s + x.amount, 0) + (loan.extra || []).filter((x) => x.month <= mk).reduce((s, x) => s + x.amount, 0));
    return { paid: Math.min(loan.amount, paid), balance: r2(Math.max(0, loan.amount - paid)), settled: paid >= loan.amount - 0.005 };
  }

  // ---------- Letters ----------
  const PLACEHOLDERS = {
    'employee.name': 'Full name', 'employee.first': 'First name', 'employee.role': 'Job title', 'employee.department': 'Department',
    'employee.id_no': 'IC or passport number', 'employee.address': 'Home address', 'employee.start_date': 'Start date',
    'employee.salary_monthly': 'Monthly basic salary', 'employee.probation_end': 'Probation end date', 'manager.name': 'Manager',
    'company.name': 'Company name', 'company.address': 'Company address', 'signatory.name': 'Signed by', 'signatory.title': 'Signatory title',
    today: 'Today’s date', effective_date: 'Effective date', new_role: 'New job title', new_department: 'New department',
    new_salary_monthly: 'New monthly salary', increment_pct: 'Increment %', last_day: 'Last day of work', reason: 'Reason or details',
  };
  /** Replaces {{placeholders}}; unknown or empty ones are left visible as [placeholder] so nothing is silently blank. */
  const fill = (text, data) => text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (data[k] != null && data[k] !== '' ? String(data[k]) : `[${k}]`));
  const placeholdersIn = (text) => [...new Set([...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
  const unknownPlaceholders = (text) => placeholdersIn(text).filter((k) => !PLACEHOLDERS[k]);
  const L = (id, name, asks, subject, body) => ({ id, name, asks, subject, body, builtin: true });
  const defaultLetters = () => [
    L('offer', 'Offer of employment', ['effective_date'], 'Offer of employment: {{employee.role}}',
      'Dear {{employee.name}},\n\nWe are pleased to offer you the position of {{employee.role}} in our {{employee.department}} department, starting on {{effective_date}}.\n\nYour monthly basic salary will be {{employee.salary_monthly}}. You will be on probation until {{employee.probation_end}}, reporting to {{manager.name}}.\n\nThe full terms are set out in the attached employment contract. Please sign and return a copy to accept this offer.\n\nWe look forward to welcoming you to {{company.name}}.'),
    L('confirmation', 'Confirmation of employment', ['effective_date'], 'Confirmation of employment',
      'Dear {{employee.name}},\n\nWe are pleased to confirm your employment as {{employee.role}} with effect from {{effective_date}}, following the successful completion of your probation.\n\nAll other terms of your employment remain the same.\n\nThank you for your contribution so far.'),
    L('increment', 'Salary increment', ['effective_date', 'increment_pct', 'new_salary_monthly'], 'Salary increment',
      'Dear {{employee.name}},\n\nIn recognition of your performance, we are pleased to inform you that your monthly basic salary will be increased by {{increment_pct}}% to {{new_salary_monthly}}, with effect from {{effective_date}}.\n\nAll other terms of your employment remain the same. Thank you for your hard work.'),
    L('warning', 'Warning letter', ['reason'], 'Warning letter',
      'Dear {{employee.name}},\n\nThis letter is a formal warning about the following: {{reason}}\n\nThis was discussed with you, and you were given the opportunity to explain. We expect immediate and lasting improvement. A further breach may lead to further disciplinary action.\n\nPlease sign a copy of this letter to acknowledge receipt.'),
    L('transfer', 'Transfer letter', ['effective_date', 'new_role', 'new_department'], 'Transfer',
      'Dear {{employee.name}},\n\nWe write to confirm your transfer to the {{new_department}} department as {{new_role}}, with effect from {{effective_date}}.\n\nYour salary and other terms of employment remain the same unless stated otherwise. Thank you for your flexibility.'),
    L('resignation', 'Resignation acceptance', ['last_day'], 'Acceptance of resignation',
      'Dear {{employee.name}},\n\nWe acknowledge receipt of your resignation and accept it. Your last day of work will be {{last_day}}.\n\nPlease return all company property before your last day. Your final pay, including any unused annual leave, will be paid with the next payroll.\n\nThank you for your contribution to {{company.name}}, and we wish you every success.'),
  ];

  // ---------- Career history ----------
  /** Career entries for a change to the employee record (job title, department, manager or salary). */
  function careerChanges(before, after, date, { deptName = (x) => x } = {}) {
    if (!before) return [{ date: after.start || date, type: 'joined', to: after.role, note: deptName(after.dept) }];
    const out = [];
    if (after.role !== before.role) out.push({ date, type: 'promotion', from: before.role, to: after.role });
    if (after.dept !== before.dept) out.push({ date, type: 'transfer', from: deptName(before.dept), to: deptName(after.dept) });
    if (Number(after.salary) !== Number(before.salary)) {
      const pct = before.salary ? r2(((after.salary - before.salary) / before.salary) * 100) : 0;
      out.push({ date, type: pct >= 0 ? 'increment' : 'adjustment', from: Number(before.salary), to: Number(after.salary), pct });
    }
    return out;
  }
  const CAREER = { joined: 'Joined', promotion: 'Promotion', transfer: 'Transfer', increment: 'Increment', adjustment: 'Salary change', confirmation: 'Confirmed', other: 'Note' };
  const careerSorted = (list) => [...(list || [])].sort((a, b) => b.date.localeCompare(a.date));

  // ---------- Expiry reminders ----------
  /** Documents and policies expiring within `window` days (or up to 30 days past). */
  function expiring(items, today, window = 60) {
    return items.filter((x) => x.expiry).map((x) => ({ ...x, left: days(today, x.expiry) })).filter((x) => x.left <= window && x.left >= -30).sort((a, b) => a.left - b.left);
  }

  return {
    PERSONAL, diffRequest, applyRequest, KINDS, OWNERS, defaultOnboarding, defaultOffboarding, buildChecklist, progress, overdueTasks,
    orgTree, flatten, loanSchedule, loanBalance, PLACEHOLDERS, fill, placeholdersIn, unknownPlaceholders, defaultLetters,
    careerChanges, CAREER, careerSorted, expiring, addDays,
  };
})();
