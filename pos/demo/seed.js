// Cafe POS demo: "Kopi Demo", a fictional cafe. Fills the empty localStorage store (see demo/local-host.js) by
// calling the real business functions in shared/pos-core.js — saveProduct_, saveRecipe_, createSale_, logWaste_,
// receivePurchase_, openContainer_ — so every number the demo shows (totals, stock, receipt numbers, dish cost,
// waste cost) is exactly what the real backend would have computed, never hand-typed.
//
// Deterministic: a fixed random seed picks the same items, quantities and payment methods for every visitor, every
// time. Only the dates move, anchored to today (Asia/Kuala_Lumpur), so "today" and "the last 7 days" always mean
// today. Must load after demo/local-host.js and shared/pos-core.js, and before pos/api-demo.js runs its first call.
(function () {
  'use strict';
  if (!window.PosDemoStore || !window.PosDemoStore.isEmpty()) return; // already seeded, or not in demo mode

  // ---- deterministic PRNG (mulberry32), fixed seed ----
  var seed = 0xC0FFEE;
  function rand() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function int(min, max) { return min + Math.floor(rand() * (max - min + 1)); }

  function withDate(iso, fn) {
    var real = window.PosHost.now;
    window.PosHost.now = function () { return iso + 'T' + ('0' + int(7, 20)).slice(-2) + ':' + ('0' + int(0, 59)).slice(-2) + ':00+08:00'; };
    try { return fn(); } finally { window.PosHost.now = real; }
  }

  function isoDaysAgo(n) {
    var d = new Date(Date.now() - n * 86400000);
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).formatToParts(d);
    var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
    return g('year') + '-' + g('month') + '-' + g('day');
  }

  function uid(prefix) { return prefix + '-' + window.PosHost.uuid(); }

  // ---- demo settings: SST 0% by default, 10% service charge on dine-in, like the spec's sample cafe ----
  window.PosDemoStore.setMeta({ sstPercent: 0, servicePercent: 10, lowStock: 5, countVariancePercent: 5 });

  // ---- ingredients (3 start at or below their reorder level, on purpose, so Stock shows them as low) ----
  var ingredients = [
    { name: 'Coffee beans', unit: 'g', cost: 0.09, stock: 2600, pack_size: 1000, pack_unit: 'bag', reorder_level: 1000, open_shelf_life_days: 21, track_open: true },
    { name: 'Fresh milk', unit: 'ml', cost: 0.007, stock: 7200, pack_size: 1000, pack_unit: 'carton', reorder_level: 3000, open_shelf_life_days: 4, track_open: true },
    { name: 'Oat milk', unit: 'ml', cost: 0.012, stock: 1400, pack_size: 1000, pack_unit: 'carton', reorder_level: 2000, open_shelf_life_days: 5, track_open: true }, // low
    { name: 'Gula Melaka syrup', unit: 'ml', cost: 0.018, stock: 2100, pack_size: 750, pack_unit: 'bottle', reorder_level: 750, open_shelf_life_days: 60, track_open: true },
    { name: 'Vanilla syrup', unit: 'ml', cost: 0.021, stock: 540, pack_size: 750, pack_unit: 'bottle', reorder_level: 750, open_shelf_life_days: 60, track_open: true }, // low
    { name: 'Tea leaves', unit: 'g', cost: 0.05, stock: 1800, pack_size: 500, pack_unit: 'pack', reorder_level: 500, open_shelf_life_days: 180, track_open: false },
    { name: 'Condensed milk', unit: 'ml', cost: 0.009, stock: 1900, pack_size: 390, pack_unit: 'can', reorder_level: 390, open_shelf_life_days: 10, track_open: true },
    { name: 'Croissant dough (frozen)', unit: 'pcs', cost: 2.10, stock: 36, pack_size: 12, pack_unit: 'box', reorder_level: 12, open_shelf_life_days: '', track_open: false },
    { name: 'Sourdough bread', unit: 'pcs', cost: 3.40, stock: 18, pack_size: 6, pack_unit: 'bag', reorder_level: 6, open_shelf_life_days: '', track_open: false },
    { name: 'Chicken breast (cooked)', unit: 'g', cost: 0.028, stock: 3000, pack_size: 1000, pack_unit: 'pack', reorder_level: 1000, open_shelf_life_days: 3, track_open: false },
    { name: 'Cheddar cheese slice', unit: 'pcs', cost: 0.45, stock: 80, pack_size: 20, pack_unit: 'pack', reorder_level: 20, open_shelf_life_days: '', track_open: false },
    { name: 'Eggs', unit: 'pcs', cost: 0.55, stock: 60, pack_size: 30, pack_unit: 'tray', reorder_level: 30, open_shelf_life_days: '', track_open: false },
    { name: 'Chocolate sauce', unit: 'ml', cost: 0.016, stock: 620, pack_size: 1000, pack_unit: 'bottle', reorder_level: 300, open_shelf_life_days: 90, track_open: false },
    { name: 'Whipped cream', unit: 'ml', cost: 0.011, stock: 240, pack_size: 500, pack_unit: 'can', reorder_level: 250, open_shelf_life_days: 7, track_open: true }, // low (3rd)
    { name: 'Takeaway cups (16oz)', unit: 'pcs', cost: 0.28, stock: 240, pack_size: 50, pack_unit: 'sleeve', reorder_level: 50, open_shelf_life_days: '', track_open: false }
  ];
  var ing = {}; // name -> saved product
  ingredients.forEach(function (x) {
    ing[x.name] = window.saveProduct_({
      name: x.name, price: 0, category: 'Ingredient', unit: x.unit, cost: x.cost, kind: 'ingredient', track_stock: true,
      stock: x.stock, pack_size: x.pack_size, pack_unit: x.pack_unit, reorder_level: x.reorder_level,
      open_shelf_life_days: x.open_shelf_life_days, max_open_containers: 1, track_open: x.track_open, staff_name: 'seed'
    });
  });

  // ---- menu: 23 items across 5 categories. Drinks, sandwiches and bakes deduct ingredients through a recipe
  // (dishCost_ then has a cost to show); cakes and add-ons with no recipe show "No recipe: stock not tracked",
  // which is the real app's own warning, not a seeding gap. None of these track their own stock. ----
  var menu = [
    ['Americano', 7.90, 'Coffee', 'cup'], ['Café Latte', 10.90, 'Coffee', 'cup'], ['Cappuccino', 10.90, 'Coffee', 'cup'],
    ['Spanish Latte', 12.90, 'Coffee', 'cup'], ['Gula Melaka Latte', 13.50, 'Coffee', 'cup'], ['Oat Milk Latte', 13.90, 'Coffee', 'cup'],
    ['Piccolo', 8.50, 'Coffee', 'cup'], ['Cold Brew', 11.50, 'Coffee', 'cup'],
    ['Teh Tarik', 5.50, 'Tea', 'cup'], ['Teh O Ais Limau', 6.00, 'Tea', 'cup'], ['Earl Grey Tea', 7.50, 'Tea', 'cup'], ['Matcha Latte', 12.90, 'Tea', 'cup'],
    ['Chicken Sandwich', 15.90, 'Food', 'pcs'], ['Egg Mayo Sandwich', 12.90, 'Food', 'pcs'], ['Croissant (plain)', 7.50, 'Food', 'pcs'],
    ['Almond Croissant', 9.90, 'Food', 'pcs'], ['Avocado Toast', 16.90, 'Food', 'pcs'],
    ['Burnt Cheesecake', 13.90, 'Dessert', 'pcs'], ['Chocolate Brownie', 8.90, 'Dessert', 'pcs'], ['Banana Bread', 7.90, 'Dessert', 'pcs'],
    ['Extra Shot', 2.00, 'Add-ons', 'pcs'], ['Oat Milk Swap', 1.50, 'Add-ons', 'pcs'], ['Whipped Cream Top-up', 2.50, 'Add-ons', 'pcs']
  ];
  var item = {};
  menu.forEach(function (x) {
    item[x[0]] = window.saveProduct_({ name: x[0], price: x[1], category: x[2], unit: x[3], kind: 'menu', active: true, staff_name: 'seed' });
  });

  // ---- recipes: what each item actually deducts. Quantities per one serving. ----
  var recipes = {
    'Americano': [['Coffee beans', 18]],
    'Café Latte': [['Coffee beans', 18], ['Fresh milk', 180]],
    'Cappuccino': [['Coffee beans', 18], ['Fresh milk', 150]],
    'Spanish Latte': [['Coffee beans', 18], ['Fresh milk', 150], ['Condensed milk', 20]],
    'Gula Melaka Latte': [['Coffee beans', 18], ['Fresh milk', 150], ['Gula Melaka syrup', 25]],
    'Oat Milk Latte': [['Coffee beans', 18], ['Oat milk', 180]],
    'Piccolo': [['Coffee beans', 14], ['Fresh milk', 60]],
    'Cold Brew': [['Coffee beans', 22]],
    'Teh Tarik': [['Tea leaves', 6], ['Condensed milk', 30]],
    'Teh O Ais Limau': [['Tea leaves', 5]],
    'Earl Grey Tea': [['Tea leaves', 4]],
    'Matcha Latte': [['Fresh milk', 180]],
    'Chicken Sandwich': [['Chicken breast (cooked)', 90], ['Cheddar cheese slice', 1]],
    'Egg Mayo Sandwich': [['Eggs', 2]],
    'Croissant (plain)': [['Croissant dough (frozen)', 1]],
    'Almond Croissant': [['Croissant dough (frozen)', 1]],
    'Avocado Toast': [['Sourdough bread', 1], ['Eggs', 1]],
    'Chocolate Brownie': [['Chocolate sauce', 15]],
    'Extra Shot': [['Coffee beans', 9]],
    'Oat Milk Swap': [['Oat milk', 60]],
    'Whipped Cream Top-up': [['Whipped cream', 30]]
  };
  Object.keys(recipes).forEach(function (name) {
    window.saveRecipe_({ menu_product_id: item[name].id, lines: recipes[name].map(function (l) { return { ingredient_id: ing[l[0]].id, qty: l[1] }; }) });
  });

  // ---- one received delivery, so Stock > Receive and nearest-expiry both show something ----
  withDate(isoDaysAgo(2), function () {
    window.receivePurchase_({
      purchase_id: uid('seed-po'), supplier: 'Kedai Kopi Supplies Sdn Bhd', invoice_no: 'INV-10234', received_by: 'Afiq',
      device_id: 'till-1', lines: [
        { ingredient_id: ing['Coffee beans'].id, pack_qty: 2, pack_cost: 58, batch_no: 'CB-241', expiry_date: isoDaysAgo(-180) },
        { ingredient_id: ing['Fresh milk'].id, pack_qty: 6, pack_cost: 6.9, batch_no: 'FM-889', expiry_date: isoDaysAgo(-2) }
      ]
    });
  });

  // ---- one open container, so Stock > Containers shows something in use ----
  withDate(isoDaysAgo(0), function () {
    window.openContainer_({ container_id: uid('seed-oc'), ingredient_id: ing['Fresh milk'].id, station: 'bar', staff_name: 'Mia', device_id: 'till-1' });
  });

  // ---- sales: today and the last 7 days ----
  var drinkNames = Object.keys(item).filter(function (n) { return item[n].category !== 'Add-ons'; });
  var methods = ['cash', 'cash', 'cash', 'duitnow_qr', 'card', 'ewallet'];
  var staff = ['Mia', 'Afiq', 'Nadia', 'Hafiz'];
  for (var day = 7; day >= 0; day--) {
    var date = isoDaysAgo(day);
    var count = day === 0 ? int(9, 14) : int(14, 26); // today is still "in progress"
    for (var i = 0; i < count; i++) {
      var lines = [];
      var n = int(1, 3);
      for (var j = 0; j < n; j++) {
        var name = pick(drinkNames);
        lines.push({ product_id: item[name].id, qty: int(1, 2) });
      }
      var orderType = rand() < 0.45 ? 'dine_in' : 'takeaway';
      var discount = rand() < 0.08 ? { type: 'pct', value: 10 } : undefined;
      withDate(date, function () {
        window.createSale_({ sale_id: uid('seed-sale'), items: lines, payment_method: pick(methods), order_type: orderType,
          table_no: orderType === 'dine_in' ? String(int(1, 12)) : '', discount: discount, device_id: 'till-1' });
      });
    }
  }

  // ---- a few waste entries, spread over the last week ----
  var wasteLines = [
    { day: 1, name: 'Croissant (plain)', qty: 2, reason: 'overproduction' },
    { day: 3, name: 'Fresh milk', qty: 400, reason: 'expired' },
    { day: 4, name: 'Chicken Sandwich', qty: 1, reason: 'wrong_order' },
    { day: 6, name: 'Chocolate Brownie', qty: 1, reason: 'dropped' }
  ];
  wasteLines.forEach(function (w) {
    withDate(isoDaysAgo(w.day), function () {
      window.logWaste_({ waste_id: uid('seed-waste'), staff_name: pick(staff), device_id: 'till-1',
        items: [{ product_id: (item[w.name] || ing[w.name]).id, qty: w.qty, reason: w.reason, note: '' }] });
    });
  });
})();
