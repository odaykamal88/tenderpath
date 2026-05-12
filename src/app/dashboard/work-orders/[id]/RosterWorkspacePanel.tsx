"use client";

import { useCallback, useEffect, useState } from "react";

interface DocumentRenameRule {
  document_type: string;
  required_filename: string;
  note: string | null;
}

interface RosterOutput {
  registration_checklist: string[];
  capability_statement_draft: string;
  required_documents: string[];
  organization_profile_notes: string[];
  cover_letter_draft: string;
  submission_guidance: string[];
  document_renaming_rules: DocumentRenameRule[];
  missing_information: string[];
  next_steps: string[];
}

interface PackageRow {
  id: number;
  output: RosterOutput | null;
  pdf_url: string | null;
  generation_status: string | null;
  generation_attempts: number | null;
  error_message: string | null;
  agency: string | null;
  created_at: string;
}

interface AvailableAgency {
  slug: string;
  label: string;
  why: string;
}

interface SelectedAgency {
  slug: string;
  label: string;
  portalUrl: string;
  portalLabel: string;
}

interface ApiResponse {
  exists: boolean;
  package: PackageRow | null;
  payment_status: string | null;
  work_order_status: string;
  max_attempts: number;
  remaining_regenerations: number;
  selected_agency: SelectedAgency | null;
  available_agencies: AvailableAgency[];
}

