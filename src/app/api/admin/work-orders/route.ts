import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  const rows = status && status !== "all"
    ? await sql`
        SELECT
          wo.*,
          u.email AS user_email,
          pi.tender_deadline,
          pi.fit_score,
          pi.stage AS pipeline_stage
        FROM work_orders wo
        LEFT JOIN users u ON u.id = wo.user_id
        LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
        WHERE wo.status = ${status}
        ORDER BY wo.created_at DESC
        LIMIT 100
      `
    : await sql`
        SELECT
          wo.*,
          u.email AS user_email,
          pi.tender_deadline,
          pi.fit_score,
          pi.stage AS pipeline_stage
        FROM work_orders wo
        LEFT JOIN users u ON u.id = wo.user_id
        LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
        ORDER BY wo.created_at DESC
        LIMIT 100
      `;

  return NextResponse.json({ workOrders: rows });
}
