/**
 * World Bank Procurement Notices — free public API.
 * Covers WB-financed contracts globally, IBRD/IDA borrowers.
 * Docs: https://search.worldbank.org/api/v2/procnotices
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const WB_API = "https://search.worldbank.org/api/v2/procnotices";
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

// Pull only live, biddable notice types. The raw procnotices feed is ~74% historical
// "Contract Award" records (~300k of 406k), which are not actionable opportunities.
// Filtering server-side via notice_type_exact (caret-delimited OR) spends the whole
// fetch budget on the ~107k live notices instead of diluting it with awards; the
// `/award/i` guard in mapNotice() is a backstop in case this API filter ever regresses.
// Verified against the live API 2026-06.
const LIVE_NOTICE_TYPES = [
  "Invitation for Bids",
  "Request for Expression of Interest",
  "General Procurement Notice",
  "Invitation for Prequalification",
].join("^");

interface WBNotice {
  id?: string;
  bid_reference_no?: string;
  notice_no?: string;
  project_name?: string;
  project_id?: string;
  bid_description?: string;
  notice_type?: string;
  procurement_method?: string;
  procurement_method_name?: string;
  country_name?: string;
  project_ctry_name?: string;
  noticedate?: string;
  country_code?: string;
  region?: string;
  sector?: string | Array<{ sector_code?: string; sector_description?: string }>;
  major_sector?: string | Array<{ sector_code?: string; sector_description?: string }>;
  borrower?: string;
  agency?: string;
  notice_status?: string;
  publication_date?: string;
  submission_deadline_date?: string;
  url?: string;
  contract_signed_date?: string;
  // Value fields — present on contract award notices in the STEP system.
  // Included speculatively; WB API silently omits fields it doesn't know.
  totalcontractamount?: number | string | null;
  estimatedamount?: number | string | null;
  contract_amount?: number | string | null;
  currency?: string | null;
}

interface WBResponse {
  procnotices?: Record<string, WBNotice>;
  total?: number;
}

async function fetchPage(offset: number): Promise<WBNotice[]> {
  const params = new URLSearchParams({
    format: "json",
    rows: String(PAGE_SIZE),
    os: String(offset),
    fl: "id,bid_reference_no,notice_no,project_name,project_id,bid_description,notice_type,procurement_method,procurement_method_name,country_name,project_ctry_name,country_code,region,sector,major_sector,borrower,agency,notice_status,publication_date,noticedate,submission_deadline_date,url,totalcontractamount,estimatedamount,contract_amount,currency",
    srt: "noticedate desc",
    notice_type_exact: LIVE_NOTICE_TYPES,
  });
  const resp = await fetchWithTimeout(`${WB_API}?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "TenderPath/1.0" },
  });
  if (!resp.ok) throw new Error(`World Bank ${resp.status}`);
  const data = (await resp.json()) as WBResponse;
  return Object.values(data.procnotices ?? {});
}

function formatWBValue(n: WBNotice): string | null {
  const raw = n.totalcontractamount ?? n.estimatedamount ?? n.contract_amount;
  if (raw == null || raw === "" || raw === 0) return null;
  const num = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!num || isNaN(num)) return null;
  const currency = n.currency ?? "USD";
  return `${currency} ${num.toLocaleString()}`;
}

function mapNotice(n: WBNotice): RawTender | null {
  const refRaw = n.bid_reference_no || n.notice_no || n.id;
  const title = n.project_name || n.bid_description;
  if (!refRaw || !title) return null;
  // Backstop: never ingest already-awarded contracts even if the server-side
  // notice_type filter regresses. Awards are historical records, not biddable.
  if (/award/i.test(n.notice_type ?? "")) return null;
  const description = [
    n.bid_description ?? null,
    n.project_id ? `Project ID: ${n.project_id}.` : null,
    n.procurement_method_name ? `Procurement method: ${n.procurement_method_name}.` : null,
    n.notice_type ? `Notice type: ${n.notice_type}.` : null,
    n.borrower ? `Borrower: ${n.borrower}.` : null,
    n.country_name ?? n.project_ctry_name ? `Geography: ${n.country_name ?? n.project_ctry_name}.` : null,
  ].filter(Boolean).join(" ") || null;
  const rawSector = sectorText(n.major_sector) ?? sectorText(n.sector);
  const sector = normalizeSector(rawSector, title, description)[0] ?? null;

  return {
    reference_id: `WB-${refRaw}`,
    title: title.slice(0, 500),
    description,
    agency: n.agency ?? n.borrower ?? "World Bank",
    country: n.country_name ?? n.project_ctry_name ?? "Global",
    country_code: n.country_code ?? null,
    region: n.region ?? null,
    sector,
    deadline: n.submission_deadline_date?.slice(0, 10) ?? null,
    estimated_value: formatWBValue(n),
    source_url: n.url ?? (n.id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}` : null),
    opportunity_type: mapType(n.notice_type, n.procurement_method_name),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "World Bank",
  };
}

function sectorText(value: WBNotice["sector"]): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const text = value
    .map((item) => item.sector_description ?? item.sector_code)
    .filter(Boolean)
    .join("; ");
  return text || null;
}

function mapType(notice?: string, method?: string): string {
  const t = `${notice ?? ""} ${method ?? ""}`.toLowerCase();
  if (t.includes("request for quotation") || t.includes("rfq")) return "RFQ";
  if (t.includes("expression of interest") || t.includes("eoi")) return "EOI";
  if (t.includes("invitation for bids") || t.includes("itb")) return "ITB";
  if (t.includes("consultant")) return "Consultancy";
  return "RFP";
}

export async function crawlWorldBank(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const tenders: RawTender[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const notices = await withRetry(() => fetchPage(p * PAGE_SIZE));
      if (!notices.length) break;
      for (const n of notices) { const t = mapNotice(n); if (t) tenders.push(t); }
      if (notices.length < PAGE_SIZE) break;
    }
    return { platform: "World Bank", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "World Bank", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
