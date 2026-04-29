"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface MatchReason {
  summary?: string[];
  matchedSectors?: string[];
  matchedCapabilities?: string[];
  matchedKeywords?: string[];
  procurement?: {
    category?: string | null;
    opportunityType?: string | null;
    sourceName?: string | null;
    sourceUrl?: string | null;
    sourceProvenance?: "primary" | "aggregator" | "unknown";
    postedDate?: string | null;
    updatedDate?: string | null;
    sectorLabel?: string | null;
    estimatedValue?: string | number | null;
  };
  confidence?: number | "high" | "medium" | "low";
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
  const days = daysUntilDeadline(deadline);
  return days != null && days >= 0 && days <= 7;
}

function daysUntilDeadline(deadline: string | null): number | null {
  if (!deadline) return null;
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / 86_400_000);
}

function deadlineLabel(deadline: string | null): string {
  const days = daysUntilDeadline(deadline);
  if (days == null) return "No deadline";
  const date = new Date(deadline ?? "").toLocaleDateString();
  if (days < 0) return `Expired ${date}`;
  if (days === 0) return `Due today`;
  if (days === 1) return `Due tomorrow`;
  return `${days} days left`;
}

function procurementLabel(item: PipelineTender): string | null {
  return item.match_reasons?.procurement?.category
    ?? item.match_reasons?.procurement?.opportunityType
    ?? item.opportunity_type
    ?? null;
}

function sourceLabel(item: PipelineTender): string | null {
  return item.match_reasons?.procurement?.sourceName ?? item.source_name ?? null;
}

function provenanceLabel(item: PipelineTender): string {
  const provenance = item.match_reasons?.procurement?.sourceProvenance;
  if (provenance === "aggregator") return "Aggregator";
  if (provenance === "primary" || item.source_url) return "Primary source";
  return "Source pending";
}

function dateLabel(date: string | null | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString();
}

interface BridgeData {
  assessment_id: number;
  email?: string;
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

type ReadinessAction = ReadinessData["action_plan"][number];

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function serviceHref(
  service: "bid-no-bid" | "proposal" | "lta-roster",
  item: { id: number; tender_title: string; tender_agency: string | null },
): string {
  const params = new URLSearchParams({
    pipeline_item_id: String(item.id),
    tender: item.tender_title,
  });
  if (item.tender_agency) params.set("agency", item.tender_agency);
  return `/dashboard/services/${service}?${params.toString()}`;
}

type PipelineTender = {
  id: number;
  tender_id: number | null;
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  fit_score: number;
  match_reasons?: MatchReason | null;
  source_name?: string | null;
  source_url?: string | null;
  opportunity_type?: string | null;
  tender_sector?: string | null;
  tender_created_at?: string | null;
  tender_updated_at?: string | null;
  has_broken_link?: boolean | null;
};

function priorityRank(item: PipelineTender): number {
  const bucket = item.match_reasons?.opportunityBucket;
  if (bucket === "act_now") return 0;
  if (isDeadlineSoon(item.tender_deadline)) return 1;
  if (bucket === "strong_fit") return 2;
  if (item.fit_score >= 70) return 3;
  if (bucket === "strategic") return 4;
  if (bucket === "adjacent") return 5;
  return 6;
}

function nextActionFor(item: PipelineTender): {
  label: string;
  detail: string;
  kind: "analysis" | "proposal" | "roster";
} {
  if (isDeadlineSoon(item.tender_deadline)) {
    return {
      label: "Run bid/no-bid now",
      detail: "Deadline pressure makes the pursuit decision the first step.",
      kind: "analysis",
    };
  }
  if (item.fit_score >= 75) {
    return {
      label: "Start proposal package",
      detail: "Strong fit; move from shortlist to submission planning.",
      kind: "proposal",
    };
  }
  if (/\b(UNDP|UNICEF|WFP|UNHCR|UNOPS|IOM|ILO|FAO|WHO|UNFPA)\b/i.test(item.tender_agency ?? "")) {
    return {
      label: "Check roster/LTA path",
      detail: "UN agency opportunity; verify registration and LTA readiness.",
      kind: "roster",
    };
  }
  return {
    label: "Qualify fit",
    detail: "Review match evidence before investing proposal time.",
    kind: "analysis",
  };
}

function gapKey(action: ReadinessAction): string {
  return `${action.severity}:${action.gap}`;
}

function ReadinessRing({ score }: { score: number }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const color = score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  const label = score >= 70 ? "Good foundation" : score >= 50 ? "Needs attention" : "Critical gaps";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#f3f4f6" strokeWidth="8" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 48 48)"
        />
        <text x="48" y="45" textAnchor="middle" fontSize="20" fontWeight="700" fill={color}>{score}</text>
        <text x="48" y="59" textAnchor="middle" fontSize="10" fill="#9ca3af">%</text>
      </svg>
      <div className="text-xs font-medium text-gray-600">{label}</div>
    </div>
  );
}

