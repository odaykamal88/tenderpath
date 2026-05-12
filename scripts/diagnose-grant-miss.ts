/**
 * Diagnose why a known grant/company pair did not appear in matches.
 *
 * Defaults to the Al Jumhuriya + EU PROSPECT miss that triggered Wave 5A.
 *
 * Usage:
 *   npx tsx scripts/diagnose-grant-miss.ts
 *   npx tsx scripts/diagnose-grant-miss.ts --reference=185831PROSPECTSEN --website=https://aljumhuriya.net/ar/
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import { crawlWebsite } from "../src/lib/assessment/crawl";
import { matchGrants } from "../src/lib/assessment/match";
import { fetchEuFundingGrantByReference } from "../src/lib/grants/eu-funding-tenders";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

function arg(name: string, fallback: string): string {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
}

function csvArg(name: string, fallback: string[]): string[] {
  const raw = process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : fallback;
}

async function dbGrant(reference: string, title: string | null) {
  try {
    const rows = await sql`
      SELECT id, reference_id, title, agency, deadline, sector, themes, eligible_org_types,
             country, region, source_url, status, description
      FROM grants
      WHERE reference_id ILIKE ${`%${reference}%`}
         OR source_url ILIKE ${`%${reference}%`}
         OR (${title}::text IS NOT NULL AND title ILIKE ${`%${title ?? ""}%`})
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 5
    `;
    return rows;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const reference = arg("reference", "185831PROSPECTSEN");
  const website = arg("website", "https://aljumhuriya.net/ar/");
  const countries = csvArg("countries", ["Syria"]);
  const sectors = csvArg("sectors", ["consulting", "language_services"]);
  const themes = csvArg("themes", ["Governance & Rule of Law", "civil society", "media", "freedom of expression"]);
  const orgType = arg("org-type", "NGO");

  const euGrant = await fetchEuFundingGrantByReference(reference);
  const storedGrant = await dbGrant(reference, euGrant?.title ?? null);
  const crawl = await crawlWebsite(website);
  const matches = await matchGrants(sectors, orgType, themes, countries);
  const matchingStored = Array.isArray(storedGrant)
    ? matches.filter((match) => storedGrant.some((row) => Number(row.id) === match.id))
    : [];

  const report = {
    reference,
    website,
    sourceLookup: euGrant ? {
      reference_id: euGrant.reference_id,
      title: euGrant.title,
      deadline: euGrant.deadline,
      country: euGrant.country,
      region: euGrant.region,
      countries: euGrant.countries,
      themes: euGrant.themes,
      eligible_org_types: euGrant.eligible_org_types,
      source_url: euGrant.source_url,
      description_chars: euGrant.description?.length ?? 0,
    } : null,
    dbLookup: storedGrant,
    crawl: crawl ? {
      finalUrl: crawl.finalUrl,
      renderMethod: crawl.renderMethod,
      isThinContent: crawl.isThinContent,
      title: crawl.title,
      content_chars: crawl.content.length,
      content_preview: crawl.content.slice(0, 240),
    } : null,
    profileUsedForMatchSmoke: {
      sectors,
      orgType,
      themes,
      countries,
    },
    exactStoredGrantMatches: matchingStored.map((match) => ({
      id: match.id,
      score: match.score,
      title: match.title,
      reason: match.match_reasons,
      bucket: match.opportunity_bucket_label,
    })),
    topGrantMatches: matches.slice(0, 5).map((match) => ({
      id: match.id,
      score: match.score,
      title: match.title,
      agency: match.agency,
      country: match.country,
      region: match.region,
      reason: match.match_reasons?.slice(0, 4),
    })),
    diagnosis: [
      euGrant ? "SEDIA reference lookup succeeded." : "SEDIA reference lookup failed or mapped no future open grant.",
      Array.isArray(storedGrant) && storedGrant.length
        ? "Grant appears in the local grants table."
        : "Grant is not present in the local grants table; ingestion/filtering is the first blocker.",
      crawl
        ? `Website crawl returned ${crawl.renderMethod ?? "static"} content (${crawl.content.length} chars).`
        : "Website crawl returned null; company classification would rely on manual user description.",
      matchingStored.length
        ? "The stored grant appears in matchGrants output."
        : "The exact grant did not appear in matchGrants output for the smoke profile.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
