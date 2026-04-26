/**
 * KfW Development Bank tenders via Germany Trade & Invest (GTAI).
 * GTAI aggregates KfW-financed project procurement notices at
 * gtai.de/en/meta/search/kfw-tenders/. Server-rendered HTML, no CF.
 *
 * KfW finances projects in 60+ developing countries but doesn't run
 * its own public procurement portal — GTAI is the canonical aggregator.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const LISTING_URL = "https://www.gtai.de/en/meta/search/kfw-tenders/795748!search";
const BASE_URL = "https://www.gtai.de";
const MAX_PAGES = 5;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
  Accept: "text/html",
};

function parseListingLinks(html: string): Array<{ path: string; title: string }> {
  // Links: href="/en/trade/{country}/tenders/{slug}--{id}"
  const re = /href="(\/en\/(?:trade|gtai)\/[^"]*(?:tender|ausschreibung)[^"]*)"[^>]*>\s*<[^>]+>([^<]*)/gi;
  const seen = new Set<string>();
  const out: Array<{ path: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1].split("?")[0];
    const title = m[2].trim();
    if (!seen.has(path) && title) {
      seen.add(path);
      out.push({ path, title });
    }
  }
  return out;
}

function parseDeadline(html: string): string | null {
  // "15.05.2026" or "2026-05-15" or "May 15, 2026"
  const dmy = html.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const iso = html.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchListingPage(page: number): Promise<string> {
  const url = page === 0
    ? LISTING_URL
    : `${LISTING_URL}?page=${page}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 25000);
  if (!resp.ok) throw new Error(`KfW/GTAI listing page ${page} HTTP ${resp.status}`);
  return resp.text();
}

async function fetchDetail(path: string): Promise<{ deadline: string | null; description: string | null; country: string | null; reference: string | null }> {
  const url = `${BASE_URL}${path}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 20000);
  if (!resp.ok) return { deadline: null, description: null, country: null, reference: null };
  const html = await resp.text();

  const deadlineSection = html.match(/(?:[Ss]ubmission|[Dd]eadline|[Aa]ngebotsschluss)[^<]*<[^>]+>([^<]+)/);
  const deadline = deadlineSection ? parseDeadline(deadlineSection[1]) : parseDeadline(html.slice(0, 3000));

  const countryM = html.match(/(?:[Cc]ountry|[Ll]and)[^:]*:?\s*<[^>]+>([^<]+)/);
  const country = countryM?.[1]?.trim() ?? null;

  const refM = html.match(/(?:[Rr]eference|[Tt]ender\s*[Nn]o\.?)[^:]*:?\s*<[^>]+>([^<]+)/);
  const reference = refM?.[1]?.trim() ?? null;

  const bodyM = html.match(/<div[^>]*class="[^"]*(?:article|body|content|text)[^"]*"[^>]*>([\s\S]{100,1500}?)<\/div>/i);
  const description = bodyM ? stripTags(bodyM[1]).slice(0, 600) || null : null;

  return { deadline, description, country, reference };
}

export async function crawlKfW(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const allLinks: Array<{ path: string; title: string }> = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      let html: string;
      try {
        html = await withRetry(() => fetchListingPage(page));
      } catch {
        break;
      }
      const links = parseListingLinks(html);
      if (!links.length) break;
      allLinks.push(...links);
      if (links.length < 5) break;
    }

    if (!allLinks.length) {
      return {
        platform: "KfW", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "KfW/GTAI listing returned no tender links",
      };
    }

    const tenders: RawTender[] = [];
    for (const { path, title } of allLinks) {
      let detail = { deadline: null as string | null, description: null as string | null, country: null as string | null, reference: null as string | null };
      try {
        detail = await withRetry(() => fetchDetail(path));
      } catch (err) {
        console.error(`[kfw] detail ${path} failed:`, err instanceof Error ? err.message : err);
      }

      const idPart = path.split("--").pop() ?? path.split("/").pop() ?? path;
      const refId = detail.reference ? `KFW-${detail.reference.replace(/\s+/g, "-")}` : `KFW-${idPart}`;
      const sectors = normalizeSector(null, title, detail.description);

      tenders.push({
        reference_id: refId,
        title,
        description: detail.description,
        agency: "KfW",
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
        source_name: "KfW",
      });
    }

    if (tenders.length === 0) {
      return {
        platform: "KfW", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "KfW yielded 0 tenders after detail fetch",
      };
    }

    return { platform: "KfW", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "KfW", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
