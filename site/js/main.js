/* Entry point: language first, then each component mounts into its section. */
import { setLang, initialLang } from "./i18n.js";
import { initNav } from "./components/nav.js";
import { initMotion } from "./components/motion.js";
import { initBubbles } from "./components/bubble.js";
import { mountAccount } from "./components/account.js";
import { mountHeroDashboard } from "./components/hero-dashboard.js";
import { mountHeroSwitcher } from "./components/hero-switcher.js";
import { mountFlowDiagram } from "./components/flow-diagram.js";
import { mountModuleShowcase } from "./components/module-showcase.js";
import { mountOwnerDashboard } from "./components/owner-dashboard.js";
import { mountCommissionFlow } from "./components/commission-flow.js";
import { mountIndustries } from "./components/industries.js";
import { mountRoadmap } from "./components/roadmap.js";
import { mountContactForm } from "./components/contact-form.js";

const mounts = [
  ["heroDash", mountHeroDashboard],
  ["heroSwitch", mountHeroSwitcher],
  ["acct", mountAccount],
  ["flowDiagram", mountFlowDiagram],
  ["moduleShowcase", mountModuleShowcase],
  ["ownerDashboard", mountOwnerDashboard],
  ["commissionFlow", mountCommissionFlow],
  ["industryPacks", mountIndustries],
  ["roadmapStrip", mountRoadmap],
  ["contactForm", mountContactForm],
];

// Components subscribe to language changes, so mount them before the first setLang().
for (const [id, mount] of mounts) {
  const el = document.getElementById(id);
  if (!el) continue;
  try { mount(el); } catch (err) { console.error(`[allurus] ${id} failed to mount`, err); }
}
setLang(initialLang());
initNav();
initMotion();
initBubbles();
