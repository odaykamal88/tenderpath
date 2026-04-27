import { NextResponse } from "next/server";
import { syncAllTenders } from "@/lib/tender-sync";
import { syncAllGrants } from "@/lib/crawlers/grants-sync";
import { sql } from "@/lib/db";

async function getSourceQualitySummary() {
  const rows = await sql`
    SELECT
      source_name AS platform,
      COUNT(*) AS open_tenders,
      AVG(CASE WHEN description IS NOT NULL AND LENGTH(TRIM(description)) >= 120 THEN 100 ELSE 0 END) AS description_complete_pct,
      AVG(CASE WHEN deadline IS NOT NULL THEN 100 ELSE 0 END) AS deadline_complete_pct,
      AVG(CASE WHEN sector IS NOT NULL AND TRIM(sector) <> '' THEN 100 ELSE 0 END) AS sector_complete_pct,
      AVG(CASE WHEN source_url IS NOT NULL AND TRIM(source_url) <> '' THEN 100 ELSE 0 END) AS source_url_complete_pct,
      AVG(CASE WHEN has_broken_link IS TRUE THEN 100 ELSE 0 END) AS broken_link_pct
    FROM tenders
    WHERE status = 'open' AND source_name IS NOT NULL
    GROUP BY source_name
  `;

  return (rows as Array<{
    platform: string;
    open_tenders: number | string | null;
    description_complete_pct: number | string | null;
    deadline_complete_pct: number | string | null;
    sector_complete_pct: number | string | null;
    source_url_complete_pct: number | string | null;
    broken_link_pct: number | string | null;
  }>).map((row) => {
    const description = Math.round(Number(row.description_complete_pct ?? 0));
    const deadline = Math.round(Number(row.deadline_complete_pct ?? 0));
    const sector = Math.round(Number(row.sector_complete_pct ?? 0));
    const sourceUrl = Math.round(Number(row.source_url_complete_pct ?? 0));
    const brokenLink = Math.round(Number(row.broken_link_pct ?? 0));
    const degraded =
      description < 70 ||
      deadline < 70 ||
      sector < 70 ||
      sourceUrl < 95 ||
      brokenLink > 10;

    return {
      platform: row.platform,
      openTenders: Number(row.open_tenders ?? 0),
      status: degraded ? "degraded" : "healthy",
      descriptionCompletePct: description,
      deadlineCompletePct: deadline,
      sectorCompletePct: sector,
      sourceUrlCompletePct: sourceUrl,
      brokenLinkPct: brokenLink,
    };
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === "degraded" ? -1 : 1;
    return a.platform.localeCompare(b.platform);
  });
}

async function runSync() {
  const [tenders, grants] = await Promise.all([syncAllTenders(), syncAllGrants()]);
  const sourceQuality = await getSourceQualitySummary();
  const degradedSources = sourceQuality.filter((source) => source.status === "degraded");

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    tenders: {
      totalAdded: tenders.totalAdded,
      totalUpdated: tenders.totalUpdated,
      totalExpired: tenders.totalExpired,
      platforms: tenders.results.map((r) => ({
        platform: r.platform,
        status: r.status,
        added: r.added,
        updated: r.updated,
        expired: r.expired,
        durationMs: r.durationMs,
        error: r.error,
      })),
    },
    grants: {
      totalAdded: grants.totalAdded,
      totalUpdated: grants.totalUpdated,
      totalExpired: grants.totalExpired,
      totalBroken: grants.totalBroken,
      platforms: grants.platforms,
    },
    quality: {
      degradedSourceCount: degradedSources.length,
      degradedSources: degradedSources.slice(0, 8),
    },
  };
}

/**
 * GET — called by Vercel Cron daily at 06:00 UTC.
 * POST — manual trigger (fixes the manual-only gap from original).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runSync());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runSync());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
