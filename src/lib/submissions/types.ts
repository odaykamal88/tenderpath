/* Submissions workflow — core types.
 *
 * The paid per-submission product (EOI · RFQ · ITB · RFP): vendor intake through
 * drafting, QA, client review, final-mile submission, and outcome. Ported from
 * the June-2026 submissions handoff (~/Downloads/handoff-submissions/SPEC.md §1);
 * the prototype is the spec — field names mirror its order object.
 *
 * One shared order object drives both surfaces: the vendor dashboard
 * (/dashboard/proposals) and the ops queue (/admin/submissions). Every state
 * change appends to `events[]` — both sides read the same log. */

import type { SubmissionCode } from "@/lib/workbench/pricing";
import {
  EMPTY_PORTAL_COMPANION,
  EMPTY_TENDER_REQUIREMENTS,
  type PortalCompanionState,
  type TenderPackState,
  type TenderRequirementsState,
} from "@/lib/tender-workspace/types";

export type { SubmissionCode };

/** intake → drafting → qa → review → final → submitted, with a revisions loop
 *  (review → revisions → qa) when the client requests changes. */
export type SubmissionStage =
  | "intake"
  | "drafting"
  | "qa"
  | "review"
  | "revisions"
  | "final"
  | "submitted";

export type BlockerState = "open" | "acknowledged" | "requested" | "resolved";

export interface SubmissionBlocker {
  id: string;
  label: string;
  sev: "high" | "medium";
  state: BlockerState;
  note?: string | null;
}

export type DeliverableStatus = "queued" | "drafting" | "drafted" | "ready" | "submitted";

/** Export grouping — deliverables ship one ZIP per envelope, never merged. */
export type EnvelopeKey = "technical" | "financial" | "forms";

export interface SubmissionDeliverable {
  name: string;
  /** Display format label, e.g. "PDF", "XLSX + PDF". */
  fmt: string;
  envelope: EnvelopeKey;
  status: DeliverableStatus;
}

export interface SubmissionEvent {
  at: string; // ISO
  label: string;
  /** Client sees ops events labeled "TenderPath". */
  by: "client" | "ops";
}

export interface SubmissionAmendment {
  n: number;
  at: string; // ISO
  /** What the agency changed, e.g. "Deadline extended 08 → 12 May". */
  summary: string;
  /** What we did about it — always present, losses of trust hide here. */
  action: string;
}

export interface SubmissionQna {
  at: string; // ISO
  /** Where it came from: "lodged" (client asked via us) | "forward" (agency
   *  mail forwarded/uploaded by the client) | "ops". */
  src: "lodged" | "forward" | "ops";
  q: string;
  a?: string | null;
  /** Draft-impact verdict, e.g. "no change needed" / "draft updated §4.2". */
  impact?: string | null;
  /** Original attachment / mail subject line for forwarded items. */
  via?: string | null;
}

export type OutcomeState = "pending" | "shortlisted" | "won" | "lost";

export interface SubmissionDebrief {
  state: "requested" | "received";
  requestedAt?: string | null;
  /** Each lesson should end with what changed in the system. */
  lessons: string[];
}

export interface SubmissionOutcome {
  state: OutcomeState;
  decidedAt?: string | null;
  /** [label, value] rows, e.g. ["Technical score", "66.5 / 100 — 3.5 below the 70.0 threshold"]. */
  scores?: [string, string][];
  debrief?: SubmissionDebrief | null;
}

/** Final-mile shepherd: the client signs and submits — we guide, we never claim
 *  to file on their behalf. `checked` holds checklist item ids. */
export interface ShepherdState {
  checked: string[];
  /** Optional agency receipt / reference number captured at submission. */
  receipt?: string | null;
}

/** Raw wizard values keyed by field id — drives docContent() so the reader
 *  previews documents built from the order's own intake. */
export type IntakeFields = Record<string, unknown>;

export interface PricedLine {
  id: string;
  desc: string;
  specRef?: string | null;
  qty: number;
  unit: string;
  unitPrice: number | null;
}

export interface ConformityRow {
  id: string;
  requirement: string;
  response: "comply" | "deviate" | "";
  deviation?: string | null;
}

export interface ReferenceEntry {
  id: string;
  label: string;
  /** "vault" = picked from the Document Vault; "typed" = entered by hand. */
  src: "vault" | "typed";
  vaultDocumentId?: number | null;
}

/** Resolution state of one required-document row in the wizard (prototype
 *  states: attached · resolved · drafted · requested · ack · missing). */
export type DocResolutionState =
  | "missing"
  | "attached" // auto-attached from the vault
  | "resolved" // uploaded just now / registration confirmed
  | "drafted" // we author it (flagged for signature)
  | "requested" // third-party paper — request letter drafted + sent
  | "ack"; // acknowledged — proceed at risk, flagged in the draft

