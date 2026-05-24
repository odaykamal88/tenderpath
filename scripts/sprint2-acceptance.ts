/**
 * scripts/sprint2-acceptance.ts
 *
 * Sprint 2 end-to-end acceptance harness for the proposal-engine. For each
 * UN tender fixture:
 *   1. Load tender (Sprint 1 manifest-loader)
 *   2. Extract rubric (Sprint 1 rubric-extractor — cached to /tmp to keep
 *      iteration cheap)
 *   3. Run the revision loop (Sprint 2):
 *        a. Generate DraftSection[] (LLM)
 *        b. Score against rubric (LLM, batched per lot)
 *        c. If weak: regenerate weak sections + re-score (LLM)
 *   4. Render the scored draft to PDF via pdfDocs.tsx
 *   5. Print scorecard + write PDF to /tmp/sprint2-output/
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/sprint2-acceptance.ts
 *
 *   # Skip the LLM call paths and only print the rubric/applicant shape:
 *   npx tsx scripts/sprint2-acceptance.ts --no-llm
 *
 *   # Force re-extracting the rubric (default uses cached if present):
 *   npx tsx scripts/sprint2-acceptance.ts --no-cache
 *
 * Per docs/agents/proposal-engine-build-plan.md, Sprint 2 acceptance is:
 *   - a UN-tender draft scores per-criterion under the tender's methodology
 *   - missing mandatory form / eligibility breach fires as a disqualifier
 *   - passesGating reflects it
 *   - a weak section triggers a revision pass
 *   - $299 run produces a scored, revised, pdfDocs-rendered draft end to end
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { loadTender, type LoadedTender } from "@/lib/proposal-package/manifest-loader";
import {
  extractRubricFromTender,
  toTenderInput,
} from "@/lib/proposal-package/rubric-extractor";
import { runRevisionLoop } from "@/lib/proposal-package/revision-loop";
import { DEMO_APPLICANT } from "@/lib/proposal-package/applicant-context";
import { renderScoredDraftPdf } from "@/lib/proposal-package/pdfDocs";
import type { TenderRubric } from "@/lib/proposal-package/scoring-engine";

const REPO_ROOT = process.cwd();
const FIXTURES_DIR = join(REPO_ROOT, "tests/fixtures/un-tenders");
const CACHE_DIR = "/tmp/sprint2-cache";
const OUTPUT_DIR = "/tmp/sprint2-output";

interface FixtureCase {
  name: string;
  dir: string;
  workOrderId: number;
  expectedMethodology: "cumulative" | "lowest_compliant" | "weighted_grant";
}

const FIXTURES: FixtureCase[] = [
  {
    name: "unicef-services",
    dir: join(FIXTURES_DIR, "unicef-RFPS-DAN-2021-503347"),
    workOrderId: 9001,
    expectedMethodology: "cumulative",
  },
  {
    name: "unops-goods",
    dir: join(FIXTURES_DIR, "unops-RFQ-2026-61438"),
    workOrderId: 9002,
    expectedMethodology: "lowest_compliant",
  },
];

async function loadOrExtractRubric(
  tender: LoadedTender,
  cacheKey: string,
  useCache: boolean,
): Promise<TenderRubric> {
  const cachePath = join(CACHE_DIR, `rubric-${cacheKey}.json`);
  if (useCache && existsSync(cachePath)) {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as TenderRubric;
    console.log(`    rubric loaded from cache: ${cachePath}`);
    return parsed;
  }
  console.log(`    rubric not cached — extracting via Sonnet (Sprint 1 path)...`);
  const t0 = Date.now();
  const rubric = await extractRubricFromTender(tender);
  console.log(`    rubric extracted in ${Date.now() - t0}ms`);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(rubric, null, 2));
  return rubric;
}

async function main(): Promise<void> {
  const skipLlm = process.argv.includes("--no-llm");
  const noCache = process.argv.includes("--no-cache");

  console.log("=".repeat(80));
  console.log("Sprint 2 acceptance — scoring + revision loop + pdfDocs render");
  console.log(`mode: ${skipLlm ? "RUBRIC ONLY (no scoring)" : "FULL (with LLM scoring + revision)"}`);
  console.log("=".repeat(80));

  await mkdir(OUTPUT_DIR, { recursive: true });

  let allPassed = true;

  for (const fixture of FIXTURES) {
    console.log(`\n>>> ${fixture.name}`);
    console.log(`    dir: ${fixture.dir}`);

    let tender: LoadedTender;
    try {
      tender = await loadTender(fixture.dir);
    } catch (err) {
      console.error(`[acceptance:load:failed] ${fixture.name}: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
      continue;
    }

    let rubric: TenderRubric;
    try {
      rubric = await loadOrExtractRubric(tender, fixture.name, !noCache);
    } catch (err) {
      console.error(`[acceptance:extract:failed] ${fixture.name}: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
      continue;
    }

    const criteriaTotal = rubric.lots.reduce((s, l) => s + l.criteria.length, 0);
    const lotDisqTotal = rubric.lots.reduce((s, l) => s + l.disqualifiers.length, 0);
    console.log(`    rubric: ${rubric.lots.length} lots, ${criteriaTotal} criteria, ${lotDisqTotal} lot-disqualifiers, ${rubric.noticeWideDisqualifiers.length} notice-wide`);

    if (rubric.methodology !== fixture.expectedMethodology) {
      console.error(`    ✗ methodology mismatch: expected ${fixture.expectedMethodology}, got ${rubric.methodology}`);
      allPassed = false;
    }

    if (skipLlm) continue;

    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(`    ⚠ ANTHROPIC_API_KEY not set — skipping LLM scoring`);
      allPassed = false;
      continue;
    }

    // Run the revision loop
    console.log(`    running revision loop (Sprint 2: generate → score → revise → re-score)...`);
    const tenderInput = toTenderInput(tender);
    const t0 = Date.now();
    let result;
    try {
      result = await runRevisionLoop(tenderInput, rubric, DEMO_APPLICANT);
    } catch (err) {
      console.error(`[acceptance:loop:failed] ${fixture.name}: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
      continue;
    }
    const elapsedMs = Date.now() - t0;
    console.log(`    revision loop done in ${elapsedMs}ms · ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}`);

    // Print scorecard
    console.log(`\n    --- ScoreResult ---`);
    console.log(`    rubricVersion: ${result.finalScore.rubricVersion}`);
    const achievableTotal = rubric.lots.reduce((s, l) => s + l.criteria.reduce((ss, c) => ss + c.maxScore, 0), 0);
    const estimatedTotal = result.finalScore.lotResults.reduce((s, lr) => s + lr.estimatedTotal, 0);
    const allPass = result.finalScore.lotResults.every((lr) => lr.passesGating);
    console.log(`    totals: ${estimatedTotal.toFixed(1)} / ${achievableTotal} achievable · ${allPass ? "PASSES gating" : "FAILS gating"}`);
    console.log(`    notice-wide disqualifiers triggered: ${result.finalScore.noticeWideDisqualifiersTriggered.length}`);
    for (const d of result.finalScore.noticeWideDisqualifiersTriggered.slice(0, 4)) {
      console.log(`      • [${d.kind}] ${d.rule.slice(0, 110)}`);
    }
    console.log(`    per-lot:`);
    for (const lr of result.finalScore.lotResults) {
      const lot = rubric.lots.find((l) => l.lotId === lr.lotId);
      const lotMax = lot ? lot.criteria.reduce((s, c) => s + c.maxScore, 0) : 0;
      console.log(`      ╭ ${lr.lotId} — ${lot?.label.slice(0, 60) ?? ""}`);
      console.log(`      │ ${lr.estimatedTotal.toFixed(1)} / ${lotMax} · ${lr.passesGating ? "PASS" : "FAIL"} · triggered ${lr.lotDisqualifiersTriggered.length} disqualifier${lr.lotDisqualifiersTriggered.length === 1 ? "" : "s"}`);
      for (const c of lr.perCriterion.slice(0, 6)) {
        console.log(`      │   • ${c.criterionId.padEnd(6)} ${c.estimatedScore.toFixed(1).padStart(5)} / ${String(c.maxScore).padStart(3)} · ${c.confidence.padEnd(10)}${c.weaknesses.length > 0 ? `  weak:${c.weaknesses.length}` : ""}${c.missingEvidence.length > 0 ? `  missing:${c.missingEvidence.length}` : ""}`);
      }
      if (lr.perCriterion.length > 6) console.log(`      │   ... +${lr.perCriterion.length - 6} more`);
      for (const d of lr.lotDisqualifiersTriggered.slice(0, 3)) {
        console.log(`      │   ✗ [${d.kind}] ${d.rule.slice(0, 90)}`);
      }
      console.log(`      ╰`);
    }

    if (result.history.length > 1) {
      console.log(`    revision history:`);
      for (const h of result.history) {
        console.log(`      attempt ${h.attempt}: ${h.estimatedTotal.toFixed(0)}/${h.achievableTotal} · ${h.passesGating ? "pass" : "fail"} · weak:${h.weakCriteriaIds.length} · triggered:${h.triggeredDisqualifierIds.length}`);
      }
    }

    // Render PDF
    console.log(`\n    rendering scored draft PDF...`);
    try {
      const pdfBuf = await renderScoredDraftPdf({
        rubric,
        draft: result.finalDraft,
        score: result.finalScore,
        applicant: DEMO_APPLICANT,
        history: result.history,
        workOrderId: fixture.workOrderId,
        tenderTitle: tender.manifest.title,
        agency: tender.manifest.agency,
        generatedAt: new Date().toISOString().slice(0, 10),
      });
      const pdfPath = join(OUTPUT_DIR, `${fixture.name}.pdf`);
      await writeFile(pdfPath, pdfBuf);
      console.log(`    PDF written: ${pdfPath} (${(pdfBuf.byteLength / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`[acceptance:render:failed] ${fixture.name}: ${err instanceof Error ? err.message : String(err)}`);
      allPassed = false;
    }

    // Light assertions
    if (rubric.methodology === "cumulative" && estimatedTotal === 0) {
      console.error(`    ✗ cumulative tender returned 0 score — scoring is broken`);
      allPassed = false;
    }
    if (rubric.methodology === "lowest_compliant" && result.finalScore.lotResults.every((lr) => lr.lotDisqualifiersTriggered.length === 0 && lr.passesGating)) {
      console.log(`    ✓ lowest_compliant: applicant passes all lots (no disqualifiers triggered)`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log(allPassed ? "Sprint 2 acceptance: PASS" : "Sprint 2 acceptance: FAIL");
  console.log("=".repeat(80));
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`[acceptance:unhandled] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
