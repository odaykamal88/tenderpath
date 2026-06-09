/* GET /api/dashboard/browse — faceted tender search (the full database).
 *
 * Queries the real `tenders` table with search + sector/type/source facets +
 * sort + pagination, and LEFT JOINs the viewer's pipeline so their matched
 * tenders carry a real fit score + "Matched" badge. Unmatched tenders show no
 * fabricated fit — the row's "→" opens the Paste flow to score it on demand.
 * Expired tenders are excluded at the query layer. */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { decodeHtmlEntities } from "@/lib/text/entities";
import type { User } from "@/lib/types";
import type { WbBrowseRow, WbFacet, WbBrowseResult } from "@/lib/workbench/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

function parseList(v: string | null): string[] {
  return v
    ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40)
    : [];
}

function inferType(title: string, opportunityType: string | null): string {
  if (opportunityType) return opportunityType;
  const s = title.toLowerCase();
  if (/\brfp\b/.test(s)) return "Request for Proposal";
  if (/\bitb\b/.test(s)) return "Invitation to Bid";
  if (/\brfq\b/.test(s)) return "Request for Quotation";
  if (/\beoi\b/.test(s)) return "Expression of Interest";
  if (/\blta\b|framework/.test(s)) return "LTA / Framework";
  return "Tender";
}

export async function GET(request: Request) {
  const user = (await getUserFromRequest(request)) as User | null;
  if (!user) {
    return NextResponse.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 120);
  const sectors = parseList(searchParams.get("sector"));
  const types = parseList(searchParams.get("type"));
  const sources = parseList(searchParams.get("source"));
  const matchedOnly = searchParams.get("matched") === "1";
  const sort = searchParams.get("sort") === "fit" ? "fit" : "deadline";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const like = q ? `%${q}%` : null;

  // The viewer's per-tender fit, sourced from their pipeline. Present only for
  // tenders they've actually matched on — never synthesised for the whole DB.
  const join = sql`
    LEFT JOIN (
      SELECT tender_id, MAX(fit_score) AS fit
      FROM pipeline_items
      WHERE user_id = ${user.id} AND tender_id IS NOT NULL
      GROUP BY tender_id
    ) pf ON pf.tender_id = t.id
  `;

  const searchClause = like
    ? sql`AND (t.title ILIKE ${like} OR t.agency ILIKE ${like} OR COALESCE(t.sector, '') ILIKE ${like})`
    : sql``;
  const matchedClause = matchedOnly ? sql`AND pf.fit IS NOT NULL` : sql``;

  // Full WHERE (search + matched + selected facets) for results + count.
  const where = sql`
    WHERE t.status = 'open'
      AND (t.deadline IS NULL OR t.deadline >= CURRENT_DATE)
      ${searchClause}
      ${matchedClause}
      ${sectors.length ? sql`AND t.sector = ANY(${sectors})` : sql``}
      ${types.length ? sql`AND t.opportunity_type = ANY(${types})` : sql``}
      ${sources.length ? sql`AND t.source_name = ANY(${sources})` : sql``}
  `;
  // Facet WHERE (search + matched only) so counts reflect availability rather
  // than collapsing as the user narrows within a group.
  const facetWhere = sql`
    WHERE t.status = 'open'
      AND (t.deadline IS NULL OR t.deadline >= CURRENT_DATE)
      ${searchClause}
      ${matchedClause}
  `;

  try {
    const [countRows, rows, sectorFacet, typeFacet, sourceFacet] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n FROM tenders t ${join} ${where}`,
      sql`
        SELECT t.id, t.reference_id, t.title, t.agency, t.deadline, t.sector, t.country,
               t.opportunity_type, t.source_name, t.estimated_value, t.source_url, pf.fit
        FROM tenders t ${join} ${where}
        ORDER BY ${sort === "fit" ? sql`pf.fit DESC NULLS LAST, t.deadline ASC NULLS LAST` : sql`t.deadline ASC NULLS LAST`}, t.id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `,
      // Exclude malformed sector values that leaked from source data (e.g. a
      // JSON blob {"sector_code":"SG",…} in tenders.sector) so the facet list
      // stays clean.
      sql`SELECT t.sector AS value, COUNT(*)::int AS count FROM tenders t ${join} ${facetWhere} AND t.sector IS NOT NULL AND t.sector <> '' AND t.sector NOT LIKE '{%' AND length(t.sector) <= 60 GROUP BY t.sector ORDER BY count DESC, value LIMIT 30`,
      sql`SELECT t.opportunity_type AS value, COUNT(*)::int AS count FROM tenders t ${join} ${facetWhere} AND t.opportunity_type IS NOT NULL AND t.opportunity_type <> '' GROUP BY t.opportunity_type ORDER BY count DESC, value LIMIT 30`,
      sql`SELECT t.source_name AS value, COUNT(*)::int AS count FROM tenders t ${join} ${facetWhere} AND t.source_name IS NOT NULL AND t.source_name <> '' GROUP BY t.source_name ORDER BY count DESC, value LIMIT 30`,
    ]);

    const tenders: WbBrowseRow[] = rows.map((r) => {
      const fit = r.fit != null ? Number(r.fit) : null;
      const title = decodeHtmlEntities(String(r.title ?? ""));
      return {
        id: r.id as number,
        tenderId: r.id as number,
        code: (r.reference_id as string | null) ?? `T-${r.id}`,
        title,
        agency: decodeHtmlEntities(String(r.agency ?? "")),
        type: inferType(title, (r.opportunity_type as string | null) ?? null),
        source: (r.source_name as string | null) ?? "—",
        deadline: (r.deadline as string | null) ?? null,
        value: (r.estimated_value as string | null) ?? "—",
        sector: (r.sector as string | null) ?? null,
        country: (r.country as string | null) ?? null,
        fit,
        matched: fit != null,
        sourceUrl: (r.source_url as string | null) ?? null,
      };
    });

    const toFacets = (raw: Record<string, unknown>[]): WbFacet[] =>
      raw.map((r) => ({ value: String(r.value), count: Number(r.count) }));

    const result: WbBrowseResult = {
      tenders,
      facets: {
        sector: toFacets(sectorFacet as Record<string, unknown>[]),
        type: toFacets(typeFacet as Record<string, unknown>[]),
        source: toFacets(sourceFacet as Record<string, unknown>[]),
      },
      total: (countRows[0]?.n as number) ?? tenders.length,
      page,
      pageSize: PAGE_SIZE,
    };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[workbench:browse:query_failed]", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Browse query failed" }, { status: 500 });
  }
}
