/**
 * queue.ts — Sprint 11 (revised for Hobby plan) background-job helpers for
 * proposal-draft generation.
 *
 * Why this exists
 * ===============
 *
 * Pre-Sprint-11, both proposal-draft generation routes (the dashboard
 * "Re-run" button and /api/proposals/generate) ran `generateProposalPackageV2`
 * SYNCHRONOUSLY inside the request lambda. The engine typically takes 5–7
 * minutes; the user's browser waited the whole time and saw a generic 500
 * on any hiccup.
 *
 * Sprint 11 (original design): the routes wrote the row as 'pending', a
 * Vercel cron job drained the queue every minute, the engine ran on the
 * cron worker's lambda budget.
 *
 * Sprint 11 (revised, this file): Vercel's Hobby plan rejects any cron
 * schedule more frequent than once-per-day, which makes the cron-worker
 * drain useless for interactive UX. The revised design uses next/server's
 * `after()` to fire the engine post-response inside the SAME lambda:
 *
 *   1. The user-facing routes call `enqueueProposalGeneration` — flips the
 *      proposal_packages row to generation_status='pending', returns the row
 *      ID, and exits in <100ms (HTTP response is sent).
 *
 *   2. after() fires after the HTTP response is sent. Inside it the route
 *      calls generateProposalPackageV2. The lambda stays alive until the
 *      engine resolves OR the lambda's maxDuration hits — whichever comes
 *      first. From the user's perspective, the request returns instantly
 *      and the dashboard polls until the row flips to 'ready'.
 *
 *   3. Each enqueue route calls `reapStaleGenerating` BEFORE enqueue. This
 *      replaces the cron worker's reaper — any row left in 'generating' by
 *      a previously-dead lambda (>STALE_GENERATING_MINUTES) is reset to
 *      'pending' so the next click can move it forward.
 *
 * Existing UI behavior (ProposalPackagePanel.tsx, MAX_POLLS poll loop) treats
 * 'pending' identically to 'generating' — "Drafting your proposal…" — so this
 * is a transparent UX upgrade with no panel changes required.
 *
 * Trade-offs vs the original cron design
 * ======================================
 *
 *   - Each user re-run burns one lambda budget. The engine still has to
 *     fit within maxDuration — no relief vs the pre-Sprint-11 status quo
 *     for >300s engines. The user-facing improvement is the instant ACK,
 *     not an uncap.
 *
 *   - claimNextPending() is unused in the after() flow (the route calls
 *     the engine directly with the workOrderId it already knows). Kept
 *     exported because the helpers are still useful for an ops-tool that
 *     drains the queue manually, and for the future Pro-plan-with-cron
 *     migration that would re-introduce a worker route.
 *
 *   - True engine staging (checkpointing between extractRubric / scoreDraft
 *     / revise calls so a run can survive a lambda death) is the natural
 *     Sprint 14+ follow-up. The queue helpers in this file are the
 *     foundation for it.
 */

import { sql } from "@/lib/db";
import type { GenerationStatus } from "./types";
import { PROPOSAL_PLAN } from "./types";

/** How long a 'generating' row can sit before the reaper resets it. */
export const STALE_GENERATING_MINUTES = 10;

/**
 * Vestigial constant from the original cron-worker design. The revised
 * after()-based flow has no recurring tick — the engine fires once per
 * user click. Kept exported so any external script that imported it (e.g.
 * an ops-tool computing stale-row windows) keeps compiling. New code
 * should reference STALE_GENERATING_MINUTES directly.
 */
export const WORKER_TICK_SECONDS = 0;

/**
 * Soft cap on generation_attempts before the worker stops auto-picking up
 * the row. We don't currently enforce this — failures land in
 * generation_status='failed' and the rate-limit gate stops the user from
 * spamming re-runs — but exposing the value keeps the policy auditable in
 * one place.
 */
export const SOFT_ATTEMPT_CAP = 20;

// --------------------------------------------------------------------------
// Pure decision helpers — exported for the acceptance test.
// --------------------------------------------------------------------------

