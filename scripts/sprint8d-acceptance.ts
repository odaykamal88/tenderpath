/**
 * scripts/sprint8d-acceptance.ts
 *
 * Sprint 8d acceptance — LLM type-recovery fallback for documents the
 * Sprint 10 keyword auto-tagger left as `'other'`.
 *
 * Verifies the pure decision logic in type-classifier.ts:
 *   - buildClassifyPrompt produces a stable, complete taxonomy listing
 *   - parseClassifyResponse correctly handles the five real decision
 *     branches (high+specific, high+other, low+specific, low+other,
 *     invalid-type-name)
 *
 * No DB. No LLM. The actual Haiku call + the ingest wire-up are verified
 * by manual / preview-deploy testing. This script covers the parse +
 * decision logic that decides whether to upgrade vault_documents.type.
 *
 * Usage:
 *   npx tsx scripts/sprint8d-acceptance.ts
 */

import {
  buildClassifyPrompt,
  parseClassifyResponse,
  type RawClassifyResponse,
} from "@/lib/applicant-evidence/type-classifier";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 8d acceptance — LLM type-recovery fallback ===\n");

  // --------------------------------------------------------------------
  // Test 1: prompt includes every valid taxonomy type
  // --------------------------------------------------------------------
  console.log("  test 1: prompt lists the full evidence taxonomy");
  {
    const prompt = buildClassifyPrompt({
      fileName: "scan_2023.pdf",
      textContent: "Some neutral-sounding text here that needs classification.",
    });
    const requiredTypes = [
      "cv",
      "certificate",
      "audit",
      "past_performance",
      "capability_statement",
      "partner_letter",
      "tor_rfp",
      "financial",
      "registration",
      "other",
    ];
    const missing = requiredTypes.filter((t) => !prompt.includes(t));
    if (missing.length > 0) {
      fail(`prompt missing types: ${missing.join(", ")}`);
    } else if (!prompt.includes("scan_2023.pdf")) {
      fail(`prompt should reference the filename`);
    } else if (!prompt.includes('"confidence"')) {
      fail(`prompt should ask for a "confidence" field`);
    } else {
      pass(`prompt enumerates all 10 evidence types + asks for confidence`);
    }
  }

  // --------------------------------------------------------------------
  // Test 2: high-confidence + specific type → returns that type
  // --------------------------------------------------------------------
  console.log("\n  test 2: high-confidence + specific type → returns the type");
  {
    const raw: RawClassifyResponse = {
      type: "cv",
      confidence: "high",
      rationale: "Filename is a person's name and body lists work history.",
    };
    const decided = parseClassifyResponse(raw);
    if (decided !== "cv") {
      fail(`expected "cv", got ${decided}`);
    } else {
      pass(`high-confidence cv → upgraded`);
    }
  }

  // --------------------------------------------------------------------
  // Test 3: high-confidence + "other" → null (stays as 'other')
  // --------------------------------------------------------------------
  console.log("\n  test 3: high-confidence + 'other' → null (caller keeps as 'other')");
  {
    const raw: RawClassifyResponse = {
      type: "other",
      confidence: "high",
      rationale: "Free-form internal memo, not procurement-evidence.",
    };
    const decided = parseClassifyResponse(raw);
    if (decided !== null) {
      fail(`expected null for high-confidence "other", got ${decided}`);
    } else {
      pass(`high-confidence "other" → null (no upgrade)`);
    }
  }

  // --------------------------------------------------------------------
  // Test 4: low-confidence + specific type → null (conservative skip)
  // --------------------------------------------------------------------
  console.log("\n  test 4: low-confidence + specific type → null (conservative)");
  {
    const raw: RawClassifyResponse = {
      type: "past_performance",
      confidence: "low",
      rationale: "Could be either a past-performance reference or a partner letter.",
    };
    const decided = parseClassifyResponse(raw);
    if (decided !== null) {
      fail(`expected null for low-confidence, got ${decided}`);
    } else {
      pass(`low-confidence specific type → null (no upgrade — safety win)`);
    }
  }

  // --------------------------------------------------------------------
  // Test 5: low-confidence + "other" → null
  // --------------------------------------------------------------------
  console.log("\n  test 5: low-confidence + 'other' → null");
  {
    const raw: RawClassifyResponse = {
      type: "other",
      confidence: "low",
      rationale: "Cannot classify.",
    };
    const decided = parseClassifyResponse(raw);
    if (decided !== null) fail(`expected null, got ${decided}`);
    else pass(`low-confidence "other" → null (no change either way)`);
  }

  // --------------------------------------------------------------------
  // Test 6: invalid type-name (LLM hallucinated something not in the
  //         taxonomy) → null. Guards against vault_documents.type drift.
  // --------------------------------------------------------------------
  console.log("\n  test 6: invalid type name (hallucinated) → null");
  {
    const raw: RawClassifyResponse = {
      type: "cv-like",
      confidence: "high",
      rationale: "LLM made up a type that isn't in the taxonomy.",
    };
    const decided = parseClassifyResponse(raw);
    if (decided !== null) {
      fail(`expected null for invalid type "cv-like", got ${decided}`);
    } else {
      pass(`invalid type name → null (taxonomy invariant preserved)`);
    }
  }

  // --------------------------------------------------------------------
  // Test 7: high-confidence past_performance → upgraded
  // --------------------------------------------------------------------
  console.log("\n  test 7: high-confidence past_performance → upgraded");
  {
    const raw: RawClassifyResponse = {
      type: "past_performance",
      confidence: "high",
      rationale: "Document is a WFP completion letter for a 2023 contract.",
    };
    const decided = parseClassifyResponse(raw);
    if (decided !== "past_performance") {
      fail(`expected "past_performance", got ${decided}`);
    } else {
      pass(`high-confidence past_performance → upgraded`);
    }
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Sprint 8d classifier logic: only confident specific types upgrade; ambiguous and 'other' stay safe\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
