/**
 * Sprint 16. Re-grade the existing Sprint 13b/14/15 live outputs against
 * the fixed grader (cap 30k -> 80k) without regenerating anything.
 *
 * Hypothesis: every Roster + Proposal grade landed at 7-8/10 because
 * the grader's input JSON was clipped at 30k chars, surfacing as
 * hallucinated "missing field" / "truncated" rationales. With the cap
 * lifted, the same outputs should grade 9-10/10.
 *
 * Usage: npx tsx scripts/_sprint16-regrade.ts
 */
import * as fs from "node:fs";
import { gradeProposalOutput } from "../src/lib/proposal-package/grade";
import { gradeRosterOutput } from "../src/lib/proposal-package/grade";
import { gradeBidNoBidOutput } from "../src/lib/bid-no-bid/grade";
import { AGENCY_PACKAGES, formatAgencyCatalogueForPrompt, findAgencyPackage } from "../src/lib/proposal-package/roster-packages";

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

const CSIM_CONTEXT = `Company: CSIM (Center for Syrian Independent Media). Founded 2018, Türkiye-registered, ~22 staff + 40 contributors. Independent journalism training and protection across Syrian governorates. Past donors: SIDA, FPU, Internews. Audit: KPMG Türkiye, clean 2024. PADOR in progress.`;

const MEFOSA_CONTEXT = `Company: MEFOSA-MENA Food Safety Associates S.A.R.L. Lebanon, founded 2014. HACCP/ISO 22000 advisory + lab testing. USAID Lebanon CSP + UNDP Lebanon past performance. ISO 17025 lab partner accreditation. UNGM Level 1. BDO audited.`;

const POWERGEN_CONTEXT = `Company: POWERGEN RENEWABLE ENERGY EAST AFRICA LIMITED. Kenya, founded 2011. Mini-grid + solar EPC across Kenya/TZ/UG/RW. 60+ operational mini-grids. USAID Power Africa + AfDB SEFA past performance. ISO 9001 + 45001 certified. Deloitte audit.`;

const BEYOND_CONTEXT = `Company: Beyond Wireless Technology (Pty) Ltd. South Africa, founded 2013. IoT cold-chain temperature monitoring devices for vaccines. WHO PQS prequalified (iCT2). ISO 13485 + 9001. UNICEF Ethiopia past performance. BDO audited.`;

