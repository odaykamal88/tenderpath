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

  const rows = await sql`
    SELECT id, tender_id, tender_title, tender_agency, tender_deadline,
           tender_value, fit_score, stage, position, notes, updated_at
    FROM pipeline_items
    WHERE user_id = ${guard.user!.id}
    ORDER BY stage, position, id
  `;

  return NextResponse.json({ items: rows, access: guard.access });
}

export async function POST(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const body = await request.json();
  const {
    tender_id = null,
    tender_title,
    tender_agency = null,
    tender_deadline = null,
    tender_value = null,
    fit_score = 0,
    stage = "matched",
    notes = null,
  } = body ?? {};

  if (!tender_title || typeof tender_title !== "string") {
    return NextResponse.json({ error: "tender_title is required" }, { status: 400 });
  }
  if (!isStage(stage)) {
    return NextResponse.json({ error: "invalid stage" }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO pipeline_items
      (user_id, tender_id, tender_title, tender_agency, tender_deadline,
       tender_value, fit_score, stage, notes)
    VALUES
      (${guard.user!.id}, ${tender_id}, ${tender_title}, ${tender_agency},
       ${tender_deadline}, ${tender_value}, ${fit_score}, ${stage}, ${notes})
    RETURNING *
  `;

  return NextResponse.json({ item: rows[0] }, { status: 201 });
}
