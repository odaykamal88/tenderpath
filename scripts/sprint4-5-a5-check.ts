/**
 * scripts/sprint4-5-a5-check.ts
 *
 * Sprint 4.5 — the empirical A5 acceptance test (proposal-output-ux.md PART A · A5):
 *
 *   > Output must be ALREADY-REVIEWED, not review-pending. The Sprint 2
 *   > scoring loop runs hard enough that the shipped draft has been scored,
 *   > gap-flagged, and disqualifier-checked. Acceptance test: when the user
 *   > pastes the output into a generic LLM, that model finds little material
 *   > to add. If it finds a lot, the self-review is too weak — that's a
 *   > Sprint 2 bug, not a UI gap.
 *
 * What this script does:
 *   1. Re-run the Sprint 2 revision-loop on UNICEF (so we have the
 *      ship-grade output, not the single-pass Sprint 4 cache).
 *   2. Pack the final draft + score + routedGaps + disqualifiers into a
 *      structured payload — the shape a buyer would actually see.
 *   3. Send to claude-haiku-4-5 (cheap "generic LLM" proxy) with a strict
 *      critique prompt: "What MATERIAL additions would a senior procurement
 *      evaluator make? Be specific. Count substantive vs stylistic
 *      additions."
 *   4. Parse the response. A5 PASS = ≤3 material additions; A5 SOFT FAIL =
 *      4-6; A5 HARD FAIL = 7+. (Threshold is informed by the spec's "little
 *      material to add" framing — some additions are always possible.)
 *
 * Caches the revision-loop result so re-runs are instant.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/sprint4-5-a5-check.ts
 *   npx tsx scripts/sprint4-5-a5-check.ts --no-cache
 */

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadTender } from "@/lib/proposal-package/manifest-loader";
import { toTenderInput } from "@/lib/proposal-package/rubric-extractor";
import { runRevisionLoop } from "@/lib/proposal-package/revision-loop";
import { DEMO_APPLICANT } from "@/lib/proposal-package/applicant-context";
import type { TenderRubric } from "@/lib/proposal-package/scoring-engine";
import type { RevisionLoopResult } from "@/lib/proposal-package/revision-loop";

const FIXTURE_DIR = join(
  process.cwd(),
  "tests/fixtures/un-tenders/unicef-RFPS-DAN-2021-503347",
);
const SPRINT2_RUBRIC = "/tmp/sprint2-cache/rubric-unicef-services.json";
const SPRINT4_5_CACHE = "/tmp/sprint4-5-cache";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

