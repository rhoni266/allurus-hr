/* FlowDiagram: the signature "connected business" diagram, rendered in SVG from js/config/flow.js.
   - Data pulses travel along every connection (paused off-screen and under reduced motion).
   - Hover / focus / click a department: its upstream and downstream links light up, with a one-line explanation.
   - "Follow a flow" chips play a scenario step by step (e.g. P.O. → stock → goods received → bill matched).
   Keyboard: departments are focusable buttons (Tab, Enter/Space to pin), Escape resets. */
import { NODES, EDGES, SCENARIOS } from "../config/flow.js";
import { t, onLangChange } from "../i18n.js";
import { esc, reducedMotion, whileVisible } from "../util.js";

const SVGNS = "http://www.w3.org/2000/svg";
const mobileQuery = window.matchMedia("(max-width: 720px)");

export function mountFlowDiagram(root) {
  let svg, pulses = [], raf = 0, running = false, pinned = null, scenarioTimer = null, activeScenario = null;
  const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));

  function layout() {
    const m = mobileQuery.matches;
    return m
      ? { m, vbW: 420, vbH: 690, w: 186, h: 84, pos: (n) => [n.mx, n.my] }
      : { m, vbW: 1000, vbH: 500, w: 200, h: 78, pos: (n) => [n.x, n.y] };
  }

  function edgePath(e, L) {
    const [x1, y1] = L.pos(nodeById[e.from]);
    const [x2, y2] = L.pos(nodeById[e.to]);
    if (!e.bend) return `M${x1},${y1} L${x2},${y2}`;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const k = (L.m ? 0.7 : 1) * e.bend;
    return `M${x1},${y1} Q${mx + (-dy / len) * k},${my + (dx / len) * k} ${x2},${y2}`;
  }

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  function render() {
    stopScenario();
    const L = layout();
    root.innerHTML = `
      <div class="flow-tools" role="group" aria-label="${esc(t("flow_follow"))}">
        <span class="label">${esc(t("flow_follow"))}</span>
        ${SCENARIOS.map((s) => `<button type="button" class="chip-btn" data-scn="${s.id}" aria-pressed="false">${esc(t(s.label))}</button>`).join("")}
        <button type="button" class="chip-btn" data-reset>${esc(t("flow_reset"))}</button>
      </div>
      <div class="flow-canvas"></div>
      <div class="flow-caption" aria-live="polite">
        <span class="cap-k">${esc(t("flow_cap_k"))}</span>
        <div><div class="cap-t">${esc(t("flow_cap_t"))}</div><div class="flow-steps" hidden></div></div>
      </div>`;

    svg = el("svg", { class: "flow-svg", viewBox: `0 0 ${L.vbW} ${L.vbH}`, role: "group", "aria-label": t("flow_aria") });
    root.querySelector(".flow-canvas").appendChild(svg);

    const gEdges = el("g", { class: "edges" }, svg);
    const gPulses = el("g", { class: "pulses", "aria-hidden": "true" }, svg);
    const gNodes = el("g", { class: "nodes" }, svg);
    const gLabels = el("g", { class: "labels", "aria-hidden": "true" }, svg);   // above the cards so labels are never hidden

    // Edges + labels + pulses
    pulses = EDGES.map((e, i) => {
      const path = el("path", { class: `edge${e.money ? " money" : ""}`, d: edgePath(e, L), "data-i": i }, gEdges);
      const len = path.getTotalLength();
      const mid = path.getPointAtLength(len / 2);
      const [, fy] = L.pos(nodeById[e.from]); const [, ty] = L.pos(nodeById[e.to]);
      if (Math.abs(fy - ty) < 4 && !e.bend) mid.y -= L.h / 2 + 16;   // same row: put the label above the cards
      const bg = el("rect", { class: "edge-label-bg", rx: 8, ry: 8 }, gLabels);
      const text = el("text", { class: "edge-label", x: mid.x, y: mid.y + 4, "text-anchor": "middle" }, gLabels);
      text.textContent = t(e.label);
      const dot = el("circle", { class: `pulse${e.money ? " money" : ""}`, r: L.m ? 4 : 4.5, cx: -20, cy: -20 }, gPulses);
      return { e, i, path, len, dot, text, bg, phase: Math.random(), speed: 2600 + Math.random() * 1400 };
    });

    // Size label backgrounds after text is in the DOM (and again once web fonts change the text width).
    const sizeLabels = () => pulses.forEach((p) => {
      try {
        const b = p.text.getBBox();
        p.bg.setAttribute("x", b.x - 8); p.bg.setAttribute("y", b.y - 4);
        p.bg.setAttribute("width", b.width + 16); p.bg.setAttribute("height", b.height + 8);
      } catch (e) { /* not laid out (hidden); labels still readable */ }
    });
    sizeLabels();
    document.fonts?.ready.then(sizeLabels);

    // Nodes
    NODES.forEach((n) => {
      const [cx, cy] = L.pos(n);
      const g = el("g", {
        class: `node${n.core ? " core" : ""}`, tabindex: "0", role: "button", "data-id": n.id,
        "aria-label": `${t(n.title)} ${t(n.sub)}`, "aria-description": t("desc_" + n.id),   // name = visible text; detail as description "aria-pressed": "false",
        transform: `translate(${cx - L.w / 2},${cy - L.h / 2})`,
      }, gNodes);
      el("rect", { width: L.w, height: L.h, rx: 18, ry: 18 }, g);
      el("circle", { class: "n-dot", cx: 20, cy: L.h / 2, r: 5 }, g);
      const tt = el("text", { class: "n-title", x: 36, y: L.h / 2 - 3 }, g); tt.textContent = t(n.title);
      const ts = el("text", { class: "n-sub", x: 36, y: L.h / 2 + 16 }, g); ts.textContent = t(n.sub);
      if (L.m) { tt.setAttribute("style", "font-size:17px"); ts.setAttribute("style", "font-size:13.5px"); }

      g.addEventListener("mouseenter", () => { if (!pinned && !activeScenario) focusNode(n.id); });
      g.addEventListener("mouseleave", () => { if (!pinned && !activeScenario) clearFocus(); });
      g.addEventListener("focus", () => { if (!pinned) { stopScenario(); focusNode(n.id); } });
      g.addEventListener("blur", () => { if (!pinned && !activeScenario) clearFocus(); });
      g.addEventListener("click", () => togglePin(n.id));
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); togglePin(n.id); }
        if (ev.key === "Escape") { pinned = null; clearFocus(); }
      });
    });

    root.querySelectorAll("[data-scn]").forEach((b) => b.addEventListener("click", () => playScenario(b.dataset.scn)));
    root.querySelector("[data-reset]").addEventListener("click", () => { pinned = null; stopScenario(); clearFocus(); });

    // Static frame under reduced motion: pulses parked at mid-line so connections still read as "flowing".
    if (reducedMotion()) pulses.forEach((p) => { const pt = p.path.getPointAtLength(p.len * 0.5); p.dot.setAttribute("cx", pt.x); p.dot.setAttribute("cy", pt.y); });
  }

  /* ---------- Highlighting ---------- */
  function setHot(edgeIdx, nodeIds, showLabels = true) {
    const hotSet = new Set(edgeIdx);
    pulses.forEach((p) => {
      const hot = hotSet.has(p.i);
      p.path.classList.toggle("hot", hot);
      p.path.classList.toggle("dim", hotSet.size > 0 && !hot);
      const label = hot && showLabels && !mobileQuery.matches;   // phones: caption + chips carry the text
      p.text.classList.toggle("show", label);
      p.bg.classList.toggle("show", label);
      p.dot.style.opacity = hotSet.size === 0 || hot ? "1" : "0";
    });
    svg.querySelectorAll(".node").forEach((g) => {
      const on = nodeIds.has(g.dataset.id);
      g.classList.toggle("dim", nodeIds.size > 0 && !on);
    });
  }

  function focusNode(id) {
    const idx = [], ids = new Set([id]);
    EDGES.forEach((e, i) => { if (e.from === id || e.to === id) { idx.push(i); ids.add(e.from); ids.add(e.to); } });
    setHot(idx, ids);
    svg.querySelectorAll(".node").forEach((g) => g.classList.toggle("active", g.dataset.id === id));
    caption(t(nodeById[id].title), t("desc_" + id));
  }

  function clearFocus() {
    setHot([], new Set());
    svg.querySelectorAll(".node").forEach((g) => { g.classList.remove("active"); g.setAttribute("aria-pressed", "false"); });
    caption(t("flow_cap_k"), t("flow_cap_t"));
  }

  function togglePin(id) {
    stopScenario();
    pinned = pinned === id ? null : id;
    if (pinned) {
      focusNode(id);
      svg.querySelectorAll(".node").forEach((g) => g.setAttribute("aria-pressed", String(g.dataset.id === id)));
    } else clearFocus();
  }

  function caption(k, text, steps = null, upto = -1) {
    root.querySelector(".cap-k").textContent = k;
    root.querySelector(".cap-t").textContent = text;
    const box = root.querySelector(".flow-steps");
    if (!steps) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = steps.map((s, i) => `${i ? "<i aria-hidden=\"true\">→</i>" : ""}<span class="${i <= upto ? "on" : ""}">${esc(s)}</span>`).join("");
  }

  /* ---------- Scenarios ---------- */
  function playScenario(id) {
    const scn = SCENARIOS.find((s) => s.id === id);
    if (!scn) return;
    stopScenario();
    pinned = null;
    activeScenario = id;
    root.querySelectorAll("[data-scn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scn === id)));
    const steps = t(scn.steps).split("|");
    const nodesOf = (upto) => {
      const s = new Set();
      scn.edges.slice(0, upto + 1).forEach((i) => { s.add(EDGES[i].from); s.add(EDGES[i].to); });
      return s;
    };
    const total = scn.edges.length;
    const show = (k) => {
      setHot(scn.edges.slice(0, k + 1), nodesOf(k), true);
      // Step strip has its own count; map edge progress onto it.
      const stepUpto = Math.round(((k + 1) / total) * (steps.length - 1));
      caption(t(scn.label), "", steps, stepUpto);
    };
    if (reducedMotion()) { show(total - 1); return; }
    let k = 0;
    show(0);
    scenarioTimer = setInterval(() => {
      k += 1;
      if (k >= total) { clearInterval(scenarioTimer); scenarioTimer = null; return; }
      show(k);
    }, 1500);
  }

  function stopScenario() {
    if (scenarioTimer) clearInterval(scenarioTimer);
    scenarioTimer = null;
    activeScenario = null;
    root.querySelectorAll("[data-scn]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  }

  /* ---------- Pulse animation ---------- */
  function frame(now) {
    if (!running) return;
    for (const p of pulses) {
      if (p.dot.style.opacity === "0") continue;
      const f = ((now / p.speed) + p.phase) % 1;
      const pt = p.path.getPointAtLength(f * p.len);
      p.dot.setAttribute("cx", pt.x.toFixed(1));
      p.dot.setAttribute("cy", pt.y.toFixed(1));
    }
    raf = requestAnimationFrame(frame);
  }
  const start = () => { if (running || reducedMotion()) return; running = true; raf = requestAnimationFrame(frame); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  let onScreen = false, introPlayed = false;
  render();
  whileVisible(root, () => {
    onScreen = true; start();
    // First time the diagram is seen, walk through the P.O. flow so the idea lands without any interaction.
    if (!introPlayed && !pinned && !activeScenario) { introPlayed = true; playScenario(SCENARIOS[0].id); }
  }, () => { onScreen = false; stop(); });
  onLangChange(() => { pinned = null; render(); });
  mobileQuery.addEventListener?.("change", () => { pinned = null; render(); });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : onScreen && start()));
}
