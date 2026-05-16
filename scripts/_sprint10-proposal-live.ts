/**
 * Sprint 10 live-prompt validation: applicant evidence library wired
 * into the company-aware Proposal Draft extractor.
 *
 * Verifies:
 *   1. autoTag(filename, text, declaredType) emits sensible tags for
 *      each of the EU CIM applicant artefacts.
 *   2. formatEvidenceLibraryForPrompt renders a compact summary.
 *   3. extractTenderRequirements with evidenceLibrarySummary populates
 *      capability_match such that requirements backed by library items
 *      are marked "evidenced" (not "claimed").
 *   4. The compliance_checklist downstream uses those statuses.
 *
 * The applicant evidence library is built in-memory from the EU CIM
 * artefacts (no DB writes — this run is read-only against production).
 *
 * Usage: npx tsx scripts/_sprint10-proposal-live.ts
 */
import * as fs from "node:fs";
import { extractTenderRequirements, generateProposalDraft } from "../src/lib/proposal-package/llm";
import { buildProposalEvidenceProfile } from "../src/lib/proposal-package/evidence";
import { autoTag } from "../src/lib/applicant-evidence/auto-tag";
import {
  formatEvidenceLibraryForPrompt,
  findEvidenceFor,
} from "../src/lib/applicant-evidence/query";
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
Core capabilities:
- Independent journalism training and protection across Syrian governorates
- Editorial coaching for Syrian newsrooms in exile
- Network of vetted Syrian journalists, photographers, and fact-checkers
- Multi-platform content production (Arabic + Kurdish)
- Information-integrity programming, anti-disinformation work
- Donor reporting against EU and US humanitarian frameworks
Operational base: Istanbul + field nodes in Gaziantep, Erbil, Qamishli
Past donors: SIDA (2x grants, 2021-2024), Free Press Unlimited (2022), Internews (subaward, 2023)
Past performance: 4 sub-million-EUR grants delivered on time; no audit qualifications
Audit: KPMG Türkiye, clean audit (2024)
Co-financing capacity: ~5% from own reserves; SIDA bridge financing letter possible
PADOR registration: in progress, not yet complete
Languages: Arabic, English, Kurdish, Turkish
Bank: Akbank (TRY + EUR accounts)`;

const intakeSummary = `Applicant: CSIM. Targeting Lot 3 of EuropeAid 185831 (DD-ACT-SY).
Lead applicant role intended; PROSPECT submission planned.
JV/subcontract appetite: yes, EU-eligible partner only.`;

// Build a synthetic evidence library mirroring what CSIM would have uploaded.
// Each item is the same shape loadEvidenceLibrary would return from DB.
const library: EvidenceLibraryRow[] = [
  {
    vault_document_id: 101,
    user_id: 999,
    file_name: "CSIM Statutes (Turkiye) 2018.pdf",
    type: "other",
    tags: [],
    file_url: "synthetic://101",
    text_content: "Articles of Association of the Center for Syrian Independent Media (CSIM), registered in Türkiye as a nonprofit organisation with legal personality. Statutes filed with the Ministry of Interior under reg. no. 34-12345.",
    char_count: 3000,
    extraction_status: "extracted",
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    vault_document_id: 102,
    user_id: 999,
    file_name: "KPMG_Audit_CSIM_2024.pdf",
    type: "other",
    tags: [],
    file_url: "synthetic://102",
    text_content: "Independent auditor's report by KPMG Türkiye on the audited annual financial statements of CSIM for the year ended 31 December 2024. The financial statements are prepared in accordance with IFRS for SMEs. We have not identified any audit qualifications. Annual turnover: EUR 920,000. Operating budget: EUR 880,000.",
    char_count: 5400,
    extraction_status: "extracted",
    created_at: "2026-04-01T00:00:00Z",
  },
  {
    vault_document_id: 103,
    user_id: 999,
    file_name: "SIDA Reference Letter 2024.pdf",
    type: "other",
    tags: [],
    file_url: "synthetic://103",
    text_content: "This is to certify that the Center for Syrian Independent Media (CSIM) successfully delivered the project 'Independent Media in Syria 2021-2024' under SIDA funding (Reference 12345-2021). All milestones were achieved on time and within budget. We confirm satisfactory performance and recommend CSIM for future donor partnerships.",
    char_count: 1800,
    extraction_status: "extracted",
    created_at: "2026-04-02T00:00:00Z",
  },
  {
    vault_document_id: 104,
    user_id: 999,
    file_name: "CSIM Strategic Deck 2025.pdf",
    type: "other",
    tags: [],
    file_url: "synthetic://104",
    text_content: "CSIM strategic plan 2025-2027. Our work in Syria covers independent journalism training, editorial coaching for newsrooms in exile, journalist protection programmes including digital security training, and multi-platform content production in Arabic and Kurdish. Logical framework included for the protection of journalists and bloggers under media freedom pillar.",
    char_count: 4200,
    extraction_status: "extracted",
    created_at: "2026-04-03T00:00:00Z",
  },
  {
    vault_document_id: 105,
    user_id: 999,
    file_name: "CV_Project_Director_Jad_K.docx",
    type: "other",
    tags: [],
    file_url: "synthetic://105",
    text_content: "Curriculum Vitae — Jad K., Project Director, CSIM. 12 years experience in Syrian media development, project management of EU and SIDA funded projects, key personnel role on three sub-million EUR grants. Languages: Arabic, English, Turkish.",
    char_count: 1200,
    extraction_status: "extracted",
    created_at: "2026-04-04T00:00:00Z",
  },
  {
    vault_document_id: 106,
    user_id: 999,
    file_name: "SEA-H Safeguarding Policy CSIM.docx",
    type: "other",
    tags: [],
    file_url: "synthetic://106",
    text_content: "CSIM safeguarding policy covering prevention of sexual exploitation, abuse and harassment (PSEA / SEA-H). Compliant with the EU sea-h self-evaluation questionnaire and CHS standards. Updated 2025.",
    char_count: 900,
    extraction_status: "extracted",
    created_at: "2026-04-05T00:00:00Z",
  },
];

function flag(ok: boolean, label: string, extra = ""): string {
  return `${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`;
}

(async () => {
  console.log("=== Sprint 10 live-prompt validation (Proposal Draft + evidence library) ===");

  // Step 1: run autoTag against each library item, populate the row.
  console.log("\n--- Auto-tagging library ---");
  for (const row of library) {
    const tagged = autoTag({ fileName: row.file_name, textExcerpt: row.text_content, declaredType: row.type });
    row.tags = tagged.tags;
    row.type = tagged.type;
    console.log(`  ${row.file_name.padEnd(45)} -> type=${row.type.padEnd(20)} tags=[${row.tags.join(", ")}]`);
  }

  // Step 2: print the prompt summary that will go into Haiku's context.
  const summary = formatEvidenceLibraryForPrompt(library);
  console.log("\n--- formatEvidenceLibraryForPrompt output ---");
  console.log(summary);

  // Step 3: smoke-test findEvidenceFor against a few requirement strings.
  console.log("\n--- findEvidenceFor smoke ---");
  const probes = [
    "Audited financial statements for the last two financial years",
    "Lead applicant must have legal personality and be registered as a non-profit",
    "Past performance: at least two donor-funded projects in the last 5 years",
    "Safeguarding (SEA-H) policy and child protection",
    "Project Director CV demonstrating 10+ years of media development experience",
  ];
  for (const probe of probes) {
    const hits = findEvidenceFor(library, probe, 2);
    console.log(`\n  PROBE: "${probe.slice(0, 70)}"`);
    if (hits.length === 0) console.log(`    ❌ no match`);
    else for (const h of hits) console.log(`    ✅ score=${h.score} ${h.file_name} [${h.tags.slice(0, 4).join(", ")}]`);
  }

  // Step 4: full pipeline — extract, generate, score capability_match upgrades.
  const evidenceProfile = buildProposalEvidenceProfile({ tenderText, intakeSummary });

  console.log("\n--- Running extractTenderRequirements with library context ---");
  const t0 = Date.now();
  const requirements = await extractTenderRequirements(
    { tenderText, companyContext, evidenceLibrarySummary: summary },
    evidenceProfile,
  );
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("\n--- Running generateProposalDraft ---");
  const t1 = Date.now();
  const output = await generateProposalDraft(
    { tenderText, companyContext, intakeSummary },
    requirements,
    evidenceProfile,
  );
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint10-proposal-live-cim.json";
  fs.writeFileSync(outPath, JSON.stringify({ taggedLibrary: library, summary, requirements, output }, null, 2));
  console.log("Wrote:", outPath);

  console.log("\n=== Sprint 10 field checklist ===");
  const cm = requirements.capability_match || [];
  const evidenced = cm.filter((c) => c.status === "evidenced");
  const claimed = cm.filter((c) => c.status === "claimed");
  const missing = cm.filter((c) => c.status === "missing");
  console.log(flag(cm.length >= 6, "capability_match populated", `n=${cm.length}`));
  console.log(`  distribution: evidenced=${evidenced.length} claimed=${claimed.length} missing=${missing.length}`);
  // Sprint 10 hypothesis: with a real library, several requirements that were "claimed" in Sprint 9 are now "evidenced".
  console.log(flag(evidenced.length >= 3, "at least 3 'evidenced' items (library is doing work)", `evidenced=${evidenced.length}`));
  // Citations should reference library file names where evidenced.
  const evidenceCitesLibrary = evidenced.filter((e) => {
    const lc = e.company_evidence.toLowerCase();
    return library.some((row) => {
      const fn = row.file_name.toLowerCase();
      return lc.includes(fn) || lc.includes(fn.replace(/\.(pdf|docx|xlsx)$/i, "")) || fn.split(/[._ ]/).filter((p) => p.length > 4).some((p) => lc.includes(p));
    });
  }).length;
  console.log(flag(evidenceCitesLibrary >= Math.ceil(evidenced.length / 2), "evidenced citations reference library files", `${evidenceCitesLibrary}/${evidenced.length}`));

  const checklist = output.compliance_checklist || [];
  const statusDist: Record<string, number> = {};
  for (const c of checklist) statusDist[c.status] = (statusDist[c.status] || 0) + 1;
  console.log(`compliance_checklist status distribution: ${JSON.stringify(statusDist)}`);
  console.log(flag((statusDist.compliant ?? 0) >= 3, "compliance_checklist has >=3 'compliant'", `compliant=${statusDist.compliant ?? 0}`));

  console.log("\n--- Sample evidenced items ---");
  for (const e of evidenced.slice(0, 3)) {
    console.log(`  REQ: ${e.requirement.slice(0, 80)}`);
    console.log(`  CITES: ${e.company_evidence.slice(0, 160)}`);
    console.log("");
  }
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