async function main(): Promise<void> {
  const noCache = process.argv.includes("--no-cache");

  console.log("=".repeat(80));
  console.log("Sprint 4.5 — A5 empirical check (paste output → critique)");
  console.log("=".repeat(80));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[a5:env:failed] ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }
  if (!existsSync(SPRINT2_RUBRIC)) {
    console.error(`[a5:cache:missing] Sprint 2 rubric cache not found at ${SPRINT2_RUBRIC}`);
    process.exit(1);
  }

  await mkdir(SPRINT4_5_CACHE, { recursive: true });

  const rubric = JSON.parse(await readFile(SPRINT2_RUBRIC, "utf8")) as TenderRubric;
  console.log(`\nrubric loaded · v${rubric.rubricVersion} · ${rubric.lots[0].criteria.length} criteria`);

  // ─────────────────────────────────────────────────────────────────────
  // Step 1: revision-loop run, cached
  // ─────────────────────────────────────────────────────────────────────
  const cachePath = join(SPRINT4_5_CACHE, `revision-loop-unicef-v${rubric.rubricVersion}.json`);
  let result: RevisionLoopResult;
  if (!noCache && existsSync(cachePath)) {
    console.log(`revision-loop result loaded from cache: ${cachePath}`);
    result = JSON.parse(await readFile(cachePath, "utf8")) as RevisionLoopResult;
  } else {
    console.log(`running revision loop (generate → score → revise → re-score)...`);
    const tender = await loadTender(FIXTURE_DIR);
    const tenderInput = toTenderInput(tender);
    const t0 = Date.now();
    result = await runRevisionLoop(tenderInput, rubric, DEMO_APPLICANT);
    console.log(`revision loop done in ${Date.now() - t0}ms · ${result.attempts} attempts`);
    await writeFile(cachePath, JSON.stringify(result, null, 2));
  }
  console.log(`attempts: ${result.attempts} · final routedGaps: ${result.finalScore.routedGaps.length} · final triggered disqualifiers: ${result.finalScore.lotResults.reduce((s, l) => s + l.lotDisqualifiersTriggered.length, 0) + result.finalScore.noticeWideDisqualifiersTriggered.length}`);

  // ─────────────────────────────────────────────────────────────────────
  // Step 2: build the "what the buyer would see" payload
  // ─────────────────────────────────────────────────────────────────────
  const buyerPayload = buildBuyerPayload(result);

  // ─────────────────────────────────────────────────────────────────────
  // Step 3: send to Haiku for critique
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\nsending payload to ${HAIKU_MODEL} for empirical critique...`);
  const critiquePath = join(SPRINT4_5_CACHE, "a5-critique.txt");
  let critique: string;
  if (!noCache && existsSync(critiquePath)) {
    console.log(`critique loaded from cache: ${critiquePath}`);
    critique = await readFile(critiquePath, "utf8");
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const t0 = Date.now();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: buildCritiquePrompt(buyerPayload),
        },
      ],
    });
    critique = response.content[0]?.type === "text" ? response.content[0].text : "";
    console.log(`critique returned in ${Date.now() - t0}ms`);
    await writeFile(critiquePath, critique);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 4: parse + classify
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\ncritique (${critique.length} chars):`);
  console.log("─".repeat(80));
  console.log(critique);
  console.log("─".repeat(80));

  const materialCount = countMaterialAdditions(critique);
  console.log(`\nmaterial additions counted: ${materialCount}`);
  let verdict: "PASS" | "SOFT FAIL" | "HARD FAIL";
  if (materialCount <= 3) verdict = "PASS";
  else if (materialCount <= 6) verdict = "SOFT FAIL";
  else verdict = "HARD FAIL";

  console.log(`\n${"=".repeat(80)}`);
  console.log(`A5 empirical verdict: ${verdict}`);
  console.log(
    verdict === "PASS"
      ? "  → output is already-reviewed; generic LLM finds little material to add"
      : verdict === "SOFT FAIL"
        ? "  → output is mostly reviewed; some material gaps remain (prompt-tuning territory)"
        : "  → output review is too thin; the revision loop isn't running hard enough",
  );
  console.log(`${"=".repeat(80)}`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

// ============================================================================
// Helpers
// ============================================================================

function buildBuyerPayload(result: RevisionLoopResult): string {
  const lines: string[] = [];
  lines.push(`PROPOSAL REVIEW — final output (revised, re-scored, gap-routed)`);
  lines.push(`attempts: ${result.attempts}`);
  lines.push(``);
  lines.push(`COMPLIANCE VERDICT`);
  const allPass = result.finalScore.lotResults.every((lr) => lr.passesGating);
  lines.push(`- passesGating: ${allPass ? "PASS" : "FAIL"}`);
  const totalDisq =
    result.finalScore.lotResults.reduce((s, l) => s + l.lotDisqualifiersTriggered.length, 0) +
    result.finalScore.noticeWideDisqualifiersTriggered.length;
  lines.push(`- triggered disqualifiers: ${totalDisq}`);
  for (const d of result.finalScore.noticeWideDisqualifiersTriggered) {
    lines.push(`  • [notice-wide / ${d.kind}] ${d.rule}`);
  }
  for (const lr of result.finalScore.lotResults) {
    for (const d of lr.lotDisqualifiersTriggered) {
      lines.push(`  • [${lr.lotId} / ${d.kind}] ${d.rule}`);
    }
  }
  lines.push(``);

  lines.push(`RUBRIC SCORE`);
  for (const lr of result.finalScore.lotResults) {
    const lotMax = lr.perCriterion.reduce((s, c) => s + c.maxScore, 0);
    lines.push(`- ${lr.lotId}: ${lr.estimatedTotal.toFixed(0)} / ${lotMax} · ${lr.passesGating ? "pass" : "fail"}`);
    for (const c of lr.perCriterion) {
      lines.push(
        `  • ${c.criterionId}: ${c.estimatedScore.toFixed(1)} / ${c.maxScore} · confidence=${c.confidence}${c.mechanicalConfidence ? ` (mechanical=${c.mechanicalConfidence}; ${c.claimCount} claims: ${JSON.stringify(c.claimsByProvenance ?? {})})` : ""}`,
      );
      for (const w of c.weaknesses) lines.push(`      - weakness: ${w}`);
      for (const m of c.missingEvidence) lines.push(`      - missing: ${m}`);
    }
  }
  lines.push(``);

  lines.push(`ROUTED GAPS (every gap → paid SKU that closes it)`);
  // Group by routedTo for the buyer-facing view
  const byRoute = new Map<string, typeof result.finalScore.routedGaps>();
  for (const g of result.finalScore.routedGaps) {
    if (!byRoute.has(g.routedTo)) byRoute.set(g.routedTo, []);
    byRoute.get(g.routedTo)!.push(g);
  }
  for (const [sku, gaps] of byRoute) {
    lines.push(`- → ${sku} (${gaps.length} gap${gaps.length === 1 ? "" : "s"})`);
    for (const g of gaps.slice(0, 6)) {
      lines.push(`    • ${g.text.slice(0, 160)}`);
    }
    if (gaps.length > 6) lines.push(`    (+${gaps.length - 6} more)`);
  }
  lines.push(``);

  lines.push(`DRAFT SECTIONS (one section per leaf criterion; provenance-tagged claims)`);
  for (const section of result.finalDraft.slice(0, 12)) {
    lines.push(`### ${section.lotId ?? "main"} / ${section.criterionId}`);
    lines.push(section.content);
    lines.push(`Claims (${section.claims.length}):`);
    for (const c of section.claims) {
      lines.push(`  [${c.provenance.kind}] ${c.text}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function buildCritiquePrompt(payload: string): string {
  return `You are a senior UN procurement evaluator (15+ years, P5 level) reviewing a SELF-CHECKED proposal output prepared for a vendor responding to UNICEF RFPS-DAN-2021-503347. The vendor's tool has already:

  - scored every criterion against the published rubric
  - flagged weaknesses and missing evidence per criterion
  - checked for triggered disqualifiers and admin gates
  - tagged every claim with provenance (applicant-evidenced / inferred / gap / uploaded)
  - routed every gap to a paid follow-up service

YOUR JOB: identify what MATERIAL additions a senior evaluator would make to this review. Be ruthlessly specific. The vendor paid $299 for this self-check; if it's already comprehensive, say so plainly.

Distinguish:
  - MATERIAL ADDITIONS = substantive points missed: a missing evaluation dimension, an overlooked disqualifier, a structural rubric mis-read, a wrong provenance call.
  - STYLISTIC ADDITIONS = wording tweaks, redundant phrasing, optional polish. Do NOT count these as material.

Format your response EXACTLY as:

MATERIAL ADDITIONS:
1. <one specific addition>
2. <one specific addition>
... (or "None — the self-review covers the substantive ground.")

STYLISTIC NOTES (optional, not counted):
- <wording tweak>
- ...

VERDICT: <one short sentence>

---

${payload}`;
}

function countMaterialAdditions(critique: string): number {
  // Capture the MATERIAL ADDITIONS section and count numbered items.
  const m = critique.match(/MATERIAL ADDITIONS:?\s*\n([\s\S]*?)(?:STYLISTIC|VERDICT|$)/i);
  if (!m) return 99; // can't parse → fail safe
  const block = m[1];
  if (/^\s*none\b/im.test(block)) return 0;
  const items = block.match(/^\s*\d+\.\s/gm);
  return items ? items.length : 0;
}

main().catch((err) => {
  console.error(`[a5:unhandled] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
