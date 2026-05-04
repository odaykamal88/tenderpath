/**
 * Grant matching benchmark for Wave 4.
 *
 * These synthetic profiles guard the product behavior we care about:
 * geography-aware grants, org eligibility, and useful match reasons.
 *
 * Usage:
 *   npx tsx scripts/grant-match-benchmark.ts
 */
import fs from "node:fs";
import { matchGrants } from "../src/lib/assessment/match";
import type { MatchedGrant } from "../src/lib/types";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

const scenarios = [
  {
    name: "SME in MENA with agriculture/food themes",
    sectors: ["agriculture", "food"],
    orgType: "company",
    devThemes: ["food security", "rural development", "livelihoods"],
    countries: ["Jordan"],
    expected: "Prefer country/regional/global agriculture grants; avoid U.S.-domestic HHS/DOJ grants.",
  },
  {
    name: "NGO with WASH focus in Africa",
    sectors: ["water_sanitation", "healthcare"],
    orgType: "NGO",
    devThemes: ["wash", "public health", "sanitation"],
    countries: ["Kenya"],
    expected: "Prefer Africa/Kenya, WASH, public-health, or civil-society grants with NGO eligibility.",
  },
  {
    name: "Research institution with digital/IT themes",
    sectors: ["it"],
    orgType: "research_institution",
    devThemes: ["digital", "technology", "innovation", "data"],
    countries: ["United States"],
    expected: "Prefer NSF/NASA/NIH/DOC/NIST style research and innovation grants.",
  },
  {
    name: "SME in climate/energy",
    sectors: ["energy", "environment"],
    orgType: "company",
    devThemes: ["renewable energy", "climate", "resilience"],
    countries: ["Egypt"],
    expected: "Prefer global/international climate-energy grants; cap U.S.-domestic grant noise.",
  },
];

function assertScenario(name: string, matches: MatchedGrant[]) {
  const top = matches[0];
  const text = matches
    .map((grant) => `${grant.title} ${grant.agency} ${grant.country ?? ""} ${grant.region ?? ""} ${grant.funding_scope ?? ""} ${grant.match_reasons?.join(" ") ?? ""}`)
    .join("\n")
    .toLowerCase();

  const fail = (message: string): never => {
    throw new Error(`${name}: ${message}`);
  };

  if (name.includes("MENA with agriculture")) {
    if (!matches.length) fail("expected at least one agriculture/food grant after EU import");
    if (/hhs|usdoj|nih|cdc|domestic/.test(text)) fail("returned U.S.-domestic grant noise");
    if (!/agriculture|food security|rural development|food/.test(text)) fail("missing agriculture/food signal");
  }

  if (name.includes("WASH focus")) {
    if (!matches.length) fail("expected at least one WASH-adjacent public-health grant");
    if (/alumni engagement innovation fund|aeif/.test(text)) fail("returned public-diplomacy AEIF noise");
    if (!/specificity caveat|wash|water|sanitation|public health|health/.test(text)) fail("missing WASH/health rationale or caveat");
  }

  if (name.includes("Research institution")) {
    if (!matches.length) fail("expected research/digital matches");
    if (!/digital|technology|innovation|data|nasa|nsf|doe|european commission/.test(text)) fail("missing digital/research signal");
    if (!matches.some((grant) => grant.score >= 80)) fail("expected at least one high-scoring research match");
  }

  if (name.includes("climate/energy")) {
    if (!top) fail("expected climate/energy matches");
    const topText = `${top.title} ${top.country ?? ""} ${top.region ?? ""} ${top.match_reasons?.join(" ") ?? ""}`.toLowerCase();
    if (!/energy|climate|environment|renewable/.test(text)) fail("missing climate/energy signal");
    if (!/middle east|north africa|iraq|global|energy|climate|environment/.test(topText)) fail("top match is not regionally or thematically credible");
  }
}

async function main() {
  for (const scenario of scenarios) {
    const matches = await matchGrants(
      scenario.sectors,
      scenario.orgType,
      scenario.devThemes,
      scenario.countries,
    );

    console.log(`\n=== ${scenario.name} ===`);
    console.log(`Expected: ${scenario.expected}`);
    console.table(matches.slice(0, 6).map((grant) => ({
      score: grant.score,
      bucket: grant.opportunity_bucket_label,
      title: grant.title.slice(0, 70),
      agency: grant.agency,
      country: grant.country,
      region: grant.region,
      scope: grant.funding_scope,
      reason: grant.match_reasons?.slice(0, 3).join(" | "),
    })));
    assertScenario(scenario.name, matches);
  }
  console.log("\nGrant benchmark assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
