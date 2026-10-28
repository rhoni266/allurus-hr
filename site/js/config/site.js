/* Site-wide settings you are expected to edit. Text lives in js/i18n.js; this file holds facts. */

export const CONTACT = {
  email: "admin@allurus.my",
  whatsapp: "60105092660",          // country code, no + or spaces (used for wa.me links)
  phoneDisplay: "+60 10-509 2660",
  location: "Kemaman, Terengganu, Malaysia",
};

/* Enquiry form -> Firestore (project allurus-hr, collection "enquiries").
   The web API key is public by design; access is controlled by the Firestore rule (create-only, fixed fields). */
export const ENQUIRY = {
  projectId: "allurus-hr",
  apiKey: "AIzaSyCfMGQRT4zjtjJk4oyU3olxlfq-iU8_7EQ",
  collection: "enquiries",
};

/* Modules shown as tabs. status: "live" | "rolling".
   shots: real screenshots from the demo companies (every name and number in them is made up).
   careful: i18n keys for honest "good to know" notes shown under the module. */
export const MODULES = [
  { id: "hr",         status: "live", connects: ["payroll", "app"],
    shots: [["01-hr-dashboard", "shot_hr"], ["02-time-off", "shot_leave"], ["04-attendance", "shot_att"], ["05-claims", "shot_claims"]],
    careful: ["care_face"] },
  { id: "payroll",    status: "live", connects: ["hr", "finance", "app"],
    shots: [["03-payroll", "shot_payroll"]],
    careful: ["care_pcb", "care_files", "care_loans"] },
  { id: "finance",    status: "live", connects: ["payroll", "operations"],
    careful: ["care_einv"] },
  { id: "operations", status: "live", connects: ["finance", "hr"],
    shots: [["06-operations-today", "shot_ops"], ["07-stock-purchasing", "shot_stock"], ["08-sales-delivery", "shot_sales"]] },
  { id: "talent",     status: "live", connects: ["hr"],
    careful: ["care_jobs"] },
  { id: "app",        status: "live", connects: ["hr", "payroll"],
    phones: [["09-phone-employee-home", "shot_p_home"], ["10-phone-payslips", "shot_p_slips"], ["11-phone-time-off", "shot_p_leave"], ["12-phone-driver-deliveries", "shot_p_driver"]] },
  { id: "marketing",  status: "rolling", connects: ["operations"] },
];

/* Roadmap. "live" items are what works today; "rolling" items are being finished now. */
export const ROADMAP = {
  live: ["road_people", "road_leave", "road_att", "road_claims", "road_payroll", "road_finance", "road_talent", "road_ops", "road_app"],
  rolling: ["road_myinvois", "road_statutory", "road_loans", "road_jobboards", "road_marketing", "road_hosting"],
};

/* Industry packs: planned add-ons built on the live core. Not available yet; shown as "Planned".
   `uses` lists the live modules each pack plugs into. `visual` picks the illustration (pos | calendar | gantt). */
export const INDUSTRIES = [
  { id: "fnb",      visual: "pos",      uses: ["operations", "finance", "payroll"] },
  { id: "catering", visual: "calendar", uses: ["operations", "hr", "finance"] },
  { id: "projects", visual: "gantt",    uses: ["hr", "finance", "operations"] },
  { id: "retail",   uses: ["operations", "finance"] },
  { id: "appt",     uses: ["hr", "finance"] },
  { id: "workshop", uses: ["operations", "finance"] },
  { id: "tuition",  uses: ["finance", "hr"] },
  { id: "rental",   uses: ["operations", "finance"] },
  { id: "fleet",    uses: ["operations", "hr"] },
];
