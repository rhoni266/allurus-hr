// Cafe POS, live for a signed-in company (POS-LIVE-APPSCRIPT-SPEC.md). Same window.PosApi surface as api.js and
// api-demo.js, so app.js doesn't know which backend it's talking to - but every call here goes to the central
// Allurus POS Server (one Apps Script web app, pos/apps-script-server/), POSTing { idToken, tenantId, action,
// data } as text/plain (no CORS preflight, same trick api.js already uses). A fresh ID token is fetched right
// before each call (Firebase refreshes it under the hood), never cached here - the server is what decides who
// may do what (pos/apps-script-server/Router.gs), using that same token to read Firestore as the caller.
//
// Nothing in this file ever sees or stores a password or PIN. API_URL is public (window.ALLURUS_POS_SERVER, see
// js/firebase-config.js's neighbour) - it's not a secret, because every call needs a valid Allurus sign-in.
//
// NOT YET BUILT (logged in docs/AUTOPILOT-LOG.md, POS-LIVE-APPSCRIPT-SPEC.md order of work):
//   - IC + company code sign-in (only email + password here);
//   - "remember this till" beyond what Firebase Auth already does by default;
//   - a picker for someone who belongs to more than one company (the first company found is used);
//   - the "N sales waiting" offline banner (the retry-with-the-same-sale_id queue below does the work; this is a
//     missing readout, not a missing capability).
(function () {
  'use strict';

  function ApiError(kind, message) { var e = new Error(message); e.name = 'ApiError'; e.kind = kind; return e; }

  var tenantId = null;
  var getIdToken = null; // set once signed in: () => Promise<string>

  function call(action, data) {
    var API_URL = window.ALLURUS_POS_SERVER;
    if (!API_URL) return Promise.reject(ApiError('server', 'POS server not configured (js/firebase-config.js).'));
    if (!tenantId || !getIdToken) return Promise.reject(ApiError('server', 'Not signed in yet.'));
    return getIdToken().then(function (idToken) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 20000);
      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // stays a "simple" request: no preflight
        body: JSON.stringify({ idToken: idToken, tenantId: tenantId, action: action, data: data || {} }),
        redirect: 'follow', signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        return res.text().then(function (text) {
          var body;
          try { body = JSON.parse(text); } catch (e) { throw ApiError('network', 'Unexpected reply from the server'); }
          if (!body.ok) throw ApiError('server', body.error || 'Something went wrong');
          return body.data;
        });
      }, function () {
        throw ApiError('network', navigator.onLine === false ? 'No internet connection' : 'No reply from the server');
      }).finally(function () { if (timer) clearTimeout(timer); });
    });
  }

  function withDevice(data, action) { var d = {}; for (var k in data) d[k] = data[k]; d.device_id = deviceId(); return call(action, d); }
  function deviceId() {
    try { var k = 'allurus_pos_device'; var v = window.localStorage.getItem(k); if (!v) { v = newSaleId().slice(0, 8); window.localStorage.setItem(k, v); } return v; }
    catch (e) { return 'web'; }
  }
  function newSaleId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // Called once, by api-live.js's own sign-in gate below, after a signed-in person's company and POS role check
  // out. Everything above this line works the same regardless of how that happened.
  function connect(theTenantId, idTokenGetter) { tenantId = theTenantId; getIdToken = idTokenGetter; }

  window.PosApi = {
    newSaleId: newSaleId,
    getProducts: function (includeInactive) { return call('getProducts', { includeInactive: !!includeInactive }); },
    createSale: function (sale) { var d = {}; for (var k in sale) d[k] = sale[k]; d.device_id = deviceId(); return call('createSale', d); },
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
    getUsageReport: function (dateFrom, dateTo) { return call('getUsageReport', { date_from: dateFrom || '', date_to: dateTo || '' }); },
    removeSampleMenu: function () { return call('removeSampleMenu', {}); }
  };

  // ---------- the gate: sign in, find the company and its POS status, then start app.js ----------

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function screen(html) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { screen(html); }); return; }
    var el = document.getElementById('posGate');
    if (!el) { el = document.createElement('div'); el.id = 'posGate'; el.className = 'modal'; el.style.position = 'fixed'; document.body.appendChild(el); }
    el.innerHTML = '<div class="sheet" style="max-width:420px">' + html + '</div>';
  }

  function startApp() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', startApp); return; }
    var el = document.getElementById('posGate');
    if (el) el.remove();
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
  function wireSignOut(auth, Auth) { var btn = document.getElementById('gateOut'); if (btn) btn.onclick = function () { Auth.signOut(auth); }; }

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
  Promise.all([import(SDK + '/firebase-app.js'), import(SDK + '/firebase-auth.js'), import(SDK + '/firebase-firestore.js')]).then(function (mods) {
    var AppMod = mods[0], Auth = mods[1], FS = mods[2];
    if (!window.ALLURUS_FIREBASE) { screen('<h2>Can’t reach Allurus</h2><p>/js/firebase-config.js didn’t load.</p>'); return; }
    var app = (AppMod.getApps && AppMod.getApps()[0]) || AppMod.initializeApp(window.ALLURUS_FIREBASE);
    var auth = Auth.getAuth(app);
    var db = FS.getFirestore(app); // read-only lookups here (profile, company); every POS write goes through api-live.js's own call()

    Auth.onAuthStateChanged(auth, function (user) {
      if (!user) { signInForm(auth, Auth); return; }
      screen('<h2>Loading your till…</h2>');
      FS.getDoc(FS.doc(db, 'users', user.uid)).then(function (userSnap) {
        if (!userSnap.exists()) { screen('<h2>No Allurus profile</h2><p>This sign-in isn’t linked to a company yet. Ask your admin.</p>'); return; }
        var profile = userSnap.data();
        var tid = profile.tenantId;
        var posRole = profile.posRole || '';
        if (!posRole) { screen('<h2>You don’t have POS access</h2><p>Ask your admin to give you a POS role in Team access.</p><div class="actions"><button id="gateOut" class="ghost" style="grid-column:1/-1">Sign out</button></div>'); wireSignOut(auth, Auth); return; }
        FS.getDoc(FS.doc(db, 'tenants', tid)).then(function (tSnap) {
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
          connect(tid, function () { return user.getIdToken(); });
          startApp();
        });
      }).catch(function () { screen('<h2>Couldn’t load your profile</h2><p>Check your connection and reload.</p>'); });
    });
  });
})();
