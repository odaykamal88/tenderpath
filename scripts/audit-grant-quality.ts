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
           COUNT(*) FILTER (WHERE status = 'open')::int AS open
    FROM grants
    GROUP BY 1
    ORDER BY n DESC
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
  console.table(bySource);

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
    desc: String(row.description ?? "").slice(0, 60),
    title: String(row.title ?? "").slice(0, 70),
  })));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
