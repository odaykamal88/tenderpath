/* Stage machine (SPEC §2).
 *
 *   intake ─ops─▶ drafting ─ops─▶ qa ─ops─▶ review ─client─▶ final ─client─▶ submitted
 *                    ▲                          │ request changes                │
 *                    └───── revisions ◀─────────┘     outcome: pending → shortlisted/won/lost
 *                          (ops: revisions ─▶ qa)                       └─▶ debrief loop
 *
 * Ops advance: intake→drafting (confirm intake) · drafting→qa · qa→review
 * (release to client; pct→100, deliverables→ready) · revisions→qa (re-gated).
 * Client: review→final (approve) · review→revisions (notes required, round++)
 * · final→submitted (shepherd checklist complete). */

import type { SubmissionStage } from "./types";

export const STAGES: SubmissionStage[] = [
  "intake",
  "drafting",
  "qa",
  "review",
  "revisions",
  "final",
  "submitted",
];

/** Timeline display order — Revisions renders between review and final, and
 *  only when the order has consumed a revision round. */
export const TIMELINE_ORDER: SubmissionStage[] = [
  "intake",
  "drafting",
  "qa",
  "review",
  "revisions",
  "final",
  "submitted",
];

export const STAGE_META: Record<
  SubmissionStage,
  { label: string; client: string; ops: string }
> = {
  intake: {
    label: "Intake confirmed",
    client: "Inputs received and checked against the tender requirements.",
    ops: "Paid — confirm the intake to start drafting.",
  },
  drafting: {
    label: "Drafting",
    client: "Writers assemble the documents from your intake and vault.",
    ops: "In production — update % and the status line as you go.",
  },
  qa: {
    label: "Quality check",
    client: "Compliance pass — format, eligibility, completeness, no elimination errors.",
    ops: "Run the QA checklist, then release to the client.",
  },
  review: {
    label: "Your review",
    client: "Draft pack is with you. Approve, or request changes.",
    ops: "With the client — they approve or request changes from their dashboard.",
  },
  revisions: {
    label: "Revisions",
    client: "Your change requests are being applied.",
    ops: "Apply the client's notes, then send back through QA.",
  },
  final: {
    label: "Final pack",
    client: "Submission-ready files in the agency's required format.",
    ops: "Final-mile — the client signs and submits; the shepherd guides them.",
  },
  submitted: {
    label: "Submitted",
    client: "Filed with the agency. Awaiting outcome.",
    ops: "Awaiting outcome — record it when the agency decides.",
  },
};

/** Progress strip position (7 segments on the vendor order card). */
export function stageIndex(stage: SubmissionStage): number {
  return STAGES.indexOf(stage);
}

const OPS_TRANSITIONS: Record<string, SubmissionStage[]> = {
  intake: ["drafting"],
  drafting: ["qa"],
  qa: ["review"],
  revisions: ["qa"],
};

const CLIENT_TRANSITIONS: Record<string, SubmissionStage[]> = {
  review: ["final", "revisions"],
  final: ["submitted"],
};

export function canTransition(
  actor: "ops" | "client",
  from: SubmissionStage,
  to: SubmissionStage,
): boolean {
  const table = actor === "ops" ? OPS_TRANSITIONS : CLIENT_TRANSITIONS;
  return (table[from] ?? []).includes(to);
}

/** The single ops "advance" action per stage, for the queue's primary button. */
export function opsNextStage(stage: SubmissionStage): SubmissionStage | null {
  const next = OPS_TRANSITIONS[stage];
  return next?.[0] ?? null;
}

export const OPS_ADVANCE_LABEL: Partial<Record<SubmissionStage, string>> = {
  intake: "Confirm intake → start drafting",
  drafting: "Send to quality check",
  qa: "Release to client review",
  revisions: "Revisions applied → back to QA",
};

/** Default stage note written when a transition happens without a custom one. */
export const DEFAULT_STAGE_NOTE: Record<SubmissionStage, string> = {
  intake: "Order placed — intake under review.",
  drafting: "Drafting started.",
  qa: "Draft in quality check.",
  review: "Draft pack ready for your review.",
  revisions: "Change requests being applied.",
  final: "Final pack prepared — sign and submit.",
  submitted: "Filed with the agency. Awaiting outcome.",
};
