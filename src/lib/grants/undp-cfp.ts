import { ALL_COUNTRIES } from "@/lib/countries";
import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";
import { fetchWithTimeout, withRetry } from "@/lib/crawlers/types";
import { crawlUNDP } from "@/lib/crawlers/undp";

export type UndpCfpGrant = {
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
  source_name: "UNDP CFP";
  source_url: string;
  status: "open";
};

const SOURCE_NAME = "UNDP CFP" as const;
const COUNTRY_TO_REGION = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.region]));
const COUNTRY_CANONICAL = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.country]));

const INCLUDE_RE = /\b(cfp|call for proposals?|call for proposal|small grants?|grant support|legal aid services|women-led|women owned|micro finance institution|civil society|community[- ]based)\b/i;
const EXCLUDE_RE = /\b(lead consultant|individual consultants?|independent assessors?|assessment\/review|automation of grant accounting|grant accounting|grant reporting|production of videos|roster|consultant:|national consultant|international consultant)\b/i;

const THEME_RULES: Array<[RegExp, string[]]> = [
  [/\b(wash|water|sanitation|hygiene|wastewater)\b/i, ["wash", "water", "sanitation"]],
  [/\b(climate|environment|environmental|gef|gcf|sgp|biodiversity|ecosystem|resilien|natural resources)\b/i, ["climate", "environment", "biodiversity", "resilience"]],
  [/\b(women|gender|sme|enterprise|business development|micro finance|livelihood|employment|economic empowerment)\b/i, ["livelihoods", "economic empowerment", "gender", "civil society"]],
  [/\b(legal aid|justice|rule of law|rights|vulnerable|disabilities|plwds)\b/i, ["rule of law", "governance", "civil society", "inclusion"]],
  [/\b(health|hiv|tb|medical|clinical)\b/i, ["health", "public health", "medical"]],
  [/\b(education|training|capacity building|skills|youth)\b/i, ["education", "training", "capacity building", "youth"]],
];

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#039;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

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
    .replace(/<\/(?:p|li|div|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicalCountry(raw: string | null | undefined): string | null {
  if (!raw?.trim() || raw.toLowerCase() === "global") return null;
  const lowered = raw.trim().toLowerCase();
  return COUNTRY_CANONICAL.get(lowered) ?? raw.trim().replace(/\b\w/g, (m) => m.toUpperCase());
}

function themesFor(text: string): string[] {
  const themes: string[] = [];
  for (const [pattern, values] of THEME_RULES) {
    if (pattern.test(text)) themes.push(...values);
  }
  return unique(themes.length ? themes : ["civil society", "capacity building"]);
}

function valueRange(text: string): string | null {
  const smallGrant = text.match(/\b(?:usd|us\$|\$)\s?([\d,]+(?:\.\d+)?)\s?(?:-|to|–)\s?(?:usd|us\$|\$)?\s?([\d,]+(?:\.\d+)?)/i);
  if (smallGrant) return `$${smallGrant[1]}-$${smallGrant[2]}`;
  return null;
}

async function fetchDetailHtml(url: string): Promise<string> {
  const resp = await withRetry(() => fetchWithTimeout(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "TenderPath/1.0 (+https://www.tenderpath.me)",
    },
  }, 30000), 2);
  if (!resp.ok) throw new Error(`UNDP CFP detail HTTP ${resp.status}`);
  return resp.text();
}

function extractIntroduction(html: string): string | null {
  const intro = /<h2>\s*Introduction\s*<\/h2>([\s\S]*?)(?:<h2>|<section|<footer|$)/i.exec(html)?.[1];
  const text = stripHtml(intro)
    .replace(/\bPlease indicate whether you intend to submit a bid[\s\S]*$/i, "")
    .trim();
  return text.length >= 80 ? text.slice(0, 1800) : null;
}

function synthesizeDescription(args: {
  title: string;
  agency: string;
  country: string | null;
  deadline: string | null;
  intro: string | null;
}): string {
  const pieces = [
    `${args.agency} call for proposals in ${args.country ?? "Global"}: ${args.title}.`,
    args.deadline ? `Submission deadline: ${args.deadline.slice(0, 10)}.` : null,
    args.intro,
  ];
  return unique(pieces).join(" ").slice(0, 2200);
}

function isGrantLike(title: string, opportunityType: string | null | undefined): boolean {
  const text = `${title} ${opportunityType ?? ""}`;
  if (!INCLUDE_RE.test(text)) return false;
  if (EXCLUDE_RE.test(text) && !/\bcfp\b|call for proposals?/i.test(text)) return false;
  return true;
}

export async function fetchUndpCfpGrants(limit = 50): Promise<{
  grants: UndpCfpGrant[];
  totalScanned: number;
}> {
  const result = await crawlUNDP();
  if (result.status !== "success") {
    throw new Error(`UNDP CFP source failed: ${result.error ?? "unknown error"}`);
  }

  const grants: UndpCfpGrant[] = [];
  for (const tender of result.tenders) {
    if (grants.length >= limit) break;
    if (!isGrantLike(tender.title, tender.opportunity_type)) continue;
    if (tender.deadline && new Date(tender.deadline).getTime() < Date.now()) continue;
    if (!tender.source_url) continue;

    const country = canonicalCountry(tender.country);
    const region = country ? COUNTRY_TO_REGION.get(country.toLowerCase()) ?? null : null;
    const detailHtml = await fetchDetailHtml(tender.source_url).catch(() => "");
    const intro = detailHtml ? extractIntroduction(detailHtml) : null;
    const description = tender.description?.trim()
      || synthesizeDescription({
        title: tender.title,
        agency: tender.agency || "UNDP",
        country,
        deadline: tender.deadline,
        intro,
      });
    const text = `${tender.title} ${description ?? ""}`;
    const sector = normalizeSector("", tender.title, description)[0] ?? null;

    grants.push({
      reference_id: tender.reference_id.replace(/^UNDP-/, "UNDP_CFP:"),
      title: tender.title,
      agency: "UNDP",
      deadline: tender.deadline,
      sector,
      themes: themesFor(text),
      eligible_org_types: ["NGO", "civil_society", "community_based_organization", "company"],
      countries: country ? [country] : ["Global"],
      country: country ?? "Global",
      region: region ?? (country ? null : "Global"),
      description,
      value_range: valueRange(text),
      source_name: SOURCE_NAME,
      source_url: tender.source_url,
      status: "open",
    });
  }

  return { grants, totalScanned: result.tenders.length };
}
