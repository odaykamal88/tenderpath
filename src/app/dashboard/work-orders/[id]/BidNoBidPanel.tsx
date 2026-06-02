"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveSubmissionPortal, assessRegistrationTiming } from "@/lib/tenders/submission-portals";

type EvidenceLabel = "evidence" | "inference" | "gap" | "unverified";
type DocumentPriority = "mandatory" | "recommended";
type TenderType = "RFQ" | "ITB" | "RFP" | "EOI" | "EOI-RFP" | "LTA" | "unknown";
type EligibilityAction =
  | "ok"
  | "bring_jv_partner"
  | "subcontract"
  | "supplier_authorization"
  | "no_bid"
  | "verify";

interface BidGap {
  gap: string;
  severity: "high" | "medium" | "low";
  fix: string;
  evidence_label?: EvidenceLabel;
}

interface BidRequirement {
  document: string;
  why_needed: string;
  estimated_effort_hours: number | null;
  priority?: DocumentPriority;
}

interface CommercialTerms {
  payment_terms: string | null;
  performance_bond_pct: number | null;
  bid_security_pct: number | null;
  advance_payment_pct: number | null;
  retention_pct: number | null;
  bid_validity_days: number | null;
  completion_period: string | null;
  currency: string | null;
  notes: string[];
}

interface BidEligibilityFinding {
  requirement: string;
  status: "met" | "gap" | "unverified";
  recommended_action: EligibilityAction;
  rationale: string;
  evidence_label: EvidenceLabel;
}

interface IngestedDocument {
  file_name: string;
  doc_class: string;
  purpose: "tender_main" | "supporting" | "fetched_url";
  char_count: number;
  source: "vault" | "extraction_by_url" | "fetched_url";
}

type ProjectedBand = "A" | "B" | "C" | "D";

interface ProjectedScoreCriterion {
  name: string;
  max_points: number;
  projected_points: number;
  rationale: string;
  confidence: "high" | "medium" | "low";
}

interface ProjectedScore {
  rubric_source: "stated_in_tender" | "inferred_from_text" | "absent";
  total_points_possible: number | null;
  total_points_projected: number | null;
  band: ProjectedBand | null;
  band_label: string | null;
  criteria: ProjectedScoreCriterion[];
  caveat: string | null;
}

interface BidOutput {
  recommendation: "bid" | "no-bid" | "conditional";
  win_probability_band: string;
  headline: string;
  fit_reasoning: string[];
  gap_analysis: BidGap[];
  required_documents: BidRequirement[];
  effort_estimate_hours: number;
  red_flags: string[];
  conditions_for_bid: string[];
  next_steps: string[];
  evidence: {
    tender_excerpt: string;
    company_capabilities_matched: string[];
    company_capabilities_missing: string[];
  };
  /* Sprint 8.2 additions — all optional for backwards-compatible reads. */
  tender_type?: TenderType;
  tender_type_note?: string | null;
  commercial_terms?: CommercialTerms;
  eligibility_findings?: BidEligibilityFinding[];
  /* PR-F additions — both optional for backwards-compatible JSONB reads. */
  applicant_documents_cited?: string[];
  documents_ingested?: IngestedDocument[];

  /* PR-G additions — projected score table. */
  projected_score?: ProjectedScore;

  /* PR-H additions — deterministic user-facing meta-score. */
  analysis_grade?: AnalysisGrade;
}

type SelfGradeBand = "excellent" | "strong" | "competent" | "thin" | "weak";

interface AnalysisGrade {
  score_0_100: number;
  band: SelfGradeBand;
  band_label: string;
  dimensions: {
    grounding: { score_0_20: number; rationale: string };
    evidence_quality: { score_0_20: number; rationale: string };
    rubric_match: { score_0_20: number; rationale: string };
    actionability: { score_0_20: number; rationale: string };
    completeness: { score_0_20: number; rationale: string };
  };
  callouts: string[];
}

