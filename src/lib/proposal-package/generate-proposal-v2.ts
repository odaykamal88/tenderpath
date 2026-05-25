/**
 * generate-proposal-v2.ts — Sprint 6b production entry point for the new engine.
 *
 * The legacy generateProposalPackage() in ./generate-proposal.ts runs a
 * single-shot LLM extraction + draft via extractTenderRequirements +
 * generateProposalDraft. v2 runs the Sprint 2-5 engine end-to-end:
 *
 *   extractRubric → runRevisionLoop (= draft → score → revise → re-score)
 *   → cross-section cascade detection → gap routing → snapshot
 *
 * It persists the result in the Sprint-6 output shape (output.score,
 * output.draft, output.revision_history, output.tender_rubric — same
 * shape adaptScored() reads in scored-view.tsx). Legacy fields are
 * left as empty defaults so old renderers don't crash on missing keys,
 * but no DOCX/XLSX/PDF bundle is produced — that's Sprint 6c (renders
 * via pdfDocs.tsx renderScoredDraftPdf on a new package row layout).
 *
 * Idempotency: existing rows with generation_status='ready' short-circuit
 * unless `force` is true. Re-runs increment generation_attempts and
 * UPDATE the existing row (upsertPackage handles both branches).
 *
 * Cost / latency expectation: extractRubric (~30s) + 2x scoreDraft passes
 * (~60s each) + 2x generateDraftSections (~90s each) + cascade detection
 * (~20s) = ~5-7 minutes per run. The /api/proposals/generate route's
 * maxDuration is bumped to 900s (15 min) to cover headroom.
 */

import type {
  DraftSection,
  RoutedGap,
  ScoreResult,
} from "./scoring-engine";
import { PROPOSAL_PLAN } from "./types";
import type { ProposalOutput } from "./types";
import {
  loadWorkOrder,
  loadExistingPackage,
  loadAssessmentForOrder,
  loadPipelineItem,
  generatedAtLabel,
} from "./context";
import { upsertPackage, markFailure } from "./persist";
import { extractRubricFromInput } from "./rubric-extractor";
import { runRevisionLoop, type RevisionAttemptSummary } from "./revision-loop";
import {
  buildTenderInputFromLegacy,
  buildApplicantContextFromAssessment,
} from "./legacy-bridge";
import { renderScoredDraftPdf } from "./pdfDocs";
import { renderFinancialTemplateXlsx } from "./xlsx";
import { bundleAndUpload, safeFilenameStem } from "./bundle";
import { loadEvidenceLibrary } from "@/lib/applicant-evidence/query";
import { enrichApplicantContextFromLibrary, summarizeEnrichment } from "./library-enrichment";

export interface GenerateProposalV2Result {
  ok: boolean;
  packageId?: number;
  attempts: number;
  skippedReason?:
    | "already_generated"
    | "not_paid"
    | "wrong_plan"
    | "work_order_missing";
  error?: string;
}

export interface GenerateProposalV2Options {
  workOrderId: number;
  force?: boolean;
}

/**
 * The new-engine Sprint-6 output shape, packaged into ProposalOutput so the
 * existing storage layer (proposal_packages.output JSONB) accepts it. The
 * five new fields are `unknown` at the storage layer and runtime-narrowed
 * by the dashboard page's adaptScored().
 */
function buildOutputFromEngine(args: {
  finalDraft: DraftSection[];
  finalScore: ScoreResult;
  history: RevisionAttemptSummary[];
  cascades: unknown[];
  tenderRubric: unknown;
}): ProposalOutput {
  // Best-effort legacy-field backfill so any old reader that still expects
  // the 8-section narrative doesn't see an empty object. The dashboard
  // page routes scored rows to ComplianceVerdict+RubricScore+etc. and
  // ignores these fields; this is purely a safety net for orphaned tooling.
  const technicalApproach = args.finalDraft.map((s) => s.content).filter(Boolean);

  return {
    executive_summary: "",
    technical_approach: technicalApproach,
    compliance_checklist: [],
    required_documents: [],
    cover_letter_draft: "",
    financial_template_notes: [],
    missing_information: [],
    next_steps: [],
    // Sprint 6 new shape — typed as unknown in types.ts; the storage layer
    // accepts arbitrary JSONB.
    score: args.finalScore,
    draft: args.finalDraft,
    routed_gaps: args.finalScore.routedGaps as unknown as RoutedGap[],
    cascades: args.cascades,
    revision_history: args.history,
    tender_rubric: args.tenderRubric,
  } as unknown as ProposalOutput;
}

