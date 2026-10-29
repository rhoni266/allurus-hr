/* Catalogue data for the public site, read from Firestore with plain REST calls (no Firebase SDK on the landing
   page). If Firestore has no industries yet (before `npm run seed`) or can't be reached, the bundled starter data in
   /seed/*.json is used instead, so the page always has content. Superadmin edits show on the next page load. */
import { ENQUIRY } from "../config/site.js";

const BASE = `https://firestore.googleapis.com/v1/projects/${ENQUIRY.projectId}/databases/(default)/documents`;
const KEY = `key=${ENQUIRY.apiKey}`;

/** Firestore REST value -> plain JS. */
export function decode(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  return null;
}
/** Plain JS -> Firestore REST value (for creating leads). */
export function encode(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (x instanceof Date) return { timestampValue: x.toISOString() };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(encode) } };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, encode(v)])) } };
  return { stringValue: String(x) };
}
const fromDoc = (d) => ({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decode(v)])) });

async function list(col) {
  const out = [];
  let token = "";
  do {
    const r = await fetch(`${BASE}/${col}?pageSize=300&${KEY}${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    if (!r.ok) throw new Error(`${col}: ${r.status}`);
    const j = await r.json();
    out.push(...(j.documents || []).map(fromDoc));
    token = j.nextPageToken || "";
  } while (token);
  return out;
}
async function visibleIndustries() {
  const r = await fetch(`${BASE}:runQuery?${KEY}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "industries" }], where: { fieldFilter: { field: { fieldPath: "visible" }, op: "EQUAL", value: { booleanValue: true } } } } }) });
  if (!r.ok) throw new Error(`industries: ${r.status}`);
  return (await r.json()).filter((x) => x.document).map((x) => fromDoc(x.document));
}

async function fromSeed() {
  const [F, I, R] = await Promise.all(["features", "industries", "finderRules"].map((n) => fetch(`/seed/${n}.json`).then((r) => r.json())));
  const areaKeys = F.features.filter((f) => f.key.startsWith("area.")).map((f) => f.key);
  return {
    source: "seed",
    modules: F.modules,
    features: F.features.map((f) => ({ ...f, dependsOn: f.dependsOn || [], archived: false })),
    industries: I.industries.map(({ features, ...i }) => ({ ...i, archived: false })),
    links: I.industries.flatMap((i) => [
      ...i.features.map((f, n) => ({ industryId: i.slug, featureId: f.key, linked: true, showPublic: true, isHeadline: !!f.headline, customLabel: f.label || "", order: n })),
      ...areaKeys.map((k) => ({ industryId: i.slug, featureId: k, linked: true, showPublic: false, order: 90 })),
    ]),
    rules: R.questions.flatMap((q) => q.options.map((o, n) => ({ questionId: q.id, questionText: q.text, questionOrder: q.order, optionId: o.id, optionText: o.text, optionOrder: n, reason: o.reason, points: o.points }))),
  };
}

let cache = null;
/** { source: "firestore" | "seed", modules, features, industries (visible, not archived, ordered), links, rules } */
export function loadCatalog() {
  if (cache) return cache;
  cache = (async () => {
    let data;
    try {
      const [modules, features, industries, links, rules] = await Promise.all([list("modules"), list("features"), visibleIndustries(), list("industryFeatures"), list("finderRules")]);
      data = industries.length ? { source: "firestore", modules, features, industries, links, rules } : await fromSeed();
    } catch (e) {
      console.warn("[allurus] catalogue from Firestore failed, using the bundled starter data", e);
      data = await fromSeed();
    }
    data.industries = data.industries.filter((i) => !i.archived && i.visible !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    data.featuresByKey = Object.fromEntries(data.features.map((f) => [f.key, f]));
    data.questions = [...new Set(data.rules.map((r) => r.questionId))]
      .map((id) => { const rs = data.rules.filter((r) => r.questionId === id).sort((a, b) => (a.optionOrder ?? 0) - (b.optionOrder ?? 0));
        return { id, text: rs[0]?.questionText || id, order: rs[0]?.questionOrder ?? 0, options: rs.map((r) => ({ id: r.optionId, text: r.optionText || r.optionId })) }; })
      .sort((a, b) => a.order - b.order);
    return data;
  })();
  return cache;
}

/** Save a "Tell us you need this" lead. Throws if Firestore refuses (the caller offers WhatsApp/email instead). */
export async function createLead(lead) {
  const r = await fetch(`${BASE}/leads?${KEY}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(lead).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, encode(v)])) }) });
  if (!r.ok) throw new Error(`Lead not saved (${r.status})`);
}
