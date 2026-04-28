/**
 * NRC — Norwegian Refugee Council.
 * Server-rendered Episerver HTML listing at nrc.no/procurement/.
 * Tender detail pages at nrc.no/tender/{slug}.
 * No CF protection. Low volume (~10-30 active tenders).
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const LISTING_URL = "https://www.nrc.no/procurement/";
const BASE_URL = "https://www.nrc.no";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
  Accept: "text/html",
};

function extractLinks(html: string): Array<{ path: string; title: string | null }> {
  const re = /<a[^>]+href="(\/tender\/[^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/g;
  const seen = new Set<string>();
  const links: Array<{ path: string; title: string | null }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (!seen.has(path)) {
      seen.add(path);
      links.push({ path, title: extractText(m[2], /^([\s\S]*)$/) });
    }
  }
  return links;
}

function extractText(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim() ?? null;
}

function parseNrcDate(raw: string): string | null {
  // "May 24 2026" or "24 May 2026" or "2026-05-24"
  const isoM = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return `${isoM[1]}-${isoM[2]}-${isoM[3]}`;

  const months: Record<string, string> = {
    January: "01", February: "02", March: "03", April: "04",
    May: "05", June: "06", July: "07", August: "08",
    September: "09", October: "10", November: "11", December: "12",
  };
  const m1 = raw.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m1) {
    const mm = months[m1[1]] ?? months[m1[1].charAt(0).toUpperCase() + m1[1].slice(1).toLowerCase()];
    if (mm) return `${m1[3]}-${mm}-${m1[2].padStart(2, "0")}`;
  }
  const m2 = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const mm = months[m2[2]] ?? months[m2[2].charAt(0).toUpperCase() + m2[2].slice(1).toLowerCase()];
    if (mm) return `${m2[3]}-${mm}-${m2[1].padStart(2, "0")}`;
  }
  return null;
}

interface TenderDetail {
  title: string | null;
  deadline: string | null;
  description: string | null;
  country: string | null;
}

async function fetchDetail(path: string): Promise<TenderDetail> {
  const url = `${BASE_URL}${path}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 20000);
  if (!resp.ok) throw new Error(`NRC detail ${url} HTTP ${resp.status}`);
  const html = await resp.text();

  const title = extractText(html, /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/);
  const deadlineRaw = extractText(html, /[Dd]eadline[^<]*<[^>]+>([^<]+)/);
  const deadline = deadlineRaw ? parseNrcDate(deadlineRaw) : null;

  // Strip tags from a broad body section
  const bodyM = html.match(/<div[^>]*class="[^"]*(?:article|content|body)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const description = bodyM
    ? bodyM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600) || null
    : null;

  const countryM = html.match(/[Cc]ountry[^<]*<[^>]+>([^<]+)/);
  const country = countryM?.[1]?.replace(/&nbsp;/g, " ").trim() || null;

  return { title, deadline, description, country };
}

export async function crawlNRC(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const listResp = await withRetry(() =>
      fetchWithTimeout(LISTING_URL, { headers: HEADERS }, 20000),
    );
    if (!listResp.ok) throw new Error(`NRC listing HTTP ${listResp.status}`);
    const listHtml = await listResp.text();
    const paths = extractLinks(listHtml);

    if (!paths.length) {
      return {
        platform: "NRC", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "NRC listing returned no tender links",
      };
    }

    const tenders: RawTender[] = [];
    for (const { path, title: listingTitle } of paths) {
      let detail: TenderDetail = {
        title: listingTitle,
        deadline: null,
        description: listingTitle ? `NRC tender announcement: ${listingTitle}` : null,
        country: null,
      };
      try {
        detail = await withRetry(() => fetchDetail(path));
      } catch (err) {
        console.error(`[nrc] detail ${path} failed:`, err instanceof Error ? err.message : err);
      }
      const slug = path.split("/").filter(Boolean).pop() ?? path;
      const title = detail.title ?? slug;
      const sectors = normalizeSector(null, title, detail.description);
      tenders.push({
        reference_id: `NRC-${slug}`,
        title,
        description: detail.description,
        agency: "NRC",
        country: detail.country ?? "Global",
        country_code: null,
        region: null,
        sector: sectors[0] ?? null,
        deadline: detail.deadline,
        estimated_value: null,
        source_url: `${BASE_URL}${path}`,
        opportunity_type: "RFP",
        eligibility_summary: null,
        experience_level: null,
        submission_language: "English",
        source_tier: 1,
        source_name: "NRC",
      });
    }

    if (tenders.length === 0) {
      return {
        platform: "NRC", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "NRC yielded 0 tenders after detail fetch",
      };
    }

    return { platform: "NRC", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "NRC", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
