// Allurus Cloud Functions. Point of sale: the callable functions that move money (js/pos.js calls them in cloud
// mode). Region Singapore, nearest to Malaysia. Logs carry ids and statuses only: never request bodies, card data,
// PINs or personal data.
'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('node:crypto');
const core = require('./pos-core.js');

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
