/**
 * Read-only diagnostic for the "wrong deadlines → tenders filtered out" report.
 *
 * Pinpoints WHICH crawler is emitting bad/missing deadlines and resolves the
 * tenders.deadline column-type ambiguity (db.ts says DATE, migrate.mjs says
 * TIMESTAMPTZ — only prod knows which CREATE TABLE won). Writes NOTHING.
 *
 * Usage:
 *   npx tsx scripts/diagnose-tender-deadlines.ts
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";

// Load .env.local manually (these scripts don't pull in dotenv).
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

async function main() {
  // 1) What type is tenders.deadline, and did PR #147's generated dedup_key land?
  const cols = await sql`
    SELECT column_name, data_type, is_generated
    FROM information_schema.columns
    WHERE table_name = 'tenders'
      AND column_name IN ('deadline', 'dedup_key', 'created_at', 'updated_at', 'status')
    ORDER BY column_name
  `;
  console.log("\n=== tenders column types (DATE vs TIMESTAMPTZ + is dedup_key generated?) ===");
  console.table(cols);

  // 2) Per-source deadline health among OPEN tenders. A high null_deadline or
  //    past_deadline (especially deadline_before_crawl — crawled with a deadline
  //    already in the past) fingers the crawler whose date parsing is wrong.
  const bySource = await sql`
    SELECT
      COALESCE(source_name, '(null)')                                                   AS source,
      COUNT(*)::int                                                                     AS open_total,
      COUNT(*) FILTER (WHERE deadline IS NULL)::int                                      AS null_deadline,
      COUNT(*) FILTER (WHERE deadline < CURRENT_DATE)::int                               AS past_deadline,
      COUNT(*) FILTER (WHERE deadline > CURRENT_DATE + INTERVAL '2 years')::int          AS far_future,
      COUNT(*) FILTER (WHERE deadline IS NOT NULL
                         AND deadline::date < created_at::date)::int                     AS deadline_before_crawl,
      MIN(deadline::date)::text                                                          AS min_deadline,
      MAX(deadline::date)::text                                                          AS max_deadline
    FROM tenders
    WHERE status = 'open'
    GROUP BY source_name
    ORDER BY (COUNT(*) FILTER (WHERE deadline IS NULL OR deadline < CURRENT_DATE)) DESC, open_total DESC
  `;
  console.log("\n=== per-source deadline health (status='open') ===");
  console.table(bySource);

  // 3) Freshly-crawled rows that already expired — a strong "parsed the deadline
  //    into the past" signal (crawlers only fetch ACTIVE tenders).
  const recentExpired = await sql`
    SELECT COALESCE(source_name, '(null)') AS source, COUNT(*)::int AS expired_but_fresh
    FROM tenders
    WHERE status = 'expired'
      AND updated_at > NOW() - INTERVAL '3 days'
      AND deadline IS NOT NULL
      AND deadline::date < updated_at::date
    GROUP BY source_name
    ORDER BY expired_but_fresh DESC
  `;
  console.log("\n=== expired-but-crawled-in-last-3-days (deadline likely parsed into the past) ===");
  console.table(recentExpired);

  // 4) Concrete sample rows to click-verify (compare stored deadline vs the real
  //    deadline on source_url).
  const samples = await sql`
    SELECT id, COALESCE(source_name, '(null)') AS source, reference_id,
           deadline::text AS stored_deadline, created_at::date::text AS crawled, source_url
    FROM tenders
    WHERE status = 'open'
      AND (deadline IS NULL OR deadline < CURRENT_DATE OR deadline::date < created_at::date)
    ORDER BY updated_at DESC
    LIMIT 40
  `;
  console.log("\n=== sample anomalous OPEN rows (open the source_url to compare) ===");
  console.table(
    (samples as Array<Record<string, unknown>>).map((r) => ({
      id: r.id, source: r.source, ref: r.reference_id,
      stored_deadline: r.stored_deadline, crawled: r.crawled,
      url: String(r.source_url ?? "").slice(0, 64),
    })),
  );

  console.log("\nDone. Share the four tables above and I'll fix the exact source(s).");
}

main().catch((err) => {
  console.error("[diagnose-tender-deadlines] failed", err);
  process.exit(1);
});
