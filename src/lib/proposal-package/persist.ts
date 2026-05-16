import { sql } from "@/lib/db";
import type { GateState, ProposalOutput, RosterOutput, TenderRequirements } from "./types";

export interface UpsertArgs {
  workOrderId: number;
  userId: number | null;
  pipelineItemId: number | null;
  plan: string;
  tenderTitle: string | null;
  agency: string | null;
  tenderUrl: string | null;
  intake: Record<string, unknown>;
  stripeSessionId: string | null;
  output: ProposalOutput | RosterOutput;
  pdfUrl: string | null;
  pdfPathname: string | null;
  /** Non-null when the Blob upload silently failed. Persisted to
   *  error_message so the failure is queryable from the DB even when
   *  Vercel runtime logs are paywalled. */
  uploadError: string | null;
  attempts: number;
  existingPackageId: number | null;
  /** Sprint 9: persist the extracted TenderRequirements with capability_match
   *  so subsequent runs and the harness can detect "TOR parsed = yes". */
  parsedRequirements?: TenderRequirements | null;
  /** Sprint 11: gate summary mirrored from output.gate_state for direct query. */
  gateState?: GateState | null;
  /** Sprint 11: generation_status to persist. Defaults to 'ready' when not supplied.
   *  Use 'needs_remediation' when the compliance gate is open. */
  generationStatus?: "ready" | "needs_remediation";
}

export async function upsertPackage(args: UpsertArgs): Promise<number> {
  const outputJson = JSON.stringify(args.output);
  const intakeJson = JSON.stringify(args.intake);
  const requirementsJson = args.parsedRequirements ? JSON.stringify(args.parsedRequirements) : null;
  const gateJson = args.gateState ? JSON.stringify(args.gateState) : null;
  const generationStatus = args.generationStatus ?? "ready";
  // When blob failed, preserve the diagnostic instead of clearing error_message.
  const errorMessage = args.pdfUrl == null && args.uploadError ? args.uploadError : null;
  if (args.existingPackageId != null) {
    const rows = await sql`
      UPDATE proposal_packages SET
        output = ${outputJson}::jsonb,
        pdf_url = COALESCE(${args.pdfUrl}, pdf_url),
        pdf_pathname = COALESCE(${args.pdfPathname}, pdf_pathname),
        generation_status = ${generationStatus},
        generation_attempts = ${args.attempts},
        error_message = ${errorMessage},
        tender_title = COALESCE(${args.tenderTitle}, tender_title),
        agency = COALESCE(${args.agency}, agency),
        tender_url = COALESCE(${args.tenderUrl}, tender_url),
        intake = ${intakeJson}::jsonb,
        parsed_requirements = COALESCE(${requirementsJson}::jsonb, parsed_requirements),
        gate_state = ${gateJson}::jsonb
      WHERE id = ${args.existingPackageId}
      RETURNING id
    ` as unknown as Array<{ id: number }>;
    return rows[0]?.id ?? args.existingPackageId;
  }
  if (args.userId == null) {
    throw new Error("Cannot create proposal_packages row without user_id");
  }
  const rows = await sql`
    INSERT INTO proposal_packages (
      user_id, work_order_id, pipeline_item_id, plan,
      tender_title, agency, tender_url, intake,
      stripe_session_id, output, pdf_url, pdf_pathname,
      generation_status, generation_attempts, error_message,
      parsed_requirements, gate_state
    ) VALUES (
      ${args.userId}, ${args.workOrderId}, ${args.pipelineItemId}, ${args.plan},
      ${args.tenderTitle}, ${args.agency}, ${args.tenderUrl}, ${intakeJson}::jsonb,
      ${args.stripeSessionId}, ${outputJson}::jsonb, ${args.pdfUrl}, ${args.pdfPathname},
      ${generationStatus}, ${args.attempts}, ${errorMessage},
      ${requirementsJson}::jsonb, ${gateJson}::jsonb
    )
    RETURNING id
  ` as unknown as Array<{ id: number }>;
  return rows[0]?.id ?? 0;
}

export interface FailureArgs {
  workOrderId: number;
  userId: number | null;
  plan: string;
  attempts: number;
  errorMessage: string;
  existingPackageId: number | null;
}

export async function markFailure(args: FailureArgs): Promise<void> {
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
      ${args.userId}, ${args.workOrderId}, ${args.plan},
      '{}'::jsonb, 'failed', ${args.attempts}, ${args.errorMessage}
    )
  `;
}
