/**
 * revision-loop.ts — orchestrate generate → score → revise → re-score for $299.
 *
 * Sprint 2 scope. The self-check loop that makes the $299 Proposal Draft
 * "way better than a generic LLM": after generating the draft, score it
 * against the extracted rubric, identify weak sections + triggered
 * disqualifiers, and run a single revision pass targeted at the gaps.
 *
 * Capped at MAX_ATTEMPTS = 2 to keep cost predictable. The pdfDocs renderer
 * downstream surfaces all attempts in the revision history.
 */

import type {
  TenderInput,
  TenderRubric,
  DraftSection,
  ScoreResult,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";
import { generateDraftSections, type RevisionGuidance } from "./draft-generator";
import { scoreDraft } from "./rubric-scorer";
import { detectAndApplyCascades, type Cascade } from "./cross-section-cascade";

const MAX_ATTEMPTS = 2;

export interface RevisionAttemptSummary {
  attempt: number;
  estimatedTotal: number;
  achievableTotal: number;
  passesGating: boolean;
  triggeredDisqualifierIds: string[];
  weakCriteriaIds: string[];
}

export interface RevisionLoopResult {
  finalDraft: DraftSection[];
  finalScore: ScoreResult;
  attempts: number;
  history: RevisionAttemptSummary[];
  /**
   * Sprint 4.6: cross-section evidence-dependency cascades surfaced by the
   * cascade-detection pass (cross-section-cascade.ts). Each cascade's gap
   * is appended to the affected downstream sections' claims, so the score
   * + routing already reflect them; this top-level array carries the
   * structured cascade metadata for the UI to render upstream→downstream
   * links explicitly.
   */
  cascades: Cascade[];
}

export async function runRevisionLoop(
  tenderInput: TenderInput,
  rubric: TenderRubric,
  applicant: ApplicantContext,
): Promise<RevisionLoopResult> {
  let draft = await generateDraftSections(tenderInput, rubric, applicant);

  // Sprint 4.6 (A5 finding #6): cross-section cascade detection runs AFTER
  // generation, BEFORE scoring, so cascaded gaps flow through the score +
  // routing path naturally. The draft-generator prompt already includes the
  // DEPENDENCY RULE — this is the backstop for cases the LLM missed inline.
  const initial = await detectAndApplyCascades(draft, applicant);
  draft = initial.draft;
  const allCascades: Cascade[] = [...initial.cascades];

  let score = await scoreDraft(draft, rubric, applicant);

  const history: RevisionAttemptSummary[] = [summarize(1, draft, score, rubric)];
  let attempts = 1;

  while (attempts < MAX_ATTEMPTS && needsRevision(score)) {
    const guidance = buildRevisionGuidance(score);
    if (guidance.length === 0) break; // nothing actionable to revise

    draft = await generateDraftSections(tenderInput, rubric, applicant, {
      revisionGuidance: guidance,
      priorSections: draft,
    });

    // Re-run cascade detection on the revised draft — revisions can
    // introduce new inconsistencies the original pass didn't see.
    const revised = await detectAndApplyCascades(draft, applicant);
    draft = revised.draft;
    // Dedupe by (sourceCriterionId + missingArtifact) so re-runs that catch
    // the same cascade twice don't bloat the surface.
    for (const c of revised.cascades) {
      const key = `${c.sourceCriterionId}|${c.missingArtifact.toLowerCase()}`;
      if (!allCascades.some((x) => `${x.sourceCriterionId}|${x.missingArtifact.toLowerCase()}` === key)) {
        allCascades.push(c);
      }
    }

    score = await scoreDraft(draft, rubric, applicant);
    attempts += 1;
    history.push(summarize(attempts, draft, score, rubric));
  }

  return { finalDraft: draft, finalScore: score, attempts, history, cascades: allCascades };
}

function needsRevision(score: ScoreResult): boolean {
  if (score.noticeWideDisqualifiersTriggered.length > 0) return true;
  for (const lr of score.lotResults) {
    if (!lr.passesGating) return true;
    if (lr.lotDisqualifiersTriggered.length > 0) return true;
    for (const c of lr.perCriterion) {
      if (c.confidence === "gap") return true;
      // Treat anything below 50% of max as actionable for revision
      if (c.estimatedScore < c.maxScore * 0.5) return true;
    }
  }
  return false;
}

function buildRevisionGuidance(score: ScoreResult): RevisionGuidance[] {
  const guidance: RevisionGuidance[] = [];
  for (const lr of score.lotResults) {
    for (const c of lr.perCriterion) {
      const weak =
        c.confidence === "gap" ||
        c.estimatedScore < c.maxScore * 0.5 ||
        c.weaknesses.length > 0 ||
        c.missingEvidence.length > 0;
      if (!weak) continue;
      guidance.push({
        criterionId: c.criterionId,
        estimatedScore: c.estimatedScore,
        maxScore: c.maxScore,
        weaknesses: c.weaknesses,
        missingEvidence: c.missingEvidence,
      });
    }
  }
  return guidance;
}

function summarize(
  attempt: number,
  draft: DraftSection[],
  score: ScoreResult,
  rubric: TenderRubric,
): RevisionAttemptSummary {
  // Achievable = sum of all maxScores across all lots and criteria
  const achievableTotal = rubric.lots.reduce(
    (s, lot) => s + lot.criteria.reduce((ss, c) => ss + c.maxScore, 0),
    0,
  );
  const estimatedTotal = score.lotResults.reduce((s, lr) => s + lr.estimatedTotal, 0);
  const passesGating = score.lotResults.every((lr) => lr.passesGating);

  const triggeredDisqualifierIds: string[] = [];
  for (const d of score.noticeWideDisqualifiersTriggered) triggeredDisqualifierIds.push(`notice-wide:${d.id}`);
  for (const lr of score.lotResults) {
    for (const d of lr.lotDisqualifiersTriggered) triggeredDisqualifierIds.push(`${lr.lotId}:${d.id}`);
  }

  const weakCriteriaIds: string[] = [];
  for (const lr of score.lotResults) {
    for (const c of lr.perCriterion) {
      if (c.confidence === "gap" || c.weaknesses.length > 0) {
        weakCriteriaIds.push(`${lr.lotId}:${c.criterionId}`);
      }
    }
  }

  return {
    attempt,
    estimatedTotal,
    achievableTotal,
    passesGating,
    triggeredDisqualifierIds,
    weakCriteriaIds,
  };
}
