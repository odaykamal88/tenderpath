import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform")?.trim();
  if (!platform) {
    return NextResponse.json({ error: "Missing platform" }, { status: 400 });
  }

  await sql`ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`;

  const [recentLogs, qualityRows, recentTenders, agencyRows] = await Promise.all([
    sql`
      SELECT
        id,
        created_at AS started_at,
        platform,
        COALESCE(status, 'unknown') AS status,
        duration_ms,
        tenders_added,
        tenders_updated,
        tenders_expired,
        broken_links,
        NULLIF(errors::text, '[]') AS error,
        metadata
      FROM crawl_logs
      WHERE platform = ${platform}
        OR (${platform} = 'UK Find a Tender' AND platform = 'UK FTS')
      ORDER BY created_at DESC
      LIMIT 12
    `,
    sql`
      SELECT
        COUNT(*) AS open_tenders,
        AVG(CASE WHEN description IS NOT NULL AND LENGTH(TRIM(description)) >= 120 THEN 100 ELSE 0 END) AS description_complete_pct,
        AVG(CASE WHEN deadline IS NOT NULL THEN 100 ELSE 0 END) AS deadline_complete_pct,
        AVG(CASE WHEN sector IS NOT NULL AND TRIM(sector) <> '' THEN 100 ELSE 0 END) AS sector_complete_pct,
        AVG(CASE WHEN source_url IS NOT NULL AND TRIM(source_url) <> '' THEN 100 ELSE 0 END) AS source_url_complete_pct,
        AVG(CASE WHEN has_broken_link IS TRUE THEN 100 ELSE 0 END) AS broken_link_pct,
        SUM(CASE WHEN description IS NULL OR LENGTH(TRIM(description)) < 120 THEN 1 ELSE 0 END) AS thin_descriptions
      FROM tenders
      WHERE status = 'open'
        AND (
          CASE
            WHEN source_name IN ('UNICEF', 'WFP', 'WHO') THEN 'UNGM'
            WHEN source_name = 'EU' THEN 'TED EU'
            WHEN source_name = 'USAID/SAM.gov' THEN 'SAM.gov'
            WHEN source_name = 'FCDO' THEN 'UK Find a Tender'
            ELSE source_name
          END
        ) = ${platform}
    `,
    sql`
      SELECT
        id,
        reference_id,
        title,
        agency,
        country,
        sector,
        deadline,
        source_url,
        has_broken_link,
        updated_at
      FROM tenders
      WHERE status = 'open'
        AND (
          CASE
            WHEN source_name IN ('UNICEF', 'WFP', 'WHO') THEN 'UNGM'
            WHEN source_name = 'EU' THEN 'TED EU'
            WHEN source_name = 'USAID/SAM.gov' THEN 'SAM.gov'
            WHEN source_name = 'FCDO' THEN 'UK Find a Tender'
            ELSE source_name
          END
        ) = ${platform}
      ORDER BY updated_at DESC NULLS LAST, deadline ASC NULLS LAST
      LIMIT 12
    `,
    sql`
      SELECT agency, COUNT(*) AS open_tenders
      FROM tenders
      WHERE status = 'open'
        AND (
          CASE
            WHEN source_name IN ('UNICEF', 'WFP', 'WHO') THEN 'UNGM'
            WHEN source_name = 'EU' THEN 'TED EU'
            WHEN source_name = 'USAID/SAM.gov' THEN 'SAM.gov'
            WHEN source_name = 'FCDO' THEN 'UK Find a Tender'
            ELSE source_name
          END
        ) = ${platform}
        AND agency IS NOT NULL
      GROUP BY agency
      ORDER BY open_tenders DESC, agency ASC
      LIMIT 12
    `,
  ]);

  return NextResponse.json({
    platform,
    recentLogs,
    quality: qualityRows[0] ?? null,
    recentTenders,
    topAgencies: agencyRows,
  });
}
