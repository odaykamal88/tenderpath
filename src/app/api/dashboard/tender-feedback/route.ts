import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";

const VALID_STATUSES = ["saved", "not_relevant", "evaluating", "preparing", "submitted", "in_progress", "applied"] as const;
type FeedbackStatus = (typeof VALID_STATUSES)[number];

function isValidStatus(v: unknown): v is FeedbackStatus {
  return typeof v === "string" && (VALID_STATUSES as readonly string[]).includes(v);
}

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.authorized) {
    // Unauthenticated feedback stored client-side only.
    return NextResponse.json({ ok: true, persisted: false });
  }

  const body = await request.json() as { tender_id?: number; assessment_id?: number; status?: string; reason?: string };
  const { tender_id, assessment_id, status, reason } = body;

  if (!tender_id || !status) {
    return NextResponse.json({ error: "tender_id and status are required" }, { status: 400 });
  }
  if (!isValidStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const userId = authResult.user!.id;

  await sql`
    INSERT INTO user_tender_feedback (user_id, assessment_id, tender_id, status, reason, created_at, updated_at)
    VALUES (${userId}, ${assessment_id ?? null}, ${tender_id}, ${status}, ${reason ?? null}, NOW(), NOW())
    ON CONFLICT (user_id, tender_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      reason = COALESCE(EXCLUDED.reason, user_tender_feedback.reason),
      updated_at = NOW()
  `;

  console.log("[tp:feedback:persisted]", { userId, tenderId: tender_id, status, assessmentId: assessment_id ?? null });

  return NextResponse.json({ ok: true, persisted: true });
}

export async function GET(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.authorized) return authResult.response!;

  const userId = authResult.user!.id;
  const { searchParams } = new URL(request.url);
  const assessmentId = searchParams.get("assessment_id");
  const statusFilter = searchParams.get("status");

  const rows = await sql`
    SELECT tender_id, status, reason, created_at, updated_at FROM user_tender_feedback
    WHERE user_id = ${userId}
    ${assessmentId ? sql`AND assessment_id = ${Number(assessmentId)}` : sql``}
    ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
    ORDER BY updated_at DESC
  `;

  return NextResponse.json({ feedback: rows });
}
