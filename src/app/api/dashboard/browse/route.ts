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
import { rawSectorToSlug, sectorDisplayLabel, userSectorSlugs, type SectorSlug } from "@/lib/crawlers/sector-map";
import { buildAgencyHarmonization, canonicalAgency, harmonizeFacetValues, resolveAgencyRaws } from "@/lib/crawlers/agency-map";
import { expandCountrySet } from "@/lib/assessment/match";
import type { AIAnalysis, User } from "@/lib/types";
import type { WbBrowseRow, WbFacet, WbBrowseResult } from "@/lib/workbench/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
// Tenders tagged "global" never get geo-filtered out of a "relevant to me" view.
const GLOBAL_COUNTRY_TOKENS = ["global", "worldwide", "multiple", "various"];

function parseList(v: string | null): string[] {
  return v
    ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40)
    : [];
}

// The viewer's profile (sector slugs + countries) from their latest completed
// assessment — used only for the off-by-default "Relevant to me" scope. Best-
// effort: a miss just means that filter degrades to no-op.
async function loadViewerProfile(email: string): Promise<{ slugs: Set<SectorSlug>; countries: string[] }> {
  try {
    const rows = await sql`
      SELECT ai_analysis, countries FROM assessments
      WHERE email = ${email} AND assessment_status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `;
    const row = rows[0];
    if (!row) return { slugs: new Set(), countries: [] };
    const analysis = row.ai_analysis as AIAnalysis | null;
    const slugs = userSectorSlugs(analysis?.detected_industry ?? null, analysis?.sectors ?? null);
    const countries = Array.isArray(row.countries)
      ? row.countries.filter((c): c is string => typeof c === "string")
      : [];
    return { slugs, countries };
  } catch {
    return { slugs: new Set(), countries: [] };
  }
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
  // Admin-matching-style filters: multi-country (exact, case-insensitive), a
  // canonical-aware agency, and a minimum lead-time floor.
  const countries = parseList(searchParams.get("country"));
  const agencyParam = (searchParams.get("agency") ?? "").trim().slice(0, 120);
  const minDays = Math.max(0, Math.floor(Number(searchParams.get("min_days") ?? 0)) || 0);
  const matchedOnly = searchParams.get("matched") === "1";
  const relevant = searchParams.get("relevant") === "1";
  // Deadline is the honest API default: callers must explicitly request fit.
  // The assessed Workbench does so; unassessed users never get implied ranking.
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

  // Facet WHERE (search + matched only) so counts reflect availability rather
  // than collapsing as the user narrows within a group. The full results WHERE
  // (adds sector / type / source / relevance) is assembled in the try block once
  // the raw→canonical sector map is built.
  const facetWhere = sql`
    WHERE t.status = 'open'
      AND (t.deadline IS NULL OR t.deadline >= CURRENT_DATE)
      ${searchClause}
      ${matchedClause}
  `;

  try {
    // The maintained key is produced by dedupKey() during upsert/backfill. It
    // canonicalizes agency aliases (UNDP ↔ UNDP-KHM) and preserves explicit lot
    // or amendment markers. The fallback only covers legacy rows not yet touched
    // by the crawler migration; the production reconcile removes that condition.
    const dupKeyT = sql`COALESCE(NULLIF(t.dedup_key, ''), 'legacy:' || t.id::text)`;

    // 1) Harmonize the sector universe. Pull the full raw grouping (no LIMIT,
    //    excluding leaked JSON blobs) under the facet scope, then collapse every
    //    variant that maps to the same canonical slug ("it" / "Information
    //    Technology" / a NAICS code → one label) and remember which raw values
    //    back each label and slug so a selection — or the relevance filter — can
    //    translate back to a real `t.sector` predicate.
    const sectorRaw = (await sql`
      SELECT t.sector AS value, COUNT(DISTINCT ${dupKeyT})::int AS count
      FROM tenders t ${join} ${facetWhere}
        AND t.sector IS NOT NULL AND t.sector <> '' AND t.sector NOT LIKE '{%' AND length(t.sector) <= 60
      GROUP BY t.sector
    `) as { value: string; count: number }[];

    const labelCounts = new Map<string, number>();
    const labelToRaws = new Map<string, string[]>();
    const slugToRaws = new Map<SectorSlug, string[]>();
    for (const r of sectorRaw) {
      const rawVal = String(r.value);
      const label = sectorDisplayLabel(rawVal);
      if (!label) continue;
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + Number(r.count));
      const raws = labelToRaws.get(label) ?? [];
      raws.push(rawVal);
      labelToRaws.set(label, raws);
      const slug = rawSectorToSlug(rawVal);
      if (slug) {
        const sr = slugToRaws.get(slug) ?? [];
        sr.push(rawVal);
        slugToRaws.set(slug, sr);
      }
    }
    const sectorFacets: WbFacet[] = [...labelCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 24);

    // 2) Selected canonical sector labels → the raw values that back them.
    // A picked canonical label resolves to its raw variants (exact ANY). A single
    // free-typed value the type-ahead didn't recognise gets a forgiving partial
    // match, mirroring the admin matching page. Multi-select keeps exact ANY.
    const knownSectorRaws = sectors.flatMap((label) => labelToRaws.get(label) ?? []);
    const unknownSectors = sectors.filter((label) => !labelToRaws.has(label));
    let sectorClause = sql``;
    if (sectors.length) {
      if (knownSectorRaws.length === 0 && unknownSectors.length === 1) {
        sectorClause = sql`AND t.sector ILIKE ${`%${unknownSectors[0]}%`}`;
      } else {
        sectorClause = sql`AND t.sector = ANY(${knownSectorRaws.length ? knownSectorRaws : sectors})`;
      }
    }

    // 3) "Relevant to me" (off by default): the viewer's own sectors AND a
    //    lenient geography (their countries + alias expansion + global/unscoped).
    let relevantClause = sql``;
    if (relevant) {
      const profile = await loadViewerProfile(user.email);
      const relevantRaws = [...profile.slugs].flatMap((s) => slugToRaws.get(s) ?? []);
      const sectorRel = relevantRaws.length ? sql`AND t.sector = ANY(${relevantRaws})` : sql`AND FALSE`;
      const expanded = [...expandCountrySet(profile.countries)].map((c) => c.toLowerCase());
      const countryRel = expanded.length
        ? sql`AND (t.country IS NULL OR LOWER(t.country) = ANY(${expanded}) OR LOWER(t.country) = ANY(${GLOBAL_COUNTRY_TOKENS}))`
        : sql``;
      relevantClause = sql`${sectorRel} ${countryRel}`;
    }

    // 4) Country + agency: harmonized suggestion lists (under the facet scope) +
    //    predicates. Country is exact multi-select; agency maps a canonical label
    //    back to its raw variants, falling back to ILIKE for free-typed text.
    const [countryDistinct, agencyDistinct] = await Promise.all([
      sql`SELECT DISTINCT t.country AS value FROM tenders t ${join} ${facetWhere} AND t.country IS NOT NULL AND t.country <> ''`,
      sql`SELECT DISTINCT t.agency AS value FROM tenders t ${join} ${facetWhere} AND t.agency IS NOT NULL AND t.agency <> ''`,
    ]);
    const countryLabels = harmonizeFacetValues((countryDistinct as { value: string }[]).map((r) => r.value));
    const { labels: agencyLabels, canonicalToRaws } = buildAgencyHarmonization(
      (agencyDistinct as { value: string }[]).map((r) => r.value),
    );

    const countriesLc = countries.map((c) => c.toLowerCase());
    const countryClause = countriesLc.length ? sql`AND LOWER(t.country) = ANY(${countriesLc})` : sql``;
    const agencyRaws = agencyParam ? resolveAgencyRaws(agencyParam, canonicalToRaws) : null;
    const agencyClause = agencyRaws
      ? sql`AND t.agency = ANY(${agencyRaws})`
      : agencyParam
        ? sql`AND t.agency ILIKE ${`%${agencyParam}%`}`
        : sql``;
    const minDaysClause = minDays > 0 ? sql`AND t.deadline IS NOT NULL AND t.deadline >= CURRENT_DATE + (${minDays})::int` : sql``;

    // Full results/count WHERE: facet scope + sector selection + relevance +
    // country / agency / min-days + the exact-match type/source facets.
    const where = sql`
      WHERE t.status = 'open'
        AND (t.deadline IS NULL OR t.deadline >= CURRENT_DATE)
        ${searchClause}
        ${matchedClause}
        ${sectorClause}
        ${relevantClause}
        ${countryClause}
        ${agencyClause}
        ${minDaysClause}
        ${types.length ? sql`AND t.opportunity_type = ANY(${types})` : sql``}
        ${sources.length ? sql`AND t.source_name = ANY(${sources})` : sql``}
    `;

    // Page ordering is applied AFTER the dedup CTE, so it references the deduped
    // columns (unprefixed) rather than the t. / pf. aliases.
    const orderByOuter = sort === "fit"
      ? sql`fit DESC NULLS LAST, deadline ASC NULLS LAST`
      : sql`deadline ASC NULLS LAST`;

    const [countRows, rows, typeFacet, sourceFacet, matchedRows, soonRows] = await Promise.all([
      // Distinct opportunities, not raw rows, so the total agrees with the
      // deduped page below and the pagination math stays correct.
      sql`SELECT COUNT(DISTINCT ${dupKeyT})::int AS n FROM tenders t ${join} ${where}`,
      // Collapse cross-posted duplicates before LIMIT/OFFSET: keep one row per
      // opportunity, preferring the viewer's matched copy (fit set) so the
      // "Matched" badge + score survive the collapse, then their newest id.
      sql`
        WITH base AS (
          SELECT t.id, t.reference_id, t.title, t.agency, t.deadline, t.sector, t.country,
                 t.opportunity_type, t.source_name, t.estimated_value, t.source_url, pf.fit,
                 ${dupKeyT} AS canonical_key
          FROM tenders t ${join} ${where}
        ),
        deduped AS (
          SELECT DISTINCT ON (canonical_key) *
          FROM base
          ORDER BY canonical_key, fit DESC NULLS LAST, id DESC
        )
        SELECT * FROM deduped
        ORDER BY ${orderByOuter}, id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `,
      // Facet counts are distinct opportunities too, so a facet's number matches
      // what its selection yields in the deduped list. Intentional divergence: an
      // opportunity cross-posted on two sources counts under BOTH source rows —
      // facets measure availability, not a partition, so their sum can exceed the
      // total (the same was already true of raw counts; this just de-inflates them).
      sql`SELECT t.opportunity_type AS value, COUNT(DISTINCT ${dupKeyT})::int AS count FROM tenders t ${join} ${facetWhere} AND t.opportunity_type IS NOT NULL AND t.opportunity_type <> '' GROUP BY t.opportunity_type ORDER BY count DESC, value LIMIT 30`,
      sql`SELECT t.source_name AS value, COUNT(DISTINCT ${dupKeyT})::int AS count FROM tenders t ${join} ${facetWhere} AND t.source_name IS NOT NULL AND t.source_name <> '' GROUP BY t.source_name ORDER BY count DESC, value LIMIT 30`,
      // Stat-strip counts over the full filtered set — distinct opportunities so
      // they agree with the deduped list and stay accurate across pagination.
      sql`SELECT COUNT(DISTINCT ${dupKeyT})::int AS n FROM tenders t ${join} ${where} AND pf.fit IS NOT NULL`,
      sql`SELECT COUNT(DISTINCT ${dupKeyT})::int AS n FROM tenders t ${join} ${where} AND t.deadline IS NOT NULL AND t.deadline <= CURRENT_DATE + 7`,
    ]);

    const tenders: WbBrowseRow[] = rows.map((r) => {
      const fit = r.fit != null ? Number(r.fit) : null;
      const title = decodeHtmlEntities(String(r.title ?? ""));
      return {
        id: r.id as number,
        tenderId: r.id as number,
        code: (r.reference_id as string | null) ?? `T-${r.id}`,
        title,
        // Harmonized agency so the column matches the agency filter labels.
        agency: canonicalAgency(r.agency as string | null) ?? "",
        type: inferType(title, (r.opportunity_type as string | null) ?? null),
        source: (r.source_name as string | null) ?? "—",
        deadline: (r.deadline as string | null) ?? null,
        value: (r.estimated_value as string | null) ?? "—",
        // Show the harmonized sector label so the row matches its facet.
        sector: sectorDisplayLabel(r.sector as string | null) ?? (r.sector as string | null) ?? null,
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
        sector: sectorFacets,
        type: toFacets(typeFacet as Record<string, unknown>[]),
        source: toFacets(sourceFacet as Record<string, unknown>[]),
      },
      countries: countryLabels,
      agencies: agencyLabels,
      total: (countRows[0]?.n as number) ?? tenders.length,
      matchedTotal: (matchedRows[0]?.n as number) ?? 0,
      soonTotal: (soonRows[0]?.n as number) ?? 0,
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
