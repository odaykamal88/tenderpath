/**
 * Diagnose why an assessment is producing the tender mix it does.
 *
 * Usage:
 *   npx tsx scripts/_assessment-country-diag.ts 197
 *
 * Prints:
 *   - the row's stored `countries` selection,
 *   - source breakdown of `matched_tenders`,
 *   - country breakdown of `matched_tenders`,
 *   - whether SAM.gov should have been suppressed (per source-rules.ts).
 *
 * This exists to answer questions like "why does this user only see US
 * tenders" without re-running the full pipeline.
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
import { shouldSuppressSource } from "../src/lib/assessment/source-rules";

interface StoredTender {
  id?: number;
  reference_id?: string;
  title?: string;
  agency?: string;
  country?: string;
  source_url?: string;
  source_name?: string;
  score?: number;
}

function lower(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function expandCountrySet(countries: unknown): Set<string> {
  const arr = Array.isArray(countries) ? countries : [];
  const out = new Set<string>();
  for (const raw of arr) {
    const key = lower(raw).trim();
    if (key) out.add(key);
  }
  // Mirror the alias expansion match.ts does at runtime, just for "us".
  if (out.has("united states") || out.has("usa")) {
    out.add("united states");
    out.add("usa");
    out.add("united states of america");
  }
  return out;
}

(async () => {
  const id = Number(process.argv[2]);
  if (!Number.isFinite(id)) {
    console.error("Usage: npx tsx scripts/_assessment-country-diag.ts <assessment_id>");
    process.exit(1);
  }
  const rows = await sql`
    SELECT id, company_name, email, countries, org_type,
           matched_tenders, readiness_score, created_at::text
    FROM assessments
    WHERE id = ${id}
    LIMIT 1`;
  const row = rows[0];
  if (!row) {
    console.error(`No assessment with id=${id}`);
    process.exit(2);
  }

  const matched: StoredTender[] = Array.isArray(row.matched_tenders) ? row.matched_tenders : [];
  const countrySet = expandCountrySet(row.countries);

  console.log(`\nAssessment id=${row.id}  name=${row.company_name}  email=${row.email}`);
  console.log(`created=${row.created_at}  org_type=${row.org_type ?? "—"}  score=${row.readiness_score ?? "—"}`);
  console.log(`stored countries (raw)   = ${JSON.stringify(row.countries)}`);
  console.log(`expanded country set     = ${JSON.stringify([...countrySet])}`);
  console.log(`matched_tenders.length   = ${matched.length}`);

  // Breakdown by source domain.
  const bySource = new Map<string, number>();
  const byCountry = new Map<string, number>();
  let samCount = 0;
  let samSuppressedByRule = 0;
  for (const t of matched) {
    const url = t.source_url ?? "";
    const domain = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ""); }
      catch { return t.source_name ?? "unknown"; }
    })();
    bySource.set(domain, (bySource.get(domain) ?? 0) + 1);
    const c = lower(t.country) || "—";
    byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
    if (url.toLowerCase().includes("sam.gov")) {
      samCount += 1;
      if (shouldSuppressSource(url, countrySet)) samSuppressedByRule += 1;
    }
  }

  console.log(`\nSource breakdown:`);
  for (const [domain, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3, " ")}  ${domain}`);
  }
  console.log(`\nCountry breakdown:`);
  for (const [c, n] of [...byCountry.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3, " ")}  ${c}`);
  }

  if (samCount > 0) {
    console.log(`\nSAM.gov tenders in this assessment: ${samCount}`);
    console.log(`Would be suppressed under current source-rules.ts: ${samSuppressedByRule}`);
    if (samSuppressedByRule > 0 && samCount > samSuppressedByRule) {
      console.log(`⚠️  ${samSuppressedByRule} would be suppressed if matching ran again now — this assessment predates the current source-rules build.`);
    } else if (samSuppressedByRule === samCount && samCount > 0) {
      console.log(`⚠️  All ${samCount} SAM.gov tenders would be suppressed if matching ran again now.`);
      console.log(`    Either re-run the pipeline for this assessment, or update countrySet to include "united states".`);
    } else if (samCount > 0 && samSuppressedByRule === 0) {
      console.log(`✓ SAM.gov is allowed for this user — countrySet includes "united states" / "usa".`);
    }
  } else {
    console.log(`\nNo SAM.gov tenders in matched_tenders.`);
  }

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
