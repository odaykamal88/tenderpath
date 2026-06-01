/**
 * scripts/proposal-worker-acceptance.ts
 *
 * Sprint 11 — background-job worker queue policy acceptance.
 *
 * Verifies the pure helpers in queue.ts that decide which rows the worker
 * should reap (status='generating' → 'pending') and which it should claim
 * (status='pending' → 'generating'). The DB-backed UPDATE/INSERT helpers
 * (claimNextPending, reapStaleGenerating, enqueueProposalGeneration) are
 * verified by manual + preview-deploy testing — same pattern as Sprint 6c's
 * rate-limit acceptance separating pure quota math from DB integration.
 *
 * Decision branches covered:
 *
 *   shouldReap:
 *     - status='generating' + age > 10min  → reap
 *     - status='generating' + age = 10min  → no reap (strict greater-than)
 *     - status='generating' + age < 10min  → no reap
 *     - status='ready'                     → no reap (terminal)
 *     - status='failed'                    → no reap (terminal)
 *     - status='pending'                   → no reap (already queued)
 *     - status='rubric_stale'              → no reap (terminal-blocked)
 *     - null updated_at                    → no reap (unknown age)
 *     - garbage updated_at                 → no reap (defensive)
 *     - custom staleMinutes override       → reap fires at custom threshold
 *
 *   isClaimable:
 *     - status='pending' + work_order_id  + attempts < cap → claimable
 *     - status='pending' + work_order_id  + attempts = cap → not claimable
 *     - status='pending' + work_order_id  + attempts > cap → not claimable
 *     - status='pending' + no work_order_id                → not claimable (orphan)
 *     - status='generating'                                → not claimable (already running)
 *     - status='ready' / 'failed'                          → not claimable
 *     - undefined / null attempts (treat as 0)             → claimable
 *
 * Usage:
 *   npx tsx scripts/proposal-worker-acceptance.ts
 */

import {
  shouldReap,
  isClaimable,
  STALE_GENERATING_MINUTES,
  SOFT_ATTEMPT_CAP,
  type ProposalQueueRow,
} from "@/lib/proposal-package/queue";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

