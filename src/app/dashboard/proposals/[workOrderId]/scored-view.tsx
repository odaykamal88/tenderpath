"use client";

/**
 * scored-view.tsx — the Sprint 6 B1-B5 rendering surface, lifted out of
 * page.tsx so it can be imported from non-page client components.
 *
 * Next.js App Router enforces that `page.tsx` files only export `default`
 * plus a small framework allow-list (metadata, viewport, etc.). When the
 * Sprint 6 dev preview at /dev/proposal-preview/[name]/PreviewClient.tsx
 * tried to import the rendering components directly from the dashboard
 * page, the .next type-check failed with TS2344: "Type ... does not
 * satisfy the constraint '{ [x: string]: never; }'". Moving the named
 * exports into this sibling file is the framework-blessed shape.
 *
 * What lives here:
 *   - All types the rendering reads from output.score / output.draft etc.
 *   - The ProposalOutputJSON shape (both legacy + new fields, so the
 *     adapter can read either).
 *   - SKU + disqualifier + provenance display catalogs (frozen at the
 *     page boundary so we don't import server-side gap-routing into a
 *     client component).
 *   - adaptScored (runtime adapter from output JSON → ScoredView | null)
 *   - The five top-level rendering components: ComplianceVerdict,
 *     RubricScore, RoutedGaps, DraftBody, ExportRow.
 *   - Their internal helpers: Section, CriterionRow, RoutedSkuPanel,
 *     DraftSectionBlock, ClaimRow.
 *
 * What stays in page.tsx:
 *   - ProposalPackage shape, Stage state machine, authHeaders helper
 *     (uses localStorage which only the dashboard page needs).
 *   - LegacyView fallback (only the dashboard page renders it; the dev
 *     preview is exclusively about the new scored view).
 *   - The page itself (default export, useParams + useSearchParams +
 *     useEffect data flow).
 */

import { useMemo } from "react";
import Link from "next/link";
import { MONO, SERIF, confidenceTone, skuTone } from "@/lib/brand/tokens";

// ============================================================================
// Adapted shapes — the page reads from output.score / output.draft etc.
// (stored as JSONB unknown in types.ts); these are the page-side typed
// projections. Kept narrow: only the fields B1-B5 actually render.
// ============================================================================

export type Confidence = "evidenced" | "inferred" | "gap" | "unverified";
export type ServiceSku = "bid_no_bid" | "matching" | "proposal_draft" | "roster";
export type DisqualifierKind = "mandatory_form" | "eligibility" | "format" | "deadline" | "financial";
export type ProvenanceKind = "uploaded_document" | "applicant_library" | "inferred" | "gap";

export interface SourceRef {
  docId: string;
  section?: string;
  rubricVersion: number;
}

export interface Disqualifier {
  id: string;
  kind: DisqualifierKind;
  rule: string;
  source: SourceRef;
}

export interface CriterionAssessment {
  criterionId: string;
  estimatedScore: number;
  maxScore: number;
  confidence: Confidence;
  mechanicalConfidence?: Confidence;
  claimCount?: number;
  claimsByProvenance?: Partial<Record<ProvenanceKind, number>>;
  weaknesses: string[];
  missingEvidence: string[];
}

export interface LotScoreResult {
  lotId: string;
  perCriterion: CriterionAssessment[];
  estimatedTotal: number;
  lotDisqualifiersTriggered: Disqualifier[];
  passesGating: boolean;
}

export interface ScoreResult {
  rubricVersion: number;
  lotResults: LotScoreResult[];
  noticeWideDisqualifiersTriggered: Disqualifier[];
  routedGaps: RoutedGap[];
}

export interface RoutedGap {
  text: string;
  kind: "weakness" | "missing_evidence" | "disqualifier" | "claim_gap";
  lotId?: string;
  criterionId?: string;
  routedTo: ServiceSku;
  rationale: string;
  ctaCopy: string;
  sourceRef?: SourceRef;
  ruleId: string;
}

export interface Provenance {
  kind: ProvenanceKind;
  sourceRef?: SourceRef;
  note?: string;
}

export interface Claim {
  text: string;
  provenance: Provenance;
}

export interface DraftSection {
  lotId?: string;
  criterionId: string;
  content: string;
  claims: Claim[];
}

