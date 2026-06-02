/**
 * IsDB — Islamic Development Bank project-procurement tenders.
 *
 * NOTE: distinct from `idb.ts`, which is the *Inter-American* Development Bank.
 * IsDB is its own multilateral and is NOT on UNGM or the World Bank feed, so this
 * is genuinely new, non-duplicate coverage across MENA and Muslim-majority
 * countries — TenderPath's MENA "unfair advantage."
 *
 * The public listing (https://www.isdb.org/project-procurement/tenders) is a
 * server-rendered Drupal Views page. Each `views-row` card carries everything we
 * need without a detail fetch: title + link, tender type (EOI / GPN / SPN / PQN /
 * contract-award), beneficiary country, and the close date.
 *
 * Open/closed signal: the exposed `status=active` filter is JS/AJAX-only (a plain
 * GET returns the default view) and the cards' status taxonomy reads "closed" even
 * for current rows, so neither is reliable. The close date is the source of truth —
 * we keep only rows whose close date is in the future and drop contract-award rows
 * (already-decided, can't be bid on). The listing is newest-first, so open tenders
 * surface at the top when IsDB has them.
 */
import { normalizeSector } from "./sector-map";
import { type CrawlResult, type RawTender, fetchWithTimeout, withRetry } from "./types";
import { browserAvailable, fetchViaBrowser } from "./_browser";

const BASE_URL = "https://www.isdb.org";
const LISTING_URL = `${BASE_URL}/project-procurement/tenders`;
const MAX_PAGES = 3;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export interface IsdbRow {
  nid: string;
  title: string;
  url: string;
  country: string | null;
  type: string;          // taxonomy slug: eoi | gpn | spn | pqn | contract-award
  closeDate: string | null; // ISO yyyy-mm-dd
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#0?39;|&#x27;/gi, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
}

function parseCloseDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${mo}-${m[1].padStart(2, "0")}`;
}

export function parseIsdbListing(html: string): IsdbRow[] {
  const rows: IsdbRow[] = [];
  const seen = new Set<string>();
  for (const segRaw of html.split(/class="views-row"/).slice(1)) {
    const seg = segRaw.slice(0, 3000);
    const nid = seg.match(/data-nid="(\d+)"/)?.[1];
    const link = seg.match(/<div class="field-title[^"]*"[^>]*>\s*<h2>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!nid || !link || seen.has(nid)) continue;
    const url = link[1].startsWith("http") ? link[1] : `${BASE_URL}${link[1]}`;
    const title = decode(link[2].replace(/<[^>]+>/g, " "));
    if (!title) continue;
    const type = seg.match(/vocabulary-tender-type slug-([a-z-]+)/i)?.[1]?.toLowerCase() ?? "";
    const country = decode(seg.match(/field--name-field-world-country[^>]*field--item">([^<]+)</i)?.[1] ?? "") || null;
    const closeRaw = seg.match(/field--name-field-close-date[\s\S]*?<time[^>]*>([^<]+)<\/time>/i)?.[1] ?? null;
    seen.add(nid);
    rows.push({ nid, title: title.slice(0, 500), url, country, type, closeDate: parseCloseDate(closeRaw) });
  }
  return rows;
}

function mapType(slug: string): string {
  switch (slug) {
    case "eoi": return "EOI";
    case "spn": return "RFP";          // specific procurement notice — the actual tender
    case "gpn": return "Prior Information"; // general procurement notice — early heads-up
    case "pqn": return "Prequalification";
    default: return "RFP";
  }
}

export function mapRow(row: IsdbRow): RawTender {
  const typeLabel: Record<string, string> = {
    eoi: "Expression of Interest", spn: "Specific Procurement Notice",
    gpn: "General Procurement Notice", pqn: "Prequalification Notice",
  };
  const description = [
    `IsDB-financed procurement notice (${typeLabel[row.type] ?? row.type.toUpperCase()}).`,
    row.country ? `Country: ${row.country}.` : null,
    row.closeDate ? `Closing date: ${row.closeDate}.` : null,
    row.title,
  ].filter(Boolean).join(" ");
  return {
    reference_id: `ISDB-${row.nid}`,
    title: row.title,
    description,
    agency: "Islamic Development Bank (IsDB)",
    country: row.country ?? "Global",
    country_code: null,
    region: null,
    sector: normalizeSector("", row.title, description)[0] ?? null,
    deadline: row.closeDate,
    estimated_value: null,
    source_url: row.url,
    opportunity_type: mapType(row.type),
    eligibility_summary: "Follow the IsDB notice instructions and supplier/consultant registration requirements.",
    experience_level: null,
    submission_language: "English/French",
    source_tier: 1,
    source_name: "IsDB",
    category: row.type,
  };
}

async function fetchPage(page: number): Promise<string> {
  const url = page === 0 ? LISTING_URL : `${LISTING_URL}?page=${page}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 25000).catch(() => null);
  if (resp?.ok) {
    const body = await resp.text();
    if (/views-row/.test(body)) return body;
  }
  if (browserAvailable()) {
    const rendered = await fetchViaBrowser(url, {
      headers: HEADERS,
      warmupUrl: LISTING_URL,
      mode: "navigate",
      waitForSelector: ".views-row, article.type-tender",
      waitAfterNav: 600,
      timeoutMs: 90000,
    });
    if (rendered.ok && /views-row/.test(rendered.body)) return rendered.body;
    throw new Error(`IsDB tenders page ${page} browser fallback ${rendered.status}: ${rendered.body.slice(0, 160)}`);
  }
  throw new Error(`IsDB tenders page ${page} HTTP ${resp?.status ?? "error"}`);
}

export async function crawlISDB(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows: IsdbRow[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      const html = await withRetry(() => fetchPage(page), 2);
      const parsed = parseIsdbListing(html);
      if (!parsed.length) break;
      let openOnPage = 0;
      for (const row of parsed) {
        if (seen.has(row.nid)) continue;
        seen.add(row.nid);
        // Drop already-decided awards; keep only open (future close date) biddable notices.
        if (row.type === "contract-award") continue;
        if (!row.closeDate || row.closeDate < today) continue;
        rows.push(row);
        openOnPage++;
      }
      // Listing is newest-first; once a full page has no open rows, older pages won't either.
      if (openOnPage === 0) break;
    }

    const tenders = rows.map(mapRow);
    return { platform: "IsDB", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "IsDB", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
