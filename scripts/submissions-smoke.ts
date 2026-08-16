/* Pure-logic smoke for the submissions workflow core (no DB, no network).
 * Run: npx tsx scripts/submissions-smoke.ts
 * Exercises the prototype-faithful audit math, the stage machine guards,
 * docContent and the nudges — the pieces a UI walk can't prove
 * deterministically. */

import { auditDraft, buildIntakeSummary, buildDeliverables, buildIntakeFields, PAY_GATE_PCT } from "../src/lib/submissions/audit";
import { flowFor, shepherdSteps } from "../src/lib/submissions/flows";
import { canTransition, opsNextStage } from "../src/lib/submissions/stages";
import { docContent } from "../src/lib/submissions/doc-content";
import { buildNudges } from "../src/lib/submissions/nudges";
import { tenderPackTag } from "../src/lib/tender-workspace/documents";
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

/* ── 1 · audit gate (prototype semantics) ──────────────────────────────── */
console.log("audit gate");
const rfq = flowFor("RFQ");

const empty: WizardDraftState = { ...EMPTY_DRAFT };
const a0 = auditDraft(rfq, empty);
check("empty draft cannot pay", !a0.canPay);
check("ungm blocker open on an empty draft", a0.open.some((b) => b.id === "ungm"));
check(
  "regular missing docs do NOT appear as blockers (only curated ones gate)",
  a0.blockers.every((b) => ["ungm"].includes(b.id)),
  a0.blockers,
);
check("notice-specific commercial fields never count before the user confirms them", a0.have === 0, { have: a0.have });

const fullRfq: WizardDraftState = {
  ...EMPTY_DRAFT,
  tender: { title: "Supply of Office Furniture — Country Office", agency: "FAO Somalia", portal: "UNGM e-submission", due: "2030-05-15" },
  fields: {
    validity: "60 days (required minimum)",
    delivery: "6 weeks from PO",
    incoterms: "DAP — Delivered at Place (most UN RFQs)",
    tax: "VAT included as required by the RFQ",
    warranty: "24 months on all items",
    specs: "Fully compliant with all specs",
  },
  currency: "USD",
  lines: [
    { id: "l1", desc: "Executive desk", specRef: "§2.1", qty: 24, unit: "ea", unitPrice: 420 },
    { id: "l2", desc: "Task chair", specRef: "§2.2", qty: 48, unit: "ea", unitPrice: 185 },
  ],
  conformity: [],
  declarations: ["compliance:0", "compliance:1", "compliance:2", "compliance:3"],
  refs: [],
  docs: [
    { docId: "inc", state: "attached", vaultDocumentId: 1 },
    { docId: "tax", state: "attached", vaultDocumentId: 2 },
    { docId: "cat", state: "requested", ask: "sales@supplier.com" },
    { docId: "warr", state: "drafted" },
    { docId: "ungm", state: "resolved" },
  ],
  step: 3,
};
const a1 = auditDraft(rfq, fullRfq);
check(`complete RFQ ≥ ${PAY_GATE_PCT}% (got ${a1.pct}%)`, a1.pct >= PAY_GATE_PCT);
check("complete RFQ can pay", a1.canPay);
check("resolved ungm blocker carries as resolved", a1.blockers.some((b) => b.id === "ungm" && b.state === "resolved"));

const ackUngm: WizardDraftState = {
  ...fullRfq,
  docs: fullRfq.docs.map((d) => (d.docId === "ungm" ? { ...d, state: "ack" as const } : d)),
};
const a2 = auditDraft(rfq, ackUngm);
check("acknowledged blocker passes the gate but carries", a2.canPay && a2.blockers.some((b) => b.id === "ungm" && b.state === "acknowledged"));

const openUngm: WizardDraftState = {
  ...fullRfq,
  docs: fullRfq.docs.filter((d) => d.docId !== "ungm"),
};
const a3 = auditDraft(rfq, openUngm);
check("open curated blocker blocks payment", !a3.canPay && a3.open.some((b) => b.id === "ungm"));

// showIf: the deviations textarea only counts when specs = declared deviations.
const withDeviations: WizardDraftState = {
  ...fullRfq,
  fields: { ...fullRfq.fields, specs: "Compliant with declared deviations" },
};
const a4 = auditDraft(rfq, withDeviations);
check("showIf field appears in the count when its condition holds", a4.need === a1.need + 1, { before: a1.need, after: a4.need });

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

/* ── 3 · shepherd builder ──────────────────────────────────────────────── */
console.log("shepherd");
const itbSteps = shepherdSteps("ITB", "UNGM e-submission", "2030-05-12");
const eoiSteps = shepherdSteps("EOI", null, null);
check("two-envelope formats get separate technical/financial upload steps", itbSteps.some((s) => s.id === "upload-tech") && itbSteps.some((s) => s.id === "upload-fin"));
check("single-envelope formats get one upload step", eoiSteps.some((s) => s.id === "upload") && !eoiSteps.some((s) => s.id === "upload-fin"));
check("portal name lands in the login step", itbSteps[0].t.includes("UNGM e-submission"));

