import { sql } from "@/lib/db";
import {
  ensureWorkOrderServiceContext,
  serviceContextFromIntake,
} from "@/lib/service-context";
import { buildProposalEvidenceProfile } from "@/lib/proposal-package/evidence";
import { PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
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
  const missing = unique([
    ...profile.missing_inputs,
    ...contextMissing(order),
  ]).slice(0, 12);
  const warnings = profile.warnings.slice(0, 8);

  if (profile.status === "blocked") {
    return {
      plan: PROPOSAL_PLAN,
      work_order_id: order.id,
      mode: "blocked",
      payment_allowed: false,
      auto_fulfill_allowed: false,
      score_0_10: profile.score_0_10,
      missing_inputs: missing,
      warnings,
      code: "SOURCE_CONTEXT_REQUIRED",
      message: "Proposal Draft needs an extractable TOR/RFP or pasted scope, required documents, evaluation criteria, and submission instructions before checkout.",
      metadata: {
        fulfillment_mode: "blocked",
        readiness_code: "SOURCE_CONTEXT_REQUIRED",
        readiness_score: String(profile.score_0_10),
      },
    };
  }

  if (profile.status === "needs_review") {
    return {
      plan: PROPOSAL_PLAN,
      work_order_id: order.id,
      mode: "human_review",
      payment_allowed: true,
      auto_fulfill_allowed: false,
      score_0_10: profile.score_0_10,
      missing_inputs: missing,
      warnings,
      code: "HUMAN_REVIEW_REQUIRED",
      message: "Payment can proceed, but this Proposal Draft should enter human QA because source coverage is incomplete.",
      metadata: {
        fulfillment_mode: "human_review",
        readiness_code: "HUMAN_REVIEW_REQUIRED",
        readiness_score: String(profile.score_0_10),
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
    score_0_10: profile.score_0_10,
    missing_inputs: missing,
    warnings,
    code: null,
    message: "Proposal Draft source coverage is strong enough for automated fulfillment.",
    metadata: {
      fulfillment_mode: "self_serve",
      readiness_code: "READY",
      readiness_score: String(profile.score_0_10),
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

function bidNoBidGate(order: WorkOrderRow): ServiceFulfillmentGate {
  const missing = contextMissing(order);
  const quality = contextQuality(order);
  const score = typeof quality?.score_0_10 === "number" ? quality.score_0_10 : null;
  const hasPipeline = Boolean(order.pipeline_item_id);
  const hasSource = Boolean(clean(order.tender_url, 1000) || !missing.includes("primary tender or roster source URL"));

  if (!hasPipeline || !hasSource) {
    return {
      plan: BID_PLAN,
      work_order_id: order.id,
      mode: "human_review",
      payment_allowed: true,
      auto_fulfill_allowed: false,
      score_0_10: score,
      missing_inputs: unique([
        ...(!hasPipeline ? ["selected dashboard pipeline item"] : []),
        ...(!hasSource ? ["primary tender source URL"] : []),
        ...missing,
      ]),
      warnings: ["Bid/No-Bid can be paid, but automated fulfillment needs a selected tender and source context."],
      code: "BID_REVIEW_REQUIRED",
      message: "Payment can proceed, but this Bid/No-Bid memo should enter human QA because selected tender/source context is incomplete.",
      metadata: {
        fulfillment_mode: "human_review",
        readiness_code: "BID_REVIEW_REQUIRED",
        readiness_score: score != null ? String(score) : "",
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
    message: "Bid/No-Bid context is strong enough for automated fulfillment.",
    metadata: {
      fulfillment_mode: "self_serve",
      readiness_code: "READY",
      readiness_score: score != null ? String(score) : "",
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
