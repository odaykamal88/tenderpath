/**
 * Strict shape returned by the Bid/No-Bid LLM pipeline and stored as
 * `proposal_packages.output` JSONB for the `bid-no-bid` plan.
 *
 * The shape is part of the user-facing contract — both the dashboard panel
 * and the rendered PDF read from it directly. Keep it stable; if a new field
 * is added, default it at render time rather than requiring re-generation.
 *
 * Sprint 8.2 + Fix 4 (2026-05-16): added tender_type, commercial_terms,
 * eligibility_findings, document priority, and evidence labels. All new
 * fields are optional with safe defaults so legacy packages render unchanged.
 */
export type BidRecommendation = "bid" | "no-bid" | "conditional";

export type Severity = "high" | "medium" | "low";

export type WinBand = "<10%" | "10-25%" | "25-50%" | "50-75%" | ">75%";

/**
 * Evidence provenance for a finding. Surfaced as a small badge in PDF + panel
 * so the reader can tell evidence apart from inference at a glance.
 *  - "evidence":    quoted/paraphrased directly from the tender or company profile
 *  - "inference":   derived from cross-document reasoning
 *  - "gap":         known absence verified against the tender's requirements
 *  - "unverified":  applicant or external claim the system cannot independently confirm
 */
export type EvidenceLabel = "evidence" | "inference" | "gap" | "unverified";

/**
 * Tender solicitation type. Drives the one-line effort guidance in the PDF.
 *  - RFQ:     Request for Quotation — price-led, light proposal
 *  - ITB:     Invitation to Bid — sealed-bid, lowest compliant wins
 *  - RFP:     Request for Proposals — technical + financial scoring
 *  - EOI:     Expression of Interest — capability/registration only
 *  - EOI-RFP: EOI followed by RFP — two-stage
 *  - LTA:     Long-Term Agreement / framework — capability-led, multi-call
 */
export type TenderType =
  | "RFQ"
  | "ITB"
  | "RFP"
  | "EOI"
  | "EOI-RFP"
  | "LTA"
  | "unknown";

export type DocumentPriority = "mandatory" | "recommended";

/**
 * Recommended response to an eligibility gap. Lets the analysis advise
 * structural moves (JV, subcontract, supplier authorization) instead of
 * defaulting to "no bid" when a single fix exists.
 */
export type EligibilityAction =
  | "ok"
  | "bring_jv_partner"
  | "subcontract"
  | "supplier_authorization"
  | "no_bid"
  | "verify";

export interface BidGap {
  gap: string;
  severity: Severity;
  fix: string;
  /** Optional. Render as a small badge next to the gap. Defaults to "inference". */
  evidence_label?: EvidenceLabel;
}

export interface BidRequirement {
  document: string;
  why_needed: string;
  estimated_effort_hours: number | null;
  /** Optional. "mandatory" or "recommended". Renderer defaults missing to "mandatory". */
  priority?: DocumentPriority;
}

export interface BidEligibilityFinding {
  /** The eligibility line being assessed (e.g. "minimum 3 years of WASH experience"). */
  requirement: string;
  /** Whether the company meets it, has a gap, or the system can't tell. */
  status: "met" | "gap" | "unverified";
  /** Structural advice. Lets the analysis advise JV / subcontract / authorization. */
  recommended_action: EligibilityAction;
  /** One-sentence rationale. */
  rationale: string;
  /** Provenance label so the reader can weigh how solid the finding is. */
  evidence_label: EvidenceLabel;
}

/**
 * Commercial terms parsed from the tender. Every field is optional because
 * any given tender may omit some of these. Renderer suppresses the whole
 * block only when every field is null.
 */
export interface CommercialTerms {
  payment_terms: string | null;
  performance_bond_pct: number | null;
  bid_security_pct: number | null;
  advance_payment_pct: number | null;
  retention_pct: number | null;
  bid_validity_days: number | null;
  completion_period: string | null;
  currency: string | null;
  /** Free-form notes — escalation clauses, retention release schedule, etc. */
  notes: string[];
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

  /* Sprint 8.2 additions — all optional for backwards-compatible JSONB reads. */

  /** Solicitation type — drives the one-line effort guidance. */
  tender_type?: TenderType;
  /** One-line guidance e.g. "ITB — sealed-bid, lowest compliant wins. Price + compliance heavy.". */
  tender_type_note?: string | null;
  /** Commercial terms summary. */
  commercial_terms?: CommercialTerms;
  /** Eligibility findings with structural recommendations (JV / subcontract / etc.). */
  eligibility_findings?: BidEligibilityFinding[];

  /* PR-F (grounded analysis) additions — all optional. */

