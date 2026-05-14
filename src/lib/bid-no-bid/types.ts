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

export type TenderTypeCode = "rfq" | "itb" | "rfp" | "eoi" | "lta" | "roster" | "unknown";

export interface TenderTypeSummary {
  code: TenderTypeCode;
  label: string;
  effort_level: "low" | "medium" | "high" | "unknown";
  guidance: string;
  evidence: string | null;
}

export interface BidDocumentChecklist {
  mandatory: BidRequirement[];
  recommended: BidRequirement[];
}

export type EligibilityActionType =
  | "collect_proof"
  | "jv_partner"
  | "subcontract"
  | "supplier_authorization"
  | "clarify_with_buyer"
  | "no_bid";

export interface BidEligibilityAction {
  requirement: string;
  action: EligibilityActionType;
  label: string;
  rationale: string;
  severity: Severity;
}

export interface CommercialTerm {
  label: string;
  value: string;
  risk: "low" | "medium" | "high" | "unknown";
  note: string;
}

export interface BidNoBidOutput {
  recommendation: BidRecommendation;
  win_probability_band: WinBand;
  headline: string;
  tender_type: TenderTypeSummary;
  fit_reasoning: string[];
  gap_analysis: BidGap[];
  required_documents: BidRequirement[];
  document_checklist: BidDocumentChecklist;
  eligibility_actions: BidEligibilityAction[];
  commercial_terms: CommercialTerm[];
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
  tender_type?: string;
  commercial_terms?: string[];
}

export const DEFAULT_BID_OUTPUT: BidNoBidOutput = {
  recommendation: "conditional",
  win_probability_band: "10-25%",
  headline: "Analysis unavailable — manual review required.",
  tender_type: {
    code: "unknown",
    label: "Unknown tender type",
    effort_level: "unknown",
    guidance: "Confirm whether this is an RFQ, ITB, RFP, EOI, roster, or LTA before estimating effort.",
    evidence: null,
  },
  fit_reasoning: [],
  gap_analysis: [],
  required_documents: [],
  document_checklist: {
    mandatory: [],
    recommended: [],
  },
  eligibility_actions: [],
  commercial_terms: [],
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
  tender_type: "unknown",
  commercial_terms: [],
};
