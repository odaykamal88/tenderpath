/**
 * scripts/proposal-rate-limit-acceptance.ts
 *
 * Per-day re-run rate-limit (Sprint 6c deferred item) acceptance.
 *
 * Verifies the pure quota math in computeQuotaDecision across the real
 * decision branches:
 *
 *   - Zero recent runs                          → allowed, remaining = limit
 *   - Some recent runs but under cap            → allowed, remaining decremented
 *   - At the cap                                → blocked, resetAt set
 *   - Over the cap (e.g., legacy backfill)      → blocked, resetAt = oldest + window
 *   - All runs older than the window            → allowed, remaining = limit
 *   - Mix of in-window + out-of-window runs     → only count in-window
 *   - Edge: oldest run exactly at the cutoff   → counted (strictly-greater-than guard)
 *
 * No DB. The route handlers test the DB integration in production / preview.
 *
 * Usage:
 *   npx tsx scripts/proposal-rate-limit-acceptance.ts
 */

import {
  computeQuotaDecision,
  PROPOSAL_RERUN_LIMIT,
  PROPOSAL_RERUN_WINDOW_HOURS,
} from "@/lib/proposal-package/rate-limit";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

function hoursAgo(hours: number, now: Date): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  console.log("\n=== Proposal-draft re-run rate limit — quota math acceptance ===");
  console.log(`  Limit: ${PROPOSAL_RERUN_LIMIT} re-runs / ${PROPOSAL_RERUN_WINDOW_HOURS} h\n`);

  const NOW = new Date("2026-06-01T12:00:00Z");
  const LIMIT = 10;
  const WINDOW = 24;

  // --------------------------------------------------------------------
  // Test 1: zero recent runs → fully allowed
  // --------------------------------------------------------------------
  console.log("  test 1: zero runs → allowed, remaining = limit");
  {
    const result = computeQuotaDecision({ ranAt: [], now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (!result.allowed) fail(`expected allowed=true, got ${result.allowed}`);
    else if (result.remaining !== LIMIT) fail(`expected remaining=${LIMIT}, got ${result.remaining}`);
    else if (result.resetAt !== null) fail(`expected resetAt=null when allowed, got ${result.resetAt}`);
    else pass(`empty history → allowed, remaining=${LIMIT}, no resetAt`);
  }

  // --------------------------------------------------------------------
  // Test 2: under cap → allowed with decremented remaining
  // --------------------------------------------------------------------
  console.log("\n  test 2: 7 runs in window → allowed, remaining = 3");
  {
    const ranAt = Array.from({ length: 7 }, (_, i) => hoursAgo(i * 2, NOW));
    const result = computeQuotaDecision({ ranAt, now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (!result.allowed) fail(`expected allowed=true`);
    else if (result.remaining !== 3) fail(`expected remaining=3, got ${result.remaining}`);
    else pass(`7 runs in window → allowed, remaining=3`);
  }

  // --------------------------------------------------------------------
  // Test 3: at cap → blocked, resetAt = oldest + window
  // --------------------------------------------------------------------
  console.log("\n  test 3: at cap (10 runs) → blocked, resetAt = oldest + 24h");
  {
    // 10 runs spread over the last ~20 hours. Oldest is 20h ago, so resetAt
    // should be 20h ago + 24h = NOW + 4h.
    const ranAt = Array.from({ length: 10 }, (_, i) => hoursAgo(2 * i, NOW));
    const result = computeQuotaDecision({ ranAt, now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (result.allowed) fail(`expected allowed=false at the cap`);
    else if (result.remaining !== 0) fail(`expected remaining=0, got ${result.remaining}`);
    else if (!result.resetAt) fail(`expected resetAt set`);
    else {
      const expectedReset = new Date(hoursAgo(18, NOW).getTime() + 24 * 60 * 60 * 1000);
      if (result.resetAt.getTime() !== expectedReset.getTime()) {
        fail(`expected resetAt=${expectedReset.toISOString()}, got ${result.resetAt.toISOString()}`);
      } else {
        pass(`at cap → blocked, resetAt = ${result.resetAt.toISOString()} (oldest of 18h ago + 24h)`);
      }
    }
  }

  // --------------------------------------------------------------------
  // Test 4: over cap (legacy or backfill rows beyond limit) → blocked
  // --------------------------------------------------------------------
  console.log("\n  test 4: over cap (12 runs) → blocked");
  {
    const ranAt = Array.from({ length: 12 }, (_, i) => hoursAgo(i * 1.5, NOW));
    const result = computeQuotaDecision({ ranAt, now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (result.allowed) fail(`expected blocked when over cap`);
    else if (result.remaining !== 0) fail(`remaining should clamp to 0`);
    else pass(`over cap → blocked, remaining clamped to 0`);
  }

  // --------------------------------------------------------------------
  // Test 5: all old (out of window) → fully allowed again
  // --------------------------------------------------------------------
  console.log("\n  test 5: all runs > 24h old → allowed (window expired)");
  {
    const ranAt = Array.from({ length: 20 }, (_, i) => hoursAgo(30 + i, NOW));
    const result = computeQuotaDecision({ ranAt, now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (!result.allowed) fail(`old runs should not count — expected allowed`);
    else if (result.remaining !== LIMIT) fail(`expected full quota remaining, got ${result.remaining}`);
    else pass(`out-of-window runs ignored → full quota restored`);
  }

  // --------------------------------------------------------------------
  // Test 6: mix of in-window and out-of-window runs
  // --------------------------------------------------------------------
  console.log("\n  test 6: 5 in-window + 8 out-of-window → allowed, remaining = 5");
  {
    const ranAt = [
      ...Array.from({ length: 5 }, (_, i) => hoursAgo(i * 3, NOW)), // 0h, 3h, 6h, 9h, 12h ago — in window
      ...Array.from({ length: 8 }, (_, i) => hoursAgo(30 + i, NOW)), // 30h+ ago — out of window
    ];
    const result = computeQuotaDecision({ ranAt, now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (!result.allowed) fail(`expected allowed`);
    else if (result.remaining !== 5) fail(`expected remaining=5, got ${result.remaining}`);
    else pass(`only in-window runs counted → remaining=5`);
  }

  // --------------------------------------------------------------------
  // Test 7: edge — run exactly at the cutoff. computeQuotaDecision uses
  //         strict greater-than, so a run AT the boundary is just out.
  // --------------------------------------------------------------------
  console.log("\n  test 7: run exactly at cutoff → counted as out-of-window");
  {
    const cutoff = hoursAgo(WINDOW, NOW);
    // Stack the cap minus one, plus one row at exactly the cutoff (excluded).
    const ranAt = [
      ...Array.from({ length: LIMIT - 1 }, (_, i) => hoursAgo(i * 2, NOW)),
      cutoff,
    ];
    const result = computeQuotaDecision({ ranAt, now: NOW, limit: LIMIT, windowHours: WINDOW });
    if (!result.allowed) fail(`row at cutoff should not count — expected allowed`);
    else if (result.remaining !== 1) fail(`expected remaining=1, got ${result.remaining}`);
    else pass(`cutoff row excluded by strict >; remaining=1`);
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Quota math holds across empty / under / at / over / expired / mixed / boundary cases\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
