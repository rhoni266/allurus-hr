// The POS daily journal receiver (functions/pos-journal.js): HMAC, timestamp window, schema, idempotency, mapping, the balanced entry.
// No Firebase: the store is an in-memory fake that, like the real one, creates an entry or reports a duplicate or conflict atomically.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ledger-rules.js is copied in at deploy; for the tests, use the source.
const copy = path.join(__dirname, '..', 'ledger-rules.js');
if (!fs.existsSync(copy)) fs.copyFileSync(path.join(__dirname, '..', '..', 'js', 'ledger-rules.js'), copy);
const J = require('../pos-journal.js');
const ledger = require('../ledger-rules.js');
const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'integration', 'daily-journal.example.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'integration', 'daily-journal.schema.json'), 'utf8'));

const POS_TENANT = example.tenant_id, SECRET = 'test-secret-not-a-real-one', NOW = Date.UTC(2026, 10, 15, 1, 0, 0);
// The contract example carries an account_map, and Allurus must agree with it, so the test company uses the example's names for those keys.
const ACCOUNT_MAP = { cash: 'Cash on hand', card: 'Card clearing', duitnow_qr: 'DuitNow clearing', ewallet: 'E-wallet clearing', sales: 'Sales', service_charge: 'Service charge', sst_output: 'SST output', rounding: 'Rounding', cash_over_short: 'Cash over/short', ...(example.account_map || {}) };
const CFG = { enabled: true, allurusTenantId: 'co1', accountMap: ACCOUNT_MAP };

function fakeStore(cfg = CFG) {
  const entries = new Map(), logs = [];
  return {
    entries, logs,
    config: async (id) => (id === POS_TENANT ? cfg : null),
    post: async (t, id, entry) => {
      const k = `${t}/${id}`, old = entries.get(k);
      if (old) return { result: old.payloadHash === entry.payloadHash ? 'duplicate' : 'conflict', entryId: id };
      entries.set(k, JSON.parse(JSON.stringify(entry))); return { result: 'created', entryId: id };
    },
  };
}
const sign = (raw, ts, secret = SECRET) => J.hmacHex(secret, ts, raw);
// One signed request.
function req(body, { ts = String(Math.floor(NOW / 1000)), secret = SECRET, headers = {}, method = 'POST', raw } = {}) {
  const rawBody = raw ?? (typeof body === 'string' ? body : JSON.stringify(body));
  return { method, rawBody, headers: { 'x-timestamp': ts, 'x-signature': sign(rawBody, ts, secret), 'x-idempotency-key': body?.idempotency_key, ...headers } };
}
const run = (r, store = fakeStore(), extra = {}) => J.handle(r, { secrets: { [POS_TENANT]: SECRET }, store, now: NOW, log: (e, f) => store.logs.push([e, f]), ...extra }).then((out) => ({ ...out, store }));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the contract example is accepted, posted as one balanced general entry, and shows in the trial balance', async () => {
  const out = await run(req(example));
  assert.equal(out.status, 201); assert.equal(out.body.status, 'created');
  const [entry] = [...out.store.entries.values()];
  assert.equal(entry.source, 'possaas'); assert.equal(entry.date, '2026-11-14'); assert.equal(entry.currency, 'MYR');
  assert.equal(entry.totalDebitCents, 14250); assert.equal(entry.totalCreditCents, 14250);
  assert.deepEqual(ledger.entryErrors({ date: entry.date, lines: entry.lines.map((l) => ({ account: l.account, side: l.side, cents: l.cents })) }), []);
  assert.ok(entry.lines.every((l) => l.outletId === example.outlet_id), 'the outlet is kept as a dimension on every line');
  assert.ok(entry.lines.find((l) => l.key === 'cash').account === ACCOUNT_MAP.cash, 'the company\'s own account name, not the neutral key');
  const tb = ledger.trialBalance([entry].map((x) => ({ date: x.date, lines: x.lines.map((l) => ({ account: l.account, side: l.side, cents: l.cents })) })));
  assert.equal(tb.balanced, true); assert.equal(tb.debit, 14250);
});

