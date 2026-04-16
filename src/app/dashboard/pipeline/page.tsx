"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";

type Stage = "matched" | "evaluating" | "preparing" | "submitted" | "won" | "lost";

interface PipelineItem {
  id: number;
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  fit_score: number;
  stage: Stage;
  position: number;
  notes: string | null;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: "matched", label: "Matched" },
  { key: "evaluating", label: "Evaluating" },
  { key: "preparing", label: "Preparing" },
  { key: "submitted", label: "Submitted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

export default function PipelinePage() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
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
            placeholder="Agency"
            value={form.tender_agency}
            onChange={(e) => setForm({ ...form, tender_agency: e.target.value })}
          />
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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {STAGES.map(({ key, label }) => (
              <Droppable droppableId={key} key={key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-lg border p-3 min-h-[400px] ${
                      snapshot.isDraggingOver
                        ? "bg-gray-100 border-gray-400"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                        {label}
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
                              <div className="font-medium text-gray-900 line-clamp-2">
                                {item.tender_title}
                              </div>
                              {item.tender_agency && (
                                <div className="mt-1 text-xs text-gray-600">
                                  {item.tender_agency}
                                </div>
                              )}
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                                {item.tender_deadline && (
                                  <span>
                                    Due {new Date(item.tender_deadline).toLocaleDateString()}
                                  </span>
                                )}
                                {item.tender_value && <span>{item.tender_value}</span>}
                                {item.fit_score > 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                    {item.fit_score}% fit
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => remove(item.id)}
                                className="mt-2 text-xs text-red-600 hover:underline"
                              >
                                Remove
                              </button>
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
        </DragDropContext>
      )}
    </div>
  );
}