/* ── 4 · order snapshot + docContent ───────────────────────────────────── */
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
  stageNote: "Draft pack ready for your review",
  slaMins: 60,
  completeness: a1.pct,
  blockers: a1.blockers,
  intake: buildIntakeSummary(rfq, fullRfq),
  intakeFields: buildIntakeFields(fullRfq),
  deliverables: buildDeliverables(rfq).map((d) => ({ ...d, status: "ready" as const })),
  events: [],
  artifactVersions: [],
  revisionNotes: null,
  amendments: [],
  qna: [],
  outcome: { state: "pending" },
  shepherd: { checked: [] },
  generationStatus: "not_started",
  generatedProse: null,
  paidAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const summary = order.intake;
check(
  "intake summary carries the quote total (24×420 + 48×185 = 18,960)",
  summary.some(([k, v]) => k === "Quote total" && v.includes("18,960")),
  summary,
);
check("intake summary carries validity + delivery", summary.some(([k]) => k === "Validity") && summary.some(([k]) => k === "Delivery"));

const company = { name: "BrightPath Solutions Ltd", signatory: "Amir Osman" };
const docs = docContent(order, company);
check("RFQ yields 3 deliverable docs", docs.length === 3);
const schedule = docs[1];
const table = schedule.blocks.find((b) => b.b === "table");
check("line schedule table carries the user's real lines + total foot", JSON.stringify(table).includes("18,960"), table);
const sigCount = docs.flatMap((d) => d.blocks).filter((b) => b.b === "sig").length;
check("signature points are explicit (≥2 across the pack)", sigCount >= 2);
check("sig blocks carry the signatory name", docs.flatMap((d) => d.blocks).some((b) => b.b === "sig" && b.name === "Amir Osman"));
check(
  "quotation form carries the notice-specific tax treatment without inventing an exemption",
  JSON.stringify(docs[0].blocks).includes("VAT included as required by the RFQ")
    && !JSON.stringify(docs[0].blocks).includes("tax-exempt"),
);

/* ── 4b · generated prose slots + buyer-safe prose ─────────────────────── */
console.log("generated prose");

// No prose → the deterministic template still delivers (graceful degradation).
check(
  "without generation, the offer statement falls back to the template",
  JSON.stringify(docs[0].blocks).includes("We, the undersigned, offer to supply"),
);

const withProse = docContent(order, company, {
  slots: {
    rfq_offer_statement: "BrightPath Solutions Ltd offers to supply the quoted items against schedule RFQ-88.",
    rfq_compliance_statement: "All offered items meet the published specification without deviation.",
  },
  claims: [{ text: "Items meet specification", provenance: "evidenced" }],
  gaps: [],
  model: "test",
  generatedAt: new Date().toISOString(),
});
check(
  "written prose replaces the templated offer statement",
  JSON.stringify(withProse[0].blocks).includes("against schedule RFQ-88")
    && !JSON.stringify(withProse[0].blocks).includes("We, the undersigned, offer to supply"),
);
check(
  "a slot the model skipped still falls back rather than blanking the document",
  JSON.stringify(
    docContent(order, company, {
      slots: { rfq_offer_statement: "Short offer." },
      claims: [],
      gaps: [],
      model: "test",
      generatedAt: new Date().toISOString(),
    })[2].blocks,
  ).includes("fully compliant with the technical specifications"),
);

// Buyer-facing documents must never disclose the platform or an unfinished
// internal step — `note` blocks render into the exported PDF and DOCX.
const allProse = [docs, withProse]
  .flat()
  .flatMap((d) => d.blocks)
  .map((b) => JSON.stringify(b))
  .join(" ");
for (const banned of ["TenderPath", "founder QA", "Founder QA", "your vault", "during drafting", "from your intake"]) {
  check(`buyer-facing documents never contain "${banned}"`, !allProse.includes(banned));
}

/* ── 4c · tender-pack keying ───────────────────────────────────────────── */
console.log("tender-pack keying");
check(
  "a crawled tender keeps the legacy id-keyed tag (existing packs must resolve)",
  tenderPackTag({ tenderId: 120261, title: "Anything" }) === "tender-pack:120261",
);
check(
  "a hand-entered notice keys on its title, so it can carry a pack at all",
  tenderPackTag({ tenderId: null, title: "AI Coding Agents" }) === "tender-pack:h:ai-coding-agents",
);
check(
  "the same title resolves to the same pack across calls",
  tenderPackTag({ title: "  AI Coding Agents  " }) === tenderPackTag({ title: "AI Coding Agents" }),
);
check(
  "punctuation and case normalise into one key",
  tenderPackTag({ title: "RFI #24626: AI/Coding — Agents!" }) === "tender-pack:h:rfi-24626-ai-coding-agents",
);
check("no tender identity yields no tag", tenderPackTag({ tenderId: null, title: "   " }) === null);

/* ── 5 · nudges ────────────────────────────────────────────────────────── */
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
