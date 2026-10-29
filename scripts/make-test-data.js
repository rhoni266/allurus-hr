// Builds the employee-import test files in /test-data (fake people only). Run: node scripts/make-test-data.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const X = require('xlsx');

const OUT = path.join(__dirname, '..', 'test-data');
fs.mkdirSync(OUT, { recursive: true });
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['importFieldMap.js', 'import-rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'import', f), 'utf8'), sandbox);
const R = sandbox.window.AllurusImportRules;
const { PEOPLE, DEPTS } = require('../tests/import-fixtures.js');

const csv = (rows) => '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
const book = (sheets) => { const wb = X.utils.book_new(); for (const [name, ws] of sheets) X.utils.book_append_sheet(wb, ws, name); return wb; };
const write = (name, data) => { fs.writeFileSync(path.join(OUT, name), data); console.log('wrote', name); };

// 1. The app's own export.
write('01-roundtrip-export.csv', csv(R.exportRows(PEOPLE, (id) => DEPTS.find((d) => d.id === id)?.name || '')));

// 2. The template, filled in cleanly.
{
  const head = R.EXPORT.map(([k, h]) => (k === 'salaryAnnual' ? 'Monthly salary' : h));
  const rows = [head,
    ['T001', 'Nur Aisyah binti Abdul Rahman', 'aisyah.t@example.com', '012-345 6789', 'HR Executive', 'Human Resources', 'Active', 'Full-time', 'Kuantan', '01/03/2024', 'RM 4,200.00', '950312-06-5512', 'Female', '12/03/1995', '12345678', '950312065512', 'SG 1234567890', 'Maybank', '112233445566', 'Malaysian', 'No. 1, Jalan Contoh, 25000 Kuantan', 'Abdul Rahman bin Ali', '013-222 3344'],
    ['T002', 'Lim Wei Jie', 'weijie.t@example.com', '019-876 5432', 'Storekeeper', 'Operations', 'Active', 'Contract', 'Kemaman', '15/07/2025', '2800', '010505-11-1235', 'Male', '05/05/2001', '', '', '', 'CIMB Bank', '7001234567', 'Malaysian', '', 'Lim Ah Kow', '012-998 7766']];
  const ws = X.utils.aoa_to_sheet(rows);
  for (let r = 1; r < rows.length; r++) rows[0].forEach((_, c) => { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell) { cell.t = 's'; cell.z = '@'; } });
  write('02-template-clean.xlsx', X.write(book([['Employees', ws]]), { type: 'buffer', bookType: 'xlsx' }));
}

