/**
 * ADA — Austrian Development Agency.
 * Server-rendered TYPO3 HTML listing at entwicklung.at.
 * Very low volume (3-15 active tenders), single page.
 * No CF protection.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

// English calls listing — the /en/ada/calls path is the canonical active-calls page.
// The /ada/auftraege path shows completed awarded contracts (not open tenders).
const LISTING_URL = "https://www.entwicklung.at/en/ada/calls";
const BASE_URL = "https://www.entwicklung.at";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
  Accept: "text/html",
};

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

function parseAdaDate(raw: string): string | null {
  // "15.05.2026" or "15 May 2026" or "2026-05-15"
  const dmy = raw.match(/(\d{1,2})\.(\d{2})\.(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1].padStart(2, "0")}`;
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const worded = raw.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (worded) {
    const mm = MONTHS[worded[2].toLowerCase()];
    if (mm) return `${worded[3]}-${mm}-${worded[1].padStart(2, "0")}`;
  }
  return null;
}

function cleanText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface AdaItem {
  title: string;
  url: string;
  deadline: string | null;
  description: string | null;
  country: string | null;
}

function parseListing(html: string): AdaItem[] {
  const items: AdaItem[] = [];
  // TYPO3 detail cards use this article class inside the calls listing.
  const blockRe = /<div[^>]*class="[^"]*\barticle\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(html)) !== null) {
    const block = bm[1];
    if (!/calls-list-date|calls-detail/i.test(block)) continue;
    const linkM =
      block.match(/href="([^"]*calls-detail[^"]*)"/i) ??
      block.match(/href="([^"]*\/ada\/calls\/[^"]*)"/i);
    if (!linkM) continue;
    const path = linkM[1].startsWith("http") ? linkM[1] : `${BASE_URL}${linkM[1]}`;
    const titleM = block.match(/<(?:h\d|strong|a)[^>]*>([\s\S]*?)<\/(?:h\d|strong|a)>/i);
    const title = titleM?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    if (!title || title.length < 5) continue;

    const deadlineM = block.match(/(?:[Dd]eadline|[Ss]ubmission\s+[Dd]ate|[Ee]insendeschluss)[^<]*(?:<[^>]+>)?([^<]+)/);
    const deadline = deadlineM ? parseAdaDate(deadlineM[1]) : null;

    const desc = cleanText(block).slice(0, 400) || null;

    items.push({ title, url: path, deadline, description: desc, country: null });
  }
  return items;
}

async function enrichDetail(item: AdaItem): Promise<AdaItem> {
  const resp = await fetchWithTimeout(item.url, { headers: HEADERS }, 20000);
  if (!resp.ok) return item;
  const html = await resp.text();
  const main =
    html.match(/<div[^>]*class="[^"]*(?:calls|news-single|content|main)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    "";
  const detailText = cleanText(main);
  const deadlineRaw =
    detailText.match(/deadline(?: for submission of applications)? is\s+(.{6,40}?)(?:\.|$)/i)?.[1] ??
    detailText.match(/Deadline:\s*(.{6,40}?)(?:\.|$)/i)?.[1] ??
    null;
  const country =
    detailText.match(/\bPlace\s+([^.,;]{3,80})/i)?.[1]?.trim() ??
    item.country;

  return {
    ...item,
    deadline: item.deadline ?? (deadlineRaw ? parseAdaDate(deadlineRaw) : null),
    description: detailText.slice(0, 700) || item.description,
    country,
  };
}

export async function crawlADA(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const resp = await withRetry(() =>
      fetchWithTimeout(LISTING_URL, { headers: HEADERS }, 20000),
    );
    if (!resp.ok) throw new Error(`ADA listing HTTP ${resp.status}`);
    const html = await resp.text();

    const items = parseListing(html);
    if (!items.length) {
      return {
        platform: "ADA", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "ADA listing returned no tender items",
      };
    }

    const enriched: AdaItem[] = [];
    for (const item of items) {
      try {
        enriched.push(await withRetry(() => enrichDetail(item), 2));
      } catch (err) {
        console.error(`[ada] detail ${item.url} failed:`, err instanceof Error ? err.message : err);
        enriched.push(item);
      }
    }

    const tenders: RawTender[] = enriched.map((item, i) => {
      const slug = item.url.split("/").filter(Boolean).pop() ?? `ada-${i}`;
      const sectors = normalizeSector(null, item.title, item.description);
      return {
        reference_id: `ADA-${slug}`,
        title: item.title,
        description: item.description,
        agency: "ADA",
        country: item.country ?? "Global",
        country_code: null,
        region: null,
        sector: sectors[0] ?? null,
        deadline: item.deadline,
        estimated_value: null,
        source_url: item.url,
        opportunity_type: "RFP",
        eligibility_summary: null,
        experience_level: null,
        submission_language: "English",
        source_tier: 1,
        source_name: "ADA",
      };
    });

    return { platform: "ADA", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "ADA", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
