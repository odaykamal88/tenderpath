"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const BUCKET_DOT: Record<string, string> = {
  act_now: "bg-red-500",
  strong_fit: "bg-emerald-500",
  strategic: "bg-sky-500",
  adjacent: "bg-amber-500",
  watchlist: "bg-stone-300",
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
  return `${days}d left`;
}

function shortDate(deadline: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

// Fake-ish reference id from numeric pipeline id; the real schema doesn't have refs,
// so we synthesize a short hex code so the table reads as procurement-grade.
function tenderRef(id: number): string {
  const hex = id.toString(16).toUpperCase().padStart(4, "0");
  return `TP-${hex}`;
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
  display_value: string | null;
  fit_score: number;
  stage?: string;
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

// Big editorial readiness ring used in the page hero.
function HeroReadiness({ score, tier }: { score: number | null; tier: string | null }) {
  const display = score == null ? "—" : score;
  const verdict = score == null
    ? "Run an assessment"
    : score >= 70
    ? "Good foundation"
    : score >= 50
    ? "Needs attention"
    : "Critical gaps";

  return (
    <div className="flex flex-col">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        Readiness score
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="text-[112px] leading-none font-medium text-stone-900 tracking-tight"
          style={{ fontFamily: "'Fraunces', 'Times New Roman', serif", fontFeatureSettings: "'ss01'" }}
        >
          {display}
        </span>
        <span className="text-[28px] leading-none text-stone-400 font-light">/100</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-sm text-stone-600">{verdict}</span>
        {tier && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 border-l border-stone-300 pl-3">
            {tier}
          </span>
        )}
      </div>
    </div>
  );
}

// 5-stage horizontal funnel
function PipelineFunnel({ stats }: { stats: { matched: number; strong: number; active: number; submitted: number; won: number } | null }) {
  const stages = [
    { label: "Matched", value: stats?.matched ?? 0, sub: "in shortlist" },
    { label: "Strong fit", value: stats?.strong ?? 0, sub: "≥70% fit" },
    { label: "Active", value: stats?.active ?? 0, sub: "evaluating" },
    { label: "Submitted", value: stats?.submitted ?? 0, sub: "awaiting result" },
    { label: "Won", value: stats?.won ?? 0, sub: "this period" },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="grid grid-cols-5 gap-px bg-stone-200/70 rounded-md overflow-hidden">
      {stages.map((s, i) => (
        <div key={s.label} className="bg-stone-50/60 px-4 py-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-semibold text-stone-400 tabular-nums">0{i + 1}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{s.label}</span>
          </div>
          <div
            className="mt-2 text-[34px] leading-none font-medium text-stone-900 tabular-nums"
            style={{ fontFamily: "'Fraunces', 'Times New Roman', serif" }}
          >
            {stats == null ? "—" : s.value}
          </div>
          {/* tiny bar */}
          <div className="mt-2.5 h-[3px] w-full bg-stone-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-stone-900 rounded-full"
              style={{ width: stats == null ? "0%" : `${(s.value / max) * 100}%` }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-stone-500">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ index, title, count, hint }: { index: string; title: string; count?: number | null; hint?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 border-b border-stone-200/70 pb-3">
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400 tabular-nums">{index}</span>
        <h2
          className="text-[22px] leading-tight font-medium text-stone-900"
          style={{ fontFamily: "'Fraunces', 'Times New Roman', serif" }}
        >
          {title}
        </h2>
        {count != null && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            · {count} {count === 1 ? "item" : "items"}
          </span>
        )}
      </div>
      {hint && <span className="text-[11px] text-stone-500 hidden sm:block">{hint}</span>}
    </div>
  );
}

export default function DashboardOverview() {
  const [bridge, setBridge] = useState<BridgeData | null>(null);
  const [seeded, setSeeded] = useState(false);
  const autoSeedAttempted = useRef(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [pipelineStats, setPipelineStats] = useState<{
    total: number;
    active: number;
    won: number;
    matched: number;
    submitted: number;
    dueSoon: number;
    strong: number;
  } | null>(null);
  const [matchedTenders, setMatchedTenders] = useState<PipelineTender[]>([]);
  const [feedbackSavingId, setFeedbackSavingId] = useState<number | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [completedGapKeys, setCompletedGapKeys] = useState<Set<string>>(new Set());
  const [expandedTenderId, setExpandedTenderId] = useState<number | null>(null);
  const [expandedGapKey, setExpandedGapKey] = useState<string | null>(null);
  const [evaluatingItems, setEvaluatingItems] = useState<PipelineTender[]>([]);
  const [submittedItems, setSubmittedItems] = useState<PipelineTender[]>([]);
  const [wonItems, setWonItems] = useState<PipelineTender[]>([]);
  const [lostItems, setLostItems] = useState<PipelineTender[]>([]);
  const [stageSavingId, setStageSavingId] = useState<number | null>(null);
  const [activeOrderCount, setActiveOrderCount] = useState<number | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;
    fetch("/api/dashboard/work-orders?limit=50", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        const active = (body?.workOrders ?? []).filter(
          (o: { status: string }) => ["new", "in_progress", "waiting_on_client"].includes(o.status)
        ).length;
        setActiveOrderCount(active);
      })
      .catch((err) => {
        console.warn("[tp:dashboard:work-orders] fetch failed", err);
        setActiveOrderCount(0);
      });
  }, []);

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
          active: items.filter((i) => ["evaluating", "preparing"].includes(i.stage)).length,
          submitted: items.filter((i) => i.stage === "submitted").length,
          won: items.filter((i) => i.stage === "won").length,
          dueSoon: items.filter((i) => i.stage === "matched" && isDeadlineSoon(i.tender_deadline)).length,
          strong: items.filter((i) => i.stage === "matched" && (i.fit_score >= 70 || i.match_reasons?.opportunityBucket === "strong_fit" || i.match_reasons?.opportunityBucket === "act_now")).length,
        });
        const matched = items.filter(
          (i) => i.stage === "matched" && !(i.tender_id != null && dismissed.has(i.tender_id))
        ).sort((a, b) => priorityRank(a) - priorityRank(b) || b.fit_score - a.fit_score).slice(0, 6);
        setMatchedTenders(matched);
        setEvaluatingItems(items.filter((i) => i.stage === "evaluating" || i.stage === "preparing"));
        setSubmittedItems(items.filter((i) => i.stage === "submitted"));
        setWonItems(items.filter((i) => i.stage === "won"));
        setLostItems(items.filter((i) => i.stage === "lost"));
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
    const results = await Promise.allSettled(
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
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;
    if (failed > 0) {
      console.warn("[tp:pipeline:partial_seed]", {
        assessmentId: data.assessment_id,
        total: results.length,
        succeeded,
        failed,
      });
    }
    if (succeeded > 0) {
      localStorage.removeItem("tp_bridge");
      setSeeded(true);
      loadDashboard();
    } else {
      console.error("[tp:pipeline:seed_failed]", { assessmentId: data.assessment_id, tenderCount: data.matched_tenders.length });
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
    if (!pipelineStats || pipelineStats.total > 0 || seeded || autoSeedAttempted.current) return;
    autoSeedAttempted.current = true;
    (async () => {
      try {
        const res = await fetch("/api/assessment/latest-matches", { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json() as BridgeData | null;
        if (!data?.matched_tenders?.length) return;
        await seedPipeline(data);
      } catch {
        // non-critical — dashboard just stays empty
      }
    })();
  }, [pipelineStats, seeded, seedPipeline]);

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

  async function moveItemStage(id: number, newStage: string) {
    setStageSavingId(id);
    setEvaluatingItems((prev) => prev.filter((t) => t.id !== id));
    setSubmittedItems((prev) => prev.filter((t) => t.id !== id));
    setWonItems((prev) => prev.filter((t) => t.id !== id));
    setLostItems((prev) => prev.filter((t) => t.id !== id));
    const item = [...evaluatingItems, ...submittedItems, ...wonItems, ...lostItems].find((t) => t.id === id);
    if (item) {
      const updated = { ...item, stage: newStage };
      if (newStage === "evaluating" || newStage === "preparing") setEvaluatingItems((prev) => [...prev, updated]);
      else if (newStage === "submitted") setSubmittedItems((prev) => [...prev, updated]);
      else if (newStage === "won") setWonItems((prev) => [...prev, updated]);
      else if (newStage === "lost") setLostItems((prev) => [...prev, updated]);
    }
    try {
      await fetch(`/api/dashboard/pipeline/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ stage: newStage }),
      });
    } catch (err) {
      console.error("[tp:dashboard:stage_move_failed]", err);
    } finally {
      setStageSavingId(null);
    }
  }

  const companyName = readiness?.company_name ?? bridge?.company_name ?? "Dashboard";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const urgentCount = matchedTenders.filter((t) => isDeadlineSoon(t.tender_deadline)).length;
  const topGap = readiness?.action_plan?.find((a) => a.severity === "high" && !a.covered_by_vault);

  // ───────── Tender table row ─────────
  const renderTenderRow = (t: PipelineTender, opts: { showStage?: boolean } = {}) => {
    const isExpanded = expandedTenderId === t.id;
    const action = nextActionFor(t);
    const bucket = t.match_reasons?.opportunityBucket ?? "watchlist";
    const dotColor = BUCKET_DOT[bucket] ?? "bg-stone-300";

    return (
      <div key={t.id} className="border-b border-stone-200/70 last:border-b-0">
        <button
          className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-stone-50/80 transition-colors"
          onClick={() => setExpandedTenderId(isExpanded ? null : t.id)}
        >
          {/* Status dot */}
          <span className={`shrink-0 h-2 w-2 rounded-full ${dotColor}`} />

          {/* Ref id (mono) */}
          <span
            className="shrink-0 text-[11px] tracking-wider text-stone-400 hidden md:block"
            style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
          >
            {tenderRef(t.id)}
          </span>

          {/* Title + agency */}
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-[14px] leading-snug text-stone-900 line-clamp-1">
              {t.tender_title}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-stone-500">
              {t.tender_agency && <span className="truncate">{t.tender_agency}</span>}
              {procurementLabel(t) && (
                <>
                  <span className="text-stone-300">·</span>
                  <span>{procurementLabel(t)}</span>
                </>
              )}
              {opts.showStage && t.stage && (
                <>
                  <span className="text-stone-300">·</span>
                  <span className="uppercase tracking-wider text-[10px] font-semibold">{t.stage}</span>
                </>
              )}
            </span>
          </span>

          {/* Value */}
          <span
            className="shrink-0 text-[12px] text-stone-500 tabular-nums hidden lg:block w-[110px] text-right"
            style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
          >
            {t.display_value ?? (typeof t.match_reasons?.procurement?.estimatedValue === "string" ? t.match_reasons.procurement.estimatedValue : null) ?? "—"}
          </span>

          {/* Fit % */}
          <span
            className="shrink-0 text-[13px] font-medium tabular-nums w-[52px] text-right"
            style={{
              fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace",
              color: t.fit_score >= 70 ? "#0f766e" : t.fit_score >= 50 ? "#a16207" : "#78716c",
            }}
          >
            {t.fit_score > 0 ? `${t.fit_score}%` : "—"}
          </span>

          {/* Deadline */}
          <span
            className={`shrink-0 text-[12px] tabular-nums w-[80px] text-right ${
              isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-600" : "text-stone-500"
            }`}
            style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
          >
            {deadlineLabel(t.tender_deadline)}
          </span>

          {/* Caret */}
          <svg
            className={`shrink-0 h-3.5 w-3.5 text-stone-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isExpanded && (
          <div className="px-5 pb-5 pt-2 bg-stone-50/60 border-t border-stone-200/50">
            {/* Why matched */}
            <div className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500 mb-1.5">
                Why this matched
              </div>
              <p className="text-[13px] leading-relaxed text-stone-700 max-w-3xl">
                {t.match_reasons?.summary?.[0]
                  ?? t.match_reasons?.opportunityBucketReason
                  ?? "TenderPath found sector, capability, or geography evidence that makes this worth a closer look."}
              </p>
              {((t.match_reasons?.matchedSectors ?? []).length > 0 || (t.match_reasons?.matchedKeywords ?? []).length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {(t.match_reasons?.matchedSectors ?? []).slice(0, 3).map((s) => (
                    <span key={s} className="rounded-sm border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-medium text-stone-600">{s}</span>
                  ))}
                  {(t.match_reasons?.matchedKeywords ?? []).slice(0, 3).map((k) => (
                    <span key={k} className="rounded-sm border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-medium text-stone-600">{k}</span>
                  ))}
                </div>
              )}
              {(t.match_reasons?.caveats ?? []).length > 0 && (
                <p className="mt-2 text-[11px] text-amber-700">{t.match_reasons!.caveats![0]}</p>
              )}
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 py-3 border-y border-stone-200/70">
              {[
                { label: "Type", value: procurementLabel(t) ?? "Procurement notice" },
                { label: "Source", value: `${sourceLabel(t) ?? "Not listed"} · ${provenanceLabel(t)}` },
                { label: "Value", value: t.display_value ?? (typeof t.match_reasons?.procurement?.estimatedValue === "string" ? t.match_reasons.procurement.estimatedValue : null) ?? "Not listed" },
                { label: "Updated", value: dateLabel(t.match_reasons?.procurement?.updatedDate ?? t.tender_updated_at) ?? "Not listed" },
              ].map((d) => (
                <div key={d.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400 mb-0.5">{d.label}</div>
                  <div className="text-[12px] text-stone-800">{d.value}</div>
                </div>
              ))}
            </div>

            {/* Next action */}
            <div className="mt-3 mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500 mb-1">Next step</div>
              <div className="text-[14px] font-medium text-stone-900">{action.label}</div>
              <div className="text-[12px] text-stone-600 mt-0.5">{action.detail}</div>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={serviceHref("bid-no-bid", t)}
                className="rounded-sm bg-stone-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-stone-800"
              >
                Bid / no-bid
              </Link>
              <Link
                href={serviceHref("proposal", t)}
                className="rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-[12px] font-medium text-stone-700 hover:border-stone-500"
              >
                Proposal package
              </Link>
              {isRosterAgency(t.tender_agency) && (
                <Link
                  href={serviceHref("lta-roster", t)}
                  className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-800 hover:border-amber-400"
                >
                  Roster / LTA
                </Link>
              )}
              <div className="flex-1" />
              <button
                onClick={() => handleTenderFeedback(t, "saved")}
                disabled={feedbackSavingId === t.id}
                className="text-[11px] text-stone-500 hover:text-stone-900 disabled:opacity-50 underline-offset-2 hover:underline"
              >
                Save
              </button>
              <button
                onClick={() => handleTenderFeedback(t, "not_relevant")}
                disabled={feedbackSavingId === t.id}
                className="text-[11px] text-stone-400 hover:text-red-600 disabled:opacity-50 underline-offset-2 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Compact stage row for active/submitted/won/lost (no expand)
  const renderStageRow = (t: PipelineTender, options: Array<{ label: string; nextStage: string }>) => (
    <div key={t.id} className="border-b border-stone-200/70 last:border-b-0 px-5 py-3.5 flex items-center gap-4 hover:bg-stone-50/80 transition-colors">
      <span
        className="shrink-0 text-[11px] tracking-wider text-stone-400 hidden md:block"
        style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
      >
        {tenderRef(t.id)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] text-stone-900 truncate">{t.tender_title}</span>
        {t.tender_agency && <span className="text-[11px] text-stone-500">{t.tender_agency}</span>}
      </span>
      {t.tender_deadline && (
        <span
          className={`shrink-0 text-[11px] tabular-nums hidden sm:block ${isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-600" : "text-stone-500"}`}
          style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
        >
          {shortDate(t.tender_deadline)}
        </span>
      )}
      {t.fit_score > 0 && (
        <span
          className="shrink-0 text-[12px] font-medium text-stone-600 tabular-nums w-[44px] text-right"
          style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
        >
          {t.fit_score}%
        </span>
      )}
      <div className="flex items-center gap-1.5 shrink-0">
        {options.map((opt) => (
          <button
            key={opt.nextStage}
            onClick={() => moveItemStage(t.id, opt.nextStage)}
            disabled={stageSavingId === t.id}
            className="rounded-sm border border-stone-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-600 hover:border-stone-500 hover:text-stone-900 disabled:opacity-50"
          >
            → {opt.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="px-8 py-8 max-w-[1280px]">
      {/* ───── PAGE HEADER ───── */}
      <header className="flex flex-col gap-1.5 pb-2">
        <div className="flex items-center gap-3 text-[11px] text-stone-500">
          <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench</span>
          <span className="text-stone-300">·</span>
          <span>{today}</span>
        </div>
        <h1
          className="mt-1 text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
          style={{ fontFamily: "'Fraunces', 'Times New Roman', serif", fontFeatureSettings: "'ss01'" }}
        >
          {companyName}
        </h1>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
          {urgentCount > 0
            ? <>You have <span className="font-semibold text-stone-900">{urgentCount} deadline{urgentCount === 1 ? "" : "s"}</span> in the next 7 days. Below is what to look at first.</>
            : "Your matched tenders, readiness status, and active work — in priority order."}
        </p>
      </header>

      {/* Welcome banner — shown after fresh assessment seed */}
      {(bridge || seeded) && (
        <div className="mt-5 rounded-md border border-emerald-200/70 bg-emerald-50/60 px-5 py-3 flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] font-semibold text-emerald-900">
              Welcome{bridge?.company_name ? `, ${bridge.company_name}` : ""}.
            </div>
            <p className="text-[12px] text-emerald-800 mt-0.5">
              {seeded
                ? "Your matched tenders are ready below."
                : "Seeding your dashboard with matched tenders…"}
              {bridge?.gaps && bridge.gaps.length > 0 && " Upload documents to close your top compliance gaps."}
            </p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {workflowError && (
        <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-5 py-3 text-[13px] text-red-800">
          {workflowError}
        </div>
      )}

      {/* ───── 00 · READINESS HERO ───── */}
      <section className="mt-8">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,360px)_1fr] gap-8 xl:gap-10 items-start">
          {/* Left: big readiness number */}
          <div>
            <HeroReadiness score={readiness?.readiness_score ?? null} tier={readiness?.recommended_tier ?? null} />
            {!readiness && (
              <Link
                href="/assessment"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block text-[13px] font-semibold text-stone-900 underline underline-offset-4 decoration-stone-400 hover:decoration-stone-900"
              >
                Run an assessment →
              </Link>
            )}
          </div>

          {/* Right: pipeline funnel */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-3">
              This week's pipeline
            </div>
            <PipelineFunnel stats={pipelineStats} />
          </div>
        </div>
      </section>

      {/* ───── 01 · WHAT TO DO THIS WEEK ───── */}
      {(activeOrderCount != null || (readiness?.action_plan?.length ?? 0) > 0 || urgentCount > 0) && (
        <section className="mt-12">
          <SectionHeader index="01" title="This week" hint="Three things to act on" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-200/70 rounded-md overflow-hidden">
            {/* Active services */}
            <div className="bg-white px-5 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400 mb-1.5">Active services</div>
              {activeOrderCount == null ? (
                <div className="text-[13px] text-stone-400">Loading…</div>
              ) : activeOrderCount === 0 ? (
                <div className="text-[13px] text-stone-600 leading-relaxed">
                  No active work orders.{" "}
                  <Link href="/dashboard/services" className="underline underline-offset-2 text-stone-900">Start a service →</Link>
                </div>
              ) : (
                <div className="text-[13px] text-stone-800 leading-relaxed">
                  <span
                    className="text-[28px] leading-none font-medium text-stone-900 mr-1"
                    style={{ fontFamily: "'Fraunces', 'Times New Roman', serif" }}
                  >
                    {activeOrderCount}
                  </span>
                  order{activeOrderCount === 1 ? "" : "s"} in progress.{" "}
                  <Link href="/dashboard/work-orders" className="underline underline-offset-2 text-stone-900 block mt-1">View status →</Link>
                </div>
              )}
            </div>

            {/* Deadlines */}
            <div className="bg-white px-5 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400 mb-1.5">Deadlines this week</div>
              {(() => {
                const urgent = matchedTenders.filter((t) => isDeadlineSoon(t.tender_deadline));
                if (urgent.length === 0) return <div className="text-[13px] text-stone-500">Nothing in the next 7 days.</div>;
                return (
                  <ul className="space-y-1.5">
                    {urgent.slice(0, 3).map((t) => (
                      <li key={t.id} className="text-[12.5px] flex items-baseline gap-2">
                        <span
                          className="shrink-0 font-semibold text-red-600 tabular-nums w-7"
                          style={{ fontFamily: "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace" }}
                        >
                          {daysUntilDeadline(t.tender_deadline)}d
                        </span>
                        <Link href="/dashboard/pipeline" className="text-stone-700 hover:text-stone-900 underline-offset-2 hover:underline truncate">{t.tender_title}</Link>
                      </li>
                    ))}
                    {urgent.length > 3 && (
                      <li className="text-[11px] text-stone-500">+{urgent.length - 3} more</li>
                    )}
                  </ul>
                );
              })()}
            </div>

            {/* Top gap */}
            <div className="bg-white px-5 py-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400 mb-1.5">Top gap to close</div>
              {topGap ? (
                <div>
                  <div className="text-[13px] text-stone-900 font-medium leading-snug line-clamp-2">{topGap.gap}</div>
                  <Link
                    href={topGap.primary_action_href}
                    className="mt-2 inline-block text-[12px] underline underline-offset-2 text-stone-700 hover:text-stone-900"
                  >
                    {topGap.primary_action_label} →
                  </Link>
                </div>
              ) : (
                <div className="text-[13px] text-stone-500">
                  All critical gaps covered.{" "}
                  <Link href="/dashboard/vault" className="underline underline-offset-2 text-stone-900">View vault →</Link>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───── 02 · MATCHED TENDERS ───── */}
      {matchedTenders.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            index="02"
            title="Matched tenders"
            count={pipelineStats?.matched ?? null}
            hint="Click a row to see match evidence and next steps"
          />
          <div className="rounded-md border border-stone-200/70 bg-white">
            {/* Header strip */}
            <div className="hidden md:flex items-center gap-4 px-5 py-2.5 border-b border-stone-200/70 text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400">
              <span className="w-2" />
              <span className="w-[60px]">Ref</span>
              <span className="flex-1">Title / Agency</span>
              <span className="w-[110px] text-right hidden lg:block">Value</span>
              <span className="w-[52px] text-right">Fit</span>
              <span className="w-[80px] text-right">Deadline</span>
              <span className="w-3.5" />
            </div>
            {matchedTenders.map((t) => renderTenderRow(t))}
          </div>
          <p className="mt-3 text-[12px] text-stone-500">
            Tracking a tender we haven&apos;t picked up?{" "}
            <Link href="/dashboard/pipeline" className="underline underline-offset-2 text-stone-700 hover:text-stone-900">
              Add it to your pipeline →
            </Link>
          </p>
        </section>
      )}

      {/* Empty state */}
      {matchedTenders.length === 0 && (pipelineStats === null || pipelineStats.total === 0) && (
        <section className="mt-12">
          <div className="rounded-md border border-dashed border-stone-300 bg-white px-8 py-14 text-center">
            <div
              className="text-[26px] font-medium text-stone-900"
              style={{ fontFamily: "'Fraunces', 'Times New Roman', serif" }}
            >
              No matched tenders yet
            </div>
            <p className="mt-2 text-[14px] text-stone-600 max-w-md mx-auto">
              Run an assessment so we can find tenders and grants that match your company profile.
            </p>
            <Link
              href="/assessment"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-block rounded-sm bg-stone-900 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-stone-800"
            >
              Start assessment
            </Link>
          </div>
        </section>
      )}

      {/* ───── 03 · READINESS GAPS ───── */}
      {readiness && readiness.action_plan.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            index="03"
            title="Readiness gaps"
            count={readiness.action_plan.length}
            hint={`${readiness.vault_coverage.covered_gaps} of ${readiness.vault_coverage.total_gaps} covered by vault`}
          />
          <div className="rounded-md border border-stone-200/70 bg-white">
            {readiness.action_plan.map((action) => {
              const key = gapKey(action);
              const complete = action.covered_by_vault || completedGapKeys.has(key);
              const isOpen = expandedGapKey === key;
              const sevDot =
                action.severity === "high" ? "bg-red-500"
                : action.severity === "medium" ? "bg-amber-500"
                : "bg-stone-300";
              return (
                <div key={key} className="border-b border-stone-200/70 last:border-b-0">
                  <button
                    onClick={() => setExpandedGapKey(isOpen ? null : key)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-stone-50/80 transition-colors"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${sevDot}`} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-400 w-14 shrink-0">
                      {action.severity}
                    </span>
                    <span className={`flex-1 text-[14px] ${complete ? "line-through text-stone-400" : "text-stone-900"}`}>
                      {action.gap}
                    </span>
                    {complete && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 hidden sm:inline">
                        ✓ Covered
                      </span>
                    )}
                    <svg className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-5 pt-1 bg-stone-50/60 border-t border-stone-200/50 space-y-3">
                      <p className="text-[13px] leading-relaxed text-stone-700 max-w-3xl">{action.fix}</p>
                      {action.action_steps.length > 0 && (
                        <ol className="list-decimal list-inside space-y-1 text-[12px] text-stone-600 max-w-3xl">
                          {action.action_steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {action.primary_action_href && (
                          <Link
                            href={action.primary_action_href}
                            className="rounded-sm bg-stone-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-stone-800"
                          >
                            {action.primary_action_label || "Take action →"}
                          </Link>
                        )}
                        <button
                          onClick={() => toggleGapDone(action)}
                          className={`rounded-sm px-3 py-1.5 text-[12px] font-medium ${
                            complete
                              ? "text-emerald-700 bg-emerald-100 border border-emerald-200"
                              : "text-stone-700 bg-white border border-stone-300 hover:border-stone-500"
                          }`}
                        >
                          {complete ? "✓ Marked done" : "Mark as done"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ───── 04 · ACTIVE WORK ───── */}
      {evaluatingItems.length > 0 && (
        <section className="mt-12">
          <SectionHeader index="04" title="Active work" count={evaluatingItems.length} hint="Evaluating or preparing" />
          <div className="rounded-md border border-stone-200/70 bg-white">
            {evaluatingItems.map((t) =>
              renderStageRow(t, t.stage === "evaluating"
                ? [{ label: "Preparing", nextStage: "preparing" }, { label: "Submitted", nextStage: "submitted" }]
                : [{ label: "Submitted", nextStage: "submitted" }]
              )
            )}
          </div>
        </section>
      )}

      {/* ───── 05 · SUBMITTED ───── */}
      {submittedItems.length > 0 && (
        <section className="mt-12">
          <SectionHeader index="05" title="Submitted" count={submittedItems.length} hint="Awaiting outcome" />
          <div className="rounded-md border border-stone-200/70 bg-white">
            {submittedItems.map((t) =>
              renderStageRow(t, [
                { label: "Won", nextStage: "won" },
                { label: "Lost", nextStage: "lost" },
              ])
            )}
          </div>
        </section>
      )}

      {/* ───── 06 · WON ───── */}
      {wonItems.length > 0 && (
        <section className="mt-12">
          <SectionHeader index="06" title="Won" count={wonItems.length} />
          <div className="rounded-md border border-stone-200/70 bg-white">
            {wonItems.map((t) => renderStageRow(t, []))}
          </div>
        </section>
      )}

      {/* ───── 07 · LOST (collapsed by default — just count) ───── */}
      {lostItems.length > 0 && (
        <section className="mt-12 mb-8">
          <SectionHeader index="07" title="Lost" count={lostItems.length} hint="Archived" />
          <div className="rounded-md border border-stone-200/70 bg-white">
            {lostItems.map((t) => renderStageRow(t, []))}
          </div>
        </section>
      )}

      <div className="h-12" />
    </div>
  );
}
