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
(async () => {
  const total = await sql`SELECT COUNT(*)::int AS n FROM tenders WHERE status='open'`;
  const byS = await sql`SELECT source_name, COUNT(*)::int AS n FROM tenders WHERE status='open' GROUP BY source_name ORDER BY n DESC`;
  const recent = await sql`SELECT source_name, updated_at FROM tenders ORDER BY updated_at DESC LIMIT 5`;
  const logs = await sql`SELECT platform, tenders_added, tenders_updated, created_at FROM crawl_logs ORDER BY created_at DESC LIMIT 15`;
  console.log("total open:", total[0].n);
  console.log("by source:", byS);
  console.log("recent:", recent);
  console.log("last crawls:", logs);
})();
