/**
 * scripts/profile-miner-acceptance.ts
 *
 * Sprint 8e — free-text intake mining acceptance.
 *
 * Verifies the pure helpers in profile-miner.ts + legacy-bridge.overlayMinedFacts
 * across their real decision branches. No DB, no LLM — the live wiring is
 * exercised by manual + preview-deploy testing.
 *
 *   extractIntakeNarrativeText:
 *     - Keeps long string narratives keyed under non-skip names.
 *     - Strips URLs / IDs / filenames / structured sub-objects.
 *     - Filters strings under the MIN_TEXT_CHARS floor.
 *     - Honours the 6KB TEXT_BUDGET cap.
 *
 *   buildMinerPrompt:
 *     - Always asks for the same 5 fields by name.
 *     - Embeds the narrative verbatim.
 *     - States the JSON-only output rule.
 *
 *   sanitizeMinedFacts:
 *     - Drops non-numeric years.
 *     - Drops non-array fields.
 *     - Filters non-string array members + empty strings.
 *     - Dedupes, caps each array to its policy max.
 *
 *   mergeMinedFacts (pure):
 *     - years takes the MAX of prior and fresh.
 *     - arrays union + dedupe.
 *     - missing fresh fields don't wipe prior values.
 *
 *   overlayMinedFacts (legacy-bridge):
 *     - Fills empty ApplicantContext fields ONLY.
 *     - Never overwrites assessment-derived data.
 *     - Synthesises a capability narrative from mined facts when base lacks one.
 *
 * Usage:
 *   npx tsx scripts/profile-miner-acceptance.ts
 */

import {
  extractIntakeNarrativeText,
  buildMinerPrompt,
  sanitizeMinedFacts,
  mergeMinedFacts,
  MIN_TEXT_CHARS,
  type MinedProfileFacts,
} from "@/lib/applicant-evidence/profile-miner";
import { overlayMinedFacts } from "@/lib/proposal-package/legacy-bridge";
import type { ApplicantContext } from "@/lib/proposal-package/applicant-context";

let failures = 0;
function fail(msg: string): void {
  console.error(`    ✗ ${msg}`);
  failures += 1;
}
function pass(msg: string): void {
  console.log(`    ✓ ${msg}`);
}

