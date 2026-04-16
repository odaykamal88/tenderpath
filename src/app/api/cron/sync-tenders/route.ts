import { NextResponse } from "next/server";
import { syncAllTenders } from "@/lib/tender-sync";
import { syncAllGrants } from "@/lib/crawlers/grants-sync";

async function runSync() {
  const [tenders, grants] = await Promise.all([syncAllTenders(), syncAllGrants()]);
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
