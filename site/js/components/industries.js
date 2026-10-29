/* Industries ("Find your industry"): finder button, industry cards, detail view (/industries/<slug>), mix-and-match
   strip and compare table. Everything comes from the catalogue (Firestore, or the bundled starter data), so
   superadmin changes show here without a code change. Planned industries lead with "Tell us you need this", which
   pre-selects them in the lead form (event "allurus:interest"). */
import { t, onLangChange, getLang } from "../i18n.js";
import { esc, rm } from "../util.js";
import { loadCatalog } from "../lib/data.js";
import { industryFeatures, compareMatrix, byModule } from "../lib/catalog.js";
import { openFinder } from "./finder.js";

const MODULE_KEY = { operations: "mod_operations", finance: "mod_finance", people: "mod_hr", payroll: "mod_payroll", other: "ind_mod_other" };
export const moduleName = (k, modules) => (MODULE_KEY[k] ? t(MODULE_KEY[k]) : modules?.find((m) => m.key === k)?.name || k);
export const indName = (i) => (getLang() === "ms" && i.ms?.name) || i.name;
export const indTagline = (i) => (getLang() === "ms" && i.ms?.tagline) || i.tagline;
export const statusBadge = (s) => `<span class="st st-${esc(s || "planned")}">${esc(t(`status_${s || "planned"}`))}</span>`;

/* Small illustrations for industries that have one (field `illustration`). Labelled "Illustration". */
const visuals = {
  pos: (i) => {
    const items = (i.sampleData?.length ? i.sampleData : []).slice(0, 6);
    const num = (v) => Number(String(v).replace(/[^0-9.]/g, "")) || 0;
    const order = [[0, 2], [2, 2], [4, 1]].filter(([n]) => items[n]);
    const total = order.reduce((a, [n, q]) => a + num(items[n].value) * q, 0);
    return `<div class="pos">
      <div class="pos-grid">${items.map((x) => `<span><b>${esc(x.label)}</b><small class="tnum">${esc(x.value)}</small></span>`).join("")}</div>
      <div class="pos-ticket"><p class="pt-h">${esc(t("ind_pos_table"))}</p>
        ${order.map(([n, q]) => `<p><span>${q} × ${esc(items[n].label)}</span><span class="tnum">${rm(num(items[n].value) * q)}</span></p>`).join("")}
        <p class="pt-total"><span>${esc(t("ind_pos_total"))}</span><span class="tnum">${rm(total)}</span></p>
        <span class="pt-pay">${esc(t("ind_pos_pay"))}</span></div></div>`;
  },
  calendar: () => {
    const days = ["mock_thu", "mock_fri", "mock_sat", "mock_sun"];
    const events = [[0, 1, 1, "ind_cal_e2", "gold"], [1, 1, 1, "ind_cal_e4", "soft"], [1, 2, 1, "ind_cal_e5", "soft"], [2, 1, 2, "ind_cal_e1", ""], [3, 1, 3, "ind_cal_e3", ""]];
    return `<div class="cal">${days.map((d) => `<span class="cal-d">${esc(t(d))}</span>`).join("")}
      ${events.map(([day, row, span, k, cls]) => `<span class="cal-e ${cls}" style="grid-column:${day + 1};grid-row:${row + 1} / span ${span}">${esc(t(k))}</span>`).join("")}</div>`;
  },
  gantt: () => {
    const tasks = [["ind_g_t1", 0, 3, 100], ["ind_g_t2", 2, 4, 100], ["ind_g_t3", 5, 4, 60], ["ind_g_t4", 8, 3, 0], ["ind_g_t5", 10, 2, 0]];
    return `<div class="gantt">${tasks.map(([k, s, len, done]) => `<div class="g-row"><span class="g-name">${esc(t(k))}</span>
      <span class="g-track"><i style="left:${(s / 12) * 100}%;width:${(len / 12) * 100}%"><b style="width:${done}%"></b></i></span></div>`).join("")}
      <span class="g-today" style="left:calc(var(--g-name) + (100% - var(--g-name)) * ${7.4 / 12})"><em>${esc(t("ind_g_today"))}</em></span></div>`;
  },
};
const illustration = (i) => (visuals[i.illustration] ? `<div class="ind-visual" aria-hidden="true">${visuals[i.illustration](i)}</div><span class="example-tag ind-illus">${esc(t("ind_illus"))}</span>` : "");

/** Tell the lead form which industries to pre-select, and take the visitor there. */
export function wantIndustries(slugs) {
  window.dispatchEvent(new CustomEvent("allurus:interest", { detail: { industries: slugs } }));
  document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
}

