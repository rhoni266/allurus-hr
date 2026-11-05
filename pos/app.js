// UI only. All backend calls go through window.PosApi (api.js).
// Money is integer sen in here; RM x.xx on screen. The server recomputes every total; the numbers here are a preview.
(function () {
  'use strict';
  var cfg = window.POS_CONFIG || {};
  var api = window.PosApi;
  var $ = function (id) { return document.getElementById(id); };

  var METHODS = { cash: 'Cash', duitnow_qr: 'DuitNow QR', card: 'Card (terminal)', ewallet: 'E-wallet' };
  var TYPES = { takeaway: 'Takeaway', dine_in: 'Dine-in' };

  var state = {
    products: [], cat: 'All', query: '',
    cart: [], orderType: 'takeaway',
    pending: null, // { saleId, payload } while a save is unresolved: same sale_id on every retry
    saving: false, summary: null, allProducts: []
  };

  // ---------- helpers ----------

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sen(rm) { var n = Number(rm); return isFinite(n) ? Math.round(n * 100) : 0; }
  function rm(s) { var neg = s < 0; s = Math.abs(Math.round(s)); return (neg ? '-' : '') + (cfg.CURRENCY || 'RM') + ' ' + Math.floor(s / 100) + '.' + ('0' + (s % 100)).slice(-2); }
  function bp(pct) { var n = Number(pct || 0); return n > 0 ? Math.round(n * 100) : 0; }
  function applyBp(s, b) { return Math.round(s * b / 10000); }
  function roundCash(s) { return Math.round(s / 5) * 5; }
  function looksLikeCard(s) { return /\d{13,19}/.test(String(s || '').replace(/[ -]/g, '')); }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: cfg.TIMEZONE || 'Asia/Kuala_Lumpur' }).format(new Date()); }
  function dmy(iso) { var s = String(iso || ''); return s.length >= 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) + (s.length >= 16 ? ' ' + s.slice(11, 16) : '') : s; }
  function nowIso() {
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.TIMEZONE || 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    var g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
    return g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':' + g('minute');
  }
  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formulas
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }
  // ---- look-and-feel helpers (display only) ----
  var ICON = {
    cash: '<path d="M3 7h18v10H3z"/><circle cx="12" cy="12" r="2.5"/>', receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    box: '<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 8v8l9 5 9-5V8"/>', bin: '<path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    meal: '<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/>',
    pct: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>', check: '<path d="m5 12 5 5 9-10"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'; }
  function kpi(icon, value, caption, cls) {
    return '<span class="kpi' + (cls ? ' ' + cls : '') + '"><i>' + svg(icon) + '</i><b>' + value + '</b><small>' + esc(caption) + '</small></span>';
  }
  function setKpis(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  var tints = {};
  function tint(cat) { // categories take the four tints in the order they first appear, so neighbours differ
    if (!(cat in tints)) tints[cat] = 't' + (Object.keys(tints).length % 4);
    return tints[cat];
  }
  function announce(msg) { var l = $('live'); l.textContent = ''; setTimeout(function () { l.textContent = msg; }, 30); }

  function openModal(html) { $('sheet').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; $('sheet').innerHTML = ''; }
  function printHtml(html) { $('print').innerHTML = html; window.print(); }

  // ---------- totals (preview; mirrors Code.gs) ----------

  function totals(method) {
    var subtotal = state.cart.reduce(function (a, l) { return a + l.unit * l.qty; }, 0);
    var dv = $('disc').value.trim();
    var discount = 0;
    if ($('discType').value === 'pct') discount = applyBp(subtotal, Math.round(Math.min(Math.max(Number(dv) || 0, 0), 100) * 100));
    else discount = Math.max(sen(dv), 0);
    discount = Math.min(discount, subtotal);
    var net = subtotal - discount;
    var service = state.orderType === 'dine_in' ? applyBp(net, bp(cfg.SERVICE_PERCENT)) : 0;
    var tax = applyBp(net + service, bp(cfg.SST_PERCENT));
    var exact = net + service + tax;
    var total = method === 'cash' ? roundCash(exact) : exact;
    return { subtotal: subtotal, discount: discount, service: service, tax: tax, exact: exact, rounding: total - exact, total: total };
  }

  // ---------- menu ----------

  function loadMenu() {
    if (!state.products.length) $('grid').innerHTML = '<p class="muted">Loading menu…</p>';
    return refreshProducts().then(function () {
      if (!state.allProducts.length && $('grid').innerText.indexOf('Loading') >= 0) {
        $('grid').innerHTML = '<p class="err">Could not load the menu.</p><button id="retryMenu">Try again</button>';
        $('retryMenu').onclick = loadMenu;
      }
    });
  }

  function renderMenu() {
    var cats = ['All'];
    state.products.forEach(function (p) { if (cats.indexOf(p.category) < 0) cats.push(p.category); });
    $('chips').innerHTML = cats.map(function (c) {
      return '<button data-cat="' + esc(c) + '" class="' + (c === state.cat ? 'on' : '') + '">' + esc(c) + '</button>';
    }).join('');
    var q = state.query.toLowerCase();
    var shown = state.products.filter(function (p) {
      return (state.cat === 'All' || p.category === state.cat) && (!q || p.name.toLowerCase().indexOf(q) >= 0);
    });
    $('grid').innerHTML = shown.length ? shown.map(function (p) {
      var out = p.stock !== '' && p.stock <= 0;
      var low = p.stock !== '' && !out && p.stock <= (p.reorder_level === '' || p.reorder_level === undefined ? 5 : Number(p.reorder_level));
      var stock = p.stock === '' ? '' : '<small class="' + (p.stock < 0 ? 'neg' : low ? 'low' : '') + '">' + (out ? 'Out of stock' : 'Stock ' + esc(p.stock) + (low ? ' · low' : '')) + '</small>';
      return '<button class="item ' + tint(p.category) + (out ? ' out' : '') + '" data-add="' + esc(p.id) + '" aria-label="' + esc(p.name + ', ' + rm(sen(p.price)) + (out ? ', out of stock' : '')) + '">' +
        (out ? '<span class="out-badge">Out</span>' : low ? '<span class="lowdot" aria-hidden="true"></span>' : '') +
        '<b>' + esc(p.name) + '</b><span>' + rm(sen(p.price)) + '</span>' + stock + '</button>';
    }).join('') : '<p class="muted">No items found.</p>';
  }

  // ---------- cart ----------

  function cartLocked() {
    if (state.pending) { toast('Finish the unsaved payment first.'); payModal('cash', true); return true; }
    return false;
  }

  function add(id) {
    if (cartLocked()) return;
    var p = state.products.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var line = state.cart.filter(function (l) { return l.product_id === id && !l.note; })[0];
    if (line) line.qty++;
    else state.cart.push(line = { key: Math.random().toString(36).slice(2), product_id: p.id, name: p.name, unit: sen(p.price), qty: 1, note: '' });
    if (!line.key) line = state.cart[state.cart.length - 1];
    renderCart();
    var tile = document.querySelector('#grid [data-add="' + id + '"]');
    if (tile) { tile.classList.remove('pop'); void tile.offsetWidth; tile.classList.add('pop'); }
    var li = document.querySelector('#lines [data-key="' + line.key + '"]');
    if (li) li.classList.add('flash');
    announce(p.name + ' added. Total ' + rm(totals('').exact));
  }

  function renderCart() {
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.type === state.orderType); });
    $('lines').innerHTML = state.cart.length ? state.cart.map(function (l) {
      return '<li data-key="' + esc(l.key) + '"><div class="l1"><span>' + esc(l.name) + '</span><b>' + rm(l.unit * l.qty) + '</b></div>' +
        '<div class="l2"><button class="qty" data-q="-1" aria-label="Less">−</button><b>' + l.qty + '</b>' +
        '<button class="qty" data-q="1" aria-label="More">+</button>' +
        '<input data-note maxlength="100" placeholder="Note (less sugar, no ice)" value="' + esc(l.note) + '"></div></li>';
    }).join('') : '<li class="muted">Tap a product to start.</li>';
    var t = totals('');
    var rows = [['Subtotal', t.subtotal]];
    if (t.discount) rows.push(['Discount', -t.discount]);
    if (t.service) rows.push(['Service ' + cfg.SERVICE_PERCENT + '%', t.service]);
    if (t.tax) rows.push(['SST ' + cfg.SST_PERCENT + '%', t.tax]);
    $('totals').innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + rm(r[1]) + '</dd>'; }).join('') +
      '<dt class="grand">Total</dt><dd class="grand">' + rm(t.exact) + '</dd>';
    $('pay').disabled = !state.cart.length;
    $('pay').textContent = state.cart.length ? 'Pay  ' + rm(t.exact) : 'Pay';
    var n = state.cart.reduce(function (a, l) { return a + l.qty; }, 0);
    $('cartBar').hidden = !n || $('view-till').hidden;
    $('cartBar').textContent = n + ' item' + (n > 1 ? 's' : '') + ' · ' + rm(t.exact) + ' · View cart';
  }

  function clearCart() {
    state.cart = []; state.pending = null;
    $('disc').value = ''; $('table').value = ''; state.orderType = 'takeaway';
    renderCart();
  }

  // ---------- payment ----------

  function payModal(method, resume) {
    method = (state.pending && state.pending.payload.payment_method) || method || 'cash';
    var t = totals(method);
    var locked = !!state.pending;
    openModal(
      '<h2>Payment</h2>' +
      '<div class="methods">' + Object.keys(METHODS).map(function (m) {
        return '<button data-m="' + m + '" class="' + (m === method ? 'on' : '') + '"' + (locked ? ' disabled' : '') + '>' + METHODS[m] + '</button>';
      }).join('') + '</div>' +
      '<div class="big">' + rm(t.total) + '</div>' +
      (t.rounding ? '<p class="muted c">Includes cash rounding ' + rm(t.rounding) + '</p>' : '') +
      (method === 'cash' ? '<label>Amount received (RM)<input id="recv" inputmode="decimal" autocomplete="off"' + (locked ? ' disabled' : '') +
        ' value="' + esc(locked ? ((state.pending.received || 0) / 100).toFixed(2) : '') + '"></label>' +
        '<div class="row wrap" id="quick">' + [t.total, 1000, 2000, 5000, 10000].filter(function (v, i) { return i === 0 || v > t.total; }).map(function (v, i) {
          return '<button class="ghost" data-recv="' + v + '"' + (locked ? ' disabled' : '') + '>' + (i === 0 ? 'Exact' : rm(v)) + '</button>';
        }).join('') + '</div>' + (locked ? '' : '<div class="numpad" aria-label="Amount received">' +
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(function (k) {
            return '<button data-key="' + k + '" aria-label="' + (k === '⌫' ? 'Delete' : k) + '">' + k + '</button>';
          }).join('') + '</div>') + '<p id="change" class="big" aria-live="polite"></p>' : '') +
      (method === 'card' ? '<p class="muted">Take the card on your card terminal first. Do not type card numbers here.</p>' : '') +
      (method === 'duitnow_qr' || method === 'ewallet' ? '<p class="muted">Check the payment has arrived before you confirm.</p>' : '') +
      '<p id="payMsg" class="' + (resume ? 'err' : '') + '">' + (resume ? 'Not saved. Try again.' : '') + '</p>' +
      '<div class="actions"><button id="payCancel" class="ghost">' + (locked ? 'Check & close' : 'Cancel') + '</button>' +
      '<button id="payGo" class="primary">' + (locked ? 'Try again' : 'Confirm ' + rm(t.total)) + '</button></div>'
    );
    $('sheet').dataset.method = method;
    if (method === 'cash') { updateChange(); if (!locked && !matchMedia('(pointer: coarse)').matches) $('recv').focus(); }
  }

  function updateChange() {
    var t = totals('cash');
    var r = $('recv'); if (!r) return 0;
    var got = sen(r.value);
    var el = $('change');
    if (!r.value.trim()) el.textContent = '';
    else if (got < t.total) el.innerHTML = '<span class="err">Short by ' + rm(t.total - got) + '</span>';
    else el.innerHTML = '<span class="okc">Change ' + rm(got - t.total) + '</span>';
    return got;
  }

  function confirmPay() {
    if (state.saving) return; // double taps do nothing while a save is running
    var method = $('sheet').dataset.method;
    var msg = $('payMsg');
    if (!state.pending) {
      var t = totals(method);
      var received = 0;
      if (method === 'cash') {
        received = updateChange();
        if (received < t.total) { msg.className = 'err'; msg.textContent = 'Enter the amount received.'; return; }
      }
      var table = $('table').value.trim();
      var bad = [table].concat(state.cart.map(function (l) { return l.note; })).some(looksLikeCard);
      if (bad) { msg.className = 'err'; msg.textContent = 'Remove the card number from the note or table. Card numbers are never stored.'; return; }
      state.pending = {
        saleId: api.newSaleId(), received: received,
        payload: {
          items: state.cart.map(function (l) { return { product_id: l.product_id, qty: l.qty, note: l.note.trim() }; }),
          discount: { type: $('discType').value, value: $('disc').value.trim() || 0 },
          payment_method: method, order_type: state.orderType, table_no: table
        }
      };
    }
    var p = state.pending;
    var payload = Object.assign({ sale_id: p.saleId }, p.payload);
    state.saving = true;
    $('payGo').disabled = true; $('payCancel').disabled = true;
    $('payGo').textContent = 'Saving…';
    msg.className = 'muted'; msg.textContent = 'Saving the sale…';
    api.createSale(payload).then(function (sale) {
      state.saving = false;
      var received = p.received;
      clearCart();
      closeModal();
      loadMenu(); // fresh stock numbers
      receiptModal(sale, received, true);
      announce('Paid. Receipt ' + sale.receipt_no + '.');
      if (sale.warnings && sale.warnings.length) toast(sale.warnings.join(' '));
      if (sale.duplicate) toast('This sale was already saved; showing it.');
    }, function (e) {
      state.saving = false;
      if (e.kind === 'server') state.pending = null; // the server refused it; nothing was saved, so the next try gets a new id
      payModal(method, false);
      var m = $('payMsg');
      m.className = 'err';
      m.textContent = e.kind === 'network' ? 'Not saved. Try again. (' + e.message + ')' : e.message;
    });
  }

  // After a failed save the sale may or may not be on the server. Ask before letting the cart change.
  function checkAndClose() {
    var p = state.pending;
    if (!p) { closeModal(); return; }
    $('payCancel').disabled = true; $('payGo').disabled = true;
    $('payMsg').className = 'muted'; $('payMsg').textContent = 'Checking whether it was saved…';
    api.getSale(p.saleId).then(function (sale) {
      var received = p.received;
      clearCart(); closeModal(); loadMenu();
      receiptModal(sale, received);
      toast('It was saved after all.');
    }, function (e) {
      if (e.kind === 'server') { state.pending = null; closeModal(); toast('Not saved. The cart is still here.'); return; }
      $('payCancel').disabled = false; $('payGo').disabled = false;
      $('payMsg').className = 'err'; $('payMsg').textContent = 'Still no connection. Try again when you are back online.';
    });
  }

  // ---------- receipt and bar ticket ----------

  function receiptHtml(s, received) {
    var r = function (a, b, cls) { return '<div class="r' + (cls ? ' ' + cls : '') + '"><span>' + a + '</span><span>' + b + '</span></div>'; };
    var h = '<div class="receipt"><h3>' + esc(cfg.BUSINESS_NAME || 'Cafe') + '</h3>' +
      '<div class="c">Receipt ' + esc(s.receipt_no) + '</div><div class="c">' + esc(dmy(s.datetime)) + '</div>' +
      '<div class="c">' + esc(TYPES[s.order_type] || s.order_type) + (s.table_no ? ' · Table ' + esc(s.table_no) : '') + '</div>' +
      (s.status === 'void' ? '<h3>*** VOID ***</h3>' : '') + '<hr>';
    (s.items || []).forEach(function (it) {
      h += r(esc(it.qty) + ' × ' + esc(it.name), rm(sen(it.subtotal)));
      if (it.note) h += '<div class="muted">  ' + esc(it.note) + '</div>';
    });
    h += '<hr>' + r('Subtotal', rm(sen(s.subtotal)));
    if (Number(s.discount)) h += r('Discount', rm(-sen(s.discount)));
    if (Number(s.service)) h += r('Service charge', rm(sen(s.service)));
    if (Number(s.tax)) h += r('SST', rm(sen(s.tax)));
    if (Number(s.rounding)) h += r('Rounding', rm(sen(s.rounding)));
    h += r('<b>TOTAL</b>', '<b>' + rm(sen(s.total)) + '</b>', 'big');
    h += r('Paid by', esc(METHODS[s.payment_method] || s.payment_method));
    if (s.payment_method === 'cash' && received) { h += r('Received', rm(received)) + r('Change', rm(received - sen(s.total))); }
    h += '<hr><div class="c">' + esc(cfg.RECEIPT_FOOTER || 'Thank you!') + '</div></div>';
    return h;
  }

  function ticketHtml(t) {
    var h = '<div class="receipt"><h3>BAR / KITCHEN</h3><div class="c big">' + esc(TYPES[t.order_type]) + (t.table_no ? ' · T' + esc(t.table_no) : '') + '</div>' +
      '<div class="c">' + esc(t.ref || '') + ' ' + esc(dmy(t.datetime)) + '</div><hr>';
    t.items.forEach(function (it) {
      h += '<div class="r big"><span>' + esc(it.qty) + ' × ' + esc(it.name) + '</span></div>';
      if (it.note) h += '<div><b>→ ' + esc(it.note) + '</b></div>';
    });
    return h + '<hr></div>';
  }

  function receiptModal(sale, received) {
    var fresh = received !== 0 || sale.payment_method !== 'cash';
    openModal((fresh && arguments[2] ? '<div class="done-check">' + svg('check') + '</div><h2 class="c" style="text-align:center">Paid ' + rm(sen(sale.total)) + '</h2>' : '') +
      '<div id="rc">' + receiptHtml(sale, received) + '</div>' +
      '<div class="actions"><button id="rPrint" class="ghost">Print receipt</button><button id="rTicket" class="ghost">Bar ticket</button></div>' +
      '<div class="actions">' + (sale.status === 'paid' && role() !== 'admin' ? '<button id="rVoid" class="danger">Void</button>' : '') +
      '<button id="rDone" class="primary"' + (sale.status === 'paid' && role() !== 'admin' ? '' : ' style="grid-column: 1 / -1"') + '>' + (received ? 'New order' : 'Close') + '</button></div>');
    if ($('rVoid')) $('rVoid').onclick = function () { voidModal(sale.sale_id, sale.receipt_no, sale.total); };
    $('rPrint').onclick = function () { printHtml(receiptHtml(sale, received)); };
    $('rTicket').onclick = function () {
      printHtml(ticketHtml({ order_type: sale.order_type, table_no: sale.table_no, ref: sale.receipt_no, datetime: sale.datetime, items: sale.items }));
    };
    $('rDone').onclick = closeModal;
  }

  // ---------- today / summary ----------

  function loadSummary() {
    var day = $('day').value || today();
    $('summary').innerHTML = '<p class="muted">Loading…</p>';
    api.getDailySummary(day).then(function (s) { state.summary = s; renderSummary(); }, function (e) {
      $('summary').innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    });
  }

  function renderSummary() {
    var s = state.summary;
    var old = !Array.isArray(s.sales);
    var sold = (s.sales || []).filter(function (x) { return x.status !== 'void'; });
    setKpis('sumKpis', kpi('cash', rm(sen(s.total_sales)), 'sales', 'good') + kpi('receipt', String(s.orders), 'orders') +
      kpi('tag', s.orders ? rm(Math.round(sen(s.total_sales) / s.orders)) : '—', 'avg. ticket'));
    var hours = {};
    sold.forEach(function (x) { var hr = Number(String(x.datetime).slice(11, 13)); hours[hr] = (hours[hr] || 0) + sen(x.total); });
    var hs = Object.keys(hours).map(Number);
    var from = Math.min.apply(null, hs.concat([8])), to = Math.max.apply(null, hs.concat([20]));
    var peak = Math.max.apply(null, [1].concat(hs.map(function (k) { return hours[k]; })));
    var bars = '';
    for (var hr = from; hr <= to; hr++) {
      var v = hours[hr] || 0;
      bars += '<div class="' + (v ? '' : 'none') + '" title="' + hr + ':00 ' + rm(v) + '"><i style="height:' + Math.max(2, Math.round(v * 100 / peak)) + '%"></i>' + (hr % 2 ? '' : hr) + '</div>';
    }
    var mk = Object.keys(s.by_method || {}).sort(function (a, b) { return s.by_method[b] - s.by_method[a]; });
    var mTotal = mk.reduce(function (a, m) { return a + sen(s.by_method[m]); }, 0) || 1;
    var charts = '<div class="split"><div class="card chart-card"><div class="chart-head"><div><span class="muted">Sales by hour</span><br><b>' + rm(sen(s.total_sales)) +
      '</b></div><span class="muted">' + esc(dmy(s.date)) + '</span></div><div class="bars" role="img" aria-label="Sales by hour">' + bars + '</div></div>' +
      '<div class="card chart-card"><span class="muted">Payment methods</span><div class="hbars">' + (mk.length ? mk.map(function (m) {
        var v = sen(s.by_method[m]);
        return '<div><span>' + esc(METHODS[m] || m) + '</span><span class="track"><i style="width:' + Math.round(v * 100 / mTotal) + '%"></i></span><span class="n">' + rm(v) + '</span></div>';
      }).join('') : '<p class="muted">No sales yet.</p>') + '</div></div></div>';
    var h = charts + (old ? '<p class="err">The web app is running an old Code.gs: the sales list and void count are missing. ' +
      'Paste the new Code.gs and redeploy (Manage deployments → New version).</p>' : '') +
      '<div class="cards"><div>Total sales<b>' + rm(sen(s.total_sales)) + '</b></div><div>Orders<b>' + s.orders + '</b></div>' +
      '<div>Voided<b>' + (old ? '?' : s.voided) + '</b></div></div>';
    if ('waste_cost' in s) {
      var top3 = (s.waste_by_reason || []).slice(0, 3).map(function (r) { return esc(REASONS[r.reason] || r.reason) + ' ' + rm(sen(r.cost)); });
      h += '<h3>Waste</h3><div class="cards"><div>Waste cost<b>' + rm(sen(s.waste_cost)) + '</b></div><div>Entries<b>' + s.waste_count + '</b></div>' +
        '<div>% of sales<b>' + (s.waste_percent_of_sales === null ? '—' : s.waste_percent_of_sales + '%') + '</b></div>' +
        '<div>Staff meals<b>' + rm(sen(s.staff_meal_cost)) + '</b><small class="muted">' + s.staff_meal_count + ' entries, not in waste</small></div></div>' +
        (top3.length ? '<p>Top reasons: ' + top3.join(' · ') + '</p>' : '') + staffLine(s.waste_by_staff) +
        ('waste_dish_cost' in s ? '<p>Dish waste ' + rm(sen(s.waste_dish_cost)) + ' · ingredient waste ' + rm(sen(s.waste_ingredient_cost)) +
          ' · deliveries received ' + rm(sen(s.purchases_received)) + '</p>' : '') +
        (s.below_reorder && s.below_reorder.length ? '<p class="warn">Below reorder level: ' + s.below_reorder.map(function (x) {
          return esc(x.name) + ' (' + esc(qtyText(x.stock, x.unit)) + ')'; }).join(', ') + '</p>' : '') +
        (s.waste_cost_missing_lines ? '<p class="warn">' + s.waste_cost_missing_lines + ' waste line(s) have no cost, so waste cost is incomplete.</p>' : '');
    }
    var ms = Object.keys(s.by_method || {});
    h += '<h3>By payment method</h3><div class="scroll"><table><tbody>' + (ms.length ? ms.map(function (m) {
      return '<tr><td>' + esc(METHODS[m] || m) + '</td><td class="n">' + rm(sen(s.by_method[m])) + '</td></tr>';
    }).join('') : '<tr><td class="muted">No sales yet</td></tr>') + '</tbody></table></div>';
    h += '<h3>Top items</h3><div class="scroll"><table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Sales</th></tr></thead><tbody>' +
      (s.top_items || []).map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="n">' + t.qty + '</td><td class="n">' + rm(sen(t.sales)) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    h += '<h3>Sales</h3><div class="scroll"><table><thead><tr><th>Receipt</th><th>Time</th><th>Method</th><th class="n">Total</th><th></th></tr></thead><tbody>' +
      (s.sales || []).map(function (x) {
        return '<tr class="' + (x.status === 'void' ? 'void' : '') + '"><td><button class="ghost" data-show="' + esc(x.sale_id) + '">' + esc(x.receipt_no) + '</button></td>' +
          '<td>' + esc(String(x.datetime).slice(11, 16)) + '</td><td>' + esc(METHODS[x.payment_method] || x.payment_method) + '</td>' +
          '<td class="n">' + rm(sen(x.total)) + '</td><td>' + (x.status === 'void' ? '<span title="' + esc(x.void_reason) + '">void</span>' :
          role() === 'admin' ? '' : '<button class="danger" data-void="' + esc(x.sale_id) + '" data-no="' + esc(x.receipt_no) + '" data-total="' + esc(x.total) + '">Void</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('summary').innerHTML = h;
  }

  function downloadCsv() {
    var s = state.summary; if (!s) return;
    var rows = [['receipt_no', 'sale_id', 'datetime', 'order_type', 'table_no', 'payment_method', 'total', 'status', 'void_reason']]
      .concat((s.sales || []).slice().reverse().map(function (x) {
        return [x.receipt_no, x.sale_id, x.datetime, x.order_type, x.table_no, x.payment_method, Number(x.total).toFixed(2), x.status, x.void_reason];
      }));
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'sales-' + s.date + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- products ----------

  function loadProducts() {
    if (!state.allProducts.length) $('plist').innerHTML = '<p class="muted">Loading…</p>';
    else renderProducts();
    return refreshProducts();
  }

  function renderProducts() {
    var list = state.allProducts;
    var noCost = list.filter(function (p) { return p.cost === '' && (p.active || p.track_stock); }).length;
    setKpis('prodKpis', kpi('tag', String(list.filter(function (p) { return p.active && p.kind === 'menu'; }).length), 'on the menu') +
      kpi('box', String(list.filter(function (p) { return p.kind === 'ingredient'; }).length), 'ingredients') +
      kpi('alert', String(noCost), 'missing cost', noCost ? 'alert' : 'good'));
    $('plist').innerHTML = (noCost ? '<p class="warn">' + noCost + ' item' + (noCost > 1 ? 's have' : ' has') +
      ' no cost, so waste cost will be incomplete. Edit them to add a cost per unit.</p>' : '') +
      '<div class="scroll"><table><thead><tr><th>Name</th><th>Category</th><th class="n">Price</th><th class="n">Cost</th><th class="n">Stock</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        return '<tr class="' + (p.active ? '' : 'void') + '"><td>' + esc(p.name) + (p.kind === 'ingredient' ? ' <span class="tag">ingredient</span>' : '') + '</td>' +
          '<td>' + esc(p.category) + '</td><td class="n">' + (p.kind === 'ingredient' ? '<span class="muted">—</span>' : rm(sen(p.price))) + '</td>' +
          '<td class="n">' + (p.cost === '' ? '<span class="warn">missing</span>' : rmFine(p.cost) + '/' + esc(p.unit)) + '</td>' +
          '<td class="n">' + (p.track_stock ? esc(qtyText(p.stock, p.unit)) : '<span class="muted">—</span>') + '</td>' +
          '<td><button class="ghost" data-edit="' + esc(p.id) + '">Edit</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">Inactive items are crossed out and hidden from the till. Products are never deleted. ' +
      'Change stock on the Stock screen, so every change is recorded.</p>';
  }

  function productModal(id) {
    var p = state.allProducts.filter(function (x) { return x.id === id; })[0] ||
      { name: '', price: '', stock: '', category: '', active: true, unit: 'pcs', cost: '', kind: 'menu', track_stock: false };
    var units = ['pcs', 'cup', 'g', 'ml', 'kg', 'l'];
    openModal('<h2>' + (p.id ? 'Edit product' : 'Add product') + '</h2>' +
      '<label>Name<input id="pName" maxlength="60" value="' + esc(p.name) + '"></label>' +
      '<label>Kind<select id="pKind"><option value="menu"' + (p.kind === 'menu' ? ' selected' : '') + '>Menu item (sold at the till)</option>' +
      '<option value="ingredient"' + (p.kind === 'ingredient' ? ' selected' : '') + '>Ingredient (waste and stock only)</option></select></label>' +
      '<label id="pPriceRow">Price (RM)<input id="pPrice" inputmode="decimal" value="' + esc(p.price === '' ? '' : Number(p.price).toFixed(2)) + '"></label>' +
      '<label>Category<input id="pCat" maxlength="30" list="cats" value="' + esc(p.category) + '"></label>' +
      '<datalist id="cats">' + ['Coffee', 'Tea', 'Food', 'Dessert', 'Ingredient'].map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist>' +
      '<label>Unit<select id="pUnit">' + units.map(function (u) { return '<option' + (u === p.unit ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></label>' +
      '<label>Cost per unit (RM, leave blank if unknown)<input id="pCost" inputmode="decimal" value="' + esc(p.cost === '' ? '' : String(p.cost)) + '"></label>' +
      '<div id="pIngr"><label>Pack size (in the unit above, e.g. 750 for a 750 ml bottle)<input id="pPack" inputmode="decimal" value="' + esc(p.pack_size === '' || p.pack_size === undefined ? '' : p.pack_size) + '"></label>' +
      '<label>Pack name (bottle, bag, carton)<input id="pPackUnit" maxlength="20" value="' + esc(p.pack_unit || '') + '"></label>' +
      '<label>Reorder level<input id="pReorder" inputmode="decimal" value="' + esc(p.reorder_level === '' || p.reorder_level === undefined ? '' : p.reorder_level) + '"></label>' +
      '<label class="row"><input id="pOpen" type="checkbox" style="min-height:24px;width:24px"' + (p.track_open ? ' checked' : '') + '> Track open containers</label>' +
      '<label>Days it keeps once opened<input id="pShelf" inputmode="numeric" value="' + esc(p.open_shelf_life_days === '' || p.open_shelf_life_days === undefined ? '' : p.open_shelf_life_days) + '"></label>' +
      '<label>Open at once per station before a warning<input id="pMaxOpen" inputmode="numeric" value="' + esc(p.max_open_containers || 1) + '"></label></div>' +
      '<p class="muted" id="pCostHint"></p>' +
      '<label class="row"><input id="pTrack" type="checkbox" style="min-height:24px;width:24px"' + (p.track_stock ? ' checked' : '') + '> Track stock</label>' +
      (p.track_stock ? '<p class="muted">Stock now ' + esc(qtyText(p.stock, p.unit)) + '. Change it on the Stock screen. Unticking sets it to "not tracked" and records an adjustment.</p>'
        : '<label id="pStockRow">Starting stock<input id="pStock" inputmode="decimal" placeholder="0"></label>') +
      '<label class="row"><input id="pActive" type="checkbox" style="min-height:24px;width:24px"' + (p.active ? ' checked' : '') + '> Active (untick to deactivate)</label>' +
      '<p id="pMsg"></p><div class="actions"><button id="pCancel" class="ghost">Cancel</button><button id="pSave" class="primary">Save</button></div>');
    var hint = function () {
      var u = $('pUnit').value;
      $('pCostHint').textContent = (u === 'g' || u === 'ml') ? 'Cost per ' + u + ' can have up to 6 decimals (milk RM 8.00 a litre = 0.008 per ml). Receiving stock keeps it as an average.' : '';
      $('pPriceRow').hidden = $('pKind').value === 'ingredient';
      if ($('pStockRow')) $('pStockRow').hidden = !$('pTrack').checked;
      $('pShelf').closest('label').hidden = $('pMaxOpen').closest('label').hidden = !$('pOpen').checked;
    };
    ['pUnit', 'pKind', 'pTrack', 'pOpen'].forEach(function (x) { $(x).addEventListener('change', hint); });
    hint();
    $('pCancel').onclick = closeModal;
    $('pSave').onclick = function () {
      var kind = $('pKind').value;
      var price = kind === 'ingredient' ? '0' : $('pPrice').value.trim();
      var cost = $('pCost').value.trim();
      var unit = $('pUnit').value;
      var stock = $('pStock') ? $('pStock').value.trim() : '';
      var m = $('pMsg'); m.className = 'err';
      if (!$('pName').value.trim()) { m.textContent = 'Name is required.'; return; }
      if (!/^\d+(\.\d{1,2})?$/.test(price)) { m.textContent = 'Price like 12.90'; return; }
      if (cost && !/^\d+(\.\d{1,6})?$/.test(cost)) { m.textContent = 'Cost like 2.80, or 0.008 per ml (or blank)'; return; }
      var opt = function (id) { return $(id).value.trim(); };
      if (opt('pPack') && !(Number(opt('pPack')) > 0)) { m.textContent = 'Pack size must be more than 0.'; return; }
      if ($('pOpen').checked && !opt('pPack')) { m.textContent = 'Set a pack size to track open containers.'; return; }
      if (stock && !(DECIMAL_UNITS.indexOf(unit) >= 0 ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(stock)) {
        m.textContent = DECIMAL_UNITS.indexOf(unit) >= 0 ? 'Starting stock like 2.5' : 'Starting stock must be a whole number.'; return;
      }
      if (p.track_stock && !$('pTrack').checked && !confirm('Stop tracking stock for ' + p.name + '? Its stock becomes "not tracked".')) return;
      $('pSave').disabled = true; $('pSave').textContent = 'Saving…';
      api.saveProduct({ id: p.id, name: $('pName').value.trim(), price: price, category: $('pCat').value.trim(), active: $('pActive').checked,
        unit: unit, cost: cost, kind: kind, track_stock: $('pTrack').checked, stock: stock === '' ? '' : Number(stock), staff_name: getStaff(),
        pack_size: opt('pPack'), pack_unit: opt('pPackUnit'), reorder_level: opt('pReorder'), track_open: $('pOpen').checked,
        open_shelf_life_days: $('pOpen').checked ? opt('pShelf') : '', max_open_containers: opt('pMaxOpen') || 1 })
        .then(function () { closeModal(); toast('Saved.'); refreshProducts(); }, function (e) {
          $('pSave').disabled = false; $('pSave').textContent = 'Save'; m.textContent = e.message;
        });
    };
  }

  // ---------- waste ----------

  var REASONS = { cancelled_after_made: 'Cancelled after made', quality_low: 'Quality low', wrong_order: 'Wrong order',
    customer_returned: 'Customer returned', remake: 'Remake', dropped: 'Dropped', spoiled: 'Spoiled', expired: 'Expired',
    expired_after_open: 'Expired after opening', spilled: 'Spilled', broken: 'Broken', contaminated: 'Contaminated',
    overproduction: 'Overproduction', staff_meal: 'Staff meal', sample: 'Sample', other: 'Other' };
  // Same lists as Code.gs: a menu item is dish waste, an ingredient is ingredient waste.
  var DISH_REASONS = ['remake', 'quality_low', 'wrong_order', 'customer_returned', 'dropped', 'cancelled_after_made', 'overproduction',
    'expired', 'spoiled', 'staff_meal', 'sample', 'other'];
  var INGREDIENT_REASONS = ['spoiled', 'expired', 'expired_after_open', 'spilled', 'broken', 'dropped', 'contaminated', 'staff_meal', 'sample', 'other'];
  function reasonsFor(lines) {
    var kinds = {};
    lines.forEach(function (l) { var p = state.allProducts.filter(function (x) { return x.id === l.product_id; })[0]; kinds[p && p.kind === 'ingredient' ? 'i' : 'd'] = true; });
    if (kinds.i && kinds.d) return DISH_REASONS.filter(function (r) { return INGREDIENT_REASONS.indexOf(r) >= 0; });
    return kinds.i ? INGREDIENT_REASONS : DISH_REASONS;
  }
  var DECIMAL_UNITS = ['g', 'ml', 'kg', 'l'];
  var waste = { cat: 'All', query: '', lines: [], reason: '', pending: null, saving: false, list: null };

  function getStaff() { var s = api.session(); return s ? s.name : ''; }
  function setStaff() { /* the server records the signed-in person */ }
  function qtyText(q, unit) { return (Math.round(Number(q) * 1000) / 1000) + ' ' + unit; }
  function stepOf(unit) { return DECIMAL_UNITS.indexOf(unit) >= 0 ? 0.1 : 1; }
  function wasteable(p) { return p.active || p.track_stock; }

  function renderWasteGrid() {
    var list = state.allProducts.filter(wasteable);
    var cats = ['All'];
    list.forEach(function (p) { if (cats.indexOf(p.category) < 0) cats.push(p.category); });
    $('wChips').innerHTML = cats.map(function (c) {
      return '<button data-wcat="' + esc(c) + '" class="' + (c === waste.cat ? 'on' : '') + '">' + esc(c) + '</button>';
    }).join('');
    var q = waste.query.toLowerCase();
    var shown = list.filter(function (p) { return (waste.cat === 'All' || p.category === waste.cat) && (!q || p.name.toLowerCase().indexOf(q) >= 0); });
    $('wGrid').innerHTML = shown.length ? shown.map(function (p) {
      return '<button class="item ' + tint(p.category) + (p.kind === 'ingredient' ? ' ingr' : '') + '" data-wadd="' + esc(p.id) + '"><b>' + esc(p.name) + '</b>' +
        '<small>' + (p.cost === '' ? '<span class="warn">no cost</span>' : rm(sen(p.cost)) + ' / ' + esc(p.unit)) + '</small>' +
        (p.track_stock ? '<small>Stock ' + esc(qtyText(p.stock, p.unit)) + '</small>' : '') + '</button>';
    }).join('') : '<p class="muted">No items found.</p>';
  }

  function wasteLocked() {
    if (waste.pending) { toast('Finish the unsaved waste entry first: Try again, or Clear to check it.'); return true; }
    return false;
  }

  function wasteAdd(id) {
    if (wasteLocked()) return;
    var p = state.allProducts.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var line = waste.lines.filter(function (l) { return l.product_id === id; })[0];
    if (line) line.qty = Math.round((Number(line.qty) + stepOf(p.unit)) * 1000) / 1000;
    else waste.lines.push({ key: Math.random().toString(36).slice(2), product_id: p.id, name: p.name, unit: p.unit, qty: stepOf(p.unit) === 1 ? 1 : 0.1 });
    renderWasteForm();
  }

  function renderWasteForm() {
    $('wLines').innerHTML = waste.lines.length ? waste.lines.map(function (l) {
      return '<li data-wkey="' + esc(l.key) + '"><div class="l1"><span>' + esc(l.name) + '</span><span class="muted">' + esc(l.unit) + '</span></div>' +
        '<div class="l2"><button class="qty" data-wq="-1" aria-label="Less">−</button>' +
        '<input class="qtyin" data-wqty inputmode="decimal" value="' + esc(l.qty) + '">' +
        '<button class="qty" data-wq="1" aria-label="More">+</button></div></li>';
    }).join('') : '<li class="muted">Tap an item to add it.</li>';
    var allowed = reasonsFor(waste.lines);
    if (waste.reason && allowed.indexOf(waste.reason) < 0) waste.reason = '';
    $('wReasons').innerHTML = allowed.map(function (r) {
      return '<button data-wreason="' + r + '" class="' + (r === waste.reason ? 'on' : '') + '">' + REASONS[r] + '</button>';
    }).join('');
    $('wLog').disabled = waste.saving || !waste.lines.length;
    $('wLog').textContent = waste.saving ? 'Saving…' : waste.pending ? 'Try again' : 'Log waste';
  }

  function wasteMsg(text, cls) { var m = $('wMsg'); m.className = cls || ''; m.textContent = text || ''; }

  function logWaste() {
    if (waste.saving) return; // double taps do nothing while saving
    if (!waste.pending) {
      var staff = $('wStaff').value.trim();
      var note = $('wNote').value.trim();
      if (!waste.lines.length) return;
      for (var i = 0; i < waste.lines.length; i++) {
        var l = waste.lines[i];
        var q = Number(l.qty);
        var dec = DECIMAL_UNITS.indexOf(l.unit) >= 0;
        if (!(q > 0) || (!dec && Math.floor(q) !== q) || q > 999) {
          return wasteMsg('Check the quantity for ' + l.name + (dec ? ' (more than 0)' : ' (a whole number, 1 or more)') + '.', 'err');
        }
      }
      if (!waste.reason) return wasteMsg('Choose a reason.', 'err');
      if (waste.reason === 'other' && note.length < 3) return wasteMsg('Add a note when the reason is Other.', 'err');
      if (looksLikeCard(note) || looksLikeCard(staff)) return wasteMsg('Remove the card number. Card numbers are never stored.', 'err');
      if (!staff) return wasteMsg('Enter your name.', 'err');
      setStaff(staff);
      waste.pending = {
        waste_id: api.newSaleId(), staff_name: staff,
        items: waste.lines.map(function (l) { return { product_id: l.product_id, qty: Number(l.qty), reason: waste.reason, note: note }; })
      };
    }
    waste.saving = true;
    renderWasteForm();
    wasteMsg('Saving…', 'muted');
    api.logWaste(waste.pending).then(function (r) {
      waste.saving = false;
      var cost = r.lines.reduce(function (a, l) { return a + (l.cost === '' ? 0 : sen(l.cost)); }, 0);
      var missing = r.lines.some(function (l) { return l.cost_missing; });
      resetWaste();
      wasteMsg('Logged' + (r.duplicate ? ' (it was already saved)' : '') + ': ' + rm(cost) + (missing ? ' (some items have no cost)' : '') + '.', 'okc');
      if (r.warnings && r.warnings.length) toast(r.warnings.join(' '));
      refreshProducts(); loadWasteList();
    }, function (e) {
      waste.saving = false;
      if (e.kind === 'server') waste.pending = null; // refused: nothing saved, next try gets a new id
      renderWasteForm();
      wasteMsg(e.kind === 'network' ? 'Not saved. Try again. (' + e.message + ')' : e.message, 'err');
    });
  }

  function resetWaste() {
    waste.lines = []; waste.reason = ''; waste.pending = null;
    $('wNote').value = '';
    renderWasteForm();
  }

  // Clear after a failed save: ask the server whether the entry got through before throwing it away.
  function clearWaste() {
    if (waste.saving) return;
    if (!waste.pending) { resetWaste(); wasteMsg(''); return; }
    if (role() === 'cashier') { wasteMsg('Press Try again. The same entry is never saved twice.', 'muted'); return; } // a cashier can't read the log to check
    var id = waste.pending.waste_id;
    wasteMsg('Checking whether it was saved…', 'muted');
    api.getWaste().then(function (w) {
      var saved = w.rows.some(function (x) { return x.waste_id === id; });
      resetWaste();
      wasteMsg(saved ? 'It was saved after all.' : 'Not saved. Cleared.', saved ? 'okc' : '');
      loadWasteList(); if (saved) refreshProducts();
    }, function () { wasteMsg('Still no connection. Try again when you are back online.', 'err'); });
  }

  function loadWasteList() {
    var head = $('wList').previousElementSibling; // the "Today's waste" heading
    if (role() === 'cashier') {
      if (head) head.hidden = true;
      $('wasteKpis').innerHTML = '';
      $('wList').innerHTML = '<p class="muted">Your name and ID are saved on every entry. A supervisor reviews the waste log.</p>';
      return Promise.resolve();
    }
    if (head) head.hidden = false;
    return api.getWaste().then(function (w) { waste.list = w; renderWasteList(); }, function (e) {
      $('wList').innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    });
  }

  function renderWasteList() {
    var w = waste.list;
    var entries = {};
    var order = [];
    w.rows.forEach(function (x) {
      if (x.status === 'reversal') return;
      if (!entries[x.waste_id]) { entries[x.waste_id] = { id: x.waste_id, time: x.datetime, status: x.status, reasons: {}, lines: [], cost: 0, missing: false, staff: x.staff_name, empId: x.emp_id, role: x.role }; order.push(x.waste_id); }
      var e = entries[x.waste_id];
      e.lines.push(qtyText(x.qty, x.unit) + ' ' + x.name);
      e.reasons[REASONS[x.reason] || x.reason] = true;
      if (x.cost === '') e.missing = true; else e.cost += sen(x.cost);
    });
    setKpis('wasteKpis', kpi('bin', rm(sen(w.waste_cost)), 'waste today', w.waste_count ? 'alert' : '') + kpi('receipt', String(w.waste_count), 'entries') +
      kpi('meal', rm(sen(w.staff_meal_cost)), 'staff meals'));
    if (!order.length) { $('wList').innerHTML = '<p class="muted">Nothing logged today.</p>'; return; }
    $('wList').innerHTML = '<p>Waste today: <b>' + rm(sen(w.waste_cost)) + '</b> in ' + w.waste_count + ' entries' +
      (w.staff_meal_count ? ' · staff meals ' + rm(sen(w.staff_meal_cost)) + ' (not counted as waste)' : '') + '</p>' + staffLine(w.by_staff) +
      '<div class="scroll"><table><thead><tr><th>Time</th><th>Items</th><th>Reason</th><th class="n">Cost</th><th></th></tr></thead><tbody>' +
      order.map(function (id) {
        var e = entries[id];
        return '<tr class="' + (e.status === 'reversed' ? 'void' : '') + '"><td>' + esc(String(e.time).slice(11, 16)) + '</td><td>' + esc(e.lines.join(', ')) +
          (e.staff || e.empId ? ' <span class="tag" title="Keyed in by">' + esc(e.staff || '') + (e.empId ? ' · ' + esc(e.empId) : '') + (e.role ? ' · ' + esc(ROLE_LABEL[e.role] || e.role) : '') + '</span>' : '') + '</td><td>' + esc(Object.keys(e.reasons).join(', ')) + '</td>' +
          '<td class="n">' + rm(e.cost) + (e.missing ? ' <span class="warn" title="Some items have no cost">*</span>' : '') + '</td>' +
          '<td>' + (e.status === 'logged' ? '<button class="ghost" data-wrev="' + esc(id) + '">Reverse</button>' : 'reversed') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** "Keyed in by": each person's waste entries and cost (staff meals are not in the cost). */
  function staffLine(list) {
    if (!list || !list.length) return '';
    return '<p>Keyed in by: ' + list.map(function (x) {
      return esc(x.name || x.emp_id) + (x.emp_id ? ' (' + esc(x.emp_id) + ')' : '') + ' ' + x.entries + (x.entries === 1 ? ' entry' : ' entries') + ' ' + rm(sen(x.cost));
    }).join(' · ') + '</p>';
  }

  function reverseModal(id) {
    openModal('<h2>Reverse waste</h2><p>The stock is put back and the entry is crossed out. It is not deleted.</p>' +
      '<label>Reason (required)<input id="rvReason" maxlength="200" autocomplete="off"></label><p id="rvMsg"></p>' +
      '<div class="actions"><button id="rvCancel" class="ghost">Cancel</button><button id="rvGo" class="danger">Reverse</button></div>');
    $('rvReason').focus();
    $('rvCancel').onclick = closeModal;
    $('rvGo').onclick = function () {
      var reason = $('rvReason').value.trim();
      if (reason.length < 3) { $('rvMsg').className = 'err'; $('rvMsg').textContent = 'Please give a reason.'; return; }
      $('rvGo').disabled = true; $('rvGo').textContent = 'Reversing…';
      api.reverseWaste(id, reason, getStaff()).then(function () { closeModal(); toast('Waste reversed.'); loadWasteList(); refreshProducts(); }, function (e) {
        $('rvGo').disabled = false; $('rvGo').textContent = 'Reverse';
        $('rvMsg').className = 'err'; $('rvMsg').textContent = e.message;
      });
    };
  }

  // ---------- stock ----------

  var stockQuery = '';

  function renderStock() {
    var low = Number(cfg.LOW_STOCK || 5);
    var q = stockQuery.toLowerCase();
    var list = state.allProducts.filter(function (p) {
      return (p.track_stock || p.kind === 'ingredient') && (!q || p.name.toLowerCase().indexOf(q) >= 0);
    });
    var value = list.reduce(function (a, p) { return a + (p.track_stock && p.cost !== '' && p.stock > 0 ? Math.round(Number(p.cost) * 100 * p.stock) : 0); }, 0);
    var lowN = list.filter(function (p) {
      return p.track_stock && p.stock <= (p.reorder_level === '' || p.reorder_level === undefined ? low : Number(p.reorder_level));
    }).length;
    setKpis('stockKpis', kpi('box', rm(value), 'stock value') + kpi('alert', String(lowN), 'low or out', lowN ? 'alert' : 'good') +
      kpi('tag', String(list.filter(function (p) { return p.track_stock; }).length), 'tracked items'));
    $('slist').innerHTML = (list.length ? '<p>Stock value: <b>' + rm(value) + '</b> <span class="muted">(stock × cost, items with a cost)</span></p>' +
      '<div class="scroll"><table><thead><tr><th>Item</th><th class="n">Stock</th><th class="n">Value</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        var lvl = p.reorder_level === '' || p.reorder_level === undefined ? low : Number(p.reorder_level);
        var cls = !p.track_stock ? '' : p.stock < 0 ? 'neg' : p.stock <= lvl ? 'low' : '';
        return '<tr class="' + cls + '"><td>' + esc(p.name) + (p.kind === 'ingredient' ? ' <span class="tag">ingredient</span>' : '') + (p.active ? '' : ' <span class="tag">inactive</span>') + '</td>' +
          '<td class="n">' + (p.track_stock ? esc(qtyText(p.stock, p.unit)) : '<span class="muted">not tracked</span>') + '</td>' +
          '<td class="n">' + (p.track_stock && p.cost !== '' ? rm(Math.round(Number(p.cost) * 100 * Math.max(p.stock, 0))) : '<span class="muted">—</span>') + '</td>' +
          '<td><div class="row" style="margin:0"><button class="ghost" data-sin="' + esc(p.id) + '">Stock in</button>' +
          (p.track_stock ? '<button class="ghost" data-sadj="' + esc(p.id) + '">Adjust</button>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No tracked items. Give a product a stock number, or use Stock in.</p>') +
      '<p class="muted">At or below the reorder level (or ' + low + ' when none is set) in orange, negative in red. Every change is kept in the StockMovements tab.</p>';
  }

  function stockModal(id, type) {
    var p = state.allProducts.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var movementId = api.newSaleId(); // kept for every retry of this form, so a repeat can't count twice
    var isIn = type === 'stock_in';
    openModal('<h2>' + (isIn ? 'Stock in' : 'Adjust stock') + ': ' + esc(p.name) + '</h2>' +
      '<p class="muted">Now: ' + (p.track_stock ? esc(qtyText(p.stock, p.unit)) : 'not tracked (Stock in starts tracking from 0)') + '</p>' +
      '<label>' + (isIn ? 'Quantity received (' + esc(p.unit) + ')' : 'Change (+ to add, − to remove, ' + esc(p.unit) + ')') +
      '<input id="smQty" inputmode="' + (isIn ? 'decimal' : 'text') + '" autocomplete="off"></label>' +
      '<label>' + (isIn ? 'Note (optional, e.g. supplier)' : 'Reason (required, e.g. recount)') + '<input id="smNote" maxlength="200" autocomplete="off"></label>' +
      '<p id="smMsg"></p><div class="actions"><button id="smCancel" class="ghost">Cancel</button><button id="smGo" class="primary">Save</button></div>');
    $('smQty').focus();
    $('smCancel').onclick = closeModal;
    $('smGo').onclick = function () {
      var raw = $('smQty').value.trim().replace(/^\+/, '').replace('−', '-');
      var note = $('smNote').value.trim();
      var m = $('smMsg'); m.className = 'err';
      if (!/^-?\d+(\.\d{1,3})?$/.test(raw) || Number(raw) === 0) { m.textContent = 'Enter a quantity, e.g. 12 or 0.5.'; return; }
      if (isIn && Number(raw) < 0) { m.textContent = 'Stock in must be more than 0. Use Adjust to remove stock.'; return; }
      if (!isIn && note.length < 3) { m.textContent = 'Please give a reason.'; return; }
      if (looksLikeCard(note)) { m.textContent = 'Remove the card number.'; return; }
      $('smGo').disabled = true; $('smGo').textContent = 'Saving…'; m.className = 'muted'; m.textContent = '';
      api.stockAdjust({ movement_id: movementId, product_id: p.id, change_qty: Number(raw), reason_type: type, note: note, staff_name: getStaff() })
        .then(function (r) {
          closeModal(); toast(p.name + ': now ' + qtyText(r.balance_after, p.unit) + '.');
          if (r.warnings && r.warnings.length) toast(r.warnings.join(' '));
          refreshProducts();
        }, function (e) {
          $('smGo').disabled = false; $('smGo').textContent = e.kind === 'network' ? 'Try again' : 'Save';
          m.className = 'err'; m.textContent = e.kind === 'network' ? 'Not saved. Try again. (' + e.message + ')' : e.message;
        });
    };
  }

  // One list of every product (menu and ingredients, active or not) feeds the Waste, Stock and Products screens.
  function refreshProducts() {
    return api.getProducts(true).then(function (list) {
      state.allProducts = list;
      if (!$('view-waste').hidden) renderWasteGrid();
      if (!$('view-stock').hidden) renderStock();
      if (!$('view-products').hidden) renderProducts();
      state.products = list.filter(function (p) { return p.active && p.kind !== 'ingredient'; });
      renderMenu();
    }, function (e) {
      ['wGrid', 'slist', 'plist'].forEach(function (id) { if ($(id).innerText.indexOf('Loading') >= 0) $(id).innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    });
  }

  // ---------- inventory: receive, recipes, containers, count ----------

  var inv = { tab: 'stock', receive: null, recvPending: null, recvSaving: false, purchases: null, recipes: null,
    containers: null, openPending: null, count: {}, countPending: null, countSaving: false, countResult: null };

  function stockable() { return state.allProducts.filter(function (p) { return p.kind === 'ingredient' || p.track_stock; }); }
  function productById(id) { return state.allProducts.filter(function (p) { return p.id === id; })[0]; }
  function itemOptions(list, selected, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.unit) + ')</option>';
    }).join('');
  }
  function busy(btn, on, text) { btn.disabled = on; if (text) btn.textContent = text; }
  function fail(el, e) { el.className = 'err'; el.textContent = e.kind === 'network' ? 'Not saved. Try again. (' + e.message + ')' : e.message; }
  function rmFine(x) { return x === '' || x === null || x === undefined ? '—' : 'RM ' + Number(x).toFixed(Number(x) < 1 ? 4 : 2); }

  function showInv(tab) {
    inv.tab = tab;
    document.querySelectorAll('#invTabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.inv === tab); });
    ['stock', 'receive', 'recipes', 'containers', 'count'].forEach(function (t) { $('inv-' + t).hidden = t !== tab; });
    if (tab === 'stock') renderStock();
    if (tab === 'receive') { renderReceive(); loadPurchases(); }
    if (tab === 'recipes') loadRecipes();
    if (tab === 'containers') loadContainers();
    if (tab === 'count') renderCount();
  }

  // ---- Receive ----

  function newDelivery() { return { supplier: '', invoice_no: '', lines: [{ key: 'l1', ingredient_id: '', pack_qty: '1', pack_cost: '', batch_no: '', expiry_date: '' }] }; }

  function renderReceive() {
    if (!inv.receive) inv.receive = newDelivery();
    var d = inv.receive;
    var locked = !!inv.recvPending;
    var dis = locked ? ' disabled' : '';
    var lines = d.lines.map(function (l) {
      var p = productById(l.ingredient_id);
      var size = p ? (p.pack_size || 1) : 0;
      var total = p && Number(l.pack_qty) > 0 ? Math.round(Number(l.pack_qty) * size * 1000) / 1000 : '';
      var line = l.pack_cost !== '' && Number(l.pack_qty) > 0 ? Math.round(sen(l.pack_cost) * Number(l.pack_qty)) : '';
      return '<div class="line-card" data-rline="' + esc(l.key) + '"><div class="form-grid">' +
        '<label>Item<select data-rf="ingredient_id"' + dis + '>' + itemOptions(stockable(), l.ingredient_id, 'Choose…') + '</select></label>' +
        '<label>Packs' + (p ? ' (' + esc(p.pack_unit || 'pack') + ' of ' + esc(size) + ' ' + esc(p.unit) + ')' : '') +
        '<input data-rf="pack_qty" inputmode="decimal" value="' + esc(l.pack_qty) + '"' + dis + '></label>' +
        '<label>Cost per pack (RM)<input data-rf="pack_cost" inputmode="decimal" value="' + esc(l.pack_cost) + '"' + dis + '></label>' +
        '<label>Batch no.<input data-rf="batch_no" maxlength="30" value="' + esc(l.batch_no) + '"' + dis + '></label>' +
        '<label>Expiry<input data-rf="expiry_date" type="date" value="' + esc(l.expiry_date) + '"' + dis + '></label></div>' +
        '<div class="row"><span class="muted">' + (total !== '' ? '= ' + esc(qtyText(total, p.unit)) : '') + (line !== '' ? ' · ' + rm(line) : '') +
        (p && !p.pack_size ? ' · <span class="warn">no pack size set: 1 pack = 1 ' + esc(p.unit) + '</span>' : '') + '</span>' +
        (d.lines.length > 1 && !locked ? '<button class="ghost" data-rdel="' + esc(l.key) + '">Remove</button>' : '') + '</div></div>';
    }).join('');
    var totalSen = d.lines.reduce(function (a, l) { return a + (l.pack_cost !== '' && Number(l.pack_qty) > 0 ? Math.round(sen(l.pack_cost) * Number(l.pack_qty)) : 0); }, 0);
    $('inv-receive').innerHTML = '<div class="card"><h3 class="flat">Receive stock</h3><div class="form-grid">' +
      '<label>Supplier<input id="rvSupplier" maxlength="60" value="' + esc(d.supplier) + '"' + dis + '></label>' +
      '<label>Invoice no.<input id="rvInvoice" maxlength="40" value="' + esc(d.invoice_no) + '"' + dis + '></label>' +
      '<label>Received by<input id="rvBy" maxlength="40" value="' + esc(getStaff()) + '"' + dis + '></label></div>' + lines +
      '<div class="row wrap">' + (locked ? '' : '<button class="ghost" id="rvAdd">Add line</button>') +
      '<span>Total <b>' + rm(totalSen) + '</b></span></div><p id="rvMsg"></p>' +
      '<div class="actions two"><button class="ghost" id="rvClear">Clear</button><button class="primary" id="rvSave">' +
      (inv.recvSaving ? 'Saving…' : locked ? 'Try again' : 'Receive') + '</button></div></div>' +
      '<h3>Deliveries (7 days)</h3><div id="rvList"><p class="muted">Loading…</p></div>';
    if (inv.recvSaving) $('rvSave').disabled = true;
  }

  function saveReceive() {
    if (inv.recvSaving) return;
    var msg = $('rvMsg');
    if (!inv.recvPending) {
      var d = inv.receive;
      var by = $('rvBy').value.trim();
      d.supplier = $('rvSupplier').value.trim(); d.invoice_no = $('rvInvoice').value.trim();
      if (!d.supplier) { msg.className = 'err'; msg.textContent = 'Enter the supplier.'; return; }
      if (!by) { msg.className = 'err'; msg.textContent = 'Enter who received it.'; return; }
      for (var i = 0; i < d.lines.length; i++) {
        var l = d.lines[i];
        if (!l.ingredient_id) { msg.className = 'err'; msg.textContent = 'Choose the item on line ' + (i + 1) + '.'; return; }
        if (!(Number(l.pack_qty) > 0)) { msg.className = 'err'; msg.textContent = 'Packs on line ' + (i + 1) + ' must be more than 0.'; return; }
        if (!/^\d+(\.\d{1,2})?$/.test(String(l.pack_cost).trim())) { msg.className = 'err'; msg.textContent = 'Cost per pack on line ' + (i + 1) + ', like 45.00.'; return; }
      }
      if ([d.supplier, d.invoice_no].concat(d.lines.map(function (x) { return x.batch_no; })).some(looksLikeCard)) {
        msg.className = 'err'; msg.textContent = 'Remove the card number.'; return;
      }
      setStaff(by);
      inv.recvPending = { purchase_id: api.newSaleId(), supplier: d.supplier, invoice_no: d.invoice_no, received_by: by,
        lines: d.lines.map(function (x) { return { ingredient_id: x.ingredient_id, pack_qty: Number(x.pack_qty), pack_cost: Number(x.pack_cost), batch_no: x.batch_no, expiry_date: x.expiry_date }; }) };
    }
    inv.recvSaving = true; renderReceive(); $('rvMsg').className = 'muted'; $('rvMsg').textContent = 'Saving…';
    api.receivePurchase(inv.recvPending).then(function (r) {
      inv.recvSaving = false; inv.recvPending = null; inv.receive = newDelivery();
      renderReceive();
      var t = r.lines.reduce(function (a, l) { return a + sen(l.line_cost); }, 0);
      $('rvMsg').className = 'okc';
      $('rvMsg').textContent = (r.duplicate ? 'Already saved: ' : 'Received: ') + r.lines.map(function (l) { return qtyText(l.total_qty, l.base_unit) + ' ' + l.name; }).join(', ') + ' (' + rm(t) + ').';
      loadPurchases(); refreshProducts();
    }, function (e) {
      inv.recvSaving = false;
      if (e.kind === 'server') inv.recvPending = null;
      renderReceive(); fail($('rvMsg'), e);
    });
  }

  function loadPurchases() {
    api.getPurchases(addDaysLocal(-6), today()).then(function (r) { inv.purchases = r; renderPurchases(); }, function (e) { if ($('rvList')) $('rvList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function renderPurchases() {
    if (!$('rvList') || !inv.purchases) return;
    var by = {}; var order = [];
    inv.purchases.rows.forEach(function (x) {
      if (x.status === 'reversal') return;
      if (!by[x.purchase_id]) { by[x.purchase_id] = { id: x.purchase_id, x: x, lines: [], sen: 0 }; order.push(x.purchase_id); }
      by[x.purchase_id].lines.push(qtyText(x.total_qty, x.base_unit) + ' ' + x.name);
      by[x.purchase_id].sen += sen(x.line_cost);
    });
    $('rvList').innerHTML = order.length ? '<div class="scroll"><table><thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th class="n">Cost</th><th></th></tr></thead><tbody>' +
      order.map(function (id) {
        var e = by[id];
        return '<tr class="' + (e.x.status === 'reversed' ? 'void' : '') + '"><td>' + esc(dmy(e.x.datetime)) + '</td><td>' + esc(e.x.supplier) +
          (e.x.invoice_no ? ' <span class="tag">' + esc(e.x.invoice_no) + '</span>' : '') + '</td><td>' + esc(e.lines.join(', ')) + '</td>' +
          '<td class="n">' + rm(e.sen) + '</td><td>' + (e.x.status === 'received' ? '<button class="ghost" data-prev="' + esc(id) + '">Reverse</button>' : 'reversed') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No deliveries in the last 7 days.</p>';
  }

  function reversePurchaseModal(id) {
    openModal('<h2>Reverse delivery</h2><p>The stock is taken back out and the average cost worked back. Nothing is deleted.</p>' +
      '<label>Reason (required)<input id="prReason" maxlength="200"></label><p id="prMsg"></p>' +
      '<div class="actions"><button id="prCancel" class="ghost">Cancel</button><button id="prGo" class="danger">Reverse</button></div>');
    $('prCancel').onclick = closeModal;
    $('prGo').onclick = function () {
      var reason = $('prReason').value.trim();
      if (reason.length < 3) { $('prMsg').className = 'err'; $('prMsg').textContent = 'Please give a reason.'; return; }
      busy($('prGo'), true, 'Reversing…');
      api.reversePurchase(id, reason, getStaff()).then(function () { closeModal(); toast('Delivery reversed.'); loadPurchases(); refreshProducts(); },
        function (e) { busy($('prGo'), false, 'Reverse'); fail($('prMsg'), e); });
    };
  }

  // ---- Recipes ----

  function loadRecipes() {
    if (!inv.recipes) $('inv-recipes').innerHTML = '<p class="muted">Loading…</p>';
    api.getRecipes().then(function (r) { inv.recipes = r; renderRecipes(); }, function (e) { $('inv-recipes').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function renderRecipes() {
    var list = inv.recipes.slice().sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
    $('inv-recipes').innerHTML = '<p class="muted">A sale takes each item itself (if it tracks stock) plus its recipe. Quantities are per serving.</p>' +
      '<div class="scroll"><table><thead><tr><th>Menu item</th><th>Takes from stock</th><th class="n">Cost</th><th class="n">Price</th><th class="n">Margin</th><th></th></tr></thead><tbody>' +
      list.map(function (r) {
        return '<tr class="' + (r.active ? '' : 'void') + '"><td>' + esc(r.name) + '</td><td>' + (r.warning ? '<span class="warn">' + esc(r.warning) + '</span>' : esc(r.deducts)) + '</td>' +
          '<td class="n">' + (r.lines.length || r.deducts ? rm(sen(r.cost)) + (r.cost_missing ? ' <span class="warn" title="Some parts have no cost">*</span>' : '') : '—') + '</td>' +
          '<td class="n">' + rm(sen(r.price)) + '</td><td class="n">' + (r.margin_percent === null ? '—' : rm(sen(r.margin)) + ' <span class="muted">' + r.margin_percent + '%</span>') + '</td>' +
          '<td><button class="ghost" data-recipe="' + esc(r.menu_product_id) + '">Edit</button></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">* some parts have no cost yet, so cost and margin are incomplete.</p>';
  }

  function recipeModal(menuId) {
    var r = inv.recipes.filter(function (x) { return x.menu_product_id === menuId; })[0];
    var rows = r.lines.map(function (l, i) { return { key: 'r' + i, ingredient_id: l.ingredient_id, qty: String(l.qty), note: l.note }; });
    var items = stockable().filter(function (p) { return p.id !== menuId; });
    var draw = function () {
      var costSen = 0; var missing = false;
      rows.forEach(function (x) {
        var p = productById(x.ingredient_id);
        if (!p || !(Number(x.qty) > 0)) return;
        if (p.cost === '') missing = true; else costSen += Number(p.cost) * 100 * Number(x.qty);
      });
      $('rcLines').innerHTML = rows.map(function (x) {
        var p = productById(x.ingredient_id);
        return '<div class="row" data-rcl="' + x.key + '"><select data-rc="ingredient_id" style="flex:2">' + itemOptions(items, x.ingredient_id, 'Choose…') + '</select>' +
          '<input data-rc="qty" class="qtyin" inputmode="decimal" value="' + esc(x.qty) + '"><span class="muted">' + esc(p ? p.unit : '') + '</span>' +
          '<button class="ghost" data-rcdel="' + x.key + '" aria-label="Remove">✕</button></div>';
      }).join('') || '<p class="muted">No ingredients: this item takes nothing from stock except itself (if it tracks stock).</p>';
      $('rcCost').textContent = 'Recipe cost about ' + rm(Math.round(costSen)) + (missing ? ' (some ingredients have no cost)' : '') +
        (r.deducts.indexOf('itself') === 0 ? ', plus the item itself' : '') + '. Price ' + rm(sen(r.price)) + '.';
    };
    openModal('<h2>Recipe: ' + esc(r.name) + '</h2><p class="muted">Per serving, in each ingredient\'s unit (ml, g, pcs).</p>' +
      '<div id="rcLines"></div><button class="ghost" id="rcAdd">Add ingredient</button><p id="rcCost" class="muted"></p><p id="rcMsg"></p>' +
      '<div class="actions"><button id="rcCancel" class="ghost">Cancel</button><button id="rcSave" class="primary">Save recipe</button></div>');
    draw();
    var n = rows.length;
    $('rcAdd').onclick = function () { rows.push({ key: 'r' + (++n), ingredient_id: '', qty: '', note: '' }); draw(); };
    $('rcLines').addEventListener('input', function (e) {
      var k = e.target.closest('[data-rcl]').dataset.rcl;
      rows.forEach(function (x) { if (x.key === k) x[e.target.dataset.rc] = e.target.value; });
      if (e.target.dataset.rc === 'ingredient_id') draw(); else { var keep = e.target; draw(); var again = $('rcLines').querySelector('[data-rcl="' + k + '"] [data-rc="qty"]'); again.focus(); again.setSelectionRange(keep.value.length, keep.value.length); }
    });
    $('rcLines').addEventListener('change', function (e) { if (e.target.dataset.rc === 'ingredient_id') { var k = e.target.closest('[data-rcl]').dataset.rcl; rows.forEach(function (x) { if (x.key === k) x.ingredient_id = e.target.value; }); draw(); } });
    $('rcLines').addEventListener('click', function (e) { var b = e.target.closest('[data-rcdel]'); if (b) { rows = rows.filter(function (x) { return x.key !== b.dataset.rcdel; }); draw(); } });
    $('rcCancel').onclick = closeModal;
    $('rcSave').onclick = function () {
      var lines = rows.filter(function (x) { return x.ingredient_id || x.qty; });
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].ingredient_id) { $('rcMsg').className = 'err'; $('rcMsg').textContent = 'Choose the ingredient on line ' + (i + 1) + '.'; return; }
        if (!(Number(lines[i].qty) > 0)) { $('rcMsg').className = 'err'; $('rcMsg').textContent = 'Quantity on line ' + (i + 1) + ' must be more than 0.'; return; }
      }
      busy($('rcSave'), true, 'Saving…');
      api.saveRecipe(menuId, lines.map(function (x) { return { ingredient_id: x.ingredient_id, qty: Number(x.qty), note: x.note }; })).then(function () {
        closeModal(); toast('Recipe saved.'); loadRecipes();
      }, function (e) { busy($('rcSave'), false, 'Save recipe'); fail($('rcMsg'), e); });
    };
  }

  // ---- Containers ----

  var OPEN_REASONS = { first_finished: 'First one is finished', other_station: 'For another station', first_contaminated: 'First one contaminated',
    first_expired: 'First one expired', other: 'Other' };
  var DISCARD_REASONS = { expired_after_open: 'Expired after opening', spilled: 'Spilled', contaminated: 'Contaminated', other: 'Other' };

  function loadContainers() {
    if (!inv.containers) $('inv-containers').innerHTML = '<p class="muted">Loading…</p>';
    api.getContainers().then(function (r) { inv.containers = r; renderContainers(); }, function (e) { $('inv-containers').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function renderContainers() {
    var c = inv.containers;
    var openable = state.allProducts.filter(function (p) { return p.track_open && p.track_stock; });
    var name = function (id) { var p = productById(id); return p ? p.name : id; };
    var unit = function (id) { var p = productById(id); return p ? p.unit : ''; };
    $('inv-containers').innerHTML = '<div class="card"><h3 class="flat">Open a container</h3>' +
      (openable.length ? '<div class="form-grid"><label>Item<select id="ocItem">' + itemOptions(openable, inv.ocItem || '', 'Choose…') + '</select></label>' +
        '<label>Station<input id="ocStation" maxlength="30" value="' + esc(inv.ocStation || 'bar') + '"></label><label>Your name<input id="ocBy" maxlength="40" value="' + esc(getStaff()) + '"></label></div>' +
        '<div id="ocWarn">' + (inv.ocWarn || '') + '</div><p id="ocMsg"></p><div class="actions two"><span></span><button class="primary" id="ocGo">Open</button></div>'
        : '<p class="muted">No items are set up for open containers. In Products, give an ingredient a pack size and tick "Track open containers".</p>') + '</div>' +
      '<h3>Open now</h3>' + (c.open.length ? '<div class="scroll"><table><thead><tr><th>Item</th><th>Opened</th><th>Use by</th><th class="n">Left (est.)</th><th></th></tr></thead><tbody>' +
        c.open.map(function (k) {
          return '<tr class="' + k.use_by_flag + '"><td>' + esc(name(k.ingredient_id)) + ' <span class="tag">' + esc(k.station) + '</span>' + (k.overrun ? ' <span class="tag">overrun</span>' : '') + '</td>' +
            '<td>' + esc(dmy(k.opened_at)) + (k.opened_by ? ' · ' + esc(k.opened_by) : '') + '</td><td>' + (k.use_by ? esc(dmy(k.use_by)) + (k.use_by_flag === 'past' ? ' (past)' : k.use_by_flag === 'near' ? ' (soon)' : '') : '—') + '</td>' +
            '<td class="n">' + esc(qtyText(k.est_remaining, unit(k.ingredient_id))) + '</td><td><div class="row" style="margin:0">' +
            '<button class="ghost" data-cfin="' + esc(k.container_id) + '">Finished</button><button class="ghost" data-cdis="' + esc(k.container_id) + '">Discard</button></div></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing open.</p>') +
      (c.double_opens.length ? '<h3>Opened while another was open (7 days)</h3><div class="scroll"><table><tbody>' + c.double_opens.map(function (k) {
        return '<tr><td>' + esc(dmy(k.opened_at)) + '</td><td>' + esc(name(k.ingredient_id)) + '</td><td>' + esc(k.opened_by) + '</td><td>' + esc(OPEN_REASONS[k.open_reason] || k.open_reason) + (k.note ? ': ' + esc(k.note) : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '') +
      (c.closed.length ? '<h3>Finished and discarded (7 days)</h3><div class="scroll"><table><thead><tr><th>Item</th><th>Closed</th><th class="n">Recipes used</th><th class="n">Variance</th></tr></thead><tbody>' + c.closed.map(function (k) {
        return '<tr><td>' + esc(name(k.ingredient_id)) + (k.status === 'discarded' ? ' <span class="tag">discarded: ' + esc(DISCARD_REASONS[k.discarded_reason] || k.discarded_reason) + '</span>' : '') + '</td>' +
          '<td>' + esc(dmy(k.finished_at)) + '</td><td class="n">' + esc(qtyText(k.allocated_qty, unit(k.ingredient_id))) + ' of ' + esc(k.size) + '</td>' +
          '<td class="n ' + (k.variance < 0 ? 'past' : '') + '">' + (k.variance === '' ? '—' : esc(qtyText(k.variance, unit(k.ingredient_id)))) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">Variance = size − what the recipes used. Above 0: more was left than the recipes explain; below 0: more was used (over-pouring or spills).</p>' : '');
  }

  function openContainer(reason, note) {
    var item = $('ocItem').value;
    inv.ocItem = item; inv.ocStation = $('ocStation').value.trim();
    var by = $('ocBy').value.trim();
    var msg = $('ocMsg');
    if (!item) { msg.className = 'err'; msg.textContent = 'Choose the item.'; return; }
    if (!by) { msg.className = 'err'; msg.textContent = 'Enter your name.'; return; }
    setStaff(by);
    if (!inv.openPending || inv.openPending.ingredient_id !== item) inv.openPending = { container_id: api.newSaleId(), ingredient_id: item };
    var req = { container_id: inv.openPending.container_id, ingredient_id: item, station: $('ocStation').value.trim() || 'bar', staff_name: by, reason: reason || '', note: note || '' };
    busy($('ocGo'), true, 'Opening…'); msg.className = 'muted'; msg.textContent = '';
    api.openContainer(req).then(function (r) {
      busy($('ocGo'), false, 'Open');
      if (r.needs_reason) {
        inv.ocWarn = '<div class="card"><p class="warn">' + esc(r.message) + '</p><p class="label">Why open another?</p><div class="reasons">' +
          Object.keys(OPEN_REASONS).map(function (k) { return '<button data-oreason="' + k + '">' + OPEN_REASONS[k] + '</button>'; }).join('') +
          '</div><label class="row">Note <input id="ocNote" maxlength="100" placeholder="required for Other"></label></div>';
        $('ocWarn').innerHTML = inv.ocWarn;
        return;
      }
      inv.openPending = null; inv.ocWarn = ''; inv.ocItem = '';
      toast(productById(item).name + ' opened' + (r.duplicate ? ' (already saved)' : '') + '.');
      loadContainers();
    }, function (e) { busy($('ocGo'), false, 'Open'); if (e.kind === 'server') inv.openPending = null; fail(msg, e); });
  }

  function finishContainer(id) {
    if (!confirm('Mark this container as finished (empty)?')) return;
    api.finishContainer(id, getStaff()).then(function (r) {
      toast('Finished. Variance ' + qtyText(r.container.variance, (productById(r.container.ingredient_id) || {}).unit || '') + '.'); loadContainers();
    }, function (e) { toast(e.message); });
  }

  function discardModal(id) {
    var pct = '';
    openModal('<h2>Discard the rest</h2><p>What is left is logged as ingredient waste.</p><p class="label">Reason</p><div class="reasons">' +
      Object.keys(DISCARD_REASONS).map(function (k) { return '<button data-dreason="' + k + '">' + DISCARD_REASONS[k] + '</button>'; }).join('') + '</div>' +
      '<p class="label">How much is left?</p><div class="pct">' + ['0%', '25%', '50%', '75%', '100%'].map(function (x) { return '<button data-dpct="' + x + '">' + x + '</button>'; }).join('') + '</div>' +
      '<label>…or a quantity<input id="dsQty" inputmode="decimal"></label><label>Note<input id="dsNote" maxlength="100" placeholder="required for Other"></label><p id="dsMsg"></p>' +
      '<div class="actions"><button id="dsCancel" class="ghost">Cancel</button><button id="dsGo" class="danger">Discard</button></div>');
    var reason = '';
    $('sheet').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dreason) { reason = b.dataset.dreason; $('sheet').querySelectorAll('[data-dreason]').forEach(function (x) { x.classList.toggle('on', x === b); }); }
      if (b.dataset.dpct) { pct = b.dataset.dpct; $('dsQty').value = ''; $('sheet').querySelectorAll('[data-dpct]').forEach(function (x) { x.classList.toggle('on', x === b); }); }
    });
    $('dsCancel').onclick = closeModal;
    $('dsGo').onclick = function () {
      var qty = $('dsQty').value.trim();
      var left = qty || pct;
      var m = $('dsMsg'); m.className = 'err';
      if (!reason) { m.textContent = 'Choose a reason.'; return; }
      if (!left) { m.textContent = 'Say how much is left.'; return; }
      if (reason === 'other' && $('dsNote').value.trim().length < 3) { m.textContent = 'Add a note for Other.'; return; }
      busy($('dsGo'), true, 'Discarding…');
      api.discardContainer(id, reason, left, $('dsNote').value.trim(), getStaff()).then(function (r) {
        closeModal(); toast('Discarded' + (r.wasted ? ': ' + r.wasted + ' logged as waste' : '') + '.'); loadContainers(); refreshProducts();
      }, function (e) { busy($('dsGo'), false, 'Discard'); fail(m, e); });
    };
  }

  // ---- Count ----

  function renderCount() {
    var items = state.allProducts.filter(function (p) { return p.track_stock; });
    var locked = !!inv.countPending;
    var dis = locked ? ' disabled' : '';
    $('inv-count').innerHTML = '<div class="card"><h3 class="flat">Stocktake</h3><p class="muted">Count what is on the shelf. Leave an item blank to skip it. ' +
      'For items in packs, count sealed packs and tap how full each open one is.</p>' +
      '<label class="row">Counted by <input id="ctBy" maxlength="40" value="' + esc(getStaff()) + '"' + dis + '></label>' +
      (items.length ? items.map(function (p) {
        var c = inv.count[p.id] || (inv.count[p.id] = { qty: '', packs: '', open: [], note: '' });
        var packs = !!p.pack_size;
        return '<div class="line-card" data-cnt="' + esc(p.id) + '"><div class="row"><b>' + esc(p.name) + '</b></div>' +
          (packs ? '<div class="row wrap">Sealed ' + esc(p.pack_unit || 'packs') + ' <input class="qtyin" data-cf="packs" inputmode="numeric" value="' + esc(c.packs) + '"' + dis + '>' +
            '<span class="muted">× ' + esc(p.pack_size) + ' ' + esc(p.unit) + '</span></div>' +
            '<div class="row wrap"><span>Open:</span>' + c.open.map(function (o, i) { return '<span class="tag">' + esc(o) + ' <button class="ghost" data-cdel="' + i + '"' + dis + ' style="min-height:28px;padding:0 6px">✕</button></span>'; }).join(' ') +
            '<div class="pct">' + ['25%', '50%', '75%', '100%'].map(function (x) { return '<button data-cadd="' + x + '"' + dis + '>+' + x + '</button>'; }).join('') + '</div></div>' +
            '<div class="row">or total <input class="qtyin" data-cf="qty" inputmode="decimal" value="' + esc(c.qty) + '"' + dis + '><span class="muted">' + esc(p.unit) + '</span></div>'
            : '<div class="row">Counted <input class="qtyin" data-cf="qty" inputmode="decimal" value="' + esc(c.qty) + '"' + dis + '><span class="muted">' + esc(p.unit) + '</span></div>') +
          '<div class="row"><input data-cf="note" maxlength="200" placeholder="Reason if it is far off" value="' + esc(c.note) + '"' + dis + '></div></div>';
      }).join('') : '<p class="muted">No items track stock yet.</p>') +
      '<p id="ctMsg"></p><div class="actions two"><button class="ghost" id="ctClear">Clear</button><button class="primary" id="ctSave">' +
      (inv.countSaving ? 'Saving…' : locked ? 'Try again' : 'Confirm count') + '</button></div></div><div id="ctResult"></div>';
    if (inv.countSaving) $('ctSave').disabled = true;
    if (inv.countResult) renderCountResult();
  }

  function saveCount() {
    if (inv.countSaving) return;
    var msg = $('ctMsg');
    if (!inv.countPending) {
      var by = $('ctBy').value.trim();
      if (!by) { msg.className = 'err'; msg.textContent = 'Enter who counted.'; return; }
      var lines = [];
      Object.keys(inv.count).forEach(function (id) {
        var c = inv.count[id];
        if (c.qty !== '') lines.push({ ingredient_id: id, counted_qty: Number(c.qty), note: c.note });
        else if (c.packs !== '' || c.open.length) lines.push({ ingredient_id: id, sealed_packs: Number(c.packs || 0), open: c.open, note: c.note });
      });
      if (!lines.length) { msg.className = 'err'; msg.textContent = 'Count at least one item.'; return; }
      if (lines.some(function (l) { return looksLikeCard(l.note); })) { msg.className = 'err'; msg.textContent = 'Remove the card number.'; return; }
      setStaff(by);
      inv.countPending = { count_id: api.newSaleId(), counted_by: by, lines: lines };
    }
    inv.countSaving = true; renderCount();
    $('ctMsg').className = 'muted'; $('ctMsg').textContent = 'Saving…';
    api.stockCount(inv.countPending).then(function (r) {
      inv.countSaving = false; inv.countPending = null; inv.count = {}; inv.countResult = r;
      refreshProducts().then(renderCount);
    }, function (e) {
      inv.countSaving = false;
      if (e.kind === 'server') inv.countPending = null; // e.g. a line needs a reason: fix it and confirm again
      renderCount(); fail($('ctMsg'), e);
    });
  }

  function renderCountResult() {
    var r = inv.countResult;
    var lines = r.lines.slice().sort(function (a, b) { return Math.abs(Number(b.variance_value) || 0) - Math.abs(Number(a.variance_value) || 0); });
    $('ctResult').innerHTML = '<h3>Count saved' + (r.duplicate ? ' (already saved)' : '') + '</h3><div class="scroll"><table><thead><tr><th>Item</th><th class="n">Counted</th>' +
      '<th class="n">Expected</th><th class="n">Variance</th><th class="n">Value</th></tr></thead><tbody>' + lines.map(function (l) {
        var u = (productById(l.ingredient_id) || {}).unit || '';
        return '<tr><td>' + esc(l.name) + (l.note ? ' <span class="tag">' + esc(l.note) + '</span>' : '') + '</td><td class="n">' + esc(qtyText(l.counted_qty, u)) + '</td>' +
          '<td class="n">' + esc(qtyText(l.expected_qty, u)) + '</td><td class="n ' + (l.variance < 0 ? 'past' : '') + '">' + esc(qtyText(l.variance, u)) + '</td>' +
          '<td class="n">' + (l.variance_value === '' ? '—' : rm(sen(l.variance_value))) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">Stock now equals the count. Each difference is recorded as a stocktake adjustment.</p>';
  }

  function addDaysLocal(n) {
    var t = new Date(today() + 'T12:00:00Z').getTime() + n * 864e5;
    return new Date(t).toISOString().slice(0, 10);
  }

  // Inventory clicks and inputs live here so the main handlers stay short.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.inv) showInv(d.inv);
    else if (b.id === 'rvAdd') { inv.receive.lines.push({ key: 'l' + Date.now(), ingredient_id: '', pack_qty: '1', pack_cost: '', batch_no: '', expiry_date: '' }); renderReceive(); renderPurchases(); }
    else if (d.rdel) { inv.receive.lines = inv.receive.lines.filter(function (l) { return l.key !== d.rdel; }); renderReceive(); renderPurchases(); }
    else if (b.id === 'rvSave') saveReceive();
    else if (b.id === 'rvClear') { if (!inv.recvSaving) { inv.recvPending = null; inv.receive = newDelivery(); renderReceive(); renderPurchases(); } }
    else if (d.prev) reversePurchaseModal(d.prev);
    else if (d.recipe) recipeModal(d.recipe);
    else if (b.id === 'ocGo') openContainer();
    else if (d.oreason) openContainer(d.oreason, $('ocNote') ? $('ocNote').value.trim() : '');
    else if (d.cfin) finishContainer(d.cfin);
    else if (d.cdis) discardModal(d.cdis);
    else if (d.cadd || d.cdel) {
      var id = b.closest('[data-cnt]').dataset.cnt;
      var c = inv.count[id];
      if (d.cadd) { c.open.push(d.cadd); c.qty = ''; } else c.open.splice(Number(d.cdel), 1);
      renderCount();
    }
    else if (b.id === 'ctSave') saveCount();
    else if (b.id === 'ctClear') { if (!inv.countSaving) { inv.countPending = null; inv.count = {}; inv.countResult = null; renderCount(); } }
  });

  function recvInput(e) {
    var t = e.target;
    var lineEl = t.closest('[data-rline]');
    if (lineEl && t.dataset.rf) {
      inv.receive.lines.forEach(function (l) { if (l.key === lineEl.dataset.rline) l[t.dataset.rf] = t.value; });
      if (e.type === 'change' || t.dataset.rf === 'ingredient_id') { renderReceive(); renderPurchases(); }
    }
    var cnt = t.closest('[data-cnt]');
    if (cnt && t.dataset.cf) {
      var c = inv.count[cnt.dataset.cnt];
      c[t.dataset.cf] = t.value;
      if (t.dataset.cf === 'qty' && t.value !== '') { c.packs = ''; c.open = []; }
    }
  }
  document.addEventListener('change', recvInput);
  document.addEventListener('change', function (e) {
    if (e.target.id === 'ocItem' && e.target.value !== inv.ocItem) { inv.ocItem = e.target.value; inv.ocWarn = ''; inv.openPending = null; $('ocWarn').innerHTML = ''; }
  });
  document.addEventListener('input', function (e) { if (e.target.closest('[data-cnt]')) recvInput(e); });

  // ---------- opening and closing the day ----------
  // A cashier or supervisor records the opening cash (the float) when they start. At closing everyone sees a tally of the day's
  // transactions (a cashier: their own) and counts the cash: expected = opening cash + cash sales. A supervisor or admin also gets
  // the stock checklist for tomorrow; an admin sees every transaction in detail. The server decides what each role receives.
  // The tally opens first; the stock list and the transactions arrive a moment later.

  var closing = { data: null, closeId: '', openId: '', stock: null, detail: null, seq: 0 };

  function initClose() {
    var cashier = role() === 'cashier';
    if (!$('clDay').value || cashier) $('clDay').value = today();
    $('clDay').hidden = cashier; // a cashier works on today
    if (!closing.closeId) closing.closeId = api.newSaleId();
    if (!closing.openId) closing.openId = api.newSaleId();
    loadClosing();
  }

  function loadClosing() {
    var seq = ++closing.seq;
    $('clBody').innerHTML = '<p class="muted">Loading… this can take a few seconds.</p>';
    api.getClosing($('clDay').value || today()).then(function (c) {
      if (seq !== closing.seq) return;
      closing.data = c; closing.stock = null; closing.detail = null;
      if (c.date === c.today) { setSessionState(c.state); refreshAccess(); }
      renderClosing();
      if (c.state.opened || role() === 'admin') loadClosingExtras(seq, c.date);
    }).catch(function (e) {
      if (seq === closing.seq) $('clBody').innerHTML = '<p class="err">' + esc(e && e.message || 'Could not load.') + '</p><button id="clRefresh" class="ghost">Try again</button>';
    });
  }

  function loadClosingExtras(seq, day) {
    if (role() !== 'cashier') {
      api.getClosingStock().then(function (s) { if (seq === closing.seq) { closing.stock = s; renderShop(); } }, function (e) {
        if ($('clStock') && seq === closing.seq) $('clStock').innerHTML = '<h3>Stock to check for tomorrow</h3><p class="err">' + esc(e.message) + '</p>';
      });
    }
    if (role() === 'admin') {
      api.getClosingDetail(day).then(function (d) { if (seq === closing.seq) { closing.detail = d; renderDetail(); } }, function (e) {
        if ($('clDetail') && seq === closing.seq) $('clDetail').innerHTML = '<h3>All transactions</h3><p class="err">' + esc(e.message) + '</p>';
      });
    }
  }

  function clMsg(id, text, cls) { var m = $(id); if (m) { m.className = cls || ''; m.textContent = text || ''; } }

  // Cash is counted by notes and coins (sen values come from the server), never typed as one amount.
  function denomLabel(v) { return v >= 100 ? 'RM ' + (v / 100) : v + ' sen'; }
  function denomGrid(prefix, list) {
    return '<div class="denoms">' + list.map(function (v) {
      return '<label class="dn"><span>' + denomLabel(v) + '</span><input data-dn="' + prefix + '" data-v="' + v + '" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="0" aria-label="' +
        denomLabel(v) + ' count"><b>' + rm(0) + '</b></label>';
    }).join('') + '<p class="dn-total">Total counted: <b id="dnTotal-' + prefix + '">' + rm(0) + '</b></p></div>';
  }
  function readDenoms(prefix) {
    var parts = {};
    var total = 0;
    var bad = false;
    document.querySelectorAll('[data-dn="' + prefix + '"]').forEach(function (el) {
      var t = el.value.trim();
      if (t === '') return;
      var n = Number(t);
      if (!(n >= 0) || Math.floor(n) !== n) { bad = true; return; }
      if (n) { parts[el.dataset.v] = n; total += n * Number(el.dataset.v); }
    });
    return { parts: parts, sen: total, bad: bad };
  }

  function openingHtml(c) {
    var st0 = c.state || {};
    var canSet = (role() === 'cashier' || role() === 'supervisor') && c.date === c.today && !st0.closed && !st0.day_closed;
    var h = '<section class="block"><h3>Opening cash</h3>';
    if (c.mine) {
      h += '<p>You started with <b>' + rm(sen(c.mine.amount)) + '</b> (' + esc(String(c.mine.datetime).slice(11, 16)) + ').' +
        (canSet ? ' <button id="clOpenChange" class="ghost">Change</button>' : '') + '</p>';
    } else if (canSet) h += '<p class="warn">No opening cash recorded yet today.</p>';
    if (c.scope === 'all' && c.openings.length) {
      h += '<p class="muted">All drawers: ' + c.openings.map(function (o) { return esc(o.opened_by) + ' ' + rm(sen(o.amount)); }).join(' · ') +
        ' = <b>' + rm(sen(c.opening)) + '</b></p>';
    }
    if (canSet) {
      h += '<div id="clOpenForm"' + (c.mine ? ' hidden' : '') + '><p>Count the cash in the drawer to start, by notes and coins.</p>' + denomGrid('op', c.denoms) +
        (c.mine ? '<label class="row">Note <input id="clOpenNote" maxlength="150" autocomplete="off" placeholder="why it changed"></label>' : '') +
        '<p id="clOpenMsg"></p><div class="actions"><button id="clOpenGo" class="primary">Save opening cash</button></div></div>';
    } else if (c.scope === 'all' && !c.openings.length) h += '<p class="muted">No opening cash was recorded.</p>';
    return h + '</section>';
  }

  function renderClosing() {
    var c = closing.data;
    var own = c.scope === 'own';
    var st = c.state || {};
    var gated = role() !== 'admin' && st.required;
    if (gated && !st.opened) { // step 2: nothing else until they have opened
      setKpis('clKpis', '');
      $('clBody').innerHTML = '<section class="block"><h3>Step 2 of 4 · Open your session</h3><p>' +
        (st.day_closed ? 'The day is already closed. Opening starts again tomorrow.' : st.closed ? 'You already closed today. Opening starts again tomorrow.' :
          'Count the cash in the register, by notes and coins. Nothing else is available until you have opened.') + '</p></section>' + openingHtml(c);
      return;
    }
    var banner = '';
    if (gated) {
      banner = st.day_closed ? 'The day is closed. Checkout and voids are off for everyone until tomorrow. Waste can still be keyed in.'
        : st.closed ? 'You closed your session. Checkout is off for you until tomorrow. Waste can still be keyed in.'
        : 'Step 3 · business as usual. When you finish, count the cash below and close (step 4).';
    }
    setKpis('clKpis', kpi('cash', rm(sen(c.total_sales)), own ? 'my sales' : 'sales', 'good') + kpi('receipt', String(c.orders), 'orders') +
      kpi('alert', String(c.voided), 'voided', c.voided ? 'alert' : ''));
    var ms = Object.keys(c.by_method || {}).sort(function (a, b) { return c.by_method[b] - c.by_method[a]; });
    var extra = [];
    if (sen(c.discount)) extra.push('discounts ' + rm(sen(c.discount)));
    if (sen(c.service)) extra.push('service ' + rm(sen(c.service)));
    if (sen(c.tax)) extra.push('tax ' + rm(sen(c.tax)));
    if (sen(c.rounding)) extra.push('rounding ' + rm(sen(c.rounding)));
    var h = (banner ? '<p class="banner">' + esc(banner) + '</p>' : '') + openingHtml(c);
    h += '<section class="block"><h3>Tally · ' + esc(dmy(c.date)) + ' <span class="tag">' + (own ? 'your transactions' : 'all transactions') + '</span></h3>' +
      '<div class="scroll"><table><tbody>' +
      (ms.length ? ms.map(function (m) { return '<tr><td>' + esc(METHODS[m] || m) + '</td><td class="n">' + rm(sen(c.by_method[m])) + '</td></tr>'; }).join('')
        : '<tr><td class="muted">No sales yet.</td><td></td></tr>') +
      '<tr><td><b>Total sales</b> (' + c.orders + ' orders)</td><td class="n"><b>' + rm(sen(c.total_sales)) + '</b></td></tr>' +
      '<tr><td>Voided (' + c.voided + ')</td><td class="n">' + rm(sen(c.void_amount)) + '</td></tr></tbody></table></div>' +
      (extra.length ? '<p class="muted">Included above: ' + extra.join(' · ') + '</p>' : '') + '</section>';

    var noOpen = !c.opening && role() !== 'admin' && c.date === c.today;
    var isToday = c.date === c.today;
    var finished = role() !== 'admin' && (st.closed || st.day_closed);
    var canClose = isToday && !finished;
    var waiting = role() === 'supervisor' && c.waiting ? c.waiting : [];
    closing.label = role() === 'supervisor' ? 'Close the day' : role() === 'cashier' ? 'Close my session' : 'Record the day';
    h += '<section class="block"><h3>Cash drawer</h3><div class="scroll"><table><tbody>' +
      '<tr><td>Opening cash' + (own ? '' : ' (all drawers)') + '</td><td class="n">' + rm(sen(c.opening)) + '</td></tr>' +
      '<tr><td>Cash sales</td><td class="n">' + rm(sen(c.cash_sales)) + '</td></tr>' +
      (sen(c.approved_diff) ? '<tr><td>Cashier differences already approved</td><td class="n">' + rm(sen(c.approved_diff)) + '</td></tr>' : '') +
      '<tr><td><b>Should be in the drawer</b></td><td class="n"><b>' + rm(sen(c.cash_expected)) + '</b></td></tr></tbody></table></div>' +
      (noOpen ? '<p class="warn">No opening cash was recorded today, so this is cash sales only.</p>' : '');
    if (role() === 'admin') h += '<p class="muted">The admin has no cash drawer. This only records the day.</p>';
    else if (canClose) {
      h += '<p><b>Count the cash left in the drawer</b>, by notes and coins. You can only close when it tallies.</p>' + denomGrid('cl', c.denoms) +
        '<p id="clVar" class="muted"></p>' +
        '<div id="clApprove" class="approve" hidden><p><b>Mark <span id="clKind">shortage</span>.</b> It needs a note and a supervisor to approve' +
        (role() === 'supervisor' ? ' (a different supervisor from you)' : '') + '.</p>' +
        '<label class="row">Note <input id="clNote" maxlength="150" autocomplete="off" placeholder="why the cash is over or short"></label>' +
        '<label class="row">Supervisor ID <input id="clApId" autocomplete="off"></label>' +
        '<label class="row">Supervisor PIN <input id="clApPin" type="password" inputmode="numeric" autocomplete="off"></label></div>';
    }
    if (waiting.length) {
      h += '<p class="warn">These cashiers must close first: ' + waiting.map(function (x) { return esc(x.name) + ' (' + esc(x.emp_id) + ')'; }).join(', ') + '.</p>';
    }
    h += '<p id="clMsg"></p>' + (canClose ? '<div class="actions"><button id="clGo" class="primary"' + (waiting.length ? ' disabled' : '') + '>' + esc(closing.label) + '</button></div>'
      : !isToday ? '<p class="muted">Closing is only for today.</p>' : '') +
      (c.closings && c.closings.length ? '<p class="muted">Closed: ' + c.closings.map(function (x) {
        var s2 = x.cash_status;
        return esc(String(x.datetime).slice(11, 16)) + ' by ' + esc(x.closed_by) +
          (s2 === 'balanced' ? ' (cash tallied)' : s2 === 'shortage' || s2 === 'surplus' ? ' (' + s2 + ' ' + rm(Math.abs(sen(x.cash_variance))) + ', approved by ' + esc(x.approved_by) + ')' : '');
      }).join(' · ') + '</p>' : '') + '</section>';

    if (role() !== 'cashier') h += '<section class="block" id="clStock"><h3>Stock to check for tomorrow</h3><p class="muted">Loading…</p></section>';
    if (role() === 'admin') h += '<section class="block" id="clDetail"><h3>All transactions</h3><p class="muted">Loading…</p></section>';
    $('clBody').innerHTML = h;
    if (closing.stock) renderShop();
    if (closing.detail) renderDetail();
  }

  function renderDetail() {
    var el = $('clDetail');
    var d = closing.detail;
    if (!el || !d) return;
    var w = d.waste;
    var rows = d.transactions.map(function (t) {
      var items = t.items.map(function (it) { return esc(it.name) + ' x' + it.qty + (it.note ? ' (' + esc(it.note) + ')' : ''); }).join(', ');
      var v = t.status === 'void';
      return '<tr class="' + (v ? 'void' : '') + '"><td>' + esc(String(t.datetime).slice(11, 16)) + '</td><td>' + esc(t.receipt_no) + '</td>' +
        '<td>' + esc(t.cashier_name || t.cashier_id || '—') + (t.cashier_id ? ' <span class="muted">' + esc(t.cashier_id) + '</span>' : '') + '</td>' +
        '<td>' + items + '<br><span class="muted">' + (t.order_type === 'dine_in' ? 'Dine-in' + (t.table_no ? ' · table ' + esc(t.table_no) : '') : 'Takeaway') +
        (sen(t.discount) ? ' · discount ' + rm(sen(t.discount)) : '') + '</span>' +
        (v ? '<br><span class="tag">VOID</span> <span class="muted">' + esc(t.void_reason) +
          (t.voided ? ' · asked by ' + esc(t.voided.requested_by) + ', approved by ' + esc(t.voided.approved_by) : '') + '</span>' : '') + '</td>' +
        '<td>' + esc(METHODS[t.payment_method] || t.payment_method) + '</td><td class="n">' + rm(sen(t.total)) + '</td></tr>';
    }).join('');
    el.innerHTML = '<h3>All transactions · ' + d.transactions.length + '</h3>' +
      (d.transactions.length ? '<div class="scroll"><table><thead><tr><th>Time</th><th>Receipt</th><th>Cashier</th><th>Items</th><th>Paid by</th><th class="n">Total</th></tr></thead><tbody>' +
        rows + '</tbody></table></div>' : '<p class="muted">No transactions.</p>') +
      (w ? '<p>Waste today: <b>' + rm(sen(w.cost)) + '</b> in ' + w.entries + ' entries' + (sen(w.staff_meal_cost) ? ' · staff meals ' + rm(sen(w.staff_meal_cost)) : '') + '</p>' + staffLine(w.by_staff) : '');
  }

  // The stock checklist. An item stays here, unticked, at every closing until it is ticked (bought or handled).
  function renderShop() {
    var el = $('clStock');
    if (!el || !closing.stock) return;
    var list = closing.stock.list;
    var open = list.filter(function (x) { return x.status === 'open'; }).length;
    el.innerHTML = '<h3>Stock to check for tomorrow</h3>' +
      (list.length ? '<p class="muted">Tick an item when you have bought or sorted it. Unticked items stay on this list at every closing.</p>' +
        list.map(function (x) {
          var done = x.status === 'done';
          return '<label class="chk' + (done ? ' done' : '') + '"><input type="checkbox" data-shop="' + esc(x.product_id) + '"' + (done ? ' checked' : '') + '>' +
            '<span><b>' + esc(x.name) + '</b> <span class="muted">' + esc(x.reason) + '</span>' +
            (!done && x.days_open > 0 ? ' <span class="tag" title="First listed ' + esc(dmy(x.first_listed)) + '">waiting ' + x.days_open + (x.days_open === 1 ? ' day' : ' days') + '</span>' : '') +
            (done ? ' <span class="tag">bought</span>' : '') + '</span></label>';
        }).join('') + '<p>' + (open ? '<b>' + open + '</b> still to buy or check.' : 'All ticked.') + '</p>' +
        '<div class="actions"><button id="clCopy" class="ghost">Copy for notes</button></div>'
        : '<p class="muted">Nothing needs attention for tomorrow.</p>');
  }

  function shopText() {
    var c = closing.data;
    var lines = ['Stock to check for tomorrow (after closing ' + dmy(c.date) + ')'];
    var list = closing.stock ? closing.stock.list : [];
    if (!list.length) lines.push('Nothing needs attention.');
    list.forEach(function (x) {
      lines.push((x.status === 'done' ? '[x] ' : '[ ] ') + x.name + ': ' + x.reason + (x.status === 'open' && x.days_open > 0 ? ' (waiting since ' + dmy(x.first_listed) + ')' : ''));
    });
    return lines.join('\n');
  }

  function copyShop() {
    var t = shopText();
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var okc = false;
      try { okc = document.execCommand('copy'); } catch (er) { okc = false; }
      document.body.removeChild(ta);
      toast(okc ? 'Copied. Paste it into your notes.' : 'Could not copy. Select the list and copy it by hand.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Copied. Paste it into your notes.'); }, fallback);
    else fallback();
  }

  function shopTick(id, checked, el) {
    el.disabled = true;
    api.setShopItem(id, checked).then(function (r) { closing.stock.list = r.list; renderShop(); }, function (e) {
      el.checked = !checked; el.disabled = false; toast(e.message);
    });
  }

  // Updates a note-and-coin row and total as it is typed; for the closing count it also shows whether the cash tallies.
  function denomInput(el) {
    var prefix = el.dataset.dn;
    var n = Number(el.value.trim() || 0);
    el.parentNode.querySelector('b').textContent = rm(n >= 0 && Math.floor(n) === n ? n * Number(el.dataset.v) : 0);
    var d = readDenoms(prefix);
    var t = $('dnTotal-' + prefix);
    if (t) t.textContent = rm(d.sen);
    if (prefix === 'cl') cashVariance();
  }

  function cashVariance() {
    var el = $('clVar');
    if (!el || !closing.data) return;
    var d = readDenoms('cl');
    if (d.bad) { el.className = 'err'; el.textContent = 'Counts must be whole numbers.'; return; }
    var diff = d.sen - sen(closing.data.cash_expected);
    var box = $('clApprove');
    if (diff === 0) {
      el.className = 'okc'; el.textContent = 'The cash tallies. You can close the day.';
      if (box) box.hidden = true;
      $('clGo').textContent = closing.label || 'Close day';
    } else {
      var kind = diff > 0 ? 'surplus' : 'shortage';
      el.className = 'warn'; el.textContent = 'The cash does not tally: ' + kind + ' of ' + rm(Math.abs(diff)) + '. Check the count again, or mark it.';
      if (box) { box.hidden = false; $('clKind').textContent = kind + ' of ' + rm(Math.abs(diff)); }
      $('clGo').textContent = (closing.label || 'Close day') + ' with ' + kind;
    }
  }

  function openNow() {
    var d = readDenoms('op');
    var note = $('clOpenNote') ? $('clOpenNote').value.trim() : '';
    if (d.bad) return clMsg('clOpenMsg', 'Counts must be whole numbers.', 'err');
    if (looksLikeCard(note)) return clMsg('clOpenMsg', 'Remove the card number. Card numbers are never stored.', 'err');
    $('clOpenGo').disabled = true; $('clOpenGo').textContent = 'Saving…';
    api.setOpening(closing.openId, d.parts, note).then(function (c) {
      closing.openId = api.newSaleId(); closing.data = c; setSessionState(c.state);
      var was = currentView;
      renderClosing(); toast('Opening cash saved.');
      refreshAccess();
      if (sessionState.opened && role() !== 'admin') { loadClosingExtras(closing.seq, c.date); if (canSee('till')) show('till'); }
    }, function (e) {
      $('clOpenGo').disabled = false; $('clOpenGo').textContent = 'Save opening cash';
      clMsg('clOpenMsg', e.kind === 'network' ? 'Not saved. Try again. (' + e.message + ')' : e.message, 'err');
    });
  }

  function closeNow() {
    var c = closing.data;
    var payload = { close_id: closing.closeId, date: c.date, note: '' };
    if (role() !== 'admin') {
      var d = readDenoms('cl');
      if (d.bad) return clMsg('clMsg', 'Counts must be whole numbers.', 'err');
      payload.denoms = d.parts;
      var diff = d.sen - sen(c.cash_expected);
      if (diff !== 0) {
        payload.note = $('clNote').value.trim();
        payload.approver_id = $('clApId').value.trim();
        payload.approver_pin = $('clApPin').value;
        if (payload.note.length < 3) return clMsg('clMsg', 'Add a note saying why the cash is over or short.', 'err');
        if (!payload.approver_id || !payload.approver_pin) return clMsg('clMsg', 'A supervisor must approve: enter their ID and PIN.', 'err');
        if (looksLikeCard(payload.note)) return clMsg('clMsg', 'Remove the card number. Card numbers are never stored.', 'err');
      }
    }
    var label = $('clGo').textContent;
    $('clGo').disabled = true; $('clGo').textContent = 'Saving…'; clMsg('clMsg', 'Saving…', 'muted');
    api.closeDay(payload).then(function (r) {
      closing.closeId = api.newSaleId(); closing.data = r; setSessionState(r.state);
      renderClosing(); refreshAccess();
      toast(r.state.day_closed ? 'Day closed. Checkout is off for everyone until tomorrow.' : 'Session closed.');
    }, function (e) {
      $('clGo').disabled = false; $('clGo').textContent = label;
      clMsg('clMsg', e.kind === 'network' ? 'Not saved. Try again. (' + e.message + ')' : e.message, 'err');
    });
  }

  document.addEventListener('input', function (e) { if (e.target.dataset && e.target.dataset.dn) denomInput(e.target); });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'clDay') { closing.closeId = api.newSaleId(); loadClosing(); return; }
    var id = e.target.dataset && e.target.dataset.shop;
    if (id) shopTick(id, e.target.checked, e.target);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.id === 'clGo') closeNow();
    else if (b.id === 'clCopy') copyShop();
    else if (b.id === 'clRefresh') loadClosing();
    else if (b.id === 'clOpenGo') openNow();
    else if (b.id === 'clOpenChange') { $('clOpenForm').hidden = !$('clOpenForm').hidden; }
  });

  // ---------- sign-in, roles, approved voids, staff ----------
  // The server enforces every rule below; the screens only hide what a role can't use (hidden, not greyed out).

  var VIEWS_FOR = { cashier: ['till', 'waste', 'close'], supervisor: ['till', 'waste', 'stock', 'summary', 'close'], admin: ['waste', 'stock', 'summary', 'products', 'staff', 'close'] };
  var VOID_REASONS = { customer_changed: 'Customer changed order', wrong_item: 'Wrong item keyed in', payment_failed: 'Payment failed',
    duplicate: 'Duplicate bill', complaint: 'Customer complaint', other: 'Other' };
  var ROLE_LABEL = { cashier: 'Cashier', supervisor: 'Supervisor', admin: 'Admin' };
  var idleTimer = null;

  function me() { return api.session() || {}; }
  function role() { return me().role || ''; }
  // Step 1 sign in, step 2 open (count the register), step 3 sell, step 4 close (cash must tally). Until a cashier or supervisor has
  // opened, only the Open/Close screen is shown. After they close, checkout is off for them; after a supervisor closes the day it is
  // off for everyone. Waste stays. The server enforces all of it; the screens only hide what can't be used.
  var sessionState = { required: false, opened: true, closed: false, day_closed: false };
  var currentView = '';
  function allowedViews() {
    var base = (VIEWS_FOR[role()] || []).slice();
    if (role() === 'admin' || !sessionState.required) return sessionState.day_closed ? base.filter(function (v) { return v !== 'till'; }) : base;
    if (!sessionState.opened) return ['close'];
    return sessionState.closed || sessionState.day_closed ? base.filter(function (v) { return v !== 'till'; }) : base;
  }
  function canSee(view) { return allowedViews().indexOf(view) >= 0; }
  function setSessionState(st) { if (st) sessionState = st; }

  /** Re-applies what the person may see after opening, closing or an OPENING_REQUIRED reply. */
  function refreshAccess() {
    document.querySelectorAll('[data-view]').forEach(function (b) { b.hidden = !canSee(b.dataset.view); });
    moveThumb();
    var first = allowedViews()[0];
    if (!canSee(currentView)) show(first);
    if (role() !== 'admin' && canSee('till') && !state.allProducts.length) loadMenu();
  }

  function applyRole() {
    var r = role();
    document.body.dataset.role = r;
    document.querySelectorAll('[data-view]').forEach(function (b) { b.hidden = !canSee(b.dataset.view); });
    $('discRow').hidden = r !== 'supervisor';
    $('voidBill').hidden = !(r === 'cashier' || r === 'supervisor');
    var recipesTab = document.querySelector('[data-inv=recipes]');
    if (recipesTab) recipesTab.hidden = r !== 'admin'; // editing the menu is admin work
    tickShell();
    setSessionState(me().state);
    document.querySelectorAll('[data-view]').forEach(function (b) { b.hidden = !canSee(b.dataset.view); });
    var first = allowedViews()[0];
    show(first);
    if ((r === 'cashier' || r === 'supervisor') && sessionState.required && !sessionState.opened) { /* nothing to load until they open */ }
    else if (r === 'cashier' || r === 'supervisor') loadMenu(); else refreshProducts();
    resetIdle();
  }

  function showLogin(msg, mustChange) {
    $('login').hidden = false;
    $('loginNew').hidden = !mustChange;
    $('loginId').hidden = !!mustChange;
    $('loginTitle').textContent = mustChange ? 'Choose a new PIN' : 'Sign in';
    $('loginSub').textContent = mustChange ? 'Your PIN must be changed before you start. Enter the current PIN, then the new one twice.' : 'Employee ID and PIN';
    $('loginPin').placeholder = mustChange ? 'Current PIN' : 'PIN';
    $('loginGo').textContent = mustChange ? 'Save new PIN' : 'Sign in';
    $('loginPin').value = ''; $('loginPin2').value = ''; $('loginPin3').value = '';
    if (!mustChange) {
      $('loginId').value = ''; // shared till: no trace of who was here
      ['till', 'waste', 'stock', 'summary', 'products', 'staff'].forEach(function (v) { $('view-' + v).hidden = true; });
      ['staffBody', 'summary', 'slist', 'plist', 'wList'].forEach(function (id) { if ($(id)) $(id).innerHTML = ''; });
      $('cartBar').hidden = true; tickShell();
    }
    $('loginMsg').textContent = msg || '';
    (mustChange ? $('loginPin') : $('loginId')).focus();
  }

  function submitLogin(e) {
    if (e) e.preventDefault();
    var go = $('loginGo');
    if (go.disabled) return;
    var msg = $('loginMsg');
    var changing = !$('loginNew').hidden;
    var pin = $('loginPin').value;
    if (changing) {
      if ($('loginPin2').value !== $('loginPin3').value) { msg.textContent = 'The two new PINs don\'t match.'; return; }
      go.disabled = true; msg.textContent = '';
      api.changePin(pin, $('loginPin2').value).then(function () {
        go.disabled = false; $('login').hidden = true; toast('PIN changed.'); applyRole();
      }, function (er) { go.disabled = false; msg.textContent = er.message; });
      return;
    }
    var id = $('loginId').value.trim();
    if (!id || !pin) { msg.textContent = 'Enter your Employee ID and PIN.'; return; }
    go.disabled = true; go.textContent = 'Signing in…'; msg.textContent = '';
    api.login(id, pin).then(function (s) {
      go.disabled = false; go.textContent = 'Sign in';
      if (s.must_change_pin) { showLogin('', true); return; }
      $('login').hidden = true;
      applyRole();
    }, function (er) { go.disabled = false; go.textContent = 'Sign in'; $('loginPin').value = ''; msg.textContent = er.message; });
  }

  function signOut(msg) {
    clearTimeout(idleTimer);
    api.logout().then(function () {
      closeModal(); clearCart();
      state.allProducts = []; state.products = [];
      document.querySelectorAll('[data-view]').forEach(function (b) { b.hidden = true; });
      showLogin(msg || '');
    });
  }

  // Idle: sign out after the server's idle minutes without a tap or key (the server ends the session anyway).
  function resetIdle() {
    clearTimeout(idleTimer);
    var s = me();
    if (!s.token || state.saving || waste.saving) return;
    idleTimer = setTimeout(function () { if (!state.saving && !state.pending) signOut('Signed out after ' + (s.idle_minutes || 15) + ' minutes without use.'); }, (s.idle_minutes || 15) * 60000);
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { if (me().token) resetIdle(); }, true); });

  api.onAuth = function (e) {
    if (e.code === 'CHANGE_PIN') { showLogin('', true); return; }
    if (e.code === 'OPENING_REQUIRED') { sessionState.required = true; sessionState.opened = false; refreshAccess(); return; }
    clearTimeout(idleTimer);
    closeModal();
    showLogin(e.message);
  };

  function staffMenu() {
    var s = me();
    openModal('<h2>' + esc(s.name || '') + '</h2><p class="muted">' + esc(s.emp_id || '') + ' · <span class="role-badge">' + esc(ROLE_LABEL[s.role] || '') + '</span> · ' + esc(s.outlet || '') + '</p>' +
      '<label>Current PIN<input id="cpOld" type="password" inputmode="numeric" maxlength="6"></label>' +
      '<label>New PIN (4-6 digits)<input id="cpNew" type="password" inputmode="numeric" maxlength="6"></label>' +
      '<label>New PIN again<input id="cpNew2" type="password" inputmode="numeric" maxlength="6"></label><p id="cpMsg"></p>' +
      '<div class="actions"><button id="cpOut" class="ghost">Sign out</button><button id="cpGo" class="primary">Change PIN</button></div>');
    $('cpOut').onclick = function () { signOut(); };
    $('cpGo').onclick = function () {
      var m = $('cpMsg'); m.className = 'err';
      if ($('cpNew').value !== $('cpNew2').value) { m.textContent = 'The two new PINs don\'t match.'; return; }
      busy($('cpGo'), true, 'Saving…');
      api.changePin($('cpOld').value, $('cpNew').value).then(function () { closeModal(); toast('PIN changed.'); }, function (e) { busy($('cpGo'), false, 'Change PIN'); m.textContent = e.message; });
    };
  }

  // ---- void with supervisor approval ----

  function voidModal(saleId, no, total) {
    var cashier = role() === 'cashier';
    openModal('<h2>Void ' + esc(no) + (total !== undefined ? ' · ' + rm(sen(total)) : '') + '</h2>' +
      '<p class="warn">Supervisor approval required' + (cashier ? '. Ask a supervisor to enter their own ID and PIN.' : ': enter your own ID and PIN.') + '</p>' +
      '<p class="label">Was it already made?</p>' +
      '<div class="choice"><label><input type="radio" name="vMade" value="no"> No: put the ingredients back</label>' +
      '<label><input type="radio" name="vMade" value="yes"> Yes: log it as dish waste</label></div>' +
      '<label>Reason<select id="vReason"><option value="">Choose…</option>' + Object.keys(VOID_REASONS).map(function (k) {
        return '<option value="' + k + '">' + VOID_REASONS[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>Note (required for Other)<input id="vNote" maxlength="150" autocomplete="off"></label>' +
      '<div class="form-grid"><label>Supervisor ID<input id="vSv" autocomplete="off" autocapitalize="none" value="' + (cashier ? '' : esc(me().emp_id)) + '"></label>' +
      '<label>Supervisor PIN<input id="vPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></label></div><p id="vMsg"></p>' +
      '<div class="actions"><button id="vCancel" class="ghost">Cancel</button><button id="vGo" class="danger">Approve &amp; void</button></div>');
    $('vCancel').onclick = closeModal;
    $('vGo').onclick = function () {
      var m = $('vMsg'); m.className = 'err';
      var madeEl = document.querySelector('input[name=vMade]:checked');
      if (!madeEl) { m.textContent = 'Was it already made? Choose Yes or No.'; return; }
      if (!$('vReason').value) { m.textContent = 'Choose a reason.'; return; }
      if ($('vReason').value === 'other' && $('vNote').value.trim().length < 3) { m.textContent = 'Add a note for Other.'; return; }
      if (!$('vSv').value.trim() || !$('vPin').value) { m.textContent = 'A supervisor must enter their ID and PIN.'; return; }
      busy($('vGo'), true, 'Voiding…');
      api.voidSale(saleId, { reason: $('vReason').value, note: $('vNote').value.trim(), made: madeEl.value === 'yes',
        approver_id: $('vSv').value.trim(), approver_pin: $('vPin').value }).then(function (r) {
        closeModal();
        toast(no + ' voided' + (r.void_id ? ' (' + r.void_id + ', approved by ' + r.approved_by + ')' : '') + (r.made ? ', logged as dish waste.' : '.'));
        if (!$('view-summary').hidden) loadSummary();
        loadMenu();
      }, function (e) { busy($('vGo'), false, 'Approve & void'); $('vPin').value = ''; m.textContent = e.message; });
    };
  }

  function voidBillModal() {
    openModal('<h2>Void a bill</h2><p class="muted">Enter the receipt number from the receipt.</p>' +
      '<label>Receipt no.<input id="vbNo" placeholder="R000012" autocomplete="off" autocapitalize="characters"></label><div id="vbBill"></div><p id="vbMsg"></p>' +
      '<div class="actions"><button id="vbCancel" class="ghost">Cancel</button><button id="vbFind" class="primary">Find bill</button></div>');
    $('vbNo').focus();
    $('vbCancel').onclick = closeModal;
    $('vbFind').onclick = function () {
      busy($('vbFind'), true, 'Finding…');
      api.findSale($('vbNo').value).then(function (s) {
        busy($('vbFind'), false, 'Find bill');
        if (s.status === 'void') { $('vbMsg').className = 'warn'; $('vbMsg').textContent = s.receipt_no + ' is already void.'; return; }
        $('vbBill').innerHTML = '<div class="card">' + esc(s.receipt_no) + ' · ' + esc(dmy(s.datetime)) + '<br>' +
          esc(s.items.map(function (it) { return it.qty + ' × ' + it.name; }).join(', ')) + '<br><b>' + rm(sen(s.total)) + '</b> ' + esc(METHODS[s.payment_method] || '') + '</div>';
        $('vbFind').textContent = 'Void this bill';
        $('vbFind').onclick = function () { voidModal(s.sale_id, s.receipt_no, s.total); };
      }, function (e) { busy($('vbFind'), false, 'Find bill'); $('vbMsg').className = 'err'; $('vbMsg').textContent = e.message; });
    };
  }

  // ---- staff management and logs (admin) ----

  var staffTab = 'staff';
  var staffList = [];

  function loadStaff(sync) {
    var tab = staffTab;
    var body = $('staffBody');
    if (tab === 'staff') {
      if (!staffList.length) body.innerHTML = '<p class="muted">Loading…</p>';
      return api.listStaff(sync).then(function (r) { staffList = r.staff; renderStaff(r.hr_note); }, function (e) { body.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    }
    body.innerHTML = '<p class="muted">Loading…</p>';
    if (tab === 'voids') return api.getVoidLog({}).then(renderVoidLog, function (e) { body.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    return api.getAuditLog(tab === 'changes' ? 'change' : 'staff').then(function (r) {
      var cols = tab === 'changes' ? [['datetime', 'When'], ['actor', 'By'], ['entity', 'What'], ['field', 'Field'], ['old_value', 'Old'], ['new_value', 'New']]
        : [['datetime', 'When'], ['actor', 'By'], ['action', 'Action'], ['emp_id', 'Staff'], ['detail', 'Detail']];
      body.innerHTML = '<p class="muted">Read-only. Entries are only ever added, never changed or removed.</p>' + (r.rows.length ? '<div class="scroll"><table><thead><tr>' +
        cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' + r.rows.map(function (x) {
          return '<tr>' + cols.map(function (c) { return '<td>' + esc(c[0] === 'datetime' ? dmy(x[c[0]]) : x[c[0]]) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing in the last 30 days.</p>');
    }, function (e) { body.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function renderStaff(note) {
    var act = staffList.filter(function (s) { return s.status === 'active'; }).length;
    setKpis('staffKpis', kpi('tag', String(act), 'active') + kpi('alert', String(staffList.length - act), 'disabled or locked', staffList.length - act ? 'alert' : 'good'));
    $('staffBody').innerHTML = (note ? '<p class="warn">' + esc(note) + '</p>' : '') +
      '<div class="row wrap"><button class="primary" id="stAdd">Add staff from allurus-hr</button><button class="ghost" id="stSync">Check allurus-hr now</button></div>' +
      '<div class="scroll"><table><thead><tr><th>Staff</th><th>Role</th><th>Status</th><th>allurus-hr</th><th></th></tr></thead><tbody>' +
      staffList.map(function (s) {
        var self = s.emp_id === me().emp_id;
        return '<tr class="' + (s.status === 'active' ? '' : 'disabled') + '"><td><b>' + esc(s.name) + '</b><br><span class="muted">' + esc(s.emp_id) + '</span></td>' +
          '<td>' + (s.emp_id === 'admin' || self ? '<span class="role-badge">' + esc(ROLE_LABEL[s.role]) + '</span>'
            : '<select data-strole="' + esc(s.emp_id) + '" aria-label="Role">' + ['cashier', 'supervisor', 'admin'].map(function (r) {
              return '<option value="' + r + '"' + (r === s.role ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>'; }).join('') + '</select>') + '</td>' +
          '<td>' + (s.status === 'active' ? 'Active' : s.status === 'locked' ? '<span class="err">Locked</span> (5 wrong PINs)' : '<span class="warn">Disabled</span>') +
          (s.must_change_pin ? '<br><span class="muted">must change PIN</span>' : '') + '</td><td>' + esc(s.hr_status) + '</td>' +
          '<td><div class="row" style="margin:0">' + '<button class="ghost" data-stpin="' + esc(s.emp_id) + '">Reset PIN</button>' +
          (s.emp_id === 'admin' || self ? '' : s.status === 'active' ? '<button class="ghost" data-stoff="' + esc(s.emp_id) + '">Disable</button>'
            : '<button class="ghost" data-ston="' + esc(s.emp_id) + '">' + (s.status === 'locked' ? 'Unlock' : 'Enable') + '</button>') + '</div></td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">Staff can only come from allurus-hr. Anyone resigned there is disabled here at the next check (hourly).</p>';
  }

  function renderVoidLog(r) {
    var by = function (k) { var o = {}; r.rows.forEach(function (x) { o[x[k]] = true; }); return Object.keys(o); };
    $('staffBody').innerHTML = '<p class="muted">Read-only. Every void, who asked and which supervisor approved it.</p>' +
      '<div class="row wrap"><select id="vlSv"><option value="">All supervisors</option>' + by('approved_by').map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<select id="vlCa"><option value="">All requesters</option>' + by('requested_by').map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<select id="vlRe"><option value="">All reasons</option>' + Object.keys(r.reasons).map(function (k) { return '<option value="' + k + '">' + esc(r.reasons[k]) + '</option>'; }).join('') + '</select></div>' +
      '<div id="vlRows"></div>';
    var draw = function () {
      var sv = $('vlSv').value, ca = $('vlCa').value, re = $('vlRe').value;
      var rows = r.rows.filter(function (x) { return (!sv || x.approved_by === sv) && (!ca || x.requested_by === ca) && (!re || x.reason === r.reasons[re]); });
      $('vlRows').innerHTML = rows.length ? '<div class="scroll"><table><thead><tr><th>Void</th><th>When</th><th>Bill</th><th class="n">Amount</th><th>Asked by</th><th>Approved by</th><th>Reason</th></tr></thead><tbody>' +
        rows.map(function (x) {
          return '<tr><td>' + esc(x.void_id) + '</td><td>' + esc(dmy(x.datetime)) + '</td><td>' + esc(x.receipt_no) + '<br><span class="muted">' + esc(x.items) + '</span></td>' +
            '<td class="n">' + rm(sen(x.amount)) + '</td><td>' + esc(x.requested_by) + '</td><td>' + esc(x.approved_by) + '</td><td>' + esc(x.reason) + (x.note ? ': ' + esc(x.note) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">No voids match.</p>';
    };
    ['vlSv', 'vlCa', 'vlRe'].forEach(function (id) { $(id).addEventListener('change', draw); });
    draw();
  }

  function addStaffModal() {
    openModal('<h2>Add staff from allurus-hr</h2><p class="muted">Search by name or employee ID. Only people HR has added can be chosen.</p>' +
      '<div class="row"><input id="asQ" placeholder="Name or employee ID" autocomplete="off"><button class="ghost" id="asFind">Search</button></div>' +
      '<div id="asList"></div><div id="asForm" hidden><div class="form-grid"><label>Role<select id="asRole"><option value="cashier">Cashier</option>' +
      '<option value="supervisor">Supervisor</option><option value="admin">Admin</option></select></label>' +
      '<label>Starting PIN (4-6 digits)<input id="asPin" type="password" inputmode="numeric" maxlength="6"></label></div>' +
      '<p class="muted">They must change this PIN the first time they sign in.</p></div><p id="asMsg"></p>' +
      '<div class="actions"><button id="asCancel" class="ghost">Cancel</button><button id="asGo" class="primary" disabled>Add</button></div>');
    var pick = null;
    var find = function () {
      $('asList').innerHTML = '<p class="muted">Searching allurus-hr…</p>';
      api.hrSearch($('asQ').value.trim()).then(function (list) {
        $('asList').innerHTML = list.length ? '<div class="choice">' + list.map(function (h) {
          var ok = h.active && !h.pos_role;
          return '<label><input type="radio" name="asPick" value="' + esc(h.emp_id) + '"' + (ok ? '' : ' disabled') + '><span><b>' + esc(h.name) + '</b> · ' + esc(h.emp_id) +
            '<br><span class="muted">' + esc(h.job) + (h.pos_role ? ' · already ' + esc(ROLE_LABEL[h.pos_role]) : !h.active ? ' · ' + esc(h.hr_status) : '') + '</span></span></label>';
        }).join('') + '</div>' : '<p class="muted">Nobody matches in allurus-hr.</p>';
      }, function (e) { $('asList').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    };
    $('asFind').onclick = find;
    $('asQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') find(); });
    $('asList').addEventListener('change', function (e) { pick = e.target.value; $('asForm').hidden = false; $('asGo').disabled = false; });
    $('asCancel').onclick = closeModal;
    $('asGo').onclick = function () {
      busy($('asGo'), true, 'Adding…');
      api.addStaff(pick, $('asRole').value, $('asPin').value).then(function (s) { closeModal(); toast(s.name + ' added as ' + ROLE_LABEL[s.role] + '.'); staffList = []; loadStaff(); },
        function (e) { busy($('asGo'), false, 'Add'); $('asMsg').className = 'err'; $('asMsg').textContent = e.message; });
    };
    find();
  }

  function staffChange(empId, change, done) {
    api.updateStaff(empId, change).then(function (s) { toast(done || 'Saved.'); staffList = staffList.map(function (x) { return x.emp_id === s.emp_id ? s : x; }); renderStaff(); },
      function (e) { toast(e.message); loadStaff(); });
  }

  function resetPinModal(empId) {
    openModal('<h2>Reset PIN: ' + esc(empId) + '</h2><label>New PIN (4-6 digits)<input id="rpPin" type="password" inputmode="numeric" maxlength="6"></label>' +
      '<p class="muted">They must change it at their next sign-in. Any open session of theirs ends now.</p><p id="rpMsg"></p>' +
      '<div class="actions"><button id="rpCancel" class="ghost">Cancel</button><button id="rpGo" class="primary">Reset PIN</button></div>');
    $('rpCancel').onclick = closeModal;
    $('rpGo').onclick = function () {
      busy($('rpGo'), true, 'Saving…');
      api.updateStaff(empId, { reset_pin: $('rpPin').value }).then(function () { closeModal(); toast('PIN reset.'); loadStaff(); },
        function (e) { busy($('rpGo'), false, 'Reset PIN'); $('rpMsg').className = 'err'; $('rpMsg').textContent = e.message; });
    };
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.lk) {
      var target = !$('loginNew').hidden && document.activeElement && /loginPin[23]/.test(document.activeElement.id) ? document.activeElement : $('loginPin');
      if (d.lk === 'C') target.value = ''; else if (d.lk === '⌫') target.value = target.value.slice(0, -1); else if (target.value.length < 6) target.value += d.lk;
      target.focus();
    }
    else if (b.id === 'staffChip') { if (me().token) staffMenu(); }
    else if (b.id === 'voidBill') voidBillModal();
    else if (d.stab) {
      staffTab = d.stab;
      document.querySelectorAll('#staffTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      loadStaff();
    }
    else if (b.id === 'stAdd') addStaffModal();
    else if (b.id === 'stSync') { b.disabled = true; loadStaff(true).then(function () { toast('Checked against allurus-hr.'); }); }
    else if (d.stpin) resetPinModal(d.stpin);
    else if (d.stoff) staffChange(d.stoff, { status: 'disabled' }, 'Disabled.');
    else if (d.ston) staffChange(d.ston, { status: 'active' }, 'Enabled.');
  });
  document.addEventListener('change', function (e) {
    var r = e.target.dataset && e.target.dataset.strole;
    if (r) staffChange(r, { role: e.target.value }, 'Role changed to ' + ROLE_LABEL[e.target.value] + '.');
  });
  $('loginForm').addEventListener('submit', submitLogin);

  // ---------- wiring ----------

  function show(view) {
    document.querySelectorAll('.tab, .rail-btn[data-view]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (!view) return;
    currentView = view;
    ['till', 'waste', 'stock', 'summary', 'products', 'staff', 'close'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
    if (view === 'staff') loadStaff(true);
    moveThumb();
    renderCart();
    if (view === 'summary') loadSummary();
    if (view === 'close') initClose();
    if (view === 'products') loadProducts();
    if (view === 'waste') { $('wStaff').value = getStaff(); $('wStaff').readOnly = true; renderWasteGrid(); renderWasteForm(); refreshProducts(); loadWasteList(); }
    if (view === 'stock') { showInv(inv.tab); refreshProducts(); }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.view) { if (canSee(d.view)) show(d.view); }
    else if (d.cat) { state.cat = d.cat; renderMenu(); }
    else if (d.add) add(d.add);
    else if (d.type) { if (!cartLocked()) { state.orderType = d.type; renderCart(); } }
    else if (d.q) {
      if (cartLocked()) return;
      var key = b.closest('li').dataset.key;
      state.cart = state.cart.filter(function (l) { if (l.key === key) l.qty += Number(d.q); return l.qty > 0; });
      renderCart();
    }
    else if (d.m) payModal(d.m);
    else if (d.recv) { $('recv').value = (Number(d.recv) / 100).toFixed(2); updateChange(); }
    else if (d.void) voidModal(d.void, d.no, d.total);
    else if (d.show) api.getSale(d.show).then(function (s) { receiptModal(s, 0); }, function (er) { toast(er.message); });
    else if (d.edit) productModal(d.edit);
    else if (d.wcat) { waste.cat = d.wcat; renderWasteGrid(); }
    else if (d.wadd) wasteAdd(d.wadd);
    else if (d.wreason) { if (!wasteLocked()) { waste.reason = d.wreason; renderWasteForm(); } }
    else if (d.wq) {
      if (wasteLocked()) return;
      var wk = b.closest('li').dataset.wkey;
      waste.lines = waste.lines.filter(function (l) {
        if (l.key === wk) l.qty = Math.round((Number(l.qty) + Number(d.wq) * stepOf(l.unit)) * 1000) / 1000;
        return l.qty > 0;
      });
      renderWasteForm();
    }
    else if (d.wrev) reverseModal(d.wrev);
    else if (d.sin) stockModal(d.sin, 'stock_in');
    else if (d.sadj) stockModal(d.sadj, 'adjustment');
    else if (b.id === 'wLog') logWaste();
    else if (b.id === 'wClear') clearWaste();
    else if (b.id === 'sRefresh') refreshProducts();
    else if (b.id === 'pay') { if (state.cart.length) payModal(state.pending ? null : 'cash', !!state.pending); }
    else if (b.id === 'payGo') confirmPay();
    else if (b.id === 'payCancel') checkAndClose();
    else if (b.id === 'clear') {
      if (cartLocked() || !state.cart.length) return;
      openModal('<h2>Clear this order?</h2><p class="muted">All ' + state.cart.length + ' line(s) are removed. Nothing has been charged.</p>' +
        '<div class="actions"><button id="clrNo" class="ghost">Keep order</button><button id="clrYes" class="danger">Clear order</button></div>');
      $('clrNo').onclick = closeModal;
      $('clrYes').onclick = function () { closeModal(); clearCart(); announce('Order cleared.'); };
    }
    else if (d.key && $('recv')) {
      var r = $('recv');
      if (d.key === '⌫') r.value = r.value.slice(0, -1);
      else if (d.key !== '.' || r.value.indexOf('.') < 0) { if (!/\.\d\d$/.test(r.value)) r.value += d.key; }
      updateChange();
    }
    else if (b.id === 'cartBar') { $('cart').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (b.id === 'fxToggle') {
      var on = !document.documentElement.classList.contains('reduce-effects');
      document.documentElement.classList.toggle('reduce-effects', on);
      b.setAttribute('aria-pressed', on);
      try { localStorage.setItem('pos.fx', on ? 'low' : ''); } catch (er) { /* fine */ }
      toast(on ? 'Visual effects reduced.' : 'Visual effects on.');
    }
    else if (b.id === 'ticket') {
      if (!state.cart.length) return toast('The cart is empty.');
      printHtml(ticketHtml({ order_type: state.orderType, table_no: $('table').value.trim(), ref: 'Order', datetime: nowIso(),
        items: state.cart.map(function (l) { return { qty: l.qty, name: l.name, note: l.note }; }) }));
    }
    else if (b.id === 'refreshSum') loadSummary();
    else if (b.id === 'csv') downloadCsv();
    else if (b.id === 'addProduct') productModal(null);
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'search') { state.query = t.value; renderMenu(); }
    else if (t.id === 'recv') updateChange();
    else if (t.hasAttribute('data-note')) {
      var key = t.closest('li').dataset.key;
      state.cart.forEach(function (l) { if (l.key === key) l.note = t.value; });
    }
    else if (t.id === 'disc') renderCart();
    else if (t.id === 'wSearch') { waste.query = t.value; renderWasteGrid(); }
    else if (t.id === 'sSearch') { stockQuery = t.value; renderStock(); }
    else if (t.hasAttribute('data-wqty')) {
      if (waste.pending) { t.value = waste.lines.filter(function (l) { return l.key === t.closest('li').dataset.wkey; })[0].qty; wasteLocked(); return; }
      var key2 = t.closest('li').dataset.wkey;
      waste.lines.forEach(function (l) { if (l.key === key2) l.qty = t.value.trim(); });
    }
  });
  $('discType').addEventListener('change', renderCart);
  $('day').addEventListener('change', loadSummary);
  $('modal').addEventListener('click', function (e) { if (e.target.id === 'modal' && !state.saving && !state.pending) closeModal(); });
  window.addEventListener('beforeunload', function (e) {
    if (state.pending || state.saving || waste.pending || waste.saving) { e.preventDefault(); e.returnValue = ''; }
  });

  function moveThumb() {
    var on = document.querySelector('.pillnav .tab.on');
    var th = document.querySelector('.nav-thumb');
    if (!on || !th) return;
    th.style.width = on.offsetWidth + 'px';
    th.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }
  function tickShell() {
    var name = getStaff();
    var ses = api.session();
    $('staffName').textContent = name ? name + (ses && ses.role ? ' · ' + ({ cashier: 'Cashier', supervisor: 'Supervisor', admin: 'Admin' })[ses.role] : '') : 'Signed out';
    $('staffAv').textContent = name ? name.trim().charAt(0).toUpperCase() : '?';
    $('clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: cfg.TIMEZONE || 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }).format(new Date());
  }
  function netState() {
    var up = navigator.onLine !== false;
    $('netChip').classList.toggle('off', !up);
    $('netChip').lastChild.textContent = up ? 'Online' : 'Offline';
    $('offline').hidden = up;
  }
  window.addEventListener('online', netState);
  window.addEventListener('offline', netState);
  window.addEventListener('resize', moveThumb);
  try { if (localStorage.getItem('pos.fx') === 'low') { document.documentElement.classList.add('reduce-effects'); $('fxToggle').setAttribute('aria-pressed', 'true'); } } catch (er) { /* fine */ }
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === 'F1') { e.preventDefault(); if (canSee('till')) show('till'); }
    else if (e.key === 'F2' && !$('view-till').hidden && $('modal').hidden && state.cart.length) { e.preventDefault(); $('pay').click(); }
    else if (e.key === '/' && !typing && !$('view-till').hidden) { e.preventDefault(); $('search').focus(); }
    else if (e.key === 'Escape' && !$('modal').hidden && !state.saving && !state.pending) closeModal();
  });
  netState(); tickShell(); setInterval(tickShell, 30000);
  setTimeout(moveThumb, 50);

  $('biz').textContent = cfg.BUSINESS_NAME || 'Cafe POS';
  document.title = (cfg.BUSINESS_NAME || 'Cafe') + ' POS';
  $('day').value = today();
  renderCart();
  document.querySelectorAll('[data-view]').forEach(function (b) { b.hidden = true; });
  if (api.session() && api.session().token) {
    api.whoami().then(function (w) {
      var s = api.session(); s.role = w.role; s.name = w.name; s.state = w.state;
      if (w.must_change_pin) showLogin('', true); else applyRole();
    }, function () { /* onAuth shows the sign-in screen */ });
  } else showLogin('');
})();
