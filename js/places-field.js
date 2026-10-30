// The Head office field: type a place and pick a suggestion (city or town, district, state, country), or keep
// what you typed. Used in Settings, allurus.my/signup and /superadmin. Search rules: js/places-rules.js.
//   AllurusPlaceField.mount(host, { id, value, onChange, placeholder })
// `value` may be the saved structure or an older plain name ("Kuala Lumpur"). onChange gets the new structure.
window.AllurusPlaceField = (function () {
  'use strict';
  const P = window.AllurusPlaces;
  const DATA_URL = '/js/vendor/places-my.json?v=1';
  let idxReady = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GROUP = { city: 'City / town', district: 'District', state: 'State', country: 'Country' };
  // The place list loads the first time the field is used (about 60 KB), then the browser keeps it.
  function loadIndex() {
    return (idxReady = idxReady || fetch(DATA_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((data) => ({ idx: P.index(data, window.U?.CITIES || []), offline: !data })));
  }
  function style() {
    if (document.getElementById('pf-style')) return;
    const s = document.createElement('style'); s.id = 'pf-style';
    s.textContent = `.pf{position:relative;width:min(340px,100%)}.pf input{width:100%;padding-right:38px}
      .pf-x{position:absolute;right:4px;top:50%;transform:translateY(-50%);border:0;background:none;width:32px;height:32px;border-radius:8px;cursor:pointer;color:var(--fg-3,#888);font-size:18px;line-height:1}
      .pf-x:hover{background:var(--line,#eee)}.pf-list{position:absolute;z-index:60;left:0;right:0;top:calc(100% + 4px);max-height:min(360px,60vh);overflow:auto;margin:0;padding:6px;list-style:none;
      background:var(--surface,#fff);border-radius:14px;box-shadow:var(--shadow-lg,0 10px 30px rgba(0,0,0,.18));text-align:left}
      .pf-g{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--fg-3,#888);padding:8px 10px 4px}
      .pf-o{padding:10px;border-radius:10px;cursor:pointer;min-height:44px;display:flex;flex-direction:column;justify-content:center;font-size:14px}
      .pf-o small{color:var(--fg-3,#888);font-size:12px}.pf-o[aria-selected=true],.pf-o:hover{background:var(--brand-soft,#e6f4f2)}.pf-note{padding:8px 10px;font-size:12.5px;color:var(--fg-3,#888)}`;
    document.head.appendChild(s);
  }

  function mount(host, { id = 'pf-' + Math.random().toString(36).slice(2, 8), value = null, onChange = () => {}, placeholder = 'Type a city, district, state or country' } = {}) {
    style();
    const list = `${id}-list`;
    host.innerHTML = `<div class="pf"><input class="input" id="${id}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${list}" autocomplete="off" spellcheck="false" maxlength="${P.MAX}" placeholder="${esc(placeholder)}">
      <button type="button" class="pf-x" aria-label="Clear" hidden>×</button><ul class="pf-list" id="${list}" role="listbox" aria-label="Suggestions" hidden></ul></div>`;
    const input = host.querySelector('input'), ul = host.querySelector('ul'), x = host.querySelector('.pf-x');
    let current = null, options = [], active = -1, timer = null;
    const show = (v) => { input.value = v ? v.label : ''; x.hidden = !input.value; };
    // An older plain name becomes the structure once the list has loaded.
    if (value && typeof value === 'object' && value.level) { current = value; show(current); }
    else if (value) { input.value = String(value); x.hidden = false; loadIndex().then(({ idx }) => { current = P.fromLegacy(value, idx); show(current); }); }
    const close = () => { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const choose = (v) => { if (!v) return; current = { ...v, updatedAt: Date.now() }; show(current); close(); onChange(current); };
    function highlight(i) {
      active = Math.max(-1, Math.min(options.length - 1, i));
      ul.querySelectorAll('[role=option]').forEach((o, k) => o.setAttribute('aria-selected', String(k === active)));
      if (active >= 0) { const el = document.getElementById(`${list}-${active}`); input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
    }
    async function suggest() {
      const text = input.value.trim();
      x.hidden = !input.value;
      if (text.length < 2) { close(); return; }
      const { idx, offline } = await loadIndex();
      if (input.value.trim() !== text) return;                 // typed on meanwhile
      const groups = P.search(idx, text);
      options = []; let html = '';
      for (const g of groups) {
        html += `<li class="pf-g" role="presentation">${GROUP[g.level]}</li>`;
        for (const v of g.items) { html += `<li class="pf-o" role="option" id="${list}-${options.length}" data-i="${options.length}" aria-selected="false">${esc(v.label)}</li>`; options.push(v); }
      }
      const typed = P.manual(text);
      if (typed) { html += `<li class="pf-o" role="option" id="${list}-${options.length}" data-i="${options.length}" aria-selected="false">Use “${esc(typed.label)}”<small>Saved as you typed it</small></li>`; options.push(typed); }
      html += offline ? '<li class="pf-note" role="presentation">Suggestions aren’t available right now; you can still use what you typed.</li>'
        : '<li class="pf-note" role="presentation">Places: <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)</li>';
      ul.innerHTML = html; ul.hidden = false; input.setAttribute('aria-expanded', 'true'); highlight(-1);
    }
    input.addEventListener('focus', () => loadIndex());
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(suggest, 250); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); if (ul.hidden) suggest(); else highlight(active + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); highlight(active - 1); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (!ul.hidden && active >= 0) choose(options[active]);
        else if (input.value.trim() && input.value.trim() !== current?.label) choose(P.manual(input.value));   // Enter keeps what was typed
      } else if (ev.key === 'Escape') { if (!ul.hidden) { ev.stopPropagation(); close(); } }
    });
    // Leaving the field without choosing puts the saved value back.
    input.addEventListener('blur', () => setTimeout(() => { if (!host.contains(document.activeElement)) { close(); show(current); } }, 150));
    ul.addEventListener('mousedown', (ev) => ev.preventDefault());
    ul.addEventListener('click', (ev) => { const o = ev.target.closest('[data-i]'); if (o) choose(options[+o.dataset.i]); });
    x.addEventListener('click', () => { input.value = ''; x.hidden = true; close(); input.focus(); });
    return { get value() { return current; }, set(v) { current = v; show(v); }, input };
  }
  return { mount, loadIndex };
})();
