import { sql } from "@/lib/db";
import { crawlWebsite } from "@/lib/assessment/crawl";
import { classifyIndustry, fullAnalysis } from "@/lib/assessment/analyze";
import { synthesizeDescription } from "@/lib/assessment/run";
import type { AIAnalysis } from "@/lib/types";
import { ensureNetworkMatchingColumns } from "./schema";
import type { NetworkProfileStatus } from "./types";

export interface BuildProfileInput {
  id: number;
  website: string | null;
  services_text: string | null;
  countries: string[];
  sectors: string[];
  org_type: string | null;
}

export interface BuildProfileResult {
  status: NetworkProfileStatus;
  analysis: AIAnalysis | null;
  error?: string;
}

/**
 * Build a capability profile (AIAnalysis) for a network/bizdev company by
 * reusing the exact assessment building blocks — crawlWebsite + classifyIndustry
 * + fullAnalysis. Deliberately does NOT use runAssessmentPipeline: that path
 * inserts an `assessments` row, queues a result email, and fires funnel
 * telemetry, none of which should happen for an external prospect. The result
 * is persisted onto the network_companies row; matching reads ai_analysis.
 */
export async function buildNetworkCompanyProfile(
  company: BuildProfileInput,
): Promise<BuildProfileResult> {
  await ensureNetworkMatchingColumns();

  try {
    const crawl = company.website ? await crawlWebsite(company.website) : null;
    // Operator-typed service text is the primary description; the crawl is a
    // fallback when no text was supplied and is always passed separately so it
    // informs classification/analysis regardless (same as run.ts).
    const description = company.services_text?.trim() || synthesizeDescription(crawl);

    if (!crawl && description.trim().length < 30) {
      const msg = "No usable website content or service description to profile. Add a website or a fuller service description.";
      await sql`
        UPDATE network_companies
        SET profile_status = 'failed', profile_error = ${msg},
            crawled_data = ${JSON.stringify(crawl)}::jsonb, updated_at = NOW()
        WHERE id = ${company.id}
      `;
      console.warn("[network:profile:insufficient_input]", { companyId: company.id });
      return { status: "failed", analysis: null, error: msg };
    }

    const classification = await classifyIndustry(
      crawl,
      description,
      company.countries,
      company.org_type ?? undefined,
    );
    const analysis = await fullAnalysis(
      crawl,
      description,
      company.countries,
      classification,
      company.org_type ?? undefined,
    );

    // Backfill display sectors from the classification only when the operator
    // left them blank — never override an explicit operator choice.
    const sectorsToStore = company.sectors.length ? company.sectors : classification.sectors;

    await sql`
      UPDATE network_companies
      SET ai_analysis = ${JSON.stringify(analysis)}::jsonb,
          crawled_data = ${JSON.stringify(crawl)}::jsonb,
          sectors = ${JSON.stringify(sectorsToStore)}::jsonb,
          profile_status = 'ready',
          profile_error = NULL,
          updated_at = NOW()
      WHERE id = ${company.id}
    `;
    return { status: "ready", analysis };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Profile build failed";
    console.error("[network:profile:build_failed]", { companyId: company.id, error: msg });
    await sql`
      UPDATE network_companies
      SET profile_status = 'failed', profile_error = ${msg}, updated_at = NOW()
      WHERE id = ${company.id}
    `;
    return { status: "failed", analysis: null, error: msg };
  }
}
