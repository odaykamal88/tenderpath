/**
 * UNDP Atlas (MENA-scoped deep crawl).
 *
 * Why this exists alongside `undp.ts`:
 *   - The light crawler (`undp.ts`) pulls every row off the listing page but
 *     leaves `description`, `sector`, and `country_code` null. For matching,
 *     that's a dead end — UN tender titles are generic boilerplate, so the
 *     real signal lives in the Overview block on the detail page.
 *   - UNDP Atlas eTendering is being retired; country-office postings now
 *     aggregate at `procurement-notices.undp.org`. The old URL structure is
 *     gone, so this crawler targets the aggregator directly.
 *   - Country filtering on the aggregator is client-side JavaScript; the
 *     server returns the full ~1.8MB listing regardless of query params.
 *     We parse all rows, filter to MENA countries, then fan out per-notice
 *     GETs to enrich description + metadata.
 *
 * Scoped to MENA countries per user request — avoids beating up the origin
 * with 200+ detail fetches per run when we really only care about ~20-30
 * MENA postings at a time.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

const LIST_URL = "https://procurement-notices.undp.org/";
const BASE = "https://procurement-notices.undp.org/";

// MENA country names as they appear in the "UNDP Office/Country" cell —
// matched case-insensitively. UNDP uppercases the country portion (e.g.,
// "UNOPS - SYRIA"), sometimes with trailing whitespace. The `Palestine`
// variants cover both "PALESTINE" and "STATE OF PALESTINE" forms.
const MENA_COUNTRIES = new Set<string>([
  "algeria",
  "bahrain",
  "egypt",
  "iran",
  "iraq",
  "israel",
  "jordan",
  "kuwait",
  "lebanon",
  "libya",
  "morocco",
  "oman",
  "palestine",
  "state of palestine",
  "qatar",
  "saudi arabia",
  "sudan",
  "syria",
  "syrian arab republic",
  "tunisia",
  "uae",
  "united arab emirates",
  "yemen",
]);

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // "21-Apr-26" or "21-Apr-26 01:00 PM (New York time)"
  const m = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mo = MONTHS[m[2]];
  if (!mo) return null;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yr}-${mo}-${day}`;
}

function mapProcess(p?: string): string {
  const t = (p ?? "").toLowerCase();
  if (t.includes("rfq") || t.includes("quotation")) return "RFQ";
  if (t.includes("eoi") || t.includes("expression")) return "EOI";
  if (t.includes("itb") || t.includes("invitation to bid")) return "ITB";
  if (t.includes("rfp") || t.includes("proposal")) return "RFP";
  if (t.includes("ican") || t.includes("ica")) return "Consultancy";
  return "RFP";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface ListingRow {
  noticeId: string;
  href: string;
  title: string;
  office: string;    // "UNOPS" (before slash)
  country: string;   // Title-cased, e.g. "Syria"
  deadline: string | null;
  process: string;   // Raw "Process" cell value
  refNo: string | null;
}

function normalizeCountry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Global";
  return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
}

function extractCells(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const cellRe = /<div class="vacanciesTable__cell__label">\s*([^<]+?)\s*<\/div>\s*<span>([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(block)) !== null) {
    out[m[1].replace(/\s+/g, " ").trim()] = stripTags(m[2]);
  }
  return out;
}

function parseListing(html: string): ListingRow[] {
  const rows: ListingRow[] = [];
  // Accept both URL schemes — older notices go through view_notice.cfm,
  // newer country-office RFPs (~97% of rows, including the Lebanon solar
  // curricula RFP) go through view_negotiation.cfm. See undp.ts for the
  // diagnostic write-up.
  const rowRe =
    /<a\s+href="((?:view_notice\.cfm\?notice_id|view_negotiation\.cfm\?nego_id)=(\d+))"[^>]*class="[^"]*vacanciesTableLink[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const href = m[1];
    const id = m[2];
    const block = m[3];
    const cells = extractCells(block);
    const title = cells["Title"];
    if (!title) continue;
    const office = cells["UNDP Office/Country"] ?? "";
    const parts = office.split("/");
    const rawCountry = (parts.pop() ?? "").trim();
    rows.push({
      noticeId: id,
      href,
      title: decodeEntities(title).slice(0, 500),
      office: (parts[0] ?? "UNDP").trim() || "UNDP",
      country: normalizeCountry(rawCountry),
      deadline: parseDate(cells["Deadline"]),
      process: cells["Process"] ?? "",
      refNo: cells["Ref No"] ?? null,
    });
  }
  return rows;
}

/**
 * Pull Overview HTML + structured metadata from the notice detail page.
 * Detail-page structure (confirmed empirically):
 *   <div class="post-wrapper"><h2>Title</h2></div>
 *   <div class="postMetadata__category"><h6>Label</h6><p>Value</p></div> x N
 *   <div class="... postContent"><h2>Overview</h2><p>...</p>...</div>
 */
