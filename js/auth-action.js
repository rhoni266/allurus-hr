// allurus.my/auth/action: Allurus's own page for the links in Firebase's emails (set as the Action URL in
// Firebase console → Authentication → Templates), instead of allurus-hr.firebaseapp.com.
//   mode=resetPassword  "Forgot password": check the link, then choose a new password.
//   mode=verifyEmail    confirm an email address.
//   mode=signIn         an invitation sign-in link: passed on to allurus.my/activate untouched.
// Email scanners open links before people do, so opening this page never uses a link up: checking it
// (verifyPasswordResetCode, checkActionCode) is read-only, and only the button the person presses is one-time.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
const auth = Auth.getAuth(initializeApp(window.ALLURUS_FIREBASE));
const P = window.AllurusPassword;
const q = new URLSearchParams(location.search);
const mode = q.get('mode'), code = q.get('oobCode') || '';
const root = document.getElementById('ac');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = '<svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0F766E"/><path d="M19 47 L32 17 L45 47" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 37.5 Q32 32 40.5 37.5" fill="none" stroke="#D9B66F" stroke-width="4.5" stroke-linecap="round"/></svg>';
const page = (title, card) => { root.innerHTML = `<div class="login-inner"><div class="login-brand">${MARK}</div><h1>${title}</h1><div class="login-card">${card}</div></div>`; root.querySelector('input')?.focus(); };
const BAD = {
  'auth/expired-action-code': ['This link has expired', 'Links in our emails work for a limited time.'],
  'auth/invalid-action-code': ['This link has already been used or is no longer valid', 'Each link works once, and a newer email replaces an older one.'],
  'auth/user-disabled': ['This account is turned off', 'Contact your company’s HR admin.'],
  'auth/user-not-found': ['This account no longer exists', 'Contact your company’s HR admin.'],
};
function problem(e, again) {
  // Confirming an email twice (or a scanner having opened it first) usually means it's already done.
  const used = e?.code === 'auth/invalid-action-code', expired = e?.code === 'auth/expired-action-code';
  if (mode === 'verifyEmail' && (used || expired)) {
    page(used ? 'This link was already used' : 'This link has expired', `<p class="login-error" role="alert">${used ? 'Your email may already be confirmed: you can sign in now.' : 'Request a new one: sign in, and we’ll offer to send it again.'}</p>
      <a class="btn btn-primary login-submit" href="${esc(back())}">${back().startsWith('/signup') ? 'Continue sign-up' : 'Sign in'}</a>`);
    return;
  }
  const [t, d] = used ? ['This link was already used', 'Each link works once. If you already finished, you can sign in now; otherwise request a new one.']
    : expired ? ['This link has expired', 'Request a new one.'] : BAD[e?.code] || ['Something went wrong', 'Check your connection and try again.'];
  page(esc(t), `<p class="login-error" role="alert">${esc(d)}</p>${again}<a class="btn login-submit" href="/app">Sign in</a>`);
}
// Where to go after the link: the allurus.my page that asked for it (e.g. /signup?finish=1), never another site.
function back() {
  try { const u = new URL(q.get('next') || q.get('continueUrl') || '/app', location.origin); return u.origin === location.origin ? u.pathname + u.search : '/app'; } catch (e) { return '/app'; }
}
// Remove the code from the address bar and history once it's been read.
const hide = () => history.replaceState(null, '', '/auth/action');

async function resetPassword() {
  const again = '<a class="btn btn-primary login-submit" href="/app">Request a new reset email</a><p class="ac-note" style="font-size:13px;margin:0">On the sign-in page, choose “Forgot password?”.</p>';
  let email;
  try { email = await Auth.verifyPasswordResetCode(auth, code); } catch (e) { hide(); problem(e, again); return; }   // read-only check
  hide();
  const common = await P.loadCommon('/js/vendor/common-passwords.txt');
  page('Choose a new password', `<form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
    <input type="email" name="username" autocomplete="username" value="${esc(email)}" hidden>
    <p class="ac-note" style="text-align:left;margin:0">For <b>${esc(email)}</b></p>
    <div class="field"><label for="pw">New password</label><div class="pw-wrap"><input class="input" id="pw" name="pw" type="password" autocomplete="new-password" required aria-describedby="rules"><button type="button" class="pw-toggle" id="show" aria-label="Show password">Show</button></div></div>
    <ul class="ac-rules" id="rules" aria-live="polite"></ul>
    <div class="field"><label for="pw2">Confirm password</label><input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password" required></div>
    <p class="login-error" id="err" role="alert" hidden></p>
    <button class="btn btn-primary login-submit" type="submit" id="go">Save new password</button></form>`);
  const f = document.getElementById('f'), err = document.getElementById('err'), who = { email };
  const draw = () => { document.getElementById('rules').innerHTML = P.check(f.pw.value, who, common).rules.map((r) => `<li class="${r.ok ? 'ok' : ''}">${esc(r.text)}</li>`).join(''); };
  draw(); f.pw.addEventListener('input', draw);
  document.getElementById('show').addEventListener('click', (ev) => { const s = f.pw.type === 'password'; f.pw.type = f.pw2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; });
  const fail = (m) => { err.textContent = m; err.hidden = false; const b = document.getElementById('go'); b.disabled = false; b.textContent = 'Save new password'; };
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.hidden = true;
    if (!P.check(f.pw.value, who, common).ok) return fail('Choose a password that meets every rule above.');
    if (f.pw.value !== f.pw2.value) return fail('The two passwords don’t match.');
    const b = document.getElementById('go'); b.disabled = true; b.textContent = 'Checking…';
    if ((await P.breachCount(f.pw.value)) > 0) return fail('This password has appeared in data breaches. Choose a different one.');
    b.textContent = 'Saving…';
    try { await Auth.confirmPasswordReset(auth, code, f.pw.value); }   // the one-time step
    catch (e) { if (BAD[e?.code]) return problem(e, again); return fail(e?.code === 'auth/weak-password' || e?.code === 'auth/password-does-not-meet-requirements' ? 'That password isn’t allowed. Choose a longer, less common one.' : 'Something went wrong. Try again.'); }
    page('Password changed', `<p class="ac-ok" role="status">Your password is saved. Sign in with ${esc(email)} and your new password.</p>
      <a class="btn btn-primary login-submit" href="/app">Sign in</a><a class="btn login-submit" href="/superadmin">Superadmin sign-in</a>`);
  });
}

