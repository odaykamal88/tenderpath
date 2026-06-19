import { NextResponse } from "next/server";
import {
  evaluateServiceFulfillmentGate,
  type ServiceFulfillmentGate,
} from "@/lib/service-fulfillment-gates";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getUserFromRequest } from "@/lib/auth";
import { getFreeSubmissionStatus, FREE_SUBMISSION_PLAN } from "@/lib/free-submission";
import { getOrderForUser } from "@/lib/submissions/store";
import {
  configuredSubmissionPriceId,
  isSubmissionCode,
  submissionType,
  type SubmissionCode,
} from "@/lib/workbench/pricing";
import { TIERS } from "@/lib/pricing";

/** What the pay page should DISPLAY for a submission checkout — always equal to
 *  what /api/pay/checkout will CHARGE (both key off configuredSubmissionPriceId). */
export interface SubmissionPricing {
  code: SubmissionCode;
  name: string;
  price: number;
  period: string;
  perType: boolean;
}

// Mirror /api/pay/checkout: a submissions-workflow order (EOI/RFQ/ITB/RFP) was
// already gated by the wizard's ≥80% intake check at commission. The generic
// proposal-draft fulfillment gate does NOT apply — running it here wrongly
// reported payment_allowed:false and disabled the card button while the
// checkout route happily issued a Stripe client secret for the same payload
// (commercialization audit 2026-06-19, blocker #1).
function submissionSelfServeReadiness(
  plan: string,
  workOrderId: number | null,
): ServiceFulfillmentGate {
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
    message: "Submission intake is complete — payment can proceed.",
    metadata: { fulfillment_mode: "submission_workflow", readiness_code: "SUBMISSION_READY" },
  };
}

// The proposal-draft package price, in whole USD, parsed once from the canonical
// TIERS sheet. Used as the dormant fallback so what we show matches the package
// charge when per-type Stripe prices aren't configured yet.
const PROPOSAL_PACKAGE_PRICE = (() => {
  const pkg = TIERS.find((t) => t.slug === "proposal-draft");
  const parsed = pkg ? Number(pkg.price.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(parsed) ? parsed : 299;
})();

// Authoritative price for a submission checkout. Uses the SAME gate the checkout
// route uses to pick the Stripe price (configuredSubmissionPriceId), so what we
// DISPLAY always equals what's CHARGED:
//   • per-type env configured → the EOI/RFQ/ITB/RFP catalog price ($149–$349)
//   • not configured (dormant) → the proposal-draft package price
function resolveSubmissionPricing(typeRaw: string | null): SubmissionPricing | null {
  if (!isSubmissionCode(typeRaw)) return null;
  const code = typeRaw.toUpperCase() as SubmissionCode;
  const t = submissionType(code);
  if (configuredSubmissionPriceId(code)) {
    return { code, name: t.name, price: t.price, period: "/submission", perType: true };
  }
  return { code, name: "Proposal Draft", price: PROPOSAL_PACKAGE_PRICE, period: "/submission", perType: false };
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, {
    namespace: "pay:readiness:ip",
    limit: 120,
    windowMs: 60 * 1000,
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const plan = url.searchParams.get("plan") ?? "";
  const rawWorkOrderId = url.searchParams.get("work_order_id");
  const workOrderId = rawWorkOrderId && /^\d+$/.test(rawWorkOrderId)
    ? Number(rawWorkOrderId)
    : null;
  const submissionTypeRaw = url.searchParams.get("submission_type");
  const rawSubmissionOrderId = url.searchParams.get("submission_order_id");
  const submissionOrderId = rawSubmissionOrderId && /^\d+$/.test(rawSubmissionOrderId)
    ? Number(rawSubmissionOrderId)
    : null;

  if (!plan) {
    return NextResponse.json({ error: "plan is required" }, { status: 400 });
  }

  // One identity lookup, reused for both submission-order ownership and the
  // first-proposal-free credit check below.
  const needsUser = Boolean(submissionOrderId) || plan === FREE_SUBMISSION_PLAN;
  const user = needsUser ? await getUserFromRequest(request) : null;

  // Submission-workflow checkout: verify the order is real, owned by the signed-
  // in user, and linked to this work order before skipping the proposal gate —
  // exactly the ownership check /api/pay/checkout performs.
  let submissionOrderValid = false;
  if (submissionOrderId && user) {
    const subOrder = await getOrderForUser(user.id, submissionOrderId);
    submissionOrderValid = Boolean(
      subOrder && (!workOrderId || subOrder.workOrderId === workOrderId),
    );
  }

  const readiness = submissionOrderValid
    ? submissionSelfServeReadiness(plan, workOrderId)
    : await evaluateServiceFulfillmentGate({ plan, workOrderId });

  const pricing = submissionOrderValid ? resolveSubmissionPricing(submissionTypeRaw) : null;

  // First-proposal-free eligibility — only meaningful for the proposal product,
  // and only when we can identify the signed-in user. Lets the checkout page
  // show "claim free submission" instead of a card form.
  let freeSubmissionEligible = false;
  if (plan === FREE_SUBMISSION_PLAN && user) {
    freeSubmissionEligible = (await getFreeSubmissionStatus(user)).eligible;
  }

  return NextResponse.json({ readiness, free_submission_eligible: freeSubmissionEligible, pricing });
}
