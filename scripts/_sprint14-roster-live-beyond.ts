/**
 * Sprint 14 live-prompt validation: VP-09 Beyond Wireless (South Africa,
 * WHO PQS cold-chain IoT vendor, product-supplier case). Mirrors the
 * MEFOSA driver but tests the device/manufacturer case where WHO is
 * uniquely viable (PQS device listing) and UNICEF is start_here for
 * vaccine cold-chain supply.
 *
 * Hypothesis: UNICEF should be start_here (vaccine cold-chain supply),
 * WHO viable (PQS prequalification path), UNGM gateway, FAO/WFP/UNDP/
 * IOM/UNOPS blocked (wrong category for an IoT device manufacturer).
 *
 * Usage: npx tsx scripts/_sprint14-roster-live-beyond.ts
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

const tenderText = `Vendor wishes to register on UNICEF Supply Division for vaccine cold-chain monitoring devices and on the WHO Performance, Quality and Safety (PQS) prequalified device list for cold-chain remote temperature monitoring.
Geographic focus: Global (device manufacturer + remote monitoring SaaS), with HQ in South Africa, manufacturing partners in EU + Asia, and direct distribution in 40+ countries.
Reason for UNICEF first: UNICEF Supply Division is the largest single procurer of vaccine cold-chain equipment globally. Beyond Wireless's PQS-listed iCT temperature monitoring devices directly compete with Berlinger and Sensitech for UNICEF country-office procurement.
Secondary plausible agencies: WHO (PQS prequalification listing — already secured for two SKUs), UNGM (gateway), Gavi-aligned procurement adjacent to UNICEF.`;

const companyContext = `Company: Beyond Wireless Technology (Proprietary) Limited
Country of registration: South Africa (Stellenbosch HQ + Cape Town engineering)
Type: IoT remote monitoring technology vendor — vaccine cold-chain + medical refrigeration QA
Founded: 2013; Headcount ~32 (engineering + ops + EMEA business development)
Capabilities: design + manufacture of remote temperature monitoring devices (iCT-series, WHO PQS prequalified), cloud-based monitoring SaaS for vaccine cold-chain operators, integration with national EPI (Expanded Programme on Immunization) systems, hardware-as-a-service deployment model, 24/7 monitoring service
Operational footprint: South Africa (HQ + dev), distribution + service in 40+ countries (focus: sub-Saharan Africa, Latin America, South Asia), EU regulatory office (Berlin)
Past donors / clients: UNICEF country offices (12 countries, direct device sales 2018-2024), Gavi-supported governments (Ethiopia + Pakistan EPI deployments), WHO AFRO regional cold-chain monitoring projects, US CDC AFENET partnership
Past performance: 50,000+ devices deployed; 18 government health ministry contracts; WHO PQS prequalification renewed Q1 2025
Certifications: WHO PQS prequalification (iCT2 + iCT-Lite SKUs), ISO 9001 (quality), ISO 13485 (medical devices), CE Mark, FCC certification, SABS South African product approval
Audit: BDO South Africa, clean audit 2024
Languages: English (corporate), Portuguese + French (regional sales support via partners)
Registration status: UNGM Level 1 (UNGM ID 183484); not registered on UNICEF Supply Division portal yet (planned Q2 2026), WHO PQS listing already secured separately
Equipment / facilities: Manufacturing via two contract manufacturers (Shenzhen + Estonia), Stellenbosch R&D lab, 24/7 monitoring NOC, no on-the-ground field deployment teams (uses local Gavi-funded partners)`;

const intakeSummary = `Applicant: Beyond Wireless. Initial target: UNICEF Supply Division (vaccine cold-chain devices).
Open to: WHO (PQS device listing already in place), UNGM (gateway).
Out of scope: FAO food, WFP logistics, UNDP consulting, IOM migration, UNOPS infrastructure (we are a device manufacturer, not a service vendor).
Goal: register on UNICEF Supply Division within 60 days to qualify for Q3 2026 vaccine cold-chain procurement cycle.`;

const libraryRaw: Omit<EvidenceLibraryRow, "tags" | "type">[] = [
  { vault_document_id: 401, user_id: 666, file_name: "Beyond Wireless CIPC Registration South Africa 2013.pdf", file_url: "synthetic://401",
    text_content: "Companies and Intellectual Property Commission (CIPC) registration certificate for Beyond Wireless Technology (Proprietary) Limited, registered 2013 in South Africa. Active. Sole-shareholder Pty Ltd structure.",
    char_count: 2100, extraction_status: "extracted", created_at: "2026-04-22T00:00:00Z" },
  { vault_document_id: 402, user_id: 666, file_name: "Beyond Wireless Audited Financials 2022-2024 BDO.pdf", file_url: "synthetic://402",
    text_content: "Independent auditor's report by BDO South Africa on the audited financial statements of Beyond Wireless for fiscal years 2022, 2023, and 2024. No audit qualifications. Annual turnover ZAR 78M (2024). EBITDA positive across all three years.",
    char_count: 6900, extraction_status: "extracted", created_at: "2026-04-22T00:00:00Z" },
  { vault_document_id: 403, user_id: 666, file_name: "WHO PQS Prequalification iCT2 Certificate 2025.pdf", file_url: "synthetic://403",
    text_content: "WHO Performance, Quality and Safety (PQS) prequalification certificate for Beyond Wireless iCT2 cold-chain temperature monitoring device. WHO/PQS/E006/TR04.2. Listing renewed Q1 2025. Valid through Q4 2027.",
    char_count: 2800, extraction_status: "extracted", created_at: "2026-04-23T00:00:00Z" },
  { vault_document_id: 404, user_id: 666, file_name: "ISO 13485 Medical Devices Certificate Beyond Wireless 2024.pdf", file_url: "synthetic://404",
    text_content: "ISO 13485:2016 (Medical Devices Quality Management) certificate issued to Beyond Wireless. Scope: design, manufacture, and service of medical-device-grade remote temperature monitoring systems for vaccine cold-chain. Valid through Q3 2026.",
    char_count: 1900, extraction_status: "extracted", created_at: "2026-04-23T00:00:00Z" },
  { vault_document_id: 405, user_id: 666, file_name: "ISO 9001 Quality Management Certificate Beyond Wireless 2024.pdf", file_url: "synthetic://405",
    text_content: "ISO 9001:2015 (Quality Management) certificate issued to Beyond Wireless Technology Pty Ltd. Scope: IoT device manufacturing + cloud monitoring SaaS. Valid through Q3 2026.",
    char_count: 1500, extraction_status: "extracted", created_at: "2026-04-23T00:00:00Z" },
  { vault_document_id: 406, user_id: 666, file_name: "Beyond Wireless iCT2 Technical Datasheet 2025.pdf", file_url: "synthetic://406",
    text_content: "Technical datasheet for Beyond Wireless iCT2 cold-chain temperature monitoring device. Operating range -30°C to +50°C, battery life 5 years, GSM + GPRS + 2G/3G connectivity, web dashboard + mobile alerts. Compliant with WHO PQS E006 specifications.",
    char_count: 4200, extraction_status: "extracted", created_at: "2026-04-24T00:00:00Z" },
  { vault_document_id: 407, user_id: 666, file_name: "Beyond Wireless Capability Statement 2025.pdf", file_url: "synthetic://407",
    text_content: "Capability statement: Beyond Wireless cold-chain IoT solutions. 50,000+ devices deployed; 12 UNICEF country office contracts; Gavi-aligned EPI deployments in Ethiopia + Pakistan; CDC AFENET partnership. Team CVs: CEO (15 yrs cold-chain), CTO (12 yrs IoT firmware), Regulatory Director (medical-device regulatory affairs).",
    char_count: 5400, extraction_status: "extracted", created_at: "2026-04-25T00:00:00Z" },
  { vault_document_id: 408, user_id: 666, file_name: "UNICEF Ethiopia Past Performance Letter 2024.pdf", file_url: "synthetic://408",
    text_content: "UNICEF Ethiopia country office past-performance letter confirming Beyond Wireless delivered 3,200 iCT2 devices for Ethiopia EPI vaccine cold-chain modernization (2022-2024). Performance rated satisfactory; recommend for future procurements.",
    char_count: 1700, extraction_status: "extracted", created_at: "2026-04-26T00:00:00Z" },
  { vault_document_id: 409, user_id: 666, file_name: "Beyond Wireless Anti-Corruption Policy 2024.docx", file_url: "synthetic://409",
    text_content: "Beyond Wireless anti-corruption + ethical business conduct policy. UK Bribery Act + FCPA compliance, supplier due-diligence procedures, conflict-minerals policy, child-labour prohibition. Signed by directors.",
    char_count: 1800, extraction_status: "extracted", created_at: "2026-04-27T00:00:00Z" },
  { vault_document_id: 410, user_id: 666, file_name: "Bank Letter Standard Bank Beyond Wireless 2025.pdf", file_url: "synthetic://410",
    text_content: "Bank account confirmation letter from Standard Bank South Africa for Beyond Wireless Technology Pty Ltd. SWIFT + IBAN + branch details. USD operating account in addition to ZAR.",
    char_count: 1000, extraction_status: "extracted", created_at: "2026-04-27T00:00:00Z" },
];
const library: EvidenceLibraryRow[] = libraryRaw.map((r) => {
  const t = autoTag({ fileName: r.file_name, textExcerpt: r.text_content, declaredType: "other" });
  return { ...r, type: t.type, tags: t.tags };
});

(async () => {
  console.log("=== Sprint 14 live validation (Roster Fast-Track / Beyond Wireless / UNICEF primary) ===");

  const primaryAgency = findAgencyPackage("unicef");
  if (!primaryAgency) throw new Error("UNICEF not in catalogue");
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

  console.log("generate (Sonnet, max_tokens=12000, 8-agency breakdown)...");
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
    console.log(`     ${b.rationale.slice(0, 220)}`);
  }

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint14-roster-live-beyond.json";
  fs.writeFileSync(outPath, JSON.stringify({ requirements, output }, null, 2));
  console.log(`\nWrote: ${outPath}`);

  console.log("\n--- Grading ---");
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
    panel_id: "VP-09",
    source: outPath,
    note: "Sprint 14 — Beyond Wireless cold-chain IoT / UNICEF primary. Real live-prompt grade replacing the seeded MEFOSA-derived anchor.",
    grade,
  };
  fs.writeFileSync("outputs/paid-services-validation/grades/VP-09.json", JSON.stringify(gradeOut, null, 2));
  console.log("\nWrote grade: outputs/paid-services-validation/grades/VP-09.json");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