async function verifyEmail() {
  let info;
  try { info = await Auth.checkActionCode(auth, code); } catch (e) { hide(); problem(e, '<a class="btn btn-primary login-submit" href="/app">Go to sign in</a>'); return; }   // read-only
  hide();
  page('Confirm your email', `<p class="ac-note" style="margin:0">Confirm <b>${esc(info.data.email)}</b> for your Allurus account.</p><button class="btn btn-primary login-submit" id="go">Confirm email</button>`);
  document.getElementById('go').addEventListener('click', async () => {
    try { await Auth.applyActionCode(auth, code); page('Email confirmed', `<p class="ac-ok" role="status">Thank you, your email is confirmed.</p><a class="btn btn-primary login-submit" href="${esc(back())}">${back().startsWith('/signup') ? 'Continue sign-up' : 'Sign in'}</a>`); }
    catch (e) { problem(e, '<a class="btn btn-primary login-submit" href="/app">Go to sign in</a>'); }
  });
}

// "Your email was changed" email: put the old address back (and suggest a new password), after a button press.
async function recoverEmail() {
  let info;
  try { info = await Auth.checkActionCode(auth, code); } catch (e) { hide(); problem(e, '<a class="btn btn-primary login-submit" href="/app">Go to sign in</a>'); return; }   // read-only
  hide();
  const restored = info.data.email;
  page('Undo the email change', `<p class="ac-note" style="margin:0">Your Allurus sign-in email was changed${info.data.previousEmail ? ` to <b>${esc(info.data.previousEmail)}</b>` : ''}. If that wasn’t you, put it back to <b>${esc(restored)}</b>.</p><button class="btn btn-primary login-submit" id="go">Restore ${esc(restored)}</button>`);
  document.getElementById('go').addEventListener('click', async () => {
    try {
      await Auth.applyActionCode(auth, code);   // the one-time step
      page('Email restored', `<p class="ac-ok" role="status">Your sign-in email is ${esc(restored)} again. If someone else changed it, change your password now.</p>
        <button class="btn btn-primary login-submit" id="rs">Email me a password reset link</button><a class="btn login-submit" href="/app">Sign in</a>`);
      document.getElementById('rs').addEventListener('click', async (ev) => { ev.target.disabled = true; try { await Auth.sendPasswordResetEmail(auth, restored); ev.target.textContent = 'Reset email sent'; } catch (e) { ev.target.textContent = 'Couldn’t send it. Use Forgot password? on the sign-in page.'; } });
    } catch (e) { problem(e, '<a class="btn btn-primary login-submit" href="/app">Go to sign in</a>'); }
  });
}

// Invitation sign-in links: hand the whole link to /activate, keeping the company code from the continue URL.
function signIn() {
  let c = '';
  try { c = new URL(q.get('continueUrl') || '', location.origin).searchParams.get('c') || ''; } catch (e) { /* no continue URL */ }
  const p = new URLSearchParams(location.search); if (c) p.set('c', c);
  location.replace(`/activate?${p.toString()}`);
}

if (!window.ALLURUS_FIREBASE?.apiKey || !code) page('Link not recognised', '<p class="login-error" role="alert">This link is incomplete. Open it again from the email, or request a new one.</p><a class="btn btn-primary login-submit" href="/app">Go to sign in</a>');
else if (mode === 'resetPassword') resetPassword();
else if (mode === 'verifyEmail' || mode === 'verifyAndChangeEmail') verifyEmail();
else if (mode === 'recoverEmail' || mode === 'revertSecondFactorAddition') recoverEmail();
else if (mode === 'signIn') signIn();
else page('Link not recognised', '<p class="login-error" role="alert">This kind of link isn’t used by Allurus. Ask your HR admin.</p><a class="btn btn-primary login-submit" href="/app">Go to sign in</a>');
