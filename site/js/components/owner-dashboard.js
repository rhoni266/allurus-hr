/* OwnerDashboard: role-based preview for owners / top management. KPIs drill down on click,
   approvals can be approved (demo state only, nothing is sent), alerts summarise what needs attention.
   All data is fictional and labelled as an example. */
import { t, onLangChange } from "../i18n.js";
import { esc, rm } from "../util.js";

const KPIS = [
  { id: "rev", label: "od_kpi_rev", value: rm(412780, 0), delta: "+8.2%", up: true, drill: "od_rev_by",
    rows: [["line_a", 248600], ["line_b", 121380], ["line_c", 42800]], fmt: (v) => rm(v, 0) },
  { id: "cash", label: "od_kpi_cash", value: rm(482310, 0), delta: "+3.1%", up: true, drill: "od_cash_by",
    rows: [["acc_ops", 312480.2], ["acc_payroll", 128900], ["acc_reserve", 40930.35]], fmt: (v) => rm(v) },
  { id: "margin", label: "od_kpi_margin", value: "31.4%", delta: "+1.2 pt", up: true, drill: "od_margin_by",
    rows: [["line_a", 24.8], ["line_b", 41.2], ["line_c", 38.5]], fmt: (v) => `${v.toFixed(1)}%`, max: 50 },
  { id: "ar", label: "od_kpi_ar", value: rm(23640, 0), delta: "3", up: false, drill: "od_ar_by",
    rows: [["cust_a", 7950], ["cust_b", 9840], ["cust_c", 5850]], fmt: (v) => rm(v) },
];

const QUEUE = [
  { id: "po", title: "od_po_t", meta: "od_po_m", amount: rm(18400) },
  { id: "claim", title: "od_claim_t", meta: "od_claim_m", amount: rm(412.6) },
  { id: "leave", title: "od_leave_t", meta: "od_leave_m", amount: "" },
];

export function mountOwnerDashboard(root) {
  let selected = "rev";
  const approved = new Set();

  function drillHtml() {
    const k = KPIS.find((x) => x.id === selected);
    const max = k.max ?? Math.max(...k.rows.map((r) => r[1]));
    return `
      <div class="drill" id="ownerDrill" aria-live="polite">
        <div class="drill-title">${esc(t(k.drill))}</div>
        ${k.rows.map(([key, v]) => `
          <div class="drill-row"><span>${esc(t(key))}</span>
            <span class="bar"><i style="width:${Math.round((v / max) * 100)}%"></i></span>
            <span class="tnum">${esc(k.fmt(v))}</span></div>`).join("")}
      </div>`;
  }

  function render() {
    root.innerHTML = `
      <div class="owner-grid">
        <div class="o-card reveal">
          <h3><span>${esc(t("od_title"))}</span><span class="example-tag">${esc(t("dash_example"))}</span></h3>
          <div class="o-kpis">
            ${KPIS.map((k) => `
              <button type="button" class="o-kpi" data-kpi="${k.id}" aria-pressed="${k.id === selected}" aria-controls="ownerDrill">
                <div class="k-label">${esc(t(k.label))}</div>
                <div class="k-value tnum">${esc(k.value)}</div>
                <div class="k-delta ${k.up ? "" : "down"}">${k.up ? "▲" : "●"} ${esc(k.delta)}</div>
              </button>`).join("")}
          </div>
          ${drillHtml()}
          <p class="phone-note">
            <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <span>${esc(t("od_phone"))}</span>
          </p>
        </div>
        <div style="display:grid;gap:20px">
          <div class="o-card reveal">
            <h3>${esc(t("od_queue"))}<span class="tnum" style="font-size:.875rem;color:var(--muted)">${QUEUE.length - approved.size}</span></h3>
            <ul class="queue">
              ${QUEUE.map((q) => `
                <li class="q-item ${approved.has(q.id) ? "done" : ""}">
                  <div class="q-top"><b>${esc(t(q.title))}</b><span class="tnum">${esc(q.amount)}</span></div>
                  <div class="q-meta">${esc(t(q.meta))}</div>
                  <div class="q-actions">
                    ${approved.has(q.id)
                      ? `<span class="q-meta" role="status" tabindex="-1" data-done="${q.id}">✓ ${esc(t("od_approved"))}</span>`
                      : `<button type="button" class="btn btn-primary" data-approve="${q.id}">${esc(t("od_approve"))}</button>`}
                  </div>
                </li>`).join("")}
            </ul>
          </div>
          <div class="o-card reveal">
            <h3>${esc(t("od_alerts"))}</h3>
            <ul class="alerts">
              <li class="alert bad"><span>${esc(t("al_stock"))}<small>${esc(t("al_stock_s"))}</small></span></li>
              <li class="alert"><span>${esc(t("al_payroll"))}<small>${esc(t("al_payroll_s"))}</small></span></li>
              <li class="alert bad"><span>${esc(t("al_inv"))}<small>${esc(rm(7950))} · ${esc(t("al_inv_s"))}</small></span></li>
            </ul>
          </div>
        </div>
      </div>`;

    root.querySelectorAll(".o-kpi").forEach((b) => b.addEventListener("click", () => {
      selected = b.dataset.kpi;
      root.querySelectorAll(".o-kpi").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.kpi === selected)));
      root.querySelector("#ownerDrill").outerHTML = drillHtml();
    }));
    root.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.approve;
      approved.add(id);
      render();
      root.querySelector(`[data-done="${id}"]`)?.focus();   // keep keyboard focus where the button was
    }));
  }

  render();
  onLangChange(render);
}
