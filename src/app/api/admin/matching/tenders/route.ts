import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

type TenderRow = {
  id: number;
  title: string;
  agency: string | null;
  country: string | null;
  sector: string | null;
  deadline: string | null;
  estimated_value: string | null;
  source_url: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  reference_id: string | null;
  created_at: string;
  updated_at: string | null;
  match_count: number | string | null;
};

function toInt(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const country = url.searchParams.get("country")?.trim() ?? "";
  const agency = url.searchParams.get("agency")?.trim() ?? "";
  const sector = url.searchParams.get("sector")?.trim() ?? "";
  const deadlineBefore = url.searchParams.get("deadline_before")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 500);

  const rows = (await sql`
    SELECT
      t.id, t.title, t.agency, t.country, t.sector, t.deadline,
      t.estimated_value, t.source_url, t.source_name, t.opportunity_type,
      t.reference_id, t.created_at, t.updated_at,
      COALESCE((
        SELECT COUNT(*)::int FROM tender_vendor_matches m WHERE m.tender_id = t.id
      ), 0) AS match_count
    FROM tenders t
    WHERE t.status = 'open'
      AND COALESCE(t.has_broken_link, false) = false
      AND (
        ${q} = ''
        OR t.title ILIKE ${`%${q}%`}
        OR t.agency ILIKE ${`%${q}%`}
        OR t.reference_id ILIKE ${`%${q}%`}
      )
      AND (${country} = '' OR t.country = ${country})
      AND (${agency} = '' OR t.agency = ${agency})
      AND (${sector} = '' OR t.sector = ${sector})
      AND (
        NULLIF(${deadlineBefore}, '') IS NULL
        OR (t.deadline IS NOT NULL AND t.deadline <= NULLIF(${deadlineBefore}, '')::date)
      )
    ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC
    LIMIT ${limit}
  `) as TenderRow[];

  const [countriesRows, agenciesRows, sectorsRows] = await Promise.all([
    sql`
      SELECT DISTINCT country FROM tenders
      WHERE status = 'open' AND country IS NOT NULL AND country <> ''
      ORDER BY country ASC
    `,
    sql`
      SELECT DISTINCT agency FROM tenders
      WHERE status = 'open' AND agency IS NOT NULL AND agency <> ''
      ORDER BY agency ASC
    `,
    sql`
      SELECT DISTINCT sector FROM tenders
      WHERE status = 'open' AND sector IS NOT NULL AND sector <> ''
      ORDER BY sector ASC
    `,
  ]);

  return NextResponse.json({
    tenders: rows.map((r) => ({
      id: r.id,
      title: r.title,
      agency: r.agency,
      country: r.country,
      sector: r.sector,
      deadline: r.deadline,
      estimated_value: r.estimated_value,
      source_url: r.source_url,
      source_name: r.source_name,
      opportunity_type: r.opportunity_type,
      reference_id: r.reference_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      match_count: toInt(r.match_count),
    })),
    total: rows.length,
    filters: {
      countries: countriesRows.map((r) => r.country as string),
      agencies: agenciesRows.map((r) => r.agency as string),
      sectors: sectorsRows.map((r) => r.sector as string),
    },
    applied: { q, country, agency, sector, deadlineBefore, limit },
  });
}
