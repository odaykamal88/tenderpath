/**
 * MENA Arab / Islamic funders — operator-curated CSV ingest.
 *
 * IsDB (Islamic Development Bank), AFESD (Arab Fund), AGFUND, and the OPEC Fund
 * are TenderPath's genuine "unfair advantage": they fund extensively across MENA
 * and Muslim-majority countries and almost nobody aggregates them in English.
 * They are also the hardest to automate — live probes confirmed IsDB's call
 * portal (isdb-engage.org) is geo-blocked and Arabic-first, AFESD is
 * Cloudflare-gated and publishes only awarded projects, and AGFUND/OFID accept
 * ad-hoc rolling applications with no machine-readable open-calls listing. There
 * is no honest scrape path.
 *
 * So integration uses the same proven pattern as `developmentaid-npo.ts`: an
 * operator curates open calls (often translated from Arabic announcements) into a
 * CSV that this source ingests as first-class grants. That makes the MENA-funder
 * coverage a real, maintained asset instead of a brittle scraper that returns
 * zero. Drop one or more CSVs into `data/mena-grants/` and the daily grant cron
 * picks them up; with no CSV present it is a benign no-op.
 *
 * CSV schema (header row required; columns case-insensitive, order-independent):
 *   funder       e.g. "Islamic Development Bank (IsDB)", "Arab Fund (AFESD)", "AGFUND", "OPEC Fund"
 *   title        the call title (English; translate from Arabic if needed)
 *   url          the official call / announcement URL
 *   deadline     YYYY-MM-DD, DD/MM/YYYY, or DD-Mon-YYYY  (required — the matcher needs a future deadline)
 *   country      optional, e.g. "Egypt"  (single beneficiary country)
 *   region       optional, e.g. "Middle East & North Africa"
 *   sector       optional raw sector text
 *   themes       optional, ";"-separated, e.g. "climate;agriculture"
 *   eligibility  optional, ";"-separated org types, e.g. "NGO;company"
 *   value        optional value/amount text
 *   description  optional summary
 *
 * Rows without a parseable FUTURE deadline are dropped (and counted) rather than
 * shown undated — same contract the matcher enforces for every grant source.
 */
import fs from "node:fs";
import path from "node:path";
import { ALL_COUNTRIES } from "@/lib/countries";
import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";

export type MenaFunderGrant = {
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
  source_name: string;
  source_url: string;
  status: "open";
};

const DATA_DIR = path.resolve(process.cwd(), "data/mena-grants");
const COUNTRY_REGION = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.region]));
const COUNTRY_CANONICAL = new Map(ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.country]));

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const ORG_TYPE_RULES: Array<[RegExp, string[]]> = [
  [/\b(ngo|non-?profit|non-?governmental|civil society|association|charit)/i, ["NGO", "civil_society"]],
  [/\b(company|companies|private|sme|business|enterprise|firm|for-?profit|startup)/i, ["company"]],
  [/\b(research|universit|academ|institute|college)/i, ["research_institution", "education_institution"]],
  [/\b(school|education|training|vocational)/i, ["education_institution"]],
  [/\b(government|public|ministry|municipal|authorit)/i, ["government_entity"]],
  [/\b(cooperative|co-?op)/i, ["cooperative"]],
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c === "\r") { /* skip */ }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim().length > 0));
}

function parseDeadline(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // DD/MM/YYYY
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo) return null;
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${mo}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function isFuture(iso: string): boolean {
  return new Date(`${iso}T23:59:59Z`).getTime() >= Date.now();
}

