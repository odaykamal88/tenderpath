import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const assessmentId = parseInt(id, 10);

  if (isNaN(assessmentId)) {
    return NextResponse.json({ error: "Invalid assessment ID" }, { status: 400 });
  }

  const rows = await sql`
    SELECT * FROM assessments WHERE id = ${assessmentId}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  const row = rows[0];

  return NextResponse.json({
    id: row.id,
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
    created_at: row.created_at,
  });
}
