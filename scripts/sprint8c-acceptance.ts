/**
 * scripts/sprint8c-acceptance.ts
 *
 * Sprint 8c acceptance — anonymous-wizard library carry-forward policy.
 *
 * Verifies the pure helper `buildLibraryContext` returns the right shape
 * for each of the four real-world states the route handler resolves to:
 *
 *   1. Email doesn't match a registered user
 *   2. Email matches but viewer is anonymous
 *   3. Email matches but viewer is signed in as a DIFFERENT user
 *   4. Email matches and viewer is signed in AS that user
 *
 * Plus an end-to-end assertion: when the helper discloses the library,
 * passing it through enrichApplicantContextFromLibrary + scoreReadiness
 * yields a strictly higher readiness score than the wizard data alone.
 *
 * No DB. No network. The route handler's I/O is verified by manual /
 * preview-deploy testing — this script covers the privacy-policy logic
 * that decides whether to disclose the library to a given viewer.
 *
 * Usage:
 *   npx tsx scripts/sprint8c-acceptance.ts
 */

import { buildLibraryContext } from "@/lib/proposal-package/library-context";
import { enrichApplicantContextFromLibrary } from "@/lib/proposal-package/library-enrichment";
import { scoreReadiness } from "@/lib/proposal-package/readiness-engine";
import type { ApplicantContext } from "@/lib/proposal-package/applicant-context";
import type { EvidenceLibraryRow } from "@/lib/applicant-evidence/types";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

function makeRow(args: { id: number; userId: number; fileName: string; type: string; tags?: string[] }): EvidenceLibraryRow {
  return {
    vault_document_id: args.id,
    user_id: args.userId,
    file_name: args.fileName,
    type: args.type,
    tags: args.tags ?? [],
    file_url: `https://blob/${args.id}`,
    text_content: null,
    char_count: 0,
    extraction_status: "extracted",
    created_at: new Date().toISOString(),
    structured_extraction: null,
  };
}

const EMPTY_APPLICANT: ApplicantContext = {
  companyName: "Acme Vendor",
  countryOfRegistration: "Kenya",
  yearsOfExperience: 0,
  sectorsCovered: [],
  keyPersonnel: [],
  pastPerformance: [],
  certifications: [],
  geographicReach: ["Kenya"],
};

