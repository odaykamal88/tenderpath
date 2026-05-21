import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(
  request: Request,
  context: { params: Promise<{ tenderId: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { tenderId: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid tender id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);

  const [tenderRows, candidateRows, matchRows] = await Promise.all([
    sql`
      SELECT
        id, title, description, agency, country, country_code, region, sector,
        deadline, estimated_value, source_url, source_name, opportunity_type,
        eligibility_summary, required_registrations, requirements,
        jv_allowed, experience_level, submission_language, reference_id,
        status, has_broken_link, created_at, updated_at
      FROM tenders
      WHERE id = ${id}
      LIMIT 1
    `,
    sql`
      SELECT
        a.id, a.company_name, a.email, a.website, a.description,
        a.sector, a.countries, a.org_type, a.readiness_score, a.created_at,
        a.ai_analysis->'services' AS services,
        a.ai_analysis->'capabilities' AS capabilities,
        a.crawled_data->>'finalUrl' AS final_url,
        vp.tier, vp.ungm_status, vp.contact_name, vp.contact_email,
        vp.contact_phone, vp.relationship_notes,
        vp.updated_at AS profile_updated_at,
        EXISTS (
          SELECT 1 FROM tender_vendor_matches m
          WHERE m.tender_id = ${id} AND m.assessment_id = a.id
        ) AS already_matched
      FROM assessments a
      LEFT JOIN vendor_profiles vp ON vp.assessment_id = a.id
      WHERE (
        ${q} = ''
        OR a.company_name ILIKE ${`%${q}%`}
        OR a.email ILIKE ${`%${q}%`}
        OR a.sector ILIKE ${`%${q}%`}
        OR a.description ILIKE ${`%${q}%`}
      )
      ORDER BY a.readiness_score DESC NULLS LAST, a.created_at DESC
      LIMIT ${limit}
    `,
    sql`
      SELECT
        m.id, m.tender_id, m.assessment_id, m.routed_service, m.status,
        m.fit_reasoning, m.outcome, m.created_at, m.updated_at,
        a.company_name AS vendor_company, a.email AS vendor_email,
        vp.tier AS vendor_tier,
        u.email AS created_by_email
      FROM tender_vendor_matches m
      JOIN assessments a ON a.id = m.assessment_id
      LEFT JOIN vendor_profiles vp ON vp.assessment_id = a.id
      LEFT JOIN users u ON u.id = m.created_by
      WHERE m.tender_id = ${id}
      ORDER BY m.updated_at DESC
    `,
  ]);

  if (!tenderRows.length) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  return NextResponse.json({
    tender: tenderRows[0],
    candidates: candidateRows,
    matches: matchRows,
  });
}
