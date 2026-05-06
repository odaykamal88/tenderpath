import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const rows = await sql`
    SELECT id, company_name, readiness_score, grant_readiness_score, matched_tenders, matched_grants, gaps
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json(null, { status: 404 });

  const row = rows[0];
  const rawTenders = Array.isArray(row.matched_tenders) ? row.matched_tenders : [];
  const matchedGrants = Array.isArray(row.matched_grants) ? row.matched_grants : [];
  const gaps = Array.isArray(row.gaps) ? row.gaps : [];

  // Map MatchedTender.score → fit_score so seedPipeline uses per-tender scores
  const matchedTenders = rawTenders.map((t: Record<string, unknown>) => ({
    ...t,
    fit_score: (t.fit_score as number | undefined) ?? (t.score as number | undefined),
  }));

  return NextResponse.json({
    assessment_id: row.id,
    company_name: row.company_name ?? "",
    readiness_score: row.readiness_score ?? 0,
    grant_readiness_score: row.grant_readiness_score ?? 0,
    matched_tenders: matchedTenders,
    matched_grants: matchedGrants,
    gaps,
  });
}
