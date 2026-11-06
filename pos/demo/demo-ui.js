// Cafe POS demo: the bits that are only true in demo mode. Runs after demo/local-host.js and demo/seed.js, before
// api-demo.js and app.js (see index.html). Safe to load in the real till too: everything here is gated on
// window.POS_DEMO_MODE, set by index.html's bootstrap script.
(function () {
  'use strict';
  if (!window.POS_DEMO_MODE) return;

  // app.js reads window.POS_CONFIG once, at the top of its own script, so this has to run before app.js loads
  // (it does: see index.html). No config.js is ever requested in demo mode, so this is POS_CONFIG's only source.
  window.POS_CONFIG = {
    BUSINESS_NAME: 'Kopi Demo', RECEIPT_FOOTER: 'Thank you! See you again.',
    SST_PERCENT: 0, SERVICE_PERCENT: 10, LOW_STOCK: 5, DEVICE_ID: 'demo-till',
    CURRENCY: 'RM', TIMEZONE: 'Asia/Kuala_Lumpur', TIMEOUT_MS: 20000
  };

  // A name on the staff chip without asking the visitor to type one; same mechanism the real till already uses
  // (localStorage 'pos.staff'), so it's just a normal value app.js would have set from the "Your name" field.
  try { if (!localStorage.getItem('pos.staff')) localStorage.setItem('pos.staff', 'Mia (demo cashier)'); } catch (e) { /* private window: fine, "No name" shows instead */ }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mount() {
    var bar = document.createElement('div');
    bar.className = 'demo-banner no-print';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span>' + esc('Demo: everything stays in this browser. Nothing is real.') + '</span>' +
      '<span class="demo-banner-actions">' +
        '<button type="button" id="demoReset" class="ghost">Reset demo</button>' +
        '<button type="button" id="demoGetAllurus" class="primary">Get Allurus</button>' +
      '</span>';
    document.body.insertBefore(bar, document.body.firstChild);

    document.getElementById('demoReset').addEventListener('click', function () {
      if (!window.confirm('Reset the demo? Everything you tried (sales, waste, stock changes) goes back to the sample cafe.')) return;
      window.PosDemoStore.reset();
      location.reload();
    });
    document.getElementById('demoGetAllurus').addEventListener('click', function () {
      location.href = 'https://allurus.my/#contact';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
