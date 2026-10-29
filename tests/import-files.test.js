// End-to-end import of the files in /test-data (made by scripts/make-test-data.js): read with SheetJS the same way
// the browser does, auto-map, plan, apply. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const X = require('xlsx');
const { PEOPLE, DEPTS } = require('./import-fixtures.js');

const DATA = path.join(__dirname, '..', 'test-data');
if (!fs.existsSync(path.join(DATA, '08-big-3000.xlsx'))) require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'make-test-data.js')]);
const sandbox = { window: {}, TextDecoder, URL, console };
vm.createContext(sandbox);
for (const f of ['importFieldMap.js', 'import-rules.js', 'import.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'import', f), 'utf8'), sandbox);
const R = sandbox.window.AllurusImportRules, I = sandbox.window.AllurusImport;
const plain = (x) => JSON.parse(JSON.stringify(x));
const BANKS = ['Maybank', 'CIMB Bank', 'Public Bank'];
let n = 0; const uid = (p) => `${p}${++n}`;

function load(file, { sheet, existing = plain(PEOPLE), mode, keys } = {}) {
  const buf = fs.readFileSync(path.join(DATA, file));
  const chk = I.checkFile(file, buf.length); assert.ok(!chk.error, chk.error);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const book = I.parseBook(X, ab, chk.ext, I.sheetGrid);
  const name = sheet || book.names.find((x) => book.sheets[x].length);
  const grid = R.tidyGrid(book.sheets[name]), h = R.detectHeaderRow(grid);
  const headers = grid.rows[h].cells.map((c, i) => String(c || '').trim() || `Column ${i + 1}`);
  const mapping = R.autoMap(headers, headers.map((_, i) => grid.rows.slice(h + 1).map((r) => r.cells[i])), { today: '2026-10-29' });
  const plan = R.buildPlan({ grid, headerIndex: h, mapping, existing, departments: DEPTS, banks: BANKS, mode, keys });
  return { book, grid, h, headers, mapping: plain(mapping), plan, rows: plain(plan.rows), existing };
}
const by = (p, f) => p.mapping.find((m) => m.field === f);

test('1 round trip of the CSV export: 100% auto-mapped, nothing changes', () => {
  const p = load('01-roundtrip-export.csv');
  assert.ok(p.mapping.every((m) => m.field && m.confidence === 'high'));
  assert.deepEqual(plain(p.plan.counts), { add: 0, update: 0, same: 2, skip: 0, error: 0, warning: 0 });
});

test('2 clean template', () => {
  const p = load('02-template-clean.xlsx');
  assert.ok(p.mapping.every((m) => m.field), JSON.stringify(p.mapping.filter((m) => !m.field)));
  assert.deepEqual(plain(p.plan.counts).add, 2);
  assert.equal(p.rows[0].values.salary, 50400); assert.equal(p.rows[0].values.ic, '950312065512'); assert.equal(p.rows[1].values.gender, 'male');
  assert.equal(p.rows[0].errors.length + p.rows[1].errors.length, 0);
});

test('3 messy Malay sheet: picks the right sheet and header row, fills merged cells, reads dates and formulas', () => {
  const p = load('03-messy-malay.xlsx');
  assert.equal(p.headers[0], 'Jabatan');
  assert.deepEqual(['dept', 'name', 'ic', 'email', 'role', 'start', 'salaryMonthly', 'phone'].map((f) => !!by(p, f)), Array(8).fill(true));
  assert.equal(by(p, 'dept').col, 0); assert.equal(p.mapping[2].field, '', 'Catatan ignored');
  const [a, b, c] = p.rows;
  assert.equal(a.values.name, 'Muhammad Hafiz bin Ahmad'); assert.equal(a.values.start, '2024-06-05'); assert.equal(a.values.salary, 30000, 'formula result × 12');
  assert.equal(b.values.dept, 'Operasi', 'merged cell filled'); assert.equal(b.values.salary, 42000); assert.equal(b.values.phone, '+60123456781');
  assert.equal(c.values.name, 'Ravi a/l Muthu'); assert.equal(c.values.phone, '+60192223344'); assert.equal(c.values.start, '2023-11-01');
  assert.equal(p.rows.length, 3);
});

test('4 IC with and without dashes, scientific notation, phones missing their 0', () => {
  const r = load('04-ic-phone.csv').rows;
  assert.equal(r[0].values.ic, '900101145678'); assert.equal(r[1].values.ic, '900202145679'); assert.equal(r[3].values.ic, '900404145680');
  assert.equal(r[2].status, 'error'); assert.match(r[2].errors.join(), /Format the IC column as Text/);
  assert.deepEqual(r.map((x) => x.values.phone), ['+60123456789', '+60123456789', '+60123456790', '+60123456791']);
});

test('5 dates: DD/MM/YYYY, ISO, 15-Jan-2026, Malay months and Excel serials', () => {
  const r = load('05-dates.xlsx').rows;
  assert.deepEqual(r.map((x) => x.values.start), ['2026-06-05', '2026-12-31', '2026-01-15', '2026-01-15']);
  assert.deepEqual(r.map((x) => x.values.birthday), ['1990-12-31', '1992-01-15', '1985-08-03', '1999-12-31']);
});

test('6 salary: RM 3,500.00, 3500 and blank', () => {
  const r = load('06-salary.csv').rows;
  assert.deepEqual(r.map((x) => x.values.salary ?? null), [42000, 42000, null]);
  assert.match(r[2].warnings.join(), /No salary/);
});

test('7 duplicates inside the file and against existing employees', () => {
  const r = load('07-duplicates.csv').rows;
  assert.equal(r[0].action, 'update'); assert.equal(r[0].matchBy, 'ic');
  assert.equal(r[1].action, 'add'); assert.equal(r[2].action, 'error'); assert.match(r[2].errors.join(), /Same IC as row 3/);
  assert.equal(load('07-duplicates.csv', { mode: 'add' }).rows[0].action, 'skip');
});

test('8 3,000 rows: plan, apply in chunks of 400, undo', () => {
  const t0 = Date.now();
  const p = load('08-big-3000.xlsx');
  assert.equal(p.plan.counts.add, 3000);
  assert.deepEqual(plain(p.plan.newDepts), ['Logistik']);
  const ws = { employees: plain(PEOPLE), departments: plain(DEPTS) }, before = JSON.stringify(ws);
  const logs = [];
  for (let i = 0; i < p.plan.rows.length; i += 400) logs.push(R.applyPlan(ws, { ...p.plan, newDepts: i ? [] : p.plan.newDepts }, { batchId: 'big', by: 'admin@contoh.my', now: '2026-10-29T00:00:00Z', uid, rows: p.plan.rows.slice(i, i + 400) }));
  assert.equal(logs.length, 8);
  assert.equal(ws.employees.length, 3002);
  const all = { id: 'big', created: logs.flatMap((l) => l.created), updated: logs.flatMap((l) => l.updated), depts: logs.flatMap((l) => l.depts) };
  R.undoImport(ws, all);
  assert.equal(JSON.stringify(ws), before);
  assert.ok(Date.now() - t0 < 8000, `${Date.now() - t0} ms`);
});

test('9 non-admins can’t import: People area required in the app, and in Firestore rules', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.match(rules, /b in \['departments', 'directory', 'importData'\] \? 'people'/, 'importData writes need the People area');
  assert.match(rules, /b in \['savedReports', 'importData'\] \? 'a'/, 'importData is read by admins only');
  assert.match(rules, /match \/people\/\{e\} \{[\s\S]*?allow create, delete: if seesPeople\(t\)( && working\(t\))?;/, 'creating employees needs People access');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'js', 'import', 'import.js'), 'utf8');
  assert.match(ui, /const allowed = \(\) => !!window\.AllurusAccess\?\.can\('people'\)/);
});

test('10 wrong file type, macros and oversized files are refused before reading', () => {
  assert.match(I.checkFile('10-wrong-type.txt', 30).error, /isn’t supported/);
  assert.match(I.checkFile('10-macro.xlsm', 30).error, /macros/);
  assert.match(I.checkFile('big.xlsx', 6 * 1024 * 1024).error, /over 5 MB/);
  assert.match(I.checkFile('noext', 10).error, /isn’t supported/);
  assert.equal(I.checkFile('ok.CSV', 10).ext, 'csv');
});
