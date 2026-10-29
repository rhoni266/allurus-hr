// allurus.my/activate: an invited employee's first sign-in.
//   1. They enter their work email; Firebase emails a one-time sign-in link (the same neutral message whether or not
//      the email was invited, so nobody can find out who works where).
//   2. Opening the link proves the inbox is theirs. On another device they type the email again.
//   3. With a valid, unexpired invitation they create a password (rules shown live, checked again before saving).
//   4. Their profile is created from the invitation (firestore.rules allows nothing else), the password is set,
//      and the app opens signed in. Strangers and expired or cancelled invitations get a clear message and their
//      empty sign-in is removed.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth, FS] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
const fb = initializeApp(window.ALLURUS_FIREBASE);
const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);
const I = window.AllurusInvite, P = window.AllurusPassword;
const EMAIL_KEY = 'allurus-activate-email', SENT_KEY = 'allurus-activate-sent', COOLDOWN = 60;
const root = document.getElementById('ac');
const company = new URLSearchParams(location.search).get('c') || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = (s) => String(s || '').trim().toLowerCase();
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } } };
const MARK = '<svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0F766E"/><path d="M19 47 L32 17 L45 47" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 37.5 Q32 32 40.5 37.5" fill="none" stroke="#D9B66F" stroke-width="4.5" stroke-linecap="round"/></svg>';

function page(title, sub, card) {
  root.innerHTML = `<div class="login-inner"><div class="login-brand">${MARK}</div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="login-card">${card}</div>
    <p class="faint" style="font-size:12.5px">Already set up? <a href="/app">Sign in</a></p></div>`;
  root.querySelector('input')?.focus();
}
const problem = (title, text, action = '<a class="btn btn-primary login-submit" href="/activate">Start again</a>') => page(esc(title), '', `<p class="login-error" role="alert">${text}</p>${action}`);

// ---------- Screen 1: enter email ----------
function emailScreen(msg = '') {
  page('Activate your account', 'Use the work email your company registered for you. We’ll email you a sign-in link.', `
    <form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
      <p class="ac-step">Step 1 of 3</p>
      <div class="field"><label for="em">Work email</label><input class="input" id="em" name="email" type="email" autocomplete="username" inputmode="email" required value="${esc(store.get(EMAIL_KEY) || '')}"></div>
      ${msg}
      <button class="btn btn-primary login-submit" type="submit" id="go">Send link</button>
    </form>`);
  const f = document.getElementById('f');
  cooldown(document.getElementById('go'), 'Send link');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = lower(f.email.value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { emailScreen('<p class="login-error" role="alert">Enter a valid email address.</p>'); return; }
    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await Auth.sendSignInLinkToEmail(auth, email, { url: I.link(location.origin, company), handleCodeInApp: true });
    } catch (e) {
      if (e?.code === 'auth/too-many-requests' || e?.code === 'auth/quota-exceeded') { emailScreen('<p class="login-error" role="alert">Too many requests. Wait a few minutes and try again.</p>'); return; }
      if (e?.code === 'auth/network-request-failed') { emailScreen('<p class="login-error" role="alert">You seem to be offline. Check your connection and try again.</p>'); return; }
      console.warn('[activate] send link', e?.code);   // other errors are not shown: the reply is always the same
    }
    store.set(EMAIL_KEY, email); store.set(SENT_KEY, String(Date.now()));
    sentScreen();
  });
}
// The resend button waits 60 seconds between links (Firebase also limits how often it sends).
function cooldown(btn, label) {
  if (!btn) return;
  const tick = () => {
    const left = COOLDOWN - Math.floor((Date.now() - (+store.get(SENT_KEY) || 0)) / 1000);
    if (left > 0) { btn.disabled = true; btn.textContent = `${label} again in ${left}s`; setTimeout(tick, 1000); } else { btn.disabled = false; btn.textContent = label; }
  };
  tick();
}
function sentScreen() {
  page('Check your email', '', `<p class="ac-ok" role="status">If this email was registered by your company, we’ve sent a sign-in link to it. Open the link on this phone or computer to continue. It works once and expires soon.</p>
    <p class="ac-note">Can’t find it? Look in Spam or Promotions. The email comes from Allurus and says “Sign in”.</p>
    <button type="button" class="btn login-submit" id="again">Send link</button>`);
  const b = document.getElementById('again'); cooldown(b, 'Send link'); b.addEventListener('click', () => emailScreen());
}

