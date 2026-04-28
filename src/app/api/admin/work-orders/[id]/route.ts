import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { sendWorkOrderStatusNotification } from "@/lib/email/sendWorkOrderNotifications";

const STATUSES = new Set(["new", "in_progress", "waiting_on_client", "delivered", "canceled"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const body = await request.json() as {
    status?: string;
    fulfillment_notes?: string | null;
    notify_customer?: boolean;
  };

  if (body.status && !STATUSES.has(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const rows = await sql`
    UPDATE work_orders
    SET
      status = COALESCE(${body.status ?? null}, status),
      fulfillment_notes = COALESCE(${body.fulfillment_notes ?? null}, fulfillment_notes),
      updated_at = NOW()
    WHERE id = ${Number(id)}
    RETURNING *
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  const workOrder = rows[0];

  if (body.notify_customer && body.status) {
    await sendWorkOrderStatusNotification({
      id: workOrder.id as number,
      plan: workOrder.plan as string,
      serviceSlug: workOrder.service_slug as string | null,
      email: (workOrder.email as string | null) ?? null,
      tenderTitle: workOrder.tender_title as string | null,
      agency: workOrder.agency as string | null,
      paymentStatus: workOrder.payment_status as string | null,
      amountCents: workOrder.amount_cents as number | null,
      currency: workOrder.currency as string | null,
      status: workOrder.status as string,
      fulfillmentNotes: workOrder.fulfillment_notes as string | null,
    }).catch((err) => {
      console.error("[tp:admin_work_order_status_email:failed]", {
        workOrderId: workOrder.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return NextResponse.json({ workOrder });
}
