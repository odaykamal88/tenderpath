/**
 * Audit what Jad (Jordan-based warehousing/logistics, jadunited.com) should
 * see. Hits DB directly with the keyword set the matcher uses for `logistics`
 * plus regional MENA countries, so we can see pool size vs gates.
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

const LOGI_CURRENT = ["logistics","transport","freight","shipping","warehouse","supply chain","distribution","fleet","customs","cargo"];
const LOGI_WIDER = [...LOGI_CURRENT, "delivery","storage","forwarding","forwarder","haulage","stockpiling","prepositioning","warehousing","procurement services","last mile","trucking","dispatching","import","export","clearance","handling","loading","unloading"];
const MENA = ['Jordan','Lebanon','Palestine','Egypt','Iraq','Syria','Yemen','Tunisia','Morocco','Algeria','Libya','Sudan','Somalia','United Arab Emirates','Saudi Arabia','Qatar','Bahrain','Oman','Kuwait'];
const NEAR_JORDAN = ['Jordan','Lebanon','Palestine','Iraq','Syria','Egypt','Saudi Arabia'];

async function countMatching(kws: string[], countries: string[]) {
  const pats = kws.map(k => `%${k}%`);
  const rows = await sql`
    SELECT id, title, agency, country, deadline::text, sector, source_name
    FROM tenders
    WHERE status='open' AND deadline >= CURRENT_DATE
      AND country = ANY(${countries}::text[])
      AND (
        title ILIKE ANY(${pats}::text[])
        OR sector ILIKE ANY(${pats}::text[])
        OR COALESCE(description,'') ILIKE ANY(${pats}::text[])
      )
    ORDER BY deadline ASC`;
  return rows;
}

async function countGlobalGeoOpen(kws: string[]) {
  const pats = kws.map(k => `%${k}%`);
  const rows = await sql`
    SELECT id, title, country, deadline::text, source_name
    FROM tenders
    WHERE status='open' AND deadline >= CURRENT_DATE
      AND (country ILIKE 'global' OR country ILIKE 'multiple' OR country ILIKE 'remote' OR country IS NULL)
      AND (
        title ILIKE ANY(${pats}::text[])
        OR sector ILIKE ANY(${pats}::text[])
        OR COALESCE(description,'') ILIKE ANY(${pats}::text[])
      )
    ORDER BY deadline ASC LIMIT 50`;
  return rows;
}

(async () => {
  console.log("=== Scenario A: Jordan-only + CURRENT logistics keywords ===");
  const a = await countMatching(LOGI_CURRENT, ['Jordan']);
  console.log(`rows: ${a.length}`);
  console.table(a.slice(0,10).map(r => ({ src: r.source_name, country: r.country, deadline: r.deadline, title: String(r.title).slice(0,65) })));

  console.log("\n=== Scenario B: Jordan + regional neighbors + CURRENT keywords ===");
  const b = await countMatching(LOGI_CURRENT, NEAR_JORDAN);
  console.log(`rows: ${b.length}`);
  console.table(b.slice(0,15).map(r => ({ src: r.source_name, country: r.country, deadline: r.deadline, title: String(r.title).slice(0,60) })));

  console.log("\n=== Scenario C: Jordan + neighbors + WIDER keywords ===");
  const c = await countMatching(LOGI_WIDER, NEAR_JORDAN);
  console.log(`rows: ${c.length}`);
  console.table(c.slice(0,15).map(r => ({ src: r.source_name, country: r.country, deadline: r.deadline, title: String(r.title).slice(0,60) })));

  console.log("\n=== Scenario D: full MENA + WIDER keywords ===");
  const d = await countMatching(LOGI_WIDER, MENA);
  console.log(`rows: ${d.length}`);

  console.log("\n=== Scenario E: GLOBAL/geo-open + WIDER keywords (framework agreements etc) ===");
  const e = await countGlobalGeoOpen(LOGI_WIDER);
  console.log(`rows: ${e.length}`);
  console.table(e.slice(0,10).map(r => ({ src: r.source_name, country: r.country, deadline: r.deadline, title: String(r.title).slice(0,65) })));

  // Does jad's actual assessment exist in DB? look for his domain
  const jadAssess = await sql`
    SELECT id, website, sector, ai_analysis, countries, created_at::text
    FROM assessments
    WHERE website ILIKE '%jadunited%'
    ORDER BY created_at DESC LIMIT 3`;
  console.log("\n=== Jad's actual assessment record ===");
  console.table(jadAssess.map((row) => {
    const ai = row.ai_analysis as { detected_industry?: string; sectors?: string[] } | null;
    return {
      id: row.id,
      website: row.website,
      detected_industry: ai?.detected_industry ?? row.sector,
      sectors: Array.isArray(ai?.sectors) ? ai.sectors.join(", ") : "",
      countries: Array.isArray(row.countries) ? row.countries.join(", ") : "",
      created_at: row.created_at,
    };
  }));

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
