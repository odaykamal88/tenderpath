import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "./schema";

const DEFAULT_EXTERNAL_DISCOVERY_LIMIT = 8;
const MAX_EXTERNAL_DISCOVERY_LIMIT = 12;

type TenderExternalDiscoveryRow = {
  id: number;
  title: string;
  description: string | null;
  agency: string | null;
  country: string | null;
  sector: string | null;
  opportunity_type: string | null;
  eligibility_summary: string | null;
  required_registrations: string | null;
  requirements: unknown;
};

export type ExternalDiscoveryConfidence = "high" | "medium" | "low";

export type ExternalDiscoveryMode = "web_search" | "queries_only";

export type ExternalDiscoveryProvider = "openai_web_search" | "anthropic_web_search";

export type ProcurementIntent =
  | "buyer_seeks_supplier"
  | "award_notice"
  | "grant_or_donor"
  | "unclear";

/**
 * Structured understanding of WHO a procurement notice is trying to hire.
 *
 * The single most important job of this brief is to separate the *subject
 * matter* of the work (what is being audited / built / supplied) from the
 * *supplier role* the buyer is actually hiring. A notice to audit a renewable
 * energy project hires an AUDIT firm, not an energy company; conflating the two
 * is the failure mode this whole module exists to prevent.
 */
export interface ProcurementBrief {
  intent: ProcurementIntent;
  /** One line: what the buyer is buying. */
  procured_object: string;
  /** The role/archetype of the organization that should WIN this contract. */
  supplier_role: string;
  /** Concrete org archetypes to search for (e.g. "external audit firm", "CPA firm"). */
  supplier_archetypes: string[];
  /** Hard qualifications a winning supplier needs (registration, experience, certs). */
  must_have: string[];
  /** Supplier-side search terms — describe the firm, not the subject matter. */
  target_keywords: string[];
  /** Subject-matter terms that would wrongly attract firms from the served domain. */
  avoid_keywords: string[];
  /** Conflict-of-interest / eligibility limits (who cannot bid). */
  disqualifiers: string[];
  /** Geography expectation in words. */
  geography: string;
  /** Short domain label, e.g. "audit & assurance". */
  domain: string | null;
  notes: string | null;
}

export interface ExternalProspectInput {
  name: string;
  website: string | null;
  country: string | null;
  countries: string[];
  sectors: string[];
  org_type: string | null;
  services_text: string | null;
  score: number;
  confidence: ExternalDiscoveryConfidence;
  fit_reasons: string[];
  evidence_urls: string[];
  source_notes: string | null;
}

export interface ExternalDiscoveryResult {
  mode: ExternalDiscoveryMode;
  providerConfigured: boolean;
  provider: ExternalDiscoveryProvider | null;
  tenderId: number;
  brief: ProcurementBrief | null;
  briefSource: "model" | "heuristic" | null;
  queries: string[];
  inserted: number;
  refreshed: number;
  prospects: ExternalProspectInput[];
  dropped: number;
  error?: string;
}

function clean(value: unknown, max = 1000): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function toStringArray(value: unknown, max = 10, itemMax = 160): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, itemMax);
    if (!text) continue;
    const key = normalized(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string | null | undefined): Set<string> {
  return new Set(normalized(value).split(" ").filter((t) => t.length > 3));
}

function anyTokenOverlap(text: string, phrases: string[]): boolean {
  if (!phrases.length) return false;
  const haystack = tokens(text);
  if (!haystack.size) return false;
  for (const phrase of phrases) {
    const p = normalized(phrase);
    if (p.length >= 4 && text.toLowerCase().includes(p)) return true;
    for (const token of tokens(phrase)) if (haystack.has(token)) return true;
  }
  return false;
}

