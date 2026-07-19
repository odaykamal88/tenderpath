/* First-proposal-free credit.
 *
 * Trial users get their first proposal submission (the $-per-submission
 * "proposal-draft" product) fulfilled without payment — the promise the
 * landing pricing card and the Submissions screen advertise. The credit is:
 *
 *   • per account, once (tracked by users.free_submission_used_at);
 *   • gated to trial users (evaluateAccess().isTrialing) so it's a genuine
 *     "welcome" offer, not a retroactive freebie for long-time payers;
 *   • consumed atomically at the proposal commission moment, then the work
 *     order is fulfilled through the SAME seam a Stripe payment uses
 *     (createWorkOrderFromCheckout) — so gating, emails and auto-generation
 *     all behave identically to a paid order.
 *
 * Schema lives in BOTH scripts/migrate.mjs and ensureFreeSubmissionSchema()
 * below (launch-discipline rule 5: migrate isn't auto-run on deploy). */

import type Stripe from "stripe";
import { sql } from "@/lib/db";
import type { User } from "@/lib/types";
import { evaluateAccess } from "@/lib/access";
import { createWorkOrderFromCheckout } from "@/lib/work-orders";
import { ensurePaymentIntegritySchema } from "@/lib/payment-integrity";
import { PROPOSAL_PLAN } from "@/lib/proposal-package/types";
import { COMMERCE_ENABLED } from "@/lib/commerce";

let ensurePromise: Promise<void> | null = null;

/** Idempotent runtime self-heal for the two users columns. Mirrors migrate.mjs. */
export async function ensureFreeSubmissionSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_submission_used_at TIMESTAMPTZ`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_submission_used_work_order_id INTEGER`;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

export interface FreeSubmissionStatus {
  /** True when this account can still redeem its one free proposal submission. */
  eligible: boolean;
  /** ISO timestamp of when the credit was consumed, or null if unused. */
  usedAt: string | null;
}

/** The free credit applies only to the proposal-draft submission product. */
export const FREE_SUBMISSION_PLAN = PROPOSAL_PLAN; // "proposal-draft"

/** Eligibility = an unused credit on an invited pilot account, or an unused
 * credit on a trial account once commerce is enabled. Public registration is
 * closed during the pilot, so account access is the founder-issued grant. */
