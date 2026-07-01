/**
 * Calibration corpus writer (P0.2). Append-only labeled corpus; idempotent by
 * dedup_key so re-generating an artifact refreshes the row instead of duplicating
 * it. Never feeds the scoring engine (see schema.ts). Every write is owner-scoped.
 */

import { sql } from "@/lib/db";
import { ensureCalibrationLogSchema } from "./schema";

export type CalibrationSource = "network_artifact" | "bid_analysis" | "submission" | "proposal_review";
export type CalibrationEventType = "match" | "outcome";
export type VendorAction = "bid" | "no_bid" | "pending";
export type CalibrationOutcomeState =
  | "won"
  | "lost"
  | "shortlisted"
  | "disqualified"
  | "withdrawn"
  | "pending";

export interface CalibrationEvent {
  /** Owner — supply exactly one. A missing owner is rejected (schema CHECK + guard). */
  userId?: number | null;
  networkCompanyId?: number | null;

  source: CalibrationSource;
  eventType?: CalibrationEventType; // defaults to 'match'

  tenderId?: number | null;
  networkMatchId?: number | null;
  workOrderId?: number | null;
  submissionOrderId?: number | null;

  // Denormalized tender snapshot.
  agency?: string | null;
  tenderType?: string | null;
  valueBand?: string | null;
  country?: string | null;

  // System output at capture time.
  systemOutput?: Record<string, unknown>;

  vendorAction?: VendorAction | null;
  reviewDisqualifierCaught?: boolean | null;
  founderFitReasoning?: string | null;

  /** Stable idempotency key, e.g. `network:<companyId>:<tenderId>`. */
  dedupKey: string;
}

/** Bucket a free-text estimated value into a coarse band for the corpus. */
export function valueBand(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/[, ]/g, "").toLowerCase();
  if (!s) return "unknown";
  // Pull the first number, honouring k/m/bn suffixes.
  const m = /(\d+(?:\.\d+)?)\s*(k|m|bn|b|million|thousand)?/.exec(s);
  if (!m) return "unknown";
  let n = parseFloat(m[1]);
  const suffix = m[2] ?? "";
  if (suffix === "k" || suffix === "thousand") n *= 1_000;
  else if (suffix === "m" || suffix === "million") n *= 1_000_000;
  else if (suffix === "bn" || suffix === "b") n *= 1_000_000_000;
  if (!Number.isFinite(n) || n <= 0) return "unknown";
  if (n < 50_000) return "<50k";
  if (n < 250_000) return "50k-250k";
  if (n < 1_000_000) return "250k-1m";
  return ">1m";
}

/**
 * Upsert one corpus row. Idempotent on dedup_key: a repeat capture refreshes the
 * system snapshot and updated_at but PRESERVES any resolved outcome (the label we
 * care about most). Owner-scoping is enforced here and by the schema CHECK.
 */
export async function recordCalibrationEvent(event: CalibrationEvent): Promise<void> {
  const userId = event.userId ?? null;
  const networkCompanyId = event.networkCompanyId ?? null;
  if (userId == null && networkCompanyId == null) {
    // Never write an unowned corpus row — fail loud rather than orphan data.
    console.warn("[calibration:record:no_owner]", { source: event.source, dedupKey: event.dedupKey });
    return;
  }

  await ensureCalibrationLogSchema();

  try {
    await sql`
      INSERT INTO calibration_log (
        user_id, network_company_id, source, event_type,
        tender_id, network_match_id, work_order_id, submission_order_id,
        agency, tender_type, value_band, country,
        system_output, vendor_action, review_disqualifier_caught, founder_fit_reasoning,
        dedup_key
      ) VALUES (
        ${userId}, ${networkCompanyId}, ${event.source}, ${event.eventType ?? "match"},
        ${event.tenderId ?? null}, ${event.networkMatchId ?? null}, ${event.workOrderId ?? null}, ${event.submissionOrderId ?? null},
        ${event.agency ?? null}, ${event.tenderType ?? null}, ${event.valueBand ?? null}, ${event.country ?? null},
        ${JSON.stringify(event.systemOutput ?? {})}::jsonb,
        ${event.vendorAction ?? null}, ${event.reviewDisqualifierCaught ?? null}, ${event.founderFitReasoning ?? null},
        ${event.dedupKey}
      )
      ON CONFLICT (dedup_key) DO UPDATE SET
        source = EXCLUDED.source,
        event_type = EXCLUDED.event_type,
        tender_id = EXCLUDED.tender_id,
        network_match_id = EXCLUDED.network_match_id,
        agency = EXCLUDED.agency,
        tender_type = EXCLUDED.tender_type,
        value_band = EXCLUDED.value_band,
        country = EXCLUDED.country,
        system_output = EXCLUDED.system_output,
        vendor_action = COALESCE(EXCLUDED.vendor_action, calibration_log.vendor_action),
        founder_fit_reasoning = COALESCE(EXCLUDED.founder_fit_reasoning, calibration_log.founder_fit_reasoning),
        updated_at = NOW()
    `;
  } catch (err) {
    // Calibration logging must never break the user-facing flow it observes.
    console.error("[calibration:record:failed]", {
      source: event.source,
      dedupKey: event.dedupKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Batch helper — records many events, isolating per-row failures. */
export async function recordCalibrationEvents(events: CalibrationEvent[]): Promise<number> {
  let written = 0;
  for (const e of events) {
    await recordCalibrationEvent(e);
    written += 1;
  }
  return written;
}

/**
 * Resolve the outcome label on an existing corpus row (won/lost/…). Called later,
 * when the real result is known — this is what makes a row training-grade.
 */
export async function resolveCalibrationOutcome(
  dedupKey: string,
  outcome: { state: CalibrationOutcomeState; decidedAt?: Date | null; notes?: string | null; vendorAction?: VendorAction | null },
): Promise<void> {
  await ensureCalibrationLogSchema();
  try {
    const decidedAtIso = outcome.decidedAt ? outcome.decidedAt.toISOString() : null;
    await sql`
      UPDATE calibration_log SET
        event_type = 'outcome',
        outcome_state = ${outcome.state},
        outcome_decided_at = COALESCE(${decidedAtIso}::timestamptz, NOW()),
        outcome_notes = ${outcome.notes ?? null},
        vendor_action = COALESCE(${outcome.vendorAction ?? null}, vendor_action),
        updated_at = NOW()
      WHERE dedup_key = ${dedupKey}
    `;
  } catch (err) {
    console.error("[calibration:resolve:failed]", {
      dedupKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
