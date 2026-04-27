"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

const BUCKET_STYLES: Record<string, string> = {
  act_now: "bg-red-100 text-red-800 border-red-200",
  strong_fit: "bg-green-100 text-green-700 border-green-200",
  strategic: "bg-blue-100 text-blue-700 border-blue-200",
  adjacent: "bg-amber-100 text-amber-700 border-amber-200",
  watchlist: "bg-gray-100 text-gray-600 border-gray-200",
};

function isDeadlineSoon(deadline: string | null): boolean {
  if (!deadline) return false;
  const days = (new Date(deadline).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= 7;
}

interface PipelineItem {
  id: number;
  tender_id: number | null;
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
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

const STAGES: { key: Stage; label: string }[] = [
  { key: "matched", label: "Matched" },
  { key: "evaluating", label: "Evaluating" },
  { key: "preparing", label: "Preparing" },
  { key: "submitted", label: "Submitted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

const STAGE_GUIDANCE: Record<Stage, { next: string; button?: string; moveTo?: Stage }> = {
  matched: {
    next: "Decide if this deserves pursuit.",
    button: "Start Evaluating",
    moveTo: "evaluating",
  },
  evaluating: {
    next: "Run bid/no-bid, check blockers, then prepare.",
    button: "Move to Preparing",
    moveTo: "preparing",
  },
  preparing: {
    next: "Draft proposal, assemble docs, and confirm compliance.",
    button: "Mark Submitted",
    moveTo: "submitted",
  },
  submitted: {
    next: "Track outcome and keep follow-up notes current.",
  },
  won: {
    next: "Capture evidence for future past-performance proof.",
  },
  lost: {
    next: "Archive the lesson and tune future fit signals.",
  },
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

function payHref(
  plan: "proposal-draft" | "roster-fast-track",
  item: PipelineItem,
): string {
  const params = new URLSearchParams({
    plan,
    pipeline_item_id: String(item.id),
    tender: item.tender_title,
  });
  if (item.tender_agency) params.set("agency", item.tender_agency);
  return `/pay?${params.toString()}`;
}

export default function PipelinePage() {
  const router = useRouter();
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [analysingId, setAnalysingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({
    tender_title: "",
    tender_agency: "",
    tender_deadline: "",
    tender_value: "",
    fit_score: 0,
  });

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard/pipeline", { headers: authHeaders() });
      if (res.ok) {
        const body = await res.json();
        setItems(body.items);
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
      }),
    });
    if (res.ok) {
      const body = await res.json();
      setItems((prev) => [...prev, body.item]);
      setForm({ tender_title: "", tender_agency: "", tender_deadline: "", tender_value: "", fit_score: 0 });
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

  async function handleAnalyse(item: PipelineItem) {
    setAnalysingId(item.id);
    try {
      // Check if analysis already exists
      const checkRes = await fetch(
        `/api/analysis/bid-no-bid?pipeline_item_id=${item.id}`,
        { headers: authHeaders() }
      );
      if (checkRes.ok) {
        router.push(`/dashboard/analysis/${item.id}`);
        return;
      }

      // No existing analysis — start Stripe checkout
      const checkoutRes = await fetch("/api/analysis/bid-no-bid/checkout", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          pipeline_item_id: item.id,
          tender_title: item.tender_title,
        }),
      });

      if (!checkoutRes.ok) {
        alert("Could not start checkout. Please try again.");
        return;
      }

      const { url } = await checkoutRes.json();
      if (url) window.location.href = url;
    } finally {
      setAnalysingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-600">Drag tenders between stages.</p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700"
        >
          {adding ? "Cancel" : "+ Add Tender"}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={addItem}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3"
        >
          <input
            className="border rounded px-2 py-1 text-sm md:col-span-2"
            placeholder="Tender title"
            value={form.tender_title}
            onChange={(e) => setForm({ ...form, tender_title: e.target.value })}
            required
          />
          <input
            className="border rounded px-2 py-1 text-sm"
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
            className="border rounded px-2 py-1 text-sm"
            value={form.tender_deadline}
            onChange={(e) => setForm({ ...form, tender_deadline: e.target.value })}
          />
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="Est. value"
            value={form.tender_value}
            onChange={(e) => setForm({ ...form, tender_value: e.target.value })}
          />
          <input
            type="number"
            min={0}
            max={100}
            className="border rounded px-2 py-1 text-sm"
            placeholder="Fit %"
            value={form.fit_score}
            onChange={(e) => setForm({ ...form, fit_score: Number(e.target.value) })}
          />
          <button
            type="submit"
            className="md:col-span-5 px-4 py-2 bg-gray-900 text-white text-sm rounded"
          >
            Add to Matched
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="overflow-x-auto pb-4">
          <div className="grid grid-cols-6 gap-4 min-w-[900px]">
            {STAGES.map(({ key, label }) => (
              <Droppable droppableId={key} key={key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-lg border p-3 min-h-[400px] ${
                      snapshot.isDraggingOver
                        ? "bg-gray-100 border-gray-400"
                        : key === "won"
                        ? "bg-green-50 border-green-200"
                        : key === "lost"
                        ? "bg-red-50/50 border-red-100"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                          {label}
                        </div>
                        <div className="mt-0.5 text-[11px] normal-case tracking-normal text-gray-400">
                          {STAGE_GUIDANCE[key].next}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        {byStage[key].length}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {byStage[key].map((item, idx) => (
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
                              className={`rounded-md border bg-white p-3 text-sm shadow-sm ${
                                s.isDragging ? "ring-2 ring-gray-900" : "border-gray-200"
                              }`}
                            >
                              <div className="flex items-start gap-2 justify-between">
                                <div className="font-medium text-gray-900 line-clamp-2 flex-1">
                                  {item.tender_title}
                                </div>
                                {item.match_reasons?.opportunityBucketLabel && (
                                  <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${BUCKET_STYLES[item.match_reasons.opportunityBucket ?? ""] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                                    {item.match_reasons.opportunityBucketLabel}
                                  </span>
                                )}
                              </div>
                              {item.tender_agency && (
                                <div className="mt-1 text-xs text-gray-600">
                                  {item.tender_agency}
                                </div>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                                {item.tender_deadline && (
                                  <span className={isDeadlineSoon(item.tender_deadline) ? "font-semibold text-red-600" : ""}>
                                    {isDeadlineSoon(item.tender_deadline) ? "⚡ Due " : "Due "}
                                    {new Date(item.tender_deadline).toLocaleDateString()}
                                  </span>
                                )}
                                {item.tender_value && <span>{item.tender_value}</span>}
                                {item.fit_score > 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                    {item.fit_score}% fit
                                  </span>
                                )}
                              </div>

                              {/* Why this match? expandable panel */}
                              {item.match_reasons && (
                                <div className="mt-2">
                                  <button
                                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                  >
                                    <svg className={`h-3 w-3 transition-transform ${expandedId === item.id ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                    Why this match?
                                  </button>
                                  {expandedId === item.id && (
                                    <div className="mt-2 rounded bg-indigo-50 border border-indigo-100 p-2 text-xs text-indigo-800 space-y-1">
                                      {item.match_reasons.summary?.map((s, i) => (
                                        <div key={i}>• {s}</div>
                                      ))}
                                      {item.match_reasons.matchedSectors && item.match_reasons.matchedSectors.length > 0 && (
                                        <div className="text-indigo-600">Sectors: {item.match_reasons.matchedSectors.join(", ")}</div>
                                      )}
                                      {item.match_reasons.matchedCapabilities && item.match_reasons.matchedCapabilities.length > 0 && (
                                        <div className="text-indigo-600">Capabilities: {item.match_reasons.matchedCapabilities.join(", ")}</div>
                                      )}
                                      {item.match_reasons.matchedKeywords && item.match_reasons.matchedKeywords.length > 0 && (
                                        <div className="text-indigo-600">Keywords: {item.match_reasons.matchedKeywords.join(", ")}</div>
                                      )}
                                      {item.match_reasons.geographyAlignment?.mode && item.match_reasons.geographyAlignment.mode !== "unknown" && (
                                        <div className="text-indigo-600">
                                          Geography: {item.match_reasons.geographyAlignment.mode.replace(/-/g, " ")}
                                          {item.match_reasons.geographyAlignment.tenderCountry ? ` · ${item.match_reasons.geographyAlignment.tenderCountry}` : ""}
                                        </div>
                                      )}
                                      {item.match_reasons.opportunityBucketReason && (
                                        <div className="text-indigo-500 italic">{item.match_reasons.opportunityBucketReason}</div>
                                      )}
                                      {item.match_reasons.confidence != null && (
                                        <div className="text-indigo-500">Confidence: {Math.round(item.match_reasons.confidence * 100)}%</div>
                                      )}
                                      {item.match_reasons.caveats?.map((c, i) => (
                                        <div key={i} className="text-amber-700">⚠ {c}</div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="mt-2 flex items-center gap-3 flex-wrap">
                                {STAGE_GUIDANCE[item.stage].moveTo && (
                                  <button
                                    onClick={() => moveStage(item.id, STAGE_GUIDANCE[item.stage].moveTo!)}
                                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 border border-emerald-200 rounded px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                  >
                                    {STAGE_GUIDANCE[item.stage].button}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleAnalyse(item)}
                                  disabled={analysingId === item.id}
                                  title="Get win probability, criteria breakdown, and gap analysis for this tender ($39)"
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                >
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                  </svg>
                                  {analysingId === item.id ? "Checking…" : "Bid Analysis"}
                                </button>
                                <Link
                                  href={payHref("proposal-draft", item)}
                                  className="text-xs font-semibold text-gray-700 hover:text-gray-900 border border-gray-200 rounded px-2 py-0.5 bg-white hover:bg-gray-50 transition-colors"
                                >
                                  Draft Proposal
                                </Link>
                                {isRosterAgency(item.tender_agency) && (
                                  <Link
                                    href={payHref("roster-fast-track", item)}
                                    className="text-xs font-semibold text-amber-800 hover:text-amber-950 border border-amber-200 rounded px-2 py-0.5 bg-amber-50 hover:bg-amber-100 transition-colors"
                                  >
                                    Roster/LTA
                                  </Link>
                                )}
                                <button
                                  onClick={() => {
                                    if (confirm(`Remove "${item.tender_title}" from your pipeline?`)) {
                                      remove(item.id);
                                    }
                                  }}
                                  className="text-xs text-gray-400 hover:text-red-600 transition-colors"
                                  title="Remove from pipeline"
                                >
                                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
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
