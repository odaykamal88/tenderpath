import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.authorized) {
    // Feedback from unauthenticated users is stored client-side only.
    return NextResponse.json({ ok: true, persisted: false });
  }

  const body = await request.json() as { tender_id?: number; assessment_id?: number; status?: string };
  const { tender_id, assessment_id, status } = body;

  if (!tender_id || !status) {
    return NextResponse.json({ error: "tender_id and status are required" }, { status: 400 });
  }

  const validStatuses = ["saved", "not_relevant", "in_progress", "applied"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const userId = authResult.user!.id;

  await sql`
    INSERT INTO user_tender_feedback (user_id, assessment_id, tender_id, status, updated_at)
    VALUES (${userId}, ${assessment_id ?? null}, ${tender_id}, ${status}, NOW())
    ON CONFLICT (user_id, tender_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
  `;

  return NextResponse.json({ ok: true, persisted: true });
}

export async function GET(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.authorized) return authResult.response!;

  const userId = authResult.user!.id;
  const { searchParams } = new URL(request.url);
  const assessmentId = searchParams.get("assessment_id");

  const rows = await sql`
    SELECT tender_id, status FROM user_tender_feedback
    WHERE user_id = ${userId}
    ${assessmentId ? sql`AND assessment_id = ${Number(assessmentId)}` : sql``}
  `;

  return NextResponse.json({ feedback: rows });
}
