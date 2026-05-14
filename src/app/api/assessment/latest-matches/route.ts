import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { matchGrants, matchTenders } from "@/lib/assessment/match";
import type { AIAnalysis, MatchedTender } from "@/lib/types";
import { normalizeAssessmentTenders, seedPipelineItems } from "@/lib/pipeline/seed";

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
  const rawTenders = row.matched_tenders;
  const matchedGrants = Array.isArray(row.matched_grants) ? row.matched_grants : [];
  const gaps = Array.isArray(row.gaps) ? row.gaps : [];

  const matchedTenders = normalizeAssessmentTenders(rawTenders);

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

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;
  const body = await request.json().catch(() => ({})) as { seed_pipeline?: boolean; refresh?: boolean };

  const rows = await sql`
    SELECT
      id, company_name, email, readiness_score, grant_readiness_score,
      countries, ai_analysis, org_type, dev_themes, include_consultancies, matched_tenders, matched_grants, gaps
    FROM assessments
    WHERE email = ${user.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return NextResponse.json(null, { status: 404 });

  const row = rows[0];
  if (body.seed_pipeline && body.refresh === false) {
    const matchedTenders = normalizeAssessmentTenders(row.matched_tenders);
    const seed = await seedPipelineItems(user.id, row.id as number, matchedTenders);
    console.log("[tp:assessment:pipeline_seeded_from_stored_matches]", {
      userId: user.id,
      assessmentId: row.id,
      tenderCount: matchedTenders.length,
      seeded: seed,
    });
    return NextResponse.json({
      assessment_id: row.id,
      company_name: row.company_name ?? "",
      readiness_score: row.readiness_score ?? 0,
      grant_readiness_score: row.grant_readiness_score ?? 0,
      matched_tenders: matchedTenders,
      matched_grants: Array.isArray(row.matched_grants) ? row.matched_grants : [],
      gaps: Array.isArray(row.gaps) ? row.gaps : [],
      refreshed: false,
      pipeline_seed: seed,
    });
  }

  const analysis = row.ai_analysis as AIAnalysis | null;
  if (!analysis?.detected_industry) {
    return NextResponse.json({ error: "Latest assessment is missing analysis data and cannot be refreshed." }, { status: 422 });
  }

  const countries = Array.isArray(row.countries) ? row.countries.filter((c): c is string => typeof c === "string") : [];
  const devThemes = Array.isArray(row.dev_themes) ? row.dev_themes.filter((t): t is string => typeof t === "string") : [];
  const orgType = typeof row.org_type === "string" ? row.org_type : null;

  const [matchedTendersRaw, matchedGrants] = await Promise.all([
    matchTenders(analysis, countries, {
      includeConsultancies: row.include_consultancies === true,
      userEmail: user.email,
      orgType,
    }),
    matchGrants(analysis.sectors ?? [], orgType, devThemes, countries),
  ]);
  const matchedTenders = matchedTendersRaw.map((t) => ({
    ...t,
    fit_score: (t as MatchedTender & { fit_score?: number }).fit_score ?? t.score,
  }));

  await sql`
    UPDATE assessments
    SET matched_tenders = ${JSON.stringify(matchedTenders)}::jsonb,
        matched_grants = ${JSON.stringify(matchedGrants)}::jsonb
    WHERE id = ${row.id as number}
  `;

  const seed = body.seed_pipeline
    ? await seedPipelineItems(user.id, row.id as number, matchedTenders)
    : null;

  console.log("[tp:assessment:matches_refreshed]", {
    userId: user.id,
    assessmentId: row.id,
    tenderCount: matchedTenders.length,
    grantCount: matchedGrants.length,
    seeded: seed,
  });

  return NextResponse.json({
    assessment_id: row.id,
    company_name: row.company_name ?? "",
    readiness_score: row.readiness_score ?? 0,
    grant_readiness_score: row.grant_readiness_score ?? 0,
    matched_tenders: matchedTenders,
    matched_grants: matchedGrants,
    gaps: Array.isArray(row.gaps) ? row.gaps : [],
    refreshed: true,
    pipeline_seed: seed,
  });
}
