import { sql } from "@/lib/db";
import {
  ensureWorkOrderServiceContext,
  serviceContextFromIntake,
} from "@/lib/service-context";
import { buildProposalEvidenceProfile } from "@/lib/proposal-package/evidence";
import { buildProposalRequirementModel } from "@/lib/proposal-package/requirements-model";
import { DEFAULT_TENDER_REQUIREMENTS, PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
import {
  AGENCY_PACKAGES,
  findAgencyPackage,
  inferAgencySlug,
} from "@/lib/proposal-package/roster-packages";
import {
  buildIntakeSummary,
  buildTenderText,
  loadPipelineItem,
  loadWorkOrder,
  type WorkOrderRow,
} from "@/lib/proposal-package/context";

type JsonRecord = Record<string, unknown>;

export type FulfillmentMode = "self_serve" | "human_review" | "blocked";

export interface ServiceFulfillmentGate {
  plan: string;
  work_order_id: number | null;
  mode: FulfillmentMode;
  payment_allowed: boolean;
  auto_fulfill_allowed: boolean;
  score_0_10: number | null;
  missing_inputs: string[];
  warnings: string[];
  code: string | null;
  message: string;
  metadata: Record<string, string>;
}

const BID_PLAN = "bid-no-bid";
const GATED_ONE_TIME_PLANS = new Set([BID_PLAN, PROPOSAL_PLAN, ROSTER_PLAN]);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function clean(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asStringArray(value: unknown, maxItems = 8, maxLength = 180): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clean(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function blocked(plan: string, workOrderId: number | null, code: string, message: string, missing: string[] = []): ServiceFulfillmentGate {
  return {
    plan,
    work_order_id: workOrderId,
    mode: "blocked",
    payment_allowed: false,
    auto_fulfill_allowed: false,
    score_0_10: null,
    missing_inputs: missing,
    warnings: [],
    code,
    message,
    metadata: {
      fulfillment_mode: "blocked",
      readiness_code: code,
      readiness_message: message.slice(0, 400),
    },
  };
}

function planMatches(order: WorkOrderRow, plan: string): boolean {
  return order.plan === plan
    || order.service_slug === plan
    || (plan === PROPOSAL_PLAN && order.service_slug === "proposal")
    || (plan === ROSTER_PLAN && order.service_slug === "lta-roster");
}

function contextQuality(order: WorkOrderRow): JsonRecord | null {
  const context = serviceContextFromIntake(order.intake);
  return asRecord(asRecord(context)?.context_quality);
}

function contextMissing(order: WorkOrderRow): string[] {
  const context = serviceContextFromIntake(order.intake);
  return asStringArray(asRecord(context)?.missing_inputs, 10, 180);
}

function contextInputCoverage(order: WorkOrderRow): JsonRecord | null {
  const context = serviceContextFromIntake(order.intake);
  return asRecord(asRecord(context)?.input_coverage);
}

function contextTender(order: WorkOrderRow): JsonRecord | null {
  const context = serviceContextFromIntake(order.intake);
  return asRecord(asRecord(context)?.tender);
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === "true";
}

function metadataList(items: string[]): string {
  return items.slice(0, 8).join(" | ");
}

function requirementCategoryMissing(categories: string[]): string[] {
  return categories.map((category) => `${category} requirements or instructions`);
}

function pickAgency(order: WorkOrderRow): string | null {
  const intakeSlug = clean(order.intake?.agency_slug, 80);
  if (intakeSlug && findAgencyPackage(intakeSlug)) return intakeSlug;
  const targetAgency = clean(order.intake?.target_agency, 220);
  const inferredFromTarget = inferAgencySlug(targetAgency);
  if (inferredFromTarget) return inferredFromTarget;
  const inferredFromOrder = inferAgencySlug(order.agency);
  return inferredFromOrder;
}

async function proposalGate(order: WorkOrderRow): Promise<ServiceFulfillmentGate> {
  const pipeline = await loadPipelineItem(order.pipeline_item_id);
  const tenderText = buildTenderText(order, pipeline);
  const intakeSummary = buildIntakeSummary(order.intake);
  const profile = buildProposalEvidenceProfile({ tenderText, intakeSummary });
  const requirementModel = buildProposalRequirementModel({
    requirements: DEFAULT_TENDER_REQUIREMENTS,
    tenderText,
    evidenceProfile: profile,
  });
  const readinessScore = Math.min(profile.score_0_10, requirementModel.score_0_10);
  const missing = unique([
    ...profile.missing_inputs,
    ...requirementCategoryMissing(requirementModel.missing_categories),
    ...contextMissing(order),
  ]).slice(0, 12);
  const warnings = unique([
    ...profile.warnings,
    ...requirementModel.warnings,
  ]).slice(0, 8);

  if (profile.status === "blocked" || requirementModel.status === "blocked") {
    return {
      plan: PROPOSAL_PLAN,
      work_order_id: order.id,
      mode: "blocked",
      payment_allowed: false,
      auto_fulfill_allowed: false,
      score_0_10: readinessScore,
      missing_inputs: missing,
      warnings,
      code: "SOURCE_CONTEXT_REQUIRED",
      message: "Proposal Draft needs an extractable TOR/RFP with requirement-level coverage before checkout.",
      metadata: {
        fulfillment_mode: "blocked",
        readiness_code: "SOURCE_CONTEXT_REQUIRED",
        readiness_score: String(readinessScore),
        source_quality_score: String(profile.score_0_10),
        requirement_model_score: String(requirementModel.score_0_10),
        requirement_model_status: requirementModel.status,
        missing_requirement_categories: requirementModel.missing_categories.join(" | "),
      },
    };
  }

  if (profile.status === "needs_review" || requirementModel.status === "needs_review") {
    return {
      plan: PROPOSAL_PLAN,
      work_order_id: order.id,
      mode: "human_review",
      payment_allowed: true,
      auto_fulfill_allowed: false,
      score_0_10: readinessScore,
      missing_inputs: missing,
      warnings,
      code: "HUMAN_REVIEW_REQUIRED",
      message: "Payment can proceed, but this Proposal Draft should enter human QA because requirement coverage is incomplete.",
      metadata: {
        fulfillment_mode: "human_review",
        readiness_code: "HUMAN_REVIEW_REQUIRED",
        readiness_score: String(readinessScore),
        source_quality_score: String(profile.score_0_10),
        requirement_model_score: String(requirementModel.score_0_10),
        requirement_model_status: requirementModel.status,
        missing_inputs: missing.slice(0, 5).join(" | "),
      },
    };
  }

  return {
    plan: PROPOSAL_PLAN,
    work_order_id: order.id,
    mode: "self_serve",
    payment_allowed: true,
    auto_fulfill_allowed: true,
    score_0_10: readinessScore,
    missing_inputs: missing,
    warnings,
    code: null,
    message: "Proposal Draft source and requirement coverage are strong enough for automated fulfillment.",
    metadata: {
      fulfillment_mode: "self_serve",
      readiness_code: "READY",
      readiness_score: String(readinessScore),
      source_quality_score: String(profile.score_0_10),
      requirement_model_score: String(requirementModel.score_0_10),
      requirement_model_status: requirementModel.status,
    },
  };
}

function rosterGate(order: WorkOrderRow): ServiceFulfillmentGate {
  const agencySlug = pickAgency(order);
  const agency = findAgencyPackage(agencySlug);
  if (!agency) {
    const supported = AGENCY_PACKAGES.map((item) => item.label).join(", ");
    return {
      plan: ROSTER_PLAN,
      work_order_id: order.id,
      mode: "blocked",
      payment_allowed: false,
      auto_fulfill_allowed: false,
      score_0_10: null,
      missing_inputs: ["supported target agency or roster"],
      warnings: [],
      code: "SUPPORTED_AGENCY_REQUIRED",
      message: `Roster Fast-Track needs a supported target agency before checkout. Supported launch agencies: ${supported}.`,
      metadata: {
        fulfillment_mode: "blocked",
        readiness_code: "SUPPORTED_AGENCY_REQUIRED",
      },
    };
  }

  const quality = contextQuality(order);
  const score = typeof quality?.score_0_10 === "number" ? quality.score_0_10 : null;
  const missing = contextMissing(order);
  const status = clean(quality?.status, 40);
  const needsReview = status === "blocked" || (score != null && score < 7);

  if (needsReview) {
    return {
      plan: ROSTER_PLAN,
      work_order_id: order.id,
      mode: "human_review",
      payment_allowed: true,
      auto_fulfill_allowed: false,
      score_0_10: score,
      missing_inputs: missing,
      warnings: [`${agency.label} is supported, but the intake needs ops review before fulfillment.`],
      code: "ROSTER_REVIEW_REQUIRED",
      message: `${agency.label} is supported, but this roster order should enter human QA because the company/source context is incomplete.`,
      metadata: {
        fulfillment_mode: "human_review",
        readiness_code: "ROSTER_REVIEW_REQUIRED",
        readiness_score: score != null ? String(score) : "",
        agency_slug: agency.slug,
      },
    };
  }

  return {
    plan: ROSTER_PLAN,
    work_order_id: order.id,
    mode: "self_serve",
    payment_allowed: true,
    auto_fulfill_allowed: true,
    score_0_10: score,
    missing_inputs: missing,
    warnings: [],
    code: null,
    message: `${agency.label} roster context is strong enough for automated fulfillment.`,
    metadata: {
      fulfillment_mode: "self_serve",
      readiness_code: "READY",
      readiness_score: score != null ? String(score) : "",
      agency_slug: agency.slug,
    },
  };
}

function bidDecisionSurface(order: WorkOrderRow, missing: string[]) {
  const inputCoverage = contextInputCoverage(order);
  const tender = contextTender(order);
  const intake = order.intake ?? {};
  const hasUploadedTenderDocument = Boolean(
    clean(intake.vault_url, 1000)
      || clean(intake.vault_doc_id, 80)
      || (typeof intake.vault_doc_id === "number" && Number.isFinite(intake.vault_doc_id)),
  );
  const hasPipeline = Boolean(order.pipeline_item_id || truthyFlag(inputCoverage?.has_pipeline_item));
  const hasTenderSource = Boolean(
    clean(order.tender_url, 1000)
      || clean(tender?.source_url, 1000)
      || hasUploadedTenderDocument
      || truthyFlag(inputCoverage?.has_tender_source_context),
  );
  const hasRequirements = Boolean(
    truthyFlag(inputCoverage?.has_bid_requirements_context)
      || truthyFlag(inputCoverage?.has_extracted_document_text)
      || truthyFlag(inputCoverage?.has_pipeline_eligibility_summary)
      || clean(intake.tender_context, 80)
      || clean(intake.additional_details, 80),
  );
  const hasMatchEvidence = truthyFlag(inputCoverage?.has_match_reasons);
  const hasAssessment = truthyFlag(inputCoverage?.has_assessment);
  const hasDeadline = Boolean(clean(tender?.deadline, 80));
  const hasValue = Boolean(clean(tender?.value, 120));
  const tenderTypeText = [
    clean(tender?.title, 500),
    clean(tender?.opportunity_type, 80),
    clean(order.tender_title, 500),
    clean(intake.tender_context, 1000),
  ].filter(Boolean).join(" ");
  const hasTenderTypeCue = /\b(notice|rfp|request for proposals|rfq|request for quotation|itb|invitation to bid|eoi|expression of interest|tender|lta|framework|call)\b|\b\d{4,}\b/i.test(tenderTypeText);
  const components: string[] = [];
  const gaps: string[] = [];
  let score = 1.4;

  if (hasPipeline) {
    score += 1.2;
    components.push("selected dashboard tender");
  } else {
    gaps.push("selected dashboard pipeline item");
  }

  if (hasTenderSource) {
    score += 1.8;
    components.push("tender source or TOR carried into checkout");
  } else {
    gaps.push("primary tender source URL or uploaded TOR/RFP");
  }

  if (hasTenderTypeCue) {
    score += 0.8;
    components.push("tender type/source cue");
  } else {
    gaps.push("tender type or notice reference");
  }

  if (hasRequirements) {
    score += 2.2;
    components.push("eligibility/evaluation requirements available");
  } else {
    gaps.push("eligibility/evaluation criteria or TOR excerpt");
  }

  if (hasMatchEvidence) {
    score += 1.0;
    components.push("dashboard match reasons");
  } else {
    gaps.push("saved dashboard match reasons");
  }

  if (hasAssessment) {
    score += 0.9;
    components.push("company assessment profile");
  } else {
    gaps.push("linked company assessment profile");
  }

  if (hasDeadline) {
    score += 0.5;
    components.push("deadline context");
  } else {
    gaps.push("deadline");
  }

  if (hasValue) {
    score += 0.3;
    components.push("value/commercial context");
  }

  if (missing.includes("working source link")) {
    score = Math.min(score, 6.0);
    gaps.push("working source link");
  }
  if (!hasTenderSource) score = Math.min(score, 5.4);
  if (!hasPipeline) score = Math.min(score, 5.8);
  if (hasTenderSource && !hasRequirements) score = Math.min(score, 7.2);

  const finalScore = Math.max(0, Math.min(10, Math.round(score * 10) / 10));
  const status = finalScore >= 8.5
    ? "decision_surface_ready"
    : finalScore >= 7
      ? "usable_with_human_qa"
      : finalScore >= 5.8
        ? "needs_tender_source_or_human_review"
        : "blocked";

  return {
    score_0_10: finalScore,
    status,
    components: unique(components),
    gaps: unique(gaps),
  };
}

function bidNoBidGate(order: WorkOrderRow): ServiceFulfillmentGate {
  const missing = contextMissing(order);
  const quality = contextQuality(order);
  const contextScore = typeof quality?.score_0_10 === "number" ? quality.score_0_10 : null;
  const surface = bidDecisionSurface(order, missing);
  const score = surface.score_0_10;
  const hardMissing = surface.gaps.filter((item) =>
    item === "selected dashboard pipeline item" || item === "primary tender source URL or uploaded TOR/RFP",
  );
  const allMissing = unique([...hardMissing, ...surface.gaps, ...missing]).slice(0, 12);

  if (hardMissing.length > 0) {
    return {
      plan: BID_PLAN,
      work_order_id: order.id,
      mode: "blocked",
      payment_allowed: false,
      auto_fulfill_allowed: false,
      score_0_10: score,
      missing_inputs: allMissing,
      warnings: [],
      code: "BID_SOURCE_REQUIRED",
      message: "Bid/No-Bid needs a selected dashboard tender plus a source URL or uploaded TOR/RFP before checkout.",
      metadata: {
        fulfillment_mode: "blocked",
        readiness_code: "BID_SOURCE_REQUIRED",
        readiness_score: String(score),
        context_quality_score: contextScore != null ? String(contextScore) : "",
        bid_decision_surface_score: String(score),
        bid_decision_surface_status: surface.status,
        bid_decision_surface_components: metadataList(surface.components),
        bid_decision_surface_gaps: metadataList(allMissing),
      },
    };
  }

  if (surface.status !== "decision_surface_ready" || missing.length > 0) {
    return {
      plan: BID_PLAN,
      work_order_id: order.id,
      mode: "human_review",
      payment_allowed: true,
      auto_fulfill_allowed: false,
      score_0_10: score,
      missing_inputs: allMissing,
      warnings: ["Bid/No-Bid can proceed, but this memo should enter human QA until the tender criteria are fully grounded."],
      code: "BID_REVIEW_REQUIRED",
      message: "Payment can proceed, but this Bid/No-Bid memo should enter human QA because the decision surface is incomplete.",
      metadata: {
        fulfillment_mode: "human_review",
        readiness_code: "BID_REVIEW_REQUIRED",
        readiness_score: String(score),
        context_quality_score: contextScore != null ? String(contextScore) : "",
        bid_decision_surface_score: String(score),
        bid_decision_surface_status: surface.status,
        bid_decision_surface_components: metadataList(surface.components),
        bid_decision_surface_gaps: metadataList(allMissing),
      },
    };
  }

  return {
    plan: BID_PLAN,
    work_order_id: order.id,
    mode: "self_serve",
    payment_allowed: true,
    auto_fulfill_allowed: true,
    score_0_10: score,
    missing_inputs: missing,
    warnings: [],
    code: null,
    message: "Bid/No-Bid decision surface is strong enough for automated fulfillment.",
    metadata: {
      fulfillment_mode: "self_serve",
      readiness_code: "READY",
      readiness_score: String(score),
      context_quality_score: contextScore != null ? String(contextScore) : "",
      bid_decision_surface_score: String(score),
      bid_decision_surface_status: surface.status,
      bid_decision_surface_components: metadataList(surface.components),
    },
  };
}

export async function evaluateServiceFulfillmentGate(args: {
  plan: string;
  workOrderId?: number | null;
  ensureContext?: boolean;
}): Promise<ServiceFulfillmentGate> {
  const plan = args.plan;
  const workOrderId = args.workOrderId ?? null;

  if (!GATED_ONE_TIME_PLANS.has(plan)) {
    return {
      plan,
      work_order_id: workOrderId,
      mode: "self_serve",
      payment_allowed: true,
      auto_fulfill_allowed: false,
      score_0_10: null,
      missing_inputs: [],
      warnings: [],
      code: null,
      message: "This plan does not require a paid-service fulfillment gate.",
      metadata: { fulfillment_mode: "not_applicable", readiness_code: "NOT_APPLICABLE" },
    };
  }

  if (!workOrderId || !Number.isInteger(workOrderId) || workOrderId <= 0) {
    return blocked(plan, null, "SERVICE_INTAKE_REQUIRED", "Complete the service intake before checkout so TenderPath can preserve tender, document, and company context.", ["service intake work order"]);
  }

  let order = await loadWorkOrder(workOrderId);
  if (!order) {
    return blocked(plan, workOrderId, "WORK_ORDER_NOT_FOUND", "Work order not found. Return to the service intake and try again.");
  }

  if (!planMatches(order, plan)) {
    return blocked(plan, workOrderId, "PLAN_MISMATCH", "This checkout plan does not match the saved work order.");
  }

  if (args.ensureContext !== false && order.user_id) {
    await ensureWorkOrderServiceContext(order.id, order.user_id);
    order = await loadWorkOrder(workOrderId);
    if (!order) {
      return blocked(plan, workOrderId, "WORK_ORDER_NOT_FOUND", "Work order not found after refreshing context.");
    }
  }

  if (plan === PROPOSAL_PLAN) return proposalGate(order);
  if (plan === ROSTER_PLAN) return rosterGate(order);
  return bidNoBidGate(order);
}

export function fulfillmentGateNote(gate: ServiceFulfillmentGate): string {
  const missing = gate.missing_inputs.length ? ` Missing: ${gate.missing_inputs.slice(0, 5).join("; ")}.` : "";
  const score = gate.score_0_10 != null ? ` Score: ${gate.score_0_10}/10.` : "";
  return `${gate.message}${score}${missing}`;
}

export async function markWorkOrderForFulfillmentGate(
  workOrderId: number,
  gate: ServiceFulfillmentGate,
): Promise<void> {
  if (gate.mode === "self_serve") return;
  await sql`
    UPDATE work_orders
    SET status = ${gate.mode === "blocked" ? "waiting_on_client" : "in_progress"},
        fulfillment_notes = ${fulfillmentGateNote(gate)},
        updated_at = NOW()
    WHERE id = ${workOrderId}
  `;
}
