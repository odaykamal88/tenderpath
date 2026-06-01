/**
 * feedback/types.ts — the unified feedback store (Phase 1 of the proposal
 * flywheel). ONE record shape covers all four loops:
 *
 *   outcome              (Loop 1) — won / lost / shortlisted / disqualified on a
 *                                   delivered proposal; the calibration signal.
 *   loss_reason          (Loop 2) — WHERE a draft was weak (auto + reviewer).
 *   extraction_correction(Loop 4) — a human fix to a mis-extracted rubric.
 *   exemplar             (Loop 3) — a consented, anonymized winning proposal.
 *
 * The `state` field is the CURATION GATE. Every record is born `captured`; a
 * human promotes or rejects it. ONLY `promoted` records may affect scoring
 * calibration, extraction, or retrieval. The model is frozen — this store is
 * the curated layer that gets less static. "Less static" must never mean
 * "unsupervised": automate the capture, keep promotion manual.
 */

export type FeedbackKind = "outcome" | "loss_reason" | "extraction_correction" | "exemplar";

export type FeedbackState = "captured" | "promoted" | "rejected";

/** Real result of a delivered proposal (Loop 1). `pending` = decision window
 *  not yet closed; `withdrawn` = the vendor did not submit. Chase losses as
 *  hard as wins — survivorship bias is what quietly makes the score dishonest. */
export type OutcomeValue =
  | "won"
  | "lost"
  | "shortlisted"
  | "disqualified"
  | "withdrawn"
  | "pending";

export type CapturedFrom = "user_prompt" | "auto_score" | "reviewer_edit" | "admin" | "run_failure";

/** A persisted feedback record (DB row, camel-cased). Loop-1 fields
 *  (outcome / predicted*) are null for the other kinds; kind-specific structured
 *  data lives in `payload`. */
export interface FeedbackRecord {
  id: number;
  kind: FeedbackKind;
  state: FeedbackState;
  capturedFrom: CapturedFrom;
  userId: number | null;
  workOrderId: number | null;
  proposalPackageId: number | null;
  tenderTitle: string | null;
  agency: string | null;
  outcome: OutcomeValue | null;
  predictedScore: number | null;
  predictedMax: number | null;
  predictedBand: string | null;
  rubricVersion: number | null;
  detail: string | null;
  payload: Record<string, unknown>;
  reviewedBy: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input to insertFeedback. Only `kind` is required; everything else is
 *  optional so each loop fills the fields it has. `state` is never an input —
 *  records are always born `captured`. */
export interface FeedbackInput {
  kind: FeedbackKind;
  capturedFrom?: CapturedFrom;
  userId?: number | null;
  workOrderId?: number | null;
  proposalPackageId?: number | null;
  tenderTitle?: string | null;
  agency?: string | null;
  outcome?: OutcomeValue | null;
  predictedScore?: number | null;
  predictedMax?: number | null;
  predictedBand?: string | null;
  rubricVersion?: number | null;
  detail?: string | null;
  payload?: Record<string, unknown>;
}

/** A coarse score-ratio bucket used for calibration (distinct from the
 *  evidence-based coverage band the UI shows — this one is purely the
 *  predicted-points ratio, the thing we test against real outcomes). */
export type ScoreBand = "strong" | "adequate" | "weak" | "unknown";

/** Direction of an outcome, for calibration. */
export type OutcomePolarity = "positive" | "negative" | "neutral";

/** How a predicted score lined up with the real outcome. `optimistic` is the
 *  dangerous miss (we said strong, they lost) the survivorship-bias note warns
 *  about; `pessimistic` is the opposite; `n/a` when the outcome isn't decided. */
export type CalibrationVerdict = "aligned" | "optimistic" | "pessimistic" | "n/a";
