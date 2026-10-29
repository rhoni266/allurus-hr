/* allurus.my/superadmin: industries, features, the industry–feature matrix, companies, leads, finder scoring and
   the audit log. Signed in with an Allurus email/password; only accounts with the custom claim role=superadmin get
   in (granted with scripts/set-superadmin.js). Firestore rules enforce the same thing on the server.

   Every change goes through save(): the document and an auditLog entry about it are written in one batch, and the
   document carries lastAuditId. The rules refuse any superadmin write without that matching audit entry.
   Nothing is deleted: archive, unlink (linked: false) or clear an override (mode: 'none') instead. */
import { industryFeatures, missingDependencies, effectiveFeatures, activeLinks } from "../lib/catalog.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const [{ initializeApp }, AU, FS] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } = AU;
const { getFirestore, collection, getDocs, doc, writeBatch, serverTimestamp, query, orderBy, limit } = FS;

const fbApp = initializeApp(window.ALLURUS_FIREBASE);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const main = $("#sa"), nav = $("#saNav"), dlg = $("#saDialog");
const STATUSES = ["planned", "beta", "live"];
const LEAD_STATUSES = ["new", "contacted", "demo", "won", "lost"];
const LEAD_LABEL = { new: "New", contacted: "Contacted", demo: "Demo booked", won: "Won", lost: "Lost" };
const VIEWS = [["dashboard", "Dashboard"], ["industries", "Industries"], ["features", "Features"], ["matrix", "Matrix"], ["tenants", "Companies"], ["payments", "Payments"], ["plans", "Plans"], ["billingcfg", "Billing settings"], ["leads", "Leads"], ["finder", "Finder"], ["audit", "Audit log"]];
const S = { user: null, view: "dashboard", modules: [], features: [], industries: [], links: [], rules: [], tenants: [], overrides: [], leads: [], audit: [], plans: [], payments: [], invoices: [], config: {}, counts: {}, filter: {} };
const B = window.AllurusBilling;

