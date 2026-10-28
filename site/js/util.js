/* Small shared helpers. */

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** RM formatting, en-MY grouping, 2 decimals by default. */
export function rm(n, decimals = 2) {
  return "RM " + Number(n).toLocaleString("en-MY", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Escape text for safe interpolation into HTML templates. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Run fn once when el first scrolls into view (immediately if IntersectionObserver is missing). */
export function whenVisible(el, fn, rootMargin = "0px 0px -10% 0px") {
  if (!("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin });
  io.observe(el);
}

/** Keep a callback running only while el is on screen (for animation loops). */
export function whileVisible(el, onShow, onHide) {
  if (!("IntersectionObserver" in window)) { onShow(); return; }
  new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? onShow() : onHide()));
  }).observe(el);
}
