/* ModuleShowcase: the platform's modules as accessible tabs (arrow keys move between tabs).
   Status, screenshots and integrations come from js/config/site.js; copy from js/i18n.js.
   Screenshots are real screens from the demo companies; where a module has none, a small mock is drawn instead
   and labelled as example data. */
import { MODULES } from "../config/site.js";
import { t, onLangChange } from "../i18n.js";
import { esc, rm } from "../util.js";

const SHOT_DIR = "/site/assets/shots/";
const name = (id) => t(`mod_${id}`);

const mocks = {
  finance: () => `
    <div class="mock-head"><span class="mock-title">${esc(t("mock_po"))}</span><span class="pill-s ok">P.O. → GRN → Bill</span></div>
    <div class="mock-scroll"><table class="mock-table">
      <thead><tr><th>P.O.</th><th>${esc(t("mock_supplier"))}</th><th class="r">${esc(t("mock_amount"))}</th><th>${esc(t("mock_status"))}</th></tr></thead>
      <tbody>
        <tr><td class="tnum">0142</td><td>Syarikat Bina Jaya</td><td class="r tnum money">${rm(18400)}</td><td><span class="pill-s wait">${esc(t("mock_awaiting"))}</span></td></tr>
        <tr><td class="tnum">0139</td><td>Teras Hardware</td><td class="r tnum money">${rm(6215)}</td><td><span class="pill-s ok">${esc(t("mock_received"))}</span></td></tr>
        <tr><td class="tnum">0136</td><td>Kemaman Steel</td><td class="r tnum money">${rm(12880)}</td><td><span class="pill-s ok">${esc(t("mock_matched"))}</span></td></tr>
      </tbody></table></div>`,
  talent: () => {
    const cols = [["mock_applied", ["Aina R.", "Hafiz M.", "Lim W.K."]], ["mock_interview", ["Priya S.", "Faizal A."]], ["mock_offer", ["Nadia H."]]];
    return `
    <div class="mock-head"><span class="mock-title">${esc(t("mock_hiring"))}</span><span class="pill-s ok">${esc(t("mock_careers"))}</span></div>
    <div class="kanban">${cols.map(([k, people]) => `
      <div><p class="kb-h">${esc(t(k))} <span class="tnum">${people.length}</span></p>${people.map((p) => `<p class="kb-card">${esc(p)}</p>`).join("")}</div>`).join("")}
    </div>`;
  },
  marketing: () => `
    <div class="mock-head"><span class="mock-title">${esc(t("mock_campaigns"))}</span></div>
    <div class="funnel">
      <div style="width:100%"><span>${esc(t("mock_leads"))}</span><span class="tnum">320</span></div>
      <div style="width:72%"><span>${esc(t("mock_qualified"))}</span><span class="tnum">96</span></div>
      <div style="width:44%"><span>${esc(t("mock_customers"))}</span><span class="tnum">21</span></div>
    </div>`,
};

function visual(m) {
  if (m.phones) {
    return `<div class="phones">${m.phones.map(([file, alt]) => `
      <figure class="phone"><img src="${SHOT_DIR}${file}.jpg" width="560" height="953" loading="lazy" decoding="async" alt="${esc(t(alt))}">
      <figcaption>${esc(t(`${alt}_c`))}</figcaption></figure>`).join("")}</div>
      <p class="shot-note">${esc(t("shot_note"))}</p>`;
  }
  if (m.shots) {
    const [file, alt] = m.shots[0];
    return `<figure class="shot">
        <div class="shot-frame"><img src="${SHOT_DIR}${file}.jpg" width="1440" height="900" loading="lazy" decoding="async" alt="${esc(t(alt))}" data-main></div>
        <figcaption data-cap>${esc(t(`${alt}_c`))}</figcaption>
      </figure>
      ${m.shots.length > 1 ? `<div class="thumbs" role="group" aria-label="${esc(t("shot_pick"))}">${m.shots.map(([f, a], i) => `
        <button type="button" class="thumb" aria-pressed="${i === 0}" data-file="${f}" data-alt="${a}">${esc(t(`${a}_c`))}</button>`).join("")}</div>` : ""}
      <p class="shot-note">${esc(t("shot_note"))}</p>`;
  }
  return `<div class="mock" aria-hidden="true">${mocks[m.id]()}<p style="margin-top:12px"><span class="example-tag" style="color:#a3a8b2;border-color:rgba(200,205,215,.25)">${esc(t("dash_example"))}</span></p></div>`;
}

export function mountModuleShowcase(root) {
  let current = MODULES[0].id;

  function render() {
    root.innerHTML = `
      <div class="tabs" role="tablist" aria-label="${esc(t("modules_title"))}">
        ${MODULES.map((m) => `
          <button type="button" role="tab" class="tab" id="tab-${m.id}" aria-controls="panel-${m.id}"
                  aria-selected="${m.id === current}" tabindex="${m.id === current ? 0 : -1}" data-id="${m.id}">
            ${esc(name(m.id))}<span class="st ${m.status}">${esc(t(m.status === "live" ? "status_live" : "status_rolling"))}</span>
          </button>`).join("")}
      </div>
      ${MODULES.map((m) => `
        <div class="panel ${m.phones ? "panel-phones" : m.shots ? "panel-shots" : ""}" role="tabpanel" id="panel-${m.id}" aria-labelledby="tab-${m.id}" tabindex="0" ${m.id === current ? "" : "hidden"}>
          <div>
            <h3>${esc(name(m.id))}</h3>
            <p class="p-intro">${esc(t(`mod_${m.id}_intro`))}</p>
            <ul class="caps">
              ${[1, 2, 3].map((n) => `<li><div><b>${esc(t(`mod_${m.id}_c${n}_t`))}</b><span>${esc(t(`mod_${m.id}_c${n}_d`))}</span></div></li>`).join("")}
            </ul>
            ${m.careful ? `<div class="careful"><p class="care-h">${esc(t("care_title"))}</p><ul>${m.careful.map((k) => `<li>${esc(t(k))}</li>`).join("")}</ul></div>` : ""}
            <p class="connects"><span class="c-label">${esc(t("connects_label"))}:</span>
              ${m.connects.map((c) => `<span class="c-chip">${esc(name(c))}</span>`).join("")}</p>
          </div>
          <div class="visual">${visual(m)}</div>
        </div>`).join("")}`;

    const tabs = [...root.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(tab.dataset.id, false));
      tab.addEventListener("keydown", (e) => {
        const dir = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
        if (dir === undefined) return;
        e.preventDefault();
        const next = dir === -Infinity ? 0 : dir === Infinity ? tabs.length - 1 : (i + dir + tabs.length) % tabs.length;
        select(tabs[next].dataset.id, true);
      });
    });

    root.querySelectorAll(".thumbs").forEach((group) => {
      const panel = group.closest(".panel");
      group.addEventListener("click", (e) => {
        const b = e.target.closest(".thumb");
        if (!b) return;
        group.querySelectorAll(".thumb").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        const img = panel.querySelector("[data-main]");
        img.src = `${SHOT_DIR}${b.dataset.file}.jpg`;
        img.alt = t(b.dataset.alt);
        panel.querySelector("[data-cap]").textContent = t(`${b.dataset.alt}_c`);
      });
    });
  }

  function select(id, focus) {
    current = id;
    root.querySelectorAll('[role="tab"]').forEach((tab) => {
      const on = tab.dataset.id === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    root.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = p.id !== `panel-${id}`; });
  }

  render();
  onLangChange(render);
}