function splitList(raw: string): string[] {
  return raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

function canonicalCountry(raw: string): string | null {
  const c = raw.trim().toLowerCase();
  if (!c || c === "global") return null;
  return COUNTRY_CANONICAL.get(c) ?? raw.trim().replace(/\b\w/g, (m) => m.toUpperCase());
}

function orgTypesFrom(raw: string): string[] {
  const out = new Set<string>();
  for (const token of splitList(raw)) {
    for (const [re, types] of ORG_TYPE_RULES) {
      if (re.test(token)) types.forEach((t) => out.add(t));
    }
  }
  return [...out];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function listCsvFiles(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv") && !/^template/i.test(f))
    .map((f) => path.join(DATA_DIR, f));
}

function rowToGrant(get: (k: string) => string): MenaFunderGrant | null {
  const funder = get("funder").trim();
  const title = get("title").trim();
  const url = get("url").trim();
  if (!funder || !title || !url) return null;

  const deadline = parseDeadline(get("deadline"));
  if (!deadline || !isFuture(deadline)) return null; // matcher requires a future deadline

  const country = canonicalCountry(get("country"));
  const region = get("region").trim() || (country ? COUNTRY_REGION.get(country.toLowerCase()) ?? null : null);
  const description = get("description").trim() || null;
  const themes = splitList(get("themes"));
  const orgTypes = orgTypesFrom(get("eligibility"));
  const sectorRaw = get("sector").trim();

  return {
    reference_id: `MENA_FUND:${slug(funder)}-${slug(title)}`.slice(0, 160),
    title: title.slice(0, 500),
    agency: funder,
    deadline,
    sector: normalizeSector(sectorRaw, title, description ?? "")[0] ?? null,
    themes,
    eligible_org_types: orgTypes.length ? orgTypes : ["NGO", "company", "civil_society"],
    countries: country ? [country] : region ? [region] : ["Global"],
    country: country ?? (region ? null : "Global"),
    region: region ?? (country ? null : "Global"),
    description,
    value_range: get("value").trim() || null,
    source_name: funder,
    source_url: url,
    status: "open",
  };
}

export function parseMenaFunderCsv(csv: string): { grants: MenaFunderGrant[]; scanned: number; dropped: number } {
  const grid = parseCsv(csv);
  if (grid.length < 2) return { grants: [], scanned: 0, dropped: 0 };
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const cols = ["funder", "title", "url", "deadline", "country", "region", "sector", "themes", "eligibility", "value", "description"];
  const colIdx = Object.fromEntries(cols.map((c) => [c, idx(c)]));
  if (colIdx.funder < 0 || colIdx.title < 0 || colIdx.url < 0 || colIdx.deadline < 0) {
    throw new Error(`MENA funders CSV missing required columns (funder,title,url,deadline); got: ${header.join(",")}`);
  }

  const grants: MenaFunderGrant[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  let dropped = 0;
  for (let i = 1; i < grid.length; i++) {
    scanned++;
    const r = grid[i];
    const get = (k: string) => (colIdx[k] >= 0 ? r[colIdx[k]] ?? "" : "");
    const grant = rowToGrant(get);
    if (!grant || seen.has(grant.reference_id)) { dropped++; continue; }
    seen.add(grant.reference_id);
    grants.push(grant);
  }
  return { grants, scanned, dropped };
}

export async function fetchMenaFunderGrants(): Promise<{ grants: MenaFunderGrant[]; totalScanned: number }> {
  const files = listCsvFiles();
  const grants: MenaFunderGrant[] = [];
  const seen = new Set<string>();
  let scanned = 0;
  let dropped = 0;
  for (const file of files) {
    try {
      const { grants: parsed, scanned: s, dropped: d } = parseMenaFunderCsv(fs.readFileSync(file, "utf-8"));
      scanned += s;
      dropped += d;
      for (const g of parsed) {
        if (seen.has(g.reference_id)) continue;
        seen.add(g.reference_id);
        grants.push(g);
      }
    } catch (err) {
      console.warn("[tp:grants:mena_funders:file_failed]", { file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (dropped) console.log("[tp:grants:mena_funders]", { files: files.length, scanned, kept: grants.length, droppedNoFutureDeadline: dropped });
  return { grants, totalScanned: scanned };
}
