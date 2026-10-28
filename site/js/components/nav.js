/* Nav: sticky state, mobile menu, language buttons, current-section highlight. */
import { setLang } from "../i18n.js";

export function initNav() {
  const nav = document.getElementById("nav");
  const links = document.getElementById("navLinks");
  const btn = document.getElementById("menuBtn");

  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const closeMenu = () => { links.setAttribute("hidden", ""); btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", () => {
    const open = links.hasAttribute("hidden");
    if (open) links.removeAttribute("hidden"); else links.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", String(open));
  });
  links.addEventListener("click", (e) => { if (e.target.closest("a") && window.innerWidth <= 1020) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !links.hasAttribute("hidden") && window.innerWidth <= 1020) { closeMenu(); btn.focus(); } });

  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

  // Highlight the section in view.
  if ("IntersectionObserver" in window) {
    const map = new Map([...links.querySelectorAll('a[href^="#"]')].map((a) => [a.getAttribute("href").slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const a = map.get(en.target.id);
        if (a && en.isIntersecting) {
          map.forEach((x) => x.removeAttribute("aria-current"));
          a.setAttribute("aria-current", "true");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }
}
