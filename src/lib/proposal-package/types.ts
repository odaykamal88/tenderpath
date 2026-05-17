/**
 * Output shapes for the Proposal Draft ($299) and Roster Fast-Track ($749)
 * auto-fulfillment pipeline. Stored as `proposal_packages.output` JSONB and
 * consumed by the DOCX/XLSX/PDF renderers + dashboard panels.
 *
 * These shapes are an evolution of the existing /api/proposals/generate
 * output — preserved here verbatim so the existing /dashboard/proposals/[id]
 * view continues to render legacy packages without migration.
 */

export interface ProposalOutput {
  executive_summary: string;
  technical_approach: string[];
  compliance_checklist: ComplianceItem[];
  required_documents: string[];
  cover_letter_draft: string;
  financial_template_notes: string[];
  missing_information: string[];
  next_steps: string[];
  source_quality?: ProposalEvidenceProfile;
  /** Sprint 11. Optional. Compliance-gate summary produced at generation
   *  time. When mandatory_gaps > 0 the package is held in
   *  generation_status="needs_remediation" until the applicant resolves
   *  the gates (provide evidence, skip with explanation, or regenerate). */
  gate_state?: GateState;
}

export interface GateState {
  /** Total compliance items. */
  total: number;
  /** Items with status="needs_action" AND priority="mandatory". The bundle
   *  is held when this is >0. Legacy items without priority are treated as
   *  recommended (no gate) so the gate never trips on pre-Sprint-11 output. */
  mandatory_gaps: number;
  /** Items with priority="recommended" and status="needs_action". Surfaced
   *  to the applicant but not blocking. */
  recommended_gaps: number;
  /** Snapshot of the gap items so the dashboard can render the remediation
   *  panel from `proposal_packages.output` without re-deriving. */
  gap_items: Array<{
    requirement: string;
    priority: "mandatory" | "recommended";
    evidence_or_action: string;
    evidence_label?: ComplianceItem["evidence_label"];
  }>;
}

export interface ComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
  /** Sprint 11. Optional. Whether failing this item causes administrative
   *  rejection (mandatory) or only scoring deduction (recommended). The
   *  compliance gate blocks the ZIP bundle when ≥1 mandatory item is in
   *  status="needs_action". Legacy rows render unchanged when absent. */
  priority?: "mandatory" | "recommended";
  /** Sprint 11. Optional. What backs the evidence_or_action claim:
   *  - evidence_from_library: a file in the applicant's vault was cited.
   *  - user_claim:            the applicant said it (profile/intake) but
   *                           no vault item proves it.
   *  - inference:             reasoning over the tender text without
   *                           specific company backing.
   *  - gap:                   known absence — nothing supports the claim.
   *  Mirrors the Bid/No-Bid evidence_label pattern from Sprint 8. */
  evidence_label?: "evidence_from_library" | "user_claim" | "inference" | "gap";
}

export const COMPLIANCE_PRIORITIES = ["mandatory", "recommended"] as const;
export const COMPLIANCE_EVIDENCE_LABELS = [
  "evidence_from_library",
  "user_claim",
  "inference",
  "gap",
] as const;

export const COMPLIANCE_EVIDENCE_LABEL_TEXT: Record<NonNullable<ComplianceItem["evidence_label"]>, string> = {
  evidence_from_library: "Evidence on file",
  user_claim: "Applicant claim",
  inference: "Inference",
  gap: "Gap",
};

export interface RosterOutput {
  registration_checklist: string[];
  capability_statement_draft: string;
  required_documents: string[];
  organization_profile_notes: string[];
  cover_letter_draft: string;
  submission_guidance: string[];
  document_renaming_rules: DocumentRenameRule[];
  missing_information: string[];
  next_steps: string[];
  /** Sprint 14. Optional. Per-agency readiness breakdown. The roster
   *  output picks ONE primary agency to write the full narrative
   *  against, but a competent vendor can usually register with 2-3
   *  agencies — and they have different document requirements, category
   *  fits, and geographic reach. This breakdown scores the applicant
   *  against every plausible agency so the dashboard can surface
   *  "start here because…" and "blocked on…" guidance. Legacy rows
   *  without this field render unchanged. */
  agency_readiness_breakdown?: AgencyReadiness[];
}

