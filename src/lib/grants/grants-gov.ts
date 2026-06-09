/**
 * Grants.gov — geo-gated importer for U.S. federal grants relevant to TenderPath's
 * MENA/Africa development ICP.
 *
 * Grants.gov is ~80% U.S.-domestic noise (fire departments, state universities,
 * local clinics). A first pass that imported broadly and let the matcher demote
 * the domestic rows still leaked them onto the dashboard. This version instead
 * applies a HARD geography gate at ingestion: a row is kept only if it is
 * targeted at a specific foreign country or a developing region. Everything
 * U.S.-domestic / unknown-geography is dropped before it reaches the table.
 *
 * Measured yield (2026-06): of ~626 candidates from the targeted passes, the gate
 * keeps ~119 internationally-targeted rows (≈14 MENA, ≈33 Africa) — U.S. embassy
 * public-diplomacy, DRL democracy/human-rights, PRM refugee, religious-freedom,
 * and CDC global-health-security grants for in-country partners — and drops ~507
 * U.S.-domestic ones. Those are grants a MENA/Africa NGO can actually apply to.
 *
 * The gate runs on the cheap title+agency signal (embassy/mission grants name the
 * country there) BEFORE per-row detail enrichment, so we don't spend detail calls
 * on rows we're going to drop. Kept rows are then enriched through the existing
 * `grantsGovDetailPatch` and require a future deadline (the matcher filters on it).
 */
import { ALL_COUNTRIES } from "@/lib/countries";
import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";
import { fetchGrantsGovDetail, grantsGovDetailPatch } from "@/lib/grants/grants-gov-detail";

export type GrantsGovGrant = {
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
  source_name: "Grants.gov";
  source_url: string;
  status: "open";
};

type SearchHit = {
  id?: string;
  number?: string;
  title?: string;
  agencyCode?: string;
  agency?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
  cfdaList?: string[];
};

type SearchResponse = {
  errorcode?: number;
  msg?: string;
  data?: { hitCount?: number; oppHits?: SearchHit[] };
};

const SEARCH_URL = "https://api.grants.gov/v1/api/search2";
const DETAIL_BASE = "https://www.grants.gov/search-results-detail/";
const SOURCE_NAME = "Grants.gov" as const;
const USER_AGENT = "Tenderpath grant import (+https://tenderpath.me)";

// Targeted passes biased toward internationally-relevant opportunities. State
// (DOS) carries the embassy/mission grants; the keyword passes catch foreign-
// scoped programs across other agencies (USDA-FAS, CDC global health, etc.).
const AGENCY_PASSES = ["DOS"] as const;
const KEYWORD_PASSES = [
  "international development", "global health security", "food security",
  "humanitarian assistance", "democracy human rights", "refugee", "civil society",
  "religious freedom", "Africa", "Middle East", "trafficking in persons",
] as const;

// Developing regions whose presence makes a row in-scope even without a named country.
const DEV_REGIONS = new Set([
  "Middle East & North Africa", "Sub-Saharan Africa", "South & Southeast Asia",
  "Latin America & Caribbean", "Eastern Europe & Central Asia",
]);

// High-income / donor countries are funders or exchange partners here, not the
// beneficiary geography, so they do not make a row in-scope.
const DONOR_EXCLUDE = new Set([
  "United States", "Italy", "Germany", "France", "United Kingdom", "Japan", "Spain",
  "Canada", "Switzerland", "Netherlands", "Sweden", "Norway", "Belgium", "Austria",
  "Finland", "Denmark", "Australia", "Republic of Korea", "South Korea", "Luxembourg",
  "Ireland", "New Zealand", "Singapore", "Israel", "Qatar", "United Arab Emirates", "Kuwait",
]);

const COUNTRY_REGION = new Map(ALL_COUNTRIES.map((row) => [row.country, row.region]));

