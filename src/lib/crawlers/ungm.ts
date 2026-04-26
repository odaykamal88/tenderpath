/**
 * UNGM — UN Global Marketplace. Canonical procurement hub for ~50 UN agencies
 * (UNICEF, WFP, WHO, UNHCR, IOM, UNDP, UNFPA, UNESCO, UNOPS, FAO, etc.) that
 * post here by mandate. Sits behind Cloudflare bot protection.
 *
 * Strategy: batch all pagination through a single call to the worker's
 * /fetch-many endpoint. The worker launches Chromium once, warms up on
 * /Public/Notice (Cloudflare issues cf_clearance + session cookies), then
 * loops every page fetch inside the same page context — real TLS/JA3
 * fingerprint, cookies + session reused across all N requests. This is
 * the fix for the 300s Vercel timeout: per-page calls cost ~15s each in
 * Chromium cold-start, which blew the cron budget for N=15. One batched
 * call totals ~30-40s for all 20 pages.
 *
 * Per-notice detail enrichment (description + UNSPSCs) still disabled —
 * listing rows carry enough signal (title, agency, country, deadline).
 */
import { type RawTender, type CrawlResult, withRetry } from "./types";

const UNGM_API = "https://www.ungm.org/Public/Notice/Search";
const UNGM_WARMUP = "https://www.ungm.org/Public/Notice";
// Server caps at ~15 rows/page regardless of what we send. 100 matches what
// the UI sends so our payload looks real.
const PAGE_SIZE = 100;
// 20 pages × ~15 rows ≈ 300 notices per run. All 20 pages ride a single
// worker call (/fetch-many) so warmup cost is amortized once — total
// wall-clock dominated by 20 × ~1-2s origin latency, not 20 × Chromium
// cold-start. Comfortably under Vercel's 300s budget with headroom for
// the other 8 crawlers.
const MAX_PAGES = 20;

function workerConfigured(): boolean {
  return !!(process.env.CRAWLER_WORKER_URL && process.env.CRAWLER_WORKER_KEY);
}

interface WorkerPageResult { status: number; body: string }

/**
 * Derive /fetch-many endpoint from the configured CRAWLER_WORKER_URL. The env
 * var was set to .../fetch; we strip the path and append /fetch-many so we
 * don't need a second env var.
 */
function fetchManyEndpoint(): string {
  const raw = process.env.CRAWLER_WORKER_URL!;
  return new URL("/fetch-many", raw).toString();
}

/**
 * Fan out N requests through a single worker invocation. Worker warms up
 * Chromium + clears Cloudflare exactly once, then loops the requests inside
 * the same page (cookies + TLS fingerprint reused). This is the difference
 * between ~30-40s total and ~300s (one cold-start per page).
 */
async function workerFetchMany(
  requests: Array<{ method: "GET" | "POST"; body?: string; headers?: Record<string, string> }>,
  opts: { waitMs?: number } = {},
): Promise<WorkerPageResult[]> {
  const endpoint = fetchManyEndpoint();
  const key = process.env.CRAWLER_WORKER_KEY!;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Crawler-Key": key },
    body: JSON.stringify({
      warmupUrl: UNGM_WARMUP,
      waitMs: opts.waitMs ?? 2500,
      delayMs: 700,
      requests: requests.map((r) => ({
        url: UNGM_API,
        method: r.method,
        body: r.body,
        headers: r.headers ?? {},
      })),
    }),
    // Budget: warmup ~8-12s + N × ~1.5s origin latency + delays. 20 pages
    // comfortably fits in 120s; 180s gives margin for a slow warmup.
    signal: AbortSignal.timeout(180_000),
  });

  // Read the body as text first — Cloudflare occasionally returns an
  // edge-level HTML error page with 2xx status when the isolate hiccups,
  // and resp.json() buries the diagnostic as "Unexpected token '<'".
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`crawler worker /fetch-many HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  let payload: { ok: boolean; results?: WorkerPageResult[]; error?: string };
  try {
    payload = JSON.parse(text);
  } catch {
    // Body wasn't JSON — surface the first 300 chars verbatim so we can
    // tell whether it was a CF challenge, a Workers runtime error, or a
    // timeout-reaper page. Previously this blew up as "Unexpected token"
    // with zero signal about the real failure.
    const snippet = text.slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(`crawler worker returned non-JSON (status ${resp.status}): ${snippet || "(empty body)"}`);
  }
  if (!payload.ok) throw new Error(`crawler worker error: ${payload.error ?? "unknown"}`);
  return payload.results ?? [];
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

function buildPagePayload(pageIndex: number): string {
  return JSON.stringify({
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
}

const PAGE_HEADERS = {
  "Content-Type": "application/json",
  Accept: "text/html, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  Origin: "https://www.ungm.org",
  Referer: "https://www.ungm.org/Public/Notice",
};

function parsePageResult(pageIndex: number, resp: WorkerPageResult): UNGMNotice[] {
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
    // Build all page payloads upfront — we fire them as a single worker call.
    const requests = Array.from({ length: MAX_PAGES }, (_, i) => ({
      method: "POST" as const,
      body: buildPagePayload(i),
      headers: PAGE_HEADERS,
    }));

    // Fast-fail detection: the common failure mode is the worker returning
    // HTML (CF edge error / challenge / Workers cold-start hiccup) in 3-4s
    // instead of the usual 30-40s. withRetry gives us one retry, but at the
    // same waitMs — so if warmup was the actual problem we fail the same way
    // twice. Detect fast-fail-with-HTML and retry once with a longer warmup
    // (6s) before giving up.
    const t0 = Date.now();
    let results: WorkerPageResult[];
    try {
      results = await withRetry(() => workerFetchMany(requests));
    } catch (err) {
      const elapsed = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const fastFailHtml = elapsed < 10_000 && /non-JSON|Cloudflare|HTTP 5\d\d/.test(msg);
      if (!fastFailHtml) throw err;
      console.warn(`[ungm] fast-fail in ${elapsed}ms (${msg.slice(0, 120)}) — retrying once with waitMs=6000`);
      results = await workerFetchMany(requests, { waitMs: 6000 });
    }

    const tenders: RawTender[] = [];
    let parseErrors = 0;
    for (let i = 0; i < results.length; i++) {
      let notices: UNGMNotice[];
      try {
        notices = parsePageResult(i, results[i]);
      } catch (err) {
        // One bad page shouldn't drop the whole run. Log and continue — the
        // worker-level retry already covered transient failures.
        console.error(`[ungm] page ${i} parse failed:`, err instanceof Error ? err.message : err);
        parseErrors++;
        continue;
      }
      if (!notices.length) break; // empty page = end of active notices
      tenders.push(...notices.map(mapNotice));
    }

    // 0-tender success is not a real success — it means the worker silently
    // returned empty bodies (CF edge error, stale cookies, warmup miss). Surface
    // it as a failure so crawl_logs shows a red entry and ops can investigate.
    if (tenders.length === 0) {
      const detail = parseErrors > 0
        ? `all ${parseErrors} pages failed to parse`
        : "worker returned results but all pages were empty";
      return {
        platform: "UNGM", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: `UNGM yielded 0 tenders — ${detail}`,
      };
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
