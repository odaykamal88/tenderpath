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

// ──────────────────────────────────────────────────────────────────────
// Direction A — paper / serif / mono.
// Fraunces (serif) for display + numeric heroes.
// IBM Plex Mono for data, refs, deadlines.
// System sans for body + UI labels.
// Warm stone palette on a faintly off-white paper. Single accent: red for urgency.
// ──────────────────────────────────────────────────────────────────────

const SERIF = "var(--font-serif), 'Fraunces', 'Times New Roman', serif";
const MONO  = "var(--font-mono), 'JetBrains Mono', 'SF Mono', ui-monospace, monospace";

const BUCKET_DOT: Record<string, string> = {
  act_now: "bg-red-500",
  strong_fit: "bg-emerald-600",
  strategic: "bg-sky-600",
  adjacent: "bg-amber-500",
  watchlist: "bg-stone-300",
};

const BUCKET_LABEL: Record<string, string> = {
  act_now: "Act now",
  strong_fit: "Strong fit",
  strategic: "Strategic",
  adjacent: "Adjacent",
  watchlist: "Watchlist",
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

// Synthesized procurement-style reference id from numeric pipeline id.
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

// ──────────────────────────────────────────────────────────────────────
// Presentational sub-components
// ──────────────────────────────────────────────────────────────────────

// Section header — editorial table-of-contents feel.
function SectionHeader({
  index,
  title,
  count,
  hint,
  rightSlot,
}: {
  index: string;
  title: string;
  count?: number | null;
  hint?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="mb-4 sm:mb-5 flex items-end justify-between gap-3 sm:gap-6 border-b border-stone-300/70 pb-3">
      <div className="flex items-baseline gap-3 sm:gap-4 min-w-0">
        <span
          className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] sm:tracking-[0.22em] text-stone-400 tabular-nums"
          style={{ fontFamily: MONO }}
        >
          §&nbsp;{index}
        </span>
        <h2
          className="text-[20px] sm:text-[26px] leading-tight font-medium text-stone-900 tracking-tight truncate"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          {title}
        </h2>
        {count != null && (
          <span
            className="shrink-0 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-stone-400 tabular-nums"
            style={{ fontFamily: MONO }}
          >
            ({String(count).padStart(2, "0")})
          </span>
        )}
      </div>
      {rightSlot
        ? <div className="shrink-0">{rightSlot}</div>
        : hint && (
          <span className="shrink-0 text-[11px] text-stone-500 hidden sm:block">{hint}</span>
        )}
    </div>
  );
}

