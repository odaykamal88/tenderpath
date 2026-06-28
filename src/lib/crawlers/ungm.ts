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
 * Chromium cold-start, which blew the cron budget; one batched call of
 * ~60 pages totals ~150-170s.
 *
 * Coverage: UNGM has ~1,555 active notices — far more than fits one run. We
 * mirror the full active set via DEADLINE-banded pagination (see the band
 * constants below): the bid-able 10+-day set is captured in full every run,
 * and the closing-soon remainder rotates so the DB converges to all of it.
 *
 * Detail enrichment is best-effort and capped so listing coverage remains the
 * reliability anchor while recent rows get richer matching fields when the
 * detail HTML is parseable.
 */
import { normalizeSector } from "./sector-map";
import { type RawTender, type CrawlResult, withRetry } from "./types";

const UNGM_API = "https://www.ungm.org/Public/Notice/Search";
const UNGM_WARMUP = "https://www.ungm.org/Public/Notice";
// Server caps at ~15 rows/page regardless of what we send. 100 matches what
// the UI sends so our payload looks real.
const PAGE_SIZE = 100;
const ROWS_PER_PAGE = 15; // server hard cap per page; used to size band budgets

// Full active-set mirror via deadline-banded pagination.
//
// UNGM exposes ~1,565 active notices. The original strategy — sort publish-date-
// desc and take the newest ~450 — only reached ~1 week of postings. A first fix
// banded by deadline but kept the ACTIONABLE set (deadline ≥ today+10) as ONE
// publish-date-DESC band capped at 540 rows. That re-introduced a subtler drop:
// the actionable set is heavily front-loaded by deadline but the band is ordered
// by PUBLISH date, so LONG-LEAD notices (published weeks ago, deadline far out)
// sort to the very tail and fall off the cap. A UNICEF MENA REOI published
// 07-May with a 30-Jul deadline (notice 300153) was rank ~496/514 — one spike in
// near-term volume above the cap and it vanishes silently.
//
// Measured split (2026-06-28), deadline ≥ today+10 → 514 notices, by lead-day:
//   • [10,16]d → ~335   (closing in 1-2 weeks; mostly recent-publish = band head)
//   • [17,30]d → ~138
//   • [31,∞)d  → ~41     (long-lead; old-publish = the tail that was being dropped)
//   • deadline today..+9 → ~1,050 (closing-soon; hidden by the 10+ UI default)
//
// Deadline filters (DeadlineFrom/DeadlineTo, DD-MMM-YYYY) are server-verified, so
// we now mirror the ACTIONABLE set as deadline SUB-WINDOWS, each paged in full
// every run. No window's publish-DESC ordering can bury another window's notices,
// so the long-lead tail is guaranteed regardless of near-term volume. Strategy:
//   1. ACTIONABLE sub-windows (ACTIONABLE_SUBWINDOWS): every window every run.
//   2. CLOSING-SOON band: split into deadline sub-windows, ONE crawled per run
//      (rotating by day-of-month). Over a full rotation the DB converges to the
//      entire active set without exceeding the shared cron / worker budget.
// All bands ride a single /fetch-many call (one Cloudflare warmup); dedupeNotices
// collapses any overlap. Per-window caps carry headroom over the measured page
// counts; the "hit page cap" warning (below) still fires if a window overflows,
// so re-truncation is observable rather than silent.
const ACTIONABLE_LEAD_DAYS = 10;
// Inclusive [leadLo, leadHi|null] deadline-lead ranges (null = open-ended) + a
// per-window page cap. 15 rows/page; caps sized ~15-40% over measured pages.
const ACTIONABLE_SUBWINDOWS: ReadonlyArray<{
  lead: readonly [number, number | null];
  maxPages: number;
}> = [
  { lead: [ACTIONABLE_LEAD_DAYS, 16], maxPages: 26 }, // ~335 notices / ~23 pages
  { lead: [17, 30], maxPages: 14 },                   // ~138 notices / ~10 pages
  { lead: [31, null], maxPages: 8 },                  // ~41  notices / ~3 pages — the long-lead tail
];
const SOON_MAX_PAGES = 24;       // 24×15=360 cap ≈ one third of the ~1,050 closing-soon
// Deadline-day offset sub-windows (inclusive) for the closing-soon band.
const SOON_SUBWINDOWS: ReadonlyArray<readonly [number, number]> = [[0, 3], [4, 6], [7, 9]];

const MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// UNGM date filters expect DD-MMM-YYYY (e.g. 03-Jul-2026). offsetDays is relative
// to "now" in UTC; negative offsets reach into the past.
function ungmDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${MONTHS_ABBR[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function workerConfigured(): boolean {
  return !!(process.env.CRAWLER_WORKER_URL && process.env.CRAWLER_WORKER_KEY);
}

interface WorkerPageResult { status: number; body: string }
interface UngmRequest {
  kind: "page" | "title-search" | "detail";
  label: string;
  url?: string; // overrides UNGM_API; used for detail page GETs
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

// Fetch up to this many notice detail pages per run to extract estimated_value.
// Page 0 yields ~15 notices; 25 covers those plus a few supplemental results.
const MAX_ENRICHMENT = 25;

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
  requests: UngmRequest[],
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
      delayMs: 500,
      requests: requests.map((r) => ({
        url: r.url ?? UNGM_API,
        method: r.method,
        body: r.body,
        headers: r.headers ?? {},
      })),
    }),
    // Budget: warmup ~8-12s + N × (~1.5s origin latency + 0.5s delay). The
    // deadline sub-windows total ~72 page fetches (~155-165s); 210s gives margin
    // for slow warmup / worker contention while staying well under the 300s cron.
    signal: AbortSignal.timeout(210_000),
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

function cleanHtmlText(raw: string): string {
  return decodeEntities(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function buildSearchPayload(
  pageIndex: number,
  opts: { title?: string; deadlineFrom?: string; deadlineTo?: string } = {},
): string {
  return JSON.stringify({
    PageIndex: pageIndex,
    PageSize: PAGE_SIZE,
    Title: opts.title ?? "",
    Description: "",
    Reference: "",
    PublishedFrom: "",
    PublishedTo: "",
    DeadlineFrom: opts.deadlineFrom ?? "",
    DeadlineTo: opts.deadlineTo ?? "",
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

function dedupeNotices(tenders: RawTender[]): RawTender[] {
  const out = new Map<string, RawTender>();
  for (const tender of tenders) {
    const key = tender.reference_id || tender.source_url || `${tender.title}|${tender.agency}|${tender.deadline ?? ""}`;
    if (!out.has(key)) out.set(key, tender);
  }
  return [...out.values()];
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
  const title = n.Title ?? "Untitled";
  const sectorSlugs = normalizeSector(null, title, null);
  return {
    reference_id: `UNGM-${n.ReferenceNo ?? n.ID ?? ""}`,
    title,
    description: null,
    agency: n.AgencyName ?? "UN",
    country: n.Country ?? "Global",
    country_code: null,
    region: null,
    sector: sectorSlugs.length ? sectorSlugs.join(", ") : null,
    deadline: n.DeadlineDate ?? null,
    // UNGM listing rows do not include contract value; the field is not part
    // of the Search API response payload.
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

/**
 * Extract estimated value from a UNGM notice detail page.
 * The detail page renders a table of label/value pairs; the value field is
 * labelled "Estimated Value" or "Estimated Contract Value".
 */
function parseDetailValue(html: string): string | null {
  // UNGM detail pages use patterns like:
  //   <td ...>Estimated Value</td><td ...>USD 500,000</td>
  //   <label>Estimated Value</label> ... <span>USD 500,000</span>
  const patterns = [
    /Estimated\s+(?:Contract\s+)?Value[^<]{0,40}<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]{3,80})/i,
    /Estimated\s+(?:Contract\s+)?Value[^<]{0,40}<\/(?:label|strong|span|p|div)[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,80})/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const val = m[1]
      .replace(/&#\d+;/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (val && val.length > 1 && !/^N\/A$|not\s+available|to\s+be\s+determined|TBD/i.test(val)) {
      return val.slice(0, 80);
    }
  }
  return null;
}

function parseDetailDescription(html: string): string | null {
  const label = "(?:Description|Long\\s+Description|Short\\s+Description|Detailed\\s+Description|Notice\\s+Description)";
  const patterns = [
    new RegExp(`<t[dh][^>]*>\\s*${label}\\s*</t[dh]>\\s*<t[dh][^>]*>([\\s\\S]{80,6000}?)</t[dh]>`, "i"),
    new RegExp(`<label[^>]*>\\s*${label}\\s*</label>[\\s\\S]{0,800}?<div[^>]*>([\\s\\S]{80,6000}?)</div>`, "i"),
    /<div[^>]*(?:id|class)="[^"]*(?:description|notice-description)[^"]*"[^>]*>([\s\S]{80,6000}?)<\/div>/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (!match) continue;
    const text = cleanHtmlText(match[1]);
    if (
      text.length >= 120 &&
      !/^description$/i.test(text) &&
      !/^(deadline|reference|unspsc|estimated value)\b/i.test(text)
    ) {
      return text.slice(0, 3000);
    }
  }
  return null;
}

function parseDetailSector(html: string, title: string, description: string | null): string | null {
  const matches = html.match(/\b\d{8}\b/g);
  const unspscNearby = /UNSPSC/i.test(html);
  const normalized = normalizeSector(
    unspscNearby && matches?.length ? matches.slice(0, 8).join(", ") : null,
    title,
    description,
  );
  return normalized.length ? normalized.join(", ") : null;
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
    // Build deadline bands for this run (see ACTIONABLE/CLOSING-SOON notes above).
    // ACTIONABLE is mirrored in full every run; one rotating CLOSING-SOON
    // sub-window is added so the DB converges to the whole active set over a cycle.
    const soonIdx = new Date().getUTCDate() % SOON_SUBWINDOWS.length;
    const [soonLo, soonHi] = SOON_SUBWINDOWS[soonIdx];
    const bandSpecs: Array<{
      key: string;
      maxPages: number;
      deadlineFrom: string;
      deadlineTo?: string;
    }> = [
      // ACTIONABLE: one band per deadline sub-window, all mirrored every run so
      // the long-lead tail can't be buried by near-term publish-DESC ordering.
      ...ACTIONABLE_SUBWINDOWS.map(({ lead, maxPages }) => ({
        key: `actionable(${lead[0]}-${lead[1] ?? "∞"}d)`,
        maxPages,
        deadlineFrom: ungmDate(lead[0]),
        deadlineTo: lead[1] === null ? undefined : ungmDate(lead[1]),
      })),
      {
        key: `closing-soon(${soonLo}-${soonHi}d)`,
        maxPages: SOON_MAX_PAGES,
        deadlineFrom: ungmDate(soonLo),
        deadlineTo: ungmDate(soonHi),
      },
    ];

    // Flatten bands into one request list (single warmup) while remembering each
    // band's slice so we can stop paginating that band at its first empty page.
    const requests: UngmRequest[] = [];
    const bandRanges = bandSpecs.map((band) => {
      const startIndex = requests.length;
      for (let p = 0; p < band.maxPages; p++) {
        requests.push({
          kind: "page",
          label: `${band.key} p${p}`,
          method: "POST",
          body: buildSearchPayload(p, { deadlineFrom: band.deadlineFrom, deadlineTo: band.deadlineTo }),
          headers: PAGE_HEADERS,
        });
      }
      return { ...band, startIndex };
    });

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
    for (const band of bandRanges) {
      let pagesParsed = 0;
      for (let p = 0; p < band.maxPages; p++) {
        const res = results[band.startIndex + p];
        if (!res) break;
        let notices: UNGMNotice[];
        try {
          notices = parsePageResult(p, res);
        } catch (err) {
          // One bad page shouldn't drop the whole run. Log and continue — the
          // worker-level retry already covered transient failures.
          console.error(`[ungm] ${band.key} p${p} parse failed:`, err instanceof Error ? err.message : err);
          parseErrors++;
          continue;
        }
        if (!notices.length) break; // empty page = end of this band's notices
        tenders.push(...notices.map(mapNotice));
        pagesParsed++;
      }
      // No silent truncation: consuming the whole page budget without an empty
      // page means the band has more notices than we paged this run.
      if (pagesParsed >= band.maxPages) {
        console.warn(
          `[ungm] band ${band.key} hit page cap ${band.maxPages} (~${band.maxPages * ROWS_PER_PAGE} rows) — `
          + "more notices exist; raise the cap or split the deadline window finer",
        );
      }
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

    // Best-effort detail enrichment: fetch notice detail pages for the most
    // recently published notices (first MAX_ENRICHMENT results, already sorted
    // by publish date desc). A second /fetch-many call reuses the same worker
    // Chromium binary but needs its own warmup (~8-12s) plus N×~1.5s for the
    // GETs — adds ~35s at MAX_ENRICHMENT=25, well within the 300s cron budget.
    const deduped = dedupeNotices(tenders);
    const toEnrich = deduped.filter((t) => t.source_url).slice(0, MAX_ENRICHMENT);
    if (toEnrich.length > 0) {
      try {
        const detailRequests: UngmRequest[] = toEnrich.map((t) => ({
          kind: "detail" as const,
          label: `detail ${t.reference_id}`,
          url: t.source_url!,
          method: "GET" as const,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            Referer: "https://www.ungm.org/Public/Notice",
          },
        }));
        const detailResults = await workerFetchMany(detailRequests, { waitMs: 1000 });
        let valueEnriched = 0;
        let descriptionEnriched = 0;
        let sectorEnriched = 0;
        for (let i = 0; i < detailResults.length; i++) {
          const r = detailResults[i];
          const t = toEnrich[i];
          if (!t || r.status !== 200) continue;
          const val = parseDetailValue(r.body);
          if (val) { t.estimated_value = val; valueEnriched++; }
          const description = parseDetailDescription(r.body);
          if (description && !t.description) {
            t.description = description;
            descriptionEnriched++;
          }
          const sector = parseDetailSector(r.body, t.title, t.description);
          if (sector && !t.sector) {
            t.sector = sector;
            sectorEnriched++;
          }
        }
        if (valueEnriched > 0 || descriptionEnriched > 0 || sectorEnriched > 0) {
          console.log(
            `[ungm] enriched ${toEnrich.length} notices: `
            + `value=${valueEnriched}, description=${descriptionEnriched}, sector=${sectorEnriched}`,
          );
        }
      } catch (err) {
        // Enrichment is best-effort — log but don't fail the crawl.
        console.warn("[ungm] detail enrichment failed:", err instanceof Error ? err.message : err);
      }
    }

    return { platform: "UNGM", status: "success", tenders: deduped, durationMs: Date.now() - start };
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
