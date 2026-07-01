/**
 * Subscription entitlements (P1.2). What a subscription includes beyond the
 * free/Pro dashboard split. Today the distinctive entitlement is the bundled
 * EOI/month — "EOI is a subscription feature, not a standalone fee".
 *
 * IMPORTANT (founder hand-off, 2026-07-01): do NOT restructure the $27/$49
 * relationship until n=10. In the current model $27 (annual) and $49 (monthly)
 * are billing cycles of ONE subscription, not two feature tiers — so both bundle
 * the same EOI count (SUB_BUNDLED_EOI_PER_MONTH). A future per-tier split lives
 * here, not scattered across callers.
 */

import type { User } from "@/lib/types";
import { SUB_BUNDLED_EOI_PER_MONTH } from "@/lib/workbench/pricing";

/**
 * A REAL subscriber — a paid active subscription or a Stripe-managed subscription
 * trial. Deliberately distinct from the free 30-day PLATFORM trial (which has a
 * null `subscription_status`): a bundled EOI is a ~$149-value deliverable and
 * should attach to a real subscription, not a free trial. Mirrors the
 * active|trialing branches in evaluateAccess.
 */
export function isPaidSubscriber(user: User): boolean {
  return user.subscription_status === "active" || user.subscription_status === "trialing";
}

export interface SubscriptionEntitlements {
  /** True for a real (paid or Stripe-trial) subscriber. */
  isSubscriber: boolean;
  /** EOIs bundled into the subscription this calendar month (0 when not a subscriber). */
  bundledEoisPerMonth: number;
}

export function subscriptionEntitlements(user: User): SubscriptionEntitlements {
  const isSubscriber = isPaidSubscriber(user);
  return {
    isSubscriber,
    bundledEoisPerMonth: isSubscriber ? SUB_BUNDLED_EOI_PER_MONTH : 0,
  };
}
