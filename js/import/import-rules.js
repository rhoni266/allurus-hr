// Employee import rules: find the header row, work out which column is which field (header names plus what the
// values look like), clean and check every row, match rows to existing employees, apply the import and undo it.
// Pure functions with no DOM access, unit tested in tests/import.test.js. The UI is js/import/import.js.
window.AllurusImportRules = (function () {
  'use strict';
  const FIELDS = () => window.AllurusImportFieldMap;
  const fieldOf = (key) => FIELDS().find((f) => f.key === key);

  // ---------- Text helpers ----------
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const squash = (s) => norm(s).replace(/ /g, '');
  const clean = (v) => (v == null ? '' : typeof v === 'string' ? v.replace(/^﻿/, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : v);
  const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
  const digits = (s) => String(s ?? '').replace(/\D/g, '');
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  // ---------- The grid ----------
  // Trim every cell, and drop blank rows and trailing blank columns. Keeps each row's original number (1-based).
  function tidyGrid(rows) {
    const out = [];
    let width = 0;
    rows.forEach((r, i) => {
      const cells = (r || []).map(clean);
      if (cells.every(isBlank)) return;
      let w = cells.length; while (w && isBlank(cells[w - 1])) w--;
      width = Math.max(width, w);
      out.push({ n: i + 1, cells: cells.slice(0, w) });
    });
    out.forEach((r) => { while (r.cells.length < width) r.cells.push(''); });
    return { rows: out, width };
  }

  // ---------- Header names ----------
  // How well one header names one field: 1 exact, 0.85 one contains the other, 0.7 a near spelling.
  function headerScore(header, field) {
    const h = squash(header), hn = norm(header);
    if (!h) return { score: 0, syn: '' };
    let best = { score: 0, syn: '' };
    for (const syn of field.headers) {
      const s = squash(syn);
      let score = 0;
      if (h === s) score = 1;
      else if (s.length >= 3 && (` ${hn} `.includes(` ${norm(syn)} `))) score = 0.85 * Math.min(1, s.length / h.length + 0.3);
      else if (h.length >= 5 && s.length >= 5 && lev(h, s) <= Math.max(1, Math.floor(s.length / 6))) score = 0.7;
      if (score > best.score || (score === best.score && s.length > squash(best.syn).length)) best = { score, syn };
    }
    return best;
  }
  const bestHeaderField = (header) => FIELDS().map((f) => ({ f, ...headerScore(header, f) })).sort((a, b) => b.score - a.score)[0];

  // The header row is the one, in the first 15, whose cells look most like field names.
  function detectHeaderRow(grid) {
    let best = { index: 0, score: -1 };
    grid.rows.slice(0, 15).forEach((r, i) => {
      const text = r.cells.filter((c) => typeof c === 'string' && c && !/^[\d.,\s/-]+$/.test(c));
      const hits = r.cells.filter((c) => typeof c === 'string' && (bestHeaderField(c)?.score || 0) >= 0.7).length;
      const score = hits * 2 + text.length * 0.25 - (r.cells.length - text.length) * 0.5;
      if (hits >= 1 && score > best.score) best = { index: i, score };
    });
    return best.index;
  }

  // ---------- What the values look like ----------
  const MONTHS = { jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, mar: 3, march: 3, mac: 3, apr: 4, april: 4, may: 5, mei: 5,
    jun: 6, june: 6, jul: 7, july: 7, julai: 7, aug: 8, august: 8, ogos: 8, ogo: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, okt: 10, oktober: 10,
    nov: 11, november: 11, dec: 12, december: 12, dis: 12, disember: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  const fullYear = (y, nowYear) => (y >= 100 ? y : y <= (nowYear % 100) + 5 ? 2000 + y : 1900 + y);
  // A date from a cell: ISO text, day-first text (or month-first when the column says so), text months, Excel serials.
  function parseDate(v, { order = 'dmy', serials = false, nowYear = new Date().getFullYear() } = {}) {
    if (v instanceof Date && !isNaN(v)) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' || (/^\d{5}(\.\d+)?$/.test(String(v)) && serials)) {
      const n = Number(v);
      if (!serials || n < 1 || n > 80000) return null;
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = String(v ?? '').trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1');
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (m) { const y = fullYear(+m[3], nowYear); return order === 'mdy' ? ymd(y, +m[1], +m[2]) : ymd(y, +m[2], +m[1]); }
    m = /^(\d{1,2})[\s\-/.]*([A-Za-z]+)\.?[\s\-/.,]*(\d{2}|\d{4})$/.exec(s);
    if (m && MONTHS[m[2].toLowerCase()]) return ymd(fullYear(+m[3], nowYear), MONTHS[m[2].toLowerCase()], +m[1]);
    m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
    if (m && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    return null;
  }
  // Day-first (Malaysia) unless some value only makes sense month-first, such as 12/31/2026.
  function dateOrder(values) {
    let dmy = 0, mdy = 0;
    for (const v of values) {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/.exec(String(v).trim());
      if (!m) continue;
      if (+m[1] > 12 && +m[2] <= 12) dmy++;
      if (+m[2] > 12 && +m[1] <= 12) mdy++;
    }
    return mdy > 0 && dmy === 0 ? 'mdy' : 'dmy';
  }
  const IC_RE = /^\d{6}-?\d{2}-?\d{4}$/;
  const looks = {
    ic: (v) => IC_RE.test(String(v).replace(/\s/g, '')) || (typeof v === 'number' && v >= 1e10 && v < 1e12),
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)),
    phone: (v) => { const s = String(v).replace(/[\s\-().]/g, ''); return /^(\+?60|0)1\d{7,9}$/.test(s) || /^(\+?60|0)[3-9]\d{7,8}$/.test(s) || /^1\d{8,9}$/.test(s); },
    date: (v) => typeof v === 'string' && !!parseDate(v),
    money: (v) => { const s = String(v).replace(/rm|myr|,|\s/gi, ''); return /^\d+(\.\d{1,2})?$/.test(s) && +s >= 100 && +s < 5e6 && (/rm|\./i.test(String(v)) || +s >= 500); },
    name: (v) => typeof v === 'string' && /^[\p{L}][\p{L}'’.@/\- ]+$/u.test(v) && v.trim().split(/\s+/).length >= 2,
  };
  // How much a column's values look like each kind of field, from its first 50 non-empty values.
  function contentGuess(values, { today = new Date().toISOString().slice(0, 10) } = {}) {
    const vs = values.filter((v) => !isBlank(v)).slice(0, 50);
    if (!vs.length) return [];
    const frac = (fn) => vs.filter(fn).length / vs.length;
    const out = [];
    const add = (key, score) => { if (score >= 0.6) out.push({ key, score }); };
    add('ic', frac(looks.ic));
    add('email', frac(looks.email));
    add('phone', frac(looks.phone));
    const dates = vs.map((v) => parseDate(v, { order: dateOrder(vs) })).filter(Boolean);
    if (dates.length / vs.length >= 0.6) {
      const cutoff = `${+today.slice(0, 4) - 16}${today.slice(4)}`;
      add(dates.filter((d) => d <= cutoff).length / dates.length > 0.8 ? 'birthday' : 'start', dates.length / vs.length);
    }
    const money = vs.filter(looks.money).map((v) => +String(v).replace(/rm|myr|,|\s/gi, ''));
    if (money.length / vs.length >= 0.6) { const mid = money.sort((a, b) => a - b)[money.length >> 1]; add(mid > 25000 ? 'salaryAnnual' : 'salaryMonthly', money.length / vs.length); }
    const unique = new Set(vs.map((v) => norm(v))).size / vs.length;
    if (unique > 0.8) add('name', frac(looks.name));
    else if (vs.length >= 4 && unique <= 0.5 && frac((v) => typeof v === 'string' && /\p{L}/u.test(v)) > 0.9) out.push({ key: 'dept', score: 0.6 });
    return out.sort((a, b) => b.score - a.score);
  }

  // ---------- Column mapping ----------
  const confidence = (s) => (s >= 0.9 ? 'high' : s >= 0.65 ? 'medium' : s >= 0.4 ? 'low' : 'none');
  const signature = (headers) => headers.map(squash).join('|');
  // For each column: the best field (never two columns on one field), a score and a confidence label.
  // `saved` is a remembered mapping { signature, map: { squashedHeader: fieldKey | '' } } for files with these headers.
  function autoMap(headers, columns, { saved = null, today } = {}) {
    if (saved && saved.signature === signature(headers)) {
      return headers.map((h, i) => ({ col: i, header: h, field: saved.map[squash(h)] || '', score: 1, confidence: saved.map[squash(h)] ? 'high' : 'none', source: 'saved' }));
    }
    const cands = [];
    headers.forEach((h, i) => {
      const content = contentGuess(columns[i] || [], { today });
      for (const f of FIELDS()) {
        const hs = headerScore(h, f).score;
        const cs = content.find((c) => c.key === f.key)?.score || 0;
        let score = Math.max(hs, cs * 0.7);
        if (hs >= 0.7 && cs >= 0.6) score = Math.min(1, score + 0.1);
        // A header that names a date or money field but values that clearly aren't, or the reverse, lowers it.
        if (hs >= 0.7 && content.length && !cs && ['ic', 'email', 'date', 'money'].includes(f.kind) && content[0].score >= 0.8) score -= 0.3;
        if (score >= 0.4) cands.push({ col: i, field: f.key, score, hs, cs });
      }
    });
    cands.sort((a, b) => b.score - a.score || b.hs - a.hs);
    const byCol = new Map(), usedField = new Map(), targets = new Map();
    const flags = new Map();
    for (const c of cands) {
      if (byCol.has(c.col)) continue;
      const target = fieldOf(c.field).target || c.field;
      if (usedField.has(c.field) || targets.has(target)) {
        if (!flags.has(c.col)) flags.set(c.col, `Looks like ${fieldOf(c.field).label}, already taken by “${headers[usedField.get(c.field) ?? targets.get(target)]}”`);
        continue;
      }
      byCol.set(c.col, c); usedField.set(c.field, c.col); targets.set(target, c.col);
    }
    // A full name and separate first/last columns: keep whichever is there.
    return headers.map((h, i) => {
      const c = byCol.get(i);
      return { col: i, header: h, field: c ? c.field : '', score: c ? +c.score.toFixed(2) : 0, confidence: c ? confidence(c.score) : 'none', flag: c ? '' : flags.get(i) || '', source: c ? (c.hs >= c.cs * 0.7 ? 'header' : 'content') : '' };
    });
  }
  // Fields a new employee needs that no column fills. A full name, or first and last together, both count.
  function missingRequired(mapping) {
    const has = new Set(mapping.map((m) => m.field).filter(Boolean));
    return FIELDS().filter((f) => f.required && !has.has(f.key) && !(f.key === 'name' && has.has('first'))).map((f) => f.key);
  }

  // ---------- Cleaning each value ----------
  const PARTICLES = new Set(['bin', 'binti', 'bt', 'bte', 'a/l', 'a/p', 'al', 'ap', 's/o', 'd/o', 'van', 'von', 'de', 'da', 'del', 'bn', 'b.']);
  function titleName(s) {
    return String(s).trim().replace(/\s+/g, ' ').split(' ').map((w) => {
      const lw = w.toLowerCase();
      if (PARTICLES.has(lw)) return lw;
      if (w !== w.toUpperCase() && w !== lw) return w;          // already mixed case: McDonald, DeSilva
      return lw.replace(/(^|[-'’(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    }).join(' ');
  }
  // Split a full name into the app's first and last names. Malay and Indian names split at bin/binti/a/l/a/p.
  function splitName(full) {
    const w = String(full).trim().split(/\s+/);
    if (w.length === 1) return { first: w[0], last: '' };
    const i = w.findIndex((x, k) => k > 0 && PARTICLES.has(x.toLowerCase()));
    if (i > 0) return { first: w.slice(0, i).join(' '), last: w.slice(i).join(' ') };
    return { first: w.slice(0, -1).join(' '), last: w[w.length - 1] };
  }
  const nowYY = () => new Date().getFullYear() % 100;
  function icInfo(d12) {
    const yy = +d12.slice(0, 2), mm = +d12.slice(2, 4), dd = +d12.slice(4, 6);
    const birthday = ymd(yy <= nowYY() ? 2000 + yy : 1900 + yy, mm, dd);
    return { birthday, gender: +d12[11] % 2 ? 'male' : 'female' };
  }
  const STATUS = { active: 'Active', aktif: 'Active', yes: 'Active', y: 'Active', ya: 'Active', true: 'Active', 1: 'Active', working: 'Active', bekerja: 'Active', current: 'Active',
    inactive: 'Inactive', 'tidak aktif': 'Inactive', 'tak aktif': 'Inactive', no: 'Inactive', n: 'Inactive', tidak: 'Inactive', false: 'Inactive', 0: 'Inactive',
    resigned: 'Inactive', berhenti: 'Inactive', terminated: 'Inactive', left: 'Inactive', former: 'Inactive', 'on leave': 'Active', 'on probation': 'Active', probation: 'Active' };
  const TYPES = [[/full|sepenuh|permanent|tetap|perm/i, 'Full-time'], [/part|separuh|sambilan/i, 'Part-time'], [/contract|kontrak|temporary|sementara|fixed/i, 'Contract'],
    [/intern|latihan|praktikal|trainee/i, 'Intern'], [/owner|pemilik|director|pengarah/i, 'Owner']];
  const GENDER = { m: 'male', male: 'male', lelaki: 'male', l: 'male', man: 'male', f: 'female', female: 'female', perempuan: 'female', p: 'female', woman: 'female', wanita: 'female' };
  const MARRIED = { married: true, kahwin: true, berkahwin: true, yes: true, y: true, ya: true, single: false, bujang: false, no: false, n: false, 'belum berkahwin': false, divorced: false, widowed: false, bercerai: false };
  const BANK_ALIAS = { mbb: 'Maybank', 'malayan banking': 'Maybank', cimb: 'CIMB Bank', pbb: 'Public Bank', 'public bank': 'Public Bank', rhb: 'RHB Bank', 'hong leong': 'Hong Leong Bank', hlb: 'Hong Leong Bank',
    ambank: 'AmBank', 'am bank': 'AmBank', 'bank islam': 'Bank Islam', bimb: 'Bank Islam', 'bank rakyat': 'Bank Rakyat', bsn: 'BSN', 'bank simpanan nasional': 'BSN', affin: 'Affin Bank',
    alliance: 'Alliance Bank', muamalat: 'Bank Muamalat', ocbc: 'OCBC Bank', hsbc: 'HSBC Bank', uob: 'UOB', 'standard chartered': 'Standard Chartered', scb: 'Standard Chartered', agro: 'Agrobank', mbsb: 'MBSB Bank' };
  function matchBank(v, banks) {
    const n = norm(v).replace(/\b(berhad|bhd|malaysia)\b/g, '').trim();
    const exact = banks.find((b) => norm(b) === n); if (exact) return exact;
    const alias = Object.keys(BANK_ALIAS).sort((a, b) => b.length - a.length).find((k) => ` ${n} `.includes(` ${k} `) || n.replace(/ /g, '') === k.replace(/ /g, ''));
    return alias ? BANK_ALIAS[alias] : null;
  }
  // Formula injection: text that a spreadsheet would run (=, +, @, or - before a letter) loses those characters.
  const FORMULA = /^[=+@]|^-(?=[^\d\s.])/;
  function stripFormula(s) { return String(s).replace(/^[=+@\-\s]+/, ''); }

  // One cell → { value, warn?, error? }. value null means "not given" (an update keeps the current value).
  function cleanValue(field, raw, opt = {}) {
    if (isBlank(raw)) return { value: null };
    const f = fieldOf(field);
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : String(raw);
    const textKinds = ['text', 'name', 'dept', 'code'];
    if (textKinds.includes(f.kind) && typeof raw === 'string' && FORMULA.test(text)) {
      const v = stripFormula(text);
      return { ...cleanValue(field, v, opt), warn: `${f.label}: removed a leading “${text[0]}” (spreadsheet formula characters aren’t allowed)` };
    }
    switch (f.kind) {
      case 'name': return { value: titleName(text) };
      case 'text': return { value: text.slice(0, 300) };
      case 'dept': return { value: text.slice(0, 80) };
      case 'code': return { value: text.replace(/\s+/g, '').toUpperCase().slice(0, 40) };
      case 'email': {
        const v = text.toLowerCase().replace(/^mailto:/, '');
        return looks.email(v) ? { value: v } : { value: null, error: `${f.label} “${text}” isn’t a valid email` };
      }
      case 'phone': {
        if (/e\+/i.test(text)) return { value: null, error: `${f.label} is shown as ${text}: format the column as Text in Excel and export again` };
        const plus = text.trim().startsWith('+'); let d = digits(text);
        if (!d) return { value: null, warn: `${f.label} “${text}” has no digits` };
        if (d.startsWith('60')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1); else if (plus) return { value: `+${d}` };
        // Excel drops the leading 0 of 012-345 6789; put it back.
        if (/^1\d{8,9}$/.test(d) || /^[3-9]\d{7,8}$/.test(d)) return { value: `+60${d}` };
        return { value: text, warn: `${f.label} “${text}” doesn’t look like a Malaysian number; kept as it is` };
      }
      case 'ic': {
        if (/e\+/i.test(text)) return { value: null, error: `IC is shown as ${text}, so its last digits are lost. Format the IC column as Text in Excel and export again` };
        let d = typeof raw === 'number' ? String(Math.round(raw)).padStart(12, '0') : text.replace(/[\s-]/g, '');
        if (/^\d{11}$/.test(d)) d = '0' + d;                      // a 2000s IC typed as a number loses its leading 0
        if (/^\d{12}$/.test(d)) {
          const info = icInfo(d);
          if (!info.birthday) return { value: null, error: `IC ${maskIC(d)} has an impossible date of birth` };
          return { value: d, idType: 'mykad', ...info };
        }
        if (opt.passportOk && /^[A-Z0-9]{6,15}$/i.test(d) && /[A-Z]/i.test(d)) return { value: d.toUpperCase(), idType: 'passport' };
        return { value: null, error: `IC “${maskIC(d)}” must be 12 digits${opt.passportOk ? ' or a passport number' : ''}` };
      }
      case 'date': {
        const v = parseDate(raw, { order: opt.order, serials: true });
        return v ? { value: v } : { value: null, error: `${f.label} “${text}” isn’t a date we can read (use 31/12/2026 or 2026-12-31)` };
      }
      case 'money': {
        const s = text.replace(/rm|myr|,|\s/gi, '');
        if (!/^-?\d+(\.\d+)?$/.test(s)) return { value: null, error: `${f.label} “${text}” isn’t a number` };
        const n = Math.round(Number(s) * 100) / 100;
        if (n < 0) return { value: null, error: `${f.label} can’t be negative` };
        const monthly = f.key === 'salaryMonthly' ? n : n / 12;
        const warn = n > 0 && (monthly < 1000 || monthly > 100000) ? `${f.label} ${n.toLocaleString('en-MY')} looks unusual for a ${f.key === 'salaryMonthly' ? 'month' : 'year'}` : '';
        return { value: f.key === 'salaryMonthly' ? Math.round(n * 12 * 100) / 100 : n, warn };
      }
      case 'status': { const v = STATUS[norm(text)]; return v ? { value: v } : { value: 'Active', warn: `Status “${text}” isn’t known; set to Active` }; }
      case 'type': { const t = TYPES.find(([re]) => re.test(text)); return t ? { value: t[1] } : { value: 'Full-time', warn: `Employment type “${text}” isn’t known; set to Full-time` }; }
      case 'gender': { const v = GENDER[norm(text)]; return v ? { value: v } : { value: null, warn: `Gender “${text}” isn’t known; left blank` }; }
      case 'married': { const v = MARRIED[norm(text)]; return v === undefined ? { value: null, warn: `Marital status “${text}” isn’t known; left blank` } : { value: v }; }
      case 'bank': { const v = matchBank(text, opt.banks || []); return v ? { value: v } : { value: null, warn: `Bank “${text}” isn’t on the bank list; left blank` }; }
      case 'account': {
        if (/e\+/i.test(text)) return { value: null, error: `Bank account is shown as ${text}: format the column as Text in Excel and export again` };
        const d = typeof raw === 'number' ? String(Math.round(raw)) : digits(text);
        return d.length >= 6 && d.length <= 20 ? { value: d } : { value: null, warn: `Bank account “${maskAcct(d)}” doesn’t look right; left blank` };
      }
      default: return { value: text };
    }
  }

  // ---------- Masking for the screen (never log full values) ----------
  const maskIC = (s) => { const d = String(s || ''); return d.length >= 8 ? `${d.slice(0, 6)}-••-••${d.slice(-2)}` : d ? '••••' : ''; };
  const maskAcct = (s) => { const d = String(s || ''); return d.length > 4 ? `••••${d.slice(-4)}` : d ? '••••' : ''; };

  // ---------- Matching keys ----------
  const KEYS = { ic: (v) => String(v || '').replace(/[\s-]/g, '').toUpperCase(), staffNo: (v) => String(v || '').replace(/\s/g, '').toUpperCase(), email: (v) => String(v || '').trim().toLowerCase() };
  const KEY_LABEL = { ic: 'IC', staffNo: 'staff number', email: 'email' };
  // What an existing employee looks like in import terms, for comparing (so an unchanged export changes nothing).
  const fullName = (e) => [e.first, e.last].filter(Boolean).join(' ');
  function currentValue(e, key, deptName) {
    switch (key) {
      case 'name': return fullName(e);
      case 'dept': return deptName(e.dept);
      case 'salaryMonthly': case 'salaryAnnual': return Number(e.salary) || 0;
      case 'emergencyName': return e.emergency?.name || '';
      case 'emergencyPhone': return e.emergency?.phone || '';
      case 'emergencyRelation': return e.emergency?.relation || '';
      default: return e[key] ?? '';
    }
  }
  function same(key, a, b) {
    if (key === 'phone' || key === 'emergencyPhone') { const p = (x) => cleanValue('phone', x).value || String(x || ''); return p(a) === p(b); }
    if (key === 'ic') return KEYS.ic(a) === KEYS.ic(b);
    if (key === 'married') return !!a === !!b;
    if (typeof a === 'number' || typeof b === 'number') return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;
    return norm(a) === norm(b);
  }

  // ---------- The plan: every row cleaned, checked and matched ----------
  // grid: tidyGrid() output; headerIndex: which tidy row is the header; mapping: autoMap() output (possibly edited).
  // existing: current employees; departments: [{ id, name }]; mode: 'upsert' | 'add'; keys: matching order.
  function buildPlan({ grid, headerIndex, mapping, existing = [], departments = [], mode = 'upsert', keys = ['ic', 'staffNo', 'email'], banks = [], today }) {
    const data = grid.rows.slice(headerIndex + 1);
    const cols = mapping.filter((m) => m.field);
    const colValues = (key) => { const m = cols.find((c) => c.field === key); return m ? data.map((r) => r.cells[m.col]) : []; };
    const orders = Object.fromEntries(FIELDS().filter((f) => f.kind === 'date').map((f) => [f.key, dateOrder(colValues(f.key))]));
    const passportOk = cols.some((c) => ['nationality', 'passportNo'].includes(c.field) || /passport|pasport/i.test(c.header));
    const deptName = (id) => departments.find((d) => d.id === id)?.name || '';
    const deptByName = new Map(departments.map((d) => [norm(d.name), d]));
    const index = {}; keys.forEach((k) => { index[k] = new Map(); existing.forEach((e) => { const v = KEYS[k](e[k]); if (v) index[k].set(v, e); }); });
    const emailOwner = new Map(existing.filter((e) => e.email).map((e) => [KEYS.email(e.email), e]));
    const icOwner = new Map(existing.filter((e) => e.ic).map((e) => [KEYS.ic(e.ic), e]));
    const seen = { ic: new Map(), staffNo: new Map(), email: new Map() };
    const newDepts = new Map();
    const rows = data.map((r) => {
      const errors = [], warnings = [], v = {}, original = {};
      for (const c of cols) {
        original[c.header || `Column ${c.col + 1}`] = r.cells[c.col];
        const out = cleanValue(c.field, r.cells[c.col], { order: orders[c.field], passportOk, banks, today });
        if (out.error) errors.push(out.error);
        if (out.warn) warnings.push(out.warn);
        if (out.value != null) v[c.field] = out.value;
        if (c.field === 'ic' && out.value) { v.idType = out.idType; if (out.birthday) v._icBirthday = out.birthday; if (out.gender) v._icGender = out.gender; }
      }
      if (!v.name && (v.first || v.last)) v.name = titleName([v.first, v.last].filter(Boolean).join(' '));
      if (v._icBirthday && !v.birthday) v.birthday = v._icBirthday;
      if (v._icGender && !v.gender) v.gender = v._icGender;
      if (v._icBirthday && v.birthday && v.birthday !== v._icBirthday) warnings.push('Date of birth differs from the one in the IC');
      delete v._icBirthday; delete v._icGender;
      if (v.salaryMonthly != null) { v.salary = v.salaryMonthly; delete v.salaryMonthly; }
      if (v.salaryAnnual != null) { v.salary = v.salaryAnnual; delete v.salaryAnnual; }
      // Duplicates inside the file.
      for (const k of ['ic', 'staffNo', 'email']) {
        const key = v[k] && KEYS[k](v[k]); if (!key) continue;
        if (seen[k].has(key)) errors.push(`Same ${KEY_LABEL[k]} as row ${seen[k].get(key)}`);
        else seen[k].set(key, r.n);
      }
      // Match to an existing employee by the first key this row has.
      let match = null, by = '';
      for (const k of keys) { const key = v[k] && KEYS[k](v[k]); if (key && index[k].get(key)) { match = index[k].get(key); by = k; break; } }
      if (!match) {
        const e1 = v.email && emailOwner.get(KEYS.email(v.email)); if (e1) errors.push(`Email already belongs to ${fullName(e1)}`);
        const e2 = v.ic && icOwner.get(KEYS.ic(v.ic)); if (e2) errors.push(`IC already belongs to ${fullName(e2)}`);
      } else {
        const e1 = v.email && emailOwner.get(KEYS.email(v.email)); if (e1 && e1.id !== match.id) errors.push(`Email already belongs to ${fullName(e1)}`);
        // Matched by staff number or email, but the IC says it's someone else: never overwrite an IC silently.
        if (by !== 'ic' && v.ic && match.ic && KEYS.ic(v.ic) !== KEYS.ic(match.ic)) errors.push(`Matched ${fullName(match)} by ${KEY_LABEL[by]}, but the IC is different`);
      }
      // Department: an existing one by name, or a new one (created once, on confirmation).
      if (v.dept) { const d = deptByName.get(norm(v.dept)); if (d) v.deptId = d.id; else { newDepts.set(norm(v.dept), newDepts.get(norm(v.dept)) || v.dept); warnings.push(`New department “${v.dept}”`); } }
      let action, changes = {};
      if (match && mode === 'add') action = 'skip';
      else if (match) {
        for (const [k, val] of Object.entries(v)) { if (k === 'deptId' || k === 'idType') continue; if (!same(k === 'salary' ? 'salaryAnnual' : k, currentValue(match, k === 'salary' ? 'salaryAnnual' : k, deptName), val)) changes[k] = val; }
        if (changes.ic && v.idType) changes.idType = v.idType;
        action = errors.length ? 'error' : Object.keys(changes).length ? 'update' : 'same';
      } else {
        const need = [['name', 'Full name'], ['email', 'Work email'], ['role', 'Job title'], ['start', 'Start date']].filter(([k]) => !v[k]).map(([, l]) => l);
        if (need.length) errors.push(`Missing ${need.join(', ')}`);
        if (v.salary == null) warnings.push('No salary; set to 0');
        action = errors.length ? 'error' : 'add';
      }
      if (errors.length) action = 'error';
      const status = action === 'error' ? 'error' : warnings.length ? 'warning' : 'ready';
      return { n: r.n, status, action, errors, warnings, values: v, changes, matchId: match?.id || null, matchBy: by, matchName: match ? fullName(match) : '', original };
    });
    const counts = { add: 0, update: 0, same: 0, skip: 0, error: 0, warning: 0 };
    rows.forEach((x) => { counts[x.action]++; if (x.status === 'warning') counts.warning++; });
    return { rows, counts, newDepts: [...newDepts.values()] };
  }

  // ---------- Turning a row into employee fields ----------
  function toEmployee(v, base = {}) {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'name') {
        if (base.first !== undefined && norm(fullName(base)) === norm(val)) continue;
        Object.assign(out, splitName(val));
      } else if (k === 'emergencyName' || k === 'emergencyPhone' || k === 'emergencyRelation') {
        out.emergency = { ...(base.emergency || {}), ...(out.emergency || {}), [k.slice(9).toLowerCase()]: val };
      } else if (k === 'first' || k === 'last') { if (!v.name) out[k] = val; }
      else if (k === 'dept' || k === 'deptId') continue;
      else out[k] = val;
    }
    if (v.deptId) out.dept = v.deptId;
    return out;
  }

  // Apply a plan to a workspace ({ employees, departments }). Returns the import log, which also holds what undo
  // needs: the new ids, and for updated people only the fields that changed with their previous values.
  function applyPlan(ws, plan, { batchId, by, now = new Date().toISOString(), fileName = '', uid, newDeptColor = '#14958A', rows = plan.rows } = {}) {
    const log = { id: batchId, at: now, by, fileName, created: [], updated: [], depts: [], counts: { added: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, warnings: 0 } };
    const deptIds = new Map((ws.departments || []).map((d) => [norm(d.name), d.id]));
    for (const name of plan.newDepts) {
      if (deptIds.has(norm(name))) continue;
      const d = { id: uid('d-'), name, color: newDeptColor, importBatchId: batchId };
      ws.departments.push(d); deptIds.set(norm(name), d.id); log.depts.push(d.id);
    }
    for (const r of rows) {
      if (r.status === 'warning') log.counts.warnings++;
      if (r.action === 'error') { log.counts.errors++; continue; }
      if (r.action === 'skip') { log.counts.skipped++; continue; }
      if (r.action === 'same') { log.counts.unchanged++; continue; }
      const v = { ...r.values };
      if (v.dept && !v.deptId) v.deptId = deptIds.get(norm(v.dept));
      if (r.action === 'add') {
        const e = { id: uid('e'), cp22Filed: '', leaverFiled: '', type: 'Full-time', status: 'Active', salary: 0, phone: '', location: '', manager: '', ...toEmployee(v), createdAt: now, updatedAt: now, createdBy: by, importBatchId: batchId };
        if (!e.dept) e.dept = ws.departments[0]?.id || '';
        ws.employees.push(e); log.created.push(e.id); log.counts.added++;
      } else if (r.action === 'update') {
        const e = ws.employees.find((x) => x.id === r.matchId); if (!e) { log.counts.errors++; continue; }
        const patch = toEmployee({ ...r.changes, ...(r.changes.dept ? { deptId: v.deptId } : {}) }, e);
        if (!Object.keys(patch).length) { log.counts.unchanged++; continue; }
        const before = {};
        for (const k of [...Object.keys(patch), 'updatedAt', 'importBatchId']) before[k] = e[k] === undefined ? null : JSON.parse(JSON.stringify(e[k]));
        Object.assign(e, patch, { updatedAt: now, importBatchId: batchId });
        log.updated.push({ id: e.id, before }); log.counts.updated++;
      }
    }
    return log;
  }
  // Undo an import: remove the people it added, put back the fields it changed (later edits to those fields go), and
  // remove departments it created that are now empty. Returns what it did.
  function undoImport(ws, log) {
    const created = new Set(log.created);
    const before = ws.employees.length;
    ws.employees = ws.employees.filter((e) => !(created.has(e.id) && e.importBatchId === log.id));
    let restored = 0;
    for (const u of log.updated) {
      const e = ws.employees.find((x) => x.id === u.id); if (!e) continue;
      for (const [k, val] of Object.entries(u.before)) { if (val === null) delete e[k]; else e[k] = val; }
      restored++;
    }
    const used = new Set(ws.employees.map((e) => e.dept));
    ws.departments = ws.departments.filter((d) => !(log.depts.includes(d.id) && !used.has(d.id)));
    return { removed: before - ws.employees.length, restored };
  }

  // ---------- The export, template and error report share these headers ----------
  const EXPORT = [['staffNo', 'Staff no'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['role', 'Job title'], ['dept', 'Department'], ['status', 'Status'],
    ['type', 'Type'], ['location', 'Location'], ['start', 'Start date'], ['salaryAnnual', 'Annual salary'], ['ic', 'IC or passport number'], ['gender', 'Gender'],
    ['birthday', 'Date of birth'], ['epfNo', 'EPF number'], ['socsoNo', 'SOCSO number'], ['taxNo', 'Income tax number'], ['bank', 'Bank'], ['accountNo', 'Account number'],
    ['nationality', 'Nationality'], ['address', 'Address'], ['emergencyName', 'Emergency contact name'], ['emergencyPhone', 'Emergency contact phone']];
  // Cells a spreadsheet would treat as a formula get a leading apostrophe. Phone numbers (+60…) and negative
  // numbers are left as they are.
  const safeCell = (v) => { const s = v == null ? '' : String(v); return /^[=+@\-\t\r]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s) ? `'${s}` : s; };
  function exportRows(employees, deptName) {
    // ICs go out as 900101-14-5678 so Excel keeps them as text instead of 9.00101E+11.
    const cell = (e, k) => (k === 'gender' ? (e.gender ? e.gender[0].toUpperCase() + e.gender.slice(1) : '')
      : k === 'ic' && /^\d{12}$/.test(e.ic || '') ? `${e.ic.slice(0, 6)}-${e.ic.slice(6, 8)}-${e.ic.slice(8)}` : currentValue(e, k, deptName));
    return [EXPORT.map(([, h]) => h), ...employees.map((e) => EXPORT.map(([k]) => safeCell(cell(e, k))))];
  }
  function errorReport(plan, headers) {
    const head = ['Row', 'Problem', ...headers];
    const bad = plan.rows.filter((r) => r.action === 'error' || r.warnings.length);
    return [head, ...bad.map((r) => [r.n, [...r.errors, ...r.warnings].join('; '), ...headers.map((h) => safeCell(r.original[h] ?? ''))])];
  }

  return { norm, squash, tidyGrid, headerScore, detectHeaderRow, parseDate, dateOrder, contentGuess, autoMap, missingRequired, signature, cleanValue, titleName, splitName,
    icInfo, matchBank, maskIC, maskAcct, buildPlan, toEmployee, applyPlan, undoImport, exportRows, errorReport, safeCell, EXPORT, confidence };
})();
