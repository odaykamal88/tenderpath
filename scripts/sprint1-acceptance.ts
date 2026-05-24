/**
 * scripts/sprint1-acceptance.ts
 *
 * Sprint 1 acceptance harness for the proposal-engine. Loads both UN tender
 * fixtures, runs the rubric extractor end-to-end, and dumps the structured
 * output for inspection.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/sprint1-acceptance.ts
 *
 *   # Skip the LLM call and only print the ingest pipeline:
 *   npx tsx scripts/sprint1-acceptance.ts --no-llm
 *
 * Per docs/agents/proposal-engine-build-plan.md, the primary acceptance is:
 *   - UNOPS RFQ/2026/61438 → 3 lots, lowest_compliant, supersession chain
 *     across the 3 amendments + binding-Q&A refinements (Lot 1 backing
 *     flange spec, Lot 3 BS EN 10242 GI fittings)
 *   - UNICEF RFPS-DAN-2021-503347 → 1 lot ("main"), cumulative, the Annex C
 *     hash-mismatch surfacing as supersession across notices 135638→146988,
 *     criteria 1.2 + 1.4 from the base RFP, criterion 1.2/1.4 + country-reach
 *     refinements from binding Q&A
 *
 * CSIM is deferred to Sprint 3 (mechanism-regression case for reextractAndDiff).
 */

import { join } from "node:path";
import { loadTender } from "@/lib/proposal-package/manifest-loader";
import {
  extractRubricFromTender,
  toTenderInput,
} from "@/lib/proposal-package/rubric-extractor";
import { filterBinding } from "@/lib/proposal-package/qa-extractor";

const REPO_ROOT = process.cwd();
const FIXTURES_DIR = join(REPO_ROOT, "tests/fixtures/un-tenders");

interface FixtureCase {
  name: string;
  dir: string;
  expectedLots: number;
  expectedMethodology: "cumulative" | "lowest_compliant" | "weighted_grant";
  expectedSupersedingFilename?: string;
}

const FIXTURES: FixtureCase[] = [
  {
    name: "UNOPS RFQ/2026/61438 (multi-lot goods, lowest_compliant)",
    dir: join(FIXTURES_DIR, "unops-RFQ-2026-61438"),
    expectedLots: 3,
    expectedMethodology: "lowest_compliant",
  },
  {
    name: "UNICEF RFPS-DAN-2021-503347 (single-lot services, cumulative, two-notice)",
    dir: join(FIXTURES_DIR, "unicef-RFPS-DAN-2021-503347"),
    expectedLots: 1,
    expectedMethodology: "cumulative",
    expectedSupersedingFilename:
      "Annex C - RFPS TOR - Plant repair and biomed services - revised.docx",
  },
];

