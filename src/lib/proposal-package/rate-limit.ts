/**
 * rate-limit.ts — per-day re-run cap for the $299 proposal-draft plan.
 *
 * Sprint 6b set PROPOSAL_MAX_ATTEMPTS = Infinity because the honest
 * product framing for $299 is "you own this verified proposal — re-run
 * it as often as you need." The Sprint 6b commit explicitly acknowledged
 * the risk: a stuck regeneration loop OR a determined user could rack
 * up Anthropic costs unboundedly. Sprint 6c tagged the proper fix as
 * "per-day API rate-limit (e.g. 10 re-runs / 24h), not a hard cap that
 * contradicts the product promise." This module is that fix.
 *
 * Semantics
 *
 *   - Each successful POST to a proposal-draft generation route counts
 *     as one "re-run" — failures count too, because they spend LLM
 *     budget. (The point of the cap is cost protection, not a
 *     correctness gate.)
 *   - Limit is per AUTHENTICATED USER, NOT per work-order. A user with
 *     multiple paid proposal-draft tenders shares one quota — they
 *     can't multiply by opening many WOs.
 *   - 24h rolling window: when a user runs out, the soonest they can
 *     trigger again is when their OLDEST in-window run ages out.
 *   - Only proposal-draft plan is gated. Roster (MAX_ATTEMPTS=6) and
 *     Bid/No-Bid (MAX_ATTEMPTS=6) have their own caps and never invoke
 *     this module.
 *
 * Fail-open on DB error
 *
 *   If the quota check itself fails (DB down, permission issue, etc.),
 *   we allow the request through. The point of the cap is to bound
 *   Anthropic spend, not to be a hard correctness gate; allowing a
 *   handful of through-runs during a DB outage is the strictly safer
 *   user-experience trade-off (the alternative is product breakage on
 *   every blip). Failures are logged with `[proposal-rate-limit:*]`
 *   tags so prod alerting can pick them up.
 */

import { sql } from "@/lib/db";

export const PROPOSAL_RERUN_LIMIT = 10;
export const PROPOSAL_RERUN_WINDOW_HOURS = 24;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface RateLimitDecision {
  /** True when the caller may invoke the generator. */
  allowed: boolean;
  /** Re-runs remaining within the current window after this check.
   *  When allowed=false, this is 0. */
  remaining: number;
  /** When allowed=false, the soonest moment a new slot opens up (i.e.,
   *  when the oldest in-window run ages out). Null when allowed=true. */
  resetAt: Date | null;
}

/**
 * Pure quota math. Given a list of past `ran_at` timestamps, a "now"
 * baseline, and limit + window parameters, return the decision. Exported
 * for the acceptance script — the route handler resolves the SQL query
 * upstream and passes the rows in here.
 *
 * Idempotent and stateless — calling this twice with the same inputs
 * yields the same result.
 */
export function computeQuotaDecision(args: {
  ranAt: Date[];
  now: Date;
  limit: number;
  windowHours: number;
}): RateLimitDecision {
  const cutoff = new Date(args.now.getTime() - args.windowHours * MS_PER_HOUR);
  // Filter to only the runs that fall inside the rolling window. Anything
  // older is irrelevant.
  const recent = args.ranAt.filter((t) => t.getTime() > cutoff.getTime());
  const remaining = Math.max(0, args.limit - recent.length);
  if (remaining > 0) {
    return { allowed: true, remaining, resetAt: null };
  }
  // Quota exhausted. The next slot opens up when the OLDEST current-
  // window run ages out — that's `oldest.ran_at + windowHours`.
  const oldest = recent.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  const resetAt = new Date(oldest.getTime() + args.windowHours * MS_PER_HOUR);
  return { allowed: false, remaining: 0, resetAt };
}

/**
 * Read the user's in-window runs from the database and decide. Used
 * by the proposal-draft route handlers before they invoke the engine.
 */
export async function checkRerunQuota(userId: number): Promise<RateLimitDecision> {
  const cutoff = new Date(Date.now() - PROPOSAL_RERUN_WINDOW_HOURS * MS_PER_HOUR);
  try {
    const rows = await sql`
      SELECT ran_at
      FROM proposal_rerun_log
      WHERE user_id = ${userId}
        AND ran_at > ${cutoff.toISOString()}
      ORDER BY ran_at ASC
    ` as unknown as Array<{ ran_at: string | Date }>;
    const ranAt = rows.map((r) => (r.ran_at instanceof Date ? r.ran_at : new Date(r.ran_at)));
    return computeQuotaDecision({
      ranAt,
      now: new Date(),
      limit: PROPOSAL_RERUN_LIMIT,
      windowHours: PROPOSAL_RERUN_WINDOW_HOURS,
    });
  } catch (err) {
    console.warn("[proposal-rate-limit:check_failed]", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail-open. See module header.
    return { allowed: true, remaining: PROPOSAL_RERUN_LIMIT, resetAt: null };
  }
}

/**
 * Append a re-run row. Called by the route handlers IMMEDIATELY before
 * invoking generation (not after) so simultaneous-trigger races don't
 * blow past the cap. Failures here are non-fatal — a missed record only
 * costs the user one quota slot.
 */
export async function recordRerun(args: { userId: number; workOrderId: number }): Promise<void> {
  try {
    await sql`
      INSERT INTO proposal_rerun_log (user_id, work_order_id)
      VALUES (${args.userId}, ${args.workOrderId})
    `;
  } catch (err) {
    console.warn("[proposal-rate-limit:record_failed]", {
      userId: args.userId,
      workOrderId: args.workOrderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Standard 429 response body used by both proposal-draft route handlers
 * when checkRerunQuota returns allowed=false. The shape is consumed by
 * the dashboard's re-run button which surfaces the next_allowed_at to
 * the user.
 */
export function rateLimitedResponseBody(decision: RateLimitDecision): {
  error: "rate_limit_exceeded";
  message: string;
  limit: number;
  window_hours: number;
  next_allowed_at: string | null;
} {
  const resetIso = decision.resetAt?.toISOString() ?? null;
  const resetHuman = decision.resetAt
    ? `${decision.resetAt.toUTCString()}`
    : "in less than 24 hours";
  return {
    error: "rate_limit_exceeded",
    message: `You've used the ${PROPOSAL_RERUN_LIMIT} re-runs / ${PROPOSAL_RERUN_WINDOW_HOURS}h cap on the proposal-draft plan. Next slot available at ${resetHuman}.`,
    limit: PROPOSAL_RERUN_LIMIT,
    window_hours: PROPOSAL_RERUN_WINDOW_HOURS,
    next_allowed_at: resetIso,
  };
}
