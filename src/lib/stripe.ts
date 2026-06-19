import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    // No apiVersion pin: let the SDK use the version it ships with so we never
    // silently break when the account default and a hardcoded date diverge.
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}

export const PRICE_MAP: Record<string, { tier: string; name: string }> = {
  [process.env.STRIPE_PRICE_TENDER_INTELLIGENCE || "price_tender_intel"]: {
    tier: "tender-intelligence",
    name: "Tender Intelligence",
  },
  [process.env.STRIPE_PRICE_SUBMISSION_PACKAGE || "price_submission_pkg"]: {
    tier: "submission-package",
    name: "Submission Package",
  },
  [process.env.STRIPE_PRICE_STRATEGIC_PARTNERSHIP || "price_strategic"]: {
    tier: "strategic-partnership",
    name: "Strategic Partnership",
  },
  // PR-L (2026-05-23): annual dashboard access — single Stripe product
  // with two prices ($99/year regular + $49/year founding-100). Both map
  // to the same tier slug "annual-access" so the webhook flips the
  // user's subscription_status to active regardless of which price they
  // purchased. Founding offer is enforced by which price the user picks,
  // not by tier logic.
  [process.env.STRIPE_PRICE_ANNUAL_ACCESS_99 || "price_annual_access_99_placeholder"]: {
    tier: "annual-access",
    name: "Annual Dashboard Access",
  },
  [process.env.STRIPE_PRICE_ANNUAL_ACCESS_49 || "price_annual_access_49_placeholder"]: {
    tier: "annual-access",
    name: "Annual Dashboard Access — Founding 100",
  },
};

export function tierFromPriceId(priceId: string): string | null {
  return PRICE_MAP[priceId]?.tier ?? null;
}
// NOTE: the legacy hosted-redirect checkout helpers (createCheckoutUrl →
// /api/subscriptions, and /api/proposals/checkout) were removed in the
// 2026-06-19 checkout consolidation. All card payments now flow through the
// single embedded path: /api/pay/checkout, mounted by the shared CheckoutCard
// (src/components/checkout/CheckoutCard.tsx).

/**
 * Stripe marks a $0 checkout — a 100%-off promotion code (e.g. FREETEST) or a
 * fully-covered trial — as `"no_payment_required"`, not `"paid"`. Both mean
 * "nothing left to collect", so fulfillment/gating must treat them identically;
 * otherwise a fully-discounted order completes but never fulfills and shows as
 * unpaid. (The first-proposal-free credit sidesteps this by synthesizing a
 * `"paid"` session — see src/lib/free-submission.ts.)
 */
export function isSettledPayment(status: string | null | undefined): boolean {
  return status === "paid" || status === "no_payment_required";
}
