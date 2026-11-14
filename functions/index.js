// Allurus Cloud Functions. Point of sale: the callable functions that move money (js/pos.js calls them in cloud
// mode). Region Singapore, nearest to Malaysia. Logs carry ids and statuses only: never request bodies, card data,
// PINs or personal data.
'use strict';
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('node:crypto');
const core = require('./pos-core.js');
const journal = require('./pos-journal.js');

admin.initializeApp();
const db = admin.firestore();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const opts = { region: 'asia-southeast1', enforceAppCheck: false, maxInstances: 20 };

const wrap = (name, fn) => onCall(opts, async (req) => {
  try {
    const out = await fn(db, { uid: req.auth?.uid, data: req.data || {}, sha256 });
    logger.info(name, { tenantId: req.data?.tenantId, orderId: req.data?.orderId, ok: true });
    return out;
  } catch (e) {
    if (e instanceof core.PosError) { logger.warn(name, { tenantId: req.data?.tenantId, code: e.code }); throw new HttpsError(e.code, e.message); }
    logger.error(name, { tenantId: req.data?.tenantId, err: e.message });
    throw new HttpsError('internal', 'Something went wrong; nothing was charged twice. Try again.');
  }
});

exports.posRecordPayment = wrap('posRecordPayment', core.recordPayment);
exports.posVoidOrRefund = wrap('posVoidOrRefund', core.voidOrRefund);
exports.posShift = wrap('posShift', core.shift);

// ---------- The POS daily journal (docs/integration/daily-journal-contract.md, docs/integration/receive-pos-journal.md) ----------
// The HMAC secrets are NOT in the repo: one Firebase secret, a JSON map of POS tenant id to secret.
//   firebase functions:secrets:set POS_JOURNAL_SECRETS     (value: {"<pos tenant id>":"<long random secret>"})
const POS_JOURNAL_SECRETS = defineSecret('POS_JOURNAL_SECRETS');
const journalStore = {
  async config(posTenantId) { const s = await db.doc(`posIntegrations/${posTenantId}`).get(); return s.exists ? s.data() : null; },
  // One transaction: a new entry is created; the same key and payload is a duplicate; the same key and another payload is a conflict.
  async post(tenantId, entryId, entry) {
    const ref = db.doc(`tenants/${tenantId}/generalEntries/${entryId}`);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return { result: snap.data().payloadHash === entry.payloadHash ? 'duplicate' : 'conflict', entryId };
      tx.create(ref, { ...entry, receivedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { result: 'created', entryId };
    });
  },
};
exports.receivePosJournal = onRequest({ region: 'asia-southeast1', maxInstances: 10, secrets: [POS_JOURNAL_SECRETS], cors: false }, async (req, resp) => {
  let secrets = {};
  try { secrets = JSON.parse(POS_JOURNAL_SECRETS.value() || '{}'); } catch (e) { logger.error('receivePosJournal', { err: 'secrets are not valid JSON' }); resp.status(500).json({ error: 'server_error' }); return; }
  try {
    const out = await journal.handle({ method: req.method, headers: req.headers, rawBody: req.rawBody ? req.rawBody.toString('utf8') : '' },
      { secrets, store: journalStore, now: Date.now(), log: (event, f) => logger.info('receivePosJournal', { event, ...f }) });
    resp.status(out.status).json(out.body);
  } catch (e) {
    logger.error('receivePosJournal', { err: e.message });
    resp.status(500).json({ error: 'server_error' });
  }
});