// ---------- Screen 2: the link was opened ----------
async function fromLink() {
  // Nothing is used up until the person presses Continue, so an email scanner opening the link first does no harm.
  // On another device they type the email the link was sent to.
  const known = store.get(EMAIL_KEY) || '';
  page('Activate your account', known ? 'Press Continue to set up your account.' : 'For your security, type the work email this invitation was sent to.', `<form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
    <p class="ac-step">Step 2 of 3</p>
    <div class="field"><label for="em">Work email</label><input class="input" id="em" name="email" type="email" autocomplete="username" inputmode="email" required value="${esc(known)}"></div>
    <button class="btn btn-primary login-submit" type="submit">Continue</button></form>`);
  const email = await new Promise((ok) => document.getElementById('f').addEventListener('submit', (ev) => { ev.preventDefault(); ok(lower(ev.target.email.value)); }));
  page('Checking your invitation', '', '<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>One moment…</strong></div></div>');
  let cred;
  try { cred = await Auth.signInWithEmailLink(auth, email, location.href); }
  catch (e) {
    const expired = e?.code === 'auth/invalid-action-code' || e?.code === 'auth/expired-action-code';
    problem(expired ? 'This link has expired or was already used' : 'This link didn’t work', expired ? 'Ask your admin to resend the invitation, or enter your email below to get a new link.' : 'Check that you typed the same email the invitation was sent to, or get a new link.', '<a class="btn btn-primary login-submit" href="/activate">Get a new link</a>');
    return;
  }
  history.replaceState(null, '', `/activate${company ? `?c=${encodeURIComponent(company)}` : ''}`);
  store.del(EMAIL_KEY);
  await afterSignIn(cred.user);
}

async function afterSignIn(user) {
  const email = lower(user.email);
  const prof = await FS.getDoc(FS.doc(db, `users/${user.uid}`)).catch(() => null);
  if (prof?.exists()) {
    await Auth.signOut(auth);
    if (prof.data().disabled) { problem('Your access is turned off', 'Your company has turned off your Allurus access. Contact your HR admin.', '<a class="btn login-submit" href="/app">Back to sign in</a>'); return; }
    problem('You already have an account', 'Sign in with your email and password. Forgotten it? Choose “Forgot password?” on the sign-in page.', '<a class="btn btn-primary login-submit" href="/app">Go to sign in</a>');
    return;
  }
  const inv = await FS.getDoc(FS.doc(db, `invites/${email}`)).catch(() => null);
  if (!inv?.exists() || !I.usable(inv.data())) {
    const expired = inv?.exists();
    // A sign-in with no valid invitation leaves nothing behind.
    try { await user.delete(); } catch (e) { await Auth.signOut(auth); }
    problem(expired ? 'Your invitation has expired' : 'We couldn’t find a valid invitation', expired ? 'Invitations last 7 days. Ask your HR admin to send a new one, then open the new email.' : 'This email has no invitation that’s still open. It may have been cancelled, or sent to a different email. Ask your HR admin.', '<a class="btn login-submit" href="/app">Back to sign in</a>');
    return;
  }
  passwordScreen(user, inv.data());
}

