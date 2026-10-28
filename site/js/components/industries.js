/* Industries: planned industry packs built on the live core. None of these are available yet; every card says
   "Planned" and the illustrations are labelled. "Tell us you need this" ticks the matching box in the contact form. */
import { INDUSTRIES } from "../config/site.js";
import { t, onLangChange } from "../i18n.js";
import { esc, rm } from "../util.js";

const visuals = {
  pos: () => {
    const items = [["ind_pos_i1", 8.5], ["ind_pos_i2", 12], ["ind_pos_i3", 4.5], ["ind_pos_i4", 6], ["ind_pos_i5", 9.9], ["ind_pos_i6", 3.5]];
    const order = [[0, 2], [2, 2], [4, 1]];
    const total = order.reduce((a, [i, q]) => a + items[i][1] * q, 0);
    return `<div class="pos">
      <div class="pos-grid">${items.map(([k, p]) => `<span><b>${esc(t(k))}</b><small class="tnum">${rm(p)}</small></span>`).join("")}</div>
      <div class="pos-ticket"><p class="pt-h">${esc(t("ind_pos_table"))}</p>
        ${order.map(([i, q]) => `<p><span>${q} × ${esc(t(items[i][0]))}</span><span class="tnum">${rm(items[i][1] * q)}</span></p>`).join("")}
        <p class="pt-total"><span>${esc(t("ind_pos_total"))}</span><span class="tnum">${rm(total)}</span></p>
        <span class="pt-pay">${esc(t("ind_pos_pay"))}</span>
      </div></div>`;
  },
  calendar: () => {
    const days = ["mock_thu", "mock_fri", "mock_sat", "mock_sun"];
    // [column (0-based day), first row, rows spanned, label key, style]
    const events = [[0, 1, 1, "ind_cal_e2", "gold"], [1, 1, 1, "ind_cal_e4", "soft"], [1, 2, 1, "ind_cal_e5", "soft"], [2, 1, 2, "ind_cal_e1", ""], [3, 1, 3, "ind_cal_e3", ""]];
    return `<div class="cal">
      ${days.map((d) => `<span class="cal-d">${esc(t(d))}</span>`).join("")}
      ${events.map(([day, row, span, k, cls]) => `<span class="cal-e ${cls}" style="grid-column:${day + 1};grid-row:${row + 1} / span ${span}">${esc(t(k))}</span>`).join("")}
    </div>`;
  },
  gantt: () => {
    const tasks = [["ind_g_t1", 0, 3, 100], ["ind_g_t2", 2, 4, 100], ["ind_g_t3", 5, 4, 60], ["ind_g_t4", 8, 3, 0], ["ind_g_t5", 10, 2, 0]];
    return `<div class="gantt">
      ${tasks.map(([k, start, len, done]) => `<div class="g-row"><span class="g-name">${esc(t(k))}</span>
        <span class="g-track"><i style="left:${(start / 12) * 100}%;width:${(len / 12) * 100}%"><b style="width:${done}%"></b></i></span></div>`).join("")}
      <span class="g-today" style="left:calc(var(--g-name) + (100% - var(--g-name)) * ${7.4 / 12})"><em>${esc(t("ind_g_today"))}</em></span>
    </div>`;
  },
};

export function mountIndustries(root) {
  function card(ind) {
    const featured = Boolean(ind.visual);
    return `
      <article class="ind ${featured ? "featured" : ""} reveal">
        <div class="ind-top"><h3>${esc(t(`ind_${ind.id}`))}</h3><span class="st planned">${esc(t("status_planned"))}</span></div>
        <p class="ind-for">${esc(t(`ind_${ind.id}_for`))}</p>
        ${featured ? `<div class="ind-visual" aria-hidden="true">${visuals[ind.visual]()}</div><span class="example-tag ind-illus">${esc(t("ind_illus"))}</span>` : ""}
        <ul class="ind-list">${[1, 2, 3].map((n) => `<li>${esc(t(`ind_${ind.id}_${n}`))}</li>`).join("")}</ul>
        <p class="ind-uses"><span>${esc(t("ind_uses"))}:</span> ${ind.uses.map((u) => `<span class="c-chip">${esc(t(`mod_${u}`))}</span>`).join("")}</p>
        <a class="ind-cta" href="#contact" data-pack="${ind.id}">${esc(t("ind_want"))}</a>
      </article>`;
  }

  function render() {
    root.innerHTML = `<div class="ind-grid">${INDUSTRIES.map(card).join("")}</div>`;
    root.querySelectorAll("[data-pack]").forEach((a) => a.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("allurus:interest", { detail: a.dataset.pack }));
    }));
  }
  render();
  onLangChange(render);
}
