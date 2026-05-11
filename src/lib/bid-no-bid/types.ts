/**
 * Strict shape returned by the Bid/No-Bid LLM pipeline and stored as
 * `proposal_packages.output` JSONB for the `bid-no-bid` plan.
 *
 * The shape is part of the user-facing contract — both the dashboard panel
 * and the rendered PDF read from it directly. Keep it stable; if a new field
 * is added, default it at render time rather than requiring re-generation.
 */
export type BidRecommendation = "bid" | "no-bid" | "conditional";

export type Severity = "high" | "medium" | "low";

export type WinBand = "<10%" | "10-25%" | "25-50%" | "50-75%" | ">75%";

export interface BidGap {
  gap: string;
  severity: Severity;
  fix: string;
}

export interface BidRequirement {
  document: string;
  why_needed: string;
  estimated_effort_hours: number | null;
}

export interface BidNoBidOutput {
  recommendation: BidRecommendation;
  win_probability_band: WinBand;
  headline: string;
  fit_reasoning: string[];
  gap_analysis: BidGap[];
  required_documents: BidRequirement[];
  effort_estimate_hours: number;
  red_flags: string[];
  conditions_for_bid: string[];
  next_steps: string[];
  evidence: {
    tender_excerpt: string;
    company_capabilities_matched: string[];
    company_capabilities_missing: string[];
  };
}

export interface TenderRequirements {
  eligibility_criteria: string[];
  technical_requirements: string[];
  required_documents: string[];
  evaluation_criteria: string[];
  key_constraints: string[];
  submission_format: string;
}

export const DEFAULT_BID_OUTPUT: BidNoBidOutput = {
  recommendation: "conditional",
  win_probability_band: "10-25%",
  headline: "Analysis unavailable — manual review required.",
  fit_reasoning: [],
  gap_analysis: [],
  required_documents: [],
  effort_estimate_hours: 0,
  red_flags: [],
  conditions_for_bid: [],
  next_steps: [],
  evidence: {
    tender_excerpt: "",
    company_capabilities_matched: [],
    company_capabilities_missing: [],
  },
};

export const DEFAULT_TENDER_REQUIREMENTS: TenderRequirements = {
  eligibility_criteria: [],
  technical_requirements: [],
  required_documents: [],
  evaluation_criteria: [],
  key_constraints: [],
  submission_format: "unknown",
};
