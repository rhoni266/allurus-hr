// Admin console on a phone (<= 480px). The page must never scroll sideways, so what is wide is reshaped after each render:
//  - a table becomes a list of cards (the 2-3 main fields, the rest behind "More"); a very wide report (more than 8 columns, or marked
//    data-wide) keeps its table inside its own scroll box with the first column pinned
//  - a page's buttons become one main button and a "..." menu
//  - a toolbar's filters (selects and segmented buttons) collapse into one "Filters" ("Tapis") button that opens a sheet
// The pure parts (which pages go in the bottom bar, which tables are cards) are unit tested in tests/mobile-admin.test.js; the rest is
// checked in a browser by tests-e2e/admin-mobile.e2e.js. Nothing here changes what a control does: elements are moved, never copied.
window.AllurusMobile = (function () {
  'use strict';
  const QUERY = '(max-width: 480px)';
  const isPhone = () => !!(window.matchMedia && window.matchMedia(QUERY).matches);
  let lang = 'en';
  const setLang = (l) => { lang = l === 'bm' ? 'bm' : 'en'; };
  const T = {
    en: { more: 'More', less: 'Less', actions: 'More actions', filters: 'Filters', done: 'Done', close: 'Close' },
    bm: { more: 'Lagi', less: 'Kurang', actions: 'Tindakan lain', filters: 'Tapis', done: 'Selesai', close: 'Tutup' },
  };
  const t = () => T[lang];

  // ---------- Pure rules ----------
  // The 4 pages most used by what the person can open: people and pay, money, or stock. Fills from the page order when short.
  const PRIORITY = {
    people: ['dashboard', 'employees', 'attendance', 'payroll', 'leave', 'claims', 'approvals'],
    money: ['dashboard', 'invoices', 'bills', 'claims', 'books', 'reports', 'approvals'],
    stock: ['dashboard', 'inventory', 'ops-today', 'approvals'],
  };
  const LABELS = { dashboard: 'Today', employees: 'People', attendance: 'Attendance', payroll: 'Payroll', leave: 'Leave', claims: 'Claims', invoices: 'Invoices', bills: 'Bills', books: 'Books', reports: 'Reports', approvals: 'Approvals', inventory: 'Stock', 'ops-today': 'Operations' };
  function pickTabs(routeIds, n = 4) {
    const ids = routeIds || [];
    const list = ids.includes('employees') ? PRIORITY.people : ids.includes('invoices') ? PRIORITY.money : ids.includes('inventory') ? PRIORITY.stock : [];
    const out = list.filter((id) => ids.includes(id));
    ids.forEach((id) => { if (out.length < n && !out.includes(id)) out.push(id); });
    return out.slice(0, n);
  }
  const tabLabel = (id, fallback = '') => LABELS[id] || fallback;
  // Cards for tables up to this many columns; wider ones are reports and keep their table.
  const MAX_CARD_COLS = 8;
  const cardOrScroll = ({ cols, wide = false, empty = false }) => (empty || !cols ? 'skip' : wide || cols > MAX_CARD_COLS ? 'scroll' : 'cards');

  // ---------- Tables ----------
  const hasText = (td) => !!td.textContent.trim();
  const onlyCheckbox = (td) => !hasText(td) && !!td.querySelector('input[type="checkbox"]');
  function enhanceTable(tb) {
    const heads = [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const rows = [...tb.querySelectorAll('tbody tr')];
    const empty = !rows.length || rows.every((r) => r.children.length === 1 && +r.children[0].getAttribute('colspan') > 1);
    const mode = cardOrScroll({ cols: heads.length, wide: tb.hasAttribute('data-wide') || tb.matches('.lg-grid, .ro-table, .pdoc-kv, .policy'), empty });
    if (mode === 'skip') return;
    if (mode === 'scroll') {
      tb.classList.add('m-scroll');
      const p = tb.parentElement;
      if (!p.classList.contains('table-wrap') && !p.classList.contains('m-scrollbox')) { const box = document.createElement('div'); box.className = 'm-scrollbox'; p.insertBefore(box, tb); box.appendChild(tb); }
      return;
    }
    tb.classList.add('m-cards');
    rows.forEach((tr) => {
      const cells = [...tr.children];
      if (cells.length === 1) { tr.classList.add('m-single'); return; }
      let main = 0, extras = 0;
      cells.forEach((td, i) => {
        td.dataset.label = heads[i] || '';
        if (onlyCheckbox(td)) { td.classList.add('m-sel'); return; }
        if (!heads[i] && td.querySelector('button, a')) { td.classList.add('m-act'); return; }   // row actions stay visible
        if (main < 3 && (hasText(td) || td.querySelector('img, svg, input, select'))) { td.classList.add(`m-main`, `m-main-${main + 1}`); main++; return; }
        td.classList.add('m-extra'); if (hasText(td)) extras++;
      });
      if (extras) {
        tr.classList.add('m-has-more');
        const b = document.createElement('button'); b.type = 'button'; b.className = 'm-toggle'; b.setAttribute('aria-expanded', 'false'); b.textContent = t().more;
        tr.appendChild(b);
      }
    });
  }

  // ---------- Page actions: one main button and a menu ----------
  const DOTS = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  function enhanceActions(a) {
    const items = [...a.children].filter((el) => el.matches('button, a.btn, .btn'));
    if (items.length < 2) return;
    const primary = items.find((i) => i.classList.contains('btn-primary')) || items[0];
    const rest = items.filter((i) => i !== primary);
    const wrap = document.createElement('div'); wrap.className = 'm-more';
    wrap.innerHTML = `<button type="button" class="btn btn-icon m-more-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${t().actions}">${DOTS}</button><div class="m-menu" role="menu" hidden></div>`;
    const menu = wrap.querySelector('.m-menu');
    rest.forEach((r) => { r.setAttribute('role', 'menuitem'); menu.appendChild(r); });
    a.appendChild(wrap);
  }

  // ---------- Filters ----------
  let filtersOpen = false;
  function enhanceToolbar(tb) {
    const ctl = [...tb.children].filter((el) => el.matches('select, .select, .seg'));
    if (!ctl.length || !tb.querySelector(':scope > input[type="search"], :scope > input.input')) return;
    const active = ctl.filter((c) => (c.matches('select, .select') ? c.selectedIndex > 0 : (c.querySelector('button.on') && c.querySelector('button.on') !== c.querySelector('button')))).length;
    tb.classList.add('m-filters');
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn m-filter-btn'; btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span>${t().filters}</span>${active ? `<b class="m-badge">${active}</b>` : ''}`;
    const sheet = document.createElement('div'); sheet.className = 'm-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', t().filters);
    sheet.innerHTML = `<div class="m-sheet-head"><strong>${t().filters}</strong><button type="button" class="btn btn-primary m-filter-done">${t().done}</button></div><div class="m-sheet-body"></div>`;
    const body = sheet.querySelector('.m-sheet-body');
    ctl.forEach((c) => body.appendChild(c));
    tb.appendChild(btn); tb.appendChild(sheet);
    if (filtersOpen) openSheet(tb);
  }

  // The sheet is shown from the page's top level, so no card around the toolbar can shrink it (a card with an effect makes "fixed" relative to itself).
  function openSheet(tb) {
    const sh = tb.querySelector(':scope > .m-sheet'); if (!sh) return;
    sh._home = tb; document.body.appendChild(sh); sh.classList.add('show'); tb.classList.add('open');
  }
  function closeSheet(sh) {
    const tb = sh._home; sh.classList.remove('show');
    if (tb && tb.isConnected) { tb.appendChild(sh); tb.classList.remove('open'); } else sh.remove();
  }
  function dropOrphans() { document.querySelectorAll('body > .m-sheet').forEach((sh) => { if (!sh._home || !sh._home.isConnected) sh.remove(); }); }

  let busy = false;
  function enhance(root) {
    if (busy || !root || !isPhone()) return;
    busy = true;
    try {
      dropOrphans();
      root.querySelectorAll('table:not([data-m])').forEach((tb) => { tb.dataset.m = '1'; enhanceTable(tb); });
      root.querySelectorAll('.page-head > .actions:not([data-m])').forEach((a) => { a.dataset.m = '1'; enhanceActions(a); });
      root.querySelectorAll('.toolbar:not([data-m])').forEach((tb) => { tb.dataset.m = '1'; enhanceToolbar(tb); });
    } finally { busy = false; }
  }

  // ---------- One set of listeners for everything above ----------
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.addEventListener('click', (ev) => {
      const el = ev.target.closest && ev.target.closest('.m-toggle, .m-more-btn, .m-filter-btn, .m-filter-done, .m-menu [role="menuitem"]');
      if (!el) { document.querySelectorAll('.m-more.open').forEach((m) => { m.classList.remove('open'); m.querySelector('.m-more-btn')?.setAttribute('aria-expanded', 'false'); m.querySelector('.m-menu').hidden = true; }); return; }
      if (el.matches('.m-toggle')) {
        const tr = el.closest('tr'), on = tr.classList.toggle('open');
        el.setAttribute('aria-expanded', String(on)); el.textContent = on ? t().less : t().more; ev.stopPropagation(); return;
      }
      if (el.matches('.m-more-btn')) {
        const m = el.closest('.m-more'), on = !m.classList.contains('open');
        document.querySelectorAll('.m-more.open').forEach((x) => { x.classList.remove('open'); x.querySelector('.m-menu').hidden = true; });
        m.classList.toggle('open', on); m.querySelector('.m-menu').hidden = !on; el.setAttribute('aria-expanded', String(on)); ev.stopPropagation(); return;
      }
      if (el.matches('.m-filter-btn')) { filtersOpen = true; openSheet(el.closest('.toolbar')); return; }
      if (el.matches('.m-filter-done')) { filtersOpen = false; closeSheet(el.closest('.m-sheet')); return; }
      // a menu item: its own action runs; the menu closes
      const m = el.closest('.m-more'); if (m) { m.classList.remove('open'); m.querySelector('.m-menu').hidden = true; m.querySelector('.m-more-btn').setAttribute('aria-expanded', 'false'); }
    }, true);
  }
  wire();
  // Parts of a page that redraw by themselves (a filter, a table refresh) and the modals are reshaped too.
  let obs = null;
  function watch() {
    if (obs || !window.MutationObserver) return;
    let queued = false;
    obs = new MutationObserver(() => { if (busy || queued) return; queued = true; requestAnimationFrame(() => { queued = false; enhance(document.getElementById('view')); enhance(document.getElementById('overlay-root')); }); });
    ['view', 'overlay-root'].forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el, { childList: true, subtree: true }); });
  }

  return { isPhone, setLang, watch, pickTabs, tabLabel, cardOrScroll, enhance, MAX_CARD_COLS, PRIORITY };
})();
