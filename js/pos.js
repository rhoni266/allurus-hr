// Point of sale: the till (order, cart and payment), tables, the kitchen display, shifts and the cash drawer, menu
// and outlet settings, and sales reports with the daily posting to Finance. The rules are in js/pos-rules.js
// (AllurusPosRules); money is whole sen throughout. Only shown for a workspace with `state.pos` (the Banafsha Café
// demo) and, in the cloud, a company whose industries include the `pos` feature.
//
// Card data never reaches this code. "Card (terminal)" records a payment taken on a separate terminal: approval
// code, brand and last 4 digits only. Card tap and DuitNow QR need the native app and a payment partner (phases 2
// and 3); until then they show as unavailable, and only the server could ever mark them approved.
window.AllurusPos = (function () {
  'use strict';
  const P = window.AllurusPosRules;
  let ctx = null;
  const st = () => ctx.state;
  const pos = () => st().pos;
  const has = () => !!st().pos && (!window.AllurusFeatures || window.AllurusFeatures.has('pos'));
  const outlet = () => pos().outlets[0];
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const M = (sen) => P.fmt(sen || 0);
  const nowIso = () => new Date().toISOString();
  const T = () => U.today();
  const actor = () => ctx.account()?.empId || ctx.me()?.id || '';
  const first = (id) => ctx.emp(id)?.first || id || '—';
  const label = (k, d) => outlet()?.labels?.[k] || d;
  // The person's POS role: their own posRole, or manager for a Company Admin with the pos area.
  const posRole = () => { const a = ctx.account(); if (!a) return null; if (a.posRole) return a.posRole; return ctx.role() === 'admin' && window.AllurusAccess?.can('pos') ? 'manager' : null; };
  const can = (action) => P.canDo(posRole(), action);
  // Subscription: an expired, suspended or cancelled company takes no new orders or payments.
  const trading = () => P.canTrade(window.AllurusCompany && window.AllurusBilling ? AllurusBilling.effective(window.AllurusCompany) : 'active');
  const online = () => navigator.onLine !== false;
  const item = (id) => pos().items.find((x) => x.id === id) || pos().combos.find((x) => x.id === id);
  const order = (id) => pos().orders.find((o) => o.id === id);
  const table = (id) => pos().tables.find((t) => t.id === id);
  const openShift = () => pos().shifts.find((s) => !s.closedAt && s.outletId === outlet().id);
  const paysOf = (o) => pos().payments.filter((p) => p.orderId === o.id);
  const settled = (o) => P.settle(o.total, paysOf(o));
  const where = (o) => (o.tableId ? `Table ${table(o.tableId)?.name || ''}` : o.type === 'delivery' ? `Delivery #${o.queueNo}` : `Takeaway #${o.queueNo}`);
  const PILL = { open: '', sent: 'info', paid: 'ok', void: 'bad', new: 'warn', preparing: 'info', ready: 'ok', served: '', free: 'ok', occupied: 'info', billing: 'warn' };
  const pill = (s, l) => `<span class="pill ${PILL[s] ?? ''}">${esc(l || s)}</span>`;
  const ui = { orderId: '', type: 'dine_in', tableId: '', cat: 'all', q: '', station: 'all', day: '', repTab: 'sales', menuTab: 'items', cartOpen: false, seenTickets: null };
  const head = (title, sub, actions = '') => `<div class="page-head"><div><div class="eyebrow">${esc(outlet()?.name || 'Point of sale')}</div><h1>${title}</h1><p class="sub">${sub}</p></div><div class="actions">${actions}</div></div>`;
  const empty = (t, d) => `<div class="empty"><strong>${t}</strong>${d}</div>`;
  const banners = () => `${online() ? '' : `<div class="lock-banner pos-offline" role="status">${icon('x')}<span><strong>Offline.</strong> Orders and cash keep working and sync when you're back. Card and QR payments need a connection.</span></div>`}${trading() ? '' : `<div class="lock-banner" role="alert">${icon('lock')}<span>The subscription has ended, so no new orders or payments can be taken. Ask the owner to renew under Billing.</span></div>`}`;

  // ---------- Saving ----------
  // Taps on the till update the cart at once and save a moment later, so a tap costs no more than the cart's HTML.
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => ctx.save(), 400); };
  const audit = (action, ref, detail, by = actor(), extra = {}) => pos().audit.push({ id: U.uid('au'), at: nowIso(), by, action, ref, detail, ...extra });
  const recalc = (o) => { Object.assign(o, P.totals(o, outlet())); delete o.lineNet; return o; };

  // Offline queue (IndexedDB): orders made while offline are kept with their clientOrderId and added once on sync.
  const idb = () => new Promise((ok, fail) => { const r = indexedDB.open('allurus-pos', 1); r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'clientOrderId' }); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  async function queuePut(o) { try { const db = await idb(); db.transaction('queue', 'readwrite').objectStore('queue').put(JSON.parse(JSON.stringify(o))); } catch (e) { /* storage blocked: the order is still in the app's own copy */ } }
  async function flushQueue() {
    try {
      const db = await idb(), all = await new Promise((ok) => { const r = db.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => ok(r.result || []); r.onerror = () => ok([]); });
      if (!all.length) return;
      const r = P.mergeQueued(pos().orders, all);
      db.transaction('queue', 'readwrite').objectStore('queue').clear();
      ctx.commit(r.added.length ? `${r.added.length} offline order${r.added.length === 1 ? '' : 's'} synced` : 'Back online; everything is in sync');
    } catch (e) { /* nothing queued */ }
  }

  // Manager approval at the till: a manager signed in, or a manager's PIN.
  function managerByPin(pin) {
    return st().accounts.find((a) => a.posRole === 'manager' && a.posPin && a.posPin === U.sha256js(`pos-pin:${a.empId}:${pin}`))?.empId || '';
  }
  const pinField = (why) => (can('approve') ? '' : `<div class="field"><label for="pos-pin">Manager PIN</label><input class="input" id="pos-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" required aria-describedby="pos-pin-why"><span class="faint" id="pos-pin-why">${esc(why)}</span></div>`);
  function approver(d) {
    if (can('approve')) return actor();
    const id = managerByPin(String(d.pin || ''));
    if (!id) ctx.toast('That PIN is not a manager’s', 'error');
    return id;
  }

  // ---------- The till ----------
  function current() {
    const o = order(ui.orderId);
    return o && ['open', 'sent'].includes(o.status) ? o : null;
  }
  function newOrder() {
    if (!trading()) { ctx.toast('The subscription has ended; no new orders', 'error'); return null; }
    if (!can('order')) { ctx.toast('Your POS role can’t take orders', 'error'); return null; }
    const o = { id: U.uid('po'), clientOrderId: U.uid('c'), outletId: outlet().id, type: ui.type, tableId: ui.type === 'dine_in' ? ui.tableId : '', queueNo: ui.type === 'dine_in' ? null : ++pos().queue,
      status: 'open', lines: [], discountRule: null, createdBy: actor(), createdAt: nowIso(), note: '' };
    if (o.type === 'dine_in' && !o.tableId) { ctx.toast('Choose a table first', 'error'); return null; }
    recalc(o); pos().orders.push(o); ui.orderId = o.id;
    if (o.tableId) Object.assign(table(o.tableId), { status: 'occupied', currentOrderId: o.id });
    if (!online()) queuePut(o);
    return o;
  }
  function addLine(it, modifiers = [], qty = 1, note = '') {
    const o = current() || newOrder(); if (!o) return;
    const same = !modifiers.length && !note && o.lines.find((l) => l.itemId === it.id && !l.sentAt && l.status !== 'void' && !l.modifiers.length && !l.note);
    if (same) same.qty += qty;
    else o.lines.push({ id: U.uid('l'), itemId: it.id, name: it.name, qty, unitPrice: it.price, modifiers, taxCode: it.taxCode || outlet().defaultTaxCode, station: it.station || 'kitchen', status: 'new', note, sentAt: '' });
    recalc(o); paintCart(); saveSoon();
  }
  function itemTile(it) {
    const out = it.soldOut || it.active === false;
    return `<button type="button" class="pos-tile${out ? ' is-out' : ''}" data-act="pos-add" data-id="${it.id}" ${out ? 'disabled aria-disabled="true"' : ''}>${it.photo ? `<img src="${esc(it.photo)}" alt="" loading="lazy">` : `<span class="pos-tile-mark" aria-hidden="true">${esc(it.name.slice(0, 1))}</span>`}<span class="pos-tile-name">${esc(it.name)}</span><span class="pos-tile-price">${out ? 'Sold out' : M(it.price)}</span></button>`;
  }
  function menuGrid() {
    const q = ui.q.trim().toLowerCase();
    const list = [...pos().items, ...pos().combos].filter((i) => i.active !== false && (ui.cat === 'all' || i.categoryId === ui.cat) && (!q || i.name.toLowerCase().includes(q)));
    return list.length ? list.map(itemTile).join('') : empty('Nothing matches', 'Try another word or category.');
  }
  function cartHtml() {
    const o = current();
    if (!o) return `<div class="pos-cart-empty">${empty('No order yet', `Tap a ${esc(label('item', 'menu item').toLowerCase())} to start${ui.type === 'dine_in' ? ', after choosing a table' : ''}.`)}${openOrdersList()}</div>`;
    const s = settled(o), lines = o.lines.filter((l) => l.status !== 'void');
    return `<div class="pos-cart-head"><strong>${esc(where(o))}</strong> ${pill(o.status, o.status === 'open' ? 'Not sent' : 'In kitchen')}<button type="button" class="btn btn-sm btn-ghost" data-act="pos-new" aria-label="Start another order">${icon('plus')}New</button></div>
      <ul class="pos-lines">${lines.map((l) => `<li class="pos-line">
        <div class="pos-line-main"><div><strong>${esc(l.name)}</strong>${l.modifiers.length ? `<div class="faint">${l.modifiers.map((m) => esc(m.name)).join(' · ')}</div>` : ''}${l.note ? `<div class="faint">“${esc(l.note)}”</div>` : ''}${l.sentAt ? `<div>${pill(l.status)}</div>` : ''}</div><div class="num">${M(P.lineGross(l))}</div></div>
        <div class="pos-qty">${l.sentAt ? `<span class="faint">× ${l.qty}</span><button type="button" class="btn btn-sm btn-ghost" data-act="pos-line-void" data-id="${l.id}">Void</button>` : `<button type="button" class="btn btn-sm btn-icon" data-act="pos-qty" data-id="${l.id}" data-v="-1" aria-label="One less ${esc(l.name)}">${icon('minus')}</button><span aria-live="polite">${l.qty}</span><button type="button" class="btn btn-sm btn-icon" data-act="pos-qty" data-id="${l.id}" data-v="1" aria-label="One more ${esc(l.name)}">${icon('plus')}</button><button type="button" class="btn btn-sm btn-ghost" data-act="pos-line-note" data-id="${l.id}">Note</button>`}</div></li>`).join('') || '<li class="faint">No items</li>'}</ul>
      <dl class="pos-totals"><dt>Subtotal</dt><dd>${M(o.subtotal)}</dd>${o.discount ? `<dt>Discount${o.discountRule?.kind === 'pct' ? ` ${o.discountRule.value / 100}%` : ''}</dt><dd>−${M(o.discount)}</dd>` : ''}${o.serviceCharge ? `<dt>Service charge</dt><dd>${M(o.serviceCharge)}</dd>` : ''}${o.taxLines.map((t) => `<dt>${esc(t.label)}</dt><dd>${M(t.tax)}</dd>`).join('')}<dt class="pos-total">Total</dt><dd class="pos-total">${M(o.total)}</dd>${s.paid ? `<dt>Paid</dt><dd>${M(s.paid)}</dd><dt>Balance</dt><dd>${M(s.balance)}</dd>` : ''}</dl>
      <div class="pos-cart-actions">
        <button type="button" class="btn" data-act="pos-discount" ${can('discount') ? '' : 'disabled'}>Discount</button>
        <button type="button" class="btn" data-act="pos-hold">Hold</button>
        ${o.tableId ? '<button type="button" class="btn" data-act="pos-table-tools">Table</button>' : ''}
        <button type="button" class="btn" data-act="pos-void-order">Void</button>
        <button type="button" class="btn" data-act="pos-send" ${o.lines.some((l) => !l.sentAt && l.status !== 'void') ? '' : 'disabled'}>${icon('check')}Send</button>
        <button type="button" class="btn btn-primary pos-pay" data-act="pos-pay" ${lines.length && can('pay') ? '' : 'disabled'}>Pay ${M(s.balance || o.total)}</button>
      </div>`;
  }
  function openOrdersList() {
    const list = pos().orders.filter((o) => ['open', 'sent'].includes(o.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return list.length ? `<h4 class="lv-h">Open orders</h4><ul class="hr-list">${list.map((o) => `<li><button type="button" class="pos-open-row" data-act="pos-resume" data-id="${o.id}"><span><strong>${esc(where(o))}</strong> <span class="faint">${o.lines.filter((l) => l.status !== 'void').length} items · ${first(o.createdBy)}</span></span><span>${M(o.total)}</span></button></li>`).join('')}</ul>` : '';
  }
  function paintCart() {
    const el = ctx.$('#pos-cart'); if (el) el.innerHTML = cartHtml();
    const bar = ctx.$('#pos-bar'); const o = current();
    if (bar) bar.innerHTML = o ? `<span>${o.lines.filter((l) => l.status !== 'void').reduce((s, l) => s + l.qty, 0)} items · <strong>${M(o.total)}</strong></span><button type="button" class="btn btn-primary" data-act="pos-cart-toggle">${ui.cartOpen ? 'Menu' : 'View order'}</button>` : '';
  }
  function tillView() {
    if (!has()) return '';
    const o = current();
    if (o) { ui.type = o.type; ui.tableId = o.tableId; }
    const free = pos().tables.filter((t) => t.status === 'free' || t.id === ui.tableId);
    const sh = openShift();
    return `${head('Till', sh ? `Shift open since ${new Date(sh.openedAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })} · ${first(sh.cashierUid)}` : 'No shift open: you can take orders, but open a shift to take payments.', sh || !can('shift') ? '' : `<button class="btn btn-primary" data-act="pos-shift-open">Open shift</button>`)}
      ${banners()}
      <div class="pos-wrap${ui.cartOpen ? ' cart-open' : ''}">
        <section class="pos-menu" aria-label="${esc(label('items', 'Menu'))}">
          <div class="pos-bar-top">
            <div class="seg" role="group" aria-label="Order type">${[['dine_in', 'Dine-in'], ['takeaway', 'Takeaway'], ['delivery', 'Delivery']].map(([v, l]) => `<button type="button" data-act="pos-type" data-v="${v}" class="${ui.type === v ? 'on' : ''}" aria-pressed="${ui.type === v}" ${o ? 'disabled' : ''}>${l}</button>`).join('')}</div>
            ${ui.type === 'dine_in' ? `<select class="select" id="pos-table" aria-label="Table" ${o ? 'disabled' : ''}><option value="">Table…</option>${free.map((t) => `<option value="${t.id}" ${ui.tableId === t.id ? 'selected' : ''}>${esc(t.name)} · ${t.seats} seats</option>`).join('')}</select>` : ''}
            <input class="input" id="pos-q" type="search" placeholder="Search ${esc(label('items', 'menu').toLowerCase())}" value="${esc(ui.q)}" aria-label="Search">
          </div>
          <div class="seg rc-tabs pos-cats" role="tablist">${[['all', 'All'], ...pos().categories.filter((c) => c.active !== false).sort((a, b) => a.order - b.order).map((c) => [c.id, c.name])].map(([k, l]) => `<button role="tab" type="button" data-act="pos-cat" data-v="${k}" class="${ui.cat === k ? 'on' : ''}" aria-selected="${ui.cat === k}">${esc(l)}</button>`).join('')}</div>
          <div class="pos-grid" id="pos-grid">${menuGrid()}</div>
        </section>
        <aside class="card pos-cart" id="pos-cart" aria-label="Order">${cartHtml()}</aside>
      </div>
      <div class="pos-sticky" id="pos-bar"></div>`;
  }

  function addModal(id) {
    const it = item(id);
    if (it.slots) return comboModal(it);
    const groups = (it.modifierGroupIds || []).map((g) => pos().modifierGroups.find((x) => x.id === g)).filter(Boolean);
    if (!groups.length) { addLine(it); return; }
    ctx.openModal({
      title: `${it.name} · ${M(it.price)}`, submit: 'Add',
      body: groups.map((g) => `<fieldset class="pos-mods"><legend>${esc(g.name)} <span class="faint">${g.min ? 'required' : 'optional'}${g.max > 1 ? `, up to ${g.max}` : ''}</span></legend>${g.options.map((op, k) => `<label class="pos-opt"><input type="${g.max === 1 ? 'radio' : 'checkbox'}" name="g:${g.id}${g.max === 1 ? '' : `:${op.id}`}" value="${op.id}" ${g.min && g.max === 1 && k === 0 ? 'checked' : ''}> ${esc(op.name)}${op.priceDelta ? ` <span class="faint">+${M(op.priceDelta)}</span>` : ''}</label>`).join('')}</fieldset>`).join('')
        + `<div class="form-grid"><div class="field"><label for="pm-qty">Quantity</label><input class="input num" id="pm-qty" name="qty" type="number" min="1" max="99" value="1"></div><div class="field"><label for="pm-note">Note for the kitchen</label><input class="input" id="pm-note" name="note" maxlength="80" placeholder="No ice, extra hot…"></div></div>`,
      onSubmit(d) {
        const chosen = [];
        groups.forEach((g) => g.options.forEach((op) => { if (d[`g:${g.id}`] === op.id || d[`g:${g.id}:${op.id}`] === op.id) chosen.push({ groupId: g.id, id: op.id, name: op.name, priceDelta: op.priceDelta, ...(op.recipe ? { recipe: op.recipe } : {}) }); }));
        const errs = P.checkModifiers(groups, chosen);
        if (errs.length) { ctx.toast(errs[0], 'error'); return false; }
        addLine(it, chosen, Math.max(1, Math.min(99, parseInt(d.qty, 10) || 1)), (d.note || '').trim());
      },
    });
  }
  function comboModal(c) {
    ctx.openModal({
      title: `${c.name} · ${M(c.price)}`, submit: 'Add',
      body: c.slots.map((s, i) => `<div class="field"><label for="cb-${i}">${esc(s.name)}</label><select class="select" id="cb-${i}" name="s${i}">${s.choices.map((id) => `<option value="${id}">${esc(item(id)?.name || id)}</option>`).join('')}</select></div>`).join(''),
      onSubmit(d) { addLine(c, c.slots.map((s, i) => { const mi = item(d[`s${i}`]); return { name: `${s.name}: ${mi.name}`, priceDelta: 0, recipe: mi.recipe || [], station: mi.station }; })); },
    });
  }

  // ---------- Kitchen ----------
  function send(o) {
    const fresh = o.lines.filter((l) => !l.sentAt && l.status !== 'void');
    if (!fresh.length) return;
    const at = nowIso();
    fresh.forEach((l) => { l.sentAt = at; l.status = 'new'; });
    o.status = 'sent'; o.sentAt = o.sentAt || at;
    if (outlet().deductOn === 'send') P.addMoves(st().ops.moves, P.stockMoves({ ...o, lines: fresh }, Object.fromEntries(pos().items.map((i) => [i.id, i])), 'sale', T()));
    const stations = [...new Set(fresh.map((l) => l.station))];
    ctx.commit(`Sent to ${stations.join(' and ')}: ${fresh.length} item${fresh.length === 1 ? '' : 's'}`);
  }
  const elapsed = (iso) => { const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function tickets() {
    return pos().orders.filter((o) => o.status === 'sent' || o.status === 'paid').flatMap((o) => {
      const lines = o.lines.filter((l) => l.sentAt && ['new', 'preparing', 'ready'].includes(l.status) && (ui.station === 'all' || l.station === ui.station));
      if (!lines.length) return [];
      const stage = lines.some((l) => l.status === 'new') ? 'new' : lines.some((l) => l.status === 'preparing') ? 'preparing' : 'ready';
      return [{ o, lines, stage, since: lines.map((l) => l.sentAt).sort()[0] }];
    }).sort((a, b) => a.since.localeCompare(b.since));
  }
  function kitchenView() {
    if (!has()) return '';
    const tk = tickets(), cols = [['new', 'New'], ['preparing', 'Preparing'], ['ready', 'Ready']];
    const stations = ['all', ...new Set(pos().items.map((i) => i.station))];
    return `${head('Kitchen display', `${tk.length} ticket${tk.length === 1 ? '' : 's'} open. Oldest first; a ticket turns red after 15 minutes.`, `<div class="seg" role="group" aria-label="Station">${stations.map((s) => `<button type="button" data-act="pos-station" data-v="${s}" class="${ui.station === s ? 'on' : ''}">${s === 'all' ? 'All stations' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>`)}
      ${banners()}
      <div class="pos-kds">${cols.map(([k, l]) => `<section class="pos-kds-col" aria-label="${l}"><h3>${l} <span class="faint">${tk.filter((t) => t.stage === k).length}</span></h3>${tk.filter((t) => t.stage === k).map((t) => `
        <article class="card pos-ticket${(Date.now() - Date.parse(t.since)) > 15 * 60e3 && k !== 'ready' ? ' is-late' : ''}">
          <header><strong>${esc(where(t.o))}</strong><span class="pos-timer num" data-since="${t.since}">${elapsed(t.since)}</span></header>
          <ul>${t.lines.map((x) => `<li class="pos-tk-line s-${x.status}"><span><strong>${x.qty} × ${esc(x.name)}</strong>${x.modifiers.length ? `<span class="faint"> · ${x.modifiers.map((m) => esc(m.name)).join(', ')}</span>` : ''}${x.note ? `<div class="pos-tk-note">“${esc(x.note)}”</div>` : ''}</span><span class="faint">${esc(x.station)}</span></li>`).join('')}</ul>
          <footer>${k === 'new' ? `<button type="button" class="btn btn-sm btn-primary" data-act="pos-tk" data-id="${t.o.id}" data-v="preparing">Start</button>` : ''}${k !== 'ready' ? `<button type="button" class="btn btn-sm" data-act="pos-tk" data-id="${t.o.id}" data-v="ready">Ready</button>` : `<button type="button" class="btn btn-sm btn-primary" data-act="pos-tk" data-id="${t.o.id}" data-v="served">Served</button>`}</footer>
        </article>`).join('') || '<p class="faint">Nothing here</p>'}</section>`).join('')}</div>`;
  }
  // A short tone when a new ticket arrives (Web Audio; no file to load).
  function beep() {
    if (!outlet()?.sound) return;
    try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.18); } catch (e) { /* no audio */ }
  }

  // ---------- Payment ----------
  const SERVER_SOON = { card_tap: 'Needs the Allurus Android app and a card partner (phase 3)', duitnow_qr: 'Needs a QR payment gateway (phase 2)' };
  function payModal(o) {
    if (!trading()) { ctx.toast('The subscription has ended; no payments can be taken', 'error'); return; }
    if (!openShift()) { ctx.toast('Open a shift before taking payments', 'error'); return; }
    const s = settled(o), left = Math.max(0, o.total - s.paid);
    const methods = outlet().methods;
    const cashDue = P.roundCash(left);
    ctx.openModal({
      title: `Pay · ${where(o)}`, submit: 'Take payment',
      body: `<div class="pos-pay-due"><span>To pay</span><strong>${M(left)}</strong>${cashDue !== left ? `<span class="faint">Cash: ${M(cashDue)} (rounded to 5 sen)</span>` : ''}</div>
        <fieldset class="pos-methods"><legend>Method</legend>${[...methods, 'duitnow_qr', 'card_tap'].filter((m, i, a) => a.indexOf(m) === i).map((m, i) => {
          const off = SERVER_SOON[m] || (!P.methodAllowed(m, online()) ? 'Needs a connection' : '');
          return `<label class="pos-method${off ? ' is-off' : ''}"><input type="radio" name="method" value="${m}" ${i === 0 && !off ? 'checked' : ''} ${off ? 'disabled' : ''}><span>${esc(P.METHODS[m].label)}</span>${off ? `<small class="faint">${esc(off)}</small>` : ''}</label>`;
        }).join('')}</fieldset>
        <div class="form-grid">
          <div class="field"><label for="py-amount">Amount (RM)</label><input class="input num" id="py-amount" name="amount" inputmode="decimal" value="${(left / 100).toFixed(2)}" required></div>
          <div class="field" data-for="cash"><label for="py-tendered">Cash received (RM)</label><input class="input num" id="py-tendered" name="tendered" inputmode="decimal" value="${(cashDue / 100).toFixed(2)}"><div class="pos-quick">${[cashDue, Math.ceil(cashDue / 1000) * 1000, Math.ceil(cashDue / 5000) * 5000, Math.ceil(cashDue / 10000) * 10000].filter((v, i, a) => v && a.indexOf(v) === i).map((v) => `<button type="button" class="btn btn-sm" data-cash="${v}">${M(v)}</button>`).join('')}</div></div>
          <div class="field" data-for="card_external"><label for="py-code">Approval code</label><input class="input" id="py-code" name="approvalCode" maxlength="12" autocomplete="off" inputmode="numeric"></div>
          <div class="field" data-for="card_external"><label for="py-last4">Last 4 digits</label><input class="input" id="py-last4" name="cardLast4" maxlength="4" inputmode="numeric" autocomplete="off" pattern="\\d{4}"></div>
          <div class="field" data-for="card_external"><label for="py-brand">Card</label><select class="select" id="py-brand" name="cardBrand"><option>Visa</option><option>Mastercard</option><option>MyDebit</option><option>Amex</option><option>UnionPay</option></select></div>
          <div class="field" data-for="qr_manual ewallet_manual other"><label for="py-ref">Reference on the bank or wallet notification</label><input class="input" id="py-ref" name="reference" maxlength="40" autocomplete="off"></div>
          ${outlet().tips ? '<div class="field"><label for="py-tip">Tip (RM, optional)</label><input class="input num" id="py-tip" name="tip" inputmode="decimal" placeholder="0.00"></div>' : ''}
        </div>
        <p class="faint">Never type a full card number here. A card or QR recorded by hand is flagged for reconciliation against the provider’s settlement.</p>`,
      onSubmit(d) {
        const method = d.method;
        if (!method || SERVER_SOON[method]) { ctx.toast('Choose a payment method', 'error'); return false; }
        if (!P.methodAllowed(method, online())) { ctx.toast('Card and QR payments need a connection', 'error'); return false; }
        let amount = P.toSen(d.amount), tip = d.tip ? P.toSen(d.tip) : 0;
        if (!(amount > 0) || Number.isNaN(tip) || tip < 0) { ctx.toast('Check the amount', 'error'); return false; }
        const base = { id: U.uid('pp'), orderId: o.id, outletId: o.outletId, shiftId: openShift().id, createdAt: nowIso(), createdBy: actor(), idempotencyKey: U.uid('ik'), ...(tip ? { tip } : {}) };
        let rec;
        try {
          if (method === 'cash') {
            const tendered = P.toSen(d.tendered);
            if (!(tendered > 0)) { ctx.toast('Enter the cash received', 'error'); return false; }
            const c = P.cashApply(Math.min(left, amount), tendered);
            rec = { ...P.recordedProvider('cash').createPayment(o, c.amount, 'cash', { idempotencyKey: base.idempotencyKey }), tendered, change: c.change };
          } else {
            if (amount > left) amount = left;
            if (method === 'card_external' && (!d.approvalCode.trim() || !/^\d{4}$/.test(d.cardLast4))) { ctx.toast('Enter the approval code and the last 4 digits from the terminal slip', 'error'); return false; }
            const card = method === 'card_external';
            rec = P.recordedProvider(method).createPayment(o, amount, method, card
              ? { idempotencyKey: base.idempotencyKey, approvalCode: d.approvalCode?.trim(), cardLast4: d.cardLast4?.trim(), cardBrand: d.cardBrand }
              : { idempotencyKey: base.idempotencyKey, reference: d.reference?.trim() });
          }
        } catch (e) { ctx.toast(e.message, 'error'); return false; }
        pos().payments.push({ ...base, ...rec, createdBy: actor() });
        const after = settled(o);
        if (after.fullyPaid) { finish(o, after); return; }
        ctx.commit(`${M(rec.amount)} taken; ${M(after.balance)} left`);
        setTimeout(() => payModal(o), 50);
      },
    });
    const form = ctx.$('#overlay-root form');
    const sync = () => { const m = form.querySelector('input[name=method]:checked')?.value; form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(m); if (el.hidden && el.dataset.for === 'card_external') el.querySelectorAll('input').forEach((i) => { i.value = ''; }); }); if (m === 'cash') form.querySelector('#py-amount').value = (cashDue / 100).toFixed(2); else form.querySelector('#py-amount').value = (left / 100).toFixed(2); };
    form.addEventListener('change', (ev) => { if (ev.target.name === 'method') sync(); });
    form.addEventListener('click', (ev) => { const b = ev.target.closest('[data-cash]'); if (b) form.querySelector('#py-tendered').value = (b.dataset.cash / 100).toFixed(2); });
    sync();
  }
  function finish(o, s) {
    o.status = 'paid'; o.paidAt = nowIso(); o.rounding = s.rounding;
    o.receiptNo = P.nextReceiptNo(pos().seq, outlet().code);
    o.lines.filter((l) => !l.sentAt && l.status !== 'void').forEach((l) => { l.sentAt = o.paidAt; l.status = l.station ? 'new' : 'served'; });
    P.addMoves(st().ops.moves, P.stockMoves(o, Object.fromEntries(pos().items.map((i) => [i.id, i])), 'sale', T()));
    if (o.tableId) Object.assign(table(o.tableId), { status: 'free', currentOrderId: '' });
    ui.orderId = ''; ui.cartOpen = false;
    ctx.commit(`Paid · ${o.receiptNo}${s.change ? ` · change ${M(s.change)}` : ''}`);
    lowStockNotice();
    // After the payment form has closed itself.
    setTimeout(() => receiptModal(o.id), 0);
  }
  function lowStockNotice() {
    const low = window.AllurusOpsRules.stockLevels(st().ops.items, st().ops.moves, st().ops.pos).filter((x) => x.low && !x.onOrder);
    const key = low.map((x) => x.id).join();
    if (low.length && key !== ui.lowKey) { ui.lowKey = key; ctx.toast(`Low stock: ${low.slice(0, 3).map((x) => x.name).join(', ')}${low.length > 3 ? '…' : ''}`, 'error'); }
  }

  // ---------- Receipts ----------
  function receiptText(o) {
    const out = outlet(), s = settled(o), pays = paysOf(o).filter((p) => p.status === 'approved' || p.status === 'refunded');
    const row = (a, b) => `${a}${' '.repeat(Math.max(1, 32 - a.length - b.length))}${b}`;
    const money = (x) => (x / 100).toFixed(2);
    return [out.receiptHeader, out.name, out.address, out.sstNo ? `SST reg. no: ${out.sstNo}` : '', '',
      `Receipt ${o.receiptNo || '(not paid)'}`, `${new Date(o.paidAt || o.createdAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`, `${where(o)} · ${first(o.createdBy)}`, '-'.repeat(32),
      ...o.lines.filter((l) => l.status !== 'void').flatMap((l) => [row(`${l.qty} x ${l.name}`.slice(0, 24), money(P.lineGross(l))), ...l.modifiers.map((m) => `   ${m.name}${m.priceDelta ? ` +${money(m.priceDelta)}` : ''}`)]),
      '-'.repeat(32), row('Subtotal', money(o.subtotal)), o.discount ? row('Discount', `-${money(o.discount)}`) : '', o.serviceCharge ? row('Service charge', money(o.serviceCharge)) : '',
      ...o.taxLines.map((t) => row(t.label, money(t.tax))), o.rounding ? row('Rounding', money(o.rounding)) : '', row('TOTAL', money(o.total + (o.rounding || 0))),
      ...pays.map((p) => row(`${P.METHODS[p.method].label}${p.cardLast4 ? ` ${p.cardBrand || ''} **${p.cardLast4}` : ''}`.slice(0, 24), money(p.tendered || p.amount))), s.change ? row('Change', money(s.change)) : '', s.tips ? row('Tip', money(s.tips)) : '',
      '', out.receiptFooter].filter((x) => x !== '').join('\n');
  }
  function receiptModal(id) {
    const o = order(id), txt = receiptText(o);
    ctx.openModal({
      title: `Receipt ${o.receiptNo || ''}`, submit: null,
      body: `<pre class="pos-receipt" id="pos-receipt">${esc(txt)}</pre>
        <div class="pos-receipt-actions"><button type="button" class="btn" data-act="pos-print" data-id="${o.id}">${icon('doc')}Print</button>
        <a class="btn" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener" data-receipt="whatsapped">WhatsApp</a>
        <a class="btn" href="mailto:?subject=${encodeURIComponent(`Receipt ${o.receiptNo} · ${outlet().name}`)}&body=${encodeURIComponent(txt)}" data-receipt="emailed">Email</a></div>`,
    });
    ctx.$('#overlay-root')?.addEventListener('click', (ev) => { const k = ev.target.closest('[data-receipt]')?.dataset.receipt; if (k) { o.receipt = { ...(o.receipt || {}), [k]: true }; saveSoon(); } });
  }
  function printReceipt(id) {
    const o = order(id), w = window.open('', '_blank', 'width=380,height=640');
    if (!w) { ctx.toast('Allow pop-ups to print', 'error'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(o.receiptNo || 'Receipt')}</title><style>body{font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;margin:8px;width:58mm}pre{white-space:pre-wrap;margin:0}</style><pre>${esc(receiptText(o))}</pre><script>window.onload=()=>{window.print();}<\/script>`);
    w.document.close();
    o.receipt = { ...(o.receipt || {}), printed: true }; saveSoon();
  }

  // ---------- Discounts, voids and refunds ----------
  function discountModal(o) {
    ctx.openModal({
      title: 'Discount', submit: 'Apply',
      body: `<div class="seg" role="group" aria-label="Kind"><label><input type="radio" name="kind" value="pct" checked> Percent</label><label><input type="radio" name="kind" value="amt"> Amount (RM)</label></div>
        <div class="form-grid"><div class="field"><label for="ds-v">Value</label><input class="input num" id="ds-v" name="value" inputmode="decimal" required></div><div class="field"><label for="ds-r">Reason</label><input class="input" id="ds-r" name="reason" maxlength="60" required placeholder="Regular, staff, complaint…"></div></div>
        <p class="faint">Your limit without a manager: ${(outlet().discountLimitBp || 0) / 100}% of the bill.${o.discountRule ? ' <button type="button" class="btn btn-sm btn-ghost" data-act="pos-discount-clear">Remove the current discount</button>' : ''}</p>${can('discount_over_limit') ? '' : pinField('Needed above your limit')}`,
      onSubmit(d) {
        const v = d.kind === 'pct' ? Math.round(parseFloat(d.value) * 100) : P.toSen(d.value);
        if (!(v > 0) || (d.kind === 'pct' && v > 10000)) { ctx.toast('Check the value', 'error'); return false; }
        const rule = { kind: d.kind, value: v, reason: d.reason.trim() };
        const amount = P.totals({ ...o, discountRule: rule }, outlet()).discount;
        let by = actor();
        if (P.discountNeedsManager(posRole(), amount, o.subtotal, outlet().discountLimitBp)) { by = managerByPin(String(d.pin || '')); if (!by) { ctx.toast('Above your limit: a manager’s PIN is needed', 'error'); return false; } }
        o.discountRule = { ...rule, by }; recalc(o);
        audit('discount', where(o), `${d.kind === 'pct' ? `${v / 100}%` : M(v)} (${M(amount)}): ${rule.reason}`, by);
        ctx.commit(`Discount ${M(amount)} applied`);
      },
    });
  }
  function voidModal(o, lineId) {
    const l = lineId && o.lines.find((x) => x.id === lineId);
    const paid = o.status === 'paid';
    ctx.openModal({
      title: paid ? `Refund ${o.receiptNo}` : l ? `Void ${l.name}` : `Void ${where(o)}`, submit: paid ? 'Refund' : 'Void',
      body: `<p>${paid ? `All payments on this receipt (${M(settled(o).paid)}) are refunded and the stock goes back.` : l ? 'The line stays on the kitchen record, marked void.' : 'The order is cancelled and its table freed.'}</p>
        <div class="field"><label for="vd-r">Reason</label><input class="input" id="vd-r" name="reason" maxlength="80" required></div>${pinField('Voids and refunds need a manager')}`,
      onSubmit(d) {
        if (paid ? !can('refund') && !managerByPin(String(d.pin || '')) : false) { ctx.toast('A manager’s PIN is needed', 'error'); return false; }
        const by = approver(d); if (!by) return false;
        const reason = d.reason.trim();
        const menu = Object.fromEntries(pos().items.map((i) => [i.id, i]));
        if (l) {
          if (l.sentAt && outlet().deductOn === 'send') P.addMoves(st().ops.moves, P.stockMoves({ ...o, lines: [l] }, menu, 'void', T()));
          l.status = 'void'; l.voidReason = reason; recalc(o);
          audit('void-line', where(o), `${l.qty} × ${l.name}: ${reason}`, by);
          ctx.commit(`${l.name} voided`); return;
        }
        if (paid) {
          for (const p of paysOf(o).filter((x) => x.status === 'approved')) {
            if (!P.canTransition(p, 'refunded', 'client')) { ctx.toast(`${P.METHODS[p.method].label} refunds go through the provider`, 'error'); return false; }
            p.status = 'refunded';
            pos().refunds.push({ id: U.uid('rf'), orderId: o.id, paymentId: p.id, shiftId: openShift()?.id || p.shiftId, method: p.method, amount: p.amount, reason, approvedBy: by, status: 'approved', at: nowIso() });
          }
        }
        const sold = paid || outlet().deductOn === 'send';
        if (sold) P.addMoves(st().ops.moves, P.stockMoves(o, menu, 'void', T()));
        Object.assign(o, { status: 'void', voidedAt: nowIso(), voidReason: reason, voidedBy: by });
        if (o.tableId && table(o.tableId)?.currentOrderId === o.id) Object.assign(table(o.tableId), { status: 'free', currentOrderId: '' });
        if (ui.orderId === o.id) ui.orderId = '';
        audit(paid ? 'refund' : 'void', o.receiptNo || where(o), `${M(o.total)}: ${reason}`, by);
        ctx.commit(paid ? `${o.receiptNo} refunded; stock back` : 'Order voided');
      },
    });
  }

  // ---------- Tables ----------
  function tablesView() {
    if (!has()) return '';
    const secs = [...new Set(pos().tables.map((t) => t.section))];
    return `${head('Tables', `${pos().tables.filter((t) => t.status !== 'free').length} of ${pos().tables.length} in use.`)}${banners()}
      ${secs.map((s) => `<h3 class="lv-h">${esc(s)}</h3><div class="pos-tables">${pos().tables.filter((t) => t.section === s).map((t) => { const o = order(t.currentOrderId); return `<button type="button" class="card pos-table s-${t.status}" data-act="pos-table" data-id="${t.id}"><strong>${esc(t.name)}</strong><span class="faint">${t.seats} seats</span>${pill(t.status, t.status === 'billing' ? 'Bill asked' : t.status)}${o ? `<span class="num">${M(o.total)}</span><span class="faint">${elapsed(o.createdAt)}</span>` : ''}</button>`; }).join('')}</div>`).join('')}`;
  }
  function tableTools(o) {
    const free = pos().tables.filter((t) => t.status === 'free'), busy = pos().tables.filter((t) => t.id !== o.tableId && t.currentOrderId && order(t.currentOrderId)?.status !== 'paid');
    const unsplit = o.lines.filter((l) => l.status !== 'void');
    ctx.openModal({
      title: `${where(o)}`, submit: 'Apply',
      body: `<fieldset><legend>What to do</legend>
        <label class="pos-opt"><input type="radio" name="op" value="bill" checked> Customer asked for the bill</label>
        <label class="pos-opt"><input type="radio" name="op" value="move"> Move to another table</label>
        <label class="pos-opt"><input type="radio" name="op" value="merge" ${busy.length ? '' : 'disabled'}> Merge another table into this bill</label>
        <label class="pos-opt"><input type="radio" name="op" value="split" ${unsplit.length > 1 ? '' : 'disabled'}> Split: move ticked items to a separate bill</label></fieldset>
        <div class="form-grid"><div class="field"><label for="tt-to">Move to</label><select class="select" id="tt-to" name="to">${free.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tt-from">Merge from</label><select class="select" id="tt-from" name="from">${busy.map((t) => `<option value="${t.id}">${esc(t.name)} · ${M(order(t.currentOrderId).total)}</option>`).join('')}</select></div></div>
        <fieldset><legend>Items for a split bill</legend>${unsplit.map((l) => `<label class="pos-opt"><input type="checkbox" name="ln:${l.id}" value="1"> ${l.qty} × ${esc(l.name)} · ${M(P.lineGross(l))}</label>`).join('')}</fieldset>`,
      onSubmit(d) {
        if (d.op === 'bill') { table(o.tableId).status = 'billing'; ctx.commit('Bill asked'); return; }
        if (d.op === 'move') {
          if (!d.to) { ctx.toast('No free table', 'error'); return false; }
          Object.assign(table(o.tableId), { status: 'free', currentOrderId: '' }); o.tableId = d.to; Object.assign(table(d.to), { status: 'occupied', currentOrderId: o.id });
          audit('table-move', where(o), `Moved to ${table(d.to).name}`); ctx.commit(`Moved to ${table(d.to).name}`); return;
        }
        if (d.op === 'merge') {
          const other = order(table(d.from).currentOrderId);
          if (paysOf(other).some((p) => p.status === 'approved')) { ctx.toast('That bill is part paid; take it separately', 'error'); return false; }
          o.lines.push(...other.lines.filter((l) => l.status !== 'void')); recalc(o);
          Object.assign(other, { status: 'void', voidReason: `Merged into ${where(o)}`, voidedAt: nowIso(), mergedInto: o.id, lines: [] }); recalc(other);
          Object.assign(table(d.from), { status: 'free', currentOrderId: '' });
          audit('table-merge', where(o), `Merged ${table(d.from).name}`); ctx.commit(`Merged ${table(d.from).name} into this bill`); return;
        }
        const ids = unsplit.filter((l) => d[`ln:${l.id}`]).map((l) => l.id);
        if (!ids.length || ids.length === unsplit.length) { ctx.toast('Tick some, not all, of the items', 'error'); return false; }
        const part = { ...JSON.parse(JSON.stringify(o)), id: U.uid('po'), clientOrderId: U.uid('c'), lines: o.lines.filter((l) => ids.includes(l.id)), splitFrom: o.id, createdAt: nowIso(), discountRule: null };
        o.lines = o.lines.filter((l) => !ids.includes(l.id)); recalc(o); recalc(part); pos().orders.push(part);
        audit('split', where(o), `${ids.length} items to a separate bill`);
        ui.orderId = part.id; ctx.commit('Split: the new bill is open'); return undefined;
      },
    });
  }

  // ---------- Shifts ----------
  function shiftView() {
    if (!has()) return '';
    const sh = openShift(), hist = pos().shifts.filter((s) => s.closedAt).slice(-14).reverse();
    const sum = sh && P.shiftSummary(sh, pos().payments, pos().refunds);
    return `${head('Shift and cash drawer', sh ? `Open since ${new Date(sh.openedAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })} with ${M(sh.openingCash)} float.` : 'No shift is open.',
      sh ? `<button class="btn" data-act="pos-cash" data-v="in">Cash in</button><button class="btn" data-act="pos-cash" data-v="out">Cash out</button><button class="btn btn-primary" data-act="pos-shift-close">Close shift</button>` : (can('shift') ? '<button class="btn btn-primary" data-act="pos-shift-open">Open shift</button>' : ''))}
      ${sh ? `<div class="grid g-4 keep-2">${[['Expected cash', sum.expectedCash], ['Cash sales', sum.cashSales], ['Cash in − out', sum.cashIn - sum.cashOut], ['Cash refunds', sum.cashRefunds]].map(([l, v]) => `<div class="card kpi"><div class="kpi-label">${l}</div><div class="kpi-value num">${M(v)}</div></div>`).join('')}</div>
        <div class="card"><div class="card-head"><h3>Taken this shift</h3></div><ul class="hr-list">${Object.entries(sum.byMethod).map(([m, v]) => `<li><span>${esc(P.METHODS[m].label)}</span><strong class="num">${M(v)}</strong></li>`).join('') || '<li class="faint">Nothing yet</li>'}</ul>${(sh.cashMoves || []).length ? `<h4 class="lv-h">Cash in and out</h4><ul class="hr-list">${sh.cashMoves.map((c) => `<li><span>${c.kind === 'in' ? 'In' : 'Out'}: ${esc(c.reason)} <span class="faint">${first(c.by)}</span></span><strong class="num">${M(c.amount)}</strong></li>`).join('')}</ul>` : ''}</div>` : ''}
      <div class="card card-flush"><div class="card-head" style="padding:16px 20px 0"><h3>Recent shifts</h3></div><div class="table-wrap"><table><thead><tr><th>Closed</th><th>Cashier</th><th class="num">Expected</th><th class="num">Counted</th><th class="num">Variance</th></tr></thead><tbody>${hist.map((s) => `<tr><td>${new Date(s.closedAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(first(s.cashierUid))}</td><td class="num">${M(s.expectedCash)}</td><td class="num">${M(s.countedCash)}</td><td class="num">${s.variance ? pill(s.variance < 0 ? 'void' : 'billing', `${s.variance > 0 ? '+' : ''}${M(s.variance)}`) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="faint">None yet</td></tr>'}</tbody></table></div></div>`;
  }
  function moneyModal(title, label2, submit, onSen, extra = '') {
    ctx.openModal({ title, submit, body: `<div class="field"><label for="mm-v">${label2} (RM)</label><input class="input num" id="mm-v" name="v" inputmode="decimal" required></div>${extra}`,
      onSubmit(d) { const v = P.toSen(d.v); if (Number.isNaN(v) || v < 0) { ctx.toast('Check the amount', 'error'); return false; } return onSen(v, d); } });
  }

  // ---------- Menu and settings ----------
  function menuView() {
    if (!has()) return '';
    const tabs = [['items', label('items', 'Menu')], ['tables', 'Tables'], ['settings', 'Outlet settings']];
    return `${head(`${label('items', 'Menu')} & settings`, 'Prices, availability, recipes and the outlet’s tax, service charge and receipt.', ui.menuTab === 'items' ? `<button class="btn" data-act="pos-import">${icon('download')}Import from Excel</button><button class="btn btn-primary" data-act="pos-item" data-id="">${icon('plus')}Add ${esc(label('item', 'item').toLowerCase())}</button>` : '')}
      <div class="seg rc-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-act="pos-menu-tab" data-v="${k}" class="${ui.menuTab === k ? 'on' : ''}" aria-selected="${ui.menuTab === k}">${esc(l)}</button>`).join('')}</div>
      ${ui.menuTab === 'items' ? itemsTable() : ui.menuTab === 'tables' ? tablesEditor() : settingsForm()}`;
  }
  const catName = (id) => pos().categories.find((c) => c.id === id)?.name || '—';
  function itemsTable() {
    return `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Station</th><th>Tax</th><th class="num">Price</th><th>Recipe</th><th>Available</th></tr></thead><tbody>${[...pos().items, ...pos().combos].map((i) => `<tr><td><button type="button" class="linkish" data-act="pos-item" data-id="${i.id}">${esc(i.name)}</button></td><td>${esc(catName(i.categoryId))}</td><td>${esc(i.station || '')}</td><td>${esc(i.taxCode || '')}</td><td class="num">${M(i.price)}</td><td class="faint">${i.slots ? 'from its choices' : (i.recipe || []).length ? `${i.recipe.length} ingredient${i.recipe.length === 1 ? '' : 's'}` : 'none'}</td><td><button type="button" class="btn btn-sm" data-act="pos-soldout" data-id="${i.id}">${i.soldOut ? 'Sold out' : 'Available'}</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function itemModal(id) {
    const i = item(id) || { id: '', name: '', price: 0, categoryId: pos().categories[0]?.id, station: 'kitchen', taxCode: outlet().defaultTaxCode, modifierGroupIds: [], recipe: [], active: true };
    const ings = st().ops.items;
    ctx.openModal({
      title: id ? i.name : `New ${label('item', 'item').toLowerCase()}`, submit: can('price') || !id ? 'Save' : null,
      body: `<div class="form-grid"><div class="field"><label for="mi-n">Name</label><input class="input" id="mi-n" name="name" value="${esc(i.name)}" required maxlength="60"></div>
        <div class="field"><label for="mi-p">Price (RM)</label><input class="input num" id="mi-p" name="price" inputmode="decimal" value="${(i.price / 100).toFixed(2)}" required ${can('price') ? '' : 'readonly'}></div>
        <div class="field"><label for="mi-c">Category</label><select class="select" id="mi-c" name="categoryId">${pos().categories.map((c) => `<option value="${c.id}" ${c.id === i.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="mi-s">Station</label><select class="select" id="mi-s" name="station">${['kitchen', 'bar'].map((s) => `<option ${s === i.station ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label for="mi-t">Tax code</label><select class="select" id="mi-t" name="taxCode">${Object.entries(outlet().taxes).map(([k, t]) => `<option value="${k}" ${k === i.taxCode ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div></div>
        ${i.slots ? '' : `<fieldset><legend>Options</legend>${pos().modifierGroups.map((g) => `<label class="pos-opt"><input type="checkbox" name="mg:${g.id}" value="1" ${(i.modifierGroupIds || []).includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</fieldset>
        <fieldset><legend>Recipe per portion (comes off stock when sold)</legend>${[...(i.recipe || []), {}, {}].map((r, k) => `<div class="ops-line"><select class="select" name="ri${k}" aria-label="Ingredient"><option value="">—</option>${ings.map((x) => `<option value="${x.id}" ${x.id === r.itemId ? 'selected' : ''}>${esc(x.name)} (${esc(x.unit)})</option>`).join('')}</select><input class="input num" name="rq${k}" type="number" min="0" step="0.001" value="${r.qty ?? ''}" aria-label="Quantity"></div>`).join('')}</fieldset>`}`,
      onSubmit(d) {
        const price = P.toSen(d.price);
        if (!(price >= 0)) { ctx.toast('Check the price', 'error'); return false; }
        const target = item(id) || (() => { const x = { id: U.uid('m'), active: true, soldOut: false, photo: '' }; pos().items.push(x); return x; })();
        if (id && target.price !== price) { if (!can('price')) { ctx.toast('Only a manager changes prices', 'error'); return false; } audit('price', target.name, `${M(target.price)} → ${M(price)}`); }
        Object.assign(target, { name: d.name.trim(), price, categoryId: d.categoryId, station: d.station, taxCode: d.taxCode });
        if (!target.slots) {
          target.modifierGroupIds = pos().modifierGroups.filter((g) => d[`mg:${g.id}`]).map((g) => g.id);
          target.recipe = Object.keys(d).filter((k) => /^ri\d+$/.test(k) && d[k]).map((k) => ({ itemId: d[k], qty: Number(d[`rq${k.slice(2)}`]) || 0 })).filter((r) => r.qty > 0);
        }
        ctx.commit(`${target.name} saved`);
      },
    });
  }
  function tablesEditor() {
    return `<div class="card"><p class="faint">One table per line: name, section, seats. Tables in use keep their bill.</p><textarea class="input" id="pos-tables-txt" rows="12" aria-label="Tables">${esc(pos().tables.map((t) => `${t.name}, ${t.section}, ${t.seats}`).join('\n'))}</textarea><div class="actions" style="margin-top:12px"><button class="btn btn-primary" data-act="pos-tables-save">Save tables</button></div></div>`;
  }
  function settingsForm() {
    const o = outlet(), sc = o.serviceCharge || {};
    return `<form class="card" id="pos-settings" novalidate><div class="form-grid">
      <div class="field"><label for="os-n">Outlet name</label><input class="input" id="os-n" name="name" value="${esc(o.name)}"></div>
      <div class="field"><label for="os-c">Receipt prefix</label><input class="input" id="os-c" name="code" value="${esc(o.code)}" maxlength="6" ${pos().orders.some((x) => x.receiptNo) ? 'readonly title="Fixed once receipts are issued"' : ''}></div>
      <div class="field"><label for="os-a">Address</label><input class="input" id="os-a" name="address" value="${esc(o.address)}"></div>
      <div class="field"><label for="os-sst">SST registration no. (blank if not registered)</label><input class="input" id="os-sst" name="sstNo" value="${esc(o.sstNo || '')}"></div>
      <div class="field"><label for="os-tax">Tax codes: CODE, label, rate % (one per line)</label><textarea class="input" id="os-tax" name="taxes" rows="3">${esc(Object.entries(o.taxes).map(([k, t]) => `${k}, ${t.label}, ${t.rateBp / 100}`).join('\n'))}</textarea></div>
      <div class="field"><label for="os-dt">Default tax code</label><input class="input" id="os-dt" name="defaultTaxCode" value="${esc(o.defaultTaxCode)}"></div>
      <div class="field"><label><input type="checkbox" name="scOn" ${sc.enabled ? 'checked' : ''}> Service charge</label><input class="input num" name="scRate" aria-label="Service charge %" value="${(sc.rateBp || 0) / 100}"><label><input type="checkbox" name="scDine" ${!sc.orderTypes || sc.orderTypes.includes('dine_in') && sc.orderTypes.length === 1 ? 'checked' : ''}> Dine-in only</label></div>
      <div class="field"><label for="os-sct">Tax code on service charge (blank for none)</label><input class="input" id="os-sct" name="scTax" value="${esc(sc.taxCode || '')}"></div>
      <div class="field"><label for="os-dl">Cashier discount limit (%)</label><input class="input num" id="os-dl" name="discountLimit" value="${(o.discountLimitBp || 0) / 100}"></div>
      <div class="field"><label for="os-dd">Take stock off</label><select class="select" id="os-dd" name="deductOn"><option value="payment" ${o.deductOn !== 'send' ? 'selected' : ''}>When paid</option><option value="send" ${o.deductOn === 'send' ? 'selected' : ''}>When sent to the kitchen</option></select></div>
      <div class="field"><label for="os-h">Receipt header</label><input class="input" id="os-h" name="receiptHeader" value="${esc(o.receiptHeader)}"></div>
      <div class="field"><label for="os-f">Receipt footer</label><input class="input" id="os-f" name="receiptFooter" value="${esc(o.receiptFooter)}"></div>
      <div class="field"><label for="os-li">Word for one item</label><input class="input" id="os-li" name="labelItem" value="${esc(label('item', 'Menu item'))}" placeholder="Menu item, Product, Service"></div>
      <div class="field"><label for="os-ls">Word for the list</label><input class="input" id="os-ls" name="labelItems" value="${esc(label('items', 'Menu'))}" placeholder="Menu, Products, Services"></div>
      </div>
      <fieldset><legend>Payment methods at the till</legend>${['cash', 'card_external', 'qr_manual', 'ewallet_manual', 'other'].map((m) => `<label class="pos-opt"><input type="checkbox" name="m:${m}" ${o.methods.includes(m) ? 'checked' : ''}> ${esc(P.METHODS[m].label)}</label>`).join('')}
      <p class="faint">Card tap and dynamic DuitNow QR switch on here once a payment partner is connected.</p></fieldset>
      <label class="pos-opt"><input type="checkbox" name="tips" ${o.tips ? 'checked' : ''}> Ask for tips</label><label class="pos-opt"><input type="checkbox" name="sound" ${o.sound ? 'checked' : ''}> Sound on the kitchen display</label>
      <div class="actions" style="margin-top:12px"><button type="submit" class="btn btn-primary" ${can('settings') ? '' : 'disabled'}>Save settings</button></div></form>`;
  }
  function saveSettings(d) {
    if (!can('settings')) { ctx.toast('Only a manager changes outlet settings', 'error'); return; }
    const o = outlet(), taxes = {};
    for (const ln of String(d.taxes || '').split('\n').map((x) => x.trim()).filter(Boolean)) {
      const [code, lab, rate] = ln.split(',').map((x) => x.trim());
      const r = Math.round(parseFloat(rate) * 100);
      if (!code || !(r >= 0) || r > 10000) { ctx.toast(`Check the tax line “${ln}”`, 'error'); return; }
      taxes[code.toUpperCase()] = { label: lab || code, rateBp: r };
    }
    if (!taxes[String(d.defaultTaxCode).toUpperCase()]) { ctx.toast('The default tax code must be one of the tax codes', 'error'); return; }
    const before = JSON.stringify(o);
    Object.assign(o, { name: d.name.trim() || o.name, code: (d.code || o.code).trim().toUpperCase(), address: d.address.trim(), sstNo: d.sstNo.trim(), taxes, defaultTaxCode: String(d.defaultTaxCode).toUpperCase(),
      serviceCharge: { enabled: !!d.scOn, rateBp: Math.round((parseFloat(d.scRate) || 0) * 100), orderTypes: d.scDine ? ['dine_in'] : ['dine_in', 'takeaway', 'delivery'], taxCode: (d.scTax || '').trim().toUpperCase() },
      discountLimitBp: Math.round((parseFloat(d.discountLimit) || 0) * 100), deductOn: d.deductOn, receiptHeader: d.receiptHeader.trim(), receiptFooter: d.receiptFooter.trim(),
      methods: ['cash', 'card_external', 'qr_manual', 'ewallet_manual', 'other'].filter((m) => d[`m:${m}`]), tips: !!d.tips, sound: !!d.sound,
      labels: { item: d.labelItem.trim() || 'Menu item', items: d.labelItems.trim() || 'Menu' } });
    if (!o.methods.length) o.methods = ['cash'];
    if (before !== JSON.stringify(o)) audit('settings', o.name, 'Outlet settings changed');
    ctx.commit('Outlet settings saved');
  }
  // Excel or CSV menu import: the columns are found by their headings (name, price, category, station, tax), the
  // same idea as the staff import. New categories are created; an existing name updates its price (a manager only).
  async function importMenu(file) {
    const I = window.AllurusImport, chk = I.checkFile(file.name, file.size);
    if (chk.error) { ctx.toast(chk.error, 'error'); return; }
    try {
      const X = window.XLSX || await new Promise((ok, fail) => { const el = document.createElement('script'); el.src = 'js/vendor/xlsx.full.min.js?v=0.20.3'; el.onload = () => ok(window.XLSX); el.onerror = fail; document.head.appendChild(el); });
      const book = I.parseBook(X, await file.arrayBuffer(), file.name.split('.').pop().toLowerCase(), true);
      const grid = book.sheets[book.names[0]] || [];
      const hi = grid.findIndex((r) => r.some((c) => /^(name|item|menu|nama|product|produk)/i.test(String(c))));
      if (hi < 0) { ctx.toast('No “Name” column found', 'error'); return; }
      const H = grid[hi].map((c) => String(c).toLowerCase().trim());
      const col = (re) => H.findIndex((h) => re.test(h));
      const c = { name: col(/^(name|item|menu|nama|product|produk)/), price: col(/(price|harga|rm|selling)/), cat: col(/(categ|kategori|group)/), station: col(/(station|stesen)/), tax: col(/(tax|cukai|sst)/) };
      if (c.price < 0) { ctx.toast('No “Price” column found', 'error'); return; }
      let added = 0, updated = 0, skipped = 0;
      grid.slice(hi + 1).forEach((r) => {
        const name = String(r[c.name] ?? '').trim(), price = P.toSen(String(r[c.price] ?? '').replace(/^rm\s*/i, ''));
        if (!name || !(price >= 0)) { if (name) skipped++; return; }
        let catId = pos().categories[0]?.id;
        const cn = c.cat >= 0 ? String(r[c.cat] ?? '').trim() : '';
        if (cn) { let cat = pos().categories.find((x) => x.name.toLowerCase() === cn.toLowerCase()); if (!cat) { cat = { id: U.uid('c'), name: cn, order: pos().categories.length, active: true }; pos().categories.push(cat); } catId = cat.id; }
        const ex = pos().items.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (ex) { if (ex.price !== price && can('price')) { audit('price', ex.name, `${M(ex.price)} → ${M(price)} (import)`); ex.price = price; updated++; } return; }
        const tax = c.tax >= 0 ? String(r[c.tax] ?? '').trim().toUpperCase() : '';
        pos().items.push({ id: U.uid('m'), name, price, categoryId: catId, station: /bar|drink|minum/i.test(c.station >= 0 ? r[c.station] : '') ? 'bar' : 'kitchen', taxCode: outlet().taxes[tax] ? tax : outlet().defaultTaxCode, modifierGroupIds: [], recipe: [], active: true, soldOut: false, photo: '' });
        added++;
      });
      ctx.commit(`Imported: ${added} new, ${updated} price${updated === 1 ? '' : 's'} updated${skipped ? `, ${skipped} skipped (no price)` : ''}`);
    } catch (e) { ctx.toast('The file could not be read', 'error'); }
  }

  // ---------- Reports ----------
  function reportsView() {
    if (!has()) return '';
    const day = ui.day || T(), sum = P.daySales(pos().orders, pos().payments, day);
    const hours = Object.keys(sum.byHour).map(Number).sort((a, b) => a - b), peak = Math.max(1, ...Object.values(sum.byHour));
    const byCat = {}; pos().orders.filter((o) => o.status === 'paid' && P.klDay(o.paidAt) === day).forEach((o) => o.lines.filter((l) => l.status !== 'void').forEach((l) => { const k = catName(item(l.itemId)?.categoryId); byCat[k] = (byCat[k] || 0) + P.lineGross(l); }));
    const disc = pos().orders.filter((o) => o.discount && o.paidAt && P.klDay(o.paidAt) === day);
    const voids = pos().orders.filter((o) => o.status === 'void' && o.voidedAt && P.klDay(o.voidedAt) === day && !o.mergedInto);
    const shifts = pos().shifts.filter((s) => P.klDay(s.openedAt) === day);
    const posted = st().finance.txns.some((t) => t.source === 'pos' && t.date === day);
    const rec = P.toReconcile(pos().payments.filter((p) => !p.reconciled && P.klDay(p.createdAt) === day));
    const tab = ui.repTab;
    return `${head('Sales reports', `${U.fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })} · Kuala Lumpur time`, `<input class="input" type="date" id="pos-day" value="${day}" max="${T()}" aria-label="Day"><button class="btn" data-act="pos-export" data-v="csv">${icon('download')}CSV</button><button class="btn" data-act="pos-export" data-v="xlsx">${icon('download')}Excel</button>${window.AllurusAccess?.can('finance') || posRole() === 'manager' ? `<button class="btn btn-primary" data-act="pos-post" ${posted || day >= T() || !sum.orders ? 'disabled' : ''}>${posted ? 'Posted to Finance' : day >= T() ? 'Post after the day ends' : 'Post to Finance'}</button>` : ''}`)}
      <div class="grid g-4 keep-2">${[['Sales (incl. tax)', M(sum.total)], ['Orders', sum.orders], ['Average bill', M(sum.orders ? Math.round(sum.total / sum.orders) : 0)], ['Tax collected', M(sum.tax)], ['Service charge', M(sum.serviceCharge)], ['Discounts', M(sum.discount)], ['Voids', sum.voids], ['Tips', M(sum.tips)]].map(([l, v]) => `<div class="card kpi"><div class="kpi-label">${l}</div><div class="kpi-value num">${v}</div></div>`).join('')}</div>
      <div class="seg rc-tabs" role="tablist">${[['sales', 'By hour & method'], ['items', 'Items & categories'], ['staff', 'Cashiers & shifts'], ['control', 'Discounts & voids'], ['recon', `Reconcile${rec.length ? ` (${rec.length})` : ''}`], ['audit', 'Audit log']].map(([k, l]) => `<button role="tab" data-act="pos-rep-tab" data-v="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      ${tab === 'sales' ? `<div class="grid g-2"><div class="card"><div class="card-head"><h3>By hour</h3></div><div class="pos-bars">${hours.map((h) => `<div class="pos-bar-row"><span class="faint num">${String(h).padStart(2, '0')}:00</span><span class="pos-bar" style="width:${Math.round((sum.byHour[h] / peak) * 100)}%"></span><span class="num">${M(sum.byHour[h])}</span></div>`).join('') || '<p class="faint">No sales</p>'}</div></div>
        <div class="card"><div class="card-head"><h3>By payment method</h3></div><ul class="hr-list">${Object.entries(sum.byMethod).map(([m, v]) => `<li><span>${esc(P.METHODS[m]?.label || m)}</span><strong class="num">${M(v)}</strong></li>`).join('') || '<li class="faint">None</li>'}</ul></div></div>`
      : tab === 'items' ? `<div class="grid g-2"><div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Sales</th></tr></thead><tbody>${Object.values(sum.byItem).sort((a, b) => b.sales - a.sales).map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.qty}</td><td class="num">${M(x.sales)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h3>By category</h3></div><ul class="hr-list">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><span>${esc(k)}</span><strong class="num">${M(v)}</strong></li>`).join('')}</ul></div></div>`
      : tab === 'staff' ? `<div class="grid g-2"><div class="card"><div class="card-head"><h3>By cashier</h3><span class="hint">For commission rules in Payroll</span></div><ul class="hr-list">${Object.entries(sum.byCashier).map(([k, v]) => `<li><span>${esc(ctx.emp(k) ? ctx.fullName(ctx.emp(k)) : k)}</span><strong class="num">${M(v)}</strong></li>`).join('')}</ul></div>
        <div class="card"><div class="card-head"><h3>Shifts</h3></div><ul class="hr-list">${shifts.map((s) => `<li><span>${esc(first(s.cashierUid))} ${s.closedAt ? '' : pill('occupied', 'open')}</span><span class="num">${s.closedAt ? `${M(s.countedCash)} counted · ${s.variance ? `${s.variance > 0 ? '+' : ''}${M(s.variance)}` : 'no variance'}` : ''}</span></li>`).join('') || '<li class="faint">None</li>'}</ul></div></div>`
      : tab === 'control' ? `<div class="grid g-2"><div class="card"><div class="card-head"><h3>Discounts</h3></div><ul class="hr-list">${disc.map((o) => `<li><span>${esc(o.receiptNo)} · ${esc(o.discountRule?.reason || '')} <span class="faint">${first(o.discountRule?.by)}</span></span><strong class="num">−${M(o.discount)}</strong></li>`).join('') || '<li class="faint">None</li>'}</ul></div>
        <div class="card"><div class="card-head"><h3>Voids and refunds</h3></div><ul class="hr-list">${voids.map((o) => `<li><span>${esc(o.receiptNo || where(o))} · ${esc(o.voidReason || '')} <span class="faint">by ${first(o.voidedBy)}</span></span><strong class="num">${M(o.total)}</strong></li>`).join('') || '<li class="faint">None</li>'}</ul></div></div>`
      : tab === 'recon' ? `<div class="card card-flush"><p class="faint" style="padding:16px 20px 0">Card and QR payments recorded by hand. Tick each against the terminal’s or bank’s settlement report.</p><div class="table-wrap"><table><thead><tr><th>Time</th><th>Method</th><th>Reference</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rec.map((p) => `<tr><td>${new Date(p.createdAt).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(P.METHODS[p.method].label)}</td><td>${esc(p.approvalCode || p.qrReference || '')}${p.cardLast4 ? ` · ${esc(p.cardBrand || '')} ••${esc(p.cardLast4)}` : ''}</td><td class="num">${M(p.amount)}</td><td><button class="btn btn-sm" data-act="pos-reconcile" data-id="${p.id}">Matched</button></td></tr>`).join('') || '<tr><td colspan="5" class="faint">Nothing to reconcile for this day</td></tr>'}</tbody></table></div></div>`
      : `<div class="card card-flush"><div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>${pos().audit.slice(-80).reverse().map((a) => `<tr><td>${new Date(a.at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(first(a.by))}</td><td>${esc(a.action)} · ${esc(a.ref || '')}</td><td>${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div></div>`}`;
  }
  function reportRows(day) {
    const sum = P.daySales(pos().orders, pos().payments, day);
    const rows = [['Receipt', 'Paid at', 'Type', 'Cashier', 'Subtotal', 'Discount', 'Service charge', 'Tax', 'Rounding', 'Total', 'Methods']];
    pos().orders.filter((o) => o.status === 'paid' && P.klDay(o.paidAt) === day).forEach((o) => rows.push([o.receiptNo, new Date(o.paidAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }), o.type, first(o.createdBy), o.subtotal / 100, o.discount / 100, o.serviceCharge / 100, o.tax / 100, (o.rounding || 0) / 100, (o.total + (o.rounding || 0)) / 100, paysOf(o).map((p) => p.method).join(' + ')]));
    rows.push([], ['Total', '', '', '', sum.gross / 100, sum.discount / 100, sum.serviceCharge / 100, sum.tax / 100, sum.rounding / 100, sum.total / 100]);
    return rows;
  }
  async function exportDay(kind) {
    const day = ui.day || T(), rows = reportRows(day), name = `pos-sales-${day}`;
    if (kind === 'csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([P.csv(rows)], { type: 'text/csv' })); a.download = `${name}.csv`; a.click(); return; }
    try {
      const X = window.XLSX || await new Promise((ok, fail) => { const el = document.createElement('script'); el.src = 'js/vendor/xlsx.full.min.js?v=0.20.3'; el.onload = () => ok(window.XLSX); el.onerror = fail; document.head.appendChild(el); });
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Sales'); X.writeFile(wb, `${name}.xlsx`);
    } catch (e) { ctx.toast('Excel export could not load; use CSV', 'error'); }
  }
  function postDay() {
    const day = ui.day || T();
    if (day >= T()) { ctx.toast('Post a day once it has ended', 'error'); return; }
    if (st().finance.reports[U.monthKey(day)]?.status === 'Verified') { ctx.toast(`${U.fmtMonth(U.monthKey(day))} is verified by your auditor and locked`, 'error'); return; }
    const have = new Set(st().finance.txns.filter((t) => t.source === 'pos').map((t) => t.ref));
    const add = P.financeEntries(P.daySales(pos().orders, pos().payments, day)).filter((e) => !have.has(e.ref));
    if (!add.length) { ctx.toast('Already posted'); return; }
    add.forEach((e) => st().finance.txns.push({ id: U.uid('x'), reconciled: false, ...e }));
    audit('finance-post', day, `${add.length} entries posted`);
    ctx.commit(`${add.length} entries posted to Finance for ${U.fmtDate(day)}`, `POS sales for ${day} posted to the books`);
  }

  // ---------- Hooks used by the app ----------
  const ROUTES = { pos: ['manager', 'cashier', 'waiter'], 'pos-tables': ['manager', 'cashier', 'waiter'], 'pos-kitchen': ['manager', 'cashier', 'waiter', 'kitchen'], 'pos-shift': ['manager', 'cashier'], 'pos-menu': ['manager'], 'pos-reports': ['manager'] };
  const routeAllowed = (id) => (!/^pos(-|$)/.test(id) ? true : has() && !!ROUTES[id]?.includes(posRole()));
  const landing = (role) => (has() && role === 'employee' ? ({ kitchen: 'pos-kitchen', cashier: 'pos', waiter: 'pos-tables' })[posRole()] || '' : '');
  const badge = (id) => (!has() ? 0 : id === 'pos-kitchen' ? tickets().filter((t) => t.stage === 'new').length : id === 'pos-tables' ? pos().tables.filter((t) => t.status === 'billing').length : 0);
  function insights() {
    if (!has() || posRole() !== 'manager') return [];
    const out = [], y = U.addDays(T(), -1);
    if (P.daySales(pos().orders, pos().payments, y).orders && !st().finance.txns.some((t) => t.source === 'pos' && t.date === y)) out.push({ tone: 'warn', icon: 'doc', title: 'Yesterday’s POS sales are not in the books yet', detail: 'One entry per payment method, with tax and service charge kept apart.', action: { label: 'Open reports', act: 'pos-go', id: 'pos-reports' }, prio: 3 });
    const late = pos().shifts.filter((s) => s.closedAt && s.variance && P.klDay(s.closedAt) === y);
    if (late.length) out.push({ tone: 'warn', icon: 'wallet', title: `Cash variance yesterday: ${late.map((s) => `${s.variance > 0 ? '+' : ''}${M(s.variance)}`).join(', ')}`, detail: 'Counted cash did not match what the till expected.', action: { label: 'See shifts', act: 'pos-go', id: 'pos-shift' }, prio: 4 });
    return out;
  }

  let timer = null;
  function install(c) {
    ctx = c;
    Object.assign(ctx.VIEWS, { pos: tillView, 'pos-tables': tablesView, 'pos-kitchen': kitchenView, 'pos-shift': shiftView, 'pos-menu': menuView, 'pos-reports': reportsView });
    ctx.AFTER.pos = () => {
      paintCart();
      ctx.$('#pos-q')?.addEventListener('input', (ev) => { ui.q = ev.target.value; ctx.$('#pos-grid').innerHTML = menuGrid(); });
      ctx.$('#pos-table')?.addEventListener('change', (ev) => { ui.tableId = ev.target.value; });
    };
    ctx.AFTER['pos-kitchen'] = () => {
      const n = tickets().filter((t) => t.stage === 'new').length;
      if (ui.seenTickets != null && n > ui.seenTickets) beep();
      ui.seenTickets = n;
      clearInterval(timer);
      timer = setInterval(() => { if (!document.querySelector('.pos-kds')) { clearInterval(timer); return; } document.querySelectorAll('.pos-timer').forEach((el) => { el.textContent = elapsed(el.dataset.since); }); }, 1000);
    };
    ctx.AFTER['pos-reports'] = () => ctx.$('#pos-day')?.addEventListener('change', (ev) => { if (ev.target.value) { ui.day = ev.target.value; ctx.render(); } });
    ctx.AFTER['pos-menu'] = () => ctx.$('#pos-settings')?.addEventListener('submit', (ev) => { ev.preventDefault(); saveSettings(Object.fromEntries(new FormData(ev.target).entries())); });
    window.addEventListener('online', () => { if (has()) { flushQueue(); ctx.render(); } });
    window.addEventListener('offline', () => { if (has()) ctx.render(); });
    Object.assign(ctx.ACTIONS, {
      'pos-go': (id) => { location.hash = id; },
      'pos-type': (_, v) => { ui.type = v; ui.tableId = ''; ctx.render(); },
      'pos-cat': (_, v) => { ui.cat = v; ctx.$('#pos-grid').innerHTML = menuGrid(); document.querySelectorAll('.pos-cats button').forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-selected', b.dataset.v === v); }); },
      'pos-add': (id) => addModal(id),
      'pos-qty': (id, v) => { const o = current(), l = o?.lines.find((x) => x.id === id); if (!l) return; l.qty += +v; if (l.qty <= 0) o.lines = o.lines.filter((x) => x.id !== id); recalc(o); paintCart(); saveSoon(); },
      'pos-line-note': (id) => { const l = current()?.lines.find((x) => x.id === id); const n = l && prompt('Note for the kitchen', l.note || ''); if (n != null && l) { l.note = n.slice(0, 80); paintCart(); saveSoon(); } },
      'pos-line-void': (id) => voidModal(current(), id),
      'pos-new': () => { ui.orderId = ''; ui.tableId = ''; ctx.render(); },
      'pos-resume': (id) => { ui.orderId = id; ctx.render(); },
      'pos-hold': () => { ui.orderId = ''; ui.cartOpen = false; ctx.commit('Order held; find it under Open orders'); },
      'pos-send': () => { const o = current(); if (o) send(o); },
      'pos-pay': () => { const o = current(); if (!o) return; if (o.lines.some((l) => !l.sentAt && l.status !== 'void') && o.type === 'dine_in') send(o); payModal(o); },
      'pos-discount': () => { const o = current(); if (o) discountModal(o); },
      'pos-discount-clear': () => { const o = current(); if (!o) return; o.discountRule = null; recalc(o); audit('discount', where(o), 'Discount removed'); ctx.closeOverlay(); ctx.commit('Discount removed'); },
      'pos-void-order': () => { const o = current(); if (!o) return; if (!o.lines.some((l) => l.sentAt) && !paysOf(o).length) { Object.assign(o, { status: 'void', voidedAt: nowIso(), voidReason: 'Cancelled before sending', voidedBy: actor() }); if (o.tableId) Object.assign(table(o.tableId), { status: 'free', currentOrderId: '' }); ui.orderId = ''; ctx.commit('Order cancelled'); return; } if (paysOf(o).some((p) => p.status === 'approved')) { ctx.toast('Part paid: finish the payment, then refund it from the report', 'error'); return; } voidModal(o); },
      'pos-table-tools': () => { const o = current(); if (o) tableTools(o); },
      'pos-cart-toggle': () => { ui.cartOpen = !ui.cartOpen; ctx.$('.pos-wrap')?.classList.toggle('cart-open', ui.cartOpen); paintCart(); },
      'pos-table': (id) => { const t = table(id); if (t.currentOrderId) { ui.orderId = t.currentOrderId; } else { ui.orderId = ''; ui.type = 'dine_in'; ui.tableId = id; } location.hash = 'pos'; ctx.render(); },
      'pos-station': (_, v) => { ui.station = v; ctx.render(); },
      'pos-tk': (id, v) => { const o = order(id); o.lines.filter((l) => l.sentAt && ['new', 'preparing', 'ready'].includes(l.status) && (ui.station === 'all' || l.station === ui.station)).forEach((l) => { if (v === 'served' || l.status !== 'ready') l.status = v; }); if (o.tableId && v === 'served' && o.lines.every((l) => ['served', 'void'].includes(l.status))) { /* table stays until paid */ } ctx.commit(v === 'ready' ? `${where(o)} ready` : v === 'served' ? `${where(o)} served` : `${where(o)} started`); },
      'pos-print': (id) => printReceipt(id),
      'pos-receipt': (id) => receiptModal(id),
      'pos-shift-open': () => moneyModal('Open shift', 'Opening cash in the drawer', 'Open shift', (v) => { pos().shifts.push({ id: U.uid('sh'), outletId: outlet().id, cashierUid: actor(), openedAt: nowIso(), openingCash: v, cashMoves: [] }); ctx.commit('Shift open'); }),
      'pos-cash': (_, kind) => moneyModal(kind === 'in' ? 'Cash in' : 'Cash out', 'Amount', 'Record', (v, d) => { if (!d.reason?.trim()) { ctx.toast('Say what it was for', 'error'); return false; } openShift().cashMoves.push({ kind, amount: v, reason: d.reason.trim(), at: nowIso(), by: actor() }); ctx.commit(`Cash ${kind} ${M(v)} recorded`); return undefined; }, '<div class="field"><label for="mm-r">Reason</label><input class="input" id="mm-r" name="reason" maxlength="60" required></div>'),
      'pos-shift-close': () => {
        const sh = openShift(); if (!sh) return;
        if (pos().orders.some((o) => o.status === 'sent' && paysOf(o).some((p) => p.status === 'approved'))) { ctx.toast('Finish the part-paid bills first', 'error'); return; }
        moneyModal('Close shift', 'Cash counted in the drawer', 'Close shift', (v) => {
          const sum = P.shiftSummary({ ...sh, countedCash: v }, pos().payments, pos().refunds);
          Object.assign(sh, { closedAt: nowIso(), closedBy: actor(), countedCash: v, expectedCash: sum.expectedCash, variance: sum.variance });
          if (sum.variance) audit('shift-variance', first(sh.cashierUid), `Expected ${M(sum.expectedCash)}, counted ${M(v)}: ${sum.variance > 0 ? '+' : ''}${M(sum.variance)}`);
          ctx.commit(sum.variance ? `Shift closed · variance ${sum.variance > 0 ? '+' : ''}${M(sum.variance)}` : 'Shift closed · the cash matches');
        }, '<p class="faint">Count before you look at the expected figure; it is shown after closing.</p>');
      },
      'pos-menu-tab': (_, v) => { ui.menuTab = v; ctx.render(); },
      'pos-item': (id) => itemModal(id),
      'pos-soldout': (id) => { const i = item(id); i.soldOut = !i.soldOut; ctx.commit(`${i.name} ${i.soldOut ? 'sold out' : 'available again'}`); },
      'pos-tables-save': () => {
        const lines = ctx.$('#pos-tables-txt').value.split('\n').map((x) => x.split(',').map((y) => y.trim())).filter((x) => x[0]);
        const next = lines.map(([name, section = 'Indoor', seats = '4']) => { const old = pos().tables.find((t) => t.name === name); return old ? { ...old, section, seats: parseInt(seats, 10) || 4 } : { id: U.uid('tb'), name, section, seats: parseInt(seats, 10) || 4, status: 'free', currentOrderId: '' }; });
        const lost = pos().tables.filter((t) => t.currentOrderId && !next.some((n) => n.id === t.id));
        if (lost.length) { ctx.toast(`${lost.map((t) => t.name).join(', ')} has an open bill; keep it until it is paid`, 'error'); return; }
        pos().tables = next; audit('settings', 'Tables', `${next.length} tables`); ctx.commit('Tables saved');
      },
      'pos-import': () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = () => inp.files[0] && importMenu(inp.files[0]); inp.click(); },
      'pos-rep-tab': (_, v) => { ui.repTab = v; ctx.render(); },
      'pos-export': (_, v) => exportDay(v),
      'pos-post': () => postDay(),
      'pos-reconcile': (id) => { const p = pos().payments.find((x) => x.id === id); p.reconciled = true; p.reconciledBy = actor(); ctx.commit('Marked as matched'); },
    });
    return { has, routeAllowed, landing, badge, insights, posRole, ui };
  }
  return { install };
})();
