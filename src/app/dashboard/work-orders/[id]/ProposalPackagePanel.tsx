"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MONO as MONO_BRAND, SERIF as SERIF_BRAND } from "@/lib/brand/tokens";
import { gapSeverity, SEVERITY_META, type GapSeverity } from "@/app/dashboard/proposals/[workOrderId]/scored-view";

interface ComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
}

// Sprint 6: minimal scored-shape adapter (full types live in the standalone
// page; the panel only needs a handful of fields to render the slim view).
type ServiceSku = "bid_no_bid" | "matching" | "proposal_draft" | "roster";
type DisqualifierKind = "mandatory_form" | "eligibility" | "format" | "deadline" | "financial";
interface ScoredCriterion {
  criterionId: string;
  estimatedScore: number;
  maxScore: number;
}
interface ScoredLot {
  lotId: string;
  perCriterion: ScoredCriterion[];
  estimatedTotal: number;
  lotDisqualifiersTriggered: Array<{ id: string; rule: string; kind: DisqualifierKind }>;
  passesGating: boolean;
}
interface ScoredRoute {
  text: string;
  routedTo: ServiceSku;
  rationale: string;
  ctaCopy: string;
  // Narrowed to match the engine's RoutedGap.kind union so gapSeverity()
  // accepts ScoredRoute via structural typing.
  kind: "weakness" | "missing_evidence" | "disqualifier" | "claim_gap";
}
interface ScoredView {
  lotResults: ScoredLot[];
  noticeWideDisqualifiersTriggered: Array<{ id: string; rule: string; kind: DisqualifierKind }>;
  routedGaps: ScoredRoute[];
}

interface ProposalOutput {
  executive_summary: string;
  technical_approach: string[];
  compliance_checklist: ComplianceItem[];
  required_documents: string[];
  cover_letter_draft: string;
  financial_template_notes: string[];
  missing_information: string[];
  next_steps: string[];
  // Sprint 6 new shape (optional — panel falls back to compliance_checklist
  // counts when absent).
  score?: unknown;
}

interface PackageRow {
  id: number;
  output: ProposalOutput | null;
  pdf_url: string | null;
  generation_status: string | null;
  generation_attempts: number | null;
  error_message: string | null;
  created_at: string;
}

// Sprint 13. Optional payload fields surface the per-user rate-limit
// headroom and which supplementary docs (corrigendum + Q&A) the engine
// actually read for this work order. Both are optional so the UI degrades
// gracefully when an older API response (pre-Sprint-13) is in flight.
interface RateLimitQuotaPayload {
  limit: number;
  window_hours: number;
  remaining: number;
  used: number;
  next_allowed_at: string | null;
}

interface SupplementaryDocsPayload {
  amendment_loaded: boolean;
  qa_loaded: boolean;
  count: number;
}

interface ApiResponse {
  exists: boolean;
  package?: PackageRow;
  payment_status: string | null;
  max_attempts: number;
  remaining_regenerations?: number;
  quota?: RateLimitQuotaPayload | null;
  supplementary_docs?: SupplementaryDocsPayload | null;
}

// Sprint 13. Pretty-printer for the supplementary-doc badge. Returns null
// when neither doc was loaded (panel renders nothing); otherwise a short
// human-readable phrase like "Engine read 1 corrigendum + 1 Q&A round".
function formatSupplementaryDocsLine(s: SupplementaryDocsPayload | null | undefined): string | null {
  if (!s || s.count === 0) return null;
  const parts: string[] = [];
  if (s.amendment_loaded) parts.push("1 corrigendum");
  if (s.qa_loaded) parts.push("1 Q&A round");
  if (parts.length === 0) return null;
  return `Engine read ${parts.join(" + ")} against the original TOR.`;
}

// Sprint 13. Pretty-printer for the rate-limit usage line near the Re-run
// button. Returns null when quota is missing or fully refreshed; otherwise
// "X / 10 re-runs used today — N left".
function formatQuotaLine(q: RateLimitQuotaPayload | null | undefined): string | null {
  if (!q) return null;
  if (q.used <= 0) return null; // unused quota — no need to nag the user
  if (q.remaining > 0) {
    return `${q.used} / ${q.limit} re-runs used in the last ${q.window_hours}h — ${q.remaining} left.`;
  }
  const reset = q.next_allowed_at ? ` Next slot at ${new Date(q.next_allowed_at).toLocaleString()}.` : "";
  return `${q.used} / ${q.limit} re-runs used in the last ${q.window_hours}h.${reset}`;
}

