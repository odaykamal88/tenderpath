import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureNetworkMatchingColumns } from "@/lib/network/schema";
import { buildNetworkCompanyProfile } from "@/lib/network/profile";
import { matchNetworkCompany } from "@/lib/network/match";

// PATCH may re-crawl + re-analyze when the website/services change.
export const maxDuration = 120;

function cleanStr(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid company id" }, { status: 400 });

  const companyRows = await sql`
    SELECT
      id, name, website, services_text, countries, sectors, org_type,
      ai_analysis, crawled_data, profile_status, profile_error,
      contact_name, contact_title, contact_email, contact_email_status, contact_phone,
      contact_linkedin, un_buyer, city, notes, is_active, pipeline_stage,
      ungm_status, share_token,
      last_matched_at, created_at, updated_at
    FROM network_companies WHERE id = ${id} LIMIT 1
  `;
  if (!companyRows.length) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const matches = await sql`
    WITH match_rows AS (
      SELECT
        m.id, m.tender_id, m.score, m.structured_reasons, m.match_reasons, m.status, m.dismiss_reason,
        m.first_seen_at, m.last_scored_at, m.updated_at,
        t.title AS tender_title, t.agency AS tender_agency, t.country AS tender_country,
        t.sector AS tender_sector, t.deadline AS tender_deadline,
        t.estimated_value AS tender_value, t.source_url AS tender_source_url,
        t.source_name AS tender_source_name,
        t.reference_id AS tender_reference, t.opportunity_type AS tender_type,
        LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) AS title_key,
        LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) AS agency_key,
        t.deadline::date AS deadline_day
      FROM network_company_matches m
      JOIN tenders t ON t.id = m.tender_id
      WHERE m.network_company_id = ${id}
        AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
        AND t.deadline >= CURRENT_DATE
    ),
    opportunity_groups AS (
      SELECT
        title_key, agency_key, deadline_day,
        COUNT(*)::int AS duplicate_count,
        ARRAY_AGG(id ORDER BY score DESC, id DESC) AS duplicate_match_ids,
        COALESCE(ARRAY_AGG(DISTINCT tender_source_name) FILTER (WHERE tender_source_name IS NOT NULL AND tender_source_name <> ''), '{}'::text[]) AS source_names
      FROM match_rows
      GROUP BY title_key, agency_key, deadline_day
    ),
    ranked AS (
      SELECT
        r.*,
        g.duplicate_count,
        g.duplicate_match_ids,
        g.source_names,
        ROW_NUMBER() OVER (
          PARTITION BY r.title_key, r.agency_key, r.deadline_day
          ORDER BY
            CASE r.status
              WHEN 'paid' THEN 100
              WHEN 'booked' THEN 90
              WHEN 'replied' THEN 80
              WHEN 'contacted' THEN 70
              WHEN 'won' THEN 60
              WHEN 'lost' THEN 55
              WHEN 'not_relevant' THEN 50
              WHEN 'dismissed' THEN 45
              WHEN 'seen' THEN 20
              WHEN 'new' THEN 10
              ELSE 0
            END DESC,
            r.score DESC,
            r.id DESC
        ) AS rn
      FROM match_rows r
      JOIN opportunity_groups g
        ON g.title_key = r.title_key
       AND g.agency_key = r.agency_key
       AND g.deadline_day IS NOT DISTINCT FROM r.deadline_day
    )
    SELECT * FROM ranked
    WHERE rn = 1
    ORDER BY tender_deadline ASC NULLS LAST, score DESC
  `;

  const activities = await sql`
    SELECT a.id, a.kind, a.body, a.created_at, u.email AS author_email
    FROM network_company_activity a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.network_company_id = ${id}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 200
  `;

  return NextResponse.json({ company: companyRows[0], matches, activities });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid company id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const existingRows = await sql`SELECT * FROM network_companies WHERE id = ${id} LIMIT 1`;
  if (!existingRows.length) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const existing = existingRows[0];

  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const name = has("name") ? cleanStr(b.name, 200) ?? String(existing.name) : String(existing.name);
  const website = has("website") ? cleanStr(b.website, 500) : (existing.website as string | null);
  const servicesText = has("services_text") ? cleanStr(b.services_text, 4000) : (existing.services_text as string | null);
  const countries = has("countries") ? toStringArray(b.countries) : ((existing.countries as string[]) ?? []);
  const sectors = has("sectors") ? toStringArray(b.sectors) : ((existing.sectors as string[]) ?? []);
  const orgType = has("org_type") ? cleanStr(b.org_type, 100) : (existing.org_type as string | null);
  const contactName = has("contact_name") ? cleanStr(b.contact_name, 200) : (existing.contact_name as string | null);
  const contactTitle = has("contact_title") ? cleanStr(b.contact_title, 200) : (existing.contact_title as string | null);
  const contactEmail = has("contact_email") ? cleanStr(b.contact_email, 320) : (existing.contact_email as string | null);
  const contactEmailStatus = has("contact_email_status") ? cleanStr(b.contact_email_status, 40) : (existing.contact_email_status as string | null);
  const contactPhone = has("contact_phone") ? cleanStr(b.contact_phone, 50) : (existing.contact_phone as string | null);
  const contactLinkedin = has("contact_linkedin") ? cleanStr(b.contact_linkedin, 500) : (existing.contact_linkedin as string | null);
  const unBuyer = has("un_buyer") ? cleanStr(b.un_buyer, 300) : (existing.un_buyer as string | null);
  const city = has("city") ? cleanStr(b.city, 120) : (existing.city as string | null);
  const notes = has("notes") ? cleanStr(b.notes, 4000) : (existing.notes as string | null);
  const isActive = has("is_active") ? Boolean(b.is_active) : Boolean(existing.is_active);
  // Operator-recorded UNGM status. Validated against the allowlist; anything else
  // falls back to the existing value (never silently writes garbage). No re-crawl.
  const UNGM_STATUSES = ["unknown", "not_registered", "basic", "level-1", "level-2"];
  const ungmStatus = has("ungm_status") && UNGM_STATUSES.includes(String(b.ungm_status))
    ? String(b.ungm_status)
    : ((existing.ungm_status as string | null) ?? "unknown");
  // Company-level CRM pipeline stage. Same allowlist-or-keep-existing discipline.
  const PIPELINE_STAGES = ["lead", "contacted", "replied", "meeting", "proposal", "won", "lost"];
  const prevStage = (existing.pipeline_stage as string | null) ?? "lead";
  const pipelineStage = has("pipeline_stage") && PIPELINE_STAGES.includes(String(b.pipeline_stage))
    ? String(b.pipeline_stage)
    : prevStage;

  await sql`
    UPDATE network_companies SET
      name = ${name}, website = ${website}, services_text = ${servicesText},
      countries = ${JSON.stringify(countries)}::jsonb, sectors = ${JSON.stringify(sectors)}::jsonb,
      org_type = ${orgType}, contact_name = ${contactName}, contact_title = ${contactTitle},
      contact_email = ${contactEmail}, contact_email_status = ${contactEmailStatus},
      contact_phone = ${contactPhone}, contact_linkedin = ${contactLinkedin},
      un_buyer = ${unBuyer}, city = ${city}, notes = ${notes}, is_active = ${isActive},
      ungm_status = ${ungmStatus}, pipeline_stage = ${pipelineStage}, updated_at = NOW()
    WHERE id = ${id}
  `;

  // Log a pipeline move to the activity trail so the CRM timeline shows it.
  if (pipelineStage !== prevStage) {
    await sql`
      INSERT INTO network_company_activity (network_company_id, kind, body, created_by)
      VALUES (${id}, 'stage_change', ${`Stage: ${prevStage} → ${pipelineStage}`}, ${guard.user?.id ?? null})
    `;
  }

  // Re-crawl/re-analyze only when the inputs that shape the profile changed;
  // re-match when the profile changed or the country scope changed.
  const websiteChanged = (website ?? "") !== ((existing.website as string | null) ?? "");
  const servicesChanged = (servicesText ?? "") !== ((existing.services_text as string | null) ?? "");
  const orgChanged = (orgType ?? "") !== ((existing.org_type as string | null) ?? "");
  const countriesChanged = JSON.stringify(countries) !== JSON.stringify((existing.countries as string[]) ?? []);
  const profileDirty = websiteChanged || servicesChanged || orgChanged;

  let profile: { status: string; error: string | null } | null = null;
  let match = null;
  if (profileDirty) {
    const res = await buildNetworkCompanyProfile({ id, website, services_text: servicesText, countries, sectors, org_type: orgType });
    profile = { status: res.status, error: res.error ?? null };
  }
  const ready = profileDirty ? profile?.status === "ready" : existing.profile_status === "ready";
  if (ready && (profileDirty || countriesChanged)) {
    match = await matchNetworkCompany(id);
  }

  const rows = await sql`
    SELECT
      id, name, website, services_text, countries, sectors, org_type,
      ai_analysis, crawled_data, profile_status, profile_error,
      contact_name, contact_title, contact_email, contact_email_status, contact_phone,
      contact_linkedin, un_buyer, city, notes, is_active, pipeline_stage,
      ungm_status, share_token,
      last_matched_at, created_at, updated_at
    FROM network_companies WHERE id = ${id} LIMIT 1
  `;
  return NextResponse.json({ company: rows[0], profile, match });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureNetworkMatchingColumns();

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: "Invalid company id" }, { status: 400 });

  // Cascade removes the company's matches (FK ON DELETE CASCADE).
  await sql`DELETE FROM network_companies WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
