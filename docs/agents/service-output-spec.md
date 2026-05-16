# Service Output Spec

Formal shape of every output produced by a TenderPath service. Read this before changing `src/lib/proposal-package/types.ts` or any renderer that consumes a service output. Read `proposal-review-report-template.md` for the narrative shape of the rendered review.

## Scope

Two output families today:

| Family | Slug(s) in `service-orders.ts` | Type today | Stage |
|---|---|---|---|
| ProposalOutput | `proposal`, `digest` | `ProposalOutput` in `src/lib/proposal-package/types.ts` | Shipped |
| RosterOutput | `lta-roster` | `RosterOutput` in `src/lib/proposal-package/types.ts` | Shipped |
| **ReviewOutput** | `bid-no-bid`, future `proposal-review-senior` | **Not yet implemented** — specified here | Spec |

`ReviewOutput` is a new family introduced for the proposal-review service surfaced by the EU grant case (`docs/learning/eu-grant-proposal-review-case-learnings.md`). The current `ProposalOutput` is compliance-checklist-shaped and cannot express rubric-based scoring. Reviews require their own shape.

This spec is the source of truth. Implementations should derive from it; the spec does not derive from current code.

## Universal status and severity vocabulary

These enums are shared across every service output. Renderers, badges, and dashboard surfaces consume them identically.

### Severity (for fixes, risks, gates)
- `BLOCK` — administrative rejection risk if not resolved. Renders red.
- `HIGH` — multi-point scoring exposure, or material credibility risk. Renders red.
- `MED` — single-point scoring exposure, or notable quality gap. Renders amber.
- `LOW` — polish, optional improvement, or low-confidence inference. Renders muted.

### Readiness state (for opportunities and reviews)
- `not_started`
- `draft_uploaded`
- `review_in_progress`
- `reviewed`
- `fixes_applied`
- `submitted`

### Gate status (for administrative checks and checklist items)
- `ok` — verified present and correct.
- `missing` — verified absent.
- `partial` — present but inadequate.
- `unverified` — system cannot independently confirm; applicant-stated only.
- `not_applicable` — gate does not apply to this opportunity or applicant.

### Evidence label (applied at the field level on findings)
- `evidence` — directly quoted or paraphrased from a call document, applicant submission, or applicant evidence library entry. Must carry a source pointer.
- `inference` — derived from cross-document reasoning. Must cite the documents reasoned over.
- `gap` — known absence verified against the call's rubric or the applicant's submission.
- `unverified` — applicant claim or external claim the system cannot independently confirm.

Every finding in a review output must carry one of these labels. This is the AGENTS.md "evidence over inference" principle made structural.

## ReviewOutput (spec, not yet implemented)

```
ReviewOutput {
  // Identity
  ref_tag: string;                              // e.g. "REV-CSIM-001"
  work_order_id: number;
  revision: number;                             // monotonically increasing per work-order
  generated_at: string;                         // ISO timestamp
  agent_version: string;                        // managed-agent version that produced this

  // Anchors
  call: CallRef;                                // canonical opportunity reference
  applicant: ApplicantRef;                      // organisation + evidence library snapshot
  corrigenda_observed: CorrigendumRef[];        // updates to the call seen since publication
  qa_observed: QAItemRef[];                     // Q&A items reasoned over

  // The rubric the call publishes — mirrored exactly, never invented
  rubric: EvaluationRubric {
    name: string;                               // e.g. "EuropeAid PRAG Concept Note 2025"
    sections: RubricSection[] {
      label: string;                            // "Relevance", "Design"
      max_score: number;
      criteria: RubricCriterion[] {
        id: string;                             // "2.1"
        label: string;
        max_score: number;
        weight_multiplier: number;              // 1 by default; 2 for double-weighted criteria
        question: string;                       // the rubric's evaluator question, verbatim
      };
    };
    total_max: number;
    advance_threshold?: number;                 // e.g. 30/50 for EU concept notes
  };

  // Scoring
  scoring: ScoringRow[] {
    criterion_id: string;
    current_score: number;
    achievable_score: number;
    rationale: string;
    evidence_label: EvidenceLabel;
    source_refs: SourceRef[];                   // where in which document the rationale is grounded
  };
  scoring_totals: {
    current: number;
    achievable: number;
    max: number;
    threshold_clearance: "clears" | "borderline" | "fails";
  };

  // Pre-scoring gates
  admin_gates: AdminGate[] {
    id: string;
    label: string;                              // "Budget estimate stated"
    status: GateStatus;
    severity: Severity;                         // typically BLOCK if status is missing
    action: string;                             // what the applicant must do
    owner: string;                              // role responsible
  };
  mandatory_exclusions: ExclusionCheck[] {
    id: string;                                 // "gender_sensitivity", "disability_sensitivity"
    label: string;
    addressed: boolean;
    evidence_label: EvidenceLabel;
    notes: string;
  };

  // Strengths (each tied to one of: applicant evidence, call-priority alignment,
  // scoring-rubric advantage, competitor-comparison context)
  strengths: Strength[] {
    label: string;
    where_in_proposal: string;
    why_it_matters: string;
    tied_to: "applicant_evidence" | "call_priority" | "rubric_advantage" | "competitor_context";
    evidence_label: EvidenceLabel;
    source_refs: SourceRef[];
  };

  // Evaluation risks (scoring exposure per criterion, distinct from admin gates)
  evaluation_risks: EvaluationRisk[] {
    criterion_id: string;
    exposure_points: number;                    // for double-weighted criteria, report effective exposure
    what_is_missing: string;
    evidence_label: EvidenceLabel;
  };

  // The workflow object
  priority_fixes: PriorityFix[] {
    rank: number;
    severity: Severity;
    issue: string;
    fix: string;                                // action-oriented, drop-in where possible
    owner: string;
    deadline: string;                           // ISO date or relative "Now", "By 17 May"
    addresses_criteria: string[];               // links back to rubric criterion ids
    addresses_admin_gates: string[];
  };

  // Drop-in editorial content
  rewrites: Rewrite[] {
    section_id: string;                         // where in the applicant's draft this goes
    current_text: string;                       // quoted from the draft
    suggested_text: string;
    addresses_fixes: number[];                  // priority_fix ranks
    rationale: string;
  };

  // Optional logframe seed
  theory_of_change?: BaselineTargetRow[] {
    level: string;                              // "SO1 outcome", "Impact"
    baseline: string;
    baseline_year: number;
    target: string;
    target_period: string;
    source: string;
  };
  racer_indicators?: RACERIndicator[] {
    result_level: string;
    indicator: string;
    baseline?: string;
    target?: string;
    source: string;
  };

  // Submission operations
  submission_readiness: ReadinessRow[] {
    item: string;
    status: GateStatus;
    action: string;
    severity: Severity;
  };
  timeline: TimelineEvent[] {
    when: string;
    owner: string;
    action: string;
  };

  // Next-stage prep
  forward_look?: ForwardLookSection {
    next_stage_name: string;                    // "Full application"
    deadline?: string;
    gates_to_prepare: ForwardGate[] {
      label: string;
      why_it_matters: string;
      preparation_action: string;
    };
  };

  // Evidence the review drew on; persisted back to the applicant evidence library
  evidence_used: EvidenceRef[];

  // Quality signal for ops visibility
  output_quality?: ReviewQualityProfile {
    status: "ready" | "needs_review" | "blocked";
    score_0_10: number;
    missing_inputs: string[];
    warnings: string[];
  };
}
```

