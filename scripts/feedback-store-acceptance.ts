/**
 * scripts/feedback-store-acceptance.ts
 *
 * Phase 1a — feedback store pure-logic acceptance.
 *
 * Exercises the pure helpers in feedback/store.ts: the curation-gate transition
 * guard, the score-ratio band, outcome polarity, and the calibration verdict
 * (the core B2 "did the predicted score match the real outcome" signal). The DB
 * layer (ensureFeedbackStore / insertFeedback / setFeedbackState /
 * getPromotedOutcomes) is verified by a live roundtrip against the connected DB.
 *
 * Usage:
 *   npx tsx scripts/feedback-store-acceptance.ts
 */

import {
  canTransition,
  scoreBand,
  outcomePolarity,
  calibrationVerdict,
  isFeedbackKind,
  isFeedbackState,
  isOutcomeValue,
} from "@/lib/feedback/store";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass(name);
    return;
  }
  fail(detail ? `${name} — got ${detail}` : name);
}

function main(): void {
  console.log("\n=== Phase 1a — feedback store pure logic ===\n");

  // ── validators ──
  check("isFeedbackKind accepts known kinds", isFeedbackKind("outcome") && isFeedbackKind("exemplar"));
  check("isFeedbackKind rejects junk", !isFeedbackKind("nope") && !isFeedbackKind(7));
  check("isFeedbackState accepts known states", isFeedbackState("captured") && isFeedbackState("promoted"));
  check("isOutcomeValue accepts known outcomes", isOutcomeValue("won") && isOutcomeValue("disqualified"));
  check("isOutcomeValue rejects junk", !isOutcomeValue("maybe"));

  // ── curation gate ──
  check("captured → promoted allowed", canTransition("captured", "promoted"));
  check("captured → rejected allowed", canTransition("captured", "rejected"));
  check("promoted → rejected allowed (admin correction)", canTransition("promoted", "rejected"));
  check("rejected → promoted allowed (admin correction)", canTransition("rejected", "promoted"));
  check("same-state is a no-op, not a transition", !canTransition("captured", "captured"));
  // @ts-expect-error — guarding the runtime path for bad data
  check("invalid state rejected", !canTransition("captured", "bogus"));

  // ── score band (ratio buckets) ──
  check("90/100 → strong", scoreBand(90, 100) === "strong", scoreBand(90, 100));
  check("60/100 → strong (boundary)", scoreBand(60, 100) === "strong", scoreBand(60, 100));
  check("50/100 → adequate", scoreBand(50, 100) === "adequate", scoreBand(50, 100));
  check("40/100 → adequate (boundary)", scoreBand(40, 100) === "adequate", scoreBand(40, 100));
  check("30/100 → weak", scoreBand(30, 100) === "weak", scoreBand(30, 100));
  check("null score → unknown", scoreBand(null, 100) === "unknown", scoreBand(null, 100));
  check("zero max → unknown (no divide-by-zero)", scoreBand(10, 0) === "unknown", scoreBand(10, 0));

  // ── outcome polarity ──
  check("won → positive", outcomePolarity("won") === "positive");
  check("shortlisted → positive", outcomePolarity("shortlisted") === "positive");
  check("lost → negative", outcomePolarity("lost") === "negative");
  check("disqualified → negative", outcomePolarity("disqualified") === "negative");
  check("withdrawn → neutral", outcomePolarity("withdrawn") === "neutral");
  check("pending → neutral", outcomePolarity("pending") === "neutral");

  // ── calibration verdict (the B2 signal) ──
  check("strong predicted + won → aligned", calibrationVerdict(82, 100, "won") === "aligned", calibrationVerdict(82, 100, "won"));
  check("weak predicted + lost → aligned", calibrationVerdict(30, 100, "lost") === "aligned", calibrationVerdict(30, 100, "lost"));
  check(
    "strong predicted + lost → optimistic (the dangerous miss)",
    calibrationVerdict(82, 100, "lost") === "optimistic",
    calibrationVerdict(82, 100, "lost"),
  );
  check(
    "weak predicted + won → pessimistic",
    calibrationVerdict(30, 100, "won") === "pessimistic",
    calibrationVerdict(30, 100, "won"),
  );
  check("undecided outcome → n/a", calibrationVerdict(82, 100, "pending") === "n/a", calibrationVerdict(82, 100, "pending"));
  check("withdrawn → n/a", calibrationVerdict(82, 100, "withdrawn") === "n/a", calibrationVerdict(82, 100, "withdrawn"));
  check("no predicted score → n/a", calibrationVerdict(null, null, "won") === "n/a", calibrationVerdict(null, null, "won"));
  check("50% predicted is competitive (boundary) + won → aligned", calibrationVerdict(50, 100, "won") === "aligned", calibrationVerdict(50, 100, "won"));

  console.log("");
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed.\n`);
    process.exit(1);
  }
  console.log("✓ all feedback-store pure-logic assertions passed.\n");
}

main();