  /**
   * Filenames the LLM directly cited as evidence in its reasoning.
   * Asked of the model in the prompt; the work-order UI surfaces these
   * as a "We read these documents" panel so the user sees the analysis
   * is grounded in the files they uploaded / pasted.
   */
  applicant_documents_cited?: string[];
  /**
   * Compact ledger of documents fed into the analysis. Server-populated
   * (not from the LLM) — comes from `summarizeDocs(loadBidNoBidDocuments(...))`.
   * Lives next to the analysis so the work-order UI can render
   * provenance without re-querying the vault.
   */
  documents_ingested?: Array<{
    file_name: string;
    doc_class: string;
    purpose: "tender_main" | "supporting" | "fetched_url";
    char_count: number;
    source: "vault" | "extraction_by_url" | "fetched_url";
  }>;

  /* PR-G additions — per-criterion projected score. */

  /**
   * Projected score table when the tender publishes (or strongly implies)
   * a scoring rubric. Consultant-grade output — the user gets a
   * per-criterion projection anchored in the uploaded evidence and can
   * sanity-check it against the published rubric in the TOR.
   *
   * The model is strictly instructed NOT to invent a rubric when none
   * exists. rubric_source="absent" + empty criteria is the honest answer
   * and the work-order UI hides the card in that case.
   */
  projected_score?: ProjectedScore;
}

export type ProjectedScoreBand = "A" | "B" | "C" | "D";

export interface ProjectedScoreCriterion {
  /** Criterion name as written in the tender ("Technical capacity", "Past experience"). */
  name: string;
  /** Maximum points available for this criterion per the rubric. */
  max_points: number;
  /** Projected points the applicant would earn, given the evidence we have. */
  projected_points: number;
  /** One-line evidence-anchored explanation (cite document or profile fact). */
  rationale: string;
  /** How confident the projection is. low = thin evidence, model is guessing. */
  confidence: "high" | "medium" | "low";
}

export interface ProjectedScore {
  /**
   * Where the rubric came from:
   *   - stated_in_tender: explicit max-points table found in the tender text or TOR
   *   - inferred_from_text: model derived a rubric from prose (use cautiously)
   *   - absent: tender doesn't publish a rubric; UI hides the card
   */
  rubric_source: "stated_in_tender" | "inferred_from_text" | "absent";
  total_points_possible: number | null;
  total_points_projected: number | null;
  /** Letter band: A strong / B competitive / C borderline / D likely no-bid. */
  band: ProjectedScoreBand | null;
  /** Short label for the band, e.g. "Strong bid candidate". */
  band_label: string | null;
  criteria: ProjectedScoreCriterion[];
  /** Caveat one-liner for the UI: "Rubric inferred from prose — verify in TOR." */
  caveat: string | null;
}

export interface TenderRequirements {
  eligibility_criteria: string[];
  technical_requirements: string[];
  required_documents: string[];
  evaluation_criteria: string[];
  key_constraints: string[];
  submission_format: string;
}

export const DEFAULT_COMMERCIAL_TERMS: CommercialTerms = {
  payment_terms: null,
  performance_bond_pct: null,
  bid_security_pct: null,
  advance_payment_pct: null,
  retention_pct: null,
  bid_validity_days: null,
  completion_period: null,
  currency: null,
  notes: [],
};

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
  tender_type: "unknown",
  tender_type_note: null,
  commercial_terms: DEFAULT_COMMERCIAL_TERMS,
  eligibility_findings: [],
  applicant_documents_cited: [],
  documents_ingested: [],
  projected_score: {
    rubric_source: "absent",
    total_points_possible: null,
    total_points_projected: null,
    band: null,
    band_label: null,
    criteria: [],
    caveat: null,
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

/* Helper used by renderers to detect whether the commercial-terms block has anything to show. */
export function hasCommercialTerms(t: CommercialTerms | undefined | null): boolean {
  if (!t) return false;
  return (
    t.payment_terms != null ||
    t.performance_bond_pct != null ||
    t.bid_security_pct != null ||
    t.advance_payment_pct != null ||
    t.retention_pct != null ||
    t.bid_validity_days != null ||
    t.completion_period != null ||
    t.currency != null ||
    (t.notes?.length ?? 0) > 0
  );
}

/* Lightweight label helpers, exported so PDF and panel render the same vocabulary. */
export const TENDER_TYPE_LABEL: Record<TenderType, string> = {
  RFQ: "RFQ",
  ITB: "ITB",
  RFP: "RFP",
  EOI: "EOI",
  "EOI-RFP": "EOI → RFP",
  LTA: "LTA",
  unknown: "Unknown",
};

export const ELIGIBILITY_ACTION_LABEL: Record<EligibilityAction, string> = {
  ok: "OK",
  bring_jv_partner: "Bring a JV partner",
  subcontract: "Subcontract to a qualified firm",
  supplier_authorization: "Get supplier authorization",
  no_bid: "Do not bid",
  verify: "Verify with applicant",
};

export const EVIDENCE_LABEL_TEXT: Record<EvidenceLabel, string> = {
  evidence: "Evidence",
  inference: "Inference",
  gap: "Gap",
  unverified: "Unverified",
};
