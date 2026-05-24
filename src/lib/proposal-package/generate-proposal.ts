import { sendProposalReadyEmail } from "@/lib/email/sendProposalPackageNotification";
import { track } from "@/lib/telemetry/funnel";
import {
  PROPOSAL_PLAN,
  PROPOSAL_MAX_ATTEMPTS,
  type GateState,
  type ProposalOutput,
} from "./types";
import { extractTenderRequirements, generateProposalDraft } from "./llm";
import { buildProposalEvidenceProfile } from "./evidence";
import { loadEvidenceLibrary, formatEvidenceLibraryForPrompt } from "@/lib/applicant-evidence/query";
import { summariseComplianceGate, isBlocked, withGateState } from "./gate";
import { sweepCoverLetterPlaceholders } from "./sweep";
import { renderProposalDocx, renderCoverLetterDocx } from "./docx";
import { renderFinancialTemplateXlsx } from "./xlsx";
import { renderComplianceMatrixPdf } from "./pdfDocs";
import { bundleAndUpload, safeFilenameStem } from "./bundle";
import { upsertPackage, markFailure } from "./persist";
import {
  loadWorkOrder,
  loadExistingPackage,
  loadAssessmentForOrder,
  loadPipelineItem,
  buildTenderText,
  buildCompanyContext,
  buildIntakeSummary,
  generatedAtLabel,
} from "./context";

export interface GenerateProposalResult {
  ok: boolean;
  packageId?: number;
  output?: ProposalOutput;
  zipUrl?: string | null;
  attempts: number;
  skippedReason?: "already_generated" | "not_paid" | "wrong_plan" | "max_attempts" | "work_order_missing";
  error?: string;
  /** Sprint 11. True when the compliance gate held the bundle. */
  blocked?: boolean;
  /** Sprint 11. Snapshot of gate state for the caller (API/dashboard). */
  gateState?: GateState;
}

export interface GenerateProposalOptions {
  workOrderId: number;
  force?: boolean;
  silent?: boolean;
}

