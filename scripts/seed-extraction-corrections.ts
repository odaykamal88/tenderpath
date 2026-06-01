/**
 * scripts/seed-extraction-corrections.ts — Loop 4 hypothesis seed.
 *
 * The product is pre-launch, so there isn't real correction data yet. These are
 * HYPOTHESES (Claude's best guesses at recurring UN-tender extraction mistakes)
 * to validate the mechanism end-to-end. They land as `captured` — they do NOT
 * affect extraction until a human reviews and PROMOTES them at /admin/feedback.
 * The founder refines/replaces them with real corrections as volume arrives.
 *
 * Idempotent: clears prior seed-hypothesis corrections first, so re-running
 * doesn't duplicate. Usage: npx tsx scripts/seed-extraction-corrections.ts
 */

import { config } from "dotenv";
import { sql } from "@/lib/db";
import { recordExtractionCorrection, ensureFeedbackStore } from "@/lib/feedback/store";

config({ path: ".env.local" });

const SEEDS: Array<{ agency: string | null; detail: string }> = [
  {
    agency: "UNICEF",
    detail:
      "UNICEF RFPs frequently double-weight the technical methodology / understanding-of-TOR criterion — verify the weight against the published evaluation table rather than assuming equal weighting.",
  },
  {
    agency: "UNOPS",
    detail:
      "UNOPS RFQs/ITBs often place mandatory eligibility and completeness requirements in Annex C / the per-lot returnable forms, not the main solicitation body — scan annexes for disqualifiers.",
  },
  {
    agency: "WFP",
    detail:
      "WFP evaluations commonly express criterion weights as percentages, not points — normalize them to the rubric's maxScore so the totals stay consistent.",
  },
  {
    agency: null,
    detail:
      "Treat 'shall'/'must' requirements as mandatory (disqualifier kind) and 'should'/'preferred' as scoring deductions — do not classify a 'should' as a disqualifier.",
  },
];

async function main(): Promise<void> {
  await ensureFeedbackStore();
  await sql`DELETE FROM feedback_records WHERE kind = 'extraction_correction' AND payload->>'category' = 'seed_hypothesis'`;
  for (const s of SEEDS) {
    const id = await recordExtractionCorrection({ agency: s.agency, detail: s.detail, category: "seed_hypothesis", capturedFrom: "admin" });
    console.log(`  seeded ${s.agency ?? "(global)"} -> id ${id}`);
  }
  console.log(`\nSeeded ${SEEDS.length} HYPOTHESIS corrections as CAPTURED. Review + promote the good ones at /admin/feedback; only promoted ones feed the extractor.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("seed failed:", e);
    process.exit(1);
  });
