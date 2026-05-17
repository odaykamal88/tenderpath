import { sql } from "@/lib/db";

/**
 * Sprint 18. Block paid checkout when the underlying tender's deadline has
 * already passed (or is within the buffer window where a Bid/No-Bid or
 * Proposal Draft cannot realistically be delivered in time).
 *
 * Without this guard, a marketing-blitz visitor can pay $39 or $299 for a
 * service tied to a tender that closed last week — a guaranteed refund and
 * trust-damage scenario. The cost of the lookup is one indexed SELECT per
 * checkout, which is negligible next to the Stripe round-trip.
 */

export interface DeadlineGuardArgs {
  /** Pipeline item id when the purchase is anchored on a matched tender. */
  pipelineItemId?: number | null;
  /** Work order id; falls back to its pipeline_item_id when present. */
  workOrderId?: number | null;
  /** Plan slug — used for tailored error copy + buffer hours. */
  plan: string;
}

export interface DeadlineGuardError {
  code: "tender_deadline_passed" | "tender_deadline_too_close";
  message: string;
  deadline_iso: string;
  hours_remaining: number;
}

/** Minimum hours we need between checkout and the tender's deadline for the
 *  service to be deliverable. Proposal Draft is a 48-72h job; Bid/No-Bid is
 *  short. Roster has no per-tender deadline so it's never gated by this. */
function bufferHours(plan: string): number {
  if (plan === "proposal-draft") return 72;
  if (plan === "bid-no-bid") return 12;
  return 0;
}

interface DeadlineRow {
  pipeline_deadline: Date | null;
  tender_deadline: Date | null;
}

async function lookupDeadline(args: DeadlineGuardArgs): Promise<Date | null> {
  let pipelineItemId = args.pipelineItemId ?? null;
  if (!pipelineItemId && args.workOrderId) {
    const rows = await sql`
      SELECT pipeline_item_id FROM work_orders WHERE id = ${args.workOrderId} LIMIT 1
    ` as unknown as Array<{ pipeline_item_id: number | null }>;
    pipelineItemId = rows[0]?.pipeline_item_id ?? null;
  }
  if (!pipelineItemId) return null;
  const rows = await sql`
    SELECT pi.tender_deadline AS pipeline_deadline,
           t.deadline         AS tender_deadline
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    WHERE pi.id = ${pipelineItemId}
    LIMIT 1
  ` as unknown as DeadlineRow[];
  const row = rows[0];
  if (!row) return null;
  // Prefer the authoritative tenders.deadline (TIMESTAMPTZ) over the
  // denormalised pipeline_items.tender_deadline (DATE) when both exist.
  if (row.tender_deadline) return new Date(row.tender_deadline);
  if (row.pipeline_deadline) return new Date(row.pipeline_deadline);
  return null;
}

/** Returns null when the tender is still live (or unknown — we don't block on
 *  missing data). Returns a structured error otherwise so the route can map
 *  it to a 409 with a human-readable message. */
export async function assertTenderDeadlineIsLive(
  args: DeadlineGuardArgs,
): Promise<DeadlineGuardError | null> {
  const deadline = await lookupDeadline(args);
  if (!deadline) return null;
  const now = Date.now();
  const ms = deadline.getTime() - now;
  const hoursRemaining = Math.round(ms / (1000 * 60 * 60));
  const deadlineIso = deadline.toISOString();
  if (ms <= 0) {
    return {
      code: "tender_deadline_passed",
      message: `This tender's deadline (${deadlineIso.slice(0, 10)}) has already passed. Buying this service won't help — pick a tender that's still open from your pipeline.`,
      deadline_iso: deadlineIso,
      hours_remaining: hoursRemaining,
    };
  }
  const buffer = bufferHours(args.plan);
  if (buffer > 0 && hoursRemaining < buffer) {
    return {
      code: "tender_deadline_too_close",
      message: `This tender closes in ~${hoursRemaining}h. We need at least ${buffer}h to deliver a ${args.plan === "proposal-draft" ? "complete proposal draft" : "Bid/No-Bid analysis"} you can act on. Email info@tenderpath.me if you want to proceed anyway.`,
      deadline_iso: deadlineIso,
      hours_remaining: hoursRemaining,
    };
  }
  return null;
}