export interface DocResolution {
  docId: string;
  state: DocResolutionState;
  vaultDocumentId?: number | null;
  /** The gen panel's ask input (send-to contact, signatory, emphasis…) — ops
   *  reads this when fulfilling the draft/request. */
  ask?: string | null;
  note?: string | null;
}

export interface SubmissionOrder {
  id: number;
  /** Display ref, e.g. "TP-2353" — also the inbound-mail address local part. */
  ref: string;
  userId: number;
  /** Billing row in work_orders (payment, refunds, receipts). Plain integer
   *  link — no FK, same precedent as users.free_submission_used_work_order_id. */
  workOrderId: number | null;
  type: SubmissionCode;
  priceCents: number;
  currency: string;
  tender: string;
  agency: string | null;
  source: string | null;
  portal: string | null;
  tenderId: number | null;
  pipelineItemId: number | null;
  /** Deadline (agency-local date). */
  due: string | null;
  value: string | null;
  fit: number | null;
  stage: SubmissionStage;
  /** Drafting progress 0–100 (ops-set; release to review forces 100). */
  pct: number;
  /** Revision rounds consumed — unlimited allowed. */
  round: number;
  /** One-line human status, shown verbatim to the client. */
  stageNote: string | null;
  /** Draft-delivery promise in minutes; the clock starts at paidAt. */
  slaMins: number;
  /** Intake completeness % at commission time. */
  completeness: number;
  blockers: SubmissionBlocker[];
  /** Human-readable intake summary [[k, v], …] — drives the reader content. */
  intake: [string, string][];
  intakeFields: IntakeFields;
  deliverables: SubmissionDeliverable[];
  events: SubmissionEvent[];
  /** Latest client change request (review → revisions). */
  revisionNotes: string | null;
  amendments: SubmissionAmendment[];
  qna: SubmissionQna[];
  outcome: SubmissionOutcome;
  shepherd: ShepherdState;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ── Client/admin action contracts ─────────────────────────────────────── */

export type ClientOrderAction =
  | { action: "approve" } // review → final
  | { action: "request_changes"; notes: string } // review → revisions (round++)
  | { action: "submit_final"; receipt?: string | null } // final → submitted (shepherd complete)
  | { action: "shepherd_toggle"; item: string; done: boolean }
  | { action: "lodge_qna"; q: string }
  | { action: "forward_agency_mail"; text: string; via?: string | null }
  | { action: "request_debrief" }
  | { action: "ack_blocker"; blockerId: string };

export type AdminOrderAction =
  | { action: "advance"; to: SubmissionStage } // guarded by the ops transitions
  | { action: "set_progress"; pct: number; stageNote?: string | null }
  | { action: "post_note"; note: string } // appends to the client-visible timeline
  | { action: "record_outcome"; state: Exclude<OutcomeState, "pending">; scores?: [string, string][]; decidedAt?: string | null }
  | { action: "record_debrief"; lessons: string[] }
  | { action: "answer_qna"; index: number; a: string; impact?: string | null }
  | { action: "add_amendment"; summary: string; actionTaken: string; due?: string | null }
  | { action: "resolve_blocker"; blockerId: string; note?: string | null };

/* ── Wizard draft (server-side autosave, one per user × type) ──────────── */

export interface WizardDraftState {
  /** Selected opportunity (from a workbench match or pasted by hand). */
  tender?: {
    title: string;
    agency?: string | null;
    source?: string | null;
    sourceUrl?: string | null;
    portal?: string | null;
    portalKey?: string | null;
    /** True when the notice-specific channel replaces registry guidance. */
    portalOverride?: boolean;
    portalUrl?: string | null;
    portalGuideUrl?: string | null;
    due?: string | null;
    value?: string | null;
    fit?: number | null;
    tenderId?: number | null;
    pipelineItemId?: number | null;
  } | null;
  /** Private solicitation set carried from source import / guided upload. */
  tenderPack?: TenderPackState;
  /** User-confirmed, non-credential portal hand-off state. */
  portalCompanion?: PortalCompanionState;
  /** Evidence-backed requirements extracted from the current private pack. */
  tenderRequirements?: TenderRequirementsState;
  fields: Record<string, string>;
  lines: PricedLine[];
  currency: string;
  conformity: ConformityRow[];
  declarations: string[]; // affirmed declaration ids
  refs: ReferenceEntry[];
  docs: DocResolution[];
  step: number;
}

export const EMPTY_DRAFT: WizardDraftState = {
  tender: null,
  tenderPack: { status: "not_started", documents: [] },
  portalCompanion: { ...EMPTY_PORTAL_COMPANION },
  tenderRequirements: { ...EMPTY_TENDER_REQUIREMENTS },
  fields: {},
  lines: [],
  currency: "USD",
  conformity: [],
  declarations: [],
  refs: [],
  docs: [],
  step: 0,
};