export interface RevisionAttemptSummary {
  attempt: number;
  estimatedTotal: number;
  achievableTotal: number;
  passesGating: boolean;
  triggeredDisqualifierIds: string[];
  weakCriteriaIds: string[];
}

export interface ScoredView {
  score: ScoreResult;
  draft: DraftSection[];
  revisionHistory: RevisionAttemptSummary[];
  rubricLabels: Map<string, string>; // criterionId → label (from tender_rubric)
}

// ============================================================================
// Legacy shape (preserved for fallback render — kept here so the
// ProposalOutputJSON union is in one place)
// ============================================================================

export interface LegacyComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
  priority?: "mandatory" | "recommended";
  evidence_label?: "evidence_from_library" | "user_claim" | "inference" | "gap";
}

export interface LegacyGateState {
  total: number;
  mandatory_gaps: number;
  recommended_gaps: number;
  gap_items: Array<{
    requirement: string;
    priority: "mandatory" | "recommended";
    evidence_or_action: string;
    evidence_label?: LegacyComplianceItem["evidence_label"];
  }>;
}

export interface LegacySourceQuality {
  status: "ready" | "needs_review" | "blocked";
  score_0_10: number;
  missing_inputs?: string[];
  warnings?: string[];
}

export interface LegacyAgencyReadiness {
  agency_slug: string;
  agency_label: string;
  readiness_0_10: number;
  document_coverage_0_10: number;
  category_fit_0_10: number;
  geographic_fit_0_10: number;
  recommendation: "start_here" | "viable" | "blocked";
  rationale: string;
  missing_documents: string[];
  next_actions: string[];
}

export interface ProposalOutputJSON {
  // Legacy fields (8-section narrative)
  executive_summary?: string;
  technical_approach?: string[];
  compliance_checklist?: Array<string | LegacyComplianceItem>;
  required_documents?: string[];
  cover_letter_draft?: string;
  financial_template_notes?: string[];
  missing_information?: string[];
  next_steps?: string[];
  source_quality?: LegacySourceQuality;
  gate_state?: LegacyGateState;
  // Sprint 14 roster fields
  registration_checklist?: string[];
  capability_statement_draft?: string;
  organization_profile_notes?: string[];
  submission_guidance?: string[];
  agency_readiness_breakdown?: LegacyAgencyReadiness[];
  // Sprint 6 new fields (JSON, runtime-validated)
  score?: unknown;
  draft?: unknown;
  routed_gaps?: unknown;
  revision_history?: unknown;
  tender_rubric?: unknown;
}

// ============================================================================
// Runtime adapter — pull the scored view out of output JSON (or null)
// ============================================================================

export function adaptScored(output: ProposalOutputJSON): ScoredView | null {
  if (!output.score || typeof output.score !== "object") return null;
  const score = output.score as ScoreResult;
  if (!Array.isArray(score.lotResults) || !Array.isArray(score.routedGaps)) return null;

  const draft = Array.isArray(output.draft) ? (output.draft as DraftSection[]) : [];
  const revisionHistory = Array.isArray(output.revision_history)
    ? (output.revision_history as RevisionAttemptSummary[])
    : [];

  // Build criterionId → label map from tender_rubric if present, otherwise
  // fall back to the criterionId itself.
  const rubricLabels = new Map<string, string>();
  const tr = output.tender_rubric as { lots?: Array<{ criteria?: Array<{ id?: string; label?: string }> }> } | undefined;
  if (tr?.lots) {
    for (const lot of tr.lots) {
      for (const c of lot.criteria ?? []) {
        if (typeof c?.id === "string" && typeof c?.label === "string") rubricLabels.set(c.id, c.label);
      }
    }
  }

  return { score, draft, revisionHistory, rubricLabels };
}

// ============================================================================
// SKU display catalog — mirrors gap-routing.SERVICE_CATALOG (frozen at the
// page boundary so we don't import server-side modules into a client page)
// ============================================================================

const SKU_META: Record<ServiceSku, { label: string; price: string }> = {
  bid_no_bid: { label: "Bid/No-Bid Analyst", price: "$39" },
  matching: { label: "Matching Subscription", price: "$49/mo" },
  proposal_draft: { label: "Proposal Draft", price: "$299" },
  roster: { label: "Roster Fast-Track", price: "$749" },
};

const DISQ_KIND_LABEL: Record<DisqualifierKind, string> = {
  mandatory_form: "Mandatory form",
  eligibility: "Eligibility",
  format: "Format",
  deadline: "Deadline",
  financial: "Financial",
};

