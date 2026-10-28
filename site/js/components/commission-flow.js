/* CommissionFlow: operations output → commission rule → payslip, recalculated live as the units slider moves.
   Statutory figures use simplified versions of the public schedules (labelled on the page):
   EPF 11% on the RM20 band ceiling, rounded up to the ringgit; SOCSO 0.5% and EIS 0.2% on the RM100 band
   mid-point, nearest 5 sen, wage ceiling RM6,000; PCB as a single resident with no prior-month figures. */
import { t, onLangChange } from "../i18n.js";
import { esc, rm } from "../util.js";

const RULE = { basic: 2200, coveredUnits: 800, ratePerUnit: 0.85, bonusAbove: 1200, bonus: 150 };
const cents = (n) => Math.round(n * 100) / 100;
const to5sen = (n) => Math.round(n * 20) / 20;

function epfEmployee(wage) {
  if (wage <= 10) return 0;
  const upper = wage <= 5000 ? Math.ceil(wage / 20) * 20 : Math.ceil(wage / 100) * 100;
  return Math.ceil(upper * 0.11);
}
function bandMid(wage) {
  const w = Math.min(wage, 6000);
  if (w <= 0) return 0;
  const upper = Math.max(100, Math.ceil(w / 100) * 100);
  return upper - 50;
}
const socsoEmployee = (wage) => to5sen(bandMid(wage) * 0.005);
const eisEmployee = (wage) => to5sen(bandMid(wage) * 0.002);
function pcb(gross, epf) {
  // Annualised, category 1, individual relief RM9,000, EPF relief capped at RM4,000 (YA2023+ resident rates).
  const p = gross * 12 - Math.min(epf * 12, 4000) - 9000;
  const bands = [[5000, 0, 0, -400], [20000, 5000, 1, -400], [35000, 20000, 3, -250], [50000, 35000, 6, 600],
                 [70000, 50000, 11, 1500], [100000, 70000, 19, 3700], [400000, 100000, 25, 9400]];
  if (p <= 0) return 0;
  const [, m, r, b] = bands.find(([to]) => p <= to) ?? bands[bands.length - 1];
  const tax = (p - m) * (r / 100) + b;
  const mtd = Math.ceil((tax / 12) * 20) / 20;
  return mtd < 10 ? 0 : mtd;
}

function calc(units) {
  const commission = cents(Math.max(0, units - RULE.coveredUnits) * RULE.ratePerUnit);
  const bonus = units > RULE.bonusAbove ? RULE.bonus : 0;
  const gross = cents(RULE.basic + commission + bonus);
  const epf = epfEmployee(gross);
  const socso = socsoEmployee(gross);
  const eis = eisEmployee(gross);
  const tax = pcb(gross, epf);
  const net = cents(gross - epf - socso - eis - tax);
  return { commission, bonus, gross, epf, socso, eis, tax, net };
}

const arrow = `<div class="comm-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>`;

export function mountCommissionFlow(root) {
  let units = 1240;

  function render() {
    root.innerHTML = `
      <div class="comm">
        <div class="comm-step reveal">
          <div class="s-kicker">${esc(t("comm_s1_k"))}</div>
          <h3>${esc(t("comm_s1_t"))}</h3>
          <div class="big-num tnum" data-out="units">${units.toLocaleString("en-MY")}</div>
          <div class="slider-row">
            <label for="unitsRange"><span>${esc(t("comm_units"))}</span><span class="tnum" data-out="units2">${units.toLocaleString("en-MY")}</span></label>
            <input id="unitsRange" type="range" min="400" max="1800" step="10" value="${units}" aria-describedby="commStaff">
          </div>
          <p class="rules" id="commStaff">${esc(t("comm_staff"))}</p>
        </div>
        ${arrow}
        <div class="comm-step reveal">
          <div class="s-kicker">${esc(t("comm_s2_k"))}</div>
          <h3>${esc(t("comm_s2_t"))}</h3>
          <ul class="rules">
            <li>${esc(t("comm_rule_1", { n: RULE.coveredUnits.toLocaleString("en-MY") }))}</li>
            <li>${esc(t("comm_rule_2", { r: RULE.ratePerUnit.toFixed(2) }))}</li>
            <li>${esc(t("comm_rule_3", { b: RULE.bonus, q: RULE.bonusAbove.toLocaleString("en-MY") }))}</li>
          </ul>
          <p class="rules" style="margin-top:16px"><b>${esc(t("comm_payable"))}</b></p>
          <div class="big-num money tnum" data-out="payable"></div>
        </div>
        ${arrow}
        <div class="comm-step reveal">
          <div class="s-kicker">${esc(t("comm_s3_k"))}</div>
          <h3>${esc(t("comm_s3_t"))}</h3>
          <div class="slip tnum" aria-live="polite" data-out="slip"></div>
          <p class="calc-note">${esc(t("comm_note"))}</p>
        </div>
      </div>
      <p style="margin-top:14px"><span class="example-tag">${esc(t("dash_example"))}</span></p>`;

    root.querySelector("#unitsRange").addEventListener("input", (e) => { units = Number(e.target.value); update(); });
    update();
  }

  function update() {
    const r = calc(units);
    root.querySelector('[data-out="units"]').textContent = units.toLocaleString("en-MY");
    root.querySelector('[data-out="units2"]').textContent = units.toLocaleString("en-MY");
    root.querySelector('[data-out="payable"]').textContent = rm(r.commission + r.bonus);
    const row = (k, v, cls = "") => `<div class="slip-row ${cls}"><span>${esc(t(k))}</span><span>${cls === "minus" ? "− " : ""}${rm(v)}</span></div>`;
    root.querySelector('[data-out="slip"]').innerHTML =
      row("slip_basic", RULE.basic) +
      row("slip_comm", r.commission) +
      (r.bonus ? row("slip_bonus", r.bonus) : "") +
      row("slip_gross", r.gross, "sub") +
      row("slip_epf", r.epf, "minus") +
      row("slip_socso", r.socso, "minus") +
      row("slip_eis", r.eis, "minus") +
      row("slip_pcb", r.tax, "minus") +
      `<div class="slip-net"><span>${esc(t("slip_net"))}</span><b>${rm(r.net)}</b></div>`;
  }

  render();
  onLangChange(render);
}
