import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { syncAllTenders } from "@/lib/crawlers/sync";

export const maxDuration = 300;

// When more than this share of sources fail in a single run, the route returns
// HTTP 502 so Vercel cron monitoring fires. Below this threshold we still
// return 200 with `status: "partial"` so a single flaky source does not
// page ops every day.
const PARTIAL_FAILURE_ALERT_RATIO = 0.4;

interface CrawlOutcome {
  body: object;
  alert: boolean;
}

async function runCrawl(): Promise<CrawlOutcome> {
  const globalStart = Date.now();

  // Canonical tender sync: parallel crawl, cross-source dedup, link verification,
  // per-source crawl_logs rows, expiry, and ongoing link health — all handled inside.
  const tenderSummary = await syncAllTenders();

  const durationMs = Date.now() - globalStart;
  const totalAdded = tenderSummary.totalAdded;
  const totalUpdated = tenderSummary.totalUpdated;
  const totalExpired = tenderSummary.totalExpired;

  const tenderFailures = tenderSummary.results.filter((r) => r.status === "failure").length;
  const totalSources = tenderSummary.results.length;
  const totalFailures = tenderFailures;
  const failureRatio = totalSources > 0 ? totalFailures / totalSources : 0;
  const overallStatus =
    totalFailures === 0 ? "success" :
    totalFailures === totalSources ? "failure" : "partial";

  // Single SUMMARY row — per-source rows are written inside syncAllTenders.
  await sql`
    INSERT INTO crawl_logs (
      platform, status, duration_ms,
      tenders_added, tenders_updated, tenders_expired
    ) VALUES (
      'SUMMARY', ${overallStatus}, ${durationMs},
      ${totalAdded}, ${totalUpdated}, ${totalExpired}
    )
  `;

  const alert =
    overallStatus === "failure" ||
    (overallStatus === "partial" && failureRatio >= PARTIAL_FAILURE_ALERT_RATIO);

  return {
    alert,
    body: {
      ok: !alert,
      timestamp: new Date().toISOString(),
      status: overallStatus,
      duration_ms: durationMs,
      failure_ratio: Number(failureRatio.toFixed(2)),
      total_added: totalAdded,
      total_updated: totalUpdated,
      total_expired: totalExpired,
      total_deduped: tenderSummary.totalDeduped,
      total_broken_links: tenderSummary.totalBrokenLinks,
      tenders: {
        sources: tenderSummary.results.map((r) => ({
          source: r.platform,
          status: r.status,
          added: r.added,
          updated: r.updated,
          broken_links: r.brokenLinks,
          duration_ms: r.durationMs,
          error: r.error,
        })),
      },
    },
  };
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron/crawl] CRON_SECRET not configured — refusing request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { body, alert } = await runCrawl();
    // 502 escalates to Vercel cron monitoring + retry policy when the crawl
    // either fully failed or crossed the partial-failure alert threshold.
    return NextResponse.json(body, { status: alert ? 502 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
