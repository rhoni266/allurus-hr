// Report rules: headcount, joiners and leavers, turnover, payroll and statutory totals by month with month-on-month
// variance, simple grouping, and the custom report engine (columns, filters, grouping, totals and sort). Pure
// functions with no DOM access, unit tested in tests/reports.test.js.
window.AllurusReportRules = (function () {
  'use strict';
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const sum = (list, f) => r2(list.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const monthOf = (d) => (d || '').slice(0, 7);
  const inRange = (d, from, to) => !!d && (!from || d >= from) && (!to || d <= to);
  /** Month keys from one date to another, inclusive (YYYY-MM). */
  function months(from, to) {
    const out = [];
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const end = to.slice(0, 7);
    for (let i = 0; i < 240; i++) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (k > end) break;
      out.push(k);
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }
  const monthEnd = (mk) => { const [y, m] = mk.split('-').map(Number); return `${mk}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

  // ---------- People ----------
  // Employed on a date: started on or before it and not yet left. Inactive people without a last day are treated as gone.
  const employedOn = (e, d) => !!e.start && e.start <= d && (e.endDate ? e.endDate >= d : e.status !== 'Inactive');
  function headcount(employees, asOf, departments = []) {
    const now = employees.filter((e) => employedOn(e, asOf));
    const rows = departments.map((d) => ({ id: d.id, name: d.name, count: now.filter((e) => e.dept === d.id).length })).filter((r) => r.count);
    const other = now.filter((e) => !departments.some((d) => d.id === e.dept)).length;
    if (other) rows.push({ id: '', name: 'No department', count: other });
    return { total: now.length, rows };
  }
  /** Joiners (start date in range) and leavers (last day in range). */
  function joinersLeavers(employees, from, to) {
    return {
      joiners: employees.filter((e) => inRange(e.start, from, to)).sort((a, b) => a.start.localeCompare(b.start)),
      leavers: employees.filter((e) => inRange(e.endDate, from, to)).sort((a, b) => a.endDate.localeCompare(b.endDate)),
    };
  }
  /**
   * Turnover for a period: leavers ÷ average headcount (the mean of the start and end headcount) × 100.
   * The annualised rate scales it to 12 months.
   */
  function turnover(employees, from, to) {
    const start = employees.filter((e) => employedOn(e, from)).length, end = employees.filter((e) => employedOn(e, to)).length;
    const leavers = employees.filter((e) => inRange(e.endDate, from, to)).length;
    const avg = (start + end) / 2;
    const rate = avg ? r2((leavers / avg) * 100) : 0;
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
    return { start, end, leavers, avg: r2(avg), rate, annualised: days > 0 ? r2(rate * (365 / days)) : 0 };
  }
  /** Turnover month by month across a range. */
  const turnoverByMonth = (employees, from, to) => months(from, to).map((mk) => ({ month: mk, ...turnover(employees, `${mk}-01`, monthEnd(mk)) }));

  // ---------- Payroll ----------
  const PAY_FIELDS = ['gross', 'deductions', 'net', 'employer', 'cost'];
  /** One pay item's figures (statutory items and the simple flat-rate ones). */
  function payFigures(it) {
    const deductions = r2((it.epf ?? it.benefits ?? 0) + (it.socso || 0) + (it.eis || 0) + (it.tax || 0) + (it.zakat || 0));
    const employer = r2((it.erEpf || 0) + (it.erSocso || 0) + (it.erEis || 0) + (it.hrdf || 0));
    return { gross: r2(it.gross || 0), deductions, net: r2(it.net || 0), employer, cost: r2((it.gross || 0) + employer) };
  }
  /**
   * Payroll totals per month with the change from the month before. pick(item) filters items (department or person).
   * Months without a run are skipped. Returns [{ month, people, gross, ..., change: { gross, grossPct, net, netPct, cost, costPct } }].
   */
  function payrollByMonth(payroll, mks, pick = () => true) {
    let prev = null;
    return mks.filter((mk) => payroll[mk]).map((mk) => {
      const items = payroll[mk].items.filter(pick);
      const row = { month: mk, status: payroll[mk].status, people: items.length };
      PAY_FIELDS.forEach((f) => { row[f] = sum(items, (it) => payFigures(it)[f]); });
      const ch = (f) => (prev ? r2(row[f] - prev[f]) : null), pct = (f) => (prev && prev[f] ? r2(((row[f] - prev[f]) / prev[f]) * 100) : null);
      row.change = { gross: ch('gross'), grossPct: pct('gross'), net: ch('net'), netPct: pct('net'), cost: ch('cost'), costPct: pct('cost'), people: prev ? row.people - prev.people : null };
      prev = row;
      return row;
    });
  }
  /** Statutory contributions per month: EPF, SOCSO and EIS (employee and employer), PCB, zakat and HRD levy. */
  function statutoryByMonth(payroll, mks, pick = () => true) {
    return mks.filter((mk) => payroll[mk]).map((mk) => {
      const items = payroll[mk].items.filter(pick);
      const row = { month: mk, people: items.length, epfEe: sum(items, (i) => i.epf), epfEr: sum(items, (i) => i.erEpf), socsoEe: sum(items, (i) => i.socso), socsoEr: sum(items, (i) => i.erSocso), eisEe: sum(items, (i) => i.eis), eisEr: sum(items, (i) => i.erEis), pcb: sum(items, (i) => i.tax), zakat: sum(items, (i) => i.zakat), hrdf: sum(items, (i) => i.hrdf) };
      row.total = r2(row.epfEe + row.epfEr + row.socsoEe + row.socsoEr + row.eisEe + row.eisEr + row.pcb + row.zakat + row.hrdf);
      return row;
    });
  }

  // ---------- Grouping ----------
  /** Groups rows by key(row) and sums the numeric fields. Returns [{ key, count, ...sums }] in first-seen order. */
  function groupSum(rows, key, fields) {
    const out = new Map();
    rows.forEach((r) => {
      const k = key(r);
      const g = out.get(k) || { key: k, count: 0, ...Object.fromEntries(fields.map((f) => [f, 0])) };
      g.count++;
      fields.forEach((f) => { g[f] = r2(g[f] + (Number(r[f]) || 0)); });
      out.set(k, g);
    });
    return [...out.values()];
  }
  // Upcoming dates in a range for a yearly date (birthdays, anniversaries): the matching day in each year of the range.
  function yearly(date, from, to) {
    if (!date) return [];
    const out = [];
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      let d = `${y}${date.slice(4)}`;
      if (date.slice(5) === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) d = `${y}-02-28`;
      if (inRange(d, from, to)) out.push(d);
    }
    return out;
  }

  // ---------- Custom report engine ----------
  const OPS = {
    eq: { label: 'is', test: (v, x) => String(v ?? '').toLowerCase() === String(x ?? '').toLowerCase() },
    neq: { label: 'is not', test: (v, x) => String(v ?? '').toLowerCase() !== String(x ?? '').toLowerCase() },
    contains: { label: 'contains', test: (v, x) => String(v ?? '').toLowerCase().includes(String(x ?? '').toLowerCase()) },
    gt: { label: 'more than', test: (v, x) => cmp(v, x) > 0 },
    gte: { label: 'at least', test: (v, x) => cmp(v, x) >= 0 },
    lt: { label: 'less than', test: (v, x) => cmp(v, x) < 0 },
    lte: { label: 'at most', test: (v, x) => cmp(v, x) <= 0 },
    empty: { label: 'is empty', test: (v) => v == null || v === '' },
    notempty: { label: 'is not empty', test: (v) => !(v == null || v === '') },
  };
  function cmp(a, b) {
    const na = Number(a), nb = Number(b);
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a ?? '').localeCompare(String(b ?? ''));
  }
  const AGGS = {
    sum: (vs) => sum(vs, (v) => v),
    avg: (vs) => (vs.length ? r2(vs.reduce((s, v) => s + (Number(v) || 0), 0) / vs.length) : 0),
    min: (vs) => (vs.length ? Math.min(...vs.map(Number)) : 0),
    max: (vs) => (vs.length ? Math.max(...vs.map(Number)) : 0),
    count: (vs) => vs.length,
  };
  /**
   * Runs a report definition over rows. fields = { key: { label, type: 'text'|'number'|'money'|'date' } }.
   * def = { columns: [keys], filters: [{ field, op, value }], groupBy: key|'', agg: 'sum'|'avg'|..., sort: { field, dir } }.
   * Without grouping each row keeps the chosen columns; with grouping there is one row per group with a count and
   * the chosen aggregate of each numeric column. Returns { columns: [{ key, label, type }], rows, totals }.
   */
  function runQuery(rows, fields, def) {
    const cols = (def.columns || []).filter((k) => fields[k]);
    let list = rows.filter((r) => (def.filters || []).every((f) => !fields[f.field] || !OPS[f.op] || OPS[f.op].test(r[f.field], f.value)));
    let columns = cols.map((k) => ({ key: k, ...fields[k] }));
    const numeric = (k) => ['number', 'money'].includes(fields[k]?.type);
    if (def.groupBy && fields[def.groupBy]) {
      const agg = AGGS[def.agg] ? def.agg : 'sum', groups = new Map();
      list.forEach((r) => { const k = r[def.groupBy] ?? ''; (groups.get(k) || groups.set(k, []).get(k)).push(r); });
      const nums = cols.filter((k) => numeric(k) && k !== def.groupBy);
      list = [...groups.entries()].map(([k, rs]) => ({ [def.groupBy]: k, _count: rs.length, ...Object.fromEntries(nums.map((n) => [n, AGGS[agg](rs.map((r) => Number(r[n]) || 0))])) }));
      columns = [{ key: def.groupBy, ...fields[def.groupBy] }, { key: '_count', label: 'Count', type: 'number' }, ...nums.map((n) => ({ key: n, ...fields[n], label: `${fields[n].label} (${agg})` }))];
    } else list = list.map((r) => Object.fromEntries(cols.map((k) => [k, r[k]])));
    if (def.sort?.field && columns.some((c) => c.key === def.sort.field)) {
      const d = def.sort.dir === 'desc' ? -1 : 1;
      list = [...list].sort((a, b) => d * cmp(a[def.sort.field], b[def.sort.field]));
    }
    const totals = Object.fromEntries(columns.filter((c) => numeric(c.key) || c.key === '_count').map((c) => [c.key, sum(list, (r) => r[c.key])]));
    return { columns, rows: list, totals };
  }

  return { r2, sum, months, monthEnd, inRange, employedOn, headcount, joinersLeavers, turnover, turnoverByMonth, payFigures, payrollByMonth, statutoryByMonth, groupSum, yearly, OPS, AGGS, runQuery, monthOf };
})();
