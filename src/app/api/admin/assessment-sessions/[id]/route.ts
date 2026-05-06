import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid assessment id" }, { status: 400 });
  }

  const [rows, emailRows, pipelineRows] = await Promise.all([
    sql`
      SELECT
        a.id, a.company_name, a.email, a.website, a.description, a.sector,
        a.countries, a.crawled_data, a.ai_analysis, a.readiness_score,
        a.matched_tenders, a.gaps, a.recommended_tier, a.org_type,
        a.dev_themes, a.matched_grants, a.grant_readiness_score,
        a.include_consultancies, a.created_at,
        u.id AS user_id, u.email AS user_email, u.created_at AS user_created_at
      FROM assessments a
      LEFT JOIN users u ON lower(u.email) = lower(a.email)
      WHERE a.id = ${id}
      LIMIT 1
    `,
    sql`
      SELECT id, status, sent_at, error, created_at, created_at AS updated_at
      FROM email_queue
      WHERE assessment_id = ${id}
      ORDER BY id DESC
      LIMIT 5
    `,
    sql`
      SELECT id, tender_id, tender_title, tender_agency, tender_deadline, fit_score, stage, updated_at
      FROM pipeline_items
      WHERE assessment_id = ${id}
      ORDER BY updated_at DESC
      LIMIT 20
    `,
  ]);

  if (!rows.length) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  const row = rows[0];
  const matchedTenders = Array.isArray(row.matched_tenders) ? row.matched_tenders : [];
  const matchedGrants = Array.isArray(row.matched_grants) ? row.matched_grants : [];
  const gaps = Array.isArray(row.gaps) ? row.gaps : [];

  return NextResponse.json({
    assessment: {
      id: row.id,
      company_name: row.company_name,
      email: row.email,
      website: row.website,
      description: row.description,
      sector: row.sector,
      countries: Array.isArray(row.countries) ? row.countries : [],
      crawled_data: row.crawled_data,
      ai_analysis: row.ai_analysis,
      readiness_score: row.readiness_score,
      recommended_tier: row.recommended_tier,
      org_type: row.org_type,
      dev_themes: Array.isArray(row.dev_themes) ? row.dev_themes : [],
      grant_readiness_score: row.grant_readiness_score,
      include_consultancies: row.include_consultancies,
      created_at: row.created_at,
      user: row.user_id ? {
        id: row.user_id,
        email: row.user_email,
        created_at: row.user_created_at,
      } : null,
      counts: {
        tenders: matchedTenders.length,
        grants: matchedGrants.length,
        gaps: gaps.length,
        pipeline_items: pipelineRows.length,
      },
    },
    top_tenders: matchedTenders.slice(0, 10),
    top_grants: matchedGrants.slice(0, 10),
    gaps: gaps.slice(0, 10),
    emails: emailRows,
    pipeline_items: pipelineRows,
  });
}
