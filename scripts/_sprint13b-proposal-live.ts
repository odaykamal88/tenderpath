/**
 * Sprint 13b live-prompt validation: re-runs the EU CIM proposal with
 * the tightened cover-letter rule + widened financial_template_notes
 * clamp + post-generation placeholder sweep, then re-grades the output
 * to verify the grader's three concerns are addressed.
 *
 * Compares against Sprint 11 FULL baseline (grader score 7/10).
 *
 * Usage: npx tsx scripts/_sprint13b-proposal-live.ts
 */
import * as fs from "node:fs";
import { extractTenderRequirements, generateProposalDraft } from "../src/lib/proposal-package/llm";
import { buildProposalEvidenceProfile } from "../src/lib/proposal-package/evidence";
import { sweepCoverLetterPlaceholders } from "../src/lib/proposal-package/sweep";
import { summariseComplianceGate, withGateState } from "../src/lib/proposal-package/gate";
import { gradeProposalOutput } from "../src/lib/proposal-package/grade";
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

const guidelines = fs.readFileSync("/tmp/eu-cim-guidelines.txt", "utf-8").slice(0, 20000);
const corrigendum = fs.existsSync("/tmp/eu-cim-corrigendum.txt")
  ? fs.readFileSync("/tmp/eu-cim-corrigendum.txt", "utf-8").slice(0, 5000)
  : "";
const tenderText = `${guidelines}\n\n--- CORRIGENDUM NO 1 ---\n${corrigendum}`;

const companyContext = `Company: CSIM (Center for Syrian Independent Media)
Country of registration: Türkiye (operating across Syria)
Type: Syrian-led nonprofit / media-development consortium, legal personality (statutes filed)
Founded: 2018; Headcount ~22 + 40 contributors
Capabilities: independent journalism training and protection across Syrian governorates, editorial coaching for Syrian newsrooms in exile, vetted Syrian journalists network, multi-platform content production (Arabic + Kurdish), information-integrity programming, donor reporting against EU + US humanitarian frameworks
Operational base: Istanbul + Gaziantep, Erbil, Qamishli
Past donors: SIDA (2021-2024), Free Press Unlimited (2022), Internews (subaward, 2023)
Past performance: 4 sub-million-EUR grants delivered on time; no audit qualifications
Audit: KPMG Türkiye, clean audit 2024
PADOR registration: in progress, not yet complete
Languages: Arabic, English, Kurdish, Turkish`;

const intakeSummary = `Applicant: CSIM. Targeting Lot 3 of EuropeAid 185831 (DD-ACT-SY).
Lead applicant role intended; PROSPECT submission planned.
JV/subcontract appetite: yes, EU-eligible partner only.`;

const libraryRaw: Omit<EvidenceLibraryRow, "tags" | "type">[] = [
  { vault_document_id: 101, user_id: 999, file_name: "CSIM Statutes (Turkiye) 2018.pdf", file_url: "synthetic://101",
    text_content: "Articles of Association of the Center for Syrian Independent Media (CSIM), registered in Türkiye as a nonprofit organisation with legal personality. Statutes filed with the Ministry of Interior.",
    char_count: 3000, extraction_status: "extracted", created_at: "2026-04-01T00:00:00Z" },
  { vault_document_id: 102, user_id: 999, file_name: "KPMG_Audit_CSIM_2024.pdf", file_url: "synthetic://102",
    text_content: "Independent auditor's report by KPMG Türkiye on the audited annual financial statements of CSIM for the year ended 31 December 2024. No audit qualifications. Annual turnover EUR 920,000.",
    char_count: 5400, extraction_status: "extracted", created_at: "2026-04-01T00:00:00Z" },
  { vault_document_id: 103, user_id: 999, file_name: "SIDA Reference Letter 2024.pdf", file_url: "synthetic://103",
    text_content: "Certifies CSIM delivered Independent Media in Syria 2021-2024 (SIDA Ref 12345-2021) on time and within budget. Satisfactory performance, recommend for future partnerships.",
    char_count: 1800, extraction_status: "extracted", created_at: "2026-04-02T00:00:00Z" },
  { vault_document_id: 104, user_id: 999, file_name: "CSIM Strategic Deck 2025.pdf", file_url: "synthetic://104",
    text_content: "CSIM strategic plan 2025-2027. Independent journalism training, editorial coaching, journalist protection, multi-platform content production in Arabic and Kurdish. Logical framework for protection of journalists and bloggers under media freedom pillar.",
    char_count: 4200, extraction_status: "extracted", created_at: "2026-04-03T00:00:00Z" },
  { vault_document_id: 105, user_id: 999, file_name: "CV_Project_Director_Jad_K.docx", file_url: "synthetic://105",
    text_content: "Curriculum Vitae — Jad K., Project Director, CSIM. 12 years Syrian media development experience, EU and SIDA project management, key personnel on three sub-million EUR grants.",
    char_count: 1200, extraction_status: "extracted", created_at: "2026-04-04T00:00:00Z" },
  { vault_document_id: 106, user_id: 999, file_name: "SEA-H Safeguarding Policy CSIM.docx", file_url: "synthetic://106",
    text_content: "CSIM safeguarding policy covering prevention of sexual exploitation, abuse and harassment (PSEA / SEA-H). Compliant with EU SEA-H self-evaluation questionnaire and CHS standards.",
    char_count: 900, extraction_status: "extracted", created_at: "2026-04-05T00:00:00Z" },
];
const library: EvidenceLibraryRow[] = libraryRaw.map((r) => {
  const t = autoTag({ fileName: r.file_name, textExcerpt: r.text_content, declaredType: "other" });
  return { ...r, type: t.type, tags: t.tags };
});

