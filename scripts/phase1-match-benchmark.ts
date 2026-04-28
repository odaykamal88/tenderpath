/**
 * Phase 1 matching benchmark.
 *
 * This script turns user-supplied "Tenderpath should catch this" examples into
 * a repeatable audit. It does not ingest aggregator records or change matches;
 * it labels failures so the next implementation step can be targeted:
 * coverage -> metadata -> scoring.
 *
 * Usage:
 *   npx tsx scripts/phase1-match-benchmark.ts
 *   npx tsx scripts/phase1-match-benchmark.ts data/benchmarks/phase1-matching.json
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "../src/lib/db";
import { matchTenders } from "../src/lib/assessment/match";
import type { AIAnalysis, MatchedTender } from "../src/lib/types";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

type BenchmarkProfile = {
  key: string;
  company: string;
  websiteContains: string;
  countries: string[];
  fallbackAnalysis: AIAnalysis;
};

type BenchmarkTender = {
  profileKey: string;
  developmentAidId: string;
  title: string;
  expectedAgency: string;
  expectedCountry: string;
  expectedSectors: string[];
  expectedCategory: string;
  developmentAidUrl: string;
};

type BenchmarkFixture = {
  name: string;
  description: string;
  profiles: BenchmarkProfile[];
  tenders: BenchmarkTender[];
};

type DbTender = {
  id: number;
  title: string;
  agency: string;
  country: string | null;
  deadline: string | null;
  sector: string | null;
  description: string | null;
  source_name: string | null;
  source_url: string | null;
  estimated_value: string | number | null;
};

type ProfileRun = {
  profile: BenchmarkProfile;
  assessmentSource: "latest-assessment" | "fixture-fallback";
  analysis: AIAnalysis;
  countries: string[];
  matches: MatchedTender[];
};

const fixturePath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "data/benchmarks/phase1-matching.json",
);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleSim(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter((t) => t.length >= 3));
  const tb = new Set(norm(b).split(" ").filter((t) => t.length >= 3));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

function titleNeedles(title: string): string[] {
  const stop = new Set([
    "the", "and", "for", "with", "from", "basis", "request", "proposal",
    "provision", "simplified", "rfq", "srfp", "syria", "syrian",
  ]);
  return norm(title)
    .split(" ")
    .filter((t) => t.length >= 5 && !stop.has(t))
    .slice(0, 6);
}

function titleNeedleMatch(expectedTitle: string, actualTitle: string): boolean {
  const needles = titleNeedles(expectedTitle);
  if (!needles.length) return true;
  const actual = norm(actualTitle);
  const hits = needles.filter((n) => actual.includes(n)).length;
  if (needles.length <= 3) return hits === needles.length;
  return hits / needles.length >= 0.6;
}

function countryAliases(country: string): Set<string> {
  const normalized = norm(country);
  const aliases = new Set([normalized]);
  if (normalized === "syria") aliases.add("syrian arab republic");
  if (normalized === "turkiye") aliases.add("turkey");
  if (normalized === "turkey") aliases.add("turkiye");
  return aliases;
}

function expectedCountryMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  return countryAliases(expected).has(norm(actual));
}

function expectedAgencyMatches(expected: string, actual: string): boolean {
  return titleSim(expected, actual) >= 0.35 || norm(actual).includes(norm(expected));
}

function completeness(row: DbTender | null): {
  deadline: boolean;
  country: boolean;
  sector: boolean;
  description: boolean;
  sourceUrl: boolean;
} {
  return {
    deadline: !!row?.deadline,
    country: !!row?.country,
    sector: !!row?.sector,
    description: (row?.description?.trim().length ?? 0) >= 120,
    sourceUrl: !!row?.source_url,
  };
}

function missingFields(c: ReturnType<typeof completeness>): string[] {
  return Object.entries(c)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
}

function likelyFailure(
  dbHit: DbTender | null,
  matched: MatchedTender | null,
  c: ReturnType<typeof completeness>,
): "ok" | "coverage" | "metadata" | "scoring" {
  if (!dbHit) return "coverage";
  if (matched) return "ok";
  const missing = missingFields(c);
  if (missing.includes("sector") || missing.includes("description")) return "metadata";
  return "scoring";
}

async function loadProfile(profile: BenchmarkProfile): Promise<ProfileRun> {
  const rows = await sql`
    SELECT ai_analysis, countries
    FROM assessments
    WHERE website ILIKE ${"%" + profile.websiteContains + "%"}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const analysis = rows.length
    ? rows[0].ai_analysis as AIAnalysis
    : profile.fallbackAnalysis;
  const countries = rows.length
    ? (rows[0].countries as string[] | null) ?? profile.countries
    : profile.countries;

  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const head = String(args[0] ?? "");
    if (head.startsWith("[source-rules]") || head.startsWith("[tp:match:confidence]")) return;
    originalLog(...args);
  };
  try {
    const matches = await matchTenders(analysis, countries);
    return {
      profile,
      assessmentSource: rows.length ? "latest-assessment" : "fixture-fallback",
      analysis,
      countries,
      matches,
    };
  } finally {
    console.log = originalLog;
  }
}

async function findDbTender(tender: BenchmarkTender): Promise<DbTender | null> {
  const needles = titleNeedles(tender.title);
  const patterns = needles.length ? needles.map((n) => `%${n}%`) : [`%${tender.title.slice(0, 30)}%`];
  const rows = await sql`
    SELECT id, title, agency, country, deadline::text, sector, description,
           source_name, source_url, estimated_value
    FROM tenders
    WHERE source_url ILIKE ${"%" + tender.developmentAidId + "%"}
       OR reference_id = ${"DA-" + tender.developmentAidId}
       OR title ILIKE ANY(${patterns}::text[])
    ORDER BY updated_at DESC
    LIMIT 50
  ` as DbTender[];

  let best: { row: DbTender; sim: number } | null = null;
  for (const row of rows) {
    const sim = titleSim(tender.title, row.title);
    const exactDaHit =
      row.source_url?.includes(tender.developmentAidId) ||
      row.source_url?.includes(`/Public/Notice/${tender.developmentAidId}`);
    const contextMatches =
      expectedCountryMatches(tender.expectedCountry, row.country) ||
      expectedAgencyMatches(tender.expectedAgency, row.agency);
    if (!exactDaHit && (!contextMatches || !titleNeedleMatch(tender.title, row.title))) continue;
    if (!best || sim > best.sim) best = { row, sim };
  }
  return best && best.sim >= 0.45 ? best.row : null;
}

function findMatchedTender(tender: BenchmarkTender, matches: MatchedTender[]): MatchedTender | null {
  let best: { match: MatchedTender; sim: number } | null = null;
  for (const match of matches) {
    const sim = titleSim(tender.title, match.title);
    if (!titleNeedleMatch(tender.title, match.title)) continue;
    if (!best || sim > best.sim) best = { match, sim };
  }
  return best && best.sim >= 0.45 ? best.match : null;
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as BenchmarkFixture;
  console.log(`\n=== ${fixture.name} ===`);
  console.log(fixture.description);

  const profileRuns = new Map<string, ProfileRun>();
  for (const profile of fixture.profiles) {
    const run = await loadProfile(profile);
    profileRuns.set(profile.key, run);
    console.log(
      `\n[profile:${profile.key}] ${profile.company} | ${run.assessmentSource} | ` +
      `industry=${run.analysis.detected_industry} | countries=${run.countries.join(", ")} | matches=${run.matches.length}`,
    );
  }

  const rows = [];
  for (const tender of fixture.tenders) {
    const run = profileRuns.get(tender.profileKey);
    if (!run) throw new Error(`No benchmark profile for ${tender.profileKey}`);

    const dbHit = await findDbTender(tender);
    const matched = findMatchedTender(tender, run.matches);
    const c = completeness(dbHit);
    const missing = missingFields(c);
    const failure = likelyFailure(dbHit, matched, c);

    rows.push({
      profile: tender.profileKey,
      failure,
      inDb: !!dbHit,
      matched: !!matched,
      score: matched?.score ?? "",
      missing: missing.join(",") || "",
      dbSource: dbHit?.source_name ?? "",
      dbSector: dbHit?.sector ?? "",
      dbCountry: dbHit?.country ?? "",
      dbDeadline: dbHit?.deadline ? String(dbHit.deadline).slice(0, 10) : "",
      expectedAgency: tender.expectedAgency,
      title: tender.title.slice(0, 72),
    });
  }

  console.log("\n=== Tender benchmark results ===");
  console.table(rows);

  const summary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.failure] = (acc[row.failure] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\n=== Failure summary ===");
  console.table(Object.entries(summary).map(([failure, count]) => ({ failure, count })));

  const next = rows
    .filter((row) => row.failure !== "ok")
    .map((row) => `${row.failure.toUpperCase()}: [${row.profile}] ${row.title}`);
  if (next.length) {
    console.log("\n=== Next fixes ===");
    for (const item of next) console.log(`- ${item}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
