// Every backend call lives here. app.js never touches the URL.
// When moving to Supabase, replace this file (same function names, same shapes) and nothing else in the UI.
//
// Each function returns a Promise that resolves with the data, or rejects with an ApiError:
//   err.kind = 'network'  request may or may not have reached the server (timeout, offline). Safe to retry
//                         createSale with the SAME sale_id.
//   err.kind = 'server'   the server answered with { ok: false, error }. err.message is safe to show.
//   err.kind = 'auth'     signed out (err.code 'SIGNED_OUT'), must change PIN first (err.code 'CHANGE_PIN') or must open the
//                         register first (err.code 'OPENING_REQUIRED': a cashier or supervisor before counting the opening cash).
//                         PosApi.onAuth(err) is called too, so the app can show the sign-in screen.
// Every call carries the staff session token from login(); it lives in memory and sessionStorage (this tab only).
(function () {
  var cfg = window.POS_CONFIG || {};
  var session = null;
  try { session = JSON.parse(sessionStorage.getItem('pos.session') || 'null'); } catch (e) { session = null; }
  function keepSession(s) {
    session = s;
    try { if (s) sessionStorage.setItem('pos.session', JSON.stringify(s)); else sessionStorage.removeItem('pos.session'); } catch (e) { /* private mode */ }
  }

  function ApiError(kind, message) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.kind = kind;
    return e;
  }

  function call(action, data) {
    if (!cfg.API_URL || cfg.API_URL.indexOf('PASTE_') >= 0) {
      return Promise.reject(ApiError('server', 'Set API_URL and SECRET_KEY in config.js'));
    }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, cfg.TIMEOUT_MS || 20000);
    return fetch(cfg.API_URL, {
      method: 'POST',
      // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script can't answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: cfg.SECRET_KEY, action: action, data: data || {}, token: session ? session.token : '' }),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var body;
        try { body = JSON.parse(text); } catch (e) { throw ApiError('network', 'Unexpected reply from the server'); }
        if (!body.ok) {
          var m = /^(SIGNED_OUT|CHANGE_PIN|OPENING_REQUIRED): (.*)$/.exec(body.error || '');
          if (m) {
            var e = ApiError('auth', m[2]);
            e.code = m[1];
            if (m[1] === 'SIGNED_OUT') keepSession(null);
            if (window.PosApi.onAuth) window.PosApi.onAuth(e);
            throw e;
          }
          throw ApiError('server', body.error || 'Something went wrong');
        }
        return body.data;
      });
    }, function () {
      throw ApiError('network', navigator.onLine === false ? 'No internet connection' : 'No reply from the server');
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function newSaleId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  window.PosApi = {
    newSaleId: newSaleId,
    onAuth: null, // set by app.js

    // ---- staff session ----
    session: function () { return session; },
    login: function (empId, pin) {
      return call('login', { emp_id: empId, pin: pin, device_id: cfg.DEVICE_ID || '' }).then(function (s) { keepSession(s); return s; });
    },
    logout: function () {
      var had = session;
      var done = function () { keepSession(null); };
      return had ? call('logout', {}).then(done, done) : Promise.resolve(done());
    },
    whoami: function () { return call('whoami', {}); },
    changePin: function (oldPin, newPin) {
      return call('changePin', { old_pin: oldPin, new_pin: newPin }).then(function () {
        if (session) { session.must_change_pin = false; keepSession(session); }
      });
    },
    // A receipt number (R000012) → the sale, for "Void a bill".
    findSale: function (receiptNo) { return call('findSale', { receipt_no: receiptNo }); },
    getVoidLog: function (filters) { return call('getVoidLog', filters || {}); },

    // ---- staff management (admin) ----
    listStaff: function (sync) { return call('listStaff', { sync: !!sync }); },
    hrSearch: function (q) { return call('hrSearch', { q: q }); },
    addStaff: function (empId, role, pin) { return call('addStaff', { emp_id: empId, role: role, pin: pin, must_change_pin: true }); },
    // change: { role?, status?: 'active'|'disabled', reset_pin? }
    updateStaff: function (empId, change) { var d = { emp_id: empId }; for (var k in change) d[k] = change[k]; return call('updateStaff', d); },
    getAuditLog: function (type, dateFrom, dateTo) { return call('getAuditLog', { type: type, date_from: dateFrom || '', date_to: dateTo || '' }); },

    // Active products only, unless includeInactive (product management screen).
    getProducts: function (includeInactive) { return call('getProducts', { includeInactive: !!includeInactive }); },

    // sale: { sale_id, items: [{ product_id, qty, note }], discount: { type: 'rm'|'pct', value },
    //         payment_method: 'cash'|'duitnow_qr'|'card'|'ewallet', order_type: 'dine_in'|'takeaway', table_no }
    // Resolves with the saved sale (server totals, receipt_no, items, warnings, duplicate).
    createSale: function (sale) {
      var d = {};
      for (var k in sale) d[k] = sale[k];
      d.device_id = cfg.DEVICE_ID || '';
      return call('createSale', d);
    },

    getSale: function (saleId) { return call('getSale', { sale_id: saleId }); },

    // v: { reason (key), note, made, approver_id, approver_pin }. A supervisor's own ID + PIN approves this one void.
    // made: true = already made (usage stays, logged as dish waste); false = put the usage back.
    voidSale: function (saleId, v) {
      return call('voidSale', { sale_id: saleId, reason: v.reason, note: v.note || '', made: v.made === true, approver_id: v.approver_id,
        approver_pin: v.approver_pin, device_id: cfg.DEVICE_ID || '' });
    },

    // date: 'YYYY-MM-DD' in Malaysia time; omit for today.
    getDailySummary: function (date) { return call('getDailySummary', date ? { date: date } : {}); },

    // Closing the day. getClosing(date?) only reads: the tally for the role (a cashier: their own sales), the opening cash and the
    // cash that should be in the drawer (opening + cash sales). closeDay records it: { close_id (newSaleId(), reused on a retry),
    // date, denoms ({ "<sen>": count } of notes and coins; the server adds them up), note, approver_id, approver_pin }.
    // The day closes only when the count equals opening + cash sales. Otherwise it is a surplus or shortage: a note and a
    // supervisor's own ID + PIN are needed (another supervisor when a supervisor is closing). An admin closes without counting.
    getClosing: function (date) { return call('getClosing', date ? { date: date } : {}); },
    closeDay: function (c) { return call('closeDay', c); },
    getClosings: function () { return call('getClosings', {}); },
    // The stock checklist (supervisor, admin) and the transaction list (admin) are read apart from the tally so the tally opens fast.
    getClosingStock: function () { return call('getClosingStock', {}); },
    getClosingDetail: function (date) { return call('getClosingDetail', date ? { date: date } : {}); },
    // Opening cash (the float) for today, cashier or supervisor: openId from newSaleId() (reused on a retry), denoms = { "<sen>": count }
    // of notes and coins, note (needed when it is changed the same day). Resolves with the closing tally.
    setOpening: function (openId, denoms, note) { return call('setOpening', { open_id: openId, denoms: denoms, note: note || '' }); },
    // Ticks (done: true = bought or handled) or unticks a stock checklist item. Resolves with { list }.
    setShopItem: function (productId, done) { return call('setShopItem', { product_id: productId, done: !!done }); },

    // product: { id?, name, price (RM), category, active, unit, cost (RM per unit, '' = unknown), kind: 'menu'|'ingredient',
    //            track_stock, stock (starting stock; only used when the product is new or starts being tracked) }
    saveProduct: function (product) { return withDevice(product, 'saveProduct'); },

    // entry: { waste_id (newSaleId()), items: [{ product_id, qty, reason, note }], staff_name }
    // Resolves with { waste_id, lines (server cost), duplicate, warnings }. Same waste_id again = the saved entry.
    logWaste: function (entry) { return withDevice(entry, 'logWaste'); },

    reverseWaste: function (wasteId, reason, staffName) {
      return withDevice({ waste_id: wasteId, reason: reason, staff_name: staffName }, 'reverseWaste');
    },

    // dates 'YYYY-MM-DD' (Malaysia time); omit both for today.
    getWaste: function (dateFrom, dateTo) { return call('getWaste', { date_from: dateFrom || '', date_to: dateTo || '' }); },

    // move: { movement_id (newSaleId()), product_id, change_qty, reason_type: 'stock_in'|'adjustment', note, staff_name }
    stockAdjust: function (move) { return withDevice(move, 'stockAdjust'); },

    // ---- inventory ledger (INVENTORY-LEDGER-SPEC.md). Ids come from newSaleId() and are reused on every retry. ----

    // delivery: { purchase_id, supplier, invoice_no, received_by, lines: [{ ingredient_id, pack_qty, pack_cost, batch_no, expiry_date }] }
    receivePurchase: function (delivery) { return withDevice(delivery, 'receivePurchase'); },
    reversePurchase: function (purchaseId, reason, staffName) {
      return withDevice({ purchase_id: purchaseId, reason: reason, staff_name: staffName }, 'reversePurchase');
    },
    getPurchases: function (dateFrom, dateTo) { return call('getPurchases', { date_from: dateFrom || '', date_to: dateTo || '' }); },

    // Every menu item with its recipe lines, cost, margin and what a sale deducts.
    getRecipes: function () { return call('getRecipes', {}); },
    // Replaces one menu item's recipe. lines: [{ ingredient_id, qty (per serving, ingredient's unit), note }]
    saveRecipe: function (menuProductId, lines) { return call('saveRecipe', { menu_product_id: menuProductId, lines: lines }); },

    // open: { container_id, ingredient_id, station, reason?, note?, staff_name }. May resolve with { needs_reason, message, open }
    // instead of opening: show the message, ask for a reason, then call again with the same container_id.
    openContainer: function (open) { return withDevice(open, 'openContainer'); },
    finishContainer: function (containerId, staffName) { return withDevice({ container_id: containerId, staff_name: staffName }, 'finishContainer'); },
    // remaining: '50%' or a quantity in the ingredient's unit
    discardContainer: function (containerId, reason, remaining, note, staffName) {
      return withDevice({ container_id: containerId, reason: reason, remaining_estimate: remaining, note: note, staff_name: staffName }, 'discardContainer');
    },
    getContainers: function (dateFrom, dateTo) { return call('getContainers', { date_from: dateFrom || '', date_to: dateTo || '' }); },

    // count: { count_id, counted_by, lines: [{ ingredient_id, counted_qty } | { ingredient_id, sealed_packs, open: ['50%'] }, note] }
    stockCount: function (count) { return withDevice(count, 'stockCount'); },

    getStockReport: function () { return call('getStockReport', {}); },
    getUsageReport: function (dateFrom, dateTo) { return call('getUsageReport', { date_from: dateFrom || '', date_to: dateTo || '' }); }
  };

  function withDevice(data, action) {
    var d = {};
    for (var k in data) d[k] = data[k];
    d.device_id = cfg.DEVICE_ID || '';
    return call(action, d);
  }
})();