const REGION_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(mena|middle east|north africa|near east)\b/i, "Middle East & North Africa"],
  [/\b(sub-saharan africa|west africa|east africa|horn of africa|sahel|\bafrica\b)\b/i, "Sub-Saharan Africa"],
  [/\b(southeast asia|south asia|indo-pacific)\b/i, "South & Southeast Asia"],
  [/\b(central asia|eastern europe|western balkans|south caucasus)\b/i, "Eastern Europe & Central Asia"],
  [/\b(latin america|caribbean|central america|western hemisphere)\b/i, "Latin America & Caribbean"],
];

type Geo = { countries: string[]; country: string | null; region: string | null };
const GLOBAL_GEO: Geo = { countries: ["Global"], country: "Global", region: "Global" };

function classifyCountries(countries: string[]): Geo {
  if (countries.length === 0) return GLOBAL_GEO;
  if (countries.length === 1) {
    return { countries, country: countries[0], region: COUNTRY_REGION.get(countries[0]) ?? null };
  }
  const regions = new Set(countries.map((c) => COUNTRY_REGION.get(c)).filter(Boolean) as string[]);
  return { countries, country: null, region: regions.size === 1 ? [...regions][0] : "Multi-country" };
}

function detectCountries(text: string): string[] {
  const out: string[] = [];
  for (const { country } of ALL_COUNTRIES) {
    const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) out.push(country);
  }
  if (/\bsyrian arab republic\b/i.test(text) && !out.includes("Syria")) out.push("Syria");
  return out;
}

function detectRegion(text: string): string | null {
  for (const [pattern, region] of REGION_KEYWORDS) {
    if (pattern.test(text)) return region;
  }
  return null;
}

/**
 * Two-tier geography. Title+agency is authoritative ("U.S. Mission to <country>"
 * names the real target; "U.S./U.S. Mission" does not match "United States"). The
 * synopsis is a fallback that drops the U.S. funder when a foreign target appears.
 */
function resolveGeo(primary: string, secondary: string): Geo {
  const primaryCountries = detectCountries(primary);
  if (primaryCountries.length) return classifyCountries(primaryCountries);
  const primaryRegion = detectRegion(primary);
  if (primaryRegion) return { countries: [primaryRegion], country: null, region: primaryRegion };

  const secondaryCountries = detectCountries(secondary);
  const foreign = secondaryCountries.filter((c) => c !== "United States");
  if (foreign.length) return classifyCountries(foreign);
  const secondaryRegion = detectRegion(secondary);
  if (secondaryRegion) return { countries: [secondaryRegion], country: null, region: secondaryRegion };
  if (secondaryCountries.includes("United States")) return classifyCountries(["United States"]);
  return GLOBAL_GEO;
}

/**
 * The ingestion gate: keep only rows targeted at a specific developing-world
 * country or a developing region. Drops U.S.-domestic, donor-country, and
 * unknown-geography rows.
 */
function internationallyRelevant(geo: Geo): boolean {
  if (geo.countries.some((c) => c !== "Global" && !DONOR_EXCLUDE.has(c))) return true;
  if (geo.region && DEV_REGIONS.has(geo.region)) return true;
  return false;
}