function hostOf(value: string | null | undefined): string | null {
  const url = cleanUrl(value);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function dedupKeyFor(prospect: Pick<ExternalProspectInput, "name" | "website">): string {
  const host = hostOf(prospect.website);
  if (host) return `site:${host}`;
  return `name:${normalized(prospect.name).slice(0, 120)}`;
}

function cleanUrl(value: string | null | undefined): string | null {
  const raw = clean(value, 700);
  if (!raw) return null;
  try {
    const prefixed = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(prefixed);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function countryMatches(tenderCountry: string | null, prospect: ExternalProspectInput): boolean {
  const country = normalized(tenderCountry);
  if (!country) return true; // no country constraint to fail
  const pool = [prospect.country, ...prospect.countries].map(normalized).filter(Boolean);
  for (const c of pool) {
    if (c === country || c.includes(country) || country.includes(c)) return true;
    if (["global", "worldwide", "regional", "international"].includes(c)) return true;
  }
  return false;
}

function scoreFor(
  prospect: Pick<ExternalProspectInput, "confidence" | "fit_reasons" | "evidence_urls">,
  opts: { countryHit: boolean; avoidPenalty: boolean },
): number {
  const base = prospect.confidence === "high" ? 76 : prospect.confidence === "medium" ? 60 : 44;
  const score = base
    + Math.min(12, prospect.fit_reasons.length * 3)
    + Math.min(9, prospect.evidence_urls.length * 3)
    + (opts.countryHit ? 6 : 0)
    - (opts.avoidPenalty ? 14 : 0);
  return Math.max(20, Math.min(96, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Heuristic fallback brief (no LLM): rule-based supplier-role detection so the
// queries-only mode and the LLM-failure path still steer toward the firm being
// hired rather than the subject matter being served.
// ---------------------------------------------------------------------------

type RoleRule = {
  test: RegExp;
  role: string;
  archetypes: string[];
  domain: string;
  // When true, the hired supplier sits in a DIFFERENT domain than the subject
  // matter (audit / supervision / PMC / evaluation hire oversight firms, not
  // firms from the served sector). For these the tender's own sector/title
  // terms are exactly what we must AVOID surfacing — derived at runtime.
  crossDomain: boolean;
};

// Order matters: ROLE_RULES.find() returns the FIRST match, so oversight /
// cross-domain roles (which often co-occur with the subject-matter verb, e.g.
// "construction supervision", "PMC for hospital construction") are listed
// BEFORE the "doing" roles (construction / supply) they would otherwise be
// swallowed by.
const ROLE_RULES: RoleRule[] = [
  {
    test: /\b(audit|auditor|auditing)\b/i,
    role: "external audit / accounting firm",
    archetypes: ["external audit firm", "chartered/certified public accountants", "assurance & advisory firm"],
    domain: "audit & assurance",
    crossDomain: true,
  },
  {
    test: /\b(supervis\w*|works supervision|construction supervision|site supervision)\b/i,
    role: "construction supervision / engineering consultant",
    archetypes: ["engineering supervision consultancy", "owner's engineer firm", "infrastructure consulting firm"],
    domain: "engineering supervision",
    crossDomain: true,
  },
  {
    test: /\b(project management|programme management|program management|pmc|owner'?s engineer)\b/i,
    role: "project management consultant (PMC)",
    archetypes: ["project management consultancy", "programme management firm", "owner's engineer"],
    domain: "project management",
    crossDomain: true,
  },
  {
    test: /\b(evaluation|baseline|midline|endline|impact assessment|monitoring and evaluation|feasibility study|research study)\b/i,
    role: "research / monitoring & evaluation consultancy",
    archetypes: ["M&E / evaluation firm", "research consultancy", "advisory firm"],
    domain: "research & evaluation",
    crossDomain: true,
  },
  {
    test: /\b(training|capacity[- ]building|workshop|curriculum|coaching)\b/i,
    role: "training / capacity-building provider",
    archetypes: ["training provider", "capacity-building consultancy", "professional development firm"],
    domain: "training",
    crossDomain: false,
  },
  {
    test: /\b(software|web application|mobile app|information system|management information system|mis|it services|digital platform|e-?government|website|web portal|database system)\b/i,
    role: "software / IT services firm",
    archetypes: ["software development firm", "IT systems integrator", "digital agency"],
    domain: "software & IT",
    crossDomain: false,
  },
  {
    test: /\b(design and build|design-build|epc|construction|rehabilitation|civil works|refurbish|drilling|borehole|road works|build)\b/i,
    role: "civil works / construction contractor",
    archetypes: ["civil works contractor", "construction company", "infrastructure EPC firm"],
    domain: "construction",
    crossDomain: false,
  },
  {
    test: /\b(consult\w*|advisory|technical assistance|expert services|strategy)\b/i,
    role: "consulting / advisory firm",
    archetypes: ["management consultancy", "technical advisory firm", "specialist consultants"],
    domain: "consulting",
    crossDomain: false,
  },
  {
    test: /\b(supply|provision|delivery|procurement of|purchase of|furnish|installation of|equipment)\b/i,
    role: "supplier / vendor of the specified goods",
    archetypes: ["manufacturer / distributor", "specialist supplier", "trading & supply company"],
    domain: "goods supply",
    crossDomain: false,
  },
];

const SUBJECT_TERM_STOP = new Set([
  "call", "contract", "country", "delivery", "development", "expression", "financial",
  "interest", "invitation", "procurement", "programme", "program", "project",
  "proposal", "provision", "request", "selection", "service", "services", "supply",
  "support", "system", "technical", "tender",
]);

/**
 * Subject-matter terms to steer AWAY from, for cross-domain roles only. The
 * danger is leaking ROLE-adjacent words (an audit notice's "auditor"/"external")
 * into the avoid list, which would penalize the very firms we want — so every
 * candidate is filtered against role stems (rule role/domain/archetypes + the
 * rule's own regex words) and the tender's country.
 */
function deriveAvoidKeywords(tender: TenderExternalDiscoveryRow, rule: RoleRule | undefined): string[] {
  if (!rule?.crossDomain) return [];

  const roleStems = new Set<string>(tokens([rule.role, rule.domain, ...rule.archetypes].join(" ")));
  for (const word of rule.test.source.toLowerCase().match(/[a-z]{4,}/g) ?? []) roleStems.add(word);
  const countryTokens = tokens(tender.country);
  const isRoleish = (token: string): boolean => {
    if (countryTokens.has(token)) return true;
    for (const stem of roleStems) {
      if (token === stem) return true;
      if (stem.length >= 4 && (token.startsWith(stem) || stem.startsWith(token))) return true;
    }
    return false;
  };

  const candidates: string[] = [];
  // Sector phrases are the cleanest subject-matter signal (e.g. "Renewable Energy").
  for (const part of (tender.sector ?? "").split(/[,/&]|\band\b/i)) {
    const p = clean(part, 60);
    if (p && [...tokens(p)].some((t) => !isRoleish(t))) candidates.push(p);
  }
  // Plus salient nouns from title/description that are neither role nor generic.
  const text = normalized([tender.title, clean(tender.description, 400)].filter(Boolean).join(" "));
  for (const token of text.split(" ")) {
    if (token.length <= 5 || SUBJECT_TERM_STOP.has(token) || isRoleish(token)) continue;
    candidates.push(token);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const phrase of candidates) {
    const key = normalized(phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= 6) break;
  }
  return out;
}

function detectIntent(tender: TenderExternalDiscoveryRow): ProcurementIntent {
  const hay = normalized([tender.title, tender.opportunity_type, clean(tender.description, 300)].filter(Boolean).join(" "));
  if (/\b(contract award|notice of award|award of contract|awarded|results of selection|selection result)\b/.test(hay)) {
    return "award_notice";
  }
  if (/\b(call for proposals|call for applications|request for applications|grant|grants|funding opportunity|funding window)\b/.test(hay)) {
    return "grant_or_donor";
  }
  return "buyer_seeks_supplier";
}

function heuristicBrief(tender: TenderExternalDiscoveryRow): ProcurementBrief {
  const haystack = [tender.title, tender.opportunity_type, tender.description, tender.sector]
    .filter(Boolean)
    .join(" ");
  const rule = ROLE_RULES.find((r) => r.test.test(haystack));
  const country = tender.country?.trim() || "the tender country";
  const sector = tender.sector?.trim();
  const role = rule?.role ?? (sector ? `${sector} supplier or contractor` : "supplier / contractor / consultant");
  const archetypes = rule?.archetypes ?? [sector ? `${sector} firms` : "specialist suppliers"];
  // For non-cross-domain roles, the subject matter IS what we want, so leave it
  // off the avoid list (a vaccine SUPPLY tender wants vaccine suppliers); add a
  // light generic guard against advisory/NGO noise for goods supply only.
  const genericAvoid = rule && !rule.crossDomain && rule.domain === "goods supply"
    ? ["consultancy", "advisory firm", "ngo", "policy institute"]
    : [];

  return {
    intent: detectIntent(tender),
    procured_object: clean(tender.title, 200) ?? "Procurement opportunity",
    supplier_role: role,
    supplier_archetypes: archetypes,
    must_have: [],
    target_keywords: archetypes,
    avoid_keywords: [...deriveAvoidKeywords(tender, rule), ...genericAvoid],
    disqualifiers: [],
    geography: country,
    domain: rule?.domain ?? sector ?? null,
    notes: "Heuristic brief (LLM unavailable) — supplier role inferred from notice text.",
  };
}

// ---------------------------------------------------------------------------
// Query construction — driven by the brief's supplier archetypes, NOT raw
// subject-matter keywords from the title.
// ---------------------------------------------------------------------------

function buildQueriesFromBrief(tender: TenderExternalDiscoveryRow, brief: ProcurementBrief): string[] {
  const country = tender.country?.trim() ?? "";
  const agency = tender.agency?.trim();
  const archetypes = brief.supplier_archetypes.length ? brief.supplier_archetypes : [brief.supplier_role];
  const topMust = brief.must_have.slice(0, 1).join(" ");
  const keywords = brief.target_keywords.slice(0, 4).join(" ");

  const raw = [
    `${archetypes[0]} ${country}`.trim(),
    archetypes[1] ? `${archetypes[1]} ${country} ${topMust}`.trim() : "",
    `${brief.supplier_role} ${country} ${brief.domain ?? ""}`.trim(),
    keywords ? `${keywords} ${country}`.trim() : "",
    agency ? `${archetypes[0]} ${agency} ${brief.domain ?? ""}`.trim() : "",
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    const query = q.replace(/\s+/g, " ").trim();
    if (!query) continue;
    const key = normalized(query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length >= 5) break;
  }
  return out;
}

/** Back-compat heuristic query builder (used when the model is unavailable). */
export function buildExternalProspectQueries(tender: TenderExternalDiscoveryRow): string[] {
  return buildQueriesFromBrief(tender, heuristicBrief(tender));
}

// ---------------------------------------------------------------------------
// Provider clients + selection.
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });
}

function getAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 80_000,
  });
}

// OpenAI is preferred (its web_search_preview returns the richest structured
// output); Anthropic is the fallback so discovery still works on an
// Anthropic-only deployment.
function configuredProvider(): ExternalDiscoveryProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai_web_search";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic_web_search";
  return null;
}

