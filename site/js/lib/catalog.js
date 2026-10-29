/* Industry and feature catalogue logic, shared by the public industries page, /superadmin, the app and the tests.
   Pure functions only: no Firestore, no DOM.

   Data shapes (Firestore documents, ids in brackets):
     features[key]            { key, name, description, moduleKey, status, dependsOn: [key], archived }
     industries[slug]         { slug, name, tagline, status, visible, order, archived, ... }
     industryFeatures[slug_key] { industryId: slug, featureId: key, linked, showPublic, isHeadline, customLabel, order }
     tenantFeatureOverrides[tenant_key] { tenantId, featureId: key, mode: "add" | "remove" | "none" }
   Unlinking and archiving are soft (linked: false, archived: true) so every change keeps its audit trail. */

export const STATUS_ORDER = { live: 0, beta: 1, planned: 2 };

/** Links that are currently on. */
export const activeLinks = (links) => links.filter((l) => l.linked !== false);

/** Features linked to one industry, in display order, with the industry's custom label applied. */
export function industryFeatures(slug, links, featuresByKey, { publicOnly = false } = {}) {
  return activeLinks(links)
    .filter((l) => l.industryId === slug && (!publicOnly || l.showPublic !== false))
    .map((l) => ({ link: l, feature: featuresByKey[l.featureId] }))
    .filter((x) => x.feature && !x.feature.archived && !(publicOnly && x.feature.key.startsWith("area.")))
    .sort((a, b) => (a.link.order ?? 99) - (b.link.order ?? 99) || a.feature.name.localeCompare(b.feature.name))
    .map(({ link, feature }) => ({ ...feature, label: link.customLabel || feature.name, isHeadline: !!link.isHeadline, link }));
}

/** Add every feature that the given features depend on, transitively. */
export function expandDependencies(keys, featuresByKey) {
  const out = new Set(keys), queue = [...keys];
  while (queue.length) {
    const k = queue.pop();
    for (const d of featuresByKey[k]?.dependsOn || []) if (!out.has(d)) { out.add(d); queue.push(d); }
  }
  return out;
}

/** Dependencies of `key` (transitive) that are not yet linked to `slug`. Drives the "Link them too?" warning. */
export function missingDependencies(key, slug, links, featuresByKey) {
  const linked = new Set(activeLinks(links).filter((l) => l.industryId === slug).map((l) => l.featureId));
  return [...expandDependencies([key], featuresByKey)].filter((k) => k !== key && !linked.has(k));
}

/**
 * Effective features for a company:
 *   (features linked to its industries) + (its "add" overrides) − (its "remove" overrides), then dependencies.
 * Returns { keys: Set, source: { [key]: "industry" | "extra" | "dependency" }, removed: Set }.
 * A removed feature stays removed even if another feature depends on it (the superadmin chose that explicitly).
 */
export function effectiveFeatures({ industryIds = [], links = [], overrides = [], featuresByKey = {} }) {
  const source = {};
  for (const l of activeLinks(links)) if (industryIds.includes(l.industryId) && featuresByKey[l.featureId] && !featuresByKey[l.featureId].archived) source[l.featureId] = "industry";
  const removed = new Set();
  for (const o of overrides) {
    if (o.mode === "add" && featuresByKey[o.featureId]) source[o.featureId] = source[o.featureId] || "extra";
    if (o.mode === "remove") removed.add(o.featureId);
  }
  for (const k of removed) delete source[k];
  for (const k of expandDependencies(Object.keys(source), featuresByKey)) {
    if (!source[k] && !removed.has(k) && featuresByKey[k] && !featuresByKey[k].archived) source[k] = "dependency";
  }
  return { keys: new Set(Object.keys(source)), source, removed };
}

/** Whether an app area (people, time, payroll, claims, finance, talent, operations) is on for a company.
    Companies without industries keep every area: the feature system only applies once an industry is set. */
export function areaAllowed(area, effective, hasIndustries) {
  if (!hasIndustries || area === "settings") return true;
  return effective.keys.has(`area.${area}`);
}

/** "Which one is me?" scoring. answers: { [questionId]: optionId }. rules: finderRules documents.
    Returns industries ranked by points, each with the reasons (answer texts) that gave it points. */
export function scoreFinder(answers, rules, industries) {
  const total = {}, reasons = {};
  for (const r of rules) {
    if (answers[r.questionId] !== r.optionId) continue;
    for (const [slug, pts] of Object.entries(r.points || {})) {
      if (!pts) continue;
      total[slug] = (total[slug] || 0) + pts;
      if (r.reason) (reasons[slug] = reasons[slug] || []).push({ text: r.reason, pts });
    }
  }
  return industries
    .filter((i) => total[i.slug])
    .map((i) => ({ industry: i, points: total[i.slug], reasons: (reasons[i.slug] || []).sort((a, b) => b.pts - a.pts).map((x) => x.text) }))
    .sort((a, b) => b.points - a.points || (a.industry.order ?? 99) - (b.industry.order ?? 99));
}

/** Compare table: rows = features shown publicly on at least one industry, columns = industries. */
export function compareMatrix(industries, links, featuresByKey) {
  const cols = industries.map((i) => ({ industry: i, keys: new Set(industryFeatures(i.slug, links, featuresByKey, { publicOnly: true }).map((f) => f.key)) }));
  const rowKeys = new Set(cols.flatMap((c) => [...c.keys]));
  const rows = [...rowKeys].map((k) => featuresByKey[k]).sort((a, b) => (a.moduleKey || "").localeCompare(b.moduleKey || "") || a.name.localeCompare(b.name));
  return { cols, rows };
}

/** Group a feature list by module, in module order. */
export function byModule(features, modules) {
  const order = Object.fromEntries((modules || []).map((m) => [m.key, m.order ?? 99]));
  const groups = {};
  for (const f of features) (groups[f.moduleKey || "other"] = groups[f.moduleKey || "other"] || []).push(f);
  return Object.entries(groups).sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99)).map(([moduleKey, items]) => ({ moduleKey, items }));
}
