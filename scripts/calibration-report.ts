/**
 * scripts/calibration-report.ts — the B2 calibration harness (operational).
 *
 * Reads PROMOTED outcome records and prints how well the predicted score lined
 * up with real results. Until `calibrated` is true the UI must keep presenting
 * the score conservatively (band, not a precise number). Watch the optimistic
 * rate — that's the "we said strong, they lost" dishonesty signal.
 *
 * Usage: npx tsx scripts/calibration-report.ts
 */

import { config } from "dotenv";
import { getPromotedOutcomes } from "@/lib/feedback/store";
import { computeCalibration } from "@/lib/feedback/calibration";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const outcomes = await getPromotedOutcomes();
  const r = computeCalibration(outcomes);

  console.log("\n=== Proposal score calibration (promoted outcomes only) ===\n");
  console.log(`  promoted outcomes   : ${r.totalOutcomes}`);
  console.log(`  decided sample      : ${r.sampleSize}`);
  console.log(`  aligned             : ${r.aligned} (${Math.round(r.alignedRate * 100)}%)`);
  console.log(`  optimistic misses   : ${r.optimistic} (${Math.round(r.optimisticRate * 100)}%)  <- watch this`);
  console.log(`  pessimistic         : ${r.pessimistic}`);
  console.log(`  calibrated (B3 gate): ${r.calibrated}`);
  console.log(`\n  ${r.note}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("calibration-report failed:", e);
    process.exit(1);
  });