export async function generateProposalPackageV2({
  workOrderId,
  force = false,
}: GenerateProposalV2Options): Promise<GenerateProposalV2Result> {
  // ----------------------------------------------------------------------
  // Guards (parallel to generate-proposal.ts so behavior matches the
  // legacy path's expectations from the API route's perspective).
  // ----------------------------------------------------------------------
  const order = await loadWorkOrder(workOrderId);
  if (!order) {
    return { ok: false, attempts: 0, skippedReason: "work_order_missing" };
  }
  if (order.plan !== PROPOSAL_PLAN && order.service_slug !== PROPOSAL_PLAN) {
    return { ok: false, attempts: 0, skippedReason: "wrong_plan" };
  }
  if (order.payment_status !== "paid") {
    return { ok: false, attempts: 0, skippedReason: "not_paid" };
  }

  const existing = await loadExistingPackage(workOrderId, PROPOSAL_PLAN);
  const previousAttempts = existing?.generation_attempts ?? 0;

  if (existing && existing.generation_status === "ready" && !force) {
    return {
      ok: true,
      packageId: existing.id,
      attempts: previousAttempts,
      skippedReason: "already_generated",
    };
  }

  const attempts = previousAttempts + 1;

  // ----------------------------------------------------------------------
  // Load + bridge into engine inputs
  // ----------------------------------------------------------------------
  const assessment = await loadAssessmentForOrder(order);
  const pipelineItem = await loadPipelineItem(order.pipeline_item_id);

  const tenderInput = await buildTenderInputFromLegacy(order, pipelineItem);
  const baseApplicant = buildApplicantContextFromAssessment(assessment, order);

  // ----------------------------------------------------------------------
  // Sprint 8 carry-forward: enrich the ApplicantContext with structured
  // derivations from the user's evidence library (vault_documents +
  // document_extractions). The legacy proposal pipeline already keyword-
  // matched the library via formatEvidenceLibraryForPrompt; v2 needs
  // STRUCTURED enrichment because the new rubric scores typed fields
  // (keyPersonnel[] / pastPerformance[] / certifications[]) rather than
  // free-text claims.
  //
  // Anonymous orders (user_id null) skip the enrichment — the library is
  // user-scoped. Library load failures are non-fatal: the engine still
  // runs against baseApplicant. Sprint 8b will add LLM extraction so the
  // structured entries carry real personnel / past-performance detail
  // instead of filename-derived placeholders.
  // ----------------------------------------------------------------------
  let applicant = baseApplicant;
  if (order.user_id != null) {
    try {
      const library = await loadEvidenceLibrary(order.user_id);
      applicant = enrichApplicantContextFromLibrary(baseApplicant, library);
      const summary = summarizeEnrichment(baseApplicant, applicant, library.length);
      console.log("[proposal-v2:enriched]", { workOrderId, ...summary });
    } catch (err) {
      console.warn("[proposal-v2:enrichment_failed]", {
        workOrderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tenderTitle = pipelineItem?.tender_title ?? order.tender_title;
  const agency = pipelineItem?.tender_agency ?? order.agency;

  // ----------------------------------------------------------------------
  // Mark generating so the dashboard panel can show its spinner state
  // ----------------------------------------------------------------------
  try {
    await upsertPackage({
      workOrderId,
      userId: order.user_id,
      pipelineItemId: order.pipeline_item_id,
      plan: PROPOSAL_PLAN,
      tenderTitle: tenderTitle ?? null,
      agency: agency ?? null,
      tenderUrl: order.tender_url,
      intake: order.intake ?? {},
      stripeSessionId: order.stripe_session_id,
      output: {} as ProposalOutput,
      pdfUrl: null,
      pdfPathname: null,
      uploadError: null,
      attempts,
      existingPackageId: existing?.id ?? null,
      generationStatus: "generating",
    });
  } catch (err) {
    console.warn("[proposal-v2:mark_generating_failed]", { workOrderId, err: err instanceof Error ? err.message : String(err) });
    // Non-fatal: even if we can't flip the status, the run can still complete.
  }

  // ----------------------------------------------------------------------
  // The actual engine pass
  // ----------------------------------------------------------------------
  try {
    console.log("[proposal-v2:start]", { workOrderId, tenderTitle, agency, attempts });

    const rubric = await extractRubricFromInput(tenderInput);
    console.log("[proposal-v2:rubric_extracted]", {
      workOrderId,
      lots: rubric.lots.length,
      criteriaCount: rubric.lots.reduce((s, l) => s + l.criteria.length, 0),
      noticeWideDisqualifiers: rubric.noticeWideDisqualifiers.length,
    });

    const result = await runRevisionLoop(tenderInput, rubric, applicant);
    console.log("[proposal-v2:loop_complete]", {
      workOrderId,
      attempts: result.attempts,
      passesGating: result.finalScore.lotResults.every((lr) => lr.passesGating),
      cascades: result.cascades.length,
      routedGaps: result.finalScore.routedGaps.length,
    });

    const output = buildOutputFromEngine({
      finalDraft: result.finalDraft,
      finalScore: result.finalScore,
      history: result.history,
      cascades: result.cascades,
      tenderRubric: rubric,
    });

    // ----------------------------------------------------------------------
    // Render the deliverable bundle (Sprint 6c).
    //
    // The new scored PDF (renderScoredDraftPdf) is the primary artefact —
    // it renders the engine's emit shape directly (B1 verdict → B2 score
    // → B3 routed gaps → B4 draft with inline provenance → B5 history).
    // The financial template XLSX gives the applicant a pre-formatted form
    // to fill in. Both bundle into one ZIP at the same vault path the
    // legacy pipeline uses, so downstream callers (email + dashboard
    // Download buttons) don't change.
    //
    // Rendering / upload failures DO NOT block persistence — the screen
    // view is still useful. uploadError lands in proposal_packages.error_message
    // so the failure is queryable from the DB.
    // ----------------------------------------------------------------------
    const generatedAt = generatedAtLabel();
    let pdfUrl: string | null = null;
    let pdfPathname: string | null = null;
    let uploadError: string | null = null;
    try {
      const [scoredPdf, financialXlsx] = await Promise.all([
        renderScoredDraftPdf({
          rubric,
          draft: result.finalDraft,
          score: result.finalScore,
          applicant,
          history: result.history,
          workOrderId,
          tenderTitle: tenderTitle ?? null,
          agency: agency ?? null,
          generatedAt,
        }),
        renderFinancialTemplateXlsx(output, {
          companyName: applicant.companyName,
          tenderTitle: tenderTitle ?? null,
          agency: agency ?? null,
          generatedAt,
        }),
      ]);
      const stem = safeFilenameStem(tenderTitle ?? null, `proposal-${workOrderId}`);
      const uploaded = await bundleAndUpload(
        [
          { filename: `${stem}-scored-draft.pdf`, content: scoredPdf },
          { filename: `${stem}-financial-template.xlsx`, content: financialXlsx },
        ],
        `proposal-draft/${workOrderId}-${Date.now()}.zip`,
      );
      pdfUrl = uploaded.url;
      pdfPathname = uploaded.pathname;
      uploadError = uploaded.error;
      console.log("[proposal-v2:bundle_uploaded]", {
        workOrderId,
        pdfBytes: scoredPdf.byteLength,
        xlsxBytes: financialXlsx.byteLength,
        pdfUrl,
        uploadError,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[proposal-v2:bundle_failed]", { workOrderId, error: msg });
      uploadError = `bundle_failed: ${msg}`;
    }

    const packageId = await upsertPackage({
      workOrderId,
      userId: order.user_id,
      pipelineItemId: order.pipeline_item_id,
      plan: PROPOSAL_PLAN,
      tenderTitle: tenderTitle ?? null,
      agency: agency ?? null,
      tenderUrl: order.tender_url,
      intake: order.intake ?? {},
      stripeSessionId: order.stripe_session_id,
      output,
      pdfUrl,
      pdfPathname,
      uploadError,
      attempts,
      existingPackageId: existing?.id ?? null,
      generationStatus: "ready",
    });

    console.log("[proposal-v2:persisted]", { workOrderId, packageId });

    return {
      ok: true,
      packageId,
      attempts,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[proposal-v2:failed]", { workOrderId, error: errorMessage });
    try {
      await markFailure({
        workOrderId,
        userId: order.user_id,
        plan: PROPOSAL_PLAN,
        attempts,
        errorMessage,
        existingPackageId: existing?.id ?? null,
      });
    } catch (persistErr) {
      console.error("[proposal-v2:mark_failure_failed]", { workOrderId, err: persistErr });
    }
    return { ok: false, attempts, error: errorMessage };
  }
}
