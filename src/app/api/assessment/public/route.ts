import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
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

function synthesizeDescription(crawl: Awaited<ReturnType<typeof crawlWebsite>> | null): string {
  if (!crawl) return "";
  const parts = [crawl.title, crawl.metaDescription, crawl.ogDescription].filter(Boolean) as string[];
  const head = parts.join(" — ").trim();
  const body = (crawl.content ?? "").slice(0, 800).trim();
  return [head, body].filter(Boolean).join("\n\n");
}

/**
 * Public assessment endpoint — no auth required.
 * Used by the lead-generation assessment page.
 * Returns full assessment data for immediate rendering.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AssessmentInput>;

  if (!body.companyName || !body.email || !body.countries?.length) {
    return NextResponse.json(
      { error: "companyName, email, and countries are required" },
      { status: 400 }
    );
  }
  if (!body.website && !body.description) {
    return NextResponse.json(
      { error: "Provide either a website URL or a short description of your business" },
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

    // If user skipped description, synthesize one from the crawl
    const description = body.description?.trim() || synthesizeDescription(crawledData);

    // Stage 2: Classify industry
    const classification = await classifyIndustry(
      crawledData,
      description,
      body.countries
    );

    // Stage 3: Full analysis
    const analysis = await fullAnalysis(
      crawledData,
      description,
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
      matchTenders(analysis, body.countries),
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
        dev_themes, matched_grants, grant_readiness_score
      ) VALUES (
        ${body.companyName}, ${body.email}, ${body.website ?? null},
        ${description}, ${classification.detected_industry},
        ${JSON.stringify(body.countries)}, ${JSON.stringify(crawledData)},
        ${JSON.stringify(analysis)}, ${analysis.overall_score},
        ${JSON.stringify(matchedTenders)}, ${JSON.stringify(analysis.gaps)},
        ${recommendedTier}, ${body.orgType ?? null},
        ${JSON.stringify(body.devThemes ?? [])}, ${JSON.stringify(matchedGrants)},
        ${grantScore}
      ) RETURNING id
    `;

    const assessmentId = rows[0].id;

    // Queue + send results email (fire-and-forget; failures don't block response)
    await sql`
      INSERT INTO email_queue (assessment_id, email, status)
      VALUES (${assessmentId}, ${body.email}, 'pending')
    `;
    sendAssessmentEmail({
      assessmentId,
      email: body.email,
      companyName: body.companyName,
      readinessScore: analysis.overall_score,
      recommendedTier: recommendedTier,
      summary: analysis.summary,
      topGap: analysis.gaps[0]?.gap ?? null,
      tenderCount: matchedTenders.length,
      grantCount: matchedGrants.length,
      topTenders: matchedTenders.slice(0, 3).map((t) => ({
        title: t.title,
        agency: t.agency,
        country: t.country,
        match_reasons: t.match_reasons,
      })),
    }).catch((e) => console.error("Email send failed:", e));

    return NextResponse.json({
      id: assessmentId,
      company_name: body.companyName,
      email: body.email,
      sector: classification.detected_industry,
      sectors: classification.sectors,
      readiness_score: analysis.overall_score,
      grant_readiness_score: grantScore,
      recommended_tier: recommendedTier,
      summary: analysis.summary,
      strengths: analysis.strengths,
      capabilities: analysis.capabilities,
      certifications_detected: analysis.certifications_detected,
      readiness_dimensions: analysis.readiness_dimensions,
      gaps: analysis.gaps,
      matched_tenders: matchedTenders,
      matched_grants: matchedGrants,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Assessment failed";
    console.error("Assessment error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
