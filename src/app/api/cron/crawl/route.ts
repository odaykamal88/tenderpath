import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { syncAllTenders } from "@/lib/crawlers/sync";

export const maxDuration = 300;

async function runCrawl(): Promise<object> {
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

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    status: overallStatus,
    duration_ms: durationMs,
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
  };
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runCrawl());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
