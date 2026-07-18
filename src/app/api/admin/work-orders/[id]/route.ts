import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { sendWorkOrderStatusNotification } from "@/lib/email/sendWorkOrderNotifications";
import { activeSupportAccess, recordSupportAccessEvent } from "@/lib/privacy/support-access";

const STATUSES = new Set(["new", "in_progress", "waiting_on_client", "delivered", "canceled"]);

function publicWorkOrder(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    plan: row.plan,
    service_slug: row.service_slug,
    status: row.status,
    payment_status: row.payment_status,
    amount_cents: row.amount_cents,
    currency: row.currency,
    email: row.email,
    pipeline_item_id: row.pipeline_item_id,
    tender_title: row.tender_title,
    agency: row.agency,
    tender_url: row.tender_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

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

  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }
  const contextRows = await sql`
    SELECT user_id
    FROM work_orders
    WHERE id = ${numericId}
    LIMIT 1
  `;
  const ownerUserId = contextRows[0]?.user_id == null ? null : Number(contextRows[0].user_id);
  if (!ownerUserId) return NextResponse.json({ error: "Work order not found" }, { status: 404 });

  let accessPurpose: string | null = null;
  if (body.fulfillment_notes != null) {
    const access = await activeSupportAccess(ownerUserId, numericId);
    if (!access) {
      await recordSupportAccessEvent({
        ownerUserId,
        workOrderId: numericId,
        actorUserId: guard.user!.id,
        eventType: "access_denied",
        purpose: "No active customer grant",
        metadata: { route: "admin_work_order_update" },
      });
      return NextResponse.json(
        { error: "Customer content is locked. Ask the customer to grant temporary access.", code: "CUSTOMER_CONTENT_LOCKED" },
        { status: 403 },
      );
    }
    accessPurpose = access.purpose;
  }

  const rows = await sql`
    UPDATE work_orders
    SET
      status = COALESCE(${body.status ?? null}, status),
      fulfillment_notes = COALESCE(${body.fulfillment_notes ?? null}, fulfillment_notes),
      updated_at = NOW()
    WHERE id = ${numericId}
    RETURNING
      id, user_id, plan, service_slug, status, payment_status,
      amount_cents, currency, email, pipeline_item_id, tender_title,
      agency, tender_url, created_at, updated_at,
      CASE WHEN ${accessPurpose !== null} THEN fulfillment_notes ELSE NULL END AS fulfillment_notes
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  const workOrder = rows[0];

  if (body.fulfillment_notes != null) {
    await recordSupportAccessEvent({
      ownerUserId,
      workOrderId: numericId,
      actorUserId: guard.user!.id,
      eventType: "content_write",
      purpose: accessPurpose,
      metadata: { route: "admin_work_order_update", fields: ["fulfillment_notes"] },
    });
  }

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

  return NextResponse.json({ workOrder: publicWorkOrder(workOrder as Record<string, unknown>) });
}
