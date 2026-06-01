import { NextResponse } from "next/server";
import {
  claimNextPending,
  reapStaleGenerating,
  queueDepth,
} from "@/lib/proposal-package/queue";
import { generateProposalPackageV2 } from "@/lib/proposal-package/generate-proposal-v2";
import { PROPOSAL_PLAN } from "@/lib/proposal-package/types";

export const runtime = "nodejs";

/**
 * Vercel Pro lambda ceiling. The worker can run the engine inline; if a
 * single engine run takes >300 s the worker times out and the reaper resets
 * the row on the next tick. Stage-persistence (Sprint 14+) will eventually
 * remove this constraint by checkpointing between LLM calls.
 */
export const maxDuration = 300;

/**
 * Sprint 11 background-job worker for proposal-draft generation.
 *
 * Triggered every 5 minutes by Vercel cron (see vercel.json). Originally
 * configured as the every-minute schedule — Vercel rejected the deploy
 * because cron-job billing has its own tier toggle that's tighter than the
 * lambda-compute Pro plan we're otherwise on. The "every 5 minutes"
 * schedule (slash-5 in the minute field) deploys cleanly and keeps
 * queue-drain latency well below the engine's typical 5–7 min run.
 *
 * Each tick:
 *
 *   1. Reap stale rows — any proposal_packages row in 'generating' state
 *      whose updated_at is older than STALE_GENERATING_MINUTES is reset
 *      to 'pending' so the next tick picks it up. Covers worker crashes
 *      and 300 s timeouts.
 *
 *   2. Claim the oldest 'pending' row atomically via UPDATE...SELECT FOR
 *      UPDATE SKIP LOCKED. Marks it 'generating' and returns its
 *      work_order_id. Two cron ticks racing the same row don't conflict.
 *
 *   3. Call generateProposalPackageV2(workOrderId, force=true). The
 *      engine handles its own status transitions ('generating' → 'ready' /
 *      'failed') via upsertPackage / markFailure, so the worker doesn't
 *      need to touch the row again after the claim.
 *
 * Auth follows the existing /api/cron/* pattern: `authorization: Bearer
 * ${CRON_SECRET}`. Vercel cron supplies this header automatically when the
 * env var is set.
 *
 * Telemetry returned in the response body so Vercel cron dashboards (and
 * the operational visibility AGENTS.md requires) can read queue depth +
 * reaper activity without log scraping.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[proposal-worker] CRON_SECRET not configured — refusing request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let reapedCount = 0;
  let claimedPackageId: number | null = null;
  let claimedWorkOrderId: number | null = null;
  let engineResult: { ok: boolean; attempts: number; error?: string; skippedReason?: string } | null = null;

  try {
    // 1. Reap first — gives a freshly-stale row the chance to be the next
    //    claim instead of waiting another tick.
    const reaped = await reapStaleGenerating();
    reapedCount = reaped.reaped;
    if (reapedCount > 0) {
      console.log("[proposal-worker:reaped_stale]", {
        count: reapedCount,
        ids: reaped.reapedIds,
      });
    }

    // 2. Claim one job. FIFO by updated_at. Returns null when the queue is
    //    empty, which is the dominant case (the worker tick is cheap when
    //    there's no work — just two queries).
    const claim = await claimNextPending(PROPOSAL_PLAN);
    if (!claim) {
      const depth = await queueDepth(PROPOSAL_PLAN);
      return NextResponse.json({
        ok: true,
        idle: true,
        reaped: reapedCount,
        queue_depth: depth,
        duration_ms: Date.now() - startedAt,
      });
    }
    claimedPackageId = claim.packageId;
    claimedWorkOrderId = claim.workOrderId;
    console.log("[proposal-worker:claimed]", {
      packageId: claimedPackageId,
      workOrderId: claimedWorkOrderId,
      attempts: claim.attempts,
    });

    // 3. Run the engine inline. force=true so the v2's existing-ready
    //    short-circuit doesn't no-op on rows the user explicitly re-queued
    //    via the dashboard "Re-run" button.
    const v2 = await generateProposalPackageV2({
      workOrderId: claim.workOrderId,
      force: true,
    });
    engineResult = {
      ok: v2.ok,
      attempts: v2.attempts,
      error: v2.error,
      skippedReason: v2.skippedReason,
    };
    console.log("[proposal-worker:engine_done]", {
      packageId: claimedPackageId,
      workOrderId: claimedWorkOrderId,
      ok: v2.ok,
      attempts: v2.attempts,
      skippedReason: v2.skippedReason ?? null,
      duration_ms: Date.now() - startedAt,
    });

    const depth = await queueDepth(PROPOSAL_PLAN);
    return NextResponse.json({
      ok: true,
      reaped: reapedCount,
      claimed: { package_id: claimedPackageId, work_order_id: claimedWorkOrderId },
      engine: engineResult,
      queue_depth: depth,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Worker failed mid-engine. The row is still in 'generating' and will be
    // reaped by the next tick. The dashboard rate-limit gate prevents the
    // user from spamming new orders if this keeps happening.
    console.error("[proposal-worker:failed]", {
      packageId: claimedPackageId,
      workOrderId: claimedWorkOrderId,
      reaped: reapedCount,
      error: message,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        error: message,
        reaped: reapedCount,
        claimed: claimedPackageId
          ? { package_id: claimedPackageId, work_order_id: claimedWorkOrderId }
          : null,
        duration_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
