"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface MatchReason {
  summary?: string[];
  matchedSectors?: string[];
  matchedCapabilities?: string[];
  matchedKeywords?: string[];
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

function confidenceLabel(value: MatchReason["confidence"]): string | null {
  if (value == null) return null;
  if (typeof value === "number") return `${Math.round(value * 100)}% confidence`;
  return `${value} confidence`;
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

function guidanceForGap(action: ReadinessAction): { label: string; steps: string[] } {
  const type = action.recommended_doc_type;
  const websiteStep = "Update your website, capability statement, or public profile so buyers can verify this claim.";

  if (type === "financial") {
    return {
      label: "Financial proof",
      steps: [
        "Prepare audited statements, tax records, bank letter, or turnover evidence.",
        "Upload the evidence to the Vault with the latest expiry date if it has one.",
        "Make sure the same capacity is reflected in your company profile or website.",
      ],
    };
  }

  if (type === "past_performance") {
    return {
      label: "Track record proof",
      steps: [
        "Write 2-3 short project references with client, country, dates, scope, and value.",
        "Add links, letters, photos, or contracts as supporting evidence where possible.",
        websiteStep,
      ],
    };
  }

  if (type === "cv") {
    return {
      label: "Team proof",
      steps: [
        "Collect CVs for the staff or experts likely to appear in proposals.",
        "Standardize them into a consistent two-page tender-ready format.",
        "Keep the strongest CVs in the Vault for reuse across bids.",
      ],
    };
  }

  if (type === "certification") {
    return {
      label: "Compliance proof",
      steps: [
        "Gather registration, licenses, policies, ISO certificates, vendor forms, or equivalent proof.",
        "Check expiry dates and upload current versions to the Vault.",
        websiteStep,
      ],
    };
  }

  return {
    label: "Readiness proof",
    steps: [
      "Turn the gap into a concrete proof point: document, webpage, policy, reference, or process note.",
      "Upload any reusable evidence to the Vault.",
      "Mark it done once the external update is complete.",
    ],
  };
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

  const nextReadinessActions = readiness?.action_plan.slice(0, 4) ?? [];
  const primaryTender = matchedTenders[0] ?? null;

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Procurement workbench
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {readiness?.company_name ? `${readiness.company_name} dashboard` : "Dashboard"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Prioritize the tenders worth action, check why they matched, and move straight into bid/no-bid, proposal, or roster work.
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

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Next best action
              </div>
              {primaryTender ? (
                <>
                  <h2 className="mt-2 text-lg font-semibold text-gray-900 line-clamp-2">
                    {primaryTender.tender_title}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {primaryTender.tender_agency && <span>{primaryTender.tender_agency}</span>}
                    <span className={isDeadlineSoon(primaryTender.tender_deadline) ? "font-semibold text-red-600" : ""}>
                      {deadlineLabel(primaryTender.tender_deadline)}
                    </span>
                    {primaryTender.tender_value && <span>{primaryTender.tender_value}</span>}
                    {primaryTender.fit_score > 0 && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-700">
                        {primaryTender.fit_score}% fit
                      </span>
                    )}
                    {primaryTender.match_reasons?.opportunityBucketLabel && (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${BUCKET_STYLES[primaryTender.match_reasons.opportunityBucket ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                        {primaryTender.match_reasons.opportunityBucketLabel}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-gray-600">
                    {primaryTender.match_reasons?.opportunityBucketReason
                      ?? primaryTender.match_reasons?.summary?.[0]
                      ?? "Review this opportunity first because it currently ranks highest for fit, urgency, and actionability."}
                  </p>
                  <div className="mt-4 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="text-sm font-semibold text-gray-900">{nextActionFor(primaryTender).label}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{nextActionFor(primaryTender).detail}</div>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-2 text-lg font-semibold text-gray-900">No active matches yet</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Run or refresh an assessment to seed this workspace with matched tenders and readiness actions.
                  </p>
                </>
              )}
            </div>
            {primaryTender && (
              <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col">
                <Link
                  href={serviceHref("bid-no-bid", primaryTender)}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  Bid/no-bid
                </Link>
                <Link
                  href={serviceHref("proposal", primaryTender)}
                  className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
                >
                  Proposal package
                </Link>
                {isRosterAgency(primaryTender.tender_agency) && (
                  <Link
                    href={serviceHref("lta-roster", primaryTender)}
                    className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:border-amber-300"
                  >
                    Roster/LTA
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Readiness</div>
              <div className={`mt-2 text-4xl font-bold ${
                (readiness?.readiness_score ?? 0) >= 70
                  ? "text-green-600"
                  : (readiness?.readiness_score ?? 0) >= 50
                  ? "text-amber-600"
                  : "text-red-600"
              }`}>
                {readiness ? `${readiness.readiness_score}%` : "--"}
              </div>
            </div>
            {readiness?.recommended_tier && (
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                {readiness.recommended_tier}
              </span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-gray-50 px-2 py-3">
              <div className="text-lg font-semibold text-gray-900">{pipelineStats?.strong ?? "—"}</div>
              <div className="text-[11px] text-gray-500">Strong</div>
            </div>
            <div className="rounded-md bg-gray-50 px-2 py-3">
              <div className="text-lg font-semibold text-gray-900">{pipelineStats?.dueSoon ?? "—"}</div>
              <div className="text-[11px] text-gray-500">Due soon</div>
            </div>
            <div className="rounded-md bg-gray-50 px-2 py-3">
              <div className="text-lg font-semibold text-gray-900">{readiness?.gap_count ?? "—"}</div>
              <div className="text-[11px] text-gray-500">Gaps</div>
            </div>
          </div>
          {readiness?.high_severity_gaps?.[0] && (
            <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2">
              <div className="text-xs font-semibold text-red-800">
                Critical blocker
              </div>
              <div className="mt-1 text-xs text-red-700 line-clamp-2">
                {readiness.high_severity_gaps[0].gap}
              </div>
            </div>
          )}
        </div>
      </div>

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
            {nextReadinessActions.map((action) => {
              const guidance = guidanceForGap(action);
              const complete = action.covered_by_vault || completedGapKeys.has(gapKey(action));

              return (
              <div key={`${action.severity}-${action.gap}`} className={`px-5 py-4 ${complete ? "bg-green-50/40" : ""}`}>
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
                        complete ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {action.covered_by_vault
                          ? `${action.vault_document_count} Vault doc${action.vault_document_count === 1 ? "" : "s"}`
                          : complete
                          ? "Marked done"
                          : `Needs ${action.recommended_doc_type.replace("_", " ")}`}
                      </span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                        {guidance.label}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-gray-900">{action.gap}</div>
                    <p className="mt-1 text-xs text-gray-500">{action.fix}</p>
                    <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
                      <div className="text-xs font-semibold text-gray-900">How to close it</div>
                      <ul className="mt-1 space-y-1">
                        {[...(action.action_steps.slice(0, 1)), ...guidance.steps].slice(0, 4).map((step) => (
                          <li key={step} className="flex gap-2 text-xs leading-5 text-gray-600">
                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      onClick={() => toggleGapDone(action)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                        completedGapKeys.has(gapKey(action))
                          ? "border-green-200 bg-green-50 text-green-700 hover:border-green-300"
                          : "border-gray-200 text-gray-700 hover:border-gray-400"
                      }`}
                    >
                      {completedGapKeys.has(gapKey(action)) ? "Marked done" : "Mark done"}
                    </button>
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
            );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Automatic matching
            </div>
            <h2 className="mt-1 text-base font-semibold text-gray-900">
              Assessment matches are added to your pipeline
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
              After an assessment, Tenderpath carries matched tenders into the dashboard automatically. The $49 digest path is the retention layer for continuing that matching loop through a weekly email shortlist.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/pipeline"
              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
            >
              Review auto-added matches
            </Link>
            <Link
              href="/dashboard/services/digest"
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
            >
              Set up weekly digest
            </Link>
          </div>
        </div>
      </div>

      {workflowError && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {workflowError}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
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

      {matchedTenders.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Priority tenders</h2>
              <p className="text-xs text-gray-500">
                Sorted by urgency, fit, and Tenderpath opportunity bucket.
              </p>
            </div>
            <Link href="/dashboard/pipeline" className="text-xs text-gray-500 hover:text-gray-900 underline">
              View all in pipeline
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {matchedTenders.map((t) => {
              const action = nextActionFor(t);
              const confidence = confidenceLabel(t.match_reasons?.confidence);
              return (
                <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.match_reasons?.opportunityBucketLabel && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BUCKET_STYLES[t.match_reasons.opportunityBucket ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                            {t.match_reasons.opportunityBucketLabel}
                          </span>
                        )}
                        {confidence && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {confidence}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 text-sm font-semibold text-gray-900 line-clamp-2">
                        {t.tender_title}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        {t.tender_agency && <span>{t.tender_agency}</span>}
                        <span className={isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-600" : ""}>
                          {deadlineLabel(t.tender_deadline)}
                        </span>
                        {t.tender_value && <span>{t.tender_value}</span>}
                        {t.fit_score > 0 && <span>{t.fit_score}% fit</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-md bg-gray-50 px-3 py-2">
                    <div className="text-xs font-semibold text-gray-900">Why this matters</div>
                    <p className="mt-1 text-xs text-gray-600 line-clamp-3">
                      {t.match_reasons?.summary?.[0]
                        ?? t.match_reasons?.opportunityBucketReason
                        ?? "Tenderpath found sector, capability, or geography evidence that makes this worth a closer look."}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(t.match_reasons?.matchedSectors ?? []).slice(0, 3).map((sector) => (
                        <span key={sector} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          {sector}
                        </span>
                      ))}
                      {(t.match_reasons?.matchedKeywords ?? []).slice(0, 3).map((keyword) => (
                        <span key={keyword} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold text-gray-900">{action.label}</div>
                      <div className="text-[11px] text-gray-500">{action.detail}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={serviceHref("bid-no-bid", t)}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
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
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                    <Link href="/dashboard/pipeline" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      Track in pipeline
                    </Link>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleTenderFeedback(t, "saved")}
                        disabled={feedbackSavingId === t.id}
                        className="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => handleTenderFeedback(t, "not_relevant")}
                        disabled={feedbackSavingId === t.id}
                        className="text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        Not relevant
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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

      <div className="mt-6">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-gray-900">Service paths</h2>
          <p className="text-xs text-gray-500">
            Choose the product that matches the stage of the opportunity.
          </p>
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
