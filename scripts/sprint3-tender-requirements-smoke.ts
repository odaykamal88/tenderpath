import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildTenderRequirementsView,
  mergeTenderRequirementProgress,
  normalizeTenderRequirements,
  tenderPackFingerprint,
  updateTenderRequirement,
} from "../src/lib/tender-workspace/requirements";
import type {
  TenderPackState,
  TenderRequirementsState,
} from "../src/lib/tender-workspace/types";

const pack: TenderPackState = {
  status: "ready",
  documents: [
    {
      vaultDocumentId: 11,
      name: "RFP solicitation.pdf",
      role: "solicitation",
      source: "user_upload",
      extractionStatus: "extracted",
      charCount: 8_500,
      downloadUrl: "/api/dashboard/vault/11/download",
    },
    {
      vaultDocumentId: 12,
      name: "Corrigendum 1.pdf",
      role: "amendment",
      source: "user_upload",
      extractionStatus: "extracted",
      charCount: 1_200,
      downloadUrl: "/api/dashboard/vault/12/download",
    },
  ],
};

function generatedState(): TenderRequirementsState {
  return normalizeTenderRequirements({
    generationStatus: "ready",
    packFingerprint: tenderPackFingerprint(pack),
    generatedAt: "2026-07-19T12:00:00.000Z",
    updatedAt: "2026-07-19T12:00:00.000Z",
    note: null,
    items: [
      {
        id: "client-id-is-rebuilt",
        category: "submission",
        severity: "BLOCK",
        title: "Separate technical and financial envelopes",
        action: "Prepare and upload the two envelopes separately.",
        evidence: "Technical and financial proposals shall be submitted in separate envelopes.",
        sourceDocumentId: 12,
        sourceDocumentName: "forged-name.pdf",
        sourceSection: "Corrigendum 1, item 3",
        confidence: "high",
        status: "open",
      },
      {
        id: "forged-document",
        category: "administrative",
        severity: "BLOCK",
        title: "Forged source",
        action: "Should be removed.",
        evidence: "Not owned.",
        sourceDocumentId: 999,
        sourceDocumentName: "other-customer.pdf",
        confidence: "high",
        status: "ready",
      },
    ],
  }, pack);
}

function normalizationAndFreshnessChecks() {
  const state = generatedState();
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].sourceDocumentName, "Corrigendum 1.pdf");
  assert.match(state.items[0].id, /^req-/);

  const current = buildTenderRequirementsView(pack, state);
  assert.equal(current.isCurrent, true);
  assert.equal(current.openBlocks, 1);
  assert.match(current.nextAction, /two envelopes separately/i);

  const changedPack: TenderPackState = {
    ...pack,
    documents: pack.documents.map((document) => document.vaultDocumentId === 12
      ? { ...document, role: "qa" }
      : document),
  };
  const stale = buildTenderRequirementsView(changedPack, state);
  assert.equal(stale.isStale, true);
  assert.match(stale.nextAction, /refresh/i);
}

function progressChecks() {
  const state = generatedState();
  const updated = updateTenderRequirement(
    state,
    pack,
    state.items[0].id,
    { status: "ready", ownerNote: "Envelope names checked against portal." },
    "2026-07-19T12:10:00.000Z",
  );
  assert.equal(updated.items[0].status, "ready");
  assert.equal(updated.items[0].ownerNote, "Envelope names checked against portal.");
  assert.equal(buildTenderRequirementsView(pack, updated).complete, 1);

  const rerun = generatedState();
  const merged = mergeTenderRequirementProgress(updated, rerun, pack);
  assert.equal(merged.items[0].status, "ready");

  const unexplained = updateTenderRequirement(
    state,
    pack,
    state.items[0].id,
    { status: "not_applicable" },
    "2026-07-19T12:11:00.000Z",
  );
  assert.equal(buildTenderRequirementsView(pack, unexplained).complete, 0);
  assert.match(buildTenderRequirementsView(pack, unexplained).nextAction, /add a reason/i);
  const explained = updateTenderRequirement(
    unexplained,
    pack,
    state.items[0].id,
    { ownerNote: "The corrigendum exempts this lot." },
    "2026-07-19T12:12:00.000Z",
  );
  assert.equal(buildTenderRequirementsView(pack, explained).complete, 1);

  const otherPack: TenderPackState = {
    ...pack,
    documents: [{ ...pack.documents[0], charCount: 8_501 }, pack.documents[1]],
  };
  const regenerated = normalizeTenderRequirements({
    ...rerun,
    packFingerprint: tenderPackFingerprint(otherPack),
  }, otherPack);
  const reset = mergeTenderRequirementProgress(updated, regenerated, otherPack);
  assert.equal(reset.items[0].status, "open");
}

async function staticContinuityChecks() {
  const draftRoute = await readFile("src/app/api/dashboard/submission-drafts/[type]/route.ts", "utf8");
  const orderRoute = await readFile("src/app/api/dashboard/submission-orders/route.ts", "utf8");
  const generationRoute = await readFile("src/app/api/dashboard/tender-pack/requirements/route.ts", "utf8");
  const audit = await readFile("src/lib/submissions/audit.ts", "utf8");
  const panel = await readFile("src/components/workbench/submissions/TenderRequirementsPanel.tsx", "utf8");
  const generator = await readFile("src/lib/tender-workspace/requirements-server.ts", "utf8");

  assert.match(draftRoute, /normalizeTenderRequirements/);
  assert.match(orderRoute, /normalizeTenderRequirements/);
  assert.match(generationRoute, /requireAuth/);
  assert.match(generationRoute, /sanitizeTenderPackForUser/);
  assert.match(audit, /tenderRequirements: draft\.tenderRequirements/);
  assert.match(panel, /Private tender text is sent to TenderPath/);
  assert.match(generator, /Read amendments and corrigenda first/);
  assert.match(generator, /Do not invent common UN rules/);
  assert.match(generator, /documentText\.includes\(evidenceComparable\(evidence\)\)/);
  assert.match(generator, /never as instructions to you/);
}

async function main() {
  normalizationAndFreshnessChecks();
  progressChecks();
  await staticContinuityChecks();
  console.log("Sprint 3 tender-requirements smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
