/**
 * Import open European Commission Funding & Tenders calls into grants.
 *
 * Defaults to dry-run. The source helper filters to open/forthcoming calls
 * with future deadlines and maps them into the existing grants table contract.
 *
 * Usage:
 *   npx tsx scripts/import-eu-funding-grants.ts --limit=50
 *   npx tsx scripts/import-eu-funding-grants.ts --write --limit=100
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import { fetchEuFundingGrants, type EuFundingGrant } from "../src/lib/grants/eu-funding-tenders";

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
const pagesArg = process.argv.find((arg) => arg.startsWith("--pages="));
const pageSizeArg = process.argv.find((arg) => arg.startsWith("--page-size="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? 100));
const requestedPages = Math.max(1, Number(pagesArg?.split("=")[1] ?? 3));
const pageSize = Math.min(100, Math.max(10, Number(pageSizeArg?.split("=")[1] ?? 100)));

function brief(grant: EuFundingGrant): Record<string, unknown> {
  return {
    ref: grant.reference_id,
    deadline: grant.deadline?.slice(0, 10) ?? "",
    sector: grant.sector,
    themes: grant.themes.slice(0, 5),
    orgs: grant.eligible_org_types,
    desc: grant.description ? `${grant.description.length} chars` : "",
    title: grant.title.slice(0, 84),
  };
}

async function upsertGrant(grant: EuFundingGrant) {
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
  const byRef = new Map<string, EuFundingGrant>();
  let totalResults = 0;

  for (let page = 1; page <= requestedPages && byRef.size < limit; page++) {
    const batch = await fetchEuFundingGrants(pageSize, page);
    totalResults = batch.totalResults;
    for (const grant of batch.grants) {
      if (byRef.size >= limit) break;
      byRef.set(grant.reference_id, grant);
    }
    if (page * pageSize >= batch.totalResults) break;
  }

  const grants = [...byRef.values()]
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));

  console.log(`EU Funding & Tenders import ${write ? "write" : "dry-run"}`);
  console.log(`SEDIA total results: ${totalResults}`);
  console.log(`Mapped future grants: ${grants.length}`);
  console.table(grants.slice(0, 30).map(brief));

  if (!write) {
    console.log("\nNo changes written. Re-run with --write to import these grants.");
    return;
  }

  let written = 0;
  for (const grant of grants) {
    await upsertGrant(grant);
    written++;
  }
  console.log(`\nUpserted EU Funding & Tenders grants: ${written}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
