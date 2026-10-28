/* Account slot, top right of the landing page.
   Signed out: "Log in" (to /login, which opens the app's sign-in). Signed in to the cloud app on this browser: the
   person's name with a menu (Dashboard, Profile, Log out). The app keeps its session in localStorage under
   allurus-hr-cloud-v1 on this same domain, so the landing page reads it without loading Firebase.
   Firebase Auth itself still decides access: the app re-checks the sign-in when it opens. */
import { t, onLangChange } from "../i18n.js";
import { esc } from "../util.js";

const KEY = "allurus-hr-cloud-v1";

function signedIn() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s?.session?.account || !s.session.cloud?.uid) return null;
    const e = (s.employees || []).find((x) => x.id === s.session.empId);
    const name = e ? `${e.first || ""} ${e.last || ""}`.trim() : "";
    return { name: name || s.session.account, first: e?.first || name || s.session.account };
  } catch (err) { return null; }
}

export function mountAccount(root) {
  function render() {
    const me = signedIn();
    if (!me) { root.innerHTML = `<a class="nav-login" href="/login">${esc(t("nav_login"))}</a>`; return; }
    const initials = me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    root.innerHTML = `
      <button type="button" class="acct-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="acctMenu">
        <span class="acct-av" aria-hidden="true">${esc(initials)}</span><span class="acct-name">${esc(me.first)}</span>
      </button>
      <div class="acct-menu" id="acctMenu" role="menu" hidden>
        <p class="acct-who">${esc(me.name)}</p>
        <a role="menuitem" href="/app">${esc(t("acct_dashboard"))}</a>
        <a role="menuitem" href="/app#my-profile">${esc(t("acct_profile"))}</a>
        <a role="menuitem" href="/app?signout">${esc(t("acct_logout"))}</a>
      </div>`;
    const btn = root.querySelector(".acct-btn"), menu = root.querySelector(".acct-menu");
    const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("a").focus();
    });
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) close(); });
  }
  render();
  onLangChange(render);
  window.addEventListener("storage", (e) => { if (e.key === KEY) render(); });   // signed in/out in another tab
}
