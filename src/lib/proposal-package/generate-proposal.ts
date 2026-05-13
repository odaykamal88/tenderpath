import { sendProposalReadyEmail } from "@/lib/email/sendProposalPackageNotification";
import { track } from "@/lib/telemetry/funnel";
import {
  PROPOSAL_PLAN,
  MAX_ATTEMPTS,
  type ProposalOutput,
} from "./types";
import { extractTenderRequirements, generateProposalDraft } from "./llm";
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
  if (force && previousAttempts >= MAX_ATTEMPTS) {
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
    const requirements = await extractTenderRequirements(tenderText);
    const output = await generateProposalDraft(
      { tenderText, companyContext, intakeSummary },
      requirements,
    );

    let zipUrl: string | null = null;
    let zipPathname: string | null = null;
    let zipUploadError: string | null = null;
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
    });

    if (!silent && order.email && zipUrl) {
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

    await track(
      "deliverable_ready",
      {
        plan: PROPOSAL_PLAN,
        work_order_id: order.id,
        package_id: persisted,
        attempts,
        has_zip_url: Boolean(zipUrl),
      },
      { userId: order.user_id ?? null },
    );

    return { ok: true, packageId: persisted, output, zipUrl, attempts };
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
