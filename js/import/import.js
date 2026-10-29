// Employee import (Employees → Import): upload an Excel or CSV file, the columns are matched to employee fields
// automatically, the admin checks the mapping and a preview, then the rows are added or updated. Nothing leaves the
// browser except the employee records themselves (through the normal sync). Every import is logged and can be
// undone. The rules (detection, cleaning, matching, apply, undo) are in js/import/import-rules.js.
window.AllurusImport = (function () {
  'use strict';
  const R = window.AllurusImportRules;
  const FIELDS = () => window.AllurusImportFieldMap;
  const XLSX_SRC = 'js/vendor/xlsx.full.min.js?v=0.20.3';
  const MAX_BYTES = 5 * 1024 * 1024, MAX_ROWS = 5000, CHUNK = 400, KEEP_LOGS = 10, KEEP_UNDO = 3;
  // Every word the importer shows. Add `ms` beside `en` to translate.
  const STR = { en: {
    title: 'Import employees', pick: 'Choose an Excel or CSV file', pickHint: '.xlsx, .xls or .csv, up to 5 MB and 5,000 rows. The file is read on this device and isn’t uploaded.',
    template: 'Download template', templateHint: 'Optional: any layout works, the columns are recognised automatically.',
    badType: 'That file type isn’t supported. Use .xlsx, .xls or .csv.', macro: 'Files with macros (.xlsm) aren’t accepted. Save it as .xlsx and try again.',
    tooBig: 'That file is over 5 MB.', tooMany: 'That sheet has {n} rows; the most is 5,000. Split it into smaller files.', empty: 'That sheet is empty.',
    unreadable: 'That file couldn’t be read. Open it in Excel, save it again as .xlsx or .csv, and retry.', reading: 'Reading the file…',
    sheet: 'Sheet', headerRow: 'Header row', mapping: 'Columns', samples: 'Sample values', field: 'Goes into', conf: 'Match', ignore: 'Ignore this column',
    high: 'High', medium: 'Medium', low: 'Low', none: 'Unmatched', missing: 'Required for new employees but no column is chosen: {list}.',
    mode: 'If someone is already there', upsert: 'Update existing and add new', add: 'Add new only (skip existing)',
    key: 'Match people by', keyAuto: 'IC, then staff number, then email', keyIc: 'IC only', keyStaff: 'Staff number only', keyEmail: 'Email only',
    salaryNote: 'Salary columns are read as monthly (× 12 is stored as the annual salary) unless the header says annual.',
    save: 'Remember this mapping for files with the same columns', preview: 'Preview (first 20 rows)', ready: 'Ready', warning: 'Warning', error: 'Error',
    summary: '{add} to add, {update} to update, {same} unchanged, {skip} skipped, {error} with errors, {warning} with warnings',
    importBtn: 'Import {n} rows', nothing: 'Nothing to import', newDepts: 'Create {n} new department{s}: {list}?', createGo: 'Create and import', back: 'Back',
    importing: 'Importing… {done} of {total}', done: 'Import finished', result: '{added} added, {updated} updated, {unchanged} unchanged, {skipped} skipped, {errors} not imported, {warnings} warnings',
    report: 'Download error report', undo: 'Undo this import', undoAsk: 'Remove the {a} people this import added and put back the {u} it changed?', undoGo: 'Undo import',
    undone: 'Import undone: {r} removed, {u} restored', failed: 'Stopped after {done} of {total} rows: {msg}. The first {done} were imported; the rest weren’t. Download the report to retry them.',
    history: 'Recent imports', noHistory: 'No imports yet.', by: 'by', invite: 'New people don’t get a login. Invite them from Settings → Team access when you’re ready.',
    deny: 'Only company admins with the People area can import employees.',
  } };
  const lang = () => 'en';
  const t = (k, vars = {}) => (STR[lang()]?.[k] ?? STR.en[k]).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');

  let ctx = null, xlsxReady = null;
  const st = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const icon = (n) => ctx.icon(n);
  const data = () => (st().importData = st().importData || { logs: [], mappings: [] });
  const s = { file: null, book: null, sheet: '', grid: null, header: 0, mapping: [], mode: 'upsert', keys: 'auto', remember: true, plan: null, log: null, error: '' };
  // Company admins with the People area (the same people who can add employees). Firestore rules enforce it too.
  const allowed = () => !!window.AllurusAccess?.can('people');
  const keysOf = (v) => ({ auto: ['ic', 'staffNo', 'email'], ic: ['ic'], staffNo: ['staffNo'], email: ['email'] })[v];
  const deptName = (id) => ctx.dept(id)?.name || '';
  const body = () => document.getElementById('im-body');
  const set = (html) => { const b = body(); if (b) b.innerHTML = html; };

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return (xlsxReady = xlsxReady || new Promise((ok, fail) => {
      const el = document.createElement('script'); el.src = XLSX_SRC; el.onload = () => ok(window.XLSX); el.onerror = () => { xlsxReady = null; fail(new Error('The spreadsheet reader could not load.')); };
      document.head.appendChild(el);
    }));
  }
  // A sheet as rows of plain values: numbers stay numbers, date cells become YYYY-MM-DD, merged cells are filled
  // from their top-left cell, formulas give their saved result (nothing in the file is ever run).
  function sheetGrid(X, ws) {
    if (!ws || !ws['!ref']) return [];
    const r = X.utils.decode_range(ws['!ref']);
    if (r.e.r - r.s.r > MAX_ROWS + 20) throw Object.assign(new Error('rows'), { rows: r.e.r - r.s.r });
    const out = [];
    for (let y = r.s.r; y <= r.e.r; y++) {
      const row = [];
      for (let x = r.s.c; x <= r.e.c; x++) {
        const c = ws[X.utils.encode_cell({ r: y, c: x })];
        if (!c || c.v == null) { row.push(''); continue; }
        if (c.t === 'n' && c.z && X.SSF.is_date(c.z)) { const d = X.SSF.parse_date_code(c.v); row.push(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`); }
        else if (c.t === 'd') row.push(c.v.toISOString().slice(0, 10));
        else if (c.t === 'n') row.push(c.v);
        else if (c.t === 'b') row.push(c.v ? 'TRUE' : 'FALSE');
        else if (c.t === 'e') row.push('');
        else row.push(String(c.w ?? c.v));
      }
      out.push(row);
    }
    for (const m of ws['!merges'] || []) {
      const v = out[m.s.r - r.s.r]?.[m.s.c - r.s.c];
      for (let y = m.s.r; y <= m.e.r; y++) for (let x = m.s.c; x <= m.e.c; x++) if (out[y - r.s.r]) out[y - r.s.r][x - r.s.c] = v;
    }
    return out;
  }
  // The file's type and size, before anything reads it. Returns the extension, or an error message.
  function checkFile(name, size) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (['xlsm', 'xlsb', 'xltm', 'xlam'].includes(ext)) return { error: t('macro') };
    if (!['xlsx', 'xls', 'csv'].includes(ext) || !String(name).includes('.')) return { error: t('badType') };
    if (size > MAX_BYTES) return { error: t('tooBig') };
    if (!size) return { error: t('empty') };
    return { ext };
  }
  async function readFile(file) {
    const chk = checkFile(file.name, file.size);
    if (chk.error) throw new Error(chk.error);
    const ext = chk.ext;
    const buf = await file.arrayBuffer();
    // Big files (roughly over 1,000 rows) are parsed in a Web Worker so the page doesn't freeze.
    if (file.size > 250 * 1024 && window.Worker) { try { return await viaWorker(buf, ext); } catch (e) { if (e.message === 'macro') throw new Error(t('macro')); /* fall back to this thread */ } }
    const X = await loadXlsx();
    return parseBook(X, buf, ext, sheetGrid);
  }
  // Shared by this thread and the worker: the workbook as { names, sheets: { name: rows | { tooMany } } }.
  // CSV is read as UTF-8 text (BOM removed) with every value kept as written, so 05/06/2026 stays day-first.
  function parseBook(X, buf, ext, grid) {
    const book = ext === 'csv'
      ? X.read(new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''), { type: 'string', raw: true, dense: false })
      : X.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false });
    if (book.vbaraw) throw new Error('macro');
    const sheets = {};
    for (const n of book.SheetNames) { try { sheets[n] = grid(X, book.Sheets[n]); } catch (e) { sheets[n] = { tooMany: e.rows || 0 }; } }
    return { names: book.SheetNames, sheets };
  }
  function viaWorker(buf, ext) {
    const src = `importScripts(${JSON.stringify(new URL(XLSX_SRC, location.href).href)});
      const MAX_ROWS = ${MAX_ROWS}; const sheetGrid = ${sheetGrid.toString()}; const parseBook = ${parseBook.toString()};
      onmessage = (e) => { try { postMessage({ ok: true, book: parseBook(self.XLSX, e.data.buf, e.data.ext, sheetGrid) }); } catch (err) { postMessage({ ok: false, msg: err.message }); } };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    return new Promise((ok, fail) => {
      const w = new Worker(url);
      const end = () => { w.terminate(); URL.revokeObjectURL(url); };
      w.onmessage = (e) => { end(); e.data.ok ? ok(e.data.book) : fail(new Error(e.data.msg)); };
      w.onerror = (e) => { end(); e.preventDefault?.(); fail(new Error('worker')); };
      w.postMessage({ buf, ext }, [buf]);
    }).catch(async (e) => { if (e.message === 'macro') throw e; return parseBook(await loadXlsx(), buf.byteLength ? buf : await s.file.arrayBuffer(), ext, sheetGrid); });
  }
  const sheetsWithData = () => s.book.names.filter((n) => { const g = s.book.sheets[n]; return g && (g.tooMany || g.length); });

  function useSheet(name) {
    s.sheet = name;
    const raw = s.book.sheets[name];
    if (raw?.tooMany) { s.error = t('tooMany', { n: raw.tooMany.toLocaleString() }); s.grid = null; return; }
    s.grid = R.tidyGrid(raw || []);
    if (!s.grid.rows.length) { s.error = t('empty'); s.grid = null; return; }
    if (s.grid.rows.length > MAX_ROWS + 15) { s.error = t('tooMany', { n: s.grid.rows.length.toLocaleString() }); s.grid = null; return; }
    s.error = '';
    useHeader(R.detectHeaderRow(s.grid));
  }
  const headers = () => s.grid.rows[s.header].cells.map((c, i) => (String(c ?? '').trim() || `Column ${i + 1}`));
  function useHeader(i) {
    s.header = Math.max(0, Math.min(s.grid.rows.length - 1, i));
    const h = headers(), cols = h.map((_, c) => s.grid.rows.slice(s.header + 1).map((r) => r.cells[c]));
    const saved = data().mappings.find((m) => m.signature === R.signature(h));
    s.mapping = R.autoMap(h, cols, { saved, today: U.today() });
    replan();
  }
  function replan() {
    s.plan = R.buildPlan({ grid: s.grid, headerIndex: s.header, mapping: s.mapping, existing: st().employees, departments: st().departments, mode: s.mode, keys: keysOf(s.keys), banks: AllurusStatutory.BANKS, today: U.today() });
  }

  // ---------- Screens ----------
  function open() {
    if (!allowed()) { ctx.toast(t('deny'), 'error'); return; }
    Object.assign(s, { file: null, book: null, grid: null, plan: null, log: null, error: '', mode: 'upsert', keys: 'auto' });
    ctx.openModal({ title: t('title'), size: 'lg', submit: null, body: '<div id="im-body"></div>' });
    document.querySelector('#overlay-root .modal-foot').hidden = true;
    pickScreen();
  }
  function pickScreen() {
    const logs = data().logs.slice().reverse();
    set(`<div class="im-drop"><label class="btn btn-primary" for="im-file">${icon('doc')}${t('pick')}</label>
        <input type="file" id="im-file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden>
        <p class="muted">${t('pickHint')}</p>${s.error ? `<p class="login-error" role="alert">${esc(s.error)}</p>` : ''}
        <p class="faint">${t('templateHint')} <button type="button" class="btn btn-sm btn-ghost" data-act="im-template">${icon('download')}${t('template')}</button></p></div>
      <h3 class="im-h">${t('history')}</h3>
      ${logs.length ? `<div class="list">${logs.map((l, i) => `<div class="list-item"><div class="grow"><div class="person-name">${esc(l.fileName || 'Import')}</div>
        <div class="person-sub">${new Date(l.at).toLocaleString()} ${t('by')} ${esc(l.by)} · ${esc(t('result', l.counts))}${l.undoneAt ? ' · undone' : ''}</div></div>
        ${i === 0 && !l.undoneAt && l.created ? `<button type="button" class="btn btn-sm" data-act="im-undo" data-id="${esc(l.id)}">${t('undo')}</button>` : ''}</div>`).join('')}</div>` : `<p class="faint">${t('noHistory')}</p>`}
      <div id="im-confirm"></div>`);
    document.getElementById('im-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      set(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>${t('reading')}</strong><p class="muted">${esc(file.name)}</p></div></div>`);
      try {
        s.file = file;
        s.book = await readFile(file);
        const sheets = sheetsWithData();
        if (!sheets.length) throw new Error(t('empty'));
        useSheet(sheets[0]);
        if (!s.grid) throw new Error(s.error);
        mapScreen();
      } catch (e) {
        // Our own messages are shown as they are; anything from the parser becomes one plain sentence.
        const ours = Object.values(STR.en).includes(e.message) || /^That sheet has/.test(e.message || '');
        s.error = e.message === 'macro' ? t('macro') : ours ? e.message : t('unreadable');
        console.warn('[import] could not read the file:', e?.name || 'error');
        pickScreen();
      }
    });
  }

  const badge = (c) => `<span class="pill ${{ high: 'ok', medium: 'warn', low: 'bad', none: '' }[c]}">${t(c)}</span>`;
  const show = (field, v) => {
    if (v == null || v === '') return '';
    if (field === 'ic') return esc(R.maskIC(R.cleanValue('ic', v).value || String(v)));
    if (field === 'accountNo') return esc(R.maskAcct(String(v).replace(/\D/g, '')));
    return esc(String(v).slice(0, 40));
  };
  function mapScreen() {
    const h = headers(), dataRows = s.grid.rows.slice(s.header + 1);
    const missing = R.missingRequired(s.mapping), sheets = sheetsWithData();
    const c = s.plan.counts, todo = c.add + c.update;
    const used = new Set(s.mapping.map((m) => m.field).filter(Boolean));
    const opts = (cur) => `<option value="">${t('ignore')}</option>${FIELDS().map((f) => `<option value="${f.key}" ${f.key === cur ? 'selected' : ''}>${esc(f.label)}${f.required ? ' *' : ''}${used.has(f.key) && f.key !== cur ? ' (in use)' : ''}</option>`).join('')}`;
    const mapped = s.mapping.filter((m) => m.field);
    set(`<div class="im-bar">
        ${sheets.length > 1 ? `<label class="field"><span>${t('sheet')}</span><select class="select" id="im-sheet">${sheets.map((n) => `<option ${n === s.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>${t('headerRow')}</span><input class="input num" id="im-header" type="number" min="1" max="${s.grid.rows.length}" value="${s.grid.rows[s.header].n}" style="width:90px"></label>
        <label class="field"><span>${t('mode')}</span><select class="select" id="im-mode"><option value="upsert" ${s.mode === 'upsert' ? 'selected' : ''}>${t('upsert')}</option><option value="add" ${s.mode === 'add' ? 'selected' : ''}>${t('add')}</option></select></label>
        <label class="field"><span>${t('key')}</span><select class="select" id="im-key">${[['auto', 'keyAuto'], ['ic', 'keyIc'], ['staffNo', 'keyStaff'], ['email', 'keyEmail']].map(([v, k]) => `<option value="${v}" ${s.keys === v ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></label>
      </div>
      <p class="faint" style="margin:6px 0 10px">${esc(s.file.name)} · ${dataRows.length.toLocaleString()} rows · ${t('salaryNote')}</p>
      ${missing.length ? `<div class="confirm-bar" role="alert">${icon('x')}<span>${t('missing', { list: missing.map((k) => FIELDS().find((f) => f.key === k).label).join(', ') })}</span></div>` : ''}
      <h3 class="im-h">${t('mapping')}</h3>
      <div class="table-wrap im-table"><table class="table"><thead><tr><th>Column</th><th>${t('samples')}</th><th>${t('field')}</th><th>${t('conf')}</th></tr></thead><tbody>
        ${s.mapping.map((m) => `<tr class="${!m.field ? 'im-off' : ''}"><td><b>${esc(h[m.col])}</b>${m.flag ? `<div class="field-hint">${esc(m.flag)}</div>` : ''}</td>
          <td class="faint">${dataRows.map((r) => r.cells[m.col]).filter((v) => v !== '' && v != null).slice(0, 3).map((v) => show(m.field, v)).join('<br>')}</td>
          <td><select class="select" data-col="${m.col}" aria-label="Field for ${esc(h[m.col])}">${opts(m.field)}</select></td><td>${m.field ? badge(m.confidence) : badge('none')}</td></tr>`).join('')}
      </tbody></table></div>
      <label class="check" style="margin:10px 0"><input type="checkbox" id="im-save" ${s.remember ? 'checked' : ''}><span>${t('save')}</span></label>
      <h3 class="im-h">${t('preview')}</h3>
      <p class="muted">${esc(t('summary', c))}</p>
      <div class="table-wrap im-table"><table class="table"><thead><tr><th>Row</th><th>Status</th>${mapped.map((m) => `<th>${esc(FIELDS().find((f) => f.key === m.field).label)}</th>`).join('')}<th>Notes</th></tr></thead><tbody>
        ${s.plan.rows.slice(0, 20).map((r) => `<tr><td class="num">${r.n}</td><td><span class="pill ${{ ready: 'ok', warning: 'warn', error: 'bad' }[r.status]}">${t(r.status)}</span><div class="field-hint">${r.action === 'update' ? `Update ${esc(r.matchName)}` : r.action === 'same' ? `No change (${esc(r.matchName)})` : r.action === 'skip' ? `Skip, exists (${esc(r.matchName)})` : r.action === 'add' ? 'New' : ''}</div></td>
          ${mapped.map((m) => { const f = FIELDS().find((x) => x.key === m.field), key = f.target || f.key; const v = r.values[key === 'salary' ? 'salary' : m.field]; return `<td>${show(m.field, typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)}</td>`; }).join('')}
          <td class="im-notes">${[...r.errors.map((x) => `<span class="im-err">${esc(x)}</span>`), ...r.warnings.map((x) => esc(x))].join('<br>')}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="faint" style="margin-top:8px">${t('invite')}</p>
      <div id="im-confirm"></div>
      <div class="ci-actions"><button type="button" class="btn" data-act="im-back">${t('back')}</button><button type="button" class="btn" data-act="im-report" ${c.error + c.warning ? '' : 'disabled'}>${icon('download')}${t('report')}</button>
        <button type="button" class="btn btn-primary" data-act="im-go" ${missing.length && c.add + s.plan.rows.filter((r) => r.errors.some((e) => e.startsWith('Missing'))).length ? 'disabled' : ''} ${todo ? '' : 'disabled'}>${todo ? t('importBtn', { n: todo.toLocaleString() }) : t('nothing')}</button></div>`);
    const on = (id, fn) => document.getElementById(id)?.addEventListener('change', fn);
    on('im-sheet', (ev) => { useSheet(ev.target.value); if (!s.grid) { pickScreen(); return; } mapScreen(); });
    on('im-header', (ev) => { const n = +ev.target.value; const i = s.grid.rows.findIndex((r) => r.n >= n); useHeader(i < 0 ? s.grid.rows.length - 1 : i); mapScreen(); });
    on('im-mode', (ev) => { s.mode = ev.target.value; replan(); mapScreen(); });
    on('im-key', (ev) => { s.keys = ev.target.value; replan(); mapScreen(); });
    on('im-save', (ev) => { s.remember = ev.target.checked; });
    body().querySelectorAll('select[data-col]').forEach((sel) => sel.addEventListener('change', () => {
      const col = +sel.dataset.col, field = sel.value;
      s.mapping = s.mapping.map((m) => (m.col === col ? { ...m, field, confidence: field ? 'high' : 'none', flag: '', source: 'admin' } : field && m.field === field ? { ...m, field: '', confidence: 'none', flag: `Moved to “${headers()[col]}”` } : m));
      // Monthly and annual salary fill the same field: picking one clears the other.
      const target = FIELDS().find((f) => f.key === field)?.target;
      if (target) s.mapping = s.mapping.map((m) => (m.col !== col && FIELDS().find((f) => f.key === m.field)?.target === target ? { ...m, field: '', confidence: 'none' } : m));
      replan(); mapScreen();
    }));
  }

  function rememberMapping() {
    const h = headers(), sig = R.signature(h);
    const map = Object.fromEntries(s.mapping.map((m) => [R.squash(h[m.col]), m.field || '']));
    const d = data(); d.mappings = [{ signature: sig, map, at: new Date().toISOString() }, ...d.mappings.filter((m) => m.signature !== sig)].slice(0, 10);
  }
  function confirmDepts() {
    const n = s.plan.newDepts.length;
    if (!n) { run(); return; }
    document.getElementById('im-confirm').innerHTML = `<div class="dept-note" role="alert">${icon('plus')}<span style="flex:1">${esc(t('newDepts', { n, s: n === 1 ? '' : 's', list: s.plan.newDepts.join(', ') }))}</span>
      <button type="button" class="btn btn-sm" data-act="im-cancel-confirm">${t('back')}</button><button type="button" class="btn btn-sm btn-primary" data-act="im-run">${t('createGo')}</button></div>`;
  }
  // Applies the plan in chunks of 400 rows, saving after each, so a large file shows progress and a failure part
  // way reports exactly which rows went in.
  async function run() {
    if (!allowed()) { ctx.toast(t('deny'), 'error'); return; }
    replan();
    const plan = s.plan, rows = plan.rows, total = rows.length;
    const by = ctx.account()?.email || ctx.me()?.email || 'admin';
    const batchId = U.uid('imp');
    const log = { id: batchId, at: new Date().toISOString(), by, fileName: s.file.name.slice(0, 120), created: [], updated: [], depts: [], counts: { added: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, warnings: 0 } };
    const bar = (done) => set(`<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div style="flex:1"><strong>${t('importing', { done: done.toLocaleString(), total: total.toLocaleString() })}</strong>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" style="margin-top:8px"><i style="width:${Math.round((done / total) * 100)}%"></i></div></div></div>`);
    let done = 0;
    try {
      for (let i = 0; i < total; i += CHUNK) {
        bar(done);
        await new Promise((r) => setTimeout(r, 0));
        const part = R.applyPlan(st(), { ...plan, newDepts: i === 0 ? plan.newDepts : [] }, { batchId, by, now: log.at, fileName: log.fileName, uid: U.uid, rows: rows.slice(i, i + CHUNK) });
        log.created.push(...part.created); log.updated.push(...part.updated); log.depts.push(...part.depts);
        Object.keys(log.counts).forEach((k) => { log.counts[k] += part.counts[k]; });
        done = Math.min(total, i + CHUNK);
        ctx.save();
      }
    } catch (e) {
      s.log = finish(log);
      ctx.commit('Import stopped part way');
      resultScreen(t('failed', { done, total, msg: e.message || 'error' }), done);
      return;
    }
    s.log = finish(log);
    ctx.commit(`${t('done')}: ${t('result', log.counts)}`, `Imported employees from ${log.fileName}`);
    setTimeout(() => { if (!body()) { ctx.openModal({ title: t('title'), size: 'lg', submit: null, body: '<div id="im-body"></div>' }); document.querySelector('#overlay-root .modal-foot').hidden = true; } resultScreen(); }, 0);
  }
  function finish(log) {
    if (s.remember) rememberMapping();
    const d = data();
    d.logs = [...d.logs, log].slice(-KEEP_LOGS);
    // Only the newest imports keep what undo needs; older ones keep their counts.
    d.logs.slice(0, -KEEP_UNDO).forEach((l) => { delete l.created; delete l.updated; delete l.depts; });
    return log;
  }
  function resultScreen(problem = '', doneRows) {
    const l = s.log, c = l.counts;
    set(`<div class="lock-banner ${problem ? 'warn' : ''}">${icon(problem ? 'x' : 'check')}<span><b>${problem ? esc(problem) : t('done')}</b><br>${esc(t('result', c))}</span></div>
      <p class="faint" style="margin:10px 0">${t('invite')}</p>
      <div id="im-confirm"></div>
      <div class="ci-actions"><button type="button" class="btn" data-act="im-report" ${c.errors + c.warnings || problem ? '' : 'disabled'}>${icon('download')}${t('report')}</button>
        ${l.created?.length || l.updated?.length ? `<button type="button" class="btn btn-danger" data-act="im-undo" data-id="${esc(l.id)}">${t('undo')}</button>` : ''}
        <button type="button" class="btn btn-primary" data-act="close-overlay">Done</button></div>`);
    s.failedFrom = problem ? doneRows : null;
  }
  function downloadCsv(name, rows) {
    // UTF-8 with a BOM so Excel shows Malay and Chinese names correctly.
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function report() {
    const h = headers();
    const rows = R.errorReport(s.plan, h);
    if (s.failedFrom != null) s.plan.rows.slice(s.failedFrom).forEach((r) => { if (r.action !== 'error') rows.push([r.n, 'Not imported (the import stopped)', ...h.map((x) => R.safeCell(r.original[x] ?? ''))]); });
    downloadCsv(`import-problems-${U.today()}.csv`, rows);
  }
  async function template() {
    const X = await loadXlsx();
    const head = R.EXPORT.map(([k, h]) => (k === 'salaryAnnual' ? 'Monthly salary' : h));
    const ex = [
      ['S001', 'Nur Aisyah binti Abdul Rahman', 'aisyah@example.com', '012-345 6789', 'HR Executive', 'Human Resources', 'Active', 'Full-time', 'Kuantan', '01/03/2024', 'RM 4,200.00', '950312-06-5512', 'Female', '12/03/1995', '12345678', '950312065512', 'SG 1234567890', 'Maybank', '112233445566', 'Malaysian', 'No. 1, Jalan Contoh, 25000 Kuantan', 'Abdul Rahman bin Ali', '013-222 3344'],
      ['S002', 'Lim Wei Jie', 'weijie@example.com', '019-876 5432', 'Storekeeper', 'Operations', 'Active', 'Contract', 'Kemaman', '15/07/2025', '2800', '010505-11-1235', 'Male', '05/05/2001', '', '', '', 'CIMB Bank', '7001234567', 'Malaysian', '', 'Lim Ah Kow', '012-998 7766'],
    ];
    const ws = X.utils.aoa_to_sheet([head, ...ex]);
    // Keep IDs, phones and account numbers as text so Excel doesn't turn them into numbers.
    for (let r = 1; r <= ex.length; r++) head.forEach((_, c) => { const cell = ws[X.utils.encode_cell({ r, c })]; if (cell) { cell.t = 's'; cell.z = '@'; } });
    ws['!cols'] = head.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Employees');
    X.writeFile(wb, 'employees-template.xlsx');
  }
  function askUndo(id) {
    const l = data().logs.find((x) => x.id === id); if (!l || !l.created) return;
    document.getElementById('im-confirm').innerHTML = `<div class="confirm-bar"><span style="flex:1">${esc(t('undoAsk', { a: l.created.length, u: l.updated.length }))}</span>
      <button type="button" class="btn btn-sm" data-act="im-cancel-confirm">Keep</button><button type="button" class="btn btn-sm btn-danger" data-act="im-undo-go" data-id="${esc(id)}">${t('undoGo')}</button></div>`;
  }
  function undo(id) {
    if (!allowed()) { ctx.toast(t('deny'), 'error'); return; }
    const l = data().logs.find((x) => x.id === id); if (!l || !l.created) return;
    const ws = st();
    const r = R.undoImport(ws, l);
    l.undoneAt = new Date().toISOString(); delete l.created; delete l.updated; delete l.depts;
    ctx.commit(t('undone', { r: r.removed, u: r.restored }), `Undid the import of ${l.fileName}`);
    ctx.closeOverlay();
  }

  function install(c) {
    ctx = c;
    Object.assign(ctx.ACTIONS, {
      'import-emps': () => open(),
      'im-template': () => template().catch(() => ctx.toast('The template couldn’t be made here', 'error')),
      'im-back': () => { s.error = ''; pickScreen(); },
      'im-go': () => confirmDepts(),
      'im-run': () => run(),
      'im-cancel-confirm': () => { const el = document.getElementById('im-confirm'); if (el) el.innerHTML = ''; },
      'im-report': () => report(),
      'im-undo': (id) => askUndo(id),
      'im-undo-go': (id) => undo(id),
      'export-emps': () => downloadCsv('employees.csv', R.exportRows(st().employees, deptName)),
    });
    return { open, STR };
  }
  return { install, checkFile, parseBook, sheetGrid, STR };
})();
