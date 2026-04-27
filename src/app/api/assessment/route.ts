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
import { sendAssessmentEmail } from "@/lib/email/sendAssessment";
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

    const analysisDescription = [
      body.description,
      body.additionalCapabilities?.trim()
        ? `Additional capabilities shared by the user: ${body.additionalCapabilities.trim()}`
        : null,
    ].filter(Boolean).join("\n\n");
    const storedDescription = [
      analysisDescription,
      body.adjacentSectors?.length
        ? `Adjacent fields the user wants monitored: ${body.adjacentSectors.join(", ")}`
        : null,
    ].filter(Boolean).join("\n\n");

    // Stage 2: Classify industry
    const classification = await classifyIndustry(
      crawledData,
      analysisDescription,
      body.countries
    );

    // Stage 3: Full analysis with Claude Haiku 3.5
    const analysis = await fullAnalysis(
      crawledData,
      analysisDescription,
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
      matchTenders(analysis, body.countries, {
        includeConsultancies: body.includeConsultancies,
        userEmail: body.email,
        adjacentSectorLabels: body.adjacentSectors,
      }),
      matchGrants(
        classification.sectors,
        body.orgType ?? null,
        body.devThemes ?? [],
        body.countries ?? []
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
        ${storedDescription}, ${classification.detected_industry},
        ${JSON.stringify(body.countries)}, ${JSON.stringify(crawledData)},
        ${JSON.stringify(analysis)}, ${analysis.overall_score},
        ${JSON.stringify(matchedTenders)}, ${JSON.stringify(analysis.gaps)},
        ${recommendedTier}, ${body.orgType ?? null},
        ${JSON.stringify(body.devThemes ?? [])}, ${JSON.stringify(matchedGrants)},
        ${grantScore}, ${body.includeConsultancies ?? false}
      ) RETURNING id
    `;

    const assessmentId = rows[0].id;
    console.log("[tp:assessment:complete]", { assessmentId, email: body.email, tenderCount: matchedTenders.length, grantCount: matchedGrants.length });

    // Queue results email (kept for audit trail)
    await sql`
      INSERT INTO email_queue (assessment_id, email, status)
      VALUES (${assessmentId}, ${body.email}, 'pending')
    `;
    console.log("[tp:email:queued]", { assessmentId, email: body.email });

    try {
      console.log("[tp:email:attempt]", { assessmentId, email: body.email });
      await sendAssessmentEmail({
        assessmentId,
        email: body.email,
        companyName: body.companyName,
        readinessScore: analysis.overall_score,
        recommendedTier,
        summary: analysis.summary,
        topGap: analysis.gaps?.[0]?.gap ?? null,
        tenderCount: matchedTenders.length,
        grantCount: matchedGrants.length,
        topTenders: matchedTenders.slice(0, 3).map((t) => ({
          title: t.title,
          agency: t.agency,
          country: t.country,
          match_reasons: t.match_reasons ?? [],
        })),
      });
    } catch (emailErr) {
      console.error("Assessment email failed:", emailErr);
    }

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