function openAiBriefModel(): string {
  return (
    process.env.OPENAI_DISCOVERY_BRIEF_MODEL?.trim()
    || process.env.OPENAI_WEB_SEARCH_MODEL?.trim()
    || "gpt-4.1-mini"
  );
}

function anthropicModel(): string {
  return (
    process.env.ANTHROPIC_WEB_SEARCH_MODEL?.trim()
    || process.env.ANTHROPIC_MODEL?.trim()
    || "claude-haiku-4-5-20251001"
  );
}

function jsonCandidate(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function anthropicTextOf(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Stage 1 — procurement brief (no web): determine WHO the buyer is hiring.
// ---------------------------------------------------------------------------

const BRIEF_INSTRUCTIONS =
  "You are TenderPath's procurement analyst. Read ONE procurement notice and determine exactly which organization the buyer is trying to HIRE — the supplier, contractor, consultant, or firm that would WIN this contract.\n\n"
  + "CRITICAL: separate the SUBJECT MATTER of the work from the SUPPLIER being hired. A notice can be *about* one domain but *hire* a completely different kind of firm:\n"
  + "- 'External audit of a renewable-energy project' hires an AUDIT/accounting firm — NOT an energy company.\n"
  + "- 'Construction supervision consultant for a road' hires an ENGINEERING SUPERVISION consultant — NOT a road-building contractor.\n"
  + "- 'Supply and delivery of vaccines' hires a medical/pharma SUPPLIER — NOT a health-policy NGO.\n"
  + "- 'Project management consultant for a hospital' hires a PMC firm — NOT a hospital operator.\n\n"
  + "Fill the brief so it describes the firm to FIND and contact:\n"
  + "- supplier_role and supplier_archetypes: the kind of organization that should win and be contacted.\n"
  + "- target_keywords: supplier-side search terms (describe the FIRM, e.g. 'external audit firm', 'CPA').\n"
  + "- avoid_keywords: subject-matter terms that would wrongly surface firms from the domain being served/audited/built instead of the firm being hired (e.g. for an energy-project audit: 'solar', 'EPC', 'power plant').\n"
  + "- must_have: hard qualifications a winner needs (registrations, certifications, years of experience, donor experience).\n"
  + "- disqualifiers: conflict-of-interest and eligibility limits — e.g. the implementing agency or the entity being audited cannot bid.\n"
  + "- intent: 'buyer_seeks_supplier' for an open call to suppliers; 'award_notice' if a winner is already announced; 'grant_or_donor' if it solicits grantees/funding applicants rather than vendors; 'unclear' otherwise.\n"
  + "Be specific and concise. Do not invent facts not supported by the notice.";

const BRIEF_JSON_HINT =
  '{"intent":"buyer_seeks_supplier","procured_object":"","supplier_role":"","supplier_archetypes":[],"must_have":[],"target_keywords":[],"avoid_keywords":[],"disqualifiers":[],"geography":"","domain":"","notes":""}';

function briefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: { type: "string", enum: ["buyer_seeks_supplier", "award_notice", "grant_or_donor", "unclear"] },
      procured_object: { type: "string" },
      supplier_role: { type: "string" },
      supplier_archetypes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      must_have: { type: "array", items: { type: "string" }, maxItems: 8 },
      target_keywords: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
      avoid_keywords: { type: "array", items: { type: "string" }, maxItems: 10 },
      disqualifiers: { type: "array", items: { type: "string" }, maxItems: 6 },
      geography: { type: "string" },
      domain: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
    },
    required: [
      "intent", "procured_object", "supplier_role", "supplier_archetypes",
      "must_have", "target_keywords", "avoid_keywords", "disqualifiers",
      "geography", "domain", "notes",
    ],
  };
}

