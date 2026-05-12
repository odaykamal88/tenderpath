import { put } from "@vercel/blob";
import { sql } from "@/lib/db";
import { sendBidNoBidReadyEmail } from "@/lib/email/sendBidNoBidNotification";
import { renderBidNoBidPdf } from "./pdfDoc";
import {
  extractTenderRequirements,
  generateBidNoBidAnalysis,
  type BidGenerationInputs,
} from "./llm";
import type { BidNoBidOutput } from "./types";

export const BID_PLAN = "bid-no-bid";
export const MAX_ATTEMPTS = 3; // 1 automatic + 2 user regenerations

export interface GenerateResult {
  ok: boolean;
  packageId?: number;
  output?: BidNoBidOutput;
  pdfUrl?: string | null;
  attempts: number;
  skippedReason?: "already_generated" | "not_paid" | "wrong_plan" | "max_attempts" | "work_order_missing";
  error?: string;
}

interface WorkOrderRow {
  id: number;
  user_id: number | null;
  email: string | null;
  plan: string;
  service_slug: string | null;
  payment_status: string | null;
  pipeline_item_id: number | null;
  tender_title: string | null;
  agency: string | null;
  tender_url: string | null;
  intake: Record<string, unknown> | null;
  stripe_session_id: string | null;
}

interface AssessmentRow {
  company_name: string | null;
  description: string | null;
  sector: string | null;
  countries: string[] | null;
  ai_analysis: Record<string, unknown> | null;
  readiness_score: number | null;
  gaps: unknown;
}

interface PipelineRow {
  id: number;
  tender_id: number | null;
  tender_title: string | null;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  manual_source_url: string | null;
  t_description: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  sector: string | null;
  eligibility_summary: string | null;
  t_source_url: string | null;
}

interface ExistingPackage {
  id: number;
  output: BidNoBidOutput | null;
  pdf_url: string | null;
  generation_attempts: number | null;
  generation_status: string | null;
}

async function loadWorkOrder(id: number): Promise<WorkOrderRow | null> {
  const rows = await sql`
    SELECT id, user_id, email, plan, service_slug, payment_status,
           pipeline_item_id, tender_title, agency, tender_url, intake, stripe_session_id
    FROM work_orders
    WHERE id = ${id}
    LIMIT 1
  ` as unknown as Array<WorkOrderRow>;
  return rows[0] ?? null;
}

async function loadExistingPackage(workOrderId: number): Promise<ExistingPackage | null> {
  const rows = await sql`
    SELECT id, output, pdf_url, generation_attempts, generation_status
    FROM proposal_packages
    WHERE work_order_id = ${workOrderId} AND plan = ${BID_PLAN}
    ORDER BY created_at DESC
    LIMIT 1
  ` as unknown as Array<ExistingPackage>;
  return rows[0] ?? null;
}

async function loadAssessmentForOrder(order: WorkOrderRow): Promise<AssessmentRow | null> {
  const email = order.email?.trim();
  if (!email) return null;
  const rows = await sql`
    SELECT company_name, description, sector, countries, ai_analysis, readiness_score, gaps
    FROM assessments
    WHERE email = ${email}
    ORDER BY created_at DESC
    LIMIT 1
  ` as unknown as Array<AssessmentRow>;
  return rows[0] ?? null;
}

async function loadPipelineItem(pipelineItemId: number | null): Promise<PipelineRow | null> {
  if (!pipelineItemId) return null;
  const rows = await sql`
    SELECT
      pi.id, pi.tender_id, pi.tender_title, pi.tender_agency,
      pi.tender_deadline, pi.tender_value, pi.source_url AS manual_source_url,
      t.description AS t_description,
      t.source_name,
      t.opportunity_type,
      t.sector,
      t.eligibility_summary,
      t.source_url AS t_source_url
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    WHERE pi.id = ${pipelineItemId}
    LIMIT 1
  ` as unknown as Array<PipelineRow>;
  return rows[0] ?? null;
}

