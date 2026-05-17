/**
 * Sprint 14 live-prompt validation: runs the Roster Fast-Track pipeline
 * end-to-end against MEFOSA (VP-07 panel anchor — food-safety advisory,
 * Lebanon-based), with the new agency_readiness_breakdown + grader wired,
 * then grades the output to verify per-agency scoring lifts roster quality
 * over the static-harness 8.2 floor.
 *
 * MEFOSA was picked because it's the most informative case:
 *  - WFP/FAO are both plausible (food + humanitarian context),
 *  - UNICEF is plausible but a different fit (procurement vs advisory),
 *  - WHO/UNOPS are likely "blocked" (wrong category for an advisory shop),
 *  - UNGM is always-applicable.
 * A good breakdown should differentiate all of these meaningfully.
 *
 * Usage: npx tsx scripts/_sprint14-roster-live.ts
 */
import * as fs from "node:fs";
import { extractTenderRequirements, generateRosterPackage } from "../src/lib/proposal-package/llm";
import { gradeRosterOutput } from "../src/lib/proposal-package/grade";
import { AGENCY_PACKAGES, formatAgencyCatalogueForPrompt, findAgencyPackage } from "../src/lib/proposal-package/roster-packages";
import { autoTag } from "../src/lib/applicant-evidence/auto-tag";
import { formatEvidenceLibraryForPrompt } from "../src/lib/applicant-evidence/query";
import type { EvidenceLibraryRow } from "../src/lib/applicant-evidence/types";

function loadEnv(envPath: string) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trim().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k]) continue;
    process.env[k] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv("/Users/odaykamal/Desktop/TENDERPATH/.env.local");

// Sprint 14 deliberately runs roster generation WITHOUT a real tender —
// the user case is "register me on WFP so I can win their next call",
// not "produce a roster for this specific tender". We pass a thin
// roster-context tender to mirror what the production path does for
// roster work orders (no tender_url, no pipeline_item).
const tenderText = `Vendor wishes to register on the World Food Programme (WFP) supplier roster for food-safety advisory and HACCP/ISO 22000 certification services.
Geographic focus: MENA + Levant.
Reason for WFP first: WFP procures food-safety and HACCP advisory services through its country offices in Lebanon, Jordan, Iraq, Syria — all MEFOSA's existing footprint.
Secondary plausible agencies: FAO (food safety advisory + commodity testing), UNICEF (nutrition + cold-chain QA), UNGM (general).`;

const companyContext = `Company: MEFOSA-MENA Food Safety Associates S.A.R.L
Country of registration: Lebanon (Beirut HQ + Tripoli lab partner)
Type: Lebanese food-safety advisory and lab-testing services firm
Founded: 2014; Headcount ~14 (4 senior consultants + 6 auditors + 4 admin/lab support)
Capabilities: HACCP design + implementation, ISO 22000 certification advisory, Codex Alimentarius alignment for food exporters, lab testing (microbiological + chemical), food-safety training (Arabic + English), regulatory liaison with Lebanese Ministry of Agriculture, training-of-trainers for food-handler programmes
Operational footprint: Lebanon (full), Jordan (3 active clients), Iraq (recent engagement), Syria (pre-2020 work, dormant)
Past donors / clients: USAID Lebanon CSP (food-safety advisory for SMEs, 2020-2023), UNDP Lebanon (training-of-trainers, 2022), local F&B exporters
Past performance: 6 sub-million-USD advisory engagements, no audit qualifications; ISO 17025 lab partner accreditation
Audit: Local Big Four affiliate, clean audit 2024
Languages: Arabic, English, French
Registration status: UNGM Level 1 (UNGM ID 454934); not registered on WFP/FAO/UNICEF supplier portals yet
Equipment / facilities: Lab access via Tripoli partner; no warehousing, no fleet, no food commodity supply capacity`;

