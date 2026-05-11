import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sendDailyDigest, type DailyDigestPayload } from "@/lib/email/sendDailyDigest";

export const maxDuration = 60;

// Kept in sync with src/app/api/health/route.ts and /api/admin/source-health.
// Inlined to avoid pulling those into the cron path.
const STALE_AFTER_HOURS: Record<string, number> = {
  UNGM: 26,
  "World Bank": 36,
  "TED EU": 36,
  "UK Find a Tender": 48,
  "SAM.gov": 36,
  "UNDP Atlas": 36,
  IDB: 48,
  ReliefWeb: 48,
  KfW: 72,
  GIZ: 72,
  AFD: 72,
  ADA: 72,
  JICA: 72,
  NRC: 72,
  UNDP: 48,
  "DevelopmentAid NPO": 72,
};

function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron/daily-digest] CRON_SECRET not configured — refusing request");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function buildPayload(): Promise<DailyDigestPayload> {
  const [
    summaryRows,
    perSourceLastSuccess,
    perSourceLastFailure,
    openTenderRows,
    paymentsLast24h,
    pendingWorkOrders,
    emailLast24h,
  ] = await Promise.all([
    sql`
      SELECT status, duration_ms, tenders_added, tenders_updated, tenders_expired, created_at
      FROM crawl_logs
      WHERE platform = 'SUMMARY'
      ORDER BY created_at DESC
      LIMIT 1
    ` as unknown as Promise<Array<{
      status: string | null;
      duration_ms: number | string | null;
      tenders_added: number | string | null;
      tenders_updated: number | string | null;
      tenders_expired: number | string | null;
      created_at: string;
    }>>,
    sql`
      SELECT platform, MAX(created_at) AS last_success
      FROM crawl_logs
      WHERE platform <> 'SUMMARY' AND status IN ('success', 'success_empty')
      GROUP BY platform
    ` as unknown as Promise<Array<{ platform: string; last_success: string | null }>>,
    sql`
      SELECT platform, MAX(created_at) AS last_failure
      FROM crawl_logs
      WHERE platform <> 'SUMMARY' AND status = 'failure'
        AND created_at > NOW() - INTERVAL '36 hours'
      GROUP BY platform
    ` as unknown as Promise<Array<{ platform: string; last_failure: string | null }>>,
    sql`
      SELECT COUNT(*) AS open_tenders
      FROM tenders
      WHERE status = 'open' AND (deadline IS NULL OR deadline >= CURRENT_DATE)
    ` as unknown as Promise<Array<{ open_tenders: string | number | null }>>,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid,
        COUNT(*) FILTER (WHERE payment_status NOT IN ('paid', 'pending_verification', 'pending') AND payment_status IS NOT NULL) AS failed
      FROM work_orders
      WHERE updated_at > NOW() - INTERVAL '24 hours'
    ` as unknown as Promise<Array<{ paid: string | number | null; failed: string | number | null }>>,
    sql`
      SELECT
        id, plan, payment_status,
        EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0 AS hours_pending
      FROM work_orders
      WHERE payment_status IN ('pending', 'pending_verification')
        AND created_at < NOW() - INTERVAL '4 hours'
        AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at ASC
      LIMIT 10
    ` as unknown as Promise<Array<{
      id: number;
      plan: string | null;
      payment_status: string | null;
      hours_pending: string | number;
    }>>,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM email_queue
      WHERE created_at > NOW() - INTERVAL '24 hours'
    ` as unknown as Promise<Array<{ sent: string | number | null; failed: string | number | null }>>,
  ]);

  const summary = summaryRows[0];
  const totalAdded = Number(summary?.tenders_added ?? 0);
  const totalUpdated = Number(summary?.tenders_updated ?? 0);
  const totalExpired = Number(summary?.tenders_expired ?? 0);
  const summaryStatus = summary?.status?.trim() ?? null;
  const runAt = summary?.created_at ?? null;
  const summaryAgeHours = runAt ? (Date.now() - new Date(runAt).getTime()) / 36e5 : Infinity;

  // Compute freshness from the per-source latest-success window.
  const lastSuccessMap = new Map(perSourceLastSuccess.map((r) => [r.platform, r.last_success]));

  // Stale / fresh per known platforms.
  const stale: string[] = [];
  const fresh: string[] = [];
  for (const [platform, staleAfter] of Object.entries(STALE_AFTER_HOURS)) {
    const ls = lastSuccessMap.get(platform);
    if (!ls) {
      stale.push(platform);
      continue;
    }
    const hours = (Date.now() - new Date(ls).getTime()) / 36e5;
    if (hours > staleAfter) stale.push(platform);
    else fresh.push(platform);
  }

  // Sources that produced a `failure` row but no recent `success` row.
  const failedSources = perSourceLastFailure
    .filter((r) => {
      const ls = lastSuccessMap.get(r.platform);
      if (!ls || !r.last_failure) return Boolean(r.last_failure);
      return new Date(r.last_failure).getTime() > new Date(ls).getTime();
    })
    .map((r) => r.platform);

  const trackedPlatforms = Object.keys(STALE_AFTER_HOURS);
  const totalTracked = trackedPlatforms.length;
  const failureRatio = totalTracked > 0 ? failedSources.filter((p) => trackedPlatforms.includes(p)).length / totalTracked : null;

  const successSources = perSourceLastSuccess
    .filter((r) => r.last_success && !failedSources.includes(r.platform))
    .map((r) => r.platform);

  const paymentsRow = paymentsLast24h[0];
  const emailsRow = emailLast24h[0];

  // If the summary is older than 36h, treat as no_summary so the digest is
  // explicit about a missing cron rather than reporting stale numbers.
  const crawlStatus =
    summaryAgeHours > 36 || !summaryStatus
      ? "no_summary"
      : (summaryStatus as "success" | "partial" | "failure");

  return {
    generatedAt: new Date().toISOString(),
    crawl: {
      status: crawlStatus,
      failureRatio,
      totalAdded,
      totalUpdated,
      totalExpired,
      failedSources,
      successSources,
      durationMs: summary?.duration_ms != null ? Number(summary.duration_ms) : null,
      runAt,
    },
    freshness: {
      staleSources: stale,
      freshSources: fresh,
      openTenders: Number(openTenderRows[0]?.open_tenders ?? 0),
    },
    payments: {
      pendingOverFourHours: pendingWorkOrders.length,
      failedLast24h: Number(paymentsRow?.failed ?? 0),
      successfulLast24h: Number(paymentsRow?.paid ?? 0),
      pendingRecent: pendingWorkOrders.map((r) => ({
        id: Number(r.id),
        plan: r.plan,
        payment_status: r.payment_status,
        hours_pending: Number(r.hours_pending),
      })),
    },
    email: {
      failedLast24h: Number(emailsRow?.failed ?? 0),
      sentLast24h: Number(emailsRow?.sent ?? 0),
    },
  };
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const payload = await buildPayload();
    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, payload });
    }
    const sendResult = await sendDailyDigest(payload);
    return NextResponse.json({ ok: true, payload, send: sendResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown daily digest error";
    console.error("[api/cron/daily-digest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
