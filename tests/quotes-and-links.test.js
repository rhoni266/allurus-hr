// Incident 2026-11-11 follow-up: quote marks around imported cells, the repair script's helpers, and the rule that a
// sign-in is only ever linked to an employee record that exists. Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../scripts/repair-links-lib');

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['importFieldMap.js', 'import-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'import', f), 'utf8'), sandbox);
const R = sandbox.window.AllurusImportRules;
const mapCtx = { window: {}, globalThis: null };
vm.createContext(mapCtx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-map.js'), 'utf8'), mapCtx);
const M = mapCtx.window.AllurusCloudMap || mapCtx.AllurusCloudMap;
const plain = (x) => JSON.parse(JSON.stringify(x));
let n = 0; const uid = (p) => `${p}${++n}`;
const BANKS = ['Maybank'];

test('import: quote marks wrapping a whole cell are not part of the value (straight, curly, doubled)', () => {
  assert.equal(R.unwrapQuotes('"Ali bin Abu"'), 'Ali bin Abu');
  assert.equal(R.unwrapQuotes('“Ali bin Abu”'), 'Ali bin Abu');
  assert.equal(R.unwrapQuotes('""Ali""'), 'Ali');
  assert.equal(R.unwrapQuotes('"ROHADI "'), 'ROHADI', 'space inside the quotes goes too');
  assert.equal(R.unwrapQuotes("'S001'"), 'S001');
  assert.equal(R.unwrapQuotes('Nur "Ain" Binti Ali'), 'Nur "Ain" Binti Ali', 'a quote inside a name stays');
  assert.equal(R.unwrapQuotes("D'Souza"), "D'Souza", 'an apostrophe stays');
  assert.equal(R.unwrapQuotes('"'), '"', 'one lone quote is left alone');
  assert.equal(R.unwrapQuotes(42), 42);
});

test('import: a sheet whose cells all carry quotes imports clean names, ids, IC, phone and department', () => {
  const rows = [['No. Pekerja', 'Jabatan', 'Nama Penuh', 'Emel', 'No. Tel', 'Jawatan', 'Tarikh Mula', 'Gaji Pokok', 'No. K/P'],
    ['"S001"', '"Operasi"', '"MUHAMMAD HAFIZ BIN AHMAD"', '"hafiz@contoh.my"', '"012-345 6780"', '"Pemandu"', '05/06/2024', '2500', '"950312-03-5511"'],
    ['“S002”', '“Operasi”', '“Siti Nur Aina Binti Zakaria”', '“aina@contoh.my”', '“0123456781”', '“Kerani”', '15-Jan-2025', '3500', '“950722115678”']];
  const grid = R.tidyGrid(rows);
  assert.ok(grid.rows.every((r) => r.cells.every((c) => typeof c !== 'string' || !/["“”]/.test(c))), 'no cell keeps its wrapping quotes');
  const h = R.detectHeaderRow(grid), headers = grid.rows[h].cells.map(String);
  const columns = headers.map((_, i) => grid.rows.slice(h + 1).map((r) => r.cells[i]));
  const mapping = R.autoMap(headers, columns, { today: '2026-10-29' });
  const p = R.buildPlan({ grid, headerIndex: h, mapping, existing: [], departments: [], banks: BANKS, today: '2026-10-29' });
  const [a, b] = plain(p.rows);
  assert.equal(a.values.name, 'Muhammad Hafiz bin Ahmad');
  assert.equal(a.values.staffNo, 'S001');
  assert.equal(a.values.ic, '950312035511');
  assert.equal(a.values.phone, '+60123456780');
  assert.equal(a.values.email, 'hafiz@contoh.my');
  assert.equal(b.values.ic, '950722115678');
  assert.deepEqual(plain(p.newDepts), ['Operasi'], 'one department, with no quote marks, not two');
  const added = R.applyPlan({ employees: [], departments: [] }, { ...p, newDepts: p.newDepts }, { batchId: 'b1', by: 'test', now: '2026-10-29T00:00:00Z', fileName: 'q.csv', uid });
  assert.ok(added, 'the plan applies');
});

test('repair helpers: only quote marks that remain after decoding the stored JSON are removed', () => {
  // The database stores the text Ali as "Ali" (with quotes). That is normal and must not be touched.
  assert.deepEqual(L.cleanPersonFields({ first: JSON.stringify('Ali'), id: JSON.stringify('e1') }).fields, []);
  const c = L.cleanPersonFields({ first: JSON.stringify('"ROHADI "'), last: JSON.stringify('IBRAHIM'), salary: '1200', odd: 'not json{' });
  assert.deepEqual(c.fields, ['first']);
  assert.equal(c.changes.first, JSON.stringify('ROHADI'));
  assert.equal(L.decode(c.changes.first).value, 'ROHADI', 'stays valid stored text');
});

test('repair helpers: a sign-in is linked by its IC to the one record that has it, never by guesswork', () => {
  const people = [{ id: 'e1', ic: '900101015555' }, { id: 'eyl0aj2s', ic: '950312-03-5511' }, { id: 'e3', ic: '880808085555' }, { id: 'e4', ic: '880808085555' }];
  const ic = (d) => `${d}.v7hua.g1@staff.allurus.invalid`;
  const users = [
    { uid: 'u1', email: ic('950312035511'), empId: '' },            // no link → fix
    { uid: 'u2', email: ic('900101015555'), empId: 'e1' },          // fine
    { uid: 'u3', email: ic('777777777777'), empId: '' },            // nobody has this IC
    { uid: 'u4', email: ic('880808085555'), empId: 'gone' },        // two records have this IC → not guessed
    { uid: 'u5', email: 'nadia@x.my', empId: 'e1' },                // email sign-in, fine
    { uid: 'u6', email: 'bob@x.my', empId: '' },                    // email sign-in, nothing to go on
  ];
  const r = L.planLinks(people, users);
  assert.deepEqual(r.fix.map((x) => [x.uid, x.empId]), [['u1', 'eyl0aj2s']]);
  assert.deepEqual(r.linked.map((x) => x.uid), ['u2', 'u5']);
  assert.deepEqual(r.none.map((x) => x.uid), ['u3']);
  assert.deepEqual(r.many.map((x) => x.uid), ['u4']);
  assert.deepEqual(r.skipped.map((x) => x.uid), ['u6']);
});

test('link guard: refuses an employee id that does not exist, is empty or has quote marks', () => {
  const emps = [{ id: 'e1' }, { id: 'eyl0aj2s' }];
  assert.equal(M.linkProblem('eyl0aj2s', emps), '');
  assert.match(M.linkProblem('nope', emps), /does not exist/);
  assert.match(M.linkProblem('', emps), /No employee record/);
  assert.match(M.linkProblem(undefined, emps), /No employee record/);
  assert.match(M.linkProblem('"eyl0aj2s"', emps), /quote marks/);
  assert.match(M.linkProblem('e1', []), /does not exist/);
});

test('wiring: approving a registration runs the guard first; the app never shows employees[0] for a real sign-in', () => {
  const cloud = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
  const i = cloud.indexOf('async approveOpen(u, emp) {');
  const w = cloud.indexOf('writeBatch(db)', i);
  assert.ok(i > 0 && w > i && cloud.slice(i, w).includes('M.approvalProblem('), 'the check runs before any write');
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  assert.match(app, /const me = \(\) => emp\(state\.session\.empId\) \|\| \(cloud\.db \?/);
});

// ---- Approving a join-page registration (incident 2026-11-11): HR picks the person; checks the IC; one sign-in per record ----
const ic = (d) => `${d}.v7hua.g1@staff.allurus.invalid`;
const staffList = [
  { id: 'e1', ic: '', email: 'nadia@x.my', first: 'Nur Nadia', last: 'Amirah' },                  // HR admin: has an email, no IC on the record
  { id: 'eyl0aj2s', ic: '950312-03-5511', first: 'Alif', last: 'Fitri' },
  { id: 'e3', ic: '880808085555', first: 'Siti', last: 'Aina' },
  { id: 'e4', ic: '770707075555', first: 'Hafiz', last: 'Ali' },
];
const signIns = [
  { uid: 'nadia', email: 'nadia@x.my', empId: 'e1' },
  { uid: 'alif', email: ic('950312035511'), empId: '' },
  { uid: 'siti', email: ic('880808085555'), empId: 'e3' },
];
const check = (o) => M.approvalProblem({ signInIc: '950312035511', employees: staffList, users: signIns, uid: 'alif', ...o });

test('approval: nothing is chosen for HR; no pick is refused', () => {
  assert.match(check({ emp: null }), /Choose which person/);
  assert.match(check({ emp: undefined }), /Choose which person/);
  assert.match(check({ emp: {} }), /Choose which person/);
});

test('approval: the incident: Alif’s registration cannot be approved as Nadia’s record (IC does not match, record already has a sign-in)', () => {
  const why = check({ emp: staffList[0] });
  assert.ok(why, 'refused');
  assert.match(why, /no valid IC|not the IC|already has a sign-in/);
});

test('approval: the IC on the record must match the IC registered with; both endings are named', () => {
  const why = check({ emp: staffList[3] });
  assert.match(why, /ends 5555\) is not the IC this person registered with \(ends 5511\)/);
  assert.match(check({ emp: { id: 'e5', ic: '' } }), /does not exist|no valid IC/);
});

test('approval: a record that already has another sign-in is refused, even when the IC matches', () => {
  const dup = [...signIns, { uid: 'other', email: ic('950312035511').replace('.g1', '.g2'), empId: 'eyl0aj2s' }];
  assert.match(check({ emp: staffList[1], users: dup }), /already has a sign-in \(an IC sign-in\)/);
  assert.match(M.approvalProblem({ signInIc: '880808085555', emp: staffList[2], employees: staffList, users: [{ uid: 'x', email: 'siti@x.my', empId: 'e3' }], uid: 'new' }), /an email sign-in/);
  // a turned-off sign-in does not block, and the same sign-in is not "another" one
  assert.equal(check({ emp: staffList[1], users: [...signIns, { uid: 'old', email: ic('950312035511'), empId: 'eyl0aj2s', disabled: true }] }), '');
  assert.equal(check({ emp: staffList[1], users: [...signIns.filter((x) => x.uid !== 'alif'), { uid: 'alif', email: ic('950312035511'), empId: 'eyl0aj2s' }] }), '');
});

test('approval: the right person with a matching IC and no other sign-in is approved', () => {
  assert.equal(check({ emp: staffList[1] }), '');
});

test('approval wiring: no automatic pick; the picker starts empty; the server-side check runs before any write', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const i = app.indexOf('async approve(uid, empId) {'); assert.ok(i > 0, 'approve takes the person HR chose');
  const body = app.slice(i, i + 900);
  assert.ok(!/this\.claimed\(u\)/.test(body) && /emp\(empId\)/.test(body) && /approvalProblem/.test(body));
  assert.match(app, /<option value="" selected disabled>Choose the person…<\/option>/);
  assert.ok(!/data-act="acc-open-ok" data-id="\$\{esc\(u\.uid\)\}">Approve/.test(app), 'the waiting-list Approve button starts disabled and carries no person');
  const cloud = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
  const j = cloud.indexOf('async approveOpen(u, emp) {'), k = cloud.indexOf('writeBatch(db)', j);
  assert.ok(j > 0 && cloud.slice(j, k).includes('M.approvalProblem('));
});
