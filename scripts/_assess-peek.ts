/**
 * Inspect Jad + Docstream assessment records to see what industry/sectors
 * the AI assigned them. Diagnose over-classification as "consulting".
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
    SELECT id, company_name, website, sector, countries, org_type,
           ai_analysis, readiness_score, created_at::text
    FROM assessments
    WHERE website ILIKE '%jadunited%' OR website ILIKE '%docstream%'
    ORDER BY created_at DESC LIMIT 10`;
  console.log(`${rows.length} matching assessments`);
  for (const r of rows) {
    const ai = (r.ai_analysis ?? {}) as Record<string, unknown>;
    console.log("\n―――――――――――――――――――――――――――――――――――――――――――");
    console.log(`id=${r.id}  site=${r.website}  name=${r.company_name}`);
    console.log(`created=${r.created_at}  orgType=${r.org_type}`);
    console.log(`countries=${JSON.stringify(r.countries)}`);
    console.log(`detected_industry = ${ai.detected_industry}`);
    console.log(`sectors           = ${JSON.stringify(ai.sectors)}`);
    console.log(`services          = ${JSON.stringify(ai.services)}`);
    console.log(`capabilities      = ${JSON.stringify(ai.capabilities)}`);
    console.log(`summary           = ${ai.summary}`);
  }

  // Also: distribution of detected_industry across all assessments
  const hist = await sql`
    SELECT ai_analysis->>'detected_industry' AS industry, COUNT(*) n
    FROM assessments
    GROUP BY 1 ORDER BY n DESC`;
  console.log("\n=== detected_industry distribution (all-time) ===");
  console.table(hist);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
