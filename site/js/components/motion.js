/* Scroll-reveal and number count-ups.
   Content is visible by default; only elements that start BELOW the fold get the pending state,
   so the first screen (and any no-JS / screenshot view) is complete at rest. */
import { reducedMotion } from "../util.js";

export function initMotion() {
  if (reducedMotion() || !("IntersectionObserver" in window)) return;

  const vh = window.innerHeight;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.remove("pending");
      en.target.classList.add("shown");
      io.unobserve(en.target);
    });
  }, { rootMargin: "0px 0px -8% 0px" });

  document.querySelectorAll(".reveal").forEach((el, i) => {
    if (el.getBoundingClientRect().top < vh * 0.92) return;   // already on screen: leave it alone
    el.classList.add("pending");
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    io.observe(el);
  });
}

/** Animate a number from 0 to `to`; `format` renders each frame. Respects reduced motion. */
export function countUp(el, to, format, duration = 1200) {
  if (reducedMotion()) { el.textContent = format(to); return; }
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(to * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
