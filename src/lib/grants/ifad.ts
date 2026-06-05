/**
 * IFAD — International Fund for Agricultural Development calls for proposals.
 *
 * Why this source: IFAD funds agriculture, rural development, and food security
 * across MENA and Sub-Saharan Africa — exactly the "SME MENA agriculture / food"
 * grant gap the matcher benchmark flags and that Devex/DevelopmentAid underserve.
 * The public calls listing (https://www.ifad.org/en/call-for-proposals) is a
 * server-rendered Liferay page whose cards carry the title, a real description,
 * the posted date, and the call URL — all parseable without a browser.
 *
 * The one field the listing omits is the submission DEADLINE, which lives on each
 * call's detail page. Those detail pages sit behind Akamai bot protection (403 to
 * a plain fetch), so deadline enrichment routes through the shared Cloudflare
 * Browser Rendering worker — the same pattern as UNGM / IOM / ADB. The grant
 * matcher requires `deadline >= CURRENT_DATE`, so a row without a resolvable future
 * deadline is dropped rather than shown. That makes the source fail safe: with no
 * worker configured (e.g. local dev) it yields zero rows instead of dated-wrong
 * ones; in production the worker resolves real deadlines and rows flow.
 *
 * `parseIfadListing` and `extractIfadDeadline` are exported as pure units so the
 * listing parse can be verified against the live listing and the deadline parser
 * against known IFAD deadline phrasings, independent of worker access.
 */
import { ALL_COUNTRIES } from "@/lib/countries";
import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";
import { browserAvailable, fetchViaBrowser } from "@/lib/crawlers/_browser";
import { fetchWithTimeout, withRetry } from "@/lib/crawlers/types";

export type IfadGrant = {
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
  source_name: "IFAD";
  source_url: string;
  status: "open";
};

export interface IfadListingCard {
  slug: string;
  url: string;
  title: string;
  description: string | null;
  postedDate: string | null;
}

const LISTING_URL = "https://www.ifad.org/en/call-for-proposals";
const DETAIL_BASE = "https://www.ifad.org/en/w/calls-for-proposal/";
const SOURCE_NAME = "IFAD" as const;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Governance / administrative "calls" that are not grant opportunities.
const NON_GRANT_RE = /\b(external chair|call for nominations?|governing council|replenishment|external auditor|board of directors)\b/i;

// IFAD beneficiary geography is the developing country in the call; donor /
// diaspora-origin countries that show up as funders are not the target.
const DONOR_EXCLUDE = new Set([
  "Italy", "Germany", "France", "United Kingdom", "United States", "Japan", "Spain",
  "Canada", "Switzerland", "Netherlands", "Sweden", "Norway", "Belgium", "Austria",
  "Finland", "Denmark", "Australia", "Republic of Korea", "South Korea", "Luxembourg", "Ireland",
]);

const COUNTRY_REGION = new Map(ALL_COUNTRIES.map((row) => [row.country, row.region]));

const REGION_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(near east|middle east|north africa|mena)\b/i, "Middle East & North Africa"],
  [/\b(east and southern africa|west and central africa|west africa|sub-saharan|sahel|horn of africa|\bafrica\b)\b/i, "Sub-Saharan Africa"],
  [/\b(asia and the pacific|south[- ]?east asia|mekong|south asia)\b/i, "South & Southeast Asia"],
  [/\b(latin america|the caribbean|central america)\b/i, "Latin America & Caribbean"],
  [/\b(central asia|eastern europe|western balkans)\b/i, "Eastern Europe & Central Asia"],
];

