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
import { track } from "@/lib/telemetry/funnel";
import { decodeHtmlEntities } from "@/lib/text/entities";
import type { AssessmentInput, Gap, MatchedGrant, MatchedTender, ReadinessDimensions, TierSlug } from "@/lib/types";

function cleanCompanyName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const decoded = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  return decoded.length > 0 ? decoded : null;
}

export type AssessmentRunMode = "public" | "authenticated";

export type AssessmentRunResult = {
  id: number;
  // UUID for URL construction; only the int id remains for internal joins.
  public_id: string;
  company_name: string;
  email: string;
  sector: string;
  sectors: string[];
  readiness_score: number;
  grant_readiness_score: number;
  recommended_tier: TierSlug;
  summary: string;
  strengths: string[];
  capabilities: string[];
  certifications_detected: string[];
  readiness_dimensions: ReadinessDimensions;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
  assessment_duration_ms: number;
  assessment_timings: Record<string, number>;
  status: "completed";
};

let columnsEnsured = false;

export async function ensureAssessmentRuntimeColumns() {
  if (columnsEnsured) return;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_status VARCHAR(32) DEFAULT 'completed'`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_error TEXT`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_duration_ms INTEGER`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_timings JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_completed_at TIMESTAMPTZ`;
  columnsEnsured = true;
}

export function synthesizeDescription(crawl: Awaited<ReturnType<typeof crawlWebsite>> | null): string {
  if (!crawl) return "";
  const parts = [crawl.title, crawl.metaDescription, crawl.ogDescription].filter(Boolean) as string[];
  const head = parts.join(" — ").trim();
  const body = (crawl.content ?? "").slice(0, 800).trim();
  return [head, body].filter(Boolean).join("\n\n");
}

export function enrichDescription(
  description: string,
  additionalCapabilities?: string,
): string {
  const additions: string[] = [];
  if (additionalCapabilities?.trim()) {
    additions.push(`Additional capabilities shared by the user: ${additionalCapabilities.trim()}`);
  }
  return [description, ...additions].filter(Boolean).join("\n\n");
}

export function validateAssessmentInput(
  body: Partial<AssessmentInput>,
  options: { requireDescription?: boolean } = {},
): string | null {
  if (!body.companyName || !body.email || !body.countries?.length) {
    return "companyName, email, and countries are required";
  }
  if (options.requireDescription && !body.description) {
    return "companyName, email, description, and countries are required";
  }
  if (!options.requireDescription && !body.website && !body.description) {
    return "Provide either a website URL or a short description of your business";
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) return "Invalid email";
  return null;
}

export async function createQueuedAssessment(body: Partial<AssessmentInput>) {
  await ensureAssessmentRuntimeColumns();
  const description = [
    body.description ?? "",
    body.additionalCapabilities?.trim()
      ? `Additional capabilities shared by the user: ${body.additionalCapabilities.trim()}`
      : null,
    body.adjacentSectors?.length
      ? `Adjacent fields the user wants monitored: ${body.adjacentSectors.join(", ")}`
      : null,
  ].filter(Boolean).join("\n\n");

  const rows = await sql`
    INSERT INTO assessments (
      company_name, email, website, description, countries, org_type,
      dev_themes, include_consultancies, assessment_status
    ) VALUES (
      ${cleanCompanyName(body.companyName)}, ${body.email ?? null}, ${body.website ?? null},
      ${description}, ${JSON.stringify(body.countries ?? [])}, ${body.orgType ?? null},
      ${JSON.stringify(body.devThemes ?? [])}, ${body.includeConsultancies ?? false}, 'queued'
    ) RETURNING id, public_id, created_at
  `;
  return {
    id: rows[0].id as number,
    public_id: rows[0].public_id as string,
    created_at: rows[0].created_at as string,
  };
}