async function main(): Promise<void> {
  console.log("\n=== Sprint 8e — profile miner pure-function acceptance ===");
  console.log(`  MIN_TEXT_CHARS=${MIN_TEXT_CHARS}\n`);

  // ----------------------------------------------------------------------
  // extractIntakeNarrativeText
  // ----------------------------------------------------------------------
  console.log("  test 1: extractIntakeNarrativeText keeps narratives, strips structural keys");
  {
    const intake = {
      vendor_brief: "We have 11 years of biomedical engineering experience across East Africa, delivering oxygen plants for WFP, UNDP, and UNICEF country offices.",
      capability_summary: "Our team operates from Nairobi with field engineers in Kampala, Dar es Salaam, and Kigali. We hold ISO 13485 and BS EN 10242.",
      vault_url: "https://example.com/file.pdf?token=secret-token-very-long-string-here-to-trigger-min-chars",
      vault_filename: "company-profile-2026-final-rev3-very-long-filename-that-exceeds-50-chars.pdf",
      vault_doc_id: "doc-uuid-abc-def-0123-4567-8901-2345-very-long-id-string-here",
      financial_documents_url: "https://example.com/financials.pdf?signed=very-long-token-string-here",
      service_context: "structured-object-placeholder-do-not-use-this-key-very-long-string-here",
      tender_file_name: "tender.pdf",
      uploaded_at: "2026-05-25T12:00:00Z",
      file_size: "1024",
      generation_status: "ready",
      short_field: "hi",
      structured_obj: { foo: "bar" }, // non-string — must be filtered
      num_field: 42, // non-string — must be filtered
    };
    const out = extractIntakeNarrativeText(intake as unknown as Record<string, unknown>);
    if (!out.includes("11 years")) fail(`expected narrative included, got: ${out.slice(0, 100)}...`);
    else if (!out.includes("ISO 13485")) fail(`expected second narrative included`);
    else if (out.includes("https://")) fail(`URLs should be filtered, got: ${out}`);
    else if (out.includes("company-profile")) fail(`filenames should be filtered`);
    else if (out.includes("doc-uuid")) fail(`IDs should be filtered`);
    else if (out.includes("hi\n")) fail(`short fields should be filtered`);
    else if (out.includes("foo")) fail(`structured sub-objects should be filtered`);
    else pass(`narrative kept, URLs/IDs/filenames/short-strings/objects stripped`);
  }

  console.log("\n  test 2: extractIntakeNarrativeText returns empty for empty / short input");
  {
    const empty = extractIntakeNarrativeText({});
    const nullish = extractIntakeNarrativeText(null);
    const undef = extractIntakeNarrativeText(undefined);
    const tooShort = extractIntakeNarrativeText({ tender_context: "hello world" });
    if (empty !== "") fail(`expected "" for empty intake, got: ${empty}`);
    else if (nullish !== "") fail(`expected "" for null intake`);
    else if (undef !== "") fail(`expected "" for undefined intake`);
    else if (tooShort !== "") fail(`expected "" when no field meets MIN_TEXT_CHARS, got: ${tooShort}`);
    else pass(`empty / nullish / short inputs all return ""`);
  }

  console.log("\n  test 3: extractIntakeNarrativeText honours TEXT_BUDGET");
  {
    const huge = "lorem ipsum dolor sit amet ".repeat(500); // ~13.5KB
    const intake = { vendor_brief: huge };
    const out = extractIntakeNarrativeText(intake as Record<string, unknown>);
    if (out.length > 6_000) fail(`expected ≤6000 chars, got ${out.length}`);
    else if (!out.startsWith("vendor_brief:")) fail(`expected key prefix preserved`);
    else pass(`huge input clipped to ${out.length} chars (≤6000)`);
  }

  // ----------------------------------------------------------------------
  // buildMinerPrompt
  // ----------------------------------------------------------------------
  console.log("\n  test 4: buildMinerPrompt names every output field + embeds narrative");
  {
    const text = "vendor_brief: 8 years building water infrastructure in Mali and Niger.";
    const prompt = buildMinerPrompt(text);
    const fields = [
      "years_of_experience",
      "sectors_covered",
      "agencies_worked_with",
      "geographic_reach",
      "key_capabilities",
    ];
    const missing = fields.filter((f) => !prompt.includes(f));
    if (missing.length > 0) fail(`prompt missing fields: ${missing.join(", ")}`);
    else if (!prompt.includes(text)) fail(`narrative text not embedded`);
    else if (!prompt.includes("Output ONLY the JSON")) fail(`JSON-only rule absent`);
    else pass(`prompt names all 5 fields, embeds narrative, enforces JSON-only`);
  }

  // ----------------------------------------------------------------------
  // sanitizeMinedFacts
  // ----------------------------------------------------------------------
  console.log("\n  test 5: sanitizeMinedFacts drops invalid values, dedupes, caps");
  {
    const raw = {
      years_of_experience: 11.7, // → 11
      sectors_covered: ["biomedical engineering", "biomedical engineering", "  ", "water"], // dedupes, drops empty
      agencies_worked_with: [
        "WFP", "UNDP", "UNICEF", "WHO", "UNHCR",
        "UNOPS", "IOM", "FAO", "EuropeAid", "DFID",
        "SDC", "JICA", // 12 total → capped at 10
      ],
      geographic_reach: ["Kenya", 123, null, "Tanzania"], // filters non-strings
      key_capabilities: "not an array", // wrong type — must be omitted
    };
    const out = sanitizeMinedFacts(raw);
    if (out.years_of_experience !== 11) fail(`expected years=11, got ${out.years_of_experience}`);
    else if (!out.sectors_covered || out.sectors_covered.length !== 2) fail(`expected 2 sectors, got ${JSON.stringify(out.sectors_covered)}`);
    else if (!out.agencies_worked_with || out.agencies_worked_with.length !== 10) fail(`expected 10 agencies (capped), got ${out.agencies_worked_with?.length}`);
    else if (!out.geographic_reach || out.geographic_reach.length !== 2) fail(`expected 2 geos, got ${JSON.stringify(out.geographic_reach)}`);
    else if (out.key_capabilities !== undefined) fail(`expected key_capabilities omitted for non-array, got ${JSON.stringify(out.key_capabilities)}`);
    else pass(`years floored, arrays cleaned + capped, wrong types omitted`);
  }

  console.log("\n  test 6: sanitizeMinedFacts handles null / non-object inputs");
  {
    const cases: unknown[] = [null, undefined, "string", 42, [], true];
    for (const c of cases) {
      const out = sanitizeMinedFacts(c);
      if (Object.keys(out).length !== 0) {
        fail(`expected {} for ${JSON.stringify(c)}, got ${JSON.stringify(out)}`);
        return;
      }
    }
    pass(`all garbage inputs → {}`);
  }

  // ----------------------------------------------------------------------
  // mergeMinedFacts
  // ----------------------------------------------------------------------
  console.log("\n  test 7: mergeMinedFacts — years takes max, arrays union, missing fresh ≠ wipe");
  {
    const prior: MinedProfileFacts = {
      years_of_experience: 11,
      sectors_covered: ["biomedical", "water"],
      agencies_worked_with: ["WFP", "UNDP"],
      geographic_reach: ["Kenya"],
      key_capabilities: ["oxygen plant maintenance"],
    };
    const fresh: MinedProfileFacts = {
      years_of_experience: 8, // smaller — prior wins
      sectors_covered: ["water", "logistics"], // union with prior
      // agencies omitted entirely — prior must persist
      geographic_reach: ["Uganda", "Tanzania"],
      // key_capabilities omitted
    };
    const out = mergeMinedFacts(prior, fresh);
    if (out.years_of_experience !== 11) fail(`expected years=11 (max), got ${out.years_of_experience}`);
    else if (!out.sectors_covered || out.sectors_covered.length !== 3) fail(`expected union of 3 sectors, got ${JSON.stringify(out.sectors_covered)}`);
    else if (!out.agencies_worked_with || out.agencies_worked_with.length !== 2) fail(`omitted-fresh-field should preserve prior, got ${JSON.stringify(out.agencies_worked_with)}`);
    else if (!out.geographic_reach || out.geographic_reach.length !== 3) fail(`expected 3 unioned geos`);
    else if (!out.key_capabilities || out.key_capabilities.length !== 1) fail(`expected prior key_capabilities preserved`);
    else pass(`max wins for years, arrays union, omitted fresh fields preserve prior`);
  }

  console.log("\n  test 8: mergeMinedFacts — fresh > prior years, empty prior arrays");
  {
    const prior: MinedProfileFacts = { years_of_experience: 5 };
    const fresh: MinedProfileFacts = {
      years_of_experience: 12,
      sectors_covered: ["medical equipment"],
      agencies_worked_with: ["WHO"],
    };
    const out = mergeMinedFacts(prior, fresh);
    if (out.years_of_experience !== 12) fail(`expected years=12 (fresh > prior), got ${out.years_of_experience}`);
    else if (out.sectors_covered?.[0] !== "medical equipment") fail(`fresh array should land`);
    else pass(`fresh > prior → fresh wins; empty prior arrays accept fresh`);
  }

  // ----------------------------------------------------------------------
  // overlayMinedFacts (legacy-bridge)
  // ----------------------------------------------------------------------
  console.log("\n  test 9: overlayMinedFacts — fills empty fields ONLY (gap-fill policy)");
  {
    const base: ApplicantContext = {
      companyName: "Atlas Engineering",
      countryOfRegistration: "Kenya",
      yearsOfExperience: 0, // empty — should be filled
      sectorsCovered: [], // empty — should be filled
      keyPersonnel: [],
      pastPerformance: [],
      certifications: ["ISO 9001"],
      geographicReach: [], // empty — should be filled
      capabilityNarrative: undefined, // missing — should be synthesised
    };
    const mined: MinedProfileFacts = {
      years_of_experience: 11,
      sectors_covered: ["biomedical"],
      key_capabilities: ["oxygen plant maintenance"],
      agencies_worked_with: ["WFP", "UNDP"],
      geographic_reach: ["East Africa"],
    };
    const out = overlayMinedFacts(base, mined);
    if (out.yearsOfExperience !== 11) fail(`expected years filled to 11, got ${out.yearsOfExperience}`);
    else if (out.sectorsCovered.length !== 2) fail(`expected sectors+capabilities unioned, got ${JSON.stringify(out.sectorsCovered)}`);
    else if (!out.sectorsCovered.includes("biomedical") || !out.sectorsCovered.includes("oxygen plant maintenance")) fail(`expected both mined sources merged`);
    else if (out.geographicReach.length !== 1 || out.geographicReach[0] !== "East Africa") fail(`expected geographicReach filled`);
    else if (!out.capabilityNarrative || !out.capabilityNarrative.includes("WFP")) fail(`expected synthesised narrative including agencies`);
    else if (!out.capabilityNarrative.includes("intake claims, not verified")) fail(`expected provenance disclaimer in synthesised narrative`);
    else if (out.companyName !== "Atlas Engineering") fail(`companyName should not be touched`);
    else if (out.certifications.length !== 1) fail(`existing certifications should not be touched`);
    else pass(`empty fields filled (years/sectors/geo/narrative), populated fields preserved`);
  }

  console.log("\n  test 10: overlayMinedFacts — populated base fields are NEVER overwritten");
  {
    const base: ApplicantContext = {
      companyName: "Atlas Engineering",
      countryOfRegistration: "Kenya",
      yearsOfExperience: 14, // populated — must persist
      sectorsCovered: ["biomedical engineering", "water"], // populated
      keyPersonnel: [],
      pastPerformance: [],
      certifications: [],
      geographicReach: ["Kenya", "Uganda"], // populated
      capabilityNarrative: "Atlas delivers biomedical and water-infrastructure services across East Africa.", // populated
    };
    const mined: MinedProfileFacts = {
      years_of_experience: 5, // would overwrite — must NOT
      sectors_covered: ["logistics", "ICT"], // would overwrite — must NOT
      geographic_reach: ["West Africa"], // would overwrite — must NOT
    };
    const out = overlayMinedFacts(base, mined);
    if (out.yearsOfExperience !== 14) fail(`populated years overwritten: ${out.yearsOfExperience}`);
    else if (out.sectorsCovered.includes("logistics")) fail(`populated sectors overwritten`);
    else if (out.geographicReach.includes("West Africa")) fail(`populated geographicReach overwritten`);
    else if (!out.capabilityNarrative?.startsWith("Atlas delivers")) fail(`populated narrative overwritten`);
    else pass(`populated fields persist; mined facts ignored when base has data`);
  }

  console.log("\n  test 11: overlayMinedFacts — no mined facts is a no-op");
  {
    const base: ApplicantContext = {
      companyName: "X",
      countryOfRegistration: "Y",
      yearsOfExperience: 0,
      sectorsCovered: [],
      keyPersonnel: [],
      pastPerformance: [],
      certifications: [],
      geographicReach: [],
    };
    const out = overlayMinedFacts(base, {});
    if (out.yearsOfExperience !== 0) fail(`empty mined should not fill anything`);
    else if (out.capabilityNarrative !== undefined) fail(`empty mined should not synthesise narrative`);
    else pass(`empty MinedProfileFacts ⇒ no overlay`);
  }

  console.log("\n=== Summary ===");
  if (failures > 0) {
    console.error(`✗ ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ Profile-miner pure-function suite holds across all decision branches\n");
}

main().catch((err) => {
  console.error("✗ unhandled error:", err);
  process.exit(1);
});