test('signature: wrong secret, tampered body, missing or malformed header, other tenant: all 401, nothing stored', async () => {
  const cases = {
    'wrong secret': req(example, { secret: 'another-secret' }),
    'tampered body': { ...req(example), rawBody: JSON.stringify({ ...example, version: 1, metadata: { ...example.metadata, order_count: 99 } }) },
    'no signature': (() => { const r = req(example); delete r.headers['x-signature']; return r; })(),
    'not hex': req(example, { headers: { 'x-signature': 'zz'.repeat(32) } }),
    'too short': req(example, { headers: { 'x-signature': 'ab' } }),
    'uses the body only': req(example, { headers: { 'x-signature': sign('{}', String(Math.floor(NOW / 1000))) } }),
  };
  for (const [name, r] of Object.entries(cases)) { const out = await run(r); assert.equal(out.status, 401, name); assert.equal(out.store.entries.size, 0, name); assert.deepEqual(out.body, { error: 'unauthorized' }, name); }
  const other = clone(example); other.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; other.idempotency_key = `${other.tenant_id}:${other.outlet_id}:${other.business_date}:1`;
  const o = await run(req(other)); assert.equal(o.status, 401, 'a tenant with no secret answers exactly like a wrong signature'); assert.deepEqual(o.body, { error: 'unauthorized' });
  assert.equal((await run(req(example, { headers: { 'x-signature': sign(JSON.stringify(example), String(Math.floor(NOW / 1000))).toUpperCase() } }))).status, 201, 'upper-case hex is the same signature');
});

test('the signature is compared in constant time (timingSafeEqual on equal-length buffers, never a string ===)', () => {
  let calls = 0; const orig = crypto.timingSafeEqual;
  crypto.timingSafeEqual = (a, b) => { calls++; assert.equal(a.length, b.length); return orig(a, b); };
  try {
    const raw = '{"a":1}', ts = '100', good = sign(raw, ts);
    assert.equal(J.signatureOk(SECRET, ts, raw, good), true);
    assert.equal(J.signatureOk(SECRET, ts, raw, good.slice(0, 10)), false, 'a short signature does not throw');
    assert.equal(J.signatureOk(SECRET, ts, raw, undefined), false);
    assert.equal(J.signatureOk(SECRET, ts, raw, 'g'.repeat(64)), false);
    assert.equal(calls, 4, 'compared every time, even for bad input');
  } finally { crypto.timingSafeEqual = orig; }
  assert.ok(!/===?\s*(sig|given|signature)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'pos-journal.js'), 'utf8').replace(/\/\/.*$/gm, '').split('function signatureOk')[1].split('function timestampOk')[0].replace('&& valid', '')), 'no direct string comparison of the signature');
});

test('timestamp: five minutes either way is the limit; older, newer, missing or not a number is refused', async () => {
  const at = (s) => String(Math.floor(NOW / 1000) + s);
  assert.equal((await run(req(example, { ts: at(-300) }))).status, 201, 'exactly five minutes old is accepted');
  assert.equal((await run(req(example, { ts: at(-301) }))).status, 401, 'one second older is refused');
  assert.equal((await run(req(example, { ts: at(300) }))).status, 201);
  assert.equal((await run(req(example, { ts: at(301) }))).status, 401, 'from the future too');
  assert.equal((await run(req(example, { ts: at(-3600) }))).status, 401);
  for (const ts of ['', 'abc', '1.5', '-5', '12345678901234']) assert.equal((await run(req(example, { ts }))).status, 401, ts);
  const r = req(example); delete r.headers['x-timestamp']; assert.equal((await run(r)).status, 401);
  assert.equal(J.timestampOk(undefined, NOW), false);
  // a replay of an old signed message is refused even though the signature is genuine
  assert.equal((await run(req(example, { ts: at(-600) }))).status, 401);
});

test('idempotent: the same payload answers with the existing entry; a different payload for the same key is 409 and changes nothing', async () => {
  const store = fakeStore();
  const a = await run(req(example), store); assert.equal(a.status, 201);
  const b = await run(req(example), store); assert.equal(b.status, 200); assert.equal(b.body.status, 'duplicate'); assert.equal(b.body.entryId, a.body.entryId);
  assert.equal(store.entries.size, 1, 'one entry only');
  const reordered = clone(example); reordered.lines.reverse();
  const c = await run(req(reordered), store); assert.equal(c.status, 200, 'the same journal with the lines in another order is the same payload'); assert.equal(store.entries.size, 1);
  const changed = clone(example); changed.lines[0].amount_cents += 100; changed.lines[3].amount_cents += 100;   // still balanced, different money
  const d = await run(req(changed), store); assert.equal(d.status, 409); assert.equal(d.body.error, 'idempotency_conflict'); assert.equal(store.entries.size, 1);
  assert.equal([...store.entries.values()][0].totalDebitCents, 14250, 'the first entry is untouched');
  const meta = clone(example); meta.metadata.order_count = 40;
  assert.equal((await run(req(meta), store)).status, 409, 'different metadata is a different payload');
  const next = clone(example); next.business_date = '2026-11-15'; next.idempotency_key = `${next.tenant_id}:${next.outlet_id}:2026-11-15:1`;
  assert.equal((await run(req(next), store)).status, 201, 'another day is another entry'); assert.equal(store.entries.size, 2);
  const outlet2 = clone(example); outlet2.outlet_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; outlet2.idempotency_key = `${outlet2.tenant_id}:${outlet2.outlet_id}:2026-11-14:1`;
  assert.equal((await run(req(outlet2), store)).status, 201, 'another outlet is another entry');
});

