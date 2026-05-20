import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { resolveAssessmentRef } from "@/lib/assessment/authz";
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
  // Outer wrap so any uncaught throw (DDL drift on email_resend_log, queue FK
  // surprises, DB disconnects, schema deltas) surfaces with a stable log tag
  // instead of as a bare 500 with nothing in the prod logs. Discovered when
  // the demo user hit "Could not resend (500)" on 2026-05-20 with no
  // diagnostic info in Vercel logs. Same launch-discipline rule 4 fix we
  // applied to /api/auth/password.
  let assessmentIdForLog: number | null = null;
  try {
    const { id } = await params;
    // Accept UUID or legacy int. Ownership check happens below — capability URL
    // is intentionally NOT sufficient for mutation; only the owner can resend.
    const ref = await resolveAssessmentRef(id);
    if (!ref) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }
    const assessmentId = ref.intId;
    assessmentIdForLog = assessmentId;

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
    // getUserFromRequest accepts Bearer header OR tp_session cookie since
    // 2026-05-20 — cookie-only callers (Google OAuth, post-localStorage-clear)
    // previously got a silent 401 here.
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
    // DDL failure here is non-fatal — log and continue; the rate-limit check
    // below will see an empty `recent` list and let the send proceed once.
    try {
      await ensureResendsTable();
    } catch (ddlErr) {
      console.warn("[email:resend:ensure_table_failed]", {
        assessmentId,
        error: ddlErr instanceof Error ? ddlErr.message : String(ddlErr),
      });
    }
    if (!user.is_super_admin) {
      try {
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
      } catch (rateErr) {
        // If the rate-limit table isn't readable, fail open (let the send
        // proceed) rather than block legit users on infra blips. The send
        // path itself logs every attempt via the email_queue row.
        console.warn("[email:resend:rate_check_failed]", {
          assessmentId,
          error: rateErr instanceof Error ? rateErr.message : String(rateErr),
        });
      }
    }

    // Re-queue the email so sendAssessmentEmail can update an existing row.
    // Two-step fallback chain — the historical `.catch(() => sql\`...\`)`
    // shape returned a new unhandled promise that could 500 the route if the
    // fallback itself threw. Now both branches are explicit and the route
    // continues even if the queue row can't be written (the send itself can
    // still go out; email_queue is bookkeeping).
    try {
      await sql`
        INSERT INTO email_queue (assessment_id, status, attempts, provider, error)
        VALUES (${assessmentId}, 'pending', 0, 'resend', NULL)
        ON CONFLICT (assessment_id) DO UPDATE
          SET status = 'pending', error = NULL
      `;
    } catch (upsertErr) {
      console.warn("[email:resend:queue_upsert_failed]", {
        assessmentId,
        error: upsertErr instanceof Error ? upsertErr.message : String(upsertErr),
      });
      try {
        await sql`
          INSERT INTO email_queue (assessment_id, status, attempts, provider, error)
          VALUES (${assessmentId}, 'pending', 0, 'resend', NULL)
        `;
      } catch (insertErr) {
        console.warn("[email:resend:queue_insert_failed]", {
          assessmentId,
          error: insertErr instanceof Error ? insertErr.message : String(insertErr),
        });
      }
    }

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
      console.error("[email:resend:send_failed]", { assessmentId, error: msg });
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    // Log the successful resend for the rate-limit window.
    await sql`
      INSERT INTO email_resend_log (assessment_id, requested_by_email)
      VALUES (${assessmentId}, ${user.email})
    `.catch((err) => {
      console.warn("[email:resend:log_failed]", {
        assessmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json({ ok: true, email: row.email });
  } catch (err) {
    console.error("[email:resend:route_error]", {
      assessmentId: assessmentIdForLog,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
