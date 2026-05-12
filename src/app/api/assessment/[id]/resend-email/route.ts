import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { sendAssessmentEmail } from "@/lib/email/sendAssessment";
import type { Gap, MatchedGrant, MatchedTender, ReadinessDimensions, TierSlug } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RESEND_LIMIT = 3;
const RESEND_WINDOW_HOURS = 24;

let resendsTableEnsured = false;
async function ensureResendsTable() {
  if (resendsTableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS email_resend_log (
      id SERIAL PRIMARY KEY,
      assessment_id INTEGER NOT NULL,
      requested_by_email TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS email_resend_log_lookup
      ON email_resend_log (assessment_id, requested_at DESC)
  `;
  resendsTableEnsured = true;
}

type AssessmentRow = {
  id: number;
  company_name: string;
  email: string;
  sector: string | null;
  readiness_score: number;
  grant_readiness_score: number | null;
  recommended_tier: TierSlug | null;
  ai_analysis: {
    summary?: string;
    strengths?: string[];
    readiness_dimensions?: ReadinessDimensions;
  } | null;
  gaps: Gap[] | null;
  matched_tenders: MatchedTender[] | null;
  matched_grants: MatchedGrant[] | null;
  assessment_status: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const assessmentId = Number(id);
  if (!Number.isFinite(assessmentId)) {
    return NextResponse.json({ error: "Invalid assessment id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, company_name, email, sector, readiness_score, grant_readiness_score,
           recommended_tier, ai_analysis, gaps, matched_tenders, matched_grants, assessment_status
    FROM assessments
    WHERE id = ${assessmentId}
    LIMIT 1
  `;
  const row = rows[0] as AssessmentRow | undefined;
  if (!row) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  // Auth: a signed-in user can resend to themselves; admins can resend any.
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!user.is_super_admin && user.email.toLowerCase() !== row.email.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (row.assessment_status && row.assessment_status !== "completed") {
    return NextResponse.json({ error: "Assessment is not ready" }, { status: 409 });
  }

  // Rate limit: 3 resends per 24h per assessment. Admins bypass.
  await ensureResendsTable();
  if (!user.is_super_admin) {
    const recent = await sql`
      SELECT requested_at FROM email_resend_log
      WHERE assessment_id = ${assessmentId}
        AND requested_at >= NOW() - (${RESEND_WINDOW_HOURS} || ' hours')::interval
      ORDER BY requested_at ASC
    `;
    if (recent.length >= RESEND_LIMIT) {
      const oldest = new Date(recent[0].requested_at as string);
      const retryAt = new Date(oldest.getTime() + RESEND_WINDOW_HOURS * 3600_000);
      const retryAfter = Math.max(60, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
      return NextResponse.json(
        {
          error: `Resend limit reached. You can request another email after ${retryAt.toISOString()}.`,
          code: "RATE_LIMITED",
          limit: RESEND_LIMIT,
          windowHours: RESEND_WINDOW_HOURS,
          retryAt: retryAt.toISOString(),
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  // Re-queue the email so sendAssessmentEmail can update an existing row.
  await sql`
    INSERT INTO email_queue (assessment_id, status, attempts, provider, error)
    VALUES (${assessmentId}, 'pending', 0, 'resend', NULL)
    ON CONFLICT (assessment_id) DO UPDATE
      SET status = 'pending', error = NULL
  `.catch(() => {
    // email_queue may not have a unique constraint on assessment_id — fall back to a plain insert.
    return sql`INSERT INTO email_queue (assessment_id, status, attempts, provider, error)
               VALUES (${assessmentId}, 'pending', 0, 'resend', NULL)`;
  });

  const analysis = row.ai_analysis ?? {};
  const dims = analysis.readiness_dimensions;
  const gaps = row.gaps ?? [];
  const tenders = row.matched_tenders ?? [];
  const grants = row.matched_grants ?? [];

  try {
    await sendAssessmentEmail({
      assessmentId: row.id,
      email: row.email,
      companyName: row.company_name,
      readinessScore: row.readiness_score,
      recommendedTier: (row.recommended_tier ?? "tender-intelligence") as TierSlug,
      summary: analysis.summary ?? "",
      topGap: gaps[0]?.gap ?? null,
      tenderCount: tenders.length,
      grantCount: grants.length,
      topTenders: tenders.slice(0, 3).map((t) => ({
        title: t.title,
        agency: t.agency,
        country: t.country,
        match_reasons: t.match_reasons ?? [],
      })),
      sectors: row.sector ? [row.sector] : [],
      grantReadinessScore: row.grant_readiness_score ?? 0,
      readinessDimensions: dims,
      gaps,
      strengths: analysis.strengths ?? [],
      matchedTenders: tenders,
      matchedGrants: grants,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Email send failed";
    console.error("[tp:email:resend_failed]", { assessmentId, error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Log the successful resend for the rate-limit window.
  await sql`
    INSERT INTO email_resend_log (assessment_id, requested_by_email)
    VALUES (${assessmentId}, ${user.email})
  `.catch((err) => {
    console.warn("[tp:email:resend_log_failed]", { assessmentId, error: err instanceof Error ? err.message : String(err) });
  });

  return NextResponse.json({ ok: true, email: row.email });
}
