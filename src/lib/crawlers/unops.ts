/**
 * UNOPS — UN Office for Project Services.
 *
 * NOTE: UNOPS posts all procurement notices to UNGM by mandate; they are
 * already captured by crawlUNGM(). The standalone procurement-notices.unops.org
 * API is not operational (ECONNREFUSED as of Apr 2026). This crawler is
 * intentionally NOT registered in sync.ts to avoid duplicate entries.
 *
 * Left here for future reference if UNOPS ever exposes a separate API.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector, unspscSegmentToSlug } from "./sector-map";

const BASE_URL = "https://procurement-notices.unops.org/api/notices";
const DETAIL_URL = "https://procurement-notices.unops.org/pages/Details.aspx";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

interface UNOPSNotice {
  noticeId?: string | number;
  title?: string;
  noticeType?: string;
  country?: string;
  countryCode?: string;
  deadline?: string;
  projectDescription?: string;
  category?: string;
  businessUnit?: string;
  unspscCodes?: string[];
  budget?: number | null;
  currency?: string | null;
  language?: string | null;
}

interface UNOPSPage {
  content?: UNOPSNotice[];
  last?: boolean;
  totalElements?: number;
}

async function fetchPage(page: number): Promise<UNOPSPage> {
  const url = `${BASE_URL}?page=${page}&size=${PAGE_SIZE}&sort=publicationDate,desc&status=Open`;
  const resp = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  }, 30000);
  if (!resp.ok) throw new Error(`UNOPS API page ${page} HTTP ${resp.status}`);
  return resp.json() as Promise<UNOPSPage>;
}

function mapNotice(n: UNOPSNotice): RawTender {
  const id = n.noticeId ?? "";
  const unspscSlug = n.unspscCodes?.length
    ? unspscSegmentToSlug(n.unspscCodes[0])
    : null;
  const sectors = unspscSlug
    ? [unspscSlug]
    : normalizeSector(n.category, n.title, n.projectDescription);
  const sector = sectors[0] ?? null;

  return {
    reference_id: `UNOPS-${id}`,
    title: n.title ?? "Untitled",
    description: n.projectDescription ?? null,
    agency: n.businessUnit ?? "UNOPS",
    country: n.country ?? "Global",
    country_code: n.countryCode ?? null,
    region: null,
    sector,
    deadline: n.deadline ? n.deadline.slice(0, 10) : null,
    estimated_value: n.budget != null
      ? `${n.budget}${n.currency ? " " + n.currency : ""}`
      : null,
    source_url: id ? `${DETAIL_URL}?id=${id}` : null,
    opportunity_type: n.noticeType ?? "RFP",
    eligibility_summary: null,
    experience_level: null,
    submission_language: n.language ?? "English",
    source_tier: 1,
    source_name: "UNOPS",
  };
}

export async function crawlUNOPS(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const tenders: RawTender[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await withRetry(() => fetchPage(page));
      const items = data.content ?? [];
      if (!items.length) break;
      tenders.push(...items.map(mapNotice));
      if (data.last) break;
    }

    if (tenders.length === 0) {
      return {
        platform: "UNOPS", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "UNOPS yielded 0 tenders",
      };
    }

    return { platform: "UNOPS", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "UNOPS", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
