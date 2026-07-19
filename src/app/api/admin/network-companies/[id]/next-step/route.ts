import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";
import { readSalesState, type SalesSignalInput } from "@/lib/network/next-steps";
import {
  inferSalesIntelligence,
  type SalesInferenceContext,
  type SalesTenderContext,
  type SalesActivityContext,
} from "@/lib/network/next-steps-llm";

// One Sonnet reasoning call — allow more than the default serverless budget.
export const maxDuration = 60;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function strArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return [];
}

/**
 * POST /api/admin/network-companies/[id]/next-step
 *
 * Computes the deterministic sales read for one prospect, then runs the LLM
 * "push-to-close vs sunset" inference over the prospect's real context (profile,
 * live tenders, activity trail). Read-only: it does not mutate the CRM. Returns
 * `{ read, inference }`. Degrades honestly to the heuristic inference with no key.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid company id" }, { status: 400 });

  const companyRows = await sql`
    SELECT
      id, name, website, services_text, countries, sectors, org_type, ai_analysis,
      profile_status, contact_name, contact_email, contact_linkedin, contact_phone,
      un_buyer, city, notes, is_active, pipeline_stage, ungm_status, created_at
    FROM network_companies WHERE id = ${id} LIMIT 1
  `;
  if (!companyRows.length) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const c = companyRows[0];

  // Live, non-expired matches — the tenders that give the deal a clock.
  const matchRows = await sql`
    SELECT
      m.score, m.status,
      t.title AS tender_title, t.agency AS tender_agency, t.country AS tender_country,
      t.deadline AS tender_deadline, t.opportunity_type AS tender_type, t.status AS tender_status
    FROM network_company_matches m
    JOIN tenders t ON t.id = m.tender_id
    WHERE m.network_company_id = ${id}
      AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
      AND t.deadline >= CURRENT_DATE
    ORDER BY t.deadline ASC NULLS LAST, m.score DESC
    LIMIT 8
  `;

  const activityRows = await sql`
    SELECT kind, body, created_at
    FROM network_company_activity
    WHERE network_company_id = ${id}
    ORDER BY created_at DESC, id DESC
    LIMIT 8
  `;

  // Portfolio-style aggregates for the deterministic engine.
  const aggRows = await sql`
    SELECT
      COUNT(*)::int                                  AS match_count,
      COUNT(*) FILTER (WHERE m.status = 'new')::int  AS fresh_count,
      COALESCE(MAX(m.score), 0)::int                 AS top_score,
      MIN(t.deadline)                                AS nearest_deadline,
      (SELECT MAX(created_at) FROM network_company_activity WHERE network_company_id = ${id}) AS last_activity_at
    FROM network_company_matches m
    JOIN tenders t ON t.id = m.tender_id
    WHERE m.network_company_id = ${id}
      AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
      AND t.deadline >= CURRENT_DATE
  `;
  const agg = aggRows[0] ?? {};

  const signalInput: SalesSignalInput = {
    id: Number(c.id),
    name: String(c.name),
    pipeline_stage: (c.pipeline_stage as string) ?? "lead",
    is_active: Boolean(c.is_active),
    profile_status: (c.profile_status as string | null) ?? null,
    created_at: c.created_at as string,
    last_activity_at: (agg.last_activity_at as string | null) ?? null,
    contact_email: (c.contact_email as string | null) ?? null,
    contact_linkedin: (c.contact_linkedin as string | null) ?? null,
    contact_phone: (c.contact_phone as string | null) ?? null,
    fresh_count: Number(agg.fresh_count) || 0,
    match_count: Number(agg.match_count) || 0,
    top_score: Number(agg.top_score) || 0,
    nearest_deadline: (agg.nearest_deadline as string | null) ?? null,
    ungm_status: (c.ungm_status as string | null) ?? null,
  };

  const read = readSalesState(signalInput);

  const ai = (c.ai_analysis as Record<string, unknown> | null) ?? {};
  const channels = [
    c.contact_email ? "email" : null,
    c.contact_linkedin ? "LinkedIn" : null,
    c.contact_phone ? "phone" : null,
  ].filter(Boolean) as string[];

  const matches: SalesTenderContext[] = matchRows.map((m) => ({
    title: String(m.tender_title ?? ""),
    agency: (m.tender_agency as string | null) ?? null,
    country: (m.tender_country as string | null) ?? null,
    deadline: (m.tender_deadline as string | null) ?? null,
    score: Number(m.score) || 0,
    type: (m.tender_type as string | null) ?? null,
    status: (m.tender_status as string | null) ?? "open",
  }));

  const activities: SalesActivityContext[] = activityRows.map((a) => ({
    kind: String(a.kind ?? "note"),
    body: (a.body as string | null) ?? null,
    created_at: a.created_at as string,
  }));

  const inferenceCtx: SalesInferenceContext = {
    read,
    company: {
      name: String(c.name),
      pipeline_stage: (c.pipeline_stage as string) ?? "lead",
      industry: (ai.detected_industry as string | null) ?? null,
      summary: (ai.summary as string | null) ?? (c.services_text as string | null) ?? null,
      strengths: strArr(ai.strengths),
      gaps: strArr(ai.gaps).length
        ? (ai.gaps as unknown[])
            .map((g) => (g && typeof g === "object" ? String((g as Record<string, unknown>).gap ?? "") : String(g)))
            .filter(Boolean)
        : [],
      countries: strArr(c.countries),
      ungm_status: (c.ungm_status as string | null) ?? null,
      contact_name: (c.contact_name as string | null) ?? null,
      contact_channels: channels,
      notes: (c.notes as string | null) ?? null,
    },
    matches,
    activities,
  };

  const inference = await inferSalesIntelligence(inferenceCtx);

  return NextResponse.json({ read, inference });
}
