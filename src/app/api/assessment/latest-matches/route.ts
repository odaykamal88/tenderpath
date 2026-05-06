import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { matchGrants, matchTenders } from "@/lib/assessment/match";
import type { AIAnalysis, MatchedTender } from "@/lib/types";

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

async function seedPipelineItems(
  userId: number,
  assessmentId: number,
  tenders: Array<MatchedTender & { fit_score?: number }>,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const t of tenders.slice(0, 20)) {
    if (!t.title) {
      skipped++;
      continue;
    }

    const existing = t.id != null
      ? await sql`
          SELECT id, stage
          FROM pipeline_items
          WHERE user_id = ${userId} AND tender_id = ${t.id}
          ORDER BY id ASC
          LIMIT 1
        `
      : await sql`
          SELECT id, stage
          FROM pipeline_items
          WHERE user_id = ${userId}
            AND assessment_id = ${assessmentId}
            AND tender_title = ${t.title}
          ORDER BY id ASC
          LIMIT 1
        `;

    const matchReasonsJson = t.structured_reasons ? JSON.stringify(t.structured_reasons) : null;

    if (existing.length) {
      await sql`
        UPDATE pipeline_items SET
          assessment_id = COALESCE(assessment_id, ${assessmentId}),
          tender_title = ${t.title},
          tender_agency = COALESCE(${t.agency ?? null}, tender_agency),
          tender_deadline = COALESCE(${t.deadline ?? null}, tender_deadline),
          tender_value = COALESCE(${typeof t.estimated_value === "string" ? t.estimated_value : null}, tender_value),
          fit_score = GREATEST(fit_score, ${t.fit_score ?? t.score ?? 0}),
          match_reasons = COALESCE(${matchReasonsJson}::jsonb, match_reasons),
          updated_at = NOW()
        WHERE id = ${existing[0].id as number}
      `;
      updated++;
      continue;
    }

    await sql`
      INSERT INTO pipeline_items
        (user_id, tender_id, assessment_id, tender_title, tender_agency, tender_deadline,
         tender_value, fit_score, stage, match_reasons)
      VALUES
        (${userId}, ${t.id ?? null}, ${assessmentId}, ${t.title}, ${t.agency ?? null},
         ${t.deadline ?? null}, ${typeof t.estimated_value === "string" ? t.estimated_value : null},
         ${t.fit_score ?? t.score ?? 0}, 'matched', ${matchReasonsJson}::jsonb)
    `;
    created++;
  }

  return { created, updated, skipped };
}

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;
  const body = await request.json().catch(() => ({})) as { seed_pipeline?: boolean };

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
