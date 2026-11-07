// allurus.my/pos/start: GO-LIVE-POS.md step 2. An Owner or a Settings admin starts (or opens) their company's
// Allurus POS trial - provisioning the Google Sheet through the central Apps Script server (js/pos-trial.js),
// then setting addons.pos on the tenant doc. Not part of js/app.js: a small page of its own, like join.js.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const [{ initializeApp }, Auth, FS] = await Promise.all([
  import(`${SDK}/firebase-app.js`),
  import(`${SDK}/firebase-auth.js`),
  import(`${SDK}/firebase-firestore.js`)
]);
const fb = initializeApp(window.ALLURUS_FIREBASE);
const auth = Auth.getAuth(fb), db = FS.getFirestore(fb);
const PosTrial = window.AllurusPosTrial;
const StartLogic = window.AllurusPosStartLogic;
const root = document.getElementById('ac');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(card, { title = 'Point of sale', sub = '' } = {}) {
  root.innerHTML = `
    <div class="login-inner">
      <div class="login-brand"><img src="/assets/logo-mark.svg" alt="" width="56" height="56"></div>
      <h1 style="margin-bottom:6px">${esc(title)}</h1>
      ${sub ? `<p class="sub" style="margin-bottom:18px">${sub}</p>` : ''}
      <div class="login-card" style="box-shadow:var(--shadow)">${card}</div>
    </div>`;
  root.querySelector('input')?.focus();
}

function problem(text, extra = '') {
  render(`<p class="login-error" role="alert" style="margin:0 0 12px">${text}</p>${extra}<p class="faint" style="font-size:13px;margin-top:10px"><a href="/app?signout">Sign out</a></p>`, { title: 'Point of sale' });
}

// ---- Sign-in screen: Owners and Settings admins have a normal Allurus email + password account ----
function renderSignIn(error) {
  render(`
    <form id="f-signin" novalidate style="display:flex;flex-direction:column;gap:14px">
      <div class="pos-field"><label for="si-email">Email</label><input class="input" id="si-email" type="email" autocomplete="email" required></div>
      <div class="pos-field"><label for="si-pw">Password</label><input class="input" id="si-pw" type="password" autocomplete="current-password" required></div>
      ${error ? `<p class="login-error" role="alert" style="margin:0">${esc(error)}</p>` : ''}
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>`, { title: 'Point of sale', sub: 'Sign in as an Owner or a Settings admin to start or open your POS.' });
  document.getElementById('f-signin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = document.getElementById('si-email').value.trim();
    const pw = document.getElementById('si-pw').value;
    try {
      await Auth.signInWithEmailAndPassword(auth, email, pw);
    } catch (e) {
      renderSignIn('That email and password don’t match. Check them and try again.');
    }
  });
}

// ---- Already started: just the two next steps ----
function renderAlreadyOn(tenantId) {
  render(`
    <p class="ac-ok" role="status">Your POS is already on for this company.</p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
      <a class="btn btn-primary" href="/pos">Open the till</a>
      <a class="btn" href="/app#settings/users">Give your staff a POS role</a>
    </div>`, { title: 'Point of sale' });
}

// ---- The Start POS trial form ----
function renderStartForm(profile, tenantId) {
  render(`
    <form id="f-start" novalidate style="display:flex;flex-direction:column;gap:12px;text-align:left">
      <div class="pos-field"><label for="st-outlet">Outlet name</label><input class="input" id="st-outlet" maxlength="80" placeholder="My Cafe"></div>
      <label class="row" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="st-sst"> Registered for SST</label>
      <div class="pos-row2">
        <div class="pos-field"><label for="st-sst-pct">SST %</label><input class="input" id="st-sst-pct" type="number" min="0" max="20" step="0.5" value="6" disabled></div>
        <div class="pos-field"><label for="st-sst-no">SST number</label><input class="input" id="st-sst-no" maxlength="40" disabled></div>
      </div>
      <div class="pos-field"><label for="st-service">Service charge %</label><input class="input" id="st-service" type="number" min="0" max="20" step="0.5" value="0"></div>
      <div class="pos-field"><label for="st-header">Receipt header</label><input class="input" id="st-header" maxlength="120" placeholder="Optional"></div>
      <div class="pos-field"><label for="st-footer">Receipt footer</label><input class="input" id="st-footer" maxlength="120" placeholder="Thank you! See you again."></div>
      <label class="row" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="st-sample" checked> Load a sample menu to try it with</label>
      <p class="login-error" role="alert" id="st-err" hidden style="margin:0"></p>
      <button class="btn btn-primary" type="submit" id="st-go">Start POS trial</button>
    </form>`, { title: 'Start POS trial', sub: '30 days, free. One Google Sheet of your own, created now.' });

  const sstBox = document.getElementById('st-sst');
  sstBox.addEventListener('change', () => {
    document.getElementById('st-sst-pct').disabled = !sstBox.checked;
    document.getElementById('st-sst-no').disabled = !sstBox.checked;
  });

  document.getElementById('f-start').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('st-err'), go = document.getElementById('st-go');
    err.hidden = true;
    if (!window.ALLURUS_POS_SERVER) {
      err.textContent = 'The POS server isn’t set up yet. Ask Allurus to finish deployment first.';
      err.hidden = false;
      return;
    }
    go.disabled = true; go.textContent = 'Starting…';
    try {
      const idToken = await auth.currentUser.getIdToken();
      await PosTrial.start({
        apiUrl: window.ALLURUS_POS_SERVER, idToken, tenantId, uid: profile.uid,
        data: {
          outletName: document.getElementById('st-outlet').value.trim(),
          sstRegistered: sstBox.checked,
          sstPercent: Number(document.getElementById('st-sst-pct').value || 0),
          sstNumber: document.getElementById('st-sst-no').value.trim(),
          servicePercent: Number(document.getElementById('st-service').value || 0),
          receiptHeader: document.getElementById('st-header').value.trim(),
          receiptFooter: document.getElementById('st-footer').value.trim(),
          sampleMenu: document.getElementById('st-sample').checked
        },
        updateDoc: FS.updateDoc, tenantDocRef: FS.doc(db, 'tenants', tenantId), fetch: window.fetch.bind(window)
      });
      render(`
        <p class="ac-ok" role="status">POS trial started! Your Google Sheet is ready.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
          <a class="btn" href="/app#settings/users">Give your staff a POS role</a>
          <a class="btn btn-primary" href="/pos">Open the till</a>
        </div>`, { title: 'Point of sale' });
    } catch (e) {
      err.textContent = e?.message || 'Could not start the POS trial. Try again.';
      err.hidden = false;
      go.disabled = false; go.textContent = 'Start POS trial';
    }
  });
}

Auth.onAuthStateChanged(auth, async (user) => {
  if (!user) { renderSignIn(); return; }
  try {
    const snap = await FS.getDoc(FS.doc(db, 'users', user.uid));
    if (!snap.exists()) { problem('No Allurus workspace found for this sign-in.'); return; }
    const profile = { uid: user.uid, ...snap.data() };
    if (!StartLogic.canStartPosTrial(profile)) {
      problem('You need to be an Owner or have the Settings area to start the POS trial. Ask your admin.');
      return;
    }
    const tenantId = profile.tenantId;
    const co = await FS.getDoc(FS.doc(db, 'tenants', tenantId));
    if (StartLogic.posAlreadyOn(co.exists() ? co.data() : null)) renderAlreadyOn(tenantId);
    else renderStartForm(profile, tenantId);
  } catch (e) {
    problem('Something went wrong loading your workspace. Reload and try again.');
  }
});
