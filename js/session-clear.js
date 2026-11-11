// Sign-out clears everything that belongs to whoever was signed in on this browser: the remembered staff session
// (browser storage and cookie), any stored PIN or password, the local copy of the company's workspace, per-sign-in
// counters, and (with clearFirestoreCache) the Firestore offline cache, which holds the last person's documents.
// It keeps the PHONE's own identity (the device id used by the one-phone rule), because that is about the phone,
// not the person. Used by the app's sign-out and by the join page ("Sign out to register yourself").
// There is no stored password, PIN or token that could sign anyone in again: Firebase Auth's own session is the
// only thing that keeps someone signed in, and Auth.signOut() ends it.
(function (root) {
  'use strict';
  // Local data that belongs to the person (matched by name). The device ids (allurus_device_id, allurus-device-id,
  // the allurus_dev_id cookie) are deliberately not here.
  const PERSON_KEYS = [/^allurus_staff_session$/, /^allurus-hr-cloud-/, /^allurus[-_]?(staff[-_])?pin/i, /^allurus-signin-fails$/, /^allurus-activate-/, /^allurus_staff_token$/];
  const COOKIES = ['allurus_staff_token'];

  function expireCookie(name) {
    const host = (typeof location !== 'undefined' && location.hostname) || '';
    const bases = ['', `; domain=${host}`, host.includes('.') ? `; domain=.${host.split('.').slice(-2).join('.')}` : ''];
    bases.forEach((d) => { try { document.cookie = `${name}=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}; SameSite=Lax`; } catch (e) { /* blocked */ } });
  }
  // Everything local that belongs to the person. Returns the names removed (never their values).
  function clearLocal() {
    const removed = [];
    try {
      Object.keys(localStorage).filter((k) => PERSON_KEYS.some((re) => re.test(k))).forEach((k) => { localStorage.removeItem(k); removed.push(k); });
    } catch (e) { /* storage unavailable */ }
    try { sessionStorage.clear(); } catch (e) { /* storage unavailable */ }
    COOKIES.forEach(expireCookie);
    return removed;
  }
  // The Firestore offline cache keeps the last person's documents on this phone; a new person's queries must not be
  // answered from it. Needs the page to be reloaded afterwards (the app does that on sign-out).
  async function clearFirestoreCache(FS, db) {
    try { await FS.terminate(db); } catch (e) { /* not started */ }
    try { await FS.clearIndexedDbPersistence(db); } catch (e) { /* none, or still in use */ }
  }
  // Full sign-out for a page that has Firebase loaded: Firebase Auth, the Firestore cache, then the local data.
  async function signOutEverything({ Auth, auth, FS, db } = {}) {
    try { if (Auth && auth) await Auth.signOut(auth); } catch (e) { /* already signed out */ }
    clearLocal();
    if (FS && db) await clearFirestoreCache(FS, db);
    clearLocal();
  }
  // Is anything of a previous person still stored here? (Used by tests.) The device id doesn't count.
  function leftovers() {
    const out = [];
    try { Object.keys(localStorage).forEach((k) => { if (PERSON_KEYS.some((re) => re.test(k))) out.push(`localStorage:${k}`); }); } catch (e) { /* none */ }
    try { if (sessionStorage.length) out.push('sessionStorage'); } catch (e) { /* none */ }
    try { COOKIES.forEach((c) => { if (new RegExp(`(?:^|;\\s*)${c}=`).test(document.cookie)) out.push(`cookie:${c}`); }); } catch (e) { /* none */ }
    return out;
  }
  const api = { clearLocal, clearFirestoreCache, signOutEverything, leftovers, PERSON_KEYS };
  root.AllurusSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
