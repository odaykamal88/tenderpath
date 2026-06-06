import { NextResponse } from "next/server";
import { evaluateServiceFulfillmentGate } from "@/lib/service-fulfillment-gates";
import { enforceRateLimit } from "@/lib/security/rate-limit";

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
  return NextResponse.json({ readiness });
}
