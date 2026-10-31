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
    $('grid').innerHTML = '<p class="muted">Loading menu…</p>';
    return api.getProducts(false).then(function (list) {
      state.products = list;
      renderMenu();
    }, function (e) {
      $('grid').innerHTML = '<p class="err">' + esc(e.message) + '</p><button id="retryMenu">Try again</button>';
      $('retryMenu').onclick = loadMenu;
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
      var stock = p.stock === '' ? '' : '<small class="' + (p.stock < 0 ? 'neg' : p.stock <= 5 ? 'low' : '') + '">Stock ' + esc(p.stock) + '</small>';
      return '<button class="item" data-add="' + esc(p.id) + '"><b>' + esc(p.name) + '</b><span>' + rm(sen(p.price)) + '</span>' + stock + '</button>';
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
    else state.cart.push({ key: Math.random().toString(36).slice(2), product_id: p.id, name: p.name, unit: sen(p.price), qty: 1, note: '' });
    renderCart();
  }

  function renderCart() {
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.type === state.orderType); });
    $('lines').innerHTML = state.cart.length ? state.cart.map(function (l) {
      return '<li data-key="' + esc(l.key) + '"><div class="l1"><span>' + esc(l.name) + '</span><b>' + rm(l.unit * l.qty) + '</b></div>' +
        '<div class="l2"><button class="qty" data-q="-1" aria-label="Less">−</button><b>' + l.qty + '</b>' +
        '<button class="qty" data-q="1" aria-label="More">+</button>' +
        '<input data-note maxlength="100" placeholder="Note (less sugar, no ice)" value="' + esc(l.note) + '"></div></li>';
    }).join('') : '<li class="muted">Tap an item to add it.</li>';
    var t = totals('');
    var rows = [['Subtotal', t.subtotal]];
    if (t.discount) rows.push(['Discount', -t.discount]);
    if (t.service) rows.push(['Service ' + cfg.SERVICE_PERCENT + '%', t.service]);
    if (t.tax) rows.push(['SST ' + cfg.SST_PERCENT + '%', t.tax]);
    $('totals').innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + rm(r[1]) + '</dd>'; }).join('') +
      '<dt class="grand">Total</dt><dd class="grand">' + rm(t.exact) + '</dd>';
    $('pay').disabled = !state.cart.length;
    $('pay').textContent = state.cart.length ? 'Pay ' + rm(t.exact) : 'Pay';
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
        }).join('') + '</div><p id="change" class="big"></p>' : '') +
      (method === 'card' ? '<p class="muted">Take the card on your card terminal first. Do not type card numbers here.</p>' : '') +
      (method === 'duitnow_qr' || method === 'ewallet' ? '<p class="muted">Check the payment has arrived before you confirm.</p>' : '') +
      '<p id="payMsg" class="' + (resume ? 'err' : '') + '">' + (resume ? 'Not saved. Try again.' : '') + '</p>' +
      '<div class="actions"><button id="payCancel" class="ghost">' + (locked ? 'Check & close' : 'Cancel') + '</button>' +
      '<button id="payGo" class="primary">' + (locked ? 'Try again' : 'Confirm paid') + '</button></div>'
    );
    $('sheet').dataset.method = method;
    if (method === 'cash') { updateChange(); if (!locked) $('recv').focus(); }
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
      receiptModal(sale, received);
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
    openModal('<div id="rc">' + receiptHtml(sale, received) + '</div>' +
      '<div class="actions"><button id="rPrint" class="ghost">Print receipt</button><button id="rTicket" class="ghost">Bar ticket</button></div>' +
      '<div class="actions">' + (sale.status === 'paid' ? '<button id="rVoid" class="danger">Void</button>' : '') +
      '<button id="rDone" class="primary"' + (sale.status === 'paid' ? '' : ' style="grid-column: 1 / -1"') + '>' + (received ? 'New order' : 'Close') + '</button></div>');
    if ($('rVoid')) $('rVoid').onclick = function () { voidModal(sale.sale_id, sale.receipt_no); };
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
    var h = (old ? '<p class="err">The web app is running an old Code.gs: the sales list and void count are missing. ' +
      'Paste the new Code.gs and redeploy (Manage deployments → New version).</p>' : '') +
      '<div class="cards"><div>Total sales<b>' + rm(sen(s.total_sales)) + '</b></div><div>Orders<b>' + s.orders + '</b></div>' +
      '<div>Voided<b>' + (old ? '?' : s.voided) + '</b></div></div>';
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
          '<button class="danger" data-void="' + esc(x.sale_id) + '" data-no="' + esc(x.receipt_no) + '">Void</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('summary').innerHTML = h;
  }

  function voidModal(saleId, no) {
    openModal('<h2>Void ' + esc(no) + '</h2><p>Stock is put back and the sale is left out of the totals.</p>' +
      '<label>Reason (required)<input id="vReason" maxlength="200" autocomplete="off"></label><p id="vMsg"></p>' +
      '<div class="actions"><button id="vCancel" class="ghost">Cancel</button><button id="vGo" class="danger">Void sale</button></div>');
    $('vReason').focus();
    $('vCancel').onclick = closeModal;
    $('vGo').onclick = function () {
      var reason = $('vReason').value.trim();
      if (reason.length < 3) { $('vMsg').className = 'err'; $('vMsg').textContent = 'Please give a reason.'; return; }
      $('vGo').disabled = true; $('vGo').textContent = 'Voiding…';
      api.voidSale(saleId, reason).then(function () { closeModal(); toast(no + ' voided.'); if (!$('view-summary').hidden) loadSummary(); loadMenu(); }, function (e) {
        $('vGo').disabled = false; $('vGo').textContent = 'Void sale';
        $('vMsg').className = 'err'; $('vMsg').textContent = e.message;
      });
    };
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
    $('plist').innerHTML = '<p class="muted">Loading…</p>';
    api.getProducts(true).then(function (list) {
      state.allProducts = list;
      $('plist').innerHTML = '<div class="scroll"><table><thead><tr><th>Name</th><th>Category</th><th class="n">Price</th><th class="n">Stock</th><th></th></tr></thead><tbody>' +
        list.map(function (p) {
          return '<tr class="' + (p.active ? '' : 'void') + '"><td>' + esc(p.name) + '</td><td>' + esc(p.category) + '</td><td class="n">' + rm(sen(p.price)) +
            '</td><td class="n">' + (p.stock === '' ? '<span class="muted">—</span>' : esc(p.stock)) + '</td><td><button class="ghost" data-edit="' + esc(p.id) + '">Edit</button></td></tr>';
        }).join('') + '</tbody></table></div><p class="muted">Inactive items are crossed out and hidden from the till. Products are never deleted.</p>';
    }, function (e) { $('plist').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function productModal(id) {
    var p = state.allProducts.filter(function (x) { return x.id === id; })[0] || { name: '', price: '', stock: '', category: '', active: true };
    openModal('<h2>' + (p.id ? 'Edit product' : 'Add product') + '</h2>' +
      '<label>Name<input id="pName" maxlength="60" value="' + esc(p.name) + '"></label>' +
      '<label>Price (RM)<input id="pPrice" inputmode="decimal" value="' + esc(p.price === '' ? '' : Number(p.price).toFixed(2)) + '"></label>' +
      '<label>Category<input id="pCat" maxlength="30" list="cats" value="' + esc(p.category) + '"></label>' +
      '<datalist id="cats">' + ['Coffee', 'Tea', 'Food', 'Dessert'].map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist>' +
      '<label>Stock (leave blank if not tracked)<input id="pStock" inputmode="numeric" value="' + esc(p.stock) + '"></label>' +
      '<label class="row"><input id="pActive" type="checkbox" style="min-height:24px;width:24px"' + (p.active ? ' checked' : '') + '> On sale (untick to deactivate)</label>' +
      '<p id="pMsg"></p><div class="actions"><button id="pCancel" class="ghost">Cancel</button><button id="pSave" class="primary">Save</button></div>');
    $('pCancel').onclick = closeModal;
    $('pSave').onclick = function () {
      var price = $('pPrice').value.trim();
      var stock = $('pStock').value.trim();
      var m = $('pMsg'); m.className = 'err';
      if (!$('pName').value.trim()) { m.textContent = 'Name is required.'; return; }
      if (!/^\d+(\.\d{1,2})?$/.test(price)) { m.textContent = 'Price like 12.90'; return; }
      if (stock && !/^-?\d+$/.test(stock)) { m.textContent = 'Stock must be a whole number or blank.'; return; }
      $('pSave').disabled = true; $('pSave').textContent = 'Saving…';
      api.saveProduct({ id: p.id, name: $('pName').value.trim(), price: price, stock: stock === '' ? '' : Number(stock),
        category: $('pCat').value.trim(), active: $('pActive').checked }).then(function () {
        closeModal(); toast('Saved.'); loadProducts(); loadMenu();
      }, function (e) { $('pSave').disabled = false; $('pSave').textContent = 'Save'; m.textContent = e.message; });
    };
  }

  // ---------- wiring ----------

  function show(view) {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.view === view); });
    ['till', 'summary', 'products'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
    if (view === 'summary') loadSummary();
    if (view === 'products') loadProducts();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.view) show(d.view);
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
    else if (d.void) voidModal(d.void, d.no);
    else if (d.show) api.getSale(d.show).then(function (s) { receiptModal(s, 0); }, function (er) { toast(er.message); });
    else if (d.edit) productModal(d.edit);
    else if (b.id === 'pay') { if (state.cart.length) payModal(state.pending ? null : 'cash', !!state.pending); }
    else if (b.id === 'payGo') confirmPay();
    else if (b.id === 'payCancel') checkAndClose();
    else if (b.id === 'clear') { if (!cartLocked() && (!state.cart.length || confirm('Clear this order?'))) clearCart(); }
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
  });
  $('discType').addEventListener('change', renderCart);
  $('day').addEventListener('change', loadSummary);
  $('modal').addEventListener('click', function (e) { if (e.target.id === 'modal' && !state.saving && !state.pending) closeModal(); });
  window.addEventListener('beforeunload', function (e) { if (state.pending || state.saving) { e.preventDefault(); e.returnValue = ''; } });

  $('biz').textContent = cfg.BUSINESS_NAME || 'Cafe POS';
  document.title = (cfg.BUSINESS_NAME || 'Cafe') + ' POS';
  $('day').value = today();
  renderCart();
  loadMenu();
})();