export async function generateProposalPackage({
  workOrderId,
  force = false,
  silent = false,
}: GenerateProposalOptions): Promise<GenerateProposalResult> {
  const order = await loadWorkOrder(workOrderId);
  if (!order) return { ok: false, attempts: 0, skippedReason: "work_order_missing" };
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
      output: (existing.output ?? undefined) as ProposalOutput | undefined,
      zipUrl: existing.pdf_url,
      attempts: previousAttempts,
      skippedReason: "already_generated",
    };
  }
  if (force && previousAttempts >= PROPOSAL_MAX_ATTEMPTS) {
    return { ok: false, attempts: previousAttempts, skippedReason: "max_attempts" };
  }

  const attempts = previousAttempts + 1;
  const assessment = await loadAssessmentForOrder(order);
  const pipelineItem = await loadPipelineItem(order.pipeline_item_id);
  const tenderText = buildTenderText(order, pipelineItem);
  const companyContext = buildCompanyContext(assessment);
  const intakeSummary = buildIntakeSummary(order.intake);
  const generatedAt = generatedAtLabel();
  const companyName = assessment?.company_name ?? order.email ?? "Vendor";
  const tenderTitle = pipelineItem?.tender_title ?? order.tender_title;
  const agency = pipelineItem?.tender_agency ?? order.agency;

  try {
    const evidenceProfile = buildProposalEvidenceProfile({ tenderText, intakeSummary });
    // Sprint 10: load the applicant's persistent evidence library so the
    // extractor can mark requirements "evidenced" only when a real file
    // backs them. Empty for anonymous/email-only flows (no user_id).
    const evidenceLibrary = order.user_id != null
      ? await loadEvidenceLibrary(order.user_id).catch((err) => {
          console.warn("[proposal-draft:evidence_library_load_failed]", {
            workOrderId: order.id,
            userId: order.user_id,
            error: err instanceof Error ? err.message : String(err),
          });
          return [];
        })
      : [];
    const evidenceLibrarySummary = formatEvidenceLibraryForPrompt(evidenceLibrary);
    // Sprint 9: pass companyContext so the extractor cross-checks each
    // high-leverage requirement against the profile (capability_match field).
    const requirements = await extractTenderRequirements(
      { tenderText, companyContext, evidenceLibrarySummary },
      evidenceProfile,
    );
    const rawOutput = await generateProposalDraft(
      { tenderText, companyContext, intakeSummary },
      requirements,
      evidenceProfile,
    );

    // Sprint 13b: deterministic post-generation sweep. The prompt forbids
    // bracketed placeholders in the cover letter but the model still emits
    // them on real runs. We strip the placeholder text (keeping [DATE]
    // intact) and append a single composite item to missing_information so
    // the dashboard remediation surface shows the applicant exactly what
    // to provide before submission.
    const { output: sweptOutput, sweep } = sweepCoverLetterPlaceholders(rawOutput);
    if (sweep.count > 0) {
      console.info("[proposal-draft:cover_letter_sweep]", {
        workOrderId: order.id,
        placeholdersFound: sweep.count,
        placeholders: sweep.placeholders.slice(0, 10),
      });
    }

    // Sprint 11: compute the compliance gate. If any compliance_checklist
    // item is mandatory + needs_action, we hold the bundle. The output is
    // still persisted so the dashboard can render the remediation panel
    // and the applicant can resolve the gates and regenerate.
    const gate = summariseComplianceGate(sweptOutput);
    const output = withGateState(sweptOutput, gate);
    const blocked = isBlocked(gate);

    let zipUrl: string | null = null;
    let zipPathname: string | null = null;
    let zipUploadError: string | null = null;
    if (!blocked) {
      try {
        const docCtx = { companyName, tenderTitle, agency, generatedAt };
        const [proposalDoc, coverLetterDoc, financialXlsx, complianceMatrixPdf] = await Promise.all([
          renderProposalDocx(output, docCtx),
          renderCoverLetterDocx(output.cover_letter_draft, docCtx),
          renderFinancialTemplateXlsx(output, docCtx),
          renderComplianceMatrixPdf(output, docCtx, order.id),
        ]);
        const stem = safeFilenameStem(tenderTitle, `proposal-${order.id}`);
        const uploaded = await bundleAndUpload(
          [
            { filename: `${stem}-technical-proposal.docx`, content: proposalDoc },
            { filename: `${stem}-cover-letter.docx`, content: coverLetterDoc },
            { filename: `${stem}-financial-template.xlsx`, content: financialXlsx },
            { filename: `${stem}-compliance-matrix.pdf`, content: complianceMatrixPdf },
          ],
          `proposal-draft/${order.id}-${Date.now()}.zip`,
        );
        zipUrl = uploaded.url;
        zipPathname = uploaded.pathname;
        zipUploadError = uploaded.error;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[proposal-draft:bundle_failed]", {
          workOrderId: order.id,
          error: msg,
        });
        // Bundle failure does not block analysis storage — dashboard still
        // renders the JSON view. Persist the diagnostic so the failure is
        // queryable from the DB without depending on Vercel runtime logs.
        zipUploadError = `bundle_failed: ${msg}`;
      }
    } else {
      console.info("[proposal-draft:gate_blocked]", {
        workOrderId: order.id,
        mandatoryGaps: gate.mandatory_gaps,
        recommendedGaps: gate.recommended_gaps,
      });
    }

    const persisted = await upsertPackage({
      workOrderId: order.id,
      userId: order.user_id,
      pipelineItemId: order.pipeline_item_id,
      plan: PROPOSAL_PLAN,
      tenderTitle,
      agency,
      tenderUrl: order.tender_url ?? pipelineItem?.t_source_url ?? null,
      intake: order.intake ?? {},
      stripeSessionId: order.stripe_session_id,
      output,
      pdfUrl: zipUrl,
      pdfPathname: zipPathname,
      uploadError: zipUploadError,
      attempts,
      existingPackageId: existing?.id ?? null,
      parsedRequirements: requirements,
      gateState: gate,
      generationStatus: blocked ? "needs_remediation" : "ready",
    });

    if (!silent && order.email && zipUrl && !blocked) {
      // MUST await inside Vercel after() — see bid-no-bid generate.ts for
      // detailed explanation. Fire-and-forget inside after() = lambda kills
      // the in-flight Resend HTTP call and the email never sends.
      try {
        await sendProposalReadyEmail({
          email: order.email,
          workOrderId: order.id,
          tenderTitle,
          agency,
          zipUrl,
        });
      } catch (err) {
        console.error("[proposal-draft:email_failed]", {
          workOrderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // When blocked, we deliberately do not send the "ready" email. The
    // dashboard surfaces the remediation panel; once the applicant
    // resolves the gates and regenerates, the standard email path fires.

    await track(
      blocked ? "deliverable_blocked" : "deliverable_ready",
      {
        plan: PROPOSAL_PLAN,
        work_order_id: order.id,
        package_id: persisted,
        attempts,
        has_zip_url: Boolean(zipUrl),
        mandatory_gaps: gate.mandatory_gaps,
        recommended_gaps: gate.recommended_gaps,
      },
      { userId: order.user_id ?? null },
    );

    return { ok: true, packageId: persisted, output, zipUrl, attempts, blocked, gateState: gate };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown proposal generation error";
    console.error("[proposal-draft:generation_failed]", { workOrderId: order.id, error: message, attempts });
    await markFailure({
      workOrderId: order.id,
      userId: order.user_id,
      plan: PROPOSAL_PLAN,
      attempts,
      errorMessage: message,
      existingPackageId: existing?.id ?? null,
    }).catch(() => {});
    return { ok: false, attempts, error: message };
  }
}
