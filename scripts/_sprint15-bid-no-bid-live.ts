/**
 * Sprint 15 live-prompt validation: run the Bid/No-Bid pipeline against
 * the EU CIM call (EuropeAid 185831) with CSIM as the applicant, grade
 * the output. This is the same tender Sprint 9-13b used to validate
 * Proposal Draft — anchoring Bid/No-Bid against the same artefact lets
 * us compare what each paid service produces from the same inputs.
 *
 * Usage: npx tsx scripts/_sprint15-bid-no-bid-live.ts
 */
import * as fs from "node:fs";
import { extractTenderRequirements, generateBidNoBidAnalysis } from "../src/lib/bid-no-bid/llm";
import { gradeBidNoBidOutput } from "../src/lib/bid-no-bid/grade";

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

(async () => {
  console.log("=== Sprint 15 live-prompt validation (Bid/No-Bid / EU CIM / CSIM) ===");

  console.log("extract...");
  const t0 = Date.now();
  const requirements = await extractTenderRequirements(tenderText);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("generate (Sonnet, max_tokens=6000)...");
  const t1 = Date.now();
  const output = await generateBidNoBidAnalysis(
    { tenderText, companyContext, intakeSummary, applicantDocumentsContext: "", documentFileNames: [] },
    requirements,
  );
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`  recommendation: ${output.recommendation} · win_band: ${output.win_probability_band} · effort: ${output.effort_estimate_hours}h`);
  console.log(`  fit_reasoning: ${output.fit_reasoning.length} items, gaps: ${output.gap_analysis.length}, red_flags: ${output.red_flags.length}`);

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint15-bid-no-bid-live-cim.json";
  fs.writeFileSync(outPath, JSON.stringify({ requirements, output }, null, 2));
  console.log(`\nWrote: ${outPath}`);

  console.log("\n--- Grading with the new Bid/No-Bid judge ---");
  const grade = await gradeBidNoBidOutput({
    output,
    requirements,
    companyContext,
    tenderTextExcerpt: tenderText.slice(0, 6000),
  });
  console.log(`Grade: ${grade.score_0_10}/10`);
  console.log(`  specificity=${grade.breakdown.specificity} evidence=${grade.breakdown.evidence_anchoring} complete=${grade.breakdown.completeness} calibration=${grade.breakdown.recommendation_calibration} action=${grade.breakdown.actionability}`);
  for (const r of grade.rationale) console.log(`  - ${r}`);

  const gradeOut = {
    panel_id: "SPRINT15_BIDNOBID",
    source: outPath,
    note: "Sprint 15 — Bid/No-Bid output-quality grader. CSIM / EuropeAid 185831 Lot 3 anchor.",
    grade,
  };
  fs.writeFileSync("outputs/paid-services-validation/grades/SPRINT15_BIDNOBID.json", JSON.stringify(gradeOut, null, 2));
  console.log("\nWrote grade: outputs/paid-services-validation/grades/SPRINT15_BIDNOBID.json");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
