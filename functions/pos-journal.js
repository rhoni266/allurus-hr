// Receives the POS's daily journal (docs/integration/daily-journal-contract.md) and posts it as a balanced general entry.
// Pure logic with an injected store, so it is tested without Firebase (functions/test/pos-journal.test.js). index.js wires it to
// an HTTPS function with the secrets and Firestore.
//
// Transport (the proposal in the contract; nothing is changed from it):
//   POST JSON, headers  X-Timestamp (unix seconds), X-Idempotency-Key, X-Signature = hex HMAC-SHA256 of "<X-Timestamp>.<raw body>"
//   with that tenant's secret. A timestamp more than 5 minutes from now is refused (older or in the future). The signature is compared
//   in constant time. The same key with the same payload answers with the existing entry; the same key with a different payload is 409.
// Not in the contract and decided here (see docs/integration/receive-pos-journal.md): the secrets live in ONE Firebase secret
// (POS_JOURNAL_SECRETS, a JSON map of POS tenant id to secret); the POS tenant is tied to an Allurus company and its account names in
// the server-only document posIntegrations/{posTenantId}; a line whose account has no name there is refused (nothing is guessed).
'use strict';
const crypto = require('node:crypto');
const ledger = require('./ledger-rules.js');   // copied from ../js at deploy (scripts/copy-pos-rules.js), like pos-rules.js

