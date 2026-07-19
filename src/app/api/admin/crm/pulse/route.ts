import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";
import type { SalesSignalInput } from "@/lib/network/next-steps";

/**
 * Founder-sales command center pulse (/admin/crm).
 *
 * Returns one lean row per network company with the relationship state + live
 * TenderPath match signals the deterministic engine (src/lib/network/next-steps.ts)
 * reasons over: pipeline stage, last touch, contact channels, and — critically —
 * the nearest open-tender deadline that puts a clock on the deal. No LLM here;
 * the command view computes every read client-side from this data, instantly.
 * The per-contact LLM "close-or-sunset" inference is a separate on-demand call.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const rows = await sql`
    SELECT
      c.id, c.name, c.pipeline_stage, c.is_active, c.profile_status, c.created_at,
      c.contact_email, c.contact_linkedin, c.contact_phone, c.ungm_status,
      c.ai_analysis->>'detected_industry' AS detected_industry,
      act.last_activity_at,
      COALESCE(m.match_count, 0)::int  AS match_count,
      COALESCE(m.fresh_count, 0)::int  AS fresh_count,
      COALESCE(m.top_score, 0)::int    AS top_score,
      m.nearest_deadline
    FROM network_companies c
    LEFT JOIN (
      SELECT network_company_id, MAX(created_at) AS last_activity_at
      FROM network_company_activity
      GROUP BY network_company_id
    ) act ON act.network_company_id = c.id
    LEFT JOIN (
      SELECT
        mm.network_company_id,
        COUNT(*)                                         AS match_count,
        COUNT(*) FILTER (WHERE mm.status = 'new')        AS fresh_count,
        MAX(mm.score)                                    AS top_score,
        MIN(t.deadline)                                  AS nearest_deadline
      FROM network_company_matches mm
      JOIN tenders t ON t.id = mm.tender_id
      WHERE t.status = 'open'
        AND COALESCE(t.has_broken_link, false) = false
        AND t.deadline >= CURRENT_DATE
      GROUP BY mm.network_company_id
    ) m ON m.network_company_id = c.id
    ORDER BY c.is_active DESC, COALESCE(m.top_score, 0) DESC, c.created_at DESC
  `;

  const companies: (SalesSignalInput & { detected_industry: string | null })[] = rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    pipeline_stage: (r.pipeline_stage as string) ?? "lead",
    is_active: Boolean(r.is_active),
    profile_status: (r.profile_status as string | null) ?? null,
    created_at: r.created_at as string,
    last_activity_at: (r.last_activity_at as string | null) ?? null,
    contact_email: (r.contact_email as string | null) ?? null,
    contact_linkedin: (r.contact_linkedin as string | null) ?? null,
    contact_phone: (r.contact_phone as string | null) ?? null,
    fresh_count: Number(r.fresh_count) || 0,
    match_count: Number(r.match_count) || 0,
    top_score: Number(r.top_score) || 0,
    nearest_deadline: (r.nearest_deadline as string | null) ?? null,
    ungm_status: (r.ungm_status as string | null) ?? null,
    detected_industry: (r.detected_industry as string | null) ?? null,
  }));

  return NextResponse.json({ companies, generatedAt: new Date().toISOString() });
}
