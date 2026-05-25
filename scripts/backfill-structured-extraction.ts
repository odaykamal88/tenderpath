/**
 * scripts/backfill-structured-extraction.ts
 *
 * One-time operational script: walk every document_extractions row that has
 * extracted text but no structured_extraction yet, run the Sprint 8b
 * extractor against it, persist the resulting JSONB.
 *
 * Why: Sprint 8b added the structured-extraction step inside
 * persistDocumentExtraction (extract.ts), but that only fires on NEW
 * uploads going forward. Every CV / past-performance / certificate
 * uploaded BEFORE Sprint 8b sits in document_extractions with
 * text_content populated and structured_extraction = NULL, so
 * library-enrichment falls back to filename heuristics for those users.
 * This script closes that gap.
 *
 * Idempotent: rows whose structured_extraction is already populated are
 * skipped naturally (the SQL filter excludes them). Re-runnable any
 * number of times — interrupted runs resume cleanly on the next pass.
 *
 * Cost: Haiku at ~$0.001 per extraction. The script prints an estimate
 * before doing real work, and a --dry-run flag shows the candidate set
 * without spending any API budget.
 *
 * Usage:
 *   # See what would be processed for one user
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/backfill-structured-extraction.ts --dry-run --user-id 42
 *
 *   # Process all users, but limit to first 50 rows for safety
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/backfill-structured-extraction.ts --limit 50
 *
 *   # Full backfill (after verifying with --dry-run + small --limit)
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/backfill-structured-extraction.ts
 *
 * Flags:
 *   --dry-run         — print candidates + cost estimate, write nothing
 *   --user-id <N>     — scope to one user (recommended for first run)
 *   --limit <N>       — cap rows processed (default: no cap)
 *   --concurrency <N> — parallel LLM calls (default 4; max 8 — Anthropic rate-limit safe)
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

import { sql } from "@/lib/db";
import {
  extractStructuredFromDocument,
  type StructuredExtraction,
} from "@/lib/applicant-evidence/structured-extractor";

// --------------------------------------------------------------------------
// Args
// --------------------------------------------------------------------------

interface Args {
  dryRun: boolean;
  userId: number | null;
  limit: number;
  concurrency: number;
}

function readNumberFlag(name: string, fallback: number | null): number | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const raw = process.argv[i + 1];
  if (!raw) {
    console.error(`✗ ${name} requires a numeric argument`);
    process.exit(1);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`✗ ${name} requires a positive number, got "${raw}"`);
    process.exit(1);
  }
  return n;
}

function parseArgs(): Args {
  const dryRun = process.argv.includes("--dry-run");
  const userId = readNumberFlag("--user-id", null);
  const limit = readNumberFlag("--limit", 100_000) ?? 100_000;
  const concurrency = Math.min(8, readNumberFlag("--concurrency", 4) ?? 4);
  return { dryRun, userId, limit, concurrency };
}

// --------------------------------------------------------------------------
// Candidate query
//
// Filters:
//   - structured_extraction IS NULL  → not yet processed by Sprint 8b
//   - text_content IS NOT NULL       → there's something to extract from
//   - LENGTH(text_content) >= 200    → matches structured-extractor's MIN_TEXT_CHARS
//   - vault_documents.type IN (cv|past_performance|certificate|audit)
//       → matches the three types structured-extractor supports
//   - de.vault_document_id IS NOT NULL → joined to a vault doc (excludes
//       orphan extractions whose vault row was deleted)
// --------------------------------------------------------------------------

interface BackfillRow {
  extraction_id: number;
  user_id: number;
  vault_document_id: number;
  file_name: string;
  type: string;
  text_content: string;
  char_count: number;
}

async function loadRows(args: Args): Promise<BackfillRow[]> {
  // neon's tagged-template SQL has no clean way to omit a WHERE clause —
  // when --user-id is unset we pass 0 and the userMatch CASE shortcircuits
  // to TRUE. (Direct conditional building would also work but bypasses the
  // parameterised query.)
  const userFilter = args.userId ?? 0;
  const rows = await sql`
    SELECT
      de.id AS extraction_id,
      de.user_id,
      de.vault_document_id,
      de.file_name,
      vd.type,
      de.text_content,
      de.char_count
    FROM document_extractions de
    JOIN vault_documents vd ON vd.id = de.vault_document_id
    WHERE de.structured_extraction IS NULL
      AND de.text_content IS NOT NULL
      AND LENGTH(de.text_content) >= 200
      AND vd.type IN ('cv', 'past_performance', 'certificate', 'audit')
      AND (${userFilter}::int = 0 OR de.user_id = ${userFilter}::int)
    ORDER BY de.id DESC
    LIMIT ${args.limit}
  ` as unknown as BackfillRow[];
  return rows;
}

// --------------------------------------------------------------------------
// Per-row processing
// --------------------------------------------------------------------------

type Outcome = "ok" | "skipped_thin_or_empty" | "failed";

interface PerRowResult {
  outcome: Outcome;
  structuredType?: string;
}

async function processRow(row: BackfillRow): Promise<PerRowResult> {
  let structured: StructuredExtraction | null;
  try {
    structured = await extractStructuredFromDocument({
      type: row.type,
      textContent: row.text_content,
      fileName: row.file_name,
    });
  } catch (err) {
    console.warn(`  ✗ extraction threw for id=${row.extraction_id} (${row.file_name}):`, err instanceof Error ? err.message : String(err));
    return { outcome: "failed" };
  }
  if (!structured) {
    // extractor returned null — type unsupported or text too thin. Marker
    // would be useful but we don't have a "tried-but-skipped" column today,
    // so the next backfill run will re-attempt these. Acceptable cost.
    return { outcome: "skipped_thin_or_empty" };
  }
  try {
    await sql`
      UPDATE document_extractions
      SET structured_extraction = ${JSON.stringify(structured)}::jsonb,
          updated_at = NOW()
      WHERE id = ${row.extraction_id}
    `;
    return { outcome: "ok", structuredType: structured.type };
  } catch (err) {
    console.warn(`  ✗ UPDATE failed for id=${row.extraction_id}:`, err instanceof Error ? err.message : String(err));
    return { outcome: "failed" };
  }
}

// --------------------------------------------------------------------------
// Concurrency-limited batch runner
// --------------------------------------------------------------------------

async function runBatched(
  rows: BackfillRow[],
  concurrency: number,
): Promise<{ ok: number; skipped: number; failed: number; byType: Record<string, number> }> {
  const counters = { ok: 0, skipped: 0, failed: 0, byType: {} as Record<string, number> };
  let cursor = 0;
  const total = rows.length;

  async function worker(workerId: number): Promise<void> {
    while (true) {
      const myIndex = cursor;
      cursor += 1;
      if (myIndex >= rows.length) return;
      const row = rows[myIndex];
      const tag = `[${myIndex + 1}/${total}]`;
      console.log(`  → ${tag} w${workerId} ${row.type.padEnd(18)} id=${row.extraction_id} ${row.file_name.slice(0, 60)}`);
      const result = await processRow(row);
      if (result.outcome === "ok") {
        counters.ok += 1;
        if (result.structuredType) {
          counters.byType[result.structuredType] = (counters.byType[result.structuredType] ?? 0) + 1;
        }
      } else if (result.outcome === "skipped_thin_or_empty") {
        counters.skipped += 1;
      } else {
        counters.failed += 1;
      }
    }
  }

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < concurrency; i += 1) workers.push(worker(i + 1));
  await Promise.all(workers);
  return counters;
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  console.log("\n=== Sprint 8b structured-extraction backfill ===");
  console.log(`  dry-run:     ${args.dryRun}`);
  console.log(`  user-id:     ${args.userId ?? "(all users)"}`);
  console.log(`  limit:       ${args.limit === 100_000 ? "(no limit)" : args.limit}`);
  console.log(`  concurrency: ${args.concurrency}`);
  console.log("");

  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL is not set. Run with the prod DATABASE_URL from .env.local or inline.");
    process.exit(1);
  }
  if (!args.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("✗ ANTHROPIC_API_KEY is not set. Required for non-dry-run mode.");
    process.exit(1);
  }

  console.log("Loading candidate rows from document_extractions…");
  const rows = await loadRows(args);
  console.log(`Found ${rows.length} candidate row(s) needing structured-extraction backfill.`);

  // Cost: Haiku is roughly $0.001 per extraction at this prompt size
  // (~6KB input, ~600 output tokens). This is an estimate, not a quote.
  const costEstimate = (rows.length * 0.001).toFixed(2);
  console.log(`Estimated Anthropic cost: ~$${costEstimate} (Haiku ~$0.001/extraction).`);
  console.log("");

  if (rows.length === 0) {
    console.log("✓ Nothing to do. The library is already fully backfilled for this scope.");
    return;
  }

  if (args.dryRun) {
    console.log("DRY-RUN. Showing first 20 candidate rows:");
    for (const row of rows.slice(0, 20)) {
      console.log(`  - id=${row.extraction_id} user=${row.user_id} type=${row.type.padEnd(18)} chars=${row.text_content.length.toString().padStart(6)}  ${row.file_name.slice(0, 60)}`);
    }
    if (rows.length > 20) console.log(`  … and ${rows.length - 20} more.`);
    console.log("");
    console.log("Run without --dry-run to process for real.");
    return;
  }

  console.log("Processing…");
  const started = Date.now();
  const counters = await runBatched(rows, args.concurrency);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log("");
  console.log("=== Summary ===");
  console.log(`  ✓ persisted:           ${counters.ok}`);
  console.log(`    skipped (thin/empty): ${counters.skipped}`);
  console.log(`  ✗ failed:              ${counters.failed}`);
  console.log(`  elapsed:               ${elapsed}s`);
  if (Object.keys(counters.byType).length > 0) {
    console.log(`  by structured.type:`);
    for (const [t, n] of Object.entries(counters.byType)) {
      console.log(`    ${t.padEnd(20)} ${n}`);
    }
  }
  console.log("");
  console.log("Re-run the script later to retry any failures (it's idempotent — already-backfilled rows are skipped).");
}

main().catch((err) => {
  console.error("\n✗ unhandled error:", err);
  process.exit(1);
});
