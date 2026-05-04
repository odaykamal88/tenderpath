/**
 * Enrich existing Grants.gov rows from the official Grants.gov detail endpoint.
 *
 * Defaults to dry-run. Writes only additive/richer metadata:
 * - real synopsis/forecast description
 * - precise applicant eligibility/org types
 * - funding activity themes and sector
 * - value range and deadline when missing
 *
 * Usage:
 *   npx tsx scripts/enrich-grants-gov-details.ts --limit=25
 *   npx tsx scripts/enrich-grants-gov-details.ts --write --limit=100
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import {
  fetchGrantsGovDetail,
  grantsGovDetailPatch,
  grantsGovOppId,
  type GrantsGovDetailPatch,
} from "../src/lib/grants/grants-gov-detail";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

type GrantRow = {
  id: number;
  reference_id: string | null;
  title: string;
  agency: string | null;
  deadline: string | null;
  sector: string | null;
  themes: unknown;
  eligible_org_types: unknown;
  source_url: string | null;
  description: string | null;
  value_range: string | null;
};

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] ?? 25));

function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim())
    : [];
}

function mergeArray(existing: unknown, incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...asArray(existing), ...incoming]) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isAlumniPublicDiplomacyPatch(patch: GrantsGovDetailPatch): boolean {
  return patch.reasons.includes("alumni/public-diplomacy grant pattern");
}

function usefulPatch(row: GrantRow, patch: GrantsGovDetailPatch): boolean {
  if (isAlumniPublicDiplomacyPatch(patch)) return true;
  return (!!patch.description && (row.description?.trim().length ?? 0) < patch.description.length)
    || (!!patch.sector && !row.sector?.trim())
    || (patch.themes.length > 0 && patch.themes.some((t) => !asArray(row.themes).map((v) => v.toLowerCase()).includes(t.toLowerCase())))
    || (patch.eligible_org_types.length > 0 && patch.eligible_org_types.some((t) => !asArray(row.eligible_org_types).map((v) => v.toLowerCase()).includes(t.toLowerCase())))
    || (!!patch.value_range && !row.value_range?.trim())
    || (!!patch.deadline && !row.deadline);
}

async function writePatch(row: GrantRow, patch: GrantsGovDetailPatch) {
  const replaceClassification = isAlumniPublicDiplomacyPatch(patch);
  const themes = replaceClassification ? patch.themes : mergeArray(row.themes, patch.themes);
  const orgs = replaceClassification ? patch.eligible_org_types : mergeArray(row.eligible_org_types, patch.eligible_org_types);
  await sql`
    UPDATE grants
    SET
      description = CASE
        WHEN ${patch.description}::text IS NOT NULL
         AND (description IS NULL OR LENGTH(TRIM(description)) < LENGTH(${patch.description}::text))
        THEN ${patch.description}
        ELSE description
      END,
      sector = CASE
        WHEN ${replaceClassification}::boolean THEN ${patch.sector}
        WHEN (sector IS NULL OR TRIM(sector) = '') THEN ${patch.sector}
        ELSE sector
      END,
      themes = ${JSON.stringify(themes)}::jsonb,
      eligible_org_types = ${JSON.stringify(orgs)}::jsonb,
      value_range = CASE
        WHEN (value_range IS NULL OR TRIM(value_range) = '') THEN ${patch.value_range}
        ELSE value_range
      END,
      deadline = CASE
        WHEN deadline IS NULL THEN ${patch.deadline}::timestamptz
        ELSE deadline
      END,
      updated_at = NOW()
    WHERE id = ${row.id}
  `;
}

async function main() {
  const rows = await sql`
    SELECT id, reference_id, title, agency, deadline::text, sector, themes,
           eligible_org_types, source_url, description, value_range
    FROM grants
    WHERE status = 'open'
      AND source_name = 'Grants.gov'
      AND source_url ILIKE '%grants.gov/search-results-detail/%'
    ORDER BY
      CASE WHEN description IS NULL OR LENGTH(TRIM(description)) < 120 THEN 0 ELSE 1 END,
      deadline ASC NULLS LAST,
      id ASC
    LIMIT ${limit}
  ` as GrantRow[];

  const updates: Array<{ row: GrantRow; oppId: string; patch: GrantsGovDetailPatch }> = [];
  const failures: Array<{ id: number; oppId: string | null; error: string }> = [];

  for (const row of rows) {
    const oppId = grantsGovOppId(row);
    if (!oppId) {
      failures.push({ id: row.id, oppId, error: "missing Grants.gov oppId" });
      continue;
    }
    try {
      const detail = await fetchGrantsGovDetail(oppId);
      const patch = grantsGovDetailPatch(detail);
      if (usefulPatch(row, patch)) updates.push({ row, oppId, patch });
    } catch (err) {
      failures.push({ id: row.id, oppId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`Grants.gov detail enrichment ${write ? "write" : "dry-run"}`);
  console.log(`Scanned: ${rows.length}`);
  console.log(`Patchable: ${updates.length}`);
  console.table(updates.slice(0, 20).map(({ row, oppId, patch }) => ({
    id: row.id,
    oppId,
    agency: row.agency,
    desc: patch.description ? `${patch.description.length} chars` : "",
    sector: row.sector || "-> " + (patch.sector ?? ""),
    themes: patch.themes.slice(0, 5),
    orgs: patch.eligible_org_types,
    value: row.value_range || "-> " + (patch.value_range ?? ""),
    deadline: row.deadline || "-> " + (patch.deadline ?? ""),
    title: row.title.slice(0, 70),
    reasons: patch.reasons.join("; "),
  })));

  if (failures.length) {
    console.log("\nFailures:");
    console.table(failures.slice(0, 10));
  }

  if (!write) {
    console.log("\nNo changes written. Re-run with --write to apply these patches.");
    return;
  }

  let written = 0;
  for (const update of updates) {
    await writePatch(update.row, update.patch);
    written++;
  }
  console.log(`\nWrote Grants.gov detail patches: ${written}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