const GRADE_BAND_STYLES: Record<SelfGradeBand, { ring: string; text: string; chip: string; bar: string }> = {
  excellent: { ring: "ring-emerald-500", text: "text-emerald-700", chip: "bg-emerald-700", bar: "bg-emerald-600" },
  strong:    { ring: "ring-stone-700",   text: "text-stone-800",   chip: "bg-stone-800",   bar: "bg-stone-700" },
  competent: { ring: "ring-amber-500",   text: "text-amber-700",   chip: "bg-amber-600",   bar: "bg-amber-500" },
  thin:      { ring: "ring-orange-500",  text: "text-orange-700",  chip: "bg-orange-600",  bar: "bg-orange-500" },
  weak:      { ring: "ring-red-500",     text: "text-red-700",     chip: "bg-red-700",     bar: "bg-red-600" },
};

const DIMENSION_LABEL: Record<keyof AnalysisGrade["dimensions"], string> = {
  grounding: "Grounding",
  evidence_quality: "Evidence quality",
  rubric_match: "Rubric match",
  actionability: "Actionability",
  completeness: "Completeness",
};

const BAND_STYLES: Record<ProjectedBand, { bar: string; chip: string; ring: string }> = {
  A: { bar: "bg-emerald-600", chip: "bg-emerald-700 text-white", ring: "ring-emerald-200" },
  B: { bar: "bg-stone-700", chip: "bg-stone-800 text-white", ring: "ring-stone-200" },
  C: { bar: "bg-amber-500", chip: "bg-amber-600 text-white", ring: "ring-amber-200" },
  D: { bar: "bg-red-600", chip: "bg-red-700 text-white", ring: "ring-red-200" },
};

const CONFIDENCE_LABEL: Record<ProjectedScoreCriterion["confidence"], string> = {
  high: "High confidence",
  medium: "Medium",
  low: "Low — verify",
};

const DOC_CLASS_LABEL: Record<string, string> = {
  tor: "Terms of Reference",
  eligibility_criteria: "Eligibility criteria",
  evaluation_criteria: "Evaluation criteria",
  capability_statement: "Capability statement",
  cv: "CV",
  compliance: "Compliance / cert",
  financial: "Financial",
  reference_letter: "Reference letter",
  other: "Document",
};

const TENDER_TYPE_LABEL: Record<TenderType, string> = {
  RFQ: "RFQ",
  ITB: "ITB",
  RFP: "RFP",
  EOI: "EOI",
  "EOI-RFP": "EOI → RFP",
  LTA: "LTA",
  unknown: "Unknown",
};

const ELIGIBILITY_ACTION_LABEL: Record<EligibilityAction, string> = {
  ok: "OK",
  bring_jv_partner: "Bring a JV partner",
  subcontract: "Subcontract",
  supplier_authorization: "Get supplier authorization",
  no_bid: "Do not bid",
  verify: "Verify",
};

const EVIDENCE_LABEL_TEXT: Record<EvidenceLabel, string> = {
  evidence: "Evidence",
  inference: "Inference",
  gap: "Gap",
  unverified: "Unverified",
};

function evidenceClasses(label: EvidenceLabel | undefined): string {
  switch (label) {
    case "evidence":
      return "border-emerald-600 text-emerald-700";
    case "gap":
      return "border-red-600 text-red-700";
    case "unverified":
      return "border-amber-600 text-amber-700";
    case "inference":
    default:
      return "border-stone-400 text-stone-500";
  }
}

function eligibilityStatusClasses(status: BidEligibilityFinding["status"]): string {
  if (status === "met") return "bg-emerald-700 text-white";
  if (status === "gap") return "bg-red-700 text-white";
  return "bg-amber-600 text-white";
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-stone-500 mb-0.5" style={{ fontFamily: MONO }}>
        {label}
      </div>
      <div className="text-[13px] font-semibold text-stone-900">{value}</div>
    </div>
  );
}

function hasCommercialTerms(t: CommercialTerms | undefined): boolean {
  if (!t) return false;
  return (
    t.payment_terms != null ||
    t.performance_bond_pct != null ||
    t.bid_security_pct != null ||
    t.advance_payment_pct != null ||
    t.retention_pct != null ||
    t.bid_validity_days != null ||
    t.completion_period != null ||
    t.currency != null ||
    (t.notes?.length ?? 0) > 0
  );
}

interface PackageRow {
  id: number;
  output: BidOutput | null;
  pdf_url: string | null;
  generation_status: string | null;
  generation_attempts: number | null;
  error_message: string | null;
  created_at: string;
}

interface ApiResponse {
  exists: boolean;
  package?: PackageRow;
  payment_status: string | null;
  max_attempts: number;
  remaining_regenerations?: number;
}

