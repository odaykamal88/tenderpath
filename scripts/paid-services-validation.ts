/**
 * Sprint 0 paid-services validation harness.
 *
 * Non-mutating: reads the validation panel and, when enabled, runs bounded
 * live matching against existing tender/grant tables. The goal is to measure
 * whether a vendor has enough assessment, match, and handoff context for a
 * paid TenderPath service without creating assessments or work orders.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { matchGrants, matchTenders } from "../src/lib/assessment/match";
import { buildProposalEvidenceProfile } from "../src/lib/proposal-package/evidence";
import { buildProposalRequirementModel } from "../src/lib/proposal-package/requirements-model";
import { AGENCY_PACKAGES, inferAgencySlug } from "../src/lib/proposal-package/roster-packages";
import type { ProposalEvidenceProfile, ProposalRequirementModel, TenderRequirements } from "../src/lib/proposal-package/types";
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

const DEFAULT_PANEL = "data/validation/paid-services-panel.csv";
const DEFAULT_PROPOSAL_FIXTURES = "data/validation/proposal-requirement-fixtures.json";
const VALIDATION_VERSION = "sprint-3-proposal-requirement-model-v1";
const SUPPORTED_ROSTER_AGENCY_LABELS = new Set(AGENCY_PACKAGES.map((agency) => agency.label.toUpperCase()));

type PanelRow = Record<string, string>;
type FailureCategory =
  | "none"
  | "coverage issue"
  | "metadata issue"
  | "scoring issue"
  | "context issue"
  | "service-output issue"
  | "timeout"
  | "setup issue";
type MatchRunStatus = "skipped" | "completed" | "timed_out" | "error";
type ReadinessStatus = "ready_for_beta" | "needs_human_review" | "blocked";

type Args = {
  panelPath: string;
  limit: number;
  ids: string[] | null;
  timeoutMs: number;
  skipLiveMatching: boolean;
  includeGrants: boolean;
  strict: boolean;
  verbose: boolean;
  outPath: string | null;
  csvOutPath: string | null;
  proposalFixturesPath: string | null;
};

type ContextCheck = {
  key: string;
  ok: boolean;
  category: FailureCategory;
  note: string;
  critical?: boolean;
};

type MatchRun = {
  status: MatchRunStatus;
  elapsedMs: number;
  tenderMatches: number | null;
  grantMatches: number | null;
  actionableTopTenderCount: number | null;
  topTenders: ReturnType<typeof topTenderSummary>[];
  topGrants: ReturnType<typeof topGrantSummary>[];
  error?: string;
};

type ProposalFixture = {
  panel_id: string;
  source_title: string;
  agency: string;
  source_url: string;
  source_type: string;
  derived_note?: string;
  tender_text: string;
  requirements: TenderRequirements;
};

type ProposalFixtureSignal = {
  fixture: ProposalFixture;
  evidenceProfile: ProposalEvidenceProfile;
  requirementModel: ProposalRequirementModel;
};

type ProfileResult = {
  panel_id: string;
  prospect_company: string;
  source_row_id: string;
  website: string;
  country: string;
  region: string;
  sector: string;
  sub_icp: string;
  ungm_status: string;
  fit_class: string;
  service_track: string;
  benchmark_tender_or_agency: string;
  scenario_goal: string;
  assessment_quality_0_10: number;
  dashboard_continuity_0_10: number;
  service_context_completeness_0_10: number;
  proposal_requirement_model_0_10: number | null;
  proposal_requirement_model_status: string | null;
  proposal_fixture_title: string | null;
  proposal_fixture_source_url: string | null;
  service_output_quality_0_10: number;
  trustworthiness_0_10: number;
  time_saved_0_10: number;
  shortlist_impact_0_10: number;
  procurement_effort_collapsed_0_10: number;
  paid_service_readiness_0_10: number;
  top_match_relevance_0_10: number;
  relevant_top_tender_count: number | null;
  readiness_status: ReadinessStatus;
  failure_category: FailureCategory;
  match_run: MatchRun;
  key_failure_points: string[];
  highest_leverage_fix: string;
  missing_context_inputs: string[];
  critical_missing_context_inputs: string[];
  prior_panel_status?: string;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const readValue = (flag: string): string | null => {
    const equals = raw.find((arg) => arg.startsWith(`${flag}=`));
    if (equals) return equals.slice(flag.length + 1);
    const idx = raw.indexOf(flag);
    if (idx >= 0 && raw[idx + 1] && !raw[idx + 1].startsWith("--")) return raw[idx + 1];
    return null;
  };

  const positional = raw.find((arg, i) => !arg.startsWith("--") && raw[i - 1] !== "--panel" && raw[i - 1] !== "--out" && raw[i - 1] !== "--csv-out");
  const outPath = readValue("--out");
  const csvOutPath = readValue("--csv-out");
  const proposalFixtures = readValue("--proposal-fixtures");
  return {
    panelPath: readValue("--panel") ?? positional ?? DEFAULT_PANEL,
    limit: Math.max(1, Number(readValue("--limit") ?? 15)),
    ids: readValue("--ids")?.split(",").map((id) => id.trim()).filter(Boolean) ?? null,
    timeoutMs: Math.max(1_000, Number(readValue("--timeout-ms") ?? 12_000)),
    skipLiveMatching: raw.includes("--skip-live-matching"),
    includeGrants: raw.includes("--include-grants"),
    strict: raw.includes("--strict"),
    verbose: raw.includes("--verbose"),
    outPath,
    csvOutPath: csvOutPath ?? (outPath ? outPath.replace(/\.[^.]+$/, ".csv") : null),
    proposalFixturesPath: proposalFixtures === "none"
      ? null
      : proposalFixtures ?? (fs.existsSync(DEFAULT_PROPOSAL_FIXTURES) ? DEFAULT_PROPOSAL_FIXTURES : null),
  };
}

function parseCsv(text: string): PanelRow[] {
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function normalizeFixtureRequirements(value: unknown): TenderRequirements {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    eligibility_criteria: stringArray(record.eligibility_criteria),
    technical_requirements: stringArray(record.technical_requirements),
    required_documents: stringArray(record.required_documents),
    evaluation_criteria: stringArray(record.evaluation_criteria),
    key_constraints: stringArray(record.key_constraints),
    submission_format: typeof record.submission_format === "string" && record.submission_format.trim()
      ? record.submission_format.trim()
      : "unknown",
  };
}

function loadProposalFixtures(filePath: string | null): Map<string, ProposalFixture> {
  const fixtures = new Map<string, ProposalFixture>();
  if (!filePath) return fixtures;

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return fixtures;
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as { fixtures?: unknown[] };
  for (const item of raw.fixtures ?? []) {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : null;
    if (!record) continue;
    const panelId = typeof record.panel_id === "string" ? record.panel_id.trim() : "";
    const tenderText = typeof record.tender_text === "string" ? record.tender_text.trim() : "";
    const sourceUrl = typeof record.source_url === "string" ? record.source_url.trim() : "";
    if (!panelId || !tenderText || !sourceUrl) continue;
    fixtures.set(panelId.toLowerCase(), {
      panel_id: panelId,
      source_title: typeof record.source_title === "string" ? record.source_title.trim() : "Untitled proposal fixture",
      agency: typeof record.agency === "string" ? record.agency.trim() : "",
      source_url: sourceUrl,
      source_type: typeof record.source_type === "string" ? record.source_type.trim() : "public_source",
      derived_note: typeof record.derived_note === "string" ? record.derived_note.trim() : undefined,
      tender_text: tenderText,
      requirements: normalizeFixtureRequirements(record.requirements),
    });
  }
  return fixtures;
}

function proposalFixtureSignal(fixture?: ProposalFixture): ProposalFixtureSignal | null {
  if (!fixture) return null;
  const evidenceProfile = buildProposalEvidenceProfile({
    tenderText: fixture.tender_text,
    intakeSummary: `proposal_fixture_source: ${fixture.source_url}`,
  });
  const requirementModel = buildProposalRequirementModel({
    requirements: fixture.requirements,
    tenderText: fixture.tender_text,
    evidenceProfile,
  });
  return { fixture, evidenceProfile, requirementModel };
}

function csvEscape(value: string | number | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, "\"\"")}"` : raw;
}

function toCsv(results: ProfileResult[]): string {
  const headers = [
    "panel_id",
    "prospect_company",
    "service_track",
    "fit_class",
    "readiness_status",
    "failure_category",
    "assessment_quality_0_10",
    "dashboard_continuity_0_10",
    "service_context_completeness_0_10",
    "proposal_requirement_model_0_10",
    "proposal_requirement_model_status",
    "proposal_fixture_title",
    "proposal_fixture_source_url",
    "service_output_quality_0_10",
    "procurement_effort_collapsed_0_10",
    "paid_service_readiness_0_10",
    "top_match_relevance_0_10",
    "relevant_top_tender_count",
    "match_run_status",
    "tender_matches",
    "actionable_top_tender_count",
    "grant_matches",
    "key_failure_points",
    "highest_leverage_fix",
  ];
  const lines = [headers.join(",")];
  for (const result of results) {
    lines.push([
      result.panel_id,
      result.prospect_company,
      result.service_track,
      result.fit_class,
      result.readiness_status,
      result.failure_category,
      result.assessment_quality_0_10,
      result.dashboard_continuity_0_10,
      result.service_context_completeness_0_10,
      result.proposal_requirement_model_0_10,
      result.proposal_requirement_model_status,
      result.proposal_fixture_title,
      result.proposal_fixture_source_url,
      result.service_output_quality_0_10,
      result.procurement_effort_collapsed_0_10,
      result.paid_service_readiness_0_10,
      result.top_match_relevance_0_10,
      result.relevant_top_tender_count,
      result.match_run.status,
      result.match_run.tenderMatches,
      result.match_run.actionableTopTenderCount,
      result.match_run.grantMatches,
      result.key_failure_points.join(" | "),
      result.highest_leverage_fix,
    ].map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function cell(row: PanelRow, key: string): string {
  return row[key]?.trim() ?? "";
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
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

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function targetRosterAgencies(benchmark: string): string[] {
  const explicit = AGENCY_PACKAGES
    .map((agency) => agency.label.toUpperCase())
    .filter((label) => new RegExp(`\\b${label}\\b`, "i").test(benchmark));
  const inferred = inferAgencySlug(benchmark);
  const inferredLabel = inferred ? AGENCY_PACKAGES.find((agency) => agency.slug === inferred)?.label.toUpperCase() : null;
  return unique([...explicit, inferredLabel]).map((agency) => agency.toUpperCase());
}

const DOMAIN_STOPWORDS = new Set([
  "about",
  "access",
  "africa",
  "african",
  "agency",
  "agreement",
  "assistance",
  "company",
  "consultancy",
  "consulting",
  "context",
  "development",
  "evidence",
  "global",
  "international",
  "limited",
  "management",
  "procurement",
  "registration",
  "related",
  "request",
  "services",
  "supplier",
  "technical",
  "tender",
  "unfpa",
  "ungm",
  "unicef",
  "unops",
  "undp",
  "world",
]);

function readinessDimensions(score: number): ReadinessDimensions {
  return {
    technical_capability: Math.min(92, score + 6),
    compliance_readiness: Math.min(88, score + 2),
    geographic_reach: Math.min(90, score + 4),
    experience_relevance: Math.max(45, score - 5),
  };
}

function detectedIndustryFor(row: PanelRow): string {
  const text = [
    cell(row, "sector"),
    cell(row, "sub_icp"),
    cell(row, "benchmark_tender_or_agency"),
  ].join(" ").toLowerCase();

  if (/\b(logistics|freight|cargo|customs|transport|warehouse|storage)\b/.test(text)) return "logistics";
  if (/\b(energy|renewable|solar|mini-grid|power)\b/.test(text)) return "energy";
  if (/\b(food safety|haccp|codex|iso 22000|food quality|food compliance)\b/.test(text)) return "food";
  if (/\b(cold-chain|cold chain|pqs|iot|telecom|telecommunications|remote monitoring)\b/.test(text)) return "it";
  if (/\b(health|medical|vaccine|cold-chain|cold chain)\b/.test(text)) return "healthcare";
  if (/\b(food safety|haccp|food|agriculture|veterinary|water bottling)\b/.test(text)) return "food";
  if (/\b(gis|geospatial|remote sensing|software|iot|telecom|technology|it consulting)\b/.test(text)) return "it";
  if (/\b(engineering|construction|electromechanical|wash|sanitation|water)\b/.test(text)) return "engineering";
  if (/\b(media|broadcast|communication|sbc|edutainment)\b/.test(text)) return "consulting";
  if (/\b(policy|research|monitoring|evaluation|m&e|consult|technical assistance|advisory)\b/.test(text)) return "consulting";
  return "consulting";
}

function themesFor(row: PanelRow): string[] {
  const text = [
    cell(row, "sector"),
    cell(row, "sub_icp"),
    cell(row, "benchmark_tender_or_agency"),
  ].join(" ");
  const out: string[] = [];
  const add = (pattern: RegExp, values: string[]) => {
    if (pattern.test(text)) out.push(...values);
  };
  add(/\b(water|sanitation|wash|infrastructure)\b/i, ["wash", "water", "sanitation", "infrastructure"]);
  add(/\b(agricultur|food|livelihood|veterinary|rural)\b/i, ["food security", "agriculture", "livelihoods"]);
  add(/\b(health|medical|vaccine|nutrition)\b/i, ["health", "public health"]);
  add(/\b(it|software|digital|data|analytics|technology|iot|gis|geospatial)\b/i, ["digital", "technology", "data"]);
  add(/\b(research|monitoring|evaluation|m&e|consulting|advisory|policy)\b/i, ["governance", "capacity building", "evaluation"]);
  add(/\b(climate|environment|energy|renewable)\b/i, ["climate", "environment", "renewable energy"]);
  add(/\b(education|training|skills|youth|media|communication|sbc)\b/i, ["education", "training", "behavior change"]);
  return unique(out);
}

function orgTypeFor(row: PanelRow): string {
  const text = `${cell(row, "sector")} ${cell(row, "sub_icp")}`.toLowerCase();
  if (/\bngo|non-profit|nonprofit|civil society\b/.test(text)) return "NGO";
  if (/\bresearch|university|academic|institute\b/.test(text)) return "research_institution";
  return "company";
}

function includeConsultancies(row: PanelRow): boolean {
  return hasAny(`${cell(row, "sector")} ${cell(row, "sub_icp")}`, [
    /\b(policy|research|monitoring|evaluation|m&e|consulting|advisory|technical assistance|health systems)\b/i,
  ]);
}

function assessmentQuality(row: PanelRow): number {
  const fit = cell(row, "fit_class").toLowerCase();
  const website = cell(row, "website");
  const inputs = cell(row, "public_inputs_available").toLowerCase();
  const missing = cell(row, "missing_inputs").toLowerCase();
  let score = 4.2;

  if (cell(row, "sector")) score += 0.8;
  if (cell(row, "sub_icp")) score += 0.8;
  if (website) score += 1.1;
  if (/official/.test(inputs)) score += 0.9;
  if (/yes/.test(cell(row, "ungm_status"))) score += 1.0;
  if (/level 2/.test(cell(row, "ungm_status").toLowerCase())) score += 0.5;
  if (cell(row, "benchmark_tender_or_agency")) score += 0.6;
  if (fit.includes("strong")) score += 0.8;
  if (fit.includes("adjacent")) score += 0.2;
  if (fit.includes("weak")) score -= 1.0;
  if (!website || /no official|name collision|ambiguous|weak public footprint/.test(`${inputs} ${missing}`)) score -= 1.3;

  return clampScore(score);
}

function analysisFor(row: PanelRow): AIAnalysis {
  const industry = detectedIndustryFor(row);
  const sectorParts = splitSectorText(`${cell(row, "sector")}; ${cell(row, "sub_icp")}`);
  const readiness = Math.round(assessmentQuality(row) * 10);
  const ungm = /yes/i.test(cell(row, "ungm_status"));

  return {
    detected_industry: industry,
    sectors: unique([industry, ...sectorParts]),
    services: sectorParts.length ? sectorParts : [industry],
    capabilities: unique([
      ...sectorParts,
      ...themesFor(row),
      ungm ? "UNGM registration" : null,
      /level 2/i.test(cell(row, "ungm_status")) ? "UNGM Level 2 registration" : null,
    ]),
    certifications_detected: ungm ? ["UNGM"] : [],
    company_size_signal: "SME / specialist vendor",
    strengths: unique([
      ungm ? "Registered UN vendor" : null,
      /level 2/i.test(cell(row, "ungm_status")) ? "UNGM Level 2 registration" : null,
      cell(row, "website") ? "Public company website available" : null,
      cell(row, "public_inputs_available") || null,
    ]),
    gaps: [],
    readiness_dimensions: readinessDimensions(readiness),
    overall_score: readiness,
    summary: `${cell(row, "prospect_company")} appears to be a ${cell(row, "sector") || industry} vendor in ${cell(row, "country") || cell(row, "region")}.`,
  };
}

function topTenderSummary(tender: MatchedTender) {
  return {
    score: Math.round(tender.score),
    bucket: tender.opportunity_bucket_label ?? tender.opportunity_bucket ?? "",
    title: tender.title.slice(0, 100),
    agency: tender.agency,
    country: tender.country,
    deadline: tender.deadline ? new Date(tender.deadline).toISOString().slice(0, 10) : "",
    source_url: tender.source_url ?? "",
    reason: tender.match_reasons?.[0] ?? tender.match_reason ?? tender.opportunity_bucket_reason ?? "",
  };
}

function topGrantSummary(grant: MatchedGrant) {
  return {
    score: Math.round(grant.score),
    bucket: grant.opportunity_bucket_label ?? grant.opportunity_bucket ?? "",
    title: grant.title.slice(0, 100),
    agency: grant.agency,
    country: grant.country ?? grant.region ?? "",
    deadline: grant.deadline ? new Date(grant.deadline).toISOString().slice(0, 10) : "",
    source_url: grant.source_url ?? "",
    reason: grant.match_reasons?.[0] ?? grant.match_reason ?? grant.opportunity_bucket_reason ?? "",
  };
}

function actionableTender(tender: MatchedTender): boolean {
  return !!tender.source_url
    && !!tender.deadline
    && !!tender.agency
    && !!tender.title
    && !!(tender.match_reasons?.length || tender.structured_reasons?.summary?.length || tender.match_reason);
}

function domainKeywords(row: PanelRow): string[] {
  const raw = [
    cell(row, "sector"),
    cell(row, "sub_icp"),
    cell(row, "benchmark_tender_or_agency"),
    cell(row, "scenario_goal"),
  ].join(" ");

  const tokens = raw
    .toLowerCase()
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 5 && !DOMAIN_STOPWORDS.has(token));

  const phrases: string[] = [];
  if (/policy|research|evidence/i.test(raw)) phrases.push("policy", "research");
  if (/environment|climate|waste|sesa/i.test(raw)) phrases.push("environment", "climate", "waste", "sesa");
  if (/freight|cargo|customs|logistics/i.test(raw)) phrases.push("freight", "cargo", "customs", "logistics");
  if (/health|financing|systems/i.test(raw)) phrases.push("health", "financing", "systems");
  if (/monitoring|evaluation|survey|fragile/i.test(raw)) phrases.push("monitoring", "evaluation", "survey");
  if (/media|behavior|communication|edutainment|broadcast/i.test(raw)) phrases.push("media", "communication", "behavior");
  if (/food safety|haccp|codex|iso 22000/i.test(raw)) phrases.push("food", "safety", "haccp", "codex");
  if (/renewable|energy|mini-grid|solar/i.test(raw)) phrases.push("renewable", "energy", "solar");
  if (/cold-chain|cold chain|vaccine|pqs|iot/i.test(raw)) phrases.push("vaccine", "cold", "chain", "remote", "monitoring");
  if (/geospatial|gis|remote sensing/i.test(raw)) phrases.push("geospatial", "gis", "remote", "sensing");
  if (/wash|sanitation|water/i.test(raw)) phrases.push("wash", "sanitation", "water");
  if (/agriculture|veterinary/i.test(raw)) phrases.push("agriculture", "veterinary");

  return unique([...phrases, ...tokens]).slice(0, 18);
}

function topTenderRelevance(row: PanelRow, matchRun: MatchRun): { score: number; relevantCount: number | null; keywords: string[] } {
  if (matchRun.status !== "completed") return { score: matchRun.status === "skipped" ? 5.0 : 1.5, relevantCount: null, keywords: [] };
  if (!matchRun.topTenders.length) return { score: 0, relevantCount: 0, keywords: domainKeywords(row) };

  const keywords = domainKeywords(row);
  let relevantCount = 0;
  for (const tender of matchRun.topTenders) {
    const text = `${tender.title} ${tender.agency} ${tender.reason}`.toLowerCase();
    const hits = keywords.filter((keyword) => text.includes(keyword)).length;
    if (hits >= 2) relevantCount++;
  }

  return {
    score: clampScore((relevantCount / matchRun.topTenders.length) * 10),
    relevantCount,
    keywords,
  };
}

function emptyMatchRun(status: MatchRunStatus, elapsedMs: number, error?: string): MatchRun {
  return {
    status,
    elapsedMs,
    tenderMatches: status === "skipped" ? null : 0,
    grantMatches: status === "skipped" ? null : 0,
    actionableTopTenderCount: status === "skipped" ? null : 0,
    topTenders: [],
    topGrants: [],
    error,
  };
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ ok: false; timedOut: true; error: string }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true, error: `timed out after ${timeoutMs}ms` }), timeoutMs);
  });

  try {
    return await Promise.race([
      work
        .then((value) => ({ ok: true, value }) as const)
        .catch((error: unknown) => ({ ok: false, timedOut: false, error: errorMessage(error) }) as const),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runLiveMatching(row: PanelRow, args: Args): Promise<MatchRun> {
  if (args.skipLiveMatching) return emptyMatchRun("skipped", 0);

  const started = Date.now();
  const analysis = analysisFor(row);
  const countries = cell(row, "country") ? [cell(row, "country")] : [];
  const orgType = orgTypeFor(row);
  const devThemes = themesFor(row);
  const matchPromise = Promise.all([
    matchTenders(analysis, countries, {
      includeConsultancies: includeConsultancies(row),
      orgType,
      skipEnrichment: true,
      skipAdjacent: true,
      candidateLimitPerSlug: 80,
      geographyCandidateLimit: 160,
      baselineCandidateLimit: 120,
    }),
    args.includeGrants ? matchGrants(analysis.sectors, orgType, devThemes, countries) : Promise.resolve([] as MatchedGrant[]),
  ]);
  const result = await withTimeout(matchPromise, args.timeoutMs);
  const elapsedMs = Date.now() - started;

  if (result.ok === false) {
    return emptyMatchRun(result.timedOut ? "timed_out" : "error", elapsedMs, result.error);
  }

  const [tenders, grants] = result.value;
  const topTenders = tenders.slice(0, 5);
  const topGrants = grants.slice(0, 3);
  return {
    status: "completed",
    elapsedMs,
    tenderMatches: tenders.length,
    grantMatches: args.includeGrants ? grants.length : null,
    actionableTopTenderCount: topTenders.filter(actionableTender).length,
    topTenders: topTenders.map(topTenderSummary),
    topGrants: topGrants.map(topGrantSummary),
  };
}

function commonContextChecks(row: PanelRow, matchRun: MatchRun): ContextCheck[] {
  const publicInputs = cell(row, "public_inputs_available").toLowerCase();
  const missingInputs = cell(row, "missing_inputs").toLowerCase();
  const relevance = topTenderRelevance(row, matchRun);
  const serviceTrack = cell(row, "service_track").toLowerCase();
  const rosterTrack = serviceTrack.includes("roster");
  const requiredActionableMatches = serviceTrack.includes("bid") || serviceTrack.includes("proposal") ? 1 : 2;
  return [
    {
      key: "source_row_id",
      ok: !!cell(row, "source_row_id"),
      category: "metadata issue",
      note: "source prospect row id is missing",
    },
    {
      key: "public_company_evidence",
      ok: !!cell(row, "website") || (/official/.test(publicInputs) && !/no official/.test(publicInputs)),
      category: "coverage issue",
      note: "official website or equivalent company evidence is missing",
      critical: true,
    },
    {
      key: "sector_and_sub_icp",
      ok: !!cell(row, "sector") && !!cell(row, "sub_icp"),
      category: "metadata issue",
      note: "sector/sub-ICP is not specific enough",
      critical: true,
    },
    {
      key: "ungm_status",
      ok: /yes/i.test(cell(row, "ungm_status")),
      category: "coverage issue",
      note: "UNGM status is missing or unverified",
    },
    {
      key: "benchmark_context",
      ok: !!cell(row, "benchmark_tender_or_agency"),
      category: "context issue",
      note: "benchmark tender or target agency is missing",
      critical: true,
    },
    {
      key: "expected_win_defined",
      ok: !!cell(row, "expected_primary_win"),
      category: "context issue",
      note: "expected paid-service win is not explicit",
    },
    {
      key: "missing_inputs_known",
      ok: !!cell(row, "missing_inputs"),
      category: "context issue",
      note: "known missing inputs are not captured",
    },
    {
      key: "actionable_match_context",
      ok: matchRun.status === "skipped" || rosterTrack || (matchRun.actionableTopTenderCount ?? 0) >= requiredActionableMatches,
      category: matchRun.status === "timed_out" ? "timeout" : "metadata issue",
      note: rosterTrack
        ? "live tender matches are secondary for roster fast-track"
        : matchRun.status === "skipped"
        ? "live matching was skipped"
        : requiredActionableMatches === 1
        ? "no actionable top tender has source URL, deadline, agency and match reasons"
        : "fewer than two top tender matches have source URL, deadline, agency and match reasons",
      critical: matchRun.status !== "skipped" && !rosterTrack,
    },
    {
      key: "top_match_relevance",
      ok: matchRun.status !== "completed"
        || (rosterTrack && matchRun.topTenders.length === 0)
        || (relevance.relevantCount ?? 0) >= Math.min(rosterTrack ? 1 : 2, matchRun.topTenders.length),
      category: "scoring issue",
      note: "top live matches are actionable but off-profile for this validation scenario",
      critical: matchRun.status === "completed" && !rosterTrack && (matchRun.actionableTopTenderCount ?? 0) > 0,
    },
    {
      key: "match_run_completed",
      ok: matchRun.status === "skipped" || matchRun.status === "completed",
      category: matchRun.status === "timed_out" ? "timeout" : "setup issue",
      note: matchRun.error ? `live matching did not complete: ${matchRun.error}` : "live matching did not complete",
      critical: matchRun.status !== "skipped",
    },
    {
      key: "identity_safe",
      ok: !/name collision|no official website|no official site|ambiguous public search/.test(`${publicInputs} ${missingInputs}`),
      category: "coverage issue",
      note: "company identity evidence is unsafe or ambiguous",
      critical: true,
    },
  ];
}

function trackContextChecks(row: PanelRow, fixtureSignal?: ProposalFixtureSignal | null): ContextCheck[] {
  const serviceTrack = cell(row, "service_track").toLowerCase();
  const benchmark = cell(row, "benchmark_tender_or_agency");
  const missing = cell(row, "missing_inputs").toLowerCase();
  const publicInputs = cell(row, "public_inputs_available").toLowerCase();
  const hasSpecificNotice = /\b(notice|rfp|rfq|eoi|tender|lta|framework|call)\b|\b\d{4,}\b/i.test(benchmark);
  const actualTenderDocMissing = /actual (tor|rfp|tender|scope)|exact tender|eligibility criteria|evaluation criteria/.test(missing);
  const rosterAgencies = targetRosterAgencies(benchmark);
  const unsupportedRosterAgencies = rosterAgencies.filter((agency) => !SUPPORTED_ROSTER_AGENCY_LABELS.has(agency));
  const supportedRosterAgency = rosterAgencies.length > 0 && unsupportedRosterAgencies.length === 0;

  if (serviceTrack.includes("bid")) {
    return [
      {
        key: "selected_tender_context",
        ok: hasSpecificNotice,
        category: "context issue",
        note: "bid/no-bid lacks a specific tender notice or source context",
        critical: true,
      },
      {
        key: "eligibility_requirements",
        ok: !actualTenderDocMissing,
        category: "service-output issue",
        note: "eligibility/TOR requirements are not available to ground the decision",
        critical: true,
      },
      {
        key: "capacity_docs",
        ok: !/capacity|licenses|insurance|certification|financials|references|cvs|route/.test(missing),
        category: "context issue",
        note: "vendor capacity/compliance evidence is missing",
      },
    ];
  }

  if (serviceTrack.includes("proposal")) {
    const requirementModel = fixtureSignal?.requirementModel ?? null;
    const hasFixtureTor = Boolean(fixtureSignal);
    const hasTechnicalCoverage = (requirementModel?.category_counts.technical ?? 0) > 0;
    const hasDocumentCoverage = (requirementModel?.category_counts.document ?? 0) > 0;
    const hasEvaluationCoverage = (requirementModel?.category_counts.evaluation ?? 0) > 0;
    const hasSubmissionCoverage = (requirementModel?.category_counts.submission ?? 0) > 0;
    return [
      {
        key: "actual_tor_or_rfp",
        ok: hasFixtureTor || !/actual (tor|rfp)|actual rfp|actual tor|tender-specific|evaluation criteria|financial template/.test(missing),
        category: "service-output issue",
        note: hasFixtureTor ? "proposal fixture TOR/RFP is parsed" : "actual TOR/RFP is missing or not parsed",
        critical: true,
      },
      {
        key: "evaluation_criteria",
        ok: hasTechnicalCoverage && hasDocumentCoverage && hasEvaluationCoverage && hasSubmissionCoverage
          ? true
          : !/evaluation criteria|deliverables|submission format|financial template/.test(missing),
        category: "service-output issue",
        note: "evaluation criteria, deliverables or submission format are missing",
        critical: true,
      },
      {
        key: "proposal_evidence_vault",
        ok: /official/.test(publicInputs) && !/cvs|project references|capability statement|portfolio/.test(missing),
        category: "context issue",
        note: "proposal evidence vault is not complete enough for a paid draft",
      },
      {
        key: "risk_caveats",
        ok: !/reputational|political|safeguarding|donor-safe/.test(missing),
        category: "coverage issue",
        note: "risk/safeguarding evidence is missing for this proposal context",
      },
    ];
  }

  if (serviceTrack.includes("roster")) {
    return [
      {
        key: "supported_agency_pack",
        ok: supportedRosterAgency,
        category: "service-output issue",
        note: unsupportedRosterAgencies.length
          ? `missing agency pack for ${unsupportedRosterAgencies.join("/")}`
          : "target roster agency is not explicit or is not in the supported pack list",
        critical: true,
      },
      {
        key: "category_specificity",
        ok: cell(row, "sub_icp").length >= 24 && /\b(category|supplier|registration|roster|pqs|haccp|mini-grid|cold-chain|food safety|electromechanical)\b/i.test(`${benchmark} ${cell(row, "sub_icp")}`),
        category: "context issue",
        note: "roster category is not narrow enough to produce a premium pack",
        critical: true,
      },
      {
        key: "legal_and_financial_docs",
        ok: !/legal|financial|audited|certificates|licenses|product catalog|manufacturer|datasheets|authorizations/.test(missing),
        category: "context issue",
        note: "legal, financial, certification or product evidence is missing",
      },
      {
        key: "portal_window",
        ok: /\b(UNGM|WFP|UNICEF|UNDP|IOM|WHO|FAO|UNOPS)\b/i.test(benchmark),
        category: "context issue",
        note: "target portal/agency window is not explicit",
      },
    ];
  }

  return [];
}

function contextResult(row: PanelRow, matchRun: MatchRun, fixtureSignal?: ProposalFixtureSignal | null) {
  const checks = [...commonContextChecks(row, matchRun), ...trackContextChecks(row, fixtureSignal)];
  const okCount = checks.filter((check) => check.ok).length;
  const missing = checks.filter((check) => !check.ok);
  return {
    checks,
    score: clampScore((okCount / checks.length) * 10),
    missing: missing.map((check) => check.note),
    criticalMissing: missing.filter((check) => check.critical).map((check) => check.note),
  };
}

function matchQualityScore(row: PanelRow, matchRun: MatchRun): number {
  if (matchRun.status === "skipped") return 5.0;
  if (matchRun.status === "timed_out") return 1.5;
  if (matchRun.status === "error") return 2.0;
  const tenderMatches = matchRun.tenderMatches ?? 0;
  const actionable = matchRun.actionableTopTenderCount ?? 0;
  const topScore = matchRun.topTenders[0]?.score ?? 0;
  const actionability = Math.min(10, tenderMatches * 0.08 + actionable * 1.4 + (topScore >= 70 ? 0.8 : 0.2));
  const relevance = topTenderRelevance(row, matchRun).score;
  return clampScore(0.45 * actionability + 0.55 * relevance);
}

function proposalRequirementModelScore(
  row: PanelRow,
  contextScore: number,
  fixtureSignal?: ProposalFixtureSignal | null,
): number | null {
  const serviceTrack = cell(row, "service_track").toLowerCase();
  if (!serviceTrack.includes("proposal")) return null;
  if (fixtureSignal) return fixtureSignal.requirementModel.score_0_10;

  const missing = cell(row, "missing_inputs").toLowerCase();
  const benchmark = cell(row, "benchmark_tender_or_agency");
  const publicInputs = cell(row, "public_inputs_available").toLowerCase();
  let score = contextScore;

  if (/\b(rfp|tor|tender|notice|call|rfq|eoi)\b/i.test(benchmark)) score += 0.7;
  if (/official/.test(publicInputs) && !/no official/.test(publicInputs)) score += 0.4;
  if (/actual (tor|rfp)|actual rfp|actual tor|tender-specific/.test(missing)) score = Math.min(score, 4.8);
  if (/evaluation criteria|deliverables|submission format/.test(missing)) score = Math.min(score, 6.1);
  if (/required documents|financial template/.test(missing)) score = Math.min(score, 6.8);
  if (/cvs|project references|capability statement|portfolio/.test(missing)) score = Math.min(score, 7.2);

  return clampScore(score);
}

function projectedScores(
  row: PanelRow,
  matchRun: MatchRun,
  contextScore: number,
  fixtureSignal?: ProposalFixtureSignal | null,
) {
  const assessmentScore = assessmentQuality(row);
  const matchScore = matchQualityScore(row, matchRun);
  const serviceTrack = cell(row, "service_track").toLowerCase();
  const fit = cell(row, "fit_class").toLowerCase();
  const fitScore = fit.includes("strong") ? 8.4 : fit.includes("adjacent") ? 6.4 : 3.8;
  const requirementModelScore = proposalRequirementModelScore(row, contextScore, fixtureSignal);
  let serviceOutput = 0.32 * contextScore + 0.28 * assessmentScore + 0.22 * matchScore + 0.18 * fitScore;
  let trustworthiness = 0.38 * assessmentScore + 0.34 * contextScore + 0.18 * matchScore + 0.10 * fitScore;
  let timeSaved = 0.30 * contextScore + 0.28 * matchScore + 0.22 * assessmentScore + 0.20 * fitScore;
  let shortlistImpact = 0.36 * matchScore + 0.25 * assessmentScore + 0.22 * contextScore + 0.17 * fitScore;

  if (requirementModelScore != null) {
    serviceOutput = 0.55 * serviceOutput + 0.45 * requirementModelScore;
    trustworthiness = 0.70 * trustworthiness + 0.30 * requirementModelScore;
    timeSaved = 0.72 * timeSaved + 0.28 * requirementModelScore;
    if (requirementModelScore < 5.5) {
      serviceOutput = Math.min(serviceOutput, 5.6);
      trustworthiness = Math.min(trustworthiness, 6.0);
    }
  }

  if (!fixtureSignal && serviceTrack.includes("proposal") && /actual (tor|rfp)|evaluation criteria|financial template/i.test(cell(row, "missing_inputs"))) {
    serviceOutput = Math.min(serviceOutput, 5.8);
    timeSaved = Math.min(timeSaved, 6.2);
    shortlistImpact = Math.min(shortlistImpact, 5.8);
  }
  const rosterAgencies = targetRosterAgencies(cell(row, "benchmark_tender_or_agency"));
  const unsupportedRosterAgency = serviceTrack.includes("roster")
    && rosterAgencies.some((agency) => !SUPPORTED_ROSTER_AGENCY_LABELS.has(agency));
  if (unsupportedRosterAgency) {
    serviceOutput = Math.min(serviceOutput, 6.2);
    trustworthiness = Math.min(trustworthiness, 6.6);
  }
  if (fit.includes("weak")) {
    serviceOutput = Math.min(serviceOutput, 5.0);
    shortlistImpact = Math.min(shortlistImpact, 4.8);
  }

  const dashboardContinuity = clampScore(0.50 * matchScore + 0.35 * contextScore + 0.15 * assessmentScore);
  const procurementEffortCollapsed = clampScore(0.30 * timeSaved + 0.25 * serviceOutput + 0.25 * dashboardContinuity + 0.20 * trustworthiness);
  const paidReadiness = clampScore(0.30 * serviceOutput + 0.25 * contextScore + 0.20 * trustworthiness + 0.15 * dashboardContinuity + 0.10 * assessmentScore);

  return {
    assessmentScore,
    dashboardContinuity,
    serviceOutput: clampScore(serviceOutput),
    trustworthiness: clampScore(trustworthiness),
    timeSaved: clampScore(timeSaved),
    shortlistImpact: clampScore(shortlistImpact),
    procurementEffortCollapsed,
    paidReadiness,
    requirementModelScore,
  };
}

function dominantFailure(checks: ContextCheck[], matchRun: MatchRun): FailureCategory {
  if (matchRun.status === "timed_out") return "timeout";
  if (matchRun.status === "error") return "setup issue";
  const failed = checks.filter((check) => !check.ok);
  if (!failed.length) return "none";
  const critical = failed.find((check) => check.critical);
  return critical?.category ?? failed[0].category;
}

function readinessStatus(score: number, criticalMissing: string[], failureCategory: FailureCategory): ReadinessStatus {
  if (score >= 8.2 && criticalMissing.length === 0 && failureCategory !== "timeout" && failureCategory !== "setup issue") {
    return "ready_for_beta";
  }
  if (score >= 5.8 && criticalMissing.length <= 2) return "needs_human_review";
  return "blocked";
}

function highestLeverageFix(row: PanelRow, failureCategory: FailureCategory, missing: string[], matchRun: MatchRun): string {
  const track = cell(row, "service_track").toLowerCase();
  if (matchRun.status === "timed_out") return "Bound matching queries by profile and cache top match context so validation cannot stall.";
  if (matchRun.status === "error") return "Fix validation environment/setup so live matching can run before judging paid readiness.";
  if (track.includes("proposal") && missing.some((item) => /TOR|RFP|evaluation|deliverables|submission/.test(item))) {
    return "Parse uploaded TOR/RFP documents into requirements before checkout and cap proposal output when source coverage is low.";
  }
  if (track.includes("roster") && missing.some((item) => /agency pack|category/.test(item))) {
    return "Add agency/category roster packs and force category narrowing before payment.";
  }
  if (missing.some((item) => /identity|official website|company evidence/.test(item))) {
    return "Add an evidence gate that requests a capability statement or verified website before paid fulfillment.";
  }
  if (failureCategory === "metadata issue") {
    return "Persist source URL, deadline, agency, value, match reasons and caveats into the pipeline item used by checkout.";
  }
  if (failureCategory === "scoring issue") {
    return "Add sector-specific scoring guardrails so adjacent and weak-fit vendors get conditional guidance instead of optimism.";
  }
  return "Carry assessment evidence, selected match, missing inputs and service-specific caveats into one work-order context packet.";
}

function validateProfile(row: PanelRow, matchRun: MatchRun, fixture?: ProposalFixture): ProfileResult {
  const fixtureSignal = proposalFixtureSignal(fixture);
  const context = contextResult(row, matchRun, fixtureSignal);
  const relevance = topTenderRelevance(row, matchRun);
  const scores = projectedScores(row, matchRun, context.score, fixtureSignal);
  const failure = dominantFailure(context.checks, matchRun);
  const status = readinessStatus(scores.paidReadiness, context.criticalMissing, failure);
  const failurePoints = unique([
    ...context.criticalMissing,
    ...context.missing.slice(0, 4),
    matchRun.error ? matchRun.error : null,
  ]).slice(0, 6);

  return {
    panel_id: cell(row, "panel_id"),
    prospect_company: cell(row, "prospect_company"),
    source_row_id: cell(row, "source_row_id"),
    website: cell(row, "website"),
    country: cell(row, "country"),
    region: cell(row, "region"),
    sector: cell(row, "sector"),
    sub_icp: cell(row, "sub_icp"),
    ungm_status: cell(row, "ungm_status"),
    fit_class: cell(row, "fit_class"),
    service_track: cell(row, "service_track"),
    benchmark_tender_or_agency: cell(row, "benchmark_tender_or_agency"),
    scenario_goal: cell(row, "scenario_goal"),
    assessment_quality_0_10: scores.assessmentScore,
    dashboard_continuity_0_10: scores.dashboardContinuity,
    service_context_completeness_0_10: context.score,
    proposal_requirement_model_0_10: scores.requirementModelScore,
    proposal_requirement_model_status: fixtureSignal?.requirementModel.status ?? null,
    proposal_fixture_title: fixture?.source_title ?? null,
    proposal_fixture_source_url: fixture?.source_url ?? null,
    service_output_quality_0_10: scores.serviceOutput,
    trustworthiness_0_10: scores.trustworthiness,
    time_saved_0_10: scores.timeSaved,
    shortlist_impact_0_10: scores.shortlistImpact,
    procurement_effort_collapsed_0_10: scores.procurementEffortCollapsed,
    paid_service_readiness_0_10: scores.paidReadiness,
    top_match_relevance_0_10: relevance.score,
    relevant_top_tender_count: relevance.relevantCount,
    readiness_status: status,
    failure_category: failure,
    match_run: matchRun,
    key_failure_points: failurePoints.length ? failurePoints : ["none"],
    highest_leverage_fix: highestLeverageFix(row, failure, context.missing, matchRun),
    missing_context_inputs: context.missing,
    critical_missing_context_inputs: context.criticalMissing,
    prior_panel_status: cell(row, "overall_status") || undefined,
  };
}

function summarize(results: ProfileResult[]) {
  const byTrack = new Map<string, ProfileResult[]>();
  for (const result of results) {
    const key = result.service_track || "Unknown";
    byTrack.set(key, [...(byTrack.get(key) ?? []), result]);
  }

  const trackSummary = Object.fromEntries([...byTrack.entries()].map(([track, rows]) => [
    track,
    {
      checked: rows.length,
      ready_for_beta: rows.filter((row) => row.readiness_status === "ready_for_beta").length,
      needs_human_review: rows.filter((row) => row.readiness_status === "needs_human_review").length,
      blocked: rows.filter((row) => row.readiness_status === "blocked").length,
      median_paid_service_readiness_0_10: median(rows.map((row) => row.paid_service_readiness_0_10)),
      median_procurement_effort_collapsed_0_10: median(rows.map((row) => row.procurement_effort_collapsed_0_10)),
      median_proposal_requirement_model_0_10: rows.some((row) => row.proposal_requirement_model_0_10 != null)
        ? median(rows.flatMap((row) => row.proposal_requirement_model_0_10 == null ? [] : [row.proposal_requirement_model_0_10]))
        : null,
    },
  ]));

  const failureCounts = new Map<FailureCategory, number>();
  const statusCounts = new Map<ReadinessStatus, number>();
  for (const result of results) {
    failureCounts.set(result.failure_category, (failureCounts.get(result.failure_category) ?? 0) + 1);
    statusCounts.set(result.readiness_status, (statusCounts.get(result.readiness_status) ?? 0) + 1);
  }

  const topBlockers = [...new Map(
    results
      .flatMap((result) => result.key_failure_points.filter((point) => point !== "none"))
      .map((point) => [point, 0] as const),
  ).keys()]
    .map((point) => ({
      blocker: point,
      count: results.filter((result) => result.key_failure_points.includes(point)).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    checked: results.length,
    ready_for_beta: results.filter((result) => result.readiness_status === "ready_for_beta").length,
    needs_human_review: results.filter((result) => result.readiness_status === "needs_human_review").length,
    blocked: results.filter((result) => result.readiness_status === "blocked").length,
    median_paid_service_readiness_0_10: median(results.map((result) => result.paid_service_readiness_0_10)),
    median_procurement_effort_collapsed_0_10: median(results.map((result) => result.procurement_effort_collapsed_0_10)),
    median_proposal_requirement_model_0_10: results.some((result) => result.proposal_requirement_model_0_10 != null)
      ? median(results.flatMap((result) => result.proposal_requirement_model_0_10 == null ? [] : [result.proposal_requirement_model_0_10]))
      : null,
    status_counts: Object.fromEntries(statusCounts.entries()),
    failure_category_counts: Object.fromEntries(failureCounts.entries()),
    track_summary: trackSummary,
    top_blockers: topBlockers,
    sprint_0_gate_passed: results.length > 0
      && results.every((result) => result.match_run.status === "completed" || result.match_run.status === "skipped")
      && results.some((result) => result.service_context_completeness_0_10 >= 7),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs();
  const panelPath = path.resolve(args.panelPath);
  const proposalFixtures = loadProposalFixtures(args.proposalFixturesPath);
  const requestedIds = args.ids ? new Set(args.ids.map((id) => id.toLowerCase())) : null;
  const rows = parseCsv(fs.readFileSync(panelPath, "utf-8"))
    .filter((row) => cell(row, "panel_id") && cell(row, "prospect_company"))
    .filter((row) => !requestedIds || requestedIds.has(cell(row, "panel_id").toLowerCase()))
    .slice(0, args.limit);

  const originalLog = console.log.bind(console);
  if (!args.verbose) console.log = () => undefined;

  const results: ProfileResult[] = [];
  let sawTimedOutMatch = false;

  for (const row of rows) {
    console.error(`[paid-services-validation] ${cell(row, "panel_id")} ${cell(row, "prospect_company")} (${cell(row, "service_track")})`);
    const matchRun = await runLiveMatching(row, args);
    if (matchRun.status === "timed_out") sawTimedOutMatch = true;
    results.push(validateProfile(row, matchRun, proposalFixtures.get(cell(row, "panel_id").toLowerCase())));
  }

  const output = {
    checked_at: new Date().toISOString(),
    validation_version: VALIDATION_VERSION,
    panel: panelPath,
    mode: {
      live_matching: !args.skipLiveMatching,
      include_grants: args.includeGrants,
      ids: args.ids,
      timeout_ms_per_profile: args.timeoutMs,
      proposal_fixtures: args.proposalFixturesPath ? path.resolve(args.proposalFixturesPath) : null,
      proposal_fixtures_loaded: proposalFixtures.size,
    },
    summary: summarize(results),
    profiles: results,
  };

  const json = JSON.stringify(output, null, 2);
  if (args.outPath) {
    const outPath = path.resolve(args.outPath);
    ensureDir(outPath);
    fs.writeFileSync(outPath, `${json}\n`);
    console.error(`[paid-services-validation] wrote ${outPath}`);
  }
  if (args.csvOutPath) {
    const csvOutPath = path.resolve(args.csvOutPath);
    ensureDir(csvOutPath);
    fs.writeFileSync(csvOutPath, toCsv(results));
    console.error(`[paid-services-validation] wrote ${csvOutPath}`);
  }

  originalLog(json);
  if (args.strict && results.some((result) => result.readiness_status === "blocked")) process.exitCode = 1;

  // A timed-out Neon/fetch request may keep the event loop alive even after we
  // have a bounded validation result. The harness has already recorded the
  // timeout, so exit deliberately.
  if (sawTimedOutMatch) {
    setTimeout(() => process.exit(process.exitCode ?? 0), 25);
  }
}

main().catch((error: unknown) => {
  console.error("[paid-services-validation] failed", error);
  process.exit(1);
});
