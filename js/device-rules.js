// Who may use Allurus on which device (docs/DEVICE-RULES-SPEC.md, replaced in part by docs/ONE-PHONE-SPEC.md). Pure:
// no DOM, unit tested in tests/device-rules.test.js.
//
// Everyone may sign in on a laptop, PC or tablet (no check-in there). On a PHONE, each person uses one registered
// phone only (phoneAccess below); any other phone waits for HR. A company can still switch on "staff use phones
// only" (default OFF now): then staff on a computer or tablet see "Please use your phone", unless HR allowed that
// person on a computer.
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
  // phonesOnly is OFF unless a company explicitly set it on; a person's first phone is approved automatically unless the
  // company turns that off (autoFirst).
  const policy = (co) => ({ phonesOnly: co?.staffDevices?.phonesOnly === true, tablets: co?.staffDevices?.tablets === true, autoFirst: co?.staffDevices?.autoFirst !== false });
  // May this person use Allurus on this device? profile: { roles, allowComputer }.
  function allowed(profile, device, co) {
    if (!profile) return true;
    if ((profile.roles || []).includes('admin')) return true;
    const p = policy(co);
    if (!p.phonesOnly || profile.allowComputer === true) return true;
    if (device === 'phone') return true;
    return device === 'tablet' && p.tablets;
  }
  // One phone per person (docs/ONE-PHONE-SPEC.md). devices: [{ id, name, status: 'approved'|'pending'|'retired'|'removed',
  // added, lastUsed }]; thisPhoneId: the id kept in this browser. → 'ok' | 'first' | 'pending' | 'other'
  //   ok       not a phone (a computer or tablet is not checked), or this is the person's approved phone
  //   first    no approved phone yet: register this one (approved at once if policy.autoFirst, else pending)
  //   pending  this phone was asked for and HR hasn't approved it yet
  //   other    they already have an approved phone and this isn't it
  function phoneAccess({ device, thisPhoneId, devices = [], policy: pol = {} } = {}) {
    if (device !== 'phone') return 'ok';
    const live = (devices || []).filter((d) => d && d.status !== 'retired' && d.status !== 'removed');
    const approved = live.filter((d) => d.status === 'approved');
    if (approved.some((d) => d.id === thisPhoneId)) return 'ok';
    if (live.some((d) => d.status === 'pending' && d.id === thisPhoneId)) return 'pending';
    return approved.length ? 'other' : 'first';
  }
  // A person's first phone: approved at once ('approved') or waiting for someone else ('pending'). Never automatic for an
  // account with an admin role, whatever the company setting (incident 2026-11-11): an admin's phone is approved by
  // another admin, or by the Owner with their password again.
  const firstPhoneStatus = ({ policy: pol = {}, roles = [] } = {}) => ((roles || []).includes('admin') ? 'pending' : pol.autoFirst === false ? 'pending' : 'approved');
  // The words on the "Please use your phone" screen, English and Bahasa Malaysia.
  const TEXT = {
    en: { phonePending: 'Waiting for HR to approve this phone', phoneOther: 'This isn’t your registered phone', phoneUse: 'Use this phone instead', phoneAsked: 'Asked. HR will approve it, then you can use this phone.', title: 'Please use your phone', how: 'Open allurus.my/app on your phone and sign in with your company code and IC, or your email.', scan: 'Scan to open on your phone', none: 'No phone? Ask HR to allow this computer for you.', out: 'Sign out', joined: 'Now open allurus.my/app on your phone.' },
    ms: { phonePending: 'Menunggu kelulusan HR untuk telefon ini', phoneOther: 'Ini bukan telefon berdaftar anda', phoneUse: 'Guna telefon ini sebaliknya', phoneAsked: 'Permintaan dihantar. HR akan meluluskannya, kemudian anda boleh guna telefon ini.', title: 'Sila guna telefon anda', how: 'Buka allurus.my/app di telefon anda dan log masuk dengan kod syarikat dan IC, atau e-mel anda.', scan: 'Imbas untuk buka di telefon', none: 'Tiada telefon? Minta HR benarkan komputer ini untuk anda.', out: 'Log keluar', joined: 'Sekarang buka allurus.my/app di telefon anda.' },
  };
  const APP_URL = 'https://allurus.my/app';
  const api = { kind, here, policy, allowed, phoneAccess, firstPhoneStatus, TEXT, APP_URL };
  root.AllurusDevice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
