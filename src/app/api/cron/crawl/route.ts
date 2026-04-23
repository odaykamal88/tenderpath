import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { syncAllTenders } from "@/lib/crawlers/sync";
import { syncAllGrants } from "@/lib/crawlers/grants-sync";

export const maxDuration = 300;

async function runCrawl(): Promise<object> {
  const globalStart = Date.now();

  // Canonical tender sync: parallel crawl, cross-source dedup, link verification,
  // per-source crawl_logs rows, expiry, and ongoing link health — all handled inside.
  const tenderSummary = await syncAllTenders();

  // Grants sync: separate table, independent expiry — already logs per-source internally.
  const grantSummary = await syncAllGrants();

  const durationMs = Date.now() - globalStart;
  const totalAdded = tenderSummary.totalAdded + grantSummary.totalAdded;
  const totalUpdated = tenderSummary.totalUpdated + grantSummary.totalUpdated;
  const totalExpired = tenderSummary.totalExpired + grantSummary.totalExpired;

  const tenderFailures = tenderSummary.results.filter((r) => r.status === "failure").length;
  const grantFailures = grantSummary.platforms.filter((p) => p.status === "failure").length;
  const totalSources = tenderSummary.results.length + grantSummary.platforms.length;
  const totalFailures = tenderFailures + grantFailures;
  const overallStatus =
    totalFailures === 0 ? "success" :
    totalFailures === totalSources ? "failure" : "partial";

  // Single SUMMARY row — per-source rows are written inside syncAllTenders/syncAllGrants.
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
    total_broken_links: tenderSummary.totalBrokenLinks + grantSummary.totalBroken,
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
    grants: {
      platforms: grantSummary.platforms,
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
