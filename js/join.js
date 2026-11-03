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

// ---------- The open join page (no link): company code + IC, then a password or 6-digit PIN; HR approves before any access ----------
// Every mismatch gets the same words after the same wait, so the page never tells anyone which part was wrong or
// whether an IC belongs to the company.
const T = I.IC_TEXT;
const steady = async (started, ms = 1400) => { const left = ms - (Date.now() - started); if (left > 0) await new Promise((r) => setTimeout(r, left)); };
const masked = (ic) => (ic.length >= 4 ? `${'•'.repeat(Math.max(0, ic.length - 4))}${ic.slice(-4)}` : '');
function openForm(msg = '') {
  page('Join your company', 'Type the company code from HR and your IC number. HR checks each registration before you can use the app.', `
    <form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none" autocomplete="off">
      <div class="field"><label for="code">Company code</label><input class="input" id="code" name="code" autocapitalize="none" autocomplete="off" spellcheck="false" required></div>
      <div class="field"><label for="jkey">Join key <span class="faint">(if HR gave you one)</span></label><input class="input" id="jkey" name="jkey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label for="ic">IC number</label><input class="input" id="ic" name="ic" type="password" inputmode="numeric" autocomplete="off" placeholder="12 digits, no dashes" required aria-describedby="ic-shown"><p class="field-hint" id="ic-shown" aria-live="polite"></p></div>
      <div class="field"><label for="phone">Phone number</label><input class="input" id="phone" name="phone" type="tel" inputmode="tel" placeholder="e.g. 0123456789" autocomplete="tel"><p class="field-hint">For HR contact and verification.</p></div>
      <p class="login-error" id="err" role="alert" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
      <button class="btn btn-primary login-submit" type="submit" id="go">Continue</button>
    </form>`);
  const f = document.getElementById('f');
  f.ic.addEventListener('input', () => { const d = M.icDigits(f.ic.value); document.getElementById('ic-shown').textContent = d ? `IC ${masked(d)}` : ''; });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const started = Date.now(), code = String(f.code.value || '').trim().toLowerCase(), ic = M.icDigits(f.ic.value);
    const phone = String(f.phone?.value || '').trim();
    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Checking…';
    if (!/^[a-z0-9]{3,12}$/.test(code) || !M.validIc(ic)) { await steady(started); openForm(T.noMatch); return; }
    const c = await FS.getDoc(FS.doc(db, `companyCodes/${code}`)).catch(() => null);
    if (!c?.exists()) { await steady(started); openForm(T.noMatch); return; }
    const until = c.data().openUntil;
    if (!until || until.toMillis() <= Date.now()) { await steady(started); problem('Registration is closed', esc(T.closed)); return; }
    const k = await FS.getDoc(FS.doc(db, `staffKeys/${c.data().tenantId}~${ic}`)).catch(() => null);
    if (!k?.exists()) { await steady(started); openForm(T.noMatch); return; }
    const gen = Number(k.data().gen) || 1;
    const empId = k.data().empId || '';
    const name = k.data().name || '';
    await steady(started, 600);
    // With a join key set, only its salted hash leaves this page (the rules compare it); a wrong or missing key
    // gets the same words as any other mismatch, when the registration is saved.
    const salt = c.data().salt || '', typed = M.joinKeyNorm(f.jkey.value);
    if (salt && !typed) { await steady(started); openForm(T.noMatch); return; }
    const keyProof = salt ? await M.joinKeyHash(salt, typed) : '';
    f.jkey.value = '';
    openPassword({ code, ic, phone, tenantId: c.data().tenantId, company: c.data().company || '', gen, keyProof, empId, name });
  });
}
async function openPassword(j) {
  const common = await P.loadCommon('/js/vendor/common-passwords.txt');
  page('Create your password or PIN', `${j.company ? `${esc(j.company)} · ` : ''}IC ${masked(j.ic)}`, `
    <form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
      <div class="seg" role="tablist" style="margin-bottom:14px;width:100%;display:flex">
        <button type="button" class="btn on" id="tab-pw" style="flex:1" role="tab" aria-selected="true">Password</button>
        <button type="button" class="btn" id="tab-pin" style="flex:1" role="tab" aria-selected="false">6-digit PIN</button>
      </div>

      <div id="sec-pw">
        <div class="field"><label for="pw">New password</label><div class="pw-wrap"><input class="input" id="pw" name="pw" type="password" autocomplete="new-password" aria-describedby="rules"><button type="button" class="pw-toggle" id="show-pw" aria-label="Show password">Show</button></div></div>
        <ul class="ac-rules" id="rules" aria-live="polite"></ul>
        <div class="field"><label for="pw2">Confirm password</label><input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password"></div>
      </div>

      <div id="sec-pin" hidden>
        <div class="field"><label for="pin">6-digit PIN</label><div class="pw-wrap"><input class="input" id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 digits" autocomplete="new-password"><button type="button" class="pw-toggle" id="show-pin" aria-label="Show PIN">Show</button></div></div>
        <p class="field-hint" style="margin-bottom:8px">Numbers only. Cannot be simple patterns like 123456 or your birth date.</p>
        <div class="field"><label for="pin2">Confirm 6-digit PIN</label><input class="input" id="pin2" name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Repeat 6 digits" autocomplete="new-password"></div>
      </div>

      <p class="login-error" id="err" role="alert" hidden></p>
      <button class="btn btn-primary login-submit" type="submit" id="go">Register</button>
      <button type="button" class="link-btn" id="back" style="margin-top:8px">Back</button>
    </form>`);
  const f = document.getElementById('f'), err = document.getElementById('err'), who = { ic: j.ic, phone: j.phone || '' };
  let mode = 'pw';
  const tabPw = document.getElementById('tab-pw'), tabPin = document.getElementById('tab-pin');
  const secPw = document.getElementById('sec-pw'), secPin = document.getElementById('sec-pin');

  tabPw.addEventListener('click', () => {
    mode = 'pw';
    tabPw.classList.add('on'); tabPw.setAttribute('aria-selected', 'true');
    tabPin.classList.remove('on'); tabPin.setAttribute('aria-selected', 'false');
    secPw.hidden = false; secPin.hidden = true;
    err.hidden = true;
  });
  tabPin.addEventListener('click', () => {
    mode = 'pin';
    tabPin.classList.add('on'); tabPin.setAttribute('aria-selected', 'true');
    tabPw.classList.remove('on'); tabPw.setAttribute('aria-selected', 'false');
    secPin.hidden = false; secPw.hidden = true;
    err.hidden = true;
    document.getElementById('pin')?.focus();
  });

  const draw = () => { document.getElementById('rules').innerHTML = P.check(f.pw.value, who, common).rules.map((r) => `<li class="${r.ok ? 'ok' : ''}">${esc(r.text)}</li>`).join(''); };
  draw(); f.pw.addEventListener('input', draw);
  document.getElementById('back').addEventListener('click', () => openForm());
  document.getElementById('show-pw').addEventListener('click', (ev) => { const s = f.pw.type === 'password'; f.pw.type = f.pw2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; });
  document.getElementById('show-pin')?.addEventListener('click', (ev) => { const s = f.pin.type === 'password'; f.pin.type = f.pin2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; });
  const fail = (m) => { err.textContent = m; err.hidden = false; const b = document.getElementById('go'); b.disabled = false; b.textContent = 'Register'; };
  let busy = false;
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); if (busy) return;                          // a double tap makes one account
    err.hidden = true;

    let secretToUse = '';
    if (mode === 'pin') {
      const pin = f.pin.value.trim();
      const pinCheck = P.checkPin(pin, who);
      if (!pinCheck.ok) { fail(pinCheck.error); return; }
      if (pin !== f.pin2.value.trim()) { fail('The two PINs don’t match.'); return; }
      secretToUse = pin;
    } else {
      const pw = f.pw.value;
      if (!P.check(pw, who, common).ok) { fail('Choose a password that meets every rule above.'); return; }
      if (pw !== f.pw2.value) { fail('The two passwords don’t match.'); return; }
      const seen = await P.breachCount(pw);
      if (seen > 0) { fail(`This password has appeared in ${seen.toLocaleString()} data breaches. Choose a different one.`); return; }
      secretToUse = pw;
    }

    busy = true;
    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Checking…';
    const started = Date.now(), email = M.staffEmail(j.ic, j.tenantId, j.gen);
    let cred;
    try { cred = await Auth.createUserWithEmailAndPassword(auth, email, secretToUse); }
    catch (e) {
      // Already registered (or any other refusal): the same words as every other mismatch.
      busy = false; await steady(started);
      if (e?.code === 'auth/network-request-failed') { fail('You seem to be offline. Try again.'); return; }
      openForm(T.noMatch); return;
    }
    try {
      await FS.setDoc(FS.doc(db, `users/${cred.user.uid}`), {
        email,
        name: j.name || 'Staff',
        tenantId: j.tenantId,
        code: j.code,
        roles: ['employee'],
        empId: j.empId || '',
        pending: false,
        via: 'open',
        ...(j.phone ? { phone: j.phone } : {}),
        ...(mode === 'pin' ? { authType: 'pin' } : {}),
        ...(j.keyProof ? { keyProof: j.keyProof } : {}),
        joinedAt: FS.serverTimestamp()
      });
    } catch (e) {
      try { await cred.user.delete(); } catch (x) { /* signed out below */ }
      await Auth.signOut(auth).catch(() => {});
      busy = false; await steady(started);
      openForm(e?.code === 'permission-denied' ? T.noMatch : 'Something went wrong. Check your connection and try again.'); return;
    }
    const methodDesc = mode === 'pin' ? 'your 6-digit PIN' : 'this password';
    page('You’ve joined!', '', `<p class="ac-ok" role="status">Signing you in… Next time use company code <b>${esc(j.code)}</b>, your IC and ${methodDesc}.</p>`);
    setTimeout(() => location.replace('/app?activated'), 1500);
  });
}

