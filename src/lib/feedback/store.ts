/**
 * feedback/store.ts — persistence + pure logic for the feedback store.
 *
 * The DB layer self-bootstraps via ensureFeedbackStore() (the house pattern —
 * cf. ensureAssessmentRuntimeColumns / ensurePipelineColumns), so the feature
 * works on first use even before the manual scripts/migrate.mjs run lands. The
 * canonical schema also lives in migrate.mjs (launch-discipline rule 5: schema
 * in two places).
 *
 * The CURATION GATE is the `state` column. setFeedbackState() is the only way a
 * record leaves `captured`; getPromotedOutcomes() (and future promoted readers)
 * filter on state='promoted' so nothing uncurated ever feeds calibration.
 */

import { sql } from "@/lib/db";
import type {
  CalibrationVerdict,
  FeedbackInput,
  FeedbackKind,
  FeedbackRecord,
  FeedbackState,
  OutcomePolarity,
  OutcomeValue,
  ScoreBand,
} from "./types";

// ============================================================================
// Pure helpers (no DB — unit-tested by scripts/feedback-store-acceptance.ts)
// ============================================================================

const FEEDBACK_KINDS: readonly FeedbackKind[] = ["outcome", "loss_reason", "extraction_correction", "exemplar"];
const FEEDBACK_STATES: readonly FeedbackState[] = ["captured", "promoted", "rejected"];
const OUTCOME_VALUES: readonly OutcomeValue[] = ["won", "lost", "shortlisted", "disqualified", "withdrawn", "pending"];

export function isFeedbackKind(s: unknown): s is FeedbackKind {
  return typeof s === "string" && (FEEDBACK_KINDS as readonly string[]).includes(s);
}
export function isFeedbackState(s: unknown): s is FeedbackState {
  return typeof s === "string" && (FEEDBACK_STATES as readonly string[]).includes(s);
}
export function isOutcomeValue(s: unknown): s is OutcomeValue {
  return typeof s === "string" && (OUTCOME_VALUES as readonly string[]).includes(s);
}

/**
 * The curation gate. A record is born `captured`; a human promotes or rejects
 * it, and may later flip that decision. A same-state move is a no-op, not a
 * transition. Only `promoted` records affect calibration/extraction/retrieval —
 * that filtering lives in the read queries, this guard just keeps the audit
 * trail honest.
 */
export function canTransition(from: FeedbackState, to: FeedbackState): boolean {
  if (!isFeedbackState(from) || !isFeedbackState(to)) return false;
  return from !== to;
}

/** Coarse predicted-points bucket for calibration. This is the SCORE RATIO,
 *  deliberately distinct from the UI's evidence-based coverage band — the ratio
 *  is the thing we test against real outcomes. */
export function scoreBand(score: number | null, max: number | null): ScoreBand {
  if (score == null || max == null || !(max > 0) || !Number.isFinite(score)) return "unknown";
  const ratio = score / max;
  if (ratio >= 0.6) return "strong";
  if (ratio >= 0.4) return "adequate";
  return "weak";
}

export function outcomePolarity(outcome: OutcomeValue): OutcomePolarity {
  if (outcome === "won" || outcome === "shortlisted") return "positive";
  if (outcome === "lost" || outcome === "disqualified") return "negative";
  return "neutral"; // withdrawn / pending — no signal
}

/**
 * The core B2 signal: did the predicted score line up with the real outcome?
 *   - aligned     — predicted competitive AND advanced, or predicted weak AND lost
 *   - optimistic  — predicted competitive but LOST (the dangerous miss; chase these)
 *   - pessimistic — predicted weak but WON
 *   - n/a         — outcome undecided (withdrawn/pending) or no predicted score
 * "Predicted competitive" is a points ratio >= 0.5 (the midpoint).
 */
export function calibrationVerdict(
  predictedScore: number | null,
  predictedMax: number | null,
  outcome: OutcomeValue,
): CalibrationVerdict {
  const polarity = outcomePolarity(outcome);
  if (polarity === "neutral") return "n/a";
  if (predictedScore == null || predictedMax == null || !(predictedMax > 0) || !Number.isFinite(predictedScore)) {
    return "n/a";
  }
  const predictedCompetitive = predictedScore / predictedMax >= 0.5;
  if (predictedCompetitive && polarity === "positive") return "aligned";
  if (!predictedCompetitive && polarity === "negative") return "aligned";
  if (predictedCompetitive && polarity === "negative") return "optimistic";
  return "pessimistic";
}

// ============================================================================
// DB layer
// ============================================================================

let _ensured = false;

/** Idempotent. Mirrors the feedback_records block in scripts/migrate.mjs.
 *  Cached after first success so hot paths don't re-run the DDL every call. */