export function mountIndustries(root) {
  let data = null;
  const mix = new Set();

  function card(i) {
    const head = industryFeatures(i.slug, data.links, data.featuresByKey, { publicOnly: true }).filter((f) => f.isHeadline).slice(0, 3);
    const planned = (i.status || "planned") === "planned";
    const mods = i.buildsOnModules || [];
    return `
      <article class="ind ${i.illustration ? "featured" : ""}" data-slug="${esc(i.slug)}">
        <div class="ind-top"><h3>${esc(indName(i))}</h3>${statusBadge(i.status)}</div>
        <p class="ind-for">${esc(indTagline(i))}</p>
        ${illustration(i)}
        <ul class="ind-list">${head.map((f) => `<li>${esc(f.label)}</li>`).join("")}</ul>
        ${mods.length ? `<p class="ind-uses"><span>${esc(t("ind_uses"))}:</span> ${mods.map((m) => `<span class="c-chip">${esc(moduleName(m, data.modules))}</span>`).join("")}</p>` : ""}
        <div class="ind-actions">
          <button type="button" class="btn ${planned ? "btn-ghost" : "btn-primary"} btn-sm" data-detail="${esc(i.slug)}">${esc(t("ind_details"))}</button>
          <button type="button" class="btn ${planned ? "btn-primary" : "btn-ghost"} btn-sm" data-want="${esc(i.slug)}">${esc(t("ind_want"))}</button>
        </div>
        <label class="ind-mix"><input type="checkbox" data-mix="${esc(i.slug)}" ${mix.has(i.slug) ? "checked" : ""}> ${esc(t("ind_mix_add"))}</label>
      </article>`;
  }

  function compare() {
    const { cols, rows } = compareMatrix(data.industries, data.links, data.featuresByKey);
    return `<details class="cmp">
      <summary>${esc(t("ind_compare"))}</summary>
      <div class="cmp-scroll" tabindex="0" role="region" aria-label="${esc(t("ind_compare"))}"><table class="cmp-table">
        <thead><tr><th scope="col">${esc(t("ind_cmp_feature"))}</th>${cols.map((c) => `<th scope="col">${esc(indName(c.industry))}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((f) => `<tr><th scope="row">${esc(f.name)}</th>${cols.map((c) => `<td>${c.keys.has(f.key) ? `<span class="tick" role="img" aria-label="${esc(t("ind_cmp_yes"))}">✓</span>` : `<span class="dash" role="img" aria-label="${esc(t("ind_cmp_no"))}">–</span>`}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div></details>`;
  }

  function render() {
    if (!data) { root.innerHTML = `<p class="ind-loading" role="status">${esc(t("ind_loading"))}</p>`; return; }
    if (!data.industries.length) { root.innerHTML = `<p class="ind-loading">${esc(t("ind_empty"))}</p>`; return; }
    root.innerHTML = `
      <div class="finder-cta"><div><b>${esc(t("fd_cta_t"))}</b><span>${esc(t("fd_cta_d"))}</span></div>
        <button type="button" class="btn btn-primary" data-finder>${esc(t("fd_start"))}</button></div>
      <div class="ind-grid">${data.industries.map(card).join("")}</div>
      <div class="mix-strip" ${mix.size ? "" : "hidden"} role="region" aria-live="polite" aria-label="${esc(t("ind_mix_t"))}">
        <p><b>${esc(t("ind_mix_t"))}</b> <span>${esc(t("ind_mix_d"))}</span></p>
        <p class="mix-chosen">${[...mix].map((s) => `<span class="c-chip">${esc(indName(data.industries.find((i) => i.slug === s) || { name: s }))}</span>`).join("")}</p>
        <button type="button" class="btn btn-primary btn-sm" data-mix-go>${esc(t("ind_mix_go", { n: mix.size }))}</button>
      </div>
      <p class="mix-hint" ${mix.size ? "hidden" : ""}><b>${esc(t("ind_mix_t"))}</b> ${esc(t("ind_mix_hint"))}</p>
      ${compare()}
      <dialog class="ind-dialog" aria-labelledby="indDlgTitle"></dialog>`;
  }

  function detail(slug, push = true) {
    const i = data?.industries.find((x) => x.slug === slug);
    if (!i) return;
    const dlg = root.querySelector(".ind-dialog");
    const feats = industryFeatures(slug, data.links, data.featuresByKey, { publicOnly: true });
    const status = i.status || "planned";
    const list = (arr) => `<ul class="dl-list">${(arr || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    dlg.innerHTML = `
      <div class="dl-head">
        <div><p class="dl-k">${statusBadge(status)}</p><h2 id="indDlgTitle">${esc(indName(i))}</h2><p class="dl-tag">${esc(indTagline(i))}</p></div>
        <button type="button" class="dl-close" data-close aria-label="${esc(t("ind_close"))}">×</button>
      </div>
      <div class="dl-body">
        ${i.whoFor?.length ? `<section><h3>${esc(t("dl_who"))}</h3><p class="dl-chips">${i.whoFor.map((x) => `<span class="c-chip">${esc(x)}</span>`).join("")}</p></section>` : ""}
        ${i.signsThisIsYou?.length ? `<section><h3>${esc(t("dl_signs"))}</h3><ul class="dl-checks">${i.signsThisIsYou.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
        ${i.problemsSolved?.length ? `<section><h3>${esc(t("dl_problems"))}</h3>${list(i.problemsSolved)}</section>` : ""}
        <section><h3>${esc(t("dl_get"))}</h3>
          ${byModule(feats, data.modules).map((g) => `<h4>${esc(moduleName(g.moduleKey, data.modules))}</h4>
            <ul class="dl-feats">${g.items.map((f) => `<li><b>${esc(f.label)}</b>${f.link?.customDescription || f.description ? `<span>${esc(f.link?.customDescription || f.description)}</span>` : ""}${f.status === "live" || f.status === "beta" ? ` ${statusBadge(f.status)}` : ""}</li>`).join("")}</ul>`).join("")}
        </section>
        ${i.dayStory ? `<section><h3>${esc(t("dl_day"))}</h3><p class="dl-story">${esc(i.dayStory)}</p></section>` : ""}
        ${i.illustration || i.sampleData?.length ? `<section><h3>${esc(t("dl_sample"))}</h3>${illustration(i)}
          ${!i.illustration && i.sampleData?.length ? `<table class="dl-sample">${i.sampleData.map((s) => `<tr><td>${esc(s.label)}</td><td class="tnum">${esc(s.value)}</td></tr>`).join("")}</table><span class="example-tag">${esc(t("ind_illus"))}</span>` : ""}</section>` : ""}
        ${i.buildsOnModules?.length ? `<section><h3>${esc(t("ind_uses"))}</h3><p class="dl-chips">${i.buildsOnModules.map((m) => `<span class="c-chip">${esc(moduleName(m, data.modules))}</span>`).join("")}</p></section>` : ""}
        ${i.worksWith?.length ? `<section><h3>${esc(t("dl_works"))}</h3>${list(i.worksWith)}</section>` : ""}
        <section><h3>${esc(t("dl_status"))}</h3><p>${esc(t(`dl_status_${status}`))}</p></section>
      </div>
      <div class="dl-foot">
        <button type="button" class="btn btn-primary" data-choose="${esc(slug)}">${esc(t("dl_choose"))}</button>
        <button type="button" class="btn btn-ghost" data-want="${esc(slug)}">${esc(t("ind_want"))}</button>
      </div>`;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector(".dl-close").focus();
    document.title = i.seoTitle || `${indName(i)} | Allurus`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", i.seoDescription || indTagline(i));
    if (push && location.pathname !== `/industries/${slug}`) history.pushState({ industry: slug }, "", `/industries/${slug}`);
  }

  function closeDetail(push = true) {
    const dlg = root.querySelector(".ind-dialog");
    if (dlg?.open) dlg.close();
    document.title = t("meta_title");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta_desc"));
    if (push && location.pathname.startsWith("/industries")) history.pushState(null, "", "/#industries");
  }

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-detail],[data-want],[data-choose],[data-mix-go],[data-close],[data-finder]");
    if (!el) { if (e.target.classList?.contains("ind-dialog")) closeDetail(); return; }   // click on the backdrop
    if (el.dataset.detail) detail(el.dataset.detail);
    else if (el.dataset.want) { closeDetail(); wantIndustries([el.dataset.want, ...[...mix].filter((s) => s !== el.dataset.want)]); }
    else if (el.dataset.choose) { mix.add(el.dataset.choose); closeDetail(); wantIndustries([...mix]); }
    else if (el.hasAttribute("data-mix-go")) wantIndustries([...mix]);
    else if (el.hasAttribute("data-close")) closeDetail();
    else if (el.hasAttribute("data-finder")) openFinder(data, { onDetail: (s) => detail(s), onChoose: (s) => { mix.add(s); wantIndustries([...mix]); } });
  });
  root.addEventListener("change", (e) => {
    const box = e.target.closest("[data-mix]");
    if (!box) return;
    if (box.checked) mix.add(box.dataset.mix); else mix.delete(box.dataset.mix);
    const strip = root.querySelector(".mix-strip");
    strip.hidden = !mix.size; root.querySelector(".mix-hint").hidden = !!mix.size;
    strip.querySelector(".mix-chosen").innerHTML = [...mix].map((s) => `<span class="c-chip">${esc(indName(data.industries.find((i) => i.slug === s)))}</span>`).join("");
    strip.querySelector("[data-mix-go]").textContent = t("ind_mix_go", { n: mix.size });
  });
  root.addEventListener("cancel", (e) => { if (e.target.classList?.contains("ind-dialog")) { e.preventDefault(); closeDetail(); } }, true);
  window.addEventListener("popstate", () => {
    const m = /^\/industries\/([^/]+)/.exec(location.pathname);
    if (m) detail(decodeURIComponent(m[1]), false); else closeDetail(false);
  });

  render();
  onLangChange(render);
  loadCatalog().then((d) => {
    data = d;
    render();
    // Opened directly at /industries or /industries/<slug>
    const m = /^\/industries(?:\/([^/]+))?/.exec(location.pathname);
    if (m) { document.getElementById("industries")?.scrollIntoView(); if (m[1]) detail(decodeURIComponent(m[1]), false); }
  });
}
