// Legacy backend slugs → canonical TIERS slugs. The backend still emits
// `TierSlug` (tender-intelligence / submission-package / strategic-partnership)
// for assessment.recommended_tier; the user-facing TIERS array uses the new
// product names. Without this map, any /pay?plan=tender-intelligence URL
// (including the report CTA) hits "Unknown plan" before Stripe loads.
// Audit 2026-05-19 P0 #2.
export const SLUG_ALIASES: Record<string, string> = {
  "tender-intelligence":   "grants-tenders-matching",
  "submission-package":    "proposal-draft",
  "strategic-partnership": "roster-fast-track",
};

// Resolves either a canonical or legacy slug to the canonical form, or null
// if no TIERS entry matches even after aliasing.
export function resolveTierSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const canonical = SLUG_ALIASES[slug] ?? slug;
  return TIERS.some((t) => t.slug === canonical) ? canonical : null;
}

export interface Tier {
  slug: string;
  name: string;
  label: string;
  price: string;
  billingPeriod: string;
  billingNote: string;
  tagline: string;
  description: string;
  features: string[];
  cta: string;
  ctaHref: string;
  featured: boolean;
  // Held back from sale: surfaces present it as "Coming soon" and every
  // purchase path (checkout routes, pay page, service intake, assessment CTAs)
  // refuses to sell it. Fulfillment machinery for already-purchased orders is
  // unaffected. Flip to false / remove to relaunch.
  comingSoon?: boolean;
}

