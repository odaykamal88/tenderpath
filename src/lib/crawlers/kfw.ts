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

function parseListingLinks(html: string): Array<{ path: string; title: string; deadline: string | null; country: string | null; category: string | null; description: string | null }> {
  const itemRe = /<li[^>]*class="[^"]*\bresult-item\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  const seen = new Set<string>();
  const out: Array<{ path: string; title: string; deadline: string | null; country: string | null; category: string | null; description: string | null }> = [];
  let item: RegExpExecArray | null;
  while ((item = itemRe.exec(html)) !== null) {
    const block = item[1];
    if (!/Tender Notice/i.test(block) || !/KfW Entwicklungsbank|KfW Development Bank/i.test(block)) continue;
    const link = block.match(/href="(\/en\/trade\/[^"]*\/tenders\/[^"]+)"/i);
    const title = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!link || !title) continue;
    const path = link[1].split("?")[0];
    const pathCountry = path.match(/^\/en\/trade\/([^/]+)\//)?.[1]?.replace(/-/g, " ");
    const overline = [...block.matchAll(/<span[^>]*class="[^"]*overline__text[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean);
    const deadlineRaw = stripTags(block.match(/Deadline:\s*<\/p>\s*<p>|Deadline:\s*([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const excerpt = stripTags(block.match(/<p[^>]*class="[^"]*excerpt[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    if (!seen.has(path) && title) {
      seen.add(path);
      out.push({
        path,
        title,
        deadline: deadlineRaw ? parseDeadline(deadlineRaw) : null,
        country: pathCountry ? pathCountry.charAt(0).toUpperCase() + pathCountry.slice(1) : overline.find((text) => !/tender notice|contract award|event|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|for german companies/i.test(text)) ?? null,
        category: overline.at(-1) ?? null,
        description: excerpt || null,
      });
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
  const months: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", september: "09", oct: "10", october: "10",
    nov: "11", november: "11", dec: "12", december: "12",
  };
  const worded = html.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (worded) {
    const mm = months[worded[1].toLowerCase()];
    if (mm) return `${worded[3]}-${mm}-${worded[2].padStart(2, "0")}`;
  }
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
  const html = await resp.text();
  if (/ss_captcha\.png|class="h-captcha"|Captcha Page/i.test(html)) {
    throw new Error("KfW/GTAI listing is blocked by PerfDrive captcha");
  }
  return html;
}

async function fetchDetail(path: string): Promise<{ deadline: string | null; description: string | null; country: string | null; reference: string | null; estimated_value: string | null }> {
  const url = `${BASE_URL}${path}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 20000);
  if (!resp.ok) return { deadline: null, description: null, country: null, reference: null, estimated_value: null };
  const html = await resp.text();

  const deadlineSection = html.match(/(?:[Ss]ubmission|[Dd]eadline|[Aa]ngebotsschluss)[^<]*<[^>]+>([^<]+)/);
  const deadline = deadlineSection ? parseDeadline(deadlineSection[1]) : parseDeadline(html.slice(0, 3000));

  const countryM = html.match(/(?:[Cc]ountry|[Ll]and)[^:]*:?\s*<[^>]+>([^<]+)/);
  const country = countryM?.[1]?.trim() ?? null;

  const refM = html.match(/(?:[Rr]eference|[Tt]ender\s*[Nn]o\.?)[^:]*:?\s*<[^>]+>([^<]+)/);
  const reference = refM?.[1]?.trim() ?? null;

  const bodyM = html.match(/<div[^>]*class="[^"]*(?:article|body|content|text)[^"]*"[^>]*>([\s\S]{100,1500}?)<\/div>/i);
  const description = bodyM ? stripTags(bodyM[1]).slice(0, 600) || null : null;

  // Extract contract/budget value from GTAI detail page structured fields.
  // GTAI typically renders key-value pairs like "Estimated Contract Value: EUR 500,000"
  const valueM = html.match(
    /(?:[Cc]ontract\s+[Vv]alue|[Ee]stimated\s+[Vv]alue|[Bb]udget|[Aa]uftragswert)[^<]*<[^>]+>\s*([^<]{3,80})/,
  );
  const estimated_value = valueM ? stripTags(valueM[1]).replace(/\s+/g, " ").trim() || null : null;

  return { deadline, description, country, reference, estimated_value };
}

export async function crawlKfW(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const allLinks: Array<{ path: string; title: string; deadline: string | null; country: string | null; category: string | null; description: string | null }> = [];
    let listingFailure: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let html: string;
      try {
        html = await withRetry(() => fetchListingPage(page));
      } catch (err) {
        listingFailure = err instanceof Error ? err.message : String(err);
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
        error: listingFailure
          ? `KfW/GTAI listing unavailable: ${listingFailure}`
          : "KfW/GTAI listing returned no tender links",
      };
    }

    const tenders: RawTender[] = [];
    for (const { path, title, deadline, country, category, description } of allLinks) {
      let detail = { deadline: null as string | null, description: null as string | null, country: null as string | null, reference: null as string | null, estimated_value: null as string | null };
      try {
        detail = await withRetry(() => fetchDetail(path));
      } catch (err) {
        console.error(`[kfw] detail ${path} failed:`, err instanceof Error ? err.message : err);
      }

      const idPart = path.split("--").pop() ?? path.split("/").pop() ?? path;
      const refId = detail.reference ? `KFW-${detail.reference.replace(/\s+/g, "-")}` : `KFW-${idPart}`;
      const mergedDescription = detail.description ?? description;
      const sectors = normalizeSector(category, title, mergedDescription);

      tenders.push({
        reference_id: refId,
        title,
        description: mergedDescription,
        agency: "KfW",
        country: detail.country && !/for german companies/i.test(detail.country) ? detail.country : country ?? "Global",
        country_code: null,
        region: null,
        sector: sectors[0] ?? null,
        deadline: detail.deadline ?? deadline,
        estimated_value: detail.estimated_value,
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
