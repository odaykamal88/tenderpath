/**
 * scripts/sprint4-acceptance.ts
 *
 * Sprint 4 acceptance: provenance threading + the shared gap→action routing
 * module (`src/lib/proposal-package/gap-routing.ts`).
 *
 * Two-phase acceptance:
 *
 *   PHASE 1 — synthetic / unit-level
 *     The routing rules are pure, deterministic, no LLM. Test them against
 *     hand-crafted gap text + disqualifier objects, asserting:
 *       - every routed gap has a non-null `routedTo` in the 4-SKU set
 *       - `routedTo` is NEVER the same as `originSku` (for proposal_draft
 *         + readiness flows both)
 *       - rationale + ctaCopy are non-empty
 *       - ruleId tells us which rule fired (telemetry-grade)
 *       - confidence rollup from claims matches the documented priority:
 *         applicant_library/uploaded_document → evidenced, etc.
 *
 *   PHASE 2 — end-to-end on UNICEF
 *     Reuse Sprint 2's cached UNICEF rubric, generate a single draft (no
 *     revision pass — we're testing routing, not refinement), score it,
 *     and verify the produced ScoreResult:
 *       - has `routedGaps` populated
 *       - every CriterionAssessment has `mechanicalConfidence`, `claimCount`,
 *         `claimsByProvenance` populated
 *       - every triggered disqualifier has a routed gap with sourceRef
 *       - the routed PDF page renders (smoke check)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/sprint4-acceptance.ts
 *
 *   # Skip the LLM end-to-end pass and only run PHASE 1:
 *   npx tsx scripts/sprint4-acceptance.ts --no-llm
 *
 *   # Force a fresh score (don't reuse the Sprint 4 score cache):
 *   npx tsx scripts/sprint4-acceptance.ts --no-cache
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  routeCriterionWeakness,
  routeDisqualifier,
  routeAllGaps,
  rollupConfidenceFromClaims,
  provenanceToConfidence,
  countClaimsByProvenance,
  SERVICE_CATALOG,
} from "@/lib/proposal-package/gap-routing";
import type {
  Disqualifier,
  ScoreResult,
  RoutedGap,
  Claim,
  ServiceSku,
  OriginSku,
  TenderRubric,
} from "@/lib/proposal-package/scoring-engine";

import { loadTender } from "@/lib/proposal-package/manifest-loader";
import { toTenderInput } from "@/lib/proposal-package/rubric-extractor";
import { generateDraftSections } from "@/lib/proposal-package/draft-generator";
import { scoreDraft } from "@/lib/proposal-package/rubric-scorer";
import { DEMO_APPLICANT } from "@/lib/proposal-package/applicant-context";
import { renderScoredDraftPdf } from "@/lib/proposal-package/pdfDocs";

const REPO_ROOT = process.cwd();
const FIXTURE_DIR = join(REPO_ROOT, "tests/fixtures/un-tenders/unicef-RFPS-DAN-2021-503347");
const SPRINT2_RUBRIC = "/tmp/sprint2-cache/rubric-unicef-services.json";
const SPRINT4_CACHE = "/tmp/sprint4-cache";
const OUTPUT_DIR = "/tmp/sprint4-output";

const VALID_SKUS: ServiceSku[] = ["bid_no_bid", "matching", "proposal_draft", "roster"];

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

// ============================================================================
// PHASE 1 — synthetic routing tests (no LLM)
// ============================================================================

function assertValidRoute(g: RoutedGap, label: string, origin: OriginSku): void {
  if (!VALID_SKUS.includes(g.routedTo)) {
    fail(`${label}: routedTo "${g.routedTo}" not in valid SKU set`);
    return;
  }
  if (origin !== "readiness" && g.routedTo === origin) {
    fail(`${label}: routedTo === originSku "${origin}" — origin exclusion failed`);
    return;
  }
  if (!g.rationale || g.rationale.length === 0) fail(`${label}: empty rationale`);
  if (!g.ctaCopy || g.ctaCopy.length === 0) fail(`${label}: empty ctaCopy`);
  if (!g.ruleId || g.ruleId.length === 0) fail(`${label}: empty ruleId`);
}

function testRoutingRules(): void {
  console.log(`\n>>> PHASE 1.1: routing rules cover the 6 documented categories`);

  const cases: Array<{ text: string; expectFrom: ServiceSku; label: string }> = [
    { text: "Applicant is not registered on UNGM and has no LTA history with UNICEF", expectFrom: "roster", label: "roster_registration" },
    { text: "Past performance is thin; the draft cites only one similar project from 2018", expectFrom: "roster", label: "past_performance" },
    { text: "Technical specification mismatch: HDPE pipes claimed don't meet EN 12842 PN16", expectFrom: "matching", label: "spec_mismatch" },
    { text: "The mandatory Financial Proposal Submission Form was not submitted as a separate file", expectFrom: "bid_no_bid", label: "mandatory_form" },
    { text: "Lead applicant nationality is not eligible per Section 4.2", expectFrom: "matching", label: "eligibility" },
    { text: "Presentation and narrative are weak; sections are not aligned to evaluation criteria", expectFrom: "proposal_draft", label: "presentation" },
    { text: "Random gap text with no keyword match whatsoever", expectFrom: "proposal_draft", label: "fallback" },
  ];

  // Test from the readiness origin first — all 4 SKUs are open routes
  for (const c of cases) {
    const g = routeCriterionWeakness(c.text, { originSku: "readiness" });
    if (g.routedTo !== c.expectFrom) {
      fail(`readiness · ${c.label}: expected ${c.expectFrom}, got ${g.routedTo} (rule=${g.ruleId})`);
    } else {
      pass(`readiness · ${c.label} → ${g.routedTo}`);
    }
    assertValidRoute(g, `readiness/${c.label}`, "readiness");
  }

  // Test from the proposal_draft origin — origin exclusion redirects
  // "presentation" + "fallback" away from proposal_draft (the user is
  // already there). Other rules pass through unchanged.
  console.log(`\n>>> PHASE 1.2: origin exclusion redirects routedTo away from originSku`);
  for (const c of cases) {
    const g = routeCriterionWeakness(c.text, { originSku: "proposal_draft" });
    if (g.routedTo === "proposal_draft") {
      fail(`proposal_draft · ${c.label}: routedTo === origin — exclusion broken`);
    }
    if (c.expectFrom === "proposal_draft" && g.routedTo !== "matching") {
      // FALLBACK_CHAIN[proposal_draft] === "matching"
      fail(`proposal_draft · ${c.label}: expected fallback "matching", got ${g.routedTo}`);
    }
    assertValidRoute(g, `proposal_draft/${c.label}`, "proposal_draft");
  }
  pass(`origin exclusion holds across all 7 cases · proposal_draft origin`);
}

function testDisqualifierRouting(): void {
  console.log(`\n>>> PHASE 1.3: disqualifier routing by DisqualifierKind`);
  const disqs: Disqualifier[] = [
    { id: "d1", kind: "mandatory_form", rule: "Form A signed and submitted", source: { docId: "rfp.pdf", rubricVersion: 1 } },
    { id: "d2", kind: "eligibility", rule: "Lead applicant country eligible", source: { docId: "rfp.pdf", rubricVersion: 1 } },
    { id: "d3", kind: "format", rule: "Financial proposal in PDF format, not editable", source: { docId: "rfp.pdf", rubricVersion: 1 } },
    { id: "d4", kind: "deadline", rule: "Submission by 23:59 CET", source: { docId: "rfp.pdf", rubricVersion: 1 } },
    { id: "d5", kind: "financial", rule: "Total price exceeds budget ceiling", source: { docId: "rfp.pdf", rubricVersion: 1 } },
  ];
  const expectations: Record<Disqualifier["kind"], ServiceSku> = {
    mandatory_form: "bid_no_bid",
    eligibility: "matching",
    format: "bid_no_bid",
    deadline: "matching",
    financial: "bid_no_bid",
  };

  for (const d of disqs) {
    const g = routeDisqualifier(d, { originSku: "readiness" }, { lotId: "main" });
    if (g.routedTo !== expectations[d.kind]) {
      fail(`readiness · ${d.kind}: expected ${expectations[d.kind]}, got ${g.routedTo}`);
    } else {
      pass(`readiness · ${d.kind} → ${g.routedTo}`);
    }
    if (g.sourceRef?.docId !== d.source.docId) {
      fail(`readiness · ${d.kind}: sourceRef.docId did not survive routing`);
    }
    assertValidRoute(g, `readiness/${d.kind}`, "readiness");
  }
}

function testConfidenceRollup(): void {
  console.log(`\n>>> PHASE 1.4: rollupConfidenceFromClaims priority`);

  // No claims → unverified
  if (rollupConfidenceFromClaims([]) !== "unverified") fail("[] → unverified");
  else pass("[] → unverified");

  const mk = (kind: Claim["provenance"]["kind"]): Claim => ({
    text: "x",
    provenance: { kind },
  });

  // applicant_library wins everything else
  const r1 = rollupConfidenceFromClaims([mk("applicant_library"), mk("gap"), mk("inferred")]);
  if (r1 !== "evidenced") fail(`applicant_library+gap+inferred → ${r1} (expected evidenced)`);
  else pass(`applicant_library+gap+inferred → evidenced`);

  // uploaded_document also wins
  const r2 = rollupConfidenceFromClaims([mk("uploaded_document"), mk("inferred")]);
  if (r2 !== "evidenced") fail(`uploaded_document+inferred → ${r2}`);
  else pass(`uploaded_document+inferred → evidenced`);

  // inferred + gap, no evidenced kinds → inferred (inferred beats gap by priority)
  const r3 = rollupConfidenceFromClaims([mk("inferred"), mk("gap")]);
  if (r3 !== "inferred") fail(`inferred+gap → ${r3}`);
  else pass(`inferred+gap → inferred`);

  // only gap → gap
  const r4 = rollupConfidenceFromClaims([mk("gap")]);
  if (r4 !== "gap") fail(`gap → ${r4}`);
  else pass(`gap → gap`);

  // provenanceToConfidence direct mapping
  if (provenanceToConfidence("applicant_library") !== "evidenced") fail("applicant_library → evidenced");
  if (provenanceToConfidence("uploaded_document") !== "evidenced") fail("uploaded_document → evidenced");
  if (provenanceToConfidence("inferred") !== "inferred") fail("inferred → inferred");
  if (provenanceToConfidence("gap") !== "gap") fail("gap → gap");
  pass(`provenanceToConfidence: 4-way mapping holds`);

  // countClaimsByProvenance
  const counts = countClaimsByProvenance([
    mk("applicant_library"),
    mk("applicant_library"),
    mk("inferred"),
    mk("gap"),
  ]);
  if (counts.applicant_library !== 2 || counts.inferred !== 1 || counts.gap !== 1) {
    fail(`countClaimsByProvenance: ${JSON.stringify(counts)}`);
  } else {
    pass(`countClaimsByProvenance returns correct breakdown`);
  }
}

function testServiceCatalog(): void {
  console.log(`\n>>> PHASE 1.5: SERVICE_CATALOG completeness`);
  for (const sku of VALID_SKUS) {
    const meta = SERVICE_CATALOG[sku];
    if (!meta) {
      fail(`SERVICE_CATALOG missing sku ${sku}`);
      continue;
    }
    if (!meta.label || !meta.price || !meta.ctaCopy) {
      fail(`SERVICE_CATALOG[${sku}] has empty label/price/ctaCopy`);
    } else {
      pass(`SERVICE_CATALOG[${sku}] = "${meta.label} ${meta.price}" · cta="${meta.ctaCopy}"`);
    }
  }
}

// ============================================================================
// PHASE 2 — end-to-end on UNICEF (LLM-driven)
// ============================================================================

async function runEndToEnd(noCache: boolean): Promise<void> {
  console.log(`\n>>> PHASE 2: end-to-end on UNICEF (generate → score → route)`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`    ⚠ ANTHROPIC_API_KEY not set — skipping phase 2`);
    failures += 1;
    return;
  }
  if (!existsSync(SPRINT2_RUBRIC)) {
    console.warn(`    ⚠ Sprint 2 rubric cache not found at ${SPRINT2_RUBRIC} — skipping phase 2`);
    console.warn(`    (run scripts/sprint2-acceptance.ts first to seed the cache)`);
    failures += 1;
    return;
  }

  await mkdir(SPRINT4_CACHE, { recursive: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Reuse the Sprint 2 cached rubric (re-extracting is 50s of LLM calls we don't need)
  const rubric = JSON.parse(await readFile(SPRINT2_RUBRIC, "utf8")) as TenderRubric;
  console.log(`    rubric loaded: ${rubric.lots.length} lot · ${rubric.lots.reduce((s, l) => s + l.criteria.length, 0)} criteria · ${rubric.noticeWideDisqualifiers.length} notice-wide disqualifiers`);

  const tender = await loadTender(FIXTURE_DIR);
  const tenderInput = toTenderInput(tender);

  // Cache the (draft, score) pair so re-runs are instant. Cache key includes
  // rubricVersion + applicant signature so it's tied to the inputs.
  const scoreCachePath = join(SPRINT4_CACHE, `score-unicef-v${rubric.rubricVersion}.json`);
  let scoreResult: ScoreResult;
  let draft: Awaited<ReturnType<typeof generateDraftSections>>;
  if (!noCache && existsSync(scoreCachePath)) {
    console.log(`    score cache hit: ${scoreCachePath}`);
    const cached = JSON.parse(await readFile(scoreCachePath, "utf8")) as { draft: typeof draft; score: ScoreResult };
    draft = cached.draft;
    scoreResult = cached.score;
  } else {
    console.log(`    generating draft + scoring (one pass — no revision loop)...`);
    const t0 = Date.now();
    draft = await generateDraftSections(tenderInput, rubric, DEMO_APPLICANT);
    console.log(`    draft generated in ${Date.now() - t0}ms (${draft.length} sections, ${draft.reduce((s, d) => s + d.claims.length, 0)} claims total)`);
    const t1 = Date.now();
    scoreResult = await scoreDraft(draft, rubric, DEMO_APPLICANT);
    console.log(`    scored in ${Date.now() - t1}ms`);
    await writeFile(scoreCachePath, JSON.stringify({ draft, score: scoreResult }, null, 2));
  }

  // 2.1 — every CriterionAssessment carries mechanical metrics
  console.log(`\n>>> PHASE 2.1: CriterionAssessment carries mechanical metrics (A4)`);
  let assessmentsChecked = 0;
  for (const lot of scoreResult.lotResults) {
    for (const c of lot.perCriterion) {
      assessmentsChecked += 1;
      if (c.mechanicalConfidence == null) {
        fail(`${lot.lotId}/${c.criterionId}: missing mechanicalConfidence`);
      }
      if (c.claimCount == null) {
        fail(`${lot.lotId}/${c.criterionId}: missing claimCount`);
      }
      if (c.claimsByProvenance == null) {
        fail(`${lot.lotId}/${c.criterionId}: missing claimsByProvenance`);
      }
    }
  }
  if (assessmentsChecked > 0 && failures === 0) {
    pass(`all ${assessmentsChecked} criterion assessments carry mechanicalConfidence + claimCount + claimsByProvenance`);
  }

  // 2.2 — routedGaps populated, every entry valid
  console.log(`\n>>> PHASE 2.2: ScoreResult.routedGaps populated + every entry valid (A3 + R1)`);
  console.log(`    total routedGaps: ${scoreResult.routedGaps.length}`);

  if (scoreResult.routedGaps.length === 0) {
    fail(`routedGaps is empty — UNICEF score MUST surface gaps for the synthetic applicant`);
  } else {
    pass(`routedGaps has ${scoreResult.routedGaps.length} entries`);
  }

  const byRoute = new Map<ServiceSku, number>();
  for (const g of scoreResult.routedGaps) {
    assertValidRoute(g, `gap-${g.kind}-${g.criterionId ?? g.lotId ?? "wide"}`, "proposal_draft");
    byRoute.set(g.routedTo, (byRoute.get(g.routedTo) ?? 0) + 1);
  }
  if (failures === 0) pass(`every routed gap has valid routedTo + non-empty rationale + non-empty ctaCopy + non-empty ruleId`);

  console.log(`    routing distribution (origin=proposal_draft):`);
  for (const [sku, count] of byRoute) {
    console.log(`      • ${SERVICE_CATALOG[sku].label.padEnd(28)} ${count} gap${count === 1 ? "" : "s"} — ${SERVICE_CATALOG[sku].price}`);
  }

  // 2.3 — no triggered disqualifier slips routing
  console.log(`\n>>> PHASE 2.3: every triggered disqualifier surfaces as a routed gap with sourceRef`);
  const triggeredCount =
    scoreResult.lotResults.reduce((s, l) => s + l.lotDisqualifiersTriggered.length, 0) +
    scoreResult.noticeWideDisqualifiersTriggered.length;
  const disqRoutedCount = scoreResult.routedGaps.filter((g) => g.kind === "disqualifier").length;
  if (disqRoutedCount !== triggeredCount) {
    fail(`triggered disqualifiers=${triggeredCount} but routed disqualifier gaps=${disqRoutedCount}`);
  } else {
    pass(`triggered disqualifiers=${triggeredCount} all routed`);
  }
  const disqWithoutSource = scoreResult.routedGaps.filter((g) => g.kind === "disqualifier" && !g.sourceRef?.docId);
  if (disqWithoutSource.length > 0) {
    fail(`${disqWithoutSource.length} disqualifier routed gaps missing sourceRef`);
  } else if (disqRoutedCount > 0) {
    pass(`every disqualifier routed gap carries sourceRef.docId`);
  }

  // 2.4 — smoke-render the PDF (the new page exists)
  console.log(`\n>>> PHASE 2.4: scored-draft PDF renders with the routed-actions page`);
  try {
    const pdf = await renderScoredDraftPdf({
      rubric,
      draft,
      score: scoreResult,
      applicant: DEMO_APPLICANT,
      history: [],
      workOrderId: 9001,
      tenderTitle: tender.manifest.title,
      agency: tender.manifest.agency,
      generatedAt: new Date().toISOString().slice(0, 10),
    });
    const pdfPath = join(OUTPUT_DIR, "unicef-sprint4.pdf");
    await writeFile(pdfPath, pdf);
    console.log(`    PDF written: ${pdfPath} (${(pdf.byteLength / 1024).toFixed(1)} KB)`);
    pass(`renderScoredDraftPdf returned non-empty buffer`);
  } catch (err) {
    fail(`PDF render failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// Synthetic end-to-end routeAllGaps test (no LLM)
// ============================================================================

function testRouteAllGapsSynthetic(): void {
  console.log(`\n>>> PHASE 1.6: routeAllGaps walks a synthetic ScoreResult correctly`);

  const synthetic: ScoreResult = {
    rubricVersion: 1,
    routedGaps: [],
    lotResults: [
      {
        lotId: "main",
        passesGating: false,
        estimatedTotal: 60,
        perCriterion: [
          {
            criterionId: "1.1",
            estimatedScore: 5,
            maxScore: 10,
            confidence: "inferred",
            weaknesses: ["Past performance is thin"],
            missingEvidence: ["Three reference contracts with UN agencies in last 5 years"],
          },
          {
            criterionId: "1.2",
            estimatedScore: 8,
            maxScore: 10,
            confidence: "evidenced",
            weaknesses: [],
            missingEvidence: [],
          },
        ],
        lotDisqualifiersTriggered: [
          { id: "d1", kind: "mandatory_form", rule: "Form A is required", source: { docId: "rfp.pdf", rubricVersion: 1 } },
        ],
      },
    ],
    noticeWideDisqualifiersTriggered: [
      { id: "w1", kind: "deadline", rule: "Submission deadline is hard", source: { docId: "rfp.pdf", rubricVersion: 1 } },
    ],
  };

  // Add a claim-level gap via the draft argument
  const syntheticDraft = [
    {
      lotId: "main",
      criterionId: "1.1",
      claims: [
        {
          text: "Atlas has ISO 9001",
          provenance: { kind: "applicant_library" as const },
        },
        {
          text: "UN past performance is missing",
          provenance: { kind: "gap" as const, note: "No UN past performance documented for the synthetic applicant" },
        },
      ],
    },
  ];

  const all = routeAllGaps(synthetic, { originSku: "proposal_draft" }, syntheticDraft);
  // Expected: 1 weakness + 1 missingEvidence + 1 lot-disq + 1 notice-wide + 1 claim_gap = 5
  if (all.length !== 5) fail(`routeAllGaps synthetic: expected 5 gaps, got ${all.length}`);
  else pass(`routeAllGaps synthetic returns 5 gaps (1 weakness + 1 missing + 1 lot-disq + 1 notice-wide + 1 claim_gap)`);

  const kinds = new Set(all.map((g) => g.kind));
  for (const k of ["weakness", "missing_evidence", "disqualifier", "claim_gap"]) {
    if (!kinds.has(k as RoutedGap["kind"])) fail(`routeAllGaps: missing kind=${k}`);
  }
  if (failures === 0) pass(`routeAllGaps emits all 4 gap kinds`);

  // None should route to proposal_draft (origin)
  for (const g of all) {
    if (g.routedTo === "proposal_draft") fail(`routeAllGaps: ${g.kind} routed back to origin`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const skipLlm = process.argv.includes("--no-llm");
  const noCache = process.argv.includes("--no-cache");

  console.log("=".repeat(80));
  console.log("Sprint 4 acceptance — provenance + shared gap→action routing");
  console.log("=".repeat(80));

  // PHASE 1 — synthetic, no LLM
  testRoutingRules();
  testDisqualifierRouting();
  testConfidenceRollup();
  testServiceCatalog();
  testRouteAllGapsSynthetic();

  // PHASE 2 — end-to-end (LLM)
  if (!skipLlm) {
    await runEndToEnd(noCache);
  } else {
    console.log(`\n>>> PHASE 2: skipped (--no-llm)`);
  }

  console.log("\n" + "=".repeat(80));
  console.log(failures === 0 ? "Sprint 4 acceptance: PASS" : `Sprint 4 acceptance: FAIL (${failures} issue${failures === 1 ? "" : "s"})`);
  console.log("=".repeat(80));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`[acceptance:unhandled] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