const MAX_BODY = 64 * 1024;
const WINDOW_SEC = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNTS = ['cash', 'card', 'duitnow_qr', 'ewallet', 'sales', 'service_charge', 'sst_output', 'rounding', 'cash_over_short'];
const MAX_INT = Number.MAX_SAFE_INTEGER;
const isInt = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const isRealDate = (s) => { if (!DATE.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const res = (status, body) => ({ status, body });

// ---------- Signature and time ----------
const hmacHex = (secret, ts, raw) => crypto.createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');
// Constant-time: both sides are decoded to 32 bytes first, so a wrong-length or non-hex signature is refused without a short-circuit on content.
function signatureOk(secret, ts, raw, given) {
  const want = Buffer.from(hmacHex(secret, ts, raw), 'hex');
  const valid = typeof given === 'string' && /^[0-9a-fA-F]{64}$/.test(given);
  const got = Buffer.from(valid ? given : '0'.repeat(64), 'hex');
  return crypto.timingSafeEqual(want, got) && valid;
}
function timestampOk(ts, nowMs) {
  if (typeof ts !== 'string' || !/^\d{1,12}$/.test(ts)) return false;
  return Math.abs(Math.floor(nowMs / 1000) - Number(ts)) <= WINDOW_SEC;
}

// ---------- The payload (mirrors docs/integration/daily-journal.schema.json; unknown fields are refused) ----------
function validateJournal(j) {
  const e = [];
  const keys = (o, allowed, where) => { Object.keys(o).forEach((k) => { if (!allowed.includes(k)) e.push(`${where}: unknown field ${k}`); }); };
  if (!j || typeof j !== 'object' || Array.isArray(j)) return ['The journal must be an object'];
  keys(j, ['schema', 'schema_version', 'tenant_id', 'outlet_id', 'business_date', 'version', 'idempotency_key', 'currency', 'lines', 'metadata', 'account_map'], 'journal');
  if (j.schema !== 'possaas.daily-journal') e.push('schema must be possaas.daily-journal');
  if (j.schema_version !== 1) e.push('schema_version must be 1');
  if (typeof j.tenant_id !== 'string' || !UUID.test(j.tenant_id)) e.push('tenant_id is not a valid id');
  if (typeof j.outlet_id !== 'string' || !UUID.test(j.outlet_id)) e.push('outlet_id is not a valid id');
  if (typeof j.business_date !== 'string' || !isRealDate(j.business_date)) e.push('business_date is not a real date');
  if (!isInt(j.version, 1)) e.push('version must be a whole number from 1');
  if (typeof j.idempotency_key !== 'string' || j.idempotency_key !== `${j.tenant_id}:${j.outlet_id}:${j.business_date}:${j.version}`) e.push('idempotency_key must be tenant_id:outlet_id:business_date:version');
  if (j.currency !== 'MYR') e.push('currency must be MYR');
  if (!Array.isArray(j.lines) || j.lines.length < 2) e.push('lines needs at least two lines');
  else if (j.lines.length > 200) e.push('lines has too many lines');
  else {
    let dr = 0, cr = 0;
    j.lines.forEach((l, k) => {
      const w = `line ${k + 1}`;
      if (!l || typeof l !== 'object' || Array.isArray(l)) { e.push(`${w}: must be an object`); return; }
      keys(l, ['account', 'side', 'amount_cents'], w);
      if (!ACCOUNTS.includes(l.account)) e.push(`${w}: unknown account`);
      if (l.side !== 'debit' && l.side !== 'credit') e.push(`${w}: side must be debit or credit`);
      if (!isInt(l.amount_cents, 1)) { e.push(`${w}: amount_cents must be a whole number above 0`); return; }
      if (l.side === 'debit') dr += l.amount_cents; else if (l.side === 'credit') cr += l.amount_cents;
    });
    if (!e.length && dr !== cr) e.push(`Debits ${dr} and credits ${cr} are not equal`);
    if (!e.length && !Number.isSafeInteger(dr)) e.push('The totals are too large');
  }
  // Optional: the POS's own copy of its account names. Allurus is the source of truth (posIntegrations.accountMap); this is only checked against it.
  if (j.account_map !== undefined) {
    const am = j.account_map;
    if (!am || typeof am !== 'object' || Array.isArray(am)) e.push('account_map must be an object');
    else Object.entries(am).forEach(([k, v]) => { if (!ACCOUNTS.includes(k)) e.push(`account_map: unknown account ${k}`); else if (typeof v !== 'string' || !v.trim() || v.length > 80) e.push(`account_map.${k} must be a name`); });
  }
  const m = j.metadata;
  if (!m || typeof m !== 'object' || Array.isArray(m)) e.push('metadata is required');
  else {
    keys(m, ['timezone', 'order_count', 'void_count', 'refund_batch_count', 'held_sales_unresolved', 'adjusts_business_dates', 'sales_cents', 'reversal_cents', 'cash_variance_cents'], 'metadata');
    if (typeof m.timezone !== 'string' || !m.timezone) e.push('metadata.timezone is required');
    for (const k of ['order_count', 'void_count', 'refund_batch_count', 'held_sales_unresolved']) if (!isInt(m[k], 0)) e.push(`metadata.${k} must be a whole number from 0`);
    for (const k of ['sales_cents', 'reversal_cents']) if (m[k] !== undefined && !isInt(m[k], 0)) e.push(`metadata.${k} must be a whole number from 0`);
    if (m.cash_variance_cents !== undefined && !Number.isSafeInteger(m.cash_variance_cents)) e.push('metadata.cash_variance_cents must be a whole number');
    if (m.adjusts_business_dates !== undefined && (!Array.isArray(m.adjusts_business_dates) || !m.adjusts_business_dates.every((d) => typeof d === 'string' && isRealDate(d)))) e.push('metadata.adjusts_business_dates must be a list of dates');
  }
  return e;
}

// The same journal always gives the same hash: keys sorted, lines sorted by account and side.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
function payloadHash(j) {
  const lines = [...j.lines].sort((a, b) => (a.account + a.side < b.account + b.side ? -1 : a.account + a.side > b.account + b.side ? 1 : 0));
  return crypto.createHash('sha256').update(canonical({ ...j, lines })).digest('hex');
}

// The general entry (integer sen; lines carry the account name the company chose and the outlet as a dimension).
function buildEntry(j, cfg, hash) {
  const lines = j.lines.map((l) => ({ account: cfg.accountMap[l.account], key: l.account, side: l.side, cents: l.amount_cents, outletId: j.outlet_id }));
  const totalCents = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.cents, 0);
  return { source: 'possaas', idempotencyKey: j.idempotency_key, payloadHash: hash, posTenantId: j.tenant_id, outletId: j.outlet_id, date: j.business_date, version: j.version,
    currency: j.currency, lines, totalDebitCents: totalCents, totalCreditCents: totalCents, metadata: j.metadata, status: 'posted' };
}

/**
 * One request. deps = { secrets: { posTenantId: secret }, store: { config(posTenantId), post(allurusTenantId, entryId, entry) }, now: ms, log }.
 * store.post must be atomic: { result: 'created' | 'duplicate' | 'conflict', entryId } (a duplicate has the same payloadHash).
 * Never logs the body or any secret.
 */
async function handle({ method, headers, rawBody }, deps) {
  const log = deps.log || (() => {});
  if (method !== 'POST') return res(405, { error: 'method_not_allowed' });
  if (typeof rawBody !== 'string' || !rawBody.length) return res(400, { error: 'empty_body' });
  if (Buffer.byteLength(rawBody) > MAX_BODY) return res(413, { error: 'too_large' });
  const h = (k) => { const v = headers[k] ?? headers[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
  const ts = h('x-timestamp'), sig = h('x-signature'), idem = h('x-idempotency-key');
  // The tenant is read from the body only to find its secret; nothing else is trusted until the signature is verified.
  let parsed, tenant = '';
  try { parsed = JSON.parse(rawBody); tenant = typeof parsed?.tenant_id === 'string' ? parsed.tenant_id : ''; } catch (e) { parsed = undefined; }
  const secret = tenant && Object.prototype.hasOwnProperty.call(deps.secrets || {}, tenant) ? deps.secrets[tenant] : '';
  // Unknown tenant: still do the same work against a dummy secret, so the answer and its timing do not say which tenants exist.
  const sigGood = signatureOk(secret || 'no-such-tenant-secret', String(ts), rawBody, sig) && !!secret;
  if (!timestampOk(ts, deps.now) || !sigGood) { log('rejected', { reason: !timestampOk(ts, deps.now) ? 'timestamp' : 'signature' }); return res(401, { error: 'unauthorized' }); }
  if (parsed === undefined) return res(400, { error: 'invalid_json' });
  const errs = validateJournal(parsed);
  if (errs.length) { log('invalid', { count: errs.length }); return res(400, { error: 'invalid_journal', details: errs.slice(0, 20) }); }
  if (idem !== parsed.idempotency_key) return res(400, { error: 'invalid_journal', details: ['X-Idempotency-Key must equal idempotency_key'] });
  const cfg = await deps.store.config(parsed.tenant_id);
  if (!cfg || cfg.enabled !== true || typeof cfg.allurusTenantId !== 'string' || !cfg.allurusTenantId) { log('not_configured', { tenant: parsed.tenant_id }); return res(422, { error: 'not_configured' }); }
  if (Array.isArray(cfg.outlets) && !cfg.outlets.includes(parsed.outlet_id)) return res(422, { error: 'outlet_not_allowed' });
  // Allurus owns the account map. A map sent in the journal must agree with it for every key it names; any difference refuses the journal.
  if (parsed.account_map !== undefined) {
    const off = Object.keys(parsed.account_map).filter((k) => !cfg.accountMap || parsed.account_map[k] !== cfg.accountMap[k]).sort();
    if (off.length) { log('account_map_mismatch', { accounts: off }); return res(422, { error: 'account_map_mismatch', accounts: off }); }
  }
  const missing = [...new Set(parsed.lines.map((l) => l.account))].filter((a) => !cfg.accountMap || typeof cfg.accountMap[a] !== 'string' || !cfg.accountMap[a].trim());
  if (missing.length) { log('unmapped', { missing }); return res(422, { error: 'unmapped_account', accounts: missing }); }
  const hash = payloadHash(parsed), entryId = crypto.createHash('sha256').update(parsed.idempotency_key).digest('hex').slice(0, 40);
  const entry = buildEntry(parsed, cfg, hash);
  // Belt and braces: the same balance rule the Finance module uses, on the entry as it will be stored.
  const bad = ledger.entryErrors({ date: entry.date, lines: entry.lines.map((l) => ({ account: l.account, side: l.side, cents: l.cents })) });
  if (bad.length) { log('unbalanced', { count: bad.length }); return res(400, { error: 'invalid_journal', details: bad }); }
  const r = await deps.store.post(cfg.allurusTenantId, entryId, entry);
  if (r.result === 'conflict') { log('conflict', { entryId }); return res(409, { error: 'idempotency_conflict', entryId: r.entryId || entryId }); }
  log(r.result, { entryId, tenant: cfg.allurusTenantId });
  return res(r.result === 'created' ? 201 : 200, { ok: true, status: r.result, entryId: r.entryId || entryId });
}

module.exports = { handle, validateJournal, payloadHash, buildEntry, signatureOk, timestampOk, hmacHex, ACCOUNTS, WINDOW_SEC, MAX_BODY };