export interface ProposalQueueRow {
  id: number;
  work_order_id: number | null;
  generation_status: GenerationStatus | string | null;
  generation_attempts: number | null;
  updated_at: Date | string | null;
}

/**
 * Should `row` be reaped (reset 'generating' → 'pending') given the current
 * time? Pure — no DB, no Date.now() inside (callers pass `now`).
 *
 * A row is reapable when:
 *   - status is 'generating' (terminal/blocked statuses are left alone)
 *   - updated_at is older than STALE_GENERATING_MINUTES ago
 *   - updated_at is parseable (otherwise we don't know how stale it is)
 */
export function shouldReap(
  row: ProposalQueueRow,
  now: Date,
  staleMinutes: number = STALE_GENERATING_MINUTES,
): boolean {
  if (row.generation_status !== "generating") return false;
  if (!row.updated_at) return false;
  const ts = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  if (Number.isNaN(ts.getTime())) return false;
  const ageMs = now.getTime() - ts.getTime();
  return ageMs > staleMinutes * 60 * 1000;
}

/**
 * Should `row` be claimed by the worker (picked up for engine execution)?
 * Pure — exported for the acceptance test. The actual claim is an atomic
 * UPDATE...RETURNING (see claimNextPending), but this helper proves the
 * eligibility rules.
 *
 * Claimable when:
 *   - status is 'pending'
 *   - work_order_id is set (orphan rows can't be matched to a WO)
 *   - attempts < SOFT_ATTEMPT_CAP (anti-runaway guard, even on retry)
 */
export function isClaimable(row: ProposalQueueRow): boolean {
  if (row.generation_status !== "pending") return false;
  if (row.work_order_id == null) return false;
  const attempts = row.generation_attempts ?? 0;
  if (attempts >= SOFT_ATTEMPT_CAP) return false;
  return true;
}

// --------------------------------------------------------------------------
// DB helpers
// --------------------------------------------------------------------------

export interface EnqueueArgs {
  workOrderId: number;
  userId: number | null;
  pipelineItemId: number | null;
  plan: string;
  tenderTitle: string | null;
  agency: string | null;
  tenderUrl: string | null;
  intake: Record<string, unknown>;
  stripeSessionId: string | null;
}

export interface EnqueueResult {
  packageId: number;
  attempts: number;
  /** True when this enqueue created a new row. False when it bumped an existing one. */
  created: boolean;
}

/**
 * Flip the proposal_packages row for this (workOrderId, plan) to 'pending'.
 * Creates a row when none exists; otherwise increments generation_attempts
 * and resets error_message. The worker picks up 'pending' rows on its next
 * cron tick.
 *
 * Idempotent under concurrent calls: ON CONFLICT semantics live in the
 * UPDATE...WHERE branch (only flips if status is non-ready or force=true is
 * implicit by reaching this point). Callers always reach this AFTER the
 * existing-row-is-ready short-circuit in the parent route.
 */
export async function enqueueProposalGeneration(args: EnqueueArgs): Promise<EnqueueResult> {
  const intakeJson = JSON.stringify(args.intake);

  // Try the UPDATE-by-(work_order_id, plan) path first. RETURNING tells us
  // whether anything matched.
  const updated = await sql`
    UPDATE proposal_packages
    SET generation_status = 'pending',
        generation_attempts = COALESCE(generation_attempts, 0) + 1,
        error_message = NULL,
        intake = ${intakeJson}::jsonb,
        tender_title = COALESCE(${args.tenderTitle}, tender_title),
        agency = COALESCE(${args.agency}, agency),
        tender_url = COALESCE(${args.tenderUrl}, tender_url),
        updated_at = NOW()
    WHERE work_order_id = ${args.workOrderId} AND plan = ${args.plan}
    RETURNING id, generation_attempts
  ` as unknown as Array<{ id: number; generation_attempts: number }>;

  if (updated.length > 0) {
    return {
      packageId: updated[0].id,
      attempts: updated[0].generation_attempts,
      created: false,
    };
  }

  // No existing row — INSERT a fresh 'pending' row. user_id is nullable for
  // anonymous (email-only) paid orders, matching the Sprint 17 schema relax.
  const inserted = await sql`
    INSERT INTO proposal_packages (
      user_id, work_order_id, pipeline_item_id, plan,
      tender_title, agency, tender_url, intake,
      stripe_session_id, output, pdf_url, pdf_pathname,
      generation_status, generation_attempts, error_message, updated_at
    ) VALUES (
      ${args.userId}, ${args.workOrderId}, ${args.pipelineItemId}, ${args.plan},
      ${args.tenderTitle}, ${args.agency}, ${args.tenderUrl}, ${intakeJson}::jsonb,
      ${args.stripeSessionId}, '{}'::jsonb, NULL, NULL,
      'pending', 1, NULL, NOW()
    )
    RETURNING id
  ` as unknown as Array<{ id: number }>;

  return {
    packageId: inserted[0]?.id ?? 0,
    attempts: 1,
    created: true,
  };
}

