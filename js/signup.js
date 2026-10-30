// allurus.my/signup: a company signs itself up for a 30-day free trial.
//   1. Company and admin details, a password of their own, Terms and Privacy Notice ticked.
//   2. Firebase emails a confirmation link (one sign-in per email, so one trial per email).
//   3. Once the email is confirmed, one write creates the company (status trial, ending at the end of day 30 in
//      Malaysia), its first admin's profile (Owner) and the one-trial-per-mobile record. firestore.rules checks every
//      field (trial length, status, owner, phone, disposable emails), so a browser can't give itself more.
//   4. The app opens with the onboarding checklist; staff are invited from there (they never sign up themselves).
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth, FS] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
const fb = initializeApp(window.ALLURUS_FIREBASE);
const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);
const B = window.AllurusBilling, P = window.AllurusPassword;
const DRAFT = 'allurus-signup', SENT = 'allurus-signup-sent', COOLDOWN = 60;
const root = document.getElementById('su');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const lower = (s) => String(s || '').trim().toLowerCase();
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } } };
const NEUTRAL = 'This email or mobile number already has an Allurus account. <a href="/app">Sign in</a>, or contact <a href="mailto:hello@allurus.my">hello@allurus.my</a> to subscribe.';
const SIZES = ['1-10', '11-30', '31-75', '76-200', '200+'];
const MARK = '<svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0F766E"/><path d="M19 47 L32 17 L45 47" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 37.5 Q32 32 40.5 37.5" fill="none" stroke="#D9B66F" stroke-width="4.5" stroke-linecap="round"/></svg>';
const page = (title, sub, card) => { root.innerHTML = `<div class="login-inner"><div class="login-brand">${MARK}</div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}<div class="login-card su-card">${card}</div>
  <p class="faint" style="font-size:12.5px">Already have an account? <a href="/app">Sign in</a>. Staff: your company invites you; you don’t sign up here.</p></div>`; root.querySelector('input:not([type=hidden])')?.focus(); };

