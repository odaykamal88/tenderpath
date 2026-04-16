/**
 * UNGM — UN Global Marketplace. Canonical procurement hub for ~50 UN agencies
 * (UNICEF, WFP, WHO, UNHCR, IOM, UNDP, UNFPA, UNESCO, UNOPS, FAO, etc.) that
 * post here by mandate. Sits behind Cloudflare bot protection, so requests
 * are routed through a Bright Data residential proxy.
 *
 * Strategy:
 *   1. Warmup GET through the proxy seeds `cf_clearance` + session cookies.
 *   2. Paginated JSON POSTs reuse those cookies (module-level jar).
 *   3. Randomized 2-3s delay between pages — fixed cadence is trivial to
 *      fingerprint.
 *   4. One UA locked in per crawl run so jar + UA stay consistent; CF
 *      correlates both.
 */
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { type RawTender, type CrawlResult, withRetry } from "./types";
import { unspscSegmentToSlug } from "./sector-map";

// POSTing to /Public/Notice (the landing page) silently returns the HTML
// regardless of method — the real search endpoint is /Public/Notice/Search.
// Confirmed by decompiling the ungmcommon bundle's NoticeSearch.BuildOptions.
const UNGM_API = "https://www.ungm.org/Public/Notice/Search";
const UNGM_WARMUP = "https://www.ungm.org/Public/Notice";
// Server ignores PageSize and caps at ~15 rows/page regardless. We still
// send 100 (what the UI sends) so our payload matches a real browser. The
// page-loop breaks on an empty page, not on a "short" page.
const PAGE_SIZE = 100;
// 50 pages × ~15 server-capped rows ≈ 750 notices. Safe ceiling since each
// notice now triggers a detail GET (concurrency-capped, see DETAIL_*). Bumped
// from 10 once per-notice enrichment landed — the extra 600 notices carry
// real signal now that descriptions + UNSPSCs are parsed.
const MAX_PAGES = 50;
// Randomized delay window — fixed cadence is trivial to fingerprint.
const PAGE_DELAY_MIN_MS = 2000;
const PAGE_DELAY_MAX_MS = 3000;
// Per-notice detail fetch knobs. Conservative fan-out keeps us under CF's
// radar on a single session and bounds wall-clock at 50 pages × 15 notices
// / 3 workers ≈ 8min for a daily cron.
const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MIN_MS = 1500;
const DETAIL_DELAY_MAX_MS = 2500;
const detailDelay = () =>
  DETAIL_DELAY_MIN_MS + Math.floor(Math.random() * (DETAIL_DELAY_MAX_MS - DETAIL_DELAY_MIN_MS));

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
];
const pickUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  PAGE_DELAY_MIN_MS + Math.floor(Math.random() * (PAGE_DELAY_MAX_MS - PAGE_DELAY_MIN_MS));

// ---- Module-level proxy agent + cookie jar ----
// Jar is reset at the start of every crawl run so a stale cookie can't
// poison every scheduled sync until the process restarts.

let cookieJar: Map<string, string> = new Map();
let runUserAgent: string = USER_AGENTS[0];
let proxyAgent: HttpsProxyAgent<string> | null = null;

function proxyConfigured(): boolean {
  return !!(
    process.env.PROXY_HOST &&
    process.env.PROXY_PORT &&
    process.env.PROXY_USER &&
    process.env.PROXY_PASS
  );
}

function getProxyAgent(): HttpsProxyAgent<string> {
  if (proxyAgent) return proxyAgent;
  const host = process.env.PROXY_HOST!;
  const port = process.env.PROXY_PORT!;
  const user = process.env.PROXY_USER!;
  const pass = process.env.PROXY_PASS!;
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`;
  proxyAgent = new HttpsProxyAgent(`http://${auth}@${host}:${port}`);
  return proxyAgent;
}

function serializeJar(): string {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function mergeSetCookie(headers: string[] | undefined): number {
  if (!headers?.length) return 0;
  for (const raw of headers) {
    // Only the first `name=value` pair is the cookie; the rest are attributes
    // (Path=, Expires=, HttpOnly, etc.) that we don't need to round-trip.
    const first = raw.split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) continue;
    cookieJar.set(name, value);
  }
  return headers.length;
}

