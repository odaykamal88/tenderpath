import { ALL_COUNTRIES } from "@/lib/countries";
import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";
import { fetchWithTimeout, withRetry } from "@/lib/crawlers/types";

export type UnWomenCfpGrant = {
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
  source_name: "UN Women CFP";
  source_url: string;
  status: "open";
};

type CurrentCall = {
  title: string;
  source_url: string;
  deadline: string | null;
};

type Detail = {
  title: string | null;
  description: string | null;
  deadline: string | null;
  countries: string[];
  value_range: string | null;
};

const SOURCE_NAME = "UN Women CFP" as const;
const LIST_URL = process.env.UNWOMEN_CFP_URL ?? "https://www.unwomen.org/en/about-us/programme-implementation";
const COUNTRY_TO_REGION = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.region]));
const COUNTRY_CANONICAL = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.country]));
const COUNTRY_NAMES = [...COUNTRY_CANONICAL.keys()].sort((a, b) => b.length - a.length);

const THEME_RULES: Array<[RegExp, string[]]> = [
  [/\b(women|woman|girls?|gender|gbv|violence against women|domestic violence|empowerment|feminist)\b/i, ["gender", "women", "gender equality", "protection"]],
  [/\b(livelihood|employment|entrepreneur|enterprise|business support|economic empowerment|jobs?|skills?)\b/i, ["livelihoods", "economic empowerment", "skills", "jobs"]],
  [/\b(civil society|cso|ngo|community[- ]based|grassroots|consortia|responsible part(?:y|ies))\b/i, ["civil society", "partnerships", "capacity building"]],
  [/\b(governance|budgeting|public finance|local public authorities|institutional|leadership)\b/i, ["governance", "public finance", "leadership"]],
  [/\b(recovery|resilien|peace|conflict|humanitarian|crisis|displaced|refugee)\b/i, ["resilience", "peacebuilding", "humanitarian", "protection"]],
  [/\b(climate|water|environment|sustainab|care economy)\b/i, ["climate", "environment", "care economy"]],
  [/\b(education|training|capacity building|learning|awareness)\b/i, ["education", "training", "capacity building"]],
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

function toISO(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = /(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/.exec(raw);
  if (m) {
    const month = months[m[2].toLowerCase()];
    if (month !== undefined) {
      return new Date(Date.UTC(Number(m[3]), month, Number(m[1]), 23, 59, 59)).toISOString();
    }
  }
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return null;
}

function extractMeta(html: string, property: string): string | null {
  const re = new RegExp(`<meta\\s+(?:name|property)=["']${property}["']\\s+content=["']([^"']+)["']`, "i");
  const m = re.exec(html);
  return m ? decodeEntities(m[1]).trim() : null;
}

function absoluteUrl(raw: string): string {
  if (raw.startsWith("http")) return raw;
  return new URL(raw, LIST_URL).toString();
}

function parseCurrentCalls(html: string): CurrentCall[] {
  const block = /<div id="block-current-calls"[\s\S]*?(?=<\/main>|<div id="block-|<footer|$)/i.exec(html)?.[0] ?? html;
  const itemRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const out: CurrentCall[] = [];
  const seen = new Set<string>();

  let item: RegExpExecArray | null;
  while ((item = itemRe.exec(block)) !== null) {
    const inner = item[1];
    const link = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    if (!link) continue;
    const title = stripHtml(link[2]);
    if (!/\b(cfp|call for proposals?|call for proposal)\b/i.test(title)) continue;
    const sourceUrl = absoluteUrl(decodeEntities(link[1]));
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const deadlineRaw = /<time[^>]*>([\s\S]*?)<\/time>/i.exec(inner)?.[1]
      ?? /Submission deadline:\s*<\/span>\s*([\s\S]{0,120})/i.exec(inner)?.[1];

    out.push({
      title,
      source_url: sourceUrl,
      deadline: toISO(stripHtml(deadlineRaw)),
    });
  }
  return out;
}

function extractBody(html: string): string | null {
  const h1End = html.search(/<\/h1>/i);
  const searchFrom = h1End > 0 ? h1End : 0;
  const relativeStart = html.slice(searchFrom).search(/field--name-body/i);
  if (relativeStart < 0) return null;
  const rest = html.slice(searchFrom + relativeStart);
  const end = rest.search(/field--name-field-attachments|field--name-field-builder|<aside|<footer/i);
  const body = end > 0 ? rest.slice(0, end) : rest.slice(0, 6000);
  const text = stripHtml(body).replace(/^field field--name-body[^\n]+/i, "").trim();
  return text.length >= 80 ? text.slice(0, 3000) : null;
}

function valueRange(text: string): string | null {
  const range = /\b(?:usd|us\$|\$)\s?([\d,]+(?:\.\d+)?)\s?(?:-|to|–|and a maximum of)\s?(?:usd|us\$|\$)?\s?([\d,]+(?:\.\d+)?)/i.exec(text);
  if (range) return `$${range[1].replace(/,$/, "")}-$${range[2].replace(/,$/, "")}`;
  const amount = /\b(?:budget request|maximum|up to|grant amount)[^.]{0,80}?(?:usd|us\$|\$)\s?([\d,]+(?:\.\d+)?)/i.exec(text);
  return amount ? `Up to $${amount[1].replace(/,$/, "")}` : null;
}

function countriesFor(text: string, url: string): string[] {
  const haystack = `${text} ${url}`.toLowerCase();
  const countries: string[] = [];
  if (/\bafg\b|afghanistan/i.test(haystack)) countries.push("Afghanistan");
  if (/\bmda\b|moldova/i.test(haystack)) countries.push("Moldova");
  if (/\bukr\b|ukraine/i.test(haystack)) countries.push("Ukraine");
  for (const country of COUNTRY_NAMES) {
    const canonical = COUNTRY_CANONICAL.get(country);
    if (!canonical) continue;
    const pattern = new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(haystack)) countries.push(canonical);
  }
  return unique(countries);
}

function themesFor(text: string): string[] {
  const themes: string[] = [];
  for (const [pattern, values] of THEME_RULES) {
    if (pattern.test(text)) themes.push(...values);
  }
  return unique(themes.length ? themes : ["gender", "civil society", "partnerships"]);
}

function eligibleOrgTypesFor(text: string): string[] {
  const orgs = ["NGO", "civil_society"];
  if (/\b(consortia|company|companies|private sector|enterprise|entrepreneur)\b/i.test(text)) orgs.push("company");
  if (/\bgovernment|public authorit|municipalit|ministry|local public authorities|lpa\b/i.test(text)) orgs.push("government_entity");
  if (/\bun agenc|intergovernmental|international organization\b/i.test(text)) orgs.push("international_organization");
  return unique(orgs);
}

function sectorFor(title: string, description: string | null): SectorSlug | null {
  const text = `${title} ${description ?? ""}`;
  const sector = normalizeSector("", title, description)[0] ?? null;
  if (!sector) return "consulting";
  if (sector === "education" || sector === "healthcare") return sector;
  // UN Women CFP rows are partner-programme opportunities, not commodity
  // procurements. Keep accidental terms like "recovery", "center", or
  // "business support" from classifying them as works/logistics tenders.
  if (/\b(cfp|call for proposals?|responsible part(?:y|ies)|civil society|cso|ngo|partner agreement)\b/i.test(text)) {
    return /\b(education|training|skills|capacity building|learning)\b/i.test(text)
      ? "education"
      : "consulting";
  }
  return sector;
}

function referenceId(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  return `UNWOMEN_CFP:${slug.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120)}`;
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await withRetry(() => fetchWithTimeout(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "TenderPath/1.0 (+https://www.tenderpath.me)",
    },
  }, 30000), 2);
  if (!resp.ok) throw new Error(`UN Women CFP ${url} HTTP ${resp.status}`);
  return resp.text();
}