function tenderFacts(tender: TenderExternalDiscoveryRow): string {
  const requirements = typeof tender.requirements === "string"
    ? tender.requirements
    : tender.requirements
      ? JSON.stringify(tender.requirements)
      : null;
  return [
    `Title: ${tender.title}`,
    `Buyer/agency: ${tender.agency ?? "unknown"}`,
    `Country: ${tender.country ?? "unknown"}`,
    `Sector (as tagged): ${tender.sector ?? "unknown"}`,
    `Notice type: ${tender.opportunity_type ?? "unknown"}`,
    tender.description ? `Description: ${clean(tender.description, 2200)}` : null,
    tender.eligibility_summary ? `Eligibility: ${clean(tender.eligibility_summary, 600)}` : null,
    tender.required_registrations ? `Required registrations: ${clean(tender.required_registrations, 400)}` : null,
    requirements ? `Requirements: ${clean(requirements, 600)}` : null,
  ].filter(Boolean).join("\n");
}

function parseBrief(raw: string, tender: TenderExternalDiscoveryRow): ProcurementBrief | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const supplierRole = clean(row.supplier_role, 240);
  const archetypes = toStringArray(row.supplier_archetypes, 6, 120);
  if (!supplierRole && !archetypes.length) return null;

  const intentRaw = clean(row.intent, 40);
  const intent: ProcurementIntent =
    intentRaw === "award_notice" || intentRaw === "grant_or_donor" || intentRaw === "unclear"
      ? intentRaw
      : "buyer_seeks_supplier";

  return {
    intent,
    procured_object: clean(row.procured_object, 260) ?? (clean(tender.title, 200) ?? "Procurement opportunity"),
    supplier_role: supplierRole ?? archetypes[0],
    supplier_archetypes: archetypes.length ? archetypes : [supplierRole ?? "specialist supplier"],
    must_have: toStringArray(row.must_have, 8, 160),
    target_keywords: toStringArray(row.target_keywords, 10, 80),
    avoid_keywords: toStringArray(row.avoid_keywords, 10, 80),
    disqualifiers: toStringArray(row.disqualifiers, 6, 200),
    geography: clean(row.geography, 200) ?? (tender.country ?? "unspecified"),
    domain: clean(row.domain, 80),
    notes: clean(row.notes, 400),
  };
}

async function buildBriefWithOpenAI(tender: TenderExternalDiscoveryRow): Promise<ProcurementBrief | null> {
  const response = await getOpenAIClient().responses.create({
    model: openAiBriefModel(),
    input: tenderFacts(tender),
    instructions: BRIEF_INSTRUCTIONS,
    text: {
      format: { type: "json_schema", name: "procurement_brief", schema: briefSchema(), strict: true },
      verbosity: "low",
    },
    temperature: 0.1,
    max_output_tokens: 1200,
    store: false,
  });
  return parseBrief(response.output_text ?? "", tender);
}

