/**
 * Pure-logic smoke for the free compliance-gap check derivations (P1.1). No DB,
 * no LLM. Run: npx tsx scripts/proposal-review-smoke.ts
 *
 * Guards: an unverified BLOCK is never "blocked" (we don't assert an absence we
 * can't see); the go/no-go leans conservatively (blocker or Constrained → hold).
 */

import { deriveComplianceVerdict, deriveGoNoGo, GO_NO_GO_QUESTION } from "../src/lib/proposal-package/compliance-check";
import type { AdminGate, ReviewSeverity, ReviewGateStatus } from "../src/lib/proposal-package/review-types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}

function gate(severity: ReviewSeverity, status: ReviewGateStatus): AdminGate {
  return {
    id: `${severity}_${status}`,
    label: "Requirement",
    status,
    severity,
    action: "Confirm against the notice.",
    owner: "Bid lead",
    evidence_label: "unverified",
  };
}

console.log("compliance verdict");
{
  check("BLOCK + missing → blocked", deriveComplianceVerdict([gate("BLOCK", "missing")]).status === "blocked");
  check("BLOCK + unverified → at_risk (never blocked on an unseen absence)", deriveComplianceVerdict([gate("BLOCK", "unverified")]).status === "at_risk");
  check("BLOCK + partial → at_risk", deriveComplianceVerdict([gate("BLOCK", "partial")]).status === "at_risk");
  check("HIGH + missing → at_risk", deriveComplianceVerdict([gate("HIGH", "missing")]).status === "at_risk");
  check("only MED/LOW gaps → clears", deriveComplianceVerdict([gate("MED", "missing"), gate("LOW", "partial")]).status === "clears");
  check("all ok → clears", deriveComplianceVerdict([gate("BLOCK", "ok"), gate("HIGH", "ok")]).status === "clears");
  check("empty gates → clears", deriveComplianceVerdict([]).status === "clears");
  check("blocked wins over at_risk when both present", deriveComplianceVerdict([gate("HIGH", "missing"), gate("BLOCK", "missing")]).status === "blocked");
}

console.log("go / no-go");
{
  check("question is the $15k question", deriveGoNoGo("clears", "Open", 0).question === GO_NO_GO_QUESTION);
  check("blocked → hold", deriveGoNoGo("blocked", "Open", 0).lean === "hold");
  check("Constrained field + clears → hold", deriveGoNoGo("clears", "Constrained", 0).lean === "hold");
  check("at_risk → caution", deriveGoNoGo("at_risk", "Open", 0).lean === "caution");
  check("Mixed field + clears → caution", deriveGoNoGo("clears", "Mixed", 0).lean === "caution");
  check("BLOCK/HIGH gaps present + clears → caution", deriveGoNoGo("clears", "Open", 2).lean === "caution");
  check("clears + Open + no gaps → go", deriveGoNoGo("clears", "Open", 0).lean === "go");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