export interface AgencyReadiness {
  /** AgencyPackage.slug — matches the static catalogue. */
  agency_slug: string;
  /** AgencyPackage.label — for display. Duplicated so the dashboard
   *  doesn't need to round-trip through the catalogue lookup. */
  agency_label: string;
  /** Composite readiness 0-10. Average of the three sub-scores, rounded. */
  readiness_0_10: number;
  /** 0-10. How many of the agency's required_documents are present in
   *  the applicant's evidence library or company profile. */
  document_coverage_0_10: number;
  /** 0-10. How well the company's actual capabilities map onto the
   *  agency's procurement categories. A food-safety advisor scores high
   *  on WFP/FAO, low on UNICEF supply contracts. */
  category_fit_0_10: number;
  /** 0-10. Geographic + operational reach alignment. A Lebanon-only
   *  vendor scores lower on FAO than on UNGM (which is global). */
  geographic_fit_0_10: number;
  /** "start_here" | "viable" | "blocked". start_here is the agency
   *  with the highest readiness (max one per breakdown); viable is any
   *  ≥6.0; blocked is <6.0 with explicit blockers named. */
  recommendation: "start_here" | "viable" | "blocked";
  /** One-line rationale citing the specific evidence or specific gap.
   *  e.g. "HACCP cert (HACCP_2024.pdf) + KPMG audit + 3 SIDA references
   *  cover 8 of 10 WFP required documents; only fleet capacity statement
   *  is missing." */
  rationale: string;
  /** Specific documents in the agency's required list that the
   *  applicant cannot currently produce. Empty if fully covered. */
  missing_documents: string[];
  /** Specific actions to lift readiness for this agency. 1-4 items. */
  next_actions: string[];
}

export interface DocumentRenameRule {
  document_type: string;
  required_filename: string;
  note: string | null;
}

export interface TenderRequirements {
  eligibility_criteria: string[];
  technical_requirements: string[];
  required_documents: string[];
  evaluation_criteria: string[];
  key_constraints: string[];
  submission_format: string;
  source_quality?: ProposalEvidenceProfile;
  /**
   * Sprint 9: company-aware cross-check. Populated when extractTenderRequirements
   * receives companyContext. The LLM matches each high-leverage requirement
   * to one of three states based on the company profile, so the generator
   * has a hard signal instead of inferring from the prose draft. Optional
   * for backwards compatibility — legacy JSONB rows render unchanged.
   */
  capability_match?: CapabilityMatch[];
}

export interface CapabilityMatch {
  /** The requirement being matched, in the tender's own wording where possible. */
  requirement: string;
  /**
   * - `evidenced` = company profile or uploaded evidence proves this.
   * - `claimed`   = the applicant says they can do it but no independent proof.
   * - `missing`   = nothing in the profile/uploads addresses this.
   */
  status: "evidenced" | "claimed" | "missing";
  /** One short sentence citing the specific company evidence, or stating the gap. */
  company_evidence: string;
}

export interface ProposalEvidenceProfile {
  status: "ready" | "needs_review" | "blocked";
  score_0_10: number;
  source_text_chars: number;
  uploaded_requirement_chars: number;
  pasted_requirement_chars: number;
  signals: {
    has_source_url: boolean;
    has_deadline: boolean;
    has_scope_or_deliverables: boolean;
    has_eligibility: boolean;
    has_required_documents: boolean;
    has_evaluation_criteria: boolean;
    has_submission_format: boolean;
    has_financial_context: boolean;
  };
  missing_inputs: string[];
  warnings: string[];
}

export const DEFAULT_TENDER_REQUIREMENTS: TenderRequirements = {
  eligibility_criteria: [],
  technical_requirements: [],
  required_documents: [],
  evaluation_criteria: [],
  key_constraints: [],
  submission_format: "unknown",
};

export const DEFAULT_PROPOSAL_OUTPUT: ProposalOutput = {
  executive_summary: "",
  technical_approach: [],
  compliance_checklist: [],
  required_documents: [],
  cover_letter_draft: "",
  financial_template_notes: [],
  missing_information: [],
  next_steps: [],
};

export const DEFAULT_ROSTER_OUTPUT: RosterOutput = {
  registration_checklist: [],
  capability_statement_draft: "",
  required_documents: [],
  organization_profile_notes: [],
  cover_letter_draft: "",
  submission_guidance: [],
  document_renaming_rules: [],
  missing_information: [],
  next_steps: [],
  agency_readiness_breakdown: [],
};

export const PROPOSAL_PLAN = "proposal-draft";
export const ROSTER_PLAN = "roster-fast-track";
// Sprint 11. Lifted from 3 (1 auto + 2 user) to 6 because the compliance
// gate now expects applicants to iterate: upload evidence → regenerate →
// (possibly) discover another gap → upload → regenerate. Three was too
// tight to absorb the new round-trip workflow without falling back to
// concierge. The senior-review escape hatch remains for genuinely stuck
// cases.
export const MAX_ATTEMPTS = 6;
