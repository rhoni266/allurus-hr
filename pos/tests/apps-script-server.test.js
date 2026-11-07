// Runs pos/apps-script-server/{Router,Provision}.gs in Node against fake Google Sheets, a fake Firebase Auth and a
// fake Firestore (POS-LIVE-APPSCRIPT-SPEC.md). No real network call is ever made; UrlFetchApp is a stub the test
// controls completely. Run: node --test pos/tests
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const allSpreadsheets = {};
  const fakeSheetApp = {};
  fakeSheetApp.openById = (id) => {
    if (!allSpreadsheets[id]) throw new Error('no such spreadsheet: ' + id);
    const tabs = allSpreadsheets[id];
    return {
      getId: () => id,
      getSheetByName: (n) => (tabs[n] ? sheetFns(tabs, n) : null),
      insertSheet: (n) => { tabs[n] = []; return sheetFns(tabs, n); },
      setSpreadsheetTimeZone() {}, getSheets: () => Object.keys(tabs), deleteSheet() {},
    };
  };
  function sheetFns(tabs, name) {
    return {
      getDataRange: () => ({ getValues: () => tabs[name].map((r) => r.slice()) }),
      getLastRow: () => tabs[name].length,
      getMaxRows: () => 1000,
      setFrozenRows() {},
      getRange: (row, col, nr = 1, nc = 1) => ({
        setValues(v) { v.forEach((r, i) => { const t = tabs[name]; while (t.length < row + i) t.push([]); r.forEach((x, j) => { t[row - 1 + i][col - 1 + j] = x; }); }); return this; },
        setValue(x) { tabs[name][row - 1][col - 1] = x; return this; },
        setFontWeight() { return this; }, setNumberFormat() { return this; },
        clearContent() { const t = tabs[name]; for (let i = row - 1; i < row - 1 + nr && i < t.length; i++) t[i] = []; while (t.length && !t[t.length - 1].length) t.pop(); return this; },
      }),
      appendRow: (r) => { tabs[name].push(r.slice()); },
    };
  }
  fakeSheetApp.create = (title) => { const id = 'ss-' + (Object.keys(allSpreadsheets).length + 1); allSpreadsheets[id] = {}; return fakeSheetApp.openById(id); };

  // ---- fake users/companies "Firestore", and a fake Firebase Auth token store ----
  const users = {}; // uid -> profile
  const companies = {}; // tenantId -> company doc
  const tokens = {}; // token string -> uid

  let uuid = 0;
  const props = { FIREBASE_API_KEY: 'test-key', FIREBASE_PROJECT_ID: 'demo-allurus', REGISTRY_ID: 'registry-1', CLIENTS_FOLDER_ID: '' };
  const cache = {};
  const ctx = {
    console, Math, JSON, Number, String, Array, Object, Error, isFinite, Date, Boolean,
    SpreadsheetApp: fakeSheetApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? String(props[k]) : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    Utilities: {
      getUuid: () => `uuid-${String(++uuid).padStart(8, '0')}`,
      formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? '2026-11-07' : '2026-11-07T10:00:00+08:00'),
      computeDigest: () => Array.from({ length: 32 }, (_, i) => i),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    DriveApp: { getFileById: () => ({}), getFolderById: () => ({ addFile() {} }), getRootFolder: () => ({ removeFile() {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        if (url.indexOf('identitytoolkit.googleapis.com') >= 0) {
          const payload = JSON.parse(opts.payload);
          const uid = tokens[payload.idToken];
          return { getResponseCode: () => (uid ? 200 : 400), getContentText: () => JSON.stringify(uid ? { users: [{ localId: uid }] } : { error: 'bad token' }) };
        }
        if (url.indexOf('firestore.googleapis.com') >= 0) {
          const token = (opts.headers.Authorization || '').replace('Bearer ', '');
          const callerUid = tokens[token];
          if (!callerUid) return { getResponseCode: () => 403, getContentText: () => '{}' };
          const m = url.match(/documents\/(users|tenants)\/([^/?]+)/);
          const store = m[1] === 'users' ? users : companies;
          const doc = store[m[2]];
          if (!doc) return { getResponseCode: () => 404, getContentText: () => '{}' };
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ fields: encodeFirestore(doc) }) };
        }
        throw new Error('unexpected fetch: ' + url);
      }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'pos-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script-server', 'Router.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script-server', 'Provision.gs'), 'utf8'), ctx);

  // Registry tab lives in its own spreadsheet, id = props.REGISTRY_ID.
  allSpreadsheets[props.REGISTRY_ID] = { Registry: [['tenantId', 'spreadsheetId', 'outletName', 'createdAt', 'createdByUid', 'status', 'lastSaleAt']] };

  function addUser(uid, profile, token) { users[uid] = profile; if (token) tokens[token] = uid; }
  function addCompany(tenantId, doc) { companies[tenantId] = doc; }
  function call(body) { return { data: ctx.handle_(body) }; } // same shape as doPost's json_({ ok: true, data: ... })
  return { ctx, call, addUser, addCompany, allSpreadsheets, props };
}

