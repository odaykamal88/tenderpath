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

export function createCheckoutUrl(tier: string, userEmail: string): string {
  const priceEnvMap: Record<string, string> = {
    "tender-intelligence": "STRIPE_PRICE_TENDER_INTELLIGENCE",
    "submission-package": "STRIPE_PRICE_SUBMISSION_PACKAGE",
    "strategic-partnership": "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
    "annual-access": "STRIPE_PRICE_ANNUAL_ACCESS_99",
  };

  const envKey = priceEnvMap[tier];
  if (!envKey) throw new Error(`Unknown tier: ${tier}`);

  const priceId = process.env[envKey];
  if (!priceId) throw new Error(`${envKey} is not set`);

  return `/api/subscriptions/checkout?price=${priceId}&email=${encodeURIComponent(userEmail)}`;
}