// 3. Messy: title rows, Malay headers in a random order, unknown and blank columns, blank rows, merged department
//    cells, real Excel dates and a salary formula, plus a second sheet of notes.
{
  const aoa = [['SENARAI PEKERJA SYARIKAT CONTOH SDN BHD'], ['Dikemaskini oleh: Unit Sumber Manusia'], [],
    ['Jabatan', 'Nama Penuh', 'Catatan', 'No. K/P', 'Emel', 'Jawatan', 'Tarikh Masuk', 'Gaji Pokok', 'No. Tel', ''],
    ['Operasi', 'MUHAMMAD HAFIZ BIN AHMAD', 'pemandu lori', '950312-03-5511', 'Hafiz@Contoh.MY', 'Pemandu', null, null, '012-345 6780'],
    ['', 'siti nur aina binti zakaria', '', '950722115678', 'aina@contoh.my', 'Kerani Stor', null, null, '0123456781'],
    [], ['Kewangan', 'Ravi a/l Muthu', 'baru', '880101-08-4433', 'ravi@contoh.my', 'Akauntan', null, null, '+60 19-222 3344']];
  const ws = X.utils.aoa_to_sheet(aoa);
  const date = (addr, y, m, d) => { ws[addr] = { t: 'n', v: (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5, z: 'dd/mm/yyyy' }; };
  date('G5', 2024, 6, 5); date('G6', 2025, 1, 15); date('G8', 2023, 11, 1);
  ws.H5 = { t: 'n', v: 2500, f: '2000+500' }; ws.H6 = { t: 's', v: 'RM 3,500.00' }; ws.H8 = { t: 'n', v: 5200.5 };
  ws['!merges'] = [{ s: { r: 4, c: 0 }, e: { r: 5, c: 0 } }, { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
  ws['!ref'] = 'A1:J8';
  write('03-messy-malay.xlsx', X.write(book([['Nota', X.utils.aoa_to_sheet([[]])], ['Pekerja', ws]]), { type: 'buffer', bookType: 'xlsx' }));
}

// 4. IC and phone quirks.
write('04-ic-phone.csv', csv([['Name', 'Email', 'IC', 'Phone', 'Job title', 'Start date'],
  ['Ahmad Dashes', 'ic1@contoh.my', '900101-14-5678', '012-345 6789', 'Clerk', '01/10/2026'],
  ['Ahmad Plain', 'ic2@contoh.my', '900202145679', '123456789', 'Clerk', '01/10/2026'],
  ['Ahmad Science', 'ic3@contoh.my', '9.00303E+11', '+60123456790', 'Clerk', '01/10/2026'],
  ['Ahmad Spaces', 'ic4@contoh.my', ' 900404 14 5680 ', '6012-3456791', 'Clerk', '01/10/2026']]));

// 5. Dates in every format.
{
  const ws = X.utils.aoa_to_sheet([['Name', 'Email', 'Job title', 'Start date', 'Date of birth'],
    ['Date One', 'd1@contoh.my', 'Clerk', '05/06/2026', '1990-12-31'], ['Date Two', 'd2@contoh.my', 'Clerk', '2026-12-31', '15-Jan-1992'],
    ['Date Three', 'd3@contoh.my', 'Clerk', '15-Jan-2026', '3 Ogos 1985'], ['Date Four', 'd4@contoh.my', 'Clerk', null, '31/12/1999']]);
  ws.D5 = { t: 'n', v: 46037 };                     // a serial number with no date format: still a date in a date column
  write('05-dates.xlsx', X.write(book([['Sheet1', ws]]), { type: 'buffer', bookType: 'xlsx' }));
}

// 6. Salaries.
write('06-salary.csv', csv([['Name', 'Email', 'Job title', 'Start date', 'Gaji'],
  ['Pay One', 'p1@contoh.my', 'Clerk', '01/10/2026', 'RM 3,500.00'], ['Pay Two', 'p2@contoh.my', 'Clerk', '01/10/2026', '3500'], ['Pay Three', 'p3@contoh.my', 'Clerk', '01/10/2026', '']]));

// 7. Duplicates inside the file and matches with existing people.
write('07-duplicates.csv', csv([['Name', 'Email', 'IC', 'Job title', 'Start date'],
  ['Aisyah binti Rahman', 'aisyah@contoh.my', '900101-14-5678', 'HR Director', '01/03/2022'],
  ['Dup Person', 'dup@contoh.my', '990101-10-1111', 'Clerk', '01/10/2026'],
  ['Dup Person', 'dup@contoh.my', '990101-10-1111', 'Clerk', '01/10/2026']]));

// 8. 3,000 rows.
{
  const aoa = [['Staff no', 'Name', 'Email', 'Job title', 'Department', 'Start date', 'Monthly salary']];
  for (let i = 0; i < 3000; i++) aoa.push([`B${String(i).padStart(4, '0')}`, `Pekerja Ujian ${i}`, `p${i}@contoh.my`, 'Operator', ['Operations', 'Finance', 'Logistik'][i % 3], '01/10/2026', 2500 + (i % 50)]);
  write('08-big-3000.xlsx', X.write(book([['Big', X.utils.aoa_to_sheet(aoa)]]), { type: 'buffer', bookType: 'xlsx' }));
}

// 10. Wrong file types (the oversized file is made in the test, not stored).
write('10-wrong-type.txt', 'This is not a spreadsheet.\n');
write('10-macro.xlsm', 'not really a macro workbook');
