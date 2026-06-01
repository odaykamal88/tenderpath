/**
 * scripts/calibration-acceptance.ts
 *
 * Phase 1c — calibration harness pure-logic acceptance. Exercises
 * computeCalibration(): sample-size gate, optimistic-rate gate (the B3
 * graduation condition), and n/a exclusion. No DB.
 *
 * Usage: npx tsx scripts/calibration-acceptance.ts
 */

import { computeCalibration, CALIBRATION_MIN_SAMPLE } from "@/lib/feedback/calibration";
import type { FeedbackRecord, OutcomeValue } from "@/lib/feedback/types";

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

function mkOutcome(outcome: OutcomeValue, predictedScore: number | null, predictedMax: number | null): FeedbackRecord {
  return {
    id: 0, kind: "outcome", state: "promoted", capturedFrom: "user_prompt",
    userId: null, workOrderId: null, proposalPackageId: null,
    tenderTitle: null, agency: null, outcome, predictedScore, predictedMax,
    predictedBand: null, rubricVersion: null, detail: null, payload: {},
    reviewedBy: null, reviewedAt: null, reviewNotes: null, createdAt: "", updatedAt: "",
  };
}
function repeat(rec: FeedbackRecord, n: number): FeedbackRecord[] {
  return Array.from({ length: n }, () => rec);
}

function main(): void {
  console.log("\n=== Phase 1c — calibration harness ===\n");

  // 1. empty
  {
    const r = computeCalibration([]);
    check("empty → sampleSize 0, not calibrated", r.sampleSize === 0 && !r.calibrated, `${r.sampleSize}/${r.calibrated}`);
  }

  // 2. plenty aligned → calibrated
  {
    const r = computeCalibration(repeat(mkOutcome("won", 80, 100), 22));
    check("22 aligned → calibrated, optimisticRate 0", r.calibrated && r.optimisticRate === 0 && r.sampleSize === 22, `cal=${r.calibrated} rate=${r.optimisticRate} n=${r.sampleSize}`);
  }

  // 3. boundary: 20 sample, exactly 20% optimistic → still calibrated (<=)
  {
    const r = computeCalibration([...repeat(mkOutcome("won", 80, 100), 16), ...repeat(mkOutcome("lost", 80, 100), 4)]);
    check("20 sample @ 20% optimistic (boundary) → calibrated", r.sampleSize === 20 && r.optimistic === 4 && r.calibrated, `n=${r.sampleSize} opt=${r.optimistic} cal=${r.calibrated}`);
  }

  // 4. over the optimistic threshold → NOT calibrated
  {
    const r = computeCalibration([...repeat(mkOutcome("won", 80, 100), 15), ...repeat(mkOutcome("lost", 80, 100), 5)]);
    check("20 sample @ 25% optimistic → NOT calibrated", r.sampleSize === 20 && !r.calibrated, `n=${r.sampleSize} rate=${r.optimisticRate} cal=${r.calibrated}`);
  }

  // 5. below sample size → not enough
  {
    const r = computeCalibration(repeat(mkOutcome("won", 80, 100), CALIBRATION_MIN_SAMPLE - 1));
    check("19 aligned (under sample floor) → not calibrated", !r.calibrated && r.note.toLowerCase().includes("not enough"), `cal=${r.calibrated}`);
  }

  // 6. n/a exclusion: pending + null-score outcomes don't count toward sampleSize
  {
    const recs = [
      ...repeat(mkOutcome("won", 80, 100), 22),
      ...repeat(mkOutcome("pending", 80, 100), 5),   // undecided → n/a
      ...repeat(mkOutcome("won", null, null), 5),    // no predicted score → n/a
    ];
    const r = computeCalibration(recs);
    check("pending + no-score excluded from sampleSize", r.sampleSize === 22 && r.totalOutcomes === 32, `n=${r.sampleSize} total=${r.totalOutcomes}`);
  }

  // 7. pessimistic (weak-rated but won) doesn't block calibration
  {
    const r = computeCalibration([...repeat(mkOutcome("won", 80, 100), 20), ...repeat(mkOutcome("won", 30, 100), 3)]);
    check("pessimistic misses don't fail calibration", r.pessimistic === 3 && r.calibrated, `pess=${r.pessimistic} cal=${r.calibrated}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed.\n`);
    process.exit(1);
  }
  console.log("✓ all calibration assertions passed.\n");
}

main();
