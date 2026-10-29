// Unit tests for the employee import: header row detection, column auto-mapping, cleaning, row checks, matching,
// apply and undo. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['importFieldMap.js', 'import-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'import', f), 'utf8'), sandbox);
const R = sandbox.window.AllurusImportRules;
const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Bank Islam'];
const plain = (x) => JSON.parse(JSON.stringify(x));
const fieldsOf = (m) => plain(m).map((x) => x.field);
let n = 0; const uid = (p) => `${p}${++n}`;

const depts = () => [{ id: 'd-ops', name: 'Operations' }, { id: 'd-fin', name: 'Finance' }];
const people = () => [
  { id: 'e1', first: 'Aisyah', last: 'binti Rahman', email: 'aisyah@contoh.my', phone: '+60123456789', role: 'HR Manager', dept: 'd-ops', status: 'Active', type: 'Full-time', location: 'Kuantan', start: '2022-03-01', salary: 72000, ic: '900101145678', idType: 'mykad', gender: 'female', birthday: '1990-01-01' },
  { id: 'e2', first: 'Tan Wei', last: 'Ming', email: 'weiming@contoh.my', phone: '+60198765432', role: 'Accountant', dept: 'd-fin', status: 'Active', type: 'Contract', location: 'Kuantan', start: '2023-07-15', salary: 54000, ic: '880515105431', idType: 'mykad', gender: 'male', birthday: '1988-05-15' },
];
const plan = (rows, opts = {}) => {
  const grid = R.tidyGrid(rows), h = R.detectHeaderRow(grid), headers = grid.rows[h].cells.map(String);
  const columns = headers.map((_, i) => grid.rows.slice(h + 1).map((r) => r.cells[i]));
  const mapping = R.autoMap(headers, columns, { today: '2026-10-29' });
  return { grid, h, headers, mapping, plan: R.buildPlan({ grid, headerIndex: h, mapping, existing: opts.existing || people(), departments: depts(), banks: BANKS, mode: opts.mode, keys: opts.keys }) };
};

test('round trip: the app’s own export maps 100% and changes nothing in update mode', () => {
  const ex = R.exportRows(people(), (id) => depts().find((d) => d.id === id)?.name || '');
  const p = plan(ex);
  assert.equal(p.h, 0);
  assert.ok(p.mapping.every((m) => m.field && m.confidence === 'high'), JSON.stringify(plain(p.mapping).filter((m) => m.confidence !== 'high')));
  assert.deepEqual(plain(p.plan.counts), { add: 0, update: 0, same: 2, skip: 0, error: 0, warning: 0 });
});

test('messy sheet: title rows, Malay headers, random order, unknown and blank columns', () => {
  const rows = [['SENARAI PEKERJA SYARIKAT CONTOH SDN BHD'], ['Dikemaskini: 1/10/2026'], [],
    ['No. Pekerja', 'Jabatan', 'Nama Penuh', 'Emel', 'No. Tel', 'Jawatan', 'Tarikh Mula', 'Gaji Pokok', 'No. K/P', 'Catatan', '', ''],
    ['S001', 'Operasi', 'MUHAMMAD HAFIZ BIN AHMAD', 'Hafiz@Contoh.MY', '012-345 6780', 'Pemandu', '05/06/2024', 'RM 2,500.00', '950312-03-5511', 'baik', '', ''],
    [], ['S002', 'Kewangan', 'siti nur aina binti zakaria', 'aina@contoh.my', 123456781, 'Kerani', '15-Jan-2025', '3500', 950722115678, '', '', '']];
  const p = plan(rows);
  assert.equal(p.headers[0], 'No. Pekerja');
  assert.deepEqual(fieldsOf(p.mapping).slice(0, 10), ['staffNo', 'dept', 'name', 'email', 'phone', 'role', 'start', 'salaryMonthly', 'ic', '']);
  const [a, b] = plain(p.plan.rows);
  assert.equal(a.values.name, 'Muhammad Hafiz bin Ahmad');
  assert.equal(a.values.email, 'hafiz@contoh.my');
  assert.equal(a.values.phone, '+60123456780');
  assert.equal(a.values.start, '2024-06-05', 'day first');
  assert.equal(a.values.salary, 30000, 'monthly × 12');
  assert.equal(a.values.birthday, '1995-03-12'); assert.equal(a.values.gender, 'male');
  assert.equal(b.values.phone, '+60123456781', 'leading 0 put back');
  assert.equal(b.values.ic, '950722115678'); assert.equal(b.values.gender, 'female');
  assert.equal(b.values.start, '2025-01-15');
  assert.deepEqual(plain(p.plan.newDepts), ['Operasi', 'Kewangan']);
  assert.equal(a.action, 'add');
});

