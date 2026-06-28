import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
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
type ExternalDiscoveryProvider = "openai_web_search" | "anthropic_web_search";

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
  tenderId: number;
  queries: string[];
  inserted: number;
  refreshed: number;
  prospects: ExternalProspectInput[];
  provider: ExternalDiscoveryProvider | null;
  error?: string;
}

function clean(value: unknown, max = 1000): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function toStringArray(value: unknown, max = 10): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, 160);
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

function dedupKeyFor(prospect: Pick<ExternalProspectInput, "name" | "website">): string {
  const website = cleanUrl(prospect.website);
  if (website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./, "");
      if (host) return `site:${host}`;
    } catch {
      // fall through to company name
    }
  }
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

function scoreFor(confidence: ExternalDiscoveryConfidence, reasons: string[], evidenceUrls: string[]): number {
  const base = confidence === "high" ? 78 : confidence === "medium" ? 64 : 48;
  return Math.min(92, base + Math.min(8, reasons.length * 2) + Math.min(6, evidenceUrls.length * 2));
}

function capabilityKeywords(tender: TenderExternalDiscoveryRow): string[] {
  const text = [
    tender.title,
    tender.sector,
    tender.eligibility_summary,
    tender.required_registrations,
  ].filter(Boolean).join(" ");
  const stop = new Set([
    "call", "country", "delivery", "development", "expression", "interest",
    "invitation", "procurement", "programme", "project", "proposal", "request",
    "services", "supply", "support", "technical", "tender",
  ]);
  return [...new Set(
    normalized(text)
      .split(" ")
      .filter((token) => token.length > 4 && !stop.has(token))
      .slice(0, 8),
  )];
}

export function buildExternalProspectQueries(tender: TenderExternalDiscoveryRow): string[] {
  const country = tender.country?.trim();
  const sector = tender.sector?.trim();
  const agency = tender.agency?.trim();
  const keywords = capabilityKeywords(tender).slice(0, 5).join(" ");
  const title = tender.title.replace(/\s+/g, " ").trim();
  const queryBits = [
    country,
    sector,
    keywords,
  ].filter(Boolean).join(" ");

  return [
    `${queryBits} suppliers companies ${country ?? ""}`.trim(),
    `${queryBits} NGOs consultancies contractors ${country ?? ""}`.trim(),
    `${title} similar suppliers companies ${country ?? ""}`.trim(),
    agency ? `${agency} vendors suppliers ${sector ?? keywords} ${country ?? ""}`.trim() : "",
    `${sector ?? keywords} UNGM registered vendors ${country ?? ""}`.trim(),
  ].map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 5);
}

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
            fit_reasons: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
            evidence_urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
            source_notes: { type: ["string", "null"] },
          },
          required: [
            "name",
            "website",
            "country",
            "countries",
            "sectors",
            "org_type",
            "services_text",
            "confidence",
            "fit_reasons",
            "evidence_urls",
            "source_notes",
          ],
        },
      },
    },
    required: ["prospects"],
  };
}

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
            fit_reasons: { type: "array", items: { type: "string" } },
            evidence_urls: { type: "array", items: { type: "string" } },
            source_notes: { type: "string" },
          },
          required: [
            "name",
            "website",
            "country",
            "countries",
            "sectors",
            "org_type",
            "services_text",
            "confidence",
            "fit_reasons",
            "evidence_urls",
            "source_notes",
          ],
        },
      },
    },
    required: ["prospects"],
  };
}

function jsonCandidate(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function parseProspects(raw: string, limit: number): ExternalProspectInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate(raw));
  } catch {
    return [];
  }
  const prospects = (parsed && typeof parsed === "object" && Array.isArray((parsed as { prospects?: unknown }).prospects))
    ? (parsed as { prospects: unknown[] }).prospects
    : [];

  const seen = new Set<string>();
  const out: ExternalProspectInput[] = [];
  for (const item of prospects) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = clean(row.name, 240);
    if (!name) continue;
    const website = cleanUrl(clean(row.website, 700));
    const evidenceUrls = toStringArray(row.evidence_urls, 5).map(cleanUrl).filter((url): url is string => Boolean(url));
    if (!website && evidenceUrls.length === 0) continue;
    const fitReasons = toStringArray(row.fit_reasons, 5);
    if (!fitReasons.length) continue;
    const confidenceRaw = clean(row.confidence, 20);
    const confidence: ExternalDiscoveryConfidence =
      confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium";
    const prospect: ExternalProspectInput = {
      name,
      website,
      country: clean(row.country, 160),
      countries: toStringArray(row.countries, 6),
      sectors: toStringArray(row.sectors, 8),
      org_type: clean(row.org_type, 100),
      services_text: clean(row.services_text, 1800),
      score: scoreFor(confidence, fitReasons, evidenceUrls),
      confidence,
      fit_reasons: fitReasons,
      evidence_urls: evidenceUrls,
      source_notes: clean(row.source_notes, 1000),
    };
    const key = dedupKeyFor(prospect);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prospect);
    if (out.length >= limit) break;
  }
  return out;
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

function configuredProvider(): ExternalDiscoveryProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai_web_search";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic_web_search";
  return null;
}

const DISCOVERY_INSTRUCTIONS =
  "You are TenderPath's procurement prospect researcher. Use web search to find companies, NGOs, consultancies, contractors, or suppliers that could credibly pursue this tender. Return only organizations, not tender notices, procurement portals, job posts, government agencies, generic directories, or news-only results. Prefer official company pages and credible profile pages. Every prospect must include evidence URLs and concrete fit reasons tied to the tender. Do not invent contact details. When country names are ambiguous place names, verify the organization operates in or supplies to the tender country.";

