/* Deadline nudges for the Submissions page strip (SPEC §5.6 — the in-page
 * mirror of the email/WhatsApp scheduler). Pure derivation from real order
 * state: a nudge only exists when an order genuinely waits on the client.
 * Escalates to URGENT inside 4 days of the deadline. */

import type { SubmissionOrder } from "./types";

export interface SubmissionNudge {
  orderId: number;
  /** "review" = draft waiting on the client · "final" = approved pack not yet
   *  submitted · "debrief" = lost without a debrief request. */
  kind: "review" | "final" | "debrief";
  urgent: boolean;
  label: string;
  cta: string;
}

function daysUntil(due: string | null): number | null {
  if (!due) return null;
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function dueLabel(due: string | null): string {
  const d = daysUntil(due);
  if (due == null || d == null) return "no deadline on file";
  const date = new Date(due).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (d < 0) return `closed ${date}`;
  if (d === 0) return `due today (${date})`;
  return `due ${date} (${d} day${d === 1 ? "" : "s"})`;
}

export function buildNudges(orders: SubmissionOrder[]): SubmissionNudge[] {
  const out: SubmissionNudge[] = [];
  for (const o of orders) {
    if (!o.paidAt) continue;
    const d = daysUntil(o.due);
    const urgent = d != null && d >= 0 && d <= 4;
    if (o.stage === "review") {
      out.push({
        orderId: o.id,
        kind: "review",
        urgent,
        label: `${o.type} ${o.ref} — draft waiting for your review · ${dueLabel(o.due)}`,
        cta: "Review draft",
      });
    } else if (o.stage === "final") {
      out.push({
        orderId: o.id,
        kind: "final",
        urgent,
        label: `${o.type} ${o.ref} — final pack ready, not yet submitted · ${dueLabel(o.due)}`,
        cta: "Open checklist",
      });
    } else if (
      o.stage === "submitted" &&
      o.outcome.state === "lost" &&
      !o.outcome.debrief &&
      o.outcome.decidedAt &&
      Date.now() - new Date(o.outcome.decidedAt).getTime() < 10 * 86_400_000
    ) {
      out.push({
        orderId: o.id,
        kind: "debrief",
        urgent: false,
        label: `${o.type} ${o.ref} — debrief window closing · you're entitled to know why`,
        cta: "Request debrief",
      });
    }
  }
  // Urgent first, then reviews before finals.
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
