/* ContactForm: demo request, saved to Firestore (collection "enquiries" in project allurus-hr) through the
   Firestore REST API, so the page doesn't load the Firebase SDK. The database rule only lets visitors create a
   document with these fields: name, company, email, phone, staff, message, at. Nothing can be read back from
   the website; enquiries are read in the Firebase console.
   Role and areas of interest are folded into `message` so the document stays within the allowed fields.
   If saving fails (offline, or the rule not yet published), the visitor is offered WhatsApp and email instead. */
import { CONTACT, ENQUIRY, MODULES, INDUSTRIES } from "../config/site.js";
import { t, onLangChange, STRINGS } from "../i18n.js";
import { esc } from "../util.js";

const PHONE_RE = /^(?:\+?60|0)1\d{8,9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = { name: 99, company: 150, email: 199, phone: 20, msg: 1500 };
const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${ENQUIRY.projectId}/databases/(default)/documents/${ENQUIRY.collection}?key=${ENQUIRY.apiKey}`;

const INTERESTS = [
  ...MODULES.map((m) => ({ id: m.id, key: `mod_${m.id}`, group: "mod" })),
  ...INDUSTRIES.map((i) => ({ id: i.id, key: `ind_${i.id}`, group: "ind" })),
];

export function mountContactForm(root) {
  let values = { name: "", company: "", role: "", email: "", phone: "", staff: "", interests: [], msg: "" };
  let sent = false;

  function render() {
    if (sent) { renderThanks(); return; }
    root.innerHTML = `
      <form class="form" novalidate>
        <div class="form-grid">
          ${field("name", "f_name", `autocomplete="name" maxlength="${MAX.name}" required`)}
          ${field("company", "f_company", `autocomplete="organization" maxlength="${MAX.company}" required`)}
          ${field("email", "f_email", `type="email" autocomplete="email" inputmode="email" maxlength="${MAX.email}" required`)}
          ${field("phone", "f_wa", `type="tel" inputmode="tel" autocomplete="tel" maxlength="${MAX.phone}" placeholder="${esc(t("f_wa_ph"))}" required`)}
          ${field("role", "f_role", `autocomplete="organization-title" maxlength="80" placeholder="${esc(t("f_role_ph"))}"`, true)}
          <div class="field"><label for="cf-staff">${esc(t("f_staff"))}</label>
            <select id="cf-staff" name="staff" required aria-describedby="cf-staff-err">
              <option value="">${esc(t("f_staff_choose"))}</option>
              ${[1, 2, 3, 4, 5].map((n) => { const v = t(`f_staff_${n}`); return `<option value="${esc(v)}" ${values.staff === v ? "selected" : ""}>${esc(v)}</option>`; }).join("")}
            </select><span class="err" id="cf-staff-err"></span></div>
          <fieldset class="field full">
            <legend>${esc(t("f_interest"))}</legend>
            ${[["modules_eyebrow", INTERESTS.filter((i) => i.group === "mod")], ["ind_eyebrow", INTERESTS.filter((i) => i.group === "ind")]].map(([h, list]) => `
              <p class="chk-h">${esc(t(h))}</p>
              <div class="checks">
                ${list.map((i) => `<label><input type="checkbox" name="interests" value="${i.id}" ${values.interests.includes(i.id) ? "checked" : ""}> ${esc(t(i.key))}</label>`).join("")}
              </div>`).join("")}
          </fieldset>
          <div class="field full"><label for="cf-msg">${esc(t("f_msg"))}</label>
            <textarea id="cf-msg" name="msg" rows="3" maxlength="${MAX.msg}">${esc(values.msg)}</textarea></div>
          <div class="hp" aria-hidden="true"><label for="cf-web">Website</label><input id="cf-web" name="website" tabindex="-1" autocomplete="off"></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${esc(t("f_send"))}</button>
          <a class="btn btn-ghost" href="https://wa.me/${CONTACT.whatsapp}" target="_blank" rel="noopener">${esc(t("f_or_wa"))}</a>
        </div>
        <p class="form-note">${esc(t("f_note"))}</p>
        <div class="form-result" role="status" tabindex="-1" hidden></div>
      </form>`;

    const form = root.querySelector("form");
    form.addEventListener("input", () => { values = read(form); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      values = read(form);
      if (form.website.value) return;              // honeypot: bots fill every field
      if (!validate(form)) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = t("f_sending");
      try {
        await save();
        sent = true;
        renderThanks();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = t("f_send");
        showFallback(form);
      }
    });
  }

  function field(id, label, attrs, optional = false) {
    return `<div class="field"><label for="cf-${id}">${esc(t(label))}${optional ? ` <span class="opt">${esc(t("f_optional"))}</span>` : ""}</label>
      <input id="cf-${id}" name="${id}" ${attrs} value="${esc(values[id])}" aria-describedby="cf-${id}-err"><span class="err" id="cf-${id}-err"></span></div>`;
  }

  function read(form) {
    const fd = new FormData(form);
    const s = (k) => (fd.get(k) || "").toString().trim();
    return { name: s("name"), company: s("company"), role: s("role"), email: s("email"), phone: s("phone"),
             staff: s("staff"), interests: fd.getAll("interests"), msg: s("msg") };
  }

  function setErr(form, id, msg) {
    const err = form.querySelector(`#cf-${id}-err`);
    const input = form.querySelector(`#cf-${id}`);
    if (err) err.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function validate(form) {
    let first = null;
    const need = (id, ok, msg) => { setErr(form, id, ok ? "" : msg); if (!ok && !first) first = form.querySelector(`#cf-${id}`); };
    need("name", values.name, t("f_err_required"));
    need("company", values.company, t("f_err_required"));
    need("email", EMAIL_RE.test(values.email), values.email ? t("f_err_email") : t("f_err_required"));
    need("phone", PHONE_RE.test(values.phone.replace(/[\s-]/g, "")), values.phone ? t("f_err_wa") : t("f_err_required"));
    need("staff", values.staff, t("f_err_required"));
    if (first) first.focus();
    return !first;
  }

  // Everything that isn't one of the allowed fields goes into `message`, in English so the inbox reads the same.
  function composeMessage() {
    const label = (id) => { const i = INTERESTS.find((x) => x.id === id); return i ? (STRINGS.en[i.key] ?? id) : id; };
    const lines = [];
    if (values.role) lines.push(`Role: ${values.role}`);
    if (values.interests.length) lines.push(`Interested in: ${values.interests.map(label).join(", ")}`);
    lines.push(`Language: ${document.documentElement.lang}`);
    if (values.msg) lines.push("", values.msg);
    return lines.join("\n").slice(0, 1990);
  }

  async function save() {
    const str = (v) => ({ stringValue: v });
    const body = { fields: {
      name: str(values.name.slice(0, MAX.name)),
      company: str(values.company.slice(0, MAX.company)),
      email: str(values.email.slice(0, MAX.email)),
      phone: str(values.phone.slice(0, MAX.phone)),
      staff: str(values.staff),
      message: str(composeMessage()),
      at: { timestampValue: new Date().toISOString() },
    } };
    const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Enquiry not saved (${res.status})`);
  }

  function showFallback(form) {
    const text = [t("msg_intro"), "", `${t("msg_name")}: ${values.name}`, `${t("msg_company")}: ${values.company}`,
      `Email: ${values.email}`, `${t("msg_wa")}: ${values.phone}`, `${t("msg_staff")}: ${values.staff}`, "", composeMessage()].join("\n");
    const box = form.querySelector(".form-result");
    box.hidden = false;
    box.classList.add("warn");
    box.innerHTML = `<p>${esc(t("f_fail"))}</p>
      <div class="form-actions" style="margin-top:10px">
        <a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}">${esc(t("f_send_wa"))}</a>
        <a class="btn btn-ghost btn-sm" href="mailto:${CONTACT.email}?subject=${encodeURIComponent(t("msg_intro"))}&body=${encodeURIComponent(text)}">${esc(t("f_send_email"))}</a>
      </div>`;
    box.focus();
  }

  function renderThanks() {
    root.innerHTML = `<div class="form thanks" role="status" tabindex="-1">
        <span class="thanks-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17l9-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <h3>${esc(t("f_thanks_t", { name: values.name.split(" ")[0] || "" }))}</h3>
        <p>${esc(t("f_thanks_d"))}</p>
        <p class="form-note">${esc(t("f_thanks_n", { email: CONTACT.email }))}</p>
      </div>`;
    root.querySelector(".thanks").focus();
  }

  // "Tell us you need this" on an industry card pre-ticks it here.
  window.addEventListener("allurus:interest", (e) => {
    if (sent || values.interests.includes(e.detail)) return;
    values.interests = [...values.interests, e.detail];
    const box = root.querySelector(`input[name="interests"][value="${e.detail}"]`);
    if (box) box.checked = true;
  });

  render();
  onLangChange(render);
}
