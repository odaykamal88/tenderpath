import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FLOWS,
  FLOW_GUARANTEE,
  PILOT_SLA_LABEL,
  PILOT_SLA_MINS,
} from "../src/lib/submissions/flows";
import { SUBMISSION_TYPES } from "../src/lib/workbench/pricing";
import { inferTenderDocumentRole } from "../src/lib/tender-workspace/documents";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function main() {
  assert.equal(PILOT_SLA_MINS, 1_440);
  assert.equal(PILOT_SLA_LABEL, "Within 1 business day");
  for (const flow of Object.values(FLOWS)) assert.equal(flow.sla, PILOT_SLA_LABEL);
  for (const flow of Object.values(FLOWS)) assert.doesNotMatch(flow.tagline, /win|shortlist|zero elimination/i);
  assert.match(FLOW_GUARANTEE, /Supplier omissions/);
  assert.match(FLOW_GUARANTEE, /award outcome/);
  for (const type of SUBMISSION_TYPES) assert.equal(type.turnaround, "1 business day");
  assert.equal(
    inferTenderDocumentRole("Annex C - RFPS TOR - Plant repair and biomed services - revised.docx"),
    "tor",
  );
  assert.equal(inferTenderDocumentRole("RFPS-DAN-503347 Amendment 1.pdf"), "amendment");
  assert.equal(inferTenderDocumentRole("Q & A.pdf"), "qa");

  const overview = await source("src/components/workbench/pages/OverviewPage.tsx");
  const pasteModal = await source("src/components/workbench/overlays/PasteModal.tsx");
  const pasteRoute = await source("src/app/api/dashboard/paste-analyze/route.ts");
  const requirementsServer = await source("src/lib/tender-workspace/requirements-server.ts");
  const submissions = await source("src/components/workbench/pages/SubmissionsPage.tsx");
  const wizardBlocks = await source("src/components/workbench/submissions/wizardBlocks.tsx");
  const docContent = await source("src/lib/submissions/doc-content.ts");
  const terms = await source("src/app/terms/page.tsx");
  const marketing = [
    await source("src/components/landing/Hero.tsx"),
    await source("src/components/landing/HowItWorks.tsx"),
    await source("src/components/landing/Features.tsx"),
    await source("src/components/landing/SocialProof.tsx"),
  ].join("\n");

  assert.match(overview, /Paste a tender/);
  assert.match(overview, /Build my company file/);
  assert.match(pasteRoute, /ANALYSIS_UNAVAILABLE/);
  assert.match(pasteRoute, /case_ref/);
  assert.match(pasteModal, /Continue with assisted review/);
  assert.match(pasteModal, /tp_sub_assisted_seed/);
  assert.doesNotMatch(pasteModal, /Modeled win odds/);
  assert.match(submissions, /tp_sub_assisted_seed/);
  assert.match(submissions, /within one business day after complete intake/i);
  assert.equal(FLOWS.RFP.steps.flatMap((step) => step.blocks ?? [])
    .filter((block) => block.kind === "criteria")
    .flatMap((block) => block.items)
    .some((item) => typeof item.pts === "number"), false);
  assert.doesNotMatch(FLOWS.RFP.blurb, /70%|30%/);
  assert.match(wizardBlocks, /weights added only from the published rubric/);
  assert.doesNotMatch(docContent, /Threshold: 70%/);
  assert.match(docContent, /Confirm against the solicitation/);
  assert.match(requirementsServer, /MODEL_TIMEOUT_MS = 35_000/);
  assert.match(requirementsServer, /claude-haiku-4-5-20251001/);
  assert.match(requirementsServer, /output_config/);
  assert.match(terms, /does not guarantee that you will be shortlisted or awarded/);
  assert.match(terms, /compliance error introduced by/);
  assert.doesNotMatch(marketing, /winning proposal|under an hour|start winning them/i);

  console.log("First-client pilot smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
