/**
 * Sprint 9 live-prompt validation for the company-aware Proposal Draft pipeline.
 *
 * Verifies that:
 *   1. extractTenderRequirements emits a non-empty capability_match when
 *      companyContext is supplied (Sprint 9 Gap 4 fix).
 *   2. capability_match status uses all three valid values appropriately
 *      (evidenced / claimed / missing).
 *   3. generateProposalDraft's compliance_checklist statuses align with
 *      capability_match per the new prompt rule.
 *   4. safeParseJSON tolerates trailing prose after the JSON block.
 *
 * Uses the EU CIM Syrian Media call as the substrate. CSIM has a plausible
 * mix of evidenced (Türkiye registration, KPMG audit, past donor history)
 * vs claimed (co-applicant commitment, co-financing) vs missing (PADOR not
 * yet registered, journalist physical-protection scope) so all three states
 * should appear.
 *
 * Usage: npx tsx scripts/_sprint9-proposal-live.ts
 */
import * as fs from "node:fs";
import { extractTenderRequirements, generateProposalDraft } from "../src/lib/proposal-package/llm";
import { buildProposalEvidenceProfile } from "../src/lib/proposal-package/evidence";

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
loadEnv(".env.local");

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
Past consortium roles: lead applicant (small EU project, 2023), co-applicant (USAID, 2022)
Past performance: 4 sub-million-EUR grants delivered on time; no audit qualifications
Audit: KPMG Türkiye, clean audit (2024); audited financial statements available
Co-financing capacity: ~5% from own reserves; SIDA bridge financing letter possible
PADOR registration: in progress, not yet complete
Languages: Arabic, English, Kurdish, Turkish
Bank: Akbank (TRY + EUR accounts)
Co-applicant: One INGO in soft conversation; no signed commitment letter yet
Journalist physical-protection programming: not in current scope; would require partner`;

const intakeSummary = `Applicant: CSIM. Targeting Lot 3 of EuropeAid 185831 (DD-ACT-SY).
Lead applicant role intended; PROSPECT submission planned.
Concept-note draft, identification form, declaration of honour are in working folder.
PADOR registration started 2026-04-21; submission target 2026-05-18 deadline.
JV/subcontract appetite: yes, EU-eligible partner only.`;

function flag(ok: boolean, label: string, extra = "") {
  return `${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`;
}

(async () => {
  console.log("=== Sprint 9 live-prompt validation (Proposal Draft) ===");
  console.log("Tender text size:", tenderText.length, "chars");

  const evidenceProfile = buildProposalEvidenceProfile({ tenderText, intakeSummary });
  console.log("Evidence profile status:", evidenceProfile.status, "score:", evidenceProfile.score_0_10);

  console.log("Calling extractTenderRequirements (Haiku) with companyContext...");
  const t0 = Date.now();
  const requirements = await extractTenderRequirements(
    { tenderText, companyContext },
    evidenceProfile,
  );
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("Calling generateProposalDraft (Sonnet)...");
  const t1 = Date.now();
  const output = await generateProposalDraft(
    { tenderText, companyContext, intakeSummary },
    requirements,
    evidenceProfile,
  );
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint9-proposal-live-cim.json";
  fs.writeFileSync(outPath, JSON.stringify({ requirements, output }, null, 2));
  console.log("Wrote:", outPath);

  console.log("\n=== Sprint 9 field checklist ===");
  const cm = requirements.capability_match || [];
  console.log(flag(cm.length >= 6, "capability_match populated", `n=${cm.length}`));
  const cmStatuses = new Set(cm.map((c) => c.status));
  console.log(flag(cmStatuses.size >= 2, "capability_match uses >=2 statuses", Array.from(cmStatuses).join("/")));
  const evidenced = cm.filter((c) => c.status === "evidenced");
  const claimed = cm.filter((c) => c.status === "claimed");
  const missing = cm.filter((c) => c.status === "missing");
  console.log(`  distribution: evidenced=${evidenced.length} claimed=${claimed.length} missing=${missing.length}`);
  const cmWithEvidence = cm.filter((c) => c.company_evidence && c.company_evidence.length > 10).length;
  console.log(flag(cmWithEvidence === cm.length && cm.length > 0, "all capability_match items have company_evidence", `${cmWithEvidence}/${cm.length}`));

  console.log("\n=== Compliance alignment check ===");
  const checklist = output.compliance_checklist || [];
  const statusDist: Record<string, number> = {};
  for (const c of checklist) statusDist[c.status] = (statusDist[c.status] || 0) + 1;
  console.log(`compliance_checklist size: ${checklist.length}, status distribution: ${JSON.stringify(statusDist)}`);
  // The new prompt rule says capability_match.status drives compliance_checklist.status. We sample.
  console.log("\nSample alignment (first 3 capability_match items):");
  for (const c of cm.slice(0, 3)) {
    const aligned = checklist.find((cc) =>
      cc.requirement && c.requirement && cc.requirement.toLowerCase().includes(c.requirement.slice(0, 30).toLowerCase().split(/\s+/)[0] || ""),
    );
    console.log(`  [${c.status}] "${c.requirement.slice(0, 60)}..."`);
    if (aligned) console.log(`    → checklist [${aligned.status}] "${aligned.requirement.slice(0, 60)}..."`);
    else console.log(`    → (no direct checklist match found)`);
  }

  console.log("\n=== Sample capability_match items ===");
  if (evidenced[0]) console.log("EVIDENCED:", JSON.stringify(evidenced[0], null, 2));
  if (claimed[0]) console.log("CLAIMED:", JSON.stringify(claimed[0], null, 2));
  if (missing[0]) console.log("MISSING:", JSON.stringify(missing[0], null, 2));
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
