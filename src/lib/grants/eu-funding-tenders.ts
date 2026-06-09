import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";
import { ALL_COUNTRIES } from "@/lib/countries";

export type EuFundingGrant = {
  reference_id: string;
  title: string;
  agency: string;
  deadline: string | null;
  sector: SectorSlug | null;
  themes: string[];
  eligible_org_types: string[];
  countries: string[];
  country: string | null;
  region: string | null;
  description: string | null;
  value_range: string | null;
  source_name: "EU Funding & Tenders";
  source_url: string;
  status: "open";
};

type SearchResult = {
  reference?: string;
  url?: string;
  summary?: string;
  content?: string;
  metadata?: Record<string, string[] | undefined>;
};

type SearchResponse = {
  totalResults?: number;
  results?: SearchResult[];
};

const SEARCH_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/search";
const SOURCE_NAME = "EU Funding & Tenders" as const;
const PORTAL_BASE = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/";
const PROSPECT_BASE = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/prospect-details/";
const REGION_NAMES = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;
const COUNTRY_CANONICAL = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.country]));
COUNTRY_CANONICAL.set("syrian arab republic", "Syria");
const COUNTRY_REGION = new Map(ALL_COUNTRIES.map((row) => [row.country, row.region]));

const THEME_MAP: Array<[RegExp, string[]]> = [
  [/\b(agricultur|rural|food|farm|crop|bioeconomy)\b/i, ["agriculture", "food security", "rural development"]],
  [/\b(climate|environment|biodiversity|nature|circular|pollution|ecosystem|sustainab)\b/i, ["climate", "environment", "biodiversity", "resilience"]],
  [/\b(energy|renewable|solar|hydrogen|electric|battery|grid|efficiency)\b/i, ["energy", "renewable energy", "climate"]],
  [/\b(health|medical|disease|cancer|clinical|pharma|nutrition|pandemic)\b/i, ["health", "public health", "medical"]],
  [/\b(water|sanitation|wash|wastewater|hygiene)\b/i, ["wash", "water", "sanitation"]],
  [/\b(digital|data|cyber|artificial intelligence|\bai\b|software|technology|innovation|ict)\b/i, ["digital", "technology", "innovation", "data"]],
  [/\b(education|skills|training|youth|erasmus|learning)\b/i, ["education", "training", "youth", "skills"]],
  [/\b(governance|democracy|rights|civil society|rule of law|justice)\b/i, ["governance", "civil society", "rule of law"]],
  [/\b(freedom of expression|media|journalis|independent press|information integrity|disinformation)\b/i, ["civil society", "media", "freedom of expression"]],
  [/\b(social cohesion|peacebuilding|reconciliation|community dialogue)\b/i, ["civil society", "social cohesion", "peacebuilding"]],
  [/\b(security|defence|defense|conflict|peace|border)\b/i, ["security", "peacebuilding", "protection"]],
];

const DEFAULT_EU_ELIGIBILITY = ["NGO", "research_institution", "education_institution"];

function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function first(meta: Record<string, string[] | undefined> | undefined, key: string): string | null {
  const value = meta?.[key]?.find((v) => typeof v === "string" && !!v.trim());
  return value?.trim() ?? null;
}

function all(meta: Record<string, string[] | undefined> | undefined, key: string): string[] {
  return meta?.[key]?.filter((v): v is string => typeof v === "string" && !!v.trim()) ?? [];
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function descriptiveValues(values: string[]): string[] {
  return values.map((value) => stripInternalCodes(value) ?? "").filter((value) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    // SEDIA includes internal numeric taxonomy ids in action/program fields.
    // They look like UNSPSC/CPV codes to normalizeSector(), but are not
    // procurement sector codes and should not drive matching.
    return !/^\d{5,}$/.test(trimmed);
  });
}

function stripInternalCodes(value: string | null | undefined): string | null {
  const stripped = value?.replace(/\b\d{5,}\b/g, " ").replace(/\s{2,}/g, " ").trim();
  return stripped || null;
}

function futureDeadline(dates: string[]): string | null {
  const now = Date.now();
  const parsed = dates
    .map((date) => new Date(date))
    .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() >= now)
    .sort((a, b) => a.getTime() - b.getTime());
  return parsed[0]?.toISOString() ?? null;
}

function themesFor(text: string): string[] {
  const themes: string[] = [];
  for (const [pattern, values] of THEME_MAP) {
    if (pattern.test(text)) themes.push(...values);
  }
  return unique(themes);
}

