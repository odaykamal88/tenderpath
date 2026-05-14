"use client";

import { useCallback, useEffect, useState } from "react";
import ArtifactGenerationNotice from "./ArtifactGenerationNotice";

interface BidGap {
  gap: string;
  severity: "high" | "medium" | "low";
  fix: string;
}

interface BidRequirement {
  document: string;
  why_needed: string;
  estimated_effort_hours: number | null;
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

export default function BidNoBidPanel({ workOrderId, paymentStatus }: BidNoBidPanelProps) {
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
          We couldn&rsquo;t finish the analysis on the last attempt. Retry generation; if it keeps failing, support can review the logged error.
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
  const fileGenerationFailed = !pkg.pdf_url && Boolean(pkg.error_message);

  return (
    <section className={`rounded-md border-l-2 ${recBorder(out.recommendation)} bg-white shadow-sm`}>
      <div className="p-5 border-b border-stone-100">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
              Bid analysis
          </h2>
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
        </div>
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

      {fileGenerationFailed && (
        <ArtifactGenerationNotice
          artifactLabel="the Bid/No-Bid PDF"
          busy={regenBusy}
          remainingRegenerations={remaining}
          retryLabel="Retry PDF →"
          onRetry={handleRegenerate}
        />
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
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[9px] uppercase tracking-[0.16em] font-semibold ${sevTint(g.severity)}`} style={{ fontFamily: MONO }}>
                      {g.severity}
                    </span>
                    <span className="font-semibold leading-snug">{g.gap}</span>
                  </div>
                  <p className="ml-12 text-[12px] text-stone-600 leading-relaxed">{g.fix}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

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
