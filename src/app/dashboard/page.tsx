"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface MatchReason {
  summary?: string[];
  matchedSectors?: string[];
  matchedCapabilities?: string[];
  matchedKeywords?: string[];
  confidence?: number;
  caveats?: string[];
  geographyAlignment?: { mode?: string; tenderCountry?: string | null };
  opportunityBucket?: string | null;
  opportunityBucketLabel?: string | null;
  opportunityBucketReason?: string | null;
}

const BUCKET_STYLES: Record<string, string> = {
  act_now: "bg-red-100 text-red-800",
  strong_fit: "bg-green-100 text-green-700",
  strategic: "bg-blue-100 text-blue-700",
  adjacent: "bg-amber-100 text-amber-700",
  watchlist: "bg-gray-100 text-gray-600",
};

function isDeadlineSoon(deadline: string | null): boolean {
  if (!deadline) return false;
  const days = (new Date(deadline).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= 7;
}

interface BridgeData {
  assessment_id: number;
  readiness_score: number;
  company_name: string;
  matched_tenders: Array<{
    id?: number;
    title: string;
    agency: string;
    deadline: string | null;
    estimated_value: string | null;
    fit_score?: number;
    structured_reasons?: MatchReason | null;
  }>;
  gaps: Array<{ gap: string; severity: string }>;
}

interface ReadinessData {
  id: number;
  company_name: string;
  readiness_score: number;
  recommended_tier: string | null;
  matched_tenders_count: number;
  high_severity_gaps: Array<{ gap: string; severity: string; fix: string }>;
  action_plan: Array<{
    gap: string;
    severity: "high" | "medium" | "low";
    fix: string;
    action_steps: string[];
    recommended_doc_type: string;
    covered_by_vault: boolean;
    vault_document_count: number;
    primary_action_label: string;
    primary_action_href: string;
    paid_action_label: string;
    paid_action_href: string;
  }>;
  vault_coverage: {
    covered_gaps: number;
    total_gaps: number;
  };
  gap_count: number;
  created_at: string;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function payHref(
  plan: "proposal-draft" | "roster-fast-track",
  item: { id: number; tender_title: string; tender_agency: string | null },
): string {
  const params = new URLSearchParams({
    plan,
    pipeline_item_id: String(item.id),
    tender: item.tender_title,
  });
  if (item.tender_agency) params.set("agency", item.tender_agency);
  return `/pay?${params.toString()}`;
}

export default function DashboardOverview() {
  const router = useRouter();
  const [bridge, setBridge] = useState<BridgeData | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [analysingId, setAnalysingId] = useState<number | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [pipelineStats, setPipelineStats] = useState<{
    total: number;
    active: number;
    won: number;
    matched: number;
  } | null>(null);
  const [matchedTenders, setMatchedTenders] = useState<Array<{
    id: number;
    tender_id: number | null;
    tender_title: string;
    tender_agency: string | null;
    tender_deadline: string | null;
    tender_value: string | null;
    fit_score: number;
    match_reasons?: MatchReason | null;
  }>>([]);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);

  const loadDashboard = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;

    Promise.all([
      fetch("/api/dashboard/pipeline", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).then((r) => r.ok ? r.json() : null),
      fetch("/api/dashboard/tender-feedback?status=not_relevant", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).then((r) => r.ok ? r.json() : null),
      fetch("/api/dashboard/readiness", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).then((r) => r.ok ? r.json() : null),
    ]).then(([pipelineBody, feedbackBody, readinessBody]) => {
      const dismissed = new Set<number>(
        (feedbackBody?.feedback ?? []).map((f: { tender_id: number }) => f.tender_id)
      );

      if (pipelineBody?.items) {
        const items = pipelineBody.items as Array<{ id: number; stage: string; tender_title: string; tender_agency: string | null; tender_deadline: string | null; tender_value: string | null; fit_score: number; tender_id: number | null; match_reasons?: MatchReason | null }>;
        setPipelineStats({
          total: items.length,
          matched: items.filter((i) => i.stage === "matched").length,
          active: items.filter((i) => ["evaluating", "preparing", "submitted"].includes(i.stage)).length,
          won: items.filter((i) => i.stage === "won").length,
        });
        const matched = items.filter(
          (i) => i.stage === "matched" && !(i.tender_id != null && dismissed.has(i.tender_id))
        ).slice(0, 5);
        setMatchedTenders(matched);
      }

      if (readinessBody?.assessment) {
        setReadiness(readinessBody.assessment as ReadinessData);
      }
    }).catch(() => null);
  }, []);

  const seedPipeline = useCallback(async (data: BridgeData) => {
    try {
      await Promise.all(
        data.matched_tenders.map((t) =>
          fetch("/api/dashboard/pipeline", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              tender_id: t.id ?? null,
              assessment_id: data.assessment_id,
              tender_title: t.title,
              tender_agency: t.agency,
              tender_deadline: t.deadline ?? undefined,
              tender_value: t.estimated_value ?? undefined,
              fit_score: t.fit_score ?? data.readiness_score,
              stage: "matched",
              match_reasons: t.structured_reasons ?? null,
            }),
          }).then((res) => {
            if (!res.ok) throw new Error(`Pipeline POST failed: ${res.status}`);
            return res;
          })
        )
      );
      localStorage.removeItem("tp_bridge");
      setSeeded(true);
      loadDashboard();
    } catch {
      // Bridge preserved for retry on next load.
    }
  }, [loadDashboard]);

  useEffect(() => {
    const raw = localStorage.getItem("tp_bridge");
    if (!raw) return;
    try {
      const data: BridgeData = JSON.parse(raw);
      setBridge(data);
      seedPipeline(data);
    } catch {
      localStorage.removeItem("tp_bridge");
    }
  }, [seedPipeline]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleAnalyse(item: { id: number; tender_title: string }) {
    setAnalysingId(item.id);
    setWorkflowError(null);
    try {
      const checkRes = await fetch(
        `/api/analysis/bid-no-bid?pipeline_item_id=${item.id}`,
        { headers: authHeaders() }
      );
      if (checkRes.ok) {
        router.push(`/dashboard/analysis/${item.id}`);
        return;
      }

      const checkoutRes = await fetch("/api/analysis/bid-no-bid/checkout", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          pipeline_item_id: item.id,
          tender_title: item.tender_title,
        }),
      });
      const data = await checkoutRes.json().catch(() => ({})) as { url?: string; error?: string };
      if (!checkoutRes.ok || !data.url) {
        setWorkflowError(data.error ?? "Could not start bid analysis checkout.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setWorkflowError("Could not start bid analysis checkout. Please try again.");
    } finally {
      setAnalysingId(null);
    }
  }

  function isRosterAgency(agency: string | null): boolean {
    if (!agency) return false;
    return /\b(UNDP|UNICEF|WFP|UNHCR|UNOPS|IOM|ILO|FAO|WHO|UNFPA)\b/i.test(agency);
  }

  const nextReadinessActions = readiness?.action_plan.slice(0, 4) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-600">
        Track your tenders from match to award, and keep compliance docs ready.
      </p>

      {/* Readiness score + high-severity blockers */}
      {readiness && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 flex items-center gap-4">
            <div
              className={`text-3xl font-bold ${
                readiness.readiness_score >= 70
                  ? "text-green-600"
                  : readiness.readiness_score >= 50
                  ? "text-amber-600"
                  : "text-red-600"
              }`}
            >
              {readiness.readiness_score}%
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">Readiness Score</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {readiness.company_name}
                {readiness.recommended_tier && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                    {readiness.recommended_tier}
                  </span>
                )}
              </div>
            </div>
          </div>

          {readiness.high_severity_gaps.length > 0 && (
            <div className="md:col-span-2 rounded-lg border border-red-200 bg-red-50 px-5 py-4">
              <div className="text-sm font-semibold text-red-800 mb-2">
                {readiness.high_severity_gaps.length} Critical Gap{readiness.high_severity_gaps.length > 1 ? "s" : ""} to Close
              </div>
              <ul className="space-y-1">
                {readiness.high_severity_gaps.slice(0, 3).map((g, i) => (
                  <li key={i} className="text-xs text-red-700 flex gap-2">
                    <span className="mt-0.5 flex-shrink-0">•</span>
                    <span><span className="font-medium">{g.gap}</span>{g.fix && ` — ${g.fix}`}</span>
                  </li>
                ))}
              </ul>
              {readiness.gap_count > 3 && (
                <div className="mt-2 text-xs text-red-600">
                  +{readiness.gap_count - 3} more gaps · Upload docs to the Vault to resolve them
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={readiness.action_plan[0]?.primary_action_href ?? "/dashboard/vault"}
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-300"
                >
                  {readiness.action_plan[0]?.primary_action_label ?? "Close gaps in Vault"}
                </Link>
                <Link
                  href={readiness.action_plan[0]?.paid_action_href ?? "/pay?plan=roster-fast-track"}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                >
                  {readiness.action_plan[0]?.paid_action_label ?? "Get roster help"}
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {readiness && nextReadinessActions.length > 0 && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Readiness Action Plan</h2>
              <p className="text-xs text-gray-500">
                {readiness.vault_coverage.covered_gaps}/{readiness.vault_coverage.total_gaps} gap
                {readiness.vault_coverage.total_gaps === 1 ? "" : "s"} have supporting Vault evidence.
              </p>
            </div>
            <Link href="/dashboard/vault" className="text-xs font-semibold text-gray-700 hover:text-gray-900 underline">
              Open Vault
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {nextReadinessActions.map((action) => (
              <div key={`${action.severity}-${action.gap}`} className="px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                        action.severity === "high"
                          ? "bg-red-100 text-red-700"
                          : action.severity === "medium"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-600"
                      }`}>
                        {action.severity}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        action.covered_by_vault ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {action.covered_by_vault
                          ? `${action.vault_document_count} Vault doc${action.vault_document_count === 1 ? "" : "s"}`
                          : `Needs ${action.recommended_doc_type.replace("_", " ")}`}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-gray-900">{action.gap}</div>
                    <p className="mt-1 text-xs text-gray-500">{action.fix}</p>
                    {action.action_steps.length > 0 && (
                      <p className="mt-1 text-xs text-gray-400">
                        Next: {action.action_steps[0]}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Link
                      href={action.primary_action_href}
                      className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
                    >
                      {action.primary_action_label}
                    </Link>
                    <Link
                      href={action.paid_action_href}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
                    >
                      {action.paid_action_label}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {workflowError && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {workflowError}
        </div>
      )}

      {/* Stats bar */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Matched Tenders", value: pipelineStats?.matched ?? "—" },
          { label: "Active Bids", value: pipelineStats?.active ?? "—" },
          { label: "Won", value: pipelineStats?.won ?? "—" },
          { label: "Total in Pipeline", value: pipelineStats?.total ?? "—" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Matched Tenders widget */}
      {matchedTenders.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-900">Your Matched Tenders</h2>
            <Link href="/dashboard/pipeline" className="text-xs text-gray-500 hover:text-gray-900 underline">
              View all in Pipeline →
            </Link>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
            {matchedTenders.map((t) => (
              <div key={t.id} className="px-4 py-3 flex flex-col gap-3 hover:bg-gray-50 transition-colors sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-medium text-gray-900 truncate">{t.tender_title}</div>
                    {t.match_reasons?.opportunityBucketLabel && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BUCKET_STYLES[t.match_reasons.opportunityBucket ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                        {t.match_reasons.opportunityBucketLabel}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.tender_agency && <span>{t.tender_agency}</span>}
                    {t.tender_deadline && (
                      <span className={`ml-2 ${isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-600" : ""}`}>
                        {isDeadlineSoon(t.tender_deadline) ? "⚡ Due " : "· Due "}
                        {new Date(t.tender_deadline).toLocaleDateString()}
                      </span>
                    )}
                    {t.tender_value && (
                      <span className="ml-2">· {t.tender_value}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {t.fit_score > 0 && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      t.fit_score >= 70 ? "bg-green-100 text-green-800" :
                      t.fit_score >= 50 ? "bg-amber-100 text-amber-800" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {t.fit_score}% fit
                    </span>
                  )}
                  <button
                    onClick={() => handleAnalyse(t)}
                    disabled={analysingId === t.id}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {analysingId === t.id ? "Checking..." : "Bid/no-bid $39"}
                  </button>
                  <Link
                    href={payHref("proposal-draft", t)}
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
                  >
                    Draft proposal
                  </Link>
                  {isRosterAgency(t.tender_agency) && (
                    <Link
                      href={payHref("roster-fast-track", t)}
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:border-amber-300"
                    >
                      Roster/LTA help
                    </Link>
                  )}
                  <Link
                    href="/dashboard/pipeline"
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Track
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(bridge || seeded) && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-5 py-4">
          <div className="text-sm font-semibold text-green-800">
            Welcome{bridge?.company_name ? `, ${bridge.company_name}` : ""}!
          </div>
          <p className="text-sm text-green-700 mt-0.5">
            {seeded
              ? "Your matched tenders have been added to your pipeline. Head over to the Kanban board to start tracking."
              : "Seeding your pipeline with matched tenders…"}
          </p>
          {bridge && bridge.gaps.length > 0 && (
            <p className="text-xs text-green-600 mt-2">
              Tip: Upload documents to the Vault to close your top compliance gaps.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/dashboard/pipeline"
          className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-900 transition group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm uppercase tracking-wide text-gray-500">Bid/No-Bid</div>
            <svg className="h-4 w-4 text-gray-400 group-hover:text-gray-900 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <div className="text-lg font-semibold text-gray-900">Analyze a tender</div>
          <div className="mt-1 text-sm text-gray-500">
            Pick a live tender from your pipeline and get win probability, risks, required documents, and a bid/no-bid recommendation.
          </div>
        </Link>

        <Link
          href="/pay?plan=proposal-draft"
          className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-900 transition group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm uppercase tracking-wide text-gray-500">Proposal Draft</div>
            <svg className="h-4 w-4 text-gray-400 group-hover:text-gray-900 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <div className="text-lg font-semibold text-gray-900">Build a submission package</div>
          <div className="mt-1 text-sm text-gray-500">
            Move from decision to draft: technical narrative, compliance checklist, and financial template.
          </div>
        </Link>

        <Link
          href="/dashboard/pipeline"
          className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-900 transition group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm uppercase tracking-wide text-gray-500">Pipeline</div>
            <svg className="h-4 w-4 text-gray-400 group-hover:text-gray-900 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <div className="text-lg font-semibold text-gray-900">Tender Kanban Board</div>
          <div className="mt-1 text-sm text-gray-500">
            Drag tenders through 6 stages: Matched → Evaluating → Preparing → Submitted → Won / Lost
          </div>
          {pipelineStats && (
            <div className="mt-3 text-xs text-gray-400">
              {pipelineStats.total} tender{pipelineStats.total !== 1 ? "s" : ""} in pipeline
            </div>
          )}
        </Link>

        <Link
          href="/dashboard/vault"
          className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-900 transition group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm uppercase tracking-wide text-gray-500">Vault</div>
            <svg className="h-4 w-4 text-gray-400 group-hover:text-gray-900 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </div>
          <div className="text-lg font-semibold text-gray-900">Document Vault</div>
          <div className="mt-1 text-sm text-gray-500">
            Store certifications, financials, CVs, and past performance docs — with automatic expiry alerts.
          </div>
        </Link>
      </div>
    </div>
  );
}
