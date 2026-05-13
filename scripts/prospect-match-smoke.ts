/**
 * Non-mutating prospect match smoke test.
 *
 * Reads a real prospect CSV and builds conservative synthetic assessment
 * profiles from the public columns, without crawling websites or calling LLMs.
 * This helps decide whether a prospect list is ready for outreach by checking
 * whether each company would see credible tenders/grants on first dashboard load.
 *
 * Usage:
 *   npx tsx scripts/prospect-match-smoke.ts /path/to/prospects.csv --limit=10
 *   npx tsx scripts/prospect-match-smoke.ts /path/to/prospects.csv --limit=50 --strict
 */
import fs from "node:fs";
import path from "node:path";
import { matchGrants, matchTenders } from "../src/lib/assessment/match";
import type { AIAnalysis, MatchedGrant, MatchedTender, ReadinessDimensions } from "../src/lib/types";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch {}

type ProspectRow = Record<string, string>;

const DEFAULT_CSV = "/Users/odaykamal/Downloads/tenderpath_first50_prospects.csv";

function parseArgs() {
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  return {
    csvPath: positional ?? DEFAULT_CSV,
    limit: Math.max(1, Number(limitArg?.split("=")[1] ?? 15)),
    strict: process.argv.includes("--strict"),
    verbose: process.argv.includes("--verbose"),
  };
}

function parseCsv(text: string): ProspectRow[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === "\"" && next === "\"") {
      field += "\"";
      i++;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);

  const headers = (rows.shift() ?? []).map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() ?? ""])));
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function splitSectorText(value: string): string[] {
  return unique(
    value
      .split(/,|\/|;|\band\b|&/i)
      .map((part) => part.replace(/\([^)]*\)/g, "").trim())
      .filter(Boolean),
  );
}

function themesFor(text: string): string[] {
  const out: string[] = [];
  const add = (pattern: RegExp, values: string[]) => {
    if (pattern.test(text)) out.push(...values);
  };
  add(/\b(water|sanitation|wash|infrastructure)\b/i, ["wash", "water", "sanitation", "infrastructure"]);
  add(/\b(agricultur|food|livelihood|rural)\b/i, ["food security", "agriculture", "livelihoods"]);
  add(/\b(health|medical|nutrition)\b/i, ["health", "public health"]);
  add(/\b(it|software|digital|data|analytics|technology|cyber)\b/i, ["digital", "technology", "innovation", "data"]);
  add(/\b(research|monitoring|evaluation|m&e|consulting|advisory)\b/i, ["governance", "capacity building", "evaluation"]);
  add(/\b(climate|environment|energy|renewable)\b/i, ["climate", "environment", "renewable energy"]);
  add(/\b(education|training|skills|youth)\b/i, ["education", "training", "skills"]);
  return unique(out);
}

function readinessDimensions(score: number): ReadinessDimensions {
  return {
    technical_capability: Math.min(92, score + 6),
    compliance_readiness: Math.min(88, score + 2),
    geographic_reach: Math.min(90, score + 4),
    experience_relevance: Math.max(50, score - 4),
  };
}

function scoreFromRow(row: ProspectRow): number {
  let score = 58;
  if (/yes/i.test(row["UNGM Registration"])) score += 10;
  if (/level\s*1/i.test(row["UNGM Registration Level"])) score += 8;
  if (/level\s*2/i.test(row["UNGM Registration Level"])) score += 12;
  if (/few|many|\d/i.test(row["Contract Win History"])) score += 8;
  if (/usaid partner/i.test(`${row["USAID Partner"]} ${row.Notes}`)) score += 4;
  return Math.min(90, score);
}

function analysisFor(row: ProspectRow): AIAnalysis {
  const sectorText = row.Sector || "consulting";
  const sectors = splitSectorText(sectorText);
  const score = scoreFromRow(row);
  const companySize = row["Company Size"] || "unknown";
  const notes = row.Notes || "";

  return {
    detected_industry: sectors[0] ?? "consulting",
    sectors,
    services: sectors,
    capabilities: unique([
      ...sectors,
      ...themesFor(`${sectorText} ${notes}`),
      row["UNGM Registration"] ? "UNGM registration" : null,
    ]),
    certifications_detected: /yes/i.test(row["UNGM Registration"]) ? ["UNGM"] : [],
    company_size_signal: companySize,
    strengths: unique([
      /yes/i.test(row["UNGM Registration"]) ? "Registered UN vendor" : null,
      /level\s*1/i.test(row["UNGM Registration Level"]) ? "UNGM Level 1 registration" : null,
      /usaid partner/i.test(`${row["USAID Partner"]} ${notes}`) ? "USAID partner evidence" : null,
      row["Contract Win History"] && !/unknown/i.test(row["Contract Win History"]) ? "Some contract win history" : null,
    ]),
    gaps: [],
    readiness_dimensions: readinessDimensions(score),
    overall_score: score,
    summary: `${row["Company Name"]} appears to be a ${sectorText} vendor in ${row.Country || row.Region || "its market"}.`,
  };
}

