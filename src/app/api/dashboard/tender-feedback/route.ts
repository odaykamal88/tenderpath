import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";
import { isTenderFeedbackStatus, upsertTenderFeedback } from "@/lib/dashboard/tender-feedback";

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
  if (!isTenderFeedbackStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const userId = authResult.user!.id;

  await upsertTenderFeedback({
    userId,
    tenderId: tender_id,
    status,
    assessmentId: assessment_id ?? null,
    reason: reason ?? null,
  });

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