(async () => {
  console.log("=== Sprint 13b live-prompt validation ===");
  const evidenceProfile = buildProposalEvidenceProfile({ tenderText, intakeSummary });
  console.log(`Source quality: ${evidenceProfile.status} (${evidenceProfile.score_0_10}/10)`);
  const summary = formatEvidenceLibraryForPrompt(library);

  console.log("extract...");
  const t0 = Date.now();
  const requirements = await extractTenderRequirements(
    { tenderText, companyContext, evidenceLibrarySummary: summary },
    evidenceProfile,
  );
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s, capability_match items: ${requirements.capability_match?.length ?? 0}`);

  console.log("generate...");
  const t1 = Date.now();
  const rawOutput = await generateProposalDraft(
    { tenderText, companyContext, intakeSummary },
    requirements,
    evidenceProfile,
  );
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // Sprint 13b sweep
  const { output: sweptOutput, sweep } = sweepCoverLetterPlaceholders(rawOutput);
  console.log(`sweep: ${sweep.count} placeholders ${sweep.count ? `(${sweep.placeholders.join(", ")})` : ""}`);

  const gate = summariseComplianceGate(sweptOutput);
  const finalOutput = withGateState(sweptOutput, gate);
  console.log(`gate: mandatory_gaps=${gate.mandatory_gaps}, recommended_gaps=${gate.recommended_gaps}`);

  // Check financial_template_notes are no longer truncated
  const notes = finalOutput.financial_template_notes ?? [];
  const truncatedCount = notes.filter((n) => n.endsWith("..") || /[a-z]\b$/i.test(n) === false && n.length >= 380).length;
  const noteLengths = notes.map((n) => n.length);
  console.log(`financial_template_notes: ${notes.length} items, lengths ${noteLengths.join("/")}`);

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint13b-proposal-live-cim.json";
  fs.writeFileSync(outPath, JSON.stringify({ requirements, output: finalOutput, sweep, gate }, null, 2));
  console.log(`Wrote: ${outPath}`);

  // Re-grade
  console.log("\n--- Re-grading with the new pipeline ---");
  const grade = await gradeProposalOutput({
    output: finalOutput,
    requirements,
    companyContext,
    tenderTextExcerpt: tenderText.slice(0, 6000),
  });
  console.log(`Grade: ${grade.score_0_10}/10`);
  console.log(`  specificity=${grade.breakdown.specificity} evidence=${grade.breakdown.evidence_anchoring} complete=${grade.breakdown.completeness} consistent=${grade.breakdown.internal_consistency} usable=${grade.breakdown.submission_usability}`);
  for (const r of grade.rationale) console.log(`  - ${r}`);

  // Save under SPRINT13B_FULL for the harness anchor
  const gradeOut = {
    panel_id: "SPRINT13B_FULL",
    source: outPath,
    note: "Sprint 13b — cover-letter rule tightened, financial_template_notes clamp 400->1200, post-generation placeholder sweep wired.",
    grade,
  };
  fs.writeFileSync("outputs/paid-services-validation/grades/SPRINT13B_FULL.json", JSON.stringify(gradeOut, null, 2));
  console.log("\nWrote grade: outputs/paid-services-validation/grades/SPRINT13B_FULL.json");

  // Compare against Sprint 11 baseline
  const baseline = JSON.parse(fs.readFileSync("outputs/paid-services-validation/grades/SPRINT11_FULL.json", "utf-8"));
  console.log("\n=== Sprint 11 -> Sprint 13b comparison ===");
  console.log(`Score:      ${baseline.grade.score_0_10}/10 -> ${grade.score_0_10}/10`);
  for (const k of ["specificity","evidence_anchoring","completeness","internal_consistency","submission_usability"] as const) {
    const a = baseline.grade.breakdown[k];
    const b = grade.breakdown[k];
    const arrow = a === b ? "→" : (b > a ? "↑" : "↓");
    console.log(`  ${k.padEnd(22)} ${a} ${arrow} ${b}`);
  }
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
