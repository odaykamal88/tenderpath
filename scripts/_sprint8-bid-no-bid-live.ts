/**
 * Sprint 8 live-prompt validation for Fix 2 + Fix 4 on the Bid/No-Bid pipeline.
 *
 * Goal: call the production extractTenderRequirements → generateBidNoBidAnalysis
 * pipeline against a real call and verify that the new schema fields
 * (tender_type, tender_type_note, eligibility_findings with evidence_label,
 * commercial_terms, required_documents priority split, evidence_label on gaps)
 * actually populate.
 *
 * Usage: npx tsx scripts/_sprint8-bid-no-bid-live.ts
 *
 * Loads ANTHROPIC_API_KEY from /Users/odaykamal/Desktop/TENDERPATH/.env.local
 * since the worktree itself does not have an .env.local.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { extractTenderRequirements, generateBidNoBidAnalysis } from "../src/lib/bid-no-bid/llm";

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
Type: Syrian-led nonprofit / media-development consortium
Founded: 2018
Headcount: ~22 staff, ~40 contributors
Core capabilities:
- Independent journalism training and protection across Syrian governorates
- Editorial coaching for Syrian newsrooms in exile
- Network of vetted Syrian journalists, photographers, and fact-checkers
- Multi-platform content production (Arabic + Kurdish)
- Information-integrity programming, anti-disinformation work
- Donor reporting against EU and US humanitarian-frameworks
Operational base: Istanbul + field nodes in Gaziantep, Erbil, Qamishli
Past donors: SIDA, Free Press Unlimited, Internews (subaward)
Past consortium roles: lead applicant (small EU project, 2023), co-applicant (USAID, 2022)
Past performance: 4 sub-million-EUR grants delivered on time; no audit qualifications
Co-financing capacity: Up to ~5% from own reserves and SIDA bridge financing
PADOR registration: in progress
Languages: Arabic, English, Kurdish, Turkish
Audit: KPMG Türkiye, last audit clean (2024)
Bank: Akbank (TRY + EUR accounts)`;

const intakeSummary = `Applicant: CSIM. Targeting Lot 3 of EuropeAid 185831 (DD-ACT-SY).
Confidence: We have the EU call documents (guidelines + corrigendum + clarifications)
and the applicant's concept-note draft, identification form, declaration of honour,
PADOR draft, and strategic deck. Lead applicant role intended; one INGO co-applicant
already in soft conversation. JV/subcontract appetite: yes, EU-eligible partner only.`;

function flag(ok: boolean, label: string, extra = "") {
  return `${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`;
}

(async () => {
  console.log("=== Sprint 8 live-prompt validation ===");
  console.log("Tender text size:", tenderText.length, "chars");
  console.log("Calling extractTenderRequirements (Haiku)...");
  const t0 = Date.now();
  const requirements = await extractTenderRequirements(tenderText);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("Calling generateBidNoBidAnalysis (Sonnet)...");
  const t1 = Date.now();
  const output = await generateBidNoBidAnalysis(
    { tenderText, companyContext, intakeSummary, applicantDocumentsContext: "", documentFileNames: [] },
    requirements,
  );
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  fs.mkdirSync("outputs/paid-services-validation", { recursive: true });
  const outPath = "outputs/paid-services-validation/sprint8-bid-no-bid-live-cim.json";
  fs.writeFileSync(outPath, JSON.stringify({ requirements, output }, null, 2));
  console.log("Wrote:", outPath);

  console.log("\n=== Fix 2/4 field checklist ===");
  // Fix 2 fields
  console.log(flag(!!output.tender_type, "tender_type", output.tender_type || ""));
  console.log(flag(!!output.tender_type_note && output.tender_type_note.length > 10, "tender_type_note", output.tender_type_note?.slice(0, 90) || ""));

  const elig = output.eligibility_findings || [];
  console.log(flag(elig.length >= 3, `eligibility_findings count`, `n=${elig.length}`));
  const eligActions = new Set(elig.map((e) => e.recommended_action));
  console.log(flag(eligActions.size >= 2, "eligibility actions diverse", Array.from(eligActions).join("/")));
  const eligLabelled = elig.filter((e) => !!e.evidence_label).length;
  console.log(flag(eligLabelled === elig.length && elig.length > 0, "eligibility findings labelled", `${eligLabelled}/${elig.length}`));

  const ct = output.commercial_terms;
  const ctPopulated = ct ? Object.values(ct).filter((v) => v !== null && (Array.isArray(v) ? v.length > 0 : true)).length : 0;
  console.log(flag(ctPopulated >= 3, "commercial_terms populated", `${ctPopulated} non-null fields`));

  const docs = output.required_documents || [];
  const mand = docs.filter((d) => d.priority === "mandatory").length;
  const rec = docs.filter((d) => d.priority === "recommended").length;
  console.log(flag(mand > 0 && rec > 0, "required_documents split mandatory vs recommended", `${mand} mandatory / ${rec} recommended / ${docs.length} total`));

  // Fix 4 fields
  const gaps = output.gap_analysis || [];
  const gapLabelled = gaps.filter((g) => !!g.evidence_label).length;
  console.log(flag(gapLabelled === gaps.length && gaps.length > 0, "gaps labelled with evidence_label", `${gapLabelled}/${gaps.length}`));
  const labelDist = gaps.reduce<Record<string, number>>((acc, g) => { const k = g.evidence_label || "none"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  console.log("  gap label distribution:", JSON.stringify(labelDist));

  console.log("\n=== Headline result ===");
  console.log("recommendation:", output.recommendation);
  console.log("win_probability_band:", output.win_probability_band);
  console.log("headline:", output.headline);

  console.log("\n=== Sample eligibility finding ===");
  if (elig[0]) console.log(JSON.stringify(elig[0], null, 2));

  console.log("\n=== Sample required document ===");
  if (docs[0]) console.log(JSON.stringify(docs[0], null, 2));
})().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
