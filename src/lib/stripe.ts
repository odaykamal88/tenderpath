import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    stripeInstance = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
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
};

export function tierFromPriceId(priceId: string): string | null {
  return PRICE_MAP[priceId]?.tier ?? null;
}

export function createCheckoutUrl(tier: string, userEmail: string): string {
  const priceEnvMap: Record<string, string> = {
    "tender-intelligence": "STRIPE_PRICE_TENDER_INTELLIGENCE",
    "submission-package": "STRIPE_PRICE_SUBMISSION_PACKAGE",
    "strategic-partnership": "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
  };

  const envKey = priceEnvMap[tier];
  if (!envKey) throw new Error(`Unknown tier: ${tier}`);

  const priceId = process.env[envKey];
  if (!priceId) throw new Error(`${envKey} is not set`);

  return `/api/subscriptions/checkout?price=${priceId}&email=${encodeURIComponent(userEmail)}`;
}
