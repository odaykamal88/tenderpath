/* Workbench pricing model — the redesign's per-submission + subscription rates.
 *
 * SOURCE OF TRUTH for the Workbench UI (Submissions screen, Paste upsell,
 * Subscribe modal, sidebar trial card). Adopted from the design handoff per
 * product decision 2026-06-08 ("adopt design prices").
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ STRIPE SETUP REQUIRED before per-type checkout + the new subscription  │
 * │ can charge correctly. Until the price IDs below are set in env, the     │
 * │ Workbench routes commission/subscribe CTAs to the EXISTING working      │
 * │ flows (/dashboard/services/proposal, /pay?plan=annual-access) and never │
 * │ charges an amount that doesn't match what it displays.                  │
 * │                                                                         │
 * │ Create these Stripe Products/Prices and wire the env vars:              │
 * │   STRIPE_PRICE_SUBMISSION_EOI   → one-time  $149                        │
 * │   STRIPE_PRICE_SUBMISSION_RFQ   → one-time  $199                        │
 * │   STRIPE_PRICE_SUBMISSION_ITB   → one-time  $299                        │
 * │   STRIPE_PRICE_SUBMISSION_RFP   → one-time  $349                        │
 * │   STRIPE_PRICE_SUB_MONTHLY      → recurring $49/mo  (30-day trial)      │
 * │   STRIPE_PRICE_SUB_ANNUAL       → recurring $324/yr (30-day trial)      │
 * │ Then extend /api/pay/checkout to resolve these slugs (Phase 2).         │
 * └──────────────────────────────────────────────────────────────────────┘ */

export type SubmissionCode = "EOI" | "RFQ" | "ITB" | "RFP";

export interface SubmissionType {
  code: SubmissionCode;
  name: string;
  /** Price in whole USD. */
  price: number;
  turnaround: string;
  complexity: "Light" | "Standard" | "Full";
  desc: string;
  /** Env var holding the Stripe one-time Price ID. Unset → not yet sellable. */
  stripePriceEnv: string;
}

export const SUBMISSION_TYPES: SubmissionType[] = [
  {
    code: "EOI",
    name: "Expression of Interest",
    price: 149,
    turnaround: "< 1 hr",
    complexity: "Light",
    desc: "Capability statement, eligibility mapping, and a tailored cover letter.",
    stripePriceEnv: "STRIPE_PRICE_SUBMISSION_EOI",
  },
  {
    code: "RFQ",
    name: "Request for Quotation",
    price: 199,
    turnaround: "< 1 hr",
    complexity: "Standard",
    desc: "Priced response, compliance matrix, and delivery schedule.",
    stripePriceEnv: "STRIPE_PRICE_SUBMISSION_RFQ",
  },
  {
    code: "ITB",
    name: "Invitation to Bid",
    price: 299,
    turnaround: "~1 hr",
    complexity: "Full",
    desc: "Technical conformity response and bill-of-quantities pricing.",
    stripePriceEnv: "STRIPE_PRICE_SUBMISSION_ITB",
  },
  {
    code: "RFP",
    name: "Request for Proposal",
    price: 349,
    turnaround: "~1 hr",
    complexity: "Full",
    desc: "Full technical + financial proposal, compliance-mapped to the scoring matrix.",
    stripePriceEnv: "STRIPE_PRICE_SUBMISSION_RFP",
  },
];

export function submissionType(code: SubmissionCode): SubmissionType {
  return SUBMISSION_TYPES.find((t) => t.code === code) ?? SUBMISSION_TYPES[3];
}

/** Detects the most likely submission type from a tender's opportunity type or
 *  title. Used to default the Paste upsell + price to the right product. */
export function detectSubmissionType(text: string | null | undefined): SubmissionCode {
  const s = (text ?? "").toLowerCase();
  if (/\beoi\b|expression of interest/.test(s)) return "EOI";
  if (/\brfq\b|quotation|quote/.test(s)) return "RFQ";
  if (/\bitb\b|invitation to bid|goods|works|supply/.test(s)) return "ITB";
  if (/\brfp\b|proposal|consultanc/.test(s)) return "RFP";
  return "RFP";
}

export interface SubscriptionPlan {
  cycle: "monthly" | "annual";
  /** Price per cycle in whole USD. */
  price: number;
  /** Effective monthly equivalent, for the "$27/mo" sub-label on annual. */
  perMonth: number;
  billedNote: string;
  stripePriceEnv: string;
}

// Annual is 45% off the monthly run-rate: $49 × 12 = $588 → $324/yr ($27/mo).
export const SUBSCRIPTION_PLANS: Record<"monthly" | "annual", SubscriptionPlan> = {
  monthly: {
    cycle: "monthly",
    price: 49,
    perMonth: 49,
    billedNote: "Billed monthly · cancel anytime",
    stripePriceEnv: "STRIPE_PRICE_SUB_MONTHLY",
  },
  annual: {
    cycle: "annual",
    price: 324,
    perMonth: 27,
    billedNote: "Billed yearly · save 45%",
    stripePriceEnv: "STRIPE_PRICE_SUB_ANNUAL",
  },
};

export const ANNUAL_SAVING_PCT = 45;

/** Free-trial window (matches src/lib/access.ts TRIAL_DAYS). No card required. */
export const TRIAL_DAYS = 30;

/** Resolves a configured Stripe price id for a submission type, or null when
 *  the env var is unset (→ the UI must fall back to an existing working flow
 *  rather than charge a mismatched amount). */
export function submissionPriceId(code: SubmissionCode): string | null {
  const t = submissionType(code);
  return process.env[t.stripePriceEnv] ?? null;
}
