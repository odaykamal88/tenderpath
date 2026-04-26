import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

const STATUSES = new Set(["new", "in_progress", "waiting_on_client", "delivered", "canceled"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await params;
  const body = await request.json() as {
    status?: string;
    fulfillment_notes?: string | null;
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

  return NextResponse.json({ workOrder: rows[0] });
}
