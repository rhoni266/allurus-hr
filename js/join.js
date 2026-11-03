// allurus.my/join?k=<secret>: a staff member with no work email joins from the link HR sent them (WhatsApp or copied).
//   1. The link says which company and sign-in generation (joinLinks/{secret}); it is useless without their IC.
//   2. They type their IC and choose a password. The account's email is made up from the IC (js/cloud-map.js
//      staffEmail), and firestore.rules (staffJoin) lets the profile be created only if HR invited that IC with this link.
//   3. A wrong IC leaves nothing behind: the new sign-in is deleted again.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth, FS] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
const fb = initializeApp(window.ALLURUS_FIREBASE);
const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);
const M = window.AllurusCloudMap, P = window.AllurusPassword, I = window.AllurusInvite;
const root = document.getElementById('ac');
const secret = new URLSearchParams(location.search).get('k') || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = '<svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0F766E"/><path d="M19 47 L32 17 L45 47" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 37.5 Q32 32 40.5 37.5" fill="none" stroke="#D9B66F" stroke-width="4.5" stroke-linecap="round"/></svg>';

function page(title, sub, card) {
  root.innerHTML = `<div class="login-inner"><div class="login-brand">${MARK}</div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="login-card">${card}</div>
    <p class="faint" style="font-size:12.5px">Already joined? <a href="/app">Sign in</a></p></div>`;
  root.querySelector('input')?.focus();
}
const problem = (title, text) => page(esc(title), '', `<p class="login-error" role="alert">${text}</p><a class="btn login-submit" href="/app">Go to sign in</a>`);

async function start() {
  if (!window.ALLURUS_FIREBASE?.apiKey) { problem('Not available here', 'Joining needs the Allurus cloud.'); return; }
  const snap = secret.length >= 24 ? await FS.getDoc(FS.doc(db, `joinLinks/${secret}`)).catch(() => null) : null;
  if (!snap?.exists()) { problem('This link doesn’t work', 'It may have been replaced by a newer one. Ask HR to send you a new join link.'); return; }
  const link = snap.data();
  if (!I.usable(link)) { problem('This link has expired', 'Join links last 7 days. Ask HR to send you a new one.'); return; }
  form(link);
}

async function form(link) {
  const common = await P.loadCommon('/js/vendor/common-passwords.txt');
  page(`Join ${esc(link.company || 'your company')}`, `Hi ${esc(link.name || '')}. Type your IC number and choose a password. Afterwards you sign in with company code <b>${esc(link.code)}</b>, your IC and this password.`, `
    <form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
      <div class="field"><label for="ic">IC number</label><input class="input" id="ic" name="ic" inputmode="numeric" autocomplete="username" placeholder="12 digits, no dashes" required></div>
      <div class="field"><label for="pw">New password</label><div class="pw-wrap"><input class="input" id="pw" name="pw" type="password" autocomplete="new-password" required aria-describedby="rules"><button type="button" class="pw-toggle" id="show" aria-label="Show password">Show</button></div></div>
      <ul class="ac-rules" id="rules" aria-live="polite"></ul>
      <div class="field"><label for="pw2">Confirm password</label><input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password" required></div>
      <p class="login-error" id="err" role="alert" hidden></p>
      <button class="btn btn-primary login-submit" type="submit" id="go">Join</button>
    </form>`);
  const f = document.getElementById('f'), err = document.getElementById('err');
  const who = () => ({ name: link.name, ic: M.icDigits(f.ic.value) });
  const draw = () => { document.getElementById('rules').innerHTML = P.check(f.pw.value, who(), common).rules.map((r) => `<li class="${r.ok ? 'ok' : ''}">${esc(r.text)}</li>`).join(''); };
  draw(); f.pw.addEventListener('input', draw); f.ic.addEventListener('input', draw);
  document.getElementById('show').addEventListener('click', (ev) => { const s = f.pw.type === 'password'; f.pw.type = f.pw2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; });
  const fail = (m) => { err.textContent = m; err.hidden = false; const b = document.getElementById('go'); b.disabled = false; b.textContent = 'Join'; };
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.hidden = true;
    const ic = M.icDigits(f.ic.value), pw = f.pw.value;
    if (!M.validIc(ic)) { fail('Enter your 12-digit IC number.'); return; }
    if (!P.check(pw, who(), common).ok) { fail('Choose a password that meets every rule above.'); return; }
    if (pw !== f.pw2.value) { fail('The two passwords don’t match.'); return; }
    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Checking…';
    const seen = await P.breachCount(pw);
    if (seen > 0) { fail(`This password has appeared in ${seen.toLocaleString()} data breaches. Choose a different one.`); return; }
    btn.textContent = 'Joining…';
    const email = M.staffEmail(ic, link.tenantId, link.gen);
    let cred;
    try { cred = await Auth.createUserWithEmailAndPassword(auth, email, pw); }
    catch (e) {
      // Already joined with this IC: sign in instead.
      fail(e?.code === 'auth/email-already-in-use' ? `You’ve already joined. Sign in with company code ${link.code}, your IC and your password.` : e?.code === 'auth/network-request-failed' ? 'You seem to be offline. Try again.' : 'That didn’t work. Try again.');
      return;
    }
    try {
      await FS.setDoc(FS.doc(db, `users/${cred.user.uid}`), { email, name: link.name || 'Staff', tenantId: link.tenantId, roles: ['employee'], empId: link.empId, via: 'ic', link: secret, joinedAt: FS.serverTimestamp() });
    } catch (e) {
      // Not the IC HR invited (or the invitation was replaced): leave nothing behind.
      try { await cred.user.delete(); } catch (x) { await Auth.signOut(auth); }
      fail(e?.code === 'permission-denied' ? 'That IC doesn’t match this invitation, or the link was replaced. Check your IC, or ask HR for a new link.' : 'Something went wrong. Check your connection and try again.');
      return;
    }
    page('You’ve joined', '', `<p class="ac-ok" role="status">Signing you in… Next time use company code <b>${esc(link.code)}</b>, your IC and your password.</p>`);
    setTimeout(() => location.replace('/app?activated'), 1500);
  });
}
start();