const intakeSummary = `Applicant: MEFOSA. Initial target: WFP roster (food-safety advisory).
Open to: FAO (food safety advisory), UNICEF (nutrition QA), UNGM (general).
Out of scope: WHO PQS (device certification — not a manufacturer), UNOPS infrastructure (not a builder), IOM migration (not a sector fit).
Goal: register on the 1-2 highest-leverage agencies in the next 60-90 days without burning effort on bad-fit rosters.`;

const libraryRaw: Omit<EvidenceLibraryRow, "tags" | "type">[] = [
  { vault_document_id: 201, user_id: 888, file_name: "MEFOSA Commercial Registration Lebanon 2014.pdf", file_url: "synthetic://201",
    text_content: "Commercial Registration certificate for MEFOSA-MENA Food Safety Associates S.A.R.L issued by the Beirut Commercial Registry. Active status, fiscal year aligned to calendar year, sole-shareholder S.A.R.L structure.",
    char_count: 2200, extraction_status: "extracted", created_at: "2026-04-10T00:00:00Z" },
  { vault_document_id: 202, user_id: 888, file_name: "MEFOSA Audited Financials 2022-2024 BDO.pdf", file_url: "synthetic://202",
    text_content: "Independent auditor's report by BDO Semaan Gholam & Co. on the audited annual financial statements of MEFOSA for fiscal years 2022, 2023, and 2024. No audit qualifications. Annual turnover USD 480,000 (2024).",
    char_count: 6400, extraction_status: "extracted", created_at: "2026-04-10T00:00:00Z" },
  { vault_document_id: 203, user_id: 888, file_name: "MEFOSA ISO 17025 Lab Partner Accreditation 2024.pdf", file_url: "synthetic://203",
    text_content: "ISO/IEC 17025:2017 accreditation certificate held by MEFOSA's Tripoli lab partner. Scope covers microbiological + chemical food testing for Codex-listed parameters. Valid through Q4 2026.",
    char_count: 1900, extraction_status: "extracted", created_at: "2026-04-11T00:00:00Z" },
  { vault_document_id: 204, user_id: 888, file_name: "MEFOSA Company Profile 2025.pdf", file_url: "synthetic://204",
    text_content: "MEFOSA company profile 2025. Sections: about, capabilities (HACCP/ISO 22000/Codex/training), past clients (USAID Lebanon CSP, UNDP Lebanon, F&B exporters), team CVs summary, geographic footprint (Lebanon, Jordan, Iraq, dormant Syria).",
    char_count: 5200, extraction_status: "extracted", created_at: "2026-04-12T00:00:00Z" },
  { vault_document_id: 205, user_id: 888, file_name: "USAID Lebanon CSP Reference Letter 2024.pdf", file_url: "synthetic://205",
    text_content: "Reference letter from USAID Lebanon Community Support Program confirming MEFOSA delivered food-safety advisory to 47 Lebanese F&B SMEs from 2020 to 2023. Satisfactory performance, recommend for future engagements.",
    char_count: 1700, extraction_status: "extracted", created_at: "2026-04-12T00:00:00Z" },
  { vault_document_id: 206, user_id: 888, file_name: "MEFOSA Code of Conduct 2025.docx", file_url: "synthetic://206",
    text_content: "MEFOSA code of conduct and anti-corruption policy. Covers conflicts of interest, anti-bribery (FCPA-aligned), and confidentiality standards. Signed by all senior consultants.",
    char_count: 1300, extraction_status: "extracted", created_at: "2026-04-13T00:00:00Z" },
  { vault_document_id: 207, user_id: 888, file_name: "Bank Letter Bank Audi MEFOSA 2025.pdf", file_url: "synthetic://207",
    text_content: "Bank account confirmation letter from Bank Audi on official letterhead. Account holder: MEFOSA-MENA Food Safety Associates S.A.R.L. SWIFT, IBAN, branch details included.",
    char_count: 900, extraction_status: "extracted", created_at: "2026-04-13T00:00:00Z" },
];
const library: EvidenceLibraryRow[] = libraryRaw.map((r) => {
  const t = autoTag({ fileName: r.file_name, textExcerpt: r.text_content, declaredType: "other" });
  return { ...r, type: t.type, tags: t.tags };
});

