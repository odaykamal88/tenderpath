/**
 * UNGM — UN Global Marketplace. Canonical procurement hub for ~50 UN agencies
 * (UNICEF, WFP, WHO, UNHCR, IOM, UNDP, UNFPA, UNESCO, UNOPS, FAO, etc.) that
 * post here by mandate. Sits behind Cloudflare bot protection.
 *
 * Strategy: route all requests through our Cloudflare Browser Rendering
 * worker (workers/crawler-browser). The worker launches real Chromium,
 * warms up on /Public/Notice so Cloudflare sets cookies, then issues the
 * actual fetch from inside the page context — real TLS/JA3 fingerprint,
 * carries the CF cookies automatically. One worker call = warmup + action
 * atomically (cookies do not persist between calls), so every page request
 * is self-contained.
 *
 * Per-notice detail enrichment (description + UNSPSCs) is disabled here:
 * with ~15 rows/page × ~15 pages that's 225 extra worker calls per run,
 * each spawning a fresh browser. Listing-only rows still carry title,
 * agency, country, and deadline — enough to filter and rank. Re-enable
 * with a dedicated cheap detail fetcher if UNSPSC signal becomes critical.
 */
import { type RawTender, type CrawlResult, withRetry } from "./types";

const UNGM_API = "https://www.ungm.org/Public/Notice/Search";
const UNGM_WARMUP = "https://www.ungm.org/Public/Notice";
// Server caps at ~15 rows/page regardless of what we send. 100 matches what
// the UI sends so our payload looks real; loop breaks on empty page.
const PAGE_SIZE = 100;
// 15 pages × ~15 rows ≈ 225 notices per run. Each page is one worker call
// (~5-10s warmup+fetch), so MAX_PAGES × 10s bounds wall-clock under Vercel's
// 300s maxDuration with headroom for the grants + other crawlers after us.
const MAX_PAGES = 15;
// Short jitter between page calls — worker launches fresh browser each time
// so there's no session-fingerprint risk, but keep some pacing anyway.
const PAGE_DELAY_MIN_MS = 500;
const PAGE_DELAY_MAX_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  PAGE_DELAY_MIN_MS + Math.floor(Math.random() * (PAGE_DELAY_MAX_MS - PAGE_DELAY_MIN_MS));

interface WorkerFetchOpts {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

interface WorkerFetchResult {
  status: number;
  body: string;
}

function workerConfigured(): boolean {
  return !!(process.env.CRAWLER_WORKER_URL && process.env.CRAWLER_WORKER_KEY);
}

/**
 * Route a request through the Cloudflare Browser Rendering worker. The worker
 * does warmup + fetch in a single call — we just pass the target URL and the
 * warmup URL, the worker handles the rest.
 */
async function workerFetch(url: string, opts: WorkerFetchOpts): Promise<WorkerFetchResult> {
  const endpoint = process.env.CRAWLER_WORKER_URL!;
  const key = process.env.CRAWLER_WORKER_KEY!;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Crawler-Key": key,
    },
    body: JSON.stringify({
      url,
      method: opts.method,
      body: opts.body,
      headers: opts.headers ?? {},
      warmupUrl: UNGM_WARMUP,
      waitMs: 2000,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!resp.ok && resp.status !== 502) {
    throw new Error(`crawler worker HTTP ${resp.status}`);
  }
  const payload = (await resp.json()) as { ok: boolean; status: number; body: string };
  return { status: payload.status, body: payload.body };
}

interface UNGMNotice {
  ID?: number;
  Title?: string;
  AgencyName?: string;
  Country?: string;
  DeadlineDate?: string; // ISO YYYY-MM-DD
  ReferenceNo?: string;
  NoticeType?: string;
}

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
  const m = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mon = m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase();
  const mm = MONTHS[mon];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

function parseNoticeRows(html: string): UNGMNotice[] {
  const out: UNGMNotice[] = [];
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

  const resp = await workerFetch(UNGM_API, {
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
  if (resp.body.includes("Just a moment") || resp.body.includes("cf-challenge")) {
    throw new Error(`UNGM page ${pageIndex} hit Cloudflare challenge page`);
  }
  if (resp.body.includes("<!DOCTYPE html") || resp.body.includes("<html")) {
    throw new Error(`UNGM page ${pageIndex} returned full HTML shell (expected row fragments)`);
  }
  return parseNoticeRows(resp.body);
}

function mapNotice(n: UNGMNotice): RawTender {
  return {
    reference_id: `UNGM-${n.ReferenceNo ?? n.ID ?? ""}`,
    title: n.Title ?? "Untitled",
    description: null,
    agency: n.AgencyName ?? "UN",
    country: n.Country ?? "Global",
    country_code: null,
    region: null,
    sector: null,
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

export async function crawlUNGM(): Promise<CrawlResult> {
  const start = Date.now();
  if (!workerConfigured()) {
    return {
      platform: "UNGM",
      status: "failure",
      tenders: [],
      durationMs: 0,
      error:
        "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set — UNGM requires the Cloudflare browser-rendering worker",
    };
  }

  try {
    const tenders: RawTender[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await sleep(randomDelay());
      const notices = await withRetry(() => fetchPage(page));
      if (!notices.length) break;
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
