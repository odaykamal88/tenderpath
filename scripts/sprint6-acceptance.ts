/**
 * scripts/sprint6-acceptance.ts
 *
 * Sprint 6 acceptance — Proposal-output page rewrite.
 *
 * Builds the dev fixture that the new B1-B5 page consumes via
 *   /dashboard/proposals/[workOrderId]?fixture=unicef-scored
 * Without this fixture, the page only ever renders the legacy view because
 * no production work-order yet stores the new ProposalOutput.score / .draft
 * / .routed_gaps fields (the generator switch lands in Sprint 6b).
 *
 * The fixture is assembled from two existing caches the earlier sprints
 * already produced — we do NOT re-run the LLM:
 *   - /tmp/sprint4-5-cache/revision-loop-unicef-v1.json
 *       runRevisionLoop output for the UNICEF tender: finalDraft (9
 *       sections), finalScore (ScoreResult with lotResults +
 *       routedGaps + noticeWideDisqualifiersTriggered), attempts,
 *       history, cascades.
 *   - /tmp/sprint2-cache/rubric-unicef-services.json
 *       extractRubric output for the same tender: lots[].criteria[]
 *       with id + label. The page uses this to resolve criterionId →
 *       human label in the per-criterion breakdown (B2). Without it
 *       the page falls back to raw IDs ("1.1", "1.2" …).
 *
 * Output shape mirrors what /api/dashboard/work-orders/[id]/proposal-package
 * will return once Sprint 6b wires the new generator. The legacy fields
 * are populated minimally so older renderers (e.g. the work-order tile)
 * still degrade gracefully if they ever read this fixture.
 *
 * The shape is:
 *   {
 *     // legacy fields — kept empty / placeholder so the page's
 *     // adaptScored() runtime check still picks up the NEW shape
 *     executive_summary, technical_approach, compliance_checklist,
 *     required_documents, cover_letter_draft, financial_template_notes,
 *     missing_information, next_steps,
 *
 *     // Sprint 6 fields — read by adaptScored() in page.tsx
 *     score:             ScoreResult,
 *     draft:             DraftSection[],
 *     routed_gaps:       RoutedGap[],   // duplicated from score.routedGaps
 *                                       // for forward-compat with the
 *                                       // generator emit shape
 *     cascades:          CrossSectionCascade[],
 *     revision_history:  RevisionAttemptSummary[],
 *     tender_rubric:     TenderRubric,  // for label resolution
 *   }
 *
 * Asserts:
 *   - Both source caches exist (run sprint2 + sprint4 first)
 *   - finalScore.lotResults and finalScore.routedGaps are arrays
 *   - finalDraft is a non-empty array of DraftSection-shaped items
 *   - tender_rubric.lots[0].criteria has matching IDs vs the score's
 *     criterionAssessments (i.e. the rubric + score belong together)
 *   - Output JSON parses back as the union shape the page expects
 *
 * Usage:
 *   npx tsx scripts/sprint6-acceptance.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const REVISION_LOOP_CACHE = "/tmp/sprint4-5-cache/revision-loop-unicef-v1.json";
const RUBRIC_CACHE = "/tmp/sprint2-cache/rubric-unicef-services.json";
const FIXTURE_PATH = join(process.cwd(), "tests/fixtures/sprint6-page/unicef-scored.json");

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

interface RevisionLoopJson {
  finalDraft: unknown[];
  finalScore: {
    rubricVersion: string;
    lotResults: Array<{
      lotId: string;
      // ScoreResult.lotResults[].perCriterion is the engine field name
      // (see scoring-engine.ts LotScoreResult). Earlier draft of this
      // script called it criterionAssessments which produced an empty
      // overlap and a false-positive pass.
      perCriterion: Array<{ criterionId: string }>;
    }>;
    noticeWideDisqualifiersTriggered: unknown[];
    routedGaps: unknown[];
  };
  attempts: number;
  history: unknown[];
  cascades: unknown[];
}

interface RubricJson {
  tenderId?: string;
  lots: Array<{
    lotId: string;
    label: string;
    criteria: Array<{ id: string; label: string }>;
  }>;
  rubricVersion?: string;
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 6 acceptance — proposal-output page fixture ===\n");

  // ------------------------------------------------------------------------
  // 1. Read source caches
  // ------------------------------------------------------------------------
  console.log("  step 1: reading source caches");
  if (!existsSync(REVISION_LOOP_CACHE)) {
    fail(`missing ${REVISION_LOOP_CACHE} — run scripts/sprint4-acceptance.ts first`);
    process.exit(1);
  }
  if (!existsSync(RUBRIC_CACHE)) {
    fail(`missing ${RUBRIC_CACHE} — run scripts/sprint2-acceptance.ts first`);
    process.exit(1);
  }
  const revisionLoop = JSON.parse(await readFile(REVISION_LOOP_CACHE, "utf8")) as RevisionLoopJson;
  const rubric = JSON.parse(await readFile(RUBRIC_CACHE, "utf8")) as RubricJson;
  pass(`revision-loop cache loaded (attempts=${revisionLoop.attempts})`);
  pass(`rubric cache loaded (lots=${rubric.lots.length})`);

  // ------------------------------------------------------------------------
  // 2. Sanity-check the source caches
  // ------------------------------------------------------------------------
  console.log("\n  step 2: sanity-checking shapes");
  if (!Array.isArray(revisionLoop.finalScore?.lotResults) || revisionLoop.finalScore.lotResults.length === 0) {
    fail("finalScore.lotResults missing or empty");
  } else {
    pass(`finalScore.lotResults: ${revisionLoop.finalScore.lotResults.length} lot(s)`);
  }
  if (!Array.isArray(revisionLoop.finalScore?.routedGaps)) {
    fail("finalScore.routedGaps not an array");
  } else {
    pass(`finalScore.routedGaps: ${revisionLoop.finalScore.routedGaps.length} gap(s)`);
  }
  if (!Array.isArray(revisionLoop.finalDraft) || revisionLoop.finalDraft.length === 0) {
    fail("finalDraft missing or empty");
  } else {
    pass(`finalDraft: ${revisionLoop.finalDraft.length} section(s)`);
  }
  if (!Array.isArray(rubric.lots) || rubric.lots.length === 0) {
    fail("rubric.lots missing or empty");
  } else {
    pass(`rubric.lots: ${rubric.lots.length} lot(s)`);
  }

  // Verify rubric + score belong together. We can't strict-match on every
  // criterion (the scorer filters to leaves) but the score's criterion
  // IDs should all appear in the rubric.
  const rubricIds = new Set<string>();
  for (const lot of rubric.lots) for (const c of lot.criteria ?? []) rubricIds.add(c.id);
  const scoreIds = new Set<string>();
  for (const lot of revisionLoop.finalScore.lotResults) {
    for (const ca of lot.perCriterion ?? []) scoreIds.add(ca.criterionId);
  }
  const orphaned = [...scoreIds].filter((id) => !rubricIds.has(id));
  if (orphaned.length > 0) {
    fail(`score has criterion IDs absent from rubric: ${orphaned.slice(0, 3).join(", ")}${orphaned.length > 3 ? "…" : ""}`);
  } else {
    pass(`score+rubric IDs align (${scoreIds.size} score IDs all present in ${rubricIds.size} rubric IDs)`);
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} failure(s) before assembly — aborting`);
    process.exit(1);
  }

  // ------------------------------------------------------------------------
  // 3. Assemble the proposal_packages.output payload
  // ------------------------------------------------------------------------
  console.log("\n  step 3: assembling proposal_packages.output payload");
  const output = {
    // Legacy ProposalOutput fields — kept as empty defaults so anything
    // that still reads the pre-Sprint-6 shape degrades gracefully.
    executive_summary: "",
    technical_approach: [],
    compliance_checklist: [],
    required_documents: [],
    cover_letter_draft: "",
    financial_template_notes: [],
    missing_information: [],
    next_steps: [],

    // Sprint 6 new shape — the fields the rewritten page consumes via
    // adaptScored(). Order matches the page's B1→B5 reading flow.
    score: revisionLoop.finalScore,
    draft: revisionLoop.finalDraft,
    routed_gaps: revisionLoop.finalScore.routedGaps,
    cascades: revisionLoop.cascades,
    revision_history: revisionLoop.history,
    tender_rubric: rubric,
  };
  pass("payload assembled (legacy + new fields populated)");

  // ------------------------------------------------------------------------
  // 4. Write the fixture
  // ------------------------------------------------------------------------
  console.log("\n  step 4: writing fixture");
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, JSON.stringify(output, null, 2), "utf8");
  const bytes = (await readFile(FIXTURE_PATH)).byteLength;
  pass(`wrote ${FIXTURE_PATH} (${(bytes / 1024).toFixed(1)} KB)`);

  // ------------------------------------------------------------------------
  // 5. Re-read + verify the round-trip
  // ------------------------------------------------------------------------
  console.log("\n  step 5: verifying round-trip");
  const reread = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as {
    score?: { lotResults?: unknown[]; routedGaps?: unknown[] };
    draft?: unknown[];
    revision_history?: unknown[];
    tender_rubric?: { lots?: unknown[] };
  };
  if (!reread.score || !Array.isArray(reread.score.lotResults) || !Array.isArray(reread.score.routedGaps)) {
    fail("re-read fixture failed adaptScored() shape check (score.lotResults + score.routedGaps must be arrays)");
  } else {
    pass("fixture passes adaptScored() shape check");
  }
  if (!Array.isArray(reread.draft) || reread.draft.length === 0) {
    fail("re-read fixture has no draft sections");
  } else {
    pass(`fixture draft: ${reread.draft.length} section(s)`);
  }
  if (!Array.isArray(reread.revision_history)) {
    fail("re-read fixture has no revision_history");
  } else {
    pass(`fixture revision_history: ${reread.revision_history.length} attempt(s)`);
  }
  if (!reread.tender_rubric || !Array.isArray(reread.tender_rubric.lots)) {
    fail("re-read fixture has no tender_rubric.lots");
  } else {
    pass(`fixture tender_rubric: ${reread.tender_rubric.lots.length} lot(s)`);
  }

  // ------------------------------------------------------------------------
  // 6. Summary
  // ------------------------------------------------------------------------
  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log(`✓ Sprint 6 fixture ready at ${FIXTURE_PATH}`);
  console.log("\n  Visual verification:");
  console.log("    1. npm run dev");
  console.log("    2. open http://localhost:3000/dev/proposal-preview/unicef-scored");
  console.log("       (route sits outside /dashboard so it bypasses proxy.ts auth +");
  console.log("        the dashboard client-layout localStorage gate — works without");
  console.log("        DATABASE_URL. Hard-gated on NODE_ENV !== production.)");
  console.log("    3. confirm B1 verdict, B2 score, B3 routed gaps, B4 draft+claims, B5 export render\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