(async () => {
  console.log("=== Sprint 14 live-prompt validation (Roster Fast-Track / MEFOSA / WFP primary) ===");

  const primaryAgency = findAgencyPackage("wfp");
  if (!primaryAgency) throw new Error("WFP not in catalogue?");
  const rosterAgencyContext = [
    `Target agency: ${primaryAgency.label}`,
    `Portal: ${primaryAgency.portalLabel} (${primaryAgency.portalUrl})`,
    `Why register: ${primaryAgency.why}`,
    `Registration steps: ${primaryAgency.submissionSteps.join(" | ")}`,
    `Required documents: ${primaryAgency.requiredDocuments.join("; ")}`,
    `Agency notes: ${primaryAgency.notes.join(" | ")}`,
    `Suggested categories: ${primaryAgency.categoryHints.join("; ")}`,
  ].join("\n");
  const rosterAgencyCatalogue = formatAgencyCatalogueForPrompt(AGENCY_PACKAGES);
  const evidenceLibrarySummary = formatEvidenceLibraryForPrompt(library);

  console.log("extract...");
  const t0 = Date.now();
  const requirements = await extractTenderRequirements(tenderText);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("generate (Sonnet, max_tokens=8000, breakdown across 8 agencies)...");
  const t1 = Date.now();
  const output = await generateRosterPackage(
    {
      tenderText,
      companyContext,
      intakeSummary,
      rosterAgencyContext,
      rosterAgencyCatalogue,
      evidenceLibrarySummary,
    },
    requirements,
  );
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const breakdown = output.agency_readiness_breakdown ?? [];
  console.log(`\nagency_readiness_breakdown: ${breakdown.length} agencies scored`);
  for (const b of breakdown) {
    const marker = b.recommendation === "start_here" ? "★" : b.recommendation === "viable" ? "•" : "✗";
    console.log(`  ${marker} ${b.agency_label.padEnd(8)} ${b.readiness_0_10}/10 [docs=${b.document_coverage_0_10} cat=${b.category_fit_0_10} geo=${b.geographic_fit_0_10}] ${b.recommendation}`);
    console.log(`     ${b.rationale.slice(0, 200)}`);
    if (b.missing_documents.length) console.log(`     missing: ${b.missing_documents.slice(0, 4).join(", ")}${b.missing_documents.length > 4 ? "…" : ""}`);
  }

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint14-roster-live-mefosa.json";
  fs.writeFileSync(outPath, JSON.stringify({ requirements, output }, null, 2));
  console.log(`\nWrote: ${outPath}`);

  console.log("\n--- Grading with the new roster judge ---");
  const grade = await gradeRosterOutput({
    output,
    companyContext,
    primaryAgencyContext: rosterAgencyContext,
    agencyCatalogueExcerpt: rosterAgencyCatalogue,
  });
  console.log(`Grade: ${grade.score_0_10}/10`);
  console.log(`  specificity=${grade.breakdown.specificity} evidence=${grade.breakdown.evidence_anchoring} complete=${grade.breakdown.completeness} agency_honesty=${grade.breakdown.agency_fit_honesty} usable=${grade.breakdown.submission_usability}`);
  for (const r of grade.rationale) console.log(`  - ${r}`);

  const gradeOut = {
    panel_id: "SPRINT14_ROSTER",
    source: outPath,
    note: "Sprint 14 — Roster Fast-Track with agency_readiness_breakdown + gradeRosterOutput judge. MEFOSA / WFP primary, 8 agencies scored, evidence library wired.",
    grade,
  };
  fs.writeFileSync("outputs/paid-services-validation/grades/SPRINT14_ROSTER.json", JSON.stringify(gradeOut, null, 2));
  console.log("\nWrote grade: outputs/paid-services-validation/grades/SPRINT14_ROSTER.json");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
