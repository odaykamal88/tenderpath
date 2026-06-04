/**
 * next-step.ts — server-side recommended-next-step derivation for the
 * Vendor Readiness report.
 *
 * The wizard used to render the recommended paid SKU client-side (the old
 * AssessmentResults S3 slab) via the shared readiness engine. Now that the
 * post-wizard flow hands off to the canonical /assessment/[id] report, this
 * recomputes the SAME recommendation server-side from the persisted
 * assessment, so the report's anonymous-viewer CTA matches what the wizard
 * used to show. Same engine (scoreReadiness), same routing — no new logic.
 *
 * Deterministic, no I/O, no LLM. Degrades to null on any failure so the
 * report never breaks over a missing CTA.
 */

import { scoreReadiness } from "@/lib/proposal-package/readiness-engine";
import { SERVICE_CATALOG } from "@/lib/proposal-package/gap-routing";
import type { ServiceSku } from "@/lib/proposal-package/scoring-engine";
import type { ApplicantContext } from "@/lib/proposal-package/applicant-context";
import { isComingSoonTier } from "@/lib/pricing";

export type ReportNextStep = {
  sku: ServiceSku;
  /** Display label, e.g. "Bid/No-Bid Analyst". From SERVICE_CATALOG. */
  label: string;
  /** Display price, e.g. "$39". From SERVICE_CATALOG. */
  price: string;
  /** /pay?plan= slug for this SKU. */
  paySlug: string;
  /** Why this SKU is the right next step for this applicant's posture. */
  rationale: string;
  comingSoon: boolean;
};

// SKU → pay-page slug. Mirrors the mapping the old client AssessmentResults
// used; kept here as the single server-side source now that the client copy
// is gone.
const SKU_PAY_SLUG: Record<ServiceSku, string> = {
  bid_no_bid: "bid-no-bid",
  matching: "grants-tenders-matching",
  proposal_draft: "proposal-draft",
  roster: "roster-fast-track",
};

export interface NextStepInput {
  companyName: string;
  sector: string | null;
  sectors: string[];
  capabilities: string[];
  certifications: string[];
  summary?: string;
}

// Legacy assessment → ApplicantContext bridge. Mirrors the old client
// applicantFromLegacyAssessment: fields the readiness rubric reads are mapped;
// the rest default (the engine surfaces those as gaps — exactly what the
// routing pitches a SKU against). Country / years / personnel aren't persisted
// on the assessment yet, so they stay at conservative defaults — same inputs
// the wizard fed the engine, so the recommendation is unchanged.
function applicantFromAssessment(input: NextStepInput): ApplicantContext {
  const sectorsCovered = [input.sector ?? "", ...input.sectors, ...input.capabilities]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    // Dedupe — sector often appears in sectors[] too.
    .filter((s, i, arr) => arr.indexOf(s) === i);

  return {
    companyName: input.companyName || "Vendor",
    countryOfRegistration: "Unknown",
    yearsOfExperience: 0,
    sectorsCovered,
    keyPersonnel: [],
    pastPerformance: [],
    certifications: input.certifications ?? [],
    geographicReach: [],
    capabilityNarrative: input.summary || undefined,
  };
}

export function deriveReportNextStep(input: NextStepInput): ReportNextStep | null {
  try {
    const applicant = applicantFromAssessment(input);
    const { summary } = scoreReadiness(applicant);
    const sku = summary.primaryAction;
    const meta = SERVICE_CATALOG[sku];
    const paySlug = SKU_PAY_SLUG[sku];
    return {
      sku,
      label: meta.label,
      price: meta.price,
      paySlug,
      rationale: summary.primaryActionRationale,
      comingSoon: isComingSoonTier(paySlug),
    };
  } catch (err) {
    console.warn("[assessment:next_step:derive_failed]", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
