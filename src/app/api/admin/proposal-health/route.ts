/**
 * /api/admin/proposal-health — the proposal pipeline monitor (Phase 2b).
 *
 * Answers the AGENTS.md ops questions for the $299 pipeline in one grouped view
 * (mirrors /api/admin/telegram-health + payment-health):
 *   - Did runs complete? (generation_status breakdown)
 *   - Are the scores valid / honest? (per-run integrity verdicts from 2a)
 *   - Are we capturing outcomes — and chasing losses? (capture rate + win/loss)
 *   - Is the score calibrated yet? (B2, promoted outcomes only)
 *   - How deep is the curation queue? (what's waiting on a human)
 *
 * Read-only, admin-only. Silent no-op is worse than explicit failure — this
 * makes the pipeline's health diagnosable without log spelunking.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { feedbackStats, getPromotedOutcomes } from "@/lib/feedback/store";
import { computeCalibration } from "@/lib/feedback/calibration";

export const runtime = "nodejs";

const PROPOSAL_PLAN = "proposal-draft";
const INTEGRITY_SAMPLE = 300;

function flagCategory(flag: string): "incomplete" | "score_validity" | "honest_claim" | "other" {
  if (flag.startsWith("incomplete")) return "incomplete";
  if (flag.startsWith("score-validity")) return "score_validity";
  if (flag.startsWith("honest-claim")) return "honest_claim";
  return "other";
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  // 1. Generation-status breakdown.
  const genRows = (await sql`
    SELECT generation_status AS s, count(*)::int AS n
    FROM proposal_packages
    WHERE plan = ${PROPOSAL_PLAN}
    GROUP BY generation_status
  `) as Array<{ s: string | null; n: number }>;
  const generation: Record<string, number> = { ready: 0, needs_remediation: 0, failed: 0, rubric_stale: 0, pending: 0, generating: 0 };
  let genTotal = 0;
  for (const r of genRows) {
    genTotal += r.n;
    if (r.s && r.s in generation) generation[r.s] += r.n;
  }
  generation.total = genTotal;

  // 2. Per-run integrity verdicts (2a) over the most-recent ready packages.
  const intRows = (await sql`
    SELECT output->'integrity' AS integrity
    FROM proposal_packages
    WHERE plan = ${PROPOSAL_PLAN} AND generation_status = 'ready'
    ORDER BY created_at DESC
    LIMIT ${INTEGRITY_SAMPLE}
  `) as Array<{ integrity: unknown }>;
  const integrity = {
    assessed: 0,
    ok: 0,
    flagged: 0,
    noVerdict: 0,
    byCategory: { incomplete: 0, score_validity: 0, honest_claim: 0, other: 0 },
  };
  for (const row of intRows) {
    const v = row.integrity as { ok?: unknown; flags?: unknown } | null;
    if (!v || typeof v !== "object") {
      integrity.noVerdict += 1;
      continue;
    }
    integrity.assessed += 1;
    if (v.ok === true) integrity.ok += 1;
    else integrity.flagged += 1;
    if (Array.isArray(v.flags)) {
      for (const f of v.flags) {
        if (typeof f === "string") integrity.byCategory[flagCategory(f)] += 1;
      }
    }
  }

  // 3. Outcome capture + win/loss balance (chase losses).
  const outRows = (await sql`
    SELECT outcome AS o, count(*)::int AS n
    FROM feedback_records
    WHERE kind = 'outcome' AND outcome IS NOT NULL
    GROUP BY outcome
  `) as Array<{ o: string; n: number }>;
  const byOutcome: Record<string, number> = { won: 0, shortlisted: 0, lost: 0, disqualified: 0, withdrawn: 0, pending: 0 };
  let capturedOutcomes = 0;
  for (const r of outRows) {
    capturedOutcomes += r.n;
    if (r.o in byOutcome) byOutcome[r.o] += r.n;
  }
  const readyPackages = generation.ready;
  const outcomes = {
    readyPackages,
    captured: capturedOutcomes,
    captureRatePct: readyPackages > 0 ? Math.round((capturedOutcomes / readyPackages) * 100) : 0,
    byOutcome,
  };

  // 4. Calibration (promoted outcomes only) + 5. curation queue depth.
  const [promoted, stats] = await Promise.all([getPromotedOutcomes(), feedbackStats()]);
  const calibration = computeCalibration(promoted);

  // Rollup health flag.
  const degraded =
    generation.failed > 0 ||
    generation.rubric_stale > 0 ||
    (integrity.assessed > 0 && integrity.flagged / integrity.assessed > 0.3);

  return NextResponse.json({
    status: degraded ? "degraded" : "ok",
    generation,
    integrity,
    outcomes,
    calibration,
    curationQueueDepth: stats.pendingReview,
  });
}
