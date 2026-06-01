/**
 * scripts/extraction-confidence-acceptance.ts
 *
 * Phase 0 / A3 — rubric extraction-confidence acceptance.
 *
 * Verifies the pure banding logic in computeExtractionConfidence() in
 * rubric-extractor.ts: the mechanical signal that flags when the engine could
 * NOT confidently parse a tender's scoring criteria, so the score must be
 * presented as indicative. No LLM, no DB — structural inputs only.
 *
 * Usage:
 *   npx tsx scripts/extraction-confidence-acceptance.ts
 */

import { computeExtractionConfidence } from "@/lib/proposal-package/rubric-extractor";
import type {
  LotRubric,
  Disqualifier,
  EvaluationCriterion,
} from "@/lib/proposal-package/scoring-engine";

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

// ── synthetic rubric builders ────────────────────────────────────────────
function crit(id: string, maxScore: number, docId: string): EvaluationCriterion {
  return { id, label: id, weight: 0.2, maxScore, source: { docId, section: "S1", rubricVersion: 1 } };
}
function disq(id: string, docId: string): Disqualifier {
  return { id, rule: `rule ${id}`, kind: "mandatory_form", source: { docId, section: "S1", rubricVersion: 1 } };
}
function lot(criteria: EvaluationCriterion[], disqualifiers: Disqualifier[] = []): LotRubric {
  return { lotId: "main", label: "Main", criteria, disqualifiers };
}

const FULL_DOCS = 50_000; // healthy document set
const THIN_DOCS = 500; // below the 2k thinness floor

function main(): void {
  console.log("\n=== Phase 0 / A3 — rubric extraction confidence ===\n");

  // 1. Clean cumulative tender → high
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([crit("1.1", 10, "d/f"), crit("1.2", 10, "d/f"), crit("1.3", 10, "d/f")])],
      noticeWideDisqualifiers: [],
      methodology: "cumulative",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "clean cumulative (3 anchored, scored criteria) → high, no warnings",
      ec.level === "high" && ec.warnings.length === 0,
      `${ec.level}/${ec.warnings.length} warnings`,
    );
  }

  // 2. Cumulative tender but zero criteria → low (rubric format defeated extraction)
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([], [disq("d1", "d/f")])],
      noticeWideDisqualifiers: [],
      methodology: "cumulative",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "cumulative w/ zero criteria → low (expectedScoredButEmpty)",
      ec.level === "low" && ec.signals.expectedScoredButEmpty,
      `${ec.level}/${ec.signals.expectedScoredButEmpty}`,
    );
  }

  // 3. A lot failed to parse (returned < requested) → low
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 3,
      lotsReturned: 2,
      lots: [lot([crit("1.1", 10, "d/f")]), lot([crit("2.1", 10, "d/f")]), lot([])],
      noticeWideDisqualifiers: [],
      methodology: "cumulative",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "lot failed to parse (2 of 3 returned) → low + warning",
      ec.level === "low" && ec.warnings.some((w) => w.includes("1 of 3 lot")),
      `${ec.level} / ${JSON.stringify(ec.warnings)}`,
    );
  }

  // 4. Half the criteria came back with no readable max score → low
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([crit("1.1", 10, "d/f"), crit("1.2", 0, "d/f"), crit("1.3", 0, "d/f"), crit("1.4", 10, "d/f")])],
      noticeWideDisqualifiers: [],
      methodology: "cumulative",
      docCharsTotal: FULL_DOCS,
    });
    check("≥half criteria missing max score → low", ec.level === "low", ec.level);
  }

  // 5. Thin document set → low
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([crit("1.1", 10, "d/f")])],
      noticeWideDisqualifiers: [],
      methodology: "cumulative",
      docCharsTotal: THIN_DOCS,
    });
    check(
      "thin document set → low + thinness warning",
      ec.level === "low" && ec.warnings.some((w) => w.toLowerCase().includes("thin")),
      `${ec.level} / ${JSON.stringify(ec.warnings)}`,
    );
  }

  // 6. One unanchored criterion (minor) → medium
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([crit("1.1", 10, "d/f"), crit("1.2", 10, "d/f"), crit("1.3", 10, "d/f"), crit("1.4", 10, "")])],
      noticeWideDisqualifiers: [],
      methodology: "cumulative",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "one unanchored criterion → medium",
      ec.level === "medium" && ec.signals.criteriaMissingSource === 1,
      `${ec.level}/${ec.signals.criteriaMissingSource}`,
    );
  }

  // 7. Empty rubric (no criteria, no disqualifiers) → low
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([])],
      noticeWideDisqualifiers: [],
      methodology: "lowest_compliant",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "empty rubric (0 criteria, 0 disqualifiers) → low (emptyRubric)",
      ec.level === "low" && ec.signals.emptyRubric,
      `${ec.level}/${ec.signals.emptyRubric}`,
    );
  }

  // 8. lowest_compliant goods RFQ: zero criteria is NORMAL when disqualifiers
  //    are present and anchored → high (NOT flagged just for empty criteria)
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([], [disq("spec1", "d/f"), disq("spec2", "d/f"), disq("spec3", "d/f")])],
      noticeWideDisqualifiers: [disq("deadline", "d/f")],
      methodology: "lowest_compliant",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "lowest_compliant w/ anchored disqualifiers, 0 criteria → high (normal)",
      ec.level === "high",
      `${ec.level} / ${JSON.stringify(ec.warnings)}`,
    );
  }

  // 9. lowest_compliant with an unanchored disqualifier → medium
  {
    const ec = computeExtractionConfidence({
      lotsRequested: 1,
      lotsReturned: 1,
      lots: [lot([], [disq("spec1", "d/f"), disq("spec2", "")])],
      noticeWideDisqualifiers: [],
      methodology: "lowest_compliant",
      docCharsTotal: FULL_DOCS,
    });
    check(
      "lowest_compliant w/ one unanchored disqualifier → medium",
      ec.level === "medium" && ec.signals.disqualifiersMissingSource === 1,
      `${ec.level}/${ec.signals.disqualifiersMissingSource}`,
    );
  }

  console.log("");
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed.\n`);
    process.exit(1);
  }
  console.log("✓ all extraction-confidence assertions passed.\n");
}

main();
