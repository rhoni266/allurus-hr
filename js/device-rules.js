// Who may use Allurus on which device (docs/DEVICE-RULES-SPEC.md). Pure: no DOM, unit tested in
// tests/device-rules.test.js.
//
// Admin roles (anyone with 'admin' in roles) use a computer or a phone. Employees use a phone; on a computer (and on a
// tablet, unless the company allows tablets) they see "Please use your phone" and nothing else, unless HR allowed
// that person on a computer. The company can switch the rule off (Settings → Security).
//
// Honest limit: this is decided in the browser, so someone who knows how can make a computer look like a phone. It is
// a policy and a convenience, not a security wall: what a person can see is still decided by their role and the
// Firestore rules.
(function (root) {
  'use strict';
  // 'phone' | 'tablet' | 'computer'. env: { ua, mobile (navigator.userAgentData.mobile), touch (maxTouchPoints),
  // short (the shorter side of the screen in CSS px) }.
  function kind({ ua = '', mobile, touch = 0, short = 9999 } = {}) {
    if (mobile === true) return 'phone';
    if (/iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua))) return 'phone';
    if (/iPad/.test(ua) || /Android/.test(ua)) return 'tablet';
    // iPadOS asks for the desktop site with a Mac user agent; only touch gives it away.
    const touchy = touch > 1;
    // A phone asking for the desktop site: desktop user agent, but touch and a small screen.
    if (touchy && short <= 500) return 'phone';
    if (/Macintosh/.test(ua) && touchy) return 'tablet';
    return 'computer';
  }
  // This browser, read once.
  function here() {
    const n = typeof navigator !== 'undefined' ? navigator : {}, s = typeof screen !== 'undefined' ? screen : {};
    return kind({ ua: n.userAgent || '', mobile: n.userAgentData ? n.userAgentData.mobile : undefined, touch: n.maxTouchPoints || 0, short: Math.min(s.width || 9999, s.height || 9999) });
  }
  // The company setting (tenants/{t}.staffDevices): phonesOnly defaults ON, tablets OFF.
  const policy = (co) => ({ phonesOnly: co?.staffDevices?.phonesOnly !== false, tablets: co?.staffDevices?.tablets === true });
  // May this person use Allurus on this device? profile: { roles, allowComputer }.
  function allowed(profile, device, co) {
    if (!profile) return true;
    if ((profile.roles || []).includes('admin')) return true;
    const p = policy(co);
    if (!p.phonesOnly || profile.allowComputer === true) return true;
    if (device === 'phone') return true;
    return device === 'tablet' && p.tablets;
  }
  // The words on the "Please use your phone" screen, English and Bahasa Malaysia.
  const TEXT = {
    en: { title: 'Please use your phone', how: 'Open allurus.my/app on your phone and sign in with your company code and IC, or your email.', scan: 'Scan to open on your phone', none: 'No phone? Ask HR to allow this computer for you.', out: 'Sign out', joined: 'Now open allurus.my/app on your phone.' },
    ms: { title: 'Sila guna telefon anda', how: 'Buka allurus.my/app di telefon anda dan log masuk dengan kod syarikat dan IC, atau e-mel anda.', scan: 'Imbas untuk buka di telefon', none: 'Tiada telefon? Minta HR benarkan komputer ini untuk anda.', out: 'Log keluar', joined: 'Sekarang buka allurus.my/app di telefon anda.' },
  };
  const APP_URL = 'https://allurus.my/app';
  const api = { kind, here, policy, allowed, TEXT, APP_URL };
  root.AllurusDevice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
