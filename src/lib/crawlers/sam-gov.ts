/**
 * SAM.gov — US Government contract opportunities (USAID, State, DoD, etc.).
 * Requires a free API key (instant signup at sam.gov/data-services).
 * Set env var SAM_GOV_API_KEY. Without it, this crawler is a no-op.
 * Docs: https://open.gsa.gov/api/get-opportunities-public-api/
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const SAM_API = "https://api.sam.gov/opportunities/v2/search";
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

// Post-USAID dissolution absorbers. State Dept (FH: 1900) inherits most
// governance/development solicitations; DFC (FH: 71061300) took over the
// investment / finance portfolio. Fetching these explicitly in addition
// to the default org-wide sweep surfaces notices that the default 30-day
// window might otherwise clip when the State feed is noisy.
const EXTRA_ORG_CODES = ["19000000", "71061300"];

interface SAMOpportunity {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  fullParentPathCode?: string;
  postedDate?: string;
  type?: string;
  baseType?: string;
  archiveDate?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string;
  active?: string;
  description?: string;
  organizationType?: string;
  uiLink?: string;
  placeOfPerformance?: { country?: { code?: string; name?: string }; city?: { name?: string } };
  pointOfContact?: Array<{ email?: string; fullName?: string }>;
  award?: { amount?: string };
}

interface SAMResponse {
  opportunitiesData?: SAMOpportunity[];
  totalRecords?: number;
}

async function fetchPage(
  apiKey: string,
  offset: number,
  organizationCode?: string,
): Promise<SAMOpportunity[]> {
  // Last 30 days, active opportunities only.
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86400_000);
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  const params = new URLSearchParams({
    api_key: apiKey,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    postedFrom: fmt(from),
    postedTo: fmt(today),
    ptype: "o,k,p,r,s,g", // solicitation, combined synopsis, presolicitation, sources sought, special notice, sale of surplus
  });
  if (organizationCode) params.set("organizationCode", organizationCode);

  const resp = await fetchWithTimeout(`${SAM_API}?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "TenderPath/1.0" },
  });
  if (!resp.ok) throw new Error(`SAM.gov ${resp.status}: ${resp.statusText}`);
  const data = (await resp.json()) as SAMResponse;
  return data.opportunitiesData ?? [];
}

// Active flag can come back as "Yes"/"No", "true"/"false", or missing.
// Treat anything other than an explicit negative as active so legitimate
// notices without the flag still flow through.
function isActive(o: SAMOpportunity): boolean {
  if (!o.active) return true;
  const s = o.active.toString().toLowerCase();
  return s !== "no" && s !== "false" && s !== "0";
}

// Award Notice / Justification postings describe decisions already made;
// they can't be bid on so they're noise for Tenderpath users.
function isExcludedType(o: SAMOpportunity): boolean {
  const t = (o.type ?? o.baseType ?? "").toLowerCase();
  return t.includes("award notice") || t.includes("justification");
}

function mapOpp(o: SAMOpportunity): RawTender | null {
  const ref = o.noticeId || o.solicitationNumber;
  if (!ref || !o.title) return null;
  if (!isActive(o) || isExcludedType(o)) return null;

  const country = o.placeOfPerformance?.country?.name ?? "United States";
  const strippedDescription = o.description ? stripHtml(o.description).slice(0, 3000) : "";
  const rawDescription = /^https?:\/\//i.test(strippedDescription) ? "" : strippedDescription;
  const description = [
    rawDescription || null,
    o.fullParentPathName ? `Agency path: ${o.fullParentPathName}.` : null,
    o.naicsCode ? `NAICS: ${o.naicsCode}.` : null,
    o.classificationCode ? `Classification: ${o.classificationCode}.` : null,
    o.type ?? o.baseType ? `Notice type: ${o.type ?? o.baseType}.` : null,
    country ? `Place of performance: ${country}.` : null,
    o.responseDeadLine ? `Response deadline: ${o.responseDeadLine}.` : null,
  ].filter(Boolean).join(" ") || null;
  const sector = normalizeSector(o.naicsCode ?? o.classificationCode, o.title, description)[0] ?? null;
  return {
    reference_id: `SAM-${ref}`,
    title: o.title.slice(0, 500),
    description,
    agency: o.fullParentPathName?.split(".")[0] ?? "US Government",
    country,
    country_code: o.placeOfPerformance?.country?.code ?? "US",
    region: null,
    sector,
    deadline: o.responseDeadLine?.slice(0, 10) ?? null,
    estimated_value: o.award?.amount ? `USD ${o.award.amount}` : null,
    source_url: o.uiLink ?? null,
    opportunity_type: mapType(o.type ?? o.baseType),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "SAM.gov",
  };
}

function mapType(t?: string): string {
  if (!t) return "RFP";
  const s = t.toLowerCase();
  if (s.includes("solicitation")) return "RFP";
  if (s.includes("sources sought")) return "EOI";
  if (s.includes("presolicitation")) return "Prior Information";
  if (s.includes("award")) return "Award";
  if (s.includes("combined synopsis")) return "RFQ";
  return "RFP";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function crawlSAMGov(): Promise<CrawlResult> {
  const start = Date.now();
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) {
    return {
      platform: "SAM.gov",
      status: "failure",
      tenders: [],
      durationMs: 0,
      error: "SAM_GOV_API_KEY not set — get a free key at sam.gov/data-services",
    };
  }

  try {
    const tenders: RawTender[] = [];
    const seen = new Set<string>();
    const push = (o: SAMOpportunity) => {
      const t = mapOpp(o);
      if (!t || seen.has(t.reference_id)) return;
      seen.add(t.reference_id);
      tenders.push(t);
    };

    // Pass 1: org-wide sweep.
    for (let p = 0; p < MAX_PAGES; p++) {
      const opps = await withRetry(() => fetchPage(apiKey, p * PAGE_SIZE));
      if (!opps.length) break;
      for (const o of opps) push(o);
      if (opps.length < PAGE_SIZE) break;
    }

    // Pass 2: State Dept + DFC explicit pulls (post-USAID absorbers).
    for (const code of EXTRA_ORG_CODES) {
      for (let p = 0; p < MAX_PAGES; p++) {
        const opps = await withRetry(() => fetchPage(apiKey, p * PAGE_SIZE, code)).catch(() => []);
        if (!opps.length) break;
        for (const o of opps) push(o);
        if (opps.length < PAGE_SIZE) break;
      }
    }

    return { platform: "SAM.gov", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "SAM.gov", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