const THEME_RULES: Array<[RegExp, string[]]> = [
  [/\b(agricultur|agri-?food|farm|crop|agribusiness|value chain|macadamia|sesame|nut)\b/i, ["agriculture", "value chains", "food security"]],
  [/\b(rural|smallholder|peasant|land)\b/i, ["rural development", "livelihoods"]],
  [/\b(food security|nutrition|food systems)\b/i, ["food security", "nutrition"]],
  [/\b(remittance|diaspora|financial inclusion|microfinance|fintech)\b/i, ["financial inclusion", "remittances", "livelihoods"]],
  [/\b(climate|resilien|environment|regenerative|biodiversity|natural resources)\b/i, ["climate", "resilience", "environment"]],
  [/\b(livestock|fisher|aquacultur|pastoral|one health)\b/i, ["livestock", "agriculture"]],
  [/\b(women|gender|youth)\b/i, ["gender", "youth", "economic empowerment"]],
  [/\b(digital|ai\b|artificial intelligence|data|technolog|innovation)\b/i, ["digital", "innovation", "technology"]],
  [/\b(water|irrigation|sanitation)\b/i, ["water", "irrigation"]],
  [/\b(indigenous)\b/i, ["indigenous peoples", "inclusion"]],
];

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#039;": "'", "&#39;": "'", "&nbsp;": " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? " ");
}

