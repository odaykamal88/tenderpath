/**
 * scripts/sprint8-acceptance.ts
 *
 * Sprint 8 acceptance — evidence carry-forward enrichment.
 *
 * Verifies that enrichApplicantContextFromLibrary lifts a vendor's claim
 * provenance from `gap` to `applicant_library` when matching files exist.
 * This is the conversion-relevant signal the Sprint 7 readiness page
 * surfaces — gap routing flips and the SKU pitch changes accordingly.
 *
 * No DB / LLM calls. Synthetic EvidenceLibraryRow[] inputs + the readiness
 * engine's scoreReadiness pure function.
 *
 * Usage:
 *   npx tsx scripts/sprint8-acceptance.ts
 */

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

function makeLibraryRow(args: {
  id: number;
  fileName: string;
  type: string;
  tags?: string[];
}): EvidenceLibraryRow {
  return {
    vault_document_id: args.id,
    user_id: 1,
    file_name: args.fileName,
    type: args.type,
    tags: args.tags ?? [],
    file_url: `https://blob/${args.id}`,
    text_content: null,
    char_count: 0,
    extraction_status: "extracted",
    created_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 8 acceptance — library enrichment ===\n");

  // --------------------------------------------------------------------
  // Test 1: empty library → no change
  // --------------------------------------------------------------------
  console.log("  test 1: empty library is a no-op");
  {
    const enriched = enrichApplicantContextFromLibrary(EMPTY_APPLICANT, []);
    if (enriched !== EMPTY_APPLICANT) fail("expected pass-through ref equality for empty library");
    else pass("returns the same ApplicantContext reference");
  }

  // --------------------------------------------------------------------
  // Test 2: certificates lift `certifications` from [] → entries
  // --------------------------------------------------------------------
  console.log("\n  test 2: certificate rows populate certifications[]");
  {
    const library: EvidenceLibraryRow[] = [
      makeLibraryRow({ id: 1, fileName: "ISO-9001-cert.pdf", type: "certificate", tags: ["iso-9001"] }),
      makeLibraryRow({ id: 2, fileName: "ISO-13485-2024.pdf", type: "certificate", tags: ["iso-13485"] }),
    ];
    const enriched = enrichApplicantContextFromLibrary(EMPTY_APPLICANT, library);
    if (enriched.certifications.length !== 2) {
      fail(`expected 2 certifications, got ${enriched.certifications.length}`);
    } else {
      pass(`certifications populated: ${JSON.stringify(enriched.certifications)}`);
    }
  }

  // --------------------------------------------------------------------
  // Test 3: CV rows lift keyPersonnel from [] → entries
  // --------------------------------------------------------------------
  console.log("\n  test 3: cv rows populate keyPersonnel[]");
  {
    const library: EvidenceLibraryRow[] = [
      makeLibraryRow({ id: 3, fileName: "Asha-Mwangi-CV.pdf", type: "cv" }),
      makeLibraryRow({ id: 4, fileName: "Kofi-Annan-Boateng-CV.pdf", type: "cv" }),
      makeLibraryRow({ id: 5, fileName: "Fatima-Diallo-CV-2024.pdf", type: "cv" }),
    ];
    const enriched = enrichApplicantContextFromLibrary(EMPTY_APPLICANT, library);
    if (enriched.keyPersonnel.length !== 3) {
      fail(`expected 3 keyPersonnel, got ${enriched.keyPersonnel.length}`);
    } else {
      pass(`keyPersonnel populated: ${enriched.keyPersonnel.map((p) => p.name).join(", ")}`);
    }
  }

  // --------------------------------------------------------------------
  // Test 4: registration doc flips meetsUnSupplierBaseline
  // --------------------------------------------------------------------
  console.log("\n  test 4: registration doc flips meetsUnSupplierBaseline");
  {
    const library: EvidenceLibraryRow[] = [
      makeLibraryRow({ id: 6, fileName: "UNGM-Vendor-Profile.pdf", type: "registration", tags: ["ungm"] }),
    ];
    const enriched = enrichApplicantContextFromLibrary(EMPTY_APPLICANT, library);
    if (enriched.meetsUnSupplierBaseline !== true) {
      fail(`expected meetsUnSupplierBaseline=true, got ${enriched.meetsUnSupplierBaseline}`);
    } else {
      pass("meetsUnSupplierBaseline flipped to true");
    }
  }

  // --------------------------------------------------------------------
  // Test 5: existing fields are NOT overwritten
  // --------------------------------------------------------------------
  console.log("\n  test 5: existing structured data is never overwritten");
  {
    const withPersonnel: ApplicantContext = {
      ...EMPTY_APPLICANT,
      keyPersonnel: [
        { name: "Dr. Asha Mwangi", role: "Lead Biomedical Engineer", yearsExperience: 14 },
      ],
    };
    const library: EvidenceLibraryRow[] = [
      makeLibraryRow({ id: 7, fileName: "Some-Other-Person-CV.pdf", type: "cv" }),
    ];
    const enriched = enrichApplicantContextFromLibrary(withPersonnel, library);
    if (enriched.keyPersonnel.length !== 1) {
      fail(`expected 1 keyPersonnel (no overwrite), got ${enriched.keyPersonnel.length}`);
    } else if (enriched.keyPersonnel[0].name !== "Dr. Asha Mwangi") {
      fail(`expected Dr. Asha Mwangi preserved, got ${enriched.keyPersonnel[0].name}`);
    } else {
      pass("existing keyPersonnel preserved against library overwrite");
    }
  }

  // --------------------------------------------------------------------
  // Test 6: enrichment flips readiness engine gap → applicant_library
  //         provenance for the cert + personnel claims
  // --------------------------------------------------------------------
  console.log("\n  test 6: enrichment flips readiness claims gap → applicant_library");
  {
    // Score the empty applicant first to capture baseline gap provenance
    const baseReadiness = scoreReadiness(EMPTY_APPLICANT);
    const baseGapClaims = baseReadiness.score.lotResults
      .flatMap((lr) => lr.perCriterion.flatMap((c) => c.claimsByProvenance?.gap ?? 0))
      .reduce((s, n) => s + n, 0);
    const baseLibClaims = baseReadiness.score.lotResults
      .flatMap((lr) => lr.perCriterion.flatMap((c) => c.claimsByProvenance?.applicant_library ?? 0))
      .reduce((s, n) => s + n, 0);

    // Provide rich library — should flip a meaningful number of gap claims
    const library: EvidenceLibraryRow[] = [
      makeLibraryRow({ id: 10, fileName: "ISO-9001-cert.pdf", type: "certificate", tags: ["iso-9001"] }),
      makeLibraryRow({ id: 11, fileName: "ISO-13485-2024.pdf", type: "certificate", tags: ["iso-13485"] }),
      makeLibraryRow({ id: 12, fileName: "Asha-Mwangi-CV.pdf", type: "cv" }),
      makeLibraryRow({ id: 13, fileName: "Kofi-Annan-Boateng-CV.pdf", type: "cv" }),
      makeLibraryRow({ id: 14, fileName: "Fatima-Diallo-CV-2024.pdf", type: "cv" }),
      makeLibraryRow({ id: 15, fileName: "UNGM-Vendor-Profile.pdf", type: "registration", tags: ["ungm"] }),
      makeLibraryRow({ id: 16, fileName: "WFP-Past-Performance-2023.pdf", type: "past_performance", tags: ["wfp"] }),
      makeLibraryRow({ id: 17, fileName: "UNDP-Reference-2022.pdf", type: "past_performance", tags: ["undp"] }),
    ];

    const enriched = enrichApplicantContextFromLibrary(EMPTY_APPLICANT, library);
    const enrichedReadiness = scoreReadiness(enriched);
    const enrichedGapClaims = enrichedReadiness.score.lotResults
      .flatMap((lr) => lr.perCriterion.flatMap((c) => c.claimsByProvenance?.gap ?? 0))
      .reduce((s, n) => s + n, 0);
    const enrichedLibClaims = enrichedReadiness.score.lotResults
      .flatMap((lr) => lr.perCriterion.flatMap((c) => c.claimsByProvenance?.applicant_library ?? 0))
      .reduce((s, n) => s + n, 0);

    console.log(`        baseline:   gap=${baseGapClaims}  lib=${baseLibClaims}  score=${baseReadiness.summary.overallScore}`);
    console.log(`        enriched:   gap=${enrichedGapClaims}  lib=${enrichedLibClaims}  score=${enrichedReadiness.summary.overallScore}`);

    if (enrichedLibClaims <= baseLibClaims) {
      fail(`expected applicant_library claims to increase; baseline=${baseLibClaims} enriched=${enrichedLibClaims}`);
    } else {
      pass(`applicant_library claims lifted from ${baseLibClaims} to ${enrichedLibClaims}`);
    }
    if (enrichedGapClaims >= baseGapClaims) {
      fail(`expected gap claims to decrease; baseline=${baseGapClaims} enriched=${enrichedGapClaims}`);
    } else {
      pass(`gap claims reduced from ${baseGapClaims} to ${enrichedGapClaims}`);
    }
    if (enrichedReadiness.summary.overallScore <= baseReadiness.summary.overallScore) {
      fail(`expected score to lift; baseline=${baseReadiness.summary.overallScore} enriched=${enrichedReadiness.summary.overallScore}`);
    } else {
      pass(`readiness score lifted from ${baseReadiness.summary.overallScore} to ${enrichedReadiness.summary.overallScore}`);
    }
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Sprint 8 enrichment lifts gap claims to applicant_library and raises the readiness score\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
