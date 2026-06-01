"use client";

/**
 * OutcomeCapture — Loop 1 (feedback flywheel). Self-contained: it fetches its
 * own eligibility from /api/dashboard/work-orders/[id]/outcome and renders
 * NOTHING unless a delivered proposal exists for this work order, so it can be
 * dropped into the work-order page without the parent knowing package state.
 *
 * Reporting a LOSS is as easy as a win (same row of buttons), and a loss opens
 * an optional "what went wrong" note that becomes loss-reason signal. Capturing
 * only happy outcomes is what quietly makes the score dishonest.
 */

import { useCallback, useEffect, useState } from "react";
import { MONO, SERIF } from "@/lib/brand/tokens";

type OutcomeValue = "won" | "lost" | "shortlisted" | "disqualified" | "withdrawn" | "pending";

interface GetResponse {
  eligible: boolean;
  predicted: { score: number; max: number; band: string } | null;
  outcome: { value: OutcomeValue | null; detail: string | null; state: string; capturedAt: string } | null;
}

type Tone = "pos" | "neg" | "neutral";
const OPTIONS: Array<{ value: OutcomeValue; label: string; tone: Tone }> = [
  { value: "won", label: "Won", tone: "pos" },
  { value: "shortlisted", label: "Shortlisted", tone: "pos" },
  { value: "lost", label: "Lost", tone: "neg" },
  { value: "disqualified", label: "Disqualified", tone: "neg" },
  { value: "withdrawn", label: "Didn’t submit", tone: "neutral" },
];
const LABEL: Record<string, string> = {
  won: "Won",
  shortlisted: "Shortlisted",
  lost: "Lost",
  disqualified: "Disqualified",
  withdrawn: "Didn’t submit",
  pending: "Not yet decided",
};

function toneClasses(tone: Tone): string {
  if (tone === "pos") return "border-emerald-300 text-emerald-800 hover:bg-emerald-50";
  if (tone === "neg") return "border-red-300 text-red-800 hover:bg-red-50";
  return "border-stone-300 text-stone-700 hover:bg-stone-50";
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export default function OutcomeCapture({ workOrderId }: { workOrderId: number }) {
  const [data, setData] = useState<GetResponse | null>(null);
  const [phase, setPhase] = useState<"pick" | "detail" | "done">("pick");
  const [selected, setSelected] = useState<OutcomeValue | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/outcome`, { headers: authHeaders() });
      if (!res.ok) return;
      const body = (await res.json()) as GetResponse;
      setData(body);
      if (body.outcome?.value) {
        setSelected(body.outcome.value);
        setDetail(body.outcome.detail ?? "");
        setPhase("done");
      }
    } catch {
      // Non-critical surface — stay invisible on error rather than break the page.
    }
  }, [workOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(
    async (value: OutcomeValue, note: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/dashboard/work-orders/${workOrderId}/outcome`, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ outcome: value, detail: note }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(body.error ?? "Could not record the outcome.");
          return;
        }
        setSelected(value);
        setPhase("done");
        setData((d) =>
          d ? { ...d, outcome: { value, detail: note, state: "captured", capturedAt: new Date().toISOString() } } : d,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not record the outcome.");
      } finally {
        setBusy(false);
      }
    },
    [workOrderId],
  );

  const onPick = (value: OutcomeValue, tone: Tone) => {
    setSelected(value);
    if (tone === "neg") {
      setDetail("");
      setPhase("detail");
    } else {
      void submit(value, null);
    }
  };

  // Render nothing until there's a delivered proposal to report on.
  if (!data || !data.eligible) return null;

  return (
    <section className="mt-4 rounded-md border border-stone-200/70 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[16px] font-medium text-stone-900" style={{ fontFamily: SERIF }}>
          How did this bid go?
        </h3>
        {data.predicted && (
          <span className="text-[11px] text-stone-400 tabular-nums" style={{ fontFamily: MONO }}>
            we rated this draft {data.predicted.band} · {data.predicted.score.toFixed(0)}/{data.predicted.max}
          </span>
        )}
      </div>

      {phase === "done" && selected ? (
        <div className="mt-3">
          <p className="text-[13px] text-stone-700 leading-relaxed">
            Recorded: <span className="font-semibold text-stone-900">{LABEL[selected]}</span>. Thanks — every result you
            report sharpens the score for your next tender.
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("pick");
              setError(null);
            }}
            className="mt-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 hover:text-stone-900 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Change →
          </button>
        </div>
      ) : phase === "detail" && selected ? (
        <div className="mt-3">
          <p className="text-[12.5px] text-stone-600 leading-relaxed">
            Sorry to hear it. What do you think went wrong?{" "}
            <span className="text-stone-400">(optional — we use it to sharpen your next draft)</span>
          </p>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="e.g. price was too high, missed a mandatory form, weak past-performance section…"
            className="mt-2 w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-[13px] text-stone-800 focus:border-stone-700 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(selected, detail.trim() || null)}
              className="rounded-sm bg-stone-900 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-stone-800 transition-colors disabled:opacity-50"
              style={{ fontFamily: MONO }}
            >
              {busy ? "Recording…" : "Submit"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(selected, null)}
              className="text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-50"
              style={{ fontFamily: MONO }}
            >
              Skip note
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => onPick(o.value, o.tone)}
              className={`rounded-sm border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${toneClasses(o.tone)}`}
              style={{ fontFamily: MONO }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11.5px] text-red-700">{error}</p>}
    </section>
  );
}
