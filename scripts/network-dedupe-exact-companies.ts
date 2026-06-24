/**
 * Dry-run-first cleanup for exact duplicate network companies.
 *
 * Usage:
 *   npx tsx scripts/network-dedupe-exact-companies.ts
 *   npx tsx scripts/network-dedupe-exact-companies.ts --limit=10
 *   npx tsx scripts/network-dedupe-exact-companies.ts --apply
 *
 * The apply mode is intentionally conservative: it pauses duplicate active
 * rows (is_active=false) and leaves their matches/history intact. That removes
 * duplicate outreach bundles without deleting operator data.
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch {}

interface DuplicateRow {
  id: number;
  name: string;
  name_key: string;
  website: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  profile_status: string | null;
  new_match_count: number;
  top_score: number;
  created_at: string;
}

function argValue(prefix: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function keeperScore(row: DuplicateRow): number {
  return (
    (row.contact_email?.includes("@") ? 100 : 0) +
    (/linkedin\.com/i.test(row.contact_linkedin ?? "") ? 60 : 0) +
    (row.website ? 30 : 0) +
    (row.profile_status === "ready" ? 25 : 0) +
    Math.min(40, asNumber(row.new_match_count) * 4) +
    Math.min(20, asNumber(row.top_score) / 5)
  );
}

function groupRows(rows: DuplicateRow[]): Map<string, DuplicateRow[]> {
  const groups = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.name_key) ?? [];
    bucket.push(row);
    groups.set(row.name_key, bucket);
  }
  return groups;
}

async function loadDuplicates(): Promise<DuplicateRow[]> {
  const rows = await sql`
    WITH duplicate_names AS (
      SELECT
        LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) AS name_key
      FROM network_companies
      WHERE is_active = TRUE
      GROUP BY 1
      HAVING COUNT(*) > 1
    )
    SELECT
      c.id,
      c.name,
      d.name_key,
      c.website,
      c.contact_email,
      c.contact_linkedin,
      c.profile_status,
      COALESCE(COUNT(m.*) FILTER (
        WHERE m.status = 'new'
          AND t.status = 'open'
          AND COALESCE(t.has_broken_link, false) = false
          AND t.deadline >= CURRENT_DATE
      ), 0)::int AS new_match_count,
      COALESCE(MAX(m.score), 0)::int AS top_score,
      c.created_at::text AS created_at
    FROM network_companies c
    JOIN duplicate_names d ON d.name_key = LOWER(REGEXP_REPLACE(BTRIM(c.name), '\\s+', ' ', 'g'))
    LEFT JOIN network_company_matches m ON m.network_company_id = c.id
    LEFT JOIN tenders t ON t.id = m.tender_id
    WHERE c.is_active = TRUE
    GROUP BY c.id, d.name_key
    ORDER BY name_key, c.id
  `;
  return rows.map((row) => ({
    id: asNumber(row.id),
    name: String(row.name ?? ""),
    name_key: String(row.name_key ?? ""),
    website: row.website ? String(row.website) : null,
    contact_email: row.contact_email ? String(row.contact_email) : null,
    contact_linkedin: row.contact_linkedin ? String(row.contact_linkedin) : null,
    profile_status: row.profile_status ? String(row.profile_status) : null,
    new_match_count: asNumber(row.new_match_count),
    top_score: asNumber(row.top_score),
    created_at: String(row.created_at ?? ""),
  }));
}

async function pauseDuplicate(loser: DuplicateRow, keeper: DuplicateRow): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const marker = `Duplicate paused by network-dedupe-exact-companies.ts on ${stamp}; canonical network_company #${keeper.id}`;
  await sql`
    UPDATE network_companies
    SET
      is_active = FALSE,
      notes = CONCAT_WS(E'\n', NULLIF(notes, ''), ${marker}),
      updated_at = NOW()
    WHERE id = ${loser.id}
      AND is_active = TRUE
  `;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Math.max(0, Math.floor(Number(argValue("--limit=") ?? 0)) || 0);
  const rows = await loadDuplicates();
  const groups = [...groupRows(rows).values()];
  const shown = limit > 0 ? groups.slice(0, limit) : groups;
  let duplicateRows = 0;

  console.log(`${apply ? "APPLY" : "DRY RUN"} exact active-company duplicate cleanup`);
  console.log(`Duplicate groups: ${groups.length}`);

  for (const group of shown) {
    const ranked = group
      .slice()
      .sort((a, b) => keeperScore(b) - keeperScore(a) || a.id - b.id);
    const [keeper, ...losers] = ranked;
    duplicateRows += losers.length;
    console.log(`\n${keeper.name} (${group.length} active rows)`);
    console.log(
      `  keep #${keeper.id} score=${keeperScore(keeper).toFixed(1)} email=${keeper.contact_email ? "yes" : "no"} linkedin=${keeper.contact_linkedin ? "yes" : "no"} matches=${keeper.new_match_count} top=${keeper.top_score}`,
    );
    for (const loser of losers) {
      console.log(
        `  pause #${loser.id} score=${keeperScore(loser).toFixed(1)} email=${loser.contact_email ? "yes" : "no"} linkedin=${loser.contact_linkedin ? "yes" : "no"} matches=${loser.new_match_count} top=${loser.top_score}`,
      );
      if (apply) await pauseDuplicate(loser, keeper);
    }
  }

  if (limit > 0 && groups.length > shown.length) {
    console.log(`\nShowing ${shown.length}/${groups.length} groups. Re-run without --limit for all.`);
  }
  console.log(`\nDuplicate active rows ${apply ? "paused" : "that would be paused"}: ${duplicateRows}`);
  if (!apply && duplicateRows > 0) {
    console.log("No data changed. To apply this conservative cleanup, run:");
    console.log("  npx tsx scripts/network-dedupe-exact-companies.ts --apply");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
