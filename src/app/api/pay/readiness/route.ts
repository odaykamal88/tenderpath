import { NextResponse } from "next/server";
import { evaluateServiceFulfillmentGate } from "@/lib/service-fulfillment-gates";

export async function GET(request: Request) {
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
