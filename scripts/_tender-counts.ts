/**
 * Quick inventory: are UNGM notices actually in the DB, and how many
 * overlap with an obvious MENA/English filter that a profile like Jad's
 * would apply? Diagnose "only 5 matches" — is it a data gap or a
 * matching-logic gap?
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
  const bySrc = await sql`
    SELECT source_name, COUNT(*) n,
           COUNT(*) FILTER (WHERE deadline >= CURRENT_DATE) future_deadline,
           MAX(updated_at)::text last_upd
    FROM tenders WHERE status='open'
    GROUP BY source_name ORDER BY n DESC`;
  console.log("=== By source (status=open) ===");
  console.table(bySrc);

  const mena = ['Jordan','Lebanon','Palestine','Egypt','Iraq','Syria','Yemen',
    'Tunisia','Morocco','Algeria','Libya','Sudan','Somalia',
    'United Arab Emirates','Saudi Arabia','Qatar','Bahrain','Oman','Kuwait'];
  const menaCount = await sql`
    SELECT source_name, COUNT(*) n
    FROM tenders WHERE status='open' AND country = ANY(${mena}::text[])
    GROUP BY source_name ORDER BY n DESC`;
  console.log("\n=== MENA-country + open ===");
  console.table(menaCount);

  const ungmMena = await sql`
    SELECT reference_id, title, country, deadline::text
    FROM tenders
    WHERE source_name='UNGM' AND status='open' AND country = ANY(${mena}::text[])
    ORDER BY deadline ASC NULLS LAST LIMIT 10`;
  console.log("\n=== UNGM MENA sample ===");
  console.table(ungmMena);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
