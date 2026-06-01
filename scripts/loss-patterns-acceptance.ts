/**
 * scripts/loss-patterns-acceptance.ts
 *
 * Phase 3 / Loop 2 — loss-reason aggregation acceptance (pure, no DB).
 *
 * Usage: npx tsx scripts/loss-patterns-acceptance.ts
 */

import { aggregateLossReasons } from "@/lib/feedback/loss-patterns";
import type { FeedbackRecord, FeedbackKind } from "@/lib/feedback/types";

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

function rec(kind: FeedbackKind, criterionId: string | null, agency: string | null, detail: string | null): FeedbackRecord {
  return {
    id: 0, kind, state: "captured", capturedFrom: "auto_score",
    userId: null, workOrderId: null, proposalPackageId: null,
    tenderTitle: null, agency, outcome: null, predictedScore: null, predictedMax: null,
    predictedBand: null, rubricVersion: null, detail,
    payload: criterionId === null ? {} : { criterionId },
    reviewedBy: null, reviewedAt: null, reviewNotes: null, createdAt: "", updatedAt: "",
  };
}

function main(): void {
  console.log("\n=== Phase 3 / Loop 2 — loss-reason aggregation ===\n");

  // grouping + sort-by-count
  {
    const out = aggregateLossReasons([
      rec("loss_reason", "1.2", "UNICEF", "thin risk register"),
      rec("loss_reason", "1.2", "UNOPS", "no risk register"),
      rec("loss_reason", "1.2", "UNICEF", "risk register missing"),
      rec("loss_reason", "1.4", "UNICEF", "weak past performance"),
    ]);
    check("groups by criterion, sorted by count", out.length === 2 && out[0].criterionId === "1.2" && out[0].count === 3 && out[1].count === 1, JSON.stringify(out.map((o) => [o.criterionId, o.count])));
    check("dedupes agencies", out[0].agencies.sort().join(",") === "UNICEF,UNOPS", out[0].agencies.join(","));
  }

  // ignores non-loss_reason kinds
  {
    const out = aggregateLossReasons([
      rec("outcome", "1.2", "UNICEF", "won"),
      rec("loss_reason", "1.2", "UNICEF", "weak"),
      rec("exemplar", "1.2", "UNICEF", "x"),
    ]);
    check("ignores outcome/exemplar records", out.length === 1 && out[0].count === 1, JSON.stringify(out));
  }

  // sample cap at 3
  {
    const out = aggregateLossReasons([
      rec("loss_reason", "2.1", "A", "s1"),
      rec("loss_reason", "2.1", "A", "s2"),
      rec("loss_reason", "2.1", "A", "s3"),
      rec("loss_reason", "2.1", "A", "s4"),
    ]);
    check("caps samples at 3 (count keeps rising)", out[0].count === 4 && out[0].samples.length === 3, `count=${out[0].count} samples=${out[0].samples.length}`);
  }

  // unspecified bucket for missing criterion id
  {
    const out = aggregateLossReasons([rec("loss_reason", null, "A", "notice-wide finding")]);
    check("missing criterionId → (unspecified) bucket", out.length === 1 && out[0].criterionId === "(unspecified)", JSON.stringify(out));
  }

  // empty
  {
    const out = aggregateLossReasons([]);
    check("empty → []", out.length === 0);
  }

  console.log("");
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed.\n`);
    process.exit(1);
  }
  console.log("✓ all loss-pattern assertions passed.\n");
}

main();
