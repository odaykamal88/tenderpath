import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { authorizeAssessmentRead } from "./authz";
import { decodeHtmlEntities } from "@/lib/text/entities";
import { safeUrl } from "@/lib/url";
import { resolveSubmissionPortal, assessRegistrationTiming } from "@/lib/tenders/submission-portals";
import { deriveReportNextStep, type ReportNextStep } from "./next-step";
import type { Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import type { Gap as D2Gap } from "@/components/assessment/GapsTab";
import type { Tender } from "@/components/assessment/TendersTab";
import type { Grant } from "@/components/assessment/GrantsTab";
import type { TenderPeek } from "@/components/assessment/ScoreTab";
import type { MoveGroup } from "@/components/assessment/NextStepsTab";

// Maps a gap's text against the applicant-evidence tag taxonomy.
// When the user's vault carries any of these tags the gap is treated as
// covered: the Gaps-tab CTA flips to a tick and the score impact for that
// gap is added back into the effective score. Patterns mirror the LLM gap
// language produced by analyze.ts, not the raw UN regulation vocabulary.
const GAP_TAG_RULES: { pattern: RegExp; tags: string[] }[] = [
  { pattern: /\bUNGM\b|UN Global Marketplace|vendor registration/i, tags: ["ungm"] },
  { pattern: /\bISO\s*9001|quality management/i, tags: ["iso-9001"] },
  { pattern: /\bISO\s*27001|information security management/i, tags: ["iso-27001"] },
  { pattern: /\bISO\s*14001|environmental management/i, tags: ["iso-14001"] },
  { pattern: /\bISO\s*45001|occupational health/i, tags: ["iso-45001"] },
  { pattern: /\bSA\s*8000\b|social accountability/i, tags: ["sa-8000"] },
  { pattern: /audited?.*financial|audited statement|financial statement|balance sheet|profit (?:and|&) loss/i, tags: ["external-audit", "audited-financials", "financials"] },
  { pattern: /credit rating|bank reference/i, tags: ["financials"] },
  { pattern: /past performance|track record|reference contracts?|project references?/i, tags: ["past-performance", "reference-letter", "contract-award"] },
  { pattern: /consortium|joint venture|partnership agreement|co-applicant/i, tags: ["partnership", "co-applicant"] },
  { pattern: /SEA[\b-]|safeguarding|PSEA|sexual exploitation/i, tags: ["safeguarding", "psea"] },
  { pattern: /PADOR|EuropeAid (registration|ID)/i, tags: ["pador", "europeaid-id"] },
  { pattern: /DUNS|UEI|SAM\.gov registration|CAGE/i, tags: ["duns", "uei", "ncage"] },
  { pattern: /capability statement|company profile/i, tags: ["capability-statement"] },
  { pattern: /risk register|risk management|risk matrix/i, tags: ["risk-management"] },
  { pattern: /M&E|monitoring (?:and|&) evaluation|logframe|logical framework/i, tags: ["monitoring-evaluation"] },
  { pattern: /key personnel|team leader|project manager.*CV/i, tags: ["cv", "key-personnel"] },
];

function tagsRequiredForGap(gap: Gap): string[] {
  const haystack = `${gap.gap}\n${gap.fix}\n${(gap.action_steps ?? []).join("\n")}`;
  const tags = new Set<string>();
  for (const { pattern, tags: t } of GAP_TAG_RULES) {
    if (pattern.test(haystack)) for (const tag of t) tags.add(tag);
  }
  return [...tags];
}

function gapIsCovered(gap: Gap, vaultTags: Set<string>): boolean {
  if (vaultTags.size === 0) return false;
  const required = tagsRequiredForGap(gap);
  if (required.length === 0) return false;
  return required.some((tag) => vaultTags.has(tag));
}

const NEXT_STEPS_BUCKETS: { when: string; severity: "High" | "Med" | "Low"; eta: string }[] = [
  { when: "Days 1 – 14",  severity: "High", eta: "≤14 days" },
  { when: "Days 15 – 45", severity: "Med",  eta: "≤45 days" },
  { when: "Days 46 – 90", severity: "Low",  eta: "≤90 days" },
];

// Score-impact attribution constants.
// SCORE_DELTAS: the top-N open gaps (in original order) earn these projected
// uplifts when their steps are completed; later open gaps default to
// DEFAULT_OPEN_GAP_DELTA. STEPS_PER_GAP caps how many action items per gap
// the Next Steps tab surfaces (mirroring the historical .slice(0, 2)).
const SCORE_DELTAS = [8, 6, 4];
const DEFAULT_OPEN_GAP_DELTA = 3;
const STEPS_PER_GAP = 2;

// Even split that always sums to `total` exactly. Earlier indexes carry any
// remainder so a 2-step gap with delta 7 reads "4 pts" then "3 pts" rather
// than floating fractional values into the UI. Returns [] when count is 0.
function distributeDelta(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Action items shown for a gap. Falls back to gap.fix when the LLM produced
// no structured steps — guarantees every open gap has at least one to-do
// row in the Next Steps tab.
function effectiveStepsForGap(g: Gap): string[] {
  const steps = (g.action_steps ?? []).slice(0, STEPS_PER_GAP);
  return steps.length > 0 ? steps : [g.fix];
}

// Maps the original index of each open gap to its projected score delta.
// Resolved (vault-covered) gaps are skipped — their points are already
// folded into the live score by the resolvedBonus calc in rowToReport.
function gapDeltaByIdx(rawGaps: Gap[], vaultTags: Set<string>): Map<number, number> {
  const map = new Map<number, number>();
  let openIdx = 0;
  for (let i = 0; i < rawGaps.length; i += 1) {
    if (gapIsCovered(rawGaps[i], vaultTags)) continue;
    map.set(i, SCORE_DELTAS[openIdx] ?? DEFAULT_OPEN_GAP_DELTA);
    openIdx += 1;
  }
  return map;
}

function deriveNextStepsGroups(
  rawGaps: Gap[],
  vaultTags: Set<string>,
  gapDeltas: Map<number, number>,
  completions: Set<string>,
): { groups: MoveGroup[]; totalSteps: number } {
  const grouped = new Map<"High" | "Med" | "Low", { idx: number; gap: Gap }[]>([
    ["High", []],
    ["Med", []],
    ["Low", []],
  ]);
  rawGaps.forEach((g, i) => {
    if (gapIsCovered(g, vaultTags)) return; // covered gaps don't need a 90-day step
    grouped.get(mapSeverity(g.severity))!.push({ idx: i, gap: g });
  });

  const groups: MoveGroup[] = [];
  let total = 0;
  for (const bucket of NEXT_STEPS_BUCKETS) {
    const rows = grouped.get(bucket.severity) ?? [];
    if (rows.length === 0) continue;
    const items = rows.flatMap(({ idx, gap }) => {
      const steps = effectiveStepsForGap(gap);
      const gapDelta = gapDeltas.get(idx) ?? DEFAULT_OPEN_GAP_DELTA;
      const deltas = distributeDelta(gapDelta, steps.length);
      return steps.map((step, j) => {
        const stepKey = `g${idx}-s${j}`;
        return {
          title: step,
          why: gap.gap,
          eta: bucket.eta,
          scoreDelta: deltas[j] ?? 0,
          stepKey,
          done: completions.has(stepKey),
        };
      });
    });
    total += items.length;
    groups.push({ when: bucket.when, items });
  }
  return { groups, totalSteps: total };
}

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

function mapGapForUI(
  g: Gap,
  resolved: boolean,
  potentialDelta: number,
  stepsCount: number,
  stepsDone: number,
): D2Gap {
  return {
    severity: mapSeverity(g.severity),
    title: g.gap,
    why: g.fix,
    fix: g.action_steps[0] ?? g.fix,
    resolved,
    potentialDelta,
    stepsCount,
    stepsDone,
  };
}

function mapGapsForUI(
  gaps: Gap[],
  vaultTags: Set<string>,
  gapDeltas: Map<number, number>,
  completions: Set<string>,
): D2Gap[] {
  return gaps.map((g, i) => {
    const resolved = gapIsCovered(g, vaultTags);
    const steps = effectiveStepsForGap(g);
    const stepsCount = steps.length;
    // Covered gaps treat all steps as done — the live score already folds in
    // their delta via resolvedBonus, and the UI hides their potential anyway.
    const stepsDone = resolved
      ? stepsCount
      : steps.reduce((sum, _, j) => sum + (completions.has(`g${i}-s${j}`) ? 1 : 0), 0);
    // Covered gaps surface potentialDelta=0 to avoid double-counting against
    // the score-impact card (which is open-only).
    const potentialDelta = resolved ? 0 : gapDeltas.get(i) ?? DEFAULT_OPEN_GAP_DELTA;
    return mapGapForUI(g, resolved, potentialDelta, stepsCount, stepsDone);
  });
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
  return tenders.map((t) => {
    // Registration awareness: resolve the buyer's supplier portal (keyed off
    // `agency`, not the crawler source) and judge deadline risk here in the
    // data layer — the same request-time Date.now() pattern as `urgent` below,
    // so the feed renders a stable, SSR-safe value with no hydration drift.
    const portal = resolveSubmissionPortal(t.agency);
    const timing = assessRegistrationTiming(t.deadline, portal);
    return {
    code: t.reference_id ?? `T-${t.id}`,
    // Decode at render: a crawler-stored "&amp;" or "&#x27;" otherwise renders
    // literally in the dashboard. Audit 2026-05-19 P2 #13.
    title: decodeHtmlEntities(t.title),
    agency: decodeHtmlEntities(t.agency),
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
    // Bucket KEY (act_now/strong_fit/…) drives the colored dot in the re-ported
    // feed; bucketLabel is the human text. Both come straight off the row.
    bucket: t.opportunity_bucket ?? null,
    // Opportunity type (RFP/ITB/EOI/…) for the feed's Type column. Real fields
    // only — null when the source didn't classify it.
    type: t.opportunity_type ?? t.procurement_category ?? null,
    matchReasons: pickReasons(t),
    caveats: t.structured_reasons?.caveats ?? [],
    decisionHeadline: t.decision_brief?.headline ?? t.opportunity_bucket_reason ?? null,
    registration: portal.isFallback
      ? null
      : {
          portalName: portal.portalName,
          url: portal.registrationUrl,
          leadLabel: portal.leadTimeLabel,
          risk: timing.firstTimeRisk,
        },
    };
  });
}

function mapGrantsForUI(grants: MatchedGrant[]): Grant[] {
  return grants.map((g) => ({
    funder: decodeHtmlEntities(g.agency),
    program: decodeHtmlEntities(g.title),
    ceiling: g.value_range ?? "—",
    eligibility: g.sector,
    effort: "Medium",
    fit: g.score,
    // Closing date for the "Closes" column in the re-ported grants table.
    // Many grant feeds omit it — the DeadlinePill degrades to "No deadline".
    deadline: g.deadline ?? null,
    // Funding geography for the country filter pills. Many grants are global
    // (null) — those always show; the pills only filter the country-bound ones.
    country: g.country ?? g.geography_alignment?.grantCountry ?? null,
    sourceUrl: g.source_url ?? null,
    // Honest editorial line — the match reason / description the engine
    // produced, never a fabricated eligibility verdict. Decoded for entities.
    note: g.match_reasons?.[0]
      ? decodeHtmlEntities(g.match_reasons[0])
      : g.match_reason
      ? decodeHtmlEntities(g.match_reason)
      : g.description
      ? decodeHtmlEntities(g.description)
      : null,
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
  // Unguessable UUID — used in URLs (/assessment/{reportId}, /api/report?id=).
  reportId: string;
  // Zero-padded internal row number — used only for the "No. 0123" eyebrow
  // label. Never appears in URLs after the IDOR fix (launch-audit 2026-05-19).
  displayNumber: string;
  preparedAt: string;
  status: "computing" | "ready" | "failed";
  errorId?: string;
  companyName: string;
  sector: string;
  // The user-selected countries the assessment was run against. Surfaced
  // for the TendersTab thin-pool empty-state copy after the regional-match
  // hard-gate (audit 2026-05-19 P1 #6).
  countries: string[];
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
  // Recommended paid SKU derived from the shared readiness engine — the
  // conversion CTA the anonymous report view shows (the old post-wizard
  // AssessmentResults slab). null when derivation fails (CTA degrades to the
  // save-report sign-up only). Not surfaced to signed-in dashboard viewers.
  nextStep: ReportNextStep | null;
  scoreImpact: { label: string; delta: number; projected: number }[];
  countsByFilter: { all: number; strong: number; closing: number };
  totalSteps: number;
  projectedDelta: number;
  nextStepsGroups: MoveGroup[];
  pdfGaps: { title: string; dim: string; lift: number; effort: string; unlock: string; src: string }[];
  pdfTenders: { title: string; value: string; due: string; fit: number; readiness: string; note: string }[];
  pdfGrants: { title: string; value: string; status: string; due: string; note: string }[];
  plan: { task: string; startDay: number; endDay: number; owner: string }[];
  citations: { scope: string; title: string; url: string }[];
};

type DBRow = {
  id: number;
  public_id: string;
  company_name: string;
  email: string;
  sector: string | null;
  countries: string[] | null;
  readiness_score: number;
  recommended_tier: string | null;
  ai_analysis: {
    summary?: string;
    readiness_dimensions?: ReadinessDimensions;
    overall_score?: number;
    // Classification fields persisted by analyze.ts — read to rebuild the
    // ApplicantContext for the recommended-next-step CTA. Optional because
    // older rows predate some of them.
    sectors?: string[];
    services?: string[];
    capabilities?: string[];
    certifications_detected?: string[];
  } | null;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
  assessment_status: string | null;
  created_at: string;
};

// Aggregates the user's vault-document tags for an assessment owner. Falls back
// to an empty set if anything goes wrong — gap-resolution is additive, so a DB
// hiccup must not regress the page to a "everything still missing" view.
async function loadVaultTagsForEmail(email: string | null | undefined): Promise<Set<string>> {
  if (!email) return new Set();
  try {
    const rows = await sql`
      SELECT array_agg(DISTINCT tag) AS tags
      FROM vault_documents vd
      JOIN users u ON u.id = vd.user_id
      LEFT JOIN LATERAL unnest(COALESCE(vd.tags, '{}'::text[])) AS tag ON TRUE
      WHERE LOWER(u.email) = LOWER(${email})
    `;
    const tags = (rows[0]?.tags as string[] | null) ?? [];
    return new Set(tags.filter(Boolean));
  } catch (err) {
    console.warn("[assessment/data] loadVaultTagsForEmail failed", { email, err });
    return new Set();
  }
}

// Sprint 24 (audit 2026-05-20 UX): step-key set for the Next Steps tab to-do
// checkboxes. Fails open — a DB hiccup just means the user sees their steps
// unchecked rather than blocking the page from rendering. Step writes happen
// via POST /api/assessment/[id]/step-toggle.
async function loadStepCompletionsForAssessment(intId: number): Promise<Set<string>> {
  try {
    const rows = await sql`
      SELECT step_key FROM assessment_step_completions
      WHERE assessment_id = ${intId}
    `;
    return new Set(
      rows
        .map((r) => (typeof r.step_key === "string" ? r.step_key : ""))
        .filter(Boolean),
    );
  } catch (err) {
    console.warn("[assessment/data] loadStepCompletionsForAssessment failed", {
      intId,
      err: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

async function rowToReport(row: DBRow, vaultTags: Set<string>): Promise<AssessmentReport> {
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

  const rawGaps = row.gaps ?? [];
  // Sprint 24 (audit 2026-05-20 UX): completions seed the to-do checkboxes
  // in the Next Steps tab and the "X of Y steps done" subtitle on the Gaps
  // tab. We read them once per page render — force-dynamic on both routes
  // keeps the view fresh after each POST /step-toggle.
  const stepCompletions = await loadStepCompletionsForAssessment(row.id);
  const gapDeltas = gapDeltaByIdx(rawGaps, vaultTags);
  const gaps = mapGapsForUI(rawGaps, vaultTags, gapDeltas, stepCompletions);
  const tenders = mapTendersForUI(row.matched_tenders ?? []);
  const grants = mapGrantsForUI(row.matched_grants ?? []);
  const baseScore = row.readiness_score ?? row.ai_analysis?.overall_score ?? 0;

  // Score impact deltas are anchored to the first three gaps in their original
  // order. Each resolved gap among that anchor set adds its delta back into the
  // effective readiness score. We never increase past 100. Per user choice on
  // 2026-05-20: step completion is "projected gain only" — we do NOT recompute
  // baseScore from step-completion state, only from vault evidence.
  const resolvedFlags = rawGaps.map((g) => gapIsCovered(g, vaultTags));
  const resolvedBonus = resolvedFlags
    .slice(0, SCORE_DELTAS.length)
    .reduce((sum, isResolved, i) => sum + (isResolved ? SCORE_DELTAS[i] : 0), 0);
  const score = Math.min(100, baseScore + resolvedBonus);

  const nowTs = Date.now();
  const closingSoon = tenders.filter(
    (t) => t.deadline && new Date(t.deadline).getTime() - nowTs < 14 * 86_400_000
  );

  // Score-impact card only surfaces gaps the user has not already covered.
  // Resolved gaps fold their delta into the live score above; showing them in
  // the projected impact column would double-count. We reuse the gapDeltas map
  // so the card and the Next Steps tab can never disagree on a gap's uplift.
  let cumulative = score;
  const scoreImpact: { label: string; delta: number; projected: number }[] = [];
  for (let i = 0; i < gaps.length && scoreImpact.length < SCORE_DELTAS.length; i += 1) {
    if (gaps[i].resolved) continue;
    const delta = gapDeltas.get(i) ?? DEFAULT_OPEN_GAP_DELTA;
    cumulative = Math.min(100, cumulative + delta);
    scoreImpact.push({ label: gaps[i].title, delta, projected: cumulative });
  }

  const { groups: nextStepsGroups, totalSteps: nextStepsCount } =
    deriveNextStepsGroups(rawGaps, vaultTags, gapDeltas, stepCompletions);
  const projectedDelta = scoreImpact.reduce((sum, x) => sum + x.delta, 0);

  // Recommended paid next step — same readiness engine the post-wizard page
  // used, recomputed from the persisted classification so the anonymous
  // report CTA matches the old AssessmentResults slab. Best-effort: returns
  // null on failure (the CTA falls back to the save-report sign-up).
  const analysis = row.ai_analysis;
  const nextStep = deriveReportNextStep({
    companyName: row.company_name,
    sector: row.sector,
    sectors: analysis?.sectors ?? [],
    capabilities: analysis?.capabilities ?? analysis?.services ?? [],
    certifications: analysis?.certifications_detected ?? [],
    summary: analysis?.summary,
  });

  return {
    reportId: row.public_id,
    displayNumber: String(row.id).padStart(4, "0"),
    preparedAt: new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    status,
    companyName: decodeHtmlEntities(row.company_name) || row.company_name,
    sector: row.sector ?? "General",
    countries: Array.isArray(row.countries) ? row.countries.filter((c): c is string => typeof c === "string" && c.length > 0) : [],
    score,
    scoreDelta: resolvedBonus,
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
    nextStep,
    scoreImpact,
    countsByFilter: {
      all: tenders.length,
      strong: tenders.filter((t) => t.fit >= 70).length,
      closing: closingSoon.length,
    },
    totalSteps: nextStepsCount,
    projectedDelta,
    nextStepsGroups,
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

// IDOR-safe public reader. Accepts UUID (capability) or legacy int (owner-only,
// logged). See src/lib/assessment/authz.ts for the authorization model.
export async function getAssessment(idOrUuid: string): Promise<AssessmentReport | null> {
  const authorized = await authorizeAssessmentRead(idOrUuid);
  if (!authorized) return null;
  const rows = await sql`
    SELECT id, public_id, company_name, email, sector, countries, readiness_score, recommended_tier,
           ai_analysis, gaps, matched_tenders, matched_grants, assessment_status, created_at
    FROM assessments
    WHERE id = ${authorized.intId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const row = rows[0] as DBRow;
  const vaultTags = await loadVaultTagsForEmail(row.email);
  return rowToReport(row, vaultTags);
}

async function loadLatestAssessmentRow(email: string): Promise<DBRow | null> {
  const rows = await sql`
    SELECT id, public_id, company_name, email, sector, countries, readiness_score, recommended_tier,
           ai_analysis, gaps, matched_tenders, matched_grants, assessment_status, created_at
    FROM assessments
    WHERE email = ${email}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as DBRow) ?? null;
}

// Workbench source loader: returns BOTH the fully-mapped report (score,
// dimensions, resolved-gap state, decoded tenders) AND the raw DB row so the
// Workbench builder can read action_steps / opportunity_type / opportunity_
// bucket that the UI-facing mapping intentionally drops. Single query path —
// the cookie-based getCurrentUserAssessment delegates here, and the
// dashboard-guard-authenticated /api/dashboard/workbench route calls it with
// the email resolved from the request.
export async function loadWorkbenchSource(
  email: string,
): Promise<{ report: AssessmentReport; row: DBRow } | null> {
  const row = await loadLatestAssessmentRow(email);
  if (!row) return null;
  const vaultTags = await loadVaultTagsForEmail(row.email ?? email);
  const report = await rowToReport(row, vaultTags);
  return { report, row };
}

export async function getCurrentUserAssessment(): Promise<AssessmentReport | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("tp_session")?.value;
  if (!token) return null;

  const claims = await verifyToken(token);
  if (!claims) return null;

  const source = await loadWorkbenchSource(claims.email);
  return source?.report ?? null;
}

// Accepts UUID or legacy int; same authorization rules as getAssessment.
// Lightweight reader for the landing-page Hero variant. Returns just enough
// to render "Open {companyName} dashboard" — never the full report — so the
// homepage SSR cost stays bounded. Returns null when there's no session or
// the signed-in user has not run an assessment yet.
// Audit 2026-05-19 P1 #5 (returning-visitor re-engagement).
export async function getViewerHero(): Promise<{ companyName: string; reportId: string } | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tp_session")?.value;
    if (!token) return null;
    const claims = await verifyToken(token);
    if (!claims) return null;

    const rows = await sql`
      SELECT company_name, public_id
      FROM assessments
      WHERE email = ${claims.email}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return {
      companyName: decodeHtmlEntities(rows[0].company_name as string) || (rows[0].company_name as string),
      reportId: rows[0].public_id as string,
    };
  } catch (err) {
    // Fail open: the hero falls back to its first-time variant. Better than
    // server-500ing the entire homepage if the session cookie is malformed.
    console.warn("[landing:hero:viewer_lookup_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function getThisWeek(idOrUuid: string): Promise<{ kind: string; title: string; due: string; url?: string | null; fit: number }[]> {
  const authorized = await authorizeAssessmentRead(idOrUuid);
  if (!authorized) return [];
  const rows = await sql`
    SELECT matched_tenders, matched_grants
    FROM assessments
    WHERE id = ${authorized.intId}
    LIMIT 1
  `;
  if (!rows[0]) return [];

  const tenders: MatchedTender[] = rows[0].matched_tenders ?? [];
  const grants: MatchedGrant[] = rows[0].matched_grants ?? [];
  const cutoff = Date.now() + 14 * 86_400_000;

  const items: { kind: string; title: string; due: string; ts: number; url: string | null; fit: number }[] = [];

  // Unparseable / missing deadlines still surface IF they have a clickable URL —
  // sorted last so they don't push out near-term items.
  const consider = (kind: "Tender" | "Grant", title: string, deadline: string | null, source: string | null | undefined, fit: number) => {
    const url = safeUrl(source);
    if (!deadline) {
      if (url) items.push({ kind, title, due: "TBA", ts: Number.POSITIVE_INFINITY, url, fit });
      return;
    }
    const ts = new Date(deadline).getTime();
    if (Number.isNaN(ts)) {
      if (url) items.push({ kind, title, due: "TBA", ts: Number.POSITIVE_INFINITY, url, fit });
      return;
    }
    if (ts <= cutoff) items.push({ kind, title, due: deadline, ts, url, fit });
  };

  for (const t of tenders) consider("Tender", t.title, t.deadline, t.source_url, t.score ?? 0);
  for (const g of grants) consider("Grant", g.title, g.deadline, g.source_url, g.score ?? 0);

  return items
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 6)
    .map(({ kind, title, due, url, fit }) => ({ kind, title, due, url, fit }));
}

// Score-tab Activity card data. Pipeline counts + active services for the
// signed-in viewer. Returns null when there's no session (so the Activity
// card collapses gracefully for anonymous UUID-capability viewers on
// /assessment/[id]). Fails open: a DB hiccup just hides the card.
export type ViewerActivity = {
  pipeline: { total: number; applied: number; inProgress: number; saved: number };
  // PR-N (2026-05-23): each in-flight work order now carries its tender
  // title (when one was captured in intake) so the score-tab card can
  // render "Service · Tender · Status" per spec. status also reflects
  // the joined proposal_packages.generation_status so a finished
  // deliverable doesn't keep showing "queued" forever.
  services: {
    active: {
      id: number;
      service: string;
      status: string;
      tender_title: string | null;
    }[];
    activeCount: number;
  };
};

export async function getViewerActivity(): Promise<ViewerActivity | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tp_session")?.value;
    if (!token) return null;
    const claims = await verifyToken(token);
    if (!claims) return null;
    return await getViewerActivityForUser(claims.userId);
  } catch (err) {
    console.warn("[assessment:activity:fetch_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// userId-keyed variant for dashboard-guard-authenticated routes (the request
// carries a bearer token, not the tp_session cookie getViewerActivity reads).
export async function getViewerActivityForUser(userId: number): Promise<ViewerActivity | null> {
  try {

    // PR-N (2026-05-23): join proposal_packages so generation_status =
    // 'ready' overrides the stale work_orders.status that stays at
    // 'in_progress' even after the deliverable is generated. Without
    // this join the user saw "queued" forever on the score-tab card.
    // DISTINCT ON keeps us to a single most-recent package per work
    // order (regenerations otherwise produce duplicate rows).
    const [pipelineRows, serviceRows, activeCountRow] = await Promise.all([
      sql`SELECT stage, COUNT(*)::int AS n FROM pipeline_items WHERE user_id = ${userId} GROUP BY stage`,
      sql`
        SELECT w.id, w.service_slug, w.plan, w.status, w.tender_title,
               (
                 SELECT generation_status
                 FROM proposal_packages
                 WHERE work_order_id = w.id
                 ORDER BY created_at DESC
                 LIMIT 1
               ) AS gen_status
        FROM work_orders w
        WHERE w.user_id = ${userId}
          AND w.payment_status = 'paid'
          AND w.status NOT IN ('delivered','canceled')
        ORDER BY w.created_at DESC
        LIMIT 4
      `,
      sql`SELECT COUNT(*)::int AS n FROM work_orders
           WHERE user_id = ${userId} AND payment_status = 'paid' AND status NOT IN ('delivered','canceled')`,
    ]);

    const byStage = new Map<string, number>();
    for (const r of pipelineRows) byStage.set(String(r.stage), Number(r.n));
    const pipeline = {
      total: [...byStage.values()].reduce((a, b) => a + b, 0),
      applied:
        (byStage.get("submitted") ?? 0) +
        (byStage.get("won") ?? 0) +
        (byStage.get("lost") ?? 0),
      inProgress:
        (byStage.get("evaluating") ?? 0) +
        (byStage.get("preparing") ?? 0),
      saved: byStage.get("matched") ?? 0,
    };

    // PR-N (2026-05-23): when proposal_packages.generation_status =
    // 'ready' we map work_orders.status to 'delivered' so the card
    // shows "ready" via the prettyStatus mapping in ScoreTab. Falls
    // back to the raw work_orders.status otherwise.
    const active = serviceRows.map((r) => {
      const genStatus = r.gen_status as string | null;
      const rawStatus = String(r.status);
      const displayStatus = genStatus === "ready" ? "delivered"
        : genStatus === "pending" || genStatus === "generating" ? "in_progress"
        : rawStatus;
      return {
        id: r.id as number,
        service: String(r.service_slug ?? r.plan ?? "service"),
        status: displayStatus,
        tender_title: (r.tender_title as string | null) ?? null,
      };
    });

    return {
      pipeline,
      services: { active, activeCount: (activeCountRow[0]?.n as number) ?? active.length },
    };
  } catch (err) {
    console.warn("[assessment:activity:fetch_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
