// Password rules for creating an Allurus password (/activate, and changing it later): at least 10 characters, not
// built from the person's email, name, IC or phone, not one of the 10,000 most common passwords, and (optionally)
// not seen in a data breach, checked with Have I Been Pwned's k-anonymity range API: only the first 5 characters
// of the password's SHA-1 leave the device. Pure checks (no DOM), unit tested in tests/password.test.js.
window.AllurusPassword = (function () {
  'use strict';
  const MIN = 10;
  const low = (s) => String(s || '').toLowerCase();
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const letters = (s) => low(s).replace(/[^a-z0-9]/g, '');

  // The parts of who someone is that a password must not be made of.
  function personalBits({ email = '', name = '', ic = '', phone = '' } = {}) {
    const local = low(email).split('@')[0];
    const words = [local, ...local.split(/[^a-z0-9]+/), ...low(name).split(/[^\p{L}\p{N}]+/u)].map(letters).filter((w) => w.length >= 3);
    const nums = [digits(ic), digits(ic).slice(0, 6), digits(ic).slice(-4), digits(phone), digits(phone).replace(/^60/, '0'), digits(phone).slice(-7)].filter((d) => d.length >= 4);
    return { words: [...new Set(words)], nums: [...new Set(nums)] };
  }

  // Each rule with whether it passes, for the live checklist. common: a Set of lower-case common passwords.
  function check(pw, who = {}, common = null) {
    const p = String(pw || ''), lp = low(p), flat = letters(p), bits = personalBits(who);
    const personal = bits.words.some((w) => flat.includes(w)) || bits.nums.some((d) => digits(p).includes(d)) || (who.email && lp === low(who.email));
    const rules = [
      { id: 'length', ok: p.length >= MIN, text: `At least ${MIN} characters` },
      { id: 'personal', ok: !!p && !personal, text: 'Not your email, name, IC or phone number' },
      { id: 'common', ok: !!p && !(common && (common.has(lp) || common.has(lp.replace(/[\d!@#$%^&*]+$/, '')))), text: 'Not a common password' },
      { id: 'varied', ok: !!p && new Set(p).size >= 5, text: 'Not the same few characters repeated' },
    ];
    return { ok: rules.every((r) => r.ok), rules };
  }

  async function sha1Hex(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  // How many times this password appears in known breaches (0 = not found), or null if the check couldn't run.
  async function breachCount(pw, fetchFn = (u) => fetch(u, { headers: { 'Add-Padding': 'true' } })) {
    try {
      const h = await sha1Hex(pw), prefix = h.slice(0, 5), suffix = h.slice(5);
      const res = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`);
      if (!res.ok) return null;
      const line = (await res.text()).split('\n').find((l) => l.startsWith(suffix));
      return line ? Number(line.split(':')[1]) || 0 : 0;
    } catch (e) { return null; }
  }
  let commonList = null;
  async function loadCommon(url = 'js/vendor/common-passwords.txt') {
    if (commonList) return commonList;
    try { const t = await (await fetch(url)).text(); commonList = new Set(t.split('\n').map((x) => x.trim()).filter(Boolean)); } catch (e) { commonList = new Set(); }
    return commonList;
  }
  function checkPin(pin, who = {}) {
    const p = String(pin || '').trim();
    if (!/^[0-9]{6}$/.test(p)) {
      return { ok: false, error: 'PIN must be exactly 6 digits (numbers only).' };
    }
    if (/^(\d)\1{5}$/.test(p)) {
      return { ok: false, error: 'PIN cannot be the same digit repeated (like 111111).' };
    }
    const seq = '0123456789012345', rev = '9876543210987654';
    if (seq.includes(p) || rev.includes(p)) {
      return { ok: false, error: 'PIN cannot be sequential digits (like 123456).' };
    }
    const ic = digits(who.ic || '');
    if (ic.length >= 6) {
      const yymmdd = ic.slice(0, 6);
      const ddmmyy = ic.slice(4, 6) + ic.slice(2, 4) + ic.slice(0, 2);
      const last6 = ic.slice(-6);
      if (p === yymmdd || p === ddmmyy) {
        return { ok: false, error: 'PIN cannot be your birth date from your IC.' };
      }
      if (p === last6) {
        return { ok: false, error: 'PIN cannot be the last 6 digits of your IC.' };
      }
    }
    const ph = digits(who.phone || '');
    if (ph.length >= 6 && ph.slice(-6) === p) {
      return { ok: false, error: 'PIN cannot be the last 6 digits of your phone number.' };
    }
    return { ok: true };
  }

  return { MIN, check, checkPin, personalBits, breachCount, loadCommon, sha1Hex };
})();
