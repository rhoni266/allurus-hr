// Cafe POS, live for any Allurus company: a Host for pos-core.js backed by each company's own Firestore data
// (see POS-LIVE-FLOW-SPEC.md), for /pos (as opposed to /demo/pos, which stays browser-only).
//
// PRACTICE MODE. functions/pos-cafe.js (the real server function that re-checks prices, totals and stock, and
// gives one sale_id exactly one receipt number even across two devices at once) is not deployed - that needs the
// Firebase project on the Blaze plan (RUN-ALL-SPECS.md hard stop 3). Until then, this Host writes straight from
// the browser, so:
//   - prices, totals, stock and recipe usage are only as trustworthy as the person using the till;
//   - two different devices selling at the same instant could both pass pos-core.js's "same sale_id" check before
//     either write reaches the other, because there is no server-side lock across devices (withLock() below is a
//     no-op, same as the demo's, but the demo only ever has one tab; this has as many as the company has tills);
//   - receipt numbers (derived from how many sales this device has seen) can collide the same way.
// That is why every screen must show a "Practice mode" banner and every receipt prints "PRACTICE - NOT A REAL
// RECEIPT" (see demo/demo-ui.js's pattern, reused for practice mode) - exactly as POS-LIVE-FLOW-SPEC.md section 9
// asks for - and why nothing here posts to Finance or Operations.
//
// Design: a synchronous in-memory mirror of each table (pos-core.js's Host calls are all synchronous), kept live
// by Firestore's onSnapshot, with writes sent through the Firestore SDK's own offline queue (persistentLocalCache,
// the same one js/cloud.js already uses) - so a sale made offline is queued and sent once back online, and the
// mirror already shows it locally in the meantime (optimistic local cache reads, same as the rest of Allurus).
//
// Must load BEFORE pos-core.js: pos-core.js reads PosHost once, at the top level, the moment it runs. Connecting
// (AllurusPosCloud.connect) happens after, since it needs a signed-in user; until the first snapshot arrives for
// each collection the mirror for it is simply empty (the till shows "Loading…", same as any first paint).
(function () {
  'use strict';
  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
  var TZ = 'Asia/Kuala_Lumpur';
  var TABLES = ['Products', 'Sales', 'SaleItems', 'Waste', 'StockMovements', 'Recipes', 'Purchases', 'OpenContainers', 'StockCounts'];

  var mirror = {};   // table -> array of row objects (no _row; added back by rows())
  var mirrorIds = {}; // table -> array of Firestore doc ids, same index as mirror[table]
  var meta = { sstPercent: 0, servicePercent: 0, lowStock: 5, countVariancePercent: 5 };
  TABLES.forEach(function (t) { mirror[t] = []; mirrorIds[t] = []; });

  var db, tenantId, FS;
  var ready; // resolves once every table's first snapshot has arrived
  var readyParts = {};

  function col(name) { return FS.collection(db, 'tenants/' + tenantId, name === 'settings' ? 'posc_settings' : 'posc_' + name); }

  function nowParts(offsetMs) {
    var d = new Date(Date.now() + (offsetMs || 0));
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
    var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
    return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
  }

  window.PosHost = {
    rows: function (name) {
      return mirror[name].map(function (r, i) { var o = { _row: i + 2 }; for (var k in r) o[k] = r[k]; return o; });
    },
    append: function (name, objs) {
      if (!objs.length) return;
      objs.forEach(function (o) {
        var ref = FS.doc(col(name));
        mirror[name].push(o);
        mirrorIds[name].push(ref.id);
        FS.setDoc(ref, clean(o)).catch(function (e) { console.error('[Allurus POS] write failed (queued offline if you are offline): ' + name, e); });
      });
    },
    setCell: function (name, row, col_, value) {
      var idx = row - 2;
      if (!mirror[name][idx]) return;
      mirror[name][idx][col_] = value;
      var id = mirrorIds[name][idx];
      if (!id) return;
      var patch = {}; patch[col_] = value;
      FS.updateDoc(FS.doc(col(name), id), patch).catch(function (e) { console.error('[Allurus POS] write failed: ' + name, e); });
    },
    setRow: function (name, row, obj) {
      var idx = row - 2;
      var clean_ = clean(obj);
      mirror[name][idx] = clean_;
      var id = mirrorIds[name][idx];
      if (!id) { // a new row (saveProduct_ writes a brand-new product this way, not through append())
        var ref = FS.doc(col(name));
        mirrorIds[name][idx] = ref.id;
        FS.setDoc(ref, clean_).catch(function (e) { console.error('[Allurus POS] write failed: ' + name, e); });
      } else {
        FS.setDoc(FS.doc(col(name), id), clean_).catch(function (e) { console.error('[Allurus POS] write failed: ' + name, e); });
      }
    },
    lastRow: function (name) { return mirror[name].length + 1; },
    replaceRows: function (name, objs) {
      var oldIds = mirrorIds[name].slice();
      mirror[name] = objs.map(clean);
      mirrorIds[name] = objs.map(function () { return null; });
      var batch = FS.writeBatch(db);
      oldIds.forEach(function (id) { if (id) batch.delete(FS.doc(col(name), id)); });
      mirror[name].forEach(function (o, i) {
        var ref = FS.doc(col(name));
        mirrorIds[name][i] = ref.id;
        batch.set(ref, o);
      });
      batch.commit().catch(function (e) { console.error('[Allurus POS] write failed: ' + name, e); });
    },
    // No cross-device lock in practice mode - see the file header. A real lock needs functions/pos-cafe.js running
    // the same pos-core.js call inside one Firestore transaction.
    withLock: function (fn) { return fn(); },
    now: function () { var p = nowParts(0); return p.y + '-' + p.m + '-' + p.d + 'T' + p.h + ':' + p.mi + ':' + p.s + '+08:00'; },
    today: function () { var p = nowParts(0); return p.y + '-' + p.m + '-' + p.d; },
    addDays: function (days) { var p = nowParts(days * 86400000); return p.y + '-' + p.m + '-' + p.d; },
    uuid: function () {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      var b = window.crypto.getRandomValues(new Uint8Array(16));
      return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    },
    settings: function () { return { taxBp: pctToBp(meta.sstPercent), serviceBp: pctToBp(meta.servicePercent), lowStock: Number(meta.lowStock || 5) }; },
    property: function (name, def) { return name === 'COUNT_VARIANCE_PERCENT' ? meta.countVariancePercent : def; }
  };

  function pctToBp(p) { var n = Number(p || 0); return isFinite(n) && n > 0 ? Math.round(n * 100) : 0; }
  function clean(o) { var c = {}; for (var k in o) c[k] = o[k] === undefined ? '' : o[k]; return c; }

  function watch(FSmod, name) {
    readyParts[name] = false;
    var first = true;
    FSmod.onSnapshot(col(name), function (snap) {
      var rows = [];
      var ids = [];
      snap.forEach(function (d) { rows.push(d.data()); ids.push(d.id); });
      mirror[name] = rows;
      mirrorIds[name] = ids;
      if (first) { first = false; readyParts[name] = true; maybeResolveReady(); }
    }, function (e) { console.error('[Allurus POS] sync failed: ' + name, e); if (first) { first = false; readyParts[name] = true; maybeResolveReady(); } });
  }

  var resolveReady;
  ready = new Promise(function (res) { resolveReady = res; });
  function maybeResolveReady() {
    if (TABLES.every(function (t) { return readyParts[t]; }) && readyParts.settings) resolveReady();
  }

  // Called by pos/api-cloud.js once the person is signed in and their company's POS is on. Returns a promise that
  // resolves once the first snapshot of every table has arrived (so the till doesn't show an empty menu for a
  // moment that's really "still loading").
  window.AllurusPosCloud = {
    connect: function (t) {
      tenantId = t;
      return Promise.all([import(SDK + '/firebase-app.js'), import(SDK + '/firebase-auth.js'), import(SDK + '/firebase-firestore.js')])
        .then(function (mods) {
          FS = mods[2];
          var app = mods[0].getApps ? (mods[0].getApps()[0] || mods[0].initializeApp(window.ALLURUS_FIREBASE)) : mods[0].initializeApp(window.ALLURUS_FIREBASE);
          try { db = FS.initializeFirestore(app, { localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() }) }); }
          catch (e) { db = FS.getFirestore(app); }
          readyParts.settings = false;
          FS.onSnapshot(FS.doc(col('settings'), 'default'), function (snap) {
            if (snap.exists()) { var d = snap.data(); for (var k in d) meta[k] = d[k]; }
            if (!readyParts.settings) { readyParts.settings = true; maybeResolveReady(); }
          }, function () { if (!readyParts.settings) { readyParts.settings = true; maybeResolveReady(); } });
          TABLES.forEach(function (name) { watch(FS, name); });
          return ready;
        });
    },
    // Whether the local cache has mutations still queued to send (Firestore SDK tracks this itself).
    pendingWrites: function () {
      // A rough count: Firestore doesn't expose a single "N pending" number, only per-snapshot metadata, so
      // app.js's offline indicator stays the simple navigator.onLine check it already has; this is here for a
      // future "N sales waiting" banner (POS-LIVE-FLOW-SPEC.md section 3) once that's built.
      return null;
    }
  };
})();
