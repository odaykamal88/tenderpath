/**
 * Proposal Review output family (P1.1, First-Revenue Sprint — the MOAT SKU).
 *
 * Two shapes, one contract vocabulary:
 *   - ComplianceGapCheck : the FREE shallow wedge. Administrative/eligibility gate
 *     check of the applicant's OWN draft against the call, a compliance verdict, a
 *     contestability band, and the go/no-go question — no per-criterion scoring,
 *     no drop-in rewrites (those are the paid depth). kind: "compliance_check".
 *   - ReviewOutput : the PAID deep adjudication (the 23-field senior review from
 *     `docs/agents/service-output-spec.md`, seeded from the scoring engine's
 *     ScoreResult). kind: "review". Defined here so the deep tier builds against
 *     it; the shallow tier ships first.
 *
 * Both persist on `proposal_packages.output` JSONB with a `kind` discriminator
 * (renderers branch on kind) and render exclusively through pdfDocs.tsx. The
 * shared severity / evidence / gate vocabulary mirrors service-output-spec.md.
 */

// ── Shared vocabulary (mirrors service-output-spec.md) ───────────────────────
export type ReviewSeverity = "BLOCK" | "HIGH" | "MED" | "LOW";
export type ReviewEvidenceLabel = "evidence" | "inference" | "gap" | "unverified";
export type ReviewGateStatus = "ok" | "missing" | "partial" | "unverified" | "not_applicable";
export type ThresholdClearance = "clears" | "borderline" | "fails";
export type ReviewReadinessState =
  | "not_started"
  | "draft_uploaded"
  | "review_in_progress"
  | "reviewed"
  | "fixes_applied"
  | "submitted";

export interface SourceRef {
  document_id: string;
  document_label: string;
  page_or_section: string | null;
  snippet: string; // verbatim, ≤300 chars
}

export interface CallRef {
  tender_id: number | null;
  title: string;
  agency: string | null;
  country: string | null;
  deadline: string | null; // ISO
  opportunity_type: string | null;
}

export interface ApplicantRef {
  user_id: number | null;
  organisation: string | null;
  org_type: string | null;
}

export interface AdminGate {
  id: string;
  label: string; // "Budget estimate stated"
  status: ReviewGateStatus;
  severity: ReviewSeverity; // typically BLOCK when missing
  action: string;
  owner: string;
  evidence_label: ReviewEvidenceLabel;
  note?: string;
}

export interface ExclusionCheck {
  id: string; // "gender_sensitivity"
  label: string;
  addressed: boolean;
  evidence_label: ReviewEvidenceLabel;
  notes: string;
}

export interface ReviewQualityProfile {
  status: "ready" | "needs_review" | "blocked";
  score_0_10: number;
  missing_inputs: string[];
  warnings: string[];
}

// ── FREE shallow tier: ComplianceGapCheck ────────────────────────────────────
export type ComplianceVerdictStatus = "clears" | "at_risk" | "blocked";
export type GoNoGoLean = "go" | "caution" | "hold";

export interface ComplianceTopGap {
  severity: ReviewSeverity;
  issue: string;
  evidence_label: ReviewEvidenceLabel;
  gate_id?: string;
}

export interface ComplianceContestability {
  band: "Open" | "Mixed" | "Constrained";
  line: string;
  basis: string[];
}

export interface GoNoGo {
  /** The headline value of the review SKU — a question, not a feature. */
  question: string;
  lean: GoNoGoLean;
  one_liner: string;
}

export interface ComplianceGapCheck {
  kind: "compliance_check";
  ref_tag: string; // CHK-XXXX-NNN
  generated_at: string; // ISO
  revision: number;

  call: CallRef;
  applicant: ApplicantRef;

  compliance_verdict: {
    status: ComplianceVerdictStatus;
    headline: string;
    summary: string;
  };
  admin_gates: AdminGate[];
  mandatory_exclusions: ExclusionCheck[];
  top_gaps: ComplianceTopGap[];
  contestability: ComplianceContestability;
  go_no_go: GoNoGo;

  /** The paid-depth upsell — what the deep review adds over this free taste. */
  deep_review: {
    available: boolean;
    what_you_get: string[];
  };

  output_quality: ReviewQualityProfile;
}

// ── PAID deep tier: ReviewOutput (spec; deep pipeline builds against this) ────
export interface RubricCriterion {
  id: string;
  label: string;
  max_score: number;
  weight_multiplier: number; // 1 default; 2 for double-weighted
  question: string; // rubric's evaluator question, verbatim
}
export interface RubricSection {
  label: string;
  max_score: number;
  criteria: RubricCriterion[];
}
export interface EvaluationRubric {
  name: string;
  sections: RubricSection[];
  total_max: number;
  advance_threshold?: number;
}

export interface ScoringRow {
  criterion_id: string;
  current_score: number;
  achievable_score: number;
  rationale: string;
  evidence_label: ReviewEvidenceLabel;
  source_refs: SourceRef[];
}

export interface Strength {
  label: string;
  where_in_proposal: string;
  why_it_matters: string;
  tied_to: "applicant_evidence" | "call_priority" | "rubric_advantage" | "competitor_context";
  evidence_label: ReviewEvidenceLabel;
  source_refs: SourceRef[];
}

export interface EvaluationRisk {
  criterion_id: string;
  exposure_points: number; // effective exposure incl. double-weighting
  what_is_missing: string;
  evidence_label: ReviewEvidenceLabel;
}

export interface PriorityFix {
  rank: number;
  severity: ReviewSeverity;
  issue: string;
  fix: string; // action-oriented, drop-in where possible
  owner: string;
  deadline: string; // ISO or "Now"
  addresses_criteria: string[];
  addresses_admin_gates: string[];
}

export interface Rewrite {
  section_id: string;
  current_text: string;
  suggested_text: string;
  addresses_fixes: number[];
  rationale: string;
}

export interface ReadinessRow {
  item: string;
  status: ReviewGateStatus;
  action: string;
  severity: ReviewSeverity;
}

export interface TimelineEvent {
  when: string;
  owner: string;
  action: string;
}

export interface EvidenceRef {
  document_id: string;
  document_label: string;
  used_for: string;
}

export interface ReviewOutput {
  kind: "review";
  ref_tag: string; // REV-XXXX-NNN
  work_order_id: number;
  revision: number; // monotonically increasing per work-order
  generated_at: string;
  agent_version: string;

  call: CallRef;
  applicant: ApplicantRef;

  rubric: EvaluationRubric;
  scoring: ScoringRow[];
  scoring_totals: {
    current: number;
    achievable: number;
    max: number;
    threshold_clearance: ThresholdClearance;
  };

  admin_gates: AdminGate[];
  mandatory_exclusions: ExclusionCheck[];
  strengths: Strength[];
  evaluation_risks: EvaluationRisk[];
  priority_fixes: PriorityFix[];
  rewrites: Rewrite[];

  submission_readiness: ReadinessRow[];
  timeline: TimelineEvent[];

  /** Contestability (P0.3) folded into the paid deep read — orthogonal to score. */
  contestability: ComplianceContestability;
  go_no_go: GoNoGo;

  evidence_used: EvidenceRef[];
  output_quality?: ReviewQualityProfile;
}
