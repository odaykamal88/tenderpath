/**
 * scoring-engine.ts
 *
 * Single scoring spine shared by two SKUs:
 *   - $299 Proposal Draft  → runs the engine automatically as a self-check (lightweight depth, no human)
 *   - Senior Review        → runs the IDENTICAL engine, seeds the 23-field ReviewOutput, human confirms
 *
 * Design rules this file encodes:
 *   1. ONE rubric extraction + ONE scoring pass. The two SKUs differ in depth and human-in-loop, not logic.
 *   2. The engine is lane-agnostic. `lane` is data, not a code branch — the elicitation/template layers
 *      above the engine read it. A wrong Gate-0 lane guess is a config change, not a rewrite.
 *   3. No silent overwrite. Re-runs create a new immutable GenerationSnapshot; they never mutate the old.
 *   4. Provenance is first-class. Every claim carries where it came from (doc / library / inference / gap).
 *   5. Rendering only ever exits through pdfDocs.tsx. The engine emits structured output; it never renders.
 *      (See CSIM learnings: off-pipeline ReportLab is the failure that recurs without this guardrail.)
 *   6. Tenders are lot-shaped. UN procurement RFQs often have multiple lots, each with its own criteria
 *      and (often) its own financial form. Single-lot tenders use a one-entry `lots` array with
 *      lotId = "main". This was a Gate-0 decision documented in
 *      docs/agents/proposal-engine-build-plan.md (2026-05-24).
 *
 * Status: STUB. Interfaces are intended to be stable; function bodies throw NotImplemented.
 */

// ============================================================================
// Source references & provenance  (folded-in improvement #1: claim-level provenance)
// ============================================================================

export interface SourceRef {
  docId: string;
  section?: string;       // e.g. "Section 3.2", "Annex II", "Corrigendum No. 1"
  rubricVersion: number;  // which rubric version this reference was valid under
}

export type ProvenanceKind =
  | 'uploaded_document'   // from the solicitation set or an applicant-uploaded file
  | 'applicant_library'   // carried forward from evidence.ts (reusable vendor/applicant profile)
  | 'inferred'            // model synthesis — plausible but NOT directly evidenced
  | 'gap';                // required by the rubric but absent — MUST be surfaced to the user

export interface Provenance {
  kind: ProvenanceKind;
  sourceRef?: SourceRef;  // present for uploaded_document / applicant_library
  note?: string;          // why this was inferred, or what is missing for a gap
}

/** A single assertion inside a drafted section, tagged with where it came from. */
export interface Claim {
  text: string;
  provenance: Provenance;
}

// ============================================================================
// Ingested documents  (improvement: solicitation is a versioned SET, not one file)
// ============================================================================

export interface DocManifestEntry {
  docId: string;
  filename: string;
  contentHash: string;    // detects "did this exact input change between runs"
  role:
    | 'guidelines'
    | 'tor'               // terms of reference / scope (UN procurement)
    | 'solicitation'      // RFP / ITB / RFQ base document
    | 'amendment'         // UN amendment / addendum — supersedes points of earlier docs
    | 'qa'                // published clarification (Q&A) round — binding
    | 'info_session'
    | 'annex'
    | 'draft'             // applicant's own draft (senior-review input)
    | 'supporting';
  supersedes?: string[];  // docIds whose points this doc overrides (corrigendum logic)
}

export interface IngestedDoc {
  manifest: DocManifestEntry;
  text: string;           // extracted, normalized text
}

// ============================================================================
// The extracted rubric — the highest-leverage artifact in the whole system
// ============================================================================

export type Methodology =
  | 'cumulative'          // weighted score across criteria (most RFPs, most grants)
  | 'lowest_compliant'    // pass technical gate, then lowest price (many ITBs / goods)
  | 'weighted_grant';     // grant scoring with co-financing / design weighting (grant lane)

export interface EvaluationCriterion {
  id: string;
  label: string;          // "Methodology / understanding of TOR", "Co-financing", ...
  weight: number;         // normalized share of total (0..1)
  maxScore: number;
  doubleWeighted?: boolean;  // CSIM proved these exist and swing outcomes
  gatingThreshold?: number;  // minimum score to remain qualified on this criterion
  source: SourceRef;
}

export type DisqualifierKind =
  | 'mandatory_form'
  | 'eligibility'
  | 'format'              // page limit, font, file format, language
  | 'deadline'
  | 'financial';          // e.g. co-financing floor, budget ceiling

export interface Disqualifier {
  id: string;
  rule: string;           // human-readable, e.g. "co-financing >= 30%"
  kind: DisqualifierKind;
  source: SourceRef;
}

// ============================================================================
// Lot grouping  (Gate-0 decision: UN procurement is genuinely lot-shaped — preserve it)
// ============================================================================

