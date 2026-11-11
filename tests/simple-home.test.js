// Simple staff phone screen: the four meters, the payslip file name and password rule, and the encrypted payslip PDF.
// Fake people only. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../js/simple-home-rules.js');
const PDFDocument = require('pdfkit');
const P = require('../js/payslip-pdf.js');

// ---- which screen ----
test('simple screen: needs the add-on, a switch that is not off, no admin role, and a phone', () => {
  const on = { addon: true, setting: undefined, roles: ['employee'], phone: true };
  assert.equal(H.useSimple(on), true);
  assert.equal(H.useSimple({ ...on, setting: true }), true);
  assert.equal(H.useSimple({ ...on, setting: false }), false, 'switched off in Settings');
  assert.equal(H.useSimple({ ...on, addon: false }), false, 'a company without the add-on keeps the normal Home');
  assert.equal(H.useSimple({ ...on, addon: undefined }), false);
  assert.equal(H.useSimple({ ...on, roles: ['admin', 'employee'] }), false, 'admin roles keep their own phone screens');
  assert.equal(H.useSimple({ ...on, phone: false }), false, 'computers keep the normal app');
  assert.equal(H.pdfPasswordOn({ addon: true, setting: undefined }), true);
  assert.equal(H.pdfPasswordOn({ addon: true, setting: false }), false);
  assert.equal(H.pdfPasswordOn({ addon: false, setting: undefined }), false);
});

// ---- the four meters (the day figures are what js/roster.js dayInfo returns from js/attendance-rules.js) ----
const shift = { id: 'day', start: '08:00', end: '17:00', breakMin: 60, grace: 10 };
// worked = minutes between in and out minus the break; early = minutes before the shift end; late = minutes after start once past the grace
const day = (d, { rin, rout, late = 0, lateRaw = late, early = 0, worked, s = 'present', type = 'normal', leave = false } = {}) => ({
  day: d, type, leave, pattern: shift, rec: rin || s === 'leave' ? { s, in: rin || '', out: rout || '' } : null,
  ev: { late, lateRaw, early, short: 0, worked: worked != null ? worked : rin && rout ? 480 - early - lateRaw : 0 },
});
const TODAY = '2026-11-12';

test('meters: on time (within the grace), late (minutes), absent, short hours, with leave and holidays left out', () => {
  const days = [
    day('2026-11-02', { rin: '07:55', rout: '17:02' }),                                   // on time
    day('2026-11-03', { rin: '08:05', rout: '17:00', lateRaw: 5, late: 0 }),              // inside the 10 min grace: on time
    day('2026-11-04', { rin: '08:23', rout: '17:00', late: 23 }),                         // late 23 min
    day('2026-11-05', { s: 'leave', leave: true }),                                       // approved leave: out of all four
    day('2026-11-06', { type: 'holiday' }),                                               // public holiday: out
    day('2026-11-07', { type: 'rest' }),                                                  // rest day: out
    day('2026-11-09', {}),                                                                // no check-in, no leave: absent
    day('2026-11-10', { rin: '08:00', rout: '15:50', early: 70 }),                        // left 1h10m early: short
    day('2026-11-11', { rin: '07:50', rout: '17:10' }),                                   // on time
  ];
  const m = H.meters(days, { today: TODAY });
  assert.deepEqual(m.onTime, { days: 4 });
  assert.deepEqual(m.late, { days: 1, min: 23 });
  assert.deepEqual(m.absent, { days: 1 });
  assert.deepEqual(m.short, { days: 1, min: 70 });
  assert.equal(m.counted, 6, 'counted days: 5 attended + 1 absent (leave, holiday and rest day are not counted)');
  assert.equal(H.fmtMin(70), '1h 10m'); assert.equal(H.fmtMin(23), '23 min'); assert.equal(H.fmtMin(120), '2h');
  assert.equal(H.pct(4, 6), 67);
  const status = Object.fromEntries(m.list.map((x) => [x.day, x.status]));
  assert.equal(status['2026-11-05'], 'leave'); assert.equal(status['2026-11-06'], 'holiday'); assert.equal(status['2026-11-09'], 'absent'); assert.equal(status['2026-11-04'], 'late');
  assert.equal(m.list[0].day, '2026-11-11', 'newest day first');
});

test('meters: lateness already shown as late is not counted again as short; a day with no check-out is not short', () => {
  const m = H.meters([
    day('2026-11-02', { rin: '08:30', rout: '17:00', late: 30 }),                           // late 30, stayed to the end: late, not short
    day('2026-11-03', { rin: '08:00', rout: '' }),                                          // no check-out yet / forgot: not short
    day('2026-11-04', { rin: '08:00', rout: '17:00', worked: 450 }),                        // long break: worked 30 min under the shift
  ], { today: TODAY });
  assert.deepEqual(m.late, { days: 1, min: 30 });
  assert.deepEqual(m.short, { days: 1, min: 30 });
});

