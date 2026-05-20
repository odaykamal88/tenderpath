import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
import {
  createQueuedAssessment,
  runAssessmentPipeline,
  sendAssessmentResultEmail,
  validateAssessmentInput,
} from "@/lib/assessment/run";
import { track } from "@/lib/telemetry/funnel";
import type { AssessmentInput } from "@/lib/types";
import {
  isDemoEmail,
  resolveOrMintForAnonymousSubmission,
  setDemoSessionCookie,
} from "@/lib/assessment/demo-session";

/**
 * Public assessment endpoint — no auth required.
 * Used by the lead-generation assessment page.
 * Returns full assessment data for immediate rendering.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AssessmentInput> & {
    async?: boolean;
    queued?: boolean;
    mode?: string;
  };
  const validationError = validateAssessmentInput(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  // Sprint 24 (audit 2026-05-20 demo isolation): mint a fresh tp_demo_session
  // cookie for every anonymous submission with the demo email. The new value
  // overwrites any prior cookie in the browser — that's intentional, so two
  // sequential visitors using the same shared browser end up isolated. The
  // value is stamped on the assessment row and matched against the cookie at
  // demo sign-in to preserve the just-completed handoff.
  const demoSessionId = isDemoEmail(body.email)
    ? resolveOrMintForAnonymousSubmission()
    : null;

  try {
    const wantsQueued = body.async === true || body.queued === true || body.mode === "queued";
    if (wantsQueued) {
      const queued = await createQueuedAssessment(body, { demoSessionId });
      await track("assessment_started", {
        assessment_id: queued.id,
        mode: "public-queued",
        has_website: Boolean(body.website),
        has_description: Boolean(body.description),
      });
      after(async () => {
        try {
          await runAssessmentPipeline(body, {
            mode: "public",
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
      if (demoSessionId) setDemoSessionCookie(response, demoSessionId);
      return response;
    }

    await track("assessment_started", {
      mode: "public-inline",
      has_website: Boolean(body.website),
      has_description: Boolean(body.description),
    });

    const result = await runAssessmentPipeline(body, {
      mode: "public",
      sendEmailMode: "none",
      demoSessionId,
    });
    after(async () => {
      try {
        await sendAssessmentResultEmail(result);
      } catch (err) {
        console.error("[tp:email:after_failed]", { assessmentId: result.id, err });
      }
    });

    const response = NextResponse.json(result);
    if (demoSessionId) setDemoSessionCookie(response, demoSessionId);
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Assessment failed";
    console.error("Assessment error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