async function fetchDetail(call: CurrentCall): Promise<Detail> {
  const html = await fetchHtml(call.source_url);
  const metaDescription = extractMeta(html, "description") ?? extractMeta(html, "og:description");
  const description = extractBody(html) ?? metaDescription;
  const title = stripHtml(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]) || extractMeta(html, "og:title");
  const deadline = toISO(/Submission deadline:\s*<\/strong>\s*<span>([^<]+)<\/span>/i.exec(html)?.[1]) ?? call.deadline;
  const text = `${title ?? call.title} ${description ?? ""}`;

  return {
    title,
    description,
    deadline,
    countries: countriesFor(text, call.source_url),
    value_range: valueRange(text),
  };
}

export async function fetchUnWomenCfpGrants(limit = 25): Promise<{
  grants: UnWomenCfpGrant[];
  totalScanned: number;
}> {
  const listHtml = await fetchHtml(LIST_URL);
  const calls = parseCurrentCalls(listHtml).slice(0, limit);
  const grants: UnWomenCfpGrant[] = [];

  for (const call of calls) {
    const detail = await fetchDetail(call).catch((): Detail => ({
      title: null,
      description: null,
      deadline: call.deadline,
      countries: countriesFor(call.title, call.source_url),
      value_range: null,
    }));
    const deadline = detail.deadline ?? call.deadline;
    if (deadline && new Date(deadline).getTime() < Date.now()) continue;

    const title = detail.title ?? call.title;
    const description = detail.description;
    const text = `${title} ${description ?? ""}`;
    const countries = detail.countries.length ? detail.countries : ["Global"];
    const country = countries.length === 1 ? countries[0] : "Global";
    const regions = unique(countries.map((c) => COUNTRY_TO_REGION.get(c.toLowerCase())));
    const region = regions.length === 1 ? regions[0] : (country === "Global" ? "Global" : regions[0] ?? null);
    const sector = sectorFor(title, description);

    grants.push({
      reference_id: referenceId(call.source_url),
      title,
      agency: "UN Women",
      deadline,
      sector,
      themes: themesFor(text),
      eligible_org_types: eligibleOrgTypesFor(text),
      countries,
      country,
      region,
      description,
      value_range: detail.value_range,
      source_name: SOURCE_NAME,
      source_url: call.source_url,
      status: "open",
    });
  }

  return { grants, totalScanned: calls.length };
}
