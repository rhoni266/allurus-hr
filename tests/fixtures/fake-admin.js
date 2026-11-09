// Preloaded by tests/set-owner.test.js: replaces scripts/admin.js with an in-memory Firestore, seeded from
// FAKE_DB (JSON). Every write lands in FAKE_OUT so the test can read what the script changed.
const path = require('path'), fs = require('fs');
const data = JSON.parse(process.env.FAKE_DB || '{}');
const DEL = { __delete: true };
const save = () => fs.writeFileSync(process.env.FAKE_OUT, JSON.stringify(data));
const snap = (coll, id) => ({ id, exists: !!(data[coll] && data[coll][id]), data: () => data[coll][id] });
const db = {
  collection: (coll) => ({
    doc: (id) => ({ _c: coll, _id: id, get: async () => snap(coll, id) }),
    get: async () => ({ docs: Object.keys(data[coll] || {}).map((id) => snap(coll, id)) }),
    where: (f, _op, v) => ({ get: async () => ({ docs: Object.keys(data[coll] || {}).filter((id) => data[coll][id][f] === v).map((id) => snap(coll, id)) }) }),
  }),
  batch: () => { const ops = []; return { update: (ref, patch) => ops.push([ref, patch]), commit: async () => {
    ops.forEach(([ref, patch]) => { const d = data[ref._c][ref._id]; Object.entries(patch).forEach(([k, v]) => { if (v === DEL) delete d[k]; else d[k] = v; }); }); save(); } }; },
};
const fb = { firestore: Object.assign(() => db, { FieldValue: { delete: () => DEL } }) };
require.cache[path.join(__dirname, '..', '..', 'scripts', 'admin.js')] = { id: 'admin', loaded: true, exports: { admin: () => fb } };
