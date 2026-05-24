/**
 * scripts/sprint3-acceptance.ts
 *
 * Sprint 3 acceptance harness for the proposal-engine's corrigendum /
 * amendment / Q&A re-extraction + immutable versioning flow.
 *
 * The UNICEF fixture (RFPS-DAN-2021-503347) has two notices:
 *   - notice-135638 (base, published 2021-07-29)
 *   - notice-146988 (Amendment 1, published 2021-10-01, revised Annex C TOR)
 *
 * The acceptance walks through what happens when the amendment lands AFTER
 * the bidder has already extracted a rubric from the base:
 *
 *   1. Load tender with noticeFilter=['135638']  → priorTender (base only)
 *   2. extractRubric(priorTender)                → priorRubric (v1)
 *   3. recordSnapshot(priorRubric)               → priorSnapshot (v1)
 *      ↑ in a real run this is the rubric that scored the bidder's first draft
 *
 *   4. Load tender with full manifest            → fullTender (base + amendment)
 *   5. newDocs = fullTender.docs ∖ priorTender.docs   (notice-146988 only)
 *   6. reextractAndDiff(priorRubric, priorDocs, newDocs) →
 *        { rubric: nextRubric (v2), changed: true, deltas: [...] }
 *
 *   7. recordSnapshot(nextRubric)                → newSnapshot (v2)
 *   8. markSupersededBy(priorSnapshot, newSnapshot.snapshotId)
 *        → priorSnapshotMarked.supersededBy = newSnapshot.snapshotId
 *      ↑ prior snapshot is INTACT; only the supersededBy pointer is set
 *
 *   9. isSnapshotStale(priorSnapshot, nextRubric.rubricVersion) === true
 *      → in production, generation_status flips to 'rubric_stale' on any
 *        proposal_packages row whose latest snapshot has the prior version
 *
 * Plus a Sprint 3 A5 bolt-on (from proposal-output-ux.md PART A):
 *   - Every disqualifier in priorRubric carries rule + source.docId
 *   - Every triggered disqualifier (when scored) carries the same
 *   - Confirms "already-reviewed" requires source-linked disqualifiers
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/sprint3-acceptance.ts
 *
 *   # Re-extracts both rubrics (no cache):
 *   npx tsx scripts/sprint3-acceptance.ts --no-cache
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadTender } from "@/lib/proposal-package/manifest-loader";
import { extractRubricFromTender } from "@/lib/proposal-package/rubric-extractor";
import { reextractAndDiff } from "@/lib/proposal-package/reextract";
import { diffRubrics, formatDelta } from "@/lib/proposal-package/rubric-diff";
import {
  recordSnapshot,
  markSupersededBy,
  isSnapshotStale,
} from "@/lib/proposal-package/snapshot";
import { DEMO_APPLICANT } from "@/lib/proposal-package/applicant-context";
import type {
  TenderRubric,
  IngestedDoc,
  DocManifestEntry,
} from "@/lib/proposal-package/scoring-engine";

const REPO_ROOT = process.cwd();
const FIXTURE_DIR = join(
  REPO_ROOT,
  "tests/fixtures/un-tenders/unicef-RFPS-DAN-2021-503347",
);
const CACHE_DIR = "/tmp/sprint3-cache";
const OUTPUT_DIR = "/tmp/sprint3-output";

async function loadOrExtractRubric(
  cacheKey: string,
  extract: () => Promise<TenderRubric>,
  useCache: boolean,
): Promise<TenderRubric> {
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
  if (useCache && existsSync(cachePath)) {
    console.log(`    rubric loaded from cache: ${cachePath}`);
    return JSON.parse(await readFile(cachePath, "utf8")) as TenderRubric;
  }
  console.log(`    rubric not cached — extracting via Sonnet...`);
  const t0 = Date.now();
  const rubric = await extract();
  console.log(`    rubric extracted in ${Date.now() - t0}ms`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(rubric, null, 2));
  return rubric;
}

function manifestFromDocs(docs: IngestedDoc[]): DocManifestEntry[] {
  return docs.map((d) => d.manifest);
}

function summariseRubric(label: string, r: TenderRubric): void {
  const criteriaTotal = r.lots.reduce((s, l) => s + l.criteria.length, 0);
  const lotDisqTotal = r.lots.reduce((s, l) => s + l.disqualifiers.length, 0);
  console.log(
    `    ${label}: v${r.rubricVersion} · ${r.lots.length} lot${r.lots.length === 1 ? "" : "s"} · ${criteriaTotal} criteria · ${lotDisqTotal} lot-disqualifiers · ${r.noticeWideDisqualifiers.length} notice-wide`,
  );
}

// ============================================================================
// A5 bolt-on (proposal-output-ux.md PART A — already-reviewed acceptance)
// ============================================================================
//
// Every disqualifier in the rubric MUST carry a human-readable rule AND a
// SourceRef. The UI ("you would be disqualified: form X missing, financial
// not separated") leads on these fields; if they're not present, the
// already-reviewed claim is undefendable.
function assertDisqualifiersSourced(rubric: TenderRubric): string[] {
  const problems: string[] = [];
  const checkOne = (where: string, kind: string, id: string, rule: string, src: unknown): void => {
    if (!rule || rule.trim().length === 0) {
      problems.push(`${where} disqualifier ${id} (${kind}) has empty rule`);
    }
    if (!src || typeof src !== "object" || !("docId" in (src as object))) {
      problems.push(`${where} disqualifier ${id} (${kind}) missing SourceRef`);
    } else {
      const r = src as { docId?: unknown };
      if (typeof r.docId !== "string" || r.docId.trim().length === 0) {
        problems.push(`${where} disqualifier ${id} (${kind}) SourceRef.docId is empty`);
      }
    }
  };
  for (const lot of rubric.lots) {
    for (const d of lot.disqualifiers) checkOne(`lot ${lot.lotId}`, d.kind, d.id, d.rule, d.source);
  }
  for (const d of rubric.noticeWideDisqualifiers) checkOne("notice-wide", d.kind, d.id, d.rule, d.source);
  return problems;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const noCache = process.argv.includes("--no-cache");

  console.log("=".repeat(80));
  console.log("Sprint 3 acceptance — corrigendum/Q&A re-extract + immutable versioning");
  console.log("=".repeat(80));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[acceptance:env:failed] ANTHROPIC_API_KEY is not set");
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  let allPassed = true;

  // ─────────────────────────────────────────────────────────────────────
  // Step 1-2: pre-amendment view
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 1: load UNICEF with noticeFilter=['135638'] (base only)`);
  const priorTender = await loadTender(FIXTURE_DIR, { noticeFilter: ["135638"] });
  console.log(`    base notice loaded: ${priorTender.docs.length} docs, ${priorTender.qaEntries.length} QA entries`);

  console.log(`\n>>> Step 2: extract rubric from base only → priorRubric (v1)`);
  const priorRubric = await loadOrExtractRubric(
    "rubric-pre-amendment",
    () => extractRubricFromTender(priorTender),
    !noCache,
  );
  summariseRubric("priorRubric", priorRubric);

  const priorProblems = assertDisqualifiersSourced(priorRubric);
  if (priorProblems.length > 0) {
    console.error(`    ✗ A5 bolt-on: priorRubric disqualifier integrity issues:`);
    for (const p of priorProblems) console.error(`        • ${p}`);
    allPassed = false;
  } else {
    console.log(`    ✓ A5 bolt-on: every disqualifier in priorRubric has rule + SourceRef`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 3: record a snapshot of the prior state
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 3: recordSnapshot(priorRubric) → priorSnapshot`);
  const priorSnapshot = recordSnapshot({
    rubricVersion: priorRubric.rubricVersion,
    documentManifest: manifestFromDocs(priorTender.docs),
    scoreResultId: "sprint3-prior-score-placeholder",
    applicant: DEMO_APPLICANT,
  });
  console.log(`    snapshotId: ${priorSnapshot.snapshotId}`);
  console.log(`    rubricVersion: ${priorSnapshot.rubricVersion}`);
  console.log(`    contextHash: ${priorSnapshot.contextHash.slice(0, 16)}…`);
  console.log(`    promptHash:  ${priorSnapshot.promptHash.slice(0, 16)}…`);
  console.log(`    documentManifest entries: ${priorSnapshot.documentManifest.length}`);
  console.log(`    supersededBy: ${priorSnapshot.supersededBy ?? "(not yet)"}`);

  // ─────────────────────────────────────────────────────────────────────
  // Step 4-5: load full manifest, compute new docs
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 4: load UNICEF with full manifest (base + Amendment 1)`);
  const fullTender = await loadTender(FIXTURE_DIR);
  console.log(`    full notice set loaded: ${fullTender.docs.length} docs, ${fullTender.qaEntries.length} QA entries`);

  const priorDocIds = new Set(priorTender.docs.map((d) => d.manifest.docId));
  const newDocs = fullTender.docs.filter((d) => !priorDocIds.has(d.manifest.docId));
  console.log(`\n>>> Step 5: newDocs = fullTender.docs ∖ priorTender.docs → ${newDocs.length} new docs from notice-146988`);
  for (const d of newDocs.slice(0, 6)) {
    console.log(`      • ${d.manifest.docId} (${d.manifest.role})${d.manifest.supersedes ? ` supersedes ${d.manifest.supersedes.join(", ")}` : ""}`);
  }
  if (newDocs.length > 6) console.log(`      … +${newDocs.length - 6} more`);

  // ─────────────────────────────────────────────────────────────────────
  // Step 6: reextractAndDiff
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 6: reextractAndDiff(priorRubric, priorDocs, newDocs) → nextRubric (v?) + deltas`);

  // Cache the post-amendment rubric to avoid a second LLM extraction on re-runs.
  // We can't use loadOrExtractRubric directly because the cache should be the
  // FULL reextract result (rubric + deltas), not just the rubric.
  const reextractCachePath = join(CACHE_DIR, "reextract-result.json");
  let reextractResult: Awaited<ReturnType<typeof reextractAndDiff>>;
  if (!noCache && existsSync(reextractCachePath)) {
    console.log(`    reextract result loaded from cache: ${reextractCachePath}`);
    reextractResult = JSON.parse(await readFile(reextractCachePath, "utf8")) as typeof reextractResult;
  } else {
    console.log(`    re-extracting against full doc set...`);
    const t0 = Date.now();
    reextractResult = await reextractAndDiff({
      priorRubric,
      priorDocs: priorTender.docs,
      newDocs,
    });
    console.log(`    reextract done in ${Date.now() - t0}ms`);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(reextractCachePath, JSON.stringify(reextractResult, null, 2));
  }
  const { rubric: nextRubric, changed, deltas } = reextractResult;

  summariseRubric("nextRubric ", nextRubric);
  console.log(`    changed: ${changed}`);
  console.log(`    deltas: ${deltas.length}`);
  for (const d of deltas.slice(0, 8)) console.log(`      • ${formatDelta(d)}`);
  if (deltas.length > 8) console.log(`      … +${deltas.length - 8} more`);

  // The amendment MUST have produced at least one delta (the whole point of
  // notice-146988 is Amendment 1 + revised Annex C). If we got zero, either
  // the extractor stamped the same shape or the diff is broken.
  if (!changed || deltas.length === 0) {
    console.error(`    ✗ expected non-empty diff between pre- and post-amendment rubrics`);
    allPassed = false;
  } else {
    console.log(`    ✓ amendment produced ${deltas.length} delta${deltas.length === 1 ? "" : "s"}`);
  }

  if (nextRubric.rubricVersion <= priorRubric.rubricVersion) {
    console.error(`    ✗ rubricVersion did not bump (prior=${priorRubric.rubricVersion}, next=${nextRubric.rubricVersion})`);
    allPassed = false;
  } else {
    console.log(`    ✓ rubricVersion bumped: v${priorRubric.rubricVersion} → v${nextRubric.rubricVersion}`);
  }

  const nextProblems = assertDisqualifiersSourced(nextRubric);
  if (nextProblems.length > 0) {
    console.error(`    ✗ A5 bolt-on: nextRubric disqualifier integrity issues:`);
    for (const p of nextProblems) console.error(`        • ${p}`);
    allPassed = false;
  } else {
    console.log(`    ✓ A5 bolt-on: every disqualifier in nextRubric has rule + SourceRef (survived re-extraction)`);
  }

  // Idempotence check: diffing nextRubric against itself returns zero deltas.
  const selfDeltas = diffRubrics(nextRubric, nextRubric);
  if (selfDeltas.length !== 0) {
    console.error(`    ✗ diffRubrics(x, x) returned ${selfDeltas.length} deltas — diff is not stable`);
    allPassed = false;
  } else {
    console.log(`    ✓ diffRubrics is idempotent (x vs x returns 0 deltas)`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 7: record snapshot of the new rubric
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 7: recordSnapshot(nextRubric) → newSnapshot`);
  const newSnapshot = recordSnapshot({
    rubricVersion: nextRubric.rubricVersion,
    documentManifest: manifestFromDocs(fullTender.docs),
    scoreResultId: "sprint3-new-score-placeholder",
    applicant: DEMO_APPLICANT,
  });
  console.log(`    snapshotId: ${newSnapshot.snapshotId}`);
  console.log(`    rubricVersion: ${newSnapshot.rubricVersion}`);
  console.log(`    contextHash: ${newSnapshot.contextHash.slice(0, 16)}…`);
  console.log(`    documentManifest entries: ${newSnapshot.documentManifest.length}`);

  if (newSnapshot.snapshotId === priorSnapshot.snapshotId) {
    console.error(`    ✗ snapshot ids collided — randomUUID broken`);
    allPassed = false;
  }
  if (newSnapshot.contextHash === priorSnapshot.contextHash) {
    console.error(`    ✗ contextHash did not change — the doc set was identical`);
    allPassed = false;
  } else {
    console.log(`    ✓ contextHash changed across runs (different doc set ⇒ different hash)`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 8: mark the prior snapshot as superseded (immutable update)
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 8: markSupersededBy(priorSnapshot, newSnapshot.snapshotId)`);
  const priorMarked = markSupersededBy(priorSnapshot, newSnapshot.snapshotId);

  // CRITICAL: the original priorSnapshot must be UNTOUCHED (immutability rule).
  if (priorSnapshot.supersededBy != null) {
    console.error(`    ✗ priorSnapshot was mutated — markSupersededBy must return a new object`);
    allPassed = false;
  } else {
    console.log(`    ✓ priorSnapshot is unchanged (still supersededBy=undefined)`);
  }
  if (priorMarked.supersededBy !== newSnapshot.snapshotId) {
    console.error(`    ✗ priorMarked.supersededBy not set correctly`);
    allPassed = false;
  } else {
    console.log(`    ✓ priorMarked.supersededBy = newSnapshot.snapshotId`);
  }
  if (priorMarked.rubricVersion !== priorSnapshot.rubricVersion) {
    console.error(`    ✗ priorMarked.rubricVersion drifted — immutability broken`);
    allPassed = false;
  } else {
    console.log(`    ✓ priorMarked.rubricVersion preserved (v${priorMarked.rubricVersion})`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 9: stale detection + generation_status implication
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n>>> Step 9: isSnapshotStale(priorSnapshot, nextRubric.rubricVersion)`);
  const isStale = isSnapshotStale(priorSnapshot, nextRubric.rubricVersion);
  if (!isStale) {
    console.error(`    ✗ priorSnapshot should be stale (v${priorSnapshot.rubricVersion} < v${nextRubric.rubricVersion})`);
    allPassed = false;
  } else {
    console.log(`    ✓ priorSnapshot is stale (v${priorSnapshot.rubricVersion} < v${nextRubric.rubricVersion})`);
    console.log(`    → in production: would write generation_status = 'rubric_stale' to`);
    console.log(`        every proposal_packages row whose latest snapshot is the prior one,`);
    console.log(`        per the wiring resolved at GATE 0.`);
  }

  // newSnapshot itself must NOT be stale.
  const newIsStale = isSnapshotStale(newSnapshot, nextRubric.rubricVersion);
  if (newIsStale) {
    console.error(`    ✗ newSnapshot is stale against its own rubric version`);
    allPassed = false;
  } else {
    console.log(`    ✓ newSnapshot is not stale against its own rubric version`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Write artifacts for review
  // ─────────────────────────────────────────────────────────────────────
  await writeFile(
    join(OUTPUT_DIR, "snapshot-trace.json"),
    JSON.stringify(
      {
        priorRubric: { rubricVersion: priorRubric.rubricVersion, lots: priorRubric.lots.length },
        nextRubric: { rubricVersion: nextRubric.rubricVersion, lots: nextRubric.lots.length },
        deltas,
        priorSnapshot,
        newSnapshot,
        priorMarked,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote snapshot trace: ${join(OUTPUT_DIR, "snapshot-trace.json")}`);

  console.log("\n" + "=".repeat(80));
  console.log(allPassed ? "Sprint 3 acceptance: PASS" : "Sprint 3 acceptance: FAIL");
  console.log("=".repeat(80));
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`[acceptance:unhandled] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
