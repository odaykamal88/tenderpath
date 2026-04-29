import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const rows = await sql`
    SELECT id, company_name, readiness_score, matched_tenders, gaps
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json(null, { status: 404 });

  const row = rows[0];
  const matchedTenders = Array.isArray(row.matched_tenders) ? row.matched_tenders : [];
  const gaps = Array.isArray(row.gaps) ? row.gaps : [];

  return NextResponse.json({
    assessment_id: row.id,
    company_name: row.company_name ?? "",
    readiness_score: row.readiness_score ?? 0,
    matched_tenders: matchedTenders,
    gaps,
  });
}
