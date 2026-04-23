/**
 * Dump the last N UNGM crawl failures with error text — diagnose the 91%
 * failure rate. Need to know: timeout? Cloudflare challenge? Empty rows?
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

(async () => {
  const rows = await sql`
    SELECT created_at, status, duration_ms, tenders_added, errors
    FROM crawl_logs
    WHERE platform = 'UNGM'
    ORDER BY created_at DESC
    LIMIT 25`;
  console.table(rows.map((r: Record<string, unknown>) => ({
    ts: String(r.created_at).slice(0, 19),
    status: r.status,
    dur_s: r.duration_ms ? Math.round(Number(r.duration_ms) / 1000) : null,
    added: r.tenders_added,
    error: r.errors ? JSON.stringify(r.errors).slice(0, 120) : "",
  })));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
