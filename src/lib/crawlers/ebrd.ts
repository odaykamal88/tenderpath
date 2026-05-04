/**
 * EBRD — European Bank for Reconstruction and Development.
 * Procurement notices live on ECEPP (Electronic Contract Opportunities Portal):
 *   https://ecepp.ebrd.com/delta/viewNoticesPublic.html
 * Public search results render to HTML; each notice link is:
 *   /delta/viewNotice.html?displayId=<id>
 *
 * Volume: ~1–2k open notices, focus on Central/Eastern Europe, Central Asia,
 * North Africa, Eastern Mediterranean — the EBRD's 38 countries of operations.
 *
 * Override `EBRD_NOTICES_URL` to point at a mirror if ECEPP is blocked.
 */
import { type RawTender, type CrawlResult, withRetry } from "./types";
import { fetchViaBrowser, browserAvailable } from "./_browser";

const BASE = process.env.EBRD_NOTICES_URL ?? "https://ecepp.ebrd.com/delta/viewNoticesPublic.html";
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ECEPP returns an empty body (0 bytes) to plain fetch — the notice list is
// rendered client-side by a Delta/JSF framework after JS execution. Only a
// real browser fills the listing. Route through the worker like UNGM/GIZ and
// give it a generous waitMs so the Ajax list call has time to complete.
async function fetchPage(page: number): Promise<string> {
  const url = page === 0 ? BASE : `${BASE}?pageIndex=${page}`;
  const resp = await fetchViaBrowser(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: BASE,
    },
    warmupUrl: BASE,
    // ECEPP is a Delta/JSF SPA — plain DOM fetch returns an empty shell.
    // Use navigate mode so Chromium actually loads the page, runs the JSF
    // init, and waits for the notice table to populate before we snapshot.
    mode: "navigate",
    waitForSelector: "a[href*='viewNotice.html?displayId=']",
    waitAfterNav: 1500,
    waitMs: 2000,
    timeoutMs: 120000,
  });
  if (!resp.ok) throw new Error(`EBRD page ${page} ${resp.status}: ${resp.body.slice(0, 200)}`);
  if (resp.finalUrl?.includes("/cas/login") || /<form[^>]+login|name="username"|cas\/login/i.test(resp.body)) {
    throw new Error(
      `EBRD public notice list redirected to login (${resp.finalUrl ?? "unknown final URL"}) — public ECEPP listing access changed`,
    );
  }
  return resp.body;
}

interface ParsedNotice {
  id: string;
  title: string;
  country: string;
  noticeType: string;
  deadline: string | null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
  "&#039;": "'", "&#39;": "'", "&nbsp;": " ",
};

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ECEPP renders each notice inside a result card or row; every card contains
// a link matching viewNotice.html?displayId=NNNNN. Anchor on that link.
function parseNotices(html: string): ParsedNotice[] {
  const out: ParsedNotice[] = [];
  const seen = new Set<string>();
  const rowRe = /<(tr|div|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const linkRe = /href="[^"]*viewNotice\.html\?displayId=(\d+)"[^>]*>([\s\S]*?)<\/a>/i;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const inner = m[2];
    const link = linkRe.exec(inner);
    if (!link) continue;
    const id = link[1];
    if (seen.has(id)) continue;

    const title = cleanText(link[2]);
    if (!title) continue;
    seen.add(id);

    // Grab nearby text labelled Country / Deadline / Notice Type. ECEPP uses
    // <span class="label">Country:</span> <span>…</span> patterns fairly
    // consistently; we tolerate either labelled spans or raw colon phrases.
    const country = pickField(inner, /Country[^<>]{0,20}<\/[^>]+>\s*<[^>]+>([^<]+)</i)
      ?? pickField(inner, /Country\s*:\s*([^<|\n]+?)(?:\s*[|<])/i)
      ?? "";
    const noticeType = pickField(inner, /Notice\s*Type[^<>]{0,20}<\/[^>]+>\s*<[^>]+>([^<]+)</i)
      ?? pickField(inner, /Notice\s*Type\s*:\s*([^<|\n]+?)(?:\s*[|<])/i)
      ?? "";
    const deadlineRaw = pickField(inner, /(?:Closing\s*Date|Deadline)[^<>]{0,20}<\/[^>]+>\s*<[^>]+>([^<]+)</i)
      ?? pickField(inner, /(?:Closing\s*Date|Deadline)\s*:\s*([^<|\n]+?)(?:\s*[|<])/i)
      ?? "";

    out.push({
      id,
      title,
      country: country || "EBRD Region",
      noticeType,
      deadline: toISO(deadlineRaw),
    });
  }
  return out;
}

function pickField(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  if (!m) return null;
  return cleanText(m[1]);
}

// ECEPP deadlines are "31-Dec-2026" or "31/12/2026 14:00" — cover both.
function toISO(raw: string): string | null {
  if (!raw) return null;
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  let m = /(\d{1,2})[-/\s]([A-Za-z]{3})\w*[-/\s](\d{4})/.exec(raw);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function mapType(notice: string): string {
  const s = notice.toLowerCase();
  if (s.includes("expression of interest") || s.includes("eoi")) return "EOI";
  if (s.includes("invitation for tender") || s.includes("ift") || s.includes("itb")) return "ITB";
  if (s.includes("request for quotation") || s.includes("rfq")) return "RFQ";
  if (s.includes("consultant") || s.includes("consulting")) return "Consultancy";
  if (s.includes("prequalification") || s.includes("pre-qualif")) return "EOI";
  return "RFP";
}

function mapNotice(n: ParsedNotice): RawTender {
  return {
    reference_id: `EBRD-${n.id}`,
    title: n.title.slice(0, 500),
    description: null,
    agency: "European Bank for Reconstruction and Development",
    country: n.country || "EBRD Region",
    country_code: null,
    region: null,
    sector: null,
    deadline: n.deadline,
    // ECEPP listing rows don't include contract value; it appears only on
    // individual notice detail pages (JSF SPA, requires a separate browser
    // render per notice). Not fetched here to avoid multiplying worker calls.
    estimated_value: null,
    source_url: `https://ecepp.ebrd.com/delta/viewNotice.html?displayId=${n.id}`,
    opportunity_type: mapType(n.noticeType),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "EBRD",
  };
}

export async function crawlEBRD(): Promise<CrawlResult> {
  const start = Date.now();
  if (!browserAvailable()) {
    return {
      platform: "EBRD", status: "failure", tenders: [], durationMs: 0,
      error: "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set — ECEPP list renders client-side",
    };
  }
  try {
    const tenders: RawTender[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS);
      const html = await withRetry(() => fetchPage(page), 1);
      const rows = parseNotices(html);
      if (!rows.length) break;
      let added = 0;
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        tenders.push(mapNotice(r));
        added++;
      }
      if (added === 0) break;
    }
    if (!tenders.length) {
      return {
        platform: "EBRD", status: "failure", tenders: [], durationMs: Date.now() - start,
        error: "EBRD page parsed but yielded 0 rows — ECEPP markup likely changed",
      };
    }
    return { platform: "EBRD", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "EBRD", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
