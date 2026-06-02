/**
 * Diagnose why network/bizdev companies are producing few/no matches.
 *
 * Usage: npx tsx scripts/_network-match-diag.ts
 *
 * For each network company: profile state, countries, analysis richness, and
 * the FULL matchTenders score histogram (not just the >=70 the matcher stores)
 * so we can see how many matches the >=70 threshold + geography are hiding.
 * Read-only.
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

function hist(scores: number[]): string {
  const ge = (n: number) => scores.filter((s) => s >= n).length;
  return `total=${scores.length}  >=70=${ge(70)}  >=60=${ge(60)}  >=55=${ge(55)}  >=50=${ge(50)}  >=40=${ge(40)}`;
}

async function main() {
  const companies = await sql`
    SELECT id, name, website, services_text, countries, org_type, profile_status,
           ai_analysis,
           crawled_data->>'renderMethod' AS render_method,
           crawled_data->>'isThinContent' AS thin,
           ai_analysis->>'detected_industry' AS detected_industry
    FROM network_companies
    ORDER BY id
  `;
  const stored = await sql`
    SELECT c.id, c.name,
      COUNT(m.*)::int AS stored,
      COUNT(m.*) FILTER (WHERE m.status = 'new')::int AS fresh,
      COUNT(m.*) FILTER (WHERE t.status = 'open' AND COALESCE(t.has_broken_link,false) = false)::int AS visible_open
    FROM network_companies c
    LEFT JOIN network_company_matches m ON m.network_company_id = c.id
    LEFT JOIN tenders t ON t.id = m.tender_id
    GROUP BY c.id, c.name ORDER BY c.id
  `;
  console.log("\n=== STORED network_company_matches per company ===");
  for (const s of stored) {
    console.log(`   #${s.id} ${s.name}: stored=${s.stored} fresh=${s.fresh} visible_open=${s.visible_open}`);
  }

  console.log(`\n=== ${companies.length} network companies (live re-score) ===\n`);

  for (const c of companies) {
    const countries = Array.isArray(c.countries) ? (c.countries as string[]) : [];
    const ai = c.ai_analysis as AIAnalysis | null;
    console.log(`#${c.id} ${c.name}`);
    console.log(
      `   profile=${c.profile_status} industry=${c.detected_industry ?? "—"} ` +
      `sectors=${ai?.sectors?.length ?? 0} services=${ai?.services?.length ?? 0} caps=${ai?.capabilities?.length ?? 0} ` +
      `render=${c.render_method ?? "—"} thin=${c.thin ?? "—"}`,
    );
    console.log(`   countries=[${countries.join(", ") || "(EMPTY)"}]  services_text=${c.services_text ? "yes" : "no"}`);

    if (c.profile_status !== "ready" || !ai) {
      console.log("   (profile not ready — skipping match)\n");
      continue;
    }
    try {
      const m1 = await matchTenders(ai, countries, { orgType: (c.org_type as string | null) ?? null, skipEnrichment: true });
      console.log(`   matchTenders(as-matcher):     ${hist(m1.map((m) => m.score))}`);
      console.log(`   top8: ${m1.slice(0, 8).map((m) => `${m.score}(${m.structured_reasons?.geographyAlignment?.mode ?? "?"})`).join(", ")}`);

      const m2 = await matchTenders(ai, countries, { orgType: (c.org_type as string | null) ?? null, includeConsultancies: true, skipEnrichment: true });
      console.log(`   +includeConsultancies:        ${hist(m2.map((m) => m.score))}`);
    } catch (e) {
      console.log(`   matchTenders ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log("");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
