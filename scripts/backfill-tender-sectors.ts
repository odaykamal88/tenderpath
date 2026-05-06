/**
 * Backfill existing tender sector values into Tenderpath sector slugs.
 *
 * Default is dry-run:
 *   npx tsx scripts/backfill-tender-sectors.ts
 *
 * Apply updates:
 *   npx tsx scripts/backfill-tender-sectors.ts --write
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import { normalizeSector } from "../src/lib/crawlers/sector-map";
import type { SectorSlug } from "../src/lib/crawlers/sector-map";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

const write = process.argv.includes("--write");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 1000;

type Row = {
  id: number;
  reference_id: string;
  source_name: string | null;
  title: string;
  description: string | null;
  sector: string | null;
};

type UpdateRow = Row & { nextSector: SectorSlug };

function shouldBackfill(sector: string | null): boolean {
  if (!sector) return false;
  const trimmed = sector.trim();
  if (!trimmed) return false;
  if (/^\d[\d\s,.-]*$/.test(trimmed)) return true;
  return normalizeSector(trimmed, null).length === 0;
}

async function main() {
  const rows = (await sql`
    SELECT id, reference_id, source_name, title, description, sector
    FROM tenders
    WHERE status = 'open'
      AND sector IS NOT NULL
      AND TRIM(sector) <> ''
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `) as Row[];

  const updates: UpdateRow[] = [];
  for (const row of rows) {
    if (!shouldBackfill(row.sector)) continue;
    const slug = normalizeSector(row.sector, row.title, row.description)[0] ?? null;
    if (!slug || slug === row.sector) continue;
    updates.push({ ...row, nextSector: slug });
  }

  console.table(updates.slice(0, 30).map((row) => ({
    id: row.id,
    source: row.source_name,
    from: row.sector,
    to: row.nextSector,
    title: row.title.slice(0, 72),
  })));
  console.log(`${write ? "Applying" : "Dry-run"} ${updates.length} sector update(s) from ${rows.length} inspected row(s).`);

  if (!write) return;
  for (const row of updates) {
    await sql`
      UPDATE tenders
      SET sector = ${row.nextSector}, updated_at = NOW()
      WHERE id = ${row.id}
    `;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
