"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface BidAnalysis {
  id: number;
  win_probability: number;
  recommendation: "Bid" | "No-Bid" | "Conditional";
  strength_areas: string[];
  gap_areas: string[];
  required_documents: string[];
  effort_estimate: "Low" | "Medium" | "High";
  key_risks: string[];
  next_steps: string[];
  created_at: string;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function probabilityColor(p: number): string {
  if (p >= 65) return "#047857"; // emerald-700
  if (p >= 40) return "#b45309"; // amber-700
  return "#b91c1c"; // red-700
}

function recommendationLabel(r: string): { dot: string; ring: string; bg: string; tone: string } {
  if (r === "Bid")
    return {
      dot: "bg-emerald-500",
      ring: "border-emerald-300",
      bg: "bg-emerald-50/60",
      tone: "text-emerald-900",
    };
  if (r === "No-Bid")
    return {
      dot: "bg-red-500",
      ring: "border-red-300",
      bg: "bg-red-50/60",
      tone: "text-red-900",
    };
  return {
    dot: "bg-amber-500",
    ring: "border-amber-300",
    bg: "bg-amber-50/60",
    tone: "text-amber-900",
  };
}

function effortDot(e: string): string {
  if (e === "Low") return "bg-emerald-500";
  if (e === "High") return "bg-red-500";
  return "bg-amber-500";
}