/* ---------- small UI helpers ---------- */
let toastTimer;
function toast(msg, bad = false) {
  const el = $("#saToast"); el.textContent = msg; el.className = `sa-toast show${bad ? " bad" : ""}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = "sa-toast"; }, 3200);
}
/** Open a dialog with a form; resolves with FormData on submit, or null on cancel. */
function ask(title, body, okLabel = "Save", { wide = false } = {}) {
  dlg.className = `sa-dialog${wide ? " wide" : ""}`;
  dlg.innerHTML = `<form method="dialog" class="sa-form"><h2>${esc(title)}</h2><div class="sa-form-body">${body}</div>
    <div class="sa-form-foot"><button type="button" class="sa-btn ghost" data-cancel>Cancel</button><button type="submit" class="sa-btn primary">${esc(okLabel)}</button></div></form>`;
  dlg.showModal();
  dlg.querySelector("input:not([type=hidden]):not([readonly]),select,textarea")?.focus();
  return new Promise((res) => {
    const form = dlg.querySelector("form");
    dlg.querySelector("[data-cancel]").onclick = () => { dlg.close(); res(null); };
    dlg.oncancel = () => res(null);
    form.onsubmit = (e) => { e.preventDefault(); const fd = new FormData(form); dlg.close(); res(fd); };
  });
}
const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
const fmtTime = (ts) => { const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null; return d ? d.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }) : ""; };
const badge = (s) => `<span class="sa-st ${esc(s)}">${esc(s)}</span>`;
const fbk = () => Object.fromEntries(S.features.map((f) => [f.key, f]));
const indBySlug = (s) => S.industries.find((i) => i.slug === s);
const clean = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v))));

/* ---------- audited writes ---------- */
/**
 * items: [{ type, path, data, before, action, plain }] — `plain` skips updatedAt/createdAt (companies and leads,
 * whose rules allow only specific fields to change). Each item gets its own audit entry in the same batch.
 */
async function save(items) {
  const now = serverTimestamp();
  for (let i = 0; i < items.length; i += 200) {
    const b = writeBatch(db);
    for (const it of items.slice(i, i + 200)) {
      const id = it.path.split("/")[1];
      const a = doc(collection(db, "auditLog"));
      b.set(a, { actorUid: S.user.uid, actorEmail: S.user.email || "", action: it.action, entityType: it.type, entityId: id,
        before: clean(it.before ?? null), after: clean(it.data), createdAt: now });
      const stamps = it.plain ? {} : { updatedAt: now, ...(it.before ? {} : { createdAt: now, createdBy: S.user.uid }) };
      b.set(doc(db, it.path), { ...it.data, lastAuditId: a.id, ...stamps }, { merge: true });
    }
    await b.commit();
  }
}
async function run(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); await load(); render(); }
  catch (e) { console.error(e); toast(`Not saved: ${e.code === "permission-denied" ? "permission denied (are you still a superadmin?)" : e.message}`, true); }
}

/* ---------- data ---------- */
async function all(col, ...q) { const s = await getDocs(q.length ? query(collection(db, col), ...q) : collection(db, col)); return s.docs.map((d) => ({ id: d.id, ...d.data() })); }
async function load() {
  const [modules, features, industries, links, rules, tenants, overrides, leads, audit, plans, payments, invoices, config] = await Promise.all([
    all("modules"), all("features"), all("industries"), all("industryFeatures"), all("finderRules"), all("tenants"), all("tenantFeatureOverrides"),
    all("leads", orderBy("createdAt", "desc")), all("auditLog", orderBy("createdAt", "desc"), limit(200)),
    all("plans").catch(() => []), all("payments", orderBy("createdAt", "desc")).catch(() => []), all("invoices").catch(() => []), all("config").catch(() => []),
  ]);
  S.plans = plans; S.payments = payments; S.invoices = invoices; S.config = Object.fromEntries(config.map((c) => [c.id, c]));
  // Employees per company (a count, not the records).
  await Promise.all(tenants.map(async (t) => { try { S.counts[t.id] = (await FS.getCountFromServer(collection(db, `tenants/${t.id}/people`))).data().count; } catch (e) { S.counts[t.id] = null; } }));
  Object.assign(S, {
    modules: modules.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    features: features.map((f) => ({ ...f, key: f.key || f.id })).sort((a, b) => (a.moduleKey || "").localeCompare(b.moduleKey || "") || a.name.localeCompare(b.name)),
    industries: industries.map((i) => ({ ...i, slug: i.slug || i.id })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    links, rules, tenants, overrides, leads, audit,
  });
}
const linkOf = (slug, key) => S.links.find((l) => l.industryId === slug && l.featureId === key);
const isLinked = (slug, key) => { const l = linkOf(slug, key); return !!l && l.linked !== false; };
const tenantsIn = (slug) => S.tenants.filter((t) => (t.industryIds || []).includes(slug));

/* ---------- views ---------- */
function render() {
  nav.hidden = false;
  nav.innerHTML = VIEWS.map(([id, label]) => `<button type="button" data-view="${id}" aria-current="${S.view === id}">${label}${id === "leads" ? ` <span class="sa-count">${S.leads.filter((l) => l.status === "new").length || ""}</span>` : id === "payments" ? ` <span class="sa-count">${S.payments.filter((p) => p.status === "submitted").length || ""}</span>` : ""}</button>`).join("");
  main.innerHTML = ({ dashboard, industries, features, matrix, tenants, payments, plans, billingcfg, leads, finder, audit })[S.view]();
}

function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return `<div class="sa-bars">${rows.map((r) => `<div class="sa-bar"><span class="sa-bar-l">${esc(r.label)}</span><span class="sa-bar-t"><i style="width:${(r.n / max) * 100}%"></i></span><b>${r.n}</b>${r.extra || ""}</div>`).join("") || '<p class="sa-muted">Nothing yet.</p>'}</div>`;
}
function dashboard() {
  const week = Date.now() - 7 * 864e5;
  const newLeads = S.leads.filter((l) => (l.createdAt?.toMillis?.() || 0) > week).length;
  const perInd = S.industries.map((i) => ({ i, n: S.leads.filter((l) => (l.industryIds || []).includes(i.slug)).length })).sort((a, b) => b.n - a.n);
  const featCount = {};
  for (const l of S.leads) for (const k of l.featureInterests || []) featCount[k] = (featCount[k] || 0) + 1;
  const F = fbk();
  return `<h1>Dashboard</h1>
    <div class="sa-kpis">
      <div class="sa-kpi"><span>Companies</span><b>${S.tenants.length}</b></div>
      <div class="sa-kpi"><span>New leads this week</span><b>${newLeads}</b></div>
      <div class="sa-kpi"><span>Leads, all time</span><b>${S.leads.length}</b></div>
      <div class="sa-kpi"><span>Industries</span><b>${S.industries.filter((i) => !i.archived).length}</b></div>
    </div>
    <div class="sa-cols">
      <section class="sa-card"><h2>Demand: leads per industry</h2><p class="sa-muted">Decides which planned industry to build first.</p>
        ${bars(perInd.map(({ i, n }) => ({ label: i.name, n, extra: ` ${badge(i.status || "planned")}${(i.status || "planned") === "planned" ? ` <button type="button" class="sa-link" data-promote="${esc(i.slug)}">Promote to Beta</button>` : ""}` })))}</section>
      <section class="sa-card"><h2>Most requested features</h2>
        ${bars(Object.entries(featCount).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ label: F[k]?.name || k, n })))}</section>
      <section class="sa-card"><h2>Companies per industry</h2>
        ${bars([...S.industries.map((i) => ({ label: i.name, n: tenantsIn(i.slug).length })), { label: "No industry set", n: S.tenants.filter((t) => !(t.industryIds || []).length).length }])}</section>
    </div>`;
}

function industries() {
  const rows = S.industries.map((i, n) => `<tr class="${i.archived ? "sa-archived" : ""}">
      <td class="sa-order"><button type="button" class="sa-icon" data-move="${esc(i.slug)}" data-dir="-1" aria-label="Move ${esc(i.name)} up" ${n ? "" : "disabled"}>↑</button><button type="button" class="sa-icon" data-move="${esc(i.slug)}" data-dir="1" aria-label="Move ${esc(i.name)} down" ${n < S.industries.length - 1 ? "" : "disabled"}>↓</button></td>
      <td><b>${esc(i.name)}</b><br><span class="sa-muted">/industries/${esc(i.slug)}</span></td>
      <td><select data-ind-status="${esc(i.slug)}" aria-label="Status of ${esc(i.name)}">${STATUSES.map((s) => `<option ${s === (i.status || "planned") ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><label class="sa-switch"><input type="checkbox" data-ind-visible="${esc(i.slug)}" ${i.visible !== false ? "checked" : ""}> Public</label></td>
      <td>${activeLinks(S.links).filter((l) => l.industryId === i.slug && !String(l.featureId).startsWith("area.")).length}</td>
      <td>${tenantsIn(i.slug).length}</td>
      <td class="sa-actions"><button type="button" class="sa-btn" data-edit-ind="${esc(i.slug)}">Edit</button>
        <button type="button" class="sa-btn ghost" data-archive-ind="${esc(i.slug)}">${i.archived ? "Restore" : "Archive"}</button></td></tr>`).join("");
  return `<div class="sa-head"><h1>Industries</h1><button type="button" class="sa-btn primary" data-new-ind>New industry</button></div>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Order</th><th>Industry</th><th>Status</th><th>Shown</th><th>Features</th><th>Companies</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function industryForm(i = {}) {
  const sample = (i.sampleData || []).map((s) => `${s.label} | ${s.value}`).join("\n");
  const ta = (name, label, val, rows = 4, hint = "One per line") => `<label class="sa-f full"><span>${label} <em>${hint}</em></span><textarea name="${name}" rows="${rows}">${esc(Array.isArray(val) ? val.join("\n") : val || "")}</textarea></label>`;
  return `<div class="sa-grid">
    <label class="sa-f"><span>Name</span><input name="name" required value="${esc(i.name)}"></label>
    <label class="sa-f"><span>Slug <em>${i.slug ? "fixed" : "letters, numbers, dashes"}</em></span><input name="slug" required pattern="[a-z0-9-]+" ${i.slug ? "readonly" : ""} value="${esc(i.slug)}"></label>
    <label class="sa-f full"><span>Tagline</span><input name="tagline" value="${esc(i.tagline)}"></label>
    <label class="sa-f"><span>Name (Bahasa Malaysia) <em>optional</em></span><input name="msName" value="${esc(i.ms?.name)}"></label>
    <label class="sa-f"><span>Tagline (Bahasa Malaysia) <em>optional</em></span><input name="msTagline" value="${esc(i.ms?.tagline)}"></label>
    <label class="sa-f"><span>Status</span><select name="status">${STATUSES.map((s) => `<option ${s === (i.status || "planned") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    <label class="sa-f"><span>Sort order</span><input name="order" type="number" value="${esc(i.order ?? S.industries.length + 1)}"></label>
    <label class="sa-f"><span>Icon <em>optional</em></span><input name="icon" value="${esc(i.icon)}"></label>
    <label class="sa-f"><span>Illustration</span><select name="illustration">${["", "pos", "calendar", "gantt"].map((x) => `<option value="${x}" ${x === (i.illustration || "") ? "selected" : ""}>${x || "None"}</option>`).join("")}</select></label>
    <label class="sa-f full"><span>Illustration image URL <em>optional</em></span><input name="illustrationUrl" value="${esc(i.illustrationUrl)}"></label>
    <fieldset class="sa-f full"><legend>Builds on</legend><div class="sa-checks">${S.modules.map((m) => `<label><input type="checkbox" name="buildsOnModules" value="${esc(m.key)}" ${(i.buildsOnModules || []).includes(m.key) ? "checked" : ""}> ${esc(m.name)}</label>`).join("")}</div></fieldset>
    <label class="sa-f full sa-inline"><input type="checkbox" name="visible" ${i.visible !== false ? "checked" : ""}> Visible on the public site</label>
    ${ta("whoFor", "Who this is for", i.whoFor)}
    ${ta("signsThisIsYou", "Signs this is you", i.signsThisIsYou)}
    ${ta("problemsSolved", "Problems we solve", i.problemsSolved)}
    ${ta("dayStory", "A day in your business", i.dayStory, 4, "")}
    ${ta("sampleData", "Sample data", sample, 4, "label | value, one per line")}
    ${ta("worksWith", "Works with", i.worksWith)}
    <label class="sa-f full"><span>SEO title</span><input name="seoTitle" value="${esc(i.seoTitle)}"></label>
    <label class="sa-f full"><span>SEO description</span><textarea name="seoDescription" rows="2">${esc(i.seoDescription)}</textarea></label>
  </div>`;
}
async function editIndustry(slug) {
  const before = slug ? indBySlug(slug) : null;
  const fd = await ask(before ? `Edit ${before.name}` : "New industry", industryForm(before || {}), before ? "Save" : "Create", { wide: true });
  if (!fd) return;
  const newSlug = (before?.slug || fd.get("slug")).trim().toLowerCase();
  if (!before && indBySlug(newSlug)) return toast(`An industry with slug "${newSlug}" already exists.`, true);
  const data = {
    slug: newSlug, name: fd.get("name").trim(), tagline: fd.get("tagline").trim(), status: fd.get("status"), order: Number(fd.get("order")) || 0,
    icon: fd.get("icon").trim(), illustration: fd.get("illustration"), illustrationUrl: fd.get("illustrationUrl").trim(), visible: fd.has("visible"),
    buildsOnModules: fd.getAll("buildsOnModules"), whoFor: lines(fd.get("whoFor")), signsThisIsYou: lines(fd.get("signsThisIsYou")),
    problemsSolved: lines(fd.get("problemsSolved")), dayStory: fd.get("dayStory").trim(), worksWith: lines(fd.get("worksWith")),
    sampleData: lines(fd.get("sampleData")).map((x) => { const [label, ...v] = x.split("|"); return { label: label.trim(), value: v.join("|").trim() }; }),
    seoTitle: fd.get("seoTitle").trim(), seoDescription: fd.get("seoDescription").trim(),
    ms: { name: fd.get("msName").trim(), tagline: fd.get("msTagline").trim() }, archived: before?.archived || false,
  };
  const items = [{ type: "industry", path: `industries/${newSlug}`, data, before, action: before ? "update" : "create" }];
  // A new industry gets the core app areas, hidden from the public page (same as the starter data).
  if (!before) for (const f of S.features.filter((x) => x.key.startsWith("area.") && !x.archived)) items.push(linkItem(newSlug, f.key, { linked: true, showPublic: false, order: 90 }));
  await run(() => save(items), before ? "Industry saved" : "Industry created");
}

function features() {
  const used = (k) => activeLinks(S.links).filter((l) => l.featureId === k).length;
  const rows = S.features.map((f) => `<tr class="${f.archived ? "sa-archived" : ""}">
    <td><code>${esc(f.key)}</code></td><td><b>${esc(f.name)}</b><br><span class="sa-muted">${esc(f.description)}</span></td>
    <td>${esc(S.modules.find((m) => m.key === f.moduleKey)?.name || f.moduleKey)}</td><td>${badge(f.status || "planned")}</td>
    <td>${(f.dependsOn || []).map((d) => `<code>${esc(d)}</code>`).join(" ")}</td><td>${used(f.key)}</td>
    <td class="sa-actions"><button type="button" class="sa-btn" data-edit-feat="${esc(f.key)}">Edit</button>
      <button type="button" class="sa-btn ghost" data-archive-feat="${esc(f.key)}">${f.archived ? "Restore" : "Archive"}</button></td></tr>`).join("");
  return `<div class="sa-head"><h1>Features</h1><button type="button" class="sa-btn primary" data-new-feat>New feature</button></div>
    <p class="sa-muted">Keys starting with <code>area.</code> switch whole areas of the app on or off for a company.</p>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Key</th><th>Feature</th><th>Module</th><th>Status</th><th>Needs</th><th>Industries</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function editFeature(key) {
  const f = key ? S.features.find((x) => x.key === key) : null;
  const fd = await ask(f ? `Edit ${f.name}` : "New feature", `<div class="sa-grid">
    <label class="sa-f"><span>Key <em>${f ? "fixed" : "e.g. pos, job-cards"}</em></span><input name="key" required pattern="[a-z0-9.-]+" ${f ? "readonly" : ""} value="${esc(f?.key)}"></label>
    <label class="sa-f"><span>Name</span><input name="name" required value="${esc(f?.name)}"></label>
    <label class="sa-f full"><span>Description</span><textarea name="description" rows="2">${esc(f?.description)}</textarea></label>
    <label class="sa-f"><span>Module</span><select name="moduleKey">${S.modules.map((m) => `<option value="${esc(m.key)}" ${m.key === f?.moduleKey ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
    <label class="sa-f"><span>Status</span><select name="status">${STATUSES.map((s) => `<option ${s === (f?.status || "planned") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    <label class="sa-f"><span>Icon <em>optional</em></span><input name="icon" value="${esc(f?.icon)}"></label>
    <label class="sa-f sa-inline"><input type="checkbox" name="isAddon" ${f?.isAddon ? "checked" : ""}> Paid add-on</label>
    <label class="sa-f"><span>Price tier <em>optional</em></span><input name="priceTier" value="${esc(f?.priceTier)}"></label>
    <fieldset class="sa-f full"><legend>Depends on</legend><div class="sa-checks sa-checks-scroll">${S.features.filter((x) => x.key !== f?.key && !x.archived).map((x) => `<label><input type="checkbox" name="dependsOn" value="${esc(x.key)}" ${(f?.dependsOn || []).includes(x.key) ? "checked" : ""}> ${esc(x.name)}</label>`).join("")}</div></fieldset>
  </div>`, f ? "Save" : "Create", { wide: true });
  if (!fd) return;
  const k = (f?.key || fd.get("key")).trim().toLowerCase();
  if (!f && S.features.some((x) => x.key === k)) return toast(`A feature with key "${k}" already exists.`, true);
  const data = { key: k, name: fd.get("name").trim(), description: fd.get("description").trim(), moduleKey: fd.get("moduleKey"), status: fd.get("status"),
    icon: fd.get("icon").trim(), isAddon: fd.has("isAddon"), priceTier: fd.get("priceTier").trim(), dependsOn: fd.getAll("dependsOn"), archived: f?.archived || false };
  await run(() => save([{ type: "feature", path: `features/${k}`, data, before: f, action: f ? "update" : "create" }]), f ? "Feature saved" : "Feature created");
}

/* Matrix: features (rows) × industries (columns). */
function linkItem(slug, key, patch, action) {
  const before = linkOf(slug, key) || null;
  const base = before ? {} : { industryId: slug, featureId: key, linked: true, showPublic: true, isHeadline: false, customLabel: "", customDescription: "", order: 50 };
  return { type: "industryFeature", path: `industryFeatures/${slug}_${key}`, data: { industryId: slug, featureId: key, ...base, ...patch }, before, action: action || (before ? "update" : "link") };
}
function matrix() {
  const q = (S.filter.matrix || "").toLowerCase();
  const inds = S.industries.filter((i) => !i.archived);
  const feats = S.features.filter((f) => !f.archived && (!q || f.name.toLowerCase().includes(q) || f.key.includes(q)));
  const groups = S.modules.map((m) => [m, feats.filter((f) => (f.moduleKey || "other") === m.key)]).filter(([, fs]) => fs.length);
  return `<div class="sa-head"><h1>Industry–feature matrix</h1>
      <div class="sa-tools"><input type="search" placeholder="Filter features" aria-label="Filter features" data-filter="matrix" value="${esc(S.filter.matrix || "")}">
      <button type="button" class="sa-btn" data-copy-links>Copy links from one industry to another</button></div></div>
    <p class="sa-muted">Tick to link a feature to an industry; it shows on that industry's public page and is on for its companies. Click ⋯ on a linked cell for its label, headline and public options.</p>
    <div class="sa-table-wrap sa-matrix"><table class="sa-table"><thead><tr><th class="sa-sticky">Feature</th>${inds.map((i) => `<th title="${esc(i.name)}"><span class="sa-vert">${esc(i.name)}</span></th>`).join("")}<th></th></tr></thead>
    <tbody>${groups.map(([m, fs]) => `<tr class="sa-group"><th colspan="${inds.length + 2}">${esc(m.name)}</th></tr>` + fs.map((f) => `<tr>
      <th class="sa-sticky" scope="row">${esc(f.name)} <code>${esc(f.key)}</code> ${badge(f.status || "planned")}</th>
      ${inds.map((i) => { const l = linkOf(i.slug, f.key), on = l && l.linked !== false; return `<td class="sa-cell ${on ? "on" : ""} ${on && l.isHeadline ? "head" : ""}">
        <input type="checkbox" data-link="${esc(i.slug)}|${esc(f.key)}" ${on ? "checked" : ""} aria-label="${esc(f.name)} for ${esc(i.name)}">
        ${on ? `<button type="button" class="sa-dots" data-cell="${esc(i.slug)}|${esc(f.key)}" aria-label="Options: ${esc(f.name)} for ${esc(i.name)}">⋯</button>` : ""}</td>`; }).join("")}
      <td><button type="button" class="sa-link" data-link-all="${esc(f.key)}">Link to all</button></td></tr>`).join("")).join("")}</tbody></table></div>`;
}
async function toggleLink(slug, key, on) {
  const ind = indBySlug(slug), F = fbk(), f = F[key];
  if (!on) {
    const fd = await ask(`Unlink ${f.name} from ${ind.name}?`, `<p>It disappears from the ${esc(ind.name)} page and from ${tenantsIn(slug).length} companies in this industry (unless added for them individually).</p>`, "Unlink");
    if (!fd) return render();
    return run(() => save([linkItem(slug, key, { linked: false }, "unlink")]), "Unlinked");
  }
  const missing = missingDependencies(key, slug, S.links, F).filter((k) => F[k] && !F[k].archived);
  const existing = tenantsIn(slug);
  const fd = await ask(`Link ${f.name} to ${ind.name}?`, `
    ${missing.length ? `<p class="sa-warn">${esc(f.name)} needs ${missing.map((k) => `<b>${esc(F[k].name)}</b>`).join(" and ")}.</p>
      <label class="sa-inline"><input type="checkbox" name="deps" checked> Link ${missing.length > 1 ? "them" : "it"} too</label>` : ""}
    ${existing.length ? `<label class="sa-inline"><input type="checkbox" name="existing" checked> Apply to the ${existing.length} existing ${existing.length > 1 ? "companies" : "company"} in this industry</label>
      <p class="sa-muted">Untick to give it only to companies that join this industry from now on.</p>` : ""}
    <label class="sa-f"><span>Label for this industry <em>optional</em></span><input name="label" placeholder="${esc(f.name)}"></label>
    <label class="sa-inline"><input type="checkbox" name="public" checked> Show on the public page</label>`, "Link");
  if (!fd) return render();
  const keys = [key, ...(fd.has("deps") ? missing : [])];
  const items = keys.map((k) => linkItem(slug, k, { linked: true, ...(k === key ? { customLabel: fd.get("label").trim(), showPublic: fd.has("public") } : {}) }, "link"));
  if (existing.length && !fd.has("existing")) {
    for (const t of existing) for (const k of keys) {
      const o = S.overrides.find((x) => x.tenantId === t.id && x.featureId === k);
      if (!o || o.mode === "none") items.push({ type: "tenantOverride", path: `tenantFeatureOverrides/${t.id}_${k}`, data: { tenantId: t.id, featureId: k, mode: "remove", reason: `Not applied to existing companies when linked to ${ind.name}` }, before: o || null, action: "override-remove" });
    }
  }
  await run(() => save(items), `Linked ${keys.length > 1 ? `${keys.length} features` : f.name} to ${ind.name}`);
}
async function cellOptions(slug, key) {
  const l = linkOf(slug, key), f = fbk()[key], ind = indBySlug(slug);
  const fd = await ask(`${f.name} · ${ind.name}`, `<div class="sa-grid">
    <label class="sa-f full"><span>Label for this industry <em>blank = "${esc(f.name)}"</em></span><input name="customLabel" value="${esc(l.customLabel)}"></label>
    <label class="sa-f full"><span>Description for this industry <em>optional</em></span><textarea name="customDescription" rows="2">${esc(l.customDescription)}</textarea></label>
    <label class="sa-f"><span>Sort order</span><input type="number" name="order" value="${esc(l.order ?? 50)}"></label>
    <label class="sa-inline"><input type="checkbox" name="showPublic" ${l.showPublic !== false ? "checked" : ""}> Show on the public page</label>
    <label class="sa-inline"><input type="checkbox" name="isHeadline" ${l.isHeadline ? "checked" : ""}> Headline feature (on the card)</label></div>`);
  if (!fd) return;
  await run(() => save([linkItem(slug, key, { customLabel: fd.get("customLabel").trim(), customDescription: fd.get("customDescription").trim(),
    order: Number(fd.get("order")) || 0, showPublic: fd.has("showPublic"), isHeadline: fd.has("isHeadline") })]), "Saved");
}
async function linkToAll(key) {
  const f = fbk()[key], todo = S.industries.filter((i) => !i.archived && !isLinked(i.slug, key));
  if (!todo.length) return toast(`${f.name} is already linked to every industry.`);
  const fd = await ask(`Link ${f.name} to all industries?`, `<p>Adds it to ${todo.map((i) => esc(i.name)).join(", ")}.</p>`, "Link to all");
  if (fd) await run(() => save(todo.map((i) => linkItem(i.slug, key, { linked: true }, "link"))), `Linked to ${todo.length} industries`);
}
async function copyLinks() {
  const opts = S.industries.filter((i) => !i.archived).map((i) => `<option value="${esc(i.slug)}">${esc(i.name)}</option>`).join("");
  const fd = await ask("Copy links", `<div class="sa-grid"><label class="sa-f"><span>From</span><select name="from">${opts}</select></label>
    <label class="sa-f"><span>To</span><select name="to">${opts}</select></label></div><p class="sa-muted">Adds every feature linked to the first industry to the second, with the same options. Nothing is removed.</p>`, "Copy");
  if (!fd || fd.get("from") === fd.get("to")) return;
  const from = fd.get("from"), to = fd.get("to");
  const items = activeLinks(S.links).filter((l) => l.industryId === from && !isLinked(to, l.featureId))
    .map((l) => linkItem(to, l.featureId, { linked: true, showPublic: l.showPublic !== false, isHeadline: false, customLabel: l.customLabel || "", order: l.order ?? 50 }, "link-copy"));
  if (!items.length) return toast("Nothing to copy: they already share every feature.");
  await run(() => save(items), `Copied ${items.length} links`);
}

/* Companies */
const STATUS_LABEL = { trial: "Trial", active: "Active", past_due: "Past due", expired: "Expired", suspended: "Suspended", cancelled: "Cancelled" };
const STATUS_CLS = { trial: "beta", active: "live", past_due: "removed", expired: "removed", suspended: "removed", cancelled: "planned" };
const myDay = (t) => (t ? new Date(B.ms(t)).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" }) : "");
const FILTERS = [["all", "All"], ["trial7", "Trial ending in 7 days"], ["expired", "Expired"], ["past_due", "Past due"], ["active", "Active"], ["trial", "In trial"], ["delete", "Due for deletion"], ["test", "Test"]];
function filtered() {
  const f = S.filter.co || "all", now = Date.now();
  return S.tenants.filter((t) => {
    const e = B.effective(t, now);
    if (f === "all") return true;
    if (f === "trial7") return e === "trial" && B.daysLeft(B.ms(t.trialEndsAt), now) <= 7;
    if (f === "delete") return (B.deletion(t, now)?.days ?? 99) <= 0;
    if (f === "test") return !!t.isTest;
    return e === f;
  });
}
function tenants() {
  const list = filtered();
  return `<div class="sa-head"><h1>Companies</h1><div class="sa-tools"><select data-filter="co" aria-label="Filter">${FILTERS.map(([v, l]) => `<option value="${v}" ${(S.filter.co || "all") === v ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="sa-btn primary" data-new-tenant>Create company manually</button></div></div>
    <p class="sa-muted">Companies sign themselves up at allurus.my/signup (30-day trial). Create one here for a client you onboard yourself: its first admin gets an invitation email.</p>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Company</th><th>Status</th><th>Plan</th><th>Trial ends</th><th>Paid until</th><th>Employees</th><th>Admin</th><th>Industries</th><th></th></tr></thead><tbody>
    ${list.map((t) => { const e = B.effective(t), del = B.deletion(t);
      return `<tr><td><b>${esc(t.name || t.id)}</b>${t.isTest ? ' <span class="sa-chip">test</span>' : ""}<br><span class="sa-muted">${esc(t.createdVia === "self_signup" ? "Signed up" : "Created by superadmin")}${t.createdAt ? ` · ${esc(myDay(t.createdAt))}` : ""}</span>
      ${t.owner ? "" : t.inviteStatus === "failed" ? '<br><span class="sa-src removed">Invite failed</span>' : `<br><span class="sa-src dependency">Not activated yet${t.inviteSentAt ? ` · invited ${esc(fmtTime(t.inviteSentAt))}` : ""}</span>`}</td>
      <td><span class="sa-st ${STATUS_CLS[e]}">${STATUS_LABEL[e]}</span>${del ? `<br><span class="sa-muted">${del.days > 0 ? `Data kept ${del.days} more days` : "Due for deletion"}</span>` : ""}${t.statusNote ? `<br><span class="sa-muted">${esc(t.statusNote)}</span>` : ""}</td>
      <td>${esc(t.plan || "")}</td><td>${esc(myDay(t.trialEndsAt))}</td><td>${esc(myDay(t.paidUntil))}</td><td>${S.counts[t.id] ?? "–"}</td><td>${esc(t.admin || "")}</td>
      <td>${(t.industryIds || []).map((s) => `<span class="sa-chip">${esc(indBySlug(s)?.name || s)}</span>`).join(" ") || '<span class="sa-muted">None</span>'}</td>
      <td class="sa-actions"><button type="button" class="sa-btn primary" data-billing="${esc(t.id)}">Billing</button> <button type="button" class="sa-btn" data-tenant="${esc(t.id)}">Features</button> <button type="button" class="sa-btn" data-view-co="${esc(t.id)}">Open</button> <button type="button" class="sa-btn" data-export-co="${esc(t.id)}">Export</button>${t.owner ? "" : ` <button type="button" class="sa-btn" data-retry-invite="${esc(t.id)}">Retry invite</button>`}</td></tr>`; }).join("") || '<tr><td colspan="9" class="sa-muted">No companies match.</td></tr>'}</tbody></table></div>`;
}
// Billing actions for one company: each one audited, with a reason.
async function billingActions(id) {
  const t = S.tenants.find((x) => x.id === id), e = B.effective(t);
  const plans = S.plans.filter((p) => p.active !== false);
  const fd = await ask(`${t.name}: billing`, `<p class="sa-muted">Now: <b>${STATUS_LABEL[e]}</b>${t.trialEndsAt ? ` · trial ends ${esc(myDay(t.trialEndsAt))}` : ""}${t.paidUntil ? ` · paid until ${esc(myDay(t.paidUntil))}` : ""}${t.plan ? ` · plan ${esc(t.plan)}` : ""}</p>
    <div class="sa-grid">
      <label class="sa-f full"><span>Action</span><select name="act" required>
        <option value="extend">Extend trial</option><option value="paid">Mark as paid</option><option value="plan">Change plan</option>
        <option value="suspend">Suspend</option><option value="reactivate">Reactivate</option><option value="cancel">Cancel subscription</option><option value="test">${t.isTest ? "Unmark as test" : "Mark as test"}</option></select></label>
      <label class="sa-f"><span>Days <em>(extend trial)</em></span><input name="days" type="number" min="1" max="90" value="14"></label>
      <label class="sa-f"><span>Months <em>(mark as paid)</em></span><input name="months" type="number" min="1" max="24" value="1"></label>
      <label class="sa-f"><span>Plan <em>(paid / change plan)</em></span><select name="plan">${plans.map((p) => `<option value="${esc(p.id)}" ${t.plan === p.id ? "selected" : ""}>${esc(p.name)}${p.priceMyr ? ` · RM ${Number(p.priceMyr).toFixed(2)}` : ""}</option>`).join("") || '<option value="">No plans yet (add them under Plans)</option>'}</select></label>
      <label class="sa-f"><span>Amount received (RM) <em>(mark as paid)</em></span><input name="amount" type="number" min="0" step="0.01"></label>
      <label class="sa-f full"><span>Reason <em>(saved in the audit log)</em></span><input name="reason" required maxlength="200"></label></div>`, "Apply");
  if (!fd) return;
  const act = fd.get("act"), reason = String(fd.get("reason") || "").trim();
  if (!reason) return toast("Give a reason; it goes in the audit log.", true);
  const now = Date.now(), before = { status: t.status || null, plan: t.plan || null, trialEndsAt: t.trialEndsAt || null, paidUntil: t.paidUntil || null };
  const T = (d) => FS.Timestamp.fromDate(d);
  const tenantItem = (data, action) => ({ type: "tenant", path: `tenants/${id}`, data: { ...data, statusNote: reason.slice(0, 200) }, before, action, plain: true });
  let items;
  if (act === "extend") {
    const from = Math.max(now, B.ms(t.trialEndsAt) || now);
    items = [tenantItem({ status: "trial", trialEndsAt: T(B.trialEnd(from + B.DAY, Number(fd.get("days")) || 14)) }, "extend-trial")];
  } else if (act === "paid") {
    const plan = fd.get("plan"); if (!plan) return toast("Add a plan first, under Plans.", true);
    items = markPaidItems(t, plan, Number(fd.get("months")) || 1, Number(fd.get("amount")) || 0, reason);
  } else if (act === "plan") items = [tenantItem({ plan: fd.get("plan") }, "change-plan")];
  else if (act === "suspend") items = [tenantItem({ status: "suspended" }, "suspend")];
  else if (act === "cancel") items = [tenantItem({ status: "cancelled", expiredAt: T(new Date(now)) }, "cancel")];
  else if (act === "test") items = [tenantItem({ isTest: !t.isTest }, t.isTest ? "unmark-test" : "mark-test")];
  else items = [tenantItem({ status: B.ms(t.paidUntil) > now ? "active" : B.ms(t.trialEndsAt) > now ? "trial" : "active", ...(B.ms(t.paidUntil) > now || B.ms(t.trialEndsAt) > now ? {} : { paidUntil: T(B.extendPaid({}, 1, now)) }) }, "reactivate")];
  await run(() => save(items), "Saved");
}
// Mark as paid: the company's new paid-until, a sequential invoice, and the counter, in one audited batch.
function markPaidItems(t, planId, months, amount, reason, paymentId = null) {
  const now = Date.now(), until = B.extendPaid(t, months, now), n = (S.config.invoiceCounter?.next || 1);
  const invId = doc(collection(db, "invoices")).id, number = B.invoiceNo(n, now);
  const items = [
    { type: "tenant", path: `tenants/${t.id}`, data: { status: "active", plan: planId, paidUntil: FS.Timestamp.fromDate(until), statusNote: reason.slice(0, 200) }, before: { status: t.status || null, paidUntil: t.paidUntil || null, plan: t.plan || null }, action: "mark-paid", plain: true },
    { type: "invoice", path: `invoices/${invId}`, data: { tenantId: t.id, companyName: t.name, number, planId, months, amountMyr: amount, sst: 0, periodFrom: FS.Timestamp.fromDate(new Date(Math.max(now, B.ms(t.paidUntil) || 0))), periodTo: FS.Timestamp.fromDate(until), issuedAt: serverTimestamp(), paymentId }, before: null, action: "issue-invoice" },
    { type: "config", path: "config/invoiceCounter", data: { next: n + 1 }, before: S.config.invoiceCounter || null, action: "invoice-counter" },
  ];
  if (paymentId) items.push({ type: "payment", path: `payments/${paymentId}`, data: { status: "approved", reviewedBy: S.user.email || "", reviewedAt: serverTimestamp(), invoiceId: invId }, before: { status: "submitted" }, action: "approve-payment", plain: true });
  return items;
}
// Everything stored for one company, as one JSON file (the superadmin may read, never change, a company's data).
async function exportCompany(id) {
  const t = S.tenants.find((x) => x.id === id), out = { company: t, exportedAt: new Date().toISOString() };
  for (const sub of ["buckets", "people", "payslips", "personal"]) { try { out[sub] = (await getDocs(collection(db, `tenants/${id}/${sub}`))).docs.map((d) => ({ id: d.id, ...d.data() })); } catch (e) { out[sub] = `not readable: ${e.code}`; } }
  try { await FS.addDoc(collection(db, "auditLog"), { actorUid: S.user.uid, actorEmail: S.user.email || "", action: "export-company", entityType: "tenant", entityId: id, before: null, after: { name: t.name }, createdAt: serverTimestamp() }); } catch (e) { return toast("Couldn’t record the audit entry, so nothing was exported.", true); }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" })); a.download = `${(t.name || id).replace(/[^\w-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  toast("Exported");
}

/* Payments (bank-transfer proof from company admins) */
function payments() {
  const tn = (id) => S.tenants.find((t) => t.id === id)?.name || id;
  return `<div class="sa-head"><h1>Payments</h1></div><p class="sa-muted">Proof of bank transfers sent from each company’s Billing page. Approving marks the company paid and issues an invoice.</p>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Sent</th><th>Company</th><th>Reference</th><th>Plan</th><th>Amount</th><th>Proof</th><th>Status</th><th></th></tr></thead><tbody>
    ${S.payments.map((p) => `<tr><td>${esc(fmtTime(p.createdAt))}<br><span class="sa-muted">${esc(p.submittedBy || "")}</span></td><td>${esc(tn(p.tenantId))}</td><td><code>${esc(p.reference)}</code></td><td>${esc(p.planId)} · ${p.months} mo</td><td>RM ${Number(p.amountMyr || 0).toFixed(2)}</td>
      <td><button type="button" class="sa-link" data-proof="${esc(p.id)}">View ${esc(p.proofName || "proof")}</button></td><td>${esc(p.status)}${p.note ? `<br><span class="sa-muted">${esc(p.note)}</span>` : ""}</td>
      <td class="sa-actions">${p.status === "submitted" ? `<button type="button" class="sa-btn primary" data-approve="${esc(p.id)}">Mark as paid</button> <button type="button" class="sa-btn" data-reject="${esc(p.id)}">Reject</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="8" class="sa-muted">No payments yet.</td></tr>'}</tbody></table></div>`;
}
/* Plans: names, prices and limits (no price: not offered yet) */
function plans() {
  return `<div class="sa-head"><h1>Plans</h1><div class="sa-tools"><button type="button" class="sa-btn primary" data-plan="">Add plan</button></div></div>
    <p class="sa-muted">Companies choose from active plans with a price on their Billing page. Prices are in RM, before SST (not registered).</p>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Plan</th><th>Price</th><th>Per</th><th>Employees</th><th>Sites</th><th>Active</th><th></th></tr></thead><tbody>
    ${S.plans.map((p) => `<tr><td><b>${esc(p.name)}</b> <code>${esc(p.id)}</code></td><td>${p.priceMyr ? `RM ${Number(p.priceMyr).toFixed(2)}` : '<span class="sa-muted">Not set</span>'}</td><td>${esc(p.period || "month")}</td><td>${p.employeeLimit || "No limit"}</td><td>${p.siteLimit || "No limit"}</td><td>${p.active === false ? "No" : "Yes"}</td>
      <td><button type="button" class="sa-btn" data-plan="${esc(p.id)}">Edit</button></td></tr>`).join("") || '<tr><td colspan="7" class="sa-muted">No plans yet. Add one, or several.</td></tr>'}</tbody></table></div>`;
}
async function editPlan(id) {
  const p = S.plans.find((x) => x.id === id) || {};
  const fd = await ask(id ? `Edit ${p.name}` : "Add plan", `<div class="sa-grid">
    <label class="sa-f"><span>Plan code</span><input name="id" required pattern="[a-z0-9-]{2,30}" value="${esc(p.id || "")}" ${id ? "readonly" : ""}></label>
    <label class="sa-f"><span>Name</span><input name="name" required maxlength="60" value="${esc(p.name || "")}"></label>
    <label class="sa-f"><span>Price (RM) <em>(blank: not offered yet)</em></span><input name="priceMyr" type="number" min="0" step="0.01" value="${esc(p.priceMyr ?? "")}"></label>
    <label class="sa-f"><span>Billed per</span><select name="period"><option ${p.period !== "year" ? "selected" : ""}>month</option><option ${p.period === "year" ? "selected" : ""}>year</option></select></label>
    <label class="sa-f"><span>Employee limit <em>(blank: none)</em></span><input name="employeeLimit" type="number" min="0" value="${esc(p.employeeLimit ?? "")}"></label>
    <label class="sa-f"><span>Site limit <em>(blank: none)</em></span><input name="siteLimit" type="number" min="0" value="${esc(p.siteLimit ?? "")}"></label>
    <label class="sa-inline"><input type="checkbox" name="active" ${p.active === false ? "" : "checked"}> Active (offered to companies)</label></div>`);
  if (!fd) return;
  const pid = String(fd.get("id")).trim().toLowerCase(); if (!/^[a-z0-9-]{2,30}$/.test(pid)) return toast("Plan code: 2–30 lower-case letters, numbers or dashes.", true);
  const num = (k) => (String(fd.get(k) || "").trim() === "" ? null : Number(fd.get(k)));
  const data = { name: String(fd.get("name")).trim(), priceMyr: num("priceMyr"), period: fd.get("period"), employeeLimit: num("employeeLimit"), siteLimit: num("siteLimit"), active: fd.has("active"), featureKeys: p.featureKeys || [] };
  await run(() => save([{ type: "plan", path: `plans/${pid}`, data, before: id ? p : null, action: id ? "edit-plan" : "add-plan" }]), "Plan saved");
}
/* Billing settings: where companies pay */
function billingcfg() {
  const c = S.config.billing || {};
  return `<div class="sa-head"><h1>Billing settings</h1></div><p class="sa-muted">Shown on every company’s Billing page. The reference is made for each company (ALR-&lt;code&gt;-&lt;YYYYMM&gt;).</p>
    <form class="sa-card" id="billcfg"><div class="sa-grid">
      <label class="sa-f"><span>Bank</span><input name="bankName" maxlength="60" value="${esc(c.bankName || "")}"></label>
      <label class="sa-f"><span>Account name</span><input name="accountName" maxlength="100" value="${esc(c.accountName || "")}"></label>
      <label class="sa-f"><span>Account number</span><input name="accountNo" maxlength="30" value="${esc(c.accountNo || "")}"></label>
      <label class="sa-f"><span>DuitNow ID <em>(optional)</em></span><input name="duitnow" maxlength="60" value="${esc(c.duitnow || "")}"></label>
      <label class="sa-f"><span>Billing contact email</span><input name="contact" type="email" maxlength="120" value="${esc(c.contact || "hello@allurus.my")}"></label>
      <label class="sa-f"><span>DuitNow QR image <em>(optional, under 300 KB)</em></span><input name="qr" type="file" accept="image/*"></label>
    </div>${c.qr ? `<img src="${esc(c.qr)}" alt="Current DuitNow QR" style="width:140px;margin:10px 0;border-radius:12px">` : ""}<button type="submit" class="sa-btn primary">Save</button></form>`;
}
async function saveBillingCfg(form) {
  const fd = new FormData(form), c = S.config.billing || {};
  const data = Object.fromEntries(["bankName", "accountName", "accountNo", "duitnow", "contact"].map((k) => [k, String(fd.get(k) || "").trim()]));
  const file = fd.get("qr");
  if (file && file.size) {
    if (file.size > 300 * 1024) return toast("The QR image must be under 300 KB.", true);
    data.qr = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
  }
  await run(() => save([{ type: "config", path: "config/billing", data, before: c.bankName ? c : null, action: "billing-settings" }]), "Billing settings saved");
}
// A new company, with no owner until its first admin activates their invitation (an Owner: every area).
async function newTenant() {
  const fd = await ask("New company", `<div class="sa-grid">
    <label class="sa-f full"><span>Company name</span><input name="name" required maxlength="120"></label>
    <label class="sa-f"><span>First admin’s name</span><input name="adminName" required maxlength="100"></label>
    <label class="sa-f"><span>First admin’s work email</span><input name="email" type="email" required maxlength="200"></label>
    <label class="sa-f"><span>City <em>(optional)</em></span><input name="city" maxlength="60"></label>
    <label class="sa-f"><span>Industry <em>(optional)</em></span><select name="ind"><option value="">None</option>${S.industries.filter((i) => !i.archived).map((i) => `<option value="${esc(i.slug)}">${esc(i.name)}</option>`).join("")}</select></label></div>
    <p class="sa-muted">They get an email with a sign-in link, valid 7 days. No account exists until they activate.</p>`, "Create and invite");
  if (!fd) return;
  const name = String(fd.get("name")).trim(), email = String(fd.get("email")).trim().toLowerCase(), adminName = String(fd.get("adminName")).trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("Enter a company name and a valid email.", true);
  // Same name or same first admin as an existing company: ask before making another.
  const dup = S.tenants.filter((t) => (t.name || "").trim().toLowerCase() === name.toLowerCase() || (t.admin || "").toLowerCase() === email);
  // The email may also be invited to, or already in, a company under another admin.
  const [inv, users] = await Promise.all([FS.getDoc(doc(db, `invites/${email}`)).catch(() => null), getDocs(query(collection(db, "users"), FS.where("email", "==", email))).catch(() => null)]);
  const other = [...(inv?.exists() ? [inv.data().tenantId] : []), ...(users?.docs || []).map((d) => d.data().tenantId)].filter((id) => !dup.some((t) => t.id === id));
  other.forEach((id) => { const t = S.tenants.find((x) => x.id === id); if (t) dup.push(t); });
  if (dup.length) {
    const ok = await ask("This company may already exist", `<p>${dup.map((t) => `<b>${esc(t.name)}</b> (admin ${esc(t.admin || "none")}${t.owner ? "" : ", not activated yet"})`).join("<br>")}</p>
      <p class="sa-muted">${dup.some((t) => !t.owner) ? "To send its invitation again, use <b>Retry invite</b> on the Companies list instead." : "Create another company anyway?"}</p>`, "Create another anyway");
    if (!ok) return;
  }
  const tref = doc(collection(db, "tenants"));
  // 1. The email first: if Firebase can't send it, nothing is created.
  try { await sendInvite(email, tref.id); }
  catch (e) { return toast(authError(e), true); }
  // 2. The company, then the invitation. If the invitation can't be saved, the company is marked so it can be retried.
  try {
    await save([{ type: "tenant", path: `tenants/${tref.id}`, data: { owner: null, name, admin: email, adminName, city: String(fd.get("city") || "").trim(), industry: "", plan: "trial", seats: 0, createdAt: serverTimestamp(), inviteStatus: "sent", inviteSentAt: serverTimestamp(),
      status: "trial", isTest: false, trialStartedAt: serverTimestamp(), trialEndsAt: FS.Timestamp.fromDate(B.trialEnd(Date.now())), createdVia: "superadmin" }, before: null, action: "create-company", plain: true }]);
  } catch (e) { console.error(e?.code); await load(); render(); return toast(`The company wasn’t created (${e.code === "permission-denied" ? "permission denied: are you still a superadmin?" : "connection problem"}). The email that went out won’t work; try again.`, true); }
  try { await writeInvite(email, tref.id, adminName, name); toast(`${name} created. Invitation sent to ${email}, valid 7 days.`); }
  catch (e) { console.error(e?.code); await markInvite(tref.id, "failed"); toast(`${name} was created, but its invitation couldn’t be saved. Use Retry invite.`, true); }
  await load(); render();
}
// Firebase Auth error codes as plain sentences.
function authError(e) {
  const m = {
    "auth/operation-not-allowed": "Email sign-in links aren’t turned on in Firebase. Turn on Authentication → Sign-in method → Email/Password → Email link (passwordless sign-in), then try again.",
    "auth/unauthorized-continue-uri": "This website’s address isn’t on Firebase’s authorised domains list (Authentication → Settings → Authorised domains).",
    "auth/invalid-email": "That email address isn’t valid.",
    "auth/quota-exceeded": "Firebase’s daily limit for sign-in emails is used up. Try again tomorrow.",
    "auth/too-many-requests": "Too many emails sent just now. Wait a few minutes and try again.",
    "auth/network-request-failed": "You seem to be offline. Check your connection and try again.",
  };
  console.warn("[superadmin] auth", e?.code);
  return m[e?.code] || "The invitation email couldn’t be sent. Try again in a moment.";
}
const sendInvite = (email, tenantId) => AU.sendSignInLinkToEmail(auth, email, { url: `${location.origin}/activate?c=${encodeURIComponent(tenantId)}`, handleCodeInApp: true });
const writeInvite = (email, tenantId, adminName, company) => FS.setDoc(doc(db, `invites/${email}`), { tenantId, empId: "e1", name: adminName, company, roles: ["admin", "employee"], invitedBy: S.user.email || "", invitedAt: serverTimestamp(), sentAt: serverTimestamp(), expiresAt: FS.Timestamp.fromDate(new Date(Date.now() + 7 * 864e5)) });
const markInvite = (id, status) => save([{ type: "tenant", path: `tenants/${id}`, data: { inviteStatus: status, ...(status === "sent" ? { inviteSentAt: serverTimestamp() } : {}) }, before: { inviteStatus: S.tenants.find((t) => t.id === id)?.inviteStatus || null }, action: `invite-${status}`, plain: true }]).catch(() => {});
// Send the first admin's invitation again (a company that isn't activated yet).
async function retryInvite(id) {
  const t = S.tenants.find((x) => x.id === id); if (!t || t.owner) return;
  try { await sendInvite(t.admin, id); } catch (e) { await markInvite(id, "failed"); await load(); render(); return toast(authError(e), true); }
  const old = await FS.getDoc(doc(db, `invites/${t.admin}`)).catch(() => null);
  try { await writeInvite(t.admin, id, t.adminName || old?.data()?.name || t.admin, t.name); await markInvite(id, "sent"); toast(`Invitation sent again to ${t.admin}, valid 7 days.`); }
  catch (e) { await markInvite(id, "failed"); toast("The email went out, but the invitation couldn’t be saved. Try again.", true); }
  await load(); render();
}
async function openTenant(id) {
  const t = S.tenants.find((x) => x.id === id), F = fbk();
  const ov = S.overrides.filter((o) => o.tenantId === id);
  const modeOf = (k) => ov.find((o) => o.featureId === k)?.mode || "none";
  const eff = effectiveFeatures({ industryIds: t.industryIds || [], links: S.links, overrides: ov.filter((o) => o.mode !== "none"), featuresByKey: F });
  const tag = (k) => (eff.removed.has(k) ? '<span class="sa-src removed">removed</span>' : eff.source[k] ? `<span class="sa-src ${eff.source[k]}">${{ industry: "from industry", extra: "extra", dependency: "needed by another" }[eff.source[k]]}</span>` : "");
  const fd = await ask(t.name || id, `
    <fieldset class="sa-f full"><legend>Industries</legend><div class="sa-checks">${S.industries.filter((i) => !i.archived).map((i) => `<label><input type="checkbox" name="ind" value="${esc(i.slug)}" ${(t.industryIds || []).includes(i.slug) ? "checked" : ""}> ${esc(i.name)}</label>`).join("")}</div>
      <p class="sa-muted">With no industry, the company keeps every area of the app. Once an industry is set, areas follow its <code>area.*</code> links.</p></fieldset>
    <h3>Effective features (${eff.keys.size})</h3>
    <div class="sa-table-wrap sa-tenant-feats"><table class="sa-table"><thead><tr><th>Feature</th><th>Now</th><th>For this company</th></tr></thead><tbody>
      ${S.features.filter((f) => !f.archived).map((f) => `<tr><td>${esc(f.name)} <code>${esc(f.key)}</code></td><td>${tag(f.key)}</td>
        <td><select name="ov_${esc(f.key)}" aria-label="${esc(f.name)} for this company">${[["none", "Default"], ["add", "Add"], ["remove", "Remove"]].map(([v, l]) => `<option value="${v}" ${modeOf(f.key) === v ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div>`, "Save", { wide: true });
  if (!fd) return;
  const items = [];
  const inds = fd.getAll("ind");
  if (JSON.stringify([...inds].sort()) !== JSON.stringify([...(t.industryIds || [])].sort()))
    items.push({ type: "tenant", path: `tenants/${id}`, data: { industryIds: inds }, before: { industryIds: t.industryIds || [] }, action: "set-industries", plain: true });
  for (const f of S.features) {
    const want = fd.get(`ov_${f.key}`), now = modeOf(f.key);
    if (want && want !== now) {
      const before = ov.find((o) => o.featureId === f.key) || null;
      items.push({ type: "tenantOverride", path: `tenantFeatureOverrides/${id}_${f.key}`, data: { tenantId: id, featureId: f.key, mode: want, reason: "Set in superadmin" }, before, action: `override-${want}` });
    }
  }
  if (!items.length) return toast("No changes.");
  await run(() => save(items), "Company saved");
}

/* Leads */
function filteredLeads() {
  const { lInd = "", lFeat = "", lStatus = "" } = S.filter;
  return S.leads.filter((l) => (!lInd || (l.industryIds || []).includes(lInd)) && (!lFeat || (l.featureInterests || []).includes(lFeat)) && (!lStatus || l.status === lStatus));
}
function leads() {
  const F = fbk(), list = filteredLeads();
  const sel = (name, opts, val, all) => `<select data-filter="${name}" aria-label="${all}"><option value="">${all}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return `<div class="sa-head"><h1>Leads and demand</h1><div class="sa-tools">
      ${sel("lInd", [...S.industries.map((i) => [i.slug, i.name]), ["core", "HR, payroll and finance only"], ["other", "Other"]], S.filter.lInd, "All industries")}
      ${sel("lFeat", S.features.map((f) => [f.key, f.name]), S.filter.lFeat, "All features")}
      ${sel("lStatus", LEAD_STATUSES.map((s) => [s, LEAD_LABEL[s]]), S.filter.lStatus, "All statuses")}
      <button type="button" class="sa-btn" data-csv>Export CSV</button></div></div>
    <p class="sa-muted">${list.length} lead${list.length === 1 ? "" : "s"}.</p>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Received</th><th>Business</th><th>Contact</th><th>Industries</th><th>Features wanted</th><th>Size</th><th>Notes</th><th>Status</th></tr></thead><tbody>
    ${list.map((l) => `<tr><td>${esc(fmtTime(l.createdAt))}</td><td><b>${esc(l.businessName)}</b></td>
      <td>${esc(l.contactName)}<br><a href="https://wa.me/${esc(String(l.phone || "").replace(/\D/g, "").replace(/^0/, "60"))}" target="_blank" rel="noopener">${esc(l.phone)}</a>${l.email ? `<br><a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}</td>
      <td>${(l.industryIds || []).map((s) => `<span class="sa-chip">${esc(indBySlug(s)?.name || (s === "core" ? "HR, payroll, finance" : s))}</span>`).join(" ")}${l.otherIndustry ? `<br><em>${esc(l.otherIndustry)}</em>` : ""}</td>
      <td>${(l.featureInterests || []).map((k) => esc(F[k]?.name || k)).join(", ")}</td><td>${esc(l.teamSize)}</td><td class="sa-notes">${esc(l.notes)}</td>
      <td><select data-lead="${esc(l.id)}" aria-label="Status for ${esc(l.businessName)}">${LEAD_STATUSES.map((s) => `<option value="${s}" ${s === (l.status || "new") ? "selected" : ""}>${LEAD_LABEL[s]}</option>`).join("")}</select></td></tr>`).join("") || '<tr><td colspan="8" class="sa-muted">No leads match.</td></tr>'}
    </tbody></table></div>`;
}
function exportCsv() {
  const F = fbk();
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Received", "Business", "Contact", "Phone", "Email", "Industries", "Other industry", "Features", "Team size", "Notes", "Status"]]
    .concat(filteredLeads().map((l) => [fmtTime(l.createdAt), l.businessName, l.contactName, l.phone, l.email, (l.industryIds || []).map((s) => indBySlug(s)?.name || s).join("; "),
      l.otherIndustry, (l.featureInterests || []).map((k) => F[k]?.name || k).join("; "), l.teamSize, l.notes, LEAD_LABEL[l.status] || l.status]));
  const blob = new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `allurus-leads-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

/* Finder scoring */
function finder() {
  const inds = S.industries.filter((i) => !i.archived);
  const qs = [...new Set(S.rules.map((r) => r.questionId))].map((id) => S.rules.filter((r) => r.questionId === id).sort((a, b) => (a.optionOrder ?? 0) - (b.optionOrder ?? 0)))
    .sort((a, b) => (a[0].questionOrder ?? 0) - (b[0].questionOrder ?? 0));
  return `<h1>Finder rules</h1><p class="sa-muted">Points each answer gives each industry. Highest total is the match; second highest is "You might also need". The reason shows on the result when that answer helped.</p>
    ${qs.map((rs) => `<form class="sa-card sa-finder" data-finder-q="${esc(rs[0].questionId)}"><h2>${esc(rs[0].questionText)}</h2>
      <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Answer</th><th>Reason shown</th>${inds.map((i) => `<th title="${esc(i.name)}"><span class="sa-vert">${esc(i.name)}</span></th>`).join("")}</tr></thead><tbody>
      ${rs.map((r) => `<tr><td>${esc(r.optionText)}</td><td><input name="reason_${esc(r.id)}" value="${esc(r.reason)}" aria-label="Reason for ${esc(r.optionText)}"></td>
        ${inds.map((i) => `<td><input class="sa-num" type="number" min="0" max="20" name="p_${esc(r.id)}_${esc(i.slug)}" value="${esc(r.points?.[i.slug] || 0)}" aria-label="${esc(i.name)} points for ${esc(r.optionText)}"></td>`).join("")}</tr>`).join("")}
      </tbody></table></div><button type="submit" class="sa-btn primary">Save this question</button></form>`).join("") || '<p class="sa-muted">No finder rules yet. Run npm run seed.</p>'}`;
}
async function saveFinder(form) {
  const qid = form.dataset.finderQ, fd = new FormData(form), inds = S.industries.filter((i) => !i.archived);
  const items = [];
  for (const r of S.rules.filter((x) => x.questionId === qid)) {
    const points = { ...(r.points || {}) };
    for (const i of inds) { const n = Number(fd.get(`p_${r.id}_${i.slug}`)) || 0; if (n) points[i.slug] = n; else delete points[i.slug]; }
    const reason = (fd.get(`reason_${r.id}`) || "").trim();
    if (JSON.stringify(points) !== JSON.stringify(r.points || {}) || reason !== (r.reason || ""))
      items.push({ type: "finderRule", path: `finderRules/${r.id}`, data: { points, reason }, before: { points: r.points, reason: r.reason }, action: "update" });
  }
  if (!items.length) return toast("No changes.");
  await run(() => save(items), "Finder rules saved");
}

/* Audit log */
function audit() {
  const diff = (a, b) => {
    if (!a) return "created";
    const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => !["updatedAt", "createdAt", "lastAuditId", "createdBy"].includes(k) && JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]) && k in (b || {}));
    return keys.map((k) => `<b>${esc(k)}</b>: ${esc(JSON.stringify(a?.[k]) ?? "–").slice(0, 80)} → ${esc(JSON.stringify(b?.[k])).slice(0, 80)}`).join("<br>") || "no visible change";
  };
  return `<h1>Audit log</h1><p class="sa-muted">The latest 200 changes. Entries can't be edited or deleted.</p>
    <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Change</th></tr></thead><tbody>
    ${S.audit.map((a) => `<tr><td>${esc(fmtTime(a.createdAt))}</td><td>${esc(a.actorEmail || a.actorUid)}</td><td>${esc(a.action)}</td><td>${esc(a.entityType)}<br><code>${esc(a.entityId)}</code></td><td class="sa-diff">${diff(a.before, a.after)}</td></tr>`).join("") || '<tr><td colspan="5" class="sa-muted">Nothing yet.</td></tr>'}
    </tbody></table></div>`;
}

/* ---------- events ---------- */
nav.addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) { S.view = b.dataset.view; history.replaceState(null, "", `#${S.view}`); render(); main.focus(); } });
main.addEventListener("click", async (e) => {
  const el = e.target.closest("button"); if (!el) return;
  const d = el.dataset;
  if (d.promote) { const i = indBySlug(d.promote); await run(() => save([{ type: "industry", path: `industries/${i.slug}`, data: { slug: i.slug, status: "beta" }, before: { status: i.status }, action: "promote-beta" }]), `${i.name} is now Beta on the public site`); }
  else if ("newInd" in d) editIndustry(null);
  else if (d.editInd) editIndustry(d.editInd);
  else if (d.archiveInd) { const i = indBySlug(d.archiveInd); await run(() => save([{ type: "industry", path: `industries/${i.slug}`, data: { slug: i.slug, archived: !i.archived, visible: i.archived ? i.visible : false }, before: { archived: !!i.archived, visible: i.visible }, action: i.archived ? "restore" : "archive" }]), i.archived ? "Restored" : "Archived (hidden from the public site)"); }
  else if (d.move) {
    const n = S.industries.findIndex((i) => i.slug === d.move), m = n + Number(d.dir), a = S.industries[n], b = S.industries[m];
    if (!b) return;
    const oa = a.order ?? n + 1, ob = b.order ?? m + 1;
    await run(() => save([{ type: "industry", path: `industries/${a.slug}`, data: { slug: a.slug, order: oa === ob ? ob + Number(d.dir) : ob }, before: { order: a.order }, action: "reorder" },
      { type: "industry", path: `industries/${b.slug}`, data: { slug: b.slug, order: oa }, before: { order: b.order }, action: "reorder" }]));
  }
  else if ("newFeat" in d) editFeature(null);
  else if (d.editFeat) editFeature(d.editFeat);
  else if (d.archiveFeat) { const f = S.features.find((x) => x.key === d.archiveFeat); await run(() => save([{ type: "feature", path: `features/${f.key}`, data: { key: f.key, archived: !f.archived }, before: { archived: !!f.archived }, action: f.archived ? "restore" : "archive" }]), f.archived ? "Restored" : "Archived"); }
  else if (d.cell) { const [s, k] = d.cell.split("|"); cellOptions(s, k); }
  else if (d.linkAll) linkToAll(d.linkAll);
  else if ("copyLinks" in d) copyLinks();
  else if (d.tenant) openTenant(d.tenant);
  else if ("newTenant" in d) newTenant();
  else if (d.retryInvite) { el.disabled = true; await retryInvite(d.retryInvite); }
  else if (d.billing) billingActions(d.billing);
  else if (d.exportCo) { el.disabled = true; await exportCompany(d.exportCo); el.disabled = false; }
  else if ("plan" in d) editPlan(d.plan);
  else if (d.proof) {
    const p = S.payments.find((x) => x.id === d.proof);
    const w = window.open("", "_blank"); if (!w) return toast("Allow pop-ups to view the proof.", true);
    w.opener = null;
    w.document.title = p.proofName || "Proof";
    w.document.body.innerHTML = String(p.proof || "").startsWith("data:application/pdf") ? `<embed src="${esc(p.proof)}" type="application/pdf" style="width:100%;height:100vh">` : `<img src="${esc(p.proof)}" style="max-width:100%">`;
  }
  else if (d.approve) {
    const p = S.payments.find((x) => x.id === d.approve), t = S.tenants.find((x) => x.id === p.tenantId);
    const fd = await ask("Mark as paid", `<p>${esc(t?.name || p.tenantId)} · <code>${esc(p.reference)}</code> · RM ${Number(p.amountMyr || 0).toFixed(2)} for ${p.months} month${p.months > 1 ? "s" : ""} of ${esc(p.planId)}.</p>
      <label class="sa-f"><span>Note <em>(audit log)</em></span><input name="reason" required maxlength="200" value="Bank transfer checked"></label>`, "Mark as paid");
    if (!fd || !t) return;
    await run(() => save(markPaidItems(t, p.planId, p.months, Number(p.amountMyr) || 0, String(fd.get("reason")), p.id)), `${t.name} is active until ${myDay(B.extendPaid(t, p.months))}`);
  }
  else if (d.reject) {
    const p = S.payments.find((x) => x.id === d.reject);
    const fd = await ask("Reject payment", '<label class="sa-f"><span>Reason <em>(shown to the company)</em></span><input name="note" required maxlength="200"></label>', "Reject");
    if (!fd) return;
    await run(() => save([{ type: "payment", path: `payments/${p.id}`, data: { status: "rejected", note: String(fd.get("note")).slice(0, 200), reviewedBy: S.user.email || "", reviewedAt: serverTimestamp() }, before: { status: p.status }, action: "reject-payment", plain: true }]), "Payment rejected");
  }
  else if (d.viewCo) {
    // Viewing a company's data is recorded before it opens (who, which company, when).
    const t = S.tenants.find((x) => x.id === d.viewCo);
    try { await FS.addDoc(collection(db, "auditLog"), { actorUid: S.user.uid, actorEmail: S.user.email || "", action: "view-company", entityType: "tenant", entityId: d.viewCo, before: null, after: { name: t?.name || "" }, createdAt: serverTimestamp() }); }
    catch (e) { toast("Couldn’t record the audit entry, so the company wasn’t opened.", true); return; }
    window.open(`/app?view=${encodeURIComponent(d.viewCo)}`, "_blank", "noopener");
  }
  else if ("csv" in d) exportCsv();
});
main.addEventListener("change", async (e) => {
  const el = e.target, d = el.dataset;
  if (d.link) { const [s, k] = d.link.split("|"); toggleLink(s, k, el.checked); }
  else if (d.indStatus) { const i = indBySlug(d.indStatus); await run(() => save([{ type: "industry", path: `industries/${i.slug}`, data: { slug: i.slug, status: el.value }, before: { status: i.status }, action: "status" }]), `${i.name}: ${el.value}`); }
  else if (d.indVisible) { const i = indBySlug(d.indVisible); await run(() => save([{ type: "industry", path: `industries/${i.slug}`, data: { slug: i.slug, visible: el.checked }, before: { visible: i.visible }, action: el.checked ? "show" : "hide" }]), el.checked ? "Shown on the public site" : "Hidden from the public site"); }
  else if (d.lead) { const l = S.leads.find((x) => x.id === d.lead); await run(() => save([{ type: "lead", path: `leads/${l.id}`, data: { status: el.value }, before: { status: l.status }, action: "lead-status", plain: true }]), `Lead: ${LEAD_LABEL[el.value]}`); }
  else if (d.filter && el.tagName === "SELECT") { S.filter[d.filter] = el.value; render(); }
});
main.addEventListener("input", (e) => { const d = e.target.dataset; if (d.filter === "matrix") { S.filter.matrix = e.target.value; const pos = e.target.selectionStart; render(); const f = main.querySelector('[data-filter="matrix"]'); f.focus(); f.setSelectionRange(pos, pos); } });
main.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-finder-q]"); if (f) { e.preventDefault(); saveFinder(f); return; }
  if (e.target.id === "billcfg") { e.preventDefault(); saveBillingCfg(e.target); }
});

/* ---------- sign-in ---------- */
function signInView(msg = "") {
  nav.hidden = true; $("#saMe").innerHTML = "";
  main.innerHTML = `<form class="sa-signin sa-card"><h1>Superadmin</h1><p class="sa-muted">Sign in with your Allurus account.</p>
    <label class="sa-f"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
    <label class="sa-f"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
    ${msg ? `<p class="sa-warn" role="alert">${esc(msg)}</p>` : ""}<button type="submit" class="sa-btn primary">Sign in</button></form>`;
  main.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await signInWithEmailAndPassword(auth, fd.get("email").trim(), fd.get("password")); }
    catch (err) { signInView(err.code === "auth/invalid-credential" ? "Wrong email or password." : err.message); }
  };
}
onAuthStateChanged(auth, async (user) => {
  if (!user) return signInView();
  const token = await user.getIdTokenResult(true);
  $("#saMe").innerHTML = `<span>${esc(user.email)}</span> <button type="button" class="sa-btn ghost" id="saOut">Sign out</button>`;
  $("#saOut").onclick = () => signOut(auth);
  if (token.claims.role !== "superadmin") {
    nav.hidden = true;
    main.innerHTML = `<div class="sa-card sa-signin"><h1>No access</h1><p>${esc(user.email)} isn't a superadmin. Ask the owner to run <code>node scripts/set-superadmin.js ${esc(user.email)}</code>, then sign out and in again.</p></div>`;
    return;
  }
  S.user = user;
  const want = location.hash.slice(1); if (VIEWS.some(([id]) => id === want)) S.view = want;
  main.innerHTML = '<p class="sa-muted">Loading…</p>';
  try { await load(); render(); } catch (e) { console.error(e); main.innerHTML = `<p class="sa-warn">Couldn't load: ${esc(e.message)}. Are the Firestore rules deployed?</p>`; }
});
