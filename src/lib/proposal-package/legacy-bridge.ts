/**
 * legacy-bridge.ts — adapt legacy work-order data to the Sprint 1-5 engine.
 *
 * The new scoring engine (extractRubric + runRevisionLoop) was designed
 * against multi-file fixtures with structured manifests, per-notice subdirs,
 * and a typed ApplicantContext. Production work orders have a flatter shape:
 *
 *   - work_orders.intake JSON with uploaded-document blob URLs + tender
 *     context pasted by the applicant
 *   - pipeline_items joined to tenders.description for crawled tender prose
 *   - assessments.ai_analysis with capabilities / certifications detected
 *     from the company website crawl
 *
 * This module bridges the two by producing a TenderInput with a single
 * "solicitation" IngestedDoc (the flattened tender prose) and an
 * ApplicantContext built from the assessment + AI analysis. It's an
 * intentionally lossy bridge — multi-lot detection, corrigendum
 * supersession, and Q&A binding only land when the upstream upload
 * pipeline starts producing the multi-doc shape (Sprint 6c+).
 *
 * The single-doc + cumulative-methodology default works for the majority
 * of paid orders TenderPath sees today (single-document RFPs / single-lot
 * RFQs / grant calls). Multi-lot bidders running the new pipeline against
 * a true UN multi-lot ITB will see ONE merged criteria set on the page;
 * the engine still scores it, just not lot-by-lot. Sprint 6c lifts this.
 */

import { createHash } from "node:crypto";

import type {
  DocManifestEntry,
  IngestedDoc,
  TenderInput,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";
import {
  buildTenderText,
  type AssessmentRow,
  type PipelineRow,
  type WorkOrderRow,
} from "./context";

/** Stable 16-char SHA1 prefix for DocManifestEntry.contentHash. */
function shortHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** Sanitize a tender title for use as a docId/filename. */
function safeSlug(text: string, maxLen = 60): string {
  return text
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .toLowerCase() || "tender";
}

/**
 * Build a TenderInput from a legacy work-order row. The tender prose is
 * flattened into ONE IngestedDoc with role="solicitation". The contentHash
 * lets the engine detect "did this exact input change between runs" — when
 * the applicant re-runs after editing intake or after a pipeline crawl
 * refresh, a new hash triggers a fresh extraction.
 */
export function buildTenderInputFromLegacy(
  workOrder: WorkOrderRow,
  pipelineItem: PipelineRow | null,
): TenderInput {
  const tenderText = buildTenderText(workOrder, pipelineItem);
  const tenderTitle =
    pipelineItem?.tender_title ?? workOrder.tender_title ?? `Work Order ${workOrder.id}`;
  // Prefer the pipeline tender_id when available — it stays stable across
  // re-runs of the same matched opportunity. Fall back to the work-order id
  // for paste-in / URL flows.
  const tenderId = pipelineItem?.tender_id
    ? `pipeline-${pipelineItem.tender_id}`
    : `wo-${workOrder.id}`;

  const manifest: DocManifestEntry = {
    docId: "solicitation",
    filename: `${safeSlug(tenderTitle)}.txt`,
    contentHash: shortHash(tenderText),
    role: "solicitation",
  };

  const solicitationDoc: IngestedDoc = {
    manifest,
    text: tenderText,
  };

  return {
    tenderId,
    // Legacy data doesn't carry an explicit lane flag. Default to procurement
    // since 95%+ of paid orders are UN/IFI procurement; grant lanes will
    // overrides this via pipeline_items.opportunity_type in 6c.
    lane: "procurement",
    methodology: "cumulative",
    lotMetadata: [{ lotId: "main", label: tenderTitle.slice(0, 80) }],
    docs: [solicitationDoc],
  };
}

/**
 * Build an ApplicantContext from the assessment + AI analysis. Fields the
 * engine reads (companyName, sectorsCovered, certifications, geographicReach,
 * capabilityNarrative) are populated from real data where available; the
 * structural array fields (keyPersonnel, pastPerformance) start empty
 * because legacy intake doesn't yet collect them.
 *
 * The engine handles missing fields gracefully — claims tagged with
 * provenance="gap" surface as gaps in B3 rather than crashing the run.
 * Sprint 8 (evidence carry-forward) will populate keyPersonnel and
 * pastPerformance from applicant_library uploads, lifting first-pass quality.
 */
export function buildApplicantContextFromAssessment(
  assessment: AssessmentRow | null,
  workOrder: WorkOrderRow,
): ApplicantContext {
  if (!assessment) {
    return {
      companyName: workOrder.email?.split("@")[0] ?? `Vendor ${workOrder.id}`,
      countryOfRegistration: "Unknown",
      yearsOfExperience: 0,
      sectorsCovered: [],
      keyPersonnel: [],
      pastPerformance: [],
      certifications: [],
      geographicReach: [],
      capabilityNarrative: "No company profile available — the applicant submitted this work order without completing the assessment flow.",
    };
  }

  const ai = (assessment.ai_analysis ?? {}) as Record<string, unknown>;
  const aiCapabilities = Array.isArray(ai.capabilities)
    ? (ai.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  const aiCerts = Array.isArray(ai.certifications_detected)
    ? (ai.certifications_detected as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  const sectorsCovered = [assessment.sector, ...aiCapabilities].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  return {
    companyName: assessment.company_name ?? workOrder.email ?? "Vendor",
    countryOfRegistration:
      Array.isArray(assessment.countries) && assessment.countries.length > 0
        ? assessment.countries[0]
        : "Unknown",
    yearsOfExperience:
      typeof ai.years_of_experience === "number" ? ai.years_of_experience : 0,
    sectorsCovered,
    keyPersonnel: [],
    pastPerformance: [],
    certifications: aiCerts,
    geographicReach: Array.isArray(assessment.countries) ? assessment.countries : [],
    capabilityNarrative: assessment.description ?? undefined,
  };
}
