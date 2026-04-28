import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT
      wo.id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
      wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
      wo.tender_title, wo.agency, wo.tender_url, wo.intake,
      wo.fulfillment_notes, wo.created_at, wo.updated_at,
      pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage,
      pi.match_reasons
    FROM work_orders wo
    LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
    WHERE wo.user_id = ${guard.user!.id} AND wo.id = ${numericId}
    LIMIT 1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  return NextResponse.json({ workOrder: rows[0] });
}
