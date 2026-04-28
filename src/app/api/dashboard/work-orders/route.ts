import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

const STATUSES = new Set(["new", "in_progress", "waiting_on_client", "delivered", "canceled"]);

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  const rows = status && STATUSES.has(status)
    ? await sql`
        SELECT
          wo.id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
          wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
          wo.tender_title, wo.agency, wo.tender_url, wo.intake,
          wo.fulfillment_notes, wo.created_at, wo.updated_at,
          pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage
        FROM work_orders wo
        LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
        WHERE wo.user_id = ${user.id} AND wo.status = ${status}
        ORDER BY wo.created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT
          wo.id, wo.plan, wo.service_slug, wo.status, wo.payment_status,
          wo.amount_cents, wo.currency, wo.email, wo.pipeline_item_id,
          wo.tender_title, wo.agency, wo.tender_url, wo.intake,
          wo.fulfillment_notes, wo.created_at, wo.updated_at,
          pi.tender_deadline, pi.fit_score, pi.stage AS pipeline_stage
        FROM work_orders wo
        LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
        WHERE wo.user_id = ${user.id}
        ORDER BY wo.created_at DESC
        LIMIT ${limit}
      `;

  return NextResponse.json({ workOrders: rows });
}