export async function ensureFeedbackStore(): Promise<void> {
  if (_ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS feedback_records (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'captured',
      captured_from TEXT NOT NULL DEFAULT 'user_prompt',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
      proposal_package_id INTEGER REFERENCES proposal_packages(id) ON DELETE SET NULL,
      tender_title TEXT,
      agency TEXT,
      outcome TEXT,
      predicted_score NUMERIC,
      predicted_max NUMERIC,
      predicted_band TEXT,
      rubric_version INTEGER,
      detail TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      review_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT feedback_records_kind_chk CHECK (kind IN ('outcome','loss_reason','extraction_correction','exemplar')),
      CONSTRAINT feedback_records_state_chk CHECK (state IN ('captured','promoted','rejected')),
      CONSTRAINT feedback_records_outcome_chk CHECK (outcome IS NULL OR outcome IN ('won','lost','shortlisted','disqualified','withdrawn','pending'))
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS feedback_records_state_kind_idx ON feedback_records (state, kind, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS feedback_records_package_idx ON feedback_records (proposal_package_id) WHERE proposal_package_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS feedback_records_promoted_outcome_idx ON feedback_records (kind, state) WHERE kind = 'outcome' AND state = 'promoted'`;
  _ensured = true;
}

/** Insert a new record. Always born `captured`. Returns the new id. */
export async function insertFeedback(input: FeedbackInput): Promise<number> {
  await ensureFeedbackStore();
  const rows = (await sql`
    INSERT INTO feedback_records (
      kind, captured_from, user_id, work_order_id, proposal_package_id,
      tender_title, agency, outcome, predicted_score, predicted_max,
      predicted_band, rubric_version, detail, payload
    ) VALUES (
      ${input.kind},
      ${input.capturedFrom ?? "user_prompt"},
      ${input.userId ?? null},
      ${input.workOrderId ?? null},
      ${input.proposalPackageId ?? null},
      ${input.tenderTitle ?? null},
      ${input.agency ?? null},
      ${input.outcome ?? null},
      ${input.predictedScore ?? null},
      ${input.predictedMax ?? null},
      ${input.predictedBand ?? null},
      ${input.rubricVersion ?? null},
      ${input.detail ?? null},
      ${JSON.stringify(input.payload ?? {})}::jsonb
    )
    RETURNING id
  `) as Array<{ id: number }>;
  return rows[0].id;
}

export async function getFeedbackById(id: number): Promise<FeedbackRecord | null> {
  await ensureFeedbackStore();
  const rows = (await sql`SELECT * FROM feedback_records WHERE id = ${id} LIMIT 1`) as unknown[];
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

export interface FeedbackListFilter {
  state?: FeedbackState;
  kind?: FeedbackKind;
  limit?: number;
}

/** List records for the admin curation queue. Defaults to the newest captured
 *  records (what's waiting on review). */
export async function listFeedback(filter: FeedbackListFilter = {}): Promise<FeedbackRecord[]> {
  await ensureFeedbackStore();
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const state = filter.state ?? null;
  const kind = filter.kind ?? null;
  const rows = (await sql`
    SELECT * FROM feedback_records
    WHERE (${state}::text IS NULL OR state = ${state})
      AND (${kind}::text IS NULL OR kind = ${kind})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown[];
  return rows.map(rowToRecord);
}

/**
 * The curation action. Validates the transition, stamps the reviewer +
 * timestamp, and returns the updated record (or null if the id is unknown or
 * the transition is a no-op).
 */
export async function setFeedbackState(
  id: number,
  to: FeedbackState,
  reviewerId: number | null,
  notes?: string,
): Promise<FeedbackRecord | null> {
  await ensureFeedbackStore();
  const current = await getFeedbackById(id);
  if (!current) return null;
  if (!canTransition(current.state, to)) return null;
  const rows = (await sql`
    UPDATE feedback_records
    SET state = ${to},
        reviewed_by = ${reviewerId ?? null},
        reviewed_at = NOW(),
        review_notes = ${notes ?? null},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `) as unknown[];
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

/** Promoted outcome records only — the curated input the calibration harness
 *  reads. Nothing uncurated reaches calibration. */
export async function getPromotedOutcomes(limit = 1000): Promise<FeedbackRecord[]> {
  await ensureFeedbackStore();
  const capped = Math.min(Math.max(limit, 1), 5000);
  const rows = (await sql`
    SELECT * FROM feedback_records
    WHERE kind = 'outcome' AND state = 'promoted'
    ORDER BY created_at DESC
    LIMIT ${capped}
  `) as unknown[];
  return rows.map(rowToRecord);
}

// ============================================================================
// Row mapping
// ============================================================================

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToRecord(raw: unknown): FeedbackRecord {
  const r = raw as Record<string, unknown>;
  let payload: Record<string, unknown> = {};
  if (r.payload && typeof r.payload === "object") payload = r.payload as Record<string, unknown>;
  else if (typeof r.payload === "string") {
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  return {
    id: Number(r.id),
    kind: r.kind as FeedbackRecord["kind"],
    state: r.state as FeedbackState,
    capturedFrom: r.captured_from as FeedbackRecord["capturedFrom"],
    userId: r.user_id == null ? null : Number(r.user_id),
    workOrderId: r.work_order_id == null ? null : Number(r.work_order_id),
    proposalPackageId: r.proposal_package_id == null ? null : Number(r.proposal_package_id),
    tenderTitle: (r.tender_title as string | null) ?? null,
    agency: (r.agency as string | null) ?? null,
    outcome: (r.outcome as OutcomeValue | null) ?? null,
    predictedScore: num(r.predicted_score),
    predictedMax: num(r.predicted_max),
    predictedBand: (r.predicted_band as string | null) ?? null,
    rubricVersion: r.rubric_version == null ? null : Number(r.rubric_version),
    detail: (r.detail as string | null) ?? null,
    payload,
    reviewedBy: r.reviewed_by == null ? null : Number(r.reviewed_by),
    reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    reviewNotes: (r.review_notes as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
