import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";

const STAGES = ["matched", "evaluating", "preparing", "submitted", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];
const isStage = (v: unknown): v is Stage =>
  typeof v === "string" && (STAGES as readonly string[]).includes(v);

let pipelineColumnsEnsured = false;
async function ensurePipelineColumns() {
  if (pipelineColumnsEnsured) return;
  await sql`ALTER TABLE pipeline_items ADD COLUMN IF NOT EXISTS source_url TEXT`;
  pipelineColumnsEnsured = true;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  await ensurePipelineColumns();
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT
      pi.id, pi.tender_id, pi.tender_title, pi.tender_agency, pi.tender_deadline,
      pi.tender_value, pi.source_url AS manual_source_url, pi.fit_score, pi.stage, pi.position, pi.notes, pi.match_reasons,
      pi.assessment_id, pi.updated_at,
      t.source_name, COALESCE(t.source_url, pi.source_url) AS source_url,
      t.opportunity_type, t.sector AS tender_sector,
      t.created_at AS tender_created_at, t.updated_at AS tender_updated_at,
      t.has_broken_link,
      COALESCE(pi.tender_value, t.estimated_value) AS display_value
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    WHERE pi.id = ${itemId} AND pi.user_id = ${guard.user!.id}
    LIMIT 1
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({ item: rows[0], access: guard.access });
}

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