function buildTenderText(order: WorkOrderRow, pipelineItem: PipelineRow | null): string {
  const intakeContext = order.intake?.tender_context;
  const torText = typeof intakeContext === "string" ? intakeContext : "";

  if (pipelineItem) {
    const sourceUrl = pipelineItem.t_source_url ?? pipelineItem.manual_source_url ?? order.tender_url;
    return [
      `Title: ${pipelineItem.tender_title ?? order.tender_title ?? "Unknown"}`,
      (pipelineItem.tender_agency ?? order.agency) && `Agency: ${pipelineItem.tender_agency ?? order.agency}`,
      pipelineItem.source_name && `Source: ${pipelineItem.source_name}`,
      sourceUrl && `Source URL: ${sourceUrl}`,
      pipelineItem.opportunity_type && `Opportunity type: ${pipelineItem.opportunity_type}`,
      pipelineItem.sector && `Sector: ${pipelineItem.sector}`,
      pipelineItem.tender_value && `Estimated value: ${pipelineItem.tender_value}`,
      pipelineItem.tender_deadline && `Deadline: ${pipelineItem.tender_deadline}`,
      pipelineItem.t_description && `\nDescription:\n${pipelineItem.t_description}`,
      pipelineItem.eligibility_summary && `\nEligibility:\n${pipelineItem.eligibility_summary}`,
      torText && `\nPasted requirements:\n${torText}`,
    ].filter(Boolean).join("\n");
  }

  return [
    order.tender_title && `Title: ${order.tender_title}`,
    order.agency && `Agency: ${order.agency}`,
    order.tender_url && `Source URL: ${order.tender_url}`,
    torText && `\nPasted requirements:\n${torText}`,
  ].filter(Boolean).join("\n") || "No tender details provided. The user supplied no tender URL, agency, title, or pasted terms of reference.";
}

function buildCompanyContext(assessment: AssessmentRow | null): string {
  if (!assessment) {
    return "No company profile found. Treat the vendor as a small SME with limited verifiable evidence; degrade confidence accordingly.";
  }
  const ai = assessment.ai_analysis ?? {};
  return [
    `Company: ${assessment.company_name ?? "(no name)"}`,
    `Description: ${assessment.description ?? "(no description)"}`,
    `Primary sector: ${assessment.sector ?? "(not specified)"}`,
    `Countries served: ${Array.isArray(assessment.countries) ? assessment.countries.join(", ") : "(none)"}`,
    `Readiness score: ${assessment.readiness_score ?? "(no score)"} / 100`,
    ai.capabilities ? `Capabilities: ${JSON.stringify(ai.capabilities)}` : "",
    ai.strengths ? `Strengths: ${JSON.stringify(ai.strengths)}` : "",
    ai.certifications_detected ? `Certifications: ${JSON.stringify(ai.certifications_detected)}` : "",
    assessment.gaps ? `Known gaps: ${JSON.stringify(assessment.gaps)}` : "",
  ].filter(Boolean).join("\n");
}

function buildIntakeSummary(intake: Record<string, unknown> | null): string {
  if (!intake) return "";
  const entries = Object.entries(intake)
    .filter(([k]) => !["vault_url", "vault_filename", "vault_doc_id"].includes(k));
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
}

