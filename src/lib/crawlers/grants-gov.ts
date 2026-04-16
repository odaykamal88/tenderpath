/**
 * Grants.gov — US federal grant opportunities. Public search2 API (no auth).
 * Docs: https://www.grants.gov/api/common/fetchopportunity
 * Endpoint: POST https://api.grants.gov/v1/api/search2
 *
 * We prefer real funding opportunities with working URLs. All seed grants
 * had fabricated slugs (e.g. grants.gov/EA-CSO-2026) that 404'd — this
 * replaces them with live data.
 */
import { fetchWithTimeout, withRetry } from "./types";

const API = "https://api.grants.gov/v1/api/search2";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export interface RawGrant {
  reference_id: string;
  title: string;
  agency: string;
  deadline: string | null;
  sector: string | null;
  description: string | null;
  themes: string[];
  eligible_org_types: string[];
  source_url: string;
  source_name: string;
}

export interface GrantsCrawlResult {
  platform: string;
  status: "success" | "failure";
  grants: RawGrant[];
  durationMs: number;
  error?: string;
}

interface GrantsGovOppHit {
  id?: string | number;
  number?: string;
  title?: string;
  agencyCode?: string;
  agencyName?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
  docType?: string;
}

interface GrantsGovResponse {
  errorcode?: number;
  msg?: string;
  data?: {
    hitCount?: number;
    oppHits?: GrantsGovOppHit[];
  };
}

// Grants.gov CFDA categories → our sector labels. Used as a hint when the
// per-opportunity fetch doesn't provide richer sector metadata.
const ELIGIBLE_CATEGORY_HINTS: Record<string, string> = {
  AG: "agriculture",
  AR: "consulting",
  BC: "consulting",
  CD: "consulting",
  CP: "consulting",
  DPR: "consulting",
  ED: "education",
  ELT: "education",
  EN: "energy",
  ENV: "environment",
  FN: "consulting",
  HL: "healthcare",
  HO: "construction",
  HU: "consulting",
  IIJ: "construction",
  IS: "consulting",
  ISS: "consulting",
  LJL: "consulting",
  NR: "environment",
  RA: "consulting",
  RD: "consulting",
  ST: "it",
  T: "logistics",
  O: "consulting",
};

async function fetchPage(startRecordNum: number): Promise<{ hits: GrantsGovOppHit[]; total: number }> {
  const body = {
    rows: PAGE_SIZE,
    startRecordNum,
    oppStatuses: "forecasted|posted",
    sortBy: "openDate|desc",
  };

  const resp = await fetchWithTimeout(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "TenderPath/1.0",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Grants.gov ${resp.status}: ${resp.statusText}`);
  const data = (await resp.json()) as GrantsGovResponse;
  if (data.errorcode && data.errorcode !== 0) {
    throw new Error(`Grants.gov error ${data.errorcode}: ${data.msg ?? "unknown"}`);
  }
  return {
    hits: data.data?.oppHits ?? [],
    total: data.data?.hitCount ?? 0,
  };
}

// Grants.gov closeDate is MM/DD/YYYY. Convert to ISO (end-of-day UTC).
function parseCloseDate(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}T23:59:59Z`;
}

function map(hit: GrantsGovOppHit): RawGrant | null {
  const opportunityNumber = hit.number?.trim();
  const id = hit.id != null ? String(hit.id) : null;
  if (!hit.title || (!opportunityNumber && !id)) return null;

  const referenceId = `GRANTS_GOV:${opportunityNumber ?? id}`;
  // Public opportunity detail page. This is the canonical user-facing URL
  // and is what the HEAD check will verify.
  const sourceUrl = id
    ? `https://www.grants.gov/search-results-detail/${id}`
    : `https://www.grants.gov/web/grants/search-grants.html?keywords=${encodeURIComponent(opportunityNumber!)}`;

  return {
    reference_id: referenceId,
    title: hit.title.trim(),
    agency: (hit.agencyName ?? hit.agencyCode ?? "US Federal Government").trim(),
    deadline: parseCloseDate(hit.closeDate),
    sector: null,
    description: null,
    themes: [],
    eligible_org_types: [],
    source_url: sourceUrl,
    source_name: "Grants.gov",
  };
}

export async function crawlGrantsGov(): Promise<GrantsCrawlResult> {
  const start = Date.now();
  try {
    const all: RawGrant[] = [];
    let start_i = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { hits, total } = await withRetry(() => fetchPage(start_i));
      for (const h of hits) {
        const m = map(h);
        if (m) all.push(m);
      }
      start_i += hits.length;
      if (hits.length < PAGE_SIZE) break;
      if (start_i >= total) break;
    }
    void ELIGIBLE_CATEGORY_HINTS;
    return {
      platform: "Grants.gov",
      status: "success",
      grants: all,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      platform: "Grants.gov",
      status: "failure",
      grants: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
