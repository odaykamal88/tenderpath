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
}

export interface ComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
}

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
};

export const PROPOSAL_PLAN = "proposal-draft";
export const ROSTER_PLAN = "roster-fast-track";
export const MAX_ATTEMPTS = 3; // 1 automatic + 2 user-triggered regenerations
