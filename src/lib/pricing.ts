import type { TierSlug } from "@/lib/types";

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
    ctaHref: "/assessment",
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
    ctaHref: "/assessment",
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
    ctaHref: "/assessment",
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
    ctaHref: "/assessment",
    featured: false,
  },
];

export interface LegacyTierInfo {
  name: string;
  price: string;
  billingPeriod: string;
  tagline: string;
  cta: string;
}

// Maps backend TierSlugs (unchanged — backend-coupled) to display info for AssessmentResults
export const TIER_INFO_BY_SLUG: Record<TierSlug, LegacyTierInfo> = {
  "tender-intelligence": {
    name: "Grants + Tenders Matching",
    price: "$49",
    billingPeriod: "/mo",
    tagline: "5–10 AI-matched opportunities weekly — tenders and grants scored by fit for your profile",
    cta: "Get weekly matched tenders & grants",
  },
  "submission-package": {
    name: "Proposal Draft",
    price: "$299",
    billingPeriod: "/submission",
    tagline: "80% complete proposal package delivered in 48–72 hours — collapse 30 hours into 3–4",
    cta: "Draft my proposal",
  },
  "strategic-partnership": {
    name: "Roster Fast-Track",
    price: "$749",
    billingPeriod: "/roster",
    tagline: "We score you against 8 UN portals (UNGM, WFP, UNICEF, UNDP, IOM, FAO, UNOPS, WHO) and route you to the highest-readiness one",
    cta: "Fast-track my roster",
  },
};
