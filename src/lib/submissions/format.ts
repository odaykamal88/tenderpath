import type { SubmissionCode } from "./types";

/** Infer only formats the live submission wizard supports; unknown stays null. */
export function submissionCodeForOpportunity(
  opportunityType: string | null | undefined,
  title: string | null | undefined,
): SubmissionCode | null {
  const value = `${opportunityType ?? ""} ${title ?? ""}`.toLowerCase();
  if (/\b(eoi|expression of interest)\b/.test(value)) return "EOI";
  if (/\b(rfq|request for quotation)\b/.test(value)) return "RFQ";
  if (/\b(itb|invitation to bid)\b/.test(value)) return "ITB";
  if (/\b(rfp|request for proposal)\b/.test(value)) return "RFP";
  return null;
}