async function buildBriefWithAnthropic(tender: TenderExternalDiscoveryRow): Promise<ProcurementBrief | null> {
  const response = await getAnthropicClient().messages.create({
    model: anthropicModel(),
    max_tokens: 1200,
    system: `${BRIEF_INSTRUCTIONS} Output parseable JSON only — no markdown.`,
    messages: [{
      role: "user",
      content: `${tenderFacts(tender)}\n\nReturn JSON ONLY with this exact shape:\n${BRIEF_JSON_HINT}`,
    }],
  });
  return parseBrief(jsonCandidate(anthropicTextOf(response.content)), tender);
}

async function buildProcurementBrief(
  tender: TenderExternalDiscoveryRow,
  provider: ExternalDiscoveryProvider,
): Promise<{ brief: ProcurementBrief; source: "model" | "heuristic" }> {
  try {
    const brief = provider === "openai_web_search"
      ? await buildBriefWithOpenAI(tender)
      : await buildBriefWithAnthropic(tender);
    if (brief) return { brief, source: "model" };
    console.warn("[network:external-discovery:brief_malformed]", { tenderId: tender.id, provider });
  } catch (err) {
    console.error("[network:external-discovery:brief_failed]", { tenderId: tender.id, provider, err });
  }
  return { brief: heuristicBrief(tender), source: "heuristic" };
}

// ---------------------------------------------------------------------------
// Stage 2 — brief-driven web search (OpenAI or Anthropic) with a role-fit gate.
// ---------------------------------------------------------------------------

function prospectSchema(limit: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      prospects: {
        type: "array",
        maxItems: limit,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            website: { type: ["string", "null"] },
            country: { type: ["string", "null"] },
            countries: { type: "array", items: { type: "string" }, maxItems: 6 },
            sectors: { type: "array", items: { type: "string" }, maxItems: 8 },
            org_type: { type: ["string", "null"] },
            services_text: { type: ["string", "null"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            role_fit: { type: "boolean" },
            role_fit_reason: { type: "string" },
            fit_reasons: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
            evidence_urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
            source_notes: { type: ["string", "null"] },
          },
          required: [
            "name", "website", "country", "countries", "sectors", "org_type",
            "services_text", "confidence", "role_fit", "role_fit_reason",
            "fit_reasons", "evidence_urls", "source_notes",
          ],
        },
      },
    },
    required: ["prospects"],
  };
}

// Anthropic's structured-output json_schema support is stricter about types
// (no nullable unions / enums), so this is a relaxed mirror of prospectSchema;
// parseProspects tolerates the loosened shape.
function anthropicProspectSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      prospects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            website: { type: "string" },
            country: { type: "string" },
            countries: { type: "array", items: { type: "string" } },
            sectors: { type: "array", items: { type: "string" } },
            org_type: { type: "string" },
            services_text: { type: "string" },
            confidence: { type: "string" },
            role_fit: { type: "boolean" },
            role_fit_reason: { type: "string" },
            fit_reasons: { type: "array", items: { type: "string" } },
            evidence_urls: { type: "array", items: { type: "string" } },
            source_notes: { type: "string" },
          },
          required: [
            "name", "website", "country", "countries", "sectors", "org_type",
            "services_text", "confidence", "role_fit", "role_fit_reason",
            "fit_reasons", "evidence_urls", "source_notes",
          ],
        },
      },
    },
    required: ["prospects"],
  };
}

function searchInstructions(brief: ProcurementBrief): string {
  const archetypes = brief.supplier_archetypes.join("; ") || brief.supplier_role;
  const mustHave = brief.must_have.length ? brief.must_have.join("; ") : "none stated";
  const avoid = brief.avoid_keywords.length ? brief.avoid_keywords.join("; ") : "none";
  const disq = brief.disqualifiers.length ? brief.disqualifiers.join("; ") : "none stated";
  return [
    "You are TenderPath's procurement prospect researcher. Use web search to find REAL organizations that could credibly be HIRED for the role below and WIN this contract.",
    "",
    `ROLE BEING HIRED: ${brief.supplier_role}`,
    `WHAT THE BUYER IS BUYING: ${brief.procured_object}`,
    `FIND ORGANIZATIONS LIKE: ${archetypes}`,
    `QUALIFICATIONS THAT MATTER: ${mustHave}`,
    `GEOGRAPHY: ${brief.geography}`,
    "",
    "HARD RULES:",
    `- Return ONLY organizations that actually perform "${brief.supplier_role}". Set role_fit=false for anything that does not — it will be discarded.`,
    `- Do NOT return firms whose business is the subject matter being served/audited/built rather than the role being hired. In particular, avoid organizations centered on: ${avoid}.`,
    `- Exclude (do not return): tender notices, procurement portals, job postings, government buyers, the contracting agency itself, news articles, generic directories/aggregators, and these disqualified parties: ${disq}.`,
    "- Every prospect must be a real organization with its own web presence, include at least one evidence URL (its official site or a credible profile page), and give concrete fit reasons tied to the ROLE (not just the sector).",
    "- Prefer firms with presence in or demonstrable experience serving the stated geography. Do not invent contact details or facts.",
  ].join("\n");
}

