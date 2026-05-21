import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

const ROUTED_SERVICES = new Set([
  "bid-no-bid",
  "proposal-draft",
  "roster-fast-track",
  "matching",
]);
const STATUSES = new Set([
  "suggested",
  "contacted",
  "applied",
  "shortlisted",
  "won",
  "lost",
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ matchId: string }> }
) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { matchId: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const hasStatus = b.status !== undefined;
  const hasOutcome = b.outcome !== undefined;
  const hasReasoning = b.fit_reasoning !== undefined;
  const hasService = b.routed_service !== undefined;

  if (!hasStatus && !hasOutcome && !hasReasoning && !hasService) {
    return NextResponse.json({ error: "Provide at least one of: status, outcome, fit_reasoning, routed_service" }, { status: 400 });
  }

  const nextStatus = hasStatus ? String(b.status ?? "").trim() : null;
  const nextService = hasService ? String(b.routed_service ?? "").trim() : null;
  const nextReasoning = hasReasoning ? String(b.fit_reasoning ?? "").trim() : null;
  const nextOutcome = hasOutcome
    ? (b.outcome == null ? null : (String(b.outcome).trim() || null))
    : undefined;

  if (nextStatus !== null && !STATUSES.has(nextStatus)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}` }, { status: 400 });
  }
  if (nextService !== null && !ROUTED_SERVICES.has(nextService)) {
    return NextResponse.json({ error: `routed_service must be one of: ${[...ROUTED_SERVICES].join(", ")}` }, { status: 400 });
  }
  if (nextReasoning !== null) {
    if (nextReasoning.length < 10) {
      return NextResponse.json({ error: "fit_reasoning must be at least 10 characters" }, { status: 400 });
    }
    if (nextReasoning.length > 4000) {
      return NextResponse.json({ error: "fit_reasoning too long (max 4000 chars)" }, { status: 400 });
    }
  }

  try {
    const updated = await sql`
      UPDATE tender_vendor_matches
      SET
        status = COALESCE(${nextStatus}, status),
        routed_service = COALESCE(${nextService}, routed_service),
        fit_reasoning = COALESCE(${nextReasoning}, fit_reasoning),
        outcome = CASE WHEN ${hasOutcome}::boolean THEN ${nextOutcome ?? null} ELSE outcome END,
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, tender_id, assessment_id, routed_service, status,
                fit_reasoning, outcome, created_by, created_at, updated_at
    `;
    if (!updated.length) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    return NextResponse.json({ match: updated[0] });
  } catch (err) {
    console.error("[matching:match-update:db_error]", err);
    return NextResponse.json({ error: "Failed to update match" }, { status: 500 });
  }
}