test('refused before anything is written: unbalanced, bad key, unknown field or account, bad amounts, bad dates', async () => {
  const bad = async (mut, label) => { const j = clone(example); mut(j); const out = await run(req(j)); assert.equal(out.status, 400, label); assert.equal(out.store.entries.size, 0, label); return out; };
  const un = await bad((j) => { j.lines[0].amount_cents += 1; }, 'unbalanced'); assert.ok(un.body.details.some((m) => /not equal/.test(m)));
  await bad((j) => { j.idempotency_key = 'x'; }, 'key does not match the fields');
  await bad((j) => { j.version = 2; }, 'key and version disagree');
  await bad((j) => { j.extra = 1; }, 'unknown field'); await bad((j) => { j.lines[0].memo = 'x'; }, 'unknown line field'); await bad((j) => { j.metadata.customer = 'Ali'; }, 'personal data field');
  await bad((j) => { j.lines[0].account = 'petty_cash'; }, 'unknown account');
  for (const v of [0, -1, 1.5, '100', null]) await bad((j) => { j.lines[0].amount_cents = v; }, `amount ${v}`);
  await bad((j) => { j.lines = [j.lines[0]]; }, 'one line'); await bad((j) => { j.lines[0].side = 'left'; }, 'bad side');
  await bad((j) => { j.currency = 'SGD'; }, 'currency'); await bad((j) => { j.schema_version = 2; }, 'schema version'); await bad((j) => { j.schema = 'other'; }, 'schema');
  await bad((j) => { j.business_date = '2026-02-30'; j.idempotency_key = `${j.tenant_id}:${j.outlet_id}:2026-02-30:1`; }, 'not a real date');
  await bad((j) => { delete j.metadata.order_count; }, 'metadata missing a field'); await bad((j) => { j.metadata = null; }, 'no metadata');
  const h = await run(req(example, { headers: { 'x-idempotency-key': 'something-else' } })); assert.equal(h.status, 400, 'header must equal the payload key');
  assert.equal((await run(req('not json at all'))).status, 401, 'not JSON has no tenant, so there is no secret to check it with');
  assert.equal((await run(req([1, 2]))).status, 401, 'an array has no tenant, so there is no secret to check');
});

test('mapping: no guessing. An unmapped account, a disabled or unknown tenant, or an outlet not allowed is 422 and writes nothing', async () => {
  const noCash = { ...CFG, accountMap: { ...ACCOUNT_MAP, cash: '' } };
  const a = await run(req((({ account_map, ...r }) => r)(example)), fakeStore(noCash)); assert.equal(a.status, 422); assert.deepEqual(a.body, { error: 'unmapped_account', accounts: ['cash'] }); assert.equal(a.store.entries.size, 0);
  const none = await run(req(example), fakeStore({ ...CFG, accountMap: {} })); assert.equal(none.status, 422);
  assert.equal((await run(req(example), fakeStore({ ...CFG, enabled: false }))).status, 422);
  assert.equal((await run(req(example), fakeStore(null))).status, 422, 'a tenant with a secret but no configuration');
  assert.equal((await run(req(example), fakeStore({ ...CFG, outlets: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] }))).status, 422);
  assert.equal((await run(req(example), fakeStore({ ...CFG, outlets: [example.outlet_id] }))).status, 201);
  // only the accounts a journal uses need a name
  const partial = { ...CFG, accountMap: { cash: 'C', card: 'K', duitnow_qr: 'D', sales: 'S', sst_output: 'T', rounding: 'R' } };
  assert.equal((await run(req((({ account_map, ...r }) => r)(example)), fakeStore(partial))).status, 201);
});