function encodeFirestore(obj) {
  const enc = (v) => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (typeof v === 'object') return { mapValue: { fields: encodeFirestore(v) } };
    return { stringValue: String(v) };
  };
  const out = {};
  Object.keys(obj).forEach((k) => { out[k] = enc(obj[k]); });
  return out;
}

test('a manager signs in, provisions a company and sells', () => {
  const { call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin', 'employee'] }, 'owner-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  const prov = call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A', servicePercent: 10, sampleMenu: true } });
  assert.ok(prov.data.spreadsheetId);
  // Starting the trial (what js/pos-trial.js writes) happens client-side after provision; simulate it here.
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString() } } });

  const products = call({ action: 'getProducts', tenantId: 'tA', idToken: 'owner-token', data: {} });
  assert.ok(products.data.length >= 6, 'sample menu should have loaded');
  const latte = products.data.find((p) => p.name.indexOf('Latte') >= 0);
  const sale = call({ action: 'createSale', tenantId: 'tA', idToken: 'owner-token', data: { sale_id: 'sale-0001', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: latte.id, qty: 1 }] } });
  assert.equal(sale.data.receipt_no, 'R000001');
});

test('a bad token is refused', () => {
  const { call, addCompany } = load();
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  assert.throws(() => call({ action: 'getProducts', tenantId: 'tA', idToken: 'not-a-real-token', data: {} }), /Not allowed/);
});

test('a token for another company cannot read this one', () => {
  const { call, addUser, addCompany } = load();
  addUser('uidB', { email: 'boss@b.my', tenantId: 'tB', roles: ['admin'] }, 'token-b');
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString() } } });
  assert.throws(() => call({ action: 'getProducts', tenantId: 'tA', idToken: 'token-b', data: {} }), /Not allowed/);
});

test('a disabled account is refused even with a valid token', () => {
  const { call, addUser, addCompany } = load();
  addUser('uidX', { email: 'gone@a.my', tenantId: 'tA', roles: ['employee'], posRole: 'cashier', disabled: true }, 'token-x');
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString() } } });
  assert.throws(() => call({ action: 'getProducts', tenantId: 'tA', idToken: 'token-x', data: {} }), /Not allowed/);
});

test('no POS role is refused', () => {
  const { call, addUser, addCompany } = load();
  addUser('uidY', { email: 'staff@a.my', tenantId: 'tA', roles: ['employee'] }, 'token-y');
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString() } } });
  assert.throws(() => call({ action: 'getProducts', tenantId: 'tA', idToken: 'token-y', data: {} }), /POS access/);
});

test('a cashier can sell but not change a price or void', () => {
  const { call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addUser('cashUid', { email: 'cashier@a.my', tenantId: 'tA', roles: ['employee'], posRole: 'cashier' }, 'cash-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A', sampleMenu: true } });
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString() } } });

  const products = call({ action: 'getProducts', tenantId: 'tA', idToken: 'cash-token', data: {} });
  const item = products.data[0];
  const sale = call({ action: 'createSale', tenantId: 'tA', idToken: 'cash-token', data: { sale_id: 'sale-0002', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: item.id, qty: 1 }] } });
  assert.equal(sale.data.status, 'paid');
  assert.throws(() => call({ action: 'saveProduct', tenantId: 'tA', idToken: 'cash-token', data: { id: item.id, name: item.name, price: 1, category: item.category, unit: item.unit } }), /Not allowed/);
  assert.throws(() => call({ action: 'voidSale', tenantId: 'tA', idToken: 'cash-token', data: { sale_id: 'sale-0002', reason: 'testing' } }), /Not allowed/);
  // A manager (the Owner) can do both.
  const voided = call({ action: 'voidSale', tenantId: 'tA', idToken: 'owner-token', data: { sale_id: 'sale-0002', reason: 'testing' } });
  assert.equal(voided.data.status, 'void');
});

test('a company with no POS trial started gets refused', () => {
  const { call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' }); // no addons.pos at all, and never provisioned
  assert.throws(() => call({ action: 'getProducts', tenantId: 'tA', idToken: 'owner-token', data: {} }), /POS access|trial/);
});

test('an expired POS trial: reads still work, a write is refused', () => {
  const { call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A', sampleMenu: true } });
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() - 864e5).toISOString() } } });

  const products = call({ action: 'getProducts', tenantId: 'tA', idToken: 'owner-token', data: {} });
  assert.ok(products.data.length > 0);
  assert.throws(() => call({ action: 'createSale', tenantId: 'tA', idToken: 'owner-token', data: { sale_id: 'sale-0003', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: products.data[0].id, qty: 1 }] } }), /trial has ended/);
});

