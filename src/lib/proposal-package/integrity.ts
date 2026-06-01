/**
 * integrity.ts — the per-run integrity / compliance monitor (Phase 2a).
 *
 * Runs on EVERY generated proposal output (cheap, pure — no LLM) and answers
 * three questions an admin needs to trust the pipeline:
 *   1. completeness  — did the run actually produce a score + a draft, or a
 *                      silent partial?
 *   2. scoreValidity — is the score a confident read, or built on a shaky
 *                      rubric extraction / contradictory confidence signals?
 *   3. honestClaim   — does the generated draft overpromise an OUTCOME
 *                      (winning, shortlisting, guarantees)? The product's claim
 *                      is "compliant + rubric-scored + gaps surfaced", never an
 *                      outcome guarantee.
 *
 * It MONITORS — it does not gate or change the engine. The verdict is stored on
 * the output and aggregated by /api/admin/proposal-health. Silent failure is a
 * launch blocker (AGENTS.md); this makes each run's health explicit.
 */

import type { ScoreResult, DraftSection, TenderRubric } from "./scoring-engine";

export interface IntegrityCheck {
  pass: boolean;
  detail: string;
}

export interface IntegrityVerdict {
  /** True when no integrity check failed. A rollup for the monitor, not a gate. */
  ok: boolean;
  completeness: IntegrityCheck;
  scoreValidity: IntegrityCheck;
  honestClaim: IntegrityCheck;
  /** Plain-language issues (failing checks), for the admin health view + logs. */
  flags: string[];
}

/** Tight outcome-promise patterns. Deliberately conservative — "win" alone is
 *  too common ("winning approach", "win-win"), so each pattern requires an
 *  explicit promise of a procurement OUTCOME. */
const OVERPROMISE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "guarantee_outcome", re: /\bguarantee(?:d|s)?\b[\s\S]{0,40}?\b(?:win|won|award(?:ed)?|select(?:ed|ion)?|shortlist(?:ed|ing)?|success)\b/i },
  { id: "will_win", re: /\b(?:we|you|this proposal|our (?:bid|proposal))\s+will\s+win\b/i },
  { id: "guaranteed_to", re: /\bguaranteed\s+to\s+(?:win|be\s+(?:shortlisted|selected|awarded))\b/i },
  { id: "ensures_outcome", re: /\bensure(?:s|d)?\b[\s\S]{0,20}?\b(?:win|award|selection|shortlisting)\b/i },
];

export function assessIntegrity(args: {
  score?: ScoreResult | null;
  draft?: DraftSection[] | null;
  rubric?: TenderRubric | null;
}): IntegrityVerdict {
  const { score, draft, rubric } = args;
  const flags: string[] = [];

  // 1. Completeness — a scored run must carry both a score (with lots) and a
  //    non-empty draft body. Either missing is a silent partial.
  const hasScore = !!score && Array.isArray(score.lotResults) && score.lotResults.length > 0;
  const hasDraft = Array.isArray(draft) && draft.some((d) => typeof d.content === "string" && d.content.trim().length > 0);
  let completeness: IntegrityCheck;
  if (hasScore && hasDraft) {
    completeness = { pass: true, detail: "Score and draft body both present." };
  } else {
    const missing = [!hasScore ? "score" : null, !hasDraft ? "draft body" : null].filter(Boolean).join(" + ");
    completeness = { pass: false, detail: `Run produced no ${missing} — possible silent partial.` };
    flags.push(`incomplete: missing ${missing}`);
  }

  // 2. Score validity — low-confidence extraction means the score is indicative,
  //    and broad mechanical-vs-LLM disagreement means the confidence signals
  //    can't be trusted.
  const extraction = rubric?.extractionConfidence?.level ?? null;
  let criteria = 0;
  let disagreements = 0;
  if (score) {
    for (const lr of score.lotResults ?? []) {
      for (const c of lr.perCriterion ?? []) {
        criteria += 1;
        if (c.mechanicalConfidence && c.mechanicalConfidence !== c.confidence) disagreements += 1;
      }
    }
  }
  const disagreementRate = criteria > 0 ? disagreements / criteria : 0;
  let scoreValidity: IntegrityCheck;
  if (extraction === "low") {
    scoreValidity = { pass: false, detail: "Score rests on a low-confidence rubric extraction — indicative only." };
    flags.push("score-validity: low-confidence extraction");
  } else if (disagreementRate > 0.5) {
    scoreValidity = { pass: false, detail: `Mechanical vs LLM confidence disagree on ${Math.round(disagreementRate * 100)}% of criteria.` };
    flags.push("score-validity: high confidence disagreement");
  } else {
    scoreValidity = {
      pass: true,
      detail: extraction ? `Extraction ${extraction}; confidence signals consistent.` : "Confidence signals consistent.",
    };
  }

  // 3. Honest claim — scan the generated draft for outcome-promise language.
  const text = (draft ?? []).map((d) => (typeof d.content === "string" ? d.content : "")).join("\n");
  const hits = OVERPROMISE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  let honestClaim: IntegrityCheck;
  if (hits.length > 0) {
    honestClaim = { pass: false, detail: `Draft contains outcome-promise language: ${hits.join(", ")}.` };
    flags.push(`honest-claim: outcome-promise language (${hits.join(", ")})`);
  } else {
    honestClaim = { pass: true, detail: "No outcome-promise language detected." };
  }

  const ok = completeness.pass && scoreValidity.pass && honestClaim.pass;
  return { ok, completeness, scoreValidity, honestClaim, flags };
}