interface BidNoBidPanelProps {
  workOrderId: number;
  paymentStatus: string | null;
  /** Buying agency (drives the supplier-portal registration block). */
  agency?: string | null;
  /** Tender deadline ISO string (drives the registration deadline-risk flag). */
  tenderDeadline?: string | null;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";
const POLL_MS = 8000;
const MAX_POLLS = 40;

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function recBg(rec: BidOutput["recommendation"]): string {
  if (rec === "bid") return "bg-emerald-700";
  if (rec === "no-bid") return "bg-red-700";
  return "bg-amber-600";
}

function recBorder(rec: BidOutput["recommendation"]): string {
  if (rec === "bid") return "border-emerald-700";
  if (rec === "no-bid") return "border-red-700";
  return "border-amber-600";
}

function sevTint(sev: BidGap["severity"]): string {
  if (sev === "high") return "text-red-700";
  if (sev === "medium") return "text-amber-700";
  return "text-stone-500";
}

export default function BidNoBidPanel({ workOrderId, paymentStatus, agency, tenderDeadline }: BidNoBidPanelProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenBusy, setRegenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/bid-no-bid`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const msg = res.status === 404 ? null : `${res.status} ${res.statusText}`;
        if (msg) setError(msg);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as ApiResponse;
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analysis.");
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  // Initial load + poll while waiting for the generator.
  useEffect(() => {
    fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    if (!data) return;
    if (data.exists && data.package?.generation_status === "ready") return;
    if (paymentStatus !== "paid") return;
    if (pollCount >= MAX_POLLS) return;

    const t = setTimeout(() => {
      setPollCount((n) => n + 1);
      fetchOnce();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [data, fetchOnce, paymentStatus, pollCount]);

  const handleRegenerate = useCallback(async () => {
    setRegenBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/bid-no-bid?force=1`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `${res.status} ${res.statusText}`);
      }
      await fetchOnce();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regenerate failed.");
    } finally {
      setRegenBusy(false);
    }
  }, [workOrderId, fetchOnce]);

  if (loading) {
    return (
      <section className="rounded-md border border-stone-200/70 bg-white p-5 text-[13px] text-stone-500" style={{ fontFamily: MONO }}>
        Loading bid analysis…
      </section>
    );
  }

  if (paymentStatus !== "paid") {
    return (
      <section className="rounded-md border-l-2 border-stone-300 bg-stone-50/60 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Bid analysis
        </h2>
        <p className="mt-2 text-[13px] text-stone-600">
          Your Bid/No-Bid analysis will be generated automatically as soon as payment is confirmed. No ops review required.
        </p>
      </section>
    );
  }

  const pkg = data?.package;
  const isGenerating =
    !pkg ||
    pkg.generation_status === "pending" ||
    (pkg.generation_status === "ready" && !pkg.output);

  // PR-I (2026-05-23): if payment landed but no package row exists yet AND
  // we've been polling for ≥4 cycles (~32 s) the auto-generation never
  // scheduled — usually because the fulfillment gate flipped to human_review
  // and the webhook short-circuited. Offer the user a manual "Start analysis"
  // button so they're not stuck staring at a forever-spinner.
  const generationLikelyStalled = !pkg && pollCount >= 4;
  if (generationLikelyStalled) {
    return (
      <section className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Ready to start your analysis
        </h2>
        <p className="mt-2 text-[13px] text-stone-700">
          Payment is confirmed. Auto-fulfillment didn&apos;t kick off — start the analysis manually and we&apos;ll email the PDF when it&apos;s ready (usually 2–5 minutes).
        </p>
        {error && (
          <p className="mt-2 text-[12px] text-red-700">Last error: {error}</p>
        )}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenBusy}
          className="mt-3 rounded-sm bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {regenBusy ? "Starting…" : "Start analysis →"}
        </button>
      </section>
    );
  }

  if (!pkg || (isGenerating && pkg?.generation_status !== "failed")) {
    return (
      <section className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Generating your analysis…
        </h2>
        <p className="mt-2 text-[13px] text-stone-700">
          We&rsquo;re running the Bid/No-Bid pipeline against your company profile. This usually completes in 2–5 minutes. You don&rsquo;t need to wait here — we&rsquo;ll email you the PDF when it&rsquo;s ready.
        </p>
        {error && (
          <p className="mt-2 text-[12px] text-red-700">Last error: {error}</p>
        )}
      </section>
    );
  }

  if (pkg.generation_status === "failed" || !pkg.output) {
    return (
      <section className="rounded-md border-l-2 border-red-600 bg-red-50/40 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Generation hit a snag
        </h2>
        <p className="mt-2 text-[13px] text-red-800">
          {pkg.error_message ?? "We couldn’t finish the analysis on the last attempt."}
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenBusy || (data?.remaining_regenerations ?? 0) <= 0}
          className="mt-3 rounded-sm bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {regenBusy ? "Retrying…" : "Retry generation →"}
        </button>
      </section>
    );
  }

  const out = pkg.output;
  const remaining = data?.remaining_regenerations ?? 0;
  const tenderTypeLabel = out.tender_type ? TENDER_TYPE_LABEL[out.tender_type] : null;
  const eligibilityFindings = out.eligibility_findings ?? [];
  const showCommercialTerms = hasCommercialTerms(out.commercial_terms);

  return (
    <section className={`rounded-md border-l-2 ${recBorder(out.recommendation)} bg-white shadow-sm`}>
      <div className="p-5 border-b border-stone-100">
        <div className="flex items-baseline justify-between mb-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
                Bid analysis
            </h2>
            {tenderTypeLabel && tenderTypeLabel !== "Unknown" && (
              <span
                className="inline-block rounded-sm border border-blue-700/40 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-800"
                style={{ fontFamily: MONO }}
              >
                {tenderTypeLabel}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {pkg.pdf_url && (
              <a
                href={pkg.pdf_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm border border-stone-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
                style={{ fontFamily: MONO }}
              >
                Download PDF ↓
              </a>
            )}
            {/* PR-N (2026-05-23): export-to-proposal upsell. POSTs to
                /api/dashboard/work-orders/{id}/export-to-proposal which
                spawns a fresh proposal-draft work order pre-populated
                with this bid/no-bid's intake + a snapshot of the memo,
                then redirects the client to Stripe checkout. */}
            <ExportToProposalButton workOrderId={workOrderId} />
          </div>
        </div>
        {out.tender_type_note && (
          <p className="mb-3 text-[12px] text-stone-600 leading-snug">{out.tender_type_note}</p>
        )}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-6">
          <span
            className={`${recBg(out.recommendation)} text-white inline-block self-start px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] rounded-sm`}
            style={{ fontFamily: MONO }}
          >
            {out.recommendation}
          </span>
          <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500" style={{ fontFamily: MONO }}>
            Win probability · {out.win_probability_band}
          </p>
          <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500" style={{ fontFamily: MONO }}>
            Effort · {out.effort_estimate_hours} hrs
          </p>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-stone-800" style={{ fontFamily: SERIF }}>
          {out.headline}
        </p>
      </div>

      {/* PR-H: self-grade meta-score. Anchors the top of the analysis so
          the user sees the quality signal before reading anything else.
          Deterministic — computed server-side from the output structure,
          no LLM judge. Hidden when missing for backwards-compat with
          analyses produced before this PR. */}
      {out.analysis_grade && (() => {
        const g = out.analysis_grade;
        const styles = GRADE_BAND_STYLES[g.band];
        const dimensionEntries = Object.entries(g.dimensions) as Array<
          [keyof AnalysisGrade["dimensions"], { score_0_20: number; rationale: string }]
        >;
        return (
          <div className="border-b border-stone-200/70 px-5 py-5 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div>
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-1"
                  style={{ fontFamily: MONO }}
                >
                  Analysis quality · self-graded
                </div>
                <p className={`text-[13px] ${styles.text} font-medium`}>{g.band_label}</p>
              </div>
              <div className={`flex items-baseline gap-2 px-4 py-2 rounded-sm ring-2 ${styles.ring} ring-inset bg-white`}>
                <span
                  className="text-[32px] font-medium tabular-nums leading-none text-stone-900"
                  style={{ fontFamily: SERIF }}
                >
                  {g.score_0_100}
                </span>
                <span
                  className="text-[12px] tabular-nums text-stone-500"
                  style={{ fontFamily: MONO }}
                >
                  / 100
                </span>
              </div>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
              {dimensionEntries.map(([key, dim]) => {
                const widthPct = Math.round((dim.score_0_20 / 20) * 100);
                return (
                  <li key={key}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500"
                        style={{ fontFamily: MONO }}
                      >
                        {DIMENSION_LABEL[key]}
                      </span>
                      <span
                        className="text-[11px] tabular-nums text-stone-700 whitespace-nowrap"
                        style={{ fontFamily: MONO }}
                      >
                        {dim.score_0_20}/20
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
                      <div
                        className={`h-full ${styles.bar} transition-all`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-stone-600">{dim.rationale}</p>
                  </li>
                );
              })}
            </ul>
            {g.callouts.length > 0 && (
              <div className="rounded-sm border-l-2 border-stone-700 bg-stone-50/60 px-3 py-2">
                <div
                  className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-stone-500 mb-1"
                  style={{ fontFamily: MONO }}
                >
                  How to lift the score
                </div>
                <ul className="text-[12px] leading-snug text-stone-700 space-y-1">
                  {g.callouts.map((c, i) => (
                    <li key={i}>· {c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })()}

      {/* PR-G: projected score table. Renders only when the tender publishes
          a rubric (rubric_source !== "absent"). Per-criterion projection
          anchored in the uploaded documents + company profile. */}
      {out.projected_score && out.projected_score.rubric_source !== "absent" && out.projected_score.criteria.length > 0 && (() => {
        const ps = out.projected_score!;
        const band = ps.band ?? "C";
        const styles = BAND_STYLES[band];
        const pct = ps.total_points_possible && ps.total_points_projected != null
          ? Math.round((ps.total_points_projected / ps.total_points_possible) * 100)
          : null;
        return (
          <div className="border-b border-stone-200/70 px-5 py-5 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
              <div className="flex items-baseline gap-3">
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                  style={{ fontFamily: MONO }}
                >
                  Projected score
                </span>
                <span
                  className={`${styles.chip} inline-flex items-center gap-1.5 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] rounded-sm`}
                  style={{ fontFamily: MONO }}
                >
                  Band {band} · {ps.band_label}
                </span>
              </div>
              {ps.total_points_possible != null && ps.total_points_projected != null && (
                <div
                  className="text-[12px] tabular-nums text-stone-700"
                  style={{ fontFamily: MONO }}
                >
                  <span className="text-[20px] font-medium text-stone-900">{ps.total_points_projected}</span>
                  <span className="text-stone-400"> / {ps.total_points_possible}</span>
                  {pct != null && <span className="ml-2 text-stone-500">({pct}%)</span>}
                </div>
              )}
            </div>
            <ul className="space-y-3">
              {ps.criteria.map((c, i) => {
                const cPct = c.max_points > 0 ? Math.round((c.projected_points / c.max_points) * 100) : 0;
                return (
                  <li key={`${c.name}-${i}`} className="grid grid-cols-1 gap-1.5 lg:grid-cols-[1fr_auto]">
                    <div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-medium text-stone-900">{c.name}</span>
                        <span
                          className="text-[11px] tabular-nums text-stone-600 whitespace-nowrap"
                          style={{ fontFamily: MONO }}
                        >
                          {c.projected_points} / {c.max_points}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
                        <div
                          className={`h-full ${styles.bar} transition-all`}
                          style={{ width: `${cPct}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[12px] leading-snug text-stone-600">{c.rationale}</p>
                    </div>
                    <span
                      className="self-start text-[10px] uppercase tracking-[0.14em] text-stone-400 lg:pt-0.5"
                      style={{ fontFamily: MONO }}
                      title={CONFIDENCE_LABEL[c.confidence]}
                    >
                      {c.confidence}
                    </span>
                  </li>
                );
              })}
            </ul>
            {ps.caveat && (
              <p className="mt-4 rounded-sm border-l-2 border-amber-500 bg-amber-50/40 px-3 py-2 text-[11.5px] leading-snug text-amber-900">
                {ps.caveat}
              </p>
            )}
          </div>
        );
      })()}

      {/* PR-F: documents the analysis was grounded in. Surfacing this is
          the wow moment — the user sees that their uploaded CV, capability
          statement, and TOR were actually read and cited. */}
      {(out.documents_ingested?.length ?? 0) > 0 && (
        <div className="border-b border-stone-200/70 px-5 py-4 bg-stone-50/40">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Grounded in · {out.documents_ingested!.length} document{out.documents_ingested!.length === 1 ? "" : "s"}
            </div>
            {(out.applicant_documents_cited?.length ?? 0) > 0 && (
              <div
                className="text-[10px] uppercase tracking-[0.14em] text-emerald-700"
                style={{ fontFamily: MONO }}
              >
                {out.applicant_documents_cited!.length} cited in analysis
              </div>
            )}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {out.documents_ingested!.map((doc, i) => {
              const cited = out.applicant_documents_cited?.includes(doc.file_name) ?? false;
              const label = DOC_CLASS_LABEL[doc.doc_class] ?? "Document";
              return (
                <li
                  key={`${doc.file_name}-${i}`}
                  className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] ${
                    cited
                      ? "border-emerald-300 bg-emerald-50/60 text-emerald-800"
                      : "border-stone-300 bg-white text-stone-600"
                  }`}
                  style={{ fontFamily: MONO }}
                  title={`${doc.purpose} · ${doc.char_count.toLocaleString()} chars · source: ${doc.source}`}
                >
                  {cited && (
                    <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                  )}
                  <span className="font-semibold">{label}</span>
                  <span className="opacity-70 truncate max-w-[200px]">· {doc.file_name}</span>
                </li>
              );
            })}
          </ul>
          {(out.applicant_documents_cited?.length ?? 0) === 0 && (
            <p className="mt-2 text-[11px] text-stone-500 leading-snug">
              These files were read but the analysis didn&apos;t explicitly cite any of them. Re-running with sharper documents (TOR + capability statement + CV) tends to produce stronger grounded reasoning.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
        {out.fit_reasoning.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
              Why this matches
            </div>
            <ul className="space-y-1.5 text-[13px] text-stone-800 leading-snug">
              {out.fit_reasoning.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-amber-700 shrink-0">·</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {out.gap_analysis.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
              Gaps to close
            </div>
            <ul className="space-y-2 text-[13px] text-stone-800">
              {out.gap_analysis.map((g, i) => (
                <li key={i}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`text-[9px] uppercase tracking-[0.16em] font-semibold ${sevTint(g.severity)}`} style={{ fontFamily: MONO }}>
                      {g.severity}
                    </span>
                    {g.evidence_label && (
                      <span
                        className={`inline-block rounded-sm border px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-[0.14em] ${evidenceClasses(g.evidence_label)}`}
                        style={{ fontFamily: MONO }}
                      >
                        {EVIDENCE_LABEL_TEXT[g.evidence_label]}
                      </span>
                    )}
                    <span className="font-semibold leading-snug">{g.gap}</span>
                  </div>
                  <p className="ml-12 text-[12px] text-stone-600 leading-relaxed">{g.fix}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {eligibilityFindings.length > 0 && (
        <div className="border-t border-stone-100 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-3" style={{ fontFamily: MONO }}>
            Eligibility findings
          </div>
          <ul className="space-y-3 text-[13px] text-stone-800">
            {eligibilityFindings.map((f, i) => {
              // PR-N (2026-05-23): chip dedup. User reported confusion on
              // findings rendering BOTH a status header (GAP / UNVERIFIED /
              // MET) AND a secondary evidence-label chip with the same
              // word (GAP / UNVERIFIED). Cause: status and evidence_label
              // are different model fields that often agree.
              //
              // Rules:
              //  - Hide the evidence chip when it duplicates the status
              //    word (case-insensitive equality on the status string).
              //  - Hide the action chip when action is "ok" AND status
              //    is "met" — both saying "everything's fine" reads as
              //    redundant noise.
              const statusWord = String(f.status).toLowerCase();
              const evidenceWord = String(f.evidence_label).toLowerCase();
              const showEvidenceChip = evidenceWord !== statusWord;
              const showActionChip = !(
                f.recommended_action === "ok" && f.status === "met"
              );
              return (
                <li key={i} className="leading-snug">
                  <div className="flex items-baseline gap-2 flex-wrap mb-1">
                    <span
                      className={`inline-block rounded-sm px-1.5 py-[1px] text-[8.5px] font-semibold uppercase tracking-[0.14em] ${eligibilityStatusClasses(f.status)}`}
                      style={{ fontFamily: MONO }}
                    >
                      {f.status}
                    </span>
                    <span className="font-semibold">{f.requirement}</span>
                  </div>
                  {(showActionChip || showEvidenceChip) && (
                    <div className="ml-0 flex items-center gap-2 flex-wrap text-[11px] mb-1">
                      {showActionChip && (
                        <span
                          className="inline-block rounded-sm border border-amber-600/60 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-800"
                          style={{ fontFamily: MONO }}
                        >
                          {ELIGIBILITY_ACTION_LABEL[f.recommended_action]}
                        </span>
                      )}
                      {showEvidenceChip && (
                        <span
                          className={`inline-block rounded-sm border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.14em] ${evidenceClasses(f.evidence_label)}`}
                          style={{ fontFamily: MONO }}
                        >
                          {EVIDENCE_LABEL_TEXT[f.evidence_label]}
                        </span>
                      )}
                    </div>
                  )}
                  {f.rationale && (
                    <p className="text-[12px] text-stone-600 leading-relaxed">{f.rationale}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showCommercialTerms && out.commercial_terms && (
        <div className="border-t border-stone-100 bg-blue-50/30 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-800 mb-2" style={{ fontFamily: MONO }}>
            Commercial terms
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] text-stone-800 sm:grid-cols-4">
            {out.commercial_terms.payment_terms && (
              <Term label="Payment terms" value={out.commercial_terms.payment_terms} />
            )}
            {out.commercial_terms.performance_bond_pct != null && (
              <Term label="Perf. bond" value={`${out.commercial_terms.performance_bond_pct}%`} />
            )}
            {out.commercial_terms.bid_security_pct != null && (
              <Term label="Bid security" value={`${out.commercial_terms.bid_security_pct}%`} />
            )}
            {out.commercial_terms.advance_payment_pct != null && (
              <Term label="Advance" value={`${out.commercial_terms.advance_payment_pct}%`} />
            )}
            {out.commercial_terms.retention_pct != null && (
              <Term label="Retention" value={`${out.commercial_terms.retention_pct}%`} />
            )}
            {out.commercial_terms.bid_validity_days != null && (
              <Term label="Bid validity" value={`${out.commercial_terms.bid_validity_days}d`} />
            )}
            {out.commercial_terms.completion_period && (
              <Term label="Completion" value={out.commercial_terms.completion_period} />
            )}
            {out.commercial_terms.currency && (
              <Term label="Currency" value={out.commercial_terms.currency} />
            )}
          </div>
          {out.commercial_terms.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12px] text-stone-600 leading-relaxed">
              {out.commercial_terms.notes.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {out.red_flags.length > 0 && (
        <div className="border-t border-stone-100 bg-red-50/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700 mb-1.5" style={{ fontFamily: MONO }}>
            Red flags
          </div>
          <ul className="text-[12.5px] text-red-800 leading-relaxed space-y-1">
            {out.red_flags.map((f, i) => (
              <li key={i}>· {f}</li>
            ))}
          </ul>
        </div>
      )}

      {out.recommendation === "conditional" && out.conditions_for_bid.length > 0 && (
        <div className="border-t border-stone-100 bg-amber-50/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 mb-1.5" style={{ fontFamily: MONO }}>
            Conditions to convert to a bid
          </div>
          <ul className="text-[12.5px] text-amber-900 leading-relaxed space-y-1">
            {out.conditions_for_bid.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Deterministic "how to actually submit" block — keyed off the buying
          agency, independent of the LLM output. Surfaces the supplier-portal
          registration the bidder must complete first, with a deadline-risk
          flag. Renders client-side post-fetch, so the Date.now() in
          assessRegistrationTiming is safe (no SSR/hydration concern). */}
      <RegistrationBlock agency={agency} deadline={tenderDeadline} />

      {out.next_steps.length > 0 && (
        <div className="border-t border-stone-100 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
            Next steps
          </div>
          <ol className="text-[13px] text-stone-800 space-y-1.5">
            {out.next_steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-amber-700 tabular-nums shrink-0" style={{ fontFamily: MONO }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="border-t border-stone-100 p-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
          Generation {pkg.generation_attempts ?? 1} · {remaining} regenerate{remaining === 1 ? "" : "s"} left
        </p>
        {error && <p className="text-[11.5px] text-red-700">{error}</p>}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenBusy || remaining <= 0}
          className="rounded-sm border border-stone-300 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {regenBusy ? "Regenerating…" : remaining <= 0 ? "Regenerate limit reached" : "Regenerate analysis →"}
        </button>
      </div>
    </section>
  );
}

// PR-N (2026-05-23): one-click upsell from a delivered bid/no-bid memo
// into a paid proposal-draft work order. POSTs to the server, which
// spawns a fresh work_orders row pre-populated with this bid/no-bid's
// intake + a memo snapshot, then we redirect to Stripe checkout via
// the returned payHref. Server-side endpoint at
// /api/dashboard/work-orders/[id]/export-to-proposal.
function ExportToProposalButton({ workOrderId }: { workOrderId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/work-orders/${workOrderId}/export-to-proposal`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        payHref?: string;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.payHref) {
        setError(body.error ?? `${res.status} ${res.statusText}`);
        return;
      }
      router.push(body.payHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export to proposal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-sm bg-stone-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ fontFamily: MONO }}
        title="Spin this into a proposal draft — fresh checkout, pre-loaded with this analysis"
      >
        {busy ? "Spinning up…" : "Use for proposal →"}
      </button>
      {error && (
        <p
          className="text-[10px] text-red-700 text-right max-w-[200px]"
          style={{ fontFamily: MONO }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// Deterministic supplier-portal registration block. Resolves the portal from
// the buying agency (UNGM and other aggregators only advertise — the bid is
// submitted on the agency's own portal, which needs a one-time registration
// with real lead time). Always renders, including the honest generic fallback
// for agencies without a verified mapping, so a paying user always gets a
// "how to actually submit" answer.
function RegistrationBlock({
  agency,
  deadline,
}: {
  agency?: string | null;
  deadline?: string | null;
}) {
  const portal = resolveSubmissionPortal(agency);
  const timing = assessRegistrationTiming(deadline, portal);
  const risk = timing.firstTimeRisk;

  const riskStyles =
    risk === "very-tight"
      ? { border: "border-red-600", bg: "bg-red-50/40", text: "text-red-800", label: "text-red-700" }
      : risk === "tight"
        ? { border: "border-amber-600", bg: "bg-amber-50/40", text: "text-amber-900", label: "text-amber-700" }
        : { border: "border-stone-300", bg: "bg-stone-50/40", text: "text-stone-700", label: "text-stone-500" };

  const days = timing.daysUntilDeadline;
  const deadlinePhrase =
    days != null && days >= 0 ? `Deadline in ${days} day${days === 1 ? "" : "s"}. ` : "";

  return (
    <div className="border-t border-stone-100 p-5">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2"
        style={{ fontFamily: MONO }}
      >
        Before you can submit · registration
      </div>
      <div className={`rounded-sm border-l-2 ${riskStyles.border} ${riskStyles.bg} px-4 py-3`}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-[14px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
            {portal.portalName}
          </div>
          <div
            className={`text-[10px] uppercase tracking-[0.14em] ${riskStyles.label}`}
            style={{ fontFamily: MONO }}
          >
            {portal.leadTimeLabel}
          </div>
        </div>

        {risk !== "none" && (
          <p className={`mt-2 text-[12.5px] font-semibold leading-snug ${riskStyles.text}`}>
            ⚑ {deadlinePhrase}
            {risk === "very-tight"
              ? "First-time registration likely can't complete in time. Contact the procurement focal point about an extension — and register anyway so you're ready for the next call."
              : "Start registration immediately — first-time approval can eat most of the time you have left."}
          </p>
        )}

        <ol className="mt-3 space-y-1.5 text-[13px] text-stone-800">
          {portal.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="text-amber-700 tabular-nums shrink-0" style={{ fontFamily: MONO }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={portal.registrationUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm bg-stone-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Register →
          </a>
          {portal.signInUrl && portal.signInUrl !== portal.registrationUrl && (
            <a
              href={portal.signInUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-stone-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
              style={{ fontFamily: MONO }}
            >
              Sign in
            </a>
          )}
          {portal.guideUrl && (
            <a
              href={portal.guideUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 hover:text-stone-900 underline underline-offset-2"
              style={{ fontFamily: MONO }}
            >
              Official guide ↗
            </a>
          )}
          {portal.alsoRegisterUngm && (
            <span className="text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
              · also register free on UNGM for a vendor ID + alerts
            </span>
          )}
        </div>

        <p className="mt-2.5 text-[11.5px] leading-snug text-stone-500">{portal.note}</p>
      </div>
    </div>
  );
}