let industries = [];
async function loadIndustries() {
  try { const s = await FS.getDocs(FS.query(FS.collection(db, 'industries'), FS.where('visible', '==', true))); industries = s.docs.map((d) => ({ slug: d.id, ...d.data() })).filter((i) => !i.archived); } catch (e) { industries = []; }
  if (!industries.length) { try { industries = (await (await fetch('/seed/industries.json')).json()).filter((i) => i.visible !== false); } catch (e) { industries = []; } }
  industries.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

// ---------- Step 1: the form ----------
async function formScreen(draft = store.get(DRAFT) || {}, msg = '', { withPassword = true } = {}) {
  if (!industries.length) await loadIndustries();
  const common = withPassword ? await P.loadCommon('/js/vendor/common-passwords.txt') : null;
  const f = (id, label, attrs, val = draft[id] || '', hint = '') => `<div class="field"><label for="s-${id}">${label}</label><input class="input" id="s-${id}" name="${id}" ${attrs} value="${esc(val)}">${hint ? `<span class="field-hint">${hint}</span>` : ''}</div>`;
  page(withPassword ? 'Start your free trial' : 'Finish setting up your company', withPassword ? '30 days free, every feature. No card needed.' : 'Your email is confirmed. Check your company details, then create your workspace.', `
    <form id="f" novalidate style="display:flex;flex-direction:column;gap:14px;text-align:left">
      <div class="form-grid">
        ${f('company', 'Company name', 'required maxlength="120" autocomplete="organization"')}
        ${f('name', 'Your full name', 'required maxlength="100" autocomplete="name"')}
        ${withPassword ? f('email', 'Work email', 'type="email" required maxlength="200" autocomplete="email" inputmode="email"') : `<div class="field"><label>Work email</label><div class="input" style="display:flex;align-items:center">${esc(auth.currentUser?.email || '')}</div></div>`}
        ${f('phone', 'Mobile number', 'type="tel" required maxlength="20" autocomplete="tel" inputmode="tel" placeholder="012-345 6789"')}
        <div class="field"><label for="s-size">Number of employees</label><select class="select" id="s-size" name="size" required><option value="">Choose…</option>${SIZES.map((s) => `<option ${draft.size === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label for="s-city">Head office <span class="faint">(optional)</span></label><div id="s-city-host"></div></div>
      </div>
      <fieldset class="field" style="border:0;padding:0;margin:0"><legend style="font-weight:600;font-size:13px;margin-bottom:6px">Industry <span class="faint">(choose any)</span></legend>
        <div class="su-inds">${industries.map((i) => `<label><input type="checkbox" name="ind" value="${esc(i.slug)}" ${(draft.ind || []).includes(i.slug) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}
          <label><input type="checkbox" name="ind" value="other" ${(draft.ind || []).includes('other') ? 'checked' : ''}> Other</label></div>
        <input class="input" name="other" maxlength="80" placeholder="Your industry" value="${esc(draft.other || '')}" style="margin-top:8px" ${(draft.ind || []).includes('other') ? '' : 'hidden'}></fieldset>
      ${withPassword ? `<div class="form-grid">
        <div class="field"><label for="s-pw">Password</label><div class="pw-wrap"><input class="input" id="s-pw" name="pw" type="password" autocomplete="new-password" required aria-describedby="rules"><button type="button" class="pw-toggle" id="show" aria-label="Show password">Show</button></div></div>
        <div class="field"><label for="s-pw2">Confirm password</label><input class="input" id="s-pw2" name="pw2" type="password" autocomplete="new-password" required></div></div>
        <ul class="ac-rules" id="rules" aria-live="polite"></ul>` : ''}
      <div class="su-terms">
        <label><input type="checkbox" name="terms" ${draft.terms ? 'checked' : ''}> <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>.</span></label>
        <label><input type="checkbox" name="pdpa" ${draft.pdpa ? 'checked' : ''}> <span>I have read the <a href="/privacy" target="_blank" rel="noopener">Privacy Notice</a> and agree to Allurus processing my company’s and staff’s personal data under the PDPA.</span></label>
      </div>
      <div class="hp" aria-hidden="true"><label for="s-web">Website</label><input id="s-web" name="website" tabindex="-1" autocomplete="off"></div>
      ${msg ? `<p class="login-error" role="alert">${msg}</p>` : ''}
      <p class="login-error" id="err" role="alert" hidden></p>
      <button class="btn btn-primary login-submit" type="submit" id="go">${withPassword ? 'Create my account' : 'Create my workspace'}</button>
      ${withPassword ? '<p class="faint" style="font-size:12.5px;margin:0;text-align:center">Started already? <button type="button" class="link-btn" id="resume">Finish a sign-up you started</button></p>' : ''}
    </form>`);
  const form = document.getElementById('f'), err = document.getElementById('err');
  let office = draft.headOffice || null;
  window.AllurusPlaceField.mount(document.getElementById('s-city-host'), { id: 's-city', value: office, placeholder: 'Town, district or state', onChange: (v) => { office = v; } });
  const read = () => { const d = new FormData(form); return { company: clean(d.get('company'), 120), name: clean(d.get('name'), 100), email: lower(d.get('email') || auth.currentUser?.email), phone: String(d.get('phone') || '').trim(), size: d.get('size') || '', city: clean(window.AllurusPlaces.officeName(office), 60), headOffice: office, ind: d.getAll('ind'), other: clean(d.get('other'), 80), terms: d.has('terms'), pdpa: d.has('pdpa') }; };
  const who = () => ({ email: form.email?.value, name: form.name.value, phone: form.phone.value });
  const draw = () => { const r = document.getElementById('rules'); if (r) r.innerHTML = P.check(form.pw.value, who(), common).rules.map((x) => `<li class="${x.ok ? 'ok' : ''}">${esc(x.text)}</li>`).join(''); };
  if (withPassword) { draw(); form.pw.addEventListener('input', draw); document.getElementById('show').addEventListener('click', (ev) => { const s = form.pw.type === 'password'; form.pw.type = form.pw2.type = s ? 'text' : 'password'; ev.target.textContent = s ? 'Hide' : 'Show'; }); document.getElementById('resume').addEventListener('click', resumeScreen); }
  form.addEventListener('change', (ev) => { if (ev.target.name === 'ind') form.other.hidden = !form.querySelector('input[name=ind][value=other]').checked; });
  const fail = (m) => { err.innerHTML = m; err.hidden = false; const b = document.getElementById('go'); b.disabled = false; b.textContent = withPassword ? 'Create my account' : 'Create my workspace'; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.hidden = true;
    if (form.website.value) return;                                    // a bot filled the hidden field
    const d = read();
    if (d.company.length < 2) return fail('Enter your company name.');
    if (d.name.length < 2) return fail('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return fail('Enter a valid work email.');
    if (B.disposable(d.email)) return fail('Use your work email. Temporary email addresses can’t start a trial.');
    if (!B.normPhone(d.phone)) return fail('Enter a Malaysian mobile number, such as 012-345 6789.');
    if (!d.size) return fail('Choose your number of employees.');
    if (!d.terms || !d.pdpa) return fail('Tick both boxes to agree to the Terms and the Privacy Notice.');
    const b = document.getElementById('go'); b.disabled = true; b.textContent = 'Checking…';
    store.set(DRAFT, d);
    if (!withPassword) { await createCompany(d).catch(() => {}); return; }
    if (!P.check(form.pw.value, who(), common).ok) return fail('Choose a password that meets every rule above.');
    if (form.pw.value !== form.pw2.value) return fail('The two passwords don’t match.');
    if ((await P.breachCount(form.pw.value)) > 0) return fail('This password has appeared in data breaches. Choose a different one.');
    b.textContent = 'Creating your account…';
    try {
      const cred = await Auth.createUserWithEmailAndPassword(auth, d.email, form.pw.value);
      await Auth.updateProfile(cred.user, { displayName: d.name }).catch(() => {});
      await Auth.sendEmailVerification(cred.user, { url: `${location.origin}/signup?finish=1`, handleCodeInApp: false });
      store.set(SENT, Date.now());
      checkEmailScreen();
    } catch (e) {
      console.warn('[signup]', e?.code);
      if (e?.code === 'auth/email-already-in-use') return fail(NEUTRAL);
      if (e?.code === 'auth/too-many-requests') return fail('Too many tries. Wait a few minutes and try again.');
      if (e?.code === 'auth/weak-password' || e?.code === 'auth/password-does-not-meet-requirements') return fail('That password isn’t allowed. Choose a longer, less common one.');
      if (e?.code === 'auth/network-request-failed') return fail('You seem to be offline. Check your connection and try again.');
      fail('Something went wrong. Please try again.');
    }
  });
}

// ---------- Step 2: confirm the email ----------
function checkEmailScreen() {
  const email = auth.currentUser?.email || '';
  page('Confirm your email', '', `<p class="ac-ok" role="status">We’ve sent a link to <b>${esc(email)}</b>. Open it to confirm your email, then come back here.</p>
    <p class="ac-note" style="font-size:13.5px;color:var(--fg-2);text-align:left;margin:0">Can’t find it? Check Spam or Promotions.</p>
    <button class="btn btn-primary login-submit" id="done">I’ve confirmed my email</button><button class="btn login-submit" id="again">Send the link again</button>
    <p class="login-error" id="err" role="alert" hidden></p>`);
  const again = document.getElementById('again'), err = document.getElementById('err');
  const tick = () => { const left = COOLDOWN - Math.floor((Date.now() - (store.get(SENT) || 0)) / 1000); if (left > 0) { again.disabled = true; again.textContent = `Send the link again in ${left}s`; setTimeout(tick, 1000); } else { again.disabled = false; again.textContent = 'Send the link again'; } };
  tick();
  again.addEventListener('click', async () => { try { await Auth.sendEmailVerification(auth.currentUser, { url: `${location.origin}/signup?finish=1` }); store.set(SENT, Date.now()); tick(); } catch (e) { err.textContent = e?.code === 'auth/too-many-requests' ? 'Too many emails just now. Wait a few minutes.' : 'Couldn’t send it. Try again.'; err.hidden = false; } });
  document.getElementById('done').addEventListener('click', async () => {
    await auth.currentUser.reload();
    if (!auth.currentUser.emailVerified) { err.textContent = 'Not confirmed yet. Open the link in the email first.'; err.hidden = false; return; }
    await auth.currentUser.getIdToken(true);
    finish();
  });
}

// Signed in from an earlier visit (or a different device): sign in, then finish.
function resumeScreen() {
  page('Finish your sign-up', 'Sign in with the email and password you chose.', `<form id="f" novalidate style="display:flex;flex-direction:column;gap:12px;text-align:left">
    <div class="field"><label for="r-em">Work email</label><input class="input" id="r-em" name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label for="r-pw">Password</label><input class="input" id="r-pw" name="pw" type="password" autocomplete="current-password" required></div>
    <p class="login-error" id="err" role="alert" hidden></p><button class="btn btn-primary login-submit" type="submit">Continue</button></form>`);
  const form = document.getElementById('f');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await Auth.signInWithEmailAndPassword(auth, lower(form.email.value), form.pw.value); route(); }
    catch (e) { const err = document.getElementById('err'); err.textContent = 'That email and password don’t match a sign-up.'; err.hidden = false; }
  });
}

// ---------- Step 3: create the company ----------
async function finish() {
  const u = auth.currentUser;
  const prof = await FS.getDoc(FS.doc(db, `users/${u.uid}`)).catch(() => null);
  if (prof?.exists()) { location.replace('/app?activated'); return; }
  const d = store.get(DRAFT);
  if (!d || !d.company || !d.phone) { formScreen(d || {}, '', { withPassword: false }); return; }
  await createCompany(d);
}
async function sha256Hex(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join(''); }
async function createCompany(d) {
  const u = auth.currentUser, phone = B.normPhone(d.phone);
  page('Creating your workspace', '', '<div class="ci-status"><span class="spinner" aria-hidden="true"></span><div><strong>One moment…</strong></div></div>');
  const tref = FS.doc(FS.collection(db, 'tenants')), now = FS.serverTimestamp();
  const batch = FS.writeBatch(db);
  batch.set(FS.doc(db, `signupAttempts/${await sha256Hex(phone)}`), { uid: u.uid, createdAt: now });
  batch.set(tref, {
    owner: u.uid, name: d.company, admin: lower(u.email), adminName: d.name, phone, industryIds: d.ind.filter((x) => x !== 'other').slice(0, 5),
    ...(d.ind.includes('other') && d.other ? { industryOther: d.other } : {}), staffRange: d.size, city: d.city || '', country: 'Malaysia',
    status: 'trial', plan: 'trial', isTest: false, trialStartedAt: now, trialEndsAt: FS.Timestamp.fromDate(B.trialEnd(Date.now())),
    createdVia: 'self_signup', termsVersion: B.TERMS_VERSION, termsAcceptedAt: now, createdAt: now,
  });
  batch.set(FS.doc(db, `users/${u.uid}`), { email: lower(u.email), name: d.name, tenantId: tref.id, roles: ['admin', 'employee'], empId: 'e1', joinedAt: now });
  try { await batch.commit(); }
  catch (e) {
    console.warn('[signup] create company', e?.code);
    formScreen(d, e?.code === 'permission-denied' ? NEUTRAL : 'Couldn’t create your workspace. Check your connection and try again.', { withPassword: false });
    return;
  }
  store.del(DRAFT); store.del(SENT);
  page('Your trial has started', '', `<p class="ac-ok" role="status">${esc(d.company)} is ready: free until ${esc(new Date(B.trialEnd(Date.now())).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }))}. Opening your workspace…</p>`);
  location.replace('/app?activated');
}

// ---------- Start ----------
async function route() {
  const u = auth.currentUser;
  if (!u) return formScreen();
  await u.reload().catch(() => {});
  if (!auth.currentUser.emailVerified) return checkEmailScreen();
  await auth.currentUser.getIdToken(true);
  return finish();
}
if (!window.ALLURUS_FIREBASE?.apiKey) page('Not available here', '', '<p class="login-error">Sign-up needs the Allurus cloud.</p>');
else Auth.onAuthStateChanged(auth, () => { if (!route.started) { route.started = true; route(); } });
