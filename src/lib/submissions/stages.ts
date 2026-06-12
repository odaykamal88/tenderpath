/* Stage machine (SPEC §2) — single source of truth for both sides, faithful to
 * the prototype's TPSUBSTORE.STAGES + the admin queue's SQ_ACTIONS/SQ_WAITING.
 *
 *   intake ─ops─▶ drafting ─ops─▶ qa ─ops─▶ review ─client─▶ final ─client─▶ submitted
 *                    ▲                          │ request changes                │
 *                    └───── revisions ◀─────────┘     outcome: pending → shortlisted/won/lost
 *                          (ops: revisions ─▶ qa)                       └─▶ debrief loop */

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

/** user = label shown to the vendor · admin = label shown to ops. The
 *  Revisions row renders only when the order has consumed a round. */
export const STAGE_META: Record<
  SubmissionStage,
  { user: string; admin: string; desc: string }
> = {
  intake: {
    user: "Intake confirmed",
    admin: "New intake",
    desc: "Inputs received and checked against the tender requirements.",
  },
  drafting: {
    user: "Drafting",
    admin: "Drafting",
    desc: "Writers assemble the documents from your intake and vault.",
  },
  qa: {
    user: "Quality check",
    admin: "QA gate",
    desc: "Compliance pass — format, eligibility, completeness, no elimination errors.",
  },
  review: {
    user: "Your review",
    admin: "Client review",
    desc: "Draft pack is with you. Approve, or request changes.",
  },
  revisions: {
    user: "Revisions",
    admin: "Revisions",
    desc: "Your change requests are being applied.",
  },
  final: {
    user: "Final pack",
    admin: "Final pack",
    desc: "Submission-ready files in the agency's required format.",
  },
  submitted: {
    user: "Submitted",
    admin: "Submitted",
    desc: "Filed with the agency before deadline.",
  },
};

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

/** The single ops advance per stage (prototype SQ_ACTIONS): button label +
 *  the event/stage note the client sees. */
export const OPS_ACTIONS: Partial<
  Record<SubmissionStage, { next: SubmissionStage; label: string; note: string }>
> = {
  intake: {
    next: "drafting",
    label: "Confirm intake → start drafting",
    note: "Intake confirmed against the tender notice — drafting started",
  },
  drafting: {
    next: "qa",
    label: "Draft complete → send to QA",
    note: "Draft assembled — entering the compliance QA gate",
  },
  qa: {
    next: "review",
    label: "QA passed → release to client",
    note: "QA passed — draft pack released for client review",
  },
  revisions: {
    next: "qa",
    label: "Revisions applied → re-run QA",
    note: "Client revisions applied — re-entering QA",
  },
};

export function opsNextStage(stage: SubmissionStage): SubmissionStage | null {
  return OPS_ACTIONS[stage]?.next ?? null;
}

/** Ops-side explainer for stages where the ball is with the client (SQ_WAITING). */
export const OPS_WAITING: Partial<Record<SubmissionStage, string>> = {
  review: "With the client — they approve or request changes from their dashboard.",
  final: "Final pack delivered. The client runs the guided portal submission from their dashboard.",
  submitted: "Filed with the agency. Awaiting outcome.",
};

/** Default stage note written when a transition happens without a custom one. */
export const DEFAULT_STAGE_NOTE: Record<SubmissionStage, string> = {
  intake: "Intake received — confirming against the tender notice",
  drafting: "Intake confirmed against the tender notice — drafting started",
  qa: "Draft assembled — entering the compliance QA gate",
  review: "Draft pack ready for your review",
  revisions: "Applying your change requests",
  final: "Approved — final pack being prepared in the portal's required format",
  submitted: "Submitted · decision pending",
};
