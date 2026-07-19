import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPortalCompanionView,
  normalizePortalCompanion,
  togglePortalConfirmation,
} from "../src/lib/tender-workspace/companion";
import type { WizardDraftState } from "../src/lib/submissions/types";
import type { TenderPackState } from "../src/lib/tender-workspace/types";

const whoTender: NonNullable<WizardDraftState["tender"]> = {
  title: "WHO RFP verification",
  agency: "World Health Organization",
  sourceUrl: "https://example.org/who-rfp",
  portal: "WHO In-Tend supplier portal",
  portalOverride: false,
  due: "2026-08-30",
};

const pack: TenderPackState = {
  status: "ready",
  documents: [
    {
      vaultDocumentId: 7,
      name: "RFP-2026.pdf",
      role: "solicitation",
      source: "user_upload",
      extractionStatus: "extracted",
      charCount: 2_400,
      downloadUrl: "/api/dashboard/vault/7/download",
    },
  ],
};

function readinessChecks() {
  const initial = buildPortalCompanionView(whoTender, pack, { confirmed: [] });
  assert.equal(initial.complete, 4);
  assert.equal(initial.total, 7);
  assert.equal(initial.nextAction.kind, "portal");

  let companion = togglePortalConfirmation({ confirmed: [] }, "portal_access", true, "2026-07-19T10:00:00.000Z");
  let view = buildPortalCompanionView(whoTender, pack, companion);
  assert.equal(view.nextAction.kind, "confirm_latest");

  companion = togglePortalConfirmation(companion, "latest_documents", true, "2026-07-19T10:01:00.000Z");
  companion = togglePortalConfirmation(companion, "deadline_channel", true, "2026-07-19T10:02:00.000Z");
  view = buildPortalCompanionView(whoTender, pack, companion);
  assert.equal(view.complete, 7);
  assert.equal(view.pct, 100);
  assert.equal(view.nextAction.kind, "ready");
}

function fallbackChecks() {
  const unknown = buildPortalCompanionView(
    { ...whoTender, agency: "Unknown Development Fund", portal: null },
    pack,
    { confirmed: ["portal_access"] },
  );
  assert.equal(unknown.items.find((item) => item.id === "submission_route")?.complete, false);
  assert.equal(unknown.nextAction.kind, "route");

  const manualEmail = buildPortalCompanionView(
    {
      ...whoTender,
      agency: "Unknown Development Fund",
      portal: "Email address named in the notice",
      portalOverride: true,
      portalUrl: null,
    },
    pack,
    { confirmed: ["portal_access"] },
  );
  assert.equal(manualEmail.items.find((item) => item.id === "submission_route")?.complete, true);

  const unsafeNotice = buildPortalCompanionView(
    { ...whoTender, sourceUrl: "javascript:alert(1)" },
    pack,
    { confirmed: [] },
  );
  assert.equal(unsafeNotice.items.find((item) => item.id === "official_notice")?.complete, false);
  assert.equal(unsafeNotice.nextAction.kind, "notice");
}

function normalizationChecks() {
  const normalized = normalizePortalCompanion({
    confirmed: ["portal_access", "portal_access", "not-real"],
    portalOpenedAt: "not-a-date",
    updatedAt: "2026-07-19T10:00:00Z",
  } as unknown as Parameters<typeof normalizePortalCompanion>[0]);
  assert.deepEqual(normalized.confirmed, ["portal_access"]);
  assert.equal(normalized.portalOpenedAt, null);
  assert.equal(normalized.updatedAt, "2026-07-19T10:00:00.000Z");
}

async function staticContinuityChecks() {
  const draftRoute = await readFile("src/app/api/dashboard/submission-drafts/[type]/route.ts", "utf8");
  const orderRoute = await readFile("src/app/api/dashboard/submission-orders/route.ts", "utf8");
  const audit = await readFile("src/lib/submissions/audit.ts", "utf8");
  const panel = await readFile("src/components/workbench/submissions/TenderPackPanel.tsx", "utf8");

  assert.match(draftRoute, /normalizePortalCompanion/);
  assert.match(orderRoute, /normalizePortalCompanion/);
  assert.match(audit, /portalCompanion: draft\.portalCompanion/);
  assert.match(panel, /Open portal beside TenderPath/);
  assert.match(panel, /opened\.opener = null/);
  assert.match(panel, /never receives the credentials|never asks for or stores your supplier-portal password/i);
}

async function main() {
  readinessChecks();
  fallbackChecks();
  normalizationChecks();
  await staticContinuityChecks();
  console.log("Sprint 2 portal-companion smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
