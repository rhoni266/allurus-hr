// allurus.my/join: Simplified "Zero-Friction" Staff Onboarding wizard for non-tech-savvy ("IT blind") staff.
// 1 screen = 1 input, numeric-only keypads, auto-strips dashes/spaces, and instant auto-approval.
// When accessed via /join?c=COMPANY_CODE, company code is locked in background silently.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth, FS] = await Promise.all([
  import(`${SDK}/firebase-app.js`),
  import(`${SDK}/firebase-auth.js`),
  import(`${SDK}/firebase-firestore.js`)
]);
const fb = initializeApp(window.ALLURUS_FIREBASE);
const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);
const M = window.AllurusCloudMap, P = window.AllurusPassword, I = window.AllurusInvite;
const root = document.getElementById('ac');

const urlParams = new URLSearchParams(location.search);
const secret = urlParams.get('k') || '';
const codeParam = (urlParams.get('c') || urlParams.get('code') || '').trim().toLowerCase();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = '<svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0F766E"/><path d="M19 47 L32 17 L45 47" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23.5 37.5 Q32 32 40.5 37.5" fill="none" stroke="#D9B66F" stroke-width="4.5" stroke-linecap="round"/></svg>';

function getDeviceId() {
  if (window.AllurusCloudMap?.getDeviceId) {
    return window.AllurusCloudMap.getDeviceId();
  }
  let id = localStorage.getItem('allurus_device_id') || localStorage.getItem('allurus-device-id');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
    try {
      localStorage.setItem('allurus_device_id', id);
      localStorage.setItem('allurus-device-id', id);
    } catch (e) {}
  }
  return id;
}

