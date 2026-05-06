/**
 * Backfill language-service tender metadata.
 *
 * Some source rows arrive with HTML-encoded countries (for example
 * "T&#252;rkiye") or null sectors even when the title clearly describes
 * translation / interpretation / editing work. This makes strict geography
 * and language-services matching look empty even though source coverage exists.
 *
 * Usage:
 *   npx tsx scripts/backfill-language-service-tenders.ts
 *   npx tsx scripts/backfill-language-service-tenders.ts --write
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";
import { normalizeSector } from "../src/lib/crawlers/sector-map";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch {}

type TenderRow = {
  id: number;
  reference_id: string;
  title: string;
  description: string | null;
  country: string | null;
  sector: string | null;
  source_name: string | null;
  deadline: string | null;
};

const LANGUAGE_RE = /\b(translat(?:e|ed|ing|ion|or|ors)|interpreter(?:s)?|interpreting|interpretation services?|linguistic|language services?|proofreading|copyediting|editorial services?|subtitling|voice[- ]over|dubbing|multilingual translation)\b/i;

function decodeEntities(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&uuml;/gi, "ü")
    .replace(/&amp;/gi, "&")
    .trim();
}

function normalizeCountry(country: string | null): string | null {
  const decoded = decodeEntities(country);
  if (!decoded) return country;
  const key = decoded.toLowerCase();
  if (key === "türkiye" || key === "turkiye") return "Turkey";
  if (key === "syrian arab republic") return "Syria";
  return decoded;
}

function mergeSector(existing: string | null, title: string): string | null {
  const existingSlugs = (existing ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const slugs = new Set(existingSlugs);
  const titleSlugs = LANGUAGE_RE.test(title) ? normalizeSector(null, title, null) : [];
  for (const slug of titleSlugs) slugs.add(slug);
  if (LANGUAGE_RE.test(title)) slugs.add("language_services");
  if (!slugs.size) return existing;
  return [...slugs].join(", ");
}

async function main() {
  const write = process.argv.includes("--write");
  const rows = await sql`
    SELECT id, reference_id, title, description, country, sector, source_name, deadline
    FROM tenders
    WHERE status = 'open'
      AND deadline >= CURRENT_DATE
      AND (
        country ILIKE '%&#%'
        OR title ILIKE ANY(ARRAY[
          '%translation%', '%translate%', '%interpretation%', '%interpreter%',
          '%translator%', '%proofreading%', '%copyediting%', '%editorial service%',
          '%subtitling%', '%linguistic%', '%language service%', '%multilingual translation%'
        ]::text[])
      )
    ORDER BY deadline ASC NULLS LAST
  ` as TenderRow[];

  const updates = rows
    .map((row) => {
      const country = normalizeCountry(row.country);
      const sector = mergeSector(row.sector, row.title);
      return {
        ...row,
        nextCountry: country,
        nextSector: sector,
        changed: country !== row.country || sector !== row.sector,
      };
    })
    .filter((row) => row.changed);

  console.log(`language-service tender backfill candidates: ${rows.length}`);
  console.log(`rows needing update: ${updates.length}`);
  console.table(updates.slice(0, 20).map((row) => ({
    id: row.id,
    ref: row.reference_id,
    source: row.source_name,
    country: `${row.country ?? ""} -> ${row.nextCountry ?? ""}`,
    sector: `${row.sector ?? ""} -> ${row.nextSector ?? ""}`,
    title: row.title.slice(0, 90),
  })));

  if (!write) {
    console.log("Dry run only. Re-run with --write to update tenders.");
    return;
  }

  let updated = 0;
  for (const row of updates) {
    await sql`
      UPDATE tenders
      SET country = ${row.nextCountry}, sector = ${row.nextSector}, updated_at = NOW()
      WHERE id = ${row.id}
    `;
    updated++;
  }
  console.log(`updated ${updated} tenders`);
}

main().catch((err) => {
  console.error("[backfill-language-service-tenders] failed", err);
  process.exit(1);
});
