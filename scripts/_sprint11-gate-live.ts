/**
 * Sprint 11 live-prompt validation: compliance gate on Proposal Draft.
 *
 * Verifies that the generator emits compliance_checklist items with
 * priority + evidence_label, and that summariseComplianceGate produces
 * a meaningful gate_state. Runs two scenarios:
 *
 *  A) THIN library (only the strategic deck) — the gate should fire
 *     because PADOR, audited financials, partnership LOI etc. are
 *     unbacked. mandatory_gaps > 0.
 *
 *  B) FULL library (statutes, KPMG audit, SIDA letter, deck, CV, SEA-H
 *     policy) — same as Sprint 10. Fewer mandatory gaps expected;
 *     ideally gate clears or has only minor outstanding items.
 *
 * Both scenarios use the EU CIM Syrian Media call. The script does not
 * touch production DB; it exercises the in-memory pipeline against a
 * synthetic library.
 *
 * Usage: npx tsx scripts/_sprint11-gate-live.ts
 */
import * as fs from "node:fs";
import { extractTenderRequirements, generateProposalDraft } from "../src/lib/proposal-package/llm";
import { buildProposalEvidenceProfile } from "../src/lib/proposal-package/evidence";
import { summariseComplianceGate, isBlocked, describeGate } from "../src/lib/proposal-package/gate";
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
Founded: 2018
Headcount: ~22 staff, ~40 contributors
Core capabilities: independent journalism training and protection across Syrian governorates; editorial coaching for Syrian newsrooms in exile; network of vetted Syrian journalists; multi-platform content production (Arabic + Kurdish); information-integrity programming; donor reporting against EU and US humanitarian frameworks.
Operational base: Istanbul + field nodes in Gaziantep, Erbil, Qamishli
Past donors: SIDA (2021-2024), Free Press Unlimited (2022), Internews (subaward, 2023)
Past performance: 4 sub-million-EUR grants delivered on time; no audit qualifications
Audit: KPMG Türkiye, clean audit (2024)
PADOR registration: in progress, not yet complete
Languages: Arabic, English, Kurdish, Turkish`;

const intakeSummary = `Applicant: CSIM. Targeting Lot 3 of EuropeAid 185831 (DD-ACT-SY).
Lead applicant role intended; PROSPECT submission planned.
JV/subcontract appetite: yes, EU-eligible partner only.`;

function makeLibrary(scenario: "thin" | "full"): EvidenceLibraryRow[] {
  const rows: Omit<EvidenceLibraryRow, "tags" | "type">[] = [
    {
      vault_document_id: 104,
      user_id: 999,
      file_name: "CSIM Strategic Deck 2025.pdf",
      file_url: "synthetic://104",
      text_content: "CSIM strategic plan 2025-2027. Independent journalism training, editorial coaching, journalist protection, multi-platform content production in Arabic and Kurdish. Logical framework for protection of journalists and bloggers under media freedom pillar.",
      char_count: 4200,
      extraction_status: "extracted",
      created_at: "2026-04-03T00:00:00Z",
    },
  ];
  if (scenario === "full") {
    rows.push(
      {
        vault_document_id: 101, user_id: 999,
        file_name: "CSIM Statutes (Turkiye) 2018.pdf", file_url: "synthetic://101",
        text_content: "Articles of Association of the Center for Syrian Independent Media (CSIM), registered in Türkiye as a nonprofit organisation with legal personality. Statutes filed with the Ministry of Interior.",
        char_count: 3000, extraction_status: "extracted", created_at: "2026-04-01T00:00:00Z",
      },
      {
        vault_document_id: 102, user_id: 999,
        file_name: "KPMG_Audit_CSIM_2024.pdf", file_url: "synthetic://102",
        text_content: "Independent auditor's report by KPMG Türkiye on the audited annual financial statements of CSIM for the year ended 31 December 2024. No audit qualifications. Annual turnover EUR 920,000.",
        char_count: 5400, extraction_status: "extracted", created_at: "2026-04-01T00:00:00Z",
      },
      {
        vault_document_id: 103, user_id: 999,
        file_name: "SIDA Reference Letter 2024.pdf", file_url: "synthetic://103",
        text_content: "Certifies CSIM delivered Independent Media in Syria 2021-2024 (SIDA Ref 12345-2021) on time and within budget. Satisfactory performance, recommend for future partnerships.",
        char_count: 1800, extraction_status: "extracted", created_at: "2026-04-02T00:00:00Z",
      },
      {
        vault_document_id: 105, user_id: 999,
        file_name: "CV_Project_Director_Jad_K.docx", file_url: "synthetic://105",
        text_content: "Curriculum Vitae — Jad K., Project Director, CSIM. 12 years Syrian media development experience, EU and SIDA project management, key personnel on three sub-million EUR grants.",
        char_count: 1200, extraction_status: "extracted", created_at: "2026-04-04T00:00:00Z",
      },
      {
        vault_document_id: 106, user_id: 999,
        file_name: "SEA-H Safeguarding Policy CSIM.docx", file_url: "synthetic://106",
        text_content: "CSIM safeguarding policy covering prevention of sexual exploitation, abuse and harassment (PSEA / SEA-H). Compliant with EU SEA-H self-evaluation questionnaire and CHS standards.",
        char_count: 900, extraction_status: "extracted", created_at: "2026-04-05T00:00:00Z",
      },
    );
  }
  return rows.map((r) => {
    const tagged = autoTag({ fileName: r.file_name, textExcerpt: r.text_content, declaredType: "other" });
    return { ...r, type: tagged.type, tags: tagged.tags };
  });
}

async function runScenario(label: string, scenario: "thin" | "full") {
  console.log(`\n=== Scenario: ${label} ===`);
  const library = makeLibrary(scenario);
  const summary = formatEvidenceLibraryForPrompt(library);
  console.log(`Library size: ${library.length}`);
  for (const row of library) console.log(`  ${row.file_name} -> [${row.tags.join(", ")}]`);

  const evidenceProfile = buildProposalEvidenceProfile({ tenderText, intakeSummary });
  console.log(`Source quality: ${evidenceProfile.status} (${evidenceProfile.score_0_10}/10)`);

  const t0 = Date.now();
  const requirements = await extractTenderRequirements(
    { tenderText, companyContext, evidenceLibrarySummary: summary },
    evidenceProfile,
  );
  console.log(`extract: ${((Date.now() - t0) / 1000).toFixed(1)}s, capability_match items: ${requirements.capability_match?.length ?? 0}`);

  const t1 = Date.now();
  const output = await generateProposalDraft(
    { tenderText, companyContext, intakeSummary },
    requirements,
    evidenceProfile,
  );
  console.log(`generate: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const items = output.compliance_checklist ?? [];
  const priorityDist: Record<string, number> = {};
  const evidenceDist: Record<string, number> = {};
  const statusDist: Record<string, number> = {};
  for (const c of items) {
    priorityDist[c.priority ?? "unset"] = (priorityDist[c.priority ?? "unset"] || 0) + 1;
    evidenceDist[c.evidence_label ?? "unset"] = (evidenceDist[c.evidence_label ?? "unset"] || 0) + 1;
    statusDist[c.status] = (statusDist[c.status] || 0) + 1;
  }
  console.log(`compliance_checklist n=${items.length}:`);
  console.log(`  status:    ${JSON.stringify(statusDist)}`);
  console.log(`  priority:  ${JSON.stringify(priorityDist)}`);
  console.log(`  evidence:  ${JSON.stringify(evidenceDist)}`);

  const gate = summariseComplianceGate(output);
  console.log(`Gate: mandatory_gaps=${gate.mandatory_gaps}, recommended_gaps=${gate.recommended_gaps}, blocked=${isBlocked(gate)}`);
  console.log(`  ${describeGate(gate)}`);
  if (gate.gap_items.length > 0) {
    console.log("  Top 5 gap items (mandatory first):");
    const sorted = [...gate.gap_items].sort((a, b) => (a.priority === "mandatory" ? -1 : 1));
    for (const g of sorted.slice(0, 5)) {
      console.log(`    [${g.priority}/${g.evidence_label ?? "?"}] ${g.requirement.slice(0, 80)}`);
    }
  }

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  fs.writeFileSync(
    `outputs/paid-services-validation/sprint11-${scenario}-cim.json`,
    JSON.stringify({ scenario, library, summary, requirements, output, gate }, null, 2),
  );

  return { scenario, gate, statusDist, priorityDist, evidenceDist };
}