test('Allurus owns the account map: a journal account_map that disagrees is 422 account_map_mismatch and writes nothing', async () => {
  const withMap = (m) => ({ ...clone(example), account_map: m });
  // agrees (all keys, or only some): accepted, and the stored names are Allurus's
  const full = await run(req(withMap(ACCOUNT_MAP))); assert.equal(full.status, 201);
  assert.equal([...full.store.entries.values()][0].lines.find((l) => l.key === 'sales').account, 'Sales');
  assert.equal((await run(req(withMap({ cash: ACCOUNT_MAP.cash, sales: ACCOUNT_MAP.sales })))).status, 201, 'a subset that agrees is fine');
  assert.equal((await run(req(withMap({})))).status, 201, 'an empty map names nothing, so nothing disagrees');
  // does not agree: a different name, a name where Allurus has none, a key Allurus does not have
  const diff = await run(req(withMap({ ...ACCOUNT_MAP, cash: 'Petty cash' }))); assert.equal(diff.status, 422); assert.deepEqual(diff.body, { error: 'account_map_mismatch', accounts: ['cash'] }); assert.equal(diff.store.entries.size, 0);
  const two = await run(req(withMap({ ...ACCOUNT_MAP, cash: 'x', card: 'y' }))); assert.deepEqual(two.body.accounts, ['card', 'cash']); assert.equal(two.store.entries.size, 0);
  const partialCfg = { ...CFG, accountMap: { cash: 'C', card: 'K', duitnow_qr: 'D', sales: 'S', sst_output: 'T', rounding: 'R' } };
  const extra = await run(req(withMap({ cash: 'C', ewallet: 'Wallet' })), fakeStore(partialCfg)); assert.equal(extra.status, 422, 'a name for a key Allurus has no name for'); assert.equal(extra.body.error, 'account_map_mismatch'); assert.equal(extra.store.entries.size, 0);
  assert.equal((await run(req(withMap({ cash: ACCOUNT_MAP.cash.toLowerCase() })))).status, 422, 'compared exactly, case and all');
  // an existing entry is not touched by a later mismatching journal
  const store = fakeStore(); await run(req(example), store);
  const later = await run(req(withMap({ ...ACCOUNT_MAP, sales: 'Revenue' })), store); assert.equal(later.status, 422); assert.equal(store.entries.size, 1);
  assert.equal([...store.entries.values()][0].lines.find((l) => l.key === 'sales').account, 'Sales');
  // the mismatch is decided before the money: still 422 even when the same journal would otherwise be a 409 conflict
  const conflicting = withMap({ ...ACCOUNT_MAP, cash: 'Other' }); conflicting.lines[0].amount_cents += 100; conflicting.lines[3].amount_cents += 100;
  assert.equal((await run(req(conflicting), store)).status, 422);
  // malformed maps are 400
  for (const bad of [[1], 'x', null, { petty: 'x' }, { cash: '' }, { cash: 5 }, { cash: 'x'.repeat(81) }]) assert.equal((await run(req(withMap(bad)))).status, 400, JSON.stringify(bad));
  // a different map is part of the payload: the same key with another (agreeing) map is a different payload, so 409, not a silent duplicate
  const s2 = fakeStore(); await run(req(example), s2); assert.equal((await run(req(withMap({ cash: ACCOUNT_MAP.cash })), s2)).status, 409);
  // it is signed with the body, so it cannot be stripped or altered in transit
  const r = req(withMap({ cash: ACCOUNT_MAP.cash })); r.rawBody = r.rawBody.replace(ACCOUNT_MAP.cash, 'Petty cash'); assert.equal((await run(r)).status, 401);
});

test('method and size: only POST; a body over 64 KB is refused', async () => {
  assert.equal((await run({ ...req(example), method: 'GET' })).status, 405);
  assert.equal((await run({ ...req(example), method: 'PUT' })).status, 405);
  assert.equal((await run({ method: 'POST', headers: {}, rawBody: '' })).status, 400);
  assert.equal((await run(req('x'.repeat(J.MAX_BODY + 1)))).status, 413);
});

test('logs carry events and ids only: never the body, the lines, the signature or a secret', async () => {
  const store = fakeStore(); await run(req(example), store); await run(req(example, { secret: 'bad' }), store); await run(req({ ...clone(example), lines: [] }), store);
  const text = JSON.stringify(store.logs);
  for (const leak of [SECRET, 'amount_cents', 'cash', 'duitnow', example.outlet_id, '8420', sign(JSON.stringify(example), String(Math.floor(NOW / 1000)))]) assert.ok(!text.includes(leak), `log leaks ${leak}`);
  assert.ok(store.logs.length >= 3);
});

test('the validator matches the contract schema (accounts, required fields) and the secrets are not in the repo', () => {
  assert.deepEqual([...J.ACCOUNTS].sort(), [...schema.properties.lines.items.properties.account.enum].sort());
  assert.deepEqual(J.validateJournal(example), []);
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(example).sort());   // account_map is an optional extra beyond the contract schema
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(idx, /defineSecret\('POS_JOURNAL_SECRETS'\)/); assert.ok(!/POS_JOURNAL_SECRETS\s*=\s*['"{]/.test(idx), 'no secret value in the code');
  assert.ok(!fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8').includes(SECRET));
});
