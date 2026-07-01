/**
 * Pure-logic smoke test for the prospect signal classifiers (P0.3). No DB.
 * Run: npx tsx scripts/prospect-signals-smoke.ts
 *
 * Guards the durable honesty invariants: thin evidence defaults to Mixed,
 * Constrained is never emitted without a concrete basis, contestability is
 * orthogonal to fit, and the public verdict never returns a blunt "skip".
 */

import { classifyContestability } from "../src/lib/tenders/contestability";
import { buildProspectVerdict, fitTierFromScore, fitTierFromBand } from "../src/lib/network/prospect-verdict";
import { annotateProspectTender } from "../src/lib/network/prospect-signals";
import { valueBand } from "../src/lib/calibration/store";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

console.log("contestability — conservative defaults");
{
  const thin = classifyContestability({ title: "Provision of assorted supplies", description: null });
  check("bland notice → Mixed", thin.band === "Mixed");
  check("bland notice → thinEvidence flagged", thin.thinEvidence === true);

  const incumbent = classifyContestability({ title: "Re-advertisement: services (incumbent may re-apply)" });
  check("incumbent language → Constrained", incumbent.band === "Constrained");
  check("Constrained always carries a basis", incumbent.band !== "Constrained" || incumbent.basis.length > 0);

  const open = classifyContestability({ title: "Open International Competitive Bidding for medical equipment" });
  check("open ICB language → Open", open.band === "Open");

  const rfq = classifyContestability({ title: "Supply of office furniture", opportunityType: "RFQ" });
  check("RFQ goods → Open", rfq.band === "Open");

  const prequal = classifyContestability({ title: "Expression of Interest — consultancy roster" });
  check("EOI/pre-qual → Mixed with basis", prequal.band === "Mixed" && prequal.basis.length > 0);

  const veryTight = classifyContestability({ title: "Supply of vehicles", registrationRisk: "very-tight" });
  check("very-tight registration → Constrained with basis", veryTight.band === "Constrained" && veryTight.basis.length > 0);

  // Invariant: no path yields Constrained with an empty basis.
  const samples = [thin, incumbent, open, rfq, prequal, veryTight];
  check("INVARIANT: Constrained ⇒ non-empty basis", samples.every((s) => s.band !== "Constrained" || s.basis.length > 0));
}

console.log("verdict — fit mapping + dampeners");
{
  check("score 90 → excellent", fitTierFromScore(90) === "excellent");
  check("score 60 → marginal", fitTierFromScore(60) === "marginal");
  check("band Strong fit → strong", fitTierFromBand("Strong fit") === "strong");

  const strongOpen = buildProspectVerdict({ fitTier: "excellent", registrationRisk: "none", contestabilityBand: "Open" });
  check("excellent + open → pursue/strong", strongOpen.recommendation === "pursue" && strongOpen.confidence === "strong");

  const strongButTight = buildProspectVerdict({ fitTier: "excellent", registrationRisk: "very-tight", contestabilityBand: "Open" });
  check("very-tight pulls pursue → prepare", strongButTight.recommendation === "prepare");

  const strongButConstrained = buildProspectVerdict({ fitTier: "excellent", registrationRisk: "none", contestabilityBand: "Constrained" });
  check("Constrained pulls to monitor (orthogonal to fit)", strongButConstrained.recommendation === "monitor");

  const marginal = buildProspectVerdict({ fitTier: "marginal" });
  check("softest recommendation is monitor (never a blunt skip)", marginal.recommendation === "monitor");
  check("reasons capped at 3", strongButTight.reasons.length <= 3);
}

console.log("annotate — end-to-end wiring");
{
  const sig = annotateProspectTender({
    title: "Supply and delivery of laptops",
    agency: "UNHCR",
    deadline: new Date(Date.now() + 2 * 86_400_000).toISOString(), // 2 days out → very tight vs UNHCR lead band
    isUngm: true,
    fit: { kind: "band", band: "Excellent fit" },
  });
  check("UNHCR resolves the verified portal", sig.compliance.portalName.includes("UNHCR"));
  check("2-day UNHCR deadline → very-tight registration", sig.compliance.registrationRisk === "very-tight");
  check("tight window surfaces in verdict (not pursue)", sig.verdict.recommendation !== "pursue");
  check("isUngm carried into compliance", sig.compliance.isUngm === true && sig.compliance.ungmMinLevel === "basic");
}

console.log("valueBand — corpus bucketing");
{
  check("$40,000 → <50k", valueBand("$40,000") === "<50k");
  check("USD 120k → 50k-250k", valueBand("USD 120k") === "50k-250k");
  check("2.5M → >1m", valueBand("2.5M") === ">1m");
  check("blank → unknown", valueBand("") === "unknown");
  check("'Not specified' → unknown", valueBand("Not specified") === "unknown");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