function minutesAgo(min: number, now: Date): Date {
  return new Date(now.getTime() - min * 60 * 1000);
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 11 — proposal-worker queue policy acceptance ===");
  console.log(`  STALE_GENERATING_MINUTES=${STALE_GENERATING_MINUTES}`);
  console.log(`  SOFT_ATTEMPT_CAP=${SOFT_ATTEMPT_CAP}\n`);

  const NOW = new Date("2026-06-01T12:00:00Z");

  // ----------------------------------------------------------------------
  // shouldReap
  // ----------------------------------------------------------------------
  console.log("  test 1: generating row > stale threshold → reap");
  {
    const row: ProposalQueueRow = {
      id: 1,
      work_order_id: 10,
      generation_status: "generating",
      generation_attempts: 1,
      updated_at: minutesAgo(15, NOW),
    };
    if (!shouldReap(row, NOW)) fail("expected reap=true");
    else pass(`15min-old generating row reaped`);
  }

  console.log("\n  test 2: generating row exactly AT threshold → no reap (strict >)");
  {
    const row: ProposalQueueRow = {
      id: 1,
      work_order_id: 10,
      generation_status: "generating",
      generation_attempts: 1,
      updated_at: minutesAgo(STALE_GENERATING_MINUTES, NOW),
    };
    if (shouldReap(row, NOW)) fail("row exactly at threshold should NOT reap");
    else pass(`row exactly at boundary excluded by strict >`);
  }

  console.log("\n  test 3: generating row < threshold → no reap");
  {
    const row: ProposalQueueRow = {
      id: 1,
      work_order_id: 10,
      generation_status: "generating",
      generation_attempts: 1,
      updated_at: minutesAgo(3, NOW),
    };
    if (shouldReap(row, NOW)) fail("3min row should NOT reap");
    else pass(`fresh generating row left alone`);
  }

  console.log("\n  test 4: terminal statuses never reap (ready / failed / rubric_stale / needs_remediation)");
  {
    const old = minutesAgo(60, NOW);
    const cases: Array<ProposalQueueRow["generation_status"]> = [
      "ready",
      "failed",
      "rubric_stale",
      "needs_remediation",
      "pending", // pending is non-terminal but also not a reap target
    ];
    for (const status of cases) {
      const row: ProposalQueueRow = {
        id: 1,
        work_order_id: 10,
        generation_status: status,
        generation_attempts: 1,
        updated_at: old,
      };
      if (shouldReap(row, NOW)) {
        fail(`status=${status} should never reap`);
        return;
      }
    }
    pass(`all non-generating statuses left alone (ready/failed/rubric_stale/needs_remediation/pending)`);
  }

  console.log("\n  test 5: null / unparseable updated_at → no reap (defensive)");
  {
    const a: ProposalQueueRow = { id: 1, work_order_id: 10, generation_status: "generating", generation_attempts: 1, updated_at: null };
    const b: ProposalQueueRow = { id: 2, work_order_id: 10, generation_status: "generating", generation_attempts: 1, updated_at: "garbage-timestamp" };
    if (shouldReap(a, NOW)) fail("null updated_at should not reap");
    else if (shouldReap(b, NOW)) fail("unparseable updated_at should not reap");
    else pass(`unknown age → safe default of no reap`);
  }

  console.log("\n  test 6: custom staleMinutes override");
  {
    const row: ProposalQueueRow = {
      id: 1,
      work_order_id: 10,
      generation_status: "generating",
      generation_attempts: 1,
      updated_at: minutesAgo(3, NOW),
    };
    // With override=2min, the 3min-old row IS reapable.
    if (!shouldReap(row, NOW, 2)) fail("override staleMinutes=2 should reap 3min row");
    // With override=5min, the 3min-old row is NOT reapable.
    else if (shouldReap(row, NOW, 5)) fail("override staleMinutes=5 should NOT reap 3min row");
    else pass(`staleMinutes param threads through correctly`);
  }

  console.log("\n  test 7: updated_at as Date object vs ISO string both work");
  {
    const asDate: ProposalQueueRow = {
      id: 1, work_order_id: 10, generation_status: "generating", generation_attempts: 1,
      updated_at: minutesAgo(20, NOW),
    };
    const asString: ProposalQueueRow = {
      id: 2, work_order_id: 10, generation_status: "generating", generation_attempts: 1,
      updated_at: minutesAgo(20, NOW).toISOString(),
    };
    if (!shouldReap(asDate, NOW)) fail("Date variant should reap");
    else if (!shouldReap(asString, NOW)) fail("ISO string variant should reap");
    else pass(`Date and ISO string both reap when stale`);
  }

  // ----------------------------------------------------------------------
  // isClaimable
  // ----------------------------------------------------------------------
  console.log("\n  test 8: pending + work_order_id + attempts < cap → claimable");
  {
    const row: ProposalQueueRow = {
      id: 1, work_order_id: 42, generation_status: "pending", generation_attempts: 3, updated_at: NOW,
    };
    if (!isClaimable(row)) fail("expected claimable");
    else pass(`healthy pending row claimable`);
  }

  console.log("\n  test 9: pending + attempts = SOFT_ATTEMPT_CAP → not claimable");
  {
    const row: ProposalQueueRow = {
      id: 1, work_order_id: 42, generation_status: "pending", generation_attempts: SOFT_ATTEMPT_CAP, updated_at: NOW,
    };
    if (isClaimable(row)) fail("row at cap should NOT be claimable");
    else pass(`row at SOFT_ATTEMPT_CAP excluded (anti-runaway)`);
  }

  console.log("\n  test 10: pending + attempts > cap → not claimable");
  {
    const row: ProposalQueueRow = {
      id: 1, work_order_id: 42, generation_status: "pending", generation_attempts: SOFT_ATTEMPT_CAP + 5, updated_at: NOW,
    };
    if (isClaimable(row)) fail("row over cap should NOT be claimable");
    else pass(`row over cap also excluded`);
  }

  console.log("\n  test 11: pending + work_order_id null → not claimable (orphan)");
  {
    const row: ProposalQueueRow = {
      id: 1, work_order_id: null, generation_status: "pending", generation_attempts: 0, updated_at: NOW,
    };
    if (isClaimable(row)) fail("orphan row (null work_order_id) should NOT be claimable");
    else pass(`orphan rows skipped — can't drive engine without WO id`);
  }

  console.log("\n  test 12: non-pending statuses → not claimable");
  {
    const cases: Array<ProposalQueueRow["generation_status"]> = [
      "generating", "ready", "failed", "needs_remediation", "rubric_stale",
    ];
    for (const status of cases) {
      const row: ProposalQueueRow = {
        id: 1, work_order_id: 42, generation_status: status, generation_attempts: 0, updated_at: NOW,
      };
      if (isClaimable(row)) {
        fail(`status=${status} should NOT be claimable`);
        return;
      }
    }
    pass(`only 'pending' rows are claimable`);
  }

  console.log("\n  test 13: null / undefined attempts → treated as 0 (claimable)");
  {
    const a: ProposalQueueRow = { id: 1, work_order_id: 42, generation_status: "pending", generation_attempts: null, updated_at: NOW };
    const b: ProposalQueueRow = { id: 2, work_order_id: 42, generation_status: "pending", generation_attempts: 0, updated_at: NOW };
    if (!isClaimable(a)) fail("null attempts should be claimable (defaults to 0)");
    else if (!isClaimable(b)) fail("zero attempts should be claimable");
    else pass(`null attempts treated as 0 — fresh row claimable`);
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Worker queue policy holds across reap + claim decision branches\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