test('the same sale_id sent twice returns the one sale (across two "requests", same as the Sheet host)', () => {
  const { call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A', sampleMenu: true } });
  addCompany('tA', { name: 'Kedai A', status: 'active', addons: { pos: { status: 'trial', trialEndsAt: new Date(Date.now() + 10 * 864e5).toISOString() } } });
  const item = call({ action: 'getProducts', tenantId: 'tA', idToken: 'owner-token', data: {} }).data[0];
  const sale = { sale_id: 'dup-00001', payment_method: 'cash', order_type: 'takeaway', items: [{ product_id: item.id, qty: 1 }] };
  const r1 = call({ action: 'createSale', tenantId: 'tA', idToken: 'owner-token', data: sale });
  const r2 = call({ action: 'createSale', tenantId: 'tA', idToken: 'owner-token', data: sale });
  assert.equal(r1.data.receipt_no, r2.data.receipt_no);
  assert.equal(r2.data.duplicate, true);
});

test('provision takes the script lock around the registry check and the Sheet creation', () => {
  const { ctx, call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  const calls = [];
  ctx.LockService = { getScriptLock: () => ({ waitLock: () => calls.push('wait'), releaseLock: () => calls.push('release') }) };
  call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A' } });
  assert.deepEqual(calls, ['wait', 'release']);
});

test('provision twice returns the same Sheet (no second spreadsheet); provision by a non-admin is refused', () => {
  const { call, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addUser('staffUid', { email: 'staff@a.my', tenantId: 'tA', roles: ['employee'] }, 'staff-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  const first = call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A' } });
  const second = call({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A' } });
  assert.equal(first.data.spreadsheetId, second.data.spreadsheetId);
  assert.equal(second.data.created, false);
  assert.throws(() => call({ action: 'provision', tenantId: 'tA', idToken: 'staff-token', data: { outletName: 'Kedai A' } }), /Owner or a Settings admin/);
});

test('doPost (not just handle_) replies through a real ContentService.createTextOutput/setMimeType chain', () => {
  // This is the path a real web app request takes (handle_() alone, used by call() above, skips json_() entirely -
  // that's exactly how a missing json_() shipped undetected until a live deploy, see docs/POS-SERVER-DEPLOYED.md).
  const { ctx, addUser, addCompany } = load();
  addUser('ownerUid', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'owner-token');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  const outputs = [];
  ctx.ContentService = {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => {
      const out = { text: s, mime: null, setMimeType(m) { this.mime = m; return this; } };
      outputs.push(out);
      return out;
    }
  };
  const get = ctx.doGet();
  assert.deepEqual(JSON.parse(get.text), { ok: true, data: { service: 'allurus-pos-server' } });
  assert.equal(get.mime, 'json');

  const post = ctx.doPost({ postData: { contents: JSON.stringify({ action: 'provision', tenantId: 'tA', idToken: 'owner-token', data: { outletName: 'Kedai A' } }) } });
  const body = JSON.parse(post.text);
  assert.equal(body.ok, true);
  assert.ok(body.data.spreadsheetId);

  const bad = ctx.doPost({ postData: { contents: 'not json' } });
  assert.equal(JSON.parse(bad.text).ok, false);
});

test('two companies: each request only ever touches its own Sheet', () => {
  const { call, addUser, addCompany, allSpreadsheets } = load();
  addUser('ownerA', { email: 'boss@a.my', tenantId: 'tA', roles: ['admin'] }, 'token-a');
  addUser('ownerB', { email: 'boss@b.my', tenantId: 'tB', roles: ['admin'] }, 'token-b');
  addCompany('tA', { name: 'Kedai A', status: 'active' });
  addCompany('tB', { name: 'Kedai B', status: 'active' });
  const a = call({ action: 'provision', tenantId: 'tA', idToken: 'token-a', data: { outletName: 'Kedai A', sampleMenu: true } });
  const b = call({ action: 'provision', tenantId: 'tB', idToken: 'token-b', data: { outletName: 'Kedai B', sampleMenu: true } });
  assert.notEqual(a.data.spreadsheetId, b.data.spreadsheetId);
  assert.ok(allSpreadsheets[a.data.spreadsheetId].Products.length > 1);
  assert.ok(allSpreadsheets[b.data.spreadsheetId].Products.length > 1);
});