test('IC: dashes or not, numbers, scientific notation, passport only with a passport column', () => {
  assert.equal(R.cleanValue('ic', '900101-14-5678').value, '900101145678');
  assert.equal(R.cleanValue('ic', '900101 14 5678').value, '900101145678');
  assert.equal(R.cleanValue('ic', 10203145678).value, '010203145678');
  assert.match(R.cleanValue('ic', '9.00101E+11').error, /Text/);
  assert.ok(R.cleanValue('ic', 'A1234567').error);
  assert.equal(R.cleanValue('ic', 'A1234567', { passportOk: true }).idType, 'passport');
  assert.ok(R.cleanValue('ic', '901301145678').error, 'month 13');
  const i = R.icInfo('020304105432'); assert.equal(i.birthday, '2002-03-04'); assert.equal(i.gender, 'female');
});

test('dates: DD/MM/YYYY, ISO, 15-Jan-2026, Malay months, Excel serials, month-first only when clear', () => {
  assert.equal(R.parseDate('05/06/2026'), '2026-06-05');
  assert.equal(R.parseDate('2026-12-31'), '2026-12-31');
  assert.equal(R.parseDate('15-Jan-2026'), '2026-01-15');
  assert.equal(R.parseDate('3 Ogos 2025'), '2025-08-03');
  assert.equal(R.parseDate('January 15, 2026'), '2026-01-15');
  assert.equal(R.parseDate(46037, { serials: true }), '2026-01-15');
  assert.equal(R.parseDate(46036), null, 'a bare number is not a date unless the column is a date');
  assert.equal(R.dateOrder(['05/06/2026', '12/31/2026']), 'mdy');
  assert.equal(R.dateOrder(['05/06/2026', '31/12/2026']), 'dmy');
  assert.equal(R.parseDate('31/02/2026'), null);
});

test('salary: RM 3,500.00, 3500 and blanks; negatives rejected; annual column kept as is', () => {
  assert.equal(R.cleanValue('salaryMonthly', 'RM 3,500.00').value, 42000);
  assert.equal(R.cleanValue('salaryMonthly', 3500).value, 42000);
  assert.equal(R.cleanValue('salaryMonthly', '').value, null);
  assert.ok(R.cleanValue('salaryMonthly', '-200').error);
  assert.equal(R.cleanValue('salaryAnnual', '54,000').value, 54000);
  assert.ok(R.cleanValue('salaryMonthly', '250').warn, 'unusual');
});

test('duplicates in the file and against existing employees; add-only skips matches', () => {
  const rows = [['Name', 'Email', 'IC', 'Job title', 'Start date'],
    ['AISYAH BINTI RAHMAN', 'aisyah@contoh.my', '900101-14-5678', 'HR Director', '01/03/2022'],
    ['New Person', 'new@contoh.my', '990101-10-1111', 'Clerk', '01/10/2026'],
    ['New Person Again', 'new2@contoh.my', '990101101111', 'Clerk', '01/10/2026'],
    ['Clash', 'weiming@contoh.my', '970101-10-2222', 'Clerk', '01/10/2026']];
  const up = plain(plan(rows).plan.rows);
  assert.equal(up[0].action, 'update'); assert.equal(up[0].matchBy, 'ic'); assert.deepEqual(Object.keys(up[0].changes), ['role']);
  assert.equal(up[1].action, 'add');
  assert.equal(up[2].action, 'error'); assert.match(up[2].errors.join(), /Same IC as row 3/);
  assert.match(up[3].errors.join(), /Matched Tan Wei Ming by email, but the IC is different/);
  assert.equal(plain(plan(rows, { keys: ['ic'] }).plan.rows)[3].errors.join(), 'Email already belongs to Tan Wei Ming');
  assert.equal(plain(plan(rows, { mode: 'add' }).plan.rows)[0].action, 'skip');
});

test('missing required fields and bad email are errors; unknown status is a warning', () => {
  const p = plain(plan([['Name', 'Email', 'Job title', 'Start date', 'Status'], ['A Person', 'not-an-email', 'Clerk', '1/1/2026', 'maybe'], ['B Person', 'b@contoh.my', '', '1/1/2026', 'aktif']]).plan.rows);
  assert.match(p[0].errors.join(), /valid email/);
  assert.match(p[1].errors.join(), /Missing Job title/);
  const w = plain(R.cleanValue('status', 'maybe')); assert.equal(w.value, 'Active'); assert.ok(w.warn);
  assert.equal(R.cleanValue('status', 'Tidak Aktif').value, 'Inactive');
});