/**
 * A lot within a tender. Multi-lot UN RFQs (e.g. UNOPS RFQ/2026/61438, three lots
 * with separate technical specs and financial forms) have one entry per lot. Single-lot
 * tenders (e.g. UNICEF RFPS-DAN-2021-503347) have exactly one entry with lotId = "main"
 * so downstream code can always address a lot without conditional logic.
 *
 * Bidders may quote on a subset of lots; evaluation is per-lot.
 */
export interface LotRubric {
  /** Stable identifier within the tender. Use "main" for single-lot tenders. */
  lotId: string;
  /** Human-readable label, e.g. "Lot 1 — HDPE pipes and fittings, Taiz City". */
  label: string;
  /** Short scope description from the solicitation. Optional but encouraged. */
  scope?: string;
  /** Criteria scored against THIS lot. */
  criteria: EvaluationCriterion[];
  /**
   * Disqualifiers that fire on this lot only. Examples:
   *  - Lot-specific technical specs (Lot 3 Part 3 GI fitting must meet BS EN 10242)
   *  - Lot-specific completeness rules (must offer 100% of Lot N's items and quantities)
   *
   * Notice-wide disqualifiers (deadline, lead-applicant eligibility) live on
   * TenderRubric.noticeWideDisqualifiers, not here.
   */
  disqualifiers: Disqualifier[];
  /** Pointer to this lot's financial / price-quotation form when the solicitation provides one per lot. */
  financialFormRef?: SourceRef;
}

export interface TenderRubric {
  tenderId: string;
  lane: 'procurement' | 'grant';   // the Gate-0 decision, recorded per tender (data, not a branch)
  methodology: Methodology;
  /**
   * Always ≥1 entry. Single-lot tenders contain one LotRubric with lotId = "main".
   * Multi-lot tenders contain one entry per lot, each with its own criteria and disqualifiers.
   */
  lots: LotRubric[];
  /**
   * Disqualifiers that apply ACROSS lots. Examples: missed submission deadline,
   * lead-applicant ineligibility, missing supplier registration. A triggered notice-wide
   * disqualifier fails every lot the bidder is quoting, not just one.
   */
  noticeWideDisqualifiers: Disqualifier[];
  documentSet: IngestedDoc[];      // guidelines + corrigenda + Q&A + annexes, with supersession
  rubricVersion: number;           // bumps whenever a corrigendum/Q&A changes scoring or disqualifiers
}

// ============================================================================
// Draft input & score output
// ============================================================================

export interface DraftSection {
  /** Which lot this section answers. Omit or use "main" for single-lot tenders. */
  lotId?: string;
  criterionId: string;    // which scored criterion this section answers
  content: string;        // rendered prose (rendering happens later, via pdfDocs.tsx)
  claims: Claim[];        // every material assertion, with provenance
}

export type Confidence = 'evidenced' | 'inferred' | 'gap' | 'unverified';

export interface CriterionAssessment {
  criterionId: string;
  estimatedScore: number;
  maxScore: number;
  confidence: Confidence; // rolls up from the claims backing this section
  weaknesses: string[];
  missingEvidence: string[];
}

/** Per-lot score result. Bidders typically quote on a subset of a multi-lot tender's lots. */
export interface LotScoreResult {
  lotId: string;
  perCriterion: CriterionAssessment[];
  estimatedTotal: number;
  /** Lot-specific disqualifiers triggered on this lot. */
  lotDisqualifiersTriggered: Disqualifier[];
  /** True when neither lot-specific gating nor any notice-wide disqualifier fails for this lot. */
  passesGating: boolean;
}

export interface ScoreResult {
  rubricVersion: number;                       // which rubric version this draft was scored against
  /** One entry per lot the bidder is quoting. */
  lotResults: LotScoreResult[];
  /**
   * Notice-wide disqualifiers triggered. These fail every lot the bidder quoted —
   * if any notice-wide disqualifier fires, every lotResults[i].passesGating is false.
   */
  noticeWideDisqualifiersTriggered: Disqualifier[];
}

// ============================================================================
// Immutable generation snapshots  (folded-in improvement #2: no silent overwrite)
// ============================================================================

export interface GenerationSnapshot {
  snapshotId: string;
  generatedAt: string;              // ISO timestamp
  rubricVersion: number;
  contextHash: string;              // hash of the assembled LLM context → detects input drift
  promptHash: string;               // hash of the prompt-template version → detects prompt drift
  documentManifest: DocManifestEntry[];  // exact source set + hashes for this run
  scoreResultId: string;            // links to the ScoreResult produced by this run
  supersededBy?: string;            // set when a later snapshot replaces this one (never delete)
}

// ============================================================================
// Loss-reason instrumentation  (folded-in improvement #3: capture WHERE drafts are weak)
// ============================================================================

