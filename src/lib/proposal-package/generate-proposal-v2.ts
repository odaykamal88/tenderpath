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
} from "./context";
import { upsertPackage, markFailure } from "./persist";
import { extractRubricFromInput } from "./rubric-extractor";
import { runRevisionLoop, type RevisionAttemptSummary } from "./revision-loop";
import {
  buildTenderInputFromLegacy,
  buildApplicantContextFromAssessment,
} from "./legacy-bridge";

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

  const tenderInput = buildTenderInputFromLegacy(order, pipelineItem);
  const applicant = buildApplicantContextFromAssessment(assessment, order);

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
      pdfUrl: null, // Sprint 6c: wire renderScoredDraftPdf + bundle upload
      pdfPathname: null,
      uploadError: null,
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