function discoveryInput(tender: TenderExternalDiscoveryRow, brief: ProcurementBrief, queries: string[]): string {
  return [
    tenderFacts(tender),
    "",
    "PROCUREMENT BRIEF (what to find):",
    `- Role being hired: ${brief.supplier_role}`,
    `- Find organizations like: ${brief.supplier_archetypes.join("; ")}`,
    brief.must_have.length ? `- Must-have qualifications: ${brief.must_have.join("; ")}` : null,
    brief.avoid_keywords.length ? `- Avoid subject-matter firms about: ${brief.avoid_keywords.join("; ")}` : null,
    brief.disqualifiers.length ? `- Cannot bid (exclude): ${brief.disqualifiers.join("; ")}` : null,
    "",
    "Suggested web search queries (use or adapt — they target the supplier, not the subject matter):",
    queries.map((q) => `- ${q}`).join("\n"),
  ].filter(Boolean).join("\n");
}

function parseProspects(
  raw: string,
  limit: number,
  brief: ProcurementBrief,
  tender: TenderExternalDiscoveryRow,
): { prospects: ExternalProspectInput[]; dropped: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate(raw));
  } catch {
    return { prospects: [], dropped: 0 };
  }
  const items = (parsed && typeof parsed === "object" && Array.isArray((parsed as { prospects?: unknown }).prospects))
    ? (parsed as { prospects: unknown[] }).prospects
    : [];

  const seen = new Set<string>();
  const out: ExternalProspectInput[] = [];
  const droppedRoleFit: string[] = [];
  let dropped = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = clean(row.name, 240);
    if (!name) continue;

    // Role-fit gate: the model self-reports whether the org actually performs
    // the hired role. Drop the ones it flags as off-role — this is the guard
    // against "audit notice -> energy company" style misinterpretation.
    if (row.role_fit === false) {
      dropped += 1;
      droppedRoleFit.push(name);
      continue;
    }
    if (typeof row.role_fit !== "boolean") {
      // Required under the strict schema; absence means model/schema drift.
      // Keep the prospect (don't silently drop a possibly-valid org) but log it.
      console.warn("[network:external-discovery:role_fit_nonbool]", { tenderId: tender.id, name });
    }

    const website = cleanUrl(clean(row.website, 700));
    const evidenceUrls = toStringArray(row.evidence_urls, 5, 700).map(cleanUrl).filter((url): url is string => Boolean(url));
    if (!website && evidenceUrls.length === 0) { dropped += 1; continue; }

    const fitReasons = toStringArray(row.fit_reasons, 5, 200);
    const roleReason = clean(row.role_fit_reason, 200);
    if (roleReason && !fitReasons.some((r) => normalized(r) === normalized(roleReason))) {
      fitReasons.unshift(roleReason);
    }
    if (!fitReasons.length) { dropped += 1; continue; }

    const confidenceRaw = clean(row.confidence, 20);
    const confidence: ExternalDiscoveryConfidence =
      confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium";

    const sectors = toStringArray(row.sectors, 8, 80);
    const servicesText = clean(row.services_text, 1800);
    const orgType = clean(row.org_type, 100);
    const countries = toStringArray(row.countries, 6, 80);
    const country = clean(row.country, 160);

    const base: ExternalProspectInput = {
      name,
      website,
      country,
      countries,
      sectors,
      org_type: orgType,
      services_text: servicesText,
      score: 0,
      confidence,
      fit_reasons: fitReasons.slice(0, 5),
      evidence_urls: evidenceUrls,
      source_notes: clean(row.source_notes, 1000),
    };

    // Soft demotion: if the org reads as a subject-matter firm (matches the
    // avoid list) with no sign of the supplier archetype, flag it rather than
    // trust the score. Keeps recall while warning the operator.
    const orgText = [name, servicesText, orgType, ...sectors].filter(Boolean).join(" ");
    const avoidHit = anyTokenOverlap(orgText, brief.avoid_keywords);
    const archetypeHit = anyTokenOverlap(orgText, [brief.supplier_role, ...brief.supplier_archetypes, ...brief.target_keywords]);
    const avoidPenalty = avoidHit && !archetypeHit;
    if (avoidPenalty) {
      base.fit_reasons = [`⚠ reads as ${brief.domain ?? "subject-matter"} firm — verify it performs ${brief.supplier_role}`, ...base.fit_reasons].slice(0, 5);
    }

    const countryHit = countryMatches(tender.country, base);
    base.score = scoreFor(base, { countryHit, avoidPenalty });

    const key = dedupKeyFor(base);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(base);
    if (out.length >= limit) break;
  }
  if (droppedRoleFit.length) {
    console.info("[network:external-discovery:role_fit_dropped]", {
      tenderId: tender.id,
      count: droppedRoleFit.length,
      names: droppedRoleFit.slice(0, 10),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return { prospects: out, dropped };
}

async function searchWithOpenAI(
  tender: TenderExternalDiscoveryRow,
  brief: ProcurementBrief,
  queries: string[],
  limit: number,
): Promise<{ prospects: ExternalProspectInput[]; dropped: number }> {
  const model = process.env.OPENAI_WEB_SEARCH_MODEL?.trim() || "gpt-4.1-mini";
  // "medium" balances recall vs. token cost for an admin-triggered call. Set
  // OPENAI_WEB_SEARCH_CONTEXT=high to widen the web context when recall matters
  // more than cost on a given source.
  const contextSize = (process.env.OPENAI_WEB_SEARCH_CONTEXT?.trim() || "medium") as "low" | "medium" | "high";
  const response = await getOpenAIClient().responses.create({
    model,
    input: discoveryInput(tender, brief, queries),
    instructions: searchInstructions(brief),
    tools: [{ type: "web_search_preview", search_context_size: contextSize }],
    text: {
      format: { type: "json_schema", name: "tender_external_prospects", schema: prospectSchema(limit), strict: true },
      verbosity: "low",
    },
    temperature: 0.2,
    max_output_tokens: 5000,
    store: false,
  });

  const parsed = parseProspects(response.output_text ?? "{}", limit, brief, tender);
  console.info("[network:external-discovery:usage]", {
    tenderId: tender.id,
    provider: "openai_web_search",
    model,
    contextSize,
    kept: parsed.prospects.length,
    dropped: parsed.dropped,
    usage: response.usage ?? null,
  });
  return parsed;
}

async function searchWithAnthropic(
  tender: TenderExternalDiscoveryRow,
  brief: ProcurementBrief,
  queries: string[],
  limit: number,
): Promise<{ prospects: ExternalProspectInput[]; dropped: number }> {
  const model = anthropicModel();
  const client = getAnthropicClient();
  const shapeHint =
    '{"prospects":[{"name":"","website":"","country":"","countries":[],"sectors":[],"org_type":"","services_text":"","confidence":"medium","role_fit":true,"role_fit_reason":"","fit_reasons":[],"evidence_urls":[],"source_notes":""}]}';
  const prompt = `${discoveryInput(tender, brief, queries)}

Return JSON only with this shape:
${shapeHint}

Aim for ${limit} prospects. Set role_fit=false for any organization that does not actually perform "${brief.supplier_role}". Return an empty array only if no credible organization evidence can be found after trying the supplied queries. Use empty strings for unknown scalar values, but keep evidence_urls populated from web evidence.`;

  const response = await client.messages.create({
    model,
    max_tokens: 4800,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.min(6, Math.max(2, queries.length + 1)) }],
    output_config: { format: { type: "json_schema", schema: anthropicProspectSchema() } },
    system: searchInstructions(brief),
    messages: [{ role: "user", content: prompt }],
  });
  const text = anthropicTextOf(response.content);
  const parsed = parseProspects(text || "{}", limit, brief, tender);
  if (parsed.prospects.length > 0) {
    console.info("[network:external-discovery:usage]", {
      tenderId: tender.id, provider: "anthropic_web_search", model,
      kept: parsed.prospects.length, dropped: parsed.dropped,
    });
    return parsed;
  }

  console.warn("[network:external-discovery:anthropic-empty]", {
    tenderId: tender.id,
    attempt: "structured",
    stopReason: response.stop_reason,
    contentTypes: response.content.map((block) => block.type),
    textLength: text.length,
    textSample: text.slice(0, 280),
  });

  const retry = await client.messages.create({
    model,
    max_tokens: 4800,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.min(8, Math.max(3, queries.length + 2)) }],
    system: `${searchInstructions(brief)} Output must be parseable JSON only. Do not wrap it in markdown.`,
    messages: [{
      role: "user",
      content: `${prompt}

The prior structured extraction produced no persisted prospects. Broaden to credible company profile pages, supplier directories, chamber/registry pages, NGO profiles, and official organization pages that perform "${brief.supplier_role}". Each prospect still needs at least one evidence URL and at least one role-specific fit reason.`,
    }],
  });
  const retryText = anthropicTextOf(retry.content);
  const retryParsed = parseProspects(retryText || "{}", limit, brief, tender);
  if (retryParsed.prospects.length === 0) {
    console.warn("[network:external-discovery:anthropic-empty]", {
      tenderId: tender.id,
      attempt: "loose_retry",
      stopReason: retry.stop_reason,
      contentTypes: retry.content.map((block) => block.type),
      textLength: retryText.length,
      textSample: retryText.slice(0, 280),
    });
  }
  return retryParsed;
}

