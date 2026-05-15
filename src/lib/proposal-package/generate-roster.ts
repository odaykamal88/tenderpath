import { sendRosterReadyEmail } from "@/lib/email/sendProposalPackageNotification";
import { track } from "@/lib/telemetry/funnel";
import {
  ROSTER_PLAN,
  MAX_ATTEMPTS,
  type RosterOutput,
} from "./types";
import { extractTenderRequirements, generateRosterPackage } from "./llm";
import { renderCoverLetterDocx, renderCapabilityStatementDocx } from "./docx";
import { renderSubmissionInstructionsPdf } from "./pdfDocs";
import { bundleAndUpload, safeFilenameStem } from "./bundle";
import { upsertPackage, markFailure } from "./persist";
import {
  AGENCY_PACKAGES,
  findAgencyPackage,
  inferAgencySlug,
  type AgencyPackage,
} from "./roster-packages";
import {
  loadWorkOrder,
  loadExistingPackage,
  loadAssessmentForOrder,
  loadPipelineItem,
  buildTenderText,
  buildCompanyContext,
  buildIntakeSummary,
  generatedAtLabel,
  type WorkOrderRow,
} from "./context";

export interface GenerateRosterResult {
  ok: boolean;
  packageId?: number;
  output?: RosterOutput;
  zipUrl?: string | null;
  agency?: AgencyPackage;
  attempts: number;
  skippedReason?: "already_generated" | "not_paid" | "wrong_plan" | "max_attempts" | "work_order_missing" | "no_agency";
  error?: string;
}

export interface GenerateRosterOptions {
  workOrderId: number;
  force?: boolean;
  silent?: boolean;
}

function pickAgency(order: WorkOrderRow): AgencyPackage | null {
  const intakeSlug = typeof order.intake?.agency_slug === "string" ? order.intake.agency_slug : null;
  if (intakeSlug) {
    const a = findAgencyPackage(intakeSlug);
    if (a) return a;
  }
  const targetAgency = typeof order.intake?.target_agency === "string" ? order.intake.target_agency : null;
  const inferred = inferAgencySlug(targetAgency);
  if (inferred) {
    const a = findAgencyPackage(inferred);
    if (a) return a;
  }
  const fromOrderAgency = inferAgencySlug(order.agency);
  if (fromOrderAgency) {
    const a = findAgencyPackage(fromOrderAgency);
    if (a) return a;
  }
  return null;
}

