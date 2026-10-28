/* HeroDashboard: a live-looking owner overview. All figures are fictional and labelled "Example data". */
import { t, onLangChange } from "../i18n.js";
import { rm, esc, reducedMotion, whenVisible, whileVisible } from "../util.js";
import { countUp } from "./motion.js";

const state = {
  cash: 482310.55,
  sales: 128450.0,
  salesDelta: 12.4,
  payroll: 86240.3,
  commission: 9870.0,
  trend: [62, 58, 71, 69, 76, 74, 83, 80, 91, 88, 97, 104],   // RM '000 per week
  stock: [
    { key: "stock_a", pct: 18, qty: "12" },
    { key: "stock_b", pct: 64, qty: "820" },
    { key: "stock_c", pct: 81, qty: "1,140" },
  ],
};

function sparkPath(values, w = 300, h = 64, pad = 4) {
  const max = Math.max(...values), min = Math.min(...values);
  const x = (i) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const pts = values.map((v, i) => [x(i), y(v)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${h} L${pad},${h} Z`;
  return { line, area, last: pts[pts.length - 1] };
}

function render(el) {
  const sp = sparkPath(state.trend);
  el.innerHTML = `
    <div class="dash" role="img" aria-label="${esc(t("dash_title"))}: ${esc(t("dash_example"))}">
      <div class="dash-top">
        <span class="dash-title"><span class="live-dot" aria-hidden="true"></span>${esc(t("dash_title"))}</span>
        <span class="example-tag">${esc(t("dash_example"))}</span>
      </div>
      <div class="dash-grid" aria-hidden="true">
        <div class="kpi money"><div class="k-label">${esc(t("dash_cash"))}</div><div class="k-value tnum" data-k="cash">${rm(state.cash)}</div><div class="k-sub">${esc(t("dash_cash_sub"))}</div></div>
        <div class="kpi" data-kpi="sales"><div class="k-label">${esc(t("dash_sales"))}</div><div class="k-value tnum" data-k="sales">${rm(state.sales)}</div><div class="k-sub"><span class="up">▲ ${state.salesDelta}%</span> ${esc(t("dash_sales_sub"))}</div></div>
        <div class="kpi"><div class="k-label">${esc(t("dash_payroll"))}</div><div class="k-value tnum" data-k="payroll">${rm(state.payroll)}</div><div class="k-sub">${esc(t("dash_payroll_sub"))}</div></div>
        <div class="kpi money" data-kpi="commission"><div class="k-label">${esc(t("dash_comm"))}</div><div class="k-value tnum" data-k="commission">${rm(state.commission)}</div><div class="k-sub">${esc(t("dash_comm_sub"))}</div></div>
        <div class="kpi wide">
          <div class="k-label">${esc(t("dash_trend"))}</div>
          <svg class="spark" viewBox="0 0 300 64" preserveAspectRatio="none">
            <defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2bb3a3" stop-opacity=".35"/><stop offset="1" stop-color="#2bb3a3" stop-opacity="0"/></linearGradient></defs>
            <path class="spark-area" d="${sp.area}" fill="url(#sparkFill)"/>
            <path class="spark-line" d="${sp.line}" fill="none" stroke="#2bb3a3" stroke-width="2" vector-effect="non-scaling-stroke"/>
            <circle class="spark-dot" cx="${sp.last[0]}" cy="${sp.last[1]}" r="3.5" fill="#5fd0c2"/>
          </svg>
        </div>
        <div class="kpi wide">
          <div class="k-label">${esc(t("dash_stock"))}</div>
          <div class="stock-list">
            ${state.stock.map((s) => `
              <div class="stock-row"><span>${esc(t(s.key))}</span><span class="tnum">${s.qty}${s.pct < 25 ? ` · <b style="color:var(--coral-700)">${esc(t("stock_low"))}</b>` : ""}</span>
                <span class="stock-bar"><i class="${s.pct < 25 ? "low" : ""}" style="width:${s.pct}%"></i></span></div>`).join("")}
          </div>
        </div>
      </div>
      <div class="dash-foot"><span>${esc(t("dash_updated"))}</span><span>Kemaman HQ</span></div>
    </div>`;
}

export function mountHeroDashboard(el) {
  render(el);
  onLangChange(() => render(el));

  // Count up once on first view.
  whenVisible(el, () => {
    [["cash", state.cash], ["sales", state.sales], ["payroll", state.payroll], ["commission", state.commission]].forEach(([k, v]) => {
      const node = el.querySelector(`[data-k="${k}"]`);
      if (node) countUp(node, v, rm, 1400);
    });
  });

  // Soft "live" ticks: small sales and commission increments while the dashboard is on screen.
  if (reducedMotion()) return;
  let timer = null;
  const tick = () => {
    const sale = Math.round((120 + Math.random() * 780) * 100) / 100;
    state.sales += sale;
    state.commission += Math.round(sale * 0.04 * 100) / 100;
    state.trend[state.trend.length - 1] += sale / 1000;
    const sNode = el.querySelector('[data-k="sales"]'), cNode = el.querySelector('[data-k="commission"]');
    if (sNode) sNode.textContent = rm(state.sales);
    if (cNode) cNode.textContent = rm(state.commission);
    ["sales", "commission"].forEach((k) => {
      const card = el.querySelector(`[data-kpi="${k}"]`);
      if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    });
    const sp = sparkPath(state.trend);
    el.querySelector(".spark-line")?.setAttribute("d", sp.line);
    el.querySelector(".spark-area")?.setAttribute("d", sp.area);
    const dot = el.querySelector(".spark-dot");
    if (dot) { dot.setAttribute("cx", sp.last[0]); dot.setAttribute("cy", sp.last[1]); }
  };
  whileVisible(el, () => { if (!timer) timer = setInterval(tick, 3800); }, () => { clearInterval(timer); timer = null; });
}
