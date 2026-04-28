import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { createServiceWorkOrder } from "@/lib/service-orders";

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const body = await request.json().catch(() => ({}));

  try {
    const workOrder = await createServiceWorkOrder(guard.user!, body);
    return NextResponse.json({ workOrder }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create service order";
    console.error("[tp:service_order:create_failed]", {
      userId: guard.user?.id,
      error: message,
    });
    const status = message === "Invalid service" || message === "Pipeline item not found" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
