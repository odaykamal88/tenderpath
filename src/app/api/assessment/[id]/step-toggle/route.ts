import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureAssessmentRuntimeColumns } from "@/lib/assessment/run";
import { authorizeAssessmentRead } from "@/lib/assessment/authz";

// Step keys are opaque to the API but currently shaped as `g{gapIdx}-s{stepIdx}`
// by deriveNextStepsGroups. We enforce the shape at the boundary so a leaked
// or fuzzed key can't smuggle arbitrary text into the completion log.
const STEP_KEY_RE = /^g\d+-s\d+$/;

// Hard cap on writes per assessment to keep the table from being weaponised
// by a malicious caller toggling thousands of bogus keys past the regex bound
// (e.g. g99999-s99999, g99998-s99998, ...). Generous for legit usage —
// the LLM never produces more than ~10 gaps × 2 steps = 20 keys.
const MAX_COMPLETIONS_PER_ASSESSMENT = 200;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  await ensureAssessmentRuntimeColumns();

  // IDOR-safe: UUID = capability, int = owner-only (logged).
  // Same authorization model as GET /api/assessment/[id] — anyone holding
  // the UUID link can mark steps done. That mirrors the Next Steps tab
  // being reachable via the same UUID URL.
  const authorized = await authorizeAssessmentRead(id);
  if (!authorized) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  let body: { stepKey?: unknown; done?: unknown };
  try {
    body = (await request.json()) as { stepKey?: unknown; done?: unknown };
  } catch {
    console.warn("[assessment:step-toggle:bad_json]", { assessmentId: authorized.intId });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const stepKey = typeof body.stepKey === "string" ? body.stepKey.trim() : "";
  const done = body.done === true;

  if (!stepKey || !STEP_KEY_RE.test(stepKey) || stepKey.length > 32) {
    console.warn("[assessment:step-toggle:bad_step_key]", {
      assessmentId: authorized.intId,
      stepKey: stepKey.slice(0, 32),
    });
    return NextResponse.json({ error: "Invalid stepKey" }, { status: 400 });
  }

  try {
    if (done) {
      // Cap check before insert — UNIQUE constraint already de-dupes the
      // happy path, so we only count when the key is genuinely new.
      const existing = await sql`
        SELECT 1 FROM assessment_step_completions
        WHERE assessment_id = ${authorized.intId} AND step_key = ${stepKey}
        LIMIT 1
      `;
      if (existing.length === 0) {
        const count = await sql`
          SELECT COUNT(*)::int AS n FROM assessment_step_completions
          WHERE assessment_id = ${authorized.intId}
        `;
        if ((count[0]?.n ?? 0) >= MAX_COMPLETIONS_PER_ASSESSMENT) {
          console.warn("[assessment:step-toggle:cap_reached]", {
            assessmentId: authorized.intId,
            cap: MAX_COMPLETIONS_PER_ASSESSMENT,
          });
          return NextResponse.json(
            { error: "Completion cap reached" },
            { status: 429 },
          );
        }
      }
      await sql`
        INSERT INTO assessment_step_completions (assessment_id, step_key)
        VALUES (${authorized.intId}, ${stepKey})
        ON CONFLICT (assessment_id, step_key) DO NOTHING
      `;
    } else {
      await sql`
        DELETE FROM assessment_step_completions
        WHERE assessment_id = ${authorized.intId} AND step_key = ${stepKey}
      `;
    }
    return NextResponse.json({ ok: true, stepKey, done });
  } catch (err) {
    console.error("[assessment:step-toggle:db_error]", {
      assessmentId: authorized.intId,
      stepKey,
      done,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
