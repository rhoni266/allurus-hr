// Receipt scanner: photograph or upload a receipt, read it on the device with Tesseract (Apache-2.0),
// pull out the shop, date, items, SST and total, then let the user choose a category for every item.
// Used by Finance (company expenses) and by employees (personal tax reliefs).
window.AllurusReceipt = (function () {
  'use strict';
  const BASE = 'js/vendor/ocr/';
  const abs = (p) => new URL(BASE + p, location.href).href;
  const r2 = (n) => Math.round(n * 100) / 100;
  let workerP = null, progressCb = null;

  // ---------- Reading ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('The receipt reader could not load.'));
      document.head.appendChild(s);
    });
  }
  function worker() {
    if (workerP) return workerP;
    workerP = (async () => {
      await loadScript(abs('tesseract.min.js?v=5.1.1'));
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: abs('worker.min.js'), corePath: abs(''), langPath: abs(''), gzip: true,
        logger: (m) => { if (progressCb && m.status) progressCb(m.status, m.progress || 0); },
      });
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
    return workerP;
  }
  // Clean up a phone photo for reading: enlarge, convert to grey, straighten the tilt,
  // then turn it black and white against the local brightness so shadows and uneven light drop out.
  function prepare(src) {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    const k = Math.min(2.5, 1600 / w);
    const W = Math.round(w * k), H = Math.round(h * k);
    const grey = (canvas) => {
      const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      const g = new Float32Array(canvas.width * canvas.height);
      for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
      return g;
    };
    const draw = (angle) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      if (angle) { ctx.translate(W / 2, H / 2); ctx.rotate(angle); ctx.translate(-W / 2, -H / 2); }
      ctx.drawImage(src, 0, 0, W, H);
      return c;
    };
    const angle = skew(draw(0), grey);
    const c = angle ? draw(-angle) : draw(0);
    const g = grey(c), ctx = c.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    // Integral image, so each pixel can be compared with the mean of its neighbourhood quickly.
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 1; y <= H; y++) { let row = 0; for (let x = 1; x <= W; x++) { row += g[(y - 1) * W + x - 1]; I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + row; } }
    const r = Math.max(8, Math.round(W / 50));
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
        const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
        const v = g[y * W + x] < (sum / ((x1 - x0) * (y1 - y0))) * 0.88 ? 0 : 255;
        const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // Estimate the tilt: the angle at which dark pixels line up into the sharpest rows of text.
  function skew(canvas, grey) {
    const s = document.createElement('canvas'), sw = 500, sh = Math.round((canvas.height * sw) / canvas.width);
    s.width = sw; s.height = sh; s.getContext('2d').drawImage(canvas, 0, 0, sw, sh);
    const g = grey(s);
    let mean = 0; for (const v of g) mean += v; mean /= g.length;
    const pts = [];
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (g[y * sw + x] < mean * 0.7) pts.push(x, y);
    if (pts.length < 200) return 0;
    let best = 0, bestScore = -1;
    for (let deg = -6; deg <= 6; deg += 0.25) {
      const t = Math.tan((deg * Math.PI) / 180), rows = new Float64Array(sh * 2 + 10);
      for (let i = 0; i < pts.length; i += 2) { const yy = Math.round(pts[i + 1] - (pts[i] - sw / 2) * t) + sh / 2; if (yy >= 0 && yy < rows.length) rows[yy]++; }
      let score = 0; for (const v of rows) score += v * v;
      if (score > bestScore) { bestScore = score; best = deg; }
    }
    return Math.abs(best) < 0.3 ? 0 : (best * Math.PI) / 180;
  }
  async function read(src, onProgress) {
    progressCb = onProgress;
    const w = await worker();
    const { data } = await w.recognize(prepare(src));
    progressCb = null;
    return data.text || '';
  }
  // A smaller copy kept as evidence with the entry (about 60 to 120 KB).
  function evidence(src) {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    const k = Math.min(1, 900 / w), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  }

  // ---------- Understanding the text ----------
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogo: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };
  const AMOUNT = /(-?\d{1,3}(?:,\d{3})*|-?\d+)[.,](\d{2})(?!\d)/g;
  const SKIP = /\b(sub\s*-?\s*total|jumlah\s*kecil|total|jumlah|grand|sst|service\s*(tax|charge)|cukai|gst|tax|rounding|pembundaran|cash|tunai|change|baki|tender|tendered|balance|card|visa|master|debit|credit|e-?wallet|tng|grabpay|boost|payment|paid|amount\s*due|discount|diskaun|qty|quantity|item\s*count|points?|member)\b/i;
  const HEAD = /\b(tax\s*invoice|invoice|receipt|resit|welcome|thank|terima\s*kasih|tel|phone|fax|gst\s*id|sst\s*id|reg|co\.?\s*no|no\.?\s*syarikat|cashier|counter|table|pax)\b/i;
  const toNum = (s) => Number(String(s).replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  function amounts(line) { return [...line.matchAll(AMOUNT)].map((m) => toNum(`${m[1]}.${m[2]}`)); }

  function parseDate(text) {
    let m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
    m = text.match(/\b(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})\b/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = text.match(/\b(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*,?\s*(20\d{2})\b/);
    if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    return '';
  }
  const iso = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');

  // Drop reading noise at the ends of an item name: stray symbols, lone digits and one-letter scraps.
  const tidy = (desc) => desc.split(' ').filter(Boolean)
    .reduce((acc, w, i, all) => { const edge = i === 0 || i === all.length - 1; return edge && (/^[^A-Za-z0-9(]{1,3}$/.test(w) || /^\d$/.test(w) || /^[A-Za-z]$/.test(w) && all.length > 2) ? acc : [...acc, w]; }, [])
    .join(' ').replace(/^[^A-Za-z0-9(]+|[^A-Za-z0-9)%]+$/g, '').trim();

  // Fix common reading slips in prices: "189. 0p" becomes "189.00", "1O.5O" becomes "10.50".
  const fixPrices = (line) => line
    .replace(/(\d)\s*([.,])\s+(\d)/g, '$1$2$3')
    .replace(/(\d[.,]\d{2,3})((?:\s+[^\s\d]{1,3})+)\s*$/, '$1')
    .replace(/(\d[\dOoDQlI|SB]{0,6}[.,][\dOoDQlI|SBp]{2})(\s*[A-Z*]?)\s*$/, (m, num, tail) => num.replace(/[OoDQp]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8') + tail);

  function parse(text) {
    const lines = text.split('\n').map((l) => fixPrices(l.replace(/\s+/g, ' ').trim())).filter(Boolean);
    const out = { merchant: '', date: parseDate(text), ref: '', items: [], subtotal: null, tax: null, total: null };
    const ref = text.match(/\b(?:receipt|resit|invoice|inv|bill|rcpt|doc)[ \t]*(?:no\.?|number|#)[ \t]*[:#]?[ \t]*([A-Z0-9][A-Z0-9/-]{3,})/i);
    if (ref) out.ref = ref[1];
    out.merchant = (lines.find((l) => /[A-Za-z]{3,}/.test(l) && !HEAD.test(l) && !amounts(l).length && !/\d{5,}/.test(l)) || '').replace(/[^\w&().,' -]/g, '').trim();
    let pending = '';
    for (const line of lines) {
      const alnum = (line.match(/[A-Za-z0-9]/g) || []).length;
      if (alnum < line.replace(/\s/g, '').length * 0.5) continue;
      const nums = amounts(line);
      const letters = (line.match(/[A-Za-z]/g) || []).length;
      if (SKIP.test(line)) {
        if (!nums.length) continue;
        const last = nums[nums.length - 1];
        if (/sub\s*-?\s*total|jumlah\s*kecil/i.test(line)) out.subtotal = last;
        else if (/\b(sst|service\s*tax|cukai|gst|sales\s*tax|tax)\b/i.test(line) && !/total|invoice/i.test(line)) out.tax = last;
        else if (/\b(grand\s*total|total|jumlah|amount\s*due)\b/i.test(line) && !/item|qty/i.test(line)) out.total = Math.max(out.total || 0, last);
        pending = '';
        continue;
      }
      if (HEAD.test(line) && !nums.length) continue;
      // A price read with three decimals ("189.600") is kept but marked for checking, not dropped.
      const odd = !nums.length && line.match(/(\d{1,6})[.,](\d{2})\d\s*$/);
      if (odd && letters >= 3) nums.push(toNum(`${odd[1]}.${odd[2]}`));
      if (!nums.length) { if (letters >= 3 && line !== out.merchant) pending = line; continue; }
      const amount = nums[nums.length - 1];
      let desc = line.replace(/(\d{1,6})[.,](\d{2})\d\s*$/, ' ').replace(/\b\d+[.,]\d{3}\b/g, ' ').replace(AMOUNT, ' ').replace(/\bRM\b/gi, ' ').replace(/\b\d+\s*[x@]\s*/gi, ' ').replace(/\s[x@]\s*\d*\s*$/i, ' ').replace(/[*#|]+/g, ' ').replace(/\s+/g, ' ').trim();
      if ((desc.match(/[A-Za-z]/g) || []).length < 3) { if (!pending) continue; desc = pending; }
      else if (pending && desc.length < 6) desc = `${pending} ${desc}`;
      pending = '';
      if (amount <= 0 || amount > 100000) continue;
      if (parseDate(desc) && desc.length < 14) continue;
      out.items.push({ desc: tidy(desc), amount: r2(amount), ...(odd ? { check: true } : {}) });
    }
    if (!out.total && out.items.length) out.total = r2(out.items.reduce((s, i) => s + i.amount, 0) + (out.tax || 0));
    return out;
  }

  // ---------- Choosing a category for each item ----------
  // Everyday words seen on receipts, used on top of the LHDN keyword rules in tax.js.
  const OFFICE = ['paper', 'a4', 'pen', 'pens', 'stapler', 'staples', 'ink', 'toner', 'printer', 'mouse', 'keyboard', 'cable', 'hdmi', 'usb', 'folder', 'file', 'envelope', 'notebook', 'marker', 'tape', 'calculator', 'battery', 'batteries'];
  const GROCERY = ['rice', 'beras', 'milk', 'susu', 'egg', 'eggs', 'telur', 'bread', 'roti', 'sugar', 'gula', 'cooking oil', 'minyak masak', 'maggi', 'noodle', 'noodles', 'mee', 'chicken', 'ayam', 'fish', 'ikan', 'vegetable', 'sayur', 'fruit', 'buah', 'shampoo', 'soap', 'sabun', 'detergent', 'tissue', 'biscuit', 'snack', 'drinks', 'coffee', 'kopi', 'teh', 'mineral water', 'diapers', 'lampin'];
  const SPORTS = ['badminton', 'racket', 'racquet', 'shuttlecock', 'jersey', 'football', 'futsal', 'basketball', 'yoga mat', 'dumbbell', 'running shoes', 'sports shoes', 'swimming', 'goggles', 'bicycle', 'helmet'];
  const READING = ['novel', 'magazine', 'ebook', 'e-book', 'dictionary', 'textbook'];
  const has = (text, words) => words.find((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text));

  // For company expenses: returns { cat, include, why }.
  function businessCategory(desc, merchant) {
    const TX = window.AllurusTax, text = `${desc}`;
    const p = TX.looksPersonal(text) || has(text, GROCERY);
    if (p) return { cat: 'Other expenses', include: false, personal: true, why: `Looks personal (“${p}”). Left out unless you tick it.` };
    const rule = bestRule(text, TX.BUSINESS) || bestRule(merchant, TX.BUSINESS);
    if (rule) return { cat: rule.cat, include: true, why: `${rule.name}. ${rule.deductibility}.` };
    const o = has(text, OFFICE);
    if (o) return { cat: 'Office supplies', include: true, why: `Office item (“${o}”). Not in your LHDN rules; confirm with your tax agent.` };
    return { cat: 'Other expenses', include: true, why: 'No match. Choose a category.' };
  }
  // For personal reliefs: returns { cat, include, why } where cat '' means not a relief.
  function reliefCategory(desc) {
    const TX = window.AllurusTax, text = `${desc}`;
    const p = TX.looksPersonal(text) || has(text, GROCERY);
    if (p) return { cat: '', include: false, why: `Everyday spending (“${p}”) is not a relief.` };
    const rel = bestRule(text, TX.RELIEFS);
    if (rel) return { cat: rel.id, include: true, why: `${rel.name}, cap RM${rel.cap.toLocaleString()}.` };
    const s = has(text, SPORTS);
    if (s) return { cat: 'REL_SPORTS', include: true, why: `Sports equipment (“${s}”).` };
    const b = has(text, READING);
    if (b) return { cat: 'REL_LIFESTYLE', include: true, why: `Reading material (“${b}”).` };
    return { cat: '', include: false, why: 'Not matched to a relief. Choose one if it qualifies.' };
  }
  function bestRule(text, list) {
    let top = null, len = 0;
    list.forEach((r) => r.keywords.forEach((k) => { if (k.length > len && has(text, [k])) { top = r; len = k.length; } }));
    return top;
  }

  // ---------- The scanner window ----------
  let stream = null;
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };

  // opts: { mode: 'business'|'relief', title, categories: [[value, label]], money(n), onSave({ merchant, date, ref, rows, img, text, tax, total }) }
  function open(ctx, opts) {
    const { esc, icon, openModal, toast } = ctx;
    const st = { img: null, text: '', parsed: null, rows: [] };
    openModal({ title: opts.title || 'Scan a receipt', size: 'lg', submit: null, body: '<div id="rc-body"></div>' });
    ctx.$('#overlay-root .modal-foot').hidden = true;
    const body = () => ctx.$('#rc-body');
    const step = (html) => { const b = body(); if (b) b.innerHTML = html; return !!b; };

    function start() {
      stop();
      step(`<div class="rc-start">
        <div class="rc-cam"><video id="rc-video" playsinline autoplay muted></video><div class="rc-frame" aria-hidden="true"></div></div>
        <p class="muted" id="rc-hint">Lay the receipt flat in good light and fill the frame with it.</p>
        <div class="ci-actions"><label class="btn" for="rc-file">${icon('download')}Upload a photo</label><button class="btn btn-primary" data-rc="snap" id="rc-snap" disabled>${icon('camera')}Take photo</button></div>
        <input type="file" id="rc-file" accept="image/*" hidden></div>`);
      ctx.$('#rc-file').addEventListener('change', (ev) => {
        const f = ev.target.files?.[0]; if (!f) return;
        const img = new Image();
        img.onload = () => { stop(); readImage(img); URL.revokeObjectURL(img.src); };
        img.onerror = () => toast('That file isn’t a photo. Try a JPG or PNG.', 'error');
        img.src = URL.createObjectURL(f);
      });
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        .then(async (s) => { stream = s; const v = ctx.$('#rc-video'); if (!v) return stop(); v.srcObject = s; await v.play(); ctx.$('#rc-snap').disabled = false; })
        .catch(() => { const c = ctx.$('.rc-cam'); if (c) c.innerHTML = `<div class="ci-cam-empty">${icon('camera')}<span>The camera isn’t available here. Upload a photo of the receipt instead.</span></div>`; });
    }
    async function readImage(src) {
      st.img = evidence(src);
      step(`<div class="rc-reading"><img src="${st.img}" alt="Receipt photo"><div><strong id="rc-status">Getting the receipt reader ready</strong>
        <div class="progress" style="margin:10px 0"><i id="rc-bar" style="width:4%"></i></div><p class="muted">The first scan on a device downloads the reader, about 7 MB. After that it is quick.</p></div></div>`);
      try {
        st.text = await read(src, (status, p) => {
          const s = ctx.$('#rc-status'), b = ctx.$('#rc-bar'); if (!s) return;
          s.textContent = status.includes('recogniz') ? 'Reading the receipt' : 'Getting the receipt reader ready';
          b.style.width = `${Math.max(4, Math.round((status.includes('recogniz') ? 0.4 + p * 0.6 : p * 0.4) * 100))}%`;
        });
      } catch (e) {
        step(`<div class="ci-problem">${icon('pin')}<div><strong>The receipt couldn’t be read</strong><p class="muted">${esc(e.message || 'Something went wrong.')} You can try again, or enter it by hand.</p></div></div><div class="ci-actions"><button class="btn" data-act="close-overlay">Close</button><button class="btn btn-primary" data-rc="again">Try again</button></div>`);
        return;
      }
      st.parsed = parse(st.text);
      st.rows = st.parsed.items.map((it) => {
        const c = opts.mode === 'business' ? businessCategory(it.desc, st.parsed.merchant) : reliefCategory(it.desc);
        return { ...it, ...c, why: it.check ? `Check this price against the photo. ${c.why}` : c.why };
      });
      if (!st.rows.length) st.rows.push({ desc: st.parsed.merchant || 'Receipt', amount: st.parsed.total || 0, ...(opts.mode === 'business' ? businessCategory(st.parsed.merchant || '', '') : reliefCategory(st.parsed.merchant || '')), why: 'No items found. Enter the amount and choose a category.' });
      review();
    }
    function review() {
      const p = st.parsed, T = U.today();
      const opt = (sel) => opts.categories.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
      step(`<div class="rc-review">
        <div class="rc-side"><img src="${st.img}" alt="Receipt photo" class="rc-photo"><details><summary>Text read from the receipt</summary><pre>${esc(st.text.trim() || '(nothing)')}</pre></details></div>
        <div class="rc-main">
          <div class="form-grid">
            <div class="field"><label for="rc-merchant">Shop</label><input class="input" id="rc-merchant" value="${esc(p.merchant)}"></div>
            <div class="field"><label for="rc-date">Date</label><input class="input" id="rc-date" type="date" value="${esc(p.date && p.date <= T ? p.date : T)}" max="${T}"></div>
            <div class="field"><label for="rc-ref">Receipt number</label><input class="input" id="rc-ref" value="${esc(p.ref)}"></div>
            <div class="field"><label for="rc-bulk">Set all ticked items to</label><select class="select" id="rc-bulk"><option value="">Choose…</option>${opt(null)}</select></div>
          </div>
          <div class="rc-items" role="list">${st.rows.map((r, i) => `<div class="rc-item ${r.include ? '' : 'off'}" role="listitem">
            <input type="checkbox" data-i="${i}" data-f="include" ${r.include ? 'checked' : ''} aria-label="Include ${esc(r.desc)}">
            <input class="input" data-i="${i}" data-f="desc" value="${esc(r.desc)}" aria-label="Item ${i + 1}">
            <input class="input num" data-i="${i}" data-f="amount" type="number" step="0.01" min="0" value="${(Number(r.amount) || 0).toFixed(2)}" aria-label="Amount for item ${i + 1}">
            <select class="select" data-i="${i}" data-f="cat" aria-label="Category for item ${i + 1}">${opt(r.cat)}</select>
            <p class="rc-why">${esc(r.why)}</p></div>`).join('')}</div>
          <button class="btn btn-sm btn-ghost" data-rc="add">${icon('plus')}Add an item</button>
          <div class="rc-totals" id="rc-totals"></div>
          <p class="disclaimer">${icon('pin')}<span>${esc(window.AllurusTax.DISCLAIMER)} Check each item against the photo before saving.</span></p>
          <div class="ci-actions" style="justify-content:flex-end"><button class="btn" data-rc="again">Scan again</button><button class="btn btn-primary" data-rc="save" id="rc-save"></button></div>
        </div></div>`);
      totals();
    }
    function totals() {
      const p = st.parsed, on = st.rows.filter((r) => r.include && r.amount > 0);
      const items = r2(st.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
      const chosen = r2(on.reduce((s, r) => s + Number(r.amount), 0));
      const groups = new Set(on.map((r) => r.cat).filter((c) => opts.mode === 'business' || c));
      const expect = p.subtotal ?? (p.total != null && p.tax != null ? r2(p.total - p.tax) : p.total);
      const off = expect != null && Math.abs(expect - items) > 0.05;
      const el = ctx.$('#rc-totals'); if (!el) return;
      el.innerHTML = `<div><span>Ticked items</span><strong class="num">${opts.money(chosen)}</strong></div>
        ${p.tax != null ? `<div><span>SST on the receipt</span><span class="num">${opts.money(p.tax)}</span></div>` : ''}
        ${p.total != null ? `<div><span>Receipt total</span><span class="num">${opts.money(p.total)}</span></div>` : ''}
        ${off ? `<p class="rc-warn">The items add up to ${opts.money(items)}, but the receipt shows ${opts.money(expect)} before tax. Check the amounts against the photo.</p>` : ''}`;
      const btn = ctx.$('#rc-save');
      const n = opts.mode === 'business' ? groups.size : [...groups].filter(Boolean).length;
      btn.disabled = !n;
      btn.innerHTML = `${icon('check')}${n ? (opts.mode === 'business' ? `Add ${n} ${n === 1 ? 'entry' : 'entries'} to the books` : `Save ${n} relief ${n === 1 ? 'receipt' : 'receipts'}`) : 'Tick at least one item'}`;
    }
    function save() {
      const merchant = ctx.$('#rc-merchant').value.trim() || 'Receipt', date = ctx.$('#rc-date').value || U.today(), ref = ctx.$('#rc-ref').value.trim();
      const rows = st.rows.filter((r) => r.include && Number(r.amount) > 0 && (opts.mode === 'business' || r.cat)).map((r) => ({ ...r, amount: r2(Number(r.amount)) }));
      if (!rows.length) { toast('Tick at least one item with a category', 'error'); return; }
      const allItems = r2(st.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
      if (opts.onSave({ merchant, date, ref, rows, img: st.img, text: st.text, tax: st.parsed.tax, total: st.parsed.total, allItems }) !== false) { stop(); ctx.closeOverlay(); }
    }

    const root = ctx.$('#overlay-root');
    const onClick = (ev) => {
      const b = ev.target.closest('[data-rc]'); if (!b) return;
      ev.preventDefault();
      const a = b.dataset.rc;
      if (a === 'snap') { const v = ctx.$('#rc-video'); if (!v?.videoWidth) return; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); stop(); readImage(c); }
      if (a === 'again') start();
      if (a === 'add') { st.rows.push({ desc: '', amount: 0, include: true, cat: opts.mode === 'business' ? 'Other expenses' : '', why: 'Added by hand.' }); review(); }
      if (a === 'save') save();
    };
    const onInput = (ev) => {
      const el = ev.target; if (!el.dataset || el.dataset.i == null) return;
      const r = st.rows[+el.dataset.i], f = el.dataset.f;
      if (f === 'include') { r.include = el.checked; el.closest('.rc-item').classList.toggle('off', !el.checked); }
      else if (f === 'amount') r.amount = Number(el.value) || 0;
      else if (f === 'desc') r.desc = el.value;
      else if (f === 'cat') { r.cat = el.value; if (opts.mode === 'relief' && el.value && !r.include) { r.include = true; review(); return; } }
      totals();
    };
    const onChange = (ev) => {
      if (ev.target.id !== 'rc-bulk' || !ev.target.value) return;
      st.rows.forEach((r) => { if (r.include) r.cat = ev.target.value; });
      review();
    };
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    // When the window closes: stop the camera and remove these listeners.
    const obs = new MutationObserver(() => {
      if (ctx.$('#rc-body')) return;
      stop(); obs.disconnect();
      root.removeEventListener('click', onClick); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange);
    });
    obs.observe(root, { childList: true });
    start();
  }

  return { read, parse, businessCategory, reliefCategory, open, warm: () => worker().catch(() => {}) };
})();
