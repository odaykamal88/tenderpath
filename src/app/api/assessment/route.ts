import { after, NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import {
  createQueuedAssessment,
  runAssessmentPipeline,
  validateAssessmentInput,
} from "@/lib/assessment/run";
import { track } from "@/lib/telemetry/funnel";
import type { AssessmentInput } from "@/lib/types";

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

  try {
    const wantsQueued = body.async === true || body.queued === true || body.mode === "queued";
    if (wantsQueued) {
      const queued = await createQueuedAssessment(body);
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
          });
        } catch (err) {
          console.error("[tp:assessment:queued_failed]", { assessmentId: queued.id, err });
        }
      });
      return NextResponse.json({
        id: queued.id,
        public_id: queued.public_id,
        status: "queued",
        queued: true,
        poll_url: `/api/assessment/${queued.public_id}`,
        created_at: queued.created_at,
      }, { status: 202 });
    }

    await track(
      "assessment_started",
      { mode: "inline", has_website: Boolean(body.website) },
      { userId: authResult.user?.id ?? null },
    );

    const result = await runAssessmentPipeline(body, {
      mode: "authenticated",
      sendEmailMode: "inline",
    });

    return NextResponse.json({
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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Assessment failed";
    console.error("Assessment error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
