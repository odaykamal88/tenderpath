/**
 * snapshot.ts — immutable generation snapshots.
 *
 * Sprint 3 scope. Implements the "no silent overwrite" guardrail
 * (AGENTS.md Golden Rule, scoring-engine.ts header rule 3): every run that
 * produces a draft + score writes an immutable GenerationSnapshot; re-runs
 * NEVER mutate prior snapshots, they create new ones and mark the prior
 * as supersededBy. The amendment-versioning flow uses this to keep history
 * intact even when a corrigendum invalidates a draft mid-flight.
 *
 * Sprint 3 is in-memory: this module produces typed snapshot objects with
 * deterministic hashes. Database persistence to `generation_snapshots` (or
 * an array column on `proposal_packages`) lands with the Sprint 6 work-order
 * UI, when there's actually a user-facing surface that needs to read them.
 *
 * Hash strategy:
 *   - contextHash = sha256 of (docManifest sorted by docId + applicantContext)
 *   - promptHash  = sha256 of (prompt-template version string)
 * Stable across runs with identical inputs; different across runs that
 * touched ANYTHING in the context. The promptHash drifts only when the
 * extractor/scorer prompts are intentionally bumped.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  GenerationSnapshot,
  DocManifestEntry,
  ScoreResult,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";

/**
 * Bump this when the extractor/scorer prompt templates change in ways that
 * could shift the LLM's output even on identical inputs. Sprint 3 baseline.
 */
export const PROMPT_TEMPLATE_VERSION = "sprint-3.0";

export interface RecordSnapshotInput {
  rubricVersion: number;
  documentManifest: DocManifestEntry[];
  /**
   * The ScoreResult this snapshot pins. Carried for caller convenience;
   * the snapshot itself only stores scoreResultId. Future callers can use
   * this to attach the score to the snapshot id in their persistence layer.
   */
  scoreResult?: ScoreResult;
  /** Stable identifier the caller uses to point future records at this run. */
  scoreResultId: string;
  /** Optional. The applicant evidence the run scored against. */
  applicant?: ApplicantContext;
  /** Optional. Override prompt template version (defaults to module constant). */
  promptTemplateVersion?: string;
}

/**
 * Build an immutable GenerationSnapshot from a rich input — computes the
 * contextHash and promptHash from the document manifest + applicant +
 * prompt-template version. Use this from acceptance scripts and from the
 * Sprint 6 work-order code where you have the full context at hand.
 *
 * For the lower-level ScoringEngine.recordSnapshot interface contract
 * (caller pre-builds hashes), use assembleSnapshot() instead.
 */
export function recordSnapshot(input: RecordSnapshotInput): GenerationSnapshot {
  const promptVersion = input.promptTemplateVersion ?? PROMPT_TEMPLATE_VERSION;
  return assembleSnapshot({
    rubricVersion: input.rubricVersion,
    contextHash: computeContextHash(input.documentManifest, input.applicant),
    promptHash: computePromptHash(promptVersion),
    documentManifest: input.documentManifest,
    scoreResultId: input.scoreResultId,
  });
}

/**
 * Lower-level snapshot builder used by ScoringEngine.recordSnapshot. The
 * caller pre-builds every field except snapshotId + generatedAt; this
 * function just stamps the id + timestamp and clones the manifest to keep
 * the snapshot immutable.
 */
export function assembleSnapshot(
  input: Omit<GenerationSnapshot, "snapshotId" | "generatedAt">,
): GenerationSnapshot {
  return {
    ...input,
    snapshotId: randomUUID(),
    generatedAt: new Date().toISOString(),
    documentManifest: input.documentManifest.map((e) => ({ ...e })),
  };
}

/**
 * Mark a snapshot as superseded by a newer one. Returns a NEW object;
 * never mutates the input. Idempotent: marking the same supersededBy twice
 * returns equivalent output.
 */
export function markSupersededBy(
  prior: GenerationSnapshot,
  newSnapshotId: string,
): GenerationSnapshot {
  return { ...prior, supersededBy: newSnapshotId };
}

/**
 * Deterministic hash over the assembled context: the document manifest
 * (sorted by docId for stability) + a normalised applicant signature.
 *
 * Two runs with identical docs + applicant produce identical contextHash;
 * any change to a doc's contentHash, the doc set membership, or the
 * applicant's identifying fields produces a different contextHash.
 */
export function computeContextHash(
  manifest: DocManifestEntry[],
  applicant?: ApplicantContext,
): string {
  const sortedManifest = [...manifest]
    .sort((a, b) => a.docId.localeCompare(b.docId))
    .map((e) => ({
      docId: e.docId,
      contentHash: e.contentHash,
      role: e.role,
      supersedes: (e.supersedes ?? []).slice().sort(),
    }));

  // Applicant signature: only the identifying + structural fields that
  // would shift a rubric-aware run. The full evidence library lives
  // alongside, but only these keys change the deterministic context.
  const applicantSig = applicant
    ? {
        companyName: applicant.companyName,
        countryOfRegistration: applicant.countryOfRegistration,
        unSupplierRegistration: applicant.unSupplierRegistration,
        sectorsCovered: applicant.sectorsCovered,
      }
    : null;

  const payload = JSON.stringify({ manifest: sortedManifest, applicant: applicantSig });
  return sha256(payload);
}

export function computePromptHash(promptTemplateVersion: string): string {
  return sha256(`prompt-template:${promptTemplateVersion}`);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Determine whether a snapshot is now stale relative to the current
 * authoritative rubric. Pure read: a snapshot is stale when its
 * rubricVersion < the current rubricVersion. The amendment-versioning
 * flow uses this to flip generation_status = 'rubric_stale' on every
 * affected in-flight package.
 */
export function isSnapshotStale(
  snapshot: GenerationSnapshot,
  currentRubricVersion: number,
): boolean {
  return snapshot.rubricVersion < currentRubricVersion;
}