interface ProxyFetchOpts {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

interface ProxyFetchResult {
  status: number;
  body: string;
}

const DEBUG = !!process.env.UNGM_DEBUG;
const dlog = (...args: unknown[]) => { if (DEBUG) console.error("[ungm]", ...args); };

function proxyFetch(url: string, opts: ProxyFetchOpts): Promise<ProxyFetchResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string> = {
      "User-Agent": runUserAgent,
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity", // don't gzip — keeps string parsing simple
      Connection: "close", // new tunnel per request — avoids BrightData pool weirdness
      ...opts.headers,
    };
    const jar = serializeJar();
    if (jar) headers.Cookie = jar;

    const t0 = Date.now();
    dlog(opts.method, url, "jar=" + cookieJar.size);

    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: opts.method,
        headers,
        agent: getProxyAgent(),
        // Bright Data's residential super-proxy performs HTTPS inspection
        // and re-signs with their internal CA. Node's trust store doesn't
        // include it, so strict chain validation fails. Must be on the
        // request — setting it on HttpsProxyAgent does not propagate to
        // the target TLS wrap. Pulling public tender data via a proxy we
        // authenticate to, so skipping verification is the pragmatic call.
        rejectUnauthorized: false,
      },
      (res) => {
        dlog(`  status=${res.statusCode} at +${Date.now() - t0}ms`);
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          mergeSetCookie(res.headers["set-cookie"]);
          dlog(`  body=${body.length}B at +${Date.now() - t0}ms`);
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", (err) => { dlog(`  error at +${Date.now() - t0}ms: ${err.message}`); reject(err); });
    req.setTimeout(opts.timeoutMs ?? 45000, () => {
      dlog(`  timeout at +${Date.now() - t0}ms`);
      req.destroy(new Error("proxy fetch timeout"));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Warmup: plain GET to the Notice landing page through the proxy. Cloudflare
 * hands back `cf_clearance` + an ASP session cookie here; we stash them so
 * subsequent JSON POSTs look like navigation from the same session.
 */
async function warmup(): Promise<void> {
  const resp = await proxyFetch(UNGM_WARMUP, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: "https://www.ungm.org/",
      "Upgrade-Insecure-Requests": "1",
    },
  });
  if (resp.status !== 200) {
    throw new Error(`UNGM warmup HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  }
  // If CF served the interstitial instead of the notice listing, the body
  // contains "Just a moment" — fail fast so withRetry kicks in.
  if (resp.body.includes("Just a moment") || resp.body.includes("cf-challenge")) {
    throw new Error("UNGM warmup hit Cloudflare challenge page");
  }
}

interface UNGMNotice {
  ID?: number;
  Title?: string;
  AgencyName?: string;
  Country?: string;
  DeadlineDate?: string; // normalized to ISO YYYY-MM-DD during parse
  ReferenceNo?: string;
  NoticeType?: string;
  // Populated by fetchNoticeDetail per-row fan-out. Listing rows don't carry
  // these, and they're where the real sector-match signal lives.
  Description?: string;
  UNSPSCs?: string[];
  DetailCountry?: string;
}

// The /Public/Notice/Search endpoint returns pre-rendered HTML table rows
// (not JSON) regardless of Accept header — jQuery on the client does the
// DOM insertion verbatim. We extract fields via regex over the row fragment.
// Confirmed via /bundles/ungmcommon: NoticeSearch.BuildOptions returns a
// $.ajax with no dataType, and the success handler does .html(response).
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function parseUngmDate(raw: string): string | null {
  // Row renders dates as "30-Apr-2026 12:00" or "30-Apr-2026".
  const m = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mon = m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase();
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

function parseNoticeRows(html: string): UNGMNotice[] {
  const out: UNGMNotice[] = [];
  // Row boundary: chunk runs from row open up to the next row open, the
  // inline <script> UNGM emits after each row, or end-of-string.
  const rowRe =
    /<div role="row"\s+tabindex="0"\s+data-noticeid="(\d+)"\s+class="tableRow dataRow notice-table">([\s\S]*?)(?=<div role="row"\s+tabindex="0"\s+data-noticeid=|<script\b|$)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const id = Number.parseInt(m[1], 10);
    const chunk = m[2];
    const title = chunk.match(/<span class="ungm-title[^"]*">\s*([\s\S]*?)\s*<\/span>/)?.[1];
    const agency = chunk.match(/<div role="cell" class="tableCell resultAgency">\s*<span>([^<]*)<\/span>/)?.[1];
    const ref = chunk.match(/data-description="Reference">\s*<span>([^<]*)<\/span>/)?.[1];
    const noticeType = chunk.match(/<label for='([^']+)'>/)?.[1];
    const deadlineRaw = chunk.match(/class="tableCell resultInfo1 deadline"[^>]*>\s*<span>\s*([\s\S]*?)<\/span>/)?.[1];
    // Country sits in a plain `.tableCell` — take the last such cell in
    // the row to avoid grabbing the "Published" date cell above it.
    const plainCells = Array.from(
      chunk.matchAll(/<div role="cell" class="tableCell">\s*<span>([^<]*)<\/span>\s*<\/div>/g),
    );
    const country = plainCells.length ? plainCells[plainCells.length - 1][1].trim() : undefined;
    out.push({
      ID: id,
      Title: title ? decodeEntities(title.trim()) : undefined,
      AgencyName: agency?.trim(),
      Country: country,
      DeadlineDate: deadlineRaw ? parseUngmDate(deadlineRaw) ?? undefined : undefined,
      ReferenceNo: ref?.trim(),
      NoticeType: noticeType?.trim(),
    });
  }
  return out;
}

async function fetchPage(pageIndex: number): Promise<UNGMNotice[]> {
  // Payload mirrors NoticeSearch.BuildOptions from /bundles/ungmcommon.
  // IsActive: true filters to open notices. All array fields must be
  // present — the server falls back to the landing-page HTML if any are
  // missing. Server caps PageSize at 30 regardless of what we send.
  const body = JSON.stringify({
    PageIndex: pageIndex,
    PageSize: PAGE_SIZE,
    Title: "",
    Description: "",
    Reference: "",
    PublishedFrom: "",
    PublishedTo: "",
    DeadlineFrom: "",
    DeadlineTo: "",
    Countries: [],
    Agencies: [],
    UNSPSCs: [],
    NoticeTypes: [],
    TypeOfCompetitions: [],
    SortField: "DatePublished",
    SortAscending: false,
    isPicker: false,
    IsSustainable: false,
    IsActive: true,
    NoticeDisplayType: null,
    NoticeSearchTotalLabelId: "noticeSearchTotal",
  });

  const resp = await proxyFetch(UNGM_API, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/html, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://www.ungm.org",
      Referer: "https://www.ungm.org/Public/Notice",
    },
  });

  if (resp.status !== 200) {
    throw new Error(`UNGM page ${pageIndex} HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  }
  // If the response is the full HTML shell instead of row fragments, CF or
  // a middleware redirected us — fail loudly so withRetry handles it.
  if (resp.body.includes("<!DOCTYPE html") || resp.body.includes("<html")) {
    throw new Error(`UNGM page ${pageIndex} returned full HTML shell (expected row fragments)`);
  }
  return parseNoticeRows(resp.body);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parse a notice detail page. Empirical HTML shape (confirmed on notice 298061):
 *   - `<span class="label">X:</span><span class="value">...</span>` key/value pairs
 *     carry Reference, Beneficiary countries, Published on, Deadline on
 *   - `<div class="ungm-list-item ungm-background"><div class="title">Description</div><div>BODY</div></div>`
 *     carries the full notice description (plain text, sometimes multi-language)
 *   - `<div class="unspscNode">` nested tree; leaf 8-digit codes live inside
 *     `<span class="floatLeft">\d{8}</span>`
 * We extract description, UNSPSC codes (unique), and the detail-page country
 * string. Nothing else is load-bearing for matching.
 */
function parseDetail(html: string): { description: string | null; unspscs: string[]; country: string | null } {
  let description: string | null = null;
  // The Description block is emitted as `<div class="title">Description</div>`
  // followed by a sibling `<div>body</div>`. Capture the body cheaply with a
  // non-greedy match; cap at 4KB so a rogue notice with inline HTML doesn't
  // blow up row size.
  const descMatch = html.match(
    /<div class="title">\s*Description\s*<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (descMatch) {
    const body = decodeEntities(stripTags(descMatch[1])).slice(0, 4000).trim();
    if (body.length > 20) description = body;
  }

  // UNSPSC codes: every `<span class="floatLeft">CODE</span>` where CODE is
  // 8 digits is a UNSPSC identifier (2-digit segment + 6-digit specificity).
  // Dedup: same leaf code can show up in both the filtered tree and its parent.
  const unspscSet = new Set<string>();
  const codeRe = /<span class="floatLeft">\s*(\d{8})\s*<\/span>/g;
  let cm: RegExpExecArray | null;
  while ((cm = codeRe.exec(html)) !== null) unspscSet.add(cm[1]);
  const unspscs = [...unspscSet];

  // Beneficiary country — useful when the listing cell was empty or generic
  // ("Multiple"). Format is " Colombia" or " Colombia, Ecuador" — leading
  // whitespace stripped, first token used when multiple.
  let country: string | null = null;
  const ctryMatch = html.match(
    /<span class="label">\s*Beneficiary countries or territories:\s*<\/span>\s*<span class="value">\s*([^<]+?)\s*<\/span>/i,
  );
  if (ctryMatch) {
    const raw = decodeEntities(ctryMatch[1]).trim();
    const first = raw.split(/[,;]/)[0]?.trim();
    if (first) country = first;
  }

  return { description, unspscs, country };
}

async function fetchNoticeDetail(id: number): Promise<{ description: string | null; unspscs: string[]; country: string | null } | null> {
  try {
    const resp = await proxyFetch(`https://www.ungm.org/Public/Notice/${id}`, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://www.ungm.org/Public/Notice",
      },
      timeoutMs: 30000,
    });
    if (resp.status !== 200) return null;
    // CF challenge check — if we get here, the jar is stale; skip this notice.
    if (resp.body.includes("Just a moment") || resp.body.includes("cf-challenge")) return null;
    return parseDetail(resp.body);
  } catch {
    return null;
  }
}

function sectorFromUNSPSCs(codes: string[] | undefined): string | null {
  if (!codes?.length) return null;
  // First mappable code wins — UNSPSC codes are sorted by specificity in our
  // keywords map; any hit is stronger signal than the null fallback.
  for (const c of codes) {
    const slug = unspscSegmentToSlug(c);
    if (slug) return slug;
  }
  return null;
}

function mapNotice(n: UNGMNotice): RawTender {
  const country = n.DetailCountry ?? n.Country ?? "Global";
  return {
    reference_id: `UNGM-${n.ReferenceNo ?? n.ID ?? ""}`,
    title: n.Title ?? "Untitled",
    description: n.Description ?? null,
    agency: n.AgencyName ?? "UN",
    country,
    country_code: null,
    region: null,
    sector: sectorFromUNSPSCs(n.UNSPSCs),
    deadline: n.DeadlineDate ?? null,
    estimated_value: null,
    source_url: n.ID ? `https://www.ungm.org/Public/Notice/${n.ID}` : null,
    opportunity_type: n.NoticeType ?? "RFP",
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "UNGM",
  };
}

/** Test-only: snapshot of the jar state. Not for production use. */
export function __cookieJarSnapshot(): { size: number; keys: string[] } {
  return { size: cookieJar.size, keys: Array.from(cookieJar.keys()) };
}

export async function crawlUNGM(): Promise<CrawlResult> {
  const start = Date.now();
  if (!proxyConfigured()) {
    return {
      platform: "UNGM",
      status: "failure",
      tenders: [],
      durationMs: 0,
      error:
        "PROXY_HOST / PROXY_PORT / PROXY_USER / PROXY_PASS not set — UNGM requires residential proxy",
    };
  }
  // Fresh jar + fresh UA per crawl run.
  cookieJar = new Map();
  runUserAgent = pickUA();

  try {
    await withRetry(() => warmup());
    if (cookieJar.size === 0) {
      throw new Error("UNGM warmup succeeded but no cookies were issued");
    }

    const tenders: RawTender[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(randomDelay());
      const notices = await withRetry(() => fetchPage(page));
      if (!notices.length) break;

      // Per-page enrichment: fan out `fetchNoticeDetail` with a bounded worker
      // pool. Each worker pops the next notice, waits a jittered delay, and
      // mutates the row with Description/UNSPSCs/DetailCountry before mapping.
      // Bounded at DETAIL_CONCURRENCY so we don't spike CF's rate limiter on
      // a single session. A null detail is non-fatal — we still emit the
      // listing-only row (title + country + deadline still useful).
      let nIdx = 0;
      const enrichOne = async (n: UNGMNotice): Promise<void> => {
        if (!n.ID) return;
        const detail = await fetchNoticeDetail(n.ID);
        if (!detail) return;
        n.Description = detail.description ?? undefined;
        n.UNSPSCs = detail.unspscs.length ? detail.unspscs : undefined;
        n.DetailCountry = detail.country ?? undefined;
      };
      const worker = async (): Promise<void> => {
        while (nIdx < notices.length) {
          const i = nIdx++;
          if (i > 0) await sleep(detailDelay());
          await enrichOne(notices[i]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(DETAIL_CONCURRENCY, notices.length) }, worker),
      );

      tenders.push(...notices.map(mapNotice));
    }
    return { platform: "UNGM", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "UNGM",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
