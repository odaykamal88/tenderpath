/**
 * scripts/extraction-corrections-acceptance.ts
 *
 * Phase 3 / Loop 4 — extraction-correction prompt formatting (pure, no DB).
 *
 * Usage: npx tsx scripts/extraction-corrections-acceptance.ts
 */

import { formatCorrectionsForPrompt } from "@/lib/proposal-package/rubric-extractor";

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`    ✓ ${name}`);
  else {
    console.error(`    ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failures += 1;
  }
}

function main(): void {
  console.log("\n=== Phase 3 / Loop 4 — extraction-correction formatting ===\n");

  check("empty → empty string (no prompt section)", formatCorrectionsForPrompt([]) === "");

  const out = formatCorrectionsForPrompt(["UNICEF double-weights methodology", "WFP uses percentages"]);
  check("includes the section header", out.includes("KNOWN FORMAT CORRECTIONS"), out.slice(0, 40));
  check("numbers each correction", out.includes("1. UNICEF double-weights methodology") && out.includes("2. WFP uses percentages"));
  check("instructs not to invent criteria", out.toLowerCase().includes("do not invent"));

  const filtered = formatCorrectionsForPrompt(["   ", "real one", ""]);
  check("trims + drops blank corrections", filtered.includes("1. real one") && !filtered.includes("2."), filtered);

  console.log("");
  if (failures > 0) {
    console.error(`✗ ${failures} assertion(s) failed.\n`);
    process.exit(1);
  }
  console.log("✓ all extraction-correction assertions passed.\n");
}

main();
