/**
 * AfDB — African Development Bank project procurement notices.
 * The public documents listing is Cloudflare-protected, so this reuses the
 * existing browser worker used by other protected sources.
 */
import { normalizeSector } from "./sector-map";
import { type CrawlResult, type RawTender, withRetry } from "./types";
import { browserAvailable, fetchViaBrowser } from "./_browser";

const LISTING_URL = "https://www.afdb.org/en/documents/category/specific-procurement-notices";
const BASE_URL = "https://www.afdb.org";
const MAX_PAGES = 2;
const BROWSER_TIMEOUT_MS = 60000;

interface AfDBItem {
  title: string;
  url: string;
  published: string | null;
  country: string | null;
  sector: string | null;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ");
}

function cleanText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function absoluteUrl(url: string): string {
  return url.startsWith("http") ? url : `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function toISO(raw: string | null): string | null {
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/(\d{1,2})[-\s]+([A-Za-z]+)[-\s,]+(\d{4})/);
  if (match) {
    const mm = MONTHS[match[2].toLowerCase()];
    if (mm) return `${match[3]}-${mm}-${match[1].padStart(2, "0")}`;
  }
  return null;
}

function inferCountry(title: string): string | null {
  const match = title.match(/^(?:SPN|EOI|GPN|REOI)\s*-\s*([^-]+?)\s*-/i);
  const country = match?.[1]?.trim();
  return country || null;
}

function inferType(title: string): string {
  const prefix = title.match(/^([A-Z]{2,5})\s*-/)?.[1]?.toUpperCase();
  if (prefix === "EOI" || prefix === "REOI") return "EOI";
  if (prefix === "GPN") return "General Procurement Notice";
  if (prefix === "SPN") return "Specific Procurement Notice";
  return "Procurement Notice";
}

function parseItems(html: string): AfDBItem[] {
  const blocks = [
    ...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
    ...html.matchAll(/<div[^>]*class="[^"]*(?:views-row|document|node)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi),
  ].map((match) => match[1]);

  const seen = new Set<string>();
  const items: AfDBItem[] = [];
  for (const block of blocks) {
    if (!/specific procurement|procurement notice|SPN|EOI|GPN/i.test(block)) continue;
    const link =
      block.match(/href="([^"]*(?:specific-procurement-notices|procurement-notices|\/documents\/)[^"]*)"/i) ??
      block.match(/href="([^"]+)"/i);
    const heading =
      block.match(/<h[2-4][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[2-4]>/i)?.[1] ??
      block.match(/<a[^>]*>([\s\S]*?(?:SPN|EOI|GPN)[\s\S]*?)<\/a>/i)?.[1];
    const title = cleanText(heading);
    if (!link || !title || title.length < 10) continue;

    const url = absoluteUrl(decodeEntities(link[1]));
    if (seen.has(url)) continue;
    seen.add(url);

    const publishedRaw =
      cleanText(block.match(/Publication Date:\s*<\/?[^>]*>\s*([\s\S]{1,80}?)(?:<|$)/i)?.[1]) ??
      cleanText(block.match(/(?:Date|Published):\s*([\s\S]{1,80}?)(?:<|$)/i)?.[1]);
    const sector =
      cleanText(block.match(/Sector:\s*<\/?[^>]*>\s*([\s\S]{1,80}?)(?:<|$)/i)?.[1]);

    items.push({
      title,
      url,
      published: toISO(publishedRaw),
      country: inferCountry(title),
      sector,
    });
  }
  return items;
}

async function fetchPage(page: number): Promise<string> {
  const url = page === 0 ? LISTING_URL : `${LISTING_URL}?page=${page}`;
  const resp = await fetchViaBrowser(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: LISTING_URL,
    },
    warmupUrl: LISTING_URL,
    mode: "navigate",
    waitForSelector: "a[href*='procurement'], a[href*='documents']",
    waitAfterNav: 800,
    waitMs: 3000,
    timeoutMs: BROWSER_TIMEOUT_MS,
  });
  if (!resp.ok) throw new Error(`AfDB page ${page} HTTP ${resp.status}: ${resp.body.slice(0, 180)}`);
  if (/Just a moment|cf-challenge|Enable JavaScript and cookies/i.test(resp.body)) {
    throw new Error(`AfDB page ${page} returned Cloudflare challenge HTML`);
  }
  return resp.body;
}

function mapItem(item: AfDBItem): RawTender {
  const id = item.url.split("/").filter(Boolean).pop() ?? item.title;
  const description = [
    "African Development Bank project procurement notice.",
    item.published ? `Publication date: ${item.published}.` : null,
    item.country ? `Geography: ${item.country}.` : null,
  ].filter(Boolean).join(" ");
  const sectors = normalizeSector(item.sector, item.title, description);

  return {
    reference_id: `AFDB-${id}`.replace(/[^a-z0-9-]+/gi, "-").slice(0, 120),
    title: item.title.slice(0, 500),
    description,
    agency: "African Development Bank",
    country: item.country ?? "Africa",
    country_code: null,
    region: "Africa",
    sector: sectors[0] ?? null,
    deadline: null,
    estimated_value: null,
    source_url: item.url,
    opportunity_type: inferType(item.title),
    eligibility_summary: "Follow the AfDB notice and borrower procurement instructions.",
    experience_level: null,
    submission_language: "English/French",
    source_tier: 1,
    source_name: "AfDB",
  };
}

export async function crawlAfDB(): Promise<CrawlResult> {
  const start = Date.now();
  if (!browserAvailable()) {
    return {
      platform: "AfDB",
      status: "failure",
      tenders: [],
      durationMs: 0,
      error: "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set — AfDB sits behind Cloudflare",
    };
  }

  try {
    const tenders: RawTender[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const html = await withRetry(() => fetchPage(page), 1);
      const items = parseItems(html);
      if (!items.length) break;
      for (const item of items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        tenders.push(mapItem(item));
      }
    }

    if (!tenders.length) {
      return {
        platform: "AfDB",
        status: "failure",
        tenders: [],
        durationMs: Date.now() - start,
        error: "AfDB listing parsed but yielded 0 procurement notices",
      };
    }

    return { platform: "AfDB", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "AfDB",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
