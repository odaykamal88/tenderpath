import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const [users, assessments, tenders, subscriptions, recentCrawls] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM users`,
    sql`SELECT COUNT(*) as count FROM assessments`,
    sql`SELECT COUNT(*) as count FROM tenders WHERE status = 'open'`,
    sql`SELECT tier, COUNT(*) as count FROM subscriptions WHERE status = 'active' GROUP BY tier`,
    sql`SELECT * FROM crawl_logs ORDER BY started_at DESC LIMIT 10`,
  ]);

  return NextResponse.json({
    totalUsers: users[0]?.count ?? 0,
    totalAssessments: assessments[0]?.count ?? 0,
    openTenders: tenders[0]?.count ?? 0,
    activeSubscriptions: subscriptions,
    recentCrawls,
  });
}
