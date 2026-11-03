// Employee sign-in access: whether someone is Not invited, Invited, Expired, Active or Disabled, from their
// invites/{email} record and users/{uid} profile, and when an invitation runs out. Pure (no DOM), unit tested in
// tests/invite.test.js. The rules that enforce it are in firestore.rules (users and invites).
window.AllurusInvite = (function () {
  'use strict';
  const DAYS = 7;
  const ms = (t) => (t == null ? null : typeof t === 'number' ? t : t instanceof Date ? t.getTime() : typeof t.toMillis === 'function' ? t.toMillis() : t.seconds != null ? t.seconds * 1000 : Date.parse(t));
  const expiry = (from = Date.now()) => new Date(ms(from) + DAYS * 864e5);
  const LABEL = { none: ['Not invited', ''], invited: ['Invited', 'info'], expired: ['Invitation expired', 'warn'], active: ['Active', 'ok'], disabled: ['Disabled', 'bad'], pending: ['Waiting for approval', 'warn'] };
  // user: the person's profile (users/{uid}) if they have one; invite: invites/{email} if one is waiting.
  function status({ user = null, invite = null, now = Date.now() } = {}) {
    let key = 'none';
    if (user) key = user.disabled ? 'disabled' : 'active';
    else if (invite) key = ms(invite.expiresAt) != null && ms(invite.expiresAt) < ms(now) ? 'expired' : 'invited';
    const [label, pill] = LABEL[key];
    return { key, label, pill, sentAt: invite ? ms(invite.sentAt || invite.invitedAt) : null, expiresAt: invite ? ms(invite.expiresAt) : null, uid: user?.uid || null };
  }
  // Whether this invitation still lets someone activate.
  const usable = (invite, now = Date.now()) => !!invite && ms(invite.expiresAt) != null && ms(invite.expiresAt) > ms(now);
  // The company code in the activation link: the tenant id, which is not secret (it identifies, never authorises).
  const link = (origin, tenantId) => `${origin}/activate?c=${encodeURIComponent(tenantId)}`;
  // A work email is optional. When given it must look like an email and belong to nobody else in the company;
  // two people with no email are fine. Returns the problem in words, or ''.
  function emailProblem(email, employees = [], selfId = '') {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return `“${String(email).trim()}” isn’t a valid email.`;
    const other = employees.find((x) => x.id !== selfId && String(x.email || '').trim().toLowerCase() === e);
    return other ? `${e} already belongs to ${`${other.first || ''} ${other.last || ''}`.trim() || 'someone else'}.` : '';
  }

  // ---------- Bulk invite by IC (Settings → Team access) ----------
  // Every word the bulk screens show, in one place so Bahasa Malaysia can be added.
  const IC_TEXT = {
    hasEmail: 'Has an email: use Send invitation', noIc: 'IC missing', badIc: 'IC not valid',
    invited: 'Already invited (link still valid)', joined: 'Already joined', disabled: 'Access turned off',
    inactive: 'Not an active employee', self: 'That’s you', pending: 'Registered, waiting for your approval',
    filters: { all: 'All', none: 'Not registered', invited: 'Link sent', expired: 'Expired', pending: 'Waiting for approval', joined: 'Registered' },
    // The open join page (allurus.my/join): one message for every mismatch, so nobody learns which part was wrong.
    noMatch: 'We could not match these details. Check with HR.', closed: 'Registration is closed. Ask your HR.',
    joinMessage: 'Join {company} on Allurus: {address}. You will need the company code {code}, the join key HR gave you (if any) and your IC number. HR checks each registration before you can use the app. Registration closes on {date}.',
    warn: 'These links let someone join as that person. Send each link only to that person. Close this window when done; links are not shown again. You can make a new link any time.',
    remind: 'Links last 7 days. Send each link only to that person.',
  };
  const validIc = (ic) => /^\d{12}$/.test(String(ic || '').replace(/[\s-]/g, ''));
  // Who a bulk IC invite would reach. statusOf(e) → { key: none | invited | expired | joined | disabled }.
  // Expired links get a new one; anyone invited (link still valid), joined or turned off is left alone.
  function icEligibility(employees, statusOf, meId = '') {
    const invite = [], skipped = [];
    const skip = (emp, reason) => skipped.push({ emp, reason });
    (employees || []).forEach((e) => {
      if (!e) return;
      if (e.id === meId) return skip(e, IC_TEXT.self);
      if (e.status && e.status !== 'Active') return skip(e, IC_TEXT.inactive);
      if (String(e.email || '').trim()) return skip(e, IC_TEXT.hasEmail);
      if (!String(e.ic || '').trim()) return skip(e, IC_TEXT.noIc);
      if (!validIc(e.ic)) return skip(e, IC_TEXT.badIc);
      const k = statusOf(e)?.key || 'none';
      if (k === 'none' || k === 'expired') invite.push(e);
      else skip(e, k === 'invited' ? IC_TEXT.invited : k === 'joined' ? IC_TEXT.joined : k === 'pending' ? IC_TEXT.pending : IC_TEXT.disabled);
    });
    return { invite, skipped };
  }
  // The registration tracker: counts of IC staff (no email, valid IC) by status, and "registered" = joined.
  function icCounts(employees, statusOf) {
    const c = { total: 0, none: 0, invited: 0, expired: 0, pending: 0, joined: 0, disabled: 0 };
    (employees || []).forEach((e) => {
      if (!e || (e.status && e.status !== 'Active') || String(e.email || '').trim() || !validIc(e.ic)) return;
      const k = statusOf(e)?.key || 'none';
      c.total++; c[k in c ? k : 'none']++;
    });
    return c;
  }
  // HR's daily in-app reminder: IC staff whose link was sent more than `days` days ago and not used, or expired.
  function icReminder(employees, statusOf, now = Date.now(), days = 3) {
    const late = [], expired = [];
    (employees || []).forEach((e) => {
      if (!e || (e.status && e.status !== 'Active') || String(e.email || '').trim() || !validIc(e.ic)) return;
      const s = statusOf(e) || {};
      if (s.key === 'expired') expired.push(e);
      else if (s.key === 'invited' && s.sentAt != null && ms(now) - ms(s.sentAt) > days * 864e5) late.push(e);
    });
    return { late, expired, due: late.length + expired.length > 0 };
  }
  // A warning for a weak company join key ('' if it looks fine). HR may still keep it after confirming.
  const WEAK = ['password', 'katalaluan', 'allurus', 'welcome', 'selamat', 'qwerty', 'abc123', 'admin', 'staff', 'pekerja', 'company', 'syarikat', 'join', 'daftar', '123456', '12345678'];
  function joinKeyWarning(key, company = '') {
    const k = String(key || '').trim(), low = k.toLowerCase(), co = String(company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k) return 'Type a join key.';
    if (k.length < 8) return 'This key is short (under 8 characters), so it is easy to guess.';
    if (/^\d+$/.test(k) || /^(.)\1+$/.test(k)) return 'This key is only digits or one repeated character, so it is easy to guess.';
    if (WEAK.some((w) => low.includes(w)) || (co.length >= 3 && low.replace(/[^a-z0-9]/g, '').includes(co.slice(0, 6)))) return 'This key contains a common word or the company name, so it is easy to guess.';
    return '';
  }
  // "Copy all": one block, a line per person (name, phone, link), with the warning first.
  const icCopyAll = (rows) => [IC_TEXT.warn, '', ...rows.map((r) => [r.name, r.phone || 'No phone', r.url].join(' · '))].join('\n');

  // Runs a bulk IC invite one person at a time, in order. make(e) → { ok, url, code } or { error }; recheck(e) →
  // true if the person still needs a link (read just before, so a retry never makes a second one); stop() → true
  // to cancel between people. A second run while one is going is refused ({ busy: true }), so a double click does
  // nothing. Links are only returned, never logged.
  function icBatch() {
    let running = false;
    return {
      get running() { return running; },
      async run(list, { make, recheck = async () => true, stop = () => false, progress = () => {} } = {}) {
        if (running) return { busy: true };
        running = true;
        const made = [], failed = [], skipped = [];
        let cancelled = false;
        try {
          for (let i = 0; i < list.length; i++) {
            if (stop()) { cancelled = true; break; }
            const e = list[i];
            let still = false;
            try { still = await recheck(e); } catch (x) { still = false; }
            if (!still) skipped.push({ emp: e, reason: IC_TEXT.invited });
            else {
              let r;
              try { r = await make(e); } catch (x) { r = { error: 'Couldn’t save the invitation.' }; }
              if (r?.ok) made.push({ emp: e, url: r.url, code: r.code, expiresAt: r.expiresAt });
              else failed.push({ emp: e, reason: r?.error || 'Couldn’t save the invitation.' });
            }
            progress(i + 1, list.length);
          }
        } finally { running = false; }
        return { made, failed, skipped, cancelled, left: list.length - made.length - failed.length - skipped.length };
      },
    };
  }

  return { DAYS, status, usable, expiry, link, ms, LABEL, emailProblem, IC_TEXT, icEligibility, icCounts, icReminder, icCopyAll, icBatch, joinKeyWarning };
})();
