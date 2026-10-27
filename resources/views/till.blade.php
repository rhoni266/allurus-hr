<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="{{ csrf_token() }}">
<meta name="robots" content="noindex">
<title>Till · Allurus POS</title>
<style>
:root{--bg:#f3f4f6;--card:#fff;--ink:#111827;--mute:#6b7280;--line:#e5e7eb;--accent:#0f766e;--accent-ink:#fff;--accent-soft:#ccfbf1;--bad:#b91c1c;--bad-soft:#fee2e2;--warn:#b45309;--warn-soft:#fef3c7;--tile:#f9fafb}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--card:#171a20;--ink:#e8eaee;--mute:#9aa3b2;--line:#272c36;--accent:#2dd4bf;--accent-ink:#04201d;--accent-soft:#0f2f2c;--bad:#f87171;--bad-soft:#3b1414;--warn:#fbbf24;--warn-soft:#3a2d0c;--tile:#1d2129}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
button{font:inherit;color:inherit;cursor:pointer}
input{font:inherit;color:inherit}
.hidden{display:none!important}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--line)}
.top b{font-size:16px}.top .m{color:var(--mute);font-size:13px}
.link{background:none;border:0;color:var(--mute);text-decoration:underline;padding:4px}
.center{display:grid;place-items:center;min-height:calc(100vh - 56px);padding:16px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;width:100%;max-width:420px}
.panel h1{font-size:19px;margin:0 0 6px}.panel p{color:var(--mute);margin:0 0 16px;font-size:14px}
label{display:block;font-size:13px;color:var(--mute);margin:10px 0 4px}
.in{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--tile)}
.btn{border:0;border-radius:10px;padding:12px 16px;font-weight:600;background:var(--tile);border:1px solid var(--line)}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn.block{width:100%;margin-top:14px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.err{color:var(--bad);font-size:13px;min-height:18px;margin-top:8px}
code{background:var(--tile);padding:1px 5px;border-radius:5px;font-size:13px}
.staff{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:12px}
.staff button{padding:12px 8px;border:1px solid var(--line);border-radius:10px;background:var(--tile);text-align:left}
.staff button.on{border-color:var(--accent);background:var(--accent-soft)}
.staff small{display:block;color:var(--mute);font-size:12px}
.dots{display:flex;gap:10px;justify-content:center;margin:12px 0}
.dots span{width:13px;height:13px;border-radius:50%;border:2px solid var(--mute)}.dots span.f{background:var(--ink);border-color:var(--ink)}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pad button{padding:15px 0;font-size:20px;border-radius:10px;border:1px solid var(--line);background:var(--tile)}
.sell{display:grid;grid-template-columns:1fr 380px;height:calc(100vh - 56px)}
@media (max-width:860px){.sell{grid-template-columns:1fr;height:auto}}
.products{padding:14px;overflow:auto}
.search{margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.prod{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 12px;text-align:left;min-height:86px;display:flex;flex-direction:column;justify-content:space-between}
.prod:active{transform:scale(.98)}
.prod .n{font-weight:600}.prod .p{color:var(--accent);font-weight:600;font-variant-numeric:tabular-nums}
.cart{background:var(--card);border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
@media (max-width:860px){.cart{border-left:0;border-top:1px solid var(--line)}}
.cart h2{margin:0;padding:14px 16px;font-size:15px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.lines{flex:1;overflow:auto;padding:6px 16px}
.line{display:grid;grid-template-columns:1fr auto;gap:4px;padding:10px 0;border-bottom:1px solid var(--line)}
.line .n{font-weight:500}.line .u{color:var(--mute);font-size:13px}
.qty{display:flex;align-items:center;gap:6px}
.qty button{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:var(--tile);font-weight:700}
.amt{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.empty{color:var(--mute);text-align:center;padding:40px 0}
.totals{padding:12px 16px;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
.row{display:flex;justify-content:space-between;padding:2px 0;color:var(--mute);font-size:14px}
.row.big{color:var(--ink);font-size:22px;font-weight:700;padding-top:6px}
.opts{display:flex;justify-content:space-between;align-items:center;padding:0 16px 4px;font-size:14px}
.charge{margin:10px 16px 16px;padding:16px;font-size:18px}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px;z-index:9}
.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.tenders{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px}
.tenders button.on{border-color:var(--accent);background:var(--accent-soft)}
.change{font-size:28px;font-weight:700;text-align:center;margin:8px 0 2px;font-variant-numeric:tabular-nums}
.receipt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:var(--tile);border-radius:10px;padding:12px;margin:10px 0}
.receipt .row{color:var(--ink);font-size:13px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--warn-soft);color:var(--warn);margin:2px}
.recent{padding:8px 16px 14px;border-top:1px solid var(--line);font-size:13px;color:var(--mute)}
.recent div{display:flex;justify-content:space-between;padding:3px 0;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<div class="top">
    <div><b>Allurus Till</b> <span class="m" id="devName"></span></div>
    <div><span class="m" id="who"></span> <button class="link hidden" id="signOut">Sign out</button> <button class="link hidden" id="forget">Forget this till</button></div>
</div>

{{-- 1. pair this browser --}}
<div class="center hidden" id="vPair">
    <form class="panel" id="pairForm">
        <h1>Pair this browser as a till</h1>
        <p>Get a one-time code on the server:<br><code>php artisan pos:pairing-code demo-cafe</code> (lists outlets), then <code>php artisan pos:pairing-code demo-cafe &lt;outlet-id&gt;</code></p>
        <label for="code">Pairing code</label>
        <input class="in" id="code" autocomplete="off" maxlength="16" placeholder="e.g. 7KQ2M9XA" required>
        <label for="tname">Till name</label>
        <input class="in" id="tname" maxlength="40" placeholder="Web till" value="Web till">
        <button class="btn primary block" id="pairBtn">Pair</button>
        <div class="err" id="pairErr"></div>
    </form>
</div>

{{-- 2. staff sign-in --}}
<div class="center hidden" id="vLogin">
    <div class="panel">
        <h1>Who's on the till?</h1>
        <p>Pick your name and enter your PIN. Demo PINs: 111111 (owner), 2222, 3333.</p>
        <div class="staff" id="staffList"></div>
        <div class="dots" id="dots"></div>
        <div class="pad" id="pad"></div>
        <div class="err" id="loginErr"></div>
    </div>
</div>

{{-- 3. selling --}}
<div class="sell hidden" id="vSell">
    <div class="products">
        <input class="in search" id="search" placeholder="Search products" autocomplete="off">
        <div class="grid" id="grid"></div>
    </div>
    <aside class="cart">
        <h2><span>Current sale</span><button class="link" id="clear">Clear</button></h2>
        <div class="lines" id="lines"></div>
        <div class="totals" id="totals"></div>
        <div class="opts"><label style="margin:0;color:var(--ink)"><input type="checkbox" id="kitchen" checked> Send to kitchen</label></div>
        <button class="btn primary charge" id="chargeBtn" disabled>Charge</button>
        <div class="recent" id="recent"></div>
    </aside>
</div>

{{-- payment --}}
<div class="modal hidden" id="mPay">
    <div class="panel">
        <h1>Take payment</h1>
        <div class="row big"><span>Total</span><span id="payTotal"></span></div>
        <div class="tenders" style="margin-top:12px"><button class="btn on" data-tender="cash">Cash</button><button class="btn" data-tender="card">Card</button></div>
        <div id="cashBox">
            <label for="tendered">Cash received (RM)</label>
            <input class="in" id="tendered" inputmode="decimal" autocomplete="off">
            <div class="quick" id="quick"></div>
        </div>
        <div class="row" style="margin-top:10px"><span>Change</span><span id="payChange">RM 0.00</span></div>
        <button class="btn primary block" id="confirmBtn">Complete sale</button>
        <button class="btn block" id="cancelPay">Back</button>
        <div class="err" id="payErr"></div>
    </div>
</div>

{{-- receipt --}}
<div class="modal hidden" id="mDone">
    <div class="panel">
        <h1>Sale complete</h1>
        <div class="change" id="doneChange"></div>
        <div style="text-align:center;color:var(--mute)" id="doneChangeLabel">change</div>
        <div class="receipt" id="doneReceipt"></div>
        <div id="doneFlags"></div>
        <button class="btn primary block" id="newSale">New sale</button>
    </div>
</div>

<script>
const S = @json($state);
const csrf = document.querySelector('meta[name=csrf-token]').content;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// integer sen only: no float money anywhere
const rm = sen => { const neg = sen < 0, a = Math.abs(sen), r = Math.floor(a / 100).toLocaleString('en-MY'); return (neg ? '-' : '') + 'RM ' + r + '.' + String(a % 100).padStart(2, '0'); };
const qtyLabel = m => (m % 1000 === 0 ? String(m / 1000) : (m / 1000).toFixed(3).replace(/0+$/, ''));
const parseSen = txt => { const m = String(txt).trim().match(/^(\d{1,7})(?:\.(\d{0,2}))?$/); return m ? parseInt(m[1], 10) * 100 + parseInt((m[2] || '').padEnd(2, '0') || '0', 10) : null; };
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': csrf }, body: JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 409 && j.error === 'not_paired') { location.reload(); }
    return { ok: r.ok, status: r.status, body: j };
}
const errText = b => ({
    invalid_code: 'That code is wrong, used or expired. Get a new one.', code_expired: 'That code has expired.', attestation_failed: 'This server requires device attestation, which a browser cannot do.',
    not_a_till_code: 'That is a kitchen-device code. Issue a terminal code instead.', invalid_credentials: 'Wrong PIN.', too_many_attempts: 'Too many wrong PINs. Try again in ' + Math.ceil((b.retry_after || 900) / 60) + ' min.',
    pin_change_required: 'Managers and owners need a 6-digit PIN. Set one with php artisan pos:staff-pin.', staff_signed_out: 'Your sign-in expired. Sign in again.',
    not_enough_cash: 'Cash received is less than the total.', sale_not_stored: 'The server did not store the sale.',
}[b.error] || b.message || b.error || 'Something went wrong.');

function show(view) { for (const v of ['vPair', 'vLogin', 'vSell']) $(v).classList.toggle('hidden', v !== view); }
function header() {
    $('devName').textContent = S.device ? '· ' + S.device.name : '';
    $('who').textContent = S.staff ? S.staff.name + ' (' + S.staff.role + ')' : '';
    $('signOut').classList.toggle('hidden', !S.staff);
    $('forget').classList.toggle('hidden', !S.device);
}
function route() { header(); if (!S.device) show('vPair'); else if (!S.staff) { show('vLogin'); renderStaff(); } else { show('vSell'); renderGrid(); renderCart(); renderRecent(); } }

// ---- pairing
$('pairForm').onsubmit = async e => {
    e.preventDefault(); $('pairBtn').disabled = true; $('pairErr').textContent = '';
    const r = await post('/till/pair', { code: $('code').value, name: $('tname').value });
    if (r.ok) { location.reload(); return; }
    $('pairErr').textContent = errText(r.body); $('pairBtn').disabled = false;
};
$('forget').onclick = async () => { if (confirm('Forget this till in this browser? (It stays paired on the server.)')) { await post('/till/forget'); location.reload(); } };

// ---- sign-in
let picked = null, pin = '';
function renderStaff() {
    $('staffList').innerHTML = S.roster.length ? S.roster.map(s => `<button data-id="${esc(s.id)}" class="${picked === s.id ? 'on' : ''}">${esc(s.name)}<small>${esc(s.role)}</small></button>`).join('')
        : '<div class="err">No staff for this outlet. Run the DemoSeeder or add staff.</div>';
    $('staffList').querySelectorAll('button').forEach(b => b.onclick = () => { picked = b.dataset.id; pin = ''; renderStaff(); renderDots(); });
    renderDots();
}
function renderDots() { const n = Math.max(4, pin.length); $('dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'f' : ''}"></span>`).join(''); }
$('pad').innerHTML = ['1','2','3','4','5','6','7','8','9','⌫','0','OK'].map(k => `<button data-k="${k}">${k}</button>`).join('');
$('pad').querySelectorAll('button').forEach(b => b.onclick = () => pressKey(b.dataset.k));
document.addEventListener('keydown', e => { if ($('vLogin').classList.contains('hidden')) return; if (/^\d$/.test(e.key)) pressKey(e.key); else if (e.key === 'Backspace') pressKey('⌫'); else if (e.key === 'Enter') pressKey('OK'); });
async function pressKey(k) {
    $('loginErr').textContent = '';
    if (k === '⌫') pin = pin.slice(0, -1); else if (k !== 'OK' && pin.length < 8) pin += k;
    renderDots();
    if (k !== 'OK') return;
    if (!picked) { $('loginErr').textContent = 'Pick your name first.'; return; }
    const r = await post('/till/login', { staff_id: picked, pin });
    pin = ''; renderDots();
    if (r.ok) { S.staff = r.body.staff; route(); } else { $('loginErr').textContent = errText(r.body); }
}
$('signOut').onclick = async () => { await post('/till/logout'); S.staff = null; cart = []; quote = null; route(); };

// ---- selling
let cart = [], quote = null, tender = 'cash', orderId = null;
function renderGrid() {
    const q = $('search').value.trim().toLowerCase();
    const items = S.catalogue.filter(p => !q || p.name.toLowerCase().includes(q));
    $('grid').innerHTML = items.length ? items.map(p => `<button class="prod" data-id="${esc(p.variant_id)}"><span class="n">${esc(p.name)}</span><span class="p">${rm(p.price_sen)}</span></button>`).join('')
        : '<div class="empty">No products. Run php artisan migrate:fresh --seed --seeder=DemoSeeder</div>';
    $('grid').querySelectorAll('.prod').forEach(b => b.onclick = () => add(b.dataset.id, 1000));
}
$('search').oninput = renderGrid;
function add(id, milli) {
    const l = cart.find(x => x.variant_id === id);
    if (l) l.qty_milli += milli; else cart.push({ variant_id: id, qty_milli: milli });
    cart = cart.filter(x => x.qty_milli > 0);
    quote = null; renderCart();
    clearTimeout(add.t); add.t = setTimeout(reprice, 250);   // price once after a burst of taps
}
$('clear').onclick = () => { cart = []; reprice(); };
let pricing = 0;
async function reprice() {
    renderCart();
    if (!cart.length) { quote = null; renderCart(); return; }
    const mine = ++pricing;
    const r = await post('/till/quote', { lines: cart, tender });
    if (mine !== pricing) return;   // a newer tap is already being priced
    quote = r.ok ? r.body : null;
    renderCart();
}
function renderCart() {
    const byId = Object.fromEntries(S.catalogue.map(p => [p.variant_id, p]));
    const priced = quote ? Object.fromEntries(quote.lines.map(l => [l.variant_id, l])) : {};
    $('lines').innerHTML = cart.length ? cart.map(l => {
        const p = byId[l.variant_id], net = priced[l.variant_id];
        return `<div class="line"><div><div class="n">${esc(p.name)}</div><div class="u">${rm(p.price_sen)} each</div></div>
            <div class="amt">${net ? rm(net.net_sen) : '…'}</div>
            <div class="qty"><button data-id="${esc(l.variant_id)}" data-d="-1000">−</button><span>${qtyLabel(l.qty_milli)}</span><button data-id="${esc(l.variant_id)}" data-d="1000">+</button></div></div>`;
    }).join('') : '<div class="empty">Tap a product to start a sale</div>';
    $('lines').querySelectorAll('.qty button').forEach(b => b.onclick = () => add(b.dataset.id, parseInt(b.dataset.d, 10)));
    const t = quote;
    $('totals').innerHTML = t ? `<div class="row"><span>Subtotal</span><span>${rm(t.subtotal_sen)}</span></div>
        ${t.discount_sen ? `<div class="row"><span>Discount</span><span>-${rm(t.discount_sen)}</span></div>` : ''}
        <div class="row"><span>SST</span><span>${rm(t.tax_sen)}</span></div>
        ${t.rounding_sen ? `<div class="row"><span>Rounding</span><span>${rm(t.rounding_sen)}</span></div>` : ''}
        <div class="row big"><span>Total</span><span>${rm(t.total_sen)}</span></div>` : '<div class="row big"><span>Total</span><span>RM 0.00</span></div>';
    $('chargeBtn').disabled = !t || !cart.length;
    $('chargeBtn').textContent = t ? 'Charge ' + rm(t.total_sen) : 'Charge';
}
function renderRecent() {
    $('recent').innerHTML = S.recent.length ? '<div style="font-weight:600;color:var(--ink)">Recent sales on this till</div>' +
        S.recent.map(o => `<div><span>${esc(o.receipt_no)} · ${esc(o.tender || '')}</span><span>${rm(o.total_sen)}</span></div>`).join('') : '';
}

// ---- payment
$('chargeBtn').onclick = () => { orderId = uuid(); tender = 'cash'; openPay(); };
async function openPay() {
    document.querySelectorAll('[data-tender]').forEach(b => b.classList.toggle('on', b.dataset.tender === tender));
    $('cashBox').classList.toggle('hidden', tender !== 'cash');
    $('payErr').textContent = '';
    await reprice();   // cash rounds to 5 sen, card doesn't: the total depends on the tender
    if (!quote) return;
    $('payTotal').textContent = rm(quote.total_sen);
    const total = quote.total_sen, notes = [total, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000, 5000, 10000].filter((v, i, a) => v >= total && a.indexOf(v) === i).slice(0, 3);
    $('quick').innerHTML = notes.map(v => `<button class="btn" data-v="${v}">${v === total ? 'Exact' : rm(v)}</button>`).join('');
    $('quick').querySelectorAll('button').forEach(b => b.onclick = () => { $('tendered').value = (parseInt(b.dataset.v, 10) / 100).toFixed(2); updateChange(); });
    $('tendered').value = (total / 100).toFixed(2);
    updateChange();
    $('mPay').classList.remove('hidden');
}
document.querySelectorAll('[data-tender]').forEach(b => b.onclick = () => { tender = b.dataset.tender; openPay(); });
function updateChange() {
    const got = tender === 'cash' ? parseSen($('tendered').value) : quote.total_sen;
    $('payChange').textContent = got === null ? '—' : rm(Math.max(0, got - quote.total_sen));
    $('confirmBtn').disabled = got === null || got < quote.total_sen;
}
$('tendered').oninput = updateChange;
$('cancelPay').onclick = () => { $('mPay').classList.add('hidden'); tender = 'cash'; reprice(); };
$('confirmBtn').onclick = async () => {
    $('confirmBtn').disabled = true; $('payErr').textContent = 'Saving…';
    const r = await post('/till/checkout', { order_id: orderId, lines: cart, tender, tendered_sen: tender === 'cash' ? parseSen($('tendered').value) : null, send_to_kitchen: $('kitchen').checked });
    if (!r.ok) {
        $('payErr').textContent = errText(r.body); $('confirmBtn').disabled = false;
        if (r.body.error === 'staff_signed_out') { S.staff = null; $('mPay').classList.add('hidden'); route(); }
        return;   // same order id on retry: the server won't store it twice
    }
    $('mPay').classList.add('hidden');
    const d = r.body;
    $('doneChange').textContent = rm(d.change_sen);
    $('doneChangeLabel').textContent = d.tender === 'cash' ? 'change to give' : 'paid by card';
    $('doneReceipt').innerHTML = `<div class="row"><b>${esc(d.receipt_no)}</b><span>${new Date().toLocaleTimeString()}</span></div><hr style="border:0;border-top:1px dashed var(--line)">` +
        d.lines.map(l => `<div class="row"><span>${qtyLabel(l.qty_milli)} × ${esc(l.name)}</span><span>${rm(l.net_sen)}</span></div>`).join('') +
        `<hr style="border:0;border-top:1px dashed var(--line)"><div class="row"><span>SST</span><span>${rm(d.tax_sen)}</span></div>` +
        (d.rounding_sen ? `<div class="row"><span>Rounding</span><span>${rm(d.rounding_sen)}</span></div>` : '') +
        `<div class="row"><b>Total</b><b>${rm(d.total_sen)}</b></div><div class="row"><span>${esc(d.tender)}</span><span>${rm(d.tendered_sen)}</span></div>`;
    $('doneFlags').innerHTML = d.flags.length ? 'Flagged for review: ' + d.flags.map(f => `<span class="pill">${esc(f.replaceAll('_', ' '))}</span>`).join('') : '';
    S.recent = d.recent; cart = []; quote = null; tender = 'cash';
    $('mDone').classList.remove('hidden');
};
$('newSale').onclick = () => { $('mDone').classList.add('hidden'); renderCart(); renderRecent(); };

route();
</script>
</body>
</html>
