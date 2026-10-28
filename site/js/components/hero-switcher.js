/* HeroSwitcher: department tabs above the hero device frame. Each tab shows that department's dashboard.
   HR, Operations and Sales are real screenshots from the demo company. Finance and Marketing have no screenshot
   yet, so they are drawn in the app's own style with example data and labelled as such; Marketing is also marked
   as still being built. Arrow keys move between tabs. */
import { t, onLangChange } from "../i18n.js";
import { esc, rm } from "../util.js";

const SHOT = "/site/assets/shots/";
const DEPTS = [
  { id: "hr",         label: "hs_hr",         shot: "01-hr-dashboard",       alt: "shot_hr",    phone: ["09-phone-employee-home", "shot_p_home"], note: "shot_note" },
  { id: "finance",    label: "hs_finance",    mock: "finance",                                   note: "hs_note_mock" },
  { id: "operations", label: "hs_operations", shot: "06-operations-today",   alt: "shot_ops",   phone: ["12-phone-driver-deliveries", "shot_p_driver"], note: "shot_note" },
  { id: "marketing",  label: "hs_marketing",  mock: "marketing",                                 note: "hs_note_building" },
  { id: "sales",      label: "hs_sales",      shot: "08-sales-delivery",     alt: "shot_sales", phone: ["12-phone-driver-deliveries", "shot_p_driver"], note: "shot_note" },
];

function appFrame(active, title, sub, body) {
  const nav = [["hs_hr", "hr"], ["hs_finance", "finance"], ["hs_operations", "operations"], ["hs_marketing", "marketing"], ["hs_sales", "sales"]];
  return `<div class="ui">
    <aside class="ui-side"><div class="ui-brand"><svg aria-hidden="true"><use href="#allurusMark"/></svg><b>ALLURUS</b><small>Seri Maju Digital Sdn Bhd</small></div>
      <p class="ui-sec">${esc(t("hs_overview"))}</p>
      ${nav.map(([k, id]) => `<p class="ui-item ${id === active ? "on" : ""}"><i></i>${esc(t(k))}</p>`).join("")}
    </aside>
    <div class="ui-main">
      <div class="ui-top"><span class="ui-search">${esc(t("hs_search"))}</span><span class="ui-live">● ${esc(t("dash_updated"))}</span></div>
      <p class="ui-date">${esc(t("hs_date"))}</p>
      <h4 class="ui-h">${esc(title)}</h4><p class="ui-sub">${esc(sub)}</p>
      ${body}
    </div></div>`;
}

const kpi = (label, value, note, cls = "") => `<div class="ui-kpi"><span>${esc(label)}</span><b class="${cls}">${value}</b><small>${esc(note)}</small></div>`;