test('meters: today is never absent, counts late once checked in, and short hours only after check-out', () => {
  assert.deepEqual(H.meters([day(TODAY, {})], { today: TODAY }).absent, { days: 0 }, 'not checked in yet today');
  const lateNow = H.meters([day(TODAY, { rin: '08:40', late: 40 })], { today: TODAY });
  assert.deepEqual(lateNow.late, { days: 1, min: 40 }); assert.equal(lateNow.short.days, 0, 'still at work: no check-out, no short hours');
  const done = H.meters([day(TODAY, { rin: '08:00', rout: '16:00', early: 60 })], { today: TODAY });
  assert.deepEqual(done.short, { days: 1, min: 60 });
  assert.equal(H.meters([day('2026-11-13', { rin: '08:00' })], { today: TODAY }).counted, 0, 'future days are ignored');
});

test('meters: month boundaries and an empty month', () => {
  assert.deepEqual(H.meters([], { today: TODAY }).onTime, { days: 0 });
  const last = H.meters([day('2026-10-30', { rin: '08:00', rout: '17:00' }), day('2026-10-31', { type: 'rest' })], { today: TODAY });
  assert.equal(last.onTime.days, 1); assert.equal(last.counted, 1);
  assert.equal(H.pct(0, 0), 0);
});

// ---- file name and password ----
test('payslip file name has the month and the first name only, never the IC or the company', () => {
  assert.equal(H.payslipFileName('Muhammad Alif', '2026-10'), 'Payslip-2026-10-Muhammad.pdf');
  assert.equal(H.payslipFileName('NUR NADIA', '2026-10-31'), 'Payslip-2026-10-Nur.pdf');
  assert.equal(H.payslipFileName('Siti-Aina', '2026-09'), 'Payslip-2026-09-Sitiaina.pdf');
  assert.equal(H.payslipFileName('', '2026-10'), 'Payslip-2026-10-Staff.pdf');
  assert.ok(!/\d{12}/.test(H.payslipFileName('Ali 950312035511', '2026-10')));
});

test('PDF password: IC without dashes; passport in upper case; no IC → refused (null)', () => {
  assert.equal(H.pdfPassword({ ic: '950312-03-5511' }), '950312035511');
  assert.equal(H.pdfPassword({ ic: '950312035511' }), '950312035511');
  assert.equal(H.pdfPassword({ ic: 'a1234567', idType: 'passport' }), 'A1234567');
  assert.equal(H.pdfPassword({ ic: 'ab-123 456', idType: 'passport' }), 'AB123456');
  assert.equal(H.pdfPassword({ ic: '' }), null);
  assert.equal(H.pdfPassword({}), null);
  assert.equal(H.pdfPassword({ ic: '12345' }), null, 'not a full 12-digit IC');
});

// ---- the PDF ----
const slip = {
  name: 'ALIF FITRI', id: '950312-03-5511', role: 'Operator', epfNo: '12345678', taxNo: '', bank: 'Maybank', account: '1234567890',
  earnings: [{ label: 'Basic salary', amount: 1800 }, { label: 'Unpaid leave, 1 day', amount: -69.23 }, { label: 'Overtime', amount: 150.5, note: 'Normal day 8 h' }],
  deductions: [{ label: 'EPF (KWSP), employee', amount: 198.97 }, { label: 'SOCSO (PERKESO), employee', amount: 9.25 }],
  reimbursements: [], employer: [{ label: 'EPF, employer', amount: 234.5 }], gross: 1881.27, totalDeductions: 208.22, net: 1673.05,
};
const head = { company: 'Major Far East', address: 'Kuantan', ssm: '', monthLabel: 'October 2026', paidOn: '31 Oct 2026', status: 'Paid', position: 'Operator' };
const text = (u8) => Buffer.from(u8).toString('latin1');
let pdfjs;
const open = async (bytes, password) => {
  pdfjs = pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password, useWorkerFetch: false, isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1), t = await page.getTextContent();
  return t.items.map((i) => i.str).join(' ');
};

test('PDF: protected with the IC, it is AES (never RC4), and its text is not readable in the file', async () => {
  const bytes = await P.build({ PDFDocument, p: slip, head, password: '950312035511' });
  const raw = text(bytes);
  assert.ok(raw.startsWith('%PDF-1.7'));
  assert.match(raw, /\/Filter \/Standard/);
  assert.match(raw, /\/CFM \/AESV2/, 'AES-128');
  assert.match(raw, /\/V 4/); assert.match(raw, /\/R 4/);
  assert.ok(!/\/V [12]\b/.test(raw) && !/\/CFM \/V2/.test(raw), 'no RC4');
  assert.ok(!raw.includes('Net pay') && !raw.includes('Basic salary') && !raw.includes('ALIF FITRI'), 'content is encrypted');
  assert.ok(!raw.includes('950312035511'), 'the password is not in the file');
});