function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(?:p|li|div|h\d|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

// ----- geography -----

function detectCountries(text: string): string[] {
  const out: string[] = [];
  for (const { country } of ALL_COUNTRIES) {
    if (DONOR_EXCLUDE.has(country)) continue;
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

function ifadGeo(text: string): { countries: string[]; country: string | null; region: string | null } {
  const countries = detectCountries(text);
  if (countries.length === 1) {
    return { countries, country: countries[0], region: COUNTRY_REGION.get(countries[0]) ?? null };
  }
  if (countries.length > 1) {
    const regions = new Set(countries.map((c) => COUNTRY_REGION.get(c)).filter(Boolean) as string[]);
    return { countries, country: null, region: regions.size === 1 ? [...regions][0] : "Multi-country" };
  }
  const region = detectRegion(text);
  if (region) return { countries: [region], country: null, region };
  return { countries: ["Global"], country: "Global", region: "Global" };
}

function themesFor(text: string): string[] {
  const themes: string[] = [];
  for (const [pattern, values] of THEME_RULES) {
    if (pattern.test(text)) themes.push(...values);
  }
  return unique(themes.length ? themes : ["agriculture", "rural development"]);
}

function orgTypesFor(text: string): string[] {
  const out: string[] = [];
  if (/\b(private sector|company|companies|enterprise|business|agribusiness|fintech|firm|for-profit)\b/i.test(text)) out.push("company");
  if (/\b(research|universit|academ|institute|knowledge|think tank)\b/i.test(text)) out.push("research_institution", "education_institution");
  if (/\b(cooperative|co-op|farmer organization|producer organization|farmer organisation|producers' organization)\b/i.test(text)) out.push("cooperative");
  if (/\b(civil society|community|ngo|non-governmental|grassroots|association|foundation)\b/i.test(text)) out.push("NGO", "civil_society");
  // IFAD calls are broadly open to implementing partners; default to a useful set.
  return unique(out.length ? out : ["NGO", "company", "research_institution", "civil_society"]);
}

function valueRange(text: string): string | null {
  const m = text.match(/(?:up to\s*)?(USD|US\$|EUR|€|\$)\s?([\d,]{4,}(?:\.\d+)?)(?:\s?(?:-|to|–)\s?(?:USD|US\$|EUR|€|\$)?\s?([\d,]{4,}))?/i);
  if (!m) return null;
  const cur = /eur|€/i.test(m[1]) ? "EUR" : "USD";
  return m[3] ? `${cur} ${m[2]}-${m[3]}` : `${cur} ${m[2]}`;
}

// ----- deadline extraction (exported for unit testing) -----

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthIdx(name: string): number | null {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? null;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isFuture(iso: string): boolean {
  return new Date(`${iso}T23:59:59Z`).getTime() >= Date.now();
}

// A year-less date ("16 August") resolves to this year, or next year if already past.
function resolveYearless(m: number, d: number): string | null {
  const year = new Date().getUTCFullYear();
  const thisYear = isoDate(year, m, d);
  if (thisYear && isFuture(thisYear)) return thisYear;
  return isoDate(year + 1, m, d);
}

function collectDates(text: string): Array<{ pos: number; iso: string }> {
  const t = text.replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  const out: Array<{ pos: number; iso: string }> = [];
  const push = (pos: number, iso: string | null) => { if (iso) out.push({ pos, iso }); };

  // "25 May 2026" / "16 August"
  for (const m of t.matchAll(/\b(\d{1,2})(?!\d)\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?\b/g)) {
    const mi = monthIdx(m[2]); if (!mi) continue;
    const d = Number(m[1]); const y = m[3] ? Number(m[3]) : null;
    push(m.index ?? 0, y ? isoDate(y, mi, d) : resolveYearless(mi, d));
  }
  // "May 16, 2026" / "August 16"
  for (const m of t.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?!\d),?\s*(\d{4})?\b/g)) {
    const mi = monthIdx(m[1]); if (!mi) continue;
    const d = Number(m[2]); const y = m[3] ? Number(m[3]) : null;
    push(m.index ?? 0, y ? isoDate(y, mi, d) : resolveYearless(mi, d));
  }
  // ISO "2026-05-25"
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(m.index ?? 0, isoDate(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  // numeric "05/01/2026" — DD/MM and MM/DD are ambiguous; prefer the future reading.
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    const opts = [isoDate(y, b, a), isoDate(y, a, b)].filter((x): x is string => !!x);
    const fut = opts.find(isFuture) ?? opts[0];
    push(m.index ?? 0, fut ?? null);
  }
  return out;
}

export function extractIfadDeadline(text: string): string | null {
  if (!text) return null;
  const dates = collectDates(text);
  const future = dates.filter((d) => isFuture(d.iso));
  if (!future.length) return null;

  // Prefer a future date that closely follows a deadline cue.
  const cue = /\b(deadline|closing date|submission|submitted|submit|apply by|application|no later than|due date|due by|closes?|closing)\b/gi;
  let best: { dist: number; iso: string } | null = null;
  for (const m of text.matchAll(cue)) {
    const kpos = m.index ?? 0;
    for (const d of future) {
      const dist = d.pos - kpos;
      if (dist >= 0 && dist < 180 && (!best || dist < best.dist)) best = { dist, iso: d.iso };
    }
  }
  if (best) return best.iso;
  // Fallback: the soonest upcoming date. A submission deadline is near-term; a
  // far-future date on the page is more likely a project milestone than a closing date.
  return future.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())[0].iso;
}

// ----- listing parse (exported for unit testing) -----

export function parseIfadListing(html: string): IfadListingCard[] {
  const cards: IfadListingCard[] = [];
  const seen = new Set<string>();
  const segments = html.split(/class="general-feature-card/).slice(1);

  for (const segRaw of segments) {
    const seg = segRaw.slice(0, 2400);
    const href = seg.match(/href="(https:\/\/www\.ifad\.org\/en\/w\/calls-for-proposal\/([^"#?]+))[^"]*"/i);
    if (!href) continue;
    const slug = href[2];
    if (seen.has(slug)) continue;

    const lines = stripHtml(seg)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const dateLine = lines.find((l) => /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/.test(l)) ?? null;
    const postedDate = dateLine?.match(/\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/)?.[0] ?? null;
    // The card opens with a bare "Call for proposals" category label; the real
    // title is the longer call/request/IFAD line (usually with a colon).
    const title = lines
      .filter((l) => /^(call for|request for|ifad calls)/i.test(l) && l.toLowerCase() !== "call for proposals")
      .sort((a, b) => b.length - a.length)[0] ?? null;
    if (!title) continue;
    const description = lines
      .filter((l) => l !== title && l !== dateLine && l.toLowerCase() !== "call for proposals" && !/^read\b/i.test(l) && l.length > 40)
      .sort((a, b) => b.length - a.length)[0] ?? null;

    seen.add(slug);
    cards.push({
      slug,
      url: `${DETAIL_BASE}${slug}`,
      title: title.replace(/\s+/g, " ").slice(0, 500),
      description: description ?? null,
      postedDate,
    });
  }
  return cards;
}

export function toGrant(card: IfadListingCard, deadline: string, detailText: string | null): IfadGrant {
  const text = `${card.title} ${card.description ?? ""} ${detailText ?? ""}`;
  const geo = ifadGeo(`${card.title} ${card.description ?? ""}`);
  const description = card.description && card.description.length >= 80
    ? card.description
    : stripHtml(detailText).split("\n").find((l) => l.length >= 120)?.slice(0, 1800) ?? card.description;

  return {
    reference_id: `IFAD:${card.slug}`,
    title: card.title,
    agency: "IFAD",
    deadline,
    sector: normalizeSector("", card.title, description ?? "")[0] ?? "agriculture",
    themes: themesFor(text),
    eligible_org_types: orgTypesFor(text),
    countries: geo.countries,
    country: geo.country,
    region: geo.region,
    description: description ?? null,
    value_range: valueRange(text),
    source_name: SOURCE_NAME,
    source_url: card.url,
    status: "open",
  };
}

// Wall-clock budget: the grant cron passes a shared fetch deadline so IFAD's
// browser-worker calls (listing + per-row detail, ~90s each) stop before the 300s
// lambda limit instead of running to the kill and 504-ing every source's writes.
const overBudget = (deadlineAt?: number): boolean => deadlineAt !== undefined && Date.now() >= deadlineAt;
const budgetMs = (deadlineAt: number | undefined, cap: number): number =>
  deadlineAt === undefined ? cap : Math.max(1000, Math.min(cap, deadlineAt - Date.now()));

async function fetchListingHtml(deadlineAt?: number): Promise<string> {
  const direct = await fetchWithTimeout(LISTING_URL, { headers: HEADERS }, budgetMs(deadlineAt, 25000)).catch(() => null);
  if (direct?.ok) {
    const body = await direct.text();
    if (/general-feature-card/.test(body)) return body;
  }
  if (browserAvailable()) {
    const rendered = await fetchViaBrowser(LISTING_URL, {
      headers: HEADERS,
      mode: "navigate",
      waitForSelector: ".general-feature-card a[href*='calls-for-proposal']",
      waitAfterNav: 800,
      timeoutMs: budgetMs(deadlineAt, 90000),
    });
    if (rendered.ok && /general-feature-card/.test(rendered.body)) return rendered.body;
    throw new Error(`IFAD listing browser fallback ${rendered.status}: ${rendered.body.slice(0, 160)}`);
  }
  throw new Error(`IFAD listing unavailable (direct ${direct?.status ?? "error"}; no browser worker)`);
}

// Detail pages are Akamai-protected; only the browser worker can read them.
async function fetchDetailText(url: string, deadlineAt?: number): Promise<string | null> {
  if (!browserAvailable()) return null;
  try {
    const rendered = await fetchViaBrowser(url, {
      headers: HEADERS,
      mode: "navigate",
      waitForSelector: "main, article, .journal-content-article",
      waitAfterNav: 600,
      timeoutMs: budgetMs(deadlineAt, 90000),
    });
    if (rendered.ok && !/Access Denied|edgesuite|akamai/i.test(rendered.body)) {
      return stripHtml(rendered.body);
    }
  } catch {
    /* fail safe: caller drops rows without a deadline */
  }
  return null;
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

export async function fetchIfadGrants(
  limit = 15,
  opts: { deadlineAt?: number } = {},
): Promise<{ grants: IfadGrant[]; totalScanned: number; skipped: number }> {
  const html = await withRetry(() => fetchListingHtml(opts.deadlineAt), 2);
  const cards = parseIfadListing(html).filter((c) => !NON_GRANT_RE.test(c.title));
  // Listing is posted-date descending, so the newest (most likely still open) calls come first.
  const candidates = cards.slice(0, limit);

  let skipped = 0;
  const mapped = await mapPool(candidates, 3, async (card) => {
    if (overBudget(opts.deadlineAt)) { skipped++; return null; } // budget spent — stop enriching
    const detailText = await fetchDetailText(card.url, opts.deadlineAt);
    const deadline = extractIfadDeadline(`${detailText ?? ""} ${card.description ?? ""}`);
    if (!deadline) return null; // matcher requires a future deadline; fail safe
    return toGrant(card, deadline, detailText);
  });

  if (skipped) console.warn("[tp:grants:ifad:budget_truncated]", { skipped, enriched: mapped.filter(Boolean).length });
  return {
    grants: mapped.filter((g): g is IfadGrant => !!g),
    totalScanned: cards.length,
    skipped,
  };
}
