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

  // Count distinct fresh opportunity groups, not raw match rows. If any crawler
  // copy of the same opportunity has already been actioned, the group is no
  // longer fresh; otherwise another duplicate copy would reappear in the nav
  // badge after an operator marked the first one contacted/dismissed.
  const rows = await sql`
    WITH opportunity_groups AS (
      SELECT
        m.network_company_id,
        LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) AS title_key,
        LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) AS agency_key,
        t.deadline::date AS deadline_day,
        BOOL_AND(m.status = 'new') AS all_new
      FROM network_company_matches m
      JOIN tenders t ON t.id = m.tender_id
      JOIN network_companies c ON c.id = m.network_company_id
      WHERE c.is_active = TRUE
        AND t.status = 'open'
        AND COALESCE(t.has_broken_link, false) = false
        AND t.deadline >= CURRENT_DATE
      GROUP BY m.network_company_id, title_key, agency_key, deadline_day
    )
    SELECT COUNT(*)::int AS count
    FROM opportunity_groups
    WHERE all_new = TRUE
  `;
  return NextResponse.json({ count: rows[0]?.count ?? 0 });
}
