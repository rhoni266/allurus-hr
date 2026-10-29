/* "Which one is me?": three questions, one per screen, then the best-matching industry with its reasons and a
   second match. Questions, options and scoring come from finderRules (editable in /superadmin). */
import { t } from "../i18n.js";
import { esc } from "../util.js";
import { scoreFinder, industryFeatures } from "../lib/catalog.js";
import { indName, indTagline, statusBadge, wantIndustries } from "./industries.js";

let dlg = null;

export function openFinder(data, { onDetail, onChoose }) {
  if (!dlg) { dlg = document.createElement("dialog"); dlg.className = "finder"; dlg.setAttribute("aria-labelledby", "fdTitle"); document.body.appendChild(dlg); }
  const qs = data.questions;
  const answers = {};
  let step = 0;

  function question() {
    const q = qs[step];
    dlg.innerHTML = `
      <div class="fd-head"><p class="fd-step">${esc(t("fd_step", { n: step + 1, of: qs.length }))}</p>
        <button type="button" class="dl-close" data-x aria-label="${esc(t("ind_close"))}">×</button></div>
      <div class="fd-bar" aria-hidden="true"><i style="width:${(step / qs.length) * 100}%"></i></div>
      <h2 id="fdTitle">${esc(q.text)}</h2>
      <div class="fd-options" role="radiogroup" aria-labelledby="fdTitle">
        ${q.options.map((o) => `<button type="button" role="radio" aria-checked="${answers[q.id] === o.id}" class="fd-opt" data-opt="${esc(o.id)}">${esc(o.text)}</button>`).join("")}
      </div>
      <div class="fd-foot">${step ? `<button type="button" class="link-back" data-back>${esc(t("fd_back"))}</button>` : "<span></span>"}</div>`;
    dlg.querySelector(".fd-opt")?.focus();
  }

  function result() {
    const ranked = scoreFinder(answers, data.rules, data.industries);
    const [best, second] = ranked;
    if (!best) { dlg.innerHTML = `<h2 id="fdTitle">${esc(t("fd_none"))}</h2><div class="fd-foot"><button type="button" class="btn btn-primary" data-other>${esc(t("fd_other"))}</button></div>`; return; }
    const i = best.industry;
    const head = industryFeatures(i.slug, data.links, data.featuresByKey, { publicOnly: true }).filter((f) => f.isHeadline).slice(0, 3);
    dlg.innerHTML = `
      <div class="fd-head"><p class="fd-step">${esc(t("fd_result"))}</p><button type="button" class="dl-close" data-x aria-label="${esc(t("ind_close"))}">×</button></div>
      <h2 id="fdTitle">${esc(t("fd_you_look"))} <em>${esc(indName(i))}</em></h2>
      <div class="fd-card"><div class="ind-top"><h3>${esc(indName(i))}</h3>${statusBadge(i.status)}</div><p class="ind-for">${esc(indTagline(i))}</p>
        <ul class="ind-list">${head.map((f) => `<li>${esc(f.label)}</li>`).join("")}</ul></div>
      ${best.reasons.length ? `<p class="fd-why"><b>${esc(t("fd_why"))}</b></p><ul class="dl-checks">${best.reasons.slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${second ? `<p class="fd-also">${esc(t("fd_also"))} <button type="button" class="link-more" data-see="${esc(second.industry.slug)}">${esc(indName(second.industry))}</button></p>` : ""}
      <div class="fd-actions">
        <button type="button" class="btn btn-ghost" data-see="${esc(i.slug)}">${esc(t("fd_see"))}</button>
        <button type="button" class="btn btn-primary" data-choose="${esc(i.slug)}">${esc(t("dl_choose"))}</button>
      </div>
      <p class="fd-foot"><button type="button" class="link-back" data-other>${esc(t("fd_other"))}</button> · <button type="button" class="link-back" data-restart>${esc(t("fd_restart"))}</button></p>`;
    dlg.querySelector("[data-choose]").focus();
  }

  dlg.onclick = (e) => {
    const el = e.target.closest("button");
    if (!el) { if (e.target === dlg) dlg.close(); return; }
    if (el.dataset.opt) { answers[qs[step].id] = el.dataset.opt; step++; step < qs.length ? question() : result(); }
    else if (el.hasAttribute("data-back")) { step--; question(); }
    else if (el.hasAttribute("data-x")) dlg.close();
    else if (el.dataset.see) { dlg.close(); onDetail(el.dataset.see); }
    else if (el.dataset.choose) { dlg.close(); onChoose(el.dataset.choose); }
    else if (el.hasAttribute("data-other")) { dlg.close(); wantIndustries(["other"]); }
    else if (el.hasAttribute("data-restart")) { step = 0; Object.keys(answers).forEach((k) => delete answers[k]); question(); }
  };
  if (!qs.length) return;
  question();
  if (!dlg.open) dlg.showModal();
}
