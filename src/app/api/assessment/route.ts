import { after, NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import {
  createQueuedAssessment,
  runAssessmentPipeline,
  validateAssessmentInput,
} from "@/lib/assessment/run";
import { track } from "@/lib/telemetry/funnel";
import type { AssessmentInput } from "@/lib/types";
import {
  isDemoEmail,
  readDemoSessionCookie,
  mintDemoSessionId,
  setDemoSessionCookie,
} from "@/lib/assessment/demo-session";

export async function POST(request: Request) {
  // Gate behind authentication
  const authResult = await requireAuth(request);
  if (!authResult.authorized) return authResult.response!;

  const body = (await request.json()) as Partial<AssessmentInput> & {
    async?: boolean;
    queued?: boolean;
    mode?: string;
  };
  const validationError = validateAssessmentInput(body, { requireDescription: true });
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  // Sprint 24 (audit 2026-05-20 demo isolation): the demo user may run
  // additional assessments from the signed-in dashboard. Carry forward the
  // existing cookie if present so all of this session's runs stay linked;
  // mint one if missing (e.g. the cookie expired between sign-in and a later
  // dashboard run). Non-demo callers get NULL.
  const userEmail =
    typeof body.email === "string" ? body.email : authResult.user?.email ?? null;
  let demoSessionId: string | null = null;
  let mintedFreshCookie = false;
  if (isDemoEmail(userEmail)) {
    const existing = readDemoSessionCookie(request);
    if (existing) {
      demoSessionId = existing;
    } else {
      demoSessionId = mintDemoSessionId();
      mintedFreshCookie = true;
    }
  }

  try {
    const wantsQueued = body.async === true || body.queued === true || body.mode === "queued";
    if (wantsQueued) {
      const queued = await createQueuedAssessment(body, { demoSessionId });
      await track(
        "assessment_started",
        {
          assessment_id: queued.id,
          mode: "queued",
          has_website: Boolean(body.website),
        },
        { userId: authResult.user?.id ?? null },
      );
      after(async () => {
        try {
          await runAssessmentPipeline(body, {
            mode: "authenticated",
            assessmentId: queued.id,
            sendEmailMode: "inline",
            demoSessionId,
          });
        } catch (err) {
          console.error("[tp:assessment:queued_failed]", { assessmentId: queued.id, err });
        }
      });
      const response = NextResponse.json({
        id: queued.id,
        public_id: queued.public_id,
        status: "queued",
        queued: true,
        poll_url: `/api/assessment/${queued.public_id}`,
        created_at: queued.created_at,
      }, { status: 202 });
      if (mintedFreshCookie && demoSessionId) setDemoSessionCookie(response, demoSessionId);
      return response;
    }

    await track(
      "assessment_started",
      { mode: "inline", has_website: Boolean(body.website) },
      { userId: authResult.user?.id ?? null },
    );

    const result = await runAssessmentPipeline(body, {
      mode: "authenticated",
      sendEmailMode: "inline",
      demoSessionId,
    });

    const response = NextResponse.json({
      id: result.id,
      readiness_score: result.readiness_score,
      grant_readiness_score: result.grant_readiness_score,
      recommended_tier: result.recommended_tier,
      summary: result.summary,
      gaps: result.gaps.length,
      matched_tenders: result.matched_tenders.length,
      matched_grants: result.matched_grants.length,
      sectors: result.sectors,
      assessment_duration_ms: result.assessment_duration_ms,
      status: result.status,
    });
    if (mintedFreshCookie && demoSessionId) setDemoSessionCookie(response, demoSessionId);
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Assessment failed";
    console.error("Assessment error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
