// General entries and the trial balance: balance in whole sen, no edits, per-account totals.  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/ledger-rules.js');

const entry = (o = {}) => ({ date: '2026-11-14', lines: [{ account: 'Cash', side: 'debit', cents: 14250 }, { account: 'Sales', side: 'credit', cents: 13660 }, { account: 'SST output', side: 'credit', cents: 580 }, { account: 'Rounding', side: 'credit', cents: 10 }], ...o });

test('a balanced entry is accepted; unequal debits and credits are refused', () => {
  assert.deepEqual(L.entryErrors(entry()), []);
  assert.equal(L.isBalanced(entry()), true);
  const off = L.entryErrors(entry({ lines: [{ account: 'Cash', side: 'debit', cents: 100 }, { account: 'Sales', side: 'credit', cents: 99 }] }));
  assert.ok(off.some((m) => /not equal/.test(m)), off.join(' | '));
});

test('lines must be sound: two or more, an account, a side, whole sen above zero, a real date', () => {
  assert.ok(L.entryErrors(entry({ lines: [{ account: 'Cash', side: 'debit', cents: 5 }] })).some((m) => /at least two/.test(m)));
  assert.ok(L.entryErrors(entry({ lines: [{ account: '', side: 'debit', cents: 5 }, { account: 'B', side: 'credit', cents: 5 }] })).some((m) => /no account/.test(m)));
  assert.ok(L.entryErrors(entry({ lines: [{ account: 'A', side: 'left', cents: 5 }, { account: 'B', side: 'credit', cents: 5 }] })).some((m) => /debit or credit/.test(m)));
  for (const bad of [0, -5, 1.5, '5', NaN, 2 ** 60]) assert.ok(L.entryErrors(entry({ lines: [{ account: 'A', side: 'debit', cents: bad }, { account: 'B', side: 'credit', cents: 5 }] })).some((m) => /whole number of sen/.test(m)), String(bad));
  for (const d of ['2026-02-30', '14/11/2026', '', undefined]) assert.ok(L.entryErrors(entry({ date: d })).some((m) => /valid date/.test(m)), String(d));
  assert.deepEqual(L.entryErrors(null), ['No entry']);
});

test('trial balance: totals per account, sorted; debits equal credits when every entry balances', () => {
  const e2 = { date: '2026-11-15', lines: [{ account: 'Cash', side: 'debit', cents: 1000 }, { account: 'Sales', side: 'credit', cents: 1000 }] };
  const tb = L.trialBalance([entry(), e2]);
  assert.deepEqual(tb.rows.map((r) => [r.account, r.debit, r.credit, r.net]), [['Cash', 15250, 0, 15250], ['Rounding', 0, 10, -10], ['SST output', 0, 580, -580], ['Sales', 0, 14660, -14660]]);
  assert.equal(tb.debit, 15250); assert.equal(tb.credit, 15250); assert.equal(tb.balanced, true);
});

test('trial balance for a date range; an empty range is empty and balanced', () => {
  const e2 = { date: '2026-11-15', lines: [{ account: 'Cash', side: 'debit', cents: 1000 }, { account: 'Sales', side: 'credit', cents: 1000 }] };
  assert.equal(L.trialBalance([entry(), e2], { from: '2026-11-15' }).debit, 1000);
  assert.equal(L.trialBalance([entry(), e2], { to: '2026-11-14' }).debit, 14250);
  const none = L.trialBalance([entry()], { from: '2027-01-01' });
  assert.deepEqual([none.rows.length, none.debit, none.credit, none.balanced], [0, 0, 0, true]);
});