(async () => {
  console.log("=== Sprint 16 re-grade — grader cap 30k -> 80k ===\n");

  // 1. Proposal Draft (Sprint 13b CIM)
  console.log("--- SPRINT13B_FULL re-grade (Proposal Draft, CSIM/EU CIM) ---");
  const sprint13b = JSON.parse(fs.readFileSync("outputs/paid-services-validation/sprint13b-proposal-live-cim.json", "utf-8"));
  const tenderText = fs.existsSync("/tmp/eu-cim-guidelines.txt") ? fs.readFileSync("/tmp/eu-cim-guidelines.txt", "utf-8") : "";
  const proposalGrade = await gradeProposalOutput({
    output: sprint13b.output,
    requirements: sprint13b.requirements,
    companyContext: CSIM_CONTEXT,
    tenderTextExcerpt: tenderText.slice(0, 6000),
  });
  console.log(`Grade: ${proposalGrade.score_0_10}/10 (was 8/10)`);
  console.log(`  spec=${proposalGrade.breakdown.specificity} evid=${proposalGrade.breakdown.evidence_anchoring} comp=${proposalGrade.breakdown.completeness} cons=${proposalGrade.breakdown.internal_consistency} usab=${proposalGrade.breakdown.submission_usability}`);
  for (const r of proposalGrade.rationale) console.log(`  - ${r}`);
  const proposalGradeOut = {
    panel_id: "SPRINT16_PROPOSAL",
    source: "outputs/paid-services-validation/sprint13b-proposal-live-cim.json",
    note: "Sprint 16 re-grade of the Sprint 13b CSIM/EU CIM proposal-draft output. Grader cap lifted 30k -> 80k; no generator changes.",
    grade: proposalGrade,
  };
  fs.writeFileSync("outputs/paid-services-validation/grades/SPRINT16_PROPOSAL.json", JSON.stringify(proposalGradeOut, null, 2));

  // 2. Roster Fast-Track — MEFOSA
  console.log("\n--- SPRINT16_ROSTER_MEFOSA re-grade (was Sprint 14 9/10) ---");
  const mefosa = JSON.parse(fs.readFileSync("outputs/paid-services-validation/sprint14-roster-live-mefosa.json", "utf-8"));
  const wfp = findAgencyPackage("wfp")!;
  const mefosaCtx = [
    `Target agency: ${wfp.label}`, `Portal: ${wfp.portalLabel} (${wfp.portalUrl})`,
    `Why: ${wfp.why}`, `Required documents: ${wfp.requiredDocuments.join("; ")}`,
  ].join("\n");
  const mefosaGrade = await gradeRosterOutput({
    output: mefosa.output,
    companyContext: MEFOSA_CONTEXT,
    primaryAgencyContext: mefosaCtx,
    agencyCatalogueExcerpt: formatAgencyCatalogueForPrompt(AGENCY_PACKAGES),
  });
  console.log(`Grade: ${mefosaGrade.score_0_10}/10 (was 9/10)`);
  console.log(`  spec=${mefosaGrade.breakdown.specificity} evid=${mefosaGrade.breakdown.evidence_anchoring} comp=${mefosaGrade.breakdown.completeness} hon=${mefosaGrade.breakdown.agency_fit_honesty} usab=${mefosaGrade.breakdown.submission_usability}`);
  for (const r of mefosaGrade.rationale) console.log(`  - ${r}`);
  fs.writeFileSync("outputs/paid-services-validation/grades/SPRINT16_ROSTER_MEFOSA.json", JSON.stringify({
    panel_id: "SPRINT16_ROSTER_MEFOSA",
    source: "outputs/paid-services-validation/sprint14-roster-live-mefosa.json",
    note: "Sprint 16 re-grade of the MEFOSA Sprint 14 roster output (grader cap 80k).",
    grade: mefosaGrade,
  }, null, 2));

  // 3. Roster Fast-Track — PowerGen (VP-08)
  console.log("\n--- VP-08 re-grade (PowerGen, was 8/10) ---");
  const powergen = JSON.parse(fs.readFileSync("outputs/paid-services-validation/sprint14-roster-live-powergen.json", "utf-8"));
  const undp = findAgencyPackage("undp")!;
  const powergenCtx = [
    `Target agency: ${undp.label}`, `Portal: ${undp.portalLabel} (${undp.portalUrl})`,
    `Why: ${undp.why}`, `Required documents: ${undp.requiredDocuments.join("; ")}`,
  ].join("\n");
  const powergenGrade = await gradeRosterOutput({
    output: powergen.output,
    companyContext: POWERGEN_CONTEXT,
    primaryAgencyContext: powergenCtx,
    agencyCatalogueExcerpt: formatAgencyCatalogueForPrompt(AGENCY_PACKAGES),
  });
  console.log(`Grade: ${powergenGrade.score_0_10}/10 (was 8/10)`);
  console.log(`  spec=${powergenGrade.breakdown.specificity} evid=${powergenGrade.breakdown.evidence_anchoring} comp=${powergenGrade.breakdown.completeness} hon=${powergenGrade.breakdown.agency_fit_honesty} usab=${powergenGrade.breakdown.submission_usability}`);
  for (const r of powergenGrade.rationale) console.log(`  - ${r}`);
  fs.writeFileSync("outputs/paid-services-validation/grades/VP-08.json", JSON.stringify({
    panel_id: "VP-08",
    source: "outputs/paid-services-validation/sprint14-roster-live-powergen.json",
    note: "Sprint 16 re-grade — PowerGen, grader cap 80k. Replaces Sprint 14 cap-clipped grade.",
    grade: powergenGrade,
  }, null, 2));

  // 4. Roster Fast-Track — Beyond Wireless (VP-09)
  console.log("\n--- VP-09 re-grade (Beyond Wireless, was 8/10) ---");
  const beyond = JSON.parse(fs.readFileSync("outputs/paid-services-validation/sprint14-roster-live-beyond.json", "utf-8"));
  const unicef = findAgencyPackage("unicef")!;
  const beyondCtx = [
    `Target agency: ${unicef.label}`, `Portal: ${unicef.portalLabel} (${unicef.portalUrl})`,
    `Why: ${unicef.why}`, `Required documents: ${unicef.requiredDocuments.join("; ")}`,
  ].join("\n");
  const beyondGrade = await gradeRosterOutput({
    output: beyond.output,
    companyContext: BEYOND_CONTEXT,
    primaryAgencyContext: beyondCtx,
    agencyCatalogueExcerpt: formatAgencyCatalogueForPrompt(AGENCY_PACKAGES),
  });
  console.log(`Grade: ${beyondGrade.score_0_10}/10 (was 8/10)`);
  console.log(`  spec=${beyondGrade.breakdown.specificity} evid=${beyondGrade.breakdown.evidence_anchoring} comp=${beyondGrade.breakdown.completeness} hon=${beyondGrade.breakdown.agency_fit_honesty} usab=${beyondGrade.breakdown.submission_usability}`);
  for (const r of beyondGrade.rationale) console.log(`  - ${r}`);
  fs.writeFileSync("outputs/paid-services-validation/grades/VP-09.json", JSON.stringify({
    panel_id: "VP-09",
    source: "outputs/paid-services-validation/sprint14-roster-live-beyond.json",
    note: "Sprint 16 re-grade — Beyond Wireless, grader cap 80k. Replaces Sprint 14 cap-clipped grade.",
    grade: beyondGrade,
  }, null, 2));

  // Print summary
  console.log("\n=== SUMMARY: grader cap 30k -> 80k impact ===");
  console.log(`  Proposal CSIM:       8/10 -> ${proposalGrade.score_0_10}/10`);
  console.log(`  Roster MEFOSA:       9/10 -> ${mefosaGrade.score_0_10}/10`);
  console.log(`  Roster PowerGen:     8/10 -> ${powergenGrade.score_0_10}/10`);
  console.log(`  Roster Beyond:       8/10 -> ${beyondGrade.score_0_10}/10`);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