(async () => {
  console.log("=== Sprint 11 live-prompt validation (compliance gate) ===");
  const thin = await runScenario("THIN library (only strategic deck)", "thin");
  const full = await runScenario("FULL library (statutes + audit + reference + deck + CV + SEA-H)", "full");

  console.log("\n=== Hypothesis checks ===");
  const ok = (v: boolean, msg: string) => console.log(`${v ? "✅" : "❌"} ${msg}`);
  ok(thin.priorityDist.mandatory > 0, "THIN: at least one item flagged mandatory");
  ok(thin.priorityDist.recommended > 0, "THIN: at least one item flagged recommended");
  ok(thin.evidenceDist.evidence_from_library !== undefined || thin.evidenceDist.user_claim !== undefined, "THIN: evidence_label populated");
  ok(thin.gate.mandatory_gaps > 0, "THIN: gate blocks (mandatory_gaps > 0)");
  ok(full.priorityDist.mandatory > 0, "FULL: at least one item flagged mandatory");
  ok((full.evidenceDist.evidence_from_library ?? 0) >= 3, "FULL: >=3 items labelled evidence_from_library");
  ok(full.gate.mandatory_gaps <= thin.gate.mandatory_gaps, "FULL: mandatory_gaps <= THIN (library reduces gate exposure)");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
