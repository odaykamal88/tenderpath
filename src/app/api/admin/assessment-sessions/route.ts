import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

type AssessmentSessionRow = {
  id: number;
  company_name: string | null;
  email: string | null;
  website: string | null;
  sector: string | null;
  org_type: string | null;
  countries: unknown;
  readiness_score: number | null;
  grant_readiness_score: number | null;
  tender_count: number | string | null;
  grant_count: number | string | null;
  gap_count: number | string | null;
  created_at: string;
  user_id: number | null;
  user_email: string | null;
  user_created_at: string | null;
  email_status: string | null;
  email_error: string | null;
  email_updated_at: string | null;
  pipeline_items: number | string | null;
};

type AttentionCounts = {
  no_matches: number | string | null;
  email_attention: number | string | null;
  no_dashboard: number | string | null;
  logged_in: number | string | null;
};

const SESSION_FILTERS = new Set(["all", "logged_in", "no_matches", "email_attention", "no_dashboard"]);

function toInt(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function normalizeRow(row: AssessmentSessionRow) {
  const tenderCount = toInt(row.tender_count);
  const grantCount = toInt(row.grant_count);
  const gapCount = toInt(row.gap_count);
  return {
    id: row.id,
    company_name: row.company_name,
    email: row.email,
    website: row.website,
    sector: row.sector,
    org_type: row.org_type,
    countries: Array.isArray(row.countries) ? row.countries : [],
    readiness_score: row.readiness_score,
    grant_readiness_score: row.grant_readiness_score,
    tender_count: tenderCount,
    grant_count: grantCount,
    gap_count: gapCount,
    created_at: row.created_at,
    user: row.user_id ? {
      id: row.user_id,
      email: row.user_email,
      created_at: row.user_created_at,
    } : null,
    email_status: row.email_status,
    email_error: row.email_error,
    email_updated_at: row.email_updated_at,
    pipeline_items: toInt(row.pipeline_items),
    completion_state: tenderCount > 0 || grantCount > 0 ? "matched" : "completed_no_matches",
  };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requestedFilter = url.searchParams.get("filter")?.trim() ?? "all";
  const filter = SESSION_FILTERS.has(requestedFilter) ? requestedFilter : "all";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 250);

  const rows = await sql`
    WITH session_rows AS (
      SELECT
        a.id,
        a.company_name,
        a.email,
        a.website,
        a.sector,
        a.org_type,
        a.countries,
        a.readiness_score,
        a.grant_readiness_score,
        CASE WHEN jsonb_typeof(COALESCE(a.matched_tenders, '[]'::jsonb)) = 'array'
          THEN jsonb_array_length(COALESCE(a.matched_tenders, '[]'::jsonb))
          ELSE 0
        END AS tender_count,
        CASE WHEN jsonb_typeof(COALESCE(a.matched_grants, '[]'::jsonb)) = 'array'
          THEN jsonb_array_length(COALESCE(a.matched_grants, '[]'::jsonb))
          ELSE 0
        END AS grant_count,
        CASE WHEN jsonb_typeof(COALESCE(a.gaps, '[]'::jsonb)) = 'array'
          THEN jsonb_array_length(COALESCE(a.gaps, '[]'::jsonb))
          ELSE 0
        END AS gap_count,
        a.created_at,
        u.id AS user_id,
        u.email AS user_email,
        u.created_at AS user_created_at,
        eq.status AS email_status,
        eq.error AS email_error,
        eq.updated_at AS email_updated_at,
        COALESCE(pi.pipeline_items, 0) AS pipeline_items
      FROM assessments a
      LEFT JOIN users u ON lower(u.email) = lower(a.email)
      LEFT JOIN LATERAL (
        SELECT status, error, updated_at
        FROM email_queue
        WHERE assessment_id = a.id
        ORDER BY id DESC
        LIMIT 1
      ) eq ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS pipeline_items
        FROM pipeline_items
        WHERE assessment_id = a.id
      ) pi ON true
    )
    SELECT *
    FROM session_rows
    WHERE
      (
        ${query} = ''
        OR email ILIKE ${`%${query}%`}
        OR company_name ILIKE ${`%${query}%`}
        OR website ILIKE ${`%${query}%`}
      )
      AND (
        ${filter} = 'all'
        OR (${filter} = 'logged_in' AND user_id IS NOT NULL)
        OR (${filter} = 'no_matches' AND tender_count = 0 AND grant_count = 0)
        OR (${filter} = 'email_attention' AND (email_status IS NULL OR email_status NOT IN ('sent', 'delivered')))
        OR (${filter} = 'no_dashboard' AND user_id IS NOT NULL AND pipeline_items = 0)
      )
      ORDER BY created_at DESC
      LIMIT ${limit}
    ` as AssessmentSessionRow[];

  const attentionRows = await sql`
    WITH session_rows AS (
      SELECT
        a.email,
        a.company_name,
        a.website,
        CASE WHEN jsonb_typeof(COALESCE(a.matched_tenders, '[]'::jsonb)) = 'array'
          THEN jsonb_array_length(COALESCE(a.matched_tenders, '[]'::jsonb))
          ELSE 0
        END AS tender_count,
        CASE WHEN jsonb_typeof(COALESCE(a.matched_grants, '[]'::jsonb)) = 'array'
          THEN jsonb_array_length(COALESCE(a.matched_grants, '[]'::jsonb))
          ELSE 0
        END AS grant_count,
        u.id AS user_id,
        eq.status AS email_status,
        COALESCE(pi.pipeline_items, 0) AS pipeline_items
      FROM assessments a
      LEFT JOIN users u ON lower(u.email) = lower(a.email)
      LEFT JOIN LATERAL (
        SELECT status
        FROM email_queue
        WHERE assessment_id = a.id
        ORDER BY id DESC
        LIMIT 1
      ) eq ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS pipeline_items
        FROM pipeline_items
        WHERE assessment_id = a.id
      ) pi ON true
    )
    SELECT
      COUNT(*) FILTER (WHERE tender_count = 0 AND grant_count = 0)::int AS no_matches,
      COUNT(*) FILTER (WHERE email_status IS NULL OR email_status NOT IN ('sent', 'delivered'))::int AS email_attention,
      COUNT(*) FILTER (WHERE user_id IS NOT NULL AND pipeline_items = 0)::int AS no_dashboard,
      COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS logged_in
    FROM session_rows
    WHERE
      ${query} = ''
      OR email ILIKE ${`%${query}%`}
      OR company_name ILIKE ${`%${query}%`}
      OR website ILIKE ${`%${query}%`}
  ` as AttentionCounts[];

  const sessions = rows.map(normalizeRow);
  const attention = attentionRows[0] ?? { no_matches: 0, email_attention: 0, no_dashboard: 0, logged_in: 0 };
  const totals = sessions.reduce((acc, row) => {
    acc.tenders += row.tender_count;
    acc.grants += row.grant_count;
    if (row.user) acc.loggedIn++;
    if (row.pipeline_items > 0) acc.withPipeline++;
    return acc;
  }, { tenders: 0, grants: 0, loggedIn: 0, withPipeline: 0 });

  return NextResponse.json({
    sessions,
    total: sessions.length,
    query,
    filter,
    attention: {
      no_matches: toInt(attention.no_matches),
      email_attention: toInt(attention.email_attention),
      no_dashboard: toInt(attention.no_dashboard),
      logged_in: toInt(attention.logged_in),
    },
    totals,
  });
}
