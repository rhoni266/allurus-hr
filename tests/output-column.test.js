// Pay run table: Output replaces Bonus where production commission is on (Major Far East); everyone else keeps Bonus.
// The full behaviour is tested in a browser by tests-e2e/output-column.e2e.js (npm run test:e2e-demo); these pin the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

test('pay run: the Bonus column becomes Output only when production commission is on', () => {
  assert.match(app, /const outputOn = !!prodApi\?\.on\(\);/);
  assert.match(app, /<th class="r">\$\{outputOn \? 'Output' : 'Bonus'\}<\/th>/);
  assert.match(app, /\$\{outputOn \? outputCell\(it, e\) : `<td class="r num">\$\{run\.status === 'Draft' \? `<input class="input num"[^\n]*data-bonus=/, 'the old Bonus cell, with its input, stays for other companies');
});
test('pay run: each cell is the month’s commission and its days, or a dash; clicking opens the day list; a chip sums it up', () => {
  assert.match(app, /const prodOf = \(it\) => \{ const l = \(it\.extraLines \|\| \[\]\)\.find\(\(x\) => x\.key === 'prod'\)/);
  assert.match(app, /data-act="out-days" data-id="\$\{it\.empId\}" data-v="\$\{mk\}"/);
  assert.match(app, /'out-days': \(empId, mk\) => \{/);
  assert.match(app, /Output: \$\{money\(outputSum\.sen \/ 100, 2\)\} to \$\{outputSum\.n\} staff/);
});
test('a bonus at such a company is added in the payslip editor only', () => {
  assert.match(app, /run\.status === 'Draft' && prodApi\?\.on\(\) \? `<div class="field"[^\n]*id="slip-bonus"/);
  assert.match(app, /'slip-bonus': \(empId, mk\) => \{/);
});