export async function markAssessmentFailed(assessmentId: number, err: unknown, durationMs?: number, timings?: Record<string, number>) {
  await ensureAssessmentRuntimeColumns();
  const message = err instanceof Error ? err.message : "Assessment failed";
  await sql`
    UPDATE assessments
    SET assessment_status = 'failed',
        assessment_error = ${message},
        assessment_duration_ms = ${durationMs ?? null},
        assessment_timings = ${JSON.stringify(timings ?? {})}::jsonb,
        assessment_completed_at = NOW()
    WHERE id = ${assessmentId}
  `;
  console.error("[tp:assessment:failed]", { assessmentId, durationMs, timings, error: message });
}

export async function sendAssessmentResultEmail(result: AssessmentRunResult) {
  console.log("[tp:email:attempt]", { assessmentId: result.id, email: result.email });
  await sendAssessmentEmail({
    assessmentId: result.id,
    email: result.email,
    companyName: result.company_name,
    readinessScore: result.readiness_score,
    recommendedTier: result.recommended_tier,
    summary: result.summary,
    topGap: result.gaps[0]?.gap ?? null,
    tenderCount: result.matched_tenders.length,
    grantCount: result.matched_grants.length,
    topTenders: result.matched_tenders.slice(0, 3).map((t) => ({
      title: t.title,
      agency: t.agency,
      country: t.country,
      match_reasons: t.match_reasons ?? [],
    })),
    sectors: result.sectors,
    grantReadinessScore: result.grant_readiness_score,
    readinessDimensions: result.readiness_dimensions,
    gaps: result.gaps,
    strengths: result.strengths ?? [],
    matchedTenders: result.matched_tenders,
    matchedGrants: result.matched_grants,
  });
}