function eligibleOrgTypesFor(text: string): string[] {
  const orgs: string[] = [];
  if (/\b(sme|small and medium|enterprise|startup|start-up|company|companies|business|private sector|industry|innovation action|cascade funding|financial support to third parties|eic)\b/i.test(text)) {
    orgs.push("company");
  }
  if (/\b(non-profit|nonprofit|ngo|civil society|association|foundation|community|volunteer|humanitarian|quality label|freedom of expression|social cohesion|human rights|rule of law|justice|democracy)\b/i.test(text)) {
    orgs.push("NGO");
  }
  if (/\b(research|university|academic|horizon|doctoral|science|scientific|laborator|institute)\b/i.test(text)) {
    orgs.push("research_institution", "education_institution");
  }
  if (/\b(school|education|erasmus|training|learning|vocational|youth)\b/i.test(text)) {
    orgs.push("education_institution", "NGO");
  }
  if (/\b(public authorit|municipalit|regional authorit|government|ministry|city|cities|local authorit)\b/i.test(text)) {
    orgs.push("government_entity");
  }
  return unique(orgs.length ? orgs : DEFAULT_EU_ELIGIBILITY);
}

function isProspectReference(value: string | null | undefined): boolean {
  return /PROSPECTS[A-Z]{2,}/i.test(value ?? "");
}

function prospectReference(meta: Record<string, string[] | undefined> | undefined, result: SearchResult): string | null {
  const candidates = [
    result.reference,
    first(meta, "REFERENCE"),
    first(meta, "reference"),
  ];
  return candidates.find(isProspectReference) ?? null;
}

function rowReferenceId(meta: Record<string, string[] | undefined> | undefined, result: SearchResult, identifier: string): string {
  return prospectReference(meta, result) ?? identifier;
}

function sourceUrl(
  meta: Record<string, string[] | undefined> | undefined,
  result: SearchResult,
  identifier: string,
): string {
  const prospectRef = prospectReference(meta, result);
  if (prospectRef) return `${PROSPECT_BASE}${encodeURIComponent(prospectRef)}`;

  const url = first(meta, "url") ?? first(meta, "esST_URL") ?? result.url;
  if (url?.includes("/data/topicDetails/")) {
    return `${PORTAL_BASE}${encodeURIComponent(identifier)}`;
  }
  return url ?? `${PORTAL_BASE}${encodeURIComponent(identifier)}`;
}

function canonicalCountry(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  return COUNTRY_CANONICAL.get(clean.toLowerCase()) ?? null;
}

function countryFromIso2(code: string | null | undefined): string | null {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return null;
  const display = REGION_NAMES?.of(code.toUpperCase()) ?? null;
  return canonicalCountry(display) ?? null;
}

function countriesFor(text: string, identifier: string): string[] {
  const countries: string[] = [];
  const identifierCountry = countryFromIso2(identifier.match(/\/([A-Z]{2})$/i)?.[1]);
  if (identifierCountry) countries.push(identifierCountry);

  for (const { country } of ALL_COUNTRIES) {
    const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) countries.push(country);
  }
  if (/\bSyrian Arab Republic\b/i.test(text)) countries.push("Syria");

  return unique(countries);
}

function toGrant(result: SearchResult): EuFundingGrant | null {
  const meta = result.metadata ?? {};
  const identifier = first(meta, "identifier");
  if (!identifier) return null;
  const deadline = futureDeadline(all(meta, "deadlineDate"));
  if (!deadline) return null;

  const title = first(meta, "title") ?? result.summary ?? result.content ?? identifier;
  const description = stripHtml(first(meta, "description") ?? result.content ?? result.summary);
  const actionTypes = descriptiveValues(all(meta, "typesOfAction"));
  const programme = stripInternalCodes(first(meta, "frameworkProgramme"));
  const categoryText = `${actionTypes.join(" ")} ${programme ?? ""}`;
  const text = `${title} ${description} ${categoryText}`;
  const primarySlugs = normalizeSector(categoryText, title, "");
  const fallbackSlugs = normalizeSector("", title, description);
  const sector = primarySlugs[0] ?? fallbackSlugs[0] ?? null;
  const countryMatches = countriesFor(`${title} ${description} ${identifier}`, identifier);
  const country = countryMatches.length === 1 ? countryMatches[0] : countryMatches.length > 1 ? null : "Global";
  const matchedRegions = unique(countryMatches.map((c) => COUNTRY_REGION.get(c)));
  const region = matchedRegions.length === 1 ? matchedRegions[0] : countryMatches.length > 1 ? "Multi-country" : "Global";
  const themes = unique([
    ...themesFor(text),
    ...actionTypes,
    programme,
  ]);
  const eligibleOrgTypes = eligibleOrgTypesFor(text);
  const referenceId = rowReferenceId(meta, result, identifier);

  return {
    reference_id: `EU_FT:${referenceId}`,
    title,
    agency: "European Commission",
    deadline,
    sector,
    themes,
    eligible_org_types: eligibleOrgTypes,
    countries: countryMatches.length ? countryMatches : ["Global"],
    country,
    region,
    description: description.length >= 80 ? description : null,
    value_range: null,
    source_name: SOURCE_NAME,
    source_url: sourceUrl(meta, result, identifier),
    status: "open",
  };
}