/**
 * Atomically claim the oldest 'pending' row for the given plan. Returns the
 * row's work_order_id (so the worker can drive generateProposalPackageV2)
 * along with the claimed package_id. Returns null when nothing is pending.
 *
 * The UPDATE...WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) pattern is the
 * Postgres standard for "pick one item from a queue without two workers
 * stomping each other". Neon supports it; if we ever migrate, the equivalent
 * is a SERIALIZABLE transaction with retry.
 */
export async function claimNextPending(
  plan: string = PROPOSAL_PLAN,
): Promise<{ packageId: number; workOrderId: number; attempts: number } | null> {
  const rows = await sql`
    UPDATE proposal_packages
    SET generation_status = 'generating',
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM proposal_packages
      WHERE generation_status = 'pending'
        AND plan = ${plan}
        AND work_order_id IS NOT NULL
        AND COALESCE(generation_attempts, 0) < ${SOFT_ATTEMPT_CAP}
      ORDER BY updated_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, work_order_id, generation_attempts
  ` as unknown as Array<{ id: number; work_order_id: number; generation_attempts: number }>;

  if (rows.length === 0) return null;
  return {
    packageId: rows[0].id,
    workOrderId: rows[0].work_order_id,
    attempts: rows[0].generation_attempts,
  };
}

export interface ReapResult {
  reaped: number;
  reapedIds: number[];
}

/**
 * Reset 'generating' rows older than `staleMinutes` to 'pending' so the
 * worker can retry. Called at the top of every worker tick.
 *
 * The reaper is conservative: it does NOT increment generation_attempts when
 * resetting (the row's prior attempt counter already includes the run that
 * died mid-engine). The user-facing rate-limit gate is the safety net for
 * runaway retries.
 *
 * Returns the count + IDs reaped so the worker can log them.
 */
export async function reapStaleGenerating(
  staleMinutes: number = STALE_GENERATING_MINUTES,
): Promise<ReapResult> {
  const rows = await sql`
    UPDATE proposal_packages
    SET generation_status = 'pending',
        error_message = 'reaped_stale_generating',
        updated_at = NOW()
    WHERE generation_status = 'generating'
      AND updated_at < NOW() - (${staleMinutes}::int * INTERVAL '1 minute')
    RETURNING id
  ` as unknown as Array<{ id: number }>;
  return {
    reaped: rows.length,
    reapedIds: rows.map((r) => r.id),
  };
}

/**
 * Quick read-only counter used by the worker's response body for telemetry.
 */
export async function queueDepth(
  plan: string = PROPOSAL_PLAN,
): Promise<{ pending: number; generating: number }> {
  const rows = await sql`
    SELECT generation_status, COUNT(*)::int AS n
    FROM proposal_packages
    WHERE plan = ${plan} AND generation_status IN ('pending','generating')
    GROUP BY generation_status
  ` as unknown as Array<{ generation_status: string; n: number }>;
  let pending = 0;
  let generating = 0;
  for (const r of rows) {
    if (r.generation_status === "pending") pending = r.n;
    if (r.generation_status === "generating") generating = r.n;
  }
  return { pending, generating };
}
