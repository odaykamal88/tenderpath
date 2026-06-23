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

  // Count DISTINCT (company, opportunity), not raw match rows: cross-posted
  // duplicates (same opportunity under different reference_ids → separate tenders
  // rows) would otherwise inflate this badge above the deduped worklist on the
  // Network page. Key mirrors dedupeTenders(): normalized title+agency+deadline.
  const rows = await sql`
    SELECT COUNT(DISTINCT (
      m.network_company_id::text || '|' ||
      LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
      LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
      COALESCE(t.deadline::date::text, '')
    ))::int AS count
    FROM network_company_matches m
    JOIN tenders t ON t.id = m.tender_id
    JOIN network_companies c ON c.id = m.network_company_id
    WHERE m.status = 'new'
      AND c.is_active = TRUE
      AND t.status = 'open'
      AND COALESCE(t.has_broken_link, false) = false
      AND t.deadline >= CURRENT_DATE
  `;
  return NextResponse.json({ count: rows[0]?.count ?? 0 });
}
