import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";

// Lightweight count of fresh ('new') matches on still-open tenders for active
// companies — drives the Network nav badge.
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM network_company_matches m
    JOIN tenders t ON t.id = m.tender_id
    JOIN network_companies c ON c.id = m.network_company_id
    WHERE m.status = 'new'
      AND c.is_active = TRUE
      AND t.status = 'open'
      AND COALESCE(t.has_broken_link, false) = false
  `;
  return NextResponse.json({ count: rows[0]?.count ?? 0 });
}
