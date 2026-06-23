/* Bid/no-bid monthly cap — the freemium lever.
 *
 * The instant bid/no-bid verdict (the Paste flow) is free, but free accounts are
 * capped at BID_NO_BID_FREE_MONTHLY verdicts per calendar month; the Pro
 * subscription (and the 30-day trial) makes it unlimited. Two surfaces consume a
 * credit — the free-text/URL path (/api/dashboard/paste-analyze) and the
 * match-seeded path (/api/dashboard/bid-no-bid/consume) — so the count lives here
 * in one shared helper instead of being duplicated per route.
 *
 * Pro is decided by evaluateAccess().hasAccess (admin · active sub · Stripe
 * trial · inside the 30-day platform trial), so unlimited bid/no-bid is part of
 * the same Pro entitlement as the vault and the readiness Navigator. Usage rows
 * are only written for capped (non-Pro) users — Pro never records, so the table
 * stays small. All reads degrade to "allow" on a DB hiccup: a metering blip must
 * never block a paying-adjacent action. */

import { sql } from "@/lib/db";
import { evaluateAccess } from "@/lib/access";
import { BID_NO_BID_FREE_MONTHLY } from "@/lib/workbench/pricing";
import type { User } from "@/lib/types";

export interface BidNoBidUsage {
  unlimited: boolean;
  used: number;
  limit: number;
  remaining: number;
}

let schemaEnsured = false;
/** Idempotent self-heal so the first request after deploy doesn't 500 against an
 *  un-migrated DB (mirrors the other ensure-helpers; also lives in migrate.mjs). */
export async function ensureBidNoBidUsageSchema(): Promise<void> {
  if (schemaEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS bid_no_bid_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_bid_no_bid_usage_user_month
      ON bid_no_bid_usage (user_id, created_at)
  `;
  schemaEnsured = true;
}

function isPro(user: User): boolean {
  return evaluateAccess(user).hasAccess;
}

async function countThisMonth(userId: number): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM bid_no_bid_usage
    WHERE user_id = ${userId} AND created_at >= date_trunc('month', now())
  `;
  return (rows[0]?.n as number) ?? 0;
}

function proUsage(): BidNoBidUsage {
  return { unlimited: true, used: 0, limit: BID_NO_BID_FREE_MONTHLY, remaining: BID_NO_BID_FREE_MONTHLY };
}

/** Read-only snapshot for display (sidebar hint, Paste counter, workbench
 *  access). Never throws — empties to a full allowance on failure. */
export async function getBidNoBidUsage(user: User): Promise<BidNoBidUsage> {
  if (isPro(user)) return proUsage();
  const limit = BID_NO_BID_FREE_MONTHLY;
  try {
    await ensureBidNoBidUsageSchema();
    const used = await countThisMonth(user.id);
    return { unlimited: false, used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    console.warn("[tp:bid_no_bid:usage_read_failed]", {
      userId: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { unlimited: false, used: 0, limit, remaining: limit };
  }
}

/** True when this user may run another instant verdict right now. Pro is always
 *  allowed; free is allowed while under the monthly cap. Callers should record a
 *  use only on SUCCESS (recordBidNoBidUse) so a failed analysis isn't charged. */
export async function canRunBidNoBid(user: User): Promise<{ allowed: boolean; usage: BidNoBidUsage }> {
  const usage = await getBidNoBidUsage(user);
  return { allowed: usage.unlimited || usage.remaining > 0, usage };
}

/** Record one consumed free verdict (no-op for Pro). Returns the post-write
 *  snapshot for the UI. Best-effort: a failed insert returns the pre-write
 *  snapshot rather than throwing — we'd rather under-count than block the user. */
export async function recordBidNoBidUse(user: User): Promise<BidNoBidUsage> {
  if (isPro(user)) return proUsage();
  const limit = BID_NO_BID_FREE_MONTHLY;
  try {
    await ensureBidNoBidUsageSchema();
    await sql`INSERT INTO bid_no_bid_usage (user_id) VALUES (${user.id})`;
    const used = await countThisMonth(user.id);
    return { unlimited: false, used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    console.warn("[tp:bid_no_bid:usage_record_failed]", {
      userId: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { unlimited: false, used: 0, limit, remaining: limit };
  }
}

/** Shared 402 body for an exhausted free allowance. */
export function bidNoBidLimitResponse(usage: BidNoBidUsage) {
  return {
    error: `You've used all ${usage.limit} free bid/no-bid verdicts this month. Subscribe for unlimited.`,
    code: "BID_NO_BID_LIMIT" as const,
    usage,
    upgradeUrl: "/pay?plan=sub-annual",
  };
}