function getStaffSession() {
  let sess = null;
  try {
    const raw = localStorage.getItem('allurus_staff_session');
    if (raw) sess = JSON.parse(raw);
  } catch (e) {}
  if (!sess) {
    try {
      const m = document.cookie.match(/(?:^|;\s*)allurus_staff_token=([^;]+)/);
      if (m) sess = JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {}
  }
  if (sess && ('pin' in sess || 'ic' in sess)) { delete sess.pin; delete sess.ic; saveStaffSession(sess); } // migrate away a stored PIN or IC number
  return sess;
}

function saveStaffSession(sess) {
  try {
    localStorage.setItem('allurus_staff_session', JSON.stringify(sess));
    document.cookie = `allurus_staff_token=${encodeURIComponent(JSON.stringify(sess))}; max-age=315360000; path=/; SameSite=Lax`;
  } catch (e) {}
}

function renderScreen({ badge = '', pill = '', title = '', sub = '', card = '', foot = true }) {
  root.innerHTML = `
    <div class="login-inner">
      <div class="login-brand">${MARK}</div>
      ${badge ? `<div class="company-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/></svg><span>${esc(badge)}</span></div>` : ''}
      ${pill ? `<div><span class="wizard-pill">${esc(pill)}</span></div>` : ''}
      <h1 style="margin-bottom:6px">${title}</h1>
      ${sub ? `<p class="sub" style="margin-bottom:18px">${sub}</p>` : ''}
      <div class="login-card" style="box-shadow:var(--shadow)">${card}</div>
      ${foot ? `<p class="faint" style="font-size:12.5px;margin-top:16px">Sudah mendaftar? / Already registered? <a href="/app">Log Masuk / Sign in</a></p>` : ''}
    </div>`;
  root.querySelector('input')?.focus();
}

function problem(title, text) {
  renderScreen({
    title: esc(title),
    card: `<p class="login-error" role="alert" style="margin-bottom:14px">${text}</p><a class="btn btn-primary login-submit btn-lg" href="/app">Ke Log Masuk / Go to Sign in</a>`
  });
}

// ============================================================================
// Zero-Friction Staff Onboarding Wizard (1 Screen = 1 Input)
// ============================================================================

// Screen 0: Enter Company Code (Only if ?c= was NOT in the URL)
function companyCodeScreen(msg = '') {
  renderScreen({
    pill: 'Langkah Mula · Kod Syarikat',
    title: 'Sertai Syarikat Anda',
    sub: 'Masukkan kod syarikat daripada HR anda untuk memulakan pendaftaran.',
    card: `
      <form id="f-code" novalidate style="display:flex;flex-direction:column;gap:14px" autocomplete="off">
        <div class="field">
          <input class="input input-lg" id="code-in" name="code" type="text" placeholder="Contoh: majorf434" autocapitalize="none" autocomplete="off" spellcheck="false" required autofocus>
          <p class="faint" style="font-size:13px;margin:6px 0 0;text-align:center">Kod syarikat diberikan oleh pengurus atau bahagian HR anda.</p>
        </div>
        <p class="login-error" id="err-code" role="alert" ${msg ? '' : 'hidden'}>${esc(msg)}</p>
        <button class="btn btn-primary btn-lg login-submit" type="submit" id="go-code">Seterusnya / Continue</button>
      </form>`
  });

  const form = document.getElementById('f-code');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const code = String(form.code.value || '').trim().toLowerCase();
    const btn = document.getElementById('go-code');
    const err = document.getElementById('err-code');
    if (!/^[a-z0-9]{3,12}$/.test(code)) {
      err.textContent = 'Sila masukkan kod syarikat yang sah (3-12 aksara).';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Memeriksa…';
    initWizardWithCode(code);
  });
}

async function initWizardWithCode(code) {
  try {
    const c = await FS.getDoc(FS.doc(db, `companyCodes/${code}`)).catch(() => null);
    if (!c?.exists()) {
      companyCodeScreen('Kod syarikat tidak dijumpai. Sila periksa semula ejaan kod anda.');
      return;
    }
    const data = c.data();
    const ctx = {
      code,
      tenantId: data.tenantId,
      companyName: data.company || 'Allurus HR',
      salt: data.salt || ''
    };
    step1_ic(ctx);
  } catch (e) {
    companyCodeScreen('Tidak dapat berhubung dengan pelayan. Sila cuba sebentar lagi.');
  }
}

// ----------------------------------------------------------------------------
// Step 1: Enter IC Number (Verification & Auto-Approval)
// ----------------------------------------------------------------------------
function step1_ic(ctx, msg = '') {
  renderScreen({
    badge: ctx.companyName,
    pill: 'Langkah 1 daripada 3 · No. IC',
    title: 'Sila Masukkan No. IC Anda',
    sub: 'Please enter your 12-digit IC number',
    card: `
      <form id="f-ic" novalidate style="display:flex;flex-direction:column;gap:14px" autocomplete="off">
        <div class="field">
          <input class="input input-lg" id="ic-in" name="ic" type="tel" inputmode="numeric" placeholder="Contoh: 850101115221" autocomplete="off" autofocus required>
          <div class="ic-clean-preview" id="ic-preview" aria-live="polite"></div>
        </div>
        <div id="welcome-slot"></div>
        <div id="err-slot">
          ${msg ? `<p class="login-error" role="alert" style="margin:0">${esc(msg)}</p>` : ''}
        </div>
        <button class="btn btn-primary btn-lg login-submit" type="submit" id="go-ic">Semak & Teruskan / Continue</button>
      </form>`
  });

  const form = document.getElementById('f-ic');
  const icInput = document.getElementById('ic-in');
  const preview = document.getElementById('ic-preview');
  const errSlot = document.getElementById('err-slot');
  const welcomeSlot = document.getElementById('welcome-slot');
  const btn = document.getElementById('go-ic');

  // Real-time auto-clean input: strips dashes, spaces, and non-digits immediately
  icInput.addEventListener('input', () => {
    const raw = icInput.value.replace(/\D/g, '').slice(0, 12);
    if (icInput.value !== raw) icInput.value = raw;
    if (raw.length >= 6) {
      preview.textContent = raw.length === 12
        ? `No. IC: ${raw.slice(0, 6)}-${raw.slice(6, 8)}-${raw.slice(8)}`
        : `No. IC: ${raw.slice(0, 6)}-${raw.slice(6)}`;
    } else {
      preview.textContent = '';
    }
    errSlot.innerHTML = '';
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ic = icInput.value.replace(/\D/g, '');
    if (ic.length !== 12) {
      errSlot.innerHTML = '<p class="login-error" role="alert" style="margin:0">Sila masukkan 12 digit nombor IC tanpa simbol.</p>';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Menyemak rekod…';

    try {
      const k = await FS.getDoc(FS.doc(db, `staffKeys/${ctx.tenantId}~${ic}`)).catch(() => null);
      if (!k?.exists()) {
        btn.disabled = false;
        btn.textContent = 'Semak & Teruskan / Continue';
        const hrWaMsg = encodeURIComponent(`Salam HR, saya ingin mendaftar di Allurus untuk ${ctx.companyName} tetapi No. IC saya (${ic}) tiada dalam rekod.`);
        errSlot.innerHTML = `
          <div class="login-error" role="alert" style="text-align:left;line-height:1.45;margin:0">
            <b>No. IC tiada dalam rekod HR.</b><br>
            Sila pastikan nombor IC anda betul atau hubungi pihak HR syarikat anda.
          </div>
          <a class="btn btn-sm" href="https://wa.me/?text=${hrWaMsg}" target="_blank" rel="noopener" style="margin-top:6px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#25d366;color:#fff;border-color:#25d366;text-decoration:none">
            Hubungi HR via WhatsApp
          </a>`;
        return;
      }

      const kData = k.data();
      // No phone lock here. The old "1 Pekerja = 1 Telefon" check refused anyone whose IC key held another device id
      // (even after HR changed the record) and put the IC in a WhatsApp text. Phones are now handled after sign-in by
      // the one-phone rule (docs/ONE-PHONE-SPEC.md), where HR approves a new phone.

      // staffKeys is readable without signing in (so this IC check can run before auth), so it never holds a
      // name - anyone who guessed a tenantId + IC could otherwise read a real employee's name. Security gap 3,
      // 2026-11-07 review.
      ctx.staff = {
        ic,
        empId: kData.empId || '',
        gen: Number(kData.gen) || 1
      };

      // Green welcome banner + auto-approval feedback (no name shown here: not signed in yet)
      welcomeSlot.innerHTML = `
        <div class="welcome-box">
          <span class="welcome-badge">✓ Rekod Ditemui / Record Found</span>
          <h3 style="margin:4px 0 0;font-size:18px">Jumpa! Teruskan pendaftaran anda.</h3>
        </div>`;
      btn.textContent = 'Disahkan ✓';
      btn.classList.add('btn-ok');

      // Auto-advance to Step 2 smoothly
      setTimeout(() => step2_phone(ctx), 850);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Semak & Teruskan / Continue';
      errSlot.innerHTML = '<p class="login-error" role="alert" style="margin:0">Masalah sambungan internet. Sila cuba lagi.</p>';
    }
  });
}

// ----------------------------------------------------------------------------
// Step 2: Enter Phone Number (Extra Data)
// ----------------------------------------------------------------------------
function step2_phone(ctx) {
  renderScreen({
    badge: ctx.companyName,
    pill: 'Langkah 2 daripada 3 · No. Telefon',
    title: 'Hai 👋',
    sub: 'Sila masukkan No. Telefon anda / Enter your phone number',
    card: `
      <form id="f-phone" novalidate style="display:flex;flex-direction:column;gap:14px" autocomplete="off">
        <div class="field">
          <input class="input input-lg" id="phone-in" name="phone" type="tel" inputmode="tel" placeholder="Contoh: 0123456789" autocomplete="tel" autofocus>
          <p class="faint" style="font-size:13px;margin:6px 0 0;text-align:center">Untuk rekod dan komunikasi penting daripada HR.</p>
        </div>
        <p class="login-error" id="err-phone" role="alert" hidden></p>
        <button class="btn btn-primary btn-lg login-submit" type="submit" id="go-phone">Seterusnya / Continue</button>
        <button type="button" class="link-btn" id="skip-phone" style="font-size:13px;margin-top:4px">Langkau langkah ini / Skip</button>
      </form>`
  });

  const form = document.getElementById('f-phone');
  const phoneIn = document.getElementById('phone-in');
  const skipBtn = document.getElementById('skip-phone');

  // Real-time auto-clean input
  phoneIn.addEventListener('input', () => {
    const raw = phoneIn.value.replace(/[^0-9+]/g, '');
    if (phoneIn.value !== raw) phoneIn.value = raw;
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const p = M.normPhone(phoneIn.value);
    const err = document.getElementById('err-phone');
    if (!M.validPhone(p)) { err.textContent = 'No. telefon tidak sah / Phone number not valid'; err.hidden = false; phoneIn.focus(); return; }
    err.hidden = true;
    ctx.staff.phone = p;
    step3_pin(ctx);
  });

  skipBtn.addEventListener('click', () => {
    ctx.staff.phone = '';
    step3_pin(ctx);
  });
}

// The phone typed at registration goes on the person's employee record, so HR sees it. Only into an empty phone;
// if HR already has a different one, it waits in phoneNew for HR to use or keep (firestore.rules: people/{e}).
async function savePhone(tenantId, empId, phone) {
  const ref = FS.doc(db, `tenants/${tenantId}/people/${empId}`);
  const snap = await FS.getDoc(ref);
  let cur = '';
  try { cur = snap.exists() && snap.data().phone ? String(M.dec(snap.data().phone) || '') : ''; } catch (e) { cur = ''; }
  if (M.normPhone(cur) === phone) return;
  if (!cur) await FS.updateDoc(ref, { phone: M.enc(phone) });
  else await FS.updateDoc(ref, { phoneNew: M.enc(phone), phoneNewAt: M.enc(new Date().toISOString().slice(0, 10)) });
}

// ----------------------------------------------------------------------------
// Step 3: Create a 6-digit PIN, typed twice (docs/JOIN-AUTOLINK-SPEC.md)
// ----------------------------------------------------------------------------
// After the account is made, a new sign-up on the open page links itself to its own employee record when HR's staffLinks document says
// which one it is (firestore.rules checks everything again), then goes straight into the app. If that is not possible the person still
// goes into the app and sees "waiting for HR approval". The same step is used by a personal join link and by "Reset sign-in".
async function tryAutoLink(ctx, uid) {
  // Personal links already carry the employee. Otherwise read the document HR keeps for this IC (readable only by this sign-in).
  if (ctx.staff.empId) return { linked: true, empId: ctx.staff.empId };
  try {
    const lk = await FS.getDoc(FS.doc(db, `staffLinks/${ctx.tenantId}~${ctx.staff.ic}`));
    if (!lk.exists()) return { linked: false, why: 'none' };
    const L = lk.data();
    if (L.hasSignIn) return { linked: false, why: 'has-sign-in' };
    const bad = M.linkProblem(L.empId, [{ id: L.empId }]);            // the same shape check HR's approval makes
    if (bad) return { linked: false, why: 'bad' };
    await FS.updateDoc(FS.doc(db, `users/${uid}`), { empId: L.empId, autoLinkedAt: FS.serverTimestamp() });
    return { linked: true, empId: L.empId, auto: true };
  } catch (e) {
    console.warn('[Allurus join] auto-link not done', e?.code);        // off, not allowed, or the phone check did not match: HR approves it
    return { linked: false, why: 'refused' };
  }
}
// The linked record's first name, for the welcome and the sign-in's display name (read with the person's own access).
async function nameFromRecord(ctx, uid, empId) {
  try {
    const snap = await FS.getDoc(FS.doc(db, `tenants/${ctx.tenantId}/people/${empId}`));
    if (!snap.exists()) return '';
    const first = String(M.dec(snap.data().first) || '').trim(), last = String(M.dec(snap.data().last) || '').trim();
    const full = `${first} ${last}`.trim();
    if (full) await FS.updateDoc(FS.doc(db, `users/${uid}`), { name: full.slice(0, 100) }).catch(() => {});
    return first;
  } catch (e) { return ''; }
}
function goIntoApp(firstName) {
  try { if (firstName) sessionStorage.setItem('allurus-welcome', firstName); } catch (e) { /* the welcome is a nicety */ }
  setTimeout(() => location.replace('/app?activated'), 900);
}

function step3_pin(ctx) {
  renderScreen({
    badge: ctx.companyName,
    pill: 'Langkah 3 daripada 3 · Cipta PIN',
    title: 'Cipta 6 Angka PIN',
    sub: 'Create 6-digit PIN for login',
    card: `
      <form id="f-pin" novalidate style="display:flex;flex-direction:column;gap:14px" autocomplete="off">
        <p class="faint" style="font-size:13px;margin:0;text-align:center">Pilih 6 nombor mudah diingati untuk log masuk seterusnya. Taip dua kali.</p>
        <div class="field">
          <label for="pin-in" style="font-size:13px;font-weight:600">PIN</label>
          <input class="input input-lg input-pin" id="pin-in" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="••••••" autocomplete="new-password" autofocus required>
        </div>
        <div class="field">
          <label for="pin2-in" style="font-size:13px;font-weight:600">Masukkan semula PIN / Confirm PIN</label>
          <input class="input input-lg input-pin" id="pin2-in" name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="••••••" autocomplete="new-password" required>
          <div style="display:flex;justify-content:center;margin-top:10px">
            <button type="button" class="btn btn-sm btn-ghost" id="toggle-pin" style="font-size:13px;border-radius:999px">👁️ Tunjuk / Show</button>
          </div>
        </div>
        <p class="login-error" id="err-pin" role="alert" hidden></p>
        <button class="btn btn-primary btn-lg login-submit" type="submit" id="go-pin" disabled>Selesai & Masuk Aplikasi 🎉</button>
        <button type="button" class="link-btn" id="back-step" style="font-size:13px;margin-top:2px">Kembali / Back</button>
      </form>`
  });

  const form = document.getElementById('f-pin');
  const pinIn = document.getElementById('pin-in');
  const pin2In = document.getElementById('pin2-in');
  const toggleBtn = document.getElementById('toggle-pin');
  const errPin = document.getElementById('err-pin');
  const btn = document.getElementById('go-pin');
  const backBtn = document.getElementById('back-step');
  const idle = 'Selesai & Masuk Aplikasi 🎉';

  // Digits only, six at most; the button stays off until both boxes have six digits.
  const clean = (el) => { const raw = el.value.replace(/\D/g, '').slice(0, 6); if (el.value !== raw) el.value = raw; };
  const refresh = () => { btn.disabled = !(pinIn.value.length === 6 && pin2In.value.length === 6); errPin.hidden = true; };
  pinIn.addEventListener('input', () => { clean(pinIn); refresh(); });
  pin2In.addEventListener('input', () => { clean(pin2In); refresh(); });

  // One "Show" for both boxes.
  toggleBtn.addEventListener('click', () => {
    const isPw = pinIn.type === 'password';
    pinIn.type = pin2In.type = isPw ? 'text' : 'password';
    toggleBtn.textContent = isPw ? '🔒 Sembunyi / Hide' : '👁️ Tunjuk / Show';
  });

  backBtn.addEventListener('click', () => step2_phone(ctx));

  let busy = false;
  const fail = (html) => { busy = false; btn.disabled = false; btn.textContent = idle; errPin.innerHTML = html; errPin.hidden = false; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;

    const pp = M.pinPair(pinIn.value, pin2In.value);
    if (!pp.ready) {
      if (pp.mismatch) { pin2In.value = ''; btn.disabled = true; errPin.textContent = 'PIN tidak sama. Sila cuba lagi. / PINs don’t match.'; errPin.hidden = false; pin2In.focus(); return; }
      errPin.textContent = 'Sila masukkan 6 angka nombor sahaja / Please enter 6 digits.'; errPin.hidden = false; return;
    }
    const pin = pp.pin;

    busy = true;
    btn.disabled = true;
    btn.textContent = 'Mendaftar…';

    const deviceId = getDeviceId();
    const email = M.staffEmail(ctx.staff.ic, ctx.tenantId, ctx.staff.gen);

    const already = await signedInHere();
    if (already) { signedInScreen(already); return; }
    let cred, existing = false;
    try {
      cred = await Auth.createUserWithEmailAndPassword(auth, email, pin);
    } catch (e) {
      if (e?.code === 'auth/email-already-in-use') {
        // This IC already has a sign-in: the right PIN signs in and goes straight into the app.
        try { cred = await Auth.signInWithEmailAndPassword(auth, email, pin); existing = true; }
        catch (signInErr) {
          if (signInErr?.code === 'auth/network-request-failed') { fail('Masalah sambungan internet. Sila cuba lagi.'); return; }
          pin2In.value = ''; fail('PIN salah. Lupa PIN? Minta HR tekan Reset sign-in. / Wrong PIN. Forgot it? Ask HR to press Reset sign-in.'); return;
        }
      } else {
        fail(e?.code === 'auth/network-request-failed' ? 'Masalah sambungan internet. Sila cuba lagi.' : 'Gagal membuat akaun. Sila hubungi HR anda.');
        return;
      }
    }
    const uid = cred.user.uid;

    // Each save is its own step, tried twice. Errors are logged by code only: never the IC, phone or PIN.
    const twice = async (fn) => { try { await fn(); return true; } catch (e) { console.warn('[Allurus join] save failed, retrying', e?.code); } try { await fn(); return true; } catch (e) { console.warn('[Allurus join] save failed', e?.code); return false; } };
    // A sign-in that already exists keeps its profile (the rules do not let it be rewritten here).
    const mine = existing ? await FS.getDoc(FS.doc(db, `users/${uid}`)).catch(() => null) : null;
    const hadProfile = !!(mine && mine.exists());
    const profileOk = hadProfile ? true : await twice(() => FS.setDoc(FS.doc(db, `users/${uid}`), {
      email,
      name: 'Staff', // replaced by the linked record's name once the link is made
      tenantId: ctx.tenantId,
      code: ctx.code,
      roles: ['employee'],
      empId: ctx.staff.empId || '',
      pending: false,
      via: 'open',
      phone: ctx.staff.phone || '',
      authType: 'pin',
      deviceId,
      deviceName: String((M.getDeviceName && M.getDeviceName()) || '').slice(0, 60),
      joinedAt: FS.serverTimestamp()
    }, { merge: true }));

    // Link to their own record (open page, company switch on, HR's staffLinks document), then the name and the phone.
    let link = { linked: !!(hadProfile ? mine.data().empId : ctx.staff.empId), empId: hadProfile ? mine.data().empId : ctx.staff.empId };
    if (profileOk && !link.linked && !(hadProfile && mine.data().via !== 'open')) link = await tryAutoLink(ctx, uid);
    let first = '';
    if (profileOk && link.linked && link.empId) {
      first = await nameFromRecord(ctx, uid, link.empId);
      if (ctx.staff.phone && !hadProfile) await twice(() => savePhone(ctx.tenantId, link.empId, ctx.staff.phone));
    }
    const phoneOk = true;

    if (profileOk && !hadProfile) {
      // Clean up legacy single-link invite if exists
      const key = `${ctx.tenantId}~${ctx.staff.ic}`;
      const invSnap = await FS.getDoc(FS.doc(db, `staffInvites/${key}`)).catch(() => null);
      if (invSnap?.exists()) {
        const lnk = invSnap.data().link;
        if (lnk) await FS.deleteDoc(FS.doc(db, `joinLinks/${lnk}`)).catch(() => {});
        await FS.deleteDoc(FS.doc(db, `staffInvites/${key}`)).catch(() => {});
      }
    }
    if (profileOk) {
      // Save persistent staff session for "Never Log Out" policy (10-year expiry). Firebase Auth's own
      // persistence is what actually keeps the sign-in alive; this never stores the PIN itself.
      saveStaffSession({ email, tenantId: ctx.tenantId, code: ctx.code, deviceId });
    }

    if (!profileOk || !phoneOk) {
      // A note for HR (Team access shows it), without the IC or phone. Best effort: HR is also told by the person.
      await FS.setDoc(FS.doc(db, `tenants/${ctx.tenantId}/joinIssues/${uid}`), { kind: profileOk ? 'phone' : 'profile', empId: ctx.staff.empId || '', at: FS.serverTimestamp() }).catch((e) => console.warn('[Allurus join] note for HR not saved', e?.code));
      busy = false;
      renderScreen({
        badge: ctx.companyName,
        title: 'Hampir siap',
        sub: 'Almost done',
        card: `<p class="login-error" role="alert" style="display:block">Akaun dibuat tetapi maklumat belum disimpan. Sila maklumkan HR.<br>Account created but details not saved. Please tell HR.</p>`,
        foot: false
      });
      return;
    }

    renderScreen({
      badge: ctx.companyName,
      title: link.linked ? 'Pendaftaran Berjaya! 🎉' : 'Pendaftaran Diterima',
      sub: link.linked ? 'Registration Successful!' : 'Registration received',
      card: `
        <div class="welcome-box" style="margin-bottom:12px">
          <p style="font-size:15px;margin:0 0 6px"><b>${link.linked ? `Selamat datang${first ? ', ' + esc(first) : ''}!` : 'Akaun anda sedang menunggu kelulusan HR'}</b></p>
          <p style="font-size:13.5px;margin:0">${link.linked ? 'Membuka aplikasi Allurus anda…' : 'Your account is waiting for HR approval. Membuka aplikasi…'}</p>
        </div>
        <p class="ac-ok" role="status">Lain kali, gunakan kod syarikat <b>${esc(ctx.code)}</b>, No. IC dan PIN 6 angka anda untuk log masuk.</p>
        ${window.AllurusDevice && window.AllurusDevice.here() !== 'phone' ? `<p class="ac-note" style="margin-top:10px"><b>${esc(window.AllurusDevice.TEXT.ms.joined)}</b><br>${esc(window.AllurusDevice.TEXT.en.joined)}</p>` : ''}`,
      foot: false
    });

    // Already signed in: straight into the app (their staff screen, or the waiting screen). No second sign-in.
    goIntoApp(link.linked ? first : '');
  });
}

// ============================================================================
// Legacy Personal Secret Link (/join?k=<secret>)
// ============================================================================
async function personalLink(k) {
  if (k.length < 24) {
    problem('Pautan Tidak Sah', 'Pautan pendaftaran ini tidak sah. Sila hubungi HR anda.');
    return;
  }
  const snap = await FS.getDoc(FS.doc(db, `joinLinks/${k}`)).catch(() => null);
  if (!snap?.exists()) {
    problem('Pautan Tidak Sah', 'Pautan ini mungkin telah diganti atau tamat tempoh. Sila minta pautan baharu daripada HR.');
    return;
  }
  const link = snap.data();
  if (!I.usable(link)) {
    problem('Pautan Tamat Tempoh', 'Pautan pendaftaran sah selama 7 hari. Sila minta pautan baharu daripada HR.');
    return;
  }

  // Pre-fill context from personal link
  const ctx = {
    code: link.code || '',
    tenantId: link.tenantId,
    companyName: link.company || 'Allurus HR',
    staff: {
      ic: link.ic || '',
      name: link.name || 'Staff',
      empId: link.empId || '',
      gen: Number(link.gen) || 1
    }
  };

  if (ctx.staff.ic) {
    step2_phone(ctx);
  } else {
    step1_ic(ctx);
  }
}

// ============================================================================
// Someone is already signed in on this phone
// ============================================================================
// Who, if anyone, is signed in here: Firebase's own session, or the remembered staff session. null = nobody.
async function signedInHere() {
  try { await (auth.authStateReady ? auth.authStateReady() : new Promise((r) => { const u = Auth.onAuthStateChanged(auth, () => { u(); r(); }); })); } catch (e) { /* carry on */ }
  const u = auth.currentUser, sess = getStaffSession();
  if (!u && !(sess && (sess.email || sess.tenantId))) return null;
  let name = '';
  if (u) { try { const s = await FS.getDoc(FS.doc(db, `users/${u.uid}`)); name = String(s.data()?.name || '').trim().split(/\s+/)[0] || ''; } catch (e) { /* no name */ } }
  return { name: name.slice(0, 40), user: !!u };
}
function signedInScreen(who) {
  const nm = who.name ? esc(who.name) : '', en = nm ? `<b>${nm}</b>` : 'someone else', ms = nm ? `<b>${nm}</b>` : 'orang lain';
  renderScreen({
    title: 'Telefon ini sudah log masuk',
    sub: `This phone is signed in as ${en}.`,
    card: `<p style="margin-bottom:6px">Telefon ini sudah log masuk sebagai ${ms}. Log keluar dahulu untuk mendaftar diri anda.</p>
      <p class="muted" style="margin-bottom:16px">This phone is signed in as ${en}. Sign out to register yourself.</p>
      <button type="button" class="btn btn-primary login-submit btn-lg" id="so">Log Keluar / Sign out</button>
      <p class="faint" style="font-size:12.5px;margin-top:12px">Bukan anda? Not you? Sign out here, then open your join link again.</p>`,
    foot: false,
  });
  const btn = document.getElementById('so');
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Sedang log keluar…';
    await window.AllurusSession.signOutEverything({ Auth, auth, FS, db });
    location.replace(location.pathname + location.search);   // start again with nobody signed in
  });
}

// ============================================================================
// Entry Point
// ============================================================================
async function start() {
  if (!window.ALLURUS_FIREBASE?.apiKey) {
    problem('Tidak Tersedia', 'Pendaftaran memerlukan sambungan Allurus cloud.');
    return;
  }

  // Joining never reuses a sign-in. If anyone is signed in on this phone (Firebase's own session, or the remembered
  // staff session), say so and offer Sign out; register only after that. There is no redirect to /app any more: that
  // is how a worker opening his join link landed in an HR admin's account (incident 2026-11-11).
  const who = await signedInHere();
  if (who) { signedInScreen(who); return; }

  if (secret) {
    personalLink(secret);
  } else if (codeParam) {
    initWizardWithCode(codeParam);
  } else {
    companyCodeScreen();
  }
}

start();
