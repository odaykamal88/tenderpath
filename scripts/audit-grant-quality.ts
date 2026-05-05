/**
 * Grant data quality audit.
 *
 * Run:
 *   npx tsx scripts/audit-grant-quality.ts
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function yesNo(value: unknown): string {
  return Number(value ?? 0) > 0 ? "yes" : "no";
}

async function main() {
  const columns = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'grants'
    ORDER BY ordinal_position
  `;

  const [quality] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'open')::int AS open,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND LENGTH(TRIM(description)) >= 120)::int AS rich_desc,
      COUNT(*) FILTER (WHERE themes IS NOT NULL AND jsonb_array_length(COALESCE(themes, '[]'::jsonb)) > 0)::int AS themes,
      COUNT(*) FILTER (WHERE eligible_org_types IS NOT NULL AND jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) > 0)::int AS orgs,
      COUNT(*) FILTER (WHERE country IS NOT NULL AND TRIM(country) <> '')::int AS country,
      COUNT(*) FILTER (WHERE region IS NOT NULL AND TRIM(region) <> '')::int AS region,
      COUNT(*) FILTER (WHERE countries IS NOT NULL AND jsonb_array_length(COALESCE(countries, '[]'::jsonb)) > 0)::int AS countries,
      COUNT(*) FILTER (WHERE sector IS NOT NULL AND TRIM(sector) <> '')::int AS sector,
      COUNT(*) FILTER (WHERE value_range IS NOT NULL AND TRIM(value_range) <> '')::int AS value_range,
      COUNT(*) FILTER (WHERE source_url IS NOT NULL AND TRIM(source_url) <> '')::int AS source_url
    FROM grants
  ` as Array<Record<string, number>>;

  const bySource = await sql`
    SELECT COALESCE(source_name, agency, 'unknown') AS source,
           COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open,
           COUNT(*) FILTER (WHERE status = 'open' AND deadline IS NOT NULL AND deadline >= NOW())::int AS future_open,
           COUNT(*) FILTER (WHERE status = 'open' AND (deadline IS NULL OR deadline < NOW()))::int AS stale_open,
           COUNT(*) FILTER (WHERE description IS NULL OR LENGTH(TRIM(description)) < 120)::int AS weak_desc,
           COUNT(*) FILTER (WHERE themes IS NULL OR jsonb_array_length(COALESCE(themes, '[]'::jsonb)) = 0)::int AS missing_themes,
           COUNT(*) FILTER (WHERE eligible_org_types IS NULL OR jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) = 0)::int AS missing_orgs,
           COUNT(*) FILTER (WHERE country IS NULL OR TRIM(country) = '')::int AS missing_country,
           COUNT(*) FILTER (WHERE source_url IS NULL OR TRIM(source_url) = '')::int AS missing_url,
           MIN(deadline) FILTER (WHERE status = 'open' AND deadline >= NOW()) AS next_deadline,
           MAX(updated_at) AS last_updated
    FROM grants
    GROUP BY 1
    ORDER BY open DESC, n DESC
  `;

  const sourceActions = await sql`
    SELECT COALESCE(source_name, agency, 'unknown') AS source,
           COUNT(*)::int AS rows_needing_attention,
           COUNT(*) FILTER (WHERE status = 'open' AND (deadline IS NULL OR deadline < NOW()))::int AS stale_open,
           COUNT(*) FILTER (WHERE description IS NULL OR LENGTH(TRIM(description)) < 120)::int AS weak_desc,
           COUNT(*) FILTER (WHERE themes IS NULL OR jsonb_array_length(COALESCE(themes, '[]'::jsonb)) = 0)::int AS missing_themes,
           COUNT(*) FILTER (WHERE eligible_org_types IS NULL OR jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) = 0)::int AS missing_orgs,
           COUNT(*) FILTER (WHERE source_url IS NULL OR TRIM(source_url) = '')::int AS missing_url
    FROM grants
    WHERE status = 'open'
      AND (
        deadline IS NULL OR deadline < NOW()
        OR description IS NULL OR LENGTH(TRIM(description)) < 120
        OR themes IS NULL OR jsonb_array_length(COALESCE(themes, '[]'::jsonb)) = 0
        OR eligible_org_types IS NULL OR jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) = 0
        OR source_url IS NULL OR TRIM(source_url) = ''
      )
    GROUP BY 1
    ORDER BY rows_needing_attention DESC
    LIMIT 20
  `;

  const expiringSoon = await sql`
    SELECT id, reference_id, title, agency, country, region, source_name, deadline
    FROM grants
    WHERE status = 'open'
      AND deadline >= NOW()
      AND deadline < NOW() + INTERVAL '21 days'
    ORDER BY deadline ASC
    LIMIT 30
  `;

  const samples = await sql`
    SELECT id, reference_id, title, agency, country, region, sector, themes,
           eligible_org_types, value_range, source_name, source_url, description
    FROM grants
    ORDER BY id
    LIMIT 80
  `;

  const total = Number(quality.total ?? 0);
  console.log("\n=== grants columns ===");
  console.table(columns);

  console.log("\n=== grant data quality ===");
  console.table([{
    total,
    open: quality.open,
    rich_desc: `${quality.rich_desc} (${pct(Number(quality.rich_desc), total)})`,
    themes: `${quality.themes} (${pct(Number(quality.themes), total)})`,
    eligible_org_types: `${quality.orgs} (${pct(Number(quality.orgs), total)})`,
    country: `${quality.country} (${pct(Number(quality.country), total)})`,
    region: `${quality.region} (${pct(Number(quality.region), total)})`,
    countries: `${quality.countries} (${pct(Number(quality.countries), total)})`,
    sector: `${quality.sector} (${pct(Number(quality.sector), total)})`,
    value_range: `${quality.value_range} (${pct(Number(quality.value_range), total)})`,
    source_url: `${quality.source_url} (${pct(Number(quality.source_url), total)})`,
  }]);

  console.log("\n=== by source ===");
  console.table(bySource.map((row) => ({
    source: row.source,
    total: row.n,
    open: row.open,
    future_open: row.future_open,
    stale_open: row.stale_open,
    weak_desc: row.weak_desc,
    missing_themes: row.missing_themes,
    missing_orgs: row.missing_orgs,
    missing_country: row.missing_country,
    missing_url: row.missing_url,
    next_deadline: row.next_deadline ? new Date(row.next_deadline as string).toISOString().slice(0, 10) : "",
    updated: row.last_updated ? new Date(row.last_updated as string).toISOString().slice(0, 10) : "",
  })));

  console.log("\n=== source action queue ===");
  console.table(sourceActions.map((row) => ({
    source: row.source,
    rows: row.rows_needing_attention,
    stale_open: row.stale_open,
    weak_desc: row.weak_desc,
    missing_themes: row.missing_themes,
    missing_orgs: row.missing_orgs,
    missing_url: row.missing_url,
    action: [
      Number(row.stale_open) ? "expire" : "",
      Number(row.weak_desc) ? "enrich descriptions" : "",
      Number(row.missing_themes) ? "map themes" : "",
      Number(row.missing_orgs) ? "map eligibility" : "",
      Number(row.missing_url) ? "restore source URLs" : "",
    ].filter(Boolean).join("; "),
  })));

  console.log("\n=== expiring in next 21 days ===");
  console.table(expiringSoon.map((row) => ({
    id: row.id,
    ref: row.reference_id,
    deadline: row.deadline ? new Date(row.deadline as string).toISOString().slice(0, 10) : "",
    agency: row.agency,
    country: row.country,
    region: row.region,
    source: row.source_name,
    title: String(row.title ?? "").slice(0, 84),
  })));

  console.log("\n=== sample rows ===");
  console.table(samples.map((row) => ({
    id: row.id,
    ref: row.reference_id,
    agency: row.agency,
    country: row.country,
    region: row.region,
    sector: row.sector,
    themes: JSON.stringify(row.themes),
    orgs: JSON.stringify(row.eligible_org_types),
    value: row.value_range,
    source: row.source_name,
    url: Boolean(row.source_url),
    actionable: yesNo(!row.source_url || !row.description || !row.themes || !row.eligible_org_types),
    desc: String(row.description ?? "").slice(0, 60),
    title: String(row.title ?? "").slice(0, 70),
  })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
