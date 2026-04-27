/**
 * TED — Tenders Electronic Daily (EU procurement).
 * Covers EU Delegations, EuropeAid, EU institutions, and member-state contracts.
 * Free, no API key. Docs: https://docs.ted.europa.eu/api/
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

const TED_API = "https://api.ted.europa.eu/v3/notices/search";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

interface TEDLotValue {
  amount?: number;
  currency?: string;
}

interface TEDNotice {
  "publication-number"?: string;
  "notice-type"?: string;
  "BT-21-Lot"?: Record<string, string[]>;        // multilingual title
  "BT-5141-Lot"?: string[];                       // ISO country
  "deadline-receipt-tender-date-lot"?: string[];  // ISO datetime
  "organisation-name-buyer"?: Record<string, string[]>;
  // Estimated value of the lot(s). TED v3 returns either a single object or
  // an array when multiple lots are present; we take the first entry.
  "BT-27-Lot"?: TEDLotValue | TEDLotValue[];
  links?: { html?: Record<string, string>; pdf?: Record<string, string> };
}

interface TEDResponse {
  notices?: TEDNotice[];
  totalNoticeCount?: number;
}

async function searchPage(page: number): Promise<TEDNotice[]> {
  // Last 30 days, only contract notices (cn-*) — exclude awards (can-*) and corrections.
  const since = new Date(Date.now() - 30 * 86400_000)
    .toISOString().slice(0, 10).replace(/-/g, "");
  const body = {
    query: `publication-date>=${since} AND (notice-type=cn-standard OR notice-type=cn-social OR notice-type=cn-desg)`,
    fields: [
      "publication-number", "notice-type", "BT-21-Lot", "BT-5141-Lot",
      "deadline-receipt-tender-date-lot", "organisation-name-buyer", "BT-27-Lot", "links",
    ],
    page,
    limit: PAGE_SIZE,
  };

  const resp = await fetchWithTimeout(TED_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
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

  const country = n["BT-5141-Lot"]?.[0] ?? "EU";
  const buyerPick = pickML(n["organisation-name-buyer"]);
  const buyer = buyerPick?.value ?? "EU Buyer";
  const deadline = n["deadline-receipt-tender-date-lot"]?.[0]?.slice(0, 10) ?? null;
  const url = n.links?.html?.ENG ?? `https://ted.europa.eu/en/notice/-/detail/${ref}`;

  const valueRaw = n["BT-27-Lot"];
  const valueObj = Array.isArray(valueRaw) ? valueRaw[0] : valueRaw;
  const estimated_value = valueObj?.amount != null
    ? `${valueObj.currency ?? "EUR"} ${valueObj.amount.toLocaleString()}`
    : null;

  return {
    reference_id: `TED-${ref}`,
    title: titlePick.value.slice(0, 500),
    description: null,
    agency: buyer.slice(0, 200),
    country,
    country_code: country.length === 2 ? country : null,
    region: "Europe",
    sector: null,
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
    const tenders: RawTender[] = [];
    for (let p = 1; p <= MAX_PAGES; p++) {
      const notices = await withRetry(() => searchPage(p));
      if (!notices.length) break;
      for (const n of notices) { const t = mapNotice(n); if (t) tenders.push(t); }
      if (notices.length < PAGE_SIZE) break;
    }
    return { platform: "TED EU", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "TED EU", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