// ---------- Screen 3: create a password ----------
async function passwordScreen(user, invite) {
  const who = { email: user.email, name: invite.name };
  const common = await P.loadCommon('/js/vendor/common-passwords.txt');
  page('Create your password', `${esc(invite.name || '')}${invite.company ? `, ${esc(invite.company)}` : ''}. Invitation valid until ${new Date(I.ms(invite.expiresAt)).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}.`, `
    <form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
      <p class="ac-step">Step 3 of 3</p>
      <input type="email" name="username" autocomplete="username" value="${esc(user.email)}" hidden>
      <div class="field"><label for="pw">New password</label><div class="pw-wrap"><input class="input" id="pw" name="pw" type="password" autocomplete="new-password" required aria-describedby="rules"><button type="button" class="pw-toggle" id="show" aria-label="Show password">Show</button></div></div>
      <ul class="ac-rules" id="rules" aria-live="polite"></ul>
      <div class="field"><label for="pw2">Confirm password</label><input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password" required></div>
      <p class="login-error" id="err" role="alert" hidden></p>
      <button class="btn btn-primary login-submit" type="submit" id="go">Create account</button>
    </form>`);
  const f = document.getElementById('f'), err = document.getElementById('err');
  const draw = () => { document.getElementById('rules').innerHTML = P.check(f.pw.value, who, common).rules.map((r) => `<li class="${r.ok ? 'ok' : ''}">${esc(r.text)}</li>`).join(''); };
  draw(); f.pw.addEventListener('input', draw);
  document.getElementById('show').addEventListener('click', (ev) => { const s = f.pw.type === 'password'; f.pw.type = f.pw2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; ev.target.setAttribute('aria-label', s ? 'Hide password' : 'Show password'); });
  const fail = (m) => { err.textContent = m; err.hidden = false; const b = document.getElementById('go'); b.disabled = false; b.textContent = 'Create account'; };
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const pw = f.pw.value;
    if (!P.check(pw, who, common).ok) { fail('Choose a password that meets every rule above.'); return; }
    if (pw !== f.pw2.value) { fail('The two passwords don’t match.'); return; }
    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Checking…';
    const seen = await P.breachCount(pw);
    if (seen > 0) { fail(`This password has appeared in ${seen.toLocaleString()} data breaches. Choose a different one.`); return; }
    btn.textContent = 'Creating your account…';
    try {
      // The profile comes from the invitation; firestore.rules refuses anything else.
      const uref = FS.doc(db, `users/${user.uid}`);
      if (!(await FS.getDoc(uref)).exists()) {
        const prof = { email: lower(user.email), name: invite.name || user.email, tenantId: invite.tenantId, roles: invite.roles, empId: invite.empId, joinedAt: FS.serverTimestamp() };
        if (Array.isArray(invite.perms)) prof.perms = invite.perms;
        await FS.setDoc(uref, prof);
      }
      // Now that they belong to the company, check the password against their IC and phone too.
      const rec = await FS.getDoc(FS.doc(db, `tenants/${invite.tenantId}/people/${invite.empId}`)).catch(() => null);
      const full = { ...who, ic: rec?.data()?.f?.ic || rec?.data()?.ic || '', phone: rec?.data()?.f?.phone || rec?.data()?.phone || '' };
      if (!P.check(pw, full, common).ok) { fail('That password contains your IC or phone number. Choose another.'); return; }
      await Auth.updatePassword(user, pw);
    } catch (e) {
      console.warn('[activate] create account', e?.code || e?.name);
      fail(e?.code === 'auth/weak-password' || e?.code === 'auth/password-does-not-meet-requirements' ? 'That password isn’t allowed. Choose a longer, less common one.'
        : e?.code === 'permission-denied' ? 'Your invitation is no longer valid. Ask your HR admin to send a new one.' : 'Something went wrong. Check your connection and try again.');
      return;
    }
    // ---------- Screen 4: done ----------
    page('Your account is ready', '', '<p class="ac-ok" role="status">Signing you in…</p>');
    location.replace('/app?activated');
  });
}

// ---------- Start ----------
if (!window.ALLURUS_FIREBASE?.apiKey) problem('Not available here', 'Account activation needs the Allurus cloud.');
else if (Auth.isSignInWithEmailLink(auth, location.href)) fromLink();
else emailScreen();
