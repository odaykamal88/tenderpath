import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import {
  buildAgencyHarmonization,
  canonicalAgency,
  harmonizeFacetValues,
  resolveAgencyRaws,
} from "@/lib/crawlers/agency-map";

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

function parseList(v: string | null | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  // Country is now multi-select: a comma list of exact (case-insensitive)
  // country names picked from the harmonized suggestions.
  const countries = parseList(url.searchParams.get("country"));
  // Agency + sector are now multi-select too (comma lists), mirroring country.
  const agencies = parseList(url.searchParams.get("agency"));
  const sectors = parseList(url.searchParams.get("sector"));
  // Minimum lead time: only surface tenders whose deadline is at least N days
  // out, so there's still time to actually apply. 0 (or absent) = no floor,
  // which also lets through past-deadline and no-deadline rows (legacy view).
  // This replaces the old absolute `deadline_before` date field in the UI.
  const minDays = Math.max(0, Math.floor(Number(url.searchParams.get("min_days") ?? 0)) || 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 500);

  // Resolve the harmonized filter universe first so the agency predicate can map
  // a canonical label ("UN Development Programme (UNDP)") back to every raw
  // variant in the DB, and the suggestion lists come back deduplicated.
  const [countriesRows, agenciesRows, sectorsRows] = await Promise.all([
    sql`
      SELECT DISTINCT country FROM tenders
      WHERE status = 'open' AND COALESCE(has_broken_link, false) = false
        AND country IS NOT NULL AND country <> ''
    `,
    sql`
      SELECT DISTINCT agency FROM tenders
      WHERE status = 'open' AND COALESCE(has_broken_link, false) = false
        AND agency IS NOT NULL AND agency <> ''
    `,
    sql`
      SELECT DISTINCT sector FROM tenders
      WHERE status = 'open' AND COALESCE(has_broken_link, false) = false
        AND sector IS NOT NULL AND sector <> ''
    `,
  ]);

  const { labels: agencyLabels, canonicalToRaws } = buildAgencyHarmonization(
    agenciesRows.map((r) => r.agency as string | null),
  );

  const countriesLc = countries.map((c) => c.toLowerCase());
  const countryClause = countriesLc.length ? sql`AND LOWER(t.country) = ANY(${countriesLc})` : sql``;

  // Each requested agency is either a canonical label (→ resolve to every raw
  // variant present in the DB, exact match) or free-typed text (→ partial
  // ILIKE). Collect both kinds across all picks and OR them into one predicate.
  const agencyRaws: string[] = [];
  const agencyIlike: string[] = [];
  for (const a of agencies) {
    const raws = resolveAgencyRaws(a, canonicalToRaws);
    if (raws && raws.length) agencyRaws.push(...raws);
    else agencyIlike.push(`%${a}%`);
  }
  const agencyClause =
    agencyRaws.length && agencyIlike.length
      ? sql`AND (t.agency = ANY(${agencyRaws}) OR t.agency ILIKE ANY(${agencyIlike}))`
      : agencyRaws.length
        ? sql`AND t.agency = ANY(${agencyRaws})`
        : agencyIlike.length
          ? sql`AND t.agency ILIKE ANY(${agencyIlike})`
          : sql``;

  // Sector stays free-text matched (numeric/JSON-coded values are dropped from
  // the suggestion list): a partial ILIKE per requested sector, OR'd together.
  const sectorIlike = sectors.map((s) => `%${s}%`);
  const sectorClause = sectorIlike.length ? sql`AND t.sector ILIKE ANY(${sectorIlike})` : sql``;

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
      ${countryClause}
      ${agencyClause}
      ${sectorClause}
      AND (
        ${minDays} <= 0
        OR (t.deadline IS NOT NULL AND t.deadline >= CURRENT_DATE + (${minDays})::int)
      )
    ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC
    LIMIT ${limit}
  `) as TenderRow[];

  return NextResponse.json({
    tenders: rows.map((r) => ({
      id: r.id,
      title: r.title,
      // Show the harmonized agency so the column matches the filter labels.
      agency: canonicalAgency(r.agency) ?? r.agency,
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
      countries: harmonizeFacetValues(countriesRows.map((r) => r.country as string | null)),
      agencies: agencyLabels,
      sectors: harmonizeFacetValues(sectorsRows.map((r) => r.sector as string | null), { dropCoded: true }),
    },
    applied: { q, country: countries.join(","), agency: agencies.join(","), sector: sectors.join(","), minDays, limit },
  });
}