async function searchExternalProspects(
  tender: TenderExternalDiscoveryRow,
  brief: ProcurementBrief,
  queries: string[],
  limit: number,
  provider: ExternalDiscoveryProvider,
): Promise<{ prospects: ExternalProspectInput[]; dropped: number }> {
  if (provider === "openai_web_search") {
    return searchWithOpenAI(tender, brief, queries, limit);
  }
  return searchWithAnthropic(tender, brief, queries, limit);
}

async function loadTender(tenderId: number): Promise<TenderExternalDiscoveryRow | null> {
  const rows = (await sql`
    SELECT
      id, title, description, agency, country, sector, opportunity_type,
      eligibility_summary, required_registrations, requirements
    FROM tenders
    WHERE id = ${tenderId}
    LIMIT 1
  `) as TenderExternalDiscoveryRow[];
  return rows[0] ?? null;
}

export async function discoverExternalProspectsForTender(
  tenderId: number,
  opts: { limit?: number; createdBy?: number | null } = {},
): Promise<ExternalDiscoveryResult | null> {
  await ensureNetworkMatchingColumns();
  const tender = await loadTender(tenderId);
  if (!tender) return null;

  const limit = Math.max(1, Math.min(MAX_EXTERNAL_DISCOVERY_LIMIT, Math.round(opts.limit ?? DEFAULT_EXTERNAL_DISCOVERY_LIMIT)));
  const provider = configuredProvider();

  if (!provider) {
    const brief = heuristicBrief(tender);
    return {
      mode: "queries_only",
      providerConfigured: false,
      provider: null,
      tenderId: tender.id,
      brief,
      briefSource: "heuristic",
      queries: buildQueriesFromBrief(tender, brief),
      inserted: 0,
      refreshed: 0,
      prospects: [],
      dropped: 0,
      error: "No web-search provider is configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY); returning the procurement brief and search queries only.",
    };
  }

  const { brief, source: briefSource } = await buildProcurementBrief(tender, provider);
  const queries = buildQueriesFromBrief(tender, brief);
  const { prospects, dropped } = await searchExternalProspects(tender, brief, queries, limit, provider);

  const existingRows = await sql`
    SELECT dedup_key
    FROM network_external_prospects
    WHERE tender_id = ${tender.id}
  `;
  const existingKeys = new Set(existingRows.map((row) => String(row.dedup_key)));

  // Bridge web discoveries to firms already in the Tenderpath network so the
  // operator sees "already in your network" instead of chasing a redundant cold
  // lead. Match on website host first (strongest), then normalized company name.
  const networkRows = await sql`
    SELECT id, name, website FROM network_companies WHERE is_active = TRUE
  `;
  const netByHost = new Map<string, number>();
  const netByName = new Map<string, number>();
  for (const row of networkRows) {
    const id = Number(row.id);
    const host = hostOf(row.website as string | null);
    if (host && !netByHost.has(host)) netByHost.set(host, id);
    const name = normalized(row.name as string | null);
    if (name && !netByName.has(name)) netByName.set(name, id);
  }

  let inserted = 0;
  let refreshed = 0;
  let bridged = 0;

  for (const prospect of prospects) {
    const dedupKey = dedupKeyFor(prospect);
    const host = hostOf(prospect.website);
    const networkCompanyId =
      (host ? netByHost.get(host) : undefined) ?? netByName.get(normalized(prospect.name)) ?? null;
    if (networkCompanyId) {
      bridged += 1;
      if (!prospect.fit_reasons.some((r) => /already in your.*network/i.test(r))) {
        prospect.fit_reasons = ["Already in your Tenderpath network — open the profile", ...prospect.fit_reasons].slice(0, 5);
      }
    }
    // On refresh (ON CONFLICT) we update content (name, fit, evidence, score,
    // brief, provider) but intentionally DO NOT touch `status`, so an operator's
    // review decision ('reviewed'/'dismissed'/'added_to_network') survives a re-run.
    await sql`
      INSERT INTO network_external_prospects (
        tender_id, network_company_id, name, website, country, countries,
        sectors, org_type, services_text, score, confidence, fit_reasons,
        evidence_urls, search_queries, search_brief, provider, status,
        dedup_key, raw_payload, created_by, last_discovered_at
      ) VALUES (
        ${tender.id}, ${networkCompanyId}, ${prospect.name}, ${prospect.website},
        ${prospect.country},
        ${JSON.stringify(prospect.countries)}::jsonb,
        ${JSON.stringify(prospect.sectors)}::jsonb,
        ${prospect.org_type}, ${prospect.services_text}, ${prospect.score},
        ${prospect.confidence}, ${JSON.stringify(prospect.fit_reasons)}::jsonb,
        ${JSON.stringify(prospect.evidence_urls)}::jsonb,
        ${JSON.stringify(queries)}::jsonb, ${JSON.stringify(brief)}::jsonb,
        ${provider}, 'suggested', ${dedupKey},
        ${JSON.stringify(prospect)}::jsonb, ${opts.createdBy ?? null}, NOW()
      )
      ON CONFLICT (tender_id, dedup_key) DO UPDATE SET
        network_company_id = COALESCE(EXCLUDED.network_company_id, network_external_prospects.network_company_id),
        name = EXCLUDED.name,
        website = EXCLUDED.website,
        country = EXCLUDED.country,
        countries = EXCLUDED.countries,
        sectors = EXCLUDED.sectors,
        org_type = EXCLUDED.org_type,
        services_text = EXCLUDED.services_text,
        score = EXCLUDED.score,
        confidence = EXCLUDED.confidence,
        fit_reasons = EXCLUDED.fit_reasons,
        evidence_urls = EXCLUDED.evidence_urls,
        search_queries = EXCLUDED.search_queries,
        search_brief = EXCLUDED.search_brief,
        provider = EXCLUDED.provider,
        raw_payload = EXCLUDED.raw_payload,
        last_discovered_at = NOW(),
        updated_at = NOW()
    `;
    if (existingKeys.has(dedupKey)) refreshed += 1;
    else inserted += 1;
  }

  const result: ExternalDiscoveryResult = {
    mode: "web_search",
    providerConfigured: true,
    provider,
    tenderId: tender.id,
    brief,
    briefSource,
    queries,
    inserted,
    refreshed,
    prospects,
    dropped,
  };
  console.info("[network:external-discovery:tender]", {
    tenderId: tender.id,
    provider,
    intent: brief.intent,
    role: brief.supplier_role,
    briefSource,
    inserted,
    refreshed,
    bridged,
    dropped,
    prospects: prospects.length,
  });
  return result;
}
