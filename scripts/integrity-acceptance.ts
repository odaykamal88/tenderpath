/**
 * scripts/integrity-acceptance.ts
 *
 * Phase 2a — per-run integrity monitor acceptance. Pure, no DB. Covers
 * completeness, score-validity (low extraction + confidence disagreement), and
 * the honest-claim scan (outcome-promise true-positives AND a false-positive
 * guard on legitimate "winning approach" language).
 *
 * Usage: npx tsx scripts/integrity-acceptance.ts
 */

import { assessIntegrity } from "@/lib/proposal-package/integrity";
import type { ScoreResult, DraftSection, TenderRubric, CriterionAssessment, Confidence } from "@/lib/proposal-package/scoring-engine";

let failures = 0;
function fail(m: string): void {
  console.error(`    ✗ ${m}`);
  failures += 1;
}
function pass(m: string): void {
  console.log(`    ✓ ${m}`);
}
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) pass(name);
  else fail(detail ? `${name} — got ${detail}` : name);
}

function crit(confidence: Confidence, mech?: Confidence): CriterionAssessment {
  return { criterionId: "1.1", estimatedScore: 8, maxScore: 10, confidence, mechanicalConfidence: mech, weaknesses: [], missingEvidence: [] };
}
function score(crits: CriterionAssessment[]): ScoreResult {
  return {
    rubricVersion: 1,
    lotResults: [{ lotId: "main", perCriterion: crits, estimatedTotal: 8, lotDisqualifiersTriggered: [], passesGating: true }],
    noticeWideDisqualifiersTriggered: [],
    routedGaps: [],
  };
}
function draft(content: string): DraftSection[] {
  return [{ lotId: "main", criterionId: "1.1", content, claims: [] }];
}
// assessIntegrity only reads rubric.extractionConfidence?.level — cast a partial.
function rubric(level?: "high" | "medium" | "low"): TenderRubric {
  return (level ? { extractionConfidence: { level } } : {}) as unknown as TenderRubric;
}

function main(): void {
  console.log("\n=== Phase 2a — per-run integrity monitor ===\n");

  // 1. healthy run
  {
    const v = assessIntegrity({ score: score([crit("evidenced", "evidenced")]), draft: draft("Our approach delivers across three phases."), rubric: rubric("high") });
    check("complete + valid + honest → ok", v.ok && v.flags.length === 0, JSON.stringify(v.flags));
  }

  // 2. empty draft → completeness fail
  {
    const v = assessIntegrity({ score: score([crit("evidenced")]), draft: [], rubric: rubric("high") });
    check("score but empty draft → completeness fail", !v.ok && !v.completeness.pass, JSON.stringify(v.flags));
  }

  // 3. no score → completeness fail
  {
    const v = assessIntegrity({ score: null, draft: draft("content"), rubric: rubric("high") });
    check("no score → completeness fail", !v.completeness.pass && v.flags.some((f) => f.includes("score")), JSON.stringify(v.flags));
  }

  // 4. low extraction → scoreValidity fail
  {
    const v = assessIntegrity({ score: score([crit("inferred")]), draft: draft("content"), rubric: rubric("low") });
    check("low extraction → scoreValidity fail", !v.scoreValidity.pass && !v.ok, JSON.stringify(v.flags));
  }

  // 5. high mechanical-vs-LLM disagreement → scoreValidity fail
  {
    const v = assessIntegrity({ score: score([crit("evidenced", "gap"), crit("evidenced", "gap")]), draft: draft("content"), rubric: rubric("high") });
    check("high confidence disagreement → scoreValidity fail", !v.scoreValidity.pass, JSON.stringify(v.flags));
  }

  // 6. overpromise: guarantee a win
  {
    const v = assessIntegrity({ score: score([crit("evidenced")]), draft: draft("We guarantee a win on this tender."), rubric: rubric("high") });
    check("'guarantee a win' → honestClaim fail", !v.honestClaim.pass && !v.ok, JSON.stringify(v.flags));
  }

  // 7. false-positive guard: legitimate language must NOT flag
  {
    const v = assessIntegrity({ score: score([crit("evidenced")]), draft: draft("Our winning approach ensures high-quality delivery and a strong, compliant submission."), rubric: rubric("high") });
    check("legit 'winning approach / ensures quality' → honestClaim PASS", v.honestClaim.pass && v.ok, JSON.stringify(v.flags));
  }

  // 8. 'you will win'
  {
    const v = assessIntegrity({ score: score([crit("evidenced")]), draft: draft("With this proposal you will win the contract."), rubric: rubric("high") });
    check("'you will win' → honestClaim fail", !v.honestClaim.pass, JSON.stringify(v.flags));
  }

  console.log("");
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed.\n`);
    process.exit(1);
  }
  console.log("✓ all integrity assertions passed.\n");
}

main();