async function start() {
  if (!window.ALLURUS_FIREBASE?.apiKey) { problem('Not available here', 'Joining needs the Allurus cloud.'); return; }
  if (!secret) { openForm(); return; }
  const snap = secret.length >= 24 ? await FS.getDoc(FS.doc(db, `joinLinks/${secret}`)).catch(() => null) : null;
  if (!snap?.exists()) { problem('This link doesn’t work', 'It may have been replaced by a newer one. Ask HR to send you a new join link.'); return; }
  const link = snap.data();
  if (!I.usable(link)) { problem('This link has expired', 'Join links last 7 days. Ask HR to send you a new one.'); return; }
  form(link);
}

async function form(link) {
  const common = await P.loadCommon('/js/vendor/common-passwords.txt');
  page(`Join ${esc(link.company || 'your company')}`, `Hi ${esc(link.name || '')}. Type your IC number and choose a password or 6-digit PIN. Afterwards you sign in with company code <b>${esc(link.code)}</b>, your IC and this password/PIN.`, `
    <form id="f" novalidate class="login-card" style="padding:0;box-shadow:none;max-width:none">
      <div class="field"><label for="ic">IC number</label><input class="input" id="ic" name="ic" inputmode="numeric" autocomplete="username" placeholder="12 digits, no dashes" required></div>

      <div class="seg" role="tablist" style="margin-bottom:14px;width:100%;display:flex">
        <button type="button" class="btn on" id="tab-pw" style="flex:1" role="tab" aria-selected="true">Password</button>
        <button type="button" class="btn" id="tab-pin" style="flex:1" role="tab" aria-selected="false">6-digit PIN</button>
      </div>

      <div id="sec-pw">
        <div class="field"><label for="pw">New password</label><div class="pw-wrap"><input class="input" id="pw" name="pw" type="password" autocomplete="new-password" aria-describedby="rules"><button type="button" class="pw-toggle" id="show-pw" aria-label="Show password">Show</button></div></div>
        <ul class="ac-rules" id="rules" aria-live="polite"></ul>
        <div class="field"><label for="pw2">Confirm password</label><input class="input" id="pw2" name="pw2" type="password" autocomplete="new-password"></div>
      </div>

      <div id="sec-pin" hidden>
        <div class="field"><label for="pin">6-digit PIN</label><div class="pw-wrap"><input class="input" id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 digits" autocomplete="new-password"><button type="button" class="pw-toggle" id="show-pin" aria-label="Show PIN">Show</button></div></div>
        <p class="field-hint" style="margin-bottom:8px">Numbers only. Cannot be simple patterns like 123456 or your birth date.</p>
        <div class="field"><label for="pin2">Confirm 6-digit PIN</label><input class="input" id="pin2" name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Repeat 6 digits" autocomplete="new-password"></div>
      </div>

      <p class="login-error" id="err" role="alert" hidden></p>
      <button class="btn btn-primary login-submit" type="submit" id="go">Join</button>
    </form>`);
  const f = document.getElementById('f'), err = document.getElementById('err');
  const who = () => ({ name: link.name, ic: M.icDigits(f.ic.value) });
  let mode = 'pw';
  const tabPw = document.getElementById('tab-pw'), tabPin = document.getElementById('tab-pin');
  const secPw = document.getElementById('sec-pw'), secPin = document.getElementById('sec-pin');

  tabPw.addEventListener('click', () => {
    mode = 'pw';
    tabPw.classList.add('on'); tabPw.setAttribute('aria-selected', 'true');
    tabPin.classList.remove('on'); tabPin.setAttribute('aria-selected', 'false');
    secPw.hidden = false; secPin.hidden = true;
    err.hidden = true;
  });
  tabPin.addEventListener('click', () => {
    mode = 'pin';
    tabPin.classList.add('on'); tabPin.setAttribute('aria-selected', 'true');
    tabPw.classList.remove('on'); tabPw.setAttribute('aria-selected', 'false');
    secPin.hidden = false; secPw.hidden = true;
    err.hidden = true;
    document.getElementById('pin')?.focus();
  });

  const draw = () => { document.getElementById('rules').innerHTML = P.check(f.pw.value, who(), common).rules.map((r) => `<li class="${r.ok ? 'ok' : ''}">${esc(r.text)}</li>`).join(''); };
  draw(); f.pw.addEventListener('input', draw); f.ic.addEventListener('input', draw);
  document.getElementById('show-pw').addEventListener('click', (ev) => { const s = f.pw.type === 'password'; f.pw.type = f.pw2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; });
  document.getElementById('show-pin')?.addEventListener('click', (ev) => { const s = f.pin.type === 'password'; f.pin.type = f.pin2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; });
  const fail = (m) => { err.textContent = m; err.hidden = false; const b = document.getElementById('go'); b.disabled = false; b.textContent = 'Join'; };
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.hidden = true;
    const ic = M.icDigits(f.ic.value);
    if (!M.validIc(ic)) { fail('Enter your 12-digit IC number.'); return; }

    let secretToUse = '';
    if (mode === 'pin') {
      const pin = f.pin.value.trim();
      const pinCheck = P.checkPin(pin, who());
      if (!pinCheck.ok) { fail(pinCheck.error); return; }
      if (pin !== f.pin2.value.trim()) { fail('The two PINs don’t match.'); return; }
      secretToUse = pin;
    } else {
      const pw = f.pw.value;
      if (!P.check(pw, who(), common).ok) { fail('Choose a password that meets every rule above.'); return; }
      if (pw !== f.pw2.value) { fail('The two passwords don’t match.'); return; }
      const seen = await P.breachCount(pw);
      if (seen > 0) { fail(`This password has appeared in ${seen.toLocaleString()} data breaches. Choose a different one.`); return; }
      secretToUse = pw;
    }

    const btn = document.getElementById('go'); btn.disabled = true; btn.textContent = 'Checking…';
    btn.textContent = 'Joining…';
    const email = M.staffEmail(ic, link.tenantId, link.gen);
    let cred;
    try { cred = await Auth.createUserWithEmailAndPassword(auth, email, secretToUse); }
    catch (e) {
      // Already joined with this IC: sign in instead.
      fail(e?.code === 'auth/email-already-in-use' ? `You’ve already joined. Sign in with company code ${link.code}, your IC and your password or PIN.` : e?.code === 'auth/network-request-failed' ? 'You seem to be offline. Try again.' : 'That didn’t work. Try again.');
      return;
    }
    try {
      await FS.setDoc(FS.doc(db, `users/${cred.user.uid}`), { email, name: link.name || 'Staff', tenantId: link.tenantId, roles: ['employee'], empId: link.empId, via: 'ic', link: secret, ...(mode === 'pin' ? { authType: 'pin' } : {}), joinedAt: FS.serverTimestamp() });
    } catch (e) {
      // Not the IC HR invited (or the invitation was replaced): leave nothing behind.
      try { await cred.user.delete(); } catch (x) { await Auth.signOut(auth); }
      fail(e?.code === 'permission-denied' ? 'That IC doesn’t match this invitation, or the link was replaced. Check your IC, or ask HR for a new link.' : 'Something went wrong. Check your connection and try again.');
      return;
    }
    const methodDesc = mode === 'pin' ? 'your 6-digit PIN' : 'your password';
    page('You’ve joined', '', `<p class="ac-ok" role="status">Signing you in… Next time use company code <b>${esc(link.code)}</b>, your IC and ${methodDesc}.</p>`);
    setTimeout(() => location.replace('/app?activated'), 1500);
  });
}
start();
