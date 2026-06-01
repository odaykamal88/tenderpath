/**
 * /api/dashboard/work-orders/[id]/outcome — Loop 1 outcome capture.
 *
 * GET  — is there a delivered proposal to report on, what did we predict, and
 *        what (if anything) has the vendor already reported?
 * POST — record/re-record the real result (won/lost/shortlisted/disqualified/
 *        withdrawn) against the delivered package, snapshotting the predicted
 *        score so the calibration harness (1c) can compare prediction vs.
 *        reality. The record lands `captured`; a human promotes it (1d) before
 *        it ever moves the score.
 *
 * Chasing losses is the whole point — the UI makes a loss as easy to report as
 * a win, with an optional "what went wrong" note that becomes loss-reason
 * signal. Survivorship bias (only capturing happy outcomes) is what quietly
 * makes the score dishonest.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { PROPOSAL_PLAN } from "@/lib/proposal-package/types";
import {
  upsertOutcome,
  getOutcomeForPackage,
  recordLossReason,
  isOutcomeValue,
  scoreBand,
} from "@/lib/feedback/store";

export const runtime = "nodejs";

interface ProposalOrderRow {
  id: number;
  user_id: number | null;
  email: string | null;
  tender_title: string | null;
  agency: string | null;
}

interface DeliveredPackageRow {
  id: number;
  output: unknown;
  generation_status: string | null;
  tender_title: string | null;
  agency: string | null;
}

async function ensureOwnedProposalOrder(
  request: Request,
  rawId: string,
): Promise<{ ok: true; order: ProposalOrderRow } | { ok: false; response: NextResponse }> {
  const guard = await requireAuth(request);
  if (!guard.authorized) return { ok: false, response: guard.response! };

  const numericId = Number(rawId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, response: NextResponse.json({ error: "Invalid work order id" }, { status: 400 }) };
  }

  const rows = (await sql`
    SELECT id, user_id, email, tender_title, agency, plan, service_slug
    FROM work_orders
    WHERE id = ${numericId} AND (user_id = ${guard.user!.id} OR email = ${guard.user!.email})
    LIMIT 1
  `) as unknown as Array<ProposalOrderRow & { plan: string; service_slug: string | null }>;

  const order = rows[0];
  if (!order) {
    return { ok: false, response: NextResponse.json({ error: "Work order not found" }, { status: 404 }) };
  }
  if (order.plan !== PROPOSAL_PLAN && order.service_slug !== "proposal") {
    return { ok: false, response: NextResponse.json({ error: "Not a proposal-draft work order" }, { status: 400 }) };
  }
  return { ok: true, order };
}

async function loadDeliveredPackage(workOrderId: number): Promise<DeliveredPackageRow | null> {
  const rows = (await sql`
    SELECT id, output, generation_status, tender_title, agency
    FROM proposal_packages
    WHERE work_order_id = ${workOrderId} AND plan = ${PROPOSAL_PLAN}
    ORDER BY created_at DESC
    LIMIT 1
  `) as unknown as Array<DeliveredPackageRow>;
  return rows[0] ?? null;
}

/** Sum the predicted rubric points from output.score (ScoreResult shape):
 *  estimated total across lots vs. the achievable max across all criteria. */
function predictedFromOutput(output: unknown): { score: number; max: number; rubricVersion: number | null } | null {
  if (!output || typeof output !== "object") return null;
  const score = (output as { score?: unknown }).score;
  if (!score || typeof score !== "object") return null;
  const lotResults = (score as { lotResults?: unknown }).lotResults;
  if (!Array.isArray(lotResults)) return null;
  let s = 0;
  let max = 0;
  for (const lr of lotResults) {
    const est = (lr as { estimatedTotal?: unknown }).estimatedTotal;
    if (typeof est === "number" && Number.isFinite(est)) s += est;
    const per = (lr as { perCriterion?: unknown }).perCriterion;
    if (Array.isArray(per)) {
      for (const c of per) {
        const m = (c as { maxScore?: unknown }).maxScore;
        if (typeof m === "number" && Number.isFinite(m)) max += m;
      }
    }
  }
  if (!(max > 0)) return null;
  const rv = (score as { rubricVersion?: unknown }).rubricVersion;
  return { score: s, max, rubricVersion: typeof rv === "number" ? rv : null };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await ensureOwnedProposalOrder(request, id);
  if (!result.ok) return result.response;

  const pkg = await loadDeliveredPackage(result.order.id);
  const eligible = !!pkg && pkg.generation_status === "ready";
  const predicted = pkg ? predictedFromOutput(pkg.output) : null;
  const existing = pkg ? await getOutcomeForPackage(pkg.id) : null;

  return NextResponse.json({
    eligible,
    predicted: predicted
      ? { score: predicted.score, max: predicted.max, band: scoreBand(predicted.score, predicted.max) }
      : null,
    outcome: existing
      ? { value: existing.outcome, detail: existing.detail, state: existing.state, capturedAt: existing.createdAt }
      : null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await ensureOwnedProposalOrder(request, id);
  if (!result.ok) return result.response;

  let body: { outcome?: unknown; detail?: unknown };
  try {
    body = (await request.json()) as { outcome?: unknown; detail?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isOutcomeValue(body.outcome)) {
    return NextResponse.json(
      { error: "outcome must be one of won, lost, shortlisted, disqualified, withdrawn, pending" },
      { status: 400 },
    );
  }
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 4000) : null;

  const pkg = await loadDeliveredPackage(result.order.id);
  if (!pkg || pkg.generation_status !== "ready") {
    return NextResponse.json(
      { error: "No delivered proposal to report an outcome on yet." },
      { status: 400 },
    );
  }

  const predicted = predictedFromOutput(pkg.output);

  try {
    const record = await upsertOutcome({
      proposalPackageId: pkg.id,
      workOrderId: result.order.id,
      userId: result.order.user_id,
      tenderTitle: pkg.tender_title ?? result.order.tender_title,
      agency: pkg.agency ?? result.order.agency,
      outcome: body.outcome,
      predictedScore: predicted?.score ?? null,
      predictedMax: predicted?.max ?? null,
      predictedBand: predicted ? scoreBand(predicted.score, predicted.max) : null,
      rubricVersion: predicted?.rubricVersion ?? null,
      detail,
      capturedFrom: "user_prompt",
    });
    console.log("[feedback:outcome_captured]", {
      workOrderId: result.order.id,
      packageId: pkg.id,
      outcome: record.outcome,
      hasDetail: !!detail,
    });

    // Loop 1 -> Loop 2: a reported loss WITH a note is also a loss-reason
    // signal. Best-effort — a failure here must never fail the outcome capture.
    if ((body.outcome === "lost" || body.outcome === "disqualified") && detail) {
      try {
        await recordLossReason({
          detail,
          proposalPackageId: pkg.id,
          workOrderId: result.order.id,
          userId: result.order.user_id,
          tenderTitle: pkg.tender_title ?? result.order.tender_title,
          agency: pkg.agency ?? result.order.agency,
          lossKind: "user_reported",
          capturedFrom: "user_prompt",
        });
      } catch (lossErr) {
        console.warn("[feedback:loss_reason_from_outcome_failed]", {
          workOrderId: result.order.id,
          err: lossErr instanceof Error ? lossErr.message : String(lossErr),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      outcome: { value: record.outcome, detail: record.detail, state: record.state, capturedAt: record.createdAt },
    });
  } catch (err) {
    console.error("[feedback:outcome_capture_failed]", {
      workOrderId: result.order.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not record the outcome. Try again." }, { status: 500 });
  }
}
