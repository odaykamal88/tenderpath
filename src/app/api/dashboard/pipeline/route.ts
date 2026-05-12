import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";

const STAGES = ["matched", "evaluating", "preparing", "submitted", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

let pipelineColumnsEnsured = false;
async function ensurePipelineColumns() {
  if (pipelineColumnsEnsured) return;
  await sql`ALTER TABLE pipeline_items ADD COLUMN IF NOT EXISTS source_url TEXT`;
  pipelineColumnsEnsured = true;
}

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  await ensurePipelineColumns();
  const userId = guard.user!.id;
  const { searchParams } = new URL(request.url);
  const stageFilter = searchParams.get("stage");
  const excludeNotRelevant = searchParams.get("exclude_dismissed") !== "false";

  // Purge expired active-stage items on read so the pipeline stays current.
  // submitted/won/lost are kept as historical records regardless of deadline.
  const purged = await sql`
    DELETE FROM pipeline_items
    WHERE user_id = ${userId}
      AND tender_deadline IS NOT NULL
      AND tender_deadline < NOW()
      AND stage IN ('matched', 'evaluating', 'preparing')
    RETURNING id, tender_title, stage
  `;
  if (purged.length > 0) {
    console.log("[tp:pipeline:expired_purged]", {
      userId,
      count: purged.length,
      titles: purged.map((r) => r.tender_title),
    });
  }

  // Load user's not_relevant feedback to exclude those pipeline items
  const feedbackRows = await sql`
    SELECT tender_id FROM user_tender_feedback
    WHERE user_id = ${userId} AND status = 'not_relevant'
  `;
  const dismissedTenderIds = new Set(feedbackRows.map((r) => r.tender_id as number));

  const rows = await sql`
    SELECT
      pi.id, pi.tender_id, pi.tender_title, pi.tender_agency, pi.tender_deadline,
      pi.tender_value, pi.source_url AS manual_source_url, pi.fit_score, pi.stage, pi.position, pi.notes, pi.match_reasons,
      pi.assessment_id, pi.updated_at,
      t.source_name, COALESCE(t.source_url, pi.source_url) AS source_url,
      t.opportunity_type, t.sector AS tender_sector,
      t.created_at AS tender_created_at, t.updated_at AS tender_updated_at,
      t.has_broken_link,
      COALESCE(pi.tender_value, t.estimated_value) AS display_value
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    WHERE pi.user_id = ${userId}
    ${stageFilter && isStage(stageFilter) ? sql`AND pi.stage = ${stageFilter}` : sql``}
    ORDER BY pi.stage, pi.position, pi.id
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

  await ensurePipelineColumns();
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
    source_url = null,
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
        source_url = COALESCE(${source_url}, source_url),
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
       tender_value, source_url, fit_score, stage, notes, match_reasons)
    VALUES
      (${guard.user!.id}, ${tender_id}, ${assessment_id},
       ${tender_title}, ${tender_agency},
       ${tender_deadline}, ${tender_value}, ${source_url}, ${fit_score}, ${stage}, ${notes},
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