export default function AnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pipelineItemId = params.tenderId as string;
  const sessionId = searchParams.get("session_id");

  const [analysis, setAnalysis] = useState<BidAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const checkRes = await fetch(
          `/api/analysis/bid-no-bid?pipeline_item_id=${pipelineItemId}`,
          { headers: authHeaders() }
        );

        if (checkRes.ok) {
          const data = await checkRes.json();
          setAnalysis(data.analysis);
          setLoading(false);
          return;
        }

        if (!sessionId) {
          setError("No analysis found. Please go back to the pipeline and run an analysis.");
          setLoading(false);
          return;
        }

        const runRes = await fetch("/api/analysis/bid-no-bid", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            pipeline_item_id: Number(pipelineItemId),
            stripe_session_id: sessionId,
          }),
        });

        if (!runRes.ok) {
          const err = await runRes.json();
          setError(err.error ?? "Analysis failed. Please contact support.");
          setLoading(false);
          return;
        }

        const data = await runRes.json();
        setAnalysis(data.analysis);
      } catch {
        setError("Something went wrong. Please try again.");
      }

      setLoading(false);
    })();
  }, [pipelineItemId, sessionId, router]);

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-4xl">
        <div className="rounded-md border border-stone-200/70 bg-white p-12 text-center">
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900" />
          <p
            className="text-[12px] font-semibold uppercase tracking-[0.18em] text-stone-700"
            style={{ fontFamily: MONO }}
          >
            {sessionId ? "Running bid analysis" : "Loading"}
          </p>
          <p className="mt-1.5 text-[13px] text-stone-500">
            {sessionId
              ? "This may take 20–30 seconds — Claude is grounding the recommendation in your profile."
              : "Loading the saved analysis…"}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-8 py-8 max-w-2xl">
        <div className="rounded-md border-l-2 border-red-600 bg-red-50/40 p-6">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700 mb-2"
            style={{ fontFamily: MONO }}
          >
            Analysis unavailable
          </div>
          <p className="text-[13.5px] text-red-900 leading-relaxed mb-4">{error}</p>
          <Link
            href="/dashboard/pipeline"
            className="text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:text-stone-900 underline underline-offset-2"
            style={{ fontFamily: MONO }}
          >
            ← Back to pipeline
          </Link>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const prob = analysis.win_probability;
  const recStyles = recommendationLabel(analysis.recommendation);

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Back link */}
      <Link
        href="/dashboard/pipeline"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
        style={{ fontFamily: MONO }}
      >
        ← Pipeline
      </Link>

      {/* Header */}
      <header className="mt-5 mb-8">
        <div className="flex items-center gap-3 text-[11px] text-stone-500">
          <span
            className="font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Workbench · Bid analysis
          </span>
          <span className="text-stone-300">·</span>
          <span style={{ fontFamily: MONO }}>
            Generated{" "}
            {new Date(analysis.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
        <h1
          className="mt-1 text-[48px] leading-[1.05] font-medium text-stone-900 tracking-tight"
          style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
        >
          Decision report
        </h1>
      </header>

      {/* Hero — score + recommendation */}
      <section className="rounded-md border border-stone-200/70 bg-white p-7 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-7 items-center">
          {/* Score */}
          <div className="flex flex-col">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Win probability
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className="text-[112px] leading-none font-medium tabular-nums tracking-tight"
                style={{ fontFamily: SERIF, color: probabilityColor(prob) }}
              >
                {prob}
              </span>
              <span
                className="text-[28px] font-medium text-stone-400 tabular-nums"
                style={{ fontFamily: SERIF }}
              >
                %
              </span>
            </div>
          </div>

          {/* Recommendation strip */}
          <div className="flex flex-col gap-4">
            <div className={`rounded-md border ${recStyles.ring} ${recStyles.bg} px-5 py-4`}>
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                style={{ fontFamily: MONO }}
              >
                Recommendation
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${recStyles.dot}`} />
                <span
                  className={`text-[28px] font-medium tracking-tight ${recStyles.tone}`}
                  style={{ fontFamily: SERIF }}
                >
                  {analysis.recommendation}
                </span>
              </div>
            </div>
            <div className="rounded-md border border-stone-200/70 px-5 py-3.5 flex items-center justify-between gap-4">
              <div>
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                  style={{ fontFamily: MONO }}
                >
                  Effort estimate
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${effortDot(analysis.effort_estimate)}`} />
                  <span className="text-[16px] font-medium text-stone-900">
                    {analysis.effort_estimate}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
                  style={{ fontFamily: MONO }}
                >
                  Confidence
                </div>
                <div
                  className="mt-0.5 text-[14px] text-stone-700 tabular-nums"
                  style={{ fontFamily: MONO }}
                >
                  Decision-grade
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Four-quadrant lists */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-stone-200/70 rounded-md overflow-hidden mb-6">
        <ListBlock
          index="01"
          title="Strengths"
          items={analysis.strength_areas}
          emptyMessage="No clear strengths identified."
          markerColor="#10b981"
        />
        <ListBlock
          index="02"
          title="Gaps"
          items={analysis.gap_areas}
          emptyMessage="No major gaps identified."
          markerColor="#dc2626"
        />
        <ListBlock
          index="03"
          title="Required documents"
          items={analysis.required_documents}
          emptyMessage="No specific documents listed."
          markerColor="#a8a29e"
        />
        <ListBlock
          index="04"
          title="Next steps"
          items={analysis.next_steps}
          emptyMessage="No next steps generated."
          markerColor="#0284c7"
          ordered
        />
      </section>

      {/* Key risks */}
      {analysis.key_risks.length > 0 && (
        <section className="rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-6 mb-6">
          <div className="flex items-baseline gap-3 mb-3">
            <span
              className="text-[10px] font-semibold tabular-nums text-amber-700"
              style={{ fontFamily: MONO }}
            >
              05
            </span>
            <h3
              className="text-[18px] font-medium text-amber-900"
              style={{ fontFamily: SERIF }}
            >
              Key risks
            </h3>
          </div>
          <ul className="space-y-2.5">
            {analysis.key_risks.map((risk, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-amber-900">
                <span
                  className="mt-0.5 shrink-0 text-[10px] font-semibold tabular-nums text-amber-700"
                  style={{ fontFamily: MONO }}
                >
                  {(i + 1).toString().padStart(2, "0")}
                </span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Next-action CTA */}
      <section className="rounded-md border border-stone-200/70 bg-stone-50/40 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Next · take this further
            </div>
            <h3
              className="mt-1 text-[20px] font-medium text-stone-900"
              style={{ fontFamily: SERIF }}
            >
              Ready to build your proposal?
            </h3>
            <p className="mt-1 text-[12.5px] text-stone-600">
              Generate a full submission package with pre-filled documents.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row shrink-0">
            <Link
              href={`/dashboard/services/proposal?pipeline_item_id=${encodeURIComponent(pipelineItemId)}`}
              className="rounded-sm bg-stone-900 px-5 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800 text-center transition-colors"
            >
              Generate proposal package →
            </Link>
            <Link
              href={`/dashboard/services/lta-roster?pipeline_item_id=${encodeURIComponent(pipelineItemId)}`}
              className="rounded-sm border border-stone-300 px-5 py-2.5 text-[12.5px] font-semibold text-stone-700 hover:border-stone-700 hover:text-stone-900 text-center transition-colors"
            >
              Roster / LTA support
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function ListBlock({
  index,
  title,
  items,
  emptyMessage,
  markerColor,
  ordered = false,
}: {
  index: string;
  title: string;
  items: string[];
  emptyMessage: string;
  markerColor: string;
  ordered?: boolean;
}) {
  return (
    <div className="bg-white p-5 min-h-[180px]">
      <div className="flex items-baseline gap-2.5 mb-3">
        <span
          className="text-[10px] font-semibold tabular-nums text-stone-400"
          style={{ fontFamily: MONO }}
        >
          {index}
        </span>
        <h3
          className="text-[16px] font-medium text-stone-900"
          style={{ fontFamily: SERIF }}
        >
          {title}
        </h3>
        <span
          className="ml-auto text-[10px] font-semibold tabular-nums text-stone-400"
          style={{ fontFamily: MONO }}
        >
          {items.length.toString().padStart(2, "0")}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-stone-400 italic">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-stone-700">
              {ordered ? (
                <span
                  className="mt-0.5 shrink-0 text-[10px] font-semibold tabular-nums"
                  style={{ fontFamily: MONO, color: markerColor }}
                >
                  {(i + 1).toString().padStart(2, "0")}
                </span>
              ) : (
                <span
                  className="mt-1.5 h-1 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: markerColor }}
                />
              )}
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
