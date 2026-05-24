/**
 * reextract.ts — orchestrates "amendment landed → diff against prior rubric".
 *
 * Sprint 3 scope. When a corrigendum / amendment / binding Q&A round lands
 * mid-flight (between extraction and submission), the system must:
 *   1. Re-extract the rubric against the FULL document set (prior + new docs)
 *   2. Diff against the prior rubric → RubricDelta[]
 *   3. If anything changed, bump rubricVersion on the new rubric
 *   4. Return { rubric, changed, deltas } so the caller can:
 *        - record a new immutable GenerationSnapshot
 *        - flag any GenerationSnapshot whose rubricVersion is now stale
 *        - flip generation_status to 'rubric_stale' for any in-flight draft
 *
 * The amendment-versioning flow is documented in
 * docs/agents/amendment-versioning-flow.md.
 *
 * Implementation note: the prior rubric's tenderId + lane + methodology +
 * lotMetadata become the starting TenderInput; newDocs are merged into the
 * prior manifest (deduplicated by docId; later entries supersede earlier
 * by content-hash via the manifest-loader). The merged set re-runs the
 * Sprint 1 extractor.
 */

import type {
  TenderRubric,
  TenderInput,
  IngestedDoc,
  RubricDelta,
} from "./scoring-engine";
import { diffRubrics } from "./rubric-diff";

export interface ReextractInput {
  /** The rubric we're diffing against (the one currently treated as authoritative). */
  priorRubric: TenderRubric;
  /**
   * The full prior document set (so the extractor sees the entire context,
   * not just the new amendment in isolation). Comes from the same
   * LoadedTender that produced priorRubric.
   */
  priorDocs: IngestedDoc[];
  /** New docs that landed since priorRubric was extracted. */
  newDocs: IngestedDoc[];
  /**
   * Optional binding Q&A clarifications to pass through to the extractor.
   * When the new docs include a Q&A round, callers should re-derive these
   * via qa-extractor.ts and pass the full set here (binding only).
   */
  bindingClarifications?: TenderInput["bindingClarifications"];
}

export interface ReextractResult {
  rubric: TenderRubric;
  changed: boolean;
  deltas: RubricDelta[];
}

export async function reextractAndDiff(
  input: ReextractInput,
): Promise<ReextractResult> {
  const { priorRubric, priorDocs, newDocs, bindingClarifications } = input;

  // Merge docs: prior + new, deduplicated by docId. The manifest-loader's
  // supersession pass has already been applied to both lists individually;
  // we trust those manifests and just union by docId.
  const seen = new Set<string>();
  const mergedDocs: IngestedDoc[] = [];
  for (const d of [...priorDocs, ...newDocs]) {
    if (seen.has(d.manifest.docId)) continue;
    seen.add(d.manifest.docId);
    mergedDocs.push(d);
  }

  const tenderInput: TenderInput = {
    tenderId: priorRubric.tenderId,
    lane: priorRubric.lane,
    methodology: priorRubric.methodology,
    lotMetadata: priorRubric.lots.map((l) => ({
      lotId: l.lotId,
      label: l.label,
      scope: l.scope,
    })),
    docs: mergedDocs,
    bindingClarifications,
  };

  // Lazy import to keep this module cycle-free (rubric-extractor imports
  // types from scoring-engine; scoring-engine's DefaultScoringEngine
  // delegates here).
  const { extractRubricFromInput } = await import("./rubric-extractor");
  const nextRubric = await extractRubricFromInput(tenderInput);

  const deltas = diffRubrics(priorRubric, nextRubric);
  const changed = deltas.length > 0;

  // Bump rubricVersion only when the diff is non-empty. A no-op re-extract
  // returns the prior version so callers can no-op too (no fake stale).
  const finalRubric: TenderRubric = {
    ...nextRubric,
    rubricVersion: changed
      ? Math.max(priorRubric.rubricVersion, nextRubric.rubricVersion) + 1
      : priorRubric.rubricVersion,
  };

  return { rubric: finalRubric, changed, deltas };
}
