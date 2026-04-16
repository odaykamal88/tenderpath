/**
 * World Bank Procurement Notices — free public API.
 * Covers WB-financed contracts globally, IBRD/IDA borrowers.
 * Docs: https://search.worldbank.org/api/v2/procnotices
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

const WB_API = "https://search.worldbank.org/api/v2/procnotices";
const PAGE_SIZE = 200;
const MAX_PAGES = 3;

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
  sector?: string;
  major_sector?: string;
  borrower?: string;
  agency?: string;
  notice_status?: string;
  publication_date?: string;
  submission_deadline_date?: string;
  url?: string;
  contract_signed_date?: string;
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
    fl: "id,bid_reference_no,notice_no,project_name,project_id,bid_description,notice_type,procurement_method,procurement_method_name,country_name,project_ctry_name,country_code,region,sector,major_sector,borrower,agency,notice_status,publication_date,noticedate,submission_deadline_date,url",
    srt: "noticedate desc",
  });
  const resp = await fetchWithTimeout(`${WB_API}?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "TenderPath/1.0" },
  });
  if (!resp.ok) throw new Error(`World Bank ${resp.status}`);
  const data = (await resp.json()) as WBResponse;
  return Object.values(data.procnotices ?? {});
}

function mapNotice(n: WBNotice): RawTender | null {
  const refRaw = n.bid_reference_no || n.notice_no || n.id;
  const title = n.project_name || n.bid_description;
  if (!refRaw || !title) return null;

  return {
    reference_id: `WB-${refRaw}`,
    title: title.slice(0, 500),
    description: n.bid_description ?? null,
    agency: n.agency ?? n.borrower ?? "World Bank",
    country: n.country_name ?? n.project_ctry_name ?? "Global",
    country_code: n.country_code ?? null,
    region: n.region ?? null,
    sector: n.major_sector ?? n.sector ?? null,
    deadline: n.submission_deadline_date?.slice(0, 10) ?? null,
    estimated_value: null,
    source_url: n.url ?? (n.id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}` : null),
    opportunity_type: mapType(n.notice_type, n.procurement_method_name),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "World Bank",
  };
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
