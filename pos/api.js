// Every backend call lives here. app.js never touches the URL.
// When moving to Supabase, replace this file (same function names, same shapes) and nothing else in the UI.
//
// Each function returns a Promise that resolves with the data, or rejects with an ApiError:
//   err.kind = 'network'  request may or may not have reached the server (timeout, offline). Safe to retry
//                         createSale with the SAME sale_id.
//   err.kind = 'server'   the server answered with { ok: false, error }. err.message is safe to show.
(function () {
  var cfg = window.POS_CONFIG || {};

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
      body: JSON.stringify({ key: cfg.SECRET_KEY, action: action, data: data || {} }),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
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
  }

  function newSaleId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  window.PosApi = {
    newSaleId: newSaleId,

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

    // made: true = the order was already made (usage stays and is logged as dish waste); false = put the usage back.
    voidSale: function (saleId, reason, made) { return call('voidSale', { sale_id: saleId, reason: reason, made: made === true }); },

    // date: 'YYYY-MM-DD' in Malaysia time; omit for today.
    getDailySummary: function (date) { return call('getDailySummary', date ? { date: date } : {}); },

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
