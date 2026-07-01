/* Bundled-EOI monthly quota (P1.2 — the subscription's included EOI).
 *
 * Mirrors the bid/no-bid monthly-cap pattern (src/lib/bid-no-bid-usage.ts):
 * append-only usage rows, calendar-month boundary via date_trunc('month'), a
 * self-healing schema, record-on-success. The difference: a bundled EOI is a
 * REAL-cost deliverable (~$149), so the read fails SAFE — a metering blip routes
 * the subscriber to normal checkout rather than granting an unbudgeted free EOI
 * (bid/no-bid, a cheap read, fails open instead).
 *
 * Eligibility = a real subscription (isPaidSubscriber), not the free platform
 * trial. During the invite-only beta (COMMERCE_ENABLED=false) this path is never
 * reached — the commission route marks every submission $0 upstream — so this is
 * built ready and goes live when commerce flips on. */

import { sql } from "@/lib/db";
import type { User } from "@/lib/types";
import { SUB_BUNDLED_EOI_PER_MONTH } from "@/lib/workbench/pricing";
import { isPaidSubscriber } from "./entitlements";

export interface BundledEoiUsage {
  /** Whether this user is on a plan that bundles EOIs at all. */
  eligible: boolean;
  used: number;
  limit: number;
  remaining: number;
}

const INELIGIBLE: BundledEoiUsage = { eligible: false, used: 0, limit: 0, remaining: 0 };

let schemaEnsured = false;
/** Idempotent self-heal (mirrors the other ensure-helpers; also in migrate.mjs). */
export async function ensureEoiBundledUsageSchema(): Promise<void> {
  if (schemaEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS eoi_bundled_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_eoi_bundled_usage_user_month
      ON eoi_bundled_usage (user_id, created_at)
  `;
  schemaEnsured = true;
}

async function countThisMonth(userId: number): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM eoi_bundled_usage
    WHERE user_id = ${userId} AND created_at >= date_trunc('month', now())
  `;
  return (rows[0]?.n as number) ?? 0;
}

/** Read-only snapshot for display + gating. Fails SAFE to ineligible (→ checkout). */
export async function getBundledEoiUsage(user: User): Promise<BundledEoiUsage> {
  if (!isPaidSubscriber(user)) return INELIGIBLE;
  const limit = SUB_BUNDLED_EOI_PER_MONTH;
  try {
    await ensureEoiBundledUsageSchema();
    const used = await countThisMonth(user.id);
    return { eligible: true, used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    console.warn("[tp:eoi_bundled:usage_read_failed]", {
      userId: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return INELIGIBLE; // fail safe: don't hand out an unbudgeted free EOI on a glitch
  }
}

/** True when this subscriber may claim a bundled EOI right now. Record on success. */
export async function canUseBundledEoi(user: User): Promise<{ allowed: boolean; usage: BundledEoiUsage }> {
  const usage = await getBundledEoiUsage(user);
  return { allowed: usage.eligible && usage.remaining > 0, usage };
}

/** Record one consumed bundled EOI. Best-effort after we've committed to fulfil:
 *  a failed insert under-counts (the subscriber might get one extra) rather than
 *  blocking an already-placed order. */
export async function recordBundledEoiUse(user: User): Promise<BundledEoiUsage> {
  if (!isPaidSubscriber(user)) return INELIGIBLE;
  const limit = SUB_BUNDLED_EOI_PER_MONTH;
  try {
    await ensureEoiBundledUsageSchema();
    await sql`INSERT INTO eoi_bundled_usage (user_id) VALUES (${user.id})`;
    const used = await countThisMonth(user.id);
    return { eligible: true, used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    console.warn("[tp:eoi_bundled:usage_record_failed]", {
      userId: user.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { eligible: true, used: limit, limit, remaining: 0 };
  }
}
