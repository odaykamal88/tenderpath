/**
 * Sprint 14 live-prompt validation: VP-08 PowerGen (Kenya, mini-grid,
 * UNDP/UNOPS primary intent). Mirrors the MEFOSA driver but with a
 * different company profile + different evidence library to verify
 * the agency_readiness_breakdown adapts honestly.
 *
 * Hypothesis: UNDP/UNOPS should score start_here/viable, WFP/UNICEF
 * should be blocked (renewable energy isn't their procurement lane),
 * WHO should be blocked (not a health vendor), UNGM should be viable
 * as gateway.
 *
 * Usage: npx tsx scripts/_sprint14-roster-live-powergen.ts
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

const tenderText = `Vendor wishes to register on the UNDP supplier roster (renewable energy access, mini-grid, and solar EPC supplier categories) and on the UNOPS renewable-energy roster for project services.
Geographic focus: East Africa (Kenya HQ + Tanzania + Uganda + Rwanda field ops + Ethiopia early-stage).
Reason for UNDP first: PowerGen is a USAID Power Africa partner with AfDB renewable-energy platform credentials. UNDP procures renewable-energy mini-grid and solar EPC services through its country offices in East Africa — direct match for PowerGen's project portfolio.
Secondary plausible agencies: UNOPS (infrastructure + renewable-energy), UNGM (gateway), IOM (refugee camp electrification — adjacent).`;

const companyContext = `Company: POWERGEN RENEWABLE ENERGY EAST AFRICA LIMITED
Country of registration: Kenya (Nairobi HQ + Arusha TZ + Kampala UG offices)
Type: Pan-African distributed renewable energy developer + EPC contractor
Founded: 2011; Headcount ~85 (engineering + ops + project finance + business development)
Capabilities: mini-grid design + build (solar PV + battery storage + LV distribution), AC/DC microgrids, solar home systems supply, O&M services, project development (site identification, regulatory licensing, customer acquisition), grant-funded rural electrification project execution, climate-finance project structuring
Operational footprint: Kenya (40+ mini-grids), Tanzania (12 mini-grids), Uganda (6 mini-grids), Rwanda (4), Ethiopia (2 pilot)
Past donors / clients: USAID Power Africa (multi-year mini-grid grant 2019-2024), AfDB SEFA (Sustainable Energy Fund for Africa, project funding 2020-2023), Shell Foundation (early-stage capital + technical assistance, 2018-2022), Power Africa Beyond the Grid Fund Zambia (subgrant 2022)
Past performance: 60+ operational mini-grids serving 45,000+ households, 12 EPC contracts delivered on time, no audit qualifications, ISO 9001 (quality) + ISO 45001 (occupational health & safety) certified
Audit: Deloitte East Africa, clean audit 2024 (consolidated group)
Languages: English (corporate), Swahili (field ops), Kinyarwanda + Amharic at country-office level
Registration status: UNGM Level 1 (UNGM ID 263073); not registered on UNDP/UNOPS supplier portals yet
Equipment / facilities: Solar PV + battery storage installation crews; Nairobi warehouse + procurement function; no diesel/fossil-fuel supply, no health/medical product capability, no IT services beyond internal monitoring`;

const intakeSummary = `Applicant: PowerGen. Initial target: UNDP renewable-energy supplier roster (East Africa region).
Open to: UNOPS (infrastructure + project services), UNGM (gateway), IOM (refugee camp electrification).
Out of scope: WHO health commodities (not a manufacturer), UNICEF supply (not a NFI vendor), FAO food (wrong sector), WFP logistics (not a transport company).
Goal: register on UNDP + UNOPS in 90-120 days so PowerGen is visible for upcoming Power Africa-adjacent and SEforALL programmatic procurement.`;

const libraryRaw: Omit<EvidenceLibraryRow, "tags" | "type">[] = [
  { vault_document_id: 301, user_id: 777, file_name: "PowerGen Certificate of Incorporation Kenya 2011.pdf", file_url: "synthetic://301",
    text_content: "Certificate of Incorporation issued by the Kenya Companies Registry, 2011. Active. Sole-shareholder structure with Mauritius holdco. Business activity classified under renewable energy generation and distribution.",
    char_count: 2400, extraction_status: "extracted", created_at: "2026-04-15T00:00:00Z" },
  { vault_document_id: 302, user_id: 777, file_name: "PowerGen Audited Financials 2022-2024 Deloitte.pdf", file_url: "synthetic://302",
    text_content: "Independent auditor's report by Deloitte East Africa on the consolidated annual financial statements of PowerGen for fiscal years 2022, 2023, and 2024. No audit qualifications. Annual turnover USD 12.4M (2024). EBITDA positive 2023+.",
    char_count: 7200, extraction_status: "extracted", created_at: "2026-04-15T00:00:00Z" },
  { vault_document_id: 303, user_id: 777, file_name: "PowerGen ISO 9001 + ISO 45001 Certificate 2024.pdf", file_url: "synthetic://303",
    text_content: "ISO 9001:2015 (Quality Management) and ISO 45001:2018 (Occupational Health & Safety) certificates issued to PowerGen Renewable Energy East Africa Ltd. Scope: design, EPC, and O&M of renewable energy mini-grids and solar home systems. Valid through Q3 2026.",
    char_count: 2200, extraction_status: "extracted", created_at: "2026-04-16T00:00:00Z" },
  { vault_document_id: 304, user_id: 777, file_name: "PowerGen Capability Statement 2025.pdf", file_url: "synthetic://304",
    text_content: "PowerGen capability statement 2025. Sections: company history, mini-grid portfolio (60+ operational sites), EPC track record (12 delivered contracts), team CVs (5 senior engineers + 3 country directors), geographic footprint, climate-finance structuring expertise.",
    char_count: 6800, extraction_status: "extracted", created_at: "2026-04-17T00:00:00Z" },
  { vault_document_id: 305, user_id: 777, file_name: "USAID Power Africa Reference Letter 2024.pdf", file_url: "synthetic://305",
    text_content: "Reference letter from USAID Power Africa confirming PowerGen delivered 18 mini-grids and 4,200 solar home systems under the Beyond the Grid Fund Zambia subgrant (2022-2024). Satisfactory performance, on time and within budget, recommend for future engagements.",
    char_count: 2100, extraction_status: "extracted", created_at: "2026-04-18T00:00:00Z" },
  { vault_document_id: 306, user_id: 777, file_name: "AfDB SEFA Project Completion Report 2023.pdf", file_url: "synthetic://306",
    text_content: "Project completion report for AfDB Sustainable Energy Fund for Africa (SEFA) grant to PowerGen for 12 mini-grids in Tanzania, completed 2023. Verified electrification of 8,400 households. Clean financial accountability, no audit issues raised.",
    char_count: 3200, extraction_status: "extracted", created_at: "2026-04-19T00:00:00Z" },
  { vault_document_id: 307, user_id: 777, file_name: "PowerGen Code of Conduct + Anti-Corruption 2024.docx", file_url: "synthetic://307",
    text_content: "PowerGen group-wide code of conduct + anti-corruption policy. Covers FCPA + UK Bribery Act compliance, conflicts of interest, whistleblower protection, child labour prohibition, modern slavery declaration. Signed by all senior staff and country directors.",
    char_count: 1900, extraction_status: "extracted", created_at: "2026-04-20T00:00:00Z" },
  { vault_document_id: 308, user_id: 777, file_name: "Bank Letter Equity Bank PowerGen 2025.pdf", file_url: "synthetic://308",
    text_content: "Bank account confirmation letter from Equity Bank Kenya on official letterhead. Account holder: PowerGen Renewable Energy East Africa Limited. SWIFT, IBAN, branch details included. Two USD operating accounts (Kenya + Tanzania).",
    char_count: 1100, extraction_status: "extracted", created_at: "2026-04-20T00:00:00Z" },
  { vault_document_id: 309, user_id: 777, file_name: "PowerGen Insurance Certificate Professional Indemnity 2025.pdf", file_url: "synthetic://309",
    text_content: "Professional indemnity + public liability insurance certificate issued by AIG Kenya for PowerGen Renewable Energy East Africa Ltd. Coverage USD 2M per occurrence, USD 5M aggregate. Valid 2025 calendar year.",
    char_count: 1400, extraction_status: "extracted", created_at: "2026-04-21T00:00:00Z" },
];
const library: EvidenceLibraryRow[] = libraryRaw.map((r) => {
  const t = autoTag({ fileName: r.file_name, textExcerpt: r.text_content, declaredType: "other" });
  return { ...r, type: t.type, tags: t.tags };
});

(async () => {
  console.log("=== Sprint 14 live validation (Roster Fast-Track / PowerGen / UNDP primary) ===");

  const primaryAgency = findAgencyPackage("undp");
  if (!primaryAgency) throw new Error("UNDP not in catalogue");
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
  const outPath = "outputs/paid-services-validation/sprint14-roster-live-powergen.json";
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
    panel_id: "VP-08",
    source: outPath,
    note: "Sprint 14 — PowerGen renewable energy / UNDP primary. Real live-prompt grade replacing the seeded MEFOSA-derived anchor.",
    grade,
  };
  fs.writeFileSync("outputs/paid-services-validation/grades/VP-08.json", JSON.stringify(gradeOut, null, 2));
  console.log("\nWrote grade: outputs/paid-services-validation/grades/VP-08.json");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
