/* drafting-run.ts — the paid-submission drafting run.
 *
 * Fires post-response (after()) once a submission order is paid. Writes the
 * prose slots, persists them, walks the order intake → drafting → qa → review,
 * and sends the review-ready email — so a paying customer gets a real drafted
 * pack instead of an order that sits in `intake` until someone clicks.
 *
 * Invariants:
 *  · Idempotent. A second call while `generating`, or after `ready`, is a
 *    no-op. Payment already succeeded; drafting must never double-charge
 *    Anthropic or double-send the client email.
 *  · Never blocks delivery. If generation is unavailable (no API key) or fails,
 *    the order still advances and docContent()'s deterministic template stands
 *    in — status records which happened, so it is diagnosable rather than
 *    silent (AGENTS.md: silent no-op is worse than explicit failure).
 *  · Gaps are surfaced, not swallowed. Because release to the client is
 *    automatic, anything the applicant has not evidenced is written into the
 *    event log and the stage note where both ops and the client can see it.
 */

import { sql } from "@/lib/db";
import { applyAdminAction, getOrderForAdmin, OrderStateError } from "./store";
import { generateSubmissionProse, type SubmissionProse } from "./draft-llm";
import { sendSubmissionReviewReadyEmail } from "./notify";
import type { SubmissionGenerationStatus, SubmissionOrder } from "./types";

export interface DraftingRunResult {
  ok: boolean;
  orderId: number;
  status: SubmissionGenerationStatus;
  slotCount: number;
  gapCount: number;
  released: boolean;
  skippedReason?: string;
}

/** A `generating` row older than this is assumed to belong to a lambda that
 *  died mid-run (Vercel caps the function at 300s). Without this, one crashed
 *  run would strand the order in `generating` forever and no retry could ever
 *  claim it — the same failure the proposal engine reaps with
 *  reapStaleGenerating(). Comfortably above the 300s ceiling. */
const STALE_GENERATING_MINUTES = 10;

/** Claim the run. Returns false when another run already holds it, or when the
 *  order has already been drafted — the guard is the UPDATE's WHERE clause, so
 *  two concurrent lambdas cannot both proceed. */
async function claimRun(orderId: number): Promise<boolean> {
  const rows = await sql`
    UPDATE submission_orders
    SET generation_status = 'generating', updated_at = NOW()
    WHERE id = ${orderId}
      AND stage = 'intake'
      AND (
        generation_status IN ('not_started', 'failed')
        OR (
          generation_status = 'generating'
          AND updated_at < NOW() - (${STALE_GENERATING_MINUTES} * INTERVAL '1 minute')
        )
      )
    RETURNING id
  `;
  return rows.length > 0;
}

async function persistProse(
  orderId: number,
  status: SubmissionGenerationStatus,
  prose: SubmissionProse | null,
): Promise<void> {
  await sql`
    UPDATE submission_orders
    SET generation_status = ${status},
        generated_prose = ${prose ? JSON.stringify(prose) : null}::jsonb,
        updated_at = NOW()
    WHERE id = ${orderId}
  `;
}

async function companyFor(userId: number): Promise<{ name: string; email: string | null }> {
  const rows = await sql`
    SELECT email, name, business_name FROM users WHERE id = ${userId} LIMIT 1
  `;
  const u = rows[0] ?? {};
  return {
    name:
      (u.business_name as string | null)?.trim()
      || (u.name as string | null)?.trim()
      || (u.email as string | null)?.trim()
      || "Customer company",
    email: (u.email as string | null) ?? null,
  };
}

/** Advance one ops step, tolerating an order another actor already moved. */
async function advance(
  orderId: number,
  to: "drafting" | "qa" | "review",
): Promise<SubmissionOrder | null> {
  try {
    return await applyAdminAction(orderId, { action: "advance", to });
  } catch (err) {
    if (err instanceof OrderStateError) {
      console.warn("[tp:submissions:draft_run_advance_skipped]", {
        orderId,
        to,
        code: err.code,
      });
      return null;
    }
    throw err;
  }
}

export async function runSubmissionDrafting(orderId: number): Promise<DraftingRunResult> {
  const claimed = await claimRun(orderId);
  if (!claimed) {
    console.info("[tp:submissions:draft_run_not_claimed]", { orderId });
    return { ok: false, orderId, status: "not_started", slotCount: 0, gapCount: 0, released: false, skippedReason: "already_running_or_done" };
  }

  const order = await getOrderForAdmin(orderId);
  if (!order) {
    await persistProse(orderId, "failed", null);
    return { ok: false, orderId, status: "failed", slotCount: 0, gapCount: 0, released: false, skippedReason: "order_not_found" };
  }

  const company = await companyFor(order.userId);
  console.info("[tp:submissions:draft_run_start]", {
    orderId,
    ref: order.ref,
    type: order.type,
    requirements: Array.isArray((order.intakeFields as { tenderRequirements?: { items?: unknown[] } })?.tenderRequirements?.items)
      ? (order.intakeFields as { tenderRequirements: { items: unknown[] } }).tenderRequirements.items.length
      : 0,
  });

  let prose: SubmissionProse | null = null;
  try {
    prose = await generateSubmissionProse({ order, companyName: company.name });
  } catch (err) {
    console.error("[tp:submissions:draft_run_generate_threw]", {
      orderId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const status: SubmissionGenerationStatus = prose ? "ready" : "skipped";
  await persistProse(orderId, status, prose);

  const slotCount = prose ? Object.keys(prose.slots).length : 0;
  const gaps = prose?.gaps ?? [];

  // Walk to the client. Each step re-reads the order, so the qa → review seal
  // picks up the prose persisted above.
  await advance(orderId, "drafting");
  await advance(orderId, "qa");

  if (gaps.length > 0) {
    // Release is automatic, so the client must be able to see what is not
    // evidenced. Recorded before the release note so it sits above it.
    // post_note truncates at 400 chars — clip each gap so the note stays
    // readable instead of being cut mid-sentence.
    const head = `Open evidence gaps (${gaps.length}): `;
    const clipped: string[] = [];
    let budget = 400 - head.length;
    for (const g of gaps) {
      const one = g.length > 110 ? `${g.slice(0, 107)}…` : g;
      if (one.length + 3 > budget) break;
      clipped.push(one);
      budget -= one.length + 3;
    }
    await applyAdminAction(orderId, {
      action: "post_note",
      note: `${head}${clipped.join(" · ")}`,
    }).catch((err) => {
      console.warn("[tp:submissions:draft_run_gap_note_failed]", {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const released = await advance(orderId, "review");

  if (released) {
    try {
      await sendSubmissionReviewReadyEmail(released, company.email);
    } catch (err) {
      console.error("[tp:submissions:draft_run_email_failed]", {
        orderId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.info("[tp:submissions:draft_run_done]", {
    orderId,
    ref: order.ref,
    status,
    slotCount,
    gapCount: gaps.length,
    released: Boolean(released),
  });

  return {
    ok: true,
    orderId,
    status,
    slotCount,
    gapCount: gaps.length,
    released: Boolean(released),
    skippedReason: prose ? undefined : "generation_unavailable",
  };
}