function appendJson(form: FormData, name: string, value: unknown) {
  form.set(name, new Blob([JSON.stringify(value)], { type: "application/json" }));
}

export async function fetchEuFundingGrants(pageSize = 100, pageNumber = 1, text = "*"): Promise<{
  grants: EuFundingGrant[];
  totalResults: number;
}> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("apiKey", "SEDIA");
  url.searchParams.set("text", text || "*");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("pageNumber", String(pageNumber));

  const form = new FormData();
  appendJson(form, "query", {
    bool: {
      must: [
        { terms: { type: ["1", "2", "8"] } },
        { terms: { status: ["31094501", "31094502"] } },
      ],
    },
  });
  appendJson(form, "languages", ["en"]);
  appendJson(form, "sort", { field: "deadlineDate", order: "ASC" });
  appendJson(form, "displayFields", [
    "type", "identifier", "reference", "callccm2Id", "title", "status",
    "caName", "startDate", "deadlineDate", "description", "frameworkProgramme",
    "programmePeriod", "typesOfAction", "url",
  ]);

  const response = await fetch(url, {
    method: "POST",
    body: form,
    // Bound each request tightly: a healthy SEDIA answers in <2s, but it blackholes
    // Vercel's datacenter IP and the connection just hangs. Fail fast (8s) so EU can't
    // consume the grant cron's 300s budget and starve the other five sources' writes.
    signal: AbortSignal.timeout(8000),
    headers: {
      accept: "application/json",
      "user-agent": "Tenderpath EU grant import (+https://tenderpath.me)",
    },
  });
  if (!response.ok) throw new Error(`EU Funding & Tenders search failed: HTTP ${response.status}`);
  const data = await response.json() as SearchResponse;
  return {
    grants: (data.results ?? []).map(toGrant).filter((g): g is EuFundingGrant => !!g),
    totalResults: data.totalResults ?? 0,
  };
}

export async function fetchEuFundingGrantByReference(reference: string): Promise<EuFundingGrant | null> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("apiKey", "SEDIA");
  url.searchParams.set("text", reference);
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("pageNumber", "1");

  const form = new FormData();
  appendJson(form, "query", {
    bool: {
      must: [
        { terms: { status: ["31094501", "31094502"] } },
      ],
    },
  });
  appendJson(form, "languages", ["en"]);
  appendJson(form, "displayFields", [
    "type", "identifier", "reference", "callccm2Id", "title", "status",
    "caName", "startDate", "deadlineDate", "description", "frameworkProgramme",
    "programmePeriod", "typesOfAction", "url",
  ]);

  const response = await fetch(url, {
    method: "POST",
    body: form,
    // Bound each request tightly: a healthy SEDIA answers in <2s, but it blackholes
    // Vercel's datacenter IP and the connection just hangs. Fail fast (8s) so EU can't
    // consume the grant cron's 300s budget and starve the other five sources' writes.
    signal: AbortSignal.timeout(8000),
    headers: {
      accept: "application/json",
      "user-agent": "Tenderpath EU grant import (+https://tenderpath.me)",
    },
  });
  if (!response.ok) throw new Error(`EU Funding & Tenders reference lookup failed: HTTP ${response.status}`);
  const data = await response.json() as SearchResponse;
  return (data.results ?? [])
    .map(toGrant)
    .find((grant): grant is EuFundingGrant => !!grant && (
      grant.reference_id.toLowerCase().includes(reference.toLowerCase())
      || grant.source_url.toLowerCase().includes(reference.toLowerCase())
    )) ?? null;
}
