"use client";

import { useCallback, useEffect, useState } from "react";

interface ComplianceItem {
  requirement: string;
  status: "compliant" | "partial" | "needs_action";
  evidence_or_action: string;
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

interface ApiResponse {
  exists: boolean;
  package?: PackageRow;
  payment_status: string | null;
  max_attempts: number;
  remaining_regenerations?: number;
}

interface Props {
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

function statusTint(status: ComplianceItem["status"]): string {
  if (status === "compliant") return "text-emerald-700";
  if (status === "partial") return "text-amber-700";
  return "text-red-700";
}

function statusLabel(status: ComplianceItem["status"]): string {
  if (status === "compliant") return "compliant";
  if (status === "partial") return "partial";
  return "needs action";
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
          <span className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle" style={{ fontFamily: MONO }}>04 ·</span>
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
          <span className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle" style={{ fontFamily: MONO }}>04 ·</span>
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
          <span className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle" style={{ fontFamily: MONO }}>04 ·</span>
          Generation hit a snag
        </h2>
        <p className="mt-2 text-[13px] text-red-800">
          {pkg.error_message ?? "We couldn’t finish drafting the proposal on the last attempt."}
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
  const compliant = out.compliance_checklist.filter((c) => c.status === "compliant").length;
  const partial = out.compliance_checklist.filter((c) => c.status === "partial").length;
  const gaps = out.compliance_checklist.filter((c) => c.status === "needs_action").length;

  return (
    <section className="rounded-md border-l-2 border-emerald-700 bg-white shadow-sm">
      <div className="p-5 border-b border-stone-100">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
            <span className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle" style={{ fontFamily: MONO }}>04 ·</span>
            Proposal package
          </h2>
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
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-6">
          <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500" style={{ fontFamily: MONO }}>
            Compliance · {compliant} compliant · {partial} partial · {gaps} gap{gaps === 1 ? "" : "s"}
          </p>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-stone-800" style={{ fontFamily: SERIF }}>
          {out.executive_summary}
        </p>
      </div>

      <div className="p-5 border-b border-stone-100">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
          Bundle contents
        </div>
        <ul className="grid grid-cols-1 gap-1.5 text-[13px] text-stone-800 lg:grid-cols-2">
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Technical proposal</span> <span className="text-stone-500">(.docx — editable in Word)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Cover letter</span> <span className="text-stone-500">(.docx — editable)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Financial template</span> <span className="text-stone-500">(.xlsx — formulas pre-wired)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Compliance matrix</span> <span className="text-stone-500">(.pdf — requirement-by-requirement)</span></span></li>
        </ul>
      </div>

      {out.compliance_checklist.length > 0 && (
        <div className="border-t border-stone-100 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
            Compliance snapshot
          </div>
          <ul className="space-y-2 text-[13px] text-stone-800">
            {out.compliance_checklist.slice(0, 8).map((c, i) => (
              <li key={i}>
                <div className="flex items-baseline gap-2">
                  <span className={`text-[9px] uppercase tracking-[0.16em] font-semibold ${statusTint(c.status)}`} style={{ fontFamily: MONO }}>
                    {statusLabel(c.status)}
                  </span>
                  <span className="font-semibold leading-snug">{c.requirement}</span>
                </div>
                <p className="ml-[88px] text-[12px] text-stone-600 leading-relaxed">{c.evidence_or_action}</p>
              </li>
            ))}
          </ul>
          {out.compliance_checklist.length > 8 && (
            <p className="mt-3 text-[11.5px] text-stone-500">
              + {out.compliance_checklist.length - 8} more requirements in the full compliance matrix PDF.
            </p>
          )}
        </div>
      )}

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

      {out.next_steps.length > 0 && (
        <div className="border-t border-stone-100 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
            Next steps
          </div>
          <ol className="text-[13px] text-stone-800 space-y-1.5">
            {out.next_steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-emerald-700 tabular-nums shrink-0" style={{ fontFamily: MONO }}>
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
          {regenBusy ? "Regenerating…" : remaining <= 0 ? "Regenerate limit reached" : "Regenerate package →"}
        </button>
      </div>
    </section>
  );
}