const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  applicant_library: "Evidenced",
  uploaded_document: "From tender doc",
  inferred: "Inferred",
  gap: "Gap",
};

// ============================================================================
// Shared building blocks (preserved brand idiom)
// ============================================================================

// Exported so the LegacyView in page.tsx (and any future per-row module) can
// reuse the same numbered-section idiom without duplicating the brand chrome.
export function Section({
  index,
  title,
  children,
  subtitle,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="rounded-md border border-stone-200/70 bg-white p-6">
      <div className="flex items-baseline gap-3 mb-4 pb-3 border-b border-stone-100">
        <span
          className="text-[10px] font-semibold tabular-nums text-stone-400"
          style={{ fontFamily: MONO }}
        >
          {index}
        </span>
        <div className="flex-1">
          <h3 className="text-[18px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[12px] text-stone-500" style={{ fontFamily: MONO }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// B1 — COMPLIANCE VERDICT (top, most prominent)
// ============================================================================

export function ComplianceVerdict({ score }: { score: ScoreResult }) {
  const allPassGating = score.lotResults.every((lr) => lr.passesGating);
  const allDisqualifiers = [
    ...score.noticeWideDisqualifiersTriggered.map((d) => ({ ...d, scope: "notice-wide" as const })),
    ...score.lotResults.flatMap((lr) =>
      lr.lotDisqualifiersTriggered.map((d) => ({ ...d, scope: `lot ${lr.lotId}` as const })),
    ),
  ];
  const tone = allPassGating
    ? { border: "border-emerald-700", bg: "bg-emerald-50/40", text: "text-emerald-900", label: "text-emerald-800", lead: "Passes gating" }
    : { border: "border-red-700", bg: "bg-red-50/40", text: "text-red-900", label: "text-red-800", lead: "Fails gating" };

  return (
    <div className={`mb-6 rounded-md border-l-2 ${tone.border} ${tone.bg} p-5`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div
            className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${tone.label}`}
            style={{ fontFamily: MONO }}
          >
            Compliance verdict
          </div>
          <h2
            className={`mt-1 text-[28px] leading-tight font-medium ${tone.text}`}
            style={{ fontFamily: SERIF }}
          >
            {tone.lead}
            {allDisqualifiers.length > 0 && (
              <span className="text-[20px] font-normal text-stone-600">
                {" "}
                · {allDisqualifiers.length} disqualifier{allDisqualifiers.length === 1 ? "" : "s"} triggered
              </span>
            )}
          </h2>
        </div>
      </div>
      {allDisqualifiers.length > 0 ? (
        <ul className="mt-4 space-y-2.5">
          {allDisqualifiers.slice(0, 8).map((d) => (
            <li key={`${d.scope}-${d.id}`} className="rounded-sm border border-red-200 bg-white px-3.5 py-3">
              <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
                <span
                  className="rounded-sm border border-red-300 bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-red-800"
                  style={{ fontFamily: MONO }}
                >
                  {DISQ_KIND_LABEL[d.kind] ?? d.kind}
                </span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500"
                  style={{ fontFamily: MONO }}
                >
                  {d.scope}
                </span>
              </div>
              <p className="text-[13.5px] leading-relaxed text-stone-900">{d.rule}</p>
              <p
                className="mt-1.5 text-[10.5px] text-stone-500"
                style={{ fontFamily: MONO }}
              >
                ↳ {d.source.docId}
                {d.source.section ? ` · ${d.source.section}` : ""}
              </p>
            </li>
          ))}
          {allDisqualifiers.length > 8 && (
            <li className="text-[11.5px] text-stone-500 italic">+ {allDisqualifiers.length - 8} more disqualifiers below</li>
          )}
        </ul>
      ) : (
        <p className={`mt-2 text-[13.5px] leading-relaxed ${tone.text}`}>
          No disqualifiers triggered. The draft passes administrative compliance gates; the rubric-score breakdown below shows where points are won and lost.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// B2 — RUBRIC SCORE (totals + per-criterion table)
// ============================================================================

export function RubricScore({ score, rubricLabels }: { score: ScoreResult; rubricLabels: Map<string, string> }) {
  const estimatedTotal = score.lotResults.reduce((s, lr) => s + lr.estimatedTotal, 0);
  const achievableTotal = score.lotResults.reduce(
    (s, lr) => s + lr.perCriterion.reduce((ss, c) => ss + c.maxScore, 0),
    0,
  );
  const pct = achievableTotal > 0 ? Math.round((estimatedTotal / achievableTotal) * 100) : 0;

  return (
    <Section index="01" title="Rubric score" subtitle={`Scored against rubric v${score.rubricVersion}`}>
      <div className="mb-5 rounded-sm border border-stone-200 bg-stone-50/40 p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Estimated total
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className="text-[36px] font-medium tabular-nums text-stone-900"
                style={{ fontFamily: SERIF }}
              >
                {estimatedTotal.toFixed(0)}
              </span>
              <span
                className="text-[16px] tabular-nums text-stone-500"
                style={{ fontFamily: MONO }}
              >
                / {achievableTotal}
              </span>
              <span
                className="ml-2 text-[12px] text-stone-600 tabular-nums"
                style={{ fontFamily: MONO }}
              >
                ({pct}%)
              </span>
            </div>
          </div>
          <div className="text-[11.5px] text-stone-500 leading-relaxed max-w-md">
            Showing a score isn&apos;t a promise of award — it&apos;s how a UN evaluation panel would weight your draft against this tender&apos;s published criteria. Use it to find where to push.
          </div>
        </div>
      </div>

      {score.lotResults.map((lr) => {
        const lotMax = lr.perCriterion.reduce((s, c) => s + c.maxScore, 0);
        return (
          <div key={lr.lotId} className="mb-5 last:mb-0">
            {score.lotResults.length > 1 && (
              <div className="mb-2 flex items-baseline gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                  style={{ fontFamily: MONO }}
                >
                  Lot {lr.lotId}
                </span>
                <span className="text-[12.5px] text-stone-600 tabular-nums" style={{ fontFamily: MONO }}>
                  {lr.estimatedTotal.toFixed(0)} / {lotMax}
                </span>
                <span className={lr.passesGating ? "text-emerald-700 text-[11px]" : "text-red-700 text-[11px]"}>
                  · {lr.passesGating ? "passes gating" : "fails gating"}
                </span>
              </div>
            )}
            <div className="space-y-2">
              {lr.perCriterion.map((c) => (
                <CriterionRow key={c.criterionId} c={c} label={rubricLabels.get(c.criterionId) ?? c.criterionId} />
              ))}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function CriterionRow({ c, label }: { c: CriterionAssessment; label: string }) {
  const llmTone = confidenceTone(c.confidence);
  const mechTone = c.mechanicalConfidence ? confidenceTone(c.mechanicalConfidence) : null;
  const disagreement = mechTone && c.mechanicalConfidence !== c.confidence;
  const pct = c.maxScore > 0 ? (c.estimatedScore / c.maxScore) * 100 : 0;
  return (
    <div className="rounded-sm border border-stone-200 bg-white p-3">
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <span
          className="text-[10px] font-semibold tabular-nums text-stone-400 min-w-[3.5rem]"
          style={{ fontFamily: MONO }}
        >
          {c.criterionId}
        </span>
        <span className="flex-1 text-[13.5px] font-medium text-stone-900">{label}</span>
        <span
          className="text-[13px] font-medium tabular-nums text-stone-900"
          style={{ fontFamily: MONO }}
        >
          {c.estimatedScore.toFixed(1)} / {c.maxScore}
        </span>
      </div>
      {/* score bar */}
      <div className="mb-2 h-1 w-full rounded-full bg-stone-100 overflow-hidden">
        <div className="h-full rounded-full bg-stone-700" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[10.5px]" style={{ fontFamily: MONO }}>
        <span
          className={`rounded-sm border px-1.5 py-0.5 font-semibold uppercase tracking-[0.1em] ${llmTone.border} ${llmTone.bg} ${llmTone.tw}`}
        >
          {llmTone.label}
        </span>
        {mechTone && (
          <span
            className={`rounded-sm border px-1.5 py-0.5 font-semibold uppercase tracking-[0.1em] ${mechTone.border} ${mechTone.bg} ${mechTone.tw}`}
            title="Mechanical rollup from draft claims"
          >
            mech · {mechTone.label}
          </span>
        )}
        {disagreement && (
          <span className="text-stone-500 italic">disagreement signal</span>
        )}
        {c.claimsByProvenance && (c.claimCount ?? 0) > 0 && (
          <span className="text-stone-500">
            {c.claimCount} claim{(c.claimCount ?? 0) === 1 ? "" : "s"}:{" "}
            {Object.entries(c.claimsByProvenance)
              .map(([k, v]) => `${v} ${PROVENANCE_LABEL[k as ProvenanceKind].toLowerCase()}`)
              .join(", ")}
          </span>
        )}
      </div>
      {(c.weaknesses.length > 0 || c.missingEvidence.length > 0) && (
        <div className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed">
          {c.weaknesses.slice(0, 3).map((w, i) => (
            <p key={`w-${i}`} className="text-stone-700">
              <span className="text-amber-700">·</span> {w}
            </p>
          ))}
          {c.missingEvidence.slice(0, 3).map((m, i) => (
            <p key={`m-${i}`} className="text-stone-700">
              <span className="text-red-700">⚠</span> Missing: {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// B3 — ROUTED GAPS (grouped by SKU with CTAs)
// ============================================================================

export function RoutedGaps({ score }: { score: ScoreResult }) {
  const grouped = useMemo(() => {
    const m = new Map<ServiceSku, RoutedGap[]>();
    for (const g of score.routedGaps) {
      if (!m.has(g.routedTo)) m.set(g.routedTo, []);
      m.get(g.routedTo)!.push(g);
    }
    // Stable ordering for the SKU panels:
    // bid_no_bid (catch admin gates) → matching → roster → proposal_draft
    const order: ServiceSku[] = ["bid_no_bid", "matching", "roster", "proposal_draft"];
    return order.filter((s) => m.has(s)).map((s) => [s, m.get(s)!] as const);
  }, [score.routedGaps]);

  if (score.routedGaps.length === 0) {
    return (
      <Section index="02" title="Next actions">
        <p className="text-[13px] text-stone-500 italic">No gaps surfaced — clean draft.</p>
      </Section>
    );
  }

  return (
    <Section
      index="02"
      title="Next actions, by gap"
      subtitle={`Every gap routed to the TenderPath service that closes it · ${score.routedGaps.length} total`}
    >
      <div className="space-y-4">
        {grouped.map(([sku, gaps]) => (
          <RoutedSkuPanel key={sku} sku={sku} gaps={gaps} />
        ))}
      </div>
    </Section>
  );
}

function RoutedSkuPanel({ sku, gaps }: { sku: ServiceSku; gaps: RoutedGap[] }) {
  const tone = skuTone(sku);
  const meta = SKU_META[sku];
  // Use the first gap's rationale as the panel-level rationale; show others as bullets.
  const headline = gaps[0]?.rationale ?? "";
  return (
    <div className={`rounded-md border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white ${tone.badge}`}
            style={{ fontFamily: MONO }}
          >
            {meta.label}
          </span>
          <span className={`text-[12.5px] font-medium ${tone.tw}`} style={{ fontFamily: MONO }}>
            {meta.price}
          </span>
          <span className="text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
            · {gaps.length} gap{gaps.length === 1 ? "" : "s"}
          </span>
        </div>
        <button
          className={`rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white ${tone.badge} hover:opacity-90 transition-opacity`}
          style={{ fontFamily: MONO }}
          onClick={() => alert(`Sprint 6 stub: ${gaps[0]?.ctaCopy ?? meta.label} — Sprint 7 wires the checkout flow.`)}
        >
          {gaps[0]?.ctaCopy ?? meta.label}
        </button>
      </div>
      <p className={`text-[12.5px] italic leading-relaxed ${tone.tw} mb-3`}>{headline}</p>
      <ul className="space-y-1.5">
        {gaps.slice(0, 6).map((g, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-stone-700">
            <span className="text-stone-400 shrink-0 mt-0.5">·</span>
            <span>
              {(g.lotId || g.criterionId) && (
                <span className="text-[10.5px] text-stone-400 mr-1.5" style={{ fontFamily: MONO }}>
                  [{g.lotId ?? "notice"}{g.criterionId ? `/${g.criterionId}` : ""}]
                </span>
              )}
              {g.kind === "disqualifier" && <span className="text-red-700 mr-1">✗</span>}
              {g.text}
            </span>
          </li>
        ))}
        {gaps.length > 6 && (
          <li className="text-[11.5px] text-stone-500 italic">+ {gaps.length - 6} more</li>
        )}
      </ul>
    </div>
  );
}

// ============================================================================
// B4 — DRAFT BODY (one section per criterion with inline provenance)
// ============================================================================

export function DraftBody({ draft, rubricLabels }: { draft: DraftSection[]; rubricLabels: Map<string, string> }) {
  if (draft.length === 0) {
    return (
      <Section index="03" title="Draft sections">
        <p className="text-[13px] text-stone-500 italic">No draft body generated yet.</p>
      </Section>
    );
  }
  return (
    <Section
      index="03"
      title="Draft body"
      subtitle="One section per scored criterion · every claim is provenance-tagged"
    >
      <div className="space-y-5">
        {draft.map((section, i) => (
          <DraftSectionBlock key={i} section={section} label={rubricLabels.get(section.criterionId) ?? section.criterionId} />
        ))}
      </div>
    </Section>
  );
}

function DraftSectionBlock({ section, label }: { section: DraftSection; label: string }) {
  return (
    <div className="rounded-sm border border-stone-200 bg-white p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <span
          className="text-[10px] font-semibold tabular-nums text-stone-400"
          style={{ fontFamily: MONO }}
        >
          {section.lotId ? `${section.lotId} / ` : ""}{section.criterionId}
        </span>
        <span className="text-[14px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          {label}
        </span>
      </div>
      <p className="text-[13.5px] leading-relaxed text-stone-800 whitespace-pre-wrap">{section.content}</p>
      {section.claims.length > 0 && (
        <div className="mt-4 pt-3 border-t border-stone-100">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500 mb-2"
            style={{ fontFamily: MONO }}
          >
            Claims ({section.claims.length})
          </div>
          <ul className="space-y-1.5">
            {section.claims.map((c, i) => (
              <ClaimRow key={i} claim={c} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  const tone = confidenceTone(
    claim.provenance.kind === "applicant_library" || claim.provenance.kind === "uploaded_document"
      ? "evidenced"
      : claim.provenance.kind === "inferred"
        ? "inferred"
        : claim.provenance.kind === "gap"
          ? "gap"
          : "unverified",
  );
  return (
    <li className="flex gap-2 text-[12.5px] leading-relaxed">
      <span
        className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${tone.border} ${tone.bg} ${tone.tw} mt-0.5`}
        style={{ fontFamily: MONO }}
      >
        {PROVENANCE_LABEL[claim.provenance.kind]}
      </span>
      <span className="text-stone-800">
        {claim.text}
        {claim.provenance.note && (
          <span className="text-stone-500 italic"> — {claim.provenance.note}</span>
        )}
      </span>
    </li>
  );
}

// ============================================================================
// B5 — EXPORT row + revision history footnote
// ============================================================================

export function ExportRow({
  workOrderId,
  pdfUrl,
  revisionHistory,
}: {
  workOrderId: string;
  pdfUrl: string | null;
  revisionHistory: RevisionAttemptSummary[];
}) {
  return (
    <Section
      index="04"
      title="Export"
      subtitle="Compliant, rubric-scored proposal draft with every gap flagged against this tender&rsquo;s evaluation criteria"
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        {pdfUrl ? (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Download scored draft PDF
          </a>
        ) : (
          <button
            disabled
            className="rounded-sm bg-stone-300 px-4 py-2.5 text-[12.5px] font-semibold text-stone-600 cursor-not-allowed"
            style={{ fontFamily: MONO }}
          >
            PDF not yet rendered
          </button>
        )}
        <Link
          href={`/dashboard/work-orders/${workOrderId}`}
          className="rounded-sm border border-stone-300 px-4 py-2.5 text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
          style={{ fontFamily: MONO }}
        >
          Back to work order
        </Link>
      </div>
      {revisionHistory.length > 1 && (
        <div className="mt-4 pt-3 border-t border-stone-100">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500 mb-2"
            style={{ fontFamily: MONO }}
          >
            Revision history
          </div>
          <ul className="space-y-1">
            {revisionHistory.map((h) => (
              <li key={h.attempt} className="text-[12px] text-stone-600 tabular-nums" style={{ fontFamily: MONO }}>
                attempt {h.attempt}: {h.estimatedTotal.toFixed(0)}/{h.achievableTotal} ·{" "}
                {h.passesGating ? "pass" : "fail"} · weak:{h.weakCriteriaIds.length} · triggered:
                {h.triggeredDisqualifierIds.length}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
