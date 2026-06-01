/**
 * /api/admin/feedback — the curation gate's control surface (Phase 1d).
 *
 * GET   — list feedback records (default: captured = waiting on review) with
 *         aggregate stats and a per-outcome calibration verdict (the B2 signal:
 *         did the predicted score match the real result). Admin-only.
 * PATCH — promote or reject a record. ONLY promoted records ever feed scoring
 *         calibration / extraction / retrieval, so this is the human gate. The
 *         reviewer id + timestamp are stamped for audit.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import {
  listFeedback,
  setFeedbackState,
  feedbackStats,
  calibrationVerdict,
  isFeedbackState,
  isFeedbackKind,
} from "@/lib/feedback/store";
import type { FeedbackRecord } from "@/lib/feedback/types";

export const runtime = "nodejs";

function withCalibration(r: FeedbackRecord) {
  const calibration =
    r.kind === "outcome" && r.outcome
      ? calibrationVerdict(r.predictedScore, r.predictedMax, r.outcome)
      : null;
  return { ...r, calibration };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state");
  const kindParam = url.searchParams.get("kind");
  const state = isFeedbackState(stateParam) ? stateParam : undefined;
  const kind = isFeedbackKind(kindParam) ? kindParam : undefined;

  const [records, stats] = await Promise.all([
    listFeedback({ state, kind, limit: 200 }),
    feedbackStats(),
  ]);

  return NextResponse.json({
    records: records.map(withCalibration),
    stats,
    filter: { state: state ?? null, kind: kind ?? null },
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  let body: { id?: unknown; state?: unknown; notes?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; state?: unknown; notes?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Valid record id is required" }, { status: 400 });
  }
  // Admin curation actions are promote or reject. (Re-opening to `captured`
  // happens automatically on re-report, not from this surface.)
  if (body.state !== "promoted" && body.state !== "rejected") {
    return NextResponse.json({ error: "state must be 'promoted' or 'rejected'" }, { status: 400 });
  }
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : undefined;

  try {
    const updated = await setFeedbackState(id, body.state, guard.user!.id, notes);
    if (!updated) {
      return NextResponse.json({ error: "Record not found or already in that state" }, { status: 409 });
    }
    console.log("[admin:feedback_curated]", { id, state: updated.state, reviewer: guard.user!.id });
    return NextResponse.json({ ok: true, record: withCalibration(updated) });
  } catch (err) {
    console.error("[admin:feedback_curate_failed]", {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not update the record." }, { status: 500 });
  }
}
