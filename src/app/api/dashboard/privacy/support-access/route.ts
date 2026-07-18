import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  grantSupportAccess,
  listSupportAccessEvents,
  listSupportAccessOrders,
  revokeSupportAccess,
} from "@/lib/privacy/support-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  try {
    const [orders, events] = await Promise.all([
      listSupportAccessOrders(guard.user!.id),
      listSupportAccessEvents(guard.user!.id),
    ]);
    return NextResponse.json({ orders, events });
  } catch (error) {
    console.error("[privacy:support-access:list_failed]", {
      userId: guard.user!.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not load support access controls." }, { status: 500 });
  }
}
export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const limited = enforceRateLimit(request, {
    namespace: "privacy-support-access",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    keyParts: [guard.user!.id],
  });
  if (limited) return limited;

  try {
    const body = await request.json() as {
      action?: "grant" | "revoke";
      workOrderId?: number;
      durationHours?: number;
      purpose?: string;
    };
    const workOrderId = Number(body.workOrderId);
    if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
      return NextResponse.json({ error: "Valid workOrderId required." }, { status: 400 });
    }

    if (body.action === "revoke") {
      const revoked = await revokeSupportAccess({ ownerUserId: guard.user!.id, workOrderId });
      return revoked
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: "No active access grant found." }, { status: 404 });
    }

    if (body.action !== "grant") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const grant = await grantSupportAccess({
      ownerUserId: guard.user!.id,
      workOrderId,
      durationHours: Number(body.durationHours ?? 72),
      purpose: String(body.purpose ?? "Fulfill and support this TenderPath service order"),
    });
    return grant
      ? NextResponse.json({ grant }, { status: 201 })
      : NextResponse.json({ error: "Work order not found or purpose missing." }, { status: 404 });
  } catch (error) {
    console.error("[privacy:support-access:update_failed]", {
      userId: guard.user!.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not update support access." }, { status: 500 });
  }
}
