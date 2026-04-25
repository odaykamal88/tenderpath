import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";
import type { Gap } from "@/lib/types";

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;

  // Fetch the latest assessment for this user by email
  const rows = await sql`
    SELECT id, company_name, readiness_score, gaps, matched_tenders, recommended_tier, created_at
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ assessment: null });
  }

  const row = rows[0];
  const gaps = (row.gaps as Gap[] | null) ?? [];
  const highSeverityGaps = gaps.filter((g) => g.severity === "high");
  const matchedTenders = row.matched_tenders as unknown[];

  return NextResponse.json({
    assessment: {
      id: row.id,
      company_name: row.company_name,
      readiness_score: row.readiness_score,
      recommended_tier: row.recommended_tier,
      matched_tenders_count: Array.isArray(matchedTenders) ? matchedTenders.length : 0,
      high_severity_gaps: highSeverityGaps,
      gap_count: gaps.length,
      created_at: row.created_at,
    },
  });
}
