import { sql } from "@/lib/db";
import { formatServiceContextForPrompt, formatServiceDocumentsForTenderText } from "@/lib/service-context";
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
  source_url: string | null;
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
      COALESCE(t.source_url, pi.source_url) AS source_url
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    WHERE pi.id = ${pipelineItemId}
    LIMIT 1
  ` as unknown as Array<PipelineRow>;
  return rows[0] ?? null;
}

const USER_REQUIREMENT_CONTEXT_KEYS: Array<{ key: string; label: string }> = [
  { key: "tender_context", label: "Tender context" },
  { key: "requirement_eligibility", label: "Eligibility / mandatory requirements" },
  { key: "requirement_scope", label: "Scope, deliverables, methodology requirements" },
  { key: "requirement_documents", label: "Required documents" },
  { key: "requirement_evaluation", label: "Evaluation / scoring criteria" },
  { key: "requirement_submission", label: "Submission instructions" },
  { key: "package_notes", label: "Package notes" },
  { key: "additional_details", label: "Additional details" },
];

function buildUserRequirementContext(intake: Record<string, unknown> | null): string {
  if (!intake) return "";
  const lines = USER_REQUIREMENT_CONTEXT_KEYS
    .map(({ key, label }) => {
      const value = intake[key];
      if (typeof value !== "string" || !value.trim()) return null;
      return `${label}:\n${value.trim()}`;
    })
    .filter((line): line is string => Boolean(line));
  if (!lines.length) return "";
  return `USER-PROVIDED TENDER / REQUIREMENT CONTEXT:\n${lines.join("\n\n")}`;
}

export function buildTenderText(order: WorkOrderRow, pipelineItem: PipelineRow | null): string {
  const uploadedDocumentText = formatServiceDocumentsForTenderText(order.intake);
  const userRequirementContext = buildUserRequirementContext(order.intake);
  if (pipelineItem) {
    return [
      `Title: ${pipelineItem.tender_title ?? order.tender_title ?? "Unknown"}`,
      (pipelineItem.tender_agency ?? order.agency) && `Agency: ${pipelineItem.tender_agency ?? order.agency}`,
      pipelineItem.source_name && `Source: ${pipelineItem.source_name}`,
      pipelineItem.source_url && `Source URL: ${pipelineItem.source_url}`,
      pipelineItem.opportunity_type && `Opportunity type: ${pipelineItem.opportunity_type}`,
      pipelineItem.sector && `Sector: ${pipelineItem.sector}`,
      pipelineItem.tender_value && `Estimated value: ${pipelineItem.tender_value}`,
      pipelineItem.tender_deadline && `Deadline: ${pipelineItem.tender_deadline}`,
      pipelineItem.t_description && `\nDescription:\n${pipelineItem.t_description}`,
      pipelineItem.eligibility_summary && `\nEligibility:\n${pipelineItem.eligibility_summary}`,
      userRequirementContext,
      uploadedDocumentText,
    ].filter(Boolean).join("\n");
  }
  return [
    order.tender_title && `Title: ${order.tender_title}`,
    order.agency && `Agency: ${order.agency}`,
    order.tender_url && `Source URL: ${order.tender_url}`,
    userRequirementContext,
    uploadedDocumentText,
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

const INTAKE_HIDDEN_KEYS = new Set([
  "service_context",
  "vault_url",
  "vault_filename",
  "vault_doc_id",
  "financial_documents_url",
  "financial_documents_filename",
]);

export function buildIntakeSummary(intake: Record<string, unknown> | null): string {
  if (!intake) return "";
  const serviceContext = formatServiceContextForPrompt(intake);
  const entries = Object.entries(intake).filter(([k]) => !INTAKE_HIDDEN_KEYS.has(k));
  const lines = entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (serviceContext) lines.unshift(serviceContext);
  if (intake.financial_documents_url) {
    lines.push(
      `financial_documents_provided: yes (${typeof intake.financial_documents_filename === "string" ? intake.financial_documents_filename : "uploaded"})`,
    );
  }
  return lines.join("\n");
}

export function generatedAtLabel(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
}