export default function DashboardOverview() {
  const [bridge, setBridge] = useState<BridgeData | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [pipelineStats, setPipelineStats] = useState<{
    total: number;
    active: number;
    won: number;
    matched: number;
    dueSoon: number;
    strong: number;
  } | null>(null);
  const [matchedTenders, setMatchedTenders] = useState<PipelineTender[]>([]);
  const [feedbackSavingId, setFeedbackSavingId] = useState<number | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [completedGapKeys, setCompletedGapKeys] = useState<Set<string>>(new Set());
  const [expandedTenderId, setExpandedTenderId] = useState<number | null>(null);

  const loadDashboard = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;
    setWorkflowError(null);

    Promise.all([
      fetch("/api/dashboard/pipeline", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).then((r) => {
        if (!r.ok) throw new Error(`Pipeline GET failed: ${r.status}`);
        return r.json();
      }),
      fetch("/api/dashboard/tender-feedback?status=not_relevant", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).then((r) => {
        if (!r.ok) throw new Error(`Tender feedback GET failed: ${r.status}`);
        return r.json();
      }),
      fetch("/api/dashboard/readiness", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      }).then((r) => {
        if (!r.ok) throw new Error(`Readiness GET failed: ${r.status}`);
        return r.json();
      }),
    ]).then(([pipelineBody, feedbackBody, readinessBody]) => {
      const dismissed = new Set<number>(
        (feedbackBody?.feedback ?? []).map((f: { tender_id: number }) => f.tender_id)
      );

      if (pipelineBody?.items) {
        const items = pipelineBody.items as Array<PipelineTender & { stage: string }>;
        setPipelineStats({
          total: items.length,
          matched: items.filter((i) => i.stage === "matched").length,
          active: items.filter((i) => ["evaluating", "preparing", "submitted"].includes(i.stage)).length,
          won: items.filter((i) => i.stage === "won").length,
          dueSoon: items.filter((i) => i.stage === "matched" && isDeadlineSoon(i.tender_deadline)).length,
          strong: items.filter((i) => i.stage === "matched" && (i.fit_score >= 70 || i.match_reasons?.opportunityBucket === "strong_fit" || i.match_reasons?.opportunityBucket === "act_now")).length,
        });
        const matched = items.filter(
          (i) => i.stage === "matched" && !(i.tender_id != null && dismissed.has(i.tender_id))
        ).sort((a, b) => priorityRank(a) - priorityRank(b) || b.fit_score - a.fit_score).slice(0, 6);
        setMatchedTenders(matched);
      }

      if (readinessBody?.assessment) {
        setReadiness(readinessBody.assessment as ReadinessData);
      }
    }).catch((err) => {
      console.error("[tp:dashboard:load_failed]", err);
      setWorkflowError("We could not load your dashboard yet. Please refresh or sign in again.");
    });
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
    } catch (err) {
      console.error("[tp:pipeline:seed_failed]", {
        assessmentId: data.assessment_id,
        tenderCount: data.matched_tenders.length,
        error: err instanceof Error ? err.message : String(err),
      });
      setWorkflowError("Your assessment is saved, but we could not populate your dashboard yet. Refreshing will retry.");
    }
  }, [loadDashboard]);

  useEffect(() => {
    const raw = localStorage.getItem("tp_bridge");
    if (!raw) return;
    try {
      const data: BridgeData = JSON.parse(raw);
      setBridge(data);
      seedPipeline(data);
    } catch (err) {
      console.error("[tp:bridge:parse_failed]", err);
      setWorkflowError("We could not read your saved assessment handoff. Please open your emailed report or rerun the assessment.");
      localStorage.removeItem("tp_bridge");
    }
  }, [seedPipeline]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!readiness) return;
    try {
      const raw = localStorage.getItem(`tp_gap_done_${readiness.id}`);
      const values = raw ? JSON.parse(raw) : [];
      setCompletedGapKeys(new Set(Array.isArray(values) ? values.filter((value) => typeof value === "string") : []));
    } catch (err) {
      console.error("[tp:dashboard:gaps_done_parse_failed]", err);
      setCompletedGapKeys(new Set());
    }
  }, [readiness]);

  async function handleTenderFeedback(item: PipelineTender, status: "saved" | "not_relevant") {
    if (!item.tender_id) {
      if (status === "not_relevant") {
        setMatchedTenders((prev) => prev.filter((t) => t.id !== item.id));
      }
      return;
    }
    setFeedbackSavingId(item.id);
    setWorkflowError(null);
    try {
      const res = await fetch("/api/dashboard/tender-feedback", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          tender_id: item.tender_id,
          status,
          reason: status === "not_relevant" ? "Dismissed from dashboard workbench" : "Saved from dashboard workbench",
        }),
      });
      if (!res.ok) throw new Error(`Feedback POST failed: ${res.status}`);
      if (status === "not_relevant") {
        setMatchedTenders((prev) => prev.filter((t) => t.id !== item.id));
      }
    } catch (err) {
      console.error("[tp:dashboard:feedback_failed]", err);
      setWorkflowError("We could not save that tender preference. Please try again.");
    } finally {
      setFeedbackSavingId(null);
    }
  }

  function isRosterAgency(agency: string | null): boolean {
    if (!agency) return false;
    return /\b(UNDP|UNICEF|WFP|UNHCR|UNOPS|IOM|ILO|FAO|WHO|UNFPA)\b/i.test(agency);
  }

  function toggleGapDone(action: ReadinessAction) {
    if (!readiness) return;
    const key = gapKey(action);
    setCompletedGapKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(`tp_gap_done_${readiness.id}`, JSON.stringify([...next]));
      return next;
    });
  }

  const primaryTender = matchedTenders[0] ?? null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Procurement workbench
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {readiness?.company_name ? readiness.company_name : "Dashboard"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Your matched tenders, readiness status, and next actions in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/pipeline"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Open pipeline
          </Link>
          <Link
            href="/dashboard/services/digest"
            className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
          >
            Weekly digest
          </Link>
        </div>
      </div>

      {/* Welcome banner — shown after fresh assessment seed */}
      {(bridge || seeded) && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-5 py-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-green-800">
              Welcome{bridge?.company_name ? `, ${bridge.company_name}` : ""}!
            </div>
            <p className="text-sm text-green-700 mt-0.5">
              {seeded
                ? "Your matched tenders have been added to your pipeline."
                : "Seeding your pipeline with matched tenders…"}
              {bridge?.gaps && bridge.gaps.length > 0 && " Upload documents to close your top compliance gaps."}
            </p>
          </div>
          <Link href="/dashboard/pipeline" className="shrink-0 text-xs font-semibold text-green-800 underline whitespace-nowrap">
            View pipeline
          </Link>
        </div>
      )}

      {/* Error */}
      {workflowError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {workflowError}
        </div>
      )}

      {/* Stats row */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Matched tenders", value: pipelineStats?.matched ?? "—", note: `${pipelineStats?.strong ?? 0} strong fit` },
          { label: "Deadline pressure", value: pipelineStats?.dueSoon ?? "—", note: "Due in 7 days" },
          { label: "Active bids", value: pipelineStats?.active ?? "—", note: "Evaluating or later" },
          { label: "Total pipeline", value: pipelineStats?.total ?? "—", note: `${pipelineStats?.won ?? 0} won` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
            <div className="mt-1 text-[11px] text-gray-400">{stat.note}</div>
          </div>
        ))}
      </div>

      {/* Readiness + Top priority — 2 cols */}
      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Readiness card */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Readiness</div>
              {readiness?.recommended_tier && (
                <span className="mt-1 inline-block rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">
                  {readiness.recommended_tier}
                </span>
              )}
              {readiness && readiness.action_plan.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-gray-700">Top gaps</div>
                    <Link href="/dashboard/vault" className="text-xs text-gray-500 hover:text-gray-900 underline">
                      Open vault
                    </Link>
                  </div>
                  <ul className="space-y-2">
                    {readiness.action_plan.slice(0, 3).map((action) => {
                      const key = gapKey(action);
                      const complete = action.covered_by_vault || completedGapKeys.has(key);
                      return (
                        <li key={key} className="flex items-center gap-2.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${
                            action.severity === "high"
                              ? "bg-red-500"
                              : action.severity === "medium"
                              ? "bg-amber-400"
                              : "bg-gray-300"
                          }`} />
                          <span className={`flex-1 text-xs leading-5 ${complete ? "line-through text-gray-400" : "text-gray-700"}`}>
                            {action.gap}
                          </span>
                          <button
                            onClick={() => toggleGapDone(action)}
                            className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              complete
                                ? "text-green-700 bg-green-100"
                                : "text-gray-500 bg-gray-100 hover:bg-gray-200"
                            }`}
                          >
                            {complete ? "Done" : "Mark done"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {readiness.action_plan.length > 3 && (
                    <Link href="/dashboard/vault" className="mt-2 block text-xs text-gray-500 hover:text-gray-900 underline">
                      +{readiness.action_plan.length - 3} more gaps →
                    </Link>
                  )}
                </div>
              )}
              {!readiness && (
                <p className="mt-3 text-sm text-gray-500">
                  Run an assessment to see your readiness score and compliance gaps.{" "}
                  <Link href="/assessment" className="text-gray-700 underline">Start assessment</Link>
                </p>
              )}
            </div>
            {readiness ? (
              <ReadinessRing score={readiness.readiness_score} />
            ) : (
              <div className="h-24 w-24 rounded-full border-8 border-gray-100 flex items-center justify-center">
                <span className="text-xs text-gray-400">—</span>
              </div>
            )}
          </div>
        </div>

        {/* Top priority tender */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top priority</div>
          {primaryTender ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {primaryTender.match_reasons?.opportunityBucketLabel && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BUCKET_STYLES[primaryTender.match_reasons.opportunityBucket ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                    {primaryTender.match_reasons.opportunityBucketLabel}
                  </span>
                )}
                {primaryTender.fit_score > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                    {primaryTender.fit_score}% fit
                  </span>
                )}
              </div>
              <h2 className="mt-2 text-sm font-semibold text-gray-900 line-clamp-2">
                {primaryTender.tender_title}
              </h2>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                {procurementLabel(primaryTender) && <span>{procurementLabel(primaryTender)}</span>}
                {primaryTender.tender_agency && <span>{primaryTender.tender_agency}</span>}
                <span className={isDeadlineSoon(primaryTender.tender_deadline) ? "font-semibold text-red-600" : ""}>
                  {deadlineLabel(primaryTender.tender_deadline)}
                </span>
                {primaryTender.tender_value && <span>{primaryTender.tender_value}</span>}
                <span>{provenanceLabel(primaryTender)}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-600 line-clamp-2">
                {primaryTender.match_reasons?.opportunityBucketReason
                  ?? primaryTender.match_reasons?.summary?.[0]
                  ?? "Review this opportunity first — it ranks highest for fit, urgency, and actionability."}
              </p>
              <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
                <div className="text-xs font-semibold text-gray-900">{nextActionFor(primaryTender).label}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">{nextActionFor(primaryTender).detail}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={serviceHref("bid-no-bid", primaryTender)}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
                >
                  Bid/no-bid
                </Link>
                <Link
                  href={serviceHref("proposal", primaryTender)}
                  className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
                >
                  Proposal package
                </Link>
                {isRosterAgency(primaryTender.tender_agency) && (
                  <Link
                    href={serviceHref("lta-roster", primaryTender)}
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:border-amber-300"
                  >
                    Roster/LTA
                  </Link>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-gray-500">No matched tenders yet.</p>
              <Link
                href="/assessment"
                className="mt-3 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
              >
                Run an assessment
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Compact expandable tender feed */}
      {matchedTenders.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Matched tenders</h2>
              <p className="text-xs text-gray-500">Click a row to see match detail and actions.</p>
            </div>
            <Link href="/dashboard/pipeline" className="text-xs text-gray-500 hover:text-gray-900 underline">
              View all in pipeline
            </Link>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {matchedTenders.map((t) => {
              const isExpanded = expandedTenderId === t.id;
              const action = nextActionFor(t);
              return (
                <div key={t.id}>
                  <button
                    className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedTenderId(isExpanded ? null : t.id)}
                  >
                    {t.fit_score > 0 && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700 min-w-[40px] text-center">
                        {t.fit_score}%
                      </span>
                    )}
                    {t.match_reasons?.opportunityBucketLabel && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold hidden sm:inline ${BUCKET_STYLES[t.match_reasons.opportunityBucket ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                        {t.match_reasons.opportunityBucketLabel}
                      </span>
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">
                        {t.tender_title}
                      </span>
                      <span className="mt-1 hidden sm:flex flex-wrap items-center gap-1.5">
                        {procurementLabel(t) && (
                          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                            {procurementLabel(t)}
                          </span>
                        )}
                        {sourceLabel(t) && (
                          <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                            {sourceLabel(t)}
                          </span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${provenanceLabel(t) === "Primary source" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                          {provenanceLabel(t)}
                        </span>
                      </span>
                    </span>
                    {t.tender_agency && (
                      <span className="shrink-0 text-xs text-gray-400 hidden md:block truncate max-w-[160px]">
                        {t.tender_agency}
                      </span>
                    )}
                    <span className={`shrink-0 text-xs ${isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-600" : "text-gray-400"}`}>
                      {deadlineLabel(t.tender_deadline)}
                    </span>
                    <svg
                      className={`shrink-0 h-4 w-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100">
                      <div className="pt-3 space-y-2">
                        <div className="text-xs font-semibold text-gray-700">Why this matched</div>
                        <p className="text-xs leading-5 text-gray-600">
                          {t.match_reasons?.summary?.[0]
                            ?? t.match_reasons?.opportunityBucketReason
                            ?? "Tenderpath found sector, capability, or geography evidence that makes this worth a closer look."}
                        </p>
                        {((t.match_reasons?.matchedSectors ?? []).length > 0 || (t.match_reasons?.matchedKeywords ?? []).length > 0) && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {(t.match_reasons?.matchedSectors ?? []).slice(0, 3).map((s) => (
                              <span key={s} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{s}</span>
                            ))}
                            {(t.match_reasons?.matchedKeywords ?? []).slice(0, 3).map((k) => (
                              <span key={k} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{k}</span>
                            ))}
                          </div>
                        )}
                        {(t.match_reasons?.caveats ?? []).length > 0 && (
                          <p className="text-[11px] text-amber-700">{t.match_reasons!.caveats![0]}</p>
                        )}
                        <div className="grid gap-2 rounded-md border border-gray-200 bg-white p-3 text-[11px] text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <div className="font-semibold text-gray-900">Type</div>
                            <div>{procurementLabel(t) ?? "Procurement notice"}</div>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">Source</div>
                            <div>{sourceLabel(t) ?? "Not listed"} · {provenanceLabel(t)}</div>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">Value</div>
                            <div>{t.tender_value ?? t.match_reasons?.procurement?.estimatedValue ?? "Not listed"}</div>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">Updated</div>
                            <div>{dateLabel(t.match_reasons?.procurement?.updatedDate ?? t.tender_updated_at) ?? "Not listed"}</div>
                          </div>
                        </div>
                        <div className="pt-1">
                          <div className="text-xs font-semibold text-gray-900">{action.label}</div>
                          <div className="mt-0.5 text-[11px] text-gray-500">{action.detail}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Link
                            href={serviceHref("bid-no-bid", t)}
                            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
                          >
                            Bid/no-bid
                          </Link>
                          <Link
                            href={serviceHref("proposal", t)}
                            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
                          >
                            Proposal
                          </Link>
                          {isRosterAgency(t.tender_agency) && (
                            <Link
                              href={serviceHref("lta-roster", t)}
                              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:border-amber-300"
                            >
                              Roster/LTA
                            </Link>
                          )}
                          <div className="flex-1" />
                          <button
                            onClick={() => handleTenderFeedback(t, "saved")}
                            disabled={feedbackSavingId === t.id}
                            className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => handleTenderFeedback(t, "not_relevant")}
                            disabled={feedbackSavingId === t.id}
                            className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state — no tenders */}
      {matchedTenders.length === 0 && (pipelineStats === null || pipelineStats.total === 0) && (
        <div className="mt-5 rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
          <div className="text-sm font-semibold text-gray-700">No matched tenders yet</div>
          <p className="mt-1 text-sm text-gray-500">
            Run an assessment to find tenders and grants that match your company profile.
          </p>
          <Link
            href="/assessment"
            className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Start assessment
          </Link>
        </div>
      )}

      {/* Service paths */}
      <div className="mt-6">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-gray-900">Service paths</h2>
          <p className="text-xs text-gray-500">Choose the product that matches your stage.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Bid/no-bid",
              title: "Decide before writing",
              body: "Fit reasoning, blockers, required documents, and a pursuit recommendation.",
              href: "/dashboard/services/bid-no-bid",
              price: "$39",
            },
            {
              label: "Digest",
              title: "Keep matches flowing",
              body: "Weekly shortlist of tenders and grants scored against the company profile.",
              href: "/dashboard/services/digest",
              price: "$49/mo",
            },
            {
              label: "Apply",
              title: "Build the proposal pack",
              body: "Technical narrative, compliance checklist, and financial template for a live tender.",
              href: "/dashboard/services/proposal",
              price: "$299",
            },
            {
              label: "LTA / roster",
              title: "Prepare vendor registration",
              body: "Agency-specific documents, capability statement, and submission support.",
              href: "/dashboard/services/lta-roster",
              price: "$749",
            },
          ].map((service) => (
            <Link
              key={service.label}
              href={service.href}
              className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-900"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{service.label}</div>
                <div className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                  {service.price}
                </div>
              </div>
              <div className="mt-3 text-sm font-semibold text-gray-900">{service.title}</div>
              <p className="mt-1 text-xs leading-5 text-gray-500">{service.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
