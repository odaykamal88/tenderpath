/**
 * Fold cross-posted duplicate tenders onto one canonical survivor.
 *
 * Runs the SAME logic the crawl runs at the end of every sync
 * (collapseDuplicateTenders), exposed as a one-off so the existing backlog can be
 * cleaned immediately instead of waiting for the next cron. Same-opportunity rows
 * (normalized title + agency + deadline) collapse onto the highest-priority-source
 * survivor; child rows (matches / pipeline / feedback / bids / submissions) are
 * repointed onto it and the losers are marked status='superseded' (every reader
 * filters status='open', so they leave display and matching at once).
 *
 * Defaults to dry-run.
 *
 * Usage:
 *   npx tsx scripts/dedupe-tenders.ts
 *   npx tsx scripts/dedupe-tenders.ts --write
 */
import fs from "node:fs";
import { collapseDuplicateTenders } from "../src/lib/crawlers/sync";

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
  const write = process.argv.includes("--write");
  const result = await collapseDuplicateTenders({ dryRun: !write });

  console.log(`Tender de-dup ${write ? "write" : "dry-run"}`);
  console.log(`Duplicate groups: ${result.groups}`);
  console.log(`Rows to supersede: ${result.collapsed}`);
  console.table(
    result.details.slice(0, 30).map((d) => ({
      survivor: d.survivorId,
      source: d.survivorSource ?? "—",
      losers: d.loserIds.join(", "),
    })),
  );

  if (!write) {
    console.log("\nNo changes written. Re-run with --write to collapse these duplicates.");
    return;
  }
  console.log(`\nSuperseded ${result.collapsed} duplicate tender rows across ${result.groups} groups.`);
}

main().catch((err) => {
  console.error("[dedupe-tenders] failed", err);
  process.exit(1);
});
