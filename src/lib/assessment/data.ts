import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { decodeHtmlEntities } from "@/lib/text/entities";
import type { Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import type { Gap as D2Gap } from "@/components/assessment/GapsTab";
import type { Tender } from "@/components/assessment/TendersTab";
import type { Grant } from "@/components/assessment/GrantsTab";
import type { TenderPeek } from "@/components/assessment/ScoreTab";

const DIM_LABELS: Record<keyof ReadinessDimensions, string> = {
  technical_capability: "Technical capability",
  compliance_readiness: "Compliance",
  geographic_reach: "Geography",
  experience_relevance: "Track record",
};

const PEER_DEFAULTS: Record<keyof ReadinessDimensions, number> = {
  technical_capability: 68,
  compliance_readiness: 61,
  geographic_reach: 65,
  experience_relevance: 58,
};

function mapSeverity(s: string): "High" | "Med" | "Low" {
  if (s === "high") return "High";
  if (s === "medium") return "Med";
  return "Low";
}

function mapGapsForUI(gaps: Gap[]): D2Gap[] {
  return gaps.map((g) => ({
    severity: mapSeverity(g.severity),
    title: g.gap,
    why: g.fix,
    fix: g.action_steps[0] ?? g.fix,
    cta: g.upsell_tier === "submission-package"
      ? "Get submission package →"
      : g.upsell_tier === "strategic-partnership"
      ? "Start partnership plan →"
      : "View intelligence →",
  }));
}

function pickReasons(t: MatchedTender): string[] {
  const summary = t.structured_reasons?.summary ?? [];
  const fallback = t.match_reasons ?? (t.match_reason ? [t.match_reason] : []);
  const sectors = t.structured_reasons?.matchedSectors ?? [];
  const capabilities = t.structured_reasons?.matchedCapabilities ?? [];
  // Prefer LLM-authored summary lines; if none, synthesize from structured
  // sector/capability matches; if still none, fall back to flat reasons.
  const lines: string[] = [];
  for (const line of summary) {
    if (line && !lines.includes(line)) lines.push(line);
  }
  if (lines.length === 0 && sectors.length > 0) {
    lines.push(`Sector match: ${sectors.slice(0, 3).join(", ")}`);
  }
  if (lines.length < 3 && capabilities.length > 0) {
    lines.push(`Capability match: ${capabilities.slice(0, 3).join(", ")}`);
  }
  for (const line of fallback) {
    if (line && !lines.includes(line)) lines.push(line);
    if (lines.length >= 3) break;
  }
  return lines.slice(0, 3);
}

function confidenceFrom(t: MatchedTender): "high" | "medium" | "low" | null {
  const c = t.structured_reasons?.confidence ?? t.confidence ?? null;
  if (c === "high" || c === "medium" || c === "low") return c;
  return null;
}

function mapTendersForUI(tenders: MatchedTender[]): Tender[] {
  return tenders.map((t) => ({
    code: t.reference_id ?? `T-${t.id}`,
    title: t.title,
    agency: t.agency,
    fit: t.score,
    deadline: t.deadline,
    value: t.estimated_value != null ? String(t.estimated_value) : "—",
    urgent: t.deadline ? new Date(t.deadline).getTime() - Date.now() < 14 * 86_400_000 : false,
    sector: t.structured_reasons?.procurement?.sectorLabel ?? t.sector ?? null,
    country: t.structured_reasons?.geographyAlignment?.tenderCountry ?? t.country ?? null,
    sourceUrl: t.structured_reasons?.procurement?.sourceUrl ?? t.source_url ?? null,
    sourceProvenance: t.structured_reasons?.procurement?.sourceProvenance ?? t.source_provenance ?? "unknown",
    confidence: confidenceFrom(t),
    bucketLabel: t.opportunity_bucket_label ?? null,
    matchReasons: pickReasons(t),
    caveats: t.structured_reasons?.caveats ?? [],
    decisionHeadline: t.decision_brief?.headline ?? t.opportunity_bucket_reason ?? null,
  }));
}

function mapGrantsForUI(grants: MatchedGrant[]): Grant[] {
  return grants.map((g) => ({
    funder: g.agency,
    program: g.title,
    ceiling: g.value_range ?? "—",
    eligibility: g.sector,
    effort: "Medium",
    fit: g.score,
  }));
}

function mapDimensions(dims: ReadinessDimensions) {
  return (Object.keys(dims) as (keyof ReadinessDimensions)[]).map((k) => ({
    label: DIM_LABELS[k],
    value: dims[k],
    peer: PEER_DEFAULTS[k],
  }));
}

function mapTopTenders(tenders: MatchedTender[]): TenderPeek[] {
  return tenders.slice(0, 5).map((t) => {
    const reasons = pickReasons(t);
    return {
      code: t.reference_id ?? `T-${t.id}`,
      title: t.title,
      agency: t.agency,
      fit: t.score,
      deadline: t.deadline,
      urgent: t.deadline ? new Date(t.deadline).getTime() - Date.now() < 14 * 86_400_000 : false,
      sector: t.structured_reasons?.procurement?.sectorLabel ?? t.sector ?? null,
      matchReason: reasons[0] ?? t.decision_brief?.headline ?? t.opportunity_bucket_reason ?? null,
      confidence: confidenceFrom(t),
    };
  });
}

function tierLabel(slug: string | null): string {
  if (slug === "submission-package") return "Submission Package";
  if (slug === "strategic-partnership") return "Strategic Partnership";
  return "Tender Intelligence";
}

function tierPrice(slug: string | null): string {
  if (slug === "submission-package") return "$299/mo";
  if (slug === "strategic-partnership") return "$799/mo";
  return "$49/mo";
}

function tierPitch(slug: string | null): string {
  if (slug === "submission-package") return "Full bid-writing support, compliance review, and submission management.";
  if (slug === "strategic-partnership") return "Dedicated advisor, roster preparation, and LTA strategy.";
  return "Live tender alerts, match explanations, and readiness tracking.";
}

export type AssessmentReport = {
  reportId: string;
  preparedAt: string;
  status: "computing" | "ready" | "failed";
  errorId?: string;
  companyName: string;
  sector: string;
  score: number;
  scoreDelta: number;
  tier: string;
  summary: string;
  dimensions: { label: string; value: number; peer: number }[];
  gaps: D2Gap[];
  tenders: Tender[];
  grants: Grant[];
  topTenders: TenderPeek[];
  recommendedTier: { name: string; price: string; pitch: string };
  scoreImpact: { label: string; delta: number; projected: number }[];
  countsByFilter: { all: number; strong: number; closing: number };
  totalSteps: number;
  projectedDelta: number;
  pdfGaps: { title: string; dim: string; lift: number; effort: string; unlock: string; src: string }[];
  pdfTenders: { title: string; value: string; due: string; fit: number; readiness: string; note: string }[];
  pdfGrants: { title: string; value: string; status: string; due: string; note: string }[];
  plan: { task: string; startDay: number; endDay: number; owner: string }[];
  citations: { scope: string; title: string; url: string }[];
};

type DBRow = {
  id: number;
  company_name: string;
  email: string;
  sector: string | null;
  readiness_score: number;
  recommended_tier: string | null;
  ai_analysis: {
    summary?: string;
    readiness_dimensions?: ReadinessDimensions;
    overall_score?: number;
  } | null;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
  assessment_status: string | null;
  created_at: string;
};

function rowToReport(row: DBRow): AssessmentReport {
  // Older assessment rows persisted with a 5th `financial_stability` field;
  // we read whatever is there and ignore it. The UI no longer renders it.
  const rawDims = row.ai_analysis?.readiness_dimensions as Partial<ReadinessDimensions> | undefined;
  const dims: ReadinessDimensions = {
    technical_capability: rawDims?.technical_capability ?? 0,
    compliance_readiness: rawDims?.compliance_readiness ?? 0,
    geographic_reach: rawDims?.geographic_reach ?? 0,
    experience_relevance: rawDims?.experience_relevance ?? 0,
  };
  const status =
    row.assessment_status === "completed" ? "ready"
    : row.assessment_status === "failed" ? "failed"
    : row.assessment_status === "running" || row.assessment_status === "queued" ? "computing"
    : "ready";

  const gaps = mapGapsForUI(row.gaps ?? []);
  const tenders = mapTendersForUI(row.matched_tenders ?? []);
  const grants = mapGrantsForUI(row.matched_grants ?? []);
  const score = row.readiness_score ?? row.ai_analysis?.overall_score ?? 0;

  const nowTs = Date.now();
  const closingSoon = tenders.filter(
    (t) => t.deadline && new Date(t.deadline).getTime() - nowTs < 14 * 86_400_000
  );

  return {
    reportId: String(row.id),
    preparedAt: new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    status,
    companyName: decodeHtmlEntities(row.company_name) || row.company_name,
    sector: row.sector ?? "General",
    score,
    scoreDelta: 0,
    tier: tierLabel(row.recommended_tier),
    summary: row.ai_analysis?.summary ?? "Assessment completed.",
    dimensions: mapDimensions(dims),
    gaps,
    tenders,
    grants,
    topTenders: mapTopTenders(row.matched_tenders ?? []),
    recommendedTier: {
      name: tierLabel(row.recommended_tier),
      price: tierPrice(row.recommended_tier),
      pitch: tierPitch(row.recommended_tier),
    },
    scoreImpact: gaps.slice(0, 3).map((g, i) => ({
      label: g.title,
      delta: [8, 6, 4][i] ?? 3,
      projected: score + ([8, 14, 18][i] ?? 3),
    })),
    countsByFilter: {
      all: tenders.length,
      strong: tenders.filter((t) => t.fit >= 70).length,
      closing: closingSoon.length,
    },
    totalSteps: gaps.length * 2,
    projectedDelta: 16,
    pdfGaps: (row.gaps ?? []).map((g) => ({
      title: g.gap,
      dim: "compliance",
      lift: 6,
      effort: "2 weeks",
      unlock: g.fix,
      src: "",
    })),
    pdfTenders: (row.matched_tenders ?? []).map((t) => ({
      title: t.title,
      value: t.estimated_value != null ? String(t.estimated_value) : "—",
      due: t.deadline,
      fit: t.score,
      readiness: t.score >= 70 ? "bid-ready" : "needs prep",
      note: "",
    })),
    pdfGrants: (row.matched_grants ?? []).map((g) => ({
      title: g.title,
      value: g.value_range ?? "—",
      status: "open",
      due: g.deadline,
      note: "",
    })),
    plan: [],
    citations: [],
  };
}

export async function getAssessment(id: string): Promise<AssessmentReport | null> {
  const rows = await sql`
    SELECT id, company_name, email, sector, readiness_score, recommended_tier,
           ai_analysis, gaps, matched_tenders, matched_grants, assessment_status, created_at
    FROM assessments
    WHERE id = ${Number(id)}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return rowToReport(rows[0] as DBRow);
}

export async function getCurrentUserAssessment(): Promise<AssessmentReport | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("tp_session")?.value;
  if (!token) return null;

  const claims = await verifyToken(token);
  if (!claims) return null;

  const rows = await sql`
    SELECT id, company_name, email, sector, readiness_score, recommended_tier,
           ai_analysis, gaps, matched_tenders, matched_grants, assessment_status, created_at
    FROM assessments
    WHERE email = ${claims.email}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return rowToReport(rows[0] as DBRow);
}

export async function getThisWeek(reportId: string): Promise<{ kind: string; title: string; due: string }[]> {
  const rows = await sql`
    SELECT matched_tenders, matched_grants
    FROM assessments
    WHERE id = ${Number(reportId)}
    LIMIT 1
  `;
  if (!rows[0]) return [];

  const tenders: MatchedTender[] = rows[0].matched_tenders ?? [];
  const grants: MatchedGrant[] = rows[0].matched_grants ?? [];
  const cutoff = Date.now() + 14 * 86_400_000;

  const items: { kind: string; title: string; due: string; ts: number }[] = [];

  for (const t of tenders) {
    if (!t.deadline) continue;
    const ts = new Date(t.deadline).getTime();
    if (ts <= cutoff) {
      items.push({ kind: "Tender", title: t.title, due: t.deadline, ts });
    }
  }
  for (const g of grants) {
    if (!g.deadline) continue;
    const ts = new Date(g.deadline).getTime();
    if (ts <= cutoff) {
      items.push({ kind: "Grant", title: g.title, due: g.deadline, ts });
    }
  }

  return items
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 6)
    .map(({ kind, title, due }) => ({ kind, title, due }));
}