function listDate(value: string | null | undefined): string | null {
  const m = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

function isFutureDate(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(`${iso}T23:59:59Z`).getTime();
  return !Number.isNaN(t) && t >= Date.now();
}

function openDateValue(hit: SearchHit): number {
  const iso = listDate(hit.openDate);
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

async function search2(body: Record<string, unknown>): Promise<SearchHit[]> {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Grants.gov search2 failed: HTTP ${response.status}`);
  const data = (await response.json()) as SearchResponse;
  if (typeof data.errorcode === "number" && data.errorcode !== 0) {
    throw new Error(`Grants.gov search2 error ${data.errorcode}: ${data.msg ?? "unknown"}`);
  }
  return data.data?.oppHits ?? [];
}

async function collectHits(rows: number): Promise<SearchHit[]> {
  const byId = new Map<string, SearchHit>();
  const passes: Array<Record<string, unknown>> = [
    ...AGENCY_PASSES.map((agencies) => ({ rows, oppStatuses: "posted", agencies })),
    ...KEYWORD_PASSES.map((keyword) => ({ rows: Math.min(rows, 100), oppStatuses: "posted|forecasted", keyword })),
  ];
  for (const body of passes) {
    try {
      for (const hit of await search2(body)) {
        if (hit.id && !byId.has(hit.id)) byId.set(hit.id, hit);
      }
    } catch (err) {
      console.warn("[tp:grants:grants_gov:pass_failed]", { body, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return [...byId.values()];
}

// Wall-clock budget: the grant cron passes a shared fetch deadline so per-row detail
// enrichment stops before the 300s lambda limit instead of 504-ing it. fetchGrantsGovDetail
// has no timeout of its own, so when we do call it we also bound it to the remaining budget.
const overBudget = (deadlineAt?: number): boolean => deadlineAt !== undefined && Date.now() >= deadlineAt;
const detailTimeoutMs = (deadlineAt?: number): number =>
  deadlineAt === undefined ? 10000 : Math.max(1000, Math.min(10000, deadlineAt - Date.now()));

export async function toGrant(hit: SearchHit, opts: { deadlineAt?: number } = {}): Promise<GrantsGovGrant | null> {
  if (!hit.id || !hit.title) return null;
  const listDeadline = listDate(hit.closeDate);

  // Past the shared budget, skip the detail call and fall back to list data (close date
  // + title/agency geo). The row still imports; it just isn't enriched this run.
  let patch: ReturnType<typeof grantsGovDetailPatch> | null = null;
  if (!overBudget(opts.deadlineAt)) {
    try {
      patch = grantsGovDetailPatch(await fetchGrantsGovDetail(hit.id, AbortSignal.timeout(detailTimeoutMs(opts.deadlineAt))));
    } catch (err) {
      console.warn("[tp:grants:grants_gov:detail_failed]", { oppId: hit.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const deadline = patch?.deadline ?? listDeadline;
  if (!isFutureDate(deadline)) return null; // matcher requires an open, future deadline

  const geo = resolveGeo(`${hit.title} ${hit.agency ?? ""}`, patch?.description ?? "");
  return {
    reference_id: `GRANTS_GOV:${hit.id}`,
    title: hit.title.slice(0, 500),
    agency: hit.agency?.trim() || "U.S. Federal Government",
    deadline,
    sector: patch?.sector ?? normalizeSector("", hit.title, "")[0] ?? null,
    themes: patch?.themes ?? [],
    eligible_org_types: patch?.eligible_org_types ?? [],
    countries: geo.countries,
    country: geo.country,
    region: geo.region,
    description: patch?.description ?? null,
    value_range: patch?.value_range ?? null,
    source_name: SOURCE_NAME,
    source_url: `${DETAIL_BASE}${hit.id}`,
    status: "open",
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export async function fetchGrantsGovGrants(
  limit = 100,
  opts: { deadlineAt?: number } = {},
): Promise<{ grants: GrantsGovGrant[]; totalScanned: number; detailSkipped: number }> {
  const hits = await collectHits(300);
  // Hard geo gate up front on the cheap title+agency signal, before any detail call.
  const foreign = hits.filter((h) => internationallyRelevant(resolveGeo(`${h.title ?? ""} ${h.agency ?? ""}`, "")));
  const ranked = foreign.sort((a, b) => openDateValue(b) - openDateValue(a)).slice(0, limit);
  let detailSkipped = 0;
  const mapped = await mapPool(ranked, 6, (hit) => {
    if (overBudget(opts.deadlineAt)) detailSkipped++;
    return toGrant(hit, opts);
  });
  if (detailSkipped) console.warn("[tp:grants:grants_gov:budget_truncated]", { detailSkipped, ranked: ranked.length });
  return {
    grants: mapped.filter((g): g is GrantsGovGrant => !!g),
    totalScanned: hits.length,
    detailSkipped,
  };
}
