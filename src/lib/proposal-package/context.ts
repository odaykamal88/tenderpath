import { sql } from "@/lib/db";
import type { ProposalOutput, RosterOutput } from "./types";

export interface WorkOrderRow {
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

export interface AssessmentRow {
  company_name: string | null;
  description: string | null;
  sector: string | null;
  countries: string[] | null;
  ai_analysis: Record<string, unknown> | null;
  readiness_score: number | null;
  gaps: unknown;
}

export interface PipelineRow {
  id: number;
  tender_id: number | null;
  tender_title: string | null;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  t_description: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  sector: string | null;
  eligibility_summary: string | null;
  t_source_url: string | null;
}

export interface ExistingPackage {
  id: number;
  output: ProposalOutput | RosterOutput | null;
  pdf_url: string | null;
  pdf_pathname: string | null;
  generation_attempts: number | null;
  generation_status: string | null;
}

export async function loadWorkOrder(id: number): Promise<WorkOrderRow | null> {
  const rows = await sql`
    SELECT id, user_id, email, plan, service_slug, payment_status,
           pipeline_item_id, tender_title, agency, tender_url, intake, stripe_session_id
    FROM work_orders
    WHERE id = ${id}
    LIMIT 1
  ` as unknown as Array<WorkOrderRow>;
  return rows[0] ?? null;
}

export async function loadExistingPackage(
  workOrderId: number,
  plan: string,
): Promise<ExistingPackage | null> {
  const rows = await sql`
    SELECT id, output, pdf_url, pdf_pathname, generation_attempts, generation_status
    FROM proposal_packages
    WHERE work_order_id = ${workOrderId} AND plan = ${plan}
    ORDER BY created_at DESC
    LIMIT 1
  ` as unknown as Array<ExistingPackage>;
  return rows[0] ?? null;
}

export async function loadAssessmentForOrder(order: WorkOrderRow): Promise<AssessmentRow | null> {
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

export async function loadPipelineItem(pipelineItemId: number | null): Promise<PipelineRow | null> {
  if (!pipelineItemId) return null;
  const rows = await sql`
    SELECT
      pi.id, pi.tender_id, pi.tender_title, pi.tender_agency,
      pi.tender_deadline, pi.tender_value,
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

export function buildTenderText(order: WorkOrderRow, pipelineItem: PipelineRow | null): string {
  if (pipelineItem) {
    return [
      `Title: ${pipelineItem.tender_title ?? order.tender_title ?? "Unknown"}`,
      (pipelineItem.tender_agency ?? order.agency) && `Agency: ${pipelineItem.tender_agency ?? order.agency}`,
      pipelineItem.source_name && `Source: ${pipelineItem.source_name}`,
      pipelineItem.opportunity_type && `Opportunity type: ${pipelineItem.opportunity_type}`,
      pipelineItem.sector && `Sector: ${pipelineItem.sector}`,
      pipelineItem.tender_value && `Estimated value: ${pipelineItem.tender_value}`,
      pipelineItem.tender_deadline && `Deadline: ${pipelineItem.tender_deadline}`,
      pipelineItem.t_description && `\nDescription:\n${pipelineItem.t_description}`,
      pipelineItem.eligibility_summary && `\nEligibility:\n${pipelineItem.eligibility_summary}`,
    ].filter(Boolean).join("\n");
  }
  const intakeContext = order.intake?.tender_context ?? order.intake?.package_notes;
  const torText = typeof intakeContext === "string" ? intakeContext : "";
  return [
    order.tender_title && `Title: ${order.tender_title}`,
    order.agency && `Agency: ${order.agency}`,
    order.tender_url && `Source URL: ${order.tender_url}`,
    torText && `\nProvided context:\n${torText}`,
  ].filter(Boolean).join("\n") || "No tender details provided. The user supplied no tender URL, agency, title, or pasted terms of reference.";
}

export function buildCompanyContext(assessment: AssessmentRow | null): string {
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

export function buildIntakeSummary(intake: Record<string, unknown> | null): string {
  if (!intake) return "";
  const entries = Object.entries(intake)
    .filter(([k]) => !["vault_url", "vault_filename", "vault_doc_id"].includes(k));
  return entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n");
}

export function generatedAtLabel(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
}
