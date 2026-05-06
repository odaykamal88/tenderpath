/**
 * Conservative Grants.gov metadata backfill.
 *
 * Defaults to dry-run. Writes only empty metadata fields and never invents a
 * description. This is intended to give matchGrants() enough sector, theme,
 * org eligibility, and geography signal to avoid noisy generic grant matches.
 *
 * Usage:
 *   npx tsx scripts/backfill-grant-metadata.ts --limit=200
 *   npx tsx scripts/backfill-grant-metadata.ts --write --limit=1000
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import {
  grantPatchHasSignal,
  inferGrantMetadata,
  mergeGrantMetadata,
  type GrantLike,
} from "../src/lib/grants/enrichment";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

type GrantRow = GrantLike & {
  id: number;
  reference_id: string | null;
  source_name: string | null;
};

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? 200));

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((v) => typeof v === "string" && v.trim());
}

function rowNeedsMetadata(row: GrantRow): boolean {
  return !row.sector?.trim()
    || !nonEmptyArray(row.themes)
    || !nonEmptyArray(row.eligible_org_types)
    || !row.country?.trim()
    || !row.region?.trim()
    || !nonEmptyArray(row.countries)
    || !row.value_range?.trim();
}

function brief(row: GrantRow, merged: ReturnType<typeof mergeGrantMetadata>): Record<string, unknown> {
  return {
    id: row.id,
    ref: row.reference_id,
    agency: row.agency,
    sector: row.sector || "-> " + (merged.sector ?? ""),
    country: row.country || "-> " + (merged.country ?? ""),
    region: row.region || "-> " + (merged.region ?? ""),
    themes: nonEmptyArray(row.themes) ? row.themes : merged.themes,
    orgs: nonEmptyArray(row.eligible_org_types) ? row.eligible_org_types : merged.eligible_org_types,
    value: row.value_range || "-> " + (merged.value_range ?? ""),
    title: String(row.title ?? "").slice(0, 72),
    reasons: merged.reasons.slice(0, 4).join("; "),
  };
}

async function writePatch(row: GrantRow, merged: ReturnType<typeof mergeGrantMetadata>) {
  await sql`
    UPDATE grants
    SET
      sector = CASE
        WHEN sector IS NULL OR TRIM(sector) = '' THEN ${merged.sector}
        ELSE sector
      END,
      themes = CASE
        WHEN themes IS NULL OR jsonb_array_length(COALESCE(themes, '[]'::jsonb)) = 0 THEN ${JSON.stringify(merged.themes)}::jsonb
        ELSE themes
      END,
      eligible_org_types = CASE
        WHEN eligible_org_types IS NULL OR jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) = 0 THEN ${JSON.stringify(merged.eligible_org_types)}::jsonb
        ELSE eligible_org_types
      END,
      country = CASE
        WHEN country IS NULL OR TRIM(country) = '' THEN ${merged.country}
        ELSE country
      END,
      region = CASE
        WHEN region IS NULL OR TRIM(region) = '' THEN ${merged.region}
        ELSE region
      END,
      countries = CASE
        WHEN countries IS NULL OR jsonb_array_length(COALESCE(countries, '[]'::jsonb)) = 0 THEN ${JSON.stringify(merged.countries)}::jsonb
        ELSE countries
      END,
      value_range = CASE
        WHEN value_range IS NULL OR TRIM(value_range) = '' THEN ${merged.value_range}
        ELSE value_range
      END,
      updated_at = NOW()
    WHERE id = ${row.id}
  `;
}

async function main() {
  const rows = await sql`
    SELECT id, reference_id, title, agency, sector, themes, eligible_org_types,
           country, region, countries, value_range, source_name
    FROM grants
    WHERE status = 'open'
    ORDER BY deadline ASC NULLS LAST, id ASC
    LIMIT ${limit}
  ` as GrantRow[];

  const updates: Array<{ row: GrantRow; merged: ReturnType<typeof mergeGrantMetadata> }> = [];

  for (const row of rows) {
    if (!rowNeedsMetadata(row)) continue;
    const patch = inferGrantMetadata(row);
    if (!grantPatchHasSignal(patch)) continue;
    const merged = mergeGrantMetadata(row, patch);
    updates.push({ row, merged });
  }

  console.log(`Grant metadata backfill ${write ? "write" : "dry-run"}`);
  console.log(`Scanned: ${rows.length}`);
  console.log(`Patchable: ${updates.length}`);
  console.table(updates.slice(0, 30).map(({ row, merged }) => brief(row, merged)));

  if (!write) {
    console.log("\nNo changes written. Re-run with --write to apply these patches.");
    return;
  }

  let written = 0;
  for (const update of updates) {
    await writePatch(update.row, update.merged);
    written++;
  }
  console.log(`\nWrote metadata patches: ${written}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
