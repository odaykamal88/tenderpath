"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface MatchReason {
  summary?: string[];
  matchedSectors?: string[];
  matchedCapabilities?: string[];
  matchedKeywords?: string[];
  confidence?: number;
  caveats?: string[];
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
  gap_count: number;
  created_at: string;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

export default function DashboardOverview() {
  const [bridge, setBridge] = useState<BridgeData | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [pipelineStats, setPipelineStats] = useState<{
    total: number;
    active: number;
    won: number;
    matched: number;
  } | null>(null);
  const [matchedTenders, setMatchedTenders] = useState<Array<{
    id: number;
    tender_title: string;
    tender_agency: string | null;
    tender_deadline: string | null;
    fit_score: number;
  }>>([]);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

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
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;

    // Load feedback (not_relevant) and pipeline concurrently
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
      setDismissedIds(dismissed);

      if (pipelineBody?.items) {
        const items = pipelineBody.items as Array<{ id: number; stage: string; tender_title: string; tender_agency: string | null; tender_deadline: string | null; fit_score: number; tender_id: number | null }>;
        setPipelineStats({
          total: items.length,
          matched: items.filter((i) => i.stage === "matched").length,
          active: items.filter((i) => ["evaluating", "preparing", "submitted"].includes(i.stage)).length,
          won: items.filter((i) => i.stage === "won").length,
        });
        // filter dismissed from matched widget
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

  async function seedPipeline(data: BridgeData) {
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
          })
        )
      );
      localStorage.removeItem("tp_bridge");
      setSeeded(true);
    } catch {
      // silently fail — pipeline still usable
    }
  }

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
            </div>
          )}
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
              <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{t.tender_title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.tender_agency && <span>{t.tender_agency}</span>}
                    {t.tender_deadline && (
                      <span className="ml-2">· Due {new Date(t.tender_deadline).toLocaleDateString()}</span>
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
                  <Link
                    href="/dashboard/pipeline"
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Track →
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
