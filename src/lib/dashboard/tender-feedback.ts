import { sql } from "@/lib/db";

/**
 * Shared tender-feedback upsert. The dashboard API route and the bot both write
 * here so the "saved / not_relevant / …" contract lives in exactly one place
 * (see launch-discipline rule #1 — shared contracts).
 */

export const TENDER_FEEDBACK_STATUSES = [
  "saved",
  "not_relevant",
  "evaluating",
  "preparing",
  "submitted",
  "in_progress",
  "applied",
] as const;

export type TenderFeedbackStatus = (typeof TENDER_FEEDBACK_STATUSES)[number];

export function isTenderFeedbackStatus(v: unknown): v is TenderFeedbackStatus {
  return typeof v === "string" && (TENDER_FEEDBACK_STATUSES as readonly string[]).includes(v);
}

export async function upsertTenderFeedback(opts: {
  userId: number;
  tenderId: number;
  status: TenderFeedbackStatus;
  assessmentId?: number | null;
  reason?: string | null;
}): Promise<void> {
  const { userId, tenderId, status, assessmentId = null, reason = null } = opts;
  await sql`
    INSERT INTO user_tender_feedback (user_id, assessment_id, tender_id, status, reason, created_at, updated_at)
    VALUES (${userId}, ${assessmentId}, ${tenderId}, ${status}, ${reason}, NOW(), NOW())
    ON CONFLICT (user_id, tender_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      reason = COALESCE(EXCLUDED.reason, user_tender_feedback.reason),
      updated_at = NOW()
  `;
}