async function main(): Promise<void> {
  console.log("\n=== Sprint 8c acceptance — anonymous-wizard library carry-forward ===\n");

  // --------------------------------------------------------------------
  // Test 1: no email match → empty context, no banner, no enrichment
  // --------------------------------------------------------------------
  console.log("  test 1: no email match → empty context");
  {
    const result = buildLibraryContext({ emailUserId: null, sessionUserId: null, libraryDocs: [] });
    if (result.doc_count !== 0) fail(`expected doc_count=0, got ${result.doc_count}`);
    else if (result.signed_in_match !== false) fail(`expected signed_in_match=false`);
    else if (result.library !== undefined) fail(`expected no library payload`);
    else pass(`empty context returned for unmatched email`);
  }

  // --------------------------------------------------------------------
  // Test 2: email matches but viewer is anonymous → count only, no library
  // --------------------------------------------------------------------
  console.log("\n  test 2: email matches, anonymous viewer → count only");
  {
    const library: EvidenceLibraryRow[] = [
      makeRow({ id: 1, userId: 42, fileName: "asha-cv.pdf", type: "cv" }),
      makeRow({ id: 2, userId: 42, fileName: "iso9001.pdf", type: "certificate" }),
      makeRow({ id: 3, userId: 42, fileName: "wfp-pp.pdf", type: "past_performance" }),
    ];
    const result = buildLibraryContext({ emailUserId: 42, sessionUserId: null, libraryDocs: library });
    if (result.doc_count !== 3) fail(`expected doc_count=3, got ${result.doc_count}`);
    else if (result.signed_in_match !== false) fail(`expected signed_in_match=false (anonymous viewer)`);
    else if (result.library !== undefined) fail(`expected NO library payload disclosed to anonymous viewer`);
    else pass(`count disclosed, library withheld`);
  }

  // --------------------------------------------------------------------
  // Test 3: email matches but viewer is signed in as different user
  //         → count only, no library (impersonation guard)
  // --------------------------------------------------------------------
  console.log("\n  test 3: email matches, viewer signed in as different user → count only");
  {
    const library: EvidenceLibraryRow[] = [
      makeRow({ id: 4, userId: 42, fileName: "secret-cv.pdf", type: "cv" }),
    ];
    const result = buildLibraryContext({ emailUserId: 42, sessionUserId: 99, libraryDocs: library });
    if (result.doc_count !== 1) fail(`expected doc_count=1, got ${result.doc_count}`);
    else if (result.signed_in_match !== false) fail(`expected signed_in_match=false (different session user)`);
    else if (result.library !== undefined) fail(`SECURITY: library should NOT be disclosed across user identities`);
    else pass(`library withheld from cross-user session — impersonation guard intact`);
  }

  // --------------------------------------------------------------------
  // Test 4: email matches and viewer is signed in AS that user
  //         → library disclosed, client can enrich
  // --------------------------------------------------------------------
  console.log("\n  test 4: email matches, viewer signed in as that user → library disclosed");
  {
    const library: EvidenceLibraryRow[] = [
      makeRow({ id: 5, userId: 42, fileName: "asha-cv.pdf", type: "cv" }),
      makeRow({ id: 6, userId: 42, fileName: "iso9001.pdf", type: "certificate" }),
    ];
    const result = buildLibraryContext({ emailUserId: 42, sessionUserId: 42, libraryDocs: library });
    if (result.doc_count !== 2) fail(`expected doc_count=2, got ${result.doc_count}`);
    else if (result.signed_in_match !== true) fail(`expected signed_in_match=true`);
    else if (!result.library || result.library.length !== 2) fail(`expected library payload of 2 rows`);
    else pass(`library disclosed to authenticated owner (2 rows)`);
  }

  // --------------------------------------------------------------------
  // Test 5: end-to-end — disclosed library lifts readiness score
  // --------------------------------------------------------------------
  console.log("\n  test 5: disclosed library lifts readiness via enrichment");
  {
    const library: EvidenceLibraryRow[] = [
      makeRow({ id: 10, userId: 42, fileName: "Asha-Mwangi-CV.pdf", type: "cv" }),
      makeRow({ id: 11, userId: 42, fileName: "Kofi-Annan-Boateng-CV.pdf", type: "cv" }),
      makeRow({ id: 12, userId: 42, fileName: "Fatima-Diallo-CV.pdf", type: "cv" }),
      makeRow({ id: 13, userId: 42, fileName: "ISO-9001-cert.pdf", type: "certificate", tags: ["iso-9001"] }),
      makeRow({ id: 14, userId: 42, fileName: "UNGM-Vendor-Profile.pdf", type: "registration", tags: ["ungm"] }),
      makeRow({ id: 15, userId: 42, fileName: "WFP-Past-Performance-2023.pdf", type: "past_performance", tags: ["wfp"] }),
    ];

    // Unauthed branch — library is withheld, base applicant used.
    const unauthed = buildLibraryContext({ emailUserId: 42, sessionUserId: null, libraryDocs: library });
    const baseApplicant = EMPTY_APPLICANT;
    const baseReadiness = scoreReadiness(baseApplicant);

    // Authed branch — library disclosed, enrichment runs.
    const authed = buildLibraryContext({ emailUserId: 42, sessionUserId: 42, libraryDocs: library });
    const enrichedApplicant = authed.library
      ? enrichApplicantContextFromLibrary(baseApplicant, authed.library)
      : baseApplicant;
    const enrichedReadiness = scoreReadiness(enrichedApplicant);

    console.log(`        unauthed (no library)   → score=${baseReadiness.summary.overallScore}`);
    console.log(`        authed   (library used) → score=${enrichedReadiness.summary.overallScore}`);

    if (unauthed.library !== undefined) {
      fail(`unauthed branch should withhold library payload`);
    } else {
      pass(`unauthed branch: library withheld → readiness uses base applicant only`);
    }
    if (enrichedReadiness.summary.overallScore <= baseReadiness.summary.overallScore) {
      fail(`authed branch should lift score; base=${baseReadiness.summary.overallScore} enriched=${enrichedReadiness.summary.overallScore}`);
    } else {
      pass(`authed branch: enrichment lifts score (${baseReadiness.summary.overallScore} → ${enrichedReadiness.summary.overallScore})`);
    }
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Sprint 8c policy holds: library disclosed only to authenticated owner; banner shown otherwise\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
