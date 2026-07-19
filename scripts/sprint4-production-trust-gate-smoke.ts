import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractDocumentText } from "../src/lib/documents/extract";
import { buildPortalCompanionView } from "../src/lib/tender-workspace/companion";
import { tenderPackStatus } from "../src/lib/tender-workspace/documents";
import { buildTenderRequirementsView } from "../src/lib/tender-workspace/requirements";
import type { WizardDraftState } from "../src/lib/submissions/types";
import type { TenderPackState } from "../src/lib/tender-workspace/types";

const tender: NonNullable<WizardDraftState["tender"]> = {
  title: "UNICEF services RFP",
  agency: "UNICEF",
  sourceUrl: "https://example.org/unicef-rfp",
  portal: "Email proposals to supply@example.org",
  portalOverride: true,
  portalUrl: null,
  due: "2026-08-30",
};

const partialPack: TenderPackState = {
  status: "partial",
  documents: [
    {
      vaultDocumentId: 41,
      name: "RFPS 503347.pdf",
      role: "solicitation",
      source: "user_upload",
      extractionStatus: "extracted",
      charCount: 8_500,
      downloadUrl: "/api/dashboard/vault/41/download",
    },
    {
      vaultDocumentId: 42,
      name: "RFPS-DAN-503347 Amendment 1.pdf",
      role: "amendment",
      source: "user_upload",
      extractionStatus: "failed",
      charCount: 0,
      downloadUrl: "/api/dashboard/vault/42/download",
    },
  ],
};

function truthChecks() {
  assert.equal(tenderPackStatus(partialPack.documents, true), "partial");
  const view = buildPortalCompanionView(tender, partialPack, {
    confirmed: ["portal_access", "latest_documents", "deadline_channel"],
  });
  const route = view.items.find((item) => item.id === "submission_route");
  assert.equal(route?.complete, true);
  assert.equal(route?.detail, "Email proposals to supply@example.org");
  assert.equal(view.items.find((item) => item.id === "latest_documents")?.complete, false);
  assert.match(view.nextAction.title, /amendment and Q&A readable/i);
  assert.match(buildTenderRequirementsView(partialPack, null).nextAction, /Amendment 1/i);
}

async function pdfRuntimeCheck() {
  const fixture = "tests/fixtures/un-tenders/unicef-RFPS-DAN-2021-503347/notice-146988/RFPS-DAN-503347 Amendment 1.pdf";
  const buffer = await readFile(fixture);
  const extraction = await extractDocumentText({
    buffer,
    mimeType: "application/pdf",
    fileName: fixture,
  });
  assert.equal(extraction.status, "extracted");
  assert.ok(extraction.charCount > 100, "UNICEF amendment should produce readable text");
}

async function staticTrustChecks() {
  const pollRoute = await readFile("src/app/api/assessment/[id]/route.ts", "utf8");
  const publicRoute = await readFile("src/app/api/assessment/public/route.ts", "utf8");
  const workbench = await readFile("src/components/workbench/WorkbenchProvider.tsx", "utf8");
  const uploadClient = await readFile("src/lib/vault/client-upload.ts", "utf8");
  const uploadRoute = await readFile("src/app/api/dashboard/vault/upload/route.ts", "utf8");
  const demoSession = await readFile("src/lib/assessment/demo-session.ts", "utf8");
  const config = await readFile("next.config.ts", "utf8");

  assert.match(pollRoute, /PUBLIC_ASSESSMENT_ERROR/);
  assert.match(publicRoute, /PUBLIC_ASSESSMENT_ERROR_CODE/);
  assert.doesNotMatch(workbench, /assessmentStatus === "computing" \|\| body\.assessmentStatus === "failed"/);
  assert.match(uploadClient, /SERVER_UPLOAD_LIMIT_BYTES/);
  assert.match(uploadClient, /uploadLargeFileDirectly/);
  assert.match(uploadClient, /UPLOAD_STALL_TIMEOUT_MS/);
  assert.match(uploadRoute, /vaultDocumentId/);
  assert.match(uploadRoute, /DOCUMENT_PROCESSING_FAILED/);
  assert.match(demoSession, /profile_source = 'unset'/);
  assert.match(demoSession, /mined_profile_facts = '\{\}'::jsonb/);
  assert.match(config, /pdf\.worker\.mjs/);
  assert.match(config, /"\/api\/dashboard\/vault\/upload": pdfJsRuntimeFiles/);
}

async function main() {
  truthChecks();
  await pdfRuntimeCheck();
  await staticTrustChecks();
  console.log("Sprint 4 production trust-gate smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
