/**
 * TED — Tenders Electronic Daily (EU procurement).
 * Covers EU Delegations, EuropeAid, EU institutions, and member-state contracts.
 * Free, no API key. Docs: https://docs.ted.europa.eu/api/
 *
 * Two passes:
 *   1. Untargeted — the newest EU contract notices (mostly EU-domestic; kept for breadth).
 *   2. Targeted — open contract notices PERFORMED IN MENA / Turkey / Gulf / Africa
 *      (`place-of-performance IN (...)` + future deadline). This is the ICP slice:
 *      EU-funded development/external-action contracts (GIZ, Enabel, Expertise France,
 *      EU Delegations) in our users' countries. TED's ~42k/month is otherwise ~all
 *      EU-domestic, so the newest-300 pull catches almost none of these.
 *
 * Geography: TED returns the place-of-performance as an ISO-2 code (BT-5141). The
 * old code stored that code verbatim as `country` ("MA") and hard-coded
 * `region: "Europe"`, so a Morocco/Kenya tender matched neither a "Morocco" profile
 * nor the MENA region. We now resolve ISO-2 → canonical country name + region group.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";
import { ALL_COUNTRIES } from "@/lib/countries";

const TED_API = "https://api.ted.europa.eu/v3/notices/search";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
const TARGETED_MAX_PAGES = 4;

const COUNTRY_REGION = new Map(ALL_COUNTRIES.map((r) => [r.country, r.region]));
const REGION_NAMES = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

const MENA = "Middle East & North Africa";
const SSA = "Sub-Saharan Africa";
const EECA = "Eastern Europe & Central Asia";

// TED's BT-5141 place-of-performance returns ISO-3166 alpha-3, so key by alpha-3.
// Targeted set: MENA + Gulf + Turkey + Sub-Saharan Africa. iso2 is for country_code.
const TARGET: Record<string, { name: string; region: string; iso2: string }> = {
  MAR: { name: "Morocco", region: MENA, iso2: "MA" }, DZA: { name: "Algeria", region: MENA, iso2: "DZ" },
  TUN: { name: "Tunisia", region: MENA, iso2: "TN" }, LBY: { name: "Libya", region: MENA, iso2: "LY" },
  EGY: { name: "Egypt", region: MENA, iso2: "EG" }, JOR: { name: "Jordan", region: MENA, iso2: "JO" },
  LBN: { name: "Lebanon", region: MENA, iso2: "LB" }, SYR: { name: "Syria", region: MENA, iso2: "SY" },
  IRQ: { name: "Iraq", region: MENA, iso2: "IQ" }, YEM: { name: "Yemen", region: MENA, iso2: "YE" },
  PSE: { name: "Palestine", region: MENA, iso2: "PS" }, IRN: { name: "Iran", region: MENA, iso2: "IR" },
  SAU: { name: "Saudi Arabia", region: MENA, iso2: "SA" }, ARE: { name: "United Arab Emirates", region: MENA, iso2: "AE" },
  KWT: { name: "Kuwait", region: MENA, iso2: "KW" }, QAT: { name: "Qatar", region: MENA, iso2: "QA" },
  OMN: { name: "Oman", region: MENA, iso2: "OM" }, BHR: { name: "Bahrain", region: MENA, iso2: "BH" },
  TUR: { name: "Turkey", region: EECA, iso2: "TR" },
  SDN: { name: "Sudan", region: SSA, iso2: "SD" }, NGA: { name: "Nigeria", region: SSA, iso2: "NG" },
  KEN: { name: "Kenya", region: SSA, iso2: "KE" }, ETH: { name: "Ethiopia", region: SSA, iso2: "ET" },
  GHA: { name: "Ghana", region: SSA, iso2: "GH" }, SEN: { name: "Senegal", region: SSA, iso2: "SN" },
  CIV: { name: "Côte d'Ivoire", region: SSA, iso2: "CI" }, TZA: { name: "Tanzania", region: SSA, iso2: "TZ" },
  UGA: { name: "Uganda", region: SSA, iso2: "UG" }, RWA: { name: "Rwanda", region: SSA, iso2: "RW" },
  MOZ: { name: "Mozambique", region: SSA, iso2: "MZ" }, COD: { name: "Democratic Republic of the Congo", region: SSA, iso2: "CD" },
  COG: { name: "Republic of the Congo", region: SSA, iso2: "CG" }, MLI: { name: "Mali", region: SSA, iso2: "ML" },
  BFA: { name: "Burkina Faso", region: SSA, iso2: "BF" }, NER: { name: "Niger", region: SSA, iso2: "NE" },
  TCD: { name: "Chad", region: SSA, iso2: "TD" }, SOM: { name: "Somalia", region: SSA, iso2: "SO" },
  SSD: { name: "South Sudan", region: SSA, iso2: "SS" }, ZMB: { name: "Zambia", region: SSA, iso2: "ZM" },
  ZWE: { name: "Zimbabwe", region: SSA, iso2: "ZW" }, CMR: { name: "Cameroon", region: SSA, iso2: "CM" },
  BEN: { name: "Benin", region: SSA, iso2: "BJ" }, GIN: { name: "Guinea", region: SSA, iso2: "GN" },
  GNB: { name: "Guinea-Bissau", region: SSA, iso2: "GW" }, MWI: { name: "Malawi", region: SSA, iso2: "MW" },
  MDG: { name: "Madagascar", region: SSA, iso2: "MG" }, MRT: { name: "Mauritania", region: SSA, iso2: "MR" },
  LBR: { name: "Liberia", region: SSA, iso2: "LR" }, SLE: { name: "Sierra Leone", region: SSA, iso2: "SL" },
  TGO: { name: "Togo", region: SSA, iso2: "TG" }, AGO: { name: "Angola", region: SSA, iso2: "AO" },
  ZAF: { name: "South Africa", region: SSA, iso2: "ZA" }, BWA: { name: "Botswana", region: SSA, iso2: "BW" },
  NAM: { name: "Namibia", region: SSA, iso2: "NA" }, GMB: { name: "Gambia", region: SSA, iso2: "GM" },
  GAB: { name: "Gabon", region: SSA, iso2: "GA" }, BDI: { name: "Burundi", region: SSA, iso2: "BI" },
  ERI: { name: "Eritrea", region: SSA, iso2: "ER" }, DJI: { name: "Djibouti", region: SSA, iso2: "DJ" },
  SWZ: { name: "Eswatini", region: SSA, iso2: "SZ" }, LSO: { name: "Lesotho", region: SSA, iso2: "LS" },
  CPV: { name: "Cabo Verde", region: SSA, iso2: "CV" }, CAF: { name: "Central African Republic", region: SSA, iso2: "CF" },
  GNQ: { name: "Equatorial Guinea", region: SSA, iso2: "GQ" },
};

const TARGET_ISO3 = Object.keys(TARGET);

// EU/EEA/UK alpha-3 → alpha-2 so non-target rows still get a real name + region
// (via DisplayNames + the region map) instead of a bare code.
const EU_ISO3_TO_ISO2: Record<string, string> = {
  AUT: "AT", BEL: "BE", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ", DNK: "DK", EST: "EE",
  FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR", HUN: "HU", IRL: "IE", ITA: "IT", LVA: "LV",
  LTU: "LT", LUX: "LU", MLT: "MT", NLD: "NL", POL: "PL", PRT: "PT", ROU: "RO", SVK: "SK",
  SVN: "SI", ESP: "ES", SWE: "SE", ISL: "IS", NOR: "NO", LIE: "LI", CHE: "CH", GBR: "GB", USA: "US",
};

// Resolve place-of-performance. BT-5141 can list several countries on a multi-country
// contract; prefer a targeted (MENA/Turkey/Gulf/Africa) one so the row reaches the right users.
function geoFor(codes: string[] | undefined): { country: string; region: string; code: string | null } {
  const list = (codes ?? []).map((c) => (c ?? "").toUpperCase()).filter(Boolean);
  const hit = list.find((c) => TARGET[c]);
  if (hit) { const t = TARGET[hit]; return { country: t.name, region: t.region, code: t.iso2 }; }
  const first = list[0];
  if (!first) return { country: "EU", region: "Europe", code: null };
  const iso2 = EU_ISO3_TO_ISO2[first] ?? (first.length === 2 ? first : null);
  const name = (iso2 ? REGION_NAMES?.of(iso2) : null) ?? first;
  return { country: name, region: COUNTRY_REGION.get(name) ?? "Europe", code: iso2 };
}

interface TEDLotValue {
  amount?: number;
  currency?: string;
}

interface TEDNotice {
  "publication-number"?: string;
  "notice-type"?: string;
  "BT-21-Lot"?: Record<string, string[]>;        // multilingual title
  "BT-24-Lot"?: Record<string, string[]>;        // multilingual description
  "BT-5141-Lot"?: string[];                       // ISO country
  "deadline-receipt-tender-date-lot"?: string[];  // ISO datetime
  "organisation-name-buyer"?: Record<string, string[]>;
  "classification-cpv"?: string[];
  // Estimated value of the lot(s). TED v3 returns either a single object or
  // an array when multiple lots are present; we take the first entry.
  "BT-27-Lot"?: TEDLotValue | TEDLotValue[];
  links?: { html?: Record<string, string>; pdf?: Record<string, string> };
}

interface TEDResponse {
  notices?: TEDNotice[];
  totalNoticeCount?: number;
}

const FIELDS = [
  "publication-number", "notice-type", "BT-21-Lot", "BT-24-Lot", "BT-5141-Lot",
  "deadline-receipt-tender-date-lot", "organisation-name-buyer", "BT-27-Lot", "classification-cpv", "links",
];

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// Pass 1: newest EU contract notices (last 30 days), all geographies — breadth.
function recentQuery(): string {
  const since = yyyymmdd(new Date(Date.now() - 30 * 86400_000));
  return `publication-date>=${since} AND (notice-type=cn-standard OR notice-type=cn-social OR notice-type=cn-desg)`;
}

// Pass 2: OPEN contract notices performed in MENA/Turkey/Gulf/Africa — the ICP slice
// the breadth pass almost never reaches (the region is <0.5% of TED's daily volume).
function targetedQuery(): string {
  const today = yyyymmdd(new Date());
  return `notice-type IN (cn-standard cn-social cn-desg) AND deadline-receipt-tender-date-lot>=${today} AND place-of-performance IN (${TARGET_ISO3.join(" ")})`;
}

async function searchPage(page: number, query: string): Promise<TEDNotice[]> {
  const resp = await fetchWithTimeout(TED_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, fields: FIELDS, page, limit: PAGE_SIZE }),
  });
  if (!resp.ok) throw new Error(`TED ${resp.status}`);
  const data = (await resp.json()) as TEDResponse;
  return data.notices ?? [];
}

const TYPE_MAP: Record<string, string> = {
  "cn-standard": "RFP",
  "cn-social": "RFP",
  "cn-desg": "RFP",
  "can-standard": "Award",
  "pin-only": "Prior Information",
};

// Language codes whose scripts are reliably Latin and English-readable as-is.
// Turkish (tur) uses Latin script but is not English and contains non-ASCII
// diacritics (ü, ş, ğ, İ, ç) that produce confusing titles in the UI.
// Bulgarian (bul) uses Cyrillic; Greek (ell) uses Greek script — excluded.
const ENGLISH_READABLE_LANGS = new Set(["eng", "fra", "deu", "spa", "ita", "por", "nld", "pol", "ron", "ces", "slk", "hun", "hrv", "slv", "lav", "lit", "est", "fin", "swe", "dan", "nor"]);

function pickML(ml?: Record<string, string[]>): { value: string; lang: string } | null {
  if (!ml) return null;
  // Strong preference for English
  for (const k of ["eng", "ENG"]) if (ml[k]?.[0]) return { value: ml[k][0], lang: "eng" };
  // Fall back to other EU working languages, excluding Turkish and non-Latin-script codes
  const entries = Object.entries(ml);
  for (const [k, v] of entries) {
    if (v?.[0] && ENGLISH_READABLE_LANGS.has(k.toLowerCase())) return { value: v[0], lang: k.toLowerCase() };
  }
  // Last resort: any language (keeps coverage but may have non-ASCII titles)
  for (const [k, v] of entries) if (v?.[0]) return { value: v[0], lang: k.toLowerCase() };
  return null;
}

const LANG_LABEL: Record<string, string> = {
  eng: "English", fra: "French", deu: "German", spa: "Spanish", ita: "Italian",
  por: "Portuguese", nld: "Dutch", pol: "Polish", ron: "Romanian", ell: "Greek",
};

function mapNotice(n: TEDNotice): RawTender | null {
  const ref = n["publication-number"];
  const titlePick = pickML(n["BT-21-Lot"]);
  if (!ref || !titlePick) return null;

  const geo = geoFor(n["BT-5141-Lot"]);
  const descriptionPick = pickML(n["BT-24-Lot"]);
  const description = descriptionPick?.value?.slice(0, 3000) ?? null;
  const buyerPick = pickML(n["organisation-name-buyer"]);
  const buyer = buyerPick?.value ?? "EU Buyer";
  const deadline = n["deadline-receipt-tender-date-lot"]?.[0]?.slice(0, 10) ?? null;
  const url = n.links?.html?.ENG ?? `https://ted.europa.eu/en/notice/-/detail/${ref}`;

  const valueRaw = n["BT-27-Lot"];
  const valueObj = Array.isArray(valueRaw) ? valueRaw[0] : valueRaw;
  const estimated_value = valueObj?.amount != null
    ? `${valueObj.currency ?? "EUR"} ${valueObj.amount.toLocaleString()}`
    : null;
  const cpv = n["classification-cpv"]?.filter(Boolean).join(", ") ?? null;
  const cpvSector = cpv ? `CPV ${cpv}` : null;
  const sector = normalizeSector(cpvSector, titlePick.value, description)[0] ?? null;

  return {
    reference_id: `TED-${ref}`,
    title: titlePick.value.slice(0, 500),
    description,
    agency: buyer.slice(0, 200),
    country: geo.country,
    country_code: geo.code,
    region: geo.region,
    sector,
    deadline,
    estimated_value,
    source_url: url,
    opportunity_type: TYPE_MAP[n["notice-type"] ?? ""] ?? "RFP",
    eligibility_summary: null,
    experience_level: null,
    submission_language: LANG_LABEL[titlePick.lang] ?? titlePick.lang.toUpperCase(),
    source_tier: 1,
    source_name: "TED EU",
  };
}

export async function crawlTED(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const byRef = new Map<string, RawTender>();
    const collect = async (query: string, maxPages: number) => {
      for (let p = 1; p <= maxPages; p++) {
        const notices = await withRetry(() => searchPage(p, query));
        if (!notices.length) break;
        for (const n of notices) { const t = mapNotice(n); if (t) byRef.set(t.reference_id, t); }
        if (notices.length < PAGE_SIZE) break;
      }
    };
    await collect(recentQuery(), MAX_PAGES);            // breadth: newest EU notices
    await collect(targetedQuery(), TARGETED_MAX_PAGES); // ICP: open tenders performed in MENA/Turkey/Gulf/Africa
    return { platform: "TED EU", status: "success", tenders: [...byRef.values()], durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "TED EU", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
