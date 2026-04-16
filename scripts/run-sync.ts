/**
 * One-off runner: crawl tenders + grants, upsert to DB, report counts.
 * Run: node_modules/.bin/tsx scripts/run-sync.ts
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

import { syncAllTenders } from "../src/lib/crawlers/sync";
import { syncAllGrants } from "../src/lib/crawlers/grants-sync";

async function main() {
  console.log("=== Running tender sync ===");
  const t0 = Date.now();
  const tenders = await syncAllTenders();
  console.log(`Tenders done in ${Date.now() - t0}ms`);
  console.log(`  added:   ${tenders.totalAdded}`);
  console.log(`  updated: ${tenders.totalUpdated}`);
  console.log(`  expired: ${tenders.totalExpired}`);
  console.log(`  deduped: ${tenders.totalDeduped}`);
  console.log(`  broken:  ${tenders.totalBrokenLinks}`);
  for (const r of tenders.results) {
    const tag = r.status === "success" ? "OK" : "FAIL";
    console.log(`    [${tag}] ${r.platform}: +${r.added} ~${r.updated} broken:${r.brokenLinks} ${r.durationMs}ms ${r.error ?? ""}`);
  }

  console.log("\n=== Running grants sync ===");
  const g0 = Date.now();
  const grants = await syncAllGrants();
  console.log(`Grants done in ${Date.now() - g0}ms`);
  console.log(`  added:   ${grants.totalAdded}`);
  console.log(`  updated: ${grants.totalUpdated}`);
  console.log(`  expired: ${grants.totalExpired}`);
  console.log(`  broken:  ${grants.totalBroken}`);
  for (const r of grants.platforms) {
    const tag = r.status === "success" ? "OK" : "FAIL";
    console.log(`    [${tag}] ${r.platform}: +${r.added} ~${r.updated} broken:${r.broken} ${r.durationMs}ms ${r.error ?? ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