interface Props {
  workOrderId: number;
  paymentStatus: string | null;
}

// Sprint 6: brand tokens lifted into src/lib/brand/tokens.ts. The local
// MONO/SERIF aliases keep existing JSX references stable while the
// import canonicalizes the source.
const MONO = MONO_BRAND;
const SERIF = SERIF_BRAND;
const POLL_MS = 8000;
const MAX_POLLS = 40;

function adaptScoredFromOutput(output: ProposalOutput): ScoredView | null {
  if (!output.score || typeof output.score !== "object") return null;
  const s = output.score as ScoredView;
  if (!Array.isArray(s.lotResults) || !Array.isArray(s.routedGaps)) return null;
  return s;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export default function ProposalPackagePanel({ workOrderId, paymentStatus }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenBusy, setRegenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/proposal-package`, {
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
      setError(err instanceof Error ? err.message : "Could not load proposal package.");
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

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
      const res = await fetch(
        `/api/dashboard/work-orders/${workOrderId}/proposal-package?force=1`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
        },
      );
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
        Loading proposal package…
      </section>
    );
  }

  if (paymentStatus !== "paid") {
    return (
      <section className="rounded-md border-l-2 border-stone-300 bg-stone-50/60 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Proposal package
        </h2>
        <p className="mt-2 text-[13px] text-stone-600">
          Your 80%-complete proposal package — technical proposal (.docx), cover letter (.docx), financial template (.xlsx), and compliance matrix (.pdf) — will be generated automatically as soon as payment is confirmed. No ops review.
        </p>
      </section>
    );
  }

  const pkg = data?.package;
  const isGenerating =
    !pkg ||
    pkg.generation_status === "pending" ||
    (pkg.generation_status === "ready" && !pkg.output);

  if (!pkg || (isGenerating && pkg?.generation_status !== "failed")) {
    return (
      <section className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Drafting your proposal…
        </h2>
        <p className="mt-2 text-[13px] text-stone-700">
          We&rsquo;re extracting the tender requirements and drafting your technical proposal, cover letter, compliance matrix, and pre-wired financial template. This usually takes 5–15 minutes. You don&rsquo;t need to wait — we&rsquo;ll email you when the ZIP bundle is ready.
        </p>
        {error && <p className="mt-2 text-[12px] text-red-700">Last error: {error}</p>}
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
          {pkg.error_message ?? "We couldn’t finish drafting the proposal on the last attempt."}
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          // Sprint 6b: the proposal-draft plan has unlimited re-runs against
          // this tender. The button is enabled unless a request is in flight
          // OR the API explicitly returned a finite remaining counter (which
          // only happens once we add the per-day rate-limit gate).
          disabled={regenBusy || (data?.remaining_regenerations != null && data.remaining_regenerations <= 0)}
          className="mt-3 rounded-sm bg-stone-900 px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {regenBusy ? "Retrying…" : "Retry generation →"}
        </button>
      </section>
    );
  }

  const out = pkg.output;
  // Sprint 6b: `null` is the API signal for "unlimited" (PROPOSAL_MAX_ATTEMPTS
  // = Infinity). Old callers still send a number; treat undefined as 0 so the
  // legacy guard keeps working.
  const remaining = data?.remaining_regenerations;
  const isUnlimited = remaining == null;
  const scored = adaptScoredFromOutput(out);

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 6: when the new scored shape is present, render the slim view
  // (B1 verdict + score headline + top routed gaps + link to full page).
  // Falls back to legacy compliance-checklist counts when absent.
  // ─────────────────────────────────────────────────────────────────────
  if (scored) {
    const passes = scored.lotResults.every((lr) => lr.passesGating);
    const estimatedTotal = scored.lotResults.reduce((s, lr) => s + lr.estimatedTotal, 0);
    const achievableTotal = scored.lotResults.reduce(
      (s, lr) => s + lr.perCriterion.reduce((ss, c) => ss + c.maxScore, 0),
      0,
    );
    const pct = achievableTotal > 0 ? Math.round((estimatedTotal / achievableTotal) * 100) : 0;
    const triggeredCount =
      scored.noticeWideDisqualifiersTriggered.length +
      scored.lotResults.reduce((s, lr) => s + lr.lotDisqualifiersTriggered.length, 0);

    // Sprint 6: the WO tile summarises gaps by APPLICANT ACTION TYPE
    // (severity), not by paid SKU. The user already owns the $299
    // package — the tile orients them to "what's left to ship" and
    // links through to the full proposal page for the actual work.
    const bySeverity = new Map<GapSeverity, number>();
    for (const g of scored.routedGaps) {
      const sev = gapSeverity(g);
      bySeverity.set(sev, (bySeverity.get(sev) ?? 0) + 1);
    }
    const severityOrder: GapSeverity[] = ["block", "evidence", "narrative"];
    const severityCounts = severityOrder
      .filter((s) => (bySeverity.get(s) ?? 0) > 0)
      .map((s) => ({ severity: s, count: bySeverity.get(s)! }));

    return (
      <section className={`rounded-md border-l-2 ${passes ? "border-emerald-700" : "border-red-700"} bg-white shadow-sm`}>
        <div className="p-5 border-b border-stone-100">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
            <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
              Proposal package
            </h2>
            <Link
              href={`/dashboard/proposals/${workOrderId}`}
              className="rounded-sm bg-stone-900 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors"
              style={{ fontFamily: MONO }}
            >
              View full proposal →
            </Link>
          </div>
          {/* B1 verdict — compact */}
          <div className="flex items-baseline gap-3 flex-wrap mb-3">
            <span
              className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                passes
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-red-300 bg-red-50 text-red-800"
              }`}
              style={{ fontFamily: MONO }}
            >
              {passes ? "Passes gating" : "Fails gating"}
            </span>
            {triggeredCount > 0 && (
              <span className="text-[11.5px] text-red-800" style={{ fontFamily: MONO }}>
                {triggeredCount} disqualifier{triggeredCount === 1 ? "" : "s"} triggered
              </span>
            )}
            <span className="text-stone-300">·</span>
            <span className="text-[16px] font-medium tabular-nums text-stone-900" style={{ fontFamily: SERIF }}>
              {estimatedTotal.toFixed(0)}
              <span className="text-[12px] text-stone-500" style={{ fontFamily: MONO }}>
                {" "}
                / {achievableTotal} · {pct}%
              </span>
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-stone-600">
            Compliance verdict, per-criterion rubric scoring, and applicant-action findings for every weakness. Full breakdown and draft body on the proposal page.
          </p>
          {/* Sprint 13. Surface the supplementary docs the engine considered so
              the user can see corrigendum/Q&A binding wasn't skipped — the
              AGENTS.md "why this matters / why it matches" rule. Renders
              nothing when no amendment/qa was uploaded. */}
          {formatSupplementaryDocsLine(data?.supplementary_docs) && (
            <p
              className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-amber-200 bg-amber-50/60 px-2.5 py-1 text-[11px] text-amber-900"
              style={{ fontFamily: MONO }}
            >
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.93 4.588l-.25 6.5h-1.36l-.25-6.5h1.86zM7 13a1 1 0 1 1 2 0 1 1 0 0 1-2 0z" />
              </svg>
              {formatSupplementaryDocsLine(data?.supplementary_docs)}
            </p>
          )}
        </div>

        {severityCounts.length > 0 && (
          <div className="border-t border-stone-100 p-5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-3"
              style={{ fontFamily: MONO }}
            >
              {scored.routedGaps.length} finding{scored.routedGaps.length === 1 ? "" : "s"} to address
            </div>
            <div className="flex flex-wrap gap-2">
              {severityCounts.map(({ severity, count }) => {
                const meta = SEVERITY_META[severity];
                return (
                  <div
                    key={severity}
                    className={`rounded-sm border ${meta.border} ${meta.bg} px-2.5 py-1.5 flex items-baseline gap-1.5`}
                  >
                    <span
                      className={`text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white rounded-sm px-1.5 py-0.5 ${meta.badge}`}
                      style={{ fontFamily: MONO }}
                    >
                      {meta.label}
                    </span>
                    <span
                      className={`text-[13px] font-medium tabular-nums ${meta.tw}`}
                      style={{ fontFamily: MONO }}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11.5px] text-stone-500 leading-relaxed" style={{ fontFamily: MONO }}>
              Address gaps in the draft + upload evidence on the proposal page, then re-run. Unlimited re-runs against this tender are included.
            </p>
          </div>
        )}

        <div className="border-t border-stone-100 p-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
              {isUnlimited
                ? `Generation ${pkg.generation_attempts ?? 1} · unlimited re-runs included`
                : `Generation ${pkg.generation_attempts ?? 1} · ${remaining} regenerate${remaining === 1 ? "" : "s"} left`}
            </p>
            {/* Sprint 13. Per-user 10/24h rate-limit usage. Only renders when
                the user has actually consumed at least one re-run today —
                otherwise it would be cap-shaming an unused account. */}
            {formatQuotaLine(data?.quota) && (
              <p
                className="text-[10.5px] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                {formatQuotaLine(data?.quota)}
              </p>
            )}
          </div>
          {error && <p className="text-[11.5px] text-red-700">{error}</p>}
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenBusy || (!isUnlimited && (remaining ?? 0) <= 0) || (data?.quota != null && data.quota.remaining <= 0)}
            className="rounded-sm border border-stone-300 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: MONO }}
          >
            {regenBusy
              ? "Regenerating…"
              : (data?.quota != null && data.quota.remaining <= 0)
                ? "Daily re-run limit reached"
                : (!isUnlimited && (remaining ?? 0) <= 0)
                  ? "Regenerate limit reached"
                  : "Regenerate →"}
          </button>
        </div>
      </section>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Legacy panel render (pre-Sprint-6 ProposalOutput shape) — preserved
  // verbatim so existing customers see the same view they always have.
  // Sprint 6b will switch the generator so new orders land in `scored`
  // above; legacy rows continue to render here until they're regenerated.
  // ─────────────────────────────────────────────────────────────────────
  const compliant = out.compliance_checklist.filter((c) => c.status === "compliant").length;
  const partial = out.compliance_checklist.filter((c) => c.status === "partial").length;
  const gapsCount = out.compliance_checklist.filter((c) => c.status === "needs_action").length;

  return (
    <section className="rounded-md border-l-2 border-emerald-700 bg-white shadow-sm">
      <div className="p-5 border-b border-stone-100">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
            Proposal package
          </h2>
          <div className="flex items-baseline gap-2">
            <Link
              href={`/dashboard/proposals/${workOrderId}`}
              className="rounded-sm border border-stone-300 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
              style={{ fontFamily: MONO }}
            >
              View full proposal →
            </Link>
            {pkg.pdf_url && (
              <a
                href={pkg.pdf_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm bg-stone-900 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors"
                style={{ fontFamily: MONO }}
              >
                Download bundle (.zip) ↓
              </a>
            )}
          </div>
        </div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500" style={{ fontFamily: MONO }}>
          Compliance · {compliant} compliant · {partial} partial · {gapsCount} gap{gapsCount === 1 ? "" : "s"}
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-stone-800" style={{ fontFamily: SERIF }}>
          {out.executive_summary}
        </p>
      </div>

      {out.missing_information.length > 0 && (
        <div className="border-t border-stone-100 bg-amber-50/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 mb-1.5" style={{ fontFamily: MONO }}>
            We need this from you to finish
          </div>
          <ul className="text-[12.5px] text-amber-900 leading-relaxed space-y-1">
            {out.missing_information.map((m, i) => (
              <li key={i}>· {m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-stone-100 p-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
            {isUnlimited
              ? `Generation ${pkg.generation_attempts ?? 1} · unlimited re-runs included`
              : `Generation ${pkg.generation_attempts ?? 1} · ${remaining} regenerate${remaining === 1 ? "" : "s"} left`}
          </p>
          {/* Sprint 13 (legacy panel parity): mirror the same quota line the
              scored panel renders, so the rate-limit headroom is visible on
              both old and new package shapes. */}
          {formatQuotaLine(data?.quota) && (
            <p className="text-[10.5px] text-stone-400" style={{ fontFamily: MONO }}>
              {formatQuotaLine(data?.quota)}
            </p>
          )}
        </div>
        {error && <p className="text-[11.5px] text-red-700">{error}</p>}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenBusy || (!isUnlimited && (remaining ?? 0) <= 0) || (data?.quota != null && data.quota.remaining <= 0)}
          className="rounded-sm border border-stone-300 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {regenBusy
            ? "Regenerating…"
            : (data?.quota != null && data.quota.remaining <= 0)
              ? "Daily re-run limit reached"
              : (!isUnlimited && (remaining ?? 0) <= 0)
                ? "Regenerate limit reached"
                : "Regenerate package →"}
        </button>
      </div>
    </section>
  );
}