interface NoticeDetail {
  description: string | null;
  overviewHtml: string | null;
  metadata: Record<string, string>;
}

function parseDetail(html: string): NoticeDetail {
  const metadata: Record<string, string> = {};
  const metaRe =
    /<div[^>]*class="[^"]*postMetadata__category[^"]*"[^>]*>\s*<h6[^>]*>([\s\S]*?)<\/h6>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const label = decodeEntities(stripTags(m[1]));
    const value = decodeEntities(stripTags(m[2]));
    if (label) metadata[label] = value;
  }

  // Overview block: first <h2>Overview</h2> inside the postContent cell.
  // The detail page emits the heading then flows paragraphs until the next
  // postMetadata or closing wrapper. We grab a generous chunk and clean it.
  let overviewHtml: string | null = null;
  let description: string | null = null;
  const postContentMatch = html.match(
    /<div[^>]*class="[^"]*postContent[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*class="[^"]*post(?:Metadata|Footer)|<footer|$)/i,
  );
  if (postContentMatch) {
    const block = postContentMatch[1];
    // Strip the Overview heading and lead-in; keep body text. Cap at 4KB so
    // one rogue notice with a 200KB table doesn't blow up DB rows.
    const bodyText = decodeEntities(stripTags(block)).slice(0, 4000).trim();
    if (bodyText.length > 30) {
      overviewHtml = block;
      description = bodyText;
    }
  }

  return { description, overviewHtml, metadata };
}

async function fetchDetail(href: string): Promise<NoticeDetail | null> {
  // Use the captured href verbatim — notices on view_negotiation.cfm return
  // 404 if we force view_notice.cfm?notice_id=N.
  const url = `${BASE}${href}`;
  try {
    const resp = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      20000,
    );
    if (!resp.ok) return null;
    return parseDetail(await resp.text());
  } catch {
    return null;
  }
}

// Conservative concurrency + randomized jitter — we're hitting a single
// origin for up to ~30 notices; 3-way fan-out keeps us well inside polite
// crawl norms.
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MIN_MS = 400;
const DETAIL_DELAY_MAX_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  DETAIL_DELAY_MIN_MS + Math.floor(Math.random() * (DETAIL_DELAY_MAX_MS - DETAIL_DELAY_MIN_MS));

function isMena(country: string): boolean {
  return MENA_COUNTRIES.has(country.toLowerCase());
}

function rowToTender(row: ListingRow, detail: NoticeDetail | null): RawTender {
  return {
    reference_id: `UNDP-ATLAS-${row.refNo ?? row.noticeId}`,
    title: row.title,
    description: detail?.description ?? null,
    agency: row.office,
    country: row.country,
    country_code: null,
    region: "MENA",
    sector: null,
    deadline: row.deadline ?? parseDate(detail?.metadata["Deadline"] ?? null),
    estimated_value: null,
    source_url: `${BASE}${row.href}`,
    opportunity_type: mapProcess(row.process || detail?.metadata["Procurement Process"]),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "UNDP Atlas",
  };
}

export async function crawlUNDPAtlas(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const html = await withRetry(async () => {
      const resp = await fetchWithTimeout(
        LIST_URL,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
        },
        30000,
      );
      if (!resp.ok) throw new Error(`UNDP Atlas listing ${resp.status}`);
      return resp.text();
    });

    const all = parseListing(html);
    const mena = all.filter((r) => isMena(r.country));

    // Bounded-concurrency fan-out with randomized jitter between pops.
    const enriched: RawTender[] = [];
    let idx = 0;
    async function worker() {
      while (idx < mena.length) {
        const i = idx++;
        const row = mena[i];
        if (i > 0) await sleep(randomDelay());
        const detail = await fetchDetail(row.href);
        enriched.push(rowToTender(row, detail));
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(DETAIL_CONCURRENCY, mena.length) }, worker),
    );

    return {
      platform: "UNDP Atlas",
      status: "success",
      tenders: enriched,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      platform: "UNDP Atlas",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