// Big editorial readiness ring/number.
function ReadinessHero({ score, tier }: { score: number | null; tier: string | null }) {
  const display = score == null ? "—" : score;
  const verdict = score == null
    ? "Run an assessment"
    : score >= 70
    ? "Good foundation"
    : score >= 50
    ? "Needs attention"
    : "Critical gaps";

  // Stroke for the arc indicator
  const radius = 64;
  const circ = 2 * Math.PI * radius;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circ;

  return (
    <div className="flex items-center gap-4 sm:gap-6">
      {/* SVG ring */}
      <div className="relative shrink-0 w-[112px] h-[112px] sm:w-[148px] sm:h-[148px]">
        <svg viewBox="0 0 148 148" className="block w-full h-full">
          <circle cx="74" cy="74" r={radius} fill="none" stroke="rgba(120,113,108,0.18)" strokeWidth="1.5" />
          <circle
            cx="74"
            cy="74"
            r={radius}
            fill="none"
            stroke={score == null ? "rgba(120,113,108,0.35)" : score >= 70 ? "#0f766e" : score >= 50 ? "#a16207" : "#b91c1c"}
            strokeWidth="2"
            strokeLinecap="butt"
            strokeDasharray={`${dash} ${circ}`}
            transform="rotate(-90 74 74)"
          />
          {/* tick marks every 10 */}
          {Array.from({ length: 10 }).map((_, i) => {
            const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const x1 = 74 + Math.cos(angle) * (radius + 6);
            const y1 = 74 + Math.sin(angle) * (radius + 6);
            const x2 = 74 + Math.cos(angle) * (radius + 10);
            const y2 = 74 + Math.sin(angle) * (radius + 10);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(120,113,108,0.4)" strokeWidth="1" />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-[34px] sm:text-[44px] leading-none font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            {display}
          </span>
          <span
            className="mt-0.5 text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            / 100
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          Readiness
        </div>
        <div
          className="mt-1 text-[18px] sm:text-[22px] leading-snug font-medium text-stone-900"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          {verdict}
        </div>
        {tier && (
          <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-stone-500" style={{ fontFamily: MONO }}>
            {tier}
          </div>
        )}
      </div>
    </div>
  );
}

// 5-stage horizontal funnel with editorial restraint.
function PipelineFunnel({
  stats,
}: {
  stats: { matched: number; strong: number; active: number; submitted: number; won: number } | null;
}) {
  const stages = [
    { label: "Matched", value: stats?.matched ?? 0, sub: "in shortlist" },
    { label: "Strong fit", value: stats?.strong ?? 0, sub: "≥ 70% fit" },
    { label: "Active", value: stats?.active ?? 0, sub: "evaluating" },
    { label: "Submitted", value: stats?.submitted ?? 0, sub: "awaiting" },
    { label: "Won", value: stats?.won ?? 0, sub: "this period" },
  ];
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="grid grid-cols-5 border-t border-b border-stone-300/70 divide-x divide-stone-200/80">
      {stages.map((s, i) => (
        <div key={s.label} className="px-2 sm:px-4 py-3 sm:py-4">
          <div className="flex items-baseline gap-1.5 sm:gap-2">
            <span
              className="text-[9px] sm:text-[10px] font-semibold text-stone-400 tabular-nums"
              style={{ fontFamily: MONO }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.14em] sm:tracking-[0.18em] text-stone-500 truncate">{s.label}</span>
          </div>
          <div
            className="mt-2 sm:mt-3 text-[26px] sm:text-[40px] leading-none font-medium text-stone-900 tabular-nums"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'tnum','ss01'" }}
          >
            {stats == null ? "—" : s.value}
          </div>
          <div className="mt-2 sm:mt-3 h-px w-full bg-stone-200">
            <div
              className="h-px bg-stone-900"
              style={{ width: stats == null ? "0%" : `${(s.value / max) * 100}%` }}
            />
          </div>
          <div className="mt-1.5 sm:mt-2 text-[11px] text-stone-500 hidden sm:block">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

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
  const issueDate = new Date().toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  const urgentCount = matchedTenders.filter((t) => isDeadlineSoon(t.tender_deadline)).length;
  const topGap = readiness?.action_plan?.find((a) => a.severity === "high" && !a.covered_by_vault);

  // ───────── Tender table row ─────────
  const renderTenderRow = (t: PipelineTender, opts: { showStage?: boolean } = {}) => {
    const isExpanded = expandedTenderId === t.id;
    const action = nextActionFor(t);
    const bucket = t.match_reasons?.opportunityBucket ?? "watchlist";
    const dotColor = BUCKET_DOT[bucket] ?? "bg-stone-300";
    const bucketLabel = t.match_reasons?.opportunityBucketLabel ?? BUCKET_LABEL[bucket] ?? null;
    const urgent = isDeadlineSoon(t.tender_deadline);

    return (
      <div key={t.id} className="border-b border-stone-200/80 last:border-b-0">
        <button
          className="w-full text-left px-4 sm:px-6 py-3.5 sm:py-4 flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-x-3 sm:gap-x-5 gap-y-2 hover:bg-stone-50 transition-colors group"
          onClick={() => setExpandedTenderId(isExpanded ? null : t.id)}
        >
          {/* Bucket dot */}
          <span className={`shrink-0 mt-2 sm:mt-0 h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden />

          {/* Title + agency */}
          <span className="flex-1 min-w-0 order-2 sm:order-none flex flex-col w-full sm:w-auto">
            <span className="flex items-baseline gap-2">
              <span
                className="shrink-0 text-[10px] tracking-[0.05em] text-stone-400 sm:hidden"
                style={{ fontFamily: MONO }}
              >
                {tenderRef(t.id)}
              </span>
              <span
                className="hidden md:block shrink-0 text-[11px] tracking-[0.05em] text-stone-400 w-[68px]"
                style={{ fontFamily: MONO }}
              >
                {tenderRef(t.id)}
              </span>
              <span
                className="text-[14.5px] sm:text-[15.5px] leading-snug text-stone-900 truncate"
                style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
              >
                {t.tender_title}
              </span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-stone-500">
              {t.tender_agency && <span className="truncate max-w-full">{t.tender_agency}</span>}
              {procurementLabel(t) && (
                <>
                  <span className="text-stone-300 hidden sm:inline">·</span>
                  <span className="truncate hidden sm:inline">{procurementLabel(t)}</span>
                </>
              )}
              {bucketLabel && (
                <>
                  <span className="text-stone-300">·</span>
                  <span className="uppercase tracking-[0.14em] text-[10px] font-semibold text-stone-500" style={{ fontFamily: MONO }}>
                    {bucketLabel}
                  </span>
                </>
              )}
              {opts.showStage && t.stage && (
                <>
                  <span className="text-stone-300">·</span>
                  <span className="uppercase tracking-[0.14em] text-[10px] font-semibold" style={{ fontFamily: MONO }}>{t.stage}</span>
                </>
              )}
            </span>
          </span>

          {/* Mobile-only: Fit + Deadline strip aligned right */}
          <span className="sm:hidden order-3 w-full flex items-center justify-between gap-3 pl-3.5 pt-1">
            <span
              className="text-[12px] font-medium tabular-nums"
              style={{
                fontFamily: MONO,
                color: t.fit_score >= 70 ? "#0f766e" : t.fit_score >= 50 ? "#a16207" : "#78716c",
              }}
            >
              {t.fit_score > 0 ? `${t.fit_score}% fit` : "— fit"}
            </span>
            <span
              className={`text-[11.5px] tabular-nums ${urgent ? "font-semibold text-red-700" : "text-stone-500"}`}
              style={{ fontFamily: MONO }}
            >
              {deadlineLabel(t.tender_deadline)}
            </span>
          </span>

          {/* Value (lg+ only) */}
          <span
            className="shrink-0 text-[12px] text-stone-500 tabular-nums hidden lg:block w-[120px] text-right"
            style={{ fontFamily: MONO }}
          >
            {t.display_value
              ?? (typeof t.match_reasons?.procurement?.estimatedValue === "string"
                ? t.match_reasons.procurement.estimatedValue
                : null)
              ?? "—"}
          </span>

          {/* Fit % (sm+) */}
          <span
            className="hidden sm:block shrink-0 text-[14px] font-medium tabular-nums w-[58px] text-right"
            style={{
              fontFamily: MONO,
              color: t.fit_score >= 70 ? "#0f766e" : t.fit_score >= 50 ? "#a16207" : "#78716c",
            }}
          >
            {t.fit_score > 0 ? `${t.fit_score}%` : "—"}
          </span>

          {/* Deadline (sm+) */}
          <span
            className={`hidden sm:block shrink-0 text-[12px] tabular-nums w-[90px] text-right ${
              urgent ? "font-semibold text-red-700" : "text-stone-500"
            }`}
            style={{ fontFamily: MONO }}
          >
            {deadlineLabel(t.tender_deadline)}
          </span>

          {/* Caret */}
          <svg
            className={`shrink-0 mt-1 sm:mt-0 h-3.5 w-3.5 text-stone-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isExpanded && (
          <div className="px-4 sm:px-6 pb-5 sm:pb-6 pt-3 bg-stone-50/70 border-t border-stone-200/70">
            {/* Why matched */}
            <div className="mb-4 max-w-3xl">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400 mb-1.5"
                style={{ fontFamily: MONO }}
              >
                Why this matched
              </div>
              <p
                className="text-[14.5px] leading-relaxed text-stone-800"
                style={{ fontFamily: SERIF }}
              >
                {t.match_reasons?.summary?.[0]
                  ?? t.match_reasons?.opportunityBucketReason
                  ?? "TenderPath found sector, capability, or geography evidence that makes this worth a closer look."}
              </p>
              {((t.match_reasons?.matchedSectors ?? []).length > 0 || (t.match_reasons?.matchedKeywords ?? []).length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-3">
                  {(t.match_reasons?.matchedSectors ?? []).slice(0, 3).map((s) => (
                    <span
                      key={s}
                      className="border border-stone-300/80 bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-stone-600"
                      style={{ fontFamily: MONO }}
                    >
                      {s}
                    </span>
                  ))}
                  {(t.match_reasons?.matchedKeywords ?? []).slice(0, 3).map((k) => (
                    <span
                      key={k}
                      className="border border-stone-300/80 bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-stone-600"
                      style={{ fontFamily: MONO }}
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
              {(t.match_reasons?.caveats ?? []).length > 0 && (
                <p className="mt-2 text-[11px] text-amber-800 italic">
                  Caveat — {t.match_reasons!.caveats![0]}
                </p>
              )}
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-3 py-4 border-y border-stone-300/70">
              {[
                { label: "Type", value: procurementLabel(t) ?? "Procurement notice" },
                { label: "Source", value: `${sourceLabel(t) ?? "Not listed"} · ${provenanceLabel(t)}` },
                {
                  label: "Value",
                  value: t.display_value
                    ?? (typeof t.match_reasons?.procurement?.estimatedValue === "string"
                      ? t.match_reasons.procurement.estimatedValue
                      : null)
                    ?? "Not listed",
                },
                { label: "Updated", value: dateLabel(t.match_reasons?.procurement?.updatedDate ?? t.tender_updated_at) ?? "Not listed" },
              ].map((d) => (
                <div key={d.label}>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-0.5"
                    style={{ fontFamily: MONO }}
                  >
                    {d.label}
                  </div>
                  <div className="text-[12.5px] text-stone-800">{d.value}</div>
                </div>
              ))}
            </div>

            {/* Next action */}
            <div className="mt-4 mb-4">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400 mb-1"
                style={{ fontFamily: MONO }}
              >
                Next step
              </div>
              <div
                className="text-[18px] font-medium text-stone-900 leading-snug"
                style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
              >
                {action.label}
              </div>
              <div className="text-[12.5px] text-stone-600 mt-1 max-w-2xl">{action.detail}</div>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={serviceHref("bid-no-bid", t)}
                className="bg-stone-900 px-3.5 py-2 text-[12px] font-medium text-white hover:bg-stone-700 transition-colors"
              >
                Bid / no-bid →
              </Link>
              <Link
                href={serviceHref("proposal", t)}
                className="border border-stone-400 bg-white px-3.5 py-2 text-[12px] font-medium text-stone-800 hover:border-stone-900 transition-colors"
              >
                Proposal package
              </Link>
              {isRosterAgency(t.tender_agency) && (
                <Link
                  href={serviceHref("lta-roster", t)}
                  className="border border-amber-400 bg-amber-50 px-3.5 py-2 text-[12px] font-medium text-amber-900 hover:border-amber-600 transition-colors"
                >
                  Roster / LTA
                </Link>
              )}
              <div className="flex-1" />
              <button
                onClick={() => handleTenderFeedback(t, "saved")}
                disabled={feedbackSavingId === t.id}
                className="text-[11px] text-stone-500 hover:text-stone-900 disabled:opacity-50 underline-offset-4 hover:underline"
              >
                Save
              </button>
              <button
                onClick={() => handleTenderFeedback(t, "not_relevant")}
                disabled={feedbackSavingId === t.id}
                className="text-[11px] text-stone-400 hover:text-red-700 disabled:opacity-50 underline-offset-4 hover:underline"
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
    <div key={t.id} className="border-b border-stone-200/80 last:border-b-0 px-4 sm:px-6 py-3 sm:py-3.5 flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-x-3 sm:gap-x-5 gap-y-2 hover:bg-stone-50 transition-colors">
      <span
        className="shrink-0 text-[11px] tracking-[0.05em] text-stone-400 hidden md:block w-[68px]"
        style={{ fontFamily: MONO }}
      >
        {tenderRef(t.id)}
      </span>
      <span className="flex-1 min-w-0 w-full sm:w-auto">
        <span
          className="block text-[14px] sm:text-[14.5px] text-stone-900 truncate"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          {t.tender_title}
        </span>
        {t.tender_agency && <span className="text-[11px] text-stone-500 truncate block">{t.tender_agency}</span>}
      </span>
      {t.tender_deadline && (
        <span
          className={`shrink-0 text-[11px] tabular-nums hidden sm:block w-[64px] text-right ${
            isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-700" : "text-stone-500"
          }`}
          style={{ fontFamily: MONO }}
        >
          {shortDate(t.tender_deadline)}
        </span>
      )}
      {t.fit_score > 0 && (
        <span
          className="shrink-0 text-[12px] font-medium text-stone-700 tabular-nums hidden sm:block w-[44px] text-right"
          style={{ fontFamily: MONO }}
        >
          {t.fit_score}%
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1.5 shrink-0 w-full sm:w-auto">
        {/* Mobile-only meta strip */}
        <span className="sm:hidden flex items-center gap-3 mr-auto text-[11px] tabular-nums" style={{ fontFamily: MONO }}>
          {t.fit_score > 0 && (
            <span className="text-stone-600 font-medium">{t.fit_score}%</span>
          )}
          {t.tender_deadline && (
            <span className={isDeadlineSoon(t.tender_deadline) ? "font-semibold text-red-700" : "text-stone-500"}>
              {shortDate(t.tender_deadline)}
            </span>
          )}
        </span>
        {options.map((opt) => (
          <button
            key={opt.nextStage}
            onClick={() => moveItemStage(t.id, opt.nextStage)}
            disabled={stageSavingId === t.id}
            className="border border-stone-300 bg-white px-2.5 py-1.5 sm:py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-600 hover:border-stone-700 hover:text-stone-900 disabled:opacity-50"
            style={{ fontFamily: MONO }}
          >
            → {opt.label}
          </button>
        ))}
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div
      className="px-4 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10 max-w-[1280px]"
      style={{
        backgroundColor: "var(--color-paper)",
        backgroundImage:
          "radial-gradient(rgba(26,26,26,0.05) 1px, transparent 1px)",
        backgroundSize: "3px 3px",
        minHeight: "100vh",
      }}
    >
      {/* ───── MASTHEAD ─────
          Newspaper-style: small kicker rule, dateline, then giant serif company name.
      */}
      <header className="border-b border-stone-900/80 pb-5">
        <div
          className="flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500"
          style={{ fontFamily: MONO }}
        >
          <span className="flex items-center gap-3">
            <span className="text-stone-900">Tenderpath</span>
            <span className="text-stone-300">·</span>
            <span>The Workbench</span>
          </span>
          <span className="hidden sm:flex items-center gap-3">
            <span>Vol.&nbsp;01</span>
            <span className="text-stone-300">·</span>
            <span>{issueDate}</span>
          </span>
        </div>
        <div className="mt-1 h-px bg-stone-300/80" />
        <h1
          className="mt-4 sm:mt-5 text-[40px] sm:text-[54px] lg:text-[68px] leading-[0.96] font-medium text-stone-900 tracking-[-0.015em] break-words"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          {companyName}
        </h1>
        <div className="mt-3 flex items-baseline justify-between gap-6">
          <p
            className="max-w-2xl text-[14px] sm:text-[16px] leading-relaxed text-stone-700"
            style={{ fontFamily: SERIF }}
          >
            {urgentCount > 0 ? (
              <>
                <span className="text-stone-400 mr-1">—</span>
                You have{" "}
                <span className="font-semibold text-red-800">
                  {urgentCount} deadline{urgentCount === 1 ? "" : "s"}
                </span>{" "}
                in the next seven days. The dispatch below leads with what to act on first.
              </>
            ) : (
              <>
                <span className="text-stone-400 mr-1">—</span>
                Today&apos;s dispatch: matched tenders, readiness status, and active work, in priority order.
              </>
            )}
          </p>
          <span
            className="hidden md:block shrink-0 text-[10px] uppercase tracking-[0.22em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            {today}
          </span>
        </div>
      </header>

      {/* Welcome banner — shown after fresh assessment seed */}
      {(bridge || seeded) && (
        <div className="mt-6 border-l-2 border-emerald-700 bg-emerald-50/50 px-5 py-3 flex items-start justify-between gap-4">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-800"
              style={{ fontFamily: MONO }}
            >
              Bulletin
            </div>
            <div className="mt-1 text-[14px] text-emerald-950" style={{ fontFamily: SERIF }}>
              Welcome{bridge?.company_name ? `, ${bridge.company_name}` : ""}.{" "}
              {seeded
                ? "Your matched tenders are ready below."
                : "Seeding your dashboard with matched tenders…"}
              {bridge?.gaps && bridge.gaps.length > 0 && " Upload documents to close your top compliance gaps."}
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {workflowError && (
        <div className="mt-6 border-l-2 border-red-700 bg-red-50/60 px-5 py-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-red-800"
            style={{ fontFamily: MONO }}
          >
            Notice
          </div>
          <div className="mt-1 text-[14px] text-red-950" style={{ fontFamily: SERIF }}>
            {workflowError}
          </div>
        </div>
      )}

      {/* ───── §00 · STATE OF READINESS ─────
          Two-column hero: readiness ring + pipeline funnel.
      */}
      <section className="mt-8 sm:mt-10">
        <div className="flex items-baseline justify-between gap-4 mb-4 sm:mb-6">
          <div className="flex items-baseline gap-3 sm:gap-4">
            <span
              className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] sm:tracking-[0.22em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              §&nbsp;00
            </span>
            <h2
              className="text-[12px] sm:text-[15px] font-semibold uppercase tracking-[0.18em] sm:tracking-[0.22em] text-stone-700"
              style={{ fontFamily: MONO }}
            >
              State of the Pipeline
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_1fr] gap-8 xl:gap-10 items-start">
          {/* Left: readiness */}
          <div className="border-r-0 xl:border-r xl:pr-10 xl:border-stone-300/70">
            <ReadinessHero score={readiness?.readiness_score ?? null} tier={readiness?.recommended_tier ?? null} />
            {!readiness ? (
              <Link
                href="/assessment"
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-block text-[13px] font-semibold text-stone-900 underline underline-offset-4 decoration-stone-400 hover:decoration-stone-900"
                style={{ fontFamily: SERIF }}
              >
                Run an assessment →
              </Link>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-4 border-t border-stone-200 pt-4">
                {[
                  { label: "Gaps", value: readiness.gap_count },
                  { label: "Covered", value: readiness.vault_coverage.covered_gaps },
                  { label: "Matches", value: readiness.matched_tenders_count },
                ].map((s) => (
                  <div key={s.label}>
                    <div
                      className="text-[9px] font-semibold uppercase tracking-[0.2em] text-stone-400"
                      style={{ fontFamily: MONO }}
                    >
                      {s.label}
                    </div>
                    <div
                      className="mt-1 text-[24px] leading-none font-medium text-stone-900 tabular-nums"
                      style={{ fontFamily: SERIF, fontFeatureSettings: "'tnum'" }}
                    >
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: pipeline funnel */}
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 mb-3"
              style={{ fontFamily: MONO }}
            >
              This week&apos;s pipeline
            </div>
            <PipelineFunnel stats={pipelineStats} />
          </div>
        </div>
      </section>

      {/* ───── §01 · WHAT TO DO THIS WEEK ───── */}
      {(activeOrderCount != null || (readiness?.action_plan?.length ?? 0) > 0 || urgentCount > 0) && (
        <section className="mt-10 sm:mt-14">
          <SectionHeader index="01" title="This week" hint="Three things to act on" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-stone-200/80 border border-stone-200/80">
            {/* Active services */}
            <div className="bg-white px-5 py-5">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2"
                style={{ fontFamily: MONO }}
              >
                Active services
              </div>
              {activeOrderCount == null ? (
                <div className="text-[13px] text-stone-400">Loading…</div>
              ) : activeOrderCount === 0 ? (
                <div className="text-[14px] text-stone-700 leading-relaxed" style={{ fontFamily: SERIF }}>
                  No active work orders.{" "}
                  <Link href="/dashboard/services" className="underline underline-offset-4 text-stone-900">
                    Start a service →
                  </Link>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="text-[44px] leading-none font-medium text-stone-900 tabular-nums"
                      style={{ fontFamily: SERIF, fontFeatureSettings: "'tnum'" }}
                    >
                      {activeOrderCount}
                    </span>
                    <span className="text-[12px] text-stone-500" style={{ fontFamily: SERIF }}>
                      order{activeOrderCount === 1 ? "" : "s"} in progress
                    </span>
                  </div>
                  <Link
                    href="/dashboard/work-orders"
                    className="mt-3 inline-block text-[12px] underline underline-offset-4 text-stone-700 hover:text-stone-900"
                  >
                    View status →
                  </Link>
                </div>
              )}
            </div>

            {/* Deadlines */}
            <div className="bg-white px-5 py-5">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2"
                style={{ fontFamily: MONO }}
              >
                Deadlines this week
              </div>
              {(() => {
                const urgent = matchedTenders.filter((t) => isDeadlineSoon(t.tender_deadline));
                if (urgent.length === 0) {
                  return (
                    <div className="text-[14px] text-stone-500" style={{ fontFamily: SERIF }}>
                      Nothing in the next seven days.
                    </div>
                  );
                }
                return (
                  <ul className="space-y-2">
                    {urgent.slice(0, 3).map((t) => (
                      <li key={t.id} className="text-[13px] flex items-baseline gap-2.5">
                        <span
                          className="shrink-0 font-semibold text-red-700 tabular-nums w-7"
                          style={{ fontFamily: MONO }}
                        >
                          {daysUntilDeadline(t.tender_deadline)}d
                        </span>
                        <Link
                          href="/dashboard/pipeline"
                          className="text-stone-800 hover:text-stone-900 underline-offset-4 hover:underline truncate"
                          style={{ fontFamily: SERIF }}
                        >
                          {t.tender_title}
                        </Link>
                      </li>
                    ))}
                    {urgent.length > 3 && (
                      <li className="text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
                        + {urgent.length - 3} more
                      </li>
                    )}
                  </ul>
                );
              })()}
            </div>

            {/* Top gap */}
            <div className="bg-white px-5 py-5">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2"
                style={{ fontFamily: MONO }}
              >
                Top gap to close
              </div>
              {topGap ? (
                <div>
                  <div
                    className="text-[14px] text-stone-900 leading-snug line-clamp-2"
                    style={{ fontFamily: SERIF }}
                  >
                    {topGap.gap}
                  </div>
                  <Link
                    href={topGap.primary_action_href}
                    className="mt-3 inline-block text-[12px] underline underline-offset-4 text-stone-700 hover:text-stone-900"
                  >
                    {topGap.primary_action_label} →
                  </Link>
                </div>
              ) : (
                <div className="text-[14px] text-stone-500" style={{ fontFamily: SERIF }}>
                  All critical gaps covered.{" "}
                  <Link href="/dashboard/vault" className="underline underline-offset-4 text-stone-900">
                    View vault →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───── §02 · MATCHED TENDERS ───── */}
      {matchedTenders.length > 0 && (
        <section className="mt-10 sm:mt-14">
          <SectionHeader
            index="02"
            title="Matched tenders"
            count={pipelineStats?.matched ?? null}
            hint="Click a row to see match evidence and next steps"
          />
          <div className="border border-stone-300/70 bg-white">
            {/* Header strip */}
            <div
              className="hidden md:flex items-center gap-5 px-6 py-2.5 border-b border-stone-300/70 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              <span className="w-1.5" />
              <span className="w-[68px]">Ref</span>
              <span className="flex-1">Title / Agency</span>
              <span className="w-[120px] text-right hidden lg:block">Value</span>
              <span className="w-[58px] text-right">Fit</span>
              <span className="w-[90px] text-right">Deadline</span>
              <span className="w-3.5" />
            </div>
            {matchedTenders.map((t) => renderTenderRow(t))}
          </div>
          <p className="mt-3 text-[12px] text-stone-500" style={{ fontFamily: SERIF }}>
            Tracking a tender we haven&apos;t picked up?{" "}
            <Link href="/dashboard/pipeline" className="underline underline-offset-4 text-stone-700 hover:text-stone-900">
              Add it to your pipeline →
            </Link>
          </p>
        </section>
      )}

      {/* Empty state */}
      {matchedTenders.length === 0 && (pipelineStats === null || pipelineStats.total === 0) && (
        <section className="mt-14">
          <div className="border border-dashed border-stone-300 bg-white/60 px-8 py-16 text-center">
            <div
              className="text-[10px] uppercase tracking-[0.22em] text-stone-400 mb-3"
              style={{ fontFamily: MONO }}
            >
              No dispatch yet
            </div>
            <div
              className="text-[32px] font-medium text-stone-900 leading-tight"
              style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
            >
              No matched tenders yet
            </div>
            <p
              className="mt-3 text-[15px] text-stone-600 max-w-md mx-auto leading-relaxed"
              style={{ fontFamily: SERIF }}
            >
              Run an assessment so we can find tenders and grants that match your company profile.
            </p>
            <Link
              href="/assessment"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block bg-stone-900 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-stone-700 transition-colors"
            >
              Start assessment
            </Link>
          </div>
        </section>
      )}

      {/* ───── §03 · READINESS GAPS ───── */}
      {readiness && readiness.action_plan.length > 0 && (
        <section className="mt-10 sm:mt-14">
          <SectionHeader
            index="03"
            title="Readiness gaps"
            count={readiness.action_plan.length}
            hint={`${readiness.vault_coverage.covered_gaps} of ${readiness.vault_coverage.total_gaps} covered by vault`}
          />
          <div className="border border-stone-300/70 bg-white">
            {readiness.action_plan.map((action) => {
              const key = gapKey(action);
              const complete = action.covered_by_vault || completedGapKeys.has(key);
              const isOpen = expandedGapKey === key;
              const sevDot =
                action.severity === "high" ? "bg-red-600"
                : action.severity === "medium" ? "bg-amber-500"
                : "bg-stone-300";
              return (
                <div key={key} className="border-b border-stone-200/80 last:border-b-0">
                  <button
                    onClick={() => setExpandedGapKey(isOpen ? null : key)}
                    className="w-full flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3.5 sm:py-4 text-left hover:bg-stone-50 transition-colors"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sevDot}`} />
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-stone-400 w-12 sm:w-16 shrink-0"
                      style={{ fontFamily: MONO }}
                    >
                      {action.severity}
                    </span>
                    <span
                      className={`flex-1 text-[14px] sm:text-[15px] leading-snug ${complete ? "line-through text-stone-400" : "text-stone-900"}`}
                      style={{ fontFamily: SERIF }}
                    >
                      {action.gap}
                    </span>
                    {complete && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 hidden sm:inline"
                        style={{ fontFamily: MONO }}
                      >
                        ✓ Covered
                      </span>
                    )}
                    <svg
                      className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="px-4 sm:px-6 pb-5 pt-2 bg-stone-50/70 border-t border-stone-200/70 space-y-3">
                      <p
                        className="text-[14px] leading-relaxed text-stone-800 max-w-3xl"
                        style={{ fontFamily: SERIF }}
                      >
                        {action.fix}
                      </p>
                      {action.action_steps.length > 0 && (
                        <ol
                          className="list-decimal list-inside space-y-1 text-[12.5px] text-stone-600 max-w-3xl marker:text-stone-400"
                          style={{ fontFamily: SERIF }}
                        >
                          {action.action_steps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        {action.primary_action_href && (
                          <Link
                            href={action.primary_action_href}
                            className="bg-stone-900 px-3.5 py-2 text-[12px] font-medium text-white hover:bg-stone-700 transition-colors"
                          >
                            {action.primary_action_label || "Take action →"}
                          </Link>
                        )}
                        <button
                          onClick={() => toggleGapDone(action)}
                          className={`px-3.5 py-2 text-[12px] font-medium border ${
                            complete
                              ? "text-emerald-800 bg-emerald-50 border-emerald-300"
                              : "text-stone-700 bg-white border-stone-400 hover:border-stone-900"
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

      {/* ───── §04 · ACTIVE WORK ───── */}
      {evaluatingItems.length > 0 && (
        <section className="mt-10 sm:mt-14">
          <SectionHeader index="04" title="Active work" count={evaluatingItems.length} hint="Evaluating or preparing" />
          <div className="border border-stone-300/70 bg-white">
            {evaluatingItems.map((t) =>
              renderStageRow(t, t.stage === "evaluating"
                ? [{ label: "Preparing", nextStage: "preparing" }, { label: "Submitted", nextStage: "submitted" }]
                : [{ label: "Submitted", nextStage: "submitted" }]
              )
            )}
          </div>
        </section>
      )}

      {/* ───── §05 · SUBMITTED ───── */}
      {submittedItems.length > 0 && (
        <section className="mt-10 sm:mt-14">
          <SectionHeader index="05" title="Submitted" count={submittedItems.length} hint="Awaiting outcome" />
          <div className="border border-stone-300/70 bg-white">
            {submittedItems.map((t) =>
              renderStageRow(t, [
                { label: "Won", nextStage: "won" },
                { label: "Lost", nextStage: "lost" },
              ])
            )}
          </div>
        </section>
      )}

      {/* ───── §06 · WON ───── */}
      {wonItems.length > 0 && (
        <section className="mt-10 sm:mt-14">
          <SectionHeader index="06" title="Won" count={wonItems.length} />
          <div className="border border-stone-300/70 bg-white">
            {wonItems.map((t) => renderStageRow(t, []))}
          </div>
        </section>
      )}

      {/* ───── §07 · LOST ───── */}
      {lostItems.length > 0 && (
        <section className="mt-10 sm:mt-14 mb-10">
          <SectionHeader index="07" title="Lost" count={lostItems.length} hint="Archived" />
          <div className="border border-stone-300/70 bg-white">
            {lostItems.map((t) => renderStageRow(t, []))}
          </div>
        </section>
      )}

      {/* Colophon */}
      <footer className="mt-16 pt-6 border-t border-stone-300/70 flex items-baseline justify-between text-[10px] uppercase tracking-[0.22em] text-stone-400" style={{ fontFamily: MONO }}>
        <span>End of dispatch</span>
        <span>Tenderpath · {issueDate}</span>
      </footer>

      <div className="h-12" />
    </div>
  );
}
