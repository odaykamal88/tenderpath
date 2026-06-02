import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";

const STATUSES = new Set(["new", "seen", "contacted", "dismissed", "won", "lost"]);

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
  const status = String((body as Record<string, unknown>)?.status ?? "").trim();
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}` }, { status: 400 });
  }

  const updated = await sql`
    UPDATE network_company_matches
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${matchId}
    RETURNING id, network_company_id, tender_id, status, score
  `;
  if (!updated.length) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  return NextResponse.json({ match: updated[0] });
}