test('PDF: it opens with the IC and not without it or with a wrong password', async () => {
  const bytes = await P.build({ PDFDocument, p: slip, head, password: '950312035511' });
  const ok = await open(bytes, '950312035511');
  assert.match(ok, /Net pay/); assert.match(ok, /RM 1,673\.05/); assert.match(ok, /Basic salary/); assert.match(ok, /October 2026/);
  await assert.rejects(() => open(bytes, undefined), (e) => e.name === 'PasswordException');
  await assert.rejects(() => open(bytes, '000000000000'), (e) => e.name === 'PasswordException');
});

test('PDF: each file gets its own owner password, so two files from the same person differ', async () => {
  const a = text(await P.build({ PDFDocument, p: slip, head, password: '950312035511' })), b = text(await P.build({ PDFDocument, p: slip, head, password: '950312035511' }));
  const o = (s) => (s.match(/\/O <([0-9a-f]+)>/) || [])[1];
  assert.ok(o(a) && o(b) && o(a) !== o(b));
});

test('PDF: with the password switch off, the file is plain and opens without one', async () => {
  const bytes = await P.build({ PDFDocument, p: slip, head, password: null });
  assert.ok(!/\/Encrypt/.test(text(bytes)));
  assert.match(await open(bytes), /Net pay/);
});

test('PDF: a passport holder’s file opens with the passport number', async () => {
  const bytes = await P.build({ PDFDocument, p: { ...slip, id: 'A1234567' }, head, password: H.pdfPassword({ ic: 'a1234567', idType: 'passport' }) });
  assert.match(await open(bytes, 'A1234567'), /Net pay/);
});

test('wiring: the vendor bundle and its licence are in the repo; no outside service is called', () => {
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'js/vendor/pdfkit.standalone.js')) && /MIT/.test(fs.readFileSync(path.join(root, 'js/vendor/PDFKIT-LICENSE'), 'utf8')));
  const src = fs.readFileSync(path.join(root, 'js/payslip-pdf.js'), 'utf8');
  assert.ok(!/https?:\/\//.test(src.replace(/\/\/ .*$/gm, '')), 'no URL in the code');
  assert.ok(!/RC4|\bpdfVersion: '1\.[3-5]'/.test(src.replace(/\/\/ .*$/gm, '')), 'no RC4 version');
});

// ---- wiring ----
test('wiring: the owner switches the screen on with set-addon; it is off for everyone else by default', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'scripts/set-addon.js'), 'utf8'), /simpleStaffHome:/);
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  assert.match(app, /const addonOn = \(k\) => window\.AllurusAddons\?\.\[k\] === true;/, 'no add-on, no simple screen');
  assert.match(app, /useSimple\(\{ addon: staffApp\(\)\.avail/);
  assert.match(app, /\.filter\(\(r\) => !\(role\(\) === 'employee' && simpleOn\(\) && r\.id !== 'home'\)\)/, 'only Home in simple mode');
  const cloud = fs.readFileSync(path.join(root, 'js/cloud.js'), 'utf8');
  assert.match(cloud, /window\.AllurusAddons = \{ simpleStaffHome: company\?\.addons\?\.simpleStaffHome === true \}/);
  assert.match(fs.readFileSync(path.join(root, 'js/experience.js'), 'utf8'), /classList\.contains\('simple-staff'\)\) \{ bar\.innerHTML = ''/, 'no tab bar');
});
test('wiring: the Settings card is only for companies with the add-on, and says honestly how strong the password is', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  assert.match(app, /\.\.\.\(staffApp\(\)\.avail \? \[\{ id: 'staffapp'/);
  assert.match(app, /stops casual opening of a forwarded or lost PDF\. It is not strong protection, because IC numbers are widely known\. Inside the app, payslips are still protected by the person’s sign-in\./);
  assert.ok(app.includes("ACTIONS['sa-toggle'] = (key, v) => { if (!['simple', 'pdfPw'].includes(key)) return;"), 'only the two known switches');
  assert.match(app, /commit\(`\$\{key === 'simple' \? 'Simple staff screen' : 'Payslip PDF password'\} turned \$\{v\}`\)/, 'changes go in the activity log');
});
test('wiring: HR payslip buttons follow the same switch and a person with no IC gets no open file', () => {
  const docs = fs.readFileSync(path.join(__dirname, '..', 'js/payroll-docs.js'), 'utf8');
  assert.match(docs, /'pd-slip': \(empId, mk\) => \(protect\(\) \? downloadSlip\(empId, mk\) : printSlip\(empId, mk\)\)/);
  assert.match(docs, /'pd-slips-all': \(_, mk\) => \(protect\(\) \? downloadAllSlips\(mk\) : printAllSlips\(mk\)\)/);
  assert.match(docs, /if \(protect\(\)\) \{ password = H\(\)\.pdfPassword\(e\); if \(!password\) return \{ ok: false, noIc: true \}; \}/);
});
