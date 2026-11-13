// Simple staff phone screen (docs/SIMPLE-STAFF-HOME-SPEC.md). Pure: no DOM, unit tested in tests/simple-home.test.js.
// The four attendance meters use the existing day figures from js/roster.js (which come from js/attendance-rules.js): this file
// only counts them. It never works out lateness itself.
(function (root) {
  'use strict';

  // ---------- Which screen ----------
  // On only when the company has the add-on (set by the owner's command), the Settings switch is not off, the person has
  // no admin role, and the device is a phone. Anything else keeps the normal Home.
  function useSimple({ addon, setting, roles = [], phone }) {
    return addon === true && setting !== false && !(roles || []).includes('admin') && !!phone;
  }
  // The PDF password switch: default on wherever the simple screen is available, off only when HR turns it off.
  const pdfPasswordOn = ({ addon, setting }) => addon === true && setting !== false;

  // ---------- Payslip file and password ----------
  // The password is the IC without dashes (12 digits) or, for a foreign worker, the passport as recorded in upper case.
  // No IC on record → null: the app then refuses to make an unprotected file (when the switch is on).
  function pdfPassword(e) {
    const raw = String(e?.ic ?? '').trim();
    if (!raw) return null;
    if (e.idType === 'passport') { const p = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase(); return p || null; }
    const d = raw.replace(/\D/g, '');
    return d.length === 12 ? d : null;
  }
  // Payslip-2026-10-Ali.pdf: the month and the first name only. Never the IC, the company or an id.
  function payslipFileName(first, month) {
    const w = String(first || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean)[0] || 'Staff';
    const clean = w.replace(/[^A-Za-z0-9]/g, '') || 'Staff';
    return `Payslip-${String(month).slice(0, 7)}-${clean.charAt(0).toUpperCase()}${clean.slice(1).toLowerCase()}.pdf`;
  }

  // ---------- The four meters ----------
  // days: the person's days of one month, each { day, rec, type, leave, pattern, ev } as js/roster.js dayInfo returns.
  // Only working days count: leave days, public holidays and rest days are left out of all four meters. Today counts for
  // "late" once the person has checked in, and for "short hours" only after check-out; it is never counted absent.
  const WORKED = ['present', 'remote'];
  const shiftLen = (p) => {
    if (!p) return null;
    const m = (hm) => { const [h, mi] = String(hm).split(':').map(Number); return h * 60 + mi; };
    if (p.flexible) return (Number(p.hours) || 8) * 60;
    let s = m(p.start), e = m(p.end); if (e <= s) e += 1440; return e - s - (Number(p.breakMin) || 0);
  };
  // Minutes short on a finished day: left before the shift end, or worked less than the shift length (minus the break), not
  // counting lateness that is already shown as "late".
  function shortMinutes(x) {
    if (!x.rec?.out || !x.ev) return 0;
    const need = shiftLen(x.pattern);
    return Math.max(x.ev.early || 0, x.ev.short || 0, need == null ? 0 : Math.max(0, need - (x.ev.worked || 0) - (x.ev.lateRaw || 0)));
  }
  function meters(days, { today }) {
    const out = { onTime: { days: 0 }, late: { days: 0, min: 0 }, absent: { days: 0 }, short: { days: 0, min: 0 }, counted: 0, list: [] };
    (days || []).forEach((x) => {
      if (x.day > today) return;
      const worked = !!(x.rec && x.rec.in && WORKED.includes(x.rec.s));
      const item = { day: x.day, in: x.rec?.in || '', out: x.rec?.out || '', status: '' };
      if (x.leave) { item.status = 'leave'; out.list.push(item); return; }
      if (x.type === 'holiday') { item.status = 'holiday'; out.list.push(item); return; }
      if (x.type !== 'normal') { if (worked) { item.status = 'extra'; out.list.push(item); } return; }
      const isToday = x.day === today;
      if (!worked) {
        if (isToday) { item.status = 'today'; out.list.push(item); return; }
        out.absent.days++; out.counted++; item.status = 'absent'; out.list.push(item); return;
      }
      out.counted++;
      const late = x.ev?.late || 0;
      if (late > 0) { out.late.days++; out.late.min += late; item.status = 'late'; item.min = late; } else { out.onTime.days++; item.status = 'ontime'; }
      const sm = shortMinutes(x);
      if (sm > 0) { out.short.days++; out.short.min += sm; item.short = sm; }
      out.list.push(item);
    });
    out.list.sort((a, b) => b.day.localeCompare(a.day));
    return out;
  }
  // "1h 10m", "23 min", "0 min"
  const fmtMin = (m) => { m = Math.round(m || 0); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`; };
  // The share of the counted days for a bar, 0–100.
  const pct = (n, of) => (of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0);

  // ---------- Today and the week (docs/PHONE-HOME-ATTENDANCE-SPEC.md) ----------
  // One word per day, from the same day figures as the meters (which come from js/attendance-rules.js, with each shift's own
  // grace). Absent only on a scheduled working day, after the shift has ended, with no check-in and no approved leave.
  // x = a dayInfo; now = { day, hm } in Asia/Kuala_Lumpur; ended(x) says whether that day's shift is over (AllurusTimeRules.shiftEnded).
  // Returns { status, min }: ontime | late | absent | leave | rest | holiday | notyet | none (a day still to come).
  function dayStatus(x, now, ended) {
    if (x.day > now.day) return { status: 'none', min: 0 };
    if (x.leave) return { status: 'leave', min: 0 };
    if (x.type === 'holiday') return { status: 'holiday', min: 0 };
    const worked = !!(x.rec && x.rec.in && WORKED.includes(x.rec.s));
    if (worked) { const late = x.ev?.late || 0; return late > 0 ? { status: 'late', min: late } : { status: 'ontime', min: 0 }; }
    if (x.type !== 'normal') return { status: 'rest', min: 0 };
    return ended(x) ? { status: 'absent', min: 0 } : { status: 'notyet', min: 0 };
  }
  // The Monday to Sunday week that holds `day`.
  function weekOf(day) {
    const d = new Date(`${day}T00:00:00Z`), back = (d.getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, i) => new Date(d.getTime() + (i - back) * 86400000).toISOString().slice(0, 10));
  }
  // "8:42 am" from "08:42"
  function time12(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); if (!m) return '';
    const h = +m[1]; return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
  }
  // The date and clock in Asia/Kuala_Lumpur, whatever the phone's own zone says.
  function nowKL(date = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
  }

  // ---------- Language ----------
  // The company's default (settings.staffApp.lang), then the person's own choice, which wins. Anything else is English.
  const pickLang = (company, own) => (own === 'bm' || own === 'en' ? own : company === 'bm' ? 'bm' : 'en');
  // Leave days in BM are "2 hari", never "2 h".
  const daysWord = (n, lang) => `${n} ${lang === 'bm' ? 'hari' : n === 1 ? 'day' : 'days'}`;

  const api = { useSimple, pdfPasswordOn, pdfPassword, payslipFileName, meters, shortMinutes, shiftLen, fmtMin, pct, dayStatus, weekOf, time12, nowKL, pickLang, daysWord };
  root.AllurusSimpleHome = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
