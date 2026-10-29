// Unit tests for trials and subscriptions: Malaysian day boundaries, effective status, banners, references,
// paid-until, deletion dates. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'billing-rules.js'), 'utf8'), sandbox);
const B = sandbox.window.AllurusBilling;
const MY = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h - 8, mi);   // a Malaysian wall-clock time

test('12 trial ends at the end of day 30 in Malaysia, also when signing up just before or after midnight', () => {
  const a = B.trialEnd(MY(2026, 11, 1, 0, 5));
  assert.equal(a.getTime(), MY(2026, 11, 30, 24) - 1, '1 Nov 00:05 → end of 30 Nov');
  const b = B.trialEnd(MY(2026, 10, 31, 23, 55));
  assert.equal(b.getTime(), MY(2026, 11, 29, 24) - 1, '31 Oct 23:55 → end of 29 Nov');
  const c = { status: 'trial', trialEndsAt: a.getTime() };
  assert.equal(B.effective(c, MY(2026, 11, 30, 23, 59)), 'trial');
  assert.equal(B.effective(c, MY(2026, 12, 1, 0, 0)), 'expired');
  assert.equal(B.daysLeft(a.getTime(), MY(2026, 11, 30, 9)), 1, 'ends today');
});

test('5 day 25 of the trial shows the banner; amber at 7 days, red at 3', () => {
  const start = MY(2026, 11, 1, 9), c = { status: 'trial', trialEndsAt: B.trialEnd(start).getTime() };
  const d25 = B.banner(c, MY(2026, 11, 25, 9));
  assert.equal(d25.days, 6); assert.equal(d25.level, 'amber'); assert.match(d25.text, /ends in 6 days/);
  assert.equal(B.banner(c, MY(2026, 11, 10, 9)).level, 'info');
  assert.equal(B.banner(c, MY(2026, 11, 28, 9)).level, 'red');
  assert.equal(B.banner(c, MY(2026, 12, 2, 9)).level, 'red');
  assert.match(B.banner(c, MY(2026, 12, 2, 9)).text, /data is safe/);
});

test('9 past due for 7 days of grace, then expired; paying reactivates', () => {
  const c = { status: 'active', paidUntil: MY(2026, 11, 30, 24) - 1 };
  assert.equal(B.effective(c, MY(2026, 11, 30, 12)), 'active');
  assert.equal(B.effective(c, MY(2026, 12, 3)), 'past_due');
  assert.equal(B.effective(c, MY(2026, 12, 7, 23)), 'past_due');
  assert.equal(B.effective(c, MY(2026, 12, 8, 1)), 'expired');
  const renewed = { status: 'active', paidUntil: B.extendPaid(c, 1, MY(2026, 12, 9)).getTime() };
  assert.equal(B.effective(renewed, MY(2026, 12, 9, 1)), 'active');
  assert.equal(B.myDate(renewed.paidUntil), '2027-01-09');
});

test('access by status: expired admins pay and export, staff blocked; suspended blocks everyone', () => {
  assert.equal(B.access('expired', true), 'billing'); assert.equal(B.access('expired', false), 'none');
  assert.equal(B.access('suspended', true), 'none'); assert.equal(B.access('trial', false), 'full');
  assert.equal(B.effective({}), 'active', '13 companies from before billing keep working');
});

test('references, invoice numbers, deletion date, disposable emails and phones', () => {
  assert.equal(B.reference('6UwxjYZFlUwxFQhh', MY(2026, 11, 3)), 'ALR-6UWXJY-202611');
  assert.equal(B.invoiceNo(7, MY(2026, 11, 3)), 'INV-2026-00007');
  const c = { status: 'trial', trialEndsAt: MY(2026, 11, 30, 24) - 1 };
  assert.equal(B.myDate(B.deletion(c, MY(2026, 12, 5)).at), '2027-02-28');
  assert.equal(B.deletion({ status: 'active' }), null, 'never for a working company');
  assert.equal(B.disposable('x@mailinator.com'), true); assert.equal(B.disposable('x@gmail.com'), false);
  assert.equal(B.normPhone('012-345 6789'), '60123456789'); assert.equal(B.normPhone('+60 11-2345 6789'), '601123456789'); assert.equal(B.normPhone('03-1234 5678'), '');
});
