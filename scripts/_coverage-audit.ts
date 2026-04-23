/**
 * Coverage audit — find the real gaps in our tender DB before we reach for
 * a secondary aggregator. Prints:
 *   1. Total open notices
 *   2. By source_name (where does volume actually come from?)
 *   3. By country, overall + MENA-only (where are we thin?)
 *   4. MENA × source crosstab (which source covers which country?)
 *   5. Recent crawl_logs (is anything silently broken?)
 *   6. Per-sector counts (which sectors are under-represented?)
 */
import fs from "node:fs";
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
import { sql } from "../src/lib/db";

const MENA = [
  "Algeria","Bahrain","Egypt","Iran","Iraq","Israel","Jordan","Kuwait",
  "Lebanon","Libya","Morocco","Oman","Palestine","State of Palestine",
  "Qatar","Saudi Arabia","Sudan","Syria","Syrian Arab Republic",
  "Tunisia","Uae","United Arab Emirates","Yemen",
];

function table(rows: Array<Record<string, unknown>>): void {
  if (!rows.length) { console.log("  (empty)"); return; }
  console.table(rows);
}

(async () => {
  const total = await sql`SELECT COUNT(*)::int AS n FROM tenders WHERE status='open' AND deadline >= CURRENT_DATE`;
  console.log(`\n=== 1. Total OPEN notices (deadline in future): ${total[0].n} ===`);

  console.log(`\n=== 2. By source_name ===`);
  const bySrc = await sql`
    SELECT source_name, COUNT(*)::int AS n
    FROM tenders WHERE status='open' AND deadline >= CURRENT_DATE
    GROUP BY source_name ORDER BY n DESC`;
  table(bySrc as unknown as Array<Record<string, unknown>>);

  console.log(`\n=== 3a. Top 25 countries (all) ===`);
  const byCountry = await sql`
    SELECT country, COUNT(*)::int AS n
    FROM tenders WHERE status='open' AND deadline >= CURRENT_DATE
    GROUP BY country ORDER BY n DESC LIMIT 25`;
  table(byCountry as unknown as Array<Record<string, unknown>>);

  console.log(`\n=== 3b. MENA countries (open notices) ===`);
  const byMena = await sql`
    SELECT country, COUNT(*)::int AS n
    FROM tenders WHERE status='open' AND deadline >= CURRENT_DATE
      AND country = ANY(${MENA}::text[])
    GROUP BY country ORDER BY n DESC`;
  table(byMena as unknown as Array<Record<string, unknown>>);

  console.log(`\n=== 4. MENA × source crosstab ===`);
  const crosstab = await sql`
    SELECT country, source_name, COUNT(*)::int AS n
    FROM tenders WHERE status='open' AND deadline >= CURRENT_DATE
      AND country = ANY(${MENA}::text[])
    GROUP BY country, source_name ORDER BY country, n DESC`;
  table(crosstab as unknown as Array<Record<string, unknown>>);

  console.log(`\n=== 5. Last 20 crawl_logs (is anything silently broken?) ===`);
  const logs = await sql`
    SELECT platform, status, tenders_added, tenders_updated, tenders_expired,
           duration_ms, errors, created_at
    FROM crawl_logs ORDER BY created_at DESC LIMIT 20`;
  table(logs as unknown as Array<Record<string, unknown>>);

  console.log(`\n=== 6. Per-source success rate (last 7 days) ===`);
  const health = await sql`
    SELECT platform,
           COUNT(*)::int AS runs,
           SUM(CASE WHEN status='success' THEN 1 ELSE 0 END)::int AS ok,
           SUM(CASE WHEN status='failure' THEN 1 ELSE 0 END)::int AS fail,
           SUM(tenders_added)::int AS added,
           ROUND(AVG(duration_ms))::int AS avg_ms
    FROM crawl_logs
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND platform <> 'SUMMARY'
    GROUP BY platform ORDER BY added DESC`;
  table(health as unknown as Array<Record<string, unknown>>);

  console.log(`\n=== 7. Sector distribution (top 20) ===`);
  const bySector = await sql`
    SELECT COALESCE(NULLIF(sector,''), '(null)') AS sector, COUNT(*)::int AS n
    FROM tenders WHERE status='open' AND deadline >= CURRENT_DATE
    GROUP BY sector ORDER BY n DESC LIMIT 20`;
  table(bySector as unknown as Array<Record<string, unknown>>);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
