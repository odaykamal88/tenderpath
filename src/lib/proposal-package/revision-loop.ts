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
}

export async function runRevisionLoop(
  tenderInput: TenderInput,
  rubric: TenderRubric,
  applicant: ApplicantContext,
): Promise<RevisionLoopResult> {
  let draft = await generateDraftSections(tenderInput, rubric, applicant);
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
    score = await scoreDraft(draft, rubric, applicant);
    attempts += 1;
    history.push(summarize(attempts, draft, score, rubric));
  }

  return { finalDraft: draft, finalScore: score, attempts, history };
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
