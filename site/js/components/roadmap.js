/* Roadmap: "Live today" vs "Being finished now", from ROADMAP in js/config/site.js. */
import { ROADMAP } from "../config/site.js";
import { t, onLangChange } from "../i18n.js";
import { esc } from "../util.js";

export function mountRoadmap(root) {
  function render() {
    const col = (status, titleKey) => `
      <div class="road-col ${status} reveal">
        <h3>${esc(t(titleKey))}</h3>
        <div class="road-items">${ROADMAP[status].map((k) => `<span>${esc(t(k))}</span>`).join("")}</div>
      </div>`;
    root.innerHTML = `<div class="road">${col("live", "road_live")}${col("rolling", "road_rolling")}</div>
      <p class="road-note">${esc(t("road_note"))}</p>`;
  }
  render();
  onLangChange(render);
}