const mocks = {
  finance: () => appFrame("finance", t("hs_fin_t"), t("hs_fin_s"), `
    <div class="ui-kpis">
      ${kpi(t("hs_fin_in"), rm(39524, 0), t("hs_fin_in_s"))}
      ${kpi(t("hs_fin_out"), rm(7280, 0), t("hs_fin_out_s"))}
      ${kpi(t("hs_fin_cash"), rm(214569, 0), t("hs_fin_cash_s"))}
      ${kpi(t("hs_fin_overdue"), rm(8536, 0), t("hs_fin_overdue_s"), "bad")}
    </div>
    <div class="ui-row">
      <div class="ui-card"><p class="ui-ct">${esc(t("hs_fin_chart"))}</p>
        <div class="ui-bars">${[[62, 40], [70, 46], [58, 44], [81, 50], [76, 47], [90, 52]].map(([a, b]) => `<span><i style="height:${a}%"></i><i class="g" style="height:${b}%"></i></span>`).join("")}</div>
        <p class="ui-legend"><i></i>${esc(t("hs_fin_income"))} <i class="g"></i>${esc(t("hs_fin_costs"))}</p></div>
      <div class="ui-card"><p class="ui-ct">${esc(t("hs_fin_inv"))}</p>
        ${[["INV-0391", "Teras Marine", 7950, "bad", "hs_overdue"], ["INV-0394", "Kemaman Agro", 3420, "wait", "hs_due"], ["INV-0396", "Bina Utama", 12800, "ok", "hs_paid"]]
          .map(([n, c, a, s, k]) => `<p class="ui-li"><span><b>${n}</b> ${c}</span><span>${rm(a, 0)} <em class="${s}">${esc(t(k))}</em></span></p>`).join("")}
      </div>
    </div>`),
  marketing: () => appFrame("marketing", t("hs_mkt_t"), t("hs_mkt_s"), `
    <div class="ui-kpis">
      ${kpi(t("hs_mkt_leads"), "320", t("hs_mkt_leads_s"))}
      ${kpi(t("hs_mkt_cpl"), rm(7.5), t("hs_mkt_cpl_s"))}
      ${kpi(t("hs_mkt_won"), "21", t("hs_mkt_won_s"))}
      ${kpi(t("hs_mkt_return"), rm(31800, 0), t("hs_mkt_return_s"), "ok")}
    </div>
    <div class="ui-row">
      <div class="ui-card"><p class="ui-ct">${esc(t("hs_mkt_funnel"))}</p>
        ${[["mock_leads", 320, 100], ["mock_qualified", 96, 62], ["mock_customers", 21, 30]].map(([k, n, w]) => `<p class="ui-fun" style="width:${w}%"><span>${esc(t(k))}</span><b>${n}</b></p>`).join("")}</div>
      <div class="ui-card"><p class="ui-ct">${esc(t("hs_mkt_camps"))}</p>
        ${[["Raya promo", 2400, 31800], ["Facebook · Kuantan", 900, 6200], ["Trade fair KT", 1500, 4100]]
          .map(([c, s, r]) => `<p class="ui-li"><span><b>${c}</b> ${rm(s, 0)}</span><span class="ok">${rm(r, 0)}</span></p>`).join("")}
      </div>
    </div>`),
};

export function mountHeroSwitcher(root) {
  let current = "hr";

  function render() {
    const d = DEPTS.find((x) => x.id === current);
    root.innerHTML = `
      <div class="hs-tabs" role="tablist" aria-label="${esc(t("hs_label"))}">
        ${DEPTS.map((x) => `<button type="button" role="tab" id="hs-${x.id}" aria-controls="hs-panel" aria-selected="${x.id === current}" tabindex="${x.id === current ? 0 : -1}" data-id="${x.id}">${esc(t(x.label))}${x.id === "marketing" ? `<small>${esc(t("status_rolling"))}</small>` : ""}</button>`).join("")}
      </div>
      <div class="hero-devices" id="hs-panel" role="tabpanel" aria-labelledby="hs-${d.id}">
        <figure class="device-desk">
          ${d.shot
            ? `<img src="${SHOT}${d.shot}.jpg" width="1440" height="900" ${d.id === "hr" ? 'fetchpriority="high"' : ""} decoding="async" alt="${esc(t(d.alt))}">`
            : `<div class="ui-wrap" role="img" aria-label="${esc(t(d.id === "finance" ? "hs_fin_alt" : "hs_mkt_alt"))}">${mocks[d.mock]()}</div>`}
          ${d.mock ? `<span class="hs-tag">${esc(t(d.id === "marketing" ? "hs_tag_building" : "dash_example"))}</span>` : ""}
        </figure>
        ${d.phone ? `<figure class="device-phone"><img src="${SHOT}${d.phone[0]}.jpg" width="560" height="953" decoding="async" alt="${esc(t(d.phone[1]))}"></figure>` : ""}
      </div>
      <p class="hero-note">${esc(t(d.note))}</p>`;

    const tabs = [...root.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab.dataset.id, false));
      tab.addEventListener("keydown", (e) => {
        const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        select(tabs[(i + dir + tabs.length) % tabs.length].dataset.id, true);
      });
    });
  }

  function select(id, focus) {
    current = id;
    render();
    if (focus) root.querySelector(`#hs-${id}`)?.focus();
  }

  // Warm the other screenshots so switching is instant.
  window.addEventListener("load", () => DEPTS.forEach((d) => { if (d.shot) { const i = new Image(); i.src = `${SHOT}${d.shot}.jpg`; } }), { once: true });

  render();
  onLangChange(render);
}