function includeConsultancies(row: ProspectRow): boolean {
  return /\b(research|monitoring|evaluation|m&e|consulting|advisory)\b/i.test(row.Sector);
}

function orgTypeFor(row: ProspectRow): string {
  const text = `${row.Sector} ${row.Notes}`.toLowerCase();
  if (/\bngo|non-profit|nonprofit|civil society\b/.test(text)) return "NGO";
  if (/\bresearch|university|academic\b/.test(text)) return "research_institution";
  return "company";
}

function topTenderSummary(tender: MatchedTender) {
  return {
    score: Math.round(tender.score),
    bucket: tender.opportunity_bucket_label ?? tender.opportunity_bucket ?? "",
    title: tender.title.slice(0, 90),
    agency: tender.agency,
    country: tender.country,
    deadline: tender.deadline ? new Date(tender.deadline).toISOString().slice(0, 10) : "",
    reason: tender.match_reasons?.[0] ?? tender.match_reason ?? tender.opportunity_bucket_reason ?? "",
  };
}

function topGrantSummary(grant: MatchedGrant) {
  return {
    score: Math.round(grant.score),
    bucket: grant.opportunity_bucket_label ?? grant.opportunity_bucket ?? "",
    title: grant.title.slice(0, 90),
    agency: grant.agency,
    country: grant.country ?? grant.region ?? "",
    deadline: grant.deadline ? new Date(grant.deadline).toISOString().slice(0, 10) : "",
    reason: grant.match_reasons?.[0] ?? grant.match_reason ?? grant.opportunity_bucket_reason ?? "",
  };
}

async function main() {
  const args = parseArgs();
  const csvPath = path.resolve(args.csvPath);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"))
    .filter((row) => row["Company Name"] && !/contacted|do not contact/i.test(row.Status))
    .slice(0, args.limit);

  const finalLog = console.log;
  if (!args.verbose) {
    console.log = () => undefined;
  }

  const prospects = [];
  for (const row of rows) {
    const analysis = analysisFor(row);
    const countries = row.Country ? [row.Country] : [];
    const devThemes = themesFor(`${row.Sector} ${row.Notes}`);
    const [tenders, grants] = await Promise.all([
      matchTenders(analysis, countries, {
        includeConsultancies: includeConsultancies(row),
        userEmail: row["Contact Email"] || undefined,
        orgType: orgTypeFor(row),
      }),
      matchGrants(analysis.sectors, orgTypeFor(row), devThemes, countries),
    ]);

    const topTenders = tenders.slice(0, 5);
    const topGrants = grants.slice(0, 3);
    const actionableTenders = topTenders.filter((tender) =>
      tender.source_url && tender.deadline && (tender.match_reasons?.length || tender.structured_reasons?.summary?.length)
    ).length;
    const outreachReady = topTenders.length >= 3 && actionableTenders >= 3;

    prospects.push({
      company: row["Company Name"],
      website: row["Website URL"],
      country: row.Country,
      sector: row.Sector,
      contactEmail: row["Contact Email"],
      readinessScore: analysis.overall_score,
      tenderMatches: tenders.length,
      grantMatches: grants.length,
      actionableTopTenderCount: actionableTenders,
      outreachReady,
      topTenders: topTenders.map(topTenderSummary),
      topGrants: topGrants.map(topGrantSummary),
      caveats: [
        topTenders.length < 3 ? "fewer than 3 tender matches" : null,
        actionableTenders < 3 ? "top tender actionability below outreach bar" : null,
        grants.length === 0 ? "no current grant matches" : null,
      ].filter(Boolean),
    });
  }

  const summary = {
    csv: csvPath,
    checked: prospects.length,
    outreachReady: prospects.filter((prospect) => prospect.outreachReady).length,
    medianTenderMatches: median(prospects.map((prospect) => prospect.tenderMatches)),
    medianGrantMatches: median(prospects.map((prospect) => prospect.grantMatches)),
    weakProspects: prospects.filter((prospect) => !prospect.outreachReady).map((prospect) => prospect.company),
  };

  const result = {
    checkedAt: new Date().toISOString(),
    summary,
    prospects,
  };

  finalLog(JSON.stringify(result, null, 2));
  if (args.strict && summary.weakProspects.length) process.exitCode = 1;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

main().catch((err) => {
  console.error("[prospect-match-smoke] failed", err);
  process.exit(1);
});
