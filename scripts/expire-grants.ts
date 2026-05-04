/**
 * Safely expire grant rows whose deadlines have passed.
 *
 * Defaults to dry-run. This keeps dashboards and matchGrants() aligned with
 * source reality while preserving historical rows for audit/debugging.
 *
 * Usage:
 *   npx tsx scripts/expire-grants.ts
 *   npx tsx scripts/expire-grants.ts --write --grace-days=1
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

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const graceArg = process.argv.find((arg) => arg.startsWith("--grace-days="));
const graceDays = Math.max(0, Number(graceArg?.split("=")[1] ?? 0));

type ExpiringGrant = {
  id: number;
  reference_id: string | null;
  source: string;
  deadline: string | null;
  title: string;
};

async function main() {
  const rows = await sql`
    SELECT
      id,
      reference_id,
      COALESCE(source_name, agency, 'unknown') AS source,
      deadline::text,
      title
    FROM grants
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < NOW() - (${graceDays}::int * INTERVAL '1 day')
    ORDER BY deadline ASC, id ASC
  ` as ExpiringGrant[];

  const bySource = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.source] = (acc[row.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Grant expiry ${write ? "write" : "dry-run"}`);
  console.log(`Grace days: ${graceDays}`);
  console.log(`Rows to expire: ${rows.length}`);
  console.table(Object.entries(bySource).map(([source, count]) => ({ source, count })));
  console.table(rows.slice(0, 30).map((row) => ({
    id: row.id,
    ref: row.reference_id,
    source: row.source,
    deadline: row.deadline?.slice(0, 10),
    title: row.title.slice(0, 86),
  })));

  if (!write) {
    console.log("\nNo changes written. Re-run with --write to expire these rows.");
    return;
  }

  const result = await sql`
    UPDATE grants
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < NOW() - (${graceDays}::int * INTERVAL '1 day')
    RETURNING id
  `;
  console.log(`\nExpired grant rows: ${result.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
