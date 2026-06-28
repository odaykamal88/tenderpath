import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";

const STATUSES = new Set([
  "new",
  "seen",
  "contacted",
  "replied",
  "booked",
  "paid",
  "not_relevant",
  "dismissed",
  "won",
  "lost",
]);

export async function PATCH(request: Request, context: { params: Promise<{ matchId: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { matchId: rawId } = await context.params;
  const matchId = Number(rawId);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return NextResponse.json({ error: "Invalid match id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const status = String(b.status ?? "").trim();
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}` }, { status: 400 });
  }
  // Optional free-text reason (mainly for dismissals) — only overwrites when
  // a `reason` key is present, so a plain status change preserves any prior note.
  const hasReason = Object.prototype.hasOwnProperty.call(b, "reason");
  const reason = hasReason ? (b.reason == null ? null : (String(b.reason).trim().slice(0, 2000) || null)) : undefined;

  const updated = await sql`
    WITH target AS (
      SELECT
        m.network_company_id,
        LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) AS title_key,
        LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) AS agency_key,
        t.deadline::date AS deadline_day
      FROM network_company_matches m
      JOIN tenders t ON t.id = m.tender_id
      WHERE m.id = ${matchId}
      LIMIT 1
    ),
    updated AS (
      UPDATE network_company_matches m
      SET status = ${status},
          dismiss_reason = CASE WHEN ${hasReason} THEN ${reason ?? null} ELSE dismiss_reason END,
          updated_at = NOW()
      FROM target, tenders t
      WHERE m.network_company_id = target.network_company_id
        AND t.id = m.tender_id
        AND LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) = target.title_key
        AND LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) = target.agency_key
        AND t.deadline::date IS NOT DISTINCT FROM target.deadline_day
      RETURNING m.id, m.network_company_id, m.tender_id, m.status, m.score, m.dismiss_reason
    )
    SELECT * FROM updated
    ORDER BY CASE WHEN id = ${matchId} THEN 0 ELSE 1 END, score DESC, id DESC
  `;
  if (!updated.length) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  return NextResponse.json({ match: updated[0], updated_count: updated.length });
}