async function uploadPdf(workOrderId: number, pdfBuffer: Buffer): Promise<{ url: string | null; pathname: string | null }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn("[bid-no-bid:blob_token_missing]", { workOrderId });
    return { url: null, pathname: null };
  }
  const pathname = `bid-no-bid/${workOrderId}-${Date.now()}.pdf`;
  try {
    const result = await put(pathname, pdfBuffer, {
      access: "public",
      contentType: "application/pdf",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { url: result.url, pathname: result.pathname };
  } catch (err) {
    console.error("[bid-no-bid:blob_upload_failed]", {
      workOrderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { url: null, pathname: null };
  }
}

export interface GenerateOptions {
  workOrderId: number;
  /**
   * When true, the caller has explicitly asked to regenerate even if a
   * package already exists. Subject to MAX_ATTEMPTS.
   */
  force?: boolean;
  /**
   * Skips the paid email after generation — used when generation is wired into
   * the Stripe paid-email flow to avoid double notifications.
   */
  silent?: boolean;
}

export async function generateBidNoBid({
  workOrderId,
  force = false,
  silent = false,
}: GenerateOptions): Promise<GenerateResult> {
  const order = await loadWorkOrder(workOrderId);
  if (!order) {
    return { ok: false, attempts: 0, skippedReason: "work_order_missing" };
  }
  if (order.plan !== BID_PLAN && order.service_slug !== BID_PLAN) {
    return { ok: false, attempts: 0, skippedReason: "wrong_plan" };
  }
  if (order.payment_status !== "paid") {
    return { ok: false, attempts: 0, skippedReason: "not_paid" };
  }

  const existing = await loadExistingPackage(workOrderId);
  const previousAttempts = existing?.generation_attempts ?? 0;

  if (existing && existing.generation_status === "ready" && !force) {
    return {
      ok: true,
      packageId: existing.id,
      output: existing.output ?? undefined,
      pdfUrl: existing.pdf_url,
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

  try {
    const requirements = await extractTenderRequirements(tenderText);
    const inputs: BidGenerationInputs = { tenderText, companyContext, intakeSummary };
    const output = await generateBidNoBidAnalysis(inputs, requirements);

    let pdfUrl: string | null = null;
    let pdfPathname: string | null = null;
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await renderBidNoBidPdf({
        workOrderId: order.id,
        companyName: assessment?.company_name ?? order.email ?? "Vendor",
        tenderTitle: pipelineItem?.tender_title ?? order.tender_title,
        agency: pipelineItem?.tender_agency ?? order.agency,
        output,
        generatedAt: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
      });
      const uploaded = await uploadPdf(order.id, pdfBuffer);
      pdfUrl = uploaded.url;
      pdfPathname = uploaded.pathname;
    } catch (err) {
      console.error("[bid-no-bid:pdf_render_failed]", {
        workOrderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Render failure means no buffer. We'll fail the package below so the
      // user sees an actionable Retry state and we never claim 'ready' without
      // a deliverable artifact.
    }

    // No artifact at all → don't store as 'ready'. This protects against the
    // historic silent-success state where status='ready' but pdf_url=null and
    // no email fired.
    if (!pdfBuffer) {
      await markFailure({
        workOrderId: order.id,
        userId: order.user_id,
        attempts,
        errorMessage: "PDF render failed; analysis text was generated but no deliverable was produced.",
        existingPackageId: existing?.id ?? null,
      }).catch(() => {});
      return {
        ok: false,
        attempts,
        error: "PDF render failed",
      };
    }

    const persisted = await upsertPackage({
      workOrderId: order.id,
      userId: order.user_id,
      pipelineItemId: order.pipeline_item_id,
      tenderTitle: pipelineItem?.tender_title ?? order.tender_title,
      agency: pipelineItem?.tender_agency ?? order.agency,
      tenderUrl: order.tender_url ?? pipelineItem?.t_source_url ?? null,
      intake: order.intake ?? {},
      stripeSessionId: order.stripe_session_id,
      output,
      pdfUrl,
      pdfPathname,
      attempts,
      existingPackageId: existing?.id ?? null,
    });

    if (!silent && order.email) {
      // We have the PDF buffer — send the email regardless of whether Blob
      // upload succeeded. If pdfUrl is null, the helper attaches the PDF.
      // MUST await: inside a Vercel after() callback the lambda terminates
      // when this function returns. A fire-and-forget promise gets its
      // in-flight HTTP call cancelled mid-flight and the email never sends.
      try {
        await sendBidNoBidReadyEmail({
          email: order.email,
          workOrderId: order.id,
          tenderTitle: pipelineItem?.tender_title ?? order.tender_title,
          agency: pipelineItem?.tender_agency ?? order.agency,
          recommendation: output.recommendation,
          winProbabilityBand: output.win_probability_band,
          pdfUrl,
          pdfBuffer: pdfUrl ? null : pdfBuffer,
        });
      } catch (err) {
        console.error("[bid-no-bid:email_failed]", {
          workOrderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: true,
      packageId: persisted,
      output,
      pdfUrl,
      attempts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown bid-no-bid generation error";
    console.error("[bid-no-bid:generation_failed]", { workOrderId: order.id, error: message, attempts });

    await markFailure({
      workOrderId: order.id,
      userId: order.user_id,
      attempts,
      errorMessage: message,
      existingPackageId: existing?.id ?? null,
    }).catch(() => {});

    return { ok: false, attempts, error: message };
  }
}

interface UpsertArgs {
  workOrderId: number;
  userId: number | null;
  pipelineItemId: number | null;
  tenderTitle: string | null;
  agency: string | null;
  tenderUrl: string | null;
  intake: Record<string, unknown>;
  stripeSessionId: string | null;
  output: BidNoBidOutput;
  pdfUrl: string | null;
  pdfPathname: string | null;
  attempts: number;
  existingPackageId: number | null;
}

async function upsertPackage(args: UpsertArgs): Promise<number> {
  const outputJson = JSON.stringify(args.output);
  const intakeJson = JSON.stringify(args.intake);
  if (args.existingPackageId != null) {
    const rows = await sql`
      UPDATE proposal_packages SET
        output = ${outputJson}::jsonb,
        pdf_url = COALESCE(${args.pdfUrl}, pdf_url),
        pdf_pathname = COALESCE(${args.pdfPathname}, pdf_pathname),
        generation_status = 'ready',
        generation_attempts = ${args.attempts},
        error_message = NULL,
        tender_title = COALESCE(${args.tenderTitle}, tender_title),
        agency = COALESCE(${args.agency}, agency),
        tender_url = COALESCE(${args.tenderUrl}, tender_url),
        intake = ${intakeJson}::jsonb
      WHERE id = ${args.existingPackageId}
      RETURNING id
    ` as unknown as Array<{ id: number }>;
    return rows[0]?.id ?? args.existingPackageId;
  }

  // Insert path; user_id is non-null in schema, so skip when missing.
  if (args.userId == null) {
    throw new Error("Cannot create proposal_packages row without user_id");
  }
  const rows = await sql`
    INSERT INTO proposal_packages (
      user_id, work_order_id, pipeline_item_id, plan,
      tender_title, agency, tender_url, intake,
      stripe_session_id, output, pdf_url, pdf_pathname,
      generation_status, generation_attempts
    ) VALUES (
      ${args.userId}, ${args.workOrderId}, ${args.pipelineItemId}, ${BID_PLAN},
      ${args.tenderTitle}, ${args.agency}, ${args.tenderUrl}, ${intakeJson}::jsonb,
      ${args.stripeSessionId}, ${outputJson}::jsonb, ${args.pdfUrl}, ${args.pdfPathname},
      'ready', ${args.attempts}
    )
    RETURNING id
  ` as unknown as Array<{ id: number }>;
  return rows[0]?.id ?? 0;
}

interface FailureArgs {
  workOrderId: number;
  userId: number | null;
  attempts: number;
  errorMessage: string;
  existingPackageId: number | null;
}

async function markFailure(args: FailureArgs): Promise<void> {
  if (args.existingPackageId != null) {
    await sql`
      UPDATE proposal_packages SET
        generation_status = 'failed',
        generation_attempts = ${args.attempts},
        error_message = ${args.errorMessage}
      WHERE id = ${args.existingPackageId}
    `;
    return;
  }
  if (args.userId == null) return;
  await sql`
    INSERT INTO proposal_packages (
      user_id, work_order_id, plan,
      output, generation_status, generation_attempts, error_message
    ) VALUES (
      ${args.userId}, ${args.workOrderId}, ${BID_PLAN},
      '{}'::jsonb, 'failed', ${args.attempts}, ${args.errorMessage}
    )
  `;
}
