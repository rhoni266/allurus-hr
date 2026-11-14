// General entries and the trial balance (minimum double-entry layer). Pure: no screen or database code; unit tested in tests/ledger.test.js.
//
// Finance until now is single-entry bookkeeping (income and expense rows with a fixed category list). There is no chart of accounts, no
// general entry and no trial balance. This is the smallest safe addition: a general entry is a dated list of lines, each with an account
// (a plain text name or code that the company chooses) and a debit or credit in whole sen. An entry must balance, and an entry is never
// edited: a correction is another entry. The trial balance adds the lines per account. Integer sen only, so nothing drifts.
(function (root) {
  'use strict';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const isDate = (s) => { if (!DATE_RE.test(String(s))) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
  const isCents = (n) => Number.isSafeInteger(n) && n > 0;

  // [] when the entry is sound, otherwise the reasons. entry = { date, lines: [{ account, side: 'debit'|'credit', cents }] }.
  function entryErrors(entry) {
    const e = [];
    if (!entry || typeof entry !== 'object') return ['No entry'];
    if (!isDate(entry.date)) e.push('The entry needs a valid date');
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    if (lines.length < 2) e.push('An entry needs at least two lines');
    let dr = 0, cr = 0;
    lines.forEach((l, k) => {
      const n = `Line ${k + 1}`;
      if (!l || typeof l.account !== 'string' || !l.account.trim()) e.push(`${n}: no account`);
      if (!l || (l.side !== 'debit' && l.side !== 'credit')) e.push(`${n}: the side must be debit or credit`);
      if (!l || !isCents(l.cents)) { e.push(`${n}: the amount must be a whole number of sen above 0`); return; }
      if (l.side === 'debit') dr += l.cents; else if (l.side === 'credit') cr += l.cents;
    });
    if (dr !== cr) e.push(`Debits ${dr} and credits ${cr} are not equal`);
    return e;
  }
  const isBalanced = (entry) => entryErrors(entry).length === 0;

  // The trial balance for entries dated from..to (both optional): one row per account with its debit and credit totals and its net
  // balance, sorted by account, plus the grand totals, which are equal when every entry balances.
  function trialBalance(entries, { from = '', to = '' } = {}) {
    const by = new Map();
    (entries || []).filter((x) => (!from || x.date >= from) && (!to || x.date <= to)).forEach((x) => {
      (x.lines || []).forEach((l) => {
        const r = by.get(l.account) || { account: l.account, debit: 0, credit: 0 };
        if (l.side === 'debit') r.debit += l.cents; else r.credit += l.cents;
        by.set(l.account, r);
      });
    });
    const rows = [...by.values()].sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0)).map((r) => ({ ...r, net: r.debit - r.credit }));
    const debit = rows.reduce((s, r) => s + r.debit, 0), credit = rows.reduce((s, r) => s + r.credit, 0);
    return { rows, debit, credit, balanced: debit === credit };
  }

  const api = { entryErrors, isBalanced, trialBalance, isDate };
  root.AllurusLedger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
