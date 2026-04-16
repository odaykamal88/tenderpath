import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";

const STAGES = ["matched", "evaluating", "preparing", "submitted", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];
const isStage = (v: unknown): v is Stage =>
  typeof v === "string" && (STAGES as readonly string[]).includes(v);

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { stage, position, notes } = body ?? {};

  if (stage !== undefined && !isStage(stage)) {
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  }

  const rows = await sql`
    UPDATE pipeline_items SET
      stage = COALESCE(${stage ?? null}, stage),
      position = COALESCE(${position ?? null}, position),
      notes = COALESCE(${notes ?? null}, notes),
      updated_at = NOW()
    WHERE id = ${itemId} AND user_id = ${guard.user!.id}
    RETURNING *
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ item: rows[0] });
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await sql`
    DELETE FROM pipeline_items
    WHERE id = ${itemId} AND user_id = ${guard.user!.id}
  `;

  return NextResponse.json({ ok: true });
}
