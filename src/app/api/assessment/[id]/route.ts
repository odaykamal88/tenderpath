import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureAssessmentRuntimeColumns } from "@/lib/assessment/run";
import { authorizeAssessmentRead } from "@/lib/assessment/authz";
import { PUBLIC_ASSESSMENT_ERROR } from "@/lib/assessment/public-errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await ensureAssessmentRuntimeColumns();

  // IDOR-safe: UUID = capability, int = owner-only (logged).
  const authorized = await authorizeAssessmentRead(id);
  if (!authorized) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  const rows = await sql`
    SELECT * FROM assessments WHERE id = ${authorized.intId}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  const row = rows[0];

  return NextResponse.json({
    id: row.id,
    public_id: row.public_id,
    company_name: row.company_name,
    email: row.email,
    website: row.website,
    description: row.description,
    sector: row.sector,
    countries: row.countries,
    ai_analysis: row.ai_analysis,
    readiness_score: row.readiness_score,
    matched_tenders: row.matched_tenders,
    gaps: row.gaps,
    recommended_tier: row.recommended_tier,
    org_type: row.org_type,
    dev_themes: row.dev_themes,
    matched_grants: row.matched_grants,
    grant_readiness_score: row.grant_readiness_score,
    status: row.assessment_status ?? "completed",
    assessment_status: row.assessment_status ?? "completed",
    assessment_error: row.assessment_status === "failed" ? PUBLIC_ASSESSMENT_ERROR : null,
    assessment_duration_ms: row.assessment_duration_ms ?? null,
    assessment_timings: row.assessment_timings ?? {},
    assessment_started_at: row.assessment_started_at ?? null,
    assessment_completed_at: row.assessment_completed_at ?? null,
    created_at: row.created_at,
  });
}