test('names: title case keeps bin/binti/a/l, and split at them', () => {
  assert.equal(R.titleName('NUR AISYAH BINTI ABDUL RAHMAN'), 'Nur Aisyah binti Abdul Rahman');
  assert.equal(R.titleName('ravi a/l muthu'), 'Ravi a/l Muthu');
  assert.deepEqual(plain(R.splitName('Ravi a/l Muthu')), { first: 'Ravi', last: 'a/l Muthu' });
  assert.deepEqual(plain(R.splitName('Lim Mei Ling')), { first: 'Lim Mei', last: 'Ling' });
  assert.equal(R.titleName('李小龙'), '李小龙');
});

test('header detection and content guesses without useful headers', () => {
  const rows = [['Col A', 'Col B', 'Col C'], ['Ahmad Faiz bin Omar', 'faiz@contoh.my', '920101-01-5555'], ['Lee Chong Wei', 'lee@contoh.my', '850303-07-1234'], ['Mei Ling Tan', 'ml@contoh.my', '910909-10-2468']];
  const p = plan(rows);
  assert.deepEqual(fieldsOf(p.mapping), ['name', 'email', 'ic']);
  assert.ok(p.mapping.every((m) => m.confidence === 'medium'));
});

test('never two columns on one field: the weaker one is flagged', () => {
  const m = plain(R.autoMap(['Email', 'E-mail'], [['a@b.my'], ['c@d.my']]));
  assert.equal(m.filter((x) => x.field === 'email').length, 1);
  assert.ok(m.find((x) => !x.field).flag);
});

test('formula injection: stripped on import, quoted on export', () => {
  const c = R.cleanValue('role', '=HYPERLINK("x")'); assert.equal(c.value, 'HYPERLINK("x")'); assert.ok(c.warn);
  assert.equal(R.cleanValue('phone', '+60123456789').value, '+60123456789');
  assert.equal(R.safeCell('=1+1'), "'=1+1"); assert.equal(R.safeCell('+60123456789'), '+60123456789'); assert.equal(R.safeCell('-12.5'), '-12.5');
});

test('apply then undo puts everything back, and 3,000 rows plan quickly', () => {
  const ws = { employees: people(), departments: depts() };
  const before = JSON.stringify(ws);
  const rows = [['Name', 'Email', 'IC', 'Job title', 'Department', 'Start date', 'Gaji'], ['Aisyah binti Rahman', 'aisyah@contoh.my', '900101145678', 'HR Director', 'Operations', '1/3/2022', '6000'],
    ['Baru Satu', 'baru@contoh.my', '000101101234', 'Clerk', 'Logistik', '1/10/2026', '2000']];
  const p = plan(rows, { existing: ws.employees });
  const log = R.applyPlan(ws, p.plan, { batchId: 'imp1', by: 'admin@contoh.my', now: '2026-10-29T00:00:00Z', uid });
  assert.equal(log.counts.added, 1); assert.equal(log.counts.updated, 1);
  assert.equal(ws.employees.find((e) => e.id === 'e1').role, 'HR Director');
  assert.equal(ws.employees.find((e) => e.id === 'e1').salary, 72000, 'unchanged salary kept');
  const nu = ws.employees.find((e) => e.email === 'baru@contoh.my');
  assert.equal(nu.importBatchId, 'imp1'); assert.equal(nu.createdBy, 'admin@contoh.my'); assert.equal(ws.departments.find((d) => d.id === nu.dept).name, 'Logistik');
  R.undoImport(ws, plain(log));
  assert.equal(JSON.stringify(ws), before);

  const big = [['Name', 'Email', 'Job title', 'Start date', 'Salary']];
  for (let i = 0; i < 3000; i++) big.push([`Pekerja Ujian ${i}`, `p${i}@contoh.my`, 'Operator', '01/10/2026', 2500 + (i % 50)]);
  const t0 = Date.now(); const bp = plan(big);
  assert.equal(bp.plan.counts.add, 3000);
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
});

test('a saved mapping is reapplied for the same headers', () => {
  const headers = ['Kod', 'Siapa'];
  const saved = { signature: R.signature(headers), map: { kod: 'staffNo', siapa: 'name' } };
  assert.deepEqual(fieldsOf(R.autoMap(headers, [[], []], { saved })), ['staffNo', 'name']);
});
