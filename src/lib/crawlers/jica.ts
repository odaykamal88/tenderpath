/**
 * JICA — Japan International Cooperation Agency.
 *
 * NOTE: The English procurement listing (jica.go.jp/english/business/notice/)
 * returns 404 as of Apr 2026. The primary listing is at
 * www2.jica.go.jp/ja/announce/index.php?contract=1 (Japanese only).
 * Individual notice detail pages are PDF documents, not HTML — there is no
 * machine-readable deadline or sector field without PDF parsing.
 *
 * This crawler is intentionally NOT registered in sync.ts until a reliable
 * English-language or API endpoint becomes available.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const BASE_URL = "https://www.jica.go.jp";
const LISTING_BASE = `${BASE_URL}/english/business/notice/`;
const MAX_PAGES = 10;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
  Accept: "text/html",
};

interface JICANotice {
  title: string;
  url: string;
  deadline: string | null;
  country: string | null;
  description: string | null;
}

function extractLinks(html: string): Array<{ path: string; title: string }> {
  // Links follow pattern: href="/english/business/notice/{year}/{slug}.html"
  const re = /href="(\/english\/business\/notice\/\d{4}\/[^"]+\.html)"[^>]*>([^<]*)/g;
  const seen = new Set<string>();
  const out: Array<{ path: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (!seen.has(path)) {
      seen.add(path);
      out.push({ path, title: m[2].trim() });
    }
  }
  return out;
}

function parseJicaDate(raw: string): string | null {
  // "2026/05/24" or "2026-05-24"
  const m = raw.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

async function fetchDetail(path: string): Promise<JICANotice | null> {
  const url = `${BASE_URL}${path}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 20000);
  if (!resp.ok) return null;
  const html = await resp.text();

  const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
    ?.replace(/<[^>]+>/g, "").trim() ?? null;
  const deadlineRaw = html.match(/Application\s+Deadline[^:]*:\s*([^\n<]+)/i)?.[1]?.trim() ?? null;
  const deadline = deadlineRaw ? parseJicaDate(deadlineRaw) : null;

  const countryM = html.match(/Country[^:]*:\s*<[^>]+>([^<]+)/i);
  const country = countryM?.[1]?.trim() ?? null;

  // Grab first paragraph-ish content block
  const bodyM = html.match(/<div[^>]*class="[^"]*(?:article|content|detail)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const description = bodyM
    ? bodyM[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600) || null
    : null;

  return { title: title ?? path, url, deadline, country, description };
}

export async function crawlJICA(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const allLinks: Array<{ path: string; title: string }> = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? LISTING_BASE : `${LISTING_BASE}?page=${page}`;
      let html: string;
      try {
        const resp = await withRetry(() => fetchWithTimeout(url, { headers: HEADERS }, 20000));
        if (!resp.ok) break;
        html = await resp.text();
      } catch {
        break;
      }
      const links = extractLinks(html);
      if (!links.length) break;
      allLinks.push(...links);
      // If fewer than 10 links on this page, likely the last
      if (links.length < 10) break;
    }

    if (!allLinks.length) {
      return {
        platform: "JICA", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "JICA listing returned no notice links",
      };
    }

    const tenders: RawTender[] = [];
    for (const { path, title: listTitle } of allLinks) {
      let detail: JICANotice | null = null;
      try {
        detail = await withRetry(() => fetchDetail(path));
      } catch (err) {
        console.error(`[jica] detail ${path} failed:`, err instanceof Error ? err.message : err);
      }
      const title = detail?.title ?? listTitle;
      const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      const sectors = normalizeSector(null, title, detail?.description);
      tenders.push({
        reference_id: `JICA-${slug}`,
        title,
        description: detail?.description ?? null,
        agency: "JICA",
        country: detail?.country ?? "Global",
        country_code: null,
        region: null,
        sector: sectors[0] ?? null,
        deadline: detail?.deadline ?? null,
        estimated_value: null,
        source_url: `${BASE_URL}${path}`,
        opportunity_type: "RFP",
        eligibility_summary: null,
        experience_level: null,
        submission_language: "English",
        source_tier: 1,
        source_name: "JICA",
      });
    }

    if (tenders.length === 0) {
      return {
        platform: "JICA", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "JICA yielded 0 tenders after detail fetch",
      };
    }

    return { platform: "JICA", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "JICA", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