async function main(): Promise<void> {
  const skipLlm = process.argv.includes("--no-llm");

  console.log("=".repeat(80));
  console.log("Sprint 1 acceptance — proposal-engine rubric extractor");
  console.log(`mode: ${skipLlm ? "INGEST ONLY (no LLM)" : "FULL (with LLM)"}`);
  console.log("=".repeat(80));

  let allPassed = true;

  for (const fixture of FIXTURES) {
    console.log(`\n>>> ${fixture.name}`);
    console.log(`    dir: ${fixture.dir}`);

    let loaded;
    try {
      loaded = await loadTender(fixture.dir);
    } catch (err) {
      console.error(
        `[acceptance:load:failed] ${fixture.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      allPassed = false;
      continue;
    }

    console.log(`    manifest.tenderId       : ${loaded.manifest.tenderId}`);
    console.log(`    manifest.methodology    : ${loaded.manifest.methodology}`);
    console.log(`    manifest.lotMetadata    : ${loaded.manifest.lotMetadata.length} lots`);
    console.log(`    docs ingested           : ${loaded.docs.length}`);
    console.log(`    qa entries (total)      : ${loaded.qaEntries.length}`);
    console.log(`    qa entries (binding)    : ${filterBinding(loaded.qaEntries).length}`);

    // Methodology check
    if (loaded.manifest.methodology !== fixture.expectedMethodology) {
      console.error(
        `    ✗ methodology mismatch: expected ${fixture.expectedMethodology}, got ${loaded.manifest.methodology}`,
      );
      allPassed = false;
    } else {
      console.log(`    ✓ methodology matches`);
    }

    // Lot count check
    if (loaded.manifest.lotMetadata.length !== fixture.expectedLots) {
      console.error(
        `    ✗ lot count mismatch: expected ${fixture.expectedLots}, got ${loaded.manifest.lotMetadata.length}`,
      );
      allPassed = false;
    } else {
      console.log(`    ✓ lot count matches`);
    }

    // Supersession check (hash-compare across notices)
    if (fixture.expectedSupersedingFilename) {
      const matches = loaded.docs.filter(
        (d) => d.manifest.filename === fixture.expectedSupersedingFilename,
      );
      const superseder = matches.find(
        (d) => d.manifest.supersedes && d.manifest.supersedes.length > 0,
      );
      if (!superseder) {
        console.error(
          `    ✗ expected supersession for "${fixture.expectedSupersedingFilename}" — none found`,
        );
        allPassed = false;
      } else {
        console.log(
          `    ✓ supersession detected: ${superseder.manifest.docId} supersedes ${(
            superseder.manifest.supersedes ?? []
          ).join(", ")}`,
        );
      }
    }

    // Doc summary (top 8 by text length)
    const docSummary = loaded.docs
      .slice()
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, 8)
      .map(
        (d) =>
          `      [${d.manifest.role.padEnd(13)}] ${d.manifest.docId.padEnd(60)} ${String(d.text.length).padStart(8)} chars`,
      );
    console.log(`    top docs by text length:`);
    for (const line of docSummary) console.log(line);

    // Binding Q&A summary
    if (filterBinding(loaded.qaEntries).length > 0) {
      console.log(`    binding Q&A entries:`);
      for (const q of filterBinding(loaded.qaEntries).slice(0, 6)) {
        const touches = q.touches || "(unspecified)";
        const preview = q.content.replace(/\s+/g, " ").slice(0, 90);
        console.log(`      [${q.entryId.padEnd(30)}] touches: ${touches.padEnd(36)} | ${preview}…`);
      }
    }

    if (skipLlm) continue;

    // LLM extraction
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(`    ⚠ ANTHROPIC_API_KEY not set — skipping LLM extraction`);
      allPassed = false;
      continue;
    }

    console.log(`\n    calling rubric extractor (Sonnet)...`);
    const t0 = Date.now();
    let rubric;
    try {
      rubric = await extractRubricFromTender(loaded);
    } catch (err) {
      console.error(
        `[acceptance:extract:failed] ${fixture.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      allPassed = false;
      continue;
    }
    const elapsedMs = Date.now() - t0;
    console.log(`    extraction completed in ${elapsedMs}ms`);

    console.log(`\n    --- TenderRubric ---`);
    console.log(`    tenderId: ${rubric.tenderId}`);
    console.log(`    lane: ${rubric.lane}`);
    console.log(`    methodology: ${rubric.methodology}`);
    console.log(`    rubricVersion: ${rubric.rubricVersion}`);
    console.log(`    documentSet: ${rubric.documentSet.length} docs`);
    console.log(`    noticeWideDisqualifiers: ${rubric.noticeWideDisqualifiers.length}`);
    for (const nd of rubric.noticeWideDisqualifiers.slice(0, 6)) {
      console.log(
        `      • [${nd.kind.padEnd(15)}] ${nd.rule.slice(0, 100)} (source: ${nd.source.docId}${nd.source.section ? ` § ${nd.source.section}` : ""})`,
      );
    }
    console.log(`    lots:`);
    for (const lot of rubric.lots) {
      console.log(`      ╭ ${lot.lotId} — ${lot.label}`);
      console.log(`      │ criteria: ${lot.criteria.length}`);
      for (const c of lot.criteria.slice(0, 8)) {
        const dw = c.doubleWeighted ? " [2x]" : "";
        const gating = c.gatingThreshold != null ? ` (gating ≥${c.gatingThreshold})` : "";
        console.log(
          `      │   • ${c.id.padEnd(6)} ${c.label.slice(0, 60).padEnd(60)} weight=${c.weight.toFixed(2)} max=${c.maxScore}${dw}${gating}`,
        );
      }
      console.log(`      │ disqualifiers: ${lot.disqualifiers.length}`);
      for (const d of lot.disqualifiers.slice(0, 6)) {
        console.log(
          `      │   • [${d.kind.padEnd(15)}] ${d.rule.slice(0, 80)}`,
        );
      }
      if (lot.financialFormRef) {
        console.log(`      │ financialFormRef: ${lot.financialFormRef.docId}`);
      }
      console.log(`      ╰`);
    }

    // Light sanity checks
    if (rubric.lots.length !== fixture.expectedLots) {
      console.error(
        `    ✗ rubric.lots count mismatch: expected ${fixture.expectedLots}, got ${rubric.lots.length}`,
      );
      allPassed = false;
    }

    // Toy invocation of toTenderInput so any future signature drift surfaces
    const input = toTenderInput(loaded);
    void input;
  }

  console.log("\n" + "=".repeat(80));
  console.log(allPassed ? "Sprint 1 acceptance: PASS" : "Sprint 1 acceptance: FAIL");
  console.log("=".repeat(80));
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(
    `[acceptance:unhandled] ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  );
  process.exit(2);
});
