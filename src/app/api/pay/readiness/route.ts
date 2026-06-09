import { NextResponse } from "next/server";
import { evaluateServiceFulfillmentGate } from "@/lib/service-fulfillment-gates";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getUserFromRequest } from "@/lib/auth";
import { getFreeSubmissionStatus, FREE_SUBMISSION_PLAN } from "@/lib/free-submission";

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

  if (!plan) {
    return NextResponse.json({ error: "plan is required" }, { status: 400 });
  }

  const readiness = await evaluateServiceFulfillmentGate({ plan, workOrderId });

  // First-proposal-free eligibility — only meaningful for the proposal product,
  // and only when we can identify the signed-in user from the request. Lets the
  // checkout page show "claim free submission" instead of a card form.
  let freeSubmissionEligible = false;
  if (plan === FREE_SUBMISSION_PLAN) {
    const user = await getUserFromRequest(request);
    if (user) {
      freeSubmissionEligible = (await getFreeSubmissionStatus(user)).eligible;
    }
  }

  return NextResponse.json({ readiness, free_submission_eligible: freeSubmissionEligible });
}
