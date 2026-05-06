import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";

const VALID_STATUSES = ["saved", "not_relevant", "pursuing", "applied"] as const;
type FeedbackStatus = (typeof VALID_STATUSES)[number];

function isValidStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (VALID_STATUSES as readonly string[]).includes(value);
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS user_grant_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
      grant_id INTEGER NOT NULL,
      status VARCHAR(32) NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, grant_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS user_grant_feedback_user_status_idx
    ON user_grant_feedback (user_id, status)
  `;
}

export async function POST(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.authorized) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  const body = await request.json() as { grant_id?: number; assessment_id?: number; status?: string; reason?: string };
  const { grant_id, assessment_id, status, reason } = body;

  if (!grant_id || !status) {
    return NextResponse.json({ error: "grant_id and status are required" }, { status: 400 });
  }
  if (!isValidStatus(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await ensureTable();
  const userId = authResult.user!.id;

  await sql`
    INSERT INTO user_grant_feedback (user_id, assessment_id, grant_id, status, reason, created_at, updated_at)
    VALUES (${userId}, ${assessment_id ?? null}, ${grant_id}, ${status}, ${reason ?? null}, NOW(), NOW())
    ON CONFLICT (user_id, grant_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      reason = COALESCE(EXCLUDED.reason, user_grant_feedback.reason),
      updated_at = NOW()
  `;

  console.log("[tp:grant_feedback:persisted]", { userId, grantId: grant_id, status, assessmentId: assessment_id ?? null });

  return NextResponse.json({ ok: true, persisted: true });
}

export async function GET(request: Request) {
  const authResult = await requireAuth(request);
  if (!authResult.authorized) return authResult.response!;

  await ensureTable();
  const userId = authResult.user!.id;
  const { searchParams } = new URL(request.url);
  const assessmentId = searchParams.get("assessment_id");
  const statusFilter = searchParams.get("status");

  const rows = await sql`
    SELECT grant_id, status, reason, created_at, updated_at
    FROM user_grant_feedback
    WHERE user_id = ${userId}
    ${assessmentId ? sql`AND assessment_id = ${Number(assessmentId)}` : sql``}
    ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
    ORDER BY updated_at DESC
  `;

  return NextResponse.json({ feedback: rows });
}
