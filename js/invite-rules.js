// Employee sign-in access: whether someone is Not invited, Invited, Expired, Active or Disabled, from their
// invites/{email} record and users/{uid} profile, and when an invitation runs out. Pure (no DOM), unit tested in
// tests/invite.test.js. The rules that enforce it are in firestore.rules (users and invites).
window.AllurusInvite = (function () {
  'use strict';
  const DAYS = 7;
  const ms = (t) => (t == null ? null : typeof t === 'number' ? t : t instanceof Date ? t.getTime() : typeof t.toMillis === 'function' ? t.toMillis() : t.seconds != null ? t.seconds * 1000 : Date.parse(t));
  const expiry = (from = Date.now()) => new Date(ms(from) + DAYS * 864e5);
  const LABEL = { none: ['Not invited', ''], invited: ['Invited', 'info'], expired: ['Invitation expired', 'warn'], active: ['Active', 'ok'], disabled: ['Disabled', 'bad'] };
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
  return { DAYS, status, usable, expiry, link, ms, LABEL, emailProblem };
})();
