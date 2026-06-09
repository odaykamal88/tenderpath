"use client";

import { useCallback, useEffect, useState } from "react";

interface DocumentRenameRule {
  document_type: string;
  required_filename: string;
  note: string | null;
}

interface AgencyReadiness {
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
  /** Sprint 14. Optional. Per-agency readiness leaderboard. Legacy
   *  packages without this field hide the breakdown section cleanly. */
  agency_readiness_breakdown?: AgencyReadiness[];
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
      <section className="rounded-md border border-rule/70 bg-white p-5 text-[13px] text-ink-3" style={{ fontFamily: MONO }}>
        Loading roster workspace…
      </section>
    );
  }

  if (paymentStatus !== "paid") {
    return (
      <section className="rounded-md border-l-2 border-rule bg-paper-3/60 p-5">
        <h2 className="text-[20px] font-medium text-ink" style={{ fontFamily: SERIF }}>
          Roster workspace
        </h2>
        <p className="mt-2 text-[13px] text-ink-2">
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
        <h2 className="text-[20px] font-medium text-ink" style={{ fontFamily: SERIF }}>
          Pick your target agency
        </h2>
        <p className="mt-2 text-[13px] text-ink-2">
          We didn&rsquo;t see a target agency on your intake form — choose one below and we&rsquo;ll prepare the registration package tailored to that agency&rsquo;s portal and document requirements.
        </p>
        <div className="mt-4 space-y-3">
          {data?.available_agencies.map((agency) => (
            <label
              key={agency.slug}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3.5 transition-colors ${
                agencyChoice === agency.slug
                  ? "border-ink bg-paper-3"
                  : "border-rule hover:border-rule"
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
                <div className="text-[14px] font-semibold text-ink" style={{ fontFamily: SERIF }}>
                  {agency.label}
                </div>
                <p className="mt-1 text-[12.5px] text-ink-2 leading-relaxed">{agency.why}</p>
              </div>
            </label>
          ))}
        </div>
        {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
        <button
          type="button"
          onClick={handlePickAgency}
          disabled={agencyBusy || !agencyChoice}
          className="mt-4 rounded-sm bg-ink px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <h2 className="text-[20px] font-medium text-ink" style={{ fontFamily: SERIF }}>
          Preparing your {selectedAgency.label} package…
        </h2>
        <p className="mt-2 text-[13px] text-ink-2">
          We&rsquo;re drafting your capability statement, cover letter, and step-by-step submission instructions for {selectedAgency.portalLabel}. This usually takes 5–15 minutes. We&rsquo;ll email you when the bundle is ready.
        </p>
        {error && <p className="mt-2 text-[12px] text-red-700">Last error: {error}</p>}
      </section>
    );
  }

  if (pkg.generation_status === "failed" || !pkg.output) {
    return (
      <section className="rounded-md border-l-2 border-red-600 bg-red-50/40 p-5">
        <h2 className="text-[20px] font-medium text-ink" style={{ fontFamily: SERIF }}>
          Generation hit a snag
        </h2>
        <p className="mt-2 text-[13px] text-red-800">
          {pkg.error_message ?? "We couldn’t finish your roster package on the last attempt."}
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenBusy || (data?.remaining_regenerations ?? 0) <= 0}
          className="mt-3 rounded-sm bg-ink px-3.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="p-5 border-b border-rule">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-baseline lg:justify-between">
          <h2 className="text-[20px] font-medium text-ink" style={{ fontFamily: SERIF }}>
              {selectedAgency.label} roster package
          </h2>
          <div className="flex flex-wrap gap-2">
            {pkg.pdf_url && (
              <a
                href={pkg.pdf_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm bg-ink px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-ink transition-colors"
                style={{ fontFamily: MONO }}
              >
                Download bundle (.zip) ↓
              </a>
            )}
            <a
              href={selectedAgency.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-rule px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-2 hover:border-ink hover:text-ink transition-colors"
              style={{ fontFamily: MONO }}
            >
              Open portal ↗
            </a>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-2" style={{ fontFamily: MONO }}>
          Portal · {selectedAgency.portalLabel}
        </p>
      </div>

      <AgencyReadinessSection breakdown={out.agency_readiness_breakdown} />

      <div className="p-5 border-b border-rule">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute mb-2" style={{ fontFamily: MONO }}>
          Bundle contents
        </div>
        <ul className="grid grid-cols-1 gap-1.5 text-[13px] text-ink lg:grid-cols-2">
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Capability statement</span> <span className="text-ink-3">(.docx — editable)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Cover letter</span> <span className="text-ink-3">(.docx — editable)</span></span></li>
          <li className="flex gap-2"><span className="text-emerald-700 shrink-0">·</span><span><span className="font-semibold">Submission instructions</span> <span className="text-ink-3">(.pdf — step-by-step + filename rules)</span></span></li>
        </ul>
      </div>

      {out.registration_checklist.length > 0 && (
        <div className="border-t border-rule p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute mb-2" style={{ fontFamily: MONO }}>
            Registration checklist
          </div>
          <ol className="text-[13px] text-ink space-y-1.5">
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
        <div className="border-t border-rule p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute mb-2" style={{ fontFamily: MONO }}>
            File-naming rules
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-ink-3" style={{ fontFamily: MONO }}>
                  <th className="pb-1.5 pr-4 font-semibold uppercase tracking-[0.12em] text-[10px]">Document</th>
                  <th className="pb-1.5 pr-4 font-semibold uppercase tracking-[0.12em] text-[10px]">Save as</th>
                  <th className="pb-1.5 font-semibold uppercase tracking-[0.12em] text-[10px]">Note</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {out.document_renaming_rules.map((r, i) => (
                  <tr key={i} className="border-t border-rule">
                    <td className="py-1.5 pr-4 align-top">{r.document_type}</td>
                    <td className="py-1.5 pr-4 align-top font-mono text-[12px] text-ink" style={{ fontFamily: MONO }}>
                      {r.required_filename}
                    </td>
                    <td className="py-1.5 align-top text-ink-2">{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {out.missing_information.length > 0 && (
        <div className="border-t border-rule bg-amber-50/40 p-5">
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
        <div className="border-t border-rule p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute mb-2" style={{ fontFamily: MONO }}>
            Next steps
          </div>
          <ol className="text-[13px] text-ink space-y-1.5">
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
        <div className="border-t border-rule bg-emerald-50/60 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700" style={{ fontFamily: MONO }}>
            ✓ Submitted
          </div>
          <p className="mt-1 text-[13px] text-emerald-900">
            You marked this registration as submitted. We&rsquo;ve recorded the milestone — reply to your roster-ready email if you need a follow-up review or run into a portal issue.
          </p>
        </div>
      ) : (
        <div className="border-t border-rule bg-paper-3/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3 mb-1.5" style={{ fontFamily: MONO }}>
            Once you&rsquo;ve submitted to {selectedAgency.label}
          </div>
          <p className="text-[12.5px] text-ink-2 leading-relaxed mb-3">
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

      <div className="border-t border-rule p-5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-[11px] text-ink-3" style={{ fontFamily: MONO }}>
          Generation {pkg.generation_attempts ?? 1} · {remaining} regenerate{remaining === 1 ? "" : "s"} left
        </p>
        {error && <p className="text-[11.5px] text-red-700">{error}</p>}
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenBusy || remaining <= 0}
          className="rounded-sm border border-rule px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-ink-2 hover:border-ink hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          {regenBusy ? "Regenerating…" : remaining <= 0 ? "Regenerate limit reached" : "Regenerate package →"}
        </button>
      </div>
    </section>
  );
}

/**
 * Sprint 14. Per-agency readiness leaderboard. Renders the breakdown
 * as a sorted list of agency cards, with the highest-readiness
 * "start_here" agency surfaced prominently in emerald, "viable"
 * alternates in neutral stone, and "blocked" agencies collapsed by
 * default in amber with cited blockers. Legacy packages without the
 * field render nothing.
 */
function AgencyReadinessSection({ breakdown }: { breakdown?: AgencyReadiness[] }) {
  if (!breakdown || breakdown.length === 0) return null;
  const startHere = breakdown.find((a) => a.recommendation === "start_here");
  const viable = breakdown.filter((a) => a.recommendation === "viable");
  const blocked = breakdown.filter((a) => a.recommendation === "blocked");

  return (
    <div className="p-5 border-b border-rule">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mute" style={{ fontFamily: MONO }}>
          Agency readiness · where to start
        </div>
        <div className="text-[10.5px] text-ink-3" style={{ fontFamily: MONO }}>
          {breakdown.length} agencies scored
        </div>
      </div>

      {startHere && <AgencyCard agency={startHere} variant="start_here" />}

      {viable.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-3" style={{ fontFamily: MONO }}>
            Also viable
          </div>
          {viable.map((a) => <AgencyCard key={a.agency_slug} agency={a} variant="viable" />)}
        </div>
      )}

      {blocked.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-3" style={{ fontFamily: MONO }}>
            Skip for now
          </div>
          {blocked.map((a) => <AgencyCard key={a.agency_slug} agency={a} variant="blocked" />)}
        </div>
      )}
    </div>
  );
}

function AgencyCard({ agency, variant }: { agency: AgencyReadiness; variant: "start_here" | "viable" | "blocked" }) {
  const tone = variant === "start_here"
    ? { border: "border-emerald-300", bg: "bg-emerald-50/70", label: "Start here", labelBg: "bg-emerald-700", score: "text-emerald-900" }
    : variant === "viable"
    ? { border: "border-rule", bg: "bg-white", label: "Viable", labelBg: "bg-ink-2", score: "text-ink" }
    : { border: "border-amber-200", bg: "bg-amber-50/40", label: "Blocked", labelBg: "bg-amber-700", score: "text-amber-900" };

  return (
    <div className={`rounded-sm border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex items-baseline gap-3 mb-1.5 flex-wrap">
        <span className={`text-[14px] font-semibold ${tone.score}`} style={{ fontFamily: MONO }}>
          {agency.agency_label}
        </span>
        <span className={`text-[16px] font-bold tabular-nums ${tone.score}`} style={{ fontFamily: MONO }}>
          {agency.readiness_0_10}<span className="text-[11px] font-normal text-ink-3">/10</span>
        </span>
        <span
          className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-white ${tone.labelBg}`}
          style={{ fontFamily: MONO }}
        >
          {tone.label}
        </span>
        <span className="text-[10.5px] text-ink-3 tabular-nums" style={{ fontFamily: MONO }}>
          docs {agency.document_coverage_0_10}/10 · category {agency.category_fit_0_10}/10 · geo {agency.geographic_fit_0_10}/10
        </span>
      </div>
      <p className="text-[12.5px] text-ink leading-relaxed">{agency.rationale}</p>
      {agency.missing_documents.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 mb-1" style={{ fontFamily: MONO }}>
            Missing
          </div>
          <ul className="text-[12px] text-ink-2 space-y-0.5">
            {agency.missing_documents.map((d, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-mute shrink-0">·</span><span>{d}</span></li>
            ))}
          </ul>
        </div>
      )}
      {variant !== "blocked" && agency.next_actions.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 mb-1" style={{ fontFamily: MONO }}>
            Next actions
          </div>
          <ul className="text-[12px] text-ink space-y-0.5">
            {agency.next_actions.map((a, i) => (
              <li key={i} className="flex gap-1.5"><span className="text-emerald-700 shrink-0">→</span><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
