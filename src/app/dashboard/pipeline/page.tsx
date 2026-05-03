"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";

type Stage = "matched" | "evaluating" | "preparing" | "submitted" | "won" | "lost";

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

const BUCKET_DOT: Record<string, string> = {
  act_now: "bg-red-500",
  strong_fit: "bg-emerald-500",
  strategic: "bg-sky-500",
  adjacent: "bg-amber-500",
  watchlist: "bg-stone-300",
};

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function isDeadlineSoon(deadline: string | null): boolean {
  if (!deadline) return false;
  const days = (new Date(deadline).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= 7;
}

function daysUntilDeadline(deadline: string | null): number | null {
  if (!deadline) return null;
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / 86_400_000);
}

function shortDate(deadline: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tenderRef(id: number): string {
  return `TP-${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

interface PipelineItem {
  id: number;
  tender_id: number | null;
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  display_value: string | null;
  fit_score: number;
  stage: Stage;
  position: number;
  notes: string | null;
  match_reasons: MatchReason | null;
  assessment_id: number | null;
}

const UN_AGENCIES = [
  "UNDP", "UNICEF", "WHO", "WFP", "UNHCR", "UNFPA", "UN Women",
  "UNOPS", "FAO", "ILO", "UNESCO", "UNODC", "UNGM", "World Bank",
  "IFC", "AfDB", "ADB", "EBRD",
];

const STAGES: { key: Stage; index: string; label: string; sub: string }[] = [
  { key: "matched", index: "01", label: "Matched", sub: "shortlist" },
  { key: "evaluating", index: "02", label: "Evaluating", sub: "fit check" },
  { key: "preparing", index: "03", label: "Preparing", sub: "drafting" },
  { key: "submitted", index: "04", label: "Submitted", sub: "awaiting" },
  { key: "won", index: "05", label: "Won", sub: "secured" },
  { key: "lost", index: "06", label: "Lost", sub: "archive" },
];

const STAGE_GUIDANCE: Record<Stage, { next: string; button?: string; moveTo?: Stage }> = {
  matched: { next: "Decide if this deserves pursuit.", button: "Start evaluating", moveTo: "evaluating" },
  evaluating: { next: "Run bid/no-bid and check blockers.", button: "Move to preparing", moveTo: "preparing" },
  preparing: { next: "Draft proposal, assemble docs, confirm compliance.", button: "Mark submitted", moveTo: "submitted" },
  submitted: { next: "Track outcome and keep follow-up notes current." },
  won: { next: "Capture evidence for past-performance proof." },
  lost: { next: "Archive the lesson and tune fit signals." },
};

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function isRosterAgency(agency: string | null): boolean {
  if (!agency) return false;
  return /\b(UNDP|UNICEF|WFP|UNHCR|UNOPS|IOM|ILO|FAO|WHO|UNFPA)\b/i.test(agency);
}

function serviceHref(
  service: "bid-no-bid" | "proposal" | "lta-roster",
  item: PipelineItem,
): string {
  const params = new URLSearchParams({
    pipeline_item_id: String(item.id),
    tender: item.tender_title,
  });
  if (item.tender_agency) params.set("agency", item.tender_agency);
  return `/dashboard/services/${service}?${params.toString()}`;
}

export default function PipelinePage() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [form, setForm] = useState({
    tender_title: "",
    tender_agency: "",
    tender_deadline: "",
    tender_value: "",
    fit_score: 0,
    source_url: "",
  });

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/pipeline", { headers: authHeaders() });
      if (res.ok) {
        const body = await res.json();
        setItems(body.items);
        setRefreshedAt(new Date());
      }
      setLoading(false);
    })();
  }, []);

  const byStage = useMemo(() => {
    const map: Record<Stage, PipelineItem[]> = {
      matched: [], evaluating: [], preparing: [], submitted: [], won: [], lost: [],
    };
    for (const it of items) map[it.stage].push(it);
    for (const k of Object.keys(map) as Stage[]) {
      map[k].sort((a, b) => a.position - b.position || a.id - b.id);
    }
    return map;
  }, [items]);

  // Totals for the headline strip
  const totals = useMemo(() => ({
    total: items.length,
    active: byStage.matched.length + byStage.evaluating.length + byStage.preparing.length,
    submitted: byStage.submitted.length,
    won: byStage.won.length,
    dueSoon: items.filter((i) => isDeadlineSoon(i.tender_deadline) && i.stage !== "won" && i.stage !== "lost").length,
  }), [items, byStage]);

  async function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    const id = Number(draggableId);
    const newStage = destination.droppableId as Stage;
    const newPosition = destination.index;

    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, stage: newStage, position: newPosition } : it
      )
    );

    await fetch(`/api/dashboard/pipeline/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ stage: newStage, position: newPosition }),
    });
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tender_title.trim()) return;
    const res = await fetch("/api/dashboard/pipeline", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        tender_title: form.tender_title,
        tender_agency: form.tender_agency || null,
        tender_deadline: form.tender_deadline || null,
        tender_value: form.tender_value || null,
        fit_score: Number(form.fit_score) || 0,
        stage: "matched",
        source_url: form.source_url || null,
      }),
    });
    if (res.ok) {
      const body = await res.json();
      setItems((prev) => [...prev, body.item]);
      setForm({ tender_title: "", tender_agency: "", tender_deadline: "", tender_value: "", fit_score: 0, source_url: "" });
      setAdding(false);
    }
  }

  async function remove(id: number) {
    await fetch(`/api/dashboard/pipeline/${id}`, { method: "DELETE", headers: authHeaders() });
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function moveStage(id: number, newStage: Stage) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, stage: newStage } : it))
    );
    await fetch(`/api/dashboard/pipeline/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ stage: newStage }),
    });
  }

  return (
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Sub-tab bar (kanban / applications / bid analysis) */}
      <div className="flex gap-6 mb-7 border-b border-stone-200/70">
        <Link
          href="/dashboard/pipeline"
          className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-900 border-b border-stone-900 -mb-px"
        >
          Kanban
        </Link>
        <Link
          href="/dashboard/applications"
          className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-400 hover:text-stone-700 transition-colors"
        >
          Applications
        </Link>
        <Link
          href="/dashboard/bid-analysis"
          className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-400 hover:text-stone-700 transition-colors"
        >
          Bid analysis
        </Link>
      </div>

      {/* Header */}
      <header className="flex items-end justify-between gap-6 mb-2">
        <div>
          <div className="flex items-center gap-3 text-[11px] text-stone-500">
            <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench</span>
            <span className="text-stone-300">·</span>
            <span style={{ fontFamily: MONO }}>
              {refreshedAt ? `Refreshed ${refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading…"}
            </span>
          </div>
          <h1
            className="mt-1 text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Pipeline
          </h1>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
            Drag tenders between stages. Use the buttons on each card to advance — or click <em>Why this match?</em> to see the evidence.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-medium text-white hover:bg-stone-800 transition-colors"
        >
          {adding ? "Cancel" : "+ Add tender"}
        </button>
      </header>

      {/* Headline numbers strip */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-px bg-stone-200/70 rounded-md overflow-hidden">
        {[
          { label: "Total", value: totals.total, sub: "all stages" },
          { label: "Active", value: totals.active, sub: "matched · prep" },
          { label: "Submitted", value: totals.submitted, sub: "awaiting" },
          { label: "Won", value: totals.won, sub: "this period" },
          { label: "Due soon", value: totals.dueSoon, sub: "≤ 7 days", urgent: totals.dueSoon > 0 },
        ].map((s) => (
          <div key={s.label} className="bg-stone-50/60 px-4 py-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500">{s.label}</div>
            <div
              className={`mt-1 text-[28px] leading-none font-medium tabular-nums ${s.urgent ? "text-red-600" : "text-stone-900"}`}
              style={{ fontFamily: SERIF }}
            >
              {loading ? "—" : s.value}
            </div>
            <div className="mt-1 text-[11px] text-stone-500">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {adding && (
        <form
          onSubmit={addItem}
          className="mt-6 rounded-md border border-stone-200/70 bg-white p-5"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-3">
            New tender · entered manually
          </div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <input
              className="md:col-span-3 rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
              placeholder="Tender title"
              value={form.tender_title}
              onChange={(e) => setForm({ ...form, tender_title: e.target.value })}
              required
            />
            <input
              className="md:col-span-3 rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
              placeholder="Source URL (optional)"
              type="url"
              value={form.source_url}
              onChange={(e) => setForm({ ...form, source_url: e.target.value })}
              style={{ fontFamily: MONO }}
            />
            <input
              className="md:col-span-2 rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
              placeholder="Agency (e.g. UNDP, WHO)"
              list="agency-suggestions"
              value={form.tender_agency}
              onChange={(e) => setForm({ ...form, tender_agency: e.target.value })}
            />
            <datalist id="agency-suggestions">
              {UN_AGENCIES.map((a) => <option key={a} value={a} />)}
            </datalist>
            <input
              type="date"
              className="rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
              value={form.tender_deadline}
              onChange={(e) => setForm({ ...form, tender_deadline: e.target.value })}
              style={{ fontFamily: MONO }}
            />
            <input
              className="rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
              placeholder="Est. value"
              value={form.tender_value}
              onChange={(e) => setForm({ ...form, tender_value: e.target.value })}
              style={{ fontFamily: MONO }}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-stone-700"
              placeholder="Fit %"
              value={form.fit_score}
              onChange={(e) => setForm({ ...form, fit_score: Number(e.target.value) })}
              style={{ fontFamily: MONO }}
            />
            <button
              type="submit"
              className="md:col-span-6 rounded-sm bg-stone-900 px-4 py-2.5 text-[12.5px] font-medium text-white hover:bg-stone-800 mt-1"
            >
              Add to Matched →
            </button>
          </div>
        </form>
      )}

      {/* Kanban grid */}
      {loading ? (
        <div className="mt-8 text-[13px] text-stone-500">Loading pipeline…</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="mt-7 overflow-x-auto pb-4 -mx-2 px-2">
            <div className="grid grid-cols-6 gap-4 min-w-[1180px]">
              {STAGES.map(({ key, index, label, sub }) => (
                <Droppable droppableId={key} key={key}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`rounded-md border min-h-[480px] flex flex-col transition-colors ${
                        snapshot.isDraggingOver
                          ? "bg-stone-100 border-stone-400"
                          : "bg-stone-50/40 border-stone-200/70"
                      }`}
                    >
                      {/* Column header */}
                      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-stone-200/70">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span
                              className="text-[10px] font-semibold tabular-nums text-stone-400"
                              style={{ fontFamily: MONO }}
                            >
                              {index}
                            </span>
                            <span
                              className="text-[15px] font-medium text-stone-900 truncate"
                              style={{ fontFamily: SERIF }}
                            >
                              {label}
                            </span>
                          </div>
                          <span
                            className="text-[11px] font-semibold tabular-nums text-stone-500"
                            style={{ fontFamily: MONO }}
                          >
                            {byStage[key].length.toString().padStart(2, "0")}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-stone-400 font-semibold">
                          {sub}
                        </div>
                        <div className="mt-1.5 text-[11px] leading-snug text-stone-500">
                          {STAGE_GUIDANCE[key].next}
                        </div>
                      </div>

                      {/* Cards */}
                      <div className="flex flex-col gap-2 p-2.5 flex-1">
                        {byStage[key].length === 0 && (
                          <div className="text-[11px] text-stone-400 italic px-2 py-3">
                            No tenders here yet.
                          </div>
                        )}
                        {byStage[key].map((item, idx) => {
                          const bucketDot = BUCKET_DOT[item.match_reasons?.opportunityBucket ?? "watchlist"] ?? "bg-stone-300";
                          const isExpanded = expandedId === item.id;
                          const days = daysUntilDeadline(item.tender_deadline);
                          return (
                            <Draggable
                              key={item.id}
                              draggableId={String(item.id)}
                              index={idx}
                            >
                              {(p, s) => (
                                <div
                                  ref={p.innerRef}
                                  {...p.draggableProps}
                                  {...p.dragHandleProps}
                                  className={`rounded-md bg-white border p-3 text-[13px] transition-shadow ${
                                    s.isDragging
                                      ? "border-stone-700 shadow-lg"
                                      : "border-stone-200/70 hover:border-stone-300"
                                  }`}
                                >
                                  {/* Top row: bucket dot + ref id + manual badge */}
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${bucketDot}`} />
                                    <span
                                      className="text-[10px] tracking-wider text-stone-400"
                                      style={{ fontFamily: MONO }}
                                    >
                                      {tenderRef(item.id)}
                                    </span>
                                    {!item.tender_id && (
                                      <span className="text-[9px] uppercase tracking-wider text-stone-400 border border-dashed border-stone-300 rounded-sm px-1.5 py-px">
                                        Manual
                                      </span>
                                    )}
                                    {item.match_reasons?.opportunityBucketLabel && (
                                      <span className="ml-auto text-[9px] uppercase tracking-wider font-semibold text-stone-500 truncate">
                                        {item.match_reasons.opportunityBucketLabel}
                                      </span>
                                    )}
                                  </div>

                                  {/* Title */}
                                  <div className="font-medium text-stone-900 leading-snug line-clamp-2 text-[13.5px]">
                                    {item.tender_title}
                                  </div>

                                  {/* Agency */}
                                  {item.tender_agency && (
                                    <div className="mt-1 text-[11.5px] text-stone-500 truncate">
                                      {item.tender_agency}
                                    </div>
                                  )}

                                  {/* Meta strip — deadline / value / fit */}
                                  <div
                                    className="mt-2.5 flex items-center justify-between gap-2 text-[11px] tabular-nums border-t border-stone-100 pt-2"
                                    style={{ fontFamily: MONO }}
                                  >
                                    <span className={isDeadlineSoon(item.tender_deadline) ? "font-semibold text-red-600" : "text-stone-500"}>
                                      {item.tender_deadline ? (
                                        <>
                                          {shortDate(item.tender_deadline)}
                                          {days != null && days >= 0 && (
                                            <span className="ml-1 text-stone-400">· {days}d</span>
                                          )}
                                          {days != null && days < 0 && (
                                            <span className="ml-1 text-stone-400">· expired</span>
                                          )}
                                        </>
                                      ) : "—"}
                                    </span>
                                    {item.display_value && (
                                      <span className="text-stone-500 truncate ml-2 flex-1 text-right">
                                        {item.display_value}
                                      </span>
                                    )}
                                    {item.fit_score > 0 && (
                                      <span
                                        className="font-semibold tabular-nums shrink-0"
                                        style={{ color: item.fit_score >= 70 ? "#0f766e" : item.fit_score >= 50 ? "#a16207" : "#78716c" }}
                                      >
                                        {item.fit_score}%
                                      </span>
                                    )}
                                  </div>

                                  {/* Why match toggle */}
                                  {item.match_reasons && (
                                    <div className="mt-2">
                                      <button
                                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                        className="text-[11px] text-stone-500 hover:text-stone-900 flex items-center gap-1 underline-offset-2 hover:underline"
                                      >
                                        <svg className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                        </svg>
                                        Why this match?
                                      </button>
                                      {isExpanded && (
                                        <div className="mt-2 rounded-sm bg-stone-50 border border-stone-200/70 p-2.5 text-[11px] leading-relaxed text-stone-700 space-y-1">
                                          {item.match_reasons.summary?.map((s, i) => (
                                            <div key={i}>· {s}</div>
                                          ))}
                                          {item.match_reasons.matchedSectors && item.match_reasons.matchedSectors.length > 0 && (
                                            <div className="text-stone-500">
                                              <span className="font-semibold uppercase tracking-wider text-[9px] text-stone-400">Sectors </span>
                                              {item.match_reasons.matchedSectors.join(", ")}
                                            </div>
                                          )}
                                          {item.match_reasons.matchedCapabilities && item.match_reasons.matchedCapabilities.length > 0 && (
                                            <div className="text-stone-500">
                                              <span className="font-semibold uppercase tracking-wider text-[9px] text-stone-400">Capabilities </span>
                                              {item.match_reasons.matchedCapabilities.join(", ")}
                                            </div>
                                          )}
                                          {item.match_reasons.matchedKeywords && item.match_reasons.matchedKeywords.length > 0 && (
                                            <div className="text-stone-500">
                                              <span className="font-semibold uppercase tracking-wider text-[9px] text-stone-400">Keywords </span>
                                              {item.match_reasons.matchedKeywords.join(", ")}
                                            </div>
                                          )}
                                          {item.match_reasons.geographyAlignment?.mode && item.match_reasons.geographyAlignment.mode !== "unknown" && (
                                            <div className="text-stone-500">
                                              <span className="font-semibold uppercase tracking-wider text-[9px] text-stone-400">Geography </span>
                                              {item.match_reasons.geographyAlignment.mode.replace(/-/g, " ")}
                                              {item.match_reasons.geographyAlignment.tenderCountry ? ` · ${item.match_reasons.geographyAlignment.tenderCountry}` : ""}
                                            </div>
                                          )}
                                          {item.match_reasons.opportunityBucketReason && (
                                            <div className="italic text-stone-500 pt-1">{item.match_reasons.opportunityBucketReason}</div>
                                          )}
                                          {item.match_reasons.confidence != null && (
                                            <div className="text-stone-500">
                                              <span className="font-semibold uppercase tracking-wider text-[9px] text-stone-400">Confidence </span>
                                              {Math.round(item.match_reasons.confidence * 100)}%
                                            </div>
                                          )}
                                          {item.match_reasons.caveats?.map((c, i) => (
                                            <div key={i} className="text-amber-700">⚠ {c}</div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Actions */}
                                  <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                                    {STAGE_GUIDANCE[item.stage].moveTo && (
                                      <button
                                        onClick={() => moveStage(item.id, STAGE_GUIDANCE[item.stage].moveTo!)}
                                        className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-700 border border-stone-300 rounded-sm px-2 py-1 bg-white hover:border-stone-700 hover:text-stone-900 transition-colors"
                                      >
                                        → {STAGE_GUIDANCE[item.stage].button}
                                      </button>
                                    )}
                                    <Link
                                      href={serviceHref("bid-no-bid", item)}
                                      title="Get win probability, criteria breakdown, and gap analysis ($39)"
                                      className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-700 border border-stone-300 rounded-sm px-2 py-1 bg-white hover:border-stone-700 hover:text-stone-900 transition-colors"
                                    >
                                      Bid analysis
                                    </Link>
                                    <Link
                                      href={serviceHref("proposal", item)}
                                      className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-700 border border-stone-300 rounded-sm px-2 py-1 bg-white hover:border-stone-700 hover:text-stone-900 transition-colors"
                                    >
                                      Proposal
                                    </Link>
                                    {isRosterAgency(item.tender_agency) && (
                                      <Link
                                        href={serviceHref("lta-roster", item)}
                                        className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-800 border border-amber-300 rounded-sm px-2 py-1 bg-amber-50 hover:border-amber-500 transition-colors"
                                      >
                                        Roster
                                      </Link>
                                    )}
                                    <div className="flex-1" />
                                    <button
                                      onClick={() => {
                                        if (confirm(`Remove "${item.tender_title}" from your pipeline?`)) {
                                          remove(item.id);
                                        }
                                      }}
                                      className="text-stone-400 hover:text-red-600 transition-colors p-0.5"
                                      title="Remove from pipeline"
                                    >
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    </div>
                  )}
                </Droppable>
              ))}
            </div>
          </div>
        </DragDropContext>
      )}
    </div>
  );
}
