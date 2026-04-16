import { NextResponse } from "next/server";
import { syncAllTenders } from "@/lib/tender-sync";
import { sql } from "@/lib/db";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

async function runCrawl() {
  const startedAt = Date.now();
  const result = await syncAllTenders();
  const durationMs = Date.now() - startedAt;

  const failures = result.results.filter((r) => r.status === "failure");
  const status = failures.length === 0
    ? "success"
    : failures.length === result.results.length ? "failure" : "partial";

  const errorText = failures.length
    ? failures.map((f) => `${f.platform}: ${f.error ?? "unknown"}`).join("; ").slice(0, 2000)
    : null;

  await sql`
    INSERT INTO crawl_logs (
      platform, status, duration_ms,
      tenders_added, tenders_updated, tenders_expired, broken_links, error
    ) VALUES (
      'SUMMARY', ${status}, ${durationMs},
      ${result.totalAdded}, ${result.totalUpdated}, ${result.totalExpired},
      ${result.totalBrokenLinks}, ${errorText}
    )
  `;

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    status,
    durationMs,
    totalAdded: result.totalAdded,
    totalUpdated: result.totalUpdated,
    totalExpired: result.totalExpired,
    totalDeduped: result.totalDeduped,
    totalBrokenLinks: result.totalBrokenLinks,
    platforms: result.results.map((r) => ({
      platform: r.platform,
      status: r.status,
      added: r.added,
      updated: r.updated,
      durationMs: r.durationMs,
      error: r.error,
    })),
  };
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runCrawl());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
