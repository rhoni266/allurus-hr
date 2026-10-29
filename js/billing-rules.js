// Trials and subscriptions: a company's effective status from its dates (the same logic firestore.rules applies,
// so nothing waits for a daily job), the trial end (end of day 30, Malaysia time), the countdown banner, payment
// references and invoice numbers. Pure (no DOM), unit tested in tests/billing.test.js.
window.AllurusBilling = (function () {
  'use strict';
  const CFG = { trialDays: 30, graceDays: 7, keepDays: 90, tz: 'Asia/Kuala_Lumpur', tzOffsetMin: 480 };
  const DAY = 864e5;
  const ms = (t) => (t == null ? null : typeof t === 'number' ? t : t instanceof Date ? t.getTime() : typeof t.toMillis === 'function' ? t.toMillis() : t.seconds != null ? t.seconds * 1000 : Date.parse(t));
  // Midnight at the start of the Malaysian calendar day containing `at`, as a UTC millisecond time.
  const myDayStart = (at) => { const off = CFG.tzOffsetMin * 6e4; return Math.floor((ms(at) + off) / DAY) * DAY - off; };
  // The trial runs to the end of its 30th day in Malaysia: started on day 1, so it ends at 23:59:59.999 of day 30.
  const trialEnd = (start = Date.now(), days = CFG.trialDays) => new Date(myDayStart(start) + days * DAY - 1);
  // A Malaysian calendar date (YYYY-MM-DD) for display and references.
  const myDate = (at) => new Date(ms(at) + CFG.tzOffsetMin * 6e4).toISOString().slice(0, 10);

  // What a company can do now. Companies from before billing (no status) count as active.
  //   trial / active: normal · past_due: normal with a banner · expired: admins read and pay only, staff blocked
  //   suspended: everyone blocked · cancelled: admins export only
  function effective(c = {}, now = Date.now()) {
    const s = c.status || 'active', t = ms(now);
    if (s === 'suspended' || s === 'cancelled' || s === 'expired') return s;
    if (s === 'trial') return ms(c.trialEndsAt) != null && ms(c.trialEndsAt) < t ? 'expired' : 'trial';
    if (s === 'active' || s === 'past_due') {
      const paid = ms(c.paidUntil);
      if (paid == null) return s;
      if (paid >= t) return 'active';
      return paid + CFG.graceDays * DAY >= t ? 'past_due' : 'expired';
    }
    return s;
  }
  const ACCESS = {
    trial: { admin: 'full', staff: 'full' }, active: { admin: 'full', staff: 'full' }, past_due: { admin: 'full', staff: 'full' },
    expired: { admin: 'billing', staff: 'none' }, cancelled: { admin: 'export', staff: 'none' }, suspended: { admin: 'none', staff: 'none' },
  };
  const access = (status, isAdmin) => (ACCESS[status] || ACCESS.active)[isAdmin ? 'admin' : 'staff'];
  // When it stops: trial end, or the end of the grace period after paidUntil.
  function endsAt(c = {}, now = Date.now()) {
    const e = effective(c, now);
    if (e === 'trial') return ms(c.trialEndsAt);
    if (e === 'past_due') return ms(c.paidUntil) + CFG.graceDays * DAY;
    if (e === 'active') return ms(c.paidUntil);
    return null;
  }
  // Whole Malaysian days left, counting today: 1 means "ends today".
  const daysLeft = (end, now = Date.now()) => (end == null ? null : Math.max(0, Math.round((myDayStart(end) - myDayStart(now)) / DAY) + 1));
  // The banner for a company admin: null when nothing to say.
  function banner(c = {}, now = Date.now()) {
    const e = effective(c, now), end = endsAt(c, now), d = daysLeft(end, now);
    if (e === 'trial') return { level: d <= 3 ? 'red' : d <= 7 ? 'amber' : 'info', days: d, text: d <= 1 ? 'Your free trial ends today.' : `Your free trial ends in ${d} days.`, action: 'Subscribe' };
    if (e === 'past_due') return { level: 'red', days: d, text: `Payment overdue. Access stops in ${d} day${d === 1 ? '' : 's'} unless you pay.`, action: 'Pay now' };
    if (e === 'active' && d != null && d <= 7) return { level: 'amber', days: d, text: `Your subscription renews in ${d} day${d === 1 ? '' : 's'}.`, action: 'Pay now' };
    if (e === 'expired') return { level: 'red', days: 0, text: 'Your subscription has ended. Your data is safe; subscribe to continue.', action: 'Subscribe' };
    return null;
  }
  // When data may be deleted after expiry (never automatically), and how many days remain.
  function deletion(c = {}, now = Date.now()) {
    if (!['expired', 'cancelled'].includes(effective(c, now))) return null;
    const from = ms(c.expiredAt) ?? (c.status === 'trial' ? ms(c.trialEndsAt) : ms(c.paidUntil) != null ? ms(c.paidUntil) + CFG.graceDays * DAY : ms(now));
    const at = from + CFG.keepDays * DAY;
    return { at, days: daysLeft(at, now) };
  }
  // Bank-transfer reference: ALR-<company code>-<YYYYMM>. The code is the first 6 characters of the company id.
  const reference = (tenantId, at = Date.now()) => `ALR-${String(tenantId).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}-${myDate(at).slice(0, 7).replace('-', '')}`;
  const invoiceNo = (n, at = Date.now()) => `INV-${myDate(at).slice(0, 4)}-${String(n).padStart(5, '0')}`;
  // paidUntil after paying `months`: from the later of now and the current paidUntil, to the end of that day.
  function extendPaid(c = {}, months = 1, now = Date.now()) {
    const base = Math.max(ms(now), ms(c.paidUntil) || 0);
    const d = new Date(myDayStart(base) + CFG.tzOffsetMin * 6e4);
    d.setUTCMonth(d.getUTCMonth() + months);
    return new Date(d.getTime() - CFG.tzOffsetMin * 6e4 + DAY - 1);
  }
  // Disposable email domains refused at sign-up (the same list is in firestore.rules).
  const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com', 'mohmal.com', 'tempail.com', 'moakt.com'];
  const disposable = (email) => DISPOSABLE.includes(String(email).toLowerCase().split('@')[1] || '');
  // Malaysian mobile as digits with 60 in front, for the one-trial-per-phone check.
  const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '6' + d; else if (d.startsWith('1')) d = '60' + d; return /^601\d{8,9}$/.test(d) ? d : ''; };
  const TERMS_VERSION = '2026-10-29';
  return { CFG, DAY, ms, myDayStart, trialEnd, myDate, effective, access, endsAt, daysLeft, banner, deletion, reference, invoiceNo, extendPaid, DISPOSABLE, disposable, normPhone, TERMS_VERSION };
})();
