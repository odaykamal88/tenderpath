import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";

const STAGES = ["matched", "evaluating", "preparing", "submitted", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const userId = guard.user!.id;
  const { searchParams } = new URL(request.url);
  const stageFilter = searchParams.get("stage");
  const excludeNotRelevant = searchParams.get("exclude_dismissed") !== "false";

  // Load user's not_relevant feedback to exclude those pipeline items
  const feedbackRows = await sql`
    SELECT tender_id FROM user_tender_feedback
    WHERE user_id = ${userId} AND status = 'not_relevant'
  `;
  const dismissedTenderIds = new Set(feedbackRows.map((r) => r.tender_id as number));

  const rows = await sql`
    SELECT id, tender_id, tender_title, tender_agency, tender_deadline,
           tender_value, fit_score, stage, position, notes, match_reasons,
           assessment_id, updated_at
    FROM pipeline_items
    WHERE user_id = ${userId}
    ${stageFilter && isStage(stageFilter) ? sql`AND stage = ${stageFilter}` : sql``}
    ORDER BY stage, position, id
  `;

  // Filter out items that have been dismissed via feedback (not_relevant)
  // Only applies to 'matched' stage items — active pipeline items are never hidden
  const items = (rows as Array<{ id: number; tender_id: number | null; stage: string; [key: string]: unknown }>).filter((item) => {
    if (!excludeNotRelevant) return true;
    if (item.stage !== "matched") return true;
    if (item.tender_id != null && dismissedTenderIds.has(item.tender_id)) return false;
    return true;
  });

  if (dismissedTenderIds.size > 0) {
    console.log("[tp:pipeline:filtered]", {
      userId,
      dismissedCount: dismissedTenderIds.size,
      beforeFilter: rows.length,
      afterFilter: items.length,
    });
  }

  return NextResponse.json({ items, access: guard.access });
}

export async function POST(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const body = await request.json();
  const {
    tender_id = null,
    assessment_id = null,
    tender_title,
    tender_agency = null,
    tender_deadline = null,
    tender_value = null,
    fit_score = 0,
    stage = "matched",
    notes = null,
    match_reasons = null,
  } = body ?? {};

  if (!tender_title || typeof tender_title !== "string") {
    return NextResponse.json({ error: "tender_title is required" }, { status: 400 });
  }
  if (!isStage(stage)) {
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  }

  const matchReasonsJson = match_reasons ? JSON.stringify(match_reasons) : null;

  const existing = tender_id != null
    ? await sql`
        SELECT id, stage
        FROM pipeline_items
        WHERE user_id = ${guard.user!.id} AND tender_id = ${tender_id}
        ORDER BY id ASC
        LIMIT 1
      `
    : assessment_id != null
      ? await sql`
          SELECT id, stage
          FROM pipeline_items
          WHERE user_id = ${guard.user!.id}
            AND assessment_id = ${assessment_id}
            AND tender_title = ${tender_title}
          ORDER BY id ASC
          LIMIT 1
        `
      : [];

  if (existing.length) {
    const rows = await sql`
      UPDATE pipeline_items SET
        assessment_id = COALESCE(assessment_id, ${assessment_id}),
        tender_title = ${tender_title},
        tender_agency = COALESCE(${tender_agency}, tender_agency),
        tender_deadline = COALESCE(${tender_deadline}, tender_deadline),
        tender_value = COALESCE(${tender_value}, tender_value),
        fit_score = GREATEST(fit_score, ${fit_score}),
        stage = CASE
          WHEN stage = 'matched' THEN ${stage}
          ELSE stage
        END,
        notes = COALESCE(${notes}, notes),
        match_reasons = COALESCE(${matchReasonsJson}::jsonb, match_reasons),
        updated_at = NOW()
      WHERE id = ${existing[0].id as number}
      RETURNING *
    `;

    console.log("[tp:pipeline:seeded]", {
      userId: guard.user!.id,
      stage: rows[0].stage,
      assessmentId: assessment_id,
      tenderId: tender_id,
      action: "updated",
      hasMatchReasons: !!match_reasons,
    });

    return NextResponse.json({ item: rows[0], action: "updated" });
  }

  const rows = await sql`
    INSERT INTO pipeline_items
      (user_id, tender_id, assessment_id, tender_title, tender_agency, tender_deadline,
       tender_value, fit_score, stage, notes, match_reasons)
    VALUES
      (${guard.user!.id}, ${tender_id}, ${assessment_id},
       ${tender_title}, ${tender_agency},
       ${tender_deadline}, ${tender_value}, ${fit_score}, ${stage}, ${notes},
       ${matchReasonsJson}::jsonb)
    RETURNING *
  `;

  console.log("[tp:pipeline:seeded]", {
    userId: guard.user!.id,
    stage,
    assessmentId: assessment_id,
    tenderId: tender_id,
    action: "created",
    hasMatchReasons: !!match_reasons,
  });

  return NextResponse.json({ item: rows[0], action: "created" }, { status: 201 });
}
