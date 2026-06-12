/* Third-party request letters (SPEC §5 contract 3, pilot shape). We never
 * fabricate third-party paper — we draft the formal REQUEST for it. For the
 * pilot, ops copies the letter from the admin queue and sends it from the ops
 * mailbox; the auto-send + 48h chase scheduler + arrival webhook replace that
 * later. The recipient contact comes from the wizard's gen-panel ask input
 * (DocResolution.ask), carried on the order's intakeFields. */

import type { SubmissionOrder } from "./types";
import { docSpec } from "./docs-catalog";

export interface RequestLetter {
  docId: string;
  docLabel: string;
  target: "auditor" | "supplier" | "bank" | "client";
  /** The contact the vendor gave in the wizard, if any. */
  sendTo: string | null;
  subject: string;
  body: string;
}

function intakeDocs(order: SubmissionOrder): { docId: string; state: string; ask?: string | null }[] {
  const f = order.intakeFields as { docs?: { docId: string; state: string; ask?: string | null }[] };
  return Array.isArray(f.docs) ? f.docs : [];
}

function dueLine(order: SubmissionOrder): string {
  return order.due
    ? new Date(order.due).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "the submission deadline";
}

/** Letters for every doc the vendor put on the "request" path. */
export function buildRequestLetters(order: SubmissionOrder, companyName: string): RequestLetter[] {
  const out: RequestLetter[] = [];
  for (const d of intakeDocs(order)) {
    if (d.state !== "requested") continue;
    const spec = docSpec(d.docId);
    const target = spec?.gen?.requestTarget;
    if (!spec || !target) continue;
    const due = dueLine(order);
    const common = {
      docId: d.docId,
      docLabel: spec.label,
      target,
      sendTo: d.ask?.trim() || null,
    };
    if (target === "auditor") {
      out.push({
        ...common,
        subject: `Request: audited financial statements for a UN tender submission — ${companyName}`,
        body: [
          `Dear Sir/Madam,`,
          ``,
          `${companyName} is preparing a submission for "${order.tender}"${order.agency ? ` (issued by ${order.agency})` : ""}, which requires audited financial statements for the last three financial years, prepared under ISA.`,
          ``,
          `Could you please provide signed copies of the audited statements (income statement, balance sheet, and auditor's opinion for each year) at your earliest convenience? The tender closes on ${due}, so we would need them no later than five working days before that date.`,
          ``,
          `PDF copies signed and stamped are sufficient for submission.`,
          ``,
          `Kind regards,`,
          `${companyName} — prepared with TenderPath`,
        ].join("\n"),
      });
    } else if (target === "supplier") {
      out.push({
        ...common,
        subject: `Request: ${spec.label.toLowerCase()} for "${order.tender}"`,
        body: [
          `Dear Sir/Madam,`,
          ``,
          `${companyName} is submitting an offer for "${order.tender}"${order.agency ? ` issued by ${order.agency}` : ""} and requires ${spec.label.toLowerCase()} covering the quoted items, naming ${companyName} and the tender reference.`,
          ``,
          `The agency requires the document on your letterhead, signed and stamped. The tender closes on ${due} — could you return it within five working days?`,
          ``,
          `We can share the exact line items and the agency's required template on request.`,
          ``,
          `Kind regards,`,
          `${companyName} — prepared with TenderPath`,
        ].join("\n"),
      });
    } else if (target === "bank") {
      out.push({
        ...common,
        subject: `Request: bank reference letter — ${companyName}`,
        body: [
          `Dear Sir/Madam,`,
          ``,
          `${companyName} is participating in "${order.tender}"${order.agency ? ` issued by ${order.agency}` : ""}, which requires a bank reference letter confirming the standing of our account relationship.`,
          ``,
          `Could you issue the standard reference letter on bank letterhead, addressed "To whom it may concern"? The tender closes on ${due}; we would appreciate it within three working days.`,
          ``,
          `Kind regards,`,
          `${companyName} — prepared with TenderPath`,
        ].join("\n"),
      });
    } else {
      out.push({
        ...common,
        subject: `Request: reference letter for ${companyName}`,
        body: [
          `Dear Sir/Madam,`,
          ``,
          `${companyName} is submitting a proposal for "${order.tender}"${order.agency ? ` issued by ${order.agency}` : ""} and would like to cite our work with you as a reference.`,
          ``,
          `Could you provide a short signed reference letter (engagement scope, period, value band, and a line on performance)? The tender closes on ${due}; within five working days would be ideal. A one-paragraph letter on letterhead is plenty.`,
          ``,
          `Thank you for supporting the bid.`,
          ``,
          `Kind regards,`,
          `${companyName} — prepared with TenderPath`,
        ].join("\n"),
      });
    }
  }
  return out;
}

/** Chase due: a requested document with no arrival after 48h needs a follow-up.
 *  The request goes out at order placement, so paid_at is the request epoch. */
export function chaseDue(order: SubmissionOrder, now: number): boolean {
  if (!order.paidAt) return false;
  const hasRequested = order.blockers.some((b) => b.state === "requested");
  return hasRequested && now - new Date(order.paidAt).getTime() > 48 * 3_600_000;
}