export async function generateRosterFastTrack({
  workOrderId,
  force = false,
  silent = false,
}: GenerateRosterOptions): Promise<GenerateRosterResult> {
  const order = await loadWorkOrder(workOrderId);
  if (!order) return { ok: false, attempts: 0, skippedReason: "work_order_missing" };
  if (order.plan !== ROSTER_PLAN && order.service_slug !== ROSTER_PLAN) {
    return { ok: false, attempts: 0, skippedReason: "wrong_plan" };
  }
  if (order.payment_status !== "paid") {
    return { ok: false, attempts: 0, skippedReason: "not_paid" };
  }

  const agency = pickAgency(order);
  if (!agency) {
    // Mark a failure row with a specific message so the dashboard panel can
    // prompt the user to choose an agency from the launch list.
    const existing = await loadExistingPackage(workOrderId, ROSTER_PLAN);
    await markFailure({
      workOrderId,
      userId: order.user_id,
      plan: ROSTER_PLAN,
      attempts: (existing?.generation_attempts ?? 0) + 1,
      errorMessage: `Could not match the target agency to a supported package. Choose one of: ${AGENCY_PACKAGES.map((a) => a.label).join(", ")}.`,
      existingPackageId: existing?.id ?? null,
    }).catch(() => {});
    return { ok: false, attempts: 0, skippedReason: "no_agency" };
  }

  const existing = await loadExistingPackage(workOrderId, ROSTER_PLAN);
  const previousAttempts = existing?.generation_attempts ?? 0;

  if (existing && existing.generation_status === "ready" && !force) {
    return {
      ok: true,
      packageId: existing.id,
      output: (existing.output ?? undefined) as RosterOutput | undefined,
      zipUrl: existing.pdf_url,
      agency,
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
  const rosterAgencyContext = [
    `Target agency: ${agency.label}`,
    `Portal: ${agency.portalLabel} (${agency.portalUrl})`,
    `Why register: ${agency.why}`,
    `Registration steps: ${agency.submissionSteps.join(" | ")}`,
    `Required documents: ${agency.requiredDocuments.join("; ")}`,
    `Agency notes: ${agency.notes.join(" | ")}`,
    `Suggested categories: ${agency.categoryHints.join("; ")}`,
    agency.categoryGuardrails?.length ? `Category guardrails: ${agency.categoryGuardrails.join(" | ")}` : null,
  ].filter(Boolean).join("\n");
  const generatedAt = generatedAtLabel();
  const companyName = assessment?.company_name ?? order.email ?? "Vendor";

  try {
    const requirements = await extractTenderRequirements(tenderText);
    const output = await generateRosterPackage(
      { tenderText, companyContext, intakeSummary, rosterAgencyContext },
      requirements,
    );

    let zipUrl: string | null = null;
    let zipPathname: string | null = null;
    let zipUploadError: string | null = null;
    try {
      const docCtx = { companyName, tenderTitle: agency.label, agency: agency.label, generatedAt };
      const [capabilityDoc, coverLetterDoc, instructionsPdf] = await Promise.all([
        renderCapabilityStatementDocx(output, docCtx, agency.label),
        renderCoverLetterDocx(output.cover_letter_draft, docCtx),
        renderSubmissionInstructionsPdf(output, docCtx, order.id, agency),
      ]);
      const stem = safeFilenameStem(`${agency.label}-roster-${companyName}`, `roster-${order.id}`);
      const uploaded = await bundleAndUpload(
        [
          { filename: `${stem}-capability-statement.docx`, content: capabilityDoc },
          { filename: `${stem}-cover-letter.docx`, content: coverLetterDoc },
          { filename: `${stem}-submission-instructions.pdf`, content: instructionsPdf },
        ],
        `roster-fast-track/${order.id}-${Date.now()}.zip`,
      );
      zipUrl = uploaded.url;
      zipPathname = uploaded.pathname;
      zipUploadError = uploaded.error;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[roster-fast-track:bundle_failed]", {
        workOrderId: order.id,
        error: msg,
      });
      zipUploadError = `bundle_failed: ${msg}`;
    }

    const persisted = await upsertPackage({
      workOrderId: order.id,
      userId: order.user_id,
      pipelineItemId: order.pipeline_item_id,
      plan: ROSTER_PLAN,
      tenderTitle: agency.label,
      agency: agency.label,
      tenderUrl: agency.portalUrl,
      intake: { ...(order.intake ?? {}), agency_slug: agency.slug },
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
        await sendRosterReadyEmail({
          email: order.email,
          workOrderId: order.id,
          agencyLabel: agency.label,
          portalUrl: agency.portalUrl,
          zipUrl,
        });
      } catch (err) {
        console.error("[roster-fast-track:email_failed]", {
          workOrderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await track(
      "deliverable_ready",
      {
        plan: ROSTER_PLAN,
        work_order_id: order.id,
        package_id: persisted,
        attempts,
        has_zip_url: Boolean(zipUrl),
        agency_slug: agency.slug,
      },
      { userId: order.user_id ?? null },
    );

    return { ok: true, packageId: persisted, output, zipUrl, agency, attempts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown roster generation error";
    console.error("[roster-fast-track:generation_failed]", { workOrderId: order.id, error: message, attempts });
    await markFailure({
      workOrderId: order.id,
      userId: order.user_id,
      plan: ROSTER_PLAN,
      attempts,
      errorMessage: message,
      existingPackageId: existing?.id ?? null,
    }).catch(() => {});
    return { ok: false, attempts, error: message };
  }
}
