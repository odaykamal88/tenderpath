/**
 * Import grant-like UNDP Call for Proposals rows into grants.
 *
 * Defaults to dry-run. This intentionally filters the procurement-notices
 * listing to CFP/funding rows only, avoiding service procurements that merely
 * mention "grant" in a project/accounting context.
 *
 * Usage:
 *   npx tsx scripts/import-undp-cfp-grants.ts --limit=25
 *   npx tsx scripts/import-undp-cfp-grants.ts --write --limit=25
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import { fetchUndpCfpGrants, type UndpCfpGrant } from "../src/lib/grants/undp-cfp";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? 25));

function brief(grant: UndpCfpGrant): Record<string, unknown> {
  return {
    ref: grant.reference_id,
    deadline: grant.deadline,
    country: grant.country,
    region: grant.region,
    sector: grant.sector,
    themes: grant.themes.slice(0, 5),
    orgs: grant.eligible_org_types,
    title: grant.title.slice(0, 90),
  };
}

async function upsertGrant(grant: UndpCfpGrant) {
  await sql`
    INSERT INTO grants (
      reference_id, title, agency, deadline, sector, themes, eligible_org_types,
      countries, description, value_range, country, region, source_name,
      source_url, status, created_at, updated_at
    )
    VALUES (
      ${grant.reference_id}, ${grant.title}, ${grant.agency}, ${grant.deadline}::timestamptz,
      ${grant.sector}, ${JSON.stringify(grant.themes)}::jsonb,
      ${JSON.stringify(grant.eligible_org_types)}::jsonb,
      ${JSON.stringify(grant.countries)}::jsonb, ${grant.description},
      ${grant.value_range}, ${grant.country}, ${grant.region}, ${grant.source_name},
      ${grant.source_url}, ${grant.status}, NOW(), NOW()
    )
    ON CONFLICT (reference_id) DO UPDATE SET
      title = EXCLUDED.title,
      agency = EXCLUDED.agency,
      deadline = EXCLUDED.deadline,
      sector = EXCLUDED.sector,
      themes = EXCLUDED.themes,
      eligible_org_types = EXCLUDED.eligible_org_types,
      countries = EXCLUDED.countries,
      description = COALESCE(EXCLUDED.description, grants.description),
      value_range = COALESCE(EXCLUDED.value_range, grants.value_range),
      country = EXCLUDED.country,
      region = EXCLUDED.region,
      source_name = EXCLUDED.source_name,
      source_url = EXCLUDED.source_url,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;
}

async function main() {
  const { grants, totalScanned } = await fetchUndpCfpGrants(limit);

  console.log(`UNDP CFP grant import ${write ? "write" : "dry-run"}`);
  console.log(`UNDP notices scanned: ${totalScanned}`);
  console.log(`Mapped future CFP grants: ${grants.length}`);
  console.table(grants.map(brief));

  if (!write) {
    console.log("\nNo changes written. Re-run with --write to import these grants.");
    return;
  }

  let written = 0;
  for (const grant of grants) {
    await upsertGrant(grant);
    written++;
  }
  console.log(`\nUpserted UNDP CFP grants: ${written}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