### Required vs optional fields

A `ReviewOutput` must always contain:
- `ref_tag`, `work_order_id`, `revision`, `generated_at`
- `call`, `applicant`
- `rubric` (mirrored from the call)
- `scoring` with full coverage of every criterion in the rubric
- `admin_gates`
- `priority_fixes` (may be empty if nothing to fix)
- `submission_readiness`
- `evidence_used`

Optional but strongly preferred:
- `corrigenda_observed` (only omit if confirmed none exist)
- `mandatory_exclusions`, `strengths`, `evaluation_risks`
- `rewrites` (omit only if no rewriteable gaps)
- `theory_of_change`, `racer_indicators` (typically for grant-style calls)
- `forward_look` (for multi-stage calls)
- `timeline` (for time-sensitive deadlines)

### Versioning

Reviews are revisions on the same work-order. Re-running must:
- increment `revision`
- preserve the prior revision (no silent overwrite)
- diff `corrigenda_observed` and `rubric` against the prior revision and surface changes on the dashboard

## ProposalOutput and RosterOutput (existing)

Defined in `src/lib/proposal-package/types.ts`. Do not modify their shape without a coordinated migration; persist legacy packages can still render. Where `ProposalOutput` and `ReviewOutput` overlap conceptually (compliance, missing information, next steps), prefer routing to the appropriate output type rather than overloading `ProposalOutput`.

## Renderer contract

All output families share these guarantees:
- Render through the @react-pdf/renderer primitives in `src/lib/proposal-package/pdfDocs.tsx` (design tokens, masthead, footer, reference-tag convention).
- Severity values render to the same colour vocabulary across all outputs.
- Evidence labels surface visibly enough that a reader can tell evidence apart from inference at a glance.
- Reference tags follow the pattern `<KIND>-<SLUG>-<NNN>`: `PROP-XXXX` for proposal-draft, `ROST-XXXX` for roster, `REV-XXXX` for review.

## Source pointers

`SourceRef` is the smallest unit of evidence provenance:

```
SourceRef {
  document_id: string;                          // call PDF, applicant draft, evidence library entry
  document_label: string;                       // human-readable
  page_or_section: string | null;               // "p.24" or "SO3.3" or null
  snippet: string;                              // verbatim, ≤300 chars
}
```

Every `evidence`-labelled finding must carry at least one `SourceRef`. Every `inference`-labelled finding must carry at least two (the documents reasoned over). `gap` carries one (the rubric or applicant section where the gap was confirmed).

## Persistence

`ReviewOutput` persists on `proposal_packages.output` JSONB (the same column today's `ProposalOutput` uses) with a `kind: "review"` discriminator. Renderers branch on `kind`.

## See also

- `docs/agents/proposal-review-report-template.md` — narrative shape and tone of the rendered review
- `docs/agents/managed-agents-setup.md` — Tender Proposal Review Agent (#12)
- `docs/agents/dashboard-architecture.md` — Active Submission Workspace and tracked-calls feed
- `docs/learning/eu-grant-proposal-review-case-learnings.md` — the case that produced this spec
