import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const [users, assessments, tenders, subscriptions, recentCrawls, platformHealth] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM users`,
    sql`SELECT COUNT(*) as count FROM assessments`,
    sql`SELECT COUNT(*) as count FROM tenders WHERE status = 'open'`,
    sql`SELECT tier, COUNT(*) as count FROM subscriptions WHERE status = 'active' GROUP BY tier`,
    sql`SELECT * FROM crawl_logs ORDER BY created_at DESC LIMIT 10`,
    // Per-platform: last successful run time + last run time + 24h tender totals.
    // Lets ops answer "was UNGM healthy in the last 24 hours?" at a glance.
    sql`
      SELECT
        platform,
        MAX(created_at) AS last_run,
        MAX(CASE WHEN status = 'success' THEN created_at END) AS last_success,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN tenders_added ELSE 0 END) AS added_24h,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN tenders_updated ELSE 0 END) AS updated_24h,
        COUNT(CASE WHEN status = 'failure' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS failures_24h
      FROM crawl_logs
      GROUP BY platform
      ORDER BY platform
    `,
  ]);

  return NextResponse.json({
    totalUsers: users[0]?.count ?? 0,
    totalAssessments: assessments[0]?.count ?? 0,
    openTenders: tenders[0]?.count ?? 0,
    activeSubscriptions: subscriptions,
    recentCrawls,
    platformHealth,
  });
}
