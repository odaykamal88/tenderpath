import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const [sessions, assessmentCounts, recentAssessments] = await Promise.all([
    sql`
      SELECT
        ip_address,
        country,
        user_agent,
        logged_at,
        email
      FROM demo_sessions
      ORDER BY logged_at DESC
      LIMIT 100
    `,
    sql`
      SELECT
        email,
        COUNT(*) AS total,
        MAX(created_at) AS last_at
      FROM assessments
      WHERE lower(email) = ANY(
        SELECT DISTINCT lower(email) FROM demo_sessions
        UNION ALL
        SELECT 'demo@tenderpath.me'
      )
      GROUP BY email
      ORDER BY total DESC
      LIMIT 50
    `,
    sql`
      SELECT
        id,
        company_name,
        email,
        readiness_score,
        created_at
      FROM assessments
      WHERE lower(email) = 'demo@tenderpath.me'
      ORDER BY created_at DESC
      LIMIT 20
    `,
  ]);

  const ipSummary = Object.values(
    (sessions as Array<{ ip_address: string | null; country: string | null; email: string; user_agent: string | null; logged_at: string }>)
      .reduce<Record<string, { ip: string | null; country: string | null; sessions: number; last_seen: string; emails: Set<string> }>>((acc, s) => {
        const key = s.ip_address ?? "unknown";
        if (!acc[key]) acc[key] = { ip: s.ip_address, country: s.country, sessions: 0, last_seen: s.logged_at, emails: new Set() };
        acc[key].sessions++;
        acc[key].emails.add(s.email);
        if (s.logged_at > acc[key].last_seen) acc[key].last_seen = s.logged_at;
        return acc;
      }, {})
  ).map((r) => ({ ...r, emails: Array.from(r.emails) }))
    .sort((a, b) => b.sessions - a.sessions);

  return NextResponse.json({
    sessions,
    assessmentCounts,
    recentAssessments,
    ipSummary,
    totalSessions: sessions.length,
    uniqueIps: ipSummary.length,
  });
}