export async function runAssessmentPipeline(
  body: Partial<AssessmentInput>,
  options: {
    mode: AssessmentRunMode;
    assessmentId?: number;
    sendEmailMode?: "inline" | "none";
  },
): Promise<AssessmentRunResult> {
  await ensureAssessmentRuntimeColumns();
  const startedAt = Date.now();
  let lastMark = startedAt;
  const timings: Record<string, number> = {};
  const mark = (stage: string) => {
    const now = Date.now();
    timings[stage] = now - lastMark;
    lastMark = now;
  };

  if (options.assessmentId) {
    await sql`
      UPDATE assessments
      SET assessment_status = 'running',
          assessment_error = NULL,
          assessment_started_at = NOW()
      WHERE id = ${options.assessmentId}
    `;
  }

  try {
    const crawledData = body.website ? await crawlWebsite(body.website) : null;
    mark("crawl");

    const baseDescription = body.description?.trim() || synthesizeDescription(crawledData);
    const analysisDescription = enrichDescription(baseDescription, body.additionalCapabilities);
    const storedDescription = [
      analysisDescription,
      body.adjacentSectors?.length
        ? `Adjacent fields the user wants monitored: ${body.adjacentSectors.join(", ")}`
        : null,
    ].filter(Boolean).join("\n\n");

    const classification = await classifyIndustry(
      crawledData,
      analysisDescription,
      body.countries ?? [],
      body.orgType,
      body.devThemes,
    );
    mark("classify");

    const analysis = await fullAnalysis(
      crawledData,
      analysisDescription,
      body.countries ?? [],
      classification,
      body.orgType,
      body.devThemes,
    );
    mark("analysis");

    const recommendedTier = determineRecommendedTier(
      analysis.gaps,
      analysis.overall_score,
      body.intent,
    );
    const grantScore = computeGrantReadinessScore(
      body.orgType ?? null,
      analysis,
      body.devThemes ?? [],
    );

    const [matchedTenders, matchedGrants] = await Promise.all([
      matchTenders(analysis, body.countries ?? [], {
        includeConsultancies: body.includeConsultancies,
        userEmail: body.email,
        adjacentSectorLabels: body.adjacentSectors,
        orgType: body.orgType,
      }),
      matchGrants(
        classification.sectors,
        body.orgType ?? null,
        body.devThemes ?? [],
        body.countries ?? [],
      ),
    ]);
    mark("matching");

    const durationMs = Date.now() - startedAt;
    const rows = options.assessmentId
      ? await sql`
          UPDATE assessments
          SET company_name = ${cleanCompanyName(body.companyName)},
              email = ${body.email ?? null},
              website = ${body.website ?? null},
              description = ${storedDescription},
              sector = ${classification.detected_industry},
              countries = ${JSON.stringify(body.countries ?? [])}::jsonb,
              crawled_data = ${JSON.stringify(crawledData)}::jsonb,
              ai_analysis = ${JSON.stringify(analysis)}::jsonb,
              readiness_score = ${analysis.overall_score},
              matched_tenders = ${JSON.stringify(matchedTenders)}::jsonb,
              gaps = ${JSON.stringify(analysis.gaps)}::jsonb,
              recommended_tier = ${recommendedTier},
              org_type = ${body.orgType ?? null},
              dev_themes = ${JSON.stringify(body.devThemes ?? [])}::jsonb,
              matched_grants = ${JSON.stringify(matchedGrants)}::jsonb,
              grant_readiness_score = ${grantScore},
              include_consultancies = ${body.includeConsultancies ?? false},
              assessment_status = 'completed',
              assessment_error = NULL,
              assessment_duration_ms = ${durationMs},
              assessment_timings = ${JSON.stringify(timings)}::jsonb,
              assessment_completed_at = NOW()
          WHERE id = ${options.assessmentId}
          RETURNING id, public_id
        `
      : await sql`
          INSERT INTO assessments (
            company_name, email, website, description, sector,
            countries, crawled_data, ai_analysis, readiness_score,
            matched_tenders, gaps, recommended_tier, org_type,
            dev_themes, matched_grants, grant_readiness_score,
            include_consultancies, assessment_status, assessment_duration_ms,
            assessment_timings, assessment_started_at, assessment_completed_at
          ) VALUES (
            ${cleanCompanyName(body.companyName)}, ${body.email ?? null}, ${body.website ?? null},
            ${storedDescription}, ${classification.detected_industry},
            ${JSON.stringify(body.countries ?? [])}, ${JSON.stringify(crawledData)},
            ${JSON.stringify(analysis)}, ${analysis.overall_score},
            ${JSON.stringify(matchedTenders)}, ${JSON.stringify(analysis.gaps)},
            ${recommendedTier}, ${body.orgType ?? null},
            ${JSON.stringify(body.devThemes ?? [])}, ${JSON.stringify(matchedGrants)},
            ${grantScore}, ${body.includeConsultancies ?? false}, 'completed',
            ${durationMs}, ${JSON.stringify(timings)}, NOW(), NOW()
          ) RETURNING id, public_id
        `;

    const assessmentId = rows[0].id as number;
    const publicId = rows[0].public_id as string;
    mark("persist");
    timings.persist = timings.persist ?? 0;

    console.log("[tp:assessment:complete]", {
      assessmentId,
      email: body.email,
      tenderCount: matchedTenders.length,
      grantCount: matchedGrants.length,
      durationMs,
      timings,
    });

    await track("assessment_completed", {
      assessment_id: assessmentId,
      readiness_score: analysis.overall_score,
      tender_count: matchedTenders.length,
      grant_count: matchedGrants.length,
      duration_ms: durationMs,
      mode: options.mode,
    });

    await sql`
      INSERT INTO email_queue (assessment_id, email, status)
      VALUES (${assessmentId}, ${body.email ?? ""}, 'pending')
    `;
    console.log("[tp:email:queued]", { assessmentId, email: body.email });

    const result = {
      id: assessmentId,
      public_id: publicId,
      company_name: cleanCompanyName(body.companyName) ?? body.companyName!,
      email: body.email!,
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
      assessment_duration_ms: durationMs,
      assessment_timings: timings,
      status: "completed" as const,
    };

    if (options.sendEmailMode !== "none") {
      try {
        await sendAssessmentResultEmail(result);
      } catch (emailErr) {
        console.error("Assessment email failed:", emailErr);
      }
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (options.assessmentId) await markAssessmentFailed(options.assessmentId, err, durationMs, timings);
    throw err;
  }
}
