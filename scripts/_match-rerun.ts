/**
 * Re-run matchTenders against the latest stored assessments for Jad + Docstream
 * using the new Fix A (wider keywords) + Fix B (autoGeoOpen when strict supply
 * is thin) to verify we now surface tailored opportunities instead of near-zero.
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
import { matchTenders } from "../src/lib/assessment/match";
import type { AIAnalysis } from "../src/lib/types";

async function runFor(site: string) {
  const rows = await sql`
    SELECT ai_analysis, countries
    FROM assessments
    WHERE website ILIKE ${"%" + site + "%"}
    ORDER BY created_at DESC LIMIT 1`;
  if (!rows.length) { console.log(`no record for ${site}`); return; }
  const ai = rows[0].ai_analysis as AIAnalysis;
  const countries = (rows[0].countries as string[]) ?? [];
  console.log(`\n=== ${site} | industry=${ai.detected_industry} | countries=${JSON.stringify(countries)} ===`);
  const matches = await matchTenders(ai, countries);
  console.log(`${matches.length} matches`);
  console.table(matches.map(m => ({
    score: m.score,
    country: m.country,
    deadline: String(m.deadline).slice(0, 10),
    title: m.title.slice(0, 70),
  })));
}

(async () => {
  await runFor("jadunited");
  await runFor("docstream");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