export async function getFreeSubmissionStatus(user: User): Promise<FreeSubmissionStatus> {
  try {
    await ensureFreeSubmissionSchema();
    const rows = await sql`
      SELECT free_submission_used_at
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;
    const usedAtRaw = rows[0]?.free_submission_used_at as string | Date | null | undefined;
    const usedAt = usedAtRaw ? new Date(usedAtRaw).toISOString() : null;
    const eligible = !usedAt && (!COMMERCE_ENABLED || evaluateAccess(user).isTrialing);
    return { eligible, usedAt };
  } catch (err) {
    // Fail closed: on any error the user simply pays normally — never a free
    // fulfillment we can't account for.
    console.error("[tp:free_submission:status_failed]", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { eligible: false, usedAt: null };
  }
}

export interface ConsumeFreeSubmissionInput {
  user: User;
  workOrderId: number;
  /** Optional metadata threaded into the fulfilled work order. */
  pipelineItemId?: string | number | null;
  tenderTitle?: string | null;
  agency?: string | null;
  /** Where to land after a successful free fulfillment (relative). Defaults to
   *  the work-order page; the submissions workflow sends users back to the
   *  Submissions page where the live order takes over. */
  successRedirect?: string;
}

export interface ConsumeFreeSubmissionResult {
  applied: boolean;
  reason?: "not_eligible" | "already_used" | "fulfillment_failed";
  /** Where to send the user once the free proposal is fulfilling. Relative. */
  redirectUrl?: string;
}

/**
 * Atomically claim the free credit and fulfil the proposal work order for $0.
 * Returns { applied:false } when the user isn't trial-eligible or the credit
 * was already used — the caller then falls through to normal paid checkout.
 *
 * The claim's `WHERE free_submission_used_at IS NULL` guard makes a concurrent
 * double-click claim exactly once. If fulfilment throws, the claim is rolled
 * back so the credit isn't silently burned.
 */
export async function consumeFreeSubmissionForProposal(
  input: ConsumeFreeSubmissionInput,
): Promise<ConsumeFreeSubmissionResult> {
  const { user, workOrderId } = input;

  // Re-check eligibility server-side (never trust the caller). During the
  // invite-only pilot, having an account is itself the founder-issued grant;
  // once commerce is live, only trial users receive this welcome credit.
  if (COMMERCE_ENABLED && !evaluateAccess(user).isTrialing) {
    return { applied: false, reason: "not_eligible" };
  }

  await ensureFreeSubmissionSchema();

  // Atomic claim — only the first concurrent request flips used_at.
  const claimed = await sql`
    UPDATE users
    SET free_submission_used_at = NOW(),
        free_submission_used_work_order_id = ${workOrderId}
    WHERE id = ${user.id}
      AND free_submission_used_at IS NULL
    RETURNING id
  `;
  if (!claimed.length) {
    // Already redeemed (or a concurrent request won the race).
    return { applied: false, reason: "already_used" };
  }

  try {
    await ensurePaymentIntegritySchema();

    // A synthetic, already-"paid" $0 checkout session so the proposal flows
    // through the exact same fulfilment path Stripe payment uses — gate
    // evaluation, email suppression, and after() auto-generation included.
    // Stable id keeps fulfilment idempotent on retry.
    const syntheticSession = {
      id: `free-submission:wo:${workOrderId}`,
      customer: null,
      customer_email: user.email,
      payment_status: "paid",
      amount_total: 0,
      currency: "usd",
      metadata: {
        plan: FREE_SUBMISSION_PLAN,
        service: "proposal",
        userId: String(user.id),
        work_order_id: String(workOrderId),
        pipeline_item_id: input.pipelineItemId != null ? String(input.pipelineItemId) : "",
        tender_title: input.tenderTitle ?? "",
        agency: input.agency ?? "",
        free_submission: "1",
      },
    } as unknown as Stripe.Checkout.Session;

    // Record a $0 line in purchase history so the work-orders/billing views
    // show the redemption rather than a mysterious unpaid-but-fulfilled order.
    // Write it before fulfillment: if fulfillment fails we can delete this
    // exact synthetic row and safely return the customer's credit. The partial
    // unique-index predicate must be repeated on ON CONFLICT for Postgres to
    // recognize purchase_logs_stripe_session_id_unique.
    await sql`
      INSERT INTO purchase_logs (plan, stripe_session_id, stripe_customer_id, user_id, amount_cents, currency)
      VALUES (${FREE_SUBMISSION_PLAN}, ${`free-submission:wo:${workOrderId}`}, NULL, ${user.id}, 0, 'usd')
      ON CONFLICT (stripe_session_id)
        WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> ''
      DO NOTHING
    `;

    await createWorkOrderFromCheckout(syntheticSession, user.id);

    console.info("[tp:free_submission:redeemed]", { userId: user.id, workOrderId });
    return {
      applied: true,
      redirectUrl: input.successRedirect ?? `/dashboard/work-orders/${workOrderId}?paid=1&free=1`,
    };
  } catch (err) {
    // Roll the claim back so the user keeps their credit and can pay or retry.
    await sql`
      DELETE FROM purchase_logs
      WHERE stripe_session_id = ${`free-submission:wo:${workOrderId}`}
        AND user_id = ${user.id}
        AND amount_cents = 0
    `.catch(() => {});
    await sql`
      UPDATE users
      SET free_submission_used_at = NULL,
          free_submission_used_work_order_id = NULL
      WHERE id = ${user.id}
        AND free_submission_used_work_order_id = ${workOrderId}
    `.catch(() => {});
    console.error("[tp:free_submission:fulfill_failed]", {
      userId: user.id,
      workOrderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { applied: false, reason: "fulfillment_failed" };
  }
}
