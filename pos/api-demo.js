// The demo backend: same shape as api.js (every function, same { ok, data } / { ok, error } answers, built from
// the same pos-core.js business logic — see shared/pos-core.js), but it never leaves this browser tab. Load order
// matters: demo/local-host.js, then shared/pos-core.js, then demo/seed.js, then this file, before app.js.
//
// A small delay (150-300ms) is added to every call so the till feels like it's really talking to a server, which is
// what the rest of the app (saving states, disabled buttons while a call is in flight) expects.
(function () {
  'use strict';
  var cfg = window.POS_CONFIG || {};

  function ApiError(kind, message) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.kind = kind;
    return e;
  }

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
    var delay = 150 + Math.random() * 150;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var fn = window[fnName];
          resolve(fn(data || {}));
        } catch (err) {
          if (err && err.userError) reject(ApiError('server', err.message));
          else reject(ApiError('server', 'Something went wrong in the demo. Nothing was saved twice; try again.'));
        }
      }, delay);
    });
  }

  function newSaleId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function withDevice(data, action) {
    var d = {};
    for (var k in data) d[k] = data[k];
    d.device_id = cfg.DEVICE_ID || '';
    return call(action, d);
  }

  // Same surface as window.PosApi in api.js; see that file for what each function's data/return shape means.
  window.PosApi = {
    newSaleId: newSaleId,
    getProducts: function (includeInactive) { return call('getProducts', { includeInactive: !!includeInactive }); },
    createSale: function (sale) {
      var d = {};
      for (var k in sale) d[k] = sale[k];
      d.device_id = cfg.DEVICE_ID || '';
      return call('createSale', d);
    },
    getSale: function (saleId) { return call('getSale', { sale_id: saleId }); },
    voidSale: function (saleId, reason, made) { return call('voidSale', { sale_id: saleId, reason: reason, made: made === true }); },
    getDailySummary: function (date) { return call('getDailySummary', date ? { date: date } : {}); },
    saveProduct: function (product) { return withDevice(product, 'saveProduct'); },
    logWaste: function (entry) { return withDevice(entry, 'logWaste'); },
    reverseWaste: function (wasteId, reason, staffName) {
      return withDevice({ waste_id: wasteId, reason: reason, staff_name: staffName }, 'reverseWaste');
    },
    getWaste: function (dateFrom, dateTo) { return call('getWaste', { date_from: dateFrom || '', date_to: dateTo || '' }); },
    stockAdjust: function (move) { return withDevice(move, 'stockAdjust'); },
    receivePurchase: function (delivery) { return withDevice(delivery, 'receivePurchase'); },
    reversePurchase: function (purchaseId, reason, staffName) {
      return withDevice({ purchase_id: purchaseId, reason: reason, staff_name: staffName }, 'reversePurchase');
    },
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
})();
