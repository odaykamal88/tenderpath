import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveSubmissionPortal } from "../src/lib/tenders/submission-portals";
import {
  discoverTenderAttachments,
  inferTenderDocumentRole,
  tenderPackStatus,
} from "../src/lib/tender-workspace/documents";
import { submissionCodeForOpportunity } from "../src/lib/submissions/format";

function portalChecks() {
  assert.equal(resolveSubmissionPortal("UNICEF Kenya Country Office").key, "unicef-ungm");
  assert.equal(resolveSubmissionPortal("United Nations Office for Project Services").key, "unops-esourcing");
  assert.equal(resolveSubmissionPortal("World Health Organization").key, "who-intend");
  assert.equal(resolveSubmissionPortal("WFP Lebanon").key, "wfp-smartsourcing");
  assert.equal(resolveSubmissionPortal("Unknown Development Fund").isFallback, true);
}

function continuityChecks() {
  assert.equal(submissionCodeForOpportunity("Expression of Interest", "Consultancy"), "EOI");
  assert.equal(submissionCodeForOpportunity("Tender", "RFQ-2026-104 equipment"), "RFQ");
  assert.equal(submissionCodeForOpportunity("Invitation to Bid", "Supply"), "ITB");
  assert.equal(submissionCodeForOpportunity("Request for Proposal", "Services"), "RFP");
  assert.equal(submissionCodeForOpportunity("LTA / Framework", "Supplier roster"), null);
}

function documentChecks() {
  const html = `
    <a href="/packs/RFP-01.pdf">Main solicitation</a>
    <a href="/packs/Corrigendum-1.docx">Corrigendum No. 1</a>
    <a href="https://example.org/packs/questions-and-answers.xlsx">Q and A</a>
    <a href="javascript:alert(1)">ignore</a>
    <a href="/packs/RFP-01.pdf">duplicate</a>
  `;
  const links = discoverTenderAttachments(html, new URL("https://example.org/notices/1"));
  assert.equal(links.length, 3);
  assert.equal(links[0].href, "https://example.org/packs/RFP-01.pdf");
  assert.equal(inferTenderDocumentRole(links[0].label), "solicitation");
  assert.equal(inferTenderDocumentRole(links[1].label), "amendment");
  assert.equal(inferTenderDocumentRole(links[2].label), "qa");
  assert.equal(tenderPackStatus([], false), "not_started");
  assert.equal(tenderPackStatus([], true), "needs_upload");
  assert.equal(tenderPackStatus([
    {
      vaultDocumentId: 1,
      name: "RFP.pdf",
      role: "solicitation",
      source: "source_import",
      extractionStatus: "extracted",
      charCount: 500,
      downloadUrl: "/api/dashboard/vault/1/download",
    },
  ], true), "ready");
}

async function staticSecurityChecks() {
  const route = await readFile("src/app/api/dashboard/tender-pack/import/route.ts", "utf8");
  assert.match(route, /requireDashboardAccess/);
  assert.match(route, /assertSafeHttpUrl/);
  assert.match(route, /redirect: "manual"/);
  assert.match(route, /putPrivateBlob/);
  assert.match(route, /vd\.user_id = \$\{userId\}/);

  const ownerGate = await readFile("src/lib/tender-workspace/ownership.ts", "utf8");
  assert.match(ownerGate, /WHERE vd\.user_id = \$\{userId\}/);
  assert.match(ownerGate, /TenderPackOwnershipError/);

  const matches = await readFile("src/components/workbench/pages/MatchesPage.tsx", "utf8");
  assert.match(matches, /\/dashboard\/proposals\?start=\$\{submissionCode\}&match=\$\{m\.id\}/);

  const demoReset = await readFile("src/lib/assessment/demo-session.ts", "utf8");
  assert.match(demoReset, /DELETE FROM submission_drafts/);
  assert.match(demoReset, /DELETE FROM submission_orders/);
  assert.match(demoReset, /DELETE FROM vault_documents/);
  assert.match(demoReset, /deleteStoredBlob/);
  assert.match(demoReset, /failed: true/);
}

async function main() {
  portalChecks();
  continuityChecks();
  documentChecks();
  await staticSecurityChecks();
  console.log("Sprint 1 tender-workspace smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