export const TIERS: Tier[] = [
  {
    slug: "bid-no-bid",
    name: "Bid/No-Bid Analyst",
    label: "Per-tender intelligence",
    price: "$39",
    billingPeriod: "/analysis",
    billingNote: "per tender evaluated",
    tagline: "Know whether a tender is worth pursuing — before you spend 30 hours on a proposal.",
    description: "Paste a tender URL or upload the TOR. Get a bid/no-bid recommendation with fit reasoning, gap analysis, and a required-docs checklist.",
    features: [
      "Bid/no-bid recommendation with reasoning",
      "Fit reasoning against tender requirements",
      "Gap analysis against your current profile",
      "Required documents checklist",
      "Estimated effort & timeline",
    ],
    cta: "Analyze this tender",
    // Audit 2026-05-19 P2 #14: tier CTAs deep-link to the matching wizard
    // intent so Step 1's "what do you want to do first?" chip is pre-selected.
    ctaHref: "/assessment?goal=evaluate-tender",
    featured: false,
  },
  {
    slug: "grants-tenders-matching",
    name: "Grants + Tenders Matching",
    label: "Weekly matched digest",
    price: "$49",
    billingPeriod: "/mo",
    billingNote: "cancel anytime",
    tagline: "5–10 AI-matched opportunities scored by fit, every week. Arabic + English.",
    description: "Weekly email digest of the best-matched tenders and grants for your exact profile. AI scores each opportunity by fit. No noise — only what's relevant to you.",
    features: [
      "Weekly digest of 5–10 matched opportunities",
      "AI fit score for each opportunity",
      "UN tenders + international grants",
      "Arabic and English",
      "Deadline alerts & reminders",
      "Cancel anytime",
    ],
    cta: "Get weekly matched tenders & grants",
    ctaHref: "/assessment?goal=track-tenders",
    featured: true,
  },
  {
    slug: "proposal-draft",
    name: "Proposal Draft",
    label: "Per-submission support",
    price: "$299",
    billingPeriod: "/submission",
    billingNote: "per proposal package",
    tagline: "Collapse 30 hours of proposal writing into 3–4 hours of review.",
    description: "Receive an 80% complete technical proposal, financial template, and compliance package ready for your review and final sign-off.",
    features: [
      "80% complete technical proposal",
      "Financial proposal template",
      "Compliance package",
      "Evaluation criteria alignment",
      "Cover letter & executive summary",
      "Delivered in 48–72 hours",
    ],
    cta: "Draft my proposal",
    ctaHref: "/assessment?goal=prepare-proposal",
    featured: false,
  },
  {
    slug: "roster-fast-track",
    name: "Roster Fast-Track",
    label: "Per-agency registration",
    price: "$749",
    billingPeriod: "/roster",
    billingNote: "per agency registration",
    tagline: "We score you against 8 UN portals and tell you which to register with first. Then we prepare the full package.",
    description: "Full roster/vendor registration package — but first, a per-agency readiness leaderboard across UNGM, WFP, UNICEF, UNDP, IOM, FAO, UNOPS, and WHO. We score document coverage, category fit, and geographic reach against your evidence library so you start with the agency where you'll win fastest, not the one you guessed.",
    features: [
      "Per-agency readiness leaderboard across 8 UN portals",
      "start_here / viable / blocked recommendation with cited missing docs",
      "Complete registration package for the highest-readiness agency",
      "Document preparation, capability statement, cover letter",
      "UN-best-practice file-renaming rules",
      "Submission & follow-up support",
    ],
    cta: "Fast-track my roster",
    ctaHref: "/assessment?goal=register-roster",
    featured: false,
    comingSoon: true,
  },
  // PR-L (2026-05-23): annual dashboard access — full feature unlock at
  // a flat yearly rate. Two slugs map to the same Stripe product:
  //   annual-access            → $99/year  (regular)
  //   annual-access-founding   → $49/year  (founding-100 lock-in)
  // Both trigger the same webhook tier ("annual-access"). The 30-day
  // Stripe trial (TRIAL_DAYS) is configured in /api/pay/checkout for these slugs.
  // We intentionally do NOT surface these in the landing rate sheet —
  // they're a dashboard-overview promo only. The Services component
  // filters them out by checking slug.
  {
    slug: "annual-access",
    name: "Annual Dashboard Access",
    label: "Yearly subscription",
    price: "$99",
    billingPeriod: "/year",
    billingNote: "30-day free trial · cancel anytime",
    tagline: "TenderPath Pro — unlimited bid/no-bid, the Readiness-gap Navigator, and the Document Vault. The matched feed and database are free either way.",
    description: "TenderPath Pro unlocks the premium dashboard features — unlimited bid/no-bid verdicts, the Readiness-gap Navigator, and the Document Vault. The matched feed, tender database and weekly digest stay free. 30-day free trial; cancel any time before day 30 and you won't be charged.",
    features: [
      "Unlimited bid/no-bid verdicts",
      "Readiness-gap Navigator",
      "Document vault + readiness tracking",
      "Matched tenders & weekly digest (free tier)",
      "Proposal drafts billed per submission",
      "30-day free trial · cancel anytime",
    ],
    cta: "Start 30-day trial",
    ctaHref: "/pay?plan=annual-access",
    featured: false,
  },
  {
    slug: "annual-access-founding",
    name: "Annual Dashboard Access — Founding 100",
    label: "Yearly subscription · founding",
    price: "$49",
    billingPeriod: "/year",
    billingNote: "Founding-100 lock-in · 30-day free trial",
    tagline: "Same Pro unlock — vault, gap Navigator & unlimited bid/no-bid — locked at $49/year for life. First 100 subscribers.",
    description: "Founding-100 lock-in: $49/year forever as long as you stay subscribed. 30-day free trial; cancel any time before day 30 and you won't be charged. Limited to the first 100 subscribers.",
    features: [
      "Everything in Annual Dashboard Access",
      "Locked at $49/year for life",
      "Limited to first 100 subscribers",
      "30-day free trial · cancel anytime",
    ],
    cta: "Lock in $49/year",
    ctaHref: "/pay?plan=annual-access-founding",
    featured: true,
  },
];

// Single source of truth for the product-wide "coming soon" gate. Resolves
// legacy backend slugs (e.g. strategic-partnership → roster-fast-track) so a
// caller can pass either form. Every purchase/recommendation surface reads
// this — checkout APIs, the pay page, the assessment results CTA, the dashboard
// service intake, and the recommendation engine. Returns false for unknown
// slugs so nothing else is accidentally gated.
export function isComingSoonTier(slug: string | null | undefined): boolean {
  const canonical = resolveTierSlug(slug);
  if (!canonical) return false;
  return TIERS.some((t) => t.slug === canonical && t.comingSoon === true);
}
