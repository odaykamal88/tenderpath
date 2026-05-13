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

  try {
    const wantsQueued = body.async === true || body.queued === true || body.mode === "queued";
    if (wantsQueued) {
      const queued = await createQueuedAssessment(body);
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
          });
        } catch (err) {
          console.error("[tp:assessment:queued_failed]", { assessmentId: queued.id, err });
        }
      });
      return NextResponse.json({
        id: queued.id,
        status: "queued",
        queued: true,
        poll_url: `/api/assessment/${queued.id}`,
        created_at: queued.created_at,
      }, { status: 202 });
    }

    await track("assessment_started", {
      mode: "public-inline",
      has_website: Boolean(body.website),
      has_description: Boolean(body.description),
    });

    const result = await runAssessmentPipeline(body, {
      mode: "public",
      sendEmailMode: "none",
    });
    after(async () => {
      try {
        await sendAssessmentResultEmail(result);
      } catch (err) {
        console.error("[tp:email:after_failed]", { assessmentId: result.id, err });
      }
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Assessment failed";
    console.error("Assessment error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