interface Props {
  workOrderId: number;
  paymentStatus: string | null;
  initialWorkOrderStatus: string;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";
const POLL_MS = 8000;
const MAX_POLLS = 40;

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export default function RosterWorkspacePanel({ workOrderId, paymentStatus, initialWorkOrderStatus }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [agencyBusy, setAgencyBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [agencyChoice, setAgencyChoice] = useState<string>("");
  const [orderStatus, setOrderStatus] = useState<string>(initialWorkOrderStatus);

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/roster-package`, {
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
      setOrderStatus(body.work_order_status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load roster package.");
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
    if (!data.selected_agency) return;
    if (pollCount >= MAX_POLLS) return;

    const t = setTimeout(() => {
      setPollCount((n) => n + 1);
      fetchOnce();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [data, fetchOnce, paymentStatus, pollCount]);

  const handlePickAgency = useCallback(async () => {
    if (!agencyChoice) {
      setError("Pick an agency first.");
      return;
    }
    setAgencyBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/roster-package`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ agency_slug: agencyChoice }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `${res.status} ${res.statusText}`);
      }
      await fetchOnce();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agency selection failed.");
    } finally {
      setAgencyBusy(false);
    }
  }, [agencyChoice, workOrderId, fetchOnce]);

  const handleRegenerate = useCallback(async () => {
    setRegenBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/work-orders/${workOrderId}/roster-package?force=1`,
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

  const handleMarkSubmitted = useCallback(async () => {
    setSubmitBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/roster-package`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action: "mark_submitted" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) {
        setError(body.error ?? `${res.status} ${res.statusText}`);
      } else if (body.status) {
        setOrderStatus(body.status);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark as submitted.");
    } finally {
      setSubmitBusy(false);
    }
  }, [workOrderId]);

  if (loading) {
    return (
      <section className="rounded-md border border-stone-200/70 bg-white p-5 text-[13px] text-stone-500" style={{ fontFamily: MONO }}>
        Loading roster workspace…
      </section>
    );
  }

  if (paymentStatus !== "paid") {
    return (
      <section className="rounded-md border-l-2 border-stone-300 bg-stone-50/60 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Roster workspace
        </h2>
        <p className="mt-2 text-[13px] text-stone-600">
          Your agency-specific roster registration package — capability statement (.docx), cover letter (.docx), and step-by-step submission instructions (.pdf) — will be generated automatically as soon as payment is confirmed.
        </p>
      </section>
    );
  }

  // Agency picker — when nothing chosen yet, let the user pick. Generator will
  // run on the server right after the POST succeeds; the next fetch will
  // surface the running package.
  if (!data?.selected_agency) {
    return (
      <section className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Pick your target agency
        </h2>
        <p className="mt-2 text-[13px] text-stone-700">
          We didn&rsquo;t see a target agency on your intake form — choose one below and we&rsquo;ll prepare the registration package tailored to that agency&rsquo;s portal and document requirements.
        </p>
        <div className="mt-4 space-y-3">
          {data?.available_agencies.map((agency) => (
            <label
              key={agency.slug}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-colors ${
                agencyChoice === agency.slug
                  ? "border-stone-900 bg-stone-50"
                  : "border-stone-200 hover:border-stone-400"
              }`}
            >
              <input
                type="radio"
                name="roster-agency"
                value={agency.slug}
                checked={agencyChoice === agency.slug}
                onChange={(e) => setAgencyChoice(e.target.value)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-stone-900" style={{ fontFamily: SERIF }}>
                  {agency.label}
                </div>
                <p className="mt-1 text-[12.5px] text-stone-600 leading-relaxed">{agency.why}</p>
              </div>
            </label>
          ))}
        </div>
        {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
        <button
          type="button"
          onClick={handlePickAgency}
          disabled={agencyBusy || !agencyChoice}
          className="mt-4 rounded-sm bg-stone-900 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {agencyBusy ? "Starting generation…" : "Generate package →"}
        </button>
      </section>
    );
  }

  const pkg = data?.package;
  const selectedAgency = data.selected_agency;
  const isGenerating =
    !pkg ||
    pkg.generation_status === "pending" ||
    (pkg.generation_status === "ready" && !pkg.output);

  if (!pkg || (isGenerating && pkg?.generation_status !== "failed")) {
    return (
      <section className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-5">
        <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          Preparing your {selectedAgency.label} package…
        </h2>
        <p className="mt-2 text-[13px] text-stone-700">
          We&rsquo;re drafting your capability statement, cover letter, and step-by-step submission instructions for {selectedAgency.portalLabel}. This usually takes 5–15 minutes. We&rsquo;ll email you when the bundle is ready.
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
          {pkg.error_message ?? "We couldn’t finish your roster package on the last attempt."}
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
  const isSubmitted = orderStatus === "submitted";

  return (
    <section className="rounded-md border-l-2 border-emerald-700 bg-white shadow-sm">
      <div className="p-5 border-b border-stone-100">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-baseline lg:justify-between">
          <h2 className="text-[20px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
              {selectedAgency.label} roster package
          </h2>
          <div className="flex flex-wrap gap-2">
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
            <a
              href={selectedAgency.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-stone-300 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
              style={{ fontFamily: MONO }}
            >
              Open portal ↗
            </a>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-stone-600" style={{ fontFamily: MONO }}>
          Portal · {selectedAgency.portalLabel}
        </p>
      </div>

      <div className="p-5 border-b border-stone-100">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
          Bundle contents
        </div>
        <ul className="grid grid-cols-1 gap-1.5 text-[13px] text-stone-800 lg:grid-cols-2">
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Capability statement</span> <span className="text-stone-500">(.docx — editable)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Cover letter</span> <span className="text-stone-500">(.docx — editable)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Submission instructions</span> <span className="text-stone-500">(.pdf — step-by-step + filename rules)</span></span></li>
        </ul>
      </div>

      {out.registration_checklist.length > 0 && (
        <div className="border-t border-stone-100 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
            Registration checklist
          </div>
          <ol className="text-[13px] text-stone-800 space-y-1.5">
            {out.registration_checklist.map((s, i) => (
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

      {out.document_renaming_rules.length > 0 && (
        <div className="border-t border-stone-100 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2" style={{ fontFamily: MONO }}>
            File-naming rules
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-stone-500" style={{ fontFamily: MONO }}>
                  <th className="pb-1.5 pr-4 font-semibold uppercase tracking-[0.12em] text-[10px]">Document</th>
                  <th className="pb-1.5 pr-4 font-semibold uppercase tracking-[0.12em] text-[10px]">Save as</th>
                  <th className="pb-1.5 font-semibold uppercase tracking-[0.12em] text-[10px]">Note</th>
                </tr>
              </thead>
              <tbody className="text-stone-800">
                {out.document_renaming_rules.map((r, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-1.5 pr-4 align-top">{r.document_type}</td>
                    <td className="py-1.5 pr-4 align-top font-mono text-[12px] text-stone-900" style={{ fontFamily: MONO }}>
                      {r.required_filename}
                    </td>
                    <td className="py-1.5 align-top text-stone-600">{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {isSubmitted ? (
        <div className="border-t border-stone-100 bg-emerald-50/60 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700" style={{ fontFamily: MONO }}>
            ✓ Submitted
          </div>
          <p className="mt-1 text-[13px] text-emerald-900">
            You marked this registration as submitted. We&rsquo;ve recorded the milestone — reply to your roster-ready email if you need a follow-up review or run into a portal issue.
          </p>
        </div>
      ) : (
        <div className="border-t border-stone-100 bg-stone-50/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-1.5" style={{ fontFamily: MONO }}>
            Once you&rsquo;ve submitted to {selectedAgency.label}
          </div>
          <p className="text-[12.5px] text-stone-700 leading-relaxed mb-3">
            Hit the button below so we can mark this milestone complete. This is the final founder-out-of-the-loop step.
          </p>
          <button
            type="button"
            onClick={handleMarkSubmitted}
            disabled={submitBusy}
            className="rounded-sm bg-emerald-700 px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: MONO }}
          >
            {submitBusy ? "Recording…" : "Mark as submitted ✓"}
          </button>
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