export type LossReasonKind =
  | 'missing_evidence'
  | 'rubric_miss'            // a scored criterion was not adequately addressed
  | 'financial_inconsistency'
  | 'unsupported_claim'
  | 'formatting_gap'         // page limit, missing form, format/language violation
  | 'amendment_missed';      // draft was scored against a stale rubric (missed an amendment/Q&A)

export interface LossReason {
  kind: LossReasonKind;
  criterionId?: string;
  detail: string;
  capturedFrom: 'auto_score' | 'reviewer_edit' | 'run_failure';
  snapshotId: string;        // ties the signal back to a specific run for later analysis
}

// ============================================================================
// Engine input
// ============================================================================

/**
 * Input to extractRubric. The tender's identity, lane, methodology, and lot
 * structure are KNOWN facts from the tender manifest (the LLM cannot reliably
 * derive them across UN agencies and document layouts); extraction's job is
 * to fill in the criteria + disqualifiers DETAILS. Binding Q&A clarifications
 * are pre-classified upstream (see qa-extractor.ts) and treated as
 * authoritative refinements to the base rubric.
 */
export interface TenderInput {
  tenderId: string;
  lane: 'procurement' | 'grant';
  methodology: Methodology;
  /** Always >=1 entry. Single-lot tenders pass one entry with lotId = "main". */
  lotMetadata: Array<{ lotId: string; label: string; scope?: string }>;
  docs: IngestedDoc[];
  /** Optional. Pre-classified binding Q&A clarifications from qa-extractor.ts. */
  bindingClarifications?: Array<{ entryId: string; touches: string; content: string }>;
}

// ============================================================================
// The engine interface — both SKUs call exactly this
// ============================================================================

export interface ScoringEngine {
  /** Parse the full document SET into a structured, versioned rubric. */
  extractRubric(input: TenderInput): Promise<TenderRubric>;

  /** Score a draft against a rubric. Pure read of inputs; emits no side effects. */
  score(draft: DraftSection[], rubric: TenderRubric): Promise<ScoreResult>;

  /**
   * Re-extract when a new document lands (amendment / addendum / published Q&A) and diff against
   * the prior rubric. If criteria or disqualifiers changed, returns a rubric with a bumped
   * rubricVersion. Callers then flag any GenerationSnapshot whose rubricVersion is now stale.
   */
  reextractAndDiff(
    priorRubric: TenderRubric,
    newDocs: IngestedDoc[]
  ): Promise<{ rubric: TenderRubric; changed: boolean; deltas: RubricDelta[] }>;

  /** Persist an immutable snapshot of a generation run. Never mutates prior snapshots. */
  recordSnapshot(input: Omit<GenerationSnapshot, 'snapshotId' | 'generatedAt'>): Promise<GenerationSnapshot>;

  /** Capture a weakness signal (auto or reviewer-driven) for the loss-reason corpus. */
  recordLossReason(reason: LossReason): Promise<void>;
}

export interface RubricDelta {
  /** Present when the change is scoped to a single lot. Undefined for notice-wide changes. */
  lotId?: string;
  criterionId?: string;
  disqualifierId?: string;
  field: string;            // e.g. "weight", "maxScore", "gatingThreshold", "rule"
  before: unknown;
  after: unknown;
}

// ============================================================================
// Stub implementation — interfaces stable, bodies pending
// ============================================================================

class NotImplemented extends Error {
  constructor(method: string) {
    super(`scoring-engine: ${method} not yet implemented`);
  }
}

export class DefaultScoringEngine implements ScoringEngine {
  async extractRubric(input: TenderInput): Promise<TenderRubric> {
    // Sprint 1: delegate to rubric-extractor. Imported lazily so this module
    // stays import-cycle-free (rubric-extractor imports types from here).
    const { extractRubricFromInput } = await import('./rubric-extractor');
    return extractRubricFromInput(input);
  }
  async score(draft: DraftSection[], rubric: TenderRubric): Promise<ScoreResult> {
    // Sprint 2: delegate to rubric-scorer. Same lazy-import pattern.
    // Applicant context is optional at this layer; callers that need
    // applicant-aware scoring should use scoreDraft from rubric-scorer
    // directly (the higher-level revision-loop does this).
    const { scoreDraft } = await import('./rubric-scorer');
    return scoreDraft(draft, rubric);
  }
  async reextractAndDiff(
    _priorRubric: TenderRubric,
    _newDocs: IngestedDoc[]
  ): Promise<{ rubric: TenderRubric; changed: boolean; deltas: RubricDelta[] }> {
    throw new NotImplemented('reextractAndDiff');
  }
  async recordSnapshot(
    _input: Omit<GenerationSnapshot, 'snapshotId' | 'generatedAt'>
  ): Promise<GenerationSnapshot> {
    throw new NotImplemented('recordSnapshot');
  }
  async recordLossReason(_reason: LossReason): Promise<void> {
    throw new NotImplemented('recordLossReason');
  }
}
