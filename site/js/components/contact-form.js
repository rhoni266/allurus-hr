/* Lead form ("Tell us you need this" and the #contact section): saved to Firestore `leads` over REST, so the
   landing page doesn't load the Firebase SDK. Visitors can only create a lead (fixed fields, consent required);
   superadmin reads and works them in /superadmin → Leads, where they also drive the Demand chart.
   Industries come from the catalogue; "Which features matter most?" lists the features of the industries ticked.
   If saving fails (offline), the visitor is offered WhatsApp or email with the details filled in. */
import { CONTACT } from "../config/site.js";
import { t, onLangChange, getLang } from "../i18n.js";
import { esc } from "../util.js";
import { loadCatalog, createLead } from "../lib/data.js";
import { industryFeatures } from "../lib/catalog.js";
import { indName } from "./industries.js";

const PHONE_RE = /^(?:\+?60|0)1\d{8,9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SIZES = ["lf_size_1", "lf_size_2", "lf_size_3", "lf_size_4", "lf_size_5"];
const EXTRA = [["core", "lf_core"], ["other", "lf_other"]];   // not industries: HR/payroll/finance only, and "Other"

export function mountContactForm(root) {
  let data = null, sent = false;
  let v = { businessName: "", contactName: "", phone: "", email: "", industries: [], other: "", size: "", features: [], something: false, notes: "", consent: false };

  const featureChoices = () => {
    if (!data) return [];
    const seen = new Map();
    for (const slug of v.industries) for (const f of industryFeatures(slug, data.links, data.featuresByKey, { publicOnly: true })) if (!seen.has(f.key)) seen.set(f.key, f);
    return [...seen.values()];
  };

  function render() {
    if (sent) return thanks();
    const inds = data ? data.industries : [];
    const feats = featureChoices();
    root.innerHTML = `
      <form class="form" novalidate>
        <div class="form-grid">
          ${field("businessName", "lf_business", 'autocomplete="organization" maxlength="150" required')}
          ${field("contactName", "lf_name", 'autocomplete="name" maxlength="100" required')}
          ${field("phone", "lf_phone", `type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="${esc(t("f_wa_ph"))}" required`)}
          ${field("email", "lf_email", 'type="email" inputmode="email" autocomplete="email" maxlength="200"', true)}
          <fieldset class="field full" aria-describedby="cf-industries-err">
            <legend>${esc(t("lf_industry"))}</legend>
            <div class="checks">
              ${inds.map((i) => box("industries", i.slug, indName(i), v.industries.includes(i.slug))).join("")}
              ${EXTRA.map(([id, k]) => box("industries", id, t(k), v.industries.includes(id))).join("")}
            </div>
            <span class="err" id="cf-industries-err"></span>
            <div class="field" ${v.industries.includes("other") ? "" : "hidden"} data-other>
              <label for="cf-other">${esc(t("lf_other_desc"))}</label><input id="cf-other" name="other" maxlength="200" value="${esc(v.other)}">
            </div>
          </fieldset>
          <div class="field full"><label for="cf-size">${esc(t("lf_size"))}</label>
            <select id="cf-size" name="size" required aria-describedby="cf-size-err">
              <option value="">${esc(t("f_staff_choose"))}</option>
              ${SIZES.map((k) => `<option value="${esc(t(k))}" ${v.size === t(k) ? "selected" : ""}>${esc(t(k))}</option>`).join("")}
            </select><span class="err" id="cf-size-err"></span></div>
          <fieldset class="field full" data-feats ${feats.length ? "" : "hidden"}>
            <legend>${esc(t("lf_features"))} <span class="opt">${esc(t("f_optional"))}</span></legend>
            <div class="checks">
              ${feats.map((f) => box("features", f.key, f.label, v.features.includes(f.key))).join("")}
              ${box("something", "1", t("lf_something"), v.something)}
            </div>
          </fieldset>
          <div class="field full"><label for="cf-notes">${esc(t("lf_notes"))} <span class="opt">${esc(t("f_optional"))}</span></label>
            <textarea id="cf-notes" name="notes" rows="3" maxlength="1800">${esc(v.notes)}</textarea></div>
          <div class="field full consent"><label><input type="checkbox" name="consent" id="cf-consent" ${v.consent ? "checked" : ""} aria-describedby="cf-consent-err"> ${esc(t("lf_consent"))}</label>
            <span class="err" id="cf-consent-err"></span></div>
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
    form.addEventListener("input", () => { v = read(form); });
    form.addEventListener("change", (e) => {
      v = read(form);
      if (e.target.name === "industries") { render(); root.querySelector(`input[name="industries"][value="${e.target.value}"]`)?.focus(); }
    });
    form.addEventListener("submit", submit);
  }

  const box = (name, value, label, checked) => `<label><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""}> ${esc(label)}</label>`;
  function field(id, label, attrs, optional = false) {
    return `<div class="field"><label for="cf-${id}">${esc(t(label))}${optional ? ` <span class="opt">${esc(t("f_optional"))}</span>` : ""}</label>
      <input id="cf-${id}" name="${id}" ${attrs} value="${esc(v[id])}" aria-describedby="cf-${id}-err"><span class="err" id="cf-${id}-err"></span></div>`;
  }
  function read(form) {
    const fd = new FormData(form), s = (k) => (fd.get(k) || "").toString().trim();
    return { businessName: s("businessName"), contactName: s("contactName"), phone: s("phone"), email: s("email"), industries: fd.getAll("industries"),
             other: s("other"), size: s("size"), features: fd.getAll("features"), something: fd.has("something"), notes: s("notes"), consent: fd.has("consent") };
  }
  function setErr(form, id, msg) {
    const err = form.querySelector(`#cf-${id}-err`), input = form.querySelector(`#cf-${id}`);
    if (err) err.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function validate(form) {
    let first = null;
    const need = (id, ok, msg, focusSel) => { setErr(form, id, ok ? "" : msg); if (!ok && !first) first = form.querySelector(focusSel || `#cf-${id}`); };
    need("businessName", v.businessName, t("f_err_required"));
    need("contactName", v.contactName, t("f_err_required"));
    need("phone", PHONE_RE.test(v.phone.replace(/[\s-]/g, "")), v.phone ? t("f_err_wa") : t("f_err_required"));
    need("email", !v.email || EMAIL_RE.test(v.email), t("f_err_email"));
    need("industries", v.industries.length > 0, t("lf_err_industry"), 'input[name="industries"]');
    need("size", v.size, t("f_err_required"));
    need("consent", v.consent, t("lf_err_consent"));
    first?.focus();
    return !first;
  }

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    v = read(form);
    if (form.website.value) return;                 // honeypot
    if (!validate(form)) return;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = t("f_sending");
    const notes = [v.something ? "Also needs something else (see notes)." : "", v.notes].filter(Boolean).join("\n");
    try {
      await createLead({ businessName: v.businessName, contactName: v.contactName, phone: v.phone, email: v.email || undefined,
        industryIds: v.industries, otherIndustry: v.industries.includes("other") ? v.other || undefined : undefined,
        featureInterests: v.features, teamSize: v.size, notes: notes || undefined, consent: true, status: "new", lang: getLang(), createdAt: new Date() });
      sent = true; thanks();
    } catch (err) {
      btn.disabled = false; btn.textContent = t("f_send");
      fallback(form);
    }
  }

  function fallback(form) {
    const names = v.industries.map((s) => (data?.industries.find((i) => i.slug === s) ? indName(data.industries.find((i) => i.slug === s)) : s));
    const text = [t("msg_intro"), "", `${t("lf_business")}: ${v.businessName}`, `${t("lf_name")}: ${v.contactName}`, `${t("lf_phone")}: ${v.phone}`,
      v.email ? `Email: ${v.email}` : "", `${t("lf_industry")}: ${names.join(", ")}${v.other ? ` (${v.other})` : ""}`, `${t("lf_size")}: ${v.size}`,
      v.features.length ? `${t("lf_features")}: ${v.features.map((k) => data?.featuresByKey[k]?.name || k).join(", ")}` : "", v.notes].filter(Boolean).join("\n");
    const box = form.querySelector(".form-result");
    box.hidden = false; box.classList.add("warn");
    box.innerHTML = `<p>${esc(t("f_fail"))}</p><div class="form-actions" style="margin-top:10px">
      <a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}">${esc(t("f_send_wa"))}</a>
      <a class="btn btn-ghost btn-sm" href="mailto:${CONTACT.email}?subject=${encodeURIComponent(t("msg_intro"))}&body=${encodeURIComponent(text)}">${esc(t("f_send_email"))}</a></div>`;
    box.focus();
  }

  function thanks() {
    root.innerHTML = `<div class="form thanks" role="status" tabindex="-1">
      <span class="thanks-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M5 12.5 10 17l9-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <h3>${esc(t("f_thanks_t", { name: v.contactName.split(" ")[0] || "" }))}</h3><p>${esc(t("f_thanks_d"))}</p>
      <p class="form-note">${esc(t("f_thanks_n", { email: CONTACT.email }))}</p></div>`;
    root.querySelector(".thanks").focus();
  }

  window.addEventListener("allurus:interest", (e) => {
    if (sent) return;
    const add = e.detail?.industries || (typeof e.detail === "string" ? [e.detail] : []);
    v.industries = [...new Set([...v.industries, ...add])];
    render();
  });

  render();
  onLangChange(render);
  loadCatalog().then((d) => { data = d; render(); });
}
