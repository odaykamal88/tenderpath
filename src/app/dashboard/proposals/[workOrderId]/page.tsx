"use client";

/**
 * dashboard/proposals/[workOrderId]/page.tsx — the $299 proposal output page.
 *
 * Sprint 6 (proposal-output-ux.md PART B + PART C) repurposed this page to
 * consume the new scoring-engine emit shape. Information hierarchy:
 *
 *   B1  Compliance verdict (TOP, most prominent) — passesGating +
 *       triggered disqualifiers with plain rule + SourceRef
 *   B2  Rubric score — estimatedTotal / achievableTotal + per-criterion
 *       breakdown (score, confidence, mechanicalConfidence, claim counts,
 *       weaknesses, missingEvidence)
 *   B3  Routed gaps — grouped by paid SKU with CTAs (Sprint 4's
 *       gap-routing module is the source of truth)
 *   B4  Draft body — one section per criterion with inline provenance
 *       badges on every claim (Sprint 2-5 DraftSection.claims)
 *   B5  Export — through pdfDocs.tsx renderScoredDraftPdf
 *
 * Legacy packages (without `output.score`) render in a fallback path that
 * preserves the existing 8-section ProposalDraftView with an upgrade
 * banner pointing to Sprint 6b lazy-re-run wiring.
 *
 * Per readiness-output-ux.md C4: NO persistent footer disclaimer — the
 * score + flagged gaps + provenance ARE the expectation-setting
 * (proposal-output-ux.md C1). Legal disclaimer lives in T&C only (C3).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { MONO, SERIF, confidenceTone, skuTone } from "@/lib/brand/tokens";

// ============================================================================
// Adapted shapes — the page reads from output.score / output.draft etc.
// (stored as JSONB unknown in types.ts); these are the page-side typed
// projections. Kept narrow: only the fields B1-B5 actually render.
// ============================================================================

type Confidence = "evidenced" | "inferred" | "gap" | "unverified";
type ServiceSku = "bid_no_bid" | "matching" | "proposal_draft" | "roster";
type DisqualifierKind = "mandatory_form" | "eligibility" | "format" | "deadline" | "financial";
type ProvenanceKind = "uploaded_document" | "applicant_library" | "inferred" | "gap";

interface SourceRef {
  docId: string;
  section?: string;
  rubricVersion: number;
}

interface Disqualifier {
  id: string;
  kind: DisqualifierKind;
  rule: string;
  source: SourceRef;
}

interface CriterionAssessment {
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

interface LotScoreResult {
  lotId: string;
  perCriterion: CriterionAssessment[];
  estimatedTotal: number;
  lotDisqualifiersTriggered: Disqualifier[];
  passesGating: boolean;
}

interface ScoreResult {
  rubricVersion: number;
  lotResults: LotScoreResult[];
  noticeWideDisqualifiersTriggered: Disqualifier[];
  routedGaps: RoutedGap[];
}

interface RoutedGap {
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

interface Provenance {
  kind: ProvenanceKind;
  sourceRef?: SourceRef;
  note?: string;
}

interface Claim {
  text: string;
  provenance: Provenance;
}

interface DraftSection {
  lotId?: string;
  criterionId: string;
  content: string;
  claims: Claim[];
}

interface RevisionAttemptSummary {
  attempt: number;
  estimatedTotal: number;
  achievableTotal: number;
  passesGating: boolean;
  triggeredDisqualifierIds: string[];
  weakCriteriaIds: string[];
}

interface ScoredView {
  score: ScoreResult;
  draft: DraftSection[];
  revisionHistory: RevisionAttemptSummary[];
  rubricLabels: Map<string, string>; // criterionId → label (from tender_rubric)
}

// ============================================================================
// Legacy shape (preserved for fallback render)
// ============================================================================

interface LegacyComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
  priority?: "mandatory" | "recommended";
  evidence_label?: "evidence_from_library" | "user_claim" | "inference" | "gap";
}

interface LegacyGateState {
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

interface LegacySourceQuality {
  status: "ready" | "needs_review" | "blocked";
  score_0_10: number;
  missing_inputs?: string[];
  warnings?: string[];
}

interface LegacyAgencyReadiness {
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

interface ProposalOutputJSON {
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

interface ProposalPackage {
  id: number;
  plan: string;
  tender_title: string | null;
  agency: string | null;
  output: ProposalOutputJSON;
  created_at: string;
  generation_status?: string | null;
  error_message?: string | null;
  pdf_url?: string | null;
}

type Stage = "loading" | "generating" | "ready" | "error";

// ============================================================================
// Runtime adapter — pull the scored view out of output JSON (or null)
// ============================================================================

function adaptScored(output: ProposalOutputJSON): ScoredView | null {
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

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

// ============================================================================
// Shared building blocks (preserved brand idiom)
// ============================================================================

function Section({
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

function ComplianceVerdict({ score }: { score: ScoreResult }) {
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

function RubricScore({ score, rubricLabels }: { score: ScoreResult; rubricLabels: Map<string, string> }) {
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

function RoutedGaps({ score }: { score: ScoreResult }) {
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

function DraftBody({ draft, rubricLabels }: { draft: DraftSection[]; rubricLabels: Map<string, string> }) {
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

function ExportRow({
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

// ============================================================================
// Legacy-package fallback (preserved)
// ============================================================================

function LegacyView({ output }: { output: ProposalOutputJSON }) {
  return (
    <div className="space-y-5">
      <div className="mb-2 rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-4">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800"
          style={{ fontFamily: MONO }}
        >
          Previous-format proposal
        </div>
        <p className="mt-1.5 text-[13px] text-stone-700 leading-relaxed">
          This package was generated under the previous format. The scored-draft format adds:
          compliance verdict with source-cited disqualifiers, per-criterion rubric scoring with
          provenance, and routed action gaps that map every weakness to the TenderPath service
          that closes it.
        </p>
        <button
          disabled
          className="mt-3 rounded-sm bg-stone-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 cursor-not-allowed"
          style={{ fontFamily: MONO }}
          title="Sprint 6b will wire the generator switch and lazy re-run"
        >
          Upgrade to scored draft (Sprint 6b)
        </button>
      </div>

      <Section index="01" title="Executive summary">
        {output.executive_summary ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-800">{output.executive_summary}</p>
        ) : (
          <p className="text-[13px] text-stone-400 italic">Not generated.</p>
        )}
      </Section>
      <Section index="02" title="Technical approach">
        {output.technical_approach?.length ? (
          <div className="space-y-3.5">
            {output.technical_approach.map((p, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-stone-800">{p}</p>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-stone-400 italic">Not generated.</p>
        )}
      </Section>
      <Section index="03" title="Compliance checklist">
        {output.compliance_checklist?.length ? (
          <ul className="space-y-2.5">
            {output.compliance_checklist.map((item, i) => {
              const row = typeof item === "string" ? { requirement: item } : item;
              return <li key={i} className="text-[13.5px] leading-relaxed text-stone-700">· {row.requirement}</li>;
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-stone-400 italic">None.</p>
        )}
      </Section>
      <Section index="04" title="Missing information">
        {output.missing_information?.length ? (
          <ul className="space-y-2.5">
            {output.missing_information.map((m, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-amber-800">⚠ {m}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-stone-400 italic">None identified.</p>
        )}
      </Section>
      <Section index="05" title="Next steps">
        {output.next_steps?.length ? (
          <ol className="space-y-2.5 list-decimal pl-5">
            {output.next_steps.map((s, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-stone-700">{s}</li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-stone-400 italic">None.</p>
        )}
      </Section>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function ProposalPackagePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workOrderId = params.workOrderId as string;
  const sessionId = searchParams.get("session_id");
  const fixtureName = searchParams.get("fixture"); // Sprint 6 dev-only

  const [stage, setStage] = useState<Stage>("loading");
  const [pkg, setPkg] = useState<ProposalPackage | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setStage("generating");
    try {
      const res = await fetch("/api/proposals/generate", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          work_order_id: Number(workOrderId),
          stripe_session_id: sessionId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        package?: ProposalPackage;
        error?: string;
      };
      if (!res.ok || !data.package) {
        setErrorMsg(
          res.status === 402
            ? "Your payment is still being verified — try again in a moment."
            : data.error ?? "Generation failed.",
        );
        setStage("error");
        return;
      }
      setPkg(data.package);
      setStage("ready");
    } catch {
      setErrorMsg("Could not connect to the generation service.");
      setStage("error");
    }
  }, [workOrderId, sessionId]);

  useEffect(() => {
    if (!workOrderId) return;

    // Sprint 6 dev-only fixture loader. Loads a typed fixture JSON via
    // a server route, bypasses auth + DB. NEVER active in production.
    if (fixtureName) {
      (async () => {
        try {
          const res = await fetch(`/api/dev/fixture/${encodeURIComponent(fixtureName)}`);
          if (!res.ok) {
            setErrorMsg(`Fixture "${fixtureName}" not available.`);
            setStage("error");
            return;
          }
          const fixturePkg = (await res.json()) as ProposalPackage;
          setPkg(fixturePkg);
          setStage("ready");
        } catch {
          setErrorMsg("Fixture load failed.");
          setStage("error");
        }
      })();
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/api/proposals/generate?work_order_id=${workOrderId}`, {
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = (await res.json()) as { exists: boolean; package?: ProposalPackage };
          if (data.exists && data.package) {
            setPkg(data.package);
            setStage("ready");
            return;
          }
        }
        await generate();
      } catch {
        await generate();
      }
    })();
  }, [workOrderId, fixtureName, generate]);

  const scored = useMemo(() => (pkg ? adaptScored(pkg.output) : null), [pkg]);
  const isProposal = !pkg || pkg.plan !== "roster-fast-track";
  const title = isProposal ? "Proposal package" : "Roster / LTA package";
  const subtitle = pkg?.tender_title
    ? [pkg.tender_title, pkg.agency].filter(Boolean).join(" · ")
    : null;

  if (stage === "loading" || stage === "generating") {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <div className="mb-7">
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Workbench · Proposal output
          </div>
          <h1
            className="mt-1 text-[40px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-[13px] text-stone-500">{subtitle}</p>}
        </div>
        <div className="rounded-md border border-stone-200/70 bg-white p-10 text-center">
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
          <p className="text-[14px] font-medium text-stone-900">
            {stage === "generating" ? "Generating your scored draft — this takes about a minute…" : "Loading…"}
          </p>
          <p className="mt-1 text-[12px] text-stone-500">
            Scoring against the tender&apos;s rubric, flagging compliance gates, routing every gap to its closest paid action.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <h1
          className="text-[40px] leading-[1.05] font-medium text-stone-900 tracking-tight mb-6"
          style={{ fontFamily: SERIF }}
        >
          {title}
        </h1>
        <div className="rounded-md border-l-2 border-red-600 bg-red-50/40 p-6">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700 mb-2"
            style={{ fontFamily: MONO }}
          >
            Generation failed
          </div>
          <p className="text-[13.5px] text-red-900 leading-relaxed">{errorMsg}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={generate}
              className="rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800"
            >
              Retry
            </button>
            <a
              href="mailto:info@tenderpath.me?subject=Proposal package error"
              className="rounded-sm border border-stone-300 px-4 py-2.5 text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!pkg) return null;

  return (
    <div className="px-8 py-8 max-w-4xl">
      <Link
        href={fixtureName ? "/dashboard" : "/dashboard/pipeline"}
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
        style={{ fontFamily: MONO }}
      >
        ← {fixtureName ? "Dashboard" : "Pipeline"}
      </Link>

      <div className="mt-5 mb-7">
        <div className="flex items-center gap-3 text-[11px] text-stone-500">
          <span
            className="font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Workbench · Proposal output
          </span>
          <span className="text-stone-300">·</span>
          <span style={{ fontFamily: MONO }}>
            Generated{" "}
            {new Date(pkg.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          {fixtureName && (
            <>
              <span className="text-stone-300">·</span>
              <span
                className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-amber-900"
                style={{ fontFamily: MONO }}
              >
                fixture · {fixtureName}
              </span>
            </>
          )}
        </div>
        <h1
          className="mt-1 text-[44px] leading-[1.05] font-medium text-stone-900 tracking-tight"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[14.5px] text-stone-600 leading-relaxed">{subtitle}</p>
        )}
      </div>

      {/* B1 → B2 → B3 → B4 → B5  (when the new scoring-engine fields are present) */}
      {scored ? (
        <>
          <ComplianceVerdict score={scored.score} />
          <div className="space-y-5">
            <RubricScore score={scored.score} rubricLabels={scored.rubricLabels} />
            <RoutedGaps score={scored.score} />
            <DraftBody draft={scored.draft} rubricLabels={scored.rubricLabels} />
            <ExportRow
              workOrderId={workOrderId}
              pdfUrl={pkg.pdf_url ?? null}
              revisionHistory={scored.revisionHistory}
            />
          </div>
        </>
      ) : (
        <LegacyView output={pkg.output} />
      )}
      {/*
       * NOTE: Per proposal-output-ux.md C4 the persistent footer disclaimer
       * was REMOVED in Sprint 6. The compliance-verdict (B1) + the
       * provenance-tagged claims (B4) + the per-criterion confidence (B2)
       * do the expectation-setting that a standing "we don't guarantee
       * outcomes" banner used to do, more credibly. Legal disclaimer
       * lives in T&C (C3) only.
       */}
    </div>
  );
}
