/* Hover bubble: a soft glass bubble follows the cursor inside interactive things (mouse/trackpad only).
   Elements are marked up front, and again whenever a component re-renders (language switch, tab change),
   so the bubble is always in place before the cursor arrives. Styles: end of css/site.css. */
const KINDS = [
  [".dash, .o-card, .panel, .flow-shell, .form, .mock, .shot-frame", "b-big"],
  [".p-card, .step, .outcome, .ind, .comm-step, .road-col, .kpi, .q-item, .phone img", "b-card"],
  [".tab, .thumb, .chip-btn, .badge, .dept-chip, .o-kpi, .checks label, .road-items span, .lang button, .c-chip, .pill-s", "b-pill"],
  [".btn", "b-btn"],
  [".nav-links a, .footer a, .ind-cta, .direct a, .brand", "b-link"],
];

function mark(root) {
  for (const [sel, kind] of KINDS) {
    root.querySelectorAll(sel).forEach((el) => {
      if (el.classList.contains("bub") || el.tagName === "IMG") return;
      el.classList.add("bub", kind);
    });
  }
}

export function initBubbles() {
  if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
  mark(document);
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; mark(document); });
  }).observe(document.body, { childList: true, subtree: true });

  const place = (e) => {
    // Every bubbled ancestor tracks the cursor, so nested items (a KPI inside the dashboard) both respond.
    let el = e.target.closest?.(".bub");
    while (el) {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
      el = el.parentElement?.closest(".bub");
    }
  };
  document.addEventListener("pointerover", place, { passive: true });   // positioned before it fades in
  let raf = 0, last = null;
  document.addEventListener("pointermove", (e) => {
    last = e;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(last); });
  }, { passive: true });
}
