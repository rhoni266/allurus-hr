// Cafe POS demo: a Host for pos-core.js (see shared/pos-core.js) backed by localStorage, so the demo runs the exact
// same prices/totals/stock/recipe/waste logic as the real backend, entirely in this browser tab.
//
// Must load BEFORE pos-core.js: pos-core.js reads `PosHost` once, at the top level, the moment it runs.
//
// Storage: one JSON blob under allurus_pos_demo_v1, holding { meta, tables: { Products: [...], Sales: [...], ... } }.
// Each table is an array of plain row objects (no _row; Host.rows() adds it back from the array index, matching the
// Sheet's "row 2 is the first data row" convention that receiptNo_() and others rely on). If localStorage throws
// (private windows, storage full, or disabled) everything still works for this page load: an in-memory object takes
// over silently, per PHONE-CAPTURE-FIX-SPEC's "private window works" test.
(function () {
  'use strict';
  var KEY = 'allurus_pos_demo_v1';
  var TZ = 'Asia/Kuala_Lumpur';
  var mem = null; // in-memory fallback, set on first failed localStorage access
  var cache = null; // the parsed blob, kept in memory for this page load either way

  function blank() {
    return {
      meta: { sstPercent: 0, servicePercent: 10, lowStock: 5, countVariancePercent: 5 },
      tables: { Products: [], Sales: [], SaleItems: [], Waste: [], StockMovements: [], Recipes: [], Purchases: [], OpenContainers: [], StockCounts: [] }
    };
  }

  function read() {
    if (cache) return cache;
    if (mem) { cache = mem; return cache; }
    try {
      var raw = window.localStorage.getItem(KEY);
      cache = raw ? JSON.parse(raw) : blank();
    } catch (e) {
      mem = blank();
      cache = mem;
    }
    return cache;
  }

  function persist() {
    if (mem) return; // already fell back; nothing to write through
    try { window.localStorage.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { mem = cache; } // storage full, disabled, or a private window: keep going in memory only
  }

  function table(name) {
    var d = read();
    if (!d.tables[name]) d.tables[name] = [];
    return d.tables[name];
  }

  function nowParts(offsetMs) {
    var d = new Date(Date.now() + (offsetMs || 0));
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
    var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
    return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  window.PosHost = {
    rows: function (name) {
      return table(name).map(function (r, i) { var o = { _row: i + 2 }; for (var k in r) o[k] = r[k]; return o; });
    },
    append: function (name, objs) {
      if (!objs.length) return;
      var t = table(name);
      objs.forEach(function (o) { t.push(o); });
      persist();
    },
    setCell: function (name, row, col, value) {
      var t = table(name);
      var idx = row - 2;
      if (!t[idx]) return;
      t[idx][col] = value;
      persist();
    },
    setRow: function (name, row, obj) {
      var t = table(name);
      var idx = row - 2;
      var clean = {};
      for (var k in obj) clean[k] = obj[k] === undefined ? '' : obj[k];
      t[idx] = clean;
      persist();
    },
    lastRow: function (name) { return table(name).length + 1; }, // + the header row
    replaceRows: function (name, objs) {
      var d = read();
      d.tables[name] = objs.map(function (o) { var r = {}; for (var k in o) r[k] = o[k] === undefined ? '' : o[k]; return r; });
      persist();
    },
    withLock: function (fn) { return fn(); }, // one browser tab, synchronous localStorage: nothing to lock
    now: function () { var p = nowParts(0); return p.y + '-' + p.m + '-' + p.d + 'T' + p.h + ':' + p.mi + ':' + p.s + '+08:00'; },
    today: function () { var p = nowParts(0); return p.y + '-' + p.m + '-' + p.d; },
    addDays: function (days) { var p = nowParts(days * 86400000); return p.y + '-' + p.m + '-' + p.d; },
    uuid: uuid,
    settings: function () {
      var m = read().meta;
      return { taxBp: pctToBp_(m.sstPercent), serviceBp: pctToBp_(m.servicePercent), lowStock: Number(m.lowStock || 5) };
    },
    property: function (name, def) {
      var m = read().meta;
      if (name === 'COUNT_VARIANCE_PERCENT') return m.countVariancePercent;
      return def;
    }
  };

  // Used by demo/seed.js and the "Reset demo" button; not part of the Host interface pos-core.js calls.
  window.PosDemoStore = {
    key: KEY,
    isEmpty: function () { return table('Products').length === 0; },
    reset: function () { cache = null; mem = null; try { window.localStorage.removeItem(KEY); } catch (e) { /* private window: fine, cache is already cleared */ } },
    setMeta: function (patch) { var d = read(); for (var k in patch) d.meta[k] = patch[k]; persist(); }
  };
})();
