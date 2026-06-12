/* Pure-logic smoke for the submissions workflow core (no DB, no network).
 * Run: npx tsx scripts/submissions-smoke.ts
 * Exercises the audit gate math, the stage machine guards, and docContent —
 * the three pieces a UI walk can't prove deterministically. */

import { auditDraft, buildIntakeSummary, buildDeliverables, buildIntakeFields, PAY_GATE_PCT } from "../src/lib/submissions/audit";
import { flowFor } from "../src/lib/submissions/flows";
import { canTransition, opsNextStage } from "../src/lib/submissions/stages";
import { docContent } from "../src/lib/submissions/doc-content";
import { buildNudges } from "../src/lib/submissions/nudges";
import { EMPTY_DRAFT, type SubmissionOrder, type WizardDraftState } from "../src/lib/submissions/types";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail ?? "");
  }
}

/* ── 1 · audit gate ────────────────────────────────────────────────────── */
console.log("audit gate");
const rfq = flowFor("RFQ");

const empty: WizardDraftState = { ...EMPTY_DRAFT };
const a0 = auditDraft(rfq, empty);
check("empty draft cannot pay", !a0.canPay);
check("empty draft has open blockers (docs missing)", a0.openBlockers.length > 0);
check("tender counts as an item", a0.remaining.some((r) => r.key === "tender"));

const fullRfq: WizardDraftState = {
  ...EMPTY_DRAFT,
  tender: { title: "Supply of Office Furniture — Country Office", agency: "FAO Somalia", due: "2030-05-15" },
  fields: {
    quote_validity: "60 days (required minimum)",
    delivery_lead_time: "6 weeks from PO",
    incoterms: "DAP — Delivered at Place",
  },
  currency: "USD",
  lines: [
    { id: "l1", desc: "Executive desk", specRef: "§2.1", qty: 24, unit: "ea", unitPrice: 420 },
    { id: "l2", desc: "Task chair", specRef: "§2.2", qty: 48, unit: "ea", unitPrice: 185 },
  ],
  conformity: [{ id: "c1", requirement: "Lockable drawers", response: "comply", deviation: null }],
  declarations: ["accuracy", "sanctions", "conflict", "vat", "validity_hold"],
  refs: [],
  docs: [
    { docId: "company_registration", state: "attached", vaultDocumentId: 1 },
    { docId: "manufacturer_authorization", state: "acknowledged" },
  ],
  step: 3,
};
const a1 = auditDraft(rfq, fullRfq);
check(`complete RFQ ≥ ${PAY_GATE_PCT}% (got ${a1.pct}%)`, a1.pct >= PAY_GATE_PCT);
check("complete RFQ can pay", a1.canPay);
check("acknowledged blocker carries but doesn't block", a1.blockers.some((b) => b.state === "acknowledged") && a1.openBlockers.length === 0);

const withOpen = { ...fullRfq, docs: [{ docId: "company_registration", state: "missing" as const }] };
const a2 = auditDraft(rfq, withOpen);
check("open high-sev doc blocks payment", !a2.canPay && a2.openBlockers.some((b) => b.id === "company_registration"));

/* ── 2 · stage machine ─────────────────────────────────────────────────── */
console.log("stage machine");
check("ops: intake→drafting", canTransition("ops", "intake", "drafting"));
check("ops: qa→review", canTransition("ops", "qa", "review"));
check("ops: revisions→qa", canTransition("ops", "revisions", "qa"));
check("ops cannot approve (review→final)", !canTransition("ops", "review", "final"));
check("client: review→final", canTransition("client", "review", "final"));
check("client: review→revisions", canTransition("client", "review", "revisions"));
check("client: final→submitted", canTransition("client", "final", "submitted"));
check("client cannot skip qa (drafting→review)", !canTransition("client", "drafting", "review"));
check("opsNextStage(drafting)=qa", opsNextStage("drafting") === "qa");
check("opsNextStage(review)=null (with client)", opsNextStage("review") === null);

/* ── 3 · order snapshot + docContent ───────────────────────────────────── */
console.log("order snapshot + docContent");
const order: SubmissionOrder = {
  id: 7,
  ref: "TP-2007",
  userId: 1,
  workOrderId: 99,
  type: "RFQ",
  priceCents: 19900,
  currency: "usd",
  tender: fullRfq.tender!.title,
  agency: "FAO Somalia",
  source: null,
  portal: "UNGM e-submission",
  tenderId: null,
  pipelineItemId: null,
  due: "2030-05-15",
  value: null,
  fit: 71,
  stage: "review",
  pct: 100,
  round: 0,
  stageNote: "Draft pack ready for your review.",
  slaMins: 60,
  completeness: a1.pct,
  blockers: a1.blockers,
  intake: buildIntakeSummary(rfq, fullRfq),
  intakeFields: buildIntakeFields(fullRfq),
  deliverables: buildDeliverables(rfq).map((d) => ({ ...d, status: "ready" as const })),
  events: [],
  revisionNotes: null,
  amendments: [],
  qna: [],
  outcome: { state: "pending" },
  shepherd: { checked: [] },
  paidAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const summary = order.intake;
check("intake summary leads with format", summary[0]?.[0] === "Format" && summary[0][1].includes("RFQ"));
check(
  "quotation total computed (24×420 + 48×185 = 18,960)",
  summary.some(([k, v]) => k === "Quotation total" && v.includes("18,960")),
  summary,
);

const docs = docContent(order, "BrightPath Solutions Ltd");
check("RFQ yields 3 deliverable docs", docs.length === 3);
const lineDoc = docs[1];
const kvTotal = lineDoc.blocks.find((b) => b.b === "kv");
check("line schedule carries the total", JSON.stringify(kvTotal).includes("18,960"), kvTotal);
const sigCount = docs.flatMap((d) => d.blocks).filter((b) => b.b === "sig").length;
check("signature points are explicit (≥2 across the pack)", sigCount >= 2);
const declList = docs[2].blocks.find((b) => b.b === "list");
check("declarations render affirmed boxes", JSON.stringify(declList).includes("☑"));

/* ── 4 · nudges ────────────────────────────────────────────────────────── */
console.log("nudges");
const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const nudges = buildNudges([
  { ...order, stage: "review", due: soon },
  { ...order, id: 8, ref: "TP-2008", stage: "drafting" },
]);
check("review order yields a nudge", nudges.some((n) => n.kind === "review"));
check("≤4 days out escalates to urgent", nudges.find((n) => n.kind === "review")?.urgent === true);
check("drafting order yields no nudge (nothing waits on the client)", !nudges.some((n) => n.orderId === 8));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
