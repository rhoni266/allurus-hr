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

    voidSale: function (saleId, reason) { return call('voidSale', { sale_id: saleId, reason: reason }); },

    // date: 'YYYY-MM-DD' in Malaysia time; omit for today.
    getDailySummary: function (date) { return call('getDailySummary', date ? { date: date } : {}); },

    // product: { id?, name, price (RM), stock ('' = not tracked), category, active }
    saveProduct: function (product) { return call('saveProduct', product); }
  };
})();