function discoveryInput(tender: TenderExternalDiscoveryRow, queries: string[]): string {
  return [
    `Tender title: ${tender.title}`,
    `Agency: ${tender.agency ?? "unknown"}`,
    `Country: ${tender.country ?? "unknown"}`,
    `Sector: ${tender.sector ?? "unknown"}`,
    `Type: ${tender.opportunity_type ?? "unknown"}`,
    tender.eligibility_summary ? `Eligibility: ${tender.eligibility_summary}` : null,
    tender.required_registrations ? `Required registrations: ${tender.required_registrations}` : null,
    `Search queries to use or adapt:\n${queries.map((q) => `- ${q}`).join("\n")}`,
  ].filter(Boolean).join("\n");
}

async function searchWithOpenAI(
  tender: TenderExternalDiscoveryRow,
  queries: string[],
  limit: number,
): Promise<ExternalProspectInput[]> {
  const model = process.env.OPENAI_WEB_SEARCH_MODEL?.trim() || "gpt-4.1-mini";
  const response = await getOpenAIClient().responses.create({
    model,
    input: discoveryInput(tender, queries),
    instructions: DISCOVERY_INSTRUCTIONS,
    tools: [{ type: "web_search_preview", search_context_size: "medium" }],
    text: {
      format: {
        type: "json_schema",
        name: "tender_external_prospects",
        schema: prospectSchema(limit),
        strict: true,
      },
      verbosity: "low",
    },
    temperature: 0.2,
    max_output_tokens: 4500,
    store: false,
  });

  return parseProspects(response.output_text ?? "{}", limit);
}

async function searchWithAnthropic(
  tender: TenderExternalDiscoveryRow,
  queries: string[],
  limit: number,
): Promise<ExternalProspectInput[]> {
  const model =
    process.env.ANTHROPIC_WEB_SEARCH_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    "claude-haiku-4-5-20251001";
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: 4500,
    tools: [{
      type: "web_search_20250305",
      name: "web_search",
      max_uses: Math.min(6, Math.max(2, queries.length + 1)),
    }],
    output_config: {
      format: {
        type: "json_schema",
        schema: anthropicProspectSchema(),
      },
    },
    system: DISCOVERY_INSTRUCTIONS,
    messages: [{
      role: "user",
      content: `${discoveryInput(tender, queries)}

Return JSON only with this shape:
{"prospects":[{"name":"","website":"","country":"","countries":[],"sectors":[],"org_type":"","services_text":"","confidence":"medium","fit_reasons":[],"evidence_urls":[],"source_notes":""}]}

Return at most ${limit} prospects. Use empty strings for unknown scalar values, but keep evidence_urls populated from web evidence.`,
    }],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return parseProspects(text || "{}", limit);
}

async function searchExternalProspects(
  tender: TenderExternalDiscoveryRow,
  queries: string[],
  limit: number,
  provider: ExternalDiscoveryProvider,
): Promise<ExternalProspectInput[]> {
  if (provider === "openai_web_search") {
    return searchWithOpenAI(tender, queries, limit);
  }
  return searchWithAnthropic(tender, queries, limit);
}

export async function discoverExternalProspectsForTender(
  tenderId: number,
  opts: { limit?: number; createdBy?: number | null } = {},
): Promise<ExternalDiscoveryResult | null> {
  await ensureNetworkMatchingColumns();
  const tender = await loadTender(tenderId);
  if (!tender) return null;

  const limit = Math.max(1, Math.min(MAX_EXTERNAL_DISCOVERY_LIMIT, Math.round(opts.limit ?? DEFAULT_EXTERNAL_DISCOVERY_LIMIT)));
  const queries = buildExternalProspectQueries(tender);
  const provider = configuredProvider();

  if (!provider) {
    return {
      mode: "queries_only",
      providerConfigured: false,
      tenderId: tender.id,
      queries,
      inserted: 0,
      refreshed: 0,
      prospects: [],
      provider: null,
      error: "No web-search provider is configured; returning search queries only.",
    };
  }

  const prospects = await searchExternalProspects(tender, queries, limit, provider);
  const existingRows = await sql`
    SELECT dedup_key
    FROM network_external_prospects
    WHERE tender_id = ${tender.id}
  `;
  const existingKeys = new Set(existingRows.map((row) => String(row.dedup_key)));
  let inserted = 0;
  let refreshed = 0;

  for (const prospect of prospects) {
    const dedupKey = dedupKeyFor(prospect);
    await sql`
      INSERT INTO network_external_prospects (
        tender_id, name, website, country, countries, sectors, org_type,
        services_text, score, confidence, fit_reasons, evidence_urls,
        search_queries, provider, status, dedup_key, raw_payload, created_by,
        last_discovered_at
      ) VALUES (
        ${tender.id}, ${prospect.name}, ${prospect.website}, ${prospect.country},
        ${JSON.stringify(prospect.countries)}::jsonb,
        ${JSON.stringify(prospect.sectors)}::jsonb,
        ${prospect.org_type}, ${prospect.services_text}, ${prospect.score},
        ${prospect.confidence}, ${JSON.stringify(prospect.fit_reasons)}::jsonb,
        ${JSON.stringify(prospect.evidence_urls)}::jsonb,
        ${JSON.stringify(queries)}::jsonb, ${provider}, 'suggested',
        ${dedupKey}, ${JSON.stringify(prospect)}::jsonb, ${opts.createdBy ?? null},
        NOW()
      )
      ON CONFLICT (tender_id, dedup_key) DO UPDATE SET
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
    queries,
    inserted,
    refreshed,
    prospects,
  };
  console.info("[network:external-discovery:tender]", {
    tenderId: tender.id,
    provider,
    inserted,
    refreshed,
    prospects: prospects.length,
  });
  return result;
}
