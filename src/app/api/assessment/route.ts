import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";
import { crawlWebsite } from "@/lib/assessment/crawl";
import {
  classifyIndustry,
  fullAnalysis,
  determineRecommendedTier,
} from "@/lib/assessment/analyze";
import { computeGrantReadinessScore } from "@/lib/assessment/score";
import { matchTenders, matchGrants } from "@/lib/assessment/match";
import type { AssessmentInput } from "@/lib/types";

export async function POST(request: Request) {
  // Gate behind authentication
  const authResult = await requireAuth(request);
  if (!authResult.authorized) return authResult.response!;

  const body = (await request.json()) as Partial<AssessmentInput>;

  if (
    !body.companyName ||
    !body.email ||
    !body.description ||
    !body.countries?.length
  ) {
    return NextResponse.json(
      { error: "companyName, email, description, and countries are required" },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  try {
    // Stage 1: Crawl website
    const crawledData = body.website
      ? await crawlWebsite(body.website)
      : null;

    // Stage 2: Classify industry
    const classification = await classifyIndustry(
      crawledData,
      body.description,
      body.countries
    );

    // Stage 3: Full analysis with Claude Haiku 3.5
    const analysis = await fullAnalysis(
      crawledData,
      body.description,
      body.countries,
      classification,
      body.orgType,
      body.devThemes
    );

    // Compute scores & tier
    const recommendedTier = determineRecommendedTier(
      analysis.gaps,
      analysis.overall_score
    );
    const grantScore = computeGrantReadinessScore(
      body.orgType ?? null,
      analysis,
      body.devThemes ?? []
    );

    // Match tenders & grants concurrently
    const [matchedTenders, matchedGrants] = await Promise.all([
      matchTenders(analysis, body.countries, { includeConsultancies: body.includeConsultancies }),
      matchGrants(
        classification.sectors,
        body.orgType ?? null,
        body.devThemes ?? []
      ),
    ]);

    // Save assessment to DB
    const rows = await sql`
      INSERT INTO assessments (
        company_name, email, website, description, sector,
        countries, crawled_data, ai_analysis, readiness_score,
        matched_tenders, gaps, recommended_tier, org_type,
        dev_themes, matched_grants, grant_readiness_score,
        include_consultancies
      ) VALUES (
        ${body.companyName}, ${body.email}, ${body.website ?? null},
        ${body.description}, ${classification.detected_industry},
        ${JSON.stringify(body.countries)}, ${JSON.stringify(crawledData)},
        ${JSON.stringify(analysis)}, ${analysis.overall_score},
        ${JSON.stringify(matchedTenders)}, ${JSON.stringify(analysis.gaps)},
        ${recommendedTier}, ${body.orgType ?? null},
        ${JSON.stringify(body.devThemes ?? [])}, ${JSON.stringify(matchedGrants)},
        ${grantScore}, ${body.includeConsultancies ?? false}
      ) RETURNING id
    `;

    const assessmentId = rows[0].id;

    // Queue results email
    await sql`
      INSERT INTO email_queue (assessment_id, email, status)
      VALUES (${assessmentId}, ${body.email}, 'pending')
    `;

    return NextResponse.json({
      id: assessmentId,
      readiness_score: analysis.overall_score,
      grant_readiness_score: grantScore,
      recommended_tier: recommendedTier,
      summary: analysis.summary,
      gaps: analysis.gaps.length,
      matched_tenders: matchedTenders.length,
      matched_grants: matchedGrants.length,
      sectors: classification.sectors,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Assessment failed";
    console.error("Assessment error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
