// Cafe POS, live for a signed-in company (POS-LIVE-FLOW-SPEC.md). Same window.PosApi surface as api.js and
// api-demo.js, so app.js doesn't know which backend it's talking to - but this one has a gate in front of it:
// nothing in app.js runs until a signed-in person with a POS role at a company whose POS is on is confirmed.
//
// NOT YET BUILT (logged in docs/AUTOPILOT-LOG.md, POS-LIVE-FLOW-SPEC.md order of work, step 3 onward):
//   - IC + company code sign-in (only email + password here; the HR app's own sign-in screen has both);
//   - "remember this till" / staying signed in across visits beyond what Firebase Auth already does by default;
//   - a picker for someone who belongs to more than one company (the first company found is used);
//   - the "N sales waiting" offline banner (Firestore's own offline queue is doing the work underneath already -
//     see pos/hosts/firestore-host.js - this is a UI gap, not a sync one);
//   - the "Start POS trial" dialog itself (that belongs in the HR app's dashboard, not here); until a company
//     starts it, this screen just says so.
// This is PRACTICE MODE (no functions/pos-cafe.js deployed yet): see pos/hosts/firestore-host.js's own header for
// what that means and why every screen must say so.
(function () {
  'use strict';
  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

  function ApiError(kind, message) { var e = new Error(message); e.name = 'ApiError'; e.kind = kind; return e; }

  var ROUTES = {
    getProducts: 'getProducts_', getDailySummary: 'getDailySummary_', getSale: 'getSale_',
    createSale: 'createSale_', voidSale: 'voidSale_', saveProduct: 'saveProduct_',
    logWaste: 'logWaste_', reverseWaste: 'reverseWaste_', getWaste: 'getWaste_', stockAdjust: 'stockAdjust_',
    receivePurchase: 'receivePurchase_', reversePurchase: 'reversePurchase_', getPurchases: 'getPurchases_',
    saveRecipe: 'saveRecipe_', getRecipes: 'getRecipes_',
    openContainer: 'openContainer_', finishContainer: 'finishContainer_', discardContainer: 'discardContainer_', getContainers: 'getContainers_',
    stockCount: 'stockCount_', getStockReport: 'getStockReport_', getUsageReport: 'getUsageReport_'
  };

  function call(action, data) {
    var fnName = ROUTES[action];
    if (!fnName) return Promise.reject(ApiError('server', 'Unknown action'));
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(window[fnName](data || {})); }
        catch (err) {
          if (err && err.userError) reject(ApiError('server', err.message));
          else reject(ApiError('server', 'Something went wrong. Nothing was saved twice; try again.'));
        }
      }, 60); // a little slower than the demo's: this really is going to a server (Firestore), not just memory
    });
  }

  function withDevice(data, action) { var d = {}; for (var k in data) d[k] = data[k]; d.device_id = 'till-' + deviceId(); return call(action, d); }
  function deviceId() {
    try { var k = 'allurus_pos_device'; var v = window.localStorage.getItem(k); if (!v) { v = window.PosHost.uuid().slice(0, 8); window.localStorage.setItem(k, v); } return v; }
    catch (e) { return 'web'; }
  }
  function newSaleId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  window.PosApi = {
    newSaleId: newSaleId,
    getProducts: function (includeInactive) { return call('getProducts', { includeInactive: !!includeInactive }); },
    createSale: function (sale) { var d = {}; for (var k in sale) d[k] = sale[k]; d.device_id = 'till-' + deviceId(); return call('createSale', d); },
    getSale: function (saleId) { return call('getSale', { sale_id: saleId }); },
    voidSale: function (saleId, reason, made) { return call('voidSale', { sale_id: saleId, reason: reason, made: made === true }); },
    getDailySummary: function (date) { return call('getDailySummary', date ? { date: date } : {}); },
    saveProduct: function (product) { return withDevice(product, 'saveProduct'); },
    logWaste: function (entry) { return withDevice(entry, 'logWaste'); },
    reverseWaste: function (wasteId, reason, staffName) { return withDevice({ waste_id: wasteId, reason: reason, staff_name: staffName }, 'reverseWaste'); },
    getWaste: function (dateFrom, dateTo) { return call('getWaste', { date_from: dateFrom || '', date_to: dateTo || '' }); },
    stockAdjust: function (move) { return withDevice(move, 'stockAdjust'); },
    receivePurchase: function (delivery) { return withDevice(delivery, 'receivePurchase'); },
    reversePurchase: function (purchaseId, reason, staffName) { return withDevice({ purchase_id: purchaseId, reason: reason, staff_name: staffName }, 'reversePurchase'); },
    getPurchases: function (dateFrom, dateTo) { return call('getPurchases', { date_from: dateFrom || '', date_to: dateTo || '' }); },
    getRecipes: function () { return call('getRecipes', {}); },
    saveRecipe: function (menuProductId, lines) { return call('saveRecipe', { menu_product_id: menuProductId, lines: lines }); },
    openContainer: function (open) { return withDevice(open, 'openContainer'); },
    finishContainer: function (containerId, staffName) { return withDevice({ container_id: containerId, staff_name: staffName }, 'finishContainer'); },
    discardContainer: function (containerId, reason, remaining, note, staffName) {
      return withDevice({ container_id: containerId, reason: reason, remaining_estimate: remaining, note: note, staff_name: staffName }, 'discardContainer');
    },
    getContainers: function (dateFrom, dateTo) { return call('getContainers', { date_from: dateFrom || '', date_to: dateTo || '' }); },
    stockCount: function (count) { return withDevice(count, 'stockCount'); },
    getStockReport: function () { return call('getStockReport', {}); },
    getUsageReport: function (dateFrom, dateTo) { return call('getUsageReport', { date_from: dateFrom || '', date_to: dateTo || '' }); }
  };

  // ---------- the gate: sign in, find the company and its POS status, then start app.js ----------

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function screen(html) {
    // The first call can land before <body> exists: a cached dynamic import() can resolve fast enough that this
    // runs before the HTML parser reaches <body> (see pos/api-cloud.js's header; the same hazard demo/demo-ui.js
    // avoids the same way).
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { screen(html); }); return; }
    var el = document.getElementById('posGate');
    if (!el) { el = document.createElement('div'); el.id = 'posGate'; el.className = 'modal'; el.style.position = 'fixed'; document.body.appendChild(el); }
    el.innerHTML = '<div class="sheet" style="max-width:420px">' + html + '</div>';
  }

  function startApp(auth, Auth) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { startApp(auth, Auth); }); return; }
    var el = document.getElementById('posGate');
    if (el) el.remove();
    window.POS_PRACTICE_MODE = true; // app.js's demoWatermark() check; see app.js

    var bar = document.createElement('div');
    bar.className = 'demo-banner no-print';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>Practice mode: real company, but sales aren’t checked by a server yet. Not for real trading.</span>' +
      '<span class="demo-banner-actions"><button type="button" id="practiceSignOut" class="ghost">Sign out</button></span>';
    document.body.insertBefore(bar, document.body.firstChild);
    document.getElementById('practiceSignOut').addEventListener('click', function () { Auth.signOut(auth); location.reload(); });

    var s = document.createElement('script');
    s.src = 'app.js?v=11';
    document.body.appendChild(s);
  }

  function signInForm(auth, Auth, onError) {
    screen(
      '<h2>Sign in to Allurus</h2>' +
      '<p class="muted">Use your usual Allurus email and password.</p>' +
      (onError ? '<p class="err">' + esc(onError) + '</p>' : '') +
      '<label>Email<input id="gateEmail" type="email" autocomplete="username"></label>' +
      '<label>Password<input id="gatePassword" type="password" autocomplete="current-password"></label>' +
      '<div class="actions"><button id="gateSignIn" class="primary" style="grid-column:1/-1">Sign in</button></div>'
    );
    document.getElementById('gateSignIn').onclick = function () {
      var email = document.getElementById('gateEmail').value.trim();
      var password = document.getElementById('gatePassword').value;
      Auth.signInWithEmailAndPassword(auth, email, password).catch(function (e) {
        signInForm(auth, Auth, e && e.code === 'auth/invalid-credential' ? 'That email and password don’t match an Allurus account.' : 'Something went wrong. Try again.');
      });
    };
  }

  Promise.all([import(SDK + '/firebase-app.js'), import(SDK + '/firebase-auth.js'), import(SDK + '/firebase-firestore.js')]).then(function (mods) {
    var AppMod = mods[0], Auth = mods[1], FS = mods[2];
    if (!window.ALLURUS_FIREBASE) { screen('<h2>Can’t reach Allurus</h2><p>/js/firebase-config.js didn’t load.</p>'); return; }
    var app = (AppMod.getApps && AppMod.getApps()[0]) || AppMod.initializeApp(window.ALLURUS_FIREBASE);
    var auth = Auth.getAuth(app);
    var db;
    try { db = FS.initializeFirestore(app, { localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() }) }); }
    catch (e) { db = FS.getFirestore(app); }

    Auth.onAuthStateChanged(auth, function (user) {
      if (!user) { signInForm(auth, Auth); return; }
      screen('<h2>Loading your till…</h2>');
      FS.getDoc(FS.doc(db, 'users', user.uid)).then(function (userSnap) {
        if (!userSnap.exists()) { screen('<h2>No Allurus profile</h2><p>This sign-in isn’t linked to a company yet. Ask your admin.</p>'); return; }
        var profile = userSnap.data();
        var tenantId = profile.tenantId;
        var posRole = profile.posRole || '';
        if (!posRole) { screen('<h2>You don’t have POS access</h2><p>Ask your admin to give you a POS role in Team access.</p><div class="actions"><button id="gateOut" class="ghost" style="grid-column:1/-1">Sign out</button></div>'); wireSignOut(auth, Auth); return; }
        FS.getDoc(FS.doc(db, 'tenants', tenantId)).then(function (tSnap) {
          var addons = (tSnap.exists() && tSnap.data().addons) || {};
          var pos = addons.pos || {};
          var trialEndsAt = pos.trialEndsAt && pos.trialEndsAt.toMillis ? pos.trialEndsAt.toMillis() : null;
          var on = pos.status === 'active' || (pos.status === 'trial' && trialEndsAt && trialEndsAt > Date.now());
          if (!on) {
            screen('<h2>POS isn’t on for your company</h2><p>Ask an Owner or Settings admin to start the POS trial from the Allurus dashboard.</p>' +
              '<div class="actions"><a class="btn primary" href="/app" style="grid-column:1/-1;text-align:center">Open Allurus</a></div><div class="actions"><button id="gateOut" class="ghost" style="grid-column:1/-1">Sign out</button></div>');
            wireSignOut(auth, Auth);
            return;
          }
          screen('<h2>Connecting…</h2>');
          window.AllurusPosCloud.connect(tenantId).then(function () { startApp(auth, Auth); });
        });
      }).catch(function () { screen('<h2>Couldn’t load your profile</h2><p>Check your connection and reload.</p>'); });
    });
  });

  function wireSignOut(auth, Auth) {
    var btn = document.getElementById('gateOut');
    if (btn) btn.onclick = function () { Auth.signOut(auth); };
  }
})();
